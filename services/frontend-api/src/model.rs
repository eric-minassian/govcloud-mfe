//! Wire types shared with the frontends and the release tooling.
//!
//! This is the Rust mirror of `packages/contracts/src/*.ts`; the human-readable
//! contract is `docs/contracts.md`. Field names are camelCase on the wire.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;

/// App names double as S3 keys, URL path segments and AppConfig application
/// suffixes, so anything outside `^[a-z][a-z0-9]*$` is rejected on read.
pub fn is_valid_app_name(name: &str) -> bool {
    let mut chars = name.chars();
    matches!(chars.next(), Some('a'..='z'))
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
}

// --- Release records (`releases/<app>.json`) --------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AppKind {
    Shell,
    Remote,
}

/// Which version of an app is live in this stage. Written by the release CLI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseRecord {
    pub schema_version: u32,
    pub app: String,
    pub kind: AppKind,
    pub version: String,
    /// Shell: path of its `index.html`. Remote: path of its `mf-manifest.json`.
    pub entry: String,
    pub display_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub route: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exposed_module: Option<String>,
    pub commit: String,
    pub released_at: String,
    pub released_by: String,
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

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteModule {
    pub name: String,
    pub display_name: String,
    pub route: String,
    /// URL of the module's `mf-manifest.json`.
    pub entry: String,
    pub exposed_module: String,
    pub version: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellInfo {
    pub version: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleRegistry {
    pub shell: Option<ShellInfo>,
    pub modules: Vec<RemoteModule>,
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

    #[test]
    fn release_record_round_trips_contract_json() {
        let json = r#"{
            "schemaVersion": 1, "app": "dashboard", "kind": "remote", "version": "3f9c2a1b7d4e",
            "entry": "/apps/dashboard/3f9c2a1b7d4e/mf-manifest.json", "displayName": "Dashboard",
            "route": "/dashboard", "exposedModule": "./App", "commit": "3f9c2a1b7d4e8a7f",
            "releasedAt": "2026-10-27T17:04:05.000Z", "releasedBy": "pipeline"
        }"#;
        let record: ReleaseRecord = serde_json::from_str(json).unwrap();
        assert_eq!(record.kind, AppKind::Remote);
        assert_eq!(record.exposed_module.as_deref(), Some("./App"));
        let back = serde_json::to_value(&record).unwrap();
        assert_eq!(back["displayName"], "Dashboard");
    }
}
