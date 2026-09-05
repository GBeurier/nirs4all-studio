use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet, BinaryHeap};

use serde::{Deserialize, Serialize};

use crate::error::{DataError, Result};
use crate::ids::{RepresentationId, TypeId};
use crate::plan::{FitScope, PlanIssue};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct InputPortSpec {
    pub name: String,
    pub accepted_representations: Vec<RepresentationId>,
    pub accepted_types: Vec<TypeId>,
    pub rank: Option<usize>,
    #[serde(default)]
    pub multi_source: bool,
    #[serde(default)]
    pub optional: bool,
}

impl InputPortSpec {
    pub fn validate(&self) -> Result<()> {
        validate_name("input port", &self.name)?;
        if self.accepted_representations.is_empty() {
            return Err(DataError::Validation(format!(
                "input port `{}` accepts no representations",
                self.name
            )));
        }
        if self.accepted_types.is_empty() {
            return Err(DataError::Validation(format!(
                "input port `{}` accepts no types",
                self.name
            )));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ModelInputSpec {
    pub ports: Vec<InputPortSpec>,
    #[serde(default)]
    pub default_fusion: Option<serde_json::Value>,
}

impl ModelInputSpec {
    pub fn validate(&self) -> Result<()> {
        if self.ports.is_empty() {
            return Err(DataError::Validation(
                "model input spec contains no ports".to_string(),
            ));
        }
        let mut names = BTreeSet::new();
        for port in &self.ports {
            port.validate()?;
            if !names.insert(port.name.as_str()) {
                return Err(DataError::Validation(format!(
                    "duplicate model input port `{}`",
                    port.name
                )));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AdapterSpec {
    pub id: String,
    pub version: String,
    pub input_type: TypeId,
    pub input_representation: RepresentationId,
    pub output_type: TypeId,
    pub output_representation: RepresentationId,
    pub cost: u64,
    #[serde(default)]
    pub lossy: bool,
    #[serde(default)]
    pub supervised: bool,
    #[serde(default)]
    pub stateful: bool,
    #[serde(default = "default_true")]
    pub deterministic: bool,
    pub fit_scope: FitScope,
    #[serde(default)]
    pub params: BTreeMap<String, serde_json::Value>,
}

fn default_true() -> bool {
    true
}

impl AdapterSpec {
    pub fn validate(&self) -> Result<()> {
        validate_name("adapter", &self.id)?;
        validate_name("adapter version", &self.version)?;
        if !self.deterministic {
            return Err(DataError::Validation(format!(
                "adapter `{}` is not deterministic",
                self.id
            )));
        }
        if self.stateful && self.fit_scope == FitScope::Stateless {
            return Err(DataError::Validation(format!(
                "stateful adapter `{}` cannot use stateless fit scope",
                self.id
            )));
        }
        Ok(())
    }

    fn source(&self) -> RepresentationNode {
        RepresentationNode {
            type_id: self.input_type.clone(),
            representation_id: self.input_representation.clone(),
        }
    }

    fn target(&self) -> RepresentationNode {
        RepresentationNode {
            type_id: self.output_type.clone(),
            representation_id: self.output_representation.clone(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct PlanningPolicy {
    #[serde(default)]
    pub allow_lossy: bool,
    #[serde(default)]
    pub allow_stateful: bool,
    #[serde(default)]
    pub allow_supervised: bool,
    #[serde(default)]
    pub forbidden_adapters: BTreeSet<String>,
    #[serde(default)]
    pub preferred_adapters: BTreeSet<String>,
    #[serde(default = "default_true")]
    pub require_user_choice_on_ambiguity: bool,
    pub max_hops: Option<usize>,
}

impl Default for PlanningPolicy {
    fn default() -> Self {
        Self {
            allow_lossy: false,
            allow_stateful: false,
            allow_supervised: false,
            forbidden_adapters: BTreeSet::new(),
            preferred_adapters: BTreeSet::new(),
            require_user_choice_on_ambiguity: true,
            max_hops: None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
pub struct RepresentationNode {
    pub type_id: TypeId,
    pub representation_id: RepresentationId,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AdapterPath {
    pub adapters: Vec<AdapterSpec>,
    pub total_cost: u64,
    pub effective_score: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PathResolution {
    pub path: Option<AdapterPath>,
    #[serde(default)]
    pub requires_user_choice: bool,
    #[serde(default)]
    pub issues: Vec<PlanIssue>,
}

impl PathResolution {
    pub fn resolved(path: AdapterPath) -> Self {
        Self {
            path: Some(path),
            requires_user_choice: false,
            issues: Vec::new(),
        }
    }

    pub fn unresolved(code: &str, message: String, choices: Vec<String>) -> Self {
        Self {
            path: None,
            requires_user_choice: !choices.is_empty(),
            issues: vec![PlanIssue {
                code: code.to_string(),
                message,
                choices,
            }],
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct AdapterRegistry {
    adapters: BTreeMap<String, AdapterSpec>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AdapterRegistrySpec {
    #[serde(default)]
    pub adapters: Vec<AdapterSpec>,
}

impl AdapterRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_spec(spec: AdapterRegistrySpec) -> Result<Self> {
        let mut registry = Self::new();
        for adapter in spec.adapters {
            registry.register_adapter(adapter)?;
        }
        Ok(registry)
    }

    pub fn register_adapter(&mut self, adapter: AdapterSpec) -> Result<()> {
        adapter.validate()?;
        if self.adapters.contains_key(&adapter.id) {
            return Err(DataError::Validation(format!(
                "duplicate adapter id `{}`",
                adapter.id
            )));
        }
        self.adapters.insert(adapter.id.clone(), adapter);
        Ok(())
    }

    pub fn adapters(&self) -> impl Iterator<Item = &AdapterSpec> {
        self.adapters.values()
    }

    pub fn find_path(
        &self,
        source_type: &TypeId,
        source_representation: &RepresentationId,
        target_type: &TypeId,
        target_representation: &RepresentationId,
        policy: &PlanningPolicy,
    ) -> PathResolution {
        let start = RepresentationNode {
            type_id: source_type.clone(),
            representation_id: source_representation.clone(),
        };
        let goal = RepresentationNode {
            type_id: target_type.clone(),
            representation_id: target_representation.clone(),
        };
        if start == goal {
            return PathResolution::resolved(AdapterPath {
                adapters: Vec::new(),
                total_cost: 0,
                effective_score: 0,
            });
        }

        let mut edges: BTreeMap<RepresentationNode, Vec<&AdapterSpec>> = BTreeMap::new();
        for adapter in self.adapters.values() {
            if policy.forbidden_adapters.contains(&adapter.id) {
                continue;
            }
            if adapter.lossy && !policy.allow_lossy {
                continue;
            }
            if adapter.stateful && !policy.allow_stateful {
                continue;
            }
            if adapter.supervised && !policy.allow_supervised {
                continue;
            }
            edges.entry(adapter.source()).or_default().push(adapter);
        }

        let mut heap = BinaryHeap::new();
        heap.push(SearchState {
            score: 0,
            raw_cost: 0,
            hops: 0,
            node: start.clone(),
            adapter_ids: Vec::new(),
        });

        let mut best_seen: BTreeMap<RepresentationNode, (u64, usize)> = BTreeMap::new();
        best_seen.insert(start.clone(), (0, 0));
        let mut best_goal: Option<(u64, usize, u64)> = None;
        let mut goal_paths = Vec::new();

        while let Some(state) = heap.pop() {
            if let Some((best_score, best_hops, _)) = best_goal {
                if (state.score, state.hops) > (best_score, best_hops) {
                    break;
                }
            }
            if state.node == goal {
                best_goal.get_or_insert((state.score, state.hops, state.raw_cost));
                goal_paths.push(state.adapter_ids);
                continue;
            }
            if policy
                .max_hops
                .is_some_and(|max_hops| state.hops >= max_hops)
            {
                continue;
            }
            let Some(next_edges) = edges.get(&state.node) else {
                continue;
            };
            for adapter in next_edges {
                if state.adapter_ids.iter().any(|id| id == &adapter.id) {
                    continue;
                }
                let next = adapter.target();
                let score = state.score + adapter_score(adapter, policy);
                let raw_cost = state.raw_cost + adapter.cost;
                let hops = state.hops + 1;
                if best_seen.get(&next).is_some_and(|(best_score, best_hops)| {
                    (score, hops) > (*best_score, *best_hops)
                }) {
                    continue;
                }
                best_seen.insert(next.clone(), (score, hops));
                let mut adapter_ids = state.adapter_ids.clone();
                adapter_ids.push(adapter.id.clone());
                heap.push(SearchState {
                    score,
                    raw_cost,
                    hops,
                    node: next,
                    adapter_ids,
                });
            }
        }

        if goal_paths.is_empty() {
            return PathResolution::unresolved(
                "no_path",
                format!(
                    "no adapter path from `{}/{}` to `{}/{}`",
                    source_type, source_representation, target_type, target_representation
                ),
                Vec::new(),
            );
        }

        goal_paths.sort();
        goal_paths.dedup();
        if goal_paths.len() > 1 && policy.require_user_choice_on_ambiguity {
            let choices = goal_paths
                .iter()
                .map(|path| path.join(" -> "))
                .collect::<Vec<_>>();
            return PathResolution::unresolved(
                "ambiguous_path",
                "multiple equivalent adapter paths require user choice".to_string(),
                choices,
            );
        }

        let adapter_ids = goal_paths.remove(0);
        let adapters = adapter_ids
            .iter()
            .map(|id| self.adapters.get(id).expect("path adapter exists").clone())
            .collect::<Vec<_>>();
        let total_cost = adapters.iter().map(|adapter| adapter.cost).sum();
        let effective_score = adapters
            .iter()
            .map(|adapter| adapter_score(adapter, policy))
            .sum();
        PathResolution::resolved(AdapterPath {
            adapters,
            total_cost,
            effective_score,
        })
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct SearchState {
    score: u64,
    raw_cost: u64,
    hops: usize,
    node: RepresentationNode,
    adapter_ids: Vec<String>,
}

impl Ord for SearchState {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .score
            .cmp(&self.score)
            .then_with(|| other.hops.cmp(&self.hops))
            .then_with(|| other.raw_cost.cmp(&self.raw_cost))
            .then_with(|| other.node.cmp(&self.node))
            .then_with(|| other.adapter_ids.cmp(&self.adapter_ids))
    }
}

impl PartialOrd for SearchState {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

fn adapter_score(adapter: &AdapterSpec, policy: &PlanningPolicy) -> u64 {
    let mut score = adapter.cost.max(1);
    if adapter.lossy {
        score += 1_000_000;
    }
    if adapter.stateful {
        score += 100_000;
    }
    if adapter.supervised {
        score += 100_000;
    }
    if policy.preferred_adapters.contains(&adapter.id) {
        score = score.saturating_sub(1);
    }
    score
}

fn validate_name(kind: &str, value: &str) -> Result<()> {
    if value.trim().is_empty() {
        return Err(DataError::Validation(format!("{kind} name is empty")));
    }
    if !value
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.' | b':' | b'/'))
    {
        return Err(DataError::Validation(format!(
            "{kind} `{value}` contains unsupported characters"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tid(value: &str) -> TypeId {
        TypeId::new(value).unwrap()
    }

    fn rid(value: &str) -> RepresentationId {
        RepresentationId::new(value).unwrap()
    }

    fn adapter(id: &str, input: &str, output: &str, cost: u64) -> AdapterSpec {
        AdapterSpec {
            id: id.to_string(),
            version: "0.1.0".to_string(),
            input_type: tid("dense_signal"),
            input_representation: rid(input),
            output_type: if output == "tabular_numeric" {
                tid("table")
            } else {
                tid("dense_signal")
            },
            output_representation: rid(output),
            cost,
            lossy: false,
            supervised: false,
            stateful: false,
            deterministic: true,
            fit_scope: FitScope::Stateless,
            params: BTreeMap::new(),
        }
    }

    #[test]
    fn validates_model_input_ports() {
        let spec = ModelInputSpec {
            ports: vec![InputPortSpec {
                name: "X".to_string(),
                accepted_representations: vec![rid("tabular_numeric")],
                accepted_types: vec![tid("table")],
                rank: Some(2),
                multi_source: true,
                optional: false,
            }],
            default_fusion: None,
        };

        assert!(spec.validate().is_ok());
    }

    #[test]
    fn rejects_duplicate_adapter_ids() {
        let mut registry = AdapterRegistry::new();
        registry
            .register_adapter(adapter(
                "spectra.flatten",
                "signal_1d",
                "tabular_numeric",
                1,
            ))
            .unwrap();

        assert!(registry
            .register_adapter(adapter(
                "spectra.flatten",
                "signal_1d",
                "tabular_numeric",
                1
            ))
            .is_err());
    }

    #[test]
    fn path_selection_is_registration_order_independent() {
        let mut left = AdapterRegistry::new();
        left.register_adapter(adapter("a.to_mid", "signal_1d", "signal_mid", 1))
            .unwrap();
        left.register_adapter(adapter("b.to_tabular", "signal_mid", "tabular_numeric", 1))
            .unwrap();
        left.register_adapter(adapter("c.direct", "signal_1d", "tabular_numeric", 10))
            .unwrap();

        let mut right = AdapterRegistry::new();
        right
            .register_adapter(adapter("c.direct", "signal_1d", "tabular_numeric", 10))
            .unwrap();
        right
            .register_adapter(adapter("b.to_tabular", "signal_mid", "tabular_numeric", 1))
            .unwrap();
        right
            .register_adapter(adapter("a.to_mid", "signal_1d", "signal_mid", 1))
            .unwrap();

        let policy = PlanningPolicy::default();
        let left_path = left
            .find_path(
                &tid("dense_signal"),
                &rid("signal_1d"),
                &tid("table"),
                &rid("tabular_numeric"),
                &policy,
            )
            .path
            .unwrap();
        let right_path = right
            .find_path(
                &tid("dense_signal"),
                &rid("signal_1d"),
                &tid("table"),
                &rid("tabular_numeric"),
                &policy,
            )
            .path
            .unwrap();

        assert_eq!(
            left_path
                .adapters
                .iter()
                .map(|adapter| adapter.id.as_str())
                .collect::<Vec<_>>(),
            vec!["a.to_mid", "b.to_tabular"]
        );
        assert_eq!(left_path, right_path);
    }

    #[test]
    fn lossy_paths_are_refused_unless_allowed() {
        let mut lossy = adapter("image.embedding", "signal_1d", "tabular_numeric", 1);
        lossy.lossy = true;

        let mut registry = AdapterRegistry::new();
        registry.register_adapter(lossy).unwrap();

        let refused = registry.find_path(
            &tid("dense_signal"),
            &rid("signal_1d"),
            &tid("table"),
            &rid("tabular_numeric"),
            &PlanningPolicy::default(),
        );
        assert!(refused.path.is_none());

        let allowed = registry.find_path(
            &tid("dense_signal"),
            &rid("signal_1d"),
            &tid("table"),
            &rid("tabular_numeric"),
            &PlanningPolicy {
                allow_lossy: true,
                ..PlanningPolicy::default()
            },
        );
        assert_eq!(allowed.path.unwrap().adapters[0].id, "image.embedding");
    }

    #[test]
    fn equivalent_best_paths_require_user_choice() {
        let mut registry = AdapterRegistry::new();
        registry
            .register_adapter(adapter("a.flatten", "signal_1d", "tabular_numeric", 1))
            .unwrap();
        registry
            .register_adapter(adapter("b.flatten", "signal_1d", "tabular_numeric", 1))
            .unwrap();

        let resolution = registry.find_path(
            &tid("dense_signal"),
            &rid("signal_1d"),
            &tid("table"),
            &rid("tabular_numeric"),
            &PlanningPolicy::default(),
        );

        assert!(resolution.path.is_none());
        assert!(resolution.requires_user_choice);
        assert_eq!(resolution.issues[0].code, "ambiguous_path");
        assert_eq!(resolution.issues[0].choices.len(), 2);
    }
}
