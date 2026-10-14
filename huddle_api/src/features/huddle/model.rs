use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use tokio::sync::mpsc::UnboundedSender;

/// A song in the shared playlist, shared by its link: every member resolves and
/// downloads it from its source (`source` + `sourceId`) with their own app.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedTrack {
    /// `${source}:${sourceId}`.
    pub key: String,
    pub source: String,
    pub source_id: String,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    /// Seconds.
    pub duration: Option<f64>,
    pub artwork: Option<String>,
    /// Member id of who added it (set by the server).
    #[serde(default)]
    pub by: String,
    #[serde(default)]
    pub by_name: String,
    #[serde(default)]
    pub by_color: u8,
    /// For the room's vibe.
    #[serde(default)]
    pub genre: Option<String>,
    /// A short message from whoever added it, shown when it starts.
    #[serde(default)]
    pub shout: Option<String>,
}

pub struct Member {
    pub id: String,
    pub name: String,
    pub color: u8,
    pub tx: UnboundedSender<String>,
    /// Track keys this member has fully cached (or gave up on: they won't block the others).
    pub ready: HashSet<String>,
    /// Which connection this is: a device that reconnects replaces its old one.
    pub conn: u64,
    /// Reactions sent, all songs.
    pub reacts: u32,
    /// `"key emoji"` pairs this member reacted with (for taste match), newest last, up to 60.
    pub likes: VecDeque<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMsg {
    pub id: u64,
    pub at: i64,
    /// `msg`, `start`, `join`, `leave`, `add`, `move`, `emos`, `round`, `game`.
    pub kind: &'static str,
    pub who: String,
    pub name: String,
    pub color: u8,
    /// The message, or the argument of a system line (a title, a code, emojis).
    pub text: String,
    /// Reactions on a message: emoji → member ids.
    pub rx: BTreeMap<String, Vec<String>>,
    pub edited: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameOpt {
    pub title: String,
    #[serde(default)]
    pub artist: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Answer {
    pub who: String,
    pub opt: usize,
    pub at: i64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Score {
    pub id: String,
    pub name: String,
    pub color: u8,
    pub pts: u32,
}

/// A round of Guess the song: the mystery song plays, the others pick it from `opts`.
pub struct Game {
    pub by: String,
    pub by_name: String,
    pub by_color: u8,
    pub key: String,
    pub round: u32,
    pub opts: Vec<GameOpt>,
    pub answer: usize,
    /// Server time the guessing started (once everyone has the song), 0 before.
    pub start: i64,
    pub end: i64,
    pub answers: Vec<Answer>,
    pub revealed_at: Option<i64>,
    /// Points won this round, fastest right answer first.
    pub results: Vec<(String, u32)>,
    /// What to go back to afterwards.
    pub resume_key: Option<String>,
    pub resume_pos: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LastAction {
    pub name: String,
    pub color: u8,
    /// `played`, `paused`, `resumed`, `skipped`, `back`, `seek`.
    pub action: &'static str,
    pub arg: String,
    pub at: i64,
}

pub struct Room {
    pub code: String,
    pub name: String,
    pub host: String,
    pub members: Vec<Member>,
    pub queue: Vec<SharedTrack>,
    pub index: usize,
    /// Audio is running for everyone (from `at`).
    pub playing: bool,
    /// Play was pressed; it starts once every member has the song cached.
    pub pending: bool,
    /// Position in seconds at server time `at` (ms). While playing, `at` may be
    /// slightly in the future: everyone starts at that instant.
    pub pos: f64,
    pub at: i64,
    pub chat: VecDeque<ChatMsg>,
    pub chat_seq: u64,
    /// Reaction counts per track key.
    pub reactions: HashMap<String, HashMap<String, u32>>,
    pub emos: Vec<String>,
    pub last: Option<LastAction>,
    pub next_color: u8,
    /// When the last member left (ms). The huddle, its playlist and chat are
    /// kept for `EMPTY_TTL_SECS` so people can come back, then discarded.
    pub empty_since: Option<i64>,
    pub next_conn: u64,
    // For the recap.
    pub started: i64,
    /// Keys of the songs that played, in order, no repeats.
    pub played: Vec<String>,
    pub msgs: u32,
    pub best_streak: u32,
    /// Recent reactions (server ms, emoji), for streaks.
    pub rx_log: VecDeque<(i64, String)>,
    pub game: Option<Game>,
    pub rounds: u32,
    /// Guess the song points, kept when people leave.
    pub scores: Vec<Score>,
}

#[derive(Deserialize)]
#[serde(tag = "t", rename_all = "camelCase")]
pub enum ClientMsg {
    Ping { c: f64 },
    Play,
    Pause,
    Seek { pos: f64 },
    Next,
    Prev,
    Jump { index: usize },
    Ended { index: usize },
    Add { track: SharedTrack },
    Remove { key: String },
    Move { from: usize, to: usize },
    Ready { key: String },
    Chat { text: String },
    React { emoji: String },
    Emos { list: Vec<String> },
    ChatReact { id: u64, emoji: String },
    ChatEdit { id: u64, text: String },
    /// Starts a round with this song from the shared playlist and up to 3 decoys.
    GameStart { key: String, decoys: Vec<GameOpt> },
    Guess { opt: usize },
    /// Sent by everyone whose countdown ran out; the first in time reveals.
    GameEnd,
    /// Sent by everyone after the reveal; goes back to what was playing.
    GameClose,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberView<'a> {
    pub id: &'a str,
    pub name: &'a str,
    pub color: u8,
    /// Has the current song cached.
    pub ready: bool,
    pub reacts: u32,
    pub likes: &'a VecDeque<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameView<'a> {
    pub by: &'a str,
    pub by_name: &'a str,
    pub by_color: u8,
    pub round: u32,
    pub opts: &'a [GameOpt],
    pub start: i64,
    pub end: i64,
    pub phase: &'static str,
    /// Who has answered; what they picked only after the reveal.
    pub answered: Vec<&'a str>,
    pub picks: Option<&'a [Answer]>,
    pub answer: Option<usize>,
    pub results: Vec<GameResult<'a>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameResult<'a> {
    pub who: &'a str,
    pub pts: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mvp {
    pub name: String,
    pub color: u8,
    pub n: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recap<'a> {
    pub started: i64,
    pub played: &'a [String],
    pub msgs: u32,
    pub best_streak: u32,
    pub top_key: Option<&'a str>,
    pub top_n: u32,
    pub top_emoji: Option<&'a str>,
    pub top_emoji_n: u32,
    pub mvp: Option<Mvp>,
}

#[derive(Serialize)]
#[serde(tag = "t", rename_all = "camelCase")]
pub enum ServerMsg<'a> {
    #[serde(rename_all = "camelCase")]
    Welcome { you: &'a str, code: &'a str },
    #[serde(rename_all = "camelCase")]
    State {
        code: &'a str,
        name: &'a str,
        host: &'a str,
        members: Vec<MemberView<'a>>,
        queue: &'a [SharedTrack],
        index: usize,
        playing: bool,
        pending: bool,
        pos: f64,
        at: i64,
        chat: &'a VecDeque<ChatMsg>,
        reactions: Option<&'a HashMap<String, u32>>,
        emos: &'a [String],
        last: &'a Option<LastAction>,
        game: Option<GameView<'a>>,
        scores: &'a [Score],
        recap: Recap<'a>,
    },
    Pong { c: f64, s: i64 },
    #[serde(rename_all = "camelCase")]
    React { who: &'a str, name: &'a str, color: u8, emoji: &'a str, streak: u32 },
    /// `not_found`, `full`.
    Error { message: &'a str },
}

#[derive(Deserialize)]
pub struct WsQuery {
    pub name: String,
    /// Join this huddle…
    pub code: Option<String>,
    /// …or start one with this name.
    pub create: Option<String>,
    /// This device's id: the same member across reconnects.
    pub id: Option<String>,
    /// Chosen colour (index in the apps' palette).
    pub color: Option<u8>,
}
