// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Assemble a DatasetSpec into a target-agnostic dataset — the facade's
//! filesystem entry (ports the IO half of `materialize/assemble.py`).
//!
//! The whole assembly core — frame, join, role-split, partition masks, fold
//! attach, `AssembledDataset` — moved into `nirs4all-io-core::materialize` so the
//! WASM binding can reach it (D-R7). This module keeps only the filesystem side:
//! resolve `source.input` (glob/dir/list), read each file's bytes (the loaders
//! handle gzip/zip), read `partitions.index_file`s, and parse `folds.file`. It
//! then gathers everything into named in-memory payloads and delegates to
//! [`assemble_in_memory_with_tabular_limits`], so native and browser paths share
//! one assembly core and produce byte-identical `AssembledDataset`s.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use nirs4all_io_core::materialize::loaders::effective_params;
use nirs4all_io_core::materialize::{
    assemble_in_memory_with_tabular_limits, InMemorySource, SourcePayload,
};
use nirs4all_io_core::spec::dataset_spec::DatasetSpec;
use nirs4all_io_core::spec::dataset_spec::LoadingParams;
use nirs4all_io_core::spec::enums::PartitionBy;
use nirs4all_io_core::spec::SpecError;
use serde_json::Value;

use super::folds::{parse_fold_file_with_budget, Fold};
use super::limits::{LoadLimits, ReadBudget};
use super::loaders::read_parquet_frame_with_budget;

pub use nirs4all_io_core::materialize::{
    AssembledDataset, FoldProvenance, IdentityProvenance, PartitionBlock, ASSEMBLED_DATASET_VERSION,
};

fn is_glob(text: &str) -> bool {
    text.chars().any(|c| matches!(c, '*' | '?' | '['))
}

/// Resolve one `source.input` value against `base_dir` into `(match_name, path)`
/// pairs. `match_name` is what the in-memory resolver re-matches against: the
/// original entry for plain inputs, and — for glob-expanded entries — the path
/// *relative to `base_dir`* (with separators normalized to `/`) so the in-memory
/// glob re-match stays path-scoped and a `spectra/*.csv` source does not also
/// match a sibling `meta.csv` (Codex #2).
fn resolve_named(input: &Value, base_dir: &Path) -> Vec<(String, PathBuf)> {
    let items: Vec<&Value> = match input {
        Value::Array(a) => a.iter().collect(),
        other => vec![other],
    };
    let mut out = Vec::new();
    for item in items {
        let Some(text) = item.as_str() else { continue };
        if is_glob(text) {
            let pat = base_dir.join(text);
            let (mut g, scoped): (Vec<PathBuf>, bool) = {
                let scoped: Vec<PathBuf> = glob::glob(&pat.to_string_lossy())
                    .map(|p| p.filter_map(Result::ok).collect())
                    .unwrap_or_default();
                if scoped.is_empty() {
                    (
                        glob::glob(text)
                            .map(|p| p.filter_map(Result::ok).collect())
                            .unwrap_or_default(),
                        false,
                    )
                } else {
                    (scoped, true)
                }
            };
            g.sort();
            for p in g {
                // Re-match name = path relative to base_dir for base_dir-scoped
                // matches, else the path as globbed; normalize to `/`.
                let rel = if scoped {
                    p.strip_prefix(base_dir).unwrap_or(&p)
                } else {
                    p.as_path()
                };
                let name = rel.to_string_lossy().replace('\\', "/");
                let name = if name.is_empty() {
                    text.to_string()
                } else {
                    name
                };
                out.push((name, p));
            }
        } else {
            let p = base_dir.join(text);
            let path = if p.exists() { p } else { PathBuf::from(text) };
            out.push((text.to_string(), path));
        }
    }
    out
}

fn path_key(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

fn requested_parquet_columns(params: &LoadingParams) -> Result<Option<Vec<String>>, SpecError> {
    match params.format.values.get("columns") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(name)) => Ok(Some(vec![name.clone()])),
        Some(Value::Array(values)) => values
            .iter()
            .map(|value| {
                value.as_str().map(str::to_string).ok_or_else(|| {
                    SpecError::new(
                        "parquet loading.format.columns must be a string or a list of strings",
                    )
                })
            })
            .collect::<Result<Vec<_>, _>>()
            .map(Some),
        Some(_) => Err(SpecError::new(
            "parquet loading.format.columns must be a string or a list of strings",
        )),
    }
}

fn update_projection(
    projections: &mut HashMap<PathBuf, Option<Vec<String>>>,
    path: &Path,
    params: &LoadingParams,
) -> Result<(), SpecError> {
    if !is_parquet_path(path) {
        return Ok(());
    }
    let key = path_key(path);
    let Some(requested) = requested_parquet_columns(params)? else {
        projections.insert(key, None);
        return Ok(());
    };
    let entry = projections.entry(key).or_insert_with(|| Some(Vec::new()));
    if let Some(union) = entry {
        for column in requested {
            if !union.contains(&column) {
                union.push(column);
            }
        }
    }
    Ok(())
}

fn gather_parquet_projections(
    spec: &DatasetSpec,
    base_dir: &Path,
) -> Result<HashMap<PathBuf, Option<Vec<String>>>, SpecError> {
    let mut projections = HashMap::new();
    for source in &spec.sources {
        let source_params = effective_params(&spec.params, &source.params);
        for (_, path) in resolve_named(&source.input, base_dir) {
            update_projection(&mut projections, &path, &source_params)?;
        }
        for variation in &source.variations {
            let mut params = source_params.clone();
            if !variation.params.is_empty_value() {
                params = effective_params(&params, &variation.params);
            }
            for (_, path) in resolve_named(&variation.input, base_dir) {
                update_projection(&mut projections, &path, &params)?;
            }
        }
    }
    Ok(projections)
}

/// Gather every input referenced by `spec` (sources + variations) into named
/// in-memory payloads, reading each unique file once.
fn gather_sources(
    spec: &DatasetSpec,
    base_dir: &Path,
    budget: &mut ReadBudget,
) -> Result<Vec<InMemorySource>, SpecError> {
    let parquet_projections = gather_parquet_projections(spec, base_dir)?;
    let mut seen: HashMap<String, ()> = HashMap::new();
    let mut out: Vec<InMemorySource> = Vec::new();
    let mut add_input = |input: &Value| -> Result<(), SpecError> {
        for (name, path) in resolve_named(input, base_dir) {
            if seen.insert(name.clone(), ()).is_some() {
                continue;
            }
            let parquet_columns = parquet_projections
                .get(&path_key(&path))
                .and_then(|columns| columns.as_deref());
            let payload = source_payload(&path, parquet_columns, budget)?;
            out.push(InMemorySource { name, payload });
        }
        Ok(())
    };
    for source in &spec.sources {
        add_input(&source.input)?;
        for variation in &source.variations {
            add_input(&variation.input)?;
        }
    }
    Ok(out)
}

fn is_parquet_path(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|ext| ext.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("parquet" | "pq")
    )
}

fn source_payload(
    path: &Path,
    parquet_columns: Option<&[String]>,
    budget: &mut ReadBudget,
) -> Result<SourcePayload, SpecError> {
    if is_parquet_path(path) {
        return Ok(SourcePayload::Frame(read_parquet_frame_with_budget(
            path,
            parquet_columns,
            budget,
        )?));
    }
    Ok(SourcePayload::Bytes(budget.read(path)?))
}

/// Read `partitions.index_file` lists referenced by `spec` into `index_lists`.
fn gather_index_lists(
    spec: &DatasetSpec,
    base_dir: &Path,
    budget: &mut ReadBudget,
) -> Result<HashMap<String, Vec<i64>>, SpecError> {
    let mut out = HashMap::new();
    let Some(p) = &spec.partitions else {
        return Ok(out);
    };
    if p.by != Some(PartitionBy::IndexFile) {
        return Ok(out);
    }
    for (part, file) in [
        ("train", &p.train_file),
        ("test", &p.test_file),
        ("predict", &p.predict_file),
    ] {
        if let Some(file) = file {
            out.insert(
                part.to_string(),
                read_index_file(&base_dir.join(file), budget)?,
            );
        }
    }
    Ok(out)
}

/// Parse `folds.file` (when set) into folds; `None` otherwise.
fn gather_folds(
    spec: &DatasetSpec,
    base_dir: &Path,
    budget: &mut ReadBudget,
) -> Result<Option<Vec<Fold>>, SpecError> {
    let Some(folds) = &spec.folds else {
        return Ok(None);
    };
    // inline / column folds are handled by the core; only the file path needs IO.
    if !folds.inline.is_empty() || folds.column.as_deref().is_some_and(|s| !s.is_empty()) {
        return Ok(None);
    }
    if let Some(file) = folds.file.as_deref().filter(|s| !s.is_empty()) {
        return Ok(Some(parse_fold_file_with_budget(
            &base_dir.join(file),
            folds.format.value(),
            budget,
        )?));
    }
    Ok(None)
}

/// Load, role-split, join and partition `spec` into an [`AssembledDataset`].
///
/// The facade reads every input from `base_dir`, then delegates to the shared
/// fs-free core [`assemble_in_memory_with_tabular_limits`].
pub fn assemble(spec: &DatasetSpec, base_dir: &Path) -> Result<AssembledDataset, SpecError> {
    assemble_with_limits(spec, base_dir, LoadLimits::default())
}

/// Assemble with explicit host-selected read/decompression/shape budgets.
pub fn assemble_with_limits(
    spec: &DatasetSpec,
    base_dir: &Path,
    limits: LoadLimits,
) -> Result<AssembledDataset, SpecError> {
    assemble_with_budget(spec, base_dir, &mut ReadBudget::new(limits)?)
}

pub(crate) fn assemble_with_budget(
    spec: &DatasetSpec,
    base_dir: &Path,
    budget: &mut ReadBudget,
) -> Result<AssembledDataset, SpecError> {
    let sources = gather_sources(spec, base_dir, budget)?;
    let index_lists = gather_index_lists(spec, base_dir, budget)?;
    let fold_inline = gather_folds(spec, base_dir, budget)?;
    assemble_in_memory_with_tabular_limits(
        spec,
        &sources,
        &index_lists,
        fold_inline.as_deref(),
        Some(budget.limits.tabular()),
    )
}

fn read_index_file(path: &Path, budget: &mut ReadBudget) -> Result<Vec<i64>, SpecError> {
    if !path.exists() {
        return Err(SpecError::new(format!(
            "partitions.index_file: file not found: {}",
            path.display()
        )));
    }
    let text = String::from_utf8(budget.read(path)?)
        .map_err(|e| SpecError::new(format!("cannot read index file {}: {e}", path.display())))?;
    let text = text.trim();
    if text.is_empty() {
        return Ok(vec![]);
    }
    if text.starts_with('[') {
        let arr: Vec<i64> = serde_json::from_str(text)
            .map_err(|e| SpecError::new(format!("index_file JSON: {e}")))?;
        return Ok(arr);
    }
    text.replace(',', "\n")
        .lines()
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(|t| {
            t.parse::<i64>()
                .map_err(|_| SpecError::new(format!("index_file: non-integer token '{t}'")))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use arrow_array::{ArrayRef, Float64Array, RecordBatch};
    use arrow_schema::{DataType, Field, Schema};
    use parquet::arrow::arrow_writer::ArrowWriter;
    use serde_json::json;
    use std::sync::Arc;

    fn write_parquet(path: &Path) {
        let schema = Arc::new(Schema::new(vec![
            Field::new("a", DataType::Float64, false),
            Field::new("b", DataType::Float64, false),
        ]));
        let batch = RecordBatch::try_new(
            schema,
            vec![
                Arc::new(Float64Array::from(vec![1.0, 2.0])) as ArrayRef,
                Arc::new(Float64Array::from(vec![10.0, 20.0])) as ArrayRef,
            ],
        )
        .unwrap();
        let file = std::fs::File::create(path).unwrap();
        let mut writer = ArrowWriter::try_new(file, batch.schema(), None).unwrap();
        writer.write(&batch).unwrap();
        writer.close().unwrap();
    }

    #[test]
    fn shared_parquet_path_applies_format_columns_per_source() {
        let tmp = tempfile::tempdir().unwrap();
        write_parquet(&tmp.path().join("data.parquet"));
        let spec = DatasetSpec::from_value(&json!({
            "sources": [
                {
                    "id": "left",
                    "role": "features",
                    "input": "data.parquet",
                    "params": {"format": {"columns": ["a"]}}
                },
                {
                    "id": "right",
                    "role": "features",
                    "input": "data.parquet",
                    "params": {"format": {"columns": ["b"]}}
                }
            ]
        }))
        .unwrap();

        let assembled = assemble(&spec, tmp.path()).unwrap();
        let block = assembled.blocks.get("train").unwrap();

        assert_eq!(block.feature_headers, vec![vec!["a"], vec!["b"]]);
        assert_eq!(block.x[0].data, vec![1.0, 2.0]);
        assert_eq!(block.x[1].data, vec![10.0, 20.0]);
    }
}
