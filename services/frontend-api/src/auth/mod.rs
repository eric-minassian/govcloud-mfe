//! Who is calling? Handlers take a [`CurrentUser`] argument and this module
//! fills it in, or rejects the request with `401`.

pub mod alb;

use axum::extract::FromRequestParts;
use axum::http::HeaderMap;
use axum::http::request::Parts;

use crate::error::AppError;
use crate::model::CurrentUser;
use crate::state::AppState;
use alb::AlbTokenVerifier;

/// The only identity header we trust. The ALB also sends `x-amzn-oidc-identity`
/// and `x-amzn-oidc-accesstoken`, but those are unsigned.
const ALB_IDENTITY_HEADER: &str = "x-amzn-oidc-data";

pub enum Authenticator {
    Alb(AlbTokenVerifier),
    /// Local development only (enforced in config): every request is this user.
    LocalDev,
}

impl Authenticator {
    pub async fn authenticate(&self, headers: &HeaderMap) -> Result<CurrentUser, AppError> {
        match self {
            Authenticator::Alb(verifier) => {
                let token = headers
                    .get(ALB_IDENTITY_HEADER)
                    .and_then(|v| v.to_str().ok())
                    .ok_or_else(|| {
                        AppError::Unauthorized(format!("missing {ALB_IDENTITY_HEADER}"))
                    })?;
                verifier
                    .verify(token)
                    .await
                    .map_err(|e| AppError::Unauthorized(e.to_string()))
            }
            Authenticator::LocalDev => Ok(local_dev_user()),
        }
    }
}

fn local_dev_user() -> CurrentUser {
    CurrentUser {
        sub: "local-dev-user".into(),
        email: Some("developer@example.gov".into()),
        name: Some("Local Developer".into()),
        groups: vec!["developers".into()],
    }
}

impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        state.auth.authenticate(&parts.headers).await
    }
}
