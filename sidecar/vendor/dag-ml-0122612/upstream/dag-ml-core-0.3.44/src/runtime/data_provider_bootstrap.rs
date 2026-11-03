//! Finite, stateless host data preparation through the ordinary PLAN scheduler.
use super::*;
use std::sync::{Arc, Mutex};

use crate::controller::{
    ArtifactPolicy, ControllerFitScope, ControllerManifest, ControllerRegistry, RngPolicy,
};
use crate::graph::{GraphInterface, GraphSpec, NodeSpec, PortCardinality, PortSchema, PortSpec};

/// A provider recipe is execution provenance, not a data envelope or a FoldSet.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DataProviderRecipe {
    pub provider_id: NodeId,
    pub provider_version: String,
    #[serde(default)]
    pub params: BTreeMap<String, serde_json::Value>,
    #[serde(default)]
    pub seed: u64,
    #[serde(default = "run_scope")]
    pub scope: String,
    #[serde(default = "finite_provider")]
    pub finite: bool,
    #[serde(default)]
    pub learned: bool,
    #[serde(default)]
    pub context: BTreeMap<String, serde_json::Value>,
}

fn run_scope() -> String {
    "run".into()
}
fn finite_provider() -> bool {
    true
}

impl DataProviderRecipe {
    pub fn validate(&self) -> Result<()> {
        if self.provider_version.trim().is_empty() || self.provider_id.as_str().trim().is_empty() {
            return Err(DagMlError::RuntimeValidation(
                "data provider requires a nonempty id and version".into(),
            ));
        }
        if self.scope != "run" || !self.finite || self.learned {
            return Err(DagMlError::RuntimeValidation(
                "data provider preparation supports only finite, non-learned scope=run; fold/epoch providers require a separate execution contract".into(),
            ));
        }
        if self
            .params
            .keys()
            .chain(self.context.keys())
            .any(|key| key.trim().is_empty())
        {
            return Err(DagMlError::RuntimeValidation(
                "data provider parameter/context keys must be nonempty".into(),
            ));
        }
        Ok(())
    }
}

/// The host keeps the actual X/y/masks behind this nonzero data handle.
/// Metadata is descriptive only; IO must still validate the assembled dataset.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DataProviderMaterialization {
    pub handle: HandleRef,
    #[serde(default)]
    pub metadata: BTreeMap<String, serde_json::Value>,
}

pub trait RuntimeDataProviderSource: Send + Sync {
    fn materialize(&self, task: &NodeTask) -> Result<DataProviderMaterialization>;
    /// Release a materialization rejected before ownership reaches the caller.
    fn release(&self, _handle: &HandleRef) -> Result<()> {
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DataProviderExecution {
    pub profile: String,
    pub recipe_fingerprint: String,
    pub context_fingerprint: String,
    pub graph_fingerprint: String,
    pub controller_fingerprint: String,
    /// Excludes the ephemeral host handle; does not attest feature/target bytes.
    pub execution_fingerprint: String,
    pub task_seed: u64,
    pub handle: HandleRef,
    pub metadata: BTreeMap<String, serde_json::Value>,
    pub lineage: LineageRecord,
}

struct SourceController {
    id: ControllerId,
    source: Box<dyn RuntimeDataProviderSource>,
    materialization: Arc<Mutex<Option<DataProviderMaterialization>>>,
}

impl Drop for SourceController {
    fn drop(&mut self) {
        if let Some(materialized) = self
            .materialization
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take()
        {
            if let Err(error) = self.source.release(&materialized.handle) {
                crate::observability::emit_provider_release_failure(&error);
            }
        }
    }
}

impl RuntimeController for SourceController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        if task.phase != Phase::Plan
            || task.fold_id.is_some()
            || task.variant_id.is_some()
            || !task.input_handles.is_empty()
            || !task.data_views.is_empty()
        {
            return Err(DagMlError::RuntimeValidation(
                "data provider preparation requires an input-free PLAN task".into(),
            ));
        }
        let mut captured = self.materialization.lock().map_err(|_| {
            DagMlError::RuntimeValidation("data provider state lock is poisoned".into())
        })?;
        if captured.is_some() {
            return Err(DagMlError::RuntimeValidation(
                "data provider preparation cannot invoke its source twice".into(),
            ));
        }
        let materialized = self.source.materialize(task)?;
        *captured = Some(materialized.clone());
        if materialized.handle.handle == 0
            || materialized.handle.kind != HandleKind::Data
            || materialized.handle.owner_controller != self.id
        {
            return Err(DagMlError::RuntimeValidation(
                "data provider must return a nonzero data handle owned by the task controller"
                    .into(),
            ));
        }
        if materialized
            .metadata
            .keys()
            .any(|key| key.trim().is_empty())
        {
            return Err(DagMlError::RuntimeValidation(
                "data provider metadata keys must be nonempty".into(),
            ));
        }
        let result = NodeResult {
            schema_version: None,
            classification_probabilities: Vec::new(),
            consumed_data_views: std::collections::BTreeMap::new(),
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([("data".into(), materialized.handle.clone())]),
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
                record_id: LineageId::new(format!("lineage:{}:PLAN", task.run_id))?,
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
                target_domain: None,
            },
        };
        *captured = Some(materialized);
        Ok(result)
    }
}

/// Prepare one host dataset. Ordinary graph planning and PLAN execution own the
/// invocation and seed. The caller subsequently assembles/validates data in IO.
pub fn execute_data_provider(
    recipe: &DataProviderRecipe,
    source: Box<dyn RuntimeDataProviderSource>,
) -> Result<DataProviderExecution> {
    recipe.validate()?;
    let recipe_fingerprint = stable_json_fingerprint(recipe)?;
    let context_fingerprint = stable_json_fingerprint(&recipe.context)?;
    let controller_id =
        ControllerId::new(format!("controller:data_provider:{}", recipe.provider_id))?;
    let output = PortSpec {
        name: "data".into(),
        kind: PortKind::Data,
        representation: None,
        cardinality: PortCardinality::One,
        unit_level: None,
        alignment_key: None,
        target_level: None,
        description: "Opaque host dataset awaiting IO validation".into(),
    };
    let graph = GraphSpec {
        id: format!("graph:data_provider:{}", recipe.provider_id),
        interface: GraphInterface::default(),
        nodes: vec![NodeSpec {
            id: recipe.provider_id.clone(),
            kind: NodeKind::Generator,
            operator: Some(
                serde_json::json!({"type": "DataProviderSource", "version": recipe.provider_version}),
            ),
            params: recipe.params.clone(),
            ports: PortSchema {
                inputs: Vec::new(),
                outputs: vec![output.clone()],
            },
            metadata: BTreeMap::from([(
                "data_provider_recipe_fingerprint".into(),
                serde_json::json!(recipe_fingerprint),
            )]),
            seed_label: None,
        }],
        edges: Vec::new(),
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    };
    let mut manifests = ControllerRegistry::new();
    manifests.register(ControllerManifest {
        controller_id: controller_id.clone(),
        controller_version: recipe.provider_version.clone(),
        operator_kind: NodeKind::Generator,
        priority: 0,
        supported_phases: BTreeSet::from([Phase::Plan]),
        input_ports: Vec::new(),
        output_ports: vec![output],
        data_requirements: None,
        capabilities: BTreeSet::from([
            ControllerCapability::GeneratesData,
            ControllerCapability::UsesCoreRng,
            ControllerCapability::Deterministic,
        ]),
        operator_selectors: Vec::new(),
        fit_scope: ControllerFitScope::Stateless,
        rng_policy: RngPolicy::UsesCoreSeed,
        artifact_policy: ArtifactPolicy::HostOnly,
    })?;
    let campaign = CampaignSpec {
        id: format!("campaign:data_provider:{recipe_fingerprint}"),
        root_seed: Some(recipe.seed),
        leakage_policy: Default::default(),
        aggregation_policy: Default::default(),
        split_invocation: None,
        generation: Default::default(),
        shape_plans: BTreeMap::new(),
        data_bindings: BTreeMap::new(),
        branch_view_plans: Vec::new(),
        inner_cv: None,
        metadata: BTreeMap::new(),
    };
    let plan = crate::plan::build_execution_plan(
        format!("plan:data_provider:{recipe_fingerprint}"),
        graph,
        campaign,
        &manifests,
    )?;
    let captured = Arc::new(Mutex::new(None));
    let mut controllers = RuntimeControllerRegistry::new();
    controllers.register(Box::new(SourceController {
        id: controller_id,
        source,
        materialization: captured.clone(),
    }))?;
    let mut context = RunContext::new(
        RunId::new(format!("run:data_provider:{recipe_fingerprint}"))?,
        Some(recipe.seed),
    );
    let mut results =
        SequentialScheduler.execute_phase(&plan, &controllers, &mut context, Phase::Plan)?;
    if results.len() != 1 {
        return Err(DagMlError::RuntimeValidation(
            "data provider preparation must execute exactly one source node".into(),
        ));
    }
    let result = results.remove(0);
    let materialization = captured
        .lock()
        .map_err(|_| DagMlError::RuntimeValidation("data provider state lock is poisoned".into()))?
        .take()
        .ok_or_else(|| {
            DagMlError::RuntimeValidation("data provider returned no materialization".into())
        })?;
    let task_seed = result.lineage.seed.ok_or_else(|| {
        DagMlError::RuntimeValidation("data provider PLAN task has no native seed".into())
    })?;
    let execution_fingerprint = stable_json_fingerprint(&(
        &recipe_fingerprint,
        &context_fingerprint,
        &plan.graph_fingerprint,
        &plan.controller_fingerprint,
        &materialization.metadata,
        &result.lineage,
    ))?;
    Ok(DataProviderExecution {
        profile: "data_provider_prepare_v1".into(),
        recipe_fingerprint,
        context_fingerprint,
        graph_fingerprint: plan.graph_fingerprint,
        controller_fingerprint: plan.controller_fingerprint,
        execution_fingerprint,
        task_seed,
        handle: materialization.handle,
        metadata: materialization.metadata,
        lineage: result.lineage,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct Source {
        calls: Arc<AtomicUsize>,
        handle: u64,
        kind: HandleKind,
        fail: bool,
    }

    impl RuntimeDataProviderSource for Source {
        fn materialize(&self, task: &NodeTask) -> Result<DataProviderMaterialization> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            assert_eq!(task.phase, Phase::Plan);
            assert_eq!(task.node_plan.kind, NodeKind::Generator);
            assert!(task.input_handles.is_empty());
            assert!(task.data_views.is_empty());
            assert!(task.node_plan.data_bindings.is_empty());
            assert!(task.fold_id.is_none());
            assert!(task.variant_id.is_none());
            assert!(task.seed.is_some());
            if self.fail {
                return Err(DagMlError::RuntimeValidation("provider failure".into()));
            }
            Ok(DataProviderMaterialization {
                handle: HandleRef {
                    handle: self.handle,
                    kind: self.kind,
                    owner_controller: task.node_plan.controller_id.clone(),
                },
                metadata: BTreeMap::from([("sample_count".into(), serde_json::json!(12))]),
            })
        }
    }

    fn recipe() -> DataProviderRecipe {
        serde_json::from_value(serde_json::json!({
            "provider_id": "source:synthetic", "provider_version": "1", "seed": 17,
            "params": {"samples":12}, "context": {"input_fingerprint": "cohort:base"}
        }))
        .unwrap()
    }

    fn source(
        calls: &Arc<AtomicUsize>,
        handle: u64,
        kind: HandleKind,
        fail: bool,
    ) -> Box<dyn RuntimeDataProviderSource> {
        Box::new(Source {
            calls: calls.clone(),
            handle,
            kind,
            fail,
        })
    }

    #[test]
    fn data_provider_bootstrap_executes_once_and_fingerprints_recipe_not_ephemeral_handle() {
        let calls = Arc::new(AtomicUsize::new(0));
        let recipe = recipe();
        let a = execute_data_provider(&recipe, source(&calls, 1, HandleKind::Data, false)).unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(a.lineage.phase, Phase::Plan);
        assert_eq!(a.lineage.seed, Some(a.task_seed));
        assert_eq!(a.metadata["sample_count"], 12);
        let b =
            execute_data_provider(&recipe, source(&calls, 200, HandleKind::Data, false)).unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        assert_eq!(a.task_seed, b.task_seed);
        assert_eq!(a.execution_fingerprint, b.execution_fingerprint);
        assert_ne!(a.handle, b.handle);
        for field in [
            "seed",
            "params",
            "provider_version",
            "context",
            "provider_id",
        ] {
            let mut changed = recipe.clone();
            match field {
                "seed" => changed.seed += 1,
                "params" => {
                    changed
                        .params
                        .insert("samples".into(), serde_json::json!(24));
                }
                "provider_version" => changed.provider_version = "2".into(),
                "context" => {
                    changed.context.insert(
                        "input_fingerprint".into(),
                        serde_json::json!("cohort:other"),
                    );
                }
                "provider_id" => changed.provider_id = NodeId::new("source:other").unwrap(),
                _ => unreachable!(),
            }
            let c = execute_data_provider(&changed, source(&calls, 1, HandleKind::Data, false))
                .unwrap();
            assert_ne!(a.recipe_fingerprint, c.recipe_fingerprint, "{field}");
            assert_ne!(a.execution_fingerprint, c.execution_fingerprint, "{field}");
            if field == "seed" {
                assert_ne!(a.task_seed, c.task_seed);
            }
            if field == "context" {
                assert_ne!(a.context_fingerprint, c.context_fingerprint);
            }
        }
    }

    #[test]
    fn data_provider_bootstrap_refuses_unsupported_scope_before_callback() {
        let calls = Arc::new(AtomicUsize::new(0));
        for mutation in ["fold", "epoch", "infinite", "learned", "version", "params"] {
            let mut changed = recipe();
            match mutation {
                "fold" | "epoch" => changed.scope = mutation.into(),
                "infinite" => changed.finite = false,
                "learned" => changed.learned = true,
                "version" => changed.provider_version = " ".into(),
                "params" => {
                    changed.params.insert("".into(), serde_json::json!(1));
                }
                _ => unreachable!(),
            }
            assert!(
                execute_data_provider(&changed, source(&calls, 1, HandleKind::Data, false))
                    .is_err(),
                "{mutation}"
            );
            assert_eq!(calls.load(Ordering::SeqCst), 0);
        }
    }

    #[test]
    fn data_provider_bootstrap_propagates_failures_and_rejects_invalid_handles() {
        let calls = Arc::new(AtomicUsize::new(0));
        let error = execute_data_provider(&recipe(), source(&calls, 1, HandleKind::Data, true))
            .unwrap_err();
        assert!(error.to_string().contains("provider failure"));
        for (handle, kind) in [
            (0, HandleKind::Data),
            (1, HandleKind::Model),
            (1, HandleKind::DataView),
        ] {
            let error =
                execute_data_provider(&recipe(), source(&calls, handle, kind, false)).unwrap_err();
            assert!(error.to_string().contains("nonzero data handle"));
        }
        assert_eq!(calls.load(Ordering::SeqCst), 4);
    }
}
