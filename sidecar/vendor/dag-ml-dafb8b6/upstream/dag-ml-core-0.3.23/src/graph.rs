use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::canonical::deserialize_external_contract;
use crate::error::{DagMlError, Result};
use crate::ids::NodeId;
use crate::relation::EntityUnitLevel;

pub const GRAPH_SPEC_SCHEMA_VERSION: u32 = 1;
pub const GRAPH_SPEC_SCHEMA_ID: &str =
    "https://github.com/GBeurier/dag-ml/schemas/graph_spec.v1.schema.json";

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeKind {
    Transform,
    YTransform,
    Split,
    Model,
    Fork,
    Map,
    FeatureJoin,
    PredictionJoin,
    MixedJoin,
    SourceJoin,
    Tag,
    Exclude,
    Augmentation,
    Adapter,
    Aggregator,
    Generator,
    Restructure,
    Tuner,
    Subgraph,
    Chart,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PortKind {
    Data,
    Target,
    Prediction,
    Artifact,
    Metric,
    Control,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PortCardinality {
    One,
    Many,
    Optional,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct PortSpec {
    pub name: String,
    pub kind: PortKind,
    pub representation: Option<String>,
    pub cardinality: PortCardinality,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit_level: Option<EntityUnitLevel>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alignment_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_level: Option<EntityUnitLevel>,
    #[serde(default)]
    pub description: String,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct PortSchema {
    #[serde(default)]
    pub inputs: Vec<PortSpec>,
    #[serde(default)]
    pub outputs: Vec<PortSpec>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct PortRef {
    pub node_id: NodeId,
    pub port_name: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct EdgeContract {
    pub kind: PortKind,
    pub representation: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit_level: Option<EntityUnitLevel>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alignment_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_level: Option<EntityUnitLevel>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relation_contract: Option<RelationContract>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub allows_broadcast: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub missingness_policy: Option<MissingnessPolicy>,
    #[serde(default)]
    pub requires_oof: bool,
    #[serde(default)]
    pub requires_fold_alignment: bool,
    #[serde(default = "default_true")]
    pub propagates_lineage: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct RelationContract {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relation_fingerprint: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub required: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MissingnessPolicy {
    Strict,
    Warn,
    ImputeDeclared,
    Mask,
    PartialModel,
    PadRepresentation,
}

fn default_true() -> bool {
    true
}

fn is_false(value: &bool) -> bool {
    !*value
}

impl EdgeContract {
    pub fn new(kind: PortKind, representation: Option<String>) -> Self {
        Self {
            kind,
            representation,
            unit_level: None,
            alignment_key: None,
            target_level: None,
            relation_contract: None,
            allows_broadcast: false,
            missingness_policy: None,
            requires_oof: false,
            requires_fold_alignment: false,
            propagates_lineage: true,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct EdgeSpec {
    pub source: PortRef,
    pub target: PortRef,
    pub contract: EdgeContract,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct GraphInterface {
    #[serde(default)]
    pub inputs: Vec<PortSpec>,
    #[serde(default)]
    pub outputs: Vec<PortSpec>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NodeSpec {
    pub id: NodeId,
    pub kind: NodeKind,
    pub operator: Option<serde_json::Value>,
    #[serde(default)]
    pub params: BTreeMap<String, serde_json::Value>,
    #[serde(default)]
    pub ports: PortSchema,
    #[serde(default)]
    pub metadata: BTreeMap<String, serde_json::Value>,
    #[serde(default)]
    pub seed_label: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GraphSpec {
    pub id: String,
    #[serde(default)]
    pub interface: GraphInterface,
    #[serde(default)]
    pub nodes: Vec<NodeSpec>,
    #[serde(default)]
    pub edges: Vec<EdgeSpec>,
    #[serde(default)]
    pub search_space_fingerprint: Option<String>,
    #[serde(default)]
    pub metadata: BTreeMap<String, serde_json::Value>,
}

impl GraphSpec {
    /// Parse the published object-only graph JSON representation and validate it.
    pub fn from_json(json: &str) -> Result<Self> {
        let graph: Self =
            deserialize_external_contract(json, "graph", DagMlError::GraphValidation)?;
        graph.validate()?;
        Ok(graph)
    }

    pub fn validate(&self) -> Result<()> {
        if self.id.trim().is_empty() {
            return Err(DagMlError::GraphValidation(
                "graph id must not be empty".to_string(),
            ));
        }
        if self.nodes.is_empty() {
            return Err(DagMlError::GraphValidation(
                "graph must contain at least one node".to_string(),
            ));
        }
        if let Some(fingerprint) = &self.search_space_fingerprint {
            if fingerprint.trim().is_empty() {
                return Err(DagMlError::GraphValidation(format!(
                    "graph `{}` has empty search_space_fingerprint",
                    self.id
                )));
            }
        }

        let mut nodes = BTreeMap::new();
        validate_unique_ports(
            &NodeId::new("graph:interface").expect("static identifier is valid"),
            "interface input",
            &self.interface.inputs,
        )?;
        validate_unique_ports(
            &NodeId::new("graph:interface").expect("static identifier is valid"),
            "interface output",
            &self.interface.outputs,
        )?;
        for node in &self.nodes {
            if nodes.insert(node.id.clone(), node).is_some() {
                return Err(DagMlError::GraphValidation(format!(
                    "duplicate node id `{}`",
                    node.id
                )));
            }
            crate::oof::StackingOofRefitContract::from_metadata(&node.metadata).map_err(
                |error| {
                    DagMlError::GraphValidation(format!(
                        "node `{}` carries invalid `{}` metadata: {}",
                        node.id,
                        crate::oof::STACKING_OOF_REFIT_CONTRACT_METADATA_KEY,
                        error
                    ))
                },
            )?;
            validate_unique_ports(&node.id, "input", &node.ports.inputs)?;
            validate_unique_ports(&node.id, "output", &node.ports.outputs)?;
        }

        let mut adjacency: BTreeMap<NodeId, Vec<NodeId>> = nodes
            .keys()
            .cloned()
            .map(|id| (id, Vec::new()))
            .collect::<BTreeMap<_, _>>();
        let mut indegree: BTreeMap<NodeId, usize> =
            nodes.keys().cloned().map(|id| (id, 0)).collect();

        for edge in &self.edges {
            let source = nodes.get(&edge.source.node_id).ok_or_else(|| {
                DagMlError::GraphValidation(format!(
                    "edge source node `{}` does not exist",
                    edge.source.node_id
                ))
            })?;
            let target = nodes.get(&edge.target.node_id).ok_or_else(|| {
                DagMlError::GraphValidation(format!(
                    "edge target node `{}` does not exist",
                    edge.target.node_id
                ))
            })?;

            let source_port =
                find_port(&source.ports.outputs, &edge.source.port_name).ok_or_else(|| {
                    DagMlError::GraphValidation(format!(
                        "source port `{}.{}` does not exist",
                        edge.source.node_id, edge.source.port_name
                    ))
                })?;
            let target_port =
                find_port(&target.ports.inputs, &edge.target.port_name).ok_or_else(|| {
                    DagMlError::GraphValidation(format!(
                        "target port `{}.{}` does not exist",
                        edge.target.node_id, edge.target.port_name
                    ))
                })?;

            if source_port.kind != edge.contract.kind || target_port.kind != edge.contract.kind {
                return Err(DagMlError::GraphValidation(format!(
                    "edge `{}.{}` -> `{}.{}` has kind {:?}, but ports are {:?} and {:?}",
                    edge.source.node_id,
                    edge.source.port_name,
                    edge.target.node_id,
                    edge.target.port_name,
                    edge.contract.kind,
                    source_port.kind,
                    target_port.kind
                )));
            }
            validate_edge_contract(edge, source_port, target_port)?;
            if edge.contract.requires_oof && edge.contract.kind != PortKind::Prediction {
                return Err(DagMlError::GraphValidation(format!(
                    "edge `{}.{}` -> `{}.{}` requires OOF but is not a prediction edge",
                    edge.source.node_id,
                    edge.source.port_name,
                    edge.target.node_id,
                    edge.target.port_name
                )));
            }

            adjacency
                .get_mut(&edge.source.node_id)
                .expect("source exists")
                .push(edge.target.node_id.clone());
            *indegree
                .get_mut(&edge.target.node_id)
                .expect("target exists") += 1;
        }

        ensure_acyclic(adjacency, indegree)
    }

    pub fn topological_order(&self) -> Result<Vec<NodeId>> {
        self.validate()?;
        let nodes = self
            .nodes
            .iter()
            .map(|node| node.id.clone())
            .collect::<BTreeSet<_>>();
        let mut adjacency = nodes
            .iter()
            .cloned()
            .map(|id| (id, Vec::new()))
            .collect::<BTreeMap<_, _>>();
        let mut indegree: BTreeMap<NodeId, usize> =
            nodes.iter().cloned().map(|id| (id, 0usize)).collect();
        for edge in &self.edges {
            adjacency
                .get_mut(&edge.source.node_id)
                .expect("source exists after validate")
                .push(edge.target.node_id.clone());
            *indegree
                .get_mut(&edge.target.node_id)
                .expect("target exists after validate") += 1;
        }
        topological_order(adjacency, indegree)
    }

    pub fn parallel_levels(&self) -> Result<Vec<Vec<NodeId>>> {
        self.validate()?;
        let nodes = self
            .nodes
            .iter()
            .map(|node| node.id.clone())
            .collect::<BTreeSet<_>>();
        let mut adjacency = nodes
            .iter()
            .cloned()
            .map(|id| (id, Vec::new()))
            .collect::<BTreeMap<_, _>>();
        let mut indegree: BTreeMap<NodeId, usize> =
            nodes.iter().cloned().map(|id| (id, 0usize)).collect();
        for edge in &self.edges {
            adjacency
                .get_mut(&edge.source.node_id)
                .expect("source exists after validate")
                .push(edge.target.node_id.clone());
            *indegree
                .get_mut(&edge.target.node_id)
                .expect("target exists after validate") += 1;
        }
        topological_levels(adjacency, indegree)
    }

    pub fn upstream_nodes(&self, node_id: &NodeId) -> Vec<NodeId> {
        let mut upstream = self
            .edges
            .iter()
            .filter_map(|edge| {
                (edge.target.node_id == *node_id).then_some(edge.source.node_id.clone())
            })
            .collect::<Vec<_>>();
        upstream.sort();
        upstream.dedup();
        upstream
    }

    pub fn downstream_nodes(&self, node_id: &NodeId) -> Vec<NodeId> {
        let mut downstream = self
            .edges
            .iter()
            .filter_map(|edge| {
                (edge.source.node_id == *node_id).then_some(edge.target.node_id.clone())
            })
            .collect::<Vec<_>>();
        downstream.sort();
        downstream.dedup();
        downstream
    }
}

fn validate_unique_ports(node_id: &NodeId, direction: &str, ports: &[PortSpec]) -> Result<()> {
    let mut seen = BTreeSet::new();
    for port in ports {
        if port.name.trim().is_empty() {
            return Err(DagMlError::GraphValidation(format!(
                "{} port on node `{}` has an empty name",
                direction, node_id
            )));
        }
        if !seen.insert(port.name.as_str()) {
            return Err(DagMlError::GraphValidation(format!(
                "duplicate {} port `{}` on node `{}`",
                direction, port.name, node_id
            )));
        }
        validate_port_contract(node_id, direction, port)?;
    }
    Ok(())
}

fn find_port<'a>(ports: &'a [PortSpec], name: &str) -> Option<&'a PortSpec> {
    ports.iter().find(|port| port.name == name)
}

fn validate_port_contract(node_id: &NodeId, direction: &str, port: &PortSpec) -> Result<()> {
    validate_optional_non_empty(
        &format!("{direction} port `{}` representation", port.name),
        port.representation.as_deref(),
    )?;
    validate_optional_non_empty(
        &format!("{direction} port `{}` alignment_key", port.name),
        port.alignment_key.as_deref(),
    )?;
    if port
        .alignment_key
        .as_deref()
        .is_some_and(|key| !is_identifier(key))
    {
        return Err(DagMlError::GraphValidation(format!(
            "{direction} port `{}` on node `{node_id}` has invalid alignment_key",
            port.name
        )));
    }
    Ok(())
}

fn validate_edge_contract(
    edge: &EdgeSpec,
    source_port: &PortSpec,
    target_port: &PortSpec,
) -> Result<()> {
    let label = format!(
        "edge `{}.{}` -> `{}.{}`",
        edge.source.node_id, edge.source.port_name, edge.target.node_id, edge.target.port_name
    );
    validate_optional_non_empty(
        &format!("{label} representation"),
        edge.contract.representation.as_deref(),
    )?;
    validate_optional_non_empty(
        &format!("{label} alignment_key"),
        edge.contract.alignment_key.as_deref(),
    )?;
    if edge
        .contract
        .alignment_key
        .as_deref()
        .is_some_and(|key| !is_identifier(key))
    {
        return Err(DagMlError::GraphValidation(format!(
            "{label} has invalid alignment_key"
        )));
    }
    if let Some(relation_contract) = &edge.contract.relation_contract {
        validate_relation_contract(&label, relation_contract)?;
    }

    validate_edge_unit_alignment(&label, edge, source_port, target_port)?;

    if relation_aware_edge(edge, source_port, target_port) {
        let relation_fingerprint = edge
            .contract
            .relation_contract
            .as_ref()
            .and_then(|contract| contract.relation_fingerprint.as_deref());
        if relation_fingerprint.is_none() {
            return Err(DagMlError::GraphValidation(format!(
                "{label} is relation-aware but has no relation_fingerprint"
            )));
        }
        if !has_effective_unit_level(edge, source_port, target_port) {
            return Err(DagMlError::GraphValidation(format!(
                "{label} is relation-aware but has no unit_level metadata"
            )));
        }
        if !has_effective_alignment_key(edge, source_port, target_port) {
            return Err(DagMlError::GraphValidation(format!(
                "{label} is relation-aware but has no alignment_key"
            )));
        }
    }
    Ok(())
}

fn validate_relation_contract(label: &str, contract: &RelationContract) -> Result<()> {
    if let Some(fingerprint) = &contract.relation_fingerprint {
        validate_sha256(label, "relation_fingerprint", fingerprint)?;
    } else if contract.required {
        return Err(DagMlError::GraphValidation(format!(
            "{label} relation_contract is required but has no relation_fingerprint"
        )));
    }
    Ok(())
}

fn validate_edge_unit_alignment(
    label: &str,
    edge: &EdgeSpec,
    source_port: &PortSpec,
    target_port: &PortSpec,
) -> Result<()> {
    if let Some(contract_unit) = edge.contract.unit_level {
        for (endpoint, unit) in [
            ("source", source_port.unit_level),
            ("target", target_port.unit_level),
        ] {
            if let Some(unit) = unit {
                if unit != contract_unit && !edge.contract.allows_broadcast {
                    return Err(DagMlError::GraphValidation(format!(
                        "{label} {endpoint} unit {:?} does not match edge unit {:?}",
                        unit, contract_unit
                    )));
                }
            }
        }
    }

    if let (Some(source_unit), Some(target_unit)) = (source_port.unit_level, target_port.unit_level)
    {
        if source_unit != target_unit && !edge.contract.allows_broadcast {
            return Err(DagMlError::GraphValidation(format!(
                "{label} joins incompatible unit levels {:?} and {:?}",
                source_unit, target_unit
            )));
        }
    }

    if let (Some(source_target), Some(target_target)) =
        (source_port.target_level, target_port.target_level)
    {
        if source_target != target_target {
            return Err(DagMlError::GraphValidation(format!(
                "{label} joins incompatible target levels {:?} and {:?}",
                source_target, target_target
            )));
        }
    }
    if let Some(contract_target) = edge.contract.target_level {
        for (endpoint, target_level) in [
            ("source", source_port.target_level),
            ("target", target_port.target_level),
        ] {
            if let Some(target_level) = target_level {
                if target_level != contract_target {
                    return Err(DagMlError::GraphValidation(format!(
                        "{label} {endpoint} target level {:?} does not match edge target_level {:?}",
                        target_level, contract_target
                    )));
                }
            }
        }
    }

    if let (Some(source_alignment), Some(target_alignment)) = (
        source_port.alignment_key.as_deref(),
        target_port.alignment_key.as_deref(),
    ) {
        if source_alignment != target_alignment && !edge.contract.allows_broadcast {
            return Err(DagMlError::GraphValidation(format!(
                "{label} joins incompatible alignment keys `{source_alignment}` and `{target_alignment}`"
            )));
        }
    }

    if let Some(edge_alignment) = edge.contract.alignment_key.as_deref() {
        for (endpoint, alignment) in [
            ("source", source_port.alignment_key.as_deref()),
            ("target", target_port.alignment_key.as_deref()),
        ] {
            if let Some(alignment) = alignment {
                if alignment != edge_alignment && !edge.contract.allows_broadcast {
                    return Err(DagMlError::GraphValidation(format!(
                        "{label} {endpoint} alignment `{alignment}` does not match edge alignment `{edge_alignment}`"
                    )));
                }
            }
        }
    }

    if edge.contract.allows_broadcast
        && edge.contract.alignment_key.is_none()
        && source_port.alignment_key.is_none()
        && target_port.alignment_key.is_none()
    {
        return Err(DagMlError::GraphValidation(format!(
            "{label} allows broadcast but declares no alignment_key"
        )));
    }
    Ok(())
}

fn relation_aware_edge(edge: &EdgeSpec, source_port: &PortSpec, target_port: &PortSpec) -> bool {
    edge.contract.relation_contract.is_some()
        || edge.contract.allows_broadcast
        || edge.contract.alignment_key.is_some()
        || non_physical(edge.contract.unit_level)
        || non_physical(edge.contract.target_level)
        || non_physical(source_port.unit_level)
        || non_physical(source_port.target_level)
        || non_physical(target_port.unit_level)
        || non_physical(target_port.target_level)
        || source_port.alignment_key.is_some()
        || target_port.alignment_key.is_some()
}

fn has_effective_unit_level(
    edge: &EdgeSpec,
    source_port: &PortSpec,
    target_port: &PortSpec,
) -> bool {
    edge.contract.unit_level.is_some()
        || source_port.unit_level.is_some()
        || target_port.unit_level.is_some()
}

fn has_effective_alignment_key(
    edge: &EdgeSpec,
    source_port: &PortSpec,
    target_port: &PortSpec,
) -> bool {
    edge.contract.alignment_key.is_some()
        || source_port.alignment_key.is_some()
        || target_port.alignment_key.is_some()
}

fn non_physical(unit_level: Option<EntityUnitLevel>) -> bool {
    unit_level.is_some_and(|level| level != EntityUnitLevel::PhysicalSample)
}

fn validate_optional_non_empty(label: &str, value: Option<&str>) -> Result<()> {
    if value.is_some_and(|value| value.trim().is_empty()) {
        return Err(DagMlError::GraphValidation(format!(
            "{label} must not be empty"
        )));
    }
    Ok(())
}

fn validate_sha256(owner: &str, field: &str, value: &str) -> Result<()> {
    if value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(DagMlError::GraphValidation(format!(
            "{owner} has invalid {field}"
        )))
    }
}

fn is_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.' | b':'))
}

fn ensure_acyclic(
    adjacency: BTreeMap<NodeId, Vec<NodeId>>,
    indegree: BTreeMap<NodeId, usize>,
) -> Result<()> {
    topological_order(adjacency, indegree).map(|_| ())
}

fn topological_order(
    adjacency: BTreeMap<NodeId, Vec<NodeId>>,
    mut indegree: BTreeMap<NodeId, usize>,
) -> Result<Vec<NodeId>> {
    let mut queue = indegree
        .iter()
        .filter_map(|(id, degree)| (*degree == 0).then_some(id.clone()))
        .collect::<BTreeSet<_>>();
    let mut order = Vec::with_capacity(indegree.len());

    while let Some(node) = queue.pop_first() {
        order.push(node.clone());
        if let Some(next_nodes) = adjacency.get(&node) {
            for next in next_nodes {
                let degree = indegree.get_mut(next).expect("node exists");
                *degree -= 1;
                if *degree == 0 {
                    queue.insert(next.clone());
                }
            }
        }
    }

    if order.len() == indegree.len() {
        Ok(order)
    } else {
        Err(DagMlError::GraphValidation(
            "graph contains at least one cycle".to_string(),
        ))
    }
}

fn topological_levels(
    adjacency: BTreeMap<NodeId, Vec<NodeId>>,
    mut indegree: BTreeMap<NodeId, usize>,
) -> Result<Vec<Vec<NodeId>>> {
    let mut queue = indegree
        .iter()
        .filter_map(|(id, degree)| (*degree == 0).then_some(id.clone()))
        .collect::<BTreeSet<_>>();
    let mut levels = Vec::new();
    let mut visited = 0usize;

    while !queue.is_empty() {
        let level = queue.iter().cloned().collect::<Vec<_>>();
        queue.clear();
        for node in &level {
            visited += 1;
            if let Some(next_nodes) = adjacency.get(node) {
                for next in next_nodes {
                    let degree = indegree.get_mut(next).expect("node exists");
                    *degree -= 1;
                    if *degree == 0 {
                        queue.insert(next.clone());
                    }
                }
            }
        }
        levels.push(level);
    }

    if visited == indegree.len() {
        Ok(levels)
    } else {
        Err(DagMlError::GraphValidation(
            "graph contains at least one cycle".to_string(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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

    fn node(id: &str, inputs: Vec<PortSpec>, outputs: Vec<PortSpec>) -> NodeSpec {
        NodeSpec {
            id: NodeId::new(id).unwrap(),
            kind: NodeKind::Model,
            operator: None,
            params: BTreeMap::new(),
            ports: PortSchema { inputs, outputs },
            metadata: BTreeMap::new(),
            seed_label: None,
        }
    }

    fn edge(source: &str, source_port: &str, target: &str, target_port: &str) -> EdgeSpec {
        EdgeSpec {
            source: PortRef {
                node_id: NodeId::new(source).unwrap(),
                port_name: source_port.to_string(),
            },
            target: PortRef {
                node_id: NodeId::new(target).unwrap(),
                port_name: target_port.to_string(),
            },
            contract: EdgeContract {
                requires_oof: true,
                requires_fold_alignment: true,
                ..EdgeContract::new(PortKind::Prediction, None)
            },
        }
    }

    #[test]
    fn validates_simple_graph() {
        let graph = GraphSpec {
            id: "g".to_string(),
            interface: GraphInterface::default(),
            nodes: vec![
                node("model:a", vec![], vec![port("pred", PortKind::Prediction)]),
                node("model:b", vec![port("pred", PortKind::Prediction)], vec![]),
            ],
            edges: vec![edge("model:a", "pred", "model:b", "pred")],
            search_space_fingerprint: None,
            metadata: BTreeMap::new(),
        };

        assert!(graph.validate().is_ok());
    }

    #[test]
    fn computes_deterministic_parallel_levels() {
        let graph = GraphSpec {
            id: "g".to_string(),
            interface: GraphInterface::default(),
            nodes: vec![
                node("model:a", vec![], vec![port("pred", PortKind::Prediction)]),
                node(
                    "model:b",
                    vec![port("pred", PortKind::Prediction)],
                    vec![port("pred", PortKind::Prediction)],
                ),
                node(
                    "model:c",
                    vec![port("pred", PortKind::Prediction)],
                    vec![port("pred", PortKind::Prediction)],
                ),
                node("model:d", vec![port("pred", PortKind::Prediction)], vec![]),
            ],
            edges: vec![
                edge("model:a", "pred", "model:b", "pred"),
                edge("model:a", "pred", "model:c", "pred"),
                edge("model:b", "pred", "model:d", "pred"),
                edge("model:c", "pred", "model:d", "pred"),
            ],
            search_space_fingerprint: None,
            metadata: BTreeMap::new(),
        };

        let levels = graph.parallel_levels().unwrap();

        assert_eq!(
            levels,
            vec![
                vec![NodeId::new("model:a").unwrap()],
                vec![
                    NodeId::new("model:b").unwrap(),
                    NodeId::new("model:c").unwrap()
                ],
                vec![NodeId::new("model:d").unwrap()]
            ]
        );
    }

    #[test]
    fn rejects_missing_edge_endpoint() {
        let graph = GraphSpec {
            id: "g".to_string(),
            interface: GraphInterface::default(),
            nodes: vec![node(
                "model:a",
                vec![],
                vec![port("pred", PortKind::Prediction)],
            )],
            edges: vec![edge("model:a", "pred", "model:b", "pred")],
            search_space_fingerprint: None,
            metadata: BTreeMap::new(),
        };

        assert!(graph.validate().is_err());
    }

    #[test]
    fn rejects_oof_contract_on_non_prediction_edge() {
        let graph = GraphSpec {
            id: "g".to_string(),
            interface: GraphInterface::default(),
            nodes: vec![
                node("model:a", vec![], vec![port("x", PortKind::Data)]),
                node("model:b", vec![port("x", PortKind::Data)], vec![]),
            ],
            edges: vec![EdgeSpec {
                source: PortRef {
                    node_id: NodeId::new("model:a").unwrap(),
                    port_name: "x".to_string(),
                },
                target: PortRef {
                    node_id: NodeId::new("model:b").unwrap(),
                    port_name: "x".to_string(),
                },
                contract: EdgeContract {
                    requires_oof: true,
                    requires_fold_alignment: true,
                    ..EdgeContract::new(PortKind::Data, None)
                },
            }],
            search_space_fingerprint: None,
            metadata: BTreeMap::new(),
        };

        let error = graph.validate().unwrap_err().to_string();

        assert!(error.contains("requires OOF"));
    }

    fn unit_port(name: &str, kind: PortKind, unit_level: EntityUnitLevel) -> PortSpec {
        let mut port = port(name, kind);
        port.unit_level = Some(unit_level);
        port.alignment_key = Some("sample_id".to_string());
        port
    }

    fn data_edge_contract() -> EdgeContract {
        EdgeContract::new(PortKind::Data, Some("tabular".to_string()))
    }

    fn relation_contract() -> RelationContract {
        RelationContract {
            relation_fingerprint: Some("a".repeat(64)),
            required: true,
        }
    }

    #[test]
    fn rejects_unit_mismatch_without_explicit_broadcast() {
        let graph = GraphSpec {
            id: "g".to_string(),
            interface: GraphInterface::default(),
            nodes: vec![
                node(
                    "transform:obs",
                    vec![],
                    vec![unit_port("x", PortKind::Data, EntityUnitLevel::Observation)],
                ),
                node(
                    "join:sample",
                    vec![unit_port(
                        "x",
                        PortKind::Data,
                        EntityUnitLevel::PhysicalSample,
                    )],
                    vec![],
                ),
            ],
            edges: vec![EdgeSpec {
                source: PortRef {
                    node_id: NodeId::new("transform:obs").unwrap(),
                    port_name: "x".to_string(),
                },
                target: PortRef {
                    node_id: NodeId::new("join:sample").unwrap(),
                    port_name: "x".to_string(),
                },
                contract: EdgeContract {
                    relation_contract: Some(relation_contract()),
                    ..data_edge_contract()
                },
            }],
            search_space_fingerprint: None,
            metadata: BTreeMap::new(),
        };

        let error = graph.validate().unwrap_err().to_string();

        assert!(error.contains("incompatible unit levels"));
    }

    #[test]
    fn relation_aware_edge_requires_relation_fingerprint() {
        let graph = GraphSpec {
            id: "g".to_string(),
            interface: GraphInterface::default(),
            nodes: vec![
                node(
                    "source:a",
                    vec![],
                    vec![unit_port("x", PortKind::Data, EntityUnitLevel::Observation)],
                ),
                node(
                    "model:a",
                    vec![unit_port("x", PortKind::Data, EntityUnitLevel::Observation)],
                    vec![],
                ),
            ],
            edges: vec![EdgeSpec {
                source: PortRef {
                    node_id: NodeId::new("source:a").unwrap(),
                    port_name: "x".to_string(),
                },
                target: PortRef {
                    node_id: NodeId::new("model:a").unwrap(),
                    port_name: "x".to_string(),
                },
                contract: data_edge_contract(),
            }],
            search_space_fingerprint: None,
            metadata: BTreeMap::new(),
        };

        let error = graph.validate().unwrap_err().to_string();

        assert!(error.contains("relation-aware"));
    }

    #[test]
    fn relation_aware_edge_requires_alignment_key() {
        let mut source_port = port("x", PortKind::Data);
        source_port.unit_level = Some(EntityUnitLevel::Observation);
        let mut target_port = port("x", PortKind::Data);
        target_port.unit_level = Some(EntityUnitLevel::Observation);

        let graph = GraphSpec {
            id: "g".to_string(),
            interface: GraphInterface::default(),
            nodes: vec![
                node("source:a", vec![], vec![source_port]),
                node("model:a", vec![target_port], vec![]),
            ],
            edges: vec![EdgeSpec {
                source: PortRef {
                    node_id: NodeId::new("source:a").unwrap(),
                    port_name: "x".to_string(),
                },
                target: PortRef {
                    node_id: NodeId::new("model:a").unwrap(),
                    port_name: "x".to_string(),
                },
                contract: EdgeContract {
                    relation_contract: Some(relation_contract()),
                    ..data_edge_contract()
                },
            }],
            search_space_fingerprint: None,
            metadata: BTreeMap::new(),
        };

        let error = graph.validate().unwrap_err().to_string();

        assert!(error.contains("alignment_key"));
    }

    #[test]
    fn explicit_broadcast_allows_sample_to_observation_edge() {
        let mut contract = data_edge_contract();
        contract.allows_broadcast = true;
        contract.alignment_key = Some("sample_id".to_string());
        contract.relation_contract = Some(relation_contract());

        let graph = GraphSpec {
            id: "g".to_string(),
            interface: GraphInterface::default(),
            nodes: vec![
                node(
                    "source:sample",
                    vec![],
                    vec![unit_port(
                        "x",
                        PortKind::Data,
                        EntityUnitLevel::PhysicalSample,
                    )],
                ),
                node(
                    "adapter:broadcast",
                    vec![unit_port("x", PortKind::Data, EntityUnitLevel::Observation)],
                    vec![],
                ),
            ],
            edges: vec![EdgeSpec {
                source: PortRef {
                    node_id: NodeId::new("source:sample").unwrap(),
                    port_name: "x".to_string(),
                },
                target: PortRef {
                    node_id: NodeId::new("adapter:broadcast").unwrap(),
                    port_name: "x".to_string(),
                },
                contract,
            }],
            search_space_fingerprint: None,
            metadata: BTreeMap::new(),
        };

        graph.validate().unwrap();
    }

    #[test]
    fn rejects_cycles() {
        let graph = GraphSpec {
            id: "g".to_string(),
            interface: GraphInterface::default(),
            nodes: vec![
                node(
                    "model:a",
                    vec![port("pred", PortKind::Prediction)],
                    vec![port("pred", PortKind::Prediction)],
                ),
                node(
                    "model:b",
                    vec![port("pred", PortKind::Prediction)],
                    vec![port("pred", PortKind::Prediction)],
                ),
            ],
            edges: vec![
                edge("model:a", "pred", "model:b", "pred"),
                edge("model:b", "pred", "model:a", "pred"),
            ],
            search_space_fingerprint: None,
            metadata: BTreeMap::new(),
        };

        assert!(graph.validate().is_err());
    }

    #[cfg(dag_ml_workspace_contract_fixtures)]
    #[test]
    fn published_graph_spec_schema_declares_current_contract() {
        let schema: serde_json::Value = serde_json::from_str(include_str!(
            "../../../docs/contracts/graph_spec.schema.json"
        ))
        .unwrap();

        assert_eq!(schema["$id"], GRAPH_SPEC_SCHEMA_ID);
        assert!(schema["required"]
            .as_array()
            .unwrap()
            .iter()
            .any(|field| field.as_str() == Some("nodes")));
        assert_eq!(
            schema["$defs"]["node_kind"]["enum"]
                .as_array()
                .unwrap()
                .len(),
            20
        );
        assert!(schema["$defs"]["port_kind"]["enum"]
            .as_array()
            .unwrap()
            .iter()
            .any(|kind| kind.as_str() == Some("prediction")));
        assert!(schema["$defs"]["entity_unit_level"]["enum"]
            .as_array()
            .unwrap()
            .iter()
            .any(|level| level.as_str() == Some("combo")));
        assert!(schema["$defs"]["edge_contract"]["properties"]
            .as_object()
            .unwrap()
            .contains_key("relation_contract"));
    }
}
