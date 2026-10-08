//! Bounded session error journal for the Rust-owned product HTTP server.

use crate::HttpResponse;
use serde_json::{json, Value};
use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};

const MAX_STORED: usize = 100;
static NEXT_ID: AtomicU64 = AtomicU64::new(1);
pub static ERROR_LOGS: ErrorLogs = ErrorLogs {
    entries: Mutex::new(VecDeque::new()),
};

#[derive(Default)]
pub struct ErrorLogs {
    entries: Mutex<VecDeque<Value>>,
}

impl ErrorLogs {
    pub fn record(&self, endpoint: &str, response: &HttpResponse) {
        if response.status < 400 || endpoint == "/api/system/errors" {
            return;
        }
        let payload: Value = serde_json::from_str(&response.body).unwrap_or(Value::Null);
        let detail = payload.get("detail").or_else(|| payload.get("message"));
        let message = detail
            .and_then(Value::as_str)
            .map_or_else(|| format!("HTTP {}", response.status), str::to_owned);
        let mut entries = self
            .entries
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if entries.len() == MAX_STORED {
            entries.pop_back();
        }
        let timestamp = crate::websocket_transport::rfc3339_now();
        entries.push_front(json!({
            "id": format!("{}-{}", timestamp, NEXT_ID.fetch_add(1, Ordering::Relaxed)),
            "timestamp": timestamp,
            "level": "error",
            "endpoint": endpoint,
            "message": message,
            "details": response.body,
            "traceback": null,
        }));
        drop(entries);
    }

    pub fn route(&self, method: &str, path: &str, query: Option<&str>) -> Option<HttpResponse> {
        if path != "/api/system/errors" {
            return None;
        }
        let response = match method {
            "GET" => {
                let limit = query.map_or(Some(50), |query| {
                    query
                        .strip_prefix("limit=")
                        .filter(|value| {
                            !value.is_empty() && value.bytes().all(|b| b.is_ascii_digit())
                        })
                        .and_then(|value| value.parse::<usize>().ok())
                        .filter(|limit| (1..=200).contains(limit))
                });
                let Some(limit) = limit else {
                    return Some(HttpResponse::json(
                        400,
                        json!({"detail":"limit must be an integer from 1 to 200"}).to_string(),
                    ));
                };
                let entries = self
                    .entries
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                let errors = entries.iter().take(limit).cloned().collect::<Vec<_>>();
                let total = entries.len();
                drop(entries);
                json!({"errors":errors,"total":total,"max_stored":MAX_STORED})
            }
            "DELETE" if query.is_none() => {
                let mut entries = self
                    .entries
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                let cleared = entries.len();
                entries.clear();
                drop(entries);
                json!({"success":true,"cleared":cleared})
            }
            "DELETE" => {
                return Some(HttpResponse::json(
                    400,
                    json!({"detail":"Clear errors takes no query parameters"}).to_string(),
                ))
            }
            _ => return Some(crate::method_not_allowed(method, path, "GET, DELETE")),
        };
        Some(HttpResponse::json(200, response.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn journal_is_bounded_newest_first_and_clearable() {
        let logs = ErrorLogs::default();
        logs.record("/api/health", &HttpResponse::json(200, "{}"));
        for index in 0..105 {
            logs.record(
                "/api/playground/execute-dataset",
                &HttpResponse::json(
                    400,
                    json!({"detail": format!("Dataset error {index}")}).to_string(),
                ),
            );
        }
        let response = logs
            .route("GET", "/api/system/errors", Some("limit=2"))
            .unwrap();
        let body: Value = serde_json::from_str(&response.body).unwrap();
        assert_eq!(body["total"], 100);
        assert_eq!(body["errors"].as_array().unwrap().len(), 2);
        assert_eq!(body["errors"][0]["message"], "Dataset error 104");
        assert_eq!(
            body["errors"][0]["endpoint"],
            "/api/playground/execute-dataset"
        );
        assert_ne!(body["errors"][0]["id"], body["errors"][1]["id"]);
        let cleared = logs.route("DELETE", "/api/system/errors", None).unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&cleared.body).unwrap()["cleared"],
            100
        );
        let empty = logs.route("GET", "/api/system/errors", None).unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&empty.body).unwrap()["total"],
            0
        );
    }

    #[test]
    fn journal_rejects_invalid_limits_and_does_not_log_its_own_errors() {
        let logs = ErrorLogs::default();
        for query in [
            "limit=0",
            "limit=201",
            "limit=abc",
            "limit=2&other=1",
            "other=1",
        ] {
            let response = logs
                .route("GET", "/api/system/errors", Some(query))
                .unwrap();
            assert_eq!(response.status, 400);
            logs.record("/api/system/errors", &response);
        }
        assert!(logs.entries.lock().unwrap().is_empty());
        assert_eq!(
            logs.route("POST", "/api/system/errors", None)
                .unwrap()
                .status,
            405
        );
    }
}
