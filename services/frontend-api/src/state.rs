//! Shared, cheaply clonable state handed to every request handler.

use std::sync::Arc;
use std::time::Duration;

use crate::auth::Authenticator;
use crate::auth::alb::{AlbTokenVerifier, HttpKeyFetcher};
use crate::config::{AuthConfig, Config, FlagsConfig, ReleasesConfig};
use crate::flags::{AppConfigAgentFlags, FlagProvider, LocalFlags};
use crate::metrics::Metrics;
use crate::preferences::{InMemoryPreferences, PreferencesStore};
use crate::releases::{CachedReleaseStore, LocalReleaseStore, ReleaseStore, S3ReleaseStore};

const RELEASE_CACHE_TTL: Duration = Duration::from_secs(15);

#[derive(Clone)]
pub struct AppState {
    pub auth: Arc<Authenticator>,
    pub releases: Arc<dyn ReleaseStore>,
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
    pub async fn from_config(config: &Config) -> anyhow::Result<Self> {
        let auth = match &config.auth {
            AuthConfig::Alb { alb_arn, region } => {
                let fetcher = Arc::new(HttpKeyFetcher::new(region.clone())?);
                Authenticator::Alb(AlbTokenVerifier::new(alb_arn.clone(), fetcher))
            }
            AuthConfig::LocalDev => Authenticator::LocalDev,
        };

        let releases: Box<dyn ReleaseStore> = match &config.releases {
            ReleasesConfig::S3 { bucket } => {
                // Region, credentials (ECS task role) and FIPS endpoints
                // (AWS_USE_FIPS_ENDPOINT) all come from the standard AWS env.
                let aws = aws_config::load_from_env().await;
                Box::new(S3ReleaseStore::new(
                    aws_sdk_s3::Client::new(&aws),
                    bucket.clone(),
                ))
            }
            ReleasesConfig::Local { dir } => Box::new(LocalReleaseStore::new(dir.clone())),
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
            FlagsConfig::Local { dir } => Arc::new(LocalFlags::new(dir.clone())),
        };

        Ok(Self {
            auth: Arc::new(auth),
            releases: Arc::new(CachedReleaseStore::new(releases, RELEASE_CACHE_TTL)),
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
