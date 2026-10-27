//! Where the active release of every app is recorded.
//!
//! Each app's pipeline writes `releases/<app>.json` to the stage's artifact
//! bucket when it promotes or rolls back a version (docs/contracts.md §2–3).
//! Listing that prefix gives us the set of deployed apps without any central
//! registry that teams would have to coordinate on.

use std::path::PathBuf;
use std::time::{Duration, Instant};

use anyhow::Context;
use async_trait::async_trait;
use futures::future::join_all;
use tokio::sync::Mutex;

use crate::model::{ReleaseRecord, is_valid_app_name};

const RELEASES_PREFIX: &str = "releases/";

#[async_trait]
pub trait ReleaseStore: Send + Sync {
    /// All valid release records. Unreadable or invalid records are skipped
    /// (and logged) so one bad write cannot take every module offline.
    async fn list(&self) -> anyhow::Result<Vec<ReleaseRecord>>;
}

/// Reads release records from the artifact bucket.
pub struct S3ReleaseStore {
    client: aws_sdk_s3::Client,
    bucket: String,
}

impl S3ReleaseStore {
    pub fn new(client: aws_sdk_s3::Client, bucket: impl Into<String>) -> Self {
        Self {
            client,
            bucket: bucket.into(),
        }
    }

    async fn read(&self, key: &str) -> anyhow::Result<ReleaseRecord> {
        let object = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await?;
        let bytes = object.body.collect().await?.into_bytes();
        Ok(serde_json::from_slice(&bytes)?)
    }
}

#[async_trait]
impl ReleaseStore for S3ReleaseStore {
    async fn list(&self) -> anyhow::Result<Vec<ReleaseRecord>> {
        let mut keys = Vec::new();
        let mut pages = self
            .client
            .list_objects_v2()
            .bucket(&self.bucket)
            .prefix(RELEASES_PREFIX)
            .into_paginator()
            .send();
        while let Some(page) = pages.next().await {
            let page = page.context("listing release records")?;
            keys.extend(
                page.contents()
                    .iter()
                    .filter_map(|object| object.key())
                    .filter(|key| key.ends_with(".json"))
                    .map(str::to_owned),
            );
        }

        let reads = keys
            .iter()
            .map(|key| async move { (key, self.read(key).await) });
        let records = join_all(reads)
            .await
            .into_iter()
            .filter_map(|(key, result)| keep_valid(key, result));
        Ok(records.collect())
    }
}

/// Reads release records from a directory (`dev/releases` for local development).
pub struct LocalReleaseStore {
    dir: PathBuf,
}

impl LocalReleaseStore {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }
}

#[async_trait]
impl ReleaseStore for LocalReleaseStore {
    async fn list(&self) -> anyhow::Result<Vec<ReleaseRecord>> {
        let mut entries = tokio::fs::read_dir(&self.dir)
            .await
            .with_context(|| format!("reading {}", self.dir.display()))?;
        let mut records = Vec::new();
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.extension().is_some_and(|ext| ext == "json") {
                let result = tokio::fs::read(&path)
                    .await
                    .map_err(anyhow::Error::from)
                    .and_then(|bytes| Ok(serde_json::from_slice(&bytes)?));
                records.extend(keep_valid(&path.display().to_string(), result));
            }
        }
        Ok(records)
    }
}

fn keep_valid(source: &str, result: anyhow::Result<ReleaseRecord>) -> Option<ReleaseRecord> {
    match result {
        Ok(record) if record.schema_version == 1 && is_valid_app_name(&record.app) => Some(record),
        Ok(record) => {
            tracing::warn!(
                source,
                app = record.app,
                "skipping release record with unsupported schema or app name"
            );
            None
        }
        Err(error) => {
            tracing::warn!(
                source,
                error = format!("{error:#}"),
                "skipping unreadable release record"
            );
            None
        }
    }
}

/// Caches another store for a short TTL. Every page load hits `/api/modules`,
/// but releases change a few times a day; a 15s TTL bounds how long a
/// promote or rollback takes to reach users.
pub struct CachedReleaseStore {
    inner: Box<dyn ReleaseStore>,
    ttl: Duration,
    cached: Mutex<Option<(Instant, Vec<ReleaseRecord>)>>,
}

impl CachedReleaseStore {
    pub fn new(inner: Box<dyn ReleaseStore>, ttl: Duration) -> Self {
        Self {
            inner,
            ttl,
            cached: Mutex::default(),
        }
    }
}

#[async_trait]
impl ReleaseStore for CachedReleaseStore {
    async fn list(&self) -> anyhow::Result<Vec<ReleaseRecord>> {
        // Holding the lock across the refresh means concurrent requests wait
        // for one fetch instead of stampeding S3.
        let mut cached = self.cached.lock().await;
        if let Some((fetched_at, records)) = cached.as_ref()
            && fetched_at.elapsed() < self.ttl
        {
            return Ok(records.clone());
        }
        let records = self.inner.list().await?;
        *cached = Some((Instant::now(), records.clone()));
        Ok(records)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn reads_the_repository_dev_records() {
        let store =
            LocalReleaseStore::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../../dev/releases"));
        let mut apps: Vec<String> = store
            .list()
            .await
            .unwrap()
            .into_iter()
            .map(|r| r.app)
            .collect();
        apps.sort();
        assert_eq!(apps, ["dashboard", "settings", "shell"]);
    }

    #[test]
    fn skips_records_with_unsafe_app_names() {
        let mut record: ReleaseRecord = serde_json::from_value(serde_json::json!({
            "schemaVersion": 1, "app": "../x", "kind": "remote", "version": "v", "entry": "/e",
            "displayName": "X", "commit": "c", "releasedAt": "t", "releasedBy": "b"
        }))
        .unwrap();
        assert!(keep_valid("test", Ok(record.clone())).is_none());
        record.app = "ok".into();
        assert!(keep_valid("test", Ok(record)).is_some());
    }
}
