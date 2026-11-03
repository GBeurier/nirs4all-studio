//! Closed package for an initial, no-splitter full refit.
//!
//! This family has no CV parent, selection result, OOF cache or score. It is
//! deliberately distinct from the parent-bound portable refit Package V3.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::canonical::parse_typed_json;
use crate::data::data_binding_requirement_key;
use crate::error::{DagMlError, Result};
use crate::graph::PortKind;
use crate::ids::{ArtifactId, ControllerId, NodeId, RunId, SampleId, VariantId};
use crate::phase::Phase;
use crate::relation::SampleRelationSet;
use crate::runtime::{
    ArtifactBackend, ArtifactMaterializationRequest, HandleRef, InMemoryArtifactStore, NodeResult,
    ParallelScheduler, RunContext, RuntimeArtifactStore, RuntimeControllerRegistry,
    RuntimeDataProvider, SequentialScheduler,
};
use crate::training::{ArtifactLoadMode, TrainingDataIdentity};
use crate::{
    require_terminal_predict_cohort, validate_terminal_prediction_preflight, ExecutionPlan,
    ExternalDataPlanEnvelope, PredictCohort, PredictionBlock, PredictionPartition,
    RefitArtifactRecord, ScoreSet, TerminalPredictionSelector, TrainingResourceLimits,
};

pub const INITIAL_FULL_REFIT_PACKAGE_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InitialRefitOutput {
    pub output_id: String,
    pub node_id: NodeId,
    pub port_name: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InitialRefitArtifact {
    pub record: RefitArtifactRecord,
    pub load_mode: ArtifactLoadMode,
}

/// Portable control evidence for one full-training run with no split.
/// Host artifacts remain explicit sidecars; raw native payloads are embedded.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InitialFullRefitPackage {
    pub schema_version: u32,
    pub package_id: String,
    pub run_id: RunId,
    pub effective_plan: ExecutionPlan,
    pub effective_plan_fingerprint: String,
    pub execution_root_seed: Option<u64>,
    pub scheduler: InitialRefitScheduler,
    pub resource_limits: Option<TrainingResourceLimits>,
    /// The sole concrete variant is an execution identity, not a CV selection.
    pub variant_id: VariantId,
    pub training_sample_ids: Vec<SampleId>,
    pub training_relations: SampleRelationSet,
    /// Reusable training schema/plan authority; a fresh V2 cohort is attached for PREDICT.
    pub training_envelope: ExternalDataPlanEnvelope,
    pub data_identities: Vec<TrainingDataIdentity>,
    pub outputs: Vec<InitialRefitOutput>,
    pub artifacts: Vec<InitialRefitArtifact>,
    pub raw_artifact_payloads: BTreeMap<ArtifactId, Vec<u8>>,
    pub package_fingerprint: String,
}

fn fingerprint<T: Serialize>(value: &T, field: Option<&str>) -> Result<String> {
    let json = serde_json::to_string(value)?;
    let typed = parse_typed_json(&json).map_err(|error| {
        DagMlError::RuntimeValidation(format!("initial full-refit package is not TCV1: {error}"))
    })?;
    let value = match field {
        Some(field) => typed.fingerprint_without(field),
        None => typed.fingerprint(),
    };
    value.map_err(|error| {
        DagMlError::RuntimeValidation(format!("initial full-refit fingerprint failed: {error}"))
    })
}

fn package_error(message: impl Into<String>) -> DagMlError {
    DagMlError::RuntimeValidation(message.into())
}

fn output_bindings(plan: &ExecutionPlan) -> Vec<InitialRefitOutput> {
    let mut outputs = plan
        .graph_plan
        .graph
        .nodes
        .iter()
        .flat_map(|node| {
            node.ports
                .outputs
                .iter()
                .filter(|port| port.kind == PortKind::Prediction)
                .map(|port| InitialRefitOutput {
                    output_id: format!("output:{}:{}", node.id, port.name),
                    node_id: node.id.clone(),
                    port_name: port.name.clone(),
                })
        })
        .collect::<Vec<_>>();
    outputs.sort_by(|left, right| left.output_id.cmp(&right.output_id));
    outputs
}

impl InitialFullRefitPackage {
    pub fn compute_fingerprint(&self) -> Result<String> {
        fingerprint(self, Some("package_fingerprint"))
    }

    pub fn from_json(json: &str) -> Result<Self> {
        let raw = parse_typed_json(json)
            .map_err(|error| {
                package_error(format!(
                    "initial full-refit package is not strict TCV1 JSON: {error}"
                ))
            })?
            .fingerprint_without("package_fingerprint")
            .map_err(|error| {
                package_error(format!(
                    "initial full-refit package fingerprint preimage is invalid: {error}"
                ))
            })?;
        let package: Self = serde_json::from_str(json)?;
        if package.package_fingerprint != raw {
            return Err(package_error(
                "initial full-refit package fingerprint does not match original JSON",
            ));
        }
        package.validate()?;
        Ok(package)
    }

    pub fn validate(&self) -> Result<()> {
        if self.schema_version != INITIAL_FULL_REFIT_PACKAGE_SCHEMA_VERSION {
            return Err(package_error(
                "initial full-refit package has unsupported schema_version",
            ));
        }
        RunId::new(self.package_id.clone())?;
        self.effective_plan.validate()?;
        if self.effective_plan.fold_set.is_some() || self.effective_plan.variants.len() != 1 {
            return Err(package_error(
                "initial full-refit package requires one concrete no-splitter plan",
            ));
        }
        if self.variant_id != self.effective_plan.variants[0].variant_id {
            return Err(package_error(
                "initial full-refit variant differs from its sole plan variant",
            ));
        }
        if self.effective_plan_fingerprint != fingerprint(&self.effective_plan, None)? {
            return Err(package_error(
                "initial full-refit effective plan fingerprint mismatch",
            ));
        }
        if matches!(
            self.scheduler,
            InitialRefitScheduler::Parallel { workers: 0 }
        ) || self
            .resource_limits
            .as_ref()
            .is_some_and(|limits| limits.cpu_threads == 0)
        {
            return Err(package_error(
                "initial full-refit execution resources are invalid",
            ));
        }
        let samples = self.training_sample_ids.iter().collect::<BTreeSet<_>>();
        if samples.is_empty() || samples.len() != self.training_sample_ids.len() {
            return Err(package_error(
                "initial full-refit training_sample_ids must be non-empty and unique",
            ));
        }
        self.training_relations.validate()?;
        self.training_envelope.validate()?;
        if self.training_envelope.schema_version != 1
            || self.training_envelope.predict_cohort.is_some()
            || self.training_envelope.coordinator_relations.as_ref()
                != Some(&self.training_relations)
            || self.training_envelope.relation_fingerprint.as_deref()
                != Some(self.training_relations.fingerprint()?.as_str())
        {
            return Err(package_error(
                "initial full-refit training envelope differs from its relations",
            ));
        }
        if self
            .training_relations
            .records
            .iter()
            .map(|record| &record.sample_id)
            .collect::<BTreeSet<_>>()
            != samples
        {
            return Err(package_error(
                "initial full-refit training samples differ from relations",
            ));
        }
        let expected_bindings = self
            .effective_plan
            .node_plans
            .values()
            .flat_map(|node| node.data_bindings.iter())
            .map(|binding| data_binding_requirement_key(&binding.node_id, &binding.input_name))
            .collect::<BTreeSet<_>>();
        let actual_bindings = self
            .data_identities
            .iter()
            .map(|identity| identity.requirement_key.clone())
            .collect::<BTreeSet<_>>();
        if expected_bindings.is_empty()
            || expected_bindings != actual_bindings
            || self.data_identities.len() != actual_bindings.len()
            || !self
                .data_identities
                .windows(2)
                .all(|pair| pair[0].requirement_key < pair[1].requirement_key)
        {
            return Err(package_error(
                "initial full-refit data identities do not exactly cover plan bindings",
            ));
        }
        for identity in &self.data_identities {
            identity.validate()?;
            let binding = self
                .effective_plan
                .node_plans
                .values()
                .flat_map(|node| node.data_bindings.iter())
                .find(|binding| {
                    data_binding_requirement_key(&binding.node_id, &binding.input_name)
                        == identity.requirement_key
                })
                .ok_or_else(|| {
                    package_error("initial full-refit data identity has no plan binding")
                })?;
            if identity.schema_fingerprint != binding.schema_fingerprint
                || identity.plan_fingerprint != binding.plan_fingerprint
                || identity.schema_fingerprint != self.training_envelope.schema_fingerprint
                || identity.plan_fingerprint != self.training_envelope.plan_fingerprint
                || Some(identity.data_content_fingerprint.as_str())
                    != self.training_envelope.data_content_fingerprint.as_deref()
                || Some(identity.target_content_fingerprint.as_str())
                    != self.training_envelope.target_content_fingerprint.as_deref()
                || Some(identity.relation_fingerprint.as_str())
                    != binding.relation_fingerprint.as_deref()
                || identity.relation_fingerprint != self.training_relations.fingerprint()?
            {
                return Err(package_error(
                    "initial full-refit data identity differs from plan or relations",
                ));
            }
        }
        if self
            .data_identities
            .iter()
            .map(|identity| &identity.relation_fingerprint)
            .collect::<BTreeSet<_>>()
            .len()
            != 1
        {
            return Err(package_error(
                "initial full-refit data identities disagree on training relations",
            ));
        }
        if self.outputs.is_empty() || self.outputs != output_bindings(&self.effective_plan) {
            return Err(package_error(
                "initial full-refit output bindings do not exactly match prediction ports",
            ));
        }
        if self.artifacts.is_empty()
            || !self
                .artifacts
                .windows(2)
                .all(|pair| pair[0].record.artifact.id < pair[1].record.artifact.id)
        {
            return Err(package_error(
                "initial full-refit artifacts must be non-empty and strictly sorted",
            ));
        }
        let mut raw_ids = BTreeSet::new();
        for artifact in &self.artifacts {
            artifact.record.validate()?;
            let node = self
                .effective_plan
                .node_plans
                .get(&artifact.record.node_id)
                .ok_or_else(|| {
                    package_error("initial full-refit artifact refers to an unknown node")
                })?;
            if artifact.record.controller_id != node.controller_id
                || artifact.record.params_fingerprint != node.params_fingerprint
            {
                return Err(package_error(
                    "initial full-refit artifact controller or parameters differ from plan",
                ));
            }
            match (artifact.record.artifact.backend, artifact.load_mode) {
                (Some(ArtifactBackend::Raw), ArtifactLoadMode::NativePortable) => {
                    let payload = self
                        .raw_artifact_payloads
                        .get(&artifact.record.artifact.id)
                        .ok_or_else(|| {
                            package_error("initial full-refit raw artifact payload is missing")
                        })?;
                    if payload.is_empty() {
                        return Err(package_error(
                            "initial full-refit raw artifact payload is empty",
                        ));
                    }
                    if artifact.record.artifact.size_bytes != Some(payload.len() as u64)
                        || artifact.record.artifact.content_fingerprint.as_deref()
                            != Some(format!("{:x}", Sha256::digest(payload)).as_str())
                    {
                        return Err(package_error(
                            "initial full-refit raw artifact payload does not match its reference",
                        ));
                    }
                    raw_ids.insert(artifact.record.artifact.id.clone());
                }
                (Some(ArtifactBackend::Raw), _) | (_, ArtifactLoadMode::NativePortable) => {
                    return Err(package_error(
                        "initial full-refit artifact load mode disagrees with backend",
                    ));
                }
                (_, ArtifactLoadMode::HostSidecar) => {}
            }
        }
        if raw_ids != self.raw_artifact_payloads.keys().cloned().collect() {
            return Err(package_error(
                "initial full-refit raw payload inventory contains an orphan",
            ));
        }
        if self.package_fingerprint != self.compute_fingerprint()? {
            return Err(package_error(
                "initial full-refit package fingerprint mismatch",
            ));
        }
        Ok(())
    }

    /// Attach an independent cohort to the closed training data-plan authority.
    pub fn predict_envelope(&self, cohort: PredictCohort) -> Result<ExternalDataPlanEnvelope> {
        self.validate()?;
        cohort.validate()?;
        let mut envelope = self.training_envelope.clone();
        envelope.schema_version = 2;
        envelope.predict_cohort = Some(cohort);
        envelope.validate()?;
        Ok(envelope)
    }
}

pub struct InitialFullRefitExecutionInput<'a> {
    pub package_id: String,
    pub run_id: RunId,
    pub plan: &'a ExecutionPlan,
    pub training_envelope: &'a ExternalDataPlanEnvelope,
    pub training_sample_ids: &'a [SampleId],
    pub controllers: &'a RuntimeControllerRegistry,
    pub data_provider: &'a dyn RuntimeDataProvider,
    pub root_seed: Option<u64>,
    pub resource_limits: Option<TrainingResourceLimits>,
    pub scheduler: InitialRefitScheduler,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum InitialRefitScheduler {
    Sequential,
    Parallel { workers: usize },
}

pub struct InitialFullRefitExecution {
    pub package: InitialFullRefitPackage,
    pub results: Vec<NodeResult>,
    /// Native resubstitution/test reports are execution evidence, never CV selection.
    pub scores: Option<ScoreSet>,
}

/// Execute REFIT exactly once and capture its independently attested package.
/// No CV, SELECT, parent package, or invented score participates in this path.
pub fn execute_initial_full_refit(
    input: InitialFullRefitExecutionInput<'_>,
) -> Result<InitialFullRefitExecution> {
    input.plan.validate()?;
    input.training_envelope.validate()?;
    let mut training_envelope = input.training_envelope.clone();
    training_envelope.schema_version = 1;
    training_envelope.predict_cohort = None;
    training_envelope.validate()?;
    if input.plan.fold_set.is_some() || input.plan.variants.len() != 1 {
        return Err(package_error(
            "initial full refit requires one concrete no-splitter plan",
        ));
    }
    let mut identities = Vec::new();
    let mut training_relations = None;
    for binding in input
        .plan
        .node_plans
        .values()
        .flat_map(|node| node.data_bindings.iter())
    {
        let identity = input
            .data_provider
            .training_data_identity(binding)?
            .ok_or_else(|| {
                package_error("initial full refit requires attested feature and target content")
            })?;
        identity.validate()?;
        if identity.requirement_key
            != data_binding_requirement_key(&binding.node_id, &binding.input_name)
        {
            return Err(package_error(
                "initial full-refit provider identity does not match binding",
            ));
        }
        let provider_ids = input
            .data_provider
            .refit_sample_ids(binding)?
            .ok_or_else(|| {
                package_error("initial full refit requires explicit provider training order")
            })?;
        if provider_ids != input.training_sample_ids {
            return Err(package_error(
                "initial full-refit training order differs from provider attestation",
            ));
        }
        let relations = input
            .data_provider
            .coordinator_relations(binding)?
            .ok_or_else(|| {
                package_error("initial full refit requires attested sample relations")
            })?;
        relations.validate()?;
        let relation_fingerprint = relations.fingerprint()?;
        if relation_fingerprint != identity.relation_fingerprint {
            return Err(package_error(format!(
                "initial full-refit relation fingerprint {} differs from binding {}",
                relation_fingerprint, identity.relation_fingerprint
            )));
        }
        if relations
            .records
            .iter()
            .map(|record| &record.sample_id)
            .collect::<BTreeSet<_>>()
            != input.training_sample_ids.iter().collect()
        {
            return Err(package_error(
                "initial full-refit sample identities differ from attested relations",
            ));
        }
        if let Some(existing) = training_relations.as_ref() {
            if existing != &relations {
                return Err(package_error(
                    "initial full-refit bindings disagree on training relations",
                ));
            }
        } else {
            training_relations = Some(relations);
        }
        identities.push(identity);
    }
    identities.sort_by(|left, right| left.requirement_key.cmp(&right.requirement_key));
    for node in input.plan.node_plans.values() {
        if input.controllers.get(&node.controller_id).is_none() {
            return Err(package_error(format!(
                "initial full-refit controller `{}` is not registered",
                node.controller_id
            )));
        }
    }
    let mut context = RunContext::new(input.run_id.clone(), input.root_seed);
    context.variant_id = Some(input.plan.variants[0].variant_id.clone());
    context.resource_limits = input.resource_limits.clone();
    let mut store = InMemoryArtifactStore::new();
    let results = match input.scheduler {
        InitialRefitScheduler::Sequential => SequentialScheduler
            .execute_campaign_phase_with_data_provider_and_artifact_store(
                input.plan,
                input.controllers,
                input.data_provider,
                &mut store,
                &mut context,
                Phase::Refit,
            )?,
        InitialRefitScheduler::Parallel { workers } => ParallelScheduler::new(workers)?
            .execute_campaign_phase_with_data_provider_and_artifact_store(
                input.plan,
                input.controllers,
                input.data_provider,
                &mut store,
                &mut context,
                Phase::Refit,
            )?,
    };
    let mut artifacts = store
        .refit_artifacts()
        .into_iter()
        .map(|record| {
            let load_mode = if record.artifact.backend == Some(ArtifactBackend::Raw) {
                ArtifactLoadMode::NativePortable
            } else {
                ArtifactLoadMode::HostSidecar
            };
            InitialRefitArtifact { record, load_mode }
        })
        .collect::<Vec<_>>();
    artifacts.sort_by(|left, right| left.record.artifact.id.cmp(&right.record.artifact.id));
    let mut raw_artifact_payloads = BTreeMap::new();
    for artifact in &artifacts {
        if artifact.load_mode == ArtifactLoadMode::NativePortable {
            let controller = input
                .controllers
                .get(&artifact.record.controller_id)
                .expect("preflighted controller");
            let payload = controller
                .export_artifact_payload(&artifact.record.artifact.id)?
                .ok_or_else(|| {
                    package_error("native full-refit controller omitted raw artifact payload")
                })?;
            raw_artifact_payloads.insert(artifact.record.artifact.id.clone(), payload);
        }
    }
    let mut package = InitialFullRefitPackage {
        schema_version: INITIAL_FULL_REFIT_PACKAGE_SCHEMA_VERSION,
        package_id: input.package_id,
        run_id: input.run_id,
        effective_plan: input.plan.clone(),
        effective_plan_fingerprint: fingerprint(input.plan, None)?,
        execution_root_seed: input.root_seed,
        scheduler: input.scheduler,
        resource_limits: input.resource_limits,
        variant_id: input.plan.variants[0].variant_id.clone(),
        training_sample_ids: input.training_sample_ids.to_vec(),
        training_relations: training_relations
            .ok_or_else(|| package_error("initial full refit has no training relations"))?,
        training_envelope,
        data_identities: identities,
        outputs: output_bindings(input.plan),
        artifacts,
        raw_artifact_payloads,
        package_fingerprint: "0".repeat(64),
    };
    package.package_fingerprint = package.compute_fingerprint()?;
    package.validate()?;
    let scores = context.build_score_set(input.plan.id.clone(), None);
    Ok(InitialFullRefitExecution {
        package,
        results,
        scores,
    })
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InitialRefitReplayOutput {
    pub output_id: String,
    pub prediction: PredictionBlock,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InitialRefitReplayOutcome {
    pub schema_version: u32,
    pub package_id: String,
    pub package_fingerprint: String,
    pub run_id: RunId,
    pub cohort_fingerprint: String,
    pub outputs: Vec<InitialRefitReplayOutput>,
    pub outcome_fingerprint: String,
}

impl InitialRefitReplayOutcome {
    pub fn compute_fingerprint(&self) -> Result<String> {
        fingerprint(self, Some("outcome_fingerprint"))
    }

    pub fn validate_against(
        &self,
        package: &InitialFullRefitPackage,
        cohort: &PredictCohort,
    ) -> Result<()> {
        package.validate()?;
        cohort.validate()?;
        if self.schema_version != 1
            || self.package_id != package.package_id
            || self.package_fingerprint != package.package_fingerprint
            || self.cohort_fingerprint != cohort.cohort_fingerprint
            || self.outputs.is_empty()
        {
            return Err(package_error(
                "initial full-refit replay identity does not match package/cohort",
            ));
        }
        let mut ids = BTreeSet::new();
        for output in &self.outputs {
            let binding = package
                .outputs
                .iter()
                .find(|binding| binding.output_id == output.output_id)
                .ok_or_else(|| {
                    package_error("initial full-refit replay has unknown output binding")
                })?;
            if !ids.insert(&output.output_id)
                || output.prediction.producer_node != binding.node_id
                || output.prediction.producer_port.as_deref() != Some(binding.port_name.as_str())
                || output.prediction.partition != PredictionPartition::Final
                || output.prediction.fold_id.is_some()
                || output.prediction.sample_ids != cohort.physical_sample_ids
                || output.prediction.target_names != cohort.target_names
            {
                return Err(package_error(
                    "initial full-refit replay output differs from selected binding/cohort",
                ));
            }
            output.prediction.validate_content()?;
        }
        if self.outcome_fingerprint != self.compute_fingerprint()? {
            return Err(package_error(
                "initial full-refit replay outcome fingerprint mismatch",
            ));
        }
        Ok(())
    }
}

pub struct InitialRefitReplayInput<'a> {
    pub package: &'a InitialFullRefitPackage,
    pub envelope: &'a ExternalDataPlanEnvelope,
    pub output_ids: &'a [String],
    pub run_id: RunId,
    pub controllers: &'a RuntimeControllerRegistry,
    pub data_provider: &'a dyn RuntimeDataProvider,
    pub artifact_store: &'a dyn RuntimeArtifactStore,
}

pub struct InitialRefitReplayExecution {
    pub outcome: InitialRefitReplayOutcome,
    pub results: Vec<NodeResult>,
}

struct InitialPayloadArtifactStore<'a> {
    package: &'a InitialFullRefitPackage,
    controllers: &'a RuntimeControllerRegistry,
    fallback: &'a dyn RuntimeArtifactStore,
    hydrated: Mutex<Vec<(ControllerId, HandleRef)>>,
}

impl RuntimeArtifactStore for InitialPayloadArtifactStore<'_> {
    fn materialize(&self, request: &ArtifactMaterializationRequest) -> Result<HandleRef> {
        let Some(payload) = self.package.raw_artifact_payloads.get(&request.artifact.id) else {
            return self.fallback.materialize(request);
        };
        let controller = self
            .controllers
            .get(&request.controller_id)
            .ok_or_else(|| {
                package_error("initial full-refit raw artifact controller is missing")
            })?;
        let handle = controller.hydrate_artifact_payload(request, payload)?;
        self.hydrated
            .lock()
            .map_err(|_| package_error("initial full-refit hydrated-handle registry poisoned"))?
            .push((request.controller_id.clone(), handle.clone()));
        Ok(handle)
    }
}

impl InitialPayloadArtifactStore<'_> {
    fn release_hydrated(&self) -> Result<()> {
        let handles =
            std::mem::take(&mut *self.hydrated.lock().map_err(|_| {
                package_error("initial full-refit hydrated-handle registry poisoned")
            })?);
        let mut failures = Vec::new();
        for (controller_id, handle) in handles.into_iter().rev() {
            let result = self
                .controllers
                .get(&controller_id)
                .ok_or_else(|| {
                    package_error("initial full-refit hydrated artifact controller disappeared")
                })
                .and_then(|controller| controller.release_hydrated_artifact_payload(&handle));
            if let Err(error) = result {
                failures.push(error.to_string());
            }
        }
        if failures.is_empty() {
            Ok(())
        } else {
            Err(package_error(format!(
                "initial full-refit hydrated artifact release failed: {}",
                failures.join("; ")
            )))
        }
    }
}

/// Run PREDICT from the captured REFIT artifacts and an independent V2 cohort.
/// No package-bound CV selection or training phase is replayed.
pub fn execute_initial_full_refit_prediction(
    input: InitialRefitReplayInput<'_>,
) -> Result<InitialRefitReplayExecution> {
    input.package.validate()?;
    let cohort = require_terminal_predict_cohort(input.envelope)?;
    if input.output_ids.is_empty()
        || input.output_ids.iter().collect::<BTreeSet<_>>().len() != input.output_ids.len()
    {
        return Err(package_error(
            "initial full-refit replay requires distinct explicit output IDs",
        ));
    }
    let plan = &input.package.effective_plan;
    for output_id in input.output_ids {
        let binding = input
            .package
            .outputs
            .iter()
            .find(|binding| binding.output_id == *output_id)
            .ok_or_else(|| {
                package_error(format!("unknown initial full-refit output `{output_id}`"))
            })?;
        validate_terminal_prediction_preflight(
            plan,
            input.envelope,
            &TerminalPredictionSelector::new(binding.node_id.clone(), binding.port_name.clone())?,
        )?;
    }
    for node in plan.node_plans.values().filter(|node| {
        node.supported_phases.contains(&Phase::Predict)
            && node
                .controller_capabilities
                .contains(&crate::ControllerCapability::Stateful)
    }) {
        if !input
            .package
            .artifacts
            .iter()
            .any(|artifact| artifact.record.node_id == node.node_id)
        {
            return Err(package_error(format!(
                "initial full-refit stateful node `{}` has no captured artifact",
                node.node_id
            )));
        }
    }
    for binding in plan
        .node_plans
        .values()
        .flat_map(|node| node.data_bindings.iter())
    {
        binding.validate_envelope(input.envelope)?;
        if input
            .data_provider
            .predict_cohort(binding, Phase::Predict)?
            .as_ref()
            != Some(cohort)
        {
            return Err(package_error(
                "initial full-refit provider cohort differs from replay envelope",
            ));
        }
    }
    let mut ctx = RunContext::new(input.run_id.clone(), input.package.execution_root_seed);
    ctx.variant_id = Some(input.package.variant_id.clone());
    ctx.resource_limits = input.package.resource_limits.clone();
    let payload_store = InitialPayloadArtifactStore {
        package: input.package,
        controllers: input.controllers,
        fallback: input.artifact_store,
        hydrated: Mutex::new(Vec::new()),
    };
    let execution = SequentialScheduler.execute_initial_full_refit_predict(
        input.package,
        input.envelope,
        input.controllers,
        input.data_provider,
        &payload_store,
        &mut ctx,
    );
    let released = payload_store.release_hydrated();
    let results = match (execution, released) {
        (Ok(results), Ok(())) => results,
        (Err(error), Ok(())) | (Ok(_), Err(error)) => return Err(error),
        (Err(execution), Err(release)) => {
            return Err(DagMlError::RuntimeValidation(format!(
                "{execution}; additionally failed to release hydrated artifacts: {release}"
            )))
        }
    };
    let mut outputs = Vec::new();
    for output_id in input.output_ids {
        let binding = input
            .package
            .outputs
            .iter()
            .find(|binding| binding.output_id == *output_id)
            .expect("preflighted output");
        let mut matches = results
            .iter()
            .flat_map(|result| result.predictions.iter())
            .filter(|block| {
                block.producer_node == binding.node_id
                    && block.producer_port.as_deref() == Some(binding.port_name.as_str())
            });
        let prediction = matches
            .next()
            .ok_or_else(|| {
                package_error(format!(
                    "initial full-refit output `{output_id}` was not emitted"
                ))
            })?
            .clone();
        if matches.next().is_some() {
            return Err(package_error(format!(
                "initial full-refit output `{output_id}` was emitted more than once"
            )));
        }
        outputs.push(InitialRefitReplayOutput {
            output_id: output_id.clone(),
            prediction,
        });
    }
    let mut outcome = InitialRefitReplayOutcome {
        schema_version: 1,
        package_id: input.package.package_id.clone(),
        package_fingerprint: input.package.package_fingerprint.clone(),
        run_id: input.run_id,
        cohort_fingerprint: cohort.cohort_fingerprint.clone(),
        outputs,
        outcome_fingerprint: "0".repeat(64),
    };
    outcome.outcome_fingerprint = outcome.compute_fingerprint()?;
    outcome.validate_against(input.package, cohort)?;
    Ok(InitialRefitReplayExecution { outcome, results })
}
