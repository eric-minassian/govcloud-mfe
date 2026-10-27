//! `POST /api/client-events` — errors reported by the browser.
//!
//! The shell reports remote-load failures and render errors here; each one
//! becomes a `ClientErrors` metric data point for the app that failed.

use std::collections::HashSet;

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;

use crate::error::AppError;
use crate::model::{ClientEvent, ClientEventBatch, CurrentUser};
use crate::state::AppState;

pub const MAX_EVENTS_PER_BATCH: usize = 20;
pub const MAX_BODY_BYTES: usize = 16 * 1024;
const MAX_MESSAGE_CHARS: usize = 500;

pub async fn post(
    State(state): State<AppState>,
    _user: CurrentUser,
    Json(batch): Json<ClientEventBatch>,
) -> Result<StatusCode, AppError> {
    let records = state.releases.list().await.map_err(AppError::dependency)?;
    let known_apps: HashSet<String> = records.into_iter().map(|r| r.app).collect();

    for event in accept_events(batch, &known_apps)? {
        state.metrics.record_client_error(&event);
    }
    Ok(StatusCode::ACCEPTED)
}

/// Applies the limits that keep this endpoint from being abused: batch size,
/// message length, and — most importantly — only apps that are actually
/// deployed, since `App` is a metric dimension and every new value is a new
/// (billed) CloudWatch metric.
pub fn accept_events(
    batch: ClientEventBatch,
    known_apps: &HashSet<String>,
) -> Result<Vec<ClientEvent>, AppError> {
    if batch.events.len() > MAX_EVENTS_PER_BATCH {
        return Err(AppError::BadRequest(format!(
            "at most {MAX_EVENTS_PER_BATCH} events per request"
        )));
    }
    let accepted = batch
        .events
        .into_iter()
        .filter(|event| known_apps.contains(&event.app))
        .map(|mut event| {
            event.message = event.message.chars().take(MAX_MESSAGE_CHARS).collect();
            event
        })
        .collect();
    Ok(accepted)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::ClientEventType;

    fn event(app: &str, message: &str) -> ClientEvent {
        ClientEvent {
            event_type: ClientEventType::RenderError,
            app: app.into(),
            version: None,
            message: message.into(),
        }
    }

    fn known() -> HashSet<String> {
        ["shell", "dashboard"].map(String::from).into()
    }

    #[test]
    fn drops_events_for_unknown_apps_and_truncates_messages() {
        let long = "x".repeat(MAX_MESSAGE_CHARS + 100);
        let batch = ClientEventBatch {
            events: vec![event("dashboard", &long), event("made-up-app", "boom")],
        };
        let accepted = accept_events(batch, &known()).unwrap();
        assert_eq!(accepted.len(), 1);
        assert_eq!(accepted[0].app, "dashboard");
        assert_eq!(accepted[0].message.chars().count(), MAX_MESSAGE_CHARS);
    }

    #[test]
    fn rejects_oversized_batches() {
        let batch = ClientEventBatch {
            events: vec![event("dashboard", "boom"); MAX_EVENTS_PER_BATCH + 1],
        };
        assert!(matches!(
            accept_events(batch, &known()),
            Err(AppError::BadRequest(_))
        ));
    }

    #[test]
    fn parses_the_contract_shape() {
        let batch: ClientEventBatch = serde_json::from_str(
            r#"{ "events": [{ "type": "module-load-failure", "app": "dashboard", "version": "abc", "message": "x" }] }"#,
        )
        .unwrap();
        assert_eq!(
            batch.events[0].event_type,
            ClientEventType::ModuleLoadFailure
        );
    }
}
