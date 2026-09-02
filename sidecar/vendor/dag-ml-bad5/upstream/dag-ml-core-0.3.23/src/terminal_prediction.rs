//! Closed, bundle-backed terminal PREDICT execution.
//!
//! This module is intentionally narrow.  It consumes the selected variant and
//! REFIT artifacts already captured in an [`ExecutionBundle`], runs exactly one
//! scheduler-owned PREDICT replay, and attests one explicitly selected terminal
//! prediction port against a V2 [`PredictCohort`].  It never asks a host binding
//! to recover a model by key, replay a Python-side model store, or substitute a
//! cohort after REFIT.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::aggregation::{AggregatedPredictionBlock, ObservationPredictionBlock};
use crate::bundle::{ExecutionBundle, RefitArtifactRecord, ReplayPhaseRequest};
use crate::campaign::stable_json_fingerprint;
use crate::controller::ControllerCapability;
use crate::data::{
    ExternalDataPlanEnvelope, PredictCohort, EXTERNAL_DATA_PLAN_ENVELOPE_SCHEMA_VERSION_V2,
};
use crate::error::{DagMlError, Result};
use crate::graph::PortKind;
use crate::ids::{BundleId, NodeId, VariantId};
use crate::oof::{PredictionBlock, PredictionPartition};
use crate::phase::Phase;
use crate::plan::ExecutionPlan;
use crate::policy::PredictionLevel;
use crate::runtime::{
    BundleReplayExecution, EnvelopeAttestedRuntimeDataProvider, RunContext, RuntimeArtifactStore,
    RuntimeControllerRegistry, RuntimeDataProvider, SequentialScheduler,
};

/// First public receipt shape for the V2 terminal-prediction boundary.
pub const TERMINAL_PREDICTION_RECEIPT_SCHEMA_VERSION: u32 = 1;

/// Explicit terminal output selected by the caller.
///
/// A node alone is not enough: graphs may expose more than one prediction
/// output, so the selected producer port is an integrity boundary as well.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TerminalPredictionSelector {
    pub node_id: NodeId,
    pub port: String,
}

impl TerminalPredictionSelector {
    pub fn new(node_id: NodeId, port: impl Into<String>) -> Result<Self> {
        let selector = Self {
            node_id,
            port: port.into(),
        };
        selector.validate()?;
        Ok(selector)
    }

    pub fn validate(&self) -> Result<()> {
        if self.port.trim().is_empty() {
            return Err(DagMlError::RuntimeValidation(
                "terminal prediction selector has an empty port".to_string(),
            ));
        }
        Ok(())
    }
}

/// Durable attestation for one terminal PREDICT result.
///
/// The receipt contains only logical artifact references from the bundle; it
/// deliberately never serializes invocation-local `HandleRef` values.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct TerminalPredictionReceipt {
    schema_version: u32,
    bundle_id: BundleId,
    plan_id: String,
    graph_fingerprint: String,
    campaign_fingerprint: String,
    controller_fingerprint: String,
    selected_variant_id: VariantId,
    terminal_node_id: NodeId,
    terminal_port: String,
    cohort_fingerprint: String,
    refit_artifacts: Vec<RefitArtifactRecord>,
    output_fingerprint: String,
}

impl TerminalPredictionReceipt {
    pub fn schema_version(&self) -> u32 {
        self.schema_version
    }

    pub fn bundle_id(&self) -> &BundleId {
        &self.bundle_id
    }

    pub fn plan_id(&self) -> &str {
        &self.plan_id
    }

    pub fn graph_fingerprint(&self) -> &str {
        &self.graph_fingerprint
    }

    pub fn campaign_fingerprint(&self) -> &str {
        &self.campaign_fingerprint
    }

    pub fn controller_fingerprint(&self) -> &str {
        &self.controller_fingerprint
    }

    pub fn selected_variant_id(&self) -> &VariantId {
        &self.selected_variant_id
    }

    pub fn terminal_node_id(&self) -> &NodeId {
        &self.terminal_node_id
    }

    pub fn terminal_port(&self) -> &str {
        &self.terminal_port
    }

    pub fn cohort_fingerprint(&self) -> &str {
        &self.cohort_fingerprint
    }

    pub fn refit_artifacts(&self) -> &[RefitArtifactRecord] {
        &self.refit_artifacts
    }

    pub fn output_fingerprint(&self) -> &str {
        &self.output_fingerprint
    }
}

/// One fully attested terminal PREDICT outcome.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct TerminalPredictionExecution {
    prediction: PredictionBlock,
    receipt: TerminalPredictionReceipt,
}

impl TerminalPredictionExecution {
    pub fn prediction(&self) -> &PredictionBlock {
        &self.prediction
    }

    pub fn receipt(&self) -> &TerminalPredictionReceipt {
        &self.receipt
    }
}

/// Runtime resources for one closed terminal PREDICT replay.
///
/// This groups the borrowed execution boundary so the public API remains
/// explicit without leaking a positional list of host/runtime dependencies.
pub struct TerminalPredictionReplay<'a> {
    pub plan: &'a ExecutionPlan,
    pub bundle: &'a ExecutionBundle,
    pub envelope: &'a ExternalDataPlanEnvelope,
    pub selector: &'a TerminalPredictionSelector,
    pub controllers: &'a RuntimeControllerRegistry,
    pub data_provider: &'a dyn RuntimeDataProvider,
    pub artifact_store: &'a dyn RuntimeArtifactStore,
}

/// Require the V2, separately attested PREDICT cohort used by this API.
///
/// This is intentionally stricter than generic envelope validation: valid V1
/// envelopes remain supported by frozen CV/REFIT interfaces, but cannot enter
/// this terminal PREDICT route.
pub fn require_terminal_predict_cohort(
    envelope: &ExternalDataPlanEnvelope,
) -> Result<&PredictCohort> {
    if envelope.schema_version != EXTERNAL_DATA_PLAN_ENVELOPE_SCHEMA_VERSION_V2 {
        return Err(DagMlError::RuntimeValidation(format!(
            "terminal PREDICT requires external data-plan envelope V2, got V{}",
            envelope.schema_version
        )));
    }
    envelope.validate()?;
    let cohort = envelope.predict_cohort.as_ref().ok_or_else(|| {
        DagMlError::RuntimeValidation(
            "terminal PREDICT requires a V2 envelope with predict_cohort".to_string(),
        )
    })?;
    if cohort.target_names.is_empty() {
        return Err(DagMlError::RuntimeValidation(
            "terminal PREDICT requires V2 predict_cohort target_names to be non-empty".to_string(),
        ));
    }
    Ok(cohort)
}

/// Validate the V2 terminal route before any training-phase controller is invoked.
///
/// This is deliberately separate from bundle validation: Python and other
/// bindings must reject an invalid terminal selector or unsupported aggregation
/// before they enter CV/REFIT to construct that bundle.  The bundle-backed
/// checks remain in [`validate_terminal_prediction_request`].
pub fn validate_terminal_prediction_preflight(
    plan: &ExecutionPlan,
    envelope: &ExternalDataPlanEnvelope,
    selector: &TerminalPredictionSelector,
) -> Result<()> {
    let _cohort = require_terminal_predict_cohort(envelope)?;
    selector.validate()?;
    plan.validate()?;

    let node_plan = plan.node_plans.get(&selector.node_id).ok_or_else(|| {
        DagMlError::RuntimeValidation(format!(
            "terminal PREDICT selector references unknown node `{}`",
            selector.node_id
        ))
    })?;
    if !node_plan.supported_phases.contains(&Phase::Predict) {
        return Err(DagMlError::RuntimeValidation(format!(
            "terminal PREDICT node `{}` does not support PREDICT",
            selector.node_id
        )));
    }
    if !node_plan
        .controller_capabilities
        .contains(&ControllerCapability::EmitsPredictions)
    {
        return Err(DagMlError::RuntimeValidation(format!(
            "terminal PREDICT node `{}` lacks the emits_predictions capability",
            selector.node_id
        )));
    }

    let graph_node = plan
        .graph_plan
        .graph
        .nodes
        .iter()
        .find(|node| node.id == selector.node_id)
        .ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "terminal PREDICT selector node `{}` is absent from the graph",
                selector.node_id
            ))
        })?;
    let output = graph_node
        .ports
        .outputs
        .iter()
        .find(|port| port.name == selector.port)
        .ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "terminal PREDICT selector `{}` has no output port `{}`",
                selector.node_id, selector.port
            ))
        })?;
    if output.kind != PortKind::Prediction {
        return Err(DagMlError::RuntimeValidation(format!(
            "terminal PREDICT selector `{}.{}` is not a prediction port",
            selector.node_id, selector.port
        )));
    }
    if plan.graph_plan.graph.edges.iter().any(|edge| {
        edge.source.node_id == selector.node_id && edge.source.port_name == selector.port
    }) {
        return Err(DagMlError::RuntimeValidation(format!(
            "terminal PREDICT selector `{}.{}` is consumed by another graph node",
            selector.node_id, selector.port
        )));
    }

    if plan
        .graph_plan
        .graph
        .edges
        .iter()
        .any(|edge| edge.contract.requires_oof)
    {
        return Err(DagMlError::RuntimeValidation(
            "terminal PREDICT first slice does not replay requires_oof edges; use the ordinary replay contract until prediction-cache closure is captured"
                .to_string(),
        ));
    }

    if plan.campaign.aggregation_policy.aggregation_level != PredictionLevel::Sample
        || plan.node_plans.values().any(|node| {
            node.supported_phases.contains(&Phase::Predict)
                && node.shape_plan.as_ref().is_some_and(|shape_plan| {
                    shape_plan.aggregation_policy.aggregation_level != PredictionLevel::Sample
                })
        })
    {
        return Err(DagMlError::RuntimeValidation(format!(
            "terminal PREDICT selector `{}.{}` uses unsupported non-sample aggregation",
            selector.node_id, selector.port
        )));
    }
    Ok(())
}

/// Validate the closed V2 request before any PREDICT controller is invoked.
///
/// The selected output must be a graph-terminal prediction port.  This first
/// slice intentionally supports direct sample-level predictions only; relation
/// aggregation is refused rather than accidentally using the CV coordinator
/// relation universe for an external cohort.
pub fn validate_terminal_prediction_request(
    plan: &ExecutionPlan,
    bundle: &ExecutionBundle,
    envelope: &ExternalDataPlanEnvelope,
    selector: &TerminalPredictionSelector,
) -> Result<()> {
    validate_terminal_prediction_preflight(plan, envelope, selector)?;
    bundle.validate_against_plan(plan)?;

    let _selected_variant = bundle.selected_variant_id.as_ref().ok_or_else(|| {
        DagMlError::RuntimeValidation(format!(
            "terminal PREDICT requires bundle `{}` to select one variant",
            bundle.bundle_id
        ))
    })?;

    if bundle.data_requirements.is_empty() {
        return Err(DagMlError::RuntimeValidation(format!(
            "terminal PREDICT bundle `{}` has no relation-attested data requirement",
            bundle.bundle_id
        )));
    }
    let envelopes = terminal_prediction_envelopes(bundle, envelope);
    bundle.validate_replay_envelopes(&envelopes)?;

    for stateful_node in plan.node_plans.values().filter(|node| {
        node.supported_phases.contains(&Phase::Predict)
            && node
                .controller_capabilities
                .contains(&ControllerCapability::Stateful)
    }) {
        if !bundle
            .refit_artifacts
            .iter()
            .any(|artifact| artifact.node_id == stateful_node.node_id)
        {
            return Err(DagMlError::RuntimeValidation(format!(
                "terminal PREDICT stateful node `{}` has no REFIT artifact in bundle `{}`",
                stateful_node.node_id, bundle.bundle_id
            )));
        }
    }
    Ok(())
}

/// Ask the provider to attest every PREDICT-visible binding before replay
/// materializes an artifact, data handle, or controller task.  The scheduler
/// repeats this comparison at each request through the envelope wrapper below
/// so a mutable host provider cannot change cohorts between preflight and
/// materialization.
fn validate_terminal_provider_cohorts(
    plan: &ExecutionPlan,
    envelope: &ExternalDataPlanEnvelope,
    data_provider: &dyn RuntimeDataProvider,
) -> Result<()> {
    let expected = require_terminal_predict_cohort(envelope)?;
    for node in plan
        .node_plans
        .values()
        .filter(|node| node.supported_phases.contains(&Phase::Predict))
    {
        for binding in &node.data_bindings {
            binding.validate_envelope(envelope)?;
            let supplied = data_provider.predict_cohort(binding, Phase::Predict)?;
            if supplied.as_ref() != Some(expected) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "PREDICT cohort supplied by runtime provider for binding `{}` does not exactly match its terminal V2 envelope",
                    crate::data::data_binding_requirement_key(&binding.node_id, &binding.input_name)
                )));
            }
        }
    }
    Ok(())
}

/// Execute one scheduler-owned PREDICT replay from a captured bundle.
///
/// `artifact_store` is the runtime's REFIT artifact store.  It is the only
/// model source used here: no Python model registry, model refetch, or host
/// replay fallback is consulted by this API.
pub fn execute_terminal_prediction(
    replay: TerminalPredictionReplay<'_>,
    ctx: &mut RunContext,
) -> Result<TerminalPredictionExecution> {
    let TerminalPredictionReplay {
        plan,
        bundle,
        envelope,
        selector,
        controllers,
        data_provider,
        artifact_store,
    } = replay;
    validate_terminal_prediction_request(plan, bundle, envelope, selector)?;
    validate_terminal_provider_cohorts(plan, envelope, data_provider)?;

    let data_envelopes = terminal_prediction_envelopes(bundle, envelope);
    // Ask the host provider to attest the same V2 cohort before it can
    // materialize or view any data.  The wrapper returns the envelope-bound
    // cohort to the scheduler only after that exact comparison succeeds.
    let borrowed_data_provider = BorrowedRuntimeDataProvider(data_provider);
    let envelope_attested_data_provider = EnvelopeAttestedRuntimeDataProvider::new(
        borrowed_data_provider,
        terminal_prediction_bindings(plan),
        data_envelopes.clone(),
    )?;
    let attested_data_provider = TerminalCohortAttestedRuntimeDataProvider {
        inner: envelope_attested_data_provider,
        source: data_provider,
        expected_cohort: require_terminal_predict_cohort(envelope)?.clone(),
    };
    let replay_request = ReplayPhaseRequest {
        bundle_id: bundle.bundle_id.clone(),
        phase: Phase::Predict,
        data_envelope_keys: data_envelopes.keys().cloned().collect(),
    };
    let results = SequentialScheduler.execute_direct_sample_bundle_replay(
        BundleReplayExecution {
            plan,
            bundle,
            replay_request: &replay_request,
            prediction_cache_store: None,
            controllers,
            data_provider: &attested_data_provider,
            artifact_store,
            data_envelopes: &data_envelopes,
        },
        ctx,
    )?;

    let predictions = results
        .iter()
        .flat_map(|result| result.predictions.iter().cloned())
        .collect::<Vec<_>>();
    let observation_predictions = results
        .iter()
        .flat_map(|result| result.observation_predictions.iter().cloned())
        .collect::<Vec<_>>();
    let aggregated_predictions = results
        .iter()
        .flat_map(|result| result.aggregated_predictions.iter().cloned())
        .collect::<Vec<_>>();
    attest_terminal_prediction_output(
        plan,
        bundle,
        envelope,
        selector,
        &predictions,
        &observation_predictions,
        &aggregated_predictions,
    )
}

/// Attest scheduler-produced blocks as one exact, sample-level terminal result.
///
/// This is intentionally private to the scheduler-owned replay route.  Public
/// callers receive its receipt only through [`execute_terminal_prediction`],
/// so they cannot turn host-supplied prediction blocks into a bundle-backed
/// terminal claim.
fn attest_terminal_prediction_output(
    plan: &ExecutionPlan,
    bundle: &ExecutionBundle,
    envelope: &ExternalDataPlanEnvelope,
    selector: &TerminalPredictionSelector,
    predictions: &[PredictionBlock],
    observation_predictions: &[ObservationPredictionBlock],
    aggregated_predictions: &[AggregatedPredictionBlock],
) -> Result<TerminalPredictionExecution> {
    validate_terminal_prediction_request(plan, bundle, envelope, selector)?;
    let cohort = require_terminal_predict_cohort(envelope)?;

    if observation_predictions.iter().any(|block| {
        block.producer_node == selector.node_id
            && block.producer_port.as_deref() == Some(selector.port.as_str())
    }) || aggregated_predictions.iter().any(|block| {
        block.producer_node == selector.node_id
            && block.producer_port.as_deref() == Some(selector.port.as_str())
    }) {
        return Err(DagMlError::RuntimeValidation(format!(
            "terminal PREDICT selector `{}.{}` emitted unsupported aggregated predictions",
            selector.node_id, selector.port
        )));
    }

    let matching = predictions
        .iter()
        .filter(|block| {
            block.producer_node == selector.node_id
                && block.producer_port.as_deref() == Some(selector.port.as_str())
        })
        .collect::<Vec<_>>();
    let [prediction] = matching.as_slice() else {
        return Err(DagMlError::RuntimeValidation(format!(
            "terminal PREDICT selector `{}.{}` must emit exactly one prediction block, got {}",
            selector.node_id,
            selector.port,
            matching.len()
        )));
    };
    prediction.validate_content()?;
    if prediction.partition != PredictionPartition::Final || prediction.fold_id.is_some() {
        return Err(DagMlError::RuntimeValidation(format!(
            "terminal PREDICT selector `{}.{}` must emit a top-level Final prediction block",
            selector.node_id, selector.port
        )));
    }
    if prediction.sample_ids != cohort.physical_sample_ids {
        return Err(DagMlError::RuntimeValidation(format!(
            "terminal PREDICT selector `{}.{}` sample identities do not exactly match the V2 predict cohort",
            selector.node_id, selector.port
        )));
    }
    if prediction.target_names != cohort.target_names {
        return Err(DagMlError::RuntimeValidation(format!(
            "terminal PREDICT selector `{}.{}` target names do not exactly match the V2 predict cohort",
            selector.node_id, selector.port
        )));
    }

    let selected_variant_id = bundle.selected_variant_id.clone().ok_or_else(|| {
        DagMlError::RuntimeValidation(format!(
            "terminal PREDICT bundle `{}` lost its selected variant during attestation",
            bundle.bundle_id
        ))
    })?;
    Ok(TerminalPredictionExecution {
        prediction: (*prediction).clone(),
        receipt: TerminalPredictionReceipt {
            schema_version: TERMINAL_PREDICTION_RECEIPT_SCHEMA_VERSION,
            bundle_id: bundle.bundle_id.clone(),
            plan_id: bundle.plan_id.clone(),
            graph_fingerprint: bundle.graph_fingerprint.clone(),
            campaign_fingerprint: bundle.campaign_fingerprint.clone(),
            controller_fingerprint: bundle.controller_fingerprint.clone(),
            selected_variant_id,
            terminal_node_id: selector.node_id.clone(),
            terminal_port: selector.port.clone(),
            cohort_fingerprint: cohort.cohort_fingerprint.clone(),
            refit_artifacts: bundle.refit_artifacts.clone(),
            output_fingerprint: stable_json_fingerprint(prediction)?,
        },
    })
}

fn terminal_prediction_envelopes(
    bundle: &ExecutionBundle,
    envelope: &ExternalDataPlanEnvelope,
) -> BTreeMap<String, ExternalDataPlanEnvelope> {
    bundle
        .data_requirements
        .iter()
        .map(|requirement| (requirement.key(), envelope.clone()))
        .collect()
}

fn terminal_prediction_bindings(plan: &ExecutionPlan) -> Vec<crate::data::DataBinding> {
    plan.node_plans
        .values()
        .flat_map(|node| node.data_bindings.iter().cloned())
        .collect()
}

/// Private borrowing adapter used only to compose the public provider trait
/// with the existing envelope-attestation wrapper.  Keeping this newtype
/// local avoids adding a blanket trait implementation that downstream crates
/// could conflict with.
struct BorrowedRuntimeDataProvider<'a>(&'a dyn RuntimeDataProvider);

impl RuntimeDataProvider for BorrowedRuntimeDataProvider<'_> {
    fn materialize(
        &self,
        request: &crate::runtime::DataMaterializationRequest,
    ) -> Result<crate::runtime::HandleRef> {
        self.0.materialize(request)
    }

    fn make_view(
        &self,
        request: &crate::runtime::DataViewRequest,
    ) -> Result<crate::runtime::HandleRef> {
        self.0.make_view(request)
    }

    fn training_data_identity(
        &self,
        binding: &crate::data::DataBinding,
    ) -> Result<Option<crate::training::TrainingDataIdentity>> {
        self.0.training_data_identity(binding)
    }

    fn coordinator_relations(
        &self,
        binding: &crate::data::DataBinding,
    ) -> Result<Option<crate::relation::SampleRelationSet>> {
        self.0.coordinator_relations(binding)
    }

    fn predict_cohort(
        &self,
        binding: &crate::data::DataBinding,
        phase: Phase,
    ) -> Result<Option<PredictCohort>> {
        self.0.predict_cohort(binding, phase)
    }

    fn methods_pls_capability(&self) -> Result<()> {
        self.0.methods_pls_capability()
    }

    fn preflight_methods_pls(&self, request: &crate::runtime::MethodsPlsDataRequest) -> Result<()> {
        self.0.preflight_methods_pls(request)
    }

    fn methods_pls_data(
        &self,
        request: &crate::runtime::MethodsPlsDataRequest,
    ) -> Result<crate::runtime::MethodsPlsData> {
        self.0.methods_pls_data(request)
    }
}

/// Terminal-only cohort guard layered outside the generic envelope wrapper.
///
/// Generic V2 replay may obtain its cohort solely from an attested envelope:
/// older C-ABI providers intentionally do not expose the optional
/// `predict_cohort` callback.  This narrow route has a stronger contract: the
/// host must independently attest the exact V2 terminal cohort before every
/// PREDICT materialization.  Keeping that comparison here preserves the
/// generic C-ABI surface while preventing a mutable terminal provider from
/// substituting a cohort after the all-binding preflight.
struct TerminalCohortAttestedRuntimeDataProvider<'a, P> {
    inner: P,
    source: &'a dyn RuntimeDataProvider,
    expected_cohort: PredictCohort,
}

impl<P: RuntimeDataProvider> RuntimeDataProvider
    for TerminalCohortAttestedRuntimeDataProvider<'_, P>
{
    fn materialize(
        &self,
        request: &crate::runtime::DataMaterializationRequest,
    ) -> Result<crate::runtime::HandleRef> {
        self.inner.materialize(request)
    }

    fn make_view(
        &self,
        request: &crate::runtime::DataViewRequest,
    ) -> Result<crate::runtime::HandleRef> {
        self.inner.make_view(request)
    }

    fn training_data_identity(
        &self,
        binding: &crate::data::DataBinding,
    ) -> Result<Option<crate::training::TrainingDataIdentity>> {
        self.inner.training_data_identity(binding)
    }

    fn coordinator_relations(
        &self,
        binding: &crate::data::DataBinding,
    ) -> Result<Option<crate::relation::SampleRelationSet>> {
        self.inner.coordinator_relations(binding)
    }

    fn predict_cohort(
        &self,
        binding: &crate::data::DataBinding,
        phase: Phase,
    ) -> Result<Option<PredictCohort>> {
        let supplied = self.source.predict_cohort(binding, phase)?;
        if supplied.as_ref() != Some(&self.expected_cohort) {
            return Err(DagMlError::RuntimeValidation(format!(
                "PREDICT cohort supplied by runtime provider for binding `{}` does not exactly match its terminal V2 envelope",
                crate::data::data_binding_requirement_key(&binding.node_id, &binding.input_name)
            )));
        }
        let attested = self.inner.predict_cohort(binding, phase)?;
        if attested.as_ref() != Some(&self.expected_cohort) {
            return Err(DagMlError::RuntimeValidation(format!(
                "terminal envelope cohort for binding `{}` changed during replay",
                crate::data::data_binding_requirement_key(&binding.node_id, &binding.input_name)
            )));
        }
        Ok(attested)
    }

    fn methods_pls_capability(&self) -> Result<()> {
        self.inner.methods_pls_capability()
    }

    fn preflight_methods_pls(&self, request: &crate::runtime::MethodsPlsDataRequest) -> Result<()> {
        self.inner.preflight_methods_pls(request)
    }

    fn methods_pls_data(
        &self,
        request: &crate::runtime::MethodsPlsDataRequest,
    ) -> Result<crate::runtime::MethodsPlsData> {
        self.inner.methods_pls_data(request)
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;
    use std::collections::BTreeMap;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    use crate::bundle::build_execution_bundle;
    use crate::controller::{ControllerManifest, ControllerRegistry};
    use crate::data::{InMemoryDataProvider, PredictCohortRole};
    use crate::graph::GraphSpec;
    use crate::ids::{ArtifactId, ControllerId, LineageId, RunId};
    use crate::plan::{build_execution_plan, CampaignSpec};
    use crate::policy::{
        AggregationControllerSpec, AggregationMethod, AggregationPolicy, DataModelShapePlan,
        FitBoundary, Granularity,
    };
    use crate::relation::SampleRelationSet;
    use crate::runtime::{
        AggregationControllerResult, AggregationControllerTask, ArtifactRef,
        DataMaterializationRequest, DataViewRequest, HandleKind, HandleRef, InMemoryArtifactStore,
        LineageRecord, NodeResult, NodeTask, RuntimeController,
    };

    use super::*;

    const SCHEMA_FINGERPRINT: &str =
        "f97b37872fa22134b508f98fd8e207e5b776b52594fb8f6f5c3e15bee212246b";
    const PLAN_FINGERPRINT: &str =
        "7c5431d85574b3f337022fa5d25971d5b5cf445b90331b49938f573ff6901e4d";

    fn terminal_fixture() -> (ExecutionPlan, ExecutionBundle, ExternalDataPlanEnvelope) {
        terminal_fixture_with_custom_aggregation(false)
    }

    fn terminal_fixture_with_custom_aggregation(
        custom_aggregation: bool,
    ) -> (ExecutionPlan, ExecutionBundle, ExternalDataPlanEnvelope) {
        let cv_envelope: ExternalDataPlanEnvelope = serde_json::from_str(include_str!(
            "../tests/fixtures/package/data/coordinator_data_plan_envelope_sample12.json"
        ))
        .expect("fixture envelope parses");
        assert_eq!(cv_envelope.schema_fingerprint, SCHEMA_FINGERPRINT);
        assert_eq!(cv_envelope.plan_fingerprint, PLAN_FINGERPRINT);

        let graph: GraphSpec = serde_json::from_str(
            r#"{
              "id": "graph:terminal.predict",
              "interface": {"inputs": [], "outputs": []},
              "nodes": [{
                "id": "model:terminal",
                "kind": "model",
                "operator": null,
                "params": {},
                "ports": {
                  "inputs": [{"name": "x", "kind": "data", "representation": null, "cardinality": "one", "description": ""}],
                  "outputs": [{"name": "prediction", "kind": "prediction", "representation": null, "cardinality": "one", "description": ""}]
                },
                "metadata": {},
                "seed_label": null
              }],
              "edges": [],
              "search_space_fingerprint": null,
              "metadata": {}
            }"#,
        )
        .expect("terminal graph parses");
        let mut campaign: CampaignSpec = serde_json::from_str(&format!(
            r#"{{
              "id": "campaign:terminal.predict",
              "root_seed": 7,
              "leakage_policy": {{"split_unit": "sample", "forbid_origin_cross_fold": true,
                "allow_observation_split_with_shared_target": false, "require_group_ids": false, "unsafe_flags": []}},
              "aggregation_policy": {{"aggregation_level": "sample", "method": "mean", "weights": "none",
                "emit_parallel_metrics": true, "selection_metric_level": "sample",
                "store_raw_predictions": true, "store_aggregated_predictions": true}},
              "split_invocation": {{
                "id": "split:terminal.predict", "controller_id": null,
                "leakage_policy": {{"split_unit": "sample", "forbid_origin_cross_fold": true,
                  "allow_observation_split_with_shared_target": false, "require_group_ids": false, "unsafe_flags": []}},
                "params": {{}},
                "fold_set": {{
                  "id": "folds:terminal.predict", "sample_ids": ["sample:1", "sample:2"],
                  "folds": [
                    {{"fold_id": "fold:0", "train_sample_ids": ["sample:2"], "validation_sample_ids": ["sample:1"], "metadata": {{}}}},
                    {{"fold_id": "fold:1", "train_sample_ids": ["sample:1"], "validation_sample_ids": ["sample:2"], "metadata": {{}}}}
                  ], "sample_groups": {{}}
                }}
              }},
              "generation": {{"strategy": "none", "dimensions": [], "max_variants": 1}},
              "shape_plans": {{}},
              "data_bindings": {{"model:terminal": [{{
                "node_id": "model:terminal", "input_name": "x", "request_id": "nir-to-tabular",
                "schema_fingerprint": "{SCHEMA_FINGERPRINT}", "plan_fingerprint": "{PLAN_FINGERPRINT}",
                "relation_fingerprint": "{}", "output_representation": "tabular_numeric",
                "feature_set_id": "x", "source_ids": ["nir"], "require_relations": true
              }}]}},
              "metadata": {{}}
            }}"#,
            cv_envelope
                .relation_fingerprint
                .as_deref()
                .expect("fixture relation fingerprint"),
        ))
        .expect("terminal campaign parses");
        if custom_aggregation {
            let node_id = NodeId::new("model:terminal").unwrap();
            campaign.shape_plans.insert(
                node_id.clone(),
                DataModelShapePlan {
                    node_id,
                    input_granularity: Granularity::Observation,
                    target_granularity: Granularity::Sample,
                    fit_rows: FitBoundary::FoldTrain,
                    predict_rows: FitBoundary::FoldValidation,
                    feature_namespace: Some("nir".to_string()),
                    feature_schema_fingerprint: None,
                    target_space: "regression:protein".to_string(),
                    aggregation_policy: AggregationPolicy {
                        aggregation_level: PredictionLevel::Sample,
                        method: AggregationMethod::CustomController,
                        custom_controller: Some(AggregationControllerSpec {
                            controller_id: ControllerId::new("controller:agg.custom").unwrap(),
                            params: serde_json::json!({"terminal": true}),
                        }),
                        ..AggregationPolicy::default()
                    },
                    augmentation_policy: Default::default(),
                    selection_policy: Default::default(),
                },
            );
        }
        let manifest: ControllerManifest = serde_json::from_str(
            r#"{
              "controller_id": "controller:model",
              "controller_version": "0.1.0",
              "operator_kind": "model",
              "priority": 0,
              "supported_phases": ["FIT_CV", "REFIT", "PREDICT"],
              "input_ports": [],
              "output_ports": [],
              "data_requirements": null,
              "capabilities": ["deterministic", "thread_safe", "process_safe", "emits_predictions", "emits_artifacts", "stateful"],
              "fit_scope": "fold_train",
              "rng_policy": "uses_core_seed",
              "artifact_policy": "serializable"
            }"#,
        )
        .expect("terminal controller manifest parses");
        let mut controllers = ControllerRegistry::new();
        controllers.register(manifest).expect("manifest registers");
        if custom_aggregation {
            let aggregation_manifest: ControllerManifest = serde_json::from_str(
                r#"{
                  "controller_id": "controller:agg.custom",
                  "controller_version": "0.1.0",
                  "operator_kind": "aggregator",
                  "priority": 0,
                  "supported_phases": ["PLAN"],
                  "input_ports": [],
                  "output_ports": [],
                  "data_requirements": null,
                  "capabilities": ["deterministic", "thread_safe", "process_safe", "aggregates_predictions"],
                  "fit_scope": "inference_only",
                  "rng_policy": "uses_core_seed",
                  "artifact_policy": "serializable"
                }"#,
            )
            .expect("aggregation controller manifest parses");
            controllers
                .register(aggregation_manifest)
                .expect("aggregation controller registers");
        }
        let plan = build_execution_plan("plan:terminal.predict", graph, campaign, &controllers)
            .expect("terminal plan builds");

        let heldout_relations: SampleRelationSet = serde_json::from_str(
            r#"{
              "records": [
                {"observation_id": "obs.H001", "sample_id": "sample:heldout:1", "target_id": "target:heldout:1", "group_id": "group:heldout", "origin_sample_id": null, "source_id": "nir", "is_augmented": false},
                {"observation_id": "obs.H002", "sample_id": "sample:heldout:2", "target_id": "target:heldout:2", "group_id": "group:heldout", "origin_sample_id": null, "source_id": "nir", "is_augmented": false}
              ]
            }"#,
        )
        .expect("heldout relations parse");
        let cohort = PredictCohort::from_relations(
            PredictCohortRole::ExternalTest,
            heldout_relations,
            vec!["protein".to_string()],
            "a".repeat(64),
            Some("b".repeat(64)),
        )
        .expect("predict cohort builds");
        let mut envelope = cv_envelope;
        envelope.schema_version = EXTERNAL_DATA_PLAN_ENVELOPE_SCHEMA_VERSION_V2;
        envelope.predict_cohort = Some(cohort);
        envelope.validate().expect("V2 envelope validates");
        plan.campaign
            .validate_data_envelope_relations(&envelope)
            .expect("campaign accepts closed external cohort");

        let selected_variant_id = plan
            .variants
            .first()
            .expect("single base variant")
            .variant_id
            .clone();
        let node_plan = plan
            .node_plans
            .get(&NodeId::new("model:terminal").unwrap())
            .expect("terminal node plan");
        let artifact = RefitArtifactRecord {
            node_id: node_plan.node_id.clone(),
            controller_id: node_plan.controller_id.clone(),
            artifact: ArtifactRef {
                id: ArtifactId::new("artifact:model:terminal:refit").unwrap(),
                kind: "mock_model".to_string(),
                controller_id: ControllerId::new("controller:model").unwrap(),
                backend: None,
                uri: None,
                content_fingerprint: None,
                size_bytes: Some(1),
                plugin: None,
                plugin_version: None,
                abi_major: None,
                abi_min_minor: None,
            },
            params_fingerprint: node_plan.params_fingerprint.clone(),
            training_loss_fingerprint: None,
            data_requirement_keys: vec!["model:terminal.x".to_string()],
            prediction_requirement_keys: Vec::new(),
        };
        let bundle = build_execution_bundle(
            BundleId::new("bundle:terminal.predict").unwrap(),
            &plan,
            Some(selected_variant_id),
            BTreeMap::new(),
            vec![artifact],
        )
        .expect("terminal bundle builds");
        (plan, bundle, envelope)
    }

    fn terminal_prediction(envelope: &ExternalDataPlanEnvelope) -> PredictionBlock {
        let cohort = envelope.predict_cohort.as_ref().expect("V2 cohort");
        PredictionBlock {
            prediction_id: Some("prediction:terminal".to_string()),
            producer_node: NodeId::new("model:terminal").unwrap(),
            producer_port: Some("prediction".to_string()),
            partition: PredictionPartition::Final,
            fold_id: None,
            sample_ids: cohort.physical_sample_ids.clone(),
            values: vec![vec![0.1], vec![0.2]],
            target_names: cohort.target_names.clone(),
        }
    }

    fn selector() -> TerminalPredictionSelector {
        TerminalPredictionSelector::new(NodeId::new("model:terminal").unwrap(), "prediction")
            .unwrap()
    }

    struct NeverInvokedController {
        id: ControllerId,
    }

    impl RuntimeController for NeverInvokedController {
        fn controller_id(&self) -> &ControllerId {
            &self.id
        }

        fn invoke(&self, _task: &NodeTask) -> Result<NodeResult> {
            Err(DagMlError::RuntimeValidation(
                "terminal test controller must not be invoked".to_string(),
            ))
        }
    }

    struct SubstitutedCohortProvider {
        cohort: PredictCohort,
        materialize_calls: Cell<usize>,
        view_calls: Cell<usize>,
    }

    impl RuntimeDataProvider for SubstitutedCohortProvider {
        fn materialize(&self, _request: &DataMaterializationRequest) -> Result<HandleRef> {
            self.materialize_calls.set(self.materialize_calls.get() + 1);
            Err(DagMlError::RuntimeValidation(
                "substituted provider was allowed to materialize data".to_string(),
            ))
        }

        fn make_view(&self, _request: &DataViewRequest) -> Result<HandleRef> {
            self.view_calls.set(self.view_calls.get() + 1);
            Err(DagMlError::RuntimeValidation(
                "substituted provider was allowed to construct a view".to_string(),
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

    struct ObservationTerminalController {
        id: ControllerId,
    }

    impl RuntimeController for ObservationTerminalController {
        fn controller_id(&self) -> &ControllerId {
            &self.id
        }

        fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
            let cohort = task
                .data_views
                .get("data:x")
                .and_then(|view| view.sample_ids.as_ref())
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation(
                        "terminal observation test did not receive the V2 cohort view".to_string(),
                    )
                })?;
            let observation_ids = cohort
                .iter()
                .enumerate()
                .map(|(index, _)| crate::ids::ObservationId::new(format!("obs:terminal:{index}")))
                .collect::<Result<Vec<_>>>()?;
            Ok(NodeResult {
                schema_version: None,
                node_id: task.node_plan.node_id.clone(),
                outputs: BTreeMap::new(),
                predictions: Vec::new(),
                observation_predictions: vec![ObservationPredictionBlock {
                    prediction_id: Some("prediction:terminal:observation".to_string()),
                    producer_node: task.node_plan.node_id.clone(),
                    producer_port: Some("prediction".to_string()),
                    partition: PredictionPartition::Final,
                    fold_id: None,
                    observation_ids,
                    values: vec![vec![0.1]; cohort.len()],
                    weights: Vec::new(),
                    target_names: vec!["protein".to_string()],
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
                        "lineage:terminal:observation:{}",
                        task.phase.as_str()
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
                    artifact_refs: Vec::new(),
                    params_fingerprint: task.node_plan.params_fingerprint.clone(),
                    data_model_shape_fingerprint: None,
                    aggregation_policy_fingerprint: None,
                    seed: task.seed,
                    unsafe_flags: Default::default(),
                    metrics: BTreeMap::new(),
                    loss_attestations: Vec::new(),
                    early_stopping_records: Vec::new(),
                },
            })
        }
    }

    struct CountingAggregationController {
        id: ControllerId,
        calls: Arc<AtomicUsize>,
    }

    impl RuntimeController for CountingAggregationController {
        fn controller_id(&self) -> &ControllerId {
            &self.id
        }

        fn invoke(&self, _task: &NodeTask) -> Result<NodeResult> {
            Err(DagMlError::RuntimeValidation(
                "aggregation controller must not receive a node task".to_string(),
            ))
        }

        fn invoke_aggregation(
            &self,
            _task: &AggregationControllerTask,
        ) -> Result<AggregationControllerResult> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Err(DagMlError::RuntimeValidation(
                "terminal direct replay must not invoke aggregation".to_string(),
            ))
        }
    }

    fn registered_terminal_artifact_store(bundle: &ExecutionBundle) -> InMemoryArtifactStore {
        let artifact = bundle
            .refit_artifacts
            .first()
            .expect("terminal fixture has one REFIT artifact");
        let mut store = InMemoryArtifactStore::new();
        store
            .register(
                artifact,
                HandleRef {
                    handle: 901,
                    kind: HandleKind::Model,
                    owner_controller: artifact.controller_id.clone(),
                },
            )
            .expect("terminal artifact registers");
        store
    }

    #[test]
    fn terminal_receipt_binds_exact_v2_cohort_and_logical_refit_artifact() {
        let (plan, bundle, envelope) = terminal_fixture();
        let prediction = terminal_prediction(&envelope);
        let execution = attest_terminal_prediction_output(
            &plan,
            &bundle,
            &envelope,
            &selector(),
            std::slice::from_ref(&prediction),
            &[],
            &[],
        )
        .expect("exact terminal prediction is accepted");
        assert_eq!(execution.prediction(), &prediction);
        assert_eq!(
            execution.receipt().cohort_fingerprint(),
            envelope
                .predict_cohort
                .as_ref()
                .expect("V2 cohort")
                .cohort_fingerprint
        );
        assert_eq!(execution.receipt().refit_artifacts().len(), 1);
        assert_ne!(execution.receipt().output_fingerprint(), "");
        let receipt_json = serde_json::to_value(execution.receipt()).unwrap();
        assert!(receipt_json.get("handle").is_none());
    }

    #[test]
    fn terminal_request_refuses_v1_or_v2_without_cohort() {
        let (plan, bundle, envelope) = terminal_fixture();
        let mut v1 = envelope.clone();
        v1.schema_version = crate::data::EXTERNAL_DATA_PLAN_ENVELOPE_SCHEMA_VERSION_V1;
        v1.predict_cohort = None;
        let error = validate_terminal_prediction_request(&plan, &bundle, &v1, &selector())
            .expect_err("V1 must not enter terminal PREDICT");
        assert!(error
            .to_string()
            .contains("requires external data-plan envelope V2"));

        let mut missing = envelope;
        missing.predict_cohort = None;
        let error = require_terminal_predict_cohort(&missing)
            .expect_err("V2 without a cohort must fail closed");
        assert!(error.to_string().contains("V2 requires predict_cohort"));
    }

    #[test]
    fn terminal_request_refuses_targetless_v2_inference_cohort() {
        let (_plan, _bundle, envelope) = terminal_fixture();
        let relations = envelope
            .predict_cohort
            .as_ref()
            .expect("fixture has a V2 cohort")
            .relations
            .clone();
        let error = PredictCohort::from_relations(
            PredictCohortRole::Inference,
            relations,
            Vec::new(),
            "c".repeat(64),
            None,
        )
        .expect_err("V2 predict cohorts must bind an output width");
        assert!(error
            .to_string()
            .contains("target_names must be a non-empty list"));
    }

    #[test]
    fn terminal_execution_refuses_provider_cohort_substitution_before_data_access() {
        let (plan, bundle, envelope) = terminal_fixture();
        let mut substituted = envelope
            .predict_cohort
            .as_ref()
            .expect("fixture V2 cohort")
            .clone();
        substituted.data_content_fingerprint = "e".repeat(64);
        substituted.cohort_fingerprint = substituted.fingerprint().unwrap();
        let provider = SubstitutedCohortProvider {
            cohort: substituted,
            materialize_calls: Cell::new(0),
            view_calls: Cell::new(0),
        };
        let mut controllers = RuntimeControllerRegistry::new();
        controllers
            .register(Box::new(NeverInvokedController {
                id: ControllerId::new("controller:model").unwrap(),
            }))
            .unwrap();
        // Deliberately leave the artifact store empty: the provider mismatch
        // must be refused before replay is allowed to hydrate even REFIT
        // artifacts, let alone materialize scientific data.
        let artifact_store = InMemoryArtifactStore::new();
        let mut ctx = RunContext::new(RunId::new("run:terminal.substitution").unwrap(), Some(7));

        let error = execute_terminal_prediction(
            TerminalPredictionReplay {
                plan: &plan,
                bundle: &bundle,
                envelope: &envelope,
                selector: &selector(),
                controllers: &controllers,
                data_provider: &provider,
                artifact_store: &artifact_store,
            },
            &mut ctx,
        )
        .expect_err("a provider cohort substitution must fail before data materialization");
        assert!(error.to_string().contains("supplied by runtime provider"));
        assert_eq!(provider.materialize_calls.get(), 0);
        assert_eq!(provider.view_calls.get(), 0);
    }

    #[test]
    fn terminal_execution_rejects_observation_output_without_custom_aggregation() {
        let (plan, bundle, envelope) = terminal_fixture_with_custom_aggregation(true);
        let provider = InMemoryDataProvider::with_envelope(
            ControllerId::new("controller:data.terminal").unwrap(),
            envelope.clone(),
        )
        .unwrap();
        let aggregation_calls = Arc::new(AtomicUsize::new(0));
        let mut controllers = RuntimeControllerRegistry::new();
        controllers
            .register(Box::new(ObservationTerminalController {
                id: ControllerId::new("controller:model").unwrap(),
            }))
            .unwrap();
        controllers
            .register(Box::new(CountingAggregationController {
                id: ControllerId::new("controller:agg.custom").unwrap(),
                calls: aggregation_calls.clone(),
            }))
            .unwrap();
        let artifact_store = registered_terminal_artifact_store(&bundle);
        let mut ctx = RunContext::new(RunId::new("run:terminal.no-aggregation").unwrap(), Some(7));

        let error = execute_terminal_prediction(
            TerminalPredictionReplay {
                plan: &plan,
                bundle: &bundle,
                envelope: &envelope,
                selector: &selector(),
                controllers: &controllers,
                data_provider: &provider,
                artifact_store: &artifact_store,
            },
            &mut ctx,
        )
        .expect_err("direct terminal replay must refuse observation output");
        assert!(error.to_string().contains("observation-level predictions"));
        assert_eq!(aggregation_calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn terminal_receipt_refuses_identity_mismatch_and_aggregation() {
        let (plan, bundle, envelope) = terminal_fixture();
        let mut altered = terminal_prediction(&envelope);
        altered.sample_ids.reverse();
        let error = attest_terminal_prediction_output(
            &plan,
            &bundle,
            &envelope,
            &selector(),
            &[altered],
            &[],
            &[],
        )
        .expect_err("reordered cohort identities must fail");
        assert!(error
            .to_string()
            .contains("sample identities do not exactly match"));

        let observation = ObservationPredictionBlock {
            prediction_id: Some("prediction:terminal:observation".to_string()),
            producer_node: NodeId::new("model:terminal").unwrap(),
            producer_port: Some("prediction".to_string()),
            partition: PredictionPartition::Final,
            fold_id: None,
            observation_ids: Vec::new(),
            values: Vec::new(),
            weights: Vec::new(),
            target_names: vec!["protein".to_string()],
        };
        let error = attest_terminal_prediction_output(
            &plan,
            &bundle,
            &envelope,
            &selector(),
            &[terminal_prediction(&envelope)],
            &[observation],
            &[],
        )
        .expect_err("aggregation output must not enter this first terminal slice");
        assert!(error
            .to_string()
            .contains("unsupported aggregated predictions"));
    }
}
