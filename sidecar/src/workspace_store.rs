//! Read-only `WorkspaceStore` v5 projection consumed by the Studio sidecar.
//!
//! The SQL and its compatibility envelope are published by the Python
//! `WorkspaceStore` owner.  This module carries that versioned contract into the
//! native product, validates it defensively, and never opens a writer, a
//! `DuckDB` store, arrays, or prediction payloads. The one explicit artifact
//! exception is the bounded Archive V2 registration projection: it reads only
//! Store-owned path/hash metadata and never opens or interprets artifact bytes.

use std::{
    collections::BTreeSet,
    error::Error,
    fmt, fs,
    path::{Path, PathBuf},
    time::SystemTime,
};

use rusqlite::{params, Connection, OpenFlags, OptionalExtension, Row, TransactionBehavior};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use url::Url;

pub(crate) mod history;

pub const WORKSPACE_STORE_SCHEMA_VERSION: i64 = 5;
pub const MAX_RUN_SUMMARIES: u16 = 500;
pub const DEFAULT_RUN_SUMMARIES_LIMIT: u16 = 100;
pub const MAX_PIPELINE_SUMMARIES: u16 = 500;
pub const DEFAULT_PIPELINE_SUMMARIES_LIMIT: u16 = 100;
pub const MAX_RANKED_CHAINS: u16 = 100;
pub const DEFAULT_RANKED_CHAINS_LIMIT: u16 = 5;
pub const WORKSPACE_STORE_READ_CONTRACT: &str =
    include_str!("../contracts/workspace_store_read_v1.json");
pub const WORKSPACE_STORE_RESULTS_SUMMARY_CONTRACT: &str =
    include_str!("../contracts/workspace_store_results_summary_v1.json");
pub const STUDIO_RUN_DETAIL_HTTP_CONTRACT: &str =
    include_str!("../contracts/studio_run_detail_http_v1.json");

const CONTRACT_SCHEMA_ID: &str = "nirs4all.workspace-store-read.v1";
const CONTRACT_SCHEMA_VERSION: i64 = 1;
const STORE_FILENAME: &str = "store.sqlite";
const RUN_SUMMARY_QUERY: &str = "SELECT run_id, name, status, created_at, completed_at, datasets, summary, error FROM runs ORDER BY created_at DESC LIMIT ? OFFSET ?";
const RUN_DETAIL_QUERY: &str = "SELECT run_id, name, config, datasets, status, created_at, completed_at, summary, error, project_id FROM runs WHERE run_id = ?";
const RUN_DETAIL_PIPELINES_QUERY: &str = "SELECT pipeline_id, run_id, name, expanded_config, original_template, generator_choices, dataset_name, dataset_hash, status, created_at, completed_at, best_val, best_test, metric, duration_ms, error FROM pipelines WHERE run_id = ? ORDER BY created_at DESC, pipeline_id ASC";
const RUN_DETAIL_HAS_REFIT_QUERY: &str = "SELECT CASE WHEN EXISTS (SELECT 1 FROM chains AS c JOIN pipelines AS p ON p.pipeline_id = c.pipeline_id WHERE p.run_id = ? AND (c.final_test_score IS NOT NULL OR c.final_train_score IS NOT NULL)) THEN 1 ELSE 0 END AS has_refit";
const RUN_DETAIL_LOG_SUMMARY_QUERY: &str = "SELECT p.pipeline_id, p.name AS pipeline_name, p.status AS pipeline_status, COUNT(l.log_id) AS log_count, COALESCE(SUM(CASE WHEN l.event = 'end' THEN l.duration_ms ELSE 0 END), 0) AS total_duration_ms, SUM(CASE WHEN l.level = 'warning' THEN 1 ELSE 0 END) AS warning_count, SUM(CASE WHEN l.level = 'error' THEN 1 ELSE 0 END) AS error_count FROM pipelines AS p LEFT JOIN logs AS l ON p.pipeline_id = l.pipeline_id WHERE p.run_id = ? GROUP BY p.pipeline_id, p.name, p.status, p.created_at ORDER BY p.created_at ASC, p.pipeline_id ASC";
const PIPELINE_SUMMARY_QUERY: &str = "SELECT pipeline_id AS id, run_id, name AS pipeline_config, pipeline_id AS pipeline_config_id, dataset_name AS dataset, created_at, best_val AS best_score, best_test AS best_test_score, metric, status, duration_ms FROM pipelines ORDER BY CASE WHEN best_val IS NULL THEN 1 ELSE 0 END ASC, best_val DESC, created_at DESC, pipeline_id ASC LIMIT ? OFFSET ?";
const PIPELINE_SUMMARY_COUNT_QUERY: &str = "SELECT COUNT(*) FROM pipelines";
const RANKED_CHAIN_ASCENDING_QUERY: &str = "SELECT c.chain_id, c.pipeline_id, p.run_id, p.name AS pipeline_name, c.dataset_name, c.metric, c.task_type, c.model_name, c.model_class, c.preprocessings, c.cv_val_score, c.cv_test_score, c.cv_train_score, c.cv_fold_count, c.cv_scores, c.final_test_score, c.final_train_score, c.final_scores, c.final_agg_test_score, c.final_agg_train_score, c.final_agg_scores, c.best_params FROM chains AS c JOIN pipelines AS p ON p.pipeline_id = c.pipeline_id WHERE c.dataset_name = ? AND c.metric = ? AND EXISTS (SELECT 1 FROM predictions AS pr WHERE pr.chain_id = c.chain_id) ORDER BY (c.cv_val_score IS NULL) ASC, c.cv_val_score ASC, c.chain_id ASC LIMIT ? OFFSET ?";
const RANKED_CHAIN_DESCENDING_QUERY: &str = "SELECT c.chain_id, c.pipeline_id, p.run_id, p.name AS pipeline_name, c.dataset_name, c.metric, c.task_type, c.model_name, c.model_class, c.preprocessings, c.cv_val_score, c.cv_test_score, c.cv_train_score, c.cv_fold_count, c.cv_scores, c.final_test_score, c.final_train_score, c.final_scores, c.final_agg_test_score, c.final_agg_train_score, c.final_agg_scores, c.best_params FROM chains AS c JOIN pipelines AS p ON p.pipeline_id = c.pipeline_id WHERE c.dataset_name = ? AND c.metric = ? AND EXISTS (SELECT 1 FROM predictions AS pr WHERE pr.chain_id = c.chain_id) ORDER BY (c.cv_val_score IS NULL) ASC, c.cv_val_score DESC, c.chain_id ASC LIMIT ? OFFSET ?";
const RANKED_CHAIN_COUNT_QUERY: &str = "SELECT COUNT(*) FROM chains AS c JOIN pipelines AS p ON p.pipeline_id = c.pipeline_id WHERE c.dataset_name = ? AND c.metric = ? AND EXISTS (SELECT 1 FROM predictions AS pr WHERE pr.chain_id = c.chain_id)";
const RESULTS_SUMMARY_PAGE_QUERY: &str = "SELECT c.chain_id, c.pipeline_id, p.run_id, p.name AS pipeline_name, p.expanded_config, c.model_step_idx, c.dataset_name, c.metric, c.task_type, c.model_name, c.model_class, c.preprocessings, c.cv_val_score, c.cv_test_score, c.cv_train_score, c.cv_fold_count, c.cv_scores, c.final_test_score, c.final_train_score, c.final_scores, c.final_agg_test_score, c.final_agg_train_score, c.final_agg_scores, c.best_params FROM chains AS c JOIN pipelines AS p ON p.pipeline_id = c.pipeline_id WHERE EXISTS (SELECT 1 FROM predictions AS pr WHERE pr.chain_id = c.chain_id) ORDER BY c.chain_id ASC LIMIT ? OFFSET ?";
const RESULTS_SUMMARY_COUNT_QUERY: &str = "SELECT COUNT(*) FROM chains AS c JOIN pipelines AS p ON p.pipeline_id = c.pipeline_id WHERE EXISTS (SELECT 1 FROM predictions AS pr WHERE pr.chain_id = c.chain_id)";
const RESULTS_SUMMARY_PAGE_SIZE: i64 = 500;
const ARCHIVE_V2_REGISTRATION_QUERY: &str = "SELECT artifact_id, artifact_path, content_hash FROM artifacts WHERE format = 'n4a' AND ref_count > 0 ORDER BY artifact_id ASC LIMIT 129";
const MAX_ARCHIVE_V2_REGISTRATIONS: usize = 128;
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
const RUN_DETAIL_RUN_COLUMNS: [&str; 10] = [
    "run_id",
    "name",
    "config",
    "datasets",
    "status",
    "created_at",
    "completed_at",
    "summary",
    "error",
    "project_id",
];
const RUN_DETAIL_PIPELINE_COLUMNS: [&str; 16] = [
    "pipeline_id",
    "run_id",
    "name",
    "expanded_config",
    "original_template",
    "generator_choices",
    "dataset_name",
    "dataset_hash",
    "status",
    "created_at",
    "completed_at",
    "best_val",
    "best_test",
    "metric",
    "duration_ms",
    "error",
];
const RUN_DETAIL_CHAIN_COLUMNS: [&str; 3] =
    ["pipeline_id", "final_test_score", "final_train_score"];
const RUN_DETAIL_LOG_COLUMNS: [&str; 5] =
    ["log_id", "pipeline_id", "event", "duration_ms", "level"];
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
const RESULTS_SUMMARY_CHAIN_COLUMNS: [&str; 21] = [
    "chain_id",
    "pipeline_id",
    "model_step_idx",
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
const RESULTS_SUMMARY_PIPELINE_COLUMNS: [&str; 5] = [
    "pipeline_id",
    "run_id",
    "name",
    "expanded_config",
    "created_at",
];
const ARCHIVE_V2_REGISTRATION_COLUMNS: [&str; 6] = [
    "artifact_id",
    "artifact_path",
    "content_hash",
    "format",
    "ref_count",
    "size_bytes",
];

/// Store-owned registration for a possible Archive V2. `artifact_path` is
///
/// relative to the workspace `artifacts/` directory. Core remains the format
/// and predictor identity authority before any row reaches the renderer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceStoreArchiveV2Registration {
    pub artifact_id: String,
    pub artifact_path: String,
    pub content_hash: String,
}

/// Atomically register one already-written, content-addressed Archive V2 in
/// the selected `WorkspaceStore` v5. The artifact itself is re-attested here;
/// callers cannot register arbitrary or changed bytes.
///
/// # Errors
/// Refuses noncanonical identities, changed artifacts, and unavailable stores.
#[expect(
    clippy::case_sensitive_file_extension_comparisons,
    reason = "the persisted Archive V2 contract requires canonical lowercase .n4a refs"
)]
pub fn register_archive_v2_artifact(
    workspace_path: &Path,
    registration: &WorkspaceStoreArchiveV2Registration,
    size_bytes: u64,
) -> Result<(), String> {
    if registration.artifact_id.is_empty()
        || registration.artifact_id.len() > 256
        || registration.artifact_path.is_empty()
        || registration.artifact_path.len() > 240
        || registration.artifact_path.contains('\\')
        || registration
            .artifact_path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
        || !registration.artifact_path.ends_with(".n4a")
        || registration.content_hash.len() != 64
        || !registration
            .content_hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err("Archive V2 registration identity is invalid".into());
    }
    let workspace = workspace_path
        .canonicalize()
        .map_err(|error| format!("workspace cannot be resolved: {error}"))?;
    if workspace != workspace_path || !workspace.is_dir() {
        return Err("workspace identity is not canonical".into());
    }
    let artifacts = workspace.join("artifacts");
    let artifact = artifacts.join(&registration.artifact_path);
    let metadata = fs::symlink_metadata(&artifact)
        .map_err(|error| format!("Archive V2 artifact is unavailable: {error}"))?;
    let canonical_artifact = artifact
        .canonicalize()
        .map_err(|error| format!("Archive V2 artifact cannot be resolved: {error}"))?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() != size_bytes
        || !canonical_artifact.starts_with(&artifacts)
    {
        return Err("Archive V2 artifact identity is unsafe".into());
    }
    let bytes = fs::read(&canonical_artifact)
        .map_err(|error| format!("Archive V2 artifact cannot be read: {error}"))?;
    if u64::try_from(bytes.len()).ok() != Some(size_bytes)
        || format!("{:x}", Sha256::digest(&bytes)) != registration.content_hash
    {
        return Err("Archive V2 artifact content identity changed".into());
    }

    let database = canonical_workspace_store_path(&workspace).map_err(|error| error.to_string())?;
    refuse_live_journals(&database).map_err(|error| error.to_string())?;
    let mut connection = Connection::open_with_flags(
        &database,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| format!("WorkspaceStore cannot be opened for registration: {error}"))?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| format!("WorkspaceStore busy timeout failed: {error}"))?;
    validate_database(&connection).map_err(|error| error.to_string())?;
    validate_table_columns(&connection, "artifacts", &ARCHIVE_V2_REGISTRATION_COLUMNS)
        .map_err(|error| error.to_string())?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("WorkspaceStore registration transaction failed: {error}"))?;
    transaction
        .execute(
            "INSERT INTO artifacts (artifact_id, artifact_path, content_hash, format, size_bytes, ref_count) VALUES (?, ?, ?, 'n4a', ?, 1)",
            params![
                registration.artifact_id,
                registration.artifact_path,
                registration.content_hash,
                i64::try_from(size_bytes).map_err(|_| "Archive V2 artifact size is out of range")?
            ],
        )
        .map_err(|error| format!("WorkspaceStore registration failed: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("WorkspaceStore registration commit failed: {error}"))?;
    drop(connection);
    refuse_live_journals(&database).map_err(|error| error.to_string())
}

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

/// One owner-projected row used by the native Studio results-summary policy.
///
/// The fields are crate-visible so the policy module can consume this public
/// projection without issuing any Studio-owned SQL against Store internals.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct WorkspaceStoreResultsSummarySourceRow {
    pub chain_id: String,
    pub pipeline_id: String,
    pub run_id: String,
    pub pipeline_name: String,
    pub expanded_config: Option<Vec<Value>>,
    pub model_step_idx: i64,
    pub dataset_name: String,
    pub metric: Option<String>,
    pub task_type: Option<String>,
    pub model_name: Option<String>,
    pub model_class: String,
    pub preprocessings: String,
    pub cv_val_score: Option<f64>,
    pub cv_test_score: Option<f64>,
    pub cv_train_score: Option<f64>,
    pub cv_fold_count: i64,
    pub cv_scores: Value,
    pub final_test_score: Option<f64>,
    pub final_train_score: Option<f64>,
    pub final_scores: Value,
    pub final_agg_test_score: Option<f64>,
    pub final_agg_train_score: Option<f64>,
    pub final_agg_scores: Value,
    pub best_params: Option<Value>,
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
    InvalidRunId,
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
            Self::InvalidRunId => write!(
                formatter,
                "WorkspaceStore run id must be a canonical non-empty string"
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

pub(crate) fn read_run_summaries_from_connection(
    connection: &Connection,
    limit: u16,
    offset: u64,
) -> Result<Vec<WorkspaceStoreRunSummary>, WorkspaceStoreReadError> {
    validate_contract()?;
    if limit == 0 || limit > MAX_RUN_SUMMARIES {
        return Err(WorkspaceStoreReadError::LimitOutOfRange(limit));
    }
    let offset =
        i64::try_from(offset).map_err(|_| WorkspaceStoreReadError::OffsetOutOfRange(offset))?;
    validate_database(connection)?;
    query_run_summaries(connection, i64::from(limit), offset)
}

/// Return only Store-authorized `.n4a` artifact registrations.
///
/// This projection never scans the workspace and never opens an artifact. The
/// caller must resolve each relative path through a capability-safe workspace
/// handle and ask Core to validate/inspect Archive V2 before publication.
///
/// # Errors
///
/// Returns [`WorkspaceStoreReadError`] when the immutable Store v5 contract,
/// required artifact columns, query, or catalogue bound is violated.
pub fn read_archive_v2_registrations(
    workspace_path: &Path,
) -> Result<Vec<WorkspaceStoreArchiveV2Registration>, WorkspaceStoreReadError> {
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
    let result = read_archive_v2_registrations_from_connection(&connection);
    drop(connection);
    refuse_live_journals(&database)?;
    if file_stamp(&database)? != before {
        return Err(WorkspaceStoreReadError::ChangedDuringRead);
    }
    result
}

pub(crate) fn read_archive_v2_registrations_from_connection(
    connection: &Connection,
) -> Result<Vec<WorkspaceStoreArchiveV2Registration>, WorkspaceStoreReadError> {
    validate_contract()?;
    validate_database(connection)?;
    validate_table_columns(connection, "artifacts", &ARCHIVE_V2_REGISTRATION_COLUMNS)?;
    let mut statement = connection
        .prepare(ARCHIVE_V2_REGISTRATION_QUERY)
        .map_err(|error| WorkspaceStoreReadError::Query(error.to_string()))?;
    let rows = statement
        .query_map([], |row| {
            Ok(WorkspaceStoreArchiveV2Registration {
                artifact_id: row.get(0)?,
                artifact_path: row.get(1)?,
                content_hash: row.get(2)?,
            })
        })
        .map_err(|error| WorkspaceStoreReadError::Query(error.to_string()))?;
    let registrations = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| WorkspaceStoreReadError::Query(error.to_string()))?;
    if registrations.len() > MAX_ARCHIVE_V2_REGISTRATIONS {
        return Err(WorkspaceStoreReadError::Query(format!(
            "Archive V2 registration catalogue exceeds {MAX_ARCHIVE_V2_REGISTRATIONS} rows"
        )));
    }
    Ok(registrations)
}

/// Return the immutable Store-owned portion of one Studio run detail.
///
/// This is deliberately a projection reader, not an HTTP route implementation.
/// The owner contract requires additional Studio-owned dataset, runtime, rerun,
/// and result-repository composition before `/runs/{run_id}` may select the
/// native sidecar.
///
/// # Errors
///
/// Returns [`WorkspaceStoreReadError`] when the identifier, contract, immutable
/// snapshot, schema, required columns, or stored JSON values are incompatible.
pub fn read_run_detail_projection(
    workspace_path: &Path,
    run_id: &str,
) -> Result<Option<Value>, WorkspaceStoreReadError> {
    validate_contract()?;
    validate_run_detail_http_contract()?;
    if run_id.is_empty() || run_id.trim() != run_id || run_id.contains('\0') {
        return Err(WorkspaceStoreReadError::InvalidRunId);
    }
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
    validate_table_columns(&connection, "runs", &RUN_DETAIL_RUN_COLUMNS)?;
    validate_table_columns(&connection, "pipelines", &RUN_DETAIL_PIPELINE_COLUMNS)?;
    validate_table_columns(&connection, "chains", &RUN_DETAIL_CHAIN_COLUMNS)?;
    validate_table_columns(&connection, "logs", &RUN_DETAIL_LOG_COLUMNS)?;
    let result = query_run_detail_projection(&connection, run_id);
    drop(connection);
    refuse_live_journals(&database)?;
    if file_stamp(&database)? != before {
        return Err(WorkspaceStoreReadError::ChangedDuringRead);
    }
    result
}

pub(crate) fn read_run_detail_projection_from_connection(
    connection: &Connection,
    run_id: &str,
) -> Result<Option<Value>, WorkspaceStoreReadError> {
    validate_contract()?;
    validate_run_detail_http_contract()?;
    if run_id.is_empty() || run_id.trim() != run_id || run_id.contains('\0') {
        return Err(WorkspaceStoreReadError::InvalidRunId);
    }
    validate_database(connection)?;
    validate_table_columns(connection, "runs", &RUN_DETAIL_RUN_COLUMNS)?;
    validate_table_columns(connection, "pipelines", &RUN_DETAIL_PIPELINE_COLUMNS)?;
    validate_table_columns(connection, "chains", &RUN_DETAIL_CHAIN_COLUMNS)?;
    validate_table_columns(connection, "logs", &RUN_DETAIL_LOG_COLUMNS)?;
    query_run_detail_projection(connection, run_id)
}

/// Verify that a linked workspace can serve the exact Studio run-detail v1
/// projection without reading a particular run.
///
/// This is the authoritative route-preselection probe. It applies the same
/// contract, immutable snapshot, schema, and required-column checks as
/// [`read_run_detail_projection`]. A future selected request must repeat those
/// checks, so a workspace change between preselection and the read fails
/// closed. The current native target route remains unregistered.
///
/// # Errors
///
/// Returns [`WorkspaceStoreReadError`] when the workspace is not an exact,
/// immutable Store-v5 run-detail source.
pub fn preflight_run_detail_projection(
    workspace_path: &Path,
) -> Result<(), WorkspaceStoreReadError> {
    validate_contract()?;
    validate_run_detail_http_contract()?;
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
    validate_table_columns(&connection, "runs", &RUN_DETAIL_RUN_COLUMNS)?;
    validate_table_columns(&connection, "pipelines", &RUN_DETAIL_PIPELINE_COLUMNS)?;
    validate_table_columns(&connection, "chains", &RUN_DETAIL_CHAIN_COLUMNS)?;
    validate_table_columns(&connection, "logs", &RUN_DETAIL_LOG_COLUMNS)?;
    drop(connection);
    refuse_live_journals(&database)?;
    if file_stamp(&database)? != before {
        return Err(WorkspaceStoreReadError::ChangedDuringRead);
    }
    Ok(())
}

pub(crate) fn preflight_run_detail_projection_from_connection(
    connection: &Connection,
) -> Result<(), WorkspaceStoreReadError> {
    validate_contract()?;
    validate_run_detail_http_contract()?;
    validate_database(connection)?;
    validate_table_columns(connection, "runs", &RUN_DETAIL_RUN_COLUMNS)?;
    validate_table_columns(connection, "pipelines", &RUN_DETAIL_PIPELINE_COLUMNS)?;
    validate_table_columns(connection, "chains", &RUN_DETAIL_CHAIN_COLUMNS)?;
    validate_table_columns(connection, "logs", &RUN_DETAIL_LOG_COLUMNS)?;
    Ok(())
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

pub(crate) fn read_pipeline_summaries_from_connection(
    connection: &Connection,
    limit: u16,
    offset: u64,
) -> Result<WorkspaceStorePipelineSummaryPage, WorkspaceStoreReadError> {
    validate_contract()?;
    if limit == 0 || limit > MAX_PIPELINE_SUMMARIES {
        return Err(WorkspaceStoreReadError::LimitOutOfRange(limit));
    }
    let offset =
        i64::try_from(offset).map_err(|_| WorkspaceStoreReadError::OffsetOutOfRange(offset))?;
    validate_database(connection)?;
    query_pipeline_summaries(connection, i64::from(limit), offset)
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

/// Read every results-summary source row from one immutable Store v5 snapshot.
///
/// The owner contract fixes a 500-row page primitive, but all pages are read
/// through the same `SQLite` connection before the file stamp is rechecked. This
/// prevents a Studio policy layer from combining independently observed pages.
///
/// # Errors
///
/// Returns [`WorkspaceStoreReadError`] when the contract, immutable snapshot,
/// schema, required projection columns, or any source row is incompatible.
pub(crate) fn read_results_summary_source(
    workspace_path: &Path,
) -> Result<Vec<WorkspaceStoreResultsSummarySourceRow>, WorkspaceStoreReadError> {
    let mut results = Vec::new();
    visit_results_summary_source(workspace_path, |row| results.push(row))?;
    Ok(results)
}

/// Consume the unchanged owner projection one bounded page at a time. Compact
/// views need not retain expanded pipeline configurations for every chain.
pub(crate) fn visit_results_summary_source(
    workspace_path: &Path,
    consume: impl FnMut(WorkspaceStoreResultsSummarySourceRow),
) -> Result<(), WorkspaceStoreReadError> {
    validate_contract()?;
    validate_results_summary_contract()?;
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
    validate_table_columns(&connection, "chains", &RESULTS_SUMMARY_CHAIN_COLUMNS)?;
    validate_table_columns(&connection, "pipelines", &RESULTS_SUMMARY_PIPELINE_COLUMNS)?;
    validate_table_columns(&connection, "predictions", &PREDICTION_RANKING_COLUMNS)?;
    let result = visit_results_summary_source_from_connection(&connection, consume);
    drop(connection);
    refuse_live_journals(&database)?;
    if file_stamp(&database)? != before {
        return Err(WorkspaceStoreReadError::ChangedDuringRead);
    }
    result
}

pub(crate) fn read_results_summary_source_from_connection(
    connection: &Connection,
) -> Result<Vec<WorkspaceStoreResultsSummarySourceRow>, WorkspaceStoreReadError> {
    let mut results = Vec::new();
    visit_results_summary_source_from_connection(connection, |row| results.push(row))?;
    Ok(results)
}

pub(crate) fn visit_results_summary_source_from_connection(
    connection: &Connection,
    consume: impl FnMut(WorkspaceStoreResultsSummarySourceRow),
) -> Result<(), WorkspaceStoreReadError> {
    validate_contract()?;
    validate_results_summary_contract()?;
    validate_database(connection)?;
    validate_table_columns(connection, "chains", &RESULTS_SUMMARY_CHAIN_COLUMNS)?;
    validate_table_columns(connection, "pipelines", &RESULTS_SUMMARY_PIPELINE_COLUMNS)?;
    validate_table_columns(connection, "predictions", &PREDICTION_RANKING_COLUMNS)?;
    visit_results_summary_source_rows(connection, consume)
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
    validate_run_discovery_contract(&contract)?;
    validate_run_detail_contract(&contract)?;
    validate_pipeline_contract(&contract, &expected_parameters)?;
    validate_ranked_chain_contract(&contract)
}

fn validate_run_discovery_contract(contract: &Value) -> Result<(), WorkspaceStoreReadError> {
    let expected = json!({
        "source_projection": "studio_run_summary",
        "http": {
            "method": "GET",
            "path_suffix": "/runs",
            "query_mode": "explicit_allowlist",
            "query_absent_allowed": true,
            "unknown_parameters": "reject",
            "duplicate_parameters": "reject",
            "parameter_order": "any",
            "parameters": [
                {
                    "name": "source",
                    "type": "string",
                    "enum": ["unified", "manifests", "parquet"],
                    "default": "unified",
                },
                {
                    "name": "refresh",
                    "type": "string",
                    "enum": ["true", "false"],
                    "default": "false",
                },
            ],
        },
        "store_semantics": {
            "source": "accepted_for_store_parity_but_does_not_switch_away_from_workspace_store",
            "refresh": "every_native_request_is_an_uncached_immutable_read",
            "limit": 500,
            "offset": 0,
            "ordering": "studio_run_summary",
            "fallback_after_native_selection": "none",
        },
        "response": {
            "workspace_id": "requested_workspace_id",
            "runs": "studio_run_summary_rows",
            "total": "returned_row_count",
        },
        "incompatible_store_http_status": 409,
    });
    if contract.pointer("/projections/studio_run_discovery_query_v1") != Some(&expected) {
        return Err(WorkspaceStoreReadError::Contract(
            "run-discovery query policy differs from v1".into(),
        ));
    }
    Ok(())
}

fn validate_run_detail_contract(contract: &Value) -> Result<(), WorkspaceStoreReadError> {
    let projection = contract
        .pointer("/projections/studio_run_detail_v1")
        .ok_or_else(|| {
            WorkspaceStoreReadError::Contract("studio_run_detail_v1 is missing".into())
        })?;
    let expected_queries = json!({
        "run": RUN_DETAIL_QUERY,
        "pipelines": RUN_DETAIL_PIPELINES_QUERY,
        "has_refit": RUN_DETAIL_HAS_REFIT_QUERY,
        "log_summary": RUN_DETAIL_LOG_SUMMARY_QUERY,
    });
    let expected_http = json!({
        "method": "GET",
        "path_suffix": "/runs/{run_id}",
        "query_string": "absent",
        "run_id": {
            "type": "canonical_nonempty_string",
            "leading_or_trailing_whitespace": "reject",
            "embedded_nul": "reject",
        },
    });
    let expected_ordering = json!({
        "pipelines": "created_at_desc_then_pipeline_id_asc",
        "log_summary": "pipeline_created_at_asc_then_pipeline_id_asc",
    });
    let expected_json_policy = json!({
        "parse_fields": [
            "runs.config",
            "runs.datasets",
            "runs.summary",
            "pipelines.expanded_config",
            "pipelines.original_template",
            "pipelines.generator_choices",
        ],
        "malformed_json": "reject",
        "wrong_run_json_shape": "reject",
        "non_finite_numbers": "replace_with_null_recursively",
        "timestamps": "iso8601",
        "run_config_null_entries": "drop_top_level_before_stored_config_merge",
    });
    let expected_assembly = json!({
        "run_config": "start_with_computed_has_refit_then_overlay_non_null_stored_config_entries",
        "has_refit": "true_if_any_run_chain_has_non_null_final_test_score_or_final_train_score",
        "pipelines": "merge_same_pipeline_id_log_summary_fields_into_each_pipeline",
        "log_summary": "also_return_as_top_level_array",
        "not_found": "null_owner_result_for_http_404",
    });
    if projection.get("source_tables") != Some(&json!(["runs", "pipelines", "chains", "logs"]))
        || projection.get("owner_method").and_then(Value::as_str)
            != Some("WorkspaceStore.get_studio_run_detail_v1")
        || projection.get("http") != Some(&expected_http)
        || projection.get("queries") != Some(&expected_queries)
        || projection.get("ordering") != Some(&expected_ordering)
        || projection.get("json_policy") != Some(&expected_json_policy)
        || projection.get("assembly") != Some(&expected_assembly)
    {
        return Err(WorkspaceStoreReadError::Contract(
            "run-detail source, query, fields policy, or assembly differs from v1".into(),
        ));
    }
    validate_run_detail_cutover_policy(projection)?;
    let fields = projection
        .get("fields")
        .ok_or_else(|| WorkspaceStoreReadError::Contract("run-detail fields are missing".into()))?;
    if fields
        .get("run")
        .and_then(Value::as_array)
        .is_none_or(|rows| rows.len() != RUN_DETAIL_RUN_COLUMNS.len())
        || fields
            .get("pipeline")
            .and_then(Value::as_array)
            .is_none_or(|rows| rows.len() != RUN_DETAIL_PIPELINE_COLUMNS.len())
        || fields
            .get("log_summary")
            .and_then(Value::as_array)
            .is_none_or(|rows| rows.len() != 7)
    {
        return Err(WorkspaceStoreReadError::Contract(
            "run-detail field cardinality differs from v1".into(),
        ));
    }
    Ok(())
}

fn validate_run_detail_cutover_policy(projection: &Value) -> Result<(), WorkspaceStoreReadError> {
    let expected_preconditions = json!({
        "open_mode": "sqlite_immutable_read_only",
        "pragma_user_version": 5,
        "active_sidecars": ["store.sqlite-wal", "store.sqlite-shm", "store.sqlite-journal"],
        "active_sidecar_policy": "reject_if_any_exists",
        "database_change_during_read": "reject",
        "writes_or_cache": "forbidden",
    });
    let expected_composition = json!({
        "derived_fields": [
            "config.cv_strategy",
            "config.splitter_class",
            "config.cv_folds",
            "config.random_state",
            "config.shuffle",
            "pipeline.splitter_class",
            "runtime_engine_fields_and_pipeline_propagation",
        ],
        "external_fields": [
            "datasets.name_and_dataset_name_normalization",
            "datasets.linked_dataset_id",
            "rerun_ready",
            "unresolved_dataset_names",
            "results",
            "results_count",
        ],
        "external_sources": [
            "studio_linked_dataset_configuration",
            "studio_results_repository_and_filesystem_scanner",
        ],
        "route_selection": "forbidden_until_all_required_composition_has_exact_oracle_parity",
    });
    if projection.get("native_read_preconditions") != Some(&expected_preconditions)
        || projection.get("cutover_scope").and_then(Value::as_str)
            != Some("store_owned_source_projection_not_complete_http_response")
        || projection.get("studio_composition_required") != Some(&expected_composition)
        || projection
            .get("legacy_filesystem_manifest_branch")
            .and_then(Value::as_str)
            != Some("not_covered")
        || projection
            .get("incompatible_store_http_status")
            .and_then(Value::as_i64)
            != Some(409)
        || projection
            .get("fallback_after_native_selection")
            .and_then(Value::as_str)
            != Some("none")
    {
        return Err(WorkspaceStoreReadError::Contract(
            "run-detail projection scope or fail-closed cutover policy differs from v1".into(),
        ));
    }
    Ok(())
}

pub(crate) fn validate_run_detail_http_contract() -> Result<(), WorkspaceStoreReadError> {
    let contract: Value = serde_json::from_str(STUDIO_RUN_DETAIL_HTTP_CONTRACT)
        .map_err(|error| WorkspaceStoreReadError::Contract(error.to_string()))?;
    validate_run_detail_http_contract_value(&contract)
}

fn validate_run_detail_http_contract_value(
    contract: &Value,
) -> Result<(), WorkspaceStoreReadError> {
    validate_run_detail_http_owner_inputs(contract)?;
    validate_run_detail_http_cutover(contract)
}

fn validate_run_detail_http_owner_inputs(contract: &Value) -> Result<(), WorkspaceStoreReadError> {
    let expected_request = json!({
        "method": "GET",
        "path_suffix": "/runs/{run_id}",
        "query_string": "absent",
    });
    let expected_read_dependency = json!({
        "schema_id": CONTRACT_SCHEMA_ID,
        "schema_version": CONTRACT_SCHEMA_VERSION,
        "projection": "studio_run_detail_v1",
    });
    let expected_splitter_dependency = expected_run_detail_splitter_dependency();
    let expected_runtime_dependency = expected_run_detail_runtime_dependency();
    let expected_owner_oracle = expected_run_detail_owner_oracle();
    let expected_owner_fields = json!([
        "source_branch",
        "run_detail",
        "pipeline_splitters",
        "pipeline_runtime",
        "runtime_column_provenance",
        "results",
        "results_count",
    ]);
    let expected_pipeline_splitters = json!({
        "ordering": "run_detail.pipelines_order",
        "entry_fields": ["pipeline_id", "splitter"],
        "splitter": "splitter_config_output_or_null",
        "materialization": "derived_by_owner_oracle_before_consumer_boundary",
        "materialization_time": "immutable_owner_read",
        "consumer_reimplementation": "forbidden",
        "consumer_expanded_config_access": "forbidden",
    });
    let (expected_pipeline_runtime, expected_runtime_provenance) =
        expected_run_detail_runtime_outputs();
    let expected_results_mapping = json!({
        "id": "pipeline.pipeline_id",
        "run_id": "pipeline.run_id",
        "dataset": "pipeline.dataset_name",
        "pipeline_config": "pipeline.name",
        "pipeline_config_id": "pipeline.pipeline_id",
        "created_at": "pipeline.created_at_or_empty_string",
        "best_score": "pipeline.best_val",
        "best_test_score": "pipeline.best_test",
        "metric": "pipeline.metric",
        "status": "pipeline.status",
        "duration_ms": "pipeline.duration_ms",
        "format": "store",
    });

    if contract.get("schema_id").and_then(Value::as_str)
        != Some("nirs4all.studio-run-detail-http.v1")
        || contract.get("schema_version").and_then(Value::as_i64) != Some(1)
        || contract
            .get("workspace_store_schema_version")
            .and_then(Value::as_i64)
            != Some(WORKSPACE_STORE_SCHEMA_VERSION)
        || contract.get("request") != Some(&expected_request)
        || contract.pointer("/dependencies/workspace_store_read") != Some(&expected_read_dependency)
        || contract.pointer("/dependencies/splitter_config") != Some(&expected_splitter_dependency)
        || contract.pointer("/dependencies/pipeline_runtime") != Some(&expected_runtime_dependency)
        || contract.get("owner_oracle") != Some(&expected_owner_oracle)
        || contract.pointer("/owner_output/fields") != Some(&expected_owner_fields)
        || contract.pointer("/owner_output/pipeline_splitters")
            != Some(&expected_pipeline_splitters)
        || contract.pointer("/owner_output/pipeline_runtime") != Some(&expected_pipeline_runtime)
        || contract.pointer("/owner_output/runtime_column_provenance")
            != Some(&expected_runtime_provenance)
        || contract.pointer("/owner_output/results/mapping") != Some(&expected_results_mapping)
    {
        return Err(WorkspaceStoreReadError::Contract(
            "run-detail HTTP owner inputs differ from v1".into(),
        ));
    }
    Ok(())
}

fn expected_run_detail_splitter_dependency() -> Value {
    json!({
        "callable": "nirs4all.pipeline.analysis.splitter_config.extract_splitter_config",
        "input": "pipeline.expanded_config",
        "write_boundary": "WorkspaceStore.begin_pipeline",
        "persisted_source": "pipelines.expanded_config",
        "store_v5_splitter_column": "absent_by_design",
        "historical_compatibility": "derive_or_null_from_existing_expanded_config",
        "schema_migration": "none_required_for_owner_projection",
        "consumer_expanded_config_access": "forbidden",
        "selection": "first_recognized_splitter_step",
        "output_fields": [
            "splitter_class",
            "reference",
            "n_splits",
            "shuffle",
            "random_state",
            "test_size",
            "group_by",
        ],
    })
}

fn expected_run_detail_owner_oracle() -> Value {
    json!({
        "callable": "nirs4all.pipeline.storage.studio_run_detail_http_inputs_v1",
        "signature": "(workspace_path: str | Path, run_id: str) -> dict[str, Any] | None",
        "inputs": ["workspace_path", "run_id"],
        "native_abi": "none_python_callable_only",
        "bounded_cpython_subprocess": "supported",
        "framework_requirements": {
            "fastapi": "none",
            "pipeline_runner_construction": "forbidden",
        },
        "scope": "store_v5_owner_inputs_only",
        "open_mode": "composed_immutable_reads_guarded_by_before_after_database_stamp",
        "writes_or_cache": "forbidden",
        "not_found": "null",
    })
}

fn expected_run_detail_runtime_dependency() -> Value {
    json!({
        "owner_method": "WorkspaceStore.get_studio_run_detail_runtime_v1",
        "source_table": "pipelines",
        "required_columns": ["pipeline_id", "run_id", "created_at"],
        "optional_columns": [
            "engine",
            "engine_requested",
            "engine_diagnostics",
            "runtime_manifest",
            "fallback_policy",
            "native_result_refs",
        ],
        "optional_column_selection": "fixed_allowlist_present_column_or_sql_null_alias",
        "absent_optional_column": "null_with_absent_in_store_v5_provenance",
        "present_text_columns": ["engine", "engine_requested"],
        "present_json_shapes": {
            "engine_diagnostics": "array_or_null",
            "runtime_manifest": "object_or_null",
            "fallback_policy": "object_or_null",
            "native_result_refs": "array_or_null",
        },
        "malformed_or_wrong_shape": "reject",
        "non_finite_numbers": "replace_with_null_recursively",
        "ordering": "pipeline_created_at_desc_then_pipeline_id_asc",
    })
}

fn expected_run_detail_runtime_outputs() -> (Value, Value) {
    let fields = json!([
        "engine",
        "engine_requested",
        "engine_diagnostics",
        "runtime_manifest",
        "fallback_policy",
        "native_result_refs",
    ]);
    (
        json!({
            "ordering": "run_detail.pipelines_order",
            "entry_fields": [
                "pipeline_id",
                "engine",
                "engine_requested",
                "engine_diagnostics",
                "runtime_manifest",
                "fallback_policy",
                "native_result_refs",
            ],
            "source": "pipeline_runtime_dependency",
        }),
        json!({
            "fields": fields,
            "values": ["stored_column", "absent_in_store_v5"],
        }),
    )
}

fn validate_run_detail_http_cutover(contract: &Value) -> Result<(), WorkspaceStoreReadError> {
    let expected_dataset_composition = json!({
        "owner": "studio_linked_dataset_configuration",
        "required_input": "ordered_linked_dataset_records_with_id_name_path",
        "required_outputs": [
            "datasets.name_and_dataset_name_normalization",
            "datasets.linked_dataset_id",
            "unresolved_dataset_names",
        ],
        "policy_contract": "not_yet_published",
    });
    let expected_runtime_composition = json!({
        "owner": "studio_http_adapter",
        "required_input": "owner_output.pipeline_runtime_and_runtime_column_provenance",
        "required_outputs": [
            "engine",
            "engine_requested",
            "engine_diagnostics",
            "runtime_source",
            "runtime_manifest",
            "fallback_policy",
            "allow_fallback",
            "native_result_refs",
            "pipeline_runtime_propagation",
        ],
        "policy_contract": "not_yet_published",
    });
    let expected_legacy_branch = json!({
        "owner": "workspace_manifest_scanner",
        "status": "not_covered",
        "required_contract": "studio_workspace_manifest_run_detail_v1",
        "must_not_be_reconstructed_from_store_v5": true,
    });
    let expected_cutover = json!({
        "route_selection": "forbidden",
        "blocked_on": [
            "studio_dataset_link_composition_v1",
            "studio_runtime_field_composition_v1",
            "studio_ui_splitter_strategy_vocabulary_v1",
            "studio_workspace_manifest_run_detail_v1_or_preselection_proof",
        ],
        "store_owner_inputs_complete": true,
        "complete_http_response_proven": false,
        "legacy_manifest_branch_proven": false,
        "fallback_after_native_selection": "none",
        "incompatible_store_http_status": 409,
    });

    if contract.pointer("/http_composition/store_branch/dataset_composition")
        != Some(&expected_dataset_composition)
        || contract.pointer("/http_composition/store_branch/runtime_composition")
            != Some(&expected_runtime_composition)
        || contract.pointer("/http_composition/legacy_manifest_branch")
            != Some(&expected_legacy_branch)
        || contract.get("cutover") != Some(&expected_cutover)
    {
        return Err(WorkspaceStoreReadError::Contract(
            "run-detail HTTP ownership or fail-closed cutover differs from v1".into(),
        ));
    }
    Ok(())
}

fn validate_results_summary_contract() -> Result<(), WorkspaceStoreReadError> {
    let contract: Value = serde_json::from_str(WORKSPACE_STORE_RESULTS_SUMMARY_CONTRACT)
        .map_err(|error| WorkspaceStoreReadError::Contract(error.to_string()))?;
    let expected_request = json!({
        "surface": "studio_results_summary",
        "method": "GET",
        "path_suffix": "/results/summary",
        "query_string": "absent",
        "top_n": 5,
        "supported_top_n": [5],
    });
    let expected_dependency = json!({
        "schema_id": "nirs4all.workspace-store-read.v1",
        "schema_version": 1,
        "projection": "studio_chain_ranked_v1",
    });
    let source = contract
        .get("source_projection")
        .ok_or_else(|| WorkspaceStoreReadError::Contract("source_projection is missing".into()))?;
    let expected_parameters = [
        json!({"name": "limit", "type": "integer", "minimum": 1, "maximum": 500, "default": 500}),
        json!({"name": "offset", "type": "integer", "minimum": 0, "default": 0}),
    ];
    if contract.get("schema_id").and_then(Value::as_str)
        != Some("nirs4all.workspace-store-results-summary.v1")
        || contract.get("schema_version").and_then(Value::as_i64) != Some(1)
        || contract
            .get("workspace_store_schema_version")
            .and_then(Value::as_i64)
            != Some(WORKSPACE_STORE_SCHEMA_VERSION)
        || contract.pointer("/dependencies/workspace_store_read") != Some(&expected_dependency)
        || contract.get("request") != Some(&expected_request)
        || source.get("source_tables") != Some(&json!(["chains", "pipelines", "predictions"]))
        || source.get("eligibility").and_then(Value::as_str)
            != Some("at_least_one_prediction_for_chain")
        || source.get("page_query").and_then(Value::as_str) != Some(RESULTS_SUMMARY_PAGE_QUERY)
        || source.get("count_query").and_then(Value::as_str) != Some(RESULTS_SUMMARY_COUNT_QUERY)
        || source
            .get("parameters")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            != Some(expected_parameters.as_slice())
        || source.get("snapshot").and_then(Value::as_str)
            != Some("all_pages_must_be_read_from_one_immutable_database_snapshot")
    {
        return Err(WorkspaceStoreReadError::Contract(
            "results-summary dispatch, dependency, source query, or snapshot differs from v1"
                .into(),
        ));
    }

    validate_results_summary_fields(source)?;
    validate_results_summary_policy(&contract)
}

fn validate_results_summary_fields(source: &Value) -> Result<(), WorkspaceStoreReadError> {
    let expected_fields = [
        ("chain_id", "chain_id"),
        ("pipeline_id", "pipeline_id"),
        ("run_id", "run_id"),
        ("pipeline_name", "name"),
        ("expanded_config", "expanded_config"),
        ("model_step_idx", "model_step_idx"),
        ("dataset_name", "dataset_name"),
        ("metric", "metric"),
        ("task_type", "task_type"),
        ("model_name", "model_name"),
        ("model_class", "model_class"),
        ("preprocessings", "preprocessings"),
        ("cv_val_score", "cv_val_score"),
        ("cv_test_score", "cv_test_score"),
        ("cv_train_score", "cv_train_score"),
        ("cv_fold_count", "cv_fold_count"),
        ("cv_scores", "cv_scores"),
        ("final_test_score", "final_test_score"),
        ("final_train_score", "final_train_score"),
        ("final_scores", "final_scores"),
        ("final_agg_test_score", "final_agg_test_score"),
        ("final_agg_train_score", "final_agg_train_score"),
        ("final_agg_scores", "final_agg_scores"),
        ("best_params", "best_params"),
    ];
    let fields = source
        .get("fields")
        .and_then(Value::as_array)
        .ok_or_else(|| WorkspaceStoreReadError::Contract("source fields are missing".into()))?;
    if fields.len() != expected_fields.len()
        || !fields
            .iter()
            .zip(expected_fields)
            .all(|(field, (name, column))| {
                field.get("name").and_then(Value::as_str) == Some(name)
                    && field.get("column").and_then(Value::as_str) == Some(column)
            })
    {
        return Err(WorkspaceStoreReadError::Contract(
            "results-summary source fields differ from v1".into(),
        ));
    }

    Ok(())
}

fn validate_results_summary_policy(contract: &Value) -> Result<(), WorkspaceStoreReadError> {
    let expected_normalization = json!({
        "dataset_grouping": "ignore_empty_dataset_name_then_group_exact_string_and_emit_groups_in_lexicographic_order",
        "source_order": "chain_id_ascending",
        "metric": "first_truthy_metric_in_source_order_or_r2",
        "task_type": "first_truthy_task_type_in_source_order_or_null",
        "finite_score": "finite_number_or_null",
        "json_object": "parse_json_string_then_require_object_else_empty_object",
        "optional_json_object": "parse_json_string_then_require_nonempty_object_else_null",
    });
    let expected_synthetic_refit = json!({
        "mark_refit_only_before_synthesis": true,
        "meaningful_final": "final_test_score_is_not_null_or_final_train_score_is_not_null_or_final_scores_is_nonempty_json_object",
        "has_cv_payload": "cv_val_score_is_not_null_or_cv_test_score_is_not_null_or_cv_train_score_is_not_null_or_cv_fold_count_is_truthy_or_cv_scores_is_nonempty_json_object",
        "refit_only_marker": "meaningful_final_and_not_has_cv_payload",
        "when": "not_meaningful_final_and_has_cv_payload",
        "assignments": {
            "final_test_score": "finite_cv_test_score_or_null",
            "final_train_score": "finite_cv_train_score_or_null",
            "final_scores": "nonempty_cv_scores_else_partition_metric_object_from_finite_cv_val_test_train_scores",
            "synthetic_refit": true,
        },
        "otherwise": "preserve_final_fields_and_booleanize_existing_synthetic_refit",
    });
    let expected_selection = json!({
        "cv_candidates": "cv_fold_count_greater_than_zero",
        "refit_only_candidates": "cv_fold_count_is_zero_and_finite_final_test_score_is_not_null",
        "best_final_candidate": "finite_final_test_score_is_not_null",
        "best_final_comparison": "strict_summary_comparison_so_first_source_row_wins_ties",
        "top_cv": {
            "primary": "query_workspace_store_read_studio_chain_ranked_v1_with_dataset_metric_top_n_5_and_contract_metric_direction_then_merge_by_chain_id_with_source_row",
            "accept": "cv_fold_count_is_truthy_or_cv_val_score_is_not_null",
            "deduplicate": "chain_key",
            "fallback_when_fewer_than_top_n": "stable_sort_cv_candidates_by_cv_val_score_using_summary_comparison_with_missing_score_worst_then_append_unseen_until_top_n",
        },
        "append_order": ["top_cv", "all_refit_only_in_source_order", "best_final_if_not_already_selected"],
        "final_deduplication": "nonempty_chain_id_first_occurrence_wins",
        "omit_dataset_when": "selection_is_empty",
    });
    if contract.get("normalization") != Some(&expected_normalization)
        || contract.get("synthetic_refit") != Some(&expected_synthetic_refit)
        || contract.get("selection") != Some(&expected_selection)
        || contract.pointer("/extensions/full_train_only_v1")
            != Some(&json!({
                "candidate": "meaningful_final_and_not_has_cv_payload_before_synthesis",
                "append_to": "refit_only_candidates",
                "preserve_scores": true,
                "synthetic_refit": false,
                "compatibility": "base_selection_and_existing_cv_test_results_unchanged",
            }))
        || contract
            .pointer("/metric_direction/normalization")
            .and_then(Value::as_str)
            != Some("trim_then_lowercase")
        || contract.pointer("/metric_direction/lower_is_better")
            != Some(&json!([
                "rmse", "rmsecv", "rmsep", "mae", "mse", "mape", "bias", "sep"
            ]))
        || contract
            .pointer("/metric_direction/all_other_metrics")
            .and_then(Value::as_str)
            != Some("higher_is_better")
        || contract.pointer("/metric_direction/applies_to")
            != Some(&json!([
                "top_cv_ranking",
                "top_cv_fallback",
                "best_final_comparison"
            ]))
        || contract
            .pointer("/normalization/source_order")
            .and_then(Value::as_str)
            != Some("chain_id_ascending")
        || contract.pointer("/selection/append_order")
            != Some(&json!([
                "top_cv",
                "all_refit_only_in_source_order",
                "best_final_if_not_already_selected"
            ]))
        || contract
            .pointer("/selection/final_deduplication")
            .and_then(Value::as_str)
            != Some("nonempty_chain_id_first_occurrence_wins")
        || contract.pointer("/serialization/schema_v5_constants")
            != Some(&json!({"cv_source_chain_id": null}))
        || contract.pointer("/serialization/conditional_field")
            != Some(
                &json!({"is_refit_only": "include_with_true_value_only_when_selected_as_refit_only"}),
            )
    {
        return Err(WorkspaceStoreReadError::Contract(
            "results-summary direction, selection, or serialization policy differs from v1".into(),
        ));
    }
    Ok(())
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

fn query_run_detail_projection(
    connection: &Connection,
    run_id: &str,
) -> Result<Option<Value>, WorkspaceStoreReadError> {
    let Some(mut run) = connection
        .query_row(RUN_DETAIL_QUERY, [run_id], row_to_run_detail)
        .optional()
        .map_err(|error| WorkspaceStoreReadError::Query(error.to_string()))?
    else {
        return Ok(None);
    };
    let run_object = run.as_object_mut().ok_or_else(|| {
        WorkspaceStoreReadError::Query("run-detail row did not normalize to an object".into())
    })?;

    let has_refit = connection
        .query_row(RUN_DETAIL_HAS_REFIT_QUERY, [run_id], |row| {
            row.get::<_, i64>(0)
        })
        .map_err(|error| WorkspaceStoreReadError::Query(error.to_string()))?
        != 0;
    let stored_config = run_object
        .remove("config")
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    let mut config = serde_json::Map::new();
    config.insert("has_refit".into(), has_refit.into());
    config.extend(
        stored_config
            .into_iter()
            .filter(|(_, value)| !value.is_null()),
    );
    run_object.insert("config".into(), Value::Object(config));

    let log_summary = query_run_detail_log_summary(connection, run_id)?;
    let log_by_pipeline = log_summary
        .iter()
        .filter_map(|entry| {
            Some((
                entry.get("pipeline_id")?.as_str()?.to_owned(),
                entry.as_object()?.clone(),
            ))
        })
        .collect::<std::collections::BTreeMap<_, _>>();
    let mut statement = connection
        .prepare(RUN_DETAIL_PIPELINES_QUERY)
        .map_err(|error| WorkspaceStoreReadError::Query(error.to_string()))?;
    let pipeline_rows = statement
        .query_map([run_id], row_to_run_detail_pipeline)
        .map_err(|error| WorkspaceStoreReadError::Query(error.to_string()))?;
    let mut pipelines = pipeline_rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| WorkspaceStoreReadError::Query(error.to_string()))?;
    for pipeline in &mut pipelines {
        let Some(pipeline_object) = pipeline.as_object_mut() else {
            continue;
        };
        let Some(pipeline_id) = pipeline_object
            .get("pipeline_id")
            .and_then(Value::as_str)
            .map(str::to_owned)
        else {
            continue;
        };
        if let Some(log) = log_by_pipeline.get(&pipeline_id) {
            pipeline_object.extend(log.clone());
        }
    }
    run_object.insert("pipelines".into(), pipelines.into());
    run_object.insert("log_summary".into(), log_summary.into());
    Ok(Some(run))
}

fn query_run_detail_log_summary(
    connection: &Connection,
    run_id: &str,
) -> Result<Vec<Value>, WorkspaceStoreReadError> {
    let mut statement = connection
        .prepare(RUN_DETAIL_LOG_SUMMARY_QUERY)
        .map_err(|error| WorkspaceStoreReadError::Query(error.to_string()))?;
    let rows = statement
        .query_map([run_id], |row| {
            Ok(json!({
                "pipeline_id": required_text(row, 0, "pipeline_id")?,
                "pipeline_name": required_text(row, 1, "pipeline_name")?,
                "pipeline_status": optional_text(row, 2)?,
                "log_count": row.get::<_, i64>(3)?,
                "total_duration_ms": row.get::<_, i64>(4)?,
                "warning_count": row.get::<_, i64>(5)?,
                "error_count": row.get::<_, i64>(6)?,
            }))
        })
        .map_err(|error| WorkspaceStoreReadError::Query(error.to_string()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| WorkspaceStoreReadError::Query(error.to_string()))?;
    Ok(rows)
}

fn row_to_run_detail(row: &Row<'_>) -> rusqlite::Result<Value> {
    let config = strict_json_object_or_default(optional_text(row, 2)?, 2, "runs.config")?;
    let datasets = strict_json_array_or_default(optional_text(row, 3)?, 3, "runs.datasets")?;
    let summary = strict_json_object_or_default(optional_text(row, 7)?, 7, "runs.summary")?;
    Ok(json!({
        "run_id": required_text(row, 0, "run_id")?,
        "name": required_text(row, 1, "name")?,
        "config": config,
        "datasets": datasets,
        "status": optional_text(row, 4)?,
        "created_at": optional_text(row, 5)?,
        "completed_at": optional_text(row, 6)?,
        "summary": summary,
        "error": optional_text(row, 8)?,
        "project_id": optional_text(row, 9)?,
    }))
}

fn row_to_run_detail_pipeline(row: &Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
        "pipeline_id": required_text(row, 0, "pipeline_id")?,
        "run_id": required_text(row, 1, "run_id")?,
        "name": required_text(row, 2, "name")?,
        "expanded_config": strict_json(optional_text(row, 3)?, 3, "pipelines.expanded_config")?,
        "original_template": strict_json(optional_text(row, 4)?, 4, "pipelines.original_template")?,
        "generator_choices": strict_json(optional_text(row, 5)?, 5, "pipelines.generator_choices")?,
        "dataset_name": required_text(row, 6, "dataset_name")?,
        "dataset_hash": optional_text(row, 7)?,
        "status": optional_text(row, 8)?,
        "created_at": optional_text(row, 9)?,
        "completed_at": optional_text(row, 10)?,
        "best_val": optional_finite_or_null_f64(row, 11)?,
        "best_test": optional_finite_or_null_f64(row, 12)?,
        "metric": optional_text(row, 13)?,
        "duration_ms": row.get::<_, Option<i64>>(14)?,
        "error": optional_text(row, 15)?,
    }))
}

fn strict_json(
    raw: Option<String>,
    index: usize,
    field: &'static str,
) -> rusqlite::Result<Option<Value>> {
    raw.map(|value| {
        parse_python_json(&value).ok_or_else(|| {
            rusqlite::Error::FromSqlConversionFailure(
                index,
                rusqlite::types::Type::Text,
                format!("`{field}` contains malformed JSON").into(),
            )
        })
    })
    .transpose()
}

fn strict_json_object_or_default(
    raw: Option<String>,
    index: usize,
    field: &'static str,
) -> rusqlite::Result<Value> {
    match strict_json(raw, index, field)? {
        None => Ok(json!({})),
        Some(value) if value.is_object() => Ok(value),
        Some(_) => Err(rusqlite::Error::FromSqlConversionFailure(
            index,
            rusqlite::types::Type::Text,
            format!("`{field}` must decode to an object or null").into(),
        )),
    }
}

fn strict_json_array_or_default(
    raw: Option<String>,
    index: usize,
    field: &'static str,
) -> rusqlite::Result<Value> {
    match strict_json(raw, index, field)? {
        None => Ok(json!([])),
        Some(value) if value.is_array() => Ok(value),
        Some(_) => Err(rusqlite::Error::FromSqlConversionFailure(
            index,
            rusqlite::types::Type::Text,
            format!("`{field}` must decode to an array or null").into(),
        )),
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

fn visit_results_summary_source_rows(
    connection: &Connection,
    mut consume: impl FnMut(WorkspaceStoreResultsSummarySourceRow),
) -> Result<(), WorkspaceStoreReadError> {
    let total = connection
        .query_row(RESULTS_SUMMARY_COUNT_QUERY, [], |row| row.get::<_, i64>(0))
        .map_err(|error| WorkspaceStoreReadError::Query(error.to_string()))?;
    let total = usize::try_from(total).map_err(|_| {
        WorkspaceStoreReadError::Query("results-summary count is outside usize range".into())
    })?;
    let mut observed = 0_usize;
    let mut offset = 0_i64;
    while observed < total {
        let mut statement = connection
            .prepare(RESULTS_SUMMARY_PAGE_QUERY)
            .map_err(|error| WorkspaceStoreReadError::Query(error.to_string()))?;
        let rows = statement
            .query_map(
                [RESULTS_SUMMARY_PAGE_SIZE, offset],
                row_to_results_summary_source,
            )
            .map_err(|error| WorkspaceStoreReadError::Query(error.to_string()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| WorkspaceStoreReadError::Query(error.to_string()))?;
        if rows.is_empty() {
            return Err(WorkspaceStoreReadError::ChangedDuringRead);
        }
        offset = offset
            .checked_add(i64::try_from(rows.len()).map_err(|_| {
                WorkspaceStoreReadError::Query("results-summary page is too large".into())
            })?)
            .ok_or_else(|| {
                WorkspaceStoreReadError::Query("results-summary offset overflowed".into())
            })?;
        observed += rows.len();
        rows.into_iter().for_each(&mut consume);
    }
    if observed != total {
        return Err(WorkspaceStoreReadError::ChangedDuringRead);
    }
    Ok(())
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

fn row_to_results_summary_source(
    row: &Row<'_>,
) -> rusqlite::Result<WorkspaceStoreResultsSummarySourceRow> {
    Ok(WorkspaceStoreResultsSummarySourceRow {
        chain_id: required_text(row, 0, "chain_id")?,
        pipeline_id: required_text(row, 1, "pipeline_id")?,
        run_id: required_text(row, 2, "run_id")?,
        pipeline_name: required_text(row, 3, "name")?,
        expanded_config: json_array_or_none(optional_text(row, 4)?),
        model_step_idx: row.get(5)?,
        dataset_name: required_text(row, 6, "dataset_name")?,
        metric: optional_text(row, 7)?,
        task_type: optional_text(row, 8)?,
        model_name: optional_text(row, 9)?,
        model_class: required_text(row, 10, "model_class")?,
        preprocessings: optional_text(row, 11)?.unwrap_or_default(),
        cv_val_score: optional_finite_or_null_f64(row, 12)?,
        cv_test_score: optional_finite_or_null_f64(row, 13)?,
        cv_train_score: optional_finite_or_null_f64(row, 14)?,
        cv_fold_count: nonnegative_i64_or_default(row, 15, "cv_fold_count")?,
        cv_scores: json_object_or_default(optional_text(row, 16)?),
        final_test_score: optional_finite_or_null_f64(row, 17)?,
        final_train_score: optional_finite_or_null_f64(row, 18)?,
        final_scores: json_object_or_default(optional_text(row, 19)?),
        final_agg_test_score: optional_finite_or_null_f64(row, 20)?,
        final_agg_train_score: optional_finite_or_null_f64(row, 21)?,
        final_agg_scores: json_object_or_default(optional_text(row, 22)?),
        best_params: nonempty_json_object(optional_text(row, 23)?),
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

fn optional_finite_or_null_f64(row: &Row<'_>, index: usize) -> rusqlite::Result<Option<f64>> {
    Ok(row
        .get::<_, Option<f64>>(index)?
        .filter(|number| number.is_finite()))
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
    raw.and_then(|value| parse_python_json(&value))
        .unwrap_or(default)
}

fn json_object_or_default(raw: Option<String>) -> Value {
    raw.and_then(|value| parse_python_json(&value))
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({}))
}

fn nonempty_json_object(raw: Option<String>) -> Option<Value> {
    raw.and_then(|value| parse_python_json(&value))
        .filter(|value| value.as_object().is_some_and(|object| !object.is_empty()))
}

fn json_array_or_none(raw: Option<String>) -> Option<Vec<Value>> {
    raw.and_then(|value| parse_python_json(&value))
        .and_then(|value| value.as_array().cloned())
}

/// Python's standard JSON encoder emits bare NaN and infinities by default.
/// The owner summary policy accepts those documents and recursively sanitizes
/// the non-finite leaves to null, so normalize only bare value tokens before
/// handing the document to strict `serde_json`.
fn parse_python_json(raw: &str) -> Option<Value> {
    if let Ok(value) = serde_json::from_str(raw) {
        return Some(value);
    }
    let mut normalized = String::with_capacity(raw.len());
    let mut index = 0;
    let mut in_string = false;
    let mut escaped = false;
    let mut replaced = false;
    while index < raw.len() {
        let character = raw[index..].chars().next()?;
        if in_string {
            normalized.push(character);
            index += character.len_utf8();
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                in_string = false;
            }
            continue;
        }
        if character == '"' {
            in_string = true;
            normalized.push(character);
            index += 1;
            continue;
        }
        let token = ["-Infinity", "Infinity", "NaN"]
            .into_iter()
            .find(|token| raw[index..].starts_with(token));
        if let Some(token) = token {
            normalized.push_str("null");
            index += token.len();
            replaced = true;
        } else {
            normalized.push(character);
            index += character.len_utf8();
        }
    }
    replaced
        .then(|| serde_json::from_str(&normalized).ok())
        .flatten()
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
    use serde_json::{json, Value};

    use super::{
        parse_python_json, read_archive_v2_registrations, read_pipeline_summaries,
        read_ranked_chains, read_results_summary_source, read_run_detail_projection,
        read_run_summaries, validate_run_detail_http_contract_value, ChainScoreDirection,
        WorkspaceStoreReadError, DEFAULT_PIPELINE_SUMMARIES_LIMIT, DEFAULT_RUN_SUMMARIES_LIMIT,
        STUDIO_RUN_DETAIL_HTTP_CONTRACT,
    };

    const PYTHON_WRITTEN_STORE: &[u8] =
        include_bytes!("../tests/fixtures/workspace_store_v5.sqlite");

    #[test]
    fn parses_python_nonfinite_json_without_losing_finite_siblings_or_strings() {
        let parsed = parse_python_json(
            r#"{"val":{"r2":NaN},"test":{"r2":0.8},"limits":[Infinity,-Infinity],"label":"NaN Infinity"}"#,
        )
        .unwrap();
        assert_eq!(
            parsed,
            json!({
                "val": {"r2": null},
                "test": {"r2": 0.8},
                "limits": [null, null],
                "label": "NaN Infinity",
            })
        );
    }

    #[test]
    fn consumes_the_run_detail_http_contract_only_as_a_fail_closed_manifest() {
        let contract: Value = serde_json::from_str(STUDIO_RUN_DETAIL_HTTP_CONTRACT).unwrap();
        validate_run_detail_http_contract_value(&contract).unwrap();
        assert_eq!(contract["cutover"]["route_selection"], "forbidden");
        assert_eq!(
            contract["http_composition"]["store_branch"]["runtime_composition"]["policy_contract"],
            "not_yet_published"
        );
        assert_eq!(
            contract["http_composition"]["legacy_manifest_branch"]["status"],
            "not_covered"
        );

        let mut incorrectly_enabled = contract.clone();
        incorrectly_enabled["cutover"]["route_selection"] = json!("native");
        assert!(matches!(
            validate_run_detail_http_contract_value(&incorrectly_enabled),
            Err(WorkspaceStoreReadError::Contract(detail))
                if detail.contains("fail-closed cutover")
        ));

        let mut replaced_owner_splitter = contract;
        replaced_owner_splitter["dependencies"]["splitter_config"]["callable"] =
            json!("studio_sidecar.reimplemented_splitter");
        assert!(matches!(
            validate_run_detail_http_contract_value(&replaced_owner_splitter),
            Err(WorkspaceStoreReadError::Contract(detail))
                if detail.contains("owner inputs")
        ));
    }

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

    #[test]
    fn archive_v2_registrations_are_store_authorized_and_bounded() {
        let workspace = fixture_workspace("archive-v2-registrations");
        let connection = Connection::open(workspace.join("store.sqlite")).unwrap();
        for (id, path, format, refs) in [
            ("artifact:v2", "models/a.n4a", "n4a", 1_i64),
            ("artifact:legacy", "models/a.joblib", "joblib", 1_i64),
            ("artifact:orphan", "models/orphan.n4a", "n4a", 0_i64),
        ] {
            connection.execute("INSERT INTO artifacts (artifact_id, artifact_path, content_hash, format, size_bytes, ref_count) VALUES (?, ?, ?, ?, ?, ?)", params![id, path, "a".repeat(64), format, 10_i64, refs]).unwrap();
        }
        drop(connection);
        assert_eq!(
            read_archive_v2_registrations(&workspace).unwrap(),
            vec![super::WorkspaceStoreArchiveV2Registration {
                artifact_id: "artifact:v2".into(),
                artifact_path: "models/a.n4a".into(),
                content_hash: "a".repeat(64)
            },]
        );
        fs::remove_dir_all(workspace).unwrap();
    }

    fn populate_run_detail(workspace: &Path) {
        let connection = Connection::open(workspace.join("store.sqlite")).unwrap();
        connection
            .execute(
                "INSERT INTO runs (run_id, name, config, datasets, status, created_at, completed_at, summary, error, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    "run-detail-001",
                    "Detail oracle",
                    r#"{"metric":"rmsecv","drop":null,"nested":{"nan":NaN,"values":[Infinity,-Infinity,1.5]}}"#,
                    r#"[{"name":"corn","n_samples":42}]"#,
                    "completed",
                    "2026-09-01T10:00:00+02:00",
                    "2026-09-01T10:05:00+02:00",
                    r#"{"total_results":2,"best_score":Infinity}"#,
                    Option::<String>::None,
                    Option::<String>::None,
                ],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO pipelines (pipeline_id, run_id, name, expanded_config, original_template, generator_choices, dataset_name, dataset_hash, status, created_at, completed_at, best_val, best_test, metric, duration_ms, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    "11111111-1111-1111-1111-111111111111",
                    "run-detail-001",
                    "0001_pls",
                    r#"[{"model":{"class":"PLSRegression","score":NaN}}]"#,
                    r#"{"name":"PLS template"}"#,
                    r#"[{"n_components":8}]"#,
                    "corn",
                    "sha256:corn",
                    "completed",
                    "2026-09-01T10:02:00+02:00",
                    "2026-09-01T10:03:00+02:00",
                    f64::INFINITY,
                    f64::NEG_INFINITY,
                    "rmsecv",
                    321_i64,
                    Option::<String>::None,
                ],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO pipelines (pipeline_id, run_id, name, expanded_config, original_template, generator_choices, dataset_name, dataset_hash, status, created_at, completed_at, best_val, best_test, metric, duration_ms, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    "22222222-2222-2222-2222-222222222222",
                    "run-detail-001",
                    "0002_pending",
                    Option::<String>::None,
                    Option::<String>::None,
                    "[]",
                    "corn",
                    "sha256:corn",
                    "running",
                    "2026-09-01T10:02:00+02:00",
                    Option::<String>::None,
                    Option::<f64>::None,
                    Option::<f64>::None,
                    Option::<String>::None,
                    Option::<i64>::None,
                    Option::<String>::None,
                ],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO chains (chain_id, pipeline_id, steps, model_step_idx, model_class, final_test_score) VALUES ('chain-refit', ?, '[]', 1, 'PLSRegression', 0.11)",
                ["11111111-1111-1111-1111-111111111111"],
            )
            .unwrap();
        for (log_id, event, duration_ms, level) in [
            ("log-warning", "warning", None, "warning"),
            ("log-end", "end", Some(321_i64), "info"),
        ] {
            connection
                .execute(
                    "INSERT INTO logs (log_id, pipeline_id, step_idx, operator_class, event, duration_ms, message, details, level, created_at) VALUES (?, ?, 0, 'SNV', ?, ?, NULL, NULL, ?, '2026-09-01T10:02:10+02:00')",
                    params![
                        log_id,
                        "11111111-1111-1111-1111-111111111111",
                        event,
                        duration_ms,
                        level,
                    ],
                )
                .unwrap();
        }
        connection
            .execute_batch("PRAGMA journal_mode=DELETE")
            .unwrap();
    }

    #[test]
    fn reads_the_exact_owner_run_detail_projection_without_selecting_http() {
        let workspace = fixture_workspace("workspace-store-run-detail-v5");
        populate_run_detail(&workspace);
        let before = fs::read(workspace.join("store.sqlite")).unwrap();
        let expected: serde_json::Value = serde_json::from_str(include_str!(
            "../tests/fixtures/workspace_store_v5_run_detail.response.json"
        ))
        .unwrap();

        let actual = read_run_detail_projection(&workspace, "run-detail-001")
            .unwrap()
            .unwrap();

        assert_eq!(actual, expected);
        assert_eq!(
            read_run_detail_projection(&workspace, "missing-run").unwrap(),
            None
        );
        assert_eq!(fs::read(workspace.join("store.sqlite")).unwrap(), before);
        assert!(!["-wal", "-shm", "-journal"]
            .into_iter()
            .any(|suffix| workspace.join(format!("store.sqlite{suffix}")).exists()));
        fs::remove_dir_all(workspace).unwrap();
    }

    #[test]
    fn run_detail_projection_rejects_noncanonical_ids_and_malformed_json() {
        let workspace = fixture_workspace("workspace-store-run-detail-invalid-v5");
        populate_run_detail(&workspace);
        assert!(matches!(
            read_run_detail_projection(&workspace, " run-detail-001"),
            Err(WorkspaceStoreReadError::InvalidRunId)
        ));
        let connection = Connection::open(workspace.join("store.sqlite")).unwrap();
        connection
            .execute(
                "UPDATE runs SET config = '[' WHERE run_id = 'run-detail-001'",
                [],
            )
            .unwrap();
        connection
            .execute_batch("PRAGMA journal_mode=DELETE")
            .unwrap();
        drop(connection);
        assert!(matches!(
            read_run_detail_projection(&workspace, "run-detail-001"),
            Err(WorkspaceStoreReadError::Query(detail)) if detail.contains("runs.config") && detail.contains("malformed JSON")
        ));
        fs::remove_dir_all(workspace).unwrap();
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
    fn results_summary_source_reads_more_than_one_page_in_chain_id_order() {
        let workspace = fixture_workspace("workspace-store-results-summary-pages-v5");
        let mut connection = Connection::open(workspace.join("store.sqlite")).unwrap();
        let transaction = connection.transaction().unwrap();
        let pipeline_id = "87654321-4321-6789-4321-678943216789";
        for index in 0..=500 {
            let chain_id = format!("page-chain-{index:04}");
            transaction
                .execute(
                    "INSERT INTO chains (chain_id, pipeline_id, steps, model_step_idx, model_class, dataset_name, metric, cv_val_score, cv_fold_count) VALUES (?, ?, '[]', 1, 'PLSRegression', 'corn', 'r2', ?, 1)",
                    params![chain_id, pipeline_id, f64::from(index) / 1000.0],
                )
                .unwrap();
            transaction
                .execute(
                    "INSERT INTO predictions (prediction_id, pipeline_id, chain_id, dataset_name, model_name, model_class, fold_id, partition, metric, task_type) VALUES (?, ?, ?, 'corn', 'PLS', 'PLSRegression', 'fold_0', 'val', 'r2', 'regression')",
                    params![format!("page-prediction-{index:04}"), pipeline_id, chain_id],
                )
                .unwrap();
        }
        transaction.commit().unwrap();
        drop(connection);

        let rows = read_results_summary_source(&workspace).unwrap();

        assert_eq!(rows.len(), 501);
        assert_eq!(rows.first().unwrap().chain_id, "page-chain-0000");
        assert_eq!(rows.last().unwrap().chain_id, "page-chain-0500");
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
