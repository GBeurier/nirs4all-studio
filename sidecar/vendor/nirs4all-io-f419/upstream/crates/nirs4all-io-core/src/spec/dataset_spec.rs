// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! The canonical `DatasetSpec` IR (ports `spec/dataset_spec.py`).
//!
//! Hand-written `from_value`/`to_value` (NOT serde-derive) because the emission
//! rules are bespoke and byte-golden-critical (trap #8): two distinct omission
//! predicates coexist — `drop_none` (drop `null`/`[]`/`{}`, keep `false`/`0`/`""`)
//! and `input is not None` (keep `[]`/`""`, drop only absent) — plus per-field
//! gates (`schema_version` always; `sources` always; `task_type` omit-when-auto;
//! `sample_index` omit-when-`{"by":"row"}`; `strict_columns` only-when-false;
//! `unknown_policy` omit-when-train; `folds.format` only-with-file-and-non-auto;
//! `aggregate.outlier_threshold` only-with-exclude_outliers; …).

use serde_json::{Map, Value};

use super::enums::{
    AggregateMethod, Cardinality, CategoricalMode, Coverage, FillMethod, FoldFormat, HeaderUnit,
    MergeMode, Modality, NaPolicy, Partition, PartitionBy, Role, SampleIndexBy, SignalType,
    SourceKind, SpecError, TaskType, UnknownPolicy,
};
use super::selectors::Selector;
use crate::pyfmt::{py_int, py_repr, py_truthy};
use crate::versions::DATASET_SPEC_SCHEMA_VERSION;

// --------------------------------------------------------------------------- //
// helpers                                                                     //
// --------------------------------------------------------------------------- //
fn as_object<'a>(v: &'a Value, what: &str) -> Result<&'a Map<String, Value>, SpecError> {
    v.as_object()
        .ok_or_else(|| SpecError::new(format!("{what} must be a mapping, got {}", py_type(v))))
}

fn py_type(v: &Value) -> &'static str {
    match v {
        Value::Null => "NoneType",
        Value::Bool(_) => "bool",
        Value::Number(n) => {
            if n.is_f64() {
                "float"
            } else {
                "int"
            }
        }
        Value::String(_) => "str",
        Value::Array(_) => "list",
        Value::Object(_) => "dict",
    }
}

/// First present key among `keys` (Python `_get`).
fn get_first<'a>(d: &'a Map<String, Value>, keys: &[&str]) -> Option<&'a Value> {
    keys.iter().find_map(|k| d.get(*k))
}

/// `_drop_none`: drop `null`/`[]`/`{}`, keep `false`/`0`/`""`.
fn drop_none(pairs: Vec<(&str, Value)>) -> Value {
    let mut m = Map::new();
    for (k, v) in pairs {
        let drop = v.is_null()
            || matches!(&v, Value::Array(a) if a.is_empty())
            || matches!(&v, Value::Object(o) if o.is_empty());
        if !drop {
            m.insert(k.to_string(), v);
        }
    }
    Value::Object(m)
}

fn opt_string(v: Option<&Value>) -> Option<String> {
    match v {
        Some(Value::String(s)) => Some(s.clone()),
        _ => None,
    }
}

fn bool_default(d: &Map<String, Value>, key: &str, default: bool) -> bool {
    match d.get(key) {
        Some(v) => py_truthy(v),
        None => default,
    }
}

fn coerce_opt<T, F>(d: &Map<String, Value>, key: &str, f: F) -> Result<Option<T>, SpecError>
where
    F: Fn(&Value) -> Result<T, SpecError>,
{
    match d.get(key) {
        Some(v) if !v.is_null() => Ok(Some(f(v)?)),
        _ => Ok(None),
    }
}

// --------------------------------------------------------------------------- //
// NaConfig / FormatParams / LoadingParams                                     //
// --------------------------------------------------------------------------- //
#[derive(Debug, Clone, PartialEq)]
pub struct NaConfig {
    pub policy: NaPolicy,
    pub fill_method: Option<FillMethod>,
    pub fill_value: Value,
    pub fill_per_column: bool,
}

impl Default for NaConfig {
    fn default() -> Self {
        Self {
            policy: NaPolicy::Auto,
            fill_method: None,
            fill_value: Value::Null,
            fill_per_column: true,
        }
    }
}

impl NaConfig {
    fn from_value(d: Option<&Value>) -> Result<Self, SpecError> {
        let Some(Value::Object(d)) = d else {
            return Ok(Self::default());
        };
        if d.is_empty() {
            return Ok(Self::default());
        }
        let empty = Map::new();
        let fill = match d.get("fill") {
            Some(Value::Object(m)) => m,
            _ => &empty,
        };
        let policy = match d.get("policy") {
            Some(v) => NaPolicy::coerce(v, "na.policy")?,
            None => NaPolicy::Auto,
        };
        let fill_method = match fill.get("method") {
            Some(v) if py_truthy(v) => Some(FillMethod::coerce(v, "na.fill.method")?),
            _ => None,
        };
        Ok(Self {
            policy,
            fill_method,
            fill_value: fill.get("fill_value").cloned().unwrap_or(Value::Null),
            fill_per_column: match fill.get("per_column") {
                Some(v) => py_truthy(v),
                None => true,
            },
        })
    }

    fn to_value(&self) -> Value {
        let fill = drop_none(vec![
            (
                "method",
                self.fill_method
                    .map(|m| Value::from(m.value()))
                    .unwrap_or(Value::Null),
            ),
            ("fill_value", self.fill_value.clone()),
            (
                "per_column",
                if self.fill_per_column {
                    Value::Bool(true)
                } else {
                    Value::Null
                },
            ),
        ]);
        let mut out = Map::new();
        out.insert("policy".into(), Value::from(self.policy.value()));
        if !fill.as_object().unwrap().is_empty() {
            out.insert("fill".into(), fill);
        }
        Value::Object(out)
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct FormatParams {
    pub values: Map<String, Value>,
}

impl FormatParams {
    fn from_value(d: Option<&Value>) -> Self {
        match d {
            Some(Value::Object(m)) => Self { values: m.clone() },
            _ => Self::default(),
        }
    }
    fn to_value(&self) -> Value {
        Value::Object(self.values.clone())
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct LoadingParams {
    pub delimiter: Option<String>,
    pub decimal_separator: Option<String>,
    pub has_header: Option<bool>,
    pub header_unit: Option<HeaderUnit>,
    pub signal_type: Option<SignalType>,
    pub encoding: Option<String>,
    pub na: NaConfig,
    pub categorical: Option<CategoricalMode>,
    pub format: FormatParams,
}

impl LoadingParams {
    pub fn from_value(d: Option<&Value>) -> Result<Self, SpecError> {
        let Some(Value::Object(d)) = d else {
            return Ok(Self::default());
        };
        if d.is_empty() {
            return Ok(Self::default());
        }
        Ok(Self {
            delimiter: opt_string(d.get("delimiter")),
            decimal_separator: opt_string(get_first(d, &["decimal_separator", "decimal"])),
            has_header: match get_first(d, &["has_header", "header"]) {
                Some(Value::Bool(b)) => Some(*b),
                _ => None,
            },
            header_unit: coerce_opt(d, "header_unit", |v| {
                HeaderUnit::coerce(v, "params.header_unit")
            })?,
            signal_type: coerce_opt(d, "signal_type", |v| {
                SignalType::coerce(v, "params.signal_type")
            })?,
            encoding: opt_string(d.get("encoding")),
            na: NaConfig::from_value(d.get("na"))?,
            categorical: coerce_opt(d, "categorical", |v| {
                CategoricalMode::coerce(v, "params.categorical")
            })?,
            format: FormatParams::from_value(d.get("format")),
        })
    }

    pub fn to_value(&self) -> Value {
        let mut out = drop_none(vec![
            ("delimiter", json_opt_str(&self.delimiter)),
            ("decimal_separator", json_opt_str(&self.decimal_separator)),
            (
                "has_header",
                self.has_header.map(Value::Bool).unwrap_or(Value::Null),
            ),
            ("header_unit", opt_enum(self.header_unit.map(|h| h.value()))),
            ("signal_type", opt_enum(self.signal_type.map(|s| s.value()))),
            ("encoding", json_opt_str(&self.encoding)),
            ("categorical", opt_enum(self.categorical.map(|c| c.value()))),
        ]);
        let map = out.as_object_mut().unwrap();
        let na = self.na.to_value();
        let na_obj = na.as_object().unwrap();
        let policy_not_auto = na_obj.get("policy").and_then(|v| v.as_str()) != Some("auto");
        if policy_not_auto || na_obj.contains_key("fill") {
            map.insert("na".into(), na);
        }
        let fmt = self.format.to_value();
        if !fmt.as_object().unwrap().is_empty() {
            map.insert("format".into(), fmt);
        }
        out
    }

    pub fn is_empty_value(&self) -> bool {
        self.to_value()
            .as_object()
            .map(|m| m.is_empty())
            .unwrap_or(true)
    }
}

fn json_opt_str(s: &Option<String>) -> Value {
    s.as_ref()
        .map(|v| Value::from(v.clone()))
        .unwrap_or(Value::Null)
}

fn opt_enum(s: Option<&'static str>) -> Value {
    s.map(Value::from).unwrap_or(Value::Null)
}

// --------------------------------------------------------------------------- //
// ColumnRole / JoinSpec / VariationSpec / SourceSpec                          //
// --------------------------------------------------------------------------- //
fn coerce_column_role(v: &Value, field: &str) -> Result<Role, SpecError> {
    let role = Role::coerce(v, field)?;
    if role == Role::Mixed {
        return Err(SpecError::new(format!(
            "{field}: 'mixed' is a source-level role, not a column role"
        )));
    }
    Ok(role)
}

#[derive(Debug, Clone, PartialEq)]
pub struct ColumnRole {
    pub role: Role,
    pub select: Selector,
}

impl ColumnRole {
    fn from_value(d: &Value) -> Result<Self, SpecError> {
        let m = d
            .as_object()
            .filter(|m| m.contains_key("role") && m.contains_key("select"))
            .ok_or_else(|| {
                SpecError::new(format!(
                    "column-role entry needs 'role' and 'select': {}",
                    py_repr(d)
                ))
            })?;
        Ok(Self {
            role: coerce_column_role(&m["role"], "columns[].role")?,
            select: Selector::parse(&m["select"])?,
        })
    }
    fn to_value(&self) -> Value {
        serde_json::json!({ "role": self.role.value(), "select": self.select.to_spec() })
    }
}

/// Parse the `columns` field; returns (roles, came_from_map).
fn parse_columns(value: Option<&Value>) -> Result<(Vec<ColumnRole>, bool), SpecError> {
    match value {
        None | Some(Value::Null) => Ok((vec![], false)),
        Some(Value::Array(items)) => {
            let roles = items
                .iter()
                .map(ColumnRole::from_value)
                .collect::<Result<_, _>>()?;
            Ok((roles, false))
        }
        Some(Value::Object(map)) => {
            let mut roles = Vec::with_capacity(map.len());
            for (role, sel) in map {
                roles.push(ColumnRole {
                    role: coerce_column_role(&Value::from(role.clone()), "columns key")?,
                    select: Selector::parse(sel)?,
                });
            }
            Ok((roles, true))
        }
        Some(other) => Err(SpecError::new(format!(
            "'columns' must be a list or a map, got {}",
            py_type(other)
        ))),
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct JoinSpec {
    pub left: Option<String>,
    pub right: String,
    pub left_on: Value,
    pub right_on: Value,
    pub cardinality: Cardinality,
    pub coverage: Coverage,
}

impl JoinSpec {
    fn from_value(d: &Value, this_source: Option<&str>) -> Result<Self, SpecError> {
        let m = as_object(d, "join")?;
        let cardinality = match get_first(m, &["cardinality", "how"]) {
            Some(v) => Cardinality::coerce(v, "join.cardinality")?,
            None => Cardinality::OneToOne,
        };
        let coverage = match m.get("coverage") {
            Some(v) => Coverage::coerce(v, "join.coverage")?,
            None => Coverage::Complete,
        };
        let left = opt_string(m.get("left")).or_else(|| this_source.map(str::to_string));
        if let Some(to) = m.get("to") {
            let on = m.get("on").cloned();
            Ok(Self {
                left,
                right: value_to_string(to),
                left_on: m
                    .get("left_on")
                    .cloned()
                    .or_else(|| on.clone())
                    .unwrap_or(Value::Null),
                right_on: m.get("right_on").cloned().or(on).unwrap_or(Value::Null),
                cardinality,
                coverage,
            })
        } else if let Some(right) = m.get("right") {
            Ok(Self {
                left,
                right: value_to_string(right),
                left_on: m.get("left_on").cloned().unwrap_or(Value::Null),
                right_on: m.get("right_on").cloned().unwrap_or(Value::Null),
                cardinality,
                coverage,
            })
        } else {
            Err(SpecError::new(format!(
                "join needs 'right' (or shorthand 'to'): {}",
                py_repr(d)
            )))
        }
    }

    fn to_value(&self) -> Value {
        drop_none(vec![
            ("left", json_opt_str(&self.left)),
            ("right", Value::from(self.right.clone())),
            ("left_on", self.left_on.clone()),
            ("right_on", self.right_on.clone()),
            ("cardinality", Value::from(self.cardinality.value())),
            ("coverage", Value::from(self.coverage.value())),
        ])
    }
}

fn value_to_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        other => crate::pyfmt::py_str_scalar(other),
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct VariationSpec {
    pub name: String,
    pub input: Value,
    pub params: LoadingParams,
}

impl VariationSpec {
    fn from_value(d: &Value) -> Result<Self, SpecError> {
        let m = as_object(d, "variation")?;
        let name = m
            .get("name")
            .map(value_to_string)
            .ok_or_else(|| SpecError::new(format!("variation needs a 'name': {}", py_repr(d))))?;
        let input = m.get("input").cloned().unwrap_or(Value::Null);
        if input.is_null() {
            return Err(SpecError::new(format!(
                "variation '{name}': 'input' is required"
            )));
        }
        Ok(Self {
            name,
            input,
            params: LoadingParams::from_value(m.get("params"))?,
        })
    }
    fn to_value(&self) -> Value {
        let mut out = Map::new();
        out.insert("name".into(), Value::from(self.name.clone()));
        out.insert("input".into(), self.input.clone());
        if !self.params.is_empty_value() {
            out.insert("params".into(), self.params.to_value());
        }
        Value::Object(out)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SourceSpec {
    pub id: String,
    pub role: Role,
    pub kind: SourceKind,
    pub modality: Option<Modality>,
    pub input: Value,
    pub merge: MergeMode,
    pub partition: Option<Partition>,
    pub key: Value,
    pub columns: Vec<ColumnRole>,
    pub strict_columns: bool,
    pub columns_from_map: bool,
    pub join: Option<JoinSpec>,
    pub params: LoadingParams,
    pub variations: Vec<VariationSpec>,
}

impl SourceSpec {
    fn from_value(d: &Value) -> Result<Self, SpecError> {
        let m = as_object(d, "source")?;
        let id = m
            .get("id")
            .map(value_to_string)
            .ok_or_else(|| SpecError::new(format!("each source needs an 'id': {}", py_repr(d))))?;
        let (columns, from_map) = parse_columns(m.get("columns"))?;
        let join = match m.get("join") {
            Some(j) if !j.is_null() => Some(JoinSpec::from_value(j, Some(&id))?),
            _ => None,
        };
        let default_role = if !columns.is_empty() && !m.contains_key("role") {
            "mixed"
        } else {
            "features"
        };
        let role = match m.get("role") {
            Some(v) => Role::coerce(v, &format!("source[{id}].role"))?,
            None => Role::coerce_str(default_role, &format!("source[{id}].role"))?,
        };
        let kind = match m.get("kind") {
            Some(v) => SourceKind::coerce(v, &format!("source[{id}].kind"))?,
            None => SourceKind::Table,
        };
        let variations = match m.get("variations") {
            Some(Value::Array(vs)) => vs
                .iter()
                .map(VariationSpec::from_value)
                .collect::<Result<_, _>>()?,
            _ => vec![],
        };
        Ok(Self {
            id,
            role,
            kind,
            modality: coerce_opt(m, "modality", |v| Modality::coerce(v, "modality"))?,
            input: m.get("input").cloned().unwrap_or(Value::Null),
            merge: match m.get("merge") {
                Some(v) => MergeMode::coerce(v, "merge")?,
                None => MergeMode::None,
            },
            partition: coerce_opt(m, "partition", |v| Partition::coerce(v, "partition"))?,
            key: m.get("key").cloned().unwrap_or(Value::Null),
            columns,
            strict_columns: bool_default(m, "strict_columns", true),
            columns_from_map: from_map,
            join,
            params: LoadingParams::from_value(m.get("params"))?,
            variations,
        })
    }

    fn to_value(&self) -> Value {
        let mut out = Map::new();
        out.insert("id".into(), Value::from(self.id.clone()));
        out.insert("role".into(), Value::from(self.role.value()));
        if self.kind != SourceKind::Table {
            out.insert("kind".into(), Value::from(self.kind.value()));
        }
        if let Some(m) = self.modality {
            out.insert("modality".into(), Value::from(m.value()));
        }
        if !self.input.is_null() {
            out.insert("input".into(), self.input.clone());
        }
        if self.merge != MergeMode::None {
            out.insert("merge".into(), Value::from(self.merge.value()));
        }
        if let Some(p) = self.partition {
            out.insert("partition".into(), Value::from(p.value()));
        }
        if !self.key.is_null() {
            out.insert("key".into(), self.key.clone());
        }
        if !self.columns.is_empty() {
            if self.columns_from_map {
                let mut m = Map::new();
                for c in &self.columns {
                    m.insert(c.role.value().to_string(), c.select.to_spec());
                }
                out.insert("columns".into(), Value::Object(m));
            } else {
                out.insert(
                    "columns".into(),
                    Value::Array(self.columns.iter().map(ColumnRole::to_value).collect()),
                );
            }
        }
        if !self.strict_columns {
            out.insert("strict_columns".into(), Value::Bool(false));
        }
        if let Some(j) = &self.join {
            out.insert("join".into(), j.to_value());
        }
        if !self.params.is_empty_value() {
            out.insert("params".into(), self.params.to_value());
        }
        if !self.variations.is_empty() {
            out.insert(
                "variations".into(),
                Value::Array(
                    self.variations
                        .iter()
                        .map(VariationSpec::to_value)
                        .collect(),
                ),
            );
        }
        Value::Object(out)
    }
}

// --------------------------------------------------------------------------- //
// SampleIndex / PartitionsSpec / FoldsSpec / AggregateSpec / ValidationSpec    //
// --------------------------------------------------------------------------- //
#[derive(Debug, Clone, PartialEq)]
pub struct SampleIndex {
    pub by: SampleIndexBy,
    pub key: Value,
    pub observation_id: Option<String>,
    pub repetition_id: Option<String>,
    pub group_id: Option<String>,
    pub derive_from: Option<String>,
    pub derive_pattern: Option<String>,
}

impl Default for SampleIndex {
    fn default() -> Self {
        Self {
            by: SampleIndexBy::Row,
            key: Value::Null,
            observation_id: None,
            repetition_id: None,
            group_id: None,
            derive_from: None,
            derive_pattern: None,
        }
    }
}

impl SampleIndex {
    fn from_value(d: Option<&Value>) -> Result<Self, SpecError> {
        let Some(Value::Object(d)) = d else {
            return Ok(Self::default());
        };
        if d.is_empty() {
            return Ok(Self::default());
        }
        let empty = Map::new();
        let derive = match d.get("derive") {
            Some(Value::Object(m)) => m,
            _ => &empty,
        };
        Ok(Self {
            by: match d.get("by") {
                Some(v) => SampleIndexBy::coerce(v, "sample_index.by")?,
                None => SampleIndexBy::Row,
            },
            key: d.get("key").cloned().unwrap_or(Value::Null),
            observation_id: opt_string(d.get("observation_id")),
            repetition_id: opt_string(d.get("repetition_id")),
            group_id: opt_string(d.get("group_id")),
            derive_from: opt_string(derive.get("from")),
            derive_pattern: opt_string(derive.get("strip_suffix")),
        })
    }

    fn to_value(&self) -> Value {
        let mut out = drop_none(vec![
            ("by", Value::from(self.by.value())),
            ("key", self.key.clone()),
            ("observation_id", json_opt_str(&self.observation_id)),
            ("repetition_id", json_opt_str(&self.repetition_id)),
            ("group_id", json_opt_str(&self.group_id)),
        ]);
        if let Some(from) = &self.derive_from {
            out.as_object_mut().unwrap().insert(
                "derive".into(),
                serde_json::json!({ "from": from, "strip_suffix": json_opt_str(&self.derive_pattern) }),
            );
        }
        out
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PartitionsSpec {
    pub by: Option<PartitionBy>,
    pub column: Option<String>,
    pub train_values: Vec<Value>,
    pub test_values: Vec<Value>,
    pub predict_values: Vec<Value>,
    pub unknown_policy: UnknownPolicy,
    pub train: Value,
    pub test: Value,
    pub predict: Value,
    pub train_file: Option<String>,
    pub test_file: Option<String>,
    pub predict_file: Option<String>,
}

impl PartitionsSpec {
    fn from_value(d: Option<&Value>) -> Result<Option<Self>, SpecError> {
        let Some(d) = d.filter(|v| !v.is_null()) else {
            return Ok(None);
        };
        let m = as_object(d, "partitions")?;
        let list_of = |key: &str| -> Vec<Value> {
            match m.get(key) {
                Some(Value::Array(a)) => a.clone(),
                _ => vec![],
            }
        };
        Ok(Some(Self {
            by: coerce_opt(m, "by", |v| PartitionBy::coerce(v, "partitions.by"))?,
            column: opt_string(m.get("column")),
            train_values: list_of("train_values"),
            test_values: list_of("test_values"),
            predict_values: list_of("predict_values"),
            unknown_policy: match m.get("unknown_policy") {
                Some(v) => UnknownPolicy::coerce(v, "partitions.unknown_policy")?,
                None => UnknownPolicy::Train,
            },
            train: m.get("train").cloned().unwrap_or(Value::Null),
            test: m.get("test").cloned().unwrap_or(Value::Null),
            predict: m.get("predict").cloned().unwrap_or(Value::Null),
            train_file: opt_string(m.get("train_file")),
            test_file: opt_string(m.get("test_file")),
            predict_file: opt_string(m.get("predict_file")),
        }))
    }

    fn to_value(&self) -> Value {
        drop_none(vec![
            ("by", opt_enum(self.by.map(|b| b.value()))),
            ("column", json_opt_str(&self.column)),
            ("train_values", Value::Array(self.train_values.clone())),
            ("test_values", Value::Array(self.test_values.clone())),
            ("predict_values", Value::Array(self.predict_values.clone())),
            (
                "unknown_policy",
                if self.unknown_policy != UnknownPolicy::Train {
                    Value::from(self.unknown_policy.value())
                } else {
                    Value::Null
                },
            ),
            ("train", self.train.clone()),
            ("test", self.test.clone()),
            ("predict", self.predict.clone()),
            ("train_file", json_opt_str(&self.train_file)),
            ("test_file", json_opt_str(&self.test_file)),
            ("predict_file", json_opt_str(&self.predict_file)),
        ])
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct FoldsSpec {
    pub inline: Vec<Value>,
    pub file: Option<String>,
    pub format: FoldFormat,
    pub column: Option<String>,
}

impl FoldsSpec {
    fn from_value(d: Option<&Value>) -> Result<Option<Self>, SpecError> {
        let Some(d) = d.filter(|v| !v.is_null()) else {
            return Ok(None);
        };
        let m = as_object(d, "folds")?;
        Ok(Some(Self {
            inline: match m.get("inline") {
                Some(Value::Array(a)) => a.clone(),
                _ => vec![],
            },
            file: opt_string(m.get("file")),
            format: match m.get("format") {
                Some(v) => FoldFormat::coerce(v, "folds.format")?,
                None => FoldFormat::Auto,
            },
            column: opt_string(m.get("column")),
        }))
    }

    fn to_value(&self) -> Value {
        let mut out = drop_none(vec![
            ("inline", Value::Array(self.inline.clone())),
            ("file", json_opt_str(&self.file)),
            ("column", json_opt_str(&self.column)),
        ]);
        if self.file.is_some() && self.format != FoldFormat::Auto {
            out.as_object_mut()
                .unwrap()
                .insert("format".into(), Value::from(self.format.value()));
        }
        out
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AggregateSpec {
    pub by: Option<String>,
    pub method: AggregateMethod,
    pub exclude_outliers: bool,
    pub outlier_threshold: f64,
}

impl AggregateSpec {
    fn from_value(d: Option<&Value>) -> Result<Option<Self>, SpecError> {
        let Some(d) = d.filter(|v| !v.is_null()) else {
            return Ok(None);
        };
        let m = as_object(d, "aggregate")?;
        Ok(Some(Self {
            by: opt_string(m.get("by")),
            method: match m.get("method") {
                Some(v) => AggregateMethod::coerce(v, "aggregate.method")?,
                None => AggregateMethod::Mean,
            },
            exclude_outliers: bool_default(m, "exclude_outliers", false),
            outlier_threshold: m
                .get("outlier_threshold")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.95),
        }))
    }

    fn to_value(&self) -> Value {
        let mut pairs = vec![
            ("by", json_opt_str(&self.by)),
            ("method", Value::from(self.method.value())),
        ];
        if self.exclude_outliers {
            pairs.push(("exclude_outliers", Value::Bool(true)));
            pairs.push(("outlier_threshold", Value::from(self.outlier_threshold)));
        }
        drop_none(pairs)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ValidationSpec {
    pub check_file_existence: bool,
    pub allow_train_only: bool,
    pub allow_test_only: bool,
}

impl Default for ValidationSpec {
    fn default() -> Self {
        Self {
            check_file_existence: true,
            allow_train_only: true,
            allow_test_only: true,
        }
    }
}

impl ValidationSpec {
    fn from_value(d: Option<&Value>) -> Result<Self, SpecError> {
        let Some(Value::Object(m)) = d else {
            return Ok(Self::default());
        };
        if m.is_empty() {
            return Ok(Self::default());
        }
        Ok(Self {
            check_file_existence: bool_default(m, "check_file_existence", true),
            allow_train_only: bool_default(m, "allow_train_only", true),
            allow_test_only: bool_default(m, "allow_test_only", true),
        })
    }

    fn to_value(&self) -> Value {
        let mut out = Map::new();
        if !self.check_file_existence {
            out.insert("check_file_existence".into(), Value::Bool(false));
        }
        if !self.allow_train_only {
            out.insert("allow_train_only".into(), Value::Bool(false));
        }
        if !self.allow_test_only {
            out.insert("allow_test_only".into(), Value::Bool(false));
        }
        Value::Object(out)
    }
}

// --------------------------------------------------------------------------- //
// DatasetSpec                                                                 //
// --------------------------------------------------------------------------- //
#[derive(Debug, Clone, PartialEq)]
pub struct DatasetSpec {
    pub schema_version: i64,
    pub name: Option<String>,
    pub description: Option<String>,
    pub task_type: TaskType,
    pub sample_index: SampleIndex,
    pub signal_type: SignalType,
    pub conventions: Vec<Value>,
    pub sources: Vec<SourceSpec>,
    pub partitions: Option<PartitionsSpec>,
    pub folds: Option<FoldsSpec>,
    pub aggregate: Option<AggregateSpec>,
    pub repetition: Option<String>,
    pub params: LoadingParams,
    pub validation: ValidationSpec,
}

impl DatasetSpec {
    /// Build from a JSON object (ports `DatasetSpec.from_dict`).
    pub fn from_value(d: &Value) -> Result<Self, SpecError> {
        let m = d.as_object().ok_or_else(|| {
            SpecError::new(format!("DatasetSpec must be a mapping, got {}", py_type(d)))
        })?;
        let sources = match m.get("sources") {
            Some(Value::Array(arr)) => arr
                .iter()
                .map(SourceSpec::from_value)
                .collect::<Result<_, _>>()?,
            _ => vec![],
        };
        Ok(Self {
            // Python `int(d.get("schema_version", SCHEMA_VERSION))`: coerce
            // ints/floats/int-strings; reject un-coercible values (don't silently
            // default a malformed/future version to v1).
            schema_version: match m.get("schema_version") {
                Some(v) => py_int(v).ok_or_else(|| {
                    SpecError::new(format!(
                        "schema_version must be an integer, got {}",
                        py_repr(v)
                    ))
                })?,
                None => DATASET_SPEC_SCHEMA_VERSION as i64,
            },
            name: opt_string(m.get("name")),
            description: opt_string(m.get("description")),
            task_type: match m.get("task_type") {
                Some(v) => TaskType::coerce(v, "task_type")?,
                None => TaskType::Auto,
            },
            sample_index: SampleIndex::from_value(m.get("sample_index"))?,
            signal_type: match m.get("signal_type") {
                Some(v) => SignalType::coerce(v, "signal_type")?,
                None => SignalType::Auto,
            },
            conventions: match m.get("conventions") {
                Some(Value::Array(a)) => a.clone(),
                _ => vec![],
            },
            sources,
            partitions: PartitionsSpec::from_value(m.get("partitions"))?,
            folds: FoldsSpec::from_value(m.get("folds"))?,
            aggregate: AggregateSpec::from_value(m.get("aggregate"))?,
            repetition: opt_string(m.get("repetition")),
            params: LoadingParams::from_value(m.get("params"))?,
            validation: ValidationSpec::from_value(m.get("validation"))?,
        })
    }

    /// Serialize to the canonical dict (ports `DatasetSpec.to_dict`).
    pub fn to_value(&self) -> Value {
        let mut out = Map::new();
        out.insert("schema_version".into(), Value::from(self.schema_version));
        if let Some(name) = self.name.as_ref().filter(|s| !s.is_empty()) {
            out.insert("name".into(), Value::from(name.clone()));
        }
        if let Some(desc) = self.description.as_ref().filter(|s| !s.is_empty()) {
            out.insert("description".into(), Value::from(desc.clone()));
        }
        if self.task_type != TaskType::Auto {
            out.insert("task_type".into(), Value::from(self.task_type.value()));
        }
        let si = self.sample_index.to_value();
        if si != serde_json::json!({ "by": "row" }) {
            out.insert("sample_index".into(), si);
        }
        if self.signal_type != SignalType::Auto {
            out.insert("signal_type".into(), Value::from(self.signal_type.value()));
        }
        if !self.conventions.is_empty() {
            out.insert("conventions".into(), Value::Array(self.conventions.clone()));
        }
        out.insert(
            "sources".into(),
            Value::Array(self.sources.iter().map(SourceSpec::to_value).collect()),
        );
        if let Some(p) = &self.partitions {
            out.insert("partitions".into(), p.to_value());
        }
        if let Some(f) = &self.folds {
            out.insert("folds".into(), f.to_value());
        }
        if let Some(a) = &self.aggregate {
            out.insert("aggregate".into(), a.to_value());
        }
        if let Some(rep) = self.repetition.as_ref().filter(|s| !s.is_empty()) {
            out.insert("repetition".into(), Value::from(rep.clone()));
        }
        if !self.params.is_empty_value() {
            out.insert("params".into(), self.params.to_value());
        }
        let validation = self.validation.to_value();
        if !validation.as_object().unwrap().is_empty() {
            out.insert("validation".into(), validation);
        }
        Value::Object(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::canonical_json::canonical_json;
    use serde_json::json;

    #[test]
    fn default_params_emit_na_block() {
        let p = LoadingParams::default();
        assert_eq!(
            p.to_value(),
            json!({"na": {"policy": "auto", "fill": {"per_column": true}}})
        );
    }

    #[test]
    fn minimal_spec_roundtrip() {
        let spec = DatasetSpec::from_value(&json!({
            "sources": [{"id": "x", "role": "features", "input": "X.csv"}]
        }))
        .unwrap();
        let out = spec.to_value();
        // schema_version always present; default params block present.
        let canon = canonical_json(&out).unwrap();
        assert!(canon.contains("\"schema_version\": 1"));
        assert!(canon.contains("\"sources\""));
    }

    #[test]
    fn omission_rules() {
        // task_type=auto omitted, sample_index default omitted, strict_columns
        // only-when-false, input keeps empty list.
        let spec = DatasetSpec::from_value(&json!({
            "task_type": "auto",
            "sources": [{"id": "s", "role": "features", "input": [], "strict_columns": false}]
        }))
        .unwrap();
        let out = spec.to_value();
        let obj = out.as_object().unwrap();
        assert!(!obj.contains_key("task_type"));
        assert!(!obj.contains_key("sample_index"));
        let src = obj["sources"].as_array().unwrap()[0].as_object().unwrap();
        assert_eq!(src["input"], json!([])); // input is-not-None keeps []
        assert_eq!(src["strict_columns"], json!(false));
    }

    #[test]
    fn join_to_shorthand() {
        let spec = DatasetSpec::from_value(&json!({
            "sources": [
                {"id": "x", "role": "features", "input": "X.csv"},
                {"id": "y", "role": "targets", "input": "Y.csv", "join": {"to": "x", "how": "1:1"}}
            ]
        }))
        .unwrap();
        let src = &spec.sources[1];
        let join = src.join.as_ref().unwrap();
        assert_eq!(join.right, "x");
        assert_eq!(join.left.as_deref(), Some("y"));
        assert_eq!(join.cardinality, Cardinality::OneToOne);
        assert_eq!(join.coverage, Coverage::Complete);
    }

    #[test]
    fn schema_version_coercion() {
        let sv = |v: serde_json::Value| DatasetSpec::from_value(&v).map(|s| s.schema_version);
        assert_eq!(sv(json!({"schema_version": 1, "sources": []})).unwrap(), 1);
        assert_eq!(
            sv(json!({"schema_version": "2", "sources": []})).unwrap(),
            2
        ); // int("2")
        assert_eq!(
            sv(json!({"schema_version": 2.0, "sources": []})).unwrap(),
            2
        ); // int(2.0)
        assert_eq!(sv(json!({"sources": []})).unwrap(), 1); // default
        assert!(sv(json!({"schema_version": "bad", "sources": []})).is_err()); // not silently v1
    }
}
