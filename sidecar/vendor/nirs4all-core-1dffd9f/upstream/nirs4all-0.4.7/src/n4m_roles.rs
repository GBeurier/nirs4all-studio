//! Generic n4m role recipes and trained pipeline envelopes (version 8).
//!
//! A recipe step is the language-neutral token `"n4m:<catalog method id>"`
//! (a string, or `{"class": "n4m:<id>", "params": {...}}`), resolved through
//! the native n4m manifest. [`N4mRolePipeline`] runs such a recipe (sample
//! filters, transformers and selectors, then one regressor or classifier) in
//! the native role pipeline of libn4m (`n4m::roles::RolePipeline`, ABI 2.14),
//! which validates the recipe, routes every target column to the steps that
//! need it, keeps filters on the training rows, checks the input column names
//! and refuses states that contradict the recipe. This module translates the
//! recipe tokens and reads/writes the envelope shared with the Python, R and
//! JS/WASM bindings: `schema`, `recipe`, `n_features`, `feature_names` (when
//! the fit had names) and, per stateful step, `method_id`, `n4me_base64`,
//! `sha256`, `contains_training_rows` and `class_names` (classifier trained on
//! label names). Envelopes written before `feature_names` and
//! `contains_training_rows` still load.
//!
//! Every envelope field this module reads is checked before it reaches the
//! native pipeline: `n_features` is a positive JSON integer equal to the
//! native width, and `class_names` is a non-empty table of unique strings or
//! finite numbers that labels every fitted class id (index = id; it may keep
//! labels a sample filter removed). Column names holding NUL are refused by
//! the n4m crate before any C string is built.
//!
//! The runtime is selected with `n4m::configure_library` or
//! `N4M_LIBRARY_PATH`. A process fixes a single libn4m file, so a process that
//! also replays Archive V2 selects it once through
//! [`crate::preflight_methods_archive_v2_library`], whose attested snapshot
//! then serves both the role recipes and the replay.

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use n4m::roles::{
    self, FitInputs, MethodInfo, MethodKind, ParamType, ParamValue, Params, RolePipeline,
};
use n4m::{Context, MatrixRef};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

pub const N4M_ROLE_PREFIX: &str = "n4m:";
pub const N4M_TRAINED_PIPELINE_SCHEMA: &str = "nirs4all.n4m.trained_pipeline.v8";

const RECIPE_ROLES: &[(u32, &str)] = &[
    (roles::ROLE_TRANSFORMER, "transformer"),
    (roles::ROLE_REGRESSOR, "regressor"),
    (roles::ROLE_CLASSIFIER, "classifier"),
    (roles::ROLE_SELECTOR, "selector"),
    (roles::ROLE_SAMPLE_FILTER, "sample_filter"),
];
const RECIPE_ROLE_MASK: u32 = roles::ROLE_TRANSFORMER
    | roles::ROLE_REGRESSOR
    | roles::ROLE_CLASSIFIER
    | roles::ROLE_SELECTOR
    | roles::ROLE_SAMPLE_FILTER;

/// Catalog method id of an `n4m:<id>` class name.
pub fn n4m_role_method_id(class_name: &str) -> Option<&str> {
    class_name.strip_prefix(N4M_ROLE_PREFIX)
}

/// Manifest entry of an `n4m:<id>` class name.
pub fn resolve_n4m_role(class_name: &str) -> Result<MethodInfo, String> {
    let method_id = n4m_role_method_id(class_name)
        .ok_or_else(|| format!("'{class_name}' is not an n4m:<method id> token"))?;
    roles::method_info(method_id)
        .map_err(|error| format!("unknown n4m role token '{class_name}': {error}"))
}

/// Recipe steps the native manifest offers, in catalog order.
pub fn n4m_role_capabilities() -> Result<Value, String> {
    let methods = roles::methods().map_err(|error| error.to_string())?;
    Ok(Value::Array(
        methods
            .iter()
            .filter(|info| info.kind == MethodKind::Estimator && info.roles & RECIPE_ROLE_MASK != 0)
            .map(|info| {
                json!({
                    "token": format!("{N4M_ROLE_PREFIX}{}", info.method_id),
                    "method_id": info.method_id,
                    "roles": RECIPE_ROLES
                        .iter()
                        .filter(|(bit, _)| info.roles & bit != 0)
                        .map(|(_, name)| *name)
                        .collect::<Vec<_>>(),
                    "parameters": info.params.iter().map(|param| param.name.as_str()).collect::<Vec<_>>(),
                })
            })
            .collect(),
    ))
}

/// Training target of a recipe.
#[derive(Debug, Clone, PartialEq)]
pub enum RoleTarget {
    /// Row-major responses, `cols` per row (regressors; every column reaches
    /// the steps that need `y`).
    Values { data: Vec<f64>, cols: usize },
    /// Class label names (classifiers); encoded as ids in sorted order.
    Labels(Vec<String>),
    /// Integer class ids (classifiers), passed through.
    ClassIds(Vec<i64>),
}

/// One entry of a classifier label table (`class_names`, index = class id).
#[derive(Debug, Clone, PartialEq)]
pub enum ClassLabel {
    Name(String),
    /// A finite number.
    Number(f64),
}

impl ClassLabel {
    fn from_json(value: &Value) -> Result<Self, String> {
        match value {
            Value::String(name) => Ok(Self::Name(name.clone())),
            Value::Number(number) => {
                let label = number.as_f64().filter(|v| v.is_finite()).ok_or_else(|| {
                    format!("class label {value} is not a string or a finite number")
                })?;
                // JSON, JS and R numbers are doubles: an integral label beyond 2^53
                // would be rounded into another one.
                let beyond = |v: u64| v > 1u64 << 53;
                let integral_beyond = number.as_u64().is_some_and(beyond)
                    || number.as_i64().is_some_and(|v| beyond(v.unsigned_abs()))
                    || (label.fract() == 0.0 && label.abs() > (1u64 << 53) as f64);
                if integral_beyond {
                    return Err(format!(
                        "class label {value} is not exactly representable as float64 (beyond ±2^53)"
                    ));
                }
                Ok(Self::Number(label))
            }
            other => Err(format!(
                "class label {other} is not a string or a finite number"
            )),
        }
    }

    fn to_json(&self) -> Value {
        match self {
            Self::Name(name) => json!(name),
            Self::Number(number) => json!(number),
        }
    }
}

/// The label table of an envelope: non-empty, unique, all strings or all finite numbers.
fn label_table(value: &Value) -> Result<Vec<ClassLabel>, String> {
    let entries = value
        .as_array()
        .filter(|entries| !entries.is_empty())
        .ok_or("class_names must be a non-empty list of labels")?;
    let mut labels: Vec<ClassLabel> = Vec::with_capacity(entries.len());
    for entry in entries {
        let label = ClassLabel::from_json(entry)?;
        if labels.contains(&label) {
            return Err(format!("class label {entry} is duplicated"));
        }
        labels.push(label);
    }
    if labels.iter().any(|label| {
        matches!(label, ClassLabel::Name(_)) != matches!(labels[0], ClassLabel::Name(_))
    }) {
        return Err("class_names mixes strings and numbers".to_string());
    }
    Ok(labels)
}

/// Predictions of the final step.
#[derive(Debug, Clone, PartialEq)]
pub enum RolePredictions {
    Values {
        data: Vec<f64>,
        rows: usize,
        cols: usize,
    },
    Labels(Vec<ClassLabel>),
    ClassIds(Vec<i64>),
}

/// Method id and native parameters of one recipe token.
fn recipe_step(ctx: &Context, token: &Value) -> Result<(String, Params), String> {
    let (class_name, values) = match token {
        Value::String(name) => (name.as_str(), &Value::Null),
        Value::Object(map) => (
            map.get("class")
                .and_then(Value::as_str)
                .ok_or_else(|| format!("n4m role recipe step needs a string 'class': {token}"))?,
            map.get("params").unwrap_or(&Value::Null),
        ),
        _ => return Err(format!("n4m role recipe step must be a token: {token}")),
    };
    if n4m_role_method_id(class_name).is_none() {
        return Err(format!(
            "portable n4m role recipes contain n4m:<method id> steps only, got {token}"
        ));
    }
    let info = resolve_n4m_role(class_name)?;
    let mut params = Params::new(ctx, &info.method_id).map_err(native)?;
    match values {
        Value::Null => {}
        Value::Object(values) => {
            for (name, value) in values {
                let param = info
                    .params
                    .iter()
                    .find(|param| &param.name == name)
                    .ok_or_else(|| format!("{}: unknown parameter '{name}'", info.method_id))?;
                let typed = param_value(param.param_type, value).ok_or_else(|| {
                    format!("{}: invalid value for '{name}': {value}", info.method_id)
                })?;
                params.set(name, &typed).map_err(native)?;
            }
        }
        other => {
            return Err(format!(
                "{}: params must be a mapping, got {other}",
                info.method_id
            ))
        }
    }
    Ok((info.method_id, params))
}

fn param_value(kind: ParamType, value: &Value) -> Option<ParamValue> {
    let int = |value: &Value| {
        value.as_i64().or_else(|| {
            value
                .as_f64()
                .filter(|v| v.fract() == 0.0 && v.abs() < 9.0e15)
                .map(|v| v as i64)
        })
    };
    Some(match kind {
        ParamType::Int => ParamValue::Int(int(value)?),
        ParamType::Double => ParamValue::Double(value.as_f64()?),
        ParamType::Bool => ParamValue::Bool(value.as_bool()?),
        ParamType::Enum => ParamValue::Enum(value.as_str()?.to_owned()),
        ParamType::IntArray => ParamValue::IntArray(
            value
                .as_array()?
                .iter()
                .map(int)
                .collect::<Option<Vec<_>>>()?,
        ),
        ParamType::DoubleArray => ParamValue::DoubleArray(
            value
                .as_array()?
                .iter()
                .map(Value::as_f64)
                .collect::<Option<Vec<_>>>()?,
        ),
    })
}

fn native(error: n4m::Error) -> String {
    error.to_string()
}

/// The unfitted native pipeline of `recipe` (validated natively).
fn role_pipeline(ctx: &Context, recipe: &Value) -> Result<RolePipeline, String> {
    let steps = recipe
        .get("pipeline")
        .and_then(Value::as_array)
        .ok_or_else(|| "an n4m role recipe is {\"pipeline\": [steps]}".to_string())?
        .iter()
        .map(|token| recipe_step(ctx, token))
        .collect::<Result<Vec<_>, _>>()?;
    let steps: Vec<(&str, Option<&Params>)> = steps
        .iter()
        .map(|(method_id, params)| (method_id.as_str(), Some(params)))
        .collect();
    RolePipeline::new(ctx, &steps).map_err(native)
}

fn matrix(data: &[f64], rows: usize, cols: usize) -> Result<MatrixRef<'_>, String> {
    MatrixRef::row_major(data, rows, cols).map_err(native)
}

fn strings(value: &Value) -> Option<Vec<String>> {
    value
        .as_array()?
        .iter()
        .map(|item| item.as_str().map(str::to_owned))
        .collect()
}

/// A fitted recipe of n4m role steps, portable as N4ME states.
pub struct N4mRolePipeline {
    recipe: Value,
    pipeline: RolePipeline,
    n_features: usize,
    feature_names: Option<Vec<String>>,
    classifier: bool,
    class_names: Option<Vec<ClassLabel>>,
}

impl N4mRolePipeline {
    fn fitted(
        recipe: &Value,
        pipeline: RolePipeline,
        class_names: Option<Vec<ClassLabel>>,
    ) -> Result<Self, String> {
        let steps = pipeline.steps().map_err(native)?;
        let names = pipeline.feature_names().map_err(native)?;
        Ok(Self {
            recipe: recipe.clone(),
            n_features: pipeline.n_features_in().map_err(native)?,
            feature_names: (!names.is_empty()).then_some(names),
            classifier: steps
                .last()
                .is_some_and(|step| step.role == roles::ROLE_CLASSIFIER),
            class_names,
            pipeline,
        })
    }

    /// Fit `recipe` natively on row-major `x` (`rows` x `cols`). With
    /// `feature_names`, later predictions given names refuse renamed or
    /// reordered columns.
    pub fn fit_recipe(
        recipe: &Value,
        x: &[f64],
        rows: usize,
        cols: usize,
        feature_names: Option<&[&str]>,
        y: &RoleTarget,
    ) -> Result<Self, String> {
        let ctx = Context::new().map_err(native)?;
        let mut pipeline = role_pipeline(&ctx, recipe)?;
        if let Some(names) = feature_names {
            pipeline.set_feature_names(&ctx, names).map_err(native)?;
        }
        let x_view = matrix(x, rows, cols)?;
        let (ids, class_names) = match y {
            RoleTarget::Values { data, cols } => {
                let y_rows = data.len().checked_div(*cols).unwrap_or(0);
                let inputs = FitInputs::new(x_view).y(matrix(data, y_rows, *cols)?);
                pipeline.fit(&ctx, &inputs).map_err(native)?;
                return Self::fitted(recipe, pipeline, None);
            }
            RoleTarget::ClassIds(ids) => (ids.clone(), None),
            RoleTarget::Labels(labels) => {
                let mut names = labels.clone();
                names.sort();
                names.dedup();
                let ids = labels
                    .iter()
                    .map(|label| names.binary_search(label).map(|index| index as i64))
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|_| "label encoding failed".to_string())?;
                (ids, Some(names.into_iter().map(ClassLabel::Name).collect()))
            }
        };
        pipeline
            .fit(&ctx, &FitInputs::new(x_view).labels(&ids))
            .map_err(native)?;
        Self::fitted(recipe, pipeline, class_names)
    }

    /// Read a version 8 envelope and rebuild its fitted pipeline from the
    /// N4ME states.
    pub fn from_json(text: &str) -> Result<Self, String> {
        let document: Value = serde_json::from_str(text).map_err(|error| error.to_string())?;
        if document.get("schema").and_then(Value::as_str) != Some(N4M_TRAINED_PIPELINE_SCHEMA) {
            return Err("unsupported trained n4m pipeline envelope".into());
        }
        let recipe = document
            .get("recipe")
            .ok_or_else(|| "envelope has no recipe".to_string())?;
        let n_features = document.get("n_features").unwrap_or(&Value::Null);
        let n_features = n_features.as_u64().filter(|&n| n > 0).ok_or_else(|| {
            format!("n_features must be a positive JSON integer, got {n_features}")
        })?;
        let states = document
            .get("states")
            .and_then(Value::as_array)
            .ok_or_else(|| "envelope has no states".to_string())?;
        let feature_names = document
            .get("feature_names")
            .map(|names| strings(names).ok_or("feature_names must be an array of strings"))
            .transpose()?;
        let class_names = states
            .last()
            .and_then(|state| state.get("class_names"))
            .map(label_table)
            .transpose()?;
        let mut payloads = Vec::with_capacity(states.len());
        for state in states {
            let method_id = state
                .get("method_id")
                .and_then(Value::as_str)
                .ok_or_else(|| "N4ME state has no method_id".to_string())?;
            let payload = STANDARD
                .decode(
                    state
                        .get("n4me_base64")
                        .and_then(Value::as_str)
                        .unwrap_or(""),
                )
                .map_err(|error| format!("N4ME state of {method_id} is not base64: {error}"))?;
            let digest = format!("{:x}", Sha256::digest(&payload));
            if state.get("sha256").and_then(Value::as_str) != Some(digest.as_str()) {
                return Err(format!("N4ME state of {method_id} fails its checksum"));
            }
            payloads.push(payload);
        }

        let ctx = Context::new().map_err(native)?;
        let mut pipeline = role_pipeline(&ctx, recipe)?;
        if let Some(names) = &feature_names {
            let names: Vec<&str> = names.iter().map(String::as_str).collect();
            pipeline.set_feature_names(&ctx, &names).map_err(native)?;
        }
        let payloads: Vec<&[u8]> = payloads.iter().map(Vec::as_slice).collect();
        pipeline.import_states(&ctx, &payloads).map_err(native)?;
        let steps = pipeline.steps().map_err(native)?;
        let stateful = steps.iter().filter(|step| step.state_index.is_some());
        for (step, state) in stateful.zip(states) {
            let method_id = state.get("method_id").and_then(Value::as_str);
            if method_id != Some(step.method_id.as_str()) {
                return Err(format!(
                    "N4ME state {} does not match its recipe step",
                    method_id.unwrap_or_default()
                ));
            }
            if state
                .get("contains_training_rows")
                .is_some_and(|flag| flag.as_bool() != Some(step.contains_training_rows))
            {
                return Err(format!(
                    "contains_training_rows of {} contradicts its N4ME state",
                    step.method_id
                ));
            }
        }
        let fitted = Self::fitted(recipe, pipeline, class_names)?;
        if fitted.n_features as u64 != n_features {
            return Err(format!(
                "n_features is {n_features} but the states take {} columns",
                fitted.n_features
            ));
        }
        if let Some(names) = &fitted.class_names {
            if !fitted.classifier {
                return Err("class_names label the classes of a final classifier".into());
            }
            for id in fitted.pipeline.classes().map_err(native)? {
                if usize::try_from(id).map_or(true, |index| index >= names.len()) {
                    return Err(format!(
                        "class id {id} has no entry in class_names ({} labels)",
                        names.len()
                    ));
                }
            }
        }
        Ok(fitted)
    }

    /// The version 8 envelope. A state that embeds training rows (kernel
    /// PLS, LW-PLS, ...) is refused unless `allow_training_rows` is set.
    pub fn to_json(&self, allow_training_rows: bool) -> Result<String, String> {
        let ctx = Context::new().map_err(native)?;
        let payloads = self
            .pipeline
            .export_states(&ctx, allow_training_rows)
            .map_err(native)?;
        let steps = self.pipeline.steps().map_err(native)?;
        let mut states: Vec<Value> = steps
            .iter()
            .filter(|step| step.state_index.is_some())
            .zip(&payloads)
            .map(|(step, payload)| {
                json!({
                    "method_id": step.method_id,
                    "n4me_base64": STANDARD.encode(payload),
                    "sha256": format!("{:x}", Sha256::digest(payload)),
                    "contains_training_rows": step.contains_training_rows,
                })
            })
            .collect();
        if let (Some(names), Some(state)) = (&self.class_names, states.last_mut()) {
            state["class_names"] = names.iter().map(ClassLabel::to_json).collect();
        }
        let mut document = json!({
            "schema": N4M_TRAINED_PIPELINE_SCHEMA,
            "recipe": self.recipe,
            "n_features": self.n_features,
            "states": states,
        });
        if let Some(names) = &self.feature_names {
            document["feature_names"] = json!(names);
        }
        serde_json::to_string_pretty(&document).map_err(|error| error.to_string())
    }

    /// Predictions (regressor) or class labels (classifier) of the final
    /// model for row-major `x` with `rows` rows. With `feature_names`, renamed
    /// or reordered columns are refused; without, columns are positional.
    pub fn predict(
        &self,
        x: &[f64],
        rows: usize,
        feature_names: Option<&[&str]>,
    ) -> Result<RolePredictions, String> {
        let cols = x.len().checked_div(rows).unwrap_or(0);
        let x_view = matrix(x, rows, cols)?;
        let ctx = Context::new().map_err(native)?;
        if !self.classifier {
            let out = self
                .pipeline
                .predict(&ctx, x_view, feature_names)
                .map_err(native)?;
            return Ok(RolePredictions::Values {
                data: out.data,
                rows: out.rows,
                cols: out.cols,
            });
        }
        let ids = self
            .pipeline
            .predict_labels(&ctx, x_view, feature_names)
            .map_err(native)?;
        match &self.class_names {
            None => Ok(RolePredictions::ClassIds(ids)),
            Some(names) => ids
                .iter()
                .map(|&id| {
                    usize::try_from(id)
                        .ok()
                        .and_then(|index| names.get(index).cloned())
                        .ok_or_else(|| format!("class id {id} has no label name"))
                })
                .collect::<Result<Vec<_>, _>>()
                .map(RolePredictions::Labels),
        }
    }

    pub fn recipe(&self) -> &Value {
        &self.recipe
    }

    pub fn n_features(&self) -> usize {
        self.n_features
    }

    /// Fitted input column names, in order (`None`: positional input).
    pub fn feature_names(&self) -> Option<&[String]> {
        self.feature_names.as_deref()
    }

    /// The fitted native pipeline (transform, decision function, class
    /// probabilities, step introspection).
    pub fn pipeline(&self) -> &RolePipeline {
        &self.pipeline
    }
}

#[cfg(test)]
mod tests {
    //! The negative envelope cases (recipe/state mismatch, empty pipeline,
    //! feature permutation, training rows without opt-in, multi-target
    //! routing) replay the Methods shared fixture
    //! `n4m_role_pipeline_methods.json` and are identical in the Python,
    //! JS/WASM and Rust suites, as are the label-table, `n_features` and shape
    //! mutations.

    use super::*;

    fn configured() -> bool {
        match std::env::var("NIRS4ALL_METHODS_LIB") {
            Ok(path) => {
                // Share the attested process identity of the Archive V2 tests
                // that run in this binary instead of a second libn4m file.
                crate::native_methods_replay::configure_methods_runtime_for_source(
                    std::path::Path::new(&path),
                )
                .expect("NIRS4ALL_METHODS_LIB must name libn4m");
                true
            }
            Err(error) => {
                if std::env::var("NIRS4ALL_CORE_REQUIRE_METHODS_PARITY").as_deref() == Ok("1") {
                    panic!("strict n4m role parity requires NIRS4ALL_METHODS_LIB: {error}");
                }
                eprintln!("skipping n4m role parity: NIRS4ALL_METHODS_LIB is not set");
                false
            }
        }
    }

    fn fixture(text: &str) -> Value {
        serde_json::from_str(text).unwrap()
    }

    fn methods_fixture() -> Value {
        fixture(include_str!(
            "../tests/parity/fixtures/n4m_role_pipeline_methods.json"
        ))
    }

    fn methods_case<'a>(fixture: &'a Value, name: &str) -> &'a Value {
        fixture["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|case| case["name"] == name)
            .unwrap()
    }

    fn rows(value: &Value) -> (Vec<f64>, usize, usize) {
        let rows = value.as_array().unwrap();
        let data: Vec<f64> = rows
            .iter()
            .flat_map(|row| row.as_array().unwrap().iter().map(|v| v.as_f64().unwrap()))
            .collect();
        let n = rows.len();
        (data.clone(), n, data.len() / n)
    }

    fn numbers(value: &Value) -> Vec<f64> {
        value
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_f64().unwrap())
            .collect()
    }

    fn names(value: &Value) -> Vec<String> {
        strings(value).unwrap()
    }

    fn labels(value: &Value) -> RolePredictions {
        RolePredictions::Labels(names(value).into_iter().map(ClassLabel::Name).collect())
    }

    fn refs(names: &[String]) -> Vec<&str> {
        names.iter().map(String::as_str).collect()
    }

    fn values(predictions: RolePredictions) -> Vec<f64> {
        match predictions {
            RolePredictions::Values { data, .. } => data,
            other => panic!("expected values, got {other:?}"),
        }
    }

    fn max_diff(actual: &[f64], expected: &[f64]) -> f64 {
        assert_eq!(actual.len(), expected.len());
        actual
            .iter()
            .zip(expected)
            .map(|(a, b)| (a - b).abs())
            .fold(0.0, f64::max)
    }

    fn fails(result: Result<N4mRolePipeline, String>) -> String {
        result.err().expect("the call must be refused")
    }

    fn assert_refused(error: &str, message: &str) {
        assert!(error.contains(message), "expected '{message}' in '{error}'");
    }

    /// A v8 envelope of Methods fixture states: `{method_id, n4me_base64,
    /// contains_training_rows}` or bare base64 bytes, then labelled with
    /// their recipe step.
    fn envelope(
        steps: &Value,
        states: &Value,
        feature_names: Option<&Value>,
        class_names: Option<&Value>,
    ) -> String {
        let stateful: Vec<&str> = steps
            .as_array()
            .unwrap()
            .iter()
            .map(|step| &step["class"].as_str().unwrap()[4..])
            .filter(|id| !id.starts_with("filters."))
            .collect();
        let mut entries: Vec<Value> = stateful
            .iter()
            .zip(states.as_array().unwrap())
            .map(|(method_id, state)| {
                let mut entry = match state {
                    Value::String(bytes) => json!({"method_id": method_id, "n4me_base64": bytes}),
                    other => other.clone(),
                };
                let payload = STANDARD
                    .decode(entry["n4me_base64"].as_str().unwrap())
                    .unwrap();
                entry["sha256"] = json!(format!("{:x}", Sha256::digest(&payload)));
                entry
            })
            .collect();
        if let (Some(names), Some(last)) = (class_names, entries.last_mut()) {
            last["class_names"] = names.clone();
        }
        let mut document = json!({
            "schema": N4M_TRAINED_PIPELINE_SCHEMA,
            "recipe": {"pipeline": steps},
            "n_features": 12,
            "states": entries,
        });
        if let Some(names) = feature_names {
            document["feature_names"] = names.clone();
        }
        document.to_string()
    }

    /// The envelope without its N4ME bytes (they record the writing ABI) and
    /// without the per-state training-row flags.
    fn without_bytes(mut document: Value) -> Value {
        for state in document["states"].as_array_mut().unwrap() {
            let state = state.as_object_mut().unwrap();
            state.remove("n4me_base64");
            state.remove("sha256");
            state.remove("contains_training_rows");
        }
        document
    }

    fn training_row_flags(text: &str) -> Vec<bool> {
        fixture(text)["states"]
            .as_array()
            .unwrap()
            .iter()
            .map(|state| state["contains_training_rows"].as_bool().unwrap())
            .collect()
    }

    #[test]
    fn envelopes_written_before_the_additive_fields_replay_and_refit() {
        if !configured() {
            return;
        }
        let fixture = fixture(include_str!(
            "../tests/parity/fixtures/n4m_roles_v8_python_trained.json"
        ));
        let (x, n, p) = rows(&fixture["x_train"]);
        let (x_test, m, _) = rows(&fixture["x_test"]);

        let regression = &fixture["regression"];
        let expected = numbers(&regression["predict"]);
        let replayed = N4mRolePipeline::from_json(&regression["envelope"].to_string()).unwrap();
        assert!(replayed.feature_names().is_none());
        let diff = max_diff(
            &values(replayed.predict(&x_test, m, None).unwrap()),
            &expected,
        );
        eprintln!("python regression replay max diff {diff:e}");
        assert!(diff <= 1e-12);
        let rewritten = replayed.to_json(false).unwrap();
        assert_eq!(training_row_flags(&rewritten), [false, false, false]);
        assert!(fixture_has_no_names(&rewritten));
        assert_eq!(
            without_bytes(super::tests::fixture(&rewritten)),
            without_bytes(regression["envelope"].clone())
        );

        let y = RoleTarget::Values {
            data: numbers(&regression["y_train"]),
            cols: 1,
        };
        let fitted =
            N4mRolePipeline::fit_recipe(&regression["envelope"]["recipe"], &x, n, p, None, &y)
                .unwrap();
        let live = fitted.predict(&x_test, m, None).unwrap();
        let diff = max_diff(&values(live.clone()), &expected);
        eprintln!("rust-fitted regression vs python max diff {diff:e}");
        assert!(diff <= 1e-9);
        let text = fitted.to_json(false).unwrap();
        assert_eq!(
            without_bytes(super::tests::fixture(&text)),
            without_bytes(regression["envelope"].clone())
        );
        let again = N4mRolePipeline::from_json(&text).unwrap();
        assert_eq!(again.recipe(), &regression["envelope"]["recipe"]);
        assert_eq!(again.predict(&x_test, m, None).unwrap(), live);

        let classification = &fixture["classification"];
        let expected = labels(&classification["predict"]);
        let replayed = N4mRolePipeline::from_json(&classification["envelope"].to_string()).unwrap();
        assert_eq!(replayed.predict(&x_test, m, None).unwrap(), expected);
        let y = RoleTarget::Labels(names(&classification["y_train"]));
        let fitted =
            N4mRolePipeline::fit_recipe(&classification["envelope"]["recipe"], &x, n, p, None, &y)
                .unwrap();
        assert_eq!(fitted.predict(&x_test, m, None).unwrap(), expected);
        let again = N4mRolePipeline::from_json(&fitted.to_json(false).unwrap()).unwrap();
        assert_eq!(again.predict(&x_test, m, None).unwrap(), expected);
    }

    fn fixture_has_no_names(text: &str) -> bool {
        fixture(text).get("feature_names").is_none()
    }

    #[test]
    fn r_trained_v8_envelope_replays_and_refits_in_rust() {
        if !configured() {
            return;
        }
        let envelope = fixture(include_str!(
            "../tests/parity/fixtures/n4m_roles_v8_r_trained.json"
        ));
        let oracle = fixture(include_str!(
            "../tests/parity/expected/n4m_roles_v8_r_trained_oracle.json"
        ));
        let (x, n, p) = rows(&oracle["x_train"]);
        let (x_test, m, _) = rows(&oracle["x_test"]);
        let expected = numbers(&oracle["predict"]);
        let replayed = N4mRolePipeline::from_json(&envelope.to_string()).unwrap();
        let diff = max_diff(
            &values(replayed.predict(&x_test, m, None).unwrap()),
            &expected,
        );
        eprintln!("R regression replay max diff {diff:e}");
        assert!(diff <= 1e-12);
        let y = RoleTarget::Values {
            data: numbers(&oracle["y_train"]),
            cols: 1,
        };
        let refit = N4mRolePipeline::fit_recipe(&envelope["recipe"], &x, n, p, None, &y).unwrap();
        let diff = max_diff(&values(refit.predict(&x_test, m, None).unwrap()), &expected);
        eprintln!("rust-fitted regression vs R max diff {diff:e}");
        assert!(diff <= 1e-9);
    }

    #[test]
    fn python_trained_named_envelope_keeps_column_identity_and_training_rows() {
        if !configured() {
            return;
        }
        let fixture = fixture(include_str!(
            "../tests/parity/fixtures/n4m_roles_v8_python_named.json"
        ));
        let names = names(&fixture["feature_names"]);
        let (x, n, p) = rows(&fixture["x_train"]);
        let (x_test, m, _) = rows(&fixture["x_test"]);
        let expected = numbers(&fixture["predict"]);
        let replayed = N4mRolePipeline::from_json(&fixture["envelope"].to_string()).unwrap();
        assert_eq!(replayed.feature_names(), Some(names.as_slice()));
        let predicted = values(replayed.predict(&x_test, m, Some(&refs(&names))).unwrap());
        assert!(max_diff(&predicted, &expected) <= 1e-12);
        assert_refused(
            &replayed.to_json(false).unwrap_err(),
            "retains training rows",
        );
        let rewritten = replayed.to_json(true).unwrap();
        assert_eq!(training_row_flags(&rewritten), [false, true]);
        assert_eq!(
            without_bytes(super::tests::fixture(&rewritten)),
            without_bytes(fixture["envelope"].clone())
        );

        let y = RoleTarget::Values {
            data: numbers(&fixture["y_train"]),
            cols: 1,
        };
        let refit = N4mRolePipeline::fit_recipe(
            &fixture["envelope"]["recipe"],
            &x,
            n,
            p,
            Some(&refs(&names)),
            &y,
        )
        .unwrap();
        assert_eq!(refit.feature_names(), Some(names.as_slice()));
        let predicted = values(refit.predict(&x_test, m, Some(&refs(&names))).unwrap());
        // Fresh fitting has an owner-versioned oracle; the stored historical
        // envelope above must continue replaying against its original bytes.
        let fresh = super::tests::fixture(include_str!(
            "../tests/parity/expected/n4m_roles_v8_named_refit_methods139.json"
        ));
        assert_eq!(
            format!(
                "{:x}",
                Sha256::digest(include_bytes!(
                    "../tests/parity/fixtures/n4m_roles_v8_python_named.json"
                ))
            ),
            fresh["input_sha256"].as_str().unwrap()
        );
        assert!(max_diff(&predicted, &numbers(&fresh["predict"])) <= 1e-9);
    }

    #[test]
    fn methods_shared_pipelines_replay() {
        if !configured() {
            return;
        }
        let shared = methods_fixture();
        let names = names(&shared["feature_names"]);
        let (x_test, m, _) = rows(&shared["x_test"]);
        let case = &shared["regression"];
        let regression = N4mRolePipeline::from_json(&envelope(
            &case["steps"],
            &case["states"],
            Some(&shared["feature_names"]),
            None,
        ))
        .unwrap();
        let predicted = values(regression.predict(&x_test, m, Some(&refs(&names))).unwrap());
        assert!(max_diff(&predicted, &numbers(&case["predict"])) <= 1e-9);

        let case = &shared["classification"];
        let classification = N4mRolePipeline::from_json(&envelope(
            &case["steps"],
            &case["states"],
            Some(&shared["feature_names"]),
            Some(&case["class_names"]),
        ))
        .unwrap();
        assert_eq!(
            classification
                .predict(&x_test, m, Some(&refs(&names)))
                .unwrap(),
            labels(&case["predict"])
        );
        let rewritten = fixture(&classification.to_json(false).unwrap());
        assert_eq!(rewritten["states"][2]["class_names"], case["class_names"]);
    }

    #[test]
    fn multi_target_y_reaches_supervised_transformers() {
        if !configured() {
            return;
        }
        let shared = methods_fixture();
        let case = methods_case(&shared, "multi_target_supervised_transformer");
        let (x, n, p) = rows(&shared["x_train"]);
        let (x_test, m, _) = rows(&shared["x_test"]);
        let (y, _, q) = rows(&shared["y2_train"]);
        let fitted = N4mRolePipeline::fit_recipe(
            &json!({"pipeline": case["steps"]}),
            &x,
            n,
            p,
            None,
            &RoleTarget::Values { data: y, cols: q },
        )
        .unwrap();
        let predicted = fitted.predict(&x_test, m, None).unwrap();
        let RolePredictions::Values { data, cols, .. } = &predicted else {
            panic!("expected values");
        };
        assert_eq!(*cols, 2);
        assert!(max_diff(data, &rows(&case["predict"]).0) <= 1e-9);
        let replayed = N4mRolePipeline::from_json(&fitted.to_json(false).unwrap()).unwrap();
        assert_eq!(replayed.predict(&x_test, m, None).unwrap(), predicted);
    }

    #[test]
    fn invalid_recipes_are_refused() {
        if !configured() {
            return;
        }
        let shared = methods_fixture();
        let (x, n, p) = rows(&shared["x_train"]);
        let y = RoleTarget::Values {
            data: numbers(&shared["y_train"]),
            cols: 1,
        };
        for name in ["empty_recipe", "wrong_role_order", "missing_terminal"] {
            let case = methods_case(&shared, name);
            let error = fails(N4mRolePipeline::fit_recipe(
                &json!({"pipeline": case["steps"]}),
                &x,
                n,
                p,
                None,
                &y,
            ));
            assert_refused(&error, case["message"].as_str().unwrap());
        }
        let error = fails(N4mRolePipeline::from_json(&envelope(
            &json!([]),
            &json!([]),
            None,
            None,
        )));
        assert_refused(&error, "at least one step");
        let error = fails(N4mRolePipeline::fit_recipe(
            &json!({"pipeline": ["sklearn.cross_decomposition.PLSRegression"]}),
            &x,
            n,
            p,
            None,
            &y,
        ));
        assert_refused(&error, "n4m:<method id> steps only");
    }

    #[test]
    fn states_that_contradict_the_recipe_are_refused() {
        if !configured() {
            return;
        }
        let shared = methods_fixture();
        for name in [
            "recipe_param_differs_from_state",
            "method_mismatch",
            "state_count_mismatch",
        ] {
            let case = methods_case(&shared, name);
            let error = fails(N4mRolePipeline::from_json(&envelope(
                &case["steps"],
                &case["states"],
                None,
                None,
            )));
            assert_refused(&error, case["message"].as_str().unwrap());
        }
        let case = &shared["regression"];
        let mut contradicting = case["states"].clone();
        contradicting[0]["contains_training_rows"] = json!(true);
        let error = fails(N4mRolePipeline::from_json(&envelope(
            &case["steps"],
            &contradicting,
            None,
            None,
        )));
        assert_refused(&error, "contains_training_rows");
    }

    #[test]
    fn permuted_or_missing_columns_are_refused() {
        if !configured() {
            return;
        }
        let shared = methods_fixture();
        let names = names(&shared["feature_names"]);
        let (x, n, p) = rows(&shared["x_train"]);
        let (x_test, m, _) = rows(&shared["x_test"]);
        let case = &shared["regression"];
        let pipeline = N4mRolePipeline::from_json(&envelope(
            &case["steps"],
            &case["states"],
            Some(&shared["feature_names"]),
            None,
        ))
        .unwrap();
        let permuted = methods_case(&shared, "feature_name_permutation");
        let permuted_names = super::tests::names(&permuted["feature_names"]);
        let error = pipeline
            .predict(&x_test, m, Some(&refs(&permuted_names)))
            .unwrap_err();
        assert_refused(&error, permuted["message"].as_str().unwrap());
        let narrow: Vec<f64> = x_test
            .chunks(p)
            .flat_map(|row| row[..p - 1].to_vec())
            .collect();
        let error = pipeline.predict(&narrow, m, None).unwrap_err();
        assert_refused(
            &error,
            methods_case(&shared, "width_mismatch")["message"]
                .as_str()
                .unwrap(),
        );

        let y = RoleTarget::Values {
            data: numbers(&shared["y_train"]),
            cols: 1,
        };
        let fitted = N4mRolePipeline::fit_recipe(
            &json!({"pipeline": case["steps"]}),
            &x,
            n,
            p,
            Some(&refs(&names)),
            &y,
        )
        .unwrap();
        let replayed = N4mRolePipeline::from_json(&fitted.to_json(false).unwrap()).unwrap();
        assert_eq!(replayed.feature_names(), Some(names.as_slice()));
        let error = replayed
            .predict(&x_test, m, Some(&refs(&permuted_names)))
            .unwrap_err();
        assert_refused(&error, "reordered");
    }

    #[test]
    fn training_rows_need_the_export_opt_in() {
        if !configured() {
            return;
        }
        let shared = methods_fixture();
        let case = methods_case(&shared, "training_rows_without_opt_in");
        let (x, n, p) = rows(&shared["x_train"]);
        let (x_test, m, _) = rows(&shared["x_test"]);
        let y = RoleTarget::Values {
            data: numbers(&shared[case["y"].as_str().unwrap()]),
            cols: 1,
        };
        let fitted =
            N4mRolePipeline::fit_recipe(&json!({"pipeline": case["steps"]}), &x, n, p, None, &y)
                .unwrap();
        assert_refused(
            &fitted.to_json(false).unwrap_err(),
            case["message"].as_str().unwrap(),
        );
        let text = fitted.to_json(true).unwrap();
        assert_eq!(training_row_flags(&text), [false, true]);
        let replayed = N4mRolePipeline::from_json(&text).unwrap();
        assert_eq!(
            replayed.predict(&x_test, m, None).unwrap(),
            fitted.predict(&x_test, m, None).unwrap()
        );
    }

    #[test]
    fn tampered_or_foreign_envelopes_are_refused() {
        if !configured() {
            return;
        }
        let source = fixture(include_str!(
            "../tests/parity/fixtures/n4m_roles_v8_python_trained.json"
        ))["regression"]["envelope"]
            .clone();
        let mut other = source.clone();
        other["schema"] = json!("nirs4all.n4m.trained_pipeline.v7");
        assert_refused(
            &fails(N4mRolePipeline::from_json(&other.to_string())),
            "unsupported trained n4m pipeline envelope",
        );
        let mut tampered = source.clone();
        tampered["states"][0]["sha256"] = json!("0".repeat(64));
        assert_refused(
            &fails(N4mRolePipeline::from_json(&tampered.to_string())),
            "fails its checksum",
        );
        let mut relabelled = source.clone();
        relabelled["states"][0]["method_id"] = json!("preprocessing.scatter.msc");
        assert_refused(
            &fails(N4mRolePipeline::from_json(&relabelled.to_string())),
            "does not match its recipe step",
        );
        let mut narrow = source;
        narrow["n_features"] = json!(3);
        assert_refused(
            &fails(N4mRolePipeline::from_json(&narrow.to_string())),
            "n_features",
        );
    }

    fn with_class_names(envelope: &Value, names: Value) -> String {
        let mut document = envelope.clone();
        let states = document["states"].as_array_mut().unwrap();
        states.last_mut().unwrap()["class_names"] = names;
        document.to_string()
    }

    #[test]
    fn label_tables_that_contradict_the_states_are_refused() {
        if !configured() {
            return;
        }
        let fixture = fixture(include_str!(
            "../tests/parity/fixtures/n4m_roles_v8_python_trained.json"
        ));
        let (x, n, p) = rows(&fixture["x_train"]);
        let (x_test, m, _) = rows(&fixture["x_test"]);
        let envelope = &fixture["classification"]["envelope"];
        for (names, message) in [
            (json!([]), "class_names must be a non-empty list of labels"),
            (
                json!("high"),
                "class_names must be a non-empty list of labels",
            ),
            (
                Value::Null,
                "class_names must be a non-empty list of labels",
            ),
            (
                json!(["only"]),
                "class id 1 has no entry in class_names (1 labels)",
            ),
            (json!(["high", 2]), "class_names mixes strings and numbers"),
            (
                json!([9_007_199_254_740_993_u64, 1.5]),
                "class label 9007199254740993 is not exactly representable as float64",
            ),
            (
                json!([1e17, 1.5]),
                "is not exactly representable as float64",
            ),
            (
                json!(["same", "same"]),
                "class label \"same\" is duplicated",
            ),
            (json!([1.5, 1.5]), "class label 1.5 is duplicated"),
            (
                json!(["high", null]),
                "class label null is not a string or a finite number",
            ),
            (
                json!([true, false]),
                "class label true is not a string or a finite number",
            ),
        ] {
            assert_refused(
                &fails(N4mRolePipeline::from_json(&with_class_names(
                    envelope, names,
                ))),
                message,
            );
        }

        // Index = class id: a longer table keeps the slots of labels a filter
        // removed, and finite numbers are labels too.
        let longer =
            N4mRolePipeline::from_json(&with_class_names(envelope, json!(["a", "b", "c"])))
                .unwrap();
        assert!(longer.predict(&x_test, m, None).is_ok());
        let numeric =
            N4mRolePipeline::from_json(&with_class_names(envelope, json!([0.5, 1.5]))).unwrap();
        let RolePredictions::Labels(predicted) = numeric.predict(&x_test, m, None).unwrap() else {
            panic!("expected labels");
        };
        let expected: Vec<ClassLabel> = names(&fixture["classification"]["predict"])
            .iter()
            .map(|label| ClassLabel::Number(if label == "high" { 0.5 } else { 1.5 }))
            .collect();
        assert_eq!(predicted, expected);
        let rewritten = super::tests::fixture(&numeric.to_json(false).unwrap());
        assert_eq!(rewritten["states"][1]["class_names"], json!([0.5, 1.5]));

        // States fitted on class ids 10 and 20 have no entry in a two-label table.
        let ids: Vec<i64> = names(&fixture["classification"]["y_train"])
            .iter()
            .map(|label| if label == "high" { 10 } else { 20 })
            .collect();
        let fitted = N4mRolePipeline::fit_recipe(
            &envelope["recipe"],
            &x,
            n,
            p,
            None,
            &RoleTarget::ClassIds(ids),
        )
        .unwrap();
        let by_ids = super::tests::fixture(&fitted.to_json(false).unwrap());
        assert!(by_ids["states"][1].get("class_names").is_none());
        assert_refused(
            &fails(N4mRolePipeline::from_json(&with_class_names(
                &by_ids,
                json!(["high", "low"]),
            ))),
            "class id 10 has no entry in class_names (2 labels)",
        );
        assert_refused(
            &fails(N4mRolePipeline::from_json(&with_class_names(
                &fixture["regression"]["envelope"],
                json!(["high", "low"]),
            ))),
            "class_names label the classes of a final classifier",
        );
    }

    #[test]
    fn envelope_widths_are_positive_json_integers() {
        if !configured() {
            return;
        }
        let source = fixture(include_str!(
            "../tests/parity/fixtures/n4m_roles_v8_python_trained.json"
        ))["regression"]["envelope"]
            .clone();
        for (value, shown) in [
            (json!(24.9), "24.9"),
            (json!(24.0), "24.0"),
            (json!("24"), "\"24\""),
            (json!(true), "true"),
            (json!(0), "0"),
            (json!(-24), "-24"),
            (Value::Null, "null"),
        ] {
            let mut mutated = source.clone();
            mutated["n_features"] = value;
            assert_refused(
                &fails(N4mRolePipeline::from_json(&mutated.to_string())),
                &format!("n_features must be a positive JSON integer, got {shown}"),
            );
        }
        let mut missing = source;
        missing.as_object_mut().unwrap().remove("n_features");
        assert_refused(
            &fails(N4mRolePipeline::from_json(&missing.to_string())),
            "n_features must be a positive JSON integer, got null",
        );
    }

    #[test]
    fn column_names_with_nul_are_refused() {
        if !configured() {
            return;
        }
        let shared = methods_fixture();
        let case = &shared["regression"];
        let mut names = shared["feature_names"].clone();
        names[3] = json!("nm1006\0");
        let error = fails(N4mRolePipeline::from_json(&envelope(
            &case["steps"],
            &case["states"],
            Some(&names),
            None,
        )));
        assert_refused(&error, "feature name must not contain NUL");
        let pipeline = N4mRolePipeline::from_json(&envelope(
            &case["steps"],
            &case["states"],
            Some(&shared["feature_names"]),
            None,
        ))
        .unwrap();
        let (x_test, m, _) = rows(&shared["x_test"]);
        let names = super::tests::names(&names);
        let error = pipeline
            .predict(&x_test, m, Some(&refs(&names)))
            .unwrap_err();
        assert_refused(&error, "feature name must not contain NUL");
    }

    #[test]
    fn shapes_that_contradict_the_declared_dimensions_are_refused() {
        if !configured() {
            return;
        }
        let shared = methods_fixture();
        let recipe = json!({"pipeline": ["n4m:models.regularized.ridge"]});
        let (x, n, p) = rows(&shared["x_train"]);
        let (y, _, q) = rows(&shared["y2_train"]);
        let fit = |x: &[f64], y: Vec<f64>, cols: usize| {
            N4mRolePipeline::fit_recipe(
                &recipe,
                x,
                n,
                p,
                None,
                &RoleTarget::Values { data: y, cols },
            )
        };
        assert!(fit(&x, y.clone(), q).is_ok());
        let row_major = "row-major matrix data length does not match dimensions";
        assert_refused(&fails(fit(&x[1..], y.clone(), q)), row_major);
        assert_refused(&fails(fit(&x, y[1..].to_vec(), q)), row_major);
        assert!(fit(&x, y[q..].to_vec(), q).is_err());
        assert!(fit(&x, [y.clone(), y[..q].to_vec()].concat(), q).is_err());
        assert!(fit(&x, Vec::new(), 0).is_err());
    }

    #[test]
    fn n4m_tokens_resolve_through_the_manifest() {
        if !configured() {
            return;
        }
        let definition = crate::load_pipeline_definition_str(
            r#"{"pipeline": ["n4m:preprocessing.scatter.snv", {"class": "n4m:models.pls.cppls", "params": {"n_components": 3}}]}"#,
        )
        .unwrap();
        assert_eq!(
            crate::portable_class_names(&definition),
            ["n4m:preprocessing.scatter.snv", "n4m:models.pls.cppls"]
        );
        let error = crate::load_pipeline_definition_str(r#"["n4m:not.a.method"]"#).unwrap_err();
        assert!(error.contains("n4m:not.a.method"), "{error}");
        assert!(crate::parse_execution_plan(&definition)
            .unwrap_err()
            .contains("N4mRolePipeline"));

        let capabilities = n4m_role_capabilities().unwrap();
        let cppls = capabilities
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["token"] == "n4m:models.pls.cppls")
            .expect("cppls is a recipe step");
        assert_eq!(cppls["roles"], json!(["regressor"]));
        assert!(cppls["parameters"]
            .as_array()
            .unwrap()
            .contains(&json!("n_components")));
    }
}
