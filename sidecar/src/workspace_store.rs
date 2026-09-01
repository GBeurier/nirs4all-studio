//! Read-only `WorkspaceStore` v5 projection consumed by the Studio sidecar.
//!
//! The SQL and its compatibility envelope are published by the Python
//! `WorkspaceStore` owner.  This module carries that versioned contract into the
//! native product, validates it defensively, and never opens a writer, a
//! `DuckDB` store, arrays, artifacts, or prediction payloads.

use std::{
    collections::BTreeSet,
    error::Error,
    fmt, fs,
    path::{Path, PathBuf},
    time::SystemTime,
};

use rusqlite::{params, Connection, OpenFlags, Row};
use serde_json::{json, Value};
use url::Url;

pub const WORKSPACE_STORE_SCHEMA_VERSION: i64 = 5;
pub const MAX_RUN_SUMMARIES: u16 = 500;
pub const DEFAULT_RUN_SUMMARIES_LIMIT: u16 = 100;
pub const MAX_PIPELINE_SUMMARIES: u16 = 500;
pub const DEFAULT_PIPELINE_SUMMARIES_LIMIT: u16 = 100;
pub const MAX_RANKED_CHAINS: u16 = 100;
pub const DEFAULT_RANKED_CHAINS_LIMIT: u16 = 5;
pub const WORKSPACE_STORE_READ_CONTRACT: &str =
    include_str!("../contracts/workspace_store_read_v1.json");

const CONTRACT_SCHEMA_ID: &str = "nirs4all.workspace-store-read.v1";
const CONTRACT_SCHEMA_VERSION: i64 = 1;
const STORE_FILENAME: &str = "store.sqlite";
const RUN_SUMMARY_QUERY: &str = "SELECT run_id, name, status, created_at, completed_at, datasets, summary, error FROM runs ORDER BY created_at DESC LIMIT ? OFFSET ?";
const PIPELINE_SUMMARY_QUERY: &str = "SELECT pipeline_id AS id, run_id, name AS pipeline_config, pipeline_id AS pipeline_config_id, dataset_name AS dataset, created_at, best_val AS best_score, best_test AS best_test_score, metric, status, duration_ms FROM pipelines ORDER BY CASE WHEN best_val IS NULL THEN 1 ELSE 0 END ASC, best_val DESC, created_at DESC, pipeline_id ASC LIMIT ? OFFSET ?";
const PIPELINE_SUMMARY_COUNT_QUERY: &str = "SELECT COUNT(*) FROM pipelines";
const RANKED_CHAIN_ASCENDING_QUERY: &str = "SELECT c.chain_id, c.pipeline_id, p.run_id, p.name AS pipeline_name, c.dataset_name, c.metric, c.task_type, c.model_name, c.model_class, c.preprocessings, c.cv_val_score, c.cv_test_score, c.cv_train_score, c.cv_fold_count, c.cv_scores, c.final_test_score, c.final_train_score, c.final_scores, c.final_agg_test_score, c.final_agg_train_score, c.final_agg_scores, c.best_params FROM chains AS c JOIN pipelines AS p ON p.pipeline_id = c.pipeline_id WHERE c.dataset_name = ? AND c.metric = ? AND EXISTS (SELECT 1 FROM predictions AS pr WHERE pr.chain_id = c.chain_id) ORDER BY (c.cv_val_score IS NULL) ASC, c.cv_val_score ASC, c.chain_id ASC LIMIT ? OFFSET ?";
const RANKED_CHAIN_DESCENDING_QUERY: &str = "SELECT c.chain_id, c.pipeline_id, p.run_id, p.name AS pipeline_name, c.dataset_name, c.metric, c.task_type, c.model_name, c.model_class, c.preprocessings, c.cv_val_score, c.cv_test_score, c.cv_train_score, c.cv_fold_count, c.cv_scores, c.final_test_score, c.final_train_score, c.final_scores, c.final_agg_test_score, c.final_agg_train_score, c.final_agg_scores, c.best_params FROM chains AS c JOIN pipelines AS p ON p.pipeline_id = c.pipeline_id WHERE c.dataset_name = ? AND c.metric = ? AND EXISTS (SELECT 1 FROM predictions AS pr WHERE pr.chain_id = c.chain_id) ORDER BY (c.cv_val_score IS NULL) ASC, c.cv_val_score DESC, c.chain_id ASC LIMIT ? OFFSET ?";
const RANKED_CHAIN_COUNT_QUERY: &str = "SELECT COUNT(*) FROM chains AS c JOIN pipelines AS p ON p.pipeline_id = c.pipeline_id WHERE c.dataset_name = ? AND c.metric = ? AND EXISTS (SELECT 1 FROM predictions AS pr WHERE pr.chain_id = c.chain_id)";
const RUN_COLUMNS: [&str; 8] = [
    "run_id",
    "name",
    "status",
    "created_at",
    "completed_at",
    "datasets",
    "summary",
    "error",
];
const PIPELINE_COLUMNS: [&str; 10] = [
    "pipeline_id",
    "run_id",
    "name",
    "dataset_name",
    "created_at",
    "best_val",
    "best_test",
    "metric",
    "status",
    "duration_ms",
];
const CHAIN_RANKING_COLUMNS: [&str; 20] = [
    "chain_id",
    "pipeline_id",
    "dataset_name",
    "metric",
    "task_type",
    "model_name",
    "model_class",
    "preprocessings",
    "cv_val_score",
    "cv_test_score",
    "cv_train_score",
    "cv_fold_count",
    "cv_scores",
    "final_test_score",
    "final_train_score",
    "final_scores",
    "final_agg_test_score",
    "final_agg_train_score",
    "final_agg_scores",
    "best_params",
];
const PREDICTION_RANKING_COLUMNS: [&str; 1] = ["chain_id"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceStoreRunSummary {
    id: String,
    name: String,
    status: String,
    created_at: String,
    completed_at: String,
    datasets: Value,
    summary: Value,
    error: Option<String>,
}

impl WorkspaceStoreRunSummary {
    #[must_use]
    pub fn response(&self) -> Value {
        json!({
            "id": self.id,
            "name": self.name,
            "status": self.status,
            "created_at": self.created_at,
            "completed_at": self.completed_at,
            "format": "store",
            "datasets": self.datasets,
            "summary": self.summary,
            "error": self.error,
        })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct WorkspaceStorePipelineSummary {
    id: String,
    run_id: String,
    pipeline_config: String,
    pipeline_config_id: String,
    dataset: String,
    created_at: String,
    best_score: Option<f64>,
    best_test_score: Option<f64>,
    metric: Option<String>,
    status: Option<String>,
    duration_ms: Option<i64>,
}

impl WorkspaceStorePipelineSummary {
    #[must_use]
    pub fn response(&self) -> Value {
        json!({
            "id": self.id,
            "run_id": self.run_id,
            "dataset": self.dataset,
            "pipeline_config": self.pipeline_config,
            "pipeline_config_id": self.pipeline_config_id,
            "created_at": self.created_at,
            "best_score": self.best_score,
            "best_test_score": self.best_test_score,
            "metric": self.metric,
            "status": self.status,
            "duration_ms": self.duration_ms,
            "format": "store",
        })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct WorkspaceStorePipelineSummaryPage {
    pub results: Vec<WorkspaceStorePipelineSummary>,
    pub total: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChainScoreDirection {
    Ascending,
    Descending,
}

#[derive(Debug, Clone, PartialEq)]
pub struct WorkspaceStoreRankedChain {
    chain_id: String,
    pipeline_id: String,
    run_id: String,
    pipeline_name: Option<String>,
    dataset_name: String,
    metric: String,
    task_type: Option<String>,
    model_name: Option<String>,
    model_class: Option<String>,
    preprocessings: String,
    cv_val_score: Option<f64>,
    cv_test_score: Option<f64>,
    cv_train_score: Option<f64>,
    cv_fold_count: i64,
    cv_scores: Value,
    final_test_score: Option<f64>,
    final_train_score: Option<f64>,
    final_scores: Value,
    final_agg_test_score: Option<f64>,
    final_agg_train_score: Option<f64>,
    final_agg_scores: Value,
    best_params: Option<Value>,
}

impl WorkspaceStoreRankedChain {
    #[must_use]
    pub fn response(&self) -> Value {
        json!({
            "chain_id": self.chain_id,
            "pipeline_id": self.pipeline_id,
            "run_id": self.run_id,
            "pipeline_name": self.pipeline_name,
            "dataset_name": self.dataset_name,
            "metric": self.metric,
            "task_type": self.task_type,
            "model_name": self.model_name,
            "model_class": self.model_class,
            "preprocessings": self.preprocessings,
            "cv_val_score": self.cv_val_score,
            "cv_test_score": self.cv_test_score,
            "cv_train_score": self.cv_train_score,
            "cv_fold_count": self.cv_fold_count,
            "cv_scores": self.cv_scores,
            "final_test_score": self.final_test_score,
            "final_train_score": self.final_train_score,
            "final_scores": self.final_scores,
            "final_agg_test_score": self.final_agg_test_score,
            "final_agg_train_score": self.final_agg_train_score,
            "final_agg_scores": self.final_agg_scores,
            "best_params": self.best_params,
        })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct WorkspaceStoreRankedChainPage {
    pub results: Vec<WorkspaceStoreRankedChain>,
    pub total: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkspaceStoreReadError {
    Contract(String),
    StoreNotFound,
    NotARegularFile(PathBuf),
    LiveJournal(PathBuf),
    #[cfg(windows)]
    UnsupportedPath(PathBuf),
    Open(String),
    SchemaVersion {
        expected: i64,
        actual: i64,
    },
    MissingColumns {
        table: &'static str,
        columns: Vec<String>,
    },
    LimitOutOfRange(u16),
    RankedChainLimitOutOfRange(u16),
    EmptyRankedChainFilter(&'static str),
    OffsetOutOfRange(u64),
    Query(String),
    ChangedDuringRead,
}

impl fmt::Display for WorkspaceStoreReadError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Contract(detail) => write!(formatter, "invalid WorkspaceStore read contract: {detail}"),
            Self::StoreNotFound => write!(formatter, "WorkspaceStore store.sqlite was not found"),
            Self::NotARegularFile(path) => write!(formatter, "WorkspaceStore path is not a regular file: {}", path.display()),
            Self::LiveJournal(path) => write!(
                formatter,
                "WorkspaceStore has an active SQLite journal sidecar: {}",
                path.display()
            ),
            #[cfg(windows)]
            Self::UnsupportedPath(path) => write!(
                formatter,
                "WorkspaceStore path is unsupported by the bundled SQLite build: {}",
                path.display()
            ),
            Self::Open(detail) => write!(formatter, "could not open WorkspaceStore read-only: {detail}"),
            Self::SchemaVersion { expected, actual } => write!(
                formatter,
                "WorkspaceStore schema version {actual} is incompatible; exact version {expected} is required"
            ),
            Self::MissingColumns { table, columns } => write!(
                formatter,
                "WorkspaceStore {table} table is missing required columns: {}",
                columns.join(", ")
            ),
            Self::LimitOutOfRange(limit) => write!(
                formatter,
                "WorkspaceStore summary limit {limit} is outside 1..={MAX_RUN_SUMMARIES}"
            ),
            Self::RankedChainLimitOutOfRange(limit) => write!(
                formatter,
                "WorkspaceStore ranked-chain limit {limit} is outside 1..={MAX_RANKED_CHAINS}"
            ),
            Self::EmptyRankedChainFilter(field) => {
                write!(formatter, "WorkspaceStore ranked-chain `{field}` must not be empty")
            }
            Self::OffsetOutOfRange(offset) => write!(
                formatter,
                "WorkspaceStore summary offset {offset} exceeds SQLite integer range"
            ),
            Self::Query(detail) => write!(formatter, "WorkspaceStore summary query failed: {detail}"),
            Self::ChangedDuringRead => write!(formatter, "WorkspaceStore changed while being read"),
        }
    }
}

impl Error for WorkspaceStoreReadError {}

#[derive(Debug, Clone, PartialEq, Eq)]
struct FileStamp {
    len: u64,
    modified: Option<SystemTime>,
}

/// Return the public Store v5 run-summary projection for a linked workspace.
///
/// The database is opened only through `SQLite`'s URI immutable/read-only mode.
/// A caller must treat [`WorkspaceStoreReadError::SchemaVersion`] as a
/// fail-closed compatibility result, rather than falling back to a private
/// schema reconstruction.
///
/// # Errors
///
/// Returns [`WorkspaceStoreReadError`] when the contract, location, immutable
/// snapshot, schema, bounds, or projected values fail validation.
pub fn read_run_summaries(
    workspace_path: &Path,
    limit: u16,
    offset: u64,
) -> Result<Vec<WorkspaceStoreRunSummary>, WorkspaceStoreReadError> {
    validate_contract()?;
    if limit == 0 || limit > MAX_RUN_SUMMARIES {
        return Err(WorkspaceStoreReadError::LimitOutOfRange(limit));
    }
    let offset =
        i64::try_from(offset).map_err(|_| WorkspaceStoreReadError::OffsetOutOfRange(offset))?;
    let database = canonical_workspace_store_path(workspace_path)?;
    let before = file_stamp(&database)?;
    refuse_live_journals(&database)?;
    let uri = immutable_read_only_uri(&database)?;
    let connection = Connection::open_with_flags(
        uri,
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_URI
            | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| WorkspaceStoreReadError::Open(error.to_string()))?;
    validate_database(&connection)?;
    let result = query_run_summaries(&connection, i64::from(limit), offset);
    drop(connection);
    refuse_live_journals(&database)?;
    if file_stamp(&database)? != before {
        return Err(WorkspaceStoreReadError::ChangedDuringRead);
    }
    result
}

/// Return the public Store v5 pipeline-summary page for a linked workspace.
///
/// This deliberately implements only the filter-free, bounded projection.
/// Scanner filters, chain rankings, and repository fallbacks remain outside
/// this contract and must not be reconstructed from private schema knowledge.
///
/// # Errors
///
/// Returns [`WorkspaceStoreReadError`] when the contract, location, immutable
/// snapshot, schema, bounds, or projected values fail validation.
pub fn read_pipeline_summaries(
    workspace_path: &Path,
    limit: u16,
    offset: u64,
) -> Result<WorkspaceStorePipelineSummaryPage, WorkspaceStoreReadError> {
    validate_contract()?;
    if limit == 0 || limit > MAX_PIPELINE_SUMMARIES {
        return Err(WorkspaceStoreReadError::LimitOutOfRange(limit));
    }
    let offset =
        i64::try_from(offset).map_err(|_| WorkspaceStoreReadError::OffsetOutOfRange(offset))?;
    let database = canonical_workspace_store_path(workspace_path)?;
    let before = file_stamp(&database)?;
    refuse_live_journals(&database)?;
    let uri = immutable_read_only_uri(&database)?;
    let connection = Connection::open_with_flags(
        uri,
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_URI
            | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| WorkspaceStoreReadError::Open(error.to_string()))?;
    validate_database(&connection)?;
    let result = query_pipeline_summaries(&connection, i64::from(limit), offset);
    drop(connection);
    refuse_live_journals(&database)?;
    if file_stamp(&database)? != before {
        return Err(WorkspaceStoreReadError::ChangedDuringRead);
    }
    result
}

/// Return one deterministic page from the public Store v5 chain-ranking primitive.
///
/// Metric direction is deliberately explicit. This reader does not infer metric
/// semantics and does not implement Studio's higher-level results-summary policy.
///
/// # Errors
///
/// Returns [`WorkspaceStoreReadError`] when filters or bounds are invalid, or
/// when the contract, immutable snapshot, schema, or row values fail validation.
pub fn read_ranked_chains(
    workspace_path: &Path,
    dataset_name: &str,
    metric: &str,
    direction: ChainScoreDirection,
    limit: u16,
    offset: u64,
) -> Result<WorkspaceStoreRankedChainPage, WorkspaceStoreReadError> {
    validate_contract()?;
    if dataset_name.is_empty() {
        return Err(WorkspaceStoreReadError::EmptyRankedChainFilter(
            "dataset_name",
        ));
    }
    if metric.is_empty() {
        return Err(WorkspaceStoreReadError::EmptyRankedChainFilter("metric"));
    }
    if limit == 0 || limit > MAX_RANKED_CHAINS {
        return Err(WorkspaceStoreReadError::RankedChainLimitOutOfRange(limit));
    }
    let offset =
        i64::try_from(offset).map_err(|_| WorkspaceStoreReadError::OffsetOutOfRange(offset))?;
    let database = canonical_workspace_store_path(workspace_path)?;
    let before = file_stamp(&database)?;
    refuse_live_journals(&database)?;
    let uri = immutable_read_only_uri(&database)?;
    let connection = Connection::open_with_flags(
        uri,
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_URI
            | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| WorkspaceStoreReadError::Open(error.to_string()))?;
    validate_database(&connection)?;
    validate_table_columns(&connection, "chains", &CHAIN_RANKING_COLUMNS)?;
    validate_table_columns(&connection, "predictions", &PREDICTION_RANKING_COLUMNS)?;
    let result = query_ranked_chains(
        &connection,
        dataset_name,
        metric,
        direction,
        i64::from(limit),
        offset,
    );
    drop(connection);
    refuse_live_journals(&database)?;
    if file_stamp(&database)? != before {
        return Err(WorkspaceStoreReadError::ChangedDuringRead);
    }
    result
}

fn validate_contract() -> Result<(), WorkspaceStoreReadError> {
    let contract: Value = serde_json::from_str(WORKSPACE_STORE_READ_CONTRACT)
        .map_err(|error| WorkspaceStoreReadError::Contract(error.to_string()))?;
    let expected_location = json!({
        "candidate_order": ["normalized_content_directory", "input_path"],
        "normalized_content_directory": {
            "workspace_subdirectory": "workspace",
            "direct_content_markers": ["runs", "exports"],
            "fallback": "workspace_subdirectory",
        },
        "selection": "first_existing_store_sqlite",
    });
    let projection = contract
        .pointer("/projections/studio_run_summary")
        .ok_or_else(|| WorkspaceStoreReadError::Contract("studio_run_summary is missing".into()))?;
    if contract.get("schema_id").and_then(Value::as_str) != Some(CONTRACT_SCHEMA_ID)
        || contract.get("schema_version").and_then(Value::as_i64) != Some(CONTRACT_SCHEMA_VERSION)
        || contract
            .get("workspace_store_schema_version")
            .and_then(Value::as_i64)
            != Some(WORKSPACE_STORE_SCHEMA_VERSION)
        || contract
            .pointer("/store/metadata_file")
            .and_then(Value::as_str)
            != Some(STORE_FILENAME)
        || contract.pointer("/store/open_mode").and_then(Value::as_str)
            != Some("sqlite_immutable_read_only")
        || contract
            .pointer("/store/compatibility")
            .and_then(Value::as_str)
            != Some("exact_schema_version")
        || contract
            .pointer("/store/path_support")
            .and_then(Value::as_str)
            != Some("local_filesystem_only")
        || contract.pointer("/store/unsupported_paths")
            != Some(&json!(["windows_unc", "windows_device_namespace"]))
        || contract
            .pointer("/store/writer_lock_required")
            .and_then(Value::as_bool)
            != Some(false)
        || contract
            .pointer("/store/must_not_create_wal_or_shm")
            .and_then(Value::as_bool)
            != Some(true)
        || projection.get("query").and_then(Value::as_str) != Some(RUN_SUMMARY_QUERY)
        || contract.get("workspace_location") != Some(&expected_location)
    {
        return Err(WorkspaceStoreReadError::Contract(
            "declared dispatch, SQLite mode, schema version, or SQL query differs from v1".into(),
        ));
    }
    let parameters = projection
        .get("parameters")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            WorkspaceStoreReadError::Contract("run-summary parameters are missing".into())
        })?;
    let expected_parameters = [
        json!({"name": "limit", "type": "integer", "minimum": 1, "maximum": MAX_RUN_SUMMARIES, "default": DEFAULT_RUN_SUMMARIES_LIMIT}),
        json!({"name": "offset", "type": "integer", "minimum": 0, "default": 0}),
    ];
    if parameters.as_slice() != expected_parameters.as_slice() {
        return Err(WorkspaceStoreReadError::Contract(
            "run-summary parameter bounds differ from v1".into(),
        ));
    }
    let fields = projection
        .get("fields")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            WorkspaceStoreReadError::Contract("run-summary fields are missing".into())
        })?;
    let expected_fields = [
        json!({"name": "id", "column": "run_id", "type": "string", "required": true}),
        json!({"name": "name", "column": "name", "type": "string", "required": true}),
        json!({"name": "status", "column": "status", "type": "string", "default": "unknown"}),
        json!({"name": "created_at", "column": "created_at", "type": "timestamp", "serialization": "iso8601", "default": ""}),
        json!({"name": "completed_at", "column": "completed_at", "type": "timestamp", "serialization": "iso8601", "default": ""}),
        json!({"name": "datasets", "column": "datasets", "type": "json", "default": []}),
        json!({"name": "summary", "column": "summary", "type": "json", "default": {}}),
        json!({"name": "error", "column": "error", "type": "string", "nullable": true}),
    ];
    if fields.len() != RUN_COLUMNS.len() || fields.as_slice() != expected_fields.as_slice() {
        return Err(WorkspaceStoreReadError::Contract(
            "run-summary field columns differ from v1".into(),
        ));
    }
    validate_pipeline_contract(&contract, &expected_parameters)?;
    validate_ranked_chain_contract(&contract)
}

fn validate_pipeline_contract(
    contract: &Value,
    expected_parameters: &[Value],
) -> Result<(), WorkspaceStoreReadError> {
    let pipeline_projection = contract
        .pointer("/projections/studio_pipeline_summary")
        .ok_or_else(|| {
            WorkspaceStoreReadError::Contract("studio_pipeline_summary is missing".into())
        })?;
    if pipeline_projection.get("query").and_then(Value::as_str) != Some(PIPELINE_SUMMARY_QUERY)
        || pipeline_projection
            .get("count_query")
            .and_then(Value::as_str)
            != Some(PIPELINE_SUMMARY_COUNT_QUERY)
        || pipeline_projection.get("response_constants") != Some(&json!({"format": "store"}))
        || pipeline_projection
            .get("parameters")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            != Some(expected_parameters)
    {
        return Err(WorkspaceStoreReadError::Contract(
            "pipeline-summary query, count, constants, or bounds differ from v1".into(),
        ));
    }
    let pipeline_fields = pipeline_projection
        .get("fields")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            WorkspaceStoreReadError::Contract("pipeline-summary fields are missing".into())
        })?;
    let expected_pipeline_fields = [
        json!({"name": "id", "column": "pipeline_id", "type": "string", "required": true}),
        json!({"name": "run_id", "column": "run_id", "type": "string", "required": true}),
        json!({"name": "pipeline_config", "column": "name", "type": "string", "required": true}),
        json!({"name": "pipeline_config_id", "column": "pipeline_id", "type": "string", "required": true}),
        json!({"name": "dataset", "column": "dataset_name", "type": "string", "required": true}),
        json!({"name": "created_at", "column": "created_at", "type": "timestamp", "serialization": "iso8601", "default": ""}),
        json!({"name": "best_score", "column": "best_val", "type": "number", "nullable": true}),
        json!({"name": "best_test_score", "column": "best_test", "type": "number", "nullable": true}),
        json!({"name": "metric", "column": "metric", "type": "string", "nullable": true}),
        json!({"name": "status", "column": "status", "type": "string", "nullable": true}),
        json!({"name": "duration_ms", "column": "duration_ms", "type": "integer", "nullable": true}),
    ];
    if pipeline_fields.as_slice() != expected_pipeline_fields.as_slice() {
        return Err(WorkspaceStoreReadError::Contract(
            "pipeline-summary fields differ from v1".into(),
        ));
    }
    Ok(())
}

fn validate_ranked_chain_contract(contract: &Value) -> Result<(), WorkspaceStoreReadError> {
    let projection = contract
        .pointer("/projections/studio_chain_ranked_v1")
        .ok_or_else(|| {
            WorkspaceStoreReadError::Contract("studio_chain_ranked_v1 is missing".into())
        })?;
    let expected_parameters = [
        json!({"name": "dataset_name", "type": "string", "minimum_length": 1}),
        json!({"name": "metric", "type": "string", "minimum_length": 1}),
        json!({"name": "direction", "type": "string", "enum": ["asc", "desc"], "required": true}),
        json!({"name": "limit", "type": "integer", "minimum": 1, "maximum": MAX_RANKED_CHAINS, "default": DEFAULT_RANKED_CHAINS_LIMIT}),
        json!({"name": "offset", "type": "integer", "minimum": 0, "default": 0}),
    ];
    if projection.get("source_tables") != Some(&json!(["chains", "pipelines", "predictions"]))
        || projection.get("eligibility").and_then(Value::as_str)
            != Some("at_least_one_prediction_for_chain")
        || projection.get("ascending_query").and_then(Value::as_str)
            != Some(RANKED_CHAIN_ASCENDING_QUERY)
        || projection.get("descending_query").and_then(Value::as_str)
            != Some(RANKED_CHAIN_DESCENDING_QUERY)
        || projection.get("count_query").and_then(Value::as_str) != Some(RANKED_CHAIN_COUNT_QUERY)
        || projection
            .get("parameters")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            != Some(expected_parameters.as_slice())
    {
        return Err(WorkspaceStoreReadError::Contract(
            "ranked-chain sources, queries, eligibility, or bounds differ from v1".into(),
        ));
    }
    let expected_fields = [
        json!({"name": "chain_id", "column": "chain_id", "type": "string", "required": true}),
        json!({"name": "pipeline_id", "column": "pipeline_id", "type": "string", "required": true}),
        json!({"name": "run_id", "column": "run_id", "type": "string", "required": true}),
        json!({"name": "pipeline_name", "column": "name", "type": "string", "nullable": true}),
        json!({"name": "dataset_name", "column": "dataset_name", "type": "string", "required": true}),
        json!({"name": "metric", "column": "metric", "type": "string", "required": true}),
        json!({"name": "task_type", "column": "task_type", "type": "string", "nullable": true}),
        json!({"name": "model_name", "column": "model_name", "type": "string", "nullable": true}),
        json!({"name": "model_class", "column": "model_class", "type": "string", "nullable": true}),
        json!({"name": "preprocessings", "column": "preprocessings", "type": "string", "default": ""}),
        json!({"name": "cv_val_score", "column": "cv_val_score", "type": "number", "nullable": true, "finite": true}),
        json!({"name": "cv_test_score", "column": "cv_test_score", "type": "number", "nullable": true, "finite": true}),
        json!({"name": "cv_train_score", "column": "cv_train_score", "type": "number", "nullable": true, "finite": true}),
        json!({"name": "cv_fold_count", "column": "cv_fold_count", "type": "integer", "minimum": 0, "default": 0}),
        json!({"name": "cv_scores", "column": "cv_scores", "type": "json_object", "default": {}}),
        json!({"name": "final_test_score", "column": "final_test_score", "type": "number", "nullable": true, "finite": true}),
        json!({"name": "final_train_score", "column": "final_train_score", "type": "number", "nullable": true, "finite": true}),
        json!({"name": "final_scores", "column": "final_scores", "type": "json_object", "default": {}}),
        json!({"name": "final_agg_test_score", "column": "final_agg_test_score", "type": "number", "nullable": true, "finite": true}),
        json!({"name": "final_agg_train_score", "column": "final_agg_train_score", "type": "number", "nullable": true, "finite": true}),
        json!({"name": "final_agg_scores", "column": "final_agg_scores", "type": "json_object", "default": {}}),
        json!({"name": "best_params", "column": "best_params", "type": "json_object", "nullable": true, "empty_object": "null"}),
    ];
    if projection
        .get("fields")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        != Some(expected_fields.as_slice())
        || projection.get("excluded_computed_fields")
            != Some(&json!([
                "variant_params",
                "synthetic_refit",
                "cv_source_chain_id",
                "is_refit_only"
            ]))
    {
        return Err(WorkspaceStoreReadError::Contract(
            "ranked-chain fields or exclusions differ from v1".into(),
        ));
    }
    Ok(())
}

fn workspace_store_path(workspace_path: &Path) -> Option<PathBuf> {
    let nested = workspace_path.join("workspace");
    let content = if nested.is_dir() {
        nested
    } else if workspace_path.join("runs").exists() || workspace_path.join("exports").exists() {
        workspace_path.to_path_buf()
    } else {
        nested
    };
    [content, workspace_path.to_path_buf()]
        .into_iter()
        .find_map(|candidate| {
            let database = candidate.join(STORE_FILENAME);
            database.exists().then_some(database)
        })
}

fn canonical_workspace_store_path(
    workspace_path: &Path,
) -> Result<PathBuf, WorkspaceStoreReadError> {
    workspace_store_path(workspace_path)
        .ok_or(WorkspaceStoreReadError::StoreNotFound)?
        .canonicalize()
        .map_err(|error| WorkspaceStoreReadError::Open(error.to_string()))
}

fn file_stamp(path: &Path) -> Result<FileStamp, WorkspaceStoreReadError> {
    let metadata =
        fs::metadata(path).map_err(|error| WorkspaceStoreReadError::Open(error.to_string()))?;
    if !metadata.is_file() {
        return Err(WorkspaceStoreReadError::NotARegularFile(path.to_path_buf()));
    }
    Ok(FileStamp {
        len: metadata.len(),
        modified: metadata.modified().ok(),
    })
}

fn refuse_live_journals(database: &Path) -> Result<(), WorkspaceStoreReadError> {
    let parent = database.parent().ok_or_else(|| {
        WorkspaceStoreReadError::Open("WorkspaceStore path has no parent directory".into())
    })?;
    let database_name = database
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| {
            WorkspaceStoreReadError::Open("WorkspaceStore filename is not valid UTF-8".into())
        })?;
    let journal_prefix = format!("{database_name}-mj");
    for entry in
        fs::read_dir(parent).map_err(|error| WorkspaceStoreReadError::Open(error.to_string()))?
    {
        let path = entry
            .map_err(|error| WorkspaceStoreReadError::Open(error.to_string()))?
            .path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if matches!(
            name,
            "store.sqlite-wal" | "store.sqlite-shm" | "store.sqlite-journal"
        ) || name.starts_with(&journal_prefix)
        {
            return Err(WorkspaceStoreReadError::LiveJournal(path));
        }
    }
    Ok(())
}

fn immutable_read_only_uri(path: &Path) -> Result<String, WorkspaceStoreReadError> {
    #[cfg(windows)]
    refuse_unsupported_path(path)?;
    let canonical = path
        .canonicalize()
        .map_err(|error| WorkspaceStoreReadError::Open(error.to_string()))?;
    let mut uri = Url::from_file_path(&canonical).map_err(|()| {
        WorkspaceStoreReadError::Open(
            "could not construct a file URI for the WorkspaceStore".into(),
        )
    })?;
    uri.set_query(Some("mode=ro&immutable=1"));
    Ok(uri.into())
}

#[cfg(windows)]
fn refuse_unsupported_path(path: &Path) -> Result<(), WorkspaceStoreReadError> {
    use std::path::{Component, Prefix};

    let unsupported = path.components().next().is_some_and(|component| {
        matches!(
            component,
            Component::Prefix(prefix)
                if matches!(
                    prefix.kind(),
                    Prefix::UNC(_, _)
                        | Prefix::VerbatimUNC(_, _)
                        | Prefix::Verbatim(_)
                        | Prefix::DeviceNS(_)
                )
        )
    });
    if unsupported {
        Err(WorkspaceStoreReadError::UnsupportedPath(path.to_path_buf()))
    } else {
        Ok(())
    }
}

fn validate_database(connection: &Connection) -> Result<(), WorkspaceStoreReadError> {
    let version = connection
        .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
        .map_err(|error| WorkspaceStoreReadError::Query(error.to_string()))?;
    if version != WORKSPACE_STORE_SCHEMA_VERSION {
        return Err(WorkspaceStoreReadError::SchemaVersion {
            expected: WORKSPACE_STORE_SCHEMA_VERSION,
            actual: version,
        });
    }
    validate_table_columns(connection, "runs", &RUN_COLUMNS)?;
    validate_table_columns(connection, "pipelines", &PIPELINE_COLUMNS)
}

fn validate_table_columns(
    connection: &Connection,
    table: &'static str,
    required: &[&str],
) -> Result<(), WorkspaceStoreReadError> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| WorkspaceStoreReadError::Query(error.to_string()))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| WorkspaceStoreReadError::Query(error.to_string()))?
        .collect::<Result<BTreeSet<_>, _>>()
        .map_err(|error| WorkspaceStoreReadError::Query(error.to_string()))?;
    let missing = required
        .iter()
        .filter(|column| !columns.contains(**column))
        .map(|column| (*column).to_owned())
        .collect::<Vec<_>>();
    if missing.is_empty() {
        Ok(())
    } else {
        Err(WorkspaceStoreReadError::MissingColumns {
            table,
            columns: missing,
        })
    }
}

fn query_run_summaries(
    connection: &Connection,
    limit: i64,
    offset: i64,
) -> Result<Vec<WorkspaceStoreRunSummary>, WorkspaceStoreReadError> {
    let mut statement = connection
        .prepare(RUN_SUMMARY_QUERY)
        .map_err(|error| WorkspaceStoreReadError::Query(error.to_string()))?;
    let rows = statement
        .query_map([limit, offset], row_to_run_summary)
        .map_err(|error| WorkspaceStoreReadError::Query(error.to_string()))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| WorkspaceStoreReadError::Query(error.to_string()))
}

fn query_pipeline_summaries(
    connection: &Connection,
    limit: i64,
    offset: i64,
) -> Result<WorkspaceStorePipelineSummaryPage, WorkspaceStoreReadError> {
    let total = connection
        .query_row(PIPELINE_SUMMARY_COUNT_QUERY, [], |row| row.get::<_, i64>(0))
        .map_err(|error| WorkspaceStoreReadError::Query(error.to_string()))?;
    let total = usize::try_from(total).map_err(|_| {
        WorkspaceStoreReadError::Query("pipeline-summary count is outside usize range".into())
    })?;
    let mut statement = connection
        .prepare(PIPELINE_SUMMARY_QUERY)
        .map_err(|error| WorkspaceStoreReadError::Query(error.to_string()))?;
    let rows = statement
        .query_map([limit, offset], row_to_pipeline_summary)
        .map_err(|error| WorkspaceStoreReadError::Query(error.to_string()))?;
    let results = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| WorkspaceStoreReadError::Query(error.to_string()))?;
    Ok(WorkspaceStorePipelineSummaryPage { results, total })
}

fn query_ranked_chains(
    connection: &Connection,
    dataset_name: &str,
    metric: &str,
    direction: ChainScoreDirection,
    limit: i64,
    offset: i64,
) -> Result<WorkspaceStoreRankedChainPage, WorkspaceStoreReadError> {
    let total = connection
        .query_row(
            RANKED_CHAIN_COUNT_QUERY,
            params![dataset_name, metric],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| WorkspaceStoreReadError::Query(error.to_string()))?;
    let total = usize::try_from(total).map_err(|_| {
        WorkspaceStoreReadError::Query("ranked-chain count is outside usize range".into())
    })?;
    let query = match direction {
        ChainScoreDirection::Ascending => RANKED_CHAIN_ASCENDING_QUERY,
        ChainScoreDirection::Descending => RANKED_CHAIN_DESCENDING_QUERY,
    };
    let mut statement = connection
        .prepare(query)
        .map_err(|error| WorkspaceStoreReadError::Query(error.to_string()))?;
    let rows = statement
        .query_map(
            params![dataset_name, metric, limit, offset],
            row_to_ranked_chain,
        )
        .map_err(|error| WorkspaceStoreReadError::Query(error.to_string()))?;
    let results = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| WorkspaceStoreReadError::Query(error.to_string()))?;
    Ok(WorkspaceStoreRankedChainPage { results, total })
}

fn row_to_run_summary(row: &Row<'_>) -> rusqlite::Result<WorkspaceStoreRunSummary> {
    Ok(WorkspaceStoreRunSummary {
        id: required_text(row, 0, "run_id")?,
        name: required_text(row, 1, "name")?,
        status: optional_text(row, 2)?.unwrap_or_else(|| "unknown".into()),
        created_at: iso8601_timestamp(optional_text(row, 3)?),
        completed_at: iso8601_timestamp(optional_text(row, 4)?),
        datasets: json_or_default(optional_text(row, 5)?, json!([])),
        summary: json_or_default(optional_text(row, 6)?, json!({})),
        error: optional_text(row, 7)?,
    })
}

fn row_to_pipeline_summary(row: &Row<'_>) -> rusqlite::Result<WorkspaceStorePipelineSummary> {
    Ok(WorkspaceStorePipelineSummary {
        id: required_text(row, 0, "pipeline_id")?,
        run_id: required_text(row, 1, "run_id")?,
        pipeline_config: required_text(row, 2, "name")?,
        pipeline_config_id: required_text(row, 3, "pipeline_id")?,
        dataset: required_text(row, 4, "dataset_name")?,
        created_at: iso8601_timestamp(optional_text(row, 5)?),
        best_score: optional_finite_f64(row, 6, "best_val")?,
        best_test_score: optional_finite_f64(row, 7, "best_test")?,
        metric: optional_text(row, 8)?,
        status: optional_text(row, 9)?,
        duration_ms: row.get(10)?,
    })
}

fn row_to_ranked_chain(row: &Row<'_>) -> rusqlite::Result<WorkspaceStoreRankedChain> {
    Ok(WorkspaceStoreRankedChain {
        chain_id: required_text(row, 0, "chain_id")?,
        pipeline_id: required_text(row, 1, "pipeline_id")?,
        run_id: required_text(row, 2, "run_id")?,
        pipeline_name: optional_text(row, 3)?,
        dataset_name: required_text(row, 4, "dataset_name")?,
        metric: required_text(row, 5, "metric")?,
        task_type: optional_text(row, 6)?,
        model_name: optional_text(row, 7)?,
        model_class: optional_text(row, 8)?,
        preprocessings: optional_text(row, 9)?.unwrap_or_default(),
        cv_val_score: optional_finite_f64(row, 10, "cv_val_score")?,
        cv_test_score: optional_finite_f64(row, 11, "cv_test_score")?,
        cv_train_score: optional_finite_f64(row, 12, "cv_train_score")?,
        cv_fold_count: nonnegative_i64_or_default(row, 13, "cv_fold_count")?,
        cv_scores: json_object_or_default(optional_text(row, 14)?),
        final_test_score: optional_finite_f64(row, 15, "final_test_score")?,
        final_train_score: optional_finite_f64(row, 16, "final_train_score")?,
        final_scores: json_object_or_default(optional_text(row, 17)?),
        final_agg_test_score: optional_finite_f64(row, 18, "final_agg_test_score")?,
        final_agg_train_score: optional_finite_f64(row, 19, "final_agg_train_score")?,
        final_agg_scores: json_object_or_default(optional_text(row, 20)?),
        best_params: nonempty_json_object(optional_text(row, 21)?),
    })
}

fn required_text(row: &Row<'_>, index: usize, field: &'static str) -> rusqlite::Result<String> {
    optional_text(row, index)?.ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            index,
            rusqlite::types::Type::Null,
            format!("required `{field}` is NULL").into(),
        )
    })
}

fn optional_text(row: &Row<'_>, index: usize) -> rusqlite::Result<Option<String>> {
    row.get(index)
}

fn optional_finite_f64(
    row: &Row<'_>,
    index: usize,
    field: &'static str,
) -> rusqlite::Result<Option<f64>> {
    let value = row.get::<_, Option<f64>>(index)?;
    if value.is_some_and(|number| !number.is_finite()) {
        return Err(rusqlite::Error::FromSqlConversionFailure(
            index,
            rusqlite::types::Type::Real,
            format!("`{field}` is not finite").into(),
        ));
    }
    Ok(value)
}

fn nonnegative_i64_or_default(
    row: &Row<'_>,
    index: usize,
    field: &'static str,
) -> rusqlite::Result<i64> {
    let value = row.get::<_, Option<i64>>(index)?.unwrap_or_default();
    if value < 0 {
        return Err(rusqlite::Error::FromSqlConversionFailure(
            index,
            rusqlite::types::Type::Integer,
            format!("`{field}` is negative").into(),
        ));
    }
    Ok(value)
}

fn iso8601_timestamp(raw: Option<String>) -> String {
    let mut value = raw.unwrap_or_default();
    if value.as_bytes().get(10) == Some(&b' ') {
        value.replace_range(10..11, "T");
    }
    value
}

fn json_or_default(raw: Option<String>, default: Value) -> Value {
    raw.and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or(default)
}

fn json_object_or_default(raw: Option<String>) -> Value {
    raw.and_then(|value| serde_json::from_str::<Value>(&value).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({}))
}

fn nonempty_json_object(raw: Option<String>) -> Option<Value> {
    raw.and_then(|value| serde_json::from_str::<Value>(&value).ok())
        .filter(|value| value.as_object().is_some_and(|object| !object.is_empty()))
}

#[cfg(test)]
mod tests {
    use std::{
        collections::BTreeSet,
        fs,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    use rusqlite::{params, Connection};
    use serde_json::json;

    use super::{
        read_pipeline_summaries, read_ranked_chains, read_run_summaries, ChainScoreDirection,
        WorkspaceStoreReadError, DEFAULT_PIPELINE_SUMMARIES_LIMIT, DEFAULT_RUN_SUMMARIES_LIMIT,
    };

    const PYTHON_WRITTEN_STORE: &[u8] =
        include_bytes!("../tests/fixtures/workspace_store_v5.sqlite");

    fn fixture_workspace(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let workspace = std::env::temp_dir().join(format!(
            "studio-sidecar-{name}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&workspace).unwrap();
        fs::write(workspace.join("store.sqlite"), PYTHON_WRITTEN_STORE).unwrap();
        workspace
    }

    fn populate_ranked_chains(workspace: &Path) {
        let connection = Connection::open(workspace.join("store.sqlite")).unwrap();
        let pipeline_id = "87654321-4321-6789-4321-678943216789";
        for (chain_id, score, metric, cv_scores, best_params) in [
            ("chain-a", Some(0.5), "rmse", Some("{}"), Some("{}")),
            (
                "chain-b",
                Some(0.1),
                "rmse",
                Some("{\"rmse\":0.1}"),
                Some("{\"n_components\":4}"),
            ),
            ("chain-c", None, "rmse", Some("not-json"), Some("[]")),
            ("chain-no-prediction", Some(0.01), "rmse", None, None),
            ("chain-z", Some(0.5), "rmse", None, None),
            ("chain-other-metric", Some(0.99), "r2", None, None),
        ] {
            connection
                .execute(
                    "INSERT INTO chains (chain_id, pipeline_id, steps, model_step_idx, model_class, dataset_name, metric, cv_val_score, cv_fold_count, cv_scores, best_params) VALUES (?, ?, '[]', 1, 'PLSRegression', 'corn', ?, ?, 2, ?, ?)",
                    params![chain_id, pipeline_id, metric, score, cv_scores, best_params],
                )
                .unwrap();
        }
        for chain_id in [
            "chain-a",
            "chain-b",
            "chain-c",
            "chain-z",
            "chain-other-metric",
        ] {
            connection
                .execute(
                    "INSERT INTO predictions (prediction_id, pipeline_id, chain_id, dataset_name, model_name, model_class, fold_id, partition, metric, task_type) VALUES (?, ?, ?, 'corn', 'PLS', 'PLSRegression', 'fold_0', 'val', 'rmse', 'regression')",
                    params![format!("prediction-{chain_id}"), pipeline_id, chain_id],
                )
                .unwrap();
        }
    }

    #[test]
    fn reads_the_python_written_v5_fixture_immutably() {
        let workspace = fixture_workspace("workspace-store-v5");
        let before = fs::read_dir(&workspace)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect::<BTreeSet<_>>();
        let before_database = fs::read(workspace.join("store.sqlite")).unwrap();

        let runs = read_run_summaries(&workspace, DEFAULT_RUN_SUMMARIES_LIMIT, 0).unwrap();

        assert_eq!(runs.len(), 1);
        assert_eq!(
            runs[0].response()["id"],
            "12345678-1234-5678-1234-567812345678"
        );
        assert_eq!(runs[0].response()["name"], "native scanner parity");
        assert_eq!(runs[0].response()["status"], "completed");
        assert_eq!(runs[0].response()["created_at"], "2026-09-01T07:54:59");
        assert_eq!(runs[0].response()["completed_at"], "2026-09-01T07:54:59");
        assert_eq!(
            runs[0].response()["datasets"],
            json!([{"name": "corn", "samples": 42}])
        );
        assert_eq!(
            runs[0].response()["summary"],
            json!({"total_results": 3, "best_score": 0.12})
        );
        assert_eq!(runs[0].response()["error"], json!(null));
        let after = fs::read_dir(&workspace)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect::<BTreeSet<_>>();
        assert_eq!(after, before);
        assert_eq!(
            fs::read(workspace.join("store.sqlite")).unwrap(),
            before_database
        );
        fs::remove_dir_all(workspace).unwrap();
    }

    #[test]
    fn reads_pipeline_summaries_with_nulls_and_score_ordering() {
        let workspace = fixture_workspace("workspace-store-pipelines-v5");
        let connection = Connection::open(workspace.join("store.sqlite")).unwrap();
        connection
            .execute(
                "UPDATE pipelines SET status = NULL WHERE pipeline_id = ?",
                ["aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"],
            )
            .unwrap();
        drop(connection);

        let page =
            read_pipeline_summaries(&workspace, DEFAULT_PIPELINE_SUMMARIES_LIMIT, 0).unwrap();

        assert_eq!(page.total, 2);
        assert_eq!(page.results.len(), 2);
        assert_eq!(
            page.results[0].response(),
            json!({
                "id": "87654321-4321-6789-4321-678943216789",
                "run_id": "12345678-1234-5678-1234-567812345678",
                "dataset": "corn",
                "pipeline_config": "0001_pls",
                "pipeline_config_id": "87654321-4321-6789-4321-678943216789",
                "created_at": "2026-09-01T08:00:00",
                "best_score": 0.12,
                "best_test_score": 0.15,
                "metric": "rmsecv",
                "status": "completed",
                "duration_ms": 1234,
                "format": "store",
            })
        );
        assert_eq!(page.results[1].response()["best_score"], json!(null));
        assert_eq!(page.results[1].response()["best_test_score"], json!(null));
        assert_eq!(page.results[1].response()["metric"], json!(null));
        assert_eq!(page.results[1].response()["status"], json!(null));
        fs::remove_dir_all(workspace).unwrap();
    }

    #[test]
    fn reads_ranked_chains_with_explicit_direction_stable_pages_and_json_defaults() {
        let workspace = fixture_workspace("workspace-store-ranked-chains-v5");
        populate_ranked_chains(&workspace);

        let ascending = read_ranked_chains(
            &workspace,
            "corn",
            "rmse",
            ChainScoreDirection::Ascending,
            100,
            0,
        )
        .unwrap();
        let descending = read_ranked_chains(
            &workspace,
            "corn",
            "rmse",
            ChainScoreDirection::Descending,
            100,
            0,
        )
        .unwrap();
        let second_page = read_ranked_chains(
            &workspace,
            "corn",
            "rmse",
            ChainScoreDirection::Ascending,
            2,
            2,
        )
        .unwrap();

        assert_eq!(ascending.total, 4);
        assert_eq!(
            ascending
                .results
                .iter()
                .map(|chain| chain.chain_id.as_str())
                .collect::<Vec<_>>(),
            ["chain-b", "chain-a", "chain-z", "chain-c"]
        );
        assert_eq!(
            descending
                .results
                .iter()
                .map(|chain| chain.chain_id.as_str())
                .collect::<Vec<_>>(),
            ["chain-a", "chain-z", "chain-b", "chain-c"]
        );
        assert_eq!(
            second_page
                .results
                .iter()
                .map(|chain| chain.chain_id.as_str())
                .collect::<Vec<_>>(),
            ["chain-z", "chain-c"]
        );
        assert_eq!(
            ascending.results[0].response()["cv_scores"],
            json!({"rmse": 0.1})
        );
        assert_eq!(
            ascending.results[0].response()["best_params"],
            json!({"n_components": 4})
        );
        assert_eq!(ascending.results[1].response()["best_params"], json!(null));
        assert_eq!(ascending.results[3].response()["cv_scores"], json!({}));
        assert_eq!(ascending.results[3].response()["best_params"], json!(null));
        fs::remove_dir_all(workspace).unwrap();
    }

    #[test]
    fn ranked_chain_reader_rejects_implicit_filters_and_unbounded_pages() {
        let workspace = fixture_workspace("workspace-store-ranked-chain-bounds-v5");
        assert!(matches!(
            read_ranked_chains(&workspace, "", "rmse", ChainScoreDirection::Ascending, 5, 0,),
            Err(WorkspaceStoreReadError::EmptyRankedChainFilter(
                "dataset_name"
            ))
        ));
        assert!(matches!(
            read_ranked_chains(
                &workspace,
                "corn",
                "",
                ChainScoreDirection::Descending,
                5,
                0,
            ),
            Err(WorkspaceStoreReadError::EmptyRankedChainFilter("metric"))
        ));
        assert!(matches!(
            read_ranked_chains(
                &workspace,
                "corn",
                "rmse",
                ChainScoreDirection::Ascending,
                101,
                0,
            ),
            Err(WorkspaceStoreReadError::RankedChainLimitOutOfRange(101))
        ));
        fs::remove_dir_all(workspace).unwrap();
    }

    #[test]
    fn refuses_non_v5_or_out_of_range_requests() {
        let workspace = fixture_workspace("workspace-store-v4");
        let connection = Connection::open(workspace.join("store.sqlite")).unwrap();
        connection.execute_batch("PRAGMA user_version = 4").unwrap();
        drop(connection);

        assert!(matches!(
            read_run_summaries(&workspace, DEFAULT_RUN_SUMMARIES_LIMIT, 0),
            Err(WorkspaceStoreReadError::SchemaVersion {
                expected: 5,
                actual: 4
            })
        ));
        assert!(matches!(
            read_run_summaries(&workspace, 0, 0),
            Err(WorkspaceStoreReadError::LimitOutOfRange(0))
        ));
        assert!(matches!(
            read_run_summaries(&workspace, 501, 0),
            Err(WorkspaceStoreReadError::LimitOutOfRange(501))
        ));
        assert!(matches!(
            read_run_summaries(&workspace, DEFAULT_RUN_SUMMARIES_LIMIT, u64::MAX),
            Err(WorkspaceStoreReadError::OffsetOutOfRange(u64::MAX))
        ));
        fs::remove_dir_all(workspace).unwrap();
    }

    #[test]
    fn follows_the_published_nested_workspace_location_rule() {
        let root = fixture_workspace("workspace-store-nested-root");
        let database = root.join("store.sqlite");
        let nested = root.join("workspace");
        fs::create_dir_all(&nested).unwrap();
        fs::rename(&database, nested.join("store.sqlite")).unwrap();

        let runs = read_run_summaries(&root, DEFAULT_RUN_SUMMARIES_LIMIT, 0).unwrap();

        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].response()["format"], "store");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refuses_a_v5_database_missing_the_published_projection_columns() {
        let workspace = fixture_workspace("workspace-store-missing-columns");
        let database = workspace.join("store.sqlite");
        fs::remove_file(&database).unwrap();
        let connection = Connection::open(&database).unwrap();
        connection
            .execute_batch("PRAGMA user_version = 5; CREATE TABLE runs (run_id TEXT PRIMARY KEY)")
            .unwrap();
        drop(connection);

        assert!(matches!(
            read_run_summaries(&workspace, DEFAULT_RUN_SUMMARIES_LIMIT, 0),
            Err(WorkspaceStoreReadError::MissingColumns { table: "runs", columns })
                if columns.contains(&"name".into())
        ));
        fs::remove_dir_all(workspace).unwrap();
    }

    #[test]
    fn refuses_a_workspace_with_an_active_wal_sidecar() {
        let workspace = fixture_workspace("workspace-store-wal");
        let wal = workspace.join("store.sqlite-wal");
        let writer = Connection::open(workspace.join("store.sqlite")).unwrap();
        writer
            .execute_batch(
                "PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0; \
                 UPDATE runs SET name = 'writer has uncheckpointed changes'",
            )
            .unwrap();
        assert!(wal.is_file());

        assert!(matches!(
            read_run_summaries(&workspace, DEFAULT_RUN_SUMMARIES_LIMIT, 0),
            Err(WorkspaceStoreReadError::LiveJournal(path)) if path == wal
        ));
        drop(writer);
        fs::remove_dir_all(workspace).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_symlink_whose_canonical_store_has_an_active_wal() {
        use std::os::unix::fs::symlink;

        let target = fixture_workspace("workspace-store-symlink-target-wal");
        let link_workspace = fixture_workspace("workspace-store-symlink-link-wal");
        fs::remove_file(link_workspace.join("store.sqlite")).unwrap();
        symlink(
            target.join("store.sqlite"),
            link_workspace.join("store.sqlite"),
        )
        .unwrap();
        let target_wal = target.join("store.sqlite-wal");
        fs::write(&target_wal, b"active canonical writer").unwrap();

        assert!(matches!(
            read_run_summaries(&link_workspace, DEFAULT_RUN_SUMMARIES_LIMIT, 0),
            Err(WorkspaceStoreReadError::LiveJournal(path)) if path == target_wal
        ));
        fs::remove_dir_all(link_workspace).unwrap();
        fs::remove_dir_all(target).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn refuses_unc_paths_before_opening_sqlite() {
        let path = PathBuf::from(r"\\server\share\store.sqlite");
        assert!(matches!(
            super::immutable_read_only_uri(&path),
            Err(WorkspaceStoreReadError::UnsupportedPath(unsupported)) if unsupported == path
        ));
    }
}
