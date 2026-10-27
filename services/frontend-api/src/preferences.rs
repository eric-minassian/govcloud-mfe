//! Per-user UI preferences — a typical "frontend-only" API: state that only
//! the UI cares about and that no domain backend should have to own.

use std::collections::HashMap;

use async_trait::async_trait;
use tokio::sync::RwLock;

use crate::model::UserPreferences;

#[async_trait]
pub trait PreferencesStore: Send + Sync {
    async fn get(&self, sub: &str) -> anyhow::Result<UserPreferences>;
    async fn put(&self, sub: &str, preferences: UserPreferences) -> anyhow::Result<()>;
}

/// Process-local store for the proof of concept. The service runs as several
/// Fargate tasks behind the ALB, so a real deployment would back this trait
/// with DynamoDB (partition key = `sub`) to share state across tasks.
#[derive(Default)]
pub struct InMemoryPreferences {
    by_user: RwLock<HashMap<String, UserPreferences>>,
}

#[async_trait]
impl PreferencesStore for InMemoryPreferences {
    async fn get(&self, sub: &str) -> anyhow::Result<UserPreferences> {
        Ok(self
            .by_user
            .read()
            .await
            .get(sub)
            .cloned()
            .unwrap_or_default())
    }

    async fn put(&self, sub: &str, preferences: UserPreferences) -> anyhow::Result<()> {
        self.by_user
            .write()
            .await
            .insert(sub.to_owned(), preferences);
        Ok(())
    }
}
