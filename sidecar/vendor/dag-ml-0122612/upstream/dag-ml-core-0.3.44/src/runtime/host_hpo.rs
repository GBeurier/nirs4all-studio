//! Nonportable host-optimizer search with scheduler-owned candidate execution.
//!
//! The host proposes parameter values and receives native scores only. It never
//! supplies predictions, folds, or scalar scores through the tuner interface.
//! This contract deliberately has no Methods ABI or N4MOPT checkpoint claim.

use super::*;

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HostHpoFoldReduction {
    Mean,
    Best,
    RobustBest,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostHpoParameterBinding {
    pub node_id: NodeId,
    pub param_path: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostHpoSearchRequest {
    pub target_node: NodeId,
    pub trial_budget: u32,
    pub metric: RegressionMetricKind,
    pub direction: crate::selection::MetricObjective,
    pub optimizer_descriptor: BTreeMap<String, serde_json::Value>,
    /// Consecutive trial budgets for a phased optimizer. Empty means one
    /// implicit phase. The budgets must sum to `trial_budget`; core owns the
    /// phase boundary while the proposal source owns sampler-specific state.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub phase_trial_budgets: Vec<u32>,
    /// Ask the host optimizer for a pruning decision after each native fold.
    #[serde(default, skip_serializing_if = "is_false")]
    pub progressive_pruning: bool,
    /// None preserves the original global OOF objective. Fold reductions are
    /// explicit selection evidence, never synthetic OOF ScoreSet reports.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fold_score_reduction: Option<HostHpoFoldReduction>,
    /// Public proposal paths mapped to operator-local parameters. Empty retains
    /// the original single-target routing and its serialized fingerprints.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub parameter_bindings: BTreeMap<String, HostHpoParameterBinding>,
    /// Compiler-owned immutable recipes. Absent preserves fixed-topology wire
    /// bytes, objective hashes and schema-1 checkpoints.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structural_catalogue: Option<HostHpoStructuralCatalogue>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct HostHpoMethodsBuildProfile {
    schema_version: u32,
    blas: bool,
    openmp: bool,
    cuda: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct HostHpoParallelExecutionProfile {
    schema_version: u32,
    profile: String,
    workers: usize,
    cpu_threads: u32,
    gpu_devices: Vec<String>,
    methods_build: HostHpoMethodsBuildProfile,
}

impl HostHpoSearchRequest {
    fn validated_phase_budgets(&self) -> Result<()> {
        if !self.phase_trial_budgets.is_empty()
            && (self.phase_trial_budgets.contains(&0)
                || self
                    .phase_trial_budgets
                    .iter()
                    .try_fold(0u32, |n, budget| n.checked_add(*budget))
                    != Some(self.trial_budget))
        {
            return Err(DagMlError::RuntimeValidation(
                "phase trial budgets must be positive and sum to the trial budget without overflow"
                    .into(),
            ));
        }
        Ok(())
    }

    fn validate_browser_execution(&self) -> Result<()> {
        if self.structural_catalogue.as_ref().is_some_and(|catalogue| {
            catalogue
                .entries
                .iter()
                .any(|entry| entry.graph.metadata.contains_key("python_torch_profile"))
        }) {
            return Err(DagMlError::RuntimeValidation(
                "Python Torch topology requires native serial host execution".into(),
            ));
        }
        if self
            .structural_catalogue
            .as_ref()
            .is_some_and(|catalogue| catalogue.topology_contract.is_some())
        {
            return Err(DagMlError::RuntimeValidation(
                "topology HPO currently requires serial candidate execution".into(),
            ));
        }
        if self.optimizer_descriptor.contains_key("parallel_execution") {
            return Err(DagMlError::RuntimeValidation(
                "parallel_execution is a native-only profile and is not supported by browser HPO"
                    .into(),
            ));
        }
        Ok(())
    }

    /// Admit only the declared bounded sequential-numerics profile for typed
    /// Methods recipes. The host attests its actual library build; core signs
    /// that declaration into the objective/checkpoint and enforces its budget.
    /// Historical serial descriptors and generic host parallelism stay intact.
    pub fn validate_parallel_execution(
        &self,
        workers: usize,
    ) -> Result<Option<crate::training::TrainingResourceLimits>> {
        if workers > 1
            && self.structural_catalogue.as_ref().is_some_and(|catalogue| {
                catalogue
                    .entries
                    .iter()
                    .any(|entry| entry.graph.metadata.contains_key("python_torch_profile"))
            })
        {
            return Err(DagMlError::RuntimeValidation(
                "Python Torch topology requires serial candidate execution".into(),
            ));
        }
        if workers > 1
            && self.structural_catalogue.as_ref().is_some_and(|catalogue| {
                catalogue.entries.iter().any(|entry| {
                    entry.graph.nodes.iter().any(|node| {
                        node.operator.as_ref().is_some_and(|operator| {
                            matches!(
                                operator.get("type").and_then(serde_json::Value::as_str),
                                Some(
                                    crate::METHODS_RAW_CLASSIFIER | crate::METHODS_META_CLASSIFIER
                                )
                            )
                        })
                    })
                })
            })
        {
            return Err(DagMlError::RuntimeValidation("Methods classification requires serial candidate execution regardless of the objective metric".into()));
        }
        let typed_methods = self.structural_catalogue.as_ref().is_some_and(|catalogue| {
            catalogue.topology_contract.is_some()
                || catalogue.entries.iter().any(|entry| {
                    entry.graph.nodes.iter().any(|node| {
                        node.operator
                            .as_ref()
                            .and_then(|operator| operator.get("type"))
                            .and_then(serde_json::Value::as_str)
                            .is_some_and(|kind| {
                                matches!(
                                    kind,
                                    "N4mMultimodalPipeline" | crate::METHODS_RAW_CLASSIFIER
                                )
                            })
                    })
                })
        });
        let declaration = self.optimizer_descriptor.get("parallel_execution");
        if typed_methods || declaration.is_some() {
            let declared_workers = match self.optimizer_descriptor.get("n_jobs") {
                None => Some(1),
                Some(value) => value.as_u64().and_then(|value| usize::try_from(value).ok()),
            };
            if declared_workers != Some(workers) {
                return Err(DagMlError::RuntimeValidation(
                    "typed host HPO n_jobs must match the actual worker budget".into(),
                ));
            }
            if workers > 1 && declaration.is_none() {
                return Err(DagMlError::RuntimeValidation(
                    "typed parallel host HPO requires a sequential Methods build profile".into(),
                ));
            }
        }
        let Some(declaration) = declaration else {
            return Ok(None);
        };
        let profile: HostHpoParallelExecutionProfile = serde_json::from_value(declaration.clone())
            .map_err(|error| {
                DagMlError::RuntimeValidation(format!(
                    "invalid typed host HPO parallel_execution declaration: {error}"
                ))
            })?;
        if profile.schema_version != 1
            || profile.profile != "methods_sequential_cpu_v1"
            || !(2..=4).contains(&workers)
            || profile.workers != workers
            || profile.cpu_threads != 1
            || !profile.gpu_devices.is_empty()
            || profile.methods_build.schema_version != 1
            || profile.methods_build.blas
            || profile.methods_build.openmp
            || profile.methods_build.cuda
            || !matches!(
                self.metric,
                RegressionMetricKind::Mse
                    | RegressionMetricKind::Rmse
                    | RegressionMetricKind::Mae
                    | RegressionMetricKind::R2
            )
            || self
                .optimizer_descriptor
                .get("sampler")
                .and_then(serde_json::Value::as_str)
                != Some("random")
            || self
                .optimizer_descriptor
                .get("pruner")
                .is_some_and(|value| !value.is_null() && value.as_str() != Some("none"))
            || self.progressive_pruning
            || self
                .optimizer_descriptor
                .contains_key("generated_view_mode")
        {
            return Err(DagMlError::RuntimeValidation(
                "typed parallel host HPO requires regression, workers 2..4, random sampling, no pruning, and the sequential Methods CPU profile".into(),
            ));
        }
        Ok(Some(crate::training::TrainingResourceLimits {
            cpu_threads: 1,
            memory_bytes: None,
            gpu_devices: Vec::new(),
            wall_time_ms: None,
        }))
    }

    /// Inspect the actual graph as well as the signed catalogue. A regression
    /// metric or an absent catalogue cannot relabel a classifier as parallel-safe.
    pub fn validate_parallel_execution_for_plan(
        &self,
        workers: usize,
        plan: &ExecutionPlan,
    ) -> Result<Option<crate::training::TrainingResourceLimits>> {
        if workers > 1 && crate::python_torch_profile::has_torch_profile(plan) {
            return Err(DagMlError::RuntimeValidation(
                "Python Torch topology requires serial candidate execution".into(),
            ));
        }
        if workers > 1
            && plan.graph_plan.graph.nodes.iter().any(|node| {
                node.operator.as_ref().is_some_and(|operator| {
                    matches!(
                        operator.get("type").and_then(serde_json::Value::as_str),
                        Some(crate::METHODS_RAW_CLASSIFIER | crate::METHODS_META_CLASSIFIER)
                    )
                })
            })
        {
            return Err(DagMlError::RuntimeValidation("Methods classification requires serial candidate execution regardless of the objective metric".into()));
        }
        self.validate_parallel_execution(workers)
    }

    fn phase_index(&self, trial_index: u32) -> Option<u32> {
        if self.phase_trial_budgets.is_empty() {
            return None;
        }
        let mut end = 0u32;
        for (index, budget) in self.phase_trial_budgets.iter().enumerate() {
            end = end.checked_add(*budget)?;
            if trial_index < end {
                return Some(index as u32);
            }
        }
        None
    }

    pub(super) fn validate_parameter_bindings(&self, plan: &ExecutionPlan) -> Result<()> {
        if self.direction != self.metric.objective() {
            return Err(DagMlError::RuntimeValidation(
                "host HPO direction must match metric objective".into(),
            ));
        }
        self.validated_phase_budgets()?;
        crate::methods_classification::validate_methods_classifier_search(plan, self)?;
        crate::python_torch_profile::validate_torch_search(plan, self)?;
        if let Some(catalogue) = &self.structural_catalogue {
            if catalogue.topology_contract.is_some() && self.progressive_pruning {
                return Err(DagMlError::RuntimeValidation(
                    "topology HPO does not support progressive pruning of nested stacking".into(),
                ));
            }
            if !self.parameter_bindings.is_empty()
                || catalogue
                    .entries
                    .first()
                    .is_none_or(|entry| entry.target_node != self.target_node)
            {
                return Err(DagMlError::RuntimeValidation(
                    "structural HPO requires its first recipe target and recipe-local bindings"
                        .into(),
                ));
            }
            return catalogue.validate_for_plan(plan);
        }
        let mut destinations = BTreeSet::new();
        for (path, binding) in &self.parameter_bindings {
            if path.trim().is_empty() || binding.param_path.trim().is_empty() {
                return Err(DagMlError::RuntimeValidation(
                    "host HPO parameter binding paths must be nonempty".into(),
                ));
            }
            if plan.node_plans.get(&binding.node_id).is_none_or(|node| {
                !matches!(
                    node.kind,
                    NodeKind::Model | NodeKind::Transform | NodeKind::YTransform
                ) || !node.supported_phases.contains(&Phase::FitCv)
            }) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "host HPO parameter binding `{path}` requires an existing FIT_CV model or transform node: `{}`",
                    binding.node_id
                )));
            }
            if !destinations.insert((&binding.node_id, &binding.param_path)) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "host HPO parameter bindings collide at `{}.{}`",
                    binding.node_id, binding.param_path
                )));
            }
        }
        Ok(())
    }

    pub(super) fn parameter_overrides(
        &self,
        params: &BTreeMap<String, serde_json::Value>,
    ) -> Result<Vec<crate::generation::GenerationParamOverride>> {
        if let Some(catalogue) = &self.structural_catalogue {
            let recipe = catalogue.recipe(params)?;
            let active = params
                .iter()
                .filter(|(path, _)| *path != &catalogue.selector_path)
                .map(|(path, value)| (path.clone(), value.clone()))
                .collect();
            let mut routed = self.clone();
            routed.structural_catalogue = None;
            routed.target_node = recipe.target_node.clone();
            routed.parameter_bindings = recipe.parameter_bindings.clone();
            if recipe.parameter_bindings.is_empty() {
                return Ok(Vec::new());
            }
            return routed.parameter_overrides(&active);
        }
        if params.is_empty() || params.keys().any(|key| key.trim().is_empty()) {
            return Err(DagMlError::RuntimeValidation(
                "host HPO proposal parameters must be nonempty".into(),
            ));
        }
        if self.parameter_bindings.is_empty() {
            return Ok(vec![crate::generation::GenerationParamOverride {
                node_id: self.target_node.clone(),
                params: params.clone(),
            }]);
        }
        let mut grouped: BTreeMap<NodeId, BTreeMap<String, serde_json::Value>> = BTreeMap::new();
        for (path, value) in params {
            let binding = self.parameter_bindings.get(path).ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "host HPO proposed parameter `{path}` has no parameter binding"
                ))
            })?;
            grouped
                .entry(binding.node_id.clone())
                .or_default()
                .insert(binding.param_path.clone(), value.clone());
        }
        Ok(grouped
            .into_iter()
            .map(|(node_id, params)| crate::generation::GenerationParamOverride { node_id, params })
            .collect())
    }

    pub(super) fn target_for_plan<'a>(&'a self, plan: &ExecutionPlan) -> Result<&'a NodeId> {
        let Some(catalogue) = &self.structural_catalogue else {
            return Ok(&self.target_node);
        };
        let recipe_id = plan
            .variants
            .first()
            .and_then(|variant| variant.choices.get("host_hpo"))
            .and_then(|choice| choice.value.get("recipe_id"))
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(
                    "structural HPO candidate lacks recipe identity".into(),
                )
            })?;
        let recipe = catalogue
            .entries
            .iter()
            .find(|entry| entry.recipe_id.as_str() == recipe_id)
            .ok_or_else(|| {
                DagMlError::RuntimeValidation("structural HPO candidate recipe is unknown".into())
            })?;
        if !plan.node_plans.contains_key(&recipe.target_node) {
            return Err(DagMlError::RuntimeValidation(
                "structural HPO target is outside candidate plan".into(),
            ));
        }
        Ok(&recipe.target_node)
    }
}

pub trait HostHpoProposalSource {
    fn ask(&mut self, trial_index: u32) -> Result<Option<BTreeMap<String, serde_json::Value>>>;
    /// Receive the core-owned phase for a candidate. Existing one-phase
    /// sources remain source-compatible through the default implementation.
    fn ask_in_phase(
        &mut self,
        trial_index: u32,
        _phase_index: Option<u32>,
    ) -> Result<Option<BTreeMap<String, serde_json::Value>>> {
        self.ask(trial_index)
    }
    fn tell(&mut self, trial_index: u32, score: f64) -> Result<()>;
    /// Return true to prune this trial after a report-grade intermediate score.
    fn report_intermediate(&mut self, _trial_index: u32, _step: u32, _score: f64) -> Result<bool> {
        Ok(false)
    }
    fn pruned(&mut self, _trial_index: u32) -> Result<()> {
        Ok(())
    }
    /// Terminalize a failed candidate before pairing durable optimizer state.
    fn fail(&mut self, _trial_index: u32, _error: &str) -> Result<()> {
        Ok(())
    }
}

/// Creates a fresh data-provider namespace for one candidate. Implementations
/// must preserve the attested input envelope while keeping handle maps local
/// to the candidate; the returned provider may move to a worker thread.
pub trait HostHpoCandidateProviderFactory: Send + Sync {
    fn create(&self, trial_index: u32) -> Result<Box<dyn RuntimeDataProvider + Send>>;

    /// Snapshot the cumulative generated views after a parallel window joins.
    /// Every terminal in that window receives the same snapshot, even when
    /// candidates finished out of order or one failed after reading views.
    fn batch_generated_view_manifest(
        &self,
        _has_success: bool,
    ) -> Result<Option<serde_json::Value>> {
        Ok(None)
    }
}

fn host_hpo_provider_manifest(
    provider: &dyn RuntimeDataProvider,
) -> Result<Option<serde_json::Value>> {
    let manifest = provider.generated_view_manifest()?;
    if provider.generated_views_enabled() && manifest.is_none() {
        return Err(DagMlError::RuntimeValidation(
            "generated host HPO provider produced no view manifest".into(),
        ));
    }
    Ok(manifest)
}

/// Build a controller registry with candidate-local host callback state.
pub trait HostHpoCandidateControllerFactory: Send + Sync {
    fn create(&self, trial_index: u32) -> Result<RuntimeControllerRegistry>;
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HostHpoTrialEvidence {
    pub trial_index: u32,
    pub params: BTreeMap<String, serde_json::Value>,
    pub score: f64,
    pub variant_id: VariantId,
    pub scores: ScoreSet,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub objective_fold_scores: BTreeMap<String, f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generated_view_manifest: Option<serde_json::Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HostHpoSearchResult {
    pub profile: String,
    pub portable: bool,
    pub request_fingerprint: String,
    pub graph_fingerprint: String,
    pub controller_fingerprint: String,
    pub campaign_fingerprint: String,
    pub fold_set_fingerprint: String,
    pub trials: Vec<HostHpoTrialEvidence>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pruned_trials: Vec<HostHpoPrunedTrialEvidence>,
    pub selected_trial_index: u32,
    pub selected_params: BTreeMap<String, serde_json::Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HostHpoPrunedTrialEvidence {
    pub trial_index: u32,
    pub params: BTreeMap<String, serde_json::Value>,
    pub variant_id: VariantId,
    pub scores: ScoreSet,
    pub intermediate_scores: Vec<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generated_view_manifest: Option<serde_json::Value>,
}

enum HostHpoEvaluation {
    Complete(HostHpoTrialEvidence, crate::selection::CandidateScore),
    Pruned(HostHpoPrunedTrialEvidence),
}

enum ParallelHostHpoEvent {
    Intermediate {
        trial_index: u32,
        step: u32,
        score: f64,
        reply: std::sync::mpsc::Sender<Result<bool>>,
    },
    Completed {
        trial_index: u32,
        evaluated: Box<Result<HostHpoEvaluation>>,
    },
}

/// Operational stopping state; cancellation never requests a REFIT.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HostHpoSearchStatus {
    Running,
    Completed,
    Cancelled,
    Exhausted,
    Failed,
}

/// A terminal candidate. Failed fits carry no manufactured score.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub enum HostHpoTerminalTrial {
    Complete {
        evidence: HostHpoTrialEvidence,
    },
    Pruned {
        evidence: HostHpoPrunedTrialEvidence,
    },
    Failed {
        trial_index: u32,
        params: BTreeMap<String, serde_json::Value>,
        variant_id: VariantId,
        error: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        generated_view_manifest: Option<serde_json::Value>,
    },
}

impl HostHpoTerminalTrial {
    pub fn trial_index(&self) -> u32 {
        match self {
            Self::Complete { evidence } => evidence.trial_index,
            Self::Pruned { evidence } => evidence.trial_index,
            Self::Failed { trial_index, .. } => *trial_index,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostHpoCheckpointBinding {
    pub objective_fingerprint: String,
    pub graph_fingerprint: String,
    pub controller_fingerprint: String,
    pub campaign_fingerprint: String,
    pub fold_set_fingerprint: String,
    /// Canonical host-data envelope including schemas, identities and relations.
    /// Host content-version descriptors belong in that envelope or the request.
    pub data_fingerprint: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structural_catalogue_fingerprint: Option<String>,
}

/// Native score evidence, independent of opaque host optimizer bytes.
/// Producers atomically pair this document with their optimizer checkpoint.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostHpoCheckpoint {
    pub schema_version: u32,
    pub binding: HostHpoCheckpointBinding,
    pub trials: Vec<HostHpoTerminalTrial>,
    pub fingerprint: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostHpoInterruptedTrial {
    pub trial_index: u32,
    pub params: BTreeMap<String, serde_json::Value>,
}

fn canonical_checkpoint_trials(trials: &[HostHpoTerminalTrial]) -> Vec<HostHpoTerminalTrial> {
    let mut trials = trials.to_vec();
    for trial in &mut trials {
        let (params, manifest) = match trial {
            HostHpoTerminalTrial::Complete { evidence } => {
                (&mut evidence.params, &mut evidence.generated_view_manifest)
            }
            HostHpoTerminalTrial::Pruned { evidence } => {
                (&mut evidence.params, &mut evidence.generated_view_manifest)
            }
            HostHpoTerminalTrial::Failed {
                params,
                generated_view_manifest,
                ..
            } => (params, generated_view_manifest),
        };
        for value in params.values_mut() {
            value.sort_all_objects();
        }
        if let Some(value) = manifest {
            value.sort_all_objects();
        }
    }
    trials
}

impl HostHpoCheckpoint {
    fn seal(&mut self) -> Result<()> {
        // Only dynamic JSON objects use canonical key ordering. Keep the
        // typed schema field order and every scientific array order unchanged,
        // matching checkpoints written before serde_json/preserve_order.
        let trials = canonical_checkpoint_trials(&self.trials);
        self.fingerprint = stable_json_fingerprint(&(self.schema_version, &self.binding, &trials))?;
        Ok(())
    }

    pub fn verify_seal(&self) -> Result<()> {
        let mut sealed = self.clone();
        sealed.seal()?;
        if sealed.fingerprint != self.fingerprint {
            return Err(DagMlError::RuntimeValidation(
                "host HPO checkpoint integrity fingerprint mismatch".into(),
            ));
        }
        Ok(())
    }

    /// Recover a trial prepared before an optimizer transition, then account
    /// for any candidates that were still in flight when the host stopped.
    /// In-flight candidates have no score evidence and become failed trials.
    pub fn recover_interrupted_trials(
        mut self,
        prepared: Option<Self>,
        interrupted: Vec<HostHpoInterruptedTrial>,
    ) -> Result<Self> {
        self.verify_seal()?;
        if let Some(prepared) = prepared {
            prepared.verify_seal()?;
            if prepared.schema_version != self.schema_version
                || prepared.binding != self.binding
                || prepared.trials.len() != self.trials.len() + 1
                || stable_json_fingerprint(&canonical_checkpoint_trials(
                    &prepared.trials[..self.trials.len()],
                ))? != stable_json_fingerprint(&canonical_checkpoint_trials(&self.trials))?
                || prepared
                    .trials
                    .last()
                    .map(HostHpoTerminalTrial::trial_index)
                    != Some(self.trials.len() as u32)
            {
                return Err(DagMlError::RuntimeValidation(
                    "host HPO prepared terminal does not extend the paired checkpoint".into(),
                ));
            }
            self = prepared;
        }
        for orphan in interrupted {
            if orphan.trial_index != self.trials.len() as u32
                || orphan.params.keys().any(|key| key.trim().is_empty())
            {
                return Err(DagMlError::RuntimeValidation(
                    "host HPO interrupted trial indices must extend checkpoint contiguously".into(),
                ));
            }
            self.trials.push(HostHpoTerminalTrial::Failed {
                trial_index: orphan.trial_index,
                params: orphan.params,
                variant_id: VariantId::new(format!("host_hpo:trial:{:010}", orphan.trial_index))?,
                error: "interrupted_before_native_evaluation".into(),
                generated_view_manifest: None,
            });
        }
        self.seal()?;
        Ok(self)
    }
}

/// Return false only to request cancellation at this completed-trial boundary.
pub trait HostHpoProgress {
    /// Persist a sealed prospective terminal checkpoint before the host
    /// optimizer is told. A durable host can recover a crash between the
    /// optimizer transition and the ordinary checkpoint publication.
    fn prepare_terminal(
        &mut self,
        _checkpoint: &HostHpoCheckpoint,
        _status: HostHpoSearchStatus,
    ) -> Result<()> {
        Ok(())
    }

    fn checkpoint(
        &mut self,
        checkpoint: &HostHpoCheckpoint,
        status: HostHpoSearchStatus,
    ) -> Result<bool>;
}

pub struct HostHpoResumeOptions {
    pub data_fingerprint: String,
    pub checkpoint: Option<HostHpoCheckpoint>,
}

impl HostHpoResumeOptions {
    pub fn from_envelope(
        envelope: &crate::data::ExternalDataPlanEnvelope,
        checkpoint: Option<HostHpoCheckpoint>,
    ) -> Result<Self> {
        envelope.validate()?;
        Ok(Self {
            data_fingerprint: stable_json_fingerprint(envelope)?,
            checkpoint,
        })
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct HostHpoSearchOutcome {
    /// Absent when cancelled/exhausted before any successful candidate.
    #[serde(flatten)]
    pub result: Option<HostHpoSearchResult>,
    pub status: HostHpoSearchStatus,
    pub checkpoint: Option<HostHpoCheckpoint>,
}

/// One candidate that a browser may evaluate in an isolated Web Worker.
/// The worker receives a complete candidate plan, never an unbound parameter
/// map; the coordinator retains the checkpoint and orders terminalization.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostHpoWorkerTask {
    pub trial_index: u32,
    pub phase_index: Option<u32>,
    pub params: BTreeMap<String, serde_json::Value>,
    pub candidate_plan: ExecutionPlan,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostHpoWorkerWindow {
    pub window_id: String,
    pub checkpoint: HostHpoCheckpoint,
    pub tasks: Vec<HostHpoWorkerTask>,
    pub exhausted: bool,
}

fn host_hpo_worker_candidate_plan(
    plan: &ExecutionPlan,
    request: &HostHpoSearchRequest,
    checkpoint: &HostHpoCheckpoint,
    trial_index: u32,
    params: &BTreeMap<String, serde_json::Value>,
) -> Result<ExecutionPlan> {
    host_hpo_candidate_plan(
        plan,
        request,
        trial_index,
        params,
        Some(&checkpoint.binding.objective_fingerprint),
    )
}

fn host_hpo_candidate_plan(
    plan: &ExecutionPlan,
    request: &HostHpoSearchRequest,
    trial_index: u32,
    params: &BTreeMap<String, serde_json::Value>,
    objective_fingerprint: Option<&str>,
) -> Result<ExecutionPlan> {
    let param_overrides = request.parameter_overrides(params)?;
    let mut candidate_plan = match &request.structural_catalogue {
        Some(catalogue) => catalogue.candidate_plan(plan, params)?,
        None => plan.clone(),
    };
    let base_fingerprint = candidate_plan.variants[0].fingerprint.clone();
    let objective_fingerprint = match objective_fingerprint {
        Some(fingerprint) => fingerprint.to_owned(),
        None => stable_json_fingerprint(request)?,
    };
    let mut variant = candidate_plan.variants[0].clone();
    variant.variant_id = VariantId::new(format!("host_hpo:trial:{trial_index:010}"))?;
    variant.choices.insert(
        "host_hpo".into(),
        GenerationChoice {
            label: format!("trial:{trial_index}"),
            value: if let Some(catalogue) = &request.structural_catalogue {
                serde_json::json!({"trial_index": trial_index,
                    "recipe_id": catalogue.recipe(params)?.recipe_id,
                    "catalogue_fingerprint": catalogue.catalogue_fingerprint,
                    "objective_fingerprint": objective_fingerprint})
            } else {
                serde_json::json!({"trial_index": trial_index,
                    "objective_fingerprint": objective_fingerprint})
            },
            param_overrides,
            active_subsequence: None,
        },
    );
    variant.fingerprint =
        stable_json_fingerprint(&(&base_fingerprint, &variant.choices, &objective_fingerprint))?;
    candidate_plan.variants = vec![variant];
    candidate_plan.validate()?;
    crate::methods_classification::validate_methods_classification_plan(&candidate_plan)?;
    Ok(candidate_plan)
}

fn validate_structural_worker_task(
    task: &HostHpoWorkerTask,
    request: &HostHpoSearchRequest,
) -> Result<()> {
    let Some(catalogue) = &request.structural_catalogue else {
        return Ok(());
    };
    let mut registry = crate::ControllerRegistry::new();
    for manifest in task.candidate_plan.controller_manifests.values() {
        registry.register(manifest.clone())?;
    }
    let compiled = crate::compile_pipeline_dsl_with_generation_and_controller_registry(
        &catalogue.source_dsl,
        &registry,
    )?;
    let union = crate::build_execution_plan(
        task.candidate_plan.id.clone(),
        compiled.graph,
        compiled.campaign_template,
        &registry,
    )?;
    request.validate_parameter_bindings(&union)?;
    let expected = host_hpo_candidate_plan(
        &union,
        request,
        task.trial_index,
        &task.params,
        Some(&host_hpo_objective_fingerprint(request)?),
    )?;
    if stable_json_fingerprint(&expected)? != stable_json_fingerprint(&task.candidate_plan)? {
        return Err(DagMlError::RuntimeValidation(
            "structural HPO worker candidate declaration/plan mismatch".into(),
        ));
    }
    Ok(())
}

/// Prepare one phase-bounded browser worker window. This is intentionally a
/// pure coordinator step: no operator callback or worker result is accepted
/// here, and existing sequential HPO remains unchanged. The window is tied
/// to the validated native checkpoint, data fingerprint, and candidate plans.
pub fn prepare_host_hpo_worker_window(
    plan: &ExecutionPlan,
    request: &HostHpoSearchRequest,
    options: &HostHpoResumeOptions,
    proposals: &mut dyn HostHpoProposalSource,
    max_workers: usize,
) -> Result<HostHpoWorkerWindow> {
    request.validate_browser_execution()?;
    plan.validate()?;
    if max_workers < 2 || request.trial_budget == 0 || request.optimizer_descriptor.is_empty() {
        return Err(DagMlError::RuntimeValidation(
            "browser HPO worker windows require at least two workers, a positive budget and an optimizer descriptor".into(),
        ));
    }
    if !request.phase_trial_budgets.is_empty()
        && (request.phase_trial_budgets.contains(&0)
            || request
                .phase_trial_budgets
                .iter()
                .try_fold(0u32, |sum, count| sum.checked_add(*count))
                != Some(request.trial_budget))
    {
        return Err(DagMlError::RuntimeValidation(
            "host HPO phase budgets must be positive and sum to trial_budget".into(),
        ));
    }
    if plan.fold_set.is_none()
        || plan.variants.len() != 1
        || !plan.variants[0].choices.is_empty()
        || plan
            .node_plans
            .get(&request.target_node)
            .is_none_or(|node| node.kind != NodeKind::Model)
    {
        return Err(DagMlError::RuntimeValidation(
            "browser HPO requires explicit folds, one concrete base variant and a model target"
                .into(),
        ));
    }
    request.validate_parameter_bindings(plan)?;
    let checkpoint = prepare_host_hpo_checkpoint(plan, request, options)?;
    let first = checkpoint.trials.len() as u32;
    let phase_index = request.phase_index(first);
    let mut tasks = Vec::new();
    let mut exhausted = false;
    for trial_index in first..request.trial_budget {
        if tasks.len() == max_workers || request.phase_index(trial_index) != phase_index {
            break;
        }
        let Some(params) = proposals.ask_in_phase(trial_index, phase_index)? else {
            exhausted = true;
            break;
        };
        let candidate_plan =
            host_hpo_worker_candidate_plan(plan, request, &checkpoint, trial_index, &params)?;
        tasks.push(HostHpoWorkerTask {
            trial_index,
            phase_index,
            params,
            candidate_plan,
        });
    }
    let window_id = stable_json_fingerprint(&(
        &checkpoint.fingerprint,
        &options.data_fingerprint,
        &tasks,
        exhausted,
    ))?;
    Ok(HostHpoWorkerWindow {
        window_id,
        checkpoint,
        tasks,
        exhausted,
    })
}

/// Execute exactly one candidate within a worker-owned controller/provider
/// namespace. Core, not the optimizer or main-thread JavaScript, constructs
/// the fold reports and objective score.
pub fn evaluate_host_hpo_worker_task(
    task: &HostHpoWorkerTask,
    request: &HostHpoSearchRequest,
    controllers: &RuntimeControllerRegistry,
    provider: &dyn RuntimeDataProvider,
) -> Result<HostHpoTrialEvidence> {
    request.validate_browser_execution()?;
    validate_structural_worker_task(task, request)?;
    task.candidate_plan.validate()?;
    let [variant] = task.candidate_plan.variants.as_slice() else {
        return Err(DagMlError::RuntimeValidation(
            "browser HPO worker task requires exactly one candidate variant".into(),
        ));
    };
    if variant.variant_id.as_str() != format!("host_hpo:trial:{:010}", task.trial_index)
        || task.phase_index != request.phase_index(task.trial_index)
    {
        return Err(DagMlError::RuntimeValidation(
            "browser HPO worker task trial/phase identity mismatch".into(),
        ));
    }
    let mut context = RunContext::new(
        RunId::new(format!("run:host_hpo:{}", task.trial_index))?,
        variant.seed.or(task.candidate_plan.campaign.root_seed),
    );
    context.variant_id = Some(variant.variant_id.clone());
    SequentialScheduler.execute_campaign_phase_with_data_provider(
        &task.candidate_plan,
        controllers,
        provider,
        &mut context,
        Phase::FitCv,
    )?;
    context.collect_cross_fold_validation_scores_for_target(
        plan_oof_partition_mode(&task.candidate_plan),
        request.metric,
        Some(&request.target_node),
    )?;
    let scores = context
        .build_score_set(task.candidate_plan.id.clone(), None)
        .ok_or_else(|| {
            DagMlError::RuntimeValidation("browser HPO worker lost native scores".into())
        })?;
    let (score, objective_fold_scores, _) =
        host_hpo_score(&task.candidate_plan, request, &variant.variant_id, &scores)?;
    Ok(HostHpoTrialEvidence {
        trial_index: task.trial_index,
        params: task.params.clone(),
        score,
        variant_id: variant.variant_id.clone(),
        scores,
        objective_fold_scores,
        generated_view_manifest: host_hpo_provider_manifest(provider)?,
    })
}

/// One native FIT_CV fold evaluated by a candidate-local browser worker.
/// This is an intermediate score, not a terminal or aggregate OOF score.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostHpoWorkerFoldResult {
    pub trial_index: u32,
    pub fold_index: u32,
    pub fold_id: FoldId,
    pub score: f64,
    pub scores: ScoreSet,
    pub data_fingerprint: String,
}

/// Execute one fold and return native report evidence before the next fold can
/// be scheduled. A worker never makes the pruning decision itself.
#[allow(clippy::too_many_arguments)]
pub fn evaluate_host_hpo_worker_fold(
    task: &HostHpoWorkerTask,
    request: &HostHpoSearchRequest,
    fold_index: u32,
    controllers: &RuntimeControllerRegistry,
    provider: &dyn RuntimeDataProvider,
    data_fingerprint: &str,
) -> Result<HostHpoWorkerFoldResult> {
    request.validate_browser_execution()?;
    validate_structural_worker_task(task, request)?;
    task.candidate_plan.validate()?;
    let [variant] = task.candidate_plan.variants.as_slice() else {
        return Err(DagMlError::RuntimeValidation(
            "browser HPO worker fold requires one candidate variant".into(),
        ));
    };
    if variant.variant_id.as_str() != format!("host_hpo:trial:{:010}", task.trial_index)
        || task.phase_index != request.phase_index(task.trial_index)
    {
        return Err(DagMlError::RuntimeValidation(
            "browser HPO worker fold trial/phase identity mismatch".into(),
        ));
    }
    let (scores, score) = SequentialScheduler.execute_host_hpo_worker_fold(
        &task.candidate_plan,
        controllers,
        provider,
        request,
        fold_index as usize,
    )?;
    let fold_id = task
        .candidate_plan
        .fold_set
        .as_ref()
        .expect("validated FoldSet")
        .folds[fold_index as usize]
        .fold_id
        .clone();
    Ok(HostHpoWorkerFoldResult {
        trial_index: task.trial_index,
        fold_index,
        fold_id,
        score,
        scores,
        data_fingerprint: data_fingerprint.to_owned(),
    })
}

/// Reject an altered worker fold before any optimizer feedback. The evidence
/// must contain exactly the declared native target report for this fold.
pub fn validate_host_hpo_worker_fold_result(
    task: &HostHpoWorkerTask,
    request: &HostHpoSearchRequest,
    data_fingerprint: &str,
    result: &HostHpoWorkerFoldResult,
) -> Result<()> {
    let target_node = request.target_for_plan(&task.candidate_plan)?;
    let fold = task
        .candidate_plan
        .fold_set
        .as_ref()
        .and_then(|set| set.folds.get(result.fold_index as usize))
        .ok_or_else(|| DagMlError::RuntimeValidation("worker fold index is out of range".into()))?;
    if result.trial_index != task.trial_index
        || result.fold_id != fold.fold_id
        || result.data_fingerprint != data_fingerprint
        || result.scores.plan_id != task.candidate_plan.id
        || !result.score.is_finite()
        || result.scores.reports.iter().any(|report| {
            report
                .fold_id
                .as_ref()
                .is_some_and(|id| id != &fold.fold_id)
                || report
                    .variant_id
                    .as_ref()
                    .is_some_and(|id| id != &task.candidate_plan.variants[0].variant_id)
        })
    {
        return Err(DagMlError::RuntimeValidation(
            "worker fold identity, data or score provenance mismatch".into(),
        ));
    }
    result.scores.validate()?;
    let reports = result
        .scores
        .reports
        .iter()
        .filter(|report| {
            report.producer_node == *target_node
                && report_matches_statistical_policy(report, &task.candidate_plan)
                && report.partition == PredictionPartition::Validation
                && report.fold_id.as_ref() == Some(&fold.fold_id)
        })
        .collect::<Vec<_>>();
    let [report] = reports.as_slice() else {
        return Err(DagMlError::RuntimeValidation(
            "worker fold lacks exactly one native target score".into(),
        ));
    };
    if host_hpo_metric(report, request.metric)? != result.score {
        return Err(DagMlError::RuntimeValidation(
            "worker fold score differs from native target report".into(),
        ));
    }
    Ok(())
}

/// Validate a contiguous prefix of fold feedback and calculate the exact
/// scalar passed to the optimizer's pruning callback.
pub fn host_hpo_worker_intermediate_score(
    task: &HostHpoWorkerTask,
    request: &HostHpoSearchRequest,
    data_fingerprint: &str,
    folds: &[HostHpoWorkerFoldResult],
) -> Result<f64> {
    if folds.is_empty() {
        return Err(DagMlError::RuntimeValidation(
            "worker pruning feedback requires at least one fold".into(),
        ));
    }
    let mut scores = BTreeMap::new();
    for (index, result) in folds.iter().enumerate() {
        if result.fold_index as usize != index {
            return Err(DagMlError::RuntimeValidation(
                "worker pruning feedback has a noncontiguous fold prefix".into(),
            ));
        }
        validate_host_hpo_worker_fold_result(task, request, data_fingerprint, result)?;
        scores.insert(result.fold_id.as_str().to_owned(), result.score);
    }
    reduce_host_hpo_fold_scores(
        &scores,
        request
            .fold_score_reduction
            .unwrap_or(HostHpoFoldReduction::Best),
        request.direction,
    )
}

pub fn host_hpo_worker_pruned_evidence(
    task: &HostHpoWorkerTask,
    request: &HostHpoSearchRequest,
    data_fingerprint: &str,
    folds: &[HostHpoWorkerFoldResult],
) -> Result<HostHpoPrunedTrialEvidence> {
    host_hpo_worker_intermediate_score(task, request, data_fingerprint, folds)?;
    let mut scores = folds[0].scores.clone();
    for fold in &folds[1..] {
        scores.reports.extend(fold.scores.reports.iter().cloned());
    }
    scores.validate()?;
    Ok(HostHpoPrunedTrialEvidence {
        trial_index: task.trial_index,
        params: task.params.clone(),
        variant_id: task.candidate_plan.variants[0].variant_id.clone(),
        scores,
        intermediate_scores: folds.iter().map(|fold| fold.score).collect(),
        generated_view_manifest: None,
    })
}

/// A worker may finish in any order; the coordinator processes these keyed
/// results only after every launched candidate has terminalized.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub enum HostHpoWorkerResult {
    Complete {
        evidence: HostHpoTrialEvidence,
        data_fingerprint: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        fold_evidence: Vec<HostHpoWorkerFoldResult>,
    },
    Pruned {
        evidence: HostHpoPrunedTrialEvidence,
        data_fingerprint: String,
        fold_evidence: Vec<HostHpoWorkerFoldResult>,
    },
    Failed {
        trial_index: u32,
        error: String,
    },
}

impl HostHpoWorkerResult {
    fn trial_index(&self) -> u32 {
        match self {
            Self::Complete { evidence, .. } => evidence.trial_index,
            Self::Pruned { evidence, .. } => evidence.trial_index,
            Self::Failed { trial_index, .. } => *trial_index,
        }
    }
}

/// Validate all worker evidence, then publish terminal transitions in trial
/// order. A worker's scalar score is recomputed from its native ScoreSet; an
/// unmatched or altered candidate plan, trial ID, sample fold, or checkpoint
/// is rejected before any optimizer `tell`.
#[allow(clippy::too_many_arguments)]
pub fn complete_host_hpo_worker_window(
    plan: &ExecutionPlan,
    request: &HostHpoSearchRequest,
    options: &HostHpoResumeOptions,
    window: HostHpoWorkerWindow,
    results: Vec<HostHpoWorkerResult>,
    proposals: &mut dyn HostHpoProposalSource,
    progress: &mut dyn HostHpoProgress,
) -> Result<HostHpoSearchOutcome> {
    request.validate_browser_execution()?;
    let expected_checkpoint = prepare_host_hpo_checkpoint(plan, request, options)?;
    if stable_json_fingerprint(&expected_checkpoint)?
        != stable_json_fingerprint(&window.checkpoint)?
        || window.window_id
            != stable_json_fingerprint(&(
                &window.checkpoint.fingerprint,
                &options.data_fingerprint,
                &window.tasks,
                window.exhausted,
            ))?
        || results.len() != window.tasks.len()
    {
        return Err(DagMlError::RuntimeValidation(
            "browser HPO window checkpoint, identity or result count mismatch".into(),
        ));
    }
    let first = window.checkpoint.trials.len() as u32;
    let phase = request.phase_index(first);
    for (offset, task) in window.tasks.iter().enumerate() {
        let expected = host_hpo_worker_candidate_plan(
            plan,
            request,
            &window.checkpoint,
            task.trial_index,
            &task.params,
        )?;
        if task.trial_index != first + offset as u32
            || task.phase_index != phase
            || task.phase_index != request.phase_index(task.trial_index)
            || stable_json_fingerprint(&task.candidate_plan)? != stable_json_fingerprint(&expected)?
        {
            return Err(DagMlError::RuntimeValidation(
                "browser HPO window candidate plan or phase mismatch".into(),
            ));
        }
    }
    let mut keyed = BTreeMap::new();
    for result in results {
        if keyed.insert(result.trial_index(), result).is_some() {
            return Err(DagMlError::RuntimeValidation(
                "browser HPO window has duplicate worker trial result".into(),
            ));
        }
    }
    if keyed.len() != window.tasks.len()
        || window
            .tasks
            .iter()
            .any(|task| !keyed.contains_key(&task.trial_index))
    {
        return Err(DagMlError::RuntimeValidation(
            "browser HPO window is missing a worker trial result".into(),
        ));
    }
    // Validate every worker response before mutating optimizer state.
    for task in &window.tasks {
        let target_node = request.target_for_plan(&task.candidate_plan)?;
        match keyed
            .get(&task.trial_index)
            .expect("checked result coverage")
        {
            HostHpoWorkerResult::Complete {
                evidence,
                data_fingerprint,
                fold_evidence,
            } => {
                if evidence.params != task.params
                    || evidence.variant_id != task.candidate_plan.variants[0].variant_id
                    || data_fingerprint != &options.data_fingerprint
                {
                    return Err(DagMlError::RuntimeValidation(
                        "browser HPO worker evidence proposal/variant mismatch".into(),
                    ));
                }
                host_hpo_candidate(plan, request, evidence)?;
                if request.progressive_pruning {
                    if fold_evidence.len()
                        != plan
                            .fold_set
                            .as_ref()
                            .expect("validated FoldSet")
                            .folds
                            .len()
                    {
                        return Err(DagMlError::RuntimeValidation(
                            "completed prunable worker lacks all fold feedback".into(),
                        ));
                    }
                    host_hpo_worker_intermediate_score(
                        task,
                        request,
                        &options.data_fingerprint,
                        fold_evidence,
                    )?;
                    for fold in fold_evidence {
                        let reports = evidence
                            .scores
                            .reports
                            .iter()
                            .filter(|report| {
                                report.producer_node == *target_node
                                    && report_matches_statistical_policy(report, plan)
                                    && report.partition == PredictionPartition::Validation
                                    && report.fold_id.as_ref() == Some(&fold.fold_id)
                            })
                            .collect::<Vec<_>>();
                        let [report] = reports.as_slice() else {
                            return Err(DagMlError::RuntimeValidation(
                                "completed worker lacks a feedback fold report".into(),
                            ));
                        };
                        if host_hpo_metric(report, request.metric)? != fold.score {
                            return Err(DagMlError::RuntimeValidation(
                                "completed worker changed a reported fold score".into(),
                            ));
                        }
                    }
                } else if !fold_evidence.is_empty() {
                    return Err(DagMlError::RuntimeValidation(
                        "nonprunable worker unexpectedly supplied fold feedback".into(),
                    ));
                }
            }
            HostHpoWorkerResult::Pruned {
                evidence,
                data_fingerprint,
                fold_evidence,
            } => {
                if !request.progressive_pruning
                    || data_fingerprint != &options.data_fingerprint
                    || evidence.params != task.params
                    || evidence.variant_id != task.candidate_plan.variants[0].variant_id
                {
                    return Err(DagMlError::RuntimeValidation(
                        "pruned worker proposal or data identity mismatch".into(),
                    ));
                }
                let observed = host_hpo_worker_pruned_evidence(
                    task,
                    request,
                    &options.data_fingerprint,
                    fold_evidence,
                )?;
                if stable_json_fingerprint(&observed)? != stable_json_fingerprint(evidence)? {
                    return Err(DagMlError::RuntimeValidation(
                        "pruned worker terminal differs from observed fold feedback".into(),
                    ));
                }
                if evidence.intermediate_scores.is_empty()
                    || evidence.intermediate_scores.len()
                        > plan
                            .fold_set
                            .as_ref()
                            .expect("validated FoldSet")
                            .folds
                            .len()
                {
                    return Err(DagMlError::RuntimeValidation(
                        "pruned worker has an invalid fold prefix".into(),
                    ));
                }
                evidence.scores.validate()?;
                for (index, score) in evidence.intermediate_scores.iter().enumerate() {
                    let fold = &plan.fold_set.as_ref().expect("validated FoldSet").folds[index];
                    let reports = evidence
                        .scores
                        .reports
                        .iter()
                        .filter(|report| {
                            report.producer_node == *target_node
                                && report_matches_statistical_policy(report, plan)
                                && report.partition == PredictionPartition::Validation
                                && report.fold_id.as_ref() == Some(&fold.fold_id)
                        })
                        .collect::<Vec<_>>();
                    let [report] = reports.as_slice() else {
                        return Err(DagMlError::RuntimeValidation(
                            "pruned worker lacks a native fold report".into(),
                        ));
                    };
                    if host_hpo_metric(report, request.metric)? != *score {
                        return Err(DagMlError::RuntimeValidation(
                            "pruned worker fold feedback differs from native score".into(),
                        ));
                    }
                }
            }
            HostHpoWorkerResult::Failed { error, .. } if error.trim().is_empty() => {
                return Err(DagMlError::RuntimeValidation(
                    "browser HPO worker failure requires an error".into(),
                ));
            }
            HostHpoWorkerResult::Failed { .. } => {}
        }
    }
    let mut checkpoint = window.checkpoint;
    let mut cancel_requested = false;
    let mut failed = false;
    for task in &window.tasks {
        let result = keyed
            .remove(&task.trial_index)
            .expect("checked result coverage");
        let terminal = match &result {
            HostHpoWorkerResult::Complete { evidence, .. } => HostHpoTerminalTrial::Complete {
                evidence: evidence.clone(),
            },
            HostHpoWorkerResult::Pruned { evidence, .. } => HostHpoTerminalTrial::Pruned {
                evidence: evidence.clone(),
            },
            HostHpoWorkerResult::Failed { error, .. } => {
                failed = true;
                HostHpoTerminalTrial::Failed {
                    trial_index: task.trial_index,
                    params: task.params.clone(),
                    variant_id: task.candidate_plan.variants[0].variant_id.clone(),
                    error: error.clone(),
                    generated_view_manifest: None,
                }
            }
        };
        let status = if failed {
            HostHpoSearchStatus::Failed
        } else if task.trial_index + 1 == request.trial_budget {
            HostHpoSearchStatus::Completed
        } else {
            HostHpoSearchStatus::Running
        };
        let mut prepared = checkpoint.clone();
        prepared.trials.push(terminal);
        prepared.seal()?;
        prepare_host_hpo_checkpoint(
            plan,
            request,
            &HostHpoResumeOptions {
                data_fingerprint: options.data_fingerprint.clone(),
                checkpoint: Some(prepared.clone()),
            },
        )?;
        progress.prepare_terminal(&prepared, status)?;
        match result {
            HostHpoWorkerResult::Complete { evidence, .. } => {
                proposals.tell(task.trial_index, evidence.score)?;
            }
            HostHpoWorkerResult::Pruned { .. } => {
                proposals.pruned(task.trial_index)?;
            }
            HostHpoWorkerResult::Failed { error, .. } => {
                proposals.fail(task.trial_index, &error)?;
            }
        }
        checkpoint = prepared;
        if !progress.checkpoint(&checkpoint, status)? && status == HostHpoSearchStatus::Running {
            cancel_requested = true;
        }
    }
    let status = if failed {
        HostHpoSearchStatus::Failed
    } else if cancel_requested {
        HostHpoSearchStatus::Cancelled
    } else if window.exhausted {
        HostHpoSearchStatus::Exhausted
    } else if checkpoint.trials.len() == request.trial_budget as usize {
        HostHpoSearchStatus::Completed
    } else {
        HostHpoSearchStatus::Running
    };
    if matches!(
        status,
        HostHpoSearchStatus::Cancelled | HostHpoSearchStatus::Exhausted
    ) {
        progress.checkpoint(&checkpoint, status)?;
    }
    let trials = checkpoint
        .trials
        .iter()
        .filter_map(|trial| match trial {
            HostHpoTerminalTrial::Complete { evidence } => Some(evidence.clone()),
            _ => None,
        })
        .collect::<Vec<_>>();
    let pruned_trials = checkpoint
        .trials
        .iter()
        .filter_map(|trial| match trial {
            HostHpoTerminalTrial::Pruned { evidence } => Some(evidence.clone()),
            _ => None,
        })
        .collect::<Vec<_>>();
    let result = if trials.is_empty() {
        None
    } else {
        let candidates = trials
            .iter()
            .map(|trial| host_hpo_candidate(plan, request, trial))
            .collect::<Result<Vec<_>>>()?;
        let policy = SelectionPolicy {
            requested_rank: None,
            id: "select:host_hpo".into(),
            metric: SelectionMetric {
                name: request.metric.name().into(),
                objective: request.direction,
            },
            required_metric_level: None,
            require_finite: true,
            evaluation_scope: None,
            refit_slot_plan: None,
            stacking_fit_contract: None,
            reduction_id: None,
        };
        let selected = select_candidate(&policy, &candidates)?;
        let winner = trials
            .iter()
            .find(|trial| trial.variant_id.as_str() == selected.selected_candidate_id)
            .expect("selected observed candidate");
        Some(HostHpoSearchResult {
            profile: "host_optimizer_search_v1".into(),
            portable: false,
            request_fingerprint: stable_json_fingerprint(request)?,
            graph_fingerprint: plan.graph_fingerprint.clone(),
            controller_fingerprint: plan.controller_fingerprint.clone(),
            campaign_fingerprint: stable_json_fingerprint(&plan.campaign)?,
            fold_set_fingerprint: stable_json_fingerprint(
                plan.fold_set.as_ref().expect("validated host HPO folds"),
            )?,
            selected_trial_index: winner.trial_index,
            selected_params: winner.params.clone(),
            trials,
            pruned_trials,
        })
    };
    Ok(HostHpoSearchOutcome {
        result,
        status,
        checkpoint: Some(checkpoint),
    })
}

impl SequentialScheduler {
    /// Execute candidate FIT_CV only; the caller's outer scope owns final fitting.
    /// Every trial gets an isolated context and the same already-attested folds.
    /// A controller failure propagates immediately: no retry or replacement score.
    pub fn execute_host_hpo_search(
        &self,
        plan: &ExecutionPlan,
        controllers: &RuntimeControllerRegistry,
        provider: &dyn RuntimeDataProvider,
        request: &HostHpoSearchRequest,
        proposals: &mut dyn HostHpoProposalSource,
    ) -> Result<HostHpoSearchResult> {
        self.execute_host_hpo_search_inner(
            plan,
            controllers,
            provider,
            None,
            None,
            request,
            proposals,
            None,
        )?
        .result
        .ok_or_else(|| DagMlError::RuntimeValidation("host HPO has no successful candidate".into()))
    }

    /// Resume terminal native evidence and publish progress between trials.
    /// The budget is a total across calls; SELECT includes historical winners.
    #[allow(clippy::too_many_arguments)]
    pub fn execute_resumable_host_hpo_search(
        &self,
        plan: &ExecutionPlan,
        controllers: &RuntimeControllerRegistry,
        provider: &dyn RuntimeDataProvider,
        request: &HostHpoSearchRequest,
        proposals: &mut dyn HostHpoProposalSource,
        options: &HostHpoResumeOptions,
        progress: &mut dyn HostHpoProgress,
    ) -> Result<HostHpoSearchOutcome> {
        self.execute_host_hpo_search_inner(
            plan,
            controllers,
            provider,
            None,
            None,
            request,
            proposals,
            Some((options, progress)),
        )
    }

    /// Candidate-local provider variant of the durable host search. The
    /// factory is invoked only for trials that are actually evaluated, never
    /// for terminal trials restored from a checkpoint.
    #[allow(clippy::too_many_arguments)]
    pub fn execute_resumable_host_hpo_search_with_provider_factory(
        &self,
        plan: &ExecutionPlan,
        controllers: &RuntimeControllerRegistry,
        provider: &dyn RuntimeDataProvider,
        provider_factory: &dyn HostHpoCandidateProviderFactory,
        request: &HostHpoSearchRequest,
        proposals: &mut dyn HostHpoProposalSource,
        options: &HostHpoResumeOptions,
        progress: &mut dyn HostHpoProgress,
    ) -> Result<HostHpoSearchOutcome> {
        self.execute_host_hpo_search_inner(
            plan,
            controllers,
            provider,
            Some(provider_factory),
            None,
            request,
            proposals,
            Some((options, progress)),
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn execute_resumable_host_hpo_search_with_candidate_factories(
        &self,
        plan: &ExecutionPlan,
        controllers: &RuntimeControllerRegistry,
        provider: &dyn RuntimeDataProvider,
        provider_factory: &dyn HostHpoCandidateProviderFactory,
        controller_factory: &dyn HostHpoCandidateControllerFactory,
        request: &HostHpoSearchRequest,
        proposals: &mut dyn HostHpoProposalSource,
        options: &HostHpoResumeOptions,
        progress: &mut dyn HostHpoProgress,
    ) -> Result<HostHpoSearchOutcome> {
        self.execute_host_hpo_search_inner(
            plan,
            controllers,
            provider,
            Some(provider_factory),
            Some(controller_factory),
            request,
            proposals,
            Some((options, progress)),
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn execute_host_hpo_search_inner(
        &self,
        plan: &ExecutionPlan,
        controllers: &RuntimeControllerRegistry,
        provider: &dyn RuntimeDataProvider,
        provider_factory: Option<&dyn HostHpoCandidateProviderFactory>,
        controller_factory: Option<&dyn HostHpoCandidateControllerFactory>,
        request: &HostHpoSearchRequest,
        proposals: &mut dyn HostHpoProposalSource,
        mut durable: Option<(&HostHpoResumeOptions, &mut dyn HostHpoProgress)>,
    ) -> Result<HostHpoSearchOutcome> {
        request.validate_parallel_execution_for_plan(1, plan)?;
        plan.validate()?;
        if request.trial_budget == 0 || request.optimizer_descriptor.is_empty() {
            return Err(DagMlError::RuntimeValidation(
                "host HPO requires a positive budget and explicit optimizer descriptor".into(),
            ));
        }
        if !request.phase_trial_budgets.is_empty()
            && (request.phase_trial_budgets.contains(&0)
                || request
                    .phase_trial_budgets
                    .iter()
                    .try_fold(0u32, |total, budget| total.checked_add(*budget))
                    != Some(request.trial_budget))
        {
            return Err(DagMlError::RuntimeValidation(
                "host HPO phase budgets must be positive and sum to trial_budget".into(),
            ));
        }
        let folds = plan.fold_set.as_ref().ok_or_else(|| {
            DagMlError::RuntimeValidation("host HPO requires explicit evaluation folds".into())
        })?;
        if plan.variants.len() != 1
            || !plan.variants[0].choices.is_empty()
            || plan
                .node_plans
                .get(&request.target_node)
                .is_none_or(|node| node.kind != NodeKind::Model)
        {
            return Err(DagMlError::RuntimeValidation(
                "host HPO requires one concrete base variant and a model target".into(),
            ));
        }
        request.validate_parameter_bindings(plan)?;
        let mut checkpoint = durable
            .as_ref()
            .map(|(options, _)| prepare_host_hpo_checkpoint(plan, request, options))
            .transpose()?;
        let mut trials = checkpoint
            .as_ref()
            .map(|checkpoint| {
                checkpoint
                    .trials
                    .iter()
                    .filter_map(|trial| match trial {
                        HostHpoTerminalTrial::Complete { evidence } => Some(evidence.clone()),
                        HostHpoTerminalTrial::Pruned { .. }
                        | HostHpoTerminalTrial::Failed { .. } => None,
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let mut pruned_trials = checkpoint
            .as_ref()
            .map(|checkpoint| {
                checkpoint
                    .trials
                    .iter()
                    .filter_map(|trial| match trial {
                        HostHpoTerminalTrial::Pruned { evidence } => Some(evidence.clone()),
                        _ => None,
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let mut candidates = trials
            .iter()
            .map(|trial| host_hpo_candidate(plan, request, trial))
            .collect::<Result<Vec<_>>>()?;
        let history_len = checkpoint
            .as_ref()
            .map_or(0, |checkpoint| checkpoint.trials.len() as u32);
        let mut status = if history_len == request.trial_budget {
            HostHpoSearchStatus::Completed
        } else {
            HostHpoSearchStatus::Running
        };
        if let (Some(checkpoint), Some((_, progress))) = (&checkpoint, &mut durable) {
            if !progress.checkpoint(checkpoint, status)? && status == HostHpoSearchStatus::Running {
                status = HostHpoSearchStatus::Cancelled;
            }
        }
        for trial_index in history_len..request.trial_budget {
            if status == HostHpoSearchStatus::Cancelled {
                break;
            }
            let Some(params) =
                proposals.ask_in_phase(trial_index, request.phase_index(trial_index))?
            else {
                status = HostHpoSearchStatus::Exhausted;
                break;
            };
            let candidate_plan = host_hpo_candidate_plan(
                plan,
                request,
                trial_index,
                &params,
                checkpoint
                    .as_ref()
                    .map(|saved| saved.binding.objective_fingerprint.as_str()),
            )?;
            let variant = candidate_plan.variants[0].clone();
            let mut context = RunContext::new(
                RunId::new(format!("run:host_hpo:{trial_index}"))?,
                variant.seed.or(plan.campaign.root_seed),
            );
            context.variant_id = Some(variant.variant_id.clone());
            context.resource_limits = crate::python_torch_profile::torch_resources(&candidate_plan);
            let candidate_provider = provider_factory
                .map(|factory| factory.create(trial_index))
                .transpose()?;
            let provider = candidate_provider
                .as_deref()
                .map(|provider| provider as &dyn RuntimeDataProvider)
                .unwrap_or(provider);
            let candidate_controllers = controller_factory
                .map(|factory| factory.create(trial_index))
                .transpose()?;
            let controllers = candidate_controllers.as_ref().unwrap_or(controllers);
            let evaluated: Result<HostHpoEvaluation> = (|| {
                if request.progressive_pruning {
                    let mut intermediates = Vec::new();
                    let pruned = self.execute_host_hpo_candidate_fit_cv(
                        &candidate_plan,
                        controllers,
                        provider,
                        &mut context,
                        request,
                        &mut |step, score| {
                            intermediates.push(score);
                            let fold_scores = folds
                                .folds
                                .iter()
                                .zip(&intermediates)
                                .map(|(fold, value)| (fold.fold_id.as_str().to_owned(), *value))
                                .collect::<BTreeMap<_, _>>();
                            let aggregate = reduce_host_hpo_fold_scores(
                                &fold_scores,
                                request
                                    .fold_score_reduction
                                    .unwrap_or(HostHpoFoldReduction::Best),
                                request.direction,
                            )?;
                            proposals.report_intermediate(trial_index, step, aggregate)
                        },
                    )?;
                    if pruned {
                        let scores =
                            context
                                .build_score_set(plan.id.clone(), None)
                                .ok_or_else(|| {
                                    DagMlError::RuntimeValidation(
                                        "pruned host HPO trial lost native fold score evidence"
                                            .into(),
                                    )
                                })?;
                        return Ok(HostHpoEvaluation::Pruned(HostHpoPrunedTrialEvidence {
                            trial_index,
                            params: params.clone(),
                            variant_id: variant.variant_id.clone(),
                            scores,
                            intermediate_scores: intermediates,
                            generated_view_manifest: host_hpo_provider_manifest(provider)?,
                        }));
                    }
                } else {
                    self.execute_campaign_phase_with_data_provider(
                        &candidate_plan,
                        controllers,
                        provider,
                        &mut context,
                        Phase::FitCv,
                    )?;
                }
                context.collect_cross_fold_validation_scores_for_target(
                    plan_oof_partition_mode(plan),
                    request.metric,
                    Some(&request.target_node),
                )?;
                let scores = context
                    .build_score_set(plan.id.clone(), None)
                    .ok_or_else(|| {
                        DagMlError::RuntimeValidation("host HPO lost native score evidence".into())
                    })?;
                let (score, objective_fold_scores, candidate) =
                    host_hpo_score(&candidate_plan, request, &variant.variant_id, &scores)?;
                Ok(HostHpoEvaluation::Complete(
                    HostHpoTrialEvidence {
                        trial_index,
                        params: params.clone(),
                        score,
                        variant_id: variant.variant_id.clone(),
                        scores,
                        objective_fold_scores,
                        generated_view_manifest: host_hpo_provider_manifest(provider)?,
                    },
                    candidate,
                ))
            })();
            let evaluated = match evaluated {
                Ok(result) => result,
                Err(error) => {
                    if let (Some(checkpoint), Some((_, progress))) = (&mut checkpoint, &mut durable)
                    {
                        let mut prepared = checkpoint.clone();
                        prepared.trials.push(HostHpoTerminalTrial::Failed {
                            trial_index,
                            params: params.clone(),
                            variant_id: variant.variant_id.clone(),
                            error: error.to_string(),
                            generated_view_manifest: provider
                                .generated_view_manifest_on_failure()?,
                        });
                        prepared.seal()?;
                        progress.prepare_terminal(&prepared, HostHpoSearchStatus::Failed)?;
                        proposals.fail(trial_index, &error.to_string())?;
                        *checkpoint = prepared;
                        progress.checkpoint(checkpoint, HostHpoSearchStatus::Failed)?;
                    }
                    return Err(error);
                }
            };
            if let HostHpoEvaluation::Pruned(evidence) = evaluated {
                status = if trial_index + 1 == request.trial_budget {
                    HostHpoSearchStatus::Completed
                } else {
                    HostHpoSearchStatus::Running
                };
                let prospective =
                    if let (Some(checkpoint), Some((_, progress))) = (&checkpoint, &mut durable) {
                        let mut prepared = checkpoint.clone();
                        prepared.trials.push(HostHpoTerminalTrial::Pruned {
                            evidence: evidence.clone(),
                        });
                        prepared.seal()?;
                        progress.prepare_terminal(&prepared, status)?;
                        Some(prepared)
                    } else {
                        None
                    };
                proposals.pruned(trial_index)?;
                pruned_trials.push(evidence.clone());
                if let (Some(checkpoint), Some((_, progress))) = (&mut checkpoint, &mut durable) {
                    *checkpoint = prospective.expect("durable search prepared terminal trial");
                    if !progress.checkpoint(checkpoint, status)?
                        && status == HostHpoSearchStatus::Running
                    {
                        status = HostHpoSearchStatus::Cancelled;
                    }
                }
                continue;
            }
            let HostHpoEvaluation::Complete(evidence, candidate) = evaluated else {
                unreachable!("pruned host HPO candidate was handled above")
            };
            status = if trial_index + 1 == request.trial_budget {
                HostHpoSearchStatus::Completed
            } else {
                HostHpoSearchStatus::Running
            };
            let prospective =
                if let (Some(checkpoint), Some((_, progress))) = (&checkpoint, &mut durable) {
                    let mut prepared = checkpoint.clone();
                    prepared.trials.push(HostHpoTerminalTrial::Complete {
                        evidence: evidence.clone(),
                    });
                    prepared.seal()?;
                    progress.prepare_terminal(&prepared, status)?;
                    Some(prepared)
                } else {
                    None
                };
            proposals.tell(trial_index, evidence.score)?;
            candidates.push(candidate);
            trials.push(evidence.clone());
            if let (Some(checkpoint), Some((_, progress))) = (&mut checkpoint, &mut durable) {
                *checkpoint = prospective.expect("durable search prepared terminal trial");
                if !progress.checkpoint(checkpoint, status)?
                    && status == HostHpoSearchStatus::Running
                {
                    status = HostHpoSearchStatus::Cancelled;
                }
            }
        }
        if matches!(
            status,
            HostHpoSearchStatus::Cancelled | HostHpoSearchStatus::Exhausted
        ) {
            if let (Some(checkpoint), Some((_, progress))) = (&checkpoint, &mut durable) {
                progress.checkpoint(checkpoint, status)?;
            }
        }
        if candidates.is_empty() {
            return Ok(HostHpoSearchOutcome {
                result: None,
                status,
                checkpoint,
            });
        }
        let policy = SelectionPolicy {
            requested_rank: None,
            id: "select:host_hpo".into(),
            metric: SelectionMetric {
                name: request.metric.name().into(),
                objective: request.direction,
            },
            required_metric_level: None,
            require_finite: true,
            evaluation_scope: None,
            refit_slot_plan: None,
            stacking_fit_contract: None,
            reduction_id: None,
        };
        let selected = select_candidate(&policy, &candidates)?;
        let winner = trials
            .iter()
            .find(|trial| trial.variant_id.as_str() == selected.selected_candidate_id)
            .expect("selection returns an observed candidate");
        Ok(HostHpoSearchOutcome {
            result: Some(HostHpoSearchResult {
                profile: "host_optimizer_search_v1".into(),
                portable: false,
                request_fingerprint: stable_json_fingerprint(request)?,
                graph_fingerprint: plan.graph_fingerprint.clone(),
                controller_fingerprint: plan.controller_fingerprint.clone(),
                campaign_fingerprint: stable_json_fingerprint(&plan.campaign)?,
                fold_set_fingerprint: stable_json_fingerprint(folds)?,
                selected_trial_index: winner.trial_index,
                selected_params: winner.params.clone(),
                trials,
                pruned_trials,
            }),
            status,
            checkpoint,
        })
    }

    /// Non-durable search with a separate provider and handle namespace for
    /// every evaluated candidate.
    pub fn execute_host_hpo_search_with_provider_factory(
        &self,
        plan: &ExecutionPlan,
        controllers: &RuntimeControllerRegistry,
        provider: &dyn RuntimeDataProvider,
        provider_factory: &dyn HostHpoCandidateProviderFactory,
        request: &HostHpoSearchRequest,
        proposals: &mut dyn HostHpoProposalSource,
    ) -> Result<HostHpoSearchResult> {
        self.execute_host_hpo_search_inner(
            plan,
            controllers,
            provider,
            Some(provider_factory),
            None,
            request,
            proposals,
            None,
        )?
        .result
        .ok_or_else(|| DagMlError::RuntimeValidation("host HPO has no successful candidate".into()))
    }

    #[allow(clippy::too_many_arguments)]
    pub fn execute_host_hpo_search_with_candidate_factories(
        &self,
        plan: &ExecutionPlan,
        controllers: &RuntimeControllerRegistry,
        provider: &dyn RuntimeDataProvider,
        provider_factory: &dyn HostHpoCandidateProviderFactory,
        controller_factory: &dyn HostHpoCandidateControllerFactory,
        request: &HostHpoSearchRequest,
        proposals: &mut dyn HostHpoProposalSource,
    ) -> Result<HostHpoSearchResult> {
        self.execute_host_hpo_search_inner(
            plan,
            controllers,
            provider,
            Some(provider_factory),
            Some(controller_factory),
            request,
            proposals,
            None,
        )?
        .result
        .ok_or_else(|| DagMlError::RuntimeValidation("host HPO has no successful candidate".into()))
    }

    /// Evaluate bounded candidate windows while the coordinator alone owns all
    /// optimizer transitions. Intermediate fold reports cross a channel back
    /// to that coordinator; no optimizer object enters a worker thread.
    #[allow(clippy::too_many_arguments)]
    pub fn execute_parallel_host_hpo_search_with_candidate_factories(
        &self,
        plan: &ExecutionPlan,
        provider_factory: &dyn HostHpoCandidateProviderFactory,
        controller_factory: &dyn HostHpoCandidateControllerFactory,
        request: &HostHpoSearchRequest,
        proposals: &mut dyn HostHpoProposalSource,
        max_parallel_trials: usize,
    ) -> Result<HostHpoSearchResult> {
        self.execute_parallel_host_hpo_search_inner(
            plan,
            provider_factory,
            controller_factory,
            request,
            proposals,
            max_parallel_trials,
            None,
        )?
        .result
        .ok_or_else(|| DagMlError::RuntimeValidation("host HPO has no successful candidate".into()))
    }

    #[allow(clippy::too_many_arguments)]
    pub fn execute_resumable_parallel_host_hpo_search_with_candidate_factories(
        &self,
        plan: &ExecutionPlan,
        provider_factory: &dyn HostHpoCandidateProviderFactory,
        controller_factory: &dyn HostHpoCandidateControllerFactory,
        request: &HostHpoSearchRequest,
        proposals: &mut dyn HostHpoProposalSource,
        max_parallel_trials: usize,
        options: &HostHpoResumeOptions,
        progress: &mut dyn HostHpoProgress,
    ) -> Result<HostHpoSearchOutcome> {
        self.execute_parallel_host_hpo_search_inner(
            plan,
            provider_factory,
            controller_factory,
            request,
            proposals,
            max_parallel_trials,
            Some((options, progress)),
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn execute_parallel_host_hpo_search_inner(
        &self,
        plan: &ExecutionPlan,
        provider_factory: &dyn HostHpoCandidateProviderFactory,
        controller_factory: &dyn HostHpoCandidateControllerFactory,
        request: &HostHpoSearchRequest,
        proposals: &mut dyn HostHpoProposalSource,
        max_parallel_trials: usize,
        mut durable: Option<(&HostHpoResumeOptions, &mut dyn HostHpoProgress)>,
    ) -> Result<HostHpoSearchOutcome> {
        if max_parallel_trials <= 1 {
            return Err(DagMlError::RuntimeValidation(
                "parallel host HPO requires at least two workers".into(),
            ));
        }
        let parallel_resources =
            request.validate_parallel_execution_for_plan(max_parallel_trials, plan)?;
        plan.validate()?;
        if request.trial_budget == 0 || request.optimizer_descriptor.is_empty() {
            return Err(DagMlError::RuntimeValidation(
                "host HPO requires a positive budget and explicit optimizer descriptor".into(),
            ));
        }
        if !request.phase_trial_budgets.is_empty()
            && (request.phase_trial_budgets.contains(&0)
                || request
                    .phase_trial_budgets
                    .iter()
                    .try_fold(0u32, |sum, count| sum.checked_add(*count))
                    != Some(request.trial_budget))
        {
            return Err(DagMlError::RuntimeValidation(
                "host HPO phase budgets must be positive and sum to trial_budget".into(),
            ));
        }
        let folds = plan.fold_set.as_ref().ok_or_else(|| {
            DagMlError::RuntimeValidation("host HPO requires explicit evaluation folds".into())
        })?;
        if plan.variants.len() != 1
            || !plan.variants[0].choices.is_empty()
            || plan
                .node_plans
                .get(&request.target_node)
                .is_none_or(|node| node.kind != NodeKind::Model)
        {
            return Err(DagMlError::RuntimeValidation(
                "host HPO requires one concrete base variant and a model target".into(),
            ));
        }
        request.validate_parameter_bindings(plan)?;
        let mut checkpoint = durable
            .as_ref()
            .map(|(options, _)| prepare_host_hpo_checkpoint(plan, request, options))
            .transpose()?;
        let mut trials = checkpoint
            .as_ref()
            .map(|saved| {
                saved
                    .trials
                    .iter()
                    .filter_map(|trial| {
                        if let HostHpoTerminalTrial::Complete { evidence } = trial {
                            Some(evidence.clone())
                        } else {
                            None
                        }
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let mut pruned_trials = checkpoint
            .as_ref()
            .map(|saved| {
                saved
                    .trials
                    .iter()
                    .filter_map(|trial| {
                        if let HostHpoTerminalTrial::Pruned { evidence } = trial {
                            Some(evidence.clone())
                        } else {
                            None
                        }
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let mut candidates = trials
            .iter()
            .map(|trial| host_hpo_candidate(plan, request, trial))
            .collect::<Result<Vec<_>>>()?;
        let mut next = checkpoint
            .as_ref()
            .map_or(0, |saved| saved.trials.len() as u32);
        let mut status = if next == request.trial_budget {
            HostHpoSearchStatus::Completed
        } else {
            HostHpoSearchStatus::Running
        };
        if let (Some(saved), Some((_, progress))) = (&checkpoint, &mut durable) {
            if !progress.checkpoint(saved, status)? && status == HostHpoSearchStatus::Running {
                status = HostHpoSearchStatus::Cancelled;
            }
        }
        while next < request.trial_budget && status == HostHpoSearchStatus::Running {
            let phase = request.phase_index(next);
            let mut pending = Vec::new();
            let mut exhausted = false;
            while pending.len() < max_parallel_trials
                && next < request.trial_budget
                && request.phase_index(next) == phase
            {
                let Some(params) = proposals.ask_in_phase(next, phase)? else {
                    exhausted = true;
                    break;
                };
                let candidate_plan = host_hpo_candidate_plan(
                    plan,
                    request,
                    next,
                    &params,
                    checkpoint
                        .as_ref()
                        .map(|saved| saved.binding.objective_fingerprint.as_str()),
                )?;
                let variant = candidate_plan.variants[0].clone();
                let mut context = RunContext::new(
                    RunId::new(format!("run:host_hpo:{next}"))?,
                    variant.seed.or(plan.campaign.root_seed),
                );
                context.resource_limits = parallel_resources.clone();
                context.variant_id = Some(variant.variant_id.clone());
                pending.push((
                    next,
                    params,
                    variant,
                    candidate_plan,
                    context,
                    provider_factory.create(next)?,
                    controller_factory.create(next)?,
                ));
                next += 1;
            }
            let pending_params = pending
                .iter()
                .map(|(index, params, ..)| (*index, params.clone()))
                .collect::<BTreeMap<_, _>>();
            let count = pending.len();
            if count == 0 {
                status = HostHpoSearchStatus::Exhausted;
                break;
            }
            let (events_tx, events_rx) = std::sync::mpsc::channel();
            let mut completed = std::thread::scope(|scope| {
                let handles = pending.into_iter().map(|(trial_index, params, variant,
                    candidate_plan, mut context, provider, controllers)| {
                    let tx = events_tx.clone();
                    let handle = scope.spawn(move || {
                        let evaluated: Result<HostHpoEvaluation> = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            if request.progressive_pruning {
                                let mut intermediates = Vec::new();
                                let pruned = self.execute_host_hpo_candidate_fit_cv(
                                    &candidate_plan, &controllers, provider.as_ref(), &mut context,
                                    request, &mut |step, score| {
                                        intermediates.push(score);
                                        let fold_scores = folds.folds.iter().zip(&intermediates)
                                            .map(|(fold, value)| (fold.fold_id.as_str().to_owned(), *value))
                                            .collect::<BTreeMap<_, _>>();
                                        let aggregate = reduce_host_hpo_fold_scores(
                                            &fold_scores,
                                            request.fold_score_reduction.unwrap_or(HostHpoFoldReduction::Best),
                                            request.direction,
                                        )?;
                                        let (reply_tx, reply_rx) = std::sync::mpsc::channel();
                                        tx.send(ParallelHostHpoEvent::Intermediate {
                                            trial_index, step, score: aggregate, reply: reply_tx,
                                        }).map_err(|_| DagMlError::RuntimeValidation(
                                            "host HPO pruning coordinator disconnected".into()))?;
                                        reply_rx.recv().map_err(|_| DagMlError::RuntimeValidation(
                                            "host HPO pruning coordinator dropped feedback".into()))?
                                    },
                                )?;
                                if pruned {
                                    let scores = context.build_score_set(plan.id.clone(), None)
                                        .ok_or_else(|| DagMlError::RuntimeValidation(
                                            "pruned host HPO trial lost native fold score evidence".into()))?;
                                    return Ok(HostHpoEvaluation::Pruned(HostHpoPrunedTrialEvidence {
                                        trial_index, params, variant_id: variant.variant_id,
                                        scores, intermediate_scores: intermediates,
                                        generated_view_manifest: host_hpo_provider_manifest(provider.as_ref())?,
                                    }));
                                }
                            } else {
                                self.execute_campaign_phase_with_data_provider(&candidate_plan,
                                    &controllers, provider.as_ref(), &mut context, Phase::FitCv)?;
                            }
                            context.collect_cross_fold_validation_scores_for_target(plan_oof_partition_mode(plan), request.metric, Some(&request.target_node))?;
                            let scores = context.build_score_set(plan.id.clone(), None)
                                .ok_or_else(|| DagMlError::RuntimeValidation(
                                    "host HPO lost native score evidence".into()))?;
                            let (score, objective_fold_scores, candidate) =
                                host_hpo_score(&candidate_plan, request, &variant.variant_id, &scores)?;
                            Ok(HostHpoEvaluation::Complete(HostHpoTrialEvidence {
                                trial_index, params, score, variant_id: variant.variant_id,
                                scores, objective_fold_scores,
                                generated_view_manifest: host_hpo_provider_manifest(provider.as_ref())?,
                            }, candidate))
                        })).unwrap_or_else(|_| Err(DagMlError::RuntimeValidation(
                            "host HPO candidate worker panicked".into())));
                        let _ = tx.send(ParallelHostHpoEvent::Completed {
                            trial_index,
                            evaluated: Box::new(evaluated),
                        });
                    });
                    (trial_index, handle)
                }).collect::<Vec<_>>();
                drop(events_tx);
                let mut completed = BTreeMap::new();
                // Pruners observe a stable trial/step order even when workers
                // finish at different times. Each worker waits for its reply.
                let mut active_trial = next - count as u32;
                let mut buffered: BTreeMap<u32, std::collections::VecDeque<ParallelHostHpoEvent>> =
                    BTreeMap::new();
                while completed.len() < count {
                    let Ok(event) = events_rx.recv() else {
                        break;
                    };
                    let trial_index = match &event {
                        ParallelHostHpoEvent::Intermediate { trial_index, .. }
                        | ParallelHostHpoEvent::Completed { trial_index, .. } => *trial_index,
                    };
                    buffered.entry(trial_index).or_default().push_back(event);
                    while let Some(event) = buffered
                        .get_mut(&active_trial)
                        .and_then(|queue| queue.pop_front())
                    {
                        match event {
                            ParallelHostHpoEvent::Intermediate {
                                trial_index,
                                step,
                                score,
                                reply,
                            } => {
                                let decision =
                                    proposals.report_intermediate(trial_index, step, score);
                                let _ = reply.send(decision);
                            }
                            ParallelHostHpoEvent::Completed {
                                trial_index,
                                evaluated,
                            } => {
                                completed.insert(trial_index, *evaluated);
                                active_trial += 1;
                            }
                        }
                    }
                }
                for (trial_index, handle) in handles {
                    if handle.join().is_err() {
                        completed.insert(
                            trial_index,
                            Err(DagMlError::RuntimeValidation(
                                "host HPO candidate worker panicked".into(),
                            )),
                        );
                    }
                }
                completed
            });
            let batch_manifest = provider_factory
                .batch_generated_view_manifest(completed.values().any(Result::is_ok))?;
            let mut first_error = None;
            let mut cancel_requested = false;
            for trial_index in next - count as u32..next {
                let evaluated = completed.remove(&trial_index).unwrap_or_else(|| {
                    Err(DagMlError::RuntimeValidation(
                        "host HPO candidate worker returned no result".into(),
                    ))
                });
                let evaluated = evaluated.map(|outcome| match outcome {
                    HostHpoEvaluation::Complete(mut evidence, candidate) => {
                        if let Some(manifest) = &batch_manifest {
                            evidence.generated_view_manifest = Some(manifest.clone());
                        }
                        HostHpoEvaluation::Complete(evidence, candidate)
                    }
                    HostHpoEvaluation::Pruned(mut evidence) => {
                        if let Some(manifest) = &batch_manifest {
                            evidence.generated_view_manifest = Some(manifest.clone());
                        }
                        HostHpoEvaluation::Pruned(evidence)
                    }
                });
                let trial_status = if evaluated.is_err() || first_error.is_some() {
                    HostHpoSearchStatus::Failed
                } else if trial_index + 1 == request.trial_budget {
                    HostHpoSearchStatus::Completed
                } else {
                    HostHpoSearchStatus::Running
                };
                let prospective = if let Some(saved) = &checkpoint {
                    let terminal = match &evaluated {
                        Ok(HostHpoEvaluation::Complete(evidence, _)) => {
                            HostHpoTerminalTrial::Complete {
                                evidence: evidence.clone(),
                            }
                        }
                        Ok(HostHpoEvaluation::Pruned(evidence)) => HostHpoTerminalTrial::Pruned {
                            evidence: evidence.clone(),
                        },
                        Err(error) => HostHpoTerminalTrial::Failed {
                            trial_index,
                            params: pending_params
                                .get(&trial_index)
                                .expect("pending proposal")
                                .clone(),
                            variant_id: VariantId::new(format!(
                                "host_hpo:trial:{trial_index:010}"
                            ))?,
                            error: error.to_string(),
                            generated_view_manifest: batch_manifest.clone(),
                        },
                    };
                    let mut prepared = saved.clone();
                    prepared.trials.push(terminal);
                    prepared.seal()?;
                    if let Some((_, progress)) = &mut durable {
                        progress.prepare_terminal(&prepared, trial_status)?;
                    }
                    Some(prepared)
                } else {
                    None
                };
                match evaluated {
                    Ok(HostHpoEvaluation::Complete(evidence, candidate)) => {
                        proposals.tell(trial_index, evidence.score)?;
                        candidates.push(candidate);
                        trials.push(evidence);
                    }
                    Ok(HostHpoEvaluation::Pruned(evidence)) => {
                        proposals.pruned(trial_index)?;
                        pruned_trials.push(evidence);
                    }
                    Err(error) => {
                        proposals.fail(trial_index, &error.to_string())?;
                        if first_error.is_none() {
                            first_error = Some(error);
                        }
                    }
                }
                checkpoint = prospective;
                if let (Some(saved), Some((_, progress))) = (&mut checkpoint, &mut durable) {
                    if !progress.checkpoint(saved, trial_status)?
                        && trial_status == HostHpoSearchStatus::Running
                    {
                        cancel_requested = true;
                    }
                }
            }
            if let Some(error) = first_error {
                return Err(error);
            }
            if cancel_requested {
                status = HostHpoSearchStatus::Cancelled;
            } else if exhausted {
                status = HostHpoSearchStatus::Exhausted;
            } else if next == request.trial_budget {
                status = HostHpoSearchStatus::Completed;
            }
        }
        if matches!(
            status,
            HostHpoSearchStatus::Cancelled | HostHpoSearchStatus::Exhausted
        ) {
            if let (Some(saved), Some((_, progress))) = (&checkpoint, &mut durable) {
                progress.checkpoint(saved, status)?;
            }
        }
        if candidates.is_empty() {
            return Ok(HostHpoSearchOutcome {
                result: None,
                status,
                checkpoint,
            });
        }
        let policy = SelectionPolicy {
            requested_rank: None,
            id: "select:host_hpo".into(),
            metric: SelectionMetric {
                name: request.metric.name().into(),
                objective: request.direction,
            },
            required_metric_level: None,
            require_finite: true,
            evaluation_scope: None,
            refit_slot_plan: None,
            stacking_fit_contract: None,
            reduction_id: None,
        };
        let selected = select_candidate(&policy, &candidates)?;
        let winner = trials
            .iter()
            .find(|trial| trial.variant_id.as_str() == selected.selected_candidate_id)
            .expect("selection returns an observed candidate");
        Ok(HostHpoSearchOutcome {
            result: Some(HostHpoSearchResult {
                profile: "host_optimizer_search_v1".into(),
                portable: false,
                request_fingerprint: stable_json_fingerprint(request)?,
                graph_fingerprint: plan.graph_fingerprint.clone(),
                controller_fingerprint: plan.controller_fingerprint.clone(),
                campaign_fingerprint: stable_json_fingerprint(&plan.campaign)?,
                fold_set_fingerprint: stable_json_fingerprint(folds)?,
                selected_trial_index: winner.trial_index,
                selected_params: winner.params.clone(),
                trials,
                pruned_trials,
            }),
            status,
            checkpoint,
        })
    }
}

fn host_hpo_objective_fingerprint(request: &HostHpoSearchRequest) -> Result<String> {
    let mut value = serde_json::to_value(request)?;
    let object = value.as_object_mut().expect("request is an object");
    object.remove("trial_budget");
    if let Some(serde_json::Value::Object(descriptor)) = object.get_mut("optimizer_descriptor") {
        for key in ["n_trials", "trial_budget", "resume", "storage"] {
            descriptor.remove(key);
        }
    }
    // With serde_json/preserve_order, Map::remove swaps the last entry into
    // the removed slot. Resume-only keys must not reorder the scientific
    // objective or change its identity. Preserve the canonical object order
    // of the historical BTreeMap-backed Python binding, including nested maps.
    value.sort_all_objects();
    stable_json_fingerprint(&value)
}

/// Verify a resume checkpoint against the exact plan, request and data
/// envelope before a host invokes any external data-view recheck callback.
pub fn prepare_host_hpo_checkpoint(
    plan: &ExecutionPlan,
    request: &HostHpoSearchRequest,
    options: &HostHpoResumeOptions,
) -> Result<HostHpoCheckpoint> {
    request.validate_parameter_bindings(plan)?;
    if options.data_fingerprint.trim().is_empty() {
        return Err(DagMlError::RuntimeValidation(
            "durable host HPO requires a data fingerprint".into(),
        ));
    }
    let binding = HostHpoCheckpointBinding {
        objective_fingerprint: host_hpo_objective_fingerprint(request)?,
        graph_fingerprint: plan.graph_fingerprint.clone(),
        controller_fingerprint: plan.controller_fingerprint.clone(),
        campaign_fingerprint: stable_json_fingerprint(&plan.campaign)?,
        fold_set_fingerprint: stable_json_fingerprint(&plan.fold_set)?,
        data_fingerprint: options.data_fingerprint.clone(),
        structural_catalogue_fingerprint: request
            .structural_catalogue
            .as_ref()
            .map(|catalogue| catalogue.catalogue_fingerprint.clone()),
    };
    let mut checkpoint = options.checkpoint.clone().unwrap_or(HostHpoCheckpoint {
        schema_version: 1,
        binding: binding.clone(),
        trials: Vec::new(),
        fingerprint: String::new(),
    });
    if options.checkpoint.is_none() {
        checkpoint.seal()?;
    }
    if checkpoint.schema_version != 1 || checkpoint.binding != binding {
        return Err(DagMlError::RuntimeValidation(
            "host HPO checkpoint objective/graph/controller/data/fold binding mismatch".into(),
        ));
    }
    let expected = checkpoint.fingerprint.clone();
    checkpoint.seal()?;
    if checkpoint.fingerprint != expected {
        return Err(DagMlError::RuntimeValidation(
            "host HPO checkpoint integrity fingerprint mismatch".into(),
        ));
    }
    if checkpoint.trials.len() > request.trial_budget as usize {
        return Err(DagMlError::RuntimeValidation(
            "host HPO total budget is smaller than checkpoint terminal history".into(),
        ));
    }
    for (index, trial) in checkpoint.trials.iter().enumerate() {
        if trial.trial_index() as usize != index {
            return Err(DagMlError::RuntimeValidation(
                "host HPO checkpoint trial indices must be unique and contiguous".into(),
            ));
        }
        let interrupted_without_params = matches!(trial, HostHpoTerminalTrial::Failed {
            params, error, ..
        } if params.is_empty() && error == "interrupted_before_native_evaluation");
        let (params, variant_id) = match trial {
            HostHpoTerminalTrial::Complete { evidence } => {
                host_hpo_candidate(plan, request, evidence)?;
                (&evidence.params, &evidence.variant_id)
            }
            HostHpoTerminalTrial::Pruned { evidence } => {
                let target_node = match &request.structural_catalogue {
                    Some(catalogue) => &catalogue.recipe(&evidence.params)?.target_node,
                    None => &request.target_node,
                };
                evidence.scores.validate()?;
                if evidence.scores.plan_id != plan.id
                    || evidence.intermediate_scores.is_empty()
                    || evidence.intermediate_scores.len()
                        > plan
                            .fold_set
                            .as_ref()
                            .expect("validated FoldSet")
                            .folds
                            .len()
                    || evidence
                        .intermediate_scores
                        .iter()
                        .any(|value| !value.is_finite())
                    || evidence.scores.reports.iter().any(|report| {
                        report
                            .variant_id
                            .as_ref()
                            .is_some_and(|id| id != &evidence.variant_id)
                    })
                {
                    return Err(DagMlError::RuntimeValidation(
                        "host HPO checkpoint pruned trial has invalid native intermediate evidence"
                            .into(),
                    ));
                }
                for (fold, recorded) in plan
                    .fold_set
                    .as_ref()
                    .expect("validated FoldSet")
                    .folds
                    .iter()
                    .zip(&evidence.intermediate_scores)
                {
                    let reports = evidence
                        .scores
                        .reports
                        .iter()
                        .filter(|report| {
                            report.producer_node == *target_node
                                && report_matches_statistical_policy(report, plan)
                                && report.partition == PredictionPartition::Validation
                                && report.fold_id.as_ref() == Some(&fold.fold_id)
                        })
                        .collect::<Vec<_>>();
                    let [report] = reports.as_slice() else {
                        return Err(DagMlError::RuntimeValidation(
                            "host HPO pruned checkpoint lacks one native score per observed fold"
                                .into(),
                        ));
                    };
                    if host_hpo_metric(report, request.metric)? != *recorded {
                        return Err(DagMlError::RuntimeValidation(
                            "host HPO pruned checkpoint intermediate differs from native score"
                                .into(),
                        ));
                    }
                }
                (&evidence.params, &evidence.variant_id)
            }
            HostHpoTerminalTrial::Failed {
                params,
                variant_id,
                error,
                ..
            } => {
                if error.trim().is_empty() {
                    return Err(DagMlError::RuntimeValidation(
                        "host HPO failed trial requires error evidence".into(),
                    ));
                }
                (params, variant_id)
            }
        };
        if (params.is_empty() && !interrupted_without_params)
            || params.keys().any(|key| key.trim().is_empty())
            || variant_id.as_str() != format!("host_hpo:trial:{index:010}")
        {
            return Err(DagMlError::RuntimeValidation(
                "host HPO checkpoint has invalid parameter/variant identity".into(),
            ));
        }
        if !interrupted_without_params {
            request.parameter_overrides(params)?;
        }
    }
    Ok(checkpoint)
}

pub(super) fn host_hpo_candidate(
    plan: &ExecutionPlan,
    request: &HostHpoSearchRequest,
    trial: &HostHpoTrialEvidence,
) -> Result<crate::selection::CandidateScore> {
    if trial.trial_index >= request.trial_budget
        || trial.variant_id.as_str() != format!("host_hpo:trial:{:010}", trial.trial_index)
    {
        return Err(DagMlError::RuntimeValidation(
            "host HPO trial/variant identity mismatch".into(),
        ));
    }
    trial.scores.validate()?;
    if trial.scores.plan_id != plan.id
        || trial.scores.reports.iter().any(|report| {
            report
                .variant_id
                .as_ref()
                .is_some_and(|id| id != &trial.variant_id)
        })
    {
        return Err(DagMlError::RuntimeValidation(
            "host HPO checkpoint score plan/variant mismatch".into(),
        ));
    }
    let candidate_plan = if request.structural_catalogue.is_some() {
        host_hpo_candidate_plan(plan, request, trial.trial_index, &trial.params, None)?
    } else {
        plan.clone()
    };
    if let Some(catalogue) = &request.structural_catalogue {
        let target = request.target_for_plan(&candidate_plan)?;
        let mut producers = BTreeSet::from([target.clone()]);
        if catalogue.schema_version == 2 {
            // Nested late-fusion execution retains native branch scores as
            // evidence. Admit only the selected signed graph's upstream
            // closure; host_hpo_score still requires the sink objective.
            loop {
                let before = producers.len();
                for edge in &candidate_plan.graph_plan.graph.edges {
                    if producers.contains(&edge.target.node_id)
                        && candidate_plan.node_plans.contains_key(&edge.source.node_id)
                    {
                        producers.insert(edge.source.node_id.clone());
                    }
                }
                if producers.len() == before {
                    break;
                }
            }
            producers.retain(|id| {
                candidate_plan.node_plans.get(id).is_some_and(|node| {
                    node.kind == NodeKind::Model
                        && node
                            .controller_capabilities
                            .contains(&ControllerCapability::EmitsPredictions)
                })
            });
        }
        if trial
            .scores
            .reports
            .iter()
            .any(|report| !producers.contains(&report.producer_node))
        {
            return Err(DagMlError::RuntimeValidation(
                "structural HPO score producer is outside selected recipe".into(),
            ));
        }
    }
    let (score, fold_scores, candidate) =
        host_hpo_score(&candidate_plan, request, &trial.variant_id, &trial.scores)?;
    if !trial.score.is_finite()
        || score != trial.score
        || fold_scores != trial.objective_fold_scores
    {
        return Err(DagMlError::RuntimeValidation(
            "host HPO checkpoint scalar/fold scores differ from native reports".into(),
        ));
    }
    Ok(candidate)
}

fn host_hpo_score(
    plan: &ExecutionPlan,
    request: &HostHpoSearchRequest,
    variant: &VariantId,
    scores: &ScoreSet,
) -> Result<(f64, BTreeMap<String, f64>, crate::selection::CandidateScore)> {
    let target_node = request.target_for_plan(plan)?;
    let folds = plan.fold_set.as_ref().expect("validated host HPO FoldSet");
    let reports = scores
        .reports
        .iter()
        .filter(|report| {
            report.producer_node == *target_node
                && report_matches_statistical_policy(report, plan)
                && report.partition == PredictionPartition::Validation
                && report.fold_id.as_ref().is_some_and(|fold| {
                    if request.fold_score_reduction.is_some() {
                        folds.folds.iter().any(|item| &item.fold_id == fold)
                    } else {
                        fold.as_str() == "avg"
                            || (folds.folds.len() == 1 && fold == &folds.folds[0].fold_id)
                    }
                })
        })
        .collect::<Vec<_>>();
    let mut fold_scores = BTreeMap::new();
    if let Some(reduction) = request.fold_score_reduction {
        for report in &reports {
            let fold = report.fold_id.as_ref().expect("filtered fold");
            if fold_scores
                .insert(
                    fold.as_str().to_owned(),
                    host_hpo_metric(report, request.metric)?,
                )
                .is_some()
            {
                return Err(DagMlError::RuntimeValidation(
                    "host HPO has ambiguous fold score producers".into(),
                ));
            }
        }
        if fold_scores.len() != folds.folds.len() {
            return Err(DagMlError::RuntimeValidation(
                "host HPO requires every declared fold's native score".into(),
            ));
        }
        let score = reduce_host_hpo_fold_scores(&fold_scores, reduction, request.direction)?;
        let candidate = crate::selection::CandidateScore {
            candidate_id: variant.as_str().to_owned(),
            metrics: BTreeMap::from([(request.metric.name().to_owned(), score)]),
            metadata: BTreeMap::from([
                (
                    "host_hpo_fold_score_reduction".into(),
                    serde_json::to_value(reduction)?,
                ),
                (
                    "objective_fold_scores".into(),
                    serde_json::to_value(&fold_scores)?,
                ),
            ]),
        };
        Ok((score, fold_scores, candidate))
    } else {
        let [report] = reports.as_slice() else {
            return Err(DagMlError::RuntimeValidation(
                "host HPO requires exactly one native target OOF report".into(),
            ));
        };
        Ok((
            host_hpo_metric(report, request.metric)?,
            fold_scores,
            (*report).clone().into_candidate_score(variant.as_str())?,
        ))
    }
}

fn host_hpo_metric(
    report: &crate::metrics::RegressionMetricReport,
    metric: RegressionMetricKind,
) -> Result<f64> {
    report
        .metrics
        .get(metric.name())
        .copied()
        .filter(|score| score.is_finite())
        .ok_or_else(|| {
            DagMlError::RuntimeValidation("host HPO has no finite requested metric".into())
        })
}

fn reduce_host_hpo_fold_scores(
    scores: &BTreeMap<String, f64>,
    reduction: HostHpoFoldReduction,
    direction: crate::selection::MetricObjective,
) -> Result<f64> {
    if scores.is_empty() || scores.values().any(|score| !score.is_finite()) {
        return Err(DagMlError::RuntimeValidation(
            "host HPO fold reduction requires finite observed scores".into(),
        ));
    }
    let values = scores.values().copied();
    let score = match reduction {
        HostHpoFoldReduction::Mean => values.map(|value| value / scores.len() as f64).sum(),
        HostHpoFoldReduction::Best | HostHpoFoldReduction::RobustBest => match direction {
            crate::selection::MetricObjective::Minimize => values.fold(f64::INFINITY, f64::min),
            crate::selection::MetricObjective::Maximize => values.fold(f64::NEG_INFINITY, f64::max),
        },
    };
    if !score.is_finite() {
        return Err(DagMlError::RuntimeValidation(
            "host HPO fold reduction overflowed".into(),
        ));
    }
    Ok(score)
}

fn report_matches_statistical_policy(
    report: &crate::metrics::RegressionMetricReport,
    plan: &ExecutionPlan,
) -> bool {
    let policy = &plan.campaign.aggregation_policy;
    policy.grouping_key.is_none()
        || (report.level == policy.selection_metric_level
            && report.grouping_key == policy.grouping_key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checkpoint_json_object_order_preserves_legacy_seal_and_rejects_content_tamper() {
        let mut checkpoint: HostHpoCheckpoint = serde_json::from_str(
            r#"{"schema_version":1,"binding":{"objective_fingerprint":"objective",
            "graph_fingerprint":"graph","controller_fingerprint":"controllers",
            "campaign_fingerprint":"campaign","fold_set_fingerprint":"folds",
            "data_fingerprint":"data"},"trials":[{"state":"failed","trial_index":0,
            "params":{"model":{"z":2,"a":1}},"variant_id":"trial:0","error":"fit failed",
            "generated_view_manifest":{"views":[{"sample_ids":["s2","s1"],
            "content":{"z":"sha-z","a":"sha-a"}}],"schema_version":1}}],"fingerprint":""}"#,
        )
        .unwrap();
        checkpoint.seal().unwrap();
        assert_eq!(
            checkpoint.fingerprint,
            "c012ba760617bcc51bb630baa6341292eab941691f2ab3b0dadb6657e1e3485f"
        );
        // Legacy typed struct field order; only JSON object keys are sorted.
        let legacy: HostHpoCheckpoint = serde_json::from_str(
            r#"{"schema_version":1,"binding":{"objective_fingerprint":"objective",
            "graph_fingerprint":"graph","controller_fingerprint":"controllers",
            "campaign_fingerprint":"campaign","fold_set_fingerprint":"folds",
            "data_fingerprint":"data"},"trials":[{"state":"failed","trial_index":0,
            "params":{"model":{"a":1,"z":2}},"variant_id":"trial:0","error":"fit failed",
            "generated_view_manifest":{"schema_version":1,"views":[{"content":{"a":"sha-a","z":"sha-z"},
            "sample_ids":["s2","s1"]}]}}],"fingerprint":""}"#,
        ).unwrap();
        assert_eq!(
            checkpoint.fingerprint,
            stable_json_fingerprint(&(legacy.schema_version, &legacy.binding, &legacy.trials,))
                .unwrap()
        );
        let mut sorted_wire = serde_json::to_value(&checkpoint).unwrap();
        sorted_wire.sort_all_objects(); // SDK checkpoint json.dump(sort_keys=True).
        let restored: HostHpoCheckpoint = serde_json::from_value(sorted_wire.clone()).unwrap();
        restored.verify_seal().unwrap();
        assert_eq!(restored.fingerprint, checkpoint.fingerprint);
        let mut changed = sorted_wire.clone();
        changed["trials"][0]["generated_view_manifest"]["views"][0]["content"]["a"] =
            serde_json::json!("foreign-content");
        assert!(serde_json::from_value::<HostHpoCheckpoint>(changed)
            .unwrap()
            .verify_seal()
            .is_err());
        let mut changed = sorted_wire;
        changed["trials"][0]["generated_view_manifest"]["views"][0]["sample_ids"] =
            serde_json::json!(["s1", "s2"]);
        assert!(serde_json::from_value::<HostHpoCheckpoint>(changed)
            .unwrap()
            .verify_seal()
            .is_err());

        // Recovery must compare canonical prospective prefixes too, without
        // changing the original checkpoint or accepting a tampered prefix.
        let mut prepared = checkpoint.clone();
        prepared.trials.push(HostHpoTerminalTrial::Failed {
            trial_index: 1,
            params: BTreeMap::new(),
            variant_id: VariantId::new("trial:1").unwrap(),
            error: "fit failed".into(),
            generated_view_manifest: None,
        });
        prepared.seal().unwrap();
        assert_eq!(
            restored
                .clone()
                .recover_interrupted_trials(Some(prepared), Vec::new())
                .unwrap()
                .trials
                .len(),
            2
        );
        let mut malformed = restored.clone();
        if let HostHpoTerminalTrial::Failed { params, .. } = &mut malformed.trials[0] {
            params.insert("extra".into(), serde_json::json!(1));
        }
        assert!(malformed
            .recover_interrupted_trials(None, Vec::new())
            .is_err());
    }

    #[test]
    fn objective_identity_ignores_resume_controls_and_json_object_order() {
        let original: HostHpoSearchRequest = serde_json::from_str(
            r#"{"target_node":"model:base","trial_budget":2,"metric":"rmse","direction":"minimize",
            "optimizer_descriptor":{"sampler":"random","n_trials":2,"seed":7,"storage":"first",
            "model_params":{"n_components":[1,2],"alpha":[0,1]}}}"#,
        )
        .unwrap();
        let resumed: HostHpoSearchRequest = serde_json::from_str(
            r#"{"target_node":"model:base","trial_budget":3,"metric":"rmse","direction":"minimize",
            "optimizer_descriptor":{"resume":true,"storage":"second","n_trials":3,"seed":7,
            "model_params":{"alpha":[0,1],"n_components":[1,2]},"sampler":"random"}}"#,
        )
        .unwrap();
        let expected = host_hpo_objective_fingerprint(&original).unwrap();
        // SHA-256 of the legacy recursively key-sorted JSON objective; this
        // remains the same with and without serde_json's preserve_order feature.
        assert_eq!(
            expected,
            "db558102f5eb6cebc7047a8447d430e35573df3124d2009d63e4df9e958fb37c"
        );
        assert_eq!(expected, host_hpo_objective_fingerprint(&resumed).unwrap());
        let mut changed = resumed;
        changed
            .optimizer_descriptor
            .get_mut("model_params")
            .unwrap()["n_components"] = serde_json::json!([1, 3]);
        assert_ne!(expected, host_hpo_objective_fingerprint(&changed).unwrap());
    }

    #[cfg(dag_ml_workspace_contract_fixtures)]
    #[test]
    fn torch_effective_plan_cannot_bypass_serial_admission_with_a_regression_metric() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../examples/fixtures/training/python_training_smoke.v1.json"
        ))
        .unwrap();
        let training: crate::TrainingRequest =
            serde_json::from_value(fixture["request"].clone()).unwrap();
        let mut manifests = crate::ControllerRegistry::new();
        for manifest in training.controller_manifests {
            manifests.register(manifest).unwrap();
        }
        let mut plan = crate::build_execution_plan(
            "plan:torch.refusal",
            training.graph,
            training.campaign,
            &manifests,
        )
        .unwrap();
        let request: HostHpoSearchRequest = serde_json::from_value(serde_json::json!({
            "target_node":"model:base","trial_budget":2,"metric":"rmse","direction":"minimize",
            "optimizer_descriptor":{"sampler":"random","n_jobs":2}}))
        .unwrap();
        assert!(
            request
                .validate_parallel_execution_for_plan(2, &plan)
                .is_ok(),
            "historical generic parallel route unchanged"
        );
        plan.node_plans
            .values_mut()
            .find(|node| node.kind == crate::NodeKind::Model)
            .unwrap()
            .params
            .insert(
                "factory_path".into(),
                serde_json::json!(crate::python_torch_profile::TORCH_FACTORY),
            );
        assert!(request
            .validate_parallel_execution_for_plan(2, &plan)
            .unwrap_err()
            .to_string()
            .contains("serial"));
        assert!(
            crate::python_torch_profile::validate_torch_plan(&plan).is_err(),
            "known factory without signed metadata must refuse"
        );
    }

    #[test]
    fn fold_reduction_is_not_global_oof_and_honors_metric_direction() {
        use crate::selection::MetricObjective::{Maximize, Minimize};
        let scores = BTreeMap::from([("fold0".into(), 1.0), ("fold1".into(), 3.0)]);
        assert_eq!(
            reduce_host_hpo_fold_scores(&scores, HostHpoFoldReduction::Mean, Minimize).unwrap(),
            2.0
        );
        assert_ne!(
            2.0,
            5_f64.sqrt(),
            "mean per-fold RMSE must not become pooled OOF RMSE"
        );
        for reduction in [HostHpoFoldReduction::Best, HostHpoFoldReduction::RobustBest] {
            assert_eq!(
                reduce_host_hpo_fold_scores(&scores, reduction, Minimize).unwrap(),
                1.0
            );
            assert_eq!(
                reduce_host_hpo_fold_scores(&scores, reduction, Maximize).unwrap(),
                3.0
            );
        }
        assert!(reduce_host_hpo_fold_scores(
            &BTreeMap::new(),
            HostHpoFoldReduction::Mean,
            Minimize
        )
        .is_err());
        let invalid = BTreeMap::from([("fold0".into(), f64::INFINITY)]);
        assert!(
            reduce_host_hpo_fold_scores(&invalid, HostHpoFoldReduction::RobustBest, Minimize)
                .is_err(),
            "failed trials cannot become synthetic penalties or disappear from a fold reduction"
        );
    }
}
