use super::{controller::ws_controller, voice::voice_controller};
use axum::{Router, routing::get};

/// Public: a huddle is reached with its code.
pub fn huddle_routes() -> Router {
    Router::new()
        .route("/huddles/ws", get(ws_controller))
        .route("/huddles/{code}/voice", get(voice_controller))
        .route("/health", get(|| async { "ok" }))
}
