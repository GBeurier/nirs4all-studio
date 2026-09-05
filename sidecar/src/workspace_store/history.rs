//! Immutable history inputs from the separately published Store-v5 contract.

use rusqlite::{params, Connection, OpenFlags};
use serde_json::{json, Value};
use std::{collections::BTreeMap, path::Path};

use super::{
    canonical_workspace_store_path, file_stamp, immutable_read_only_uri, refuse_live_journals,
    row_to_results_summary_source, row_to_run_detail, validate_contract, validate_database,
    validate_results_summary_contract, validate_table_columns, WorkspaceStoreReadError,
    WorkspaceStoreResultsSummarySourceRow, MAX_RUN_SUMMARIES, PREDICTION_RANKING_COLUMNS,
    RESULTS_SUMMARY_CHAIN_COLUMNS, RESULTS_SUMMARY_PIPELINE_COLUMNS, RUN_DETAIL_RUN_COLUMNS,
};

const CONTRACT: &str = include_str!("../../contracts/workspace_store_run_history_v1.json");

pub type HistoricalScores = BTreeMap<(String, String, String), [Option<f64>; 2]>;

pub struct HistorySource {
    pub runs: Vec<Value>,
    pub total: u64,
    pub chains: Vec<WorkspaceStoreResultsSummarySourceRow>,
    pub historical_scores: HistoricalScores,
}

pub fn read_history(
    workspace: &Path,
    project_id: Option<&str>,
    limit: u16,
    offset: u64,
) -> Result<HistorySource, WorkspaceStoreReadError> {
    read_filtered_history(workspace, project_id, limit, offset, &[])
}

pub fn read_filtered_history(
    workspace: &Path,
    project_id: Option<&str>,
    limit: u16,
    offset: u64,
    statuses: &[String],
) -> Result<HistorySource, WorkspaceStoreReadError> {
    with_immutable_history(workspace, |connection| {
        read_filtered_history_from_connection(connection, project_id, limit, offset, statuses)
    })
}

pub fn read_history_stats(workspace: &Path) -> Result<Value, WorkspaceStoreReadError> {
    with_immutable_history(workspace, read_history_stats_from_connection)
}

fn with_immutable_history<T>(
    workspace: &Path,
    read: impl FnOnce(&Connection) -> Result<T, WorkspaceStoreReadError>,
) -> Result<T, WorkspaceStoreReadError> {
    let database = canonical_workspace_store_path(workspace)?;
    let before = file_stamp(&database)?;
    refuse_live_journals(&database)?;
    let connection = Connection::open_with_flags(
        immutable_read_only_uri(&database)?,
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_URI
            | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(query_error)?;
    let result = read(&connection);
    drop(connection);
    refuse_live_journals(&database)?;
    if file_stamp(&database)? != before {
        return Err(WorkspaceStoreReadError::ChangedDuringRead);
    }
    result
}

pub fn read_history_from_connection(
    connection: &Connection,
    project_id: Option<&str>,
    limit: u16,
    offset: u64,
) -> Result<HistorySource, WorkspaceStoreReadError> {
    read_filtered_history_from_connection(connection, project_id, limit, offset, &[])
}

pub fn read_filtered_history_from_connection(
    connection: &Connection,
    project_id: Option<&str>,
    limit: u16,
    offset: u64,
    statuses: &[String],
) -> Result<HistorySource, WorkspaceStoreReadError> {
    if limit == 0 || limit > MAX_RUN_SUMMARIES {
        return Err(WorkspaceStoreReadError::LimitOutOfRange(limit));
    }
    let offset =
        i64::try_from(offset).map_err(|_| WorkspaceStoreReadError::OffsetOutOfRange(offset))?;
    validate_contract()?;
    validate_database(connection)?;
    validate_table_columns(connection, "runs", &RUN_DETAIL_RUN_COLUMNS)?;
    let contract = history_contract()?;
    let statuses_json = serde_json::to_string(statuses).map_err(query_error)?;
    let query = |key: &str| {
        contract["queries"][key].as_str().ok_or_else(|| {
            WorkspaceStoreReadError::Contract(format!("history query {key} is absent"))
        })
    };
    let total = connection
        .query_row(
            query("runs_filtered_total")?,
            params![project_id, statuses_json],
            |row| row.get::<_, u64>(0),
        )
        .map_err(query_error)?;
    let mut statement = connection
        .prepare(query("runs_filtered_page")?)
        .map_err(query_error)?;
    let mut runs = statement
        .query_map(
            params![project_id, i64::from(limit), offset, statuses_json],
            |row| {
                let mut run = row_to_run_detail(row)?;
                run["duration_seconds"] = json!(row.get::<_, Option<i64>>(10)?);
                Ok(run)
            },
        )
        .map_err(query_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(query_error)?;
    for run in &mut runs {
        enrich_run_metadata(connection, run, &contract)?;
    }
    // Only selected runs are materialized. Historical comparisons are finite
    // SQL extrema for the relevant cohorts, never all workspace chain payloads.
    let chains = if runs.is_empty() {
        Vec::new()
    } else {
        read_page_chains(connection, &runs, query("page_chains")?)?
    };
    let mut cohorts = BTreeMap::<(String, String), Option<String>>::new();
    for chain in &chains {
        let metric = cohorts
            .entry((chain.run_id.clone(), chain.dataset_name.clone()))
            .or_default();
        if metric.is_none() {
            *metric = chain
                .metric
                .as_ref()
                .filter(|value| !value.is_empty())
                .cloned();
        }
    }
    let mut historical_scores = HistoricalScores::new();
    let mut historical = connection
        .prepare(query("historical_score_extrema")?)
        .map_err(query_error)?;
    for ((run_id, dataset), metric) in cohorts {
        // Same first-truthy-source metric/default as the ResultsSummary owner.
        let metric = metric.unwrap_or_else(|| "r2".into());
        let extrema = historical
            .query_row(params![dataset, metric, run_id], |row| {
                Ok([row.get::<_, Option<f64>>(0)?, row.get::<_, Option<f64>>(1)?])
            })
            .map_err(query_error)?;
        historical_scores.insert((run_id, dataset, metric), extrema);
    }
    Ok(HistorySource {
        runs,
        total,
        chains,
        historical_scores,
    })
}

fn enrich_run_metadata(
    connection: &Connection,
    run: &mut Value,
    contract: &Value,
) -> Result<(), WorkspaceStoreReadError> {
    let query = |key: &str| {
        contract["queries"][key].as_str().ok_or_else(|| {
            WorkspaceStoreReadError::Contract(format!("history query {key} is absent"))
        })
    };
    let id = run["run_id"]
        .as_str()
        .ok_or(WorkspaceStoreReadError::InvalidRunId)?
        .to_owned();
    let counts = connection
        .query_row(query("run_counts")?, [&id], |row| {
            Ok([
                row.get::<_, u64>(0)?,
                row.get::<_, u64>(1)?,
                row.get::<_, u64>(2)?,
                row.get::<_, u64>(3)?,
            ])
        })
        .map_err(query_error)?;
    for (key, value) in [
        "final_models_count",
        "total_folds",
        "total_models_trained",
        "pipeline_runs_count",
    ]
    .into_iter()
    .zip(counts)
    {
        run[key] = json!(value);
    }
    run["artifact_size_bytes"] = json!(connection
        .query_row(query("run_artifact_size")?, [&id], |row| row
            .get::<_, u64>(0))
        .map_err(query_error)?);
    let mut classes = connection
        .prepare(query("run_model_classes")?)
        .map_err(query_error)?;
    run["model_classes"] = Value::Array(
        classes
            .query_map([&id], |row| {
                Ok(json!({"name": row.get::<_, String>(0)?, "count": row.get::<_, u64>(1)?}))
            })
            .map_err(query_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(query_error)?,
    );
    let mut metadata = std::collections::BTreeMap::<String, Value>::new();
    let mut statement = connection
        .prepare(query("run_dataset_metadata")?)
        .map_err(query_error)?;
    let rows = statement.query_map([&id], |row| Ok(json!({
        "dataset_name": row.get::<_, String>(0)?, "n_samples": row.get::<_, Option<u64>>(1)?,
        "n_features": row.get::<_, Option<u64>>(2)?, "task_type": row.get::<_, Option<String>>(3)?,
        "metric": row.get::<_, Option<String>>(4)?,
    }))).map_err(query_error)?;
    for row in rows {
        let row = row.map_err(query_error)?;
        metadata
            .entry(row["dataset_name"].as_str().unwrap_or_default().into())
            .or_insert(row);
    }
    run["dataset_metadata"] = json!(metadata);
    Ok(())
}

fn read_page_chains(
    connection: &Connection,
    runs: &[Value],
    query: &str,
) -> Result<Vec<WorkspaceStoreResultsSummarySourceRow>, WorkspaceStoreReadError> {
    validate_results_summary_contract()?;
    validate_table_columns(connection, "chains", &RESULTS_SUMMARY_CHAIN_COLUMNS)?;
    validate_table_columns(connection, "pipelines", &RESULTS_SUMMARY_PIPELINE_COLUMNS)?;
    validate_table_columns(connection, "predictions", &PREDICTION_RANKING_COLUMNS)?;
    let ids = serde_json::to_string(&runs.iter().map(|run| &run["run_id"]).collect::<Vec<_>>())
        .map_err(query_error)?;
    let mut statement = connection.prepare(query).map_err(query_error)?;
    let mut chains = Vec::new();
    let mut offset = 0_i64;
    loop {
        let rows = statement
            .query_map(params![ids, 500_i64, offset], row_to_results_summary_source)
            .map_err(query_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(query_error)?;
        let count = i64::try_from(rows.len()).map_err(query_error)?;
        chains.extend(rows);
        if count < 500 {
            break;
        }
        offset = offset
            .checked_add(count)
            .ok_or_else(|| query_error("history chain offset overflowed"))?;
    }
    Ok(chains)
}

pub fn read_history_stats_from_connection(
    connection: &Connection,
) -> Result<Value, WorkspaceStoreReadError> {
    validate_contract()?;
    validate_database(connection)?;
    let contract = history_contract()?;
    let query = contract["queries"]["run_stats"]
        .as_str()
        .ok_or_else(|| WorkspaceStoreReadError::Contract("history stats query is absent".into()))?;
    connection
        .query_row(query, [], |row| {
            Ok(json!({
                    "running": row.get::<_, u64>(0)?, "queued": row.get::<_, u64>(1)?,
                    "completed": row.get::<_, u64>(2)?, "failed": row.get::<_, u64>(3)?,
            "total_pipelines": row.get::<_, u64>(4)?,
            "cancelled": row.get::<_, u64>(5)?, "partial": row.get::<_, u64>(6)?,
            "total": row.get::<_, u64>(7)?,
                }))
        })
        .map_err(query_error)
}

fn history_contract() -> Result<Value, WorkspaceStoreReadError> {
    let contract: Value = serde_json::from_str(CONTRACT)
        .map_err(|error| WorkspaceStoreReadError::Contract(error.to_string()))?;
    if contract["schema_id"] != "nirs4all.workspace-store-run-history.v1"
        || contract["schema_version"] != 1
        || contract["workspace_store_schema_version"] != 5
        || contract["store"]["open_mode"] != "sqlite_immutable_read_only"
        || contract["store"]["must_not_create_wal_or_shm"] != true
        || contract["parameters"]["page_chain_batch_size"] != 500
    {
        return Err(WorkspaceStoreReadError::Contract(
            "history contract identity differs from v1".into(),
        ));
    }
    Ok(contract)
}

fn query_error(error: impl std::fmt::Display) -> WorkspaceStoreReadError {
    WorkspaceStoreReadError::Query(error.to_string())
}
