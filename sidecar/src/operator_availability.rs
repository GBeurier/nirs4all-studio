//! Operator catalogue availability is measured in the configured library runtime.
use crate::{HttpRequest, HttpResponse, SidecarState};
use serde_json::json;
use std::sync::{Arc, Mutex};

pub fn route(runtime: &Arc<Mutex<SidecarState>>, request: &HttpRequest) -> Option<HttpResponse> {
    if request.path != "/api/system/operator-availability" {
        return None;
    }
    if request.method != "GET" {
        return Some(crate::method_not_allowed(
            &request.method,
            &request.path,
            "GET",
        ));
    }
    if request
        .query
        .as_deref()
        .is_some_and(|query| !query.is_empty())
        || !request.body.is_empty()
    {
        return Some(HttpResponse::json(
            400,
            json!({"detail":"Operator availability takes no request fields"}).to_string(),
        ));
    }
    let host = runtime
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .scientific_host
        .clone();
    Some(match host {
        Some(host) => match host.adapt_document("operators.availability", &json!({})) {
            Ok(value) => HttpResponse::json(200, value.to_string()),
            Err(error) => HttpResponse::json(503, json!({"detail":error}).to_string()),
        },
        None => HttpResponse::json(
            503,
            json!({"detail":"Scientific library runtime is unavailable"}).to_string(),
        ),
    })
}
