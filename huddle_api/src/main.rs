mod config;
mod features;

use axum::{Router, serve};
use dotenvy::dotenv;
use config::app_state::{EMPTY_TTL_MS, ROOMS};
use features::huddle::{routes::huddle_routes, service::now_ms};
use std::env;
use tower_http::{
    cors::{Any, CorsLayer},
    trace::{DefaultMakeSpan, DefaultOnResponse, TraceLayer},
};
use tracing::{Level, error, info};
use tracing_subscriber::{EnvFilter, FmtSubscriber};

#[tokio::main]
async fn main() {
    dotenv().ok();

    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("huddle_api=info,tower_http=info"));
    let subscriber = FmtSubscriber::builder().with_env_filter(filter).finish();
    tracing::subscriber::set_global_default(subscriber).expect("setting default subscriber failed");

    let port = env::var("PORT").unwrap_or_else(|_| "8080".into());
    tokio::spawn(sweep_empty_rooms());

    let app = Router::new()
        .merge(huddle_routes())
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(DefaultMakeSpan::new().level(Level::INFO))
                .on_response(DefaultOnResponse::new().level(Level::INFO)),
        )
        .layer(CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any));

    let listener = match tokio::net::TcpListener::bind(format!("0.0.0.0:{port}")).await {
        Ok(l) => l,
        Err(e) => {
            error!("Failed to bind to port {port}: {e:?}");
            return;
        }
    };
    info!("Huddle server listening on port {port}");
    if let Err(e) = serve(listener, app).await {
        error!("Server error: {e}");
    }
}

/// Discards huddles that stayed empty longer than EMPTY_TTL_SECS: playlist and chat.
async fn sweep_empty_rooms() {
    let mut every = tokio::time::interval(std::time::Duration::from_secs(30));
    loop {
        every.tick().await;
        let now = now_ms();
        ROOMS.lock().unwrap().retain(|code, r| {
            let keep = r.empty_since.is_none_or(|t| now - t < *EMPTY_TTL_MS);
            if !keep {
                info!("Huddle {code} discarded after being empty");
            }
            keep
        });
    }
}
