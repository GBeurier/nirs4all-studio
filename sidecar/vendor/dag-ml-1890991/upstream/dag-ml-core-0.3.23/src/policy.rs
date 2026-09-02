use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::error::{DagMlError, Result};
use crate::ids::{ControllerId, NodeId};
use crate::relation::EntityUnitLevel;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SplitUnit {
    PhysicalSample,
    Observation,
    Sample,
    Target,
    Group,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct LeakageUnitPolicy {
    #[serde(default = "default_split_unit")]
    pub split_unit: SplitUnit,
    #[serde(default = "default_true")]
    pub forbid_origin_cross_fold: bool,
    #[serde(default)]
    pub allow_observation_split_with_shared_target: bool,
    #[serde(default)]
    pub require_group_ids: bool,
    #[serde(default)]
    pub unsafe_flags: BTreeSet<String>,
}

impl Default for LeakageUnitPolicy {
    fn default() -> Self {
        Self {
            split_unit: SplitUnit::PhysicalSample,
            forbid_origin_cross_fold: true,
            allow_observation_split_with_shared_target: false,
            require_group_ids: false,
            unsafe_flags: BTreeSet::new(),
        }
    }
}

impl LeakageUnitPolicy {
    pub fn validate(&self) -> Result<()> {
        if self.split_unit == SplitUnit::Observation
            && !self.allow_observation_split_with_shared_target
        {
            return Err(DagMlError::CampaignValidation(
                "observation-level splitting is unsafe for repeated X / shared Y unless explicitly allowed".to_string(),
            ));
        }
        if self.require_group_ids && self.split_unit != SplitUnit::Group {
            return Err(DagMlError::CampaignValidation(
                "require_group_ids=true requires split_unit=group".to_string(),
            ));
        }
        Ok(())
    }
}

fn default_split_unit() -> SplitUnit {
    SplitUnit::PhysicalSample
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PredictionLevel {
    Observation,
    Sample,
    Target,
    Group,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FitInfluencePolicy {
    Auto,
    #[default]
    UniformRows,
    EqualSampleInfluence,
    ResampleEqualized,
    BackendLossWeight,
    ScorerOnly,
    StrictWeightSupport,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AggregationMethod {
    None,
    Mean,
    WeightedMean,
    Median,
    Vote,
    RobustMean,
    ExcludeOutliers,
    CustomController,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AggregationWeights {
    None,
    Quality,
    RepetitionCount,
    ControllerEmitted,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AggregationControllerSpec {
    pub controller_id: ControllerId,
    #[serde(default = "default_json_object")]
    pub params: serde_json::Value,
}

impl AggregationControllerSpec {
    pub fn validate(&self) -> Result<()> {
        if self.params.is_null() {
            return Err(DagMlError::CampaignValidation(format!(
                "custom aggregation controller `{}` params cannot be null",
                self.controller_id
            )));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReductionRole {
    Score,
    Persist,
    FoldEnsemble,
    MetaFeature,
    FinalOutput,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReductionAxis {
    Unit,
    Fold,
    Model,
    Metric,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReductionMethod {
    Mean,
    WeightedMean,
    Median,
    Vote,
    RobustMean,
    ExcludeOutliers,
    Custom,
}

impl From<AggregationMethod> for ReductionMethod {
    fn from(method: AggregationMethod) -> Self {
        match method {
            AggregationMethod::None | AggregationMethod::Mean => Self::Mean,
            AggregationMethod::WeightedMean => Self::WeightedMean,
            AggregationMethod::Median => Self::Median,
            AggregationMethod::Vote => Self::Vote,
            AggregationMethod::RobustMean => Self::RobustMean,
            AggregationMethod::ExcludeOutliers => Self::ExcludeOutliers,
            AggregationMethod::CustomController => Self::Custom,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReductionTaskCompatibility {
    Any,
    Regression,
    Classification,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ReductionPlan {
    #[serde(default = "default_reduction_role")]
    pub role: ReductionRole,
    #[serde(default = "default_reduction_axis")]
    pub axis: ReductionAxis,
    #[serde(default = "default_reduction_input_unit_level")]
    pub input_unit_level: EntityUnitLevel,
    #[serde(default = "default_reduction_output_unit_level")]
    pub output_unit_level: EntityUnitLevel,
    #[serde(default = "default_reduction_method")]
    pub method: ReductionMethod,
    #[serde(default = "default_aggregation_weights")]
    pub weight_source: AggregationWeights,
    #[serde(default = "default_reduction_task_compatibility")]
    pub task_compatibility: ReductionTaskCompatibility,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_controller: Option<AggregationControllerSpec>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub params: BTreeMap<String, serde_json::Value>,
}

impl Default for ReductionPlan {
    fn default() -> Self {
        Self {
            role: default_reduction_role(),
            axis: default_reduction_axis(),
            input_unit_level: default_reduction_input_unit_level(),
            output_unit_level: default_reduction_output_unit_level(),
            method: default_reduction_method(),
            weight_source: default_aggregation_weights(),
            task_compatibility: default_reduction_task_compatibility(),
            custom_controller: None,
            params: BTreeMap::new(),
        }
    }
}

impl ReductionPlan {
    pub fn validate(&self) -> Result<()> {
        if self.method == ReductionMethod::WeightedMean
            && self.weight_source == AggregationWeights::None
        {
            return Err(DagMlError::CampaignValidation(
                "weighted_mean reduction requires an explicit weight_source".to_string(),
            ));
        }
        if self.method != ReductionMethod::WeightedMean
            && self.method != ReductionMethod::Custom
            && self.weight_source != AggregationWeights::None
        {
            return Err(DagMlError::CampaignValidation(format!(
                "reduction weight_source {:?} is only valid with weighted_mean or custom",
                self.weight_source
            )));
        }
        match (&self.method, &self.custom_controller) {
            (ReductionMethod::Custom, Some(controller)) => controller.validate()?,
            (ReductionMethod::Custom, None) => {
                return Err(DagMlError::CampaignValidation(
                    "custom reduction requires a custom_controller spec".to_string(),
                ));
            }
            (_, Some(controller)) => {
                return Err(DagMlError::CampaignValidation(format!(
                    "reduction controller `{}` is only valid with custom method",
                    controller.controller_id
                )));
            }
            (_, None) => {}
        }
        if self.method == ReductionMethod::Vote
            && self.task_compatibility == ReductionTaskCompatibility::Regression
        {
            return Err(DagMlError::CampaignValidation(
                "vote reduction is not compatible with regression tasks".to_string(),
            ));
        }
        validate_trim_fraction(self.params.get("trim_fraction"))?;
        validate_outlier_threshold(self.params.get("threshold"))?;
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AggregationPolicy {
    #[serde(default = "default_prediction_level")]
    pub aggregation_level: PredictionLevel,
    #[serde(default = "default_aggregation_method")]
    pub method: AggregationMethod,
    #[serde(default = "default_aggregation_weights")]
    pub weights: AggregationWeights,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_controller: Option<AggregationControllerSpec>,
    #[serde(default = "default_true")]
    pub emit_parallel_metrics: bool,
    #[serde(default = "default_prediction_level")]
    pub selection_metric_level: PredictionLevel,
    #[serde(default = "default_true")]
    pub store_raw_predictions: bool,
    #[serde(default = "default_true")]
    pub store_aggregated_predictions: bool,
}

impl Default for AggregationPolicy {
    fn default() -> Self {
        Self {
            aggregation_level: PredictionLevel::Sample,
            method: AggregationMethod::Mean,
            weights: AggregationWeights::None,
            custom_controller: None,
            emit_parallel_metrics: true,
            selection_metric_level: PredictionLevel::Sample,
            store_raw_predictions: true,
            store_aggregated_predictions: true,
        }
    }
}

impl AggregationPolicy {
    pub fn validate(&self) -> Result<()> {
        if self.method == AggregationMethod::None
            && self.aggregation_level != PredictionLevel::Observation
        {
            return Err(DagMlError::CampaignValidation(
                "aggregation method none is only valid at observation level".to_string(),
            ));
        }
        if self.method == AggregationMethod::WeightedMean
            && self.weights == AggregationWeights::None
        {
            return Err(DagMlError::CampaignValidation(
                "weighted_mean aggregation requires an explicit weights policy".to_string(),
            ));
        }
        if self.method != AggregationMethod::WeightedMean
            && self.method != AggregationMethod::CustomController
            && self.weights != AggregationWeights::None
        {
            return Err(DagMlError::CampaignValidation(format!(
                "aggregation weights {:?} are only valid with weighted_mean",
                self.weights
            )));
        }
        match (&self.method, &self.custom_controller) {
            (AggregationMethod::CustomController, Some(controller)) => controller.validate()?,
            (AggregationMethod::CustomController, None) => {
                return Err(DagMlError::CampaignValidation(
                    "custom_controller aggregation requires a custom_controller spec".to_string(),
                ));
            }
            (_, Some(controller)) => {
                return Err(DagMlError::CampaignValidation(format!(
                    "aggregation controller `{}` is only valid with custom_controller method",
                    controller.controller_id
                )));
            }
            (_, None) => {}
        }
        if !self.store_raw_predictions && !self.store_aggregated_predictions {
            return Err(DagMlError::CampaignValidation(
                "aggregation policy must store raw and/or aggregated predictions".to_string(),
            ));
        }
        Ok(())
    }
}

fn default_prediction_level() -> PredictionLevel {
    PredictionLevel::Sample
}

fn default_aggregation_method() -> AggregationMethod {
    AggregationMethod::Mean
}

fn default_aggregation_weights() -> AggregationWeights {
    AggregationWeights::None
}

fn default_reduction_role() -> ReductionRole {
    ReductionRole::FinalOutput
}

fn default_reduction_axis() -> ReductionAxis {
    ReductionAxis::Unit
}

fn default_reduction_input_unit_level() -> EntityUnitLevel {
    EntityUnitLevel::Observation
}

fn default_reduction_output_unit_level() -> EntityUnitLevel {
    EntityUnitLevel::PhysicalSample
}

fn default_reduction_method() -> ReductionMethod {
    ReductionMethod::Mean
}

fn default_reduction_task_compatibility() -> ReductionTaskCompatibility {
    ReductionTaskCompatibility::Any
}

fn validate_trim_fraction(value: Option<&serde_json::Value>) -> Result<()> {
    let Some(value) = value else {
        return Ok(());
    };
    let Some(trim_fraction) = value.as_f64() else {
        return Err(DagMlError::CampaignValidation(
            "reduction trim_fraction must be numeric".to_string(),
        ));
    };
    if trim_fraction.is_finite() && (0.0..0.5).contains(&trim_fraction) {
        Ok(())
    } else {
        Err(DagMlError::CampaignValidation(
            "reduction trim_fraction must be finite and in [0.0, 0.5)".to_string(),
        ))
    }
}

fn validate_outlier_threshold(value: Option<&serde_json::Value>) -> Result<()> {
    let Some(value) = value else {
        return Ok(());
    };
    let Some(threshold) = value.as_f64() else {
        return Err(DagMlError::CampaignValidation(
            "reduction threshold must be numeric".to_string(),
        ));
    };
    if threshold.is_finite() && threshold > 0.0 && threshold < 1.0 {
        Ok(())
    } else {
        Err(DagMlError::CampaignValidation(
            "reduction threshold must be finite and in (0.0, 1.0)".to_string(),
        ))
    }
}

fn default_json_object() -> serde_json::Value {
    serde_json::Value::Object(serde_json::Map::new())
}

fn default_true() -> bool {
    true
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Granularity {
    Observation,
    Sample,
    Target,
    Group,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FitBoundary {
    FoldTrain,
    FoldValidation,
    FullTrain,
    Predict,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AugmentationScope {
    None,
    TrainOnly,
    AllPartitions,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AugmentationPolicy {
    #[serde(default = "default_augmentation_scope")]
    pub sample_scope: AugmentationScope,
    #[serde(default = "default_augmentation_scope")]
    pub feature_scope: AugmentationScope,
    #[serde(default = "default_true")]
    pub require_origin_id: bool,
    #[serde(default = "default_true")]
    pub inherit_group: bool,
    #[serde(default = "default_true")]
    pub inherit_target: bool,
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub unsafe_flags: BTreeSet<String>,
}

impl Default for AugmentationPolicy {
    fn default() -> Self {
        Self {
            sample_scope: AugmentationScope::TrainOnly,
            feature_scope: AugmentationScope::TrainOnly,
            require_origin_id: true,
            inherit_group: true,
            inherit_target: true,
            unsafe_flags: BTreeSet::new(),
        }
    }
}

impl AugmentationPolicy {
    pub const ALLOW_SAMPLE_AUGMENTATION_ALL_PARTITIONS: &'static str =
        "allow_sample_augmentation_all_partitions";
    pub const ALLOW_SAMPLE_AUGMENTATION_WITHOUT_ORIGIN: &'static str =
        "allow_sample_augmentation_without_origin";
    pub const ALLOW_SAMPLE_AUGMENTATION_WITHOUT_GROUP_INHERITANCE: &'static str =
        "allow_sample_augmentation_without_group_inheritance";
    pub const ALLOW_SAMPLE_AUGMENTATION_WITHOUT_TARGET_INHERITANCE: &'static str =
        "allow_sample_augmentation_without_target_inheritance";

    pub fn validate(&self) -> Result<()> {
        for unsafe_flag in &self.unsafe_flags {
            if unsafe_flag.trim().is_empty() {
                return Err(DagMlError::CampaignValidation(
                    "augmentation policy contains an empty unsafe flag".to_string(),
                ));
            }
        }
        if self.sample_scope == AugmentationScope::AllPartitions
            && !self
                .unsafe_flags
                .contains(Self::ALLOW_SAMPLE_AUGMENTATION_ALL_PARTITIONS)
        {
            return Err(DagMlError::CampaignValidation(
                "sample augmentation over all partitions can leak validation/test origins; add explicit unsafe flag allow_sample_augmentation_all_partitions".to_string(),
            ));
        }
        if self.sample_scope != AugmentationScope::None {
            if !self.require_origin_id
                && !self
                    .unsafe_flags
                    .contains(Self::ALLOW_SAMPLE_AUGMENTATION_WITHOUT_ORIGIN)
            {
                return Err(DagMlError::CampaignValidation(
                    "sample augmentation requires origin ids unless explicit unsafe flag allow_sample_augmentation_without_origin is present".to_string(),
                ));
            }
            if !self.inherit_group
                && !self
                    .unsafe_flags
                    .contains(Self::ALLOW_SAMPLE_AUGMENTATION_WITHOUT_GROUP_INHERITANCE)
            {
                return Err(DagMlError::CampaignValidation(
                    "sample augmentation must inherit groups unless explicit unsafe flag allow_sample_augmentation_without_group_inheritance is present".to_string(),
                ));
            }
            if !self.inherit_target
                && !self
                    .unsafe_flags
                    .contains(Self::ALLOW_SAMPLE_AUGMENTATION_WITHOUT_TARGET_INHERITANCE)
            {
                return Err(DagMlError::CampaignValidation(
                    "sample augmentation must inherit targets unless explicit unsafe flag allow_sample_augmentation_without_target_inheritance is present".to_string(),
                ));
            }
        }
        Ok(())
    }
}

fn default_augmentation_scope() -> AugmentationScope {
    AugmentationScope::TrainOnly
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FeatureSelectionScope {
    None,
    Unsupervised,
    SupervisedFoldTrain,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct FeatureSelectionPolicy {
    #[serde(default = "default_feature_selection_scope")]
    pub scope: FeatureSelectionScope,
    #[serde(default = "default_true")]
    pub store_masks: bool,
    #[serde(default)]
    pub allow_schema_mismatch_on_join: bool,
}

impl Default for FeatureSelectionPolicy {
    fn default() -> Self {
        Self {
            scope: FeatureSelectionScope::None,
            store_masks: true,
            allow_schema_mismatch_on_join: false,
        }
    }
}

impl FeatureSelectionPolicy {
    pub fn validate(&self) -> Result<()> {
        if self.scope == FeatureSelectionScope::SupervisedFoldTrain && !self.store_masks {
            return Err(DagMlError::CampaignValidation(
                "supervised feature selection must store fold/refit masks for replay and leakage audit".to_string(),
            ));
        }
        Ok(())
    }
}

fn default_feature_selection_scope() -> FeatureSelectionScope {
    FeatureSelectionScope::None
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct DataModelShapePlan {
    pub node_id: NodeId,
    #[serde(default = "default_granularity")]
    pub input_granularity: Granularity,
    #[serde(default = "default_granularity")]
    pub target_granularity: Granularity,
    #[serde(default = "default_fit_boundary")]
    pub fit_rows: FitBoundary,
    #[serde(default = "default_predict_boundary")]
    pub predict_rows: FitBoundary,
    #[serde(default)]
    pub feature_namespace: Option<String>,
    #[serde(default)]
    pub feature_schema_fingerprint: Option<String>,
    #[serde(default = "default_target_space")]
    pub target_space: String,
    #[serde(default)]
    pub aggregation_policy: AggregationPolicy,
    #[serde(default)]
    pub augmentation_policy: AugmentationPolicy,
    #[serde(default)]
    pub selection_policy: FeatureSelectionPolicy,
}

impl DataModelShapePlan {
    pub fn validate(&self) -> Result<()> {
        if self.target_space.trim().is_empty() {
            return Err(DagMlError::CampaignValidation(format!(
                "shape plan for `{}` has empty target_space",
                self.node_id
            )));
        }
        if self
            .feature_namespace
            .as_ref()
            .is_some_and(|namespace| namespace.trim().is_empty())
        {
            return Err(DagMlError::CampaignValidation(format!(
                "shape plan for `{}` has empty feature_namespace",
                self.node_id
            )));
        }
        if self
            .feature_schema_fingerprint
            .as_ref()
            .is_some_and(|fingerprint| !is_hex_fingerprint(fingerprint))
        {
            return Err(DagMlError::CampaignValidation(format!(
                "shape plan for `{}` has invalid feature_schema_fingerprint",
                self.node_id
            )));
        }
        self.aggregation_policy.validate()?;
        self.augmentation_policy.validate()?;
        self.selection_policy.validate()?;
        if self.selection_policy.scope == FeatureSelectionScope::SupervisedFoldTrain
            && self.fit_rows != FitBoundary::FoldTrain
        {
            return Err(DagMlError::CampaignValidation(format!(
                "supervised feature selection for `{}` must fit on fold_train",
                self.node_id
            )));
        }
        Ok(())
    }
}

fn is_hex_fingerprint(value: &str) -> bool {
    value.len() == 64 && value.chars().all(|ch| ch.is_ascii_hexdigit())
}

fn default_granularity() -> Granularity {
    Granularity::Sample
}

fn default_fit_boundary() -> FitBoundary {
    FitBoundary::FoldTrain
}

fn default_predict_boundary() -> FitBoundary {
    FitBoundary::FoldValidation
}

fn default_target_space() -> String {
    "raw".to_string()
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShapeDeltaKind {
    Row,
    Feature,
    Target,
    Prediction,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ShapeDelta {
    pub node_id: NodeId,
    pub kind: ShapeDeltaKind,
    pub before_fingerprint: String,
    pub after_fingerprint: String,
    #[serde(default)]
    pub metadata: BTreeMap<String, serde_json::Value>,
}

impl ShapeDelta {
    pub fn validate(&self) -> Result<()> {
        if self.before_fingerprint.trim().is_empty() || self.after_fingerprint.trim().is_empty() {
            return Err(DagMlError::RuntimeValidation(format!(
                "shape delta for `{}` has empty fingerprint",
                self.node_id
            )));
        }
        if self.before_fingerprint == self.after_fingerprint {
            return Err(DagMlError::RuntimeValidation(format!(
                "shape delta for `{}` does not change fingerprint",
                self.node_id
            )));
        }
        for key in self.metadata.keys() {
            if key.trim().is_empty() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "shape delta for `{}` contains an empty metadata key",
                    self.node_id
                )));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ids::NodeId;

    #[test]
    fn repeated_measurements_default_to_sample_level_aggregation() {
        let leakage = LeakageUnitPolicy::default();
        let aggregation = AggregationPolicy::default();

        assert_eq!(leakage.split_unit, SplitUnit::PhysicalSample);
        assert_eq!(aggregation.aggregation_level, PredictionLevel::Sample);
        assert!(aggregation.emit_parallel_metrics);
    }

    #[test]
    fn observation_split_requires_explicit_unsafe_policy() {
        let policy = LeakageUnitPolicy {
            split_unit: SplitUnit::Observation,
            ..LeakageUnitPolicy::default()
        };

        assert!(policy.validate().is_err());
    }

    #[test]
    fn weighted_aggregation_requires_explicit_weight_policy() {
        let missing_weights = AggregationPolicy {
            method: AggregationMethod::WeightedMean,
            weights: AggregationWeights::None,
            ..AggregationPolicy::default()
        };
        assert!(missing_weights.validate().is_err());

        let stray_weights = AggregationPolicy {
            method: AggregationMethod::Mean,
            weights: AggregationWeights::ControllerEmitted,
            ..AggregationPolicy::default()
        };
        assert!(stray_weights.validate().is_err());

        let valid = AggregationPolicy {
            method: AggregationMethod::WeightedMean,
            weights: AggregationWeights::ControllerEmitted,
            ..AggregationPolicy::default()
        };
        valid.validate().unwrap();
    }

    #[test]
    fn custom_aggregation_requires_controller_spec() {
        let missing_controller = AggregationPolicy {
            method: AggregationMethod::CustomController,
            ..AggregationPolicy::default()
        };
        assert!(missing_controller.validate().is_err());

        let stray_controller = AggregationPolicy {
            custom_controller: Some(AggregationControllerSpec {
                controller_id: ControllerId::new("controller:agg").unwrap(),
                params: serde_json::json!({}),
            }),
            ..AggregationPolicy::default()
        };
        assert!(stray_controller.validate().is_err());

        let valid = AggregationPolicy {
            method: AggregationMethod::CustomController,
            weights: AggregationWeights::ControllerEmitted,
            custom_controller: Some(AggregationControllerSpec {
                controller_id: ControllerId::new("controller:agg").unwrap(),
                params: serde_json::json!({ "trim": 0.1 }),
            }),
            ..AggregationPolicy::default()
        };
        valid.validate().unwrap();
    }

    #[test]
    fn reduction_plan_validates_weight_controller_and_task_contracts() {
        let weighted = ReductionPlan {
            method: ReductionMethod::WeightedMean,
            weight_source: AggregationWeights::Quality,
            ..ReductionPlan::default()
        };
        weighted.validate().unwrap();

        let fold_ensemble = ReductionPlan {
            role: ReductionRole::FoldEnsemble,
            axis: ReductionAxis::Fold,
            input_unit_level: EntityUnitLevel::PhysicalSample,
            output_unit_level: EntityUnitLevel::PhysicalSample,
            ..ReductionPlan::default()
        };
        fold_ensemble.validate().unwrap();

        let model_meta_feature = ReductionPlan {
            role: ReductionRole::MetaFeature,
            axis: ReductionAxis::Model,
            input_unit_level: EntityUnitLevel::PhysicalSample,
            output_unit_level: EntityUnitLevel::PhysicalSample,
            ..ReductionPlan::default()
        };
        model_meta_feature.validate().unwrap();

        let missing_weight_source = ReductionPlan {
            method: ReductionMethod::WeightedMean,
            ..ReductionPlan::default()
        };
        assert!(missing_weight_source.validate().is_err());

        let invalid_vote = ReductionPlan {
            method: ReductionMethod::Vote,
            task_compatibility: ReductionTaskCompatibility::Regression,
            ..ReductionPlan::default()
        };
        assert!(invalid_vote.validate().is_err());

        let custom = ReductionPlan {
            method: ReductionMethod::Custom,
            custom_controller: Some(AggregationControllerSpec {
                controller_id: ControllerId::new("controller:agg.robust").unwrap(),
                params: serde_json::json!({ "trim_fraction": 0.2 }),
            }),
            params: BTreeMap::from([("trim_fraction".to_string(), serde_json::json!(0.2))]),
            ..ReductionPlan::default()
        };
        custom.validate().unwrap();

        let invalid_trim = ReductionPlan {
            method: ReductionMethod::RobustMean,
            params: BTreeMap::from([("trim_fraction".to_string(), serde_json::json!(0.75))]),
            ..ReductionPlan::default()
        };
        assert!(invalid_trim.validate().is_err());
    }

    #[test]
    fn supervised_selection_must_fit_on_fold_train() {
        let plan = DataModelShapePlan {
            node_id: NodeId::new("model:pls").unwrap(),
            fit_rows: FitBoundary::FullTrain,
            selection_policy: FeatureSelectionPolicy {
                scope: FeatureSelectionScope::SupervisedFoldTrain,
                ..FeatureSelectionPolicy::default()
            },
            ..DataModelShapePlan {
                node_id: NodeId::new("model:pls").unwrap(),
                input_granularity: Granularity::Observation,
                target_granularity: Granularity::Sample,
                fit_rows: FitBoundary::FoldTrain,
                predict_rows: FitBoundary::FoldValidation,
                feature_namespace: None,
                feature_schema_fingerprint: None,
                target_space: "raw".to_string(),
                aggregation_policy: AggregationPolicy::default(),
                augmentation_policy: AugmentationPolicy::default(),
                selection_policy: FeatureSelectionPolicy::default(),
            }
        };

        assert!(plan.validate().is_err());
    }

    #[test]
    fn augmentation_policy_requires_explicit_unsafe_flags_for_leaky_sample_augmentation() {
        let policy = AugmentationPolicy {
            sample_scope: AugmentationScope::AllPartitions,
            ..AugmentationPolicy::default()
        };
        assert!(policy.validate().is_err());

        let mut allowed = policy;
        allowed.unsafe_flags = BTreeSet::from([
            AugmentationPolicy::ALLOW_SAMPLE_AUGMENTATION_ALL_PARTITIONS.to_string(),
        ]);
        allowed.validate().unwrap();

        let no_origin = AugmentationPolicy {
            require_origin_id: false,
            ..AugmentationPolicy::default()
        };
        assert!(no_origin.validate().is_err());
    }

    #[test]
    fn shape_plan_validates_feature_and_selection_audit_contracts() {
        let node_id = NodeId::new("model:pls").unwrap();
        let base = DataModelShapePlan {
            node_id: node_id.clone(),
            input_granularity: Granularity::Sample,
            target_granularity: Granularity::Sample,
            fit_rows: FitBoundary::FoldTrain,
            predict_rows: FitBoundary::FoldValidation,
            feature_namespace: None,
            feature_schema_fingerprint: None,
            target_space: "raw".to_string(),
            aggregation_policy: AggregationPolicy::default(),
            augmentation_policy: AugmentationPolicy::default(),
            selection_policy: FeatureSelectionPolicy::default(),
        };

        let mut empty_namespace = base.clone();
        empty_namespace.feature_namespace = Some(" ".to_string());
        assert!(empty_namespace.validate().is_err());

        let mut bad_fingerprint = base.clone();
        bad_fingerprint.feature_schema_fingerprint = Some("short".to_string());
        assert!(bad_fingerprint.validate().is_err());

        let mut supervised_without_masks = base;
        supervised_without_masks.selection_policy = FeatureSelectionPolicy {
            scope: FeatureSelectionScope::SupervisedFoldTrain,
            store_masks: false,
            allow_schema_mismatch_on_join: false,
        };
        assert!(supervised_without_masks.validate().is_err());
    }

    #[test]
    fn shape_delta_requires_a_real_fingerprint_change() {
        let delta = ShapeDelta {
            node_id: NodeId::new("transform:select").unwrap(),
            kind: ShapeDeltaKind::Feature,
            before_fingerprint: "a".repeat(64),
            after_fingerprint: "a".repeat(64),
            metadata: BTreeMap::new(),
        };
        assert!(delta.validate().is_err());

        let mut bad_metadata = delta;
        bad_metadata.after_fingerprint = "b".repeat(64);
        bad_metadata
            .metadata
            .insert(" ".to_string(), serde_json::Value::Bool(true));
        assert!(bad_metadata.validate().is_err());
    }
}
