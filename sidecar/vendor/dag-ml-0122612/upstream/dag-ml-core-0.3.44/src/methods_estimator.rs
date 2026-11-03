//! Generic native controller for n4m role estimators (Methods ABI 2.14
//! runtime; N4ME states from ABI 2.13 on).
//!
//! One [`MethodsEstimatorController`] serves each executable role of the n4m
//! manifest (see [`crate::n4m_roles`]). A node names its method with the
//! reserved `method_id` parameter; every other parameter is typed by the
//! native manifest JSON (`n4m_method_manifest_json`, the cross-language
//! contract; additive manifest keys are ignored) and checked by libn4m.
//! Fitting, transforms, masks and
//! predictions all run through `n4m::roles::Estimator`; fitted states leave
//! the process only as N4ME bytes owned by the exporting controller.
//!
//! The role controllers of one registration share an invocation-local
//! feature store: a transform or sample-filter output is a `Data` handle whose
//! identity-keyed rows stay inside this store, so a chain such as
//! `exclude -> transform -> model` runs natively without a host callback.
//! Sample filters and their masks apply to training rows only.
//!
//! Model nodes (regressors and classifiers) score the same surfaces as a host
//! model controller: FIT_CV emits the fold-validation OOF block, the in-fold
//! `Train` block and the report-only `TrainPool` block, REFIT the `Final`
//! block, each paired with its identity-keyed targets. Classifiers fit on the
//! integral class ids of their single target column, predict class ids and
//! attest class probabilities on the report-only CV surfaces when their method
//! defines them.

use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, Weak};

use n4m::roles::{self, Estimator, FitInputs, ParamType, ParamValue, Params};
use n4m::{Context, MatrixRef};
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::controller_adapter::HostControllerSpec;
use crate::hpo::{
    MethodsPlsController, MethodsRuntime, METHODS_ABI_MAJOR, METHODS_N4ME_MIN_ABI_MINOR,
};
use crate::n4m_roles::{n4m_host_controller_specs, N4mRole};
use crate::runtime::{
    refit_artifact_input_key, ArtifactBackend, ArtifactMaterializationRequest, ArtifactRef,
    ClassificationProbabilityBlock, HandleKind, HandleRef, LineageRecord, MethodsPlsDataset,
    MethodsPlsMatrix, NativeEstimatorDescriptorV1, NodeResult, NodeTask, PredictionBlock,
    PredictionPartition, RegressionTargetBlock, RuntimeController, RuntimeControllerRegistry,
    RuntimeDataProvider, NATIVE_ESTIMATOR_ARTIFACT_KIND,
    NATIVE_ESTIMATOR_DESCRIPTOR_SCHEMA_VERSION_V1, NATIVE_ESTIMATOR_DESCRIPTOR_TYPE_V1,
    NATIVE_ESTIMATOR_FORMAT_N4ME,
};
use crate::{
    ArtifactId, ControllerId, DagMlError, LineageId, Phase, PredictionLevel, PredictionUnitId,
    Result, RunId,
};

/// Reserved node parameter naming the native method.
pub const METHODS_ESTIMATOR_METHOD_PARAM: &str = "method_id";
/// Reserved node parameter carrying explicit, lineage-recorded unsafe opt-ins.
pub const METHODS_ESTIMATOR_UNSAFE_FLAGS_PARAM: &str = "unsafe_flags";
/// Opt-in allowing an N4ME artifact to embed training rows (kernel/local
/// methods). Without it such methods are refused before any fit.
pub const METHODS_ESTIMATOR_ALLOW_TRAINING_ROWS: &str = "allow_training_rows_in_artifact";

/// Roles executed natively. Splitters and augmenters are derived as
/// controller specs but have no native execution path yet.
pub const METHODS_ESTIMATOR_EXECUTABLE_ROLES: [N4mRole; 5] = [
    N4mRole::Transformer,
    N4mRole::Selector,
    N4mRole::Regressor,
    N4mRole::Classifier,
    N4mRole::SampleFilter,
];

const CAPABILITY_NAMES: [(u64, &str); 10] = [
    (roles::CAP_TRANSFORM, "transform"),
    (roles::CAP_PREDICT, "predict"),
    (roles::CAP_PREDICT_PROBA, "predict_proba"),
    (roles::CAP_DECISION_FUNCTION, "decision_function"),
    (roles::CAP_PREDICT_LABELS, "predict_labels"),
    (roles::CAP_SELECTED_INDICES, "selected_indices"),
    (roles::CAP_APPLY_MASK, "apply_mask"),
    (roles::CAP_SERIALIZABLE, "serializable"),
    (roles::CAP_AFFINE, "affine"),
    (roles::CAP_RETAINS_TRAINING_ROWS, "retains_training_rows"),
];

fn native_error(operation: &str, error: n4m::Error) -> DagMlError {
    DagMlError::RuntimeValidation(format!(
        "native Methods estimator {operation} failed: {error}"
    ))
}

fn lock_poisoned(what: &str) -> DagMlError {
    DagMlError::RuntimeValidation(format!("native Methods estimator {what} lock poisoned"))
}

/// One method of the native manifest JSON: exactly the fields native
/// execution reads. Other keys (for example ABI 2.14's per-parameter
/// `recorded` flag, or a `null` default marking an optional seed) are
/// additive and ignored.
#[derive(Clone, Debug, Deserialize)]
struct NativeMethod {
    method_id: String,
    kind: String,
    roles: Vec<N4mRole>,
    capabilities: BTreeSet<String>,
    inputs: BTreeMap<String, String>,
    params: Vec<NativeParam>,
}

#[derive(Clone, Debug, Deserialize)]
struct NativeParam {
    name: String,
    #[serde(rename = "type")]
    param_type: String,
    #[serde(default)]
    choices: Vec<String>,
}

impl NativeMethod {
    /// Whether fitting reads the named input (`y`, `labels`, ...).
    fn uses(&self, input: &str) -> bool {
        self.inputs
            .get(input)
            .is_some_and(|requirement| requirement != "none")
    }

    fn param(&self, name: &str) -> Option<&NativeParam> {
        self.params.iter().find(|param| param.name == name)
    }
}

impl NativeParam {
    fn native_type(&self) -> Option<ParamType> {
        Some(match self.param_type.as_str() {
            "int" => ParamType::Int,
            "double" => ParamType::Double,
            "bool" => ParamType::Bool,
            "enum" => ParamType::Enum,
            "int_array" => ParamType::IntArray,
            "double_array" => ParamType::DoubleArray,
            _ => return None,
        })
    }
}

/// The methods of the configured libn4m, read once from its live manifest.
struct NativeCatalog(BTreeMap<String, Arc<NativeMethod>>);

impl NativeCatalog {
    fn live() -> Result<Self> {
        #[derive(Deserialize)]
        struct Manifest {
            methods: Vec<NativeMethod>,
        }
        let json = roles::manifest_json().map_err(|error| native_error("manifest", error))?;
        let manifest = serde_json::from_str::<Manifest>(&json).map_err(|error| {
            DagMlError::RuntimeValidation(format!(
                "native Methods manifest is not the expected JSON contract: {error}"
            ))
        })?;
        Ok(Self(
            manifest
                .methods
                .into_iter()
                .map(|method| (method.method_id.clone(), Arc::new(method)))
                .collect(),
        ))
    }

    fn method(&self, method_id: &str) -> Result<&Arc<NativeMethod>> {
        self.0.get(method_id).ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "native Methods manifest has no method `{method_id}`"
            ))
        })
    }
}

fn capability_names(capabilities: u64) -> Vec<String> {
    let mut names = CAPABILITY_NAMES
        .iter()
        .filter(|(bit, _)| capabilities & bit != 0)
        .map(|(_, name)| name.to_string())
        .collect::<Vec<_>>();
    names.sort();
    names
}

/// Controller specs for the methods of the configured libn4m, derived from its
/// live manifest.
pub fn methods_estimator_host_controller_specs(
    _runtime: &MethodsRuntime,
) -> Result<Vec<HostControllerSpec>> {
    let manifest = roles::manifest_json().map_err(|error| native_error("manifest", error))?;
    n4m_host_controller_specs(&manifest)
}

/// Register one controller per executable role, all sharing one feature store
/// and the live native manifest.
pub fn register_methods_estimator_controllers(
    registry: &mut RuntimeControllerRegistry,
    runtime: MethodsRuntime,
) -> Result<()> {
    let shared = Arc::new(SharedState {
        catalog: NativeCatalog::live()?,
        next_handle: AtomicU64::default(),
        features: Mutex::default(),
        run_leases: Mutex::default(),
        exported: Mutex::default(),
        hydrated: Mutex::default(),
    });
    for role in METHODS_ESTIMATOR_EXECUTABLE_ROLES {
        registry.register(Box::new(MethodsEstimatorController {
            id: ControllerId::new(role.controller_id().expect("executable roles have ids"))?,
            role,
            runtime: runtime.clone(),
            shared: Arc::clone(&shared),
        }))?;
    }
    Ok(())
}

/// Inspect complete N4ME bytes and derive their descriptor. The method id and
/// capabilities come from the imported native state, the roles from the
/// native manifest of that method.
pub fn inspect_methods_native_estimator_descriptor_v1(
    owner_controller: &ControllerId,
    payload: &[u8],
) -> Result<NativeEstimatorDescriptorV1> {
    inspect_descriptor(&NativeCatalog::live()?, owner_controller, payload)
}

fn inspect_descriptor(
    catalog: &NativeCatalog,
    owner_controller: &ControllerId,
    payload: &[u8],
) -> Result<NativeEstimatorDescriptorV1> {
    let context = Context::new().map_err(|error| native_error("context_create", error))?;
    let estimator = Estimator::from_n4me(&context, payload)
        .map_err(|error| native_error("import_n4me", error))?;
    let method_id = estimator
        .method_id()
        .map_err(|error| native_error("method_id", error))?;
    let capabilities = estimator
        .capabilities()
        .map_err(|error| native_error("capabilities", error))?;
    let roles = catalog.method(&method_id)?.roles.clone();
    let mut descriptor = NativeEstimatorDescriptorV1 {
        descriptor_type: NATIVE_ESTIMATOR_DESCRIPTOR_TYPE_V1.to_string(),
        schema_version: NATIVE_ESTIMATOR_DESCRIPTOR_SCHEMA_VERSION_V1,
        artifact_sha256: format!("{:x}", Sha256::digest(payload)),
        owner_controller: owner_controller.clone(),
        format: NATIVE_ESTIMATOR_FORMAT_N4ME.to_string(),
        method_id,
        roles,
        capabilities: capability_names(capabilities),
        descriptor_fingerprint: String::new(),
    };
    descriptor.descriptor_fingerprint = descriptor.compute_fingerprint()?;
    descriptor.validate()?;
    Ok(descriptor)
}

/// Identity-keyed rows produced by one node: the rows it fits on and, when
/// the scheduler supplied one, the separately selected prediction rows.
struct FeatureSet {
    fit: MethodsPlsDataset,
    prediction: Option<MethodsPlsDataset>,
}

struct SharedState {
    catalog: NativeCatalog,
    next_handle: AtomicU64,
    features: Mutex<BTreeMap<u64, (RunId, Arc<FeatureSet>)>>,
    run_leases: Mutex<BTreeMap<RunId, Weak<MethodsRunLease>>>,
    exported: Mutex<BTreeMap<ArtifactId, Vec<u8>>>,
    hydrated: Mutex<BTreeMap<u64, Vec<u8>>>,
}

struct MethodsRunLease {
    shared: Arc<SharedState>,
    run_id: RunId,
}

impl std::fmt::Debug for MethodsRunLease {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_tuple("MethodsRunLease")
            .field(&self.run_id)
            .finish()
    }
}

impl Drop for MethodsRunLease {
    fn drop(&mut self) {
        self.shared
            .features
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .retain(|_, (run, _)| run != &self.run_id);
    }
}

/// Resolved method of one node task.
struct NodeMethod {
    method_id: String,
    info: Arc<NativeMethod>,
    params: Vec<(String, ParamValue)>,
    allow_training_rows: bool,
    target_index: Option<usize>,
}

impl NodeMethod {
    fn from_task(task: &NodeTask, role: N4mRole, catalog: &NativeCatalog) -> Result<Self> {
        let node_id = &task.node_plan.node_id;
        let invalid = |reason: String| {
            DagMlError::RuntimeValidation(format!(
                "native Methods estimator node `{node_id}` {reason}"
            ))
        };
        let params = &task.node_plan.params;
        let method_id = params
            .get(METHODS_ESTIMATOR_METHOD_PARAM)
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| {
                invalid(format!(
                    "requires a string `{METHODS_ESTIMATOR_METHOD_PARAM}` parameter"
                ))
            })?
            .to_string();
        let info = Arc::clone(
            catalog
                .method(&method_id)
                .map_err(|error| invalid(format!("names an unknown method: {error}")))?,
        );
        if info.kind != "estimator" || !info.roles.contains(&role) {
            return Err(invalid(format!(
                "method `{method_id}` is not a {} estimator",
                role.as_str()
            )));
        }
        let mut allow_training_rows = false;
        if let Some(flags) = params.get(METHODS_ESTIMATOR_UNSAFE_FLAGS_PARAM) {
            for flag in flags.as_array().ok_or_else(|| {
                invalid(format!(
                    "`{METHODS_ESTIMATOR_UNSAFE_FLAGS_PARAM}` must be an array"
                ))
            })? {
                match flag.as_str() {
                    Some(METHODS_ESTIMATOR_ALLOW_TRAINING_ROWS) => allow_training_rows = true,
                    _ => return Err(invalid(format!("has unknown unsafe flag {flag}"))),
                }
            }
        }
        if info.capabilities.contains("retains_training_rows") && !allow_training_rows {
            return Err(invalid(format!(
                "method `{method_id}` retains training rows in its fitted state; set `{METHODS_ESTIMATOR_UNSAFE_FLAGS_PARAM}: [\"{METHODS_ESTIMATOR_ALLOW_TRAINING_ROWS}\"]` to allow it"
            )));
        }
        let target_index = params
            .get("native_target_index")
            .map(|value| {
                value
                    .as_u64()
                    .and_then(|value| usize::try_from(value).ok())
                    .ok_or_else(|| {
                        invalid("native_target_index must be a nonnegative integer".into())
                    })
            })
            .transpose()?;
        if target_index.is_some() && !matches!(role, N4mRole::Regressor | N4mRole::Classifier) {
            return Err(invalid(
                "native_target_index is supported only by target model nodes".into(),
            ));
        }
        let mut typed = Vec::new();
        for (name, value) in params {
            if name == METHODS_ESTIMATOR_METHOD_PARAM
                || name == METHODS_ESTIMATOR_UNSAFE_FLAGS_PARAM
                || name == "native_target_index"
            {
                continue;
            }
            let param = info.param(name).ok_or_else(|| {
                invalid(format!("sets unknown parameter `{name}` of `{method_id}`"))
            })?;
            let value = param
                .native_type()
                .and_then(|param_type| param_value(param_type, value))
                .ok_or_else(|| {
                    invalid(format!(
                        "parameter `{name}` is not a {} value",
                        param.param_type
                    ))
                })?;
            typed.push((name.clone(), value));
        }
        Ok(Self {
            method_id,
            info,
            params: typed,
            allow_training_rows,
            target_index,
        })
    }

    fn estimator(&self, context: &Context) -> Result<Estimator> {
        let mut params = Params::new(context, &self.method_id)
            .map_err(|error| native_error("params_create", error))?;
        for (name, value) in &self.params {
            params
                .set(name, value)
                .map_err(|error| native_error("params_set", error))?;
        }
        Estimator::new(context, &self.method_id, Some(&params))
            .map_err(|error| native_error("create", error))
    }

    fn fit(&self, context: &Context, data: &MethodsPlsDataset) -> Result<Estimator> {
        let filtered;
        let data = if let Some(masks) = data
            .y_validity_masks
            .as_ref()
            .filter(|masks| masks.iter().any(|row| row.contains(&false)))
        {
            if self.info.inputs.get("y").is_some_and(|v| v == "required")
                || self
                    .info
                    .inputs
                    .get("labels")
                    .is_some_and(|v| v == "required")
            {
                if data.target_names.len() != 1 {
                    return Err(DagMlError::RuntimeValidation(
                        "partial targets require one native model node per target".into(),
                    ));
                }
                let keep = masks.iter().map(|row| row[0]).collect::<Vec<_>>();
                if !keep.iter().any(|value| *value) {
                    return Err(DagMlError::RuntimeValidation(
                        "native model has no observed training target in this fold".into(),
                    ));
                }
                filtered = keep_rows(data, &keep);
                &filtered
            } else {
                data
            }
        } else {
            data
        };
        let mut estimator = self.estimator(context)?;
        let x = matrix(&data.x)?;
        let partial = data
            .y_validity_masks
            .as_ref()
            .is_some_and(|rows| rows.iter().any(|row| row.contains(&false)));
        let labels = if self.info.uses("labels")
            && !(partial
                && self
                    .info
                    .inputs
                    .get("labels")
                    .is_some_and(|v| v == "optional"))
        {
            Some(class_labels(data, &self.method_id)?)
        } else {
            None
        };
        let mut inputs = FitInputs::new(x);
        // Optional targets are omitted when partial: placeholder storage must
        // never become an observed label for an optional supervised path.
        if self.info.uses("y")
            && !(partial && self.info.inputs.get("y").is_some_and(|v| v == "optional"))
        {
            if let Some(y) = &data.y {
                inputs = inputs.y(matrix(y)?);
            }
        }
        if let Some(labels) = &labels {
            inputs = inputs.labels(labels);
        }
        estimator
            .fit(context, &inputs)
            .map_err(|error| native_error("fit", error))?;
        Ok(estimator)
    }

    /// Replay integrity: every explicit node parameter must equal the value
    /// resolved inside the imported state.
    fn check_imported(&self, context: &Context, estimator: &Estimator) -> Result<()> {
        let imported_id = estimator
            .method_id()
            .map_err(|error| native_error("method_id", error))?;
        let params = estimator
            .params(context)
            .map_err(|error| native_error("params", error))?;
        let mut matches = imported_id == self.method_id;
        for (name, value) in &self.params {
            let ints = || params.int_values(name).ok();
            let doubles = || params.double_values(name).ok();
            matches &= match value {
                ParamValue::Int(value) => ints() == Some(vec![*value]),
                ParamValue::Bool(value) => ints() == Some(vec![i64::from(*value)]),
                ParamValue::Enum(label) => {
                    let choice = self
                        .info
                        .param(name)
                        .and_then(|param| param.choices.iter().position(|choice| choice == label));
                    choice.is_some_and(|index| ints() == Some(vec![index as i64]))
                }
                ParamValue::IntArray(values) => ints().as_ref() == Some(values),
                ParamValue::Double(value) => doubles() == Some(vec![*value]),
                ParamValue::DoubleArray(values) => doubles().as_ref() == Some(values),
            };
        }
        if !matches {
            return Err(DagMlError::RuntimeValidation(format!(
                "N4ME state does not match node method `{}` and its parameters",
                self.method_id
            )));
        }
        Ok(())
    }
}

/// Typed native value of a JSON parameter. An integral JSON number is an
/// exact `int`: DAG-ML's numeric generators emit binary64 values, so a swept
/// `3.0` must not be refused where `3` is accepted.
fn param_value(param_type: ParamType, value: &serde_json::Value) -> Option<ParamValue> {
    fn integral(value: &serde_json::Value) -> Option<i64> {
        value.as_i64().or_else(|| {
            value
                .as_f64()
                .filter(|value| value.fract() == 0.0 && value.abs() <= 2f64.powi(53))
                .map(|value| value as i64)
        })
    }
    let ints = || {
        value
            .as_array()?
            .iter()
            .map(integral)
            .collect::<Option<Vec<_>>>()
    };
    let doubles = || {
        value
            .as_array()?
            .iter()
            .map(serde_json::Value::as_f64)
            .collect::<Option<Vec<_>>>()
    };
    Some(match param_type {
        ParamType::Int => ParamValue::Int(integral(value)?),
        ParamType::Double => ParamValue::Double(value.as_f64()?),
        ParamType::Bool => ParamValue::Bool(value.as_bool()?),
        ParamType::Enum => ParamValue::Enum(value.as_str()?.to_string()),
        ParamType::IntArray => ParamValue::IntArray(ints()?),
        ParamType::DoubleArray => ParamValue::DoubleArray(doubles()?),
    })
}

/// Class ids of a single integral target column. Class ids cross the ABI
/// unchanged, so a fitted N4ME state predicts the dataset's own labels.
fn class_labels(data: &MethodsPlsDataset, method_id: &str) -> Result<Vec<i64>> {
    let invalid = || {
        DagMlError::RuntimeValidation(format!(
            "native Methods method `{method_id}` requires one target column of integral class ids"
        ))
    };
    let y = data
        .y
        .as_ref()
        .filter(|y| y.cols == 1)
        .ok_or_else(invalid)?;
    y.values
        .iter()
        .map(|value| {
            (value.fract() == 0.0 && value.abs() <= 2f64.powi(53))
                .then_some(*value as i64)
                .ok_or_else(invalid)
        })
        .collect()
}

/// Rows of `first` followed by the rows of `second` it does not already hold.
pub(crate) fn union_rows(
    first: &MethodsPlsDataset,
    second: &MethodsPlsDataset,
) -> MethodsPlsDataset {
    let seen = first.sample_ids.iter().collect::<BTreeSet<_>>();
    let extra = second
        .sample_ids
        .iter()
        .map(|sample_id| !seen.contains(sample_id))
        .collect::<Vec<_>>();
    let second = keep_rows(second, &extra);
    let join = |left: &MethodsPlsMatrix, right: &MethodsPlsMatrix| MethodsPlsMatrix {
        values: [left.values.as_slice(), right.values.as_slice()].concat(),
        rows: left.rows + right.rows,
        cols: left.cols,
    };
    MethodsPlsDataset {
        y_validity_masks: if first.y_validity_masks.is_some() || second.y_validity_masks.is_some() {
            Some(
                [first, &second]
                    .iter()
                    .flat_map(|data| {
                        data.y_validity_masks.clone().unwrap_or_else(|| {
                            vec![vec![true; data.target_names.len()]; data.sample_ids.len()]
                        })
                    })
                    .collect(),
            )
        } else {
            None
        },
        sample_ids: [first.sample_ids.as_slice(), second.sample_ids.as_slice()].concat(),
        x: join(&first.x, &second.x),
        y: first
            .y
            .as_ref()
            .zip(second.y.as_ref())
            .map(|(left, right)| join(left, right)),
        target_names: first.target_names.clone(),
    }
}

fn matrix(values: &MethodsPlsMatrix) -> Result<MatrixRef<'_>> {
    MatrixRef::row_major(&values.values, values.rows, values.cols)
        .map_err(|error| native_error("matrix_view", error))
}

fn owned(matrix: n4m::Matrix) -> MethodsPlsMatrix {
    MethodsPlsMatrix {
        values: matrix.data,
        rows: matrix.rows,
        cols: matrix.cols,
    }
}

fn with_features(dataset: &MethodsPlsDataset, x: MethodsPlsMatrix) -> MethodsPlsDataset {
    MethodsPlsDataset {
        y_validity_masks: dataset.y_validity_masks.clone(),
        sample_ids: dataset.sample_ids.clone(),
        x,
        y: dataset.y.clone(),
        target_names: dataset.target_names.clone(),
    }
}

fn keep_rows(dataset: &MethodsPlsDataset, keep: &[bool]) -> MethodsPlsDataset {
    let select = |matrix: &MethodsPlsMatrix| MethodsPlsMatrix {
        values: matrix
            .values
            .chunks(matrix.cols)
            .zip(keep)
            .filter(|(_, keep)| **keep)
            .flat_map(|(row, _)| row.iter().copied())
            .collect(),
        rows: keep.iter().filter(|keep| **keep).count(),
        cols: matrix.cols,
    };
    MethodsPlsDataset {
        y_validity_masks: dataset.y_validity_masks.as_ref().map(|masks| {
            masks
                .iter()
                .zip(keep)
                .filter(|(_, keep)| **keep)
                .map(|(row, _)| row.clone())
                .collect()
        }),
        sample_ids: dataset
            .sample_ids
            .iter()
            .zip(keep)
            .filter(|(_, keep)| **keep)
            .map(|(sample_id, _)| sample_id.clone())
            .collect(),
        x: select(&dataset.x),
        y: dataset.y.as_ref().map(select),
        target_names: dataset.target_names.clone(),
    }
}

fn target_column(rows: &MethodsPlsDataset, index: usize) -> Result<MethodsPlsDataset> {
    if index >= rows.target_names.len() {
        return Err(DagMlError::RuntimeValidation(
            "native_target_index exceeds target schema".into(),
        ));
    }
    Ok(MethodsPlsDataset {
        sample_ids: rows.sample_ids.clone(),
        x: rows.x.clone(),
        y: rows.y.as_ref().map(|y| MethodsPlsMatrix {
            rows: y.rows,
            cols: 1,
            values: y.values.chunks(y.cols).map(|row| row[index]).collect(),
        }),
        target_names: vec![rows.target_names[index].clone()],
        y_validity_masks: rows
            .y_validity_masks
            .as_ref()
            .map(|masks| masks.iter().map(|row| vec![row[index]]).collect()),
    })
}

/// Native controller for one n4m role; see the module documentation.
pub struct MethodsEstimatorController {
    id: ControllerId,
    role: N4mRole,
    runtime: MethodsRuntime,
    shared: Arc<SharedState>,
}

impl MethodsEstimatorController {
    pub fn role(&self) -> N4mRole {
        self.role
    }

    fn handle(&self, kind: HandleKind) -> HandleRef {
        HandleRef {
            handle: self.shared.next_handle.fetch_add(1, Ordering::SeqCst) + 1,
            kind,
            owner_controller: self.id.clone(),
        }
    }

    fn input_features(
        &self,
        task: &NodeTask,
        provider: &dyn RuntimeDataProvider,
    ) -> Result<Arc<FeatureSet>> {
        if task
            .node_plan
            .data_bindings
            .iter()
            .any(|binding| binding.input_name == "x")
        {
            let request = MethodsPlsController::request(task, provider, "x")?;
            provider.preflight_methods_pls(&request)?;
            let data = provider.methods_pls_data(&request)?;
            data.validate_for(&request)?;
            return Ok(Arc::new(FeatureSet {
                fit: data.fit,
                prediction: data.prediction,
            }));
        }
        let node_id = &task.node_plan.node_id;
        let handle = task
            .input_handles
            .get("data:x")
            .filter(|handle| {
                handle.kind == HandleKind::Data
                    && N4mRole::from_controller_id(handle.owner_controller.as_str()).is_some()
            })
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "native Methods estimator node `{node_id}` requires a data binding or an upstream n4m data output on `x`"
                ))
            })?;
        let features = self
            .shared
            .features
            .lock()
            .map_err(|_| lock_poisoned("feature store"))?
            .get(&handle.handle)
            .map(|(_, features)| Arc::clone(features))
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "native Methods estimator node `{node_id}` input handle {} is not in this registration's feature store",
                    handle.handle
                ))
            })?;
        let fit_view_ids = task
            .data_views
            .get("data:x")
            .and_then(|view| view.sample_ids.as_ref())
            .map(|ids| ids.iter().collect::<BTreeSet<_>>());
        if fit_view_ids
            .is_some_and(|ids| !features.fit.sample_ids.iter().all(|id| ids.contains(id)))
        {
            return Err(DagMlError::RuntimeValidation(format!(
                "native Methods estimator node `{node_id}` received fit rows outside its scheduler-selected view"
            )));
        }
        let validation_ids = task
            .data_views
            .get("data:x:validation")
            .and_then(|view| view.sample_ids.as_ref());
        if task.phase == Phase::FitCv
            && features.prediction.as_ref().map(|rows| &rows.sample_ids) != validation_ids
        {
            return Err(DagMlError::RuntimeValidation(format!(
                "native Methods estimator node `{node_id}` validation rows do not match its scheduler-selected view"
            )));
        }
        Ok(features)
    }

    fn emit_features(&self, run_id: &RunId, features: Arc<FeatureSet>) -> Result<HandleRef> {
        let handle = self.handle(HandleKind::Data);
        self.shared
            .features
            .lock()
            .map_err(|_| lock_poisoned("feature store"))?
            .insert(handle.handle, (run_id.clone(), features));
        Ok(handle)
    }

    fn refit_artifact(
        &self,
        task: &NodeTask,
        context: &Context,
        estimator: &Estimator,
        method: &NodeMethod,
    ) -> Result<(ArtifactRef, HandleRef)> {
        let bytes = estimator
            .to_n4me(context, method.allow_training_rows)
            .map_err(|error| native_error("export_n4me", error))?;
        let descriptor = inspect_descriptor(&self.shared.catalog, &self.id, &bytes)?;
        // One REFIT state per node and variant: a multi-variant REFIT (top-k)
        // must never overwrite another variant's exported payload.
        let scope = format!(
            "{}:{}",
            task.node_plan.node_id,
            task.variant_id
                .as_ref()
                .map(|id| id.as_str())
                .unwrap_or("base")
        );
        let id = ArtifactId::new(format!("artifact:n4m:{scope}:refit"))?;
        let artifact = ArtifactRef {
            id: id.clone(),
            kind: NATIVE_ESTIMATOR_ARTIFACT_KIND.to_string(),
            controller_id: self.id.clone(),
            backend: Some(ArtifactBackend::Raw),
            uri: Some(format!("methods/{}.n4me", scope.replace(':', "_"))),
            content_fingerprint: Some(descriptor.artifact_sha256.clone()),
            size_bytes: Some(bytes.len() as u64),
            plugin: None,
            plugin_version: None,
            abi_major: Some(METHODS_ABI_MAJOR),
            abi_min_minor: Some(METHODS_N4ME_MIN_ABI_MINOR),
            native_predictor_descriptor: None,
            native_estimator_descriptor: Some(descriptor),
        };
        artifact.validate()?;
        self.shared
            .exported
            .lock()
            .map_err(|_| lock_poisoned("N4ME export"))?
            .insert(id, bytes);
        Ok((artifact, self.handle(HandleKind::Model)))
    }

    /// The hydrated N4ME state of this node for PREDICT, consumed once.
    fn hydrated_estimator(
        &self,
        task: &NodeTask,
        context: &Context,
        method: &NodeMethod,
    ) -> Result<Estimator> {
        let node_id = &task.node_plan.node_id;
        let missing = |what: &str| {
            DagMlError::RuntimeValidation(format!(
                "native Methods estimator node `{node_id}` PREDICT requires {what}"
            ))
        };
        let artifact = task
            .artifact_inputs
            .values()
            .find(|input| {
                input.controller_id == self.id
                    && input.artifact.kind == NATIVE_ESTIMATOR_ARTIFACT_KIND
            })
            .ok_or_else(|| missing("its retained N4ME artifact reference"))?;
        let handle = task
            .input_handles
            .get(&refit_artifact_input_key(&artifact.artifact.id))
            .ok_or_else(|| missing("a hydrated N4ME handle"))?;
        let bytes = self
            .shared
            .hydrated
            .lock()
            .map_err(|_| lock_poisoned("hydrated N4ME"))?
            .remove(&handle.handle)
            .ok_or_else(|| missing("N4ME bytes hydrated by this controller registration"))?;
        let estimator = Estimator::from_n4me(context, &bytes)
            .map_err(|error| native_error("import_n4me", error))?;
        method.check_imported(context, &estimator)?;
        Ok(estimator)
    }

    fn result(
        &self,
        task: &NodeTask,
        method: &NodeMethod,
        outputs: BTreeMap<String, HandleRef>,
        scores: Scores,
        artifact: Option<(ArtifactRef, HandleRef)>,
    ) -> Result<NodeResult> {
        let (artifacts, artifact_handles) = artifact
            .map(|(artifact, handle)| {
                (
                    vec![artifact.clone()],
                    BTreeMap::from([(artifact.id, handle)]),
                )
            })
            .unwrap_or_default();
        let unsafe_flags = if method.allow_training_rows {
            BTreeSet::from([METHODS_ESTIMATOR_ALLOW_TRAINING_ROWS.to_string()])
        } else {
            BTreeSet::new()
        };
        Ok(NodeResult {
            schema_version: None,
            classification_probabilities: scores.classification_probabilities,
            consumed_data_views: std::collections::BTreeMap::new(),
            node_id: task.node_plan.node_id.clone(),
            outputs,
            predictions: scores.predictions,
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: artifacts.clone(),
            artifact_handles,
            fit_influence_diagnostics: Vec::new(),
            regression_targets: scores.regression_targets,
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:n4m:{}:{}:{}:{}",
                    task.node_plan.node_id,
                    task.phase.as_str(),
                    task.variant_id
                        .as_ref()
                        .map(|id| id.as_str())
                        .unwrap_or("base"),
                    task.fold_id
                        .as_ref()
                        .map(|id| id.as_str())
                        .unwrap_or("full")
                ))?,
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
                input_lineage: Vec::new(),
                artifact_refs: artifacts,
                params_fingerprint: task.node_plan.params_fingerprint.clone(),
                data_model_shape_fingerprint: None,
                aggregation_policy_fingerprint: None,
                seed: task.seed,
                unsafe_flags,
                metrics: match (scores.fit_total_rows, scores.fit_observed_rows) {
                    (Some(total), Some(observed)) => BTreeMap::from([
                        ("native_fit_rows".into(), total as f64),
                        ("native_observed_target_rows".into(), observed as f64),
                    ]),
                    _ => BTreeMap::new(),
                },
                loss_attestations: Vec::new(),
                early_stopping_records: Vec::new(),
                target_domain: None,
            },
        })
    }

    fn transform(
        &self,
        task: &NodeTask,
        method: &NodeMethod,
        features: &FeatureSet,
    ) -> Result<NodeResult> {
        let context = Context::new().map_err(|error| native_error("context_create", error))?;
        let (estimator, artifact) = match task.phase {
            Phase::FitCv | Phase::Refit => {
                let estimator = method.fit(&context, &features.fit)?;
                let artifact = (task.phase == Phase::Refit)
                    .then(|| self.refit_artifact(task, &context, &estimator, method))
                    .transpose()?;
                (estimator, artifact)
            }
            Phase::Predict => (self.hydrated_estimator(task, &context, method)?, None),
            phase => return Err(unsupported_phase(task, phase)),
        };
        let apply = |dataset: &MethodsPlsDataset| -> Result<MethodsPlsDataset> {
            let transformed = estimator
                .transform(&context, matrix(&dataset.x)?)
                .map_err(|error| native_error("transform", error))?;
            let output = with_features(dataset, owned(transformed));
            output.validate("transform output", false)?;
            Ok(output)
        };
        let output = Arc::new(FeatureSet {
            fit: apply(&features.fit)?,
            prediction: features.prediction.as_ref().map(apply).transpose()?,
        });
        let outputs = BTreeMap::from([(
            "x_out".to_string(),
            self.emit_features(&task.run_id, output)?,
        )]);
        self.result(task, method, outputs, Scores::default(), artifact)
    }

    fn sample_filter(
        &self,
        task: &NodeTask,
        method: &NodeMethod,
        features: &Arc<FeatureSet>,
    ) -> Result<NodeResult> {
        let output = match task.phase {
            Phase::FitCv | Phase::Refit => {
                let context =
                    Context::new().map_err(|error| native_error("context_create", error))?;
                let estimator = method.fit(&context, &features.fit)?;
                let y = if method.info.uses("y") {
                    features.fit.y.as_ref().map(matrix).transpose()?
                } else {
                    None
                };
                let keep = estimator
                    .apply_mask(&context, matrix(&features.fit.x)?, y)
                    .map_err(|error| native_error("apply_mask", error))?;
                if !keep.contains(&true) {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "native Methods sample filter `{}` removed every training row",
                        task.node_plan.node_id
                    )));
                }
                Arc::new(FeatureSet {
                    fit: keep_rows(&features.fit, &keep),
                    prediction: features.prediction.clone(),
                })
            }
            // Sample filters are train-only: inference rows pass unchanged.
            Phase::Predict => Arc::clone(features),
            phase => return Err(unsupported_phase(task, phase)),
        };
        let outputs = BTreeMap::from([(
            "x_out".to_string(),
            self.emit_features(&task.run_id, output)?,
        )]);
        self.result(task, method, outputs, Scores::default(), None)
    }

    /// Regressor and classifier nodes: fit (or hydrate), then score every
    /// surface of the phase (see the module documentation).
    fn model(
        &self,
        task: &NodeTask,
        method: &NodeMethod,
        features: &FeatureSet,
        prediction_port: &str,
    ) -> Result<NodeResult> {
        let selected;
        let features = if let Some(index) = method.target_index {
            selected = FeatureSet {
                fit: target_column(&features.fit, index)?,
                prediction: features
                    .prediction
                    .as_ref()
                    .map(|rows| target_column(rows, index))
                    .transpose()?,
            };
            &selected
        } else {
            features
        };
        let context = Context::new().map_err(|error| native_error("context_create", error))?;
        let (estimator, artifact, surfaces) = match task.phase {
            Phase::FitCv => {
                let estimator = method.fit(&context, &features.fit)?;
                let mut surfaces = Vec::new();
                if let Some(validation) = &features.prediction {
                    surfaces.push((Cow::Borrowed(validation), PredictionPartition::Validation));
                }
                surfaces.push((Cow::Borrowed(&features.fit), PredictionPartition::Train));
                // Report-only: the fold model on its whole training pool.
                surfaces.push((
                    features
                        .prediction
                        .as_ref()
                        .map_or(Cow::Borrowed(&features.fit), |validation| {
                            Cow::Owned(union_rows(&features.fit, validation))
                        }),
                    PredictionPartition::TrainPool,
                ));
                (estimator, None, surfaces)
            }
            Phase::Refit => {
                let estimator = method.fit(&context, &features.fit)?;
                let artifact = self.refit_artifact(task, &context, &estimator, method)?;
                let mut surfaces = vec![(Cow::Borrowed(&features.fit), PredictionPartition::Final)];
                // A REFIT prediction view is an explicitly held-out cohort.
                if let Some(held_out) = &features.prediction {
                    surfaces.push((Cow::Borrowed(held_out), PredictionPartition::Test));
                }
                (estimator, Some(artifact), surfaces)
            }
            Phase::Predict => (
                self.hydrated_estimator(task, &context, method)?,
                None,
                vec![(Cow::Borrowed(&features.fit), PredictionPartition::Final)],
            ),
            phase => return Err(unsupported_phase(task, phase)),
        };
        let mut scores = Scores::default();
        if matches!(task.phase, Phase::FitCv | Phase::Refit) {
            scores.fit_total_rows = Some(features.fit.sample_ids.len());
            scores.fit_observed_rows = Some(features.fit.y_validity_masks.as_ref().map_or(
                features.fit.sample_ids.len(),
                |masks| {
                    masks
                        .iter()
                        .filter(|row| row.iter().all(|cell| *cell))
                        .count()
                },
            ));
        }
        for (rows, partition) in surfaces {
            self.score(
                task,
                method,
                &context,
                &estimator,
                &rows,
                partition,
                prediction_port,
                &mut scores,
            )?;
        }
        let outputs = BTreeMap::from([(
            prediction_port.to_string(),
            self.handle(HandleKind::Prediction),
        )]);
        self.result(task, method, outputs, scores, artifact)
    }

    /// Predict one surface, with its targets and, for a classifier on a
    /// report-only CV surface, its class probabilities.
    #[allow(clippy::too_many_arguments)]
    fn score(
        &self,
        task: &NodeTask,
        method: &NodeMethod,
        context: &Context,
        estimator: &Estimator,
        rows: &MethodsPlsDataset,
        partition: PredictionPartition,
        prediction_port: &str,
        scores: &mut Scores,
    ) -> Result<()> {
        let node_id = &task.node_plan.node_id;
        let x = matrix(&rows.x)?;
        let values = if self.role == N4mRole::Classifier {
            if rows.target_names.len() != 1 {
                return Err(DagMlError::RuntimeValidation(format!(
                    "native Methods classifier `{node_id}` predicts one label column, not {} targets",
                    rows.target_names.len()
                )));
            }
            estimator
                .predict_labels(context, x)
                .map_err(|error| native_error("predict_labels", error))?
                .into_iter()
                .map(|label| vec![label as f64])
                .collect::<Vec<_>>()
        } else {
            let predicted = estimator
                .predict(context, x)
                .map_err(|error| native_error("predict", error))?;
            if predicted.cols != rows.target_names.len() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "native Methods regressor `{node_id}` predicted {} targets for {} target names",
                    predicted.cols,
                    rows.target_names.len()
                )));
            }
            predicted
                .data
                .chunks(predicted.cols)
                .map(<[f64]>::to_vec)
                .collect()
        };
        let fold_id = (task.phase == Phase::FitCv)
            .then(|| task.fold_id.clone())
            .flatten();
        let producer_port = Some(prediction_port.to_string());
        if self.role == N4mRole::Classifier
            && task.phase == Phase::FitCv
            && matches!(
                partition,
                PredictionPartition::Train
                    | PredictionPartition::TrainPool
                    | PredictionPartition::Validation
            )
            && method.info.capabilities.contains("predict_proba")
        {
            let probabilities = estimator
                .predict_proba(context, x)
                .map_err(|error| native_error("predict_proba", error))?;
            let classes = estimator
                .classes()
                .map_err(|error| native_error("classes", error))?;
            scores
                .classification_probabilities
                .push(ClassificationProbabilityBlock {
                    producer_node: node_id.clone(),
                    producer_port: producer_port.clone(),
                    partition: partition.clone(),
                    fold_id: fold_id.clone(),
                    sample_ids: rows.sample_ids.clone(),
                    class_labels: classes.into_iter().map(|class| class as f64).collect(),
                    values: probabilities
                        .data
                        .chunks(probabilities.cols)
                        .map(<[f64]>::to_vec)
                        .collect(),
                });
        }
        if let Some(targets) = &rows.y {
            scores.regression_targets.push(RegressionTargetBlock {
                validity_masks: rows.y_validity_masks.clone(),
                level: PredictionLevel::Sample,
                unit_ids: rows
                    .sample_ids
                    .iter()
                    .cloned()
                    .map(PredictionUnitId::Sample)
                    .collect(),
                values: targets
                    .values
                    .chunks(targets.cols)
                    .map(<[f64]>::to_vec)
                    .collect(),
                target_names: rows.target_names.clone(),
            });
        } else if task.phase != Phase::Predict {
            return Err(DagMlError::RuntimeValidation(format!(
                "native Methods model `{node_id}` {} requires targets for its {partition:?} rows",
                task.phase.as_str()
            )));
        }
        scores.predictions.push(PredictionBlock {
            prediction_id: Some(format!(
                "n4m:{node_id}:{}:{}:{}:{partition:?}",
                task.phase.as_str(),
                task.variant_id
                    .as_ref()
                    .map(|id| id.as_str())
                    .unwrap_or("base"),
                task.fold_id
                    .as_ref()
                    .map(|id| id.as_str())
                    .unwrap_or("full")
            )),
            producer_node: node_id.clone(),
            producer_port,
            partition,
            fold_id,
            sample_ids: rows.sample_ids.clone(),
            values,
            target_names: rows.target_names.clone(),
        });
        Ok(())
    }
}

/// Scored prediction surfaces of one model invocation.
#[derive(Default)]
struct Scores {
    fit_total_rows: Option<usize>,
    fit_observed_rows: Option<usize>,
    predictions: Vec<PredictionBlock>,
    regression_targets: Vec<RegressionTargetBlock>,
    classification_probabilities: Vec<ClassificationProbabilityBlock>,
}

fn unsupported_phase(task: &NodeTask, phase: Phase) -> DagMlError {
    DagMlError::RuntimeValidation(format!(
        "native Methods estimator node `{}` does not run in {}",
        task.node_plan.node_id,
        phase.as_str()
    ))
}

impl RuntimeController for MethodsEstimatorController {
    fn retain_run_resources(
        &self,
        run_id: &RunId,
    ) -> Result<Option<Arc<dyn std::fmt::Debug + Send + Sync>>> {
        let mut leases = self
            .shared
            .run_leases
            .lock()
            .map_err(|_| lock_poisoned("run resources"))?;
        leases.retain(|_, lease| lease.strong_count() > 0);
        let lease = leases
            .get(run_id)
            .and_then(Weak::upgrade)
            .unwrap_or_else(|| {
                let lease = Arc::new(MethodsRunLease {
                    shared: Arc::clone(&self.shared),
                    run_id: run_id.clone(),
                });
                leases.insert(run_id.clone(), Arc::downgrade(&lease));
                lease
            });
        Ok(Some(lease))
    }

    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        Err(DagMlError::RuntimeValidation(format!(
            "native Methods estimator node `{}` requires a RuntimeDataProvider numeric view",
            task.node_plan.node_id
        )))
    }

    fn invoke_with_data_provider(
        &self,
        task: &NodeTask,
        provider: &dyn RuntimeDataProvider,
    ) -> Result<NodeResult> {
        // Retain the original direct-call contract. Scheduler invocations use
        // the graph's declared ports through the hook below.
        self.invoke_with_data_provider_and_prediction_ports(task, provider, &["oof".into()])
    }

    fn invoke_with_data_provider_and_prediction_ports(
        &self,
        task: &NodeTask,
        provider: &dyn RuntimeDataProvider,
        prediction_ports: &[String],
    ) -> Result<NodeResult> {
        if Some(&task.node_plan.kind) != self.role.node_kind().as_ref() {
            return Err(DagMlError::RuntimeValidation(format!(
                "native Methods {} controller cannot serve {:?} node `{}`",
                self.role.as_str(),
                task.node_plan.kind,
                task.node_plan.node_id
            )));
        }
        if matches!(self.role, N4mRole::Regressor | N4mRole::Classifier)
            && (prediction_ports.len() != 1 || prediction_ports[0].trim().is_empty())
        {
            return Err(DagMlError::RuntimeValidation(format!(
                "native Methods model `{}` requires exactly one prediction output port, got {:?}",
                task.node_plan.node_id, prediction_ports
            )));
        }
        let method = NodeMethod::from_task(task, self.role, &self.shared.catalog)?;
        let features = self.input_features(task, provider)?;
        match self.role {
            N4mRole::Transformer | N4mRole::Selector => self.transform(task, &method, &features),
            N4mRole::Regressor | N4mRole::Classifier => {
                self.model(task, &method, &features, &prediction_ports[0])
            }
            N4mRole::SampleFilter => self.sample_filter(task, &method, &features),
            role => Err(DagMlError::RuntimeValidation(format!(
                "native Methods {} role has no native execution path",
                role.as_str()
            ))),
        }
    }

    fn export_artifact_payload(&self, artifact_id: &ArtifactId) -> Result<Option<Vec<u8>>> {
        Ok(self
            .shared
            .exported
            .lock()
            .map_err(|_| lock_poisoned("N4ME export"))?
            .remove(artifact_id))
    }

    fn hydrate_artifact_payload(
        &self,
        request: &ArtifactMaterializationRequest,
        payload: &[u8],
    ) -> Result<HandleRef> {
        let artifact = &request.artifact;
        self.runtime.ensure_n4me_compatible(artifact)?;
        if artifact.kind != NATIVE_ESTIMATOR_ARTIFACT_KIND
            || artifact.backend != Some(ArtifactBackend::Raw)
            || artifact.controller_id != self.id
            || request.controller_id != self.id
        {
            return Err(DagMlError::RuntimeValidation(format!(
                "native Methods {} controller cannot hydrate artifact `{}`",
                self.role.as_str(),
                artifact.id
            )));
        }
        if artifact.content_fingerprint.as_deref()
            != Some(format!("{:x}", Sha256::digest(payload)).as_str())
            || artifact.size_bytes != Some(payload.len() as u64)
        {
            return Err(DagMlError::RuntimeValidation(format!(
                "N4ME payload `{}` does not match its artifact reference",
                artifact.id
            )));
        }
        let inspected = inspect_descriptor(&self.shared.catalog, &self.id, payload)?;
        if artifact.native_estimator_descriptor.as_ref() != Some(&inspected) {
            return Err(DagMlError::RuntimeValidation(format!(
                "N4ME payload `{}` does not match its inspected estimator descriptor",
                artifact.id
            )));
        }
        let handle = self.handle(HandleKind::Model);
        self.shared
            .hydrated
            .lock()
            .map_err(|_| lock_poisoned("hydrated N4ME"))?
            .insert(handle.handle, payload.to_vec());
        Ok(handle)
    }

    fn release_hydrated_artifact_payload(&self, handle: &HandleRef) -> Result<()> {
        if handle.kind != HandleKind::Model || handle.owner_controller != self.id {
            return Err(DagMlError::RuntimeValidation(format!(
                "native Methods {} controller cannot release foreign handle {}",
                self.role.as_str(),
                handle.handle
            )));
        }
        // PREDICT consumes its entry; rollback reaches this hook too, so an
        // absent entry is not an ownership failure.
        self.shared
            .hydrated
            .lock()
            .map_err(|_| lock_poisoned("hydrated N4ME"))?
            .remove(&handle.handle);
        Ok(())
    }
}

#[cfg(all(test, feature = "methods-optimizer-local"))]
mod tests {
    use std::path::PathBuf;
    use std::sync::atomic::AtomicU64;

    use serde_json::{json, Value};

    use super::*;
    use crate::bundle::{build_execution_bundle, ReplayPhaseRequest};
    use crate::controller_adapter::derive_host_controller_registry;
    use crate::data::{DataBinding, ExternalDataPlanEnvelope};
    use crate::graph::GraphSpec;
    use crate::plan::{build_execution_plan, CampaignSpec, ExecutionPlan};
    use crate::runtime::{
        BundleReplayExecution, DataMaterializationRequest, DataViewRequest, InMemoryArtifactStore,
        MethodsPlsData, MethodsPlsDataRequest, RunContext, RuntimeArtifactStore,
        SequentialScheduler,
    };
    use crate::training::TrainingDataIdentity;
    use crate::{BundleId, NodeId, RunId, SampleId};

    const ENVELOPE: &str =
        include_str!("../tests/fixtures/package/data/coordinator_data_plan_envelope_sample12.json");
    const SOURCE: &str = "exclude:outlier";

    #[test]
    fn feature_leases_release_only_the_last_owner_of_their_run() {
        let shared = Arc::new(SharedState {
            catalog: NativeCatalog(BTreeMap::new()),
            next_handle: AtomicU64::default(),
            features: Mutex::default(),
            run_leases: Mutex::default(),
            exported: Mutex::default(),
            hydrated: Mutex::default(),
        });
        let first_run = RunId::new("run:first").unwrap();
        let second_run = RunId::new("run:second").unwrap();
        let features = Arc::new(FeatureSet {
            fit: MethodsPlsDataset {
                y_validity_masks: None,
                sample_ids: vec![SampleId::new("a").unwrap()],
                x: MethodsPlsMatrix {
                    values: vec![1.0],
                    rows: 1,
                    cols: 1,
                },
                y: None,
                target_names: vec![],
            },
            prediction: None,
        });
        shared.features.lock().unwrap().extend([
            (1, (first_run.clone(), features.clone())),
            (2, (second_run.clone(), features)),
        ]);
        let owner = Arc::new(MethodsRunLease {
            shared: shared.clone(),
            run_id: first_run,
        });
        let clone = owner.clone();
        drop(owner);
        assert_eq!(shared.features.lock().unwrap().len(), 2);
        drop(clone);
        assert_eq!(
            shared
                .features
                .lock()
                .unwrap()
                .keys()
                .copied()
                .collect::<Vec<_>>(),
            [2]
        );
        let second = MethodsRunLease {
            shared: shared.clone(),
            run_id: second_run,
        };
        drop(second);
        assert!(shared.features.lock().unwrap().is_empty());
    }

    fn runtime() -> MethodsRuntime {
        let library = std::env::var_os("N4M_LIBRARY_PATH")
            .expect("native Methods estimator tests require N4M_LIBRARY_PATH");
        MethodsRuntime::configure(library).unwrap()
    }

    /// Shared N4ME fixture written by the n4m Python binding.
    fn fixture() -> Value {
        let path = std::env::var_os("N4M_ESTIMATOR_ROLES_FIXTURE")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(
                    "../../external/nirs4all-methods/parity/fixtures/estimator_roles_n4me.json",
                )
            });
        serde_json::from_str(&std::fs::read_to_string(path).expect("n4m roles fixture")).unwrap()
    }

    fn rows(value: &Value) -> Vec<Vec<f64>> {
        value
            .as_array()
            .unwrap()
            .iter()
            .map(|row| match row.as_array() {
                Some(row) => row.iter().map(|v| v.as_f64().unwrap()).collect(),
                None => vec![row.as_f64().unwrap()],
            })
            .collect()
    }

    fn base64(text: &str) -> Vec<u8> {
        let value = |byte: u8| match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => panic!("invalid base64"),
        };
        let digits = text.bytes().filter(|byte| *byte != b'=').map(value);
        let (mut out, mut buffer, mut bits) = (Vec::new(), 0u32, 0);
        for digit in digits {
            buffer = (buffer << 6) | u32::from(digit);
            bits += 6;
            if bits >= 8 {
                bits -= 8;
                out.push((buffer >> bits) as u8);
            }
        }
        out
    }

    fn close(actual: &[f64], expected: &[f64], tolerance: f64, label: &str) {
        assert_eq!(actual.len(), expected.len(), "{label}: length");
        for (index, (a, e)) in actual.iter().zip(expected).enumerate() {
            assert!(
                (a - e).abs() <= tolerance * (1.0 + e.abs()),
                "{label}[{index}]: {a} vs {e}"
            );
        }
    }

    fn sample(prefix: &str, index: usize) -> SampleId {
        SampleId::new(format!("sample:{prefix}{index:02}")).unwrap()
    }

    /// Provider-owned numeric rows keyed by sample identity.
    struct Provider {
        train: BTreeMap<SampleId, (Vec<f64>, f64)>,
        predict: Vec<(SampleId, Vec<f64>)>,
        next: AtomicU64,
    }

    impl Provider {
        fn new(x: &[Vec<f64>], y: &[f64], x_predict: &[Vec<f64>]) -> Self {
            Self {
                train: x
                    .iter()
                    .zip(y)
                    .enumerate()
                    .map(|(index, (row, y))| (sample("", index), (row.clone(), *y)))
                    .collect(),
                predict: x_predict
                    .iter()
                    .enumerate()
                    .map(|(index, row)| (sample("p", index), row.clone()))
                    .collect(),
                next: AtomicU64::new(0),
            }
        }

        fn handle(&self, kind: HandleKind) -> HandleRef {
            HandleRef {
                handle: self.next.fetch_add(1, Ordering::SeqCst) + 1,
                kind,
                owner_controller: ControllerId::new("controller:data.provider").unwrap(),
            }
        }

        fn dataset(&self, ids: &[SampleId]) -> MethodsPlsDataset {
            let rows = ids.iter().map(|id| &self.train[id]).collect::<Vec<_>>();
            MethodsPlsDataset {
                y_validity_masks: None,
                sample_ids: ids.to_vec(),
                x: MethodsPlsMatrix {
                    values: rows.iter().flat_map(|(x, _)| x.iter().copied()).collect(),
                    rows: rows.len(),
                    cols: rows[0].0.len(),
                },
                y: Some(MethodsPlsMatrix {
                    values: rows.iter().map(|(_, y)| *y).collect(),
                    rows: rows.len(),
                    cols: 1,
                }),
                target_names: vec!["y".to_string()],
            }
        }
    }

    impl RuntimeDataProvider for Provider {
        fn materialize(&self, _request: &DataMaterializationRequest) -> Result<HandleRef> {
            Ok(self.handle(HandleKind::Data))
        }

        fn make_view(&self, _request: &DataViewRequest) -> Result<HandleRef> {
            Ok(self.handle(HandleKind::DataView))
        }

        fn training_data_identity(
            &self,
            binding: &DataBinding,
        ) -> Result<Option<TrainingDataIdentity>> {
            let mut identity = TrainingDataIdentity {
                requirement_key: crate::data::data_binding_requirement_key(
                    &binding.node_id,
                    &binding.input_name,
                ),
                schema_fingerprint: "a".repeat(64),
                plan_fingerprint: "b".repeat(64),
                relation_fingerprint: "c".repeat(64),
                data_content_fingerprint: "d".repeat(64),
                target_content_fingerprint: "e".repeat(64),
                identity_fingerprint: String::new(),
            };
            identity.identity_fingerprint = identity.compute_fingerprint()?;
            Ok(Some(identity))
        }

        fn methods_pls_capability(&self) -> Result<()> {
            Ok(())
        }

        fn methods_pls_data(&self, request: &MethodsPlsDataRequest) -> Result<MethodsPlsData> {
            if request.phase == Phase::Predict {
                return Ok(MethodsPlsData {
                    fit: MethodsPlsDataset {
                        y_validity_masks: None,
                        sample_ids: self.predict.iter().map(|(id, _)| id.clone()).collect(),
                        x: MethodsPlsMatrix {
                            values: self.predict.iter().flat_map(|(_, x)| x.clone()).collect(),
                            rows: self.predict.len(),
                            cols: self.predict[0].1.len(),
                        },
                        y: None,
                        target_names: vec!["y".to_string()],
                    },
                    prediction: None,
                });
            }
            Ok(MethodsPlsData {
                fit: self.dataset(request.fit_view.sample_ids.as_ref().unwrap()),
                prediction: request
                    .prediction_view
                    .as_ref()
                    .map(|view| self.dataset(view.sample_ids.as_ref().unwrap())),
            })
        }
    }

    /// Replay store hydrating raw payloads through their owning controller.
    struct HydratingStore<'a> {
        controllers: &'a RuntimeControllerRegistry,
        payloads: &'a BTreeMap<ArtifactId, Vec<u8>>,
    }

    impl RuntimeArtifactStore for HydratingStore<'_> {
        fn materialize(&self, request: &ArtifactMaterializationRequest) -> Result<HandleRef> {
            self.controllers
                .get(&request.controller_id)
                .unwrap()
                .hydrate_artifact_payload(request, &self.payloads[&request.artifact.id])
        }
    }

    fn envelope() -> ExternalDataPlanEnvelope {
        serde_json::from_str(ENVELOPE).unwrap()
    }

    fn node(id: &str, kind: &str, method_id: &str, params: Value, output: Value) -> Value {
        let mut all = json!({"method_id": method_id});
        all.as_object_mut()
            .unwrap()
            .extend(params.as_object().unwrap().clone());
        json!({
            "id": id, "kind": kind, "operator": format!("n4m:{method_id}"), "params": all,
            "ports": {
                "inputs": [{"name": "x", "kind": "data", "representation": "tabular_numeric", "cardinality": "one", "description": ""}],
                "outputs": [output]
            },
            "metadata": {}, "seed_label": null
        })
    }

    fn data_edge(source: &str, target: &str) -> Value {
        json!({
            "source": {"node_id": source, "port_name": "x_out"},
            "target": {"node_id": target, "port_name": "x"},
            "contract": {"kind": "data", "representation": "tabular_numeric", "requires_oof": false, "requires_fold_alignment": true, "propagates_lineage": true}
        })
    }

    /// Plan of `nodes` resolved through the controllers derived from the live
    /// n4m manifest; the first node reads the attested data binding.
    fn plan(nodes: Vec<Value>, edges: Vec<Value>, folds: usize, n_samples: usize) -> ExecutionPlan {
        let runtime = runtime();
        let registry = derive_host_controller_registry(
            &methods_estimator_host_controller_specs(&runtime).unwrap(),
        )
        .unwrap();
        let source = nodes[0]["id"].as_str().unwrap().to_string();
        let graph: GraphSpec = serde_json::from_value(json!({
            "id": "graph:n4m.roles", "interface": {"inputs": [], "outputs": []},
            "nodes": nodes, "edges": edges, "search_space_fingerprint": null, "metadata": {}
        }))
        .unwrap();
        let envelope = envelope();
        let binding = json!({
            "node_id": source, "input_name": "x", "request_id": "nir-to-tabular",
            "schema_fingerprint": envelope.schema_fingerprint,
            "plan_fingerprint": envelope.plan_fingerprint,
            "relation_fingerprint": envelope.relation_fingerprint,
            "output_representation": "tabular_numeric", "feature_set_id": "x",
            "source_ids": ["nir"], "require_relations": false
        });
        let ids = (0..n_samples)
            .map(|index| sample("", index))
            .collect::<Vec<_>>();
        let fold_size = n_samples / folds;
        let fold_set = json!({
            "id": "outer",
            "sample_ids": ids,
            "folds": (0..folds).map(|fold| {
                let (validation, train): (Vec<_>, Vec<_>) = ids
                    .iter()
                    .enumerate()
                    .partition(|(index, _)| index / fold_size == fold);
                json!({
                    "fold_id": format!("fold:{fold}"),
                    "train_sample_ids": train.into_iter().map(|(_, id)| id).collect::<Vec<_>>(),
                    "validation_sample_ids": validation.into_iter().map(|(_, id)| id).collect::<Vec<_>>(),
                    "metadata": {}
                })
            }).collect::<Vec<_>>(),
            "sample_groups": {}
        });
        let campaign: CampaignSpec = serde_json::from_value(json!({
            "id": "campaign:n4m.roles", "root_seed": 7,
            "split_invocation": {"id": "split:outer", "controller_id": null, "params": {}, "fold_set": fold_set},
            "data_bindings": {source: [binding]}
        }))
        .unwrap();
        build_execution_plan("plan:n4m.roles", graph, campaign, &registry).unwrap()
    }

    fn controllers() -> RuntimeControllerRegistry {
        let mut registry = RuntimeControllerRegistry::new();
        register_methods_estimator_controllers(&mut registry, runtime()).unwrap();
        registry
    }

    #[test]
    fn models_bind_predictions_to_the_declared_output_port() {
        let fixture = fixture();
        let x = rows(&fixture["x_train"]);
        let predict = rows(&fixture["x_test"]);
        for (method, target) in [
            ("models.pls.cppls", "y_train"),
            ("models.classification.pls_logistic", "labels_train"),
        ] {
            let y = rows(&fixture[target]).concat();
            let provider = Provider::new(&x, &y, &predict);
            for port in ["oof", "y_hat"] {
                let plan = plan(
                    vec![node(
                        "model:port",
                        "model",
                        method,
                        json!({"n_components": 2}),
                        json!({"name": port, "kind": "prediction", "representation": null, "cardinality": "one", "description": ""}),
                    )],
                    Vec::new(),
                    3,
                    x.len(),
                );
                let mut ctx = RunContext::new(RunId::new("run:n4m.ports").unwrap(), Some(7));
                ctx.variant_id = Some(plan.variants[0].variant_id.clone());
                let results = SequentialScheduler
                    .execute_campaign_phase_with_data_provider(
                        &plan,
                        &controllers(),
                        &provider,
                        &mut ctx,
                        Phase::FitCv,
                    )
                    .unwrap();
                assert!(!results.is_empty());
                for result in results {
                    assert_eq!(
                        result
                            .outputs
                            .keys()
                            .map(String::as_str)
                            .collect::<Vec<_>>(),
                        vec![port]
                    );
                    assert!(!result.predictions.is_empty());
                    assert!(result
                        .predictions
                        .iter()
                        .all(|block| block.producer_port.as_deref() == Some(port)));
                    assert!(result
                        .classification_probabilities
                        .iter()
                        .all(|block| block.producer_port.as_deref() == Some(port)));
                }
            }
        }
    }

    /// PREDICT replay of `plan` from its REFIT records and raw N4ME payloads in
    /// a fresh controller registration (a new process for the native states).
    fn replay_predict(
        plan: &ExecutionPlan,
        records: Vec<crate::bundle::RefitArtifactRecord>,
        payloads: BTreeMap<ArtifactId, Vec<u8>>,
        provider: &Provider,
    ) -> Vec<PredictionBlock> {
        let mut bundle = build_execution_bundle(
            BundleId::new("bundle:n4m.roles").unwrap(),
            plan,
            Some(plan.variants[0].variant_id.clone()),
            BTreeMap::new(),
            records,
        )
        .unwrap();
        bundle.raw_artifact_payloads = payloads.clone();
        let key = crate::data::data_binding_requirement_key(
            &plan
                .node_plans
                .values()
                .find(|node| !node.data_bindings.is_empty())
                .unwrap()
                .node_id,
            "x",
        );
        let controllers = controllers();
        let mut ctx = RunContext::new(RunId::new("run:n4m.roles.predict").unwrap(), Some(7));
        SequentialScheduler
            .execute_bundle_replay(
                BundleReplayExecution {
                    plan,
                    bundle: &bundle,
                    replay_request: &ReplayPhaseRequest {
                        bundle_id: bundle.bundle_id.clone(),
                        phase: Phase::Predict,
                        data_envelope_keys: vec![key.clone()],
                    },
                    prediction_cache_store: None,
                    controllers: &controllers,
                    data_provider: provider,
                    artifact_store: &HydratingStore {
                        controllers: &controllers,
                        payloads: &payloads,
                    },
                    data_envelopes: &BTreeMap::from([(key, envelope())]),
                },
                &mut ctx,
            )
            .unwrap();
        ctx.prediction_store.blocks().to_vec()
    }

    /// Direct `n4m::roles` reference of the graph: outlier filter on the
    /// training rows, SNV, then CPPLS; returns predictions for `predict_rows`.
    struct Direct {
        context: Context,
        snv: Estimator,
        cppls: Estimator,
        kept: Vec<bool>,
    }

    impl Direct {
        fn fit(x: &[Vec<f64>], y: &[f64]) -> Self {
            let context = Context::new().unwrap();
            let flat = x.concat();
            let x_view = MatrixRef::row_major(&flat, x.len(), x[0].len()).unwrap();
            let y_view = MatrixRef::row_major(y, y.len(), 1).unwrap();
            let mut filter = Estimator::new(&context, "filters.y_outlier", None).unwrap();
            filter
                .fit(&context, &FitInputs::new(x_view).y(y_view))
                .unwrap();
            let kept = filter.apply_mask(&context, x_view, Some(y_view)).unwrap();
            let x_kept = x
                .iter()
                .zip(&kept)
                .filter(|(_, keep)| **keep)
                .flat_map(|(row, _)| row.clone())
                .collect::<Vec<_>>();
            let y_kept = y
                .iter()
                .zip(&kept)
                .filter(|(_, keep)| **keep)
                .map(|(y, _)| *y)
                .collect::<Vec<_>>();
            let n = y_kept.len();
            let x_kept_view = MatrixRef::row_major(&x_kept, n, x[0].len()).unwrap();
            let y_kept_view = MatrixRef::row_major(&y_kept, n, 1).unwrap();
            let mut snv = Estimator::new(&context, "preprocessing.scatter.snv", None).unwrap();
            snv.fit(&context, &FitInputs::new(x_kept_view).y(y_kept_view))
                .unwrap();
            let x_snv = snv.transform(&context, x_kept_view).unwrap();
            let mut params = Params::new(&context, "models.pls.cppls").unwrap();
            params.set_int("n_components", 3).unwrap();
            let mut cppls = Estimator::new(&context, "models.pls.cppls", Some(&params)).unwrap();
            cppls
                .fit(
                    &context,
                    &FitInputs::new(MatrixRef::row_major(&x_snv.data, n, x_snv.cols).unwrap())
                        .y(y_kept_view),
                )
                .unwrap();
            Self {
                context,
                snv,
                cppls,
                kept,
            }
        }

        fn predict(&self, x: &[Vec<f64>]) -> Vec<f64> {
            let flat = x.concat();
            let x_view = MatrixRef::row_major(&flat, x.len(), x[0].len()).unwrap();
            let x_snv = self.snv.transform(&self.context, x_view).unwrap();
            self.cppls
                .predict(
                    &self.context,
                    MatrixRef::row_major(&x_snv.data, x.len(), x_snv.cols).unwrap(),
                )
                .unwrap()
                .data
        }
    }

    fn block<'a>(
        blocks: &'a [PredictionBlock],
        partition: PredictionPartition,
        fold: Option<&str>,
    ) -> &'a PredictionBlock {
        node_block(blocks, "model:cppls", partition, fold)
    }

    fn node_block<'a>(
        blocks: &'a [PredictionBlock],
        producer: &str,
        partition: PredictionPartition,
        fold: Option<&str>,
    ) -> &'a PredictionBlock {
        blocks
            .iter()
            .find(|block| {
                block.producer_node.as_str() == producer
                    && block.partition == partition
                    && block.fold_id.as_ref().map(|id| id.as_str()) == fold
            })
            .unwrap()
    }

    #[test]
    fn live_manifest_derives_every_graph_role_and_registers_executable_roles() {
        let runtime = runtime();
        let specs = methods_estimator_host_controller_specs(&runtime).unwrap();
        let registry = derive_host_controller_registry(&specs).unwrap();
        for role in crate::n4m_roles::N4M_GRAPH_ROLES {
            let manifest = registry
                .get(&ControllerId::new(role.controller_id().unwrap()).unwrap())
                .unwrap();
            assert_eq!(Some(manifest.operator_kind.clone()), role.node_kind());
            let native = NativeCatalog::live()
                .unwrap()
                .0
                .values()
                .filter(|method| method.roles.contains(&role))
                .map(|method| format!("n4m:{}", method.method_id))
                .collect::<BTreeSet<_>>();
            assert_eq!(manifest.operator_selectors[0].refs, native);
        }
        let controllers = controllers();
        for role in METHODS_ESTIMATOR_EXECUTABLE_ROLES {
            assert!(controllers
                .get(&ControllerId::new(role.controller_id().unwrap()).unwrap())
                .is_some());
        }
    }

    #[test]
    fn exclude_snv_cppls_graph_matches_direct_roles_and_replays_n4me() {
        let fixture = fixture();
        let x = rows(&fixture["x_train"]);
        let mut y = rows(&fixture["y_train"]).concat();
        // One gross target outlier the IQR filter must drop from training.
        y[5] = 1.0e3;
        let x_predict = rows(&fixture["x_test"]);
        let provider = Provider::new(&x, &y, &x_predict);
        let plan = plan(
            vec![
                node(
                    SOURCE,
                    "exclude",
                    "filters.y_outlier",
                    json!({}),
                    json!({"name": "x_out", "kind": "data", "representation": "tabular_numeric", "cardinality": "one", "description": ""}),
                ),
                node(
                    "transform:snv",
                    "transform",
                    "preprocessing.scatter.snv",
                    json!({}),
                    json!({"name": "x_out", "kind": "data", "representation": "tabular_numeric", "cardinality": "one", "description": ""}),
                ),
                node(
                    "model:cppls",
                    "model",
                    "models.pls.cppls",
                    json!({"n_components": 3}),
                    json!({"name": "oof", "kind": "prediction", "representation": null, "cardinality": "one", "description": ""}),
                ),
            ],
            vec![
                data_edge(SOURCE, "transform:snv"),
                data_edge("transform:snv", "model:cppls"),
            ],
            3,
            x.len(),
        );
        assert_eq!(
            plan.node_plans[&NodeId::new(SOURCE).unwrap()]
                .controller_id
                .as_str(),
            "controller:n4m.sample_filter"
        );
        let controllers = controllers();
        let mut ctx = RunContext::new(RunId::new("run:n4m.roles").unwrap(), Some(7));
        ctx.variant_id = Some(plan.variants[0].variant_id.clone());
        let fit_cv = SequentialScheduler
            .execute_campaign_phase_with_data_provider(
                &plan,
                &controllers,
                &provider,
                &mut ctx,
                Phase::FitCv,
            )
            .unwrap();
        // Validation, Train and TrainPool surfaces, each with its targets.
        for result in fit_cv
            .iter()
            .filter(|result| result.node_id.as_str() == "model:cppls")
        {
            assert_eq!(result.predictions.len(), 3);
            assert_eq!(result.regression_targets.len(), 3);
        }
        let fold_set = plan.fold_set.as_ref().unwrap();
        let index = |id: &SampleId| {
            id.as_str()
                .trim_start_matches("sample:")
                .parse::<usize>()
                .unwrap()
        };
        for fold in &fold_set.folds {
            let train = fold.train_sample_ids.iter().map(index).collect::<Vec<_>>();
            let validation = fold
                .validation_sample_ids
                .iter()
                .map(index)
                .collect::<Vec<_>>();
            let direct = Direct::fit(
                &train.iter().map(|i| x[*i].clone()).collect::<Vec<_>>(),
                &train.iter().map(|i| y[*i]).collect::<Vec<_>>(),
            );
            let actual = block(
                ctx.prediction_store.blocks(),
                PredictionPartition::Validation,
                Some(fold.fold_id.as_str()),
            );
            assert_eq!(actual.sample_ids, fold.validation_sample_ids);
            close(
                &actual.values.concat(),
                &direct.predict(&validation.iter().map(|i| x[*i].clone()).collect::<Vec<_>>()),
                1e-9,
                fold.fold_id.as_str(),
            );
            // The in-fold surface holds the filtered training rows; the
            // report-only pool appends the validation rows.
            let kept = train
                .iter()
                .zip(&direct.kept)
                .filter(|(_, keep)| **keep)
                .map(|(i, _)| *i)
                .collect::<Vec<_>>();
            let pool = kept.iter().chain(&validation).copied().collect::<Vec<_>>();
            for (partition, expected) in [
                (PredictionPartition::Train, &kept),
                (PredictionPartition::TrainPool, &pool),
            ] {
                let actual = block(
                    ctx.prediction_store.blocks(),
                    partition.clone(),
                    Some(fold.fold_id.as_str()),
                );
                assert_eq!(
                    actual.sample_ids,
                    expected.iter().map(|i| sample("", *i)).collect::<Vec<_>>()
                );
                close(
                    &actual.values.concat(),
                    &direct.predict(&expected.iter().map(|i| x[*i].clone()).collect::<Vec<_>>()),
                    1e-9,
                    &format!("{partition:?} {}", fold.fold_id),
                );
            }
        }

        let mut store = InMemoryArtifactStore::new();
        let mut refit = RunContext::new(RunId::new("run:n4m.roles.refit").unwrap(), Some(7));
        refit.variant_id = Some(plan.variants[0].variant_id.clone());
        let refit_results = SequentialScheduler
            .execute_campaign_phase_with_data_provider_and_artifact_store(
                &plan,
                &controllers,
                &provider,
                &mut store,
                &mut refit,
                Phase::Refit,
            )
            .unwrap();
        // The Final surface is scored against its targets like a host model.
        let model_refit = refit_results
            .iter()
            .find(|result| result.node_id.as_str() == "model:cppls")
            .unwrap();
        assert_eq!(model_refit.regression_targets.len(), 1);
        let direct = Direct::fit(&x, &y);
        assert!(!direct.kept[5]);
        let final_block = block(
            refit.prediction_store.blocks(),
            PredictionPartition::Final,
            None,
        );
        let kept_ids = (0..x.len())
            .filter(|i| direct.kept[*i])
            .map(|i| sample("", i))
            .collect::<Vec<_>>();
        assert_eq!(final_block.sample_ids, kept_ids);
        let kept_x = (0..x.len())
            .filter(|i| direct.kept[*i])
            .map(|i| x[i].clone())
            .collect::<Vec<_>>();
        close(
            &final_block.values.concat(),
            &direct.predict(&kept_x),
            1e-9,
            "refit",
        );

        let records = store.refit_artifacts();
        assert_eq!(
            records
                .iter()
                .map(|record| (record.node_id.as_str(), record.controller_id.as_str()))
                .collect::<BTreeSet<_>>(),
            BTreeSet::from([
                ("model:cppls", "controller:n4m.regressor"),
                ("transform:snv", "controller:n4m.transformer"),
            ])
        );
        let mut payloads = BTreeMap::new();
        for record in &records {
            let controller = controllers.get(&record.controller_id).unwrap();
            let payload = controller
                .export_artifact_payload(&record.artifact.id)
                .unwrap()
                .unwrap();
            assert!(controller
                .export_artifact_payload(&record.artifact.id)
                .unwrap()
                .is_none());
            let descriptor = record
                .artifact
                .native_estimator_descriptor
                .as_ref()
                .unwrap();
            assert_eq!(record.artifact.kind, NATIVE_ESTIMATOR_ARTIFACT_KIND);
            assert_eq!(descriptor.format, "N4ME");
            assert_eq!(
                descriptor,
                &inspect_methods_native_estimator_descriptor_v1(&record.controller_id, &payload)
                    .unwrap()
            );
            payloads.insert(record.artifact.id.clone(), payload);
        }
        let cppls = records
            .iter()
            .find(|record| record.node_id.as_str() == "model:cppls")
            .unwrap();
        let descriptor = cppls.artifact.native_estimator_descriptor.as_ref().unwrap();
        assert_eq!(descriptor.method_id, "models.pls.cppls");
        assert_eq!(descriptor.roles, vec![N4mRole::Regressor]);
        assert!(descriptor.capabilities.contains(&"predict".to_string()));
        let context = Context::new().unwrap();
        let reloaded = Estimator::from_n4me(&context, &payloads[&cppls.artifact.id]).unwrap();
        let snv = records
            .iter()
            .find(|record| record.node_id.as_str() == "transform:snv")
            .unwrap();
        let snv_reloaded = Estimator::from_n4me(&context, &payloads[&snv.artifact.id]).unwrap();
        let flat = x_predict.concat();
        let x_snv = snv_reloaded
            .transform(
                &context,
                MatrixRef::row_major(&flat, x_predict.len(), x_predict[0].len()).unwrap(),
            )
            .unwrap();
        close(
            &reloaded
                .predict(
                    &context,
                    MatrixRef::row_major(&x_snv.data, x_predict.len(), x_snv.cols).unwrap(),
                )
                .unwrap()
                .data,
            &direct.predict(&x_predict),
            1e-12,
            "n4me round trip",
        );

        let predictions = replay_predict(&plan, records, payloads, &provider);
        let predicted = block(&predictions, PredictionPartition::Final, None);
        assert_eq!(
            predicted.sample_ids,
            (0..x_predict.len())
                .map(|i| sample("p", i))
                .collect::<Vec<_>>()
        );
        close(
            &predicted.values.concat(),
            &direct.predict(&x_predict),
            1e-12,
            "replayed predict",
        );
    }

    /// Direct `n4m::roles` reference of SNV then a PLS-logistic classifier.
    struct DirectClassifier {
        context: Context,
        snv: Estimator,
        classifier: Estimator,
    }

    impl DirectClassifier {
        fn fit(x: &[Vec<f64>], labels: &[i64]) -> Self {
            let context = Context::new().unwrap();
            let flat = x.concat();
            let x_view = MatrixRef::row_major(&flat, x.len(), x[0].len()).unwrap();
            let mut snv = Estimator::new(&context, "preprocessing.scatter.snv", None).unwrap();
            snv.fit(&context, &FitInputs::new(x_view)).unwrap();
            let x_snv = snv.transform(&context, x_view).unwrap();
            let mut params = Params::new(&context, "models.classification.pls_logistic").unwrap();
            params.set_int("n_components", 2).unwrap();
            let mut classifier = Estimator::new(
                &context,
                "models.classification.pls_logistic",
                Some(&params),
            )
            .unwrap();
            classifier
                .fit(
                    &context,
                    &FitInputs::new(
                        MatrixRef::row_major(&x_snv.data, x.len(), x_snv.cols).unwrap(),
                    )
                    .labels(labels),
                )
                .unwrap();
            Self {
                context,
                snv,
                classifier,
            }
        }

        fn features(&self, x: &[Vec<f64>]) -> n4m::Matrix {
            let flat = x.concat();
            self.snv
                .transform(
                    &self.context,
                    MatrixRef::row_major(&flat, x.len(), x[0].len()).unwrap(),
                )
                .unwrap()
        }

        fn labels(&self, x: &[Vec<f64>]) -> Vec<f64> {
            let features = self.features(x);
            self.classifier
                .predict_labels(
                    &self.context,
                    MatrixRef::row_major(&features.data, x.len(), features.cols).unwrap(),
                )
                .unwrap()
                .into_iter()
                .map(|label| label as f64)
                .collect()
        }

        fn probabilities(&self, x: &[Vec<f64>]) -> Vec<f64> {
            let features = self.features(x);
            self.classifier
                .predict_proba(
                    &self.context,
                    MatrixRef::row_major(&features.data, x.len(), features.cols).unwrap(),
                )
                .unwrap()
                .data
        }
    }

    #[test]
    fn classifier_graph_matches_direct_roles_and_replays_class_labels() {
        let fixture = fixture();
        let x = rows(&fixture["x_train"]);
        // Non-contiguous class ids cross the ABI unchanged.
        let labels = rows(&fixture["labels_train"]).concat();
        let class_ids = labels.iter().map(|label| *label as i64).collect::<Vec<_>>();
        let x_predict = rows(&fixture["x_test"]);
        let provider = Provider::new(&x, &labels, &x_predict);
        let data_port = json!({"name": "x_out", "kind": "data", "representation": "tabular_numeric", "cardinality": "one", "description": ""});
        let oof_port = json!({"name": "oof", "kind": "prediction", "representation": null, "cardinality": "one", "description": ""});
        let plan = plan(
            vec![
                node(
                    "transform:snv",
                    "transform",
                    "preprocessing.scatter.snv",
                    json!({}),
                    data_port,
                ),
                node(
                    "model:logistic",
                    "model",
                    "models.classification.pls_logistic",
                    json!({"n_components": 2}),
                    oof_port,
                ),
            ],
            vec![data_edge("transform:snv", "model:logistic")],
            3,
            x.len(),
        );
        assert_eq!(
            plan.node_plans[&NodeId::new("model:logistic").unwrap()]
                .controller_id
                .as_str(),
            "controller:n4m.classifier"
        );
        let controllers = controllers();
        let mut ctx = RunContext::new(RunId::new("run:n4m.classifier").unwrap(), Some(7));
        ctx.variant_id = Some(plan.variants[0].variant_id.clone());
        let fit_cv = SequentialScheduler
            .execute_campaign_phase_with_data_provider(
                &plan,
                &controllers,
                &provider,
                &mut ctx,
                Phase::FitCv,
            )
            .unwrap();
        let index = |id: &SampleId| {
            id.as_str()
                .trim_start_matches("sample:")
                .parse::<usize>()
                .unwrap()
        };
        let select = |ids: &[usize]| ids.iter().map(|i| x[*i].clone()).collect::<Vec<_>>();
        for fold in &plan.fold_set.as_ref().unwrap().folds {
            let train = fold.train_sample_ids.iter().map(index).collect::<Vec<_>>();
            let validation = fold
                .validation_sample_ids
                .iter()
                .map(index)
                .collect::<Vec<_>>();
            let pool = train.iter().chain(&validation).copied().collect::<Vec<_>>();
            let direct = DirectClassifier::fit(
                &select(&train),
                &train.iter().map(|i| class_ids[*i]).collect::<Vec<_>>(),
            );
            let fold_id = Some(fold.fold_id.as_str());
            for (partition, expected) in [
                (PredictionPartition::Validation, &validation),
                (PredictionPartition::Train, &train),
                (PredictionPartition::TrainPool, &pool),
            ] {
                let actual = node_block(
                    ctx.prediction_store.blocks(),
                    "model:logistic",
                    partition,
                    fold_id,
                );
                assert_eq!(actual.values.concat(), direct.labels(&select(expected)));
            }
            // Validation probabilities also attest class-aware repeated-CV reduction.
            let result = fit_cv
                .iter()
                .find(|result| {
                    result.node_id.as_str() == "model:logistic"
                        && result.lineage.fold_id.as_ref().map(|id| id.as_str()) == fold_id
                })
                .unwrap();
            assert_eq!(
                result
                    .classification_probabilities
                    .iter()
                    .map(|block| block.partition.clone())
                    .collect::<Vec<_>>(),
                vec![
                    PredictionPartition::Validation,
                    PredictionPartition::Train,
                    PredictionPartition::TrainPool
                ]
            );
            for (block, expected) in
                result
                    .classification_probabilities
                    .iter()
                    .zip([&validation, &train, &pool])
            {
                assert_eq!(block.class_labels, vec![10.0, 20.0, 30.0]);
                close(
                    &block.values.concat(),
                    &direct.probabilities(&select(expected)),
                    1e-12,
                    "probabilities",
                );
            }
            assert_eq!(result.regression_targets.len(), 3);
        }

        let mut store = InMemoryArtifactStore::new();
        let mut refit = RunContext::new(RunId::new("run:n4m.classifier.refit").unwrap(), Some(7));
        refit.variant_id = Some(plan.variants[0].variant_id.clone());
        SequentialScheduler
            .execute_campaign_phase_with_data_provider_and_artifact_store(
                &plan,
                &controllers,
                &provider,
                &mut store,
                &mut refit,
                Phase::Refit,
            )
            .unwrap();
        let direct = DirectClassifier::fit(&x, &class_ids);
        let final_block = node_block(
            refit.prediction_store.blocks(),
            "model:logistic",
            PredictionPartition::Final,
            None,
        );
        assert_eq!(final_block.values.concat(), direct.labels(&x));
        let records = store.refit_artifacts();
        let mut payloads = BTreeMap::new();
        for record in &records {
            let payload = controllers
                .get(&record.controller_id)
                .unwrap()
                .export_artifact_payload(&record.artifact.id)
                .unwrap()
                .unwrap();
            payloads.insert(record.artifact.id.clone(), payload);
        }
        let classifier = records
            .iter()
            .find(|record| record.node_id.as_str() == "model:logistic")
            .unwrap();
        assert_eq!(
            classifier.artifact.id.as_str(),
            format!(
                "artifact:n4m:model:logistic:{}:refit",
                plan.variants[0].variant_id
            )
        );
        let descriptor = classifier
            .artifact
            .native_estimator_descriptor
            .as_ref()
            .unwrap();
        assert_eq!(descriptor.roles, vec![N4mRole::Classifier]);
        assert!(descriptor
            .capabilities
            .contains(&"predict_labels".to_string()));

        let predictions = replay_predict(&plan, records, payloads, &provider);
        let predicted = node_block(
            &predictions,
            "model:logistic",
            PredictionPartition::Final,
            None,
        );
        assert_eq!(predicted.values.concat(), direct.labels(&x_predict));
    }

    /// A seeded method runs natively with its seed unset (ABI 2.14 publishes
    /// such seeds as optional, `"default": null`) and with an explicit seed,
    /// and its REFIT state replays to the direct reference.
    #[test]
    fn seeded_method_runs_with_and_without_explicit_seed() {
        let fixture = fixture();
        let x = rows(&fixture["x_train"]);
        let y = rows(&fixture["y_train"]).concat();
        let x_predict = rows(&fixture["x_test"]);
        let provider = Provider::new(&x, &y, &x_predict);
        for params in [
            json!({"n_estimators": 5}),
            json!({"n_estimators": 5, "seed": 3}),
        ] {
            let plan = plan(
                vec![node(
                    "model:bagging",
                    "model",
                    "models.ensembles.bagging_pls",
                    params.clone(),
                    json!({"name": "oof", "kind": "prediction", "representation": null, "cardinality": "one", "description": ""}),
                )],
                Vec::new(),
                3,
                x.len(),
            );
            let controllers = controllers();
            let mut store = InMemoryArtifactStore::new();
            let mut ctx = RunContext::new(RunId::new("run:n4m.seeded").unwrap(), Some(7));
            ctx.variant_id = Some(plan.variants[0].variant_id.clone());
            SequentialScheduler
                .execute_campaign_phase_with_data_provider_and_artifact_store(
                    &plan,
                    &controllers,
                    &provider,
                    &mut store,
                    &mut ctx,
                    Phase::Refit,
                )
                .unwrap();
            let context = Context::new().unwrap();
            let mut native = Params::new(&context, "models.ensembles.bagging_pls").unwrap();
            native.set_int("n_estimators", 5).unwrap();
            if let Some(seed) = params.get("seed").and_then(Value::as_i64) {
                native.set_int("seed", seed).unwrap();
            }
            let mut direct =
                Estimator::new(&context, "models.ensembles.bagging_pls", Some(&native)).unwrap();
            let flat = x.concat();
            direct
                .fit(
                    &context,
                    &FitInputs::new(MatrixRef::row_major(&flat, x.len(), x[0].len()).unwrap())
                        .y(MatrixRef::row_major(&y, y.len(), 1).unwrap()),
                )
                .unwrap();
            let records = store.refit_artifacts();
            let payloads = records
                .iter()
                .map(|record| {
                    let payload = controllers
                        .get(&record.controller_id)
                        .unwrap()
                        .export_artifact_payload(&record.artifact.id)
                        .unwrap()
                        .unwrap();
                    (record.artifact.id.clone(), payload)
                })
                .collect();
            let predicted = replay_predict(&plan, records, payloads, &provider);
            let flat_predict = x_predict.concat();
            close(
                &node_block(
                    &predicted,
                    "model:bagging",
                    PredictionPartition::Final,
                    None,
                )
                .values
                .concat(),
                &direct
                    .predict(
                        &context,
                        MatrixRef::row_major(&flat_predict, x_predict.len(), x_predict[0].len())
                            .unwrap(),
                    )
                    .unwrap()
                    .data,
                1e-12,
                &format!("bagging {params}"),
            );
        }
    }

    #[test]
    fn classifier_refuses_non_integral_class_ids() {
        let fixture = fixture();
        let x = rows(&fixture["x_train"]);
        let mut labels = rows(&fixture["labels_train"]).concat();
        labels[0] = 10.5;
        let provider = Provider::new(&x, &labels, &rows(&fixture["x_test"]));
        let plan = plan(
            vec![node(
                "model:logistic",
                "model",
                "models.classification.pls_logistic",
                json!({"n_components": 2}),
                json!({"name": "oof", "kind": "prediction", "representation": null, "cardinality": "one", "description": ""}),
            )],
            Vec::new(),
            3,
            x.len(),
        );
        let mut ctx = RunContext::new(RunId::new("run:n4m.labels").unwrap(), Some(7));
        ctx.variant_id = Some(plan.variants[0].variant_id.clone());
        let error = SequentialScheduler
            .execute_campaign_phase_with_data_provider(
                &plan,
                &controllers(),
                &provider,
                &mut ctx,
                Phase::FitCv,
            )
            .unwrap_err()
            .to_string();
        assert!(error.contains("integral class ids"), "{error}");
    }

    /// PREDICT replay of the Python-written CPPLS N4ME (default parameters)
    /// through a one-node plan whose node sets `params`.
    fn python_cppls_replay(params: Value) -> (Vec<f64>, Vec<f64>) {
        let fixture = fixture();
        let case = fixture["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|case| case["method_id"] == "models.pls.cppls")
            .unwrap();
        assert!(case["params"].as_object().unwrap().is_empty());
        let x = rows(&fixture["x_train"]);
        let y = rows(&fixture["y_train"]).concat();
        let provider = Provider::new(&x, &y, &rows(&fixture["x_test"]));
        let plan = plan(
            vec![node(
                "model:cppls",
                "model",
                "models.pls.cppls",
                params,
                json!({"name": "oof", "kind": "prediction", "representation": null, "cardinality": "one", "description": ""}),
            )],
            Vec::new(),
            3,
            x.len(),
        );
        let node = &plan.node_plans[&NodeId::new("model:cppls").unwrap()];
        let payload = base64(case["n4me_base64"].as_str().unwrap());
        let descriptor =
            inspect_methods_native_estimator_descriptor_v1(&node.controller_id, &payload).unwrap();
        let artifact = ArtifactRef {
            id: ArtifactId::new("artifact:n4m:model:cppls:python").unwrap(),
            kind: NATIVE_ESTIMATOR_ARTIFACT_KIND.to_string(),
            controller_id: node.controller_id.clone(),
            backend: Some(ArtifactBackend::Raw),
            uri: Some("methods/model_cppls.n4me".to_string()),
            content_fingerprint: Some(descriptor.artifact_sha256.clone()),
            size_bytes: Some(payload.len() as u64),
            plugin: None,
            plugin_version: None,
            abi_major: Some(METHODS_ABI_MAJOR),
            abi_min_minor: Some(METHODS_N4ME_MIN_ABI_MINOR),
            native_predictor_descriptor: None,
            native_estimator_descriptor: Some(descriptor),
        };
        let record = crate::bundle::RefitArtifactRecord {
            node_id: node.node_id.clone(),
            controller_id: node.controller_id.clone(),
            artifact: artifact.clone(),
            params_fingerprint: node.params_fingerprint.clone(),
            training_loss_fingerprint: None,
            data_requirement_keys: vec!["model:cppls.x".to_string()],
            prediction_requirement_keys: Vec::new(),
        };
        let predictions = replay_predict(
            &plan,
            vec![record],
            BTreeMap::from([(artifact.id, payload)]),
            &provider,
        );
        (
            block(&predictions, PredictionPartition::Final, None)
                .values
                .concat(),
            rows(&case["predict"]).concat(),
        )
    }

    #[test]
    fn python_trained_n4me_replays_through_controller_predict() {
        let (actual, expected) = python_cppls_replay(json!({}));
        close(&actual, &expected, 1e-12, "python n4me");
    }

    #[test]
    fn training_row_states_and_mismatched_replays_are_refused() {
        let fixture = fixture();
        let x = rows(&fixture["x_train"]);
        let y = rows(&fixture["y_train"]).concat();
        let provider = Provider::new(&x, &y, &rows(&fixture["x_test"]));
        let output = json!({"name": "oof", "kind": "prediction", "representation": null, "cardinality": "one", "description": ""});
        let kernel = |params| {
            plan(
                vec![node(
                    "model:kernel",
                    "model",
                    "models.pls.kernel",
                    params,
                    output.clone(),
                )],
                Vec::new(),
                3,
                x.len(),
            )
        };
        let run = |plan: &ExecutionPlan, phase| {
            let mut ctx = RunContext::new(RunId::new("run:n4m.kernel").unwrap(), Some(7));
            ctx.variant_id = Some(plan.variants[0].variant_id.clone());
            let mut store = InMemoryArtifactStore::new();
            SequentialScheduler
                .execute_campaign_phase_with_data_provider_and_artifact_store(
                    plan,
                    &controllers(),
                    &provider,
                    &mut store,
                    &mut ctx,
                    phase,
                )
                .map(|_| (store, ctx))
        };
        let refused = run(&kernel(json!({})), Phase::FitCv)
            .err()
            .unwrap()
            .to_string();
        assert!(
            refused.contains(METHODS_ESTIMATOR_ALLOW_TRAINING_ROWS),
            "{refused}"
        );
        let unknown = run(
            &kernel(json!({"unsafe_flags": ["allow_everything"]})),
            Phase::FitCv,
        )
        .err()
        .unwrap()
        .to_string();
        assert!(unknown.contains("unknown unsafe flag"), "{unknown}");
        let (store, ctx) = run(
            &kernel(json!({"unsafe_flags": [METHODS_ESTIMATOR_ALLOW_TRAINING_ROWS]})),
            Phase::Refit,
        )
        .unwrap();
        assert_eq!(store.refit_artifacts().len(), 1);
        assert!(ctx.lineage.records().any(|record| record
            .unsafe_flags
            .contains(METHODS_ESTIMATOR_ALLOW_TRAINING_ROWS)));

        // The operator routes to the regressor controller; the node's method
        // is only a transformer, which that controller refuses.
        let mut transformer = node(
            "model:cppls",
            "model",
            "models.pls.cppls",
            json!({}),
            output.clone(),
        );
        transformer["params"]["method_id"] = json!("preprocessing.scatter.snv");
        let wrong_role = run(
            &plan(vec![transformer], Vec::new(), 3, x.len()),
            Phase::FitCv,
        )
        .err()
        .unwrap()
        .to_string();
        assert!(
            wrong_role.contains("is not a regressor estimator"),
            "{wrong_role}"
        );
        let cppls = |n_components: Value| {
            plan(
                vec![node(
                    "model:cppls",
                    "model",
                    "models.pls.cppls",
                    json!({"n_components": n_components}),
                    output.clone(),
                )],
                Vec::new(),
                3,
                x.len(),
            )
        };
        for inexact in [json!("two"), json!(2.5)] {
            let wrong_type = run(&cppls(inexact), Phase::FitCv)
                .err()
                .unwrap()
                .to_string();
            assert!(wrong_type.contains("n_components"), "{wrong_type}");
        }
        // A generator's integral binary64 value is an exact int.
        assert!(run(&cppls(json!(3.0)), Phase::FitCv).is_ok());

        let mismatch = std::panic::catch_unwind(|| python_cppls_replay(json!({"n_components": 3})))
            .err()
            .unwrap();
        let message = mismatch
            .downcast_ref::<String>()
            .cloned()
            .unwrap_or_default();
        assert!(message.contains("does not match node method"), "{message}");
    }
}

#[cfg(all(test, feature = "methods-optimizer"))]
mod mask_contract_tests {
    use super::*;
    use crate::SampleId;

    #[test]
    fn target_projection_and_observed_row_selection_preserve_identity_and_masks() {
        let rows = MethodsPlsDataset {
            sample_ids: (0..3)
                .map(|i| SampleId::new(format!("s{i}")).unwrap())
                .collect(),
            x: MethodsPlsMatrix {
                rows: 3,
                cols: 1,
                values: vec![10., 20., 30.],
            },
            y: Some(MethodsPlsMatrix {
                rows: 3,
                cols: 2,
                values: vec![1., 11., 2., 0., 0., 13.],
            }),
            target_names: vec!["protein".into(), "moisture".into()],
            y_validity_masks: Some(vec![vec![true, true], vec![true, false], vec![false, true]]),
        };
        rows.validate("fixture", true).unwrap();
        let projected = target_column(&rows, 1).unwrap();
        assert_eq!(projected.target_names, vec!["moisture"]);
        assert_eq!(projected.y.as_ref().unwrap().values, vec![11., 0., 13.]);
        assert_eq!(
            projected.y_validity_masks,
            Some(vec![vec![true], vec![false], vec![true]])
        );
        let observed = keep_rows(&projected, &[true, false, true]);
        assert_eq!(
            observed.sample_ids,
            vec![rows.sample_ids[0].clone(), rows.sample_ids[2].clone()]
        );
        assert_eq!(observed.x.values, vec![10., 30.]);
        assert_eq!(observed.y.unwrap().values, vec![11., 13.]);
        assert!(target_column(&rows, 2).is_err());
        let mut malformed = rows.clone();
        malformed.y_validity_masks = Some(vec![vec![true]; 3]);
        assert!(malformed.validate("fixture", true).is_err());
        malformed.y_validity_masks = Some(vec![vec![true, true]; 2]);
        assert!(malformed.validate("fixture", true).is_err());
        malformed.y = None;
        assert!(malformed.validate("fixture", false).is_err());
    }
}
