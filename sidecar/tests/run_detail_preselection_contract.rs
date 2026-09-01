use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::Connection;
use serde_json::{json, Value};
use studio_sidecar::{
    route_request, run_detail_preselection::STUDIO_RUN_DETAIL_PRESELECTION_CONTRACT, SidecarState,
};

fn test_directory() -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!(
        "studio-run-detail-preselection-{}-{nonce}",
        std::process::id()
    ))
}

fn write_settings(config: &Path, workspaces: &Value) {
    fs::create_dir_all(config).unwrap();
    fs::write(
        config.join("app_settings.json"),
        serde_json::to_vec(&json!({"version": "3.0", "linked_workspaces": workspaces})).unwrap(),
    )
    .unwrap();
}

fn workspace(id: &str, path: &Path) -> Value {
    json!({
        "id": id,
        "path": path,
        "name": id,
        "is_active": false,
        "linked_at": "2026-09-01T00:00:00",
        "last_scanned": null,
        "discovered": {},
    })
}

fn json_response(state: &mut SidecarState, path: &str) -> (u16, Value) {
    let response = route_request(state, "GET", path);
    (
        response.status,
        serde_json::from_str(&response.body).unwrap(),
    )
}

#[test]
fn contract_freezes_per_request_preselection_and_no_native_fallback() {
    let contract: Value = serde_json::from_str(STUDIO_RUN_DETAIL_PRESELECTION_CONTRACT).unwrap();
    assert_eq!(
        contract["schema_id"],
        "nirs4all.studio-run-detail-preselection.v1"
    );
    assert_eq!(contract["schema_version"], 1);
    assert_eq!(contract["workspace_store_schema_version"], 5);
    assert_eq!(contract["scope"]["frequency"], "once_per_target_request");
    assert_eq!(contract["scope"]["cache"], "forbidden");
    assert_eq!(
        contract["scope"]["activation"],
        "published_not_selected_by_renderer_until_owner_materializer_available"
    );
    assert_eq!(
        contract["decisions"]["scientific-plugin"]["selected_before_target_http"],
        true
    );
    assert_eq!(
        contract["transport"]["fallback_after_native_selection"],
        "none"
    );
    assert_eq!(contract["transport"]["native_network_retry"], "none");
    assert_eq!(contract["owner_materialization"]["status"], "unavailable");
    assert_eq!(
        contract["owner_materialization"]["consumer_parse_expanded_config"],
        "forbidden"
    );
    assert_eq!(
        contract["decisions"]["native-sidecar"]["currently_reachable"],
        false
    );
}

#[test]
fn exact_store_v5_is_verified_but_blocked_legacy_is_python_and_busy_is_rejected() {
    let root = test_directory();
    let config = root.join("config");
    let native = root.join("native");
    let legacy = root.join("legacy");
    let old_store = root.join("old-store");
    let busy = root.join("busy");
    for directory in [&native, &legacy, &old_store, &busy] {
        fs::create_dir_all(directory).unwrap();
    }
    let fixture =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/workspace_store_v5.sqlite");
    fs::copy(&fixture, native.join("store.sqlite")).unwrap();
    fs::copy(&fixture, busy.join("store.sqlite")).unwrap();
    fs::write(busy.join("store.sqlite-wal"), b"active writer").unwrap();
    let old_connection = Connection::open(old_store.join("store.sqlite")).unwrap();
    old_connection
        .execute("CREATE TABLE metadata (key TEXT, value TEXT)", [])
        .unwrap();
    old_connection
        .execute(
            "INSERT INTO metadata (key, value) VALUES ('schema_version', '4')",
            [],
        )
        .unwrap();
    drop(old_connection);
    write_settings(
        &config,
        &json!([
            workspace("native", &native),
            workspace("legacy", &legacy),
            workspace("old-store", &old_store),
            workspace("busy", &busy),
        ]),
    );

    let mut state = SidecarState::with_app_settings_dir(&config);
    let (native_status, native_body) = json_response(
        &mut state,
        "/sidecar/v1/workspaces/native/run-detail-preselection",
    );
    assert_eq!(native_status, 409);
    assert_eq!(native_body["target"], "reject");
    assert_eq!(native_body["verified_store_v5"], true);
    assert_eq!(native_body["store_schema_version"], 5);
    assert_eq!(
        native_body["reason"],
        "studio_run_detail_http_inputs_v1_materializer_unavailable"
    );

    for workspace_id in ["legacy", "old-store"] {
        let (status, body) = json_response(
            &mut state,
            &format!("/sidecar/v1/workspaces/{workspace_id}/run-detail-preselection"),
        );
        assert_eq!(status, 200);
        assert_eq!(body["target"], "scientific-plugin");
        assert_eq!(body["verified_store_v5"], false);
    }

    let (busy_status, busy_body) = json_response(
        &mut state,
        "/sidecar/v1/workspaces/busy/run-detail-preselection",
    );
    assert_eq!(busy_status, 409);
    assert_eq!(busy_body["target"], "reject");
    assert_eq!(busy_body["reason"], "workspace_store_busy");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn verified_store_cannot_reach_an_unmaterialized_native_target_route() {
    let root = test_directory();
    let config = root.join("config");
    let native = root.join("native");
    fs::create_dir_all(&native).unwrap();
    let fixtures = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    fs::copy(
        fixtures.join("workspace_store_v5.sqlite"),
        native.join("store.sqlite"),
    )
    .unwrap();
    write_settings(&config, &json!([workspace("native", &native)]));

    let mut state = SidecarState::with_app_settings_dir(&config);
    let run_id = "12345678-1234-5678-1234-567812345678";
    let (preselection_status, preselection) = json_response(
        &mut state,
        "/sidecar/v1/workspaces/native/run-detail-preselection",
    );
    assert_eq!(preselection_status, 409);
    assert_eq!(preselection["target"], "reject");
    assert_eq!(preselection["verified_store_v5"], true);

    let (status, response) =
        json_response(&mut state, &format!("/api/workspaces/native/runs/{run_id}"));
    assert_eq!(status, 404);
    assert_eq!(response["error"]["code"], "route_not_found");

    fs::remove_dir_all(root).unwrap();
}
