// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Assembled (load) goldens — Rust side. The facade reproduces the blessed
//! Python assembled summaries byte-for-byte: infer → resolved_spec → assemble →
//! canonical structural summary. Validates the materialize/load path on the
//! deterministic contract corpus (mirrors `tests/test_assembled_goldens.py`).

use std::path::{Path, PathBuf};

use nirs4all_io::canonical_json;
use nirs4all_io::core::spec::validate_spec;
use nirs4all_io::infer::infer_path;
use nirs4all_io::materialize::assemble;
use nirs4all_io::materialize::ASSEMBLED_DATASET_VERSION;
use serde_json::Value;

fn contract_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .expect("repo root")
        .join("tests/goldens/contract")
}

fn read_v2_golden(path: PathBuf) -> String {
    let value: Value = serde_json::from_str(&std::fs::read_to_string(path).expect("read golden"))
        .expect("assembled golden must be JSON");
    assert_eq!(
        value["assembled_schema_version"],
        Value::from(ASSEMBLED_DATASET_VERSION),
        "assembled golden uses the retired unversioned v1 wire; re-bless it as v2"
    );
    canonical_json(&value).expect("canonical golden")
}

#[test]
fn assembled_cases_match_goldens() {
    let dir = contract_dir();
    for case in ["single_combined", "train_test", "x_y_separate"] {
        let case_dir = dir.join("corpus").join(case);
        let plan = infer_path(&case_dir.to_string_lossy(), None).expect("infer");
        let spec = plan.resolved_spec.expect("resolved_spec");
        validate_spec(&spec).expect("valid spec");
        let assembled = assemble(&spec, Path::new(".")).expect("assemble");
        let produced = canonical_json(&assembled.to_summary_value()).unwrap();
        let golden = read_v2_golden(dir.join(format!("{case}.assembled.canonical")));
        assert_eq!(produced, golden, "assembled drift for {case}");
    }
}
