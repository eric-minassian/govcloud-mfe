//! Same-origin "frontend API" for the web app.
//!
//! Runs behind the ALB on `/api/*`, next to nginx serving the static assets.
//! It owns the APIs only the UI needs: who the user is, feature flags, UI
//! preferences and client error telemetry. Which modules exist is decided
//! when the web app is built, so there is no module registry here.

mod auth;
mod config;
mod error;
mod flags;
mod metrics;
mod model;
mod preferences;
mod routes;
mod state;

use tokio::net::TcpListener;
use tokio::signal::unix::{SignalKind, signal};
use tracing_subscriber::EnvFilter;

use crate::config::{AppEnv, Config};
use crate::state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config = Config::from_env()?;
    init_tracing(config.app_env);

    let state = AppState::from_config(&config)?;
    let app = routes::router(state);

    let listener = TcpListener::bind(("0.0.0.0", config.port)).await?;
    tracing::info!(port = config.port, env = ?config.app_env, "frontend-api listening");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

/// JSON logs in AWS (queryable in CloudWatch Logs Insights), readable text locally.
fn init_tracing(app_env: AppEnv) {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,tower_http=info,aws_config=warn"));
    let subscriber = tracing_subscriber::fmt().with_env_filter(filter);
    match app_env {
        AppEnv::Aws => subscriber.json().flatten_event(true).init(),
        AppEnv::Local => subscriber.compact().init(),
    }
}

/// ECS sends SIGTERM when draining a task; finish in-flight requests first.
async fn shutdown_signal() {
    let mut terminate = signal(SignalKind::terminate()).expect("install SIGTERM handler");
    tokio::select! {
        _ = terminate.recv() => {},
        _ = tokio::signal::ctrl_c() => {},
    }
    tracing::info!("shutdown signal received, draining connections");
}
