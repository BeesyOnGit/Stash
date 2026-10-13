use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
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
}

pub struct Member {
    pub id: String,
    pub name: String,
    pub color: u8,
    pub tx: UnboundedSender<String>,
    /// Track keys this member has fully cached (or gave up on: they won't block the others).
    pub ready: HashSet<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMsg {
    pub id: u64,
    pub at: i64,
    /// `msg`, `start`, `join`, `leave`, `add`, `move`, `emos`.
    pub kind: &'static str,
    pub who: String,
    pub name: String,
    pub color: u8,
    /// The message, or the argument of a system line (a title, a code, emojis).
    pub text: String,
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
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberView<'a> {
    pub id: &'a str,
    pub name: &'a str,
    pub color: u8,
    /// Has the current song cached.
    pub ready: bool,
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
    },
    Pong { c: f64, s: i64 },
    #[serde(rename_all = "camelCase")]
    React { who: &'a str, name: &'a str, color: u8, emoji: &'a str },
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
}
