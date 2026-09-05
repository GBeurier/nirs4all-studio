// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Alias normalization + legacy-keys → DatasetSpec dict (ports `spec/normalize.py`).
//!
//! `apply_key_aliases` rewrites accepted synonyms onto canonical legacy keys
//! (first-wins alias map — trap #4); `legacy_to_spec_dict` wires those legacy
//! keys into a canonical spec shape; `normalize_to_spec_dict` chains them.
//!
//! The alias map's build order is load-bearing (first normalized spelling wins),
//! so the ordered `aliases_by_key` list mirrors the Python dict insertion order
//! exactly. The output dict order is NOT load-bearing (the IR reads by name and
//! canonical JSON sorts), so a plain `HashMap` backs the final lookup.

use std::collections::HashMap;
use std::sync::OnceLock;

use serde_json::{Map, Value};

const TRAIN_PARTITIONS: &[&str] = &["train", "trn", "cal", "calibration", "fit"];
const TEST_PARTITIONS: &[&str] = &[
    "test",
    "tst",
    "val",
    "validation",
    "eval",
    "holdout",
    "predict",
    "inference",
];
const FEATURE_ROLES: &[&str] = &[
    "x", "feature", "features", "spectrum", "spectra", "signal", "signals",
];
const TARGET_ROLES: &[&str] = &[
    "y",
    "target",
    "targets",
    "label",
    "labels",
    "response",
    "responses",
];
const METADATA_ROLES: &[&str] = &[
    "group",
    "groups",
    "meta",
    "metadata",
    "m",
    "samplemeta",
    "samplemetadata",
];

/// Root-level loading-param keys accepted as a shorthand (folded into params).
const ROOT_PARAM_KEYS: &[&str] = &[
    "delimiter",
    "decimal_separator",
    "decimal",
    "has_header",
    "header",
    "header_unit",
    "na",
    "na_policy",
    "categorical",
    "categorical_mode",
    "encoding",
    "signal_type",
];

/// `normalize_key`: keep alphanumerics, lowercase (case/separator-insensitive).
pub fn normalize_key(key: &str) -> String {
    key.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

fn combine_partition_role(partitions: &[&str], roles: &[&str]) -> Vec<String> {
    let mut out = Vec::new();
    for p in partitions {
        for r in roles {
            out.push(format!("{p}_{r}"));
            out.push(format!("{r}_{p}"));
            out.push(format!("{p}{r}"));
            out.push(format!("{r}{p}"));
        }
    }
    out
}

fn lits(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

/// Ordered `(canonical_key, aliases)` pairs in Python insertion order.
fn aliases_by_key() -> Vec<(&'static str, Vec<String>)> {
    let mut v: Vec<(&'static str, Vec<String>)> = vec![
        (
            "train_x",
            combine_partition_role(TRAIN_PARTITIONS, FEATURE_ROLES),
        ),
        (
            "test_x",
            combine_partition_role(TEST_PARTITIONS, FEATURE_ROLES),
        ),
        (
            "train_y",
            combine_partition_role(TRAIN_PARTITIONS, TARGET_ROLES),
        ),
        (
            "test_y",
            combine_partition_role(TEST_PARTITIONS, TARGET_ROLES),
        ),
        (
            "train_group",
            combine_partition_role(TRAIN_PARTITIONS, METADATA_ROLES),
        ),
        (
            "test_group",
            combine_partition_role(TEST_PARTITIONS, METADATA_ROLES),
        ),
        ("name", lits(&["dataset_name", "data_name"])),
        (
            "description",
            lits(&["desc", "dataset_description", "data_description"]),
        ),
        (
            "task_type",
            lits(&[
                "task",
                "tasktype",
                "problem_type",
                "problemtype",
                "ml_task",
                "target_type",
            ]),
        ),
        (
            "folder",
            lits(&[
                "dir",
                "directory",
                "data_folder",
                "data_dir",
                "folder_path",
                "path",
            ]),
        ),
        (
            "global_params",
            lits(&[
                "global",
                "global_config",
                "global_settings",
                "global_options",
                "loading_params",
                "loader_params",
                "read_params",
                "io_params",
                "global_loading_params",
                "global_loading_options",
                "shared_params",
            ]),
        ),
        (
            "train_params",
            combine_partition_role(
                TRAIN_PARTITIONS,
                &["params", "param", "config", "settings", "options"],
            ),
        ),
        (
            "test_params",
            combine_partition_role(
                TEST_PARTITIONS,
                &["params", "param", "config", "settings", "options"],
            ),
        ),
        (
            "aggregate",
            lits(&[
                "aggregation",
                "aggregate_by",
                "aggregation_by",
                "group_by",
                "groupby",
                "aggregate_column",
                "aggregation_column",
            ]),
        ),
        (
            "aggregate_method",
            lits(&[
                "aggregation_method",
                "aggregate_mode",
                "aggregation_mode",
                "aggregate_strategy",
                "aggregation_strategy",
            ]),
        ),
        (
            "aggregate_exclude_outliers",
            lits(&[
                "exclude_outliers",
                "remove_outliers",
                "drop_outliers",
                "exclude_outliers_before_aggregation",
                "remove_outliers_before_aggregation",
                "aggregation_exclude_outliers",
            ]),
        ),
        (
            "repetition",
            lits(&[
                "repetitions",
                "repeat",
                "repeat_by",
                "repetition_column",
                "repeat_column",
                "sample_id_column",
                "sampleidcolumn",
                "group_column",
            ]),
        ),
        (
            "folds",
            lits(&[
                "fold",
                "cv",
                "cv_folds",
                "cross_validation",
                "cross_validation_folds",
                "splits",
                "cv_splits",
            ]),
        ),
        ("files", lits(&["file_list", "data_files", "input_files"])),
        (
            "sources",
            lits(&[
                "source_list",
                "sensor_sources",
                "input_sources",
                "feature_sources",
                "modalities",
            ]),
        ),
        (
            "targets",
            lits(&[
                "target_spec",
                "targets_spec",
                "shared_targets",
                "shared_target",
                "common_targets",
            ]),
        ),
        (
            "metadata",
            lits(&[
                "metadata_spec",
                "meta_spec",
                "shared_metadata",
                "shared_meta",
                "common_metadata",
            ]),
        ),
    ];

    // *_params and *_filter variants of the six partitioned bases, in order.
    let bases = [
        "train_x",
        "test_x",
        "train_y",
        "test_y",
        "train_group",
        "test_group",
    ];
    let suffixes: [(&str, &[&str]); 2] = [
        (
            "_params",
            &[
                "params", "param", "config", "configs", "settings", "options",
            ],
        ),
        (
            "_filter",
            &[
                "filter",
                "filters",
                "columns",
                "cols",
                "indices",
                "idx",
                "select",
                "selection",
            ],
        ),
    ];
    // Snapshot the base aliases computed above (by key) for the derivation.
    let base_aliases: HashMap<&str, Vec<String>> = v
        .iter()
        .filter(|(k, _)| bases.contains(k))
        .map(|(k, a)| (*k, a.clone()))
        .collect();
    for base_key in bases {
        let base = &base_aliases[base_key];
        for (suffix, terms) in &suffixes {
            let mut derived = Vec::new();
            for base_alias in base {
                for term in *terms {
                    derived.push(format!("{base_alias}_{term}"));
                    derived.push(format!("{base_alias}{term}"));
                    derived.push(format!("{term}_{base_alias}"));
                    derived.push(format!("{term}{base_alias}"));
                }
            }
            let key: &'static str = match (base_key, *suffix) {
                ("train_x", "_params") => "train_x_params",
                ("train_x", "_filter") => "train_x_filter",
                ("test_x", "_params") => "test_x_params",
                ("test_x", "_filter") => "test_x_filter",
                ("train_y", "_params") => "train_y_params",
                ("train_y", "_filter") => "train_y_filter",
                ("test_y", "_params") => "test_y_params",
                ("test_y", "_filter") => "test_y_filter",
                ("train_group", "_params") => "train_group_params",
                ("train_group", "_filter") => "train_group_filter",
                ("test_group", "_params") => "test_group_params",
                ("test_group", "_filter") => "test_group_filter",
                _ => unreachable!(),
            };
            v.push((key, derived));
        }
    }
    v
}

/// Normalized alias → canonical legacy key (first mapping wins). Cached.
pub fn alias_map() -> &'static HashMap<String, String> {
    static MAP: OnceLock<HashMap<String, String>> = OnceLock::new();
    MAP.get_or_init(|| {
        let mut mapping: HashMap<String, String> = HashMap::new();
        for (canonical, aliases) in aliases_by_key() {
            for alias in std::iter::once(canonical.to_string()).chain(aliases) {
                let norm = normalize_key(&alias);
                mapping.entry(norm).or_insert_with(|| canonical.to_string());
            }
        }
        mapping
    })
}

/// Rewrite accepted alias keys to canonical legacy keys (canonical wins).
pub fn apply_key_aliases(config: &Map<String, Value>) -> Map<String, Value> {
    let amap = alias_map();
    let mut normalized = config.clone();
    for (key, value) in config.iter() {
        let Some(mapped) = amap.get(&normalize_key(key)) else {
            continue;
        };
        if key == mapped {
            continue;
        }
        if !normalized.contains_key(mapped) {
            normalized.insert(mapped.clone(), value.clone());
        }
        normalized.remove(key);
    }
    normalized
}

fn as_list(value: &Value) -> Vec<Value> {
    match value {
        Value::Array(a) => a.clone(),
        other => vec![other.clone()],
    }
}

fn merge_params(blocks: &[Option<&Value>]) -> Map<String, Value> {
    let mut merged = Map::new();
    for block in blocks {
        if let Some(Value::Object(m)) = block {
            for (k, v) in m {
                merged.insert(k.clone(), v.clone());
            }
        }
    }
    merged
}

fn aggregate_block(config: &Map<String, Value>) -> Map<String, Value> {
    let mut out = Map::new();
    if let Some(v) = config.get("aggregate").filter(|v| !v.is_null()) {
        out.insert("by".into(), v.clone());
    }
    if let Some(v) = config.get("aggregate_method").filter(|v| !v.is_null()) {
        out.insert("method".into(), v.clone());
    }
    if let Some(v) = config
        .get("aggregate_exclude_outliers")
        .filter(|v| !v.is_null())
    {
        out.insert(
            "exclude_outliers".into(),
            Value::Bool(crate::pyfmt::py_truthy(v)),
        );
    }
    out
}

/// Convert an alias-normalized legacy-keyed config into a DatasetSpec dict.
pub fn legacy_to_spec_dict(config: &Map<String, Value>) -> Value {
    let mut spec = Map::new();
    let present = |k: &str| config.get(k).filter(|v| !v.is_null());
    if let Some(v) = present("name") {
        spec.insert("name".into(), v.clone());
    }
    if let Some(v) = present("description") {
        spec.insert("description".into(), v.clone());
    }
    if let Some(v) = present("task_type") {
        spec.insert("task_type".into(), v.clone());
    }
    // root-level params folded into global params; explicit global_params wins.
    let mut root_params = Map::new();
    for k in ROOT_PARAM_KEYS {
        if let Some(v) = config.get(*k) {
            root_params.insert((*k).to_string(), v.clone());
        }
    }
    let mut merged_params = root_params;
    if let Some(Value::Object(gp)) = config.get("global_params") {
        for (k, v) in gp {
            merged_params.insert(k.clone(), v.clone());
        }
    }
    if !merged_params.is_empty() {
        spec.insert("params".into(), Value::Object(merged_params));
    }
    if let Some(v) = present("repetition") {
        spec.insert("repetition".into(), v.clone());
        let si = spec
            .entry("sample_index")
            .or_insert_with(|| Value::Object(Map::new()));
        si.as_object_mut()
            .unwrap()
            .insert("repetition_id".into(), v.clone());
    }
    let agg = aggregate_block(config);
    if !agg.is_empty() {
        spec.insert("aggregate".into(), Value::Object(agg));
    }

    let mut sources: Vec<Value> = Vec::new();
    let mut first_feature_id: HashMap<&str, String> = HashMap::new();
    for partition in ["train", "test"] {
        let x_val = present(&format!("{partition}_x")).cloned();
        let x_filter = config
            .get(&format!("{partition}_x_filter"))
            .filter(|v| !v.is_null())
            .cloned();
        let x_params = merge_params(&[
            config.get(&format!("{partition}_params")),
            config.get(&format!("{partition}_x_params")),
        ]);
        let y_val = present(&format!("{partition}_y")).cloned();
        let y_filter = config
            .get(&format!("{partition}_y_filter"))
            .filter(|v| !v.is_null())
            .cloned();
        let g_val = present(&format!("{partition}_group")).cloned();
        let g_filter = config
            .get(&format!("{partition}_group_filter"))
            .filter(|v| !v.is_null())
            .cloned();

        if let Some(x_val) = &x_val {
            let x_inputs = as_list(x_val);
            for (i, inp) in x_inputs.iter().enumerate() {
                let sid = if x_inputs.len() == 1 {
                    format!("{partition}_x")
                } else {
                    format!("{partition}_x_{i}")
                };
                let mut src = Map::new();
                src.insert("id".into(), Value::from(sid.clone()));
                src.insert("role".into(), Value::from("features"));
                src.insert("input".into(), inp.clone());
                src.insert("partition".into(), Value::from(partition));
                if !x_params.is_empty() {
                    src.insert("params".into(), Value::Object(x_params.clone()));
                }
                if y_val.is_none() && y_filter.is_some() {
                    src.insert("role".into(), Value::from("mixed"));
                    src.insert("strict_columns".into(), Value::Bool(false));
                    let mut cols = vec![
                        serde_json::json!({"role": "targets", "select": y_filter.clone().unwrap()}),
                    ];
                    cols.push(serde_json::json!({
                        "role": "features",
                        "select": x_filter.clone().unwrap_or(Value::from("rest"))
                    }));
                    src.insert("columns".into(), Value::Array(cols));
                } else if let Some(xf) = &x_filter {
                    src.insert("role".into(), Value::from("mixed"));
                    src.insert(
                        "columns".into(),
                        serde_json::json!([
                            {"role": "features", "select": xf},
                            {"role": "ignore", "select": "rest"}
                        ]),
                    );
                }
                sources.push(Value::Object(src));
                if i == 0 {
                    first_feature_id.insert(partition, sid);
                }
            }
        }
        let anchor = first_feature_id.get(partition).cloned();
        if let Some(y_val) = &y_val {
            let mut ysrc = Map::new();
            ysrc.insert("id".into(), Value::from(format!("{partition}_y")));
            ysrc.insert("role".into(), Value::from("targets"));
            ysrc.insert("input".into(), y_val.clone());
            ysrc.insert("partition".into(), Value::from(partition));
            let params = merge_params(&[
                config.get(&format!("{partition}_params")),
                config.get(&format!("{partition}_y_params")),
            ]);
            if !params.is_empty() {
                ysrc.insert("params".into(), Value::Object(params));
            }
            if let Some(yf) = &y_filter {
                ysrc.insert(
                    "columns".into(),
                    serde_json::json!([{"role": "targets", "select": yf}]),
                );
                ysrc.insert("role".into(), Value::from("mixed"));
            }
            if let Some(a) = &anchor {
                ysrc.insert("join".into(), serde_json::json!({"to": a, "how": "1:1"}));
            }
            sources.push(Value::Object(ysrc));
        }
        if let Some(g_val) = &g_val {
            let mut gsrc = Map::new();
            gsrc.insert("id".into(), Value::from(format!("{partition}_m")));
            gsrc.insert("role".into(), Value::from("metadata"));
            gsrc.insert("input".into(), g_val.clone());
            gsrc.insert("partition".into(), Value::from(partition));
            let params = merge_params(&[
                config.get(&format!("{partition}_params")),
                config.get(&format!("{partition}_group_params")),
            ]);
            if !params.is_empty() {
                gsrc.insert("params".into(), Value::Object(params));
            }
            if let Some(gf) = &g_filter {
                gsrc.insert(
                    "columns".into(),
                    serde_json::json!([{"role": "metadata", "select": gf}]),
                );
                gsrc.insert("role".into(), Value::from("mixed"));
            }
            if let Some(a) = &anchor {
                gsrc.insert("join".into(), serde_json::json!({"to": a, "how": "1:1"}));
            }
            sources.push(Value::Object(gsrc));
        }
    }
    if !sources.is_empty() {
        spec.insert("sources".into(), Value::Array(sources));
    }

    if let Some(folds) = present("folds") {
        let folds_spec = match folds {
            Value::String(s) => serde_json::json!({"file": s, "format": "auto"}),
            Value::Array(_) => serde_json::json!({"inline": folds}),
            Value::Object(_) => folds.clone(),
            _ => Value::Null,
        };
        if !folds_spec.is_null() {
            spec.insert("folds".into(), folds_spec);
        }
    }

    Value::Object(spec)
}

/// Normalize any dict config to a canonical DatasetSpec dict.
pub fn normalize_to_spec_dict(config: &Value) -> Value {
    let Value::Object(map) = config else {
        return config.clone();
    };
    let aliased = apply_key_aliases(map);
    if aliased.contains_key("sources") {
        return Value::Object(aliased);
    }
    const LEGACY: &[&str] = &[
        "train_x",
        "test_x",
        "train_y",
        "test_y",
        "train_group",
        "test_group",
        "folds",
    ];
    if LEGACY.iter().any(|k| aliased.contains_key(*k)) {
        legacy_to_spec_dict(&aliased)
    } else {
        Value::Object(aliased)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn normalize_key_basic() {
        assert_eq!(normalize_key("X_train"), "xtrain");
        assert_eq!(normalize_key("train-x"), "trainx");
        assert_eq!(normalize_key("Cal_X"), "calx");
    }

    #[test]
    fn alias_map_first_wins() {
        let m = alias_map();
        // canonical keys map to themselves
        assert_eq!(m.get("trainx").map(String::as_str), Some("train_x"));
        assert_eq!(m.get("xtrain").map(String::as_str), Some("train_x"));
        assert_eq!(m.get("ycal").map(String::as_str), Some("train_y"));
        assert_eq!(m.get("cv").map(String::as_str), Some("folds"));
    }

    #[test]
    fn legacy_xy_to_sources() {
        let cfg = json!({"Xcal": "X.csv", "Ycal": "Y.csv"});
        let spec = normalize_to_spec_dict(&cfg);
        let sources = spec["sources"].as_array().unwrap();
        assert_eq!(sources.len(), 2);
        assert_eq!(sources[0]["id"], "train_x");
        assert_eq!(sources[0]["role"], "features");
        assert_eq!(sources[1]["id"], "train_y");
        assert_eq!(sources[1]["join"], json!({"to": "train_x", "how": "1:1"}));
    }

    #[test]
    fn passthrough_when_sources_present() {
        let cfg = json!({"sources": [{"id": "x", "role": "features", "input": "X.csv"}]});
        let spec = normalize_to_spec_dict(&cfg);
        assert_eq!(spec, cfg);
    }

    #[test]
    fn legacy_target_and_metadata_params_preserve_partition_and_role_precedence() {
        use crate::materialize::loaders::effective_params;
        use crate::spec::DatasetSpec;
        let spec = normalize_to_spec_dict(&json!({
            "train_x":"x.csv","train_y":"y.csv","train_group":"m.csv",
            "test_x":"xt.csv","test_y":"yt.csv","test_group":"mt.csv",
            "global_params":{"delimiter":";","has_header":true,"encoding":"utf-8"},
            "train_params":{"has_header":false,"decimal_separator":","},
            "train_y_params":{"delimiter":"|"},
            "train_group_params":{"has_header":true},
            "test_y_params":{"has_header":false},
            "test_group_params":{"has_header":false}
        }));
        let typed = DatasetSpec::from_value(&spec).unwrap();
        for source in &typed.sources {
            let params = effective_params(&typed.params, &source.params);
            assert_eq!(params.encoding.as_deref(), Some("utf-8"));
            let expected_header = matches!(source.id.as_str(), "train_m" | "test_x");
            assert_eq!(params.has_header, Some(expected_header), "{}", source.id);
            assert_eq!(
                params.delimiter.as_deref(),
                Some(if source.id == "train_y" { "|" } else { ";" })
            );
            if source.id.starts_with("train") {
                assert_eq!(params.decimal_separator.as_deref(), Some(","));
            }
        }
    }
}
