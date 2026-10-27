//! `GET /api/feature-flags` — every app's flags, evaluated for the caller.

use axum::Json;
use axum::extract::State;
use futures::future::join_all;

use crate::error::AppError;
use crate::model::{CurrentUser, FeatureFlags, FlagSet};
use crate::state::AppState;

pub async fn get(
    State(state): State<AppState>,
    user: CurrentUser,
) -> Result<Json<FeatureFlags>, AppError> {
    let records = state.releases.list().await.map_err(AppError::dependency)?;

    let lookups = records.iter().map(|record| async {
        let flags = state
            .flags
            .flags_for(&record.app, &user)
            .await
            .unwrap_or_else(|error| {
                // One app's flags being unavailable must not break every other app.
                tracing::warn!(
                    app = record.app,
                    error = format!("{error:#}"),
                    "flags unavailable"
                );
                FlagSet::new()
            });
        (record.app.clone(), flags)
    });
    Ok(Json(join_all(lookups).await.into_iter().collect()))
}
