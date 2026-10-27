//! Configuration from environment variables (see docs/contracts.md §7).
//!
//! `APP_ENV=local` flips every default to a local source so `cargo run` works
//! with no AWS account. In AWS every value is set explicitly by the CDK task
//! definition, and anything missing fails at startup rather than at request time.

use std::path::PathBuf;

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
pub enum ReleasesConfig {
    S3 { bucket: String },
    Local { dir: PathBuf },
}

#[derive(Debug, Clone, PartialEq)]
pub enum FlagsConfig {
    AppConfigAgent {
        agent_url: String,
        application_prefix: String,
        environment: String,
        profile: String,
    },
    Local {
        dir: PathBuf,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct Config {
    pub app_env: AppEnv,
    pub port: u16,
    pub auth: AuthConfig,
    pub releases: ReleasesConfig,
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

        let releases = match or("RELEASES_SOURCE", if local { "local" } else { "s3" }).as_str() {
            "s3" => ReleasesConfig::S3 {
                bucket: required("ASSETS_BUCKET")?,
            },
            "local" => ReleasesConfig::Local {
                dir: or("LOCAL_RELEASES_DIR", "../../dev/releases").into(),
            },
            other => return Err(invalid("RELEASES_SOURCE", other)),
        };

        let flags_default = if local { "local" } else { "appconfig-agent" };
        let flags = match or("FLAGS_SOURCE", flags_default).as_str() {
            "appconfig-agent" => FlagsConfig::AppConfigAgent {
                agent_url: or("APPCONFIG_AGENT_URL", "http://localhost:2772"),
                application_prefix: or("APPCONFIG_APPLICATION_PREFIX", "govcloud-mfe-"),
                environment: required("APPCONFIG_ENVIRONMENT")?,
                profile: or("APPCONFIG_PROFILE", "feature-flags"),
            },
            "local" => FlagsConfig::Local {
                dir: or("LOCAL_FLAGS_DIR", "../../apps").into(),
            },
            other => return Err(invalid("FLAGS_SOURCE", other)),
        };

        Ok(Config {
            app_env,
            port,
            auth,
            releases,
            flags,
            session_cookie_name: or("SESSION_COOKIE_NAME", "govcloud-mfe-session"),
            logout_redirect_url: get("LOGOUT_REDIRECT_URL"),
            metrics_namespace: or("METRICS_NAMESPACE", "GovcloudMfe/Frontend"),
        })
    }
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

    fn parse(vars: &[(&str, &str)]) -> Result<Config, ConfigError> {
        let vars: HashMap<String, String> = vars
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        Config::from_lookup(|name| vars.get(name).cloned())
    }

    #[test]
    fn local_env_defaults_to_local_sources() {
        let config = parse(&[("APP_ENV", "local")]).unwrap();
        assert_eq!(config.auth, AuthConfig::LocalDev);
        assert!(matches!(config.releases, ReleasesConfig::Local { .. }));
        assert!(matches!(config.flags, FlagsConfig::Local { .. }));
        assert_eq!(config.port, 8080);
    }

    #[test]
    fn aws_env_requires_explicit_settings() {
        let err = parse(&[("APP_ENV", "aws")]).unwrap_err();
        assert!(matches!(err, ConfigError::Missing("ALB_ARN")));
    }

    #[test]
    fn local_dev_auth_is_refused_outside_local() {
        let err = parse(&[("APP_ENV", "aws"), ("AUTH_MODE", "local-dev")]).unwrap_err();
        assert!(matches!(err, ConfigError::LocalAuthOutsideLocal));
    }

    #[test]
    fn aws_env_parses_full_configuration() {
        let config = parse(&[
            (
                "ALB_ARN",
                "arn:aws-us-gov:elasticloadbalancing:us-gov-west-1:1:loadbalancer/app/x/y",
            ),
            ("AWS_REGION", "us-gov-west-1"),
            ("ASSETS_BUCKET", "assets"),
            ("APPCONFIG_ENVIRONMENT", "prod"),
        ])
        .unwrap();
        assert_eq!(config.app_env, AppEnv::Aws);
        assert!(matches!(config.auth, AuthConfig::Alb { .. }));
        assert_eq!(
            config.releases,
            ReleasesConfig::S3 {
                bucket: "assets".into()
            }
        );
        assert!(matches!(
            config.flags,
            FlagsConfig::AppConfigAgent { ref environment, .. } if environment == "prod"
        ));
    }
}
