// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Assemble a DatasetSpec into a target-agnostic dataset (ports `materialize/assemble.py`).
//!
//! Per source: load → merge multi-file → split columns by role. Then per
//! partition: align feature sources (multi-source X), join targets/metadata/
//! lookups onto the sample rows, collect X/y/metadata/weights. The result is an
//! `AssembledDataset` IR that `to_spectrodataset`/`to_dag_ml_data` adapt — kept
//! target-agnostic so assembly is testable without nirs4all.
//!
//! This module is fs-free. Inputs arrive as named in-memory payloads
//! ([`InMemorySource`]): tabular bytes the facade already read (and decompressed)
//! or pre-decoded `nirs4all-formats` records. The facade resolves paths, reads
//! files, reads index files and fold files, then delegates to
//! [`assemble_in_memory`] so a single assembly core backs both the native (path)
//! and the browser (no-fs) paths (D-R4 / D-R7).

use std::collections::{HashMap, HashSet};

use crate::conventions::engine::get_stem;
use crate::spec::dataset_spec::{
    AggregateSpec, DatasetSpec, JoinSpec, LoadingParams, SourceSpec, VariationSpec,
};
use crate::spec::enums::{
    Cardinality, Coverage, MergeMode, PartitionBy, Role, SourceKind, UnknownPolicy,
};
use crate::spec::selectors::Selector;
use crate::spec::SpecError;
use indexmap::IndexMap;
use serde_json::{Map, Value};

use super::folds::Fold;
use super::frame::{Cell, Column, Frame, Matrix};
use super::join::{concat_features, concat_samples, join_tables, merge_by_key};
use super::loaders::{apply_na_policy, effective_params, read_table_bytes};

/// A source payload supplied in-memory instead of a file path.
pub enum SourcePayload {
    /// Raw CSV/tabular bytes the formats layer won't decode (y/metadata tables).
    Bytes(Vec<u8>),
    /// A facade-decoded typed table for formats that need filesystem-backed
    /// native loaders (for example Parquet).
    Frame(Frame),
    /// Pre-decoded nirs4all-formats records (signals[].values=X, targets{}, metadata{}).
    Records(Vec<Value>),
}

/// A named in-memory source. `name` matches a `source.input` string / list /
/// glob-expansion entry (by exact, then file-stem, then glob match).
pub struct InMemorySource {
    pub name: String,
    pub payload: SourcePayload,
}

fn row_idx_col(source_id: &str) -> String {
    format!("__src_row_idx__{source_id}__")
}

/// `(frame, header_unit, signal_type, origins)` from a source's load.
type LoadedSource = (Frame, String, Option<String>, Option<Vec<String>>);

/// Version of the JSON-compatible `AssembledDataset` summary/full wire.
///
/// Version 1 was unversioned and did not preserve source ids, scientific
/// identity, or stable fold provenance. Consumers must reject it rather than
/// silently interpreting it as this version.
pub const ASSEMBLED_DATASET_VERSION: u32 = 2;

#[derive(Debug, Clone, Default)]
pub struct PartitionBlock {
    pub n_samples: usize,
    /// Feature-source ids aligned with `x` and its per-source layout fields.
    pub source_ids: Vec<String>,
    pub x: Vec<Matrix>,
    pub feature_headers: Vec<Vec<String>>,
    pub header_units: Vec<String>,
    pub signal_types: Vec<Option<String>>,
    pub processings: Vec<Vec<(String, Matrix)>>,
    pub y: Option<Matrix>,
    pub y_headers: Vec<String>,
    pub y_categorical: IndexMap<String, Value>,
    pub metadata: Option<Frame>,
    pub weights: Option<Vec<f32>>,
    pub weights_header: Option<String>,
}

/// Column-level scientific identity provenance retained from `sample_index`.
///
/// The assembled matrices do not otherwise retain the `DatasetSpec`, so the
/// dag-ml bridge needs these names to recover the corresponding, sample-aligned
/// metadata values without guessing from row order. `sample_id` is only set for
/// a scalar `sample_index.key`; composite keys are deliberately left unsupported
/// at this v1 seam rather than serialised into an invented identifier.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct IdentityProvenance {
    /// Ordered feature-source ids contributing to every assembled row.
    pub source_ids: Vec<String>,
    pub sample_id: Option<String>,
    pub observation_id: Option<String>,
    pub repetition_id: Option<String>,
    pub group_id: Option<String>,
}

/// Fold membership translated to stable observation ids before partitioning can
/// reorder assembled rows. Empty provenance with non-empty positional folds
/// means the v1 assembler could not establish that translation.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FoldProvenance {
    pub train_observation_ids: Vec<String>,
    pub validation_observation_ids: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct AssembledDataset {
    pub name: String,
    pub task_type: String,
    pub signal_type: String,
    pub n_sources: usize,
    pub blocks: IndexMap<String, PartitionBlock>,
    pub folds: Vec<Fold>,
    pub fold_provenance: Vec<FoldProvenance>,
    pub repetition: Option<String>,
    /// Scientific identity columns carried from `DatasetSpec.sample_index`.
    pub identity: IdentityProvenance,
    pub aggregate: Option<AggregateSpec>,
    pub warnings: Vec<String>,
    pub audits: Vec<Value>,
}

impl AssembledDataset {
    /// A canonical structural summary (shapes, headers, partitions, rounded
    /// X/y values, folds) for cross-language golden comparison. The explicit
    /// `assembled_schema_version` makes this public CLI/C-ABI artifact distinct
    /// from the `DatasetSpec` schema and rejects the former unversioned wire.
    /// Mirrors
    /// `tests/test_assembled_goldens.py`.
    pub fn to_summary_value(&self) -> Value {
        use crate::pyfmt::py_round;
        let mat_rows = |m: &Matrix| -> Value {
            Value::Array(
                (0..m.n_rows)
                    .map(|r| {
                        Value::Array(
                            m.data[r * m.n_cols..(r + 1) * m.n_cols]
                                .iter()
                                .map(|&v| Value::from(py_round(v as f64, 4)))
                                .collect(),
                        )
                    })
                    .collect(),
            )
        };
        let mut blocks = Map::new();
        for (part, b) in &self.blocks {
            blocks.insert(
                part.clone(),
                serde_json::json!({
                    "n_samples": b.n_samples,
                    "source_ids": b.source_ids,
                    "x_shapes": b.x.iter().map(|m| vec![m.n_rows, m.n_cols]).collect::<Vec<_>>(),
                    "x": b.x.iter().map(mat_rows).collect::<Vec<_>>(),
                    "feature_headers": b.feature_headers,
                    "header_units": b.header_units,
                    "signal_types": b.signal_types,
                    "y_shape": b.y.as_ref().map(|m| vec![m.n_rows, m.n_cols]),
                    "y": b.y.as_ref().map(mat_rows),
                    "y_headers": b.y_headers,
                    "y_categorical": b.y_categorical,
                    "metadata_columns": b.metadata.as_ref().map(|f| f.column_names()).unwrap_or_default(),
                    "weights_header": b.weights_header,
                    "processings": b.processings.iter().map(|src| src.iter().map(|(n, _)| n.clone()).collect::<Vec<_>>()).collect::<Vec<_>>(),
                }),
            );
        }
        let aggregate = self.aggregate.as_ref().map(|a| {
            serde_json::json!({
                "by": a.by,
                "method": a.method.value(),
                "exclude_outliers": a.exclude_outliers,
                "outlier_threshold": a.outlier_threshold,
            })
        });
        serde_json::json!({
            "assembled_schema_version": ASSEMBLED_DATASET_VERSION,
            "name": self.name,
            "task_type": self.task_type,
            "signal_type": self.signal_type,
            "n_sources": self.n_sources,
            "blocks": Value::Object(blocks),
            "folds": self.folds.iter().map(|(tr, vl)| vec![tr.clone(), vl.clone()]).collect::<Vec<_>>(),
            "fold_provenance": self.fold_provenance.iter().map(|fold| serde_json::json!({
                "train_observation_ids": fold.train_observation_ids,
                "validation_observation_ids": fold.validation_observation_ids,
            })).collect::<Vec<_>>(),
            "identity": { "provenance": identity_provenance_value(&self.identity) },
            "repetition": self.repetition,
            "aggregate": aggregate,
        })
    }

    /// Full-precision export for the binding-side SpectroDataset adapter. Unlike
    /// `to_summary_value` (a rounded structural fingerprint), this carries the
    /// complete X/y/processing matrices (flat f64 + shape), metadata column
    /// values, weights, and folds — everything `to_spectrodataset` needs to
    /// rebuild a `SpectroDataset` from the materialized data.
    pub fn to_full_value(&self) -> Value {
        let mut blocks = Map::new();
        for (part, b) in &self.blocks {
            blocks.insert(
                part.clone(),
                serde_json::json!({
                    "n_samples": b.n_samples,
                    "source_ids": b.source_ids,
                    "x": b.x.iter().map(matrix_full).collect::<Vec<_>>(),
                    "feature_headers": b.feature_headers,
                    "header_units": b.header_units,
                    "signal_types": b.signal_types,
                    "y": b.y.as_ref().map(matrix_full),
                    "y_headers": b.y_headers,
                    "y_categorical": b.y_categorical,
                    "metadata": b.metadata.as_ref().map(frame_full),
                    "weights": b.weights,
                    "weights_header": b.weights_header,
                    "processings": b.processings.iter().map(|src| {
                        src.iter()
                            .map(|(name, m)| serde_json::json!({"name": name, "matrix": matrix_full(m)}))
                            .collect::<Vec<_>>()
                    }).collect::<Vec<_>>(),
                }),
            );
        }
        let aggregate = self.aggregate.as_ref().map(|a| {
            serde_json::json!({
                "by": a.by,
                "method": a.method.value(),
                "exclude_outliers": a.exclude_outliers,
                "outlier_threshold": a.outlier_threshold,
            })
        });
        serde_json::json!({
            "assembled_schema_version": ASSEMBLED_DATASET_VERSION,
            "name": self.name,
            "task_type": self.task_type,
            "signal_type": self.signal_type,
            "n_sources": self.n_sources,
            "blocks": Value::Object(blocks),
            "folds": self.folds.iter().map(|(tr, vl)| vec![tr.clone(), vl.clone()]).collect::<Vec<_>>(),
            "fold_provenance": self.fold_provenance.iter().map(|fold| serde_json::json!({
                "train_observation_ids": fold.train_observation_ids,
                "validation_observation_ids": fold.validation_observation_ids,
            })).collect::<Vec<_>>(),
            "identity": { "provenance": identity_provenance_value(&self.identity) },
            "repetition": self.repetition,
            "aggregate": aggregate,
        })
    }
}

fn matrix_full(m: &Matrix) -> Value {
    serde_json::json!({
        "data": m.data.iter().map(|&v| v as f64).collect::<Vec<f64>>(),
        "n_rows": m.n_rows,
        "n_cols": m.n_cols,
    })
}

pub fn identity_provenance_value(identity: &IdentityProvenance) -> Value {
    serde_json::json!({
        "source_ids": identity.source_ids,
        "sample_id": identity.sample_id,
        "observation_id": identity.observation_id,
        "repetition_id": identity.repetition_id,
        "group_id": identity.group_id,
    })
}

fn cell_value(c: &Cell) -> Value {
    match c {
        Cell::Bool(b) => Value::from(*b),
        Cell::Int(i) => Value::from(*i),
        Cell::Float(f) => Value::from(*f),
        Cell::Str(s) => Value::from(s.clone()),
        Cell::Na => Value::Null,
    }
}

fn frame_full(f: &Frame) -> Value {
    let columns: Vec<Value> = f
        .columns
        .iter()
        .map(|c| serde_json::json!({"name": c.name, "values": c.values.iter().map(cell_value).collect::<Vec<_>>()}))
        .collect();
    serde_json::json!({ "n_rows": f.n_rows, "columns": columns })
}

struct SourceTable {
    source_id: String,
    df: Frame,
    /// column -> role, in `_split_roles` order.
    roles: Vec<(String, String)>,
    key: Option<Vec<String>>,
    partition: Option<String>,
    kind: String,
    join: Option<JoinSpec>,
    signal_type: Option<String>,
    header_unit: String,
    variations: Vec<(String, Matrix)>,
}

fn key_list(v: &Value) -> Option<Vec<String>> {
    match v {
        Value::String(s) => Some(vec![s.clone()]),
        Value::Array(a) => {
            let ks: Vec<String> = a
                .iter()
                .filter_map(|x| x.as_str().map(str::to_string))
                .collect();
            if ks.is_empty() {
                None
            } else {
                Some(ks)
            }
        }
        _ => None,
    }
}

fn is_glob(text: &str) -> bool {
    text.chars().any(|c| matches!(c, '*' | '?' | '['))
}

/// Filename portion of a name (path-separator agnostic).
fn basename(name: &str) -> &str {
    name.rsplit(['/', '\\']).next().unwrap_or(name)
}

/// Pure glob match (`*`, `?`, `[...]`) of `pattern` against `text`.
fn glob_match(pattern: &str, text: &str) -> bool {
    fn matches(p: &[char], t: &[char]) -> bool {
        let mut pi = 0;
        let mut ti = 0;
        let mut star: Option<(usize, usize)> = None;
        while ti < t.len() {
            if pi < p.len() {
                match p[pi] {
                    '*' => {
                        star = Some((pi, ti));
                        pi += 1;
                        continue;
                    }
                    '?' => {
                        pi += 1;
                        ti += 1;
                        continue;
                    }
                    '[' => {
                        if let Some((next_pi, ok)) = match_class(p, pi, t[ti]) {
                            if ok {
                                pi = next_pi;
                                ti += 1;
                                continue;
                            }
                        }
                    }
                    c if c == t[ti] => {
                        pi += 1;
                        ti += 1;
                        continue;
                    }
                    _ => {}
                }
            }
            if let Some((sp, st)) = star {
                pi = sp + 1;
                ti = st + 1;
                star = Some((sp, st + 1));
            } else {
                return false;
            }
        }
        while pi < p.len() && p[pi] == '*' {
            pi += 1;
        }
        pi == p.len()
    }
    fn match_class(p: &[char], start: usize, ch: char) -> Option<(usize, bool)> {
        let mut i = start + 1;
        let negate = i < p.len() && (p[i] == '!' || p[i] == '^');
        if negate {
            i += 1;
        }
        let mut matched = false;
        let mut first = true;
        while i < p.len() {
            if p[i] == ']' && !first {
                return Some((i + 1, matched != negate));
            }
            first = false;
            if i + 2 < p.len() && p[i + 1] == '-' && p[i + 2] != ']' {
                if ch >= p[i] && ch <= p[i + 2] {
                    matched = true;
                }
                i += 3;
            } else {
                if ch == p[i] {
                    matched = true;
                }
                i += 1;
            }
        }
        None
    }
    let pc: Vec<char> = pattern.chars().collect();
    let tc: Vec<char> = text.chars().collect();
    matches(&pc, &tc)
}

/// Resolve `input` against the named in-memory sources (replaces `resolve_inputs`).
///
/// Match each `source.input` entry by exact name, then file-stem, then — for a
/// glob entry — by glob match (Codex #2 / #4):
/// - A glob whose pattern contains a path separator matches against the full
///   source name; a separator-free glob matches against the source basename. This
///   mirrors the native `glob(base_dir.join(text))` path-scoping, so a feature
///   `spectra/*.csv` no longer also matches a sibling `meta.csv`. Glob matches are
///   deduped by resolved name (path), and sorted for stable order.
/// - Exact-name and file-stem fallbacks error on ambiguous duplicates instead of
///   silently picking the first source supplied.
fn resolve_inputs_mem<'a>(
    input: &Value,
    sources: &'a [InMemorySource],
) -> Result<Vec<&'a InMemorySource>, SpecError> {
    let items: Vec<&Value> = match input {
        Value::Array(a) => a.iter().collect(),
        other => vec![other],
    };
    let mut out: Vec<&InMemorySource> = Vec::new();
    let mut seen: HashSet<&str> = HashSet::new();
    for item in items {
        let Some(text) = item.as_str() else { continue };
        if is_glob(text) {
            let path_scoped = text.contains(['/', '\\']);
            let mut matched: Vec<&InMemorySource> = sources
                .iter()
                .filter(|s| {
                    if path_scoped {
                        glob_match(text, &s.name)
                    } else {
                        glob_match(text, basename(&s.name))
                    }
                })
                .collect();
            matched.sort_by(|a, b| a.name.cmp(&b.name));
            for s in matched {
                if seen.insert(s.name.as_str()) {
                    out.push(s);
                }
            }
        } else if let Some(s) = unique_match(text, sources, |s| s.name == text, "exact name")? {
            if seen.insert(s.name.as_str()) {
                out.push(s);
            }
        } else if let Some(s) = unique_match(
            text,
            sources,
            |s| get_stem(basename(&s.name)) == get_stem(basename(text)),
            "file-stem",
        )? {
            if seen.insert(s.name.as_str()) {
                out.push(s);
            }
        }
    }
    Ok(out)
}

/// Find the single source satisfying `pred`; error if more than one matches so an
/// ambiguous `input` (e.g. `scan` matching both `scan.csv` and `scan.asd`) is a
/// hard error rather than silent first-wins (Codex #4).
fn unique_match<'a>(
    text: &str,
    sources: &'a [InMemorySource],
    pred: impl Fn(&&'a InMemorySource) -> bool,
    how: &str,
) -> Result<Option<&'a InMemorySource>, SpecError> {
    let mut matched = sources.iter().filter(|s| pred(s));
    let Some(first) = matched.next() else {
        return Ok(None);
    };
    if let Some(second) = matched.next() {
        let mut names = vec![first.name.clone(), second.name.clone()];
        names.extend(matched.map(|s| s.name.clone()));
        return Err(SpecError::new(format!(
            "input '{text}' is ambiguous: matches {how} of multiple sources {names:?}"
        )));
    }
    Ok(Some(first))
}

/// Decode one in-memory source into a [`Frame`].
fn frame_from_source(src: &InMemorySource, params: &LoadingParams) -> Result<Frame, SpecError> {
    match &src.payload {
        SourcePayload::Bytes(bytes) => read_table_bytes(bytes, params),
        SourcePayload::Frame(frame) => frame_with_params(frame, params),
        SourcePayload::Records(records) => records_to_frame(records, params),
    }
}

fn frame_requested_columns(params: &LoadingParams) -> Result<Option<Vec<String>>, SpecError> {
    match params.format.values.get("columns") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(name)) => Ok(Some(vec![name.clone()])),
        Some(Value::Array(values)) => values
            .iter()
            .map(|value| {
                value.as_str().map(str::to_string).ok_or_else(|| {
                    SpecError::new("loading.format.columns must be a string or a list of strings")
                })
            })
            .collect::<Result<Vec<_>, _>>()
            .map(Some),
        Some(_) => Err(SpecError::new(
            "loading.format.columns must be a string or a list of strings",
        )),
    }
}

fn frame_with_params(frame: &Frame, params: &LoadingParams) -> Result<Frame, SpecError> {
    let mut out = if let Some(columns) = frame_requested_columns(params)? {
        for name in &columns {
            if !frame.has_column(name) {
                return Err(SpecError::new(format!(
                    "column name '{name}' not found; available: {:?}",
                    frame.column_names()
                )));
            }
        }
        frame.select(&columns)
    } else {
        frame.clone()
    };
    if let Some(unit) = params.header_unit {
        out.header_unit = unit.value().to_string();
    }
    apply_na_policy(&out, &params.na)
}

fn load_source_frame_mem(
    source: &SourceSpec,
    spec: &DatasetSpec,
    sources: &[InMemorySource],
    audits: &mut Vec<Value>,
) -> Result<LoadedSource, SpecError> {
    let params = effective_params(&spec.params, &source.params);
    let matched = resolve_inputs_mem(&source.input, sources)?;
    if matched.is_empty() {
        return Err(SpecError::new(format!(
            "source '{}': no input files resolved from {}",
            source.id,
            crate::pyfmt::py_repr(&source.input)
        )));
    }
    let frames: Vec<Frame> = matched
        .iter()
        .map(|s| frame_from_source(s, &params))
        .collect::<Result<_, _>>()?;
    let header_unit = frames[0].header_unit.clone();
    let signal = params.signal_type.map(|s| s.value().to_string());
    if frames.len() == 1 {
        return Ok((frames[0].clone(), header_unit, signal, None));
    }
    let names: Vec<String> = matched
        .iter()
        .map(|s| get_stem(basename(&s.name)))
        .collect();
    let (df, origins): (Frame, Option<Vec<String>>) = match source.merge {
        MergeMode::ConcatSamples => {
            let (df, origins, a) = concat_samples(&frames, &names);
            audits.push(serde_json::json!({"source": source.id, "merge": a.operation, "warnings": a.warnings}));
            (df, Some(origins))
        }
        MergeMode::ConcatFeatures => {
            let (df, a) = concat_features(&frames, &names, key_list(&source.key).as_deref())?;
            audits.push(serde_json::json!({"source": source.id, "merge": a.operation, "warnings": a.warnings}));
            (df, None)
        }
        MergeMode::ByKey => {
            let key = key_list(&source.key).ok_or_else(|| {
                SpecError::new(format!(
                    "source '{}': merge='by_key' requires a 'key'",
                    source.id
                ))
            })?;
            let (df, a) = merge_by_key(&frames, &names, &key, Coverage::Complete)?;
            audits.push(serde_json::json!({"source": source.id, "merge": a.operation, "warnings": a.warnings}));
            (df, None)
        }
        MergeMode::None => {
            return Err(SpecError::new(format!(
                "source '{}': multi-file input requires a merge mode",
                source.id
            )))
        }
    };
    Ok((df, header_unit, signal, origins))
}

/// Build a typed [`Frame`] from pre-decoded nirs4all-formats records.
///
/// - `signals[].values` → numeric feature columns, named by the signal's axis
///   labels (header_unit derived from `axis.unit`: nm / cm-1 / index).
/// - `targets{k:v}` → numeric or categorical columns named `k` (left as raw
///   cells so the assembler's `encode_categorical` applies the same rules as the
///   CSV path).
/// - `metadata{sample_id, partition, id, ...}` → string/key columns, so the
///   existing partition (`PartitionBy::Column`) and identity/join logic runs
///   unchanged. The formats-layer `row_index` provenance counter is dropped: it
///   carries no dataset meaning and its numeric "0","1",… cells would otherwise
///   be picked up as a phantom feature by the `auto` features selector.
fn records_to_frame(records: &[Value], params: &LoadingParams) -> Result<Frame, SpecError> {
    if records.is_empty() {
        return Ok(Frame {
            columns: vec![],
            n_rows: 0,
            header_unit: header_unit_from_axis(""),
        });
    }
    let n = records.len();
    let signal_name = params
        .format
        .values
        .get("signal")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    // Determine the feature axis from the first record that carries a signal.
    let mut feature_headers: Vec<String> = Vec::new();
    let mut axis_unit = String::new();
    for record in records {
        let Some(signals) = record.get("signals").and_then(Value::as_object) else {
            continue;
        };
        let Some((_, signal)) = pick_signal(signals, &signal_name) else {
            continue;
        };
        let values = signal_values(signal);
        if values.is_empty() {
            continue;
        }
        feature_headers = axis_labels_from_values(&signal_axis_values(signal), values.len());
        axis_unit = signal
            .get("axis")
            .and_then(|axis| axis.get("unit"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        break;
    }
    let n_features = feature_headers.len();

    // Feature columns (one per axis position): coerce each record's signal row.
    let mut feature_cells: Vec<Vec<Cell>> = vec![Vec::with_capacity(n); n_features];
    // Targets / metadata accumulate in first-appearance order across records.
    let mut target_order: Vec<String> = Vec::new();
    let mut target_cells: HashMap<String, Vec<Option<Value>>> = HashMap::new();
    let mut meta_order: Vec<String> = Vec::new();
    let mut meta_cells: HashMap<String, Vec<Option<String>>> = HashMap::new();

    for (row_idx, record) in records.iter().enumerate() {
        // features
        let row: Vec<f64> = record
            .get("signals")
            .and_then(Value::as_object)
            .and_then(|signals| pick_signal(signals, &signal_name).map(|(_, s)| signal_values(s)))
            .unwrap_or_default();
        // A record that carries a signal must match the established feature axis
        // exactly; silently truncating/padding a variable-length signal would corrupt
        // X (Codex #5). An absent signal (empty row) is left as a NaN feature row.
        if !row.is_empty() && row.len() != n_features {
            return Err(SpecError::new(format!(
                "decoded record {row_idx}: signal has {} value(s) but the feature axis is {n_features} wide",
                row.len()
            )));
        }
        for (j, cell) in feature_cells.iter_mut().enumerate() {
            let v = row.get(j).copied().unwrap_or(f64::NAN);
            cell.push(Cell::Float(v));
        }
        // targets
        if let Some(targets) = record.get("targets").and_then(Value::as_object) {
            for key in targets.keys() {
                if !target_order.contains(key) {
                    target_order.push(key.clone());
                    target_cells.insert(key.clone(), Vec::new());
                }
            }
        }
        // metadata
        if let Some(metadata) = record.get("metadata").and_then(Value::as_object) {
            for key in metadata.keys() {
                // `row_index` is a formats-layer per-row provenance counter (0..n), not
                // a dataset column. Emitting it would let the `auto` features selector
                // (which takes every unassigned *numeric* column) coerce its "0","1",…
                // cells into a phantom feature, widening X by one and shifting the axis.
                if key == "row_index" {
                    continue;
                }
                if !meta_order.contains(key) {
                    meta_order.push(key.clone());
                    meta_cells.insert(key.clone(), Vec::new());
                }
            }
        }
    }
    // Second pass: fill target/metadata per record (None for absent keys).
    for record in records {
        let targets = record.get("targets").and_then(Value::as_object);
        for key in &target_order {
            let v = targets.and_then(|m| m.get(key)).cloned();
            target_cells.get_mut(key).unwrap().push(v);
        }
        let metadata = record.get("metadata").and_then(Value::as_object);
        for key in &meta_order {
            let v = metadata.and_then(|m| m.get(key)).and_then(value_string);
            meta_cells.get_mut(key).unwrap().push(v);
        }
    }

    let mut columns: Vec<Column> = Vec::new();
    for (header, cells) in feature_headers.into_iter().zip(feature_cells) {
        columns.push(Column::from_cells(&header, cells));
    }
    for key in target_order {
        let raw = target_cells.remove(&key).unwrap();
        columns.push(Column::from_cells(
            &key,
            raw.into_iter().map(target_cell).collect(),
        ));
    }
    for key in meta_order {
        let raw = meta_cells.remove(&key).unwrap();
        columns.push(Column::from_cells(
            &key,
            raw.into_iter()
                .map(|o| match o {
                    Some(s) => Cell::Str(s),
                    None => Cell::Na,
                })
                .collect(),
        ));
    }
    Ok(Frame {
        columns,
        n_rows: n,
        header_unit: header_unit_from_axis(&axis_unit),
    })
}

/// Map a decoded record axis unit to a `Frame` header_unit string.
fn header_unit_from_axis(unit: &str) -> String {
    match unit {
        "nm" | "cm-1" => unit.to_string(),
        "" => "index".to_string(),
        other => other.to_string(),
    }
}

/// A target value cell: numbers stay numeric; numeric-looking strings stay
/// strings (the assembler's `encode_categorical` does the to_numeric coercion).
fn target_cell(v: Option<Value>) -> Cell {
    match v {
        None | Some(Value::Null) => Cell::Na,
        Some(Value::Bool(b)) => Cell::Bool(b),
        Some(Value::Number(n)) => {
            if let Some(i) = n.as_i64() {
                Cell::Int(i)
            } else {
                Cell::Float(n.as_f64().unwrap_or(f64::NAN))
            }
        }
        Some(Value::String(s)) => Cell::Str(s),
        Some(other) => Cell::Str(other.to_string()),
    }
}

fn value_string(value: &Value) -> Option<String> {
    match value {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

fn pick_signal<'a>(
    signals: &'a Map<String, Value>,
    preferred: &str,
) -> Option<(&'a str, &'a Value)> {
    if !preferred.is_empty() {
        if let Some((key, signal)) = signals.iter().find(|(key, _)| key.as_str() == preferred) {
            return Some((key.as_str(), signal));
        }
    }
    signals
        .iter()
        .find(|(_, signal)| !signal_values(signal).is_empty())
        .map(|(key, signal)| (key.as_str(), signal))
}

fn signal_values(signal: &Value) -> Vec<f64> {
    signal
        .get("values")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .map(|v| v.as_f64().unwrap_or(f64::NAN))
                .collect()
        })
        .unwrap_or_default()
}

fn signal_axis_values(signal: &Value) -> Vec<f64> {
    signal
        .get("axis")
        .and_then(|axis| axis.get("values"))
        .and_then(Value::as_array)
        .map(|values| values.iter().filter_map(Value::as_f64).collect())
        .unwrap_or_default()
}

/// Axis labels: one per signal value. If the axis has fewer/zero entries, fall
/// back to positional indices so the column count always matches the signal.
fn axis_labels_from_values(axis: &[f64], n_values: usize) -> Vec<String> {
    if axis.len() == n_values {
        axis.iter().copied().map(axis_label).collect()
    } else {
        (0..n_values).map(|i| i.to_string()).collect()
    }
}

fn axis_label(value: f64) -> String {
    if value.is_finite() && (value.fract().abs() < 1e-9) {
        format!("{}", value as i64)
    } else {
        crate::pyfmt::py_round(value, 6).to_string()
    }
}

fn join_key_columns(source: &SourceSpec) -> HashSet<String> {
    let mut cols = HashSet::new();
    if let Some(j) = &source.join {
        for k in [&j.left_on, &j.right_on] {
            if let Some(ks) = key_list(k) {
                cols.extend(ks);
            }
        }
    }
    cols
}

fn split_roles(source: &SourceSpec, df: &Frame) -> Result<Vec<(String, String)>, SpecError> {
    let headers = df.column_names();
    let dtypes = df.dtype_labels();
    let mut key_cols: HashSet<String> = key_list(&source.key)
        .unwrap_or_default()
        .into_iter()
        .collect();
    key_cols.extend(join_key_columns(source));
    key_cols.insert("filename_stem".into());
    key_cols.insert(row_idx_col(&source.id));

    let mut roles: Vec<(String, String)> = Vec::new();
    if source.role != Role::Mixed && source.columns.is_empty() {
        for col in &headers {
            if !key_cols.contains(col) {
                roles.push((col.clone(), source.role.value().to_string()));
            }
        }
        return Ok(roles);
    }

    let mut assigned: std::collections::BTreeSet<usize> = std::collections::BTreeSet::new();
    let has_rest = source
        .columns
        .iter()
        .any(|cr| matches!(cr.select, Selector::Rest));
    for cr in &source.columns {
        let idxs = if let Selector::Auto { candidates } = &cr.select {
            resolve_auto_selector(
                &source.id, cr.role, candidates, &headers, &dtypes, &assigned, &key_cols,
            )?
        } else {
            cr.select.resolve(&headers, &dtypes, &assigned)?
        };
        for i in idxs {
            if assigned.contains(&i) {
                if source.strict_columns {
                    return Err(SpecError::new(format!(
                        "source '{}': column '{}' matched by multiple selectors (set strict_columns:false for first-match-wins)",
                        source.id, headers[i]
                    )));
                }
                continue;
            }
            assigned.insert(i);
            if !key_cols.contains(&headers[i]) {
                roles.push((headers[i].clone(), cr.role.value().to_string()));
            }
        }
    }
    let unmatched: Vec<&String> = headers
        .iter()
        .enumerate()
        .filter(|(i, h)| !assigned.contains(i) && !key_cols.contains(*h))
        .map(|(_, h)| h)
        .collect();
    if !unmatched.is_empty() && !has_rest {
        return Err(SpecError::new(format!(
            "source '{}': columns {unmatched:?} are unassigned and no 'rest' selector is present",
            source.id
        )));
    }
    Ok(roles)
}

#[allow(clippy::too_many_arguments)]
fn resolve_auto_selector(
    source_id: &str,
    role: Role,
    candidates: &[String],
    headers: &[String],
    dtypes: &[String],
    assigned: &std::collections::BTreeSet<usize>,
    key_cols: &HashSet<String>,
) -> Result<Vec<usize>, SpecError> {
    if !candidates.is_empty() {
        for name in candidates {
            if let Some(idx) = headers.iter().position(|h| h == name) {
                if !key_cols.contains(name) && !assigned.contains(&idx) {
                    return Ok(vec![idx]);
                }
            }
        }
        return Err(SpecError::new(format!(
            "source '{source_id}': auto selector with candidates {candidates:?} matched no available column (headers: {headers:?})"
        )));
    }
    let free: Vec<usize> = (0..headers.len())
        .filter(|i| !assigned.contains(i) && !key_cols.contains(&headers[*i]))
        .collect();
    let numeric: Vec<usize> = free
        .iter()
        .copied()
        .filter(|i| dtypes[*i] == "numeric")
        .collect();
    let non_numeric: Vec<usize> = free
        .iter()
        .copied()
        .filter(|i| dtypes[*i] != "numeric")
        .collect();
    match role {
        Role::Features => {
            if numeric.is_empty() {
                return Err(SpecError::new(format!("source '{source_id}': auto features selector found no unassigned numeric columns")));
            }
            Ok(numeric)
        }
        Role::Targets => {
            if numeric.is_empty() {
                return Err(SpecError::new(format!("source '{source_id}': auto targets selector found no unassigned numeric columns (provide explicit candidates for a categorical target)")));
            }
            Ok(vec![*numeric.last().unwrap()])
        }
        Role::Metadata => {
            if non_numeric.is_empty() {
                return Err(SpecError::new(format!("source '{source_id}': auto metadata selector found no unassigned non-numeric columns")));
            }
            Ok(non_numeric)
        }
        Role::Ignore => Ok(free),
        other => Err(SpecError::new(format!(
            "source '{source_id}': auto selector for role '{}' requires explicit candidates",
            other.value()
        ))),
    }
}

fn build_source_table(
    source: &SourceSpec,
    spec: &DatasetSpec,
    sources: &[InMemorySource],
    audits: &mut Vec<Value>,
) -> Result<SourceTable, SpecError> {
    let (mut df, header_unit, signal, origins) =
        load_source_frame_mem(source, spec, sources, audits)?;

    if let Some(origins) = &origins {
        if !df.has_column("filename_stem") {
            df.add_str_column("filename_stem", origins.clone());
        }
    }
    // derive grouped sample id (e.g. mango_001_a -> mango_001) for vendor replicates
    let si = &spec.sample_index;
    if let (Some(from), Some(key)) = (&si.derive_from, si.key.as_str()) {
        if df.has_column(from) && !df.has_column(key) {
            let src = df.str_column(from);
            let derived: Vec<String> = match &si.derive_pattern {
                Some(pat) => {
                    let rx = regex::Regex::new(pat).map_err(|e| {
                        SpecError::new(format!("invalid derive strip_suffix /{pat}/: {e}"))
                    })?;
                    src.iter()
                        .map(|s| rx.replace_all(s, "").into_owned())
                        .collect()
                }
                None => src,
            };
            df.add_str_column(key, derived);
        }
    }
    let mut roles = split_roles(source, &df)?;
    // Identity is never a feature/target role. It is retained separately as
    // aligned metadata for scientific traceability.
    for identity_column in [
        si.key.as_str(),
        si.observation_id.as_deref(),
        si.repetition_id.as_deref(),
        si.group_id.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        roles.retain(|(column, _)| column != identity_column);
        // Keep the actual values in the assembled frame as metadata. They are
        // needed to construct stable downstream identity and must never be
        // reconstructed from row position.
        if df.has_column(identity_column) {
            roles.push((identity_column.to_string(), "metadata".to_string()));
        }
    }
    let row_idx_name = row_idx_col(&source.id);
    if df.has_column(&row_idx_name) {
        return Err(SpecError::new(format!(
            "source '{}': reserved column name '{row_idx_name}' collides with a user-supplied column; rename it",
            source.id
        )));
    }
    df.add_int_column(&row_idx_name, (0..df.n_rows as i64).collect());

    let key = key_list(&source.key);
    let variations = load_variations(source, spec, sources, &df, &roles)?;
    let spec_signal = if spec.signal_type.value() != "auto" {
        Some(spec.signal_type.value().to_string())
    } else {
        None
    };
    Ok(SourceTable {
        source_id: source.id.clone(),
        df,
        roles,
        key,
        partition: source.partition.map(|p| p.value().to_string()),
        kind: source.kind.value().to_string(),
        join: source.join.clone(),
        signal_type: signal.or(spec_signal),
        header_unit,
        variations,
    })
}

fn read_variation_frame_mem(
    variation: &VariationSpec,
    spec: &DatasetSpec,
    source: &SourceSpec,
    sources: &[InMemorySource],
) -> Result<Frame, SpecError> {
    let mut params = effective_params(&spec.params, &source.params);
    if !variation.params.is_empty_value() {
        params = effective_params(&params, &variation.params);
    }
    let matched = resolve_inputs_mem(&variation.input, sources)?;
    if matched.is_empty() {
        return Err(SpecError::new(format!(
            "source '{}': variation '{}': no input files resolved",
            source.id, variation.name
        )));
    }
    let frames: Vec<Frame> = matched
        .iter()
        .map(|s| frame_from_source(s, &params))
        .collect::<Result<_, _>>()?;
    if frames.len() > 1 {
        let names: Vec<String> = (0..frames.len()).map(|i| i.to_string()).collect();
        Ok(concat_samples(&frames, &names).0)
    } else {
        Ok(frames.into_iter().next().unwrap())
    }
}

fn load_variations(
    source: &SourceSpec,
    spec: &DatasetSpec,
    sources: &[InMemorySource],
    parent_df: &Frame,
    roles: &[(String, String)],
) -> Result<Vec<(String, Matrix)>, SpecError> {
    if source.variations.is_empty() {
        return Ok(vec![]);
    }
    if source.role != Role::Features && !roles.iter().any(|(_, r)| r == "features") {
        return Err(SpecError::new(format!(
            "source '{}': variations are only meaningful on a feature source (role/columns must declare 'features')",
            source.id
        )));
    }
    let feature_cols: Vec<String> = roles
        .iter()
        .filter(|(_, r)| r == "features")
        .map(|(c, _)| c.clone())
        .collect();
    if feature_cols.is_empty() {
        return Err(SpecError::new(format!(
            "source '{}': has variations but no feature columns to attach them to",
            source.id
        )));
    }
    let parent_n = parent_df.n_rows;
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for variation in &source.variations {
        if !seen.insert(variation.name.clone()) {
            return Err(SpecError::new(format!(
                "source '{}': duplicate variation name '{}'",
                source.id, variation.name
            )));
        }
        let vdf = read_variation_frame_mem(variation, spec, source, sources)?;
        if vdf.n_rows != parent_n {
            return Err(SpecError::new(format!(
                "source '{}': variation '{}' has {} rows, expected {parent_n} (must row-align with the parent source)",
                source.id, variation.name, vdf.n_rows
            )));
        }
        let named = feature_cols.iter().filter(|c| vdf.has_column(c)).count();
        let arr = if named == feature_cols.len() {
            vdf.coerce_numeric(&feature_cols)
        } else if named == 0 && vdf.columns.len() == feature_cols.len() {
            vdf.coerce_numeric(&vdf.column_names())
        } else {
            return Err(SpecError::new(format!(
                "source '{}': variation '{}' is ambiguous: {named}/{} parent feature columns matched by name and the frame has {} columns",
                source.id, variation.name, feature_cols.len(), vdf.columns.len()
            )));
        };
        out.push((variation.name.clone(), arr));
    }
    Ok(out)
}

fn has_role(table: &SourceTable, role: &str) -> bool {
    table.roles.iter().any(|(_, r)| r == role)
}

/// Load, role-split, join and partition `spec` into an [`AssembledDataset`],
/// using named in-memory sources (fs-free). `index_lists` supplies row indices
/// for `partitions.by=index_file` (keys: `train`/`test`/`predict`); `fold_inline`
/// supplies parsed folds for `folds.file`. Both default empty/None.
pub fn assemble_in_memory(
    spec: &DatasetSpec,
    sources: &[InMemorySource],
    index_lists: &HashMap<String, Vec<i64>>,
    fold_inline: Option<&[Fold]>,
) -> Result<AssembledDataset, SpecError> {
    let mut audits: Vec<Value> = Vec::new();
    let mut tables: IndexMap<String, SourceTable> = IndexMap::new();
    for s in &spec.sources {
        tables.insert(
            s.id.clone(),
            build_source_table(s, spec, sources, &mut audits)?,
        );
    }

    let mut partitions: Vec<String> = tables
        .values()
        .filter_map(|t| t.partition.clone())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    partitions.sort();

    let n_sources = tables
        .values()
        .filter(|t| t.kind != SourceKind::Lookup.value() && has_role(t, "features"))
        .count();
    let repetition = spec.repetition.clone().or_else(|| {
        spec.sample_index
            .repetition_id
            .clone()
            .filter(|r| r != "auto")
    });
    let identity = IdentityProvenance {
        source_ids: tables
            .values()
            .filter(|table| table.kind != SourceKind::Lookup.value() && has_role(table, "features"))
            .map(|table| table.source_id.clone())
            .collect(),
        sample_id: (spec.sample_index.by.value() == "id")
            .then(|| spec.sample_index.key.as_str().map(str::to_string))
            .flatten(),
        observation_id: spec.sample_index.observation_id.clone(),
        repetition_id: spec.sample_index.repetition_id.clone(),
        group_id: spec.sample_index.group_id.clone(),
    };
    let mut assembled = AssembledDataset {
        name: spec.name.clone().unwrap_or_else(|| "dataset".into()),
        task_type: spec.task_type.value().to_string(),
        signal_type: spec.signal_type.value().to_string(),
        n_sources,
        blocks: IndexMap::new(),
        folds: vec![],
        fold_provenance: vec![],
        repetition,
        identity,
        aggregate: spec.aggregate.clone(),
        warnings: vec![],
        audits: vec![],
    };

    let mut combined_df: Option<Frame> = None;
    if !partitions.is_empty() {
        for part in &partitions {
            let part_tables: IndexMap<&String, &SourceTable> = tables
                .iter()
                .filter(|(_, t)| {
                    t.partition.as_deref() == Some(part) || t.kind == SourceKind::Lookup.value()
                })
                .collect();
            let (block, _) =
                assemble_block(&part_tables, spec, &mut audits, &mut assembled.warnings)?;
            assembled.blocks.insert(part.clone(), block);
        }
    } else {
        let all: IndexMap<&String, &SourceTable> = tables.iter().collect();
        let (block, combined) = assemble_block(&all, spec, &mut audits, &mut assembled.warnings)?;
        if spec.partitions.is_none() {
            assembled.blocks.insert("train".into(), block);
        } else {
            for (part, mask) in split_partition_mask(&combined, spec, index_lists)? {
                assembled.blocks.insert(part, slice_block(&block, &mask));
            }
        }
        combined_df = Some(combined);
    }

    assembled.audits = audits;
    attach_folds(spec, fold_inline, &mut assembled, combined_df.as_ref())?;
    Ok(assembled)
}

fn row_align(combined: &Frame, t: &SourceTable, primary_id: &str) -> Result<Frame, SpecError> {
    if t.df.n_rows != combined.n_rows {
        return Err(SpecError::new(format!(
            "source '{}' ({} rows) is not row-aligned with '{primary_id}' ({} rows); supply a join key",
            t.source_id, t.df.n_rows, combined.n_rows
        )));
    }
    let (merged, _) = concat_features(
        &[combined.clone(), t.df.clone()],
        &[primary_id.to_string(), t.source_id.clone()],
        None,
    )?;
    Ok(merged)
}

fn join_onto(
    combined: &Frame,
    primary: &SourceTable,
    t: &SourceTable,
    audits: &mut Vec<Value>,
    warnings: &mut Vec<String>,
) -> Result<Frame, SpecError> {
    if let Some(j) = &t.join {
        let left_on = key_list(&j.left_on);
        let right_on = key_list(&j.right_on).or_else(|| t.key.clone());
        if let (Some(left_on), Some(right_on)) = (&left_on, &right_on) {
            let missing_l: Vec<&String> =
                left_on.iter().filter(|c| !combined.has_column(c)).collect();
            let missing_r: Vec<&String> = right_on.iter().filter(|c| !t.df.has_column(c)).collect();
            if !missing_l.is_empty() || !missing_r.is_empty() {
                return Err(SpecError::new(format!(
                    "source '{}': join keys not found (left missing {missing_l:?} in assembled data, right missing {missing_r:?} in '{}')",
                    t.source_id, t.source_id
                )));
            }
            let left_name = j.left.clone().unwrap_or_else(|| primary.source_id.clone());
            let (out, audit) = join_tables(
                combined,
                &t.df,
                left_on,
                right_on,
                j.cardinality,
                j.coverage,
                &left_name,
                &t.source_id,
            )?;
            audits.push(serde_json::json!({"join": audit.operation, "dropped": audit.dropped_rows.len(), "warnings": audit.warnings}));
            warnings.extend(audit.warnings);
            return Ok(out);
        }
        if j.cardinality == Cardinality::OneToOne {
            return row_align(combined, t, &primary.source_id);
        }
        return Err(SpecError::new(format!(
            "source '{}': {} join needs explicit left_on/right_on",
            t.source_id,
            j.cardinality.value()
        )));
    }
    // no join spec: align by a shared key (1:1) if both declare one, else row order
    if let (Some(lkeys), Some(rkeys)) = (&primary.key, &t.key) {
        if lkeys.iter().all(|c| combined.has_column(c)) && rkeys.iter().all(|c| t.df.has_column(c))
        {
            let (out, audit) = join_tables(
                combined,
                &t.df,
                lkeys,
                rkeys,
                Cardinality::OneToOne,
                Coverage::Complete,
                &primary.source_id,
                &t.source_id,
            )?;
            warnings.extend(audit.warnings);
            return Ok(out);
        }
    }
    row_align(combined, t, &primary.source_id)
}

/// column -> (role, owning_source_id), mirroring `_collect_roles` verbatim.
///
/// Joins namespace duplicate right-hand columns as `name__source`, while
/// row-order feature concatenation namespaces them as `source__name`. Both forms
/// must be recognized so secondary feature sources are not silently dropped.
fn collect_roles(
    combined: &Frame,
    tables: &IndexMap<&String, &SourceTable>,
) -> IndexMap<String, (String, String)> {
    let mut role_cols: IndexMap<String, (String, String)> = IndexMap::new();
    for t in tables.values() {
        for (col, role) in &t.roles {
            if combined.has_column(col) && !role_cols.contains_key(col) {
                role_cols.insert(col.clone(), (role.clone(), t.source_id.clone()));
            } else {
                for ns in [
                    format!("{col}__{}", t.source_id),
                    format!("{}__{col}", t.source_id),
                ] {
                    if combined.has_column(&ns) {
                        role_cols.insert(ns, (role.clone(), t.source_id.clone()));
                        break;
                    }
                }
            }
        }
    }
    role_cols
}

fn source_has_feature_role(source: &SourceTable, col: &str) -> bool {
    source
        .roles
        .iter()
        .any(|(name, role)| name == col && role == "features")
}

fn source_feature_header(combined_col: &str, source: &SourceTable) -> String {
    if source_has_feature_role(source, combined_col) {
        return combined_col.to_string();
    }
    let suffix = format!("__{}", source.source_id);
    if let Some(bare) = combined_col.strip_suffix(&suffix) {
        if source_has_feature_role(source, bare) {
            return bare.to_string();
        }
    }
    let prefix = format!("{}__", source.source_id);
    if let Some(bare) = combined_col.strip_prefix(&prefix) {
        if source_has_feature_role(source, bare) {
            return bare.to_string();
        }
    }
    combined_col.to_string()
}

fn assemble_block(
    tables: &IndexMap<&String, &SourceTable>,
    spec: &DatasetSpec,
    audits: &mut Vec<Value>,
    warnings: &mut Vec<String>,
) -> Result<(PartitionBlock, Frame), SpecError> {
    let feature_tables: Vec<&SourceTable> = tables
        .values()
        .filter(|t| t.kind != SourceKind::Lookup.value() && has_role(t, "features"))
        .copied()
        .collect();
    if feature_tables.is_empty() {
        return Err(SpecError::new("partition has no feature source"));
    }
    let primary = feature_tables[0];
    let mut combined = primary.df.clone();
    for t in tables.values() {
        if t.source_id == primary.source_id {
            continue;
        }
        combined = join_onto(&combined, primary, t, audits, warnings)?;
    }

    let role_cols = collect_roles(&combined, tables);
    let combined_names = combined.column_names();
    let mut block = PartitionBlock {
        n_samples: combined.n_rows,
        ..Default::default()
    };

    for ft in &feature_tables {
        let cols: Vec<String> = combined_names
            .iter()
            .filter(|c| {
                role_cols
                    .get(*c)
                    .map(|(r, s)| r == "features" && s == &ft.source_id)
                    .unwrap_or(false)
            })
            .cloned()
            .collect();
        if cols.is_empty() {
            continue;
        }
        block.source_ids.push(ft.source_id.clone());
        let headers: Vec<String> = cols.iter().map(|c| source_feature_header(c, ft)).collect();
        block.x.push(combined.coerce_numeric(&cols));
        block.feature_headers.push(headers);
        block.header_units.push(ft.header_unit.clone());
        block.signal_types.push(ft.signal_type.clone());
        let mut src_proc: Vec<(String, Matrix)> = Vec::new();
        if !ft.variations.is_empty() {
            let idx_col = row_idx_col(&ft.source_id);
            let row_idx: Vec<usize> = combined
                .numeric_column_f64(&idx_col)
                .iter()
                .map(|&v| v as usize)
                .collect();
            for (name, arr) in &ft.variations {
                let data: Vec<f32> = row_idx
                    .iter()
                    .flat_map(|&r| {
                        arr.data[r * arr.n_cols..(r + 1) * arr.n_cols]
                            .iter()
                            .copied()
                    })
                    .collect();
                src_proc.push((
                    name.clone(),
                    Matrix {
                        data,
                        n_rows: row_idx.len(),
                        n_cols: arr.n_cols,
                    },
                ));
            }
        }
        block.processings.push(src_proc);
    }

    let target_cols: Vec<String> = combined_names
        .iter()
        .filter(|c| {
            role_cols
                .get(*c)
                .map(|(r, _)| r == "targets")
                .unwrap_or(false)
        })
        .cloned()
        .collect();
    if !target_cols.is_empty() {
        let mode = spec
            .params
            .categorical
            .map(|c| c.value().to_string())
            .unwrap_or_else(|| "auto".into());
        let mut y_cols: Vec<Vec<f64>> = Vec::new();
        let mut cats: IndexMap<String, Value> = IndexMap::new();
        for c in &target_cols {
            let (enc, mapping) = encode_categorical(combined.column(c).unwrap(), &mode);
            y_cols.push(enc);
            if let Some(m) = mapping {
                cats.insert(c.clone(), m);
            }
        }
        block.y = Some(column_stack(&y_cols));
        block.y_headers = target_cols;
        block.y_categorical = cats;
    }

    let weight_cols: Vec<String> = combined_names
        .iter()
        .filter(|c| {
            role_cols
                .get(*c)
                .map(|(r, _)| r == "weights")
                .unwrap_or(false)
        })
        .cloned()
        .collect();
    if !weight_cols.is_empty() {
        if weight_cols.len() > 1 {
            return Err(SpecError::new(format!(
                "only one 'weights' column is supported, got {weight_cols:?}"
            )));
        }
        block.weights = Some(
            combined
                .numeric_column_f64(&weight_cols[0])
                .iter()
                .map(|&v| v as f32)
                .collect(),
        );
        block.weights_header = Some(weight_cols[0].clone());
    }

    let mut meta_cols: Vec<String> = combined_names
        .iter()
        .filter(|c| {
            role_cols
                .get(*c)
                .map(|(r, _)| r == "metadata")
                .unwrap_or(false)
        })
        .cloned()
        .collect();
    // Identity columns are exempt from ordinary roles so they can drive joins
    // without leaking into X. Preserve them explicitly in the assembled IR:
    // downstream scientific adapters must never recreate IDs from row position.
    // Keep the source order stable and ignore unavailable columns here; the
    // bridge performs a typed preflight and names the missing capability.
    for column in [
        spec.sample_index.key.as_str(),
        spec.sample_index.observation_id.as_deref(),
        spec.sample_index.repetition_id.as_deref(),
        spec.sample_index.group_id.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        if combined.has_column(column) && !meta_cols.iter().any(|name| name == column) {
            meta_cols.push(column.to_string());
        }
    }
    if !meta_cols.is_empty() {
        block.metadata = Some(combined.select(&meta_cols));
    }
    Ok((block, combined))
}

/// `encode_categorical`: factorize an object target when `auto` + more NaNs under
/// numeric coercion; else numeric coercion (f64). The mapping (when categorical)
/// is `{"categories": [...]}`, matching the Python IR.
fn encode_categorical(col: &Column, mode: &str) -> (Vec<f64>, Option<Value>) {
    let numeric: Vec<f64> = col.values.iter().map(Cell::to_numeric).collect();
    let is_objectish = !col.is_numeric_dtype();
    let numeric_na = numeric.iter().filter(|v| v.is_nan()).count();
    let series_na = col
        .values
        .iter()
        .filter(|c| matches!(c, Cell::Na) || matches!(c, Cell::Float(f) if f.is_nan()))
        .count();
    let treat_categorical = mode == "auto" && is_objectish && numeric_na > series_na;
    if treat_categorical {
        // pandas factorize over str(values): codes in first-appearance order.
        let mut categories: Vec<String> = Vec::new();
        let mut codes = Vec::with_capacity(col.values.len());
        for v in &col.values {
            let s = v.to_str_scalar();
            let code = match categories.iter().position(|c| c == &s) {
                Some(i) => i,
                None => {
                    categories.push(s);
                    categories.len() - 1
                }
            };
            codes.push(code as f64);
        }
        (codes, Some(serde_json::json!({ "categories": categories })))
    } else {
        (numeric, None)
    }
}

fn column_stack(cols: &[Vec<f64>]) -> Matrix {
    let n_cols = cols.len();
    let n_rows = cols.first().map(|c| c.len()).unwrap_or(0);
    let mut data = Vec::with_capacity(n_rows * n_cols);
    for row in 0..n_rows {
        for c in cols {
            data.push(c[row] as f32);
        }
    }
    Matrix {
        data,
        n_rows,
        n_cols,
    }
}

fn slice_block(block: &PartitionBlock, mask: &[bool]) -> PartitionBlock {
    let take = |m: &Matrix| -> Matrix {
        let data: Vec<f32> = (0..m.n_rows)
            .filter(|&r| mask[r])
            .flat_map(|r| m.data[r * m.n_cols..(r + 1) * m.n_cols].iter().copied())
            .collect();
        Matrix {
            data,
            n_rows: mask.iter().filter(|&&b| b).count(),
            n_cols: m.n_cols,
        }
    };
    PartitionBlock {
        n_samples: mask.iter().filter(|&&b| b).count(),
        source_ids: block.source_ids.clone(),
        x: block.x.iter().map(take).collect(),
        feature_headers: block.feature_headers.clone(),
        header_units: block.header_units.clone(),
        signal_types: block.signal_types.clone(),
        processings: block
            .processings
            .iter()
            .map(|src| src.iter().map(|(n, m)| (n.clone(), take(m))).collect())
            .collect(),
        y: block.y.as_ref().map(take),
        y_headers: block.y_headers.clone(),
        y_categorical: block.y_categorical.clone(),
        metadata: block.metadata.as_ref().map(|f| f.mask_rows(mask)),
        weights: block.weights.as_ref().map(|w| {
            w.iter()
                .zip(mask)
                .filter(|(_, &m)| m)
                .map(|(v, _)| *v)
                .collect()
        }),
        weights_header: block.weights_header.clone(),
    }
}

fn split_partition_mask(
    df: &Frame,
    spec: &DatasetSpec,
    index_lists: &HashMap<String, Vec<i64>>,
) -> Result<IndexMap<String, Vec<bool>>, SpecError> {
    let n = df.n_rows;
    let p = match &spec.partitions {
        Some(p) if p.by.is_some() => p,
        _ => {
            let mut m = IndexMap::new();
            m.insert("train".into(), vec![true; n]);
            return Ok(m);
        }
    };
    match p.by.unwrap() {
        PartitionBy::Column => {
            let column = p.column.as_deref().unwrap_or("");
            if !df.has_column(column) {
                return Err(SpecError::new(format!(
                    "partitions.column '{column}' not found in the assembled data (columns: {:?})",
                    df.column_names()
                )));
            }
            let col: Vec<String> = df
                .str_column(column)
                .iter()
                .map(|s| s.to_lowercase())
                .collect();
            let lower_set = |vals: &[Value]| -> HashSet<String> {
                vals.iter()
                    .map(|v| crate::pyfmt::py_str_scalar(v).to_lowercase())
                    .collect()
            };
            let train_vals = lower_set(&p.train_values);
            let test_vals = lower_set(&p.test_values);
            let predict_vals = lower_set(&p.predict_values);
            let known: HashSet<&String> = train_vals
                .iter()
                .chain(&test_vals)
                .chain(&predict_vals)
                .collect();
            let mut train_mask: Vec<bool> = col.iter().map(|v| train_vals.contains(v)).collect();
            let mut test_mask: Vec<bool> = col.iter().map(|v| test_vals.contains(v)).collect();
            let unknown: Vec<bool> = col.iter().map(|v| !known.contains(v)).collect();
            if unknown.iter().any(|&u| u) {
                match p.unknown_policy {
                    UnknownPolicy::Error => {
                        return Err(SpecError::new(format!(
                            "partitions: unknown values in '{column}'"
                        )))
                    }
                    UnknownPolicy::Train => {
                        for (m, u) in train_mask.iter_mut().zip(&unknown) {
                            *m |= u;
                        }
                    }
                    UnknownPolicy::Test => {
                        for (m, u) in test_mask.iter_mut().zip(&unknown) {
                            *m |= u;
                        }
                    }
                    UnknownPolicy::Drop => {}
                }
            }
            let mut masks: IndexMap<String, Vec<bool>> = IndexMap::new();
            masks.insert("train".into(), train_mask);
            masks.insert("test".into(), test_mask);
            if !predict_vals.is_empty() {
                masks.insert(
                    "predict".into(),
                    col.iter().map(|v| predict_vals.contains(v)).collect(),
                );
            }
            Ok(masks
                .into_iter()
                .filter(|(_, m)| m.iter().any(|&b| b))
                .collect())
        }
        PartitionBy::Index => mask_from_index_lists(
            &[
                ("train", &p.train),
                ("test", &p.test),
                ("predict", &p.predict),
            ],
            n,
            "partitions",
        ),
        PartitionBy::IndexFile => {
            // Index lists were read from index_file by the facade and supplied
            // in-memory. A referenced partition file that was not supplied is an
            // error (the facade only omits a key when the spec omits the file).
            let load = |part: &str, file: &Option<String>| -> Result<Value, SpecError> {
                match file {
                    Some(_) => match index_lists.get(part) {
                        Some(v) => Ok(Value::from(v.clone())),
                        None => Err(SpecError::new(format!(
                            "index file: '{part}' partition file content not supplied"
                        ))),
                    },
                    None => Ok(Value::Null),
                }
            };
            let train = load("train", &p.train_file)?;
            let test = load("test", &p.test_file)?;
            let predict = load("predict", &p.predict_file)?;
            mask_from_index_lists(
                &[("train", &train), ("test", &test), ("predict", &predict)],
                n,
                "index file",
            )
        }
        PartitionBy::Files => Err(SpecError::new(
            "partitions.by=files is not supported by the assembler",
        )),
    }
}

fn mask_from_index_lists(
    by_part: &[(&str, &Value)],
    n: usize,
    source: &str,
) -> Result<IndexMap<String, Vec<bool>>, SpecError> {
    let mut masks: IndexMap<String, Vec<bool>> = IndexMap::new();
    let mut seen: HashMap<i64, String> = HashMap::new();
    for (part, raw) in by_part {
        let Some(arr) = raw.as_array() else {
            if raw.is_null() {
                continue;
            }
            return Err(SpecError::new(format!(
                "{source}: '{part}' must be a list of row indices"
            )));
        };
        // Python `[int(v) for v in raw]`: coerce ints/floats/int-strings, raise
        // on anything else (don't silently drop, which would omit requested rows).
        let idx_list: Vec<i64> = arr
            .iter()
            .map(|v| {
                crate::pyfmt::py_int(v).ok_or_else(|| {
                    SpecError::new(format!(
                        "{source}: '{part}' contains a non-integer index {}",
                        crate::pyfmt::py_repr(v)
                    ))
                })
            })
            .collect::<Result<_, _>>()?;
        if idx_list.iter().any(|&i| i < 0 || i >= n as i64) {
            return Err(SpecError::new(format!(
                "{source}: '{part}' contains out-of-range indices (n={n})"
            )));
        }
        if idx_list.iter().collect::<HashSet<_>>().len() != idx_list.len() {
            return Err(SpecError::new(format!(
                "{source}: '{part}' contains duplicate indices"
            )));
        }
        for &i in &idx_list {
            if let Some(other) = seen.get(&i) {
                if other != part {
                    return Err(SpecError::new(format!(
                        "{source}: row {i} listed in both '{other}' and '{part}' (partitions must be disjoint)"
                    )));
                }
            }
            seen.insert(i, part.to_string());
        }
        let mut m = vec![false; n];
        for &i in &idx_list {
            m[i as usize] = true;
        }
        masks.insert(part.to_string(), m);
    }
    if masks.is_empty() {
        return Err(SpecError::new(format!(
            "{source}: no partition lists provided"
        )));
    }
    Ok(masks)
}

fn attach_folds(
    spec: &DatasetSpec,
    fold_inline: Option<&[Fold]>,
    assembled: &mut AssembledDataset,
    combined_df: Option<&Frame>,
) -> Result<(), SpecError> {
    let Some(folds) = &spec.folds else {
        return Ok(());
    };
    if !folds.inline.is_empty() {
        let int_list = |v: Option<&Value>| -> Vec<i64> {
            v.and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_i64()).collect())
                .unwrap_or_default()
        };
        assembled.folds = folds
            .inline
            .iter()
            .map(|f| {
                let m = f.as_object();
                let train = int_list(m.and_then(|m| m.get("train")));
                let val = int_list(m.and_then(|m| m.get("val").or_else(|| m.get("test"))));
                (train, val)
            })
            .collect();
    } else if let Some(column) = folds.column.as_deref().filter(|s| !s.is_empty()) {
        let combined = combined_df.ok_or_else(|| {
            SpecError::new(format!(
                "folds.column='{column}' requires a single combined frame (it does not apply with explicit per-source partitions)"
            ))
        })?;
        if !combined.has_column(column) {
            return Err(SpecError::new(format!(
                "folds.column='{column}' not found in the assembled data (columns: {:?})",
                combined.column_names()
            )));
        }
        let col = combined.column(column).unwrap();
        // distinct non-NA values, sorted by str(value)
        let mut distinct: Vec<(String, Vec<usize>)> = Vec::new();
        for (i, cell) in col.values.iter().enumerate() {
            if matches!(cell, Cell::Na) || matches!(cell, Cell::Float(f) if f.is_nan()) {
                continue;
            }
            let key = cell.to_str_scalar();
            match distinct.iter_mut().find(|(k, _)| *k == key) {
                Some((_, rows)) => rows.push(i),
                None => distinct.push((key, vec![i])),
            }
        }
        distinct.sort_by(|a, b| a.0.cmp(&b.0));
        if distinct.is_empty() {
            return Err(SpecError::new(format!(
                "folds.column='{column}' has no non-NaN values"
            )));
        }
        let n = col.values.len();
        assembled.folds = distinct
            .into_iter()
            .map(|(_, val_rows)| {
                let vset: HashSet<usize> = val_rows.iter().copied().collect();
                let train: Vec<i64> = (0..n)
                    .filter(|i| !vset.contains(i))
                    .map(|i| i as i64)
                    .collect();
                let val: Vec<i64> = val_rows.iter().map(|&i| i as i64).collect();
                (train, val)
            })
            .collect();
    } else if folds.file.as_deref().filter(|s| !s.is_empty()).is_some() {
        // The facade parses the fold file to `fold_inline` before delegating;
        // it is unavailable in a pure browser context.
        assembled.folds = fold_inline
            .ok_or_else(|| {
                SpecError::new("folds.file content not supplied (not browser-reachable)")
            })?
            .to_vec();
    }
    // Fold indices refer to the unsplit combined frame. Capture stable IDs now:
    // a subsequent partition split may reorder rows, so translating those raw
    // indices in a downstream bridge would be scientifically wrong.
    assembled.fold_provenance = combined_df
        .and_then(|frame| fold_provenance_from_frame(spec, frame, &assembled.folds))
        .unwrap_or_default();
    Ok(())
}

fn fold_provenance_from_frame(
    spec: &DatasetSpec,
    frame: &Frame,
    folds: &[Fold],
) -> Option<Vec<FoldProvenance>> {
    let identity_column = spec.sample_index.observation_id.as_deref().or_else(|| {
        (spec.sample_index.by.value() == "id")
            .then(|| spec.sample_index.key.as_str())
            .flatten()
    })?;
    let values = frame.column(identity_column)?;
    if values.values.len() != frame.n_rows {
        return None;
    }
    folds
        .iter()
        .map(|(train, validation)| {
            let translate = |indices: &[i64]| -> Option<Vec<String>> {
                indices
                    .iter()
                    .map(|index| {
                        usize::try_from(*index)
                            .ok()
                            .and_then(|index| values.values.get(index))
                            .and_then(|cell| match cell {
                                Cell::Na => None,
                                Cell::Float(value) if value.is_nan() => None,
                                _ => Some(cell.to_str_scalar()),
                            })
                            .filter(|value| !value.trim().is_empty())
                    })
                    .collect()
            };
            Some(FoldProvenance {
                train_observation_ids: translate(train)?,
                validation_observation_ids: translate(validation)?,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::materialize::frame::{Cell, Column};
    use serde_json::json;

    #[test]
    fn categorical_mapping_is_categories_dict() {
        // string target auto-encoded -> mapping is {"categories": [...]} (Python IR shape).
        let col = Column::from_cells(
            "class",
            vec![
                Cell::Str("a".into()),
                Cell::Str("b".into()),
                Cell::Str("a".into()),
            ],
        );
        let (codes, mapping) = encode_categorical(&col, "auto");
        assert_eq!(codes, vec![0.0, 1.0, 0.0]);
        assert_eq!(mapping, Some(json!({"categories": ["a", "b"]})));
    }

    #[test]
    fn float_target_has_no_mapping() {
        let col = Column::from_cells("y", vec![Cell::Float(12.5), Cell::Float(8.3)]);
        let (vals, mapping) = encode_categorical(&col, "auto");
        assert_eq!(vals, vec![12.5, 8.3]);
        assert_eq!(mapping, None);
    }

    #[test]
    fn records_to_frame_drops_row_index_provenance() {
        // formats tags every decoded CSV row with metadata.row_index (0..n). It must
        // NOT survive into the assembled frame: the `auto` features selector takes
        // every unassigned numeric column, so a "0","1",… row_index column would be
        // coerced into a phantom feature, widening X by one and shifting the axis.
        let mk = |vals: [f64; 3], idx: i64| {
            json!({
                "signals": { "signal": {
                    "axis": { "values": [400.0, 402.0, 404.0], "unit": "nm" },
                    "values": vals,
                } },
                "metadata": { "row_index": idx, "sample_id": format!("s{idx}") }
            })
        };
        let records = vec![mk([0.40, 0.41, 0.42], 0), mk([0.50, 0.51, 0.52], 1)];
        let frame = records_to_frame(&records, &LoadingParams::default()).unwrap();
        let names = frame.column_names();
        assert!(
            !names.iter().any(|c| c == "row_index"),
            "row_index must be dropped, got {names:?}"
        );
        // exactly the three signal-axis features + the real sample_id metadata key.
        assert_eq!(names, vec!["400", "402", "404", "sample_id"]);
        assert_eq!(frame.n_rows, 2);
    }

    #[test]
    fn index_partition_coerces_and_rejects() {
        // Python int(): "2" and 3.0 coerce; "3.5" raises.
        let train = json!([0, 1, "2"]);
        let test = json!([3.0, 4]);
        let by = [("train", &train), ("test", &test)];
        let masks = mask_from_index_lists(&by, 5, "partitions").unwrap();
        assert_eq!(masks["train"], vec![true, true, true, false, false]);
        assert_eq!(masks["test"], vec![false, false, false, true, true]);

        let bad_v = json!(["3.5"]);
        let bad = [("train", &bad_v)];
        assert!(mask_from_index_lists(&bad, 5, "partitions").is_err());
    }

    #[test]
    fn glob_match_basics() {
        assert!(glob_match("*.csv", "data.csv"));
        assert!(glob_match("X*.csv", "Xcal.csv"));
        assert!(!glob_match("X*.csv", "Ycal.csv"));
        assert!(glob_match("data?.csv", "data1.csv"));
        assert!(glob_match("f[0-9].csv", "f3.csv"));
        assert!(!glob_match("f[0-9].csv", "fa.csv"));
    }
}
