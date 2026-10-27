//! `GET /api/health` — ALB target health check.
//!
//! Deliberately shallow: if AppConfig has a blip we want degraded
//! responses, not every task pulled out of the target group at once.

use axum::Json;
use serde_json::{Value, json};

pub async fn health() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}
