use std::fs;
use std::path::Path;

use dag_ml_results::read_native_results;
use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
use serde_json::Value;
use sha2::{Digest, Sha256};

#[test]
fn arrow59_public_results_reader_reads_frozen_rust53_parquet() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/arrow53");
    let provenance: Value = serde_json::from_slice(&fs::read(root.join("provenance.json"))
        .expect("mandatory versioned Rust53 fixture provenance absent; see scripts/arrow53-compat-fixtures/README.md")).unwrap();
    assert_eq!(provenance["producer"], "dag-ml-arrow53-fixture-producer");
    assert_eq!(provenance["dependencies"]["parquet"], "53.4.1");
    for name in [
        "native_results/predictions.parquet",
        "native_results/manifest.json",
        "native_results/score_set.json",
    ] {
        let bytes =
            fs::read(root.join(name)).expect("mandatory immutable Rust53 results fixture absent");
        assert_eq!(
            format!("{:x}", Sha256::digest(&bytes)),
            provenance["files"][name].as_str().unwrap()
        );
    }
    let builder = ParquetRecordBatchReaderBuilder::try_new(
        fs::File::open(root.join("native_results/predictions.parquet")).unwrap(),
    )
    .unwrap();
    assert_eq!(
        builder.metadata().file_metadata().created_by(),
        Some("parquet-rs version 53.4.1")
    );
    assert_eq!(
        builder.schema().metadata()["fixture.producer"],
        "rust-parquet-53.4.1"
    );
    let view = read_native_results(root.join("native_results"))
        .expect("public candidate results reader must accept old Rust53 bytes");
    assert_eq!(view.score_set["variants"]["variant:53"]["score"], 0.125);
    assert_eq!(view.manifest["fixture_producer"], "rust-parquet-53.4.1");
    assert_eq!(view.predictions.len(), 2);
    let a = &view.predictions[0];
    let b = &view.predictions[1];
    assert_eq!(a.sample_indices, vec![11, 7]);
    assert_eq!(
        a.sample_ids.as_ref().unwrap(),
        &vec!["sample:11".to_owned(), "sample:7".to_owned()]
    );
    assert_eq!(b.sample_indices, vec![21]);
    assert_eq!(
        b.sample_ids.as_ref().unwrap(),
        &vec!["sample:21".to_owned()]
    );
    assert_eq!(a.y_true, vec![1.0, 2.0, 3.0, 4.0]);
    assert_eq!(a.y_pred, vec![1.25, -2.5, 3.75, 4.5]);
    assert_eq!(b.y_true, vec![5.0, 6.0]);
    assert_eq!(b.y_pred, vec![5.5, 6.5]);
    assert_eq!(a.y_true_shape, vec![2, 2]);
    assert_eq!(a.y_pred_shape, vec![2, 2]);
    assert_eq!(b.y_true_shape, vec![1, 2]);
    assert_eq!(b.y_pred_shape, vec![1, 2]);
    assert_eq!(a.target_width, 2);
    assert_eq!(b.target_width, 2);
    assert_eq!(a.target_names, vec!["target:a", "target:b"]);
    assert_eq!(a.target_names, b.target_names);
    assert_eq!(a.partition, "validation");
    assert_eq!(b.partition, "test");
    assert_eq!(a.weights, vec![0.5, 1.5]);
    assert!(b.weights.is_empty());
    assert!(a.y_proba.is_empty() && b.y_proba.is_empty());
    assert!(a.y_proba_shape.is_empty() && b.y_proba_shape.is_empty());
    assert_eq!(a.val_score, Some(0.125));
    assert_eq!(b.val_score, None);
    assert_eq!(a.test_score, None);
    assert_eq!(b.test_score, Some(0.25));
    assert!(a.train_score.is_none() && b.train_score.is_none());
    assert_eq!(a.scores["rmse"], 0.125);
    assert_eq!(b.scores["rmse"], 0.25);
}
