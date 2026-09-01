use std::{collections::BTreeSet, fs, path::PathBuf};

use serde_json::Value;
use studio_sidecar::PROTOCOL_VERSION;

fn studio_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("sidecar crate must be inside Studio")
        .to_path_buf()
}

fn read_json(path: PathBuf) -> Value {
    serde_json::from_str(&fs::read_to_string(path).expect("contract file must be readable"))
        .expect("contract file must contain JSON")
}

fn strings(value: &Value) -> BTreeSet<&str> {
    value
        .as_array()
        .expect("contract field must be an array")
        .iter()
        .map(|item| item.as_str().expect("contract list item must be a string"))
        .collect()
}

#[test]
fn native_job_lifecycle_contract_is_fail_closed_and_complete() {
    let root = studio_root();
    let contract = read_json(root.join("sidecar/contracts/studio_job_lifecycle_v1.json"));
    let oracle = read_json(root.join("docs/contracts/studio-v1/fixtures/behavior.snapshot.json"));

    assert_eq!(contract["schema_id"], "nirs4all.studio-job-lifecycle.v1");
    assert_eq!(contract["schema_version"], 1);
    assert_eq!(
        contract["ownership"]["control_plane"],
        "studio_sidecar_rust"
    );
    assert_eq!(contract["ownership"]["job_registry"], "studio_sidecar_rust");
    assert_eq!(
        contract["ownership"]["websocket_server"],
        "studio_sidecar_rust"
    );
    assert_eq!(
        contract["ownership"]["fastapi_or_uvicorn"],
        "forbidden_after_native_selection"
    );
    assert_eq!(
        contract["ownership"]["fallback_after_native_selection"],
        "none"
    );

    let statuses = strings(&contract["job"]["statuses"]);
    assert_eq!(
        statuses,
        BTreeSet::from(["cancelled", "completed", "failed", "pending", "running"])
    );
    assert_eq!(statuses, strings(&oracle["jobs"]["declared_statuses"]));
    assert_eq!(
        strings(&contract["job"]["types"]),
        strings(&oracle["jobs"]["declared_types"])
    );
    let cancellation_paths = oracle["jobs"]["cancellation_endpoints"]
        .as_array()
        .expect("oracle cancellation endpoints must be an array")
        .iter()
        .map(|entry| {
            entry["path"]
                .as_str()
                .expect("oracle cancellation path must be a string")
        })
        .collect::<BTreeSet<_>>();
    assert_eq!(
        strings(&contract["job"]["cancellation"]["legacy_endpoints"]),
        cancellation_paths
    );
    let terminal = strings(&contract["job"]["terminal_statuses"]);
    assert_eq!(
        terminal,
        BTreeSet::from(["cancelled", "completed", "failed"])
    );
    for status in terminal {
        assert_eq!(
            contract["job"]["transitions"][status]
                .as_array()
                .expect("terminal transition list must be an array")
                .len(),
            0,
            "terminal state {status} must not transition"
        );
    }
    assert_eq!(
        contract["job"]["cancellation"]["legacy_terminal_event"],
        "job_failed"
    );
    assert_eq!(
        contract["job"]["cancellation"]["job_cancelled_event_status"],
        "declared_but_unreachable"
    );
}

#[test]
fn websocket_cutover_contract_is_anchored_to_the_frozen_studio_v1_oracle() {
    let root = studio_root();
    let contract = read_json(root.join("sidecar/contracts/studio_job_lifecycle_v1.json"));
    let oracle = read_json(root.join("docs/contracts/studio-v1/fixtures/websocket.snapshot.json"));

    let contract_endpoints = strings(&contract["legacy_websocket"]["endpoints"]);
    let oracle_endpoints = oracle["endpoints"]
        .as_array()
        .expect("oracle endpoints must be an array")
        .iter()
        .map(|entry| {
            entry["path"]
                .as_str()
                .expect("oracle endpoint path must be a string")
        })
        .collect::<BTreeSet<_>>();
    assert_eq!(contract_endpoints, oracle_endpoints);

    let required_events = strings(&contract["legacy_websocket"]["required_emitted_job_events"]);
    for event in required_events {
        assert_eq!(
            oracle["payload_shapes"][event]["status"], "emitted",
            "{event} must remain an emitted frozen Studio V1 event"
        );
        assert_eq!(
            strings(&oracle["payload_shapes"][event]["envelope_keys"]),
            strings(&contract["legacy_websocket"]["renderer_envelope_keys"]),
            "{event} envelope must remain renderer-compatible"
        );
    }
    for event in strings(&contract["legacy_websocket"]["declared_unreachable_job_events"]) {
        assert_eq!(
            oracle["payload_shapes"][event]["status"], "unreachable",
            "{event} reachability change requires a reviewed contract exception"
        );
    }

    assert_eq!(
        contract["native_internal_stream"]["protocol_version"],
        PROTOCOL_VERSION
    );
    assert_eq!(contract["cutover"]["route_selection"], "forbidden");
    assert_eq!(
        contract["cutover"]["sidecar_http_registration"],
        "native_for_three_status_and_five_cancellation_aliases_only"
    );
    assert_eq!(
        contract["cutover"]["scientific_submission_route_selection"],
        "forbidden_until_executor_selected_and_preflighted"
    );
    assert_eq!(
        contract["cutover"]["fallback_after_native_selection"],
        "none"
    );
}
