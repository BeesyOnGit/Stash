use crate::features::huddle::model::Room;
use once_cell::sync::Lazy;
use std::{collections::HashMap, env, sync::Mutex};

/// Every live huddle, by invite code. Nothing is persisted: a restart ends them all.
// ponytail: one global lock for all rooms; per-room locks if hundreds of huddles run at once
pub static ROOMS: Lazy<Mutex<HashMap<String, Room>>> = Lazy::new(|| Mutex::new(HashMap::new()));

/// An empty huddle (playlist, chat and all) is discarded after this long.
pub static EMPTY_TTL_MS: Lazy<i64> =
    Lazy::new(|| env::var("EMPTY_TTL_SECS").ok().and_then(|v| v.parse().ok()).unwrap_or(300i64) * 1000);
