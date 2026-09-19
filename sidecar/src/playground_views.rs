//! Spectral presentation routes; array extraction and statistics belong to the library.
use crate::{HttpRequest, HttpResponse, SidecarState};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
};

fn endpoint(path: &str) -> Option<(&str, Option<&str>)> {
    match path {
        "/api/playground/operators" => Some(("playground.operators", None)),
        "/api/playground/presets" => Some(("playground.presets", None)),
        _ => {
            let tail = path.strip_prefix("/api/spectra/")?;
            let (id, operation) = tail
                .strip_suffix("/stats")
                .map_or((tail, "spectra.data"), |id| (id, "spectra.stats"));
            (!id.is_empty() && !id.contains('/')).then_some((operation, Some(id)))
        }
    }
}

pub fn route(runtime: &Arc<Mutex<SidecarState>>, request: &HttpRequest) -> Option<HttpResponse> {
    let (operation, id) = endpoint(&request.path)?;
    let error =
        |status, detail: String| HttpResponse::json(status, json!({"detail":detail}).to_string());
    if request.method != "GET" {
        return Some(crate::method_not_allowed(
            &request.method,
            &request.path,
            "GET",
        ));
    }
    let mut payload = match query_payload(request.query.as_deref(), operation) {
        Ok(payload) => payload,
        Err(detail) => return Some(error(400, detail)),
    };
    let (settings, host) = {
        let state = runtime
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        (state.app_settings.clone(), state.scientific_host.clone())
    };
    if let Some(raw_id) = id {
        let Ok(id) = percent_encoding::percent_decode_str(raw_id).decode_utf8() else {
            return Some(error(400, "Invalid dataset identifier".into()));
        };
        if id.is_empty()
            || id.len() > 256
            || id.contains(['/', '\\', '\0'])
            || matches!(id.as_ref(), "." | "..")
        {
            return Some(error(400, "Invalid dataset identifier".into()));
        }
        match crate::playground::confined_dataset(&settings, &id) {
            Ok(config) => {
                payload["config"] = config;
                payload["dataset_id"] = json!(id);
            }
            Err((status, detail)) => return Some(error(status, detail)),
        }
    }
    let Some(host) = host else {
        return Some(error(
            503,
            "Scientific library runtime is unavailable".into(),
        ));
    };
    Some(match host.adapt_document(operation, &payload) {
        Ok(value) => HttpResponse::json(200, value.to_string()),
        Err(detail) => error(400, detail),
    })
}

fn query_payload(query: Option<&str>, operation: &str) -> Result<Value, String> {
    let mut payload = json!({});
    let mut seen = HashSet::new();
    for (key, value) in url::form_urlencoded::parse(query.unwrap_or_default().as_bytes()) {
        if !seen.insert(key.clone()) {
            return Err("Duplicate spectral query field".into());
        }
        if !operation.starts_with("spectra.") {
            return Err("Playground catalogue takes no query".into());
        }
        let data = operation == "spectra.data";
        let parsed = match key.as_ref() {
            "partition" if matches!(value.as_ref(), "train" | "test" | "all") => json!(value),
            "source" => number(&value, false)?,
            "start" | "end" | "target_index" if data => number(&value, false)?,
            "max_wavelengths_returned" if data => number(&value, true)?,
            "include_y" | "include_metadata"
                if data && matches!(value.as_ref(), "true" | "false") =>
            {
                json!(value == "true")
            }
            _ => return Err(format!("Invalid spectral query field: {key}")),
        };
        payload[key.as_ref()] = parsed;
    }
    Ok(payload)
}

fn number(value: &str, positive: bool) -> Result<Value, String> {
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err("Spectral index must be an integer".into());
    }
    let number = value
        .parse::<u32>()
        .map_err(|_| "Spectral index is out of range")?;
    if positive && number == 0 {
        return Err("Wavelength limit must be positive".into());
    }
    Ok(json!(number))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn spectral_queries_preserve_selection_and_reject_ambiguous_inputs() {
        let query = query_payload(
            Some("start=2&end=9&partition=test&source=1&target_index=2&include_y=true"),
            "spectra.data",
        )
        .unwrap();
        assert_eq!(
            query,
            json!({"start":2,"end":9,"partition":"test","source":1,"target_index":2,"include_y":true})
        );
        for query in [
            "source=-1",
            "source=1.2",
            "source=1&source=2",
            "partition=val",
            "include_y=yes",
            "max_wavelengths_returned=0",
            "path=/tmp/data",
        ] {
            assert!(
                query_payload(Some(query), "spectra.data").is_err(),
                "{query}"
            );
        }
        assert!(query_payload(Some("start=1"), "spectra.stats").is_err());
        assert!(query_payload(Some("source=1"), "playground.operators").is_err());
    }
}
