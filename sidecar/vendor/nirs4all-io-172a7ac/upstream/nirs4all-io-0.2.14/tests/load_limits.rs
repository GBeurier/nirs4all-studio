use nirs4all_io::api::{load_assembled, load_assembled_with_limits, Input, LoadLimits};
use nirs4all_io::core::spec::DatasetSpec;
use nirs4all_io::materialize::assemble_with_limits;
use serde_json::json;
use std::io::Write;

const CSV: &[u8] = b"a;b\n1;2\n3;4\n";

#[test]
fn defaults_cover_large_scientific_shapes_without_allocating_them() {
    let limits = LoadLimits::default();
    limits.validate().unwrap();
    limits.tabular().check_shape(100_001, 8193).unwrap();
    assert!(LoadLimits::from_value(&json!({"max_rows": 0})).is_err());
    assert!(LoadLimits::from_value(&json!({"max_row": 3})).is_err());
    assert_eq!(
        LoadLimits::from_value(&json!("unlimited")).unwrap(),
        LoadLimits::unlimited()
    );
    assert!(LoadLimits::unlimited()
        .tabular()
        .check_shape(u64::MAX, 2)
        .is_err());
}

#[test]
fn read_and_shape_limits_fail_then_explicit_larger_limits_succeed() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("x.csv");
    std::fs::write(&path, CSV).unwrap();
    let input = Input::Path(path.to_string_lossy().into_owned());
    let expected = load_assembled(&input, None, None)
        .unwrap()
        .to_summary_value();
    for limits in [
        LoadLimits {
            max_file_bytes: 4,
            ..LoadLimits::default()
        },
        LoadLimits {
            max_decoded_file_bytes: 4,
            ..LoadLimits::default()
        },
        LoadLimits {
            max_rows: 1,
            ..LoadLimits::default()
        },
        LoadLimits {
            max_columns: 1,
            ..LoadLimits::default()
        },
        LoadLimits {
            max_cells: 3,
            ..LoadLimits::default()
        },
        LoadLimits {
            max_record_bytes: 1,
            ..LoadLimits::default()
        },
    ] {
        assert!(load_assembled_with_limits(&input, None, None, limits).is_err());
    }
    for limits in [LoadLimits::default(), LoadLimits::unlimited()] {
        assert_eq!(
            load_assembled_with_limits(&input, None, None, limits)
                .unwrap()
                .to_summary_value(),
            expected
        );
    }
}

#[test]
fn tiny_gzip_and_zip_payloads_are_bounded_by_decoded_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let mut gzip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    gzip.write_all(CSV).unwrap();
    std::fs::write(dir.path().join("x.csv.gz"), gzip.finish().unwrap()).unwrap();
    let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    zip.start_file("x.csv", zip::write::SimpleFileOptions::default())
        .unwrap();
    zip.write_all(CSV).unwrap();
    std::fs::write(
        dir.path().join("x.csv.zip"),
        zip.finish().unwrap().into_inner(),
    )
    .unwrap();
    for name in ["x.csv.gz", "x.csv.zip"] {
        let input = Input::Path(dir.path().join(name).to_string_lossy().into_owned());
        let limits = LoadLimits {
            max_decoded_file_bytes: 5,
            ..LoadLimits::default()
        };
        assert!(load_assembled_with_limits(&input, None, None, limits)
            .unwrap_err()
            .message
            .contains("decoded"));
        assert_eq!(
            load_assembled(&input, None, None).unwrap().blocks["train"].n_samples,
            2
        );
    }
}

#[test]
fn config_fold_and_index_reads_share_the_aggregate_budget() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("x.csv"), CSV).unwrap();
    for (field, payload) in [
        (
            "partitions",
            json!({"by":"index_file", "train_file":"indices.json"}),
        ),
        ("folds", json!({"file":"folds.json", "format":"json"})),
    ] {
        std::fs::write(dir.path().join("indices.json"), "[0,1]").unwrap();
        std::fs::write(
            dir.path().join("folds.json"),
            "[{\"train\":[0],\"val\":[1]}]",
        )
        .unwrap();
        let mut value = json!({"sources":[{"id":"x","role":"features","input":"x.csv"}]});
        value[field] = payload;
        let spec = DatasetSpec::from_value(&value).unwrap();
        let limits = LoadLimits {
            max_total_bytes: CSV.len() as u64,
            ..LoadLimits::default()
        };
        assert!(assemble_with_limits(&spec, dir.path(), limits)
            .unwrap_err()
            .message
            .contains("limit"));
        assemble_with_limits(&spec, dir.path(), LoadLimits::default()).unwrap();
        let config = serde_json::to_vec(&value).unwrap();
        let path = dir.path().join("config.json");
        std::fs::write(&path, &config).unwrap();
        let input = Input::Path(path.to_string_lossy().into_owned());
        let limits = LoadLimits {
            max_total_bytes: config.len() as u64 + CSV.len() as u64,
            ..LoadLimits::default()
        };
        assert!(load_assembled_with_limits(&input, None, None, limits).is_err());
    }
}

#[test]
fn concatenation_checks_combined_rows_before_allocation() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("a.csv"), CSV).unwrap();
    std::fs::write(dir.path().join("b.csv"), CSV).unwrap();
    let spec = DatasetSpec::from_value(&json!({"sources":[{"id":"x","role":"features","input":["a.csv","b.csv"],"merge":"concat_samples"}]})).unwrap();
    for limits in [
        LoadLimits {
            max_files: 1,
            ..LoadLimits::default()
        },
        LoadLimits {
            max_decoded_total_bytes: CSV.len() as u64,
            ..LoadLimits::default()
        },
    ] {
        assert!(assemble_with_limits(&spec, dir.path(), limits)
            .unwrap_err()
            .message
            .contains("limit"));
    }
    let limits = LoadLimits {
        max_rows: 3,
        ..LoadLimits::default()
    };
    assert!(assemble_with_limits(&spec, dir.path(), limits)
        .unwrap_err()
        .message
        .contains("rows"));
    let limits = LoadLimits {
        max_rows: 4,
        ..LoadLimits::default()
    };
    assert_eq!(
        assemble_with_limits(&spec, dir.path(), limits)
            .unwrap()
            .blocks["train"]
            .n_samples,
        4
    );
}
