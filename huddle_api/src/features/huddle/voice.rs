//! Voice chat: the media goes through LiveKit (its own container); this only
//! hands out LiveKit access tokens, and only to current members of the huddle.

use super::model::Room;
use crate::config::app_state::ROOMS;
use axum::{
    Json,
    extract::{Path, Query},
    http::StatusCode,
};
use jsonwebtoken::{EncodingKey, Header, encode};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, env};

/// Clients ask for a new token whenever they (re)join voice.
const TOKEN_SECS: i64 = 600;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoGrant {
    pub room: String,
    pub room_join: bool,
    pub can_publish: bool,
    pub can_subscribe: bool,
    pub can_publish_sources: Vec<String>,
}

/// LiveKit's access token claims (an HS256 JWT signed with the API secret).
#[derive(Serialize, Deserialize)]
pub struct Claims {
    pub iss: String,
    pub sub: String,
    pub name: String,
    pub nbf: i64,
    pub exp: i64,
    pub video: VideoGrant,
}

#[derive(Serialize)]
pub struct VoiceAccess {
    pub url: String,
    pub token: String,
}

#[derive(Deserialize)]
pub struct VoiceQuery {
    pub id: String,
}

pub struct LiveKit {
    pub url: String,
    pub key: String,
    pub secret: String,
}

/// A token for member `id` of huddle `code`; `None` if there's no such member.
pub fn voice_token(rooms: &HashMap<String, Room>, code: &str, id: &str, lk: &LiveKit, now_s: i64) -> Option<String> {
    let code = code.trim().to_uppercase();
    let member = rooms.get(&code)?.member(id)?;
    let claims = Claims {
        iss: lk.key.clone(),
        sub: member.id.clone(),
        name: member.name.clone(),
        nbf: now_s - 10,
        exp: now_s + TOKEN_SECS,
        video: VideoGrant {
            room: code,
            room_join: true,
            can_publish: true,
            can_subscribe: true,
            can_publish_sources: vec!["microphone".into()],
        },
    };
    encode(&Header::default(), &claims, &EncodingKey::from_secret(lk.secret.as_bytes())).ok()
}

/// `GET /huddles/{code}/voice?id=<device id>` → `{ url, token }`.
pub async fn voice_controller(Path(code): Path<String>, Query(q): Query<VoiceQuery>) -> Result<Json<VoiceAccess>, StatusCode> {
    let lk = LiveKit {
        url: env::var("LIVEKIT_URL").unwrap_or_default(),
        key: env::var("LIVEKIT_API_KEY").unwrap_or_default(),
        secret: env::var("LIVEKIT_API_SECRET").unwrap_or_default(),
    };
    if lk.url.is_empty() || lk.key.is_empty() || lk.secret.is_empty() {
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }
    let now_s = super::service::now_ms() / 1000;
    let token = voice_token(&ROOMS.lock().unwrap(), &code, &q.id, &lk, now_s).ok_or(StatusCode::FORBIDDEN)?;
    Ok(Json(VoiceAccess { url: lk.url, token }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use jsonwebtoken::{DecodingKey, Validation, decode};
    use tokio::sync::mpsc::unbounded_channel;

    fn lk() -> LiveKit {
        LiveKit { url: "wss://voice.test".into(), key: "key".into(), secret: "secret".into() }
    }

    fn rooms_with(name: &str) -> (HashMap<String, Room>, String) {
        let mut r = Room::new("ABCDEF".into(), "Test");
        let id = r.add_member(Some("dev-1"), name, None, unbounded_channel().0).0;
        (HashMap::from([("ABCDEF".to_string(), r)]), id)
    }

    #[test]
    fn member_gets_a_token_for_its_room() {
        let (rooms, id) = rooms_with("Sam");
        let now = super::super::service::now_ms() / 1000;
        let token = voice_token(&rooms, "abcdef", &id, &lk(), now).expect("member gets a token");
        let mut v = Validation::default();
        v.set_issuer(&["key"]);
        let c = decode::<Claims>(&token, &DecodingKey::from_secret(b"secret"), &v).unwrap().claims;
        assert_eq!(c.sub, "dev-1");
        assert_eq!(c.name, "Sam");
        assert_eq!(c.video.room, "ABCDEF");
        assert!(c.video.room_join && c.video.can_publish && c.video.can_subscribe);
        assert_eq!(c.video.can_publish_sources, vec!["microphone"]);
        assert_eq!(c.exp - now, TOKEN_SECS);
    }

    #[test]
    fn non_members_and_unknown_codes_are_refused() {
        let (rooms, id) = rooms_with("Sam");
        assert!(voice_token(&rooms, "ABCDEF", "someone-else", &lk(), 0).is_none());
        assert!(voice_token(&rooms, "ZZZZZZ", &id, &lk(), 0).is_none());
    }
}
