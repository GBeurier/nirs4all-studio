//! Mechanical derivation of `ControllerManifest`s from a thin host-controller
//! descriptor — the dag-ml side of the `OperatorController -> ControllerManifest`
//! adapter (`DEC-CTRL-001` / the "B1" adapter).
//!
//! ## Why this lives in the core
//!
//! Today every host hand-authors a static array of manifest literals (the
//! nirs4all bridge's `controller_manifests()` ships five) and Studio rebuilds a
//! *parallel* node registry by walking importable Python classes. Both encode,
//! by hand, the per-kind facts that are actually deterministic — the
//! "Inferable" rows of the controller-adapter spec: a `model` node supports
//! `FIT_CV/REFIT/PREDICT`, fits per fold, emits a prediction and an artifact
//! port; a `transform` maps `x -> x_out`; and so on. Encoding those facts once,
//! natively, means every binding (Python / R / WASM / cluster) derives the same
//! validated manifest for free instead of re-deriving — or drifting from — them.
//!
//! ## The two-layer projection
//!
//! An `OperatorController.matches()` predicate mixes two independent routing
//! dimensions that project to different places:
//!
//! 1. **keyword / DSL position -> `operator_kind`** ("Layer 1"). This is a
//!    *compile-time lowering rule* owned by the DSL compiler, not a manifest
//!    field; by the time a manifest is derived the host already knows the
//!    [`NodeKind`], so it is an *input* here. Given that kind, this module fills
//!    in the mechanical defaults via [`manifest_kind_template`].
//! 2. **operator class / type -> `operator_selectors`** ("Layer 2"). These are
//!    supplied verbatim by the host as [`OperatorSelector`]s (the existing
//!    selector vocabulary) and are how a *specialization* manifest (e.g. a
//!    native PLS controller) out-ranks a generic kind-level catch-all.
//!
//! This module invents no new capability/policy vocabulary: a derived manifest
//! is an ordinary [`ControllerManifest`] over the existing
//! [`ControllerCapability`] / [`ControllerFitScope`] / [`RngPolicy`] /
//! [`ArtifactPolicy`] enums, and every derivation is run through
//! [`ControllerManifest::validate`] before it is returned, so it can never
//! produce a manifest the registry would reject.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::controller::{
    ArtifactPolicy, ControllerCapability, ControllerFitScope, ControllerManifest,
    ControllerRegistry, OperatorSelector, RngPolicy,
};
use crate::data::{ModelInputPortSpec, ModelInputSpec, MODEL_INPUT_SPEC_SCHEMA_VERSION};
use crate::error::{DagMlError, Result};
use crate::graph::{NodeKind, PortCardinality, PortKind, PortSpec};
use crate::ids::ControllerId;
use crate::phase::Phase;

/// Frozen representation id for a generic numeric feature table — the
/// modality-neutral default stamped on **data** ports of a derived manifest.
/// Published by the dag-ml-data representation registry
/// (`docs/contracts/representation_registry.v1.json`, registry id
/// `dag-ml-data.representation_registry.v1`, `type_id = "table"`).
pub const REPRESENTATION_TABULAR_NUMERIC: &str = "tabular_numeric";

/// Frozen representation id for a generic numeric target — the modality-neutral
/// default stamped on **target** ports of a derived manifest. Published by the
/// same registry (`type_id = "target"`). This replaces the previous coarse
/// behaviour that (incorrectly) stamped the *feature*-table id on target ports.
pub const REPRESENTATION_TARGET_NUMERIC: &str = "target_numeric";

/// `(representation_id, type_id)` rows mirrored verbatim from the frozen
/// dag-ml-data representation registry
/// (`docs/contracts/representation_registry.v1.json`). dag-ml does not depend on
/// dag-ml-data, so the registry's MVP-emitted representations — plus the generic
/// `tabular_*` ids the kind templates default to — are mirrored here as the
/// in-core source of truth used to synthesize a controller's [`ModelInputSpec`].
/// The full 26-id list is CI-gated against the sibling registry by the L20
/// contract-lockstep (`scripts/validate_contracts.py`); this subset is the part
/// the controller adapter consumes.
const FROZEN_REPRESENTATION_TYPES: &[(&str, &str)] = &[
    // Generic, modality-neutral (the kind-template defaults).
    (REPRESENTATION_TABULAR_NUMERIC, "table"),
    ("tabular_mixed", "table"),
    // MVP-emitted data representations (spectra/image profile).
    ("signal_1d", "dense_signal"),
    ("signal_with_processings", "dense_signal"),
    ("feature_block_set", "multi_block"),
    // MVP-emitted target representations.
    (REPRESENTATION_TARGET_NUMERIC, "target"),
    ("target_categorical", "target"),
    ("target_numeric_matrix", "target"),
    ("target_categorical_matrix", "target"),
    // MVP-emitted per-sample metadata.
    ("sample_metadata", "metadata"),
];

/// Return the frozen `type_id` registered for `representation_id`, or `None`
/// when the id is outside the mirrored registry subset. Hosts use this to type a port while
/// building an explicit `data_requirements` override; the adapter uses it to
/// synthesize the default one.
pub fn representation_type_id(representation_id: &str) -> Option<&'static str> {
    FROZEN_REPRESENTATION_TYPES
        .iter()
        .find(|(id, _)| *id == representation_id)
        .map(|(_, type_id)| *type_id)
}

/// The mechanical, per-[`NodeKind`] portion of a [`ControllerManifest`]: the
/// fields a host does *not* need to author because they follow deterministically
/// from the node kind. [`HostControllerSpec::derive`] composes one of these with
/// the host-supplied identity/selectors/overrides.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ManifestKindTemplate {
    /// Phases the kind participates in.
    pub supported_phases: BTreeSet<Phase>,
    /// When fitted state is established.
    pub fit_scope: ControllerFitScope,
    /// Capabilities implied by the kind alone (the host may add more).
    pub capabilities: BTreeSet<ControllerCapability>,
    /// Default input ports.
    pub input_ports: Vec<PortSpec>,
    /// Default output ports.
    pub output_ports: Vec<PortSpec>,
}

/// Return the deterministic manifest defaults for `kind`.
///
/// Kinds that the current vertical slice binds (`transform`, `y_transform`,
/// `model`, `prediction_join`) get the exact template the nirs4all bridge hand
/// authors today; any other kind gets a conservative, always-valid generic
/// template (training-capable, fold-scoped, no ports) that a host refines with
/// [`HostControllerSpec`] overrides.
pub fn manifest_kind_template(kind: &NodeKind) -> ManifestKindTemplate {
    let training_phases = || BTreeSet::from([Phase::FitCv, Phase::Refit, Phase::Predict]);
    match kind {
        NodeKind::Transform => ManifestKindTemplate {
            supported_phases: training_phases(),
            fit_scope: ControllerFitScope::FoldTrain,
            capabilities: stateless_compute_capabilities(),
            input_ports: vec![represented_port(
                "x",
                PortKind::Data,
                REPRESENTATION_TABULAR_NUMERIC,
            )],
            output_ports: vec![represented_port(
                "x_out",
                PortKind::Data,
                REPRESENTATION_TABULAR_NUMERIC,
            )],
        },
        NodeKind::YTransform => ManifestKindTemplate {
            supported_phases: training_phases(),
            fit_scope: ControllerFitScope::FoldTrain,
            capabilities: stateless_compute_capabilities(),
            input_ports: vec![represented_port(
                "y",
                PortKind::Target,
                REPRESENTATION_TARGET_NUMERIC,
            )],
            output_ports: vec![represented_port(
                "y_out",
                PortKind::Target,
                REPRESENTATION_TARGET_NUMERIC,
            )],
        },
        NodeKind::Model => ManifestKindTemplate {
            supported_phases: training_phases(),
            fit_scope: ControllerFitScope::FoldTrain,
            capabilities: {
                let mut capabilities = stateless_compute_capabilities();
                capabilities.insert(ControllerCapability::EmitsPredictions);
                capabilities.insert(ControllerCapability::EmitsArtifacts);
                capabilities.insert(ControllerCapability::Stateful);
                capabilities
            },
            input_ports: vec![represented_port(
                "x",
                PortKind::Data,
                REPRESENTATION_TABULAR_NUMERIC,
            )],
            output_ports: vec![
                opaque_port("y_hat", PortKind::Prediction, PortCardinality::One),
                opaque_port("model", PortKind::Artifact, PortCardinality::One),
            ],
        },
        NodeKind::PredictionJoin => ManifestKindTemplate {
            supported_phases: training_phases(),
            fit_scope: ControllerFitScope::FoldTrain,
            capabilities: {
                let mut capabilities = base_capabilities();
                capabilities.insert(ControllerCapability::ConsumesOofPredictions);
                capabilities.insert(ControllerCapability::EmitsPredictions);
                capabilities
            },
            input_ports: vec![opaque_port(
                "oof",
                PortKind::Prediction,
                PortCardinality::Many,
            )],
            output_ports: vec![opaque_port(
                "oof",
                PortKind::Prediction,
                PortCardinality::One,
            )],
        },
        _ => ManifestKindTemplate {
            supported_phases: training_phases(),
            fit_scope: ControllerFitScope::FoldTrain,
            capabilities: base_capabilities(),
            input_ports: Vec::new(),
            output_ports: Vec::new(),
        },
    }
}

/// Host-side description of one `OperatorController`, the input from which a
/// validated [`ControllerManifest`] is mechanically derived.
///
/// Construct with [`HostControllerSpec::new`] (which fills policy defaults) and
/// set any explicit overrides on the public fields, then call
/// [`HostControllerSpec::derive`]. The struct is `serde`-(de)serializable so a
/// host that drives the core over JSON / PyO3 / the process adapter can ship the
/// descriptor directly rather than re-implementing the per-kind defaults — the
/// authoritative wire artifact remains the derived `ControllerManifest`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostControllerSpec {
    /// Stable controller id, e.g. `controller:nirs4all.model`.
    pub controller_id: String,
    /// Controller/runtime version (must be non-empty; checked at derive time).
    pub controller_version: String,
    /// The node kind this controller serves (Layer-1 lowering output).
    pub operator_kind: NodeKind,
    /// Resolution priority (lower wins). Defaults to `0`; nirs4all's bridge
    /// uses `20` to keep generic host controllers above native specializations.
    #[serde(default)]
    pub priority: u32,
    /// Capabilities to add on top of the kind template (existing vocabulary
    /// only) — e.g. `needs_python_gil` for a deep-learning model controller, or
    /// `consumes_oof_predictions` for a stacking meta-model.
    #[serde(default)]
    pub added_capabilities: BTreeSet<ControllerCapability>,
    /// Layer-2 selectors that bind specific operators to this controller. Empty
    /// makes the manifest a kind-level catch-all.
    #[serde(default)]
    pub operator_selectors: Vec<OperatorSelector>,
    /// RNG policy. Defaults to `uses_core_seed`.
    #[serde(default = "default_rng_policy")]
    pub rng_policy: RngPolicy,
    /// Artifact policy. Defaults to `serializable`.
    #[serde(default = "default_artifact_policy")]
    pub artifact_policy: ArtifactPolicy,
    /// Optional `ModelInputSpec` JSON; validated by the manifest if present.
    #[serde(default)]
    pub data_requirements: Option<serde_json::Value>,
    /// Override the kind template's input ports (e.g. a meta-model consuming an
    /// `oof` prediction port instead of an `x` data port). `None` keeps the
    /// template default.
    #[serde(default)]
    pub input_ports: Option<Vec<PortSpec>>,
    /// Override the kind template's output ports. `None` keeps the default.
    #[serde(default)]
    pub output_ports: Option<Vec<PortSpec>>,
}

impl HostControllerSpec {
    /// A spec with policy/priority defaults and no overrides.
    pub fn new(
        controller_id: impl Into<String>,
        controller_version: impl Into<String>,
        operator_kind: NodeKind,
    ) -> Self {
        Self {
            controller_id: controller_id.into(),
            controller_version: controller_version.into(),
            operator_kind,
            priority: 0,
            added_capabilities: BTreeSet::new(),
            operator_selectors: Vec::new(),
            rng_policy: default_rng_policy(),
            artifact_policy: default_artifact_policy(),
            data_requirements: None,
            input_ports: None,
            output_ports: None,
        }
    }

    /// Derive the [`ControllerManifest`], applying the kind template, merging
    /// `added_capabilities`, honoring port overrides, synthesizing
    /// `data_requirements` from the resolved data/target ports when the host did
    /// not supply one, and validating the result.
    ///
    /// When the host leaves `data_requirements` unset, a [`ModelInputSpec`] is
    /// synthesized that pins — per data/target input port — the frozen registry
    /// representation id and its `type_id`; an explicit `data_requirements` is
    /// always preferred over the synthesized one. Returns
    /// [`crate::error::DagMlError::ControllerValidation`] (or an invalid
    /// identifier error) if the composed manifest is not registry-admissible —
    /// e.g. an empty version, or an output port whose required capability the
    /// host neither inherited nor added.
    pub fn derive(&self) -> Result<ControllerManifest> {
        let ManifestKindTemplate {
            supported_phases,
            fit_scope,
            mut capabilities,
            input_ports,
            output_ports,
        } = manifest_kind_template(&self.operator_kind);
        capabilities.extend(self.added_capabilities.iter().copied());

        let input_ports = self.input_ports.clone().unwrap_or(input_ports);
        let output_ports = self.output_ports.clone().unwrap_or(output_ports);
        let data_requirements = match &self.data_requirements {
            Some(requirements) => Some(requirements.clone()),
            None => default_data_requirements(&input_ports)?,
        };

        let manifest = ControllerManifest {
            controller_id: ControllerId::new(self.controller_id.clone())?,
            controller_version: self.controller_version.clone(),
            operator_kind: self.operator_kind.clone(),
            priority: self.priority,
            supported_phases,
            input_ports,
            output_ports,
            data_requirements,
            capabilities,
            operator_selectors: self.operator_selectors.clone(),
            fit_scope,
            rng_policy: self.rng_policy,
            artifact_policy: self.artifact_policy,
        };
        manifest.validate()?;
        Ok(manifest)
    }
}

/// Derive every spec and register the manifests into a fresh
/// [`ControllerRegistry`], surfacing the first derivation or duplicate-id error.
/// This is the one call a runtime needs to turn its declared host controllers
/// into a resolvable registry — the replacement for a hardcoded static node
/// registry.
pub fn derive_host_controller_registry(specs: &[HostControllerSpec]) -> Result<ControllerRegistry> {
    let mut registry = ControllerRegistry::new();
    for spec in specs {
        registry.register(spec.derive()?)?;
    }
    Ok(registry)
}

fn default_rng_policy() -> RngPolicy {
    RngPolicy::UsesCoreSeed
}

fn default_artifact_policy() -> ArtifactPolicy {
    ArtifactPolicy::Serializable
}

fn base_capabilities() -> BTreeSet<ControllerCapability> {
    BTreeSet::from([
        ControllerCapability::Deterministic,
        ControllerCapability::ThreadSafe,
        ControllerCapability::ProcessSafe,
    ])
}

fn stateless_compute_capabilities() -> BTreeSet<ControllerCapability> {
    let mut capabilities = base_capabilities();
    capabilities.insert(ControllerCapability::UsesCoreRng);
    capabilities
}

fn represented_port(name: &str, kind: PortKind, representation: &str) -> PortSpec {
    PortSpec {
        name: name.to_string(),
        kind,
        representation: Some(representation.to_string()),
        cardinality: PortCardinality::One,
        unit_level: None,
        alignment_key: None,
        target_level: None,
        description: String::new(),
    }
}

/// Synthesize the default `data_requirements` (a [`ModelInputSpec`] encoded as
/// JSON) describing the data a controller consumes, derived from its resolved
/// data/target input ports.
///
/// Each `Data`/`Target` input port that carries a representation present in the
/// frozen registry mirror ([`FROZEN_REPRESENTATION_TYPES`]) contributes one
/// [`ModelInputPortSpec`] accepting that representation id and its registry
/// `type_id`. Returns `Ok(None)` when the controller declares no such port (e.g.
/// a prediction-join consuming only OOF predictions) or when a data/target port
/// carries a representation outside the mirrored subset — in the latter case the
/// host is expected to supply an explicit `data_requirements`, which
/// [`HostControllerSpec::derive`] always prefers over this synthesis.
fn default_data_requirements(input_ports: &[PortSpec]) -> Result<Option<serde_json::Value>> {
    let mut ports = Vec::new();
    for port in input_ports {
        if !matches!(port.kind, PortKind::Data | PortKind::Target) {
            continue;
        }
        let Some(representation) = port.representation.as_deref() else {
            continue;
        };
        let Some(type_id) = representation_type_id(representation) else {
            return Ok(None);
        };
        ports.push(ModelInputPortSpec {
            name: port.name.clone(),
            accepted_representations: vec![representation.to_string()],
            accepted_types: vec![type_id.to_string()],
            rank: None,
            multi_source: false,
            optional: matches!(port.cardinality, PortCardinality::Optional),
            metadata: BTreeMap::new(),
        });
    }
    if ports.is_empty() {
        return Ok(None);
    }
    let spec = ModelInputSpec {
        schema_version: MODEL_INPUT_SPEC_SCHEMA_VERSION,
        ports,
        default_fusion: None,
        fit_influence_policy: None,
        metadata: BTreeMap::new(),
    };
    let requirements = serde_json::to_value(&spec).map_err(|error| {
        DagMlError::ControllerValidation(format!(
            "failed to encode synthesized data_requirements: {error}"
        ))
    })?;
    Ok(Some(requirements))
}

fn opaque_port(name: &str, kind: PortKind, cardinality: PortCardinality) -> PortSpec {
    PortSpec {
        name: name.to_string(),
        kind,
        representation: None,
        cardinality,
        unit_level: None,
        alignment_key: None,
        target_level: None,
        description: String::new(),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use serde_json::json;

    use super::*;
    use crate::graph::NodeSpec;
    use crate::ids::NodeId;

    const VERSION: &str = "0.10.0";

    fn capabilities(values: &[ControllerCapability]) -> BTreeSet<ControllerCapability> {
        values.iter().copied().collect()
    }

    fn node_with_operator(kind: NodeKind, operator: Option<serde_json::Value>) -> NodeSpec {
        NodeSpec {
            id: NodeId::new("node:under-test").unwrap(),
            kind,
            operator,
            params: BTreeMap::new(),
            ports: crate::graph::PortSchema::default(),
            metadata: BTreeMap::new(),
            seed_label: None,
        }
    }

    /// The four kind-level catch-alls must reproduce the nirs4all bridge's
    /// hand-authored manifests field-for-field — this is the parity contract
    /// that lets the bridge stop hand-writing them.
    #[test]
    fn transform_template_matches_bridge_manifest() {
        let mut spec = HostControllerSpec::new(
            "controller:nirs4all.transform",
            VERSION,
            NodeKind::Transform,
        );
        spec.priority = 20;
        let manifest = spec.derive().expect("transform derives");

        assert_eq!(manifest.operator_kind, NodeKind::Transform);
        assert_eq!(manifest.priority, 20);
        assert_eq!(
            manifest.supported_phases,
            BTreeSet::from([Phase::FitCv, Phase::Refit, Phase::Predict])
        );
        assert_eq!(
            manifest.capabilities,
            capabilities(&[
                ControllerCapability::Deterministic,
                ControllerCapability::ThreadSafe,
                ControllerCapability::ProcessSafe,
                ControllerCapability::UsesCoreRng,
            ])
        );
        assert_eq!(
            manifest.input_ports,
            vec![represented_port(
                "x",
                PortKind::Data,
                REPRESENTATION_TABULAR_NUMERIC
            )]
        );
        assert_eq!(
            manifest.output_ports,
            vec![represented_port(
                "x_out",
                PortKind::Data,
                REPRESENTATION_TABULAR_NUMERIC
            )]
        );
        assert_eq!(manifest.fit_scope, ControllerFitScope::FoldTrain);
        assert_eq!(manifest.rng_policy, RngPolicy::UsesCoreSeed);
        assert_eq!(manifest.artifact_policy, ArtifactPolicy::Serializable);
        assert!(manifest.operator_selectors.is_empty());
    }

    #[test]
    fn y_transform_template_targets_y_ports() {
        let manifest = HostControllerSpec::new(
            "controller:nirs4all.y_transform",
            VERSION,
            NodeKind::YTransform,
        )
        .derive()
        .expect("y_transform derives");

        assert_eq!(
            manifest.input_ports,
            vec![represented_port(
                "y",
                PortKind::Target,
                REPRESENTATION_TARGET_NUMERIC
            )]
        );
        assert_eq!(
            manifest.output_ports,
            vec![represented_port(
                "y_out",
                PortKind::Target,
                REPRESENTATION_TARGET_NUMERIC
            )]
        );
        assert_eq!(
            manifest.capabilities,
            capabilities(&[
                ControllerCapability::Deterministic,
                ControllerCapability::ThreadSafe,
                ControllerCapability::ProcessSafe,
                ControllerCapability::UsesCoreRng,
            ])
        );
    }

    #[test]
    fn model_template_emits_prediction_and_artifact_ports() {
        let manifest =
            HostControllerSpec::new("controller:nirs4all.model", VERSION, NodeKind::Model)
                .derive()
                .expect("model derives");

        assert_eq!(
            manifest.capabilities,
            capabilities(&[
                ControllerCapability::Deterministic,
                ControllerCapability::ThreadSafe,
                ControllerCapability::ProcessSafe,
                ControllerCapability::UsesCoreRng,
                ControllerCapability::EmitsPredictions,
                ControllerCapability::EmitsArtifacts,
                ControllerCapability::Stateful,
            ])
        );
        assert_eq!(
            manifest.input_ports,
            vec![represented_port(
                "x",
                PortKind::Data,
                REPRESENTATION_TABULAR_NUMERIC
            )]
        );
        assert_eq!(
            manifest.output_ports,
            vec![
                opaque_port("y_hat", PortKind::Prediction, PortCardinality::One),
                opaque_port("model", PortKind::Artifact, PortCardinality::One),
            ]
        );
    }

    #[test]
    fn prediction_join_template_matches_merge_concat() {
        let manifest = HostControllerSpec::new(
            "controller:nirs4all.merge_concat",
            VERSION,
            NodeKind::PredictionJoin,
        )
        .derive()
        .expect("prediction_join derives");

        assert_eq!(
            manifest.capabilities,
            capabilities(&[
                ControllerCapability::Deterministic,
                ControllerCapability::ThreadSafe,
                ControllerCapability::ProcessSafe,
                ControllerCapability::ConsumesOofPredictions,
                ControllerCapability::EmitsPredictions,
            ])
        );
        assert_eq!(
            manifest.input_ports,
            vec![opaque_port(
                "oof",
                PortKind::Prediction,
                PortCardinality::Many
            )]
        );
        assert_eq!(
            manifest.output_ports,
            vec![opaque_port(
                "oof",
                PortKind::Prediction,
                PortCardinality::One
            )]
        );
    }

    /// A specialization manifest: model kind, but consumes OOF, takes an `oof`
    /// input port instead of `x`, and carries a `refs` selector so it stays out
    /// of the generic model catch-all (the meta-model pattern).
    #[test]
    fn meta_model_specialization_overrides_ports_and_caps() {
        let mut spec =
            HostControllerSpec::new("controller:nirs4all.meta_model", VERSION, NodeKind::Model);
        spec.priority = 20;
        spec.added_capabilities
            .insert(ControllerCapability::ConsumesOofPredictions);
        spec.input_ports = Some(vec![opaque_port(
            "oof",
            PortKind::Prediction,
            PortCardinality::Many,
        )]);
        spec.operator_selectors.push(OperatorSelector {
            refs: BTreeSet::from(["nirs4all.meta_model".to_string()]),
            ..OperatorSelector::default()
        });
        let manifest = spec.derive().expect("meta_model derives");

        assert_eq!(
            manifest.capabilities,
            capabilities(&[
                ControllerCapability::Deterministic,
                ControllerCapability::ThreadSafe,
                ControllerCapability::ProcessSafe,
                ControllerCapability::UsesCoreRng,
                ControllerCapability::ConsumesOofPredictions,
                ControllerCapability::EmitsPredictions,
                ControllerCapability::EmitsArtifacts,
                ControllerCapability::Stateful,
            ])
        );
        assert_eq!(
            manifest.input_ports,
            vec![opaque_port(
                "oof",
                PortKind::Prediction,
                PortCardinality::Many
            )]
        );
        // Output ports still inherit the model template default.
        assert_eq!(
            manifest.output_ports,
            vec![
                opaque_port("y_hat", PortKind::Prediction, PortCardinality::One),
                opaque_port("model", PortKind::Artifact, PortCardinality::One),
            ]
        );
        assert_eq!(manifest.operator_selectors.len(), 1);
    }

    /// The binding-extension path: a selector-bearing native specialization
    /// out-ranks the generic kind-level controller for the operators it claims,
    /// while bare operators still fall through to the generic one.
    #[test]
    fn selector_specialization_outranks_generic_in_registry() {
        let mut pls = HostControllerSpec::new("controller:methods.pls", VERSION, NodeKind::Model);
        pls.priority = 10;
        pls.operator_selectors.push(OperatorSelector {
            aliases: BTreeSet::from(["PLSRegression".to_string(), "PLS".to_string()]),
            ..OperatorSelector::default()
        });
        let registry = derive_host_controller_registry(&[
            HostControllerSpec::new("controller:nirs4all.model", VERSION, NodeKind::Model),
            pls,
        ])
        .expect("registry derives");

        let pls_node = node_with_operator(NodeKind::Model, Some(json!({"class": "PLSRegression"})));
        assert_eq!(
            registry
                .resolve_for_node(&pls_node)
                .unwrap()
                .controller_id
                .as_str(),
            "controller:methods.pls"
        );

        let generic_node = node_with_operator(NodeKind::Model, Some(json!({"class": "Ridge"})));
        assert_eq!(
            registry
                .resolve_for_node(&generic_node)
                .unwrap()
                .controller_id
                .as_str(),
            "controller:nirs4all.model"
        );
    }

    #[test]
    fn derive_propagates_validation_failure_for_empty_version() {
        let spec = HostControllerSpec::new("controller:nirs4all.model", "", NodeKind::Model);
        let error = spec.derive().unwrap_err().to_string();
        assert!(error.contains("empty version"), "unexpected error: {error}");
    }

    /// Overrides are validated too: a prediction output port on a transform
    /// (whose template lacks `emits_predictions`) is rejected.
    #[test]
    fn derive_rejects_override_that_violates_capability_invariant() {
        let mut spec =
            HostControllerSpec::new("controller:bad.transform", VERSION, NodeKind::Transform);
        spec.output_ports = Some(vec![opaque_port(
            "leak",
            PortKind::Prediction,
            PortCardinality::One,
        )]);
        let error = spec.derive().unwrap_err().to_string();
        assert!(
            error.contains("lacks emits_predictions"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn generic_template_for_unmapped_kind_validates() {
        // A kind with no bespoke template still derives a valid, generic manifest.
        let manifest = HostControllerSpec::new("controller:host.tag", VERSION, NodeKind::Tag)
            .derive()
            .expect("tag derives");
        assert!(manifest.input_ports.is_empty());
        assert!(manifest.output_ports.is_empty());
        assert_eq!(
            manifest.capabilities,
            capabilities(&[
                ControllerCapability::Deterministic,
                ControllerCapability::ThreadSafe,
                ControllerCapability::ProcessSafe,
            ])
        );
    }

    #[test]
    fn host_controller_spec_round_trips_through_json() {
        let mut spec =
            HostControllerSpec::new("controller:nirs4all.model", VERSION, NodeKind::Model);
        spec.priority = 20;
        spec.added_capabilities
            .insert(ControllerCapability::NeedsPythonGil);
        let encoded = serde_json::to_string(&spec).expect("encode");
        let decoded: HostControllerSpec = serde_json::from_str(&encoded).expect("decode");
        assert_eq!(spec, decoded);
        // And the descriptor decoded from the wire derives the same manifest.
        assert_eq!(spec.derive().unwrap(), decoded.derive().unwrap());
    }

    #[test]
    fn minimal_json_descriptor_applies_defaults() {
        // Only the three required fields; policies/priority/ports defaulted.
        let spec: HostControllerSpec = serde_json::from_value(json!({
            "controller_id": "controller:nirs4all.transform",
            "controller_version": VERSION,
            "operator_kind": "transform",
        }))
        .expect("decode minimal");
        assert_eq!(spec.priority, 0);
        assert_eq!(spec.rng_policy, RngPolicy::UsesCoreSeed);
        assert_eq!(spec.artifact_policy, ArtifactPolicy::Serializable);
        let manifest = spec.derive().expect("derives");
        assert_eq!(manifest.operator_kind, NodeKind::Transform);
    }

    // --- B-014b: data/target ports carry frozen registry representation ids,
    //     and `data_requirements` is synthesized as a validated ModelInputSpec.

    /// The frozen-registry mirror maps the ids it publishes to the registry's
    /// `type_id`, and reports nothing for ids outside the subset.
    #[test]
    fn representation_type_id_maps_frozen_registry_ids() {
        assert_eq!(
            representation_type_id(REPRESENTATION_TABULAR_NUMERIC),
            Some("table")
        );
        assert_eq!(
            representation_type_id(REPRESENTATION_TARGET_NUMERIC),
            Some("target")
        );
        assert_eq!(representation_type_id("signal_1d"), Some("dense_signal"));
        assert_eq!(
            representation_type_id("feature_block_set"),
            Some("multi_block")
        );
        assert_eq!(representation_type_id("sample_metadata"), Some("metadata"));
        assert_eq!(representation_type_id("not_a_real_representation"), None);
    }

    /// A model's `x` data port now carries the generic `tabular_numeric` id and
    /// `derive()` synthesizes a matching, validated `ModelInputSpec`.
    #[test]
    fn model_template_synthesizes_tabular_data_requirements() {
        let manifest =
            HostControllerSpec::new("controller:nirs4all.model", VERSION, NodeKind::Model)
                .derive()
                .expect("model derives");
        assert_eq!(
            manifest.input_ports[0].representation.as_deref(),
            Some(REPRESENTATION_TABULAR_NUMERIC)
        );
        let spec = manifest
            .model_input_spec()
            .expect("data_requirements parse")
            .expect("model has synthesized data_requirements");
        assert_eq!(spec.schema_version, MODEL_INPUT_SPEC_SCHEMA_VERSION);
        assert_eq!(spec.ports.len(), 1);
        assert_eq!(spec.ports[0].name, "x");
        assert_eq!(
            spec.ports[0].accepted_representations,
            vec![REPRESENTATION_TABULAR_NUMERIC.to_string()]
        );
        assert_eq!(spec.ports[0].accepted_types, vec!["table".to_string()]);
        assert!(!spec.ports[0].optional);
    }

    /// A y_transform's `y` port now carries the `target_numeric` id (not the
    /// feature-table id it wrongly used before) and the synthesized
    /// `data_requirements` pins the target representation.
    #[test]
    fn y_transform_synthesizes_target_data_requirements() {
        let manifest = HostControllerSpec::new(
            "controller:nirs4all.y_transform",
            VERSION,
            NodeKind::YTransform,
        )
        .derive()
        .expect("y_transform derives");
        assert_eq!(
            manifest.input_ports[0].representation.as_deref(),
            Some(REPRESENTATION_TARGET_NUMERIC)
        );
        let spec = manifest
            .model_input_spec()
            .expect("data_requirements parse")
            .expect("y_transform has synthesized data_requirements");
        assert_eq!(spec.ports.len(), 1);
        assert_eq!(spec.ports[0].name, "y");
        assert_eq!(
            spec.ports[0].accepted_representations,
            vec![REPRESENTATION_TARGET_NUMERIC.to_string()]
        );
        assert_eq!(spec.ports[0].accepted_types, vec!["target".to_string()]);
    }

    /// A prediction-join consumes only OOF predictions (an opaque port), so it
    /// has no data/target requirement to synthesize.
    #[test]
    fn prediction_join_has_no_data_requirements() {
        let manifest = HostControllerSpec::new(
            "controller:nirs4all.merge_concat",
            VERSION,
            NodeKind::PredictionJoin,
        )
        .derive()
        .expect("prediction_join derives");
        assert!(manifest.data_requirements.is_none());
        assert!(manifest.model_input_spec().unwrap().is_none());
    }

    /// An explicit host-supplied `data_requirements` is preserved verbatim — the
    /// adapter never overwrites it with the synthesized default.
    #[test]
    fn host_supplied_data_requirements_take_precedence_over_synthesis() {
        let mut spec =
            HostControllerSpec::new("controller:nirs4all.model", VERSION, NodeKind::Model);
        spec.data_requirements = Some(json!({
            "schema_version": 1,
            "ports": [{
                "name": "x",
                "accepted_representations": ["signal_1d", "signal_with_processings"],
                "accepted_types": ["dense_signal"],
            }],
        }));
        let manifest = spec.derive().expect("model derives");
        let parsed = manifest
            .model_input_spec()
            .expect("parse")
            .expect("present");
        assert_eq!(
            parsed.ports[0].accepted_representations,
            vec![
                "signal_1d".to_string(),
                "signal_with_processings".to_string()
            ]
        );
    }

    /// Synthesis follows the *resolved* ports: overriding the data port to a
    /// different frozen id (e.g. the NIRS `signal_1d`) re-pins the synthesized
    /// `data_requirements` to that id and its registry `type_id`.
    #[test]
    fn port_override_with_known_representation_resyncs_data_requirements() {
        let mut spec = HostControllerSpec::new("controller:methods.pls", VERSION, NodeKind::Model);
        spec.input_ports = Some(vec![represented_port("x", PortKind::Data, "signal_1d")]);
        let manifest = spec.derive().expect("model derives");
        let parsed = manifest.model_input_spec().unwrap().expect("present");
        assert_eq!(parsed.ports.len(), 1);
        assert_eq!(
            parsed.ports[0].accepted_representations,
            vec!["signal_1d".to_string()]
        );
        assert_eq!(
            parsed.ports[0].accepted_types,
            vec!["dense_signal".to_string()]
        );
    }

    /// A representation outside the mirrored registry subset cannot be typed, so
    /// synthesis is skipped and the host is expected to supply requirements.
    #[test]
    fn port_override_with_unknown_representation_skips_synthesis() {
        let mut spec = HostControllerSpec::new("controller:methods.pls", VERSION, NodeKind::Model);
        spec.input_ports = Some(vec![represented_port(
            "x",
            PortKind::Data,
            "totally_unregistered_representation",
        )]);
        let manifest = spec.derive().expect("model derives");
        assert!(
            manifest.data_requirements.is_none(),
            "unknown representation must not be auto-typed"
        );
    }
}
