//! The huddle itself: shared playlist, shared controls and the playback clock.
//!
//! Playback is gated on caching: pressing play (or moving to another song)
//! only starts the audio once every member has the song fully on their device.
//! It then starts `LEAD_MS` in the future so everyone begins at the same instant
//! (clients map server time to their own clock with ping/pong).

use super::model::{
    Answer, ChatMsg, ClientMsg, Game, GameOpt, GameResult, GameView, LastAction, Member, MemberView, Mvp, Recap, Room, Score,
    ServerMsg, SharedTrack,
};
use rand::seq::SliceRandom;
use rand::Rng;
use std::{
    collections::{HashMap, HashSet, VecDeque},
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::sync::mpsc::UnboundedSender;

/// Head start given to every client before a synchronised start or seek.
pub const LEAD_MS: i64 = 1200;
pub const MAX_MEMBERS: usize = 16;
const MAX_QUEUE: usize = 200;
const MAX_CHAT: usize = 80;
const DEFAULT_EMOS: [&str; 7] = ["❤️", "👍", "🎉", "👏", "😂", "😮", "🔥"];
/// Guessing time for a round of Guess the song.
const GAME_MS: i64 = 20_000;
/// The answer stays on screen this long before the music goes back.
const REVEAL_MS: i64 = 5_500;
/// The same emoji this many times within STREAK_MS is a streak.
const STREAK_MS: i64 = 2_600;
const CHAT_EMOS: [&str; 6] = ["❤️", "😂", "🔥", "👍", "😮", "😭"];
const CODE_CHARS: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

pub fn new_code(taken: impl Fn(&str) -> bool) -> String {
    let mut rng = rand::thread_rng();
    loop {
        let code: String = (0..6).map(|_| CODE_CHARS[rng.gen_range(0..CODE_CHARS.len())] as char).collect();
        if !taken(&code) {
            return code;
        }
    }
}

fn clip(s: &str, max: usize) -> String {
    s.trim().chars().take(max).collect()
}

impl Room {
    pub fn new(code: String, name: &str) -> Self {
        let name = clip(name, 40);
        Room {
            code,
            name: if name.is_empty() { "Huddle".into() } else { name },
            host: String::new(),
            members: vec![],
            queue: vec![],
            index: 0,
            playing: false,
            pending: false,
            pos: 0.0,
            at: now_ms(),
            chat: VecDeque::new(),
            chat_seq: 0,
            reactions: HashMap::new(),
            emos: DEFAULT_EMOS.iter().map(|s| s.to_string()).collect(),
            last: None,
            next_color: 0,
            empty_since: None,
            next_conn: 0,
            started: now_ms(),
            played: vec![],
            msgs: 0,
            best_streak: 0,
            rx_log: VecDeque::new(),
            game: None,
            rounds: 0,
            scores: vec![],
        }
    }

    /// Joins with the device's id (a new one if none). The same device coming
    /// back replaces its old connection. Returns `(member id, connection)`.
    pub fn add_member(&mut self, device: Option<&str>, name: &str, color: Option<u8>, tx: UnboundedSender<String>) -> (String, u64) {
        let device: String =
            device.unwrap_or("").chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').take(40).collect();
        let id = if device.is_empty() { uuid::Uuid::new_v4().simple().to_string()[..12].to_string() } else { device };
        let name = clip(name, 24);
        let name = if name.is_empty() { "Guest".to_string() } else { name };
        let color = color.map(|c| c % 8).unwrap_or_else(|| {
            let c = self.next_color % 8;
            self.next_color = self.next_color.wrapping_add(1);
            c
        });
        self.next_conn += 1;
        let conn = self.next_conn;
        self.empty_since = None;
        if let Some(m) = self.members.iter_mut().find(|m| m.id == id) {
            // Reconnected: the old socket closes on its own and its leave is ignored.
            m.tx = tx;
            m.conn = conn;
            m.name = name;
            m.color = color;
            m.ready.clear();
            return (id, conn);
        }
        if self.host.is_empty() {
            self.host = id.clone();
        }
        let kind = if self.members.is_empty() { "start" } else { "join" };
        self.members.push(Member { id: id.clone(), name, color, tx, ready: HashSet::new(), conn, reacts: 0, likes: VecDeque::new() });
        let arg = if kind == "start" { self.code.clone() } else { String::new() };
        self.sys(&id, kind, arg);
        (id, conn)
    }

    /// Returns true when the room is now empty (it's kept a while, see `empty_since`).
    /// The old connection of a device that already reconnected changes nothing.
    pub fn remove_member(&mut self, id: &str, conn: u64) -> bool {
        if !self.members.iter().any(|m| m.id == id && m.conn == conn) {
            return false;
        }
        self.sys(id, "leave", String::new());
        self.members.retain(|m| m.id != id);
        if self.members.is_empty() {
            let now = now_ms();
            self.pause_at(now);
            self.host.clear();
            self.empty_since = Some(now);
            self.game = None;
            return true;
        }
        if self.host == id {
            self.host = self.members[0].id.clone();
        }
        // They may have been the one everyone was waiting for.
        let now = now_ms();
        self.try_start(now);
        self.game_tick(now);
        false
    }

    pub fn member(&self, id: &str) -> Option<&Member> {
        self.members.iter().find(|m| m.id == id)
    }

    fn sys(&mut self, who: &str, kind: &'static str, text: String) {
        let (name, color) = self.member(who).map(|m| (m.name.clone(), m.color)).unwrap_or_default();
        self.chat_seq += 1;
        self.chat.push_back(ChatMsg {
            id: self.chat_seq,
            at: now_ms(),
            kind,
            who: who.to_string(),
            name,
            color,
            text,
            rx: Default::default(),
            edited: false,
        });
        while self.chat.len() > MAX_CHAT {
            self.chat.pop_front();
        }
    }

    fn act(&mut self, who: &str, action: &'static str, arg: String, now: i64) {
        if let Some(m) = self.member(who) {
            self.last = Some(LastAction { name: m.name.clone(), color: m.color, action, arg, at: now });
        }
    }

    fn current(&self) -> Option<&SharedTrack> {
        self.queue.get(self.index)
    }

    /// Where the song is at server time `now`.
    pub fn position(&self, now: i64) -> f64 {
        if self.playing { self.pos + ((now - self.at).max(0) as f64) / 1000.0 } else { self.pos }
    }

    fn all_ready(&self) -> bool {
        match self.current() {
            Some(t) => self.members.iter().all(|m| m.ready.contains(&t.key)),
            None => false,
        }
    }

    /// Starts a pending play once everyone has the song.
    fn try_start(&mut self, now: i64) {
        if self.pending && self.all_ready() {
            self.pending = false;
            self.playing = true;
            self.at = now + LEAD_MS;
            if let Some(k) = self.current().map(|t| t.key.clone()) {
                if !self.played.contains(&k) {
                    self.played.push(k);
                }
            }
        }
    }

    /// Moves to another song, keeping "play" if it was on (gated on caching again).
    fn go_to(&mut self, index: usize, now: i64) {
        let wanted = self.playing || self.pending;
        self.index = index;
        self.pos = 0.0;
        self.at = now;
        self.playing = false;
        self.pending = wanted;
        self.try_start(now);
    }

    /// Everyone manages the songs they added; the host manages them all.
    fn can_manage(&self, who: &str, i: usize) -> bool {
        self.queue.get(i).is_some_and(|t| t.by == who) || self.host == who
    }

    /// Starts the guessing clock once the mystery song really plays; reveals once everyone answered.
    pub fn game_tick(&mut self, now: i64) {
        let (playing, at, cur) = (self.playing, self.at, self.current().map(|t| t.key.clone()));
        let members: Vec<String> = self.members.iter().map(|m| m.id.clone()).collect();
        let Some(g) = self.game.as_mut() else { return };
        if g.revealed_at.is_some() {
            return;
        }
        if g.start == 0 && playing && cur.as_deref() == Some(g.key.as_str()) {
            g.start = at;
            g.end = at + GAME_MS;
        }
        let all = members.iter().filter(|m| **m != g.by).all(|m| g.answers.iter().any(|a| &a.who == m));
        if g.start > 0 && all {
            self.reveal(now);
        }
    }

    fn reveal(&mut self, now: i64) {
        let Some(g) = self.game.as_mut() else { return };
        let mut right: Vec<&Answer> = g.answers.iter().filter(|a| a.opt == g.answer).collect();
        right.sort_by_key(|a| a.at);
        g.results = right.iter().enumerate().map(|(k, a)| (a.who.clone(), [3, 2, 1][k.min(2)])).collect();
        g.revealed_at = Some(now);
        let title = g.opts[g.answer].title.clone();
        let results = g.results.clone();
        for (who, pts) in &results {
            let Some(m) = self.members.iter().find(|m| &m.id == who) else { continue };
            match self.scores.iter_mut().find(|s| &s.id == who) {
                Some(s) => s.pts += pts,
                None => self.scores.push(Score { id: m.id.clone(), name: m.name.clone(), color: m.color, pts: *pts }),
            }
        }
        self.scores.sort_by(|a, b| b.pts.cmp(&a.pts));
        let first = results.first().map(|r| r.0.clone()).unwrap_or_default();
        self.sys(&first, "game", title);
    }

    fn start_game(&mut self, who: &str, key: String, decoys: Vec<GameOpt>, now: i64) -> bool {
        if self.game.is_some() {
            return false;
        }
        let Some(idx) = self.queue.iter().position(|t| t.key == key) else { return false };
        let Some(m) = self.member(who) else { return false };
        let (by_name, by_color) = (m.name.clone(), m.color);
        let t = &self.queue[idx];
        let right = GameOpt { title: t.title.clone(), artist: t.artist.clone() };
        let mut seen = HashSet::from([right.title.to_lowercase()]);
        let mut opts: Vec<GameOpt> = decoys
            .into_iter()
            .map(|o| GameOpt { title: clip(&o.title, 200), artist: o.artist.map(|a| clip(&a, 120)) })
            .filter(|o| !o.title.is_empty() && seen.insert(o.title.to_lowercase()))
            .take(3)
            .collect();
        if opts.is_empty() {
            return false;
        }
        let dur = t.duration;
        opts.push(right.clone());
        opts.shuffle(&mut rand::thread_rng());
        let answer = opts.iter().position(|o| o.title == right.title).unwrap_or(0);
        self.rounds += 1;
        self.game = Some(Game {
            by: who.to_string(),
            by_name,
            by_color,
            key,
            round: self.rounds,
            opts,
            answer,
            start: 0,
            end: 0,
            answers: vec![],
            revealed_at: None,
            results: vec![],
            resume_key: self.current().map(|t| t.key.clone()),
            resume_pos: self.position(now),
        });
        self.pending = true;
        self.go_to(idx, now);
        // From a third in: the intro alone is too easy (or too hard).
        self.pos = dur.map_or(0.0, |d| (d * 0.3).floor());
        self.sys(who, "round", self.rounds.to_string());
        true
    }

    fn close_game(&mut self, now: i64) {
        let Some(g) = self.game.take() else { return };
        match g.resume_key.and_then(|k| self.queue.iter().position(|t| t.key == k)) {
            Some(i) => {
                self.pending = true;
                self.go_to(i, now);
                self.pos = g.resume_pos;
            }
            None => self.pause_at(now),
        }
    }

    fn pause_at(&mut self, now: i64) {
        self.pos = self.position(now);
        self.at = now;
        self.playing = false;
        self.pending = false;
    }

    /// Applies one message. Returns `(reply to the sender only, state changed)`.
    pub fn handle(&mut self, who: &str, msg: ClientMsg, now: i64) -> (Option<String>, bool) {
        let in_game = self.game.is_some();
        if in_game
            && matches!(msg, ClientMsg::Seek { .. } | ClientMsg::Next | ClientMsg::Prev | ClientMsg::Jump { .. } | ClientMsg::Ended { .. })
        {
            return (None, false);
        }
        match msg {
            ClientMsg::Ping { c } => return (Some(to_json(&ServerMsg::Pong { c, s: now_ms() })), false),
            ClientMsg::Play => {
                if self.playing || self.pending || self.current().is_none() {
                    return (None, false);
                }
                self.pending = true;
                self.try_start(now);
                self.act(who, "resumed", String::new(), now);
            }
            ClientMsg::Pause => {
                if !self.playing && !self.pending {
                    return (None, false);
                }
                self.pause_at(now);
                self.act(who, "paused", String::new(), now);
            }
            ClientMsg::Seek { pos } => {
                let Some(t) = self.current() else { return (None, false) };
                let end = t.duration.unwrap_or(f64::MAX);
                self.pos = pos.clamp(0.0, end);
                // Everyone has it cached already: just restart in step.
                self.at = if self.playing { now + LEAD_MS / 2 } else { now };
                self.act(who, "seek", format!("{}", self.pos.round() as i64), now);
            }
            ClientMsg::Next => {
                if self.index + 1 >= self.queue.len() {
                    return (None, false);
                }
                self.go_to(self.index + 1, now);
                self.act(who, "skipped", String::new(), now);
            }
            ClientMsg::Prev => {
                if self.position(now) > 3.0 || self.index == 0 {
                    self.pos = 0.0;
                    self.at = if self.playing { now + LEAD_MS / 2 } else { now };
                } else {
                    self.go_to(self.index - 1, now);
                }
                self.act(who, "back", String::new(), now);
            }
            ClientMsg::Jump { index } => {
                if index >= self.queue.len() {
                    return (None, false);
                }
                let title = self.queue[index].title.clone();
                // Picking a song from the list plays it.
                self.pending = true;
                self.go_to(index, now);
                self.act(who, "played", title, now);
            }
            ClientMsg::Ended { index } => {
                // The first member to finish moves everyone on; the others' reports are stale.
                let near_end = self.current().and_then(|t| t.duration).map_or(true, |d| self.position(now) >= d - 5.0);
                if index != self.index || !self.playing || !near_end {
                    return (None, false);
                }
                if self.index + 1 < self.queue.len() {
                    self.go_to(self.index + 1, now);
                } else {
                    self.pause_at(now);
                    self.pos = 0.0;
                }
            }
            ClientMsg::Add { mut track } => {
                if self.queue.len() >= MAX_QUEUE || self.queue.iter().any(|t| t.key == track.key) {
                    return (None, false);
                }
                let Some(m) = self.member(who) else { return (None, false) };
                track.by = m.id.clone();
                track.by_name = m.name.clone();
                track.by_color = m.color;
                track.title = clip(&track.title, 200);
                track.shout = track.shout.map(|s| clip(&s, 80)).filter(|s| !s.is_empty());
                track.genre = track.genre.map(|s| clip(&s, 40));
                let title = track.title.clone();
                self.queue.push(track);
                self.sys(who, "add", title);
            }
            ClientMsg::Remove { key } => {
                let Some(i) = self.queue.iter().position(|t| t.key == key) else { return (None, false) };
                if i == self.index || !self.can_manage(who, i) || self.game.as_ref().is_some_and(|g| g.key == key) {
                    return (None, false);
                }
                let t = self.queue.remove(i);
                if i < self.index {
                    self.index -= 1;
                }
                self.reactions.remove(&t.key);
            }
            ClientMsg::Move { from, to } => {
                if from >= self.queue.len() || to >= self.queue.len() || from == to || !self.can_manage(who, from) {
                    return (None, false);
                }
                let cur = self.current().map(|t| t.key.clone());
                let t = self.queue.remove(from);
                let title = t.title.clone();
                self.queue.insert(to, t);
                if let Some(k) = cur {
                    self.index = self.queue.iter().position(|t| t.key == k).unwrap_or(0);
                }
                self.sys(who, "move", title);
            }
            ClientMsg::Ready { key } => {
                let Some(m) = self.members.iter_mut().find(|m| m.id == who) else { return (None, false) };
                if !m.ready.insert(key) {
                    return (None, false);
                }
                self.try_start(now);
            }
            ClientMsg::Chat { text } => {
                let text = clip(&text, 500);
                if text.is_empty() {
                    return (None, false);
                }
                self.msgs += 1;
                self.sys(who, "msg", text);
            }
            ClientMsg::ChatReact { id, emoji } => {
                if !CHAT_EMOS.contains(&emoji.as_str()) && !self.emos.contains(&emoji) {
                    return (None, false);
                }
                let Some(m) = self.chat.iter_mut().find(|m| m.id == id && m.kind == "msg") else { return (None, false) };
                let list = m.rx.entry(emoji.clone()).or_default();
                match list.iter().position(|w| w == who) {
                    Some(i) => {
                        list.remove(i);
                        if list.is_empty() {
                            m.rx.remove(&emoji);
                        }
                    }
                    None => list.push(who.to_string()),
                }
            }
            ClientMsg::ChatEdit { id, text } => {
                let text = clip(&text, 500);
                let Some(m) = self.chat.iter_mut().find(|m| m.id == id && m.kind == "msg" && m.who == who) else { return (None, false) };
                if text.is_empty() || text == m.text {
                    return (None, false);
                }
                m.text = text;
                m.edited = true;
            }
            ClientMsg::GameStart { key, decoys } => {
                if !self.start_game(who, key, decoys, now) {
                    return (None, false);
                }
            }
            ClientMsg::Guess { opt } => {
                let Some(g) = self.game.as_mut() else { return (None, false) };
                if g.revealed_at.is_some() || g.start == 0 || g.by == who || opt >= g.opts.len() || g.answers.iter().any(|a| a.who == who) {
                    return (None, false);
                }
                g.answers.push(Answer { who: who.to_string(), opt, at: now });
            }
            ClientMsg::GameEnd => {
                let Some(g) = &self.game else { return (None, false) };
                if g.revealed_at.is_some() || g.start == 0 || now < g.end - 500 {
                    return (None, false);
                }
                self.reveal(now);
            }
            ClientMsg::GameClose => {
                let Some(t) = self.game.as_ref().and_then(|g| g.revealed_at) else { return (None, false) };
                if now < t + REVEAL_MS {
                    return (None, false);
                }
                self.close_game(now);
            }
            ClientMsg::React { emoji } => {
                if !self.emos.contains(&emoji) {
                    return (None, false);
                }
                let Some(key) = self.current().map(|t| t.key.clone()) else { return (None, false) };
                *self.reactions.entry(key.clone()).or_default().entry(emoji.clone()).or_default() += 1;
                self.rx_log.retain(|(at, _)| now - *at < STREAK_MS);
                self.rx_log.push_back((now, emoji.clone()));
                let streak = self.rx_log.iter().filter(|(_, e)| *e == emoji).count() as u32;
                if streak >= 3 {
                    self.best_streak = self.best_streak.max(streak);
                }
                let like = format!("{key} {emoji}");
                if let Some(m) = self.members.iter_mut().find(|m| m.id == who) {
                    m.reacts += 1;
                    if !m.likes.contains(&like) {
                        m.likes.push_back(like);
                        // ponytail: sent with every state; a per-member endpoint if taste match needs more history
                        if m.likes.len() > 60 {
                            m.likes.pop_front();
                        }
                    }
                }
                if let Some(m) = self.member(who) {
                    let ev = to_json(&ServerMsg::React { who, name: &m.name, color: m.color, emoji: &emoji, streak });
                    self.send_all(&ev);
                }
            }
            ClientMsg::Emos { list } => {
                let mut seen = HashSet::new();
                let list: Vec<String> =
                    list.into_iter().map(|e| clip(&e, 16)).filter(|e| !e.is_empty() && seen.insert(e.clone())).collect();
                if self.host != who || !(3..=8).contains(&list.len()) {
                    return (None, false);
                }
                self.emos = list;
                self.sys(who, "emos", self.emos.join(" "));
            }
        }
        self.game_tick(now);
        (None, true)
    }

    pub fn state_json(&self) -> String {
        let key = self.current().map(|t| t.key.as_str());
        to_json(&ServerMsg::State {
            code: &self.code,
            name: &self.name,
            host: &self.host,
            members: self
                .members
                .iter()
                .map(|m| MemberView {
                    id: &m.id,
                    name: &m.name,
                    color: m.color,
                    ready: key.is_some_and(|k| m.ready.contains(k)),
                    reacts: m.reacts,
                    likes: &m.likes,
                })
                .collect(),
            queue: &self.queue,
            index: self.index,
            playing: self.playing,
            pending: self.pending,
            pos: self.pos,
            at: self.at,
            chat: &self.chat,
            reactions: key.and_then(|k| self.reactions.get(k)),
            emos: &self.emos,
            last: &self.last,
            game: self.game.as_ref().map(|g| {
                let shown = g.revealed_at.is_some();
                GameView {
                    by: &g.by,
                    by_name: &g.by_name,
                    by_color: g.by_color,
                    round: g.round,
                    opts: &g.opts,
                    start: g.start,
                    end: g.end,
                    phase: if shown { "reveal" } else { "ask" },
                    answered: g.answers.iter().map(|a| a.who.as_str()).collect(),
                    picks: shown.then_some(g.answers.as_slice()),
                    answer: shown.then_some(g.answer),
                    results: g.results.iter().map(|(who, pts)| GameResult { who, pts: *pts }).collect(),
                }
            }),
            scores: &self.scores,
            recap: self.recap(),
        })
    }

    fn recap(&self) -> Recap<'_> {
        let sum = |k: &str| self.reactions.get(k).map_or(0, |m| m.values().sum::<u32>());
        let top = self.reactions.keys().map(|k| (k.as_str(), sum(k))).max_by_key(|x| x.1).filter(|x| x.1 > 0);
        let mut emojis: HashMap<&str, u32> = HashMap::new();
        for m in self.reactions.values() {
            for (e, n) in m {
                *emojis.entry(e.as_str()).or_default() += n;
            }
        }
        let top_emoji = emojis.into_iter().max_by_key(|x| x.1);
        // MVP DJ: the most reactions on the songs they added.
        let mut djs: Vec<(&SharedTrack, u32)> = vec![];
        for t in &self.queue {
            match djs.iter_mut().find(|d| d.0.by == t.by) {
                Some(d) => d.1 += sum(&t.key),
                None => djs.push((t, sum(&t.key))),
            }
        }
        let mvp = djs.into_iter().filter(|d| d.1 > 0).max_by_key(|d| d.1).map(|(t, n)| Mvp { name: t.by_name.clone(), color: t.by_color, n });
        Recap {
            started: self.started,
            played: &self.played,
            msgs: self.msgs,
            best_streak: self.best_streak,
            top_key: top.map(|x| x.0),
            top_n: top.map_or(0, |x| x.1),
            top_emoji: top_emoji.map(|x| x.0),
            top_emoji_n: top_emoji.map_or(0, |x| x.1),
            mvp,
        }
    }

    pub fn send_all(&self, text: &str) {
        for m in &self.members {
            let _ = m.tx.send(text.to_string());
        }
    }

    pub fn broadcast_state(&self) {
        self.send_all(&self.state_json());
    }
}

pub fn to_json(msg: &ServerMsg) -> String {
    serde_json::to_string(msg).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc::unbounded_channel;

    fn track(key: &str) -> SharedTrack {
        SharedTrack {
            key: key.into(),
            source: "youtube".into(),
            source_id: key.into(),
            title: key.into(),
            artist: None,
            album: None,
            duration: Some(200.0),
            artwork: None,
            by: String::new(),
            by_name: String::new(),
            by_color: 0,
            genre: None,
            shout: None,
        }
    }

    fn join(r: &mut Room, name: &str) -> String {
        r.add_member(None, name, None, unbounded_channel().0).0
    }

    fn conn_of(r: &Room, id: &str) -> u64 {
        r.member(id).map_or(0, |m| m.conn)
    }

    #[test]
    fn play_waits_for_everyone_then_starts_in_step() {
        let mut r = Room::new("ABCDEF".into(), "Test");
        let a = join(&mut r, "A");
        let b = join(&mut r, "B");
        r.handle(&a, ClientMsg::Add { track: track("s1") }, 0);
        r.handle(&a, ClientMsg::Add { track: track("s2") }, 0);
        r.handle(&a, ClientMsg::Ready { key: "s1".into() }, 0);

        r.handle(&a, ClientMsg::Play, 1000);
        assert!(r.pending && !r.playing, "B hasn't cached s1 yet");

        r.handle(&b, ClientMsg::Ready { key: "s1".into() }, 2000);
        assert!(r.playing && !r.pending);
        assert_eq!(r.at, 2000 + LEAD_MS);
        assert_eq!(r.position(2000), 0.0);
        assert_eq!(r.position(2000 + LEAD_MS + 10_000), 10.0);

        // Next song: gated again until both have s2.
        r.handle(&b, ClientMsg::Next, 5000);
        assert!(r.pending && !r.playing && r.index == 1);
        r.handle(&a, ClientMsg::Ready { key: "s2".into() }, 5100);
        r.handle(&b, ClientMsg::Ready { key: "s2".into() }, 5200);
        assert!(r.playing);

        // Only one "ended" moves on, and only near the end.
        r.handle(&a, ClientMsg::Ended { index: 1 }, 6000);
        assert_eq!(r.index, 1, "too early to be the end");
        let end = r.at + 199_000;
        r.handle(&a, ClientMsg::Ended { index: 1 }, end);
        assert!(!r.playing && r.pos == 0.0, "end of the list stops");

        // A member leaving unblocks a pending start.
        r.handle(&a, ClientMsg::Jump { index: 0 }, end + 10);
        let c = join(&mut r, "C");
        r.handle(&a, ClientMsg::Jump { index: 1 }, end + 20);
        assert!(r.pending);
        assert!(!r.remove_member(&c, conn_of(&r, &c)));
        assert!(r.playing);

        // Everyone gone: paused and marked empty; the next one in is host.
        r.remove_member(&a, conn_of(&r, &a));
        assert!(r.remove_member(&b, conn_of(&r, &b)));
        assert!(!r.playing && r.empty_since.is_some());
        let d = join(&mut r, "D");
        assert!(r.empty_since.is_none() && r.host == d);
    }

    #[test]
    fn pause_keeps_position_and_only_owner_or_host_removes() {
        let mut r = Room::new("ABCDEF".into(), "Test");
        let a = join(&mut r, "A");
        let b = join(&mut r, "B");
        r.handle(&a, ClientMsg::Add { track: track("s1") }, 0);
        r.handle(&b, ClientMsg::Add { track: track("s2") }, 0);
        r.handle(&a, ClientMsg::Ready { key: "s1".into() }, 0);
        r.handle(&b, ClientMsg::Ready { key: "s1".into() }, 0);
        r.handle(&a, ClientMsg::Play, 0);
        r.handle(&b, ClientMsg::Pause, LEAD_MS + 4000);
        assert!(!r.playing && (r.pos - 4.0).abs() < 1e-9);

        r.handle(&b, ClientMsg::Remove { key: "s1".into() }, 0);
        assert_eq!(r.queue.len(), 2, "current song can't be removed");
        r.handle(&a, ClientMsg::Remove { key: "s2".into() }, 0);
        assert_eq!(r.queue.len(), 1, "host removes anyone's song");
    }

    #[test]
    fn device_rejoins_as_same_member_and_only_owner_or_host_moves() {
        let mut r = Room::new("ABCDEF".into(), "Test");
        let (a, c1) = r.add_member(Some("dev-a"), "A", Some(3), unbounded_channel().0);
        let b = join(&mut r, "B");
        assert_eq!(a, "dev-a");
        assert_eq!(r.member(&a).unwrap().color, 3);
        let (a2, c2) = r.add_member(Some("dev-a"), "A", Some(5), unbounded_channel().0);
        assert_eq!((a2.as_str(), r.members.len()), ("dev-a", 2));
        assert!(!r.remove_member(&a, c1), "the old connection's leave is ignored");
        assert!(r.member(&a).is_some() && r.host == a);

        r.handle(&a, ClientMsg::Add { track: track("s1") }, 0);
        r.handle(&b, ClientMsg::Add { track: track("s2") }, 0);
        r.handle(&a, ClientMsg::Add { track: track("s3") }, 0);
        r.handle(&b, ClientMsg::Move { from: 2, to: 1 }, 0);
        assert_eq!(r.queue[2].key, "s3", "B can't move A's song");
        r.handle(&b, ClientMsg::Move { from: 1, to: 2 }, 0);
        assert_eq!(r.queue[2].key, "s2", "B moves their own");
        r.handle(&a, ClientMsg::Move { from: 2, to: 1 }, 0);
        assert_eq!(r.queue[1].key, "s2", "host moves anyone's");
        assert!(!r.remove_member(&a, c2) && r.host == b);
    }

    #[test]
    fn guess_the_song_scores_and_resumes() {
        let mut r = Room::new("ABCDEF".into(), "Test");
        let a = join(&mut r, "A");
        let b = join(&mut r, "B");
        let c = join(&mut r, "C");
        for k in ["s1", "s2"] {
            r.handle(&a, ClientMsg::Add { track: track(k) }, 0);
            for m in [&a, &b, &c] {
                r.handle(m, ClientMsg::Ready { key: k.into() }, 0);
            }
        }
        r.handle(&a, ClientMsg::Play, 0);
        let decoys = vec![GameOpt { title: "x".into(), artist: None }, GameOpt { title: "s2".into(), artist: None }];
        r.handle(&a, ClientMsg::GameStart { key: "s2".into(), decoys }, 10_000);
        let g = r.game.as_ref().unwrap();
        assert_eq!((g.opts.len(), r.index, r.pos), (2, 1, 60.0), "the song's own title isn't a decoy");
        assert!(g.start > 0, "everyone had it: guessing starts with the music");
        let right = g.answer;
        r.handle(&a, ClientMsg::Next, 10_100);
        assert_eq!(r.index, 1, "no skipping during a round");
        r.handle(&c, ClientMsg::Guess { opt: right }, 12_000);
        r.handle(&b, ClientMsg::Guess { opt: right }, 13_000);
        let g = r.game.as_ref().unwrap();
        assert!(g.revealed_at.is_some(), "all answered");
        assert_eq!(g.results, vec![(c.clone(), 3), (b.clone(), 2)]);
        assert_eq!(r.scores[0].id, c);
        r.handle(&a, ClientMsg::GameClose, 14_000);
        assert!(r.game.is_some(), "too early");
        r.handle(&a, ClientMsg::GameClose, 13_000 + REVEAL_MS);
        assert!(r.game.is_none() && r.index == 0);
    }

    #[test]
    fn streaks_and_chat_reactions() {
        let mut r = Room::new("ABCDEF".into(), "Test");
        let a = join(&mut r, "A");
        let b = join(&mut r, "B");
        r.handle(&a, ClientMsg::Add { track: track("s1") }, 0);
        for (k, m) in [&a, &b, &a].into_iter().enumerate() {
            r.handle(m, ClientMsg::React { emoji: "🔥".into() }, k as i64 * 500);
        }
        assert_eq!(r.best_streak, 3);
        r.handle(&a, ClientMsg::Chat { text: "hi".into() }, 0);
        let id = r.chat.back().unwrap().id;
        r.handle(&b, ClientMsg::ChatReact { id, emoji: "😂".into() }, 0);
        assert_eq!(r.chat.back().unwrap().rx["😂"], vec![b.clone()]);
        r.handle(&b, ClientMsg::ChatEdit { id, text: "nope".into() }, 0);
        assert_eq!(r.chat.back().unwrap().text, "hi", "only the author edits");
        r.handle(&a, ClientMsg::ChatEdit { id, text: "hey".into() }, 0);
        assert!(r.chat.back().unwrap().edited);
    }
}
