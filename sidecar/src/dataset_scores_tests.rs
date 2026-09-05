use super::*;
use std::fs;

fn fixture() -> tempfile::TempDir {
    let root = tempfile::tempdir().unwrap();
    fs::write(
        root.path().join("store.sqlite"),
        include_bytes!("../tests/fixtures/workspace_store_v5_summary.sqlite"),
    )
    .unwrap();
    root
}

fn source(
    metric: Option<&str>,
    cv: Option<f64>,
    final_test: Option<f64>,
) -> WorkspaceStoreResultsSummarySourceRow {
    WorkspaceStoreResultsSummarySourceRow {
        chain_id: "chain".into(),
        pipeline_id: "pipeline".into(),
        run_id: "run".into(),
        pipeline_name: "pipeline".into(),
        expanded_config: None,
        model_step_idx: 1,
        dataset_name: "dataset".into(),
        metric: metric.map(str::to_owned),
        task_type: None,
        model_name: Some("Ridge".into()),
        model_class: "Ridge".into(),
        preprocessings: String::new(),
        cv_val_score: cv,
        cv_test_score: Some(0.001),
        cv_train_score: Some(0.0001),
        cv_fold_count: 3,
        cv_scores: json!({}),
        final_test_score: final_test,
        final_train_score: Some(0.0),
        final_scores: json!({"train":{"rmse":0.0}}),
        final_agg_test_score: None,
        final_agg_train_score: None,
        final_agg_scores: json!({}),
        best_params: None,
    }
}

#[test]
fn immutable_projection_preserves_real_final_and_cv_provenance() {
    let root = fixture();
    let path = root.path().join("store.sqlite");
    let before = (
        fs::read(&path).unwrap(),
        fs::metadata(&path).unwrap().modified().unwrap(),
    );
    let response = read(root.path(), None, "workspace", &[]).unwrap();
    let datasets = response["datasets"].as_array().unwrap();
    assert_eq!(datasets.len(), 3);
    let r2 = datasets
        .iter()
        .find(|d| d["dataset_name"] == "R2 Exact")
        .unwrap();
    assert_eq!(r2["best_score"], 0.99);
    assert_eq!(r2["cv_score"], 0.1);
    assert_eq!(r2["score_kind"], "final");
    let rmse = datasets.iter().find(|d| d["metric"] == "rmse").unwrap();
    assert_eq!(rmse["best_score"], 0.05);
    assert_eq!(rmse["cv_score"], 0.9);
    let custom = datasets
        .iter()
        .find(|d| d["metric"] == "custom_gain")
        .unwrap();
    assert_eq!(custom["score_kind"], "cv");
    assert_eq!(custom["best_score"], 0.6);
    assert!(custom["cv_score"].is_null());
    assert_eq!(
        before,
        (
            fs::read(&path).unwrap(),
            fs::metadata(&path).unwrap().modified().unwrap()
        )
    );
    assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
}

#[test]
fn cv_is_not_refit_and_missing_metric_or_train_only_is_not_ranked() {
    let mut scores = Accumulator::default();
    scores.consume(source(None, Some(999.0), Some(999.0)));
    scores.consume(source(Some("rmse"), None, None));
    assert!(scores.finish("w", &[])["datasets"]
        .as_array()
        .unwrap()
        .is_empty());
    let mut scores = Accumulator::default();
    scores.consume(source(Some("rmse"), Some(0.7), None));
    // A smaller CV-test/train value must not be promoted to final-test.
    let value = scores.finish("w", &[]);
    assert_eq!(value["datasets"][0]["score_kind"], "cv");
    assert_eq!(value["datasets"][0]["best_score"], 0.7);
    assert!(value["datasets"][0]["cv_score"].is_null());
}

#[test]
fn never_compares_different_units_or_nonfinite_values() {
    let mut scores = Accumulator::default();
    scores.consume(source(Some("rmse"), Some(0.7), None));
    scores.consume(source(Some("r2"), Some(-500.0), Some(-1000.0)));
    scores.consume(source(Some("rmse"), Some(f64::NAN), Some(f64::INFINITY)));
    let value = scores.finish("w", &[]);
    assert_eq!(value["datasets"][0]["metric"], "rmse");
    assert_eq!(value["datasets"][0]["best_score"], 0.7);
    assert_eq!(value["datasets"][0]["score_kind"], "cv");
}

#[test]
fn streaming_consumer_sees_last_page_and_uses_same_snapshot() {
    let root = fixture();
    let connection = Connection::open(root.path().join("store.sqlite")).unwrap();
    let template: (String, String) = connection
        .query_row("SELECT pipeline_id,chain_id FROM chains LIMIT 1", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .unwrap();
    for index in 0..600 {
        let id = format!("zz-page-{index:04}");
        connection.execute("INSERT INTO chains (chain_id,pipeline_id,steps,model_step_idx,model_class,dataset_name,metric,cv_val_score,cv_fold_count) VALUES (?,?,'[]',1,'Ridge','large','rmse',?,3)", rusqlite::params![id,template.0, f64::from(600-index)]).unwrap();
        connection.execute("INSERT INTO predictions (prediction_id,pipeline_id,chain_id,dataset_name,model_name,model_class,fold_id,partition,metric,task_type) VALUES (?, ?, ?, 'large','Ridge','Ridge','fold_0','val','rmse','regression')", rusqlite::params![id,template.0,id]).unwrap();
    }
    connection
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;")
        .unwrap();
    let from_connection = read(root.path(), Some(&connection), "w", &[]).unwrap();
    drop(connection);
    assert_eq!(from_connection, read(root.path(), None, "w", &[]).unwrap());
    let large = from_connection["datasets"]
        .as_array()
        .unwrap()
        .iter()
        .find(|d| d["dataset_name"] == "large")
        .unwrap();
    assert_eq!(large["best_score"], 1.0);
}

#[test]
fn links_use_shared_policy_and_live_journals_remain_errors() {
    let root = fixture();
    let links = [DatasetLinkIdentity {
        id: "dataset-1".into(),
        name: "R2 Exact".into(),
        path: "/data/r2".into(),
    }];
    let value = read(root.path(), None, "w", &links).unwrap();
    let linked = value["datasets"]
        .as_array()
        .unwrap()
        .iter()
        .find(|d| d["dataset_name"] == "R2 Exact")
        .unwrap();
    assert_eq!(linked["linked_dataset_id"], "dataset-1");
    fs::write(root.path().join("store.sqlite-wal"), b"active").unwrap();
    assert!(matches!(
        read(root.path(), None, "w", &links),
        Err(WorkspaceStoreReadError::LiveJournal(_))
    ));
}
