use super::model::{ClientMsg, Room, ServerMsg, WsQuery};
use super::service::{MAX_MEMBERS, new_code, now_ms, to_json};
use crate::config::app_state::ROOMS;
use axum::{
    extract::{
        Query, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    response::IntoResponse,
};
use std::time::Duration;
use tokio::sync::mpsc::unbounded_channel;
use tracing::info;

/// A member silent this long (the app pings every 10 s) is dropped.
const IDLE: Duration = Duration::from_secs(45);

/// `GET /huddles/ws?name=…&create=…` starts a huddle, `?name=…&code=…` joins one.
pub async fn ws_controller(ws: WebSocketUpgrade, Query(q): Query<WsQuery>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| run_member(socket, q))
}

async fn run_member(mut socket: WebSocket, q: WsQuery) {
    let (tx, mut rx) = unbounded_channel::<String>();

    // Join or create, under the lock; nothing awaits while it's held.
    let joined: Result<(String, String, u64), &'static str> = {
        let mut rooms = ROOMS.lock().unwrap();
        let code = match (&q.code, &q.create) {
            (Some(c), _) => Ok(c.trim().to_uppercase()),
            (None, Some(name)) => {
                let code = new_code(|c| rooms.contains_key(c));
                rooms.insert(code.clone(), Room::new(code.clone(), name));
                info!("Huddle {code} started");
                Ok(code)
            }
            _ => Err("not_found"),
        };
        code.and_then(|code| match rooms.get_mut(&code) {
            None => Err("not_found"),
            Some(r) if r.members.len() >= MAX_MEMBERS => Err("full"),
            Some(r) => {
                let (id, conn) = r.add_member(q.id.as_deref(), &q.name, q.color, tx);
                r.broadcast_state();
                Ok((code, id, conn))
            }
        })
    };
    let (code, me, conn) = match joined {
        Ok(j) => j,
        Err(message) => {
            let _ = socket.send(Message::Text(to_json(&ServerMsg::Error { message }).into())).await;
            return;
        }
    };
    // The welcome goes before the state queued by broadcast_state above.
    let welcome = to_json(&ServerMsg::Welcome { you: &me, code: &code });
    if socket.send(Message::Text(welcome.into())).await.is_err() {
        leave(&code, &me, conn);
        return;
    }

    loop {
        tokio::select! {
            out = rx.recv() => match out {
                Some(text) => if socket.send(Message::Text(text.into())).await.is_err() { break },
                None => break,
            },
            incoming = tokio::time::timeout(IDLE, socket.recv()) => {
                let text = match incoming {
                    Ok(Some(Ok(Message::Text(t)))) => t,
                    Ok(Some(Ok(Message::Close(_)))) | Ok(None) | Ok(Some(Err(_))) | Err(_) => break,
                    Ok(Some(Ok(_))) => continue, // ping/pong frames are answered by axum
                };
                let Ok(msg) = serde_json::from_str::<ClientMsg>(&text) else { continue };
                let reply = {
                    let mut rooms = ROOMS.lock().unwrap();
                    let Some(room) = rooms.get_mut(&code) else { break };
                    let (reply, changed) = room.handle(&me, msg, now_ms());
                    if changed {
                        room.broadcast_state();
                    }
                    reply
                };
                if let Some(r) = reply {
                    if socket.send(Message::Text(r.into())).await.is_err() { break }
                }
            }
        }
    }
    leave(&code, &me, conn);
}

fn leave(code: &str, me: &str, conn: u64) {
    let mut rooms = ROOMS.lock().unwrap();
    let Some(room) = rooms.get_mut(code) else { return };
    if !room.remove_member(me, conn) {
        room.broadcast_state();
    }
}
