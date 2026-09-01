// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! dag-ml-data emit (EPIC 10). Builds a `CoordinatorDataPlanEnvelope` from each
//! contract-corpus case and asserts it is valid — `from_parts` already
//! fingerprints + self-validates, and the JSON round-trip + `validate()` here is
//! exactly what `dag-ml-data-cli validate-envelope` does, run in-process so the
//! check needs no external binary. The full cross-CLI conformance (both
//! ecosystem CLIs) lives in `tests/dag_ml_data/verify_cross_cli.sh`.

use std::path::{Path, PathBuf};

use dag_ml_data::{CoordinatorDataPlanEnvelope, REPRESENTATION_SIGNAL_1D};
use nirs4all_io::infer::infer_path;
use nirs4all_io::materialize::assemble;
use nirs4all_io_dagml::to_dag_ml_data;

fn corpus(case: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .expect("repo root")
        .join("tests/goldens/contract/corpus")
        .join(case)
}

fn emit(case: &str) -> CoordinatorDataPlanEnvelope {
    let dir = corpus(case);
    let plan = infer_path(&dir.to_string_lossy(), None).expect("infer");
    let spec = plan.resolved_spec.expect("resolved_spec");
    let assembled = assemble(&spec, Path::new(".")).expect("assemble");
    to_dag_ml_data(&assembled).expect("emit envelope")
}

#[test]
fn emits_valid_envelopes_for_corpus() {
    for case in ["single_combined", "train_test", "x_y_separate"] {
        let envelope = emit(case);

        // from_parts self-validates; re-validate to be explicit.
        envelope
            .validate()
            .unwrap_or_else(|e| panic!("{case}: envelope invalid: {e}"));

        // 64-char hex fingerprints, relations present.
        assert_eq!(envelope.schema_fingerprint.len(), 64, "{case} schema fp");
        assert_eq!(envelope.plan_fingerprint.len(), 64, "{case} plan fp");
        assert!(envelope.coordinator_relations.is_some(), "{case} relations");

        // JSON round-trip + validate == dag-ml-data-cli validate-envelope.
        let json = serde_json::to_string_pretty(&envelope).unwrap();
        let parsed: CoordinatorDataPlanEnvelope = serde_json::from_str(&json).unwrap();
        parsed
            .validate()
            .unwrap_or_else(|e| panic!("{case}: round-trip invalid: {e}"));
        assert_eq!(parsed, envelope, "{case} round-trips losslessly");
    }
}

#[test]
fn partitioned_dataset_is_one_logical_source() {
    // train/test is ONE logical X source spread across partition blocks — not
    // two — so the plan has a single materialize step and no phantom join.
    let envelope = emit("train_test");
    assert_eq!(
        envelope.plan.steps.len(),
        1,
        "one source => one materialize step"
    );
    assert_eq!(
        envelope.plan.output_representation.as_str(),
        REPRESENTATION_SIGNAL_1D
    );
}

#[test]
fn emit_is_deterministic() {
    // Same input → identical envelope (fingerprints are content-derived).
    assert_eq!(
        serde_json::to_string(&emit("train_test")).unwrap(),
        serde_json::to_string(&emit("train_test")).unwrap(),
    );
}
