//! Configuration from environment variables (see docs/contracts.md §9).
//!
//! `APP_ENV=local` flips every default to a local source so `cargo run` works
//! with no AWS account. In AWS every value is set explicitly by the CDK task
//! definition, and anything missing fails at startup rather than at request time.

use std::path::{Path, PathBuf};

use crate::model::is_valid_app_name;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppEnv {
    Aws,
    Local,
}

#[derive(Debug, Clone, PartialEq)]
pub enum AuthConfig {
    /// Verify the ALB-signed `x-amzn-oidc-data` header.
    Alb { alb_arn: String, region: String },
    /// Pretend every request comes from a fixed developer. Local only.
    LocalDev,
}

#[derive(Debug, Clone, PartialEq)]
pub enum FlagsConfig {
    AppConfigAgent {
        agent_url: String,
        application_prefix: String,
        environment: String,
        profile: String,
    },
    /// Read flag definitions from the repository checkout.
    Local { repo_root: PathBuf },
}

#[derive(Debug, Clone, PartialEq)]
pub struct Config {
    pub app_env: AppEnv,
    pub port: u16,
    pub auth: AuthConfig,
    /// The web app plus every module compiled into it: whose flags we serve
    /// and whose client errors we accept. Validated, de-duplicated, ordered.
    pub apps: Vec<String>,
    pub flags: FlagsConfig,
    pub session_cookie_name: String,
    pub logout_redirect_url: Option<String>,
    pub metrics_namespace: String,
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("missing required environment variable {0}")]
    Missing(&'static str),
    #[error("invalid value for {name}: {value:?}")]
    Invalid { name: &'static str, value: String },
    #[error("AUTH_MODE=local-dev is only allowed when APP_ENV=local")]
    LocalAuthOutsideLocal,
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_lookup(|name| std::env::var(name).ok().filter(|v| !v.is_empty()))
    }

    /// Parses configuration from any key/value source, which keeps it testable.
    pub fn from_lookup(get: impl Fn(&str) -> Option<String>) -> Result<Self, ConfigError> {
        let required = |name: &'static str| get(name).ok_or(ConfigError::Missing(name));
        let or = |name: &str, default: &str| get(name).unwrap_or_else(|| default.to_owned());

        let app_env = match or("APP_ENV", "aws").as_str() {
            "aws" => AppEnv::Aws,
            "local" => AppEnv::Local,
            other => return Err(invalid("APP_ENV", other)),
        };
        let local = app_env == AppEnv::Local;
        let repo_root = PathBuf::from(or("LOCAL_REPO_ROOT", "../.."));

        let port = or("PORT", "8080")
            .parse()
            .map_err(|_| invalid("PORT", &or("PORT", "")))?;

        let auth = match or("AUTH_MODE", if local { "local-dev" } else { "alb" }).as_str() {
            "alb" => AuthConfig::Alb {
                alb_arn: required("ALB_ARN")?,
                region: required("AWS_REGION")?,
            },
            "local-dev" if local => AuthConfig::LocalDev,
            "local-dev" => return Err(ConfigError::LocalAuthOutsideLocal),
            other => return Err(invalid("AUTH_MODE", other)),
        };

        // In AWS the CDK app sets APPS from the same `modules/*/module.json`
        // files the web build composes. Locally we derive it from the checkout.
        let apps = match get("APPS") {
            Some(list) => parse_apps(&list)?,
            None if local => discover_local_apps(&repo_root)?,
            None => return Err(ConfigError::Missing("APPS")),
        };

        let flags_default = if local { "local" } else { "appconfig-agent" };
        let flags = match or("FLAGS_SOURCE", flags_default).as_str() {
            "appconfig-agent" => FlagsConfig::AppConfigAgent {
                agent_url: or("APPCONFIG_AGENT_URL", "http://localhost:2772"),
                application_prefix: or("APPCONFIG_APPLICATION_PREFIX", "govcloud-mfe-"),
                environment: required("APPCONFIG_ENVIRONMENT")?,
                profile: or("APPCONFIG_PROFILE", "feature-flags"),
            },
            "local" => FlagsConfig::Local { repo_root },
            other => return Err(invalid("FLAGS_SOURCE", other)),
        };

        Ok(Config {
            app_env,
            port,
            auth,
            apps,
            flags,
            session_cookie_name: or("SESSION_COOKIE_NAME", "govcloud-mfe-session"),
            logout_redirect_url: get("LOGOUT_REDIRECT_URL"),
            metrics_namespace: or("METRICS_NAMESPACE", "GovcloudMfe/Frontend"),
        })
    }
}

/// Parses `APPS`, e.g. `web,dashboard,settings`. Every name becomes an
/// AppConfig application suffix and a metric dimension value, so it must be
/// a plain identifier.
pub fn parse_apps(list: &str) -> Result<Vec<String>, ConfigError> {
    let mut apps = Vec::new();
    for name in list.split(',').map(str::trim).filter(|n| !n.is_empty()) {
        if !is_valid_app_name(name) {
            return Err(invalid("APPS", name));
        }
        if !apps.iter().any(|existing| existing == name) {
            apps.push(name.to_owned());
        }
    }
    if apps.is_empty() {
        return Err(invalid("APPS", list));
    }
    Ok(apps)
}

/// Local default for `APPS`: `web` plus every `modules/<name>` directory that
/// has a `module.json`, sorted — i.e. what the web build would compose.
pub fn discover_local_apps(repo_root: &Path) -> Result<Vec<String>, ConfigError> {
    let mut modules = Vec::new();
    // A checkout without a modules/ directory simply has no modules.
    if let Ok(entries) = std::fs::read_dir(repo_root.join("modules")) {
        for entry in entries.flatten() {
            if !entry.path().join("module.json").is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if !is_valid_app_name(&name) {
                return Err(invalid("APPS", &format!("modules/{name}")));
            }
            modules.push(name);
        }
    }
    modules.sort();
    Ok(std::iter::once("web".to_owned()).chain(modules).collect())
}

fn invalid(name: &'static str, value: &str) -> ConfigError {
    ConfigError::Invalid {
        name,
        value: value.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn parse(vars: &[(&str, &str)]) -> Result<Config, ConfigError> {
        let vars: HashMap<String, String> = vars
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        Config::from_lookup(|name| vars.get(name).cloned())
    }

    /// A throwaway checkout with the given `modules/<dir>` entries.
    fn temp_repo(modules: &[(&str, bool)]) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "frontend-api-config-{}-{unique}",
            std::process::id()
        ));
        for (dir, has_descriptor) in modules {
            let path = root.join("modules").join(dir);
            std::fs::create_dir_all(&path).unwrap();
            if *has_descriptor {
                std::fs::write(path.join("module.json"), "{}").unwrap();
            }
        }
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    const ALB_ARN: &str =
        "arn:aws-us-gov:elasticloadbalancing:us-gov-west-1:1:loadbalancer/app/x/y";

    #[test]
    fn local_env_defaults_to_local_sources() {
        let config = parse(&[("APP_ENV", "local"), ("APPS", "web")]).unwrap();
        assert_eq!(config.auth, AuthConfig::LocalDev);
        assert!(matches!(config.flags, FlagsConfig::Local { .. }));
        assert_eq!(config.port, 8080);
    }

    #[test]
    fn local_apps_default_to_web_plus_modules_with_a_descriptor() {
        let root = temp_repo(&[("settings", true), ("dashboard", true), ("scratch", false)]);
        let config = parse(&[
            ("APP_ENV", "local"),
            ("LOCAL_REPO_ROOT", root.to_str().unwrap()),
        ])
        .unwrap();
        assert_eq!(config.apps, ["web", "dashboard", "settings"]);
    }

    #[test]
    fn local_apps_reject_module_directories_that_are_not_valid_names() {
        let root = temp_repo(&[("my-module", true)]);
        let err = discover_local_apps(&root).unwrap_err();
        assert!(matches!(err, ConfigError::Invalid { name: "APPS", .. }));
    }

    #[test]
    fn local_apps_match_this_repository() {
        let root = Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."));
        let apps = discover_local_apps(root).unwrap();
        assert_eq!(apps[0], "web");
        assert!(apps.contains(&"dashboard".to_owned()));
        assert!(apps.contains(&"settings".to_owned()));
    }

    #[test]
    fn apps_are_validated_trimmed_and_deduplicated() {
        assert_eq!(
            parse_apps(" web, dashboard ,web,,settings").unwrap(),
            ["web", "dashboard", "settings"]
        );
        assert!(parse_apps("web,Dashboard").is_err());
        assert!(parse_apps("web,../etc").is_err());
        assert!(parse_apps(" , ").is_err());
    }

    #[test]
    fn aws_env_requires_explicit_settings() {
        let err = parse(&[("APP_ENV", "aws")]).unwrap_err();
        assert!(matches!(err, ConfigError::Missing("ALB_ARN")));

        let err = parse(&[("ALB_ARN", ALB_ARN), ("AWS_REGION", "us-gov-west-1")]).unwrap_err();
        assert!(matches!(err, ConfigError::Missing("APPS")));
    }

    #[test]
    fn local_dev_auth_is_refused_outside_local() {
        let err = parse(&[("APP_ENV", "aws"), ("AUTH_MODE", "local-dev")]).unwrap_err();
        assert!(matches!(err, ConfigError::LocalAuthOutsideLocal));
    }

    #[test]
    fn aws_env_parses_full_configuration() {
        let config = parse(&[
            ("ALB_ARN", ALB_ARN),
            ("AWS_REGION", "us-gov-west-1"),
            ("APPS", "web,dashboard,settings"),
            ("APPCONFIG_ENVIRONMENT", "prod"),
        ])
        .unwrap();
        assert_eq!(config.app_env, AppEnv::Aws);
        assert!(matches!(config.auth, AuthConfig::Alb { .. }));
        assert_eq!(config.apps, ["web", "dashboard", "settings"]);
        assert!(matches!(
            config.flags,
            FlagsConfig::AppConfigAgent { ref environment, .. } if environment == "prod"
        ));
    }
}
