//! HTTP routes. Everything lives under `/api`, which the ALB routes to this
//! service; every other path goes to nginx and the static assets.

mod auth;
mod client_events;
mod feature_flags;
mod health;
mod me;
mod preferences;

use std::time::Duration;

use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::http::header::CACHE_CONTROL;
use axum::http::{HeaderValue, StatusCode};
use axum::routing::{get, post};
use tower_http::csrf::CsrfLayer;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::timeout::TimeoutLayer;
use tower_http::trace::TraceLayer;

use crate::state::AppState;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_REQUEST_BODY_BYTES: usize = 64 * 1024;

pub fn router(state: AppState) -> Router {
    let api = Router::new()
        .route("/health", get(health::health))
        .route("/me", get(me::me))
        .route("/feature-flags", get(feature_flags::get))
        .route("/preferences", get(preferences::get).put(preferences::put))
        .route(
            "/client-events",
            post(client_events::post).layer(DefaultBodyLimit::max(client_events::MAX_BODY_BYTES)),
        )
        .route("/auth/logout", get(auth::logout));

    Router::new()
        .nest("/api", api)
        // Rejects cross-site state-changing requests using `Sec-Fetch-Site`
        // (falling back to `Origin` vs `Host`). The ALB session cookie is
        // sent on every request, so this is our CSRF defence.
        .layer(CsrfLayer::new())
        // API responses are per-user and must never be cached by the browser.
        .layer(SetResponseHeaderLayer::overriding(
            CACHE_CONTROL,
            HeaderValue::from_static("no-store"),
        ))
        .layer(TimeoutLayer::with_status_code(
            StatusCode::SERVICE_UNAVAILABLE,
            REQUEST_TIMEOUT,
        ))
        .layer(RequestBodyLimitLayer::new(MAX_REQUEST_BODY_BYTES))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;
    use axum::body::Body;
    use axum::http::Request;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    fn local_app() -> Router {
        let config = Config::from_lookup(|name| match name {
            "APP_ENV" => Some("local".into()),
            "LOCAL_REPO_ROOT" => Some(concat!(env!("CARGO_MANIFEST_DIR"), "/../..").into()),
            _ => None,
        })
        .unwrap();
        router(AppState::from_config(&config).unwrap())
    }

    async fn body_json(response: axum::response::Response) -> serde_json::Value {
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn feature_flags_cover_every_app_and_are_not_cacheable() {
        let response = local_app()
            .oneshot(
                Request::get("/api/feature-flags")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[CACHE_CONTROL], "no-store");
        let flags = body_json(response).await;
        assert_eq!(flags["web"]["environmentBanner"]["enabled"], true);
        assert_eq!(flags["dashboard"]["moduleEnabled"]["enabled"], true);
        assert_eq!(flags["settings"]["moduleEnabled"]["enabled"], true);
    }

    #[tokio::test]
    async fn there_is_no_module_registry() {
        let response = local_app()
            .oneshot(Request::get("/api/modules").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn client_events_are_accepted_for_known_apps() {
        let request = Request::post("/api/client-events")
            .header("content-type", "application/json")
            .header("sec-fetch-site", "same-origin")
            .body(Body::from(
                r#"{"events":[{"type":"render-error","app":"evil","message":"x"}]}"#,
            ))
            .unwrap();
        let response = local_app().oneshot(request).await.unwrap();
        // Unknown apps are dropped silently; the batch itself is accepted.
        assert_eq!(response.status(), StatusCode::ACCEPTED);
    }

    #[tokio::test]
    async fn cross_site_writes_are_rejected() {
        let request = Request::put("/api/preferences")
            .header("content-type", "application/json")
            .header("sec-fetch-site", "cross-site")
            .body(Body::from(
                r#"{"theme":"dark","density":"compact","pinnedModules":[]}"#,
            ))
            .unwrap();
        let response = local_app().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn same_origin_writes_are_accepted() {
        let request = Request::put("/api/preferences")
            .header("content-type", "application/json")
            .header("sec-fetch-site", "same-origin")
            .body(Body::from(
                r#"{"theme":"dark","density":"compact","pinnedModules":["dashboard"]}"#,
            ))
            .unwrap();
        let response = local_app().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(body_json(response).await["pinnedModules"][0], "dashboard");
    }

    #[tokio::test]
    async fn logout_expires_every_session_cookie_shard() {
        let response = local_app()
            .oneshot(
                Request::get("/api/auth/logout")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FOUND);
        let cookies: Vec<_> = response.headers().get_all("set-cookie").iter().collect();
        assert_eq!(cookies.len(), 4);
        assert!(
            cookies[3]
                .to_str()
                .unwrap()
                .starts_with("govcloud-mfe-session-3=;")
        );
    }
}
