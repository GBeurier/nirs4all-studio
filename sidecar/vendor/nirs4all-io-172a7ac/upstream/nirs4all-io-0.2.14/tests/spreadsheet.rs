// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Spreadsheet workbooks are decoded as worksheets, never as delimited text.

use std::path::{Path, PathBuf};

use nirs4all_io::api::LoadLimits;
use nirs4all_io::core::materialize::loaders::read_sheet;
use nirs4all_io::core::spec::dataset_spec::LoadingParams;
use nirs4all_io::core::spec::{normalize_to_spec_dict, DatasetSpec};
use nirs4all_io::materialize::loaders::{read_table, read_table_with_limits};
use nirs4all_io::materialize::{assemble, Cell};
use serde_json::json;

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

fn read_error(name: &str, params: &LoadingParams) -> String {
    read_table(&fixture(name), params).unwrap_err().message
}

#[test]
fn reads_the_first_worksheet_with_a_numeric_header_row() {
    // A numeric header cell (a wavelength) names its column; it is not data.
    let frame = read_table(&fixture("spectra_refs.xlsx"), &LoadingParams::default()).unwrap();
    assert_eq!(frame.column_names(), vec!["1000", "1002", "1004"]);
    assert_eq!(frame.n_rows, 3);
    assert_eq!(frame.columns[1].values[2], Cell::Float(0.8));
}

#[test]
fn keeps_the_sheet_layout_as_pandas_reads_it() {
    // Anchored at A1: an empty first column is "Unnamed: 0", a leading missing
    // target and a trailing `#N/A` error cell keep their rows, and a column of
    // boolean words is boolean.
    let params = LoadingParams::from_value(Some(&json!({"na": {"policy": "ignore"}}))).unwrap();
    let frame = read_table(&fixture("layout.xlsx"), &params).unwrap();
    assert_eq!(frame.column_names(), vec!["Unnamed: 0", "y", "flag"]);
    assert_eq!(frame.n_rows, 3);
    let y = &frame.columns[1].values;
    assert!(matches!(y[0], Cell::Float(v) if v.is_nan()));
    assert_eq!(y[1], Cell::Float(10.0));
    assert!(matches!(y[2], Cell::Float(v) if v.is_nan()));
    assert_eq!(
        frame.columns[2].values,
        vec![Cell::Bool(true), Cell::Bool(false), Cell::Bool(true)]
    );
}

#[test]
fn selects_worksheets_per_source_and_keeps_typed_cells() {
    let spec = DatasetSpec::from_value(&normalize_to_spec_dict(&json!({
        "sources": [
            {"id": "x", "role": "features", "input": "spectra_refs.xlsx",
             "params": {"format": {"sheet_name": 0}}},
            {"id": "y", "role": "mixed", "input": "spectra_refs.xlsx",
             "params": {"format": {"sheet_name": "refs"}},
             "columns": [
                {"select": ["target", "valid"], "role": "targets"},
                {"select": ["measured", "site"], "role": "metadata"}
             ]}
        ]
    })))
    .unwrap();
    let assembled = assemble(&spec, &fixture("")).unwrap();
    let block = &assembled.blocks["train"];
    assert_eq!(block.feature_headers, vec![vec!["1000", "1002", "1004"]]);
    // The missing target stays missing; booleans are numeric 1/0, not classes.
    let y = &block.y.as_ref().unwrap().data;
    assert_eq!((y[0], y[1], y[4], y[5]), (12.5, 1.0, 3.0, 1.0));
    assert!(y[2].is_nan());
    assert_eq!(y[3], 0.0);
    assert!(block.y_categorical.is_empty());
    let metadata = block.metadata.as_ref().unwrap();
    let column = |name: &str| {
        &metadata
            .columns
            .iter()
            .find(|column| column.name == name)
            .unwrap()
            .values
    };
    assert_eq!(
        column("measured")[1],
        Cell::Str("2024-01-03 12:30:00".into())
    );
    assert_eq!(column("site")[1], Cell::Na);
}

#[test]
fn reads_without_a_header_row() {
    let params = LoadingParams {
        has_header: Some(false),
        ..LoadingParams::default()
    };
    let frame = read_table(&fixture("spectra_refs.xlsx"), &params).unwrap();
    assert_eq!(frame.column_names(), vec!["0", "1", "2"]);
    assert_eq!(frame.n_rows, 4);
}

#[test]
fn refuses_unknown_worksheets_and_unsupported_options() {
    let with_format = |key: &str, value: serde_json::Value| {
        let mut params = LoadingParams::default();
        params.format.values.insert(key.into(), value);
        params
    };
    let err = read_error(
        "spectra_refs.xlsx",
        &with_format("sheet_name", json!("absent")),
    );
    assert!(
        err.contains(r#"worksheet "absent" not found; available: ["spectra", "refs"]"#),
        "{err}"
    );
    let err = read_error("legacy.xls", &LoadingParams::default());
    assert!(
        err.contains("legacy .xls workbooks are not supported"),
        "{err}"
    );
    for option in ["usecols", "skiprows"] {
        let err = read_error("spectra_refs.xlsx", &with_format(option, json!([0])));
        assert!(
            err.contains(&format!("loading.format.{option} is not supported")),
            "{err}"
        );
    }
}

#[test]
fn bounds_what_a_small_workbook_can_expand_to() {
    // Two distant cells would span 50000 x 26 cells from a few kilobytes.
    let err = read_error("sparse.xlsx", &LoadingParams::default());
    assert!(err.contains("refusing a sparse sheet"), "{err}");
    // A shared-strings count the part cannot hold is refused before any reserve.
    let err = read_error("string_bomb.xlsx", &LoadingParams::default());
    assert!(err.contains("declares more strings than"), "{err}");
    // A shared string copied into many cells is charged per copy: 200 copies
    // of 1000 bytes load under the default budget, not under 50 kB.
    let path = fixture("shared_strings.xlsx");
    let params = LoadingParams {
        has_header: Some(false),
        ..LoadingParams::default()
    };
    assert_eq!(read_table(&path, &params).unwrap().n_rows, 200);
    let limits = LoadLimits {
        max_decoded_file_bytes: 50_000,
        ..LoadLimits::default()
    };
    let err = read_table_with_limits(&path, &params, limits).unwrap_err();
    assert!(
        err.message.contains("decoded file bytes"),
        "{}",
        err.message
    );
    // An entry larger than its declared size is refused, not decompressed.
    let err = read_error("understated.xlsx", &LoadingParams::default());
    assert!(
        err.contains("larger than its declared uncompressed size"),
        "{err}"
    );
    let path = fixture("spectra_refs.xlsx");
    for limits in [
        LoadLimits {
            max_field_bytes: 1,
            ..LoadLimits::default()
        },
        LoadLimits {
            max_record_bytes: 8,
            ..LoadLimits::default()
        },
        LoadLimits {
            max_cells: 8,
            ..LoadLimits::default()
        },
    ] {
        let err = read_table_with_limits(&path, &LoadingParams::default(), limits).unwrap_err();
        assert!(
            err.message.contains("budget") || err.message.contains("cells (maximum 8)"),
            "{}",
            err.message
        );
    }
}

#[test]
fn names_blank_header_cells_as_pandas_does() {
    let sheets = vec![(
        "s".to_string(),
        vec![
            vec![Cell::Str(String::new()), Cell::Na, Cell::Str("y".into())],
            vec![Cell::Int(1), Cell::Int(2), Cell::Int(3)],
        ],
    )];
    let frame = read_sheet(&sheets, &LoadingParams::default(), None).unwrap();
    assert_eq!(frame.column_names(), vec!["Unnamed: 0", "Unnamed: 1", "y"]);
}
