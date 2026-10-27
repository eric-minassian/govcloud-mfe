//! Wire types shared with the web app.
//!
//! This is the Rust mirror of `packages/contracts/src/api.ts`; the
//! human-readable contract is `docs/contracts.md` §6. Field names are
//! camelCase on the wire.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;

/// App names double as AppConfig application suffixes, URL path segments and
/// metric dimension values, so anything outside `^[a-z][a-z0-9]*$` is rejected.
pub fn is_valid_app_name(name: &str) -> bool {
    let mut chars = name.chars();
    matches!(chars.next(), Some('a'..='z'))
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
}

// --- API responses and requests ----------------------------------------------

/// The authenticated caller, taken from the ALB-signed `x-amzn-oidc-data` claims.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentUser {
    pub sub: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub groups: Vec<String>,
}

/// Evaluated flags for one app: `{ flagKey: { enabled, ...attributes } }`.
/// Kept as raw JSON because attributes are defined per flag by each team.
pub type FlagSet = Map<String, Value>;

/// Flags for every app, keyed by app name.
pub type FeatureFlags = BTreeMap<String, FlagSet>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Density {
    #[default]
    Comfortable,
    Compact,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserPreferences {
    pub theme: Theme,
    pub density: Density,
    pub pinned_modules: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ClientEventType {
    ModuleLoadFailure,
    RenderError,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientEvent {
    #[serde(rename = "type")]
    pub event_type: ClientEventType,
    pub app: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ClientEventBatch {
    pub events: Vec<ClientEvent>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_names_are_restricted_to_lowercase_alphanumerics() {
        assert!(is_valid_app_name("dashboard"));
        assert!(is_valid_app_name("app2"));
        assert!(!is_valid_app_name(""));
        assert!(!is_valid_app_name("2fa"));
        assert!(!is_valid_app_name("my-app"));
        assert!(!is_valid_app_name("../etc"));
        assert!(!is_valid_app_name("Dashboard"));
    }
}
