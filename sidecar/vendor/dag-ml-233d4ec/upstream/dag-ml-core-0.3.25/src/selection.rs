use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::error::{DagMlError, Result};
use crate::oof::PredictionPartition;
use crate::policy::PredictionLevel;
use crate::relation::EntityUnitLevel;

pub const SELECTION_POLICY_SCHEMA_VERSION: u32 = 1;
pub const SELECTION_POLICY_SCHEMA_ID: &str =
    "https://github.com/GBeurier/dag-ml/schemas/selection_policy.v1.schema.json";
pub const SELECTION_DECISION_SCHEMA_VERSION: u32 = 1;
pub const SELECTION_DECISION_SCHEMA_ID: &str =
    "https://github.com/GBeurier/dag-ml/schemas/selection_decision.v1.schema.json";

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MetricObjective {
    Minimize,
    Maximize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct SelectionMetric {
    pub name: String,
    pub objective: MetricObjective,
}

impl SelectionMetric {
    pub fn validate(&self) -> Result<()> {
        if self.name.trim().is_empty() {
            return Err(DagMlError::CampaignValidation(
                "selection metric name is empty".to_string(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CandidateScore {
    pub candidate_id: String,
    #[serde(default)]
    pub metrics: BTreeMap<String, f64>,
    #[serde(default)]
    pub metadata: BTreeMap<String, serde_json::Value>,
}

impl CandidateScore {
    pub fn validate(&self) -> Result<()> {
        if self.candidate_id.trim().is_empty() {
            return Err(DagMlError::CampaignValidation(
                "candidate id is empty".to_string(),
            ));
        }
        for (name, value) in &self.metrics {
            if name.trim().is_empty() {
                return Err(DagMlError::CampaignValidation(format!(
                    "candidate `{}` has an empty metric name",
                    self.candidate_id
                )));
            }
            if value.is_nan() {
                return Err(DagMlError::CampaignValidation(format!(
                    "candidate `{}` metric `{name}` is NaN",
                    self.candidate_id
                )));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvaluationScope {
    Oof,
    Holdout,
    Final,
    Train,
    Refit,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct EvaluationResult {
    pub metric: SelectionMetric,
    pub partition: PredictionPartition,
    pub scope: EvaluationScope,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reduction_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit_level: Option<EntityUnitLevel>,
}

impl EvaluationResult {
    pub fn validate(&self) -> Result<()> {
        self.metric.validate()?;
        validate_optional_id("evaluation reduction_id", self.reduction_id.as_deref())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RefitStrategy {
    RefitOne,
    RefitEnsemble,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct RefitSlotPlan {
    pub strategy: RefitStrategy,
    pub selection_level: PredictionLevel,
    pub member_count: usize,
    pub selection_metric: SelectionMetric,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reduction_id: Option<String>,
}

impl RefitSlotPlan {
    pub fn validate(&self) -> Result<()> {
        self.selection_metric.validate()?;
        if self.member_count == 0 {
            return Err(DagMlError::CampaignValidation(
                "refit slot member_count must be positive".to_string(),
            ));
        }
        match self.strategy {
            RefitStrategy::RefitOne if self.member_count != 1 => {
                return Err(DagMlError::CampaignValidation(
                    "refit_one slot requires member_count=1".to_string(),
                ));
            }
            RefitStrategy::RefitEnsemble if self.member_count < 2 => {
                return Err(DagMlError::CampaignValidation(
                    "refit_ensemble slot requires member_count>=2".to_string(),
                ));
            }
            _ => {}
        }
        validate_optional_id("refit slot reduction_id", self.reduction_id.as_deref())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MetaRowDomain {
    Sample,
    Combo,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MetaTrainingFeatures {
    Oof,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InferenceFeatures {
    RefitBasePredictions,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SelectionProtocol {
    Nested,
    Holdout,
    ReuseOof,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct StackingFitContract {
    pub meta_training_features: MetaTrainingFeatures,
    pub inference_features: InferenceFeatures,
    pub selection_protocol: SelectionProtocol,
    pub meta_row_domain: MetaRowDomain,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub final_reduction_id: Option<String>,
    #[serde(default)]
    pub unsafe_allow_reuse_oof: bool,
}

impl StackingFitContract {
    pub fn validate(&self) -> Result<()> {
        if self.selection_protocol == SelectionProtocol::ReuseOof && !self.unsafe_allow_reuse_oof {
            return Err(DagMlError::CampaignValidation(
                "reuse_oof stacking selection requires unsafe_allow_reuse_oof=true".to_string(),
            ));
        }
        if self.meta_row_domain == MetaRowDomain::Combo && self.final_reduction_id.is_none() {
            return Err(DagMlError::CampaignValidation(
                "combo meta_row_domain requires final_reduction_id".to_string(),
            ));
        }
        validate_optional_id(
            "stacking final_reduction_id",
            self.final_reduction_id.as_deref(),
        )
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct SelectionPolicy {
    pub id: String,
    pub metric: SelectionMetric,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub required_metric_level: Option<PredictionLevel>,
    #[serde(default = "default_true")]
    pub require_finite: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evaluation_scope: Option<EvaluationScope>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refit_slot_plan: Option<RefitSlotPlan>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stacking_fit_contract: Option<StackingFitContract>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reduction_id: Option<String>,
}

impl SelectionPolicy {
    pub fn validate(&self) -> Result<()> {
        if self.id.trim().is_empty() {
            return Err(DagMlError::CampaignValidation(
                "selection policy id is empty".to_string(),
            ));
        }
        self.metric.validate()?;
        if let Some(refit_slot_plan) = &self.refit_slot_plan {
            refit_slot_plan.validate()?;
        }
        if let Some(stacking_fit_contract) = &self.stacking_fit_contract {
            stacking_fit_contract.validate()?;
        }
        validate_optional_id(
            "selection policy reduction_id",
            self.reduction_id.as_deref(),
        )
    }
}

fn default_true() -> bool {
    true
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RankedCandidate {
    pub candidate_id: String,
    pub score: f64,
    pub rank: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SelectionDecision {
    pub policy_id: String,
    pub selected_candidate_id: String,
    pub metric_name: String,
    pub objective: MetricObjective,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metric_level: Option<PredictionLevel>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evaluation_scope: Option<EvaluationScope>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refit_slot_plan: Option<RefitSlotPlan>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reduction_id: Option<String>,
    pub selected_score: f64,
    #[serde(default)]
    pub ranked_candidates: Vec<RankedCandidate>,
}

impl SelectionDecision {
    pub fn validate(&self) -> Result<()> {
        if self.policy_id.trim().is_empty() {
            return Err(DagMlError::CampaignValidation(
                "selection decision policy_id is empty".to_string(),
            ));
        }
        if self.selected_candidate_id.trim().is_empty() {
            return Err(DagMlError::CampaignValidation(
                "selection decision selected_candidate_id is empty".to_string(),
            ));
        }
        if self.metric_name.trim().is_empty() {
            return Err(DagMlError::CampaignValidation(
                "selection decision metric_name is empty".to_string(),
            ));
        }
        if !self.selected_score.is_finite() {
            return Err(DagMlError::CampaignValidation(format!(
                "selection `{}` selected score is not finite",
                self.policy_id
            )));
        }
        if self.ranked_candidates.is_empty() {
            return Err(DagMlError::CampaignValidation(format!(
                "selection `{}` has no ranked candidates",
                self.policy_id
            )));
        }
        if self.ranked_candidates[0].candidate_id != self.selected_candidate_id {
            return Err(DagMlError::CampaignValidation(format!(
                "selection `{}` first ranked candidate does not match selected candidate",
                self.policy_id
            )));
        }
        if let Some(refit_slot_plan) = &self.refit_slot_plan {
            refit_slot_plan.validate()?;
        }
        validate_optional_id(
            "selection decision reduction_id",
            self.reduction_id.as_deref(),
        )?;
        let mut seen = BTreeSet::new();
        for (idx, candidate) in self.ranked_candidates.iter().enumerate() {
            if candidate.rank != idx + 1 {
                return Err(DagMlError::CampaignValidation(format!(
                    "selection `{}` candidate `{}` has rank {}, expected {}",
                    self.policy_id,
                    candidate.candidate_id,
                    candidate.rank,
                    idx + 1
                )));
            }
            if !seen.insert(candidate.candidate_id.as_str()) {
                return Err(DagMlError::CampaignValidation(format!(
                    "selection `{}` contains duplicate candidate `{}`",
                    self.policy_id, candidate.candidate_id
                )));
            }
        }
        Ok(())
    }
}

pub fn select_candidate(
    policy: &SelectionPolicy,
    candidates: &[CandidateScore],
) -> Result<SelectionDecision> {
    policy.validate()?;
    if candidates.is_empty() {
        return Err(DagMlError::CampaignValidation(format!(
            "selection policy `{}` has no candidates",
            policy.id
        )));
    }

    let mut scored = Vec::with_capacity(candidates.len());
    let mut seen = BTreeSet::new();
    for candidate in candidates {
        candidate.validate()?;
        if !seen.insert(candidate.candidate_id.as_str()) {
            return Err(DagMlError::CampaignValidation(format!(
                "selection policy `{}` has duplicate candidate `{}`",
                policy.id, candidate.candidate_id
            )));
        }
        validate_candidate_metric_level(policy, candidate)?;
        let score = candidate
            .metrics
            .get(&policy.metric.name)
            .copied()
            .ok_or_else(|| {
                DagMlError::CampaignValidation(format!(
                    "candidate `{}` is missing selection metric `{}`",
                    candidate.candidate_id, policy.metric.name
                ))
            })?;
        if policy.require_finite && !score.is_finite() {
            return Err(DagMlError::CampaignValidation(format!(
                "candidate `{}` metric `{}` is not finite",
                candidate.candidate_id, policy.metric.name
            )));
        }
        scored.push((candidate.candidate_id.clone(), score));
    }

    scored.sort_by(|left, right| compare_scores(policy.metric.objective, left, right));
    let ranked_candidates = scored
        .iter()
        .enumerate()
        .map(|(idx, (candidate_id, score))| RankedCandidate {
            candidate_id: candidate_id.clone(),
            score: *score,
            rank: idx + 1,
        })
        .collect::<Vec<_>>();
    let selected = ranked_candidates
        .first()
        .expect("candidates were checked as non-empty");
    let decision = SelectionDecision {
        policy_id: policy.id.clone(),
        selected_candidate_id: selected.candidate_id.clone(),
        metric_name: policy.metric.name.clone(),
        objective: policy.metric.objective,
        metric_level: policy.required_metric_level,
        evaluation_scope: policy.evaluation_scope,
        refit_slot_plan: policy.refit_slot_plan.clone(),
        reduction_id: policy.reduction_id.clone(),
        selected_score: selected.score,
        ranked_candidates,
    };
    decision.validate()?;
    Ok(decision)
}

pub fn select_candidate_groups(
    policy: &SelectionPolicy,
    candidates: &[CandidateScore],
    groups: &BTreeMap<String, Vec<String>>,
) -> Result<BTreeMap<String, SelectionDecision>> {
    policy.validate()?;
    let mut by_id = BTreeMap::new();
    for candidate in candidates {
        candidate.validate()?;
        if by_id
            .insert(candidate.candidate_id.as_str(), candidate)
            .is_some()
        {
            return Err(DagMlError::CampaignValidation(format!(
                "selection policy `{}` has duplicate candidate `{}`",
                policy.id, candidate.candidate_id
            )));
        }
    }
    let mut decisions = BTreeMap::new();
    for (group_id, candidate_ids) in groups {
        if group_id.trim().is_empty() {
            return Err(DagMlError::CampaignValidation(
                "selection group id is empty".to_string(),
            ));
        }
        if candidate_ids.is_empty() {
            return Err(DagMlError::CampaignValidation(format!(
                "selection group `{group_id}` has no candidates"
            )));
        }
        let group_candidates = candidate_ids
            .iter()
            .map(|candidate_id| {
                by_id
                    .get(candidate_id.as_str())
                    .cloned()
                    .cloned()
                    .ok_or_else(|| {
                        DagMlError::CampaignValidation(format!(
                        "selection group `{group_id}` references unknown candidate `{candidate_id}`"
                    ))
                    })
            })
            .collect::<Result<Vec<_>>>()?;
        decisions.insert(
            group_id.clone(),
            select_candidate(policy, &group_candidates)?,
        );
    }
    Ok(decisions)
}

fn compare_scores(
    objective: MetricObjective,
    left: &(String, f64),
    right: &(String, f64),
) -> Ordering {
    let score_order = match objective {
        MetricObjective::Minimize => left.1.total_cmp(&right.1),
        MetricObjective::Maximize => right.1.total_cmp(&left.1),
    };
    score_order.then_with(|| left.0.cmp(&right.0))
}

fn validate_candidate_metric_level(
    policy: &SelectionPolicy,
    candidate: &CandidateScore,
) -> Result<()> {
    let Some(required_level) = policy.required_metric_level else {
        return Ok(());
    };
    let Some(raw_level) = candidate.metadata.get("metric_level") else {
        return Err(DagMlError::CampaignValidation(format!(
            "candidate `{}` is missing required metric_level `{}`",
            candidate.candidate_id,
            prediction_level_name(required_level)
        )));
    };
    let actual_level = match raw_level {
        serde_json::Value::String(value) => parse_prediction_level(value).ok_or_else(|| {
            DagMlError::CampaignValidation(format!(
                "candidate `{}` has invalid metric_level `{value}`",
                candidate.candidate_id
            ))
        })?,
        _ => {
            return Err(DagMlError::CampaignValidation(format!(
                "candidate `{}` metric_level must be a string",
                candidate.candidate_id
            )));
        }
    };
    if actual_level != required_level {
        return Err(DagMlError::CampaignValidation(format!(
            "candidate `{}` metric_level `{}` does not match required `{}`",
            candidate.candidate_id,
            prediction_level_name(actual_level),
            prediction_level_name(required_level)
        )));
    }
    Ok(())
}

fn parse_prediction_level(value: &str) -> Option<PredictionLevel> {
    match value {
        "observation" => Some(PredictionLevel::Observation),
        "sample" => Some(PredictionLevel::Sample),
        "target" => Some(PredictionLevel::Target),
        "group" => Some(PredictionLevel::Group),
        _ => None,
    }
}

fn prediction_level_name(level: PredictionLevel) -> &'static str {
    match level {
        PredictionLevel::Observation => "observation",
        PredictionLevel::Sample => "sample",
        PredictionLevel::Target => "target",
        PredictionLevel::Group => "group",
    }
}

fn validate_optional_id(label: &str, value: Option<&str>) -> Result<()> {
    if value.is_some_and(|value| value.trim().is_empty()) {
        return Err(DagMlError::CampaignValidation(format!(
            "{label} must not be empty"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rmse_policy() -> SelectionPolicy {
        SelectionPolicy {
            id: "select:rmse".to_string(),
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
        }
    }

    fn candidate(id: &str, rmse: f64) -> CandidateScore {
        CandidateScore {
            candidate_id: id.to_string(),
            metrics: BTreeMap::from([("rmse".to_string(), rmse)]),
            metadata: BTreeMap::new(),
        }
    }

    fn candidate_with_level(id: &str, rmse: f64, level: &str) -> CandidateScore {
        CandidateScore {
            candidate_id: id.to_string(),
            metrics: BTreeMap::from([("rmse".to_string(), rmse)]),
            metadata: BTreeMap::from([(
                "metric_level".to_string(),
                serde_json::Value::String(level.to_string()),
            )]),
        }
    }

    #[test]
    fn selects_lowest_metric_with_deterministic_tie_break() {
        let decision = select_candidate(
            &rmse_policy(),
            &[
                candidate("model:b", 1.0),
                candidate("model:a", 1.0),
                candidate("model:c", 2.0),
            ],
        )
        .unwrap();

        assert_eq!(decision.selected_candidate_id, "model:a");
        assert_eq!(decision.ranked_candidates[0].rank, 1);
    }

    #[test]
    fn grouped_selection_rejects_duplicate_candidate_ids() {
        assert!(select_candidate_groups(
            &rmse_policy(),
            &[candidate("model:a", 1.0), candidate("model:a", 2.0)],
            &BTreeMap::from([("branch:b0".to_string(), vec!["model:a".to_string()])]),
        )
        .is_err());
    }

    #[test]
    fn selection_policy_can_require_metric_level() {
        let mut policy = rmse_policy();
        policy.required_metric_level = Some(PredictionLevel::Sample);

        let decision = select_candidate(
            &policy,
            &[
                candidate_with_level("model:a", 1.0, "sample"),
                candidate_with_level("model:b", 2.0, "sample"),
            ],
        )
        .unwrap();
        assert_eq!(decision.selected_candidate_id, "model:a");
        assert_eq!(decision.metric_level, Some(PredictionLevel::Sample));

        assert!(select_candidate(
            &policy,
            &[
                candidate_with_level("model:a", 1.0, "sample"),
                candidate_with_level("model:b", 2.0, "target"),
            ],
        )
        .is_err());
        assert!(select_candidate(&policy, &[candidate("model:a", 1.0)]).is_err());
    }

    #[test]
    fn d9_negative_row_level_metric_cannot_drive_sample_refit() {
        let mut policy = rmse_policy();
        policy.required_metric_level = Some(PredictionLevel::Sample);

        let error = select_candidate(
            &policy,
            &[candidate_with_level("model:row_metric", 0.1, "observation")],
        )
        .unwrap_err()
        .to_string();

        assert!(
            error.contains("metric_level `observation` does not match required `sample`"),
            "unexpected D9 row-vs-sample metric error: {error}"
        );
    }

    #[test]
    fn selection_policy_echoes_evaluation_and_refit_contracts() {
        let mut policy = rmse_policy();
        policy.evaluation_scope = Some(EvaluationScope::Oof);
        policy.reduction_id = Some("reduction:obs_to_sample".to_string());
        policy.refit_slot_plan = Some(RefitSlotPlan {
            strategy: RefitStrategy::RefitOne,
            selection_level: PredictionLevel::Sample,
            member_count: 1,
            selection_metric: policy.metric.clone(),
            reduction_id: Some("reduction:obs_to_sample".to_string()),
        });

        let decision = select_candidate(
            &policy,
            &[candidate("model:a", 1.0), candidate("model:b", 2.0)],
        )
        .unwrap();

        assert_eq!(decision.evaluation_scope, Some(EvaluationScope::Oof));
        assert_eq!(
            decision.refit_slot_plan.as_ref().unwrap().strategy,
            RefitStrategy::RefitOne
        );
        assert_eq!(
            decision.reduction_id.as_deref(),
            Some("reduction:obs_to_sample")
        );

        let mut invalid_policy = policy;
        invalid_policy.refit_slot_plan = Some(RefitSlotPlan {
            strategy: RefitStrategy::RefitEnsemble,
            selection_level: PredictionLevel::Sample,
            member_count: 1,
            selection_metric: invalid_policy.metric.clone(),
            reduction_id: None,
        });
        assert!(select_candidate(&invalid_policy, &[candidate("model:a", 1.0)]).is_err());
    }

    #[test]
    fn stacking_fit_contract_guards_oof_reuse_and_combo_reduction() {
        let valid = StackingFitContract {
            meta_training_features: MetaTrainingFeatures::Oof,
            inference_features: InferenceFeatures::RefitBasePredictions,
            selection_protocol: SelectionProtocol::Nested,
            meta_row_domain: MetaRowDomain::Combo,
            final_reduction_id: Some("reduction:combo_to_sample".to_string()),
            unsafe_allow_reuse_oof: false,
        };
        valid.validate().unwrap();

        let missing_reduction = StackingFitContract {
            final_reduction_id: None,
            ..valid.clone()
        };
        assert!(missing_reduction.validate().is_err());

        let unsafe_reuse_required = StackingFitContract {
            selection_protocol: SelectionProtocol::ReuseOof,
            meta_row_domain: MetaRowDomain::Sample,
            final_reduction_id: None,
            unsafe_allow_reuse_oof: false,
            ..valid
        };
        assert!(unsafe_reuse_required.validate().is_err());
    }

    #[cfg(dag_ml_workspace_contract_fixtures)]
    #[test]
    fn published_selection_schemas_declare_current_contracts() {
        let policy_schema: serde_json::Value = serde_json::from_str(include_str!(
            "../../../docs/contracts/selection_policy.schema.json"
        ))
        .unwrap();
        assert_eq!(policy_schema["$id"], SELECTION_POLICY_SCHEMA_ID);
        assert!(policy_schema["required"]
            .as_array()
            .unwrap()
            .iter()
            .any(|field| field.as_str() == Some("metric")));
        assert!(policy_schema["properties"]
            .get("evaluation_scope")
            .is_some());
        assert!(policy_schema["properties"].get("refit_slot_plan").is_some());
        assert!(policy_schema["properties"]
            .get("stacking_fit_contract")
            .is_some());

        let decision_schema: serde_json::Value = serde_json::from_str(include_str!(
            "../../../docs/contracts/selection_decision.schema.json"
        ))
        .unwrap();
        assert_eq!(decision_schema["$id"], SELECTION_DECISION_SCHEMA_ID);
        assert!(decision_schema["$defs"]["prediction_level"]["enum"]
            .as_array()
            .unwrap()
            .iter()
            .any(|level| level.as_str() == Some("group")));
        assert!(decision_schema["$defs"]["ranked_candidate"]["required"]
            .as_array()
            .unwrap()
            .iter()
            .any(|field| field.as_str() == Some("rank")));
        assert!(decision_schema["properties"]
            .get("evaluation_scope")
            .is_some());
        assert!(decision_schema["properties"]
            .get("refit_slot_plan")
            .is_some());
    }

    #[test]
    fn selects_sklearn_demo_branch_and_merge_variants() {
        let candidates = vec![
            candidate("branch:b0.variant:pca10_ridge_a03", 0.41),
            candidate("branch:b0.variant:pca16_ridge_a12", 0.32),
            candidate("branch:b1.variant:rf_select_k28", 0.29),
            candidate("branch:b1.variant:rf_select_k40", 0.21),
            candidate("branch:b2.variant:poly_extra_k45", 0.38),
            candidate("branch:b2.variant:poly_extra_k80", 0.34),
        ];
        let groups = BTreeMap::from([
            (
                "branch:b0".to_string(),
                vec![
                    "branch:b0.variant:pca10_ridge_a03".to_string(),
                    "branch:b0.variant:pca16_ridge_a12".to_string(),
                ],
            ),
            (
                "branch:b1".to_string(),
                vec![
                    "branch:b1.variant:rf_select_k28".to_string(),
                    "branch:b1.variant:rf_select_k40".to_string(),
                ],
            ),
            (
                "branch:b2".to_string(),
                vec![
                    "branch:b2.variant:poly_extra_k45".to_string(),
                    "branch:b2.variant:poly_extra_k80".to_string(),
                ],
            ),
        ]);

        let decisions = select_candidate_groups(&rmse_policy(), &candidates, &groups).unwrap();
        assert_eq!(
            decisions["branch:b1"].selected_candidate_id,
            "branch:b1.variant:rf_select_k40"
        );

        let merge_candidates = vec![
            candidate("merge:m0.pred_meta.meta:ridge", 0.26),
            candidate("merge:m1.pred_meta_original.meta:ridge", 0.18),
        ];
        let merge_decision = select_candidate(&rmse_policy(), &merge_candidates).unwrap();
        assert_eq!(
            merge_decision.selected_candidate_id,
            "merge:m1.pred_meta_original.meta:ridge"
        );
    }
}
