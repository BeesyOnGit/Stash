//! The huddle itself: shared playlist, shared controls and the playback clock.
//!
//! Playback is gated on caching: pressing play (or moving to another song)
//! only starts the audio once every member has the song fully on their device.
//! It then starts `LEAD_MS` in the future so everyone begins at the same instant
//! (clients map server time to their own clock with ping/pong).

use super::model::{ChatMsg, ClientMsg, LastAction, Member, MemberView, Room, ServerMsg, SharedTrack};
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
        }
    }

    pub fn add_member(&mut self, name: &str, tx: UnboundedSender<String>) -> String {
        let id = uuid::Uuid::new_v4().simple().to_string()[..12].to_string();
        let name = clip(name, 24);
        let name = if name.is_empty() { "Guest".to_string() } else { name };
        let color = self.next_color;
        self.next_color = self.next_color.wrapping_add(1);
        if self.host.is_empty() {
            self.host = id.clone();
        }
        self.empty_since = None;
        let kind = if self.members.is_empty() { "start" } else { "join" };
        self.members.push(Member { id: id.clone(), name, color, tx, ready: HashSet::new() });
        let arg = if kind == "start" { self.code.clone() } else { String::new() };
        self.sys(&id, kind, arg);
        id
    }

    /// Returns true when the room is now empty (it's kept a while, see `empty_since`).
    pub fn remove_member(&mut self, id: &str) -> bool {
        self.sys(id, "leave", String::new());
        self.members.retain(|m| m.id != id);
        if self.members.is_empty() {
            let now = now_ms();
            self.pause_at(now);
            self.host.clear();
            self.empty_since = Some(now);
            return true;
        }
        if self.host == id {
            self.host = self.members[0].id.clone();
        }
        // They may have been the one everyone was waiting for.
        self.try_start(now_ms());
        false
    }

    pub fn member(&self, id: &str) -> Option<&Member> {
        self.members.iter().find(|m| m.id == id)
    }

    fn sys(&mut self, who: &str, kind: &'static str, text: String) {
        let (name, color) = self.member(who).map(|m| (m.name.clone(), m.color)).unwrap_or_default();
        self.chat_seq += 1;
        self.chat.push_back(ChatMsg { id: self.chat_seq, at: now_ms(), kind, who: who.to_string(), name, color, text });
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

    fn pause_at(&mut self, now: i64) {
        self.pos = self.position(now);
        self.at = now;
        self.playing = false;
        self.pending = false;
    }

    /// Applies one message. Returns `(reply to the sender only, state changed)`.
    pub fn handle(&mut self, who: &str, msg: ClientMsg, now: i64) -> (Option<String>, bool) {
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
                let title = track.title.clone();
                self.queue.push(track);
                self.sys(who, "add", title);
            }
            ClientMsg::Remove { key } => {
                let Some(i) = self.queue.iter().position(|t| t.key == key) else { return (None, false) };
                if i == self.index || (self.queue[i].by != who && self.host != who) {
                    return (None, false);
                }
                let t = self.queue.remove(i);
                if i < self.index {
                    self.index -= 1;
                }
                self.reactions.remove(&t.key);
            }
            ClientMsg::Move { from, to } => {
                if from >= self.queue.len() || to >= self.queue.len() || from == to {
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
                self.sys(who, "msg", text);
            }
            ClientMsg::React { emoji } => {
                if !self.emos.contains(&emoji) {
                    return (None, false);
                }
                let Some(key) = self.current().map(|t| t.key.clone()) else { return (None, false) };
                *self.reactions.entry(key).or_default().entry(emoji.clone()).or_default() += 1;
                if let Some(m) = self.member(who) {
                    let ev = to_json(&ServerMsg::React { who, name: &m.name, color: m.color, emoji: &emoji });
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
                .map(|m| MemberView { id: &m.id, name: &m.name, color: m.color, ready: key.is_some_and(|k| m.ready.contains(k)) })
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
        })
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
        }
    }

    #[test]
    fn play_waits_for_everyone_then_starts_in_step() {
        let mut r = Room::new("ABCDEF".into(), "Test");
        let a = r.add_member("A", unbounded_channel().0);
        let b = r.add_member("B", unbounded_channel().0);
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
        let c = r.add_member("C", unbounded_channel().0);
        r.handle(&a, ClientMsg::Jump { index: 1 }, end + 20);
        assert!(r.pending);
        assert!(!r.remove_member(&c));
        assert!(r.playing);

        // Everyone gone: paused and marked empty; the next one in is host.
        r.remove_member(&a);
        assert!(r.remove_member(&b));
        assert!(!r.playing && r.empty_since.is_some());
        let d = r.add_member("D", unbounded_channel().0);
        assert!(r.empty_since.is_none() && r.host == d);
    }

    #[test]
    fn pause_keeps_position_and_only_owner_or_host_removes() {
        let mut r = Room::new("ABCDEF".into(), "Test");
        let a = r.add_member("A", unbounded_channel().0);
        let b = r.add_member("B", unbounded_channel().0);
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
}
