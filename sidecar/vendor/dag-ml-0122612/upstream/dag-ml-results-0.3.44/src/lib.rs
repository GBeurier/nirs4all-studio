//! Validated reader for the generic native dag-ml results directory.
//!
//! A results directory contains a schema-versioned manifest, the authoritative
//! dag-ml `ScoreSet`, and a columnar projection of prediction rows.  This crate
//! owns only that generic prediction/score surface: it does not know about a
//! host application, does not execute models, and deliberately never opens the
//! optional artifact subtree.
//!
//! The V2 layout uses fixed filenames.  Even though the manifest repeats those
//! names for human inspection, this reader rejects a mismatch and only opens
//! the fixed paths.  That keeps a corrupt manifest from redirecting a results
//! read outside its run directory.

use std::fs::{File, OpenOptions};
use std::io;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use arrow_array::{
    builder::{Float64Builder, Int64Builder, ListBuilder, StringBuilder},
    Array, ArrayRef, BooleanArray, Float64Array, Int64Array, LargeListArray, LargeStringArray,
    ListArray, RecordBatch, StringArray,
};
use arrow_schema::{DataType, Field, Schema};
use parquet::arrow::{arrow_reader::ParquetRecordBatchReaderBuilder, ArrowWriter};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use thiserror::Error;

/// Schema version currently understood by this reader.
pub const NATIVE_RESULTS_SCHEMA_VERSION: i64 = 2;
/// The manifest filename in a native results directory.
pub const MANIFEST_FILENAME: &str = "manifest.json";
/// The ScoreSet filename in a native results directory.
pub const SCORE_SET_FILENAME: &str = "score_set.json";
/// The prediction projection filename in a native results directory.
pub const PREDICTIONS_FILENAME: &str = "predictions.parquet";

const NATIVE_ENGINE: &str = "dag-ml";
const WRITER_RESERVATION_FILENAME: &str = ".dag-ml-results-writer";

/// Errors emitted while opening or validating native results.
#[derive(Debug, Error)]
pub enum NativeResultsError {
    /// The run directory or one of its fixed files could not be opened.
    #[error("native results I/O failed: {0}")]
    Io(#[from] io::Error),
    /// On-disk data was not a valid native results V2 payload.
    #[error("native results validation failed: {0}")]
    Validation(String),
}

/// Result alias for this crate.
pub type Result<T> = std::result::Result<T, NativeResultsError>;

/// One queryable prediction row from the Parquet projection.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct NativePredictionRow {
    /// Dataset identifier supplied by the caller.
    pub dataset: String,
    /// Configuration identifier supplied by the caller.
    pub config_name: String,
    /// Stable configuration/variant identifier.
    pub variant_id: String,
    /// Model identifier supplied by the caller.
    pub model_name: String,
    /// Prediction partition (for example validation or test).
    pub partition: String,
    /// Fold identifier, if the producer supplied one.
    pub fold_id: String,
    /// Refit context, if the producer supplied one.
    pub refit_context: String,
    /// Original sample indices for array-backed rows.
    pub sample_indices: Vec<i64>,
    /// Stable physical sample identities, when the producer supplied them.
    ///
    /// `None` means a legacy V2 projection without the additive
    /// `sample_ids` column; an empty vector means the current producer could
    /// not prove stable identities for that row.
    pub sample_ids: Option<Vec<String>>,
    /// Flattened true targets.
    pub y_true: Vec<f64>,
    /// Flattened predictions.
    pub y_pred: Vec<f64>,
    /// Flattened probabilities, when the task provides them.
    pub y_proba: Vec<f64>,
    /// Shape paired with `y_true`.
    pub y_true_shape: Vec<i64>,
    /// Shape paired with `y_pred`.
    pub y_pred_shape: Vec<i64>,
    /// Shape paired with `y_proba`.
    pub y_proba_shape: Vec<i64>,
    /// Optional per-sample weights.
    pub weights: Vec<f64>,
    /// Whether the row carries direct prediction arrays.
    pub arrays_present: bool,
    /// Optional validation score.
    pub val_score: Option<f64>,
    /// Optional test score.
    pub test_score: Option<f64>,
    /// Optional train score.
    pub train_score: Option<f64>,
    /// Generic score record preserved as a JSON object.
    pub scores: Map<String, Value>,
    /// Metric name for this row.
    pub metric: String,
    /// Task type for this row.
    pub task_type: String,
    /// Number of target columns.
    pub target_width: i64,
    /// Descriptive names for each target column.
    pub target_names: Vec<String>,
}

/// Validated native results, ready for a language binding or a host query API.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NativeResultsView {
    /// The additive manifest, preserved without re-authoring it.
    pub manifest: Value,
    /// The authoritative dag-ml ScoreSet, preserved without re-authoring it.
    pub score_set: Value,
    /// Queryable prediction rows from the columnar projection.
    pub predictions: Vec<NativePredictionRow>,
}

/// Read a native results V2 directory.
///
/// Only `manifest.json`, `score_set.json`, and `predictions.parquet` are
/// opened.  In particular, artifact references are metadata only: this reader
/// never resolves a URI, deserializes an artifact, or executes user payloads.
pub fn read_native_results(run_dir: impl AsRef<Path>) -> Result<NativeResultsView> {
    let run_dir = run_dir.as_ref();
    let manifest = read_json(run_dir.join(MANIFEST_FILENAME), "manifest")?;
    validate_manifest(&manifest)?;

    let score_set = read_json(run_dir.join(SCORE_SET_FILENAME), "score set")?;
    if !score_set.is_object() {
        return Err(validation("score_set.json must contain a JSON object"));
    }
    let actual_hash = score_set_hash(&score_set);
    let expected_hash = required_string(
        required_object(&manifest, "manifest")?,
        "score_set_hash",
        "manifest",
    )?;
    if actual_hash != expected_hash {
        return Err(validation(
            "manifest score_set_hash does not match score_set.json",
        ));
    }

    let predictions = read_prediction_rows(&run_dir.join(PREDICTIONS_FILENAME))?;
    for row in &predictions {
        validate_prediction_row(row)?;
    }
    Ok(NativeResultsView {
        manifest,
        score_set,
        predictions,
    })
}

/// Write the generic, portable portion of a native results V2 directory.
///
/// The caller owns the run directory and any optional host-artifact subtree.
/// This function writes only the three fixed V2 files and refuses to overwrite
/// any of them. It validates exactly the payload that the reader will consume,
/// reserves one writer, writes temporary sibling files first, then publishes
/// them with hard links or exclusive-create copies (the manifest last). The manifest is the
/// commit marker: readers cannot accept a partially published directory.
/// Ordinary errors roll back this writer's files. After an abrupt process
/// termination, an unfinished directory and reservation are left intact;
/// retry in a new run directory rather than stealing a possibly live writer's
/// reservation. It never serializes model artifacts or interprets artifact URIs.
pub fn write_native_results(
    run_dir: impl AsRef<Path>,
    manifest: Value,
    score_set: Value,
    predictions: Vec<NativePredictionRow>,
) -> Result<()> {
    let run_dir = run_dir.as_ref();
    if !run_dir.is_dir() {
        return Err(validation(
            "native results run_dir must be an existing directory",
        ));
    }
    validate_manifest(&manifest)?;
    if !score_set.is_object() {
        return Err(validation("score_set must be a JSON object"));
    }
    let expected_hash = required_string(
        required_object(&manifest, "manifest")?,
        "score_set_hash",
        "manifest",
    )?;
    if score_set_hash(&score_set) != expected_hash {
        return Err(validation(
            "manifest score_set_hash does not match score_set",
        ));
    }
    for row in &predictions {
        validate_prediction_row(row)?;
    }

    let reservation = run_dir.join(WRITER_RESERVATION_FILENAME);
    let mut reservation_file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&reservation)
        .map_err(|error| {
            if error.kind() == io::ErrorKind::AlreadyExists {
                validation("native results writer refuses to overwrite an active or interrupted writer reservation")
            } else {
                error.into()
            }
        })?;
    let _reservation = WriterReservation(reservation);
    writeln!(reservation_file, "{}", std::process::id())?;
    reservation_file.sync_all()?;
    drop(reservation_file);

    let destinations = [
        run_dir.join(MANIFEST_FILENAME),
        run_dir.join(SCORE_SET_FILENAME),
        run_dir.join(PREDICTIONS_FILENAME),
    ];
    if let Some(path) = destinations.iter().find(|path| path.exists()) {
        return Err(validation(format!(
            "native results writer refuses to overwrite {}",
            path.display()
        )));
    }

    let nonce = format!("{}.{}", std::process::id(), random_suffix());
    let temporary = [
        run_dir.join(format!(".{MANIFEST_FILENAME}.{nonce}.tmp")),
        run_dir.join(format!(".{SCORE_SET_FILENAME}.{nonce}.tmp")),
        run_dir.join(format!(".{PREDICTIONS_FILENAME}.{nonce}.tmp")),
    ];

    let result = (|| {
        write_new_bytes(&temporary[0], canonical_json(&manifest).as_bytes())?;
        write_new_bytes(&temporary[1], canonical_json(&score_set).as_bytes())?;
        write_prediction_rows(&temporary[2], &predictions)?;
        publish_result_files(&temporary, &destinations)?;
        Ok(())
    })();
    for path in &temporary {
        let _ = std::fs::remove_file(path);
    }
    result
}

struct WriterReservation(PathBuf);

impl Drop for WriterReservation {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

fn publish_result_files(temporary: &[PathBuf; 3], destinations: &[PathBuf; 3]) -> Result<()> {
    let mut published = Vec::new();
    // Same-directory hard links fail atomically if a destination exists,
    // including a dangling symlink. Never use rename's replace semantics.
    for index in [1, 2, 0] {
        let publish =
            std::fs::hard_link(&temporary[index], &destinations[index]).or_else(|error| {
                if !matches!(
                    error.kind(),
                    io::ErrorKind::Unsupported | io::ErrorKind::PermissionDenied
                ) {
                    return Err(error);
                }
                // Exclusive creation keeps the same no-overwrite guarantee on
                // filesystems that cannot hard-link. Manifest is still committed last.
                let mut output = OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&destinations[index])?;
                let copied = (|| {
                    let mut input = std::fs::File::open(&temporary[index])?;
                    io::copy(&mut input, &mut output)?;
                    output.sync_all()
                })();
                if copied.is_err() {
                    let _ = std::fs::remove_file(&destinations[index]);
                }
                copied
            });
        if let Err(error) = publish {
            for path in published.iter().rev() {
                let _ = std::fs::remove_file(path);
            }
            return Err(error.into());
        }
        published.push(&destinations[index]);
    }
    Ok(())
}

fn random_suffix() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

fn write_new_bytes(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}

fn write_prediction_rows(path: &Path, rows: &[NativePredictionRow]) -> Result<()> {
    let include_sample_ids = rows.is_empty() || rows.iter().all(|row| row.sample_ids.is_some());
    if !include_sample_ids && rows.iter().any(|row| row.sample_ids.is_some()) {
        return Err(validation(
            "prediction rows must either all include sample_ids or all omit the legacy column",
        ));
    }

    let mut fields = vec![
        Field::new("dataset", DataType::Utf8, false),
        Field::new("config_name", DataType::Utf8, false),
        Field::new("variant_id", DataType::Utf8, false),
        Field::new("model_name", DataType::Utf8, false),
        Field::new("partition", DataType::Utf8, false),
        Field::new("fold_id", DataType::Utf8, false),
        Field::new("refit_context", DataType::Utf8, false),
        list_field("sample_indices", DataType::Int64),
        list_field("y_true", DataType::Float64),
        list_field("y_pred", DataType::Float64),
        list_field("y_proba", DataType::Float64),
        list_field("y_true_shape", DataType::Int64),
        list_field("y_pred_shape", DataType::Int64),
        list_field("y_proba_shape", DataType::Int64),
        list_field("weights", DataType::Float64),
        Field::new("arrays_present", DataType::Boolean, false),
        Field::new("val_score", DataType::Float64, true),
        Field::new("test_score", DataType::Float64, true),
        Field::new("train_score", DataType::Float64, true),
        Field::new("scores", DataType::Utf8, false),
        Field::new("metric", DataType::Utf8, false),
        Field::new("task_type", DataType::Utf8, false),
        Field::new("target_width", DataType::Int64, false),
        Field::new("target_names", DataType::Utf8, false),
    ];
    let mut columns: Vec<ArrayRef> = vec![
        string_column(rows, |row| &row.dataset),
        string_column(rows, |row| &row.config_name),
        string_column(rows, |row| &row.variant_id),
        string_column(rows, |row| &row.model_name),
        string_column(rows, |row| &row.partition),
        string_column(rows, |row| &row.fold_id),
        string_column(rows, |row| &row.refit_context),
        list_i64_column(rows, |row| &row.sample_indices),
        list_f64_column(rows, |row| &row.y_true),
        list_f64_column(rows, |row| &row.y_pred),
        list_f64_column(rows, |row| &row.y_proba),
        list_i64_column(rows, |row| &row.y_true_shape),
        list_i64_column(rows, |row| &row.y_pred_shape),
        list_i64_column(rows, |row| &row.y_proba_shape),
        list_f64_column(rows, |row| &row.weights),
        Arc::new(BooleanArray::from(
            rows.iter()
                .map(|row| row.arrays_present)
                .collect::<Vec<_>>(),
        )),
        Arc::new(Float64Array::from(
            rows.iter().map(|row| row.val_score).collect::<Vec<_>>(),
        )),
        Arc::new(Float64Array::from(
            rows.iter().map(|row| row.test_score).collect::<Vec<_>>(),
        )),
        Arc::new(Float64Array::from(
            rows.iter().map(|row| row.train_score).collect::<Vec<_>>(),
        )),
        Arc::new(StringArray::from_iter_values(
            rows.iter()
                .map(|row| canonical_json(&Value::Object(row.scores.clone()))),
        )),
        string_column(rows, |row| &row.metric),
        string_column(rows, |row| &row.task_type),
        Arc::new(Int64Array::from_iter_values(
            rows.iter().map(|row| row.target_width),
        )),
        Arc::new(StringArray::from_iter_values(rows.iter().map(|row| {
            serde_json::to_string(&row.target_names).expect("target names must serialize")
        }))),
    ];
    if include_sample_ids {
        fields.insert(8, list_field("sample_ids", DataType::Utf8));
        columns.insert(
            8,
            list_string_column(rows, |row| row.sample_ids.as_deref().unwrap_or_default()),
        );
    }

    let schema = Arc::new(Schema::new(fields));
    let batch = RecordBatch::try_new(Arc::clone(&schema), columns)
        .map_err(|error| validation(format!("native prediction projection is invalid: {error}")))?;
    let file = OpenOptions::new().write(true).create_new(true).open(path)?;
    let durable_file = file.try_clone()?;
    let mut writer = ArrowWriter::try_new(file, schema, None).map_err(|error| {
        validation(format!(
            "predictions.parquet cannot be opened for writing: {error}"
        ))
    })?;
    writer
        .write(&batch)
        .map_err(|error| validation(format!("predictions.parquet cannot be written: {error}")))?;
    writer
        .close()
        .map_err(|error| validation(format!("predictions.parquet cannot be finalized: {error}")))?;
    durable_file.sync_all()?;
    Ok(())
}

fn list_field(name: &str, value_type: DataType) -> Field {
    Field::new(
        name,
        DataType::List(Arc::new(Field::new("item", value_type, true))),
        false,
    )
}

fn string_column<F>(rows: &[NativePredictionRow], values: F) -> ArrayRef
where
    F: Fn(&NativePredictionRow) -> &str,
{
    Arc::new(StringArray::from_iter_values(rows.iter().map(values)))
}

fn list_f64_column<F>(rows: &[NativePredictionRow], values: F) -> ArrayRef
where
    F: Fn(&NativePredictionRow) -> &[f64],
{
    let mut builder = ListBuilder::new(Float64Builder::new());
    for row in rows {
        for value in values(row) {
            builder.values().append_value(*value);
        }
        builder.append(true);
    }
    Arc::new(builder.finish())
}

fn list_i64_column<F>(rows: &[NativePredictionRow], values: F) -> ArrayRef
where
    F: Fn(&NativePredictionRow) -> &[i64],
{
    let mut builder = ListBuilder::new(Int64Builder::new());
    for row in rows {
        for value in values(row) {
            builder.values().append_value(*value);
        }
        builder.append(true);
    }
    Arc::new(builder.finish())
}

fn list_string_column<F>(rows: &[NativePredictionRow], values: F) -> ArrayRef
where
    F: Fn(&NativePredictionRow) -> &[String],
{
    let mut builder = ListBuilder::new(StringBuilder::new());
    for row in rows {
        for value in values(row) {
            builder.values().append_value(value);
        }
        builder.append(true);
    }
    Arc::new(builder.finish())
}

fn read_json(path: impl AsRef<Path>, label: &str) -> Result<Value> {
    let bytes = std::fs::read(path)?;
    serde_json::from_slice(&bytes)
        .map_err(|error| validation(format!("{label} is not valid JSON: {error}")))
}

fn validate_manifest(manifest: &Value) -> Result<()> {
    let manifest = required_object(manifest, "manifest")?;
    let schema_version = required_i64(manifest, "schema_version", "manifest")?;
    if schema_version != NATIVE_RESULTS_SCHEMA_VERSION {
        return Err(validation(format!(
            "unsupported manifest schema_version {schema_version}; expected {NATIVE_RESULTS_SCHEMA_VERSION}",
        )));
    }
    let engine = required_string(manifest, "engine", "manifest")?;
    if engine != NATIVE_ENGINE {
        return Err(validation(format!(
            "manifest engine must be {NATIVE_ENGINE:?}, got {engine:?}",
        )));
    }

    let files = manifest
        .get("files")
        .and_then(Value::as_object)
        .ok_or_else(|| validation("manifest.files must be a JSON object"))?;
    require_fixed_filename(files, "score_set", SCORE_SET_FILENAME)?;
    require_fixed_filename(files, "predictions", PREDICTIONS_FILENAME)?;
    let hash = required_string(manifest, "score_set_hash", "manifest")?;
    if hash.len() != 64 || !hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(validation(
            "manifest.score_set_hash must be a SHA-256 hex digest",
        ));
    }
    Ok(())
}

fn require_fixed_filename(files: &Map<String, Value>, key: &str, expected: &str) -> Result<()> {
    let actual = required_string(files, key, "manifest.files")?;
    if actual != expected {
        return Err(validation(format!(
            "manifest.files.{key} must be {expected:?}",
        )));
    }
    Ok(())
}

fn read_prediction_rows(path: &Path) -> Result<Vec<NativePredictionRow>> {
    let file = File::open(path)?;
    let builder = ParquetRecordBatchReaderBuilder::try_new(file)
        .map_err(|error| validation(format!("predictions.parquet cannot be opened: {error}")))?;
    let reader = builder
        .build()
        .map_err(|error| validation(format!("predictions.parquet cannot be read: {error}")))?;

    let mut rows = Vec::new();
    for batch in reader {
        let batch = batch.map_err(|error| {
            validation(format!("predictions.parquet has an invalid batch: {error}"))
        })?;
        for row in 0..batch.num_rows() {
            rows.push(read_prediction_row(&batch, row)?);
        }
    }
    Ok(rows)
}

fn read_prediction_row(batch: &RecordBatch, row: usize) -> Result<NativePredictionRow> {
    let y_true = required_list_f64(batch, "y_true", row)?;
    let y_pred = required_list_f64(batch, "y_pred", row)?;
    let y_proba = required_list_f64(batch, "y_proba", row)?;
    let y_true_shape = required_list_i64(batch, "y_true_shape", row)?;
    let y_pred_shape = required_list_i64(batch, "y_pred_shape", row)?;
    let y_proba_shape = required_list_i64(batch, "y_proba_shape", row)?;
    let arrays_present = required_bool(batch, "arrays_present", row)?;
    if arrays_present == y_pred.is_empty() {
        return Err(validation(
            "prediction row arrays_present must agree with whether y_pred is present",
        ));
    }
    validate_shape("y_true", &y_true, &y_true_shape)?;
    validate_shape("y_pred", &y_pred, &y_pred_shape)?;
    validate_shape("y_proba", &y_proba, &y_proba_shape)?;

    let target_width = required_i64_column(batch, "target_width", row)?;
    if target_width < 1 {
        return Err(validation("prediction row target_width must be positive"));
    }
    let target_names = parse_string_list(
        &required_string_column(batch, "target_names", row)?,
        "prediction row target_names",
    )?;
    if i64::try_from(target_names.len()).ok() != Some(target_width) {
        return Err(validation(
            "prediction row target_names length must equal target_width",
        ));
    }
    if y_true_shape.len() >= 2 && y_true_shape[1] != target_width {
        return Err(validation(
            "prediction row y_true target dimension must equal target_width",
        ));
    }

    let scores = parse_object(
        &required_string_column(batch, "scores", row)?,
        "prediction row scores",
    )?;
    let sample_indices = required_list_i64(batch, "sample_indices", row)?;
    let sample_ids = optional_list_string(batch, "sample_ids", row)?;
    if let Some(sample_ids) = &sample_ids {
        if !sample_ids.is_empty()
            && (sample_ids.len() != sample_indices.len()
                || sample_ids.iter().any(String::is_empty)
                || sample_ids
                    .iter()
                    .collect::<std::collections::BTreeSet<_>>()
                    .len()
                    != sample_ids.len())
        {
            return Err(validation(
                "prediction row sample_ids must be non-empty, unique, and align with sample_indices",
            ));
        }
    }

    Ok(NativePredictionRow {
        dataset: required_string_column(batch, "dataset", row)?,
        config_name: required_string_column(batch, "config_name", row)?,
        variant_id: required_string_column(batch, "variant_id", row)?,
        model_name: required_string_column(batch, "model_name", row)?,
        partition: required_string_column(batch, "partition", row)?,
        fold_id: required_string_column(batch, "fold_id", row)?,
        refit_context: required_string_column(batch, "refit_context", row)?,
        sample_indices,
        sample_ids,
        y_true,
        y_pred,
        y_proba,
        y_true_shape,
        y_pred_shape,
        y_proba_shape,
        weights: required_list_f64(batch, "weights", row)?,
        arrays_present,
        val_score: optional_f64_column(batch, "val_score", row)?,
        test_score: optional_f64_column(batch, "test_score", row)?,
        train_score: optional_f64_column(batch, "train_score", row)?,
        scores,
        metric: required_string_column(batch, "metric", row)?,
        task_type: required_string_column(batch, "task_type", row)?,
        target_width,
        target_names,
    })
}

fn validate_shape(field: &str, values: &[f64], shape: &[i64]) -> Result<()> {
    if values.is_empty() && shape.is_empty() {
        return Ok(());
    }
    if values.is_empty() || shape.is_empty() {
        return Err(validation(format!(
            "prediction row {field} and {field}_shape must both be empty or both be populated",
        )));
    }
    let expected_len = shape.iter().try_fold(1_usize, |product, dimension| {
        let dimension = usize::try_from(*dimension)
            .ok()
            .filter(|dimension| *dimension > 0)
            .ok_or_else(|| {
                validation(format!(
                    "prediction row {field}_shape must contain positive dimensions"
                ))
            })?;
        product.checked_mul(dimension).ok_or_else(|| {
            validation(format!(
                "prediction row {field}_shape product overflows usize"
            ))
        })
    })?;
    if expected_len != values.len() {
        return Err(validation(format!(
            "prediction row {field} length does not match {field}_shape",
        )));
    }
    Ok(())
}

fn validate_prediction_row(row: &NativePredictionRow) -> Result<()> {
    if row
        .y_true
        .iter()
        .chain(&row.y_pred)
        .chain(&row.y_proba)
        .chain(&row.weights)
        .chain(row.val_score.iter())
        .chain(row.test_score.iter())
        .chain(row.train_score.iter())
        .any(|value| !value.is_finite())
    {
        return Err(validation("prediction rows must contain finite numbers"));
    }
    if row.arrays_present == row.y_pred.is_empty() {
        return Err(validation(
            "prediction row arrays_present must agree with whether y_pred is present",
        ));
    }
    validate_shape("y_true", &row.y_true, &row.y_true_shape)?;
    validate_shape("y_pred", &row.y_pred, &row.y_pred_shape)?;
    validate_shape("y_proba", &row.y_proba, &row.y_proba_shape)?;
    if row.target_width < 1 {
        return Err(validation("prediction row target_width must be positive"));
    }
    if i64::try_from(row.target_names.len()).ok() != Some(row.target_width) {
        return Err(validation(
            "prediction row target_names length must equal target_width",
        ));
    }
    if row.y_true_shape.len() >= 2 && row.y_true_shape[1] != row.target_width {
        return Err(validation(
            "prediction row y_true target dimension must equal target_width",
        ));
    }
    if let Some(sample_ids) = &row.sample_ids {
        if !sample_ids.is_empty()
            && (sample_ids.len() != row.sample_indices.len()
                || sample_ids.iter().any(String::is_empty)
                || sample_ids
                    .iter()
                    .collect::<std::collections::BTreeSet<_>>()
                    .len()
                    != sample_ids.len())
        {
            return Err(validation(
                "prediction row sample_ids must be non-empty, unique, and align with sample_indices",
            ));
        }
    }
    Ok(())
}

fn required_string_column(batch: &RecordBatch, name: &str, row: usize) -> Result<String> {
    let column = batch.column_by_name(name).ok_or_else(|| {
        validation(format!(
            "predictions.parquet is missing required column {name}"
        ))
    })?;
    if column.is_null(row) {
        return Err(validation(format!(
            "prediction column {name} must not contain nulls"
        )));
    }
    if let Some(values) = column.as_any().downcast_ref::<StringArray>() {
        return Ok(values.value(row).to_owned());
    }
    if let Some(values) = column.as_any().downcast_ref::<LargeStringArray>() {
        return Ok(values.value(row).to_owned());
    }
    Err(validation(format!(
        "predictions.parquet column {name} must be a UTF-8 string"
    )))
}

fn required_bool(batch: &RecordBatch, name: &str, row: usize) -> Result<bool> {
    let values = required_column::<BooleanArray>(batch, name)?;
    if values.is_null(row) {
        return Err(validation(format!(
            "prediction column {name} must not contain nulls"
        )));
    }
    Ok(values.value(row))
}

fn required_i64_column(batch: &RecordBatch, name: &str, row: usize) -> Result<i64> {
    let values = required_column::<Int64Array>(batch, name)?;
    if values.is_null(row) {
        return Err(validation(format!(
            "prediction column {name} must not contain nulls"
        )));
    }
    Ok(values.value(row))
}

fn optional_f64_column(batch: &RecordBatch, name: &str, row: usize) -> Result<Option<f64>> {
    let values = required_column::<Float64Array>(batch, name)?;
    Ok((!values.is_null(row)).then(|| values.value(row)))
}

fn required_list_f64(batch: &RecordBatch, name: &str, row: usize) -> Result<Vec<f64>> {
    let values = required_list_value(batch, name, row)?;
    let values = values
        .as_any()
        .downcast_ref::<Float64Array>()
        .ok_or_else(|| validation(format!("prediction column {name} must be list<float64>")))?;
    if values.null_count() != 0 {
        return Err(validation(format!(
            "prediction column {name} list values must not contain nulls",
        )));
    }
    Ok((0..values.len()).map(|index| values.value(index)).collect())
}

fn required_list_i64(batch: &RecordBatch, name: &str, row: usize) -> Result<Vec<i64>> {
    let values = required_list_value(batch, name, row)?;
    let values = values
        .as_any()
        .downcast_ref::<Int64Array>()
        .ok_or_else(|| validation(format!("prediction column {name} must be list<int64>")))?;
    if values.null_count() != 0 {
        return Err(validation(format!(
            "prediction column {name} list values must not contain nulls",
        )));
    }
    Ok((0..values.len()).map(|index| values.value(index)).collect())
}

fn optional_list_string(
    batch: &RecordBatch,
    name: &str,
    row: usize,
) -> Result<Option<Vec<String>>> {
    if batch.column_by_name(name).is_none() {
        return Ok(None);
    }
    required_list_string(batch, name, row).map(Some)
}

fn required_list_string(batch: &RecordBatch, name: &str, row: usize) -> Result<Vec<String>> {
    let values = required_list_value(batch, name, row)?;
    if let Some(values) = values.as_any().downcast_ref::<StringArray>() {
        if values.null_count() != 0 {
            return Err(validation(format!(
                "prediction column {name} list values must not contain nulls",
            )));
        }
        return Ok((0..values.len())
            .map(|index| values.value(index).to_owned())
            .collect());
    }
    if let Some(values) = values.as_any().downcast_ref::<LargeStringArray>() {
        if values.null_count() != 0 {
            return Err(validation(format!(
                "prediction column {name} list values must not contain nulls",
            )));
        }
        return Ok((0..values.len())
            .map(|index| values.value(index).to_owned())
            .collect());
    }
    Err(validation(format!(
        "prediction column {name} must be list<UTF-8 string>"
    )))
}

fn required_list_value(
    batch: &RecordBatch,
    name: &str,
    row: usize,
) -> Result<arrow_array::ArrayRef> {
    let column = batch.column_by_name(name).ok_or_else(|| {
        validation(format!(
            "predictions.parquet is missing required column {name}"
        ))
    })?;
    if column.is_null(row) {
        return Err(validation(format!(
            "prediction column {name} must not contain nulls"
        )));
    }
    if let Some(list) = column.as_any().downcast_ref::<ListArray>() {
        return Ok(list.value(row));
    }
    if let Some(list) = column.as_any().downcast_ref::<LargeListArray>() {
        return Ok(list.value(row));
    }
    Err(validation(format!(
        "predictions.parquet column {name} must be a list array"
    )))
}

fn required_column<'a, T: 'static>(batch: &'a RecordBatch, name: &str) -> Result<&'a T> {
    let column = batch.column_by_name(name).ok_or_else(|| {
        validation(format!(
            "predictions.parquet is missing required column {name}"
        ))
    })?;
    column.as_any().downcast_ref::<T>().ok_or_else(|| {
        validation(format!(
            "predictions.parquet column {name} has an unexpected Arrow type",
        ))
    })
}

fn parse_object(text: &str, label: &str) -> Result<Map<String, Value>> {
    serde_json::from_str::<Value>(text)
        .map_err(|error| validation(format!("{label} is not valid JSON: {error}")))?
        .as_object()
        .cloned()
        .ok_or_else(|| validation(format!("{label} must be a JSON object")))
}

fn parse_string_list(text: &str, label: &str) -> Result<Vec<String>> {
    serde_json::from_str::<Value>(text)
        .map_err(|error| validation(format!("{label} is not valid JSON: {error}")))?
        .as_array()
        .ok_or_else(|| validation(format!("{label} must be a JSON array")))?
        .iter()
        .map(|value| {
            value
                .as_str()
                .map(ToOwned::to_owned)
                .ok_or_else(|| validation(format!("{label} must contain only strings")))
        })
        .collect()
}

fn required_object<'a>(value: &'a Value, label: &str) -> Result<&'a Map<String, Value>> {
    value
        .as_object()
        .ok_or_else(|| validation(format!("{label} must be a JSON object")))
}

fn required_string<'a>(object: &'a Map<String, Value>, key: &str, label: &str) -> Result<&'a str> {
    object
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| validation(format!("{label}.{key} must be a string")))
}

fn required_i64(object: &Map<String, Value>, key: &str, label: &str) -> Result<i64> {
    object
        .get(key)
        .and_then(Value::as_i64)
        .ok_or_else(|| validation(format!("{label}.{key} must be an integer")))
}

/// SHA-256 of the canonical ScoreSet JSON used by the native V2 manifest.
///
/// This preserves Python JSON float notation and integer/float identity, so
/// host facades can construct manifests without duplicating the serializer.
pub fn score_set_hash(score_set: &Value) -> String {
    let canonical = canonical_json(score_set);
    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    format!("{:x}", hasher.finalize())
}

// Python json.dumps uses repr's exponent notation (including sign and two
// digits) outside [1e-4, 1e16). Both encoders use the shortest round-tripping
// binary64 digits; only their notation thresholds differ.
fn python_float_json(value: f64) -> String {
    let text = serde_json::Number::from_f64(value)
        .expect("finite JSON number")
        .to_string();
    let absolute = value.abs();
    if absolute == 0.0 {
        return text;
    }
    let scientific = !(1e-4..1e16).contains(&absolute);
    let (mantissa, exponent) = if let Some((mantissa, exponent)) = text.split_once('e') {
        (
            mantissa.to_string(),
            exponent.parse::<i32>().expect("JSON exponent"),
        )
    } else {
        let negative = text.starts_with('-');
        let unsigned = text.trim_start_matches('-');
        let decimal = unsigned.find('.').unwrap_or(unsigned.len());
        let digits = unsigned.replace('.', "");
        let first = digits.find(|ch| ch != '0').expect("nonzero float");
        let significant = digits[first..].trim_end_matches('0');
        let mantissa = if significant.len() == 1 {
            significant.to_string()
        } else {
            format!("{}.{}", &significant[..1], &significant[1..])
        };
        (
            format!("{}{mantissa}", if negative { "-" } else { "" }),
            decimal as i32 - first as i32 - 1,
        )
    };
    if scientific {
        format!("{}e{exponent:+03}", mantissa.trim_end_matches(".0"))
    } else if text.contains('e') {
        let negative = mantissa.starts_with('-');
        let digits = mantissa.trim_start_matches('-').replace('.', "");
        let decimal = exponent + 1;
        let fixed = if decimal <= 0 {
            format!("0.{}{digits}", "0".repeat((-decimal) as usize))
        } else if decimal as usize >= digits.len() {
            format!(
                "{}{}.0",
                digits,
                "0".repeat(decimal as usize - digits.len())
            )
        } else {
            format!(
                "{}.{}",
                &digits[..decimal as usize],
                &digits[decimal as usize..]
            )
        };
        format!("{}{fixed}", if negative { "-" } else { "" })
    } else {
        text
    }
}

fn canonical_json(value: &Value) -> String {
    match value {
        Value::Null => "null".to_owned(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) if value.is_f64() => {
            python_float_json(value.as_f64().expect("binary64 number"))
        }
        Value::Number(value) => value.to_string(),
        Value::String(value) => {
            serde_json::to_string(value).expect("string serialization cannot fail")
        }
        Value::Array(values) => {
            let body = values
                .iter()
                .map(canonical_json)
                .collect::<Vec<_>>()
                .join(",");
            format!("[{body}]")
        }
        Value::Object(values) => {
            let mut keys = values.keys().collect::<Vec<_>>();
            keys.sort_unstable();
            let body = keys
                .into_iter()
                .map(|key| {
                    let quoted_key =
                        serde_json::to_string(key).expect("string serialization cannot fail");
                    let value = values
                        .get(key)
                        .expect("object keys must resolve to their values");
                    format!("{quoted_key}:{}", canonical_json(value))
                })
                .collect::<Vec<_>>()
                .join(",");
            format!("{{{body}}}")
        }
    }
}

fn validation(message: impl Into<String>) -> NativeResultsError {
    NativeResultsError::Validation(message.into())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::Arc;
    use std::time::{SystemTime, UNIX_EPOCH};

    use arrow_array::builder::{Float64Builder, Int64Builder, ListBuilder};
    use arrow_array::{ArrayRef, BooleanArray, Float64Array, Int64Array, RecordBatch, StringArray};
    use arrow_schema::{DataType, Field, Schema};
    use parquet::arrow::ArrowWriter;
    use serde_json::{json, Value};

    use super::{
        read_native_results, score_set_hash, write_native_results, NativeResultsError,
        PREDICTIONS_FILENAME,
    };

    #[test]
    fn float_hash_encoding_matches_python_json_at_notation_boundaries() {
        // Expected strings are produced by CPython json.dumps for binary64 inputs.
        for (value, expected) in [
            (1e-6, "1e-06"),
            (-1e-6, "-1e-06"),
            (1e-4, "0.0001"),
            (1e16, "1e+16"),
            (1e20, "1e+20"),
            (1.0, "1.0"),
            (-0.0, "-0.0"),
            (1.2345678901234567e-12, "1.2345678901234567e-12"),
        ] {
            assert_eq!(super::canonical_json(&json!(value)), expected);
        }
        assert_eq!(super::canonical_json(&json!(1)), "1");
    }

    #[test]
    fn reads_a_valid_v2_native_results_directory() {
        let fixture = Fixture::new();
        let view = read_native_results(fixture.path()).expect("valid results should read");

        assert_eq!(view.score_set["variants"]["base"]["score"], 0.42);
        assert_eq!(view.predictions.len(), 1);
        assert_eq!(view.predictions[0].y_pred, vec![0.1, 0.9]);
        assert_eq!(view.predictions[0].target_names, vec!["y"]);
        assert_eq!(view.predictions[0].sample_ids, None);
        assert_eq!(view.predictions[0].val_score, Some(0.42));
    }

    #[test]
    fn score_set_canonicalization_matches_the_python_producer() {
        let score_set = json!({
            "z": {"label": "élévation", "items": [true, null, 1.0, 0.42]},
            "a": {"nested": {"value": -3.5}},
        });

        assert_eq!(
            super::canonical_json(&score_set),
            r#"{"a":{"nested":{"value":-3.5}},"z":{"items":[true,null,1.0,0.42],"label":"élévation"}}"#,
        );
        assert_eq!(
            score_set_hash(&score_set),
            "f105f5e3c11924a7fff99bc2e613f7a6951819848369a0e70e4704566abc7603",
        );
    }

    #[test]
    fn refuses_a_score_set_hash_mismatch() {
        let fixture = Fixture::new();
        fs::write(fixture.path().join("score_set.json"), r#"{"changed":true}"#)
            .expect("fixture score set should be writable");

        assert_validation(read_native_results(fixture.path()), "score_set_hash");
    }

    #[test]
    fn refuses_manifest_redirects_instead_of_following_them() {
        let fixture = Fixture::new();
        let mut manifest = fixture.manifest();
        manifest["files"]["predictions"] = json!("../outside.parquet");
        fixture.write_manifest(&manifest);

        assert_validation(
            read_native_results(fixture.path()),
            "manifest.files.predictions",
        );
    }

    #[test]
    fn refuses_missing_or_wrong_prediction_columns() {
        let fixture = Fixture::new();
        write_predictions(&fixture.path().join(PREDICTIONS_FILENAME), false, false);
        assert_validation(
            read_native_results(fixture.path()),
            "missing required column target_names",
        );

        write_predictions(&fixture.path().join(PREDICTIONS_FILENAME), true, true);
        assert_validation(read_native_results(fixture.path()), "unexpected Arrow type");
    }

    #[test]
    fn refuses_malformed_row_json() {
        let fixture = Fixture::new();
        write_predictions_with_scores(&fixture.path().join(PREDICTIONS_FILENAME), "not-json");

        assert_validation(
            read_native_results(fixture.path()),
            "scores is not valid JSON",
        );
    }

    #[test]
    fn writes_a_reader_validated_v2_native_results_directory() {
        let fixture = Fixture::new();
        let source = read_native_results(fixture.path()).expect("fixture must read");
        let output = fixture.path().join("writer-output");
        fs::create_dir(&output).expect("output directory should be created");

        write_native_results(
            &output,
            source.manifest.clone(),
            source.score_set.clone(),
            source.predictions.clone(),
        )
        .expect("writer should accept its reader's validated view");

        let round_trip = read_native_results(&output).expect("writer output must read");
        assert_eq!(round_trip, source);
        assert_validation(
            write_native_results(
                &output,
                source.manifest,
                source.score_set,
                source.predictions,
            ),
            "refuses to overwrite",
        );
    }

    #[test]
    fn reads_real_zstd_compressed_parquet_without_changing_native_results() {
        let fixture = Fixture::new();
        let expected = read_native_results(fixture.path()).expect("fixture must read");
        let original = fs::File::open(fixture.path().join(PREDICTIONS_FILENAME)).unwrap();
        let reader =
            parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder::try_new(original)
                .unwrap();
        let schema = Arc::clone(reader.schema());
        let batches = reader
            .build()
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        let compressed_path = fixture.path().join("zstd-predictions.parquet");
        let props = parquet::file::properties::WriterProperties::builder()
            .set_compression(parquet::basic::Compression::ZSTD(
                parquet::basic::ZstdLevel::default(),
            ))
            .build();
        let mut writer = ArrowWriter::try_new(
            fs::File::create(&compressed_path).unwrap(),
            schema,
            Some(props),
        )
        .unwrap();
        for batch in batches {
            writer.write(&batch).unwrap();
        }
        writer.close().unwrap();
        let reader = parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder::try_new(
            fs::File::open(&compressed_path).unwrap(),
        )
        .unwrap();
        assert!(reader
            .metadata()
            .row_groups()
            .iter()
            .flat_map(|group| group.columns())
            .all(|column| matches!(column.compression(), parquet::basic::Compression::ZSTD(_))));
        drop(reader);
        fs::rename(compressed_path, fixture.path().join(PREDICTIONS_FILENAME)).unwrap();
        assert_eq!(read_native_results(fixture.path()).unwrap(), expected);
    }

    #[test]
    fn writer_rejects_misaligned_sample_ids_before_writing() {
        let fixture = Fixture::new();
        let source = read_native_results(fixture.path()).expect("fixture must read");
        let output = fixture.path().join("invalid-writer-output");
        fs::create_dir(&output).expect("output directory should be created");
        let mut rows = source.predictions;
        rows[0].sample_ids = Some(vec!["only-one".to_owned()]);

        assert_validation(
            write_native_results(&output, source.manifest, source.score_set, rows),
            "sample_ids",
        );
        assert!(fs::read_dir(output).unwrap().next().is_none());
    }

    #[test]
    fn concurrent_writers_publish_exactly_one_complete_result() {
        let fixture = Fixture::new();
        let source = read_native_results(fixture.path()).unwrap();
        let output = fixture.path().join("concurrent-writers");
        fs::create_dir(&output).unwrap();
        let barrier = std::sync::Barrier::new(8);
        let successes = std::thread::scope(|scope| {
            let workers = (0..8)
                .map(|writer| {
                    let source = &source;
                    let output = &output;
                    let barrier = &barrier;
                    scope.spawn(move || {
                        let score_set = json!({"writer": writer});
                        let mut manifest = source.manifest.clone();
                        manifest["score_set_hash"] = json!(score_set_hash(&score_set));
                        barrier.wait();
                        write_native_results(
                            output,
                            manifest,
                            score_set,
                            source.predictions.clone(),
                        )
                        .is_ok()
                    })
                })
                .collect::<Vec<_>>();
            workers
                .into_iter()
                .map(|worker| usize::from(worker.join().unwrap()))
                .sum::<usize>()
        });
        assert_eq!(successes, 1);
        read_native_results(&output).expect("winner must publish a complete readable result");
        assert_eq!(fs::read_dir(output).unwrap().count(), 3);
    }

    #[test]
    fn publication_error_rolls_back_only_this_writers_files() {
        let fixture = Fixture::new();
        let output = fixture.path().join("rollback-writer");
        fs::create_dir(&output).unwrap();
        let temporary =
            ["manifest.tmp", "scores.tmp", "predictions.tmp"].map(|name| output.join(name));
        let destinations = [
            super::MANIFEST_FILENAME,
            "score_set.json",
            PREDICTIONS_FILENAME,
        ]
        .map(|name| output.join(name));
        for path in &temporary {
            fs::write(path, b"new").unwrap();
        }
        fs::write(&destinations[0], b"existing manifest").unwrap();
        super::publish_result_files(&temporary, &destinations).unwrap_err();
        assert_eq!(fs::read(&destinations[0]).unwrap(), b"existing manifest");
        assert!(!destinations[1].exists());
        assert!(!destinations[2].exists());
    }

    #[test]
    fn interrupted_writer_reservation_is_never_stolen() {
        let fixture = Fixture::new();
        let source = read_native_results(fixture.path()).unwrap();
        let output = fixture.path().join("interrupted-writer");
        fs::create_dir(&output).unwrap();
        let reservation = output.join(super::WRITER_RESERVATION_FILENAME);
        fs::write(&reservation, b"reserved by another process").unwrap();
        assert_validation(
            write_native_results(
                &output,
                source.manifest,
                source.score_set,
                source.predictions,
            ),
            "writer reservation",
        );
        assert_eq!(
            fs::read(reservation).unwrap(),
            b"reserved by another process"
        );
        assert_eq!(fs::read_dir(output).unwrap().count(), 1);
    }

    #[test]
    #[ignore = "requires DAG_ML_RESULTS_PYTHON_FIXTURE written by the Python producer"]
    fn reads_a_python_produced_results_directory() {
        let path = std::env::var("DAG_ML_RESULTS_PYTHON_FIXTURE")
            .expect("the ignored interoperability test requires DAG_ML_RESULTS_PYTHON_FIXTURE");
        let view = read_native_results(path).expect("the Python producer output must be readable");

        assert!(view.score_set.is_object());
        assert!(!view.predictions.is_empty());
        assert_eq!(view.predictions[0].sample_ids, Some(Vec::new()));
    }

    fn assert_validation<T: std::fmt::Debug>(result: super::Result<T>, expected: &str) {
        let error = result.expect_err("fixture must be rejected");
        let NativeResultsError::Validation(message) = error else {
            panic!("expected a validation error");
        };
        assert!(
            message.contains(expected),
            "{message} did not contain {expected}"
        );
    }

    struct Fixture {
        directory: std::path::PathBuf,
        score_set: Value,
    }

    impl Fixture {
        fn new() -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("time must be after epoch")
                .as_nanos();
            let directory = std::env::temp_dir().join(format!("dag-ml-results-{nonce}"));
            fs::create_dir(&directory).expect("fixture directory should be created");
            let score_set = json!({"variants": {"base": {"score": 0.42}}, "plan_id": "p1"});
            let fixture = Self {
                directory,
                score_set,
            };
            fixture.write_manifest(&fixture.manifest());
            fs::write(
                fixture.path().join("score_set.json"),
                super::canonical_json(&fixture.score_set),
            )
            .expect("fixture score set should be written");
            write_predictions(&fixture.path().join(PREDICTIONS_FILENAME), true, false);
            fixture
        }

        fn path(&self) -> &std::path::Path {
            &self.directory
        }

        fn manifest(&self) -> Value {
            json!({
                "schema_version": 2,
                "engine": "dag-ml",
                "score_set_hash": score_set_hash(&self.score_set),
                "files": {
                    "score_set": "score_set.json",
                    "predictions": "predictions.parquet",
                },
                "artifacts": [{"uri": "../never-opened.joblib"}],
            })
        }

        fn write_manifest(&self, manifest: &Value) {
            fs::write(
                self.path().join("manifest.json"),
                serde_json::to_vec(manifest).expect("fixture manifest should serialize"),
            )
            .expect("fixture manifest should be written");
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.directory);
        }
    }

    fn write_predictions(
        path: &std::path::Path,
        include_target_names: bool,
        wrong_target_width: bool,
    ) {
        write_prediction_batch(
            path,
            include_target_names,
            wrong_target_width,
            r#"{"rmse":0.1}"#,
        );
    }

    fn write_predictions_with_scores(path: &std::path::Path, scores: &str) {
        write_prediction_batch(path, true, false, scores);
    }

    fn write_prediction_batch(
        path: &std::path::Path,
        include_target_names: bool,
        wrong_target_width: bool,
        scores: &str,
    ) {
        let mut fields = vec![
            Field::new("dataset", DataType::Utf8, false),
            Field::new("config_name", DataType::Utf8, false),
            Field::new("variant_id", DataType::Utf8, false),
            Field::new("model_name", DataType::Utf8, false),
            Field::new("partition", DataType::Utf8, false),
            Field::new("fold_id", DataType::Utf8, false),
            Field::new("refit_context", DataType::Utf8, false),
            list_field("sample_indices", DataType::Int64),
            list_field("y_true", DataType::Float64),
            list_field("y_pred", DataType::Float64),
            list_field("y_proba", DataType::Float64),
            list_field("y_true_shape", DataType::Int64),
            list_field("y_pred_shape", DataType::Int64),
            list_field("y_proba_shape", DataType::Int64),
            list_field("weights", DataType::Float64),
            Field::new("arrays_present", DataType::Boolean, false),
            Field::new("val_score", DataType::Float64, true),
            Field::new("test_score", DataType::Float64, true),
            Field::new("train_score", DataType::Float64, true),
            Field::new("scores", DataType::Utf8, false),
            Field::new("metric", DataType::Utf8, false),
            Field::new("task_type", DataType::Utf8, false),
            Field::new(
                "target_width",
                if wrong_target_width {
                    DataType::Utf8
                } else {
                    DataType::Int64
                },
                false,
            ),
        ];
        let mut columns: Vec<ArrayRef> = vec![
            Arc::new(StringArray::from(vec!["dataset"])),
            Arc::new(StringArray::from(vec!["base"])),
            Arc::new(StringArray::from(vec!["base"])),
            Arc::new(StringArray::from(vec!["model"])),
            Arc::new(StringArray::from(vec!["validation"])),
            Arc::new(StringArray::from(vec!["0"])),
            Arc::new(StringArray::from(vec![""])),
            list_i64(&[0, 1]),
            list_f64(&[1.0, 2.0]),
            list_f64(&[0.1, 0.9]),
            list_f64(&[]),
            list_i64(&[2]),
            list_i64(&[2]),
            list_i64(&[]),
            list_f64(&[]),
            Arc::new(BooleanArray::from(vec![true])),
            Arc::new(Float64Array::from(vec![Some(0.42)])),
            Arc::new(Float64Array::from(vec![Option::<f64>::None])),
            Arc::new(Float64Array::from(vec![Option::<f64>::None])),
            Arc::new(StringArray::from(vec![scores])),
            Arc::new(StringArray::from(vec!["rmse"])),
            Arc::new(StringArray::from(vec!["regression"])),
        ];
        if wrong_target_width {
            columns.push(Arc::new(StringArray::from(vec!["1"])));
        } else {
            columns.push(Arc::new(Int64Array::from(vec![1])));
        }
        if include_target_names {
            fields.push(Field::new("target_names", DataType::Utf8, false));
            columns.push(Arc::new(StringArray::from(vec![r#"["y"]"#])));
        }

        let schema = Arc::new(Schema::new(fields));
        let batch = RecordBatch::try_new(Arc::clone(&schema), columns)
            .expect("fixture record batch should be valid");
        let file = fs::File::create(path).expect("fixture parquet should be created");
        let mut writer =
            ArrowWriter::try_new(file, schema, None).expect("fixture writer should open");
        writer.write(&batch).expect("fixture batch should write");
        writer.close().expect("fixture writer should close");
    }

    fn list_field(name: &str, value_type: DataType) -> Field {
        Field::new(
            name,
            DataType::List(Arc::new(Field::new("item", value_type, true))),
            false,
        )
    }

    fn list_f64(values: &[f64]) -> ArrayRef {
        let mut builder = ListBuilder::new(Float64Builder::new());
        for value in values {
            builder.values().append_value(*value);
        }
        builder.append(true);
        Arc::new(builder.finish())
    }

    fn list_i64(values: &[i64]) -> ArrayRef {
        let mut builder = ListBuilder::new(Int64Builder::new());
        for value in values {
            builder.values().append_value(*value);
        }
        builder.append(true);
        Arc::new(builder.finish())
    }
}
