//! Public training replay contracts.
//!
//! This module owns the strict, portable `TrainingReplayRequest` and
//! `TrainingReplayOutcome` contracts introduced before the attached replay
//! runtime. The low-level `ReplayPhaseRequest` in `bundle` remains the internal
//! phase API; these types are the public training-owned replay surface.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::bundle::{ExecutionBundle, MethodsHpoResumeState, ReplayPhaseRequest};
use crate::campaign::stable_json_fingerprint;
use crate::canonical::{deserialize_external_contract, parse_typed_json};
use crate::conformal::{ConformalMultiTargetPolicy, ConformalSmallSamplePolicy};
use crate::conformal_runtime::{
    ConformalCalibration, ConformalCalibrationCohort, ConformalCalibrationContext,
    ConformalCalibrationTruth, ConformalIntervalBlock,
};
use crate::data::ExternalDataPlanEnvelope;
use crate::error::{DagMlError, Result};
use crate::fold::fold_set_fingerprint;
use crate::ids::{ArtifactId, BundleId, ControllerId, RunId};
use crate::phase::Phase;
use crate::plan::ExecutionPlan;
use crate::relation::SampleRelationSet;
use crate::runtime::{
    ArtifactMaterializationRequest, BundleReplayExecution, ExplanationBlock, HandleRef,
    LineageRecord, RunContext, RuntimeArtifactStore, RuntimeControllerRegistry,
    RuntimeDataProvider, SequentialScheduler,
};
use crate::training::{LoadedPredictor, PortablePredictorPackage, TrainingOutcomeRef};
use crate::training_runtime::{
    BoundTrainingOutput, PortableRefitPackageV3, TrainingOutcome,
    BOUND_TRAINING_OUTPUT_SCHEMA_VERSION,
};

pub const TRAINING_REPLAY_REQUEST_SCHEMA_VERSION: u32 = 1;
/// V3 permits target-free external data identities for PREDICT/EXPLAIN while
/// retaining typed conformal-interval closure. Calibration evidence remains
/// target-bound, but a fresh unlabeled cohort must not invent a target
/// fingerprint merely to receive intervals derived from that calibration.
pub const TRAINING_REPLAY_OUTCOME_SCHEMA_VERSION: u32 = 3;
pub const LEGACY_TRAINING_REPLAY_OUTCOME_SCHEMA_VERSION: u32 = 1;
pub const CONFORMAL_TRAINING_REPLAY_OUTCOME_SCHEMA_VERSION: u32 = 2;
pub const MIN_READABLE_TRAINING_REPLAY_OUTCOME_SCHEMA_VERSION: u32 = 1;

/// Strictly decode the complete, current Methods HPO resume state.
///
/// The resume state has no legacy migration branch: the scheduler-owned
/// operation/controller/target identity, incumbent, and terminal native trace
/// are atomic with the N4MOPT checkpoint. In particular, a historical
/// `tuner_node_id` sentinel is an unknown member, not an alias.
pub fn methods_hpo_resume_state_from_json(json: &str) -> Result<MethodsHpoResumeState> {
    parse_typed_json(json).map_err(|error| {
        DagMlError::RuntimeValidation(format!(
            "Methods HPO resume state is not strict TCV1 JSON: {error}"
        ))
    })?;
    let state: MethodsHpoResumeState = deserialize_external_contract(
        json,
        "Methods HPO resume state",
        DagMlError::RuntimeValidation,
    )?;
    state.validate()?;
    Ok(state)
}

/// Deserialize a portable predictor package and extract its complete Methods
/// HPO resume state.  This deliberately accepts package JSON rather than a
/// checkpoint/descriptor value: a resume is authorized only by state that has
/// survived the package's strict deserialization and cross-link validation.
pub fn methods_hpo_resume_state_from_package_json(json: &str) -> Result<MethodsHpoResumeState> {
    let package = PortablePredictorPackage::from_json(json)?;
    let state = package
        .execution_bundle
        .methods_hpo_resume_state
        .ok_or_else(|| {
            DagMlError::RuntimeValidation(
                "portable predictor package has no typed Methods HPO resume state; legacy checkpoint fields are not resumable"
                    .to_string(),
            )
        })?;
    // Package parsing already validates the nested state; keep the replay
    // reader fail-closed if this call path is ever supplied a constructed
    // package instead of its strict external JSON representation.
    state.validate()?;
    Ok(state)
}

pub struct AttachedTrainingReplayInput<'a> {
    pub source: &'a TrainingOutcome,
    pub request: &'a TrainingReplayRequest,
    pub outcome_id: String,
    pub run_id: RunId,
    pub controllers: &'a RuntimeControllerRegistry,
    pub data_provider: &'a dyn RuntimeDataProvider,
    pub artifact_store: &'a dyn RuntimeArtifactStore,
    pub data_envelopes: &'a BTreeMap<String, ExternalDataPlanEnvelope>,
    pub warnings: Vec<String>,
    pub diagnostics: BTreeMap<String, serde_json::Value>,
}

pub struct LoadedPredictorReplayInput<'a> {
    pub predictor: &'a LoadedPredictor<HandleRef>,
    pub request: &'a TrainingReplayRequest,
    pub outcome_id: String,
    pub run_id: RunId,
    pub controllers: &'a RuntimeControllerRegistry,
    pub data_provider: &'a dyn RuntimeDataProvider,
    pub data_envelopes: &'a BTreeMap<String, ExternalDataPlanEnvelope>,
    pub warnings: Vec<String>,
    pub diagnostics: BTreeMap<String, serde_json::Value>,
}

/// Process-local replay input for a detached Package V3 full-refit child.
/// V3 has no host-sidecar artifact mode: every artifact is rehydrated from the
/// child bundle's raw native payloads for this invocation only.
pub struct LoadedPortableRefitReplayInputV3<'a> {
    pub package: &'a PortableRefitPackageV3,
    pub request: &'a TrainingReplayRequest,
    pub outcome_id: String,
    pub run_id: RunId,
    pub controllers: &'a RuntimeControllerRegistry,
    pub data_provider: &'a dyn RuntimeDataProvider,
    pub data_envelopes: &'a BTreeMap<String, ExternalDataPlanEnvelope>,
    pub warnings: Vec<String>,
    pub diagnostics: BTreeMap<String, serde_json::Value>,
}

/// V3 replay evidence. This remains separate from [`TrainingReplayOutcome`],
/// whose source reference proves an original CV/SELECT training outcome.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PortableRefitReplayOutcomeV3 {
    pub schema_version: u32,
    pub outcome_id: String,
    pub run_id: RunId,
    pub source_package_fingerprint: String,
    pub source_refit_outcome_fingerprint: String,
    pub replay_request_id: String,
    pub replay_request_fingerprint: String,
    pub input_data_identities: Vec<ReplayDataIdentity>,
    pub bundle_id: BundleId,
    pub plan_id: String,
    pub phase: Phase,
    pub outputs: Vec<BoundTrainingOutput>,
    pub explanations: Vec<ExplanationBlock>,
    pub lineage: Vec<LineageRecord>,
    pub warnings: Vec<String>,
    pub diagnostics: BTreeMap<String, serde_json::Value>,
    pub outcome_fingerprint: String,
}

impl PortableRefitReplayOutcomeV3 {
    pub fn compute_fingerprint(&self) -> Result<String> {
        tcv1_fingerprint_without(
            self,
            "outcome_fingerprint",
            "portable refit replay outcome V3",
        )
    }

    /// Parse replay evidence only in the presence of the exact V3 child and
    /// replay request it claims to describe. A standalone deserializer would
    /// make both source fingerprints self-attested.
    pub fn from_json_for_package(
        json: &str,
        package: &PortableRefitPackageV3,
        request: &TrainingReplayRequest,
    ) -> Result<Self> {
        let raw_fingerprint = strict_tcv1_fingerprint_without(
            json,
            "outcome_fingerprint",
            "portable refit replay outcome V3",
        )?;
        let outcome: Self = serde_json::from_str(json)?;
        if outcome.outcome_fingerprint != raw_fingerprint {
            return contract_error(
                "portable refit replay outcome fingerprint does not match original TCV1 JSON"
                    .to_string(),
            );
        }
        outcome.validate_against(package, request)?;
        Ok(outcome)
    }

    pub fn validate_against(
        &self,
        package: &PortableRefitPackageV3,
        request: &TrainingReplayRequest,
    ) -> Result<()> {
        if self.schema_version != 3 {
            return contract_error(
                "portable refit replay outcome V3 has unsupported schema_version".to_string(),
            );
        }
        package.validate()?;
        request.validate()?;
        validate_replay_phase(request.phase)?;
        validate_identifier("portable refit replay outcome_id", &self.outcome_id)?;
        validate_sha256(
            "portable refit replay source package",
            &self.source_package_fingerprint,
        )?;
        validate_sha256(
            "portable refit replay source outcome",
            &self.source_refit_outcome_fingerprint,
        )?;
        validate_sha256(
            "portable refit replay request",
            &self.replay_request_fingerprint,
        )?;
        validate_sha256("portable refit replay", &self.outcome_fingerprint)?;
        if self.source_package_fingerprint != package.package_fingerprint
            || self.source_refit_outcome_fingerprint != package.outcome.outcome_fingerprint
            || request.source_outcome_fingerprint != package.outcome.outcome_fingerprint
            || self.replay_request_id != request.request_id
            || self.replay_request_fingerprint != request.request_fingerprint
            || self.bundle_id != package.outcome.execution_bundle.bundle_id
            || self.plan_id != package.outcome.effective_plan.id
            || self.phase != request.phase
        {
            return contract_error(
                "portable refit replay outcome does not exactly bind its V3 package and request"
                    .to_string(),
            );
        }
        let identity_keys = self
            .input_data_identities
            .iter()
            .map(|identity| identity.requirement_key.clone())
            .collect::<Vec<_>>();
        if identity_keys != request.data_envelope_keys {
            return contract_error(
                "portable refit replay identities do not exactly cover replay request envelopes"
                    .to_string(),
            );
        }
        for identity in &self.input_data_identities {
            identity.validate()?;
        }
        validate_sorted_unique_text("portable refit replay warnings", &self.warnings, false)?;
        validate_diagnostics(&self.diagnostics)?;
        validate_output_order_and_version(&self.outputs)?;
        let bindings = package
            .outcome
            .output_bindings
            .iter()
            .map(|binding| (binding.binding_id.as_str(), binding))
            .collect::<BTreeMap<_, _>>();
        let emitted_binding_ids = self
            .outputs
            .iter()
            .map(|output| output.binding.binding_id.clone())
            .collect::<Vec<_>>();
        if self.phase == Phase::Predict && emitted_binding_ids != request.output_binding_ids {
            return contract_error(
                "portable refit PREDICT outputs do not exactly cover replay request bindings"
                    .to_string(),
            );
        }
        for output in &self.outputs {
            let source = bindings
                .get(output.binding.binding_id.as_str())
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation(
                        "portable refit replay emits an output absent from its V3 package"
                            .to_string(),
                    )
                })?;
            if &output.binding != *source {
                return contract_error(
                    "portable refit replay output binding differs from V3 package".to_string(),
                );
            }
            output.validate(&package.outcome.effective_plan)?;
            validate_replay_bound_output_blocks(output)?;
        }
        for explanation in &self.explanations {
            explanation.validate()?;
        }
        for record in &self.lineage {
            record.validate()?;
        }
        match self.phase {
            Phase::Predict if self.outputs.is_empty() => {
                return contract_error("portable refit PREDICT requires outputs".to_string());
            }
            Phase::Predict if !self.explanations.is_empty() => {
                return contract_error(
                    "portable refit PREDICT cannot emit explanations".to_string(),
                );
            }
            Phase::Explain if self.explanations.is_empty() => {
                return contract_error("portable refit EXPLAIN requires explanations".to_string());
            }
            _ => {}
        }
        if self.outcome_fingerprint != self.compute_fingerprint()? {
            return contract_error(
                "portable refit replay outcome fingerprint does not match TCV1 content".to_string(),
            );
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrainingReplayRequest {
    pub schema_version: u32,
    pub request_id: String,
    pub source_outcome_fingerprint: String,
    pub phase: Phase,
    pub data_envelope_keys: Vec<String>,
    pub output_binding_ids: Vec<String>,
    pub request_fingerprint: String,
}

impl TrainingReplayRequest {
    pub fn from_json(json: &str) -> Result<Self> {
        let raw_fingerprint = strict_tcv1_fingerprint_without(
            json,
            "request_fingerprint",
            "training replay request",
        )?;
        let request: Self = serde_json::from_str(json)?;
        if request.request_fingerprint != raw_fingerprint {
            return contract_error(
                "training replay request fingerprint does not match original TCV1 JSON",
            );
        }
        request.validate()?;
        Ok(request)
    }

    pub fn compute_fingerprint(&self) -> Result<String> {
        tcv1_fingerprint_without(self, "request_fingerprint", "training replay request")
    }

    pub fn validate(&self) -> Result<()> {
        if self.schema_version != TRAINING_REPLAY_REQUEST_SCHEMA_VERSION {
            return unsupported_version(
                "training replay request",
                self.schema_version,
                TRAINING_REPLAY_REQUEST_SCHEMA_VERSION,
            );
        }
        validate_identifier("training replay request_id", &self.request_id)?;
        validate_sha256(
            "training replay source outcome",
            &self.source_outcome_fingerprint,
        )?;
        validate_replay_phase(self.phase)?;
        validate_sorted_unique_text(
            "training replay data_envelope_keys",
            &self.data_envelope_keys,
            true,
        )?;
        validate_sorted_unique_identifiers(
            "training replay output_binding_ids",
            &self.output_binding_ids,
            true,
        )?;
        validate_sha256("training replay request", &self.request_fingerprint)?;
        if self.request_fingerprint != self.compute_fingerprint()? {
            return contract_error(
                "training replay request fingerprint does not match TCV1 content",
            );
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrainingReplayOutcome {
    pub schema_version: u32,
    pub outcome_id: String,
    pub run_id: RunId,
    pub source_training_outcome: TrainingOutcomeRef,
    pub replay_request_id: String,
    pub replay_request_fingerprint: String,
    pub input_data_identities: Vec<ReplayDataIdentity>,
    pub bundle_id: BundleId,
    pub plan_id: String,
    pub phase: Phase,
    pub result_count: usize,
    pub lineage_record_count: usize,
    pub prediction_block_count: usize,
    pub observation_prediction_block_count: usize,
    pub aggregated_prediction_block_count: usize,
    pub explanation_block_count: usize,
    pub controller_count: usize,
    pub prediction_cache_store: bool,
    pub outputs: Vec<BoundTrainingOutput>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub conformal_intervals: Vec<ConformalIntervalBlock>,
    pub explanations: Vec<ExplanationBlock>,
    pub lineage: Vec<LineageRecord>,
    pub warnings: Vec<String>,
    pub diagnostics: BTreeMap<String, serde_json::Value>,
    pub outcome_fingerprint: String,
}

/// Content identity for one external replay input.
///
/// This is intentionally distinct from [`crate::training::TrainingDataIdentity`].  Training
/// requires a target-content proof because it scores and selects models;
/// PREDICT and EXPLAIN operate on a new, often unlabeled cohort and therefore
/// attest only the feature content and relation authority.  A target proof is
/// retained when the caller supplies one (for example calibration evidence),
/// but absence is never represented by a sentinel digest.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayDataIdentity {
    pub requirement_key: String,
    pub schema_fingerprint: String,
    pub plan_fingerprint: String,
    pub relation_fingerprint: String,
    pub data_content_fingerprint: String,
    #[serde(default)]
    pub target_content_fingerprint: Option<String>,
    pub identity_fingerprint: String,
}

impl ReplayDataIdentity {
    /// Compute the strict TCV1 identity fingerprint used by the portable
    /// replay outcome.
    pub fn compute_fingerprint(&self) -> Result<String> {
        tcv1_fingerprint_without(self, "identity_fingerprint", "replay data identity")
    }

    fn validate(&self) -> Result<()> {
        validate_non_empty("replay data requirement_key", &self.requirement_key)?;
        for (label, value) in [
            ("replay data schema", &self.schema_fingerprint),
            ("replay data plan", &self.plan_fingerprint),
            ("replay data relation", &self.relation_fingerprint),
            ("replay data content", &self.data_content_fingerprint),
            ("replay data identity", &self.identity_fingerprint),
        ] {
            validate_sha256(label, value)?;
        }
        if let Some(target_content_fingerprint) = &self.target_content_fingerprint {
            validate_sha256("replay target content", target_content_fingerprint)?;
        }
        if self.identity_fingerprint != self.compute_fingerprint()? {
            return contract_error("replay data identity fingerprint does not match TCV1 content");
        }
        Ok(())
    }
}

impl TrainingReplayOutcome {
    pub fn from_json(json: &str) -> Result<Self> {
        let raw_fingerprint = strict_tcv1_fingerprint_without(
            json,
            "outcome_fingerprint",
            "training replay outcome",
        )?;
        let outcome: Self = serde_json::from_str(json)?;
        if outcome.outcome_fingerprint != raw_fingerprint {
            return contract_error(
                "training replay outcome fingerprint does not match original TCV1 JSON",
            );
        }
        outcome.validate()?;
        Ok(outcome)
    }

    pub fn compute_fingerprint(&self) -> Result<String> {
        tcv1_fingerprint_without(self, "outcome_fingerprint", "training replay outcome")
    }

    pub fn validate(&self) -> Result<()> {
        if self.schema_version < MIN_READABLE_TRAINING_REPLAY_OUTCOME_SCHEMA_VERSION
            || self.schema_version > TRAINING_REPLAY_OUTCOME_SCHEMA_VERSION
        {
            return unsupported_version(
                "training replay outcome",
                self.schema_version,
                TRAINING_REPLAY_OUTCOME_SCHEMA_VERSION,
            );
        }
        validate_identifier("training replay outcome_id", &self.outcome_id)?;
        validate_identifier("training replay request_id", &self.replay_request_id)?;
        validate_sha256("training replay request", &self.replay_request_fingerprint)?;
        validate_non_empty("training replay plan_id", &self.plan_id)?;
        validate_replay_phase(self.phase)?;
        self.source_training_outcome.validate()?;
        for identity in &self.input_data_identities {
            identity.validate()?;
        }
        if self.schema_version < TRAINING_REPLAY_OUTCOME_SCHEMA_VERSION
            && self
                .input_data_identities
                .iter()
                .any(|identity| identity.target_content_fingerprint.is_none())
        {
            return contract_error(
                "training replay outcome V1/V2 requires target-bound input identities; migrate target-free PREDICT/EXPLAIN evidence to V3",
            );
        }
        validate_sorted_unique_keys(
            "training replay input_data_identities",
            self.input_data_identities
                .iter()
                .map(|identity| identity.requirement_key.as_str()),
            true,
        )?;
        if self.prediction_cache_store {
            return contract_error("training replay outcome cannot persist a prediction cache");
        }
        validate_sorted_unique_text("training replay warnings", &self.warnings, false)?;
        validate_diagnostics(&self.diagnostics)?;
        validate_output_order_and_version(&self.outputs)?;
        if self.schema_version == LEGACY_TRAINING_REPLAY_OUTCOME_SCHEMA_VERSION
            && (!self.conformal_intervals.is_empty()
                || self
                    .source_training_outcome
                    .pre_conformal_outcome_fingerprint
                    .is_some())
        {
            return contract_error(
                "training replay outcome V1 cannot carry conformal state; migrate to V2 or V3",
            );
        }
        for output in &self.outputs {
            validate_replay_bound_output_blocks(output)?;
        }
        for interval in &self.conformal_intervals {
            let output = self
                .outputs
                .iter()
                .find(|output| output.binding.binding_id == interval.binding_id)
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation(
                        "conformal interval references an absent replay output binding".to_string(),
                    )
                })?;
            let point = output
                .predictions
                .iter()
                .find(|block| block.sample_ids == interval.sample_ids)
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation(
                        "conformal interval has no matching replay point prediction block"
                            .to_string(),
                    )
                })?;
            interval.validate()?;
            if interval.point_prediction_fingerprint
                != crate::conformal_runtime::point_prediction_fingerprint_for_runtime(point)?
            {
                return Err(DagMlError::RuntimeValidation(
                    "conformal interval point prediction fingerprint does not match replay output"
                        .to_string(),
                ));
            }
        }
        for explanation in &self.explanations {
            explanation.validate()?;
            validate_optional_port(
                "training replay explanation producer_port",
                &explanation.producer_port,
            )?;
        }
        for record in &self.lineage {
            record.validate()?;
        }
        match self.phase {
            Phase::Predict if self.outputs.is_empty() => {
                return contract_error("training replay PREDICT requires at least one output");
            }
            Phase::Predict if !self.explanations.is_empty() => {
                return contract_error("training replay PREDICT cannot emit explanations");
            }
            Phase::Explain if self.explanations.is_empty() => {
                return contract_error("training replay EXPLAIN requires at least one explanation");
            }
            _ => {}
        }
        self.validate_counters()?;
        validate_sha256("training replay outcome", &self.outcome_fingerprint)?;
        if self.outcome_fingerprint != self.compute_fingerprint()? {
            return contract_error(
                "training replay outcome fingerprint does not match TCV1 content",
            );
        }
        Ok(())
    }

    pub fn validate_against(
        &self,
        source: &TrainingOutcome,
        request: &TrainingReplayRequest,
    ) -> Result<()> {
        self.validate()?;
        source.validate()?;
        request.validate()?;
        if request.source_outcome_fingerprint != source.outcome_fingerprint {
            return contract_error("training replay request does not target source outcome");
        }
        if !source.replayable_phases.contains(&request.phase) {
            return contract_error("training replay phase is not replayable by source outcome");
        }
        if self.source_training_outcome != source.to_reference()? {
            return contract_error(
                "training replay outcome source reference does not match source outcome",
            );
        }
        if self.replay_request_id != request.request_id {
            return contract_error(
                "training replay outcome request id does not match ReplayRequest",
            );
        }
        if self.replay_request_fingerprint != request.request_fingerprint {
            return contract_error(
                "training replay outcome request fingerprint does not match ReplayRequest",
            );
        }
        if self.phase != request.phase {
            return contract_error("training replay outcome phase does not match ReplayRequest");
        }
        if self.bundle_id != source.execution_bundle.bundle_id {
            return contract_error("training replay outcome bundle does not match source outcome");
        }
        if self.plan_id != source.effective_plan.id {
            return contract_error("training replay outcome plan does not match source outcome");
        }
        let identity_keys = self
            .input_data_identities
            .iter()
            .map(|identity| identity.requirement_key.clone())
            .collect::<Vec<_>>();
        if identity_keys != request.data_envelope_keys {
            return contract_error(
                "training replay outcome identities do not exactly cover ReplayRequest envelopes",
            );
        }
        let source_bindings = source
            .outputs
            .iter()
            .map(|output| (output.binding.binding_id.as_str(), &output.binding))
            .collect::<BTreeMap<_, _>>();
        for binding_id in &request.output_binding_ids {
            if !source_bindings.contains_key(binding_id.as_str()) {
                return contract_error(
                    "training replay request references absent source output binding",
                );
            }
        }
        let emitted_binding_ids = self
            .outputs
            .iter()
            .map(|output| output.binding.binding_id.clone())
            .collect::<Vec<_>>();
        if self.phase == Phase::Predict && emitted_binding_ids != request.output_binding_ids {
            return contract_error(
                "training replay PREDICT outputs do not exactly cover ReplayRequest bindings",
            );
        }
        if self.phase == Phase::Explain
            && !emitted_binding_ids
                .iter()
                .all(|binding_id| request.output_binding_ids.contains(binding_id))
        {
            return contract_error(
                "training replay EXPLAIN outputs include a binding outside ReplayRequest",
            );
        }
        for output in &self.outputs {
            let Some(source_binding) = source_bindings.get(output.binding.binding_id.as_str())
            else {
                return contract_error(
                    "training replay output binding is absent from source outcome",
                );
            };
            if &output.binding != *source_binding {
                return contract_error(
                    "training replay output binding does not match source outcome binding",
                );
            }
            output.validate(&source.effective_plan)?;
        }
        match &source.conformal_calibration {
            None if !self.conformal_intervals.is_empty() => {
                return contract_error(
                    "training replay intervals require source calibration context",
                )
            }
            Some(calibration) => validate_replay_interval_closure(
                calibration,
                &self.outputs,
                &self.conformal_intervals,
            )?,
            None => {}
        }
        Ok(())
    }

    pub fn validate_against_package(
        &self,
        package: &PortablePredictorPackage,
        request: &TrainingReplayRequest,
    ) -> Result<()> {
        self.validate()?;
        package.validate()?;
        request.validate()?;
        validate_replay_phase(request.phase)?;
        if request.source_outcome_fingerprint != package.training_outcome.outcome_fingerprint {
            return contract_error(
                "training replay request does not target package source outcome",
            );
        }
        if self.source_training_outcome != package.training_outcome {
            return contract_error(
                "training replay outcome source reference does not match package source outcome",
            );
        }
        if self.replay_request_id != request.request_id {
            return contract_error(
                "training replay outcome request id does not match ReplayRequest",
            );
        }
        if self.replay_request_fingerprint != request.request_fingerprint {
            return contract_error(
                "training replay outcome request fingerprint does not match ReplayRequest",
            );
        }
        if self.phase != request.phase {
            return contract_error("training replay outcome phase does not match ReplayRequest");
        }
        if self.bundle_id != package.execution_bundle.bundle_id {
            return contract_error("training replay outcome bundle does not match package");
        }
        if self.plan_id != package.effective_plan.id {
            return contract_error("training replay outcome plan does not match package");
        }
        let identity_keys = self
            .input_data_identities
            .iter()
            .map(|identity| identity.requirement_key.clone())
            .collect::<Vec<_>>();
        if identity_keys != request.data_envelope_keys {
            return contract_error(
                "training replay outcome identities do not exactly cover ReplayRequest envelopes",
            );
        }
        let package_bindings = package
            .output_bindings
            .iter()
            .map(|binding| (binding.binding_id.as_str(), binding))
            .collect::<BTreeMap<_, _>>();
        for binding_id in &request.output_binding_ids {
            if !package_bindings.contains_key(binding_id.as_str()) {
                return contract_error(
                    "training replay request references absent package output binding",
                );
            }
        }
        let emitted_binding_ids = self
            .outputs
            .iter()
            .map(|output| output.binding.binding_id.clone())
            .collect::<Vec<_>>();
        if self.phase == Phase::Predict && emitted_binding_ids != request.output_binding_ids {
            return contract_error(
                "training replay PREDICT outputs do not exactly cover ReplayRequest bindings",
            );
        }
        if self.phase == Phase::Explain
            && !emitted_binding_ids
                .iter()
                .all(|binding_id| request.output_binding_ids.contains(binding_id))
        {
            return contract_error(
                "training replay EXPLAIN outputs include a binding outside ReplayRequest",
            );
        }
        for output in &self.outputs {
            let Some(package_binding) = package_bindings.get(output.binding.binding_id.as_str())
            else {
                return contract_error("training replay output binding is absent from package");
            };
            if &output.binding != *package_binding {
                return contract_error(
                    "training replay output binding does not match package binding",
                );
            }
            output.validate(&package.effective_plan)?;
        }
        match &package.conformal_calibration {
            None if !self.conformal_intervals.is_empty() => {
                return contract_error(
                    "training replay intervals require package calibration context",
                )
            }
            Some(calibration) => validate_replay_interval_closure(
                calibration,
                &self.outputs,
                &self.conformal_intervals,
            )?,
            None => {}
        }
        Ok(())
    }

    fn validate_counters(&self) -> Result<()> {
        require_count(
            "training replay result_count",
            self.result_count,
            self.lineage.len(),
        )?;
        require_count(
            "training replay lineage_record_count",
            self.lineage_record_count,
            self.lineage.len(),
        )?;
        require_count(
            "training replay prediction_block_count",
            self.prediction_block_count,
            self.outputs
                .iter()
                .map(|output| output.predictions.len())
                .sum(),
        )?;
        require_count(
            "training replay observation_prediction_block_count",
            self.observation_prediction_block_count,
            self.outputs
                .iter()
                .map(|output| output.observation_predictions.len())
                .sum(),
        )?;
        require_count(
            "training replay aggregated_prediction_block_count",
            self.aggregated_prediction_block_count,
            self.outputs
                .iter()
                .map(|output| output.aggregated_predictions.len())
                .sum(),
        )?;
        require_count(
            "training replay explanation_block_count",
            self.explanation_block_count,
            self.explanations.len(),
        )?;
        let controller_count = self
            .lineage
            .iter()
            .map(|record| record.controller_id.as_str())
            .collect::<BTreeSet<_>>()
            .len();
        require_count(
            "training replay controller_count",
            self.controller_count,
            controller_count,
        )?;
        Ok(())
    }
}

/// Reconstruct the complete signed request preimage retained transitively by
/// a replay outcome. Validation of the returned request proves the replay did
/// not merely self-attest an opaque request fingerprint.
pub(crate) fn replay_request_from_outcome(replay: &TrainingReplayOutcome) -> TrainingReplayRequest {
    TrainingReplayRequest {
        schema_version: TRAINING_REPLAY_REQUEST_SCHEMA_VERSION,
        request_id: replay.replay_request_id.clone(),
        source_outcome_fingerprint: replay.source_training_outcome.outcome_fingerprint.clone(),
        phase: replay.phase,
        data_envelope_keys: replay
            .input_data_identities
            .iter()
            .map(|identity| identity.requirement_key.clone())
            .collect(),
        output_binding_ids: replay
            .outputs
            .iter()
            .map(|output| output.binding.binding_id.clone())
            .collect(),
        request_fingerprint: replay.replay_request_fingerprint.clone(),
    }
}

struct LoadedPredictorArtifactStore<'a> {
    predictor: &'a LoadedPredictor<HandleRef>,
    records: BTreeMap<ArtifactId, crate::bundle::RefitArtifactRecord>,
}

/// Replays durable raw artifact members directly from an execution bundle.
///
/// The fallback store remains available for host-owned artifacts, but a raw
/// bundle member always wins: its controller receives bytes from the newly
/// deserialized bundle and returns a fresh, invocation-local handle. This is
/// the public replay route for portable native artifacts and never consults a
/// previous controller's process-local handle state.
struct BundlePayloadArtifactStore<'a> {
    bundle: &'a ExecutionBundle,
    controllers: &'a RuntimeControllerRegistry,
    fallback: &'a dyn RuntimeArtifactStore,
    hydrated_handles: Mutex<Vec<(ControllerId, HandleRef)>>,
}

impl RuntimeArtifactStore for BundlePayloadArtifactStore<'_> {
    fn materialize(&self, request: &ArtifactMaterializationRequest) -> Result<HandleRef> {
        let Some(payload) = self.bundle.raw_artifact_payloads.get(&request.artifact.id) else {
            return self.fallback.materialize(request);
        };
        let controller = self
            .controllers
            .get(&request.controller_id)
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "bundle `{}` has no registered controller `{}` to hydrate raw artifact `{}`",
                    self.bundle.bundle_id, request.controller_id, request.artifact.id
                ))
            })?;
        let handle = controller.hydrate_artifact_payload(request, payload)?;
        self.hydrated_handles
            .lock()
            .map_err(|_| {
                DagMlError::RuntimeValidation(
                    "bundle payload hydrated-handle registry lock poisoned".to_string(),
                )
            })?
            .push((request.controller_id.clone(), handle.clone()));
        Ok(handle)
    }
}

impl BundlePayloadArtifactStore<'_> {
    fn release_hydrated_handles(&self) -> Result<()> {
        let handles = {
            let mut handles = self.hydrated_handles.lock().map_err(|_| {
                DagMlError::RuntimeValidation(
                    "bundle payload hydrated-handle registry lock poisoned".to_string(),
                )
            })?;
            std::mem::take(&mut *handles)
        };
        let mut failures = Vec::new();
        for (controller_id, handle) in handles.into_iter().rev() {
            let release = self
                .controllers
                .get(&controller_id)
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation(format!(
                        "hydrated artifact owner controller `{controller_id}` is no longer registered"
                    ))
                })
                .and_then(|controller| controller.release_hydrated_artifact_payload(&handle));
            if let Err(error) = release {
                failures.push(error.to_string());
            }
        }
        if failures.is_empty() {
            Ok(())
        } else {
            Err(DagMlError::RuntimeValidation(format!(
                "failed to release replay-hydrated artifact handles: {}",
                failures.join("; ")
            )))
        }
    }
}

fn finish_bundle_payload_replay<T>(
    execution: Result<T>,
    artifact_store: &BundlePayloadArtifactStore<'_>,
) -> Result<T> {
    let cleanup = artifact_store.release_hydrated_handles();
    match (execution, cleanup) {
        (Ok(value), Ok(())) => Ok(value),
        (Err(error), Ok(())) => Err(error),
        (Ok(_), Err(cleanup_error)) => Err(cleanup_error),
        (Err(error), Err(cleanup_error)) => Err(DagMlError::RuntimeValidation(format!(
            "{error}; replay hydration cleanup also failed: {cleanup_error}"
        ))),
    }
}

/// Package V3 has no host-sidecar fallback.  Any scheduler request not backed
/// by an exact detached raw payload is a contract violation before a provider
/// can observe data.
struct RejectRefitSidecarStore;

impl RuntimeArtifactStore for RejectRefitSidecarStore {
    fn materialize(&self, request: &ArtifactMaterializationRequest) -> Result<HandleRef> {
        Err(DagMlError::RuntimeValidation(format!(
            "portable refit V3 replay refuses non-raw or missing artifact `{}`",
            request.artifact.id
        )))
    }
}

impl<'a> LoadedPredictorArtifactStore<'a> {
    fn new(predictor: &'a LoadedPredictor<HandleRef>) -> Result<Self> {
        predictor.package().validate()?;
        let records = predictor
            .package()
            .execution_bundle
            .refit_artifacts
            .iter()
            .map(|record| {
                record.validate()?;
                Ok((record.artifact.id.clone(), record.clone()))
            })
            .collect::<Result<BTreeMap<_, _>>>()?;
        Ok(Self { predictor, records })
    }
}

impl RuntimeArtifactStore for LoadedPredictorArtifactStore<'_> {
    fn materialize(&self, request: &ArtifactMaterializationRequest) -> Result<HandleRef> {
        let record = self.records.get(&request.artifact.id).ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "loaded predictor is missing refit artifact `{}` for bundle `{}`",
                request.artifact.id, request.bundle_id
            ))
        })?;
        if record.node_id != request.node_id {
            return Err(DagMlError::RuntimeValidation(format!(
                "artifact `{}` is registered for node `{}` but requested for `{}`",
                request.artifact.id, record.node_id, request.node_id
            )));
        }
        if record.controller_id != request.controller_id {
            return Err(DagMlError::RuntimeValidation(format!(
                "artifact `{}` is registered for controller `{}` but requested for `{}`",
                request.artifact.id, record.controller_id, request.controller_id
            )));
        }
        if record.artifact != request.artifact {
            return Err(DagMlError::RuntimeValidation(format!(
                "artifact `{}` metadata does not match package bundle record",
                request.artifact.id
            )));
        }
        if record.params_fingerprint != request.params_fingerprint {
            return Err(DagMlError::RuntimeValidation(format!(
                "artifact `{}` params fingerprint does not match package bundle record",
                request.artifact.id
            )));
        }
        let handle = self
            .predictor
            .artifact(&request.artifact.id)
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "loaded predictor has no process-local handle for `{}`",
                    request.artifact.id
                ))
            })?;
        Ok(handle.clone())
    }
}

pub fn execute_attached_training_replay(
    input: AttachedTrainingReplayInput<'_>,
) -> Result<TrainingReplayOutcome> {
    input.source.validate()?;
    input.request.validate()?;
    validate_sorted_unique_text("training replay execution warnings", &input.warnings, false)?;
    validate_diagnostics(&input.diagnostics)?;
    if input.request.source_outcome_fingerprint != input.source.outcome_fingerprint {
        return contract_error("training replay request does not target source outcome");
    }
    if !input
        .source
        .replayable_phases
        .contains(&input.request.phase)
    {
        return contract_error("training replay phase is not replayable by source outcome");
    }
    for node_plan in input.source.effective_plan.node_plans.values() {
        if input.controllers.get(&node_plan.controller_id).is_none() {
            return Err(DagMlError::RuntimeValidation(format!(
                "attached training replay controller `{}` for node `{}` is not registered",
                node_plan.controller_id, node_plan.node_id
            )));
        }
    }

    let input_data_identities = replay_input_data_identities(
        &input.source.execution_bundle,
        input.request,
        input.data_envelopes,
    )?;
    let (replay_plan, replay_bundle) = replay_plan_and_bundle_for_current_cohort(
        &input.source.effective_plan,
        &input.source.execution_bundle,
        input.request,
        input.data_envelopes,
    )?;
    let phase_request = ReplayPhaseRequest {
        bundle_id: replay_bundle.bundle_id.clone(),
        phase: input.request.phase,
        data_envelope_keys: input.request.data_envelope_keys.clone(),
    };
    let artifact_store = BundlePayloadArtifactStore {
        bundle: &replay_bundle,
        controllers: input.controllers,
        fallback: input.artifact_store,
        hydrated_handles: Mutex::new(Vec::new()),
    };
    let mut ctx = RunContext::new(input.run_id.clone(), None);
    let execution = SequentialScheduler.execute_bundle_replay(
        BundleReplayExecution {
            plan: &replay_plan,
            bundle: &replay_bundle,
            replay_request: &phase_request,
            prediction_cache_store: None,
            controllers: input.controllers,
            data_provider: input.data_provider,
            artifact_store: &artifact_store,
            data_envelopes: input.data_envelopes,
        },
        &mut ctx,
    );
    let results = finish_bundle_payload_replay(execution, &artifact_store)?;
    if results
        .iter()
        .any(|result| !result.artifacts.is_empty() || !result.artifact_handles.is_empty())
    {
        return contract_error("attached training replay PREDICT/EXPLAIN cannot emit artifacts");
    }

    let outputs = bind_attached_replay_outputs(input.source, input.request, &results)?;
    let conformal_intervals = input
        .source
        .conformal_calibration
        .as_ref()
        .map(|calibration| apply_replay_conformal_intervals(calibration, &outputs))
        .transpose()?
        .unwrap_or_default();
    if let Some(calibration) = input.source.conformal_calibration.as_ref() {
        validate_replay_interval_closure(calibration, &outputs, &conformal_intervals)?;
    }
    let explanations = bind_attached_replay_explanations(input.request, &results)?;
    let mut lineage = ctx.lineage.records().cloned().collect::<Vec<_>>();
    for record in &mut lineage {
        record.input_lineage.sort();
        record
            .artifact_refs
            .sort_by(|left, right| left.id.cmp(&right.id));
    }
    lineage.sort_by(|left, right| left.record_id.cmp(&right.record_id));

    let outcome = TrainingReplayOutcome {
        schema_version: replay_outcome_schema_version(&input_data_identities),
        outcome_id: input.outcome_id,
        run_id: input.run_id,
        source_training_outcome: input.source.to_reference()?,
        replay_request_id: input.request.request_id.clone(),
        replay_request_fingerprint: input.request.request_fingerprint.clone(),
        input_data_identities,
        bundle_id: input.source.execution_bundle.bundle_id.clone(),
        plan_id: input.source.effective_plan.id.clone(),
        phase: input.request.phase,
        result_count: lineage.len(),
        lineage_record_count: lineage.len(),
        prediction_block_count: outputs.iter().map(|output| output.predictions.len()).sum(),
        observation_prediction_block_count: outputs
            .iter()
            .map(|output| output.observation_predictions.len())
            .sum(),
        aggregated_prediction_block_count: outputs
            .iter()
            .map(|output| output.aggregated_predictions.len())
            .sum(),
        explanation_block_count: explanations.len(),
        controller_count: lineage
            .iter()
            .map(|record| record.controller_id.as_str())
            .collect::<BTreeSet<_>>()
            .len(),
        prediction_cache_store: false,
        outputs,
        conformal_intervals,
        explanations,
        lineage,
        warnings: input.warnings,
        diagnostics: input.diagnostics,
        outcome_fingerprint: zero_fingerprint(),
    };
    let outcome = stabilize_training_replay_outcome_for_tcv1(outcome)?;
    outcome.validate_against(input.source, input.request)?;
    Ok(outcome)
}

pub fn execute_loaded_predictor_replay(
    input: LoadedPredictorReplayInput<'_>,
) -> Result<TrainingReplayOutcome> {
    let package = input.predictor.package();
    package.validate()?;
    input.request.validate()?;
    validate_sorted_unique_text("training replay execution warnings", &input.warnings, false)?;
    validate_diagnostics(&input.diagnostics)?;
    validate_replay_phase(input.request.phase)?;
    if input.request.source_outcome_fingerprint != package.training_outcome.outcome_fingerprint {
        return contract_error("training replay request does not target package source outcome");
    }
    for node_plan in package.effective_plan.node_plans.values() {
        if input.controllers.get(&node_plan.controller_id).is_none() {
            return Err(DagMlError::RuntimeValidation(format!(
                "loaded predictor replay controller `{}` for node `{}` is not registered",
                node_plan.controller_id, node_plan.node_id
            )));
        }
    }

    let input_data_identities = replay_input_data_identities(
        &package.execution_bundle,
        input.request,
        input.data_envelopes,
    )?;
    let (replay_plan, replay_bundle) = replay_plan_and_bundle_for_current_cohort(
        &package.effective_plan,
        &package.execution_bundle,
        input.request,
        input.data_envelopes,
    )?;
    let phase_request = ReplayPhaseRequest {
        bundle_id: replay_bundle.bundle_id.clone(),
        phase: input.request.phase,
        data_envelope_keys: input.request.data_envelope_keys.clone(),
    };
    let loaded_artifact_store = LoadedPredictorArtifactStore::new(input.predictor)?;
    let artifact_store = BundlePayloadArtifactStore {
        bundle: &replay_bundle,
        controllers: input.controllers,
        fallback: &loaded_artifact_store,
        hydrated_handles: Mutex::new(Vec::new()),
    };
    let mut ctx = RunContext::new(input.run_id.clone(), None);
    let execution = SequentialScheduler.execute_bundle_replay(
        BundleReplayExecution {
            plan: &replay_plan,
            bundle: &replay_bundle,
            replay_request: &phase_request,
            prediction_cache_store: None,
            controllers: input.controllers,
            data_provider: input.data_provider,
            artifact_store: &artifact_store,
            data_envelopes: input.data_envelopes,
        },
        &mut ctx,
    );
    let results = finish_bundle_payload_replay(execution, &artifact_store)?;
    if results
        .iter()
        .any(|result| !result.artifacts.is_empty() || !result.artifact_handles.is_empty())
    {
        return contract_error("loaded predictor replay PREDICT/EXPLAIN cannot emit artifacts");
    }

    let outputs = bind_package_replay_outputs(package, input.request, &results)?;
    let conformal_intervals = package
        .conformal_calibration
        .as_ref()
        .map(|calibration| apply_replay_conformal_intervals(calibration, &outputs))
        .transpose()?
        .unwrap_or_default();
    if let Some(calibration) = package.conformal_calibration.as_ref() {
        validate_replay_interval_closure(calibration, &outputs, &conformal_intervals)?;
    }
    let explanations = bind_attached_replay_explanations(input.request, &results)?;
    let mut lineage = ctx.lineage.records().cloned().collect::<Vec<_>>();
    for record in &mut lineage {
        record.input_lineage.sort();
        record
            .artifact_refs
            .sort_by(|left, right| left.id.cmp(&right.id));
    }
    lineage.sort_by(|left, right| left.record_id.cmp(&right.record_id));

    let outcome = TrainingReplayOutcome {
        schema_version: replay_outcome_schema_version(&input_data_identities),
        outcome_id: input.outcome_id,
        run_id: input.run_id,
        source_training_outcome: package.training_outcome.clone(),
        replay_request_id: input.request.request_id.clone(),
        replay_request_fingerprint: input.request.request_fingerprint.clone(),
        input_data_identities,
        bundle_id: package.execution_bundle.bundle_id.clone(),
        plan_id: package.effective_plan.id.clone(),
        phase: input.request.phase,
        result_count: lineage.len(),
        lineage_record_count: lineage.len(),
        prediction_block_count: outputs.iter().map(|output| output.predictions.len()).sum(),
        observation_prediction_block_count: outputs
            .iter()
            .map(|output| output.observation_predictions.len())
            .sum(),
        aggregated_prediction_block_count: outputs
            .iter()
            .map(|output| output.aggregated_predictions.len())
            .sum(),
        explanation_block_count: explanations.len(),
        controller_count: lineage
            .iter()
            .map(|record| record.controller_id.as_str())
            .collect::<BTreeSet<_>>()
            .len(),
        prediction_cache_store: false,
        outputs,
        conformal_intervals,
        explanations,
        lineage,
        warnings: input.warnings,
        diagnostics: input.diagnostics,
        outcome_fingerprint: zero_fingerprint(),
    };
    let outcome = stabilize_training_replay_outcome_for_tcv1(outcome)?;
    outcome.validate_against_package(package, input.request)?;
    Ok(outcome)
}

/// Execute a PREDICT or EXPLAIN replay from a Package V3 full-refit child.
///
/// This is intentionally a separate entry point from V1/V2 package replay:
/// V3 binds a fresh refit outcome rather than a CV/SELECT outcome, and every
/// artifact is rehydrated from the package's detached raw bytes.
pub fn execute_loaded_portable_refit_replay_v3(
    input: LoadedPortableRefitReplayInputV3<'_>,
) -> Result<PortableRefitReplayOutcomeV3> {
    input.package.validate()?;
    input.request.validate()?;
    validate_replay_phase(input.request.phase)?;
    validate_sorted_unique_text("portable refit replay warnings", &input.warnings, false)?;
    validate_diagnostics(&input.diagnostics)?;
    if input.request.source_outcome_fingerprint != input.package.outcome.outcome_fingerprint {
        return contract_error(
            "portable refit replay request does not target the V3 child outcome".to_string(),
        );
    }
    for node_plan in input.package.outcome.effective_plan.node_plans.values() {
        if input.controllers.get(&node_plan.controller_id).is_none() {
            return Err(DagMlError::RuntimeValidation(format!(
                "portable refit replay controller `{}` for node `{}` is not registered",
                node_plan.controller_id, node_plan.node_id
            )));
        }
    }
    let runtime_bundle = input.package.outcome.to_runtime_replay_bundle()?;
    let input_data_identities =
        replay_input_data_identities(&runtime_bundle, input.request, input.data_envelopes)?;
    let (replay_plan, replay_bundle) = replay_plan_and_bundle_for_current_cohort(
        &input.package.outcome.effective_plan,
        &runtime_bundle,
        input.request,
        input.data_envelopes,
    )?;
    let phase_request = ReplayPhaseRequest {
        bundle_id: replay_bundle.bundle_id.clone(),
        phase: input.request.phase,
        data_envelope_keys: input.request.data_envelope_keys.clone(),
    };
    let fallback = RejectRefitSidecarStore;
    let artifact_store = BundlePayloadArtifactStore {
        bundle: &replay_bundle,
        controllers: input.controllers,
        fallback: &fallback,
        hydrated_handles: Mutex::new(Vec::new()),
    };
    let mut ctx = RunContext::new(input.run_id.clone(), None);
    let execution = SequentialScheduler.execute_bundle_replay(
        BundleReplayExecution {
            plan: &replay_plan,
            bundle: &replay_bundle,
            replay_request: &phase_request,
            prediction_cache_store: None,
            controllers: input.controllers,
            data_provider: input.data_provider,
            artifact_store: &artifact_store,
            data_envelopes: input.data_envelopes,
        },
        &mut ctx,
    );
    let results = finish_bundle_payload_replay(execution, &artifact_store)?;
    if results
        .iter()
        .any(|result| !result.artifacts.is_empty() || !result.artifact_handles.is_empty())
    {
        return contract_error(
            "portable refit replay PREDICT/EXPLAIN cannot emit artifacts".to_string(),
        );
    }
    let outputs = bind_refit_package_replay_outputs(input.package, input.request, &results)?;
    let explanations = bind_attached_replay_explanations(input.request, &results)?;
    let mut lineage = ctx.lineage.records().cloned().collect::<Vec<_>>();
    for record in &mut lineage {
        record.input_lineage.sort();
        record
            .artifact_refs
            .sort_by(|left, right| left.id.cmp(&right.id));
    }
    lineage.sort_by(|left, right| left.record_id.cmp(&right.record_id));
    let mut outcome = PortableRefitReplayOutcomeV3 {
        schema_version: 3,
        outcome_id: input.outcome_id,
        run_id: input.run_id,
        source_package_fingerprint: input.package.package_fingerprint.clone(),
        source_refit_outcome_fingerprint: input.package.outcome.outcome_fingerprint.clone(),
        replay_request_id: input.request.request_id.clone(),
        replay_request_fingerprint: input.request.request_fingerprint.clone(),
        input_data_identities,
        bundle_id: input.package.outcome.execution_bundle.bundle_id.clone(),
        plan_id: input.package.outcome.effective_plan.id.clone(),
        phase: input.request.phase,
        outputs,
        explanations,
        lineage,
        warnings: input.warnings,
        diagnostics: input.diagnostics,
        outcome_fingerprint: zero_fingerprint(),
    };
    outcome.outcome_fingerprint = outcome.compute_fingerprint()?;
    outcome.validate_against(input.package, input.request)?;
    Ok(outcome)
}

/// Calibrate a just-replayed output, then persist the signed native state on
/// the owning training outcome and its execution bundle.  The replay must have
/// targeted the pre-calibration outcome; attachment deliberately produces a
/// new outcome fingerprint for the portable predictor state.
#[allow(clippy::too_many_arguments)]
pub fn calibrate_attached_training_replay(
    source: &mut TrainingOutcome,
    replay: &TrainingReplayOutcome,
    binding_id: &str,
    calibration_relations: &SampleRelationSet,
    truth: ConformalCalibrationTruth,
    context: ConformalCalibrationContext,
    coverages: Vec<f64>,
    multi_target_policy: ConformalMultiTargetPolicy,
    small_sample_policy: ConformalSmallSamplePolicy,
) -> Result<ConformalCalibration> {
    if replay.phase != Phase::Predict {
        return Err(DagMlError::RuntimeValidation(
            "conformal calibration requires a PREDICT replay outcome".to_string(),
        ));
    }
    if replay
        .input_data_identities
        .iter()
        .any(|identity| identity.target_content_fingerprint.is_none())
    {
        return Err(DagMlError::RuntimeValidation(
            "conformal calibration requires target-bound replay input identities; run the calibration replay with its authoritative truth cohort"
                .to_string(),
        ));
    }
    replay.validate_against(source, &replay_request_from_outcome(replay))?;
    let output = replay
        .outputs
        .iter()
        .find(|output| output.binding.binding_id == binding_id)
        .ok_or_else(|| {
            DagMlError::RuntimeValidation(
                "calibration replay has no requested output binding".to_string(),
            )
        })?;
    let [point] = output.predictions.as_slice() else {
        return Err(DagMlError::RuntimeValidation(
            "calibration replay requires exactly one sample point-prediction block".to_string(),
        ));
    };
    validate_calibration_context(
        source,
        replay,
        output,
        calibration_relations,
        &truth,
        &context,
    )?;
    let calibration = ConformalCalibration::calibrate_with_truth(
        binding_id,
        output.binding.target_names.clone(),
        point,
        &truth,
        context,
        coverages,
        multi_target_policy,
        small_sample_policy,
    )?;
    source.attach_conformal_calibration(calibration.clone(), replay.clone())?;
    Ok(calibration)
}

/// Derive the complete calibration context from the authenticated source and
/// replay contracts.
///
/// This is the host-safe attachment path: callers contribute only the
/// calibration relation authority and truth.  DAG-ML derives every source,
/// replay, binding, fold, influence, cohort and fingerprint value rather than
/// asking an adapter to reproduce TCV1 provenance calculations.
pub fn derive_attached_conformal_calibration_context(
    source: &TrainingOutcome,
    replay: &TrainingReplayOutcome,
    binding_id: &str,
    calibration_relations: &SampleRelationSet,
) -> Result<ConformalCalibrationContext> {
    if replay.phase != Phase::Predict {
        return Err(DagMlError::RuntimeValidation(
            "conformal calibration requires a PREDICT replay outcome".to_string(),
        ));
    }
    if replay
        .input_data_identities
        .iter()
        .any(|identity| identity.target_content_fingerprint.is_none())
    {
        return Err(DagMlError::RuntimeValidation(
            "conformal calibration requires target-bound replay input identities; run the calibration replay with its authoritative truth cohort"
                .to_string(),
        ));
    }
    replay.validate_against(source, &replay_request_from_outcome(replay))?;
    calibration_relations.validate()?;
    let output = replay
        .outputs
        .iter()
        .find(|output| output.binding.binding_id == binding_id)
        .ok_or_else(|| {
            DagMlError::RuntimeValidation(
                "calibration replay has no requested output binding".to_string(),
            )
        })?;
    let [point] = output.predictions.as_slice() else {
        return Err(DagMlError::RuntimeValidation(
            "calibration replay requires exactly one sample point-prediction block".to_string(),
        ));
    };
    let relation_fingerprint = calibration_relations.fingerprint()?;
    if replay
        .input_data_identities
        .iter()
        .any(|identity| identity.relation_fingerprint != relation_fingerprint)
    {
        return Err(DagMlError::RuntimeValidation(
            "conformal calibration relation authority does not match replay provenance".to_string(),
        ));
    }
    let origin_sample_ids = calibration_origin_closure(&point.sample_ids, calibration_relations)?;
    let mut calibration_cohort = ConformalCalibrationCohort {
        role: "calibration".to_string(),
        physical_sample_ids: point.sample_ids.clone(),
        origin_sample_ids,
        target_names: output.binding.target_names.clone(),
        manifest_fingerprint: String::new(),
    };
    calibration_cohort.manifest_fingerprint = calibration_cohort.compute_fingerprint()?;
    let fold_set = source.effective_plan.fold_set.as_ref().ok_or_else(|| {
        DagMlError::RuntimeValidation("conformal calibration requires a source FoldSet".to_string())
    })?;
    let mut context = ConformalCalibrationContext {
        predictor_binding_fingerprint: output.binding.binding_fingerprint.clone(),
        source_training_outcome_fingerprint: source.outcome_fingerprint.clone(),
        calibration_replay_outcome_fingerprint: replay.outcome_fingerprint.clone(),
        data_identities_fingerprint: source.data_identities_fingerprint()?,
        fold_set_fingerprint: fold_set_fingerprint(fold_set)?,
        training_influence_fingerprint: source.training_influence.manifest_fingerprint.clone(),
        relation_fingerprint,
        calibration_cohort,
        context_fingerprint: String::new(),
    };
    context.context_fingerprint = context.compute_fingerprint()?;
    Ok(context)
}

/// Attach split-conformal calibration without allowing an external adapter to
/// construct provenance fingerprints.
#[allow(clippy::too_many_arguments)]
pub fn calibrate_attached_training_replay_with_derived_context(
    source: &mut TrainingOutcome,
    replay: &TrainingReplayOutcome,
    binding_id: &str,
    calibration_relations: &SampleRelationSet,
    truth: ConformalCalibrationTruth,
    coverages: Vec<f64>,
    multi_target_policy: ConformalMultiTargetPolicy,
    small_sample_policy: ConformalSmallSamplePolicy,
) -> Result<ConformalCalibration> {
    let context = derive_attached_conformal_calibration_context(
        source,
        replay,
        binding_id,
        calibration_relations,
    )?;
    calibrate_attached_training_replay(
        source,
        replay,
        binding_id,
        calibration_relations,
        truth,
        context,
        coverages,
        multi_target_policy,
        small_sample_policy,
    )
}

fn validate_calibration_context(
    source: &TrainingOutcome,
    replay: &TrainingReplayOutcome,
    output: &BoundTrainingOutput,
    calibration_relations: &SampleRelationSet,
    truth: &ConformalCalibrationTruth,
    context: &ConformalCalibrationContext,
) -> Result<()> {
    context.validate_for_truth(truth, &output.binding.target_names)?;
    calibration_relations.validate()?;
    let relation_fingerprint = calibration_relations.fingerprint()?;
    if context.relation_fingerprint != relation_fingerprint
        || replay
            .input_data_identities
            .iter()
            .any(|identity| identity.relation_fingerprint != relation_fingerprint)
    {
        return Err(DagMlError::RuntimeValidation(
            "conformal calibration relation authority does not match context/replay provenance"
                .to_string(),
        ));
    }
    let origin_sample_ids = calibration_origin_closure(
        &context.calibration_cohort.physical_sample_ids,
        calibration_relations,
    )?;
    if context.calibration_cohort.origin_sample_ids != origin_sample_ids {
        return Err(DagMlError::RuntimeValidation(
            "conformal calibration cohort origin closure does not match relation authority"
                .to_string(),
        ));
    }
    let fold_set = source.effective_plan.fold_set.as_ref().ok_or_else(|| {
        DagMlError::RuntimeValidation("conformal calibration requires a source FoldSet".to_string())
    })?;
    let expected_fold = fold_set_fingerprint(fold_set)?;
    if context.predictor_binding_fingerprint != output.binding.binding_fingerprint
        || context.source_training_outcome_fingerprint != source.outcome_fingerprint
        || context.calibration_replay_outcome_fingerprint != replay.outcome_fingerprint
        || context.data_identities_fingerprint != source.data_identities_fingerprint()?
        || context.fold_set_fingerprint != expected_fold
        || context.training_influence_fingerprint != source.training_influence.manifest_fingerprint
    {
        return Err(DagMlError::RuntimeValidation(
            "conformal calibration context does not exactly match source/replay provenance"
                .to_string(),
        ));
    }
    let cohort = &context.calibration_cohort;
    let training: std::collections::BTreeSet<_> = source
        .training_influence
        .entries
        .iter()
        .flat_map(|entry| {
            entry
                .physical_sample_ids
                .iter()
                .chain(entry.origin_sample_ids.iter())
        })
        .collect();
    if cohort
        .physical_sample_ids
        .iter()
        .chain(cohort.origin_sample_ids.iter())
        .any(|id| training.contains(id))
    {
        return Err(DagMlError::RuntimeValidation(
            "conformal calibration cohort overlaps training influence closure".to_string(),
        ));
    }
    if relation_fingerprint == source.training_influence.relation_fingerprint {
        return Err(DagMlError::RuntimeValidation(
            "conformal calibration relation authority must be distinct from development relations"
                .to_string(),
        ));
    }
    Ok(())
}

fn calibration_origin_closure(
    physical_sample_ids: &[crate::ids::SampleId],
    relations: &SampleRelationSet,
) -> Result<Vec<crate::ids::SampleId>> {
    let requested = physical_sample_ids.iter().collect::<BTreeSet<_>>();
    let mut by_sample = BTreeMap::new();
    for relation in &relations.records {
        if !requested.contains(&relation.sample_id) {
            continue;
        }
        match by_sample.get(&relation.sample_id) {
            Some(origin) if origin != &relation.origin_sample_id => {
                return Err(DagMlError::RuntimeValidation(format!(
                    "conformal calibration sample `{}` has ambiguous origin relations",
                    relation.sample_id
                )));
            }
            Some(_) => {}
            None => {
                by_sample.insert(
                    relation.sample_id.clone(),
                    relation.origin_sample_id.clone(),
                );
            }
        }
    }
    if let Some(missing) = physical_sample_ids
        .iter()
        .find(|sample_id| !by_sample.contains_key(*sample_id))
    {
        return Err(DagMlError::RuntimeValidation(format!(
            "conformal calibration sample `{missing}` is absent from relation authority"
        )));
    }
    Ok(by_sample
        .into_values()
        .flatten()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect())
}

fn replay_input_data_identities(
    bundle: &ExecutionBundle,
    request: &TrainingReplayRequest,
    envelopes: &BTreeMap<String, ExternalDataPlanEnvelope>,
) -> Result<Vec<ReplayDataIdentity>> {
    request
        .data_envelope_keys
        .iter()
        .map(|key| {
            let requirement = bundle
                .data_requirements
                .iter()
                .find(|requirement| requirement.key() == *key)
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation(format!(
                        "training replay request references unknown data envelope key `{key}`"
                    ))
                })?;
            let envelope = envelopes.get(key).ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "training replay is missing external data envelope for `{key}`"
                ))
            })?;
            envelope.validate()?;
            if requirement.schema_fingerprint != envelope.schema_fingerprint
                || requirement.plan_fingerprint != envelope.plan_fingerprint
            {
                return Err(DagMlError::RuntimeValidation(format!(
                    "training replay envelope for `{key}` changes schema or representation plan"
                )));
            }
            let relation_fingerprint = envelope.relation_fingerprint.clone().ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "training replay envelope for `{key}` requires a relation fingerprint"
                ))
            })?;
            let data_content_fingerprint =
                envelope.data_content_fingerprint.clone().ok_or_else(|| {
                    DagMlError::RuntimeValidation(format!(
                        "training replay envelope for `{key}` requires a data content fingerprint"
                    ))
                })?;
            let mut identity = ReplayDataIdentity {
                requirement_key: key.clone(),
                schema_fingerprint: envelope.schema_fingerprint.clone(),
                plan_fingerprint: envelope.plan_fingerprint.clone(),
                relation_fingerprint,
                data_content_fingerprint,
                target_content_fingerprint: envelope.target_content_fingerprint.clone(),
                identity_fingerprint: zero_fingerprint(),
            };
            identity.identity_fingerprint = identity.compute_fingerprint()?;
            identity.validate()?;
            Ok(identity)
        })
        .collect()
}

fn replay_outcome_schema_version(_identities: &[ReplayDataIdentity]) -> u32 {
    TRAINING_REPLAY_OUTCOME_SCHEMA_VERSION
}

fn replay_plan_and_bundle_for_current_cohort(
    plan: &ExecutionPlan,
    bundle: &ExecutionBundle,
    request: &TrainingReplayRequest,
    envelopes: &BTreeMap<String, ExternalDataPlanEnvelope>,
) -> Result<(ExecutionPlan, ExecutionBundle)> {
    let mut replay_plan = plan.clone();
    let mut replay_bundle = bundle.clone();
    // A fresh-cohort PREDICT/EXPLAIN replay intentionally changes data
    // relations and therefore the campaign fingerprint below.  Methods HPO
    // state is resume-only and remains valid only in the source package used
    // by the training descriptor; it must never be carried into this derived
    // replay bundle or validated against a different cohort.
    replay_bundle.methods_hpo_resume_state = None;
    for requirement in &mut replay_bundle.data_requirements {
        let key = requirement.key();
        if request.data_envelope_keys.contains(&key) {
            let envelope = envelopes.get(&key).ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "training replay is missing external data envelope for `{key}`"
                ))
            })?;
            requirement.relation_fingerprint = envelope.relation_fingerprint.clone();
            for bindings in replay_plan.campaign.data_bindings.values_mut() {
                for binding in bindings {
                    if crate::data::data_binding_requirement_key(
                        &binding.node_id,
                        &binding.input_name,
                    ) == key
                    {
                        binding.relation_fingerprint = envelope.relation_fingerprint.clone();
                    }
                }
            }
            for node_plan in replay_plan.node_plans.values_mut() {
                for binding in &mut node_plan.data_bindings {
                    if crate::data::data_binding_requirement_key(
                        &binding.node_id,
                        &binding.input_name,
                    ) == key
                    {
                        binding.relation_fingerprint = envelope.relation_fingerprint.clone();
                    }
                }
            }
        }
    }
    replay_plan.graph_fingerprint = stable_json_fingerprint(&replay_plan.graph_plan.graph)?;
    replay_plan.campaign_fingerprint = stable_json_fingerprint(&replay_plan.campaign)?;
    replay_plan.controller_fingerprint =
        stable_json_fingerprint(&replay_plan.controller_manifests)?;
    replay_plan.validate()?;
    replay_bundle.graph_fingerprint = replay_plan.graph_fingerprint.clone();
    replay_bundle.campaign_fingerprint = replay_plan.campaign_fingerprint.clone();
    replay_bundle.controller_fingerprint = replay_plan.controller_fingerprint.clone();
    replay_bundle.validate_against_plan(&replay_plan)?;
    Ok((replay_plan, replay_bundle))
}

fn bind_attached_replay_outputs(
    source: &TrainingOutcome,
    request: &TrainingReplayRequest,
    results: &[crate::runtime::NodeResult],
) -> Result<Vec<BoundTrainingOutput>> {
    let mut outputs = Vec::new();
    for binding_id in &request.output_binding_ids {
        let source_output = source
            .outputs
            .iter()
            .find(|output| output.binding.binding_id == *binding_id)
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "training replay request references absent binding `{binding_id}`"
                ))
            })?;
        let binding = source_output.binding.clone();
        let mut output = BoundTrainingOutput {
            schema_version: Some(BOUND_TRAINING_OUTPUT_SCHEMA_VERSION),
            binding: binding.clone(),
            predictions: Vec::new(),
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
        };
        for result in results {
            output.predictions.extend(
                result
                    .predictions
                    .iter()
                    .filter(|block| {
                        block.producer_node == binding.node_id
                            && block.producer_port.as_deref() == Some(binding.port_name.as_str())
                            && block.partition == crate::oof::PredictionPartition::Final
                            && block.fold_id.is_none()
                    })
                    .cloned(),
            );
            output.observation_predictions.extend(
                result
                    .observation_predictions
                    .iter()
                    .filter(|block| {
                        block.producer_node == binding.node_id
                            && block.producer_port.as_deref() == Some(binding.port_name.as_str())
                            && block.partition == crate::oof::PredictionPartition::Final
                            && block.fold_id.is_none()
                    })
                    .cloned(),
            );
            output.aggregated_predictions.extend(
                result
                    .aggregated_predictions
                    .iter()
                    .filter(|block| {
                        block.producer_node == binding.node_id
                            && block.producer_port.as_deref() == Some(binding.port_name.as_str())
                            && block.partition == crate::oof::PredictionPartition::Final
                            && block.fold_id.is_none()
                    })
                    .cloned(),
            );
        }
        if !output.predictions.is_empty()
            || !output.observation_predictions.is_empty()
            || !output.aggregated_predictions.is_empty()
        {
            output.validate(&source.effective_plan)?;
            outputs.push(output);
        }
    }
    outputs.sort_by(|left, right| left.binding.binding_id.cmp(&right.binding.binding_id));
    Ok(outputs)
}

fn bind_package_replay_outputs(
    package: &PortablePredictorPackage,
    request: &TrainingReplayRequest,
    results: &[crate::runtime::NodeResult],
) -> Result<Vec<BoundTrainingOutput>> {
    bind_replay_outputs(
        &package.effective_plan,
        &package.output_bindings,
        request,
        results,
    )
}

fn bind_refit_package_replay_outputs(
    package: &PortableRefitPackageV3,
    request: &TrainingReplayRequest,
    results: &[crate::runtime::NodeResult],
) -> Result<Vec<BoundTrainingOutput>> {
    bind_replay_outputs(
        &package.outcome.effective_plan,
        &package.outcome.output_bindings,
        request,
        results,
    )
}

fn bind_replay_outputs(
    plan: &ExecutionPlan,
    bindings: &[crate::training::OutputBinding],
    request: &TrainingReplayRequest,
    results: &[crate::runtime::NodeResult],
) -> Result<Vec<BoundTrainingOutput>> {
    let mut outputs = Vec::new();
    for binding_id in &request.output_binding_ids {
        let binding = bindings
            .iter()
            .find(|binding| binding.binding_id == *binding_id)
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "training replay request references absent package binding `{binding_id}`"
                ))
            })?
            .clone();
        let mut output = BoundTrainingOutput {
            schema_version: Some(BOUND_TRAINING_OUTPUT_SCHEMA_VERSION),
            binding: binding.clone(),
            predictions: Vec::new(),
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
        };
        for result in results {
            output.predictions.extend(
                result
                    .predictions
                    .iter()
                    .filter(|block| {
                        block.producer_node == binding.node_id
                            && block.producer_port.as_deref() == Some(binding.port_name.as_str())
                            && block.partition == crate::oof::PredictionPartition::Final
                            && block.fold_id.is_none()
                    })
                    .cloned(),
            );
            output.observation_predictions.extend(
                result
                    .observation_predictions
                    .iter()
                    .filter(|block| {
                        block.producer_node == binding.node_id
                            && block.producer_port.as_deref() == Some(binding.port_name.as_str())
                            && block.partition == crate::oof::PredictionPartition::Final
                            && block.fold_id.is_none()
                    })
                    .cloned(),
            );
            output.aggregated_predictions.extend(
                result
                    .aggregated_predictions
                    .iter()
                    .filter(|block| {
                        block.producer_node == binding.node_id
                            && block.producer_port.as_deref() == Some(binding.port_name.as_str())
                            && block.partition == crate::oof::PredictionPartition::Final
                            && block.fold_id.is_none()
                    })
                    .cloned(),
            );
        }
        if !output.predictions.is_empty()
            || !output.observation_predictions.is_empty()
            || !output.aggregated_predictions.is_empty()
        {
            output.validate(plan)?;
            outputs.push(output);
        }
    }
    outputs.sort_by(|left, right| left.binding.binding_id.cmp(&right.binding.binding_id));
    Ok(outputs)
}

fn apply_replay_conformal_intervals(
    calibration: &ConformalCalibration,
    outputs: &[BoundTrainingOutput],
) -> Result<Vec<ConformalIntervalBlock>> {
    let Some(output) = outputs
        .iter()
        .find(|output| output.binding.binding_id == calibration.binding_id)
    else {
        // A replay may request a different output.  Silence is correct here;
        // an interval must never be copied to an unrelated binding.
        return Ok(Vec::new());
    };
    if output.binding.target_names != calibration.target_names {
        return contract_error("replay conformal binding target order differs from calibration");
    }
    output
        .predictions
        .iter()
        .map(|block| calibration.apply(block))
        .collect()
}

fn validate_replay_interval_closure(
    calibration: &ConformalCalibration,
    outputs: &[BoundTrainingOutput],
    intervals: &[ConformalIntervalBlock],
) -> Result<()> {
    let expected = apply_replay_conformal_intervals(calibration, outputs)?;
    if intervals != expected {
        return Err(DagMlError::RuntimeValidation(
            "conformal intervals do not exactly cover replay point predictions".to_string(),
        ));
    }
    for interval in intervals {
        let output = outputs
            .iter()
            .find(|output| output.binding.binding_id == interval.binding_id)
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(
                    "conformal interval references an absent replay output binding".to_string(),
                )
            })?;
        let point = output
            .predictions
            .iter()
            .find(|point| point.sample_ids == interval.sample_ids)
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(
                    "conformal interval has no matching replay point block".to_string(),
                )
            })?;
        interval.validate_against(calibration, point)?;
    }
    Ok(())
}

fn bind_attached_replay_explanations(
    request: &TrainingReplayRequest,
    results: &[crate::runtime::NodeResult],
) -> Result<Vec<ExplanationBlock>> {
    if request.phase != Phase::Explain {
        return Ok(Vec::new());
    }
    let mut explanations = results
        .iter()
        .flat_map(|result| result.explanations.iter().cloned())
        .filter(|block| block.producer_port.is_some())
        .collect::<Vec<_>>();
    explanations.sort_by(|left, right| {
        (
            left.producer_node.as_str(),
            left.producer_port.as_deref().unwrap_or_default(),
            left.method.as_str(),
            left.target_name.as_deref().unwrap_or_default(),
        )
            .cmp(&(
                right.producer_node.as_str(),
                right.producer_port.as_deref().unwrap_or_default(),
                right.method.as_str(),
                right.target_name.as_deref().unwrap_or_default(),
            ))
    });
    Ok(explanations)
}

fn validate_output_order_and_version(outputs: &[BoundTrainingOutput]) -> Result<()> {
    let mut previous: Option<&str> = None;
    for output in outputs {
        match output.schema_version {
            Some(BOUND_TRAINING_OUTPUT_SCHEMA_VERSION) => {}
            Some(version) => {
                return contract_error(format!(
                    "training replay output schema_version {version} is unsupported; current {BOUND_TRAINING_OUTPUT_SCHEMA_VERSION}"
                ));
            }
            None => {
                return contract_error(
                    "training replay output requires bound_training_output schema_version",
                );
            }
        }
        let binding_id = output.binding.binding_id.as_str();
        if previous.is_some_and(|previous| previous >= binding_id) {
            return contract_error("training replay outputs must be strictly sorted by binding_id");
        }
        previous = Some(binding_id);
    }
    Ok(())
}

fn validate_replay_bound_output_blocks(output: &BoundTrainingOutput) -> Result<()> {
    for block in &output.predictions {
        validate_optional_port(
            "training replay prediction producer_port",
            &block.producer_port,
        )?;
        if block.partition != crate::oof::PredictionPartition::Final || block.fold_id.is_some() {
            return contract_error(
                "training replay prediction blocks must use final partition without fold",
            );
        }
    }
    for block in &output.observation_predictions {
        validate_optional_port(
            "training replay observation prediction producer_port",
            &block.producer_port,
        )?;
        if block.partition != crate::oof::PredictionPartition::Final || block.fold_id.is_some() {
            return contract_error(
                "training replay observation prediction blocks must use final partition without fold",
            );
        }
    }
    for block in &output.aggregated_predictions {
        validate_optional_port(
            "training replay aggregated prediction producer_port",
            &block.producer_port,
        )?;
        if block.partition != crate::oof::PredictionPartition::Final || block.fold_id.is_some() {
            return contract_error(
                "training replay aggregated prediction blocks must use final partition without fold",
            );
        }
    }
    Ok(())
}

fn validate_replay_phase(phase: Phase) -> Result<()> {
    if matches!(phase, Phase::Predict | Phase::Explain) {
        Ok(())
    } else {
        contract_error("training replay supports only PREDICT and EXPLAIN")
    }
}

fn validate_sha256(label: &str, value: &str) -> Result<()> {
    if value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(())
    } else {
        contract_error(format!(
            "{label} fingerprint must be 64 lowercase hexadecimal characters"
        ))
    }
}

fn validate_identifier(label: &str, value: &str) -> Result<()> {
    if !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.' | b':'))
    {
        Ok(())
    } else {
        contract_error(format!("{label} is not a valid DAG-ML identifier"))
    }
}

fn validate_non_empty(label: &str, value: &str) -> Result<()> {
    if value.trim().is_empty() {
        contract_error(format!("{label} must be non-empty"))
    } else {
        Ok(())
    }
}

fn validate_sorted_unique_identifiers(
    label: &str,
    values: &[String],
    require_non_empty: bool,
) -> Result<()> {
    validate_sorted_unique_text(label, values, require_non_empty)?;
    for value in values {
        validate_identifier(label, value)?;
    }
    Ok(())
}

fn validate_sorted_unique_text(
    label: &str,
    values: &[String],
    require_non_empty: bool,
) -> Result<()> {
    if require_non_empty && values.is_empty() {
        return contract_error(format!("{label} must be non-empty"));
    }
    let mut previous: Option<&str> = None;
    for value in values {
        validate_non_empty(label, value)?;
        if previous.is_some_and(|previous| previous >= value.as_str()) {
            return contract_error(format!("{label} must be strictly sorted and unique"));
        }
        previous = Some(value.as_str());
    }
    Ok(())
}

fn validate_sorted_unique_keys<'a>(
    label: &str,
    values: impl Iterator<Item = &'a str>,
    require_non_empty: bool,
) -> Result<()> {
    let values = values.collect::<Vec<_>>();
    if require_non_empty && values.is_empty() {
        return contract_error(format!("{label} must be non-empty"));
    }
    let mut previous: Option<&str> = None;
    for value in values {
        validate_non_empty(label, value)?;
        if previous.is_some_and(|previous| previous >= value) {
            return contract_error(format!("{label} must be strictly sorted and unique"));
        }
        previous = Some(value);
    }
    Ok(())
}

fn validate_optional_port(label: &str, value: &Option<String>) -> Result<()> {
    match value {
        Some(value) if !value.trim().is_empty() => Ok(()),
        _ => contract_error(format!("{label} must be present and non-empty")),
    }
}

fn validate_diagnostics(diagnostics: &BTreeMap<String, serde_json::Value>) -> Result<()> {
    for (key, value) in diagnostics {
        validate_non_empty("training replay diagnostic key", key)?;
        if !matches!(
            value,
            serde_json::Value::Null
                | serde_json::Value::Bool(_)
                | serde_json::Value::Number(_)
                | serde_json::Value::String(_)
        ) {
            return contract_error("training replay diagnostics must be scalar JSON values");
        }
    }
    Ok(())
}

fn require_count(label: &str, actual: usize, expected: usize) -> Result<()> {
    if actual == expected {
        Ok(())
    } else {
        contract_error(format!("{label} does not match replay payload"))
    }
}

fn zero_fingerprint() -> String {
    "0".repeat(64)
}

fn stabilize_training_replay_outcome_for_tcv1(
    mut outcome: TrainingReplayOutcome,
) -> Result<TrainingReplayOutcome> {
    // TCV1 binds the lexical JSON number token. Native replay can carry an
    // f64 through an external runtime before serde writes the outcome, so
    // sign the fixed point a strict JSON reader will itself observe after
    // deserialize/serialize. This mirrors TrainingOutcome stabilization and
    // prevents a replay from being rejected at its own public JSON boundary.
    outcome.outcome_fingerprint = zero_fingerprint();
    for _ in 0..8 {
        let json = serde_json::to_string(&outcome)?;
        let before = parse_typed_json(&json).map_err(|error| {
            DagMlError::RuntimeValidation(format!(
                "training replay outcome is not strict TCV1 JSON while normalizing: {error}"
            ))
        })?;
        let mut normalized = serde_json::from_str::<TrainingReplayOutcome>(&json)?;
        normalized.outcome_fingerprint = zero_fingerprint();
        let normalized_json = serde_json::to_string(&normalized)?;
        let after = parse_typed_json(&normalized_json).map_err(|error| {
            DagMlError::RuntimeValidation(format!(
                "training replay outcome is not strict TCV1 JSON after normalization: {error}"
            ))
        })?;
        if before != after {
            outcome = normalized;
            continue;
        }

        normalized.outcome_fingerprint =
            after
                .fingerprint_without("outcome_fingerprint")
                .map_err(|error| {
                    DagMlError::RuntimeValidation(format!(
                    "training replay outcome TCV1 fingerprint failed after normalization: {error}"
                ))
                })?;
        let signed_json = serde_json::to_string(&normalized)?;
        return TrainingReplayOutcome::from_json(&signed_json);
    }
    Err(DagMlError::RuntimeValidation(
        "training replay outcome TCV1 JSON did not reach a serde canonical fixed point".to_string(),
    ))
}

fn tcv1_fingerprint_without<T: Serialize>(value: &T, field: &str, label: &str) -> Result<String> {
    let json = serde_json::to_string(value)?;
    strict_tcv1_fingerprint_without(&json, field, label)
}

fn strict_tcv1_fingerprint_without(json: &str, field: &str, label: &str) -> Result<String> {
    parse_typed_json(json)
        .and_then(|value| value.fingerprint_without(field))
        .map_err(|error| {
            DagMlError::RuntimeValidation(format!("{label} is outside strict TCV1: {error}"))
        })
}

fn unsupported_version<T>(label: &str, actual: u32, expected: u32) -> Result<T> {
    contract_error(format!(
        "{label} uses unsupported schema_version {actual}, expected {expected}"
    ))
}

fn contract_error<T>(message: impl Into<String>) -> Result<T> {
    Err(DagMlError::CampaignValidation(message.into()))
}

#[cfg(test)]
mod methods_hpo_resume_state_tests {
    use super::*;

    #[test]
    fn methods_hpo_resume_state_reader_refuses_unknown_legacy_and_noncanonical_json() {
        let unknown = r#"{"schema_version":1,"unknown_resume_side_channel":true}"#;
        assert!(methods_hpo_resume_state_from_json(unknown).is_err());

        // Duplicate members are non-canonical TCV1 JSON and must fail before
        // serde could choose one duplicate value.
        let duplicate = r#"{"schema_version":1,"schema_version":1}"#;
        let error = methods_hpo_resume_state_from_json(duplicate)
            .unwrap_err()
            .to_string();
        assert!(error.contains("duplicate JSON object key"), "{error}");

        // No fallback maps the retired node sentinel to the campaign
        // operation identity. Even before full state validation, strict serde
        // refuses the free legacy field.
        let legacy = r#"{"schema_version":1,"tuner_node_id":"tuner:legacy"}"#;
        assert!(methods_hpo_resume_state_from_json(legacy).is_err());
    }

    #[test]
    fn methods_hpo_resume_state_reader_refuses_tampered_schema_version() {
        let tampered = r#"{"schema_version":2,"operation_id":"campaign:hpo"}"#;
        assert!(methods_hpo_resume_state_from_json(tampered).is_err());
    }
}

#[cfg(test)]
mod replay_identity_tests {
    use super::*;

    fn replay_identity(target_content_fingerprint: Option<&str>) -> ReplayDataIdentity {
        let mut identity = ReplayDataIdentity {
            requirement_key: "model:base.X".to_string(),
            schema_fingerprint: "1".repeat(64),
            plan_fingerprint: "2".repeat(64),
            relation_fingerprint: "3".repeat(64),
            data_content_fingerprint: "4".repeat(64),
            target_content_fingerprint: target_content_fingerprint.map(str::to_string),
            identity_fingerprint: zero_fingerprint(),
        };
        identity.identity_fingerprint = identity.compute_fingerprint().unwrap();
        identity
    }

    #[test]
    fn replay_identity_permits_an_unlabeled_predict_cohort_without_a_sentinel() {
        let identity = replay_identity(None);
        identity.validate().unwrap();
        assert!(identity.target_content_fingerprint.is_none());
        assert!(serde_json::to_value(&identity)
            .unwrap()
            .get("target_content_fingerprint")
            .unwrap()
            .is_null());
    }

    #[test]
    fn replay_identity_rejects_a_resigned_target_fingerprint_tamper() {
        let mut identity = replay_identity(None);
        identity.target_content_fingerprint = Some("not-a-fingerprint".to_string());
        identity.identity_fingerprint = identity.compute_fingerprint().unwrap();
        let error = identity.validate().unwrap_err().to_string();
        assert!(error.contains("target content"), "{error}");
    }

    #[test]
    fn replay_schema_version_is_v3_for_target_bound_and_target_free_cohorts() {
        assert_eq!(
            replay_outcome_schema_version(&[replay_identity(None)]),
            TRAINING_REPLAY_OUTCOME_SCHEMA_VERSION
        );
        assert_eq!(
            replay_outcome_schema_version(&[replay_identity(Some(&"5".repeat(64)))]),
            TRAINING_REPLAY_OUTCOME_SCHEMA_VERSION
        );
    }
}

#[cfg(test)]
mod tests {
    #[cfg(dag_ml_workspace_contract_fixtures)]
    use std::fs;
    #[cfg(dag_ml_workspace_contract_fixtures)]
    use std::path::PathBuf;

    #[cfg(dag_ml_workspace_contract_fixtures)]
    use super::*;

    #[cfg(dag_ml_workspace_contract_fixtures)]
    fn root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(|path| path.parent())
            .expect("core crate is under crates/dag-ml-core")
            .to_path_buf()
    }

    #[cfg(dag_ml_workspace_contract_fixtures)]
    fn fixture(name: &str) -> String {
        fs::read_to_string(
            root()
                .join("examples")
                .join("fixtures")
                .join("training")
                .join("replay")
                .join(name),
        )
        .expect(name)
    }

    #[cfg(dag_ml_workspace_contract_fixtures)]
    fn training_fixture(name: &str) -> String {
        fs::read_to_string(
            root()
                .join("examples")
                .join("fixtures")
                .join("training")
                .join(name),
        )
        .expect(name)
    }

    #[cfg(dag_ml_workspace_contract_fixtures)]
    #[test]
    fn training_replay_contract_fixtures_parse_and_cross_validate() {
        let predict_source =
            TrainingOutcome::from_json(&training_fixture("training_outcome_refit.v1.json"))
                .expect("predict source training outcome");
        let explain_source =
            TrainingOutcome::from_json(&fixture("training_replay_source_outcome_explain.v1.json"))
                .expect("explain source training outcome");
        let predict_request =
            TrainingReplayRequest::from_json(&fixture("training_replay_request_predict.v1.json"))
                .expect("predict request");
        let predict_outcome =
            TrainingReplayOutcome::from_json(&fixture("training_replay_outcome_predict.v1.json"))
                .expect("predict outcome");
        predict_outcome
            .validate_against(&predict_source, &predict_request)
            .expect("predict cross-links");

        let explain_request =
            TrainingReplayRequest::from_json(&fixture("training_replay_request_explain.v1.json"))
                .expect("explain request");
        let explain_outcome =
            TrainingReplayOutcome::from_json(&fixture("training_replay_outcome_explain.v1.json"))
                .expect("explain outcome");
        explain_outcome
            .validate_against(&explain_source, &explain_request)
            .expect("explain cross-links");

        let explain_only = TrainingReplayOutcome::from_json(&fixture(
            "training_replay_outcome_explain_only.v1.json",
        ))
        .expect("explain-only outcome");
        explain_only
            .validate_against(&explain_source, &explain_request)
            .expect("explain-only cross-links");
    }

    #[cfg(dag_ml_workspace_contract_fixtures)]
    #[test]
    fn training_replay_request_rejects_refit_and_unsorted_bindings() {
        let mut request: serde_json::Value =
            serde_json::from_str(&fixture("training_replay_request_predict.v1.json")).unwrap();
        request["phase"] = serde_json::Value::String("REFIT".to_string());
        let err = serde_json::from_value::<TrainingReplayRequest>(request)
            .unwrap()
            .validate()
            .unwrap_err()
            .to_string();
        assert!(err.contains("PREDICT and EXPLAIN"));

        let mut request: TrainingReplayRequest =
            TrainingReplayRequest::from_json(&fixture("training_replay_request_predict.v1.json"))
                .unwrap();
        request.output_binding_ids = vec!["z".to_string(), "a".to_string()];
        request.request_fingerprint = request.compute_fingerprint().unwrap();
        let err = request.validate().unwrap_err().to_string();
        assert!(err.contains("strictly sorted"));
    }

    #[cfg(dag_ml_workspace_contract_fixtures)]
    #[test]
    fn training_replay_outcome_rejects_counter_and_source_transplants() {
        let source =
            TrainingOutcome::from_json(&training_fixture("training_outcome_refit.v1.json"))
                .unwrap();
        let request =
            TrainingReplayRequest::from_json(&fixture("training_replay_request_predict.v1.json"))
                .unwrap();
        let mut outcome =
            TrainingReplayOutcome::from_json(&fixture("training_replay_outcome_predict.v1.json"))
                .unwrap();
        outcome.prediction_block_count += 1;
        outcome.outcome_fingerprint = outcome.compute_fingerprint().unwrap();
        let err = outcome.validate().unwrap_err().to_string();
        assert!(err.contains("prediction_block_count"));

        let mut outcome =
            TrainingReplayOutcome::from_json(&fixture("training_replay_outcome_predict.v1.json"))
                .unwrap();
        outcome.source_training_outcome.outcome_fingerprint = "f".repeat(64);
        outcome.outcome_fingerprint = outcome.compute_fingerprint().unwrap();
        let err = outcome
            .validate_against(&source, &request)
            .unwrap_err()
            .to_string();
        assert!(err.contains("source reference"));
    }

    #[cfg(dag_ml_workspace_contract_fixtures)]
    #[test]
    fn target_free_predict_evidence_is_v3_only() {
        let mut outcome =
            TrainingReplayOutcome::from_json(&fixture("training_replay_outcome_predict.v1.json"))
                .unwrap();
        outcome.schema_version = TRAINING_REPLAY_OUTCOME_SCHEMA_VERSION;
        for identity in &mut outcome.input_data_identities {
            identity.target_content_fingerprint = None;
            identity.identity_fingerprint = identity.compute_fingerprint().unwrap();
        }
        outcome.outcome_fingerprint = outcome.compute_fingerprint().unwrap();
        outcome.validate().unwrap();

        outcome.schema_version = CONFORMAL_TRAINING_REPLAY_OUTCOME_SCHEMA_VERSION;
        outcome.outcome_fingerprint = outcome.compute_fingerprint().unwrap();
        let error = outcome.validate().unwrap_err().to_string();
        assert!(error.contains("V1/V2 requires target-bound"), "{error}");
    }
}
