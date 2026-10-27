//! Error type returned by request handlers.
//!
//! Details useful for debugging are logged; the client only ever sees a
//! short, stable error code (plus a message for its own bad input).

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    /// The request did not carry a valid ALB identity. The reason is logged only.
    #[error("unauthorized: {0}")]
    Unauthorized(String),
    /// The client sent something we reject; the message is safe to return.
    #[error("bad request: {0}")]
    BadRequest(String),
    /// A dependency (S3, AppConfig, ...) failed.
    #[error("dependency failure: {0:#}")]
    Dependency(anyhow::Error),
}

impl AppError {
    pub fn dependency(err: impl Into<anyhow::Error>) -> Self {
        Self::Dependency(err.into())
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code, message) = match &self {
            AppError::Unauthorized(reason) => {
                tracing::warn!(%reason, "rejected unauthenticated request");
                (StatusCode::UNAUTHORIZED, "unauthorized", None)
            }
            AppError::BadRequest(message) => (
                StatusCode::BAD_REQUEST,
                "bad_request",
                Some(message.clone()),
            ),
            AppError::Dependency(err) => {
                tracing::error!(error = format!("{err:#}"), "dependency failure");
                (
                    StatusCode::SERVICE_UNAVAILABLE,
                    "dependency_unavailable",
                    None,
                )
            }
        };
        (status, Json(json!({ "error": code, "message": message }))).into_response()
    }
}
