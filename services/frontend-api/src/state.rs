//! Shared, cheaply clonable state handed to every request handler.

use std::sync::Arc;

use crate::auth::Authenticator;
use crate::auth::alb::{AlbTokenVerifier, HttpKeyFetcher};
use crate::config::{AuthConfig, Config, FlagsConfig};
use crate::flags::{AppConfigAgentFlags, FlagProvider, LocalFlags};
use crate::metrics::Metrics;
use crate::preferences::{InMemoryPreferences, PreferencesStore};

#[derive(Clone)]
pub struct AppState {
    pub auth: Arc<Authenticator>,
    /// The web app and its modules (`APPS`). Fixed at build time of the web
    /// app, so it is configuration here rather than something we look up.
    pub apps: Arc<[String]>,
    pub flags: Arc<dyn FlagProvider>,
    pub preferences: Arc<dyn PreferencesStore>,
    pub metrics: Arc<Metrics>,
    pub logout: Arc<LogoutSettings>,
}

pub struct LogoutSettings {
    /// Base name of the ALB session cookie; the ALB shards it into `-0`..`-3`.
    pub session_cookie_name: String,
    /// IdP end-session URL. Falls back to `/`, which simply re-authenticates.
    pub redirect_url: Option<String>,
}

impl AppState {
    /// Wires concrete implementations according to configuration.
    pub fn from_config(config: &Config) -> anyhow::Result<Self> {
        let auth = match &config.auth {
            AuthConfig::Alb { alb_arn, region } => {
                let fetcher = Arc::new(HttpKeyFetcher::new(region.clone())?);
                Authenticator::Alb(AlbTokenVerifier::new(alb_arn.clone(), fetcher))
            }
            AuthConfig::LocalDev => Authenticator::LocalDev,
        };

        let flags: Arc<dyn FlagProvider> = match &config.flags {
            FlagsConfig::AppConfigAgent {
                agent_url,
                application_prefix,
                environment,
                profile,
            } => Arc::new(AppConfigAgentFlags::new(
                agent_url.clone(),
                application_prefix.clone(),
                environment.clone(),
                profile.clone(),
            )?),
            FlagsConfig::Local { repo_root } => Arc::new(LocalFlags::new(repo_root.clone())),
        };

        Ok(Self {
            auth: Arc::new(auth),
            apps: config.apps.clone().into(),
            flags,
            preferences: Arc::new(InMemoryPreferences::default()),
            metrics: Arc::new(Metrics::new(config.metrics_namespace.clone())),
            logout: Arc::new(LogoutSettings {
                session_cookie_name: config.session_cookie_name.clone(),
                redirect_url: config.logout_redirect_url.clone(),
            }),
        })
    }
}
