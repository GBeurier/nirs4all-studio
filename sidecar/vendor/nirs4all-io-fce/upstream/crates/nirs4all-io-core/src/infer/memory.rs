// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Browser/no-filesystem dataset inference over named byte buffers.
//!
//! This is the fs-free counterpart of the native facade's path inference. It
//! keeps every domain decision in `nirs4all-io-core` (conventions, column roles,
//! identity, signal/task detectors) and only replaces `Path` reads by named
//! in-memory payloads.

use std::collections::{BTreeSet, HashMap};

use serde_json::{json, Map, Value};

use crate::conventions::{assignments_to_spec_dict, match_items, resolve_profiles};
use crate::infer::column_roles::{infer_column_roles, structure_kind};
use crate::infer::describe::{describe_text, FileDescription};
use crate::infer::detectors::{detect_signal_type, detect_task_type};
use crate::infer::identity::{detect_sample_id, repetition_profile};
use crate::infer::plan::{DatasetPlan, Decision};
use crate::infer::table::{ColDtype, ColumnProfile, NumericKind, TableProfile};
use crate::pyfmt::{py_round, py_str_scalar};
use crate::spec::dataset_spec::LoadingParams;
use crate::spec::selectors::Selector;
use crate::spec::{DatasetSpec, SpecError};

const DEFAULT_CONVENTIONS: &[&str] = &["nirs4all-classic"];

#[derive(Debug, Clone)]
pub struct NamedBytes {
    pub name: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct DecodedRecordSet {
    pub source: String,
    pub format: Option<String>,
    pub records: Vec<Value>,
}

pub fn infer_named_bytes(
    files: &[NamedBytes],
    conventions: Option<&[String]>,
) -> Result<DatasetPlan, SpecError> {
    let conv: Vec<&str> = match conventions {
        Some(c) if !c.is_empty() => c.iter().map(String::as_str).collect(),
        _ => DEFAULT_CONVENTIONS.to_vec(),
    };
    let profiles = resolve_profiles(&conv)?;
    let names = files.iter().map(|f| f.name.clone()).collect::<Vec<_>>();
    let result = match_items(&names, &profiles, None, None);
    let by_name = files
        .iter()
        .map(|f| (f.name.clone(), f))
        .collect::<HashMap<_, _>>();

    let mut plan = DatasetPlan {
        input: json!({"kind": "memory", "files": names}),
        ..Default::default()
    };

    let mut spec_dict: Value = if result
        .vendor
        .as_ref()
        .is_some_and(|v| !v.spectra.is_empty())
    {
        let v = result.vendor.as_ref().unwrap();
        plan.structure = Some(Decision::new(
            "vendor_corpus",
            0.9,
            vec![format!(
                "{} vendor spectra + {} reference file(s)",
                v.spectra.len(),
                v.reference.len()
            )],
        ));
        assignments_to_spec_dict(&result, "dataset")
    } else if !result.assignments.is_empty() {
        let (kind, score) = structure_kind(&result);
        plan.structure = Some(Decision::new(
            kind,
            score,
            vec![format!(
                "matched {} file(s) via conventions",
                result.assignments.len()
            )],
        ));
        plan.assignments = result
            .assignments
            .iter()
            .map(|a| {
                json!({
                    "ref": a.name,
                    "role": a.role.value(),
                    "partition": a.partition.map(|p| p.value()),
                    "source_index": a.source_index,
                    "score": if a.matched_pattern.starts_with("bare:") { 0.75 } else { 0.9 },
                    "evidence": [format!("filename matches {}", a.matched_pattern)],
                })
            })
            .collect();
        assignments_to_spec_dict(&result, "dataset")
    } else if files.len() == 1 {
        plan.structure = Some(Decision::new(
            "single_combined",
            0.7,
            vec!["one tabular file; column roles inferred".into()],
        ));
        infer_single_file(files.first().unwrap(), &mut plan)?
    } else {
        plan.structure = Some(Decision::new(
            "unknown",
            0.2,
            vec![format!("{} file(s), no convention match", files.len())],
        ));
        plan.warnings
            .push("no convention matched; provide an explicit DatasetSpec or conventions".into());
        json!({"name": "dataset", "sources": []})
    };

    enrich_params(&mut spec_dict, &by_name, &mut plan);
    infer_identity_and_alignment(&mut spec_dict, &by_name, &mut plan);
    infer_signal_and_task(&mut spec_dict, &by_name, &mut plan);
    if let Some(t) = &plan.task_type {
        if matches!(t.value.as_str(), Some("binary") | Some("multiclass")) {
            if let Some(agg) = spec_dict
                .get_mut("aggregate")
                .and_then(|v| v.as_object_mut())
            {
                agg.insert("method".into(), json!("vote"));
            }
        }
    }

    if !result.unmatched.is_empty() {
        plan.warnings
            .push(format!("unassigned files: {:?}", result.unmatched));
    }
    plan.warnings.extend(result.warnings.iter().cloned());

    plan.resolved_spec = Some(DatasetSpec::from_value(&spec_dict)?);
    let mut scores: Vec<f64> = vec![];
    for d in [&plan.structure, &plan.signal_type, &plan.task_type]
        .into_iter()
        .flatten()
    {
        scores.push(d.score);
    }
    let mean = if scores.is_empty() {
        0.0
    } else {
        scores.iter().sum::<f64>() / scores.len() as f64
    };
    plan.overall_score = py_round(mean, 3);
    plan.recommendations
        .push("review the resolved_spec; edit it before load/materialize".into());
    Ok(plan)
}

pub fn infer_decoded_records(record_sets: &[DecodedRecordSet]) -> Result<DatasetPlan, SpecError> {
    let non_empty = record_sets
        .iter()
        .filter(|set| !set.records.is_empty())
        .collect::<Vec<_>>();
    if non_empty.is_empty() {
        return Err(SpecError::new("no decoded records supplied"));
    }

    let total_records = non_empty.iter().map(|set| set.records.len()).sum::<usize>();
    let mut plan = DatasetPlan {
        input: json!({
            "kind": "decoded_records",
            "sources": non_empty.iter().map(|set| set.source.clone()).collect::<Vec<_>>(),
        }),
        structure: Some(Decision::new(
            if non_empty.len() > 1 {
                "decoded_record_corpus"
            } else {
                "decoded_records"
            },
            0.86,
            vec![format!(
                "{} decoded record(s) from {} source file(s)",
                total_records,
                non_empty.len()
            )],
        )),
        ..Default::default()
    };

    let mut columns = Vec::new();
    let mut spec_sources = Vec::new();
    let mut all_target_values = Vec::new();
    let mut sample_ids = Vec::new();
    let mut signal_matrix = Vec::new();
    let mut signal_ncols = 0usize;
    let mut axis_values = Vec::new();
    let mut axis_unit = String::new();
    let mut signal_name = String::new();
    let mut formats = BTreeSet::new();
    let mut metadata_values: HashMap<String, Vec<String>> = HashMap::new();

    for (idx, set) in non_empty.iter().enumerate() {
        if let Some(format) = &set.format {
            if !format.is_empty() {
                formats.insert(format.clone());
            }
        }
        let partition = infer_partition_from_name(&set.source);
        let source_id = unique_source_id(&set.source, idx);
        let has_targets = set.records.iter().any(|record| {
            record
                .get("targets")
                .and_then(Value::as_object)
                .is_some_and(|m| !m.is_empty())
        });
        let mut source = Map::new();
        source.insert("id".into(), json!(source_id));
        source.insert(
            "role".into(),
            json!(if has_targets { "mixed" } else { "features" }),
        );
        source.insert("input".into(), json!(set.source));
        source.insert("modality".into(), json!("spectroscopy"));
        if let Some(partition) = partition {
            source.insert("partition".into(), json!(partition));
        }
        let mut format_params = Map::new();
        format_params.insert("decoded_records".into(), json!(true));
        if let Some(format) = &set.format {
            format_params.insert("format".into(), json!(format));
        }
        source.insert(
            "params".into(),
            json!({
                "format": format_params,
            }),
        );

        let mut signal_keys = BTreeSet::new();
        let mut feature_keys = BTreeSet::new();
        let mut target_keys = BTreeSet::new();
        let mut metadata_keys = BTreeSet::new();
        // The metadata key that carries the per-sample identity (`sample_id`
        // preferred, else `id`); it becomes the source `key` so it is treated as
        // identity, never as a feature or metadata column (D-R7 / Codex #3).
        let mut identity_key: Option<String> = None;

        for record in &set.records {
            if let Some(metadata) = record.get("metadata").and_then(Value::as_object) {
                for (key, value) in metadata {
                    metadata_keys.insert(key.clone());
                    if let Some(value) = value_string(value) {
                        metadata_values.entry(key.clone()).or_default().push(value);
                    }
                }
                if identity_key.is_none() {
                    if metadata.contains_key("sample_id") {
                        identity_key = Some("sample_id".to_string());
                    } else if metadata.contains_key("id") {
                        identity_key = Some("id".to_string());
                    }
                }
                if let Some(sample_id) = metadata
                    .get("sample_id")
                    .or_else(|| metadata.get("id"))
                    .and_then(value_string)
                {
                    sample_ids.push(sample_id);
                }
            }
            if let Some(targets) = record.get("targets").and_then(Value::as_object) {
                for (key, value) in targets {
                    target_keys.insert(key.clone());
                    if let Some(v) = value.as_f64() {
                        all_target_values.push(v);
                    } else if let Some(s) = value.as_str() {
                        if let Ok(v) = s.trim().parse::<f64>() {
                            all_target_values.push(v);
                        }
                    }
                }
            }
            let Some(signals) = record.get("signals").and_then(Value::as_object) else {
                continue;
            };
            for key in signals.keys() {
                signal_keys.insert(key.clone());
            }
            let Some((key, signal)) = pick_signal(signals, signal_name.as_str()) else {
                continue;
            };
            if signal_name.is_empty() {
                signal_name = key.to_string();
            }
            let values = signal_values(signal);
            if values.is_empty() {
                continue;
            }
            if feature_keys.is_empty() {
                for label in axis_labels_from_values(&signal_axis_values(signal)) {
                    feature_keys.insert(label);
                }
            }
            if signal_ncols == 0 {
                signal_ncols = values.len();
                axis_values = signal_axis_values(signal);
                axis_unit = signal
                    .get("axis")
                    .and_then(|axis| axis.get("unit"))
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
            }
            if values.len() == signal_ncols {
                signal_matrix.extend(values);
            }
        }

        // Emit explicit `columns` that match `records_to_frame`'s output exactly so
        // the resolved spec is directly assembleable (Codex #3): the assembler builds
        // a frame of [axis-label features..., target keys..., metadata keys...]; we
        // select targets and metadata by key and let `rest` pick up the (variable,
        // axis-labelled) feature columns — that keeps feature selection in lock-step
        // with `records_to_frame` regardless of axis labelling. The identity key is
        // excluded from metadata and carried as the source `key` (treated as identity).
        let metadata_select: Vec<String> = metadata_keys
            .iter()
            .filter(|k| Some(k.as_str()) != identity_key.as_deref())
            .cloned()
            .collect();
        let mut source_columns: Vec<Value> = Vec::new();
        if !target_keys.is_empty() {
            source_columns.push(json!({
                "role": "targets",
                "select": target_keys.iter().cloned().collect::<Vec<_>>(),
            }));
        }
        if !metadata_select.is_empty() {
            source_columns.push(json!({"role": "metadata", "select": metadata_select}));
        }
        source_columns.push(json!({"role": "features", "select": "rest"}));
        // A source that declares per-column roles spanning more than `features`
        // (targets or metadata present) must carry role `mixed` (spec validation);
        // a pure features+rest source stays `features`.
        if source_columns.len() > 1 {
            source.insert("role".into(), json!("mixed"));
        }
        source.insert("columns".into(), Value::Array(source_columns));
        if let Some(id_key) = &identity_key {
            source.insert("key".into(), json!(id_key));
        }
        spec_sources.push(Value::Object(source));

        columns.push(json!({
            "ref": set.source,
            "record_roles": {
                "features": feature_keys.into_iter().collect::<Vec<_>>(),
                "signals": signal_keys.into_iter().collect::<Vec<_>>(),
                "targets": target_keys.into_iter().collect::<Vec<_>>(),
                "metadata": metadata_keys.into_iter().collect::<Vec<_>>(),
            },
        }));
    }

    plan.columns = columns;
    if !axis_values.is_empty() {
        let lo = axis_values.iter().copied().fold(f64::INFINITY, f64::min);
        let hi = axis_values
            .iter()
            .copied()
            .fold(f64::NEG_INFINITY, f64::max);
        plan.axis = Some(json!({
            "unit": if axis_unit.is_empty() { "index" } else { axis_unit.as_str() },
            "n": axis_values.len(),
            "range": [lo, hi],
            "score": 0.9,
            "source": "decoded spectral record axis",
        }));
    }
    if !sample_ids.is_empty() {
        let unique = sample_ids.iter().collect::<BTreeSet<_>>().len() == sample_ids.len();
        plan.identity = Some(Decision {
            value: json!("metadata.sample_id"),
            score: if unique { 0.88 } else { 0.62 },
            evidence: vec![if unique {
                "decoded records expose unique metadata.sample_id values".into()
            } else {
                "decoded records expose repeated metadata.sample_id values".into()
            }],
            alternatives: vec![],
            ambiguous: !unique,
        });
    }
    if signal_ncols > 0 && !signal_matrix.is_empty() {
        let wl = if axis_unit == "nm" && axis_values.len() == signal_ncols {
            Some(axis_values.as_slice())
        } else {
            None
        };
        let (sig, score, reason) = detect_signal_type(&signal_matrix, signal_ncols, wl, 0.7);
        plan.signal_type = Some(Decision {
            value: json!(sig.clone()),
            score,
            evidence: vec![reason],
            alternatives: vec![],
            ambiguous: sig == "unknown",
        });
    }
    if !all_target_values.is_empty() {
        let (task, score) = detect_task_type(&all_target_values, 0.05);
        plan.task_type = Some(Decision::new(
            task,
            score,
            vec!["decoded record target value distribution".into()],
        ));
    }

    let mut spec_dict = Map::new();
    spec_dict.insert("name".into(), json!("decoded-spectra-dataset"));
    spec_dict.insert("sources".into(), Value::Array(spec_sources));
    if let Some(identity) = &plan.identity {
        if identity.value.as_str() == Some("metadata.sample_id") {
            spec_dict.insert(
                "sample_index".into(),
                json!({"by": "id", "key": "metadata.sample_id"}),
            );
        }
    }
    infer_decoded_repetition(&metadata_values, total_records, &mut spec_dict, &mut plan);
    if let Some(task) = &plan.task_type {
        if let Some(t) = task.value.as_str() {
            spec_dict.insert("task_type".into(), json!(t));
            if matches!(t, "binary" | "multiclass") {
                spec_dict.insert("aggregate".into(), json!({"method": "vote"}));
            }
        }
    }
    let mut params = Map::new();
    if let Some(signal) = &plan.signal_type {
        if let Some(sig) = signal.value.as_str().and_then(spec_signal_type) {
            params.insert("signal_type".into(), json!(sig));
        }
    }
    if !formats.is_empty() {
        params.insert(
            "format".into(),
            json!({"decoded_formats": formats.into_iter().collect::<Vec<_>>()}),
        );
    }
    if !params.is_empty() {
        spec_dict.insert("params".into(), Value::Object(params));
    }

    plan.resolved_spec = Some(DatasetSpec::from_value(&Value::Object(spec_dict))?);
    let mut scores = Vec::new();
    for d in [
        &plan.structure,
        &plan.signal_type,
        &plan.task_type,
        &plan.identity,
    ]
    .into_iter()
    .flatten()
    {
        scores.push(d.score);
    }
    plan.overall_score = py_round(scores.iter().sum::<f64>() / scores.len() as f64, 3);
    plan.recommendations.push(
        "decoded-record inference is browser-native; persist the DatasetSpec next to exported records"
            .into(),
    );
    Ok(plan)
}

pub fn infer_browser_dataset(
    files: &[NamedBytes],
    record_sets: &[DecodedRecordSet],
    conventions: Option<&[String]>,
) -> Result<DatasetPlan, SpecError> {
    let mut errors = Vec::new();
    let mut file_plan = if files.is_empty() {
        None
    } else {
        match infer_named_bytes(files, conventions) {
            Ok(plan) => Some(plan),
            Err(err) => {
                errors.push(("files", err.message));
                None
            }
        }
    };
    let mut record_plan = if record_sets.iter().any(|set| !set.records.is_empty()) {
        match infer_decoded_records(record_sets) {
            Ok(plan) => Some(plan),
            Err(err) => {
                errors.push(("decoded_records", err.message));
                None
            }
        }
    } else {
        None
    };

    let use_file_plan = match (&file_plan, &record_plan) {
        (Some(file), Some(records)) => should_prefer_file_plan(files, file, records),
        (Some(_), None) => true,
        (None, Some(_)) => false,
        (None, None) => {
            let message = if errors.is_empty() {
                "no files or decoded records supplied".to_string()
            } else {
                errors
                    .iter()
                    .map(|(kind, msg)| format!("{kind}: {msg}"))
                    .collect::<Vec<_>>()
                    .join("; ")
            };
            return Err(SpecError::new(message));
        }
    };

    let mut plan = if use_file_plan {
        file_plan.take().unwrap()
    } else {
        record_plan.take().unwrap()
    };
    let selected = if use_file_plan {
        "files"
    } else {
        "decoded_records"
    };
    let secondary = if use_file_plan {
        record_plan.as_ref().map(|plan| ("decoded_records", plan))
    } else {
        file_plan.as_ref().map(|plan| ("files", plan))
    };
    annotate_browser_plan(&mut plan, selected, files, record_sets, secondary, &errors)?;
    Ok(plan)
}

fn infer_single_file(file: &NamedBytes, plan: &mut DatasetPlan) -> Result<Value, SpecError> {
    let desc = describe_bytes(file);
    let params = LoadingParams {
        delimiter: Some(desc.delimiter.to_string()),
        has_header: Some(true),
        ..Default::default()
    };
    let Some(table) = read_table_bytes(&file.bytes, &params) else {
        return Ok(json!({
            "name": file_stem(&file.name),
            "sources": [{"id": "data", "role": "features", "input": file.name}],
        }));
    };
    let profile = table.to_table_profile();
    let mut guesses = infer_column_roles(&desc, &profile);
    let id_guess = detect_sample_id(&profile);
    let id_col = id_guess.as_ref().map(|g| g.column.clone());
    if let Some(g) = &id_guess {
        plan.identity = Some(Decision {
            value: Value::from(g.column.clone()),
            score: g.score,
            evidence: g.evidence.clone(),
            alternatives: vec![],
            ambiguous: !g.unique,
        });
        for guess in &mut guesses {
            if guess["col"].as_str() == Some(g.column.as_str()) {
                guess["role"] = json!("id");
                guess["evidence"] = json!(["detected sample-id column"]);
            }
        }
    }
    plan.columns = vec![json!({"ref": file.name, "column_roles": guesses.clone()})];

    let mut columns: Vec<Value> = vec![];
    for role in ["features", "targets", "metadata"] {
        let cols: Vec<Value> = guesses
            .iter()
            .filter(|g| g["role"].as_str() == Some(role) && g["col"].as_str() != id_col.as_deref())
            .map(|g| g["col"].clone())
            .collect();
        if !cols.is_empty() {
            columns.push(json!({"role": role, "select": cols}));
        }
    }
    let mut source = Map::new();
    source.insert("id".into(), json!("data"));
    source.insert("role".into(), json!("mixed"));
    source.insert("input".into(), json!(file.name));
    source.insert("columns".into(), Value::Array(columns));
    source.insert(
        "params".into(),
        json!({"delimiter": desc.delimiter.to_string(), "has_header": true}),
    );

    let mut spec = Map::new();
    spec.insert("name".into(), json!(file_stem(&file.name)));
    if let Some(id_col) = &id_col {
        source.insert("key".into(), json!(id_col));
        spec.insert("sample_index".into(), json!({"by": "id", "key": id_col}));
    }
    if let Some((observation_col, repetition_col, params)) =
        infer_table_repetition(&table, id_col.as_deref())
    {
        apply_repetition_fields(
            &mut spec,
            observation_col.as_deref(),
            repetition_col.as_deref(),
        );
        plan.params
            .as_object_mut()
            .unwrap()
            .insert("repetition".into(), params);
    }
    spec.insert("sources".into(), Value::Array(vec![Value::Object(source)]));
    Ok(Value::Object(spec))
}

pub(crate) fn describe_bytes(file: &NamedBytes) -> FileDescription {
    let text = String::from_utf8_lossy(&file.bytes);
    describe_text(&text, 50)
}

pub(crate) fn source_first_input(src: &Value) -> Option<String> {
    match src.get("input") {
        Some(Value::Array(a)) => a.first().and_then(|v| v.as_str()).map(str::to_string),
        Some(Value::String(s)) => Some(s.clone()),
        _ => None,
    }
}

pub(crate) fn file_stem(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    match base.rfind('.') {
        Some(idx) if idx > 0 => base[..idx].to_string(),
        _ => base.to_string(),
    }
}

pub(crate) fn unique_source_id(source: &str, idx: usize) -> String {
    let stem = file_stem(source);
    let mut id = String::new();
    for ch in stem.chars() {
        if ch.is_ascii_alphanumeric() {
            id.push(ch.to_ascii_lowercase());
        } else if !id.ends_with('_') {
            id.push('_');
        }
    }
    let id = id.trim_matches('_');
    if id.is_empty() {
        format!("source_{}", idx + 1)
    } else {
        format!("{}_{}", id, idx + 1)
    }
}

pub(crate) fn infer_partition_from_name(name: &str) -> Option<&'static str> {
    let low = file_stem(name).to_ascii_lowercase();
    let tokens = low
        .split(|ch: char| !ch.is_ascii_alphanumeric())
        .filter(|s| !s.is_empty())
        .collect::<BTreeSet<_>>();
    if tokens
        .iter()
        .any(|t| matches!(*t, "test" | "val" | "valid" | "validation"))
    {
        Some("test")
    } else if tokens
        .iter()
        .any(|t| matches!(*t, "train" | "cal" | "calibration"))
    {
        Some("train")
    } else {
        None
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
        .map(|values| values.iter().filter_map(Value::as_f64).collect())
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

fn axis_labels_from_values(values: &[f64]) -> Vec<String> {
    values.iter().copied().map(axis_label).collect()
}

fn axis_label(value: f64) -> String {
    if value.is_finite() && (value.fract().abs() < 1e-9) {
        format!("{}", value as i64)
    } else {
        py_round(value, 6).to_string()
    }
}

fn spec_signal_type(signal: &str) -> Option<&'static str> {
    match signal {
        "absorbance" => Some("absorbance"),
        "reflectance" => Some("reflectance"),
        "reflectance%" => Some("reflectance%"),
        "transmittance" => Some("transmittance"),
        "transmittance%" => Some("transmittance%"),
        "kubelka-munk" => Some("kubelka-munk"),
        _ => None,
    }
}

fn should_prefer_file_plan(
    files: &[NamedBytes],
    file_plan: &DatasetPlan,
    record_plan: &DatasetPlan,
) -> bool {
    if files.is_empty() {
        return false;
    }
    let structure = decision_str(&file_plan.structure);
    if structure == Some("unknown") {
        return false;
    }
    let structure_score = file_plan
        .structure
        .as_ref()
        .map(|d| d.score)
        .unwrap_or(file_plan.overall_score);
    let all_tabular = files.iter().all(|file| looks_tabular(&file.name));
    let has_column_roles = file_plan
        .columns
        .iter()
        .any(|col| col.get("column_roles").is_some());

    if matches!(structure, Some("train_test_folder" | "x_y_separate")) && structure_score >= 0.85 {
        return true;
    }
    if all_tabular
        && structure_score >= 0.65
        && (structure != Some("single_combined") || has_column_roles)
    {
        return true;
    }
    structure == Some("vendor_corpus") && !record_plan_has_dataset_roles(record_plan)
}

fn annotate_browser_plan(
    plan: &mut DatasetPlan,
    selected: &str,
    files: &[NamedBytes],
    record_sets: &[DecodedRecordSet],
    secondary: Option<(&str, &DatasetPlan)>,
    errors: &[(&str, String)],
) -> Result<(), SpecError> {
    plan.input = json!({
        "kind": "browser_dataset",
        "selected_inference": selected,
        "files": files.iter().map(|file| file.name.clone()).collect::<Vec<_>>(),
        "decoded_sources": record_sets
            .iter()
            .filter(|set| !set.records.is_empty())
            .map(|set| set.source.clone())
            .collect::<Vec<_>>(),
    });
    for (kind, message) in errors {
        plan.warnings
            .push(format!("{kind} inference failed: {message}"));
    }
    if let Some((label, secondary)) = secondary {
        merge_secondary_evidence(plan, label, secondary);
        if selected == "decoded_records" {
            merge_secondary_role_sources(plan, secondary)?;
        } else if label == "decoded_records" {
            merge_decoded_roles_into_file_sources(plan, secondary, files)?;
        }
    }
    plan.params.as_object_mut().unwrap().insert(
        "browser_dataset".into(),
        json!({"selected_inference": selected}),
    );
    if !plan
        .recommendations
        .iter()
        .any(|r| r.contains("browser dataset"))
    {
        plan.recommendations
            .push("browser dataset inference combined raw files and decoded spectral records in nirs4all-io".into());
    }
    Ok(())
}

fn merge_secondary_evidence(plan: &mut DatasetPlan, label: &str, secondary: &DatasetPlan) {
    if plan.axis.is_none() {
        plan.axis = secondary.axis.clone();
    }
    if should_copy_decision(&plan.identity, &secondary.identity) {
        plan.identity = secondary.identity.clone();
    }
    if should_copy_decision(&plan.signal_type, &secondary.signal_type) {
        plan.signal_type = secondary.signal_type.clone();
    }
    if should_copy_decision(&plan.task_type, &secondary.task_type) {
        plan.task_type = secondary.task_type.clone();
    }
    if plan.assignments.is_empty() {
        plan.assignments = secondary.assignments.clone();
    } else if !secondary.assignments.is_empty() {
        plan.assignments.push(json!({
            "analysis": label,
            "assignments": secondary.assignments.clone(),
        }));
    }
    for col in &secondary.columns {
        let mut tagged = col.clone();
        if let Some(obj) = tagged.as_object_mut() {
            obj.entry("analysis").or_insert_with(|| json!(label));
        }
        plan.columns.push(tagged);
    }
    for warning in &secondary.warnings {
        plan.warnings.push(format!("{label}: {warning}"));
    }
    for recommendation in &secondary.recommendations {
        plan.recommendations
            .push(format!("{label}: {recommendation}"));
    }
}

fn merge_secondary_role_sources(
    plan: &mut DatasetPlan,
    secondary: &DatasetPlan,
) -> Result<(), SpecError> {
    let Some(primary_spec) = &plan.resolved_spec else {
        return Ok(());
    };
    let Some(secondary_spec) = &secondary.resolved_spec else {
        return Ok(());
    };
    let mut spec = primary_spec.to_value();
    let secondary_spec = secondary_spec.to_value();
    let existing_inputs = spec
        .get("sources")
        .and_then(Value::as_array)
        .map(|sources| {
            sources
                .iter()
                .flat_map(source_input_keys)
                .collect::<BTreeSet<_>>()
        })
        .unwrap_or_default();
    let Some(sources) = spec.get_mut("sources").and_then(Value::as_array_mut) else {
        return Ok(());
    };
    let mut known = existing_inputs;
    let secondary_sources = secondary_spec
        .get("sources")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for source in secondary_sources {
        let role = source.get("role").and_then(Value::as_str).unwrap_or("");
        if !matches!(role, "targets" | "metadata" | "weights") {
            continue;
        }
        let keys = source_input_keys(&source);
        if keys.iter().any(|key| known.contains(key)) {
            continue;
        }
        for key in keys {
            known.insert(key);
        }
        sources.push(source);
    }
    plan.resolved_spec = Some(DatasetSpec::from_value(&spec)?);
    Ok(())
}

#[derive(Debug, Default)]
struct DecodedRoleHint {
    features: BTreeSet<String>,
    targets: BTreeSet<String>,
    metadata: BTreeSet<String>,
    weights: BTreeSet<String>,
}

impl DecodedRoleHint {
    fn is_empty(&self) -> bool {
        self.features.is_empty()
            && self.targets.is_empty()
            && self.metadata.is_empty()
            && self.weights.is_empty()
    }
}

fn merge_decoded_roles_into_file_sources(
    plan: &mut DatasetPlan,
    decoded: &DatasetPlan,
    files: &[NamedBytes],
) -> Result<(), SpecError> {
    if decision_str(&plan.structure) != Some("single_combined") {
        return Ok(());
    }
    let Some(primary_spec) = &plan.resolved_spec else {
        return Ok(());
    };
    let mut spec = primary_spec.to_value();
    let Some(sources) = spec.get_mut("sources").and_then(Value::as_array_mut) else {
        return Ok(());
    };

    let mut changed = false;
    for source in sources.iter_mut() {
        let Some(input) = source_first_input(source) else {
            continue;
        };
        let hint = decoded_role_hint_for_source(decoded, &input);
        if hint.is_empty() {
            continue;
        }
        let Some(file) = find_named_file(files, &input) else {
            continue;
        };
        let Some(table) = read_table_bytes(&file.bytes, &params_from(source)) else {
            continue;
        };
        let headers = table.column_names();
        let feature_cols =
            role_columns_from_hint(&headers, &hint.features, &hint.targets, &hint.metadata);
        let target_cols =
            role_columns_from_hint(&headers, &hint.targets, &BTreeSet::new(), &BTreeSet::new());
        let metadata_cols =
            role_columns_from_hint(&headers, &hint.metadata, &hint.targets, &hint.features);
        let weight_cols =
            role_columns_from_hint(&headers, &hint.weights, &hint.targets, &hint.metadata);
        let feature_cols = if feature_cols.is_empty() {
            inferred_axis_columns(&headers, &target_cols, &metadata_cols)
        } else {
            feature_cols
        };

        let mut columns = Vec::new();
        push_column_role(&mut columns, "features", &feature_cols);
        push_column_role(&mut columns, "targets", &target_cols);
        push_column_role(&mut columns, "metadata", &metadata_cols);
        push_column_role(&mut columns, "weights", &weight_cols);
        if columns.is_empty() {
            continue;
        }

        if let Some(obj) = source.as_object_mut() {
            obj.insert("role".into(), json!("mixed"));
            obj.insert("columns".into(), Value::Array(columns));
        }
        replace_plan_column_roles(
            plan,
            &input,
            &headers,
            &feature_cols,
            &target_cols,
            &metadata_cols,
            &weight_cols,
        );
        changed = true;
    }

    if changed {
        plan.resolved_spec = Some(DatasetSpec::from_value(&spec)?);
        plan.recommendations.push(
            "single-table column roles were refined from decoded records emitted by nirs4all-formats"
                .into(),
        );
    }
    Ok(())
}

fn decoded_role_hint_for_source(plan: &DatasetPlan, input: &str) -> DecodedRoleHint {
    let mut hint = DecodedRoleHint::default();
    for column in &plan.columns {
        let Some(reference) = column.get("ref").and_then(Value::as_str) else {
            continue;
        };
        if reference != input && file_stem(reference) != file_stem(input) {
            continue;
        }
        let Some(roles) = column.get("record_roles").and_then(Value::as_object) else {
            continue;
        };
        extend_role_hint(&mut hint.features, roles.get("features"));
        extend_role_hint(&mut hint.targets, roles.get("targets"));
        extend_role_hint(&mut hint.metadata, roles.get("metadata"));
        extend_role_hint(&mut hint.weights, roles.get("weights"));
    }
    hint
}

fn extend_role_hint(target: &mut BTreeSet<String>, value: Option<&Value>) {
    if let Some(items) = value.and_then(Value::as_array) {
        for item in items {
            if let Some(text) = value_string(item).filter(|s| !s.is_empty()) {
                target.insert(text);
            }
        }
    }
}

fn role_columns_from_hint(
    headers: &[String],
    wanted: &BTreeSet<String>,
    excluded_a: &BTreeSet<String>,
    excluded_b: &BTreeSet<String>,
) -> Vec<String> {
    headers
        .iter()
        .filter(|name| {
            wanted.contains(*name) && !excluded_a.contains(*name) && !excluded_b.contains(*name)
        })
        .cloned()
        .collect()
}

fn inferred_axis_columns(
    headers: &[String],
    targets: &[String],
    metadata: &[String],
) -> Vec<String> {
    let target_set = targets.iter().collect::<BTreeSet<_>>();
    let metadata_set = metadata.iter().collect::<BTreeSet<_>>();
    headers
        .iter()
        .filter(|name| {
            looks_axis_column(name) && !target_set.contains(name) && !metadata_set.contains(name)
        })
        .cloned()
        .collect()
}

fn push_column_role(columns: &mut Vec<Value>, role: &str, names: &[String]) {
    if !names.is_empty() {
        columns.push(json!({"role": role, "select": names}));
    }
}

fn replace_plan_column_roles(
    plan: &mut DatasetPlan,
    input: &str,
    headers: &[String],
    features: &[String],
    targets: &[String],
    metadata: &[String],
    weights: &[String],
) {
    let features = features.iter().collect::<BTreeSet<_>>();
    let targets = targets.iter().collect::<BTreeSet<_>>();
    let metadata = metadata.iter().collect::<BTreeSet<_>>();
    let weights = weights.iter().collect::<BTreeSet<_>>();
    let column_roles = headers
        .iter()
        .map(|name| {
            let (role, evidence) = if targets.contains(name) {
                ("targets", "decoded record target")
            } else if features.contains(name) {
                ("features", "decoded record spectral axis")
            } else if metadata.contains(name) {
                ("metadata", "decoded record metadata")
            } else if weights.contains(name) {
                ("weights", "decoded record weights")
            } else {
                ("ignore", "not present in decoded record roles")
            };
            json!({"col": name, "role": role, "evidence": [evidence]})
        })
        .collect::<Vec<_>>();
    if let Some(existing) = plan.columns.iter_mut().find(|entry| {
        entry
            .get("ref")
            .and_then(Value::as_str)
            .is_some_and(|reference| reference == input || file_stem(reference) == file_stem(input))
            && entry.get("column_roles").is_some()
    }) {
        if let Some(obj) = existing.as_object_mut() {
            obj.insert("column_roles".into(), Value::Array(column_roles));
            obj.insert("analysis".into(), json!("files+decoded_records"));
        }
    } else {
        plan.columns.push(json!({
            "ref": input,
            "analysis": "files+decoded_records",
            "column_roles": column_roles,
        }));
    }
}

fn find_named_file<'a>(files: &'a [NamedBytes], name: &str) -> Option<&'a NamedBytes> {
    files.iter().find(|file| file.name == name).or_else(|| {
        files
            .iter()
            .find(|file| file_stem(&file.name) == file_stem(name))
    })
}

fn source_input_keys(source: &Value) -> Vec<String> {
    match source.get("input") {
        Some(Value::String(s)) => vec![s.clone()],
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect(),
        _ => vec![],
    }
}

fn should_copy_decision(primary: &Option<Decision>, secondary: &Option<Decision>) -> bool {
    secondary.is_some()
        && primary
            .as_ref()
            .is_none_or(|d| matches!(d.value.as_str(), Some("unknown" | "auto") | None))
}

fn decision_str(decision: &Option<Decision>) -> Option<&str> {
    decision.as_ref()?.value.as_str()
}

fn record_plan_has_dataset_roles(plan: &DatasetPlan) -> bool {
    plan.columns.iter().any(|col| {
        let roles = col.get("record_roles");
        let has_targets = roles
            .and_then(|r| r.get("targets"))
            .and_then(Value::as_array)
            .is_some_and(|a| !a.is_empty());
        let has_metadata = roles
            .and_then(|r| r.get("metadata"))
            .and_then(Value::as_array)
            .is_some_and(|a| !a.is_empty());
        has_targets || has_metadata
    })
}

fn infer_decoded_repetition(
    metadata_values: &HashMap<String, Vec<String>>,
    total_records: usize,
    spec_dict: &mut Map<String, Value>,
    plan: &mut DatasetPlan,
) {
    if total_records < 2 || metadata_values.is_empty() {
        return;
    }
    let sample_key = preferred_key(
        metadata_values.keys().map(String::as_str),
        &["sample_id", "sampleid", "sample", "id", "specimen_id"],
    );
    let repetition_key = preferred_key(
        metadata_values.keys().map(String::as_str),
        &[
            "repetition_id",
            "replicate_id",
            "repeat_id",
            "rep_id",
            "repetition",
            "replicate",
            "repeat",
            "rep",
            "scan_id",
            "scan",
            "acquisition_id",
            "measurement_id",
        ],
    );
    let Some(sample_key) = sample_key else {
        if let Some(rep_key) = repetition_key {
            apply_repetition_fields(spec_dict, None, Some(&format!("metadata.{rep_key}")));
            plan.params.as_object_mut().unwrap().insert(
                "repetition".into(),
                json!({
                    "repetition_id": format!("metadata.{rep_key}"),
                    "evidence": [format!("decoded metadata key '{rep_key}' looks like a repetition id")],
                }),
            );
        }
        return;
    };

    let sample_values = metadata_values
        .get(sample_key.as_str())
        .cloned()
        .unwrap_or_default();
    let unique = sample_values.iter().collect::<BTreeSet<_>>().len();
    let profile = repetition_profile(sample_values.len(), unique);
    let observation_ref = format!("metadata.{sample_key}");
    let repetition_ref = repetition_key.map(|key| format!("metadata.{key}"));

    if profile.is_repetition || repetition_ref.is_some() {
        apply_repetition_fields(spec_dict, Some(&observation_ref), repetition_ref.as_deref());
        let mut evidence = vec![if profile.is_repetition {
            format!(
                "decoded metadata '{sample_key}' groups {} records into {} observation(s), avg {} reps",
                profile.n_rows, profile.n_unique, profile.avg_reps
            )
        } else {
            format!("decoded metadata key '{sample_key}' is the observation id")
        }];
        if let Some(rep) = &repetition_ref {
            evidence.push(format!("decoded metadata '{rep}' is the repetition id"));
        }
        plan.params.as_object_mut().unwrap().insert(
            "repetition".into(),
            json!({
                "observation_id": observation_ref,
                "repetition_id": repetition_ref,
                "avg_reps": profile.avg_reps,
                "evidence": evidence,
            }),
        );
    }
}

fn infer_table_repetition(
    table: &MemTable,
    sample_col: Option<&str>,
) -> Option<(Option<String>, Option<String>, Value)> {
    let repetition_col = preferred_key(
        table.column_names().iter().map(String::as_str),
        &[
            "repetition_id",
            "replicate_id",
            "repeat_id",
            "rep_id",
            "repetition",
            "replicate",
            "repeat",
            "rep",
            "scan_id",
            "scan",
            "acquisition_id",
            "measurement_id",
        ],
    )
    .filter(|col| Some(col.as_str()) != sample_col);

    let mut observation_col = sample_col.map(str::to_string);
    let mut avg_reps = None;
    let mut evidence = Vec::new();
    if let Some(sample_col) = sample_col {
        if let Some(col) = table.column(sample_col) {
            let unique = col
                .values
                .iter()
                .map(Cell::group_key)
                .collect::<BTreeSet<_>>()
                .len();
            let profile = repetition_profile(table.n_rows, unique);
            if profile.is_repetition {
                observation_col = Some(sample_col.to_string());
                avg_reps = Some(profile.avg_reps);
                evidence.push(format!(
                    "column '{sample_col}' groups {} rows into {} observation(s), avg {} reps",
                    profile.n_rows, profile.n_unique, profile.avg_reps
                ));
            }
        }
    }
    if let Some(rep_col) = &repetition_col {
        evidence.push(format!("column '{rep_col}' looks like a repetition id"));
    }
    if observation_col.is_some() || repetition_col.is_some() {
        Some((
            observation_col.clone(),
            repetition_col.clone(),
            json!({
                "observation_id": observation_col,
                "repetition_id": repetition_col,
                "avg_reps": avg_reps,
                "evidence": evidence,
            }),
        ))
    } else {
        None
    }
}

fn apply_repetition_fields(
    spec_dict: &mut Map<String, Value>,
    observation_id: Option<&str>,
    repetition_id: Option<&str>,
) {
    let si = spec_dict
        .entry("sample_index")
        .or_insert_with(|| json!({"by": "row"}));
    let Some(si) = si.as_object_mut() else {
        return;
    };
    si.entry("by").or_insert_with(|| json!("row"));
    if let Some(observation_id) = observation_id {
        si.insert("observation_id".into(), json!(observation_id));
    }
    if let Some(repetition_id) = repetition_id {
        si.insert("repetition_id".into(), json!(repetition_id));
        spec_dict.insert("repetition".into(), json!(repetition_id));
    }
}

fn preferred_key<'a>(keys: impl Iterator<Item = &'a str>, preferred: &[&str]) -> Option<String> {
    let keys = keys.collect::<Vec<_>>();
    for wanted in preferred {
        if let Some(key) = keys.iter().find(|key| normalized_key(key) == *wanted) {
            return Some((*key).to_string());
        }
    }
    None
}

fn normalized_key(key: &str) -> String {
    key.chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

pub(crate) fn params_from(src: &Value) -> LoadingParams {
    LoadingParams::from_value(src.get("params")).unwrap_or_default()
}

fn enrich_params(
    spec_dict: &mut Value,
    by_name: &HashMap<String, &NamedBytes>,
    plan: &mut DatasetPlan,
) {
    let Some(sources) = spec_dict.get_mut("sources").and_then(|v| v.as_array_mut()) else {
        return;
    };
    for src in sources.iter_mut() {
        let Some(first) = source_first_input(src) else {
            continue;
        };
        let Some(file) = by_name.get(&first) else {
            continue;
        };
        if !looks_tabular(&file.name) {
            continue;
        }
        let desc = describe_bytes(file);
        let role = src
            .get("role")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let params = src
            .as_object_mut()
            .unwrap()
            .entry("params")
            .or_insert_with(|| Value::Object(Map::new()))
            .as_object_mut()
            .unwrap();
        params
            .entry("delimiter")
            .or_insert_with(|| json!(desc.delimiter.to_string()));
        if desc.has_header {
            params.entry("has_header").or_insert_with(|| json!(true));
        }
        if matches!(role.as_str(), "features" | "mixed")
            && matches!(desc.header_unit.as_str(), "nm" | "cm-1")
        {
            params
                .entry("header_unit")
                .or_insert_with(|| json!(desc.header_unit.clone()));
        }
        let dconf = py_round(*desc.confidence.get("delimiter").unwrap_or(&0.5), 3);
        let hconf = py_round(*desc.confidence.get("has_header").unwrap_or(&0.5), 3);
        plan.params.as_object_mut().unwrap().insert(
            file.name.clone(),
            json!({
                "delimiter": {"value": desc.delimiter.to_string(), "score": dconf},
                "has_header": {"value": desc.has_header, "score": hconf},
            }),
        );
        if desc.is_wavelength_header {
            if let Some((lo, hi)) = desc.axis_range {
                let ascore = py_round(*desc.confidence.get("header_unit").unwrap_or(&0.8), 3);
                plan.axis = Some(json!({
                    "unit": desc.header_unit,
                    "n": desc.n_cols,
                    "range": [lo, hi],
                    "score": ascore,
                }));
            }
        }
    }
}

fn infer_identity_and_alignment(
    spec_dict: &mut Value,
    by_name: &HashMap<String, &NamedBytes>,
    plan: &mut DatasetPlan,
) {
    if plan.identity.is_some() {
        return;
    }
    let sources = spec_dict
        .get("sources")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let Some(feature_src) = sources.iter().find(|s| {
        matches!(
            s.get("role").and_then(|v| v.as_str()),
            Some("features") | Some("mixed")
        ) && s.get("kind").and_then(|v| v.as_str()) != Some("lookup")
    }) else {
        return;
    };
    let Some(first) = source_first_input(feature_src) else {
        return;
    };
    let is_multi = matches!(feature_src.get("input"), Some(Value::Array(a)) if a.len() > 1);
    if is_multi {
        return;
    }
    let Some(file) = by_name.get(&first) else {
        return;
    };
    let Some(table) = read_table_bytes(&file.bytes, &params_from(feature_src)) else {
        return;
    };
    let profile = table.to_table_profile();
    let Some(id_guess) = detect_sample_id(&profile) else {
        return;
    };
    plan.identity = Some(Decision {
        value: json!(id_guess.column.clone()),
        score: id_guess.score,
        evidence: id_guess.evidence.clone(),
        alternatives: vec![],
        ambiguous: !id_guess.unique,
    });
    if let Some(spec) = spec_dict.as_object_mut() {
        spec.insert(
            "sample_index".into(),
            json!({"by": "id", "key": id_guess.column.clone()}),
        );
        if let Some((observation_col, repetition_col, params)) =
            infer_table_repetition(&table, Some(id_guess.column.as_str()))
        {
            apply_repetition_fields(spec, observation_col.as_deref(), repetition_col.as_deref());
            plan.params
                .as_object_mut()
                .unwrap()
                .insert("repetition".into(), params);
        }
    }
}

fn infer_signal_and_task(
    spec_dict: &mut Value,
    by_name: &HashMap<String, &NamedBytes>,
    plan: &mut DatasetPlan,
) {
    let sources = spec_dict
        .get("sources")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let Some(feature_src) = sources.iter().find(|s| {
        matches!(
            s.get("role").and_then(|v| v.as_str()),
            Some("features") | Some("mixed")
        )
    }) else {
        return;
    };
    let Some(first) = source_first_input(feature_src) else {
        return;
    };
    let Some(file) = by_name.get(&first) else {
        return;
    };
    let Some(table) = read_table_bytes(&file.bytes, &params_from(feature_src)) else {
        return;
    };

    let mut feature_cols = resolve_role_columns(feature_src, &table, "features");
    if feature_cols.is_empty() {
        feature_cols = table
            .column_names()
            .into_iter()
            .zip(table.dtype_labels())
            .filter(|(name, dt)| looks_axis_column(name) || dt == "numeric")
            .map(|(name, _)| name)
            .collect();
    }
    if !feature_cols.is_empty() {
        let (matrix, ncols) = table.feature_matrix_f32(&feature_cols);
        let wl = plan.axis.as_ref().and_then(|axis| {
            if feature_cols.iter().all(|c| looks_axis_column(c)) {
                let unit = axis.get("unit").and_then(|v| v.as_str()).unwrap_or("");
                let parsed: Option<Vec<f64>> =
                    feature_cols.iter().map(|c| parse_axis_header(c)).collect();
                parsed.map(|mut v| {
                    if unit == "cm-1" {
                        for x in &mut v {
                            *x = 1e7 / *x;
                        }
                    }
                    v
                })
            } else {
                None
            }
        });
        let (sig, sscore, reason) = detect_signal_type(&matrix, ncols, wl.as_deref(), 0.7);
        plan.signal_type = Some(Decision {
            value: Value::from(sig.clone()),
            score: sscore,
            evidence: vec![reason],
            alternatives: vec![],
            ambiguous: sig == "unknown",
        });
    }

    if let Some((values, where_)) = first_target_values(&sources, feature_src, &table, by_name) {
        if !values.is_empty() {
            let (task, tscore) = detect_task_type(&values, 0.05);
            plan.task_type = Some(Decision::new(
                task,
                tscore,
                vec![format!("target {where_} value distribution")],
            ));
        }
    }
}

fn first_target_values(
    sources: &[Value],
    feature_src: &Value,
    feature_table: &MemTable,
    by_name: &HashMap<String, &NamedBytes>,
) -> Option<(Vec<f64>, String)> {
    let in_feature = resolve_role_columns(feature_src, feature_table, "targets");
    if let Some(col) = in_feature.first() {
        if feature_table.has_column(col) {
            return Some((feature_table.numeric_column_f64(col), format!("'{col}'")));
        }
    }
    let feature_id = feature_src.get("id").and_then(|v| v.as_str());
    for src in sources {
        if src.get("id").and_then(|v| v.as_str()) == feature_id {
            continue;
        }
        let is_targets = src.get("role").and_then(|v| v.as_str()) == Some("targets")
            || src
                .get("columns")
                .and_then(|v| v.as_array())
                .is_some_and(|cs| {
                    cs.iter()
                        .any(|c| c.get("role").and_then(|v| v.as_str()) == Some("targets"))
                });
        if !is_targets {
            continue;
        }
        let Some(first) = source_first_input(src) else {
            continue;
        };
        let Some(file) = by_name.get(&first) else {
            continue;
        };
        let Some(tdf) = read_table_bytes(&file.bytes, &params_from(src)) else {
            continue;
        };
        let cols = resolve_role_columns(src, &tdf, "targets");
        let col = cols
            .first()
            .cloned()
            .or_else(|| tdf.column_names().first().cloned());
        if let Some(col) = col {
            if tdf.has_column(&col) {
                let id = src.get("id").and_then(|v| v.as_str()).unwrap_or("");
                return Some((tdf.numeric_column_f64(&col), format!("source '{id}'")));
            }
        }
    }
    None
}

fn resolve_role_columns(src: &Value, table: &MemTable, role: &str) -> Vec<String> {
    let Some(cols_spec) = src.get("columns") else {
        return vec![];
    };
    let headers = table.column_names();
    let dtypes = table.dtype_labels();
    let assigned = BTreeSet::new();
    let entries: Vec<(String, Value)> = match cols_spec {
        Value::Array(a) => a
            .iter()
            .filter_map(|e| {
                let r = e.get("role")?.as_str()?.to_string();
                Some((r, e.get("select")?.clone()))
            })
            .collect(),
        Value::Object(m) => m.iter().map(|(r, s)| (r.clone(), s.clone())).collect(),
        _ => vec![],
    };
    let mut out = vec![];
    for (r, select) in entries {
        if r != role {
            continue;
        }
        if let Ok(sel) = Selector::parse(&select) {
            if let Ok(idxs) = sel.resolve(&headers, &dtypes, &assigned) {
                out.extend(idxs.into_iter().filter_map(|i| headers.get(i).cloned()));
            }
        }
    }
    out
}

#[derive(Debug, Clone)]
enum Cell {
    Int(i64),
    Float(f64),
    Str(String),
    Na,
}

impl Cell {
    fn to_numeric(&self) -> f64 {
        match self {
            Cell::Int(i) => *i as f64,
            Cell::Float(f) => *f,
            Cell::Str(s) => s.trim().parse::<f64>().unwrap_or(f64::NAN),
            Cell::Na => f64::NAN,
        }
    }

    fn to_str_scalar(&self) -> String {
        match self {
            Cell::Int(i) => i.to_string(),
            Cell::Float(f) => py_str_scalar(&Value::from(*f)),
            Cell::Str(s) => s.clone(),
            Cell::Na => "nan".to_string(),
        }
    }

    fn group_key(&self) -> String {
        match self {
            Cell::Int(i) => format!("i:{i}"),
            Cell::Float(f) if f.is_nan() => "na".to_string(),
            Cell::Float(f) => format!("f:{}", f.to_bits()),
            Cell::Str(s) => format!("s:{s}"),
            Cell::Na => "na".to_string(),
        }
    }
}

#[derive(Debug, Clone)]
struct MemColumn {
    name: String,
    dtype: ColDtype,
    numeric_kind: NumericKind,
    values: Vec<Cell>,
}

#[derive(Debug, Clone)]
pub(crate) struct MemTable {
    columns: Vec<MemColumn>,
    pub(crate) n_rows: usize,
}

impl MemTable {
    fn column_names(&self) -> Vec<String> {
        self.columns.iter().map(|c| c.name.clone()).collect()
    }

    fn dtype_labels(&self) -> Vec<String> {
        self.columns
            .iter()
            .map(|c| c.dtype.label().to_string())
            .collect()
    }

    fn column(&self, name: &str) -> Option<&MemColumn> {
        self.columns.iter().find(|c| c.name == name)
    }

    fn has_column(&self, name: &str) -> bool {
        self.column(name).is_some()
    }

    pub(crate) fn to_table_profile(&self) -> TableProfile {
        TableProfile {
            n_rows: self.n_rows,
            columns: self
                .columns
                .iter()
                .map(|c| {
                    let nunique = c
                        .values
                        .iter()
                        .map(Cell::group_key)
                        .collect::<BTreeSet<_>>()
                        .len();
                    ColumnProfile {
                        name: c.name.clone(),
                        dtype: c.dtype,
                        numeric_kind: c.numeric_kind,
                        nunique_with_na: nunique,
                        is_unique: nunique == self.n_rows,
                        str_values: c.values.iter().map(Cell::to_str_scalar).collect(),
                        numeric_values: c.values.iter().map(Cell::to_numeric).collect(),
                    }
                })
                .collect(),
        }
    }

    fn numeric_column_f64(&self, name: &str) -> Vec<f64> {
        self.column(name)
            .map(|c| c.values.iter().map(Cell::to_numeric).collect())
            .unwrap_or_default()
    }

    fn feature_matrix_f32(&self, cols: &[String]) -> (Vec<f64>, usize) {
        let mut data = Vec::with_capacity(self.n_rows * cols.len());
        for row in 0..self.n_rows {
            for name in cols {
                let v = self
                    .column(name)
                    .map(|c| c.values[row].to_numeric())
                    .unwrap_or(f64::NAN);
                data.push(v as f32 as f64);
            }
        }
        (data, cols.len())
    }
}

pub(crate) fn read_table_bytes(bytes: &[u8], params: &LoadingParams) -> Option<MemTable> {
    let delimiter = params
        .delimiter
        .as_deref()
        .unwrap_or(";")
        .chars()
        .next()
        .unwrap_or(';');
    let decimal = params
        .decimal_separator
        .as_deref()
        .unwrap_or(".")
        .chars()
        .next()
        .unwrap_or('.');
    let has_header = params.has_header.unwrap_or(true);
    let text = String::from_utf8_lossy(bytes);
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .delimiter(delimiter as u8)
        .from_reader(text.as_bytes());
    let mut records: Vec<Vec<String>> = Vec::new();
    for rec in rdr.records() {
        let Ok(rec) = rec else {
            return None;
        };
        if rec.iter().all(|c| c.is_empty()) {
            continue;
        }
        records.push(rec.iter().map(str::to_string).collect());
    }
    if records.is_empty() {
        return Some(MemTable {
            columns: vec![],
            n_rows: 0,
        });
    }
    let ncols = records.iter().map(|r| r.len()).max().unwrap_or(0);
    let (header, data_start) = if has_header {
        (records[0].clone(), 1)
    } else {
        ((0..ncols).map(|i| i.to_string()).collect(), 0)
    };
    let names = mangle_dupes(&header, ncols);
    let columns = names
        .iter()
        .enumerate()
        .map(|(j, name)| {
            let raw: Vec<String> = records[data_start..]
                .iter()
                .map(|r| r.get(j).cloned().unwrap_or_default())
                .collect();
            infer_column(name, &raw, decimal)
        })
        .collect();
    Some(MemTable {
        columns,
        n_rows: records.len().saturating_sub(data_start),
    })
}

fn infer_column(name: &str, raw: &[String], decimal: char) -> MemColumn {
    let norm = |c: &str| -> String {
        if decimal == ',' {
            c.replace(',', ".")
        } else {
            c.to_string()
        }
    };
    let mut has_na = false;
    let mut all_int = true;
    let mut all_numeric = true;
    for cell in raw {
        if is_na(cell) {
            has_na = true;
            continue;
        }
        let n = norm(cell);
        if parse_int_literal(&n).is_none() {
            all_int = false;
        }
        if parse_float(&n).is_none() {
            all_numeric = false;
        }
    }
    if all_numeric && all_int && !has_na {
        MemColumn {
            name: name.into(),
            dtype: ColDtype::Numeric,
            numeric_kind: NumericKind::NonFloatNumeric,
            values: raw
                .iter()
                .map(|c| Cell::Int(parse_int_literal(&norm(c)).unwrap()))
                .collect(),
        }
    } else if all_numeric {
        MemColumn {
            name: name.into(),
            dtype: ColDtype::Numeric,
            numeric_kind: NumericKind::Float,
            values: raw
                .iter()
                .map(|c| {
                    if is_na(c) {
                        Cell::Float(f64::NAN)
                    } else {
                        Cell::Float(parse_float(&norm(c)).unwrap())
                    }
                })
                .collect(),
        }
    } else {
        MemColumn {
            name: name.into(),
            dtype: ColDtype::String,
            numeric_kind: NumericKind::NonNumeric,
            values: raw
                .iter()
                .map(|c| {
                    if is_na(c) {
                        Cell::Na
                    } else {
                        Cell::Str(c.clone())
                    }
                })
                .collect(),
        }
    }
}

fn mangle_dupes(header: &[String], ncols: usize) -> Vec<String> {
    let mut seen: HashMap<String, usize> = HashMap::new();
    let mut out = Vec::with_capacity(ncols);
    for j in 0..ncols {
        let base = header.get(j).cloned().unwrap_or_else(|| j.to_string());
        let count = seen.entry(base.clone()).or_insert(0);
        let name = if *count == 0 {
            base.clone()
        } else {
            format!("{base}.{count}")
        };
        *count += 1;
        out.push(name);
    }
    out
}

fn is_na(cell: &str) -> bool {
    matches!(
        cell,
        "#N/A"
            | "#N/A N/A"
            | "#NA"
            | "-1.#IND"
            | "-1.#QNAN"
            | "-NaN"
            | "-nan"
            | "1.#IND"
            | "1.#QNAN"
            | "<NA>"
            | "N/A"
            | "NA"
            | "NULL"
            | "NaN"
            | "None"
            | "n/a"
            | "nan"
            | "null"
            | ""
    )
}

fn parse_int_literal(s: &str) -> Option<i64> {
    let t = s.trim();
    if t.is_empty() {
        return None;
    }
    let body = t.strip_prefix(['+', '-']).unwrap_or(t);
    if !body.is_empty() && body.bytes().all(|b| b.is_ascii_digit()) {
        t.parse::<i64>().ok()
    } else {
        None
    }
}

fn parse_float(s: &str) -> Option<f64> {
    let t = s.trim();
    if t.is_empty() {
        return None;
    }
    t.parse::<f64>().ok()
}

pub(crate) fn looks_tabular(name: &str) -> bool {
    let low = name.to_ascii_lowercase();
    matches!(
        low.rsplit('.').next(),
        Some("csv") | Some("tsv") | Some("txt") | Some("dat")
    )
}

pub(crate) fn looks_axis_column(name: &str) -> bool {
    parse_axis_header(name).is_some()
}

fn parse_axis_header(name: &str) -> Option<f64> {
    let low = name.trim().to_ascii_lowercase();
    let stripped = low
        .strip_suffix("nm")
        .or_else(|| low.strip_suffix("cm-1"))
        .unwrap_or(&low);
    let value = stripped.parse::<f64>().ok()?;
    if value.is_finite() {
        Some(value)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn named(name: &str, text: &str) -> NamedBytes {
        NamedBytes {
            name: name.into(),
            bytes: text.as_bytes().to_vec(),
        }
    }

    #[test]
    fn browser_dataset_keeps_strong_file_conventions_for_xy_sets() {
        let files = vec![
            named(
                "X_train.csv",
                "sample_id;1000;1005\ns1;0.1;0.2\ns2;0.2;0.3\n",
            ),
            named("y_train.csv", "sample_id;protein\ns1;11.0\ns2;12.0\n"),
            named("X_test.csv", "sample_id;1000;1005\ns3;0.3;0.4\n"),
            named("y_test.csv", "sample_id;protein\ns3;13.0\n"),
        ];
        let record_sets = vec![DecodedRecordSet {
            source: "X_train.csv".into(),
            format: Some("csv".into()),
            records: vec![json!({
                "signals": {"signal": {"values": [0.1, 0.2], "axis": {"values": [1000.0, 1005.0], "unit": "nm"}}},
                "metadata": {"sample_id": "s1"}
            })],
        }];

        let plan = infer_browser_dataset(&files, &record_sets, None).unwrap();
        assert_eq!(plan.input["selected_inference"], json!("files"));
        assert_eq!(
            plan.structure.as_ref().and_then(|d| d.value.as_str()),
            Some("train_test_folder")
        );
        let spec = plan.resolved_spec.unwrap().to_value();
        let roles = spec["sources"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|source| source["role"].as_str())
            .collect::<BTreeSet<_>>();
        assert!(roles.contains("features"));
        assert!(roles.contains("targets"));
    }

    #[test]
    fn browser_dataset_prefers_decoded_records_for_proprietary_files() {
        let files = vec![NamedBytes {
            name: "scan.asd".into(),
            bytes: vec![0, 1, 2, 3],
        }];
        let record_sets = vec![DecodedRecordSet {
            source: "scan.asd".into(),
            format: Some("asd-fieldspec".into()),
            records: vec![json!({
                "signals": {"absorbance": {"values": [0.1, 0.2, 0.3], "axis": {"values": [1000.0, 1005.0, 1010.0], "unit": "nm"}}},
                "targets": {"protein": 12.4},
                "metadata": {"sample_id": "s1"}
            })],
        }];

        let plan = infer_browser_dataset(&files, &record_sets, None).unwrap();
        assert_eq!(plan.input["selected_inference"], json!("decoded_records"));
        assert_eq!(
            plan.structure.as_ref().and_then(|d| d.value.as_str()),
            Some("decoded_records")
        );
        let spec = plan.resolved_spec.unwrap().to_value();
        assert_eq!(spec["sources"][0]["role"], json!("mixed"));
        assert_eq!(spec["sources"][0]["input"], json!("scan.asd"));
    }

    #[test]
    fn browser_dataset_refines_single_table_roles_from_decoded_records() {
        let files = vec![named(
            "mixed.csv",
            "sample_id;replicate;protein;1000;1010;1020;batch\n\
             s1;r1;10;0.1;0.2;0.3;A\n\
             s1;r2;10;0.2;0.3;0.4;A\n\
             s2;r1;12;0.3;0.4;0.5;B\n\
             s2;r2;12;0.4;0.5;0.6;B\n\
             s3;r1;13;0.5;0.6;0.7;C\n",
        )];
        let axis = json!({"values": [1000.0, 1010.0, 1020.0], "unit": "nm"});
        let record_sets = vec![DecodedRecordSet {
            source: "mixed.csv".into(),
            format: Some("csv".into()),
            records: vec![
                decoded_mixed_record("s1", "r1", 10.0, [0.1, 0.2, 0.3], "A", &axis),
                decoded_mixed_record("s1", "r2", 10.0, [0.2, 0.3, 0.4], "A", &axis),
                decoded_mixed_record("s2", "r1", 12.0, [0.3, 0.4, 0.5], "B", &axis),
                decoded_mixed_record("s2", "r2", 12.0, [0.4, 0.5, 0.6], "B", &axis),
                decoded_mixed_record("s3", "r1", 13.0, [0.5, 0.6, 0.7], "C", &axis),
            ],
        }];

        let plan = infer_browser_dataset(&files, &record_sets, None).unwrap();
        assert_eq!(plan.input["selected_inference"], json!("files"));
        assert_eq!(
            plan.structure.as_ref().and_then(|d| d.value.as_str()),
            Some("single_combined")
        );
        let spec = plan.resolved_spec.as_ref().unwrap().to_value();
        assert_eq!(spec["sample_index"]["key"], json!("sample_id"));
        assert_eq!(spec["sample_index"]["observation_id"], json!("sample_id"));
        assert_eq!(spec["sample_index"]["repetition_id"], json!("replicate"));
        assert_eq!(spec["repetition"], json!("replicate"));

        let source = &spec["sources"][0];
        assert_eq!(source["role"], json!("mixed"));
        assert_eq!(
            role_select(source, "features"),
            vec!["1000", "1010", "1020"]
        );
        assert_eq!(role_select(source, "targets"), vec!["protein"]);
        let metadata = role_select(source, "metadata");
        assert!(metadata.contains(&"sample_id".to_string()));
        assert!(metadata.contains(&"replicate".to_string()));
        assert!(metadata.contains(&"batch".to_string()));
        assert!(!role_select(source, "features").contains(&"protein".to_string()));

        let file_roles = plan
            .columns
            .iter()
            .find(|entry| entry["ref"] == json!("mixed.csv") && entry["column_roles"].is_array())
            .unwrap();
        assert_eq!(role_for_col(file_roles, "protein"), Some("targets"));
        assert_eq!(role_for_col(file_roles, "1020"), Some("features"));
        assert_eq!(role_for_col(file_roles, "batch"), Some("metadata"));
    }

    #[test]
    fn decoded_records_infer_observation_and_repetition_ids() {
        let record_sets = vec![DecodedRecordSet {
            source: "replicates.asd".into(),
            format: Some("asd-fieldspec".into()),
            records: vec![
                json!({
                    "signals": {"absorbance": {"values": [0.1, 0.2], "axis": {"values": [1000.0, 1005.0], "unit": "nm"}}},
                    "metadata": {"sample_id": "s1", "replicate": "r1"}
                }),
                json!({
                    "signals": {"absorbance": {"values": [0.2, 0.3], "axis": {"values": [1000.0, 1005.0], "unit": "nm"}}},
                    "metadata": {"sample_id": "s1", "replicate": "r2"}
                }),
                json!({
                    "signals": {"absorbance": {"values": [0.3, 0.4], "axis": {"values": [1000.0, 1005.0], "unit": "nm"}}},
                    "metadata": {"sample_id": "s2", "replicate": "r1"}
                }),
            ],
        }];

        let plan = infer_decoded_records(&record_sets).unwrap();
        let spec = plan.resolved_spec.unwrap().to_value();
        assert_eq!(
            spec["sample_index"]["observation_id"],
            json!("metadata.sample_id")
        );
        assert_eq!(
            spec["sample_index"]["repetition_id"],
            json!("metadata.replicate")
        );
        assert_eq!(spec["repetition"], json!("metadata.replicate"));
        assert_eq!(plan.params["repetition"]["avg_reps"], json!(1.5));
    }

    fn decoded_mixed_record(
        sample_id: &str,
        replicate: &str,
        protein: f64,
        values: [f64; 3],
        batch: &str,
        axis: &Value,
    ) -> Value {
        json!({
            "signals": {
                "signal": {
                    "values": values,
                    "axis": axis,
                },
            },
            "targets": {"protein": protein},
            "metadata": {
                "sample_id": sample_id,
                "replicate": replicate,
                "batch": batch,
            },
        })
    }

    fn role_select(source: &Value, role: &str) -> Vec<String> {
        source["columns"]
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["role"] == json!(role))
            .and_then(|entry| entry["select"].as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default()
    }

    fn role_for_col<'a>(entry: &'a Value, col: &str) -> Option<&'a str> {
        entry["column_roles"]
            .as_array()?
            .iter()
            .find(|role| role["col"] == json!(col))?
            .get("role")?
            .as_str()
    }
}
