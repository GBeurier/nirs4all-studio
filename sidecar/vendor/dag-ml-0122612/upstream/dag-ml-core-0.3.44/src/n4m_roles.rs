//! Controller specs derived from the native `nirs4all-methods` manifest.
//!
//! libn4m publishes every catalog method with its generic roles (ABI 2.13
//! `n4m_method_manifest_json`). This module turns that manifest into one
//! [`HostControllerSpec`] per executable role: the role fixes the node kind,
//! and a single operator selector lists the `n4m:<method_id>` references of
//! every method holding that role. A multi-role method (e.g. a PLS that is
//! both a transformer and a regressor) is listed by one controller per role;
//! the planner picks between them by the node kind the DSL position lowered
//! to, never by the operator alone.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::controller::{ControllerCapability, OperatorSelector, RngPolicy};
use crate::controller_adapter::{manifest_kind_template, HostControllerSpec};
use crate::error::{DagMlError, Result};
use crate::graph::{NodeKind, PortCardinality, PortKind, PortSpec};

/// Operator reference prefix naming one native method: `n4m:<method_id>`.
pub const N4M_OPERATOR_REF_PREFIX: &str = "n4m:";

/// Generic role of a native method, as named by the n4m manifest.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum N4mRole {
    Transformer,
    Selector,
    Regressor,
    Classifier,
    SampleFilter,
    Splitter,
    Augmenter,
    Generic,
}

impl N4mRole {
    /// Node kind a method of this role lowers to; generic procedures have no
    /// graph node.
    pub fn node_kind(self) -> Option<NodeKind> {
        match self {
            Self::Transformer | Self::Selector => Some(NodeKind::Transform),
            Self::Regressor | Self::Classifier => Some(NodeKind::Model),
            Self::SampleFilter => Some(NodeKind::Exclude),
            Self::Splitter => Some(NodeKind::Split),
            Self::Augmenter => Some(NodeKind::Augmentation),
            Self::Generic => None,
        }
    }

    /// Stable controller id serving every method of this role.
    pub fn controller_id(self) -> Option<&'static str> {
        match self {
            Self::Transformer => Some("controller:n4m.transformer"),
            Self::Selector => Some("controller:n4m.selector"),
            Self::Regressor => Some("controller:n4m.regressor"),
            Self::Classifier => Some("controller:n4m.classifier"),
            Self::SampleFilter => Some("controller:n4m.sample_filter"),
            Self::Splitter => Some("controller:n4m.splitter"),
            Self::Augmenter => Some("controller:n4m.augmenter"),
            Self::Generic => None,
        }
    }

    pub fn from_controller_id(controller_id: &str) -> Option<Self> {
        N4M_GRAPH_ROLES
            .into_iter()
            .find(|role| role.controller_id() == Some(controller_id))
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Transformer => "transformer",
            Self::Selector => "selector",
            Self::Regressor => "regressor",
            Self::Classifier => "classifier",
            Self::SampleFilter => "sample_filter",
            Self::Splitter => "splitter",
            Self::Augmenter => "augmenter",
            Self::Generic => "generic",
        }
    }
}

/// Roles that lower to a graph node, in controller derivation order.
pub const N4M_GRAPH_ROLES: [N4mRole; 7] = [
    N4mRole::Transformer,
    N4mRole::Selector,
    N4mRole::Regressor,
    N4mRole::Classifier,
    N4mRole::SampleFilter,
    N4mRole::Splitter,
    N4mRole::Augmenter,
];

/// The subset of the native manifest that controller derivation reads.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct N4mManifest {
    pub abi: String,
    pub methods: Vec<N4mManifestMethod>,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct N4mManifestMethod {
    pub method_id: String,
    pub roles: Vec<N4mRole>,
    pub node_kinds: Vec<NodeKind>,
}

impl N4mManifest {
    pub fn from_json(manifest_json: &str) -> Result<Self> {
        let manifest: Self = serde_json::from_str(manifest_json).map_err(|error| {
            DagMlError::ControllerValidation(format!("invalid n4m method manifest: {error}"))
        })?;
        manifest.validate()?;
        Ok(manifest)
    }

    /// Rejects an empty ABI, duplicate or blank ids, role-less methods and any
    /// method whose declared node kinds differ from the kinds its roles lower
    /// to, so a manifest drift can never silently re-route a method.
    pub fn validate(&self) -> Result<()> {
        let invalid = |reason: String| {
            Err(DagMlError::ControllerValidation(format!(
                "invalid n4m method manifest: {reason}"
            )))
        };
        if self.abi.trim().is_empty() {
            return invalid("empty abi".to_string());
        }
        let mut seen = BTreeSet::new();
        for method in &self.methods {
            if method.method_id.trim().is_empty() || method.method_id != method.method_id.trim() {
                return invalid(format!("blank method id {:?}", method.method_id));
            }
            if !seen.insert(method.method_id.as_str()) {
                return invalid(format!("duplicate method `{}`", method.method_id));
            }
            if method.roles.is_empty() {
                return invalid(format!("method `{}` has no role", method.method_id));
            }
            let mut expected = Vec::new();
            for kind in method.roles.iter().filter_map(|role| role.node_kind()) {
                if !expected.contains(&kind) {
                    expected.push(kind);
                }
            }
            let declared = &method.node_kinds;
            if declared.len() != expected.len()
                || !expected.iter().all(|kind| declared.contains(kind))
            {
                return invalid(format!(
                    "method `{}` declares node kinds {:?} but its roles {:?} lower to {:?}",
                    method.method_id, declared, method.roles, expected
                ));
            }
        }
        Ok(())
    }

    /// Method ids holding `role`, in manifest order.
    pub fn method_ids(&self, role: N4mRole) -> impl Iterator<Item = &str> {
        self.methods
            .iter()
            .filter(move |method| method.roles.contains(&role))
            .map(|method| method.method_id.as_str())
    }
}

/// Derive one [`HostControllerSpec`] per graph role present in the n4m
/// manifest JSON. Roles without a method are omitted; generic procedures have
/// no node kind and never get a controller.
pub fn n4m_host_controller_specs(manifest_json: &str) -> Result<Vec<HostControllerSpec>> {
    let manifest = N4mManifest::from_json(manifest_json)?;
    let version = format!("n4m-abi-{}", manifest.abi);
    let mut specs = Vec::new();
    let mut claimed = BTreeMap::<&str, Vec<(NodeKind, N4mRole)>>::new();
    for role in N4M_GRAPH_ROLES {
        let (Some(kind), Some(controller_id)) = (role.node_kind(), role.controller_id()) else {
            continue;
        };
        let method_ids = manifest.method_ids(role).collect::<Vec<_>>();
        if method_ids.is_empty() {
            continue;
        }
        for method_id in &method_ids {
            let claims = claimed.entry(method_id).or_default();
            if let Some((_, other)) = claims
                .iter()
                .find(|(claimed_kind, _)| *claimed_kind == kind)
            {
                return Err(DagMlError::ControllerValidation(format!(
                    "n4m method `{method_id}` is both {} and {}, which lower to the same node kind {kind:?}",
                    other.as_str(),
                    role.as_str()
                )));
            }
            claims.push((kind.clone(), role));
        }
        let mut spec = HostControllerSpec::new(controller_id, version.clone(), kind.clone());
        spec.rng_policy = RngPolicy::ExternallyDeterministic;
        spec.operator_selectors = vec![OperatorSelector {
            refs: method_ids
                .iter()
                .map(|method_id| format!("{N4M_OPERATOR_REF_PREFIX}{method_id}"))
                .collect(),
            ..OperatorSelector::default()
        }];
        if matches!(role, N4mRole::Transformer | N4mRole::Selector) {
            // A fitted transform is replayed from its exported N4ME state.
            spec.added_capabilities = BTreeSet::from([
                ControllerCapability::Stateful,
                ControllerCapability::EmitsArtifacts,
            ]);
            let mut outputs = manifest_kind_template(&kind).output_ports;
            outputs.push(PortSpec {
                name: "model".to_string(),
                kind: PortKind::Artifact,
                representation: None,
                cardinality: PortCardinality::One,
                unit_level: None,
                alignment_key: None,
                target_level: None,
                description: String::new(),
            });
            spec.output_ports = Some(outputs);
        }
        if matches!(
            role,
            N4mRole::Transformer | N4mRole::Selector | N4mRole::Regressor | N4mRole::Classifier
        ) {
            // These native roles export their actual REFIT state as N4ME and
            // hydrate it for PREDICT. Train-only filters/augmenters and split
            // controllers do not share that durable-state contract.
            spec.added_capabilities
                .insert(ControllerCapability::SupportsPortableFullRefit);
        }
        specs.push(spec);
    }
    Ok(specs)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::controller::ControllerFitScope;
    use crate::controller_adapter::derive_host_controller_registry;
    use crate::graph::{NodeSpec, PortSchema};
    use crate::ids::NodeId;
    use crate::phase::Phase;

    fn method(id: &str, roles: &[&str], node_kinds: &[&str]) -> serde_json::Value {
        json!({
            "method_id": id,
            "fq_name": format!("n4m.{id}"),
            "kind": "estimator",
            "roles": roles,
            "node_kinds": node_kinds,
            "capabilities": [],
            "state_format": "",
            "inputs": {},
            "params": [],
        })
    }

    fn manifest() -> String {
        json!({
            "abi": "2.13.0",
            "methods": [
                method("preprocessing.scatter.snv", &["transformer"], &["transform"]),
                method("models.pls.pls_regression", &["transformer", "regressor"], &["model", "transform"]),
                method("models.pls.cppls", &["regressor"], &["model"]),
                method("filters.variance", &["selector"], &["transform"]),
                method("models.classification.pls_lda", &["classifier"], &["model"]),
                method("filters.y_outlier", &["sample_filter"], &["exclude"]),
                method("splitters.kennard_stone", &["splitter"], &["split"]),
                method("augmentation.drift.linear_drift", &["augmenter"], &["augmentation"]),
                method("diagnostics.model_selection", &["generic"], &[]),
            ],
        })
        .to_string()
    }

    fn node(kind: NodeKind, operator: &str) -> NodeSpec {
        NodeSpec {
            id: NodeId::new("node:n4m").unwrap(),
            kind,
            operator: Some(json!(operator)),
            params: BTreeMap::new(),
            ports: PortSchema::default(),
            metadata: BTreeMap::new(),
            seed_label: None,
        }
    }

    /// ABI 2.14 adds a per-parameter `recorded` flag and publishes optional
    /// seeds with a `null` default; derivation reads roles and node kinds only.
    #[test]
    fn abi_2_14_parameter_keys_do_not_change_derivation() {
        let mut v214: serde_json::Value = serde_json::from_str(&manifest()).unwrap();
        v214["abi"] = json!("2.14.0");
        for method in v214["methods"].as_array_mut().unwrap() {
            method["params"] = json!([
                {"name": "n_components", "type": "int", "required": false, "default": 2,
                 "min": 1, "max": null, "choices": [], "recorded": true},
                {"name": "seed", "type": "int", "required": false, "default": null,
                 "min": 0, "max": null, "choices": [], "recorded": false}
            ]);
        }
        let derived = n4m_host_controller_specs(&v214.to_string()).unwrap();
        let baseline = n4m_host_controller_specs(&manifest()).unwrap();
        assert_eq!(derived.len(), baseline.len());
        for (derived, baseline) in derived.iter().zip(&baseline) {
            assert_eq!(derived.controller_id, baseline.controller_id);
            assert_eq!(derived.operator_selectors, baseline.operator_selectors);
            assert_eq!(derived.controller_version, "n4m-abi-2.14.0");
        }
    }

    #[test]
    fn every_graph_role_gets_one_controller_with_its_methods() {
        let specs = n4m_host_controller_specs(&manifest()).unwrap();
        let by_id = specs
            .iter()
            .map(|spec| (spec.controller_id.as_str(), spec))
            .collect::<BTreeMap<_, _>>();
        assert_eq!(specs.len(), N4M_GRAPH_ROLES.len());
        for role in N4M_GRAPH_ROLES {
            let spec = by_id[role.controller_id().unwrap()];
            assert_eq!(Some(spec.operator_kind.clone()), role.node_kind());
            assert_eq!(spec.controller_version, "n4m-abi-2.13.0");
            assert_eq!(N4mRole::from_controller_id(&spec.controller_id), Some(role));
        }
        let refs = |role: N4mRole| {
            by_id[role.controller_id().unwrap()].operator_selectors[0]
                .refs
                .iter()
                .cloned()
                .collect::<Vec<_>>()
        };
        assert_eq!(
            refs(N4mRole::Transformer),
            vec![
                "n4m:models.pls.pls_regression",
                "n4m:preprocessing.scatter.snv"
            ]
        );
        assert_eq!(
            refs(N4mRole::Regressor),
            vec!["n4m:models.pls.cppls", "n4m:models.pls.pls_regression"]
        );
        assert_eq!(refs(N4mRole::SampleFilter), vec!["n4m:filters.y_outlier"]);
        assert!(specs.iter().all(|spec| !spec.operator_selectors[0]
            .refs
            .contains("n4m:diagnostics.model_selection")));
    }

    #[test]
    fn derived_manifests_carry_role_ports_phases_and_state() {
        let manifests = n4m_host_controller_specs(&manifest())
            .unwrap()
            .into_iter()
            .map(|spec| {
                let manifest = spec.derive().unwrap();
                (manifest.controller_id.as_str().to_string(), manifest)
            })
            .collect::<BTreeMap<_, _>>();
        fn ports(ports: &[PortSpec]) -> Vec<(&str, PortKind, PortCardinality)> {
            ports
                .iter()
                .map(|port| {
                    (
                        port.name.as_str(),
                        port.kind.clone(),
                        port.cardinality.clone(),
                    )
                })
                .collect()
        }
        let training = BTreeSet::from([Phase::FitCv, Phase::Refit, Phase::Predict]);

        for id in ["controller:n4m.transformer", "controller:n4m.selector"] {
            let manifest = &manifests[id];
            assert_eq!(manifest.supported_phases, training);
            assert_eq!(
                ports(&manifest.input_ports),
                vec![("x", PortKind::Data, PortCardinality::One)]
            );
            assert_eq!(
                ports(&manifest.output_ports),
                vec![
                    ("x_out", PortKind::Data, PortCardinality::One),
                    ("model", PortKind::Artifact, PortCardinality::One),
                ]
            );
            assert!(manifest
                .capabilities
                .contains(&ControllerCapability::Stateful));
            assert!(manifest
                .capabilities
                .contains(&ControllerCapability::EmitsArtifacts));
        }
        for id in ["controller:n4m.regressor", "controller:n4m.classifier"] {
            let manifest = &manifests[id];
            assert_eq!(manifest.operator_kind, NodeKind::Model);
            assert!(manifest
                .capabilities
                .contains(&ControllerCapability::EmitsPredictions));
            assert!(manifest
                .capabilities
                .contains(&ControllerCapability::Stateful));
        }

        let filter = &manifests["controller:n4m.sample_filter"];
        assert_eq!(filter.operator_kind, NodeKind::Exclude);
        assert_eq!(filter.supported_phases, training);
        assert_eq!(filter.fit_scope, ControllerFitScope::FoldTrain);
        assert_eq!(
            ports(&filter.input_ports),
            vec![
                ("x", PortKind::Data, PortCardinality::One),
                ("y", PortKind::Target, PortCardinality::Optional),
            ]
        );
        assert_eq!(
            ports(&filter.output_ports),
            vec![("x_out", PortKind::Data, PortCardinality::One)]
        );
        assert!(filter
            .capabilities
            .contains(&ControllerCapability::ShapeChanging));
        assert!(!filter
            .capabilities
            .contains(&ControllerCapability::Stateful));
        let filter_input = filter.model_input_spec().unwrap().unwrap();
        assert_eq!(
            filter_input
                .ports
                .iter()
                .map(|port| (port.name.as_str(), port.optional))
                .collect::<Vec<_>>(),
            vec![("x", false), ("y", true)]
        );

        let splitter = &manifests["controller:n4m.splitter"];
        assert_eq!(splitter.operator_kind, NodeKind::Split);
        assert_eq!(splitter.supported_phases, BTreeSet::from([Phase::Plan]));
        assert_eq!(splitter.fit_scope, ControllerFitScope::Stateless);
        assert_eq!(
            ports(&splitter.output_ports),
            vec![("folds", PortKind::Control, PortCardinality::One)]
        );

        let augmenter = &manifests["controller:n4m.augmenter"];
        assert_eq!(augmenter.operator_kind, NodeKind::Augmentation);
        assert_eq!(augmenter.supported_phases, training);
        assert_eq!(
            ports(&augmenter.output_ports),
            vec![("x_out", PortKind::Data, PortCardinality::One)]
        );
        assert!(augmenter
            .capabilities
            .contains(&ControllerCapability::ShapeChanging));
    }

    #[test]
    fn multi_role_method_resolves_by_node_kind_and_refuses_minimal_alias() {
        let registry =
            derive_host_controller_registry(&n4m_host_controller_specs(&manifest()).unwrap())
                .unwrap();
        let resolve = |kind: NodeKind, operator: &str| {
            registry
                .resolve_for_node(&node(kind, operator))
                .unwrap()
                .controller_id
                .as_str()
                .to_string()
        };
        assert_eq!(
            resolve(NodeKind::Model, "n4m:models.pls.pls_regression"),
            "controller:n4m.regressor"
        );
        assert_eq!(
            resolve(NodeKind::Transform, "n4m:models.pls.pls_regression"),
            "controller:n4m.transformer"
        );
        assert_eq!(
            resolve(NodeKind::Transform, "n4m:filters.variance"),
            "controller:n4m.selector"
        );
        assert_eq!(
            resolve(NodeKind::Exclude, "n4m:filters.y_outlier"),
            "controller:n4m.sample_filter"
        );
        assert!(registry
            .resolve_for_node(&node(NodeKind::Model, "n4m:preprocessing.scatter.snv"))
            .is_err());
        assert!(registry
            .infer_operator_kind(&json!("n4m:models.pls.pls_regression"))
            .unwrap_err()
            .to_string()
            .contains("different node kinds"));
        assert_eq!(
            registry
                .infer_operator_kind(&json!({"ref": "n4m:models.pls.cppls"}))
                .unwrap(),
            Some(NodeKind::Model)
        );
    }

    #[test]
    fn manifest_drift_and_same_kind_role_overlap_are_refused() {
        let drift = json!({
            "abi": "2.13.0",
            "methods": [method("preprocessing.scatter.snv", &["transformer"], &["model"])],
        });
        assert!(n4m_host_controller_specs(&drift.to_string())
            .unwrap_err()
            .to_string()
            .contains("lower to"));
        let overlap = json!({
            "abi": "2.13.0",
            "methods": [method("filters.odd", &["transformer", "selector"], &["transform"])],
        });
        assert!(n4m_host_controller_specs(&overlap.to_string())
            .unwrap_err()
            .to_string()
            .contains("same node kind"));
        let duplicate = json!({
            "abi": "2.13.0",
            "methods": [
                method("filters.variance", &["selector"], &["transform"]),
                method("filters.variance", &["selector"], &["transform"]),
            ],
        });
        assert!(n4m_host_controller_specs(&duplicate.to_string())
            .unwrap_err()
            .to_string()
            .contains("duplicate"));
        assert!(n4m_host_controller_specs("{\"abi\": \"\", \"methods\": []}").is_err());
    }
}
