// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! fs-free assemble parity (Phase C).
//!
//! Proves the in-memory assembly core agrees with the filesystem path:
//!
//! 1. `Bytes` payloads: the 3 contract corpus cases, inferred fs-free via
//!    `infer_named_bytes`, assembled via `assemble_in_memory`, must reproduce the
//!    blessed `*.assembled.canonical` goldens byte-for-byte. Those same goldens
//!    are what the facade's `assemble(spec, base_dir)` matches (the facade now
//!    delegates to `assemble_in_memory`), so this is the "two paths agree" guard.
//!
//! 2. `Records` payloads: a dataset built from pre-decoded nirs4all-formats
//!    records assembles to the *same* `to_summary_value()` as the equivalent CSV
//!    bytes, proving `records_to_frame` produces the same typed `Frame` as the
//!    proven CSV decoder.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use nirs4all_io_core::canonical_json;
use nirs4all_io_core::infer::memory::{
    infer_decoded_records, infer_named_bytes, DecodedRecordSet, NamedBytes,
};
use nirs4all_io_core::materialize::{
    assemble_in_memory, Cell, Column, Frame, InMemorySource, SourcePayload,
    ASSEMBLED_DATASET_VERSION,
};
use nirs4all_io_core::spec::{validate_spec, DatasetSpec};
use serde_json::{json, Value};

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

/// Read every file in a corpus case directory into named byte buffers
/// (basename-keyed, matching what the in-memory resolver re-matches against).
fn read_case_files(case_dir: &Path) -> Vec<NamedBytes> {
    let mut files: Vec<NamedBytes> = std::fs::read_dir(case_dir)
        .expect("read case dir")
        .filter_map(Result::ok)
        .filter(|e| e.path().is_file())
        .map(|e| NamedBytes {
            name: e.file_name().to_string_lossy().into_owned(),
            bytes: std::fs::read(e.path()).expect("read fixture"),
        })
        .collect();
    files.sort_by(|a, b| a.name.cmp(&b.name));
    files
}

fn to_sources(files: &[NamedBytes]) -> Vec<InMemorySource> {
    files
        .iter()
        .map(|f| InMemorySource {
            name: f.name.clone(),
            payload: SourcePayload::Bytes(f.bytes.clone()),
        })
        .collect()
}

#[test]
fn bytes_path_reproduces_assembled_goldens() {
    let dir = contract_dir();
    for case in ["single_combined", "train_test", "x_y_separate"] {
        let case_dir = dir.join("corpus").join(case);
        let files = read_case_files(&case_dir);

        // fs-free infer → resolved spec (the browser-native counterpart of the
        // facade's infer_path used by the assembled_goldens.rs reference test).
        let plan = infer_named_bytes(&files, None).expect("infer_named_bytes");
        let spec = plan.resolved_spec.expect("resolved_spec");
        validate_spec(&spec).expect("valid spec");

        let sources = to_sources(&files);
        let assembled = assemble_in_memory(&spec, &sources, &HashMap::new(), None)
            .unwrap_or_else(|e| panic!("assemble_in_memory `{case}`: {}", e.message));
        let produced = canonical_json(&assembled.to_summary_value()).unwrap();
        let golden = read_v2_golden(dir.join(format!("{case}.assembled.canonical")));
        assert_eq!(
            produced, golden,
            "in-memory assembled drift for `{case}` (Bytes path)"
        );
    }
}

/// `;`-CSV from `(header, column-of-strings)` pairs.
fn csv(columns: &[(&str, Vec<String>)]) -> String {
    let header = columns
        .iter()
        .map(|(n, _)| *n)
        .collect::<Vec<_>>()
        .join(";");
    let nrows = columns.first().map(|(_, v)| v.len()).unwrap_or(0);
    let mut out = String::from(&header);
    out.push('\n');
    for r in 0..nrows {
        let line = columns
            .iter()
            .map(|(_, v)| v[r].clone())
            .collect::<Vec<_>>()
            .join(";");
        out.push_str(&line);
        out.push('\n');
    }
    out
}

fn fnum(vals: &[f64]) -> Vec<String> {
    vals.iter().map(|v| format!("{v}")).collect()
}

fn strs(vals: &[&str]) -> Vec<String> {
    vals.iter().map(|s| s.to_string()).collect()
}

/// A wide synthetic spectral record: `width` signal values + `metadata`, plus an
/// optional `protein` target. Shaped like a decoded galactic `nir.spc`
/// (700 signal values, no/with targets, sample_id + extra metadata keys).
fn wide_record(width: usize, sample_id: &str, protein: Option<f64>, extra_meta: bool) -> Value {
    let values: Vec<f64> = (0..width).map(|i| i as f64 * 0.001).collect();
    let axis: Vec<f64> = (0..width).map(|i| 1000.0 + i as f64).collect();
    let mut record = json!({
        "signals": {"signal": {"values": values, "axis": {"values": axis, "unit": "nm"}}},
        "metadata": {"sample_id": sample_id},
    });
    if extra_meta {
        let meta = record["metadata"].as_object_mut().unwrap();
        meta.insert("galactic_spc".into(), json!(true));
        meta.insert("galactic_spc_log".into(), json!("decoded ok"));
        meta.insert("galactic_spc_subfile".into(), json!(0));
    }
    if let Some(p) = protein {
        record
            .as_object_mut()
            .unwrap()
            .insert("targets".into(), json!({"protein": p}));
    }
    record
}

/// Codex #3: a `nir.spc`-shaped feature-only records source — 700 signal values +
/// metadata {sample_id, galactic_spc*} and NO targets — inferred via
/// `infer_decoded_records` and assembled through `assemble_in_memory` must yield
/// features == signal width (no metadata/id leak into X) and a populated metadata
/// frame, with sample_id treated as identity (excluded from X, retained as
/// aligned metadata so downstream hosts never recreate it from row position).
#[test]
fn decoded_features_only_records_assemble_to_signal_width() {
    let width = 700;
    let sets = vec![DecodedRecordSet {
        source: "nir.spc".into(),
        format: Some("galactic-spc".into()),
        records: vec![
            wide_record(width, "s1", None, true),
            wide_record(width, "s2", None, true),
            wide_record(width, "s3", None, true),
        ],
    }];
    let plan = infer_decoded_records(&sets).expect("infer_decoded_records");
    let spec = plan.resolved_spec.expect("resolved_spec");
    validate_spec(&spec).expect("valid spec");
    // The inferred source carries explicit columns + identity key. It has
    // metadata (galactic_spc*) but no targets, so it is `mixed` (per-column roles
    // span features+metadata) yet produces no y.
    assert_eq!(spec.to_value()["sources"][0]["role"], json!("mixed"));
    assert_eq!(spec.to_value()["sources"][0]["key"], json!("sample_id"));

    let sources = vec![InMemorySource {
        name: "nir.spc".into(),
        payload: SourcePayload::Records(sets[0].records.clone()),
    }];
    let assembled =
        assemble_in_memory(&spec, &sources, &HashMap::new(), None).expect("assemble features-only");
    let block = &assembled.blocks["train"];
    assert_eq!(block.n_samples, 3);
    // X is exactly the 700 signal columns — no sample_id / galactic_spc* leak.
    assert_eq!(block.x.len(), 1, "single feature source");
    assert_eq!(block.x[0].n_cols, width, "X width == signal width");
    assert_eq!(block.feature_headers[0].len(), width);
    // The metadata frame carries ordinary metadata and the aligned identity.
    let meta_cols = block
        .metadata
        .as_ref()
        .map(|f| f.column_names())
        .unwrap_or_default();
    assert!(
        meta_cols.contains(&"galactic_spc".to_string()),
        "metadata frame carries galactic_spc, got {meta_cols:?}"
    );
    assert!(
        meta_cols.contains(&"sample_id".to_string()),
        "sample_id identity is retained as metadata: {meta_cols:?}"
    );
    // and sample_id never leaks into the feature axis.
    assert!(!block.feature_headers[0].contains(&"sample_id".to_string()));
    assert!(block.y.is_none(), "no targets => no y");
}

/// Codex #3 (mixed variant): the same wide records WITH a `protein` target must
/// assemble (the old code hit the "unassigned columns" error path), with X ==
/// signal width, y captured, metadata populated, sample_id as identity.
#[test]
fn decoded_mixed_records_assemble_with_targets_and_clean_x() {
    let width = 700;
    let sets = vec![DecodedRecordSet {
        source: "nir.spc".into(),
        format: Some("galactic-spc".into()),
        records: vec![
            wide_record(width, "s1", Some(12.5), true),
            wide_record(width, "s2", Some(8.3), true),
            wide_record(width, "s3", Some(15.1), true),
        ],
    }];
    let plan = infer_decoded_records(&sets).expect("infer_decoded_records");
    let spec = plan.resolved_spec.expect("resolved_spec");
    validate_spec(&spec).expect("valid spec");
    assert_eq!(spec.to_value()["sources"][0]["role"], json!("mixed"));

    let sources = vec![InMemorySource {
        name: "nir.spc".into(),
        payload: SourcePayload::Records(sets[0].records.clone()),
    }];
    let assembled =
        assemble_in_memory(&spec, &sources, &HashMap::new(), None).expect("assemble mixed");
    let block = &assembled.blocks["train"];
    assert_eq!(block.n_samples, 3);
    assert_eq!(block.x[0].n_cols, width, "X width == signal width");
    let y = block.y.as_ref().expect("targets => y present");
    assert_eq!((y.n_rows, y.n_cols), (3, 1));
    assert_eq!(block.y_headers, vec!["protein"]);
    let meta_cols = block
        .metadata
        .as_ref()
        .map(|f| f.column_names())
        .unwrap_or_default();
    assert!(meta_cols.contains(&"galactic_spc".to_string()));
    assert!(meta_cols.contains(&"sample_id".to_string()));
    assert!(!block.feature_headers[0].contains(&"protein".to_string()));
    assert!(!block.feature_headers[0].contains(&"sample_id".to_string()));
}

/// One decoded record: an absorbance signal over `axis` (nm), a `protein`
/// target, a `site` metadata field.
fn record(values: [f64; 3], axis: &[f64; 3], protein: f64, site: &str) -> Value {
    json!({
        "signals": {"absorbance": {"values": values, "axis": {"values": axis, "unit": "nm"}}},
        "targets": {"protein": protein},
        "metadata": {"site": site},
    })
}

#[test]
fn records_path_matches_equivalent_csv() {
    // The SAME logical dataset two ways: a single mixed CSV source, and a single
    // mixed source backed by decoded records. One explicit spec drives both, so
    // any difference is `records_to_frame` vs the CSV decoder.
    let axis = [1000.0_f64, 1005.0, 1010.0];
    let feats = [
        [0.10_f64, 0.20, 0.30],
        [0.40, 0.50, 0.60],
        [0.70, 0.80, 0.90],
        [1.00, 1.10, 1.20],
    ];
    let proteins = [12.5_f64, 8.3, 15.1, 9.9];
    let sites = ["a", "b", "a", "b"];

    // header_unit is pinned to nm so the CSV path (whose header would default to
    // "text") matches the records path (whose axis carries the nm unit). The unit
    // difference is the one legitimate semantic gap between the two input forms.
    let spec = DatasetSpec::from_value(&json!({
        "name": "rec-parity",
        "sources": [{
            "id": "data",
            "role": "mixed",
            "input": "scan",
            "params": {"header_unit": "nm"},
            "columns": [
                {"role": "features", "select": ["1000", "1005", "1010"]},
                {"role": "targets", "select": ["protein"]},
                {"role": "metadata", "select": ["site"]},
            ],
        }],
    }))
    .expect("spec");
    validate_spec(&spec).expect("valid spec");

    // CSV bytes form.
    let csv_text = csv(&[
        (
            "1000",
            fnum(&feats.iter().map(|r| r[0]).collect::<Vec<_>>()),
        ),
        (
            "1005",
            fnum(&feats.iter().map(|r| r[1]).collect::<Vec<_>>()),
        ),
        (
            "1010",
            fnum(&feats.iter().map(|r| r[2]).collect::<Vec<_>>()),
        ),
        ("protein", fnum(&proteins)),
        ("site", strs(&sites)),
    ]);
    let csv_sources = vec![InMemorySource {
        name: "scan".into(),
        payload: SourcePayload::Bytes(csv_text.into_bytes()),
    }];
    let from_csv = assemble_in_memory(&spec, &csv_sources, &HashMap::new(), None)
        .expect("assemble from CSV bytes");

    // Records form.
    let records: Vec<Value> = (0..4)
        .map(|i| record(feats[i], &axis, proteins[i], sites[i]))
        .collect();
    let rec_sources = vec![InMemorySource {
        name: "scan".into(),
        payload: SourcePayload::Records(records),
    }];
    let from_records = assemble_in_memory(&spec, &rec_sources, &HashMap::new(), None)
        .expect("assemble from records");

    assert_eq!(
        canonical_json(&from_records.to_summary_value()).unwrap(),
        canonical_json(&from_csv.to_summary_value()).unwrap(),
        "records path diverged from the equivalent CSV path"
    );
}

#[test]
fn records_path_full_value_carries_x_y_metadata() {
    // A direct structural check on the records path independent of the CSV path:
    // header_unit from axis.unit (nm), feature headers from axis labels, y from
    // targets, metadata column present.
    let axis = [1000.0_f64, 1005.0, 1010.0];
    let spec = DatasetSpec::from_value(&json!({
        "name": "rec",
        "sources": [{
            "id": "data",
            "role": "mixed",
            "input": "scan",
            "columns": [
                {"role": "features", "select": ["1000", "1005", "1010"]},
                {"role": "targets", "select": ["protein"]},
                {"role": "metadata", "select": ["site"]},
            ],
        }],
    }))
    .expect("spec");
    let records = vec![
        record([0.1, 0.2, 0.3], &axis, 12.5, "a"),
        record([0.4, 0.5, 0.6], &axis, 8.3, "b"),
    ];
    let sources = vec![InMemorySource {
        name: "scan".into(),
        payload: SourcePayload::Records(records),
    }];
    let assembled =
        assemble_in_memory(&spec, &sources, &HashMap::new(), None).expect("assemble records");
    let block = &assembled.blocks["train"];
    assert_eq!(block.n_samples, 2);
    assert_eq!(block.feature_headers, vec![vec!["1000", "1005", "1010"]]);
    assert_eq!(block.header_units, vec!["nm"]);
    assert_eq!(block.y_headers, vec!["protein"]);
    let y = block.y.as_ref().expect("y");
    assert_eq!((y.n_rows, y.n_cols), (2, 1));
    assert_eq!(
        block
            .metadata
            .as_ref()
            .map(|f| f.column_names())
            .unwrap_or_default(),
        vec!["site"]
    );
}

#[test]
fn row_aligned_multisource_duplicate_headers_remain_separate_blocks() {
    let spec = DatasetSpec::from_value(&json!({
        "name": "multi-reference",
        "sample_index": {"by": "id", "key": "sample_id"},
        "sources": [
            {
                "id": "X1",
                "role": "mixed",
                "input": "X1.csv",
                "key": "sample_id",
                "columns": [{"role": "features", "select": ["1100", "1102"]}],
            },
            {
                "id": "X2",
                "role": "mixed",
                "input": "X2.csv",
                "key": "sample_id",
                "columns": [{"role": "features", "select": ["1100", "1102"]}],
                "join": {"to": "X1", "how": "1:1"},
            },
        ],
    }))
    .expect("spec");
    validate_spec(&spec).expect("valid spec");

    let sources = vec![
        InMemorySource {
            name: "X1.csv".into(),
            payload: SourcePayload::Bytes(
                csv(&[
                    ("sample_id", strs(&["s1", "s2"])),
                    ("1100", fnum(&[0.1, 0.2])),
                    ("1102", fnum(&[0.3, 0.4])),
                ])
                .into_bytes(),
            ),
        },
        InMemorySource {
            name: "X2.csv".into(),
            payload: SourcePayload::Bytes(
                csv(&[
                    ("sample_id", strs(&["s1", "s2"])),
                    ("1100", fnum(&[1.1, 1.2])),
                    ("1102", fnum(&[1.3, 1.4])),
                ])
                .into_bytes(),
            ),
        },
    ];

    let assembled =
        assemble_in_memory(&spec, &sources, &HashMap::new(), None).expect("assemble multi-source");
    let block = &assembled.blocks["train"];
    assert_eq!(block.x.len(), 2);
    assert_eq!(
        block.feature_headers,
        vec![vec!["1100", "1102"], vec!["1100", "1102"]]
    );
    assert_eq!(block.x[0].data, vec![0.1, 0.3, 0.2, 0.4]);
    assert_eq!(block.x[1].data, vec![1.1, 1.3, 1.2, 1.4]);
}

#[test]
fn frame_payload_applies_source_na_policy_after_projection() {
    let spec = DatasetSpec::from_value(&json!({
        "name": "frame-na",
        "sources": [{
            "id": "x",
            "role": "features",
            "input": "scan.parquet",
            "params": {
                "na": {"policy": "replace", "fill": {"method": "value", "fill_value": 7.0}},
                "format": {"columns": ["1000", "1005"]},
            },
        }],
    }))
    .expect("spec");
    validate_spec(&spec).expect("valid spec");

    let frame = Frame::from_columns(
        vec![
            Column::from_cells("1000", vec![Cell::Float(1.0), Cell::Float(2.0)]),
            Column::from_cells("1005", vec![Cell::Float(f64::NAN), Cell::Float(3.0)]),
            Column::from_cells("unused", vec![Cell::Float(f64::NAN), Cell::Float(f64::NAN)]),
        ],
        "text",
    );
    let sources = vec![InMemorySource {
        name: "scan.parquet".into(),
        payload: SourcePayload::Frame(frame),
    }];

    let assembled = assemble_in_memory(&spec, &sources, &HashMap::new(), None)
        .expect("assemble frame payload with source NA policy");
    let block = &assembled.blocks["train"];

    assert_eq!(block.feature_headers, vec![vec!["1000", "1005"]]);
    assert_eq!(block.x[0].data, vec![1.0, 7.0, 2.0, 3.0]);
}

#[test]
fn folds_capture_observation_ids_before_partition_reorders_rows() {
    let spec = DatasetSpec::from_value(&json!({
        "name": "fold-identity",
        "sample_index": {
            "by": "id",
            "key": "sample_id",
            "observation_id": "observation_id",
            "repetition_id": "repetition_id",
            "group_id": "group_id",
        },
        "sources": [{
            "id": "data",
            "role": "mixed",
            "input": "data.csv",
            "columns": [
                {"role": "features", "select": ["sample_id", "observation_id", "repetition_id", "group_id", "1000"]},
                {"role": "targets", "select": ["target"]},
                {"role": "metadata", "select": ["set"]},
            ],
        }],
        "partitions": {"by": "column", "column": "set", "train_values": ["cal"], "test_values": ["val"]},
        "folds": {"inline": [{"train": [0, 2], "val": [1]}]},
    }))
    .expect("spec");
    validate_spec(&spec).expect("valid spec");
    let sources = vec![InMemorySource {
        name: "data.csv".into(),
        payload: SourcePayload::Bytes(
            csv(&[
                ("sample_id", strs(&["S0", "S1", "S2"])),
                ("observation_id", strs(&["O0", "O1", "O2"])),
                ("repetition_id", strs(&["R0", "R1", "R2"])),
                ("group_id", strs(&["G0", "G1", "G2"])),
                ("set", strs(&["cal", "val", "cal"])),
                ("1000", fnum(&[1.0, 2.0, 3.0])),
                ("target", fnum(&[10.0, 20.0, 30.0])),
            ])
            .into_bytes(),
        ),
    }];

    let assembled = assemble_in_memory(&spec, &sources, &HashMap::new(), None)
        .expect("assemble identity folds");
    // The train/test partition is [0, 2] / [1], so block row order no longer
    // matches the original frame. Fold membership must remain in pre-split
    // observation identity, not be interpreted as post-split row positions.
    assert_eq!(assembled.folds, vec![(vec![0, 2], vec![1])]);
    assert_eq!(
        assembled.fold_provenance[0].train_observation_ids,
        vec!["O0", "O2"]
    );
    assert_eq!(
        assembled.fold_provenance[0].validation_observation_ids,
        vec!["O1"]
    );
    for block in assembled.blocks.values() {
        assert_eq!(block.x[0].n_cols, 1, "identity fields cannot enter X");
        assert_eq!(block.y_headers, vec!["target"]);
        let metadata = block.metadata.as_ref().expect("identity metadata");
        for column in ["sample_id", "observation_id", "repetition_id", "group_id"] {
            assert!(
                metadata.has_column(column),
                "missing identity column {column}"
            );
        }
    }
}
