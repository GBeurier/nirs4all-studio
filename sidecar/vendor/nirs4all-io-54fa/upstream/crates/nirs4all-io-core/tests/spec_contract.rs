// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Partial SYNC #1: `to_spec` cases reproducible without file IO must match the
//! blessed Python contract goldens byte-for-byte through the Rust core.
//!
//! - `{"spec": {...}}` cases: full `to_spec(dict)` path (normalize → IR → emit).
//! - `{"dir": ...}` cases: the convention path (`match_items` over the directory
//!   basenames → `assignments_to_spec_dict` → IR → emit) using the default
//!   `nirs4all-classic` profile. The facade resolver only supplies basenames, so
//!   this is reproducible in core. Infer / config-file cases need the facade.

use std::path::{Path, PathBuf};

use nirs4all_io_core::canonical_json::canonical_json;
use nirs4all_io_core::conventions::{assignments_to_spec_dict, match_items, resolve_profiles};
use nirs4all_io_core::spec::{normalize_to_spec_dict, DatasetSpec};
use serde_json::Value;

fn contract_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .expect("repo root")
        .join("tests/goldens/contract")
}

fn emit(spec_dict: &Value) -> String {
    canonical_json(&DatasetSpec::from_value(spec_dict).unwrap().to_value()).unwrap()
}

#[test]
fn to_spec_cases_match_goldens() {
    let dir = contract_dir();
    let manifest: Value =
        serde_json::from_str(&std::fs::read_to_string(dir.join("manifest.json")).unwrap()).unwrap();
    let mut checked = 0;
    for case in manifest["cases"].as_array().unwrap() {
        if case["op"] != "to_spec" {
            continue;
        }
        let name = case["name"].as_str().unwrap();
        let input = &case["input"];

        let produced = if let Some(spec_input) = input.get("spec") {
            emit(&normalize_to_spec_dict(spec_input))
        } else if let Some(dir_rel) = input.get("dir").and_then(|v| v.as_str()) {
            // directory to_spec: conventions match over basenames, name = dir base.
            let case_dir = dir.join(dir_rel);
            let dir_name = Path::new(dir_rel).file_name().unwrap().to_str().unwrap();
            let mut basenames: Vec<String> = std::fs::read_dir(&case_dir)
                .unwrap()
                .filter_map(|e| e.ok())
                .filter(|e| e.path().is_file())
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect();
            basenames.sort();
            let profiles = resolve_profiles(&["nirs4all-classic"]).unwrap();
            let result = match_items(&basenames, &profiles, None, None);
            emit(&assignments_to_spec_dict(&result, dir_name))
        } else {
            // config-file cases need facade file IO; covered at SYNC #1.
            continue;
        };

        let golden =
            std::fs::read_to_string(dir.join(format!("{name}.to_spec.canonical"))).unwrap();
        assert_eq!(produced, golden, "to_spec drift for {name}");
        checked += 1;
    }
    assert!(
        checked >= 3,
        "expected >=3 reproducible to_spec cases, got {checked}"
    );
}
