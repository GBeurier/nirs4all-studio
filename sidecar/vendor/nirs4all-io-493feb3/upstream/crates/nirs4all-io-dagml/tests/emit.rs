// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! dag-ml-data emit (EPIC 10). Builds a `CoordinatorDataPlanEnvelope` from each
//! contract-corpus case and asserts it is valid — `from_parts` already
//! fingerprints + self-validates, and the JSON round-trip + `validate()` here is
//! exactly what `dag-ml-data-cli validate-envelope` does, run in-process so the
//! check needs no external binary. The full cross-CLI conformance (both
//! ecosystem CLIs) lives in `tests/dag_ml_data/verify_cross_cli.sh`.

use std::path::{Path, PathBuf};

use nirs4all_io::infer::infer_path;
use nirs4all_io::materialize::assemble;
use nirs4all_io_dagml::{preflight_identity, to_dag_ml_data, DagMlPreflightError};

fn corpus(case: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .expect("repo root")
        .join("tests/goldens/contract/corpus")
        .join(case)
}

fn assembled(case: &str) -> nirs4all_io::materialize::AssembledDataset {
    let dir = corpus(case);
    let plan = infer_path(&dir.to_string_lossy(), None).expect("infer");
    let spec = plan.resolved_spec.expect("resolved_spec");
    let assembled = assemble(&spec, Path::new(".")).expect("assemble");
    assembled
}

#[test]
fn corpus_without_stable_identity_is_refused() {
    for case in ["single_combined", "train_test", "x_y_separate"] {
        let assembled = assembled(case);
        assert_eq!(
            preflight_identity(&assembled),
            Err(DagMlPreflightError::MissingSampleId),
            "{case}"
        );
        assert!(to_dag_ml_data(&assembled)
            .unwrap_err()
            .message
            .contains("stable sample identity"));
    }
}
