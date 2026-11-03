//! Explicit fold-local categorical domains. No label transformation lives here.
use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::{DagMlError, Result};
use crate::ids::{NodeId, SampleId};
use crate::metrics::RegressionMetricReport;
use crate::phase::Phase;
use crate::policy::PredictionLevel;
use crate::runtime::{LineageRecord, NodeResult, NodeTask};

pub const TARGET_DOMAIN_POLICY_KEY: &str = "target_domain_policy";

fn invalid(message: &str) -> DagMlError {
    DagMlError::RuntimeValidation(format!("fold-local target domain: {message}"))
}

fn sha(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

fn labels_valid(labels: &[f64]) -> bool {
    labels.len() >= 2
        && labels
            .iter()
            .enumerate()
            .all(|(i, value)| *value == i as f64)
}

/// Recipe identity is fixed across candidate models; fitted states may differ by fold.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TargetDomainPolicy {
    pub schema_version: u32,
    pub mode: String,
    pub node_id: NodeId,
    pub recipe_fingerprint: String,
    pub class_labels: Vec<f64>,
}

impl TargetDomainPolicy {
    pub fn from_metadata(
        metadata: &std::collections::BTreeMap<String, serde_json::Value>,
    ) -> Result<Option<Self>> {
        metadata
            .get(TARGET_DOMAIN_POLICY_KEY)
            .map(|value| {
                if !value.is_object() {
                    return Err(invalid("policy must be a JSON object"));
                }
                let policy: Self = serde_json::from_value(value.clone())?;
                if policy.schema_version != 1
                    || policy.mode != "fold_local_macro"
                    || !sha(&policy.recipe_fingerprint)
                    || !labels_valid(&policy.class_labels)
                {
                    return Err(invalid(
                        "unsupported policy, recipe fingerprint or class vocabulary",
                    ));
                }
                Ok(policy)
            })
            .transpose()
    }
}

/// Host-attested fitted state and exact training identities. The runtime hashes opaque
/// UTF-8 JSON bytes; it does not inspect bin boundaries or fitted operator internals.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TargetDomain {
    pub schema_version: u32,
    pub recipe_fingerprint: String,
    pub state_json: String,
    pub state_fingerprint: String,
    pub fit_sample_ids: Vec<SampleId>,
    pub class_labels: Vec<f64>,
}

impl TargetDomain {
    pub fn validate(&self) -> Result<()> {
        if self.schema_version != 1
            || !sha(&self.recipe_fingerprint)
            || !sha(&self.state_fingerprint)
            || !labels_valid(&self.class_labels)
            || self.state_json.len() > 1_048_576
            || self.fit_sample_ids.is_empty()
            || self
                .fit_sample_ids
                .windows(2)
                .any(|pair| pair[0] >= pair[1])
        {
            return Err(invalid("invalid fitted-state contract"));
        }
        crate::canonical::parse_typed_json(&self.state_json)
            .map_err(|_| invalid("invalid strict fitted-state JSON"))?;
        let state: serde_json::Value = serde_json::from_str(&self.state_json)?;
        if !state.is_object() || crate::training::contains_runtime_handle(&state) {
            return Err(invalid(
                "fitted state must be strict handle-free JSON object",
            ));
        }
        let fingerprint =
            crate::canonical::bytes_to_hex(&Sha256::digest(self.state_json.as_bytes()));
        if fingerprint != self.state_fingerprint {
            return Err(invalid("fitted-state fingerprint mismatch"));
        }
        Ok(())
    }

    fn validate_policy(&self, policy: &TargetDomainPolicy) -> Result<()> {
        self.validate()?;
        if self.recipe_fingerprint != policy.recipe_fingerprint
            || self.class_labels != policy.class_labels
        {
            return Err(invalid(
                "fitted state differs from signed recipe or class vocabulary",
            ));
        }
        Ok(())
    }
}

pub(crate) fn validate_domain_result(
    result: &NodeResult,
    task: &NodeTask,
    plan: &crate::plan::ExecutionPlan,
) -> Result<()> {
    let policy = TargetDomainPolicy::from_metadata(&plan.graph_plan.graph.metadata)?;
    let Some(policy) = policy else {
        if result.lineage.target_domain.is_some() {
            return Err(invalid("undeclared domain attestation"));
        }
        return Ok(());
    };
    if task.node_plan.node_id != policy.node_id {
        if result.lineage.target_domain.is_some() {
            return Err(invalid("domain attached outside terminal producer"));
        }
        return Ok(());
    }
    let domain = result
        .lineage
        .target_domain
        .as_ref()
        .ok_or_else(|| invalid("missing fitted-state attestation"))?;
    domain.validate_policy(&policy)?;
    let captured = plan
        .graph_plan
        .graph
        .metadata
        .get("target_domain_refit")
        .map(|value| serde_json::from_value::<TargetDomain>(value.clone()))
        .transpose()?;
    if let Some(captured) = captured {
        captured.validate_policy(&policy)?;
        if task.phase != Phase::Predict || domain != &captured {
            return Err(invalid(
                "captured replay requires the exact persisted refit domain and PREDICT phase",
            ));
        }
    }
    if matches!(task.phase, Phase::FitCv | Phase::Refit) {
        let partition = if task.phase == Phase::FitCv {
            crate::data::DataRequestPartition::FoldTrain
        } else {
            crate::data::DataRequestPartition::FullTrain
        };
        let scopes = task
            .data_views
            .values()
            .filter(|view| view.partition == partition)
            .filter_map(|view| view.sample_ids.as_ref())
            .map(|ids| ids.iter().cloned().collect::<BTreeSet<_>>())
            .collect::<Vec<_>>();
        let actual = domain
            .fit_sample_ids
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>();
        if scopes.is_empty() || scopes.iter().any(|expected| expected != &actual) {
            return Err(invalid(
                "fit IDs do not exactly match the native training view",
            ));
        }
    } else if task.phase != Phase::Predict {
        return Err(invalid("unsupported domain phase"));
    }
    if !result.observation_predictions.is_empty()
        || !result.aggregated_predictions.is_empty()
        || !result.classification_probabilities.is_empty()
    {
        return Err(invalid(
            "only fold-local class-label predictions are supported",
        ));
    }
    for block in &result.predictions {
        if block
            .producer_port
            .as_deref()
            .is_some_and(|port| matches!(port, "proba" | "probabilities"))
            || block
                .values
                .iter()
                .any(|row| row.len() != 1 || !policy.class_labels.contains(&row[0]))
        {
            return Err(invalid(
                "prediction is outside the declared categorical domain",
            ));
        }
    }
    for block in &result.regression_targets {
        if block.level != PredictionLevel::Sample
            || block.validity_masks.is_some()
            || block
                .values
                .iter()
                .any(|row| row.len() != 1 || !policy.class_labels.contains(&row[0]))
        {
            return Err(invalid(
                "scoring truth is outside the declared categorical domain",
            ));
        }
    }
    Ok(())
}

/// Macro fold score is a reduction of scalar validation scores, never a pooled OOF score.
pub(crate) fn macro_fold_report(
    reports: &[RegressionMetricReport],
    policy: &TargetDomainPolicy,
    expected_folds: &BTreeSet<crate::ids::FoldId>,
) -> Result<RegressionMetricReport> {
    let mut folds = reports
        .iter()
        .filter(|report| {
            report.producer_node == policy.node_id
                && report.partition == crate::oof::PredictionPartition::Validation
        })
        .collect::<Vec<_>>();
    folds.sort_by(|left, right| left.fold_id.cmp(&right.fold_id));
    if folds.len() != expected_folds.len()
        || folds
            .iter()
            .filter_map(|report| report.fold_id.clone())
            .collect::<BTreeSet<_>>()
            != *expected_folds
        || folds
            .iter()
            .any(|report| report.level != PredictionLevel::Sample || report.target_width != 1)
    {
        return Err(invalid(
            "macro selection requires exactly one mono-y validation score for every planned fold",
        ));
    }
    for report in &folds {
        report.validate()?;
        report
            .target_domain
            .as_ref()
            .ok_or_else(|| invalid("missing fold score domain"))?
            .validate_policy(policy)?;
    }
    let mut report = (*folds
        .first()
        .ok_or_else(|| invalid("empty macro fold selection"))?)
    .clone();
    report.fold_id = Some(crate::ids::FoldId::new("macro")?);
    report.prediction_id = None;
    report.target_domain = None;
    report.row_count = folds.iter().map(|report| report.row_count).sum();
    // Continuous-label metrics have no meaning for an ordinal class vocabulary.
    report.metrics.clear();
    for metric in ["accuracy", "balanced_accuracy", "f1"] {
        let values = folds
            .iter()
            .map(|report| {
                report
                    .metrics
                    .get(metric)
                    .copied()
                    .ok_or_else(|| invalid("missing fold metric"))
            })
            .collect::<Result<Vec<_>>>()?;
        report.metrics.insert(
            metric.to_string(),
            values.iter().sum::<f64>() / values.len() as f64,
        );
    }
    report.validate()?;
    Ok(report)
}

pub(crate) fn validate_domain_lineage(record: &LineageRecord) -> Result<()> {
    if let Some(domain) = &record.target_domain {
        domain.validate()?;
    }
    Ok(())
}

/// Candidate models must answer the same classification question in each
/// fold. Identical recipes alone are insufficient for randomized transforms.
pub(crate) fn validate_candidate_domains(
    reports: &[RegressionMetricReport],
    policy: &TargetDomainPolicy,
) -> Result<()> {
    let mut domains = std::collections::BTreeMap::new();
    for report in reports.iter().filter(|report| {
        report.producer_node == policy.node_id
            && report.partition == crate::oof::PredictionPartition::Validation
            && report
                .fold_id
                .as_ref()
                .is_none_or(|fold| fold.as_str() != "macro")
    }) {
        let fold = report
            .fold_id
            .as_ref()
            .ok_or_else(|| invalid("candidate score has no fold"))?;
        let domain = report
            .target_domain
            .as_ref()
            .ok_or_else(|| invalid("candidate score has no domain"))?;
        domain.validate_policy(policy)?;
        if domains
            .insert(fold, domain)
            .is_some_and(|previous| previous != domain)
        {
            return Err(invalid("candidate classifiers have different fitted target domains in the same fold; their validation scores are not comparable"));
        }
    }
    Ok(())
}

pub(crate) fn validate_domain_plan(plan: &crate::plan::ExecutionPlan) -> Result<()> {
    let Some(policy) = TargetDomainPolicy::from_metadata(&plan.graph_plan.graph.metadata)? else {
        return Ok(());
    };
    let graph = &plan.graph_plan.graph;
    let models = graph
        .nodes
        .iter()
        .filter(|node| node.kind == crate::graph::NodeKind::Model)
        .collect::<Vec<_>>();
    if models.len() != 1
        || models[0].id != policy.node_id
        || graph.nodes.iter().any(|node| {
            !matches!(
                node.kind,
                crate::graph::NodeKind::Transform
                    | crate::graph::NodeKind::YTransform
                    | crate::graph::NodeKind::Model
            )
        })
        || graph.edges.iter().any(|edge| edge.contract.requires_oof)
        || plan.node_plans.values().any(|node| {
            node.inner_cv.is_some()
                || node.shape_plan.is_some()
                || node.input_nodes.len() > 1
                || node.output_nodes.len() > 1
        })
        || !plan.node_plans[&policy.node_id].output_nodes.is_empty()
        || plan.campaign.inner_cv.is_some()
        || !plan.campaign.branch_view_plans.is_empty()
        || graph
            .metadata
            .keys()
            .chain(plan.campaign.metadata.keys())
            .any(|key| {
                key.contains("conformal")
                    || key.contains("hpo")
                    || key.contains("stacking")
                    || key == "training_operator_source_dsl"
            })
        || plan.campaign.aggregation_policy.aggregation_level != PredictionLevel::Sample
        || plan.campaign.aggregation_policy.selection_metric_level != PredictionLevel::Sample
        || plan.campaign.aggregation_policy.grouping_key.is_some()
    {
        return Err(invalid("mode supports one linear terminal classifier, sample scores, no joins, stacking, HPO, nested CV or calibration"));
    }
    let Some(folds) = plan.fold_set.as_ref() else {
        let captured = graph.metadata.get("target_domain_refit").ok_or_else(|| {
            invalid("a fixed partition FoldSet or captured refit PREDICT domain is required")
        })?;
        let captured: TargetDomain = serde_json::from_value(captured.clone())?;
        captured.validate_policy(&policy)?;
        return Ok(());
    };
    if folds.partition_mode != crate::fold::FoldPartitionMode::Partition
        || folds.folds.len() < 2
        || folds.train_exclusion != crate::fold::FoldTrainExclusion::Relations
        || folds.folds.iter().any(|fold| {
            fold.train_sample_ids
                .iter()
                .chain(&fold.validation_sample_ids)
                .cloned()
                .collect::<BTreeSet<_>>()
                != folds.sample_ids.iter().cloned().collect()
        })
    {
        return Err(invalid("mode requires complete KFold training complements, without resampling or fold exclusions"));
    }
    for variant in &plan.variants {
        if variant.choices.values().any(|choice| {
            choice.active_subsequence.is_some()
                || choice.param_overrides.iter().any(|overrides| {
                    overrides.node_id != policy.node_id
                        || overrides
                            .params
                            .keys()
                            .any(|key| key.contains("y_processing") || key.contains("target"))
                })
        }) {
            return Err(invalid(
                "candidate generation may vary classifier parameters only",
            ));
        }
    }
    Ok(())
}

pub(crate) fn validate_domain_request(request: &crate::training::TrainingRequest) -> Result<()> {
    let Some(policy) = TargetDomainPolicy::from_metadata(&request.graph.metadata)? else {
        return Ok(());
    };
    if !request.options.refit
        || request.options.refit_strategy != Some(crate::selection::RefitStrategy::RefitOne)
        || request.options.outputs.len() != 1
        || !request.training_losses.is_empty()
        || request
            .parameter_patches
            .iter()
            .any(|patch| patch.node_id != policy.node_id)
    {
        return Err(invalid("mode requires refit_one, one categorical output and no external loss or target patches"));
    }
    let output = &request.options.outputs[0];
    if output.node_id != policy.node_id
        || output.prediction_kind != crate::training::PredictionKind::ClassLabel
        || output.prediction_level != PredictionLevel::Sample
        || output.target_names.len() != 1
        || output.class_labels.len() != 1
        || output.class_labels[0]
            .iter()
            .map(|label| label.parse::<f64>())
            .collect::<std::result::Result<Vec<_>, _>>()
            .ok()
            .as_ref()
            != Some(&policy.class_labels)
        || !matches!(
            request.options.selection.metric.name.as_str(),
            "accuracy" | "balanced_accuracy" | "f1"
        )
    {
        return Err(invalid(
            "mode requires an explicit mono-y class-label axis and classification selection metric",
        ));
    }
    Ok(())
}

/// Recompute macro evidence from the retained per-fold score contracts. A
/// self-fingerprint never substitutes for domain, coverage or reduction checks.
pub(crate) fn validate_domain_outcome(
    outcome: &crate::training_runtime::TrainingOutcome,
) -> Result<()> {
    let policy =
        TargetDomainPolicy::from_metadata(&outcome.effective_plan.graph_plan.graph.metadata)?;
    let Some(policy) = policy else {
        if outcome
            .lineage
            .iter()
            .any(|record| record.target_domain.is_some())
            || outcome
                .score_set
                .reports
                .iter()
                .any(|report| report.target_domain.is_some())
        {
            return Err(invalid("domain evidence without signed policy"));
        }
        return Ok(());
    };
    validate_domain_plan(&outcome.effective_plan)?;
    validate_candidate_domains(&outcome.score_set.reports, &policy)?;
    if outcome.refit.strategy != Some(crate::selection::RefitStrategy::RefitOne)
        || !outcome.refit.requested
        || !outcome.oof_averages.is_empty()
        || !outcome.variant_oof_averages.is_empty()
        || !outcome.ensemble_averages.is_empty()
        || outcome.conformal_calibration.is_some()
        || outcome.conformal_calibration_replay.is_some()
        || outcome.methods_hpo_resume_state.is_some()
        || outcome.methods_hpo_fold_state.is_some()
        || outcome.outputs.len() != 1
        || outcome.outputs[0].binding.prediction_source
            != crate::training::PredictionSource::FinalRefit
    {
        return Err(invalid(
            "outcome contains unsupported ensembles, OOF pools, calibration or non-refit output",
        ));
    }
    let set = outcome
        .effective_plan
        .fold_set
        .as_ref()
        .ok_or_else(|| invalid("missing folds"))?;
    let expected = set
        .folds
        .iter()
        .map(|fold| fold.fold_id.clone())
        .collect::<BTreeSet<_>>();
    for variant in &outcome.effective_plan.variants {
        let reports = outcome
            .score_set
            .reports
            .iter()
            .filter(|report| {
                report.variant_id.as_ref() == Some(&variant.variant_id)
                    && report.partition == crate::oof::PredictionPartition::Validation
            })
            .cloned()
            .collect::<Vec<_>>();
        let macro_reports = reports
            .iter()
            .filter(|report| {
                report
                    .fold_id
                    .as_ref()
                    .is_some_and(|fold| fold.as_str() == "macro")
            })
            .collect::<Vec<_>>();
        let fold_reports = reports
            .iter()
            .filter(|report| {
                report
                    .fold_id
                    .as_ref()
                    .is_some_and(|fold| expected.contains(fold))
            })
            .cloned()
            .collect::<Vec<_>>();
        if reports.len() != expected.len() + 1 || macro_reports.len() != 1 {
            return Err(invalid("wrong macro/fold evidence cardinality"));
        }
        for report in &fold_reports {
            let domain = report
                .target_domain
                .as_ref()
                .ok_or_else(|| invalid("fold score lacks domain"))?;
            domain.validate_policy(&policy)?;
            let fold = set
                .folds
                .iter()
                .find(|fold| Some(&fold.fold_id) == report.fold_id.as_ref())
                .ok_or_else(|| invalid("foreign score fold"))?;
            if domain.fit_sample_ids.iter().collect::<BTreeSet<_>>()
                != fold.train_sample_ids.iter().collect()
                || report.row_count != fold.validation_sample_ids.len()
            {
                return Err(invalid(
                    "fold score domain does not attest exact training/validation scope",
                ));
            }
        }
        let expected_macro = macro_fold_report(&fold_reports, &policy, &expected)?;
        if &expected_macro != macro_reports[0] {
            return Err(invalid("macro score differs from exact fold reduction"));
        }
    }
    let refit = outcome
        .lineage
        .iter()
        .filter(|record| record.node_id == policy.node_id && record.phase == Phase::Refit)
        .collect::<Vec<_>>();
    if refit.len() != 1 {
        return Err(invalid("missing unique refit domain"));
    }
    let domain = refit[0]
        .target_domain
        .as_ref()
        .ok_or_else(|| invalid("missing refit fitted state"))?;
    domain.validate_policy(&policy)?;
    if domain.fit_sample_ids.iter().collect::<BTreeSet<_>>() != set.sample_ids.iter().collect() {
        return Err(invalid("refit domain does not cover full training set"));
    }
    let binding = &outcome.outputs[0].binding;
    if binding.node_id != policy.node_id
        || binding.prediction_kind != crate::training::PredictionKind::ClassLabel
        || binding.target_names.len() != 1
        || binding.class_labels.len() != 1
        || binding.class_labels[0]
            .iter()
            .map(|label| label.parse::<f64>())
            .collect::<std::result::Result<Vec<_>, _>>()
            .ok()
            .as_ref()
            != Some(&policy.class_labels)
    {
        return Err(invalid(
            "output binding differs from categorical domain vocabulary",
        ));
    }
    let selected_records = outcome
        .lineage
        .iter()
        .filter(|record| record.node_id == policy.node_id && record.phase == Phase::FitCv)
        .collect::<Vec<_>>();
    if selected_records.len() != expected.len() {
        return Err(invalid(
            "selected variant lineage does not exactly cover folds",
        ));
    }
    for record in selected_records {
        if record.variant_id.as_ref() != Some(&outcome.selected_variant_id) {
            return Err(invalid("selected domain belongs to another variant"));
        }
        let scores = outcome
            .score_set
            .reports
            .iter()
            .filter(|report| {
                report.producer_node == record.node_id
                    && report.variant_id == record.variant_id
                    && report.fold_id == record.fold_id
                    && report.partition == crate::oof::PredictionPartition::Validation
            })
            .collect::<Vec<_>>();
        if scores.len() != 1 || scores[0].target_domain != record.target_domain {
            return Err(invalid("selected score and lineage domains differ"));
        }
    }
    for report in &outcome.score_set.reports {
        if report.partition == crate::oof::PredictionPartition::Validation {
            continue;
        }
        let expected_domain = if report.fold_id.is_none() {
            Some(domain)
        } else {
            outcome
                .lineage
                .iter()
                .find(|record| {
                    record.node_id == report.producer_node
                        && record.variant_id == report.variant_id
                        && record.phase == Phase::FitCv
                        && record.fold_id == report.fold_id
                })
                .and_then(|record| record.target_domain.as_ref())
        };
        if report.target_domain.as_ref() != expected_domain || expected_domain.is_none() {
            return Err(invalid(
                "descriptive score lacks its exact fold/refit domain",
            ));
        }
    }
    Ok(())
}

pub(crate) fn validate_domain_replay(
    plan: &crate::plan::ExecutionPlan,
    source: &[LineageRecord],
    replay: &[LineageRecord],
) -> Result<()> {
    let Some(policy) = TargetDomainPolicy::from_metadata(&plan.graph_plan.graph.metadata)? else {
        return Ok(());
    };
    let records = source
        .iter()
        .filter(|record| record.node_id == policy.node_id && record.phase == Phase::Refit)
        .collect::<Vec<_>>();
    if records.len() != 1 {
        return Err(invalid("replay has no unique source refit domain"));
    }
    let domain = records[0]
        .target_domain
        .as_ref()
        .ok_or_else(|| invalid("source refit lacks domain"))?;
    domain.validate_policy(&policy)?;
    let replay_records = replay
        .iter()
        .filter(|record| record.node_id == policy.node_id)
        .collect::<Vec<_>>();
    if replay_records.len() != 1
        || replay_records[0].phase != Phase::Predict
        || replay_records[0].target_domain.as_ref() != Some(domain)
    {
        return Err(invalid(
            "PREDICT must reuse the exact persisted refit target domain",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::aggregation::PredictionUnitId;
    use crate::ids::FoldId;
    use crate::metrics::{
        score_regression_prediction_block, RegressionMetricKind, RegressionTargetBlock,
    };
    use crate::oof::{PredictionBlock, PredictionPartition};

    fn policy() -> TargetDomainPolicy {
        TargetDomainPolicy {
            schema_version: 1,
            mode: "fold_local_macro".into(),
            node_id: NodeId::new("classifier").unwrap(),
            recipe_fingerprint: "a".repeat(64),
            class_labels: vec![0.0, 1.0],
        }
    }
    fn domain() -> TargetDomain {
        let state_json = r#"{"edges":[-1.0,0.5,4.0],"encode":"ordinal"}"#.to_string();
        TargetDomain {
            schema_version: 1,
            recipe_fingerprint: "a".repeat(64),
            state_fingerprint: crate::canonical::bytes_to_hex(&Sha256::digest(
                state_json.as_bytes(),
            )),
            state_json,
            fit_sample_ids: vec![SampleId::new("fit:1").unwrap()],
            class_labels: vec![0.0, 1.0],
        }
    }
    fn report(fold: &str, labels: &[f64], predicted: &[f64]) -> RegressionMetricReport {
        let ids = (0..labels.len())
            .map(|i| SampleId::new(format!("{fold}:{i}")).unwrap())
            .collect::<Vec<_>>();
        let block = PredictionBlock {
            prediction_id: None,
            producer_node: policy().node_id,
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new(fold).unwrap()),
            sample_ids: ids.clone(),
            values: predicted.iter().map(|value| vec![*value]).collect(),
            target_names: vec!["y".into()],
        };
        let targets = RegressionTargetBlock {
            level: PredictionLevel::Sample,
            unit_ids: ids.into_iter().map(PredictionUnitId::Sample).collect(),
            values: labels.iter().map(|value| vec![*value]).collect(),
            target_names: vec!["y".into()],
            validity_masks: None,
        };
        let mut report = score_regression_prediction_block(
            &block,
            &targets,
            &[
                RegressionMetricKind::Accuracy,
                RegressionMetricKind::BalancedAccuracy,
                RegressionMetricKind::F1,
            ],
        )
        .unwrap();
        report.target_domain = Some(domain());
        report
    }
    #[test]
    fn fitted_domain_rejects_changed_state_scope_recipe_and_vocabulary() {
        domain().validate_policy(&policy()).unwrap();
        let mut changed = domain();
        changed.state_json.push(' ');
        assert!(changed.validate().is_err());
        let mut changed = domain();
        changed
            .fit_sample_ids
            .push(changed.fit_sample_ids[0].clone());
        assert!(changed.validate().is_err());
        let mut changed = domain();
        changed.recipe_fingerprint = "b".repeat(64);
        assert!(changed.validate_policy(&policy()).is_err());
        let mut changed = domain();
        changed.class_labels = vec![0.0, 2.0];
        assert!(changed.validate().is_err());
    }
    #[test]
    fn fitted_domain_rejects_duplicate_json_nonfinite_and_runtime_handles() {
        for state in [
            r#"{"a":1,"a":2}"#,
            r#"{"edge":NaN}"#,
            r#"{"handle":1,"kind":"data","owner_controller":"x"}"#,
        ] {
            let mut value = domain();
            value.state_json = state.into();
            value.state_fingerprint =
                crate::canonical::bytes_to_hex(&Sha256::digest(state.as_bytes()));
            assert!(value.validate().is_err(), "{state}");
        }
    }
    #[test]
    fn macro_scores_each_fold_equally_without_pooling_predictions() {
        let folds = vec![
            report("fold:0", &[0.0], &[0.0]),
            report("fold:1", &[0.0, 1.0, 1.0], &[1.0, 0.0, 0.0]),
        ];
        let expected = BTreeSet::from([
            FoldId::new("fold:0").unwrap(),
            FoldId::new("fold:1").unwrap(),
        ]);
        let summary = macro_fold_report(&folds, &policy(), &expected).unwrap();
        assert_eq!(summary.fold_id.unwrap().as_str(), "macro");
        assert_eq!(summary.metrics["accuracy"], 0.5); // pooled accuracy would be 1/4.
        assert_eq!(summary.metrics["balanced_accuracy"], 0.5);
        assert_eq!(summary.row_count, 4);
        assert!(summary.target_domain.is_none());
        assert!(!summary.metrics.contains_key("rmse"));
    }
    #[test]
    fn macro_requires_exact_fold_coverage() {
        let folds = vec![report("fold:0", &[0.0], &[0.0])];
        let expected = BTreeSet::from([
            FoldId::new("fold:0").unwrap(),
            FoldId::new("fold:1").unwrap(),
        ]);
        assert!(macro_fold_report(&folds, &policy(), &expected).is_err());
        let duplicate = vec![folds[0].clone(), folds[0].clone()];
        assert!(macro_fold_report(&duplicate, &policy(), &expected).is_err());
    }
    #[test]
    fn runtime_finalizers_keep_domains_separate() {
        let mut ctx =
            crate::runtime::RunContext::new(crate::ids::RunId::new("run:domain").unwrap(), None);
        ctx.target_domain_policy = Some(policy());
        ctx.target_domain_folds = BTreeSet::from([
            FoldId::new("fold:0").unwrap(),
            FoldId::new("fold:1").unwrap(),
        ]);
        ctx.score_collector = vec![
            report("fold:0", &[0.0], &[0.0]),
            report("fold:1", &[1.0], &[0.0]),
        ];
        ctx.collect_cross_fold_validation_scores(crate::fold::FoldPartitionMode::Partition)
            .unwrap();
        ctx.collect_cross_fold_train_scores(RegressionMetricKind::BalancedAccuracy)
            .unwrap();
        ctx.collect_cross_fold_test_scores(RegressionMetricKind::BalancedAccuracy)
            .unwrap();
        assert_eq!(ctx.score_collector.len(), 3);
        assert!(ctx.oof_average_blocks.is_empty());
        assert!(ctx.train_ensemble_blocks.is_empty());
        assert!(ctx.test_ensemble_blocks.is_empty());
        assert_eq!(ctx.score_collector[2].metrics["balanced_accuracy"], 0.5);
    }
    #[test]
    #[cfg(dag_ml_workspace_contract_fixtures)]
    fn signed_plan_and_request_reject_resampled_and_non_refit_domains() {
        let mut request: crate::training::TrainingRequest = serde_json::from_str(include_str!(
            "../../../examples/fixtures/training/training_request_refit.v1.json"
        ))
        .unwrap();
        let mut policy = policy();
        policy.node_id = NodeId::new("model:base").unwrap();
        request.graph.metadata.insert(
            TARGET_DOMAIN_POLICY_KEY.into(),
            serde_json::to_value(&policy).unwrap(),
        );
        request.campaign.shape_plans.clear();
        request.options.outputs[0].prediction_kind = crate::training::PredictionKind::ClassLabel;
        request.options.outputs[0].class_labels = vec![vec!["0".into(), "1".into()]];
        request.options.selection.metric.name = "balanced_accuracy".into();
        request.options.selection.metric.objective = crate::selection::MetricObjective::Maximize;
        request.request_fingerprint = request.compute_fingerprint().unwrap();
        validate_domain_request(&request).unwrap();
        let mut registry = crate::controller::ControllerRegistry::new();
        for manifest in &request.controller_manifests {
            registry.register(manifest.clone()).unwrap();
        }
        let plan = crate::plan::build_execution_plan(
            request.plan_id.clone(),
            request.graph.clone(),
            request.campaign.clone(),
            &registry,
        )
        .unwrap();
        validate_domain_plan(&plan).unwrap();
        // Inference keeps the exact fitted state, even if a modified state has
        // a perfectly valid new hash. A hash alone cannot authorize refitting.
        let mut source: LineageRecord = serde_json::from_str::<NodeResult>(include_str!(
            "../../../examples/fixtures/runtime/node_result_transform_scale.json"
        ))
        .unwrap()
        .lineage;
        source.node_id = policy.node_id.clone();
        source.phase = Phase::Refit;
        source.target_domain = Some(domain());
        let mut replay = source.clone();
        replay.phase = Phase::Predict;
        validate_domain_replay(&plan, &[source.clone()], &[replay.clone()]).unwrap();
        let changed = replay.target_domain.as_mut().unwrap();
        changed.state_json = r#"{"edges":[-1.0,0.7,4.0],"encode":"ordinal"}"#.into();
        changed.state_fingerprint =
            crate::canonical::bytes_to_hex(&Sha256::digest(changed.state_json.as_bytes()));
        assert!(validate_domain_replay(&plan, &[source], &[replay]).is_err());
        let mut invalid_plan = plan.clone();
        invalid_plan.fold_set.as_mut().unwrap().partition_mode =
            crate::fold::FoldPartitionMode::Resampled;
        assert!(validate_domain_plan(&invalid_plan).is_err());
        request.options.refit = false;
        assert!(validate_domain_request(&request).is_err());
        let mut invalid_plan = plan;
        invalid_plan
            .node_plans
            .get_mut(&policy.node_id)
            .unwrap()
            .output_nodes
            .push(NodeId::new("consumer").unwrap());
        assert!(validate_domain_plan(&invalid_plan).is_err());
    }
    #[test]
    fn policies_fail_closed_for_unsupported_versions_modes_and_collapsed_classes() {
        let mut map = std::collections::BTreeMap::new();
        for (key, value) in [
            ("schema_version", serde_json::json!(2)),
            ("mode", serde_json::json!("pool")),
            ("class_labels", serde_json::json!([0])),
        ] {
            let mut candidate = serde_json::to_value(policy()).unwrap();
            candidate[key] = value;
            map.insert(TARGET_DOMAIN_POLICY_KEY.into(), candidate);
            assert!(TargetDomainPolicy::from_metadata(&map).is_err());
        }
    }
    #[test]
    fn candidate_models_require_the_same_fitted_domain_within_each_fold() {
        let first = report("fold:0", &[0.0], &[0.0]);
        let mut second = first.clone();
        second.variant_id = Some(crate::ids::VariantId::new("variant:other").unwrap());
        validate_candidate_domains(&[first.clone(), second.clone()], &policy()).unwrap();
        let changed = second.target_domain.as_mut().unwrap();
        changed.state_json = r#"{"edges":[-1.0,0.7,4.0],"encode":"ordinal"}"#.into();
        changed.state_fingerprint =
            crate::canonical::bytes_to_hex(&Sha256::digest(changed.state_json.as_bytes()));
        assert!(validate_candidate_domains(&[first, second], &policy())
            .unwrap_err()
            .to_string()
            .contains("not comparable"));
    }
}
