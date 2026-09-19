//! Bounded Studio catalogue metadata, sharing the document writer's lock.
//! Dataset parsing and scientific store reads are never performed here.
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

use crate::{
    settings::AppSettingsStore,
    websocket_transport::rfc3339_now,
    workspace_documents::{
        catalogue, list_workspaces, save_catalogue, valid_identifier, DocumentResult, DOCUMENT_LOCK,
    },
    HttpRequest, HttpResponse, SidecarState,
};

fn invalid(message: &str) -> (u16, String) {
    (400, message.into())
}
fn corrupt(message: &str) -> (u16, String) {
    (500, message.into())
}

fn strings(value: Option<&Value>) -> DocumentResult<Vec<String>> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    let values = value
        .as_array()
        .ok_or_else(|| corrupt("Invalid catalogue membership list"))?;
    let mut result = Vec::new();
    for value in values {
        let text = value
            .as_str()
            .filter(|text| valid_identifier(text))
            .ok_or_else(|| corrupt("Invalid catalogue membership identifier"))?;
        if !result.iter().any(|item| item == text) {
            result.push(text.to_owned());
        }
    }
    Ok(result)
}

fn memberships(dataset: &Value) -> DocumentResult<Vec<String>> {
    let mut ids = strings(dataset.get("group_ids"))?;
    if ids.is_empty() {
        if let Some(id) = dataset.get("group_id").filter(|value| !value.is_null()) {
            let id = id
                .as_str()
                .filter(|id| valid_identifier(id))
                .ok_or_else(|| corrupt("Invalid legacy group identifier"))?;
            ids.push(id.to_owned());
        }
    }
    Ok(ids)
}

/// Merge the historical `group.dataset_ids` and current `dataset.group_ids` shapes.
/// A malformed persisted document is an error, never an empty replacement.
pub fn groups(document: &Value) -> DocumentResult<Value> {
    let empty = Vec::new();
    let groups = match document.get("groups") {
        None => &empty,
        Some(value) => value
            .as_array()
            .ok_or_else(|| corrupt("Invalid catalogue groups"))?,
    };
    let datasets = document
        .get("datasets")
        .and_then(Value::as_array)
        .ok_or_else(|| corrupt("Invalid catalogue datasets"))?;
    let mut dataset_ids = std::collections::HashSet::new();
    for dataset in datasets {
        let id = dataset
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| valid_identifier(id))
            .ok_or_else(|| corrupt("Invalid catalogue dataset identifier"))?;
        if !dataset_ids.insert(id) {
            return Err(corrupt("Duplicate catalogue dataset identifier"));
        }
        memberships(dataset)?;
    }
    let mut output = Vec::new();
    for group in groups {
        let id = group
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| valid_identifier(id))
            .ok_or_else(|| corrupt("Invalid catalogue group identifier"))?;
        let name = group
            .get("name")
            .and_then(Value::as_str)
            .ok_or_else(|| corrupt("Invalid catalogue group name"))?;
        if output.iter().any(|other: &Value| other["id"] == id) {
            return Err(corrupt("Duplicate catalogue group identifier"));
        }
        let mut ids = strings(group.get("dataset_ids"))?;
        for dataset in datasets {
            let dataset_id = dataset
                .get("id")
                .and_then(Value::as_str)
                .filter(|id| valid_identifier(id))
                .ok_or_else(|| corrupt("Invalid catalogue dataset identifier"))?;
            if memberships(dataset)?.iter().any(|item| item == id)
                && !ids.iter().any(|item| item == dataset_id)
            {
                ids.push(dataset_id.to_owned());
            }
        }
        output.push(json!({"id":id,"name":name,"dataset_ids":ids,
            "color":group.get("color").cloned().unwrap_or_else(|| json!("#3b82f6")),
            "created_at":group.get("created_at").cloned().unwrap_or_else(|| json!(""))}));
    }
    Ok(json!(output))
}

fn request(body: &[u8]) -> DocumentResult<Value> {
    if body.len() as u64 > crate::workspace_documents::MAX_DOCUMENT_BYTES {
        return Err((413, "Document exceeds the 2 MiB limit".into()));
    }
    let value: Value =
        serde_json::from_slice(body).map_err(|_| invalid("Expected a JSON object"))?;
    if !value.is_object() {
        return Err(invalid("Expected a JSON object"));
    }
    Ok(value)
}
fn name(body: &[u8]) -> DocumentResult<String> {
    let value = request(body)?;
    value
        .get("name")
        .and_then(Value::as_str)
        .filter(|name| {
            !name.trim().is_empty() && name.len() <= 256 && !name.chars().any(char::is_control)
        })
        .map(str::to_owned)
        .ok_or_else(|| invalid("Invalid group name"))
}

fn mutate(
    settings: &AppSettingsStore,
    method: &str,
    path: &str,
    body: &[u8],
) -> DocumentResult<Value> {
    let mut document = catalogue(settings)?;
    groups(&document)?;
    if document.get("groups").is_none() {
        document["groups"] = json!([]);
    }
    if path == "/api/workspace/groups" {
        if method == "GET" {
            return Ok(json!({"groups":groups(&document)?}));
        }
        if method != "POST" {
            return Err((405, "Allowed method: GET, POST".into()));
        }
        let name = name(body)?;
        let records = document["groups"]
            .as_array_mut()
            .expect("validated catalogue");
        if records.len() >= 256 {
            return Err((413, "Group catalogue exceeds 256 records".into()));
        }
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|error| (500, error.to_string()))?
            .as_nanos();
        let group = json!({"id":format!("group_{}_{nonce}",std::process::id()),"name":name,
            "dataset_ids":[],"color":"#3b82f6","created_at":rfc3339_now()});
        records.push(group.clone());
        save_catalogue(settings, &document)?;
        return Ok(json!({"success":true,"group":group}));
    }
    let tail = path
        .strip_prefix("/api/workspace/groups/")
        .ok_or_else(|| invalid("Invalid group route"))?;
    let parts: Vec<_> = tail.split('/').collect();
    if !valid_identifier(parts[0]) {
        return Err(invalid("Invalid group identifier"));
    }
    let id = parts[0];
    let index = document["groups"]
        .as_array()
        .expect("validated catalogue")
        .iter()
        .position(|group| group["id"] == id)
        .ok_or_else(|| (404, "Group not found".into()))?;
    match parts.as_slice() {
        [_] if method == "PUT" => {
            document["groups"][index]["name"] = json!(name(body)?);
        }
        [_] if method == "DELETE" => {
            document["groups"]
                .as_array_mut()
                .expect("validated catalogue")
                .remove(index);
            for dataset in document["datasets"]
                .as_array_mut()
                .expect("validated catalogue")
            {
                let ids: Vec<_> = memberships(dataset)?
                    .into_iter()
                    .filter(|other| other != id)
                    .collect();
                dataset["group_ids"] = json!(ids);
                dataset
                    .as_object_mut()
                    .expect("validated dataset")
                    .remove("group_id");
            }
        }
        [_, "datasets"] if method == "POST" => {
            let value = request(body)?;
            let dataset_id = value
                .get("dataset_id")
                .and_then(Value::as_str)
                .filter(|id| valid_identifier(id))
                .ok_or_else(|| invalid("dataset_id required and must be a valid identifier"))?;
            change_membership(&mut document, index, id, dataset_id, true)?;
        }
        [_, "datasets", dataset_id] if method == "DELETE" && valid_identifier(dataset_id) => {
            change_membership(&mut document, index, id, dataset_id, false)?;
        }
        _ => return Err(invalid("Unsupported group operation")),
    }
    save_catalogue(settings, &document)?;
    Ok(json!({"success":true}))
}

fn change_membership(
    document: &mut Value,
    group_index: usize,
    group_id: &str,
    dataset_id: &str,
    add: bool,
) -> DocumentResult<()> {
    let dataset = document["datasets"]
        .as_array_mut()
        .expect("validated catalogue")
        .iter_mut()
        .find(|dataset| dataset["id"] == dataset_id)
        .ok_or_else(|| (404, "Dataset not found".into()))?;
    let mut ids = memberships(dataset)?;
    ids.retain(|id| id != group_id);
    if add {
        ids.push(group_id.to_owned());
    }
    dataset["group_ids"] = json!(ids);
    dataset
        .as_object_mut()
        .expect("validated dataset")
        .remove("group_id");
    // Clear legacy membership too, otherwise old catalogues resurrect removed datasets.
    let group = &mut document["groups"][group_index];
    let mut ids = strings(group.get("dataset_ids"))?;
    ids.retain(|id| id != dataset_id);
    if add {
        ids.push(dataset_id.to_owned());
    }
    group["dataset_ids"] = json!(ids);
    Ok(())
}

fn recent(settings: &AppSettingsStore, query: Option<&str>) -> DocumentResult<Value> {
    let limit = if let Some(query) = query {
        let value = query
            .strip_prefix("limit=")
            .filter(|value| !value.is_empty() && value.bytes().all(|c| c.is_ascii_digit()))
            .ok_or_else(|| invalid("Expected a single limit parameter"))?;
        value
            .parse::<usize>()
            .ok()
            .filter(|limit| (1..=256).contains(limit))
            .ok_or_else(|| invalid("limit must be between 1 and 256"))?
    } else {
        10
    };
    let mut document = list_workspaces(settings)?;
    let workspaces = document["workspaces"]
        .as_array_mut()
        .ok_or_else(|| corrupt("Invalid linked workspace list"))?;
    workspaces.truncate(limit);
    let total = workspaces.len();
    Ok(json!({"workspaces":workspaces,"total":total}))
}

pub fn owns_path(path: &str) -> bool {
    path == "/api/workspace/recent"
        || path == "/api/workspace/groups"
        || path.starts_with("/api/workspace/groups/")
}

pub fn route_document(
    settings: &AppSettingsStore,
    method: &str,
    path: &str,
    query: Option<&str>,
    body: &[u8],
) -> Option<HttpResponse> {
    if !owns_path(path) {
        return None;
    }
    let result = if path == "/api/workspace/recent" {
        if method == "GET" {
            recent(settings, query)
        } else {
            Err((405, "Allowed method: GET".into()))
        }
    } else if query.is_some() {
        Err(invalid("Group routes do not accept query parameters"))
    } else {
        let _guard = DOCUMENT_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        mutate(settings, method, path, body)
    };
    Some(match result {
        Ok(value) => HttpResponse::json(200, value.to_string()),
        Err((status, detail)) => HttpResponse::json(status, json!({"detail":detail}).to_string()),
    })
}

pub fn route(runtime: &Arc<Mutex<SidecarState>>, request: &HttpRequest) -> Option<HttpResponse> {
    if !owns_path(&request.path) {
        return None;
    }
    let settings = runtime
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .app_settings
        .clone();
    route_document(
        &settings,
        &request.method,
        &request.path,
        request.query.as_deref(),
        &request.body,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::route_request_with_body;

    fn call(state: &mut SidecarState, method: &str, path: &str, body: Value) -> (u16, Value) {
        let encoded = body.to_string();
        drop(body);
        let response = route_request_with_body(state, method, path, encoded.as_bytes());
        (
            response.status,
            serde_json::from_str(&response.body).unwrap(),
        )
    }
    fn fixture(settings: &AppSettingsStore) {
        save_catalogue(settings,&json!({"schema_version":2,"extension":{"preserve":true},
            "datasets":[{"id":"d1","name":"Dataset","group_ids":[],"group_id":"g1","unknown":"kept"},
                {"id":"d2","group_ids":["g2"]}],
            "groups":[{"id":"g1","name":"Legacy","dataset_ids":["d1"],"extension":42},
                {"id":"g2","name":"Second","dataset_ids":[]}]})).unwrap();
    }

    #[test]
    fn groups_preserve_extensions_and_remove_legacy_memberships_after_restart() {
        let root = tempfile::tempdir().unwrap();
        let mut state = SidecarState::with_app_settings_dir(root.path());
        fixture(&state.app_settings);
        let original = call(&mut state, "GET", "/api/workspace/groups", json!({}));
        assert_eq!(original.0, 200);
        assert_eq!(original.1["groups"][0]["dataset_ids"], json!(["d1"]));
        assert_eq!(original.1["groups"][1]["dataset_ids"], json!(["d2"]));
        assert_eq!(
            call(
                &mut state,
                "DELETE",
                "/api/workspace/groups/g1/datasets/d1",
                json!({})
            )
            .0,
            200
        );
        assert_eq!(
            call(
                &mut state,
                "POST",
                "/api/workspace/groups/g2/datasets",
                json!({"dataset_id":"d1"})
            )
            .0,
            200
        );
        assert_eq!(
            call(
                &mut state,
                "POST",
                "/api/workspace/groups/g2/datasets",
                json!({"dataset_id":"d1"})
            )
            .0,
            200
        );
        assert_eq!(
            call(
                &mut state,
                "PUT",
                "/api/workspace/groups/g2",
                json!({"name":"Renamed"})
            )
            .0,
            200
        );
        let mut restarted = SidecarState::with_app_settings_dir(root.path());
        let loaded = call(&mut restarted, "GET", "/api/workspace/groups", json!({})).1;
        assert_eq!(loaded["groups"][0]["dataset_ids"], json!([]));
        assert_eq!(loaded["groups"][1]["dataset_ids"], json!(["d1", "d2"]));
        assert_eq!(loaded["groups"][1]["name"], "Renamed");
        assert_eq!(
            call(
                &mut restarted,
                "DELETE",
                "/api/workspace/groups/g2",
                json!({})
            )
            .0,
            200
        );
        let document = catalogue(&restarted.app_settings).unwrap();
        assert_eq!(document["extension"]["preserve"], true);
        assert_eq!(document["groups"][0]["extension"], 42);
        assert_eq!(document["datasets"][0]["unknown"], "kept");
        assert_eq!(document["datasets"][0]["group_ids"], json!([]));
        assert_eq!(document["datasets"][1]["group_ids"], json!([]));
        assert!(document["datasets"][0].get("group_id").is_none());
    }

    #[test]
    fn invalid_group_updates_leave_catalogue_bytes_unchanged() {
        let root = tempfile::tempdir().unwrap();
        let mut state = SidecarState::with_app_settings_dir(root.path());
        fixture(&state.app_settings);
        let path = root.path().join("dataset_links.json");
        let before = std::fs::read(&path).unwrap();
        for (method, path, body, status) in [
            ("POST", "/api/workspace/groups", json!({"name":"  "}), 400),
            (
                "PUT",
                "/api/workspace/groups/g1",
                json!({"name":"bad\nname"}),
                400,
            ),
            (
                "PUT",
                "/api/workspace/groups/missing",
                json!({"name":"Valid"}),
                404,
            ),
            (
                "POST",
                "/api/workspace/groups/missing/datasets",
                json!({"dataset_id":"d1"}),
                404,
            ),
            (
                "POST",
                "/api/workspace/groups/g1/datasets",
                json!({"dataset_id":"missing"}),
                404,
            ),
            (
                "POST",
                "/api/workspace/groups/g1/datasets",
                json!({"dataset_id":42}),
                400,
            ),
            (
                "DELETE",
                "/api/workspace/groups/../datasets/d1",
                json!({}),
                400,
            ),
            ("GET", "/api/workspace/groups?path=other", json!({}), 400),
        ] {
            let response = call(&mut state, method, path, body);
            assert_eq!(response.0, status, "{method} {path}: {}", response.1);
        }
        assert_eq!(std::fs::read(&path).unwrap(), before);
        std::fs::write(&path, b"{invalid").unwrap();
        assert_eq!(
            call(
                &mut state,
                "POST",
                "/api/workspace/groups",
                json!({"name":"Safe"})
            )
            .0,
            500
        );
        assert_eq!(std::fs::read(&path).unwrap(), b"{invalid");
    }

    #[test]
    fn concurrent_group_creates_do_not_lose_catalogue_updates() {
        let root = tempfile::tempdir().unwrap();
        let mut threads = Vec::new();
        for index in 0..12 {
            let config = root.path().to_owned();
            threads.push(std::thread::spawn(move || {
                let mut state = SidecarState::with_app_settings_dir(&config);
                assert_eq!(
                    call(
                        &mut state,
                        "POST",
                        "/api/workspace/groups",
                        json!({"name":format!("Group {index}")})
                    )
                    .0,
                    200
                );
            }));
        }
        for thread in threads {
            thread.join().unwrap();
        }
        let settings = AppSettingsStore::new(root.path());
        let document = catalogue(&settings).unwrap();
        assert_eq!(groups(&document).unwrap().as_array().unwrap().len(), 12);
    }

    #[test]
    fn recent_workspaces_and_default_updates_match_frontend_shape() {
        let root = tempfile::tempdir().unwrap();
        let mut state = SidecarState::with_app_settings_dir(root.path().join("config"));
        for index in 0..2 {
            let path = root.path().join(format!("workspace{index}"));
            assert_eq!(
                call(
                    &mut state,
                    "POST",
                    "/api/workspace/create",
                    json!({"path":path,"name":format!("Workspace {index}")})
                )
                .0,
                200
            );
            assert_eq!(
                call(
                    &mut state,
                    "POST",
                    "/api/workspace/select",
                    json!({"path":path})
                )
                .0,
                200
            );
        }
        let recent = call(
            &mut state,
            "GET",
            "/api/workspace/recent?limit=1",
            json!({}),
        );
        assert_eq!(recent.0, 200, "{}", recent.1);
        assert_eq!(recent.1["total"], 1);
        for field in [
            "path",
            "name",
            "created_at",
            "last_accessed",
            "num_datasets",
            "num_pipelines",
            "description",
        ] {
            assert!(
                recent.1["workspaces"][0].get(field).is_some(),
                "missing {field}"
            );
        }
        for query in [
            "limit=0",
            "limit=257",
            "limit=-1",
            "limit=1&limit=2",
            "path=other",
            "limit=",
        ] {
            assert_eq!(
                call(
                    &mut state,
                    "GET",
                    &format!("/api/workspace/recent?{query}"),
                    json!({})
                )
                .0,
                400
            );
        }
        let updated = call(
            &mut state,
            "PUT",
            "/api/workspace/data-defaults",
            json!({"delimiter":",","auto_detect":false}),
        );
        assert_eq!(updated.0, 200);
        assert_eq!(updated.1["defaults"]["delimiter"], ",");
        assert_eq!(updated.1["defaults"]["auto_detect"], false);
        assert_eq!(updated.1["defaults"]["has_header"], true);
        assert_eq!(
            call(&mut state, "GET", "/api/workspace/data-defaults", json!({})).1,
            updated.1["defaults"]
        );
    }
}
