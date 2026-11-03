// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Native glob parity + ambiguity guards (Codex #2 / #4).
//!
//! 1. A path-scoped feature glob (`spectra/*.csv`) must stay path-scoped: it
//!    merges only the files under `spectra/`, never a sibling `meta.csv`. The old
//!    facade stripped glob matches to basenames and re-globbed against basenames,
//!    so `spectra/*.csv` also swallowed `meta.csv`.
//! 2. A separator-free glob (`*.csv`) still basename-matches everything in
//!    `base_dir`.
//! 3. An exact/stem `input` that matches several supplied files is a hard error,
//!    not silent first-wins.

use nirs4all_io::core::materialize::{assemble_in_memory, InMemorySource, SourcePayload};
use nirs4all_io::core::spec::{normalize_to_spec_dict, DatasetSpec};
use nirs4all_io::materialize::assemble;
use serde_json::{json, Value};

fn build_spec(spec_json: &Value) -> DatasetSpec {
    DatasetSpec::from_value(&normalize_to_spec_dict(spec_json)).expect("spec parses")
}

#[test]
fn path_scoped_glob_does_not_match_sibling_files() {
    let dir = tempfile::tempdir().expect("tmp dir");
    std::fs::create_dir(dir.path().join("spectra")).unwrap();
    // Two 3-wide spectra files under spectra/, sharing the same axis header.
    std::fs::write(
        dir.path().join("spectra").join("a.csv"),
        "1000;1005;1010\n0.1;0.2;0.3\n",
    )
    .unwrap();
    std::fs::write(
        dir.path().join("spectra").join("b.csv"),
        "1000;1005;1010\n0.4;0.5;0.6\n",
    )
    .unwrap();
    // A sibling table directly in base_dir that the glob must NOT pull in.
    std::fs::write(
        dir.path().join("meta.csv"),
        "sample_id;protein\nx;11.0\ny;12.0\n",
    )
    .unwrap();

    let spec = build_spec(&json!({
        "name": "globbed",
        "sources": [{
            "id": "x",
            "role": "features",
            "input": "spectra/*.csv",
            "merge": "concat_samples",
        }],
    }));
    let assembled = assemble(&spec, dir.path()).expect("assemble path-scoped glob");
    let block = &assembled.blocks["train"];
    // Only the 2 spectra rows — meta.csv (2 rows, different shape) was not merged.
    assert_eq!(
        block.n_samples, 2,
        "glob matched exactly the 2 spectra files"
    );
    assert_eq!(
        block.x[0].n_cols, 3,
        "feature width is the spectra axis only"
    );
}

#[test]
fn separator_free_glob_basename_matches_base_dir() {
    let dir = tempfile::tempdir().expect("tmp dir");
    std::fs::write(dir.path().join("a.csv"), "1000;1005\n0.1;0.2\n").unwrap();
    std::fs::write(dir.path().join("b.csv"), "1000;1005\n0.3;0.4\n").unwrap();

    let spec = build_spec(&json!({
        "name": "flat-glob",
        "sources": [{
            "id": "x",
            "role": "features",
            "input": "*.csv",
            "merge": "concat_samples",
        }],
    }));
    let assembled = assemble(&spec, dir.path()).expect("assemble flat glob");
    assert_eq!(assembled.blocks["train"].n_samples, 2);
}

#[test]
fn ambiguous_stem_input_is_an_error() {
    // Two in-memory sources share the stem `scan`; an `input: "scan"` must error
    // rather than silently pick whichever was supplied first.
    let spec = build_spec(&json!({
        "name": "ambiguous",
        "sources": [{"id": "x", "role": "features", "input": "scan"}],
    }));
    let sources = vec![
        InMemorySource {
            name: "scan.csv".into(),
            payload: SourcePayload::Bytes(b"1000;1005\n0.1;0.2\n".to_vec()),
        },
        InMemorySource {
            name: "scan.asd".into(),
            payload: SourcePayload::Bytes(b"1000;1005\n0.3;0.4\n".to_vec()),
        },
    ];
    let err = assemble_in_memory(&spec, &sources, &std::collections::HashMap::new(), None)
        .expect_err("ambiguous stem must error");
    assert!(
        err.message.contains("ambiguous"),
        "error should flag ambiguity: {}",
        err.message
    );
}
