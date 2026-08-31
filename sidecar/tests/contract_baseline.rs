use std::{
    collections::BTreeSet,
    fs,
    panic::{catch_unwind, AssertUnwindSafe},
    path::PathBuf,
    process::Command,
};

use serde_json::Value;
use studio_sidecar::{route_request, SidecarState, LEGACY_ROUTE_PARITY, PROTOCOL_VERSION};

fn studio_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .to_path_buf()
}

fn read_json(path: PathBuf) -> Value {
    serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
}

fn assert_object_keys(value: &Value, expected: &[&str]) {
    let keys = value
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    assert_eq!(keys, expected.iter().copied().collect());
}

fn json_at_path<'a>(value: &'a Value, path: &[&str]) -> &'a Value {
    path.iter().fold(value, |current, segment| {
        current
            .get(segment)
            .unwrap_or_else(|| panic!("missing baseline JSON path segment {segment}"))
    })
}

fn assert_known_legacy_response(
    reference: &Value,
    baseline: &Value,
    reference_name: &str,
    expected_http_path: &str,
    baseline_path: &[&str],
) {
    let declared = &reference["known_legacy_responses"][reference_name];
    assert_object_keys(declared, &["path", "required_keys", "status"]);
    assert_eq!(
        declared["path"], expected_http_path,
        "{reference_name} path"
    );

    let expected_keys = declared["required_keys"]
        .as_array()
        .unwrap_or_else(|| panic!("{reference_name} required_keys must be an array"));
    let expected_keys = expected_keys
        .iter()
        .map(|value| {
            value
                .as_str()
                .unwrap_or_else(|| panic!("{reference_name} required_keys must contain strings"))
        })
        .collect::<BTreeSet<_>>();
    assert_eq!(
        expected_keys.len(),
        declared["required_keys"].as_array().unwrap().len(),
        "{reference_name} required_keys must not contain duplicates"
    );

    let response = json_at_path(baseline, baseline_path);
    assert_eq!(
        response["status"], declared["status"],
        "{reference_name} status"
    );
    let actual_keys = response["body"]
        .as_object()
        .unwrap_or_else(|| panic!("{reference_name} baseline body must be an object"))
        .keys()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    assert_eq!(actual_keys, expected_keys, "{reference_name} required_keys");
}

#[test]
fn r1_fixture_references_the_frozen_studio_v1_snapshot_and_declares_its_difference() {
    let root = studio_root();
    let reference_path = root.join("sidecar/fixtures/studio-v1-reference.json");
    let reference = read_json(reference_path.clone());
    let baseline = read_json(
        reference_path
            .parent()
            .unwrap()
            .join(reference["reference_fixture"].as_str().unwrap()),
    );

    assert_object_keys(
        &reference,
        &[
            "reference_contract",
            "reference_fixture",
            "purpose",
            "known_legacy_responses",
            "r1_intentional_difference",
        ],
    );
    assert_eq!(reference["reference_contract"], "studio-v1");
    assert_eq!(
        reference["reference_fixture"],
        "../../docs/contracts/studio-v1/fixtures/behavior.snapshot.json"
    );
    assert_object_keys(
        &reference["known_legacy_responses"],
        &["health_post_lifespan", "readiness_post_lifespan"],
    );
    assert_eq!(
        reference["r1_intentional_difference"]["legacy_route_parity"],
        LEGACY_ROUTE_PARITY
    );

    assert_eq!(baseline["contract_version"], "studio-v1");
    assert_known_legacy_response(
        &reference,
        &baseline,
        "health_post_lifespan",
        "/api/health",
        &["readiness", "post_lifespan", "health"],
    );
    assert_known_legacy_response(
        &reference,
        &baseline,
        "readiness_post_lifespan",
        "/api/system/readiness",
        &["readiness", "post_lifespan", "readiness"],
    );
}

#[test]
fn legacy_reference_rejects_status_and_required_key_mutations() {
    let root = studio_root();
    let reference_path = root.join("sidecar/fixtures/studio-v1-reference.json");
    let reference = read_json(reference_path.clone());
    let baseline = read_json(
        reference_path
            .parent()
            .unwrap()
            .join(reference["reference_fixture"].as_str().unwrap()),
    );

    let mut wrong_status = reference.clone();
    wrong_status["known_legacy_responses"]["health_post_lifespan"]["status"] = 201.into();
    assert!(catch_unwind(AssertUnwindSafe(|| {
        assert_known_legacy_response(
            &wrong_status,
            &baseline,
            "health_post_lifespan",
            "/api/health",
            &["readiness", "post_lifespan", "health"],
        );
    }))
    .is_err());

    let mut wrong_keys = reference;
    wrong_keys["known_legacy_responses"]["readiness_post_lifespan"]["required_keys"] =
        serde_json::json!(["core_ready"]);
    assert!(catch_unwind(AssertUnwindSafe(|| {
        assert_known_legacy_response(
            &wrong_keys,
            &baseline,
            "readiness_post_lifespan",
            "/api/system/readiness",
            &["readiness", "post_lifespan", "readiness"],
        );
    }))
    .is_err());
}

#[test]
fn bootstrap_routes_match_the_frozen_health_and_readiness_contract() {
    let root = studio_root();
    let baseline = read_json(root.join("docs/contracts/studio-v1/fixtures/behavior.snapshot.json"));
    let mut state = SidecarState::default();
    let health: Value =
        serde_json::from_str(&route_request(&mut state, "GET", "/api/health").body).unwrap();
    let readiness: Value =
        serde_json::from_str(&route_request(&mut state, "GET", "/api/system/readiness").body)
            .unwrap();

    let legacy_health = &baseline["readiness"]["post_lifespan"]["health"]["body"];
    let legacy_body = &baseline["readiness"]["post_lifespan"]["readiness"]["body"];
    assert_eq!(health, *legacy_health);
    assert_object_keys(
        legacy_body,
        &[
            "core_ready",
            "elapsed_seconds",
            "ml_error",
            "ml_loading",
            "ml_ready",
            "workspace_ready",
        ],
    );
    assert_object_keys(
        &readiness,
        &[
            "core_ready",
            "elapsed_seconds",
            "ml_error",
            "ml_loading",
            "ml_ready",
            "workspace_ready",
        ],
    );
    assert_eq!(readiness["core_ready"], true);
    assert_eq!(readiness["ml_error"], Value::Null);
    assert_eq!(readiness["ml_loading"], false);
    assert_eq!(readiness["ml_ready"], false);
    assert_eq!(readiness["workspace_ready"], false);
    assert!(readiness["elapsed_seconds"].is_number());
}

#[test]
fn cli_smoke_prints_r1_readiness_without_starting_a_server() {
    let executable = env!("CARGO_BIN_EXE_studio-sidecar");
    let output = Command::new(executable)
        .arg("--smoke-readiness")
        .output()
        .unwrap();
    assert!(output.status.success());
    let stdout = String::from_utf8(output.stdout).unwrap();
    let readiness: Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(readiness["sidecar_ready"], true);
    assert_eq!(readiness["protocol_version"], PROTOCOL_VERSION);
    assert_eq!(readiness["scientific_execution"], "unavailable");
}

#[test]
fn configured_python_plugin_host_can_import_nirs4all_without_enabling_execution() {
    let Ok(python_plugin_host) = std::env::var("NIRS4ALL_TEST_PYTHON_PLUGIN_HOST") else {
        return;
    };
    let mut state = SidecarState::with_python_plugin_host(python_plugin_host);
    let response = route_request(&mut state, "GET", "/sidecar/v1/python/preflight");
    assert_eq!(
        response.status, 200,
        "configured Python plugin host preflight"
    );
    let body: Value = serde_json::from_str(&response.body).unwrap();
    assert_eq!(body["bridge"], "python-subprocess");
    assert_eq!(body["nirs4all_import"], true);
    assert_eq!(body["scientific_execution"], "unavailable");

    let capabilities = route_request(&mut state, "GET", "/api/system/capabilities");
    assert_eq!(
        capabilities.status, 200,
        "configured Python capabilities bridge"
    );
    let capabilities_body: Value = serde_json::from_str(&capabilities.body).unwrap();
    let values = capabilities_body["capabilities"].as_object().unwrap();
    assert_eq!(values.len(), 7);
    assert_eq!(values["nirs4all"], true);
    assert!(values.values().all(Value::is_boolean));

    let system_info = route_request(&mut state, "GET", "/api/system/info");
    assert_eq!(
        system_info.status, 200,
        "configured Python system-info bridge"
    );
    let system_info_body: Value = serde_json::from_str(&system_info.body).unwrap();
    assert!(system_info_body["python"]["version"].is_string());
    assert!(system_info_body["python"]["executable"].is_string());
    assert!(system_info_body["system"]["os"].is_string());
    assert!(system_info_body["nirs4all_version"]
        .as_str()
        .is_some_and(|value| !value.is_empty()));
    assert!(system_info_body["packages"]
        .as_object()
        .unwrap()
        .values()
        .all(Value::is_string));
}
