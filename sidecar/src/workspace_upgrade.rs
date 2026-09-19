//! Schema-only workspace upgrade through the library owner, always to a fresh copy.
use crate::{
    legacy_conversion::{
        parse_request, LegacyConversionProcessOutput, LEGACY_CONVERSION_ROUTE,
        LEGACY_TRANSITION_STATUS_ROUTE,
    },
    HttpRequest, HttpResponse, SidecarState,
};
use rusqlite::{Connection, OpenFlags};
use serde_json::json;
use std::{
    path::Path,
    sync::{Arc, Mutex},
};

fn old_sqlite_schema(path: &Path) -> bool {
    let Ok(mut uri) = url::Url::from_file_path(path.join("store.sqlite")) else {
        return false;
    };
    // Format detection only. The owner separately refuses a live writer before copying.
    uri.set_query(Some("mode=ro&immutable=1"));
    Connection::open_with_flags(
        uri.as_str(),
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
    )
    .and_then(|connection| {
        connection.query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
    })
    .is_ok_and(|version| (2..5).contains(&version))
}

pub fn route(runtime: &Arc<Mutex<SidecarState>>, request: &HttpRequest) -> Option<HttpResponse> {
    if !matches!(
        (request.method.as_str(), request.path.as_str()),
        ("POST", LEGACY_CONVERSION_ROUTE) | ("GET", LEGACY_TRANSITION_STATUS_ROUTE)
    ) || request.query.is_some()
    {
        return None;
    }
    let (settings, host) = {
        let state = runtime
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        (state.app_settings.clone(), state.scientific_host.clone())
    };
    let active = settings
        .active_linked_workspace_record(false)
        .ok()
        .flatten()?;
    let path = std::path::PathBuf::from(active.get("path")?.as_str()?);
    if !old_sqlite_schema(&path) {
        return None;
    }
    let id = active.get("id")?.as_str()?;
    let output = path.with_file_name(format!(
        "{}-workspace-v5",
        path.file_name()?.to_string_lossy()
    ));
    let available = host
        .as_ref()
        .is_some_and(|host| host.library_facades_available());
    if request.method == "GET" {
        return Some(HttpResponse::json(200, json!({"path": path, "format": "sqlite-workspace-old-schema", "conversion_required": true,
            "message": "Upgrade a copy to the current workspace schema. The original workspace is preserved.",
            "default_output_path": output, "converter_available": available, "conversion_command": null}).to_string()));
    }
    let parsed = match parse_request(&request.body, &path, &output) {
        Ok(parsed) => parsed,
        Err(detail) => {
            return Some(HttpResponse::json(
                422,
                json!({"detail":detail}).to_string(),
            ))
        }
    };
    if parsed.dry_run {
        return Some(HttpResponse::json(200, json!({"success":true,"dry_run":true,"output_path":parsed.output_path,"linked_workspace_id":null,"activation_skipped":true,"verified":false}).to_string()));
    }
    let Some(host) = host.filter(|_| available) else {
        return Some(HttpResponse::json(
            503,
            json!({"detail":"Workspace upgrade library is unavailable"}).to_string(),
        ));
    };
    let payload = json!({"source":path,"output":parsed.output_path});
    Some(match host.adapt_document("workspace.upgrade", &payload) {
        Ok(receipt)
            if receipt["source_preserved"] == true && receipt["target_schema_version"] == 5 =>
        {
            crate::legacy_conversion_process_response(
                &settings,
                id,
                &parsed,
                &[],
                &LegacyConversionProcessOutput {
                    return_code: 0,
                    stdout: receipt.to_string(),
                    stderr: String::new(),
                },
            )
        }
        Ok(_) => HttpResponse::json(
            502,
            json!({"detail":"Invalid workspace upgrade receipt"}).to_string(),
        ),
        Err(detail) => HttpResponse::json(409, json!({"detail":detail}).to_string()),
    })
}
