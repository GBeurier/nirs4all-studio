use std::{fs, path::PathBuf};

use serde_json::Value;
use studio_sidecar::legacy_conversion::{
    LEGACY_CONVERSION_ROUTE, LEGACY_CONVERSION_TIMEOUT, LEGACY_TRANSITION_STATUS_ROUTE,
    MAX_CONVERTER_STDERR_BYTES, MAX_CONVERTER_STDOUT_BYTES,
};

fn contract() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("contracts/studio_legacy_workspace_conversion_v1.json");
    serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
}

#[test]
fn checked_in_contract_matches_the_rust_route_and_process_bounds() {
    let contract = contract();
    assert_eq!(
        contract["schema_id"],
        "nirs4all.studio-legacy-workspace-conversion.v1"
    );
    assert_eq!(
        contract["routes"]["transition_status"],
        format!("GET {LEGACY_TRANSITION_STATUS_ROUTE}")
    );
    assert_eq!(
        contract["routes"]["convert"],
        format!("POST {LEGACY_CONVERSION_ROUTE}")
    );
    assert_eq!(
        contract["converter"]["timeout_seconds"],
        LEGACY_CONVERSION_TIMEOUT.as_secs()
    );
    assert_eq!(
        contract["converter"]["stdout_limit_bytes"],
        MAX_CONVERTER_STDOUT_BYTES
    );
    assert_eq!(
        contract["converter"]["stderr_limit_bytes"],
        MAX_CONVERTER_STDERR_BYTES
    );
    assert_eq!(
        contract["converter"]["qualified_identity"]["version"],
        "0.0.7"
    );
    assert_eq!(
        contract["converter"]["qualified_identity"]["source_commit"],
        "88c2bc1e29603049cdbf1a1080a35845edf2f3c9"
    );
    assert_eq!(
        contract["converter"]["qualified_identity"]["readers"]["duckdb"]["version"],
        "1.5.5"
    );
    assert_eq!(
        contract["converter"]["qualified_identity"]["readers"]["duckdb"]["functional_probe"],
        "in-memory-select-40-plus-2"
    );
    assert_eq!(
        contract["converter"]["qualified_identity"]["readers"]["pyarrow"]["functional_probe"],
        "in-memory-round-trip"
    );
    assert_eq!(contract["converter"]["reader_cleanup_timeout_seconds"], 2);
    assert_eq!(contract["converter"]["unbounded_reader_join"], "forbidden");
    assert_eq!(
        contract["converter"]["execution_gate"],
        "runtime_rechecks_attestation_immediately_before_every_spawn"
    );
    assert_eq!(
        contract["converter"]["windows_job_policy"],
        "launcher_assigns_itself_before_python_spawn_kill_on_close_no_breakaway"
    );
}

#[test]
fn exit_and_rollback_policy_prevents_false_success_or_source_loss() {
    let contract = contract();
    assert_eq!(contract["exit_codes"]["0"]["http_status"], 200);
    assert_eq!(
        contract["exit_codes"]["10"]["automatic_activation"],
        "forbidden"
    );
    assert_eq!(contract["exit_codes"]["20"]["http_status"], 422);
    assert_eq!(contract["exit_codes"]["30"]["http_status"], 422);
    assert_eq!(contract["exit_codes"]["40"]["http_status"], 409);
    assert_eq!(contract["exit_codes"]["70"]["http_status"], 500);
    assert_eq!(contract["exit_codes"]["other"]["http_status"], 502);
    assert_eq!(contract["rollback"]["legacy_source_retained"], true);
    assert_eq!(contract["rollback"]["previous_workspace_unlinked"], false);
    assert_eq!(
        contract["rollback"]["activated_store_consumption"],
        "persisted_sha256_revalidated_fail_closed_before_every_linked_workspace_path_resolution"
    );
    assert_eq!(contract["converter"]["python_http"], "forbidden");
    assert_eq!(
        contract["compatibility_exceptions"]["STU-CONV-SYNC-001"]["status"],
        "approved"
    );
}
