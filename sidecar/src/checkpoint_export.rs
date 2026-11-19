//! User-selected checkpoint downloads; Core retains container ownership.
use crate::{HttpRequest, HttpResponse, SidecarState};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

pub fn route(state: &Arc<Mutex<SidecarState>>, request: &HttpRequest) -> Option<HttpResponse> {
    if request.path != "/api/exports/n4a" {
        return None;
    }
    if request.method != "POST" {
        return Some(crate::method_not_allowed(
            &request.method,
            &request.path,
            "POST",
        ));
    }
    let (settings, host) = {
        let state = state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        (state.app_settings.clone(), state.scientific_host.clone())
    };
    let result = (|| -> Result<HttpResponse, String> {
        if request.query.is_some() {
            return Err("Checkpoint export does not accept query fields".into());
        }
        let mut payload: Value =
            serde_json::from_slice(&request.body).map_err(|error| error.to_string())?;
        if payload.as_object().is_none_or(|fields| {
            fields.keys().any(|key| {
                !matches!(
                    key.as_str(),
                    "sections" | "dataset_id" | "bundle_path" | "shap_job_id"
                )
            })
        }) {
            return Err("Unexpected checkpoint export fields".into());
        }
        let host = host.ok_or("Scientific library host is unavailable")?;
        if payload["sections"].get("shap").is_some() {
            if let Some(id) = payload["shap_job_id"].as_str() {
                let access = settings
                    .active_linked_workspace_access()?
                    .ok_or("No active workspace")?;
                let id = crate::library_analysis::identifier(id)?;
                payload["sections"]["shap"] =
                    crate::library_analysis::load_result(access.path(), &id)?;
            }
        }
        if payload["sections"].get("dataset").is_some() {
            if let Some(id) = payload["dataset_id"].as_str() {
                payload["dataset_config"] =
                    crate::playground::confined_dataset(&settings, id, &|operation, body| {
                        host.adapt_document(operation, body)
                            .map_err(|error| (400, error))
                    })
                    .map_err(|(_, detail)| detail)?;
            }
        }
        if payload["sections"].get("model").is_some() {
            let access = settings
                .active_linked_workspace_access()?
                .ok_or("No active workspace")?;
            let model = crate::general_prediction::model_payload(
                access.path(),
                &json!({"model_id":payload["bundle_path"], "model_source":"bundle"}),
            )?;
            payload["bundle_path"] = model["bundle_path"].clone();
            payload["archive_fingerprint"] = model["archive_fingerprint"].clone();
        }
        let value = host.adapt_document("results.export_n4a", &payload)?;
        let bytes = STANDARD
            .decode(
                value["content_base64"]
                    .as_str()
                    .ok_or("Missing checkpoint bytes")?,
            )
            .map_err(|error| error.to_string())?;
        Ok(
            HttpResponse::binary(200, bytes, "application/octet-stream").with_header(
                "Content-Disposition",
                "attachment; filename=\"checkpoint.n4a\"",
            ),
        )
    })();
    Some(
        result
            .unwrap_or_else(|detail| HttpResponse::json(400, json!({"detail":detail}).to_string())),
    )
}
