//! Nested grouped selection over a finite, declared candidate list.
//!
//! The coordinator owns every loop: the outer grouped fold plan, one inner
//! grouped fold set built from each outer training pool, the FIT_CV of every
//! candidate on those inner folds, the selection from inner OOF only, the
//! FIT_CV of the selected candidate on the outer training pool and the
//! assembly of one outer OOF prediction per sample. Fitting and prediction
//! stay with the registered runtime controllers and the host data provider;
//! the core only sees sample identities, groups, predictions and targets.
//!
//! Outer validation targets never reach the inner selection. Version 1
//! refuses masked (unobserved) references: every scored target is complete.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::aggregation::PredictionUnitId;
use crate::controller::ControllerRegistry;
use crate::error::{DagMlError, Result};
use crate::fold::{
    FoldAssignment, FoldPartitionMode, FoldSet, GroupKFoldSpec, NestedCvSpec, NestedFoldSet,
};
use crate::graph::GraphSpec;
use crate::ids::{FoldId, GroupId, NodeId, RunId, SampleId};
use crate::metrics::{
    score_regression_prediction_block, RegressionMetricKind, RegressionTargetBlock,
};
use crate::oof::{PredictionBlock, PredictionPartition};
use crate::phase::Phase;
use crate::plan::{build_execution_plan, CampaignSpec, SplitInvocation};
use crate::policy::PredictionLevel;
use crate::runtime::{
    RunContext, RuntimeControllerRegistry, RuntimeDataProvider, SequentialScheduler,
};
use crate::selection::{
    select_candidate, CandidateScore, SelectionDecision, SelectionMetric, SelectionPolicy,
};

pub const NESTED_SELECTION_SCHEMA_VERSION: u32 = 1;

fn invalid(message: impl Into<String>) -> DagMlError {
    DagMlError::RuntimeValidation(format!("nested selection: {}", message.into()))
}

/// One declared candidate: parameters patched onto the target node.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NestedSelectionCandidate {
    /// Selection ties resolve to the smallest candidate id.
    pub candidate_id: String,
    pub params: BTreeMap<String, Value>,
}

/// A complete nested grouped selection over one single-target regression node.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NestedSelectionRequest {
    pub id: String,
    /// Graph template; `target_node` receives each candidate's parameters.
    pub graph: GraphSpec,
    /// Campaign template with data bindings; its split invocation is owned
    /// by this runtime and must be absent.
    pub campaign: CampaignSpec,
    pub target_node: NodeId,
    pub candidates: Vec<NestedSelectionCandidate>,
    /// Indivisible identity component of every sample.
    pub sample_groups: BTreeMap<SampleId, GroupId>,
    /// Samples (keys of `sample_groups`) whose selected target is missing. They are kept outside
    /// every outer and inner fold (see `FoldSet::target_missing_sample_ids`), so they are never
    /// fitted, validated or scored.
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub target_missing_sample_ids: BTreeSet<SampleId>,
    pub outer: GroupKFoldSpec,
    pub inner: GroupKFoldSpec,
    pub selection_metric: RegressionMetricKind,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NestedCandidateEvaluation {
    pub candidate_id: String,
    /// Selection metric on the pooled inner OOF of the outer training pool.
    pub score: f64,
    pub n_samples: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NestedSelectionScope {
    pub outer_fold_id: FoldId,
    pub inner_fold_set: NestedFoldSet,
    pub candidates: Vec<NestedCandidateEvaluation>,
    pub decision: SelectionDecision,
}

/// One outer OOF row: every sample is validated exactly once.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NestedOofRow {
    pub sample_id: SampleId,
    pub outer_fold_id: FoldId,
    pub selected_candidate_id: String,
    pub y_true: f64,
    pub prediction: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NestedSelectionOutcome {
    pub schema_version: u32,
    pub outer_fold_set: FoldSet,
    pub scopes: Vec<NestedSelectionScope>,
    /// Sorted by sample id.
    pub oof: Vec<NestedOofRow>,
    /// Pooled outer OOF metrics (`mse`, `rmse`, `mae`) of the selected
    /// models, computed by the metrics provider.
    pub model_metrics: BTreeMap<String, f64>,
    /// Controller FIT_CV invocations of the target node.
    pub n_fits: usize,
}

impl NestedSelectionRequest {
    pub fn validate(&self) -> Result<()> {
        RunId::new(format!("run:{}", self.id))?;
        if self.campaign.split_invocation.is_some() {
            return Err(invalid(
                "the campaign template must not declare its own split",
            ));
        }
        if self.candidates.is_empty() {
            return Err(invalid("at least one candidate is required"));
        }
        let mut ids = BTreeSet::new();
        for candidate in &self.candidates {
            if candidate.candidate_id.trim().is_empty() || !ids.insert(&candidate.candidate_id) {
                return Err(invalid("candidate ids must be nonempty and unique"));
            }
        }
        if !self
            .graph
            .nodes
            .iter()
            .any(|node| node.id == self.target_node)
        {
            return Err(invalid(format!(
                "unknown target node `{}`",
                self.target_node
            )));
        }
        if !matches!(
            self.selection_metric,
            RegressionMetricKind::Mse | RegressionMetricKind::Rmse | RegressionMetricKind::Mae
        ) {
            return Err(invalid("selection metric must be mse, rmse or mae"));
        }
        NestedCvSpec::GroupKFold(self.inner.clone()).validate()
    }

    fn plan(
        &self,
        candidate: &NestedSelectionCandidate,
        fold_set: FoldSet,
        registry: &ControllerRegistry,
    ) -> Result<crate::plan::ExecutionPlan> {
        let mut graph = self.graph.clone();
        let node = graph
            .nodes
            .iter_mut()
            .find(|node| node.id == self.target_node)
            .expect("validated target node");
        node.params.extend(candidate.params.clone());
        let mut campaign = self.campaign.clone();
        campaign.split_invocation = Some(SplitInvocation {
            id: format!("split:{}", fold_set.id),
            controller_id: None,
            leakage_policy: Default::default(),
            params: BTreeMap::new(),
            fold_set: Some(fold_set),
        });
        build_execution_plan(
            format!("plan:{}:{}", self.id, candidate.candidate_id),
            graph,
            campaign,
            registry,
        )
    }
}

/// Prefix an error with the outer fold and candidate it occurred in, keeping
/// its taxonomy variant.
fn in_scope(error: DagMlError, scope: &str) -> DagMlError {
    match error {
        DagMlError::GraphValidation(m) => DagMlError::GraphValidation(format!("{scope}: {m}")),
        DagMlError::ControllerValidation(m) => {
            DagMlError::ControllerValidation(format!("{scope}: {m}"))
        }
        DagMlError::CampaignValidation(m) => {
            DagMlError::CampaignValidation(format!("{scope}: {m}"))
        }
        DagMlError::Planning(m) => DagMlError::Planning(format!("{scope}: {m}")),
        DagMlError::RuntimeValidation(m) => DagMlError::RuntimeValidation(format!("{scope}: {m}")),
        DagMlError::OofValidation(m) => DagMlError::OofValidation(format!("{scope}: {m}")),
        other => other,
    }
}

/// Validation predictions and targets of the target node after one FIT_CV.
struct FitCvRows {
    predictions: BTreeMap<SampleId, (FoldId, f64)>,
    targets: BTreeMap<SampleId, f64>,
    n_fits: usize,
}

fn fit_cv(
    request: &NestedSelectionRequest,
    plan: &crate::plan::ExecutionPlan,
    controllers: &RuntimeControllerRegistry,
    provider: &dyn RuntimeDataProvider,
    run: &str,
) -> Result<FitCvRows> {
    let mut ctx = RunContext::new(RunId::new(run)?, request.campaign.root_seed);
    ctx.variant_id = Some(plan.variants[0].variant_id.clone());
    let results = SequentialScheduler.execute_campaign_phase_with_data_provider(
        plan,
        controllers,
        provider,
        &mut ctx,
        Phase::FitCv,
    )?;
    let mut rows = FitCvRows {
        predictions: BTreeMap::new(),
        targets: BTreeMap::new(),
        n_fits: 0,
    };
    for result in results.iter().filter(|r| r.node_id == request.target_node) {
        rows.n_fits += 1;
        for block in &result.regression_targets {
            block.require_complete_targets("nested selection")?;
            for (unit, values) in block.unit_ids.iter().zip(&block.values) {
                let (PredictionUnitId::Sample(id), [value]) = (unit, values.as_slice()) else {
                    return Err(invalid("targets must be one sample-level column"));
                };
                if rows
                    .targets
                    .insert(id.clone(), *value)
                    .is_some_and(|v| v != *value)
                {
                    return Err(invalid(format!("sample `{id}` has contradictory targets")));
                }
            }
        }
        for block in result
            .predictions
            .iter()
            .filter(|b| b.partition == PredictionPartition::Validation)
        {
            let fold = block
                .fold_id
                .clone()
                .ok_or_else(|| invalid("validation predictions lack their fold"))?;
            for (id, values) in block.sample_ids.iter().zip(&block.values) {
                let [value] = values.as_slice() else {
                    return Err(invalid("predictions must be one column"));
                };
                if rows
                    .predictions
                    .insert(id.clone(), (fold.clone(), *value))
                    .is_some()
                {
                    return Err(invalid(format!("sample `{id}` was validated twice")));
                }
            }
        }
    }
    Ok(rows)
}

/// Host computation of the regression metrics that decide the selection and
/// summarize the outer OOF. DAG-ML keeps the plans, the comparison of the
/// candidates and the tie rule; a host may route the arithmetic to its own
/// numerical library (for example Methods on CPU or a WASM callback).
pub trait NestedSelectionMetrics {
    /// `metric` is `mse`, `rmse` or `mae` of rows aligned by position; the
    /// value must be finite and nonnegative.
    fn regression_metric(
        &self,
        metric: RegressionMetricKind,
        y_true: &[f64],
        y_pred: &[f64],
    ) -> Result<f64>;
}

/// The DAG-ML metric registry, used when no host metrics are supplied.
pub struct BuiltinNestedSelectionMetrics;

impl NestedSelectionMetrics for BuiltinNestedSelectionMetrics {
    fn regression_metric(
        &self,
        metric: RegressionMetricKind,
        y_true: &[f64],
        y_pred: &[f64],
    ) -> Result<f64> {
        let ids = (0..y_true.len())
            .map(|i| SampleId::new(format!("row:{i:09}")))
            .collect::<Result<Vec<_>>>()?;
        let node = NodeId::new("model:nested_selection")?;
        let block = PredictionBlock {
            prediction_id: None,
            producer_node: node,
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: None,
            sample_ids: ids.clone(),
            values: y_pred.iter().map(|v| vec![*v]).collect(),
            target_names: vec!["y".into()],
        };
        let target_block = RegressionTargetBlock {
            level: PredictionLevel::Sample,
            unit_ids: ids.into_iter().map(PredictionUnitId::Sample).collect(),
            values: y_true.iter().map(|v| vec![*v]).collect(),
            validity_masks: None,
            target_names: vec!["y".into()],
        };
        let report = score_regression_prediction_block(&block, &target_block, &[metric])?;
        report
            .metrics
            .get(metric.name())
            .copied()
            .ok_or_else(|| invalid(format!("metric `{}` was not reported", metric.name())))
    }
}

/// Score rows keyed by sample through the metrics provider.
fn score(
    metrics: &dyn NestedSelectionMetrics,
    kind: RegressionMetricKind,
    rows: impl Iterator<Item = (f64, f64)>,
) -> Result<f64> {
    let (y_true, y_pred): (Vec<f64>, Vec<f64>) = rows.unzip();
    let value = metrics.regression_metric(kind, &y_true, &y_pred)?;
    if !(value.is_finite() && value >= 0.0) {
        return Err(invalid(format!(
            "metric `{}` must be finite and nonnegative, got {value}",
            kind.name()
        )));
    }
    Ok(value)
}

/// Execute a nested grouped selection with the DAG-ML metric registry.
pub fn execute_nested_selection(
    request: &NestedSelectionRequest,
    registry: &ControllerRegistry,
    controllers: &RuntimeControllerRegistry,
    provider: &dyn RuntimeDataProvider,
) -> Result<NestedSelectionOutcome> {
    execute_nested_selection_with_metrics(
        request,
        registry,
        controllers,
        provider,
        &BuiltinNestedSelectionMetrics,
    )
}

/// Execute a nested grouped selection; see the module documentation. The
/// host `metrics` computes every selection and pooled metric.
pub fn execute_nested_selection_with_metrics(
    request: &NestedSelectionRequest,
    registry: &ControllerRegistry,
    controllers: &RuntimeControllerRegistry,
    provider: &dyn RuntimeDataProvider,
    metrics: &dyn NestedSelectionMetrics,
) -> Result<NestedSelectionOutcome> {
    request.validate()?;
    let outer = request.outer.split_with_target_missing(
        format!("{}.outer", request.id),
        &request.sample_groups,
        &request.target_missing_sample_ids,
    )?;
    let inner_spec = NestedCvSpec::GroupKFold(request.inner.clone());
    let metric_name = request.selection_metric.name().to_string();
    let policy = SelectionPolicy {
        id: format!("selection:{}", request.id),
        metric: SelectionMetric {
            name: metric_name.clone(),
            objective: request.selection_metric.objective(),
        },
        required_metric_level: None,
        require_finite: true,
        evaluation_scope: None,
        refit_slot_plan: None,
        requested_rank: None,
        stacking_fit_contract: None,
        reduction_id: None,
    };
    // Every inner fold set is built and validated before any controller call.
    let nested = outer
        .folds
        .iter()
        .map(|fold| outer.nested_fold_set(&inner_spec, fold))
        .collect::<Result<Vec<_>>>()?;
    let mut scopes = Vec::new();
    let mut oof = Vec::new();
    let mut n_fits = 0;
    for (fold, nested) in outer.folds.iter().zip(nested) {
        nested.validate_for_outer(fold)?;
        let mut candidates = Vec::new();
        let mut scores = Vec::new();
        for candidate in &request.candidates {
            let scope = format!(
                "outer fold `{}` candidate `{}`",
                fold.fold_id, candidate.candidate_id
            );
            let rows = request
                .plan(candidate, nested.inner_fold_set.clone(), registry)
                .and_then(|plan| {
                    fit_cv(
                        request,
                        &plan,
                        controllers,
                        provider,
                        &format!(
                            "run:{}:{}:{}",
                            request.id, fold.fold_id, candidate.candidate_id
                        ),
                    )
                })
                .map_err(|e| in_scope(e, &scope))?;
            n_fits += rows.n_fits;
            let train = fold.train_sample_ids.iter().collect::<BTreeSet<_>>();
            if rows.predictions.keys().collect::<BTreeSet<_>>() != train
                || rows.targets.keys().collect::<BTreeSet<_>>() != train
            {
                return Err(invalid(format!(
                    "inner OOF of `{}` must cover exactly the outer training pool",
                    fold.fold_id
                )));
            }
            let value = score(
                metrics,
                request.selection_metric,
                rows.predictions
                    .iter()
                    .map(|(id, (_, prediction))| (rows.targets[id], *prediction)),
            )
            .map_err(|e| in_scope(e, &scope))?;
            candidates.push(NestedCandidateEvaluation {
                candidate_id: candidate.candidate_id.clone(),
                score: value,
                n_samples: rows.predictions.len(),
            });
            scores.push(CandidateScore {
                candidate_id: candidate.candidate_id.clone(),
                metrics: BTreeMap::from([(metric_name.clone(), value)]),
                metadata: BTreeMap::new(),
            });
        }
        let decision = select_candidate(&policy, &scores)?;
        let winner = request
            .candidates
            .iter()
            .find(|c| c.candidate_id == decision.selected_candidate_id)
            .expect("selected candidate is declared");
        // The selected candidate is fitted once on the outer training pool and
        // predicts only that fold's validation rows.
        let evaluation = FoldSet {
            id: format!("{}.{}.evaluation", outer.id, fold.fold_id),
            sample_ids: outer.sample_ids.clone(),
            folds: vec![FoldAssignment {
                fold_id: fold.fold_id.clone(),
                train_sample_ids: fold.train_sample_ids.clone(),
                validation_sample_ids: fold.validation_sample_ids.clone(),
                metadata: BTreeMap::new(),
            }],
            sample_groups: outer.sample_groups.clone(),
            partition_mode: FoldPartitionMode::Resampled,
            train_exclusion: outer.train_exclusion,
            target_missing_sample_ids: outer.target_missing_sample_ids.clone(),
        };
        let scope = format!(
            "outer fold `{}` selected candidate `{}`",
            fold.fold_id, winner.candidate_id
        );
        let rows = request
            .plan(winner, evaluation, registry)
            .and_then(|plan| {
                fit_cv(
                    request,
                    &plan,
                    controllers,
                    provider,
                    &format!("run:{}:{}:selected", request.id, fold.fold_id),
                )
            })
            .map_err(|e| in_scope(e, &scope))?;
        n_fits += rows.n_fits;
        let validation = fold.validation_sample_ids.iter().collect::<BTreeSet<_>>();
        if rows.predictions.keys().collect::<BTreeSet<_>>() != validation
            || rows.predictions.values().any(|(id, _)| id != &fold.fold_id)
        {
            return Err(invalid(format!(
                "outer predictions of `{}` must cover exactly its validation rows",
                fold.fold_id
            )));
        }
        for (id, (_, prediction)) in rows.predictions {
            let y_true = *rows
                .targets
                .get(&id)
                .ok_or_else(|| invalid(format!("validation sample `{id}` has no target")))?;
            oof.push(NestedOofRow {
                sample_id: id,
                outer_fold_id: fold.fold_id.clone(),
                selected_candidate_id: winner.candidate_id.clone(),
                y_true,
                prediction,
            });
        }
        scopes.push(NestedSelectionScope {
            outer_fold_id: fold.fold_id.clone(),
            inner_fold_set: nested,
            candidates,
            decision,
        });
    }
    oof.sort_by(|a, b| a.sample_id.cmp(&b.sample_id));
    if oof.iter().map(|r| &r.sample_id).collect::<Vec<_>>()
        != outer.sample_ids.iter().collect::<Vec<_>>()
    {
        return Err(invalid("outer OOF must validate every sample exactly once"));
    }
    let model_metrics = [
        RegressionMetricKind::Mse,
        RegressionMetricKind::Rmse,
        RegressionMetricKind::Mae,
    ]
    .into_iter()
    .map(|kind| {
        Ok((
            kind.name().to_string(),
            score(metrics, kind, oof.iter().map(|r| (r.y_true, r.prediction)))?,
        ))
    })
    .collect::<Result<BTreeMap<_, _>>>()?;
    Ok(NestedSelectionOutcome {
        schema_version: NESTED_SELECTION_SCHEMA_VERSION,
        outer_fold_set: outer,
        scopes,
        oof,
        model_metrics,
        n_fits,
    })
}

#[cfg(all(test, feature = "methods-optimizer-local"))]
mod tests {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Mutex;

    use serde_json::json;

    use super::*;
    use crate::controller_adapter::derive_host_controller_registry;
    use crate::data::{DataBinding, ExternalDataPlanEnvelope};
    use crate::hpo::MethodsRuntime;
    use crate::methods_estimator::{
        methods_estimator_host_controller_specs, register_methods_estimator_controllers,
    };
    use crate::runtime::{
        DataMaterializationRequest, DataViewRequest, HandleKind, HandleRef, MethodsPlsData,
        MethodsPlsDataRequest, MethodsPlsDataset, MethodsPlsMatrix,
    };
    use crate::training::TrainingDataIdentity;
    use crate::ControllerId;

    const ENVELOPE: &str =
        include_str!("../tests/fixtures/package/data/coordinator_data_plan_envelope_sample12.json");

    fn runtime() -> MethodsRuntime {
        let library = std::env::var_os("N4M_LIBRARY_PATH")
            .expect("native Methods tests require N4M_LIBRARY_PATH");
        MethodsRuntime::configure(library).unwrap()
    }

    fn sample(index: usize) -> SampleId {
        SampleId::new(format!("sample:{index:02}")).unwrap()
    }

    /// Fold, fit sample IDs and prediction sample IDs of one requested view.
    type View = (Option<FoldId>, Vec<SampleId>, Vec<SampleId>);

    /// Provider-owned rows; every requested view is recorded.
    struct Provider {
        rows: BTreeMap<SampleId, (Vec<f64>, f64)>,
        /// A sample whose reference is transported as 0 with a false mask.
        masked: Option<SampleId>,
        views: Mutex<Vec<View>>,
        next: AtomicU64,
    }

    impl Provider {
        fn dataset(&self, ids: &[SampleId]) -> MethodsPlsDataset {
            let rows = ids.iter().map(|id| &self.rows[id]).collect::<Vec<_>>();
            let masks = self
                .masked
                .as_ref()
                .map(|masked| ids.iter().map(|id| vec![id != masked]).collect::<Vec<_>>());
            MethodsPlsDataset {
                y_validity_masks: masks,
                sample_ids: ids.to_vec(),
                x: MethodsPlsMatrix {
                    values: rows.iter().flat_map(|(x, _)| x.clone()).collect(),
                    rows: rows.len(),
                    cols: rows[0].0.len(),
                },
                y: Some(MethodsPlsMatrix {
                    values: ids
                        .iter()
                        .zip(&rows)
                        .map(|(id, (_, y))| {
                            if Some(id) == self.masked.as_ref() {
                                0.0
                            } else {
                                *y
                            }
                        })
                        .collect(),
                    rows: rows.len(),
                    cols: 1,
                }),
                target_names: vec!["y".into()],
            }
        }
    }

    impl RuntimeDataProvider for Provider {
        fn materialize(&self, _: &DataMaterializationRequest) -> Result<HandleRef> {
            Ok(HandleRef {
                handle: self.next.fetch_add(1, Ordering::SeqCst) + 1,
                kind: HandleKind::Data,
                owner_controller: ControllerId::new("controller:data.provider")?,
            })
        }

        fn make_view(&self, _: &DataViewRequest) -> Result<HandleRef> {
            Ok(HandleRef {
                handle: self.next.fetch_add(1, Ordering::SeqCst) + 1,
                kind: HandleKind::DataView,
                owner_controller: ControllerId::new("controller:data.provider")?,
            })
        }

        fn training_data_identity(
            &self,
            binding: &DataBinding,
        ) -> Result<Option<TrainingDataIdentity>> {
            let mut identity = TrainingDataIdentity {
                requirement_key: crate::data::data_binding_requirement_key(
                    &binding.node_id,
                    &binding.input_name,
                ),
                schema_fingerprint: "a".repeat(64),
                plan_fingerprint: "b".repeat(64),
                relation_fingerprint: "c".repeat(64),
                data_content_fingerprint: "d".repeat(64),
                target_content_fingerprint: "e".repeat(64),
                identity_fingerprint: String::new(),
            };
            identity.identity_fingerprint = identity.compute_fingerprint()?;
            Ok(Some(identity))
        }

        fn methods_pls_capability(&self) -> Result<()> {
            Ok(())
        }

        fn methods_pls_data(&self, request: &MethodsPlsDataRequest) -> Result<MethodsPlsData> {
            let fit = request.fit_view.sample_ids.clone().unwrap();
            let predict = request
                .prediction_view
                .as_ref()
                .and_then(|v| v.sample_ids.clone())
                .unwrap_or_default();
            self.views.lock().unwrap().push((
                request.fold_id.clone(),
                fit.clone(),
                predict.clone(),
            ));
            Ok(MethodsPlsData {
                fit: self.dataset(&fit),
                prediction: (!predict.is_empty()).then(|| self.dataset(&predict)),
            })
        }
    }

    /// 30 samples in 10 groups of 3, two latent directions plus small noise.
    fn provider(shift_samples: &[usize]) -> Provider {
        let mut state = 0x2545_f491_4f6c_dd1du64;
        let mut next = move || {
            state = state
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            ((state >> 11) as f64 / (1u64 << 53) as f64) - 0.5
        };
        let rows = (0..30)
            .map(|i| {
                let (a, b) = (next(), next());
                let x = (0..6)
                    .map(|j| a * (j as f64 + 1.0) + b * (6.0 - j as f64) + 0.01 * next())
                    .collect::<Vec<_>>();
                let mut y = 2.0 * a - b + 0.01 * next();
                if shift_samples.contains(&i) {
                    y += 100.0;
                }
                (sample(i), (x, y))
            })
            .collect();
        Provider {
            rows,
            masked: None,
            views: Mutex::default(),
            next: AtomicU64::new(0),
        }
    }

    fn request() -> NestedSelectionRequest {
        let envelope: ExternalDataPlanEnvelope = serde_json::from_str(ENVELOPE).unwrap();
        let graph: GraphSpec = serde_json::from_value(json!({
            "id": "graph:probe", "interface": {"inputs": [], "outputs": []},
            "nodes": [{
                "id": "model:probe", "kind": "model",
                "operator": "n4m:models.pls.pls_regression",
                "params": {"method_id": "models.pls.pls_regression", "center_x": true,
                           "scale_x": false, "center_y": true, "scale_y": false},
                "ports": {
                    "inputs": [{"name": "x", "kind": "data", "representation": "tabular_numeric", "cardinality": "one", "description": ""}],
                    "outputs": [{"name": "y_hat", "kind": "prediction", "representation": null, "cardinality": "one", "description": ""}]
                },
                "metadata": {}, "seed_label": null
            }],
            "edges": [], "search_space_fingerprint": null, "metadata": {}
        }))
        .unwrap();
        let campaign: CampaignSpec = serde_json::from_value(json!({
            "id": "campaign:probe", "root_seed": 7,
            "data_bindings": {"model:probe": [{
                "node_id": "model:probe", "input_name": "x", "request_id": "probe-x",
                "schema_fingerprint": envelope.schema_fingerprint,
                "plan_fingerprint": envelope.plan_fingerprint,
                "relation_fingerprint": envelope.relation_fingerprint,
                "output_representation": "tabular_numeric", "feature_set_id": "x",
                "source_ids": ["nir"], "require_relations": false
            }]}
        }))
        .unwrap();
        NestedSelectionRequest {
            id: "probe".into(),
            graph,
            campaign,
            target_node: NodeId::new("model:probe").unwrap(),
            candidates: (1..=3)
                .map(|k| NestedSelectionCandidate {
                    candidate_id: format!("n_components:{k:03}"),
                    params: BTreeMap::from([("n_components".into(), json!(k))]),
                })
                .collect(),
            sample_groups: (0..30)
                .map(|i| (sample(i), GroupId::new(format!("group:{}", i / 3)).unwrap()))
                .collect(),
            target_missing_sample_ids: BTreeSet::new(),
            outer: GroupKFoldSpec { n_splits: 5 },
            inner: GroupKFoldSpec { n_splits: 3 },
            selection_metric: RegressionMetricKind::Rmse,
        }
    }

    fn run(provider: &Provider) -> NestedSelectionOutcome {
        let runtime = runtime();
        let registry = derive_host_controller_registry(
            &methods_estimator_host_controller_specs(&runtime).unwrap(),
        )
        .unwrap();
        let mut controllers = RuntimeControllerRegistry::new();
        register_methods_estimator_controllers(&mut controllers, runtime).unwrap();
        execute_nested_selection(&request(), &registry, &controllers, provider).unwrap()
    }

    #[test]
    fn nested_selection_owns_grouped_loops_without_leaking_outer_rows() {
        let provider = provider(&[]);
        let outcome = run(&provider);
        assert_eq!(outcome.scopes.len(), 5);
        assert_eq!(outcome.oof.len(), 30);
        // 5 outer folds x (3 candidates x 3 inner folds + 1 selected fit).
        assert_eq!(outcome.n_fits, 50);
        let groups = &request().sample_groups;
        for fold in &outcome.outer_fold_set.folds {
            let validation_groups = fold
                .validation_sample_ids
                .iter()
                .map(|id| &groups[id])
                .collect::<BTreeSet<_>>();
            assert!(fold
                .train_sample_ids
                .iter()
                .all(|id| !validation_groups.contains(&groups[id])));
        }
        for (fold_id, fit, predict) in provider.views.lock().unwrap().iter() {
            let fold_id = fold_id.as_ref().unwrap();
            assert!(fit.iter().all(|id| !predict.contains(id)));
            if let Some((outer, _)) = fold_id.as_str().split_once(".inner.") {
                let outer = outcome
                    .outer_fold_set
                    .folds
                    .iter()
                    .find(|f| f.fold_id.as_str() == outer)
                    .unwrap();
                assert!(fit
                    .iter()
                    .chain(predict)
                    .all(|id| outer.train_sample_ids.contains(id)));
            }
        }
        for (scope, fold) in outcome.scopes.iter().zip(&outcome.outer_fold_set.folds) {
            assert_eq!(scope.outer_fold_id, fold.fold_id);
            for row in outcome
                .oof
                .iter()
                .filter(|r| r.outer_fold_id == fold.fold_id)
            {
                assert_eq!(row.y_true, provider.rows[&row.sample_id].1);
            }
            // Two latent directions: one component is not enough.
            assert_ne!(scope.decision.selected_candidate_id, "n_components:001");
        }
        assert!(outcome.model_metrics["rmse"] < 0.05);
    }

    #[test]
    fn outer_validation_targets_never_reach_their_inner_selection() {
        let base = run(&provider(&[]));
        let fold = &base.outer_fold_set.folds[0];
        let shifted = fold
            .validation_sample_ids
            .iter()
            .map(|id| id.as_str()[7..].parse::<usize>().unwrap())
            .collect::<Vec<_>>();
        let changed = run(&provider(&shifted));
        assert_eq!(base.scopes[0].candidates, changed.scopes[0].candidates);
        assert_eq!(base.scopes[0].decision, changed.scopes[0].decision);
        let prediction = |o: &NestedSelectionOutcome, id: &SampleId| {
            o.oof
                .iter()
                .find(|r| &r.sample_id == id)
                .unwrap()
                .prediction
        };
        for id in &fold.validation_sample_ids {
            assert_eq!(prediction(&base, id), prediction(&changed, id));
        }
    }

    #[test]
    fn target_missing_samples_never_reach_nested_fits_or_outer_oof() {
        let provider = provider(&[]);
        let runtime = runtime();
        let registry = derive_host_controller_registry(
            &methods_estimator_host_controller_specs(&runtime).unwrap(),
        )
        .unwrap();
        let mut controllers = RuntimeControllerRegistry::new();
        register_methods_estimator_controllers(&mut controllers, runtime).unwrap();
        let mut request = request();
        let missing = BTreeSet::from([sample(4), sample(17)]);
        request.target_missing_sample_ids = missing.clone();
        let outcome =
            execute_nested_selection(&request, &registry, &controllers, &provider).unwrap();
        let declared = missing.iter().cloned().collect::<Vec<_>>();
        assert_eq!(outcome.outer_fold_set.target_missing_sample_ids, declared);
        assert_eq!(outcome.oof.len(), 28);
        assert!(outcome
            .oof
            .iter()
            .all(|row| !missing.contains(&row.sample_id)));
        for scope in &outcome.scopes {
            assert_eq!(
                scope
                    .inner_fold_set
                    .inner_fold_set
                    .target_missing_sample_ids,
                declared
            );
        }
        let views = provider.views.lock().unwrap();
        assert!(!views.is_empty());
        for (_, fit, predict) in views.iter() {
            assert!(fit.iter().chain(predict).all(|id| !missing.contains(id)));
        }
    }

    #[test]
    fn refuses_more_outer_folds_than_groups_before_any_fit() {
        let provider = provider(&[]);
        let runtime = runtime();
        let registry = derive_host_controller_registry(
            &methods_estimator_host_controller_specs(&runtime).unwrap(),
        )
        .unwrap();
        let mut controllers = RuntimeControllerRegistry::new();
        register_methods_estimator_controllers(&mut controllers, runtime).unwrap();
        let mut request = request();
        request.outer = GroupKFoldSpec { n_splits: 11 };
        assert!(execute_nested_selection(&request, &registry, &controllers, &provider).is_err());
        request.outer = GroupKFoldSpec { n_splits: 5 };
        request.inner = GroupKFoldSpec { n_splits: 9 };
        assert!(execute_nested_selection(&request, &registry, &controllers, &provider).is_err());
        assert!(provider.views.lock().unwrap().is_empty());
    }

    #[test]
    fn masked_references_are_refused_rather_than_read_as_values() {
        let mut provider = provider(&[]);
        provider.masked = Some(sample(4));
        let runtime = runtime();
        let registry = derive_host_controller_registry(
            &methods_estimator_host_controller_specs(&runtime).unwrap(),
        )
        .unwrap();
        let mut controllers = RuntimeControllerRegistry::new();
        register_methods_estimator_controllers(&mut controllers, runtime).unwrap();
        let error = execute_nested_selection(&request(), &registry, &controllers, &provider)
            .unwrap_err()
            .to_string();
        assert!(
            error.contains("unsupported for nested selection"),
            "{error}"
        );
        assert!(
            error.contains("outer fold `fold0` candidate `n_components:001`"),
            "{error}"
        );
    }

    /// Host metrics that count their calls and score every candidate alike.
    struct Constant(Mutex<usize>);

    impl NestedSelectionMetrics for Constant {
        fn regression_metric(
            &self,
            _: RegressionMetricKind,
            y_true: &[f64],
            y_pred: &[f64],
        ) -> Result<f64> {
            assert_eq!(y_true.len(), y_pred.len());
            *self.0.lock().unwrap() += 1;
            Ok(1.0)
        }
    }

    #[test]
    fn host_metrics_decide_while_dag_ml_keeps_the_tie_rule() {
        let provider = provider(&[]);
        let runtime = runtime();
        let registry = derive_host_controller_registry(
            &methods_estimator_host_controller_specs(&runtime).unwrap(),
        )
        .unwrap();
        let mut controllers = RuntimeControllerRegistry::new();
        register_methods_estimator_controllers(&mut controllers, runtime).unwrap();
        let metrics = Constant(Mutex::new(0));
        let outcome = execute_nested_selection_with_metrics(
            &request(),
            &registry,
            &controllers,
            &provider,
            &metrics,
        )
        .unwrap();
        // 5 outer folds x 3 candidates, then mse, rmse and mae of the OOF.
        assert_eq!(*metrics.0.lock().unwrap(), 5 * 3 + 3);
        for scope in &outcome.scopes {
            assert!(scope.candidates.iter().all(|c| c.score == 1.0));
            assert_eq!(scope.decision.selected_candidate_id, "n_components:001");
        }
        assert_eq!(outcome.model_metrics["rmse"], 1.0);
        // The default provider selects two components on the same data.
        let builtin = run(&provider);
        assert!(builtin
            .scopes
            .iter()
            .all(|s| s.decision.selected_candidate_id != "n_components:001"));
    }
}
