//! `GET /api/feature-flags` — flags for the web app and every module in
//! `APPS`, evaluated for the caller.

use axum::Json;
use axum::extract::State;
use futures::future::join_all;

use crate::model::{CurrentUser, FeatureFlags, FlagSet};
use crate::state::AppState;

pub async fn get(State(state): State<AppState>, user: CurrentUser) -> Json<FeatureFlags> {
    let (provider, user) = (&state.flags, &user);
    let lookups = state.apps.iter().map(|app| async move {
        let flags = provider.flags_for(app, user).await.unwrap_or_else(|error| {
            // One app's flags being unavailable must not break every other
            // app. The web app treats a missing kill switch as "enabled".
            tracing::warn!(app, error = format!("{error:#}"), "flags unavailable");
            FlagSet::new()
        });
        (app.clone(), flags)
    });
    Json(join_all(lookups).await.into_iter().collect())
}
