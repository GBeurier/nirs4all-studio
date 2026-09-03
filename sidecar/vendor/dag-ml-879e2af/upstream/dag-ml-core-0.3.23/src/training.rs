//! Frozen W1 training and portable-predictor contracts.
//!
//! This module is intentionally contract-only. It validates and projects the
//! information needed by the future native training operation without running
//! controllers or duplicating scheduler logic. Historical graph, campaign,
//! controller and plan fingerprints keep their existing serde-JSON profile;
//! only the new contracts in this module use TCV1.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::bundle::{bundle_prediction_requirement_key, ExecutionBundle, RefitArtifactRecord};
use crate::canonical::parse_typed_json;
use crate::conformal_runtime::ConformalCalibration;
use crate::controller::{
    ArtifactPolicy, ControllerCapability, ControllerFitScope, ControllerManifest,
    ControllerRegistry,
};
use crate::criteria::TrainingLossRoleReference;
use crate::data::{data_binding_requirement_key, DataBinding, ExternalDataPlanEnvelope};
use crate::error::{DagMlError, Result};
use crate::fold::fold_set_fingerprint;
use crate::graph::{GraphSpec, NodeKind, PortKind};
use crate::ids::{
    ArtifactId, BundleId, ControllerId, FoldId, GroupId, NodeId, SampleId, VariantId,
};
use crate::phase::Phase;
use crate::plan::{build_execution_plan, CampaignSpec, ExecutionPlan};
use crate::policy::PredictionLevel;
use crate::relation::{EntityUnitLevel, SampleRelationSet};
use crate::replay::{replay_request_from_outcome, TrainingReplayOutcome};
use crate::selection::{RefitStrategy, SelectionPolicy};

pub const TRAINING_REQUEST_SCHEMA_VERSION: u32 = 1;
pub const TRAINING_REQUEST_SCHEMA_ID: &str =
    "https://github.com/GBeurier/dag-ml/schemas/training_request.v1.schema.json";
pub const CACHE_NAMESPACE_SCHEMA_VERSION: u32 = 1;
pub const CACHE_NAMESPACE_SCHEMA_ID: &str =
    "https://github.com/GBeurier/dag-ml/schemas/cache_namespace.v1.schema.json";
/// V2 is the first package family permitted to carry closed conformal state.
pub const PORTABLE_PREDICTOR_PACKAGE_SCHEMA_VERSION: u32 = 2;
pub const LEGACY_PORTABLE_PREDICTOR_PACKAGE_SCHEMA_VERSION: u32 = 1;
pub const MIN_READABLE_PORTABLE_PREDICTOR_PACKAGE_SCHEMA_VERSION: u32 = 1;
/// Reserved Package V3 wire version.  It is intentionally not accepted by
/// the V1/V2 reader until the complete Archive V3 execution path lands.
pub const PORTABLE_PREDICTOR_PACKAGE_V3_SCHEMA_VERSION: u32 = 3;
pub const PORTABLE_REFIT_RECIPE_SCHEMA_VERSION: u32 = 1;
pub const PORTABLE_REFIT_PROVENANCE_SCHEMA_VERSION: u32 = 1;
pub const PORTABLE_PREDICTOR_PACKAGE_SCHEMA_ID: &str =
    "https://github.com/GBeurier/dag-ml/schemas/portable_predictor_package.v1.schema.json";
pub const OUTPUT_BINDING_SCHEMA_VERSION: u32 = 1;
pub const TRAINING_INFLUENCE_MANIFEST_SCHEMA_VERSION: u32 = 1;
pub const PARAMETER_PATCH_SCHEMA_VERSION: u32 = 1;
pub const PARAMETER_PROJECTION_SCHEMA_VERSION: u32 = 1;

type InfluenceCoordinate = (TrainingInfluenceKind, String, Option<NodeId>);
type ExpectedInfluenceCoordinates = BTreeMap<InfluenceCoordinate, BTreeSet<SampleId>>;
type InfluenceCapabilitySlot = (NodeId, TrainingInfluenceKind, Phase, Option<FoldId>);

/// Deserialize a **required but nullable** field.
///
/// Wire semantics: the key MUST be present, yet its value may be an explicit
/// JSON `null`. Paired with `#[serde(deserialize_with = ...)]` and **no**
/// `#[serde(default)]`, this keeps "absent" and "present-and-null" distinct on
/// the wire: an omitted key is a hard `missing field` error, while an explicit
/// `null` maps to `None`. This differs from serde's default treatment of an
/// `Option<T>` field, where omission silently becomes `None`. It matches the
/// W1 JSON schemas that list these fields as `required` with an
/// `anyOf [ T, null ]` value.
fn deserialize_required_nullable<'de, D, T>(
    deserializer: D,
) -> std::result::Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PredictionKind {
    RegressionPoint,
    ClassLabel,
    ClassProbability,
    DecisionScore,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PredictionSource {
    FinalRefit,
    CvEnsemble,
    FoldMember,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutputOrder {
    TargetOrder,
    TargetMajorClassMinor,
}

/// Requested output metadata before the producing port has been resolved.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrainingOutputRequest {
    pub output_id: String,
    pub node_id: NodeId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port_name: Option<String>,
    pub prediction_level: PredictionLevel,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub unit_level: Option<EntityUnitLevel>,
    pub prediction_kind: PredictionKind,
    pub target_names: Vec<String>,
    pub target_units: Vec<Option<String>>,
    pub class_labels: Vec<Vec<String>>,
    pub output_order: OutputOrder,
    pub target_space: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResolvedTrainingOutput {
    pub output_id: String,
    pub node_id: NodeId,
    pub port_name: String,
    pub prediction_level: PredictionLevel,
    #[serde(default)]
    pub unit_level: Option<EntityUnitLevel>,
    pub prediction_kind: PredictionKind,
    pub target_names: Vec<String>,
    pub target_units: Vec<Option<String>>,
    pub class_labels: Vec<Vec<String>>,
    pub output_order: OutputOrder,
    pub target_space: String,
}

impl TrainingOutputRequest {
    pub fn validate(&self) -> Result<()> {
        validate_identifier_text("training output_id", &self.output_id)?;
        validate_output_unit_level(self.prediction_level, self.unit_level)?;
        validate_output_shape(
            self.prediction_kind,
            self.output_order,
            &self.target_names,
            &self.target_units,
            &self.class_labels,
            &self.target_space,
        )?;
        if self
            .port_name
            .as_ref()
            .is_some_and(|name| name.trim().is_empty())
        {
            return contract_error(format!(
                "training output `{}` has an empty port_name",
                self.output_id
            ));
        }
        Ok(())
    }

    /// Resolve the only prediction port when omitted, or validate an explicit
    /// port. A producer with zero or multiple prediction ports is never guessed.
    pub fn resolve(&self, graph: &GraphSpec) -> Result<ResolvedTrainingOutput> {
        self.validate()?;
        let node = graph
            .nodes
            .iter()
            .find(|node| node.id == self.node_id)
            .ok_or_else(|| {
                DagMlError::CampaignValidation(format!(
                    "training output `{}` references unknown node `{}`",
                    self.output_id, self.node_id
                ))
            })?;
        let prediction_ports = node
            .ports
            .outputs
            .iter()
            .filter(|port| port.kind == PortKind::Prediction)
            .collect::<Vec<_>>();
        let port_name = match self.port_name.as_deref() {
            Some(requested) => {
                let port = node
                    .ports
                    .outputs
                    .iter()
                    .find(|port| port.name == requested)
                    .ok_or_else(|| {
                        DagMlError::CampaignValidation(format!(
                            "training output `{}` references absent port `{}.{requested}`",
                            self.output_id, self.node_id
                        ))
                    })?;
                if port.kind != PortKind::Prediction {
                    return contract_error(format!(
                        "training output `{}` port `{}.{requested}` is not a prediction port",
                        self.output_id, self.node_id
                    ));
                }
                requested.to_string()
            }
            None => match prediction_ports.as_slice() {
                [] => {
                    return contract_error(format!(
                        "training output `{}` node `{}` exposes no prediction output",
                        self.output_id, self.node_id
                    ));
                }
                [only] => only.name.clone(),
                _ => {
                    return contract_error(format!(
                        "training output `{}` node `{}` exposes multiple prediction outputs; port_name is required",
                        self.output_id, self.node_id
                    ));
                }
            },
        };
        Ok(ResolvedTrainingOutput {
            output_id: self.output_id.clone(),
            node_id: self.node_id.clone(),
            port_name,
            prediction_level: self.prediction_level,
            unit_level: self.unit_level,
            prediction_kind: self.prediction_kind,
            target_names: self.target_names.clone(),
            target_units: self.target_units.clone(),
            class_labels: self.class_labels.clone(),
            output_order: self.output_order,
            target_space: self.target_space.clone(),
        })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrainingSchedulerKind {
    Sequential,
    Parallel,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrainingSchedulerBackend {
    Threads,
    Processes,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrainingSchedulerOptions {
    pub kind: TrainingSchedulerKind,
    #[serde(default)]
    pub backend: Option<TrainingSchedulerBackend>,
    pub workers: u32,
}

impl TrainingSchedulerOptions {
    fn validate(&self) -> Result<()> {
        match (self.kind, self.backend, self.workers) {
            (TrainingSchedulerKind::Sequential, None, 1) => Ok(()),
            (TrainingSchedulerKind::Sequential, Some(_), _) => contract_error(
                "sequential training scheduler forbids a parallel backend".to_string(),
            ),
            (TrainingSchedulerKind::Sequential, None, _) => {
                contract_error("sequential training scheduler requires workers=1".to_string())
            }
            (TrainingSchedulerKind::Parallel, None, _) => contract_error(
                "parallel training scheduler requires an explicit backend".to_string(),
            ),
            (TrainingSchedulerKind::Parallel, Some(_), 0 | 1) => {
                contract_error("parallel training scheduler requires workers>=2".to_string())
            }
            (TrainingSchedulerKind::Parallel, Some(_), _) => Ok(()),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrainingResourceLimits {
    pub cpu_threads: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memory_bytes: Option<u64>,
    // Required by schema: an empty list is valid, but omitting the key is not,
    // so this field intentionally carries no `#[serde(default)]`.
    pub gpu_devices: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wall_time_ms: Option<u64>,
}

impl TrainingResourceLimits {
    fn validate(&self, scheduler: &TrainingSchedulerOptions) -> Result<()> {
        if self.cpu_threads == 0 {
            return contract_error("training resources require cpu_threads>=1".to_string());
        }
        if scheduler.workers > self.cpu_threads {
            return contract_error(format!(
                "training scheduler workers={} exceeds cpu_threads={}",
                scheduler.workers, self.cpu_threads
            ));
        }
        if self.memory_bytes == Some(0) {
            return contract_error("training memory_bytes must be positive".to_string());
        }
        if self.wall_time_ms == Some(0) {
            return contract_error("training wall_time_ms must be positive".to_string());
        }
        validate_sorted_unique_text("training gpu_devices", &self.gpu_devices, false)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CvArtifactRetention {
    Discard,
    MetadataOnly,
    Retain,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PredictionCacheRetention {
    Discard,
    Retain,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FittedArtifactMode {
    PortableRequired,
    AllowHostSidecar,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrainingArtifactOptions {
    pub cv_artifacts: CvArtifactRetention,
    pub prediction_caches: PredictionCacheRetention,
    pub fitted_artifacts: FittedArtifactMode,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrainingOptions {
    pub refit: bool,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub refit_strategy: Option<RefitStrategy>,
    pub seed: u64,
    pub selection: SelectionPolicy,
    pub selection_output_id: String,
    pub outputs: Vec<TrainingOutputRequest>,
    pub scheduler: TrainingSchedulerOptions,
    pub resources: TrainingResourceLimits,
    pub artifacts: TrainingArtifactOptions,
}

impl TrainingOptions {
    fn validate(&self, graph: &GraphSpec) -> Result<Vec<ResolvedTrainingOutput>> {
        match (self.refit, self.refit_strategy) {
            (true, None) => {
                return contract_error(
                    "training refit=true requires an explicit refit_strategy".to_string(),
                );
            }
            (false, Some(_)) => {
                return contract_error("training refit=false forbids refit_strategy".to_string());
            }
            _ => {}
        }
        self.selection.validate()?;
        validate_identifier_text("training selection_output_id", &self.selection_output_id)?;
        self.scheduler.validate()?;
        self.resources.validate(&self.scheduler)?;
        if !self.refit && self.artifacts.prediction_caches != PredictionCacheRetention::Retain {
            return contract_error(
                "training refit=false requires retained prediction caches for REFIT replay"
                    .to_string(),
            );
        }
        if self.outputs.is_empty() {
            return contract_error("training options require at least one output".to_string());
        }
        let mut previous_id: Option<&str> = None;
        let mut coordinates = BTreeSet::new();
        let mut resolved = Vec::with_capacity(self.outputs.len());
        for output in &self.outputs {
            if previous_id.is_some_and(|previous| previous >= output.output_id.as_str()) {
                return contract_error(
                    "training outputs must be strictly sorted by output_id".to_string(),
                );
            }
            previous_id = Some(output.output_id.as_str());
            let output = output.resolve(graph)?;
            if !coordinates.insert((output.node_id.clone(), output.port_name.clone())) {
                return contract_error(format!(
                    "training outputs bind `{}.{}` more than once",
                    output.node_id, output.port_name
                ));
            }
            resolved.push(output);
        }
        if !resolved
            .iter()
            .any(|output| output.output_id == self.selection_output_id)
        {
            return contract_error(format!(
                "training selection_output_id `{}` does not identify a declared output",
                self.selection_output_id
            ));
        }
        Ok(resolved)
    }
}

/// Content identity paired with one external data requirement.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrainingDataIdentity {
    pub requirement_key: String,
    pub schema_fingerprint: String,
    pub plan_fingerprint: String,
    pub relation_fingerprint: String,
    pub data_content_fingerprint: String,
    pub target_content_fingerprint: String,
    pub identity_fingerprint: String,
}

impl TrainingDataIdentity {
    /// Build the complete, signed content identity for one exact data binding.
    ///
    /// Prediction-only or legacy envelopes may omit content fingerprints, but
    /// such envelopes cannot attest a native training operation and are
    /// rejected here.
    pub fn from_binding_envelope(
        binding: &DataBinding,
        envelope: &ExternalDataPlanEnvelope,
    ) -> Result<Self> {
        binding.validate_envelope(envelope)?;
        let requirement_key = data_binding_requirement_key(&binding.node_id, &binding.input_name);
        let relation_fingerprint = envelope.relation_fingerprint.clone().ok_or_else(|| {
            DagMlError::CampaignValidation(format!(
                "external data envelope for `{requirement_key}` cannot attest training without a relation fingerprint"
            ))
        })?;
        let data_content_fingerprint =
            envelope.data_content_fingerprint.clone().ok_or_else(|| {
                DagMlError::CampaignValidation(format!(
                    "external data envelope for `{requirement_key}` cannot attest training without a data content fingerprint"
                ))
            })?;
        let target_content_fingerprint =
            envelope.target_content_fingerprint.clone().ok_or_else(|| {
                DagMlError::CampaignValidation(format!(
                    "external data envelope for `{requirement_key}` cannot attest training without a target content fingerprint"
                ))
            })?;
        let mut identity = Self {
            requirement_key,
            schema_fingerprint: envelope.schema_fingerprint.clone(),
            plan_fingerprint: envelope.plan_fingerprint.clone(),
            relation_fingerprint,
            data_content_fingerprint,
            target_content_fingerprint,
            identity_fingerprint: zero_fingerprint(),
        };
        identity.identity_fingerprint = identity.compute_fingerprint()?;
        identity.validate()?;
        Ok(identity)
    }

    pub fn compute_fingerprint(&self) -> Result<String> {
        tcv1_fingerprint_without(self, "identity_fingerprint", "training data identity")
    }

    pub fn validate(&self) -> Result<()> {
        validate_non_empty("training data requirement_key", &self.requirement_key)?;
        for (label, value) in [
            ("training data schema", &self.schema_fingerprint),
            ("training data plan", &self.plan_fingerprint),
            ("training data relation", &self.relation_fingerprint),
            ("training data content", &self.data_content_fingerprint),
            ("training target content", &self.target_content_fingerprint),
            ("training data identity", &self.identity_fingerprint),
        ] {
            validate_sha256(label, value)?;
        }
        if self.identity_fingerprint != self.compute_fingerprint()? {
            return contract_error(format!(
                "training data identity `{}` fingerprint does not match TCV1 content",
                self.requirement_key
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ParameterNamespace {
    Operator,
    Fit,
    Control,
    Structural,
}

impl ParameterNamespace {
    /// Return the frozen internal `ExecutionPlan` root for this public wire
    /// namespace. The mapping is bijective and must not be renamed silently.
    pub const fn plan_root(self) -> &'static str {
        match self {
            Self::Operator => "params",
            Self::Fit => "fit_params",
            Self::Control => "control_params",
            Self::Structural => "structural_params",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ParameterPatch {
    pub schema_version: u32,
    pub node_id: NodeId,
    pub namespace: ParameterNamespace,
    pub path: Vec<String>,
    pub value: serde_json::Value,
}

impl ParameterPatch {
    pub fn validate(&self) -> Result<()> {
        if self.schema_version != PARAMETER_PATCH_SCHEMA_VERSION {
            return unsupported_version(
                "parameter patch",
                self.schema_version,
                PARAMETER_PATCH_SCHEMA_VERSION,
            );
        }
        if self.path.is_empty() {
            return contract_error(format!(
                "parameter patch for `{}` has an empty path",
                self.node_id
            ));
        }
        for segment in &self.path {
            if segment.trim().is_empty() || segment == "-" {
                return contract_error(format!(
                    "parameter patch for `{}` has an invalid path segment `{segment}`",
                    self.node_id
                ));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NodePatchPolicy {
    pub node_id: NodeId,
    pub allowed_namespaces: BTreeSet<ParameterNamespace>,
}

impl NodePatchPolicy {
    fn validate(&self) -> Result<()> {
        if self.allowed_namespaces.is_empty() {
            return contract_error(format!(
                "node patch policy `{}` allows no namespaces",
                self.node_id
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NamespacedNodeParameters {
    #[serde(default)]
    pub params: BTreeMap<String, serde_json::Value>,
    #[serde(default)]
    pub fit_params: BTreeMap<String, serde_json::Value>,
    #[serde(default)]
    pub control_params: BTreeMap<String, serde_json::Value>,
    #[serde(default)]
    pub structural_params: BTreeMap<String, serde_json::Value>,
}

impl NamespacedNodeParameters {
    fn namespace_mut(
        &mut self,
        namespace: ParameterNamespace,
    ) -> &mut BTreeMap<String, serde_json::Value> {
        match namespace {
            ParameterNamespace::Operator => &mut self.params,
            ParameterNamespace::Fit => &mut self.fit_params,
            ParameterNamespace::Control => &mut self.control_params,
            ParameterNamespace::Structural => &mut self.structural_params,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ParameterProjection {
    pub schema_version: u32,
    pub nodes: BTreeMap<NodeId, NamespacedNodeParameters>,
    pub requires_recompile: bool,
    pub structural_patch_count: u32,
    pub patches_fingerprint: String,
    pub projection_fingerprint: String,
}

impl ParameterProjection {
    pub fn from_json(json: &str) -> Result<Self> {
        let raw_fingerprint = strict_tcv1_fingerprint_without(
            json,
            "projection_fingerprint",
            "parameter projection",
        )?;
        let projection: Self = serde_json::from_str(json)?;
        if projection.projection_fingerprint != raw_fingerprint {
            return contract_error(
                "parameter projection fingerprint does not match original TCV1 JSON".to_string(),
            );
        }
        projection.validate()?;
        Ok(projection)
    }

    pub fn compute_fingerprint(&self) -> Result<String> {
        tcv1_fingerprint_without(self, "projection_fingerprint", "parameter projection")
    }

    pub fn validate(&self) -> Result<()> {
        if self.schema_version != PARAMETER_PROJECTION_SCHEMA_VERSION {
            return unsupported_version(
                "parameter projection",
                self.schema_version,
                PARAMETER_PROJECTION_SCHEMA_VERSION,
            );
        }
        validate_sha256("parameter patches", &self.patches_fingerprint)?;
        validate_sha256("parameter projection", &self.projection_fingerprint)?;
        if self.requires_recompile != (self.structural_patch_count > 0) {
            return contract_error(
                "parameter projection requires_recompile must equal structural_patch_count>0"
                    .to_string(),
            );
        }
        if self.projection_fingerprint != self.compute_fingerprint()? {
            return contract_error(
                "parameter projection fingerprint does not match TCV1 content".to_string(),
            );
        }
        Ok(())
    }
}

/// Clone and deeply apply typed patches. Intermediate path segments must
/// already exist and be objects; only the final object key may be new. Arrays
/// are never addressable in V1.
pub fn project_parameter_patches(
    plan: &ExecutionPlan,
    patches: &[ParameterPatch],
    policies: &[NodePatchPolicy],
) -> Result<ParameterProjection> {
    plan.validate()?;
    validate_canonical_patches(patches)?;
    let policy_map = validate_patch_policies(plan, policies)?;
    let patched_nodes = patches
        .iter()
        .map(|patch| patch.node_id.clone())
        .collect::<BTreeSet<_>>();
    if policy_map.keys().cloned().collect::<BTreeSet<_>>() != patched_nodes {
        return contract_error(
            "node patch policies must exactly cover nodes targeted by patches".to_string(),
        );
    }
    let mut nodes = plan
        .node_plans
        .iter()
        .map(|(node_id, node_plan)| {
            (
                node_id.clone(),
                NamespacedNodeParameters {
                    params: node_plan.params.clone(),
                    ..NamespacedNodeParameters::default()
                },
            )
        })
        .collect::<BTreeMap<_, _>>();
    let mut structural_patch_count = 0_u32;
    for patch in patches {
        let policy = policy_map.get(&patch.node_id).ok_or_else(|| {
            DagMlError::CampaignValidation(format!(
                "parameter patch for `{}` has no node patch policy",
                patch.node_id
            ))
        })?;
        if !policy.contains(&patch.namespace) {
            return contract_error(format!(
                "parameter namespace `{:?}` is forbidden for node `{}`",
                patch.namespace, patch.node_id
            ));
        }
        let node = nodes.get_mut(&patch.node_id).ok_or_else(|| {
            DagMlError::CampaignValidation(format!(
                "parameter patch references unknown node `{}`",
                patch.node_id
            ))
        })?;
        deep_set_object_key(
            node.namespace_mut(patch.namespace),
            &patch.path,
            patch.value.clone(),
            &patch.node_id,
        )?;
        if patch.namespace == ParameterNamespace::Structural {
            structural_patch_count = structural_patch_count.checked_add(1).ok_or_else(|| {
                DagMlError::CampaignValidation(
                    "parameter projection has too many structural patches".to_string(),
                )
            })?;
        }
    }
    let patches_fingerprint = tcv1_fingerprint(patches, "parameter patches")?;
    let mut projection = ParameterProjection {
        schema_version: PARAMETER_PROJECTION_SCHEMA_VERSION,
        nodes,
        requires_recompile: structural_patch_count > 0,
        structural_patch_count,
        patches_fingerprint,
        projection_fingerprint: zero_fingerprint(),
    };
    projection.projection_fingerprint = projection.compute_fingerprint()?;
    projection.validate()?;
    Ok(projection)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrainingInfluenceKind {
    TransformFit,
    ModelFit,
    HpoSelection,
    EarlyStopping,
    WeightingResampling,
    TrainedMetaAggregation,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ControllerInfluenceRequirement {
    pub node_id: NodeId,
    pub kind: TrainingInfluenceKind,
    pub scope_id: String,
    pub phase: Phase,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub fold_id: Option<FoldId>,
    pub physical_sample_ids: Vec<SampleId>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrainingInfluenceEntry {
    pub kind: TrainingInfluenceKind,
    pub scope_id: String,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub node_id: Option<NodeId>,
    pub physical_sample_ids: Vec<SampleId>,
    pub origin_sample_ids: Vec<SampleId>,
    pub group_ids: Vec<GroupId>,
}

impl TrainingInfluenceEntry {
    fn validate(&self) -> Result<()> {
        validate_identifier_text("training influence scope_id", &self.scope_id)?;
        validate_sorted_unique_ids(
            "training influence physical_sample_ids",
            &self.physical_sample_ids,
            true,
        )?;
        validate_sorted_unique_ids(
            "training influence origin_sample_ids",
            &self.origin_sample_ids,
            false,
        )?;
        validate_sorted_unique_ids("training influence group_ids", &self.group_ids, false)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrainingInfluenceManifest {
    pub schema_version: u32,
    pub relation_fingerprint: String,
    pub entries: Vec<TrainingInfluenceEntry>,
    pub manifest_fingerprint: String,
}

impl TrainingInfluenceManifest {
    pub fn compute_fingerprint(&self) -> Result<String> {
        tcv1_fingerprint_without(self, "manifest_fingerprint", "training influence manifest")
    }

    pub fn derive_for_projection(
        projection: &TrainingContractProjection,
        request: &TrainingRequest,
        relations: &SampleRelationSet,
    ) -> Result<Self> {
        projection.validate()?;
        relations.validate()?;
        let relation_fingerprint = relations.fingerprint()?;
        if request
            .data_identities
            .iter()
            .any(|identity| identity.relation_fingerprint != relation_fingerprint)
        {
            return contract_error(
                "training data identities do not all bind the influence relation".to_string(),
            );
        }
        let expected = expected_influence_coordinates(
            request,
            &projection.plan,
            &projection.predictor_node_ids,
        )?;
        let mut entries = Vec::with_capacity(expected.len());
        for ((kind, scope_id, node_id), samples) in expected {
            let (origin_sample_ids, group_ids) =
                influence_identity_closure_for_samples(&scope_id, &samples, relations)?;
            entries.push(TrainingInfluenceEntry {
                kind,
                scope_id,
                node_id,
                physical_sample_ids: samples.into_iter().collect(),
                origin_sample_ids,
                group_ids,
            });
        }
        let mut manifest = Self {
            schema_version: TRAINING_INFLUENCE_MANIFEST_SCHEMA_VERSION,
            relation_fingerprint,
            entries,
            manifest_fingerprint: zero_fingerprint(),
        };
        manifest.manifest_fingerprint = manifest.compute_fingerprint()?;
        manifest.validate_for_projection(projection, request, relations)?;
        Ok(manifest)
    }

    pub fn validate(&self) -> Result<()> {
        if self.schema_version != TRAINING_INFLUENCE_MANIFEST_SCHEMA_VERSION {
            return unsupported_version(
                "training influence manifest",
                self.schema_version,
                TRAINING_INFLUENCE_MANIFEST_SCHEMA_VERSION,
            );
        }
        validate_sha256("training influence relation", &self.relation_fingerprint)?;
        validate_sha256("training influence manifest", &self.manifest_fingerprint)?;
        if self.entries.is_empty() {
            return contract_error(
                "training influence manifest requires at least one entry".to_string(),
            );
        }
        let mut previous: Option<(TrainingInfluenceKind, &str, Option<&NodeId>)> = None;
        for entry in &self.entries {
            entry.validate()?;
            let key = (entry.kind, entry.scope_id.as_str(), entry.node_id.as_ref());
            if previous.as_ref().is_some_and(|previous| previous >= &key) {
                return contract_error(
                    "training influence entries must be strictly canonically sorted".to_string(),
                );
            }
            previous = Some(key);
        }
        if self.manifest_fingerprint != self.compute_fingerprint()? {
            return contract_error(
                "training influence manifest fingerprint does not match TCV1 content".to_string(),
            );
        }
        Ok(())
    }

    pub fn validate_for_projection(
        &self,
        projection: &TrainingContractProjection,
        request: &TrainingRequest,
        relations: &SampleRelationSet,
    ) -> Result<()> {
        self.validate()?;
        relations.validate()?;
        let relation_fingerprint = relations.fingerprint()?;
        if self.relation_fingerprint != relation_fingerprint {
            return contract_error(
                "training influence relation fingerprint does not match relation set".to_string(),
            );
        }
        if request
            .data_identities
            .iter()
            .any(|identity| identity.relation_fingerprint != relation_fingerprint)
        {
            return contract_error(
                "training data identities do not all bind the influence relation".to_string(),
            );
        }

        let expected = expected_influence_coordinates(
            request,
            &projection.plan,
            &projection.predictor_node_ids,
        )?;
        let mut actual = BTreeSet::new();
        for entry in &self.entries {
            if let Some(node_id) = &entry.node_id {
                if !projection.predictor_node_ids.contains(node_id) {
                    return contract_error(format!(
                        "training influence node `{node_id}` is outside predictor closure"
                    ));
                }
            }
            let coordinate = (entry.kind, entry.scope_id.clone(), entry.node_id.clone());
            let expected_samples = expected.get(&coordinate).ok_or_else(|| {
                DagMlError::CampaignValidation(format!(
                    "training influence contains undeclared coordinate `{:?}/{}/{:?}`",
                    entry.kind, entry.scope_id, entry.node_id
                ))
            })?;
            if entry
                .physical_sample_ids
                .iter()
                .cloned()
                .collect::<BTreeSet<_>>()
                != *expected_samples
            {
                return contract_error(format!(
                    "training influence coordinate `{:?}/{}/{:?}` does not contain the exact scope samples",
                    entry.kind, entry.scope_id, entry.node_id
                ));
            }
            validate_influence_identity_closure(entry, relations)?;
            actual.insert(coordinate);
        }
        let expected_keys = expected.into_keys().collect::<BTreeSet<_>>();
        if actual != expected_keys {
            return contract_error(
                "training influence entries do not exactly cover capability-derived phase scopes"
                    .to_string(),
            );
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrainingRequest {
    pub schema_version: u32,
    pub request_id: String,
    pub plan_id: String,
    pub graph: GraphSpec,
    pub campaign: CampaignSpec,
    pub controller_manifests: Vec<ControllerManifest>,
    pub data_identities: Vec<TrainingDataIdentity>,
    pub parameter_patches: Vec<ParameterPatch>,
    pub patch_policies: Vec<NodePatchPolicy>,
    pub influence_requirements: Vec<ControllerInfluenceRequirement>,
    /// Native loss roles are attested in the request and lowered into the
    /// execution plan before controller tasks are constructed.  They remain
    /// optional for existing V1 requests, whose canonical meaning is no
    /// process-local training loss.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub training_losses: Vec<TrainingLossRoleReference>,
    pub options: TrainingOptions,
    pub request_fingerprint: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrainingContractProjection {
    pub request_id: String,
    pub request_fingerprint: String,
    pub plan: ExecutionPlan,
    pub outputs: Vec<ResolvedTrainingOutput>,
    pub predictor_node_ids: BTreeSet<NodeId>,
    pub parameters: ParameterProjection,
}

impl TrainingContractProjection {
    pub fn from_json(json: &str) -> Result<Self> {
        parse_typed_json(json).map_err(|error| {
            DagMlError::RuntimeValidation(format!(
                "training contract projection is outside strict TCV1 JSON: {error}"
            ))
        })?;
        let mut deserializer = serde_json::Deserializer::from_str(json);
        let mut ignored_paths = Vec::new();
        let projection: Self = serde_ignored::deserialize(&mut deserializer, |path| {
            ignored_paths.push(path.to_string());
        })?;
        if !ignored_paths.is_empty() {
            ignored_paths.sort();
            ignored_paths.dedup();
            return contract_error(format!(
                "training contract projection contains unknown field(s) at: {}",
                ignored_paths.join(", ")
            ));
        }
        projection.validate()?;
        Ok(projection)
    }

    pub fn validate(&self) -> Result<()> {
        validate_identifier_text("training projection request_id", &self.request_id)?;
        validate_sha256(
            "training projection request_fingerprint",
            &self.request_fingerprint,
        )?;
        self.plan.validate()?;
        self.parameters.validate()?;
        if self.parameters.nodes.keys().collect::<BTreeSet<_>>()
            != self.plan.node_plans.keys().collect::<BTreeSet<_>>()
        {
            return contract_error(
                "training projection parameter nodes do not exactly match execution plan"
                    .to_string(),
            );
        }
        if self.outputs.is_empty() {
            return contract_error("training projection requires at least one output".to_string());
        }
        let mut previous_id: Option<&str> = None;
        let mut coordinates = BTreeSet::new();
        for output in &self.outputs {
            if previous_id.is_some_and(|previous| previous >= output.output_id.as_str()) {
                return contract_error(
                    "training projection outputs must be strictly sorted by output_id".to_string(),
                );
            }
            previous_id = Some(output.output_id.as_str());
            let requested = TrainingOutputRequest {
                output_id: output.output_id.clone(),
                node_id: output.node_id.clone(),
                port_name: Some(output.port_name.clone()),
                prediction_level: output.prediction_level,
                unit_level: output.unit_level,
                prediction_kind: output.prediction_kind,
                target_names: output.target_names.clone(),
                target_units: output.target_units.clone(),
                class_labels: output.class_labels.clone(),
                output_order: output.output_order,
                target_space: output.target_space.clone(),
            };
            if requested.resolve(&self.plan.graph_plan.graph)? != *output {
                return contract_error(
                    "training projection contains a non-canonical resolved output".to_string(),
                );
            }
            if !coordinates.insert((output.node_id.clone(), output.port_name.clone())) {
                return contract_error(
                    "training projection contains duplicate output coordinates".to_string(),
                );
            }
        }
        let expected_closure = predictor_closure(
            &self.plan,
            self.outputs.iter().map(|output| &output.node_id),
        )?;
        if self.predictor_node_ids != expected_closure {
            return contract_error(
                "training projection predictor_node_ids do not match output closure".to_string(),
            );
        }
        Ok(())
    }
}

impl TrainingRequest {
    pub fn from_json(json: &str) -> Result<Self> {
        let raw_fingerprint =
            strict_tcv1_fingerprint_without(json, "request_fingerprint", "training request")?;
        let request: Self = serde_json::from_str(json)?;
        if request.request_fingerprint != raw_fingerprint {
            return contract_error(
                "training request fingerprint does not match original TCV1 JSON".to_string(),
            );
        }
        request.validate()?;
        Ok(request)
    }

    pub fn compute_fingerprint(&self) -> Result<String> {
        tcv1_fingerprint_without(self, "request_fingerprint", "training request")
    }

    pub fn validate(&self) -> Result<()> {
        self.project().map(|_| ())
    }

    pub fn project(&self) -> Result<TrainingContractProjection> {
        if self.schema_version != TRAINING_REQUEST_SCHEMA_VERSION {
            return unsupported_version(
                "training request",
                self.schema_version,
                TRAINING_REQUEST_SCHEMA_VERSION,
            );
        }
        validate_identifier_text("training request_id", &self.request_id)?;
        validate_non_empty("training plan_id", &self.plan_id)?;
        self.graph.validate()?;
        self.campaign.validate()?;
        if self.campaign.root_seed != Some(self.options.seed) {
            return contract_error(
                "training options seed must exactly match campaign.root_seed".to_string(),
            );
        }
        validate_sha256("training request", &self.request_fingerprint)?;
        if self.request_fingerprint != self.compute_fingerprint()? {
            return contract_error(
                "training request fingerprint does not match TCV1 content".to_string(),
            );
        }
        let outputs = self.options.validate(&self.graph)?;
        let mut registry = ControllerRegistry::new();
        let mut previous_controller: Option<&str> = None;
        for manifest in &self.controller_manifests {
            if previous_controller
                .is_some_and(|previous| previous >= manifest.controller_id.as_str())
            {
                return contract_error(
                    "training controller_manifests must be strictly sorted by controller_id"
                        .to_string(),
                );
            }
            previous_controller = Some(manifest.controller_id.as_str());
            registry.register(manifest.clone())?;
        }
        let plan = build_execution_plan(
            self.plan_id.clone(),
            self.graph.clone(),
            self.campaign.clone(),
            &registry,
        )?
        .with_training_losses(self.training_losses.clone())?;
        validate_output_controllers(&plan, &outputs)?;
        validate_selection_output(&plan, &self.options, &outputs)?;
        validate_training_data_identities(self, &plan)?;
        let parameters =
            project_parameter_patches(&plan, &self.parameter_patches, &self.patch_policies)?;
        let predictor_node_ids =
            predictor_closure(&plan, outputs.iter().map(|output| &output.node_id))?;
        validate_scheduler_capabilities(&self.options.scheduler, &plan, &predictor_node_ids)?;
        validate_artifact_mode(&self.options.artifacts, &plan, &predictor_node_ids)?;
        validate_influence_requirements(self, &plan, &predictor_node_ids)?;
        let projection = TrainingContractProjection {
            request_id: self.request_id.clone(),
            request_fingerprint: self.request_fingerprint.clone(),
            plan,
            outputs,
            predictor_node_ids,
            parameters,
        };
        projection.validate()?;
        Ok(projection)
    }
}

/// Candidate-cache identity. Every field that can change predictions is part
/// of the TCV1 namespace; a requirement key alone is deliberately insufficient.
#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CacheNamespace {
    pub schema_version: u32,
    pub prediction_requirement_key: String,
    pub data_requirement_key: String,
    pub producer_node_id: NodeId,
    pub source_port_name: String,
    pub consumer_node_id: NodeId,
    pub target_port_name: String,
    pub phase: Phase,
    pub params_fingerprint: String,
    pub data_identity_fingerprint: String,
    pub fold_id: FoldId,
    pub trial_id: String,
    pub seed: u64,
    pub namespace_fingerprint: String,
}

impl CacheNamespace {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        prediction_requirement_key: String,
        data_requirement_key: String,
        producer_node_id: NodeId,
        source_port_name: String,
        consumer_node_id: NodeId,
        target_port_name: String,
        params_fingerprint: String,
        data_identity_fingerprint: String,
        fold_id: FoldId,
        trial_id: String,
        seed: u64,
    ) -> Result<Self> {
        let mut namespace = Self {
            schema_version: CACHE_NAMESPACE_SCHEMA_VERSION,
            prediction_requirement_key,
            data_requirement_key,
            producer_node_id,
            source_port_name,
            consumer_node_id,
            target_port_name,
            phase: Phase::FitCv,
            params_fingerprint,
            data_identity_fingerprint,
            fold_id,
            trial_id,
            seed,
            namespace_fingerprint: zero_fingerprint(),
        };
        namespace.namespace_fingerprint = namespace.compute_fingerprint()?;
        namespace.validate()?;
        Ok(namespace)
    }

    pub fn from_json(json: &str) -> Result<Self> {
        let raw_fingerprint =
            strict_tcv1_fingerprint_without(json, "namespace_fingerprint", "cache namespace")?;
        let namespace: Self = serde_json::from_str(json)?;
        if namespace.namespace_fingerprint != raw_fingerprint {
            return contract_error(
                "cache namespace fingerprint does not match original TCV1 JSON".to_string(),
            );
        }
        namespace.validate()?;
        Ok(namespace)
    }

    pub fn compute_fingerprint(&self) -> Result<String> {
        tcv1_fingerprint_without(self, "namespace_fingerprint", "cache namespace")
    }

    pub fn validate(&self) -> Result<()> {
        if self.schema_version != CACHE_NAMESPACE_SCHEMA_VERSION {
            return unsupported_version(
                "cache namespace",
                self.schema_version,
                CACHE_NAMESPACE_SCHEMA_VERSION,
            );
        }
        validate_non_empty(
            "cache namespace prediction_requirement_key",
            &self.prediction_requirement_key,
        )?;
        validate_non_empty(
            "cache namespace data_requirement_key",
            &self.data_requirement_key,
        )?;
        validate_non_empty("cache namespace source_port_name", &self.source_port_name)?;
        validate_non_empty("cache namespace target_port_name", &self.target_port_name)?;
        if self.phase != Phase::FitCv {
            return contract_error(
                "cache namespace V1 is fold-scoped and permits only FIT_CV".to_string(),
            );
        }
        let expected_requirement_key = bundle_prediction_requirement_key(
            &self.producer_node_id,
            &self.source_port_name,
            &self.consumer_node_id,
            &self.target_port_name,
        );
        if self.prediction_requirement_key != expected_requirement_key {
            return contract_error(
                "cache namespace requirement_key does not match producer/source/consumer/target coordinates"
                    .to_string(),
            );
        }
        validate_identifier_text("cache namespace trial_id", &self.trial_id)?;
        for (label, fingerprint) in [
            ("cache params", &self.params_fingerprint),
            ("cache data identity", &self.data_identity_fingerprint),
            ("cache namespace", &self.namespace_fingerprint),
        ] {
            validate_sha256(label, fingerprint)?;
        }
        if self.namespace_fingerprint != self.compute_fingerprint()? {
            return contract_error(
                "cache namespace fingerprint does not match TCV1 content".to_string(),
            );
        }
        Ok(())
    }

    pub fn validate_for_identity(&self, identity: &TrainingDataIdentity) -> Result<()> {
        self.validate()?;
        identity.validate()?;
        if self.data_requirement_key != identity.requirement_key
            || self.data_identity_fingerprint != identity.identity_fingerprint
        {
            return contract_error(
                "cache namespace does not bind the complete training data identity".to_string(),
            );
        }
        Ok(())
    }
}

/// A resolved W0 OutputBinding with native port validation.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OutputBinding {
    pub schema_version: u32,
    pub binding_id: String,
    pub node_id: NodeId,
    pub port_name: String,
    pub prediction_level: PredictionLevel,
    #[serde(default)]
    pub unit_level: Option<EntityUnitLevel>,
    pub prediction_kind: PredictionKind,
    pub prediction_source: PredictionSource,
    #[serde(default)]
    pub refit_strategy: Option<RefitStrategy>,
    pub aggregation_fingerprint: String,
    pub target_names: Vec<String>,
    pub target_units: Vec<Option<String>>,
    pub class_labels: Vec<Vec<String>>,
    pub output_order: OutputOrder,
    pub target_space: String,
    pub binding_fingerprint: String,
}

impl OutputBinding {
    pub fn compute_fingerprint(&self) -> Result<String> {
        tcv1_fingerprint_without(self, "binding_fingerprint", "output binding")
    }

    pub fn validate(&self, graph: &GraphSpec) -> Result<()> {
        if self.schema_version != OUTPUT_BINDING_SCHEMA_VERSION {
            return unsupported_version(
                "output binding",
                self.schema_version,
                OUTPUT_BINDING_SCHEMA_VERSION,
            );
        }
        validate_identifier_text("output binding_id", &self.binding_id)?;
        validate_non_empty("output binding port_name", &self.port_name)?;
        validate_sha256("output aggregation", &self.aggregation_fingerprint)?;
        validate_sha256("output binding", &self.binding_fingerprint)?;
        validate_output_unit_level(self.prediction_level, self.unit_level)?;
        validate_output_shape(
            self.prediction_kind,
            self.output_order,
            &self.target_names,
            &self.target_units,
            &self.class_labels,
            &self.target_space,
        )?;
        match (self.prediction_source, self.refit_strategy) {
            (PredictionSource::FinalRefit, None) => {
                return contract_error(
                    "final_refit output binding requires refit_strategy".to_string(),
                );
            }
            (PredictionSource::CvEnsemble | PredictionSource::FoldMember, Some(_)) => {
                return contract_error(
                    "non-final output binding forbids refit_strategy".to_string(),
                );
            }
            _ => {}
        }
        let request = TrainingOutputRequest {
            output_id: self.binding_id.clone(),
            node_id: self.node_id.clone(),
            port_name: Some(self.port_name.clone()),
            prediction_level: self.prediction_level,
            unit_level: self.unit_level,
            prediction_kind: self.prediction_kind,
            target_names: self.target_names.clone(),
            target_units: self.target_units.clone(),
            class_labels: self.class_labels.clone(),
            output_order: self.output_order,
            target_space: self.target_space.clone(),
        };
        request.resolve(graph)?;
        if self.binding_fingerprint != self.compute_fingerprint()? {
            return contract_error(
                "output binding fingerprint does not match TCV1 content".to_string(),
            );
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PredictorTemplate {
    pub graph: GraphSpec,
    pub campaign: CampaignSpec,
    pub controller_manifests: BTreeMap<crate::ids::ControllerId, ControllerManifest>,
    pub template_fingerprint: String,
}

impl PredictorTemplate {
    pub fn compute_fingerprint(&self) -> Result<String> {
        tcv1_fingerprint_without(self, "template_fingerprint", "predictor template")
    }

    pub fn validate(&self) -> Result<()> {
        self.graph.validate()?;
        self.campaign.validate()?;
        for (controller_id, manifest) in &self.controller_manifests {
            if controller_id != &manifest.controller_id {
                return contract_error(format!(
                    "predictor template controller key `{controller_id}` does not match manifest `{}`",
                    manifest.controller_id
                ));
            }
            manifest.validate()?;
        }
        validate_sha256("predictor template", &self.template_fingerprint)?;
        if self.template_fingerprint != self.compute_fingerprint()? {
            return contract_error(
                "predictor template fingerprint does not match TCV1 content".to_string(),
            );
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrainingOutcomeRef {
    pub outcome_id: String,
    pub outcome_fingerprint: String,
    /// Non-recursive source identity for outcome-owned conformal state. It is
    /// absent before calibration and retains the exact calibration-free
    /// TrainingOutcome fingerprint after attachment.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pre_conformal_outcome_fingerprint: Option<String>,
    pub training_request_fingerprint: String,
    pub effective_plan_fingerprint: String,
    pub execution_bundle_id: BundleId,
    pub execution_bundle_fingerprint: String,
    pub output_binding_fingerprints: Vec<String>,
    pub training_influence_fingerprint: String,
    pub data_identities_fingerprint: String,
}

impl TrainingOutcomeRef {
    pub(crate) fn validate(&self) -> Result<()> {
        validate_identifier_text("training outcome_id", &self.outcome_id)?;
        for (label, fingerprint) in [
            ("training outcome", &self.outcome_fingerprint),
            (
                "training outcome request",
                &self.training_request_fingerprint,
            ),
            (
                "training outcome effective plan",
                &self.effective_plan_fingerprint,
            ),
            (
                "training outcome influence",
                &self.training_influence_fingerprint,
            ),
            (
                "training outcome execution bundle",
                &self.execution_bundle_fingerprint,
            ),
            (
                "training outcome data identities",
                &self.data_identities_fingerprint,
            ),
        ] {
            validate_sha256(label, fingerprint)?;
        }
        if let Some(fingerprint) = &self.pre_conformal_outcome_fingerprint {
            validate_sha256("pre-conformal training outcome", fingerprint)?;
        }
        if self.output_binding_fingerprints.is_empty() {
            return contract_error(
                "training outcome reference requires output binding fingerprints".to_string(),
            );
        }
        for fingerprint in &self.output_binding_fingerprints {
            validate_sha256("training outcome output binding", fingerprint)?;
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactLoadMode {
    NativePortable,
    HostSidecar,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PackageArtifactBinding {
    pub artifact_id: ArtifactId,
    pub load_mode: ArtifactLoadMode,
}

/// The only retrain mode currently representable by the portable archive
/// boundary.  `Transfer` and `Finetune` are explicit values so a future wire
/// cannot accidentally be interpreted as `Full` by an older caller.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PortableRefitMode {
    Full,
    Transfer,
    Finetune,
}

/// One exact controller attestation in a Package V3 full-refit recipe.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PortableRefitController {
    pub node_id: NodeId,
    pub controller_id: ControllerId,
    pub controller_version: String,
    pub manifest_fingerprint: String,
    pub capabilities: BTreeSet<ControllerCapability>,
}

impl PortableRefitController {
    fn validate(&self) -> Result<()> {
        validate_identifier_text("portable refit controller node_id", self.node_id.as_str())?;
        validate_identifier_text(
            "portable refit controller controller_id",
            self.controller_id.as_str(),
        )?;
        validate_non_empty(
            "portable refit controller controller_version",
            &self.controller_version,
        )?;
        validate_sha256(
            "portable refit controller manifest",
            &self.manifest_fingerprint,
        )?;
        if !self
            .capabilities
            .contains(&ControllerCapability::SupportsPortableFullRefit)
        {
            return contract_error(format!(
                "portable refit controller `{}` is missing supports_portable_full_refit",
                self.controller_id
            ));
        }
        Ok(())
    }
}

/// Closed, DAG-ML-owned evidence required to create an Archive/Package V3
/// full-refit descendant.  It deliberately contains no cohort data and no
/// fitted handle: the target-bound cohort and new artifacts belong to the
/// subsequent V3 operation.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PortableRefitRecipe {
    pub schema_version: u32,
    pub recipe_id: String,
    pub mode: PortableRefitMode,
    pub parent_package_fingerprint: String,
    pub parent_outcome: TrainingOutcomeRef,
    pub effective_plan_fingerprint: String,
    pub selected_variant_id: VariantId,
    pub selected_variant_fingerprint: String,
    pub selected_parameter_projection_fingerprint: String,
    pub target_binding_fingerprints: Vec<String>,
    pub target_schema_fingerprint: String,
    pub controllers: Vec<PortableRefitController>,
    pub recipe_fingerprint: String,
}

impl PortableRefitRecipe {
    pub fn compute_fingerprint(&self) -> Result<String> {
        tcv1_fingerprint_without(self, "recipe_fingerprint", "portable refit recipe")
    }

    pub fn from_json(json: &str) -> Result<Self> {
        let raw_fingerprint =
            strict_tcv1_fingerprint_without(json, "recipe_fingerprint", "portable refit recipe")?;
        let recipe: Self = serde_json::from_str(json)?;
        if recipe.recipe_fingerprint != raw_fingerprint {
            return contract_error(
                "portable refit recipe fingerprint does not match original TCV1 JSON".to_string(),
            );
        }
        recipe.validate()?;
        Ok(recipe)
    }

    pub fn validate(&self) -> Result<()> {
        if self.schema_version != PORTABLE_REFIT_RECIPE_SCHEMA_VERSION {
            return unsupported_version(
                "portable refit recipe",
                self.schema_version,
                PORTABLE_REFIT_RECIPE_SCHEMA_VERSION,
            );
        }
        if self.mode != PortableRefitMode::Full {
            return contract_error(
                "portable refit recipe currently supports only full mode; transfer and finetune require separate controller contracts".to_string(),
            );
        }
        validate_identifier_text("portable refit recipe_id", &self.recipe_id)?;
        validate_sha256(
            "portable refit parent package",
            &self.parent_package_fingerprint,
        )?;
        self.parent_outcome.validate()?;
        for (label, fingerprint) in [
            (
                "portable refit effective plan",
                &self.effective_plan_fingerprint,
            ),
            (
                "portable refit selected variant",
                &self.selected_variant_fingerprint,
            ),
            (
                "portable refit selected parameter projection",
                &self.selected_parameter_projection_fingerprint,
            ),
            (
                "portable refit target schema",
                &self.target_schema_fingerprint,
            ),
            ("portable refit recipe", &self.recipe_fingerprint),
        ] {
            validate_sha256(label, fingerprint)?;
        }
        validate_identifier_text(
            "portable refit selected_variant_id",
            self.selected_variant_id.as_str(),
        )?;
        if self.target_binding_fingerprints.is_empty()
            || !self
                .target_binding_fingerprints
                .windows(2)
                .all(|pair| pair[0] < pair[1])
        {
            return contract_error(
                "portable refit target binding fingerprints must be non-empty, sorted, and unique"
                    .to_string(),
            );
        }
        for fingerprint in &self.target_binding_fingerprints {
            validate_sha256("portable refit target binding", fingerprint)?;
        }
        if self.controllers.is_empty()
            || !self
                .controllers
                .windows(2)
                .all(|pair| pair[0].node_id < pair[1].node_id)
        {
            return contract_error(
                "portable refit controllers must be non-empty and strictly sorted by node_id"
                    .to_string(),
            );
        }
        for controller in &self.controllers {
            controller.validate()?;
        }
        if self.recipe_fingerprint != self.compute_fingerprint()? {
            return contract_error(
                "portable refit recipe fingerprint does not match TCV1 content".to_string(),
            );
        }
        Ok(())
    }

    /// Derive a closed future-V3 full-refit recipe from a portable predictor
    /// package.  This does not execute a refit and intentionally does not
    /// make Package V2 retrainable: a V3 request still needs a fresh,
    /// target-bound cohort and its own scheduler entry point.
    pub fn derive_from_package(
        package: &PortablePredictorPackage,
        recipe_id: impl Into<String>,
    ) -> Result<Self> {
        package.validate()?;
        if package.fitted_artifact_mode != FittedArtifactMode::PortableRequired
            || package
                .artifact_bindings
                .iter()
                .any(|binding| binding.load_mode != ArtifactLoadMode::NativePortable)
        {
            return contract_error(
                "portable full refit requires a package with only native_portable artifacts"
                    .to_string(),
            );
        }
        let selected_variant_id = package
            .execution_bundle
            .selected_variant_id
            .clone()
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(
                    "portable full refit requires a selected package variant".to_string(),
                )
            })?;
        let selected_variant = package
            .effective_plan
            .variants
            .iter()
            .find(|variant| variant.variant_id == selected_variant_id)
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(
                    "portable full refit selected variant is absent from the effective plan"
                        .to_string(),
                )
            })?;
        let selected_parameters = package
            .effective_plan
            .node_plans
            .iter()
            .map(|(node_id, node)| (node_id.clone(), node.params.clone()))
            .collect::<BTreeMap<_, _>>();
        let selected_parameter_projection_fingerprint = tcv1_fingerprint(
            &(selected_variant.fingerprint.clone(), selected_parameters),
            "portable refit selected parameter projection",
        )?;
        let mut target_binding_fingerprints = package
            .output_bindings
            .iter()
            .map(|binding| binding.binding_fingerprint.clone())
            .collect::<Vec<_>>();
        target_binding_fingerprints.sort();
        if target_binding_fingerprints
            .windows(2)
            .any(|pair| pair[0] == pair[1])
        {
            return contract_error(
                "portable full refit package has duplicate output binding fingerprints".to_string(),
            );
        }
        let target_schema_fingerprint =
            tcv1_fingerprint(&package.output_bindings, "portable refit target schema")?;
        let mut controllers = Vec::with_capacity(package.predictor_node_ids.len());
        for node_id in &package.predictor_node_ids {
            let node = package.effective_plan.node_plans.get(node_id).ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "portable full refit predictor node `{node_id}` is absent from the effective plan"
                ))
            })?;
            let manifest = package
                .effective_plan
                .controller_manifests
                .get(&node.controller_id)
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation(format!(
                        "portable full refit node `{node_id}` has no controller manifest"
                    ))
                })?;
            if manifest.controller_id != node.controller_id
                || manifest.controller_version != node.controller_version
                || manifest.capabilities != node.controller_capabilities
            {
                return contract_error(format!(
                    "portable full refit node `{node_id}` does not exactly match its controller manifest"
                ));
            }
            controllers.push(PortableRefitController {
                node_id: node_id.clone(),
                controller_id: node.controller_id.clone(),
                controller_version: node.controller_version.clone(),
                manifest_fingerprint: tcv1_fingerprint(
                    manifest,
                    "portable refit controller manifest",
                )?,
                capabilities: node.controller_capabilities.clone(),
            });
        }
        controllers.sort_by(|left, right| left.node_id.cmp(&right.node_id));
        let mut recipe = Self {
            schema_version: PORTABLE_REFIT_RECIPE_SCHEMA_VERSION,
            recipe_id: recipe_id.into(),
            mode: PortableRefitMode::Full,
            parent_package_fingerprint: package.package_fingerprint.clone(),
            parent_outcome: package.training_outcome.clone(),
            effective_plan_fingerprint: package.training_outcome.effective_plan_fingerprint.clone(),
            selected_variant_id,
            selected_variant_fingerprint: selected_variant.fingerprint.clone(),
            selected_parameter_projection_fingerprint,
            target_binding_fingerprints,
            target_schema_fingerprint,
            controllers,
            recipe_fingerprint: zero_fingerprint(),
        };
        recipe.recipe_fingerprint = recipe.compute_fingerprint()?;
        recipe.validate()?;
        Ok(recipe)
    }

    /// Refuse a recipe unless it is the exact deterministic projection of its
    /// source package.  Future Archive V3 executors call this before they ask
    /// a provider for a target cohort, so an attacker cannot transplant a
    /// valid recipe onto another package by re-signing only the outer object.
    pub fn validate_against_source_package(
        &self,
        package: &PortablePredictorPackage,
    ) -> Result<()> {
        self.validate()?;
        let expected = Self::derive_from_package(package, self.recipe_id.clone())?;
        if self != &expected {
            return contract_error(
                "portable refit recipe does not exactly match its source package".to_string(),
            );
        }
        Ok(())
    }
}

/// New-cohort evidence carried by a future V3 outcome and execution bundle.
/// It is intentionally separate from [`PortableRefitRecipe`]: the recipe
/// identifies the immutable parent, while this record proves the child did
/// not reuse the parent's training request, identity set, or influence state.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PortableRefitProvenance {
    pub schema_version: u32,
    pub parent_recipe_id: String,
    pub parent_recipe_fingerprint: String,
    pub parent_package_fingerprint: String,
    pub parent_outcome: TrainingOutcomeRef,
    pub target_training_request_fingerprint: String,
    pub target_data_identities_fingerprint: String,
    pub target_training_influence_fingerprint: String,
    pub target_relation_fingerprint: String,
    pub provenance_fingerprint: String,
}

impl PortableRefitProvenance {
    pub fn compute_fingerprint(&self) -> Result<String> {
        tcv1_fingerprint_without(self, "provenance_fingerprint", "portable refit provenance")
    }

    pub fn from_target_cohort(
        recipe: &PortableRefitRecipe,
        target_training_request_fingerprint: String,
        data_identities: &[TrainingDataIdentity],
        training_influence: &TrainingInfluenceManifest,
    ) -> Result<Self> {
        recipe.validate()?;
        if data_identities.is_empty()
            || !data_identities
                .windows(2)
                .all(|pair| pair[0].requirement_key < pair[1].requirement_key)
        {
            return contract_error(
                "portable refit target data identities must be non-empty and strictly sorted"
                    .to_string(),
            );
        }
        for identity in data_identities {
            identity.validate()?;
        }
        training_influence.validate()?;
        let target_data_identities_fingerprint =
            tcv1_fingerprint(data_identities, "portable refit target data identities")?;
        let target_relation_fingerprint = training_influence.relation_fingerprint.clone();
        if data_identities
            .iter()
            .any(|identity| identity.relation_fingerprint != target_relation_fingerprint)
        {
            return contract_error(
                "portable refit target data identities do not exactly bind target influence relations"
                    .to_string(),
            );
        }
        if target_training_request_fingerprint == recipe.parent_outcome.training_request_fingerprint
            || target_data_identities_fingerprint
                == recipe.parent_outcome.data_identities_fingerprint
        {
            return contract_error(
                "portable refit target cohort must not reuse the parent training request or data identities"
                    .to_string(),
            );
        }
        let mut provenance = Self {
            schema_version: PORTABLE_REFIT_PROVENANCE_SCHEMA_VERSION,
            parent_recipe_id: recipe.recipe_id.clone(),
            parent_recipe_fingerprint: recipe.recipe_fingerprint.clone(),
            parent_package_fingerprint: recipe.parent_package_fingerprint.clone(),
            parent_outcome: recipe.parent_outcome.clone(),
            target_training_request_fingerprint,
            target_data_identities_fingerprint,
            target_training_influence_fingerprint: training_influence.manifest_fingerprint.clone(),
            target_relation_fingerprint,
            provenance_fingerprint: zero_fingerprint(),
        };
        provenance.provenance_fingerprint = provenance.compute_fingerprint()?;
        provenance.validate_against_recipe(recipe)?;
        Ok(provenance)
    }

    /// Parse target-cohort provenance only in the presence of its already
    /// attested parent recipe.  A standalone parser would make the parent
    /// fields self-attested and is therefore intentionally not exposed.
    pub fn from_json_for_recipe(json: &str, recipe: &PortableRefitRecipe) -> Result<Self> {
        let raw_fingerprint = strict_tcv1_fingerprint_without(
            json,
            "provenance_fingerprint",
            "portable refit provenance",
        )?;
        let provenance: Self = serde_json::from_str(json)?;
        if provenance.provenance_fingerprint != raw_fingerprint {
            return contract_error(
                "portable refit provenance fingerprint does not match original TCV1 JSON"
                    .to_string(),
            );
        }
        provenance.validate_against_recipe(recipe)?;
        Ok(provenance)
    }

    pub fn validate_against_recipe(&self, recipe: &PortableRefitRecipe) -> Result<()> {
        if self.schema_version != PORTABLE_REFIT_PROVENANCE_SCHEMA_VERSION {
            return unsupported_version(
                "portable refit provenance",
                self.schema_version,
                PORTABLE_REFIT_PROVENANCE_SCHEMA_VERSION,
            );
        }
        recipe.validate()?;
        self.parent_outcome.validate()?;
        validate_identifier_text("portable refit parent recipe_id", &self.parent_recipe_id)?;
        for (label, fingerprint) in [
            (
                "portable refit parent recipe",
                &self.parent_recipe_fingerprint,
            ),
            (
                "portable refit parent package",
                &self.parent_package_fingerprint,
            ),
            (
                "portable refit target training request",
                &self.target_training_request_fingerprint,
            ),
            (
                "portable refit target data identities",
                &self.target_data_identities_fingerprint,
            ),
            (
                "portable refit target training influence",
                &self.target_training_influence_fingerprint,
            ),
            (
                "portable refit target relation",
                &self.target_relation_fingerprint,
            ),
            ("portable refit provenance", &self.provenance_fingerprint),
        ] {
            validate_sha256(label, fingerprint)?;
        }
        if self.parent_recipe_id != recipe.recipe_id
            || self.parent_recipe_fingerprint != recipe.recipe_fingerprint
            || self.parent_package_fingerprint != recipe.parent_package_fingerprint
            || self.parent_outcome != recipe.parent_outcome
        {
            return contract_error(
                "portable refit provenance does not exactly bind its parent recipe".to_string(),
            );
        }
        if self.target_training_request_fingerprint
            == recipe.parent_outcome.training_request_fingerprint
            || self.target_data_identities_fingerprint
                == recipe.parent_outcome.data_identities_fingerprint
        {
            return contract_error(
                "portable refit provenance reuses parent training evidence".to_string(),
            );
        }
        if self.provenance_fingerprint != self.compute_fingerprint()? {
            return contract_error(
                "portable refit provenance fingerprint does not match TCV1 content".to_string(),
            );
        }
        Ok(())
    }
}

/// Portable deployment package. It contains only JSON-safe contracts and
/// artifact descriptors; process-local handles live exclusively in
/// [`LoadedPredictor`].
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PortablePredictorPackage {
    pub schema_version: u32,
    pub package_id: String,
    pub template: PredictorTemplate,
    pub training_request_fingerprint: String,
    pub training_outcome: TrainingOutcomeRef,
    pub effective_plan: ExecutionPlan,
    pub execution_bundle: ExecutionBundle,
    /// Complete native calibration state for standalone package replay.  The
    /// nested execution bundle carries the matching typed reference.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conformal_calibration: Option<ConformalCalibration>,
    /// Complete pre-calibration PREDICT replay evidence retained by V2.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conformal_calibration_replay: Option<TrainingReplayOutcome>,
    pub output_bindings: Vec<OutputBinding>,
    pub predictor_node_ids: Vec<NodeId>,
    pub training_influence: TrainingInfluenceManifest,
    pub data_identities: Vec<TrainingDataIdentity>,
    pub fitted_artifact_mode: FittedArtifactMode,
    pub artifact_bindings: Vec<PackageArtifactBinding>,
    pub package_fingerprint: String,
}

impl PortablePredictorPackage {
    pub fn compute_fingerprint(&self) -> Result<String> {
        tcv1_fingerprint_without(self, "package_fingerprint", "portable predictor package")
    }

    pub fn from_json(json: &str) -> Result<Self> {
        let raw_fingerprint = strict_tcv1_fingerprint_without(
            json,
            "package_fingerprint",
            "portable predictor package",
        )?;
        let package: Self = serde_json::from_str(json)?;
        if package.package_fingerprint != raw_fingerprint {
            return contract_error(
                "portable predictor package fingerprint does not match original TCV1 JSON"
                    .to_string(),
            );
        }
        package.validate()?;
        Ok(package)
    }

    pub fn validate(&self) -> Result<()> {
        if self.schema_version < MIN_READABLE_PORTABLE_PREDICTOR_PACKAGE_SCHEMA_VERSION
            || self.schema_version > PORTABLE_PREDICTOR_PACKAGE_SCHEMA_VERSION
        {
            return unsupported_version(
                "portable predictor package",
                self.schema_version,
                PORTABLE_PREDICTOR_PACKAGE_SCHEMA_VERSION,
            );
        }
        if self.schema_version == LEGACY_PORTABLE_PREDICTOR_PACKAGE_SCHEMA_VERSION
            && (self.conformal_calibration.is_some() || self.conformal_calibration_replay.is_some())
        {
            return contract_error(
                "portable predictor package V1 cannot carry conformal state; migrate to a published V2 package schema".to_string(),
            );
        }
        validate_identifier_text("portable predictor package_id", &self.package_id)?;
        validate_sha256(
            "portable predictor training request",
            &self.training_request_fingerprint,
        )?;
        validate_sha256("portable predictor package", &self.package_fingerprint)?;
        self.training_outcome.validate()?;
        if self.training_request_fingerprint != self.training_outcome.training_request_fingerprint {
            return contract_error(
                "portable predictor request fingerprint is not cross-linked by outcome reference"
                    .to_string(),
            );
        }
        self.template.validate()?;
        self.effective_plan.validate()?;
        if self.template.graph != self.effective_plan.graph_plan.graph
            || self.template.campaign != self.effective_plan.campaign
            || self.template.controller_manifests != self.effective_plan.controller_manifests
        {
            return contract_error(
                "portable predictor template does not exactly match effective plan".to_string(),
            );
        }
        self.execution_bundle
            .validate_against_plan(&self.effective_plan)?;
        if self.schema_version == PORTABLE_PREDICTOR_PACKAGE_SCHEMA_VERSION
            && self.execution_bundle.schema_version
                != crate::bundle::EXECUTION_BUNDLE_SCHEMA_VERSION
        {
            return contract_error(
                "portable predictor package V2 requires an execution bundle V2".to_string(),
            );
        }
        match (
            &self.conformal_calibration,
            &self.conformal_calibration_replay,
            &self.execution_bundle.conformal_calibration,
        ) {
            (Some(calibration), Some(replay), Some(reference)) => {
                reference.validate_against(calibration)?;
                calibration.validate()?;
                replay.validate()?;
                let binding = self
                    .output_bindings
                    .iter()
                    .find(|binding| binding.binding_id == calibration.binding_id)
                    .ok_or_else(|| {
                        DagMlError::RuntimeValidation(
                            "portable predictor conformal binding is absent".to_string(),
                        )
                    })?;
                let fold_set = self.effective_plan.fold_set.as_ref().ok_or_else(|| {
                    DagMlError::RuntimeValidation(
                        "portable predictor conformal calibration requires FoldSet".to_string(),
                    )
                })?;
                let context = &calibration.context;
                let mut pre_conformal_bundle = self.execution_bundle.clone();
                pre_conformal_bundle.conformal_calibration = None;
                let pre_conformal_outcome_fingerprint = self
                    .training_outcome
                    .pre_conformal_outcome_fingerprint
                    .as_ref()
                    .ok_or_else(|| {
                        DagMlError::RuntimeValidation(
                            "portable predictor conformal state has no pre-conformal source anchor"
                                .to_string(),
                        )
                    })?;
                let expected_replay_source = TrainingOutcomeRef {
                    outcome_id: self.training_outcome.outcome_id.clone(),
                    outcome_fingerprint: pre_conformal_outcome_fingerprint.clone(),
                    pre_conformal_outcome_fingerprint: None,
                    training_request_fingerprint: self
                        .training_outcome
                        .training_request_fingerprint
                        .clone(),
                    effective_plan_fingerprint: self
                        .training_outcome
                        .effective_plan_fingerprint
                        .clone(),
                    execution_bundle_id: self.training_outcome.execution_bundle_id.clone(),
                    execution_bundle_fingerprint: tcv1_fingerprint(
                        &pre_conformal_bundle,
                        "portable predictor pre-conformal execution bundle",
                    )?,
                    output_binding_fingerprints: self
                        .training_outcome
                        .output_binding_fingerprints
                        .clone(),
                    training_influence_fingerprint: self
                        .training_outcome
                        .training_influence_fingerprint
                        .clone(),
                    data_identities_fingerprint: self
                        .training_outcome
                        .data_identities_fingerprint
                        .clone(),
                };
                let replay_request = replay_request_from_outcome(replay);
                replay_request.validate()?;
                if context.predictor_binding_fingerprint != binding.binding_fingerprint
                    || self
                        .training_outcome
                        .pre_conformal_outcome_fingerprint
                        .as_deref()
                        != Some(context.source_training_outcome_fingerprint.as_str())
                    || context.data_identities_fingerprint
                        != self.training_outcome.data_identities_fingerprint
                    || context.training_influence_fingerprint
                        != self.training_influence.manifest_fingerprint
                    || context.fold_set_fingerprint != fold_set_fingerprint(fold_set)?
                    || context.calibration_replay_outcome_fingerprint != replay.outcome_fingerprint
                    || replay.source_training_outcome != expected_replay_source
                    || replay_request.source_outcome_fingerprint
                        != *pre_conformal_outcome_fingerprint
                    || replay.replay_request_id != replay_request.request_id
                    || replay.phase != Phase::Predict
                    || replay.bundle_id != self.execution_bundle.bundle_id
                    || replay.plan_id != self.effective_plan.id
                {
                    return contract_error("portable predictor conformal context does not exactly cross-link package provenance".to_string());
                }
                if context.relation_fingerprint == self.training_influence.relation_fingerprint {
                    return contract_error(
                        "portable predictor calibration relation authority must be distinct from development relations"
                            .to_string(),
                    );
                }
                let package_bindings = self
                    .output_bindings
                    .iter()
                    .map(|binding| (binding.binding_id.as_str(), binding))
                    .collect::<BTreeMap<_, _>>();
                for replay_output in &replay.outputs {
                    let package_binding = package_bindings
                        .get(replay_output.binding.binding_id.as_str())
                        .ok_or_else(|| {
                            DagMlError::RuntimeValidation(
                                "portable predictor calibration replay contains an output binding absent from the package"
                                    .to_string(),
                            )
                        })?;
                    if &replay_output.binding != *package_binding {
                        return contract_error(
                            "portable predictor calibration replay output binding does not exactly match the package"
                                .to_string(),
                        );
                    }
                    replay_output.validate(&self.effective_plan)?;
                }
                let replay_output = replay
                    .outputs
                    .iter()
                    .find(|output| output.binding.binding_id == calibration.binding_id)
                    .ok_or_else(|| {
                        DagMlError::RuntimeValidation(
                            "portable predictor calibration replay is missing its selected binding"
                                .to_string(),
                        )
                    })?;
                let [point] = replay_output.predictions.as_slice() else {
                    return contract_error(
                        "portable predictor calibration replay requires exactly one selected point block"
                            .to_string(),
                    );
                };
                if replay_output.binding != *binding
                    || point.sample_ids != calibration.sample_ids
                    || point.sample_ids != context.calibration_cohort.physical_sample_ids
                    || !replay.conformal_intervals.is_empty()
                    || replay.input_data_identities.iter().any(|identity| {
                        identity.relation_fingerprint != context.relation_fingerprint
                    })
                {
                    return contract_error(
                        "portable predictor calibration replay evidence does not match its selected binding, samples, or relation authority"
                            .to_string(),
                    );
                }
                let training_ids = self
                    .training_influence
                    .entries
                    .iter()
                    .flat_map(|entry| {
                        entry
                            .physical_sample_ids
                            .iter()
                            .chain(entry.origin_sample_ids.iter())
                    })
                    .collect::<BTreeSet<_>>();
                if context
                    .calibration_cohort
                    .physical_sample_ids
                    .iter()
                    .chain(context.calibration_cohort.origin_sample_ids.iter())
                    .any(|sample_id| training_ids.contains(sample_id))
                {
                    return contract_error(
                        "portable predictor calibration cohort overlaps training influence closure"
                            .to_string(),
                    );
                }
            }
            (None, None, None) => {
                if self
                    .training_outcome
                    .pre_conformal_outcome_fingerprint
                    .is_some()
                {
                    return contract_error(
                        "portable predictor pre-conformal source requires conformal state"
                            .to_string(),
                    );
                }
            }
            _ => {
                return contract_error(
                    "portable predictor package and execution bundle conformal state disagree"
                        .to_string(),
                )
            }
        }
        let effective_plan_fingerprint =
            tcv1_fingerprint(&self.effective_plan, "portable predictor effective plan")?;
        if effective_plan_fingerprint != self.training_outcome.effective_plan_fingerprint {
            return contract_error(
                "portable predictor effective plan fingerprint is not cross-linked by outcome reference"
                    .to_string(),
            );
        }
        if self.execution_bundle.bundle_id != self.training_outcome.execution_bundle_id {
            return contract_error(
                "portable predictor bundle id is not cross-linked by outcome reference".to_string(),
            );
        }
        let execution_bundle_fingerprint = tcv1_fingerprint(
            &self.execution_bundle,
            "portable predictor execution bundle",
        )?;
        if execution_bundle_fingerprint != self.training_outcome.execution_bundle_fingerprint {
            return contract_error(
                "portable predictor execution bundle content is not cross-linked by outcome reference"
                    .to_string(),
            );
        }
        self.training_influence.validate()?;
        if self.training_influence.manifest_fingerprint
            != self.training_outcome.training_influence_fingerprint
        {
            return contract_error(
                "portable predictor influence is not cross-linked by outcome reference".to_string(),
            );
        }
        if self.output_bindings.is_empty() {
            return contract_error(
                "portable predictor package requires at least one output binding".to_string(),
            );
        }
        let mut previous_binding: Option<&str> = None;
        let mut output_nodes = Vec::new();
        let mut coordinates = BTreeSet::new();
        for binding in &self.output_bindings {
            if previous_binding.is_some_and(|previous| previous >= binding.binding_id.as_str()) {
                return contract_error(
                    "portable predictor output bindings must be sorted by binding_id".to_string(),
                );
            }
            previous_binding = Some(binding.binding_id.as_str());
            binding.validate(&self.effective_plan.graph_plan.graph)?;
            if !coordinates.insert((binding.node_id.clone(), binding.port_name.clone())) {
                return contract_error(format!(
                    "portable predictor binds `{}.{}` more than once",
                    binding.node_id, binding.port_name
                ));
            }
            if binding.prediction_source == PredictionSource::FinalRefit
                && self.execution_bundle.refit_artifacts.is_empty()
            {
                return contract_error(
                    "final_refit output binding requires refit artifacts".to_string(),
                );
            }
            output_nodes.push(&binding.node_id);
        }
        if self
            .output_bindings
            .iter()
            .map(|binding| binding.binding_fingerprint.clone())
            .collect::<Vec<_>>()
            != self.training_outcome.output_binding_fingerprints
        {
            return contract_error(
                "portable predictor output bindings are not cross-linked by outcome reference"
                    .to_string(),
            );
        }
        let expected_closure = predictor_closure(&self.effective_plan, output_nodes)?;
        validate_sorted_unique_ids(
            "portable predictor_node_ids",
            &self.predictor_node_ids,
            true,
        )?;
        if self
            .predictor_node_ids
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>()
            != expected_closure
        {
            return contract_error(
                "portable predictor_node_ids do not exactly match output closure".to_string(),
            );
        }
        if self.training_influence.entries.iter().any(|entry| {
            entry
                .node_id
                .as_ref()
                .is_some_and(|node_id| !expected_closure.contains(node_id))
        }) {
            return contract_error(
                "portable predictor influence references a node outside predictor closure"
                    .to_string(),
            );
        }
        validate_package_base_influence(
            &self.training_influence,
            &self.effective_plan,
            &expected_closure,
        )?;
        validate_package_data_identities(self)?;
        let data_identities_fingerprint =
            tcv1_fingerprint(&self.data_identities, "portable predictor data identities")?;
        if data_identities_fingerprint != self.training_outcome.data_identities_fingerprint {
            return contract_error(
                "portable predictor data identity content is not cross-linked by outcome reference"
                    .to_string(),
            );
        }
        if self.data_identities.iter().any(|identity| {
            identity.relation_fingerprint != self.training_influence.relation_fingerprint
        }) {
            return contract_error(
                "portable predictor data identities and training influence bind different relations"
                    .to_string(),
            );
        }
        validate_package_artifact_bindings(self)?;
        // A portable package is a deployable predictor, so it must independently
        // prove PREDICT replayability from its own plan/closure/retained artifacts
        // — never infer portability from a merely non-empty claimed phase set. An
        // outcome that only reaches REFIT (skipped refit) or has no honest replay
        // mode ([]) carries no full-training predictor and is refused here.
        if !crate::training_runtime::closure_predict_replayable(
            &self.effective_plan,
            &expected_closure,
            &self.execution_bundle,
        )? {
            return contract_error(
                "portable predictor package is not PREDICT-replayable: its predictor closure does not support PREDICT with self-contained retained artifacts".to_string(),
            );
        }
        let value = serde_json::to_value(self)?;
        if contains_runtime_handle(&value) {
            return contract_error(
                "portable predictor package must not contain runtime handles".to_string(),
            );
        }
        if self.package_fingerprint != self.compute_fingerprint()? {
            return contract_error(
                "portable predictor package fingerprint does not match TCV1 content".to_string(),
            );
        }
        Ok(())
    }

    pub fn load_with<H>(
        self,
        mut resolver: impl FnMut(&RefitArtifactRecord) -> Result<H>,
    ) -> Result<LoadedPredictor<H>> {
        self.validate()?;
        let mut artifacts = BTreeMap::new();
        let sidecar_ids = self
            .artifact_bindings
            .iter()
            .filter(|binding| binding.load_mode == ArtifactLoadMode::HostSidecar)
            .map(|binding| &binding.artifact_id)
            .collect::<BTreeSet<_>>();
        for record in self
            .execution_bundle
            .refit_artifacts
            .iter()
            .filter(|record| sidecar_ids.contains(&record.artifact.id))
        {
            let handle = resolver(record)?;
            artifacts.insert(record.artifact.id.clone(), handle);
        }
        LoadedPredictor::new(self, artifacts)
    }
}

/// Process-local sidecar. It deliberately implements neither `Serialize` nor
/// `Deserialize`, so opaque host objects cannot leak into portable packages.
pub struct LoadedPredictor<H> {
    package: PortablePredictorPackage,
    artifacts: BTreeMap<ArtifactId, H>,
}

impl<H> LoadedPredictor<H> {
    pub fn new(
        package: PortablePredictorPackage,
        artifacts: BTreeMap<ArtifactId, H>,
    ) -> Result<Self> {
        package.validate()?;
        let expected = package
            .artifact_bindings
            .iter()
            .filter(|binding| binding.load_mode == ArtifactLoadMode::HostSidecar)
            .map(|binding| binding.artifact_id.clone())
            .collect::<BTreeSet<_>>();
        let actual = artifacts.keys().cloned().collect::<BTreeSet<_>>();
        if actual != expected {
            return contract_error(
                "loaded predictor sidecar artifacts do not exactly match package references"
                    .to_string(),
            );
        }
        Ok(Self { package, artifacts })
    }

    pub fn package(&self) -> &PortablePredictorPackage {
        &self.package
    }

    pub fn artifact(&self, artifact_id: &ArtifactId) -> Option<&H> {
        self.artifacts.get(artifact_id)
    }

    pub fn into_parts(self) -> (PortablePredictorPackage, BTreeMap<ArtifactId, H>) {
        (self.package, self.artifacts)
    }
}

fn validate_output_unit_level(
    prediction_level: PredictionLevel,
    unit_level: Option<EntityUnitLevel>,
) -> Result<()> {
    match prediction_level {
        PredictionLevel::Sample if unit_level != Some(EntityUnitLevel::PhysicalSample) => {
            contract_error("sample-level output requires unit_level=physical_sample".to_string())
        }
        PredictionLevel::Target | PredictionLevel::Group if unit_level.is_some() => {
            contract_error("target/group output requires unit_level=null".to_string())
        }
        _ => Ok(()),
    }
}

fn validate_output_shape(
    prediction_kind: PredictionKind,
    output_order: OutputOrder,
    target_names: &[String],
    target_units: &[Option<String>],
    class_labels: &[Vec<String>],
    target_space: &str,
) -> Result<()> {
    validate_non_empty("output target_space", target_space)?;
    validate_unique_text("output target_names", target_names, true)?;
    if target_units.len() != target_names.len() || class_labels.len() != target_names.len() {
        return contract_error(
            "output target_units and class_labels must have one entry per target".to_string(),
        );
    }
    for unit in target_units.iter().flatten() {
        validate_non_empty("output target unit", unit)?;
    }
    let class_output = prediction_kind == PredictionKind::ClassProbability;
    for labels in class_labels {
        validate_unique_text("output class labels", labels, class_output)?;
    }
    if prediction_kind == PredictionKind::RegressionPoint
        && class_labels.iter().any(|labels| !labels.is_empty())
    {
        return contract_error("regression output class label arrays must be empty".to_string());
    }
    match (prediction_kind, output_order) {
        (PredictionKind::ClassProbability, OutputOrder::TargetMajorClassMinor) => Ok(()),
        (PredictionKind::ClassProbability, _) => contract_error(
            "class_probability output requires target_major_class_minor order".to_string(),
        ),
        (_, OutputOrder::TargetOrder) => Ok(()),
        _ => contract_error("non-probability output requires target_order".to_string()),
    }
}

fn validate_canonical_patches(patches: &[ParameterPatch]) -> Result<()> {
    let mut previous: Option<(&NodeId, ParameterNamespace, &[String])> = None;
    for patch in patches {
        patch.validate()?;
        let key = (&patch.node_id, patch.namespace, patch.path.as_slice());
        if let Some(previous_key) = previous.as_ref() {
            if previous_key >= &key {
                return contract_error(
                    "parameter patches must be strictly sorted by (node_id, namespace, path)"
                        .to_string(),
                );
            }
            if previous_key.0 == key.0
                && previous_key.1 == key.1
                && (key.2.starts_with(previous_key.2) || previous_key.2.starts_with(key.2))
            {
                return contract_error(format!(
                    "parameter patches for `{}` contain a conflicting parent/child path",
                    patch.node_id
                ));
            }
        }
        previous = Some(key);
    }
    Ok(())
}

fn validate_patch_policies(
    plan: &ExecutionPlan,
    policies: &[NodePatchPolicy],
) -> Result<BTreeMap<NodeId, BTreeSet<ParameterNamespace>>> {
    let mut previous: Option<&NodeId> = None;
    let mut result = BTreeMap::new();
    for policy in policies {
        policy.validate()?;
        if previous.is_some_and(|previous| previous >= &policy.node_id) {
            return contract_error(
                "node patch policies must be strictly sorted by node_id".to_string(),
            );
        }
        previous = Some(&policy.node_id);
        if !plan.node_plans.contains_key(&policy.node_id) {
            return contract_error(format!(
                "node patch policy references unknown node `{}`",
                policy.node_id
            ));
        }
        result.insert(policy.node_id.clone(), policy.allowed_namespaces.clone());
    }
    Ok(result)
}

fn deep_set_object_key(
    root: &mut BTreeMap<String, serde_json::Value>,
    path: &[String],
    value: serde_json::Value,
    node_id: &NodeId,
) -> Result<()> {
    if path.len() == 1 {
        root.insert(path[0].clone(), value);
        return Ok(());
    }
    let first = root.get_mut(&path[0]).ok_or_else(|| {
        DagMlError::CampaignValidation(format!(
            "parameter patch for `{node_id}` is missing intermediate path `{}`",
            path[0]
        ))
    })?;
    let mut cursor = first;
    for segment in &path[1..path.len() - 1] {
        let object = cursor.as_object_mut().ok_or_else(|| {
            DagMlError::CampaignValidation(format!(
                "parameter patch for `{node_id}` crosses a scalar or array at `{segment}`"
            ))
        })?;
        cursor = object.get_mut(segment).ok_or_else(|| {
            DagMlError::CampaignValidation(format!(
                "parameter patch for `{node_id}` is missing intermediate path `{segment}`"
            ))
        })?;
    }
    let object = cursor.as_object_mut().ok_or_else(|| {
        DagMlError::CampaignValidation(format!(
            "parameter patch for `{node_id}` crosses a scalar or array before final key"
        ))
    })?;
    object.insert(path[path.len() - 1].clone(), value);
    Ok(())
}

fn predictor_closure<'a>(
    plan: &ExecutionPlan,
    roots: impl IntoIterator<Item = &'a NodeId>,
) -> Result<BTreeSet<NodeId>> {
    let mut pending = roots.into_iter().cloned().collect::<Vec<_>>();
    let mut closure = BTreeSet::new();
    while let Some(node_id) = pending.pop() {
        if !closure.insert(node_id.clone()) {
            continue;
        }
        let node = plan.node_plans.get(&node_id).ok_or_else(|| {
            DagMlError::CampaignValidation(format!(
                "predictor closure references unknown node `{node_id}`"
            ))
        })?;
        pending.extend(node.input_nodes.iter().cloned());
    }
    Ok(closure)
}

fn base_influence_kind(plan: &ExecutionPlan, node_id: &NodeId) -> Option<TrainingInfluenceKind> {
    let node_plan = &plan.node_plans[node_id];
    if matches!(
        node_plan.fit_scope,
        ControllerFitScope::Stateless | ControllerFitScope::InferenceOnly
    ) {
        return None;
    }
    let oof_consumers = plan
        .graph_plan
        .graph
        .edges
        .iter()
        .filter(|edge| edge.contract.requires_oof)
        .map(|edge| edge.target.node_id.clone())
        .collect::<BTreeSet<_>>();
    Some(
        if oof_consumers.contains(node_id)
            || node_plan
                .controller_capabilities
                .contains(&ControllerCapability::TrainsAggregation)
        {
            TrainingInfluenceKind::TrainedMetaAggregation
        } else if node_plan.kind == NodeKind::Model {
            TrainingInfluenceKind::ModelFit
        } else if node_plan.kind == NodeKind::Tuner {
            TrainingInfluenceKind::HpoSelection
        } else {
            TrainingInfluenceKind::TransformFit
        },
    )
}

fn capability_influence_kinds(
    plan: &ExecutionPlan,
    node_id: &NodeId,
) -> BTreeSet<TrainingInfluenceKind> {
    let capabilities = &plan.node_plans[node_id].controller_capabilities;
    let mut kinds = BTreeSet::new();
    if capabilities.contains(&ControllerCapability::PerformsInternalTuning)
        && base_influence_kind(plan, node_id) != Some(TrainingInfluenceKind::HpoSelection)
    {
        kinds.insert(TrainingInfluenceKind::HpoSelection);
    }
    if capabilities.contains(&ControllerCapability::UsesEarlyStopping) {
        kinds.insert(TrainingInfluenceKind::EarlyStopping);
    }
    if capabilities.contains(&ControllerCapability::UsesTrainingWeights) {
        kinds.insert(TrainingInfluenceKind::WeightingResampling);
    }
    kinds
}

fn expected_influence_coordinates(
    request: &TrainingRequest,
    plan: &ExecutionPlan,
    closure: &BTreeSet<NodeId>,
) -> Result<ExpectedInfluenceCoordinates> {
    let fold_set = plan.fold_set.as_ref().ok_or_else(|| {
        DagMlError::CampaignValidation(
            "training influence scopes require an explicit fold_set".to_string(),
        )
    })?;
    let all_samples = fold_set.sample_ids.iter().cloned().collect::<BTreeSet<_>>();
    let mut expected = BTreeMap::new();
    for node_id in closure {
        let node_plan = &plan.node_plans[node_id];
        let Some(base_kind) = base_influence_kind(plan, node_id) else {
            continue;
        };
        let mut scopes = Vec::<(String, BTreeSet<SampleId>)>::new();
        if node_plan.supported_phases.contains(&Phase::FitCv) {
            match node_plan.fit_scope {
                ControllerFitScope::FoldTrain => {
                    scopes.extend(fold_set.folds.iter().map(|fold| {
                        (
                            format!("fit_cv:{}", fold.fold_id),
                            fold.train_sample_ids.iter().cloned().collect(),
                        )
                    }));
                }
                ControllerFitScope::FullTrain => {
                    // ControllerManifest::validate rejects FullTrain + FIT_CV.
                    // Keep exhaustive all-sample accounting as defense in depth
                    // if a hand-built plan ever bypasses that invariant.
                    scopes.push(("fit_cv:full".to_string(), all_samples.clone()));
                }
                ControllerFitScope::Stateless | ControllerFitScope::InferenceOnly => {}
            }
        }
        if request.options.refit && node_plan.supported_phases.contains(&Phase::Refit) {
            scopes.push(("refit:full".to_string(), all_samples.clone()));
        }
        for (scope_id, samples) in scopes {
            expected.insert((base_kind, scope_id, Some(node_id.clone())), samples);
        }
    }
    for requirement in &request.influence_requirements {
        let key = (
            requirement.kind,
            requirement.scope_id.clone(),
            Some(requirement.node_id.clone()),
        );
        if expected
            .insert(
                key,
                requirement.physical_sample_ids.iter().cloned().collect(),
            )
            .is_some()
        {
            return contract_error(format!(
                "controller influence scope `{}` collides with a derived influence coordinate",
                requirement.scope_id
            ));
        }
    }
    expected.insert(
        (
            TrainingInfluenceKind::HpoSelection,
            format!("select:{}", request.options.selection.id),
            None,
        ),
        all_samples,
    );
    Ok(expected)
}

fn validate_influence_requirements(
    request: &TrainingRequest,
    plan: &ExecutionPlan,
    closure: &BTreeSet<NodeId>,
) -> Result<()> {
    let fold_set = plan.fold_set.as_ref().ok_or_else(|| {
        DagMlError::CampaignValidation(
            "controller influence requirements need an explicit fold_set".to_string(),
        )
    })?;
    let all_samples = fold_set.sample_ids.iter().cloned().collect::<BTreeSet<_>>();
    let mut expected_slots = BTreeMap::<InfluenceCapabilitySlot, BTreeSet<SampleId>>::new();
    for node_id in closure {
        let node_plan = &plan.node_plans[node_id];
        if base_influence_kind(plan, node_id).is_none() {
            continue;
        }
        let kinds = capability_influence_kinds(plan, node_id);
        if node_plan.supported_phases.contains(&Phase::FitCv) {
            match node_plan.fit_scope {
                ControllerFitScope::FoldTrain => {
                    for fold in &fold_set.folds {
                        for kind in &kinds {
                            expected_slots.insert(
                                (
                                    node_id.clone(),
                                    *kind,
                                    Phase::FitCv,
                                    Some(fold.fold_id.clone()),
                                ),
                                fold.train_sample_ids.iter().cloned().collect(),
                            );
                        }
                    }
                }
                ControllerFitScope::FullTrain => {
                    // Unreachable for a validated manifest (FullTrain cannot
                    // support FIT_CV), but never under-report influence if an
                    // invalid hand-built plan reaches this helper.
                    for kind in &kinds {
                        expected_slots.insert(
                            (node_id.clone(), *kind, Phase::FitCv, None),
                            all_samples.clone(),
                        );
                    }
                }
                ControllerFitScope::Stateless | ControllerFitScope::InferenceOnly => {}
            }
        }
        if request.options.refit && node_plan.supported_phases.contains(&Phase::Refit) {
            for kind in kinds {
                expected_slots.insert(
                    (node_id.clone(), kind, Phase::Refit, None),
                    all_samples.clone(),
                );
            }
        }
    }
    let mut actual_slots = BTreeSet::new();
    let mut previous: Option<(TrainingInfluenceKind, &str, &NodeId)> = None;
    for requirement in &request.influence_requirements {
        validate_identifier_text(
            "controller influence requirement scope_id",
            &requirement.scope_id,
        )?;
        validate_sorted_unique_ids(
            "controller influence requirement physical_sample_ids",
            &requirement.physical_sample_ids,
            true,
        )?;
        let key = (
            requirement.kind,
            requirement.scope_id.as_str(),
            &requirement.node_id,
        );
        if previous.as_ref().is_some_and(|previous| previous >= &key) {
            return contract_error(
                "controller influence requirements must be strictly sorted by (kind, scope_id, node_id)"
                    .to_string(),
            );
        }
        previous = Some(key);
        if !closure.contains(&requirement.node_id) {
            return contract_error(format!(
                "controller influence requirement node `{}` is outside predictor closure",
                requirement.node_id
            ));
        }
        if !matches!(requirement.phase, Phase::FitCv | Phase::Refit) {
            return contract_error(format!(
                "controller influence scope `{}` uses non-training phase {:?}",
                requirement.scope_id, requirement.phase
            ));
        }
        let slot = (
            requirement.node_id.clone(),
            requirement.kind,
            requirement.phase,
            requirement.fold_id.clone(),
        );
        let eligible_samples = expected_slots.get(&slot).ok_or_else(|| {
            DagMlError::CampaignValidation(format!(
                "controller influence scope `{}` is not required by active controller capabilities",
                requirement.scope_id
            ))
        })?;
        let actual_samples = requirement
            .physical_sample_ids
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>();
        if !actual_samples.is_subset(eligible_samples) {
            let outer_validation_overlap = requirement
                .fold_id
                .as_ref()
                .and_then(|fold_id| fold_set.folds.iter().find(|fold| &fold.fold_id == fold_id))
                .is_some_and(|fold| {
                    fold.validation_sample_ids
                        .iter()
                        .any(|sample_id| actual_samples.contains(sample_id))
                });
            if outer_validation_overlap {
                return contract_error(format!(
                    "controller influence scope `{}` leaks outer validation samples",
                    requirement.scope_id
                ));
            }
            return contract_error(format!(
                "controller influence scope `{}` uses samples outside its training cohort",
                requirement.scope_id
            ));
        }
        match requirement.kind {
            TrainingInfluenceKind::WeightingResampling if actual_samples != *eligible_samples => {
                return contract_error(format!(
                    "weighting influence scope `{}` must cover its complete fit cohort",
                    requirement.scope_id
                ));
            }
            TrainingInfluenceKind::EarlyStopping
                if actual_samples.len() >= eligible_samples.len() =>
            {
                return contract_error(format!(
                    "early-stopping influence scope `{}` must be a strict training-cohort subset",
                    requirement.scope_id
                ));
            }
            _ => {}
        }
        if !actual_slots.insert(slot) {
            return contract_error(format!(
                "controller influence capability slot is declared more than once at `{}`",
                requirement.scope_id
            ));
        }
    }
    if actual_slots != expected_slots.into_keys().collect::<BTreeSet<_>>() {
        return contract_error(
            "controller influence requirements do not exactly cover active capability scopes"
                .to_string(),
        );
    }
    Ok(())
}

fn validate_influence_identity_closure(
    entry: &TrainingInfluenceEntry,
    relations: &SampleRelationSet,
) -> Result<()> {
    let physical = entry.physical_sample_ids.iter().collect::<BTreeSet<_>>();
    let mut found = BTreeSet::new();
    let mut origins = BTreeSet::new();
    let mut groups = BTreeSet::new();
    for relation in &relations.records {
        if physical.contains(&relation.sample_id) {
            found.insert(&relation.sample_id);
            if let Some(origin) = &relation.origin_sample_id {
                origins.insert(origin.clone());
            }
            if let Some(group) = &relation.group_id {
                groups.insert(group.clone());
            }
        }
    }
    if found.len() != physical.len() {
        return contract_error(format!(
            "training influence `{}` contains physical samples absent from relation set",
            entry.scope_id
        ));
    }
    if entry
        .origin_sample_ids
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>()
        != origins
    {
        return contract_error(format!(
            "training influence `{}` origin closure does not match relation set",
            entry.scope_id
        ));
    }
    if entry.group_ids.iter().cloned().collect::<BTreeSet<_>>() != groups {
        return contract_error(format!(
            "training influence `{}` group closure does not match relation set",
            entry.scope_id
        ));
    }
    Ok(())
}

fn validate_output_controllers(
    plan: &ExecutionPlan,
    outputs: &[ResolvedTrainingOutput],
) -> Result<()> {
    for output in outputs {
        let node = &plan.node_plans[&output.node_id];
        if !node
            .controller_capabilities
            .contains(&ControllerCapability::EmitsPredictions)
        {
            return contract_error(format!(
                "training output node `{}` controller does not declare emits_predictions",
                output.node_id
            ));
        }
    }
    Ok(())
}

fn validate_selection_output(
    plan: &ExecutionPlan,
    options: &TrainingOptions,
    outputs: &[ResolvedTrainingOutput],
) -> Result<()> {
    let output = outputs
        .iter()
        .find(|output| output.output_id == options.selection_output_id)
        .expect("TrainingOptions::validate resolved selection_output_id");
    let node_plan = &plan.node_plans[&output.node_id];
    if !node_plan.supported_phases.contains(&Phase::FitCv) {
        return contract_error(format!(
            "training selection output `{}` is not scorable in FIT_CV",
            output.output_id
        ));
    }
    let graph_node = plan
        .graph_plan
        .graph
        .nodes
        .iter()
        .find(|node| node.id == output.node_id)
        .expect("execution plan output node exists in graph");
    let binds_declared_prediction_port = graph_node
        .ports
        .outputs
        .iter()
        .any(|port| port.kind == PortKind::Prediction && port.name == output.port_name);
    if !binds_declared_prediction_port {
        return contract_error(format!(
            "training selection output `{}` port `{}.{}` is not a declared prediction port",
            output.output_id, output.node_id, output.port_name
        ));
    }
    let campaign_metric_level = plan.campaign.aggregation_policy.selection_metric_level;
    if output.prediction_level != campaign_metric_level {
        return contract_error(format!(
            "training selection output `{}` prediction level does not match campaign selection_metric_level",
            output.output_id
        ));
    }
    if options
        .selection
        .required_metric_level
        .is_some_and(|level| level != campaign_metric_level)
    {
        return contract_error(format!(
            "training selection output `{}` prediction level does not match selection.required_metric_level",
            output.output_id
        ));
    }
    let metric_name = options.selection.metric.name.as_str();
    let objective = options.selection.metric.objective;
    crate::metrics::RegressionMetricKind::resolve_for_prediction_kind(
        metric_name,
        objective,
        output.prediction_kind,
    )?;
    Ok(())
}

fn validate_scheduler_capabilities(
    scheduler: &TrainingSchedulerOptions,
    plan: &ExecutionPlan,
    closure: &BTreeSet<NodeId>,
) -> Result<()> {
    let Some(backend) = scheduler.backend else {
        return Ok(());
    };
    for node_id in closure {
        let capabilities = &plan.node_plans[node_id].controller_capabilities;
        match backend {
            TrainingSchedulerBackend::Threads => {
                if !capabilities.contains(&ControllerCapability::ThreadSafe) {
                    return contract_error(format!(
                        "parallel thread scheduler requires thread_safe controller for `{node_id}`"
                    ));
                }
                if capabilities.contains(&ControllerCapability::NeedsPythonGil) {
                    return contract_error(format!(
                        "parallel thread scheduler refuses needs_python_gil controller for `{node_id}`"
                    ));
                }
            }
            TrainingSchedulerBackend::Processes => {
                if !capabilities.contains(&ControllerCapability::ProcessSafe) {
                    return contract_error(format!(
                        "parallel process scheduler requires process_safe controller for `{node_id}`"
                    ));
                }
            }
        }
    }
    Ok(())
}

fn validate_artifact_mode(
    artifacts: &TrainingArtifactOptions,
    plan: &ExecutionPlan,
    closure: &BTreeSet<NodeId>,
) -> Result<()> {
    if artifacts.fitted_artifacts != FittedArtifactMode::PortableRequired {
        return Ok(());
    }
    for node_id in closure {
        let node = &plan.node_plans[node_id];
        if node
            .controller_capabilities
            .contains(&ControllerCapability::EmitsArtifacts)
            && node.artifact_policy == ArtifactPolicy::HostOnly
        {
            return contract_error(format!(
                "portable_required training artifacts refuse host_only controller for `{node_id}`"
            ));
        }
    }
    Ok(())
}

fn validate_training_data_identities(
    request: &TrainingRequest,
    plan: &ExecutionPlan,
) -> Result<()> {
    let mut expected = BTreeMap::new();
    for binding in plan.campaign.data_bindings.values().flatten() {
        let key = data_binding_requirement_key(&binding.node_id, &binding.input_name);
        if let Some(previous) = expected.insert(key.clone(), binding) {
            let previous_coordinates = (&previous.node_id, previous.input_name.as_str());
            let coordinates = (&binding.node_id, binding.input_name.as_str());
            let detail = if previous_coordinates == coordinates {
                "duplicate coordinates"
            } else {
                "distinct coordinates collide under the V1 node.input spelling"
            };
            return contract_error(format!(
                "training data bindings render duplicate requirement key `{key}`: {detail}"
            ));
        }
    }
    let mut actual = BTreeMap::new();
    let mut previous: Option<&str> = None;
    for identity in &request.data_identities {
        identity.validate()?;
        if previous.is_some_and(|previous| previous >= identity.requirement_key.as_str()) {
            return contract_error(
                "training data identities must be strictly sorted by requirement_key".to_string(),
            );
        }
        previous = Some(identity.requirement_key.as_str());
        actual.insert(identity.requirement_key.as_str(), identity);
    }
    if actual.keys().copied().collect::<BTreeSet<_>>()
        != expected.keys().map(String::as_str).collect::<BTreeSet<_>>()
    {
        return contract_error(
            "training data identities must exactly cover campaign data bindings".to_string(),
        );
    }
    for (key, binding) in expected {
        let identity = actual[&key.as_str()];
        if identity.schema_fingerprint != binding.schema_fingerprint
            || identity.plan_fingerprint != binding.plan_fingerprint
            || binding.relation_fingerprint.as_deref()
                != Some(identity.relation_fingerprint.as_str())
        {
            return contract_error(format!(
                "training data identity `{key}` does not match data binding fingerprints"
            ));
        }
    }
    Ok(())
}

fn validate_package_data_identities(package: &PortablePredictorPackage) -> Result<()> {
    let expected = package
        .execution_bundle
        .data_requirements
        .iter()
        .map(|requirement| (requirement.key(), requirement))
        .collect::<BTreeMap<_, _>>();
    let mut actual = BTreeMap::new();
    let mut previous: Option<&str> = None;
    for identity in &package.data_identities {
        identity.validate()?;
        if previous.is_some_and(|previous| previous >= identity.requirement_key.as_str()) {
            return contract_error(
                "portable predictor data identities must be sorted by requirement_key".to_string(),
            );
        }
        previous = Some(identity.requirement_key.as_str());
        actual.insert(identity.requirement_key.clone(), identity);
    }
    if actual.keys().collect::<BTreeSet<_>>() != expected.keys().collect::<BTreeSet<_>>() {
        return contract_error(
            "portable predictor data identities do not exactly match bundle requirements"
                .to_string(),
        );
    }
    for (key, requirement) in expected {
        let identity = actual[&key];
        if identity.schema_fingerprint != requirement.schema_fingerprint
            || identity.plan_fingerprint != requirement.plan_fingerprint
            || requirement.relation_fingerprint.as_deref()
                != Some(identity.relation_fingerprint.as_str())
        {
            return contract_error(format!(
                "portable predictor data identity `{key}` does not match bundle fingerprints"
            ));
        }
    }
    Ok(())
}

fn influence_identity_closure_for_samples(
    scope_id: &str,
    samples: &BTreeSet<SampleId>,
    relations: &SampleRelationSet,
) -> Result<(Vec<SampleId>, Vec<GroupId>)> {
    let mut found = BTreeSet::new();
    let mut origins = BTreeSet::new();
    let mut groups = BTreeSet::new();
    for relation in &relations.records {
        if samples.contains(&relation.sample_id) {
            found.insert(&relation.sample_id);
            if let Some(origin) = &relation.origin_sample_id {
                origins.insert(origin.clone());
            }
            if let Some(group) = &relation.group_id {
                groups.insert(group.clone());
            }
        }
    }
    if found.len() != samples.len() {
        return contract_error(format!(
            "training influence `{scope_id}` contains physical samples absent from relation set"
        ));
    }
    Ok((origins.into_iter().collect(), groups.into_iter().collect()))
}

fn validate_package_base_influence(
    influence: &TrainingInfluenceManifest,
    plan: &ExecutionPlan,
    closure: &BTreeSet<NodeId>,
) -> Result<()> {
    let expected = closure
        .iter()
        .filter(|node_id| {
            plan.node_plans[*node_id]
                .supported_phases
                .contains(&Phase::FitCv)
        })
        .filter_map(|node_id| base_influence_kind(plan, node_id).map(|kind| (node_id, kind)))
        .collect::<BTreeMap<_, _>>();
    let base_kinds = [
        TrainingInfluenceKind::TransformFit,
        TrainingInfluenceKind::ModelFit,
        TrainingInfluenceKind::HpoSelection,
        TrainingInfluenceKind::TrainedMetaAggregation,
    ]
    .into_iter()
    .collect::<BTreeSet<_>>();
    let mut actual = BTreeMap::<&NodeId, Vec<TrainingInfluenceKind>>::new();
    for entry in &influence.entries {
        if let Some(node_id) = entry.node_id.as_ref() {
            if base_kinds.contains(&entry.kind) {
                actual.entry(node_id).or_default().push(entry.kind);
            }
        }
    }
    if actual.keys().copied().collect::<BTreeSet<_>>()
        != expected.keys().copied().collect::<BTreeSet<_>>()
    {
        return contract_error(
            "portable predictor base-influence nodes do not exactly match predictor closure"
                .to_string(),
        );
    }
    for (node_id, expected_kind) in expected {
        let kinds = &actual[node_id];
        if kinds.is_empty() || kinds.iter().any(|kind| *kind != expected_kind) {
            return contract_error(format!(
                "portable predictor influence node `{node_id}` entries do not all have expected kind `{:?}`",
                expected_kind
            ));
        }
    }
    Ok(())
}

fn validate_package_artifact_bindings(package: &PortablePredictorPackage) -> Result<()> {
    let mut previous: Option<&ArtifactId> = None;
    for binding in &package.artifact_bindings {
        if previous.is_some_and(|previous| previous >= &binding.artifact_id) {
            return contract_error(
                "portable predictor artifact bindings must be strictly sorted by artifact_id"
                    .to_string(),
            );
        }
        previous = Some(&binding.artifact_id);
    }
    let expected = package
        .execution_bundle
        .refit_artifacts
        .iter()
        .map(|record| record.artifact.id.clone())
        .collect::<BTreeSet<_>>();
    let actual = package
        .artifact_bindings
        .iter()
        .map(|binding| binding.artifact_id.clone())
        .collect::<BTreeSet<_>>();
    if actual != expected {
        return contract_error(
            "portable predictor artifact bindings do not exactly match bundle artifacts"
                .to_string(),
        );
    }
    for binding in &package.artifact_bindings {
        let record = package
            .execution_bundle
            .refit_artifacts
            .iter()
            .find(|record| record.artifact.id == binding.artifact_id)
            .expect("artifact id sets were checked above");
        let node_plan = &package.effective_plan.node_plans[&record.node_id];
        match binding.load_mode {
            ArtifactLoadMode::NativePortable => {
                record.artifact.validate_portable()?;
                if node_plan.artifact_policy == ArtifactPolicy::HostOnly {
                    return contract_error(format!(
                        "host_only artifact `{}` cannot be classified native_portable",
                        binding.artifact_id
                    ));
                }
            }
            ArtifactLoadMode::HostSidecar => {
                if package.fitted_artifact_mode != FittedArtifactMode::AllowHostSidecar {
                    return contract_error(format!(
                        "portable_required package forbids host sidecar artifact `{}`",
                        binding.artifact_id
                    ));
                }
            }
        }
    }
    Ok(())
}

pub(crate) fn contains_runtime_handle(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Array(values) => values.iter().any(contains_runtime_handle),
        serde_json::Value::Object(values) => {
            values.keys().any(|key| {
                let key = key.to_ascii_lowercase();
                key == "handle" || key.ends_with("_handle") || key.ends_with("_handles")
            }) || values.values().any(contains_runtime_handle)
        }
        _ => false,
    }
}

fn tcv1_fingerprint<T: Serialize + ?Sized>(value: &T, label: &str) -> Result<String> {
    let json = serde_json::to_string(value)?;
    parse_typed_json(&json)
        .and_then(|value| value.fingerprint())
        .map_err(|error| DagMlError::RuntimeValidation(format!("{label} is outside TCV1: {error}")))
}

fn tcv1_fingerprint_without<T: Serialize>(value: &T, field: &str, label: &str) -> Result<String> {
    let json = serde_json::to_string(value)?;
    parse_typed_json(&json)
        .and_then(|value| value.fingerprint_without(field))
        .map_err(|error| DagMlError::RuntimeValidation(format!("{label} is outside TCV1: {error}")))
}

fn strict_tcv1_fingerprint_without(json: &str, field: &str, label: &str) -> Result<String> {
    parse_typed_json(json)
        .and_then(|value| value.fingerprint_without(field))
        .map_err(|error| {
            DagMlError::RuntimeValidation(format!("{label} is outside strict TCV1: {error}"))
        })
}

fn validate_sha256(label: &str, value: &str) -> Result<()> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return contract_error(format!(
            "{label} fingerprint must be 64 lowercase hexadecimal characters"
        ));
    }
    Ok(())
}

fn zero_fingerprint() -> String {
    "0".repeat(64)
}

fn validate_identifier_text(label: &str, value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.' | b':'))
    {
        return contract_error(format!("{label} is not a valid DAG-ML identifier"));
    }
    Ok(())
}

fn validate_non_empty(label: &str, value: &str) -> Result<()> {
    if value.trim().is_empty() {
        return contract_error(format!("{label} must be non-empty"));
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

fn validate_unique_text(label: &str, values: &[String], require_non_empty: bool) -> Result<()> {
    if require_non_empty && values.is_empty() {
        return contract_error(format!("{label} must be non-empty"));
    }
    let mut seen = BTreeSet::new();
    for value in values {
        validate_non_empty(label, value)?;
        if !seen.insert(value.as_str()) {
            return contract_error(format!("{label} must be unique"));
        }
    }
    Ok(())
}

fn validate_sorted_unique_ids<T: Ord + std::fmt::Display>(
    label: &str,
    values: &[T],
    require_non_empty: bool,
) -> Result<()> {
    if require_non_empty && values.is_empty() {
        return contract_error(format!("{label} must be non-empty"));
    }
    if values.windows(2).any(|pair| pair[0] >= pair[1]) {
        return contract_error(format!("{label} must be strictly sorted and unique"));
    }
    Ok(())
}

fn unsupported_version<T>(label: &str, actual: u32, expected: u32) -> Result<T> {
    contract_error(format!(
        "{label} uses unsupported schema_version {actual}, expected {expected}"
    ))
}

fn contract_error<T>(message: String) -> Result<T> {
    Err(DagMlError::CampaignValidation(message))
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::*;
    use crate::ids::{BundleId, ControllerId, ObservationId, VariantId};
    use crate::relation::SampleRelation;
    use crate::selection::{MetricObjective, SelectionMetric};

    fn manifests() -> Vec<ControllerManifest> {
        let all: Vec<ControllerManifest> = serde_json::from_str(include_str!(
            "../tests/fixtures/package/controller_manifests.json"
        ))
        .unwrap();
        let mut selected = all
            .into_iter()
            .filter(|manifest| {
                matches!(
                    manifest.operator_kind,
                    NodeKind::Transform | NodeKind::Model
                )
            })
            .collect::<Vec<_>>();
        selected.sort_by(|left, right| left.controller_id.cmp(&right.controller_id));
        selected
    }

    fn data_identity(campaign: &CampaignSpec) -> TrainingDataIdentity {
        let binding = &campaign.data_bindings[&NodeId::new("model:base").unwrap()][0];
        let mut identity = TrainingDataIdentity {
            requirement_key: "model:base.x".to_string(),
            schema_fingerprint: binding.schema_fingerprint.clone(),
            plan_fingerprint: binding.plan_fingerprint.clone(),
            relation_fingerprint: binding.relation_fingerprint.clone().unwrap(),
            data_content_fingerprint: "1".repeat(64),
            target_content_fingerprint: "2".repeat(64),
            identity_fingerprint: zero_fingerprint(),
        };
        identity.identity_fingerprint = identity.compute_fingerprint().unwrap();
        identity
    }

    fn request() -> TrainingRequest {
        let graph: GraphSpec =
            serde_json::from_str(include_str!("../tests/fixtures/package/minimal_graph.json"))
                .unwrap();
        let campaign: CampaignSpec = serde_json::from_str(include_str!(
            "../tests/fixtures/package/campaign_oof_generation.json"
        ))
        .unwrap();
        let mut request = TrainingRequest {
            schema_version: TRAINING_REQUEST_SCHEMA_VERSION,
            request_id: "training:request.test".to_string(),
            plan_id: "plan:training.test".to_string(),
            graph,
            data_identities: vec![data_identity(&campaign)],
            campaign,
            controller_manifests: manifests(),
            parameter_patches: Vec::new(),
            patch_policies: Vec::new(),
            influence_requirements: Vec::new(),
            training_losses: Vec::new(),
            options: TrainingOptions {
                refit: true,
                refit_strategy: Some(RefitStrategy::RefitOne),
                seed: 12345,
                selection: SelectionPolicy {
                    id: "selection:rmse".to_string(),
                    metric: SelectionMetric {
                        name: "rmse".to_string(),
                        objective: MetricObjective::Minimize,
                    },
                    required_metric_level: None,
                    require_finite: true,
                    evaluation_scope: None,
                    refit_slot_plan: None,
                    stacking_fit_contract: None,
                    reduction_id: None,
                },
                selection_output_id: "output:prediction".to_string(),
                outputs: vec![TrainingOutputRequest {
                    output_id: "output:prediction".to_string(),
                    node_id: NodeId::new("model:base").unwrap(),
                    port_name: None,
                    prediction_level: PredictionLevel::Sample,
                    unit_level: Some(EntityUnitLevel::PhysicalSample),
                    prediction_kind: PredictionKind::RegressionPoint,
                    target_names: vec!["protein".to_string()],
                    target_units: vec![Some("percent".to_string())],
                    class_labels: vec![Vec::new()],
                    output_order: OutputOrder::TargetOrder,
                    target_space: "raw".to_string(),
                }],
                scheduler: TrainingSchedulerOptions {
                    kind: TrainingSchedulerKind::Sequential,
                    backend: None,
                    workers: 1,
                },
                resources: TrainingResourceLimits {
                    cpu_threads: 1,
                    memory_bytes: Some(1024),
                    gpu_devices: Vec::new(),
                    wall_time_ms: Some(10_000),
                },
                artifacts: TrainingArtifactOptions {
                    cv_artifacts: CvArtifactRetention::MetadataOnly,
                    prediction_caches: PredictionCacheRetention::Retain,
                    fitted_artifacts: FittedArtifactMode::AllowHostSidecar,
                },
            },
            request_fingerprint: zero_fingerprint(),
        };
        request.request_fingerprint = request.compute_fingerprint().unwrap();
        request
    }

    fn resign_request(request: &mut TrainingRequest) {
        request.request_fingerprint = zero_fingerprint();
        request.request_fingerprint = request.compute_fingerprint().unwrap();
    }

    #[test]
    fn training_request_projects_identically_for_refit_on_and_off() {
        let request = request();
        let refit = request.project().unwrap();
        assert_eq!(refit.outputs[0].port_name, "oof");
        assert!(!refit.parameters.requires_recompile);
        assert_eq!(
            refit.predictor_node_ids,
            BTreeSet::from([
                NodeId::new("model:base").unwrap(),
                NodeId::new("transform:snv").unwrap(),
            ])
        );

        let mut no_refit = request;
        no_refit.options.refit = false;
        no_refit.options.refit_strategy = None;
        resign_request(&mut no_refit);
        let projection = no_refit.project().unwrap();
        assert_eq!(projection.outputs, refit.outputs);
        assert_eq!(projection.plan, refit.plan);
    }

    #[test]
    fn training_request_rejects_duplicate_rendered_data_requirement_keys() {
        let mut request = request();
        let node_id = NodeId::new("model:base").unwrap();
        let duplicate = request.campaign.data_bindings[&node_id][0].clone();
        request
            .campaign
            .data_bindings
            .get_mut(&node_id)
            .unwrap()
            .push(duplicate);
        resign_request(&mut request);

        let error = request.project().unwrap_err();
        assert!(error
            .to_string()
            .contains("render duplicate requirement key `model:base.x`"));
    }

    #[test]
    fn training_options_reject_unknown_fields_and_binary64_integer_substitution() {
        let value = serde_json::to_value(request()).unwrap();
        let mut unknown = value.clone();
        unknown["options"]["mystery"] = json!(true);
        let error = serde_json::from_value::<TrainingRequest>(unknown).unwrap_err();
        assert!(error.to_string().contains("unknown field"));

        let mut binary64_seed = value;
        binary64_seed["options"]["seed"] = json!(12345.0);
        assert!(serde_json::from_value::<TrainingRequest>(binary64_seed).is_err());
    }

    #[test]
    fn training_request_from_json_requires_explicit_patch_collections() {
        let request_json = serde_json::to_value(request()).unwrap();
        for field in ["parameter_patches", "patch_policies"] {
            let mut missing = request_json.clone();
            missing.as_object_mut().unwrap().remove(field);
            let error = TrainingRequest::from_json(&serde_json::to_string(&missing).unwrap())
                .expect_err("required patch collection omission must fail closed");
            assert!(error.to_string().contains(field), "{field}: {error}");
        }
    }

    /// Presence-strictness (W1-0): five schema-`required` fields — four of them
    /// nullable — must reject key omission at serde deserialization with a
    /// field-specific `missing field` error, while still accepting the valid
    /// explicit values `null` / `[]`. These deserialize the individual
    /// sub-structs directly, so no outer fingerprint can mask or trigger the
    /// failure: presence is the only thing under test.
    #[test]
    fn required_nullable_fields_reject_omission_but_accept_explicit_null() {
        let base = request();

        // 1. TrainingOutputRequest.unit_level (required, nullable).
        let output = serde_json::to_value(&base.options.outputs[0]).unwrap();
        assert!(output.get("unit_level").is_some());
        let mut missing = output.clone();
        missing.as_object_mut().unwrap().remove("unit_level");
        let error = serde_json::from_value::<TrainingOutputRequest>(missing).unwrap_err();
        assert!(
            error.to_string().contains("missing field") && error.to_string().contains("unit_level"),
            "unit_level omission: {error}"
        );
        let mut null_unit = output;
        null_unit["unit_level"] = json!(null);
        assert!(serde_json::from_value::<TrainingOutputRequest>(null_unit)
            .unwrap()
            .unit_level
            .is_none());

        // 2. TrainingResourceLimits.gpu_devices (required, non-nullable array).
        let resources = serde_json::to_value(&base.options.resources).unwrap();
        assert_eq!(resources["gpu_devices"], json!([]));
        let mut missing = resources.clone();
        missing.as_object_mut().unwrap().remove("gpu_devices");
        let error = serde_json::from_value::<TrainingResourceLimits>(missing).unwrap_err();
        assert!(
            error.to_string().contains("missing field")
                && error.to_string().contains("gpu_devices"),
            "gpu_devices omission: {error}"
        );
        assert!(serde_json::from_value::<TrainingResourceLimits>(resources)
            .unwrap()
            .gpu_devices
            .is_empty());

        // 3. TrainingOptions.refit_strategy (required, nullable).
        let options = serde_json::to_value(&base.options).unwrap();
        assert!(options.get("refit_strategy").is_some());
        let mut missing = options.clone();
        missing.as_object_mut().unwrap().remove("refit_strategy");
        let error = serde_json::from_value::<TrainingOptions>(missing).unwrap_err();
        assert!(
            error.to_string().contains("missing field")
                && error.to_string().contains("refit_strategy"),
            "refit_strategy omission: {error}"
        );
        let mut null_strategy = options;
        null_strategy["refit_strategy"] = json!(null);
        assert!(serde_json::from_value::<TrainingOptions>(null_strategy)
            .unwrap()
            .refit_strategy
            .is_none());

        // 4. ControllerInfluenceRequirement.fold_id (required, nullable).
        let requirement = serde_json::to_value(ControllerInfluenceRequirement {
            node_id: NodeId::new("model:base").unwrap(),
            kind: TrainingInfluenceKind::EarlyStopping,
            scope_id: "early:fold:0".to_string(),
            phase: Phase::FitCv,
            fold_id: Some(FoldId::new("fold:0").unwrap()),
            physical_sample_ids: vec![SampleId::new("sample:1").unwrap()],
        })
        .unwrap();
        assert!(requirement.get("fold_id").is_some());
        let mut missing = requirement.clone();
        missing.as_object_mut().unwrap().remove("fold_id");
        let error = serde_json::from_value::<ControllerInfluenceRequirement>(missing).unwrap_err();
        assert!(
            error.to_string().contains("missing field") && error.to_string().contains("fold_id"),
            "fold_id omission: {error}"
        );
        let mut null_fold = requirement;
        null_fold["fold_id"] = json!(null);
        assert!(
            serde_json::from_value::<ControllerInfluenceRequirement>(null_fold)
                .unwrap()
                .fold_id
                .is_none()
        );

        // 5. TrainingInfluenceEntry.node_id (required, nullable).
        let entry = serde_json::to_value(TrainingInfluenceEntry {
            kind: TrainingInfluenceKind::ModelFit,
            scope_id: "model:base:fold:0".to_string(),
            node_id: Some(NodeId::new("model:base").unwrap()),
            physical_sample_ids: vec![SampleId::new("sample:1").unwrap()],
            origin_sample_ids: Vec::new(),
            group_ids: Vec::new(),
        })
        .unwrap();
        assert!(entry.get("node_id").is_some());
        let mut missing = entry.clone();
        missing.as_object_mut().unwrap().remove("node_id");
        let error = serde_json::from_value::<TrainingInfluenceEntry>(missing).unwrap_err();
        assert!(
            error.to_string().contains("missing field") && error.to_string().contains("node_id"),
            "node_id omission: {error}"
        );
        let mut null_node = entry;
        null_node["node_id"] = json!(null);
        assert!(serde_json::from_value::<TrainingInfluenceEntry>(null_node)
            .unwrap()
            .node_id
            .is_none());
    }

    #[test]
    fn output_resolution_rejects_no_output_ambiguity_and_non_prediction_ports() {
        let request = request();
        let output = &request.options.outputs[0];
        let mut no_output = request.graph.clone();
        no_output.nodes[1].ports.outputs.clear();
        assert!(output
            .resolve(&no_output)
            .unwrap_err()
            .to_string()
            .contains("no prediction output"));

        let mut ambiguous = request.graph.clone();
        let mut second = ambiguous.nodes[1].ports.outputs[0].clone();
        second.name = "probability".to_string();
        ambiguous.nodes[1].ports.outputs.push(second);
        assert!(output
            .resolve(&ambiguous)
            .unwrap_err()
            .to_string()
            .contains("multiple prediction outputs"));

        let mut explicit = output.clone();
        explicit.port_name = Some("x".to_string());
        assert!(explicit.resolve(&request.graph).is_err());
    }

    #[test]
    fn output_target_and_class_orders_are_semantic_not_lexically_sorted() {
        let graph = request().graph;
        let mut binding = OutputBinding {
            schema_version: OUTPUT_BINDING_SCHEMA_VERSION,
            binding_id: "output:ordered".to_string(),
            node_id: NodeId::new("model:base").unwrap(),
            port_name: "oof".to_string(),
            prediction_level: PredictionLevel::Sample,
            unit_level: Some(EntityUnitLevel::PhysicalSample),
            prediction_kind: PredictionKind::RegressionPoint,
            prediction_source: PredictionSource::FinalRefit,
            refit_strategy: Some(RefitStrategy::RefitOne),
            aggregation_fingerprint: "6".repeat(64),
            target_names: vec!["z_target".to_string(), "a_target".to_string()],
            target_units: vec![Some("z_unit".to_string()), Some("a_unit".to_string())],
            class_labels: vec![Vec::new(), Vec::new()],
            output_order: OutputOrder::TargetOrder,
            target_space: "raw".to_string(),
            binding_fingerprint: zero_fingerprint(),
        };
        binding.binding_fingerprint = binding.compute_fingerprint().unwrap();
        binding.validate(&graph).unwrap();
        let original = binding.binding_fingerprint.clone();
        binding.target_names.swap(0, 1);
        binding.binding_fingerprint = zero_fingerprint();
        binding.binding_fingerprint = binding.compute_fingerprint().unwrap();
        binding.validate(&graph).unwrap();
        assert_ne!(original, binding.binding_fingerprint);
    }

    #[test]
    fn output_unit_levels_and_class_vocabularies_match_w0_contract() {
        let request = request();
        let graph = &request.graph;
        let mut output = request.options.outputs[0].clone();

        output.unit_level = None;
        assert!(output
            .resolve(graph)
            .unwrap_err()
            .to_string()
            .contains("physical_sample"));

        output.prediction_level = PredictionLevel::Target;
        output.unit_level = Some(EntityUnitLevel::PhysicalSample);
        assert!(output
            .resolve(graph)
            .unwrap_err()
            .to_string()
            .contains("unit_level=null"));
        output.unit_level = None;
        let target_wire = serde_json::to_value(&output).unwrap();
        assert_eq!(target_wire.get("unit_level"), Some(&Value::Null));
        output.resolve(graph).unwrap();

        output.prediction_level = PredictionLevel::Sample;
        output.unit_level = Some(EntityUnitLevel::PhysicalSample);
        output.prediction_kind = PredictionKind::ClassLabel;
        output.class_labels = vec![Vec::new()];
        output.output_order = OutputOrder::TargetOrder;
        output.resolve(graph).unwrap();
        output.class_labels = vec![vec!["low".to_string(), "high".to_string()]];
        output.resolve(graph).unwrap();

        output.prediction_kind = PredictionKind::DecisionScore;
        output.resolve(graph).unwrap();
        output.class_labels = vec![Vec::new()];
        output.resolve(graph).unwrap();

        output.prediction_kind = PredictionKind::RegressionPoint;
        output.class_labels = vec![vec!["not-a-regression-class".to_string()]];
        assert!(output.resolve(graph).is_err());

        output.prediction_kind = PredictionKind::ClassProbability;
        output.output_order = OutputOrder::TargetMajorClassMinor;
        output.class_labels = vec![Vec::new()];
        assert!(output.resolve(graph).is_err());
        output.class_labels = vec![vec!["low".to_string(), "high".to_string()]];
        output.resolve(graph).unwrap();
    }

    #[test]
    fn selection_output_metric_matrix_is_explicit() {
        let mut level_mismatch = request();
        level_mismatch.options.outputs[0].prediction_level = PredictionLevel::Target;
        level_mismatch.options.outputs[0].unit_level = None;
        assert!(level_mismatch
            .options
            .selection
            .required_metric_level
            .is_none());
        resign_request(&mut level_mismatch);
        assert!(level_mismatch
            .validate()
            .unwrap_err()
            .to_string()
            .contains("campaign selection_metric_level"));

        let mut regression = request();
        regression.options.selection.metric.objective = MetricObjective::Maximize;
        resign_request(&mut regression);
        assert!(regression
            .validate()
            .unwrap_err()
            .to_string()
            .contains("not supported for RegressionPoint"));

        let mut class_label = request();
        class_label.options.outputs[0].prediction_kind = PredictionKind::ClassLabel;
        class_label.options.outputs[0].class_labels =
            vec![vec!["low".to_string(), "high".to_string()]];
        class_label.options.selection.metric.name = "accuracy".to_string();
        class_label.options.selection.metric.objective = MetricObjective::Maximize;
        resign_request(&mut class_label);
        class_label.validate().unwrap();

        let mut probability = class_label.clone();
        probability.options.outputs[0].prediction_kind = PredictionKind::ClassProbability;
        probability.options.outputs[0].output_order = OutputOrder::TargetMajorClassMinor;
        resign_request(&mut probability);
        assert!(probability
            .validate()
            .unwrap_err()
            .to_string()
            .contains("not supported for ClassProbability"));

        let mut decision = class_label;
        decision.options.outputs[0].prediction_kind = PredictionKind::DecisionScore;
        resign_request(&mut decision);
        assert!(decision
            .validate()
            .unwrap_err()
            .to_string()
            .contains("not supported for DecisionScore"));
    }

    fn request_with_nested_params() -> TrainingRequest {
        let mut request = request();
        let model = request
            .graph
            .nodes
            .iter_mut()
            .find(|node| node.id.as_str() == "model:base")
            .unwrap();
        model.params.insert(
            "nested".to_string(),
            json!({"depth": {"alpha": 1}, "array": [1, 2]}),
        );
        resign_request(&mut request);
        request
    }

    fn patch(namespace: ParameterNamespace, path: &[&str], value: Value) -> ParameterPatch {
        ParameterPatch {
            schema_version: PARAMETER_PATCH_SCHEMA_VERSION,
            node_id: NodeId::new("model:base").unwrap(),
            namespace,
            path: path.iter().map(|part| (*part).to_string()).collect(),
            value,
        }
    }

    fn patch_policy(namespaces: &[ParameterNamespace]) -> NodePatchPolicy {
        NodePatchPolicy {
            node_id: NodeId::new("model:base").unwrap(),
            allowed_namespaces: namespaces.iter().copied().collect(),
        }
    }

    #[test]
    fn namespaced_deep_patch_is_isolated_bijective_and_structural() {
        let plan = request_with_nested_params().project().unwrap().plan;
        let original = plan.node_plans[&NodeId::new("model:base").unwrap()]
            .params
            .clone();
        let patches = vec![
            patch(
                ParameterNamespace::Operator,
                &["nested", "depth", "alpha"],
                json!(2),
            ),
            patch(ParameterNamespace::Fit, &["epochs"], json!(12)),
            patch(ParameterNamespace::Structural, &["topology"], json!("wide")),
        ];
        let projection = project_parameter_patches(
            &plan,
            &patches,
            &[patch_policy(&[
                ParameterNamespace::Operator,
                ParameterNamespace::Fit,
                ParameterNamespace::Structural,
            ])],
        )
        .unwrap();
        let node = &projection.nodes[&NodeId::new("model:base").unwrap()];
        assert_eq!(node.params["nested"]["depth"]["alpha"], json!(2));
        assert_eq!(node.fit_params["epochs"], json!(12));
        assert_eq!(node.structural_params["topology"], json!("wide"));
        assert!(projection.requires_recompile);
        assert_eq!(
            plan.node_plans[&NodeId::new("model:base").unwrap()].params,
            original
        );
        assert_eq!(ParameterNamespace::Operator.plan_root(), "params");
        assert_eq!(ParameterNamespace::Fit.plan_root(), "fit_params");
        assert_eq!(ParameterNamespace::Control.plan_root(), "control_params");
        assert_eq!(
            ParameterNamespace::Structural.plan_root(),
            "structural_params"
        );

        let mut dishonest = projection.clone();
        dishonest.requires_recompile = false;
        dishonest.projection_fingerprint = zero_fingerprint();
        dishonest.projection_fingerprint = dishonest.compute_fingerprint().unwrap();
        assert!(dishonest.validate().is_err());
    }

    #[test]
    fn patch_projection_rejects_namespace_order_duplicates_parent_child_and_arrays() {
        let plan = request_with_nested_params().project().unwrap().plan;
        let operator = patch_policy(&[ParameterNamespace::Operator]);

        let forbidden = patch(ParameterNamespace::Fit, &["epochs"], json!(3));
        assert!(
            project_parameter_patches(&plan, &[forbidden], std::slice::from_ref(&operator))
                .unwrap_err()
                .to_string()
                .contains("forbidden")
        );

        let duplicate = patch(ParameterNamespace::Operator, &["x"], json!(1));
        assert!(project_parameter_patches(
            &plan,
            &[duplicate.clone(), duplicate],
            std::slice::from_ref(&operator)
        )
        .is_err());

        let parent = patch(
            ParameterNamespace::Operator,
            &["nested", "depth"],
            json!({"alpha": 2}),
        );
        let child = patch(
            ParameterNamespace::Operator,
            &["nested", "depth", "alpha"],
            json!(3),
        );
        assert!(project_parameter_patches(
            &plan,
            &[parent, child],
            std::slice::from_ref(&operator),
        )
        .unwrap_err()
        .to_string()
        .contains("parent/child"));

        let array = patch(
            ParameterNamespace::Operator,
            &["nested", "array", "0"],
            json!(9),
        );
        assert!(
            project_parameter_patches(&plan, &[array], std::slice::from_ref(&operator)).is_err()
        );

        let out_of_order = vec![
            patch(ParameterNamespace::Operator, &["z"], json!(1)),
            patch(ParameterNamespace::Operator, &["a"], json!(1)),
        ];
        assert!(project_parameter_patches(&plan, &out_of_order, &[operator]).is_err());

        assert!(project_parameter_patches(
            &plan,
            &[],
            &[patch_policy(&[ParameterNamespace::Operator])]
        )
        .is_err());
    }

    #[test]
    fn patch_tcv1_distinguishes_integer_and_binary64() {
        let integer = vec![patch(ParameterNamespace::Operator, &["x"], json!(2))];
        let binary64 = vec![patch(ParameterNamespace::Operator, &["x"], json!(2.0))];
        assert_ne!(
            tcv1_fingerprint(&integer, "integer patch").unwrap(),
            tcv1_fingerprint(&binary64, "binary64 patch").unwrap()
        );
    }

    fn cache_namespace() -> CacheNamespace {
        let mut namespace = CacheNamespace {
            schema_version: CACHE_NAMESPACE_SCHEMA_VERSION,
            prediction_requirement_key: bundle_prediction_requirement_key(
                &NodeId::new("model:base").unwrap(),
                "oof",
                &NodeId::new("model:meta").unwrap(),
                "stacked",
            ),
            data_requirement_key: "model:base.x".to_string(),
            producer_node_id: NodeId::new("model:base").unwrap(),
            source_port_name: "oof".to_string(),
            consumer_node_id: NodeId::new("model:meta").unwrap(),
            target_port_name: "stacked".to_string(),
            phase: Phase::FitCv,
            params_fingerprint: "a".repeat(64),
            data_identity_fingerprint: "b".repeat(64),
            fold_id: FoldId::new("fold:0").unwrap(),
            trial_id: "trial:0".to_string(),
            seed: 7,
            namespace_fingerprint: zero_fingerprint(),
        };
        namespace.namespace_fingerprint = namespace.compute_fingerprint().unwrap();
        namespace
    }

    #[test]
    fn cache_namespace_is_candidate_dataset_fold_trial_and_seed_specific() {
        let identity = request().data_identities.remove(0);
        let mut base = cache_namespace();
        base.data_identity_fingerprint = identity.identity_fingerprint.clone();
        base.namespace_fingerprint = zero_fingerprint();
        base.namespace_fingerprint = base.compute_fingerprint().unwrap();
        base.validate_for_identity(&identity).unwrap();
        for mutation in 0..5 {
            let mut changed = base.clone();
            match mutation {
                0 => changed.params_fingerprint = "d".repeat(64),
                1 => changed.data_identity_fingerprint = "e".repeat(64),
                2 => changed.fold_id = FoldId::new("fold:1").unwrap(),
                3 => changed.trial_id = "trial:1".to_string(),
                _ => changed.seed += 1,
            }
            changed.namespace_fingerprint = zero_fingerprint();
            changed.namespace_fingerprint = changed.compute_fingerprint().unwrap();
            changed.validate().unwrap();
            assert_ne!(base.namespace_fingerprint, changed.namespace_fingerprint);
        }

        let mut value = serde_json::to_value(&base).unwrap();
        value["seed"] = json!(7.0);
        assert!(serde_json::from_value::<CacheNamespace>(value).is_err());

        let mut relation_changed = identity.clone();
        relation_changed.relation_fingerprint = "d".repeat(64);
        relation_changed.identity_fingerprint = zero_fingerprint();
        relation_changed.identity_fingerprint = relation_changed.compute_fingerprint().unwrap();
        assert!(base.validate_for_identity(&relation_changed).is_err());
        let mut other_dataset_namespace = base.clone();
        other_dataset_namespace.data_identity_fingerprint =
            relation_changed.identity_fingerprint.clone();
        other_dataset_namespace.namespace_fingerprint = zero_fingerprint();
        other_dataset_namespace.namespace_fingerprint =
            other_dataset_namespace.compute_fingerprint().unwrap();
        assert_ne!(
            base.namespace_fingerprint,
            other_dataset_namespace.namespace_fingerprint
        );

        let mut other_output = base.clone();
        other_output.source_port_name = "probability".to_string();
        other_output.prediction_requirement_key = bundle_prediction_requirement_key(
            &other_output.producer_node_id,
            &other_output.source_port_name,
            &other_output.consumer_node_id,
            &other_output.target_port_name,
        );
        other_output.namespace_fingerprint = zero_fingerprint();
        other_output.namespace_fingerprint = other_output.compute_fingerprint().unwrap();
        other_output.validate().unwrap();
        assert_ne!(
            base.namespace_fingerprint,
            other_output.namespace_fingerprint
        );

        let mut wrong_phase = base.clone();
        wrong_phase.phase = Phase::Refit;
        wrong_phase.namespace_fingerprint = zero_fingerprint();
        wrong_phase.namespace_fingerprint = wrong_phase.compute_fingerprint().unwrap();
        assert!(wrong_phase.validate().is_err());
    }

    fn relations() -> SampleRelationSet {
        let records = (1..=4)
            .map(|index| {
                let mut relation = SampleRelation::new(
                    ObservationId::new(format!("observation:{index}")).unwrap(),
                    SampleId::new(format!("sample:{index}")).unwrap(),
                );
                relation.group_id =
                    Some(GroupId::new(if index <= 2 { "group:0" } else { "group:1" }).unwrap());
                relation
            })
            .collect();
        SampleRelationSet { records }
    }

    fn request_for_relations(relations: &SampleRelationSet) -> TrainingRequest {
        let mut request = request();
        let fingerprint = relations.fingerprint().unwrap();
        request
            .campaign
            .data_bindings
            .get_mut(&NodeId::new("model:base").unwrap())
            .unwrap()[0]
            .relation_fingerprint = Some(fingerprint.clone());
        request.data_identities[0].relation_fingerprint = fingerprint;
        request.data_identities[0].identity_fingerprint = zero_fingerprint();
        request.data_identities[0].identity_fingerprint =
            request.data_identities[0].compute_fingerprint().unwrap();
        resign_request(&mut request);
        request
    }

    fn influence_manifest(
        request: &TrainingRequest,
        projection: &TrainingContractProjection,
        relations: &SampleRelationSet,
    ) -> TrainingInfluenceManifest {
        let expected = expected_influence_coordinates(
            request,
            &projection.plan,
            &projection.predictor_node_ids,
        )
        .unwrap();
        let entries = expected
            .into_iter()
            .map(|((kind, scope_id, node_id), samples)| {
                let groups = relations
                    .records
                    .iter()
                    .filter(|relation| samples.contains(&relation.sample_id))
                    .filter_map(|relation| relation.group_id.clone())
                    .collect::<BTreeSet<_>>()
                    .into_iter()
                    .collect();
                TrainingInfluenceEntry {
                    kind,
                    scope_id,
                    node_id,
                    physical_sample_ids: samples.into_iter().collect(),
                    origin_sample_ids: Vec::new(),
                    group_ids: groups,
                }
            })
            .collect();
        let mut manifest = TrainingInfluenceManifest {
            schema_version: TRAINING_INFLUENCE_MANIFEST_SCHEMA_VERSION,
            relation_fingerprint: relations.fingerprint().unwrap(),
            entries,
            manifest_fingerprint: zero_fingerprint(),
        };
        manifest.manifest_fingerprint = manifest.compute_fingerprint().unwrap();
        manifest
    }

    fn resign_manifest(manifest: &mut TrainingInfluenceManifest) {
        manifest.manifest_fingerprint = zero_fingerprint();
        manifest.manifest_fingerprint = manifest.compute_fingerprint().unwrap();
    }

    fn early_stopping_requirements() -> Vec<ControllerInfluenceRequirement> {
        vec![
            ControllerInfluenceRequirement {
                node_id: NodeId::new("model:base").unwrap(),
                kind: TrainingInfluenceKind::EarlyStopping,
                scope_id: "early:fold:0".to_string(),
                phase: Phase::FitCv,
                fold_id: Some(FoldId::new("fold:0").unwrap()),
                physical_sample_ids: vec![SampleId::new("sample:3").unwrap()],
            },
            ControllerInfluenceRequirement {
                node_id: NodeId::new("model:base").unwrap(),
                kind: TrainingInfluenceKind::EarlyStopping,
                scope_id: "early:fold:1".to_string(),
                phase: Phase::FitCv,
                fold_id: Some(FoldId::new("fold:1").unwrap()),
                physical_sample_ids: vec![SampleId::new("sample:1").unwrap()],
            },
            ControllerInfluenceRequirement {
                node_id: NodeId::new("model:base").unwrap(),
                kind: TrainingInfluenceKind::EarlyStopping,
                scope_id: "early:refit".to_string(),
                phase: Phase::Refit,
                fold_id: None,
                physical_sample_ids: vec![SampleId::new("sample:1").unwrap()],
            },
        ]
    }

    fn full_scope_requirements(
        kind: TrainingInfluenceKind,
        prefix: &str,
    ) -> Vec<ControllerInfluenceRequirement> {
        vec![
            ControllerInfluenceRequirement {
                node_id: NodeId::new("model:base").unwrap(),
                kind,
                scope_id: format!("{prefix}:fold:0"),
                phase: Phase::FitCv,
                fold_id: Some(FoldId::new("fold:0").unwrap()),
                physical_sample_ids: vec![
                    SampleId::new("sample:3").unwrap(),
                    SampleId::new("sample:4").unwrap(),
                ],
            },
            ControllerInfluenceRequirement {
                node_id: NodeId::new("model:base").unwrap(),
                kind,
                scope_id: format!("{prefix}:fold:1"),
                phase: Phase::FitCv,
                fold_id: Some(FoldId::new("fold:1").unwrap()),
                physical_sample_ids: vec![
                    SampleId::new("sample:1").unwrap(),
                    SampleId::new("sample:2").unwrap(),
                ],
            },
            ControllerInfluenceRequirement {
                node_id: NodeId::new("model:base").unwrap(),
                kind,
                scope_id: format!("{prefix}:refit"),
                phase: Phase::Refit,
                fold_id: None,
                physical_sample_ids: (1..=4)
                    .map(|index| SampleId::new(format!("sample:{index}")).unwrap())
                    .collect(),
            },
        ]
    }

    #[test]
    fn influence_evidence_is_capability_complete_and_relation_closed() {
        let relations = relations();
        let request = request_for_relations(&relations);
        let projection = request.project().unwrap();
        let manifest = influence_manifest(&request, &projection, &relations);
        assert_eq!(manifest.entries.len(), 7);
        manifest
            .validate_for_projection(&projection, &request, &relations)
            .unwrap();

        let mut missing = manifest.clone();
        missing.entries.remove(1);
        resign_manifest(&mut missing);
        assert!(missing
            .validate_for_projection(&projection, &request, &relations)
            .unwrap_err()
            .to_string()
            .contains("phase scopes"));

        let mut wrong_group = manifest;
        wrong_group.entries[0].group_ids.pop();
        resign_manifest(&mut wrong_group);
        assert!(wrong_group
            .validate_for_projection(&projection, &request, &relations)
            .unwrap_err()
            .to_string()
            .contains("group closure"));
    }

    #[test]
    fn influence_capabilities_require_every_fold_and_refit_scope_and_refuse_extra() {
        let relations = relations();
        let mut request = request_for_relations(&relations);
        let model_manifest = request
            .controller_manifests
            .iter_mut()
            .find(|manifest| manifest.operator_kind == NodeKind::Model)
            .unwrap();
        model_manifest
            .capabilities
            .insert(ControllerCapability::UsesEarlyStopping);
        request.influence_requirements = early_stopping_requirements();
        resign_request(&mut request);
        let projection = request.project().unwrap();
        let mut manifest = influence_manifest(&request, &projection, &relations);
        assert_eq!(
            manifest
                .entries
                .iter()
                .filter(|entry| entry.kind == TrainingInfluenceKind::EarlyStopping)
                .count(),
            3
        );
        let removed = manifest
            .entries
            .iter()
            .position(|entry| entry.kind == TrainingInfluenceKind::EarlyStopping)
            .unwrap();
        manifest.entries.remove(removed);
        resign_manifest(&mut manifest);
        assert!(manifest
            .validate_for_projection(&projection, &request, &relations)
            .unwrap_err()
            .to_string()
            .contains("phase scopes"));

        let mut leaked_request = request.clone();
        leaked_request.influence_requirements[0].physical_sample_ids =
            vec![SampleId::new("sample:1").unwrap()];
        resign_request(&mut leaked_request);
        assert!(leaked_request
            .project()
            .unwrap_err()
            .to_string()
            .contains("outer validation"));

        let base_request = request_for_relations(&relations);
        let base_projection = base_request.project().unwrap();
        let mut extra = influence_manifest(&base_request, &base_projection, &relations);
        let model_entry = extra
            .entries
            .iter()
            .find(|entry| {
                entry.kind == TrainingInfluenceKind::ModelFit
                    && entry.scope_id.starts_with("fit_cv:")
            })
            .unwrap()
            .clone();
        extra.entries.push(TrainingInfluenceEntry {
            kind: TrainingInfluenceKind::EarlyStopping,
            ..model_entry
        });
        extra.entries.sort_by(|left, right| {
            (left.kind, left.scope_id.as_str(), left.node_id.as_ref()).cmp(&(
                right.kind,
                right.scope_id.as_str(),
                right.node_id.as_ref(),
            ))
        });
        resign_manifest(&mut extra);
        assert!(extra
            .validate_for_projection(&base_projection, &base_request, &relations)
            .unwrap_err()
            .to_string()
            .contains("undeclared coordinate"));
    }

    #[test]
    fn influence_requirement_cannot_claim_a_capability_the_controller_lacks() {
        let mut request = request();
        request.influence_requirements = early_stopping_requirements();
        resign_request(&mut request);
        assert!(request
            .project()
            .unwrap_err()
            .to_string()
            .contains("not required by active controller capabilities"));
    }

    #[test]
    fn influence_capability_matrix_covers_weights_internal_tuning_and_trained_aggregation() {
        let relations = relations();
        for (capability, kind, prefix) in [
            (
                ControllerCapability::UsesTrainingWeights,
                TrainingInfluenceKind::WeightingResampling,
                "weighting",
            ),
            (
                ControllerCapability::PerformsInternalTuning,
                TrainingInfluenceKind::HpoSelection,
                "internal_hpo",
            ),
        ] {
            let mut request = request_for_relations(&relations);
            let model = request
                .controller_manifests
                .iter_mut()
                .find(|manifest| manifest.operator_kind == NodeKind::Model)
                .unwrap();
            model.capabilities.insert(capability);
            if capability == ControllerCapability::UsesTrainingWeights {
                model
                    .capabilities
                    .insert(ControllerCapability::SupportsSampleWeights);
            }
            request.influence_requirements = full_scope_requirements(kind, prefix);
            resign_request(&mut request);
            let projection = request.project().unwrap();
            let mut manifest = influence_manifest(&request, &projection, &relations);
            assert_eq!(
                manifest
                    .entries
                    .iter()
                    .filter(|entry| entry.kind == kind && entry.node_id.is_some())
                    .count(),
                3
            );
            manifest
                .validate_for_projection(&projection, &request, &relations)
                .unwrap();
            let removed = manifest
                .entries
                .iter()
                .position(|entry| entry.kind == kind && entry.node_id.is_some())
                .unwrap();
            manifest.entries.remove(removed);
            resign_manifest(&mut manifest);
            assert!(manifest
                .validate_for_projection(&projection, &request, &relations)
                .unwrap_err()
                .to_string()
                .contains("phase scopes"));
        }

        let mut aggregation = request_for_relations(&relations);
        let model = aggregation
            .controller_manifests
            .iter_mut()
            .find(|manifest| manifest.operator_kind == NodeKind::Model)
            .unwrap();
        model
            .capabilities
            .insert(ControllerCapability::TrainsAggregation);
        resign_request(&mut aggregation);
        assert!(aggregation.validate().is_err());

        let model = aggregation
            .controller_manifests
            .iter_mut()
            .find(|manifest| manifest.operator_kind == NodeKind::Model)
            .unwrap();
        model
            .capabilities
            .insert(ControllerCapability::AggregatesPredictions);
        resign_request(&mut aggregation);
        let projection = aggregation.project().unwrap();
        let mut manifest = influence_manifest(&aggregation, &projection, &relations);
        assert!(manifest.entries.iter().any(|entry| {
            entry
                .node_id
                .as_ref()
                .is_some_and(|node_id| node_id.as_str() == "model:base")
                && entry.kind == TrainingInfluenceKind::TrainedMetaAggregation
        }));
        assert!(!manifest.entries.iter().any(|entry| {
            entry
                .node_id
                .as_ref()
                .is_some_and(|node_id| node_id.as_str() == "model:base")
                && entry.kind == TrainingInfluenceKind::ModelFit
        }));
        manifest
            .validate_for_projection(&projection, &aggregation, &relations)
            .unwrap();
        let removed = manifest
            .entries
            .iter()
            .position(|entry| {
                entry
                    .node_id
                    .as_ref()
                    .is_some_and(|node_id| node_id.as_str() == "model:base")
                    && entry.kind == TrainingInfluenceKind::TrainedMetaAggregation
            })
            .unwrap();
        manifest.entries.remove(removed);
        resign_manifest(&mut manifest);
        assert!(manifest
            .validate_for_projection(&projection, &aggregation, &relations)
            .is_err());
    }

    #[test]
    fn parallel_scheduler_is_bound_to_thread_or_process_capabilities() {
        let mut threaded = request();
        threaded.options.scheduler = TrainingSchedulerOptions {
            kind: TrainingSchedulerKind::Parallel,
            backend: Some(TrainingSchedulerBackend::Threads),
            workers: 2,
        };
        threaded.options.resources.cpu_threads = 2;
        resign_request(&mut threaded);
        threaded.validate().unwrap();

        let mut unsafe_threads = threaded.clone();
        unsafe_threads
            .controller_manifests
            .iter_mut()
            .find(|manifest| manifest.operator_kind == NodeKind::Model)
            .unwrap()
            .capabilities
            .remove(&ControllerCapability::ThreadSafe);
        resign_request(&mut unsafe_threads);
        assert!(unsafe_threads
            .validate()
            .unwrap_err()
            .to_string()
            .contains("thread_safe"));

        let mut gil_threads = threaded.clone();
        gil_threads
            .controller_manifests
            .iter_mut()
            .find(|manifest| manifest.operator_kind == NodeKind::Model)
            .unwrap()
            .capabilities
            .insert(ControllerCapability::NeedsPythonGil);
        resign_request(&mut gil_threads);
        assert!(gil_threads
            .validate()
            .unwrap_err()
            .to_string()
            .contains("needs_python_gil"));

        gil_threads.options.scheduler.backend = Some(TrainingSchedulerBackend::Processes);
        resign_request(&mut gil_threads);
        gil_threads.validate().unwrap();
    }

    #[test]
    fn portable_required_artifact_mode_rejects_host_only_controller() {
        let mut request = request();
        request.options.artifacts.fitted_artifacts = FittedArtifactMode::PortableRequired;
        request
            .controller_manifests
            .iter_mut()
            .find(|manifest| manifest.operator_kind == NodeKind::Model)
            .unwrap()
            .artifact_policy = ArtifactPolicy::HostOnly;
        resign_request(&mut request);
        assert!(request
            .validate()
            .unwrap_err()
            .to_string()
            .contains("host_only"));
        request.options.artifacts.fitted_artifacts = FittedArtifactMode::AllowHostSidecar;
        resign_request(&mut request);
        request.validate().unwrap();
    }

    fn portable_refit_recipe() -> PortableRefitRecipe {
        let mut recipe = PortableRefitRecipe {
            schema_version: PORTABLE_REFIT_RECIPE_SCHEMA_VERSION,
            recipe_id: "recipe:full.test".to_string(),
            mode: PortableRefitMode::Full,
            parent_package_fingerprint: "1".repeat(64),
            parent_outcome: TrainingOutcomeRef {
                outcome_id: "outcome:parent".to_string(),
                outcome_fingerprint: "2".repeat(64),
                pre_conformal_outcome_fingerprint: None,
                training_request_fingerprint: "3".repeat(64),
                effective_plan_fingerprint: "4".repeat(64),
                execution_bundle_id: BundleId::new("bundle:parent").unwrap(),
                execution_bundle_fingerprint: "5".repeat(64),
                output_binding_fingerprints: vec!["6".repeat(64)],
                training_influence_fingerprint: "7".repeat(64),
                data_identities_fingerprint: "8".repeat(64),
            },
            effective_plan_fingerprint: "4".repeat(64),
            selected_variant_id: VariantId::new("variant:selected").unwrap(),
            selected_variant_fingerprint: "9".repeat(64),
            selected_parameter_projection_fingerprint: "a".repeat(64),
            target_binding_fingerprints: vec!["b".repeat(64)],
            target_schema_fingerprint: "c".repeat(64),
            controllers: vec![PortableRefitController {
                node_id: NodeId::new("model:selected").unwrap(),
                controller_id: ControllerId::new("controller:methods").unwrap(),
                controller_version: "1.0.0".to_string(),
                manifest_fingerprint: "d".repeat(64),
                capabilities: BTreeSet::from([
                    ControllerCapability::Deterministic,
                    ControllerCapability::SupportsPortableFullRefit,
                ]),
            }],
            recipe_fingerprint: zero_fingerprint(),
        };
        recipe.recipe_fingerprint = recipe.compute_fingerprint().unwrap();
        recipe
    }

    #[test]
    fn portable_refit_recipe_is_closed_full_only_and_tcv1_attested() {
        let recipe = portable_refit_recipe();
        recipe.validate().unwrap();
        PortableRefitRecipe::from_json(&serde_json::to_string(&recipe).unwrap()).unwrap();

        let mut transfer = recipe.clone();
        transfer.mode = PortableRefitMode::Transfer;
        transfer.recipe_fingerprint = transfer.compute_fingerprint().unwrap();
        assert!(transfer
            .validate()
            .unwrap_err()
            .to_string()
            .contains("only full mode"));

        let mut unqualified = recipe.clone();
        unqualified.controllers[0]
            .capabilities
            .remove(&ControllerCapability::SupportsPortableFullRefit);
        unqualified.recipe_fingerprint = unqualified.compute_fingerprint().unwrap();
        assert!(unqualified
            .validate()
            .unwrap_err()
            .to_string()
            .contains("supports_portable_full_refit"));
    }

    #[test]
    fn portable_refit_provenance_requires_a_fresh_target_cohort() {
        let recipe = portable_refit_recipe();
        let request = request();
        let projection = request.project().unwrap();
        let relations = relations();
        let influence = influence_manifest(&request, &projection, &relations);
        let mut identity = data_identity(&request.campaign);
        identity.relation_fingerprint = influence.relation_fingerprint.clone();
        identity.identity_fingerprint = zero_fingerprint();
        identity.identity_fingerprint = identity.compute_fingerprint().unwrap();
        let provenance = PortableRefitProvenance::from_target_cohort(
            &recipe,
            "e".repeat(64),
            &[identity.clone()],
            &influence,
        )
        .unwrap();
        provenance.validate_against_recipe(&recipe).unwrap();
        PortableRefitProvenance::from_json_for_recipe(
            &serde_json::to_string(&provenance).unwrap(),
            &recipe,
        )
        .unwrap();

        let error = PortableRefitProvenance::from_target_cohort(
            &recipe,
            recipe.parent_outcome.training_request_fingerprint.clone(),
            &[identity],
            &influence,
        )
        .unwrap_err()
        .to_string();
        assert!(error.contains("must not reuse the parent"));
    }

    #[cfg(dag_ml_workspace_contract_fixtures)]
    fn package() -> PortablePredictorPackage {
        let outcome: Value = serde_json::from_str(include_str!(
            "../../../examples/fixtures/estimator/training_outcome_refit.v1.json"
        ))
        .unwrap();
        let effective_plan: ExecutionPlan =
            serde_json::from_value(outcome["effective_plan"].clone()).unwrap();
        let mut execution_bundle: ExecutionBundle =
            serde_json::from_value(outcome["execution_bundle"].clone()).unwrap();
        // The checked-in fixture is an R1 outcome carrying a readable V1
        // bundle.  This package fixture exercises the current V2 writer
        // contract, whose additive fields are all absent/empty here.
        execution_bundle.schema_version = crate::bundle::EXECUTION_BUNDLE_SCHEMA_VERSION;
        if let Some(scores) = &mut execution_bundle.scores {
            scores.schema_version = crate::metrics::SCORE_SET_SCHEMA_VERSION;
            for report in &mut scores.reports {
                report.producer_port = Some("oof".to_string());
            }
        }
        for cache in &mut execution_bundle.prediction_caches {
            cache.format = crate::bundle::BUNDLE_PREDICTION_CACHE_FORMAT.to_string();
        }
        let output_bindings = outcome["outputs"]
            .as_array()
            .unwrap()
            .iter()
            .map(|output| serde_json::from_value(output["binding"].clone()).unwrap())
            .collect::<Vec<OutputBinding>>();
        let training_influence: TrainingInfluenceManifest =
            serde_json::from_value(outcome["training_influence"].clone()).unwrap();
        let mut template = PredictorTemplate {
            graph: effective_plan.graph_plan.graph.clone(),
            campaign: effective_plan.campaign.clone(),
            controller_manifests: effective_plan.controller_manifests.clone(),
            template_fingerprint: zero_fingerprint(),
        };
        template.template_fingerprint = template.compute_fingerprint().unwrap();
        let mut data_identities = execution_bundle
            .data_requirements
            .iter()
            .map(|requirement| {
                let mut identity = TrainingDataIdentity {
                    requirement_key: requirement.key(),
                    schema_fingerprint: requirement.schema_fingerprint.clone(),
                    plan_fingerprint: requirement.plan_fingerprint.clone(),
                    relation_fingerprint: requirement.relation_fingerprint.clone().unwrap(),
                    data_content_fingerprint: "3".repeat(64),
                    target_content_fingerprint: "4".repeat(64),
                    identity_fingerprint: zero_fingerprint(),
                };
                identity.identity_fingerprint = identity.compute_fingerprint().unwrap();
                identity
            })
            .collect::<Vec<_>>();
        data_identities.sort_by(|left, right| left.requirement_key.cmp(&right.requirement_key));
        let closure = predictor_closure(
            &effective_plan,
            output_bindings.iter().map(|binding| &binding.node_id),
        )
        .unwrap();
        let mut artifact_bindings = execution_bundle
            .refit_artifacts
            .iter()
            .map(|record| PackageArtifactBinding {
                artifact_id: record.artifact.id.clone(),
                load_mode: ArtifactLoadMode::HostSidecar,
            })
            .collect::<Vec<_>>();
        artifact_bindings.sort_by(|left, right| left.artifact_id.cmp(&right.artifact_id));
        let output_binding_fingerprints = output_bindings
            .iter()
            .map(|binding| binding.binding_fingerprint.clone())
            .collect::<Vec<_>>();
        let execution_bundle_fingerprint =
            tcv1_fingerprint(&execution_bundle, "test execution bundle").unwrap();
        let data_identities_fingerprint =
            tcv1_fingerprint(&data_identities, "test data identities").unwrap();
        let mut package = PortablePredictorPackage {
            schema_version: PORTABLE_PREDICTOR_PACKAGE_SCHEMA_VERSION,
            package_id: "predictor:package.test".to_string(),
            template,
            training_request_fingerprint: "5".repeat(64),
            training_outcome: TrainingOutcomeRef {
                outcome_id: outcome["outcome_id"].as_str().unwrap().to_string(),
                outcome_fingerprint: outcome["outcome_fingerprint"].as_str().unwrap().to_string(),
                pre_conformal_outcome_fingerprint: None,
                training_request_fingerprint: "5".repeat(64),
                effective_plan_fingerprint: outcome["effective_plan_fingerprint"]
                    .as_str()
                    .unwrap()
                    .to_string(),
                execution_bundle_id: execution_bundle.bundle_id.clone(),
                execution_bundle_fingerprint,
                output_binding_fingerprints,
                training_influence_fingerprint: training_influence.manifest_fingerprint.clone(),
                data_identities_fingerprint,
            },
            effective_plan,
            execution_bundle,
            conformal_calibration: None,
            conformal_calibration_replay: None,
            output_bindings,
            predictor_node_ids: closure.into_iter().collect(),
            training_influence,
            data_identities,
            fitted_artifact_mode: FittedArtifactMode::AllowHostSidecar,
            artifact_bindings,
            package_fingerprint: zero_fingerprint(),
        };
        package.package_fingerprint = package.compute_fingerprint().unwrap();
        package
    }

    #[cfg(dag_ml_workspace_contract_fixtures)]
    #[test]
    fn portable_package_round_trips_loads_sidecar_and_rejects_tamper_and_future() {
        let package = package();
        package.validate().unwrap();
        let json = serde_json::to_string(&package).unwrap();
        PortablePredictorPackage::from_json(&json).unwrap();

        let loaded = package
            .clone()
            .load_with(|record| Ok(format!("handle:{}", record.artifact.id)))
            .unwrap();
        let first = &package.artifact_bindings[0].artifact_id;
        assert_eq!(loaded.artifact(first).unwrap(), &format!("handle:{first}"));

        let mut missing_handles = BTreeMap::new();
        missing_handles.insert(first.clone(), "only-one".to_string());
        assert!(LoadedPredictor::new(package.clone(), missing_handles).is_err());

        let mut tampered = package.clone();
        tampered.output_bindings[0].target_space = "tampered".to_string();
        assert!(tampered.validate().is_err());

        let mut future = package.clone();
        future.schema_version += 1;
        future.package_fingerprint = zero_fingerprint();
        future.package_fingerprint = future.compute_fingerprint().unwrap();
        assert!(future.validate().is_err());

        let mut binary64 = serde_json::to_value(package).unwrap();
        binary64["effective_plan"]["campaign"]["root_seed"] = json!(12345.0);
        assert!(serde_json::from_value::<PortablePredictorPackage>(binary64).is_err());
    }

    #[cfg(dag_ml_workspace_contract_fixtures)]
    #[test]
    fn portable_refit_recipe_refuses_host_sidecars_before_controller_inspection() {
        let package = package();
        let error = PortableRefitRecipe::derive_from_package(&package, "recipe:host-refusal")
            .unwrap_err()
            .to_string();
        assert!(error.contains("only native_portable artifacts"));
    }

    #[cfg(dag_ml_workspace_contract_fixtures)]
    #[test]
    fn portable_package_strict_parser_rejects_duplicate_and_nfc_colliding_keys() {
        let json = serde_json::to_string(&package()).unwrap();
        let duplicate = json.replacen(
            "\"schema_version\":1",
            "\"schema_version\":1,\"schema_version\":1",
            1,
        );
        assert!(PortablePredictorPackage::from_json(&duplicate)
            .unwrap_err()
            .to_string()
            .contains("duplicate JSON object key"));

        let collision = json.replacen(
            "\"metadata\":{}",
            "\"metadata\":{\"é\":1,\"e\\u0301\":2}",
            1,
        );
        assert!(PortablePredictorPackage::from_json(&collision)
            .unwrap_err()
            .to_string()
            .contains("NFC-colliding"));
    }

    #[cfg(dag_ml_workspace_contract_fixtures)]
    #[test]
    fn portable_package_rejects_refingerprinted_crosslink_and_relation_drift() {
        let mut plan_drift = package();
        plan_drift.training_outcome.effective_plan_fingerprint = "f".repeat(64);
        plan_drift.package_fingerprint = zero_fingerprint();
        plan_drift.package_fingerprint = plan_drift.compute_fingerprint().unwrap();
        assert!(plan_drift
            .validate()
            .unwrap_err()
            .to_string()
            .contains("effective plan fingerprint"));

        let mut binding_drift = package();
        binding_drift.output_bindings[0].target_space = "other".to_string();
        binding_drift.output_bindings[0].binding_fingerprint = zero_fingerprint();
        binding_drift.output_bindings[0].binding_fingerprint = binding_drift.output_bindings[0]
            .compute_fingerprint()
            .unwrap();
        binding_drift.package_fingerprint = zero_fingerprint();
        binding_drift.package_fingerprint = binding_drift.compute_fingerprint().unwrap();
        assert!(binding_drift
            .validate()
            .unwrap_err()
            .to_string()
            .contains("output bindings are not cross-linked"));

        let mut relation_drift = package();
        relation_drift.data_identities[0].relation_fingerprint = "e".repeat(64);
        relation_drift.data_identities[0].identity_fingerprint = zero_fingerprint();
        relation_drift.data_identities[0].identity_fingerprint = relation_drift.data_identities[0]
            .compute_fingerprint()
            .unwrap();
        relation_drift.package_fingerprint = zero_fingerprint();
        relation_drift.package_fingerprint = relation_drift.compute_fingerprint().unwrap();
        assert!(relation_drift
            .validate()
            .unwrap_err()
            .to_string()
            .contains("bundle fingerprints"));

        let mut content_drift = package();
        content_drift.data_identities[0].data_content_fingerprint = "d".repeat(64);
        content_drift.data_identities[0].identity_fingerprint = zero_fingerprint();
        content_drift.data_identities[0].identity_fingerprint = content_drift.data_identities[0]
            .compute_fingerprint()
            .unwrap();
        content_drift.package_fingerprint = zero_fingerprint();
        content_drift.package_fingerprint = content_drift.compute_fingerprint().unwrap();
        assert!(content_drift
            .validate()
            .unwrap_err()
            .to_string()
            .contains("data identity content"));

        let mut bundle_drift = package();
        bundle_drift
            .execution_bundle
            .metadata
            .insert("same_id_drift".to_string(), json!(true));
        bundle_drift.package_fingerprint = zero_fingerprint();
        bundle_drift.package_fingerprint = bundle_drift.compute_fingerprint().unwrap();
        assert!(bundle_drift
            .validate()
            .unwrap_err()
            .to_string()
            .contains("execution bundle content"));
    }

    #[cfg(dag_ml_workspace_contract_fixtures)]
    #[test]
    fn portable_required_package_has_no_host_sidecar_subset() {
        let mut package = package();
        package.fitted_artifact_mode = FittedArtifactMode::PortableRequired;
        for binding in &mut package.artifact_bindings {
            binding.load_mode = ArtifactLoadMode::NativePortable;
        }
        package.package_fingerprint = zero_fingerprint();
        package.package_fingerprint = package.compute_fingerprint().unwrap();
        package.validate().unwrap();
        let loaded = LoadedPredictor::<String>::new(package, BTreeMap::new()).unwrap();
        assert!(loaded.artifacts.is_empty());
    }

    #[cfg(dag_ml_workspace_contract_fixtures)]
    #[test]
    fn package_refuses_runtime_handle_shape_even_when_nested_in_metadata() {
        for payload in [
            json!({"handle": 9, "owner_controller": "controller:model.mock"}),
            json!({"nested": {"model_handle": 9}}),
            json!({"nested": [{"runtime_handles": [9]}]}),
        ] {
            let mut package = package();
            package
                .execution_bundle
                .metadata
                .insert("forbidden".to_string(), payload);
            package.training_outcome.execution_bundle_fingerprint =
                tcv1_fingerprint(&package.execution_bundle, "runtime-handle test bundle").unwrap();
            package.package_fingerprint = zero_fingerprint();
            package.package_fingerprint = package.compute_fingerprint().unwrap();
            assert!(package
                .validate()
                .unwrap_err()
                .to_string()
                .contains("runtime handles"));
        }
    }

    #[cfg(dag_ml_workspace_contract_fixtures)]
    #[test]
    fn portable_w0_output_binding_and_influence_fingerprints_match_production_tcv1() {
        let package = package();
        for binding in &package.output_bindings {
            assert_eq!(
                binding.binding_fingerprint,
                binding.compute_fingerprint().unwrap()
            );
        }
        assert_eq!(
            package.training_influence.manifest_fingerprint,
            package.training_influence.compute_fingerprint().unwrap()
        );
    }

    #[cfg(dag_ml_workspace_contract_fixtures)]
    #[test]
    fn portable_package_accepts_multi_scope_base_influence_per_node() {
        let mut package = package();
        let base_kinds = [
            TrainingInfluenceKind::TransformFit,
            TrainingInfluenceKind::ModelFit,
            TrainingInfluenceKind::HpoSelection,
            TrainingInfluenceKind::TrainedMetaAggregation,
        ]
        .into_iter()
        .collect::<BTreeSet<_>>();
        let mut entries = Vec::new();
        for entry in package.training_influence.entries.clone() {
            if entry.node_id.is_some() && base_kinds.contains(&entry.kind) {
                for suffix in ["fit_cv:fold:0", "fit_cv:fold:1", "refit:full"] {
                    let mut scoped = entry.clone();
                    scoped.scope_id = format!("{suffix}:{}", entry.scope_id);
                    entries.push(scoped);
                }
            } else {
                entries.push(entry);
            }
        }
        entries.sort_by(|left, right| {
            (left.kind, &left.scope_id, &left.node_id).cmp(&(
                right.kind,
                &right.scope_id,
                &right.node_id,
            ))
        });
        package.training_influence.entries = entries;
        package.training_influence.manifest_fingerprint = zero_fingerprint();
        package.training_influence.manifest_fingerprint =
            package.training_influence.compute_fingerprint().unwrap();
        package.training_outcome.training_influence_fingerprint =
            package.training_influence.manifest_fingerprint.clone();
        package.package_fingerprint = zero_fingerprint();
        package.package_fingerprint = package.compute_fingerprint().unwrap();
        package.validate().unwrap();
    }

    #[cfg(dag_ml_workspace_contract_fixtures)]
    #[test]
    fn controller_id_import_remains_the_same_public_type() {
        // Guards the package/template key type against accidental string-only
        // drift while keeping this test module's import exercised.
        let id = ControllerId::new("controller:model.mock").unwrap();
        assert!(package().template.controller_manifests.contains_key(&id));
    }

    #[cfg(dag_ml_workspace_contract_fixtures)]
    #[test]
    fn committed_w1_fixtures_match_rust_and_independent_tcv1_oracle() {
        let refit_json =
            include_str!("../../../examples/fixtures/training/training_request_refit.v1.json");
        let refit = TrainingRequest::from_json(refit_json).unwrap();
        let no_refit = TrainingRequest::from_json(include_str!(
            "../../../examples/fixtures/training/training_request_no_refit.v1.json"
        ))
        .unwrap();
        let active_influence = TrainingRequest::from_json(include_str!(
            "../../../examples/fixtures/training/training_request_active_influence.v1.json"
        ))
        .unwrap();
        let package_request = TrainingRequest::from_json(include_str!(
            "../../../examples/fixtures/training/training_request_package_refit.v1.json"
        ))
        .unwrap();
        assert!(refit.options.refit);
        assert!(!no_refit.options.refit);
        assert_eq!(active_influence.influence_requirements.len(), 6);

        let package_json =
            include_str!("../../../examples/fixtures/training/portable_predictor_package.v1.json");
        let package = PortablePredictorPackage::from_json(package_json).unwrap();
        assert_eq!(
            package.training_request_fingerprint,
            package_request.request_fingerprint
        );
        assert_eq!(package.data_identities, package_request.data_identities);
        let namespace = CacheNamespace::from_json(include_str!(
            "../../../examples/fixtures/training/cache_namespace_fit_cv.v1.json"
        ))
        .unwrap();
        let identity = package
            .data_identities
            .iter()
            .find(|identity| identity.requirement_key == namespace.data_requirement_key)
            .unwrap();
        namespace.validate_for_identity(identity).unwrap();

        let projection: ParameterProjection = serde_json::from_str(include_str!(
            "../../../examples/fixtures/training/parameter_projection_empty.v1.json"
        ))
        .unwrap();
        projection.validate().unwrap();

        let negatives: serde_json::Value = serde_json::from_str(include_str!(
            "../../../examples/fixtures/training/negative_cases.v1.json"
        ))
        .unwrap();
        for case in negatives["cases"].as_array().unwrap() {
            let document = serde_json::to_string(&case["document"]).unwrap();
            let error = match case["contract"].as_str().unwrap() {
                "cache_namespace" => CacheNamespace::from_json(&document).unwrap_err(),
                "portable_predictor_package" => {
                    PortablePredictorPackage::from_json(&document).unwrap_err()
                }
                "training_outcome" => {
                    crate::training_runtime::TrainingOutcome::from_json(&document).unwrap_err()
                }
                "training_request" => TrainingRequest::from_json(&document).unwrap_err(),
                other => panic!("unknown negative contract {other}"),
            };
            assert!(
                error
                    .to_string()
                    .contains(case["expected_error"].as_str().unwrap()),
                "{}: {error}",
                case["id"]
            );
        }
    }

    #[test]
    fn projection_strict_parsers_reject_duplicate_and_nfc_colliding_keys() {
        let mut projection = ParameterProjection {
            schema_version: PARAMETER_PROJECTION_SCHEMA_VERSION,
            nodes: BTreeMap::new(),
            requires_recompile: false,
            structural_patch_count: 0,
            patches_fingerprint: tcv1_fingerprint(&Vec::<ParameterPatch>::new(), "test patches")
                .unwrap(),
            projection_fingerprint: zero_fingerprint(),
        };
        projection.projection_fingerprint = projection.compute_fingerprint().unwrap();
        let parameter_json = serde_json::to_string(&projection).unwrap();
        ParameterProjection::from_json(&parameter_json).unwrap();
        let duplicate = parameter_json.replacen(
            "\"schema_version\":1",
            "\"schema_version\":1,\"schema_version\":1",
            1,
        );
        assert!(ParameterProjection::from_json(&duplicate)
            .unwrap_err()
            .to_string()
            .contains("duplicate JSON object key"));
        let collision = parameter_json.replacen('{', "{\"é\":1,\"e\\u0301\":2,", 1);
        assert!(ParameterProjection::from_json(&collision)
            .unwrap_err()
            .to_string()
            .contains("NFC-colliding"));

        let request = request();
        let projection = request.project().unwrap();
        let projection_json = serde_json::to_string(&projection).unwrap();
        TrainingContractProjection::from_json(&projection_json).unwrap();
        let duplicate = projection_json.replacen(
            "\"request_id\":",
            "\"request_id\":\"duplicate\",\"request_id\":",
            1,
        );
        assert!(TrainingContractProjection::from_json(&duplicate)
            .unwrap_err()
            .to_string()
            .contains("duplicate JSON object key"));
        let collision = projection_json.replacen('{', "{\"é\":1,\"e\\u0301\":2,", 1);
        assert!(TrainingContractProjection::from_json(&collision)
            .unwrap_err()
            .to_string()
            .contains("NFC-colliding"));

        for path in [
            &["plan", "graph_plan", "graph"][..],
            &["plan", "campaign"][..],
        ] {
            let mut unknown: serde_json::Value = serde_json::from_str(&projection_json).unwrap();
            let mut parent = &mut unknown;
            for segment in path {
                parent = &mut parent[*segment];
            }
            parent["unknown_projection_field"] = json!(true);
            let error =
                TrainingContractProjection::from_json(&serde_json::to_string(&unknown).unwrap())
                    .unwrap_err();
            let expected_path = format!("{}.unknown_projection_field", path.join("."));
            assert!(error.to_string().contains("unknown field"), "{error}");
            assert!(error.to_string().contains(&expected_path), "{error}");
        }
    }
}
