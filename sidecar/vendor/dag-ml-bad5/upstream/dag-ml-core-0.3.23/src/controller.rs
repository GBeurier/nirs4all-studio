use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::data::ModelInputSpec;
use crate::error::{DagMlError, Result};
use crate::graph::{NodeKind, NodeSpec, PortKind, PortSpec};
use crate::ids::ControllerId;
use crate::phase::Phase;
use crate::policy::FitInfluencePolicy;

pub const CONTROLLER_MANIFEST_SCHEMA_VERSION: u32 = 1;
pub const CONTROLLER_MANIFEST_SCHEMA_ID: &str =
    "https://github.com/GBeurier/dag-ml/schemas/controller_manifest.v1.schema.json";

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ControllerCapability {
    Deterministic,
    ThreadSafe,
    ProcessSafe,
    NeedsPythonGil,
    EmitsPredictions,
    ConsumesOofPredictions,
    EmitsArtifacts,
    Stateful,
    EmitsRelation,
    UsesCoreRng,
    ShapeChanging,
    GeneratesData,
    GeneratesModel,
    ExpandsVariants,
    AggregatesPredictions,
    SupportsSampleWeights,
    SupportsRowResampling,
    SupportsBackendLossWeights,
    SupportsMissingMasks,
    SupportsConfigurableLoss,
    SupportsCustomLoss,
    SupportsDifferentiableLoss,
    /// Controller actively consumes non-uniform training influence, distinct
    /// from merely supporting a weighting API.
    UsesTrainingWeights,
    /// Controller actively reads validation samples during fitting.
    UsesEarlyStopping,
    /// Controller performs a nested/internal candidate selection.
    PerformsInternalTuning,
    /// Prediction aggregation itself has fitted state.
    TrainsAggregation,
    /// Controller can perform a portable, full native retrain from a closed
    /// Package V3 recipe.  This is deliberately distinct from ordinary
    /// `REFIT` scheduler support: a controller must opt in to the archive
    /// boundary and attest that no host-sidecar state is required.
    SupportsPortableFullRefit,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ControllerFitScope {
    Stateless,
    FoldTrain,
    FullTrain,
    InferenceOnly,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RngPolicy {
    UsesCoreSeed,
    IgnoresSeed,
    ExternallyDeterministic,
    Nondeterministic,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactPolicy {
    Serializable,
    HostOnly,
    ContentAddressed,
    ReplayRequired,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OperatorSelector {
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub aliases: BTreeSet<String>,
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub classes: BTreeSet<String>,
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub class_prefixes: BTreeSet<String>,
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub functions: BTreeSet<String>,
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub refs: BTreeSet<String>,
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub types: BTreeSet<String>,
}

impl OperatorSelector {
    fn validate(&self, controller_id: &ControllerId) -> Result<()> {
        if self.aliases.is_empty()
            && self.classes.is_empty()
            && self.class_prefixes.is_empty()
            && self.functions.is_empty()
            && self.refs.is_empty()
            && self.types.is_empty()
        {
            return Err(DagMlError::ControllerValidation(format!(
                "controller `{controller_id}` has an empty operator selector"
            )));
        }
        for (field, values) in [
            ("aliases", &self.aliases),
            ("classes", &self.classes),
            ("class_prefixes", &self.class_prefixes),
            ("functions", &self.functions),
            ("refs", &self.refs),
            ("types", &self.types),
        ] {
            if values.iter().any(|value| value.trim().is_empty()) {
                return Err(DagMlError::ControllerValidation(format!(
                    "controller `{controller_id}` operator selector `{field}` contains an empty value"
                )));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ControllerManifest {
    pub controller_id: ControllerId,
    pub controller_version: String,
    pub operator_kind: NodeKind,
    #[serde(default)]
    pub priority: u32,
    #[serde(default)]
    pub supported_phases: BTreeSet<Phase>,
    #[serde(default)]
    pub input_ports: Vec<PortSpec>,
    #[serde(default)]
    pub output_ports: Vec<PortSpec>,
    #[serde(default)]
    pub data_requirements: Option<serde_json::Value>,
    #[serde(default)]
    pub capabilities: BTreeSet<ControllerCapability>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub operator_selectors: Vec<OperatorSelector>,
    pub fit_scope: ControllerFitScope,
    pub rng_policy: RngPolicy,
    pub artifact_policy: ArtifactPolicy,
}

impl ControllerManifest {
    pub fn validate(&self) -> Result<()> {
        if self.controller_version.trim().is_empty() {
            return Err(DagMlError::ControllerValidation(format!(
                "controller `{}` has an empty version",
                self.controller_id
            )));
        }
        if self.supported_phases.is_empty() {
            return Err(DagMlError::ControllerValidation(format!(
                "controller `{}` supports no phases",
                self.controller_id
            )));
        }
        if let Some(model_input) = self.model_input_spec()? {
            model_input.validate().map_err(|error| {
                DagMlError::ControllerValidation(format!(
                    "controller `{}` data_requirements are not a valid ModelInputSpec: {error}",
                    self.controller_id
                ))
            })?;
        }
        validate_ports(&self.controller_id, "input", &self.input_ports)?;
        validate_ports(&self.controller_id, "output", &self.output_ports)?;
        for selector in &self.operator_selectors {
            selector.validate(&self.controller_id)?;
        }
        if self.rng_policy == RngPolicy::Nondeterministic
            && self
                .capabilities
                .contains(&ControllerCapability::Deterministic)
        {
            return Err(DagMlError::ControllerValidation(format!(
                "controller `{}` cannot be deterministic with nondeterministic RNG",
                self.controller_id
            )));
        }
        if self.fit_scope == ControllerFitScope::InferenceOnly
            && (self.supported_phases.contains(&Phase::FitCv)
                || self.supported_phases.contains(&Phase::Refit))
        {
            return Err(DagMlError::ControllerValidation(format!(
                "controller `{}` is inference_only but supports training phases",
                self.controller_id
            )));
        }
        if self.supported_phases.contains(&Phase::FitCv)
            && matches!(
                self.fit_scope,
                ControllerFitScope::FullTrain | ControllerFitScope::InferenceOnly
            )
        {
            return Err(DagMlError::ControllerValidation(format!(
                "controller `{}` supports FIT_CV but has fit_scope {:?}",
                self.controller_id, self.fit_scope
            )));
        }
        if self
            .output_ports
            .iter()
            .any(|port| port.kind == PortKind::Prediction)
            && !self
                .capabilities
                .contains(&ControllerCapability::EmitsPredictions)
        {
            return Err(DagMlError::ControllerValidation(format!(
                "controller `{}` has prediction output ports but lacks emits_predictions",
                self.controller_id
            )));
        }
        if self
            .output_ports
            .iter()
            .any(|port| port.kind == PortKind::Artifact)
            && !self
                .capabilities
                .contains(&ControllerCapability::EmitsArtifacts)
        {
            return Err(DagMlError::ControllerValidation(format!(
                "controller `{}` has artifact output ports but lacks emits_artifacts",
                self.controller_id
            )));
        }
        let active_influence = [
            ControllerCapability::UsesTrainingWeights,
            ControllerCapability::UsesEarlyStopping,
            ControllerCapability::PerformsInternalTuning,
            ControllerCapability::TrainsAggregation,
        ];
        if matches!(
            self.fit_scope,
            ControllerFitScope::Stateless | ControllerFitScope::InferenceOnly
        ) && active_influence
            .iter()
            .any(|capability| self.capabilities.contains(capability))
        {
            return Err(DagMlError::ControllerValidation(format!(
                "controller `{}` has active training-influence capabilities with fit_scope {:?}",
                self.controller_id, self.fit_scope
            )));
        }
        if self
            .capabilities
            .contains(&ControllerCapability::UsesTrainingWeights)
            && !self.capabilities.iter().any(|capability| {
                matches!(
                    capability,
                    ControllerCapability::SupportsSampleWeights
                        | ControllerCapability::SupportsRowResampling
                        | ControllerCapability::SupportsBackendLossWeights
                )
            })
        {
            return Err(DagMlError::ControllerValidation(format!(
                "controller `{}` uses training weights without a supported weighting mechanism",
                self.controller_id
            )));
        }
        if self
            .capabilities
            .contains(&ControllerCapability::TrainsAggregation)
            && !self
                .capabilities
                .contains(&ControllerCapability::AggregatesPredictions)
        {
            return Err(DagMlError::ControllerValidation(format!(
                "controller `{}` trains aggregation without aggregates_predictions",
                self.controller_id
            )));
        }
        if self
            .capabilities
            .contains(&ControllerCapability::SupportsCustomLoss)
            && !self
                .capabilities
                .contains(&ControllerCapability::SupportsConfigurableLoss)
        {
            return Err(DagMlError::ControllerValidation(format!(
                "controller `{}` supports custom loss without configurable loss",
                self.controller_id
            )));
        }
        if self
            .capabilities
            .contains(&ControllerCapability::SupportsDifferentiableLoss)
            && !self
                .capabilities
                .contains(&ControllerCapability::SupportsConfigurableLoss)
        {
            return Err(DagMlError::ControllerValidation(format!(
                "controller `{}` supports differentiable loss without configurable loss",
                self.controller_id
            )));
        }
        Ok(())
    }

    pub fn supports_phase(&self, phase: Phase) -> bool {
        self.supported_phases.contains(&phase)
    }

    pub fn supports_parallel_invocation(&self) -> bool {
        self.capabilities
            .contains(&ControllerCapability::ThreadSafe)
            || self
                .capabilities
                .contains(&ControllerCapability::ProcessSafe)
    }

    pub fn supports_fit_influence_policy(&self, policy: FitInfluencePolicy) -> bool {
        capabilities_support_fit_influence(&self.capabilities, policy)
    }

    pub fn model_input_spec(&self) -> Result<Option<ModelInputSpec>> {
        self.data_requirements
            .as_ref()
            .map(|value| {
                serde_json::from_value::<ModelInputSpec>(value.clone()).map_err(|error| {
                    DagMlError::ControllerValidation(format!(
                        "controller `{}` data_requirements must be ModelInputSpec JSON: {error}",
                        self.controller_id
                    ))
                })
            })
            .transpose()
    }
}

pub fn capabilities_support_fit_influence(
    capabilities: &BTreeSet<ControllerCapability>,
    policy: FitInfluencePolicy,
) -> bool {
    match policy {
        FitInfluencePolicy::Auto
        | FitInfluencePolicy::UniformRows
        | FitInfluencePolicy::ScorerOnly => true,
        FitInfluencePolicy::EqualSampleInfluence => {
            capabilities.contains(&ControllerCapability::SupportsSampleWeights)
        }
        FitInfluencePolicy::ResampleEqualized => {
            capabilities.contains(&ControllerCapability::SupportsRowResampling)
        }
        FitInfluencePolicy::BackendLossWeight => {
            capabilities.contains(&ControllerCapability::SupportsBackendLossWeights)
        }
        FitInfluencePolicy::StrictWeightSupport => {
            capabilities.contains(&ControllerCapability::SupportsSampleWeights)
                || capabilities.contains(&ControllerCapability::SupportsRowResampling)
                || capabilities.contains(&ControllerCapability::SupportsBackendLossWeights)
        }
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct ControllerRegistry {
    manifests: BTreeMap<ControllerId, ControllerManifest>,
}

impl ControllerRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, manifest: ControllerManifest) -> Result<()> {
        manifest.validate()?;
        if self.manifests.contains_key(&manifest.controller_id) {
            return Err(DagMlError::ControllerValidation(format!(
                "duplicate controller id `{}`",
                manifest.controller_id
            )));
        }
        self.manifests
            .insert(manifest.controller_id.clone(), manifest);
        Ok(())
    }

    pub fn get(&self, controller_id: &ControllerId) -> Option<&ControllerManifest> {
        self.manifests.get(controller_id)
    }

    pub fn manifests(&self) -> impl Iterator<Item = &ControllerManifest> {
        self.manifests.values()
    }

    pub fn resolve_for_node(&self, node: &NodeSpec) -> Result<ControllerManifest> {
        if let Some(requested) = requested_controller(node)? {
            let manifest = self.get(&requested).ok_or_else(|| {
                DagMlError::Planning(format!(
                    "node `{}` requested unknown controller `{requested}`",
                    node.id
                ))
            })?;
            if manifest.operator_kind != node.kind {
                return Err(DagMlError::Planning(format!(
                    "node `{}` kind {:?} is incompatible with controller `{}` kind {:?}",
                    node.id, node.kind, manifest.controller_id, manifest.operator_kind
                )));
            }
            return Ok(manifest.clone());
        }

        let mut candidates = self
            .manifests
            .values()
            .filter_map(|manifest| controller_candidate(manifest, node))
            .collect::<Vec<_>>();
        candidates.sort_by(|left, right| {
            left.rank
                .cmp(&right.rank)
                .then_with(|| left.manifest.priority.cmp(&right.manifest.priority))
                .then_with(|| {
                    left.manifest
                        .controller_id
                        .cmp(&right.manifest.controller_id)
                })
        });
        let Some(first) = candidates.first() else {
            return Err(DagMlError::Planning(format!(
                "no controller registered for node `{}` kind {:?}",
                node.id, node.kind
            )));
        };
        if candidates.get(1).is_some_and(|second| {
            second.rank == first.rank && second.manifest.priority == first.manifest.priority
        }) {
            return Err(DagMlError::Planning(format!(
                "node `{}` has ambiguous controllers for kind {:?}; set metadata.controller_id",
                node.id, node.kind
            )));
        }
        Ok(first.manifest.clone())
    }

    pub fn infer_operator_kind(&self, operator: &serde_json::Value) -> Result<Option<NodeKind>> {
        let matches = self
            .manifests
            .values()
            .filter(|manifest| {
                !manifest.operator_selectors.is_empty()
                    && manifest
                        .operator_selectors
                        .iter()
                        .any(|selector| selector_matches_operator(selector, operator))
            })
            .collect::<Vec<_>>();
        let Some(first) = matches.first() else {
            return Ok(None);
        };
        let kind = first.operator_kind.clone();
        let conflicting = matches
            .iter()
            .find(|manifest| manifest.operator_kind != kind);
        if let Some(conflicting) = conflicting {
            return Err(DagMlError::Planning(format!(
                "minimal operator alias `{}` matches controllers with different node kinds ({:?} and {:?}); use explicit DSL syntax",
                operator_label(operator),
                kind,
                conflicting.operator_kind
            )));
        }
        Ok(Some(kind))
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
enum ControllerMatchRank {
    OperatorSelector,
    GenericKind,
}

struct ControllerCandidate<'a> {
    manifest: &'a ControllerManifest,
    rank: ControllerMatchRank,
}

fn controller_candidate<'a>(
    manifest: &'a ControllerManifest,
    node: &NodeSpec,
) -> Option<ControllerCandidate<'a>> {
    if manifest.operator_kind != node.kind {
        return None;
    }
    if manifest.operator_selectors.is_empty() {
        return Some(ControllerCandidate {
            manifest,
            rank: ControllerMatchRank::GenericKind,
        });
    }
    let operator = node.operator.as_ref()?;
    manifest
        .operator_selectors
        .iter()
        .any(|selector| selector_matches_operator(selector, operator))
        .then_some(ControllerCandidate {
            manifest,
            rank: ControllerMatchRank::OperatorSelector,
        })
}

fn selector_matches_operator(selector: &OperatorSelector, operator: &serde_json::Value) -> bool {
    let descriptor = OperatorDescriptor::from_value(operator);
    selector_matches_any(
        &selector.aliases,
        descriptor.alias_candidates.iter().copied(),
    ) || descriptor
        .class
        .is_some_and(|class| selector_matches_exact(&selector.classes, class))
        || descriptor.class.is_some_and(|class| {
            selector
                .class_prefixes
                .iter()
                .any(|prefix| normalized_starts_with(class, prefix))
        })
        || descriptor
            .function
            .is_some_and(|function| selector_matches_exact(&selector.functions, function))
        || descriptor
            .reference
            .is_some_and(|reference| selector_matches_exact(&selector.refs, reference))
        || descriptor
            .operator_type
            .is_some_and(|operator_type| selector_matches_exact(&selector.types, operator_type))
}

fn operator_label(operator: &serde_json::Value) -> String {
    match operator {
        serde_json::Value::String(value) => value.clone(),
        serde_json::Value::Object(object) => ["type", "ref", "class", "function"]
            .into_iter()
            .find_map(|key| object.get(key).and_then(serde_json::Value::as_str))
            .map(str::to_string)
            .unwrap_or_else(|| operator.to_string()),
        _ => operator.to_string(),
    }
}

fn selector_matches_any<'a>(
    values: &BTreeSet<String>,
    mut candidates: impl Iterator<Item = &'a str>,
) -> bool {
    candidates.any(|candidate| selector_matches_exact(values, candidate))
}

fn selector_matches_exact(values: &BTreeSet<String>, candidate: &str) -> bool {
    values
        .iter()
        .any(|value| normalized_eq(value.as_str(), candidate))
}

fn normalized_eq(left: &str, right: &str) -> bool {
    left.trim().eq_ignore_ascii_case(right.trim())
}

fn normalized_starts_with(value: &str, prefix: &str) -> bool {
    value
        .trim()
        .to_ascii_lowercase()
        .starts_with(&prefix.trim().to_ascii_lowercase())
}

struct OperatorDescriptor<'a> {
    class: Option<&'a str>,
    function: Option<&'a str>,
    reference: Option<&'a str>,
    operator_type: Option<&'a str>,
    alias_candidates: Vec<&'a str>,
}

impl<'a> OperatorDescriptor<'a> {
    fn from_value(value: &'a serde_json::Value) -> Self {
        let mut descriptor = Self {
            class: None,
            function: None,
            reference: None,
            operator_type: None,
            alias_candidates: Vec::new(),
        };
        match value {
            serde_json::Value::String(reference) => {
                descriptor.reference = Some(reference);
                descriptor.push_alias_candidates(reference);
            }
            serde_json::Value::Object(object) => {
                descriptor.class = object.get("class").and_then(serde_json::Value::as_str);
                descriptor.function = object.get("function").and_then(serde_json::Value::as_str);
                descriptor.reference = object.get("ref").and_then(serde_json::Value::as_str);
                descriptor.operator_type = object.get("type").and_then(serde_json::Value::as_str);
                for value in [
                    descriptor.operator_type,
                    descriptor.reference,
                    descriptor.class,
                    descriptor.function,
                ]
                .into_iter()
                .flatten()
                {
                    descriptor.push_alias_candidates(value);
                }
            }
            _ => {}
        }
        descriptor
    }

    fn push_alias_candidates(&mut self, value: &'a str) {
        self.alias_candidates.push(value);
        if let Some(short) = value
            .rsplit(['.', ':'])
            .next()
            .filter(|short| *short != value)
        {
            self.alias_candidates.push(short);
        }
    }
}

fn validate_ports(controller_id: &ControllerId, direction: &str, ports: &[PortSpec]) -> Result<()> {
    let mut seen = BTreeSet::new();
    for port in ports {
        if port.name.trim().is_empty() {
            return Err(DagMlError::ControllerValidation(format!(
                "{direction} port on controller `{controller_id}` has an empty name"
            )));
        }
        if !seen.insert(port.name.as_str()) {
            return Err(DagMlError::ControllerValidation(format!(
                "duplicate {direction} port `{}` on controller `{controller_id}`",
                port.name
            )));
        }
    }
    Ok(())
}

fn requested_controller(node: &NodeSpec) -> Result<Option<ControllerId>> {
    node.metadata
        .get("controller_id")
        .map(|value| {
            value.as_str().ok_or_else(|| {
                DagMlError::Planning(format!(
                    "node `{}` metadata.controller_id must be a string",
                    node.id
                ))
            })
        })
        .transpose()?
        .map(ControllerId::new)
        .transpose()
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, BTreeSet};

    use serde_json::json;

    use super::*;
    use crate::graph::{NodeSpec, PortCardinality, PortSchema};
    use crate::ids::NodeId;

    fn manifest(id: &str, kind: NodeKind, priority: u32) -> ControllerManifest {
        ControllerManifest {
            controller_id: ControllerId::new(id).unwrap(),
            controller_version: "0.1.0".to_string(),
            operator_kind: kind,
            priority,
            supported_phases: BTreeSet::from([Phase::FitCv]),
            input_ports: Vec::new(),
            output_ports: Vec::new(),
            data_requirements: None,
            capabilities: BTreeSet::from([ControllerCapability::Deterministic]),
            operator_selectors: Vec::new(),
            fit_scope: ControllerFitScope::FoldTrain,
            rng_policy: RngPolicy::UsesCoreSeed,
            artifact_policy: ArtifactPolicy::Serializable,
        }
    }

    fn node(kind: NodeKind) -> NodeSpec {
        NodeSpec {
            id: NodeId::new("node:model").unwrap(),
            kind,
            operator: None,
            params: BTreeMap::new(),
            ports: PortSchema::default(),
            metadata: BTreeMap::new(),
            seed_label: None,
        }
    }

    fn node_with_operator(kind: NodeKind, operator: serde_json::Value) -> NodeSpec {
        NodeSpec {
            operator: Some(operator),
            ..node(kind)
        }
    }

    fn alias_selector(alias: &str) -> OperatorSelector {
        OperatorSelector {
            aliases: BTreeSet::from([alias.to_string()]),
            ..OperatorSelector::default()
        }
    }

    #[test]
    fn registry_resolves_lowest_priority_manifest() {
        let mut registry = ControllerRegistry::new();
        registry
            .register(manifest("controller:slow", NodeKind::Model, 10))
            .unwrap();
        registry
            .register(manifest("controller:fast", NodeKind::Model, 1))
            .unwrap();

        let resolved = registry.resolve_for_node(&node(NodeKind::Model)).unwrap();

        assert_eq!(resolved.controller_id.as_str(), "controller:fast");
    }

    #[test]
    fn explicit_controller_id_disambiguates() {
        let mut registry = ControllerRegistry::new();
        registry
            .register(manifest("controller:a", NodeKind::Model, 1))
            .unwrap();
        registry
            .register(manifest("controller:b", NodeKind::Model, 1))
            .unwrap();
        let mut node = node(NodeKind::Model);
        node.metadata
            .insert("controller_id".to_string(), json!("controller:b"));

        let resolved = registry.resolve_for_node(&node).unwrap();

        assert_eq!(resolved.controller_id.as_str(), "controller:b");
    }

    #[test]
    fn equal_priority_requires_explicit_controller() {
        let mut registry = ControllerRegistry::new();
        registry
            .register(manifest("controller:a", NodeKind::Model, 1))
            .unwrap();
        registry
            .register(manifest("controller:b", NodeKind::Model, 1))
            .unwrap();

        assert!(registry.resolve_for_node(&node(NodeKind::Model)).is_err());
    }

    #[test]
    fn operator_selector_prefers_specific_controller_over_generic() {
        let mut registry = ControllerRegistry::new();
        registry
            .register(manifest(
                "controller:transform.generic",
                NodeKind::Transform,
                0,
            ))
            .unwrap();
        let mut specific = manifest("controller:transform.snv", NodeKind::Transform, 0);
        specific.operator_selectors.push(alias_selector("SNV"));
        registry.register(specific).unwrap();
        let node = node_with_operator(NodeKind::Transform, json!("SNV"));

        let resolved = registry.resolve_for_node(&node).unwrap();

        assert_eq!(resolved.controller_id.as_str(), "controller:transform.snv");
    }

    #[test]
    fn operator_selector_matches_plain_class_basename_alias() {
        let mut registry = ControllerRegistry::new();
        registry
            .register(manifest(
                "controller:transform.generic",
                NodeKind::Transform,
                0,
            ))
            .unwrap();
        let mut specific = manifest("controller:transform.mixin", NodeKind::Transform, 0);
        specific
            .operator_selectors
            .push(alias_selector("StandardScaler"));
        registry.register(specific).unwrap();
        let node = node_with_operator(
            NodeKind::Transform,
            json!({"class": "sklearn.preprocessing.StandardScaler"}),
        );

        let resolved = registry.resolve_for_node(&node).unwrap();

        assert_eq!(
            resolved.controller_id.as_str(),
            "controller:transform.mixin"
        );
    }

    #[test]
    fn registry_infers_operator_kind_from_alias_selector() {
        let mut registry = ControllerRegistry::new();
        let mut model = manifest("controller:model.custom", NodeKind::Model, 0);
        model
            .operator_selectors
            .push(alias_selector("ElasticSpectra"));
        registry.register(model).unwrap();

        let kind = registry
            .infer_operator_kind(&json!("ElasticSpectra"))
            .unwrap()
            .unwrap();

        assert_eq!(kind, NodeKind::Model);
    }

    #[test]
    fn registry_refuses_cross_kind_alias_inference() {
        let mut registry = ControllerRegistry::new();
        let mut transform = manifest("controller:transform.custom", NodeKind::Transform, 0);
        transform
            .operator_selectors
            .push(alias_selector("AmbiguousAlias"));
        let mut model = manifest("controller:model.custom", NodeKind::Model, 0);
        model
            .operator_selectors
            .push(alias_selector("AmbiguousAlias"));
        registry.register(transform).unwrap();
        registry.register(model).unwrap();

        let error = registry
            .infer_operator_kind(&json!("AmbiguousAlias"))
            .unwrap_err()
            .to_string();

        assert!(error.contains("different node kinds"));
    }

    #[test]
    fn operator_selector_matches_class_prefix() {
        let mut registry = ControllerRegistry::new();
        let mut sklearn = manifest("controller:sklearn.transform", NodeKind::Transform, 0);
        sklearn.operator_selectors.push(OperatorSelector {
            class_prefixes: BTreeSet::from(["sklearn.preprocessing.".to_string()]),
            ..OperatorSelector::default()
        });
        registry.register(sklearn).unwrap();
        let node = node_with_operator(
            NodeKind::Transform,
            json!({"class": "sklearn.preprocessing.MinMaxScaler"}),
        );

        let resolved = registry.resolve_for_node(&node).unwrap();

        assert_eq!(
            resolved.controller_id.as_str(),
            "controller:sklearn.transform"
        );
    }

    #[test]
    fn equal_priority_operator_selector_matches_are_ambiguous() {
        let mut registry = ControllerRegistry::new();
        let mut first = manifest("controller:snv.a", NodeKind::Transform, 0);
        first.operator_selectors.push(alias_selector("SNV"));
        let mut second = manifest("controller:snv.b", NodeKind::Transform, 0);
        second.operator_selectors.push(alias_selector("SNV"));
        registry.register(first).unwrap();
        registry.register(second).unwrap();
        let node = node_with_operator(NodeKind::Transform, json!({"type": "SNV"}));

        let error = registry.resolve_for_node(&node).unwrap_err().to_string();

        assert!(error.contains("ambiguous controllers"));
    }

    #[test]
    fn selector_only_controller_does_not_catch_unmatched_operator() {
        let mut registry = ControllerRegistry::new();
        let mut snv = manifest("controller:transform.snv", NodeKind::Transform, 0);
        snv.operator_selectors.push(alias_selector("SNV"));
        registry.register(snv).unwrap();
        let node = node_with_operator(NodeKind::Transform, json!("MSC"));

        let error = registry.resolve_for_node(&node).unwrap_err().to_string();

        assert!(error.contains("no controller registered"));
    }

    #[test]
    fn manifest_rejects_prediction_output_without_capability() {
        let mut manifest = manifest("controller:predictor", NodeKind::Model, 0);
        manifest.output_ports.push(PortSpec {
            name: "pred".to_string(),
            kind: PortKind::Prediction,
            representation: None,
            cardinality: PortCardinality::One,
            unit_level: None,
            alignment_key: None,
            target_level: None,
            description: String::new(),
        });

        let error = manifest.validate().unwrap_err().to_string();

        assert!(error.contains("lacks emits_predictions"));
    }

    #[test]
    fn manifest_rejects_training_phases_for_inference_only_controller() {
        let mut manifest = manifest("controller:predict-only", NodeKind::Model, 0);
        manifest.fit_scope = ControllerFitScope::InferenceOnly;

        let error = manifest.validate().unwrap_err().to_string();

        assert!(error.contains("inference_only"));
    }

    #[test]
    fn manifest_requires_configurable_loss_for_specialized_loss_capabilities() {
        for capability in [
            ControllerCapability::SupportsCustomLoss,
            ControllerCapability::SupportsDifferentiableLoss,
        ] {
            let mut manifest = manifest("controller:loss", NodeKind::Model, 0);
            manifest.capabilities.insert(capability);
            assert!(manifest
                .validate()
                .unwrap_err()
                .to_string()
                .contains("without configurable loss"));

            manifest
                .capabilities
                .insert(ControllerCapability::SupportsConfigurableLoss);
            manifest.validate().unwrap();
        }
    }

    #[test]
    fn manifest_validates_model_input_spec_data_requirements() {
        let mut manifest = manifest("controller:data-aware", NodeKind::Model, 0);
        manifest.data_requirements = Some(json!({
            "schema_version": 1,
            "ports": [{
                "name": "x",
                "accepted_representations": ["tabular_numeric"],
                "accepted_types": ["f64"],
                "rank": 2
            }]
        }));

        let input_spec = manifest.model_input_spec().unwrap().unwrap();
        assert_eq!(input_spec.ports[0].name, "x");
        manifest.validate().unwrap();
    }

    #[test]
    fn manifest_rejects_invalid_model_input_spec_data_requirements() {
        let mut manifest = manifest("controller:data-aware", NodeKind::Model, 0);
        manifest.data_requirements = Some(json!({
            "schema_version": 1,
            "ports": [{
                "name": "x",
                "accepted_representations": [],
                "accepted_types": ["f64"]
            }]
        }));

        let error = manifest.validate().unwrap_err().to_string();

        assert!(error.contains("data_requirements"));
        assert!(error.contains("accepted_representations"));
    }

    #[test]
    fn manifest_rejects_empty_operator_selector() {
        let mut manifest = manifest("controller:empty-selector", NodeKind::Transform, 0);
        manifest
            .operator_selectors
            .push(OperatorSelector::default());

        let error = manifest.validate().unwrap_err().to_string();

        assert!(error.contains("empty operator selector"));
    }

    #[test]
    fn manifest_reports_parallel_invocation_support() {
        let mut manifest = manifest("controller:parallel", NodeKind::Model, 0);
        assert!(!manifest.supports_parallel_invocation());
        manifest
            .capabilities
            .insert(ControllerCapability::ProcessSafe);
        assert!(manifest.supports_parallel_invocation());
    }

    #[cfg(dag_ml_workspace_contract_fixtures)]
    #[test]
    fn published_controller_manifest_schema_declares_current_contract() {
        let schema: serde_json::Value = serde_json::from_str(include_str!(
            "../../../docs/contracts/controller_manifest.schema.json"
        ))
        .unwrap();

        assert_eq!(schema["$id"], CONTROLLER_MANIFEST_SCHEMA_ID);
        assert!(schema["required"]
            .as_array()
            .unwrap()
            .iter()
            .any(|field| field.as_str() == Some("controller_id")));
        assert!(schema["$defs"]["controller_capability"]["enum"]
            .as_array()
            .unwrap()
            .iter()
            .any(|capability| capability.as_str() == Some("emits_predictions")));
        assert!(schema["$defs"]["controller_capability"]["enum"]
            .as_array()
            .unwrap()
            .iter()
            .any(|capability| capability.as_str() == Some("aggregates_predictions")));
        assert!(schema["$defs"]["controller_capability"]["enum"]
            .as_array()
            .unwrap()
            .iter()
            .any(|capability| capability.as_str() == Some("supports_custom_loss")));
        assert!(schema["properties"]
            .as_object()
            .unwrap()
            .contains_key("operator_selectors"));
        assert_eq!(
            schema["$defs"]["model_input_spec"]["properties"]["schema_version"]["const"].as_u64(),
            Some(crate::data::MODEL_INPUT_SPEC_SCHEMA_VERSION as u64)
        );
    }
}
