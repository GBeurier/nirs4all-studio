use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use serde::{Deserialize, Serialize};

use crate::error::{DagMlError, Result};
use crate::ids::{ControllerId, FoldId, GroupId, NodeId, ObservationId, SampleId, TargetId};
use crate::oof::{PredictionBlock, PredictionPartition};
use crate::policy::{
    AggregationMethod, AggregationPolicy, AggregationWeights, PredictionLevel, ReductionAxis,
    ReductionMethod, ReductionPlan,
};
use crate::relation::{EntityUnitLevel, SampleRelationSet};

pub const AGGREGATION_CONTROLLER_TASK_SCHEMA_VERSION: u32 = 1;
pub const AGGREGATION_CONTROLLER_TASK_SCHEMA_ID: &str =
    "https://github.com/GBeurier/dag-ml/schemas/aggregation_controller_task.v1.schema.json";
pub const AGGREGATION_CONTROLLER_RESULT_SCHEMA_VERSION: u32 = 1;
pub const AGGREGATION_CONTROLLER_RESULT_SCHEMA_ID: &str =
    "https://github.com/GBeurier/dag-ml/schemas/aggregation_controller_result.v1.schema.json";
const DEFAULT_ROBUST_TRIM_FRACTION: f64 = 0.1;
/// Default Hotelling-T2 cutoff (in units of the T2 statistic) used by the native
/// `exclude_outliers` reducer when no explicit threshold is supplied. A repeated
/// prediction whose squared Mahalanobis distance from the per-unit centroid
/// exceeds this value is dropped before the surviving rows are averaged. The
/// value is the 0.975 quantile of a chi-square distribution with one degree of
/// freedom (~5.0239), a conventional single-target outlier gate.
const DEFAULT_HOTELLING_T2_THRESHOLD: f64 = 5.023_886;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ObservationPredictionBlock {
    #[serde(default)]
    pub prediction_id: Option<String>,
    pub producer_node: NodeId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub producer_port: Option<String>,
    pub partition: PredictionPartition,
    pub fold_id: Option<FoldId>,
    pub observation_ids: Vec<ObservationId>,
    pub values: Vec<Vec<f64>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub weights: Vec<f64>,
    #[serde(default)]
    pub target_names: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(
    rename_all = "snake_case",
    tag = "level",
    content = "id",
    deny_unknown_fields
)]
pub enum PredictionUnitId {
    Sample(SampleId),
    Target(TargetId),
    Group(GroupId),
}

impl PredictionUnitId {
    pub fn level(&self) -> PredictionLevel {
        match self {
            Self::Sample(_) => PredictionLevel::Sample,
            Self::Target(_) => PredictionLevel::Target,
            Self::Group(_) => PredictionLevel::Group,
        }
    }
}

impl fmt::Display for PredictionUnitId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Sample(id) => write!(f, "sample:{id}"),
            Self::Target(id) => write!(f, "target:{id}"),
            Self::Group(id) => write!(f, "group:{id}"),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AggregatedPredictionBlock {
    #[serde(default)]
    pub prediction_id: Option<String>,
    pub producer_node: NodeId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub producer_port: Option<String>,
    pub partition: PredictionPartition,
    pub fold_id: Option<FoldId>,
    pub level: PredictionLevel,
    pub unit_ids: Vec<PredictionUnitId>,
    pub values: Vec<Vec<f64>>,
    #[serde(default)]
    pub target_names: Vec<String>,
}

impl AggregatedPredictionBlock {
    pub fn validate_shape(&self) -> Result<usize> {
        if self.unit_ids.len() != self.values.len() {
            return Err(DagMlError::OofValidation(format!(
                "producer `{}` has {} aggregated unit ids but {} prediction rows",
                self.producer_node,
                self.unit_ids.len(),
                self.values.len()
            )));
        }
        if self
            .unit_ids
            .iter()
            .any(|unit_id| unit_id.level() != self.level)
        {
            return Err(DagMlError::OofValidation(format!(
                "producer `{}` emitted aggregated units outside level {:?}",
                self.producer_node, self.level
            )));
        }
        let unique = self.unit_ids.iter().collect::<BTreeSet<_>>();
        if unique.len() != self.unit_ids.len() {
            return Err(DagMlError::OofValidation(format!(
                "producer `{}` emitted duplicate aggregated unit ids",
                self.producer_node
            )));
        }
        let width = self.values.first().map_or(0, Vec::len);
        if width == 0 {
            return Err(DagMlError::OofValidation(format!(
                "producer `{}` emitted empty aggregated prediction rows",
                self.producer_node
            )));
        }
        if self.values.iter().any(|row| row.len() != width) {
            return Err(DagMlError::OofValidation(format!(
                "producer `{}` emitted ragged aggregated prediction rows",
                self.producer_node
            )));
        }
        if self.values.iter().flatten().any(|value| !value.is_finite()) {
            return Err(DagMlError::OofValidation(format!(
                "producer `{}` emitted non-finite aggregated prediction values",
                self.producer_node
            )));
        }
        if !self.target_names.is_empty() && self.target_names.len() != width {
            return Err(DagMlError::OofValidation(format!(
                "producer `{}` has {} aggregated target names for width {}",
                self.producer_node,
                self.target_names.len(),
                width
            )));
        }
        Ok(width)
    }
}

impl ObservationPredictionBlock {
    pub fn validate_shape(&self) -> Result<usize> {
        if self.observation_ids.len() != self.values.len() {
            return Err(DagMlError::OofValidation(format!(
                "producer `{}` has {} observation ids but {} prediction rows",
                self.producer_node,
                self.observation_ids.len(),
                self.values.len()
            )));
        }
        let width = self.values.first().map_or(0, Vec::len);
        if width == 0 {
            return Err(DagMlError::OofValidation(format!(
                "producer `{}` emitted empty observation prediction rows",
                self.producer_node
            )));
        }
        if self.values.iter().any(|row| row.len() != width) {
            return Err(DagMlError::OofValidation(format!(
                "producer `{}` emitted ragged observation prediction rows",
                self.producer_node
            )));
        }
        if self.values.iter().flatten().any(|value| !value.is_finite()) {
            return Err(DagMlError::OofValidation(format!(
                "producer `{}` emitted non-finite observation prediction values",
                self.producer_node
            )));
        }
        if !self.weights.is_empty() {
            if self.weights.len() != self.observation_ids.len() {
                return Err(DagMlError::OofValidation(format!(
                    "producer `{}` has {} observation weights but {} observation ids",
                    self.producer_node,
                    self.weights.len(),
                    self.observation_ids.len()
                )));
            }
            if self
                .weights
                .iter()
                .any(|weight| !weight.is_finite() || *weight < 0.0)
            {
                return Err(DagMlError::OofValidation(format!(
                    "producer `{}` emitted non-finite or negative observation weights",
                    self.producer_node
                )));
            }
        }
        if !self.target_names.is_empty() && self.target_names.len() != width {
            return Err(DagMlError::OofValidation(format!(
                "producer `{}` has {} target names for width {}",
                self.producer_node,
                self.target_names.len(),
                width
            )));
        }
        let unique = self.observation_ids.iter().collect::<BTreeSet<_>>();
        if unique.len() != self.observation_ids.len() {
            return Err(DagMlError::OofValidation(format!(
                "producer `{}` emitted duplicate observation predictions",
                self.producer_node
            )));
        }
        Ok(width)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AggregationControllerTask {
    #[serde(default = "default_aggregation_controller_task_schema_version")]
    pub schema_version: u32,
    pub task_id: String,
    pub controller_id: ControllerId,
    pub policy: AggregationPolicy,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reduction_plan: Option<ReductionPlan>,
    pub input: AggregationControllerInput,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "input_kind", rename_all = "snake_case")]
pub enum AggregationControllerInput {
    ObservationToSample {
        block: ObservationPredictionBlock,
        relations: SampleRelationSet,
        requested_sample_order: Vec<SampleId>,
    },
    SampleToUnit {
        block: PredictionBlock,
        relations: SampleRelationSet,
        requested_unit_order: Vec<PredictionUnitId>,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AggregationControllerResult {
    #[serde(default = "default_aggregation_controller_result_schema_version")]
    pub schema_version: u32,
    pub task_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reduction_plan: Option<ReductionPlan>,
    pub output: AggregationControllerOutput,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "output_kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum AggregationControllerOutput {
    Sample { block: PredictionBlock },
    Unit { block: AggregatedPredictionBlock },
}

impl AggregationControllerTask {
    pub fn validate(&self) -> Result<()> {
        if self.schema_version != AGGREGATION_CONTROLLER_TASK_SCHEMA_VERSION {
            return Err(DagMlError::OofValidation(format!(
                "aggregation controller task `{}` uses unsupported schema_version {}",
                self.task_id, self.schema_version
            )));
        }
        if self.task_id.trim().is_empty() {
            return Err(DagMlError::OofValidation(
                "aggregation controller task_id is empty".to_string(),
            ));
        }
        self.policy.validate()?;
        if self.policy.method != AggregationMethod::CustomController {
            return Err(DagMlError::OofValidation(format!(
                "aggregation controller task `{}` must use custom_controller method",
                self.task_id
            )));
        }
        let controller = self
            .policy
            .custom_controller
            .as_ref()
            .expect("custom_controller policy validation requires controller spec");
        if controller.controller_id != self.controller_id {
            return Err(DagMlError::OofValidation(format!(
                "aggregation controller task `{}` targets controller `{}` but policy targets `{}`",
                self.task_id, self.controller_id, controller.controller_id
            )));
        }
        if let Some(reduction_plan) = &self.reduction_plan {
            validate_aggregation_controller_reduction_plan(
                reduction_plan,
                &self.policy,
                &self.input,
            )?;
        }
        match &self.input {
            AggregationControllerInput::ObservationToSample {
                block,
                relations,
                requested_sample_order,
            } => validate_aggregation_controller_observation_input(
                block,
                relations,
                &self.policy,
                requested_sample_order,
            ),
            AggregationControllerInput::SampleToUnit {
                block,
                relations,
                requested_unit_order,
            } => validate_aggregation_controller_sample_input(
                block,
                relations,
                &self.policy,
                requested_unit_order,
            ),
        }
    }
}

impl AggregationControllerResult {
    pub fn validate_for_task(&self, task: &AggregationControllerTask) -> Result<()> {
        task.validate()?;
        if self.schema_version != AGGREGATION_CONTROLLER_RESULT_SCHEMA_VERSION {
            return Err(DagMlError::OofValidation(format!(
                "aggregation controller result `{}` uses unsupported schema_version {}",
                self.task_id, self.schema_version
            )));
        }
        if self.task_id != task.task_id {
            return Err(DagMlError::OofValidation(format!(
                "aggregation controller result task_id `{}` does not match task `{}`",
                self.task_id, task.task_id
            )));
        }
        validate_aggregation_controller_result_reduction_plan(task, self)?;
        match (&task.input, &self.output) {
            (
                AggregationControllerInput::ObservationToSample {
                    block: input_block,
                    requested_sample_order,
                    ..
                },
                AggregationControllerOutput::Sample { block },
            ) => validate_aggregation_controller_sample_output(
                input_block,
                requested_sample_order,
                block,
            ),
            (
                AggregationControllerInput::SampleToUnit {
                    block: input_block,
                    requested_unit_order,
                    ..
                },
                AggregationControllerOutput::Unit { block },
            ) => validate_aggregation_controller_unit_output(
                input_block,
                requested_unit_order,
                task.policy.aggregation_level,
                block,
            ),
            (AggregationControllerInput::ObservationToSample { .. }, _) => {
                Err(DagMlError::OofValidation(format!(
                    "aggregation controller result `{}` must return sample output for observation input",
                    self.task_id
                )))
            }
            (AggregationControllerInput::SampleToUnit { .. }, _) => {
                Err(DagMlError::OofValidation(format!(
                    "aggregation controller result `{}` must return unit output for sample input",
                    self.task_id
                )))
            }
        }
    }
}

fn validate_aggregation_controller_reduction_plan(
    plan: &ReductionPlan,
    policy: &AggregationPolicy,
    input: &AggregationControllerInput,
) -> Result<()> {
    plan.validate()
        .map_err(|error| DagMlError::OofValidation(error.to_string()))?;
    if plan.method != ReductionMethod::from(policy.method) {
        return Err(DagMlError::OofValidation(format!(
            "reduction plan method {:?} does not match aggregation policy method {:?}",
            plan.method, policy.method
        )));
    }
    if plan.weight_source != policy.weights {
        return Err(DagMlError::OofValidation(format!(
            "reduction plan weight_source {:?} does not match aggregation policy weights {:?}",
            plan.weight_source, policy.weights
        )));
    }
    if plan.method == ReductionMethod::Custom {
        let plan_controller = plan
            .custom_controller
            .as_ref()
            .expect("reduction plan validation requires custom controller");
        let policy_controller = policy
            .custom_controller
            .as_ref()
            .expect("aggregation policy validation requires custom controller");
        if plan_controller.controller_id != policy_controller.controller_id {
            return Err(DagMlError::OofValidation(format!(
                "reduction plan controller `{}` does not match aggregation policy controller `{}`",
                plan_controller.controller_id, policy_controller.controller_id
            )));
        }
    }
    if plan.axis != ReductionAxis::Unit {
        return Err(DagMlError::OofValidation(format!(
            "aggregation controller reduction plan axis {:?} is not supported for unit aggregation tasks",
            plan.axis
        )));
    }
    match input {
        AggregationControllerInput::ObservationToSample { .. } => {
            if !matches!(
                plan.input_unit_level,
                EntityUnitLevel::Observation | EntityUnitLevel::Combo
            ) {
                return Err(DagMlError::OofValidation(format!(
                    "observation aggregation reduction plan input_unit_level {:?} is invalid",
                    plan.input_unit_level
                )));
            }
            if plan.output_unit_level != EntityUnitLevel::PhysicalSample {
                return Err(DagMlError::OofValidation(format!(
                    "observation aggregation reduction plan output_unit_level {:?} must be physical_sample",
                    plan.output_unit_level
                )));
            }
            if policy.aggregation_level != PredictionLevel::Sample {
                return Err(DagMlError::OofValidation(format!(
                    "observation aggregation reduction plan must output sample predictions, got {:?}",
                    policy.aggregation_level
                )));
            }
        }
        AggregationControllerInput::SampleToUnit { .. } => {
            if plan.input_unit_level != EntityUnitLevel::PhysicalSample {
                return Err(DagMlError::OofValidation(format!(
                    "sample aggregation reduction plan input_unit_level {:?} must be physical_sample",
                    plan.input_unit_level
                )));
            }
            if plan.output_unit_level != EntityUnitLevel::PhysicalSample
                || policy.aggregation_level != PredictionLevel::Sample
            {
                return Err(DagMlError::OofValidation(
                    "sample aggregation reduction plans currently support only physical_sample output; target/group aggregation remains available without a ReductionPlan".to_string(),
                ));
            }
        }
    }
    Ok(())
}

fn validate_aggregation_controller_result_reduction_plan(
    task: &AggregationControllerTask,
    result: &AggregationControllerResult,
) -> Result<()> {
    match (&task.reduction_plan, &result.reduction_plan) {
        (Some(task_plan), Some(result_plan)) if task_plan == result_plan => Ok(()),
        (Some(_), Some(_)) => Err(DagMlError::OofValidation(format!(
            "aggregation controller result `{}` reduction_plan does not match task reduction_plan",
            result.task_id
        ))),
        (Some(_), None) => Err(DagMlError::OofValidation(format!(
            "aggregation controller result `{}` must echo task reduction_plan",
            result.task_id
        ))),
        (None, Some(_)) => Err(DagMlError::OofValidation(format!(
            "aggregation controller result `{}` declares reduction_plan but task does not",
            result.task_id
        ))),
        (None, None) => Ok(()),
    }
}

fn validate_aggregation_controller_observation_input(
    block: &ObservationPredictionBlock,
    relations: &SampleRelationSet,
    policy: &AggregationPolicy,
    requested_sample_order: &[SampleId],
) -> Result<()> {
    block.validate_shape()?;
    relations.validate()?;
    if policy.aggregation_level != PredictionLevel::Sample {
        return Err(DagMlError::OofValidation(format!(
            "observation aggregation controller task must output sample predictions, got {:?}",
            policy.aggregation_level
        )));
    }
    validate_unique_order(requested_sample_order, "requested_sample_order")?;
    if matches!(
        policy.weights,
        AggregationWeights::ControllerEmitted | AggregationWeights::Quality
    ) && block.weights.is_empty()
    {
        return Err(DagMlError::OofValidation(format!(
            "aggregation controller task with {:?} weights requires observation weights",
            policy.weights
        )));
    }
    let requested = requested_sample_order.iter().collect::<BTreeSet<_>>();
    let mut covered = BTreeSet::new();
    for observation_id in &block.observation_ids {
        let sample_id = relations
            .sample_for_observation(observation_id)
            .ok_or_else(|| {
                DagMlError::OofValidation(format!(
                    "observation prediction `{observation_id}` has no sample relation"
                ))
            })?;
        if !requested.contains(sample_id) {
            return Err(DagMlError::OofValidation(format!(
                "observation prediction `{observation_id}` maps to unexpected sample `{sample_id}`"
            )));
        }
        covered.insert(sample_id);
    }
    for sample_id in requested_sample_order {
        if !covered.contains(sample_id) {
            return Err(DagMlError::OofValidation(format!(
                "sample `{sample_id}` has no observation predictions for aggregation controller task"
            )));
        }
    }
    Ok(())
}

fn validate_aggregation_controller_sample_input(
    block: &PredictionBlock,
    relations: &SampleRelationSet,
    policy: &AggregationPolicy,
    requested_unit_order: &[PredictionUnitId],
) -> Result<()> {
    validate_sample_prediction_block(block)?;
    relations.validate()?;
    if policy.aggregation_level == PredictionLevel::Observation {
        return Err(DagMlError::OofValidation(
            "sample aggregation controller task cannot output observation-level predictions"
                .to_string(),
        ));
    }
    if matches!(
        policy.weights,
        AggregationWeights::ControllerEmitted | AggregationWeights::Quality
    ) {
        return Err(DagMlError::OofValidation(format!(
            "sample aggregation controller task cannot use {:?} weights without sample weights",
            policy.weights
        )));
    }
    validate_unique_order(requested_unit_order, "requested_unit_order")?;
    if requested_unit_order
        .iter()
        .any(|unit_id| unit_id.level() != policy.aggregation_level)
    {
        return Err(DagMlError::OofValidation(format!(
            "aggregation controller requested units do not match level {:?}",
            policy.aggregation_level
        )));
    }
    let requested = requested_unit_order.iter().collect::<BTreeSet<_>>();
    let mut covered = BTreeSet::new();
    for sample_id in &block.sample_ids {
        let unit_id = unit_for_sample(relations, policy.aggregation_level, sample_id)?;
        if !requested.contains(&unit_id) {
            return Err(DagMlError::OofValidation(format!(
                "sample prediction `{sample_id}` maps to unexpected aggregation unit `{unit_id}`"
            )));
        }
        covered.insert(unit_id);
    }
    for unit_id in requested_unit_order {
        if !covered.contains(unit_id) {
            return Err(DagMlError::OofValidation(format!(
                "aggregation unit `{unit_id}` has no sample predictions for aggregation controller task"
            )));
        }
    }
    Ok(())
}

fn validate_aggregation_controller_sample_output(
    input_block: &ObservationPredictionBlock,
    requested_sample_order: &[SampleId],
    block: &PredictionBlock,
) -> Result<()> {
    validate_sample_prediction_block(block)?;
    if block.producer_node != input_block.producer_node
        || block.partition != input_block.partition
        || block.fold_id != input_block.fold_id
    {
        return Err(DagMlError::OofValidation(format!(
            "aggregation controller sample output for `{}` does not preserve producer, partition and fold",
            input_block.producer_node
        )));
    }
    if block.target_names != input_block.target_names {
        return Err(DagMlError::OofValidation(format!(
            "aggregation controller sample output for `{}` does not preserve target names",
            input_block.producer_node
        )));
    }
    if block.sample_ids != requested_sample_order {
        return Err(DagMlError::OofValidation(format!(
            "aggregation controller sample output for `{}` does not match requested sample order",
            input_block.producer_node
        )));
    }
    Ok(())
}

fn validate_aggregation_controller_unit_output(
    input_block: &PredictionBlock,
    requested_unit_order: &[PredictionUnitId],
    expected_level: PredictionLevel,
    block: &AggregatedPredictionBlock,
) -> Result<()> {
    block.validate_shape()?;
    if block.producer_node != input_block.producer_node
        || block.partition != input_block.partition
        || block.fold_id != input_block.fold_id
    {
        return Err(DagMlError::OofValidation(format!(
            "aggregation controller unit output for `{}` does not preserve producer, partition and fold",
            input_block.producer_node
        )));
    }
    if block.target_names != input_block.target_names {
        return Err(DagMlError::OofValidation(format!(
            "aggregation controller unit output for `{}` does not preserve target names",
            input_block.producer_node
        )));
    }
    if block.level != expected_level {
        return Err(DagMlError::OofValidation(format!(
            "aggregation controller unit output for `{}` has level {:?}, expected {:?}",
            input_block.producer_node, block.level, expected_level
        )));
    }
    if block.unit_ids != requested_unit_order {
        return Err(DagMlError::OofValidation(format!(
            "aggregation controller unit output for `{}` does not match requested unit order",
            input_block.producer_node
        )));
    }
    Ok(())
}

fn validate_unique_order<T>(values: &[T], label: &str) -> Result<()>
where
    T: Ord,
{
    if values.is_empty() {
        return Err(DagMlError::OofValidation(format!(
            "aggregation controller {label} is empty"
        )));
    }
    let unique = values.iter().collect::<BTreeSet<_>>();
    if unique.len() != values.len() {
        return Err(DagMlError::OofValidation(format!(
            "aggregation controller {label} contains duplicates"
        )));
    }
    Ok(())
}

pub fn aggregate_observation_predictions(
    block: &ObservationPredictionBlock,
    relations: &SampleRelationSet,
    policy: &AggregationPolicy,
    requested_sample_order: &[SampleId],
) -> Result<PredictionBlock> {
    let width = block.validate_shape()?;
    relations.validate()?;
    policy.validate()?;
    if requested_sample_order.is_empty() {
        return Err(DagMlError::OofValidation(
            "aggregation requested_sample_order is empty".to_string(),
        ));
    }
    let requested = requested_sample_order.iter().collect::<BTreeSet<_>>();
    if requested.len() != requested_sample_order.len() {
        return Err(DagMlError::OofValidation(
            "aggregation requested_sample_order contains duplicates".to_string(),
        ));
    }
    if policy.aggregation_level != PredictionLevel::Sample {
        return Err(DagMlError::OofValidation(format!(
            "observation aggregation currently supports sample-level output, got {:?}",
            policy.aggregation_level
        )));
    }
    if policy.method == AggregationMethod::WeightedMean
        && policy.weights == AggregationWeights::None
    {
        return Err(DagMlError::OofValidation(
            "weighted_mean aggregation requires an explicit weights policy".to_string(),
        ));
    }
    if policy.method != AggregationMethod::WeightedMean
        && policy.weights != AggregationWeights::None
    {
        return Err(DagMlError::OofValidation(format!(
            "aggregation weights {:?} are only valid with weighted_mean",
            policy.weights
        )));
    }
    if !block.weights.is_empty() && policy.method != AggregationMethod::WeightedMean {
        return Err(DagMlError::OofValidation(format!(
            "producer `{}` supplied observation weights for non-weighted aggregation {:?}",
            block.producer_node, policy.method
        )));
    }

    let store_rows = matches!(
        policy.method,
        AggregationMethod::Median
            | AggregationMethod::Vote
            | AggregationMethod::RobustMean
            | AggregationMethod::ExcludeOutliers
    );
    let mut accumulators = requested_sample_order
        .iter()
        .cloned()
        .map(|sample_id| (sample_id, SampleAccumulator::new(width, store_rows)))
        .collect::<BTreeMap<_, _>>();

    for (row_idx, (observation_id, row)) in block
        .observation_ids
        .iter()
        .zip(block.values.iter())
        .enumerate()
    {
        let sample_id = relations
            .sample_for_observation(observation_id)
            .ok_or_else(|| {
                DagMlError::OofValidation(format!(
                    "observation prediction `{observation_id}` has no sample relation"
                ))
            })?;
        if !requested.contains(sample_id) {
            return Err(DagMlError::OofValidation(format!(
                "observation prediction `{observation_id}` maps to unexpected sample `{sample_id}`"
            )));
        }
        let accumulator = accumulators
            .get_mut(sample_id)
            .expect("requested sample accumulator exists");
        let weight = observation_weight(block, policy, row_idx)?;
        accumulator.push(row, weight);
    }

    let values = requested_sample_order
        .iter()
        .map(|sample_id| {
            let accumulator = accumulators
                .get(sample_id)
                .expect("requested sample accumulator exists");
            if accumulator.count == 0 {
                return Err(DagMlError::OofValidation(format!(
                    "sample `{sample_id}` has no observation predictions to aggregate"
                )));
            }
            match policy.method {
                AggregationMethod::Mean => Ok(accumulator.mean()),
                AggregationMethod::WeightedMean => accumulator.weighted_mean(&sample_id.to_string()),
                AggregationMethod::Median => Ok(accumulator.median()),
                AggregationMethod::Vote => Ok(accumulator.vote()),
                AggregationMethod::RobustMean => {
                    Ok(accumulator.robust_mean(DEFAULT_ROBUST_TRIM_FRACTION))
                }
                AggregationMethod::ExcludeOutliers => {
                    accumulator.hotelling_t2_exclude_mean(DEFAULT_HOTELLING_T2_THRESHOLD)
                }
                AggregationMethod::None => {
                    if accumulator.count == 1 {
                        Ok(accumulator
                            .first_row
                            .clone()
                            .expect("single prediction accumulator stores first row"))
                    } else {
                        Err(DagMlError::OofValidation(format!(
                            "sample `{sample_id}` has {} observation predictions but aggregation method is none",
                            accumulator.count
                        )))
                    }
                }
                AggregationMethod::CustomController => Err(DagMlError::OofValidation(format!(
                    "aggregation method {:?} is delegated to an aggregation controller",
                    policy.method
                ))),
            }
        })
        .collect::<Result<Vec<Vec<f64>>>>()?;

    Ok(PredictionBlock {
        prediction_id: block
            .prediction_id
            .as_ref()
            .map(|prediction_id| format!("{prediction_id}:sample_agg")),
        producer_node: block.producer_node.clone(),
        producer_port: block.producer_port.clone(),
        partition: block.partition.clone(),
        fold_id: block.fold_id.clone(),
        sample_ids: requested_sample_order.to_vec(),
        values,
        target_names: block.target_names.clone(),
    })
}

pub fn aggregate_sample_predictions_by_unit(
    block: &PredictionBlock,
    relations: &SampleRelationSet,
    policy: &AggregationPolicy,
    requested_unit_order: &[PredictionUnitId],
) -> Result<AggregatedPredictionBlock> {
    let width = validate_sample_prediction_block(block)?;
    relations.validate()?;
    policy.validate()?;
    if requested_unit_order.is_empty() {
        return Err(DagMlError::OofValidation(
            "aggregation requested_unit_order is empty".to_string(),
        ));
    }
    let requested_level = policy.aggregation_level;
    if requested_level == PredictionLevel::Observation {
        return Err(DagMlError::OofValidation(
            "sample prediction aggregation cannot output observation-level predictions".to_string(),
        ));
    }
    if requested_unit_order
        .iter()
        .any(|unit_id| unit_id.level() != requested_level)
    {
        return Err(DagMlError::OofValidation(format!(
            "aggregation requested units do not match level {:?}",
            requested_level
        )));
    }
    let requested = requested_unit_order.iter().collect::<BTreeSet<_>>();
    if requested.len() != requested_unit_order.len() {
        return Err(DagMlError::OofValidation(
            "aggregation requested_unit_order contains duplicates".to_string(),
        ));
    }

    let by_sample = block
        .sample_ids
        .iter()
        .cloned()
        .zip(block.values.iter().cloned())
        .collect::<BTreeMap<_, _>>();
    if requested_level == PredictionLevel::Sample {
        let values = requested_unit_order
            .iter()
            .map(|unit_id| {
                let PredictionUnitId::Sample(sample_id) = unit_id else {
                    unreachable!("requested unit level already validated");
                };
                by_sample.get(sample_id).cloned().ok_or_else(|| {
                    DagMlError::OofValidation(format!(
                        "sample prediction block for `{}` is missing requested sample `{sample_id}`",
                        block.producer_node
                    ))
                })
            })
            .collect::<Result<Vec<_>>>()?;
        if by_sample.len() != requested_unit_order.len() {
            return Err(DagMlError::OofValidation(format!(
                "sample prediction block for `{}` contains samples outside requested sample order",
                block.producer_node
            )));
        }
        let aggregated = AggregatedPredictionBlock {
            prediction_id: block.prediction_id.clone(),
            producer_node: block.producer_node.clone(),
            producer_port: None,
            partition: block.partition.clone(),
            fold_id: block.fold_id.clone(),
            level: PredictionLevel::Sample,
            unit_ids: requested_unit_order.to_vec(),
            values,
            target_names: block.target_names.clone(),
        };
        aggregated.validate_shape()?;
        return Ok(aggregated);
    }

    if policy.method == AggregationMethod::WeightedMean
        && matches!(
            policy.weights,
            AggregationWeights::ControllerEmitted | AggregationWeights::Quality
        )
    {
        return Err(DagMlError::OofValidation(format!(
            "sample-to-{:?} weighted_mean cannot use {:?} weights without sample-level weights",
            requested_level, policy.weights
        )));
    }

    let store_rows = matches!(
        policy.method,
        AggregationMethod::Median
            | AggregationMethod::Vote
            | AggregationMethod::RobustMean
            | AggregationMethod::ExcludeOutliers
    );
    let mut accumulators = requested_unit_order
        .iter()
        .cloned()
        .map(|unit_id| (unit_id, SampleAccumulator::new(width, store_rows)))
        .collect::<BTreeMap<_, _>>();

    for (sample_id, row) in block.sample_ids.iter().zip(block.values.iter()) {
        let unit_id = unit_for_sample(relations, requested_level, sample_id)?;
        if !requested.contains(&unit_id) {
            return Err(DagMlError::OofValidation(format!(
                "sample prediction `{sample_id}` maps to unexpected aggregation unit `{unit_id}`"
            )));
        }
        let weight = sample_weight(relations, policy, sample_id)?;
        accumulators
            .get_mut(&unit_id)
            .expect("requested aggregation unit accumulator exists")
            .push(row, weight);
    }

    let values = requested_unit_order
        .iter()
        .map(|unit_id| {
            let accumulator = accumulators
                .get(unit_id)
                .expect("requested aggregation unit accumulator exists");
            if accumulator.count == 0 {
                return Err(DagMlError::OofValidation(format!(
                    "aggregation unit `{unit_id}` has no sample predictions to aggregate"
                )));
            }
            match policy.method {
                AggregationMethod::Mean => Ok(accumulator.mean()),
                AggregationMethod::WeightedMean => accumulator.weighted_mean(&unit_id.to_string()),
                AggregationMethod::Median => Ok(accumulator.median()),
                AggregationMethod::Vote => Ok(accumulator.vote()),
                AggregationMethod::RobustMean => {
                    Ok(accumulator.robust_mean(DEFAULT_ROBUST_TRIM_FRACTION))
                }
                AggregationMethod::ExcludeOutliers => {
                    accumulator.hotelling_t2_exclude_mean(DEFAULT_HOTELLING_T2_THRESHOLD)
                }
                AggregationMethod::None => {
                    if accumulator.count == 1 {
                        Ok(accumulator
                            .first_row
                            .clone()
                            .expect("single prediction accumulator stores first row"))
                    } else {
                        Err(DagMlError::OofValidation(format!(
                            "aggregation unit `{unit_id}` has {} sample predictions but aggregation method is none",
                            accumulator.count
                        )))
                    }
                }
                AggregationMethod::CustomController => Err(DagMlError::OofValidation(format!(
                    "aggregation method {:?} is delegated to an aggregation controller",
                    policy.method
                ))),
            }
        })
        .collect::<Result<Vec<_>>>()?;

    let suffix = match requested_level {
        PredictionLevel::Target => "target_agg",
        PredictionLevel::Group => "group_agg",
        PredictionLevel::Sample => "sample_agg",
        PredictionLevel::Observation => unreachable!("observation output rejected above"),
    };
    let aggregated = AggregatedPredictionBlock {
        prediction_id: block
            .prediction_id
            .as_ref()
            .map(|prediction_id| format!("{prediction_id}:{suffix}")),
        producer_node: block.producer_node.clone(),
        producer_port: None,
        partition: block.partition.clone(),
        fold_id: block.fold_id.clone(),
        level: requested_level,
        unit_ids: requested_unit_order.to_vec(),
        values,
        target_names: block.target_names.clone(),
    };
    aggregated.validate_shape()?;
    Ok(aggregated)
}

fn validate_sample_prediction_block(block: &PredictionBlock) -> Result<usize> {
    block.validate_content()
}

fn unit_for_sample(
    relations: &SampleRelationSet,
    level: PredictionLevel,
    sample_id: &SampleId,
) -> Result<PredictionUnitId> {
    match level {
        PredictionLevel::Sample => Ok(PredictionUnitId::Sample(sample_id.clone())),
        PredictionLevel::Target => relations
            .target_for_sample(sample_id)
            .cloned()
            .map(PredictionUnitId::Target)
            .ok_or_else(|| {
                DagMlError::OofValidation(format!(
                    "sample `{sample_id}` is missing target id for target aggregation"
                ))
            }),
        PredictionLevel::Group => relations
            .group_for_sample(sample_id)
            .cloned()
            .map(PredictionUnitId::Group)
            .ok_or_else(|| {
                DagMlError::OofValidation(format!(
                    "sample `{sample_id}` is missing group id for group aggregation"
                ))
            }),
        PredictionLevel::Observation => Err(DagMlError::OofValidation(
            "sample prediction aggregation cannot output observation-level predictions".to_string(),
        )),
    }
}

fn sample_weight(
    relations: &SampleRelationSet,
    policy: &AggregationPolicy,
    sample_id: &SampleId,
) -> Result<f64> {
    if policy.method != AggregationMethod::WeightedMean {
        return Ok(1.0);
    }
    match policy.weights {
        AggregationWeights::RepetitionCount => {
            let count = relations.observation_count_for_sample(sample_id);
            if count == 0 {
                return Err(DagMlError::OofValidation(format!(
                    "sample `{sample_id}` has no observation relations for repetition_count weights"
                )));
            }
            Ok(count as f64)
        }
        AggregationWeights::ControllerEmitted | AggregationWeights::Quality => {
            Err(DagMlError::OofValidation(format!(
                "sample-level {:?} weights are not present in PredictionBlock",
                policy.weights
            )))
        }
        AggregationWeights::None => Err(DagMlError::OofValidation(
            "weighted_mean aggregation requires an explicit weights policy".to_string(),
        )),
    }
}

#[derive(Clone, Debug)]
struct SampleAccumulator {
    sum: Vec<f64>,
    weighted_sum: Vec<f64>,
    weight_sum: f64,
    rows: Vec<Vec<f64>>,
    first_row: Option<Vec<f64>>,
    store_rows: bool,
    count: usize,
}

impl SampleAccumulator {
    fn new(width: usize, store_rows: bool) -> Self {
        Self {
            sum: vec![0.0; width],
            weighted_sum: vec![0.0; width],
            weight_sum: 0.0,
            rows: Vec::new(),
            first_row: None,
            store_rows,
            count: 0,
        }
    }

    fn push(&mut self, row: &[f64], weight: f64) {
        for (idx, value) in row.iter().enumerate() {
            self.sum[idx] += *value;
            self.weighted_sum[idx] += *value * weight;
        }
        self.weight_sum += weight;
        if self.first_row.is_none() {
            self.first_row = Some(row.to_vec());
        }
        if self.store_rows {
            self.rows.push(row.to_vec());
        }
        self.count += 1;
    }

    fn mean(&self) -> Vec<f64> {
        self.sum
            .iter()
            .map(|value| *value / self.count as f64)
            .collect()
    }

    fn weighted_mean(&self, unit_label: &str) -> Result<Vec<f64>> {
        if self.weight_sum <= 0.0 {
            return Err(DagMlError::OofValidation(format!(
                "aggregation unit `{unit_label}` has zero total prediction weight"
            )));
        }
        Ok(self
            .weighted_sum
            .iter()
            .map(|value| *value / self.weight_sum)
            .collect())
    }

    fn median(&self) -> Vec<f64> {
        let width = self.sum.len();
        (0..width)
            .map(|column_idx| {
                let mut column = self
                    .rows
                    .iter()
                    .map(|row| row[column_idx])
                    .collect::<Vec<_>>();
                column.sort_by(f64::total_cmp);
                let middle = column.len() / 2;
                if column.len() % 2 == 1 {
                    column[middle]
                } else {
                    (column[middle - 1] + column[middle]) / 2.0
                }
            })
            .collect()
    }

    fn vote(&self) -> Vec<f64> {
        let width = self.sum.len();
        (0..width)
            .map(|column_idx| {
                let mut column = self
                    .rows
                    .iter()
                    .map(|row| row[column_idx])
                    .collect::<Vec<_>>();
                column.sort_by(f64::total_cmp);
                mode_sorted(&column)
            })
            .collect()
    }

    fn robust_mean(&self, trim_fraction: f64) -> Vec<f64> {
        let width = self.sum.len();
        (0..width)
            .map(|column_idx| {
                let mut column = self
                    .rows
                    .iter()
                    .map(|row| row[column_idx])
                    .collect::<Vec<_>>();
                column.sort_by(f64::total_cmp);
                let trim_count = ((column.len() as f64) * trim_fraction).floor() as usize;
                let max_trim = column.len().saturating_sub(1) / 2;
                let trim_count = trim_count.min(max_trim);
                let kept = &column[trim_count..column.len() - trim_count];
                kept.iter().sum::<f64>() / kept.len() as f64
            })
            .collect()
    }

    /// Hotelling-T2 robust mean: drop each stored row whose squared Mahalanobis
    /// distance from the per-unit centroid exceeds `threshold`, then average the
    /// survivors. To avoid an outlier masking itself by inflating the spread it
    /// is measured against, each row's T2 is computed leave-one-out: against the
    /// centroid and (population) variance of every *other* row —
    /// `T2_i = sum_c (x_ic - mean_{-i,c})^2 / var_{-i,c}`. A column whose
    /// leave-one-out variance is (near) zero contributes nothing, so a constant
    /// target never spuriously flags rows. With fewer than three rows there is
    /// no robust spread to gate on, so all rows are kept (mean-of-rows). If
    /// every row is flagged, the unfiltered mean is returned rather than
    /// producing an empty aggregate.
    fn hotelling_t2_exclude_mean(&self, threshold: f64) -> Result<Vec<f64>> {
        let width = self.sum.len();
        if self.count == 0 {
            return Err(DagMlError::OofValidation(
                "exclude_outliers aggregation requires at least one prediction".to_string(),
            ));
        }
        let plain_mean = self.mean();
        if self.count < 3 {
            return Ok(plain_mean);
        }
        let others = (self.count - 1) as f64;
        let kept = self
            .rows
            .iter()
            .enumerate()
            .filter(|(skip_idx, _)| {
                let t2 = (0..width)
                    .map(|column_idx| {
                        let mean_others =
                            (self.sum[column_idx] - self.rows[*skip_idx][column_idx]) / others;
                        let var_others = self
                            .rows
                            .iter()
                            .enumerate()
                            .filter(|(other_idx, _)| other_idx != skip_idx)
                            .map(|(_, other)| {
                                let delta = other[column_idx] - mean_others;
                                delta * delta
                            })
                            .sum::<f64>()
                            / others;
                        if var_others <= f64::EPSILON {
                            0.0
                        } else {
                            let delta = self.rows[*skip_idx][column_idx] - mean_others;
                            delta * delta / var_others
                        }
                    })
                    .sum::<f64>();
                t2 <= threshold
            })
            .map(|(_, row)| row)
            .collect::<Vec<_>>();
        if kept.is_empty() {
            return Ok(plain_mean);
        }
        let kept_count = kept.len() as f64;
        Ok((0..width)
            .map(|column_idx| kept.iter().map(|row| row[column_idx]).sum::<f64>() / kept_count)
            .collect())
    }
}

fn observation_weight(
    block: &ObservationPredictionBlock,
    policy: &AggregationPolicy,
    row_idx: usize,
) -> Result<f64> {
    if policy.method != AggregationMethod::WeightedMean {
        return Ok(1.0);
    }
    match policy.weights {
        AggregationWeights::ControllerEmitted | AggregationWeights::Quality => block
            .weights
            .get(row_idx)
            .copied()
            .ok_or_else(|| {
                DagMlError::OofValidation(format!(
                    "weighted_mean aggregation with {:?} weights requires one weight per observation",
                    policy.weights
                ))
            }),
        AggregationWeights::RepetitionCount => Ok(1.0),
        AggregationWeights::None => Err(DagMlError::OofValidation(
            "weighted_mean aggregation requires an explicit weights policy".to_string(),
        )),
    }
}

fn mode_sorted(values: &[f64]) -> f64 {
    let mut best_value = values[0];
    let mut best_count = 1usize;
    let mut current_value = values[0];
    let mut current_count = 1usize;
    for value in values.iter().skip(1) {
        if *value == current_value {
            current_count += 1;
            continue;
        }
        if current_count > best_count {
            best_value = current_value;
            best_count = current_count;
        }
        current_value = *value;
        current_count = 1;
    }
    if current_count > best_count {
        current_value
    } else {
        best_value
    }
}

fn default_aggregation_controller_task_schema_version() -> u32 {
    AGGREGATION_CONTROLLER_TASK_SCHEMA_VERSION
}

fn default_aggregation_controller_result_schema_version() -> u32 {
    AGGREGATION_CONTROLLER_RESULT_SCHEMA_VERSION
}

/// Reduce per-fold prediction blocks (same producer + partition) into one block, keyed by
/// `sample_id` — the native cross-fold ensemble dag-ml previously lacked. A sample that appears in
/// exactly one fold (the disjoint OOF/validation case) passes through unchanged (mean-of-one); a
/// sample predicted by several folds (the shared train/test case) is (weighted) averaged. `avg` =
/// no weights; `w_avg` = per-fold weights (e.g. `1/shifted_val_rmse`). First-seen sample order is
/// preserved; the join is identity-keyed, never positional.
pub fn reduce_predictions_across_folds(
    blocks: &[PredictionBlock],
    weights: Option<&[f64]>,
    fold_label: &str,
) -> Result<PredictionBlock> {
    let first = blocks.first().ok_or_else(|| {
        DagMlError::OofValidation("cross-fold reduction needs at least one block".to_string())
    })?;
    if let Some(weights) = weights {
        if weights.len() != blocks.len() {
            return Err(DagMlError::OofValidation(format!(
                "cross-fold weights ({}) must match block count ({})",
                weights.len(),
                blocks.len()
            )));
        }
    }
    let width = first.values.first().map_or(0, Vec::len);
    if width == 0 {
        return Err(DagMlError::OofValidation(
            "cross-fold reduction: first block has empty prediction rows".to_string(),
        ));
    }
    let mut order: Vec<SampleId> = Vec::new();
    let mut index: BTreeMap<SampleId, usize> = BTreeMap::new();
    let mut weighted_sums: Vec<Vec<f64>> = Vec::new();
    let mut weight_totals: Vec<f64> = Vec::new();
    for (position, block) in blocks.iter().enumerate() {
        if block.producer_node != first.producer_node || block.partition != first.partition {
            return Err(DagMlError::OofValidation(
                "cross-fold reduction: blocks differ in producer or partition".to_string(),
            ));
        }
        // Mandatory content gate: finite values + no within-block (within-fold) duplicate
        // sample. Accumulation below is per (sample, fold); a within-fold duplicate would be
        // averaged in twice (a double-count) and a NaN/Inf would poison the fused mean.
        block.validate_content()?;
        let weight = weights.map_or(1.0, |weights| weights[position]);
        if !weight.is_finite() || weight < 0.0 {
            return Err(DagMlError::OofValidation(
                "cross-fold reduction: weights must be finite and non-negative".to_string(),
            ));
        }
        for (sample_id, row) in block.sample_ids.iter().zip(&block.values) {
            if row.len() != width {
                return Err(DagMlError::OofValidation(
                    "cross-fold reduction: ragged prediction width".to_string(),
                ));
            }
            let slot = *index.entry(sample_id.clone()).or_insert_with(|| {
                order.push(sample_id.clone());
                weighted_sums.push(vec![0.0; width]);
                weight_totals.push(0.0);
                order.len() - 1
            });
            for (acc, value) in weighted_sums[slot].iter_mut().zip(row) {
                *acc += value * weight;
            }
            weight_totals[slot] += weight;
        }
    }
    let mut values = Vec::with_capacity(order.len());
    for slot in 0..order.len() {
        let total = weight_totals[slot];
        if total <= 0.0 {
            return Err(DagMlError::OofValidation(
                "cross-fold reduction: a sample had zero total weight".to_string(),
            ));
        }
        values.push(weighted_sums[slot].iter().map(|sum| sum / total).collect());
    }
    Ok(PredictionBlock {
        prediction_id: None,
        producer_node: first.producer_node.clone(),
        producer_port: first.producer_port.clone(),
        partition: first.partition.clone(),
        fold_id: Some(FoldId::new(fold_label)?),
        sample_ids: order,
        values,
        target_names: first.target_names.clone(),
    })
}

/// Reduce one prediction block per branch (each from a *different* producer/model) into a single
/// fused block under `merge_node`, keyed by `sample_id`. This is the cross-*branch* analogue of
/// [`reduce_predictions_across_folds`]: where that joins folds of one producer, this joins branches
/// of one merge point. Asymmetric-branch fusion is intrinsic — a *modelless* branch simply emits no
/// `PredictionBlock`, so it is absent from `branch_blocks` and contributes nothing. A sample is
/// averaged over exactly the model-bearing branches that predicted it (its branch coverage), never
/// over a fixed denominator, so partial coverage does not silently down-weight a sample. The join is
/// identity-keyed and the union sample order is first-seen; positional joins are never used.
///
/// `weights` (when present) are per-branch ensemble weights aligned to `branch_blocks` and applied
/// only to the branches that cover each sample. All blocks must share `partition`, prediction width
/// and `target_names`; differing producers are expected and preserved only through `merge_node`.
pub fn reduce_predictions_across_branches(
    branch_blocks: &[PredictionBlock],
    weights: Option<&[f64]>,
    merge_node: &NodeId,
) -> Result<PredictionBlock> {
    let first = branch_blocks.first().ok_or_else(|| {
        DagMlError::OofValidation(
            "cross-branch reduction needs at least one model-bearing branch".to_string(),
        )
    })?;
    if let Some(weights) = weights {
        if weights.len() != branch_blocks.len() {
            return Err(DagMlError::OofValidation(format!(
                "cross-branch weights ({}) must match model-bearing branch count ({})",
                weights.len(),
                branch_blocks.len()
            )));
        }
    }
    let width = first.validate_shape()?;
    let mut order: Vec<SampleId> = Vec::new();
    let mut index: BTreeMap<SampleId, usize> = BTreeMap::new();
    let mut weighted_sums: Vec<Vec<f64>> = Vec::new();
    let mut weight_totals: Vec<f64> = Vec::new();
    for (position, block) in branch_blocks.iter().enumerate() {
        if block.partition != first.partition {
            return Err(DagMlError::OofValidation(
                "cross-branch reduction: branches differ in partition".to_string(),
            ));
        }
        if block.target_names != first.target_names {
            return Err(DagMlError::OofValidation(
                "cross-branch reduction: branches differ in target names".to_string(),
            ));
        }
        // Mandatory content gate: finite values + no within-branch duplicate sample. Fusion
        // accumulates per (sample, branch), so a within-branch duplicate would be averaged in
        // twice (a double-count) and skew the mean — the cross-branch analogue of concat's
        // overlap rejection — and a NaN/Inf would poison the fused mean.
        block.validate_content()?;
        let weight = weights.map_or(1.0, |weights| weights[position]);
        if !weight.is_finite() || weight < 0.0 {
            return Err(DagMlError::OofValidation(
                "cross-branch reduction: weights must be finite and non-negative".to_string(),
            ));
        }
        for (sample_id, row) in block.sample_ids.iter().zip(&block.values) {
            if row.len() != width {
                return Err(DagMlError::OofValidation(
                    "cross-branch reduction: branches differ in prediction width".to_string(),
                ));
            }
            let slot = *index.entry(sample_id.clone()).or_insert_with(|| {
                order.push(sample_id.clone());
                weighted_sums.push(vec![0.0; width]);
                weight_totals.push(0.0);
                order.len() - 1
            });
            for (acc, value) in weighted_sums[slot].iter_mut().zip(row) {
                *acc += value * weight;
            }
            weight_totals[slot] += weight;
        }
    }
    let mut values = Vec::with_capacity(order.len());
    for slot in 0..order.len() {
        let total = weight_totals[slot];
        if total <= 0.0 {
            return Err(DagMlError::OofValidation(
                "cross-branch reduction: a sample had zero total branch weight".to_string(),
            ));
        }
        values.push(weighted_sums[slot].iter().map(|sum| sum / total).collect());
    }
    Ok(PredictionBlock {
        prediction_id: None,
        producer_node: merge_node.clone(),
        producer_port: None,
        partition: first.partition.clone(),
        fold_id: first.fold_id.clone(),
        sample_ids: order,
        values,
        target_names: first.target_names.clone(),
    })
}

/// Probability-mean fusion for classification: average per-class probability rows across branches,
/// keyed by `sample_id`, under `merge_node`. Each row of every branch block is treated as a
/// probability vector over the same `width` classes; rows must be finite, non-negative and sum to
/// 1 (within `PROBA_SUM_TOLERANCE`). Like [`reduce_predictions_across_branches`] this is
/// asymmetric-branch safe — modelless branches contribute no block — and each sample is averaged
/// only over the branches that predicted it. The fused rows are renormalized so each output row is
/// itself a valid probability distribution (it already sums to 1 under equal per-branch weight, but
/// renormalization keeps the contract exact under floating-point and partial coverage).
pub fn reduce_proba_mean_across_branches(
    branch_blocks: &[PredictionBlock],
    merge_node: &NodeId,
) -> Result<PredictionBlock> {
    if branch_blocks.is_empty() {
        return Err(DagMlError::OofValidation(
            "proba-mean fusion needs at least one model-bearing branch".to_string(),
        ));
    }
    for block in branch_blocks {
        // Mandatory content gate before the probability checks below: a NaN/Inf would pass the
        // `< 0.0` and `sum != 1` comparisons silently (NaN compares false), so the per-row
        // probability validation alone cannot reject it — `validate_content` rejects it here.
        let width = block.validate_content()?;
        if width < 2 {
            return Err(DagMlError::OofValidation(format!(
                "proba-mean fusion: branch `{}` has width {width}, classification probabilities need at least 2 classes",
                block.producer_node
            )));
        }
        for (sample_id, row) in block.sample_ids.iter().zip(&block.values) {
            if row.iter().any(|value| *value < 0.0) {
                return Err(DagMlError::OofValidation(format!(
                    "proba-mean fusion: branch `{}` sample `{sample_id}` has a negative class probability",
                    block.producer_node
                )));
            }
            let sum = row.iter().sum::<f64>();
            if (sum - 1.0).abs() > PROBA_SUM_TOLERANCE {
                return Err(DagMlError::OofValidation(format!(
                    "proba-mean fusion: branch `{}` sample `{sample_id}` probabilities sum to {sum}, not 1",
                    block.producer_node
                )));
            }
        }
    }
    let fused = reduce_predictions_across_branches(branch_blocks, None, merge_node)?;
    let values = fused
        .values
        .into_iter()
        .map(|row| {
            let sum = row.iter().sum::<f64>();
            if sum <= 0.0 {
                return Err(DagMlError::OofValidation(
                    "proba-mean fusion: a fused sample has zero total probability".to_string(),
                ));
            }
            Ok(row.iter().map(|value| value / sum).collect::<Vec<f64>>())
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(PredictionBlock { values, ..fused })
}

/// Tolerance on the per-row probability-sum check in [`reduce_proba_mean_across_branches`].
const PROBA_SUM_TOLERANCE: f64 = 1e-6;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ids::{ControllerId, GroupId, TargetId};
    use crate::relation::SampleRelation;

    fn sid(value: &str) -> SampleId {
        SampleId::new(value).unwrap()
    }

    fn oid(value: &str) -> ObservationId {
        ObservationId::new(value).unwrap()
    }

    fn relation(observation: &str, sample: &str) -> SampleRelation {
        let mut relation = SampleRelation::new(oid(observation), sid(sample));
        relation.target_id = Some(TargetId::new(format!("target:{sample}")).unwrap());
        relation
    }

    fn relation_with_units(
        observation: &str,
        sample: &str,
        target: &str,
        group: &str,
    ) -> SampleRelation {
        let mut relation = SampleRelation::new(oid(observation), sid(sample));
        relation.target_id = Some(TargetId::new(target).unwrap());
        relation.group_id = Some(GroupId::new(group).unwrap());
        relation
    }

    fn combo_relation(observation: &str, sample: &str, components: &[&str]) -> SampleRelation {
        let mut relation = SampleRelation::new(oid(observation), sid(sample));
        relation.unit_level = EntityUnitLevel::Combo;
        relation.derived_unit_id = Some(format!("combo:{observation}"));
        relation.component_observation_ids =
            components.iter().map(|component| oid(component)).collect();
        relation
    }

    fn custom_policy(level: PredictionLevel) -> AggregationPolicy {
        AggregationPolicy {
            aggregation_level: level,
            method: AggregationMethod::CustomController,
            custom_controller: Some(crate::policy::AggregationControllerSpec {
                controller_id: ControllerId::new("controller:agg.trimmed").unwrap(),
                params: serde_json::json!({ "trim_fraction": 0.1 }),
            }),
            ..AggregationPolicy::default()
        }
    }

    #[test]
    fn aggregation_controller_result_and_output_are_closed_in_serde_and_schema() {
        let document = serde_json::json!({
            "schema_version": AGGREGATION_CONTROLLER_RESULT_SCHEMA_VERSION,
            "task_id": "aggregation:strict",
            "output": {
                "output_kind": "sample",
                "block": {
                    "prediction_id": null,
                    "producer_node": "model:strict",
                    "partition": "validation",
                    "fold_id": "fold:0",
                    "sample_ids": ["sample:1"],
                    "values": [[1.0]],
                    "target_names": ["y"]
                }
            }
        });
        serde_json::from_value::<AggregationControllerResult>(document.clone())
            .expect("valid aggregation controller result decodes");

        for (label, pointer) in [("result", ""), ("output", "/output")] {
            let mut tampered = document.clone();
            tampered
                .pointer_mut(pointer)
                .unwrap()
                .as_object_mut()
                .unwrap()
                .insert(
                    "unexpected_contract_field".to_string(),
                    serde_json::json!(true),
                );
            let error = serde_json::from_value::<AggregationControllerResult>(tampered)
                .expect_err("unknown aggregation contract field must be rejected");
            assert!(
                error.to_string().contains("unexpected_contract_field"),
                "{label} returned an unexpected error: {error}"
            );
        }

        #[cfg(dag_ml_workspace_contract_fixtures)]
        {
            let schema: serde_json::Value = serde_json::from_str(include_str!(
                "../../../docs/contracts/aggregation_controller_result.schema.json"
            ))
            .unwrap();
            assert_eq!(schema["additionalProperties"].as_bool(), Some(false));
            for definition in ["sample_output", "unit_output"] {
                assert_eq!(
                    schema["$defs"][definition]["additionalProperties"].as_bool(),
                    Some(false),
                    "aggregation schema definition `{definition}` must be closed"
                );
            }
        }
    }

    #[test]
    fn validates_custom_observation_aggregation_controller_result() {
        let reduction_plan = ReductionPlan {
            role: crate::policy::ReductionRole::FinalOutput,
            axis: ReductionAxis::Unit,
            input_unit_level: EntityUnitLevel::Observation,
            output_unit_level: EntityUnitLevel::PhysicalSample,
            method: ReductionMethod::Custom,
            custom_controller: Some(crate::policy::AggregationControllerSpec {
                controller_id: ControllerId::new("controller:agg.trimmed").unwrap(),
                params: serde_json::json!({ "trim_fraction": 0.1 }),
            }),
            ..ReductionPlan::default()
        };
        let task = AggregationControllerTask {
            schema_version: AGGREGATION_CONTROLLER_TASK_SCHEMA_VERSION,
            task_id: "agg-task:obs.sample.fold0".to_string(),
            controller_id: ControllerId::new("controller:agg.trimmed").unwrap(),
            policy: custom_policy(PredictionLevel::Sample),
            reduction_plan: Some(reduction_plan.clone()),
            input: AggregationControllerInput::ObservationToSample {
                block: ObservationPredictionBlock {
                    prediction_id: Some("prediction:model.fold0".to_string()),
                    producer_node: NodeId::new("model:pls").unwrap(),
                    producer_port: None,
                    partition: PredictionPartition::Validation,
                    fold_id: Some(FoldId::new("fold:0").unwrap()),
                    observation_ids: vec![oid("obs:1"), oid("obs:2"), oid("obs:3")],
                    values: vec![vec![1.0, 2.0], vec![3.0, 4.0], vec![9.0, 10.0]],
                    weights: Vec::new(),
                    target_names: vec!["moisture".to_string(), "protein".to_string()],
                },
                relations: SampleRelationSet {
                    records: vec![
                        relation("obs:1", "sample:1"),
                        relation("obs:2", "sample:1"),
                        relation("obs:3", "sample:2"),
                    ],
                },
                requested_sample_order: vec![sid("sample:1"), sid("sample:2")],
            },
        };
        task.validate().unwrap();

        let result = AggregationControllerResult {
            schema_version: AGGREGATION_CONTROLLER_RESULT_SCHEMA_VERSION,
            task_id: task.task_id.clone(),
            reduction_plan: Some(reduction_plan),
            output: AggregationControllerOutput::Sample {
                block: PredictionBlock {
                    prediction_id: Some("prediction:model.fold0:custom_sample_agg".to_string()),
                    producer_node: NodeId::new("model:pls").unwrap(),
                    producer_port: None,
                    partition: PredictionPartition::Validation,
                    fold_id: Some(FoldId::new("fold:0").unwrap()),
                    sample_ids: vec![sid("sample:1"), sid("sample:2")],
                    values: vec![vec![2.0, 3.0], vec![9.0, 10.0]],
                    target_names: vec!["moisture".to_string(), "protein".to_string()],
                },
            },
        };

        result.validate_for_task(&task).unwrap();
    }

    #[test]
    fn custom_aggregation_controller_result_must_echo_reduction_plan() {
        let reduction_plan = ReductionPlan {
            method: ReductionMethod::Custom,
            custom_controller: Some(crate::policy::AggregationControllerSpec {
                controller_id: ControllerId::new("controller:agg.trimmed").unwrap(),
                params: serde_json::json!({}),
            }),
            ..ReductionPlan::default()
        };
        let task = AggregationControllerTask {
            schema_version: AGGREGATION_CONTROLLER_TASK_SCHEMA_VERSION,
            task_id: "agg-task:obs.sample.fold0".to_string(),
            controller_id: ControllerId::new("controller:agg.trimmed").unwrap(),
            policy: custom_policy(PredictionLevel::Sample),
            reduction_plan: Some(reduction_plan),
            input: AggregationControllerInput::ObservationToSample {
                block: ObservationPredictionBlock {
                    prediction_id: None,
                    producer_node: NodeId::new("model:pls").unwrap(),
                    producer_port: None,
                    partition: PredictionPartition::Validation,
                    fold_id: None,
                    observation_ids: vec![oid("obs:1")],
                    values: vec![vec![1.0]],
                    weights: Vec::new(),
                    target_names: vec!["y".to_string()],
                },
                relations: SampleRelationSet {
                    records: vec![relation("obs:1", "sample:1")],
                },
                requested_sample_order: vec![sid("sample:1")],
            },
        };
        let result = AggregationControllerResult {
            schema_version: AGGREGATION_CONTROLLER_RESULT_SCHEMA_VERSION,
            task_id: task.task_id.clone(),
            reduction_plan: None,
            output: AggregationControllerOutput::Sample {
                block: PredictionBlock {
                    prediction_id: None,
                    producer_node: NodeId::new("model:pls").unwrap(),
                    producer_port: None,
                    partition: PredictionPartition::Validation,
                    fold_id: None,
                    sample_ids: vec![sid("sample:1")],
                    values: vec![vec![1.0]],
                    target_names: vec!["y".to_string()],
                },
            },
        };

        let error = result.validate_for_task(&task).unwrap_err().to_string();

        assert!(error.contains("echo task reduction_plan"));
    }

    #[test]
    fn custom_aggregation_controller_result_refuses_order_mismatch() {
        let task = AggregationControllerTask {
            schema_version: AGGREGATION_CONTROLLER_TASK_SCHEMA_VERSION,
            task_id: "agg-task:obs.sample.fold0".to_string(),
            controller_id: ControllerId::new("controller:agg.trimmed").unwrap(),
            policy: custom_policy(PredictionLevel::Sample),
            reduction_plan: None,
            input: AggregationControllerInput::ObservationToSample {
                block: ObservationPredictionBlock {
                    prediction_id: None,
                    producer_node: NodeId::new("model:pls").unwrap(),
                    producer_port: None,
                    partition: PredictionPartition::Validation,
                    fold_id: None,
                    observation_ids: vec![oid("obs:1"), oid("obs:2")],
                    values: vec![vec![1.0], vec![2.0]],
                    weights: Vec::new(),
                    target_names: vec!["y".to_string()],
                },
                relations: SampleRelationSet {
                    records: vec![relation("obs:1", "sample:1"), relation("obs:2", "sample:2")],
                },
                requested_sample_order: vec![sid("sample:1"), sid("sample:2")],
            },
        };
        let result = AggregationControllerResult {
            schema_version: AGGREGATION_CONTROLLER_RESULT_SCHEMA_VERSION,
            task_id: task.task_id.clone(),
            reduction_plan: None,
            output: AggregationControllerOutput::Sample {
                block: PredictionBlock {
                    prediction_id: None,
                    producer_node: NodeId::new("model:pls").unwrap(),
                    producer_port: None,
                    partition: PredictionPartition::Validation,
                    fold_id: None,
                    sample_ids: vec![sid("sample:2"), sid("sample:1")],
                    values: vec![vec![2.0], vec![1.0]],
                    target_names: vec!["y".to_string()],
                },
            },
        };

        let error = result.validate_for_task(&task).unwrap_err().to_string();
        assert!(error.contains("requested sample order"));
    }

    #[test]
    fn validates_custom_sample_to_group_aggregation_controller_result() {
        let task = AggregationControllerTask {
            schema_version: AGGREGATION_CONTROLLER_TASK_SCHEMA_VERSION,
            task_id: "agg-task:sample.group.fold0".to_string(),
            controller_id: ControllerId::new("controller:agg.trimmed").unwrap(),
            policy: custom_policy(PredictionLevel::Group),
            reduction_plan: None,
            input: AggregationControllerInput::SampleToUnit {
                block: PredictionBlock {
                    prediction_id: Some("prediction:model.fold0".to_string()),
                    producer_node: NodeId::new("model:pls").unwrap(),
                    producer_port: None,
                    partition: PredictionPartition::Validation,
                    fold_id: Some(FoldId::new("fold:0").unwrap()),
                    sample_ids: vec![sid("sample:1"), sid("sample:2"), sid("sample:3")],
                    values: vec![vec![1.0], vec![3.0], vec![10.0]],
                    target_names: vec!["y".to_string()],
                },
                relations: SampleRelationSet {
                    records: vec![
                        relation_with_units("obs:1", "sample:1", "target:1", "group:left"),
                        relation_with_units("obs:2", "sample:2", "target:2", "group:left"),
                        relation_with_units("obs:3", "sample:3", "target:3", "group:right"),
                    ],
                },
                requested_unit_order: vec![
                    PredictionUnitId::Group(GroupId::new("group:left").unwrap()),
                    PredictionUnitId::Group(GroupId::new("group:right").unwrap()),
                ],
            },
        };
        task.validate().unwrap();

        let result = AggregationControllerResult {
            schema_version: AGGREGATION_CONTROLLER_RESULT_SCHEMA_VERSION,
            task_id: task.task_id.clone(),
            reduction_plan: None,
            output: AggregationControllerOutput::Unit {
                block: AggregatedPredictionBlock {
                    prediction_id: Some("prediction:model.fold0:custom_group_agg".to_string()),
                    producer_node: NodeId::new("model:pls").unwrap(),
                    producer_port: None,
                    partition: PredictionPartition::Validation,
                    fold_id: Some(FoldId::new("fold:0").unwrap()),
                    level: PredictionLevel::Group,
                    unit_ids: vec![
                        PredictionUnitId::Group(GroupId::new("group:left").unwrap()),
                        PredictionUnitId::Group(GroupId::new("group:right").unwrap()),
                    ],
                    values: vec![vec![2.0], vec![10.0]],
                    target_names: vec!["y".to_string()],
                },
            },
        };

        result.validate_for_task(&task).unwrap();
    }

    #[test]
    fn averages_repeated_observation_predictions_by_sample() {
        let block = ObservationPredictionBlock {
            prediction_id: Some("pred:oof".to_string()),
            producer_node: NodeId::new("model:pls").unwrap(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new("fold:0").unwrap()),
            observation_ids: vec![oid("obs:1a"), oid("obs:1b"), oid("obs:2a")],
            values: vec![vec![1.0], vec![3.0], vec![10.0]],
            weights: Vec::new(),
            target_names: vec!["y".to_string()],
        };
        let relations = SampleRelationSet {
            records: vec![
                relation("obs:1a", "sample:1"),
                relation("obs:1b", "sample:1"),
                relation("obs:2a", "sample:2"),
            ],
        };

        let aggregated = aggregate_observation_predictions(
            &block,
            &relations,
            &AggregationPolicy::default(),
            &[sid("sample:1"), sid("sample:2")],
        )
        .unwrap();

        assert_eq!(
            aggregated.sample_ids,
            vec![sid("sample:1"), sid("sample:2")]
        );
        assert_eq!(aggregated.values, vec![vec![2.0], vec![10.0]]);
    }

    #[test]
    fn aggregates_relation_backed_combo_predictions_by_sample() {
        let relations = SampleRelationSet {
            records: vec![
                relation("obs:s1.a", "sample:1"),
                relation("obs:s1.b", "sample:1"),
                relation("obs:s2.a", "sample:2"),
                relation("obs:s2.b", "sample:2"),
                combo_relation("obs:s1.combo", "sample:1", &["obs:s1.a", "obs:s1.b"]),
                combo_relation("obs:s2.combo", "sample:2", &["obs:s2.a", "obs:s2.b"]),
            ],
        };
        let block = ObservationPredictionBlock {
            prediction_id: Some("pred:combo".to_string()),
            producer_node: NodeId::new("model:combo").unwrap(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new("fold:0").unwrap()),
            observation_ids: vec![oid("obs:s1.combo"), oid("obs:s2.combo")],
            values: vec![vec![5.0], vec![9.0]],
            weights: Vec::new(),
            target_names: vec!["y".to_string()],
        };

        let aggregated = aggregate_observation_predictions(
            &block,
            &relations,
            &AggregationPolicy::default(),
            &[sid("sample:1"), sid("sample:2")],
        )
        .unwrap();

        assert_eq!(aggregated.values, vec![vec![5.0], vec![9.0]]);
    }

    #[test]
    fn robust_mean_trims_extreme_repeated_predictions() {
        let observations = (0..10)
            .map(|idx| format!("obs:s1.{idx}"))
            .collect::<Vec<_>>();
        let relations = SampleRelationSet {
            records: observations
                .iter()
                .map(|observation| relation(observation, "sample:1"))
                .collect(),
        };
        let block = ObservationPredictionBlock {
            prediction_id: Some("pred:robust".to_string()),
            producer_node: NodeId::new("model:pls").unwrap(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new("fold:0").unwrap()),
            observation_ids: observations
                .iter()
                .map(|observation| oid(observation))
                .collect(),
            values: vec![
                vec![0.0],
                vec![1.0],
                vec![2.0],
                vec![3.0],
                vec![4.0],
                vec![5.0],
                vec![6.0],
                vec![7.0],
                vec![8.0],
                vec![100.0],
            ],
            weights: Vec::new(),
            target_names: vec!["y".to_string()],
        };

        let aggregated = aggregate_observation_predictions(
            &block,
            &relations,
            &AggregationPolicy {
                method: AggregationMethod::RobustMean,
                ..AggregationPolicy::default()
            },
            &[sid("sample:1")],
        )
        .unwrap();

        assert_eq!(aggregated.values, vec![vec![4.5]]);
    }

    #[test]
    fn exclude_outliers_passes_through_single_repetition() {
        // A sample with one observation has nothing to gate on: mean-of-one.
        let relations = SampleRelationSet {
            records: vec![relation("obs:1", "sample:1")],
        };
        let block = ObservationPredictionBlock {
            prediction_id: None,
            producer_node: NodeId::new("model:pls").unwrap(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: None,
            observation_ids: vec![oid("obs:1")],
            values: vec![vec![1.0]],
            weights: Vec::new(),
            target_names: vec!["y".to_string()],
        };

        let aggregated = aggregate_observation_predictions(
            &block,
            &relations,
            &AggregationPolicy {
                method: AggregationMethod::ExcludeOutliers,
                ..AggregationPolicy::default()
            },
            &[sid("sample:1")],
        )
        .unwrap();

        assert_eq!(aggregated.values, vec![vec![1.0]]);
    }

    #[test]
    fn aggregates_repeated_predictions_with_median_vote_and_weights() {
        let relations = SampleRelationSet {
            records: vec![
                relation("obs:1a", "sample:1"),
                relation("obs:1b", "sample:1"),
                relation("obs:1c", "sample:1"),
                relation("obs:2a", "sample:2"),
                relation("obs:2b", "sample:2"),
            ],
        };
        let base_block = ObservationPredictionBlock {
            prediction_id: Some("pred:oof".to_string()),
            producer_node: NodeId::new("model:pls").unwrap(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new("fold:0").unwrap()),
            observation_ids: vec![
                oid("obs:1a"),
                oid("obs:1b"),
                oid("obs:1c"),
                oid("obs:2a"),
                oid("obs:2b"),
            ],
            values: vec![
                vec![1.0, 0.0],
                vec![5.0, 1.0],
                vec![9.0, 1.0],
                vec![10.0, 2.0],
                vec![30.0, 3.0],
            ],
            weights: Vec::new(),
            target_names: vec!["regression".to_string(), "class".to_string()],
        };
        let sample_order = [sid("sample:1"), sid("sample:2")];

        let median_policy = AggregationPolicy {
            method: AggregationMethod::Median,
            ..AggregationPolicy::default()
        };
        let median = aggregate_observation_predictions(
            &base_block,
            &relations,
            &median_policy,
            &sample_order,
        )
        .unwrap();
        assert_eq!(median.values, vec![vec![5.0, 1.0], vec![20.0, 2.5]]);

        let vote_policy = AggregationPolicy {
            method: AggregationMethod::Vote,
            ..AggregationPolicy::default()
        };
        let vote =
            aggregate_observation_predictions(&base_block, &relations, &vote_policy, &sample_order)
                .unwrap();
        assert_eq!(vote.values, vec![vec![1.0, 1.0], vec![10.0, 2.0]]);

        let mut weighted_block = base_block;
        weighted_block.weights = vec![1.0, 1.0, 2.0, 1.0, 3.0];
        let weighted_policy = AggregationPolicy {
            method: AggregationMethod::WeightedMean,
            weights: AggregationWeights::ControllerEmitted,
            ..AggregationPolicy::default()
        };
        let weighted = aggregate_observation_predictions(
            &weighted_block,
            &relations,
            &weighted_policy,
            &sample_order,
        )
        .unwrap();
        assert_eq!(weighted.values, vec![vec![6.0, 0.75], vec![25.0, 2.75]]);
    }

    #[test]
    fn refuses_incompatible_observation_weight_contracts() {
        let relations = SampleRelationSet {
            records: vec![
                relation("obs:1a", "sample:1"),
                relation("obs:1b", "sample:1"),
            ],
        };
        let block = ObservationPredictionBlock {
            prediction_id: None,
            producer_node: NodeId::new("model:pls").unwrap(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: None,
            observation_ids: vec![oid("obs:1a"), oid("obs:1b")],
            values: vec![vec![1.0], vec![2.0]],
            weights: vec![1.0, 2.0],
            target_names: vec!["y".to_string()],
        };

        let mean_error = aggregate_observation_predictions(
            &block,
            &relations,
            &AggregationPolicy::default(),
            &[sid("sample:1")],
        )
        .unwrap_err()
        .to_string();
        assert!(
            mean_error.contains("non-weighted aggregation"),
            "unexpected mean error: {mean_error}"
        );

        let mut missing_weights_block = block;
        missing_weights_block.weights.clear();
        let weighted_error = aggregate_observation_predictions(
            &missing_weights_block,
            &relations,
            &AggregationPolicy {
                method: AggregationMethod::WeightedMean,
                weights: AggregationWeights::ControllerEmitted,
                ..AggregationPolicy::default()
            },
            &[sid("sample:1")],
        )
        .unwrap_err()
        .to_string();
        assert!(
            weighted_error.contains("requires one weight per observation"),
            "unexpected weighted error: {weighted_error}"
        );
    }

    #[test]
    fn aggregates_sample_predictions_to_target_and_group_units() {
        let relations = SampleRelationSet {
            records: vec![
                relation_with_units("obs:s1:a", "sample:1", "target:a", "group:left"),
                relation_with_units("obs:s1:b", "sample:1", "target:a", "group:left"),
                relation_with_units("obs:s2:a", "sample:2", "target:a", "group:left"),
                relation_with_units("obs:s3:a", "sample:3", "target:b", "group:right"),
            ],
        };
        let block = PredictionBlock {
            prediction_id: Some("pred:sample".to_string()),
            producer_node: NodeId::new("model:pls").unwrap(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new("fold:0").unwrap()),
            sample_ids: vec![sid("sample:1"), sid("sample:2"), sid("sample:3")],
            values: vec![vec![10.0], vec![4.0], vec![30.0]],
            target_names: vec!["y".to_string()],
        };

        let target_policy = AggregationPolicy {
            aggregation_level: PredictionLevel::Target,
            method: AggregationMethod::Mean,
            ..AggregationPolicy::default()
        };
        let by_target = aggregate_sample_predictions_by_unit(
            &block,
            &relations,
            &target_policy,
            &[
                PredictionUnitId::Target(TargetId::new("target:a").unwrap()),
                PredictionUnitId::Target(TargetId::new("target:b").unwrap()),
            ],
        )
        .unwrap();
        assert_eq!(by_target.level, PredictionLevel::Target);
        assert_eq!(by_target.values, vec![vec![7.0], vec![30.0]]);

        let group_policy = AggregationPolicy {
            aggregation_level: PredictionLevel::Group,
            method: AggregationMethod::WeightedMean,
            weights: AggregationWeights::RepetitionCount,
            ..AggregationPolicy::default()
        };
        let by_group = aggregate_sample_predictions_by_unit(
            &block,
            &relations,
            &group_policy,
            &[
                PredictionUnitId::Group(GroupId::new("group:left").unwrap()),
                PredictionUnitId::Group(GroupId::new("group:right").unwrap()),
            ],
        )
        .unwrap();
        assert_eq!(by_group.level, PredictionLevel::Group);
        assert_eq!(by_group.values, vec![vec![8.0], vec![30.0]]);
    }

    #[test]
    fn refuses_target_group_aggregation_without_relation_units() {
        let relations = SampleRelationSet {
            records: vec![SampleRelation::new(oid("obs:1"), sid("sample:1"))],
        };
        let block = PredictionBlock {
            prediction_id: None,
            producer_node: NodeId::new("model:pls").unwrap(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: None,
            sample_ids: vec![sid("sample:1")],
            values: vec![vec![1.0]],
            target_names: vec!["y".to_string()],
        };

        let error = aggregate_sample_predictions_by_unit(
            &block,
            &relations,
            &AggregationPolicy {
                aggregation_level: PredictionLevel::Target,
                method: AggregationMethod::Mean,
                ..AggregationPolicy::default()
            },
            &[PredictionUnitId::Target(
                TargetId::new("target:missing").unwrap(),
            )],
        )
        .unwrap_err()
        .to_string();
        assert!(
            error.contains("missing target id"),
            "unexpected target aggregation error: {error}"
        );
    }

    #[test]
    fn refuses_missing_observation_relation() {
        let block = ObservationPredictionBlock {
            prediction_id: None,
            producer_node: NodeId::new("model:pls").unwrap(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: None,
            observation_ids: vec![oid("obs:missing")],
            values: vec![vec![1.0]],
            weights: Vec::new(),
            target_names: vec!["y".to_string()],
        };

        assert!(aggregate_observation_predictions(
            &block,
            &SampleRelationSet::default(),
            &AggregationPolicy::default(),
            &[sid("sample:1")]
        )
        .is_err());
    }

    #[test]
    fn cross_fold_reduction_concats_disjoint_and_averages_shared() {
        let node = NodeId::new("model:pls").unwrap();
        let block = |fold: &str, rows: &[(&str, f64)]| PredictionBlock {
            prediction_id: None,
            producer_node: node.clone(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new(fold).unwrap()),
            sample_ids: rows.iter().map(|(s, _)| sid(s)).collect(),
            values: rows.iter().map(|(_, v)| vec![*v]).collect(),
            target_names: vec!["y".to_string()],
        };

        // Disjoint folds (the OOF/validation case) -> concat, each sample once, value unchanged.
        let oof = reduce_predictions_across_folds(
            &[
                block("fold0", &[("s1", 1.0), ("s2", 2.0)]),
                block("fold1", &[("s3", 3.0), ("s4", 4.0)]),
            ],
            None,
            "avg",
        )
        .unwrap();
        assert_eq!(oof.sample_ids.len(), 4);
        assert_eq!(oof.fold_id, Some(FoldId::new("avg").unwrap()));
        assert_eq!(oof.values, vec![vec![1.0], vec![2.0], vec![3.0], vec![4.0]]);

        // Shared folds (the test case, each fold predicts the same samples) -> mean per sample.
        let shared = [
            block("fold0", &[("t1", 0.0), ("t2", 10.0)]),
            block("fold1", &[("t1", 4.0), ("t2", 20.0)]),
        ];
        let avg = reduce_predictions_across_folds(&shared, None, "avg").unwrap();
        assert_eq!(avg.values, vec![vec![2.0], vec![15.0]]);

        // w_avg with fold weights [1, 3]: (0*1+4*3)/4=3 ; (10*1+20*3)/4=17.5.
        let wavg = reduce_predictions_across_folds(&shared, Some(&[1.0, 3.0]), "w_avg").unwrap();
        assert_eq!(wavg.values, vec![vec![3.0], vec![17.5]]);
        assert_eq!(wavg.fold_id, Some(FoldId::new("w_avg").unwrap()));

        // Mismatched weights are rejected.
        assert!(reduce_predictions_across_folds(
            &[block("f0", &[("a", 1.0)])],
            Some(&[1.0, 2.0]),
            "avg"
        )
        .is_err());
    }

    #[test]
    fn exclude_outliers_drops_hotelling_t2_extreme_repetition() {
        // 6 repetitions of one sample; the 100.0 row is a gross outlier and must be
        // excluded before the mean. Survivors {1,2,3,4,5} -> mean 3.0.
        let observations = (0..6)
            .map(|idx| format!("obs:s1.{idx}"))
            .collect::<Vec<_>>();
        let relations = SampleRelationSet {
            records: observations
                .iter()
                .map(|observation| relation(observation, "sample:1"))
                .collect(),
        };
        let block = ObservationPredictionBlock {
            prediction_id: Some("pred:t2".to_string()),
            producer_node: NodeId::new("model:pls").unwrap(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new("fold:0").unwrap()),
            observation_ids: observations
                .iter()
                .map(|observation| oid(observation))
                .collect(),
            values: vec![
                vec![1.0],
                vec![2.0],
                vec![3.0],
                vec![4.0],
                vec![5.0],
                vec![100.0],
            ],
            weights: Vec::new(),
            target_names: vec!["y".to_string()],
        };

        let aggregated = aggregate_observation_predictions(
            &block,
            &relations,
            &AggregationPolicy {
                method: AggregationMethod::ExcludeOutliers,
                ..AggregationPolicy::default()
            },
            &[sid("sample:1")],
        )
        .unwrap();

        assert_eq!(aggregated.values, vec![vec![3.0]]);
    }

    #[test]
    fn exclude_outliers_keeps_small_or_constant_repetition_sets() {
        // Two repetitions: too few rows to gate on robust spread -> plain mean.
        let small_relations = SampleRelationSet {
            records: vec![
                relation("obs:1a", "sample:1"),
                relation("obs:1b", "sample:1"),
            ],
        };
        let small_block = ObservationPredictionBlock {
            prediction_id: None,
            producer_node: NodeId::new("model:pls").unwrap(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: None,
            observation_ids: vec![oid("obs:1a"), oid("obs:1b")],
            values: vec![vec![1.0], vec![9.0]],
            weights: Vec::new(),
            target_names: vec!["y".to_string()],
        };
        let small = aggregate_observation_predictions(
            &small_block,
            &small_relations,
            &AggregationPolicy {
                method: AggregationMethod::ExcludeOutliers,
                ..AggregationPolicy::default()
            },
            &[sid("sample:1")],
        )
        .unwrap();
        assert_eq!(small.values, vec![vec![5.0]]);

        // Constant target across many repetitions: zero variance, nothing flagged.
        let observations = (0..5).map(|idx| format!("obs:c.{idx}")).collect::<Vec<_>>();
        let constant_relations = SampleRelationSet {
            records: observations
                .iter()
                .map(|observation| relation(observation, "sample:1"))
                .collect(),
        };
        let constant_block = ObservationPredictionBlock {
            prediction_id: None,
            producer_node: NodeId::new("model:pls").unwrap(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: None,
            observation_ids: observations
                .iter()
                .map(|observation| oid(observation))
                .collect(),
            values: vec![vec![7.0]; 5],
            weights: Vec::new(),
            target_names: vec!["y".to_string()],
        };
        let constant = aggregate_observation_predictions(
            &constant_block,
            &constant_relations,
            &AggregationPolicy {
                method: AggregationMethod::ExcludeOutliers,
                ..AggregationPolicy::default()
            },
            &[sid("sample:1")],
        )
        .unwrap();
        assert_eq!(constant.values, vec![vec![7.0]]);
    }

    #[test]
    fn exclude_outliers_aggregates_sample_predictions_to_unit() {
        // Sample-to-group path: group:left has a gross outlier sample to exclude.
        let relations = SampleRelationSet {
            records: vec![
                relation_with_units("o:1", "sample:1", "t:a", "group:left"),
                relation_with_units("o:2", "sample:2", "t:a", "group:left"),
                relation_with_units("o:3", "sample:3", "t:a", "group:left"),
                relation_with_units("o:4", "sample:4", "t:a", "group:left"),
                relation_with_units("o:5", "sample:5", "t:b", "group:right"),
            ],
        };
        let block = PredictionBlock {
            prediction_id: Some("pred:sample".to_string()),
            producer_node: NodeId::new("model:pls").unwrap(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new("fold:0").unwrap()),
            sample_ids: vec![
                sid("sample:1"),
                sid("sample:2"),
                sid("sample:3"),
                sid("sample:4"),
                sid("sample:5"),
            ],
            values: vec![vec![1.0], vec![2.0], vec![3.0], vec![100.0], vec![42.0]],
            target_names: vec!["y".to_string()],
        };

        let aggregated = aggregate_sample_predictions_by_unit(
            &block,
            &relations,
            &AggregationPolicy {
                aggregation_level: PredictionLevel::Group,
                method: AggregationMethod::ExcludeOutliers,
                ..AggregationPolicy::default()
            },
            &[
                PredictionUnitId::Group(GroupId::new("group:left").unwrap()),
                PredictionUnitId::Group(GroupId::new("group:right").unwrap()),
            ],
        )
        .unwrap();
        // group:left survivors {1,2,3} -> 2.0 ; group:right single sample -> 42.0.
        assert_eq!(aggregated.values, vec![vec![2.0], vec![42.0]]);
    }

    #[test]
    fn cross_branch_reduction_averages_only_covering_branches() {
        let merge = NodeId::new("merge:branch.fusion").unwrap();
        let branch = |producer: &str, rows: &[(&str, f64)]| PredictionBlock {
            prediction_id: None,
            producer_node: NodeId::new(producer).unwrap(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new("fold:0").unwrap()),
            sample_ids: rows.iter().map(|(s, _)| sid(s)).collect(),
            values: rows.iter().map(|(_, v)| vec![*v]).collect(),
            target_names: vec!["y".to_string()],
        };

        // Two model-bearing branches with DIFFERENT producers; b1 does not cover s3
        // (asymmetric coverage). s1 covered by both -> mean; s3 only by b0 -> b0 value.
        let fused = reduce_predictions_across_branches(
            &[
                branch(
                    "branch:b0.model:ridge",
                    &[("s1", 10.0), ("s2", 4.0), ("s3", 6.0)],
                ),
                branch("branch:b1.model:rf", &[("s1", 20.0), ("s2", 8.0)]),
            ],
            None,
            &merge,
        )
        .unwrap();
        assert_eq!(fused.producer_node, merge);
        assert_eq!(fused.sample_ids, vec![sid("s1"), sid("s2"), sid("s3")]);
        assert_eq!(fused.values, vec![vec![15.0], vec![6.0], vec![6.0]]);

        // Per-branch ensemble weights [1, 3]: s1 -> (10*1 + 20*3)/4 = 17.5.
        let weighted = reduce_predictions_across_branches(
            &[
                branch("branch:b0.model:ridge", &[("s1", 10.0)]),
                branch("branch:b1.model:rf", &[("s1", 20.0)]),
            ],
            Some(&[1.0, 3.0]),
            &merge,
        )
        .unwrap();
        assert_eq!(weighted.values, vec![vec![17.5]]);

        // Empty branch set (every branch modelless) is rejected.
        assert!(reduce_predictions_across_branches(&[], None, &merge).is_err());
        // Mismatched per-branch weights are rejected.
        assert!(reduce_predictions_across_branches(
            &[branch("branch:b0", &[("s1", 1.0)])],
            Some(&[1.0, 2.0]),
            &merge
        )
        .is_err());
        // Branches with mismatched target names are rejected.
        let mut other_targets = branch("branch:b1", &[("s1", 1.0)]);
        other_targets.target_names = vec!["z".to_string()];
        assert!(reduce_predictions_across_branches(
            &[branch("branch:b0", &[("s1", 1.0)]), other_targets],
            None,
            &merge
        )
        .is_err());
    }

    #[test]
    fn proba_mean_fusion_averages_and_renormalizes_class_probabilities() {
        let merge = NodeId::new("merge:proba.fusion").unwrap();
        let branch = |producer: &str, rows: &[(&str, [f64; 2])]| PredictionBlock {
            prediction_id: None,
            producer_node: NodeId::new(producer).unwrap(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: None,
            sample_ids: rows.iter().map(|(s, _)| sid(s)).collect(),
            values: rows.iter().map(|(_, p)| p.to_vec()).collect(),
            target_names: vec!["neg".to_string(), "pos".to_string()],
        };

        let fused = reduce_proba_mean_across_branches(
            &[
                branch(
                    "branch:b0.model:lr",
                    &[("s1", [0.8, 0.2]), ("s2", [0.4, 0.6])],
                ),
                branch(
                    "branch:b1.model:svc",
                    &[("s1", [0.6, 0.4]), ("s2", [0.2, 0.8])],
                ),
            ],
            &merge,
        )
        .unwrap();
        assert_eq!(fused.producer_node, merge);
        // s1 -> [(0.8+0.6)/2, (0.2+0.4)/2] = [0.7, 0.3] ; s2 -> [0.3, 0.7].
        for (row, expected) in fused.values.iter().zip([[0.7, 0.3], [0.3, 0.7]]) {
            for (value, want) in row.iter().zip(expected) {
                assert!((value - want).abs() < 1e-12, "got {value}, want {want}");
            }
            assert!((row.iter().sum::<f64>() - 1.0).abs() < 1e-12);
        }

        // Asymmetric coverage: only b0 predicts s2 -> its row passes through.
        let asymmetric = reduce_proba_mean_across_branches(
            &[
                branch(
                    "branch:b0.model:lr",
                    &[("s1", [0.9, 0.1]), ("s2", [0.3, 0.7])],
                ),
                branch("branch:b1.model:svc", &[("s1", [0.5, 0.5])]),
            ],
            &merge,
        )
        .unwrap();
        assert_eq!(asymmetric.sample_ids, vec![sid("s1"), sid("s2")]);
        assert!((asymmetric.values[1][1] - 0.7).abs() < 1e-12);

        // Rows that are not probability vectors are rejected.
        assert!(reduce_proba_mean_across_branches(
            &[branch("branch:b0", &[("s1", [0.8, 0.4])])],
            &merge
        )
        .is_err());
        assert!(reduce_proba_mean_across_branches(
            &[branch("branch:b0", &[("s1", [1.2, -0.2])])],
            &merge
        )
        .is_err());
        // Empty branch set is rejected.
        assert!(reduce_proba_mean_across_branches(&[], &merge).is_err());

        // A NaN class probability must be rejected — it would slip past the `< 0.0` and
        // `sum != 1` checks (NaN compares false) but is caught by the content gate.
        assert!(reduce_proba_mean_across_branches(
            &[branch("branch:b0", &[("s1", [f64::NAN, 0.5])])],
            &merge
        )
        .is_err());
    }

    #[test]
    fn cross_fold_reduction_rejects_within_fold_duplicate_and_non_finite() {
        let node = NodeId::new("model:pls").unwrap();
        let block = |fold: &str, rows: &[(&str, f64)]| PredictionBlock {
            prediction_id: None,
            producer_node: node.clone(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new(fold).unwrap()),
            sample_ids: rows.iter().map(|(s, _)| sid(s)).collect(),
            values: rows.iter().map(|(_, v)| vec![*v]).collect(),
            target_names: vec!["y".to_string()],
        };

        // A within-fold duplicate sample would be averaged in twice (double-count) — rejected.
        let dup = block("fold0", &[("s1", 1.0), ("s1", 3.0)]);
        let err = reduce_predictions_across_folds(&[dup], None, "avg").unwrap_err();
        assert!(
            err.to_string().contains("duplicate prediction"),
            "got: {err}"
        );

        // A non-finite value would poison the fused mean — rejected.
        let poisoned = block("fold0", &[("s1", f64::NAN), ("s2", 2.0)]);
        let err = reduce_predictions_across_folds(&[poisoned], None, "avg").unwrap_err();
        assert!(err.to_string().contains("non-finite"), "got: {err}");
    }
}
