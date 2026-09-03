// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Parquet materialization must decode raw frames first, then apply source params.

use std::sync::Arc;

use arrow_array::{ArrayRef, Date32Array, Float64Array, RecordBatch};
use arrow_schema::{DataType, Field, Schema};
use nirs4all_io::core::spec::{normalize_to_spec_dict, DatasetSpec};
use nirs4all_io::materialize::assemble;
use parquet::arrow::arrow_writer::ArrowWriter;
use serde_json::{json, Value};

fn build_spec(spec_json: &Value) -> DatasetSpec {
    DatasetSpec::from_value(&normalize_to_spec_dict(spec_json)).expect("spec parses")
}

fn write_parquet(path: &std::path::Path, batch: RecordBatch) {
    let file = std::fs::File::create(path).unwrap();
    let mut writer = ArrowWriter::try_new(file, batch.schema(), None).unwrap();
    writer.write(&batch).unwrap();
    writer.close().unwrap();
}

#[test]
fn parquet_assemble_applies_source_na_policy_without_default_abort() {
    let dir = tempfile::tempdir().expect("tmp dir");
    let path = dir.path().join("scan.parquet");
    let schema = Arc::new(Schema::new(vec![
        Field::new("1000", DataType::Float64, false),
        Field::new("1005", DataType::Float64, true),
    ]));
    let batch = RecordBatch::try_new(
        schema,
        vec![
            Arc::new(Float64Array::from(vec![Some(1.0), Some(2.0)])) as ArrayRef,
            Arc::new(Float64Array::from(vec![None, Some(3.0)])) as ArrayRef,
        ],
    )
    .unwrap();
    write_parquet(&path, batch);

    let spec = build_spec(&json!({
        "name": "parquet-na",
        "sources": [{
            "id": "x",
            "role": "features",
            "input": "scan.parquet",
            "params": {
                "na": {"policy": "replace", "fill": {"method": "value", "fill_value": 7.0}}
            },
        }],
    }));

    let assembled = assemble(&spec, dir.path()).expect("assemble parquet with source NA policy");
    let block = &assembled.blocks["train"];

    assert_eq!(block.feature_headers, vec![vec!["1000", "1005"]]);
    assert_eq!(block.x[0].data, vec![1.0, 7.0, 2.0, 3.0]);
}

#[test]
fn parquet_assemble_skips_unsupported_unselected_column() {
    let dir = tempfile::tempdir().expect("tmp dir");
    let path = dir.path().join("scan.parquet");
    let schema = Arc::new(Schema::new(vec![
        Field::new("1000", DataType::Float64, false),
        Field::new("unsupported_date", DataType::Date32, false),
    ]));
    let batch = RecordBatch::try_new(
        schema,
        vec![
            Arc::new(Float64Array::from(vec![1.0, 2.0])) as ArrayRef,
            Arc::new(Date32Array::from(vec![1, 2])) as ArrayRef,
        ],
    )
    .unwrap();
    write_parquet(&path, batch);

    let spec = build_spec(&json!({
        "name": "parquet-projected",
        "sources": [{
            "id": "x",
            "role": "features",
            "input": "scan.parquet",
            "params": {"format": {"columns": ["1000"]}},
        }],
    }));

    let assembled = assemble(&spec, dir.path()).expect("assemble projected parquet");
    let block = &assembled.blocks["train"];

    assert_eq!(block.feature_headers, vec![vec!["1000"]]);
    assert_eq!(block.x[0].data, vec![1.0, 2.0]);
}

#[test]
fn parquet_assemble_shared_file_with_different_selected_columns() {
    let dir = tempfile::tempdir().expect("tmp dir");
    let path = dir.path().join("scan.parquet");
    let schema = Arc::new(Schema::new(vec![
        Field::new("1000", DataType::Float64, false),
        Field::new("1005", DataType::Float64, false),
        Field::new("unused_date", DataType::Date32, false),
    ]));
    let batch = RecordBatch::try_new(
        schema,
        vec![
            Arc::new(Float64Array::from(vec![1.0, 2.0])) as ArrayRef,
            Arc::new(Float64Array::from(vec![10.0, 20.0])) as ArrayRef,
            Arc::new(Date32Array::from(vec![1, 2])) as ArrayRef,
        ],
    )
    .unwrap();
    write_parquet(&path, batch);

    let spec = build_spec(&json!({
        "name": "parquet-shared-projected",
        "sources": [
            {
                "id": "left",
                "role": "features",
                "input": "scan.parquet",
                "params": {"format": {"columns": ["1000"]}},
            },
            {
                "id": "right",
                "role": "features",
                "input": "scan.parquet",
                "params": {"format": {"columns": ["1005"]}},
            },
        ],
    }));

    let assembled = assemble(&spec, dir.path()).expect("assemble shared projected parquet");
    let block = &assembled.blocks["train"];

    assert_eq!(block.feature_headers, vec![vec!["1000"], vec!["1005"]]);
    assert_eq!(block.x[0].data, vec![1.0, 2.0]);
    assert_eq!(block.x[1].data, vec![10.0, 20.0]);
}

#[test]
fn parquet_projection_union_includes_source_and_variation_columns() {
    let dir = tempfile::tempdir().expect("tmp dir");
    let path = dir.path().join("scan.parquet");
    let schema = Arc::new(Schema::new(vec![
        Field::new("1000", DataType::Float64, false),
        Field::new("1005", DataType::Float64, false),
        Field::new("snv1000", DataType::Float64, false),
        Field::new("snv1005", DataType::Float64, false),
        Field::new("unused_date", DataType::Date32, false),
    ]));
    let batch = RecordBatch::try_new(
        schema,
        vec![
            Arc::new(Float64Array::from(vec![1.0, 2.0])) as ArrayRef,
            Arc::new(Float64Array::from(vec![10.0, 20.0])) as ArrayRef,
            Arc::new(Float64Array::from(vec![0.1, 0.2])) as ArrayRef,
            Arc::new(Float64Array::from(vec![0.3, 0.4])) as ArrayRef,
            Arc::new(Date32Array::from(vec![1, 2])) as ArrayRef,
        ],
    )
    .unwrap();
    write_parquet(&path, batch);

    let spec = build_spec(&json!({
        "name": "parquet-variation-projected",
        "sources": [{
            "id": "x",
            "role": "features",
            "input": "scan.parquet",
            "params": {"format": {"columns": ["1000", "1005"]}},
            "variations": [{
                "name": "snv",
                "input": "scan.parquet",
                "params": {"format": {"columns": ["snv1000", "snv1005"]}}
            }]
        }],
    }));

    let assembled = assemble(&spec, dir.path()).expect("assemble variation projected parquet");
    let block = &assembled.blocks["train"];

    assert_eq!(block.feature_headers, vec![vec!["1000", "1005"]]);
    assert_eq!(block.x[0].data, vec![1.0, 10.0, 2.0, 20.0]);
    assert_eq!(block.processings.len(), 1);
    assert_eq!(block.processings[0][0].0, "snv");
    assert_eq!(block.processings[0][0].1.data, vec![0.1, 0.3, 0.2, 0.4]);
}

#[test]
fn parquet_projection_falls_back_to_all_columns_when_any_use_is_unprojected() {
    let dir = tempfile::tempdir().expect("tmp dir");
    let path = dir.path().join("scan.parquet");
    let schema = Arc::new(Schema::new(vec![
        Field::new("1000", DataType::Float64, false),
        Field::new("unused_date", DataType::Date32, false),
    ]));
    let batch = RecordBatch::try_new(
        schema,
        vec![
            Arc::new(Float64Array::from(vec![1.0, 2.0])) as ArrayRef,
            Arc::new(Date32Array::from(vec![1, 2])) as ArrayRef,
        ],
    )
    .unwrap();
    write_parquet(&path, batch);

    let spec = build_spec(&json!({
        "name": "parquet-fallback-all",
        "sources": [
            {
                "id": "left",
                "role": "features",
                "input": "scan.parquet",
                "params": {"format": {"columns": ["1000"]}},
            },
            {
                "id": "right",
                "role": "features",
                "input": "scan.parquet"
            },
        ],
    }));

    let err = assemble(&spec, dir.path()).expect_err("unprojected use must force full read");

    assert!(
        err.message
            .contains("parquet column 'unused_date' has unsupported type Date32"),
        "{}",
        err.message
    );
}

#[test]
fn parquet_projection_honors_global_columns_and_null_override() {
    let dir = tempfile::tempdir().expect("tmp dir");
    let path = dir.path().join("scan.parquet");
    let schema = Arc::new(Schema::new(vec![
        Field::new("1000", DataType::Float64, false),
        Field::new("unused_date", DataType::Date32, false),
    ]));
    let batch = RecordBatch::try_new(
        schema,
        vec![
            Arc::new(Float64Array::from(vec![1.0, 2.0])) as ArrayRef,
            Arc::new(Date32Array::from(vec![1, 2])) as ArrayRef,
        ],
    )
    .unwrap();
    write_parquet(&path, batch);

    let projected = build_spec(&json!({
        "name": "parquet-global-projected",
        "params": {"format": {"columns": ["1000"]}},
        "sources": [{
            "id": "x",
            "role": "features",
            "input": "scan.parquet"
        }],
    }));
    let assembled =
        assemble(&projected, dir.path()).expect("assemble with global parquet projection");
    let block = &assembled.blocks["train"];
    assert_eq!(block.feature_headers, vec![vec!["1000"]]);
    assert_eq!(block.x[0].data, vec![1.0, 2.0]);

    let fallback = build_spec(&json!({
        "name": "parquet-global-null-fallback",
        "params": {"format": {"columns": ["1000"]}},
        "sources": [{
            "id": "x",
            "role": "features",
            "input": "scan.parquet",
            "params": {"format": {"columns": null}}
        }],
    }));
    let err = assemble(&fallback, dir.path()).expect_err("source null columns forces full read");
    assert!(
        err.message
            .contains("parquet column 'unused_date' has unsupported type Date32"),
        "{}",
        err.message
    );
}
