//! Rust surface for the nirs4all-core aggregate distribution.
//!
//! This crate intentionally starts as a registry and namespace layer. Runtime
//! functionality must delegate to the owning upstream crates.

#[cfg(test)]
use std::cell::Cell;
use std::cmp::Ordering;
use std::ffi::CStr;
use std::os::raw::{c_char, c_double, c_int, c_void};
use std::path::Path;
use std::ptr;

use libloading::{Library, Symbol};
use serde_json::Value;

mod archive_v1;
pub(crate) mod archive_v2;
mod archive_v3;
mod archive_view;
mod durability;
mod formats_io;
mod io_training;
mod native_methods_replay;
mod portable_session;
pub use archive_v1::{
    load_archive_v1, write_archive_v1, ArchivePayload, ArchiveReference, ArchiveStoreError,
    ArchiveV1WriteRequest, LoadedArchiveV1,
};
pub use archive_v2::{
    load_archive, load_archive_v2, load_archive_v2_bytes, write_archive_v2,
    ArchiveV2MethodsArtifact, ArchiveV2Reference, ArchiveV2WriteRequest, LoadedArchive,
    LoadedArchiveV2,
};
pub use archive_v3::{
    load_archive_v3, write_archive_v3, ArchiveV3Reference, ArchiveV3WriteRequest, LoadedArchiveV3,
};
pub use archive_view::{
    archive_v2_view, archive_view, ArchivePayloadView, ArchiveReplayExecutionStatus,
    ArchiveReplayView, ArchiveView, ArchiveViewError,
};
pub use dag_ml_core::NativePredictorDescriptorV1;
pub use formats_io::{
    load_spectrum_dataset_package, load_spectrum_methods_provider, FormatsIoError,
    LoadedSpectrumDataset,
};
pub use io_training::{
    canonical_pls_training_request, train_dataset_package_methods_archive_v2,
    train_dataset_package_methods_conformal_archive_v2, CanonicalPlsProfile, DatasetPackage,
    DatasetPackageMethodsArchiveV2Outcome, DatasetPackageMethodsArchiveV2Request,
    DatasetPackageMethodsConformalArchiveV2Outcome, DatasetPackageMethodsConformalArchiveV2Request,
    DatasetPackageMethodsProvider,
};
pub use native_methods_replay::{
    inspect_methods_archive_v2_predictors, inspect_methods_archive_v2_predictors_json,
    load_methods_archive_v2_conformal_presentation_v2, predict_methods_archive_v2_matrix,
    predict_methods_archive_v2_matrix_conformal_presentation_v2,
    predict_methods_archive_v2_matrix_json, preflight_methods_archive_v2_library,
    replay_methods_archive_v2, replay_methods_archive_v2_conformal_presentation_v1,
    replay_methods_archive_v2_conformal_presentation_v1_json,
    replay_methods_archive_v2_conformal_presentation_v2,
    replay_methods_archive_v2_conformal_presentation_v2_json, replay_methods_archive_v2_json,
    replay_methods_archive_v3, replay_methods_archive_v3_json,
    MethodsArchiveMatrixPredictJsonRequest, MethodsArchiveMatrixPredictRequest,
    MethodsArchivePredictRequest, MethodsArchiveRefitRequestV3, MethodsArchiveReplayJsonRequest,
    NativeMethodsReplayError,
};
pub use portable_session::{
    PortableSession, PortableSessionError, PortableSessionState, PORTABLE_SESSION_EXPORT_SCHEMA,
    PORTABLE_SESSION_EXPORT_SCHEMA_V2,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Upstream {
    pub key: &'static str,
    pub package: &'static str,
    pub role: &'static str,
}

pub const UPSTREAMS: &[Upstream] = &[
    Upstream {
        key: "dag_ml",
        package: "dag-ml",
        role: "Leakage-safe DAG/ML execution coordinator",
    },
    Upstream {
        key: "dag_ml_data",
        package: "dag-ml-data",
        role: "Sample-aligned data contracts for DAG/ML runtimes",
    },
    Upstream {
        key: "formats",
        package: "nirs4all-formats",
        role: "Spectroscopy/NIRS vendor file readers",
    },
    Upstream {
        key: "io",
        package: "nirs4all-io",
        role: "Dataset assembly bridge",
    },
    Upstream {
        key: "datasets",
        package: "nirs4all-datasets",
        role: "DOI-pinned NIRS dataset catalog",
    },
    Upstream {
        key: "methods",
        package: "nirs4all-methods",
        role: "Portable C ABI PLS/NIRS numerical engine",
    },
];

pub const PORTABLE_OPERATOR_CLASSES: &[&str] = &[
    "nirs4all.operators.splitters.KennardStoneSplitter",
    "nirs4all.operators.splitters.splitters.KennardStoneSplitter",
    "nirs4all.operators.transforms.SNV",
    "nirs4all.operators.transforms.StandardNormalVariate",
    "nirs4all.operators.transforms.scalers.StandardNormalVariate",
    "nirs4all.operators.transforms.SavitzkyGolay",
    "nirs4all.operators.transforms.nirs.SavitzkyGolay",
    "sklearn.cross_decomposition.PLSRegression",
    "sklearn.cross_decomposition._pls.PLSRegression",
];

pub const RUNTIME_SURFACES: &[&str] = &["python", "r", "javascript_wasm", "rust", "matlab_octave"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RuntimeContract {
    pub surface: &'static str,
    pub pipeline_execution: &'static str,
    pub pipeline_entrypoint: &'static str,
    pub serialized_model_predict: bool,
    pub predict_entrypoint: Option<&'static str>,
}

pub const RUNTIME_CONTRACTS: &[RuntimeContract] = &[
    RuntimeContract {
        surface: "python",
        pipeline_execution: "parity-validated",
        pipeline_entrypoint: "run_portable_pipeline",
        serialized_model_predict: false,
        predict_entrypoint: None,
    },
    RuntimeContract {
        surface: "r",
        pipeline_execution: "parity-validated",
        pipeline_entrypoint: "nirs4all_run_portable_pipeline",
        serialized_model_predict: false,
        predict_entrypoint: None,
    },
    RuntimeContract {
        surface: "javascript_wasm",
        pipeline_execution: "parity-validated",
        pipeline_entrypoint: "runPortablePipeline",
        serialized_model_predict: true,
        predict_entrypoint: Some("predictPortablePipeline"),
    },
    RuntimeContract {
        surface: "rust",
        pipeline_execution: "parity-validated",
        pipeline_entrypoint: "run_portable_pipeline_with_library",
        serialized_model_predict: true,
        predict_entrypoint: Some("predict_exported_portable_model_with_library"),
    },
    RuntimeContract {
        surface: "matlab_octave",
        pipeline_execution: "parity-validated",
        pipeline_entrypoint: "runPortablePipeline",
        serialized_model_predict: false,
        predict_entrypoint: None,
    },
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ArtifactContract {
    pub id: &'static str,
    pub schema: &'static str,
    pub producer: &'static str,
    pub python_surface: &'static str,
    pub portable_claim: &'static str,
    pub optional_payload_fields: &'static [&'static str],
    pub required_registry_entries: &'static [&'static str],
    pub published_constants: &'static [(&'static str, &'static [&'static str])],
}

pub const REQUIRED_KEYWORD_REGISTRY_ENTRIES: &[&str] = &[
    "run.tuning",
    "run.tuning.engine",
    "run.tuning.space",
    "run.tuning.force_params",
    "run.tuning.score_data",
    "run.tuning.score_data.conformal_calibration",
    "predict.coverage",
    "predict.all_predictions",
    "robustness.scenarios.kind",
    "robustness.scenarios.severity",
    "robustness.scenarios.distribution",
    "robustness.X",
    "robustness.predictor",
    "robustness.predictor_bundle",
];

pub const ROBUSTNESS_SCENARIO_DISTRIBUTIONS: &[&str] = &["normal", "uniform"];

pub const PUBLISHED_KEYWORD_CONSTANTS: &[(&str, &[&str])] = &[(
    "ROBUSTNESS_SCENARIO_DISTRIBUTIONS",
    ROBUSTNESS_SCENARIO_DISTRIBUTIONS,
)];

pub const ARTIFACT_CONTRACTS: &[ArtifactContract] = &[
    ArtifactContract {
        id: "conformal.calibrated_result",
        schema: "nirs4all.dagml.conformal_store.v1",
        producer: "full-python-nirs4all",
        python_surface:
            "nirs4all.calibrate / nirs4all.predict_calibrated / nirs4all.load_calibrated_result",
        portable_claim: "not-exposed-in-nirs4all-core",
        optional_payload_fields: &[
            "conformal_guarantee_status",
            "calibration_replay_source",
            "tuning_calibration_source",
        ],
        required_registry_entries: &[],
        published_constants: &[],
    },
    ArtifactContract {
        id: "robustness.summary",
        schema: "https://nirs4all.org/schemas/robustness-summary/v1",
        producer: "full-python-nirs4all",
        python_surface:
            "nirs4all.RobustnessReport.summary_artifact / nirs4all.robustness_summary_schema_json",
        portable_claim: "summary-json-contract-only",
        optional_payload_fields: &["conformal_guarantee_status", "spectral_replay"],
        required_registry_entries: &[],
        published_constants: &[],
    },
    ArtifactContract {
        id: "tuning.summary",
        schema: "https://nirs4all.org/schemas/tuning-summary/v1",
        producer: "full-python-nirs4all",
        python_surface: "nirs4all.TuningResult.summary_artifact / nirs4all.tuning_summary_schema_json",
        portable_claim: "summary-json-contract-only",
        optional_payload_fields: &["sampler", "pruner", "seed", "persistence", "trials[*].diagnostics"],
        required_registry_entries: &[],
        published_constants: &[],
    },
    ArtifactContract {
        id: "tuning.ordered_search_space",
        schema: "https://nirs4all.org/schemas/tuning-ordered-search-space/v1",
        producer: "full-python-nirs4all",
        python_surface: "nirs4all.inspect_tuning_space / nirs4all.NativeTuning.inspect_space / nirs4all.tuning_space_schema_json / nirs4all CLI tuning-space",
        portable_claim: "search-space-json-contract-only",
        optional_payload_fields: &[],
        required_registry_entries: &["run.tuning.space", "run.tuning.force_params"],
        published_constants: &[],
    },
    ArtifactContract {
        id: "keyword.registry",
        schema: "nirs4all.keyword_registry.v1",
        producer: "full-python-nirs4all",
        python_surface:
            "nirs4all.get_keyword_registry / nirs4all.keyword_registry_json / nirs4all.keyword_registry_schema_json / nirs4all.TUNING_OPTIMIZER_PERSISTENCE_KEYS / nirs4all.ROBUSTNESS_SCENARIO_KINDS / nirs4all.ROBUSTNESS_STOCHASTIC_SCENARIO_KINDS / nirs4all.ROBUSTNESS_SCENARIO_DISTRIBUTIONS / nirs4all.ROBUSTNESS_MODES / nirs4all.ROBUSTNESS_EXECUTABLE_MODES",
        portable_claim: "registry-json-contract-only",
        optional_payload_fields: &[],
        required_registry_entries: REQUIRED_KEYWORD_REGISTRY_ENTRIES,
        published_constants: PUBLISHED_KEYWORD_CONSTANTS,
    },
];

const KENNARD_STONE_CLASSES: &[&str] = &[
    "nirs4all.operators.splitters.KennardStoneSplitter",
    "nirs4all.operators.splitters.splitters.KennardStoneSplitter",
];

const SNV_CLASSES: &[&str] = &[
    "nirs4all.operators.transforms.SNV",
    "nirs4all.operators.transforms.StandardNormalVariate",
    "nirs4all.operators.transforms.scalers.StandardNormalVariate",
];

const SAVGOL_CLASSES: &[&str] = &[
    "nirs4all.operators.transforms.SavitzkyGolay",
    "nirs4all.operators.transforms.nirs.SavitzkyGolay",
];

const PLS_CLASSES: &[&str] = &[
    "sklearn.cross_decomposition.PLSRegression",
    "sklearn.cross_decomposition._pls.PLSRegression",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ControllerPorts {
    pub inputs: &'static [&'static str],
    pub outputs: &'static [&'static str],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ControllerCapability {
    pub id: &'static str,
    pub kind: &'static str,
    pub domain: &'static str,
    pub label: &'static str,
    pub operator_classes: &'static [&'static str],
    pub ports: ControllerPorts,
    pub parameters: &'static [&'static str],
    pub runtime_level: &'static str,
    pub execution_path: &'static str,
    pub composes: &'static [&'static str],
}

pub const CONTROLLER_CAPABILITIES: &[ControllerCapability] = &[
    ControllerCapability {
        id: "split.kennard_stone",
        kind: "splitter",
        domain: "methods",
        label: "Kennard-Stone split",
        operator_classes: KENNARD_STONE_CLASSES,
        ports: ControllerPorts {
            inputs: &["X"],
            outputs: &["train_indices", "test_indices"],
        },
        parameters: &["test_size"],
        runtime_level: "parity-validated",
        execution_path: "portable_pipeline",
        composes: &[],
    },
    ControllerCapability {
        id: "preprocess.snv",
        kind: "transform",
        domain: "methods",
        label: "Standard normal variate",
        operator_classes: SNV_CLASSES,
        ports: ControllerPorts {
            inputs: &["X"],
            outputs: &["X_transformed"],
        },
        parameters: &[],
        runtime_level: "parity-validated",
        execution_path: "portable_pipeline",
        composes: &[],
    },
    ControllerCapability {
        id: "preprocess.savgol",
        kind: "transform",
        domain: "methods",
        label: "Savitzky-Golay",
        operator_classes: SAVGOL_CLASSES,
        ports: ControllerPorts {
            inputs: &["X"],
            outputs: &["X_transformed"],
        },
        parameters: &["window_length", "polyorder", "deriv", "mode", "cval"],
        runtime_level: "parity-validated",
        execution_path: "portable_pipeline",
        composes: &[],
    },
    ControllerCapability {
        id: "model.pls_regression",
        kind: "model",
        domain: "methods",
        label: "PLS regression",
        operator_classes: PLS_CLASSES,
        ports: ControllerPorts {
            inputs: &["X", "y"],
            outputs: &["predictions", "model"],
        },
        parameters: &["n_components", "_range_"],
        runtime_level: "parity-validated",
        execution_path: "portable_pipeline",
        composes: &[],
    },
    ControllerCapability {
        id: "pipeline.portable_methods",
        kind: "pipeline",
        domain: "methods",
        label: "Portable methods pipeline",
        operator_classes: &[],
        ports: ControllerPorts {
            inputs: &["pipeline", "dataset"],
            outputs: &["execution_result", "predictions", "model"],
        },
        parameters: &[],
        runtime_level: "parity-validated",
        execution_path: "run_portable_pipeline",
        composes: &[
            "split.kennard_stone",
            "preprocess.snv",
            "preprocess.savgol",
            "model.pls_regression",
        ],
    },
];

pub fn runtime_contracts() -> Value {
    let contracts: Vec<Value> = RUNTIME_CONTRACTS
        .iter()
        .map(|item| {
            serde_json::json!({
                "surface": item.surface,
                "pipeline_execution": item.pipeline_execution,
                "pipeline_entrypoint": item.pipeline_entrypoint,
                "serialized_model_predict": item.serialized_model_predict,
                "predict_entrypoint": item.predict_entrypoint,
            })
        })
        .collect();
    Value::Array(contracts)
}

pub fn artifact_contracts() -> Value {
    let contracts: Vec<Value> = ARTIFACT_CONTRACTS
        .iter()
        .map(|item| {
            let mut row = serde_json::json!({
                "id": item.id,
                "schema": item.schema,
                "producer": item.producer,
                "consumer_level": runtime_level_map("metadata"),
                "python_surface": item.python_surface,
                "portable_claim": item.portable_claim,
                "optional_payload_fields": item.optional_payload_fields,
                "required_registry_entries": item.required_registry_entries,
            });
            if !item.published_constants.is_empty() {
                row["published_constants"] = published_constants_map(item.published_constants);
            }
            row
        })
        .collect();
    Value::Array(contracts)
}

fn published_constants_map(constants: &[(&'static str, &'static [&'static str])]) -> Value {
    let mut map = serde_json::Map::new();
    for (key, values) in constants {
        map.insert((*key).to_string(), serde_json::json!(values));
    }
    Value::Object(map)
}

pub fn capability_manifest() -> Value {
    let controllers: Vec<Value> = CONTROLLER_CAPABILITIES
        .iter()
        .map(|item| {
            serde_json::json!({
                "id": item.id,
                "kind": item.kind,
                "domain": item.domain,
                "label": item.label,
                "operator_classes": item.operator_classes,
                "ports": {
                    "inputs": item.ports.inputs,
                    "outputs": item.ports.outputs,
                },
                "parameters": item.parameters,
                "runtime": runtime_level_map(item.runtime_level),
                "execution_path": item.execution_path,
                "composes": item.composes,
            })
        })
        .collect();

    serde_json::json!({
        "schema": "nirs4all-core.capabilities.v1",
        "aggregate": "nirs4all-core",
        "runtime_surfaces": RUNTIME_SURFACES,
        "runtime_contracts": runtime_contracts(),
        "artifact_contracts": artifact_contracts(),
        "portable_operator_classes": PORTABLE_OPERATOR_CLASSES,
        "controllers": controllers,
    })
}

fn runtime_level_map(level: &str) -> Value {
    let mut runtime = serde_json::Map::new();
    for surface in RUNTIME_SURFACES {
        runtime.insert((*surface).to_string(), Value::String(level.to_string()));
    }
    Value::Object(runtime)
}

pub fn upstream(key: &str) -> Option<&'static Upstream> {
    UPSTREAMS.iter().find(|item| item.key == key)
}

pub type LocalImplementationRegistry<T> = dag_ml::LocalImplementationRegistry<T>;

pub fn local_implementation_registry<T>() -> LocalImplementationRegistry<T> {
    LocalImplementationRegistry::new()
}

pub fn load_pipeline_definition_str(input: &str) -> Result<Value, String> {
    let mut value = match serde_json::from_str::<Value>(input) {
        Ok(value) => value,
        Err(json_error) => {
            let yaml_value =
                serde_yaml::from_str::<serde_yaml::Value>(input).map_err(|yaml_error| {
                    format!("invalid JSON ({json_error}) and YAML ({yaml_error})")
                })?;
            serde_json::to_value(yaml_value)
                .map_err(|error| format!("could not normalize YAML to JSON value: {error}"))?
        }
    };

    normalize_pipeline_root(&mut value)?;

    let pipeline = value.get_mut("pipeline").ok_or_else(|| {
        "pipeline definition must contain a 'pipeline' or 'steps' key".to_string()
    })?;
    if !pipeline.is_array() {
        return Err(
            "pipeline definition key 'pipeline' or 'steps' must contain an array of steps"
                .to_string(),
        );
    }
    strip_comments_in_place(pipeline);

    let classes = portable_class_names(&value);
    let unsupported: Vec<_> = classes
        .iter()
        .filter(|name| !PORTABLE_OPERATOR_CLASSES.contains(&name.as_str()))
        .cloned()
        .collect();
    if !unsupported.is_empty() {
        return Err(format!(
            "pipeline uses operators outside the current nirs4all-core portable subset: {}",
            unsupported.join(", ")
        ));
    }

    Ok(value)
}

pub fn portable_class_names(value: &Value) -> Vec<String> {
    let root = value.get("pipeline").unwrap_or(value);
    let mut classes = Vec::new();
    collect_classes(root, &mut classes);
    classes
}

#[derive(Debug, Clone, PartialEq)]
pub struct PortableDataset {
    pub x: Vec<f64>,
    pub y: Vec<f64>,
    pub rows: usize,
    pub cols: usize,
}

impl PortableDataset {
    pub fn from_json_value(value: &Value) -> Result<Self, String> {
        let rows = value
            .get("rows")
            .or_else(|| value.get("n_samples"))
            .and_then(Value::as_u64)
            .ok_or_else(|| "dataset must provide rows or n_samples".to_string())?
            as usize;
        let cols = value
            .get("cols")
            .or_else(|| value.get("n_features"))
            .and_then(Value::as_u64)
            .ok_or_else(|| "dataset must provide cols or n_features".to_string())?
            as usize;
        let x = flatten_matrix(
            value
                .get("X")
                .ok_or_else(|| "dataset must contain X".to_string())?,
            rows,
            cols,
            "X",
        )?;
        let y = flatten_matrix(
            value
                .get("y")
                .ok_or_else(|| "dataset must contain y".to_string())?,
            rows,
            1,
            "y",
        )?;
        Ok(Self { x, y, rows, cols })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ExecutionPlan {
    pub splitter: Option<PortableSplitter>,
    pub preprocessing: Vec<PortablePreprocessing>,
    pub n_components: Vec<i32>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PortableSplitter {
    pub kind: String,
    pub test_size: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum PortablePreprocessing {
    StandardNormalVariate,
    SavitzkyGolay(SavitzkyGolayParams),
}

#[derive(Debug, Clone, PartialEq)]
pub struct SavitzkyGolayParams {
    pub window_length: i32,
    pub polyorder: i32,
    pub deriv: i32,
    pub mode: i32,
    pub cval: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct EmbeddedPipelineSpec {
    savgol_window: i32,
    savgol_poly_degree: i32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PortablePipelineResult {
    pub name: String,
    pub rows: usize,
    pub cols: usize,
    pub split: PortableSplitResult,
    pub preprocessing: Vec<PortablePreprocessingResult>,
    pub variants: Vec<PortableVariant>,
    pub selected: PortableVariant,
    pub targets: Vec<f64>,
}

impl PortablePipelineResult {
    /// The reported RMSE is a training or selection score, never an independent test.
    pub fn evaluation_scope(&self) -> &'static str {
        if self.split.kind == "all" {
            "training"
        } else {
            "selection_validation"
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PortableSplitResult {
    pub kind: String,
    pub train_indices: Vec<usize>,
    pub test_indices: Vec<usize>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PortablePreprocessingResult {
    pub kind: String,
    pub params: Vec<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PortableVariant {
    pub n_components: i32,
    pub rmse: f64,
    pub predictions: Vec<f64>,
}

pub fn parse_execution_plan_str(input: &str) -> Result<ExecutionPlan, String> {
    let definition = load_pipeline_definition_str(input)?;
    parse_execution_plan(&definition)
}

pub fn parse_execution_plan(definition: &Value) -> Result<ExecutionPlan, String> {
    let pipeline = definition
        .get("pipeline")
        .and_then(Value::as_array)
        .ok_or_else(|| "pipeline definition must contain a pipeline array".to_string())?;
    let mut splitter = None;
    let mut preprocessing = Vec::new();
    let mut model_step = None;

    for step in pipeline {
        let step_obj = step
            .as_object()
            .ok_or_else(|| "portable pipeline steps must be mapping objects".to_string())?;

        if model_step.is_some() {
            return Err("the model must be the final portable pipeline step".to_string());
        }
        if step_obj.contains_key("class") && step_obj.contains_key("model") {
            return Err("a portable step cannot contain both class and model".to_string());
        }

        if let Some(class_name) = step_obj.get("class").and_then(Value::as_str) {
            if KENNARD_STONE_CLASSES.contains(&class_name) {
                if splitter.is_some() {
                    return Err(
                        "the optional splitter must appear once, before the model".to_string()
                    );
                }
                let params = step_obj.get("params").unwrap_or(&Value::Null);
                splitter = Some(PortableSplitter {
                    kind: "KennardStone".to_string(),
                    test_size: number_param(params.get("test_size"), 0.25)?,
                });
            } else if SNV_CLASSES.contains(&class_name) {
                preprocessing.push(PortablePreprocessing::StandardNormalVariate);
            } else if SAVGOL_CLASSES.contains(&class_name) {
                preprocessing.push(PortablePreprocessing::SavitzkyGolay(savgol_params(
                    step_obj.get("params").unwrap_or(&Value::Null),
                )?));
            } else {
                return Err(format!(
                    "portable execution does not support step class '{class_name}'"
                ));
            }
            continue;
        }

        if step_obj.get("model").and_then(Value::as_object).is_some() {
            if model_step.is_some() {
                return Err("portable execution supports exactly one model step".to_string());
            }
            model_step = Some(step);
            continue;
        }

        return Err(format!(
            "portable execution does not support pipeline step: {step}"
        ));
    }

    let model_step = model_step
        .ok_or_else(|| "portable execution requires a PLSRegression model step".to_string())?;
    let model_class = model_step
        .get("model")
        .and_then(|model| model.get("class"))
        .and_then(Value::as_str)
        .ok_or_else(|| "portable execution requires a model class".to_string())?;
    if !PLS_CLASSES.contains(&model_class) {
        return Err(format!(
            "portable execution does not support model class '{model_class}'"
        ));
    }

    Ok(ExecutionPlan {
        splitter,
        preprocessing,
        n_components: component_values(model_step)?,
    })
}

pub fn run_portable_pipeline_with_library(
    input: &str,
    dataset: &PortableDataset,
    library_path: impl AsRef<Path>,
) -> Result<PortablePipelineResult, String> {
    let definition = load_pipeline_definition_str(input)?;
    let plan = parse_execution_plan(&definition)?;
    let methods = MethodsLibrary::load(library_path)?;
    let split = methods.compute_split(plan.splitter.as_ref(), dataset)?;

    let mut x_train = select_rows(&dataset.x, dataset.rows, dataset.cols, &split.train_indices)?;
    let mut x_test = select_rows(&dataset.x, dataset.rows, dataset.cols, &split.test_indices)?;
    let y_train = select_rows(&dataset.y, dataset.rows, 1, &split.train_indices)?;
    let targets = select_rows(&dataset.y, dataset.rows, 1, &split.test_indices)?;

    let mut preprocessing = Vec::new();
    for step in &plan.preprocessing {
        match step {
            PortablePreprocessing::StandardNormalVariate => {
                x_train =
                    methods.snv_transform(&x_train, split.train_indices.len(), dataset.cols)?;
                x_test = methods.snv_transform(&x_test, split.test_indices.len(), dataset.cols)?;
                preprocessing.push(PortablePreprocessingResult {
                    kind: "StandardNormalVariate".to_string(),
                    params: Vec::new(),
                });
            }
            PortablePreprocessing::SavitzkyGolay(params) => {
                x_train = methods.savgol_transform(
                    &x_train,
                    split.train_indices.len(),
                    dataset.cols,
                    params,
                )?;
                x_test = methods.savgol_transform(
                    &x_test,
                    split.test_indices.len(),
                    dataset.cols,
                    params,
                )?;
                preprocessing.push(PortablePreprocessingResult {
                    kind: "SavitzkyGolay".to_string(),
                    params: vec![
                        f64::from(params.window_length),
                        f64::from(params.polyorder),
                        f64::from(params.deriv),
                        f64::from(params.mode),
                        params.cval,
                    ],
                });
            }
        }
    }

    let mut variants = Vec::new();
    for &n_components in &plan.n_components {
        let (predictions, _) = methods.fit_predict_pls(
            PlsFitInput {
                x_train: &x_train,
                y_train: &y_train,
                train_rows: split.train_indices.len(),
                cols: dataset.cols,
                n_components,
                x_test: &x_test,
                test_rows: split.test_indices.len(),
                embedded_pipeline: None,
            },
            false,
        )?;
        variants.push(PortableVariant {
            n_components,
            rmse: rmse(&predictions, &targets)?,
            predictions,
        });
    }
    let selected = variants
        .iter()
        .min_by(|left, right| {
            left.rmse
                .partial_cmp(&right.rmse)
                .unwrap_or(Ordering::Equal)
        })
        .ok_or_else(|| "portable execution needs at least one PLS variant".to_string())?
        .clone();

    Ok(PortablePipelineResult {
        name: definition
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("pipeline")
            .to_string(),
        rows: dataset.rows,
        cols: dataset.cols,
        split,
        preprocessing,
        variants,
        selected,
        targets,
    })
}

/// Run the portable subset and export the selected native PLS model as an
/// `N4MM` payload owned by libn4m. The exact SNV -> Savitzky-Golay smoothing
/// lane is embedded by Methods as N4MM v2; other historical portable plans
/// remain N4MM v1 and replay their declared preprocessing externally.
pub fn run_portable_pipeline_with_exported_model(
    input: &str,
    dataset: &PortableDataset,
    library_path: impl AsRef<Path>,
) -> Result<(PortablePipelineResult, Vec<u8>), String> {
    let result = run_portable_pipeline_with_library(input, dataset, &library_path)?;
    let definition = load_pipeline_definition_str(input)?;
    let plan = parse_execution_plan(&definition)?;
    let methods = MethodsLibrary::load(library_path)?;
    let split = methods.compute_split(plan.splitter.as_ref(), dataset)?;
    let mut x_train = select_rows(&dataset.x, dataset.rows, dataset.cols, &split.train_indices)?;
    let y_train = select_rows(&dataset.y, dataset.rows, 1, &split.train_indices)?;
    let embedded_pipeline = embedded_pipeline_spec(&plan);
    if embedded_pipeline.is_none() {
        for step in &plan.preprocessing {
            x_train = match step {
                PortablePreprocessing::StandardNormalVariate => {
                    methods.snv_transform(&x_train, split.train_indices.len(), dataset.cols)?
                }
                PortablePreprocessing::SavitzkyGolay(params) => methods.savgol_transform(
                    &x_train,
                    split.train_indices.len(),
                    dataset.cols,
                    params,
                )?,
            };
        }
    }
    let (_, model) = methods.fit_predict_pls(
        PlsFitInput {
            x_train: &x_train,
            y_train: &y_train,
            train_rows: split.train_indices.len(),
            cols: dataset.cols,
            n_components: result.selected.n_components,
            x_test: &x_train,
            test_rows: split.train_indices.len(),
            embedded_pipeline,
        },
        true,
    )?;
    Ok((result, model.expect("model export requested")))
}

/// Replay a selected `N4MM` model under the content-inspected preprocessing
/// contract. Historical model-only payloads apply the portable definition;
/// embedded Methods pipelines consume raw input directly. This is intentionally
/// limited to the same executable subset accepted by
/// [`run_portable_pipeline_with_library`].
pub fn predict_exported_portable_model_with_library(
    input: &str,
    model_n4mm: &[u8],
    x: &[f64],
    rows: usize,
    cols: usize,
    library_path: impl AsRef<Path>,
) -> Result<Vec<f64>, String> {
    let definition = load_pipeline_definition_str(input)?;
    let plan = parse_execution_plan(&definition)?;
    let mut transformed = x.to_vec();
    if transformed.len()
        != rows
            .checked_mul(cols)
            .ok_or("prediction matrix dimensions overflow")?
    {
        return Err(format!(
            "prediction matrix length {} does not match {rows}x{cols}",
            transformed.len()
        ));
    }
    let library_path = library_path.as_ref();
    let descriptor = inspect_portable_model_descriptor(model_n4mm, library_path)?;
    validate_portable_model_plan(&plan, &descriptor)?;
    let methods = MethodsLibrary::load(library_path)?;
    if descriptor.pipeline.is_none() {
        for step in &plan.preprocessing {
            transformed = match step {
                PortablePreprocessing::StandardNormalVariate => {
                    methods.snv_transform(&transformed, rows, cols)?
                }
                PortablePreprocessing::SavitzkyGolay(params) => {
                    methods.savgol_transform(&transformed, rows, cols, params)?
                }
            };
        }
    }
    methods.import_predict_pls(model_n4mm, &transformed, rows, cols)
}

/// Preflight a persisted selected model against an explicit libn4m runtime.
pub fn validate_exported_portable_model_with_library(
    input: &str,
    model_n4mm: &[u8],
    cols: usize,
    library_path: impl AsRef<Path>,
) -> Result<(), String> {
    let definition = load_pipeline_definition_str(input)?;
    let plan = parse_execution_plan(&definition)?;
    let library_path = library_path.as_ref();
    let descriptor = inspect_portable_model_descriptor(model_n4mm, library_path)?;
    validate_portable_model_plan(&plan, &descriptor)?;
    let methods = MethodsLibrary::load(library_path)?;
    methods
        .import_predict_pls(model_n4mm, &vec![0.0; cols], 1, cols)
        .map(|_| ())
}

fn embedded_pipeline_spec(plan: &ExecutionPlan) -> Option<EmbeddedPipelineSpec> {
    let [PortablePreprocessing::StandardNormalVariate, PortablePreprocessing::SavitzkyGolay(sg)] =
        plan.preprocessing.as_slice()
    else {
        return None;
    };
    (sg.deriv == 0
        && sg.mode == 4
        && sg.cval.to_bits() == 0.0f64.to_bits()
        && (3..=501).contains(&sg.window_length)
        && sg.window_length % 2 == 1
        && sg.polyorder >= 0
        && sg.polyorder < sg.window_length)
        .then_some(EmbeddedPipelineSpec {
            savgol_window: sg.window_length,
            savgol_poly_degree: sg.polyorder,
        })
}

pub(crate) fn inspect_portable_model_descriptor(
    model_n4mm: &[u8],
    library_path: &Path,
) -> Result<NativePredictorDescriptorV1, String> {
    let canonical = std::fs::canonicalize(library_path).map_err(|error| {
        format!(
            "cannot resolve libn4m at {} for N4MM inspection: {error}",
            library_path.display()
        )
    })?;
    native_methods_replay::configure_methods_runtime_for_source(&canonical)
        .map_err(|error| format!("cannot configure Methods for N4MM inspection: {error}"))?;
    let controller = dag_ml_core::ControllerId::new("controller:methods.pls")
        .map_err(|error| error.to_string())?;
    dag_ml_core::inspect_methods_native_predictor_descriptor_v1(&controller, model_n4mm)
        .map_err(|error| format!("native Methods predictor inspection failed: {error}"))
}

pub(crate) fn validate_portable_model_plan(
    plan: &ExecutionPlan,
    descriptor: &NativePredictorDescriptorV1,
) -> Result<(), String> {
    if let Some(pipeline) = &descriptor.pipeline {
        let expected = embedded_pipeline_spec(plan).ok_or_else(|| {
            "embedded Methods preprocessing contradicts the portable definition".to_string()
        })?;
        if pipeline.savgol_window != expected.savgol_window
            || pipeline.savgol_poly_degree != expected.savgol_poly_degree
        {
            return Err(
                "embedded Methods pipeline fingerprint parameters contradict the portable definition"
                    .to_string(),
            );
        }
    }
    Ok(())
}

pub mod dag_ml {
    pub use dag_ml_crate::*;

    pub const UPSTREAM_KEY: &str = "dag_ml";
}

pub mod dag_ml_data {
    pub use dag_ml_data_crate::*;

    pub const UPSTREAM_KEY: &str = "dag_ml_data";
}

/// Optional `nirs4all-datasets` surface.
///
/// nirs4all-datasets is kept EXTERNAL/OPTIONAL (to avoid bloat), so this
/// convenience module is gated behind the off-by-default `datasets` Cargo
/// feature. The bundled aggregate is methods + formats + io (+ dag-ml); the
/// datasets host is delegated to at runtime and never vendored.
#[cfg(feature = "datasets")]
pub mod datasets {
    pub const UPSTREAM_KEY: &str = "datasets";
}

pub mod formats {
    pub use nirs4all_formats_crate::*;

    pub const UPSTREAM_KEY: &str = "formats";
}

pub mod io {
    pub use nirs4all_io_crate::*;

    pub const UPSTREAM_KEY: &str = "io";
}

pub mod methods {
    pub const UPSTREAM_KEY: &str = "methods";
}

fn normalize_pipeline_root(value: &mut Value) -> Result<(), String> {
    match value {
        Value::Array(items) => {
            let pipeline = Value::Array(std::mem::take(items));
            let mut root = serde_json::Map::new();
            root.insert("pipeline".to_string(), pipeline);
            *value = Value::Object(root);
            Ok(())
        }
        Value::Object(map) => {
            if !map.contains_key("pipeline") {
                let steps = map.remove("steps").ok_or_else(|| {
                    "invalid pipeline definition format: expected an array or an object with a 'pipeline' or 'steps' key"
                        .to_string()
                })?;
                map.insert("pipeline".to_string(), steps);
            }
            Ok(())
        }
        _ => Err(
            "pipeline definition must be an array or an object with a 'pipeline'/'steps' key"
                .to_string(),
        ),
    }
}

fn strip_comments_in_place(value: &mut Value) {
    match value {
        Value::Array(items) => {
            items.retain(|item| !is_comment_step(item));
            for item in items {
                strip_comments_in_place(item);
            }
        }
        Value::Object(map) => {
            map.remove("_comment");
            for item in map.values_mut() {
                strip_comments_in_place(item);
            }
        }
        _ => {}
    }
}

fn is_comment_step(value: &Value) -> bool {
    matches!(value, Value::Object(map) if map.len() == 1 && map.contains_key("_comment"))
}

fn collect_classes(value: &Value, output: &mut Vec<String>) {
    match value {
        Value::Array(items) => {
            for item in items {
                collect_classes(item, output);
            }
        }
        Value::Object(map) => {
            if let Some(Value::String(class_name)) = map.get("class") {
                output.push(class_name.clone());
            }
            for item in map.values() {
                collect_classes(item, output);
            }
        }
        _ => {}
    }
}

fn savgol_params(params: &Value) -> Result<SavitzkyGolayParams, String> {
    let delta = number_param(params.get("delta"), 1.0)?;
    if delta != 1.0 {
        return Err(
            "portable Savitzky-Golay execution currently supports delta=1 only".to_string(),
        );
    }
    let window_length = int_param(
        params.get("window_length").or_else(|| params.get("window")),
        11,
    )?;
    if window_length < 1 {
        return Err("window_length must be >= 1".to_string());
    }
    let polyorder = int_param(params.get("polyorder"), 3)?;
    if polyorder < 0 {
        return Err("polyorder must be >= 0".to_string());
    }
    let deriv = int_param(params.get("deriv"), 0)?;
    if deriv < 0 {
        return Err("deriv must be >= 0".to_string());
    }
    Ok(SavitzkyGolayParams {
        window_length,
        polyorder,
        deriv,
        mode: savgol_mode(params.get("mode"))?,
        cval: number_param(params.get("cval"), 0.0)?,
    })
}

fn savgol_mode(value: Option<&Value>) -> Result<i32, String> {
    match value {
        None => Ok(4),
        Some(Value::String(mode)) => match mode.to_ascii_lowercase().as_str() {
            "mirror" => Ok(0),
            "constant" => Ok(1),
            "nearest" => Ok(2),
            "wrap" => Ok(3),
            "interp" => Ok(4),
            _ => Err(format!("unsupported Savitzky-Golay mode: {mode}")),
        },
        Some(value) => {
            let mode = int_param(Some(value), 4)?;
            if (0..=4).contains(&mode) {
                Ok(mode)
            } else {
                Err(format!("unsupported Savitzky-Golay mode: {value}"))
            }
        }
    }
}

fn component_values(step: &Value) -> Result<Vec<i32>, String> {
    if let Some(range) = step.get("_range_") {
        if step.get("param").and_then(Value::as_str) != Some("n_components") {
            return Err(
                "portable execution only supports _range_ sweeps over 'n_components'".to_string(),
            );
        }
        let values = range
            .as_array()
            .ok_or_else(|| "invalid n_components _range_; expected an array".to_string())?;
        if values.len() != 3 {
            return Err(
                "invalid n_components _range_; expected [start, stop, positive_step]".to_string(),
            );
        }
        let start = int_param(values.first(), 0)?;
        let stop = int_param(values.get(1), 0)?;
        let stride = int_param(values.get(2), 0)?;
        if start < 1 || stop < 1 {
            return Err("invalid n_components _range_; start and stop must be >= 1".to_string());
        }
        if stride <= 0 {
            return Err("invalid n_components _range_; expected a positive step".to_string());
        }
        if start > stop {
            return Err("invalid n_components _range_; start must be <= stop".to_string());
        }
        // Count and iterate in i64: even a single i32::MAX candidate must not
        // overflow while advancing past the final value.
        let count = (i64::from(stop) - i64::from(start)) / i64::from(stride) + 1;
        if count > 10_000 {
            return Err("portable n_components sweep exceeds 10000 variants".to_string());
        }
        return Ok((0..count)
            .map(|index| (i64::from(start) + index * i64::from(stride)) as i32)
            .collect());
    }
    let params = step
        .get("model")
        .and_then(|model| model.get("params"))
        .unwrap_or(&Value::Null);
    let n_components = int_param(params.get("n_components"), 2)?;
    if n_components < 1 {
        return Err("n_components must be >= 1".to_string());
    }
    Ok(vec![n_components])
}

fn number_param(value: Option<&Value>, fallback: f64) -> Result<f64, String> {
    let number = match value {
        None | Some(Value::Null) => Ok(fallback),
        Some(Value::Number(number)) => number
            .as_f64()
            .ok_or_else(|| "numeric parameter is outside f64 range".to_string()),
        Some(Value::String(text)) => text
            .trim()
            .parse::<f64>()
            .map_err(|error| format!("invalid numeric parameter '{text}': {error}")),
        Some(other) => Err(format!("expected numeric parameter, got {other}")),
    }?;
    if !number.is_finite() {
        return Err("numeric parameter must be finite".to_string());
    }
    Ok(number)
}

fn int_param(value: Option<&Value>, fallback: i32) -> Result<i32, String> {
    let Some(value) = value else {
        return Ok(fallback);
    };
    if value.is_null() {
        return Ok(fallback);
    }
    let raw = match value {
        Value::Number(number) => integer_from_number(number, value)?,
        Value::String(text) => integer_from_string(text)?,
        other => return Err(format!("expected integer parameter, got {other}")),
    };
    i32::try_from(raw).map_err(|_| format!("integer parameter {raw} is outside i32 range"))
}

fn integer_from_number(number: &serde_json::Number, value: &Value) -> Result<i64, String> {
    if let Some(raw) = number.as_i64() {
        return Ok(raw);
    }
    let raw = number
        .as_f64()
        .ok_or_else(|| "integer parameter is outside f64 range".to_string())?;
    if !raw.is_finite() {
        return Err("integer parameter must be finite".to_string());
    }
    if raw.fract() != 0.0 {
        return Err(format!("expected integer parameter, got {value}"));
    }
    if raw < i64::MIN as f64 || raw > i64::MAX as f64 {
        return Err("integer parameter is outside i64 range".to_string());
    }
    Ok(raw as i64)
}

fn integer_from_string(text: &str) -> Result<i64, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("invalid integer parameter: empty string".to_string());
    }
    if let Ok(raw) = trimmed.parse::<i64>() {
        return Ok(raw);
    }
    let raw = trimmed
        .parse::<f64>()
        .map_err(|error| format!("invalid integer parameter '{text}': {error}"))?;
    if !raw.is_finite() {
        return Err(format!("invalid integer parameter '{text}': not finite"));
    }
    if raw.fract() != 0.0 {
        return Err(format!(
            "invalid integer parameter '{text}': not an integer"
        ));
    }
    if raw < i64::MIN as f64 || raw > i64::MAX as f64 {
        return Err(format!("integer parameter '{text}' is outside i64 range"));
    }
    Ok(raw as i64)
}

fn flatten_matrix(
    value: &Value,
    rows: usize,
    cols: usize,
    label: &str,
) -> Result<Vec<f64>, String> {
    let expected = rows
        .checked_mul(cols)
        .ok_or_else(|| format!("dataset {label} shape overflows"))?;
    let array = value
        .as_array()
        .ok_or_else(|| format!("dataset {label} must be an array"))?;

    let out = if array.first().is_some_and(Value::is_array) {
        let mut flattened = Vec::with_capacity(expected);
        for row in array {
            let row_items = row
                .as_array()
                .ok_or_else(|| format!("dataset {label} rows must be arrays"))?;
            for item in row_items {
                flattened.push(
                    item.as_f64()
                        .ok_or_else(|| format!("dataset {label} contains a non-numeric value"))?,
                );
            }
        }
        flattened
    } else {
        array
            .iter()
            .map(|item| {
                item.as_f64()
                    .ok_or_else(|| format!("dataset {label} contains a non-numeric value"))
            })
            .collect::<Result<Vec<_>, _>>()?
    };

    if out.len() != expected {
        return Err(format!(
            "dataset {label} length {} does not match {rows}x{cols}",
            out.len()
        ));
    }
    Ok(out)
}

fn select_rows(
    data: &[f64],
    rows: usize,
    cols: usize,
    indices: &[usize],
) -> Result<Vec<f64>, String> {
    let mut out = Vec::with_capacity(indices.len() * cols);
    for &index in indices {
        if index >= rows {
            return Err(format!("row index {index} is outside 0..{}", rows - 1));
        }
        let start = index * cols;
        out.extend_from_slice(&data[start..start + cols]);
    }
    Ok(out)
}

fn rmse(predictions: &[f64], targets: &[f64]) -> Result<f64, String> {
    if predictions.len() != targets.len() {
        return Err(format!(
            "prediction/target length mismatch: {} != {}",
            predictions.len(),
            targets.len()
        ));
    }
    let sum = predictions
        .iter()
        .zip(targets)
        .map(|(actual, expected)| {
            let diff = actual - expected;
            diff * diff
        })
        .sum::<f64>();
    Ok((sum / predictions.len() as f64).sqrt())
}

type N4mStatus = c_int;
type N4mHandle = *mut c_void;

/// Owns one opaque C-ABI handle after its create/import call succeeds.
///
/// The guard is deliberately used around every fallible Rust allocation that
/// follows a native allocation, so an early return or unwind cannot leak it.
struct NativeHandleGuard {
    handle: N4mHandle,
    destroy: unsafe extern "C" fn(N4mHandle),
}

impl NativeHandleGuard {
    fn new(destroy: unsafe extern "C" fn(N4mHandle)) -> Self {
        Self {
            handle: ptr::null_mut(),
            destroy,
        }
    }
}

impl Drop for NativeHandleGuard {
    fn drop(&mut self) {
        if !self.handle.is_null() {
            unsafe { (self.destroy)(self.handle) };
        }
    }
}

struct SplitResultGuard {
    result: N4mSplitResult,
    destroy: unsafe extern "C" fn(*mut N4mSplitResult),
}

impl SplitResultGuard {
    fn new(destroy: unsafe extern "C" fn(*mut N4mSplitResult)) -> Self {
        Self {
            result: N4mSplitResult {
                train_idx: ptr::null_mut(),
                n_train: 0,
                test_idx: ptr::null_mut(),
                n_test: 0,
                owner: ptr::null_mut(),
            },
            destroy,
        }
    }
}

impl Drop for SplitResultGuard {
    fn drop(&mut self) {
        unsafe { (self.destroy)(&mut self.result) };
    }
}

const N4M_OK: N4mStatus = 0;
const N4M_DTYPE_F64: c_int = 1;

#[repr(C)]
#[derive(Debug, Clone, Copy)]
struct N4mMatrixView {
    data: *mut c_void,
    rows: i64,
    cols: i64,
    row_stride: i64,
    col_stride: i64,
    dtype: c_int,
    reserved0: i32,
}

#[repr(C)]
#[derive(Debug, Clone, Copy)]
struct N4mSplitResult {
    train_idx: *mut i64,
    n_train: i64,
    test_idx: *mut i64,
    n_test: i64,
    owner: *mut c_void,
}

struct MethodsLibrary {
    library: Library,
}

#[cfg(test)]
thread_local! {
    static HOST_SNV_TRANSFORMS: Cell<usize> = const { Cell::new(0) };
    static HOST_SAVGOL_TRANSFORMS: Cell<usize> = const { Cell::new(0) };
    static NATIVE_MODEL_IMPORTS: Cell<usize> = const { Cell::new(0) };
    static NATIVE_MODEL_PREDICTS: Cell<usize> = const { Cell::new(0) };
}

#[cfg(test)]
pub(crate) fn reset_portable_replay_call_counts() {
    HOST_SNV_TRANSFORMS.set(0);
    HOST_SAVGOL_TRANSFORMS.set(0);
    NATIVE_MODEL_IMPORTS.set(0);
    NATIVE_MODEL_PREDICTS.set(0);
}

#[cfg(test)]
pub(crate) fn portable_replay_call_counts() -> (usize, usize, usize, usize) {
    (
        HOST_SNV_TRANSFORMS.get(),
        HOST_SAVGOL_TRANSFORMS.get(),
        NATIVE_MODEL_IMPORTS.get(),
        NATIVE_MODEL_PREDICTS.get(),
    )
}

struct PlsFitInput<'a> {
    x_train: &'a [f64],
    y_train: &'a [f64],
    train_rows: usize,
    cols: usize,
    n_components: i32,
    x_test: &'a [f64],
    test_rows: usize,
    embedded_pipeline: Option<EmbeddedPipelineSpec>,
}

impl MethodsLibrary {
    fn load(path: impl AsRef<Path>) -> Result<Self, String> {
        let path = path.as_ref();
        let library = unsafe { Library::new(path) }
            .map_err(|error| format!("could not load libn4m at {}: {error}", path.display()))?;
        Ok(Self { library })
    }

    fn compute_split(
        &self,
        splitter: Option<&PortableSplitter>,
        dataset: &PortableDataset,
    ) -> Result<PortableSplitResult, String> {
        let Some(splitter) = splitter else {
            let indices = (0..dataset.rows).collect::<Vec<_>>();
            return Ok(PortableSplitResult {
                kind: "all".to_string(),
                train_indices: indices.clone(),
                test_indices: indices,
            });
        };

        let create: Symbol<unsafe extern "C" fn(*mut N4mHandle, c_double) -> N4mStatus> =
            self.symbol(b"n4m_model_selection_kennard_stone_create")?;
        let split_fn: Symbol<
            unsafe extern "C" fn(N4mHandle, N4mMatrixView, *mut N4mSplitResult) -> N4mStatus,
        > = self.symbol(b"n4m_model_selection_kennard_stone_split")?;
        let destroy: Symbol<unsafe extern "C" fn(N4mHandle)> =
            self.symbol(b"n4m_model_selection_kennard_stone_destroy")?;
        let result_destroy: Symbol<unsafe extern "C" fn(*mut N4mSplitResult)> =
            self.symbol(b"n4m_split_result_destroy")?;

        let mut x = dataset.x.clone();
        let x_view = matrix_view(&mut x, dataset.rows, dataset.cols)?;
        let mut handle = NativeHandleGuard::new(*destroy);
        unsafe {
            self.check(
                create(&mut handle.handle, splitter.test_size),
                "n4m_model_selection_kennard_stone_create",
                None,
            )?;
        }
        let mut result = SplitResultGuard::new(*result_destroy);
        let split_status = unsafe { split_fn(handle.handle, x_view, &mut result.result) };
        let split_result = if let Err(error) = self.check(
            split_status,
            "n4m_model_selection_kennard_stone_split",
            None,
        ) {
            return Err(error);
        } else {
            let train = copy_indices(result.result.train_idx, result.result.n_train);
            let test = copy_indices(result.result.test_idx, result.result.n_test);
            let train = train?;
            let test = test?;
            PortableSplitResult {
                kind: splitter.kind.clone(),
                train_indices: train,
                test_indices: test,
            }
        };
        Ok(split_result)
    }

    fn snv_transform(&self, input: &[f64], rows: usize, cols: usize) -> Result<Vec<f64>, String> {
        #[cfg(test)]
        HOST_SNV_TRANSFORMS.set(HOST_SNV_TRANSFORMS.get() + 1);
        let create: Symbol<unsafe extern "C" fn(*mut N4mHandle, c_int, c_int, c_int) -> N4mStatus> =
            self.symbol(b"n4m_transform_snv_create")?;
        let transform: Symbol<
            unsafe extern "C" fn(N4mHandle, N4mMatrixView, N4mMatrixView) -> N4mStatus,
        > = self.symbol(b"n4m_transform_snv_transform")?;
        let destroy: Symbol<unsafe extern "C" fn(N4mHandle)> =
            self.symbol(b"n4m_transform_snv_destroy")?;

        let mut x = input.to_vec();
        let mut out = vec![0.0; input.len()];
        let x_view = matrix_view(&mut x, rows, cols)?;
        let out_view = matrix_view(&mut out, rows, cols)?;
        let mut handle = NativeHandleGuard::new(*destroy);
        unsafe {
            self.check(
                create(&mut handle.handle, 1, 1, 0),
                "n4m_transform_snv_create",
                None,
            )?;
        }
        let status = unsafe { transform(handle.handle, x_view, out_view) };
        self.check(status, "n4m_transform_snv_transform", None)?;
        Ok(out)
    }

    fn savgol_transform(
        &self,
        input: &[f64],
        rows: usize,
        cols: usize,
        params: &SavitzkyGolayParams,
    ) -> Result<Vec<f64>, String> {
        #[cfg(test)]
        HOST_SAVGOL_TRANSFORMS.set(HOST_SAVGOL_TRANSFORMS.get() + 1);
        let create: Symbol<
            unsafe extern "C" fn(
                *mut N4mHandle,
                i32,
                i32,
                i32,
                c_double,
                i32,
                c_double,
            ) -> N4mStatus,
        > = self.symbol(b"n4m_transform_savitzky_golay_create")?;
        let transform: Symbol<
            unsafe extern "C" fn(N4mHandle, N4mMatrixView, N4mMatrixView) -> N4mStatus,
        > = self.symbol(b"n4m_transform_savitzky_golay_transform")?;
        let destroy: Symbol<unsafe extern "C" fn(N4mHandle)> =
            self.symbol(b"n4m_transform_savitzky_golay_destroy")?;

        let mut x = input.to_vec();
        let mut out = vec![0.0; input.len()];
        let x_view = matrix_view(&mut x, rows, cols)?;
        let out_view = matrix_view(&mut out, rows, cols)?;
        let mut handle = NativeHandleGuard::new(*destroy);
        unsafe {
            self.check(
                create(
                    &mut handle.handle,
                    params.window_length,
                    params.polyorder,
                    params.deriv,
                    1.0,
                    params.mode,
                    params.cval,
                ),
                "n4m_transform_savitzky_golay_create",
                None,
            )?;
        }
        let status = unsafe { transform(handle.handle, x_view, out_view) };
        self.check(status, "n4m_transform_savitzky_golay_transform", None)?;
        Ok(out)
    }

    fn fit_predict_pls(
        &self,
        input: PlsFitInput<'_>,
        export_model: bool,
    ) -> Result<(Vec<f64>, Option<Vec<u8>>), String> {
        let context_create: Symbol<unsafe extern "C" fn(*mut N4mHandle) -> N4mStatus> =
            self.symbol(b"n4m_context_create")?;
        let context_destroy: Symbol<unsafe extern "C" fn(N4mHandle)> =
            self.symbol(b"n4m_context_destroy")?;
        let config_create: Symbol<unsafe extern "C" fn(*mut N4mHandle) -> N4mStatus> =
            self.symbol(b"n4m_config_create")?;
        let config_destroy: Symbol<unsafe extern "C" fn(N4mHandle)> =
            self.symbol(b"n4m_config_destroy")?;
        let set_algorithm: Symbol<unsafe extern "C" fn(N4mHandle, i32) -> N4mStatus> =
            self.symbol(b"n4m_config_set_algorithm")?;
        let set_solver: Symbol<unsafe extern "C" fn(N4mHandle, i32) -> N4mStatus> =
            self.symbol(b"n4m_config_set_solver")?;
        let set_deflation: Symbol<unsafe extern "C" fn(N4mHandle, i32) -> N4mStatus> =
            self.symbol(b"n4m_config_set_deflation")?;
        let set_n_components: Symbol<unsafe extern "C" fn(N4mHandle, i32) -> N4mStatus> =
            self.symbol(b"n4m_config_set_n_components")?;
        let set_center_x: Symbol<unsafe extern "C" fn(N4mHandle, i32) -> N4mStatus> =
            self.symbol(b"n4m_config_set_center_x")?;
        let set_scale_x: Symbol<unsafe extern "C" fn(N4mHandle, i32) -> N4mStatus> =
            self.symbol(b"n4m_config_set_scale_x")?;
        let set_center_y: Symbol<unsafe extern "C" fn(N4mHandle, i32) -> N4mStatus> =
            self.symbol(b"n4m_config_set_center_y")?;
        let set_scale_y: Symbol<unsafe extern "C" fn(N4mHandle, i32) -> N4mStatus> =
            self.symbol(b"n4m_config_set_scale_y")?;
        let model_fit: Symbol<
            unsafe extern "C" fn(
                N4mHandle,
                N4mHandle,
                *const N4mMatrixView,
                *const N4mMatrixView,
                *mut N4mHandle,
            ) -> N4mStatus,
        > = self.symbol(b"n4m_model_fit")?;
        let model_predict: Symbol<
            unsafe extern "C" fn(
                N4mHandle,
                N4mHandle,
                *const N4mMatrixView,
                *mut N4mMatrixView,
            ) -> N4mStatus,
        > = self.symbol(b"n4m_model_predict")?;
        let model_destroy: Symbol<unsafe extern "C" fn(N4mHandle)> =
            self.symbol(b"n4m_model_destroy")?;

        let mut x_train = input.x_train.to_vec();
        let mut y_train = input.y_train.to_vec();
        let x_view = matrix_view(&mut x_train, input.train_rows, input.cols)?;
        let y_view = matrix_view(&mut y_train, input.train_rows, 1)?;
        let mut x_test = input.x_test.to_vec();
        let mut predictions = vec![0.0; input.test_rows];
        let test_view = matrix_view(&mut x_test, input.test_rows, input.cols)?;
        let mut out_view = matrix_view(&mut predictions, input.test_rows, 1)?;
        let mut ctx = NativeHandleGuard::new(*context_destroy);
        let mut cfg = NativeHandleGuard::new(*config_destroy);
        let mut model = NativeHandleGuard::new(*model_destroy);
        unsafe {
            self.check(context_create(&mut ctx.handle), "n4m_context_create", None)?;
        }
        macro_rules! checked {
            ($status:expr, $name:literal) => {
                self.check(unsafe { $status }, $name, Some(ctx.handle))?;
            };
        }
        checked!(config_create(&mut cfg.handle), "n4m_config_create");
        checked!(set_algorithm(cfg.handle, 0), "n4m_config_set_algorithm");
        checked!(set_solver(cfg.handle, 1), "n4m_config_set_solver");
        checked!(set_deflation(cfg.handle, 0), "n4m_config_set_deflation");
        checked!(
            set_n_components(cfg.handle, input.n_components),
            "n4m_config_set_n_components"
        );
        checked!(set_center_x(cfg.handle, 1), "n4m_config_set_center_x");
        checked!(set_scale_x(cfg.handle, 1), "n4m_config_set_scale_x");
        checked!(set_center_y(cfg.handle, 1), "n4m_config_set_center_y");
        checked!(set_scale_y(cfg.handle, 1), "n4m_config_set_scale_y");

        let _pipeline = if let Some(spec) = input.embedded_pipeline {
            let pipeline_create: Symbol<unsafe extern "C" fn(*mut N4mHandle) -> N4mStatus> =
                self.symbol(b"n4m_pipeline_create")?;
            let pipeline_destroy: Symbol<unsafe extern "C" fn(N4mHandle)> =
                self.symbol(b"n4m_pipeline_destroy")?;
            let pipeline_add: Symbol<
                unsafe extern "C" fn(N4mHandle, c_int, *const c_double, c_int) -> N4mStatus,
            > = self.symbol(b"n4m_pipeline_add_operator")?;
            let config_set_pipeline: Symbol<
                unsafe extern "C" fn(N4mHandle, N4mHandle) -> N4mStatus,
            > = self.symbol(b"n4m_config_set_pipeline")?;
            let mut pipeline = NativeHandleGuard::new(*pipeline_destroy);
            checked!(pipeline_create(&mut pipeline.handle), "n4m_pipeline_create");
            checked!(
                pipeline_add(pipeline.handle, 4, ptr::null(), 0),
                "n4m_pipeline_add_operator(SNV)"
            );
            let savgol = [
                f64::from(spec.savgol_window),
                f64::from(spec.savgol_poly_degree),
            ];
            checked!(
                pipeline_add(pipeline.handle, 8, savgol.as_ptr(), savgol.len() as c_int,),
                "n4m_pipeline_add_operator(SavitzkyGolay)"
            );
            checked!(
                config_set_pipeline(cfg.handle, pipeline.handle),
                "n4m_config_set_pipeline"
            );
            Some(pipeline)
        } else {
            None
        };

        let fit_status =
            unsafe { model_fit(ctx.handle, cfg.handle, &x_view, &y_view, &mut model.handle) };
        self.check(fit_status, "n4m_model_fit", Some(ctx.handle))?;

        let predict_status =
            unsafe { model_predict(ctx.handle, model.handle, &test_view, &mut out_view) };
        let predict_check = self.check(predict_status, "n4m_model_predict", Some(ctx.handle));
        let export_result = if export_model && predict_check.is_ok() {
            (|| -> Result<Vec<u8>, String> {
                let export_size: Symbol<unsafe extern "C" fn(N4mHandle, *mut usize) -> N4mStatus> =
                    self.symbol(b"n4m_model_export_size")?;
                let export_to: Symbol<
                    unsafe extern "C" fn(N4mHandle, *mut c_void, usize, *mut usize) -> N4mStatus,
                > = self.symbol(b"n4m_model_export_to_buffer")?;
                let mut len = 0usize;
                unsafe {
                    self.check(
                        export_size(model.handle, &mut len),
                        "n4m_model_export_size",
                        None,
                    )?;
                }
                if len == 0 || len > 64 * 1024 * 1024 {
                    return Err("n4m_model_export_size returned an invalid N4MM length".to_string());
                }
                let mut bytes = vec![0u8; len];
                let mut written = 0usize;
                unsafe {
                    self.check(
                        export_to(
                            model.handle,
                            bytes.as_mut_ptr().cast(),
                            bytes.len(),
                            &mut written,
                        ),
                        "n4m_model_export_to_buffer",
                        None,
                    )?;
                }
                if written == 0 || written > bytes.len() {
                    return Err(
                        "n4m_model_export_to_buffer returned an invalid N4MM length".to_string()
                    );
                }
                bytes.truncate(written);
                Ok(bytes)
            })()
        } else {
            Ok(Vec::new())
        };
        predict_check?;
        let exported = export_result?;
        Ok((predictions, export_model.then_some(exported)))
    }

    fn import_predict_pls(
        &self,
        model_n4mm: &[u8],
        input: &[f64],
        rows: usize,
        cols: usize,
    ) -> Result<Vec<f64>, String> {
        if model_n4mm.is_empty() || model_n4mm.len() > 64 * 1024 * 1024 {
            return Err("N4MM model payload is empty or exceeds the portable-session limit".into());
        }
        let mut x = input.to_vec();
        let mut out = vec![0.0; rows];
        let x_view = matrix_view(&mut x, rows, cols)?;
        let mut out_view = matrix_view(&mut out, rows, 1)?;
        let context_create: Symbol<unsafe extern "C" fn(*mut N4mHandle) -> N4mStatus> =
            self.symbol(b"n4m_context_create")?;
        let context_destroy: Symbol<unsafe extern "C" fn(N4mHandle)> =
            self.symbol(b"n4m_context_destroy")?;
        let import: Symbol<
            unsafe extern "C" fn(N4mHandle, *const c_void, usize, *mut N4mHandle) -> N4mStatus,
        > = self.symbol(b"n4m_model_import_from_buffer")?;
        let predict: Symbol<
            unsafe extern "C" fn(
                N4mHandle,
                N4mHandle,
                *const N4mMatrixView,
                *mut N4mMatrixView,
            ) -> N4mStatus,
        > = self.symbol(b"n4m_model_predict")?;
        let model_destroy: Symbol<unsafe extern "C" fn(N4mHandle)> =
            self.symbol(b"n4m_model_destroy")?;
        let mut ctx = NativeHandleGuard::new(*context_destroy);
        unsafe {
            self.check(context_create(&mut ctx.handle), "n4m_context_create", None)?;
        }
        let mut model = NativeHandleGuard::new(*model_destroy);
        let import_result = unsafe {
            self.check(
                import(
                    ctx.handle,
                    model_n4mm.as_ptr().cast(),
                    model_n4mm.len(),
                    &mut model.handle,
                ),
                "n4m_model_import_from_buffer",
                Some(ctx.handle),
            )
        };
        import_result?;
        #[cfg(test)]
        NATIVE_MODEL_IMPORTS.set(NATIVE_MODEL_IMPORTS.get() + 1);
        let prediction = unsafe {
            self.check(
                predict(ctx.handle, model.handle, &x_view, &mut out_view),
                "n4m_model_predict",
                Some(ctx.handle),
            )
        };
        prediction?;
        #[cfg(test)]
        NATIVE_MODEL_PREDICTS.set(NATIVE_MODEL_PREDICTS.get() + 1);
        Ok(out)
    }

    fn symbol<T>(&self, name: &[u8]) -> Result<Symbol<'_, T>, String> {
        unsafe { self.library.get::<T>(name) }.map_err(|error| {
            format!(
                "could not load symbol {}: {error}",
                String::from_utf8_lossy(name)
            )
        })
    }

    fn check(
        &self,
        status: N4mStatus,
        function_name: &str,
        ctx: Option<N4mHandle>,
    ) -> Result<(), String> {
        if status == N4M_OK {
            return Ok(());
        }
        let status_to_string: Result<Symbol<unsafe extern "C" fn(N4mStatus) -> *const c_char>, _> =
            unsafe { self.library.get(b"n4m_status_to_string") };
        let status_text = status_to_string
            .ok()
            .and_then(|func| unsafe { c_string(func(status)) })
            .unwrap_or_else(|| format!("status {status}"));
        let context_error = ctx.filter(|handle| !handle.is_null()).and_then(|handle| {
            let last_error: Result<Symbol<unsafe extern "C" fn(N4mHandle) -> *const c_char>, _> =
                unsafe { self.library.get(b"n4m_context_last_error") };
            last_error
                .ok()
                .and_then(|func| unsafe { c_string(func(handle)) })
                .filter(|message| !message.is_empty())
        });
        match context_error {
            Some(message) => Err(format!("{function_name} failed: {status_text}: {message}")),
            None => Err(format!("{function_name} failed: {status_text}")),
        }
    }
}

fn matrix_view(data: &mut [f64], rows: usize, cols: usize) -> Result<N4mMatrixView, String> {
    let expected = rows
        .checked_mul(cols)
        .ok_or_else(|| format!("matrix dimensions {rows}x{cols} overflow usize"))?;
    if data.len() != expected {
        return Err(format!(
            "matrix length {} does not match {rows}x{cols}",
            data.len()
        ));
    }
    Ok(N4mMatrixView {
        data: data.as_mut_ptr().cast::<c_void>(),
        rows: i64::try_from(rows).map_err(|_| format!("row count {rows} is outside i64 range"))?,
        cols: i64::try_from(cols)
            .map_err(|_| format!("column count {cols} is outside i64 range"))?,
        row_stride: i64::try_from(cols)
            .map_err(|_| format!("column count {cols} is outside i64 range"))?,
        col_stride: 1,
        dtype: N4M_DTYPE_F64,
        reserved0: 0,
    })
}

fn copy_indices(ptr: *const i64, len: i64) -> Result<Vec<usize>, String> {
    if len < 0 {
        return Err(format!("split result contains a negative length: {len}"));
    }
    if len == 0 {
        return Ok(Vec::new());
    }
    if ptr.is_null() {
        return Err("split result contains a null index buffer".to_string());
    }
    let values = unsafe { std::slice::from_raw_parts(ptr, len as usize) };
    values
        .iter()
        .map(|&value| {
            usize::try_from(value)
                .map_err(|_| format!("split index {value} cannot be represented as usize"))
        })
        .collect()
}

unsafe fn c_string(ptr: *const c_char) -> Option<String> {
    if ptr.is_null() {
        None
    } else {
        Some(CStr::from_ptr(ptr).to_string_lossy().into_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    #[test]
    fn portable_execution_contract_cases_are_shared_and_bounded() {
        let cases: Value = serde_json::from_str(include_str!(
            "../tests/parity/fixtures/execution_contract_cases.json"
        ))
        .unwrap();
        for case in cases["invalid"].as_array().unwrap() {
            assert!(
                parse_execution_plan(case).is_err(),
                "accepted {}",
                case["name"]
            );
        }
        for case in cases["valid"].as_array().unwrap() {
            let plan = parse_execution_plan(case).unwrap();
            assert_eq!(
                serde_json::json!(plan.n_components),
                case["components"],
                "{}",
                case["name"]
            );
        }
    }

    #[test]
    fn exposes_expected_upstream_keys() {
        let keys: Vec<_> = UPSTREAMS.iter().map(|item| item.key).collect();
        assert_eq!(
            keys,
            vec![
                "dag_ml",
                "dag_ml_data",
                "formats",
                "io",
                "datasets",
                "methods"
            ]
        );
    }

    #[test]
    fn resolves_upstream_by_key() {
        assert_eq!(upstream("methods").unwrap().package, "nirs4all-methods");
        assert!(upstream("unknown").is_none());
    }

    #[test]
    fn rust_local_implementation_registry_facade_delegates_to_dag_ml() {
        type CriterionFn = fn(f64, f64) -> f64;

        let loss = rust_loss_reference();
        let metric = rust_metric_reference();
        let mut registry = local_implementation_registry::<CriterionFn>();

        registry
            .register_loss(&loss, |target, prediction| (prediction - target).abs())
            .unwrap();
        registry
            .register_metric(&metric, |target, prediction| prediction - target)
            .unwrap();

        assert_eq!(registry.resolve_loss(&loss).unwrap()(2.0, 5.5), 3.5);
        assert_eq!(registry.resolve_metric(&metric).unwrap()(2.0, 5.5), 3.5);
        assert_eq!(registry.len(), 2);
    }

    #[test]
    fn exposes_custom_host_capability_manifest() {
        let ids: Vec<_> = CONTROLLER_CAPABILITIES.iter().map(|item| item.id).collect();
        assert_eq!(
            ids,
            vec![
                "split.kennard_stone",
                "preprocess.snv",
                "preprocess.savgol",
                "model.pls_regression",
                "pipeline.portable_methods"
            ]
        );

        let covered: Vec<_> = CONTROLLER_CAPABILITIES
            .iter()
            .flat_map(|item| item.operator_classes.iter().copied())
            .collect();
        assert_eq!(covered, PORTABLE_OPERATOR_CLASSES);

        let manifest = capability_manifest();
        assert_eq!(manifest["schema"], "nirs4all-core.capabilities.v1");
        assert_eq!(
            manifest["runtime_surfaces"],
            serde_json::json!(RUNTIME_SURFACES)
        );
        assert_eq!(
            manifest["runtime_contracts"],
            serde_json::json!([
                {
                    "surface": "python",
                    "pipeline_execution": "parity-validated",
                    "pipeline_entrypoint": "run_portable_pipeline",
                    "serialized_model_predict": false,
                    "predict_entrypoint": null
                },
                {
                    "surface": "r",
                    "pipeline_execution": "parity-validated",
                    "pipeline_entrypoint": "nirs4all_run_portable_pipeline",
                    "serialized_model_predict": false,
                    "predict_entrypoint": null
                },
                {
                    "surface": "javascript_wasm",
                    "pipeline_execution": "parity-validated",
                    "pipeline_entrypoint": "runPortablePipeline",
                    "serialized_model_predict": true,
                    "predict_entrypoint": "predictPortablePipeline"
                },
                {
                    "surface": "rust",
                    "pipeline_execution": "parity-validated",
                    "pipeline_entrypoint": "run_portable_pipeline_with_library",
                    "serialized_model_predict": true,
                    "predict_entrypoint": "predict_exported_portable_model_with_library"
                },
                {
                    "surface": "matlab_octave",
                    "pipeline_execution": "parity-validated",
                    "pipeline_entrypoint": "runPortablePipeline",
                    "serialized_model_predict": false,
                    "predict_entrypoint": null
                }
            ])
        );
        assert_eq!(
            manifest["artifact_contracts"],
            serde_json::json!([
                {
                    "id": "conformal.calibrated_result",
                    "schema": "nirs4all.dagml.conformal_store.v1",
                    "producer": "full-python-nirs4all",
                    "consumer_level": {
                        "python": "metadata",
                        "r": "metadata",
                        "javascript_wasm": "metadata",
                        "rust": "metadata",
                        "matlab_octave": "metadata"
                    },
                    "python_surface": "nirs4all.calibrate / nirs4all.predict_calibrated / nirs4all.load_calibrated_result",
                    "portable_claim": "not-exposed-in-nirs4all-core",
                    "optional_payload_fields": [
                        "conformal_guarantee_status",
                        "calibration_replay_source",
                        "tuning_calibration_source"
                    ],
                    "required_registry_entries": []
                },
                {
                    "id": "robustness.summary",
                    "schema": "https://nirs4all.org/schemas/robustness-summary/v1",
                    "producer": "full-python-nirs4all",
                    "consumer_level": {
                        "python": "metadata",
                        "r": "metadata",
                        "javascript_wasm": "metadata",
                        "rust": "metadata",
                        "matlab_octave": "metadata"
                    },
                    "python_surface": "nirs4all.RobustnessReport.summary_artifact / nirs4all.robustness_summary_schema_json",
                    "portable_claim": "summary-json-contract-only",
                    "optional_payload_fields": ["conformal_guarantee_status", "spectral_replay"],
                    "required_registry_entries": []
                },
                {
                    "id": "tuning.summary",
                    "schema": "https://nirs4all.org/schemas/tuning-summary/v1",
                    "producer": "full-python-nirs4all",
                    "consumer_level": {
                        "python": "metadata",
                        "r": "metadata",
                        "javascript_wasm": "metadata",
                        "rust": "metadata",
                        "matlab_octave": "metadata"
                    },
                    "python_surface": "nirs4all.TuningResult.summary_artifact / nirs4all.tuning_summary_schema_json",
                    "portable_claim": "summary-json-contract-only",
                    "optional_payload_fields": ["sampler", "pruner", "seed", "persistence", "trials[*].diagnostics"],
                    "required_registry_entries": []
                },
                {
                    "id": "tuning.ordered_search_space",
                    "schema": "https://nirs4all.org/schemas/tuning-ordered-search-space/v1",
                    "producer": "full-python-nirs4all",
                    "consumer_level": {
                        "python": "metadata",
                        "r": "metadata",
                        "javascript_wasm": "metadata",
                        "rust": "metadata",
                        "matlab_octave": "metadata"
                    },
                    "python_surface": "nirs4all.inspect_tuning_space / nirs4all.NativeTuning.inspect_space / nirs4all.tuning_space_schema_json / nirs4all CLI tuning-space",
                    "portable_claim": "search-space-json-contract-only",
                    "optional_payload_fields": [],
                    "required_registry_entries": ["run.tuning.space", "run.tuning.force_params"]
                },
                {
                    "id": "keyword.registry",
                    "schema": "nirs4all.keyword_registry.v1",
                    "producer": "full-python-nirs4all",
                    "consumer_level": {
                        "python": "metadata",
                        "r": "metadata",
                        "javascript_wasm": "metadata",
                        "rust": "metadata",
                        "matlab_octave": "metadata"
                    },
                    "python_surface": "nirs4all.get_keyword_registry / nirs4all.keyword_registry_json / nirs4all.keyword_registry_schema_json / nirs4all.TUNING_OPTIMIZER_PERSISTENCE_KEYS / nirs4all.ROBUSTNESS_SCENARIO_KINDS / nirs4all.ROBUSTNESS_STOCHASTIC_SCENARIO_KINDS / nirs4all.ROBUSTNESS_SCENARIO_DISTRIBUTIONS / nirs4all.ROBUSTNESS_MODES / nirs4all.ROBUSTNESS_EXECUTABLE_MODES",
                    "portable_claim": "registry-json-contract-only",
                    "optional_payload_fields": [],
                    "published_constants": {
                        "ROBUSTNESS_SCENARIO_DISTRIBUTIONS": ["normal", "uniform"]
                    },
                    "required_registry_entries": [
                        "run.tuning",
                        "run.tuning.engine",
                        "run.tuning.space",
                        "run.tuning.force_params",
                        "run.tuning.score_data",
                        "run.tuning.score_data.conformal_calibration",
                        "predict.coverage",
                        "predict.all_predictions",
                        "robustness.scenarios.kind",
                        "robustness.scenarios.severity",
                        "robustness.scenarios.distribution",
                        "robustness.X",
                        "robustness.predictor",
                        "robustness.predictor_bundle"
                    ]
                }
            ])
        );
        assert_eq!(manifest["controllers"].as_array().unwrap().len(), 5);
        assert_eq!(
            manifest["controllers"][0]["runtime"]["rust"],
            "parity-validated"
        );
    }

    #[test]
    fn json_and_yaml_pipeline_fixtures_use_same_nirs4all_syntax() {
        let json = include_str!("../tests/parity/fixtures/portable_methods_pipeline.json");
        let yaml = include_str!("../tests/parity/fixtures/portable_methods_pipeline.yaml");
        let json_pipeline = load_pipeline_definition_str(json).unwrap();
        let yaml_pipeline = load_pipeline_definition_str(yaml).unwrap();

        assert_eq!(json_pipeline, yaml_pipeline);
        assert_eq!(
            portable_class_names(&json_pipeline),
            vec![
                "nirs4all.operators.splitters.KennardStoneSplitter",
                "nirs4all.operators.transforms.StandardNormalVariate",
                "nirs4all.operators.transforms.SavitzkyGolay",
                "sklearn.cross_decomposition.PLSRegression",
            ]
        );
        assert_eq!(
            json_pipeline["pipeline"][3]["_range_"],
            serde_json::json!([2, 11, 2])
        );
    }

    #[test]
    fn savgol_default_polyorder_matches_full_python_nirs4all() {
        let definition = serde_json::json!({
            "pipeline": [
                {
                    "class": "nirs4all.operators.transforms.SavitzkyGolay",
                    "params": { "window_length": 11 }
                },
                {
                    "model": {
                        "class": "sklearn.cross_decomposition.PLSRegression",
                        "params": { "n_components": 2 }
                    }
                }
            ]
        });
        let plan = parse_execution_plan(&definition).unwrap();

        assert_eq!(
            plan.preprocessing,
            vec![PortablePreprocessing::SavitzkyGolay(SavitzkyGolayParams {
                window_length: 11,
                polyorder: 3,
                deriv: 0,
                mode: 4,
                cval: 0.0,
            })]
        );
    }

    #[test]
    fn savgol_mode_and_cval_are_preserved() {
        let definition = serde_json::json!({
            "pipeline": [
                {
                    "class": "nirs4all.operators.transforms.SavitzkyGolay",
                    "params": { "window_length": 11, "mode": "constant", "cval": 7.25 }
                },
                {
                    "model": {
                        "class": "sklearn.cross_decomposition.PLSRegression",
                        "params": { "n_components": 2 }
                    }
                }
            ]
        });
        let plan = parse_execution_plan(&definition).unwrap();

        assert_eq!(
            plan.preprocessing,
            vec![PortablePreprocessing::SavitzkyGolay(SavitzkyGolayParams {
                window_length: 11,
                polyorder: 3,
                deriv: 0,
                mode: 1,
                cval: 7.25,
            })]
        );
    }

    #[test]
    fn matrix_view_rejects_invalid_input_before_any_native_handle_is_created() {
        let mut values = Vec::new();
        let error = matrix_view(&mut values, 1, 1).unwrap_err();
        assert!(error.contains("does not match"));
    }

    #[test]
    fn matrix_view_refuses_dimension_overflow_before_native_handle_creation() {
        let mut values = Vec::new();
        let error = matrix_view(&mut values, usize::MAX, 2).unwrap_err();
        assert!(error.contains("overflow"));
    }

    #[test]
    fn execution_plan_rejects_lossy_operator_parameter_coercions() {
        let definition = serde_json::json!({
            "pipeline": [
                {
                    "class": "nirs4all.operators.transforms.SavitzkyGolay",
                    "params": { "window_length": 10.5 }
                },
                {
                    "model": {
                        "class": "sklearn.cross_decomposition.PLSRegression",
                        "params": { "n_components": 2 }
                    }
                }
            ]
        });
        assert!(parse_execution_plan(&definition)
            .unwrap_err()
            .contains("expected integer parameter"));

        let definition = serde_json::json!({
            "pipeline": [
                {
                    "model": {
                        "class": "sklearn.cross_decomposition.PLSRegression",
                        "params": { "n_components": 1.5 }
                    }
                }
            ]
        });
        assert!(parse_execution_plan(&definition)
            .unwrap_err()
            .contains("expected integer parameter"));

        let definition = serde_json::json!({
            "pipeline": [
                {
                    "model": { "class": "sklearn.cross_decomposition.PLSRegression" },
                    "param": "n_components",
                    "_range_": [0, 4, 2]
                }
            ]
        });
        assert!(parse_execution_plan(&definition)
            .unwrap_err()
            .contains("start and stop must be >= 1"));

        let definition = serde_json::json!({
            "pipeline": [
                {
                    "model": { "class": "sklearn.cross_decomposition.PLSRegression" },
                    "param": "n_components",
                    "_range_": [4, 2, 1]
                }
            ]
        });
        assert!(parse_execution_plan(&definition)
            .unwrap_err()
            .contains("start must be <= stop"));
    }

    fn rust_loss_reference() -> dag_ml::LossReference {
        let spec = dag_ml::LossSpec::new(
            "example.loss.absolute@1",
            dag_ml::SemanticSpecKind::Custom,
            BTreeSet::from([dag_ml::LearningTaskKind::Regression]),
            BTreeSet::from([dag_ml::PredictionKind::RegressionPoint]),
            dag_ml::LossReduction::Mean,
            BTreeSet::from([
                dag_ml::CriterionInput::Target,
                dag_ml::CriterionInput::Prediction,
            ]),
            BTreeSet::new(),
            serde_json::json!({}),
        )
        .unwrap();
        let implementation = dag_ml::ImplementationDescriptor::new(
            dag_ml::ImplementationSemanticKind::Loss,
            &spec.loss_id,
            &spec.spec_fingerprint,
            "provider:rust-local",
            "binding:rust",
            "1.0.0",
            "2".repeat(64),
            BTreeSet::new(),
            BTreeSet::new(),
            BTreeSet::from([dag_ml::ImplementationCapability::Deterministic]),
            dag_ml::PortabilityClass::HostLocal,
            dag_ml::ReplayabilityClass::RegistryRequired,
            Some("loss:nirs4all-core:rust:absolute".to_string()),
        )
        .unwrap();
        dag_ml::LossReference {
            spec,
            implementation,
        }
    }

    fn rust_metric_reference() -> dag_ml::MetricReference {
        let spec = dag_ml::MetricSpec::new(
            "example.metric.bias@1",
            dag_ml::SemanticSpecKind::Custom,
            BTreeSet::from([dag_ml::LearningTaskKind::Regression]),
            BTreeSet::from([dag_ml::PredictionKind::RegressionPoint]),
            dag_ml::MetricObjective::Minimize,
            BTreeSet::from([dag_ml::PredictionLevel::Sample]),
            dag_ml::MetricDecomposition::Global,
            dag_ml::MetricReduction::Global,
            BTreeSet::from([
                dag_ml::CriterionInput::Target,
                dag_ml::CriterionInput::Prediction,
            ]),
            BTreeSet::new(),
            serde_json::json!({}),
        )
        .unwrap();
        let implementation = dag_ml::ImplementationDescriptor::new(
            dag_ml::ImplementationSemanticKind::Metric,
            &spec.metric_id,
            &spec.spec_fingerprint,
            "provider:rust-local",
            "binding:rust",
            "1.0.0",
            "3".repeat(64),
            BTreeSet::new(),
            BTreeSet::new(),
            BTreeSet::from([dag_ml::ImplementationCapability::Deterministic]),
            dag_ml::PortabilityClass::HostLocal,
            dag_ml::ReplayabilityClass::RegistryRequired,
            Some("metric:nirs4all-core:rust:bias".to_string()),
        )
        .unwrap();
        dag_ml::MetricReference {
            spec,
            implementation,
        }
    }

    #[test]
    fn all_shared_parity_fixtures_keep_json_and_yaml_in_lockstep() {
        let fixtures = [
            (
                include_str!("../tests/parity/fixtures/portable_kennard_stone_snv_pls.json"),
                include_str!("../tests/parity/fixtures/portable_kennard_stone_snv_pls.yaml"),
            ),
            (
                include_str!("../tests/parity/fixtures/portable_methods_pipeline.json"),
                include_str!("../tests/parity/fixtures/portable_methods_pipeline.yaml"),
            ),
            (
                include_str!("../tests/parity/fixtures/portable_savgol_pls.json"),
                include_str!("../tests/parity/fixtures/portable_savgol_pls.yaml"),
            ),
            (
                include_str!("../tests/parity/fixtures/portable_snv_pls.json"),
                include_str!("../tests/parity/fixtures/portable_snv_pls.yaml"),
            ),
        ];

        for (json, yaml) in fixtures {
            let json_pipeline = load_pipeline_definition_str(json).unwrap();
            let yaml_pipeline = load_pipeline_definition_str(yaml).unwrap();
            assert_eq!(json_pipeline, yaml_pipeline);
            assert!(!portable_class_names(&json_pipeline).is_empty());
        }
    }

    #[test]
    fn steps_alias_and_direct_arrays_match_nirs4all_loader_surface() {
        let json = include_str!("../tests/parity/fixtures/portable_methods_pipeline.json");
        let definition = load_pipeline_definition_str(json).unwrap();

        let from_steps = load_pipeline_definition_str(
            &serde_json::json!({ "steps": definition["pipeline"].clone() }).to_string(),
        )
        .unwrap();
        let from_list = load_pipeline_definition_str(&definition["pipeline"].to_string()).unwrap();

        assert_eq!(from_steps["pipeline"], definition["pipeline"]);
        assert_eq!(from_list["pipeline"], definition["pipeline"]);
    }

    #[test]
    fn rust_binding_execution_matches_full_python_nirs4all_oracle() {
        let library_path = std::env::var("NIRS4ALL_METHODS_LIB");
        let library_path = match library_path {
            Ok(path) => path,
            Err(error) => {
                if std::env::var("NIRS4ALL_CORE_REQUIRE_METHODS_PARITY").as_deref() == Ok("1") {
                    panic!("strict Rust parity requires NIRS4ALL_METHODS_LIB: {error}");
                }
                eprintln!("skipping Rust execution parity: NIRS4ALL_METHODS_LIB is not set");
                return;
            }
        };

        let oracle: Value = serde_json::from_str(include_str!(
            "../tests/parity/expected/portable_python_oracle.json"
        ))
        .unwrap();
        let dataset = PortableDataset::from_json_value(&oracle["dataset"]).unwrap();
        let cases = oracle["cases"].as_array().unwrap();
        let tolerances = &oracle["metadata"]["tolerances"];
        let target_tol = tolerances["targets_abs"].as_f64().unwrap();
        let rmse_tol = tolerances["rmse_abs"].as_f64().unwrap();
        let prediction_tol = tolerances["predictions_abs"].as_f64().unwrap();

        assert!(cases.len() >= 4);
        for expected in cases {
            let name = expected["name"].as_str().unwrap();
            let fixture =
                fixture_for_name(name).unwrap_or_else(|| panic!("missing fixture {name}"));
            let actual =
                run_portable_pipeline_with_library(fixture, &dataset, &library_path).unwrap();
            if actual.split.kind != "all" {
                let mut alternate = load_pipeline_definition_str(fixture).unwrap();
                let steps = alternate["pipeline"].as_array_mut().unwrap();
                let splitter = steps.remove(0);
                steps.insert(steps.len() - 1, splitter);
                assert_eq!(
                    run_portable_pipeline_with_library(
                        &alternate.to_string(),
                        &dataset,
                        &library_path
                    )
                    .unwrap(),
                    actual
                );
            }
            assert_eq!(
                actual.evaluation_scope(),
                if actual.split.kind == "all" {
                    "training"
                } else {
                    "selection_validation"
                }
            );

            assert_eq!(
                actual.split.kind,
                expected["split"]["kind"].as_str().unwrap()
            );
            assert_eq!(
                actual.split.train_indices,
                value_usize_vec(&expected["split"]["trainIndices"])
            );
            assert_eq!(
                actual.split.test_indices,
                value_usize_vec(&expected["split"]["testIndices"])
            );
            assert!(
                max_abs_diff(&actual.targets, &value_f64_vec(&expected["targets"])) <= target_tol,
                "{name}: target diff exceeded tolerance"
            );
            let expected_variants = expected["variants"].as_array().unwrap();
            assert_eq!(actual.variants.len(), expected_variants.len(), "{name}");
            for (actual_variant, expected_variant) in actual.variants.iter().zip(expected_variants)
            {
                assert_eq!(
                    actual_variant.n_components,
                    expected_variant["n_components"].as_i64().unwrap() as i32,
                    "{name}: component mismatch"
                );
                assert!(
                    (actual_variant.rmse - expected_variant["rmse"].as_f64().unwrap()).abs()
                        <= rmse_tol,
                    "{name}: RMSE diff for n_components={}",
                    actual_variant.n_components
                );
                assert!(
                    max_abs_diff(
                        &actual_variant.predictions,
                        &value_f64_vec(&expected_variant["predictions"])
                    ) <= prediction_tol,
                    "{name}: prediction diff for n_components={}",
                    actual_variant.n_components
                );
            }
            assert_eq!(
                actual.selected.n_components,
                expected["selected"]["n_components"].as_i64().unwrap() as i32,
                "{name}: selected component mismatch"
            );
        }
    }

    fn fixture_for_name(name: &str) -> Option<&'static str> {
        match name {
            "portable_kennard_stone_snv_pls" => Some(include_str!(
                "../tests/parity/fixtures/portable_kennard_stone_snv_pls.json"
            )),
            "portable_methods_pipeline" => Some(include_str!(
                "../tests/parity/fixtures/portable_methods_pipeline.json"
            )),
            "portable_savgol_pls" => Some(include_str!(
                "../tests/parity/fixtures/portable_savgol_pls.json"
            )),
            "portable_snv_pls" => Some(include_str!(
                "../tests/parity/fixtures/portable_snv_pls.json"
            )),
            _ => None,
        }
    }

    fn value_usize_vec(value: &Value) -> Vec<usize> {
        value
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item.as_u64().unwrap() as usize)
            .collect()
    }

    fn value_f64_vec(value: &Value) -> Vec<f64> {
        value
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item.as_f64().unwrap())
            .collect()
    }

    fn max_abs_diff(actual: &[f64], expected: &[f64]) -> f64 {
        assert_eq!(actual.len(), expected.len());
        actual
            .iter()
            .zip(expected)
            .map(|(left, right)| (left - right).abs())
            .fold(0.0, f64::max)
    }
}
