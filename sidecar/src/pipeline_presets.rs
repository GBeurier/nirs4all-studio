//! Studio-authored templates, compiled from the same assets as the editor oracle.
//! Rust selects and persists documents; the attested translator owns canonical
//! conversion. No estimator is instantiated while browsing or importing presets.

use serde_json::{json, Value};
use std::sync::OnceLock;

use crate::{settings::AppSettingsStore, HttpResponse};

const SOURCES: &[&str] = &[
    include_str!("../../api/presets/complex_pls.yaml"),
    include_str!("../../api/presets/complex_trees.yaml"),
    include_str!("../../api/presets/deep_nonlinear_exploration.yaml"),
    include_str!("../../api/presets/fast_result.yaml"),
    include_str!("../../api/presets/nonlinear_exploration.yaml"),
    include_str!("../../api/presets/simple_pls.yaml"),
    include_str!("../../api/presets/simple_trees_boosting.yaml"),
    include_str!("../../api/presets/ultra_pls.yaml"),
    include_str!("../../api/presets/ultra_slow.yaml"),
    include_str!("../../api/presets/ultra_trees.yaml"),
];
static PRESETS: OnceLock<Result<Vec<Value>, String>> = OnceLock::new();

fn catalogue() -> Result<&'static [Value], String> {
    PRESETS
        .get_or_init(|| {
            let mut presets = SOURCES
                .iter()
                .map(|source| normalize(source))
                .collect::<Result<Vec<_>, _>>()?;
            presets.sort_by_key(|preset| preset["complexity"].as_u64());
            Ok(presets)
        })
        .as_deref()
        .map_err(Clone::clone)
}

fn normalize(source: &str) -> Result<Value, String> {
    let yaml: serde_yaml::Value = serde_yaml::from_str(source).map_err(|e| e.to_string())?;
    let variants = yaml["variants"]
        .as_mapping()
        .ok_or("Preset variants missing")?;
    // YAML declaration order is UI order, independent of serde_json map features.
    let names = variants
        .keys()
        .map(|name| name.as_str().ok_or("Invalid variant name"))
        .collect::<Result<Vec<_>, _>>()?;
    if names.is_empty()
        || names
            .iter()
            .any(|name| !["regression", "classification"].contains(name))
    {
        return Err("Invalid preset variants".into());
    }
    let raw = serde_json::to_value(&yaml).map_err(|e| e.to_string())?;
    for key in ["id", "name", "description"] {
        if !raw[key].is_string() {
            return Err(format!("Invalid preset {key}"));
        }
    }
    let default = raw["default_variant"].as_str().unwrap_or(names[0]);
    if !names.contains(&default) {
        return Err("Invalid default variant".into());
    }
    for name in &names {
        let payload = &raw["variants"][name];
        if !matches!(payload["format"].as_str(), Some("yaml" | "json"))
            || payload["pipeline"].as_array().is_none_or(Vec::is_empty)
        {
            return Err(format!("Invalid preset variant {name}"));
        }
    }
    let complexity = raw["complexity"].as_i64().unwrap_or(5).clamp(1, 10);
    Ok(json!({
        "id":raw["id"], "name":raw["name"], "description":raw["description"],
        "task_type":default, "default_variant":default, "available_variants":names,
        "variants":raw["variants"], "complexity":complexity,
        "steps_count":raw["variants"][default]["pipeline"].as_array().map_or(0, Vec::len),
        "pipeline":raw["variants"][default]["pipeline"],
    }))
}

fn selection(id: &str, body: &[u8]) -> Result<(Value, String), (u16, String)> {
    if body.len() > crate::document_cpython::MAX_DOCUMENT_BYTES {
        return Err((413, "Preset request exceeds 2 MiB".into()));
    }
    let mut request = if body.is_empty() {
        json!({})
    } else {
        serde_json::from_slice::<Value>(body).map_err(|_| (400, "Invalid JSON request".into()))?
    };
    if request.is_null() {
        request = json!({});
    }
    if !request.is_object() {
        return Err((400, "Expected a preset request object".into()));
    }
    for field in ["name", "variant"] {
        if !request[field].is_null() && !request[field].is_string() {
            return Err((400, format!("{field} must be a string or null")));
        }
    }
    let presets = catalogue().map_err(|detail| (500, detail))?;
    let preset = presets
        .iter()
        .find(|preset| preset["id"] == id)
        .ok_or_else(|| (404, format!("Preset '{id}' not found")))?;
    let variant = request["variant"]
        .as_str()
        .filter(|text| !text.is_empty())
        .unwrap_or_else(|| preset["default_variant"].as_str().unwrap())
        .trim()
        .to_lowercase();
    let selected = &preset["variants"][&variant];
    if selected.is_null() {
        return Err((
            400,
            format!("Preset '{id}' does not provide variant '{variant}'"),
        ));
    }
    let name = request["name"]
        .as_str()
        .filter(|text| !text.is_empty())
        .unwrap_or_else(|| preset["name"].as_str().unwrap());
    Ok((
        json!({"payload": {
            "name":name, "description":preset["description"], "pipeline":selected["pipeline"],
        }}),
        variant,
    ))
}

pub fn route(
    settings: &AppSettingsStore,
    host: Option<&crate::scientific_cpython::CpythonScientificJobExecutor>,
    method: &str,
    path: &str,
    body: &[u8],
) -> Option<HttpResponse> {
    if method == "GET" && path == "/api/pipelines/presets" {
        return Some(match catalogue() {
            Ok(presets) => HttpResponse::json(
                200,
                json!({"presets":presets,"total":presets.len()}).to_string(),
            ),
            Err(detail) => error_response(500, &detail),
        });
    }
    if method != "POST" {
        return None;
    }
    let id = path.strip_prefix("/api/pipelines/from-preset/")?;
    Some(create(settings, host, id, body))
}

fn create(
    settings: &AppSettingsStore,
    host: Option<&crate::scientific_cpython::CpythonScientificJobExecutor>,
    id: &str,
    body: &[u8],
) -> HttpResponse {
    let (payload, variant) = match selection(id, body) {
        Ok(value) => value,
        Err((status, detail)) => return error_response(status, &detail),
    };
    let Some(host) = host else {
        return error_response(503, "Attested document library host unavailable");
    };
    let mut document = match host.adapt_document("pipeline.import", &payload) {
        Ok(value) if value.is_object() => value,
        Ok(_) => return error_response(502, "Document translator returned an invalid object"),
        Err(detail) => return error_response(400, &detail),
    };
    document["category"] = json!("preset");
    document["task_type"] = json!(variant);
    crate::workspace_documents::route(
        settings,
        "POST",
        "/api/pipelines",
        document.to_string().as_bytes(),
    )
    .unwrap_or_else(|| error_response(500, "Pipeline persistence route unavailable"))
}

fn error_response(status: u16, detail: &str) -> HttpResponse {
    HttpResponse::json(status, json!({"detail":detail}).to_string())
}

#[cfg(test)]
#[path = "pipeline_presets_tests.rs"]
mod tests;
