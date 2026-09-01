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

use rusqlite::{Connection, OpenFlags, Row};
use serde_json::{json, Value};
use url::Url;

pub const WORKSPACE_STORE_SCHEMA_VERSION: i64 = 5;
pub const MAX_RUN_SUMMARIES: u16 = 500;
pub const DEFAULT_RUN_SUMMARIES_LIMIT: u16 = 100;
pub const WORKSPACE_STORE_READ_CONTRACT: &str =
    include_str!("../contracts/workspace_store_read_v1.json");

const CONTRACT_SCHEMA_ID: &str = "nirs4all.workspace-store-read.v1";
const CONTRACT_SCHEMA_VERSION: i64 = 1;
const STORE_FILENAME: &str = "store.sqlite";
const RUN_SUMMARY_QUERY: &str = "SELECT run_id, name, status, created_at, completed_at, datasets, summary, error FROM runs ORDER BY created_at DESC LIMIT ? OFFSET ?";
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
    MissingColumns(Vec<String>),
    LimitOutOfRange(u16),
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
            Self::MissingColumns(columns) => write!(
                formatter,
                "WorkspaceStore runs table is missing required columns: {}",
                columns.join(", ")
            ),
            Self::LimitOutOfRange(limit) => write!(
                formatter,
                "WorkspaceStore run-summary limit {limit} is outside 1..={MAX_RUN_SUMMARIES}"
            ),
            Self::OffsetOutOfRange(offset) => write!(
                formatter,
                "WorkspaceStore run-summary offset {offset} exceeds SQLite integer range"
            ),
            Self::Query(detail) => write!(formatter, "WorkspaceStore run-summary query failed: {detail}"),
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
    let database =
        workspace_store_path(workspace_path).ok_or(WorkspaceStoreReadError::StoreNotFound)?;
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
    let mut statement = connection
        .prepare("PRAGMA table_info(runs)")
        .map_err(|error| WorkspaceStoreReadError::Query(error.to_string()))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| WorkspaceStoreReadError::Query(error.to_string()))?
        .collect::<Result<BTreeSet<_>, _>>()
        .map_err(|error| WorkspaceStoreReadError::Query(error.to_string()))?;
    let missing = RUN_COLUMNS
        .iter()
        .filter(|column| !columns.contains(**column))
        .map(|column| (*column).to_owned())
        .collect::<Vec<_>>();
    if missing.is_empty() {
        Ok(())
    } else {
        Err(WorkspaceStoreReadError::MissingColumns(missing))
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

#[cfg(test)]
mod tests {
    use std::{
        collections::BTreeSet,
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    use rusqlite::Connection;
    use serde_json::json;

    use super::{read_run_summaries, WorkspaceStoreReadError, DEFAULT_RUN_SUMMARIES_LIMIT};

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
            Err(WorkspaceStoreReadError::MissingColumns(columns)) if columns.contains(&"name".into())
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
