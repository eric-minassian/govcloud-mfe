//! `GET /api/auth/logout` — end the ALB session.
//!
//! The ALB has no logout endpoint. Per its documentation, the application
//! expires the session cookie (which the ALB may shard into up to four
//! cookies) and redirects to the IdP's logout endpoint, which in turn
//! redirects to an unauthenticated "signed out" page.

use axum::extract::State;
use axum::http::StatusCode;
use axum::http::header::{LOCATION, SET_COOKIE};
use axum::response::{AppendHeaders, IntoResponse};

use crate::model::CurrentUser;
use crate::state::AppState;

const SESSION_COOKIE_SHARDS: usize = 4;

pub async fn logout(State(state): State<AppState>, _user: CurrentUser) -> impl IntoResponse {
    let settings = &state.logout;
    let expired_cookies: Vec<_> = (0..SESSION_COOKIE_SHARDS)
        .map(|shard| {
            let cookie = format!(
                "{}-{shard}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; HttpOnly",
                settings.session_cookie_name
            );
            (SET_COOKIE, cookie)
        })
        .collect();
    let location = settings.redirect_url.clone().unwrap_or_else(|| "/".into());

    (
        StatusCode::FOUND,
        AppendHeaders(expired_cookies),
        [(LOCATION, location)],
    )
}
