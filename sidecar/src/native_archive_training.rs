//! Bounded native researcher path from a persisted IO dataset to Archive V2.
//!
//! Studio owns only request validation, persisted identity resolution, job
//! lifecycle and Store registration. IO materializes the `DatasetPackage`, DAG-ML
//! builds and executes the training contract, Methods owns SNV/SG/PLS, and Core
//! owns Archive V2 serialization.

use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
};

use nirs4all::{
    dag_ml::{
        BundleId, DataBinding, GraphSpec, RunId, TrainingDataIdentity, TrainingRequest,
        TRAINING_REQUEST_SCHEMA_VERSION,
    },
    train_dataset_package_methods_archive_v2, DatasetPackage,
    DatasetPackageMethodsArchiveV2Request, DatasetPackageMethodsProvider,
};
use nirs4all_io::api::{load_assembled, Input};
use serde_json::{json, Map, Value};

use crate::{
    archive_v2_prediction::{
        packaged_methods_library_identity, CoreArchiveV2PredictionExecutor,
        PackagedMethodsLibraryIdentity,
    },
    job_http::{
        JobExecutorError, ScientificExecutionRequest, ScientificExecutorSelection,
        ScientificJobExecutor, ScientificJobTerminal, ScientificSubmissionPreflight,
    },
    settings::AppSettingsStore,
    workspace_store::{register_archive_v2_artifact, WorkspaceStoreArchiveV2Registration},
};

pub const NATIVE_ARCHIVE_TRAINING_ROUTE: &str = "/api/training/native-archive-v2";
pub const NATIVE_ARCHIVE_TRAINING_BACKEND: &str = "native-rust-methods";
const NATIVE_ARCHIVE_TRAINING_OPERATION: &str = "native_dataset_train_archive_v2";
const CANONICAL_PIPELINE_PROFILE: &str = "snv_savgol_pls_v1";
const MAX_DATASET_BYTES: u64 = 256 * 1024 * 1024;
const MAX_SAMPLES: usize = 100_000;
const MAX_FEATURES: usize = crate::matrix_limits::MAX_SPECTRAL_FEATURES;
const MAX_CELLS: usize = 20_000_000;
const MAX_TARGETS: usize = 64;
const MAX_FOLDS: usize = 50;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NativeArchiveTrainingRequest {
    pub workspace_id: String,
    pub run_name: String,
    pub dataset_id: String,
    pub source_id: String,
    pub savgol_window: i32,
    pub savgol_poly_degree: i32,
    pub n_components: i32,
    pub payload: Value,
}

#[derive(Clone, Debug)]
struct PreparedNativeArchiveTraining {
    workspace_id: String,
    dataset_id: String,
    dataset_path: PathBuf,
    source_id: String,
    savgol_window: i32,
    savgol_poly_degree: i32,
    n_components: i32,
}

#[derive(Debug)]
pub struct NativeArchiveTrainingExecutor {
    config_dir: PathBuf,
    methods: PackagedMethodsLibraryIdentity,
    cancellations: Arc<Mutex<BTreeMap<String, Arc<AtomicBool>>>>,
}

impl NativeArchiveTrainingExecutor {
    pub fn acquire(config_dir: impl Into<PathBuf>) -> Option<Self> {
        let methods = packaged_methods_library_identity()?;
        CoreArchiveV2PredictionExecutor::acquire(methods.clone()).ok()?;
        Some(Self::with_methods(config_dir, methods))
    }

    pub(crate) fn with_methods(
        config_dir: impl Into<PathBuf>,
        methods: PackagedMethodsLibraryIdentity,
    ) -> Self {
        Self {
            config_dir: config_dir.into(),
            methods,
            cancellations: Arc::new(Mutex::new(BTreeMap::new())),
        }
    }

    fn prepare(
        &self,
        request: &ScientificSubmissionPreflight,
    ) -> Result<PreparedNativeArchiveTraining, JobExecutorError> {
        if request.requested_backend != NATIVE_ARCHIVE_TRAINING_BACKEND {
            return Err(JobExecutorError::PreflightRefused);
        }
        let parsed = parse_request_value(&request.payload)
            .map_err(|_| JobExecutorError::PreflightRefused)?;
        if parsed.workspace_id != request.workspace_id {
            return Err(JobExecutorError::PreflightRefused);
        }
        let workspace = request
            .workspace_path
            .canonicalize()
            .map_err(|_| JobExecutorError::PreflightRefused)?;
        if workspace != request.workspace_path || !workspace.is_dir() {
            return Err(JobExecutorError::PreflightRefused);
        }
        let dataset = AppSettingsStore::new(&self.config_dir)
            .dataset_links()
            .map_err(|_| JobExecutorError::PreflightRefused)?
            .into_iter()
            .find(|dataset| dataset.id == parsed.dataset_id && !dataset.path.is_empty())
            .ok_or(JobExecutorError::PreflightRefused)?;
        let configured = PathBuf::from(dataset.path);
        let metadata =
            fs::symlink_metadata(&configured).map_err(|_| JobExecutorError::PreflightRefused)?;
        let dataset_path = configured
            .canonicalize()
            .map_err(|_| JobExecutorError::PreflightRefused)?;
        if metadata.file_type().is_symlink()
            || (!metadata.is_file() && !metadata.is_dir())
            || metadata.len() > MAX_DATASET_BYTES
            || dataset_path != configured
        {
            return Err(JobExecutorError::PreflightRefused);
        }
        Ok(PreparedNativeArchiveTraining {
            workspace_id: parsed.workspace_id,
            dataset_id: parsed.dataset_id,
            dataset_path,
            source_id: parsed.source_id,
            savgol_window: parsed.savgol_window,
            savgol_poly_degree: parsed.savgol_poly_degree,
            n_components: parsed.n_components,
        })
    }
}

impl ScientificJobExecutor for NativeArchiveTrainingExecutor {
    fn is_selected(&self) -> bool {
        true
    }

    fn preflight_submission(
        &self,
        request: &ScientificSubmissionPreflight,
    ) -> Result<ScientificExecutorSelection, JobExecutorError> {
        let prepared = self.prepare(request)?;
        Ok(ScientificExecutorSelection {
            execution_backend: NATIVE_ARCHIVE_TRAINING_BACKEND.into(),
            execution_mode: Some(CANONICAL_PIPELINE_PROFILE.into()),
            prepared_payload: json!({
                "workspace_id": prepared.workspace_id,
                "dataset_id": prepared.dataset_id,
                "dataset_path": prepared.dataset_path,
                "source_id": prepared.source_id,
                "savgol_window": prepared.savgol_window,
                "savgol_poly_degree": prepared.savgol_poly_degree,
                "n_components": prepared.n_components,
            }),
        })
    }

    fn submit_scientific(
        &self,
        request: &ScientificExecutionRequest,
        terminal: Arc<dyn ScientificJobTerminal>,
    ) -> Result<(), JobExecutorError> {
        let prepared = prepared_from_value(&request.payload)?;
        if prepared.workspace_id != request.workspace_id
            || request.requested_backend != NATIVE_ARCHIVE_TRAINING_BACKEND
        {
            return Err(JobExecutorError::SubmissionRefused);
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        self.cancellations
            .lock()
            .map_err(|_| JobExecutorError::SubmissionRefused)?
            .insert(request.job_id.clone(), Arc::clone(&cancelled));
        let cancellations = Arc::clone(&self.cancellations);
        let methods = self.methods.clone();
        let execution = request.clone();
        thread::Builder::new()
            .name(format!("native-train-{}", execution.job_id))
            .spawn(move || {
                let result = execute_native_training(&execution, &prepared, &methods, &cancelled);
                let callback = match result {
                    Ok(result) => terminal.complete(&execution.job_id, result),
                    Err(NativeTrainingFailure::Cancelled) => {
                        terminal.acknowledge_cancel(&execution.job_id)
                    }
                    Err(NativeTrainingFailure::Failed) => terminal.fail(
                        &execution.job_id,
                        "Native IO/DAG/Methods Archive V2 training failed",
                    ),
                };
                let _ = callback;
                cancellations
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .remove(&execution.job_id);
            })
            .map_err(|_| JobExecutorError::SubmissionRefused)?;
        Ok(())
    }

    fn request_cooperative_cancel(&self, job_id: &str) -> Result<(), JobExecutorError> {
        let cancelled = self
            .cancellations
            .lock()
            .map_err(|_| JobExecutorError::CancellationRefused)?
            .get(job_id)
            .cloned()
            .ok_or(JobExecutorError::CancellationRefused)?;
        cancelled.store(true, Ordering::Release);
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum NativeTrainingFailure {
    Cancelled,
    Failed,
}

fn execute_native_training(
    execution: &ScientificExecutionRequest,
    prepared: &PreparedNativeArchiveTraining,
    methods: &PackagedMethodsLibraryIdentity,
    cancelled: &AtomicBool,
) -> Result<Value, NativeTrainingFailure> {
    cancellation_point(cancelled)?;
    let dataset_path = prepared
        .dataset_path
        .to_str()
        .ok_or(NativeTrainingFailure::Failed)?;
    let assembled = load_assembled(&Input::Path(dataset_path.into()), None, None)
        .map_err(|_| NativeTrainingFailure::Failed)?;
    let package = DatasetPackage::from_assembled(&assembled);
    validate_materialized_package(&package, &prepared.source_id, prepared.savgol_window)
        .map_err(|_| NativeTrainingFailure::Failed)?;
    cancellation_point(cancelled)?;
    let provider = DatasetPackageMethodsProvider::new(&package, &prepared.source_id)
        .map_err(|_| NativeTrainingFailure::Failed)?;
    let targets = target_names(&package).map_err(|_| NativeTrainingFailure::Failed)?;
    let training_request = build_training_request(prepared, &package, &provider, &targets)
        .map_err(|_| NativeTrainingFailure::Failed)?;
    drop(provider);

    let artifacts = execution.workspace_path.join("artifacts/models");
    ensure_artifact_directory(&execution.workspace_path, &artifacts)?;
    let archive_name = format!("{}.n4a", execution.job_id);
    let archive_path = artifacts.join(&archive_name);
    let archive_id = format!("archive:{}", execution.job_id);
    let outcome_id = format!("outcome:{}", execution.job_id);
    let package_id = format!("predictor:{}", execution.job_id);
    let outcome = train_dataset_package_methods_archive_v2(DatasetPackageMethodsArchiveV2Request {
        dataset: &package,
        source_id: &prepared.source_id,
        training_request: &training_request,
        outcome_id: &outcome_id,
        run_id: RunId::new(format!("run:{}", execution.job_id))
            .map_err(|_| NativeTrainingFailure::Failed)?,
        bundle_id: BundleId::new(format!("bundle:{}", execution.job_id))
            .map_err(|_| NativeTrainingFailure::Failed)?,
        package_id: &package_id,
        archive_id: &archive_id,
        archive_path: &archive_path,
        methods_library_path: &methods.path,
    })
    .map_err(|_| NativeTrainingFailure::Failed)?;
    if cancelled.load(Ordering::Acquire) {
        let _ = fs::remove_file(&archive_path);
        return Err(NativeTrainingFailure::Cancelled);
    }
    let size_bytes = fs::metadata(&archive_path)
        .map_err(|_| NativeTrainingFailure::Failed)?
        .len();
    let registration = WorkspaceStoreArchiveV2Registration {
        artifact_id: archive_id.clone(),
        artifact_path: format!("models/{archive_name}"),
        content_hash: outcome.archive.archive_sha256().into(),
    };
    if register_archive_v2_artifact(&execution.workspace_path, &registration, size_bytes).is_err() {
        let _ = fs::remove_file(&archive_path);
        return Err(NativeTrainingFailure::Failed);
    }
    Ok(json!({
        "schema_version": 1,
        "operation": NATIVE_ARCHIVE_TRAINING_OPERATION,
        "dataset_id": prepared.dataset_id,
        "source_id": prepared.source_id,
        "archive_id": archive_id,
        "archive_ref": format!("artifacts/{}", registration.artifact_path),
        "archive_sha256": registration.content_hash,
        "format": "n4a",
        "ref_count": 1,
        "fallback_used": false,
    }))
}

fn cancellation_point(cancelled: &AtomicBool) -> Result<(), NativeTrainingFailure> {
    if cancelled.load(Ordering::Acquire) {
        Err(NativeTrainingFailure::Cancelled)
    } else {
        Ok(())
    }
}

fn ensure_artifact_directory(
    workspace: &Path,
    artifacts: &Path,
) -> Result<(), NativeTrainingFailure> {
    let canonical_workspace = workspace
        .canonicalize()
        .map_err(|_| NativeTrainingFailure::Failed)?;
    if canonical_workspace != workspace {
        return Err(NativeTrainingFailure::Failed);
    }
    fs::create_dir_all(artifacts).map_err(|_| NativeTrainingFailure::Failed)?;
    let metadata = fs::symlink_metadata(artifacts).map_err(|_| NativeTrainingFailure::Failed)?;
    let canonical = artifacts
        .canonicalize()
        .map_err(|_| NativeTrainingFailure::Failed)?;
    if metadata.file_type().is_symlink()
        || !metadata.is_dir()
        || !canonical.starts_with(&canonical_workspace)
    {
        return Err(NativeTrainingFailure::Failed);
    }
    Ok(())
}

fn validate_materialized_package(
    package: &DatasetPackage,
    source_id: &str,
    savgol_window: i32,
) -> Result<(), NativeTrainingFailure> {
    if package.task_type != "regression"
        || package.n_sources < 2
        || package.partitions.len() != 1
        || !package.partitions.contains_key("train")
        || package.folds.len() < 2
        || package.folds.len() > MAX_FOLDS
        || package.fold_provenance.len() != package.folds.len()
        || package.row_position_fallback.used
    {
        return Err(NativeTrainingFailure::Failed);
    }
    let assembled = package.to_assembled();
    let block = assembled
        .blocks
        .get("train")
        .ok_or(NativeTrainingFailure::Failed)?;
    let source = block
        .source_ids
        .iter()
        .position(|candidate| candidate == source_id)
        .ok_or(NativeTrainingFailure::Failed)?;
    let features = block.x.get(source).ok_or(NativeTrainingFailure::Failed)?;
    if block.n_samples < 4
        || block.n_samples > MAX_SAMPLES
        || features.n_rows != block.n_samples
        || features.n_cols == 0
        || features.n_cols > MAX_FEATURES
        || features.n_rows.saturating_mul(features.n_cols) > MAX_CELLS
        || usize::try_from(savgol_window).map_or(true, |window| window > features.n_cols)
        || block
            .processings
            .get(source)
            .is_none_or(|steps| !steps.is_empty())
        || block.y.as_ref().is_none_or(|targets| {
            targets.n_rows != block.n_samples || targets.n_cols == 0 || targets.n_cols > MAX_TARGETS
        })
    {
        return Err(NativeTrainingFailure::Failed);
    }
    Ok(())
}

fn target_names(package: &DatasetPackage) -> Result<Vec<String>, NativeTrainingFailure> {
    let assembled = package.to_assembled();
    let names = assembled
        .blocks
        .get("train")
        .map(|block| block.y_headers.clone())
        .filter(|names| {
            !names.is_empty()
                && names.len() <= MAX_TARGETS
                && names.iter().all(|name| valid_id(name))
        })
        .ok_or(NativeTrainingFailure::Failed)?;
    Ok(names)
}

#[expect(
    clippy::too_many_lines,
    reason = "one explicit closed training-contract construction"
)]
fn build_training_request(
    prepared: &PreparedNativeArchiveTraining,
    package: &DatasetPackage,
    provider: &DatasetPackageMethodsProvider,
    target_names: &[String],
) -> Result<TrainingRequest, NativeTrainingFailure> {
    let envelope = provider.external_envelope();
    let relation_fingerprint = envelope
        .relation_fingerprint
        .clone()
        .ok_or(NativeTrainingFailure::Failed)?;
    let binding: DataBinding = serde_json::from_value(json!({
        "node_id": "model:pls",
        "input_name": "x",
        "request_id": format!("io:{}:{}", prepared.dataset_id, prepared.source_id),
        "schema_fingerprint": envelope.schema_fingerprint,
        "plan_fingerprint": envelope.plan_fingerprint,
        "relation_fingerprint": relation_fingerprint,
        "output_representation": "tabular_numeric",
        "feature_set_id": prepared.source_id,
        "source_ids": [prepared.source_id],
        "require_relations": true,
        "view_policy": {
            "fit_partition": "fold_train",
            "predict_partition": "fold_validation",
            "include_augmented_train": false,
            "include_augmented_validation": false,
            "include_excluded": false,
            "require_sample_ids": true
        },
        "metadata": {}
    }))
    .map_err(|_| NativeTrainingFailure::Failed)?;
    let identity = TrainingDataIdentity::from_binding_envelope(&binding, envelope)
        .map_err(|_| NativeTrainingFailure::Failed)?;
    let (folds, sample_groups) = fold_contract(provider, &package.fold_provenance)?;
    let graph: GraphSpec = serde_json::from_value(json!({
        "id": format!("native-snv-sg-pls:{}", prepared.dataset_id),
        "interface": {
            "inputs": [{"name":"x","kind":"data","representation":"tabular_numeric","cardinality":"one","description":"selected persisted IO source"}],
            "outputs": [{"name":"prediction","kind":"prediction","representation":null,"cardinality":"one","description":"PLS prediction"}]
        },
        "nodes": [{
            "id": "model:pls", "kind": "model", "operator": "pls",
            "params": {
                "n_components": prepared.n_components,
                "pipeline": {
                    "schema_version": 1,
                    "pipeline_type": "n4m.snv_savgol_smooth.v1",
                    "savgol_window": prepared.savgol_window,
                    "savgol_poly_degree": prepared.savgol_poly_degree
                }
            },
            "ports": {
                "inputs": [{"name":"x","kind":"data","representation":"tabular_numeric","cardinality":"one","description":""}],
                "outputs": [{"name":"oof","kind":"prediction","representation":null,"cardinality":"one","description":""}]
            },
            "metadata": {}, "seed_label": null
        }],
        "edges": [], "search_space_fingerprint": null, "metadata": {}
    }))
    .map_err(|_| NativeTrainingFailure::Failed)?;
    let campaign = serde_json::from_value(json!({
        "id": format!("campaign:{}", prepared.dataset_id),
        "root_seed": 91,
        "leakage_policy": {"split_unit":"group","forbid_origin_cross_fold":true,"allow_observation_split_with_shared_target":false,"require_group_ids":true,"unsafe_flags":[]},
        "aggregation_policy": {"aggregation_level":"sample","method":"mean","weights":"none","emit_parallel_metrics":true,"selection_metric_level":"sample","store_raw_predictions":true,"store_aggregated_predictions":true},
        "split_invocation": {
            "id":"io:persisted-folds", "controller_id":null,
            "leakage_policy":{"split_unit":"group","forbid_origin_cross_fold":true,"allow_observation_split_with_shared_target":false,"require_group_ids":true,"unsafe_flags":[]},
            "params":{"kind":"precomputed"},
            "fold_set":{"id":"io:persisted-folds","sample_ids": sample_groups.keys().collect::<Vec<_>>(),"folds":folds,"sample_groups":sample_groups}
        },
        "generation":{"strategy":"none","dimensions":[],"max_variants":1},
        "shape_plans":{"model:pls":{"node_id":"model:pls","input_granularity":"sample","target_granularity":"sample","fit_rows":"fold_train","predict_rows":"fold_validation","feature_namespace":prepared.source_id,"feature_schema_fingerprint":null,"target_space":"raw","aggregation_policy":{"aggregation_level":"sample","method":"mean","weights":"none","emit_parallel_metrics":true,"selection_metric_level":"sample","store_raw_predictions":true,"store_aggregated_predictions":true},"augmentation_policy":{"sample_scope":"train_only","feature_scope":"train_only","require_origin_id":true,"inherit_group":true,"inherit_target":true},"selection_policy":{"scope":"none","store_masks":true,"allow_schema_mismatch_on_join":false}}},
        "data_bindings":{"model:pls":[binding]}, "metadata":{}
    }))
    .map_err(|_| NativeTrainingFailure::Failed)?;
    let controller_manifests = serde_json::from_value(json!([{
        "controller_id":"controller:methods.pls","controller_version":"libn4m-2.5","operator_kind":"model","priority":0,
        "supported_phases":["FIT_CV","REFIT","PREDICT"],
        "input_ports":[{"name":"x","kind":"data","representation":"tabular_numeric","cardinality":"one","description":""}],
        "output_ports":[{"name":"oof","kind":"prediction","representation":null,"cardinality":"one","description":""}],
        "data_requirements":null,
        "capabilities":["deterministic","thread_safe","process_safe","emits_predictions","emits_artifacts","stateful","supports_portable_full_refit"],
        "fit_scope":"fold_train","rng_policy":"uses_core_seed","artifact_policy":"serializable"
    }]))
    .map_err(|_| NativeTrainingFailure::Failed)?;
    let options = serde_json::from_value(json!({
        "refit":true,"refit_strategy":"refit_one","seed":91,
        "selection":{"id":"selection:rmse","metric":{"name":"rmse","objective":"minimize"},"required_metric_level":"sample","require_finite":true,"evaluation_scope":"oof"},
        "selection_output_id":"output:prediction",
        "outputs":[{"output_id":"output:prediction","node_id":"model:pls","port_name":"oof","prediction_level":"sample","unit_level":"physical_sample","prediction_kind":"regression_point","target_names":target_names,"target_units":vec![Value::Null; target_names.len()],"class_labels":vec![Vec::<String>::new(); target_names.len()],"output_order":"target_order","target_space":"raw"}],
        "scheduler":{"kind":"sequential","backend":null,"workers":1},
        "resources":{"cpu_threads":1,"memory_bytes":null,"gpu_devices":[],"wall_time_ms":null},
        "artifacts":{"cv_artifacts":"discard","prediction_caches":"retain","fitted_artifacts":"portable_required"}
    }))
    .map_err(|_| NativeTrainingFailure::Failed)?;
    let mut request = TrainingRequest {
        schema_version: TRAINING_REQUEST_SCHEMA_VERSION,
        request_id: format!("training:{}", prepared.dataset_id),
        plan_id: format!("plan:{}", prepared.dataset_id),
        graph,
        campaign,
        controller_manifests,
        data_identities: vec![identity],
        parameter_patches: vec![],
        patch_policies: vec![],
        influence_requirements: vec![],
        training_losses: vec![],
        options,
        request_fingerprint: "0".repeat(64),
    };
    request.request_fingerprint = request
        .compute_fingerprint()
        .map_err(|_| NativeTrainingFailure::Failed)?;
    request
        .project()
        .map_err(|_| NativeTrainingFailure::Failed)?;
    Ok(request)
}

fn fold_contract(
    provider: &DatasetPackageMethodsProvider,
    provenance: &[nirs4all_io::core::materialize::FoldProvenance],
) -> Result<(Vec<Value>, BTreeMap<String, String>), NativeTrainingFailure> {
    let relations = provider.relations();
    let mut observation_samples = BTreeMap::new();
    let mut sample_groups = BTreeMap::new();
    for relation in &relations.records {
        if relation.source_id.as_deref() != Some(provider.source_id())
            || relation.target_id.is_none()
        {
            return Err(NativeTrainingFailure::Failed);
        }
        let sample = relation.sample_id.as_str().to_owned();
        let observation = relation.observation_id.as_str().to_owned();
        let group = relation
            .group_id
            .as_ref()
            .map(|value| value.as_str().to_owned())
            .ok_or(NativeTrainingFailure::Failed)?;
        if observation_samples
            .insert(observation, sample.clone())
            .is_some()
            || sample_groups.insert(sample, group).is_some()
        {
            return Err(NativeTrainingFailure::Failed);
        }
    }
    let mut folds = Vec::with_capacity(provenance.len());
    for (index, provenance) in provenance.iter().enumerate() {
        let train =
            observation_ids_to_samples(&provenance.train_observation_ids, &observation_samples)?;
        let validation = observation_ids_to_samples(
            &provenance.validation_observation_ids,
            &observation_samples,
        )?;
        if train.is_empty()
            || validation.is_empty()
            || !train.iter().all(|sample| !validation.contains(sample))
        {
            return Err(NativeTrainingFailure::Failed);
        }
        folds.push(json!({
            "fold_id": format!("io.fold.{index}"),
            "train_sample_ids": train,
            "validation_sample_ids": validation,
            "metadata": {}
        }));
    }
    Ok((folds, sample_groups))
}

fn observation_ids_to_samples(
    observations: &[String],
    mapping: &BTreeMap<String, String>,
) -> Result<Vec<String>, NativeTrainingFailure> {
    let samples = observations
        .iter()
        .map(|observation| {
            mapping
                .get(observation)
                .cloned()
                .ok_or(NativeTrainingFailure::Failed)
        })
        .collect::<Result<Vec<_>, _>>()?;
    if samples.iter().collect::<BTreeSet<_>>().len() != samples.len() {
        return Err(NativeTrainingFailure::Failed);
    }
    Ok(samples)
}

pub fn parse_request(body: &[u8]) -> Result<NativeArchiveTrainingRequest, &'static str> {
    if body.len() > crate::MAX_REQUEST_BODY_BYTES {
        return Err("body_too_large");
    }
    let value: Value = serde_json::from_slice(body).map_err(|_| "invalid_json")?;
    parse_request_value(&value)
}

fn parse_request_value(value: &Value) -> Result<NativeArchiveTrainingRequest, &'static str> {
    let root = exact_object(
        value,
        &[
            "schema_version",
            "operation",
            "workspace_id",
            "run_name",
            "dataset",
            "pipeline",
            "execution",
        ],
    )?;
    if root.get("schema_version").and_then(Value::as_u64) != Some(1)
        || root.get("operation").and_then(Value::as_str) != Some(NATIVE_ARCHIVE_TRAINING_OPERATION)
    {
        return Err("unsupported_contract");
    }
    let workspace_id = identifier(root.get("workspace_id"), "workspace_id")?;
    let run_name = text(root.get("run_name"), 128)?;
    let dataset = exact_object(required(root, "dataset")?, &["id", "source_id"])?;
    let dataset_id = identifier(dataset.get("id"), "dataset.id")?;
    let source_id = identifier(dataset.get("source_id"), "dataset.source_id")?;
    let pipeline = exact_object(
        required(root, "pipeline")?,
        &["profile", "snv", "savgol", "pls"],
    )?;
    if pipeline.get("profile").and_then(Value::as_str) != Some(CANONICAL_PIPELINE_PROFILE) {
        return Err("unsupported_profile");
    }
    let snv = exact_object(required(pipeline, "snv")?, &["ddof"])?;
    if snv.get("ddof").and_then(Value::as_u64) != Some(0) {
        return Err("unsupported_snv_parameters");
    }
    let savgol = exact_object(
        required(pipeline, "savgol")?,
        &["mode", "window_length", "polyorder", "deriv", "delta"],
    )?;
    let savgol_window = integer(savgol.get("window_length"), 3, 501)?;
    let savgol_poly_degree = integer(savgol.get("polyorder"), 0, 32)?;
    if savgol.get("mode").and_then(Value::as_str) != Some("interp")
        || savgol.get("deriv").and_then(Value::as_i64) != Some(0)
        || savgol.get("delta").and_then(Value::as_f64) != Some(1.0)
        || savgol_window % 2 == 0
        || savgol_poly_degree >= savgol_window
    {
        return Err("unsupported_savgol_parameters");
    }
    let pls = exact_object(required(pipeline, "pls")?, &["n_components"])?;
    let n_components = integer(pls.get("n_components"), 1, 64)?;
    let execution = exact_object(required(root, "execution")?, &["engine", "allow_fallback"])?;
    if execution.get("engine").and_then(Value::as_str) != Some("core_rust_io_dag_methods")
        || execution.get("allow_fallback") != Some(&Value::Bool(false))
    {
        return Err("unsupported_execution");
    }
    Ok(NativeArchiveTrainingRequest {
        workspace_id,
        run_name,
        dataset_id,
        source_id,
        savgol_window,
        savgol_poly_degree,
        n_components,
        payload: value.clone(),
    })
}

fn prepared_from_value(value: &Value) -> Result<PreparedNativeArchiveTraining, JobExecutorError> {
    let root = exact_object(
        value,
        &[
            "workspace_id",
            "dataset_id",
            "dataset_path",
            "source_id",
            "savgol_window",
            "savgol_poly_degree",
            "n_components",
        ],
    )
    .map_err(|_| JobExecutorError::SubmissionRefused)?;
    Ok(PreparedNativeArchiveTraining {
        workspace_id: identifier(root.get("workspace_id"), "workspace_id")
            .map_err(|_| JobExecutorError::SubmissionRefused)?,
        dataset_id: identifier(root.get("dataset_id"), "dataset_id")
            .map_err(|_| JobExecutorError::SubmissionRefused)?,
        dataset_path: root
            .get("dataset_path")
            .and_then(Value::as_str)
            .map(PathBuf::from)
            .ok_or(JobExecutorError::SubmissionRefused)?,
        source_id: identifier(root.get("source_id"), "source_id")
            .map_err(|_| JobExecutorError::SubmissionRefused)?,
        savgol_window: integer(root.get("savgol_window"), 3, 501)
            .map_err(|_| JobExecutorError::SubmissionRefused)?,
        savgol_poly_degree: integer(root.get("savgol_poly_degree"), 0, 32)
            .map_err(|_| JobExecutorError::SubmissionRefused)?,
        n_components: integer(root.get("n_components"), 1, 64)
            .map_err(|_| JobExecutorError::SubmissionRefused)?,
    })
}

fn exact_object<'a>(
    value: &'a Value,
    fields: &[&str],
) -> Result<&'a Map<String, Value>, &'static str> {
    let object = value.as_object().ok_or("invalid_shape")?;
    if object.len() != fields.len() || fields.iter().any(|field| !object.contains_key(*field)) {
        return Err("invalid_shape");
    }
    Ok(object)
}

fn required<'a>(object: &'a Map<String, Value>, field: &str) -> Result<&'a Value, &'static str> {
    object.get(field).ok_or("invalid_shape")
}

fn identifier(value: Option<&Value>, _label: &'static str) -> Result<String, &'static str> {
    value
        .and_then(Value::as_str)
        .filter(|value| valid_id(value))
        .map(str::to_owned)
        .ok_or("invalid_identifier")
}

fn text(value: Option<&Value>, maximum: usize) -> Result<String, &'static str> {
    value
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty() && value.len() <= maximum && !value.contains('\0'))
        .map(str::to_owned)
        .ok_or("invalid_text")
}

fn integer(value: Option<&Value>, minimum: i32, maximum: i32) -> Result<i32, &'static str> {
    value
        .and_then(Value::as_i64)
        .and_then(|value| i32::try_from(value).ok())
        .filter(|value| (minimum..=maximum).contains(value))
        .ok_or("invalid_integer")
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
}
