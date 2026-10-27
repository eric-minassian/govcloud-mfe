//! `GET` / `PUT /api/preferences` — the caller's UI preferences.

use axum::Json;
use axum::extract::State;

use crate::error::AppError;
use crate::model::{CurrentUser, UserPreferences};
use crate::state::AppState;

const MAX_PINNED_MODULES: usize = 20;
const MAX_MODULE_NAME_LEN: usize = 64;

pub async fn get(
    State(state): State<AppState>,
    user: CurrentUser,
) -> Result<Json<UserPreferences>, AppError> {
    let preferences = state
        .preferences
        .get(&user.sub)
        .await
        .map_err(AppError::dependency)?;
    Ok(Json(preferences))
}

pub async fn put(
    State(state): State<AppState>,
    user: CurrentUser,
    Json(preferences): Json<UserPreferences>,
) -> Result<Json<UserPreferences>, AppError> {
    validate(&preferences)?;
    state
        .preferences
        .put(&user.sub, preferences.clone())
        .await
        .map_err(AppError::dependency)?;
    Ok(Json(preferences))
}

fn validate(preferences: &UserPreferences) -> Result<(), AppError> {
    if preferences.pinned_modules.len() > MAX_PINNED_MODULES {
        return Err(AppError::BadRequest(format!(
            "at most {MAX_PINNED_MODULES} pinned modules"
        )));
    }
    if preferences
        .pinned_modules
        .iter()
        .any(|name| name.is_empty() || name.len() > MAX_MODULE_NAME_LEN)
    {
        return Err(AppError::BadRequest("invalid pinned module name".into()));
    }
    Ok(())
}
