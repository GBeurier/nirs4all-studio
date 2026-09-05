use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

use rusqlite::Connection;
use serde_json::{json, Value};

use super::{read_enriched_runs, read_enriched_runs_from_connection};
use crate::workspace_store::WorkspaceStoreReadError;

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "n4a-history-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        fs::write(
            path.join("store.sqlite"),
            include_bytes!("../tests/fixtures/workspace_store_v5_summary.sqlite"),
        )
        .unwrap();
        Self(path)
    }

    fn read(
        &self,
        project: Option<&str>,
        limit: u16,
        offset: u64,
    ) -> Result<Value, WorkspaceStoreReadError> {
        read_enriched_runs(&self.0, "workspace", &[], project, limit, offset)
    }

    fn edit(&self, sql: &str) {
        let connection = Connection::open(self.0.join("store.sqlite")).unwrap();
        connection.execute_batch(sql).unwrap();
        connection
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;")
            .unwrap();
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn history_reads_actual_store_without_changing_any_bytes_or_timestamp() {
    let fixture = Fixture::new();
    let database = fixture.0.join("store.sqlite");
    let before = (
        fs::read(&database).unwrap(),
        fs::metadata(&database).unwrap().modified().unwrap(),
    );
    let response = fixture.read(None, 100, 0).unwrap();
    assert_eq!(response["total"], 1);
    let run = &response["runs"][0];
    assert_eq!(run["name"], "results summary parity");
    assert!(run["pipeline_runs_count"].as_u64().unwrap() > 0);
    assert!(run["total_models_trained"].as_u64().unwrap() > 0);
    assert_eq!(
        usize::try_from(run["datasets_count"].as_u64().unwrap()).unwrap(),
        run["datasets"].as_array().unwrap().len()
    );
    assert!(run["datasets"]
        .as_array()
        .unwrap()
        .iter()
        .any(|dataset| !dataset["top_5"].as_array().unwrap().is_empty()));
    assert_eq!(
        before,
        (
            fs::read(&database).unwrap(),
            fs::metadata(&database).unwrap().modified().unwrap()
        )
    );
    assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 1);
}

#[test]
fn history_filters_projects_before_paging_and_preserves_names_and_empty_datasets() {
    let fixture = Fixture::new();
    fixture.edit("UPDATE runs SET project_id='a', created_at='2026-09-01';
        INSERT INTO runs (run_id,name,project_id,created_at,datasets) VALUES
        ('b','User_refit','b','2026-09-03','[]'),
        ('c','Selected_refit','a','2026-09-02','[{\"name\":\"Dataset_refit\",\"n_samples\":37,\"n_features\":300}]');");
    let page = fixture.read(Some("a"), 1, 0).unwrap();
    assert_eq!(page["total"], 2);
    assert_eq!(page["runs"][0]["name"], "Selected_refit");
    assert_eq!(
        page["runs"][0]["datasets"][0]["dataset_name"],
        "Dataset_refit"
    );
    assert_eq!(page["runs"][0]["datasets"][0]["n_features"], 300);
    assert_eq!(
        page["runs"][0]["datasets"][0]["best_final_score"],
        Value::Null
    );
    assert_eq!(page["runs"][0]["total_models_trained"], 0);
    assert_eq!(
        fixture.read(Some("a"), 1, 1).unwrap()["runs"][0]["name"],
        "results summary parity"
    );
    assert_eq!(
        fixture.read(Some("a"), 1, 2).unwrap(),
        json!({"runs":[],"total":2})
    );
    assert_eq!(
        fixture.read(Some("' OR 1=1 --"), 100, 0).unwrap(),
        json!({"runs":[],"total":0})
    );
}

#[test]
fn history_preserves_real_train_only_refit_without_inventing_a_test_score() {
    let fixture = Fixture::new();
    fixture.edit(
        "UPDATE chains SET final_test_score=NULL, final_train_score=0.125,
        final_scores='{\"train\":{\"rmse\":0.125}}';",
    );
    let response = fixture.read(None, 100, 0).unwrap();
    let mut checked = 0;
    for dataset in response["runs"][0]["datasets"].as_array().unwrap() {
        assert_eq!(dataset["best_final_score"], Value::Null);
        for chain in dataset["top_5"].as_array().unwrap() {
            assert_eq!(chain["final_test_score"], Value::Null);
            assert_eq!(chain["final_train_score"], 0.125);
            assert_eq!(chain["synthetic_refit"], false);
            checked += 1;
        }
    }
    assert!(checked > 0);
}

#[test]
fn history_connection_and_immutable_file_projection_are_identical() {
    let fixture = Fixture::new();
    let mut uri = url::Url::from_file_path(fixture.0.join("store.sqlite")).unwrap();
    uri.set_query(Some("mode=ro&immutable=1"));
    let connection = Connection::open_with_flags(
        uri.as_str(),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_URI,
    )
    .unwrap();
    let snapshot =
        read_enriched_runs_from_connection(&connection, "workspace", &[], None, 100, 0).unwrap();
    drop(connection);
    assert_eq!(snapshot, fixture.read(None, 100, 0).unwrap());
}

#[test]
fn history_refuses_invalid_bounds_schema_and_live_journals() {
    let fixture = Fixture::new();
    assert!(matches!(
        fixture.read(None, 0, 0),
        Err(WorkspaceStoreReadError::LimitOutOfRange(0))
    ));
    assert!(matches!(
        fixture.read(None, 501, 0),
        Err(WorkspaceStoreReadError::LimitOutOfRange(501))
    ));
    assert!(matches!(
        fixture.read(None, 1, u64::MAX),
        Err(WorkspaceStoreReadError::OffsetOutOfRange(_))
    ));
    fixture.edit("PRAGMA user_version=4;");
    assert!(matches!(
        fixture.read(None, 100, 0),
        Err(WorkspaceStoreReadError::SchemaVersion { actual: 4, .. })
    ));
    fixture.edit("PRAGMA user_version=5;");
    fs::write(fixture.0.join("store.sqlite-wal"), b"active writer").unwrap();
    assert!(matches!(
        fixture.read(None, 100, 0),
        Err(WorkspaceStoreReadError::LiveJournal(_))
    ));
}

#[test]
fn history_refuses_malformed_metadata_instead_of_silently_replacing_it() {
    let fixture = Fixture::new();
    fixture.edit("UPDATE runs SET config='[]';");
    assert!(fixture.read(None, 100, 0).is_err());
}

#[test]
fn history_stats_cover_all_rows_without_loading_chains_or_arrays() {
    let fixture = Fixture::new();
    fixture.edit("WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<600)
        INSERT INTO runs(run_id,name,status) SELECT 'bulk-'||n,'Historical',CASE WHEN n%2=0 THEN 'running' ELSE 'failed' END FROM seq;");
    let stats = crate::workspace_store::history::read_history_stats(&fixture.0).unwrap();
    assert_eq!(stats["running"], 300);
    assert_eq!(stats["failed"], 300);
    assert_eq!(stats["completed"], 1);
    assert_eq!(stats["total"], 601);
    assert_eq!(stats["cancelled"], 0);
    assert!(stats["total_pipelines"].as_u64().unwrap() > 0);
    fixture.edit("DROP TABLE predictions; DROP TABLE chains;");
    assert_eq!(
        stats,
        crate::workspace_store::history::read_history_stats(&fixture.0).unwrap()
    );
}

#[test]
fn history_counts_pipelines_not_each_model_chain_in_a_pipeline() {
    let fixture = Fixture::new();
    fixture.edit("UPDATE chains SET pipeline_id=(SELECT pipeline_id FROM chains WHERE dataset_name='R2 Exact' LIMIT 1) WHERE dataset_name='R2 Exact';
        UPDATE predictions SET pipeline_id=(SELECT c.pipeline_id FROM chains c WHERE c.chain_id=predictions.chain_id) WHERE dataset_name='R2 Exact';");
    let response = fixture.read(None, 100, 0).unwrap();
    let dataset = response["runs"][0]["datasets"]
        .as_array()
        .unwrap()
        .iter()
        .find(|dataset| dataset["dataset_name"] == "R2 Exact")
        .unwrap();
    assert!(dataset["top_5"].as_array().unwrap().len() > 1);
    assert_eq!(dataset["pipeline_count"], 1);
}

#[test]
fn history_fills_missing_dimensions_from_stored_metadata_without_overriding_run_values() {
    let fixture = Fixture::new();
    fixture.edit(
        "UPDATE runs SET datasets='[{\"name\":\"R2 Exact\",\"n_samples\":123}]';
        UPDATE predictions SET n_samples=37,n_features=300;",
    );
    let response = fixture.read(None, 100, 0).unwrap();
    let run = &response["runs"][0];
    assert!(run.get("dataset_metadata").is_none());
    let dataset = run["datasets"]
        .as_array()
        .unwrap()
        .iter()
        .find(|dataset| dataset["dataset_name"] == "R2 Exact")
        .unwrap();
    assert_eq!(dataset["n_samples"], 123);
    assert_eq!(dataset["n_features"], 300);
}

#[test]
fn history_status_filter_precedes_page_and_keeps_full_matching_total() {
    let fixture = Fixture::new();
    fixture.edit("WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<600)
        INSERT INTO runs(run_id,name,status,created_at,project_id) SELECT 'new-'||n,'New','completed','2099-01-01','a' FROM seq;
        INSERT INTO runs(run_id,name,status,created_at,project_id) VALUES
        ('old-a','Failed A','failed','2000-01-01','a'),('old-b','Failed B','failed','2000-01-01','a');");
    let page = super::read_filtered_enriched_runs(
        &fixture.0,
        "workspace",
        &[],
        Some("a"),
        1,
        1,
        &["failed".into()],
    )
    .unwrap();
    assert_eq!(page["total"], 2);
    assert_eq!(page["runs"][0]["run_id"], "old-b");
    let empty = super::read_filtered_enriched_runs(
        &fixture.0,
        "workspace",
        &[],
        Some("a"),
        1,
        2,
        &["failed".into()],
    )
    .unwrap();
    assert_eq!(empty, json!({"runs":[],"total":2}));
    let injection = super::read_filtered_enriched_runs(
        &fixture.0,
        "workspace",
        &[],
        None,
        100,
        0,
        &["' OR 1=1 --".into()],
    )
    .unwrap();
    assert_eq!(injection, json!({"runs":[],"total":0}));
}

#[test]
fn history_page_chain_payloads_exclude_other_runs_but_gains_keep_their_scores() {
    let fixture = Fixture::new();
    fixture.edit("UPDATE runs SET project_id='a',created_at='2026-01-01';
        INSERT INTO runs(run_id,name,status,created_at,project_id) VALUES ('historical','History','failed','2000-01-01','b');
        INSERT INTO pipelines(pipeline_id,run_id,name,dataset_name) VALUES ('historical-p','historical','History','R2 Exact');
        INSERT INTO chains(chain_id,pipeline_id,steps,model_step_idx,model_class,dataset_name,metric,cv_val_score,cv_fold_count)
        SELECT 'historical-c','historical-p','[]',1,'Model','R2 Exact',metric,0.3,1 FROM chains WHERE dataset_name='R2 Exact' LIMIT 1;
        INSERT INTO predictions(prediction_id,pipeline_id,chain_id,dataset_name,model_name,model_class,fold_id,partition,metric,task_type)
        SELECT 'historical-pr','historical-p','historical-c','R2 Exact','Model','Model','0','val',metric,'regression' FROM chains WHERE chain_id='historical-c';");
    fixture.edit("INSERT INTO chains(chain_id,pipeline_id,steps,model_step_idx,model_class,dataset_name,metric,cv_val_score,cv_fold_count)
        SELECT 'historical-c2',pipeline_id,steps,model_step_idx,model_class,dataset_name,metric,0.9,1 FROM chains WHERE chain_id='historical-c';
        INSERT INTO predictions(prediction_id,pipeline_id,chain_id,dataset_name,model_name,model_class,fold_id,partition,metric,task_type)
        SELECT 'historical-pr2',pipeline_id,'historical-c2',dataset_name,model_name,model_class,fold_id,partition,metric,task_type FROM predictions WHERE prediction_id='historical-pr';
        INSERT INTO pipelines(pipeline_id,run_id,name,dataset_name) SELECT 'bulk-p',run_id,'Bulk','unscored' FROM runs WHERE project_id='a';
        WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<600)
        INSERT INTO chains(chain_id,pipeline_id,steps,model_step_idx,model_class,dataset_name,metric)
        SELECT 'bulk-c-'||n,'bulk-p','[]',1,'Model','unscored','rmse' FROM seq;
        INSERT INTO predictions(prediction_id,pipeline_id,chain_id,dataset_name,model_name,model_class,fold_id,partition,metric,task_type)
        SELECT chain_id,'bulk-p',chain_id,'unscored','Model','Model','0','val','rmse','regression' FROM chains WHERE pipeline_id='bulk-p';");
    let source = crate::workspace_store::history::read_filtered_history(
        &fixture.0,
        Some("a"),
        1,
        0,
        &["completed".into()],
    )
    .unwrap();
    assert_eq!(source.runs.len(), 1);
    assert!(source.chains.len() > 600); // internal 500-row pages never truncate a selected run
    assert!(source
        .chains
        .iter()
        .all(|chain| chain.run_id != "historical"));
    assert!(source
        .historical_scores
        .values()
        .any(|value| value == &[Some(0.3), Some(0.9)]));
    let page = super::read_filtered_enriched_runs(
        &fixture.0,
        "workspace",
        &[],
        Some("a"),
        1,
        0,
        &["completed".into()],
    )
    .unwrap();
    let dataset = page["runs"][0]["datasets"]
        .as_array()
        .unwrap()
        .iter()
        .find(|dataset| dataset["dataset_name"] == "R2 Exact")
        .unwrap();
    let current = dataset["best_avg_val_score"].as_f64().unwrap();
    assert_eq!(
        dataset["gain_from_previous_best"],
        json!(((current - 0.9) * 1e6).round_ties_even() / 1e6)
    );
}

#[test]
fn history_null_config_uses_available_metadata_but_preserves_explicit_values() {
    let fixture = Fixture::new();
    fixture
        .edit("UPDATE runs SET config='{\"has_refit\":null,\"cv_folds\":null,\"metric\":null}';");
    let response = fixture.read(None, 100, 0).unwrap();
    let run = &response["runs"][0];
    assert_eq!(
        run["config"]["has_refit"],
        json!(run["final_models_count"].as_u64().unwrap() > 0)
    );
    assert_eq!(run["config"]["cv_folds"], run["total_folds"]);
    assert!(run["config"]["metric"].is_string());
    fixture.edit(
        "UPDATE runs SET config='{\"has_refit\":false,\"cv_folds\":0,\"metric\":\"explicit\"}';",
    );
    let explicit = fixture.read(None, 100, 0).unwrap();
    assert_eq!(explicit["runs"][0]["config"]["has_refit"], false);
    assert_eq!(explicit["runs"][0]["config"]["cv_folds"], 0);
    assert_eq!(explicit["runs"][0]["config"]["metric"], "explicit");
}
