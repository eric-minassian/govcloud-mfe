//! `GET /api/me` — the authenticated caller.

use axum::Json;

use crate::model::CurrentUser;

pub async fn me(user: CurrentUser) -> Json<CurrentUser> {
    Json(user)
}
