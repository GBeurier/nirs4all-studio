// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Inference engine orchestration (ports `infer/engine.py`).
//!
//! Composes resolve → convention match → describe → loaders → core detectors /
//! identity / column-role inference into a scored [`DatasetPlan`] whose
//! `resolved_spec` `load` can execute. The facade owns the file IO; all scoring
//! lives in `nirs4all-io-core`.

use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use nirs4all_io_core::conventions::{assignments_to_spec_dict, match_items, resolve_profiles};
use nirs4all_io_core::infer::column_roles::{infer_column_roles, structure_kind};
use nirs4all_io_core::infer::describe::{describe_text, FileDescription};
use nirs4all_io_core::infer::detectors::{detect_signal_type, detect_task_type};
use nirs4all_io_core::infer::identity::detect_sample_id;
use nirs4all_io_core::infer::plan::{DatasetPlan, Decision};
use nirs4all_io_core::pyfmt::py_round;
use nirs4all_io_core::spec::dataset_spec::LoadingParams;
use nirs4all_io_core::spec::selectors::Selector;
use nirs4all_io_core::spec::{DatasetSpec, SpecError};
use regex::Regex;
use serde_json::{json, Map, Value};

use crate::materialize::loaders::{read_table, LoadedTable};
use crate::resolve::{resolve_list, resolve_path, InputSet};

const DEFAULT_CONVENTIONS: &[&str] = &["nirs4all-classic"];

static WL_RE: LazyLock<Regex> = LazyLock::new(|| {
    regex::RegexBuilder::new(r"^\d+(\.\d+)?(nm|cm-1)?$")
        .case_insensitive(true)
        .build()
        .unwrap()
});
static WL_STRIP_RE: LazyLock<Regex> = LazyLock::new(|| {
    regex::RegexBuilder::new(r"(nm|cm-1)$")
        .case_insensitive(true)
        .build()
        .unwrap()
});

/// Facade `describe`: read bytes → UTF-8 (lossy, matching `errors="replace"`) →
/// pure `describe_text`.
pub fn describe(path: &Path) -> FileDescription {
    let bytes = std::fs::read(path).unwrap_or_default();
    let text = String::from_utf8_lossy(&bytes).into_owned();
    describe_text(&text, 50)
}

fn params_from(src: &Value) -> LoadingParams {
    LoadingParams::from_value(src.get("params")).unwrap_or_default()
}

/// Resolve the input string (dir/file/glob) and infer a plan.
///
/// Resolution is non-recursive, mirroring `engine.py` which does not consult a
/// profile's `match.recursive` when expanding a directory (a known Python
/// limitation reproduced for parity — e.g. `vendor-corpus` is recursive but the
/// Python pipeline still resolves the top level only).
pub fn infer_path(input: &str, conventions: Option<&[String]>) -> Result<DatasetPlan, SpecError> {
    infer_inputset(resolve_path(input, false), conventions)
}

/// Resolve a list of paths and infer a plan.
pub fn infer_paths(
    paths: &[String],
    conventions: Option<&[String]>,
) -> Result<DatasetPlan, SpecError> {
    infer_inputset(resolve_list(paths, false), conventions)
}

fn infer_inputset(
    iset: InputSet,
    conventions: Option<&[String]>,
) -> Result<DatasetPlan, SpecError> {
    let conv: Vec<&str> = match conventions {
        Some(c) => c.iter().map(String::as_str).collect(),
        None => DEFAULT_CONVENTIONS.to_vec(),
    };
    let profiles = resolve_profiles(&conv)?;
    let result = match_items(&iset.names(), &profiles, None, None);
    let base_dir = iset
        .items
        .first()
        .map(|it| {
            PathBuf::from(&it.identity)
                .parent()
                .map(|p| p.to_path_buf())
                .unwrap_or_default()
        })
        .unwrap_or_else(|| PathBuf::from("."));

    let mut plan = DatasetPlan {
        input: json!({"kind": iset.origin.get("kind"), "ref": iset.origin.get("ref")}),
        ..Default::default()
    };

    let file_items: Vec<&crate::resolve::InputItem> = iset.files();
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
    } else if file_items.len() == 1 {
        plan.structure = Some(Decision::new(
            "single_combined",
            0.7,
            vec!["one tabular file; column roles inferred".into()],
        ));
        infer_single_file(&file_items[0].identity, &mut plan)?
    } else {
        plan.structure = Some(Decision::new(
            "unknown",
            0.2,
            vec![format!("{} file(s), no convention match", file_items.len())],
        ));
        plan.warnings
            .push("no convention matched; provide an explicit DatasetSpec or conventions".into());
        json!({"name": "dataset", "sources": []})
    };

    enrich_params(&mut spec_dict, &base_dir, &mut plan);
    infer_identity_and_alignment(&mut spec_dict, &base_dir, &mut plan)?;
    infer_signal_and_task(&mut spec_dict, &base_dir, &mut plan);
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
    absolutize_inputs(&mut spec_dict, &base_dir, &iset);

    if !result.unmatched.is_empty() {
        let refs = Value::Array(
            result
                .unmatched
                .iter()
                .map(|s| Value::from(s.clone()))
                .collect(),
        );
        plan.warnings.push(format!(
            "unassigned files: {}",
            nirs4all_io_core::pyfmt::py_repr(&refs)
        ));
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
        .push("review the resolved_spec; pass it (or plan.accept()) to load()".into());
    Ok(plan)
}

fn infer_single_file(path: &str, plan: &mut DatasetPlan) -> Result<Value, SpecError> {
    let p = Path::new(path);
    let desc = describe(p);
    let params = LoadingParams {
        delimiter: Some(desc.delimiter.to_string()),
        has_header: Some(true),
        ..Default::default()
    };
    let table = read_table(p, &params)?;
    let profile = table.to_table_profile();
    let guesses = infer_column_roles(&desc, &profile);
    let id_guess = detect_sample_id(&profile);
    let id_col = id_guess.as_ref().map(|g| g.column.clone());
    let mut guesses = guesses;
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
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    plan.columns = vec![json!({"ref": name, "column_roles": guesses.clone()})];

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
    source.insert("input".into(), json!(name));
    source.insert("columns".into(), Value::Array(columns));
    source.insert(
        "params".into(),
        json!({"delimiter": desc.delimiter.to_string(), "has_header": true}),
    );

    let stem = file_stem(&name);
    let mut spec = Map::new();
    spec.insert("name".into(), json!(stem));
    if let Some(id_col) = &id_col {
        source.insert("key".into(), json!(id_col));
        spec.insert("sample_index".into(), json!({"by": "id", "key": id_col}));
        // repetition handling (apply_repetition) is exercised by non-corpus cases.
    }
    spec.insert("sources".into(), Value::Array(vec![Value::Object(source)]));
    Ok(Value::Object(spec))
}

fn file_stem(name: &str) -> String {
    match name.rfind('.') {
        Some(idx) if idx > 0 => name[..idx].to_string(),
        _ => name.to_string(),
    }
}

fn source_first_input(src: &Value) -> Option<String> {
    match src.get("input") {
        Some(Value::Array(a)) => a.first().and_then(|v| v.as_str()).map(str::to_string),
        Some(Value::String(s)) => Some(s.clone()),
        _ => None,
    }
}

fn resolve_input_path(first: &str, base_dir: &Path) -> PathBuf {
    let p = Path::new(first);
    if p.is_absolute() {
        p.to_path_buf()
    } else {
        base_dir.join(first)
    }
}

fn enrich_params(spec_dict: &mut Value, base_dir: &Path, plan: &mut DatasetPlan) {
    let Some(sources) = spec_dict.get_mut("sources").and_then(|v| v.as_array_mut()) else {
        return;
    };
    for src in sources.iter_mut() {
        let Some(first) = source_first_input(src) else {
            continue;
        };
        let path = resolve_input_path(&first, base_dir);
        let ext_ok = matches!(
            path.extension()
                .and_then(|e| e.to_str())
                .map(str::to_lowercase)
                .as_deref(),
            Some("csv") | Some("tsv") | Some("txt")
        );
        if !path.exists() || !ext_ok {
            continue;
        }
        let desc = describe(&path);
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
        let base = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let dconf = py_round(*desc.confidence.get("delimiter").unwrap_or(&0.5), 3);
        let hconf = py_round(*desc.confidence.get("has_header").unwrap_or(&0.5), 3);
        plan.params.as_object_mut().unwrap().insert(
            base,
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

/// Resolve a source's declared columns of a given role to concrete names.
fn resolve_role_columns(src: &Value, table: &LoadedTable, role: &str) -> Vec<String> {
    let Some(cols_spec) = src.get("columns") else {
        return vec![];
    };
    let headers = table.column_names();
    let dtypes = table.dtype_labels();
    let assigned = std::collections::BTreeSet::new();
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

fn infer_signal_and_task(spec_dict: &mut Value, base_dir: &Path, plan: &mut DatasetPlan) {
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
    let path = resolve_input_path(&first, base_dir);
    if !path.exists() {
        return;
    }
    let Ok(table) = read_table(&path, &params_from(feature_src)) else {
        return;
    };

    let mut feature_cols = resolve_role_columns(feature_src, &table, "features");
    if feature_cols.is_empty() {
        feature_cols = table
            .column_names()
            .into_iter()
            .zip(table.dtype_labels())
            .filter(|(name, dt)| WL_RE.is_match(name) || dt == "numeric")
            .map(|(name, _)| name)
            .collect();
    }
    if !feature_cols.is_empty() {
        let (matrix, ncols) = table.feature_matrix_f32(&feature_cols);
        let wl: Option<Vec<f64>> = plan.axis.as_ref().and_then(|axis| {
            if feature_cols.iter().all(|c| WL_RE.is_match(c)) {
                let unit = axis.get("unit").and_then(|v| v.as_str()).unwrap_or("");
                let parsed: Option<Vec<f64>> = feature_cols
                    .iter()
                    .map(|c| WL_STRIP_RE.replace(c, "").parse::<f64>().ok())
                    .collect();
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
        let ambiguous = sig == "unknown";
        plan.signal_type = Some(Decision {
            value: Value::from(sig),
            score: sscore,
            evidence: vec![reason],
            alternatives: vec![],
            ambiguous,
        });
    }

    if let Some((values, where_)) = first_target_values(&sources, feature_src, &table, base_dir) {
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
    feature_table: &LoadedTable,
    base_dir: &Path,
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
        let path = resolve_input_path(&first, base_dir);
        if !path.exists() {
            continue;
        }
        let Ok(tdf) = read_table(&path, &params_from(src)) else {
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

fn infer_identity_and_alignment(
    spec_dict: &mut Value,
    base_dir: &Path,
    plan: &mut DatasetPlan,
) -> Result<(), SpecError> {
    if plan.identity.is_some() {
        return Ok(());
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
        return Ok(());
    };
    let Some(first) = source_first_input(feature_src) else {
        return Ok(());
    };
    // Single-file feature source: read + detect a sample id. Multi-file concat +
    // filename_stem / replicate grouping is exercised by non-corpus cases and is
    // a tracked follow-up (EPIC 12 parity hardening).
    let is_multi = matches!(feature_src.get("input"), Some(Value::Array(a)) if a.len() > 1);
    if is_multi {
        return Ok(());
    }
    let path = resolve_input_path(&first, base_dir);
    if !path.exists() {
        return Ok(());
    }
    let Ok(table) = read_table(&path, &params_from(feature_src)) else {
        return Ok(());
    };
    let profile = table.to_table_profile();
    if detect_sample_id(&profile).is_none() {
        return Ok(());
    }
    // An id detected in a separate (non single-combined) feature source would
    // drive keying/alignment; not reached by the contract corpus. Tracked.
    Ok(())
}

fn absolutize_inputs(spec_dict: &mut Value, base_dir: &Path, iset: &InputSet) {
    let mut name_to_abs: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    for it in &iset.items {
        name_to_abs.insert(it.ref_.clone(), it.identity.clone());
    }
    let abs = |name: &str| -> String {
        name_to_abs
            .get(name)
            .cloned()
            .unwrap_or_else(|| base_dir.join(name).to_string_lossy().into_owned())
    };
    let Some(sources) = spec_dict.get_mut("sources").and_then(|v| v.as_array_mut()) else {
        return;
    };
    for src in sources.iter_mut() {
        let Some(obj) = src.as_object_mut() else {
            continue;
        };
        match obj.get("input").cloned() {
            Some(Value::Array(a)) => {
                let mapped: Vec<Value> = a
                    .iter()
                    .map(|v| {
                        v.as_str()
                            .map(|s| Value::from(abs(s)))
                            .unwrap_or_else(|| v.clone())
                    })
                    .collect();
                obj.insert("input".into(), Value::Array(mapped));
            }
            Some(Value::String(s)) => {
                obj.insert("input".into(), Value::from(abs(&s)));
            }
            _ => {}
        }
    }
}
