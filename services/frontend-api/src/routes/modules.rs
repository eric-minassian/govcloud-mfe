//! `GET /api/modules` — which remotes the shell should load, and from where.
//!
//! Built from the release records each app's pipeline writes, minus any
//! module whose `moduleEnabled` kill switch is off.

use axum::Json;
use axum::extract::State;
use futures::future::join_all;

use crate::error::AppError;
use crate::model::{
    AppKind, CurrentUser, FlagSet, ModuleRegistry, ReleaseRecord, RemoteModule, ShellInfo,
};
use crate::state::AppState;

const KILL_SWITCH_FLAG: &str = "moduleEnabled";

pub async fn list(
    State(state): State<AppState>,
    user: CurrentUser,
) -> Result<Json<ModuleRegistry>, AppError> {
    let records = state.releases.list().await.map_err(AppError::dependency)?;

    let remotes = records.iter().filter(|r| r.kind == AppKind::Remote);
    let flag_lookups = remotes.map(|record| async {
        let flags = state.flags.flags_for(&record.app, &user).await;
        (record.app.clone(), is_enabled(&record.app, flags))
    });
    let enabled: Vec<(String, bool)> = join_all(flag_lookups).await;

    let registry = build_registry(records, |app| {
        enabled.iter().any(|(name, on)| name == app && *on)
    });
    Ok(Json(registry))
}

/// The kill switch fails *open*: if AppConfig is unreachable we would rather
/// show a module than hide every module from every user.
fn is_enabled(app: &str, flags: anyhow::Result<FlagSet>) -> bool {
    match flags {
        Ok(flags) => {
            flags
                .get(KILL_SWITCH_FLAG)
                .and_then(|flag| flag.get("enabled"))
                .and_then(|enabled| enabled.as_bool())
                != Some(false)
        }
        Err(error) => {
            tracing::warn!(
                app,
                error = format!("{error:#}"),
                "flags unavailable; treating module as enabled"
            );
            true
        }
    }
}

pub fn build_registry(
    records: Vec<ReleaseRecord>,
    is_enabled: impl Fn(&str) -> bool,
) -> ModuleRegistry {
    let mut shell = None;
    let mut modules = Vec::new();

    for record in records {
        match record.kind {
            AppKind::Shell => {
                shell = Some(ShellInfo {
                    version: record.version,
                })
            }
            AppKind::Remote if !is_enabled(&record.app) => {}
            AppKind::Remote => {
                let (Some(route), Some(exposed_module)) = (record.route, record.exposed_module)
                else {
                    tracing::warn!(
                        app = record.app,
                        "remote release record lacks route or exposedModule"
                    );
                    continue;
                };
                modules.push(RemoteModule {
                    name: record.app,
                    display_name: record.display_name,
                    route,
                    entry: record.entry,
                    exposed_module,
                    version: record.version,
                });
            }
        }
    }

    modules.sort_by(|a, b| a.display_name.cmp(&b.display_name));
    ModuleRegistry { shell, modules }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn record(app: &str, kind: &str, display_name: &str) -> ReleaseRecord {
        serde_json::from_value(json!({
            "schemaVersion": 1, "app": app, "kind": kind, "version": format!("{app}-v1"),
            "entry": format!("/apps/{app}/v1/mf-manifest.json"), "displayName": display_name,
            "route": format!("/{app}"), "exposedModule": "./App",
            "commit": "c", "releasedAt": "t", "releasedBy": "b"
        }))
        .unwrap()
    }

    #[test]
    fn lists_enabled_remotes_sorted_by_display_name_and_reports_the_shell() {
        let records = vec![
            record("settings", "remote", "Settings"),
            record("shell", "shell", "Shell"),
            record("dashboard", "remote", "Dashboard"),
            record("reports", "remote", "Reports"),
        ];
        let registry = build_registry(records, |app| app != "reports");

        assert_eq!(
            registry.shell,
            Some(ShellInfo {
                version: "shell-v1".into()
            })
        );
        let names: Vec<_> = registry.modules.iter().map(|m| m.name.as_str()).collect();
        assert_eq!(names, ["dashboard", "settings"]);
        assert_eq!(
            registry.modules[0].entry,
            "/apps/dashboard/v1/mf-manifest.json"
        );
    }

    #[test]
    fn kill_switch_only_hides_modules_that_are_explicitly_disabled() {
        let flags = |value: serde_json::Value| Ok(value.as_object().unwrap().clone());
        assert!(!is_enabled(
            "a",
            flags(json!({ "moduleEnabled": { "enabled": false } }))
        ));
        assert!(is_enabled(
            "a",
            flags(json!({ "moduleEnabled": { "enabled": true } }))
        ));
        assert!(is_enabled("a", flags(json!({}))));
        assert!(is_enabled("a", Err(anyhow::anyhow!("agent down"))));
    }
}
