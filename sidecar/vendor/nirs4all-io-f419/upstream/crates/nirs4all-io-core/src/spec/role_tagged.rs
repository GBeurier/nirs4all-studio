// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Strict adapter for Studio's existing role-tagged dataset configuration.
//!
//! This is an input adapter, not another persistent or wire schema.  It accepts
//! the already-persisted `config.files` shape, closes its otherwise permissive
//! vocabulary, and emits the one official [`DatasetSpec`] IR.  Materialization
//! remains owned by the existing facade loader.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::io::{self, Write};

use serde_json::{json, Map, Value};

use super::dataset_spec::DatasetSpec;
use super::enums::SpecError;
use super::normalize::normalize_to_spec_dict;
use super::validate::validate_spec;

const ROOT_FIELDS: &[&str] = &[
    "files",
    "parsing",
    "global_params",
    "delimiter",
    "decimal_separator",
    "has_header",
    "header_unit",
    "signal_type",
    "encoding",
    "na_policy",
    "na_fill_config",
    "aggregation",
    "folds",
    "task_type",
    "target_selection",
    // Redundant fields emitted by the current wizard.  They are accepted only
    // when they agree with target_selection; display-only target metadata is
    // deliberately not accepted.
    "targets",
    "default_target",
    // `null` is the wizard's no-op value.  A real multi_source block needs a
    // richer join mapping and is outside this initial adapter slice.
    "multi_source",
];
const PARSING_FIELDS: &[&str] = &[
    "delimiter",
    "decimal_separator",
    "has_header",
    "header_unit",
    "signal_type",
    "encoding",
    "na_policy",
    "na_fill_config",
];
const FILE_FIELDS: &[&str] = &["path", "type", "split", "source", "overrides"];
const TARGET_FIELDS: &[&str] = &[
    "column",
    "type",
    "is_default",
    "unit",
    "classes",
    "label",
    "description",
];

/// The role-tagged shape is a product boundary, so it deliberately has a much
/// smaller budget than the general-purpose `DatasetSpec` IR.
pub const MAX_ROLE_TAGGED_CONFIG_BYTES: usize = 1_048_576;
pub const MAX_ROLE_TAGGED_FILES: usize = 64;
pub const MAX_ROLE_TAGGED_TARGETS: usize = 64;
pub const MAX_ROLE_TAGGED_PATH_BYTES: usize = 4096;
pub const MAX_ROLE_TAGGED_STRING_BYTES: usize = 4096;
pub const MAX_ROLE_TAGGED_CLASSES: usize = 256;
pub const MAX_ROLE_TAGGED_INLINE_FOLDS: usize = 1024;
pub const MAX_ROLE_TAGGED_FOLD_INDICES: usize = 100_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TaggedRole {
    X,
    Y,
    Metadata,
}

impl TaggedRole {
    fn parse(value: &Value, field: &str) -> Result<Self, SpecError> {
        let raw = nonempty_string(value, field)?;
        match raw.to_ascii_lowercase().as_str() {
            "x" => Ok(Self::X),
            "y" => Ok(Self::Y),
            "m" | "meta" | "metadata" | "group" => Ok(Self::Metadata),
            _ => Err(err(format!(
                "{field}: unknown role {raw:?}; expected X, Y, or metadata"
            ))),
        }
    }

    fn suffix(self) -> &'static str {
        match self {
            Self::X => "x",
            Self::Y => "y",
            Self::Metadata => "group",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
enum TaggedSplit {
    Train,
    Test,
}

impl TaggedSplit {
    fn parse(value: Option<&Value>, field: &str) -> Result<Self, SpecError> {
        let raw = match value {
            Some(value) => nonempty_string(value, field)?.to_ascii_lowercase(),
            None => "train".to_string(),
        };
        match raw.as_str() {
            "train" => Ok(Self::Train),
            "test" => Ok(Self::Test),
            _ => Err(err(format!(
                "{field}: unknown split {raw:?}; expected train or test"
            ))),
        }
    }

    fn value(self) -> &'static str {
        match self {
            Self::Train => "train",
            Self::Test => "test",
        }
    }
}

#[derive(Clone, Debug)]
struct TaggedFile {
    index: usize,
    path: String,
    role: TaggedRole,
    split: TaggedSplit,
    overrides: Map<String, Value>,
}

#[derive(Clone, Debug)]
struct TargetSelection {
    selected: Vec<String>,
    task: Option<String>,
}

fn err(message: impl Into<String>) -> SpecError {
    SpecError::new(format!("role-tagged config: {}", message.into()))
}

struct SizeCounter {
    written: usize,
}

impl Write for SizeCounter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let next = self.written.saturating_add(buf.len());
        if next > MAX_ROLE_TAGGED_CONFIG_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::FileTooLarge,
                "role-tagged config exceeds its serialized-byte budget",
            ));
        }
        self.written = next;
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn validate_config_budget(config: &Value) -> Result<(), SpecError> {
    serde_json::to_writer(&mut SizeCounter { written: 0 }, config).map_err(|_| {
        err(format!(
            "config exceeds the {MAX_ROLE_TAGGED_CONFIG_BYTES}-byte serialized budget"
        ))
    })
}

fn object<'a>(value: &'a Value, field: &str) -> Result<&'a Map<String, Value>, SpecError> {
    value
        .as_object()
        .ok_or_else(|| err(format!("{field} must be an object")))
}

fn closed_object<'a>(
    value: &'a Value,
    field: &str,
    allowed: &[&str],
) -> Result<&'a Map<String, Value>, SpecError> {
    let map = object(value, field)?;
    for key in map.keys() {
        if !allowed.contains(&key.as_str()) {
            return Err(err(format!("{field}: unknown field {key:?}")));
        }
    }
    Ok(map)
}

fn nonempty_string(value: &Value, field: &str) -> Result<String, SpecError> {
    let raw = value
        .as_str()
        .ok_or_else(|| err(format!("{field} must be a string")))?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(err(format!("{field} must not be empty")));
    }
    if trimmed != raw {
        return Err(err(format!("{field} must not have surrounding whitespace")));
    }
    if raw.len() > MAX_ROLE_TAGGED_STRING_BYTES {
        return Err(err(format!(
            "{field} exceeds the {MAX_ROLE_TAGGED_STRING_BYTES}-byte string budget"
        )));
    }
    Ok(raw.to_string())
}

fn safe_path(value: &Value, field: &str) -> Result<String, SpecError> {
    let path = nonempty_string(value, field)?;
    if path.len() > MAX_ROLE_TAGGED_PATH_BYTES {
        return Err(err(format!(
            "{field} exceeds the {MAX_ROLE_TAGGED_PATH_BYTES}-byte path budget"
        )));
    }
    if path.contains('\0') {
        return Err(err(format!("{field} contains a NUL byte")));
    }
    if path.contains("://") {
        return Err(err(format!("{field} must be a filesystem path, not a URI")));
    }
    if path
        .split(['/', '\\'])
        .any(|component| component == "." || component == "..")
    {
        return Err(err(format!(
            "{field} contains an unsafe '.' or '..' component"
        )));
    }
    Ok(path)
}

fn canonical_task(value: &Value, field: &str) -> Result<String, SpecError> {
    let raw = nonempty_string(value, field)?;
    match raw.to_ascii_lowercase().as_str() {
        "auto" => Ok("auto".into()),
        "regression" => Ok("regression".into()),
        "binary" | "binary_classification" => Ok("binary".into()),
        "multiclass" | "multiclass_classification" => Ok("multiclass".into()),
        "classification" => Err(err(format!(
            "{field}: 'classification' is ambiguous; select binary_classification or multiclass_classification"
        ))),
        _ => Err(err(format!("{field}: unsupported task type {raw:?}"))),
    }
}

fn bounded_text(value: &Value, field: &str, max_bytes: usize) -> Result<(), SpecError> {
    let raw = value
        .as_str()
        .ok_or_else(|| err(format!("{field} must be a string")))?;
    if raw.contains('\0') {
        return Err(err(format!("{field} contains a NUL byte")));
    }
    if raw.len() > max_bytes {
        return Err(err(format!("{field} exceeds its {max_bytes}-byte budget")));
    }
    Ok(())
}

fn validate_target_metadata(target: &Map<String, Value>, field: &str) -> Result<(), SpecError> {
    for key in ["unit", "label"] {
        if let Some(value) = target.get(key) {
            bounded_text(value, &format!("{field}.{key}"), 256)?;
        }
    }
    if let Some(value) = target.get("description") {
        bounded_text(value, &format!("{field}.description"), 2048)?;
    }
    if let Some(value) = target.get("classes") {
        let classes = value
            .as_array()
            .ok_or_else(|| err(format!("{field}.classes must be an array")))?;
        if classes.len() > MAX_ROLE_TAGGED_CLASSES {
            return Err(err(format!(
                "{field}.classes exceeds the {MAX_ROLE_TAGGED_CLASSES}-class budget"
            )));
        }
        let mut seen = HashSet::new();
        for (index, class) in classes.iter().enumerate() {
            bounded_text(class, &format!("{field}.classes[{index}]"), 256)?;
            let class = class.as_str().unwrap();
            if !seen.insert(class) {
                return Err(err(format!(
                    "{field}.classes contains duplicate value {class:?}"
                )));
            }
        }
    }
    Ok(())
}

fn canonical_parsing_value(key: &str, value: &Value, field: &str) -> Result<Value, SpecError> {
    match key {
        "delimiter" => {
            let raw = nonempty_string(value, field)?;
            if raw.len() != 1 {
                return Err(err(format!("{field} must be exactly one ASCII byte")));
            }
            Ok(Value::String(raw))
        }
        "decimal_separator" => {
            let raw = nonempty_string(value, field)?;
            if raw != "." && raw != "," {
                return Err(err(format!("{field} must be '.' or ','")));
            }
            Ok(Value::String(raw))
        }
        "has_header" => value
            .as_bool()
            .map(Value::Bool)
            .ok_or_else(|| err(format!("{field} must be a boolean"))),
        "header_unit" => {
            let raw = nonempty_string(value, field)?;
            match raw.to_ascii_lowercase().as_str() {
                "nm" | "cm-1" | "text" | "none" | "index" => {
                    Ok(Value::String(raw.to_ascii_lowercase()))
                }
                _ => Err(err(format!("{field}: unsupported header unit {raw:?}"))),
            }
        }
        "signal_type" => {
            let raw = nonempty_string(value, field)?;
            match raw.to_ascii_lowercase().as_str() {
                "auto" | "absorbance" | "reflectance" | "reflectance%" | "transmittance"
                | "transmittance%" => Ok(Value::String(raw.to_ascii_lowercase())),
                _ => Err(err(format!("{field}: unsupported signal type {raw:?}"))),
            }
        }
        "encoding" => {
            let raw = nonempty_string(value, field)?;
            if raw.len() > 64 {
                return Err(err(format!("{field} is too long")));
            }
            Ok(Value::String(raw))
        }
        "na_policy" => {
            let raw = nonempty_string(value, field)?;
            match raw.to_ascii_lowercase().as_str() {
                "auto" | "abort" | "remove_sample" | "remove_feature" | "replace" | "ignore" => {
                    Ok(Value::String(raw.to_ascii_lowercase()))
                }
                _ => Err(err(format!("{field}: unsupported NA policy {raw:?}"))),
            }
        }
        "na_fill_config" => canonical_fill_config(value, field),
        _ => Err(err(format!("{field}: unsupported parsing field {key:?}"))),
    }
}

fn canonical_fill_config(value: &Value, field: &str) -> Result<Value, SpecError> {
    let map = closed_object(value, field, &["method", "fill_value", "per_column"])?;
    let method = map
        .get("method")
        .ok_or_else(|| err(format!("{field}.method is required")))?;
    let method = nonempty_string(method, &format!("{field}.method"))?;
    if !matches!(
        method.as_str(),
        "value" | "mean" | "median" | "forward_fill" | "backward_fill"
    ) {
        return Err(err(format!("{field}.method: unsupported value {method:?}")));
    }
    if method == "value" && !map.contains_key("fill_value") {
        return Err(err(format!(
            "{field}.fill_value is required when method is 'value'"
        )));
    }
    if let Some(per_column) = map.get("per_column") {
        if !per_column.is_boolean() {
            return Err(err(format!("{field}.per_column must be a boolean")));
        }
    }
    let mut out = Map::new();
    out.insert("method".into(), Value::String(method));
    if let Some(fill_value) = map.get("fill_value") {
        if fill_value.is_array() || fill_value.is_object() {
            return Err(err(format!("{field}.fill_value must be a scalar")));
        }
        out.insert("fill_value".into(), fill_value.clone());
    }
    if let Some(per_column) = map.get("per_column") {
        out.insert("per_column".into(), per_column.clone());
    }
    Ok(Value::Object(out))
}

fn parsing_map(value: Option<&Value>, field: &str) -> Result<Map<String, Value>, SpecError> {
    let Some(value) = value else {
        return Ok(Map::new());
    };
    let map = closed_object(value, field, PARSING_FIELDS)?;
    map.iter()
        .map(|(key, value)| {
            canonical_parsing_value(key, value, &format!("{field}.{key}"))
                .map(|value| (key.clone(), value))
        })
        .collect()
}

fn merge_parsing(root: &Map<String, Value>) -> Result<Map<String, Value>, SpecError> {
    let mut merged: Map<String, Value> = Map::new();
    for (label, values) in [
        ("config", root),
        (
            "config.parsing",
            &parsing_map(root.get("parsing"), "config.parsing")?,
        ),
        (
            "config.global_params",
            &parsing_map(root.get("global_params"), "config.global_params")?,
        ),
    ] {
        for key in PARSING_FIELDS {
            let Some(raw) = values.get(*key) else {
                continue;
            };
            let canonical = canonical_parsing_value(key, raw, &format!("{label}.{key}"))?;
            if let Some(existing) = merged.get(*key) {
                if existing != &canonical {
                    return Err(err(format!("conflicting values for parsing field {key:?}")));
                }
            } else {
                merged.insert((*key).to_string(), canonical);
            }
        }
    }
    merged
        .entry("delimiter")
        .or_insert_with(|| Value::String(";".into()));
    merged
        .entry("decimal_separator")
        .or_insert_with(|| Value::String(".".into()));
    merged.entry("has_header").or_insert(Value::Bool(true));
    merged
        .entry("header_unit")
        .or_insert_with(|| Value::String("cm-1".into()));
    merged
        .entry("signal_type")
        .or_insert_with(|| Value::String("auto".into()));
    validate_na_pair(&merged, "config parsing")?;
    Ok(merged)
}

fn validate_na_pair(map: &Map<String, Value>, field: &str) -> Result<(), SpecError> {
    let policy = map
        .get("na_policy")
        .and_then(Value::as_str)
        .unwrap_or("auto");
    let has_fill = map.contains_key("na_fill_config");
    if has_fill && policy != "replace" {
        return Err(err(format!(
            "{field}: na_fill_config requires na_policy='replace'"
        )));
    }
    if policy == "replace" && !has_fill {
        return Err(err(format!(
            "{field}: na_policy='replace' requires na_fill_config"
        )));
    }
    Ok(())
}

fn parse_files(root: &Map<String, Value>) -> Result<Vec<TaggedFile>, SpecError> {
    let files = root
        .get("files")
        .and_then(Value::as_array)
        .ok_or_else(|| err("config.files must be a non-empty array"))?;
    if files.is_empty() {
        return Err(err("config.files must be a non-empty array"));
    }
    if files.len() > MAX_ROLE_TAGGED_FILES {
        return Err(err(format!(
            "config.files exceeds the {MAX_ROLE_TAGGED_FILES}-file budget"
        )));
    }
    let mut parsed = Vec::with_capacity(files.len());
    let mut seen_paths = HashSet::new();
    let mut singleton_roles = HashSet::new();
    for (index, value) in files.iter().enumerate() {
        let field = format!("config.files[{index}]");
        let map = closed_object(value, &field, FILE_FIELDS)?;
        let path = safe_path(
            map.get("path")
                .ok_or_else(|| err(format!("{field}.path is required")))?,
            &format!("{field}.path"),
        )?;
        let normalized_path = path.replace('\\', "/");
        if !seen_paths.insert(normalized_path) {
            return Err(err(format!("{field}.path duplicates another file")));
        }
        let role = TaggedRole::parse(
            map.get("type")
                .ok_or_else(|| err(format!("{field}.type is required")))?,
            &format!("{field}.type"),
        )?;
        let split = TaggedSplit::parse(map.get("split"), &format!("{field}.split"))?;
        if role != TaggedRole::X && !singleton_roles.insert((split, role.suffix())) {
            return Err(err(format!(
                "{field}: duplicate {} file for split {:?}",
                role.suffix(),
                split.value()
            )));
        }
        let source = match map.get("source") {
            None | Some(Value::Null) => None,
            Some(value) => Some(value.as_u64().ok_or_else(|| {
                err(format!(
                    "{field}.source must be null or a non-negative integer"
                ))
            })?),
        };
        if role != TaggedRole::X && source.is_some() {
            return Err(err(format!(
                "{field}.source is only mapped for X files in this adapter slice"
            )));
        }
        let overrides = parsing_map(map.get("overrides"), &format!("{field}.overrides"))?;
        parsed.push(TaggedFile {
            index,
            path,
            role,
            split,
            overrides,
        });
    }

    let train_x = parsed
        .iter()
        .any(|f| f.split == TaggedSplit::Train && f.role == TaggedRole::X);
    let train_y = parsed
        .iter()
        .any(|f| f.split == TaggedSplit::Train && f.role == TaggedRole::Y);
    if !train_x || !train_y {
        return Err(err("the initial adapter slice requires one or more train X files and exactly one train Y file"));
    }
    for split in [TaggedSplit::Train, TaggedSplit::Test] {
        let has_x = parsed
            .iter()
            .any(|f| f.split == split && f.role == TaggedRole::X);
        let has_dependent = parsed
            .iter()
            .any(|f| f.split == split && f.role != TaggedRole::X);
        if has_dependent && !has_x {
            return Err(err(format!(
                "{} Y/metadata files require a {} X anchor",
                split.value(),
                split.value()
            )));
        }
    }
    Ok(parsed)
}

fn validate_effective_overrides(
    files: &[TaggedFile],
    parsing: &Map<String, Value>,
) -> Result<(), SpecError> {
    for file in files {
        let mut effective = parsing.clone();
        effective.extend(file.overrides.clone());
        validate_na_pair(
            &effective,
            &format!("config.files[{}].effective_parsing", file.index),
        )?;
    }
    Ok(())
}

fn parse_target_selection(root: &Map<String, Value>) -> Result<Option<TargetSelection>, SpecError> {
    let Some(value) = root.get("target_selection") else {
        if root.contains_key("targets") || root.contains_key("default_target") {
            return Err(err(
                "targets/default_target require the explicit target_selection contract",
            ));
        }
        return Ok(None);
    };
    let map = closed_object(
        value,
        "config.target_selection",
        &["selected_targets", "default_target", "task_by_target"],
    )?;
    let selected_values = map
        .get("selected_targets")
        .and_then(Value::as_array)
        .ok_or_else(|| err("config.target_selection.selected_targets must be a non-empty array"))?;
    if selected_values.is_empty() {
        return Err(err(
            "config.target_selection.selected_targets must be a non-empty array",
        ));
    }
    if selected_values.len() > MAX_ROLE_TAGGED_TARGETS {
        return Err(err(format!(
            "config.target_selection.selected_targets exceeds the {MAX_ROLE_TAGGED_TARGETS}-target budget"
        )));
    }
    let mut selected = Vec::with_capacity(selected_values.len());
    let mut unique = HashSet::new();
    for (index, value) in selected_values.iter().enumerate() {
        let target = nonempty_string(
            value,
            &format!("config.target_selection.selected_targets[{index}]"),
        )?;
        if !unique.insert(target.clone()) {
            return Err(err(format!("duplicate selected target {target:?}")));
        }
        selected.push(target);
    }
    let default_target = map
        .get("default_target")
        .map(|v| nonempty_string(v, "config.target_selection.default_target"))
        .transpose()?;
    if default_target
        .as_ref()
        .is_some_and(|target| !unique.contains(target))
    {
        return Err(err("target_selection.default_target is not selected"));
    }
    let task_map = map
        .get("task_by_target")
        .and_then(Value::as_object)
        .ok_or_else(|| err("config.target_selection.task_by_target must be an object"))?;
    if task_map.len() != selected.len() || task_map.keys().any(|key| !unique.contains(key)) {
        return Err(err(
            "target_selection.task_by_target keys must exactly match selected_targets",
        ));
    }
    let mut tasks = BTreeSet::new();
    for target in &selected {
        tasks.insert(canonical_task(
            &task_map[target],
            &format!("config.target_selection.task_by_target.{target}"),
        )?);
    }
    if tasks.len() > 1 {
        return Err(err(
            "heterogeneous per-target task types cannot be represented by DatasetSpec v1",
        ));
    }
    let task = tasks.into_iter().next();

    if let Some(root_default) = root.get("default_target") {
        let root_default = nonempty_string(root_default, "config.default_target")?;
        if default_target.as_deref() != Some(root_default.as_str()) {
            return Err(err(
                "config.default_target conflicts with target_selection.default_target",
            ));
        }
    }
    if let Some(targets) = root.get("targets") {
        let targets = targets
            .as_array()
            .ok_or_else(|| err("config.targets must be an array"))?;
        if targets.len() != selected.len() {
            return Err(err(
                "config.targets must exactly match target_selection.selected_targets",
            ));
        }
        for (index, (target, selected_target)) in targets.iter().zip(&selected).enumerate() {
            let field = format!("config.targets[{index}]");
            let target = closed_object(target, &field, TARGET_FIELDS)?;
            validate_target_metadata(target, &field)?;
            let column = nonempty_string(
                target
                    .get("column")
                    .ok_or_else(|| err(format!("config.targets[{index}].column is required")))?,
                &format!("config.targets[{index}].column"),
            )?;
            if &column != selected_target {
                return Err(err(
                    "config.targets order/columns conflict with target_selection",
                ));
            }
            let target_task = canonical_task(
                target
                    .get("type")
                    .ok_or_else(|| err(format!("config.targets[{index}].type is required")))?,
                &format!("config.targets[{index}].type"),
            )?;
            if target_task != "auto" && Some(&target_task) != task.as_ref() {
                return Err(err(
                    "config.targets task type conflicts with target_selection",
                ));
            }
            if let Some(is_default) = target.get("is_default") {
                let declared_default = is_default.as_bool().ok_or_else(|| {
                    err(format!(
                        "config.targets[{index}].is_default must be a boolean"
                    ))
                })?;
                if declared_default != (default_target.as_deref() == Some(column.as_str())) {
                    return Err(err(
                        "config.targets is_default conflicts with target_selection.default_target",
                    ));
                }
            }
        }
    }
    Ok(Some(TargetSelection { selected, task }))
}

fn parse_aggregation(root: &Map<String, Value>) -> Result<Option<(String, String)>, SpecError> {
    let Some(value) = root.get("aggregation") else {
        return Ok(None);
    };
    let map = closed_object(
        value,
        "config.aggregation",
        &["enabled", "column", "method"],
    )?;
    let enabled = map
        .get("enabled")
        .and_then(Value::as_bool)
        .ok_or_else(|| err("config.aggregation.enabled must be a boolean"))?;
    let method = match map.get("method") {
        Some(value) => {
            let method = nonempty_string(value, "config.aggregation.method")?;
            if !matches!(method.as_str(), "mean" | "median" | "vote") {
                return Err(err(format!(
                    "config.aggregation.method: unsupported value {method:?}"
                )));
            }
            method
        }
        None => "mean".into(),
    };
    if !enabled {
        return Ok(None);
    }
    let column = nonempty_string(
        map.get("column")
            .ok_or_else(|| err("config.aggregation.column is required when enabled"))?,
        "config.aggregation.column",
    )?;
    Ok(Some((column, method)))
}

fn validate_inline_folds(value: &Value) -> Result<(), SpecError> {
    let folds = value
        .as_array()
        .filter(|folds| !folds.is_empty())
        .ok_or_else(|| err("config.folds.folds must be a non-empty array"))?;
    if folds.len() > MAX_ROLE_TAGGED_INLINE_FOLDS {
        return Err(err(format!(
            "config.folds.folds exceeds the {MAX_ROLE_TAGGED_INLINE_FOLDS}-fold budget"
        )));
    }
    let mut total_indices = 0usize;
    for (fold_index, fold) in folds.iter().enumerate() {
        let fold = closed_object(
            fold,
            &format!("config.folds.folds[{fold_index}]"),
            &["train", "val"],
        )?;
        let mut sets = Vec::new();
        for side in ["train", "val"] {
            let values = fold.get(side).and_then(Value::as_array).ok_or_else(|| {
                err(format!(
                    "config.folds.folds[{fold_index}].{side} must be an array"
                ))
            })?;
            total_indices = total_indices.saturating_add(values.len());
            if total_indices > MAX_ROLE_TAGGED_FOLD_INDICES {
                return Err(err(format!(
                    "config.folds exceeds the {MAX_ROLE_TAGGED_FOLD_INDICES}-index budget"
                )));
            }
            let mut set = BTreeSet::new();
            for value in values {
                let index = value.as_u64().ok_or_else(|| {
                    err(format!("config.folds.folds[{fold_index}].{side} must contain non-negative integers"))
                })?;
                if index > i64::MAX as u64 {
                    return Err(err(format!(
                        "config.folds.folds[{fold_index}].{side} index exceeds i64"
                    )));
                }
                if !set.insert(index) {
                    return Err(err(format!(
                        "config.folds.folds[{fold_index}].{side} contains duplicate index {index}"
                    )));
                }
            }
            sets.push(set);
        }
        if !sets[0].is_disjoint(&sets[1]) {
            return Err(err(format!(
                "config.folds.folds[{fold_index}] train/val indices overlap"
            )));
        }
    }
    Ok(())
}

fn parse_folds(root: &Map<String, Value>) -> Result<Option<Value>, SpecError> {
    let Some(value) = root.get("folds") else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    let map = closed_object(
        value,
        "config.folds",
        &["source", "column", "file", "folds"],
    )?;
    let source = nonempty_string(
        map.get("source")
            .ok_or_else(|| err("config.folds.source is required"))?,
        "config.folds.source",
    )?;
    match source.as_str() {
        "none" => {
            if map.iter().any(|(key, value)| key != "source" && !value.is_null()) {
                return Err(err("config.folds source='none' conflicts with fold data"));
            }
            Ok(None)
        }
        "file" => {
            if map.get("column").is_some_and(|v| !v.is_null())
                || map.get("folds").is_some_and(|v| !v.is_null())
            {
                return Err(err("config.folds source='file' conflicts with column/inline data"));
            }
            let file = safe_path(
                map.get("file")
                    .ok_or_else(|| err("config.folds.file is required"))?,
                "config.folds.file",
            )?;
            Ok(Some(json!({"file": file})))
        }
        "inline" => {
            if map.get("column").is_some_and(|v| !v.is_null())
                || map.get("file").is_some_and(|v| !v.is_null())
            {
                return Err(err("config.folds source='inline' conflicts with column/file data"));
            }
            let folds = map
                .get("folds")
                .ok_or_else(|| err("config.folds.folds is required"))?;
            validate_inline_folds(folds)?;
            Ok(Some(json!({"inline": folds})))
        }
        "column" => Err(err("config.folds source='column' is not mapped in the initial explicit-file slice; use file or inline folds")),
        _ => Err(err(format!("config.folds.source: unsupported value {source:?}"))),
    }
}

fn loading_params_value(values: &Map<String, Value>) -> Value {
    let mut out = Map::new();
    for key in [
        "delimiter",
        "decimal_separator",
        "has_header",
        "header_unit",
        "signal_type",
        "encoding",
    ] {
        if let Some(value) = values.get(key) {
            if key != "signal_type" || value.as_str() != Some("auto") {
                out.insert(key.into(), value.clone());
            }
        }
    }
    if values.contains_key("na_policy") || values.contains_key("na_fill_config") {
        let mut na = Map::new();
        na.insert(
            "policy".into(),
            values
                .get("na_policy")
                .cloned()
                .unwrap_or_else(|| Value::String("auto".into())),
        );
        if let Some(fill) = values.get("na_fill_config") {
            na.insert("fill".into(), fill.clone());
        }
        out.insert("na".into(), Value::Object(na));
    }
    Value::Object(out)
}

fn studio_legacy_config(
    root: &Map<String, Value>,
    files: &[TaggedFile],
    parsing: &Map<String, Value>,
    aggregation: &Option<(String, String)>,
    folds: &Option<Value>,
    task: Option<&str>,
) -> Result<Value, SpecError> {
    let mut global = Map::new();
    for key in [
        "delimiter",
        "decimal_separator",
        "has_header",
        "encoding",
        "na_policy",
        "na_fill_config",
    ] {
        if let Some(value) = parsing.get(key) {
            global.insert(key.into(), value.clone());
        }
    }
    let mut legacy = Map::new();
    legacy.insert("global_params".into(), Value::Object(global));

    let mut x_specific = Map::new();
    if let Some(value) = parsing.get("header_unit") {
        x_specific.insert("header_unit".into(), value.clone());
    }
    if let Some(value) = parsing
        .get("signal_type")
        .filter(|v| v.as_str() != Some("auto"))
    {
        x_specific.insert("signal_type".into(), value.clone());
    }

    for file in files {
        let key = format!("{}_{}", file.split.value(), file.role.suffix());
        if file.role == TaggedRole::X {
            if let Some(existing) = legacy.get_mut(&key) {
                if let Value::Array(paths) = existing {
                    paths.push(Value::String(file.path.clone()));
                } else {
                    let first = existing.clone();
                    *existing = Value::Array(vec![first, Value::String(file.path.clone())]);
                }
            } else {
                legacy.insert(key.clone(), Value::String(file.path.clone()));
            }
        } else {
            legacy.insert(key.clone(), Value::String(file.path.clone()));
        }
        let mut effective = if file.role == TaggedRole::X {
            x_specific.clone()
        } else {
            Map::new()
        };
        effective.extend(file.overrides.clone());
        if !effective.is_empty() {
            let param_key = format!("{key}_params");
            if let Some(existing) = legacy.get(&param_key) {
                if existing != &Value::Object(effective.clone()) {
                    return Err(err(format!(
                        "config.files[{}].overrides conflicts with another {} X source; Studio has only one shared parameter slot",
                        file.index,
                        file.split.value()
                    )));
                }
            }
            legacy.insert(param_key, Value::Object(effective));
        }
    }
    if let Some((column, method)) = aggregation {
        legacy.insert("aggregate".into(), Value::String(column.clone()));
        legacy.insert("repetition".into(), Value::String(column.clone()));
        legacy.insert("aggregate_method".into(), Value::String(method.clone()));
    }
    if let Some(folds) = folds {
        if let Some(file) = folds.get("file") {
            legacy.insert("folds".into(), file.clone());
        } else if let Some(inline) = folds.get("inline") {
            legacy.insert("folds".into(), inline.clone());
        }
    }
    if let Some(task) = task.filter(|task| *task != "auto") {
        legacy.insert("task_type".into(), Value::String(task.into()));
    }
    // `name` belongs to the stored dataset record, outside `config`; callers
    // use the existing facade `name` argument just like Studio does.
    let _ = root;
    Ok(Value::Object(legacy))
}

fn patch_canonical_spec(
    spec: &mut Value,
    files: &[TaggedFile],
    parsing: &Map<String, Value>,
    folds: &Option<Value>,
    selection: Option<&TargetSelection>,
) -> Result<(), SpecError> {
    let root = spec
        .as_object_mut()
        .ok_or_else(|| err("internal normalization did not produce an object"))?;
    root.insert("params".into(), loading_params_value(parsing));
    if let Some(folds) = folds {
        root.insert("folds".into(), folds.clone());
    }

    let sources = root
        .get_mut("sources")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| err("internal normalization did not produce sources"))?;
    let mut x_offsets: HashMap<TaggedSplit, usize> = HashMap::new();
    let x_counts: HashMap<TaggedSplit, usize> = [TaggedSplit::Train, TaggedSplit::Test]
        .into_iter()
        .map(|split| {
            (
                split,
                files
                    .iter()
                    .filter(|file| file.split == split && file.role == TaggedRole::X)
                    .count(),
            )
        })
        .collect();
    let mut by_id = BTreeMap::new();
    for file in files {
        let id = match file.role {
            TaggedRole::X if x_counts[&file.split] > 1 => {
                let offset = x_offsets.entry(file.split).or_default();
                let id = format!("{}_x_{}", file.split.value(), *offset);
                *offset += 1;
                id
            }
            TaggedRole::X => format!("{}_x", file.split.value()),
            TaggedRole::Y => format!("{}_y", file.split.value()),
            TaggedRole::Metadata => format!("{}_m", file.split.value()),
        };
        by_id.insert(id, file);
    }
    for source in sources {
        let source = source
            .as_object_mut()
            .ok_or_else(|| err("internal normalized source is not an object"))?;
        let id = source
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| err("internal normalized source has no id"))?;
        let file = by_id.get(id).ok_or_else(|| {
            err(format!(
                "internal normalized source {id:?} has no role-tagged file"
            ))
        })?;
        let mut source_params = Map::new();
        if file.role == TaggedRole::X {
            for key in ["header_unit", "signal_type"] {
                if let Some(value) = parsing.get(key) {
                    source_params.insert(key.into(), value.clone());
                }
            }
        }
        source_params.extend(file.overrides.clone());
        if source_params.is_empty() {
            source.remove("params");
        } else {
            source.insert("params".into(), loading_params_value(&source_params));
        }
        if file.role == TaggedRole::Y {
            if let Some(selection) = selection {
                source.insert("role".into(), Value::String("mixed".into()));
                source.insert(
                    "columns".into(),
                    json!([
                        {"role": "targets", "select": selection.selected},
                        {"role": "ignore", "select": "rest"}
                    ]),
                );
            }
        }
    }
    Ok(())
}

/// Convert Studio's existing role-tagged `config.files` object into the
/// official `DatasetSpec` IR.
///
/// The accepted surface is intentionally closed.  This initial slice supports
/// explicit train X/Y (required), optional test X/Y and metadata files,
/// homogeneous multi-target selection, global/per-file CSV parsing,
/// aggregation, and file/inline folds.  It rejects ambiguous classification,
/// heterogeneous target tasks, column-sourced folds, and `multi_source` join
/// descriptors instead of silently weakening them. `files` order is the
/// scientific source order, matching Studio's selected oracle; `source` is a
/// validated UI annotation and does not reorder or group files.
pub fn role_tagged_config_to_spec(config: &Value) -> Result<DatasetSpec, SpecError> {
    validate_config_budget(config)?;
    let root = closed_object(config, "config", ROOT_FIELDS)?;
    if root
        .get("multi_source")
        .is_some_and(|value| !value.is_null())
    {
        return Err(err(
            "config.multi_source is not mapped in the initial adapter slice",
        ));
    }
    let files = parse_files(root)?;
    let parsing = merge_parsing(root)?;
    validate_effective_overrides(&files, &parsing)?;
    let aggregation = parse_aggregation(root)?;
    let folds = parse_folds(root)?;
    let selection = parse_target_selection(root)?;

    let root_task = root
        .get("task_type")
        .map(|value| canonical_task(value, "config.task_type"))
        .transpose()?;
    let selected_task = selection
        .as_ref()
        .and_then(|selection| selection.task.clone());
    if let (Some(root_task), Some(selected_task)) = (&root_task, &selected_task) {
        if root_task != "auto" && selected_task != "auto" && root_task != selected_task {
            return Err(err(
                "config.task_type conflicts with target_selection.task_by_target",
            ));
        }
    }
    let effective_task = root_task
        .filter(|task| task != "auto")
        .or_else(|| selected_task.filter(|task| task != "auto"));

    let legacy = studio_legacy_config(
        root,
        &files,
        &parsing,
        &aggregation,
        &folds,
        effective_task.as_deref(),
    )?;
    let mut canonical = normalize_to_spec_dict(&legacy);
    patch_canonical_spec(&mut canonical, &files, &parsing, &folds, selection.as_ref())?;
    let spec = DatasetSpec::from_value(&canonical)?;
    validate_spec(&spec)?;
    Ok(spec)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn adapt(value: Value) -> Result<Value, SpecError> {
        role_tagged_config_to_spec(&value).map(|spec| spec.to_value())
    }

    fn minimal() -> Value {
        json!({
            "files": [
                {"path": "/data/X.csv", "type": "X", "split": "train", "source": 0},
                {"path": "/data/Y.csv", "type": "Y", "split": "train", "source": null}
            ]
        })
    }

    #[test]
    fn frozen_studio_translator_fixture_has_structural_parity() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../../tests/fixtures/role_tagged/studio_full.json"
        ))
        .unwrap();
        let config = fixture.get("config").unwrap();
        let root = config.as_object().unwrap();
        let files = parse_files(root).unwrap();
        let parsing = merge_parsing(root).unwrap();
        let aggregation = parse_aggregation(root).unwrap();
        let folds = parse_folds(root).unwrap();
        let selection = parse_target_selection(root).unwrap();
        let root_task = canonical_task(root.get("task_type").unwrap(), "config.task_type").unwrap();
        let legacy = studio_legacy_config(
            root,
            &files,
            &parsing,
            &aggregation,
            &folds,
            Some(&root_task),
        )
        .unwrap();
        assert_eq!(legacy, fixture["studio_legacy_config"]);

        let actual = role_tagged_config_to_spec(config).unwrap().to_value();
        assert_eq!(actual, fixture["expected_dataset_spec"]);
        assert!(selection.is_some());
    }

    #[test]
    fn selected_studio_oracle_corpus_matches_exact_legacy_translation() {
        let corpus: Value = serde_json::from_str(include_str!(
            "../../../../tests/fixtures/role_tagged/studio_oracle_corpus.json"
        ))
        .unwrap();
        assert_eq!(
            corpus["oracle_source_sha256"],
            "c5a4a4d37b498ffb17c42dce74e37db9b964fc30892aa3d6a7b0a27e836c2a62"
        );
        for case in corpus["cases"].as_array().unwrap() {
            let mut config = Map::new();
            config.insert("files".into(), case["files"].clone());
            config.insert("parsing".into(), case["parsing"].clone());
            config.insert("task_type".into(), case["task_type"].clone());
            if !case["aggregation"].is_null() {
                config.insert("aggregation".into(), case["aggregation"].clone());
            }
            if !case["folds"].is_null() {
                config.insert("folds".into(), case["folds"].clone());
            }
            let config = Value::Object(config);
            let root = config.as_object().unwrap();
            let files = parse_files(root).unwrap();
            let parsing = merge_parsing(root).unwrap();
            validate_effective_overrides(&files, &parsing).unwrap();
            let aggregation = parse_aggregation(root).unwrap();
            let folds = parse_folds(root).unwrap();
            let task = canonical_task(&case["task_type"], "config.task_type").unwrap();
            let legacy =
                studio_legacy_config(root, &files, &parsing, &aggregation, &folds, Some(&task))
                    .unwrap();
            assert_eq!(
                legacy, case["expected_legacy_config"],
                "oracle case {}",
                case["name"]
            );
            role_tagged_config_to_spec(&config).unwrap();
        }
    }

    #[test]
    fn rejects_unknown_duplicate_conflicting_and_unsafe_inputs() {
        let mut unknown = minimal();
        unknown["surprise"] = json!(true);
        assert!(adapt(unknown)
            .unwrap_err()
            .message
            .contains("unknown field"));

        let mut duplicate = minimal();
        duplicate["files"].as_array_mut().unwrap().push(json!({
            "path": "/data/Y2.csv", "type": "Y", "split": "train", "source": null
        }));
        assert!(adapt(duplicate)
            .unwrap_err()
            .message
            .contains("duplicate y"));

        let mut conflict = minimal();
        conflict["delimiter"] = json!(";");
        conflict["global_params"] = json!({"delimiter": ","});
        assert!(adapt(conflict)
            .unwrap_err()
            .message
            .contains("conflicting values"));

        let mut unsafe_path = minimal();
        unsafe_path["files"][0]["path"] = json!("../X.csv");
        assert!(adapt(unsafe_path).unwrap_err().message.contains("unsafe"));

        let mut unknown_override = minimal();
        unknown_override["files"][0]["overrides"] = json!({"skip_rows": 2});
        assert!(adapt(unknown_override)
            .unwrap_err()
            .message
            .contains("unknown field"));
    }

    #[test]
    fn rejects_ambiguous_and_unmapped_scientific_contracts() {
        let mut ambiguous = minimal();
        ambiguous["task_type"] = json!("classification");
        assert!(adapt(ambiguous).unwrap_err().message.contains("ambiguous"));

        let mut column_folds = minimal();
        column_folds["folds"] = json!({"source": "column", "column": "fold"});
        assert!(adapt(column_folds)
            .unwrap_err()
            .message
            .contains("not mapped"));

        let mut multimodal = minimal();
        multimodal["multi_source"] = json!({"sources": []});
        assert!(adapt(multimodal)
            .unwrap_err()
            .message
            .contains("not mapped"));

        let mut non_first_default = minimal();
        non_first_default["task_type"] = json!("regression");
        non_first_default["target_selection"] = json!({
            "selected_targets": ["first", "second"],
            "default_target": "second",
            "task_by_target": {"first": "regression", "second": "regression"}
        });
        let spec = adapt(non_first_default).unwrap();
        assert_eq!(
            spec["sources"][1]["columns"][0]["select"],
            json!(["first", "second"])
        );
    }

    #[test]
    fn source_is_an_annotation_but_ambiguous_shared_overrides_fail() {
        let mut annotated = minimal();
        annotated["files"][0]["source"] = json!(4);
        annotated["files"].as_array_mut().unwrap().insert(
            1,
            json!({"path": "/data/X2.csv", "type": "X", "split": "train", "source": 4}),
        );
        let spec = adapt(annotated).unwrap();
        assert_eq!(spec["sources"][0]["input"], "/data/X.csv");
        assert_eq!(spec["sources"][1]["input"], "/data/X2.csv");

        let mut distinct_overrides = minimal();
        distinct_overrides["files"] = json!([
            {"path": "/data/X1.csv", "type": "X", "split": "train", "source": 0,
             "overrides": {"delimiter": ";"}},
            {"path": "/data/X2.csv", "type": "X", "split": "train", "source": 1,
             "overrides": {"delimiter": ","}},
            {"path": "/data/Y.csv", "type": "Y", "split": "train", "source": null}
        ]);
        assert!(adapt(distinct_overrides)
            .unwrap_err()
            .message
            .contains("shared parameter slot"));
    }

    #[test]
    fn validates_partial_na_overrides_after_global_inheritance() {
        let mut value = minimal();
        value["na_policy"] = json!("replace");
        value["na_fill_config"] = json!({"method": "mean"});
        value["files"][0]["overrides"] = json!({
            "na_fill_config": {"method": "median"}
        });
        let spec = adapt(value).unwrap();
        assert_eq!(spec["params"]["na"]["policy"], "replace");
        assert_eq!(
            spec["sources"][0]["params"]["na"]["fill"]["method"],
            "median"
        );
    }

    #[test]
    fn accepts_bounded_studio_target_metadata() {
        let mut value = minimal();
        value["task_type"] = json!("binary_classification");
        value["targets"] = json!([{
            "column": "class",
            "type": "binary_classification",
            "is_default": true,
            "unit": "category",
            "classes": ["A", "B"],
            "label": "Class",
            "description": "Detected categorical target"
        }]);
        value["default_target"] = json!("class");
        value["target_selection"] = json!({
            "selected_targets": ["class"],
            "default_target": "class",
            "task_by_target": {"class": "binary_classification"}
        });
        let spec = adapt(value).unwrap();
        assert_eq!(spec["task_type"], "binary");
        assert_eq!(spec["sources"][1]["columns"][0]["select"], json!(["class"]));
    }

    #[test]
    fn enforces_collection_and_serialized_budgets() {
        let mut too_many_files = minimal();
        let files = too_many_files["files"].as_array_mut().unwrap();
        for index in 0..MAX_ROLE_TAGGED_FILES {
            files.push(json!({
                "path": format!("/data/extra-{index}.csv"),
                "type": "X",
                "split": "train",
                "source": index + 1
            }));
        }
        assert!(adapt(too_many_files)
            .unwrap_err()
            .message
            .contains("file budget"));

        let oversized = json!({
            "files": [
                {"path": "/data/X.csv", "type": "X"},
                {"path": "/data/Y.csv", "type": "Y"}
            ],
            "encoding": "x".repeat(MAX_ROLE_TAGGED_CONFIG_BYTES)
        });
        assert!(adapt(oversized)
            .unwrap_err()
            .message
            .contains("serialized budget"));
    }

    #[test]
    fn accepts_the_wizard_auto_target_and_omitted_default_marker() {
        let mut value = minimal();
        value["task_type"] = json!("regression");
        value["targets"] = json!([{"column": "protein", "type": "auto"}]);
        value["default_target"] = json!("protein");
        value["target_selection"] = json!({
            "selected_targets": ["protein"],
            "default_target": "protein",
            "task_by_target": {"protein": "regression"}
        });
        let spec = adapt(value).unwrap();
        assert_eq!(spec["task_type"], "regression");
        assert_eq!(
            spec["sources"][1]["columns"][0]["select"],
            json!(["protein"])
        );
    }
}
