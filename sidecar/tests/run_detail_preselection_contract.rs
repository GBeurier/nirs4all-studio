use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::Connection;
use serde_json::{json, Value};
use studio_sidecar::{
    route_request,
    run_detail_cpython::{
        MAX_RUN_DETAIL_OWNER_INPUT_BYTES, MAX_RUN_DETAIL_OWNER_OUTPUT_BYTES,
        MAX_RUN_DETAIL_OWNER_STDERR_BYTES, RUN_DETAIL_OWNER_PREFLIGHT_TIMEOUT,
        RUN_DETAIL_OWNER_TIMEOUT,
    },
    run_detail_preselection::STUDIO_RUN_DETAIL_PRESELECTION_CONTRACT,
    SidecarState,
};

#[cfg(unix)]
fn owner_host(root: &Path, owner_fixture: &str) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;

    let path = root.join("owner-python");
    let escaped = owner_fixture.replace('\'', "'\\''");
    fs::write(
        &path,
        format!(
            "#!/bin/sh\ninput=$(cat)\nif [ -z \"$input\" ]; then\n  printf %s '{{\"callable\":\"nirs4all.pipeline.storage.studio_run_detail_http_inputs_v1\",\"ready\":true}}'\nelse\n  printf %s '{escaped}'\nfi\n"
        ),
    )
    .unwrap();
    let mut permissions = fs::metadata(&path).unwrap().permissions();
    permissions.set_mode(0o700);
    fs::set_permissions(&path, permissions).unwrap();
    path
}

#[cfg(unix)]
fn failing_owner_host(root: &Path, secret_path: &Path) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;

    let path = root.join("failing-owner-python");
    fs::write(
        &path,
        format!(
            "#!/bin/sh\ninput=$(cat)\nif [ -z \"$input\" ]; then\n  printf %s '{{\"callable\":\"nirs4all.pipeline.storage.studio_run_detail_http_inputs_v1\",\"ready\":true}}'\nelse\n  printf %s \"$input {}\" >&2\n  exit 7\nfi\n",
            secret_path.display()
        ),
    )
    .unwrap();
    let mut permissions = fs::metadata(&path).unwrap().permissions();
    permissions.set_mode(0o700);
    fs::set_permissions(&path, permissions).unwrap();
    path
}

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
        "renderer_selects_once_before_each_bare_run_detail_target_request"
    );
    assert!(contract["decisions"].get("scientific-plugin").is_none());
    assert_eq!(contract["transport"]["python_http_target"], "absent");
    assert_eq!(
        contract["transport"]["sidecar_unavailable_before_selection"],
        "reject_503"
    );
    assert_eq!(
        contract["transport"]["fallback_after_native_selection"],
        "none"
    );
    assert_eq!(contract["transport"]["native_network_retry"], "none");
    assert_eq!(
        contract["owner_materialization"]["status"],
        "available_and_qualified"
    );
    assert_eq!(
        contract["owner_materialization"]["consumer_parse_expanded_config"],
        "forbidden"
    );
    assert_eq!(
        contract["decisions"]["native-sidecar"]["currently_reachable"],
        true
    );
    assert_eq!(contract["bridge_bounds"]["isolated_mode"], "-I");
    assert_eq!(
        contract["bridge_bounds"]["input_bytes"],
        MAX_RUN_DETAIL_OWNER_INPUT_BYTES
    );
    assert_eq!(
        contract["bridge_bounds"]["preflight_timeout_ms"],
        u64::try_from(RUN_DETAIL_OWNER_PREFLIGHT_TIMEOUT.as_millis()).unwrap()
    );
    assert_eq!(
        contract["bridge_bounds"]["request_timeout_ms"],
        u64::try_from(RUN_DETAIL_OWNER_TIMEOUT.as_millis()).unwrap()
    );
    assert_eq!(
        contract["bridge_bounds"]["stdout_bytes"],
        MAX_RUN_DETAIL_OWNER_OUTPUT_BYTES
    );
    assert_eq!(
        contract["bridge_bounds"]["stderr_bytes"],
        MAX_RUN_DETAIL_OWNER_STDERR_BYTES
    );
}

#[test]
fn exact_store_v5_is_verified_but_legacy_and_busy_are_rejected() {
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
    assert_eq!(native_status, 503);
    assert_eq!(native_body["target"], "reject");
    assert_eq!(native_body["verified_store_v5"], true);
    assert_eq!(native_body["store_schema_version"], 5);
    assert_eq!(native_body["reason"], "python_plugin_host_unconfigured");

    for workspace_id in ["legacy", "old-store"] {
        let (status, body) = json_response(
            &mut state,
            &format!("/sidecar/v1/workspaces/{workspace_id}/run-detail-preselection"),
        );
        assert_eq!(status, 501);
        assert_eq!(body["target"], "reject");
        assert_eq!(body["verified_store_v5"], false);
        assert!(body["reason"]
            .as_str()
            .expect("reason must be a string")
            .ends_with("_rust_only"));
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
fn verified_store_cannot_reach_native_target_without_a_configured_host() {
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
    assert_eq!(preselection_status, 503);
    assert_eq!(preselection["target"], "reject");
    assert_eq!(preselection["verified_store_v5"], true);

    let (status, response) =
        json_response(&mut state, &format!("/api/workspaces/native/runs/{run_id}"));
    assert_eq!(status, 503);
    assert_eq!(response["error"]["code"], "python_plugin_unavailable");
    assert_eq!(response["error"]["details"], json!({}));

    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[test]
fn preflighted_store_v5_routes_through_owner_host_and_rust_composition() {
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
    fs::write(
        config.join("dataset_links.json"),
        serde_json::to_vec(&json!({
            "version": "1.0",
            "schema_version": 1,
            "datasets": [{
                "id": "linked-corn",
                "name": "Corn",
                "path": "/datasets/corn"
            }],
            "groups": []
        }))
        .unwrap(),
    )
    .unwrap();
    let owner_fixture = fs::read_to_string(
        fixtures.join("workspace_store_v5_run_detail_http_inputs.response.json"),
    )
    .unwrap();
    let host = owner_host(&root, &owner_fixture);
    let database = native.join("store.sqlite");
    let before = fs::metadata(&database).unwrap();
    let mut state = SidecarState::with_run_detail_host(&host, &config);

    let (preselection_status, preselection) = json_response(
        &mut state,
        "/sidecar/v1/workspaces/native/run-detail-preselection",
    );
    assert_eq!(preselection_status, 200);
    assert_eq!(preselection["target"], "native-sidecar");
    assert_eq!(preselection["verified_store_v5"], true);
    assert_eq!(preselection["reason"], "store_v5_owner_materializer_ready");

    let run_id = "12345678-1234-5678-1234-567812345678";
    let (status, response) =
        json_response(&mut state, &format!("/api/workspaces/native/runs/{run_id}"));
    let expected: Value = serde_json::from_str(
        &fs::read_to_string(fixtures.join("workspace_store_v5_run_detail_composed.response.json"))
            .unwrap(),
    )
    .unwrap();
    assert_eq!(status, 200);
    assert_eq!(response, expected);
    assert!(!response
        .to_string()
        .contains(native.to_string_lossy().as_ref()));
    let after = fs::metadata(&database).unwrap();
    assert_eq!(before.len(), after.len());
    assert_eq!(before.modified().unwrap(), after.modified().unwrap());
    for suffix in ["-wal", "-shm", "-journal"] {
        assert!(!PathBuf::from(format!("{}{suffix}", database.display())).exists());
    }

    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[test]
fn owner_stderr_and_resolved_workspace_path_never_reach_the_http_response() {
    let root = test_directory();
    let config = root.join("config");
    let native = root.join("secret-workspace-path");
    fs::create_dir_all(&native).unwrap();
    let fixtures = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    fs::copy(
        fixtures.join("workspace_store_v5.sqlite"),
        native.join("store.sqlite"),
    )
    .unwrap();
    write_settings(&config, &json!([workspace("native", &native)]));
    let host = failing_owner_host(&root, &native);
    let mut state = SidecarState::with_run_detail_host(&host, &config);

    let (preselection_status, preselection) = json_response(
        &mut state,
        "/sidecar/v1/workspaces/native/run-detail-preselection",
    );
    assert_eq!(preselection_status, 200);
    assert_eq!(preselection["target"], "native-sidecar");

    let response = route_request(
        &mut state,
        "GET",
        "/api/workspaces/native/runs/12345678-1234-5678-1234-567812345678",
    );
    assert_eq!(response.status, 502);
    assert!(!response.body.contains(native.to_string_lossy().as_ref()));
    assert!(!response.body.contains("workspace_path"));
    assert!(!response.body.contains("store.sqlite"));
    let body: Value = serde_json::from_str(&response.body).unwrap();
    assert_eq!(body["error"]["code"], "python_plugin_preflight_failed");
    assert_eq!(
        body["error"]["details"]["reason"],
        "python_plugin_process_failed"
    );

    fs::remove_dir_all(root).unwrap();
}
