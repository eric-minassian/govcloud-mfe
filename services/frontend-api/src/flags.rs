//! Feature flags, one AppConfig application per app (docs/contracts.md §7).
//!
//! In AWS we read flags through the AppConfig Agent sidecar. The agent owns
//! session management, polling and caching, and evaluates multi-variant flags
//! against the caller context we pass in `Context` headers — so this service
//! never calls the AppConfig APIs itself.

use std::io::ErrorKind;
use std::path::PathBuf;
use std::time::Duration;

use anyhow::Context;
use async_trait::async_trait;
use serde_json::{Map, Value};

use crate::model::{CurrentUser, FlagSet};

#[async_trait]
pub trait FlagProvider: Send + Sync {
    /// Flags for `app`, evaluated for `user`.
    async fn flags_for(&self, app: &str, user: &CurrentUser) -> anyhow::Result<FlagSet>;
}

/// Reads flags from the AppConfig Agent running next to this container.
pub struct AppConfigAgentFlags {
    client: reqwest::Client,
    agent_url: String,
    application_prefix: String,
    environment: String,
    profile: String,
}

impl AppConfigAgentFlags {
    pub fn new(
        agent_url: impl Into<String>,
        application_prefix: impl Into<String>,
        environment: impl Into<String>,
        profile: impl Into<String>,
    ) -> reqwest::Result<Self> {
        // The agent answers from memory; anything slower than this is a fault.
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(2))
            .build()?;
        Ok(Self {
            client,
            agent_url: agent_url.into().trim_end_matches('/').to_owned(),
            application_prefix: application_prefix.into(),
            environment: environment.into(),
            profile: profile.into(),
        })
    }

    fn url(&self, app: &str) -> String {
        format!(
            "{}/applications/{}{app}/environments/{}/configurations/{}",
            self.agent_url, self.application_prefix, self.environment, self.profile
        )
    }
}

#[async_trait]
impl FlagProvider for AppConfigAgentFlags {
    async fn flags_for(&self, app: &str, user: &CurrentUser) -> anyhow::Result<FlagSet> {
        // Context values feed multi-variant rules such as
        // `(split by::$userId pct::25)` or `(ends_with $email "@qa.example.gov")`.
        let mut request = self
            .client
            .get(self.url(app))
            .header("Context", format!("userId={}", user.sub));
        if let Some(email) = &user.email {
            request = request.header("Context", format!("email={email}"));
        }
        let response = request
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .with_context(|| format!("fetching flags for {app} from AppConfig Agent"))?;
        Ok(response.json().await?)
    }
}

/// Reads flag *definitions* straight from the repository for local
/// development, so the files the pipelines deploy are the single source of
/// truth: `modules/<app>/feature-flags.json` for a team's module, and
/// `apps/<app>/feature-flags.json` for the web app itself.
pub struct LocalFlags {
    repo_root: PathBuf,
}

impl LocalFlags {
    pub fn new(repo_root: impl Into<PathBuf>) -> Self {
        Self {
            repo_root: repo_root.into(),
        }
    }
}

#[async_trait]
impl FlagProvider for LocalFlags {
    async fn flags_for(&self, app: &str, _user: &CurrentUser) -> anyhow::Result<FlagSet> {
        for dir in ["modules", "apps"] {
            let path = self
                .repo_root
                .join(dir)
                .join(app)
                .join("feature-flags.json");
            match tokio::fs::read(&path).await {
                Ok(bytes) => return Ok(resolve_default_values(&serde_json::from_slice(&bytes)?)),
                Err(error) if error.kind() == ErrorKind::NotFound => continue,
                Err(error) => {
                    return Err(error).with_context(|| format!("reading {}", path.display()));
                }
            }
        }
        anyhow::bail!("no feature-flags.json for {app} in modules/ or apps/")
    }
}

/// Turns an `AWS.AppConfig.FeatureFlags` definition document into the
/// evaluated shape AppConfig returns: `{ flag: { enabled, ...attributes } }`.
///
/// Multi-variant flags resolve to their default variant (the one without a
/// rule), as AppConfig does when the caller context matches no rule. Like
/// AppConfig, attributes are only included for enabled flags.
pub fn resolve_default_values(definition: &Value) -> FlagSet {
    let Some(values) = definition.get("values").and_then(Value::as_object) else {
        return FlagSet::new();
    };
    values
        .iter()
        .map(|(key, value)| {
            let resolved = match value.get("_variants").and_then(Value::as_array) {
                Some(variants) => resolve_default_variant(variants),
                None => evaluated(value.as_object().cloned().unwrap_or_default(), None),
            };
            (key.clone(), Value::Object(resolved))
        })
        .collect()
}

fn resolve_default_variant(variants: &[Value]) -> Map<String, Value> {
    let Some(default) = variants.iter().find(|v| v.get("rule").is_none()) else {
        return evaluated(Map::new(), None);
    };
    let mut attributes = default
        .get("attributeValues")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    attributes.insert(
        "enabled".into(),
        default.get("enabled").cloned().unwrap_or(false.into()),
    );
    evaluated(attributes, default.get("name").cloned())
}

/// Normalises a flag value: drops metadata (`_createdAt`, ...), defaults
/// `enabled` to false and strips attributes from disabled flags.
fn evaluated(mut value: Map<String, Value>, variant: Option<Value>) -> Map<String, Value> {
    value.retain(|key, _| !key.starts_with('_'));
    let enabled = value
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if !enabled {
        value.clear();
    }
    value.insert("enabled".into(), enabled.into());
    if let Some(name) = variant {
        value.insert("_variant".into(), name);
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn resolves_plain_flags_and_strips_metadata() {
        let flags = resolve_default_values(&json!({
            "version": "1",
            "values": {
                "banner": { "enabled": true, "message": "hi", "_updatedAt": "2026-01-01" },
                "off": { "enabled": false, "message": "hidden" }
            }
        }));
        assert_eq!(flags["banner"], json!({ "enabled": true, "message": "hi" }));
        assert_eq!(flags["off"], json!({ "enabled": false }));
    }

    #[test]
    fn multi_variant_flags_resolve_to_the_variant_without_a_rule() {
        let flags = resolve_default_values(&json!({
            "version": "1",
            "values": {
                "timeline": { "_variants": [
                    { "name": "QA", "enabled": true, "rule": "(ends_with $email \"@qa\")" },
                    { "name": "Default", "enabled": true, "attributeValues": { "limit": 5 } }
                ]}
            }
        }));
        assert_eq!(
            flags["timeline"],
            json!({ "enabled": true, "limit": 5, "_variant": "Default" })
        );
    }

    fn repo_flags() -> LocalFlags {
        LocalFlags::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."))
    }

    fn user() -> CurrentUser {
        CurrentUser {
            sub: "u".into(),
            email: None,
            name: None,
            groups: vec![],
        }
    }

    #[tokio::test]
    async fn reads_a_modules_flags_from_modules_dir() {
        let flags = repo_flags().flags_for("dashboard", &user()).await.unwrap();
        assert_eq!(flags["moduleEnabled"]["enabled"], json!(true));
        assert_eq!(
            flags["releaseTimeline"],
            json!({ "enabled": false, "_variant": "Default" })
        );
    }

    #[tokio::test]
    async fn falls_back_to_apps_dir_for_the_web_app() {
        let flags = repo_flags().flags_for("web", &user()).await.unwrap();
        assert_eq!(flags["environmentBanner"]["enabled"], json!(true));
    }

    #[tokio::test]
    async fn unknown_apps_are_an_error() {
        let error = repo_flags()
            .flags_for("nosuchapp", &user())
            .await
            .unwrap_err();
        assert!(error.to_string().contains("nosuchapp"));
    }

    #[test]
    fn agent_url_follows_the_naming_convention() {
        let provider = AppConfigAgentFlags::new(
            "http://localhost:2772/",
            "govcloud-mfe-",
            "prod",
            "feature-flags",
        )
        .unwrap();
        assert_eq!(
            provider.url("dashboard"),
            "http://localhost:2772/applications/govcloud-mfe-dashboard/environments/prod/configurations/feature-flags"
        );
    }
}
