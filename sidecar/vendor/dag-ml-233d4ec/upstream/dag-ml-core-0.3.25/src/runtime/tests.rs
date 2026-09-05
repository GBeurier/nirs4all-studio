use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
};

use super::*;
use crate::aggregation::{aggregate_observation_predictions, ObservationPredictionBlock};
use crate::bundle::{
    build_aggregated_prediction_cache_payload, build_aggregated_prediction_cache_record,
    build_execution_bundle, build_execution_bundle_with_prediction_contracts,
    build_prediction_cache_payload, build_prediction_cache_record, BundlePredictionCachePayloadSet,
    BundlePredictionRequirement, RefitArtifactRecord, ReplayPhaseRequest,
    PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION,
};
use crate::controller::{
    ArtifactPolicy, ControllerCapability, ControllerFitScope, ControllerManifest,
    ControllerRegistry, RngPolicy,
};
#[cfg(dag_ml_workspace_contract_fixtures)]
use crate::criteria::{ImplementationCapability, TrainingLossRoleReference};
use crate::data::{
    DataViewPolicy, ExternalDataPlanEnvelope, InMemoryDataProvider, PredictCohort,
    PredictCohortRole, SOURCE_INDEX_METADATA_KEY,
};
use crate::fold::{FoldAssignment, FoldPartitionMode, FoldSet};
use crate::generation::{
    GenerationChoice, GenerationConstraints, GenerationDimension, GenerationSpec,
    GenerationStrategy,
};
use crate::graph::{
    EdgeContract, EdgeSpec, GraphInterface, GraphSpec, NodeKind, NodeSpec, PortCardinality,
    PortKind, PortRef, PortSchema, PortSpec,
};
use crate::ids::{
    ArtifactId, ControllerId, FoldId, GroupId, NodeId, ObservationId, SampleId, TargetId,
};
#[cfg(dag_ml_workspace_contract_fixtures)]
use crate::implementation_registry::LocalImplementationRegistry;
use crate::oof::{PredictionBlock, PredictionPartition, STACKING_OOF_REFIT_CONTRACT_METADATA_KEY};
use crate::plan::{build_execution_plan, CampaignSpec, SplitInvocation};
use crate::policy::{
    AggregationControllerSpec, AggregationMethod, AggregationPolicy, DataModelShapePlan,
    FitBoundary, FitInfluencePolicy, Granularity, LeakageUnitPolicy, ShapeDelta, ShapeDeltaKind,
    SplitUnit,
};
use crate::relation::{SampleRelation, SampleRelationSet};
use serde_json::json;

#[cfg(dag_ml_workspace_contract_fixtures)]
#[test]
fn lineage_rejects_duplicate_or_out_of_scope_early_stopping_records() {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../examples/fixtures/criteria/criteria_contracts.v1.json"
    ))
    .unwrap();
    let record =
        EarlyStoppingRecord::from_json(&fixture["valid"]["early_stopping_record"].to_string())
            .unwrap();
    let mut lineage = LineageRecord {
        record_id: LineageId::new("lineage:early-stopping").unwrap(),
        run_id: RunId::new("run:early-stopping").unwrap(),
        node_id: record.node_id.clone(),
        phase: record.phase,
        controller_id: ControllerId::new("controller:early-stopping").unwrap(),
        controller_version: "1.0.0".to_string(),
        variant_id: None,
        fold_id: record.fold_id.clone(),
        branch_path: Vec::new(),
        input_lineage: Vec::new(),
        artifact_refs: Vec::new(),
        params_fingerprint: "params:early-stopping".to_string(),
        data_model_shape_fingerprint: None,
        aggregation_policy_fingerprint: None,
        seed: Some(42),
        unsafe_flags: BTreeSet::new(),
        metrics: BTreeMap::new(),
        loss_attestations: Vec::new(),
        early_stopping_records: vec![record.clone()],
    };
    lineage.validate().unwrap();

    lineage.early_stopping_records.push(record.clone());
    assert!(lineage
        .validate()
        .unwrap_err()
        .to_string()
        .contains("duplicate early-stopping role"));

    lineage.early_stopping_records = vec![record];
    lineage.node_id = NodeId::new("model:other").unwrap();
    assert!(lineage
        .validate()
        .unwrap_err()
        .to_string()
        .contains("does not match lineage task scope"));
}

struct MockController {
    id: ControllerId,
    handle: u64,
    emit_prediction: bool,
}

struct VariantProbeController {
    id: ControllerId,
    handle: u64,
    variants: Arc<Mutex<Vec<Option<VariantExecutionSpec>>>>,
    node_plans: Arc<Mutex<Vec<NodePlan>>>,
}

impl RuntimeController for VariantProbeController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        self.variants.lock().unwrap().push(task.variant.clone());
        self.node_plans.lock().unwrap().push(task.node_plan.clone());
        let variant_label = task
            .variant_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "base".to_string());
        Ok(NodeResult {
            schema_version: None,
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([(
                "out".to_string(),
                HandleRef {
                    handle: self.handle,
                    kind: HandleKind::Data,
                    owner_controller: self.id.clone(),
                },
            )]),
            predictions: Vec::new(),
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets: Vec::new(),
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:{}:{:?}:{variant_label}",
                    task.node_plan.node_id, task.phase
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
                input_lineage: Vec::new(),
                artifact_refs: Vec::new(),
                params_fingerprint: task.node_plan.params_fingerprint.clone(),
                data_model_shape_fingerprint: None,
                aggregation_policy_fingerprint: None,
                seed: task.seed,
                unsafe_flags: BTreeSet::new(),
                metrics: BTreeMap::new(),
                loss_attestations: Vec::new(),
                early_stopping_records: Vec::new(),
            },
        })
    }
}

struct ShapeDataController {
    id: ControllerId,
    handle: u64,
    before_feature_schema: String,
    after_feature_schema: String,
}

impl RuntimeController for ShapeDataController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        let shape_plan = task.node_plan.shape_plan.as_ref().ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "shape data controller `{}` expected a shape plan",
                task.node_plan.node_id
            ))
        })?;
        let output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Data,
            owner_controller: self.id.clone(),
        };
        let shape_delta = ShapeDelta {
            node_id: task.node_plan.node_id.clone(),
            kind: ShapeDeltaKind::Feature,
            before_fingerprint: self.before_feature_schema.clone(),
            after_fingerprint: self.after_feature_schema.clone(),
            metadata: BTreeMap::from([(
                "feature_namespace".to_string(),
                serde_json::Value::String("augmented.noise".to_string()),
            )]),
        };
        Ok(NodeResult {
            schema_version: None,
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([("x_out".to_string(), output)]),
            predictions: Vec::new(),
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: vec![shape_delta],
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets: Vec::new(),
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:{}:{:?}:{}:shape",
                    task.node_plan.node_id,
                    task.phase,
                    task.fold_id
                        .as_ref()
                        .map(ToString::to_string)
                        .unwrap_or_else(|| "nofold".to_string())
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
                input_lineage: Vec::new(),
                artifact_refs: Vec::new(),
                params_fingerprint: task.node_plan.params_fingerprint.clone(),
                data_model_shape_fingerprint: Some(stable_json_fingerprint(shape_plan)?),
                aggregation_policy_fingerprint: Some(stable_json_fingerprint(
                    &shape_plan.aggregation_policy,
                )?),
                seed: task.seed,
                unsafe_flags: BTreeSet::new(),
                metrics: BTreeMap::new(),
                loss_attestations: Vec::new(),
                early_stopping_records: Vec::new(),
            },
        })
    }
}

struct DataViewProbeController {
    id: ControllerId,
    observed_views: Arc<Mutex<Vec<BTreeMap<String, DataProviderViewSpec>>>>,
    prediction_sample_ids: Option<Vec<SampleId>>,
}

impl RuntimeController for DataViewProbeController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        self.observed_views
            .lock()
            .unwrap()
            .push(task.data_views.clone());
        let prediction_sample_ids = self.prediction_sample_ids.clone().unwrap_or_else(|| {
            validation_view_sample_ids(task)
                .map(|ids| ids.into_iter().collect::<Vec<_>>())
                .unwrap_or_else(|| vec![SampleId::new("s1").unwrap()])
        });
        Ok(NodeResult {
            schema_version: None,
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([(
                "oof".to_string(),
                HandleRef {
                    handle: 44,
                    kind: HandleKind::Prediction,
                    owner_controller: self.id.clone(),
                },
            )]),
            predictions: vec![PredictionBlock {
                prediction_id: Some(format!("pred:{}", task.node_plan.node_id)),
                producer_node: task.node_plan.node_id.clone(),
                producer_port: None,
                partition: PredictionPartition::Validation,
                fold_id: task.fold_id.clone(),
                sample_ids: prediction_sample_ids.clone(),
                values: vec![vec![1.0]; prediction_sample_ids.len()],
                target_names: vec!["y".to_string()],
            }],
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets: Vec::new(),
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:{}:{:?}:{}:probe",
                    task.node_plan.node_id,
                    task.phase,
                    task.fold_id
                        .as_ref()
                        .map(ToString::to_string)
                        .unwrap_or_else(|| "nofold".to_string())
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
                input_lineage: Vec::new(),
                artifact_refs: Vec::new(),
                params_fingerprint: task.node_plan.params_fingerprint.clone(),
                data_model_shape_fingerprint: None,
                aggregation_policy_fingerprint: None,
                seed: task.seed,
                unsafe_flags: BTreeSet::new(),
                metrics: BTreeMap::new(),
                loss_attestations: Vec::new(),
                early_stopping_records: Vec::new(),
            },
        })
    }
}

impl RuntimeController for MockController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        for binding in &task.node_plan.data_bindings {
            let key = format!("data:{}", binding.input_name);
            let handle = task.input_handles.get(&key).ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "node `{}` did not receive data handle `{key}`",
                    task.node_plan.node_id
                ))
            })?;
            if !matches!(handle.kind, HandleKind::Data | HandleKind::DataView) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` received non-data/data-view handle for `{key}`",
                    task.node_plan.node_id
                )));
            }
            if !task.data_views.contains_key(&key) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` did not receive data view spec for `{key}`",
                    task.node_plan.node_id
                )));
            }
            if task.phase == Phase::FitCv && task.fold_id.is_some() {
                let validation_key = format!("{key}:validation");
                let validation_view = task.data_views.get(&validation_key).ok_or_else(|| {
                        DagMlError::RuntimeValidation(format!(
                            "node `{}` did not receive validation data view spec for `{validation_key}`",
                            task.node_plan.node_id
                        ))
                    })?;
                if validation_view.partition != DataRequestPartition::FoldValidation {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "node `{}` received non-validation data view for `{validation_key}`",
                        task.node_plan.node_id
                    )));
                }
            }
        }
        let variant_label = task
            .variant_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "base".to_string());
        let fold_label = task
            .fold_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "nofold".to_string());
        let output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Data,
            owner_controller: self.id.clone(),
        };
        let prediction_output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Prediction,
            owner_controller: self.id.clone(),
        };
        let prediction_sample_ids = validation_view_sample_ids(task)
            .map(|ids| ids.into_iter().collect::<Vec<_>>())
            .unwrap_or_else(|| vec![SampleId::new("s1").unwrap()]);
        let predictions = self
            .emit_prediction
            .then(|| PredictionBlock {
                prediction_id: Some(format!("pred:{}", task.node_plan.node_id)),
                producer_node: task.node_plan.node_id.clone(),
                producer_port: None,
                partition: PredictionPartition::Validation,
                fold_id: task.fold_id.clone(),
                sample_ids: prediction_sample_ids.clone(),
                values: vec![vec![1.0]; prediction_sample_ids.len()],
                target_names: vec!["y".to_string()],
            })
            .into_iter()
            .collect::<Vec<_>>();
        Ok(NodeResult {
            schema_version: None,
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([
                ("out".to_string(), output.clone()),
                ("x".to_string(), output.clone()),
                ("x_out".to_string(), output),
                ("pred".to_string(), prediction_output.clone()),
                ("oof".to_string(), prediction_output),
            ]),
            predictions,
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets: Vec::new(),
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:{}:{:?}:{variant_label}:{fold_label}",
                    task.node_plan.node_id, task.phase
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
                input_lineage: Vec::new(),
                artifact_refs: Vec::new(),
                params_fingerprint: task.node_plan.params_fingerprint.clone(),
                data_model_shape_fingerprint: None,
                aggregation_policy_fingerprint: None,
                seed: task.seed,
                unsafe_flags: BTreeSet::new(),
                metrics: BTreeMap::new(),
                loss_attestations: Vec::new(),
                early_stopping_records: Vec::new(),
            },
        })
    }
}

#[cfg(dag_ml_workspace_contract_fixtures)]
struct LossRequirementEchoController {
    inner: MockController,
}

#[cfg(dag_ml_workspace_contract_fixtures)]
impl RuntimeController for LossRequirementEchoController {
    fn controller_id(&self) -> &ControllerId {
        self.inner.controller_id()
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        let mut result = self.inner.invoke(task)?;
        result.lineage.loss_attestations = task.required_loss_attestations.clone();
        Ok(result)
    }
}

#[cfg(dag_ml_workspace_contract_fixtures)]
type RustLossFn = Arc<dyn Fn(f64, f64) -> f64 + Send + Sync>;
#[cfg(dag_ml_workspace_contract_fixtures)]
type RustLossCalls = Arc<Mutex<Vec<(Phase, Option<FoldId>, f64)>>>;

#[cfg(dag_ml_workspace_contract_fixtures)]
struct RustLocalLossController {
    inner: MockController,
    registry: Arc<Mutex<LocalImplementationRegistry<RustLossFn>>>,
    calls: RustLossCalls,
}

#[cfg(dag_ml_workspace_contract_fixtures)]
impl RuntimeController for RustLocalLossController {
    fn controller_id(&self) -> &ControllerId {
        self.inner.controller_id()
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        let (role, attestation) = task.training_loss_binding(0)?;
        let loss = {
            let registry = self.registry.lock().unwrap();
            Arc::clone(registry.resolve_loss(&role.loss)?)
        };
        let value = loss(2.0, 5.5);
        if !value.is_finite() {
            return Err(DagMlError::RuntimeValidation(
                "Rust local training loss returned a non-finite scalar".to_string(),
            ));
        }
        self.calls
            .lock()
            .unwrap()
            .push((task.phase, task.fold_id.clone(), value));
        let mut result = self.inner.invoke(task)?;
        result.lineage.loss_attestations = vec![attestation.clone()];
        Ok(result)
    }
}

struct ReplayMockController {
    id: ControllerId,
    handle: u64,
    require_artifact: bool,
    emit_prediction: bool,
    emit_refit_artifact: bool,
}

impl RuntimeController for ReplayMockController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        for binding in &task.node_plan.data_bindings {
            let key = format!("data:{}", binding.input_name);
            let handle = task.input_handles.get(&key).ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "node `{}` did not receive data handle `{key}`",
                    task.node_plan.node_id
                ))
            })?;
            if !matches!(handle.kind, HandleKind::Data | HandleKind::DataView) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` received non-data/data-view handle for `{key}`",
                    task.node_plan.node_id
                )));
            }
            if !task.data_views.contains_key(&key) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` did not receive data view spec for `{key}`",
                    task.node_plan.node_id
                )));
            }
            if task.phase == Phase::FitCv && task.fold_id.is_some() {
                let validation_key = format!("{key}:validation");
                let validation_view = task.data_views.get(&validation_key).ok_or_else(|| {
                        DagMlError::RuntimeValidation(format!(
                            "node `{}` did not receive validation data view spec for `{validation_key}`",
                            task.node_plan.node_id
                        ))
                    })?;
                if validation_view.partition != DataRequestPartition::FoldValidation {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "node `{}` received non-validation data view for `{validation_key}`",
                        task.node_plan.node_id
                    )));
                }
            }
        }
        if self.require_artifact {
            let artifact_id = ArtifactId::new("artifact:model:base:refit").unwrap();
            let key = refit_artifact_input_key(&artifact_id);
            let handle = task.input_handles.get(&key).ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "node `{}` did not receive refit artifact handle `{key}`",
                    task.node_plan.node_id
                ))
            })?;
            if handle.kind != HandleKind::Model {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` received non-model refit handle for `{key}`",
                    task.node_plan.node_id
                )));
            }
            let artifact_input = task.artifact_inputs.get(&key).ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "node `{}` did not receive refit artifact metadata `{key}`",
                    task.node_plan.node_id
                ))
            })?;
            if artifact_input.artifact.id != artifact_id
                || artifact_input.node_id != task.node_plan.node_id
                || artifact_input.controller_id != task.node_plan.controller_id
            {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` received mismatched refit artifact metadata `{key}`",
                    task.node_plan.node_id
                )));
            }
        }

        let output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Data,
            owner_controller: self.id.clone(),
        };
        let predictions = self
            .emit_prediction
            .then(|| PredictionBlock {
                prediction_id: Some(format!("pred:{}", task.node_plan.node_id)),
                producer_node: task.node_plan.node_id.clone(),
                producer_port: None,
                partition: PredictionPartition::Final,
                fold_id: None,
                sample_ids: vec![SampleId::new("sample:mock").unwrap()],
                values: vec![vec![self.handle as f64]],
                target_names: vec!["y".to_string()],
            })
            .into_iter()
            .collect::<Vec<_>>();
        let artifacts = if self.emit_refit_artifact && task.phase == Phase::Refit {
            vec![ArtifactRef {
                id: ArtifactId::new(format!("artifact:{}:refit", task.node_plan.node_id)).unwrap(),
                kind: "mock_model".to_string(),
                controller_id: self.id.clone(),
                backend: None,
                uri: None,
                content_fingerprint: None,
                size_bytes: Some(128),
                plugin: None,
                plugin_version: None,
                abi_major: None,
                abi_min_minor: None,
                native_predictor_descriptor: None,
            }]
        } else {
            Vec::new()
        };
        let artifact_handles = artifacts
            .iter()
            .map(|artifact| {
                (
                    artifact.id.clone(),
                    HandleRef {
                        handle: self.handle + 10_000,
                        kind: HandleKind::Model,
                        owner_controller: self.id.clone(),
                    },
                )
            })
            .collect::<BTreeMap<_, _>>();
        Ok(NodeResult {
            schema_version: None,
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([("out".to_string(), output)]),
            predictions,
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: artifacts.clone(),
            artifact_handles,
            fit_influence_diagnostics: Vec::new(),
            regression_targets: Vec::new(),
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:replay:{}:{:?}",
                    task.node_plan.node_id, task.phase
                ))
                .unwrap(),
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
                unsafe_flags: BTreeSet::new(),
                metrics: BTreeMap::new(),
                loss_attestations: Vec::new(),
                early_stopping_records: Vec::new(),
            },
        })
    }
}

#[derive(Clone, Copy)]
enum OofSampleMode {
    Aligned,
    Swapped,
}

struct OofEdgeController {
    id: ControllerId,
    base_partition: Option<PredictionPartition>,
    sample_mode: OofSampleMode,
}

impl RuntimeController for OofEdgeController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        if task.node_plan.node_id.as_str() == "model:meta" {
            let handle = task.input_handles.get("model:base.pred").ok_or_else(|| {
                DagMlError::RuntimeValidation(
                    "meta node did not receive OOF prediction input".to_string(),
                )
            })?;
            if handle.kind != HandleKind::Prediction {
                return Err(DagMlError::RuntimeValidation(format!(
                    "meta node received {:?} instead of OOF prediction input",
                    handle.kind
                )));
            }
            let prediction_input =
                task.prediction_inputs
                    .get("model:base.pred")
                    .ok_or_else(|| {
                        DagMlError::RuntimeValidation(
                            "meta node did not receive OOF prediction input spec".to_string(),
                        )
                    })?;
            if prediction_input.producer_node.as_str() != "model:base"
                || prediction_input.partition != PredictionPartition::Validation
                || prediction_input.prediction_level != PredictionLevel::Sample
                || prediction_input.prediction_width != 1
            {
                return Err(DagMlError::RuntimeValidation(
                    "meta node received invalid OOF prediction input spec".to_string(),
                ));
            }
            if task.phase == Phase::FitCv {
                if prediction_input.fold_id != task.fold_id {
                    return Err(DagMlError::RuntimeValidation(
                        "meta node received OOF prediction spec for the wrong fold".to_string(),
                    ));
                }
                if prediction_input.sample_ids != aligned_validation_samples(task) {
                    return Err(DagMlError::RuntimeValidation(
                        "meta node received OOF prediction spec for wrong samples".to_string(),
                    ));
                }
            }
            if task.phase == Phase::Refit
                && (prediction_input.fold_id.is_some()
                    || prediction_input.fold_ids
                        != vec![
                            FoldId::new("fold:0").unwrap(),
                            FoldId::new("fold:1").unwrap(),
                        ]
                    || prediction_input.sample_ids
                        != vec![SampleId::new("s1").unwrap(), SampleId::new("s2").unwrap()])
            {
                return Err(DagMlError::RuntimeValidation(
                    "meta node received invalid refit OOF coverage spec".to_string(),
                ));
            }
        }

        let predictions = if task.node_plan.node_id.as_str() == "model:base" {
            self.base_partition
                .clone()
                .map(|partition| {
                    let sample_ids = match self.sample_mode {
                        OofSampleMode::Aligned => aligned_validation_samples(task),
                        OofSampleMode::Swapped => swapped_validation_samples(task),
                    };
                    let fold_id = matches!(
                        partition,
                        PredictionPartition::Train | PredictionPartition::Validation
                    )
                    .then(|| task.fold_id.clone())
                    .flatten();
                    PredictionBlock {
                        prediction_id: Some(format!("pred:{}", task.node_plan.node_id)),
                        producer_node: task.node_plan.node_id.clone(),
                        producer_port: None,
                        partition,
                        fold_id,
                        sample_ids: sample_ids.clone(),
                        values: vec![vec![0.5]; sample_ids.len()],
                        target_names: vec!["y".to_string()],
                    }
                })
                .into_iter()
                .collect::<Vec<_>>()
        } else {
            Vec::new()
        };

        let handle_id = if task.node_plan.node_id.as_str() == "model:base" {
            101
        } else {
            202
        };
        Ok(NodeResult {
            schema_version: None,
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([(
                "pred".to_string(),
                HandleRef {
                    handle: handle_id,
                    kind: HandleKind::Data,
                    owner_controller: self.id.clone(),
                },
            )]),
            predictions,
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets: Vec::new(),
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:oof:{}:{}",
                    task.node_plan.node_id,
                    task.fold_id
                        .as_ref()
                        .map(ToString::to_string)
                        .unwrap_or_else(|| "nofold".to_string())
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
                input_lineage: Vec::new(),
                artifact_refs: Vec::new(),
                params_fingerprint: task.node_plan.params_fingerprint.clone(),
                data_model_shape_fingerprint: None,
                aggregation_policy_fingerprint: None,
                seed: task.seed,
                unsafe_flags: BTreeSet::new(),
                metrics: BTreeMap::new(),
                loss_attestations: Vec::new(),
                early_stopping_records: Vec::new(),
            },
        })
    }
}

/// Captured `(sample_ids, values, prediction_width)` from a FIT_CV `PredictionInputSpec`.
type CapturedOofSpec = (Vec<SampleId>, Vec<Vec<f64>>, usize);

/// Emits a Validation OOF block at `model:base` and, at `model:meta`, records the
/// `(sample_ids, values, width)` carried by the FIT_CV `PredictionInputSpec` so a
/// test can assert the host can build a stacking matrix from spec values alone.
struct CaptureOofValuesController {
    id: ControllerId,
    captured: Arc<Mutex<Vec<CapturedOofSpec>>>,
}

impl RuntimeController for CaptureOofValuesController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        if task.node_plan.node_id.as_str() == "model:meta" && task.phase == Phase::FitCv {
            let spec = task
                .prediction_inputs
                .get("model:base.pred")
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation(
                        "meta node did not receive OOF prediction input spec".to_string(),
                    )
                })?;
            self.captured.lock().unwrap().push((
                spec.sample_ids.clone(),
                spec.values.clone(),
                spec.prediction_width,
            ));
        }

        let predictions = if task.node_plan.node_id.as_str() == "model:base" {
            let sample_ids = aligned_validation_samples(task);
            // Per-sample value carries the sample ordinal, so the test can assert
            // the spec rows stay aligned 1:1 with `sample_ids`.
            let values = sample_ids
                .iter()
                .map(|sample_id| {
                    vec![if sample_id.as_str() == "s1" {
                        0.25
                    } else {
                        0.75
                    }]
                })
                .collect::<Vec<_>>();
            vec![PredictionBlock {
                prediction_id: Some(format!("pred:{}", task.node_plan.node_id)),
                producer_node: task.node_plan.node_id.clone(),
                producer_port: None,
                partition: PredictionPartition::Validation,
                fold_id: task.fold_id.clone(),
                sample_ids,
                values,
                target_names: vec!["y".to_string()],
            }]
        } else {
            Vec::new()
        };

        let handle_id = if task.node_plan.node_id.as_str() == "model:base" {
            505
        } else {
            606
        };
        Ok(NodeResult {
            schema_version: None,
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([(
                "pred".to_string(),
                HandleRef {
                    handle: handle_id,
                    kind: HandleKind::Data,
                    owner_controller: self.id.clone(),
                },
            )]),
            predictions,
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets: Vec::new(),
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:oof.values:{}:{}",
                    task.node_plan.node_id,
                    task.fold_id
                        .as_ref()
                        .map(ToString::to_string)
                        .unwrap_or_else(|| "nofold".to_string())
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
                input_lineage: Vec::new(),
                artifact_refs: Vec::new(),
                params_fingerprint: task.node_plan.params_fingerprint.clone(),
                data_model_shape_fingerprint: None,
                aggregation_policy_fingerprint: None,
                seed: task.seed,
                unsafe_flags: BTreeSet::new(),
                metrics: BTreeMap::new(),
                loss_attestations: Vec::new(),
                early_stopping_records: Vec::new(),
            },
        })
    }
}

struct ExpectedRefitOofController {
    id: ControllerId,
    expected_fold_ids: Vec<FoldId>,
    expected_sample_ids: Vec<SampleId>,
    expected_target_names: Vec<String>,
}

impl RuntimeController for ExpectedRefitOofController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        if task.node_plan.node_id.as_str() == "model:meta" && task.phase == Phase::Refit {
            let handle = task.input_handles.get("model:base.pred").ok_or_else(|| {
                DagMlError::RuntimeValidation(
                    "meta node did not receive grouped OOF prediction input".to_string(),
                )
            })?;
            if handle.kind != HandleKind::Prediction {
                return Err(DagMlError::RuntimeValidation(format!(
                    "meta node received {:?} instead of grouped OOF prediction input",
                    handle.kind
                )));
            }
            let prediction_input =
                task.prediction_inputs
                    .get("model:base.pred")
                    .ok_or_else(|| {
                        DagMlError::RuntimeValidation(
                            "meta node did not receive grouped OOF prediction input spec"
                                .to_string(),
                        )
                    })?;
            if prediction_input.producer_node.as_str() != "model:base"
                || prediction_input.source_port != "pred"
                || prediction_input.target_port != "pred"
                || prediction_input.partition != PredictionPartition::Validation
                || prediction_input.prediction_level != PredictionLevel::Sample
                || prediction_input.fold_id.is_some()
                || prediction_input.fold_ids != self.expected_fold_ids
                || prediction_input.sample_ids != self.expected_sample_ids
                || prediction_input.prediction_width != 1
                || prediction_input.target_names != self.expected_target_names
            {
                return Err(DagMlError::RuntimeValidation(format!(
                    "meta node received invalid grouped refit OOF spec: {:?}",
                    prediction_input
                )));
            }
        }

        let handle_id = if task.node_plan.node_id.as_str() == "model:base" {
            303
        } else {
            404
        };
        Ok(NodeResult {
            schema_version: None,
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([(
                "pred".to_string(),
                HandleRef {
                    handle: handle_id,
                    kind: HandleKind::Prediction,
                    owner_controller: self.id.clone(),
                },
            )]),
            predictions: Vec::new(),
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets: Vec::new(),
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:grouped-oof:{}:{:?}",
                    task.node_plan.node_id, task.phase
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
                input_lineage: Vec::new(),
                artifact_refs: Vec::new(),
                params_fingerprint: task.node_plan.params_fingerprint.clone(),
                data_model_shape_fingerprint: None,
                aggregation_policy_fingerprint: None,
                seed: task.seed,
                unsafe_flags: BTreeSet::new(),
                metrics: BTreeMap::new(),
                loss_attestations: Vec::new(),
                early_stopping_records: Vec::new(),
            },
        })
    }
}

struct GroupAggregatedOofController {
    id: ControllerId,
}

impl RuntimeController for GroupAggregatedOofController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        if task.node_plan.node_id.as_str() == "model:meta" {
            validate_group_oof_prediction_input(task)?;
        }

        let observation_predictions =
            if task.node_plan.node_id.as_str() == "model:base" && task.phase == Phase::FitCv {
                let (observation_ids, values) =
                    match task.fold_id.as_ref().map(ToString::to_string).as_deref() {
                        Some("fold:0") => (
                            vec![
                                ObservationId::new("obs.S001.base").unwrap(),
                                ObservationId::new("obs.S001.rep1").unwrap(),
                            ],
                            vec![vec![2.0], vec![6.0]],
                        ),
                        Some("fold:1") => (
                            vec![ObservationId::new("obs.S002.base").unwrap()],
                            vec![vec![10.0]],
                        ),
                        _ => (Vec::new(), Vec::new()),
                    };
                if observation_ids.is_empty() {
                    Vec::new()
                } else {
                    vec![ObservationPredictionBlock {
                        prediction_id: Some(format!(
                            "pred:group-oof:{}",
                            task.fold_id
                                .as_ref()
                                .map(ToString::to_string)
                                .unwrap_or_else(|| "nofold".to_string())
                        )),
                        producer_node: task.node_plan.node_id.clone(),
                        producer_port: None,
                        partition: PredictionPartition::Validation,
                        fold_id: task.fold_id.clone(),
                        observation_ids,
                        values,
                        weights: Vec::new(),
                        target_names: vec!["y".to_string()],
                    }]
                }
            } else {
                Vec::new()
            };

        let handle_id = if task.node_plan.node_id.as_str() == "model:base" {
            707
        } else {
            808
        };
        Ok(NodeResult {
            schema_version: None,
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([(
                "pred".to_string(),
                HandleRef {
                    handle: handle_id,
                    kind: HandleKind::Prediction,
                    owner_controller: self.id.clone(),
                },
            )]),
            predictions: Vec::new(),
            observation_predictions,
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets: Vec::new(),
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:group-oof:{}:{}:{:?}",
                    task.node_plan.node_id,
                    task.fold_id
                        .as_ref()
                        .map(ToString::to_string)
                        .unwrap_or_else(|| "nofold".to_string()),
                    task.phase
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
                input_lineage: Vec::new(),
                artifact_refs: Vec::new(),
                params_fingerprint: task.node_plan.params_fingerprint.clone(),
                data_model_shape_fingerprint: task
                    .node_plan
                    .shape_plan
                    .as_ref()
                    .map(stable_json_fingerprint)
                    .transpose()?,
                aggregation_policy_fingerprint: task
                    .node_plan
                    .shape_plan
                    .as_ref()
                    .map(|shape_plan| stable_json_fingerprint(&shape_plan.aggregation_policy))
                    .transpose()?,
                seed: task.seed,
                unsafe_flags: BTreeSet::new(),
                metrics: BTreeMap::new(),
                loss_attestations: Vec::new(),
                early_stopping_records: Vec::new(),
            },
        })
    }
}

fn validate_group_oof_prediction_input(task: &NodeTask) -> Result<()> {
    let handle = task.input_handles.get("model:base.pred").ok_or_else(|| {
        DagMlError::RuntimeValidation(
            "meta node did not receive group OOF prediction input".to_string(),
        )
    })?;
    if handle.kind != HandleKind::Prediction {
        return Err(DagMlError::RuntimeValidation(format!(
            "meta node received {:?} instead of group OOF prediction input",
            handle.kind
        )));
    }
    let prediction_input = task
        .prediction_inputs
        .get("model:base.pred")
        .ok_or_else(|| {
            DagMlError::RuntimeValidation(
                "meta node did not receive group OOF prediction input spec".to_string(),
            )
        })?;
    let fold0 = FoldId::new("fold:0").unwrap();
    let fold1 = FoldId::new("fold:1").unwrap();
    let plant_a = PredictionUnitId::Group(GroupId::new("plant.A").unwrap());
    let plant_b = PredictionUnitId::Group(GroupId::new("plant.B").unwrap());
    let (expected_fold_id, expected_fold_ids, expected_unit_ids) = match task.phase {
        Phase::FitCv => match task.fold_id.as_ref().map(ToString::to_string).as_deref() {
            Some("fold:0") => (Some(fold0.clone()), vec![fold0], vec![plant_a]),
            Some("fold:1") => (Some(fold1.clone()), vec![fold1], vec![plant_b]),
            other => {
                return Err(DagMlError::RuntimeValidation(format!(
                    "unexpected group OOF fold scope {other:?}"
                )));
            }
        },
        Phase::Refit => (None, vec![fold0, fold1], vec![plant_a, plant_b]),
        _ => {
            return Err(DagMlError::RuntimeValidation(format!(
                "unexpected group OOF phase {:?}",
                task.phase
            )));
        }
    };
    if prediction_input.producer_node.as_str() != "model:base"
        || prediction_input.source_port != "pred"
        || prediction_input.target_port != "pred"
        || prediction_input.partition != PredictionPartition::Validation
        || prediction_input.prediction_level != PredictionLevel::Group
        || prediction_input.fold_id != expected_fold_id
        || prediction_input.fold_ids != expected_fold_ids
        || prediction_input.unit_ids != expected_unit_ids
        || !prediction_input.sample_ids.is_empty()
        || prediction_input.prediction_width != 1
        || prediction_input.target_names != vec!["y".to_string()]
    {
        return Err(DagMlError::RuntimeValidation(format!(
            "meta node received invalid group OOF spec: {:?}",
            prediction_input
        )));
    }
    Ok(())
}

struct CustomAggregationController {
    id: ControllerId,
    task_ids: Arc<Mutex<Vec<String>>>,
}

impl RuntimeController for CustomAggregationController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        Err(DagMlError::RuntimeValidation(format!(
            "custom aggregation controller received unexpected node task `{}`",
            task.node_plan.node_id
        )))
    }

    fn invoke_aggregation(
        &self,
        task: &AggregationControllerTask,
    ) -> Result<AggregationControllerResult> {
        self.task_ids.lock().unwrap().push(task.task_id.clone());
        match &task.input {
            AggregationControllerInput::ObservationToSample {
                block,
                relations,
                requested_sample_order,
            } => {
                let mut by_sample = BTreeMap::<SampleId, Vec<Vec<f64>>>::new();
                for (observation_id, row) in block.observation_ids.iter().zip(block.values.iter()) {
                    let sample_id = relations
                        .sample_for_observation(observation_id)
                        .ok_or_else(|| {
                            DagMlError::OofValidation(format!(
                                "missing relation for `{observation_id}`"
                            ))
                        })?;
                    by_sample
                        .entry(sample_id.clone())
                        .or_default()
                        .push(row.clone());
                }
                let values = requested_sample_order
                    .iter()
                    .map(|sample_id| {
                        let rows = by_sample.get(sample_id).ok_or_else(|| {
                            DagMlError::OofValidation(format!(
                                "missing sample `{sample_id}` for custom aggregation"
                            ))
                        })?;
                        let width = rows.first().map_or(0, Vec::len);
                        Ok((0..width)
                            .map(|col| {
                                rows.iter().map(|row| row[col]).sum::<f64>() / rows.len() as f64
                            })
                            .collect::<Vec<_>>())
                    })
                    .collect::<Result<Vec<_>>>()?;
                Ok(AggregationControllerResult {
                    schema_version:
                        crate::aggregation::AGGREGATION_CONTROLLER_RESULT_SCHEMA_VERSION,
                    task_id: task.task_id.clone(),
                    reduction_plan: None,
                    output: AggregationControllerOutput::Sample {
                        block: PredictionBlock {
                            prediction_id: block.prediction_id.clone(),
                            producer_node: block.producer_node.clone(),
                            producer_port: None,
                            partition: block.partition.clone(),
                            fold_id: block.fold_id.clone(),
                            sample_ids: requested_sample_order.clone(),
                            values,
                            target_names: block.target_names.clone(),
                        },
                    },
                })
            }
            AggregationControllerInput::SampleToUnit {
                block,
                relations,
                requested_unit_order,
            } => {
                let mut by_unit = BTreeMap::<PredictionUnitId, Vec<Vec<f64>>>::new();
                for (sample_id, row) in block.sample_ids.iter().zip(block.values.iter()) {
                    let unit_id = relations
                        .group_for_sample(sample_id)
                        .cloned()
                        .map(PredictionUnitId::Group)
                        .ok_or_else(|| {
                            DagMlError::OofValidation(format!(
                                "missing group relation for `{sample_id}`"
                            ))
                        })?;
                    by_unit.entry(unit_id).or_default().push(row.clone());
                }
                let values = requested_unit_order
                    .iter()
                    .map(|unit_id| {
                        let rows = by_unit.get(unit_id).ok_or_else(|| {
                            DagMlError::OofValidation(format!(
                                "missing unit `{unit_id}` for custom aggregation"
                            ))
                        })?;
                        let width = rows.first().map_or(0, Vec::len);
                        Ok((0..width)
                            .map(|col| rows.iter().map(|row| row[col]).fold(f64::MIN, f64::max))
                            .collect::<Vec<_>>())
                    })
                    .collect::<Result<Vec<_>>>()?;
                Ok(AggregationControllerResult {
                    schema_version:
                        crate::aggregation::AGGREGATION_CONTROLLER_RESULT_SCHEMA_VERSION,
                    task_id: task.task_id.clone(),
                    reduction_plan: None,
                    output: AggregationControllerOutput::Unit {
                        block: AggregatedPredictionBlock {
                            prediction_id: block.prediction_id.clone(),
                            producer_node: block.producer_node.clone(),
                            producer_port: None,
                            partition: block.partition.clone(),
                            fold_id: block.fold_id.clone(),
                            level: PredictionLevel::Group,
                            unit_ids: requested_unit_order.clone(),
                            values,
                            target_names: block.target_names.clone(),
                        },
                    },
                })
            }
        }
    }
}

struct ObservationPredictionRuntimeController {
    id: ControllerId,
}

impl RuntimeController for ObservationPredictionRuntimeController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        let (observation_ids, values) =
            match task.fold_id.as_ref().map(ToString::to_string).as_deref() {
                Some("fold:0") => (
                    vec![
                        ObservationId::new("obs.S001.base").unwrap(),
                        ObservationId::new("obs.S001.rep1").unwrap(),
                    ],
                    vec![vec![2.0], vec![6.0]],
                ),
                Some("fold:1") => (
                    vec![ObservationId::new("obs.S002.base").unwrap()],
                    vec![vec![10.0]],
                ),
                _ => (
                    vec![ObservationId::new("obs.S001.base").unwrap()],
                    vec![vec![2.0]],
                ),
            };
        Ok(NodeResult {
            schema_version: None,
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([(
                "pred".to_string(),
                HandleRef {
                    handle: 515,
                    kind: HandleKind::Prediction,
                    owner_controller: self.id.clone(),
                },
            )]),
            predictions: Vec::new(),
            observation_predictions: vec![ObservationPredictionBlock {
                prediction_id: Some("pred:obs.runtime".to_string()),
                producer_node: task.node_plan.node_id.clone(),
                producer_port: None,
                partition: PredictionPartition::Validation,
                fold_id: task.fold_id.clone(),
                observation_ids,
                values,
                weights: Vec::new(),
                target_names: vec!["y".to_string()],
            }],
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets: Vec::new(),
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:obs-runtime:{}:{}",
                    task.node_plan.node_id,
                    task.fold_id
                        .as_ref()
                        .map(ToString::to_string)
                        .unwrap_or_else(|| "nofold".to_string())
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
                input_lineage: Vec::new(),
                artifact_refs: Vec::new(),
                params_fingerprint: task.node_plan.params_fingerprint.clone(),
                data_model_shape_fingerprint: task
                    .node_plan
                    .shape_plan
                    .as_ref()
                    .map(stable_json_fingerprint)
                    .transpose()?,
                aggregation_policy_fingerprint: task
                    .node_plan
                    .shape_plan
                    .as_ref()
                    .map(|shape_plan| stable_json_fingerprint(&shape_plan.aggregation_policy))
                    .transpose()?,
                seed: task.seed,
                unsafe_flags: BTreeSet::new(),
                metrics: BTreeMap::new(),
                loss_attestations: Vec::new(),
                early_stopping_records: Vec::new(),
            },
        })
    }
}

fn aligned_validation_samples(task: &NodeTask) -> Vec<SampleId> {
    match task.fold_id.as_ref().map(ToString::to_string).as_deref() {
        Some("fold:0") => vec![SampleId::new("s1").unwrap()],
        Some("fold:1") => vec![SampleId::new("s2").unwrap()],
        _ => vec![SampleId::new("s1").unwrap()],
    }
}

fn swapped_validation_samples(task: &NodeTask) -> Vec<SampleId> {
    match task.fold_id.as_ref().map(ToString::to_string).as_deref() {
        Some("fold:0") => vec![SampleId::new("s2").unwrap()],
        Some("fold:1") => vec![SampleId::new("s1").unwrap()],
        _ => vec![SampleId::new("s2").unwrap()],
    }
}

fn temp_prediction_cache_dir(label: &str) -> PathBuf {
    let suffix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock is after UNIX_EPOCH")
        .as_nanos();
    std::env::temp_dir().join(format!("{label}_{}_{}", std::process::id(), suffix))
}

fn port(name: &str, kind: PortKind) -> PortSpec {
    PortSpec {
        name: name.to_string(),
        kind,
        representation: None,
        cardinality: PortCardinality::One,
        unit_level: None,
        alignment_key: None,
        target_level: None,
        description: String::new(),
    }
}

fn node(id: &str, kind: NodeKind, inputs: Vec<PortSpec>, outputs: Vec<PortSpec>) -> NodeSpec {
    NodeSpec {
        id: NodeId::new(id).unwrap(),
        kind,
        operator: None,
        params: BTreeMap::new(),
        ports: PortSchema { inputs, outputs },
        metadata: BTreeMap::new(),
        seed_label: None,
    }
}

fn controller_manifest(id: &str, kind: NodeKind) -> ControllerManifest {
    let mut capabilities = BTreeSet::from([
        ControllerCapability::Deterministic,
        ControllerCapability::ThreadSafe,
        ControllerCapability::ProcessSafe,
    ]);
    if kind == NodeKind::Model {
        capabilities.insert(ControllerCapability::EmitsPredictions);
        capabilities.insert(ControllerCapability::ConsumesOofPredictions);
        capabilities.insert(ControllerCapability::EmitsArtifacts);
        capabilities.insert(ControllerCapability::Stateful);
    }
    ControllerManifest {
        controller_id: ControllerId::new(id).unwrap(),
        controller_version: "0.1.0".to_string(),
        operator_kind: kind,
        priority: 0,
        supported_phases: BTreeSet::from([Phase::FitCv]),
        input_ports: Vec::new(),
        output_ports: Vec::new(),
        data_requirements: None,
        capabilities,
        operator_selectors: Vec::new(),
        fit_scope: ControllerFitScope::FoldTrain,
        rng_policy: RngPolicy::UsesCoreSeed,
        artifact_policy: ArtifactPolicy::Serializable,
    }
}

fn aggregation_dispatch_plan(with_capability: bool) -> ExecutionPlan {
    let graph = GraphSpec {
        id: "graph:aggregation.dispatch".to_string(),
        interface: GraphInterface::default(),
        nodes: vec![node(
            "aggregate:custom",
            NodeKind::Aggregator,
            Vec::new(),
            Vec::new(),
        )],
        edges: Vec::new(),
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    };
    let campaign = CampaignSpec {
        inner_cv: None,
        id: "campaign:aggregation.dispatch".to_string(),
        root_seed: Some(7),
        leakage_policy: Default::default(),
        aggregation_policy: Default::default(),
        split_invocation: None,
        generation: Default::default(),
        shape_plans: BTreeMap::new(),
        data_bindings: BTreeMap::new(),
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    };
    let mut manifest = controller_manifest("controller:agg.custom", NodeKind::Aggregator);
    if with_capability {
        manifest
            .capabilities
            .insert(ControllerCapability::AggregatesPredictions);
    }
    let mut registry = ControllerRegistry::new();
    registry.register(manifest).unwrap();
    build_execution_plan("plan:aggregation.dispatch", graph, campaign, &registry).unwrap()
}

fn observation_prediction_runtime_plan() -> ExecutionPlan {
    let model_id = NodeId::new("model:obs").unwrap();
    let graph = GraphSpec {
        id: "graph:observation.prediction.runtime".to_string(),
        interface: GraphInterface::default(),
        nodes: vec![
            node(
                model_id.as_str(),
                NodeKind::Model,
                vec![port("x", PortKind::Data)],
                vec![port("pred", PortKind::Prediction)],
            ),
            node(
                "aggregate:custom",
                NodeKind::Aggregator,
                Vec::new(),
                Vec::new(),
            ),
        ],
        edges: Vec::new(),
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    };
    let mut shape_plans = BTreeMap::new();
    shape_plans.insert(
        model_id.clone(),
        DataModelShapePlan {
            node_id: model_id.clone(),
            input_granularity: Granularity::Observation,
            target_granularity: Granularity::Sample,
            fit_rows: FitBoundary::FoldTrain,
            predict_rows: FitBoundary::FoldValidation,
            feature_namespace: Some("nir".to_string()),
            feature_schema_fingerprint: None,
            target_space: "regression:y".to_string(),
            aggregation_policy: custom_aggregation_policy(PredictionLevel::Sample),
            augmentation_policy: Default::default(),
            selection_policy: Default::default(),
        },
    );
    let mut data_bindings = BTreeMap::new();
    data_bindings.insert(model_id.clone(), vec![data_binding(&model_id)]);
    let campaign = CampaignSpec {
        inner_cv: None,
        id: "campaign:observation.prediction.runtime".to_string(),
        root_seed: Some(17),
        leakage_policy: Default::default(),
        aggregation_policy: Default::default(),
        split_invocation: Some(SplitInvocation {
            id: "split:single".to_string(),
            controller_id: None,
            leakage_policy: Default::default(),
            params: BTreeMap::new(),
            fold_set: Some(FoldSet {
                id: "folds:single".to_string(),
                sample_ids: vec![
                    SampleId::new("sample:1").unwrap(),
                    SampleId::new("sample:2").unwrap(),
                ],
                folds: vec![
                    FoldAssignment {
                        fold_id: FoldId::new("fold:0").unwrap(),
                        train_sample_ids: vec![SampleId::new("sample:2").unwrap()],
                        validation_sample_ids: vec![SampleId::new("sample:1").unwrap()],
                        metadata: BTreeMap::new(),
                    },
                    FoldAssignment {
                        fold_id: FoldId::new("fold:1").unwrap(),
                        train_sample_ids: vec![SampleId::new("sample:1").unwrap()],
                        validation_sample_ids: vec![SampleId::new("sample:2").unwrap()],
                        metadata: BTreeMap::new(),
                    },
                ],
                sample_groups: BTreeMap::new(),
                partition_mode: FoldPartitionMode::Partition,
            }),
        }),
        generation: Default::default(),
        shape_plans,
        data_bindings,
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    };
    let mut model_manifest = controller_manifest("controller:model.obs", NodeKind::Model);
    model_manifest.supported_phases = BTreeSet::from([Phase::FitCv]);
    let mut agg_manifest = controller_manifest("controller:agg.custom", NodeKind::Aggregator);
    agg_manifest.supported_phases = BTreeSet::from([Phase::Plan]);
    agg_manifest.fit_scope = ControllerFitScope::InferenceOnly;
    agg_manifest
        .capabilities
        .insert(ControllerCapability::AggregatesPredictions);
    let mut registry = ControllerRegistry::new();
    registry.register(model_manifest).unwrap();
    registry.register(agg_manifest).unwrap();
    build_execution_plan(
        "plan:observation.prediction.runtime",
        graph,
        campaign,
        &registry,
    )
    .unwrap()
}

fn live_group_oof_runtime_plan() -> ExecutionPlan {
    let base_id = NodeId::new("model:base").unwrap();
    let graph = GraphSpec {
        id: "graph:live.group.oof".to_string(),
        interface: GraphInterface::default(),
        nodes: vec![
            node(
                "model:base",
                NodeKind::Model,
                vec![port("x", PortKind::Data)],
                vec![port("pred", PortKind::Prediction)],
            ),
            node(
                "model:meta",
                NodeKind::Model,
                vec![port("pred", PortKind::Prediction)],
                vec![port("pred", PortKind::Prediction)],
            ),
        ],
        edges: vec![EdgeSpec {
            source: PortRef {
                node_id: NodeId::new("model:base").unwrap(),
                port_name: "pred".to_string(),
            },
            target: PortRef {
                node_id: NodeId::new("model:meta").unwrap(),
                port_name: "pred".to_string(),
            },
            contract: EdgeContract {
                requires_oof: true,
                requires_fold_alignment: true,
                ..EdgeContract::new(PortKind::Prediction, None)
            },
        }],
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    };
    let aggregation_policy = AggregationPolicy {
        aggregation_level: PredictionLevel::Group,
        method: AggregationMethod::Mean,
        ..AggregationPolicy::default()
    };
    let shape_plan = DataModelShapePlan {
        node_id: base_id.clone(),
        input_granularity: Granularity::Observation,
        target_granularity: Granularity::Sample,
        fit_rows: FitBoundary::FoldTrain,
        predict_rows: FitBoundary::FoldValidation,
        feature_namespace: Some("nir".to_string()),
        feature_schema_fingerprint: None,
        target_space: "regression:y".to_string(),
        aggregation_policy,
        augmentation_policy: Default::default(),
        selection_policy: Default::default(),
    };
    let leakage_policy = LeakageUnitPolicy {
        split_unit: SplitUnit::Group,
        require_group_ids: true,
        ..LeakageUnitPolicy::default()
    };
    let campaign = CampaignSpec {
        inner_cv: None,
        id: "campaign:live.group.oof".to_string(),
        root_seed: Some(19),
        leakage_policy: leakage_policy.clone(),
        aggregation_policy: Default::default(),
        split_invocation: Some(SplitInvocation {
            id: "split:live.group.oof".to_string(),
            controller_id: None,
            leakage_policy,
            params: BTreeMap::new(),
            fold_set: Some(FoldSet {
                id: "folds:live.group.oof".to_string(),
                sample_ids: vec![
                    SampleId::new("sample:1").unwrap(),
                    SampleId::new("sample:2").unwrap(),
                ],
                folds: vec![
                    FoldAssignment {
                        fold_id: FoldId::new("fold:0").unwrap(),
                        train_sample_ids: vec![SampleId::new("sample:2").unwrap()],
                        validation_sample_ids: vec![SampleId::new("sample:1").unwrap()],
                        metadata: BTreeMap::new(),
                    },
                    FoldAssignment {
                        fold_id: FoldId::new("fold:1").unwrap(),
                        train_sample_ids: vec![SampleId::new("sample:1").unwrap()],
                        validation_sample_ids: vec![SampleId::new("sample:2").unwrap()],
                        metadata: BTreeMap::new(),
                    },
                ],
                sample_groups: BTreeMap::from([
                    (
                        SampleId::new("sample:1").unwrap(),
                        GroupId::new("plant.A").unwrap(),
                    ),
                    (
                        SampleId::new("sample:2").unwrap(),
                        GroupId::new("plant.B").unwrap(),
                    ),
                ]),
                partition_mode: FoldPartitionMode::Partition,
            }),
        }),
        generation: Default::default(),
        shape_plans: BTreeMap::from([(base_id.clone(), shape_plan)]),
        data_bindings: BTreeMap::from([(base_id.clone(), vec![data_binding(&base_id)])]),
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    };
    let mut manifest = controller_manifest("controller:model", NodeKind::Model);
    manifest.supported_phases = BTreeSet::from([Phase::FitCv, Phase::Refit]);
    let mut registry = ControllerRegistry::new();
    registry.register(manifest).unwrap();
    build_execution_plan("plan:live.group.oof", graph, campaign, &registry).unwrap()
}

fn custom_aggregation_policy(level: PredictionLevel) -> AggregationPolicy {
    AggregationPolicy {
        aggregation_level: level,
        method: AggregationMethod::CustomController,
        custom_controller: Some(AggregationControllerSpec {
            controller_id: ControllerId::new("controller:agg.custom").unwrap(),
            params: json!({"trim": 0.1}),
        }),
        ..AggregationPolicy::default()
    }
}

fn simple_graph() -> GraphSpec {
    GraphSpec {
        id: "g".to_string(),
        interface: GraphInterface::default(),
        nodes: vec![
            node(
                "transform:snv",
                NodeKind::Transform,
                vec![],
                vec![port("x", PortKind::Data)],
            ),
            node(
                "model:pls",
                NodeKind::Model,
                vec![port("x", PortKind::Data)],
                vec![port("pred", PortKind::Prediction)],
            ),
        ],
        edges: vec![EdgeSpec {
            source: PortRef {
                node_id: NodeId::new("transform:snv").unwrap(),
                port_name: "x".to_string(),
            },
            target: PortRef {
                node_id: NodeId::new("model:pls").unwrap(),
                port_name: "x".to_string(),
            },
            contract: EdgeContract {
                requires_oof: false,
                requires_fold_alignment: false,
                ..EdgeContract::new(PortKind::Data, None)
            },
        }],
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    }
}

fn independent_parallel_graph() -> GraphSpec {
    GraphSpec {
        id: "g:parallel".to_string(),
        interface: GraphInterface::default(),
        nodes: vec![
            node(
                "transform:left",
                NodeKind::Transform,
                vec![],
                vec![port("x", PortKind::Data)],
            ),
            node(
                "transform:right",
                NodeKind::Transform,
                vec![],
                vec![port("x", PortKind::Data)],
            ),
        ],
        edges: Vec::new(),
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    }
}

fn parallel_stress_graph() -> GraphSpec {
    const WIDTH: usize = 6;

    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    let mut merge_inputs = Vec::new();
    for idx in 0..WIDTH {
        let transform_id = format!("transform:stress.{idx}");
        let model_id = format!("model:stress.{idx}");
        let merge_port = format!("pred{idx}");
        nodes.push(node(
            &transform_id,
            NodeKind::Transform,
            vec![],
            vec![port("x", PortKind::Data)],
        ));
        nodes.push(node(
            &model_id,
            NodeKind::Model,
            vec![port("x", PortKind::Data)],
            vec![port("pred", PortKind::Prediction)],
        ));
        merge_inputs.push(port(&merge_port, PortKind::Prediction));
        edges.push(EdgeSpec {
            source: PortRef {
                node_id: NodeId::new(transform_id).unwrap(),
                port_name: "x".to_string(),
            },
            target: PortRef {
                node_id: NodeId::new(&model_id).unwrap(),
                port_name: "x".to_string(),
            },
            contract: EdgeContract {
                requires_oof: false,
                requires_fold_alignment: false,
                ..EdgeContract::new(PortKind::Data, None)
            },
        });
        edges.push(EdgeSpec {
            source: PortRef {
                node_id: NodeId::new(model_id).unwrap(),
                port_name: "pred".to_string(),
            },
            target: PortRef {
                node_id: NodeId::new("merge:stress").unwrap(),
                port_name: merge_port,
            },
            contract: EdgeContract {
                requires_oof: false,
                requires_fold_alignment: true,
                ..EdgeContract::new(PortKind::Prediction, None)
            },
        });
    }
    nodes.push(node(
        "merge:stress",
        NodeKind::MixedJoin,
        merge_inputs,
        vec![port("merged", PortKind::Data)],
    ));

    GraphSpec {
        id: "g:parallel.stress".to_string(),
        interface: GraphInterface::default(),
        nodes,
        edges,
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    }
}

fn oof_edge_graph() -> GraphSpec {
    GraphSpec {
        id: "g:oof.edge".to_string(),
        interface: GraphInterface::default(),
        nodes: vec![
            node(
                "model:base",
                NodeKind::Model,
                vec![],
                vec![port("pred", PortKind::Prediction)],
            ),
            node(
                "model:meta",
                NodeKind::Model,
                vec![port("pred", PortKind::Prediction)],
                vec![port("pred", PortKind::Prediction)],
            ),
        ],
        edges: vec![EdgeSpec {
            source: PortRef {
                node_id: NodeId::new("model:base").unwrap(),
                port_name: "pred".to_string(),
            },
            target: PortRef {
                node_id: NodeId::new("model:meta").unwrap(),
                port_name: "pred".to_string(),
            },
            contract: EdgeContract {
                requires_oof: true,
                requires_fold_alignment: true,
                ..EdgeContract::new(PortKind::Prediction, None)
            },
        }],
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    }
}

fn oof_edge_graph_with_auxiliary_port() -> GraphSpec {
    let mut graph = oof_edge_graph();
    graph.id = "g:oof.edge.auxiliary".to_string();
    let base = graph
        .nodes
        .iter_mut()
        .find(|node| node.id.as_str() == "model:base")
        .expect("base node exists");
    base.ports.outputs.push(port("aux", PortKind::Artifact));
    let meta = graph
        .nodes
        .iter_mut()
        .find(|node| node.id.as_str() == "model:meta")
        .expect("meta node exists");
    meta.ports.inputs.push(port("aux", PortKind::Artifact));
    graph.edges.push(EdgeSpec {
        source: PortRef {
            node_id: NodeId::new("model:base").unwrap(),
            port_name: "aux".to_string(),
        },
        target: PortRef {
            node_id: NodeId::new("model:meta").unwrap(),
            port_name: "aux".to_string(),
        },
        contract: EdgeContract::new(PortKind::Artifact, None),
    });
    graph
}

fn oof_edge_graph_with_ambiguous_prediction_port() -> GraphSpec {
    let mut graph = oof_edge_graph();
    graph.id = "g:oof.edge.ambiguous.prediction.port".to_string();
    let base = graph
        .nodes
        .iter_mut()
        .find(|node| node.id.as_str() == "model:base")
        .expect("base node exists");
    base.ports.outputs.push(port("aux", PortKind::Prediction));
    let meta = graph
        .nodes
        .iter_mut()
        .find(|node| node.id.as_str() == "model:meta")
        .expect("meta node exists");
    meta.ports.inputs.push(port("aux", PortKind::Prediction));
    graph.edges.push(EdgeSpec {
        source: PortRef {
            node_id: NodeId::new("model:base").unwrap(),
            port_name: "aux".to_string(),
        },
        target: PortRef {
            node_id: NodeId::new("model:meta").unwrap(),
            port_name: "aux".to_string(),
        },
        contract: EdgeContract {
            requires_oof: true,
            requires_fold_alignment: true,
            ..EdgeContract::new(PortKind::Prediction, None)
        },
    });
    graph
}

fn oof_edge_graph_with_refit_policy(policy: &str) -> GraphSpec {
    let mut graph = oof_edge_graph();
    graph.id = format!("g:oof.edge.{policy}");
    let meta = graph
        .nodes
        .iter_mut()
        .find(|node| node.id.as_str() == "model:meta")
        .expect("meta node exists");
    meta.metadata.insert(
        STACKING_OOF_REFIT_CONTRACT_METADATA_KEY.to_string(),
        json!({ "policy": policy }),
    );
    graph
}

fn runtime_controllers() -> RuntimeControllerRegistry {
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(MockController {
            id: ControllerId::new("controller:transform").unwrap(),
            handle: 1,
            emit_prediction: false,
        }))
        .unwrap();
    controllers
        .register(Box::new(MockController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 2,
            emit_prediction: true,
        }))
        .unwrap();
    controllers
}

fn oof_edge_runtime_controllers(
    base_partition: Option<PredictionPartition>,
    sample_mode: OofSampleMode,
) -> RuntimeControllerRegistry {
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(OofEdgeController {
            id: ControllerId::new("controller:model").unwrap(),
            base_partition,
            sample_mode,
        }))
        .unwrap();
    controllers
}

fn expected_refit_oof_runtime_controllers(
    expected_fold_ids: Vec<FoldId>,
    expected_sample_ids: Vec<SampleId>,
    expected_target_names: Vec<String>,
) -> RuntimeControllerRegistry {
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(ExpectedRefitOofController {
            id: ControllerId::new("controller:model").unwrap(),
            expected_fold_ids,
            expected_sample_ids,
            expected_target_names,
        }))
        .unwrap();
    controllers
}

fn replay_runtime_controllers() -> RuntimeControllerRegistry {
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(ReplayMockController {
            id: ControllerId::new("controller:transform.mock").unwrap(),
            handle: 11,
            require_artifact: false,
            emit_prediction: false,
            emit_refit_artifact: false,
        }))
        .unwrap();
    controllers
        .register(Box::new(ReplayMockController {
            id: ControllerId::new("controller:model.mock").unwrap(),
            handle: 22,
            require_artifact: true,
            emit_prediction: true,
            emit_refit_artifact: false,
        }))
        .unwrap();
    controllers
}

fn two_fold_set() -> FoldSet {
    FoldSet {
        id: "outer".to_string(),
        sample_ids: vec![SampleId::new("s1").unwrap(), SampleId::new("s2").unwrap()],
        folds: vec![
            FoldAssignment {
                fold_id: FoldId::new("fold:0").unwrap(),
                train_sample_ids: vec![SampleId::new("s2").unwrap()],
                validation_sample_ids: vec![SampleId::new("s1").unwrap()],
                metadata: BTreeMap::new(),
            },
            FoldAssignment {
                fold_id: FoldId::new("fold:1").unwrap(),
                train_sample_ids: vec![SampleId::new("s1").unwrap()],
                validation_sample_ids: vec![SampleId::new("s2").unwrap()],
                metadata: BTreeMap::new(),
            },
        ],
        sample_groups: BTreeMap::new(),
        partition_mode: FoldPartitionMode::Partition,
    }
}

fn three_fold_stress_set() -> FoldSet {
    let samples = (0..6)
        .map(|idx| SampleId::new(format!("s{idx}")).unwrap())
        .collect::<Vec<_>>();
    let folds = (0..3)
        .map(|fold_idx| {
            let validation_sample_ids = samples
                .iter()
                .enumerate()
                .filter_map(|(idx, sample_id)| (idx % 3 == fold_idx).then_some(sample_id.clone()))
                .collect::<Vec<_>>();
            let train_sample_ids = samples
                .iter()
                .filter(|sample_id| !validation_sample_ids.contains(sample_id))
                .cloned()
                .collect::<Vec<_>>();
            FoldAssignment {
                fold_id: FoldId::new(format!("fold:{fold_idx}")).unwrap(),
                train_sample_ids,
                validation_sample_ids,
                metadata: BTreeMap::new(),
            }
        })
        .collect::<Vec<_>>();
    FoldSet {
        id: "outer:stress".to_string(),
        sample_ids: samples,
        folds,
        sample_groups: BTreeMap::new(),
        partition_mode: FoldPartitionMode::Partition,
    }
}

fn grouped_repetition_fold_set() -> FoldSet {
    let s1 = SampleId::new("s1").unwrap();
    let s1_rep = SampleId::new("s1_rep").unwrap();
    let s2 = SampleId::new("s2").unwrap();
    let s3 = SampleId::new("s3").unwrap();
    FoldSet {
        id: "outer:grouped-repetition".to_string(),
        sample_ids: vec![s1.clone(), s1_rep.clone(), s2.clone(), s3.clone()],
        folds: vec![
            FoldAssignment {
                fold_id: FoldId::new("fold:0").unwrap(),
                train_sample_ids: vec![s2.clone(), s3.clone()],
                validation_sample_ids: vec![s1.clone(), s1_rep.clone()],
                metadata: BTreeMap::new(),
            },
            FoldAssignment {
                fold_id: FoldId::new("fold:1").unwrap(),
                train_sample_ids: vec![s1.clone(), s1_rep.clone(), s3.clone()],
                validation_sample_ids: vec![s2.clone()],
                metadata: BTreeMap::new(),
            },
            FoldAssignment {
                fold_id: FoldId::new("fold:2").unwrap(),
                train_sample_ids: vec![s1.clone(), s1_rep.clone(), s2.clone()],
                validation_sample_ids: vec![s3.clone()],
                metadata: BTreeMap::new(),
            },
        ],
        sample_groups: BTreeMap::from([
            (s1, GroupId::new("group:product1").unwrap()),
            (s1_rep, GroupId::new("group:product1").unwrap()),
            (s2, GroupId::new("group:product2").unwrap()),
            (s3, GroupId::new("group:product3").unwrap()),
        ]),
        partition_mode: FoldPartitionMode::Partition,
    }
}

fn grouped_leakage_policy() -> LeakageUnitPolicy {
    LeakageUnitPolicy {
        split_unit: SplitUnit::Group,
        require_group_ids: true,
        ..LeakageUnitPolicy::default()
    }
}

fn sample_relation(
    observation_id: &str,
    sample_id: &str,
    target_id: &str,
    group_id: &str,
    origin_sample_id: Option<&str>,
    is_augmented: bool,
) -> SampleRelation {
    let mut relation = SampleRelation::new(
        ObservationId::new(observation_id).unwrap(),
        SampleId::new(sample_id).unwrap(),
    );
    relation.target_id = Some(TargetId::new(target_id).unwrap());
    relation.group_id = Some(GroupId::new(group_id).unwrap());
    relation.origin_sample_id = origin_sample_id.map(|value| SampleId::new(value).unwrap());
    relation.source_id = Some("nir".to_string());
    relation.is_augmented = is_augmented;
    relation
}

fn grouped_repetition_relations() -> SampleRelationSet {
    SampleRelationSet {
        records: vec![
            sample_relation(
                "obs:s1:a",
                "s1",
                "target:product1",
                "group:product1",
                None,
                false,
            ),
            sample_relation(
                "obs:s1:b",
                "s1",
                "target:product1",
                "group:product1",
                None,
                false,
            ),
            sample_relation(
                "obs:s1:aug0",
                "s1",
                "target:product1",
                "group:product1",
                Some("s1"),
                true,
            ),
            sample_relation(
                "obs:s1rep:a",
                "s1_rep",
                "target:product1",
                "group:product1",
                None,
                false,
            ),
            sample_relation(
                "obs:s2:a",
                "s2",
                "target:product2",
                "group:product2",
                None,
                false,
            ),
            sample_relation(
                "obs:s2:b",
                "s2",
                "target:product2",
                "group:product2",
                None,
                false,
            ),
            sample_relation(
                "obs:s3:a",
                "s3",
                "target:product3",
                "group:product3",
                None,
                false,
            ),
        ],
    }
}

fn grouped_oof_campaign(fold_set: FoldSet) -> CampaignSpec {
    let leakage_policy = grouped_leakage_policy();
    CampaignSpec {
        inner_cv: None,
        id: "campaign:oof.grouped-repetition".to_string(),
        root_seed: Some(11),
        leakage_policy: leakage_policy.clone(),
        aggregation_policy: AggregationPolicy::default(),
        split_invocation: Some(SplitInvocation {
            id: "split:outer.grouped-repetition".to_string(),
            controller_id: None,
            leakage_policy,
            params: BTreeMap::new(),
            fold_set: Some(fold_set),
        }),
        generation: Default::default(),
        shape_plans: BTreeMap::new(),
        data_bindings: BTreeMap::new(),
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    }
}

fn data_binding(node_id: &NodeId) -> crate::data::DataBinding {
    crate::data::DataBinding {
        node_id: node_id.clone(),
        input_name: "x".to_string(),
        request_id: "nir-to-tabular".to_string(),
        schema_fingerprint: "f97b37872fa22134b508f98fd8e207e5b776b52594fb8f6f5c3e15bee212246b"
            .to_string(),
        plan_fingerprint: "7c5431d85574b3f337022fa5d25971d5b5cf445b90331b49938f573ff6901e4d"
            .to_string(),
        relation_fingerprint: Some(
            "a3a7e329df35db9f2883a17b8611b7fae6dcaa031875e3ec2c9be1b9e29cbe10".to_string(),
        ),
        output_representation: "tabular_numeric".to_string(),
        feature_set_id: Some("x".to_string()),
        source_ids: vec!["nir".to_string()],
        require_relations: true,
        view_policy: Default::default(),
        metadata: BTreeMap::new(),
    }
}

fn oof_edge_campaign() -> CampaignSpec {
    CampaignSpec {
        inner_cv: None,
        id: "campaign:oof.edge".to_string(),
        root_seed: Some(11),
        leakage_policy: Default::default(),
        aggregation_policy: Default::default(),
        split_invocation: Some(SplitInvocation {
            id: "split:outer".to_string(),
            controller_id: None,
            leakage_policy: Default::default(),
            params: BTreeMap::new(),
            fold_set: Some(two_fold_set()),
        }),
        generation: Default::default(),
        shape_plans: BTreeMap::new(),
        data_bindings: BTreeMap::new(),
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    }
}

fn parallel_stress_campaign() -> CampaignSpec {
    CampaignSpec {
        inner_cv: None,
        id: "campaign:parallel.stress".to_string(),
        root_seed: Some(31),
        leakage_policy: Default::default(),
        aggregation_policy: Default::default(),
        split_invocation: Some(SplitInvocation {
            id: "split:parallel.stress".to_string(),
            controller_id: None,
            leakage_policy: Default::default(),
            params: BTreeMap::new(),
            fold_set: Some(three_fold_stress_set()),
        }),
        generation: GenerationSpec {
            strategy: GenerationStrategy::Cartesian,
            dimensions: vec![GenerationDimension {
                name: "model_family".to_string(),
                choices: ["linear", "tree", "kernel"]
                    .into_iter()
                    .enumerate()
                    .map(|(rank, label)| GenerationChoice {
                        label: label.to_string(),
                        value: json!(label),
                        param_overrides: (0..6)
                            .map(|idx| crate::generation::GenerationParamOverride {
                                node_id: NodeId::new(format!("model:stress.{idx}")).unwrap(),
                                params: BTreeMap::from([
                                    ("family".to_string(), json!(label)),
                                    ("variant_rank".to_string(), json!(rank)),
                                ]),
                            })
                            .collect(),
                        active_subsequence: None,
                    })
                    .collect(),
            }],
            max_variants: Some(3),
            constraints: GenerationConstraints::default(),
        },
        shape_plans: BTreeMap::new(),
        data_bindings: BTreeMap::new(),
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    }
}

fn parallel_stress_manifests() -> crate::controller::ControllerRegistry {
    let mut registry = manifests();
    let mut mixed_join = controller_manifest("controller:mixed_join", NodeKind::MixedJoin);
    mixed_join.fit_scope = ControllerFitScope::Stateless;
    registry.register(mixed_join).unwrap();
    registry
}

fn manifests() -> crate::controller::ControllerRegistry {
    let mut manifests = crate::controller::ControllerRegistry::new();
    manifests
        .register(controller_manifest(
            "controller:transform",
            NodeKind::Transform,
        ))
        .unwrap();
    manifests
        .register(controller_manifest("controller:model", NodeKind::Model))
        .unwrap();
    manifests
}

fn oof_edge_manifests(phases: BTreeSet<Phase>) -> crate::controller::ControllerRegistry {
    let mut manifest = controller_manifest("controller:model", NodeKind::Model);
    manifest.supported_phases = phases;
    let mut manifests = crate::controller::ControllerRegistry::new();
    manifests.register(manifest).unwrap();
    manifests
}

fn fixture_plan(plan_id: &str) -> ExecutionPlan {
    let graph: GraphSpec = serde_json::from_str(include_str!(
        "../../tests/fixtures/package/minimal_graph.json"
    ))
    .unwrap();
    let campaign: CampaignSpec = serde_json::from_str(include_str!(
        "../../tests/fixtures/package/campaign_oof_generation.json"
    ))
    .unwrap();
    let manifests: Vec<ControllerManifest> = serde_json::from_str(include_str!(
        "../../tests/fixtures/package/controller_manifests.json"
    ))
    .unwrap();
    let mut registry = ControllerRegistry::new();
    for manifest in manifests {
        registry.register(manifest).unwrap();
    }
    build_execution_plan(plan_id, graph, campaign, &registry).unwrap()
}

fn replay_bundle(plan: &ExecutionPlan) -> crate::bundle::ExecutionBundle {
    let model_plan = plan
        .node_plans
        .get(&NodeId::new("model:base").unwrap())
        .unwrap();
    build_execution_bundle(
        crate::ids::BundleId::new("bundle:replay").unwrap(),
        plan,
        Some(plan.variants[0].variant_id.clone()),
        BTreeMap::new(),
        vec![RefitArtifactRecord {
            node_id: model_plan.node_id.clone(),
            controller_id: model_plan.controller_id.clone(),
            artifact: ArtifactRef {
                id: ArtifactId::new("artifact:model:base:refit").unwrap(),
                kind: "mock_model".to_string(),
                controller_id: model_plan.controller_id.clone(),
                backend: None,
                uri: None,
                content_fingerprint: None,
                size_bytes: Some(128),
                plugin: None,
                plugin_version: None,
                abi_major: None,
                abi_min_minor: None,
                native_predictor_descriptor: None,
            },
            params_fingerprint: model_plan.params_fingerprint.clone(),
            training_loss_fingerprint: model_plan.training_loss_fingerprint(Phase::Refit).unwrap(),
            data_requirement_keys: vec!["model:base.x".to_string()],
            prediction_requirement_keys: Vec::new(),
        }],
    )
    .unwrap()
}

fn replay_request(bundle: &crate::bundle::ExecutionBundle, phase: Phase) -> ReplayPhaseRequest {
    ReplayPhaseRequest {
        bundle_id: bundle.bundle_id.clone(),
        phase,
        data_envelope_keys: vec!["model:base.x".to_string()],
    }
}

fn replay_envelopes() -> BTreeMap<String, ExternalDataPlanEnvelope> {
    BTreeMap::from([(
        "model:base.x".to_string(),
        serde_json::from_str(include_str!(
            "../../tests/fixtures/package/data/coordinator_data_plan_envelope_sample12.json"
        ))
        .unwrap(),
    )])
}

fn replay_data_provider() -> InMemoryDataProvider {
    InMemoryDataProvider::with_envelope(
        ControllerId::new("controller:data.provider").unwrap(),
        replay_envelopes().remove("model:base.x").unwrap(),
    )
    .unwrap()
}

fn replay_artifact_store(bundle: &crate::bundle::ExecutionBundle) -> InMemoryArtifactStore {
    let mut store = InMemoryArtifactStore::new();
    let artifact = &bundle.refit_artifacts[0];
    store
        .register(
            artifact,
            HandleRef {
                handle: 9001,
                kind: HandleKind::Model,
                owner_controller: artifact.controller_id.clone(),
            },
        )
        .unwrap();
    store
}

#[test]
fn sequential_scheduler_invokes_mock_controllers_in_topological_order() {
    let plan = build_execution_plan(
        "plan:fitcv",
        simple_graph(),
        CampaignSpec {
            inner_cv: None,
            id: "campaign:fitcv".to_string(),
            root_seed: Some(11),
            leakage_policy: Default::default(),
            aggregation_policy: Default::default(),
            split_invocation: None,
            generation: Default::default(),
            shape_plans: BTreeMap::new(),
            data_bindings: BTreeMap::new(),
            branch_view_plans: Vec::new(),
            metadata: BTreeMap::new(),
        },
        &manifests(),
    )
    .unwrap();
    let controllers = runtime_controllers();
    let mut ctx = RunContext::new(RunId::new("run:1").unwrap(), Some(11));

    let results = SequentialScheduler
        .execute_phase(&plan, &controllers, &mut ctx, Phase::FitCv)
        .unwrap();

    assert_eq!(results.len(), 2);
    assert_eq!(ctx.lineage.len(), 2);
    assert_eq!(ctx.prediction_store.blocks().len(), 1);
    assert_eq!(results[1].node_id.as_str(), "model:pls");
    let transform_lineage = ctx
        .lineage
        .records()
        .find(|record| record.node_id.as_str() == "transform:snv")
        .expect("transform lineage exists");
    let model_lineage = ctx
        .lineage
        .records()
        .find(|record| record.node_id.as_str() == "model:pls")
        .expect("model lineage exists");
    assert_eq!(
        model_lineage.input_lineage,
        vec![transform_lineage.record_id.clone()]
    );
}

#[test]
fn parallel_scheduler_invokes_independent_level_concurrently() {
    struct ConcurrencyProbeController {
        id: ControllerId,
        active: Arc<AtomicUsize>,
        max_active: Arc<AtomicUsize>,
    }

    impl RuntimeController for ConcurrencyProbeController {
        fn controller_id(&self) -> &ControllerId {
            &self.id
        }

        fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
            let active = self.active.fetch_add(1, Ordering::SeqCst) + 1;
            let mut observed = self.max_active.load(Ordering::SeqCst);
            while active > observed
                && self
                    .max_active
                    .compare_exchange(observed, active, Ordering::SeqCst, Ordering::SeqCst)
                    .is_err()
            {
                observed = self.max_active.load(Ordering::SeqCst);
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
            self.active.fetch_sub(1, Ordering::SeqCst);
            Ok(NodeResult {
                schema_version: None,
                node_id: task.node_plan.node_id.clone(),
                outputs: BTreeMap::from([(
                    "x".to_string(),
                    HandleRef {
                        handle: task.node_plan.node_id.as_str().len() as u64,
                        kind: HandleKind::Data,
                        owner_controller: self.id.clone(),
                    },
                )]),
                predictions: Vec::new(),
                observation_predictions: Vec::new(),
                aggregated_predictions: Vec::new(),
                explanations: Vec::new(),
                shape_deltas: Vec::new(),
                artifacts: Vec::new(),
                artifact_handles: BTreeMap::new(),
                fit_influence_diagnostics: Vec::new(),
                regression_targets: Vec::new(),
                lineage: LineageRecord {
                    record_id: LineageId::new(format!(
                        "lineage:parallel:{}",
                        task.node_plan.node_id
                    ))
                    .unwrap(),
                    run_id: task.run_id.clone(),
                    node_id: task.node_plan.node_id.clone(),
                    phase: task.phase,
                    controller_id: self.id.clone(),
                    controller_version: task.node_plan.controller_version.clone(),
                    variant_id: task.variant_id.clone(),
                    fold_id: task.fold_id.clone(),
                    branch_path: task.branch_path.clone(),
                    input_lineage: Vec::new(),
                    artifact_refs: Vec::new(),
                    params_fingerprint: task.node_plan.params_fingerprint.clone(),
                    data_model_shape_fingerprint: None,
                    aggregation_policy_fingerprint: None,
                    seed: task.seed,
                    unsafe_flags: BTreeSet::new(),
                    metrics: BTreeMap::new(),
                    loss_attestations: Vec::new(),
                    early_stopping_records: Vec::new(),
                },
            })
        }
    }

    assert!(ParallelScheduler::new(0).is_err());
    let plan = build_execution_plan(
        "plan:parallel",
        independent_parallel_graph(),
        CampaignSpec {
            inner_cv: None,
            id: "campaign:parallel".to_string(),
            root_seed: Some(11),
            leakage_policy: Default::default(),
            aggregation_policy: Default::default(),
            split_invocation: None,
            generation: Default::default(),
            shape_plans: BTreeMap::new(),
            data_bindings: BTreeMap::new(),
            branch_view_plans: Vec::new(),
            metadata: BTreeMap::new(),
        },
        &manifests(),
    )
    .unwrap();
    let active = Arc::new(AtomicUsize::new(0));
    let max_active = Arc::new(AtomicUsize::new(0));
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(ConcurrencyProbeController {
            id: ControllerId::new("controller:transform").unwrap(),
            active: Arc::clone(&active),
            max_active: Arc::clone(&max_active),
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:parallel").unwrap(), Some(11));

    let results = ParallelScheduler::new(2)
        .unwrap()
        .execute_phase(&plan, &controllers, &mut ctx, Phase::FitCv)
        .unwrap();

    assert_eq!(results.len(), 2);
    assert_eq!(ctx.lineage.len(), 2);
    assert!(max_active.load(Ordering::SeqCst) >= 2);
}

#[test]
fn parallel_campaign_scheduler_stress_matches_sequential_across_variants_and_folds() {
    struct StressProbeController {
        id: ControllerId,
        active: Arc<AtomicUsize>,
        max_active: Arc<AtomicUsize>,
        invocations: Arc<Mutex<Vec<String>>>,
        pause: bool,
    }

    impl RuntimeController for StressProbeController {
        fn controller_id(&self) -> &ControllerId {
            &self.id
        }

        fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
            assert_stress_inputs(task)?;
            let task_key = stress_task_key(task);
            self.invocations.lock().unwrap().push(task_key.clone());
            let active = self.active.fetch_add(1, Ordering::SeqCst) + 1;
            update_max_active(&self.max_active, active);
            if self.pause {
                std::thread::sleep(std::time::Duration::from_millis(8));
            }
            self.active.fetch_sub(1, Ordering::SeqCst);

            let (output_name, output_kind) = match &task.node_plan.kind {
                NodeKind::Model => ("pred", HandleKind::Prediction),
                NodeKind::MixedJoin => ("merged", HandleKind::Data),
                _ => ("x", HandleKind::Data),
            };
            let prediction_value = (stable_test_handle(&task_key) % 10_000) as f64 / 100.0;
            let predictions = matches!(&task.node_plan.kind, NodeKind::Model)
                .then(|| {
                    let sample_ids = stress_validation_samples(task.fold_id.as_ref());
                    PredictionBlock {
                        prediction_id: Some(format!(
                            "prediction:{}:{}:{}",
                            task.node_plan.node_id,
                            task.variant_id
                                .as_ref()
                                .map(ToString::to_string)
                                .unwrap_or_else(|| "variant:base".to_string()),
                            task.fold_id
                                .as_ref()
                                .map(ToString::to_string)
                                .unwrap_or_else(|| "nofold".to_string())
                        )),
                        producer_node: task.node_plan.node_id.clone(),
                        producer_port: None,
                        partition: PredictionPartition::Validation,
                        fold_id: task.fold_id.clone(),
                        values: sample_ids
                            .iter()
                            .enumerate()
                            .map(|(idx, _)| vec![prediction_value + idx as f64])
                            .collect(),
                        sample_ids,
                        target_names: vec!["y".to_string()],
                    }
                })
                .into_iter()
                .collect::<Vec<_>>();
            Ok(NodeResult {
                schema_version: None,
                node_id: task.node_plan.node_id.clone(),
                outputs: BTreeMap::from([(
                    output_name.to_string(),
                    HandleRef {
                        handle: stable_test_handle(&task_key),
                        kind: output_kind,
                        owner_controller: self.id.clone(),
                    },
                )]),
                predictions,
                observation_predictions: Vec::new(),
                aggregated_predictions: Vec::new(),
                explanations: Vec::new(),
                shape_deltas: Vec::new(),
                artifacts: Vec::new(),
                artifact_handles: BTreeMap::new(),
                fit_influence_diagnostics: Vec::new(),
                regression_targets: Vec::new(),
                lineage: LineageRecord {
                    record_id: LineageId::new(format!(
                        "lineage:stress:{}:{}:{}",
                        task.node_plan.node_id,
                        task.variant_id
                            .as_ref()
                            .map(ToString::to_string)
                            .unwrap_or_else(|| "variant:base".to_string()),
                        task.fold_id
                            .as_ref()
                            .map(ToString::to_string)
                            .unwrap_or_else(|| "nofold".to_string())
                    ))
                    .unwrap(),
                    run_id: task.run_id.clone(),
                    node_id: task.node_plan.node_id.clone(),
                    phase: task.phase,
                    controller_id: self.id.clone(),
                    controller_version: task.node_plan.controller_version.clone(),
                    variant_id: task.variant_id.clone(),
                    fold_id: task.fold_id.clone(),
                    branch_path: task.branch_path.clone(),
                    input_lineage: Vec::new(),
                    artifact_refs: Vec::new(),
                    params_fingerprint: task.node_plan.params_fingerprint.clone(),
                    data_model_shape_fingerprint: None,
                    aggregation_policy_fingerprint: None,
                    seed: task.seed,
                    unsafe_flags: BTreeSet::new(),
                    metrics: BTreeMap::new(),
                    loss_attestations: Vec::new(),
                    early_stopping_records: Vec::new(),
                },
            })
        }
    }

    fn stress_runtime_controllers(
        active: Arc<AtomicUsize>,
        max_active: Arc<AtomicUsize>,
        invocations: Arc<Mutex<Vec<String>>>,
        pause: bool,
    ) -> RuntimeControllerRegistry {
        let mut controllers = RuntimeControllerRegistry::new();
        for id in [
            "controller:transform",
            "controller:model",
            "controller:mixed_join",
        ] {
            controllers
                .register(Box::new(StressProbeController {
                    id: ControllerId::new(id).unwrap(),
                    active: Arc::clone(&active),
                    max_active: Arc::clone(&max_active),
                    invocations: Arc::clone(&invocations),
                    pause,
                }))
                .unwrap();
        }
        controllers
    }

    fn update_max_active(max_active: &AtomicUsize, active: usize) {
        let mut observed = max_active.load(Ordering::SeqCst);
        while active > observed
            && max_active
                .compare_exchange(observed, active, Ordering::SeqCst, Ordering::SeqCst)
                .is_err()
        {
            observed = max_active.load(Ordering::SeqCst);
        }
    }

    fn stress_task_key(task: &NodeTask) -> String {
        format!(
            "{}|{}|{}|{}|{}",
            task.node_plan.node_id,
            task.variant_id
                .as_ref()
                .map(ToString::to_string)
                .unwrap_or_else(|| "variant:base".to_string()),
            task.fold_id
                .as_ref()
                .map(ToString::to_string)
                .unwrap_or_else(|| "nofold".to_string()),
            task.seed
                .map(|seed| seed.to_string())
                .unwrap_or_else(|| "noseed".to_string()),
            task.node_plan.params_fingerprint,
        )
    }

    fn stable_test_handle(label: &str) -> u64 {
        label
            .bytes()
            .fold(14_695_981_039_346_656_037, |hash, byte| {
                (hash ^ byte as u64).wrapping_mul(1_099_511_628_211)
            })
    }

    fn stress_validation_samples(fold_id: Option<&FoldId>) -> Vec<SampleId> {
        match fold_id.map(FoldId::as_str) {
            Some("fold:0") => vec![SampleId::new("s0").unwrap(), SampleId::new("s3").unwrap()],
            Some("fold:1") => vec![SampleId::new("s1").unwrap(), SampleId::new("s4").unwrap()],
            Some("fold:2") => vec![SampleId::new("s2").unwrap(), SampleId::new("s5").unwrap()],
            _ => vec![SampleId::new("s0").unwrap()],
        }
    }

    fn assert_stress_inputs(task: &NodeTask) -> Result<()> {
        let node_id = task.node_plan.node_id.as_str();
        if node_id.starts_with("transform:stress.") && !task.input_handles.is_empty() {
            return Err(DagMlError::RuntimeValidation(format!(
                "source node `{node_id}` received unexpected inputs"
            )));
        }
        if node_id.starts_with("model:stress.")
            && !task
                .input_handles
                .keys()
                .any(|key| key.starts_with("transform:stress.") && key.ends_with(".x"))
        {
            return Err(DagMlError::RuntimeValidation(format!(
                "model node `{node_id}` did not receive its transform input"
            )));
        }
        if node_id == "merge:stress" {
            let model_inputs = task
                .input_handles
                .keys()
                .filter(|key| key.starts_with("model:stress.") && key.ends_with(".pred"))
                .count();
            if model_inputs != 6 {
                return Err(DagMlError::RuntimeValidation(format!(
                    "merge node received {model_inputs} model inputs, expected 6"
                )));
            }
        }
        Ok(())
    }

    fn lineage_records(ctx: &RunContext) -> Vec<LineageRecord> {
        ctx.lineage.records().cloned().collect::<Vec<_>>()
    }

    let plan = build_execution_plan(
        "plan:parallel.stress",
        parallel_stress_graph(),
        parallel_stress_campaign(),
        &parallel_stress_manifests(),
    )
    .unwrap();
    let levels = plan.node_parallel_levels_for_phase(Phase::FitCv).unwrap();
    assert_eq!(
        levels.iter().map(Vec::len).collect::<Vec<_>>(),
        vec![6, 6, 1]
    );
    assert_eq!(plan.variants.len(), 3);
    assert_eq!(plan.fold_set.as_ref().unwrap().folds.len(), 3);

    let sequential_active = Arc::new(AtomicUsize::new(0));
    let sequential_max_active = Arc::new(AtomicUsize::new(0));
    let sequential_invocations = Arc::new(Mutex::new(Vec::new()));
    let sequential_controllers = stress_runtime_controllers(
        Arc::clone(&sequential_active),
        Arc::clone(&sequential_max_active),
        Arc::clone(&sequential_invocations),
        false,
    );
    let mut sequential_ctx = RunContext::new(RunId::new("run:parallel.stress").unwrap(), Some(31));
    let sequential_results = SequentialScheduler
        .execute_campaign_phase(
            &plan,
            &sequential_controllers,
            &mut sequential_ctx,
            Phase::FitCv,
        )
        .unwrap();

    let parallel_active = Arc::new(AtomicUsize::new(0));
    let parallel_max_active = Arc::new(AtomicUsize::new(0));
    let parallel_invocations = Arc::new(Mutex::new(Vec::new()));
    let parallel_controllers = stress_runtime_controllers(
        Arc::clone(&parallel_active),
        Arc::clone(&parallel_max_active),
        Arc::clone(&parallel_invocations),
        true,
    );
    let mut parallel_ctx = RunContext::new(RunId::new("run:parallel.stress").unwrap(), Some(31));
    let parallel_results = ParallelScheduler::new(4)
        .unwrap()
        .execute_campaign_phase(
            &plan,
            &parallel_controllers,
            &mut parallel_ctx,
            Phase::FitCv,
        )
        .unwrap();

    assert_eq!(sequential_results.len(), 117);
    assert_eq!(parallel_results, sequential_results);
    assert_eq!(
        parallel_ctx.prediction_store.blocks(),
        sequential_ctx.prediction_store.blocks()
    );
    assert_eq!(
        lineage_records(&parallel_ctx),
        lineage_records(&sequential_ctx)
    );
    assert_eq!(parallel_ctx.prediction_store.blocks().len(), 54);
    assert_eq!(parallel_ctx.lineage.len(), 117);
    assert_eq!(
        parallel_results
            .iter()
            .filter_map(|result| result.lineage.seed)
            .collect::<BTreeSet<_>>()
            .len(),
        parallel_results.len()
    );
    assert_eq!(
        parallel_invocations
            .lock()
            .unwrap()
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>(),
        sequential_invocations
            .lock()
            .unwrap()
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>()
    );
    let observed_parallelism = parallel_max_active.load(Ordering::SeqCst);
    assert!((2..=4).contains(&observed_parallelism));
    assert_eq!(parallel_active.load(Ordering::SeqCst), 0);
    assert_eq!(sequential_max_active.load(Ordering::SeqCst), 1);
}

#[test]
fn campaign_scheduler_expands_variants_and_cv_folds() {
    let plan = build_execution_plan(
        "plan:campaign",
        simple_graph(),
        CampaignSpec {
            inner_cv: None,
            id: "campaign:fitcv".to_string(),
            root_seed: Some(11),
            leakage_policy: Default::default(),
            aggregation_policy: Default::default(),
            split_invocation: Some(SplitInvocation {
                id: "split:outer".to_string(),
                controller_id: None,
                leakage_policy: Default::default(),
                params: BTreeMap::new(),
                fold_set: Some(two_fold_set()),
            }),
            generation: GenerationSpec {
                strategy: GenerationStrategy::Cartesian,
                dimensions: vec![GenerationDimension {
                    name: "model_family".to_string(),
                    choices: vec![
                        GenerationChoice {
                            label: "pls".to_string(),
                            value: json!("pls"),
                            param_overrides: Vec::new(),
                            active_subsequence: None,
                        },
                        GenerationChoice {
                            label: "rf".to_string(),
                            value: json!("rf"),
                            param_overrides: Vec::new(),
                            active_subsequence: None,
                        },
                    ],
                }],
                max_variants: Some(2),
                constraints: GenerationConstraints::default(),
            },
            shape_plans: BTreeMap::new(),
            data_bindings: BTreeMap::new(),
            branch_view_plans: Vec::new(),
            metadata: BTreeMap::new(),
        },
        &manifests(),
    )
    .unwrap();
    let controllers = runtime_controllers();
    let mut ctx = RunContext::new(RunId::new("run:campaign").unwrap(), Some(11));

    let results = SequentialScheduler
        .execute_campaign_phase(&plan, &controllers, &mut ctx, Phase::FitCv)
        .unwrap();

    assert_eq!(results.len(), 8);
    assert_eq!(ctx.lineage.len(), 8);
    assert_eq!(ctx.prediction_store.blocks().len(), 4);
    assert!(ctx
        .lineage
        .records()
        .all(|record| record.variant_id.is_some() && record.fold_id.is_some()));
    assert_eq!(
        ctx.lineage
            .records()
            .filter_map(|record| record.seed)
            .collect::<BTreeSet<_>>()
            .len(),
        8
    );
}

#[test]
fn node_tasks_expose_generation_variant_context() {
    let plan = build_execution_plan(
        "plan:generation.task.context",
        simple_graph(),
        CampaignSpec {
            inner_cv: None,
            id: "campaign:generation.task.context".to_string(),
            root_seed: Some(23),
            leakage_policy: Default::default(),
            aggregation_policy: Default::default(),
            split_invocation: None,
            generation: GenerationSpec {
                strategy: GenerationStrategy::Cartesian,
                dimensions: vec![GenerationDimension {
                    name: "model_family".to_string(),
                    choices: vec![
                        GenerationChoice {
                            label: "pls".to_string(),
                            value: json!("pls"),
                            param_overrides: vec![crate::generation::GenerationParamOverride {
                                node_id: NodeId::new("model:pls").unwrap(),
                                params: BTreeMap::from([("n_components".to_string(), json!(4))]),
                            }],
                            active_subsequence: None,
                        },
                        GenerationChoice {
                            label: "rf".to_string(),
                            value: json!("rf"),
                            param_overrides: vec![crate::generation::GenerationParamOverride {
                                node_id: NodeId::new("model:pls").unwrap(),
                                params: BTreeMap::from([("trees".to_string(), json!(64))]),
                            }],
                            active_subsequence: None,
                        },
                    ],
                }],
                max_variants: Some(2),
                constraints: GenerationConstraints::default(),
            },
            shape_plans: BTreeMap::new(),
            data_bindings: BTreeMap::new(),
            branch_view_plans: Vec::new(),
            metadata: BTreeMap::new(),
        },
        &manifests(),
    )
    .unwrap();
    let observed_variants = Arc::new(Mutex::new(Vec::new()));
    let observed_node_plans = Arc::new(Mutex::new(Vec::new()));
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(MockController {
            id: ControllerId::new("controller:transform").unwrap(),
            handle: 1,
            emit_prediction: false,
        }))
        .unwrap();
    controllers
        .register(Box::new(VariantProbeController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 2,
            variants: Arc::clone(&observed_variants),
            node_plans: Arc::clone(&observed_node_plans),
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:generation.task.context").unwrap(), Some(23));

    let results = SequentialScheduler
        .execute_campaign_phase(&plan, &controllers, &mut ctx, Phase::FitCv)
        .unwrap();

    assert_eq!(results.len(), 4);
    let observed = observed_variants.lock().unwrap();
    assert_eq!(observed.len(), 2);
    let mut labels = BTreeSet::new();
    for variant in observed.iter().map(|variant| variant.as_ref().unwrap()) {
        variant.validate().unwrap();
        let expected = plan
            .variants
            .iter()
            .find(|planned| planned.variant_id == variant.variant_id)
            .unwrap();
        assert_eq!(variant.choices, expected.choices);
        assert_eq!(variant.fingerprint, expected.fingerprint);
        assert_eq!(variant.seed, expected.seed);
        labels.insert(variant.choices["model_family"].label.as_str());
    }
    assert_eq!(labels, BTreeSet::from(["pls", "rf"]));
    let observed_plans = observed_node_plans.lock().unwrap();
    assert_eq!(observed_plans.len(), 2);
    let base_plan = plan
        .node_plans
        .get(&NodeId::new("model:pls").unwrap())
        .unwrap();
    assert!(observed_plans
        .iter()
        .all(|node_plan| node_plan.params_fingerprint != base_plan.params_fingerprint));
    assert!(observed_plans
        .iter()
        .any(|node_plan| node_plan.params.get("n_components") == Some(&json!(4))));
    assert!(observed_plans
        .iter()
        .any(|node_plan| node_plan.params.get("trees") == Some(&json!(64))));
}

#[test]
fn requires_oof_prediction_edge_supplies_validated_prediction_handle() {
    let plan = build_execution_plan(
        "plan:oof.edge.success",
        oof_edge_graph(),
        oof_edge_campaign(),
        &manifests(),
    )
    .unwrap();
    let controllers = oof_edge_runtime_controllers(
        Some(PredictionPartition::Validation),
        OofSampleMode::Aligned,
    );
    let mut ctx = RunContext::new(RunId::new("run:oof.edge.success").unwrap(), Some(11));

    let results = SequentialScheduler
        .execute_campaign_phase(&plan, &controllers, &mut ctx, Phase::FitCv)
        .unwrap();

    assert_eq!(results.len(), 4);
    assert_eq!(ctx.prediction_store.blocks().len(), 2);
    assert_eq!(
        results
            .iter()
            .filter(|result| result.node_id.as_str() == "model:meta")
            .count(),
        2
    );
}

#[test]
fn requires_oof_prediction_edge_rejects_missing_validation_predictions() {
    let plan = build_execution_plan(
        "plan:oof.edge.missing",
        oof_edge_graph(),
        oof_edge_campaign(),
        &manifests(),
    )
    .unwrap();
    let controllers = oof_edge_runtime_controllers(None, OofSampleMode::Aligned);
    let mut ctx = RunContext::new(RunId::new("run:oof.edge.missing").unwrap(), Some(11));

    let error = SequentialScheduler
        .execute_campaign_phase(&plan, &controllers, &mut ctx, Phase::FitCv)
        .unwrap_err();

    assert!(matches!(&error, DagMlError::OofValidation(_)));
    assert_eq!(error.category(), "validation");
    assert_eq!(error.code(), "oof_validation");
    assert_eq!(error.error_code(), 4);
    let message = error.to_string();
    assert!(message.contains("requires OOF validation predictions"));
    assert!(message.contains("model:base"));
}

#[test]
fn requires_oof_prediction_edge_rejects_train_predictions_as_features() {
    let plan = build_execution_plan(
        "plan:oof.edge.train",
        oof_edge_graph(),
        oof_edge_campaign(),
        &manifests(),
    )
    .unwrap();
    let controllers =
        oof_edge_runtime_controllers(Some(PredictionPartition::Train), OofSampleMode::Aligned);
    let mut ctx = RunContext::new(RunId::new("run:oof.edge.train").unwrap(), Some(11));

    let error = SequentialScheduler
        .execute_campaign_phase(&plan, &controllers, &mut ctx, Phase::FitCv)
        .unwrap_err()
        .to_string();

    assert!(error.contains("requires OOF validation predictions"));
}

#[test]
fn requires_oof_prediction_edge_carries_validation_oof_values_in_fit_cv() {
    // Option A: the meta-node `PredictionInputSpec` carries the Validation OOF
    // value rows so a host can build the stacking matrix during FIT_CV.
    let plan = build_execution_plan(
        "plan:oof.edge.values",
        oof_edge_graph(),
        oof_edge_campaign(),
        &manifests(),
    )
    .unwrap();

    let captured = Arc::new(Mutex::new(Vec::new()));
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(CaptureOofValuesController {
            id: ControllerId::new("controller:model").unwrap(),
            captured: Arc::clone(&captured),
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:oof.edge.values").unwrap(), Some(11));

    SequentialScheduler
        .execute_campaign_phase(&plan, &controllers, &mut ctx, Phase::FitCv)
        .unwrap();

    let observed = captured.lock().unwrap();
    // One meta-node invocation per fold (fold:0 -> s1, fold:1 -> s2).
    assert_eq!(observed.len(), 2);
    let by_sample = observed
        .iter()
        .map(|(sample_ids, values, width)| {
            // Values stay aligned 1:1 with sample_ids at the declared width.
            assert_eq!(values.len(), sample_ids.len());
            assert_eq!(*width, 1);
            assert!(values.iter().all(|row| row.len() == *width));
            (sample_ids[0].to_string(), values[0][0])
        })
        .collect::<BTreeMap<_, _>>();
    assert_eq!(by_sample.get("s1"), Some(&0.25));
    assert_eq!(by_sample.get("s2"), Some(&0.75));
}

#[test]
fn requires_oof_prediction_edge_rejects_fold_misalignment() {
    let plan = build_execution_plan(
        "plan:oof.edge.misaligned",
        oof_edge_graph(),
        oof_edge_campaign(),
        &manifests(),
    )
    .unwrap();
    let controllers = oof_edge_runtime_controllers(
        Some(PredictionPartition::Validation),
        OofSampleMode::Swapped,
    );
    let mut ctx = RunContext::new(RunId::new("run:oof.edge.misaligned").unwrap(), Some(11));

    let error = SequentialScheduler
        .execute_campaign_phase(&plan, &controllers, &mut ctx, Phase::FitCv)
        .unwrap_err();

    assert!(matches!(&error, DagMlError::OofValidation(_)));
    assert!(error
        .to_string()
        .contains("do not match validation samples"));
}

#[test]
fn requires_oof_edge_exact_coverage_is_mandatory_even_without_fold_alignment_flag() {
    // R-P0-2: exact OOF coverage used to be gated by `requires_fold_alignment`, making completeness
    // CONDITIONAL — a `requires_oof` edge that left the flag unset admitted blocks that merely exist.
    // The check is now mandatory for every `requires_oof` stacking edge reaching the runtime, so a
    // fold-misaligned OOF block is rejected even with `requires_fold_alignment: false`.
    let mut graph = oof_edge_graph();
    graph.id = "g:oof.edge.no.align".to_string();
    graph.edges[0].contract.requires_fold_alignment = false;
    assert!(graph.edges[0].contract.requires_oof);

    let plan = build_execution_plan(
        "plan:oof.edge.no.align",
        graph,
        oof_edge_campaign(),
        &manifests(),
    )
    .unwrap();
    let controllers = oof_edge_runtime_controllers(
        Some(PredictionPartition::Validation),
        OofSampleMode::Swapped,
    );
    let mut ctx = RunContext::new(RunId::new("run:oof.edge.no.align").unwrap(), Some(11));

    let error = SequentialScheduler
        .execute_campaign_phase(&plan, &controllers, &mut ctx, Phase::FitCv)
        .unwrap_err()
        .to_string();

    assert!(
        error.contains("do not match validation samples"),
        "exact OOF coverage must fire without the fold-alignment flag: {error}"
    );
}

#[test]
fn requires_oof_prediction_edge_refit_uses_cv_oof_coverage() {
    let plan = build_execution_plan(
        "plan:oof.edge.refit",
        oof_edge_graph(),
        oof_edge_campaign(),
        &oof_edge_manifests(BTreeSet::from([Phase::FitCv, Phase::Refit])),
    )
    .unwrap();
    let fit_controllers = oof_edge_runtime_controllers(
        Some(PredictionPartition::Validation),
        OofSampleMode::Aligned,
    );
    let mut ctx = RunContext::new(RunId::new("run:oof.edge.refit").unwrap(), Some(11));
    SequentialScheduler
        .execute_campaign_phase(&plan, &fit_controllers, &mut ctx, Phase::FitCv)
        .unwrap();
    assert_eq!(ctx.prediction_store.blocks().len(), 2);

    let refit_controllers = oof_edge_runtime_controllers(None, OofSampleMode::Aligned);
    let refit_results = SequentialScheduler
        .execute_campaign_phase(&plan, &refit_controllers, &mut ctx, Phase::Refit)
        .unwrap();

    assert_eq!(refit_results.len(), 2);
    assert_eq!(
        refit_results
            .iter()
            .filter(|result| result.node_id.as_str() == "model:meta")
            .count(),
        1
    );
}

#[test]
fn d9_golden_oof_refit_and_predict_replay_mock_run() {
    #[derive(serde::Deserialize)]
    struct D9GoldenFixture {
        golden_scenarios: Vec<D9GoldenScenario>,
    }

    #[derive(serde::Deserialize)]
    struct D9GoldenScenario {
        scenario_id: String,
        mock_phase_path: Vec<String>,
    }

    let fixture: D9GoldenFixture = serde_json::from_str(include_str!(
        "../../tests/fixtures/package/data/d9_golden_multisource_scenarios.json"
    ))
    .unwrap();
    assert_eq!(fixture.golden_scenarios.len(), 7);

    for (index, scenario) in fixture.golden_scenarios.iter().enumerate() {
        assert_eq!(scenario.mock_phase_path, ["fit_cv", "refit", "predict"]);
        let oof_plan = build_execution_plan(
            format!("plan:d9.oof.refit.{index}"),
            oof_edge_graph(),
            oof_edge_campaign(),
            &oof_edge_manifests(BTreeSet::from([Phase::FitCv, Phase::Refit])),
        )
        .unwrap();
        let mut oof_ctx = RunContext::new(
            RunId::new(format!("run:d9.oof.refit.{index}")).unwrap(),
            Some(11),
        );
        let fit_controllers = oof_edge_runtime_controllers(
            Some(PredictionPartition::Validation),
            OofSampleMode::Aligned,
        );
        let fit_results = SequentialScheduler
            .execute_campaign_phase(&oof_plan, &fit_controllers, &mut oof_ctx, Phase::FitCv)
            .unwrap();
        assert_eq!(
            fit_results.len(),
            4,
            "{} did not mock-run fit_cv through OOF",
            scenario.scenario_id
        );
        assert_eq!(
            oof_ctx.prediction_store.blocks().len(),
            2,
            "{} did not emit complete validation OOF",
            scenario.scenario_id
        );

        let refit_controllers = oof_edge_runtime_controllers(None, OofSampleMode::Aligned);
        let refit_results = SequentialScheduler
            .execute_campaign_phase(&oof_plan, &refit_controllers, &mut oof_ctx, Phase::Refit)
            .unwrap();
        assert_eq!(
            refit_results
                .iter()
                .filter(|result| result.node_id.as_str() == "model:meta")
                .count(),
            1,
            "{} did not mock-run refit with full OOF coverage",
            scenario.scenario_id
        );

        let replay_plan = fixture_plan(&format!("plan:d9.predict.replay.{index}"));
        let bundle = replay_bundle(&replay_plan);
        let request = replay_request(&bundle, Phase::Predict);
        let envelopes = replay_envelopes();
        let provider = replay_data_provider();
        let store = replay_artifact_store(&bundle);
        let controllers = replay_runtime_controllers();
        let mut replay_ctx = RunContext::new(
            RunId::new(format!("run:d9.predict.replay.{index}")).unwrap(),
            Some(11),
        );
        let replay_results = SequentialScheduler
            .execute_bundle_replay(
                BundleReplayExecution {
                    plan: &replay_plan,
                    bundle: &bundle,
                    replay_request: &request,
                    prediction_cache_store: None,
                    controllers: &controllers,
                    data_provider: &provider,
                    artifact_store: &store,
                    data_envelopes: &envelopes,
                },
                &mut replay_ctx,
            )
            .unwrap();

        assert_eq!(
            replay_results.len(),
            2,
            "{} did not mock-run predict replay",
            scenario.scenario_id
        );
        assert_eq!(provider.view_records().len(), 1);
        assert_eq!(
            provider.view_records()[0].view.partition,
            DataRequestPartition::Predict
        );
        assert_eq!(replay_ctx.prediction_store.blocks().len(), 1);
        assert_eq!(
            replay_ctx.prediction_store.blocks()[0].partition,
            PredictionPartition::Final
        );
    }
}

#[test]
fn requires_oof_prediction_edge_feeds_live_group_units_to_fit_cv_and_refit() {
    let plan = live_group_oof_runtime_plan();
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(GroupAggregatedOofController {
            id: ControllerId::new("controller:model").unwrap(),
        }))
        .unwrap();
    let envelope: ExternalDataPlanEnvelope = serde_json::from_str(include_str!(
        "../../tests/fixtures/package/data/coordinator_data_plan_envelope_sample12.json"
    ))
    .unwrap();
    let data_provider = InMemoryDataProvider::with_envelope(
        ControllerId::new("controller:data").unwrap(),
        envelope,
    )
    .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:live.group.oof").unwrap(), Some(19));

    let fit_results = SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &data_provider,
            &mut ctx,
            Phase::FitCv,
        )
        .unwrap();

    assert_eq!(fit_results.len(), 4);
    assert!(ctx.prediction_store.blocks().is_empty());
    assert_eq!(ctx.aggregated_prediction_store.blocks().len(), 2);
    assert_eq!(
        ctx.aggregated_prediction_store
            .blocks()
            .iter()
            .map(|block| (&block.fold_id, block.level, block.unit_ids.clone()))
            .collect::<Vec<_>>(),
        vec![
            (
                &Some(FoldId::new("fold:0").unwrap()),
                PredictionLevel::Group,
                vec![PredictionUnitId::Group(GroupId::new("plant.A").unwrap())],
            ),
            (
                &Some(FoldId::new("fold:1").unwrap()),
                PredictionLevel::Group,
                vec![PredictionUnitId::Group(GroupId::new("plant.B").unwrap())],
            ),
        ]
    );

    let refit_results = SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &data_provider,
            &mut ctx,
            Phase::Refit,
        )
        .unwrap();

    assert_eq!(refit_results.len(), 2);
    assert_eq!(
        refit_results
            .iter()
            .filter(|result| result.node_id.as_str() == "model:meta")
            .count(),
        1
    );
}

#[test]
fn aggregated_oof_edge_rejects_relation_level_train_validation_overlap() {
    let plan = live_group_oof_runtime_plan();
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(GroupAggregatedOofController {
            id: ControllerId::new("controller:model").unwrap(),
        }))
        .unwrap();
    let mut envelope: ExternalDataPlanEnvelope = serde_json::from_str(include_str!(
        "../../tests/fixtures/package/data/coordinator_data_plan_envelope_sample12.json"
    ))
    .unwrap();
    for record in &mut envelope
        .coordinator_relations
        .as_mut()
        .expect("fixture carries coordinator relations")
        .records
    {
        if record.sample_id.as_str() == "sample:2" {
            record.group_id = Some(GroupId::new("plant.A").unwrap());
        }
    }
    let data_provider = InMemoryDataProvider::with_envelope(
        ControllerId::new("controller:data").unwrap(),
        envelope,
    )
    .unwrap();
    let mut ctx = RunContext::new(
        RunId::new("run:live.group.oof.relation-overlap").unwrap(),
        Some(19),
    );

    let error = SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &data_provider,
            &mut ctx,
            Phase::FitCv,
        )
        .unwrap_err();

    assert!(matches!(&error, DagMlError::OofValidation(_)));
    let message = error.to_string();
    assert!(
        message.contains("both train and validation partitions"),
        "unexpected overlap error: {message}"
    );
}

#[test]
fn runtime_dispatches_custom_observation_aggregation_controller() {
    let plan = aggregation_dispatch_plan(true);
    let task_ids = Arc::new(Mutex::new(Vec::new()));
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(CustomAggregationController {
            id: ControllerId::new("controller:agg.custom").unwrap(),
            task_ids: Arc::clone(&task_ids),
        }))
        .unwrap();
    let relations = SampleRelationSet {
        records: vec![
            sample_relation("obs:s1:a", "s1", "target:s1", "group:left", None, false),
            sample_relation("obs:s1:b", "s1", "target:s1", "group:left", None, false),
            sample_relation("obs:s2:a", "s2", "target:s2", "group:right", None, false),
        ],
    };

    let block = dispatch_custom_observation_aggregation(
        &plan,
        &controllers,
        "agg-task:obs-to-sample",
        ObservationPredictionBlock {
            prediction_id: Some("pred:obs".to_string()),
            producer_node: NodeId::new("model:base").unwrap(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new("fold:0").unwrap()),
            observation_ids: vec![
                ObservationId::new("obs:s1:a").unwrap(),
                ObservationId::new("obs:s1:b").unwrap(),
                ObservationId::new("obs:s2:a").unwrap(),
            ],
            values: vec![vec![1.0], vec![5.0], vec![10.0]],
            weights: Vec::new(),
            target_names: vec!["y".to_string()],
        },
        relations,
        custom_aggregation_policy(PredictionLevel::Sample),
        vec![SampleId::new("s1").unwrap(), SampleId::new("s2").unwrap()],
    )
    .unwrap();

    assert_eq!(
        block.sample_ids,
        vec![SampleId::new("s1").unwrap(), SampleId::new("s2").unwrap()]
    );
    assert_eq!(block.values, vec![vec![3.0], vec![10.0]]);
    assert_eq!(
        task_ids.lock().unwrap().as_slice(),
        &["agg-task:obs-to-sample".to_string()]
    );
}

#[test]
fn runtime_dispatches_custom_sample_to_group_aggregation_controller() {
    let plan = aggregation_dispatch_plan(true);
    let task_ids = Arc::new(Mutex::new(Vec::new()));
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(CustomAggregationController {
            id: ControllerId::new("controller:agg.custom").unwrap(),
            task_ids: Arc::clone(&task_ids),
        }))
        .unwrap();
    let relations = SampleRelationSet {
        records: vec![
            sample_relation("obs:s1:a", "s1", "target:s1", "group:left", None, false),
            sample_relation("obs:s2:a", "s2", "target:s2", "group:left", None, false),
            sample_relation("obs:s3:a", "s3", "target:s3", "group:right", None, false),
        ],
    };
    let left = PredictionUnitId::Group(GroupId::new("group:left").unwrap());
    let right = PredictionUnitId::Group(GroupId::new("group:right").unwrap());

    let block = dispatch_custom_sample_aggregation(
        &plan,
        &controllers,
        "agg-task:sample-to-group",
        PredictionBlock {
            prediction_id: Some("pred:sample".to_string()),
            producer_node: NodeId::new("model:base").unwrap(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new("fold:0").unwrap()),
            sample_ids: vec![
                SampleId::new("s1").unwrap(),
                SampleId::new("s2").unwrap(),
                SampleId::new("s3").unwrap(),
            ],
            values: vec![vec![1.0], vec![8.0], vec![3.0]],
            target_names: vec!["y".to_string()],
        },
        relations,
        custom_aggregation_policy(PredictionLevel::Group),
        vec![left.clone(), right.clone()],
    )
    .unwrap();

    assert_eq!(block.level, PredictionLevel::Group);
    assert_eq!(block.unit_ids, vec![left, right]);
    assert_eq!(block.values, vec![vec![8.0], vec![3.0]]);
    assert_eq!(
        task_ids.lock().unwrap().as_slice(),
        &["agg-task:sample-to-group".to_string()]
    );
}

#[test]
fn custom_aggregation_dispatch_requires_controller_capability() {
    let plan = aggregation_dispatch_plan(false);
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(CustomAggregationController {
            id: ControllerId::new("controller:agg.custom").unwrap(),
            task_ids: Arc::new(Mutex::new(Vec::new())),
        }))
        .unwrap();
    let error = dispatch_custom_observation_aggregation(
        &plan,
        &controllers,
        "agg-task:no-capability",
        ObservationPredictionBlock {
            prediction_id: None,
            producer_node: NodeId::new("model:base").unwrap(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new("fold:0").unwrap()),
            observation_ids: vec![ObservationId::new("obs:s1:a").unwrap()],
            values: vec![vec![1.0]],
            weights: Vec::new(),
            target_names: vec!["y".to_string()],
        },
        SampleRelationSet {
            records: vec![sample_relation(
                "obs:s1:a",
                "s1",
                "target:s1",
                "group:left",
                None,
                false,
            )],
        },
        custom_aggregation_policy(PredictionLevel::Sample),
        vec![SampleId::new("s1").unwrap()],
    )
    .unwrap_err()
    .to_string();

    assert!(
        error.contains("aggregates_predictions"),
        "unexpected capability error: {error}"
    );
}

#[test]
fn scheduler_aggregates_observation_predictions_with_custom_controller() {
    let plan = observation_prediction_runtime_plan();
    let task_ids = Arc::new(Mutex::new(Vec::new()));
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(ObservationPredictionRuntimeController {
            id: ControllerId::new("controller:model.obs").unwrap(),
        }))
        .unwrap();
    controllers
        .register(Box::new(CustomAggregationController {
            id: ControllerId::new("controller:agg.custom").unwrap(),
            task_ids: Arc::clone(&task_ids),
        }))
        .unwrap();
    let envelope: ExternalDataPlanEnvelope = serde_json::from_str(include_str!(
        "../../tests/fixtures/package/data/coordinator_data_plan_envelope_sample12.json"
    ))
    .unwrap();
    let data_provider = InMemoryDataProvider::with_envelope(
        ControllerId::new("controller:data").unwrap(),
        envelope,
    )
    .unwrap();
    let mut ctx = RunContext::new(
        RunId::new("run:observation.prediction.runtime").unwrap(),
        Some(17),
    );

    let results = SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &data_provider,
            &mut ctx,
            Phase::FitCv,
        )
        .unwrap();

    assert_eq!(results.len(), 2);
    assert!(results
        .iter()
        .all(|result| result.observation_predictions.len() == 1));
    assert!(results.iter().all(|result| result.predictions.len() == 1));
    let blocks = ctx.prediction_store.blocks();
    assert_eq!(
        blocks
            .iter()
            .flat_map(|block| block.sample_ids.iter().cloned())
            .collect::<Vec<_>>(),
        vec![
            SampleId::new("sample:1").unwrap(),
            SampleId::new("sample:2").unwrap()
        ]
    );
    assert_eq!(
        blocks
            .iter()
            .flat_map(|block| block.values.iter().cloned())
            .collect::<Vec<_>>(),
        vec![vec![4.0], vec![10.0]]
    );
    assert_eq!(task_ids.lock().unwrap().len(), 2);
}

#[test]
fn refit_oof_accepts_grouped_repeated_aggregation_and_refuses_origin_leakage() {
    let fold_set = grouped_repetition_fold_set();
    let relations = grouped_repetition_relations();
    let leakage_policy = grouped_leakage_policy();
    relations
        .validate_against_fold_set(&fold_set, &leakage_policy)
        .unwrap();

    let mut leaky_relations = relations.clone();
    leaky_relations.records.push(sample_relation(
        "obs:s1:leaky_aug",
        "s1",
        "target:product1",
        "group:product1",
        Some("s2"),
        true,
    ));
    let leak_error = leaky_relations
        .validate_against_fold_set(&fold_set, &leakage_policy)
        .unwrap_err()
        .to_string();
    assert!(
        leak_error.contains("leaks origin sample"),
        "unexpected leakage error: {leak_error}"
    );

    let plan = build_execution_plan(
        "plan:oof.edge.grouped-repetition.refit",
        oof_edge_graph(),
        grouped_oof_campaign(fold_set.clone()),
        &oof_edge_manifests(BTreeSet::from([Phase::Refit])),
    )
    .unwrap();
    let mut ctx = RunContext::new(
        RunId::new("run:oof.edge.grouped-repetition.refit").unwrap(),
        Some(11),
    );

    let fold0 = aggregate_observation_predictions(
        &ObservationPredictionBlock {
            prediction_id: Some("pred:model:base:fold0:obs".to_string()),
            producer_node: NodeId::new("model:base").unwrap(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new("fold:0").unwrap()),
            observation_ids: vec![
                ObservationId::new("obs:s1:a").unwrap(),
                ObservationId::new("obs:s1:b").unwrap(),
                ObservationId::new("obs:s1rep:a").unwrap(),
            ],
            values: vec![vec![1.0], vec![3.0], vec![4.0]],
            weights: Vec::new(),
            target_names: vec!["y".to_string()],
        },
        &relations,
        &AggregationPolicy::default(),
        &[
            SampleId::new("s1").unwrap(),
            SampleId::new("s1_rep").unwrap(),
        ],
    )
    .unwrap();
    assert_eq!(fold0.values, vec![vec![2.0], vec![4.0]]);
    ctx.prediction_store.append(fold0).unwrap();

    let fold1 = aggregate_observation_predictions(
        &ObservationPredictionBlock {
            prediction_id: Some("pred:model:base:fold1:obs".to_string()),
            producer_node: NodeId::new("model:base").unwrap(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new("fold:1").unwrap()),
            observation_ids: vec![
                ObservationId::new("obs:s2:a").unwrap(),
                ObservationId::new("obs:s2:b").unwrap(),
            ],
            values: vec![vec![10.0], vec![14.0]],
            weights: Vec::new(),
            target_names: vec!["y".to_string()],
        },
        &relations,
        &AggregationPolicy::default(),
        &[SampleId::new("s2").unwrap()],
    )
    .unwrap();
    assert_eq!(fold1.values, vec![vec![12.0]]);
    ctx.prediction_store.append(fold1).unwrap();

    let fold2 = aggregate_observation_predictions(
        &ObservationPredictionBlock {
            prediction_id: Some("pred:model:base:fold2:obs".to_string()),
            producer_node: NodeId::new("model:base").unwrap(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new("fold:2").unwrap()),
            observation_ids: vec![ObservationId::new("obs:s3:a").unwrap()],
            values: vec![vec![20.0]],
            weights: Vec::new(),
            target_names: vec!["y".to_string()],
        },
        &relations,
        &AggregationPolicy::default(),
        &[SampleId::new("s3").unwrap()],
    )
    .unwrap();
    assert_eq!(fold2.values, vec![vec![20.0]]);
    ctx.prediction_store.append(fold2).unwrap();
    assert_eq!(ctx.prediction_store.blocks().len(), 3);

    let controllers = expected_refit_oof_runtime_controllers(
        vec![
            FoldId::new("fold:0").unwrap(),
            FoldId::new("fold:1").unwrap(),
            FoldId::new("fold:2").unwrap(),
        ],
        vec![
            SampleId::new("s1").unwrap(),
            SampleId::new("s1_rep").unwrap(),
            SampleId::new("s2").unwrap(),
            SampleId::new("s3").unwrap(),
        ],
        vec!["y".to_string()],
    );
    let refit_results = SequentialScheduler
        .execute_campaign_phase(&plan, &controllers, &mut ctx, Phase::Refit)
        .unwrap();

    assert_eq!(refit_results.len(), 2);
    assert_eq!(
        refit_results
            .iter()
            .filter(|result| result.node_id.as_str() == "model:meta")
            .count(),
        1
    );
}

#[test]
fn in_memory_prediction_cache_store_loads_and_materializes_oof_payloads() {
    let plan = build_execution_plan(
        "plan:oof.edge.cache.store",
        oof_edge_graph(),
        oof_edge_campaign(),
        &oof_edge_manifests(BTreeSet::from([Phase::FitCv, Phase::Refit])),
    )
    .unwrap();
    let fit_controllers = oof_edge_runtime_controllers(
        Some(PredictionPartition::Validation),
        OofSampleMode::Aligned,
    );
    let mut ctx = RunContext::new(RunId::new("run:oof.edge.cache.store").unwrap(), Some(11));
    SequentialScheduler
        .execute_campaign_phase(&plan, &fit_controllers, &mut ctx, Phase::FitCv)
        .unwrap();

    let requirement = BundlePredictionRequirement {
        producer_node: NodeId::new("model:base").unwrap(),
        source_port: "pred".to_string(),
        consumer_node: NodeId::new("model:meta").unwrap(),
        target_port: "pred".to_string(),
        partition: PredictionPartition::Validation,
        prediction_level: PredictionLevel::Sample,
        fold_ids: vec![
            FoldId::new("fold:0").unwrap(),
            FoldId::new("fold:1").unwrap(),
        ],
        unit_ids: Vec::new(),
        sample_ids: vec![SampleId::new("s1").unwrap(), SampleId::new("s2").unwrap()],
        prediction_width: 1,
        target_names: vec!["y".to_string()],
    };
    let mut cache =
        build_prediction_cache_record(&requirement, ctx.prediction_store.blocks()).unwrap();
    let mut payload =
        build_prediction_cache_payload(&requirement, ctx.prediction_store.blocks()).unwrap();
    let cache_namespace_fingerprints = vec!["a".repeat(64), "b".repeat(64)];
    cache.cache_namespace_fingerprints = cache_namespace_fingerprints.clone();
    payload.cache_namespace_fingerprints = cache_namespace_fingerprints.clone();
    let bundle = build_execution_bundle_with_prediction_contracts(
        BundleId::new("bundle:oof.edge.cache.store").unwrap(),
        &plan,
        Some(plan.variants[0].variant_id.clone()),
        BTreeMap::new(),
        Vec::new(),
        vec![requirement.clone()],
        vec![cache.clone()],
    )
    .unwrap();
    let payload_set = BundlePredictionCachePayloadSet {
        bundle_id: bundle.bundle_id.clone(),
        schema_version: PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION,
        caches: vec![payload],
    };
    let store = InMemoryPredictionCacheStore::from_payloads(&bundle, payload_set).unwrap();
    assert_eq!(store.payload_count(), 1);
    assert_eq!(store.load_blocks(&requirement.key()).unwrap().len(), 2);
    let mut preload_ctx = RunContext::new(
        RunId::new("run:oof.edge.cache.store.preload").unwrap(),
        Some(11),
    );
    preload_replay_prediction_cache_store(&bundle, Some(&store), &mut preload_ctx).unwrap();
    assert_eq!(preload_ctx.prediction_store.blocks().len(), 2);

    ReplayPhaseRequest {
        bundle_id: bundle.bundle_id.clone(),
        phase: Phase::Refit,
        data_envelope_keys: Vec::new(),
    }
    .validate_for_bundle_with_prediction_cache_store(&bundle, true)
    .unwrap();

    let request = PredictionCacheMaterializationRequest {
        run_id: RunId::new("run:oof.edge.cache.store.replay").unwrap(),
        bundle_id: bundle.bundle_id.clone(),
        phase: Phase::Refit,
        variant_id: bundle.selected_variant_id.clone(),
        requirement: requirement.clone(),
        cache: cache.clone(),
        producer_controller_id: ControllerId::new("controller:model").unwrap(),
    };
    let handle = store.materialize(&request).unwrap();
    assert_eq!(handle.kind, HandleKind::Prediction);
    assert_eq!(
        handle.owner_controller,
        ControllerId::new("controller:model").unwrap()
    );
    let records = store.materialization_records();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].requirement_key, requirement.key());
    assert_eq!(
        records[0].cache_namespace_fingerprints,
        cache_namespace_fingerprints
    );
    assert_eq!(records[0].handle, handle);
    records[0].validate_against_request(&request).unwrap();
    let mut missing_variant_request = request.clone();
    missing_variant_request.variant_id = None;
    assert!(store
        .materialize(&missing_variant_request)
        .unwrap_err()
        .to_string()
        .contains("requires variant_id"));
    let mut dropped_namespace = records[0].clone();
    dropped_namespace.cache_namespace_fingerprints.clear();
    assert!(dropped_namespace
        .validate_against_request(&request)
        .unwrap_err()
        .to_string()
        .contains("dropped or changed"));
    let mut wrong_handle_kind = records[0].clone();
    wrong_handle_kind.handle.kind = HandleKind::Artifact;
    assert!(wrong_handle_kind
        .validate()
        .unwrap_err()
        .to_string()
        .contains("non-prediction handle"));

    let alternate_cache_namespace_fingerprints = vec!["c".repeat(64), "d".repeat(64)];
    let mut alternate_cache = cache.clone();
    alternate_cache.cache_namespace_fingerprints = alternate_cache_namespace_fingerprints.clone();
    let mut alternate_payload =
        build_prediction_cache_payload(&requirement, ctx.prediction_store.blocks()).unwrap();
    alternate_payload.cache_namespace_fingerprints = alternate_cache_namespace_fingerprints;
    let alternate_bundle = build_execution_bundle_with_prediction_contracts(
        bundle.bundle_id.clone(),
        &plan,
        bundle.selected_variant_id.clone(),
        BTreeMap::new(),
        Vec::new(),
        vec![requirement.clone()],
        vec![alternate_cache.clone()],
    )
    .unwrap();
    let alternate_payload_set = BundlePredictionCachePayloadSet {
        bundle_id: alternate_bundle.bundle_id.clone(),
        schema_version: PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION,
        caches: vec![alternate_payload],
    };
    let alternate_store =
        InMemoryPredictionCacheStore::from_payloads(&alternate_bundle, alternate_payload_set)
            .unwrap();
    let alternate_handle = alternate_store
        .materialize(&PredictionCacheMaterializationRequest {
            run_id: request.run_id.clone(),
            bundle_id: request.bundle_id.clone(),
            phase: request.phase,
            variant_id: request.variant_id.clone(),
            requirement,
            cache: alternate_cache,
            producer_controller_id: request.producer_controller_id.clone(),
        })
        .unwrap();
    assert_ne!(
        alternate_handle.handle, handle.handle,
        "D10 namespace fingerprints must participate in materialized cache handle identity"
    );
}

#[test]
fn prediction_cache_stores_load_and_materialize_aggregated_payloads() {
    let plan = build_execution_plan(
        "plan:oof.edge.aggregated.cache.store",
        oof_edge_graph(),
        oof_edge_campaign(),
        &oof_edge_manifests(BTreeSet::from([Phase::FitCv, Phase::Refit])),
    )
    .unwrap();
    let target_a = PredictionUnitId::Target(TargetId::new("target:a").unwrap());
    let target_b = PredictionUnitId::Target(TargetId::new("target:b").unwrap());
    let requirement = BundlePredictionRequirement {
        producer_node: NodeId::new("model:base").unwrap(),
        source_port: "pred".to_string(),
        consumer_node: NodeId::new("model:meta").unwrap(),
        target_port: "pred".to_string(),
        partition: PredictionPartition::Validation,
        prediction_level: PredictionLevel::Target,
        fold_ids: vec![
            FoldId::new("fold:0").unwrap(),
            FoldId::new("fold:1").unwrap(),
        ],
        unit_ids: vec![target_a.clone(), target_b.clone()],
        sample_ids: Vec::new(),
        prediction_width: 1,
        target_names: vec!["y".to_string()],
    };
    let aggregated_blocks = vec![
        AggregatedPredictionBlock {
            prediction_id: Some("prediction:model:base.target.fold0".to_string()),
            producer_node: requirement.producer_node.clone(),
            producer_port: Some("pred".to_string()),
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new("fold:0").unwrap()),
            level: PredictionLevel::Target,
            unit_ids: vec![target_a],
            values: vec![vec![0.5]],
            target_names: vec!["y".to_string()],
        },
        AggregatedPredictionBlock {
            prediction_id: Some("prediction:model:base.target.fold1".to_string()),
            producer_node: requirement.producer_node.clone(),
            producer_port: Some("pred".to_string()),
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new("fold:1").unwrap()),
            level: PredictionLevel::Target,
            unit_ids: vec![target_b],
            values: vec![vec![0.7]],
            target_names: vec!["y".to_string()],
        },
    ];
    let cache = build_aggregated_prediction_cache_record(&requirement, &aggregated_blocks).unwrap();
    let payload =
        build_aggregated_prediction_cache_payload(&requirement, &aggregated_blocks).unwrap();
    let bundle = build_execution_bundle_with_prediction_contracts(
        BundleId::new("bundle:aggregated.prediction.cache").unwrap(),
        &plan,
        Some(plan.variants[0].variant_id.clone()),
        BTreeMap::new(),
        Vec::new(),
        vec![requirement.clone()],
        vec![cache.clone()],
    )
    .unwrap();
    let payload_set = BundlePredictionCachePayloadSet {
        bundle_id: bundle.bundle_id.clone(),
        schema_version: PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION,
        caches: vec![payload.clone()],
    };

    let in_memory =
        InMemoryPredictionCacheStore::from_payloads(&bundle, payload_set.clone()).unwrap();
    assert!(in_memory.load_blocks(&requirement.key()).is_err());
    assert_eq!(
        in_memory
            .load_aggregated_blocks(&requirement.key())
            .unwrap(),
        aggregated_blocks
    );
    let handle = in_memory
        .materialize(&PredictionCacheMaterializationRequest {
            run_id: RunId::new("run:oof.edge.aggregated.cache.store.replay").unwrap(),
            bundle_id: bundle.bundle_id.clone(),
            phase: Phase::Refit,
            variant_id: bundle.selected_variant_id.clone(),
            requirement: requirement.clone(),
            cache: cache.clone(),
            producer_controller_id: ControllerId::new("controller:model").unwrap(),
        })
        .unwrap();
    assert_eq!(handle.kind, HandleKind::Prediction);

    let columnar =
        ColumnarPredictionCacheStore::from_payloads(&bundle, payload_set.clone()).unwrap();
    assert_eq!(columnar.entry_count(), 1);
    let manifest = columnar.manifests();
    assert_eq!(manifest.len(), 1);
    assert_eq!(manifest[0].prediction_level, PredictionLevel::Target);
    assert_eq!(manifest[0].value_count, 2);
    assert!(columnar.load_blocks(&requirement.key()).is_err());
    assert_eq!(
        columnar.load_aggregated_blocks(&requirement.key()).unwrap(),
        aggregated_blocks
    );
    let columnar_handle = columnar
        .materialize(&PredictionCacheMaterializationRequest {
            run_id: RunId::new("run:oof.edge.aggregated.columnar.cache.store.replay").unwrap(),
            bundle_id: bundle.bundle_id.clone(),
            phase: Phase::Refit,
            variant_id: bundle.selected_variant_id.clone(),
            requirement: requirement.clone(),
            cache: cache.clone(),
            producer_controller_id: ControllerId::new("controller:model").unwrap(),
        })
        .unwrap();
    assert_eq!(columnar_handle.kind, HandleKind::Prediction);

    let root = temp_prediction_cache_dir("dag_ml_aggregated_prediction_cache_store");
    let manifest =
        FilePredictionCacheStore::write_payload_set(&root, &bundle, &payload_set).unwrap();
    assert_eq!(manifest.caches[0].prediction_level, PredictionLevel::Target);
    assert_eq!(manifest.caches[0].unit_ids, requirement.unit_ids);
    let file_store = FilePredictionCacheStore::open(root.clone(), &bundle).unwrap();
    assert_eq!(
        file_store
            .load_aggregated_blocks(&requirement.key())
            .unwrap(),
        aggregated_blocks
    );
    let _ = fs::remove_dir_all(root);
}

#[test]
fn columnar_prediction_cache_block_round_trips_multi_target_rows() {
    let block = PredictionBlock {
        prediction_id: Some("pred:wide".to_string()),
        producer_node: NodeId::new("model:wide").unwrap(),
        producer_port: Some("pred".to_string()),
        partition: PredictionPartition::Validation,
        fold_id: Some(FoldId::new("fold:0").unwrap()),
        sample_ids: vec![SampleId::new("s1").unwrap(), SampleId::new("s2").unwrap()],
        values: vec![vec![1.0, 10.0], vec![2.0, 20.0]],
        target_names: vec!["y0".to_string(), "y1".to_string()],
    };

    let columnar = ColumnarPredictionCacheBlock::from_prediction_block(&block).unwrap();
    assert_eq!(columnar.width, 2);
    assert_eq!(columnar.row_count(), 2);
    assert_eq!(columnar.value_count(), 4);
    assert_eq!(columnar.columns, vec![vec![1.0, 2.0], vec![10.0, 20.0]]);
    assert_eq!(columnar.to_prediction_block().unwrap(), block);
}

#[test]
fn columnar_prediction_cache_block_round_trips_aggregated_units() {
    let block = AggregatedPredictionBlock {
        prediction_id: Some("pred:target".to_string()),
        producer_node: NodeId::new("model:target").unwrap(),
        producer_port: None,
        partition: PredictionPartition::Validation,
        fold_id: Some(FoldId::new("fold:0").unwrap()),
        level: PredictionLevel::Target,
        unit_ids: vec![
            PredictionUnitId::Target(TargetId::new("target:a").unwrap()),
            PredictionUnitId::Target(TargetId::new("target:b").unwrap()),
        ],
        values: vec![vec![1.0, 10.0], vec![2.0, 20.0]],
        target_names: vec!["y0".to_string(), "y1".to_string()],
    };

    let columnar = ColumnarPredictionCacheBlock::from_aggregated_prediction_block(&block).unwrap();
    assert_eq!(columnar.prediction_level, PredictionLevel::Target);
    assert_eq!(columnar.row_count(), 2);
    assert_eq!(columnar.value_count(), 4);
    assert_eq!(columnar.columns, vec![vec![1.0, 2.0], vec![10.0, 20.0]]);
    assert!(columnar.to_prediction_block().is_err());
    assert_eq!(columnar.to_aggregated_prediction_block().unwrap(), block);
}

#[test]
fn columnar_prediction_cache_store_loads_and_materializes_oof_payloads() {
    let plan = build_execution_plan(
        "plan:oof.edge.columnar.cache.store",
        oof_edge_graph(),
        oof_edge_campaign(),
        &oof_edge_manifests(BTreeSet::from([Phase::FitCv, Phase::Refit])),
    )
    .unwrap();
    let fit_controllers = oof_edge_runtime_controllers(
        Some(PredictionPartition::Validation),
        OofSampleMode::Aligned,
    );
    let mut ctx = RunContext::new(
        RunId::new("run:oof.edge.columnar.cache.store").unwrap(),
        Some(11),
    );
    SequentialScheduler
        .execute_campaign_phase(&plan, &fit_controllers, &mut ctx, Phase::FitCv)
        .unwrap();

    let requirement = BundlePredictionRequirement {
        producer_node: NodeId::new("model:base").unwrap(),
        source_port: "pred".to_string(),
        consumer_node: NodeId::new("model:meta").unwrap(),
        target_port: "pred".to_string(),
        partition: PredictionPartition::Validation,
        prediction_level: PredictionLevel::Sample,
        fold_ids: vec![
            FoldId::new("fold:0").unwrap(),
            FoldId::new("fold:1").unwrap(),
        ],
        unit_ids: Vec::new(),
        sample_ids: vec![SampleId::new("s1").unwrap(), SampleId::new("s2").unwrap()],
        prediction_width: 1,
        target_names: vec!["y".to_string()],
    };
    let mut cache =
        build_prediction_cache_record(&requirement, ctx.prediction_store.blocks()).unwrap();
    let mut payload =
        build_prediction_cache_payload(&requirement, ctx.prediction_store.blocks()).unwrap();
    let cache_namespace_fingerprints = vec!["c".repeat(64), "d".repeat(64)];
    cache.cache_namespace_fingerprints = cache_namespace_fingerprints.clone();
    payload.cache_namespace_fingerprints = cache_namespace_fingerprints.clone();
    let bundle = build_execution_bundle_with_prediction_contracts(
        BundleId::new("bundle:oof.edge.columnar.cache.store").unwrap(),
        &plan,
        Some(plan.variants[0].variant_id.clone()),
        BTreeMap::new(),
        Vec::new(),
        vec![requirement.clone()],
        vec![cache.clone()],
    )
    .unwrap();
    let payload_set = BundlePredictionCachePayloadSet {
        bundle_id: bundle.bundle_id.clone(),
        schema_version: PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION,
        caches: vec![payload],
    };
    let store = ColumnarPredictionCacheStore::from_payloads(&bundle, payload_set).unwrap();
    assert_eq!(store.entry_count(), 1);
    let manifest = store.manifests();
    assert_eq!(manifest.len(), 1);
    assert_eq!(manifest[0].requirement_key, requirement.key());
    assert_eq!(
        manifest[0].cache_namespace_fingerprints,
        cache_namespace_fingerprints
    );
    assert_eq!(manifest[0].prediction_level, PredictionLevel::Sample);
    assert_eq!(manifest[0].value_count, 2);
    assert_eq!(manifest[0].estimated_value_bytes, 16);
    assert_eq!(store.load_blocks(&requirement.key()).unwrap().len(), 2);

    let request = PredictionCacheMaterializationRequest {
        run_id: RunId::new("run:oof.edge.columnar.cache.store.replay").unwrap(),
        bundle_id: bundle.bundle_id.clone(),
        phase: Phase::Refit,
        variant_id: bundle.selected_variant_id.clone(),
        requirement: requirement.clone(),
        cache,
        producer_controller_id: ControllerId::new("controller:model").unwrap(),
    };
    let handle = store.materialize(&request).unwrap();
    assert_eq!(handle.kind, HandleKind::Prediction);
    assert_eq!(
        handle.owner_controller,
        ControllerId::new("controller:model").unwrap()
    );
    let records = store.materialization_records();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].requirement_key, requirement.key());
    assert_eq!(
        records[0].cache_namespace_fingerprints,
        cache_namespace_fingerprints
    );
    assert_eq!(records[0].handle, handle);
    records[0].validate_against_request(&request).unwrap();
}

#[test]
fn file_prediction_cache_store_round_trips_oof_payloads_and_detects_tampering() {
    let plan = build_execution_plan(
        "plan:oof.edge.file.cache.store",
        oof_edge_graph(),
        oof_edge_campaign(),
        &oof_edge_manifests(BTreeSet::from([Phase::FitCv, Phase::Refit])),
    )
    .unwrap();
    let fit_controllers = oof_edge_runtime_controllers(
        Some(PredictionPartition::Validation),
        OofSampleMode::Aligned,
    );
    let mut ctx = RunContext::new(
        RunId::new("run:oof.edge.file.cache.store").unwrap(),
        Some(11),
    );
    SequentialScheduler
        .execute_campaign_phase(&plan, &fit_controllers, &mut ctx, Phase::FitCv)
        .unwrap();

    let requirement = BundlePredictionRequirement {
        producer_node: NodeId::new("model:base").unwrap(),
        source_port: "pred".to_string(),
        consumer_node: NodeId::new("model:meta").unwrap(),
        target_port: "pred".to_string(),
        partition: PredictionPartition::Validation,
        prediction_level: PredictionLevel::Sample,
        fold_ids: vec![
            FoldId::new("fold:0").unwrap(),
            FoldId::new("fold:1").unwrap(),
        ],
        unit_ids: Vec::new(),
        sample_ids: vec![SampleId::new("s1").unwrap(), SampleId::new("s2").unwrap()],
        prediction_width: 1,
        target_names: vec!["y".to_string()],
    };
    let mut cache =
        build_prediction_cache_record(&requirement, ctx.prediction_store.blocks()).unwrap();
    let mut payload =
        build_prediction_cache_payload(&requirement, ctx.prediction_store.blocks()).unwrap();
    let cache_namespace_fingerprints = vec!["e".repeat(64), "f".repeat(64)];
    cache.cache_namespace_fingerprints = cache_namespace_fingerprints.clone();
    payload.cache_namespace_fingerprints = cache_namespace_fingerprints.clone();
    let bundle = build_execution_bundle_with_prediction_contracts(
        BundleId::new("bundle:oof.edge.file.cache.store").unwrap(),
        &plan,
        Some(plan.variants[0].variant_id.clone()),
        BTreeMap::new(),
        Vec::new(),
        vec![requirement.clone()],
        vec![cache.clone()],
    )
    .unwrap();
    let payload_set = BundlePredictionCachePayloadSet {
        bundle_id: bundle.bundle_id.clone(),
        schema_version: PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION,
        caches: vec![payload],
    };
    let root = temp_prediction_cache_dir("dag_ml_file_prediction_cache_store");

    let manifest =
        FilePredictionCacheStore::write_payload_set(&root, &bundle, &payload_set).unwrap();
    assert_eq!(manifest.caches.len(), 1);
    assert_eq!(manifest.caches[0].prediction_level, PredictionLevel::Sample);
    assert_eq!(
        manifest.caches[0].cache_namespace_fingerprints,
        cache_namespace_fingerprints
    );
    assert!(root.join(FILE_PREDICTION_CACHE_MANIFEST_FILE).exists());
    assert!(root.join(&manifest.caches[0].file_name).exists());

    let alternate_cache_namespace_fingerprints = vec!["1".repeat(64), "2".repeat(64)];
    let mut alternate_cache = cache.clone();
    alternate_cache.cache_namespace_fingerprints = alternate_cache_namespace_fingerprints.clone();
    let mut alternate_payload =
        build_prediction_cache_payload(&requirement, ctx.prediction_store.blocks()).unwrap();
    alternate_payload.cache_namespace_fingerprints = alternate_cache_namespace_fingerprints;
    let alternate_bundle = build_execution_bundle_with_prediction_contracts(
        bundle.bundle_id.clone(),
        &plan,
        bundle.selected_variant_id.clone(),
        BTreeMap::new(),
        Vec::new(),
        vec![requirement.clone()],
        vec![alternate_cache],
    )
    .unwrap();
    let alternate_payload_set = BundlePredictionCachePayloadSet {
        bundle_id: alternate_bundle.bundle_id.clone(),
        schema_version: PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION,
        caches: vec![alternate_payload],
    };
    let alternate_root =
        temp_prediction_cache_dir("dag_ml_file_prediction_cache_store_alternate_namespace");
    let alternate_manifest = FilePredictionCacheStore::write_payload_set(
        &alternate_root,
        &alternate_bundle,
        &alternate_payload_set,
    )
    .unwrap();
    assert_ne!(
        alternate_manifest.caches[0].file_name, manifest.caches[0].file_name,
        "D10 namespace fingerprints must participate in file payload identity"
    );

    let store = FilePredictionCacheStore::open(root.clone(), &bundle).unwrap();
    assert_eq!(store.manifest().caches, manifest.caches);
    assert_eq!(store.load_blocks(&requirement.key()).unwrap().len(), 2);
    let request = PredictionCacheMaterializationRequest {
        run_id: RunId::new("run:oof.edge.file.cache.store.replay").unwrap(),
        bundle_id: bundle.bundle_id.clone(),
        phase: Phase::Refit,
        variant_id: bundle.selected_variant_id.clone(),
        requirement: requirement.clone(),
        cache: cache.clone(),
        producer_controller_id: ControllerId::new("controller:model").unwrap(),
    };
    let handle = store.materialize(&request).unwrap();
    assert_eq!(handle.kind, HandleKind::Prediction);
    let records = store.materialization_records();
    assert_eq!(records.len(), 1);
    assert_eq!(
        records[0].cache_namespace_fingerprints,
        cache_namespace_fingerprints
    );
    records[0].validate_against_request(&request).unwrap();

    let payload_path = root.join(&manifest.caches[0].file_name);
    let mut tampered: serde_json::Value =
        serde_json::from_slice(&fs::read(&payload_path).unwrap()).unwrap();
    tampered["blocks"][0]["values"][0][0] = json!(123456.0);
    fs::write(&payload_path, serde_json::to_vec_pretty(&tampered).unwrap()).unwrap();
    let err = store.load_blocks(&requirement.key()).unwrap_err();
    assert!(
        err.to_string().contains("content fingerprint"),
        "unexpected tamper error: {err}"
    );

    let _ = fs::remove_dir_all(root);
    let _ = fs::remove_dir_all(alternate_root);
}

fn portable_artifact_bundle(plan: &ExecutionPlan) -> crate::bundle::ExecutionBundle {
    let model_plan = plan
        .node_plans
        .get(&NodeId::new("model:base").unwrap())
        .unwrap();
    let content_fingerprint = "a".repeat(64);
    build_execution_bundle(
        crate::ids::BundleId::new("bundle:artifact.manifest").unwrap(),
        plan,
        Some(plan.variants[0].variant_id.clone()),
        BTreeMap::new(),
        vec![RefitArtifactRecord {
            node_id: model_plan.node_id.clone(),
            controller_id: model_plan.controller_id.clone(),
            artifact: ArtifactRef {
                id: ArtifactId::new("artifact:model:base:refit").unwrap(),
                kind: "mock_model".to_string(),
                controller_id: model_plan.controller_id.clone(),
                backend: Some(ArtifactBackend::Joblib),
                uri: Some(format!("artifacts/{content_fingerprint}.joblib")),
                content_fingerprint: Some(content_fingerprint),
                size_bytes: Some(128),
                plugin: Some("dagml.mock".to_string()),
                plugin_version: Some("1.0.0".to_string()),
                abi_major: None,
                abi_min_minor: None,
                native_predictor_descriptor: None,
            },
            params_fingerprint: model_plan.params_fingerprint.clone(),
            training_loss_fingerprint: model_plan.training_loss_fingerprint(Phase::Refit).unwrap(),
            data_requirement_keys: vec!["model:base.x".to_string()],
            prediction_requirement_keys: Vec::new(),
        }],
    )
    .unwrap()
}

fn portable_artifact_bundle_with_payload(
    plan: &ExecutionPlan,
    payload: &[u8],
) -> crate::bundle::ExecutionBundle {
    let mut bundle = portable_artifact_bundle(plan);
    let content_fingerprint = sha256_bytes_hex(payload);
    let artifact = &mut bundle.refit_artifacts[0].artifact;
    artifact.uri = Some(format!("artifacts/{content_fingerprint}.joblib"));
    artifact.content_fingerprint = Some(content_fingerprint);
    artifact.size_bytes = Some(payload.len() as u64);
    bundle.validate().unwrap();
    bundle
}

fn write_artifact_payload(root: &Path, bundle: &ExecutionBundle, payload: &[u8]) -> PathBuf {
    let uri = bundle.refit_artifacts[0].artifact.uri.as_deref().unwrap();
    let path = root.join(uri);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, payload).unwrap();
    path
}

#[test]
fn artifact_ref_validate_portable_rejects_unsafe_uris_and_legacy() {
    let content_fingerprint = "c".repeat(64);
    let base = ArtifactRef {
        id: ArtifactId::new("artifact:model:portable").unwrap(),
        kind: "model".to_string(),
        controller_id: ControllerId::new("controller:sklearn").unwrap(),
        backend: Some(ArtifactBackend::Joblib),
        uri: Some(format!("artifacts/{content_fingerprint}.joblib")),
        content_fingerprint: Some(content_fingerprint),
        size_bytes: Some(4096),
        plugin: Some("dagml.sklearn".to_string()),
        plugin_version: Some("1.0.0".to_string()),
        abi_major: None,
        abi_min_minor: None,
        native_predictor_descriptor: None,
    };
    base.validate_portable().unwrap();

    let mut incomplete_abi = base.clone();
    incomplete_abi.abi_major = Some(2);
    assert!(incomplete_abi
        .validate()
        .unwrap_err()
        .to_string()
        .contains("together with abi_min_minor"));

    let mut zero_abi_major = base.clone();
    zero_abi_major.abi_major = Some(0);
    zero_abi_major.abi_min_minor = Some(0);
    assert!(zero_abi_major
        .validate()
        .unwrap_err()
        .to_string()
        .contains("non-zero abi_major"));

    // Legacy artifact: still passes `validate` but is refused as non-portable.
    let legacy = ArtifactRef {
        backend: None,
        uri: None,
        content_fingerprint: None,
        ..base.clone()
    };
    legacy.validate().unwrap();
    assert!(legacy
        .validate_portable()
        .unwrap_err()
        .to_string()
        .contains("not portable"));

    let mut absolute = base.clone();
    absolute.uri = Some("/etc/passwd".to_string());
    assert!(absolute
        .validate_portable()
        .unwrap_err()
        .to_string()
        .contains("must be a relative path"));

    let mut traversal = base.clone();
    traversal.uri = Some("artifacts/../../secret.joblib".to_string());
    assert!(traversal
        .validate_portable()
        .unwrap_err()
        .to_string()
        .contains("`..`"));

    let mut drive = base.clone();
    drive.uri = Some("C:\\models\\model.joblib".to_string());
    assert!(drive
        .validate_portable()
        .unwrap_err()
        .to_string()
        .contains("must be a relative path"));

    // URI schemes and any other colon in the leading path segment are
    // rejected: a strictly relative artifact path never carries a scheme.
    for scheme_uri in [
        "http://example.com/model.joblib",
        "s3://bucket/model.joblib",
        "file:///models/model.joblib",
        "weird:thing/model.joblib",
    ] {
        let mut scheme = base.clone();
        scheme.uri = Some(scheme_uri.to_string());
        let err = scheme.validate_portable().unwrap_err().to_string();
        assert!(
            err.contains("first path segment"),
            "unexpected scheme error for `{scheme_uri}`: {err}"
        );
    }

    // A colon outside the first segment is allowed (not a scheme/drive).
    let mut later_colon = base;
    later_colon.uri = Some("artifacts/model:v1.joblib".to_string());
    later_colon.validate_portable().unwrap();
}

#[test]
fn file_artifact_manifest_round_trips_portable_artifacts() {
    let plan = fixture_plan("plan:artifact.manifest.round.trip");
    let bundle = portable_artifact_bundle(&plan);
    let root = temp_prediction_cache_dir("dag_ml_file_artifact_manifest");

    let manifest = FileArtifactManifestStore::write(&root, &bundle).unwrap();
    assert_eq!(
        manifest.schema_version,
        FILE_ARTIFACT_MANIFEST_SCHEMA_VERSION
    );
    assert_eq!(manifest.artifacts.len(), 1);
    assert_eq!(
        manifest.artifacts[0].artifact.id,
        ArtifactId::new("artifact:model:base:refit").unwrap()
    );
    assert_eq!(
        manifest.artifacts[0].artifact.backend,
        Some(ArtifactBackend::Joblib)
    );
    assert_eq!(
        manifest.artifacts[0].node_id,
        bundle.refit_artifacts[0].node_id
    );
    assert!(root.join(FILE_ARTIFACT_MANIFEST_FILE).exists());

    let store = FileArtifactManifestStore::open(root.clone(), &bundle).unwrap();
    assert_eq!(store.root(), root.as_path());
    assert_eq!(store.manifest().bundle_id, bundle.bundle_id);
    assert_eq!(store.manifest().artifacts, manifest.artifacts);

    let _ = fs::remove_dir_all(root);
}

#[test]
fn file_artifact_manifest_refuses_legacy_non_portable_artifacts() {
    let plan = fixture_plan("plan:artifact.manifest.legacy");
    // `replay_bundle` carries a legacy artifact (no backend/uri/content fingerprint).
    let bundle = replay_bundle(&plan);
    let root = temp_prediction_cache_dir("dag_ml_file_artifact_manifest_legacy");

    let err = FileArtifactManifestStore::write(&root, &bundle).unwrap_err();
    assert!(
        err.to_string().contains("not portable"),
        "unexpected legacy error: {err}"
    );
    assert!(!root.join(FILE_ARTIFACT_MANIFEST_FILE).exists());

    let _ = fs::remove_dir_all(root);
}

#[test]
fn file_artifact_manifest_open_refuses_tampered_entries() {
    let plan = fixture_plan("plan:artifact.manifest.tampered");
    let bundle = portable_artifact_bundle(&plan);
    let root = temp_prediction_cache_dir("dag_ml_file_artifact_manifest_tampered");

    FileArtifactManifestStore::write(&root, &bundle).unwrap();
    let manifest_path = root.join(FILE_ARTIFACT_MANIFEST_FILE);
    let mut tampered: serde_json::Value =
        serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
    let tampered_fingerprint = "b".repeat(64);
    tampered["artifacts"][0]["params_fingerprint"] = json!(tampered_fingerprint);
    fs::write(
        &manifest_path,
        serde_json::to_vec_pretty(&tampered).unwrap(),
    )
    .unwrap();

    let err = FileArtifactManifestStore::open(root.clone(), &bundle).unwrap_err();
    assert!(
        err.to_string()
            .contains("does not match bundle refit artifact"),
        "unexpected tamper error: {err}"
    );

    let _ = fs::remove_dir_all(root);
}

#[test]
fn file_artifact_payload_store_validates_payloads_and_materializes_handles() {
    let plan = fixture_plan("plan:artifact.payload.round.trip");
    let payload = b"portable dag-ml artifact payload\n";
    let bundle = portable_artifact_bundle_with_payload(&plan, payload);
    let source_root = temp_prediction_cache_dir("dag_ml_file_artifact_payload_source");
    let store_root = temp_prediction_cache_dir("dag_ml_file_artifact_payload_store");
    let source_path = write_artifact_payload(&source_root, &bundle, payload);

    let store =
        FileArtifactPayloadStore::write_from_source(&store_root, &source_root, &bundle).unwrap();
    assert_eq!(store.root(), store_root.as_path());
    assert_eq!(store.payload_count(), 1);
    assert!(store_root
        .join(bundle.refit_artifacts[0].artifact.uri.as_deref().unwrap())
        .exists());
    assert!(source_path.exists());
    assert_eq!(store.manifest().bundle_id, bundle.bundle_id);

    let artifact = &bundle.refit_artifacts[0];
    let handle = store
        .materialize(&ArtifactMaterializationRequest {
            run_id: RunId::new("run:artifact.payload.materialize").unwrap(),
            bundle_id: bundle.bundle_id.clone(),
            node_id: artifact.node_id.clone(),
            phase: Phase::Predict,
            variant_id: bundle.selected_variant_id.clone(),
            controller_id: artifact.controller_id.clone(),
            artifact: artifact.artifact.clone(),
            params_fingerprint: artifact.params_fingerprint.clone(),
            training_loss_fingerprint: artifact.training_loss_fingerprint.clone(),
        })
        .unwrap();
    assert_eq!(handle.kind, HandleKind::Artifact);
    assert_eq!(handle.owner_controller, artifact.controller_id);
    let records = store.materialization_records();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].artifact_id, artifact.artifact.id);
    assert_eq!(records[0].size_bytes, payload.len() as u64);
    assert_eq!(
        records[0].content_fingerprint,
        artifact.artifact.content_fingerprint.clone().unwrap()
    );

    let reopened = FileArtifactPayloadStore::open(store_root.clone(), &bundle).unwrap();
    reopened.validate_payloads().unwrap();

    let _ = fs::remove_dir_all(source_root);
    let _ = fs::remove_dir_all(store_root);
}

#[test]
fn file_artifact_payload_store_refuses_tampered_payloads() {
    let plan = fixture_plan("plan:artifact.payload.tampered");
    let payload = b"portable dag-ml artifact payload\n";
    let bundle = portable_artifact_bundle_with_payload(&plan, payload);
    let source_root = temp_prediction_cache_dir("dag_ml_file_artifact_payload_source_tamper");
    let store_root = temp_prediction_cache_dir("dag_ml_file_artifact_payload_store_tamper");
    write_artifact_payload(&source_root, &bundle, payload);
    FileArtifactPayloadStore::write_from_source(&store_root, &source_root, &bundle).unwrap();

    let payload_path = store_root.join(bundle.refit_artifacts[0].artifact.uri.as_deref().unwrap());
    fs::write(&payload_path, vec![b'x'; payload.len()]).unwrap();
    let err = FileArtifactPayloadStore::open(store_root.clone(), &bundle).unwrap_err();
    assert!(
        err.to_string().contains("content fingerprint mismatch"),
        "unexpected tamper error: {err}"
    );

    let _ = fs::remove_dir_all(source_root);
    let _ = fs::remove_dir_all(store_root);
}

#[test]
fn requires_oof_prediction_edge_refit_rejects_incomplete_oof_coverage() {
    let plan = build_execution_plan(
        "plan:oof.edge.refit.incomplete",
        oof_edge_graph(),
        oof_edge_campaign(),
        &oof_edge_manifests(BTreeSet::from([Phase::FitCv, Phase::Refit])),
    )
    .unwrap();
    let mut ctx = RunContext::new(
        RunId::new("run:oof.edge.refit.incomplete").unwrap(),
        Some(11),
    );
    ctx.prediction_store
        .append(PredictionBlock {
            prediction_id: Some("pred:model:base:fold0".to_string()),
            producer_node: NodeId::new("model:base").unwrap(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new("fold:0").unwrap()),
            sample_ids: vec![SampleId::new("s1").unwrap()],
            values: vec![vec![0.5]],
            target_names: vec!["y".to_string()],
        })
        .unwrap();
    let controllers = oof_edge_runtime_controllers(None, OofSampleMode::Aligned);

    let error = SequentialScheduler
        .execute_campaign_phase(&plan, &controllers, &mut ctx, Phase::Refit)
        .unwrap_err()
        .to_string();

    assert!(error.contains("do not cover the refit sample universe"));
    assert!(error.contains("cause=partial_oof_without_policy"));
}

#[test]
fn requires_oof_prediction_edge_refit_skips_incomplete_oof_when_explicit() {
    let plan = build_execution_plan(
        "plan:oof.edge.refit.incomplete.skip",
        oof_edge_graph_with_refit_policy("skip_refit_on_incomplete_oof"),
        oof_edge_campaign(),
        &oof_edge_manifests(BTreeSet::from([Phase::FitCv, Phase::Refit])),
    )
    .unwrap();
    let mut ctx = RunContext::new(
        RunId::new("run:oof.edge.refit.incomplete.skip").unwrap(),
        Some(11),
    );
    ctx.prediction_store
        .append(PredictionBlock {
            prediction_id: Some("pred:model:base:fold0".to_string()),
            producer_node: NodeId::new("model:base").unwrap(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new("fold:0").unwrap()),
            sample_ids: vec![SampleId::new("s1").unwrap()],
            values: vec![vec![0.5]],
            target_names: vec!["y".to_string()],
        })
        .unwrap();
    let controllers = oof_edge_runtime_controllers(None, OofSampleMode::Aligned);

    let results = SequentialScheduler
        .execute_campaign_phase(&plan, &controllers, &mut ctx, Phase::Refit)
        .unwrap();

    assert_eq!(
        results
            .iter()
            .filter(|result| result.node_id.as_str() == "model:meta")
            .count(),
        0
    );
    assert_eq!(
        results
            .iter()
            .filter(|result| result.node_id.as_str() == "model:base")
            .count(),
        1
    );
}

#[test]
fn requires_oof_prediction_edge_refit_cv_only_skips_without_oof() {
    let plan = build_execution_plan(
        "plan:oof.edge.refit.cv_only",
        oof_edge_graph_with_refit_policy("cv_only"),
        oof_edge_campaign(),
        &oof_edge_manifests(BTreeSet::from([Phase::FitCv, Phase::Refit])),
    )
    .unwrap();
    let controllers = oof_edge_runtime_controllers(None, OofSampleMode::Aligned);
    let mut ctx = RunContext::new(RunId::new("run:oof.edge.refit.cv_only").unwrap(), Some(11));

    let results = SequentialScheduler
        .execute_campaign_phase(&plan, &controllers, &mut ctx, Phase::Refit)
        .unwrap();

    assert_eq!(
        results
            .iter()
            .filter(|result| result.node_id.as_str() == "model:meta")
            .count(),
        0
    );
    assert_eq!(
        results
            .iter()
            .filter(|result| result.node_id.as_str() == "model:base")
            .count(),
        1
    );
}

#[test]
fn requires_oof_prediction_edge_refit_rejects_missing_validation_predictions() {
    // REGRESSION (0681cc6 dropped the empty-OOF guard from `validate_refit_oof_edge`): a direct REFIT
    // with NO validation OOF at all — the FIT_CV phase was never run for the producer — must report the
    // missing-OOF edge ("requires OOF validation predictions"), the same contract `validate_fit_cv_oof_edge`
    // and `validate_refit_aggregated_oof_edge` enforce, instead of mislabeling zero coverage as
    // `partial_oof_without_policy`. Only the default full-coverage policy turns empty into this error;
    // `cv_only` / `skip_refit_on_incomplete_oof` still skip REFIT with zero OOF (see the two tests above).
    let plan = build_execution_plan(
        "plan:oof.edge.refit.missing",
        oof_edge_graph(),
        oof_edge_campaign(),
        &oof_edge_manifests(BTreeSet::from([Phase::FitCv, Phase::Refit])),
    )
    .unwrap();
    let controllers = oof_edge_runtime_controllers(None, OofSampleMode::Aligned);
    let mut ctx = RunContext::new(RunId::new("run:oof.edge.refit.missing").unwrap(), Some(11));

    let error = SequentialScheduler
        .execute_campaign_phase(&plan, &controllers, &mut ctx, Phase::Refit)
        .unwrap_err()
        .to_string();

    assert!(
        error.contains("requires OOF validation predictions"),
        "got: {error}"
    );
    assert!(error.contains("model:base"), "got: {error}");
    assert!(
        !error.contains("partial_oof_without_policy"),
        "empty OOF must not be reported as partial coverage, got: {error}"
    );
}

#[test]
fn refit_oof_cover_is_partition_mode_aware() {
    // REGRESSION (8dd4c6e over-rejected ShuffleSplit): the refit OOF-coverage edge validator must be
    // FoldPartitionMode-aware. Under Partition (KFold) a sample covered by two folds is a duplicated
    // fold and stays REJECTED; under Resampled (ShuffleSplit / repeated CV) a sample is legitimately
    // validated in several folds (its predictions are averaged), so the across-fold multiplicity PASSES.
    let edge = EdgeSpec {
        source: PortRef {
            node_id: NodeId::new("model:base").unwrap(),
            port_name: "pred".to_string(),
        },
        target: PortRef {
            node_id: NodeId::new("model:meta").unwrap(),
            port_name: "pred".to_string(),
        },
        contract: EdgeContract {
            requires_oof: true,
            requires_fold_alignment: true,
            ..EdgeContract::new(PortKind::Prediction, None)
        },
    };
    let val_block = |fold: &str, samples: &[&str]| PredictionBlock {
        prediction_id: None,
        producer_node: NodeId::new("model:base").unwrap(),
        producer_port: None,
        partition: PredictionPartition::Validation,
        fold_id: Some(FoldId::new(fold).unwrap()),
        sample_ids: samples.iter().map(|s| SampleId::new(*s).unwrap()).collect(),
        values: samples.iter().map(|_| vec![0.5]).collect(),
        target_names: vec!["y".to_string()],
    };

    // Resampled fold set: two ShuffleSplit folds both validate s1 (legitimate cross-fold overlap), and
    // together cover the universe {s1, s2, s3}.
    let resampled = FoldSet {
        id: "resampled".to_string(),
        sample_ids: ["s1", "s2", "s3"]
            .iter()
            .map(|s| SampleId::new(*s).unwrap())
            .collect(),
        folds: vec![
            FoldAssignment {
                fold_id: FoldId::new("fold:0").unwrap(),
                train_sample_ids: vec![SampleId::new("s3").unwrap()],
                validation_sample_ids: ["s1", "s2"]
                    .iter()
                    .map(|s| SampleId::new(*s).unwrap())
                    .collect(),
                metadata: BTreeMap::new(),
            },
            FoldAssignment {
                fold_id: FoldId::new("fold:1").unwrap(),
                train_sample_ids: vec![SampleId::new("s2").unwrap()],
                validation_sample_ids: ["s1", "s3"]
                    .iter()
                    .map(|s| SampleId::new(*s).unwrap())
                    .collect(),
                metadata: BTreeMap::new(),
            },
        ],
        sample_groups: BTreeMap::new(),
        partition_mode: FoldPartitionMode::Resampled,
    };
    resampled
        .validate()
        .expect("resampled fold set is well-formed");
    let mut resampled_blocks = [
        val_block("fold:0", &["s1", "s2"]),
        val_block("fold:1", &["s1", "s3"]),
    ];
    resampled_blocks[0].values[0] = vec![0.25];
    resampled_blocks[1].values[0] = vec![0.75];
    let resampled_refs = resampled_blocks.iter().collect::<Vec<_>>();
    validate_oof_blocks_cover_fold_set(&edge, &resampled, &resampled_refs)
        .expect("Resampled multiply-validated sample must pass refit OOF coverage");
    let refit_scope = PhaseScope {
        phase: Phase::Refit,
        variant_id: None,
        variant: None,
        fold_id: None,
        seed_root: Some(11),
    };
    let resampled_spec = prediction_input_spec(&edge, &refit_scope, &resampled_refs, true)
        .expect("resampled refit spec should average repeated OOF rows");
    assert_eq!(
        resampled_spec.sample_ids,
        vec![
            SampleId::new("s1").unwrap(),
            SampleId::new("s2").unwrap(),
            SampleId::new("s3").unwrap()
        ]
    );
    assert_eq!(resampled_spec.values[0], vec![0.5]);
    assert!(prediction_input_spec(&edge, &refit_scope, &resampled_refs, false).is_err());

    // Partition fold set with the SAME cross-fold duplicate (s1 in both folds): still rejected.
    let partition = FoldSet {
        partition_mode: FoldPartitionMode::Partition,
        ..resampled.clone()
    };
    let err = validate_oof_blocks_cover_fold_set(&edge, &partition, &resampled_refs).unwrap_err();
    assert!(
        err.to_string().contains("duplicate OOF prediction")
            || err.to_string().contains("do not match validation samples"),
        "Partition cross-fold duplicate must still be rejected: {err}"
    );
}

#[test]
fn data_bindings_require_runtime_provider_and_materialize_handles() {
    let model_id = NodeId::new("model:pls").unwrap();
    let plan = build_execution_plan(
        "plan:data",
        simple_graph(),
        CampaignSpec {
            inner_cv: None,
            id: "campaign:data".to_string(),
            root_seed: Some(11),
            leakage_policy: Default::default(),
            aggregation_policy: Default::default(),
            split_invocation: None,
            generation: Default::default(),
            shape_plans: BTreeMap::new(),
            data_bindings: BTreeMap::from([(model_id.clone(), vec![data_binding(&model_id)])]),
            branch_view_plans: Vec::new(),
            metadata: BTreeMap::new(),
        },
        &manifests(),
    )
    .unwrap();
    let controllers = runtime_controllers();
    let mut ctx = RunContext::new(RunId::new("run:data").unwrap(), Some(11));

    assert!(SequentialScheduler
        .execute_phase(&plan, &controllers, &mut ctx, Phase::FitCv)
        .is_err());

    let envelope: ExternalDataPlanEnvelope = serde_json::from_str(include_str!(
        "../../tests/fixtures/package/data/coordinator_data_plan_envelope_sample12.json"
    ))
    .unwrap();
    let provider = InMemoryDataProvider::with_envelope(
        ControllerId::new("controller:data.provider").unwrap(),
        envelope,
    )
    .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:data.provider").unwrap(), Some(11));
    let results = SequentialScheduler
        .execute_phase_with_data_provider(&plan, &controllers, &provider, &mut ctx, Phase::FitCv)
        .unwrap();

    assert_eq!(results.len(), 2);
    assert_eq!(provider.handle_records().len(), 1);
    assert_eq!(provider.view_records().len(), 1);
    assert_eq!(provider.handle_records()[0].input_name, "x");
    assert_eq!(provider.handle_records()[0].relation_record_count, Some(4));
    assert_eq!(provider.view_records()[0].handle.kind, HandleKind::DataView);
    assert_eq!(
        provider.view_records()[0].parent_handle,
        provider.handle_records()[0].handle
    );
}

#[test]
fn campaign_data_bindings_create_fold_train_views() {
    let model_id = NodeId::new("model:pls").unwrap();
    let plan = build_execution_plan(
        "plan:data.folds",
        simple_graph(),
        CampaignSpec {
            inner_cv: None,
            id: "campaign:data.folds".to_string(),
            root_seed: Some(11),
            leakage_policy: Default::default(),
            aggregation_policy: Default::default(),
            split_invocation: Some(SplitInvocation {
                id: "split:outer".to_string(),
                controller_id: None,
                leakage_policy: Default::default(),
                params: BTreeMap::new(),
                fold_set: Some(two_fold_set()),
            }),
            generation: Default::default(),
            shape_plans: BTreeMap::new(),
            data_bindings: BTreeMap::from([(
                model_id,
                vec![data_binding(&NodeId::new("model:pls").unwrap())],
            )]),
            branch_view_plans: Vec::new(),
            metadata: BTreeMap::new(),
        },
        &manifests(),
    )
    .unwrap();
    let envelope: ExternalDataPlanEnvelope = serde_json::from_str(include_str!(
        "../../tests/fixtures/package/data/coordinator_data_plan_envelope_sample12.json"
    ))
    .unwrap();
    let provider = InMemoryDataProvider::with_envelope(
        ControllerId::new("controller:data.provider").unwrap(),
        envelope,
    )
    .unwrap();
    let controllers = runtime_controllers();
    let mut ctx = RunContext::new(RunId::new("run:data.folds").unwrap(), Some(11));

    let results = SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::FitCv,
        )
        .unwrap();

    assert_eq!(results.len(), 4);
    assert_eq!(provider.handle_records().len(), 2);
    let views = provider.view_records();
    assert_eq!(views.len(), 4);
    assert!(views
        .iter()
        .all(|view| view.handle.kind == HandleKind::DataView));
    let train_views = views
        .iter()
        .filter(|view| view.view.partition == DataRequestPartition::FoldTrain)
        .collect::<Vec<_>>();
    let validation_views = views
        .iter()
        .filter(|view| view.view.partition == DataRequestPartition::FoldValidation)
        .collect::<Vec<_>>();
    assert_eq!(train_views.len(), 2);
    assert_eq!(validation_views.len(), 2);
    assert_eq!(
        train_views[0].view.sample_ids,
        Some(vec![SampleId::new("s2").unwrap()])
    );
    assert_eq!(
        validation_views[0].view.sample_ids,
        Some(vec![SampleId::new("s1").unwrap()])
    );
    assert_eq!(
        train_views[1].view.sample_ids,
        Some(vec![SampleId::new("s1").unwrap()])
    );
    assert_eq!(
        validation_views[1].view.sample_ids,
        Some(vec![SampleId::new("s2").unwrap()])
    );
}

#[test]
fn data_edges_propagate_fold_views_from_data_producing_nodes() {
    let augment_id = NodeId::new("augment:noise").unwrap();
    let model_id = NodeId::new("model:branch").unwrap();
    let before_feature_schema = "a".repeat(64);
    let after_feature_schema = "b".repeat(64);
    let shape_plan = DataModelShapePlan {
        node_id: augment_id.clone(),
        input_granularity: Granularity::Sample,
        target_granularity: Granularity::Sample,
        fit_rows: FitBoundary::FoldTrain,
        predict_rows: FitBoundary::FoldValidation,
        feature_namespace: Some("augmented.noise".to_string()),
        feature_schema_fingerprint: Some(before_feature_schema.clone()),
        target_space: "raw".to_string(),
        aggregation_policy: AggregationPolicy::default(),
        augmentation_policy: Default::default(),
        selection_policy: Default::default(),
    };
    let shape_plan_fingerprint = stable_json_fingerprint(&shape_plan).unwrap();
    let graph = GraphSpec {
        id: "g:data.edge.views".to_string(),
        interface: GraphInterface::default(),
        nodes: vec![
            node(
                augment_id.as_str(),
                NodeKind::Augmentation,
                vec![port("x", PortKind::Data)],
                vec![port("x_out", PortKind::Data)],
            ),
            node(
                model_id.as_str(),
                NodeKind::Model,
                vec![port("x", PortKind::Data)],
                vec![port("oof", PortKind::Prediction)],
            ),
        ],
        edges: vec![EdgeSpec {
            source: PortRef {
                node_id: augment_id.clone(),
                port_name: "x_out".to_string(),
            },
            target: PortRef {
                node_id: model_id.clone(),
                port_name: "x".to_string(),
            },
            contract: EdgeContract {
                requires_oof: false,
                requires_fold_alignment: false,
                ..EdgeContract::new(PortKind::Data, None)
            },
        }],
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    };
    let mut manifest_registry = ControllerRegistry::new();
    manifest_registry
        .register(controller_manifest(
            "controller:augmentation",
            NodeKind::Augmentation,
        ))
        .unwrap();
    manifest_registry
        .register(controller_manifest(
            "controller:model.probe",
            NodeKind::Model,
        ))
        .unwrap();
    let plan = build_execution_plan(
        "plan:data.edge.views",
        graph,
        CampaignSpec {
            inner_cv: None,
            id: "campaign:data.edge.views".to_string(),
            root_seed: Some(11),
            leakage_policy: Default::default(),
            aggregation_policy: Default::default(),
            split_invocation: Some(SplitInvocation {
                id: "split:outer".to_string(),
                controller_id: None,
                leakage_policy: Default::default(),
                params: BTreeMap::new(),
                fold_set: Some(two_fold_set()),
            }),
            generation: Default::default(),
            shape_plans: BTreeMap::from([(augment_id.clone(), shape_plan)]),
            data_bindings: BTreeMap::from([(augment_id.clone(), vec![data_binding(&augment_id)])]),
            branch_view_plans: Vec::new(),
            metadata: BTreeMap::new(),
        },
        &manifest_registry,
    )
    .unwrap();
    let envelope: ExternalDataPlanEnvelope = serde_json::from_str(include_str!(
        "../../tests/fixtures/package/data/coordinator_data_plan_envelope_sample12.json"
    ))
    .unwrap();
    let provider = InMemoryDataProvider::with_envelope(
        ControllerId::new("controller:data.provider").unwrap(),
        envelope,
    )
    .unwrap();
    let observed_views = Arc::new(Mutex::new(Vec::new()));
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(ShapeDataController {
            id: ControllerId::new("controller:augmentation").unwrap(),
            handle: 3,
            before_feature_schema: before_feature_schema.clone(),
            after_feature_schema: after_feature_schema.clone(),
        }))
        .unwrap();
    controllers
        .register(Box::new(DataViewProbeController {
            id: ControllerId::new("controller:model.probe").unwrap(),
            observed_views: observed_views.clone(),
            prediction_sample_ids: None,
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:data.edge.views").unwrap(), Some(11));

    let results = SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::FitCv,
        )
        .unwrap();

    assert_eq!(results.len(), 4);
    assert_eq!(provider.view_records().len(), 4);
    let observed_views = observed_views.lock().unwrap();
    assert_eq!(observed_views.len(), 2);
    for views in observed_views.iter() {
        let primary = views.get("data:x").expect("primary propagated data view");
        let validation = views
            .get("data:x:validation")
            .expect("validation propagated data view");
        for view in [primary, validation] {
            let provenance = view
                .output_provenance()
                .unwrap()
                .expect("output data provenance metadata");
            assert_eq!(
                provenance.producer_node,
                NodeId::new("augment:noise").unwrap()
            );
            assert_eq!(provenance.producer_port, "x_out");
            assert_eq!(
                provenance.shape_plan_fingerprint,
                Some(shape_plan_fingerprint.clone())
            );
            assert_eq!(
                provenance.feature_schema_fingerprint,
                Some(after_feature_schema.clone())
            );
            assert_eq!(provenance.shape_deltas.len(), 1);
        }
    }
    let samples_by_fold = ctx
        .prediction_store
        .blocks()
        .iter()
        .filter(|block| block.producer_node == model_id)
        .map(|block| {
            (
                block.fold_id.as_ref().unwrap().to_string(),
                block.sample_ids.clone(),
            )
        })
        .collect::<BTreeMap<_, _>>();
    assert_eq!(
        samples_by_fold["fold:0"],
        vec![SampleId::new("s1").unwrap()]
    );
    assert_eq!(
        samples_by_fold["fold:1"],
        vec![SampleId::new("s2").unwrap()]
    );

    let mut bad_controllers = RuntimeControllerRegistry::new();
    bad_controllers
        .register(Box::new(ShapeDataController {
            id: ControllerId::new("controller:augmentation").unwrap(),
            handle: 5,
            before_feature_schema,
            after_feature_schema,
        }))
        .unwrap();
    bad_controllers
        .register(Box::new(DataViewProbeController {
            id: ControllerId::new("controller:model.probe").unwrap(),
            observed_views: Arc::new(Mutex::new(Vec::new())),
            prediction_sample_ids: Some(vec![SampleId::new("s-outside").unwrap()]),
        }))
        .unwrap();
    let mut bad_ctx = RunContext::new(
        RunId::new("run:data.edge.views.bad-prediction").unwrap(),
        Some(11),
    );
    let error = SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &bad_controllers,
            &provider,
            &mut bad_ctx,
            Phase::FitCv,
        )
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("outside its validation view"),
        "unexpected propagated-view validation error: {error}"
    );
}

#[test]
fn data_provider_view_validates_typed_output_provenance() {
    let producer = NodeId::new("augment:noise").unwrap();
    let before_feature_schema = "a".repeat(64);
    let after_feature_schema = "b".repeat(64);
    let provenance = DataOutputProvenance {
        schema_version: DATA_OUTPUT_PROVENANCE_SCHEMA_VERSION,
        producer_node: producer.clone(),
        producer_port: "x_out".to_string(),
        producer_phase: Phase::FitCv,
        variant_id: Some(VariantId::new("variant:base").unwrap()),
        fold_id: Some(FoldId::new("fold:0").unwrap()),
        shape_plan_fingerprint: Some("c".repeat(64)),
        aggregation_policy_fingerprint: Some("d".repeat(64)),
        feature_namespace: Some("augmented.noise".to_string()),
        feature_schema_fingerprint: Some(after_feature_schema.clone()),
        representation_plan: None,
        representation_replay_manifest: None,
        representation_compatibility: None,
        relation_delta_fingerprint: None,
        shape_deltas: vec![ShapeDelta {
            node_id: producer.clone(),
            kind: ShapeDeltaKind::Feature,
            before_fingerprint: before_feature_schema,
            after_fingerprint: after_feature_schema,
            metadata: BTreeMap::new(),
        }],
    };
    let mut view = DataProviderViewSpec {
        sample_ids: Some(vec![SampleId::new("s1").unwrap()]),
        partition: DataRequestPartition::FoldTrain,
        fold_id: Some(FoldId::new("fold:0").unwrap()),
        source_ids: None,
        columns: None,
        include_augmented: true,
        include_excluded: false,
        branch_view: None,
        extra: BTreeMap::from([(
            DATA_OUTPUT_PROVENANCE_KEY.to_string(),
            serde_json::to_value(&provenance).unwrap(),
        )]),
    };

    assert_eq!(view.output_provenance().unwrap(), Some(provenance.clone()));
    view.validate().unwrap();

    let mut empty_port = provenance.clone();
    empty_port.producer_port.clear();
    view.extra.insert(
        DATA_OUTPUT_PROVENANCE_KEY.to_string(),
        serde_json::to_value(empty_port).unwrap(),
    );
    let error = view.validate().unwrap_err().to_string();
    assert!(
        error.contains("empty producer_port"),
        "unexpected empty-port provenance error: {error}"
    );

    let mut wrong_delta_node = provenance.clone();
    wrong_delta_node.shape_deltas[0].node_id = NodeId::new("augment:other").unwrap();
    view.extra.insert(
        DATA_OUTPUT_PROVENANCE_KEY.to_string(),
        serde_json::to_value(wrong_delta_node).unwrap(),
    );
    let error = view.validate().unwrap_err().to_string();
    assert!(
        error.contains("contains shape delta"),
        "unexpected wrong-delta-node provenance error: {error}"
    );

    let mut wrong_feature_fingerprint = provenance.clone();
    wrong_feature_fingerprint.feature_schema_fingerprint = Some("e".repeat(64));
    view.extra.insert(
        DATA_OUTPUT_PROVENANCE_KEY.to_string(),
        serde_json::to_value(wrong_feature_fingerprint).unwrap(),
    );
    let error = view.validate().unwrap_err().to_string();
    assert!(
        error.contains("last feature delta"),
        "unexpected feature-fingerprint provenance error: {error}"
    );

    let mut unsupported_schema = provenance;
    unsupported_schema.schema_version = DATA_OUTPUT_PROVENANCE_SCHEMA_VERSION + 1;
    view.extra.insert(
        DATA_OUTPUT_PROVENANCE_KEY.to_string(),
        serde_json::to_value(unsupported_schema).unwrap(),
    );
    let error = view.validate().unwrap_err().to_string();
    assert!(
        error.contains("unsupported schema_version"),
        "unexpected provenance schema-version error: {error}"
    );
}

#[test]
fn data_provider_view_spec_propagates_branch_view_validation() {
    use crate::data::{BranchViewMode, BranchViewPlan, DataViewSelector};

    let view = DataProviderViewSpec {
        sample_ids: None,
        partition: DataRequestPartition::FullTrain,
        fold_id: None,
        source_ids: None,
        columns: None,
        include_augmented: true,
        include_excluded: false,
        branch_view: Some(BranchViewPlan {
            view_id: "branch_view:nir_only".to_string(),
            branch_id: "branch:nir".to_string(),
            mode: BranchViewMode::BySource,
            selector: DataViewSelector {
                source_ids: vec!["nir".to_string()],
                ..Default::default()
            },
            allow_overlap: false,
            metadata: BTreeMap::new(),
        }),
        extra: BTreeMap::new(),
    };
    view.validate().unwrap();

    let invalid = DataProviderViewSpec {
        branch_view: Some(BranchViewPlan {
            view_id: "branch_view:bad".to_string(),
            branch_id: "branch:bad".to_string(),
            mode: BranchViewMode::BySource,
            selector: DataViewSelector::default(),
            allow_overlap: false,
            metadata: BTreeMap::new(),
        }),
        ..view
    };
    let error = invalid.validate().unwrap_err().to_string();
    assert!(
        error.contains("selector must constrain source_ids, metadata, tags or filter"),
        "unexpected: {error}"
    );
}

#[test]
fn scheduler_extracts_branch_view_from_node_metadata() {
    use crate::data::{BranchViewMode, BranchViewPlan, DataViewSelector};
    use crate::graph::NodeSpec;

    let plan_with_branch = BranchViewPlan {
        view_id: "branch_view:nir_only".to_string(),
        branch_id: "branch:nir".to_string(),
        mode: BranchViewMode::BySource,
        selector: DataViewSelector {
            source_ids: vec!["nir".to_string()],
            ..Default::default()
        },
        allow_overlap: false,
        metadata: BTreeMap::new(),
    };

    let node_id = NodeId::new("model:branched").unwrap();
    let mut node_spec_metadata = BTreeMap::new();
    node_spec_metadata.insert(
        "dsl_branch_view_plan".to_string(),
        serde_json::to_value(&plan_with_branch).unwrap(),
    );
    let node_spec = NodeSpec {
        id: node_id.clone(),
        kind: crate::graph::NodeKind::Model,
        operator: None,
        params: BTreeMap::new(),
        ports: Default::default(),
        metadata: node_spec_metadata,
        seed_label: None,
    };

    let other_node = NodeSpec {
        id: NodeId::new("model:plain").unwrap(),
        kind: crate::graph::NodeKind::Model,
        operator: None,
        params: BTreeMap::new(),
        ports: Default::default(),
        metadata: BTreeMap::new(),
        seed_label: None,
    };

    let graph = crate::graph::GraphSpec {
        id: "g".to_string(),
        interface: Default::default(),
        nodes: vec![node_spec, other_node],
        edges: Vec::new(),
        metadata: BTreeMap::new(),
        search_space_fingerprint: None,
    };
    let plan = ExecutionPlan {
        id: "plan:test".to_string(),
        graph_plan: crate::plan::GraphPlan {
            graph,
            topological_order: vec![node_id.clone(), NodeId::new("model:plain").unwrap()],
            parallel_levels: Vec::new(),
        },
        campaign: crate::plan::CampaignSpec {
            inner_cv: None,
            id: "campaign:test".to_string(),
            root_seed: None,
            leakage_policy: Default::default(),
            aggregation_policy: Default::default(),
            split_invocation: None,
            generation: Default::default(),
            shape_plans: BTreeMap::new(),
            data_bindings: BTreeMap::new(),
            branch_view_plans: Vec::new(),
            metadata: BTreeMap::new(),
        },
        node_plans: BTreeMap::new(),
        controller_manifests: BTreeMap::new(),
        variants: Vec::new(),
        fold_set: None,
        graph_fingerprint: String::new(),
        campaign_fingerprint: String::new(),
        controller_fingerprint: String::new(),
    };

    let resolved = super::branch_view_from_node_metadata(&plan, &node_id).unwrap();
    assert_eq!(resolved.as_ref(), Some(&plan_with_branch));

    let plain_resolved =
        super::branch_view_from_node_metadata(&plan, &NodeId::new("model:plain").unwrap()).unwrap();
    assert_eq!(plain_resolved, None);

    let missing_resolved =
        super::branch_view_from_node_metadata(&plan, &NodeId::new("model:unknown").unwrap())
            .unwrap();
    assert_eq!(missing_resolved, None);
}

#[cfg(dag_ml_workspace_contract_fixtures)]
#[test]
fn published_data_output_provenance_schema_declares_current_version() {
    let schema: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../docs/contracts/data_output_provenance.schema.json"
    ))
    .unwrap();
    assert_eq!(
        schema["properties"]["schema_version"]["const"].as_u64(),
        Some(u64::from(DATA_OUTPUT_PROVENANCE_SCHEMA_VERSION))
    );
    assert_eq!(schema["$id"], DATA_OUTPUT_PROVENANCE_SCHEMA_ID);
    let required = schema["required"].as_array().unwrap();
    assert!(required
        .iter()
        .any(|field| field.as_str() == Some("schema_version")));
    assert!(required
        .iter()
        .any(|field| field.as_str() == Some("producer_node")));
    let properties = schema["properties"].as_object().unwrap();
    assert!(properties.contains_key("representation_plan"));
    assert!(properties.contains_key("representation_replay_manifest"));
    assert!(properties.contains_key("representation_compatibility"));
    assert!(properties.contains_key("relation_delta_fingerprint"));
    let defs = schema["$defs"].as_object().unwrap();
    assert!(defs.contains_key("combination_plan"));
    assert!(defs.contains_key("representation_plan"));
    assert!(defs.contains_key("representation_replay_manifest"));
    assert!(defs.contains_key("representation_compatibility_report"));
    assert!(defs.contains_key("representation_sample_observation_mapping"));
    assert!(defs.contains_key("representation_combo_selection_record"));
}

#[cfg(dag_ml_workspace_contract_fixtures)]
#[test]
fn published_node_task_and_result_schemas_declare_current_contracts() {
    let task_schema: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../docs/contracts/node_task.schema.json"
    ))
    .unwrap();
    let result_schema: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../docs/contracts/node_result.schema.json"
    ))
    .unwrap();

    assert_eq!(task_schema["$id"], NODE_TASK_SCHEMA_ID);
    assert_eq!(result_schema["$id"], NODE_RESULT_SCHEMA_ID);
    assert!(task_schema["required"]
        .as_array()
        .unwrap()
        .iter()
        .any(|field| field.as_str() == Some("node_plan")));
    assert!(result_schema["required"]
        .as_array()
        .unwrap()
        .iter()
        .any(|field| field.as_str() == Some("lineage")));
    assert_eq!(
        task_schema["$defs"]["artifact_ref"]["additionalProperties"].as_bool(),
        Some(false)
    );
    assert_eq!(result_schema["additionalProperties"].as_bool(), Some(false));
    for definition in [
        "fit_influence_diagnostic",
        "handle_ref",
        "prediction_block",
        "observation_prediction_block",
        "regression_target_block",
        "aggregated_prediction_block",
        "explanation_block",
        "prediction_unit_id",
        "shape_delta",
        "artifact_ref",
        "lineage_record",
    ] {
        assert_eq!(
            result_schema["$defs"][definition]["additionalProperties"].as_bool(),
            Some(false),
            "node-result schema definition `{definition}` must be closed"
        );
    }
}

#[cfg(dag_ml_workspace_contract_fixtures)]
#[test]
fn published_node_task_result_fixtures_validate_current_contract() {
    let task: NodeTask = serde_json::from_str(include_str!(
        "../../../../examples/fixtures/runtime/node_task_transform_scale.json"
    ))
    .unwrap();
    let result: NodeResult = serde_json::from_str(include_str!(
        "../../../../examples/fixtures/runtime/node_result_transform_scale.json"
    ))
    .unwrap();

    result.validate_for_task(&task).unwrap();
    assert_eq!(
        task.node_plan.node_id,
        NodeId::new("transform:scale").unwrap()
    );
    assert_eq!(result.outputs.len(), 1);
}

#[cfg(dag_ml_workspace_contract_fixtures)]
#[cfg(dag_ml_workspace_contract_fixtures)]
#[cfg(dag_ml_workspace_contract_fixtures)]
#[test]
fn node_result_deserialization_rejects_unknown_contract_fields_and_keeps_opaque_maps() {
    let mut document: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../examples/fixtures/runtime/node_result_transform_scale.json"
    ))
    .unwrap();
    let object = document.as_object_mut().unwrap();
    object.insert(
        "predictions".to_string(),
        json!([{
            "prediction_id": "prediction:strict",
            "producer_node": "model:strict",
            "partition": "validation",
            "fold_id": "fold:0",
            "sample_ids": ["sample:1"],
            "values": [[1.0]],
            "target_names": ["y"]
        }]),
    );
    object.insert(
        "observation_predictions".to_string(),
        json!([{
            "prediction_id": "prediction:observation.strict",
            "producer_node": "model:strict",
            "partition": "validation",
            "fold_id": "fold:0",
            "observation_ids": ["observation:1"],
            "values": [[1.0]],
            "weights": [1.0],
            "target_names": ["y"]
        }]),
    );
    object.insert(
        "aggregated_predictions".to_string(),
        json!([{
            "prediction_id": "prediction:aggregate.strict",
            "producer_node": "model:strict",
            "partition": "validation",
            "fold_id": "fold:0",
            "level": "sample",
            "unit_ids": [{"level": "sample", "id": "sample:1"}],
            "values": [[1.0]],
            "target_names": ["y"]
        }]),
    );
    object.insert(
        "explanations".to_string(),
        json!([{
            "producer_node": "model:strict",
            "method": "strict_test",
            "payload": {"unexpected_contract_field": "opaque payload remains open"}
        }]),
    );
    object.insert(
        "shape_deltas".to_string(),
        json!([{
            "node_id": "model:strict",
            "kind": "feature",
            "before_fingerprint": "before",
            "after_fingerprint": "after",
            "metadata": {"unexpected_contract_field": "opaque metadata remains open"}
        }]),
    );
    object.insert(
        "artifacts".to_string(),
        json!([{
            "id": "artifact:strict",
            "kind": "model",
            "controller_id": "controller:strict",
            "backend": "raw",
            "uri": null,
            "content_fingerprint": null,
            "size_bytes": 8,
            "plugin": null,
            "plugin_version": null
        }]),
    );
    object.insert(
        "fit_influence_diagnostics".to_string(),
        json!([{
            "requested_policy": "uniform_rows",
            "effective_policy": "uniform_rows",
            "mechanism": "uniform_rows",
            "fallback_used": false,
            "row_weight_count": 0,
            "warnings": []
        }]),
    );
    object.insert(
        "regression_targets".to_string(),
        json!([{
            "level": "sample",
            "unit_ids": [{"level": "sample", "id": "sample:1"}],
            "values": [[1.0]],
            "target_names": ["y"]
        }]),
    );
    document["lineage"]["metrics"]["unexpected_contract_field"] = json!(1.0);

    serde_json::from_value::<NodeResult>(document.clone())
        .expect("closed node-result types still accept opaque payload/metadata/metrics maps");

    for (label, pointer) in [
        ("node result", ""),
        ("output handle", "/outputs/x_out"),
        ("prediction block", "/predictions/0"),
        ("observation prediction block", "/observation_predictions/0"),
        ("aggregated prediction block", "/aggregated_predictions/0"),
        (
            "aggregated prediction unit id",
            "/aggregated_predictions/0/unit_ids/0",
        ),
        ("explanation block", "/explanations/0"),
        ("shape delta", "/shape_deltas/0"),
        ("fit influence diagnostic", "/fit_influence_diagnostics/0"),
        ("regression target block", "/regression_targets/0"),
        (
            "regression target unit id",
            "/regression_targets/0/unit_ids/0",
        ),
        ("lineage record", "/lineage"),
    ] {
        let mut tampered = document.clone();
        tampered
            .pointer_mut(pointer)
            .unwrap()
            .as_object_mut()
            .unwrap()
            .insert("unexpected_contract_field".to_string(), json!(true));
        let error = serde_json::from_value::<NodeResult>(tampered)
            .expect_err("unknown node-result contract field must be rejected");
        assert!(
            error.to_string().contains("unexpected_contract_field"),
            "{label} returned an unexpected error: {error}"
        );
    }
}

#[cfg(dag_ml_workspace_contract_fixtures)]
#[test]
fn node_result_deserialization_rejects_unknown_contract_fields_but_keeps_opaque_maps() {
    let mut document: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../examples/fixtures/runtime/node_result_transform_scale.json"
    ))
    .unwrap();
    let object = document.as_object_mut().unwrap();
    object.insert(
        "predictions".to_string(),
        json!([{
            "prediction_id": "prediction:strict",
            "producer_node": "model:strict",
            "partition": "validation",
            "fold_id": "fold:0",
            "sample_ids": ["sample:1"],
            "values": [[1.0]],
            "target_names": ["y"]
        }]),
    );
    object.insert(
        "observation_predictions".to_string(),
        json!([{
            "prediction_id": "prediction:observation.strict",
            "producer_node": "model:strict",
            "partition": "validation",
            "fold_id": "fold:0",
            "observation_ids": ["observation:1"],
            "values": [[1.0]],
            "weights": [1.0],
            "target_names": ["y"]
        }]),
    );
    object.insert(
        "aggregated_predictions".to_string(),
        json!([{
            "prediction_id": "prediction:aggregate.strict",
            "producer_node": "model:strict",
            "partition": "validation",
            "fold_id": "fold:0",
            "level": "sample",
            "unit_ids": [{"level": "sample", "id": "sample:1"}],
            "values": [[1.0]],
            "target_names": ["y"]
        }]),
    );
    object.insert(
        "explanations".to_string(),
        json!([{
            "producer_node": "model:strict",
            "method": "strict_test",
            "payload": {"unexpected_contract_field": "opaque payload remains open"}
        }]),
    );
    object.insert(
        "shape_deltas".to_string(),
        json!([{
            "node_id": "model:strict",
            "kind": "feature",
            "before_fingerprint": "before",
            "after_fingerprint": "after",
            "metadata": {"unexpected_contract_field": "opaque metadata remains open"}
        }]),
    );
    object.insert(
        "artifacts".to_string(),
        json!([{
            "id": "artifact:strict",
            "kind": "model",
            "controller_id": "controller:strict",
            "backend": "raw",
            "uri": null,
            "content_fingerprint": null,
            "size_bytes": 8,
            "plugin": null,
            "plugin_version": null
        }]),
    );
    object.insert(
        "fit_influence_diagnostics".to_string(),
        json!([{
            "requested_policy": "uniform_rows",
            "effective_policy": "uniform_rows",
            "mechanism": "uniform_rows",
            "fallback_used": false,
            "row_weight_count": 0,
            "warnings": []
        }]),
    );
    object.insert(
        "regression_targets".to_string(),
        json!([{
            "level": "sample",
            "unit_ids": [{"level": "sample", "id": "sample:1"}],
            "values": [[1.0]],
            "target_names": ["y"]
        }]),
    );
    document["lineage"]["metrics"]["unexpected_contract_field"] = json!(1.0);

    serde_json::from_value::<NodeResult>(document.clone())
        .expect("closed node-result types still accept opaque payload/metadata/metrics maps");

    for (label, pointer) in [
        ("node result", ""),
        ("output handle", "/outputs/x_out"),
        ("prediction block", "/predictions/0"),
        ("observation prediction block", "/observation_predictions/0"),
        ("aggregated prediction block", "/aggregated_predictions/0"),
        (
            "aggregated prediction unit id",
            "/aggregated_predictions/0/unit_ids/0",
        ),
        ("explanation block", "/explanations/0"),
        ("shape delta", "/shape_deltas/0"),
        ("fit influence diagnostic", "/fit_influence_diagnostics/0"),
        ("regression target block", "/regression_targets/0"),
        (
            "regression target unit id",
            "/regression_targets/0/unit_ids/0",
        ),
        ("lineage record", "/lineage"),
    ] {
        let mut tampered = document.clone();
        tampered
            .pointer_mut(pointer)
            .unwrap()
            .as_object_mut()
            .unwrap()
            .insert("unexpected_contract_field".to_string(), json!(true));
        let error = serde_json::from_value::<NodeResult>(tampered)
            .expect_err("unknown node-result contract field must be rejected");
        assert!(
            error.to_string().contains("unexpected_contract_field"),
            "{label} returned an unexpected error: {error}"
        );
    }

    let mut legacy_artifact = document;
    legacy_artifact["artifacts"][0]["host_metadata"] = json!({"legacy": true});
    serde_json::from_value::<NodeResult>(legacy_artifact)
        .expect("artifact extensions remain readable for legacy workspaces");
}

#[test]
fn campaign_data_bindings_require_unsafe_flags_for_full_train_cv_views() {
    let model_id = NodeId::new("model:pls").unwrap();
    let mut unsafe_binding = data_binding(&model_id);
    unsafe_binding.view_policy.fit_partition = DataRequestPartition::FullTrain;
    unsafe_binding.view_policy.unsafe_flags =
        BTreeSet::from([DataViewPolicy::ALLOW_FIT_CV_FULL_TRAIN_VIEW.to_string()]);

    let mut unsafe_campaign = oof_edge_campaign();
    unsafe_campaign.data_bindings =
        BTreeMap::from([(model_id.clone(), vec![unsafe_binding.clone()])]);
    let plan = build_execution_plan(
        "plan:data.full-train.unsafe",
        simple_graph(),
        unsafe_campaign,
        &manifests(),
    )
    .unwrap();

    let mut missing_flag = unsafe_binding;
    missing_flag.view_policy.unsafe_flags.clear();
    let mut invalid_campaign = oof_edge_campaign();
    invalid_campaign.data_bindings = BTreeMap::from([(model_id.clone(), vec![missing_flag])]);
    assert!(build_execution_plan(
        "plan:data.full-train.missing-flag",
        simple_graph(),
        invalid_campaign,
        &manifests(),
    )
    .is_err());

    let envelope: ExternalDataPlanEnvelope = serde_json::from_str(include_str!(
        "../../tests/fixtures/package/data/coordinator_data_plan_envelope_sample12.json"
    ))
    .unwrap();
    let provider = InMemoryDataProvider::with_envelope(
        ControllerId::new("controller:data.provider").unwrap(),
        envelope,
    )
    .unwrap();
    let controllers = runtime_controllers();
    let mut ctx = RunContext::new(RunId::new("run:data.full-train.unsafe").unwrap(), Some(11));

    SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::FitCv,
        )
        .unwrap();

    let full_train_ids = plan.fold_set.as_ref().unwrap().sample_ids.clone();
    let views = provider.view_records();
    let full_train_views = views
        .iter()
        .filter(|view| view.view.partition == DataRequestPartition::FullTrain)
        .collect::<Vec<_>>();
    let validation_views = views
        .iter()
        .filter(|view| view.view.partition == DataRequestPartition::FoldValidation)
        .collect::<Vec<_>>();
    assert_eq!(full_train_views.len(), 2);
    assert_eq!(validation_views.len(), 2);
    assert!(full_train_views.iter().all(|view| {
        view.view.sample_ids == Some(full_train_ids.clone())
            && view.view.fold_id.is_none()
            && view.view.extra["unsafe_flags"]
                .as_array()
                .unwrap()
                .iter()
                .any(|flag| flag.as_str() == Some(DataViewPolicy::ALLOW_FIT_CV_FULL_TRAIN_VIEW))
    }));
    assert!(validation_views
        .iter()
        .all(|view| !view.view.include_augmented));
}

#[test]
fn campaign_refit_data_bindings_create_full_train_views() {
    let plan = fixture_plan("plan:refit.views");
    let provider = replay_data_provider();
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(ReplayMockController {
            id: ControllerId::new("controller:transform.mock").unwrap(),
            handle: 11,
            require_artifact: false,
            emit_prediction: false,
            emit_refit_artifact: false,
        }))
        .unwrap();
    controllers
        .register(Box::new(ReplayMockController {
            id: ControllerId::new("controller:model.mock").unwrap(),
            handle: 22,
            require_artifact: false,
            emit_prediction: true,
            emit_refit_artifact: false,
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:refit.views").unwrap(), Some(11));
    ctx.variant_id = Some(plan.variants[0].variant_id.clone());

    let results = SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::Refit,
        )
        .unwrap();

    assert!(!results.is_empty());
    let views = provider.view_records();
    assert_eq!(views.len(), 1);
    let full_train_ids = plan.fold_set.as_ref().unwrap().sample_ids.clone();
    assert!(views.iter().all(|view| {
        view.view.partition == DataRequestPartition::FullTrain
            && view.view.sample_ids == Some(full_train_ids.clone())
            && view.fold_id.is_none()
    }));
}

#[test]
fn campaign_refit_captures_emitted_artifact_handles() {
    let plan = fixture_plan("plan:refit.artifact.capture");
    let provider = replay_data_provider();
    let mut artifact_store = InMemoryArtifactStore::new();
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(ReplayMockController {
            id: ControllerId::new("controller:transform.mock").unwrap(),
            handle: 11,
            require_artifact: false,
            emit_prediction: false,
            emit_refit_artifact: false,
        }))
        .unwrap();
    controllers
        .register(Box::new(ReplayMockController {
            id: ControllerId::new("controller:model.mock").unwrap(),
            handle: 22,
            require_artifact: false,
            emit_prediction: true,
            emit_refit_artifact: true,
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:refit.artifact.capture").unwrap(), Some(11));
    ctx.variant_id = Some(plan.variants[0].variant_id.clone());

    let results = SequentialScheduler
        .execute_campaign_phase_with_data_provider_and_artifact_store(
            &plan,
            &controllers,
            &provider,
            &mut artifact_store,
            &mut ctx,
            Phase::Refit,
        )
        .unwrap();

    assert_eq!(results.len(), 2);
    assert_eq!(
        results
            .iter()
            .filter(|result| !result.artifacts.is_empty())
            .count(),
        1
    );
    assert_eq!(artifact_store.len(), 1);
    let records = artifact_store.refit_artifacts();
    assert_eq!(records.len(), 1);
    let artifact = &records[0];
    artifact.validate().unwrap();
    assert_eq!(artifact.node_id.as_str(), "model:base");
    assert_eq!(artifact.controller_id.as_str(), "controller:model.mock");
    assert_eq!(artifact.artifact.id.as_str(), "artifact:model:base:refit");
    assert_eq!(artifact.data_requirement_keys, vec!["model:base.x"]);

    let handle = artifact_store
        .materialize(&ArtifactMaterializationRequest {
            run_id: ctx.run_id.clone(),
            bundle_id: crate::ids::BundleId::new("bundle:refit.capture").unwrap(),
            node_id: artifact.node_id.clone(),
            phase: Phase::Predict,
            variant_id: ctx.variant_id.clone(),
            controller_id: artifact.controller_id.clone(),
            artifact: artifact.artifact.clone(),
            params_fingerprint: artifact.params_fingerprint.clone(),
            training_loss_fingerprint: artifact.training_loss_fingerprint.clone(),
        })
        .unwrap();
    assert_eq!(
        handle,
        HandleRef {
            handle: 10_022,
            kind: HandleKind::Model,
            owner_controller: ControllerId::new("controller:model.mock").unwrap(),
        }
    );
}

#[test]
fn parallel_campaign_refit_captures_emitted_artifact_handles() {
    let plan = fixture_plan("plan:parallel.refit.artifact.capture");
    let provider = replay_data_provider();
    let mut artifact_store = InMemoryArtifactStore::new();
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(ReplayMockController {
            id: ControllerId::new("controller:transform.mock").unwrap(),
            handle: 11,
            require_artifact: false,
            emit_prediction: false,
            emit_refit_artifact: false,
        }))
        .unwrap();
    controllers
        .register(Box::new(ReplayMockController {
            id: ControllerId::new("controller:model.mock").unwrap(),
            handle: 22,
            require_artifact: false,
            emit_prediction: true,
            emit_refit_artifact: true,
        }))
        .unwrap();
    let mut ctx = RunContext::new(
        RunId::new("run:parallel.refit.artifact.capture").unwrap(),
        Some(11),
    );
    ctx.variant_id = Some(plan.variants[0].variant_id.clone());

    let results = ParallelScheduler::new(2)
        .unwrap()
        .execute_campaign_phase_with_data_provider_and_artifact_store(
            &plan,
            &controllers,
            &provider,
            &mut artifact_store,
            &mut ctx,
            Phase::Refit,
        )
        .unwrap();

    assert_eq!(results.len(), 2);
    assert_eq!(artifact_store.len(), 1);
    assert_eq!(
        artifact_store.refit_artifacts()[0].artifact.id.as_str(),
        "artifact:model:base:refit"
    );
}

fn fit_influence_view(sample_ids: Vec<&str>) -> BTreeMap<String, DataProviderViewSpec> {
    BTreeMap::from([(
        "data:x:train".to_string(),
        DataProviderViewSpec {
            sample_ids: Some(
                sample_ids
                    .into_iter()
                    .map(|sample_id| SampleId::new(sample_id).unwrap())
                    .collect(),
            ),
            partition: DataRequestPartition::FoldTrain,
            fold_id: Some(FoldId::new("fold:0").unwrap()),
            source_ids: None,
            columns: None,
            include_augmented: false,
            include_excluded: false,
            branch_view: None,
            extra: BTreeMap::new(),
        },
    )])
}

fn fit_influence_validation_task(fit_influence: FitInfluenceTask) -> NodeTask {
    let plan = build_execution_plan(
        "plan:fit.influence.validation",
        simple_graph(),
        CampaignSpec {
            inner_cv: None,
            id: "campaign:fit.influence.validation".to_string(),
            root_seed: Some(7),
            leakage_policy: Default::default(),
            aggregation_policy: Default::default(),
            split_invocation: None,
            generation: Default::default(),
            shape_plans: BTreeMap::new(),
            data_bindings: BTreeMap::new(),
            branch_view_plans: Vec::new(),
            metadata: BTreeMap::new(),
        },
        &manifests(),
    )
    .unwrap();
    let node_plan = plan
        .node_plans
        .get(&NodeId::new("model:pls").unwrap())
        .unwrap()
        .clone();
    NodeTask {
        inner_fold_set: None,
        run_id: RunId::new("run:fit.influence.validation").unwrap(),
        node_plan,
        phase: Phase::FitCv,
        variant_id: None,
        variant: None,
        fold_id: Some(FoldId::new("fold:0").unwrap()),
        branch_path: Vec::new(),
        input_handles: BTreeMap::new(),
        data_views: BTreeMap::new(),
        prediction_inputs: BTreeMap::new(),
        artifact_inputs: BTreeMap::new(),
        required_loss_attestations: Vec::new(),
        fit_influence,
        seed: Some(7),
    }
}

#[cfg(dag_ml_workspace_contract_fixtures)]
fn runtime_custom_loss_role(node_id: NodeId) -> TrainingLossRoleReference {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../examples/fixtures/criteria/criteria_contracts.v1.json"
    ))
    .unwrap();
    let mut role: TrainingLossRoleReference =
        serde_json::from_value(fixture["valid"]["training_loss_role"].clone()).unwrap();
    role.node_id = node_id;
    role
}

#[cfg(dag_ml_workspace_contract_fixtures)]
fn runtime_rust_custom_loss_role(node_id: NodeId) -> TrainingLossRoleReference {
    let mut role = runtime_custom_loss_role(node_id);
    role.loss.implementation.provider_id = "provider:rust-local".to_string();
    role.loss.implementation.binding_id = "binding:rust".to_string();
    role.loss.implementation.implementation_fingerprint = "2".repeat(64);
    role.loss.implementation.registry_key = Some("loss:run-123:asymmetric-rust".to_string());
    role.loss
        .implementation
        .capabilities
        .remove(&ImplementationCapability::NeedsGil);
    role.loss.implementation.descriptor_fingerprint =
        role.loss.implementation.compute_fingerprint().unwrap();
    role.validate().unwrap();
    role
}

#[test]
fn fit_influence_strict_requires_weight_support() {
    let error = resolve_fit_influence_task(
        FitInfluencePolicy::StrictWeightSupport,
        &BTreeSet::new(),
        &fit_influence_view(vec!["s1", "s1", "s2"]),
    )
    .unwrap_err()
    .to_string();

    assert!(
        error.contains("fit influence"),
        "unexpected strict support error: {error}"
    );
}

#[test]
fn d9_negative_controller_lacking_fit_influence_capability_is_rejected() {
    let error = resolve_fit_influence_task(
        FitInfluencePolicy::EqualSampleInfluence,
        &BTreeSet::new(),
        &fit_influence_view(vec!["s1", "s1", "s2"]),
    )
    .unwrap_err()
    .to_string();

    assert!(
        error.contains("controller capabilities do not support requested fit influence policy"),
        "unexpected D9 fit-influence capability error: {error}"
    );
}

#[test]
fn fit_influence_auto_falls_back_with_warning() {
    let task = resolve_fit_influence_task(
        FitInfluencePolicy::Auto,
        &BTreeSet::new(),
        &fit_influence_view(vec!["s1", "s1", "s2"]),
    )
    .unwrap();

    assert_eq!(task.effective_policy, FitInfluencePolicy::UniformRows);
    assert_eq!(task.mechanism, FitInfluenceMechanism::UniformRows);
    assert!(task.warnings[0].contains("fell back"));
    task.validate().unwrap();

    let diagnostic = task.diagnostic();
    assert!(diagnostic.fallback_used);
    assert_eq!(diagnostic.row_weight_count, 0);
    assert_eq!(diagnostic.warnings, task.warnings);
}

#[test]
fn d9_fit_influence_diagnostic_must_match_runtime_task_warnings() {
    let fit_influence = resolve_fit_influence_task(
        FitInfluencePolicy::Auto,
        &BTreeSet::new(),
        &fit_influence_view(vec!["s1", "s1", "s2"]),
    )
    .unwrap();
    let task = fit_influence_validation_task(fit_influence.clone());
    let diagnostic = fit_influence.diagnostic();
    diagnostic.validate(&task).unwrap();

    let mut wrong_fallback = diagnostic.clone();
    wrong_fallback.fallback_used = false;
    let error = wrong_fallback.validate(&task).unwrap_err().to_string();
    assert!(
        error.contains("fallback_used"),
        "unexpected fallback mismatch error: {error}"
    );

    let mut wrong_warning = diagnostic;
    wrong_warning.warnings = vec!["different warning".to_string()];
    let error = wrong_warning.validate(&task).unwrap_err().to_string();
    assert!(
        error.contains("warnings do not match"),
        "unexpected warning mismatch error: {error}"
    );
}

#[test]
fn equal_sample_influence_emits_per_row_weights_without_aggregation_weights() {
    let capabilities = BTreeSet::from([ControllerCapability::SupportsSampleWeights]);
    let task = resolve_fit_influence_task(
        FitInfluencePolicy::EqualSampleInfluence,
        &capabilities,
        &fit_influence_view(vec!["s1", "s1", "s2"]),
    )
    .unwrap();

    assert_eq!(task.mechanism, FitInfluenceMechanism::SampleWeights);
    assert_eq!(task.row_weights, vec![0.5, 0.5, 1.0]);

    let aggregation = AggregationPolicy {
        method: AggregationMethod::WeightedMean,
        weights: crate::policy::AggregationWeights::RepetitionCount,
        ..AggregationPolicy::default()
    };
    aggregation.validate().unwrap();
    assert_eq!(
        task.effective_policy,
        FitInfluencePolicy::EqualSampleInfluence
    );
}

#[cfg(dag_ml_workspace_contract_fixtures)]
#[test]
fn node_result_validation_rejects_external_conformance_mismatches() {
    let plan = build_execution_plan(
        "plan:result.validation",
        simple_graph(),
        CampaignSpec {
            inner_cv: None,
            id: "campaign:result.validation".to_string(),
            root_seed: Some(11),
            leakage_policy: Default::default(),
            aggregation_policy: Default::default(),
            split_invocation: None,
            generation: Default::default(),
            shape_plans: BTreeMap::new(),
            data_bindings: BTreeMap::new(),
            branch_view_plans: Vec::new(),
            metadata: BTreeMap::new(),
        },
        &manifests(),
    )
    .unwrap();
    let node_plan = plan
        .node_plans
        .get(&NodeId::new("model:pls").unwrap())
        .unwrap()
        .clone();
    let task = NodeTask {
        inner_fold_set: None,
        run_id: RunId::new("run:result.validation").unwrap(),
        node_plan: node_plan.clone(),
        phase: Phase::FitCv,
        variant_id: None,
        variant: None,
        fold_id: None,
        branch_path: Vec::new(),
        input_handles: BTreeMap::new(),
        data_views: BTreeMap::new(),
        prediction_inputs: BTreeMap::new(),
        artifact_inputs: BTreeMap::new(),
        required_loss_attestations: Vec::new(),
        fit_influence: FitInfluenceTask::default(),
        seed: Some(99),
    };
    let controller = MockController {
        id: node_plan.controller_id.clone(),
        handle: 2,
        emit_prediction: false,
    };
    let result = controller.invoke(&task).unwrap();
    result.validate_for_task(&task).unwrap();

    let mut bad_controller = result.clone();
    bad_controller.lineage.controller_id = ControllerId::new("controller:wrong").unwrap();
    assert!(bad_controller
        .validate_for_task(&task)
        .unwrap_err()
        .to_string()
        .contains("controller"));

    let mut bad_params = result.clone();
    bad_params.lineage.params_fingerprint = "wrong".to_string();
    assert!(bad_params
        .validate_for_task(&task)
        .unwrap_err()
        .to_string()
        .contains("params fingerprint"));

    let mut bad_output_owner = result.clone();
    bad_output_owner
        .outputs
        .get_mut("out")
        .unwrap()
        .owner_controller = ControllerId::new("controller:wrong").unwrap();
    assert!(bad_output_owner
        .validate_for_task(&task)
        .unwrap_err()
        .to_string()
        .contains("output `out`"));

    let mut loss_task = task.clone();
    let loss_role = runtime_custom_loss_role(loss_task.node_plan.node_id.clone());
    loss_task.node_plan.training_losses = vec![loss_role.clone()];
    loss_task.required_loss_attestations =
        NodeTask::required_loss_attestations_for(&loss_task.node_plan, loss_task.phase).unwrap();
    let (bound_role, bound_attestation) = loss_task.training_loss_binding(0).unwrap();
    assert_eq!(bound_role, &loss_role);
    assert_eq!(bound_attestation, &loss_task.required_loss_attestations[0]);
    assert!(loss_task
        .training_loss_binding(1)
        .unwrap_err()
        .to_string()
        .contains("outside the active training loss range"));
    assert_eq!(
        serde_json::to_value(&loss_task).unwrap()["required_loss_attestations"],
        serde_json::to_value(&loss_task.required_loss_attestations).unwrap()
    );
    let missing_attestation = controller.invoke(&loss_task).unwrap();
    assert!(missing_attestation
        .validate_for_task(&loss_task)
        .unwrap_err()
        .to_string()
        .contains("loss attestations"));

    let mut attested = missing_attestation;
    attested.lineage.loss_attestations =
        vec![LossExecutionAttestation::for_role(&loss_role, Phase::FitCv).unwrap()];
    attested.validate_for_task(&loss_task).unwrap();

    let mut first_role = loss_role.clone();
    first_role.output_id = Some("a".to_string());
    let mut second_role = loss_role.clone();
    second_role.output_id = Some("b".to_string());
    let mut multi_output_task = loss_task.clone();
    multi_output_task.node_plan.training_losses = vec![first_role.clone(), second_role.clone()];
    multi_output_task.required_loss_attestations = NodeTask::required_loss_attestations_for(
        &multi_output_task.node_plan,
        multi_output_task.phase,
    )
    .unwrap();
    let (bound_second_role, bound_second_attestation) =
        multi_output_task.training_loss_binding(1).unwrap();
    assert_eq!(bound_second_role, &second_role);
    assert_eq!(
        bound_second_attestation,
        &multi_output_task.required_loss_attestations[1]
    );

    let mut refit_only_role = loss_role.clone();
    refit_only_role.output_id = Some("refit-only".to_string());
    refit_only_role.phases = BTreeSet::from([Phase::Refit]);
    let mut fit_only_role = loss_role.clone();
    fit_only_role.output_id = Some("fit-only".to_string());
    fit_only_role.phases = BTreeSet::from([Phase::FitCv]);
    let mut phase_filtered_task = loss_task.clone();
    phase_filtered_task.node_plan.training_losses = vec![refit_only_role, fit_only_role.clone()];
    phase_filtered_task.required_loss_attestations = NodeTask::required_loss_attestations_for(
        &phase_filtered_task.node_plan,
        phase_filtered_task.phase,
    )
    .unwrap();
    let (bound_fit_role, bound_fit_attestation) =
        phase_filtered_task.training_loss_binding(0).unwrap();
    assert_eq!(bound_fit_role, &fit_only_role);
    assert_eq!(
        bound_fit_attestation,
        &phase_filtered_task.required_loss_attestations[0]
    );

    let mut reversed = controller.invoke(&multi_output_task).unwrap();
    reversed.lineage.loss_attestations = vec![
        LossExecutionAttestation::for_role(&second_role, Phase::FitCv).unwrap(),
        LossExecutionAttestation::for_role(&first_role, Phase::FitCv).unwrap(),
    ];
    assert!(reversed
        .validate_for_task(&multi_output_task)
        .unwrap_err()
        .to_string()
        .contains("does not match"));

    let mut refit_task = loss_task.clone();
    refit_task.phase = Phase::Refit;
    refit_task.required_loss_attestations =
        NodeTask::required_loss_attestations_for(&refit_task.node_plan, refit_task.phase).unwrap();
    let mut refit_result = controller.invoke(&refit_task).unwrap();
    refit_result.lineage.loss_attestations =
        vec![LossExecutionAttestation::for_role(&loss_role, Phase::Refit).unwrap()];
    refit_result.validate_for_task(&refit_task).unwrap();
    refit_result.lineage.loss_attestations = attested.lineage.loss_attestations.clone();
    assert!(refit_result
        .validate_for_task(&refit_task)
        .unwrap_err()
        .to_string()
        .contains("does not match"));

    let mut mismatched = attested;
    mismatched.lineage.loss_attestations[0].semantic_fingerprint = "0".repeat(64);
    mismatched.lineage.loss_attestations[0].attestation_fingerprint =
        mismatched.lineage.loss_attestations[0]
            .compute_fingerprint()
            .unwrap();
    assert!(mismatched
        .validate_for_task(&loss_task)
        .unwrap_err()
        .to_string()
        .contains("does not match"));

    let mut stale_requirements = loss_task.clone();
    stale_requirements.required_loss_attestations.clear();
    assert!(stale_requirements.training_loss_binding(0).is_err());
    assert!(controller
        .invoke(&stale_requirements)
        .unwrap()
        .validate_for_task(&stale_requirements)
        .unwrap_err()
        .to_string()
        .contains("loss execution requirements"));

    let mut tampered_requirements = loss_task.clone();
    tampered_requirements.required_loss_attestations[0].reduction =
        crate::criteria::LossReduction::Sum;
    tampered_requirements.required_loss_attestations[0].attestation_fingerprint =
        tampered_requirements.required_loss_attestations[0]
            .compute_fingerprint()
            .unwrap();
    assert!(tampered_requirements.training_loss_binding(0).is_err());
    assert!(controller
        .invoke(&tampered_requirements)
        .unwrap()
        .validate_for_task(&tampered_requirements)
        .unwrap_err()
        .to_string()
        .contains("loss execution requirements"));

    assert!(
        NodeTask::required_loss_attestations_for(&loss_task.node_plan, Phase::Predict)
            .unwrap()
            .is_empty()
    );
    let mut predict_task = loss_task;
    predict_task.phase = Phase::Predict;
    predict_task.required_loss_attestations.clear();
    assert!(predict_task
        .training_loss_binding(0)
        .unwrap_err()
        .to_string()
        .contains("FIT_CV or REFIT"));
}

#[cfg(dag_ml_workspace_contract_fixtures)]
#[test]
fn scheduler_populates_native_loss_execution_requirements() {
    let mut controller_manifests = ControllerRegistry::new();
    controller_manifests
        .register(controller_manifest(
            "controller:transform",
            NodeKind::Transform,
        ))
        .unwrap();
    let mut model_manifest = controller_manifest("controller:model", NodeKind::Model);
    model_manifest
        .supported_phases
        .extend([Phase::FitCv, Phase::Refit]);
    model_manifest.capabilities.extend([
        ControllerCapability::NeedsPythonGil,
        ControllerCapability::SupportsConfigurableLoss,
        ControllerCapability::SupportsCustomLoss,
        ControllerCapability::SupportsDifferentiableLoss,
    ]);
    controller_manifests.register(model_manifest).unwrap();
    let mut plan = build_execution_plan(
        "plan:loss.requirements.scheduler",
        simple_graph(),
        CampaignSpec {
            inner_cv: None,
            id: "campaign:loss.requirements.scheduler".to_string(),
            root_seed: Some(17),
            leakage_policy: Default::default(),
            aggregation_policy: Default::default(),
            split_invocation: None,
            generation: Default::default(),
            shape_plans: BTreeMap::new(),
            data_bindings: BTreeMap::new(),
            branch_view_plans: Vec::new(),
            metadata: BTreeMap::new(),
        },
        &controller_manifests,
    )
    .unwrap();
    let model_id = NodeId::new("model:pls").unwrap();
    let role = runtime_custom_loss_role(model_id.clone());
    plan.node_plans.get_mut(&model_id).unwrap().training_losses = vec![role.clone()];
    plan.validate().unwrap();

    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(MockController {
            id: ControllerId::new("controller:transform").unwrap(),
            handle: 1,
            emit_prediction: false,
        }))
        .unwrap();
    controllers
        .register(Box::new(LossRequirementEchoController {
            inner: MockController {
                id: ControllerId::new("controller:model").unwrap(),
                handle: 2,
                emit_prediction: false,
            },
        }))
        .unwrap();
    let mut context = RunContext::new(
        RunId::new("run:loss.requirements.scheduler").unwrap(),
        Some(17),
    );
    let results = SequentialScheduler
        .execute_campaign_phase(&plan, &controllers, &mut context, Phase::FitCv)
        .unwrap();
    let model_result = results
        .iter()
        .find(|result| result.node_id == model_id)
        .unwrap();
    assert_eq!(
        model_result.lineage.loss_attestations,
        vec![LossExecutionAttestation::for_role(&role, Phase::FitCv).unwrap()]
    );
}

#[cfg(dag_ml_workspace_contract_fixtures)]
#[test]
fn scheduler_executes_rust_local_loss_before_attesting() {
    let mut controller_manifests = ControllerRegistry::new();
    let mut transform_manifest = controller_manifest("controller:transform", NodeKind::Transform);
    transform_manifest
        .supported_phases
        .extend([Phase::FitCv, Phase::Refit]);
    controller_manifests.register(transform_manifest).unwrap();
    let mut model_manifest = controller_manifest("controller:model", NodeKind::Model);
    model_manifest
        .supported_phases
        .extend([Phase::FitCv, Phase::Refit]);
    model_manifest.capabilities.extend([
        ControllerCapability::SupportsConfigurableLoss,
        ControllerCapability::SupportsCustomLoss,
        ControllerCapability::SupportsDifferentiableLoss,
    ]);
    controller_manifests.register(model_manifest).unwrap();
    let mut plan = build_execution_plan(
        "plan:loss.rust.scheduler",
        simple_graph(),
        CampaignSpec {
            inner_cv: None,
            id: "campaign:loss.rust.scheduler".to_string(),
            root_seed: Some(23),
            leakage_policy: Default::default(),
            aggregation_policy: Default::default(),
            split_invocation: None,
            generation: Default::default(),
            shape_plans: BTreeMap::new(),
            data_bindings: BTreeMap::new(),
            branch_view_plans: Vec::new(),
            metadata: BTreeMap::new(),
        },
        &controller_manifests,
    )
    .unwrap();
    let model_id = NodeId::new("model:pls").unwrap();
    let role = runtime_rust_custom_loss_role(model_id.clone());
    plan.node_plans.get_mut(&model_id).unwrap().training_losses = vec![role.clone()];
    plan.validate().unwrap();

    let registry = Arc::new(Mutex::new(LocalImplementationRegistry::<RustLossFn>::new()));
    let loss: RustLossFn = Arc::new(|target, prediction| (prediction - target).abs());
    registry
        .lock()
        .unwrap()
        .register_loss(&role.loss, loss)
        .unwrap();
    let calls = Arc::new(Mutex::new(Vec::new()));

    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(MockController {
            id: ControllerId::new("controller:transform").unwrap(),
            handle: 1,
            emit_prediction: false,
        }))
        .unwrap();
    controllers
        .register(Box::new(RustLocalLossController {
            inner: MockController {
                id: ControllerId::new("controller:model").unwrap(),
                handle: 2,
                emit_prediction: false,
            },
            registry: Arc::clone(&registry),
            calls: Arc::clone(&calls),
        }))
        .unwrap();

    let mut context = RunContext::new(RunId::new("run:loss.rust.scheduler").unwrap(), Some(23));
    let fit_results = SequentialScheduler
        .execute_campaign_phase(&plan, &controllers, &mut context, Phase::FitCv)
        .unwrap();
    let refit_results = SequentialScheduler
        .execute_campaign_phase(&plan, &controllers, &mut context, Phase::Refit)
        .unwrap();

    let expected_fit = LossExecutionAttestation::for_role(&role, Phase::FitCv).unwrap();
    let expected_refit = LossExecutionAttestation::for_role(&role, Phase::Refit).unwrap();
    let model_fit = fit_results
        .iter()
        .find(|result| result.node_id == model_id)
        .unwrap();
    let model_refit = refit_results
        .iter()
        .find(|result| result.node_id == model_id)
        .unwrap();
    assert_eq!(model_fit.lineage.loss_attestations, vec![expected_fit]);
    assert_eq!(model_refit.lineage.loss_attestations, vec![expected_refit]);

    let calls = calls.lock().unwrap().clone();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].0, Phase::FitCv);
    assert_eq!(calls[0].1, None);
    assert!((calls[0].2 - 3.5).abs() < f64::EPSILON);
    assert_eq!(calls[1].0, Phase::Refit);
    assert_eq!(calls[1].1, None);
    assert!((calls[1].2 - 3.5).abs() < f64::EPSILON);

    let nonfinite_registry = Arc::new(Mutex::new(LocalImplementationRegistry::<RustLossFn>::new()));
    let nonfinite_loss: RustLossFn = Arc::new(|_, _| f64::NAN);
    nonfinite_registry
        .lock()
        .unwrap()
        .register_loss(&role.loss, nonfinite_loss)
        .unwrap();
    let nonfinite_calls = Arc::new(Mutex::new(Vec::new()));
    let mut nonfinite_controllers = RuntimeControllerRegistry::new();
    nonfinite_controllers
        .register(Box::new(MockController {
            id: ControllerId::new("controller:transform").unwrap(),
            handle: 1,
            emit_prediction: false,
        }))
        .unwrap();
    nonfinite_controllers
        .register(Box::new(RustLocalLossController {
            inner: MockController {
                id: ControllerId::new("controller:model").unwrap(),
                handle: 2,
                emit_prediction: false,
            },
            registry: Arc::clone(&nonfinite_registry),
            calls: Arc::clone(&nonfinite_calls),
        }))
        .unwrap();
    let mut nonfinite_context =
        RunContext::new(RunId::new("run:loss.rust.nonfinite").unwrap(), Some(23));
    let error = SequentialScheduler
        .execute_campaign_phase(
            &plan,
            &nonfinite_controllers,
            &mut nonfinite_context,
            Phase::FitCv,
        )
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("non-finite scalar"),
        "unexpected non-finite loss error: {error}"
    );
    assert!(nonfinite_calls.lock().unwrap().is_empty());
}

#[test]
fn node_result_validation_checks_shape_fingerprints_and_feature_deltas() {
    let model_id = NodeId::new("model:pls").unwrap();
    let initial_feature_schema = "a".repeat(64);
    let updated_feature_schema = "b".repeat(64);
    let shape_plan = DataModelShapePlan {
        node_id: model_id.clone(),
        input_granularity: Granularity::Sample,
        target_granularity: Granularity::Sample,
        fit_rows: FitBoundary::FoldTrain,
        predict_rows: FitBoundary::FoldValidation,
        feature_namespace: Some("raw.x".to_string()),
        feature_schema_fingerprint: Some(initial_feature_schema.clone()),
        target_space: "raw".to_string(),
        aggregation_policy: AggregationPolicy::default(),
        augmentation_policy: Default::default(),
        selection_policy: Default::default(),
    };
    let plan = build_execution_plan(
        "plan:result.validation.shape",
        simple_graph(),
        CampaignSpec {
            inner_cv: None,
            id: "campaign:result.validation.shape".to_string(),
            root_seed: Some(11),
            leakage_policy: Default::default(),
            aggregation_policy: Default::default(),
            split_invocation: None,
            generation: Default::default(),
            shape_plans: BTreeMap::from([(model_id.clone(), shape_plan.clone())]),
            data_bindings: BTreeMap::new(),
            branch_view_plans: Vec::new(),
            metadata: BTreeMap::new(),
        },
        &manifests(),
    )
    .unwrap();
    let node_plan = plan.node_plans.get(&model_id).unwrap().clone();
    let task = NodeTask {
        inner_fold_set: None,
        run_id: RunId::new("run:result.validation.shape").unwrap(),
        node_plan: node_plan.clone(),
        phase: Phase::FitCv,
        variant_id: None,
        variant: None,
        fold_id: None,
        branch_path: Vec::new(),
        input_handles: BTreeMap::new(),
        data_views: BTreeMap::new(),
        prediction_inputs: BTreeMap::new(),
        artifact_inputs: BTreeMap::new(),
        required_loss_attestations: Vec::new(),
        fit_influence: FitInfluenceTask::default(),
        seed: Some(99),
    };
    let controller = MockController {
        id: node_plan.controller_id.clone(),
        handle: 2,
        emit_prediction: false,
    };
    let mut result = controller.invoke(&task).unwrap();
    result.lineage.data_model_shape_fingerprint =
        Some(stable_json_fingerprint(&shape_plan).unwrap());
    result.lineage.aggregation_policy_fingerprint =
        Some(stable_json_fingerprint(&shape_plan.aggregation_policy).unwrap());
    result.shape_deltas = vec![ShapeDelta {
        node_id: model_id.clone(),
        kind: ShapeDeltaKind::Feature,
        before_fingerprint: initial_feature_schema.clone(),
        after_fingerprint: updated_feature_schema.clone(),
        metadata: BTreeMap::from([(
            "feature_namespace".to_string(),
            serde_json::Value::String("selected.x".to_string()),
        )]),
    }];
    result.validate_for_task(&task).unwrap();

    let mut wrong_shape_fingerprint = result.clone();
    wrong_shape_fingerprint.lineage.data_model_shape_fingerprint = Some("0".repeat(64));
    assert!(wrong_shape_fingerprint
        .validate_for_task(&task)
        .unwrap_err()
        .to_string()
        .contains("data/model shape fingerprint"));

    let mut wrong_feature_delta = result.clone();
    wrong_feature_delta.shape_deltas[0].before_fingerprint = "c".repeat(64);
    assert!(wrong_feature_delta
        .validate_for_task(&task)
        .unwrap_err()
        .to_string()
        .contains("expected current schema"));

    let mut unchanged_delta = result;
    unchanged_delta.shape_deltas[0].after_fingerprint = initial_feature_schema;
    assert!(unchanged_delta
        .validate_for_task(&task)
        .unwrap_err()
        .to_string()
        .contains("does not change fingerprint"));
}

#[test]
fn node_result_validation_rejects_bad_artifact_handles() {
    let plan = build_execution_plan(
        "plan:result.validation.artifacts",
        simple_graph(),
        CampaignSpec {
            inner_cv: None,
            id: "campaign:result.validation.artifacts".to_string(),
            root_seed: Some(11),
            leakage_policy: Default::default(),
            aggregation_policy: Default::default(),
            split_invocation: None,
            generation: Default::default(),
            shape_plans: BTreeMap::new(),
            data_bindings: BTreeMap::new(),
            branch_view_plans: Vec::new(),
            metadata: BTreeMap::new(),
        },
        &manifests(),
    )
    .unwrap();
    let node_plan = plan
        .node_plans
        .get(&NodeId::new("model:pls").unwrap())
        .unwrap()
        .clone();
    let task = NodeTask {
        inner_fold_set: None,
        run_id: RunId::new("run:result.validation.artifacts").unwrap(),
        node_plan: node_plan.clone(),
        phase: Phase::Refit,
        variant_id: None,
        variant: None,
        fold_id: None,
        branch_path: Vec::new(),
        input_handles: BTreeMap::new(),
        data_views: BTreeMap::new(),
        prediction_inputs: BTreeMap::new(),
        artifact_inputs: BTreeMap::new(),
        required_loss_attestations: Vec::new(),
        fit_influence: FitInfluenceTask::default(),
        seed: Some(99),
    };
    let controller = MockController {
        id: node_plan.controller_id.clone(),
        handle: 2,
        emit_prediction: false,
    };
    let base = controller.invoke(&task).unwrap();
    let artifact = ArtifactRef {
        id: ArtifactId::new("artifact:model:pls:refit").unwrap(),
        kind: "mock_model".to_string(),
        controller_id: node_plan.controller_id.clone(),
        backend: None,
        uri: None,
        content_fingerprint: None,
        size_bytes: Some(128),
        plugin: None,
        plugin_version: None,
        abi_major: None,
        abi_min_minor: None,
        native_predictor_descriptor: None,
    };
    let handle = HandleRef {
        handle: 77,
        kind: HandleKind::Model,
        owner_controller: node_plan.controller_id.clone(),
    };
    let mut valid = base.clone();
    valid.artifacts = vec![artifact.clone()];
    valid
        .artifact_handles
        .insert(artifact.id.clone(), handle.clone());
    valid.lineage.artifact_refs = vec![artifact.clone()];
    valid.validate_for_task(&task).unwrap();

    let mut missing_handle = valid.clone();
    missing_handle.artifact_handles.clear();
    assert!(missing_handle
        .validate_for_task(&task)
        .unwrap_err()
        .to_string()
        .contains("without artifact handle"));

    let mut wrong_kind = valid.clone();
    wrong_kind
        .artifact_handles
        .get_mut(&artifact.id)
        .unwrap()
        .kind = HandleKind::Data;
    assert!(wrong_kind
        .validate_for_task(&task)
        .unwrap_err()
        .to_string()
        .contains("non-artifact/model handle kind"));

    let mut wrong_owner = valid.clone();
    wrong_owner
        .artifact_handles
        .get_mut(&artifact.id)
        .unwrap()
        .owner_controller = ControllerId::new("controller:wrong").unwrap();
    assert!(wrong_owner
        .validate_for_task(&task)
        .unwrap_err()
        .to_string()
        .contains("owned by"));

    let mut undeclared_handle = base.clone();
    undeclared_handle.artifact_handles.insert(
        ArtifactId::new("artifact:model:pls:extra").unwrap(),
        handle.clone(),
    );
    assert!(undeclared_handle
        .validate_for_task(&task)
        .unwrap_err()
        .to_string()
        .contains("undeclared artifact"));

    let mut missing_lineage_ref = valid;
    missing_lineage_ref.lineage.artifact_refs.clear();
    assert!(missing_lineage_ref
        .validate_for_task(&task)
        .unwrap_err()
        .to_string()
        .contains("lineage artifact ref"));
}

#[test]
fn artifact_ref_validates_portable_metadata() {
    let content_fingerprint = "a".repeat(64);
    let artifact = ArtifactRef {
        id: ArtifactId::new("artifact:model:portable").unwrap(),
        kind: "model".to_string(),
        controller_id: ControllerId::new("controller:sklearn").unwrap(),
        backend: Some(ArtifactBackend::Joblib),
        uri: Some(format!("artifacts/{content_fingerprint}.joblib")),
        content_fingerprint: Some(content_fingerprint.clone()),
        size_bytes: Some(4096),
        plugin: Some("dagml.sklearn".to_string()),
        plugin_version: Some("1.0.0".to_string()),
        abi_major: None,
        abi_min_minor: None,
        native_predictor_descriptor: None,
    };

    artifact.validate().unwrap();
    let encoded = serde_json::to_value(&artifact).unwrap();
    assert_eq!(encoded["backend"].as_str(), Some("joblib"));
    assert_eq!(
        encoded["content_fingerprint"].as_str(),
        Some(content_fingerprint.as_str())
    );

    let legacy: ArtifactRef = serde_json::from_value(serde_json::json!({
        "id": "artifact:model:legacy",
        "kind": "mock_model",
        "controller_id": "controller:mock",
        "size_bytes": 128
    }))
    .unwrap();
    assert_eq!(legacy.backend, None);
    assert_eq!(legacy.content_fingerprint, None);
    legacy.validate().unwrap();

    let legacy_with_extension: ArtifactRef = serde_json::from_value(serde_json::json!({
        "id": "artifact:model:legacy-extension",
        "kind": "mock_model",
        "controller_id": "controller:mock",
        "size_bytes": 128,
        "host_metadata": { "format": "joblib", "version": 1 }
    }))
    .unwrap();
    legacy_with_extension.validate().unwrap();
}

#[test]
fn artifact_ref_rejects_invalid_portable_metadata() {
    let mut artifact = ArtifactRef {
        id: ArtifactId::new("artifact:model:portable").unwrap(),
        kind: "model".to_string(),
        controller_id: ControllerId::new("controller:sklearn").unwrap(),
        backend: Some(ArtifactBackend::Joblib),
        uri: Some("artifacts/model.joblib".to_string()),
        content_fingerprint: Some("b".repeat(64)),
        size_bytes: Some(4096),
        plugin: Some("dagml.sklearn".to_string()),
        plugin_version: Some("1.0.0".to_string()),
        abi_major: None,
        abi_min_minor: None,
        native_predictor_descriptor: None,
    };
    artifact.validate().unwrap();

    let mut bad_fingerprint = artifact.clone();
    bad_fingerprint.content_fingerprint = Some("not-a-digest".to_string());
    assert!(bad_fingerprint
        .validate()
        .unwrap_err()
        .to_string()
        .contains("artifact content fingerprint"));

    let mut missing_backend = artifact.clone();
    missing_backend.backend = None;
    assert!(missing_backend
        .validate()
        .unwrap_err()
        .to_string()
        .contains("uri without backend"));

    let mut missing_fingerprint = artifact.clone();
    missing_fingerprint.content_fingerprint = None;
    assert!(missing_fingerprint
        .validate()
        .unwrap_err()
        .to_string()
        .contains("uri without content_fingerprint"));

    artifact.plugin = None;
    assert!(artifact
        .validate()
        .unwrap_err()
        .to_string()
        .contains("plugin_version without plugin"));
}

#[test]
fn node_result_validation_rejects_predictions_outside_validation_view() {
    let model_id = NodeId::new("model:pls").unwrap();
    let plan = build_execution_plan(
        "plan:result.validation.samples",
        simple_graph(),
        CampaignSpec {
            inner_cv: None,
            id: "campaign:result.validation.samples".to_string(),
            root_seed: Some(11),
            leakage_policy: Default::default(),
            aggregation_policy: Default::default(),
            split_invocation: Some(SplitInvocation {
                id: "split:outer".to_string(),
                controller_id: None,
                leakage_policy: Default::default(),
                params: BTreeMap::new(),
                fold_set: Some(two_fold_set()),
            }),
            generation: Default::default(),
            shape_plans: BTreeMap::new(),
            data_bindings: BTreeMap::from([(model_id.clone(), vec![data_binding(&model_id)])]),
            branch_view_plans: Vec::new(),
            metadata: BTreeMap::new(),
        },
        &manifests(),
    )
    .unwrap();
    let node_plan = plan.node_plans.get(&model_id).unwrap().clone();
    let task = NodeTask {
        inner_fold_set: None,
        run_id: RunId::new("run:result.validation.samples").unwrap(),
        node_plan: node_plan.clone(),
        phase: Phase::FitCv,
        variant_id: Some(VariantId::new("variant:base").unwrap()),
        variant: None,
        fold_id: Some(FoldId::new("fold:0").unwrap()),
        branch_path: Vec::new(),
        input_handles: BTreeMap::new(),
        data_views: BTreeMap::from([(
            "data:x:validation".to_string(),
            DataProviderViewSpec {
                sample_ids: Some(vec![SampleId::new("s1").unwrap()]),
                partition: DataRequestPartition::FoldValidation,
                fold_id: Some(FoldId::new("fold:0").unwrap()),
                source_ids: None,
                columns: None,
                include_augmented: false,
                include_excluded: false,
                branch_view: None,
                extra: BTreeMap::new(),
            },
        )]),
        prediction_inputs: BTreeMap::new(),
        artifact_inputs: BTreeMap::new(),
        required_loss_attestations: Vec::new(),
        fit_influence: FitInfluenceTask::default(),
        seed: Some(99),
    };
    let result = NodeResult {
        schema_version: None,
        node_id: model_id.clone(),
        outputs: BTreeMap::from([(
            "out".to_string(),
            HandleRef {
                handle: 7,
                kind: HandleKind::Data,
                owner_controller: node_plan.controller_id.clone(),
            },
        )]),
        predictions: vec![PredictionBlock {
            prediction_id: Some("pred:bad.sample".to_string()),
            producer_node: model_id,
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new("fold:0").unwrap()),
            sample_ids: vec![SampleId::new("s2").unwrap()],
            values: vec![vec![1.0]],
            target_names: vec!["y".to_string()],
        }],
        observation_predictions: Vec::new(),
        aggregated_predictions: Vec::new(),
        explanations: Vec::new(),
        shape_deltas: Vec::new(),
        artifacts: Vec::new(),
        artifact_handles: BTreeMap::new(),
        fit_influence_diagnostics: Vec::new(),
        regression_targets: Vec::new(),
        lineage: LineageRecord {
            record_id: LineageId::new("lineage:bad.sample").unwrap(),
            run_id: task.run_id.clone(),
            node_id: task.node_plan.node_id.clone(),
            phase: task.phase,
            controller_id: task.node_plan.controller_id.clone(),
            controller_version: task.node_plan.controller_version.clone(),
            variant_id: task.variant_id.clone(),
            fold_id: task.fold_id.clone(),
            branch_path: task.branch_path.clone(),
            input_lineage: Vec::new(),
            artifact_refs: Vec::new(),
            params_fingerprint: task.node_plan.params_fingerprint.clone(),
            data_model_shape_fingerprint: None,
            aggregation_policy_fingerprint: None,
            seed: task.seed,
            unsafe_flags: BTreeSet::new(),
            metrics: BTreeMap::new(),
            loss_attestations: Vec::new(),
            early_stopping_records: Vec::new(),
        },
    };

    assert!(result.validate_for_task(&task).is_err());
}

// R-P1-5: a Sample-level aggregated validation block must stay inside its
// fold's validation view, mirroring the raw-prediction scope check. A unit
// outside the view is rejected; an in-view unit is accepted unchanged.
#[test]
fn node_result_validation_rejects_aggregated_units_outside_validation_view() {
    let model_id = NodeId::new("model:pls").unwrap();
    let plan = build_execution_plan(
        "plan:result.validation.aggregated",
        simple_graph(),
        CampaignSpec {
            inner_cv: None,
            id: "campaign:result.validation.aggregated".to_string(),
            root_seed: Some(11),
            leakage_policy: Default::default(),
            aggregation_policy: Default::default(),
            split_invocation: Some(SplitInvocation {
                id: "split:outer".to_string(),
                controller_id: None,
                leakage_policy: Default::default(),
                params: BTreeMap::new(),
                fold_set: Some(two_fold_set()),
            }),
            generation: Default::default(),
            shape_plans: BTreeMap::new(),
            data_bindings: BTreeMap::from([(model_id.clone(), vec![data_binding(&model_id)])]),
            branch_view_plans: Vec::new(),
            metadata: BTreeMap::new(),
        },
        &manifests(),
    )
    .unwrap();
    let node_plan = plan.node_plans.get(&model_id).unwrap().clone();
    let task = NodeTask {
        inner_fold_set: None,
        run_id: RunId::new("run:result.validation.aggregated").unwrap(),
        node_plan: node_plan.clone(),
        phase: Phase::FitCv,
        variant_id: Some(VariantId::new("variant:base").unwrap()),
        variant: None,
        fold_id: Some(FoldId::new("fold:0").unwrap()),
        branch_path: Vec::new(),
        input_handles: BTreeMap::new(),
        data_views: BTreeMap::from([(
            "data:x:validation".to_string(),
            DataProviderViewSpec {
                sample_ids: Some(vec![SampleId::new("s1").unwrap()]),
                partition: DataRequestPartition::FoldValidation,
                fold_id: Some(FoldId::new("fold:0").unwrap()),
                source_ids: None,
                columns: None,
                include_augmented: false,
                include_excluded: false,
                branch_view: None,
                extra: BTreeMap::new(),
            },
        )]),
        prediction_inputs: BTreeMap::new(),
        artifact_inputs: BTreeMap::new(),
        required_loss_attestations: Vec::new(),
        fit_influence: FitInfluenceTask::default(),
        seed: Some(99),
    };
    let aggregated_block = |sample: &str| AggregatedPredictionBlock {
        prediction_id: Some("pred:agg".to_string()),
        producer_node: model_id.clone(),
        producer_port: None,
        partition: PredictionPartition::Validation,
        fold_id: Some(FoldId::new("fold:0").unwrap()),
        level: PredictionLevel::Sample,
        unit_ids: vec![PredictionUnitId::Sample(SampleId::new(sample).unwrap())],
        values: vec![vec![1.0]],
        target_names: vec!["y".to_string()],
    };
    let mut result = NodeResult {
        schema_version: None,
        node_id: model_id.clone(),
        outputs: BTreeMap::from([(
            "out".to_string(),
            HandleRef {
                handle: 7,
                kind: HandleKind::Data,
                owner_controller: node_plan.controller_id.clone(),
            },
        )]),
        predictions: Vec::new(),
        observation_predictions: Vec::new(),
        aggregated_predictions: vec![aggregated_block("s2")],
        explanations: Vec::new(),
        shape_deltas: Vec::new(),
        artifacts: Vec::new(),
        artifact_handles: BTreeMap::new(),
        fit_influence_diagnostics: Vec::new(),
        regression_targets: Vec::new(),
        lineage: LineageRecord {
            record_id: LineageId::new("lineage:agg.scope").unwrap(),
            run_id: task.run_id.clone(),
            node_id: task.node_plan.node_id.clone(),
            phase: task.phase,
            controller_id: task.node_plan.controller_id.clone(),
            controller_version: task.node_plan.controller_version.clone(),
            variant_id: task.variant_id.clone(),
            fold_id: task.fold_id.clone(),
            branch_path: task.branch_path.clone(),
            input_lineage: Vec::new(),
            artifact_refs: Vec::new(),
            params_fingerprint: task.node_plan.params_fingerprint.clone(),
            data_model_shape_fingerprint: None,
            aggregation_policy_fingerprint: None,
            seed: task.seed,
            unsafe_flags: BTreeSet::new(),
            metrics: BTreeMap::new(),
            loss_attestations: Vec::new(),
            early_stopping_records: Vec::new(),
        },
    };

    // Malformed: aggregated sample unit `s2` is outside fold:0's validation view {s1}.
    let error = result.validate_for_task(&task).unwrap_err().to_string();
    assert!(
        error.contains("outside its validation view"),
        "unexpected aggregated scope error: {error}"
    );

    // Valid: aggregated sample unit inside the validation view passes unchanged.
    result.aggregated_predictions = vec![aggregated_block("s1")];
    result.validate_for_task(&task).unwrap();
}

// R-P1-6: a controller that emits aggregated predictions itself (bypassing
// native aggregation) must emit them at the node's policy level. A block at a
// different level is rejected before it can be scored against a mismatched
// policy; a matching-level block is accepted.
#[test]
fn controller_emitted_aggregated_block_must_match_policy_level() {
    let model_id = NodeId::new("model:obs").unwrap();
    let graph = GraphSpec {
        id: "graph:agg.policy.level".to_string(),
        interface: GraphInterface::default(),
        nodes: vec![node(
            model_id.as_str(),
            NodeKind::Model,
            vec![port("x", PortKind::Data)],
            vec![port("pred", PortKind::Prediction)],
        )],
        edges: Vec::new(),
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    };
    let mut shape_plans = BTreeMap::new();
    shape_plans.insert(
        model_id.clone(),
        DataModelShapePlan {
            node_id: model_id.clone(),
            input_granularity: Granularity::Sample,
            target_granularity: Granularity::Sample,
            fit_rows: FitBoundary::FoldTrain,
            predict_rows: FitBoundary::FoldValidation,
            feature_namespace: Some("nir".to_string()),
            feature_schema_fingerprint: None,
            target_space: "regression:y".to_string(),
            // Native policy aggregates to GROUP level.
            aggregation_policy: custom_aggregation_policy(PredictionLevel::Group),
            augmentation_policy: Default::default(),
            selection_policy: Default::default(),
        },
    );
    let campaign = CampaignSpec {
        inner_cv: None,
        id: "campaign:agg.policy.level".to_string(),
        root_seed: Some(7),
        leakage_policy: Default::default(),
        aggregation_policy: Default::default(),
        split_invocation: None,
        generation: Default::default(),
        shape_plans,
        data_bindings: BTreeMap::new(),
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    };
    let plan =
        build_execution_plan("plan:agg.policy.level", graph, campaign, &manifests()).unwrap();
    let node_plan = plan.node_plans.get(&model_id).unwrap().clone();
    let task = NodeTask {
        inner_fold_set: None,
        run_id: RunId::new("run:agg.policy.level").unwrap(),
        node_plan: node_plan.clone(),
        phase: Phase::FitCv,
        variant_id: Some(VariantId::new("variant:base").unwrap()),
        variant: None,
        fold_id: None,
        branch_path: Vec::new(),
        input_handles: BTreeMap::new(),
        data_views: BTreeMap::new(),
        prediction_inputs: BTreeMap::new(),
        artifact_inputs: BTreeMap::new(),
        required_loss_attestations: Vec::new(),
        fit_influence: FitInfluenceTask::default(),
        seed: Some(99),
    };
    let controllers = RuntimeControllerRegistry::new();
    let resources = PhaseScopeResources {
        data_provider: None,
        fold_set_override: None,
        node_filter: None,
        suppress_inner_cv: false,
        nested_stacking: None,
        replay_artifact_handles: None,
        replay_artifact_inputs: None,
        replay_bundle_id: None,
        data_envelopes: None,
        prediction_cache_store: None,
        prediction_cache_contracts: None,
        direct_sample_prediction_only: false,
        artifact_store: None,
    };
    let aggregated_block =
        |level: PredictionLevel, unit: PredictionUnitId| AggregatedPredictionBlock {
            prediction_id: Some("pred:agg".to_string()),
            producer_node: model_id.clone(),
            producer_port: None,
            partition: PredictionPartition::Final,
            fold_id: None,
            level,
            unit_ids: vec![unit],
            values: vec![vec![1.0]],
            target_names: vec!["y".to_string()],
        };
    let lineage = LineageRecord {
        record_id: LineageId::new("lineage:agg.policy.level").unwrap(),
        run_id: task.run_id.clone(),
        node_id: task.node_plan.node_id.clone(),
        phase: task.phase,
        controller_id: task.node_plan.controller_id.clone(),
        controller_version: task.node_plan.controller_version.clone(),
        variant_id: task.variant_id.clone(),
        fold_id: task.fold_id.clone(),
        branch_path: task.branch_path.clone(),
        input_lineage: Vec::new(),
        artifact_refs: Vec::new(),
        params_fingerprint: task.node_plan.params_fingerprint.clone(),
        data_model_shape_fingerprint: None,
        aggregation_policy_fingerprint: None,
        seed: task.seed,
        unsafe_flags: BTreeSet::new(),
        metrics: BTreeMap::new(),
        loss_attestations: Vec::new(),
        early_stopping_records: Vec::new(),
    };
    let base_result = |level: PredictionLevel, unit: PredictionUnitId| NodeResult {
        schema_version: None,
        node_id: model_id.clone(),
        outputs: BTreeMap::new(),
        predictions: vec![PredictionBlock {
            prediction_id: Some("pred:sample".to_string()),
            producer_node: model_id.clone(),
            producer_port: None,
            partition: PredictionPartition::Final,
            fold_id: None,
            sample_ids: vec![SampleId::new("s1").unwrap()],
            values: vec![vec![1.0]],
            target_names: vec!["y".to_string()],
        }],
        observation_predictions: Vec::new(),
        aggregated_predictions: vec![aggregated_block(level, unit)],
        explanations: Vec::new(),
        shape_deltas: Vec::new(),
        artifacts: Vec::new(),
        artifact_handles: BTreeMap::new(),
        fit_influence_diagnostics: Vec::new(),
        regression_targets: Vec::new(),
        lineage: lineage.clone(),
    };

    // Malformed: block aggregated at TARGET level but the node policy is GROUP.
    let mut bad = base_result(
        PredictionLevel::Target,
        PredictionUnitId::Target(TargetId::new("target:a").unwrap()),
    );
    let error =
        apply_result_prediction_aggregation(&plan, &controllers, &task, &mut bad, &resources)
            .unwrap_err()
            .to_string();
    assert!(
        error.contains("aggregation policy is")
            && error.contains("Group")
            && error.contains("Target"),
        "unexpected policy-level error: {error}"
    );

    // Valid: block aggregated at the policy GROUP level passes the level gate.
    let mut good = base_result(
        PredictionLevel::Group,
        PredictionUnitId::Group(GroupId::new("group:a").unwrap()),
    );
    apply_result_prediction_aggregation(&plan, &controllers, &task, &mut good, &resources).unwrap();
}

// R-P1-8: a binding that REQUIRES coordinator relations must resolve them. With
// no envelope and no provider the relations are unresolvable, which must be a
// hard error (not a silent empty exclusion set); a provider that supplies the
// relations resolves them unchanged.
#[test]
fn coordinator_relations_required_but_unresolved_is_refused() {
    let model_id = NodeId::new("model:pls").unwrap();
    let mut campaign = oof_edge_campaign();
    campaign.data_bindings = BTreeMap::from([(model_id.clone(), vec![data_binding(&model_id)])]);
    let plan = build_execution_plan(
        "plan:relations.required",
        simple_graph(),
        campaign,
        &manifests(),
    )
    .unwrap();
    let node_plan = plan.node_plans.get(&model_id).unwrap().clone();
    assert!(node_plan.data_bindings.iter().any(|b| b.require_relations));

    // Malformed: relations are required but neither envelope nor provider supplies them.
    let empty_resources = PhaseScopeResources {
        data_provider: None,
        fold_set_override: None,
        node_filter: None,
        suppress_inner_cv: false,
        nested_stacking: None,
        replay_artifact_handles: None,
        replay_artifact_inputs: None,
        replay_bundle_id: None,
        data_envelopes: None,
        prediction_cache_store: None,
        prediction_cache_contracts: None,
        direct_sample_prediction_only: false,
        artifact_store: None,
    };
    let error = coordinator_relations_for_node(&node_plan, &empty_resources)
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("requires coordinator relations but none were resolved"),
        "unexpected unresolved-relations error: {error}"
    );

    // Valid: a provider carrying the binding's relations resolves them.
    let envelope: ExternalDataPlanEnvelope = serde_json::from_str(include_str!(
        "../../tests/fixtures/package/data/coordinator_data_plan_envelope_sample12.json"
    ))
    .unwrap();
    let provider = InMemoryDataProvider::with_envelope(
        ControllerId::new("controller:data.provider").unwrap(),
        envelope,
    )
    .unwrap();
    let provider_resources = PhaseScopeResources {
        data_provider: Some(&provider),
        fold_set_override: None,
        node_filter: None,
        suppress_inner_cv: false,
        nested_stacking: None,
        replay_artifact_handles: None,
        replay_artifact_inputs: None,
        replay_bundle_id: None,
        data_envelopes: None,
        prediction_cache_store: None,
        prediction_cache_contracts: None,
        direct_sample_prediction_only: false,
        artifact_store: None,
    };
    let relations = coordinator_relations_for_node(&node_plan, &provider_resources).unwrap();
    assert!(
        relations.is_some(),
        "expected the provider to supply relations"
    );
}

// R-P1-8: a data view handle is delivered to the controller as a data input, so
// a provider that returns a non-data/data-view handle (e.g. a model handle)
// across the ABI must be refused.
#[test]
fn make_data_view_handle_refuses_non_data_handle_kind() {
    struct WrongKindViewProvider {
        owner: ControllerId,
    }
    impl RuntimeDataProvider for WrongKindViewProvider {
        fn materialize(&self, _request: &DataMaterializationRequest) -> Result<HandleRef> {
            Ok(HandleRef {
                handle: 1,
                kind: HandleKind::Data,
                owner_controller: self.owner.clone(),
            })
        }
        fn make_view(&self, _request: &DataViewRequest) -> Result<HandleRef> {
            // A misbehaving provider hands back a MODEL handle as if it were a view.
            Ok(HandleRef {
                handle: 2,
                kind: HandleKind::Model,
                owner_controller: self.owner.clone(),
            })
        }
    }

    let owner = ControllerId::new("controller:data.provider").unwrap();
    let provider = WrongKindViewProvider {
        owner: owner.clone(),
    };
    let model_id = NodeId::new("model:pls").unwrap();
    let mut campaign = oof_edge_campaign();
    campaign.data_bindings = BTreeMap::from([(model_id.clone(), vec![data_binding(&model_id)])]);
    let plan = build_execution_plan(
        "plan:view.handle.kind",
        simple_graph(),
        campaign,
        &manifests(),
    )
    .unwrap();
    let node_plan = plan.node_plans.get(&model_id).unwrap().clone();
    let binding = node_plan.data_bindings[0].clone();
    let ctx = RunContext::new(RunId::new("run:view.handle.kind").unwrap(), Some(11));
    let scope = PhaseScope {
        phase: Phase::FitCv,
        variant_id: Some(VariantId::new("variant:base").unwrap()),
        variant: None,
        fold_id: Some(FoldId::new("fold:0").unwrap()),
        seed_root: Some(11),
    };
    let data_handle = HandleRef {
        handle: 1,
        kind: HandleKind::Data,
        owner_controller: owner.clone(),
    };
    let view = DataProviderViewSpec {
        sample_ids: Some(vec![SampleId::new("s1").unwrap()]),
        partition: DataRequestPartition::FoldTrain,
        fold_id: Some(FoldId::new("fold:0").unwrap()),
        source_ids: None,
        columns: None,
        include_augmented: false,
        include_excluded: false,
        branch_view: None,
        extra: BTreeMap::new(),
    };
    let error = make_data_view_handle(
        &provider,
        &ctx,
        &node_plan,
        &scope,
        &binding,
        DataViewHandleInput {
            data_handle: &data_handle,
            view: &view,
            predict_cohort: None,
        },
    )
    .unwrap_err()
    .to_string();
    assert!(
        error.contains("non-data/data-view handle kind"),
        "unexpected handle-kind error: {error}"
    );
}

// ADR-26: a top-level PREDICT uses only its separately attested cohort.  It
// must not touch the CV relation authority, even when the binding requires it
// for FIT_CV/REFIT.  The exact cohort also reaches both provider boundaries.
#[test]
fn predict_uses_attested_cohort_without_resolving_cv_relations() {
    struct PredictCohortProbe {
        owner: ControllerId,
        cohort: PredictCohort,
        materialize_calls: std::cell::Cell<usize>,
        make_view_calls: std::cell::Cell<usize>,
        relation_calls: std::cell::Cell<usize>,
    }

    impl RuntimeDataProvider for PredictCohortProbe {
        fn materialize(&self, request: &DataMaterializationRequest) -> Result<HandleRef> {
            self.materialize_calls.set(self.materialize_calls.get() + 1);
            assert_eq!(request.phase, Phase::Predict);
            assert_eq!(request.predict_cohort.as_ref(), Some(&self.cohort));
            Ok(HandleRef {
                handle: 81,
                kind: HandleKind::Data,
                owner_controller: self.owner.clone(),
            })
        }

        fn make_view(&self, request: &DataViewRequest) -> Result<HandleRef> {
            self.make_view_calls.set(self.make_view_calls.get() + 1);
            assert_eq!(request.phase, Phase::Predict);
            assert_eq!(request.predict_cohort.as_ref(), Some(&self.cohort));
            assert_eq!(request.view.partition, DataRequestPartition::Predict);
            assert_eq!(request.view.fold_id, None);
            assert_eq!(
                request.view.sample_ids,
                Some(self.cohort.physical_sample_ids.clone())
            );
            Ok(HandleRef {
                handle: 82,
                kind: HandleKind::DataView,
                owner_controller: self.owner.clone(),
            })
        }

        fn coordinator_relations(
            &self,
            _binding: &crate::data::DataBinding,
        ) -> Result<Option<SampleRelationSet>> {
            self.relation_calls.set(self.relation_calls.get() + 1);
            Err(DagMlError::RuntimeValidation(
                "PREDICT must not resolve CV coordinator relations".to_string(),
            ))
        }

        fn predict_cohort(
            &self,
            _binding: &crate::data::DataBinding,
            phase: Phase,
        ) -> Result<Option<PredictCohort>> {
            assert_eq!(phase, Phase::Predict);
            Ok(Some(self.cohort.clone()))
        }
    }

    let held_out = SampleId::new("heldout:1").unwrap();
    let relations = SampleRelationSet {
        records: vec![crate::relation::SampleRelation::new(
            ObservationId::new("obs:heldout.1").unwrap(),
            held_out.clone(),
        )],
    };
    let relation_fingerprint = relations.fingerprint().unwrap();
    let mut cohort = PredictCohort {
        role: PredictCohortRole::ExternalTest,
        physical_sample_ids: vec![held_out.clone()],
        origin_sample_ids: vec![held_out.clone()],
        target_names: vec!["y".to_string()],
        relation_fingerprint,
        relations,
        data_content_fingerprint: "a".repeat(64),
        target_content_fingerprint: Some("b".repeat(64)),
        cohort_fingerprint: String::new(),
    };
    cohort.cohort_fingerprint = cohort.fingerprint().unwrap();

    let model_id = NodeId::new("model:pls").unwrap();
    let mut campaign = oof_edge_campaign();
    campaign.data_bindings = BTreeMap::from([(model_id.clone(), vec![data_binding(&model_id)])]);
    let plan = build_execution_plan(
        "plan:predict.cohort.only",
        simple_graph(),
        campaign,
        &manifests(),
    )
    .unwrap();
    cohort
        .validate_against_cv_fold_set(plan.fold_set.as_ref().unwrap())
        .unwrap();
    let node_plan = plan.node_plans.get(&model_id).unwrap();
    let provider = PredictCohortProbe {
        owner: ControllerId::new("controller:data.predict-cohort").unwrap(),
        cohort: cohort.clone(),
        materialize_calls: std::cell::Cell::new(0),
        make_view_calls: std::cell::Cell::new(0),
        relation_calls: std::cell::Cell::new(0),
    };
    let resources = PhaseScopeResources {
        data_provider: Some(&provider),
        ..Default::default()
    };
    let ctx = RunContext::new(RunId::new("run:predict.cohort.only").unwrap(), Some(11));
    let collected = collect_input_handles(
        &plan,
        node_plan,
        &BTreeMap::new(),
        &BTreeMap::new(),
        &resources,
        &ctx,
        &PhaseScope {
            phase: Phase::Predict,
            variant_id: Some(VariantId::new("variant:base").unwrap()),
            variant: None,
            fold_id: None,
            seed_root: Some(11),
        },
    )
    .unwrap();

    assert_eq!(provider.materialize_calls.get(), 1);
    assert_eq!(provider.make_view_calls.get(), 1);
    assert_eq!(provider.relation_calls.get(), 0);
    assert_eq!(
        collected.data_views["data:x"].sample_ids,
        Some(vec![held_out])
    );
}

// R-P1-7: a node only sees upstream handles for ports it DECLARES an edge to.
// An extra handle a producer emitted on an undeclared port (which a sibling
// consumer might use) must not leak into this node's input contract; the
// declared port still arrives.
#[test]
fn collect_input_handles_forwards_only_declared_source_ports() {
    let producer = NodeId::new("transform:snv").unwrap();
    let consumer = NodeId::new("model:pls").unwrap();
    let plan = build_execution_plan(
        "plan:declared.ports",
        simple_graph(),
        CampaignSpec {
            inner_cv: None,
            id: "campaign:declared.ports".to_string(),
            root_seed: Some(11),
            leakage_policy: Default::default(),
            aggregation_policy: Default::default(),
            split_invocation: None,
            generation: Default::default(),
            shape_plans: BTreeMap::new(),
            data_bindings: BTreeMap::new(),
            branch_view_plans: Vec::new(),
            metadata: BTreeMap::new(),
        },
        &manifests(),
    )
    .unwrap();
    let node_plan = plan.node_plans.get(&consumer).unwrap().clone();
    let owner = node_plan.controller_id.clone();
    // The producer emitted TWO output handles: the declared `x` (edge to
    // `model:pls.x`) and an undeclared `extra` port no edge references.
    let output_handles = BTreeMap::from([(
        producer.clone(),
        BTreeMap::from([
            (
                "x".to_string(),
                HandleRef {
                    handle: 1,
                    kind: HandleKind::Data,
                    owner_controller: owner.clone(),
                },
            ),
            (
                "extra".to_string(),
                HandleRef {
                    handle: 2,
                    kind: HandleKind::Data,
                    owner_controller: owner.clone(),
                },
            ),
        ]),
    )]);
    let ctx = RunContext::new(RunId::new("run:declared.ports").unwrap(), Some(11));
    let scope = PhaseScope {
        phase: Phase::FitCv,
        variant_id: Some(VariantId::new("variant:base").unwrap()),
        variant: None,
        fold_id: Some(FoldId::new("fold:0").unwrap()),
        seed_root: Some(11),
    };
    let resources = PhaseScopeResources {
        data_provider: None,
        fold_set_override: None,
        node_filter: None,
        suppress_inner_cv: false,
        nested_stacking: None,
        replay_artifact_handles: None,
        replay_artifact_inputs: None,
        replay_bundle_id: None,
        data_envelopes: None,
        prediction_cache_store: None,
        prediction_cache_contracts: None,
        direct_sample_prediction_only: false,
        artifact_store: None,
    };
    let collected = collect_input_handles(
        &plan,
        &node_plan,
        &output_handles,
        &BTreeMap::new(),
        &resources,
        &ctx,
        &scope,
    )
    .unwrap();

    // The declared source port arrives; the undeclared one is filtered out.
    assert!(
        collected.handles.contains_key("transform:snv.x"),
        "declared source port handle missing: {:?}",
        collected.handles.keys().collect::<Vec<_>>()
    );
    assert!(
        !collected.handles.contains_key("transform:snv.extra"),
        "undeclared source port handle leaked: {:?}",
        collected.handles.keys().collect::<Vec<_>>()
    );
}

#[test]
fn collect_input_handles_masks_only_the_exact_oof_source_port_in_training() {
    let plan = build_execution_plan(
        "plan:oof.exact.port.training",
        oof_edge_graph_with_auxiliary_port(),
        oof_edge_campaign(),
        &oof_edge_manifests(BTreeSet::from([Phase::FitCv, Phase::Refit, Phase::Predict])),
    )
    .unwrap();
    let base = NodeId::new("model:base").unwrap();
    let meta = NodeId::new("model:meta").unwrap();
    let node_plan = plan.node_plans.get(&meta).unwrap();
    let owner = ControllerId::new("controller:model").unwrap();
    let raw_prediction = HandleRef {
        handle: 10,
        kind: HandleKind::Prediction,
        owner_controller: owner.clone(),
    };
    let auxiliary = HandleRef {
        handle: 20,
        kind: HandleKind::Artifact,
        owner_controller: owner,
    };
    let output_handles = BTreeMap::from([(
        base.clone(),
        BTreeMap::from([
            ("pred".to_string(), raw_prediction.clone()),
            ("aux".to_string(), auxiliary.clone()),
        ]),
    )]);
    let mut ctx = RunContext::new(RunId::new("run:oof.exact.port.training").unwrap(), Some(11));
    for (fold_id, sample_id, value) in [("fold:0", "s1", 0.25), ("fold:1", "s2", 0.75)] {
        ctx.prediction_store
            .append(PredictionBlock {
                prediction_id: Some(format!("pred:model:base:{fold_id}")),
                producer_node: base.clone(),
                producer_port: None,
                partition: PredictionPartition::Validation,
                fold_id: Some(FoldId::new(fold_id).unwrap()),
                sample_ids: vec![SampleId::new(sample_id).unwrap()],
                values: vec![vec![value]],
                target_names: vec!["y".to_string()],
            })
            .unwrap();
    }

    for (phase, fold_id, expected_samples) in [
        (
            Phase::FitCv,
            Some(FoldId::new("fold:0").unwrap()),
            vec![SampleId::new("s1").unwrap()],
        ),
        (
            Phase::Refit,
            None,
            vec![SampleId::new("s1").unwrap(), SampleId::new("s2").unwrap()],
        ),
    ] {
        let collected = collect_input_handles(
            &plan,
            node_plan,
            &output_handles,
            &BTreeMap::new(),
            &PhaseScopeResources::default(),
            &ctx,
            &PhaseScope {
                phase,
                variant_id: Some(VariantId::new("variant:base").unwrap()),
                variant: None,
                fold_id,
                seed_root: Some(11),
            },
        )
        .unwrap();

        assert_eq!(
            collected.handles.keys().cloned().collect::<BTreeSet<_>>(),
            BTreeSet::from(["model:base.aux".to_string(), "model:base.pred".to_string()]),
            "unexpected inputs in {phase:?}"
        );
        assert_eq!(collected.handles["model:base.aux"], auxiliary);
        assert_ne!(
            collected.handles["model:base.pred"], raw_prediction,
            "the raw OOF source handle leaked in {phase:?}"
        );
        assert_eq!(
            collected.prediction_inputs["model:base.pred"].sample_ids,
            expected_samples
        );
    }
}

#[test]
fn collect_input_handles_predict_uses_only_the_suffixed_off_fold_port() {
    let plan = build_execution_plan(
        "plan:oof.exact.port.predict",
        oof_edge_graph_with_auxiliary_port(),
        oof_edge_campaign(),
        &oof_edge_manifests(BTreeSet::from([Phase::FitCv, Phase::Refit, Phase::Predict])),
    )
    .unwrap();
    let base = NodeId::new("model:base").unwrap();
    let meta = NodeId::new("model:meta").unwrap();
    let node_plan = plan.node_plans.get(&meta).unwrap();
    let owner = ControllerId::new("controller:model").unwrap();
    let raw_prediction = HandleRef {
        handle: 30,
        kind: HandleKind::Prediction,
        owner_controller: owner.clone(),
    };
    let auxiliary = HandleRef {
        handle: 40,
        kind: HandleKind::Artifact,
        owner_controller: owner,
    };
    let output_handles = BTreeMap::from([(
        base.clone(),
        BTreeMap::from([
            ("pred".to_string(), raw_prediction),
            ("aux".to_string(), auxiliary.clone()),
        ]),
    )]);
    let mut ctx = RunContext::new(RunId::new("run:oof.exact.port.predict").unwrap(), Some(11));
    let sample_ids = vec![SampleId::new("s1").unwrap(), SampleId::new("s2").unwrap()];
    let values = vec![vec![0.4], vec![0.6]];
    ctx.prediction_store
        .append(PredictionBlock {
            prediction_id: Some("pred:model:base:final".to_string()),
            producer_node: base,
            producer_port: None,
            partition: PredictionPartition::Final,
            fold_id: None,
            sample_ids: sample_ids.clone(),
            values: values.clone(),
            target_names: vec!["y".to_string()],
        })
        .unwrap();

    let collected = collect_input_handles(
        &plan,
        node_plan,
        &output_handles,
        &BTreeMap::new(),
        &PhaseScopeResources::default(),
        &ctx,
        &PhaseScope {
            phase: Phase::Predict,
            variant_id: Some(VariantId::new("variant:base").unwrap()),
            variant: None,
            fold_id: None,
            seed_root: Some(11),
        },
    )
    .unwrap();

    assert_eq!(
        collected.handles.keys().cloned().collect::<BTreeSet<_>>(),
        BTreeSet::from([
            "model:base.aux".to_string(),
            "model:base.pred:predict".to_string()
        ])
    );
    assert_eq!(collected.handles["model:base.aux"], auxiliary);
    assert!(!collected.handles.contains_key("model:base.pred"));
    assert_eq!(
        collected
            .prediction_inputs
            .keys()
            .cloned()
            .collect::<BTreeSet<_>>(),
        BTreeSet::from(["model:base.pred:predict".to_string()])
    );
    let spec = &collected.prediction_inputs["model:base.pred:predict"];
    assert_eq!(spec.producer_node, NodeId::new("model:base").unwrap());
    assert_eq!(spec.source_port, "pred");
    assert_eq!(spec.target_port, "pred");
    assert_eq!(spec.partition, PredictionPartition::Final);
    assert_eq!(spec.fold_id, None);
    assert!(spec.fold_ids.is_empty());
    assert_eq!(spec.sample_ids, sample_ids);
    assert_eq!(spec.values, values);
    assert_eq!(spec.prediction_width, 1);
    assert_eq!(spec.target_names, vec!["y".to_string()]);
}

fn ambiguous_prediction_source_port_error(
    phase: Phase,
    partition: PredictionPartition,
    fold_id: Option<FoldId>,
    sample_ids: Vec<SampleId>,
    producer_port: Option<&str>,
) -> DagMlError {
    let plan = build_execution_plan(
        format!(
            "plan:oof.ambiguous.port.{}",
            phase.as_str().to_ascii_lowercase()
        ),
        oof_edge_graph_with_ambiguous_prediction_port(),
        oof_edge_campaign(),
        &oof_edge_manifests(BTreeSet::from([Phase::FitCv, Phase::Refit, Phase::Predict])),
    )
    .unwrap();
    let base = NodeId::new("model:base").unwrap();
    let meta = NodeId::new("model:meta").unwrap();
    let owner = ControllerId::new("controller:model").unwrap();
    let output_handles = BTreeMap::from([(
        base.clone(),
        BTreeMap::from([
            (
                "pred".to_string(),
                HandleRef {
                    handle: 50,
                    kind: HandleKind::Prediction,
                    owner_controller: owner.clone(),
                },
            ),
            (
                "aux".to_string(),
                HandleRef {
                    handle: 60,
                    kind: HandleKind::Prediction,
                    owner_controller: owner,
                },
            ),
        ]),
    )]);
    let mut ctx = RunContext::new(
        RunId::new(format!(
            "run:oof.ambiguous.port.{}",
            phase.as_str().to_ascii_lowercase()
        ))
        .unwrap(),
        Some(11),
    );
    // This is the only stored block. When it is tagged as sibling `aux`, the
    // port-aware lookup must not relabel it as edge source `pred`. When the
    // port is absent, the multi-output producer must still fail closed.
    ctx.prediction_store
        .append(PredictionBlock {
            prediction_id: Some("pred:model:base:aux-only".to_string()),
            producer_node: base,
            producer_port: producer_port.map(str::to_string),
            partition,
            fold_id: fold_id.clone(),
            values: vec![vec![0.5]; sample_ids.len()],
            sample_ids,
            target_names: vec!["y".to_string()],
        })
        .unwrap();

    collect_input_handles(
        &plan,
        plan.node_plans.get(&meta).unwrap(),
        &output_handles,
        &BTreeMap::new(),
        &PhaseScopeResources::default(),
        &ctx,
        &PhaseScope {
            phase,
            variant_id: Some(VariantId::new("variant:base").unwrap()),
            variant: None,
            fold_id,
            seed_root: Some(11),
        },
    )
    .err()
    .expect("ambiguous prediction-port provenance must fail closed")
}

#[test]
fn fit_cv_refuses_ambiguous_multi_prediction_source_port() {
    let error = ambiguous_prediction_source_port_error(
        Phase::FitCv,
        PredictionPartition::Validation,
        Some(FoldId::new("fold:0").unwrap()),
        vec![SampleId::new("s1").unwrap()],
        None,
    );

    assert!(matches!(&error, DagMlError::OofValidation(_)));
    let message = error.to_string();
    assert!(message.contains("without producer_port"));
    assert!(message.contains("2 Prediction output ports"));
    assert!(message.contains("[\"aux\", \"pred\"]"));
}

#[test]
fn predict_refuses_sibling_prediction_source_port() {
    let error = ambiguous_prediction_source_port_error(
        Phase::Predict,
        PredictionPartition::Final,
        None,
        vec![SampleId::new("s1").unwrap(), SampleId::new("s2").unwrap()],
        Some("aux"),
    );

    assert!(matches!(&error, DagMlError::OofValidation(_)));
    let message = error.to_string();
    assert!(message.contains("none for source port `pred`"));
}

#[test]
fn in_memory_artifact_store_resolves_bundle_artifacts() {
    let plan = fixture_plan("plan:replay.artifacts");
    let bundle = replay_bundle(&plan);
    let artifact = &bundle.refit_artifacts[0];
    let mut store = InMemoryArtifactStore::new();
    let handle = HandleRef {
        handle: 77,
        kind: HandleKind::Model,
        owner_controller: artifact.controller_id.clone(),
    };
    store.register(artifact, handle.clone()).unwrap();

    let request = ArtifactMaterializationRequest {
        run_id: RunId::new("run:replay.artifacts").unwrap(),
        bundle_id: bundle.bundle_id.clone(),
        node_id: artifact.node_id.clone(),
        phase: Phase::Predict,
        variant_id: bundle.selected_variant_id.clone(),
        controller_id: artifact.controller_id.clone(),
        artifact: artifact.artifact.clone(),
        params_fingerprint: artifact.params_fingerprint.clone(),
        training_loss_fingerprint: artifact.training_loss_fingerprint.clone(),
    };
    let resolved = store.materialize(&request).unwrap();

    assert_eq!(resolved, handle);
    assert_eq!(store.len(), 1);

    let mut wrong_loss = request.clone();
    wrong_loss.training_loss_fingerprint = Some("f".repeat(64));
    assert!(store
        .materialize(&wrong_loss)
        .unwrap_err()
        .to_string()
        .contains("training loss fingerprint"));

    assert!(InMemoryArtifactStore::new().materialize(&request).is_err());
}

#[test]
fn bundle_replay_invokes_predict_with_data_and_refit_artifact_handles() {
    let plan = fixture_plan("plan:replay.predict");
    let bundle = replay_bundle(&plan);
    let request = replay_request(&bundle, Phase::Predict);
    let envelopes = replay_envelopes();
    let provider = replay_data_provider();
    let store = replay_artifact_store(&bundle);
    let controllers = replay_runtime_controllers();
    let mut ctx = RunContext::new(RunId::new("run:replay.predict").unwrap(), Some(11));

    let results = SequentialScheduler
        .execute_bundle_replay(
            BundleReplayExecution {
                plan: &plan,
                bundle: &bundle,
                replay_request: &request,
                prediction_cache_store: None,
                controllers: &controllers,
                data_provider: &provider,
                artifact_store: &store,
                data_envelopes: &envelopes,
            },
            &mut ctx,
        )
        .unwrap();

    assert_eq!(results.len(), 2);
    assert_eq!(provider.handle_records().len(), 1);
    assert_eq!(provider.view_records().len(), 1);
    assert_eq!(
        provider.view_records()[0].view.partition,
        DataRequestPartition::Predict
    );
    assert_eq!(ctx.prediction_store.blocks().len(), 1);
    assert_eq!(
        ctx.prediction_store.blocks()[0].partition,
        PredictionPartition::Final
    );
    assert!(ctx
        .lineage
        .records()
        .any(|record| record.node_id.as_str() == "model:base"
            && record.phase == Phase::Predict
            && record.variant_id == bundle.selected_variant_id));

    let provider = replay_data_provider();
    let mut ctx = RunContext::new(RunId::new("run:parallel.replay.predict").unwrap(), Some(11));
    let results = ParallelScheduler::new(2)
        .unwrap()
        .execute_bundle_replay(
            BundleReplayExecution {
                plan: &plan,
                bundle: &bundle,
                replay_request: &request,
                prediction_cache_store: None,
                controllers: &controllers,
                data_provider: &provider,
                artifact_store: &store,
                data_envelopes: &envelopes,
            },
            &mut ctx,
        )
        .unwrap();

    assert_eq!(results.len(), 2);
    assert_eq!(provider.handle_records().len(), 1);
    assert_eq!(provider.view_records().len(), 1);
    assert_eq!(
        provider.view_records()[0].view.partition,
        DataRequestPartition::Predict
    );
    assert_eq!(ctx.prediction_store.blocks().len(), 1);
}

#[test]
fn bundle_replay_rejects_missing_artifact_unsupported_phase_and_bad_envelope() {
    let plan = fixture_plan("plan:replay.reject");
    let bundle = replay_bundle(&plan);
    let request = replay_request(&bundle, Phase::Predict);
    let envelopes = replay_envelopes();
    let provider = replay_data_provider();
    let controllers = replay_runtime_controllers();
    let mut ctx = RunContext::new(RunId::new("run:replay.reject").unwrap(), Some(11));

    assert!(SequentialScheduler
        .execute_bundle_replay(
            BundleReplayExecution {
                plan: &plan,
                bundle: &bundle,
                replay_request: &request,
                prediction_cache_store: None,
                controllers: &controllers,
                data_provider: &provider,
                artifact_store: &InMemoryArtifactStore::new(),
                data_envelopes: &envelopes,
            },
            &mut ctx,
        )
        .is_err());

    let store = replay_artifact_store(&bundle);
    assert!(SequentialScheduler
        .execute_bundle_replay(
            BundleReplayExecution {
                plan: &plan,
                bundle: &bundle,
                replay_request: &replay_request(&bundle, Phase::FitCv),
                prediction_cache_store: None,
                controllers: &controllers,
                data_provider: &provider,
                artifact_store: &store,
                data_envelopes: &envelopes,
            },
            &mut ctx,
        )
        .is_err());

    let mut bad_envelopes = replay_envelopes();
    bad_envelopes
        .get_mut("model:base.x")
        .unwrap()
        .schema_fingerprint = "0".repeat(64);
    assert!(SequentialScheduler
        .execute_bundle_replay(
            BundleReplayExecution {
                plan: &plan,
                bundle: &bundle,
                replay_request: &request,
                prediction_cache_store: None,
                controllers: &controllers,
                data_provider: &provider,
                artifact_store: &store,
                data_envelopes: &bad_envelopes,
            },
            &mut ctx,
        )
        .is_err());
}

#[test]
fn fit_cv_node_with_inner_cv_carries_inner_fold_set_subset_of_outer_train() {
    use crate::fold::{KFoldSpec, NestedCvSpec};
    use crate::ids::SampleId;

    // Reuse a real plan's campaign + a node plan, but drive nesting with a fresh
    // outer fold set that has enough train samples for an inner KFold.
    let plan = live_group_oof_runtime_plan();
    let mut campaign = plan.campaign.clone();
    let node_plan = plan
        .node_plans
        .values()
        .next()
        .expect("plan has at least one node")
        .clone();
    assert!(
        node_plan.inner_cv.is_none(),
        "node falls back to campaign default"
    );

    let samples = ["s1", "s2", "s3", "s4"]
        .into_iter()
        .map(|s| SampleId::new(s).unwrap())
        .collect::<Vec<_>>();
    let outer = KFoldSpec {
        n_splits: 2,
        shuffle: false,
        seed: Some(0),
    }
    .split("outer", &samples)
    .unwrap();
    let outer_fold = outer.folds[0].clone();
    let fit_scope = PhaseScope {
        phase: Phase::FitCv,
        variant_id: None,
        variant: None,
        fold_id: Some(outer_fold.fold_id.clone()),
        seed_root: None,
    };

    // With a campaign-level inner CV and no node override, the node gets an inner
    // fold set built from this outer fold's TRAIN samples (⊆ outer-train).
    campaign.inner_cv = Some(NestedCvSpec::KFold(KFoldSpec {
        n_splits: 2,
        shuffle: false,
        seed: Some(1),
    }));
    let inner = inner_fold_set_for_scope(&campaign, Some(&outer), &node_plan, &fit_scope)
        .expect("inner fold set builds")
        .expect("inner fold set present for FIT_CV node with inner_cv");
    let outer_train = outer_fold
        .train_sample_ids
        .iter()
        .collect::<std::collections::BTreeSet<_>>();
    for sample_id in &inner.sample_ids {
        assert!(
            outer_train.contains(sample_id),
            "inner sample escapes outer-train"
        );
    }
    assert_eq!(
        inner
            .sample_ids
            .iter()
            .collect::<std::collections::BTreeSet<_>>(),
        outer_train
    );

    // No effective inner CV → no inner fold set.
    campaign.inner_cv = None;
    assert!(
        inner_fold_set_for_scope(&campaign, Some(&outer), &node_plan, &fit_scope)
            .unwrap()
            .is_none()
    );

    // Non-FIT_CV phases never carry an inner fold set, even with inner_cv declared.
    campaign.inner_cv = Some(NestedCvSpec::KFold(KFoldSpec {
        n_splits: 2,
        shuffle: false,
        seed: Some(1),
    }));
    let predict_scope = PhaseScope {
        phase: Phase::Predict,
        variant_id: None,
        variant: None,
        fold_id: None,
        seed_root: None,
    };
    assert!(
        inner_fold_set_for_scope(&campaign, Some(&outer), &node_plan, &predict_scope)
            .unwrap()
            .is_none()
    );
}

fn nested_stacking_test_plan(outer: FoldSet, partitioned_refit_oof: bool) -> ExecutionPlan {
    use crate::fold::{KFoldSpec, NestedCvSpec};
    let mut campaign = oof_edge_campaign();
    campaign.inner_cv = Some(NestedCvSpec::KFold(KFoldSpec {
        n_splits: 2,
        shuffle: false,
        seed: Some(13),
    }));
    campaign.split_invocation.as_mut().unwrap().fold_set = Some(outer.clone());

    let meta_id = NodeId::new("model:meta").unwrap();
    let base_a = NodeId::new("model:base.a").unwrap();
    let base_b = NodeId::new("model:base.b").unwrap();
    let mut meta = node(
        meta_id.as_str(),
        NodeKind::Model,
        vec![
            port("a", PortKind::Prediction),
            port("b", PortKind::Prediction),
        ],
        vec![port("pred", PortKind::Prediction)],
    );
    meta.metadata.insert(
        NESTED_STACKING_EXECUTION_METADATA_KEY.to_string(),
        json!(NESTED_STACKING_EXECUTION_V1),
    );
    if partitioned_refit_oof {
        meta.metadata.insert(
            STACKING_REFIT_OOF_METADATA_KEY.to_string(),
            json!(STACKING_REFIT_PARTITIONED_INNER_V1),
        );
    }
    let graph = GraphSpec {
        id: "graph:nested.stacking.plan".to_string(),
        interface: GraphInterface::default(),
        nodes: vec![
            node(
                base_a.as_str(),
                NodeKind::Model,
                Vec::new(),
                vec![port("pred", PortKind::Prediction)],
            ),
            node(
                base_b.as_str(),
                NodeKind::Model,
                Vec::new(),
                vec![port("pred", PortKind::Prediction)],
            ),
            meta,
        ],
        edges: vec![
            EdgeSpec {
                source: PortRef {
                    node_id: base_a.clone(),
                    port_name: "pred".to_string(),
                },
                target: PortRef {
                    node_id: meta_id.clone(),
                    port_name: "a".to_string(),
                },
                contract: EdgeContract {
                    requires_oof: true,
                    requires_fold_alignment: true,
                    ..EdgeContract::new(PortKind::Prediction, None)
                },
            },
            EdgeSpec {
                source: PortRef {
                    node_id: base_b.clone(),
                    port_name: "pred".to_string(),
                },
                target: PortRef {
                    node_id: meta_id.clone(),
                    port_name: "b".to_string(),
                },
                contract: EdgeContract {
                    requires_oof: true,
                    requires_fold_alignment: true,
                    ..EdgeContract::new(PortKind::Prediction, None)
                },
            },
        ],
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    };
    build_execution_plan("plan:nested.stacking", graph, campaign, &manifests()).unwrap()
}

#[test]
fn nested_stacking_campaign_requires_explicit_marker_and_parent_bound_inner_oof() {
    use crate::fold::KFoldSpec;
    let samples = (1..=6)
        .map(|index| SampleId::new(format!("s{index}")).unwrap())
        .collect::<Vec<_>>();
    let outer = KFoldSpec {
        n_splits: 3,
        shuffle: false,
        seed: Some(7),
    }
    .split("outer", &samples)
    .unwrap();
    let plan = nested_stacking_test_plan(outer.clone(), false);
    let meta_id = NodeId::new("model:meta").unwrap();
    let base_a = NodeId::new("model:base.a").unwrap();
    let base_b = NodeId::new("model:base.b").unwrap();
    let nested = nested_stacking_campaign_plan(&plan)
        .unwrap()
        .expect("explicit nested marker produces a campaign plan");
    assert_eq!(nested.meta_node_id, meta_id.clone());
    assert_eq!(
        nested.base_node_ids,
        BTreeSet::from([base_a.clone(), base_b.clone()])
    );
    assert_eq!(nested.outer_scopes.len(), 3);
    assert!(
        nested.refit_fold_set.is_none(),
        "existing KFold execution remains unchanged"
    );
    for scope in &nested.outer_scopes {
        let parent = outer
            .folds
            .iter()
            .find(|fold| fold.fold_id == scope.outer_fold_id)
            .unwrap();
        scope.inner.validate_for_outer(parent).unwrap();
    }

    // The scheduler-side input replacement is the non-leakage boundary: base
    // inner folds become the unsuffixed fit matrix, while outer validation is
    // retained only under `:outer` for the meta-model prediction call.
    let selected_outer = &nested.outer_scopes[0];
    let scope = PhaseScope {
        phase: Phase::FitCv,
        variant_id: Some(plan.variants[0].variant_id.clone()),
        variant: Some(VariantExecutionSpec::from_plan(&plan.variants[0])),
        fold_id: Some(selected_outer.outer_fold_id.clone()),
        seed_root: Some(11),
    };
    let mut ctx = RunContext::new(RunId::new("run:nested.stacking.inputs").unwrap(), Some(11));
    let meta_plan = plan.node_plans.get(&meta_id).unwrap();
    let mut handles = BTreeMap::new();
    let mut prediction_inputs = BTreeMap::new();
    for source in [&base_a, &base_b] {
        let edge = plan
            .graph_plan
            .graph
            .edges
            .iter()
            .find(|edge| edge.source.node_id == *source)
            .unwrap();
        for inner_fold in &selected_outer.inner.inner_fold_set.folds {
            ctx.prediction_store
                .append(PredictionBlock {
                    prediction_id: Some(format!("pred:{source}:{}", inner_fold.fold_id)),
                    producer_node: source.clone(),
                    producer_port: Some("pred".to_string()),
                    partition: PredictionPartition::Validation,
                    fold_id: Some(inner_fold.fold_id.clone()),
                    sample_ids: inner_fold.validation_sample_ids.clone(),
                    values: vec![vec![1.0]; inner_fold.validation_sample_ids.len()],
                    target_names: vec!["y".to_string()],
                })
                .unwrap();
        }
        let parent = outer
            .folds
            .iter()
            .find(|fold| fold.fold_id == selected_outer.outer_fold_id)
            .unwrap();
        ctx.prediction_store
            .append(PredictionBlock {
                prediction_id: Some(format!("pred:{source}:{}", parent.fold_id)),
                producer_node: source.clone(),
                producer_port: Some("pred".to_string()),
                partition: PredictionPartition::Validation,
                fold_id: Some(parent.fold_id.clone()),
                sample_ids: parent.validation_sample_ids.clone(),
                values: vec![vec![2.0]; parent.validation_sample_ids.len()],
                target_names: vec!["y".to_string()],
            })
            .unwrap();
        let outer_blocks = ctx.prediction_store.find(
            Some(source),
            Some(&PredictionPartition::Validation),
            Some(&parent.fold_id),
        );
        let outer_spec = prediction_input_spec(edge, &scope, &outer_blocks, false).unwrap();
        let key = format!("{source}.pred");
        prediction_inputs.insert(key.clone(), outer_spec);
        handles.insert(
            key,
            HandleRef {
                handle: 42,
                kind: HandleKind::Prediction,
                owner_controller: ControllerId::new("controller:model").unwrap(),
            },
        );
    }
    replace_nested_stacking_fit_cv_inputs(
        &plan,
        meta_plan,
        &ctx,
        &scope,
        &NestedStackingInput {
            meta_node_id: &meta_id,
            inner: &selected_outer.inner,
        },
        &mut handles,
        &mut prediction_inputs,
    )
    .unwrap();
    let parent = outer
        .folds
        .iter()
        .find(|fold| fold.fold_id == selected_outer.outer_fold_id)
        .unwrap();
    for source in [&base_a, &base_b] {
        let inner = prediction_inputs.get(&format!("{source}.pred")).unwrap();
        let outer = prediction_inputs
            .get(&format!("{source}.pred:outer"))
            .unwrap();
        assert_eq!(
            inner.sample_ids, parent.train_sample_ids,
            "inner OOF covers exactly outer training rows"
        );
        assert_eq!(outer.sample_ids, parent.validation_sample_ids);
        assert!(
            inner
                .sample_ids
                .iter()
                .all(|sample| !outer.sample_ids.contains(sample)),
            "a meta training row cannot be an outer evaluation row"
        );
    }
}

#[test]
fn nested_stacking_resampled_refit_has_separate_exact_partitioned_oof() {
    use crate::fold::KFoldSpec;
    let samples = (1..=6)
        .map(|i| SampleId::new(format!("s{i}")).unwrap())
        .collect::<Vec<_>>();
    let mut outer = KFoldSpec {
        n_splits: 3,
        shuffle: false,
        seed: Some(7),
    }
    .split("outer", &samples)
    .unwrap();
    outer.folds.pop(); // Two samples have never been validated externally.
    let mut repeated = outer.folds[0].clone();
    repeated.fold_id = FoldId::new("repeat0").unwrap();
    outer.folds.push(repeated); // Two others have multiple external occurrences.
    outer.partition_mode = FoldPartitionMode::Resampled;
    outer.validate().unwrap();
    let ordinary = nested_stacking_test_plan(outer.clone(), false);
    let plan = nested_stacking_test_plan(outer.clone(), true);
    assert_ne!(
        ordinary.graph_fingerprint, plan.graph_fingerprint,
        "explicit refit policy is fingerprinted"
    );
    let nested = nested_stacking_campaign_plan(&plan).unwrap().unwrap();
    for scope in &nested.outer_scopes {
        let parent = outer
            .folds
            .iter()
            .find(|fold| fold.fold_id == scope.outer_fold_id)
            .unwrap();
        scope.inner.validate_for_outer(parent).unwrap();
    }
    let refit = nested.refit_fold_set.unwrap();
    assert_eq!(refit.partition_mode, FoldPartitionMode::Partition);
    assert_eq!(refit.sample_ids, samples);
    let mut seen = BTreeSet::new();
    for fold in &refit.folds {
        assert!(fold.fold_id.as_str().starts_with("stacking.refit.inner."));
        for id in &fold.validation_sample_ids {
            assert!(
                seen.insert(id.clone()),
                "exactly one REFIT OOF contribution per sample"
            );
            assert!(!fold.train_sample_ids.contains(id));
        }
    }
    assert_eq!(seen, samples.into_iter().collect());
    assert_eq!(
        refit,
        nested_stacking_campaign_plan(&plan)
            .unwrap()
            .unwrap()
            .refit_fold_set
            .unwrap()
    );

    let source = NodeId::new("model:base.a").unwrap();
    let edge = plan
        .graph_plan
        .graph
        .edges
        .iter()
        .find(|edge| edge.source.node_id == source)
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:resampled.refit").unwrap(), Some(11));
    for (folds, value) in [(&outer.folds, 100.0), (&refit.folds, 1.0)] {
        for fold in folds {
            ctx.prediction_store
                .append(PredictionBlock {
                    prediction_id: Some(format!("pred:{}", fold.fold_id)),
                    producer_node: source.clone(),
                    producer_port: Some("pred".to_string()),
                    partition: PredictionPartition::Validation,
                    fold_id: Some(fold.fold_id.clone()),
                    sample_ids: fold.validation_sample_ids.clone(),
                    values: vec![vec![value]; fold.validation_sample_ids.len()],
                    target_names: vec!["y".to_string()],
                })
                .unwrap();
        }
    }
    let selected = validate_refit_oof_edge(&plan, edge, &ctx).unwrap().unwrap();
    assert_eq!(selected.len(), refit.folds.len());
    assert!(selected
        .iter()
        .all(|block| block.values.iter().all(|row| row == &[1.0])));
    let scope = PhaseScope {
        phase: Phase::Refit,
        variant_id: None,
        variant: None,
        fold_id: None,
        seed_root: Some(11),
    };
    let joined = prediction_input_spec(edge, &scope, &selected, false).unwrap();
    assert_eq!(joined.sample_ids, refit.sample_ids);
    assert_eq!(joined.values, vec![vec![1.0]; refit.sample_ids.len()]);

    let empty = RunContext::new(RunId::new("run:missing.refit.oof").unwrap(), Some(11));
    assert!(
        validate_refit_oof_edge(&plan, edge, &empty).is_err(),
        "no imputed or train predictions accepted"
    );
    // Scope BOTH predictions and target records. Preparation covers samples
    // absent from the resampled evaluation union and must not widen its truth
    // universe (nor contaminate the outer scores with its different values).
    ctx.validation_scoring_fold_ids = Some(
        outer
            .folds
            .iter()
            .map(|fold| fold.fold_id.clone())
            .collect(),
    );
    for block in ctx.prediction_store.blocks() {
        ctx.regression_target_records
            .push(crate::metrics::RegressionTargetRecord {
                producer_node: source.clone(),
                producer_port: Some("pred".to_string()),
                variant_id: None,
                partition: PredictionPartition::Validation,
                fold_id: block.fold_id.clone(),
                block: crate::metrics::RegressionTargetBlock {
                    level: crate::policy::PredictionLevel::Sample,
                    unit_ids: block
                        .sample_ids
                        .iter()
                        .cloned()
                        .map(crate::aggregation::PredictionUnitId::Sample)
                        .collect(),
                    values: block.values.clone(),
                    target_names: vec!["y".to_string()],
                },
            });
    }
    ctx.collect_cross_fold_validation_scores(FoldPartitionMode::Resampled)
        .unwrap();
    assert_eq!(ctx.oof_average_blocks.len(), 1);
    assert_eq!(ctx.oof_average_blocks[0].predictions.unit_ids.len(), 4);
    assert_eq!(
        ctx.oof_average_blocks[0].predictions.values,
        vec![vec![100.0]; 4]
    );
    assert_eq!(
        ctx.oof_average_blocks[0].y_true.values,
        vec![vec![100.0]; 4]
    );
}

#[test]
fn native_scoring_collects_reports_and_builds_score_set() {
    use crate::aggregation::PredictionUnitId;
    use crate::ids::SampleId;
    use crate::metrics::RegressionTargetBlock;
    use crate::policy::PredictionLevel;

    let node = NodeId::new("model:pls").unwrap();
    let predictions = PredictionBlock {
        prediction_id: None,
        producer_node: node.clone(),
        producer_port: Some("pred".to_string()),
        partition: PredictionPartition::Validation,
        fold_id: None,
        sample_ids: vec![SampleId::new("s1").unwrap(), SampleId::new("s2").unwrap()],
        values: vec![vec![2.0], vec![4.0]],
        target_names: vec!["y".to_string()],
    };
    let targets = RegressionTargetBlock {
        level: PredictionLevel::Sample,
        unit_ids: vec![
            PredictionUnitId::Sample(SampleId::new("s1").unwrap()),
            PredictionUnitId::Sample(SampleId::new("s2").unwrap()),
        ],
        values: vec![vec![2.0], vec![4.0]],
        target_names: vec!["y".to_string()],
    };
    let make = |regression_targets: Vec<RegressionTargetBlock>| NodeResult {
        schema_version: None,
        node_id: node.clone(),
        outputs: BTreeMap::new(),
        predictions: vec![predictions.clone()],
        observation_predictions: Vec::new(),
        aggregated_predictions: Vec::new(),
        explanations: Vec::new(),
        shape_deltas: Vec::new(),
        artifacts: Vec::new(),
        artifact_handles: BTreeMap::new(),
        fit_influence_diagnostics: Vec::new(),
        regression_targets,
        lineage: LineageRecord {
            record_id: LineageId::new("lineage:t").unwrap(),
            run_id: RunId::new("run:t").unwrap(),
            node_id: node.clone(),
            phase: Phase::FitCv,
            controller_id: ControllerId::new("controller:pls").unwrap(),
            controller_version: "1".to_string(),
            variant_id: None,
            fold_id: None,
            branch_path: Vec::new(),
            input_lineage: Vec::new(),
            artifact_refs: Vec::new(),
            params_fingerprint: "fp".to_string(),
            data_model_shape_fingerprint: None,
            aggregation_policy_fingerprint: None,
            seed: None,
            unsafe_flags: BTreeSet::new(),
            metrics: BTreeMap::new(),
            loss_attestations: Vec::new(),
            early_stopping_records: Vec::new(),
        },
    };

    // Targets present -> the result is scored natively and collectable into a ScoreSet.
    let mut ctx = RunContext::new(RunId::new("run:t").unwrap(), None);
    apply_result_scoring(
        &make(vec![targets]),
        &mut ctx.score_collector,
        &mut ctx.regression_target_records,
    )
    .unwrap();
    assert_eq!(ctx.score_collector.len(), 1);
    assert_eq!(ctx.regression_target_records.len(), 1);
    assert!(ctx.score_collector[0].metrics.contains_key("rmse"));
    let set = ctx
        .build_score_set("plan:t", Some("rmse".to_string()))
        .unwrap();
    assert_eq!(set.reports.len(), 1);
    set.validate().unwrap();

    // No targets -> nothing collected, no ScoreSet (existing runs are unaffected).
    let mut empty = RunContext::new(RunId::new("run:t").unwrap(), None);
    apply_result_scoring(
        &make(Vec::new()),
        &mut empty.score_collector,
        &mut empty.regression_target_records,
    )
    .unwrap();
    assert!(empty.score_collector.is_empty());
    assert!(empty.build_score_set("plan:t", None).is_none());
}

#[test]
fn cross_fold_validation_reports_scores_the_oof_average() {
    use crate::aggregation::PredictionUnitId;
    use crate::ids::SampleId;
    use crate::metrics::{
        cross_fold_validation_reports, RegressionTargetBlock, RegressionTargetRecord,
    };
    use crate::policy::PredictionLevel;

    let node = NodeId::new("model:pls").unwrap();
    let pred = |fold: &str, rows: &[(&str, f64)]| PredictionBlock {
        prediction_id: None,
        producer_node: node.clone(),
        producer_port: None,
        partition: PredictionPartition::Validation,
        fold_id: Some(FoldId::new(fold).unwrap()),
        sample_ids: rows
            .iter()
            .map(|(s, _)| SampleId::new(*s).unwrap())
            .collect(),
        values: rows.iter().map(|(_, v)| vec![*v]).collect(),
        target_names: vec!["y".to_string()],
    };
    let record = |fold: &str, rows: &[(&str, f64)]| RegressionTargetRecord {
        producer_node: node.clone(),
        producer_port: None,
        variant_id: None,
        partition: PredictionPartition::Validation,
        fold_id: Some(FoldId::new(fold).unwrap()),
        block: RegressionTargetBlock {
            level: PredictionLevel::Sample,
            unit_ids: rows
                .iter()
                .map(|(s, _)| PredictionUnitId::Sample(SampleId::new(*s).unwrap()))
                .collect(),
            values: rows.iter().map(|(_, v)| vec![*v]).collect(),
            target_names: vec!["y".to_string()],
        },
    };

    // Two disjoint folds -> OOF concat scored over all 4 samples; residual only on s4 (5 vs 4).
    let blocks = [
        pred("fold0", &[("s1", 1.0), ("s2", 2.0)]),
        pred("fold1", &[("s3", 3.0), ("s4", 5.0)]),
    ];
    let records = [
        record("fold0", &[("s1", 1.0), ("s2", 2.0)]),
        record("fold1", &[("s3", 3.0), ("s4", 4.0)]),
    ];
    let outcome = cross_fold_validation_reports(
        &blocks,
        &records,
        SCORE_METRICS,
        FoldPartitionMode::Partition,
    )
    .unwrap();
    let reports = &outcome.reports;
    assert_eq!(reports.len(), 1);
    assert_eq!(reports[0].fold_id, Some(FoldId::new("avg").unwrap()));
    assert_eq!(reports[0].partition, PredictionPartition::Validation);
    assert_eq!(reports[0].row_count, 4);
    assert!((reports[0].metrics["rmse"] - 0.5).abs() < 1e-9); // sqrt((0+0+0+1)/4)

    // Additive per-sample OOF average surface: one block, keyed identically to the scalar report
    // (Validation / avg), pooled per-sample values + a y_true row per averaged sample (same id set).
    assert_eq!(outcome.oof_averages.len(), 1);
    let oof = &outcome.oof_averages[0];
    assert_eq!(oof.predictions.partition, PredictionPartition::Validation);
    assert_eq!(oof.predictions.fold_id, Some(FoldId::new("avg").unwrap()));
    assert_eq!(oof.predictions.level, PredictionLevel::Sample);
    assert_eq!(oof.predictions.unit_ids.len(), 4);
    assert_eq!(oof.y_true.unit_ids, oof.predictions.unit_ids);
}

#[test]
fn cross_fold_validation_reports_rejects_cross_variant_mixed_oof() {
    // R-P0-1 scoring-path guard: a producer whose two "fold" blocks both claim sample s1 (the
    // signature of two variants accumulated in one context, since PredictionBlock has no variant tag)
    // must be REFUSED rather than silently averaged into one cv score. Without the guard,
    // `reduce_predictions_across_folds` would average the two s1 rows and mix the variants.
    use crate::ids::SampleId;

    let node = NodeId::new("model:pls").unwrap();
    let pred = |fold: &str, rows: &[(&str, f64)]| PredictionBlock {
        prediction_id: None,
        producer_node: node.clone(),
        producer_port: None,
        partition: PredictionPartition::Validation,
        fold_id: Some(FoldId::new(fold).unwrap()),
        sample_ids: rows
            .iter()
            .map(|(s, _)| SampleId::new(*s).unwrap())
            .collect(),
        values: rows.iter().map(|(_, v)| vec![*v]).collect(),
        target_names: vec!["y".to_string()],
    };
    // Both blocks claim s1 -> non-unique OOF for this producer.
    let blocks = [
        pred("fold0", &[("s1", 1.0), ("s2", 2.0)]),
        pred("fold1", &[("s1", 9.0), ("s3", 3.0)]),
    ];
    let err =
        cross_fold_validation_reports(&blocks, &[], SCORE_METRICS, FoldPartitionMode::Partition)
            .unwrap_err();
    assert!(
        err.to_string().contains("not unique")
            && err.to_string().contains("mixed several variants"),
        "got: {err}"
    );
}

#[test]
fn combine_validation_targets_rejects_conflicting_ground_truth() {
    // R-P0-1 target-recombination guard: two validation records for the same producer disagree on
    // s1's y_true (4.0 vs 5.0) — the ground-truth reference was mixed (e.g. two variants in one
    // context). Scoring against a corrupted reference is refused. (Exercised through the public
    // `cross_fold_validation_reports`, which calls `combine_validation_targets`.)
    use crate::aggregation::PredictionUnitId;
    use crate::ids::SampleId;
    use crate::metrics::{RegressionTargetBlock, RegressionTargetRecord};

    let node = NodeId::new("model:pls").unwrap();
    let pred = |fold: &str, rows: &[(&str, f64)]| PredictionBlock {
        prediction_id: None,
        producer_node: node.clone(),
        producer_port: None,
        partition: PredictionPartition::Validation,
        fold_id: Some(FoldId::new(fold).unwrap()),
        sample_ids: rows
            .iter()
            .map(|(s, _)| SampleId::new(*s).unwrap())
            .collect(),
        values: rows.iter().map(|(_, v)| vec![*v]).collect(),
        target_names: vec!["y".to_string()],
    };
    let record = |fold: &str, rows: &[(&str, f64)]| RegressionTargetRecord {
        producer_node: node.clone(),
        producer_port: None,
        variant_id: None,
        partition: PredictionPartition::Validation,
        fold_id: Some(FoldId::new(fold).unwrap()),
        block: RegressionTargetBlock {
            level: PredictionLevel::Sample,
            unit_ids: rows
                .iter()
                .map(|(s, _)| PredictionUnitId::Sample(SampleId::new(*s).unwrap()))
                .collect(),
            values: rows.iter().map(|(_, v)| vec![*v]).collect(),
            target_names: vec!["y".to_string()],
        },
    };
    // Predictions are unique (s1, s2) so they pass the coverage gate; the y_true records conflict.
    let blocks = [pred("fold0", &[("s1", 1.0)]), pred("fold1", &[("s2", 2.0)])];
    let records = [
        record("fold0", &[("s1", 4.0)]),
        record("fold1", &[("s1", 5.0), ("s2", 2.0)]),
    ];
    let err = cross_fold_validation_reports(
        &blocks,
        &records,
        SCORE_METRICS,
        FoldPartitionMode::Partition,
    )
    .unwrap_err();
    assert!(
        err.to_string().contains("conflicting ground truth"),
        "got: {err}"
    );
}

/// Model controller for the native-variant-SELECT test. For each FIT_CV fold it emits one VALIDATION
/// prediction plus (when `emit_targets`) the matching `y_true`, keyed by `fold_id` (fold:0 -> s1,
/// fold:1 -> s2). The predicted value is `y_true + offset`, where `offset` is read from the variant's
/// `n_components` param override — so different variants yield different OOF residuals (hence different
/// OOF RMSE). With `emit_targets = false` the OOF predictions are still well-formed and disjoint across
/// folds, but no ground truth is emitted, so native scoring is genuinely off.
struct VariantScoringController {
    id: ControllerId,
    handle: u64,
    emit_targets: bool,
}

impl VariantScoringController {
    fn fold_sample(task: &NodeTask) -> Option<(SampleId, f64)> {
        // (validation sample, its y_true) per fold of `two_fold_set`.
        match task.fold_id.as_ref()?.as_str() {
            "fold:0" => Some((SampleId::new("s1").unwrap(), 1.0)),
            "fold:1" => Some((SampleId::new("s2").unwrap(), 2.0)),
            _ => None,
        }
    }
}

impl RuntimeController for VariantScoringController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        let output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Data,
            owner_controller: self.id.clone(),
        };
        let mut predictions = Vec::new();
        let mut regression_targets = Vec::new();
        if let Some((sample_id, y_true)) = Self::fold_sample(task) {
            // Prediction = y_true + offset(variant). offset is the variant's `n_components` override.
            let offset = task
                .node_plan
                .params
                .get("n_components")
                .and_then(serde_json::Value::as_f64)
                .unwrap_or(0.0);
            predictions.push(PredictionBlock {
                prediction_id: Some(format!("pred:{}", task.node_plan.node_id)),
                producer_node: task.node_plan.node_id.clone(),
                producer_port: None,
                partition: PredictionPartition::Validation,
                fold_id: task.fold_id.clone(),
                sample_ids: vec![sample_id.clone()],
                values: vec![vec![y_true + offset]],
                target_names: vec!["y".to_string()],
            });
            if self.emit_targets {
                regression_targets.push(crate::metrics::RegressionTargetBlock {
                    level: PredictionLevel::Sample,
                    unit_ids: vec![crate::aggregation::PredictionUnitId::Sample(sample_id)],
                    values: vec![vec![y_true]],
                    target_names: vec!["y".to_string()],
                });
            }
        }
        let variant_label = task
            .variant_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "base".to_string());
        let fold_label = task
            .fold_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "nofold".to_string());
        Ok(NodeResult {
            schema_version: None,
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([("pred".to_string(), output)]),
            predictions,
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets,
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:{}:{:?}:{variant_label}:{fold_label}",
                    task.node_plan.node_id, task.phase
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
                input_lineage: Vec::new(),
                artifact_refs: Vec::new(),
                params_fingerprint: task.node_plan.params_fingerprint.clone(),
                data_model_shape_fingerprint: None,
                aggregation_policy_fingerprint: None,
                seed: task.seed,
                unsafe_flags: BTreeSet::new(),
                metrics: BTreeMap::new(),
                loss_attestations: Vec::new(),
                early_stopping_records: Vec::new(),
            },
        })
    }
}

fn variant_scoring_campaign(offsets: Vec<(&str, f64)>) -> CampaignSpec {
    let choices = offsets
        .into_iter()
        .map(|(label, offset)| GenerationChoice {
            label: label.to_string(),
            value: json!(label),
            param_overrides: vec![crate::generation::GenerationParamOverride {
                node_id: NodeId::new("model:pls").unwrap(),
                params: BTreeMap::from([("n_components".to_string(), json!(offset))]),
            }],
            active_subsequence: None,
        })
        .collect::<Vec<_>>();
    let max_variants = Some(choices.len());
    CampaignSpec {
        inner_cv: None,
        id: "campaign:variant.select".to_string(),
        root_seed: Some(7),
        leakage_policy: Default::default(),
        aggregation_policy: Default::default(),
        split_invocation: Some(SplitInvocation {
            id: "split:outer".to_string(),
            controller_id: None,
            leakage_policy: Default::default(),
            params: BTreeMap::new(),
            fold_set: Some(two_fold_set()),
        }),
        generation: GenerationSpec {
            strategy: GenerationStrategy::Cartesian,
            dimensions: vec![GenerationDimension {
                name: "model_offset".to_string(),
                choices,
            }],
            max_variants,
            constraints: GenerationConstraints::default(),
        },
        shape_plans: BTreeMap::new(),
        data_bindings: BTreeMap::new(),
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    }
}

fn variant_scoring_controllers() -> RuntimeControllerRegistry {
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(MockController {
            id: ControllerId::new("controller:transform").unwrap(),
            handle: 1,
            emit_prediction: false,
        }))
        .unwrap();
    controllers
        .register(Box::new(VariantScoringController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 2,
            emit_targets: true,
        }))
        .unwrap();
    controllers
}

#[test]
fn host_hpo_owns_budget_native_scores_and_selection_without_refit() {
    struct Proposals {
        asked: u32,
        told: Vec<(u32, f64)>,
    }
    impl HostHpoProposalSource for Proposals {
        fn ask(&mut self, trial_index: u32) -> Result<Option<BTreeMap<String, serde_json::Value>>> {
            assert_eq!(
                trial_index as usize,
                self.told.len(),
                "each proposal must be terminal before asking again"
            );
            self.asked += 1;
            Ok(Some(BTreeMap::from([(
                "n_components".into(),
                json!([3.0, 1.0, 2.0][trial_index as usize]),
            )])))
        }
        fn tell(&mut self, trial_index: u32, score: f64) -> Result<()> {
            self.told.push((trial_index, score));
            Ok(())
        }
    }
    struct CvOnly(VariantScoringController);
    impl RuntimeController for CvOnly {
        fn controller_id(&self) -> &ControllerId {
            self.0.controller_id()
        }
        fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
            assert_eq!(
                task.phase,
                Phase::FitCv,
                "search must never refit or predict"
            );
            self.0.invoke(task)
        }
    }
    let mut campaign = variant_scoring_campaign(vec![("base", 0.0)]);
    campaign.generation = GenerationSpec::default();
    let plan =
        build_execution_plan("plan:host_hpo:test", simple_graph(), campaign, &manifests()).unwrap();
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(MockController {
            id: ControllerId::new("controller:transform").unwrap(),
            handle: 1,
            emit_prediction: false,
        }))
        .unwrap();
    controllers
        .register(Box::new(CvOnly(VariantScoringController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 2,
            emit_targets: true,
        })))
        .unwrap();
    let provider = InMemoryDataProvider::new(ControllerId::new("controller:data").unwrap());
    let mut request = HostHpoSearchRequest {
        fold_score_reduction: None,
        target_node: NodeId::new("model:pls").unwrap(),
        trial_budget: 3,
        metric: RegressionMetricKind::Rmse,
        direction: crate::selection::MetricObjective::Minimize,
        optimizer_descriptor: BTreeMap::from([("owner".into(), json!("test-host"))]),
    };
    let mut proposals = Proposals {
        asked: 0,
        told: Vec::new(),
    };
    let result = SequentialScheduler
        .execute_host_hpo_search(&plan, &controllers, &provider, &request, &mut proposals)
        .unwrap();
    assert_eq!(proposals.asked, 3);
    assert_eq!(proposals.told, vec![(0, 3.0), (1, 1.0), (2, 2.0)]);
    assert_eq!(result.selected_trial_index, 1);
    assert_eq!(result.selected_params["n_components"], json!(1.0));
    assert!(!result.portable);
    assert!(result
        .trials
        .iter()
        .all(|trial| !trial.scores.reports.is_empty()));
    assert_eq!(
        result.fold_set_fingerprint,
        stable_json_fingerprint(plan.fold_set.as_ref().unwrap()).unwrap()
    );
    assert!(!serde_json::to_value(&request)
        .unwrap()
        .as_object()
        .unwrap()
        .contains_key("fold_score_reduction"));
    request.fold_score_reduction = Some(HostHpoFoldReduction::Mean);
    let mut reduced_proposals = Proposals {
        asked: 0,
        told: Vec::new(),
    };
    let reduced = SequentialScheduler
        .execute_host_hpo_search(
            &plan,
            &controllers,
            &provider,
            &request,
            &mut reduced_proposals,
        )
        .unwrap();
    assert_ne!(reduced.request_fingerprint, result.request_fingerprint);
    assert_eq!(reduced.selected_trial_index, result.selected_trial_index);
    for (trial, original) in reduced.trials.iter().zip(&result.trials) {
        assert_eq!(
            trial.objective_fold_scores.len(),
            plan.fold_set.as_ref().unwrap().folds.len()
        );
        assert_eq!(
            serde_json::to_value(&trial.scores).unwrap(),
            serde_json::to_value(&original.scores).unwrap(),
            "selection reduction cannot rewrite native per-fold/OOF reports"
        );
    }
    request.trial_budget = 0;
    assert!(SequentialScheduler
        .execute_host_hpo_search(&plan, &controllers, &provider, &request, &mut proposals)
        .is_err());
    assert_eq!(proposals.asked, 3, "invalid request cannot ask or evaluate");
}

fn multi_port_model_graph() -> GraphSpec {
    let mut graph = simple_graph();
    graph.id = "g:multi.port.model".to_string();
    let model = graph
        .nodes
        .iter_mut()
        .find(|node| node.id.as_str() == "model:pls")
        .unwrap();
    model.ports.outputs = vec![
        port("pred", PortKind::Prediction),
        port("aux", PortKind::Prediction),
    ];
    graph
}

struct MultiPortVariantScoringController {
    id: ControllerId,
    handle: u64,
}

impl RuntimeController for MultiPortVariantScoringController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        let output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Data,
            owner_controller: self.id.clone(),
        };
        let mut predictions = Vec::new();
        let mut regression_targets = Vec::new();
        if let Some((sample_id, y_true)) = VariantScoringController::fold_sample(task) {
            let pred_offset = task
                .node_plan
                .params
                .get("n_components")
                .and_then(serde_json::Value::as_f64)
                .unwrap_or(0.0);
            let aux_offset = if pred_offset == 0.0 { 10.0 } else { 0.0 };
            for (port_name, offset) in [("pred", pred_offset), ("aux", aux_offset)] {
                predictions.push(PredictionBlock {
                    prediction_id: Some(format!("pred:{}:{port_name}", task.node_plan.node_id)),
                    producer_node: task.node_plan.node_id.clone(),
                    producer_port: Some(port_name.to_string()),
                    partition: PredictionPartition::Validation,
                    fold_id: task.fold_id.clone(),
                    sample_ids: vec![sample_id.clone()],
                    values: vec![vec![y_true + offset]],
                    target_names: vec!["y".to_string()],
                });
            }
            regression_targets.push(crate::metrics::RegressionTargetBlock {
                level: PredictionLevel::Sample,
                unit_ids: vec![crate::aggregation::PredictionUnitId::Sample(sample_id)],
                values: vec![vec![y_true]],
                target_names: vec!["y".to_string()],
            });
        }
        let variant_label = task
            .variant_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "base".to_string());
        let fold_label = task
            .fold_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "nofold".to_string());
        Ok(NodeResult {
            schema_version: None,
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([
                ("pred".to_string(), output.clone()),
                ("aux".to_string(), output),
            ]),
            predictions,
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets,
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:{}:{:?}:{variant_label}:{fold_label}:multiport",
                    task.node_plan.node_id, task.phase
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
                input_lineage: Vec::new(),
                artifact_refs: Vec::new(),
                params_fingerprint: task.node_plan.params_fingerprint.clone(),
                data_model_shape_fingerprint: None,
                aggregation_policy_fingerprint: None,
                seed: task.seed,
                unsafe_flags: BTreeSet::new(),
                metrics: BTreeMap::new(),
                loss_attestations: Vec::new(),
                early_stopping_records: Vec::new(),
            },
        })
    }
}

fn multi_port_variant_scoring_controllers() -> RuntimeControllerRegistry {
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(MockController {
            id: ControllerId::new("controller:transform").unwrap(),
            handle: 1,
            emit_prediction: false,
        }))
        .unwrap();
    controllers
        .register(Box::new(MultiPortVariantScoringController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 2,
        }))
        .unwrap();
    controllers
}

fn one_fold_set() -> FoldSet {
    // Single fold, train/validation disjoint (s2 trains, s1 validates). `Resampled` mode drops the
    // OOF-completeness requirement (s2 never validated) while keeping per-fold disjointness.
    FoldSet {
        id: "outer.single".to_string(),
        sample_ids: vec![SampleId::new("s1").unwrap(), SampleId::new("s2").unwrap()],
        folds: vec![FoldAssignment {
            fold_id: FoldId::new("fold:0").unwrap(),
            train_sample_ids: vec![SampleId::new("s2").unwrap()],
            validation_sample_ids: vec![SampleId::new("s1").unwrap()],
            metadata: BTreeMap::new(),
        }],
        sample_groups: BTreeMap::new(),
        partition_mode: FoldPartitionMode::Resampled,
    }
}

fn single_fold_variant_scoring_campaign(offsets: Vec<(&str, f64)>) -> CampaignSpec {
    let mut campaign = variant_scoring_campaign(offsets);
    campaign.id = "campaign:variant.select.single.fold".to_string();
    if let Some(split) = campaign.split_invocation.as_mut() {
        split.fold_set = Some(one_fold_set());
    }
    campaign
}

// --- Multi-producer (two independent model nodes) fixtures for the >1-OOF-average refusal. ---

fn two_model_graph() -> GraphSpec {
    let data_edge = |target: &str| EdgeSpec {
        source: PortRef {
            node_id: NodeId::new("transform:snv").unwrap(),
            port_name: "x".to_string(),
        },
        target: PortRef {
            node_id: NodeId::new(target).unwrap(),
            port_name: "x".to_string(),
        },
        contract: EdgeContract {
            requires_oof: false,
            requires_fold_alignment: false,
            ..EdgeContract::new(PortKind::Data, None)
        },
    };
    GraphSpec {
        id: "g:two.model".to_string(),
        interface: GraphInterface::default(),
        nodes: vec![
            node(
                "transform:snv",
                NodeKind::Transform,
                vec![],
                vec![port("x", PortKind::Data)],
            ),
            node(
                "model:a",
                NodeKind::Model,
                vec![port("x", PortKind::Data)],
                vec![port("pred", PortKind::Prediction)],
            ),
            node(
                "model:b",
                NodeKind::Model,
                vec![port("x", PortKind::Data)],
                vec![port("pred", PortKind::Prediction)],
            ),
        ],
        edges: vec![data_edge("model:a"), data_edge("model:b")],
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    }
}

fn two_model_manifests() -> crate::controller::ControllerRegistry {
    let mut manifests = crate::controller::ControllerRegistry::new();
    manifests
        .register(controller_manifest(
            "controller:transform",
            NodeKind::Transform,
        ))
        .unwrap();
    manifests
        .register(controller_manifest("controller:model", NodeKind::Model))
        .unwrap();
    manifests
}

fn two_model_variant_scoring_campaign(offsets: Vec<(&str, f64)>) -> CampaignSpec {
    let choices = offsets
        .into_iter()
        .map(|(label, offset)| GenerationChoice {
            label: label.to_string(),
            value: json!(label),
            param_overrides: vec![crate::generation::GenerationParamOverride {
                node_id: NodeId::new("model:a").unwrap(),
                params: BTreeMap::from([("n_components".to_string(), json!(offset))]),
            }],
            active_subsequence: None,
        })
        .collect::<Vec<_>>();
    let max_variants = Some(choices.len());
    CampaignSpec {
        inner_cv: None,
        id: "campaign:variant.select.multi.producer".to_string(),
        root_seed: Some(7),
        leakage_policy: Default::default(),
        aggregation_policy: Default::default(),
        split_invocation: Some(SplitInvocation {
            id: "split:outer".to_string(),
            controller_id: None,
            leakage_policy: Default::default(),
            params: BTreeMap::new(),
            fold_set: Some(two_fold_set()),
        }),
        generation: GenerationSpec {
            strategy: GenerationStrategy::Cartesian,
            dimensions: vec![GenerationDimension {
                name: "model_offset".to_string(),
                choices,
            }],
            max_variants,
            constraints: GenerationConstraints::default(),
        },
        shape_plans: BTreeMap::new(),
        data_bindings: BTreeMap::new(),
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    }
}

fn two_model_variant_scoring_controllers() -> RuntimeControllerRegistry {
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(MockController {
            id: ControllerId::new("controller:transform").unwrap(),
            handle: 1,
            emit_prediction: false,
        }))
        .unwrap();
    controllers
        .register(Box::new(VariantScoringController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 2,
            emit_targets: true,
        }))
        .unwrap();
    controllers
}

#[test]
fn select_best_variant_by_cv_picks_lowest_oof_rmse_variant() {
    use crate::metrics::RegressionMetricKind;

    // Two variants over a 2-fold OOF CV: variant `accurate` predicts y_true exactly (offset 0 ->
    // RMSE 0); variant `biased` predicts y_true + 1 (offset 1 -> RMSE 1). Native SELECT must pick the
    // accurate one by its cross-fold OOF average RMSE.
    let plan = build_execution_plan(
        "plan:variant.select",
        simple_graph(),
        variant_scoring_campaign(vec![("accurate", 0.0), ("biased", 1.0)]),
        &manifests(),
    )
    .unwrap();
    assert_eq!(plan.variants.len(), 2);
    let controllers = variant_scoring_controllers();
    let run_id = RunId::new("run:variant.select").unwrap();

    let selected = select_best_variant_by_cv(
        &plan,
        &run_id,
        Some(7),
        RegressionMetricKind::Rmse,
        |variant_plan, ctx| {
            SequentialScheduler
                .execute_campaign_phase(variant_plan, &controllers, ctx, Phase::FitCv)
                .map(|_| ())
        },
    )
    .unwrap();

    let accurate_variant = plan
        .variants
        .iter()
        .find(|variant| variant.choices["model_offset"].label == "accurate")
        .unwrap();
    let selection = selected.unwrap();
    assert_eq!(selection.selected_variant_id, accurate_variant.variant_id);

    // ADDITIVE per-variant reports: the bundle-bound `validation_reports` carry EVERY variant's CV
    // (the loser `biased` too), each tagged its own variant_id — not just the winner's. This is the
    // dag-ml-side surfacing that lets a generated sweep's num_predictions match legacy.
    let scored_variants: BTreeSet<VariantId> = selection
        .validation_reports
        .iter()
        .filter_map(|report| report.variant_id.clone())
        .collect();
    let expected_variants: BTreeSet<VariantId> = plan
        .variants
        .iter()
        .map(|variant| variant.variant_id.clone())
        .collect();
    assert_eq!(
        scored_variants, expected_variants,
        "validation reports must cover ALL variants, not just the winner"
    );
    // Every report is a Validation (OOF) report — never Final/Test — preserving the report-only,
    // OOF-safe guarantee for the non-selected variants.
    assert!(
        selection
            .validation_reports
            .iter()
            .all(|report| report.partition == PredictionPartition::Validation),
        "selection must only retain Validation (OOF) reports"
    );
    // The cross-fold OOF average per variant is present and tagged with the variant id (its native
    // form has variant_id = None), so each loser's headline CV score is recoverable.
    for variant in &plan.variants {
        let has_avg = selection.validation_reports.iter().any(|report| {
            report.variant_id.as_ref() == Some(&variant.variant_id)
                && report
                    .fold_id
                    .as_ref()
                    .is_some_and(|fold| fold.as_str() == "avg")
        });
        assert!(
            has_avg,
            "variant `{}` is missing its cross-fold OOF average report",
            variant.variant_id
        );
    }

    // ADDITIVE per-variant PREDICTIONS: alongside the scalar reports, EVERY variant's per-fold
    // VALIDATION (OOF) predictions are captured + re-tagged with the variant's id, so a host can fill a
    // non-selected variant's per-sample rows (not just its score). Param-variant SELECT carries no
    // operator-variant fingerprint, so `variant_label` is None.
    let predicted_variants: BTreeSet<VariantId> = selection
        .variant_validation_predictions
        .iter()
        .map(|captured| captured.variant_id.clone())
        .collect();
    assert_eq!(
        predicted_variants, expected_variants,
        "captured validation predictions must cover ALL variants, not just the winner"
    );
    assert!(
        selection
            .variant_validation_predictions
            .iter()
            .all(|captured| captured.variant_label.is_none()
                && !captured.predictions.is_empty()
                && captured
                    .predictions
                    .iter()
                    .all(|block| block.partition == PredictionPartition::Validation)),
        "captured param-variant predictions are Validation-only with no operator fingerprint"
    );
}

#[test]
fn select_best_variant_for_target_ignores_better_sibling_port() {
    use crate::metrics::RegressionMetricKind;

    // Same producer node, two prediction ports:
    // - `pred` makes variant `accurate` perfect and `biased` bad.
    // - `aux` intentionally does the opposite.
    //
    // Training SELECT resolves an OutputBinding to one concrete port. Targeting `pred` must therefore
    // pick `accurate` even though sibling port `aux` gives `biased` the better score.
    let plan = build_execution_plan(
        "plan:variant.select.multi.port",
        multi_port_model_graph(),
        variant_scoring_campaign(vec![("accurate", 0.0), ("biased", 10.0)]),
        &manifests(),
    )
    .unwrap();
    assert_eq!(plan.variants.len(), 2);
    let controllers = multi_port_variant_scoring_controllers();
    let run_id = RunId::new("run:variant.select.multi.port").unwrap();
    let target = NodeId::new("model:pls").unwrap();

    let outcome = select_best_variant_outcome_by_cv_for_target(
        &plan,
        &run_id,
        Some(7),
        RegressionMetricKind::Rmse,
        &target,
        Some("pred"),
        PredictionLevel::Sample,
        |variant_plan, ctx| {
            SequentialScheduler
                .execute_campaign_phase(variant_plan, &controllers, ctx, Phase::FitCv)
                .map(|_| ())
        },
    )
    .unwrap()
    .unwrap();

    let accurate_variant = plan
        .variants
        .iter()
        .find(|variant| variant.choices["model_offset"].label == "accurate")
        .unwrap();
    let biased_variant = plan
        .variants
        .iter()
        .find(|variant| variant.choices["model_offset"].label == "biased")
        .unwrap();
    assert_eq!(
        outcome.selection.selected_variant_id,
        accurate_variant.variant_id
    );

    let avg_rmse = |variant_id: &VariantId, port_name: &str| {
        outcome
            .selection
            .validation_reports
            .iter()
            .find(|report| {
                report.variant_id.as_ref() == Some(variant_id)
                    && report.producer_node == target
                    && report.producer_port.as_deref() == Some(port_name)
                    && report.partition == PredictionPartition::Validation
                    && report
                        .fold_id
                        .as_ref()
                        .is_some_and(|fold| fold.as_str() == "avg")
            })
            .map(|report| report.metrics["rmse"])
            .unwrap()
    };
    assert_eq!(avg_rmse(&accurate_variant.variant_id, "pred"), 0.0);
    assert_eq!(avg_rmse(&biased_variant.variant_id, "aux"), 0.0);
    assert!(
        avg_rmse(&biased_variant.variant_id, "pred")
            > avg_rmse(&accurate_variant.variant_id, "pred")
    );
}

#[test]
fn select_best_variant_by_cv_single_variant_returns_that_variant() {
    use crate::metrics::RegressionMetricKind;

    let plan = build_execution_plan(
        "plan:variant.select.single",
        simple_graph(),
        variant_scoring_campaign(vec![("only", 1.0)]),
        &manifests(),
    )
    .unwrap();
    assert_eq!(plan.variants.len(), 1);
    let controllers = variant_scoring_controllers();
    let run_id = RunId::new("run:variant.select.single").unwrap();

    let selected = select_best_variant_by_cv(
        &plan,
        &run_id,
        Some(7),
        RegressionMetricKind::Rmse,
        |variant_plan, ctx| {
            SequentialScheduler
                .execute_campaign_phase(variant_plan, &controllers, ctx, Phase::FitCv)
                .map(|_| ())
        },
    )
    .unwrap();

    let selection = selected.unwrap();
    assert_eq!(selection.selected_variant_id, plan.variants[0].variant_id);
    // The single variant's own CV reports are still surfaced (tagged with its id).
    assert!(selection
        .validation_reports
        .iter()
        .all(|report| report.variant_id.as_ref() == Some(&plan.variants[0].variant_id)));
}

#[test]
fn select_best_variant_by_cv_picks_highest_accuracy_variant() {
    use crate::metrics::RegressionMetricKind;

    // Accuracy maximizes (metrics.rs objective): the `accurate` variant matches the integer label
    // exactly (accuracy 1.0), `biased` is off by 1 (accuracy 0.0). Native SELECT with Accuracy must
    // pick `accurate` — proving the metric (not just RMSE) drives direction.
    let plan = build_execution_plan(
        "plan:variant.select.accuracy",
        simple_graph(),
        variant_scoring_campaign(vec![("accurate", 0.0), ("biased", 1.0)]),
        &manifests(),
    )
    .unwrap();
    assert_eq!(plan.variants.len(), 2);
    let controllers = variant_scoring_controllers();
    let run_id = RunId::new("run:variant.select.accuracy").unwrap();

    let selected = select_best_variant_by_cv(
        &plan,
        &run_id,
        Some(7),
        RegressionMetricKind::Accuracy,
        |variant_plan, ctx| {
            SequentialScheduler
                .execute_campaign_phase(variant_plan, &controllers, ctx, Phase::FitCv)
                .map(|_| ())
        },
    )
    .unwrap();

    let accurate_variant = plan
        .variants
        .iter()
        .find(|variant| variant.choices["model_offset"].label == "accurate")
        .unwrap();
    assert_eq!(
        selected.unwrap().selected_variant_id,
        accurate_variant.variant_id
    );
}

#[test]
fn select_best_variant_by_cv_no_targets_returns_none() {
    use crate::metrics::RegressionMetricKind;

    // The model emits well-formed, fold-disjoint validation OOF (s1 for fold:0, s2 for fold:1) but NO
    // regression_targets, so native scoring is genuinely off. The function returns Ok(None) so the
    // caller keeps its default variant. (A dedicated `emit_targets = false` controller is used rather
    // than the generic mock, whose binding-less fallback would emit the same sample in both folds — a
    // non-unique OOF set the mandatory coverage gate now rejects.)
    let plan = build_execution_plan(
        "plan:variant.select.no.targets",
        simple_graph(),
        variant_scoring_campaign(vec![("a", 0.0), ("b", 1.0)]),
        &manifests(),
    )
    .unwrap();
    assert_eq!(plan.variants.len(), 2);
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(MockController {
            id: ControllerId::new("controller:transform").unwrap(),
            handle: 1,
            emit_prediction: false,
        }))
        .unwrap();
    controllers
        .register(Box::new(VariantScoringController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 2,
            emit_targets: false,
        }))
        .unwrap();
    let run_id = RunId::new("run:variant.select.no.targets").unwrap();

    let selected = select_best_variant_by_cv(
        &plan,
        &run_id,
        Some(7),
        RegressionMetricKind::Rmse,
        |variant_plan, ctx| {
            SequentialScheduler
                .execute_campaign_phase(variant_plan, &controllers, ctx, Phase::FitCv)
                .map(|_| ())
        },
    )
    .unwrap();

    assert!(selected.is_none());
}

#[test]
fn select_best_variant_by_cv_single_fold_scores_but_no_average_errors() {
    use crate::metrics::RegressionMetricKind;

    // Scoring IS on (targets emitted) but the fold set has a single fold, so `cross_fold_validation
    // _reports` skips the OOF average. Per-fold scores exist (any_scores_seen) yet no average can rank
    // the variants -> an error, distinct from the no-targets Ok(None) case.
    let plan = build_execution_plan(
        "plan:variant.select.single.fold",
        simple_graph(),
        single_fold_variant_scoring_campaign(vec![("a", 0.0), ("b", 1.0)]),
        &manifests(),
    )
    .unwrap();
    assert_eq!(plan.variants.len(), 2);
    let controllers = variant_scoring_controllers();
    let run_id = RunId::new("run:variant.select.single.fold").unwrap();

    let error = select_best_variant_by_cv(
        &plan,
        &run_id,
        Some(7),
        RegressionMetricKind::Rmse,
        |variant_plan, ctx| {
            SequentialScheduler
                .execute_campaign_phase(variant_plan, &controllers, ctx, Phase::FitCv)
                .map(|_| ())
        },
    )
    .unwrap_err()
    .to_string();

    assert!(
        error.contains("no cross-fold OOF average"),
        "unexpected single-fold error: {error}"
    );
}

#[test]
fn select_best_variant_by_cv_rejects_multiple_prediction_producers() {
    use crate::metrics::RegressionMetricKind;

    // Two model producers each emit a cross-fold OOF average per variant, so a variant has >1 average.
    // Native SELECT needs a single score target -> it refuses to silently rank on one producer.
    let plan = build_execution_plan(
        "plan:variant.select.multi.producer",
        two_model_graph(),
        two_model_variant_scoring_campaign(vec![("a", 0.0), ("b", 1.0)]),
        &two_model_manifests(),
    )
    .unwrap();
    assert_eq!(plan.variants.len(), 2);
    let controllers = two_model_variant_scoring_controllers();
    let run_id = RunId::new("run:variant.select.multi.producer").unwrap();

    let error = select_best_variant_by_cv(
        &plan,
        &run_id,
        Some(7),
        RegressionMetricKind::Rmse,
        |variant_plan, ctx| {
            SequentialScheduler
                .execute_campaign_phase(variant_plan, &controllers, ctx, Phase::FitCv)
                .map(|_| ())
        },
    )
    .unwrap_err()
    .to_string();

    assert!(
        error.contains("multiple prediction producers"),
        "unexpected multi-producer error: {error}"
    );
}

#[test]
fn fit_view_spec_drops_excluded_samples_while_validation_keeps_them() {
    // `exclude` drops outlier samples from the TRAINING view spec (not just the
    // materialized view) but keeps them in validation/predict so OOF/test
    // coverage stays complete. three_fold_stress_set: s0..s5; fold:0
    // validation=[s0,s3], train=[s1,s2,s4,s5]. Exclude s2.
    let node_id = NodeId::new("node:model").unwrap();
    let binding = data_binding(&node_id);
    assert!(
        !binding.view_policy.include_excluded,
        "default policy must not include excluded rows"
    );
    let fold_set = three_fold_stress_set();
    let fold_id = fold_set.folds[0].fold_id.clone();
    let excluded: BTreeSet<SampleId> = [SampleId::new("s2").unwrap()].into_iter().collect();
    let empty: BTreeSet<SampleId> = BTreeSet::new();

    let fold_scope = PhaseScope {
        phase: Phase::FitCv,
        variant_id: None,
        variant: None,
        fold_id: Some(fold_id),
        seed_root: None,
    };

    // (a) Excluded sample is ABSENT from the TRAINING view spec sample_ids,
    // while the other train samples remain.
    let train_view = data_view_for_partition(
        &binding,
        Some(&fold_set),
        &fold_scope,
        DataRequestPartition::FoldTrain,
        None,
        DataViewRole::Fit,
        &excluded,
    )
    .unwrap();
    assert!(
        !train_view.include_excluded,
        "fit view must not include excluded rows"
    );
    let train_ids = train_view.sample_ids.as_ref().unwrap();
    assert!(
        !train_ids.contains(&SampleId::new("s2").unwrap()),
        "excluded s2 must be dropped from the training spec sample_ids"
    );
    assert!(
        train_ids.contains(&SampleId::new("s1").unwrap())
            && train_ids.contains(&SampleId::new("s4").unwrap())
            && train_ids.contains(&SampleId::new("s5").unwrap()),
        "non-excluded train samples must remain"
    );

    // Validation read keeps every validation sample and flags include_excluded.
    let validation_view = data_view_for_partition(
        &binding,
        Some(&fold_set),
        &fold_scope,
        DataRequestPartition::FoldValidation,
        None,
        DataViewRole::NonFit,
        &excluded,
    )
    .unwrap();
    assert!(
        validation_view.include_excluded,
        "validation read must keep excluded rows so they are still validated"
    );
    assert_eq!(
        validation_view.sample_ids,
        Some(vec![
            SampleId::new("s0").unwrap(),
            SampleId::new("s3").unwrap()
        ]),
        "validation spec is unfiltered by exclusion"
    );

    // FullTrain (refit) is a fit read: drops the excluded sample from the
    // full-train spec.
    let full_scope = PhaseScope {
        phase: Phase::Refit,
        variant_id: None,
        variant: None,
        fold_id: None,
        seed_root: None,
    };
    let full_train_view = data_view_for_partition(
        &binding,
        Some(&fold_set),
        &full_scope,
        DataRequestPartition::FullTrain,
        None,
        DataViewRole::Fit,
        &excluded,
    )
    .unwrap();
    assert!(!full_train_view.include_excluded);
    assert!(
        !full_train_view
            .sample_ids
            .as_ref()
            .unwrap()
            .contains(&SampleId::new("s2").unwrap()),
        "refit training spec drops excluded s2"
    );

    // Predict read keeps excluded; sample_ids stays None (whole dataset).
    let predict_scope = PhaseScope {
        phase: Phase::Predict,
        variant_id: None,
        variant: None,
        fold_id: None,
        seed_root: None,
    };
    let predict_view = data_view_for_partition(
        &binding,
        Some(&fold_set),
        &predict_scope,
        DataRequestPartition::Predict,
        None,
        DataViewRole::NonFit,
        &empty,
    )
    .unwrap();
    assert!(
        predict_view.include_excluded,
        "predict read must keep excluded rows so they are still predicted"
    );
}

#[test]
fn data_view_extra_carries_source_index_metadata() {
    let node_id = NodeId::new("node:model").unwrap();
    let mut binding = data_binding(&node_id);
    binding.source_ids = vec!["nir".to_string(), "chem".to_string()];
    binding.metadata.insert(
        SOURCE_INDEX_METADATA_KEY.to_string(),
        json!({
            "nir": 0,
            "chem": 1
        }),
    );
    binding.validate().unwrap();
    let empty: BTreeSet<SampleId> = BTreeSet::new();
    let scope = PhaseScope {
        phase: Phase::Predict,
        variant_id: None,
        variant: None,
        fold_id: None,
        seed_root: None,
    };

    let view = data_view_for_partition(
        &binding,
        None,
        &scope,
        DataRequestPartition::Predict,
        None,
        DataViewRole::NonFit,
        &empty,
    )
    .unwrap();

    assert_eq!(
        view.extra.get(SOURCE_INDEX_METADATA_KEY),
        Some(&json!({"nir": 0, "chem": 1}))
    );
}

#[test]
fn by_source_data_view_uses_branch_source_ids() {
    use crate::data::{BranchViewMode, BranchViewPlan, DataViewSelector};

    let node_id = NodeId::new("node:model").unwrap();
    let mut binding = data_binding(&node_id);
    binding.source_ids = vec!["nir".to_string(), "chem".to_string()];
    let branch_view = BranchViewPlan {
        view_id: "branch_view:chem".to_string(),
        branch_id: "branch:chem".to_string(),
        mode: BranchViewMode::BySource,
        selector: DataViewSelector {
            source_ids: vec!["chem".to_string()],
            ..Default::default()
        },
        allow_overlap: false,
        metadata: BTreeMap::new(),
    };
    let empty: BTreeSet<SampleId> = BTreeSet::new();
    let scope = PhaseScope {
        phase: Phase::Predict,
        variant_id: None,
        variant: None,
        fold_id: None,
        seed_root: None,
    };

    let view = data_view_for_partition(
        &binding,
        None,
        &scope,
        DataRequestPartition::Predict,
        Some(&branch_view),
        DataViewRole::NonFit,
        &empty,
    )
    .unwrap();

    assert_eq!(view.source_ids, Some(vec!["chem".to_string()]));
    assert_eq!(view.branch_view.as_ref(), Some(&branch_view));

    let invalid_branch_view = BranchViewPlan {
        view_id: "branch_view:raman".to_string(),
        branch_id: "branch:raman".to_string(),
        selector: DataViewSelector {
            source_ids: vec!["raman".to_string()],
            ..Default::default()
        },
        ..branch_view
    };
    let error = data_view_for_partition(
        &binding,
        None,
        &scope,
        DataRequestPartition::Predict,
        Some(&invalid_branch_view),
        DataViewRole::NonFit,
        &empty,
    )
    .unwrap_err()
    .to_string();
    assert!(
        error.contains("outside data binding source_ids"),
        "unexpected: {error}"
    );
}

#[test]
fn fit_influence_row_weights_match_post_exclusion_training_spec() {
    // (b) equal_sample_influence_weights row_weights length must equal the
    // post-exclusion training view, not the pre-exclusion fold train set.
    let node_id = NodeId::new("node:model").unwrap();
    let binding = data_binding(&node_id);
    let fold_set = three_fold_stress_set(); // s0..s5
    let fold_id = fold_set.folds[0].fold_id.clone();
    let train_len = fold_set.folds[0].train_sample_ids.len();
    assert!(train_len >= 2, "need a multi-sample train fold");
    let dropped = fold_set.folds[0].train_sample_ids[0].clone();
    let excluded: BTreeSet<SampleId> = [dropped.clone()].into_iter().collect();

    let scope = PhaseScope {
        phase: Phase::FitCv,
        variant_id: None,
        variant: None,
        fold_id: Some(fold_id),
        seed_root: None,
    };
    let train_view = data_view_for_partition(
        &binding,
        Some(&fold_set),
        &scope,
        DataRequestPartition::FoldTrain,
        None,
        DataViewRole::Fit,
        &excluded,
    )
    .unwrap();
    let spec_len = train_view.sample_ids.as_ref().unwrap().len();
    assert_eq!(
        spec_len,
        train_len - 1,
        "training spec must drop exactly the one excluded sample"
    );
    assert!(!train_view.sample_ids.as_ref().unwrap().contains(&dropped));

    let mut data_views = BTreeMap::new();
    data_views.insert("x".to_string(), train_view);
    let weights = equal_sample_influence_weights(&data_views).expect("weights derived");
    assert_eq!(
        weights.len(),
        spec_len,
        "row_weights length must equal the post-exclusion training spec"
    );
}

#[test]
fn exclusion_is_sample_local_across_relation_rows() {
    // (c) A sample with one excluded relation row and one non-excluded row is
    // fully dropped from training (sample-local exclusion).
    let mut base = SampleRelation::new(
        ObservationId::new("obs.s2.base").unwrap(),
        SampleId::new("s2").unwrap(),
    );
    base.excluded = false;
    let mut rep = SampleRelation::new(
        ObservationId::new("obs.s2.rep1").unwrap(),
        SampleId::new("s2").unwrap(),
    );
    rep.excluded = true; // only the second row is excluded
    let kept = SampleRelation::new(
        ObservationId::new("obs.s1.base").unwrap(),
        SampleId::new("s1").unwrap(),
    );
    let relations = SampleRelationSet {
        records: vec![base, rep, kept],
    };
    let excluded = relations.excluded_sample_ids();
    assert!(
        excluded.contains(&SampleId::new("s2").unwrap()),
        "a sample with ANY excluded row is excluded sample-locally"
    );
    assert!(!excluded.contains(&SampleId::new("s1").unwrap()));

    let node_id = NodeId::new("node:model").unwrap();
    let binding = data_binding(&node_id);
    let fold_set = three_fold_stress_set();
    let fold_id = fold_set.folds[0].fold_id.clone(); // train=[s1,s2,s4,s5]
    let scope = PhaseScope {
        phase: Phase::FitCv,
        variant_id: None,
        variant: None,
        fold_id: Some(fold_id),
        seed_root: None,
    };
    let train_view = data_view_for_partition(
        &binding,
        Some(&fold_set),
        &scope,
        DataRequestPartition::FoldTrain,
        None,
        DataViewRole::Fit,
        &excluded,
    )
    .unwrap();
    assert!(
        !train_view
            .sample_ids
            .as_ref()
            .unwrap()
            .contains(&SampleId::new("s2").unwrap()),
        "s2 must be fully dropped from training even though one of its rows is not excluded"
    );
}

#[test]
fn by_metadata_and_by_tag_branch_selectors_reach_the_provider_view_spec() {
    // The metadata/tag branch selector must survive the scheduler's
    // `data_view_for_partition` path and arrive intact on the
    // `DataProviderViewSpec.branch_view` that is handed to the provider's
    // `make_view` (where dag-ml-data's `filter_relations` matches it natively).
    use crate::data::{BranchViewMode, BranchViewPlan, DataViewSelector};

    let node_id = NodeId::new("node:model").unwrap();
    let binding = data_binding(&node_id);
    let empty: BTreeSet<SampleId> = BTreeSet::new();
    let scope = PhaseScope {
        phase: Phase::Predict,
        variant_id: None,
        variant: None,
        fold_id: None,
        seed_root: None,
    };

    let metadata_branch = BranchViewPlan {
        view_id: "branch_view:group_a".to_string(),
        branch_id: "branch:group_a".to_string(),
        mode: BranchViewMode::ByMetadata,
        selector: DataViewSelector {
            metadata: BTreeMap::from([("group".to_string(), serde_json::json!("A"))]),
            ..Default::default()
        },
        allow_overlap: false,
        metadata: BTreeMap::new(),
    };
    let metadata_view = data_view_for_partition(
        &binding,
        None,
        &scope,
        DataRequestPartition::Predict,
        Some(&metadata_branch),
        DataViewRole::NonFit,
        &empty,
    )
    .unwrap();
    let carried = metadata_view
        .branch_view
        .as_ref()
        .expect("by_metadata selector must reach the provider view spec");
    assert_eq!(carried.mode, BranchViewMode::ByMetadata);
    assert_eq!(
        carried.selector.metadata.get("group"),
        Some(&serde_json::json!("A")),
        "by_metadata selector value must reach the provider unchanged"
    );

    let tag_branch = BranchViewPlan {
        view_id: "branch_view:clean".to_string(),
        branch_id: "branch:clean".to_string(),
        mode: BranchViewMode::ByTag,
        selector: DataViewSelector {
            tags: vec!["clean".to_string()],
            ..Default::default()
        },
        allow_overlap: false,
        metadata: BTreeMap::new(),
    };
    let tag_view = data_view_for_partition(
        &binding,
        None,
        &scope,
        DataRequestPartition::Predict,
        Some(&tag_branch),
        DataViewRole::NonFit,
        &empty,
    )
    .unwrap();
    let carried_tags = tag_view
        .branch_view
        .as_ref()
        .expect("by_tag selector must reach the provider view spec");
    assert_eq!(carried_tags.mode, BranchViewMode::ByTag);
    assert_eq!(
        carried_tags.selector.tags,
        vec!["clean".to_string()],
        "by_tag selector must reach the provider unchanged"
    );
    // The spec itself must validate (the branch view validation runs here too).
    metadata_view.validate().unwrap();
    tag_view.validate().unwrap();
}

// ----- Slice 2: data-aware fan-out per-branch FIT_CV scoping -----

/// One recorded FIT_CV task observation:
/// `(node_id, fold_id, branch-view "site" value, validation sample ids)`.
type BranchScopeObservation = (String, String, Option<serde_json::Value>, Vec<String>);

/// Records, per (node_id, fold_id), the branch-view selector value and the
/// validation-view sample ids the runtime hands to the controller, then emits a
/// validation OOF block scoped to ITS PARTITION. A real branch model node only
/// sees the samples the data provider returns after applying the branch_view
/// metadata filter (the partition ∩ fold-validation intersection), so this mock
/// reproduces that by intersecting the fold-validation ids with the samples whose
/// recorded site equals the node's branch_view selector value — and detects the
/// empty intersection explicitly rather than silently emitting nothing.
struct BranchScopeRecordingController {
    id: ControllerId,
    handle: u64,
    /// sample id -> site value, the membership the data provider would filter by.
    sample_sites: BTreeMap<String, String>,
    /// When true, an empty partition ∩ fold is a hard error (mirrors the
    /// dag-ml-data provider's "data view selected no coordinator relations").
    /// When false, the branch+fold is skipped with no OOF block (the alternative
    /// explicit handling: never silently duplicate/mis-cover).
    error_on_empty_intersection: bool,
    seen: Arc<Mutex<Vec<BranchScopeObservation>>>,
}

impl RuntimeController for BranchScopeRecordingController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        let node_id = task.node_plan.node_id.to_string();
        let fold_label = task
            .fold_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "nofold".to_string());
        // The validation companion view carries this node's branch_view selector.
        let validation_view = task
            .data_views
            .iter()
            .find(|(_, view)| view.partition == DataRequestPartition::FoldValidation)
            .map(|(_, view)| view);
        let branch_value = validation_view
            .and_then(|view| view.branch_view.as_ref())
            .and_then(|branch| branch.selector.metadata.get("site").cloned());
        let branch_site = branch_value.as_ref().and_then(|value| value.as_str());
        // The fold's full validation sample ids carried by the spec.
        let fold_validation_ids: Vec<String> = validation_view
            .and_then(|view| view.sample_ids.clone())
            .unwrap_or_default()
            .iter()
            .map(ToString::to_string)
            .collect();
        // Partition ∩ fold-validation: only the fold-validation samples whose site
        // matches this branch's selector (what the data provider would return).
        let partition_ids: Vec<String> = match branch_site {
            Some(site) => fold_validation_ids
                .iter()
                .filter(|sample| {
                    self.sample_sites
                        .get(*sample)
                        .map(|s| s == site)
                        .unwrap_or(false)
                })
                .cloned()
                .collect(),
            None => fold_validation_ids.clone(),
        };
        self.seen.lock().unwrap().push((
            node_id,
            fold_label.clone(),
            branch_value.clone(),
            partition_ids.clone(),
        ));

        let prediction_output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Prediction,
            owner_controller: self.id.clone(),
        };
        let data_output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Data,
            owner_controller: self.id.clone(),
        };
        // Explicit empty partition ∩ fold handling: error or skip, never emit a
        // silently-empty OOF block that would mis-cover the partition. When not
        // erroring, the empty (branch, fold) is simply skipped below (no block).
        if task.phase == Phase::FitCv
            && task.fold_id.is_some()
            && partition_ids.is_empty()
            && self.error_on_empty_intersection
        {
            return Err(DagMlError::RuntimeValidation(format!(
                "branch node `{}` has no samples in fold {} for its partition (empty \
                 partition ∩ fold)",
                task.node_plan.node_id, fold_label
            )));
        }
        let predictions = if task.phase == Phase::FitCv && !partition_ids.is_empty() {
            vec![PredictionBlock {
                prediction_id: Some(format!("pred:{}", task.node_plan.node_id)),
                producer_node: task.node_plan.node_id.clone(),
                producer_port: None,
                partition: PredictionPartition::Validation,
                fold_id: task.fold_id.clone(),
                sample_ids: partition_ids
                    .iter()
                    .map(|s| SampleId::new(s).unwrap())
                    .collect(),
                values: vec![vec![1.0]; partition_ids.len()],
                target_names: vec!["y".to_string()],
            }]
        } else {
            Vec::new()
        };
        Ok(NodeResult {
            schema_version: None,
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([
                ("pred".to_string(), prediction_output.clone()),
                ("oof".to_string(), prediction_output),
                ("x".to_string(), data_output),
            ]),
            predictions,
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets: Vec::new(),
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:{}:{fold_label}",
                    task.node_plan.node_id
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
                input_lineage: Vec::new(),
                artifact_refs: Vec::new(),
                params_fingerprint: task.node_plan.params_fingerprint.clone(),
                data_model_shape_fingerprint: None,
                aggregation_policy_fingerprint: None,
                seed: task.seed,
                unsafe_flags: BTreeSet::new(),
                metrics: BTreeMap::new(),
                loss_attestations: Vec::new(),
                early_stopping_records: Vec::new(),
            },
        })
    }
}

/// A branch model controller that emits a validation OOF block over the WHOLE
/// fold validation set (ignoring any partition filter). Two such branches feeding
/// one concat-merge therefore overlap on every sample — the non-disjoint input
/// the merge handler must refuse. Used by the overlap-guard test.
struct OverlapEmittingController {
    id: ControllerId,
    handle: u64,
}

impl RuntimeController for OverlapEmittingController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        let fold_label = task
            .fold_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "nofold".to_string());
        let validation_view = task
            .data_views
            .iter()
            .find(|(_, view)| view.partition == DataRequestPartition::FoldValidation)
            .map(|(_, view)| view);
        let fold_validation_ids: Vec<SampleId> = validation_view
            .and_then(|view| view.sample_ids.clone())
            .unwrap_or_default();
        let prediction_output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Prediction,
            owner_controller: self.id.clone(),
        };
        let data_output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Data,
            owner_controller: self.id.clone(),
        };
        let predictions = if task.phase == Phase::FitCv && !fold_validation_ids.is_empty() {
            vec![PredictionBlock {
                prediction_id: Some(format!("pred:{}", task.node_plan.node_id)),
                producer_node: task.node_plan.node_id.clone(),
                producer_port: None,
                partition: PredictionPartition::Validation,
                fold_id: task.fold_id.clone(),
                sample_ids: fold_validation_ids.clone(),
                values: vec![vec![1.0]; fold_validation_ids.len()],
                target_names: vec!["y".to_string()],
            }]
        } else {
            Vec::new()
        };
        Ok(NodeResult {
            schema_version: None,
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([
                ("pred".to_string(), prediction_output.clone()),
                ("oof".to_string(), prediction_output),
                ("x".to_string(), data_output),
            ]),
            predictions,
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets: Vec::new(),
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:{}:{fold_label}",
                    task.node_plan.node_id
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
                input_lineage: Vec::new(),
                artifact_refs: Vec::new(),
                params_fingerprint: task.node_plan.params_fingerprint.clone(),
                data_model_shape_fingerprint: None,
                aggregation_policy_fingerprint: None,
                seed: task.seed,
                unsafe_flags: BTreeSet::new(),
                metrics: BTreeMap::new(),
                loss_attestations: Vec::new(),
                early_stopping_records: Vec::new(),
            },
        })
    }
}

/// A model node carrying a `dsl_branch_view_plan` by_metadata selector for one
/// site value — exactly the shape `fan_out_data_aware_branches` + compile emit.
fn branch_model_node(node_id: &str, site: &str) -> NodeSpec {
    use crate::data::{BranchViewMode, BranchViewPlan, DataViewSelector};
    let plan = BranchViewPlan {
        view_id: format!("branch_view:per_site__{site}"),
        branch_id: format!("per_site__{site}"),
        mode: BranchViewMode::ByMetadata,
        selector: DataViewSelector {
            metadata: BTreeMap::from([("site".to_string(), serde_json::json!(site))]),
            ..Default::default()
        },
        allow_overlap: false,
        metadata: BTreeMap::new(),
    };
    let mut node = node(
        node_id,
        NodeKind::Model,
        vec![port("x", PortKind::Data)],
        vec![port("oof", PortKind::Prediction)],
    );
    node.metadata.insert(
        "dsl_branch_view_plan".to_string(),
        serde_json::to_value(&plan).unwrap(),
    );
    node
}

#[test]
fn fanned_out_branches_each_fit_cv_only_their_partition() {
    // Two fanned-out branch model nodes (one per discovered site A/B), each
    // scoped to its partition by a dsl_branch_view_plan in node metadata — the
    // shape the data-aware fan-out + compile produce. A 2-fold KFold over four
    // samples drives FIT_CV; we assert each branch node, across both folds,
    // receives a validation view carrying ITS OWN branch_view selector and the
    // fold's validation samples (the intersection that yields per-partition OOF).
    let node_a = branch_model_node("model:site__A", "A");
    let node_b = branch_model_node("model:site__B", "B");
    let graph = GraphSpec {
        id: "graph:fanout.scope".to_string(),
        interface: GraphInterface::default(),
        nodes: vec![node_a, node_b],
        edges: Vec::new(),
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    };

    let id_a = NodeId::new("model:site__A").unwrap();
    let id_b = NodeId::new("model:site__B").unwrap();
    let samples: Vec<SampleId> = ["sample:1", "sample:2", "sample:3", "sample:4"]
        .iter()
        .map(|s| SampleId::new(*s).unwrap())
        .collect();
    let fold_set = FoldSet {
        id: "folds:fanout.scope".to_string(),
        sample_ids: samples.clone(),
        folds: vec![
            FoldAssignment {
                fold_id: FoldId::new("fold:0").unwrap(),
                train_sample_ids: vec![samples[2].clone(), samples[3].clone()],
                validation_sample_ids: vec![samples[0].clone(), samples[1].clone()],
                metadata: BTreeMap::new(),
            },
            FoldAssignment {
                fold_id: FoldId::new("fold:1").unwrap(),
                train_sample_ids: vec![samples[0].clone(), samples[1].clone()],
                validation_sample_ids: vec![samples[2].clone(), samples[3].clone()],
                metadata: BTreeMap::new(),
            },
        ],
        sample_groups: BTreeMap::new(),
        partition_mode: FoldPartitionMode::Partition,
    };
    let campaign = CampaignSpec {
        inner_cv: None,
        id: "campaign:fanout.scope".to_string(),
        root_seed: Some(7),
        leakage_policy: Default::default(),
        aggregation_policy: Default::default(),
        split_invocation: Some(SplitInvocation {
            id: "split:fanout.scope".to_string(),
            controller_id: None,
            leakage_policy: Default::default(),
            params: BTreeMap::new(),
            fold_set: Some(fold_set),
        }),
        generation: Default::default(),
        shape_plans: BTreeMap::new(),
        data_bindings: BTreeMap::from([
            (id_a.clone(), vec![data_binding(&id_a)]),
            (id_b.clone(), vec![data_binding(&id_b)]),
        ]),
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    };
    let mut registry = ControllerRegistry::new();
    registry
        .register(controller_manifest("controller:model", NodeKind::Model))
        .unwrap();
    let plan = build_execution_plan("plan:fanout.scope", graph, campaign, &registry).unwrap();

    // The envelope carries 4 samples across two sites; require_relations is set,
    // so registering it is enough for the InMemoryDataProvider to materialize.
    let envelope = sample_relations_envelope(&[
        ("sample:1", "A"),
        ("sample:2", "B"),
        ("sample:3", "A"),
        ("sample:4", "B"),
    ]);
    let data_provider = InMemoryDataProvider::with_envelope(
        ControllerId::new("controller:data").unwrap(),
        envelope,
    )
    .unwrap();

    let seen = Arc::new(Mutex::new(Vec::new()));
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(BranchScopeRecordingController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 1,
            sample_sites: BTreeMap::from([
                ("sample:1".to_string(), "A".to_string()),
                ("sample:2".to_string(), "B".to_string()),
                ("sample:3".to_string(), "A".to_string()),
                ("sample:4".to_string(), "B".to_string()),
            ]),
            error_on_empty_intersection: false,
            seen: Arc::clone(&seen),
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:fanout.scope").unwrap(), Some(7));

    SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &data_provider,
            &mut ctx,
            Phase::FitCv,
        )
        .unwrap();

    let seen = seen.lock().unwrap().clone();
    // Two branch nodes x two folds = four FIT_CV tasks.
    assert_eq!(seen.len(), 4, "expected one task per (branch, fold)");
    // Every branch-A task is scoped to site A; every branch-B task to site B.
    for (node_id, _fold, branch_value, _val_ids) in &seen {
        let expected = if node_id.ends_with("__A") { "A" } else { "B" };
        assert_eq!(
            branch_value.as_ref(),
            Some(&serde_json::json!(expected)),
            "node `{node_id}` must be scoped to its own partition `{expected}`"
        );
    }
    // Realistic per-partition OOF: each branch validates ONLY its partition's
    // samples (partition ∩ fold-validation), never the full universe. Site A owns
    // {sample:1, sample:3}; site B owns {sample:2, sample:4}.
    let oof_blocks = ctx.prediction_store.blocks();
    assert_eq!(oof_blocks.len(), 4, "one OOF block per (branch, fold)");
    for block in oof_blocks {
        assert_eq!(block.partition, PredictionPartition::Validation);
        assert!(
            !block.sample_ids.is_empty(),
            "a non-empty partition ∩ fold must produce a non-empty OOF block"
        );
    }
    let expected_partition = BTreeMap::from([
        (
            "model:site__A",
            vec!["sample:1".to_string(), "sample:3".to_string()],
        ),
        (
            "model:site__B",
            vec!["sample:2".to_string(), "sample:4".to_string()],
        ),
    ]);
    for (node, expected) in &expected_partition {
        let mut ids: Vec<String> = oof_blocks
            .iter()
            .filter(|block| block.producer_node.as_str() == *node)
            .flat_map(|block| block.sample_ids.iter().map(ToString::to_string))
            .collect();
        ids.sort();
        assert_eq!(
            &ids, expected,
            "branch `{node}` must validate ONLY its own partition's samples across folds"
        );
    }
}

/// A `PredictionJoin` concat-merge node reassembling N branch OOF blocks — the
/// shape Slice 3 (native merge) handles. `merge_mode="concat"` in node metadata
/// marks it as a separation-branch reassembly (vs the default stacking merge),
/// and one prediction input port per upstream branch carries an OOF edge.
fn concat_merge_node(node_id: &str, branch_ids: &[&str]) -> NodeSpec {
    let mut node = node(
        node_id,
        NodeKind::PredictionJoin,
        branch_ids
            .iter()
            .map(|branch| port(&format!("oof_{branch}"), PortKind::Prediction))
            .collect(),
        vec![port("oof", PortKind::Prediction)],
    );
    node.metadata.insert(
        "merge_mode".to_string(),
        serde_json::Value::String("concat".to_string()),
    );
    node
}

/// Branch OOF edge: `branch.oof -> merge.oof_<branch>`, carrying the
/// `requires_oof` and `requires_fold_alignment` contract the real merge DSL
/// emits. The native merge handler intercepts the node BEFORE this edge is
/// resolved, so it never trips the full-fold OOF validation that the
/// partition-covering branch inputs would fail.
fn branch_to_merge_edge(branch_id: &str, merge_id: &str) -> EdgeSpec {
    EdgeSpec {
        source: PortRef {
            node_id: NodeId::new(branch_id).unwrap(),
            port_name: "oof".to_string(),
        },
        target: PortRef {
            node_id: NodeId::new(merge_id).unwrap(),
            port_name: format!("oof_{branch_id}"),
        },
        contract: EdgeContract {
            requires_oof: true,
            requires_fold_alignment: true,
            ..EdgeContract::new(PortKind::Prediction, None)
        },
    }
}

/// A controller manifest for the concat-merge node so `build_execution_plan`
/// resolves a `controller_id` for it. The merge node never actually runs through
/// this controller — the native scheduler handler reassembles it — but the plan
/// still needs a manifest (and thread/process safety for the parallel scheduler).
fn merge_controller_manifest(id: &str) -> ControllerManifest {
    let mut manifest = controller_manifest(id, NodeKind::PredictionJoin);
    manifest.supported_phases = BTreeSet::from([Phase::FitCv, Phase::Refit, Phase::Predict]);
    manifest
        .capabilities
        .insert(ControllerCapability::ConsumesOofPredictions);
    manifest
        .capabilities
        .insert(ControllerCapability::EmitsPredictions);
    manifest
}

#[test]
fn concat_merge_reassembles_disjoint_branch_oof_into_full_universe() {
    // A fanned-out (Slice 2) + merged separation campaign: two branch model nodes
    // (sites A/B, each scoped to its partition) feed one concat-merge node. A
    // 2-fold KFold over four samples drives FIT_CV; each branch emits per-partition
    // OOF (its partition ∩ fold validation), and the merge node must reassemble the
    // disjoint per-partition blocks into ONE per-sample OOF block covering the full
    // validation universe exactly once.
    let node_a = branch_model_node("model:site__A", "A");
    let node_b = branch_model_node("model:site__B", "B");
    let merge = concat_merge_node("merge:sites", &["model:site__A", "model:site__B"]);
    let graph = GraphSpec {
        id: "graph:merge.scope".to_string(),
        interface: GraphInterface::default(),
        nodes: vec![node_a, node_b, merge],
        edges: vec![
            branch_to_merge_edge("model:site__A", "merge:sites"),
            branch_to_merge_edge("model:site__B", "merge:sites"),
        ],
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    };

    let id_a = NodeId::new("model:site__A").unwrap();
    let id_b = NodeId::new("model:site__B").unwrap();
    let merge_id = NodeId::new("merge:sites").unwrap();
    let samples: Vec<SampleId> = ["sample:1", "sample:2", "sample:3", "sample:4"]
        .iter()
        .map(|s| SampleId::new(*s).unwrap())
        .collect();
    let fold_set = FoldSet {
        id: "folds:merge.scope".to_string(),
        sample_ids: samples.clone(),
        folds: vec![
            FoldAssignment {
                fold_id: FoldId::new("fold:0").unwrap(),
                train_sample_ids: vec![samples[2].clone(), samples[3].clone()],
                validation_sample_ids: vec![samples[0].clone(), samples[1].clone()],
                metadata: BTreeMap::new(),
            },
            FoldAssignment {
                fold_id: FoldId::new("fold:1").unwrap(),
                train_sample_ids: vec![samples[0].clone(), samples[1].clone()],
                validation_sample_ids: vec![samples[2].clone(), samples[3].clone()],
                metadata: BTreeMap::new(),
            },
        ],
        sample_groups: BTreeMap::new(),
        partition_mode: FoldPartitionMode::Partition,
    };
    let campaign = CampaignSpec {
        inner_cv: None,
        id: "campaign:merge.scope".to_string(),
        root_seed: Some(7),
        leakage_policy: Default::default(),
        aggregation_policy: Default::default(),
        split_invocation: Some(SplitInvocation {
            id: "split:merge.scope".to_string(),
            controller_id: None,
            leakage_policy: Default::default(),
            params: BTreeMap::new(),
            fold_set: Some(fold_set),
        }),
        generation: Default::default(),
        shape_plans: BTreeMap::new(),
        data_bindings: BTreeMap::from([
            (id_a.clone(), vec![data_binding(&id_a)]),
            (id_b.clone(), vec![data_binding(&id_b)]),
        ]),
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    };
    let mut registry = ControllerRegistry::new();
    registry
        .register(controller_manifest("controller:model", NodeKind::Model))
        .unwrap();
    registry
        .register(merge_controller_manifest("controller:merge"))
        .unwrap();
    let plan = build_execution_plan("plan:merge.scope", graph, campaign, &registry).unwrap();

    let envelope = sample_relations_envelope(&[
        ("sample:1", "A"),
        ("sample:2", "B"),
        ("sample:3", "A"),
        ("sample:4", "B"),
    ]);
    let data_provider = InMemoryDataProvider::with_envelope(
        ControllerId::new("controller:data").unwrap(),
        envelope,
    )
    .unwrap();

    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(BranchScopeRecordingController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 1,
            sample_sites: BTreeMap::from([
                ("sample:1".to_string(), "A".to_string()),
                ("sample:2".to_string(), "B".to_string()),
                ("sample:3".to_string(), "A".to_string()),
                ("sample:4".to_string(), "B".to_string()),
            ]),
            error_on_empty_intersection: false,
            seen: Arc::new(Mutex::new(Vec::new())),
        }))
        .unwrap();
    // No merge controller is registered in the RUNTIME registry on purpose: the
    // native handler must reassemble without invoking any controller.
    let mut ctx = RunContext::new(RunId::new("run:merge.scope").unwrap(), Some(7));

    SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &data_provider,
            &mut ctx,
            Phase::FitCv,
        )
        .unwrap();

    // The merge node emits exactly ONE OOF block per fold (two folds), each
    // covering the full fold validation set — not per-partition like the branches.
    let merge_blocks: Vec<&PredictionBlock> = ctx
        .prediction_store
        .blocks()
        .iter()
        .filter(|block| block.producer_node == merge_id)
        .collect();
    assert_eq!(
        merge_blocks.len(),
        2,
        "merge node must emit one reassembled OOF block per fold"
    );

    // Per-fold reassembly covers the fold's full validation set, each sample once.
    let mut fold0: Vec<String> = merge_blocks
        .iter()
        .find(|block| block.fold_id.as_ref().unwrap().as_str() == "fold:0")
        .unwrap()
        .sample_ids
        .iter()
        .map(ToString::to_string)
        .collect();
    fold0.sort();
    assert_eq!(
        fold0,
        vec!["sample:1".to_string(), "sample:2".to_string()],
        "fold:0 merge covers its full validation set (A:sample:1 + B:sample:2)"
    );
    let mut fold1: Vec<String> = merge_blocks
        .iter()
        .find(|block| block.fold_id.as_ref().unwrap().as_str() == "fold:1")
        .unwrap()
        .sample_ids
        .iter()
        .map(ToString::to_string)
        .collect();
    fold1.sort();
    assert_eq!(
        fold1,
        vec!["sample:3".to_string(), "sample:4".to_string()],
        "fold:1 merge covers its full validation set (A:sample:3 + B:sample:4)"
    );

    // Across folds, the merge's OOF covers the FULL sample universe exactly once.
    let mut all_merged: Vec<String> = merge_blocks
        .iter()
        .flat_map(|block| block.sample_ids.iter().map(ToString::to_string))
        .collect();
    all_merged.sort();
    assert_eq!(
        all_merged,
        vec![
            "sample:1".to_string(),
            "sample:2".to_string(),
            "sample:3".to_string(),
            "sample:4".to_string()
        ],
        "the merged OOF must cover every sample exactly once across folds"
    );

    // Each merged block passes the normal full-fold OOF completeness validation
    // (the per-branch partition inputs would fail it; the reassembly does not).
    let fold_set = plan.fold_set.as_ref().unwrap();
    crate::oof::validate_prediction_blocks_against_folds(fold_set, &[(*merge_blocks[0]).clone()])
        .expect("reassembled OOF block passes full-fold completeness");
    crate::oof::validate_prediction_blocks_against_folds(fold_set, &[(*merge_blocks[1]).clone()])
        .expect("reassembled OOF block passes full-fold completeness");

    // The merge lineage links its contributing branches (full traceability).
    let merge_lineage = ctx
        .lineage
        .records()
        .find(|record| {
            record.node_id == merge_id && record.fold_id.as_ref().unwrap().as_str() == "fold:0"
        })
        .expect("merge node recorded lineage");
    assert_eq!(
        merge_lineage.input_lineage.len(),
        2,
        "merge lineage references both branch producers for the fold"
    );
}

#[test]
fn concat_merge_rejects_overlapping_branch_predictions() {
    // Guard: if two branches both claim the same sample (a non-disjoint partition,
    // which separation must never produce), the reassembly is a hard error rather
    // than silently double-covering. Here BOTH branch controllers claim every
    // fold-validation sample (site filter disabled), so their OOF blocks overlap.
    let node_a = branch_model_node("model:site__A", "A");
    let node_b = branch_model_node("model:site__B", "B");
    let merge = concat_merge_node("merge:sites", &["model:site__A", "model:site__B"]);
    let graph = GraphSpec {
        id: "graph:merge.overlap".to_string(),
        interface: GraphInterface::default(),
        nodes: vec![node_a, node_b, merge],
        edges: vec![
            branch_to_merge_edge("model:site__A", "merge:sites"),
            branch_to_merge_edge("model:site__B", "merge:sites"),
        ],
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    };
    let id_a = NodeId::new("model:site__A").unwrap();
    let id_b = NodeId::new("model:site__B").unwrap();
    let samples: Vec<SampleId> = ["sample:1", "sample:2", "sample:3", "sample:4"]
        .iter()
        .map(|s| SampleId::new(*s).unwrap())
        .collect();
    let fold_set = FoldSet {
        id: "folds:merge.overlap".to_string(),
        sample_ids: samples.clone(),
        folds: vec![
            FoldAssignment {
                fold_id: FoldId::new("fold:0").unwrap(),
                train_sample_ids: vec![samples[2].clone(), samples[3].clone()],
                validation_sample_ids: vec![samples[0].clone(), samples[1].clone()],
                metadata: BTreeMap::new(),
            },
            FoldAssignment {
                fold_id: FoldId::new("fold:1").unwrap(),
                train_sample_ids: vec![samples[0].clone(), samples[1].clone()],
                validation_sample_ids: vec![samples[2].clone(), samples[3].clone()],
                metadata: BTreeMap::new(),
            },
        ],
        sample_groups: BTreeMap::new(),
        partition_mode: FoldPartitionMode::Partition,
    };
    let campaign = CampaignSpec {
        inner_cv: None,
        id: "campaign:merge.overlap".to_string(),
        root_seed: Some(7),
        leakage_policy: Default::default(),
        aggregation_policy: Default::default(),
        split_invocation: Some(SplitInvocation {
            id: "split:merge.overlap".to_string(),
            controller_id: None,
            leakage_policy: Default::default(),
            params: BTreeMap::new(),
            fold_set: Some(fold_set),
        }),
        generation: Default::default(),
        shape_plans: BTreeMap::new(),
        data_bindings: BTreeMap::from([
            (id_a.clone(), vec![data_binding(&id_a)]),
            (id_b.clone(), vec![data_binding(&id_b)]),
        ]),
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    };
    let mut registry = ControllerRegistry::new();
    registry
        .register(controller_manifest("controller:model", NodeKind::Model))
        .unwrap();
    registry
        .register(merge_controller_manifest("controller:merge"))
        .unwrap();
    let plan = build_execution_plan("plan:merge.overlap", graph, campaign, &registry).unwrap();
    let envelope = sample_relations_envelope(&[
        ("sample:1", "A"),
        ("sample:2", "B"),
        ("sample:3", "A"),
        ("sample:4", "B"),
    ]);
    let data_provider = InMemoryDataProvider::with_envelope(
        ControllerId::new("controller:data").unwrap(),
        envelope,
    )
    .unwrap();
    let mut controllers = RuntimeControllerRegistry::new();
    // EMPTY sample_sites => the branch controller's site filter matches nothing by
    // membership, so it falls back to emitting the FULL fold-validation set for
    // BOTH branches (overlap on every sample).
    controllers
        .register(Box::new(OverlapEmittingController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 1,
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:merge.overlap").unwrap(), Some(7));

    let error = SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &data_provider,
            &mut ctx,
            Phase::FitCv,
        )
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("overlapping branch predictions"),
        "overlapping branch inputs must surface a clear error: {error}"
    );
}

/// A branch model controller that emits NO predictions/targets for any fold —
/// used to drive the "non-empty fold, no branch inputs" merge error path.
struct SilentBranchController {
    id: ControllerId,
    handle: u64,
}

impl RuntimeController for SilentBranchController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        let fold_label = task
            .fold_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "nofold".to_string());
        let output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Data,
            owner_controller: self.id.clone(),
        };
        Ok(NodeResult {
            schema_version: None,
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([
                ("oof".to_string(), output.clone()),
                ("x".to_string(), output),
            ]),
            predictions: Vec::new(),
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets: Vec::new(),
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:{}:{fold_label}",
                    task.node_plan.node_id
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
                input_lineage: Vec::new(),
                artifact_refs: Vec::new(),
                params_fingerprint: task.node_plan.params_fingerprint.clone(),
                data_model_shape_fingerprint: None,
                aggregation_policy_fingerprint: None,
                seed: task.seed,
                unsafe_flags: BTreeSet::new(),
                metrics: BTreeMap::new(),
                loss_attestations: Vec::new(),
                early_stopping_records: Vec::new(),
            },
        })
    }
}

/// A branch model controller that, like `BranchScopeRecordingController`, scopes
/// its OOF to its partition (fold-validation ∩ its site), but ALSO emits the
/// matching per-sample `y_true` so the merge can be scored. Prediction =
/// `y_true + offset`, where `offset` comes from the variant's `n_components`
/// param override — so different variants give the merge different OOF residuals.
/// `y_true(sample) = trailing integer of the sample id`.
struct ScoringBranchController {
    id: ControllerId,
    handle: u64,
    sample_sites: BTreeMap<String, String>,
}

impl ScoringBranchController {
    fn y_true(sample: &str) -> f64 {
        sample
            .rsplit(|c: char| !c.is_ascii_digit())
            .find(|piece| !piece.is_empty())
            .and_then(|digits| digits.parse::<f64>().ok())
            .unwrap_or(0.0)
    }
}

impl RuntimeController for ScoringBranchController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        let fold_label = task
            .fold_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "nofold".to_string());
        let validation_view = task
            .data_views
            .iter()
            .find(|(_, view)| view.partition == DataRequestPartition::FoldValidation)
            .map(|(_, view)| view);
        let branch_site = validation_view
            .and_then(|view| view.branch_view.as_ref())
            .and_then(|branch| branch.selector.metadata.get("site"))
            .and_then(serde_json::Value::as_str);
        let fold_validation_ids: Vec<String> = validation_view
            .and_then(|view| view.sample_ids.clone())
            .unwrap_or_default()
            .iter()
            .map(ToString::to_string)
            .collect();
        let partition_ids: Vec<String> = match branch_site {
            Some(site) => fold_validation_ids
                .iter()
                .filter(|sample| {
                    self.sample_sites
                        .get(*sample)
                        .map(|s| s == site)
                        .unwrap_or(false)
                })
                .cloned()
                .collect(),
            None => fold_validation_ids.clone(),
        };
        let offset = task
            .node_plan
            .params
            .get("n_components")
            .and_then(serde_json::Value::as_f64)
            .unwrap_or(0.0);

        let prediction_output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Prediction,
            owner_controller: self.id.clone(),
        };
        let data_output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Data,
            owner_controller: self.id.clone(),
        };
        let (predictions, regression_targets) =
            if task.phase == Phase::FitCv && !partition_ids.is_empty() {
                let preds = vec![PredictionBlock {
                    prediction_id: Some(format!("pred:{}", task.node_plan.node_id)),
                    producer_node: task.node_plan.node_id.clone(),
                    producer_port: None,
                    partition: PredictionPartition::Validation,
                    fold_id: task.fold_id.clone(),
                    sample_ids: partition_ids
                        .iter()
                        .map(|s| SampleId::new(s).unwrap())
                        .collect(),
                    values: partition_ids
                        .iter()
                        .map(|s| vec![Self::y_true(s) + offset])
                        .collect(),
                    target_names: vec!["y".to_string()],
                }];
                let targets = vec![crate::metrics::RegressionTargetBlock {
                    level: PredictionLevel::Sample,
                    unit_ids: partition_ids
                        .iter()
                        .map(|s| {
                            crate::aggregation::PredictionUnitId::Sample(SampleId::new(s).unwrap())
                        })
                        .collect(),
                    values: partition_ids
                        .iter()
                        .map(|s| vec![Self::y_true(s)])
                        .collect(),
                    target_names: vec!["y".to_string()],
                }];
                (preds, targets)
            } else {
                (Vec::new(), Vec::new())
            };
        let variant_label = task
            .variant_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "base".to_string());
        Ok(NodeResult {
            schema_version: None,
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([
                ("pred".to_string(), prediction_output.clone()),
                ("oof".to_string(), prediction_output),
                ("x".to_string(), data_output),
            ]),
            predictions,
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets,
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:{}:{variant_label}:{fold_label}",
                    task.node_plan.node_id
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
                input_lineage: Vec::new(),
                artifact_refs: Vec::new(),
                params_fingerprint: task.node_plan.params_fingerprint.clone(),
                data_model_shape_fingerprint: None,
                aggregation_policy_fingerprint: None,
                seed: task.seed,
                unsafe_flags: BTreeSet::new(),
                metrics: BTreeMap::new(),
                loss_attestations: Vec::new(),
                early_stopping_records: Vec::new(),
            },
        })
    }
}

/// Two-site sample→site membership shared by the scoring merge tests.
fn merge_sample_sites() -> BTreeMap<String, String> {
    BTreeMap::from([
        ("sample:1".to_string(), "A".to_string()),
        ("sample:2".to_string(), "B".to_string()),
        ("sample:3".to_string(), "A".to_string()),
        ("sample:4".to_string(), "B".to_string()),
    ])
}

/// 2-site (A/B) merge plan + provider over a 2-fold KFold, optionally with a
/// per-variant `n_components` offset sweep on BOTH branch nodes. Returns the plan
/// and the data provider; the caller supplies the runtime controllers.
fn scoring_merge_plan_and_provider(
    plan_id: &str,
    offsets: Vec<(&str, f64)>,
) -> (ExecutionPlan, InMemoryDataProvider) {
    let node_a = branch_model_node("model:site__A", "A");
    let node_b = branch_model_node("model:site__B", "B");
    let merge = concat_merge_node("merge:sites", &["model:site__A", "model:site__B"]);
    let graph = GraphSpec {
        id: format!("graph:{plan_id}"),
        interface: GraphInterface::default(),
        nodes: vec![node_a, node_b, merge],
        edges: vec![
            branch_to_merge_edge("model:site__A", "merge:sites"),
            branch_to_merge_edge("model:site__B", "merge:sites"),
        ],
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    };
    let id_a = NodeId::new("model:site__A").unwrap();
    let id_b = NodeId::new("model:site__B").unwrap();
    let samples: Vec<SampleId> = ["sample:1", "sample:2", "sample:3", "sample:4"]
        .iter()
        .map(|s| SampleId::new(*s).unwrap())
        .collect();
    let fold_set = FoldSet {
        id: format!("folds:{plan_id}"),
        sample_ids: samples.clone(),
        folds: vec![
            FoldAssignment {
                fold_id: FoldId::new("fold:0").unwrap(),
                train_sample_ids: vec![samples[2].clone(), samples[3].clone()],
                validation_sample_ids: vec![samples[0].clone(), samples[1].clone()],
                metadata: BTreeMap::new(),
            },
            FoldAssignment {
                fold_id: FoldId::new("fold:1").unwrap(),
                train_sample_ids: vec![samples[0].clone(), samples[1].clone()],
                validation_sample_ids: vec![samples[2].clone(), samples[3].clone()],
                metadata: BTreeMap::new(),
            },
        ],
        sample_groups: BTreeMap::new(),
        partition_mode: FoldPartitionMode::Partition,
    };
    // A per-variant offset sweep applied to BOTH branch model nodes.
    let generation = if offsets.is_empty() {
        Default::default()
    } else {
        let choices = offsets
            .into_iter()
            .map(|(label, offset)| GenerationChoice {
                label: label.to_string(),
                value: json!(label),
                param_overrides: vec![
                    crate::generation::GenerationParamOverride {
                        node_id: id_a.clone(),
                        params: BTreeMap::from([("n_components".to_string(), json!(offset))]),
                    },
                    crate::generation::GenerationParamOverride {
                        node_id: id_b.clone(),
                        params: BTreeMap::from([("n_components".to_string(), json!(offset))]),
                    },
                ],
                active_subsequence: None,
            })
            .collect::<Vec<_>>();
        let max_variants = Some(choices.len());
        GenerationSpec {
            strategy: GenerationStrategy::Cartesian,
            dimensions: vec![GenerationDimension {
                name: "branch_offset".to_string(),
                choices,
            }],
            max_variants,
            constraints: GenerationConstraints::default(),
        }
    };
    let campaign = CampaignSpec {
        inner_cv: None,
        id: format!("campaign:{plan_id}"),
        root_seed: Some(7),
        leakage_policy: Default::default(),
        aggregation_policy: Default::default(),
        split_invocation: Some(SplitInvocation {
            id: format!("split:{plan_id}"),
            controller_id: None,
            leakage_policy: Default::default(),
            params: BTreeMap::new(),
            fold_set: Some(fold_set),
        }),
        generation,
        shape_plans: BTreeMap::new(),
        data_bindings: BTreeMap::from([
            (id_a.clone(), vec![data_binding(&id_a)]),
            (id_b.clone(), vec![data_binding(&id_b)]),
        ]),
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    };
    let mut registry = ControllerRegistry::new();
    registry
        .register(controller_manifest("controller:model", NodeKind::Model))
        .unwrap();
    registry
        .register(merge_controller_manifest("controller:merge"))
        .unwrap();
    let plan = build_execution_plan(plan_id, graph, campaign, &registry).unwrap();
    let envelope = sample_relations_envelope(&[
        ("sample:1", "A"),
        ("sample:2", "B"),
        ("sample:3", "A"),
        ("sample:4", "B"),
    ]);
    let provider = InMemoryDataProvider::with_envelope(
        ControllerId::new("controller:data").unwrap(),
        envelope,
    )
    .unwrap();
    (plan, provider)
}

#[test]
fn concat_merge_producer_is_scored_per_fold_and_cross_fold() {
    // Fix 1: the merge must be SCORED, not just stored. Branch controllers emit
    // per-partition OOF + matching y_true; the merge reassembles BOTH, so the
    // merge producer gets per-fold reports AND a cross-fold OOF average
    // (cv_best_score). Predictions equal y_true (offset 0) -> RMSE 0 everywhere.
    let (plan, provider) = scoring_merge_plan_and_provider("plan:merge.scored", Vec::new());
    let merge_id = NodeId::new("merge:sites").unwrap();
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(ScoringBranchController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 1,
            sample_sites: merge_sample_sites(),
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:merge.scored").unwrap(), Some(7));

    SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::FitCv,
        )
        .unwrap();
    // Cross-fold OOF average must be computed for the merge producer.
    ctx.collect_cross_fold_validation_scores(plan_oof_partition_mode(&plan))
        .unwrap();

    // Per-fold scoring: the merge producer has a Validation report per fold.
    let per_fold: Vec<&crate::metrics::RegressionMetricReport> = ctx
        .score_collector
        .iter()
        .filter(|report| {
            report.producer_node == merge_id
                && report.partition == PredictionPartition::Validation
                && report
                    .fold_id
                    .as_ref()
                    .is_some_and(|fold| fold.as_str() != "avg")
        })
        .collect();
    assert_eq!(
        per_fold.len(),
        2,
        "merge producer must be scored once per fold"
    );
    for report in &per_fold {
        assert_eq!(
            report.row_count, 2,
            "each per-fold merge report covers the full fold"
        );
        assert!(report.metrics["rmse"].abs() < 1e-9, "offset 0 -> RMSE 0");
    }

    // Cross-fold scoring: the merge producer has a cv_best_score (fold_id="avg")
    // over the full sample universe — exactly what makes a separation branch yield
    // a scored full-universe result.
    let avg: Vec<&crate::metrics::RegressionMetricReport> = ctx
        .score_collector
        .iter()
        .filter(|report| {
            report.producer_node == merge_id
                && report
                    .fold_id
                    .as_ref()
                    .is_some_and(|fold| fold.as_str() == "avg")
        })
        .collect();
    assert_eq!(
        avg.len(),
        1,
        "merge producer must have one cross-fold OOF average"
    );
    assert_eq!(
        avg[0].row_count, 4,
        "the merge OOF average covers the full universe"
    );
    assert!(
        avg[0].metrics["rmse"].abs() < 1e-9,
        "offset 0 -> OOF-average RMSE 0"
    );
}

#[test]
fn concat_merge_errors_when_a_nonempty_fold_has_no_branch_inputs() {
    // Fix 2: a NON-EMPTY fold whose branches produced no OOF must ERROR (report
    // the missing samples), never silently drop the merge output. The branch
    // controllers here emit NOTHING (skip every fold), so the merge sees a
    // non-empty fold with zero inputs.
    let (plan, provider) = scoring_merge_plan_and_provider("plan:merge.noinputs", Vec::new());
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(SilentBranchController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 1,
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:merge.noinputs").unwrap(), Some(7));

    let error = SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::FitCv,
        )
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("does not cover fold") && error.contains("missing"),
        "a non-empty fold with no branch inputs must report missing samples: {error}"
    );
}

#[test]
fn concat_merge_isolates_per_variant_blocks() {
    // Fix 3: a 2-variant branch+merge campaign. Each variant runs in its OWN run
    // context (exactly how native SELECT scores variants), so each variant's merge
    // reassembles from ONLY its own branch blocks — no cross-variant overlap — and
    // each variant's cross-fold OOF average reflects ITS offset.
    let (plan, provider) = scoring_merge_plan_and_provider(
        "plan:merge.variants",
        vec![("accurate", 0.0), ("biased", 10.0)],
    );
    assert_eq!(plan.variants.len(), 2);
    let merge_id = NodeId::new("merge:sites").unwrap();

    let mut avg_rmse_by_variant: BTreeMap<String, f64> = BTreeMap::new();
    for variant in &plan.variants {
        let mut controllers = RuntimeControllerRegistry::new();
        controllers
            .register(Box::new(ScoringBranchController {
                id: ControllerId::new("controller:model").unwrap(),
                handle: 1,
                sample_sites: merge_sample_sites(),
            }))
            .unwrap();
        // A fresh, variant-pinned context per variant (the per-variant isolation
        // the CLI / select_best_variant_by_cv rely on).
        let mut ctx = RunContext::new(
            RunId::new(format!("run:merge.variants:{}", variant.variant_id)).unwrap(),
            Some(7),
        );
        ctx.variant_id = Some(variant.variant_id.clone());
        SequentialScheduler
            .execute_campaign_phase_with_data_provider(
                &plan,
                &controllers,
                &provider,
                &mut ctx,
                Phase::FitCv,
            )
            .unwrap();
        ctx.collect_cross_fold_validation_scores(plan_oof_partition_mode(&plan))
            .unwrap();

        // Each variant's merge covers the full universe exactly once, with the
        // variant-distinguished id, and no overlap error.
        let merge_blocks: Vec<&PredictionBlock> = ctx
            .prediction_store
            .blocks()
            .iter()
            .filter(|block| block.producer_node == merge_id)
            .collect();
        assert_eq!(
            merge_blocks.len(),
            2,
            "one merge block per fold for this variant"
        );
        let mut all: Vec<String> = merge_blocks
            .iter()
            .flat_map(|block| block.sample_ids.iter().map(ToString::to_string))
            .collect();
        all.sort();
        assert_eq!(
            all,
            vec![
                "sample:1".to_string(),
                "sample:2".to_string(),
                "sample:3".to_string(),
                "sample:4".to_string()
            ],
            "variant `{}` merge must cover the full universe exactly once",
            variant.variant_id
        );
        for block in &merge_blocks {
            assert!(
                block
                    .prediction_id
                    .as_ref()
                    .is_some_and(|id| id.contains(variant.variant_id.as_str())),
                "merge block id must be variant-distinguished"
            );
        }
        let avg = ctx
            .score_collector
            .iter()
            .find(|report| {
                report.producer_node == merge_id
                    && report
                        .fold_id
                        .as_ref()
                        .is_some_and(|fold| fold.as_str() == "avg")
            })
            .expect("variant merge has a cross-fold OOF average");
        avg_rmse_by_variant.insert(variant.variant_id.to_string(), avg.metrics["rmse"]);
    }

    // The two variants score differently (offset 0 -> RMSE 0; offset 10 -> RMSE 10),
    // proving each merge was reassembled from ONLY its own variant's blocks.
    let rmses: Vec<f64> = avg_rmse_by_variant.values().copied().collect();
    assert!(
        rmses.iter().any(|r| r.abs() < 1e-9) && rmses.iter().any(|r| (r - 10.0).abs() < 1e-9),
        "per-variant merge OOF averages must differ by offset (0 and 10): {avg_rmse_by_variant:?}"
    );
}

#[test]
fn concat_merge_rejects_mixed_variant_blocks_in_one_context() {
    // Fix 3 guard: running BOTH variants in ONE context (variant_id unset) lets
    // two variants' branch blocks accumulate for the same (branch, fold). Blocks
    // carry no variant tag, so the merge cannot attribute them and must ERROR
    // rather than silently mix variants. (Real multi-variant runs isolate each
    // variant in its own context — this is the unsupported direct path.)
    let (plan, provider) = scoring_merge_plan_and_provider(
        "plan:merge.mixed",
        vec![("accurate", 0.0), ("biased", 10.0)],
    );
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(ScoringBranchController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 1,
            sample_sites: merge_sample_sites(),
        }))
        .unwrap();
    // No variant pinned -> execute_campaign_phase runs BOTH variants in one ctx.
    let mut ctx = RunContext::new(RunId::new("run:merge.mixed").unwrap(), Some(7));

    let error = SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::FitCv,
        )
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("mixes several variants"),
        "mixed-variant branch blocks in one context must error: {error}"
    );
}

/// Build the 3-site plan + provider used by the empty-intersection tests. Site C
/// has a single sample (sample:4) so one fold's validation set contains no C
/// samples → an empty partition ∩ fold for branch C in that fold.
fn empty_intersection_plan_and_provider() -> (ExecutionPlan, InMemoryDataProvider) {
    let nodes = vec![
        branch_model_node("model:site__A", "A"),
        branch_model_node("model:site__B", "B"),
        branch_model_node("model:site__C", "C"),
    ];
    let graph = GraphSpec {
        id: "graph:fanout.empty".to_string(),
        interface: GraphInterface::default(),
        nodes,
        edges: Vec::new(),
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    };
    let samples: Vec<SampleId> = ["sample:1", "sample:2", "sample:3", "sample:4"]
        .iter()
        .map(|s| SampleId::new(*s).unwrap())
        .collect();
    let fold_set = FoldSet {
        id: "folds:fanout.empty".to_string(),
        sample_ids: samples.clone(),
        folds: vec![
            FoldAssignment {
                fold_id: FoldId::new("fold:0").unwrap(),
                train_sample_ids: vec![samples[2].clone(), samples[3].clone()],
                // val = {sample:1 (A), sample:2 (B)} -> NO C samples here.
                validation_sample_ids: vec![samples[0].clone(), samples[1].clone()],
                metadata: BTreeMap::new(),
            },
            FoldAssignment {
                fold_id: FoldId::new("fold:1").unwrap(),
                train_sample_ids: vec![samples[0].clone(), samples[1].clone()],
                // val = {sample:3 (A), sample:4 (C)}.
                validation_sample_ids: vec![samples[2].clone(), samples[3].clone()],
                metadata: BTreeMap::new(),
            },
        ],
        sample_groups: BTreeMap::new(),
        partition_mode: FoldPartitionMode::Partition,
    };
    let bindings = ["model:site__A", "model:site__B", "model:site__C"]
        .iter()
        .map(|id| {
            let node_id = NodeId::new(*id).unwrap();
            (node_id.clone(), vec![data_binding(&node_id)])
        })
        .collect::<BTreeMap<_, _>>();
    let campaign = CampaignSpec {
        inner_cv: None,
        id: "campaign:fanout.empty".to_string(),
        root_seed: Some(7),
        leakage_policy: Default::default(),
        aggregation_policy: Default::default(),
        split_invocation: Some(SplitInvocation {
            id: "split:fanout.empty".to_string(),
            controller_id: None,
            leakage_policy: Default::default(),
            params: BTreeMap::new(),
            fold_set: Some(fold_set),
        }),
        generation: Default::default(),
        shape_plans: BTreeMap::new(),
        data_bindings: bindings,
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    };
    let mut registry = ControllerRegistry::new();
    registry
        .register(controller_manifest("controller:model", NodeKind::Model))
        .unwrap();
    let plan = build_execution_plan("plan:fanout.empty", graph, campaign, &registry).unwrap();
    let envelope = sample_relations_envelope(&[
        ("sample:1", "A"),
        ("sample:2", "B"),
        ("sample:3", "A"),
        ("sample:4", "C"),
    ]);
    let provider = InMemoryDataProvider::with_envelope(
        ControllerId::new("controller:data").unwrap(),
        envelope,
    )
    .unwrap();
    (plan, provider)
}

fn empty_intersection_sample_sites() -> BTreeMap<String, String> {
    BTreeMap::from([
        ("sample:1".to_string(), "A".to_string()),
        ("sample:2".to_string(), "B".to_string()),
        ("sample:3".to_string(), "A".to_string()),
        ("sample:4".to_string(), "C".to_string()),
    ])
}

#[test]
fn empty_partition_intersection_is_skipped_with_no_silent_miscoverage() {
    // Skip mode: branch C has NO samples in fold:0 (its partition ∩ fold is
    // empty). The (C, fold:0) OOF is skipped — never a silently-empty block — and
    // C still validates its sample in fold:1, so coverage is correct, not dropped.
    let (plan, provider) = empty_intersection_plan_and_provider();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(BranchScopeRecordingController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 1,
            sample_sites: empty_intersection_sample_sites(),
            error_on_empty_intersection: false,
            seen: Arc::clone(&seen),
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:fanout.empty.skip").unwrap(), Some(7));

    SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::FitCv,
        )
        .unwrap();

    let oof_blocks = ctx.prediction_store.blocks();
    // Branch C produced exactly one OOF block (fold:1, sample:4); fold:0 skipped.
    let c_ids: Vec<String> = oof_blocks
        .iter()
        .filter(|block| block.producer_node.as_str() == "model:site__C")
        .flat_map(|block| block.sample_ids.iter().map(ToString::to_string))
        .collect();
    assert_eq!(
        c_ids,
        vec!["sample:4".to_string()],
        "branch C must cover only its present sample, with the empty fold skipped"
    );
    // No empty OOF blocks were emitted anywhere.
    assert!(
        oof_blocks.iter().all(|block| !block.sample_ids.is_empty()),
        "no silently-empty OOF block may be emitted for an empty partition ∩ fold"
    );
}

#[test]
fn empty_partition_intersection_can_raise_a_clear_error() {
    // Error mode: the empty partition ∩ fold for branch C in fold:0 raises a
    // clear, explicit error rather than silently mis-covering.
    let (plan, provider) = empty_intersection_plan_and_provider();
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(BranchScopeRecordingController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 1,
            sample_sites: empty_intersection_sample_sites(),
            error_on_empty_intersection: true,
            seen: Arc::new(Mutex::new(Vec::new())),
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:fanout.empty.error").unwrap(), Some(7));

    let error = SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::FitCv,
        )
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("empty partition ∩ fold"),
        "empty intersection must surface a clear error: {error}"
    );
}

/// A `PredictionJoin` *fusion* (late-fusion averaging) merge node over N
/// duplication branches. `merge_mode="fusion"` marks it for the native fusion
/// reassembly that averages each sample's branch predictions (vs concat's
/// disjoint reassembly).
fn fusion_merge_node(node_id: &str, branch_ids: &[&str], merge_mode: &str) -> NodeSpec {
    let mut node = node(
        node_id,
        NodeKind::PredictionJoin,
        branch_ids
            .iter()
            .map(|branch| port(&format!("oof_{branch}"), PortKind::Prediction))
            .collect(),
        vec![port("oof", PortKind::Prediction)],
    );
    node.metadata.insert(
        "merge_mode".to_string(),
        serde_json::Value::String(merge_mode.to_string()),
    );
    node
}

/// A duplication-branch model node: a plain Model node (no branch_view, so it
/// covers the FULL fold validation set — the duplication shape `[[A],[B]]`).
fn duplication_model_node(node_id: &str) -> NodeSpec {
    node(
        node_id,
        NodeKind::Model,
        vec![port("x", PortKind::Data)],
        vec![port("oof", PortKind::Prediction)],
    )
}

/// A duplication-branch controller for the fusion tests: it emits ONE full-fold
/// `Validation` OOF block over the fold's validation set (read from the
/// validation data view — duplication branches see the whole fold), with a
/// per-node constant value `offsets[node_id]`, plus matching per-sample `y_true`.
/// `skip` names (node_id, sample) pairs that the branch does NOT predict, used to
/// drive asymmetric coverage — that sample is then averaged over the remaining
/// branch(es) only.
struct FusionBranchController {
    id: ControllerId,
    handle: u64,
    /// node_id -> the constant prediction value this branch emits per sample.
    offsets: BTreeMap<String, f64>,
    /// (node_id, sample_id) pairs the branch deliberately does not cover.
    skip: BTreeSet<(String, String)>,
}

impl RuntimeController for FusionBranchController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        let node_id = task.node_plan.node_id.to_string();
        let fold_label = task
            .fold_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "nofold".to_string());
        let validation_view = task
            .data_views
            .iter()
            .find(|(_, view)| view.partition == DataRequestPartition::FoldValidation)
            .map(|(_, view)| view);
        // Duplication branch: cover the FULL fold validation set (minus any skips).
        let fold_validation_ids: Vec<String> = validation_view
            .and_then(|view| view.sample_ids.clone())
            .unwrap_or_default()
            .iter()
            .map(ToString::to_string)
            .filter(|sample| !self.skip.contains(&(node_id.clone(), sample.clone())))
            .collect();
        let value = *self.offsets.get(&node_id).unwrap_or(&0.0);

        let prediction_output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Prediction,
            owner_controller: self.id.clone(),
        };
        let data_output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Data,
            owner_controller: self.id.clone(),
        };
        let (predictions, regression_targets) =
            if task.phase == Phase::FitCv && !fold_validation_ids.is_empty() {
                let preds = vec![PredictionBlock {
                    prediction_id: Some(format!("pred:{}", task.node_plan.node_id)),
                    producer_node: task.node_plan.node_id.clone(),
                    producer_port: None,
                    partition: PredictionPartition::Validation,
                    fold_id: task.fold_id.clone(),
                    sample_ids: fold_validation_ids
                        .iter()
                        .map(|s| SampleId::new(s).unwrap())
                        .collect(),
                    values: fold_validation_ids.iter().map(|_| vec![value]).collect(),
                    target_names: vec!["y".to_string()],
                }];
                // Ground truth is the sample's numeric suffix — identical across
                // branches (a sample's y_true is fold/branch-independent).
                let targets = vec![crate::metrics::RegressionTargetBlock {
                    level: PredictionLevel::Sample,
                    unit_ids: fold_validation_ids
                        .iter()
                        .map(|s| {
                            crate::aggregation::PredictionUnitId::Sample(SampleId::new(s).unwrap())
                        })
                        .collect(),
                    values: fold_validation_ids
                        .iter()
                        .map(|s| vec![ScoringBranchController::y_true(s)])
                        .collect(),
                    target_names: vec!["y".to_string()],
                }];
                (preds, targets)
            } else {
                (Vec::new(), Vec::new())
            };
        Ok(NodeResult {
            schema_version: None,
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([
                ("pred".to_string(), prediction_output.clone()),
                ("oof".to_string(), prediction_output),
                ("x".to_string(), data_output),
            ]),
            predictions,
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets,
            lineage: LineageRecord {
                record_id: LineageId::new(format!("lineage:{node_id}:{fold_label}")).unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
                input_lineage: Vec::new(),
                artifact_refs: Vec::new(),
                params_fingerprint: task.node_plan.params_fingerprint.clone(),
                data_model_shape_fingerprint: None,
                aggregation_policy_fingerprint: None,
                seed: task.seed,
                unsafe_flags: BTreeSet::new(),
                metrics: BTreeMap::new(),
                loss_attestations: Vec::new(),
                early_stopping_records: Vec::new(),
            },
        })
    }
}

/// A 2-branch duplication + fusion-merge plan over a 2-fold KFold (4 samples),
/// both branches on the FULL data. Returns plan + provider; the caller registers
/// the runtime controllers.
fn fusion_merge_plan_and_provider(plan_id: &str) -> (ExecutionPlan, InMemoryDataProvider) {
    let node_a = duplication_model_node("model:dup__A");
    let node_b = duplication_model_node("model:dup__B");
    let merge = fusion_merge_node("merge:dup", &["model:dup__A", "model:dup__B"], "fusion");
    let graph = GraphSpec {
        id: format!("graph:{plan_id}"),
        interface: GraphInterface::default(),
        nodes: vec![node_a, node_b, merge],
        edges: vec![
            branch_to_merge_edge("model:dup__A", "merge:dup"),
            branch_to_merge_edge("model:dup__B", "merge:dup"),
        ],
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    };
    let id_a = NodeId::new("model:dup__A").unwrap();
    let id_b = NodeId::new("model:dup__B").unwrap();
    let samples: Vec<SampleId> = ["sample:1", "sample:2", "sample:3", "sample:4"]
        .iter()
        .map(|s| SampleId::new(*s).unwrap())
        .collect();
    let fold_set = FoldSet {
        id: format!("folds:{plan_id}"),
        sample_ids: samples.clone(),
        folds: vec![
            FoldAssignment {
                fold_id: FoldId::new("fold:0").unwrap(),
                train_sample_ids: vec![samples[2].clone(), samples[3].clone()],
                validation_sample_ids: vec![samples[0].clone(), samples[1].clone()],
                metadata: BTreeMap::new(),
            },
            FoldAssignment {
                fold_id: FoldId::new("fold:1").unwrap(),
                train_sample_ids: vec![samples[0].clone(), samples[1].clone()],
                validation_sample_ids: vec![samples[2].clone(), samples[3].clone()],
                metadata: BTreeMap::new(),
            },
        ],
        sample_groups: BTreeMap::new(),
        partition_mode: FoldPartitionMode::Partition,
    };
    let campaign = CampaignSpec {
        inner_cv: None,
        id: format!("campaign:{plan_id}"),
        root_seed: Some(7),
        leakage_policy: Default::default(),
        aggregation_policy: Default::default(),
        split_invocation: Some(SplitInvocation {
            id: format!("split:{plan_id}"),
            controller_id: None,
            leakage_policy: Default::default(),
            params: BTreeMap::new(),
            fold_set: Some(fold_set),
        }),
        generation: Default::default(),
        shape_plans: BTreeMap::new(),
        data_bindings: BTreeMap::from([
            (id_a.clone(), vec![data_binding(&id_a)]),
            (id_b.clone(), vec![data_binding(&id_b)]),
        ]),
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    };
    let mut registry = ControllerRegistry::new();
    registry
        .register(controller_manifest("controller:model", NodeKind::Model))
        .unwrap();
    registry
        .register(merge_controller_manifest("controller:merge"))
        .unwrap();
    let plan = build_execution_plan(plan_id, graph, campaign, &registry).unwrap();
    let envelope = sample_relations_envelope(&[
        ("sample:1", "A"),
        ("sample:2", "B"),
        ("sample:3", "A"),
        ("sample:4", "B"),
    ]);
    let provider = InMemoryDataProvider::with_envelope(
        ControllerId::new("controller:data").unwrap(),
        envelope,
    )
    .unwrap();
    (plan, provider)
}

#[test]
fn fusion_merge_averages_duplication_branch_oof_including_asymmetric_coverage() {
    // A 2-branch DUPLICATION ([[A],[B]]) + late-fusion merge: both models fit on
    // the FULL data and emit full-fold OOF; the merge AVERAGES their held-out
    // predictions per sample (distinct from concat's disjoint reassembly). Branch
    // A always predicts 10.0; branch B predicts 20.0 but DELIBERATELY SKIPS
    // sample:1 (asymmetric coverage). So sample:1 averages over A only (=10.0)
    // while every other sample averages A+B (=15.0).
    let (plan, provider) = fusion_merge_plan_and_provider("plan:fusion.avg");
    let merge_id = NodeId::new("merge:dup").unwrap();
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(FusionBranchController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 1,
            offsets: BTreeMap::from([
                ("model:dup__A".to_string(), 10.0),
                ("model:dup__B".to_string(), 20.0),
            ]),
            skip: BTreeSet::from([("model:dup__B".to_string(), "sample:1".to_string())]),
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:fusion.avg").unwrap(), Some(7));

    SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::FitCv,
        )
        .unwrap();

    // The merge emits one fused OOF block per fold, each covering the full fold
    // validation set (the union of branch coverage), each sample exactly once.
    let merge_blocks: Vec<&PredictionBlock> = ctx
        .prediction_store
        .blocks()
        .iter()
        .filter(|block| block.producer_node == merge_id)
        .collect();
    assert_eq!(
        merge_blocks.len(),
        2,
        "fusion merge emits one fused OOF block per fold"
    );

    // Collect every fused (sample -> value) across folds.
    let fused: BTreeMap<String, f64> = merge_blocks
        .iter()
        .flat_map(|block| {
            block
                .sample_ids
                .iter()
                .zip(&block.values)
                .map(|(sample, row)| (sample.to_string(), row[0]))
        })
        .collect();
    // sample:1 was predicted by A only (B skipped it) -> average over A: 10.0.
    assert!(
        (fused["sample:1"] - 10.0).abs() < 1e-9,
        "asymmetric: sample:1 averages over the covering branch (A) only"
    );
    // Every other sample was predicted by both A (10) and B (20) -> mean 15.0.
    for sample in ["sample:2", "sample:3", "sample:4"] {
        assert!(
            (fused[sample] - 15.0).abs() < 1e-9,
            "{sample} averages both branches: (10+20)/2 = 15"
        );
    }

    // The fused output covers the full sample universe exactly once across folds
    // and passes the normal full-fold OOF completeness validation.
    let mut covered: Vec<String> = fused.keys().cloned().collect();
    covered.sort();
    assert_eq!(
        covered,
        vec![
            "sample:1".to_string(),
            "sample:2".to_string(),
            "sample:3".to_string(),
            "sample:4".to_string()
        ],
        "the fused OOF covers every sample exactly once"
    );
    let fold_set = plan.fold_set.as_ref().unwrap();
    crate::oof::validate_prediction_blocks_against_folds(fold_set, &[(*merge_blocks[0]).clone()])
        .expect("fused OOF block passes full-fold completeness");
    crate::oof::validate_prediction_blocks_against_folds(fold_set, &[(*merge_blocks[1]).clone()])
        .expect("fused OOF block passes full-fold completeness");

    // LEAKAGE: the fused block is a Validation (held-out) producer for the merge.
    for block in &merge_blocks {
        assert_eq!(
            block.partition,
            PredictionPartition::Validation,
            "fusion averages held-out OOF, never train predictions"
        );
    }

    // The merge is SCORED both per-fold and cross-fold (branches emit matching
    // y_true, reassembled onto the merge producer).
    ctx.collect_cross_fold_validation_scores(plan_oof_partition_mode(&plan))
        .unwrap();
    let avg: Vec<&crate::metrics::RegressionMetricReport> = ctx
        .score_collector
        .iter()
        .filter(|report| {
            report.producer_node == merge_id
                && report
                    .fold_id
                    .as_ref()
                    .is_some_and(|fold| fold.as_str() == "avg")
        })
        .collect();
    assert_eq!(
        avg.len(),
        1,
        "fusion merge producer has one cross-fold OOF average"
    );
    assert_eq!(
        avg[0].row_count, 4,
        "the merge OOF average covers the full universe"
    );

    // The merge lineage links both contributing branches per fold.
    let merge_lineage = ctx
        .lineage
        .records()
        .find(|record| {
            record.node_id == merge_id && record.fold_id.as_ref().unwrap().as_str() == "fold:0"
        })
        .expect("fusion merge recorded lineage");
    assert_eq!(
        merge_lineage.input_lineage.len(),
        2,
        "fusion merge lineage references both branch producers for the fold"
    );
}

#[test]
fn fusion_proba_mean_merge_averages_and_renormalizes_class_probabilities() {
    // The classification analogue: merge_mode="fusion_proba_mean" averages each
    // sample's per-class probability rows across duplication branches and
    // renormalizes to a valid distribution. Branch A emits [0.8, 0.2]; branch B
    // emits [0.4, 0.6]; the fused row is [0.6, 0.4] (mean, already summing to 1).
    let node_a = duplication_model_node("model:dup__A");
    let node_b = duplication_model_node("model:dup__B");
    let merge = fusion_merge_node(
        "merge:dup",
        &["model:dup__A", "model:dup__B"],
        "fusion_proba_mean",
    );
    let graph = GraphSpec {
        id: "graph:fusion.proba".to_string(),
        interface: GraphInterface::default(),
        nodes: vec![node_a, node_b, merge],
        edges: vec![
            branch_to_merge_edge("model:dup__A", "merge:dup"),
            branch_to_merge_edge("model:dup__B", "merge:dup"),
        ],
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    };
    let id_a = NodeId::new("model:dup__A").unwrap();
    let id_b = NodeId::new("model:dup__B").unwrap();
    let samples: Vec<SampleId> = ["sample:1", "sample:2"]
        .iter()
        .map(|s| SampleId::new(*s).unwrap())
        .collect();
    // Two disjoint folds (LOO over the 2 samples); each branch emits a proba row
    // for the fold's validated sample, and the merge fuses per fold.
    let fold_set = FoldSet {
        id: "folds:fusion.proba".to_string(),
        sample_ids: samples.clone(),
        folds: vec![
            FoldAssignment {
                fold_id: FoldId::new("fold:0").unwrap(),
                train_sample_ids: vec![samples[1].clone()],
                validation_sample_ids: vec![samples[0].clone()],
                metadata: BTreeMap::new(),
            },
            FoldAssignment {
                fold_id: FoldId::new("fold:1").unwrap(),
                train_sample_ids: vec![samples[0].clone()],
                validation_sample_ids: vec![samples[1].clone()],
                metadata: BTreeMap::new(),
            },
        ],
        sample_groups: BTreeMap::new(),
        partition_mode: FoldPartitionMode::Partition,
    };
    let campaign = CampaignSpec {
        inner_cv: None,
        id: "campaign:fusion.proba".to_string(),
        root_seed: Some(7),
        leakage_policy: Default::default(),
        aggregation_policy: Default::default(),
        split_invocation: Some(SplitInvocation {
            id: "split:fusion.proba".to_string(),
            controller_id: None,
            leakage_policy: Default::default(),
            params: BTreeMap::new(),
            fold_set: Some(fold_set),
        }),
        generation: Default::default(),
        shape_plans: BTreeMap::new(),
        data_bindings: BTreeMap::from([
            (id_a.clone(), vec![data_binding(&id_a)]),
            (id_b.clone(), vec![data_binding(&id_b)]),
        ]),
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    };
    let mut registry = ControllerRegistry::new();
    registry
        .register(controller_manifest("controller:model", NodeKind::Model))
        .unwrap();
    registry
        .register(merge_controller_manifest("controller:merge"))
        .unwrap();
    let plan = build_execution_plan("plan:fusion.proba", graph, campaign, &registry).unwrap();
    let envelope = sample_relations_envelope(&[("sample:1", "A"), ("sample:2", "B")]);
    let provider = InMemoryDataProvider::with_envelope(
        ControllerId::new("controller:data").unwrap(),
        envelope,
    )
    .unwrap();

    let merge_id = NodeId::new("merge:dup").unwrap();
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(ProbaBranchController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 1,
            rows: BTreeMap::from([
                ("model:dup__A".to_string(), vec![0.8, 0.2]),
                ("model:dup__B".to_string(), vec![0.4, 0.6]),
            ]),
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:fusion.proba").unwrap(), Some(7));

    SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::FitCv,
        )
        .unwrap();

    let merge_blocks: Vec<&PredictionBlock> = ctx
        .prediction_store
        .blocks()
        .iter()
        .filter(|block| block.producer_node == merge_id)
        .collect();
    assert_eq!(merge_blocks.len(), 2, "one fused proba block per fold");
    for block in &merge_blocks {
        for row in &block.values {
            assert!(
                (row[0] - 0.6).abs() < 1e-9 && (row[1] - 0.4).abs() < 1e-9,
                "fused proba row is the renormalized mean [0.6, 0.4], got {row:?}"
            );
            assert!(
                (row.iter().sum::<f64>() - 1.0).abs() < 1e-9,
                "fused proba row is a valid distribution (sums to 1)"
            );
        }
    }
}

/// A duplication-branch controller emitting a full-fold `Validation` block whose
/// rows are a per-node per-class probability vector (`rows[node_id]`), for the
/// proba-mean fusion test.
struct ProbaBranchController {
    id: ControllerId,
    handle: u64,
    rows: BTreeMap<String, Vec<f64>>,
}

impl RuntimeController for ProbaBranchController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        let node_id = task.node_plan.node_id.to_string();
        let fold_label = task
            .fold_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "nofold".to_string());
        let fold_validation_ids: Vec<SampleId> = task
            .data_views
            .iter()
            .find(|(_, view)| view.partition == DataRequestPartition::FoldValidation)
            .and_then(|(_, view)| view.sample_ids.clone())
            .unwrap_or_default();
        let row = self.rows.get(&node_id).cloned().unwrap_or_default();
        let prediction_output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Prediction,
            owner_controller: self.id.clone(),
        };
        let predictions = if task.phase == Phase::FitCv && !fold_validation_ids.is_empty() {
            vec![PredictionBlock {
                prediction_id: Some(format!("pred:{}", task.node_plan.node_id)),
                producer_node: task.node_plan.node_id.clone(),
                producer_port: None,
                partition: PredictionPartition::Validation,
                fold_id: task.fold_id.clone(),
                sample_ids: fold_validation_ids.clone(),
                values: fold_validation_ids.iter().map(|_| row.clone()).collect(),
                target_names: vec!["c0".to_string(), "c1".to_string()],
            }]
        } else {
            Vec::new()
        };
        Ok(NodeResult {
            schema_version: None,
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([
                ("pred".to_string(), prediction_output.clone()),
                ("oof".to_string(), prediction_output),
            ]),
            predictions,
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets: Vec::new(),
            lineage: LineageRecord {
                record_id: LineageId::new(format!("lineage:{node_id}:{fold_label}")).unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
                input_lineage: Vec::new(),
                artifact_refs: Vec::new(),
                params_fingerprint: task.node_plan.params_fingerprint.clone(),
                data_model_shape_fingerprint: None,
                aggregation_policy_fingerprint: None,
                seed: task.seed,
                unsafe_flags: BTreeSet::new(),
                metrics: BTreeMap::new(),
                loss_attestations: Vec::new(),
                early_stopping_records: Vec::new(),
            },
        })
    }
}

/// A model controller manifest that supports FIT_CV AND REFIT/PREDICT, so the
/// base branch nodes run in REFIT/PREDICT (the default `controller_manifest` is
/// FIT_CV-only). Used by the off-fold (test/predict) merge tests.
fn refit_capable_model_manifest(id: &str) -> ControllerManifest {
    let mut manifest = controller_manifest(id, NodeKind::Model);
    manifest.supported_phases = BTreeSet::from([Phase::FitCv, Phase::Refit, Phase::Predict]);
    manifest
}

/// Like [`scoring_merge_plan_and_provider`] but the model manifest supports
/// FIT_CV + REFIT + PREDICT, so the base branch nodes also run off-fold (REFIT
/// predicts the held-out test set). Used by the off-fold merge tests.
fn refit_merge_plan_and_provider(plan_id: &str) -> (ExecutionPlan, InMemoryDataProvider) {
    let node_a = branch_model_node("model:site__A", "A");
    let node_b = branch_model_node("model:site__B", "B");
    let merge = concat_merge_node("merge:sites", &["model:site__A", "model:site__B"]);
    let graph = GraphSpec {
        id: format!("graph:{plan_id}"),
        interface: GraphInterface::default(),
        nodes: vec![node_a, node_b, merge],
        edges: vec![
            branch_to_merge_edge("model:site__A", "merge:sites"),
            branch_to_merge_edge("model:site__B", "merge:sites"),
        ],
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    };
    let id_a = NodeId::new("model:site__A").unwrap();
    let id_b = NodeId::new("model:site__B").unwrap();
    let samples: Vec<SampleId> = ["sample:1", "sample:2", "sample:3", "sample:4"]
        .iter()
        .map(|s| SampleId::new(*s).unwrap())
        .collect();
    let fold_set = FoldSet {
        id: format!("folds:{plan_id}"),
        sample_ids: samples.clone(),
        folds: vec![
            FoldAssignment {
                fold_id: FoldId::new("fold:0").unwrap(),
                train_sample_ids: vec![samples[2].clone(), samples[3].clone()],
                validation_sample_ids: vec![samples[0].clone(), samples[1].clone()],
                metadata: BTreeMap::new(),
            },
            FoldAssignment {
                fold_id: FoldId::new("fold:1").unwrap(),
                train_sample_ids: vec![samples[0].clone(), samples[1].clone()],
                validation_sample_ids: vec![samples[2].clone(), samples[3].clone()],
                metadata: BTreeMap::new(),
            },
        ],
        sample_groups: BTreeMap::new(),
        partition_mode: FoldPartitionMode::Partition,
    };
    let campaign = CampaignSpec {
        inner_cv: None,
        id: format!("campaign:{plan_id}"),
        root_seed: Some(7),
        leakage_policy: Default::default(),
        aggregation_policy: Default::default(),
        split_invocation: Some(SplitInvocation {
            id: format!("split:{plan_id}"),
            controller_id: None,
            leakage_policy: Default::default(),
            params: BTreeMap::new(),
            fold_set: Some(fold_set),
        }),
        generation: Default::default(),
        shape_plans: BTreeMap::new(),
        data_bindings: BTreeMap::from([
            (id_a.clone(), vec![data_binding(&id_a)]),
            (id_b.clone(), vec![data_binding(&id_b)]),
        ]),
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    };
    let mut registry = ControllerRegistry::new();
    registry
        .register(refit_capable_model_manifest("controller:model"))
        .unwrap();
    registry
        .register(merge_controller_manifest("controller:merge"))
        .unwrap();
    let plan = build_execution_plan(plan_id, graph, campaign, &registry).unwrap();
    let envelope = sample_relations_envelope(&[
        ("sample:1", "A"),
        ("sample:2", "B"),
        ("sample:3", "A"),
        ("sample:4", "B"),
    ]);
    let provider = InMemoryDataProvider::with_envelope(
        ControllerId::new("controller:data").unwrap(),
        envelope,
    )
    .unwrap();
    (plan, provider)
}

/// A branch controller that emits per-partition OOF in FIT_CV (like
/// [`ScoringBranchController`]) AND, in REFIT, a `Test`-partition block over the
/// FULL-train view samples filtered to its site (the held-out test predictions a
/// base branch makes after refit), with matching `y_true`. The off-fold merge
/// reassembly reads exactly those REFIT `Test` blocks. `value_offset` lets a test
/// inject a per-site constant so the merged output is checkable; `0.0` makes the
/// prediction equal `y_true` (RMSE 0).
struct OffFoldScoringController {
    id: ControllerId,
    handle: u64,
    /// sample_id -> site (A/B), so a branch keeps only its partition's samples.
    sample_sites: BTreeMap<String, String>,
    /// constant added to every prediction (0.0 -> prediction == y_true).
    value_offset: f64,
}

impl RuntimeController for OffFoldScoringController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        let fold_label = task
            .fold_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "nofold".to_string());
        // FIT_CV reads the fold-validation view; REFIT reads the full-train view.
        // The PREDICT view carries no sample ids (new data), so PREDICT derives the
        // universe from the configured sites instead.
        let request_partition = match task.phase {
            Phase::FitCv => DataRequestPartition::FoldValidation,
            Phase::Predict => DataRequestPartition::Predict,
            _ => DataRequestPartition::FullTrain,
        };
        let view = task
            .data_views
            .iter()
            .find(|(_, view)| view.partition == request_partition)
            .map(|(_, view)| view);
        let branch_site = view
            .and_then(|view| view.branch_view.as_ref())
            .and_then(|branch| branch.selector.metadata.get("site"))
            .and_then(serde_json::Value::as_str);
        let view_ids: Vec<String> = match task.phase {
            // PREDICT: the view has no sample ids; use the full configured universe.
            Phase::Predict => self.sample_sites.keys().cloned().collect(),
            _ => view
                .and_then(|view| view.sample_ids.clone())
                .unwrap_or_default()
                .iter()
                .map(ToString::to_string)
                .collect(),
        };
        // Keep only this branch's partition (its site).
        let partition_ids: Vec<String> = match branch_site {
            Some(site) => view_ids
                .into_iter()
                .filter(|sample| {
                    self.sample_sites
                        .get(sample)
                        .map(|s| s == site)
                        .unwrap_or(false)
                })
                .collect(),
            None => view_ids,
        };
        let partition = match task.phase {
            Phase::FitCv => PredictionPartition::Validation,
            Phase::Predict => PredictionPartition::Final,
            _ => PredictionPartition::Test,
        };
        let (predictions, regression_targets) = if !partition_ids.is_empty() {
            let preds = vec![PredictionBlock {
                prediction_id: Some(format!("pred:{}", task.node_plan.node_id)),
                producer_node: task.node_plan.node_id.clone(),
                producer_port: None,
                partition,
                fold_id: task.fold_id.clone(),
                sample_ids: partition_ids
                    .iter()
                    .map(|s| SampleId::new(s).unwrap())
                    .collect(),
                values: partition_ids
                    .iter()
                    .map(|s| vec![ScoringBranchController::y_true(s) + self.value_offset])
                    .collect(),
                target_names: vec!["y".to_string()],
            }];
            let targets = vec![crate::metrics::RegressionTargetBlock {
                level: PredictionLevel::Sample,
                unit_ids: partition_ids
                    .iter()
                    .map(|s| {
                        crate::aggregation::PredictionUnitId::Sample(SampleId::new(s).unwrap())
                    })
                    .collect(),
                values: partition_ids
                    .iter()
                    .map(|s| vec![ScoringBranchController::y_true(s)])
                    .collect(),
                target_names: vec!["y".to_string()],
            }];
            (preds, targets)
        } else {
            (Vec::new(), Vec::new())
        };
        let prediction_output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Prediction,
            owner_controller: self.id.clone(),
        };
        let data_output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Data,
            owner_controller: self.id.clone(),
        };
        let variant_label = task
            .variant_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "base".to_string());
        Ok(NodeResult {
            schema_version: None,
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([
                ("pred".to_string(), prediction_output.clone()),
                ("oof".to_string(), prediction_output),
                ("x".to_string(), data_output),
            ]),
            predictions,
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets,
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:{}:{variant_label}:{}:{fold_label}",
                    task.node_plan.node_id,
                    task.phase.as_str()
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
                input_lineage: Vec::new(),
                artifact_refs: Vec::new(),
                params_fingerprint: task.node_plan.params_fingerprint.clone(),
                data_model_shape_fingerprint: None,
                aggregation_policy_fingerprint: None,
                seed: task.seed,
                unsafe_flags: BTreeSet::new(),
                metrics: BTreeMap::new(),
                loss_attestations: Vec::new(),
                early_stopping_records: Vec::new(),
            },
        })
    }
}

#[test]
fn concat_merge_reassembles_and_scores_refit_test_predictions() {
    // Backlog #16 (a): in REFIT the base branches predict the held-out TEST set
    // (PredictionPartition::Test, no fold). The off-fold concat reassembly must
    // join the disjoint per-site Test predictions into ONE Test block under the
    // merge producer, reassemble their y_true, and have it SCORED — so the concat
    // merge yields a best_rmse in REFIT, not just FIT_CV Validation OOF.
    let (plan, provider) = refit_merge_plan_and_provider("plan:merge.refit");
    let merge_id = NodeId::new("merge:sites").unwrap();
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(OffFoldScoringController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 1,
            sample_sites: merge_sample_sites(),
            value_offset: 0.0,
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:merge.refit").unwrap(), Some(7));

    SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::Refit,
        )
        .unwrap();

    // The merge node emits exactly ONE Test block (no fold), covering the union of
    // the disjoint per-site partitions = the full sample universe.
    let merge_blocks: Vec<&PredictionBlock> = ctx
        .prediction_store
        .blocks()
        .iter()
        .filter(|block| block.producer_node == merge_id)
        .collect();
    assert_eq!(
        merge_blocks.len(),
        1,
        "concat merge emits one reassembled REFIT test block"
    );
    let merged = merge_blocks[0];
    assert_eq!(merged.partition, PredictionPartition::Test);
    assert!(merged.fold_id.is_none(), "REFIT test block carries no fold");
    let mut ids: Vec<String> = merged.sample_ids.iter().map(ToString::to_string).collect();
    ids.sort();
    assert_eq!(
        ids,
        vec![
            "sample:1".to_string(),
            "sample:2".to_string(),
            "sample:3".to_string(),
            "sample:4".to_string(),
        ],
        "the reassembled test block covers the full universe exactly once"
    );

    // The merge producer is SCORED on the Test partition (offset 0 -> RMSE 0).
    let test_reports: Vec<&crate::metrics::RegressionMetricReport> = ctx
        .score_collector
        .iter()
        .filter(|report| {
            report.producer_node == merge_id && report.partition == PredictionPartition::Test
        })
        .collect();
    assert_eq!(
        test_reports.len(),
        1,
        "the concat merge produces one scored REFIT test report (best_rmse)"
    );
    assert_eq!(test_reports[0].row_count, 4);
    assert!(
        test_reports[0].metrics["rmse"].abs() < 1e-9,
        "offset 0 -> test RMSE 0"
    );
}

#[test]
fn fusion_merge_averages_and_scores_refit_test_predictions() {
    // Backlog #16 (a), fusion half: in REFIT two duplication branches each predict
    // the FULL test set; the off-fold fusion reassembly averages their Test
    // predictions per sample into one scored Test block. Branch A offset +2, branch
    // B offset -2 -> the mean equals y_true exactly (RMSE 0).
    let node_a = duplication_model_node("model:dup__A");
    let node_b = duplication_model_node("model:dup__B");
    let merge = fusion_merge_node("merge:dup", &["model:dup__A", "model:dup__B"], "fusion");
    let graph = GraphSpec {
        id: "graph:fusion.refit".to_string(),
        interface: GraphInterface::default(),
        nodes: vec![node_a, node_b, merge],
        edges: vec![
            branch_to_merge_edge("model:dup__A", "merge:dup"),
            branch_to_merge_edge("model:dup__B", "merge:dup"),
        ],
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    };
    let id_a = NodeId::new("model:dup__A").unwrap();
    let id_b = NodeId::new("model:dup__B").unwrap();
    let samples: Vec<SampleId> = ["sample:1", "sample:2"]
        .iter()
        .map(|s| SampleId::new(*s).unwrap())
        .collect();
    let fold_set = FoldSet {
        id: "folds:fusion.refit".to_string(),
        sample_ids: samples.clone(),
        folds: vec![
            FoldAssignment {
                fold_id: FoldId::new("fold:0").unwrap(),
                train_sample_ids: vec![samples[1].clone()],
                validation_sample_ids: vec![samples[0].clone()],
                metadata: BTreeMap::new(),
            },
            FoldAssignment {
                fold_id: FoldId::new("fold:1").unwrap(),
                train_sample_ids: vec![samples[0].clone()],
                validation_sample_ids: vec![samples[1].clone()],
                metadata: BTreeMap::new(),
            },
        ],
        sample_groups: BTreeMap::new(),
        partition_mode: FoldPartitionMode::Partition,
    };
    let campaign = CampaignSpec {
        inner_cv: None,
        id: "campaign:fusion.refit".to_string(),
        root_seed: Some(7),
        leakage_policy: Default::default(),
        aggregation_policy: Default::default(),
        split_invocation: Some(SplitInvocation {
            id: "split:fusion.refit".to_string(),
            controller_id: None,
            leakage_policy: Default::default(),
            params: BTreeMap::new(),
            fold_set: Some(fold_set),
        }),
        generation: Default::default(),
        shape_plans: BTreeMap::new(),
        data_bindings: BTreeMap::from([
            (id_a.clone(), vec![data_binding(&id_a)]),
            (id_b.clone(), vec![data_binding(&id_b)]),
        ]),
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    };
    let mut registry = ControllerRegistry::new();
    registry
        .register(refit_capable_model_manifest("controller:model"))
        .unwrap();
    registry
        .register(merge_controller_manifest("controller:merge"))
        .unwrap();
    let plan = build_execution_plan("plan:fusion.refit", graph, campaign, &registry).unwrap();
    let envelope = sample_relations_envelope(&[("sample:1", "A"), ("sample:2", "B")]);
    let provider = InMemoryDataProvider::with_envelope(
        ControllerId::new("controller:data").unwrap(),
        envelope,
    )
    .unwrap();

    let merge_id = NodeId::new("merge:dup").unwrap();
    let mut controllers = RuntimeControllerRegistry::new();
    // No branch_view: both duplication branches see the FULL test set. Offsets
    // +2 / -2 so the per-sample mean equals y_true.
    controllers
        .register(Box::new(OffFoldDuplicationController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 1,
            offsets: BTreeMap::from([
                ("model:dup__A".to_string(), 2.0),
                ("model:dup__B".to_string(), -2.0),
            ]),
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:fusion.refit").unwrap(), Some(7));

    SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::Refit,
        )
        .unwrap();

    let merge_blocks: Vec<&PredictionBlock> = ctx
        .prediction_store
        .blocks()
        .iter()
        .filter(|block| block.producer_node == merge_id)
        .collect();
    assert_eq!(merge_blocks.len(), 1, "one fused REFIT test block");
    let merged = merge_blocks[0];
    assert_eq!(merged.partition, PredictionPartition::Test);
    assert!(merged.fold_id.is_none());
    // The fused value is the per-sample mean of (+2) and (-2) offsets = y_true.
    for (sample_id, row) in merged.sample_ids.iter().zip(&merged.values) {
        let y = ScoringBranchController::y_true(sample_id.as_str());
        assert!(
            (row[0] - y).abs() < 1e-9,
            "fused test row equals y_true for {sample_id}"
        );
    }
    let test_reports: Vec<&crate::metrics::RegressionMetricReport> = ctx
        .score_collector
        .iter()
        .filter(|report| {
            report.producer_node == merge_id && report.partition == PredictionPartition::Test
        })
        .collect();
    assert_eq!(test_reports.len(), 1, "the fusion merge is scored in REFIT");
    assert!(
        test_reports[0].metrics["rmse"].abs() < 1e-9,
        "averaged offsets cancel -> test RMSE 0"
    );
}

/// A duplication-branch controller that, in REFIT, emits a full-test-set `Test`
/// block (`offsets[node_id]` added to each sample's y_true) plus matching y_true.
/// FIT_CV emits the analogous full-fold `Validation` block. Used by the off-fold
/// fusion REFIT test.
struct OffFoldDuplicationController {
    id: ControllerId,
    handle: u64,
    offsets: BTreeMap<String, f64>,
}

impl RuntimeController for OffFoldDuplicationController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        let node_id = task.node_plan.node_id.to_string();
        let fold_label = task
            .fold_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "nofold".to_string());
        let request_partition = match task.phase {
            Phase::FitCv => DataRequestPartition::FoldValidation,
            _ => DataRequestPartition::FullTrain,
        };
        let ids: Vec<String> = task
            .data_views
            .iter()
            .find(|(_, view)| view.partition == request_partition)
            .and_then(|(_, view)| view.sample_ids.clone())
            .unwrap_or_default()
            .iter()
            .map(ToString::to_string)
            .collect();
        let partition = match task.phase {
            Phase::FitCv => PredictionPartition::Validation,
            _ => PredictionPartition::Test,
        };
        let offset = *self.offsets.get(&node_id).unwrap_or(&0.0);
        let (predictions, regression_targets) = if !ids.is_empty() {
            let preds = vec![PredictionBlock {
                prediction_id: Some(format!("pred:{}", task.node_plan.node_id)),
                producer_node: task.node_plan.node_id.clone(),
                producer_port: None,
                partition,
                fold_id: task.fold_id.clone(),
                sample_ids: ids.iter().map(|s| SampleId::new(s).unwrap()).collect(),
                values: ids
                    .iter()
                    .map(|s| vec![ScoringBranchController::y_true(s) + offset])
                    .collect(),
                target_names: vec!["y".to_string()],
            }];
            let targets = vec![crate::metrics::RegressionTargetBlock {
                level: PredictionLevel::Sample,
                unit_ids: ids
                    .iter()
                    .map(|s| {
                        crate::aggregation::PredictionUnitId::Sample(SampleId::new(s).unwrap())
                    })
                    .collect(),
                values: ids
                    .iter()
                    .map(|s| vec![ScoringBranchController::y_true(s)])
                    .collect(),
                target_names: vec!["y".to_string()],
            }];
            (preds, targets)
        } else {
            (Vec::new(), Vec::new())
        };
        let prediction_output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Prediction,
            owner_controller: self.id.clone(),
        };
        Ok(NodeResult {
            schema_version: None,
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([
                ("pred".to_string(), prediction_output.clone()),
                ("oof".to_string(), prediction_output),
            ]),
            predictions,
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets,
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:{node_id}:{}:{fold_label}",
                    task.phase.as_str()
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
                input_lineage: Vec::new(),
                artifact_refs: Vec::new(),
                params_fingerprint: task.node_plan.params_fingerprint.clone(),
                data_model_shape_fingerprint: None,
                aggregation_policy_fingerprint: None,
                seed: task.seed,
                unsafe_flags: BTreeSet::new(),
                metrics: BTreeMap::new(),
                loss_attestations: Vec::new(),
                early_stopping_records: Vec::new(),
            },
        })
    }
}

#[test]
fn off_fold_merge_never_reads_fit_cv_validation_oof() {
    // Leakage invariant: the off-fold (REFIT) merge reassembly must read ONLY
    // non-Validation, no-fold blocks. Here the SAME context is reused across
    // FIT_CV then REFIT, so the store holds the FIT_CV Validation OOF blocks AND
    // the REFIT Test blocks. The merge's REFIT output must be built from the Test
    // blocks alone — never the Validation OOF — proving FIT_CV meta-features stay
    // Validation-only and are never recycled into the test/predict path.
    let (plan, provider) = refit_merge_plan_and_provider("plan:merge.leak");
    let merge_id = NodeId::new("merge:sites").unwrap();
    let mut controllers = RuntimeControllerRegistry::new();
    // FIT_CV predictions are y_true (offset 0); REFIT predictions are y_true + 100
    // so a leaked Validation OOF value would be detectable in the merged test block.
    controllers
        .register(Box::new(OffFoldScoringController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 1,
            sample_sites: merge_sample_sites(),
            value_offset: 100.0,
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:merge.leak").unwrap(), Some(7));

    // FIT_CV first: populates the store with Validation OOF blocks (offset 0).
    SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::FitCv,
        )
        .unwrap();

    // FIT_CV merge blocks are Validation (per fold) and untouched by the off-fold path.
    let fit_cv_validation_count = ctx
        .prediction_store
        .blocks()
        .iter()
        .filter(|block| {
            block.producer_node == merge_id && block.partition == PredictionPartition::Validation
        })
        .count();
    assert_eq!(
        fit_cv_validation_count, 2,
        "FIT_CV still emits the per-fold Validation OOF merge blocks (Validation-only)"
    );

    // Now REFIT in the same context. The off-fold reassembly must read only the
    // Test blocks (offset 100), never the Validation OOF (offset 0).
    SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::Refit,
        )
        .unwrap();

    let test_merge: Vec<&PredictionBlock> = ctx
        .prediction_store
        .blocks()
        .iter()
        .filter(|block| {
            block.producer_node == merge_id && block.partition == PredictionPartition::Test
        })
        .collect();
    assert_eq!(test_merge.len(), 1, "one off-fold Test merge block");
    for (sample_id, row) in test_merge[0].sample_ids.iter().zip(&test_merge[0].values) {
        let expected = ScoringBranchController::y_true(sample_id.as_str()) + 100.0;
        assert!(
            (row[0] - expected).abs() < 1e-9,
            "merged test value is the REFIT Test prediction (offset 100), not the leaked Validation OOF (offset 0) for {sample_id}: got {}",
            row[0]
        );
    }
    // The Validation OOF merge blocks are still Validation-only and unchanged.
    let validation_after = ctx
        .prediction_store
        .blocks()
        .iter()
        .filter(|block| {
            block.producer_node == merge_id && block.partition == PredictionPartition::Validation
        })
        .count();
    assert_eq!(
        validation_after, 2,
        "the off-fold REFIT path adds no Validation blocks and removes none"
    );
}

#[test]
fn refit_merge_consumes_only_test_partition_not_train_or_final() {
    // Fix 1: a REFIT merge must consume ONLY the phase-expected partition (Test),
    // never a stray Train block or a stale Final block left in the same context.
    // We pre-seed each branch with a Train and a Final block (no fold), then run
    // REFIT where the branches emit Test. The off-fold filter must reassemble the
    // Test blocks alone (value 0 -> RMSE 0) and ignore the Train/Final noise; if
    // it read non-Validation broadly it would trip the multi-block "mixes variants"
    // guard or fuse the wrong values.
    let (plan, provider) = refit_merge_plan_and_provider("plan:merge.testonly");
    let merge_id = NodeId::new("merge:sites").unwrap();
    let id_a = NodeId::new("model:site__A").unwrap();
    let id_b = NodeId::new("model:site__B").unwrap();
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(OffFoldScoringController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 1,
            sample_sites: merge_sample_sites(),
            value_offset: 0.0,
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:merge.testonly").unwrap(), Some(7));

    // Pre-seed Train + Final noise for each branch (no fold, non-Validation, but
    // NOT the phase-expected Test partition). A naive "non-Validation" filter would
    // pick these up.
    for (branch, site_sample) in [(&id_a, "sample:1"), (&id_b, "sample:2")] {
        ctx.prediction_store
            .append(PredictionBlock {
                prediction_id: Some(format!("noise:train:{branch}")),
                producer_node: branch.clone(),
                producer_port: None,
                partition: PredictionPartition::Train,
                fold_id: None,
                sample_ids: vec![SampleId::new(site_sample).unwrap()],
                values: vec![vec![999.0]],
                target_names: vec!["y".to_string()],
            })
            .unwrap();
        ctx.prediction_store
            .append(PredictionBlock {
                prediction_id: Some(format!("noise:final:{branch}")),
                producer_node: branch.clone(),
                producer_port: None,
                partition: PredictionPartition::Final,
                fold_id: None,
                sample_ids: vec![SampleId::new(site_sample).unwrap()],
                values: vec![vec![-999.0]],
                target_names: vec!["y".to_string()],
            })
            .unwrap();
    }

    SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::Refit,
        )
        .unwrap();

    let merge_blocks: Vec<&PredictionBlock> = ctx
        .prediction_store
        .blocks()
        .iter()
        .filter(|block| block.producer_node == merge_id)
        .collect();
    assert_eq!(
        merge_blocks.len(),
        1,
        "the REFIT merge emits exactly one Test block despite Train/Final noise"
    );
    let merged = merge_blocks[0];
    assert_eq!(
        merged.partition,
        PredictionPartition::Test,
        "the merge consumed the Test partition, not Train/Final"
    );
    // Values are the Test predictions (offset 0 -> y_true), never 999 / -999.
    for (sample_id, row) in merged.sample_ids.iter().zip(&merged.values) {
        let y = ScoringBranchController::y_true(sample_id.as_str());
        assert!(
            (row[0] - y).abs() < 1e-9,
            "merged value is the Test prediction for {sample_id}, not the Train/Final noise: {}",
            row[0]
        );
    }
    let test_reports = ctx
        .score_collector
        .iter()
        .filter(|report| {
            report.producer_node == merge_id && report.partition == PredictionPartition::Test
        })
        .count();
    assert_eq!(test_reports, 1, "the Test merge is scored");
}

#[test]
fn predict_after_refit_in_one_context_picks_final_cleanly() {
    // Fix 1: a PREDICT that runs AFTER a REFIT in the SAME RunContext must consume
    // the Final partition cleanly — the REFIT Test blocks from the earlier phase
    // are still in the store, so a broad "non-Validation" read would see BOTH Test
    // and Final per branch and error with "mixes variants". The phase-expected
    // filter (PREDICT -> Final) selects Final only.
    let (plan, provider) = refit_merge_plan_and_provider("plan:merge.refit.then.predict");
    let merge_id = NodeId::new("merge:sites").unwrap();
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(OffFoldScoringController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 1,
            sample_sites: merge_sample_sites(),
            value_offset: 0.0,
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:merge.refit.then.predict").unwrap(), Some(7));

    // REFIT first: base branches emit Test, the merge reassembles a Test block.
    SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::Refit,
        )
        .unwrap();
    assert_eq!(
        ctx.prediction_store
            .blocks()
            .iter()
            .filter(|block| block.partition == PredictionPartition::Test)
            .count(),
        3,
        "REFIT left Test blocks (2 base + 1 merge) in the context"
    );

    // PREDICT next in the SAME context: base branches emit Final, the merge must
    // pick Final cleanly (no 'mixes variants' from the lingering Test blocks).
    SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::Predict,
        )
        .unwrap();

    let final_merge: Vec<&PredictionBlock> = ctx
        .prediction_store
        .blocks()
        .iter()
        .filter(|block| {
            block.producer_node == merge_id && block.partition == PredictionPartition::Final
        })
        .collect();
    assert_eq!(
        final_merge.len(),
        1,
        "PREDICT emits exactly one Final merge block, picking Final cleanly"
    );
    let mut ids: Vec<String> = final_merge[0]
        .sample_ids
        .iter()
        .map(ToString::to_string)
        .collect();
    ids.sort();
    assert_eq!(
        ids,
        vec![
            "sample:1".to_string(),
            "sample:2".to_string(),
            "sample:3".to_string(),
            "sample:4".to_string(),
        ],
        "the Final merge covers the full predict universe"
    );
    // The REFIT Test merge block is still present and untouched.
    assert_eq!(
        ctx.prediction_store
            .blocks()
            .iter()
            .filter(|block| {
                block.producer_node == merge_id && block.partition == PredictionPartition::Test
            })
            .count(),
        1,
        "the earlier REFIT Test merge block is untouched"
    );
}

#[test]
fn off_fold_fusion_rejects_within_branch_duplicate_sample() {
    // Fix 2: off-fold fusion must reject a within-branch duplicate sample_id (the
    // reducer would otherwise double-count it). One branch emits two rows for the
    // SAME sample in its REFIT Test block; the fusion reassembly must error.
    let node_a = duplication_model_node("model:dup__A");
    let node_b = duplication_model_node("model:dup__B");
    let merge = fusion_merge_node("merge:dup", &["model:dup__A", "model:dup__B"], "fusion");
    let graph = GraphSpec {
        id: "graph:fusion.dup".to_string(),
        interface: GraphInterface::default(),
        nodes: vec![node_a, node_b, merge],
        edges: vec![
            branch_to_merge_edge("model:dup__A", "merge:dup"),
            branch_to_merge_edge("model:dup__B", "merge:dup"),
        ],
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    };
    let id_a = NodeId::new("model:dup__A").unwrap();
    let id_b = NodeId::new("model:dup__B").unwrap();
    let samples: Vec<SampleId> = ["sample:1", "sample:2"]
        .iter()
        .map(|s| SampleId::new(*s).unwrap())
        .collect();
    let fold_set = FoldSet {
        id: "folds:fusion.dup".to_string(),
        sample_ids: samples.clone(),
        folds: vec![
            FoldAssignment {
                fold_id: FoldId::new("fold:0").unwrap(),
                train_sample_ids: vec![samples[1].clone()],
                validation_sample_ids: vec![samples[0].clone()],
                metadata: BTreeMap::new(),
            },
            FoldAssignment {
                fold_id: FoldId::new("fold:1").unwrap(),
                train_sample_ids: vec![samples[0].clone()],
                validation_sample_ids: vec![samples[1].clone()],
                metadata: BTreeMap::new(),
            },
        ],
        sample_groups: BTreeMap::new(),
        partition_mode: FoldPartitionMode::Partition,
    };
    let campaign = CampaignSpec {
        inner_cv: None,
        id: "campaign:fusion.dup".to_string(),
        root_seed: Some(7),
        leakage_policy: Default::default(),
        aggregation_policy: Default::default(),
        split_invocation: Some(SplitInvocation {
            id: "split:fusion.dup".to_string(),
            controller_id: None,
            leakage_policy: Default::default(),
            params: BTreeMap::new(),
            fold_set: Some(fold_set),
        }),
        generation: Default::default(),
        shape_plans: BTreeMap::new(),
        data_bindings: BTreeMap::from([
            (id_a.clone(), vec![data_binding(&id_a)]),
            (id_b.clone(), vec![data_binding(&id_b)]),
        ]),
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    };
    let mut registry = ControllerRegistry::new();
    registry
        .register(refit_capable_model_manifest("controller:model"))
        .unwrap();
    registry
        .register(merge_controller_manifest("controller:merge"))
        .unwrap();
    let plan = build_execution_plan("plan:fusion.dup", graph, campaign, &registry).unwrap();
    let envelope = sample_relations_envelope(&[("sample:1", "A"), ("sample:2", "B")]);
    let provider = InMemoryDataProvider::with_envelope(
        ControllerId::new("controller:data").unwrap(),
        envelope,
    )
    .unwrap();

    let id_a = NodeId::new("model:dup__A").unwrap();
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(DuplicateSampleBranchController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 1,
            duplicate_branch: id_a,
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:fusion.dup").unwrap(), Some(7));

    let error = SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::Refit,
        )
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("duplicate prediction for sample"),
        "off-fold fusion must reject a within-branch duplicate sample, got: {error}"
    );
}

/// A duplication-branch controller for the within-branch-duplicate fusion test:
/// in REFIT, `duplicate_branch` emits a `Test` block with the SAME sample id
/// twice; the other branch emits a clean single-row block. Off-fold fusion must
/// reject the duplicate before reducing.
struct DuplicateSampleBranchController {
    id: ControllerId,
    handle: u64,
    duplicate_branch: NodeId,
}

impl RuntimeController for DuplicateSampleBranchController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        let node_id = task.node_plan.node_id.clone();
        let predictions = if task.phase == Phase::Refit {
            let sample_ids = if node_id == self.duplicate_branch {
                // Same sample id twice (the within-branch duplicate).
                vec![
                    SampleId::new("sample:1").unwrap(),
                    SampleId::new("sample:1").unwrap(),
                ]
            } else {
                vec![SampleId::new("sample:1").unwrap()]
            };
            vec![PredictionBlock {
                prediction_id: Some(format!("pred:{node_id}")),
                producer_node: node_id.clone(),
                producer_port: None,
                partition: PredictionPartition::Test,
                fold_id: None,
                sample_ids: sample_ids.clone(),
                values: sample_ids.iter().map(|_| vec![1.0]).collect(),
                target_names: vec!["y".to_string()],
            }]
        } else {
            Vec::new()
        };
        let prediction_output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Prediction,
            owner_controller: self.id.clone(),
        };
        Ok(NodeResult {
            schema_version: None,
            node_id: node_id.clone(),
            outputs: BTreeMap::from([
                ("pred".to_string(), prediction_output.clone()),
                ("oof".to_string(), prediction_output),
            ]),
            predictions,
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets: Vec::new(),
            lineage: LineageRecord {
                record_id: LineageId::new(format!("lineage:dup:{node_id}:{}", task.phase.as_str()))
                    .unwrap(),
                run_id: task.run_id.clone(),
                node_id,
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
                input_lineage: Vec::new(),
                artifact_refs: Vec::new(),
                params_fingerprint: task.node_plan.params_fingerprint.clone(),
                data_model_shape_fingerprint: None,
                aggregation_policy_fingerprint: None,
                seed: task.seed,
                unsafe_flags: BTreeSet::new(),
                metrics: BTreeMap::new(),
                loss_attestations: Vec::new(),
                early_stopping_records: Vec::new(),
            },
        })
    }
}

/// A stacking base + meta controller for the off-fold (REFIT) meta-feature
/// delivery test. `model:base` emits a Validation OOF block per fold in FIT_CV
/// AND a `Test` block (no fold, both samples, value 0.9) in REFIT. `model:meta`,
/// in REFIT, asserts it received BOTH the Validation-OOF `model:base.pred` input
/// (cross-fold, Validation partition) AND the SEPARATE off-fold `model:base.pred:refit`
/// input carrying the Test values — never mixing them.
struct StackingOffFoldController {
    id: ControllerId,
}

impl RuntimeController for StackingOffFoldController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        if task.node_plan.node_id.as_str() == "model:meta" {
            // The Validation OOF input is always present and Validation-only.
            let oof = task
                .prediction_inputs
                .get("model:base.pred")
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation("meta missing Validation OOF input".to_string())
                })?;
            if oof.partition != PredictionPartition::Validation {
                return Err(DagMlError::RuntimeValidation(format!(
                    "meta Validation OOF input has partition {:?}, expected Validation",
                    oof.partition
                )));
            }
            if task.phase == Phase::Refit {
                // The SEPARATE off-fold input carries the base Test predictions.
                let test = task
                    .prediction_inputs
                    .get("model:base.pred:refit")
                    .ok_or_else(|| {
                        DagMlError::RuntimeValidation(
                            "meta missing off-fold (test) prediction input".to_string(),
                        )
                    })?;
                if test.partition != PredictionPartition::Test
                    || test.fold_id.is_some()
                    || test.sample_ids
                        != vec![SampleId::new("s1").unwrap(), SampleId::new("s2").unwrap()]
                    || test.values != vec![vec![0.9], vec![0.9]]
                    || test.prediction_width != 1
                {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "meta off-fold test input is malformed: partition={:?} fold={:?} samples={:?} values={:?}",
                        test.partition, test.fold_id, test.sample_ids, test.values
                    )));
                }
            }
        }

        let predictions = if task.node_plan.node_id.as_str() == "model:base" {
            match task.phase {
                Phase::FitCv => {
                    let samples = aligned_validation_samples(task);
                    vec![PredictionBlock {
                        prediction_id: Some("pred:model:base".to_string()),
                        producer_node: task.node_plan.node_id.clone(),
                        producer_port: None,
                        partition: PredictionPartition::Validation,
                        fold_id: task.fold_id.clone(),
                        sample_ids: samples.clone(),
                        values: vec![vec![0.5]; samples.len()],
                        target_names: vec!["y".to_string()],
                    }]
                }
                Phase::Refit => {
                    let samples = vec![SampleId::new("s1").unwrap(), SampleId::new("s2").unwrap()];
                    vec![PredictionBlock {
                        prediction_id: Some("pred:model:base:test".to_string()),
                        producer_node: task.node_plan.node_id.clone(),
                        producer_port: None,
                        partition: PredictionPartition::Test,
                        fold_id: None,
                        sample_ids: samples.clone(),
                        values: vec![vec![0.9]; samples.len()],
                        target_names: vec!["y".to_string()],
                    }]
                }
                _ => Vec::new(),
            }
        } else {
            Vec::new()
        };

        let handle_id = if task.node_plan.node_id.as_str() == "model:base" {
            301
        } else {
            302
        };
        Ok(NodeResult {
            schema_version: None,
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([(
                "pred".to_string(),
                HandleRef {
                    handle: handle_id,
                    kind: HandleKind::Data,
                    owner_controller: self.id.clone(),
                },
            )]),
            predictions,
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets: Vec::new(),
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:stack:{}:{}:{}",
                    task.node_plan.node_id,
                    task.phase.as_str(),
                    task.fold_id
                        .as_ref()
                        .map(ToString::to_string)
                        .unwrap_or_else(|| "nofold".to_string())
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
                input_lineage: Vec::new(),
                artifact_refs: Vec::new(),
                params_fingerprint: task.node_plan.params_fingerprint.clone(),
                data_model_shape_fingerprint: None,
                aggregation_policy_fingerprint: None,
                seed: task.seed,
                unsafe_flags: BTreeSet::new(),
                metrics: BTreeMap::new(),
                loss_attestations: Vec::new(),
                early_stopping_records: Vec::new(),
            },
        })
    }
}

#[test]
fn stacking_meta_node_receives_base_test_predictions_in_refit() {
    // Backlog #16 (b): a stacking meta-node receives the base node's REFIT test
    // predictions as a SEPARATE prediction input (`model:base.pred:refit`,
    // partition Test, carrying values), alongside the unchanged Validation-OOF
    // input (`model:base.pred`). The host meta-model predicts the test set from
    // the off-fold input; the Validation OOF stays the FIT_CV training feature.
    let plan = build_execution_plan(
        "plan:stack.offfold",
        oof_edge_graph(),
        oof_edge_campaign(),
        &oof_edge_manifests(BTreeSet::from([Phase::FitCv, Phase::Refit])),
    )
    .unwrap();
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(StackingOffFoldController {
            id: ControllerId::new("controller:model").unwrap(),
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:stack.offfold").unwrap(), Some(11));

    // FIT_CV populates Validation OOF for the base (2 folds).
    SequentialScheduler
        .execute_campaign_phase(&plan, &controllers, &mut ctx, Phase::FitCv)
        .unwrap();
    assert_eq!(
        ctx.prediction_store
            .blocks()
            .iter()
            .filter(|block| block.partition == PredictionPartition::Validation)
            .count(),
        2,
        "FIT_CV recorded the base Validation OOF (Validation-only)"
    );

    // REFIT: the base emits a Test block; the meta-node's invoke asserts it
    // received both inputs correctly (the controller errors otherwise).
    let refit_results = SequentialScheduler
        .execute_campaign_phase(&plan, &controllers, &mut ctx, Phase::Refit)
        .unwrap();
    assert_eq!(
        refit_results
            .iter()
            .filter(|result| result.node_id.as_str() == "model:meta")
            .count(),
        1,
        "the meta-node ran in REFIT and accepted the off-fold test input"
    );
}

fn sample_relations_envelope(rows: &[(&str, &str)]) -> ExternalDataPlanEnvelope {
    let records = rows
        .iter()
        .map(|(sample, site)| {
            let mut relation = SampleRelation::new(
                ObservationId::new(format!("obs:{}", sample.replace(':', "."))).unwrap(),
                SampleId::new(*sample).unwrap(),
            );
            relation
                .metadata
                .insert("site".to_string(), serde_json::json!(site));
            relation
        })
        .collect::<Vec<_>>();
    let relations = SampleRelationSet { records };
    relations.validate().unwrap();
    // Match the data_binding() helper's fingerprints so the provider accepts the
    // binding; require_relations is satisfied by coordinator_relations presence.
    ExternalDataPlanEnvelope {
        schema_version: crate::data::EXTERNAL_DATA_PLAN_ENVELOPE_SCHEMA_VERSION,
        schema_fingerprint: "f97b37872fa22134b508f98fd8e207e5b776b52594fb8f6f5c3e15bee212246b"
            .to_string(),
        plan_fingerprint: "7c5431d85574b3f337022fa5d25971d5b5cf445b90331b49938f573ff6901e4d"
            .to_string(),
        relation_fingerprint: Some(
            "a3a7e329df35db9f2883a17b8611b7fae6dcaa031875e3ec2c9be1b9e29cbe10".to_string(),
        ),
        data_content_fingerprint: None,
        target_content_fingerprint: None,
        coordinator_relations: Some(relations),
        predict_cohort: None,
    }
}

/// R-P2-22 (REFIT-EXCLUDES-TEST): the REFIT final-fit universe (`DataRequestPartition::FullTrain`)
/// is exactly the fold set's train pool (`fold_set.sample_ids`), which the splitter partitioned into
/// train/validation folds. A held-out TEST sample is never passed to the splitter — it is requested
/// separately via `DataRequestPartition::Predict` (host-resolved, `sample_ids == None`) — so it can
/// never appear in the refit universe. This pins both halves of that invariant.
#[test]
fn refit_full_train_universe_excludes_held_out_test_partition() {
    let train: Vec<SampleId> = ["sample:1", "sample:2", "sample:3", "sample:4"]
        .iter()
        .map(|s| SampleId::new(*s).unwrap())
        .collect();
    let fold_set = FoldSet {
        id: "folds:refit.universe".to_string(),
        sample_ids: train.clone(),
        folds: vec![
            FoldAssignment {
                fold_id: FoldId::new("fold:0").unwrap(),
                train_sample_ids: vec![train[2].clone(), train[3].clone()],
                validation_sample_ids: vec![train[0].clone(), train[1].clone()],
                metadata: BTreeMap::new(),
            },
            FoldAssignment {
                fold_id: FoldId::new("fold:1").unwrap(),
                train_sample_ids: vec![train[0].clone(), train[1].clone()],
                validation_sample_ids: vec![train[2].clone(), train[3].clone()],
                metadata: BTreeMap::new(),
            },
        ],
        sample_groups: BTreeMap::new(),
        partition_mode: FoldPartitionMode::Partition,
    };
    fold_set.validate().unwrap();

    // REFIT resolves to FullTrain; its universe is exactly the fold (train) pool.
    let refit_universe =
        sample_ids_for_partition(DataRequestPartition::FullTrain, Some(&fold_set), None)
            .expect("FullTrain yields the fold-set universe");
    assert_eq!(
        refit_universe, train,
        "REFIT FullTrain universe is exactly the splitter's train pool"
    );

    // A held-out test sample — present in NEITHER fold and NOT in fold_set.sample_ids — is
    // structurally absent from the refit universe (the splitter never saw it).
    let held_out_test = SampleId::new("sample:test_only").unwrap();
    assert!(
        !refit_universe.contains(&held_out_test),
        "the held-out test partition can never enter the refit training universe"
    );

    // The TEST/PREDICT partition is host-resolved: the core enumerates no sample ids for it,
    // so it cannot be conflated with the fold universe.
    assert!(
        sample_ids_for_partition(DataRequestPartition::Predict, Some(&fold_set), None).is_none(),
        "Predict (test/final) is host-resolved, never enumerated from the fold set"
    );
}

// ===========================================================================================
// C Phase 4 (EXECUTION) — native operator-level generators: prune_plan_to_active +
// select_best_operator_variant_by_cv. The union is a STACKING graph
// (`filter -> choice_i(transform -> model) -> merge:gen (oof) -> model:meta`); operator `_or_` is
// SELECT, so each candidate is the union PRUNED to one choice (merge + meta + sibling choices
// elided) and scored on its own pruned plan. The winner = the lower-RMSE choice.
// ===========================================================================================

/// Scores a model node by `node_id` -> RMSE offset: `model:choice0__pls` predicts y_true exactly
/// (offset 0 -> RMSE 0, the winner), `model:choice1__ridge` predicts y_true + 1 (offset 1). Mirrors
/// `VariantScoringController` but keys the offset off the operator-choice's model NODE rather than a
/// param override, which is how operator `_or_` distinguishes choices.
struct OperatorScoringController {
    id: ControllerId,
    handle: u64,
    offsets: BTreeMap<NodeId, f64>,
}

impl OperatorScoringController {
    fn fold_sample(task: &NodeTask) -> Option<(SampleId, f64)> {
        match task.fold_id.as_ref()?.as_str() {
            "fold:0" => Some((SampleId::new("s1").unwrap(), 1.0)),
            "fold:1" => Some((SampleId::new("s2").unwrap(), 2.0)),
            _ => None,
        }
    }
}

impl RuntimeController for OperatorScoringController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        let output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Prediction,
            owner_controller: self.id.clone(),
        };
        let mut predictions = Vec::new();
        let mut regression_targets = Vec::new();
        if let Some((sample_id, y_true)) = Self::fold_sample(task) {
            let offset = self
                .offsets
                .get(&task.node_plan.node_id)
                .copied()
                .unwrap_or(0.0);
            predictions.push(PredictionBlock {
                prediction_id: Some(format!("pred:{}", task.node_plan.node_id)),
                producer_node: task.node_plan.node_id.clone(),
                producer_port: None,
                partition: PredictionPartition::Validation,
                fold_id: task.fold_id.clone(),
                sample_ids: vec![sample_id.clone()],
                values: vec![vec![y_true + offset]],
                target_names: vec!["y".to_string()],
            });
            regression_targets.push(crate::metrics::RegressionTargetBlock {
                level: PredictionLevel::Sample,
                unit_ids: vec![crate::aggregation::PredictionUnitId::Sample(sample_id)],
                values: vec![vec![y_true]],
                target_names: vec!["y".to_string()],
            });
        }
        let variant_label = task
            .variant_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "base".to_string());
        let fold_label = task
            .fold_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "nofold".to_string());
        Ok(NodeResult {
            schema_version: None,
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([("oof".to_string(), output)]),
            predictions,
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets,
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:{}:{:?}:{variant_label}:{fold_label}",
                    task.node_plan.node_id, task.phase
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
                input_lineage: Vec::new(),
                artifact_refs: Vec::new(),
                params_fingerprint: task.node_plan.params_fingerprint.clone(),
                data_model_shape_fingerprint: None,
                aggregation_policy_fingerprint: None,
                seed: task.seed,
                unsafe_flags: BTreeSet::new(),
                metrics: BTreeMap::new(),
                loss_attestations: Vec::new(),
                early_stopping_records: Vec::new(),
            },
        })
    }
}

/// Build the operator-SELECT UNION fixture: a hand-built STACKING graph mirroring the parity DSL —
/// `filter:y_outlier` (shared prefix) feeds two operator choices, each `transform -> model`, whose
/// models fan into `merge:gen` (OOF) -> `model:meta` — plus the matching `OperatorVariantModel`
/// (one `active_subsequence`-only choice per sub-sequence). The plan validates as a full union; the
/// model's active_nodes name exactly each choice's `{transform, model}`.
fn operator_select_union() -> (ExecutionPlan, OperatorVariantModel) {
    let filter = "filter:y_outlier";
    let (t0, m0) = ("transform:choice0__snv", "model:choice0__pls");
    let (t1, m1) = ("transform:choice1__msc", "model:choice1__ridge");
    let merge = "merge:gen";
    let meta = "model:meta";

    let data_edge = |source: &str, sport: &str, target: &str| EdgeSpec {
        source: PortRef {
            node_id: NodeId::new(source).unwrap(),
            port_name: sport.to_string(),
        },
        target: PortRef {
            node_id: NodeId::new(target).unwrap(),
            port_name: "x".to_string(),
        },
        contract: EdgeContract {
            requires_oof: false,
            requires_fold_alignment: false,
            ..EdgeContract::new(PortKind::Data, None)
        },
    };
    let oof_edge = |source: &str, target_port: &str| EdgeSpec {
        source: PortRef {
            node_id: NodeId::new(source).unwrap(),
            port_name: "oof".to_string(),
        },
        target: PortRef {
            node_id: NodeId::new(merge).unwrap(),
            port_name: target_port.to_string(),
        },
        contract: EdgeContract {
            requires_oof: true,
            requires_fold_alignment: false,
            ..EdgeContract::new(PortKind::Prediction, None)
        },
    };

    let graph = GraphSpec {
        id: "g:operator.select".to_string(),
        interface: GraphInterface::default(),
        nodes: vec![
            node(
                filter,
                NodeKind::Exclude,
                vec![port("x", PortKind::Data)],
                vec![port("x", PortKind::Data)],
            ),
            node(
                t0,
                NodeKind::Transform,
                vec![port("x", PortKind::Data)],
                vec![port("x", PortKind::Data)],
            ),
            node(
                m0,
                NodeKind::Model,
                vec![port("x", PortKind::Data)],
                vec![port("oof", PortKind::Prediction)],
            ),
            node(
                t1,
                NodeKind::Transform,
                vec![port("x", PortKind::Data)],
                vec![port("x", PortKind::Data)],
            ),
            node(
                m1,
                NodeKind::Model,
                vec![port("x", PortKind::Data)],
                vec![port("oof", PortKind::Prediction)],
            ),
            node(
                merge,
                NodeKind::PredictionJoin,
                vec![
                    port("c0", PortKind::Prediction),
                    port("c1", PortKind::Prediction),
                ],
                vec![port("x", PortKind::Data)],
            ),
            node(
                meta,
                NodeKind::Model,
                vec![port("x", PortKind::Data)],
                vec![port("oof", PortKind::Prediction)],
            ),
        ],
        edges: vec![
            data_edge(filter, "x", t0),
            data_edge(t0, "x", m0),
            data_edge(filter, "x", t1),
            data_edge(t1, "x", m1),
            oof_edge(m0, "c0"),
            oof_edge(m1, "c1"),
            data_edge(merge, "x", meta),
        ],
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    };

    let campaign = CampaignSpec {
        inner_cv: None,
        id: "campaign:operator.select".to_string(),
        root_seed: Some(7),
        leakage_policy: Default::default(),
        aggregation_policy: Default::default(),
        split_invocation: Some(SplitInvocation {
            id: "split:outer".to_string(),
            controller_id: None,
            leakage_policy: Default::default(),
            params: BTreeMap::new(),
            fold_set: Some(two_fold_set()),
        }),
        generation: Default::default(),
        shape_plans: BTreeMap::new(),
        data_bindings: BTreeMap::new(),
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    };

    let plan = build_execution_plan(
        "plan:operator.select",
        graph,
        campaign,
        &operator_select_manifests(),
    )
    .unwrap();

    let active_nodes = BTreeMap::from([
        (
            "choice0".to_string(),
            BTreeSet::from([NodeId::new(t0).unwrap(), NodeId::new(m0).unwrap()]),
        ),
        (
            "choice1".to_string(),
            BTreeSet::from([NodeId::new(t1).unwrap(), NodeId::new(m1).unwrap()]),
        ),
    ]);
    let model = OperatorVariantModel {
        generator_id: NodeId::new("generator:preproc_model").unwrap(),
        dimension: GenerationDimension {
            name: "generator:preproc_model.operators".to_string(),
            choices: vec![
                GenerationChoice {
                    label: "choice0".to_string(),
                    value: json!("choice0"),
                    param_overrides: Vec::new(),
                    active_subsequence: Some("choice0".to_string()),
                },
                GenerationChoice {
                    label: "choice1".to_string(),
                    value: json!("choice1"),
                    param_overrides: Vec::new(),
                    active_subsequence: Some("choice1".to_string()),
                },
            ],
        },
        active_nodes,
        variant_labels: BTreeMap::new(),
    };
    model.validate().unwrap();
    (plan, model)
}

fn operator_select_manifests() -> crate::controller::ControllerRegistry {
    let mut manifests = crate::controller::ControllerRegistry::new();
    manifests
        .register(controller_manifest(
            "controller:transform",
            NodeKind::Transform,
        ))
        .unwrap();
    manifests
        .register(controller_manifest("controller:model", NodeKind::Model))
        .unwrap();
    // The shared-prefix filter and the stacking merge get their own manifests so the union plan
    // validates (the OOF edge target must declare consumes_oof_predictions).
    let mut filter_manifest = controller_manifest("controller:filter", NodeKind::Exclude);
    filter_manifest.supported_phases = BTreeSet::from([Phase::FitCv, Phase::Refit, Phase::Predict]);
    manifests.register(filter_manifest).unwrap();
    let mut merge_manifest = controller_manifest("controller:merge", NodeKind::PredictionJoin);
    merge_manifest
        .capabilities
        .insert(ControllerCapability::EmitsPredictions);
    merge_manifest
        .capabilities
        .insert(ControllerCapability::ConsumesOofPredictions);
    merge_manifest.supported_phases = BTreeSet::from([Phase::FitCv, Phase::Refit, Phase::Predict]);
    manifests.register(merge_manifest).unwrap();
    manifests
}

fn operator_select_controllers() -> RuntimeControllerRegistry {
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(MockController {
            id: ControllerId::new("controller:filter").unwrap(),
            handle: 1,
            emit_prediction: false,
        }))
        .unwrap();
    controllers
        .register(Box::new(MockController {
            id: ControllerId::new("controller:transform").unwrap(),
            handle: 2,
            emit_prediction: false,
        }))
        .unwrap();
    controllers
        .register(Box::new(OperatorScoringController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 3,
            offsets: BTreeMap::from([
                (NodeId::new("model:choice0__pls").unwrap(), 0.0),
                (NodeId::new("model:choice1__ridge").unwrap(), 1.0),
            ]),
        }))
        .unwrap();
    controllers
}

/// Re-enumerate the model's variants and return `(variant, active_nodes, all_choice_nodes)` for the
/// choice whose `active_subsequence` matches `choice_key`.
fn operator_variant_for_choice<'a>(
    model: &'a OperatorVariantModel,
    choice_key: &str,
) -> (VariantPlan, &'a BTreeSet<NodeId>, BTreeSet<NodeId>) {
    let variants = enumerate_variants(&model.generation_spec(), Some(7)).unwrap();
    let variant = variants
        .into_iter()
        .find(|variant| {
            variant
                .choices
                .get(&model.dimension.name)
                .and_then(|choice| choice.active_subsequence.as_deref())
                == Some(choice_key)
        })
        .unwrap();
    let active_nodes = model.active_nodes.get(choice_key).unwrap();
    let all_choice_nodes = model
        .active_nodes
        .values()
        .flatten()
        .cloned()
        .collect::<BTreeSet<_>>();
    (variant, active_nodes, all_choice_nodes)
}

#[test]
fn prune_plan_to_active_elides_merge_meta_and_sibling_choices() {
    // Pruning correctness: each pruned candidate's node_plans keys == shared_prefix ∪
    // active_nodes[choice]; merge:gen + model:meta + the sibling choice are ELIDED (absent); every
    // surviving edge has both endpoints in keep.
    let (plan, model) = operator_select_union();
    let (variant, active_nodes, all_choice_nodes) = operator_variant_for_choice(&model, "choice0");

    let pruned = prune_plan_to_active(&plan, active_nodes, &all_choice_nodes, &variant).unwrap();

    let filter = NodeId::new("filter:y_outlier").unwrap();
    let t0 = NodeId::new("transform:choice0__snv").unwrap();
    let m0 = NodeId::new("model:choice0__pls").unwrap();
    let expected_keep: BTreeSet<NodeId> = BTreeSet::from([filter.clone(), t0.clone(), m0.clone()]);

    let keep: BTreeSet<NodeId> = pruned.node_plans.keys().cloned().collect();
    assert_eq!(
        keep, expected_keep,
        "kept set must be shared_prefix (filter) ∪ active_nodes[choice0] (transform+model)"
    );
    // The graph nodes mirror the node_plans exactly.
    let graph_nodes: BTreeSet<NodeId> = pruned
        .graph_plan
        .graph
        .nodes
        .iter()
        .map(|node| node.id.clone())
        .collect();
    assert_eq!(graph_nodes, expected_keep);

    // The stacking merge + meta-model + the sibling choice are ELIDED.
    for elided in [
        "merge:gen",
        "model:meta",
        "transform:choice1__msc",
        "model:choice1__ridge",
    ] {
        let id = NodeId::new(elided).unwrap();
        assert!(
            !pruned.node_plans.contains_key(&id),
            "`{elided}` must be elided from the pruned SELECT candidate"
        );
    }

    // Surviving edges only within keep — no dangling edge into the elided merge.
    for edge in &pruned.graph_plan.graph.edges {
        assert!(
            keep.contains(&edge.source.node_id) && keep.contains(&edge.target.node_id),
            "edge {} -> {} escapes the kept set",
            edge.source.node_id,
            edge.target.node_id
        );
    }
    // No surviving edge targets the elided merge.
    assert!(
        !pruned
            .graph_plan
            .graph
            .edges
            .iter()
            .any(|edge| edge.target.node_id.as_str() == "merge:gen"),
        "no OOF edge into the elided merge may survive"
    );
    // The chosen model's rebuilt input_nodes point at the chosen transform only (the scheduler reads
    // this; a stale union entry would reintroduce an inactive edge).
    assert_eq!(pruned.node_plans[&m0].input_nodes, vec![t0.clone()]);
    assert_eq!(pruned.node_plans[&t0].input_nodes, vec![filter.clone()]);
    assert_eq!(pruned.variants, vec![variant]);
    pruned.validate().unwrap();
}

#[test]
fn prune_plan_to_active_is_deterministic() {
    // Determinism: two prunes of the same choice are byte-identical.
    let (plan, model) = operator_select_union();
    let (variant, active_nodes, all_choice_nodes) = operator_variant_for_choice(&model, "choice1");
    let left = prune_plan_to_active(&plan, active_nodes, &all_choice_nodes, &variant).unwrap();
    let right = prune_plan_to_active(&plan, active_nodes, &all_choice_nodes, &variant).unwrap();
    assert_eq!(
        serde_json::to_string(&left).unwrap(),
        serde_json::to_string(&right).unwrap(),
        "two prunes of the same choice must be byte-identical"
    );
}

#[test]
fn validate_active_inputs_rejects_a_dangling_prune() {
    // A deliberately-dangling prune: keep the model but DROP its feeding transform from the active
    // set, so the model's required `x` input port has zero surviving sources. P4-1 must reject it.
    let (plan, model) = operator_select_union();
    let (variant, _active_nodes, all_choice_nodes) = operator_variant_for_choice(&model, "choice0");
    // active = model only (transform omitted) -> model:choice0__pls.x dangles.
    let dangling_active = BTreeSet::from([NodeId::new("model:choice0__pls").unwrap()]);
    let error = prune_plan_to_active(&plan, &dangling_active, &all_choice_nodes, &variant)
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("dangling") || error.contains("zero surviving sources"),
        "P4-1 must reject a dangling prune: {error}"
    );
}

#[test]
fn select_best_operator_variant_runs_both_pruned_candidates_and_picks_winner() {
    use crate::metrics::RegressionMetricKind;

    // (1) A 2-variant operator `_or_` runs BOTH pruned SELECT candidates; the winner is the
    // lower-RMSE choice (choice0, offset 0); both Validation reports are present and variant-tagged;
    // and the winner refits on its pruned plan (see the dedicated pruning/CLI tests for refit).
    let (plan, model) = operator_select_union();
    let controllers = operator_select_controllers();
    let run_id = RunId::new("run:operator.select").unwrap();

    let selected = select_best_operator_variant_by_cv(
        &plan,
        &model,
        &run_id,
        Some(7),
        RegressionMetricKind::Rmse,
        |pruned_plan, ctx| {
            // The candidate is the PRUNED plan, not the union: the merge + meta + sibling choice are
            // gone, so exactly one terminal producer remains.
            assert!(
                !pruned_plan
                    .node_plans
                    .contains_key(&NodeId::new("merge:gen").unwrap()),
                "the scored plan must be the pruned candidate, not the stacking union"
            );
            SequentialScheduler
                .execute_campaign_phase(pruned_plan, &controllers, ctx, Phase::FitCv)
                .map(|_| ())
        },
    )
    .unwrap();

    let selection = selected.expect("operator scoring is on (targets emitted)");
    // The winner is choice0 (RMSE 0) — recover its variant id from the model's enumeration.
    let (winner_variant, _, _) = operator_variant_for_choice(&model, "choice0");
    assert_eq!(selection.selected_variant_id, winner_variant.variant_id);

    // Both choices' Validation reports are present and tagged with their own variant ids.
    let scored: BTreeSet<VariantId> = selection
        .validation_reports
        .iter()
        .filter_map(|report| report.variant_id.clone())
        .collect();
    let expected: BTreeSet<VariantId> = enumerate_variants(&model.generation_spec(), Some(7))
        .unwrap()
        .into_iter()
        .map(|variant| variant.variant_id)
        .collect();
    assert_eq!(
        scored, expected,
        "every operator choice must be scored+tagged"
    );
    assert!(
        selection
            .validation_reports
            .iter()
            .all(|report| report.partition == PredictionPartition::Validation),
        "operator-SELECT retains only Validation (OOF) reports"
    );
}

/// Phase 5: when the operator model carries `variant_labels`, `select_best_operator_variant_by_cv`
/// STAMPS each choice's content fingerprint on EVERY validation report — the WINNER's and the
/// losers' — keyed by the choice the report belongs to (resolved the SAME way `variant_id` is). This
/// is the cross-language mapping the nirs4all host relies on (report -> operator-choice config).
#[test]
fn select_best_operator_variant_stamps_variant_label_on_winner_and_loser_reports() {
    use crate::metrics::RegressionMetricKind;

    let (plan, mut model) = operator_select_union();
    // Inject two distinct, valid 64-hex content fingerprints (the derivation is contract-tested in
    // dag-ml-core's dsl tests; here we assert PROPAGATION onto the reports).
    let choice0_label = "a".repeat(64);
    let choice1_label = "b".repeat(64);
    model.variant_labels = BTreeMap::from([
        ("choice0".to_string(), choice0_label.clone()),
        ("choice1".to_string(), choice1_label.clone()),
    ]);
    model.validate().unwrap();
    let controllers = operator_select_controllers();
    let run_id = RunId::new("run:operator.label").unwrap();

    let selection = select_best_operator_variant_by_cv(
        &plan,
        &model,
        &run_id,
        Some(7),
        RegressionMetricKind::Rmse,
        |pruned_plan, ctx| {
            SequentialScheduler
                .execute_campaign_phase(pruned_plan, &controllers, ctx, Phase::FitCv)
                .map(|_| ())
        },
    )
    .unwrap()
    .expect("operator scoring is on");

    // The winner is choice0 (RMSE 0).
    let (winner_variant, _, _) = operator_variant_for_choice(&model, "choice0");
    let (loser_variant, _, _) = operator_variant_for_choice(&model, "choice1");

    // Every report carries the label of the choice its variant belongs to (winner AND loser).
    let mut saw_winner_label = false;
    let mut saw_loser_label = false;
    for report in &selection.validation_reports {
        let variant_id = report.variant_id.as_ref().unwrap();
        let expected = if variant_id == &winner_variant.variant_id {
            saw_winner_label = true;
            &choice0_label
        } else if variant_id == &loser_variant.variant_id {
            saw_loser_label = true;
            &choice1_label
        } else {
            panic!("unexpected variant id {variant_id}");
        };
        assert_eq!(
            report.variant_label.as_ref(),
            Some(expected),
            "each report must carry its own choice's variant_label"
        );
    }
    assert!(
        saw_winner_label,
        "the WINNER report must carry variant_label, not just the losers"
    );
    assert!(saw_loser_label, "the loser report must carry variant_label");
}

/// operator-SELECT additively surfaces EACH variant's per-fold VALIDATION (OOF) PREDICTIONS (not just
/// the scalar reports), each re-tagged with the variant's id + content fingerprint, so a host can fill
/// a non-selected variant's per-sample prediction rows. The blocks are the variant's OWN validation
/// predictions (re-tagged by variant id — no cross-variant mixing), are `Validation`-only, and pair
/// with their id-matched y_true — the leakage-safe contract.
#[test]
fn select_best_operator_variant_surfaces_per_variant_validation_predictions() {
    use crate::metrics::RegressionMetricKind;

    let (plan, mut model) = operator_select_union();
    let choice0_label = "a".repeat(64);
    let choice1_label = "b".repeat(64);
    model.variant_labels = BTreeMap::from([
        ("choice0".to_string(), choice0_label.clone()),
        ("choice1".to_string(), choice1_label.clone()),
    ]);
    model.validate().unwrap();
    let controllers = operator_select_controllers();
    let run_id = RunId::new("run:operator.predictions").unwrap();

    let selection = select_best_operator_variant_by_cv(
        &plan,
        &model,
        &run_id,
        Some(7),
        RegressionMetricKind::Rmse,
        |pruned_plan, ctx| {
            SequentialScheduler
                .execute_campaign_phase(pruned_plan, &controllers, ctx, Phase::FitCv)
                .map(|_| ())
        },
    )
    .unwrap()
    .expect("operator scoring is on");

    let (winner_variant, _, _) = operator_variant_for_choice(&model, "choice0");
    let (loser_variant, _, _) = operator_variant_for_choice(&model, "choice1");

    // Both variants surface captured validation predictions, each tagged with its OWN id + label.
    let captured: BTreeSet<VariantId> = selection
        .variant_validation_predictions
        .iter()
        .map(|captured| captured.variant_id.clone())
        .collect();
    assert_eq!(
        captured,
        BTreeSet::from([
            winner_variant.variant_id.clone(),
            loser_variant.variant_id.clone()
        ]),
        "every operator choice must surface its captured validation predictions"
    );

    for captured in &selection.variant_validation_predictions {
        let expected_label = if captured.variant_id == winner_variant.variant_id {
            &choice0_label
        } else {
            &choice1_label
        };
        assert_eq!(
            captured.variant_label.as_ref(),
            Some(expected_label),
            "captured predictions carry the variant's own content fingerprint"
        );
        // Every captured block is a Validation (OOF) block — never Final/Test/refit (the transient run
        // is FIT_CV-only), the leakage-safe contract.
        assert!(
            !captured.predictions.is_empty(),
            "the variant's per-fold validation blocks are captured"
        );
        assert!(
            captured
                .predictions
                .iter()
                .all(|block| block.partition == PredictionPartition::Validation),
            "only Validation (OOF) predictions are surfaced — no refit/train/test"
        );
        // Each prediction block is paired POSITION-FOR-POSITION with an id-matched y_true block.
        assert_eq!(
            captured.predictions.len(),
            captured.regression_targets.len(),
            "every captured prediction block has its paired y_true"
        );
        for (block, target) in captured
            .predictions
            .iter()
            .zip(captured.regression_targets.iter())
        {
            let pred_ids: BTreeSet<_> = block.sample_ids.iter().cloned().collect();
            let target_ids: BTreeSet<_> = target
                .unit_ids
                .iter()
                .map(|unit| match unit {
                    crate::aggregation::PredictionUnitId::Sample(sample_id) => sample_id.clone(),
                    other => panic!("unexpected non-sample unit id {other:?}"),
                })
                .collect();
            assert_eq!(
                pred_ids, target_ids,
                "the per-fold y_true covers exactly the prediction block's samples (id-matched)"
            );
        }
    }
}

/// A host controller may VALIDLY emit its `regression_targets` rows in a DIFFERENT order than the
/// PredictionBlock's `sample_ids` (the scoring path realigns by unit id before computing metrics). But
/// the host surfaces a captured loser block POSITIONALLY — y_pred from `block.sample_ids`/`values`
/// paired ROW-FOR-ROW with `regression_targets.values`. So the captured y_true must be REBUILT in
/// `sample_ids` order; `target_block_aligned_to_samples` does that. This pins the per-sample y_true is
/// aligned to y_pred by id even when the target block arrives shuffled.
#[test]
fn captured_validation_y_true_is_realigned_to_prediction_sample_order() {
    use crate::aggregation::PredictionUnitId;

    let sample_order = [
        SampleId::new("s1").unwrap(),
        SampleId::new("s2").unwrap(),
        SampleId::new("s3").unwrap(),
    ];
    // The y_true block arrives in a DIFFERENT order than `sample_order` (s3, s1, s2), each row a
    // distinct value tied to its sample so a misalignment would be observable.
    let shuffled_targets = RegressionTargetBlock {
        level: PredictionLevel::Sample,
        unit_ids: vec![
            PredictionUnitId::Sample(SampleId::new("s3").unwrap()),
            PredictionUnitId::Sample(SampleId::new("s1").unwrap()),
            PredictionUnitId::Sample(SampleId::new("s2").unwrap()),
        ],
        values: vec![vec![30.0], vec![10.0], vec![20.0]],
        target_names: vec!["y".to_string()],
    };

    let aligned = target_block_aligned_to_samples(&sample_order, &shuffled_targets);

    // The realigned block is in `sample_order` (s1, s2, s3) with each sample's OWN value, so a
    // positional zip of y_pred[i] (sample_order[i]) with y_true[i] pairs the right sample.
    assert_eq!(
        aligned.unit_ids,
        vec![
            PredictionUnitId::Sample(SampleId::new("s1").unwrap()),
            PredictionUnitId::Sample(SampleId::new("s2").unwrap()),
            PredictionUnitId::Sample(SampleId::new("s3").unwrap()),
        ],
        "y_true unit ids are realigned to the prediction block's sample order"
    );
    assert_eq!(
        aligned.values,
        vec![vec![10.0], vec![20.0], vec![30.0]],
        "each y_true row moves with its sample id (s1->10, s2->20, s3->30), not its arrival position"
    );
    assert_eq!(aligned.target_names, vec!["y".to_string()]);
}

/// END-TO-END through `capture_variant_validation_predictions`: a fold's multi-sample VALIDATION
/// `PredictionBlock` whose paired `RegressionTargetRecord` arrives in a DIFFERENT row order (the
/// `sample_targets_match_block` precondition only requires the same sample SET) must be captured with
/// its y_true REALIGNED to the prediction block's `sample_ids`, so a host that pairs y_pred ↔ y_true by
/// row position reads the right per-sample ground truth — no cross-sample y_true misalignment.
#[test]
fn capture_variant_validation_predictions_realigns_shuffled_fold_targets() {
    use crate::aggregation::PredictionUnitId;

    let producer = NodeId::new("model:choice0__pls").unwrap();
    let variant_id = VariantId::new("variant:probe").unwrap();
    let mut ctx = RunContext::new(RunId::new("run:capture.shuffle").unwrap(), Some(7));
    ctx.variant_id = Some(variant_id.clone());

    // A 3-sample validation block in s1,s2,s3 order — y_pred = y_true + 100 so each value is
    // distinguishable per sample.
    ctx.prediction_store
        .append(PredictionBlock {
            prediction_id: Some("pred:fold0".to_string()),
            producer_node: producer.clone(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new("fold:0").unwrap()),
            sample_ids: vec![
                SampleId::new("s1").unwrap(),
                SampleId::new("s2").unwrap(),
                SampleId::new("s3").unwrap(),
            ],
            values: vec![vec![110.0], vec![120.0], vec![130.0]],
            target_names: vec!["y".to_string()],
        })
        .unwrap();
    // The matching y_true record arrives SHUFFLED (s3, s1, s2) — a valid host ordering.
    ctx.regression_target_records.push(RegressionTargetRecord {
        producer_node: producer.clone(),
        producer_port: None,
        variant_id: Some(variant_id.clone()),
        partition: PredictionPartition::Validation,
        fold_id: Some(FoldId::new("fold:0").unwrap()),
        block: RegressionTargetBlock {
            level: PredictionLevel::Sample,
            unit_ids: vec![
                PredictionUnitId::Sample(SampleId::new("s3").unwrap()),
                PredictionUnitId::Sample(SampleId::new("s1").unwrap()),
                PredictionUnitId::Sample(SampleId::new("s2").unwrap()),
            ],
            values: vec![vec![30.0], vec![10.0], vec![20.0]],
            target_names: vec!["y".to_string()],
        },
    });

    let captured = capture_variant_validation_predictions(&variant_id, None, &ctx);
    assert_eq!(captured.predictions.len(), 1);
    assert_eq!(captured.regression_targets.len(), 1);

    // The surfaced y_true is realigned to the prediction block's sample order (s1,s2,s3), so a
    // POSITIONAL zip of y_pred[i] ↔ y_true[i] pairs the SAME sample: s1->(110,10), s2->(120,20),
    // s3->(130,30). A misalignment (the raw shuffled order) would pair s1's y_pred with s3's y_true.
    let block = &captured.predictions[0];
    let target = &captured.regression_targets[0];
    for (position, sample_id) in block.sample_ids.iter().enumerate() {
        assert_eq!(
            target.unit_ids[position],
            PredictionUnitId::Sample(sample_id.clone()),
            "y_true row {position} is aligned to the prediction block's sample at that position"
        );
    }
    assert_eq!(
        target.values,
        vec![vec![10.0], vec![20.0], vec![30.0]],
        "y_true values follow their sample id into prediction order, not their shuffled arrival order"
    );
}

#[test]
fn select_best_operator_variant_is_leakage_safe_inactive_choice_writes_no_validation() {
    use crate::metrics::RegressionMetricKind;

    // (5) Leakage: when scoring choice0, the inactive choice1's model is ABSENT from the pruned
    // graph, so it is never fit and writes NO Validation block into that context. We assert this by
    // inspecting each per-variant context's prediction store from inside the scoring closure.
    let (plan, model) = operator_select_union();
    let controllers = operator_select_controllers();
    let run_id = RunId::new("run:operator.leakage").unwrap();

    let c0_model = NodeId::new("model:choice0__pls").unwrap();
    let c1_model = NodeId::new("model:choice1__ridge").unwrap();

    select_best_operator_variant_by_cv(
        &plan,
        &model,
        &run_id,
        Some(7),
        RegressionMetricKind::Rmse,
        |pruned_plan, ctx| {
            SequentialScheduler
                .execute_campaign_phase(pruned_plan, &controllers, ctx, Phase::FitCv)
                .map(|_| ())?;
            // Exactly ONE of the two choice models produced blocks in this context; the other is
            // physically absent from the pruned graph, so no inactive choice's OOF can leak.
            let producers: BTreeSet<NodeId> = ctx
                .prediction_store
                .blocks()
                .iter()
                .map(|block| block.producer_node.clone())
                .collect();
            let has_c0 = producers.contains(&c0_model);
            let has_c1 = producers.contains(&c1_model);
            assert!(
                has_c0 ^ has_c1,
                "exactly one choice model may write Validation blocks in a pruned context (c0={has_c0}, c1={has_c1})"
            );
            Ok(())
        },
    )
    .unwrap();
}

#[test]
fn select_best_operator_variant_from_models_rejects_multiple_generators() {
    use crate::metrics::RegressionMetricKind;

    // (6) Multiple operator generators are rejected for this phase (flat single operator generator
    // scope), consistent with the Phase-3 nested rejection.
    let (plan, model) = operator_select_union();
    let mut second = model.clone();
    second.generator_id = NodeId::new("generator:other").unwrap();
    second.dimension.name = "generator:other.operators".to_string();
    let models = vec![model, second];
    let run_id = RunId::new("run:operator.multi").unwrap();

    let error = select_best_operator_variant_from_models(
        &plan,
        &models,
        &run_id,
        Some(7),
        RegressionMetricKind::Rmse,
        |_plan, _ctx| Ok(()),
    )
    .unwrap_err()
    .to_string();
    assert!(
        error.contains("does not support 2 operator generators"),
        "multiple operator generators must be rejected: {error}"
    );

    // An empty model slice is a no-op (no operator generator to SELECT): returns Ok(None).
    let none = select_best_operator_variant_from_models(
        &plan,
        &[],
        &run_id,
        Some(7),
        RegressionMetricKind::Rmse,
        |_plan, _ctx| Ok(()),
    )
    .unwrap();
    assert!(none.is_none());
}
