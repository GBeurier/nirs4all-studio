//! Native binary download of library-owned portable prediction arrays.
use crate::{HttpRequest, HttpResponse, SidecarState};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
};

fn endpoint(path: &str) -> Option<Option<&str>> {
    if path == "/api/aggregated-predictions/export" {
        return Some(None);
    }
    let dataset = path
        .strip_prefix("/api/aggregated-predictions/export/")?
        .strip_suffix(".parquet")?;
    (!dataset.is_empty() && !dataset.contains('/')).then_some(Some(dataset))
}

pub fn route(runtime: &Arc<Mutex<SidecarState>>, request: &HttpRequest) -> Option<HttpResponse> {
    let dataset = endpoint(&request.path)?;
    let error =
        |status, detail: String| HttpResponse::json(status, json!({"detail":detail}).to_string());
    let method = if dataset.is_some() { "GET" } else { "POST" };
    if request.method != method {
        return Some(crate::method_not_allowed(
            &request.method,
            &request.path,
            method,
        ));
    }
    let selection = match selection(request, dataset) {
        Ok(value) => value,
        Err(detail) => return Some(error(400, detail)),
    };
    let (settings, host) = {
        let state = runtime
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        (state.app_settings.clone(), state.scientific_host.clone())
    };
    let access = match settings.active_linked_workspace_access() {
        Ok(Some(value)) => value,
        Ok(None) => return Some(error(409, "No active workspace".into())),
        Err(detail) => return Some(error(409, detail)),
    };
    let Some(host) = host else {
        return Some(error(
            503,
            "Scientific library runtime is unavailable".into(),
        ));
    };
    let value = match host.adapt_document(
        "results.export",
        &json!({"workspace_path":access.path(),"request":selection}),
    ) {
        Ok(value) => value,
        Err(detail) => {
            return Some(error(
                if detail.starts_with("not_found:") {
                    404
                } else {
                    400
                },
                detail,
            ))
        }
    };
    Some(match binary(&value) {
        Ok(response) => response,
        Err(detail) => error(502, detail),
    })
}

fn selection(request: &HttpRequest, dataset: Option<&str>) -> Result<Value, String> {
    if let Some(raw) = dataset {
        if !request.body.is_empty() {
            return Err("Prediction export GET takes no body".into());
        }
        let name = percent_encoding::percent_decode_str(raw)
            .decode_utf8()
            .map_err(|_| "Invalid dataset name")?;
        if name.is_empty() || name.len() > 256 || name.contains('\0') {
            return Err("Invalid dataset name".into());
        }
        let mut value = json!({"dataset_names":[name],"format":"parquet"});
        let mut seen = HashSet::new();
        for (key, filter) in
            url::form_urlencoded::parse(request.query.as_deref().unwrap_or_default().as_bytes())
        {
            if !matches!(key.as_ref(), "partition" | "model_name")
                || !seen.insert(key.to_string())
                || filter.is_empty()
                || filter.len() > 256
                || filter.contains('\0')
            {
                return Err("Invalid prediction export filter".into());
            }
            value[key.as_ref()] = json!(filter);
        }
        return Ok(value);
    }
    if request
        .query
        .as_deref()
        .is_some_and(|query| !query.is_empty())
        || request.body.len() > 65536
    {
        return Err("Invalid prediction export request".into());
    }
    let value: Value =
        serde_json::from_slice(&request.body).map_err(|_| "Expected prediction export object")?;
    let fields = value
        .as_object()
        .ok_or("Expected prediction export object")?;
    if fields
        .keys()
        .any(|key| !matches!(key.as_str(), "format" | "dataset_names"))
        || !matches!(value["format"].as_str(), Some("parquet" | "zip"))
    {
        return Err("Invalid prediction export fields".into());
    }
    if let Some(names) = value.get("dataset_names") {
        let names = names.as_array().ok_or("dataset_names must be an array")?;
        if names.is_empty()
            || names.len() > 128
            || names.iter().any(|name| {
                name.as_str()
                    .is_none_or(|name| name.is_empty() || name.len() > 256 || name.contains('\0'))
            })
        {
            return Err("Invalid prediction export dataset names".into());
        }
    }
    Ok(value)
}

fn binary(value: &Value) -> Result<HttpResponse, String> {
    let encoded = value["content_base64"]
        .as_str()
        .ok_or("Missing export bytes")?;
    if encoded.len() > 32 * 1024 * 1024 {
        return Err("Prediction export exceeds 24 MiB".into());
    }
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| "Invalid export encoding")?;
    if bytes.len() > 24 * 1024 * 1024 {
        return Err("Prediction export exceeds 24 MiB".into());
    }
    let name = value["filename"]
        .as_str()
        .ok_or("Missing export filename")?;
    if name.is_empty() || name.len() > 256 || name.contains(['/', '\\', '\0', '\r', '\n', '"']) {
        return Err("Invalid export filename".into());
    }
    let media = match value["media_type"].as_str() {
        Some("application/zip") => "application/zip",
        Some("application/octet-stream") => "application/octet-stream",
        _ => return Err("Invalid export media type".into()),
    };
    let ascii_name: String = name
        .chars()
        .map(|character| if character.is_ascii() { character } else { '_' })
        .collect();
    let encoded_name =
        percent_encoding::utf8_percent_encode(name, percent_encoding::NON_ALPHANUMERIC);
    Ok(HttpResponse::binary(200, bytes, media).with_header(
        "Content-Disposition",
        format!("attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{encoded_name}"),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parquet_bytes_are_preserved_and_header_injection_rejected() {
        let bytes = b"PAR1\x00\xff\x80PAR1";
        let value = json!({"content_base64":STANDARD.encode(bytes),"filename":"Corn.parquet","media_type":"application/octet-stream"});
        let response = binary(&value).unwrap();
        assert_eq!(response.body_bytes.as_deref(), Some(bytes.as_slice()));
        let mut unsafe_value = value;
        unsafe_value["filename"] = json!("evil\r\nheader.parquet");
        assert!(binary(&unsafe_value).is_err());
    }
    #[test]
    fn export_routes_exclude_unknown_suffixes() {
        assert_eq!(
            endpoint("/api/aggregated-predictions/export/Coffee.parquet"),
            Some(Some("Coffee"))
        );
        assert!(endpoint("/api/aggregated-predictions/export/../Coffee.parquet").is_none());
        assert!(endpoint("/api/aggregated-predictions/export").is_some());
    }
}
