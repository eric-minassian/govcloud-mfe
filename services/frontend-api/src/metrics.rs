//! Client error metrics via CloudWatch Embedded Metric Format (EMF).
//!
//! Printing an EMF document to stdout is enough: the ECS `awslogs` driver
//! ships it to CloudWatch Logs, which extracts the metric. No SDK call, no
//! agent, no extra IAM permissions. Each app's stack alarms on its own `App`
//! dimension, and that alarm drives pipeline and AppConfig rollbacks.

use std::io::Write;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Value, json};

use crate::model::ClientEvent;

pub const CLIENT_ERRORS_METRIC: &str = "ClientErrors";

pub struct Metrics {
    namespace: String,
}

impl Metrics {
    pub fn new(namespace: impl Into<String>) -> Self {
        Self {
            namespace: namespace.into(),
        }
    }

    /// Records one `ClientErrors` data point for the event's app.
    pub fn record_client_error(&self, event: &ClientEvent) {
        let document = self.client_error_document(event, now_millis());
        // One line per document; stdout's lock keeps it from interleaving with logs.
        let _ = writeln!(std::io::stdout().lock(), "{document}");
    }

    fn client_error_document(&self, event: &ClientEvent, timestamp_ms: u128) -> Value {
        json!({
            "_aws": {
                "Timestamp": timestamp_ms,
                "CloudWatchMetrics": [{
                    "Namespace": self.namespace,
                    "Dimensions": [["App"]],
                    "Metrics": [{ "Name": CLIENT_ERRORS_METRIC, "Unit": "Count" }]
                }]
            },
            "App": event.app,
            CLIENT_ERRORS_METRIC: 1,
            // Searchable in Logs Insights but deliberately not dimensions,
            // to keep metric cardinality bounded.
            "eventType": event.event_type,
            "version": event.version,
            "message": event.message,
        })
    }
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::ClientEventType;

    #[test]
    fn emits_an_emf_document_with_the_app_dimension() {
        let metrics = Metrics::new("GovcloudMfe/Frontend");
        let event = ClientEvent {
            event_type: ClientEventType::ModuleLoadFailure,
            app: "dashboard".into(),
            version: Some("3f9c2a1b7d4e".into()),
            message: "ChunkLoadError".into(),
        };
        let doc = metrics.client_error_document(&event, 1_700_000_000_000);

        let definition = &doc["_aws"]["CloudWatchMetrics"][0];
        assert_eq!(definition["Namespace"], "GovcloudMfe/Frontend");
        assert_eq!(definition["Dimensions"], json!([["App"]]));
        assert_eq!(definition["Metrics"][0]["Name"], "ClientErrors");
        assert_eq!(doc["App"], "dashboard");
        assert_eq!(doc["ClientErrors"], 1);
        assert_eq!(doc["eventType"], "module-load-failure");
    }
}
