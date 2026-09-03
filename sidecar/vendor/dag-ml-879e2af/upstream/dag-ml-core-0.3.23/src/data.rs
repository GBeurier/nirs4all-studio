use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::campaign::stable_json_fingerprint;
use crate::error::{DagMlError, Result};
use crate::fold::FoldSet;
use crate::ids::{ControllerId, FoldId, NodeId, RunId, SampleId, VariantId};
use crate::phase::Phase;
use crate::policy::FitInfluencePolicy;
use crate::relation::{EntityUnitLevel, SampleRelationSet};
use crate::runtime::{
    DataMaterializationRequest, DataProviderViewSpec, DataViewRequest, HandleKind, HandleRef,
    RuntimeDataProvider,
};

/// The frozen CV/OOF-only external-envelope format.
pub const EXTERNAL_DATA_PLAN_ENVELOPE_SCHEMA_VERSION_V1: u32 = 1;
/// The additive envelope format that can carry a separately attested PREDICT
/// cohort. It never broadens the V1 coordinator relation universe.
pub const EXTERNAL_DATA_PLAN_ENVELOPE_SCHEMA_VERSION_V2: u32 = 2;
/// Existing writers deliberately remain V1 until the PREDICT-cohort scheduler
/// route is implemented. This alias preserves their exact wire output.
pub const EXTERNAL_DATA_PLAN_ENVELOPE_SCHEMA_VERSION: u32 =
    EXTERNAL_DATA_PLAN_ENVELOPE_SCHEMA_VERSION_V1;
pub const MODEL_INPUT_SPEC_SCHEMA_VERSION: u32 = 1;
pub const MODEL_INPUT_SPEC_SCHEMA_ID: &str =
    "https://github.com/GBeurier/dag-ml/schemas/model_input_spec.v1.schema.json";
pub const DATA_PLAN_SCHEMA_VERSION: u32 = 1;
pub const DATA_PLAN_SCHEMA_ID: &str =
    "https://github.com/GBeurier/dag-ml/schemas/data_plan.v1.schema.json";
pub const SOURCE_INDEX_METADATA_KEY: &str = "source_index";

fn default_external_data_plan_envelope_schema_version() -> u32 {
    EXTERNAL_DATA_PLAN_ENVELOPE_SCHEMA_VERSION_V1
}

fn default_model_input_spec_schema_version() -> u32 {
    MODEL_INPUT_SPEC_SCHEMA_VERSION
}

fn default_data_plan_schema_version() -> u32 {
    DATA_PLAN_SCHEMA_VERSION
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DataRequestPartition {
    FoldTrain,
    FoldValidation,
    FullTrain,
    Predict,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelInputFusionMode {
    SingleSource,
    ConcatenateFeatures,
    StackSamples,
    DictBySource,
    Custom,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BranchViewMode {
    Separation,
    BySource,
    ByMetadata,
    ByTag,
    ByFilter,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct DataViewSelector {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub source_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, serde_json::Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter: Option<serde_json::Value>,
}

impl DataViewSelector {
    pub fn validate(&self, label: &str) -> Result<()> {
        if self.source_ids.is_empty()
            && self.metadata.is_empty()
            && self.tags.is_empty()
            && self.filter.is_none()
        {
            return Err(DagMlError::CampaignValidation(format!(
                "{label} selector must constrain source_ids, metadata, tags or filter"
            )));
        }
        validate_string_list_entries(&format!("{label} selector source_ids"), &self.source_ids)?;
        validate_unique_strings(&format!("{label} selector source_ids"), &self.source_ids)?;
        validate_string_list_entries(&format!("{label} selector tags"), &self.tags)?;
        validate_unique_strings(&format!("{label} selector tags"), &self.tags)?;
        for key in self.metadata.keys() {
            if key.trim().is_empty() {
                return Err(DagMlError::CampaignValidation(format!(
                    "{label} selector contains an empty metadata key"
                )));
            }
        }
        if matches!(self.filter, Some(serde_json::Value::Null)) {
            return Err(DagMlError::CampaignValidation(format!(
                "{label} selector filter must not be null"
            )));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BranchViewPlan {
    pub view_id: String,
    pub branch_id: String,
    pub mode: BranchViewMode,
    pub selector: DataViewSelector,
    #[serde(default)]
    pub allow_overlap: bool,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, serde_json::Value>,
}

impl BranchViewPlan {
    pub fn validate(&self) -> Result<()> {
        validate_non_empty("branch view plan view_id", &self.view_id)?;
        validate_non_empty("branch view plan branch_id", &self.branch_id)?;
        self.selector
            .validate(&format!("branch view `{}`", self.view_id))?;
        match self.mode {
            BranchViewMode::BySource if self.selector.source_ids.is_empty() => {
                return Err(DagMlError::CampaignValidation(format!(
                    "branch view `{}` mode=by_source requires source_ids",
                    self.view_id
                )));
            }
            BranchViewMode::ByMetadata if self.selector.metadata.is_empty() => {
                return Err(DagMlError::CampaignValidation(format!(
                    "branch view `{}` mode=by_metadata requires metadata",
                    self.view_id
                )));
            }
            BranchViewMode::ByTag if self.selector.tags.is_empty() => {
                return Err(DagMlError::CampaignValidation(format!(
                    "branch view `{}` mode=by_tag requires tags",
                    self.view_id
                )));
            }
            BranchViewMode::ByFilter if self.selector.filter.is_none() => {
                return Err(DagMlError::CampaignValidation(format!(
                    "branch view `{}` mode=by_filter requires filter",
                    self.view_id
                )));
            }
            _ => {}
        }
        for key in self.metadata.keys() {
            if key.trim().is_empty() {
                return Err(DagMlError::CampaignValidation(format!(
                    "branch view `{}` metadata contains an empty key",
                    self.view_id
                )));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CombinationMode {
    #[default]
    Cartesian,
    Zip,
    MatchBy,
    SampleK,
    ReferenceBroadcast,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RepresentationMissingSourcePolicy {
    Strict,
    Warn,
    DropIncomplete,
    ImputeDeclared,
    Mask,
    PartialModel,
    Pad,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RepresentationCardinality {
    OneToOne,
    OneToMany,
    ManyToOne,
    ManyToMany,
    BoundedMany,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CombinationPlan {
    pub mode: CombinationMode,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub component_source_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub component_unit_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub match_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference_source_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seed: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cap: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub budget: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub missing_source_policy: Option<RepresentationMissingSourcePolicy>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, serde_json::Value>,
}

impl CombinationPlan {
    pub fn validate(&self) -> Result<()> {
        validate_string_list_entries(
            "combination plan component_source_ids",
            &self.component_source_ids,
        )?;
        validate_unique_strings(
            "combination plan component_source_ids",
            &self.component_source_ids,
        )?;
        validate_string_list_entries(
            "combination plan component_unit_ids",
            &self.component_unit_ids,
        )?;
        validate_unique_strings(
            "combination plan component_unit_ids",
            &self.component_unit_ids,
        )?;
        validate_optional_non_empty("combination plan match_key", &self.match_key)?;
        validate_optional_non_empty(
            "combination plan reference_source_id",
            &self.reference_source_id,
        )?;
        if self.cap == Some(0) {
            return Err(DagMlError::CampaignValidation(
                "combination plan cap must be positive when present".to_string(),
            ));
        }
        if self.budget == Some(0) {
            return Err(DagMlError::CampaignValidation(
                "combination plan budget must be positive when present".to_string(),
            ));
        }
        match self.mode {
            CombinationMode::Cartesian => {
                if self.component_source_ids.len() < 2 {
                    return Err(DagMlError::CampaignValidation(
                        "cartesian combination requires at least two component_source_ids"
                            .to_string(),
                    ));
                }
            }
            CombinationMode::Zip => {
                if self.component_source_ids.len() < 2 {
                    return Err(DagMlError::CampaignValidation(
                        "zip combination requires at least two component_source_ids".to_string(),
                    ));
                }
            }
            CombinationMode::MatchBy => {
                if self.match_key.is_none() {
                    return Err(DagMlError::CampaignValidation(
                        "match_by combination requires match_key".to_string(),
                    ));
                }
            }
            CombinationMode::SampleK => {
                if self.seed.is_none() {
                    return Err(DagMlError::CampaignValidation(
                        "sample_k combination requires seed".to_string(),
                    ));
                }
                if self.cap.is_none() {
                    return Err(DagMlError::CampaignValidation(
                        "sample_k combination requires cap".to_string(),
                    ));
                }
            }
            CombinationMode::ReferenceBroadcast => {
                let Some(reference) = &self.reference_source_id else {
                    return Err(DagMlError::CampaignValidation(
                        "reference_broadcast combination requires reference_source_id".to_string(),
                    ));
                };
                if !self.component_source_ids.is_empty()
                    && !self
                        .component_source_ids
                        .iter()
                        .any(|source| source == reference)
                {
                    return Err(DagMlError::CampaignValidation(format!(
                        "reference_broadcast reference_source_id `{reference}` is not in component_source_ids"
                    )));
                }
            }
        }
        for key in self.metadata.keys() {
            if key.trim().is_empty() {
                return Err(DagMlError::CampaignValidation(
                    "combination plan metadata contains an empty key".to_string(),
                ));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum RepresentationPlan {
    Aggregate(AggregateRepresentation),
    CartesianProduct(CartesianProductRepresentation),
    MonteCarloCartesian(MonteCarloCartesianRepresentation),
    StackFixed(StackFixedRepresentation),
    StackPaddedMasked(StackPaddedMaskedRepresentation),
}

impl RepresentationPlan {
    pub fn validate(&self) -> Result<()> {
        match self {
            Self::Aggregate(plan) => plan.validate(),
            Self::CartesianProduct(plan) => plan.validate(),
            Self::MonteCarloCartesian(plan) => plan.validate(),
            Self::StackFixed(plan) => plan.validate(),
            Self::StackPaddedMasked(plan) => plan.validate(),
        }
    }

    pub fn output_unit_level(&self) -> EntityUnitLevel {
        match self {
            Self::Aggregate(plan) => plan.output_unit_level,
            Self::CartesianProduct(plan) => plan.output_unit_level,
            Self::MonteCarloCartesian(plan) => plan.output_unit_level,
            Self::StackFixed(plan) => plan.output_unit_level,
            Self::StackPaddedMasked(plan) => plan.output_unit_level,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AggregateRepresentation {
    pub input_unit_level: EntityUnitLevel,
    pub output_unit_level: EntityUnitLevel,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reducer_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    pub cardinality: RepresentationCardinality,
}

impl AggregateRepresentation {
    pub fn validate(&self) -> Result<()> {
        validate_optional_non_empty("aggregate representation reducer_id", &self.reducer_id)?;
        validate_optional_non_empty("aggregate representation method", &self.method)?;
        if self.cardinality != RepresentationCardinality::ManyToOne {
            return Err(DagMlError::CampaignValidation(
                "aggregate representation cardinality must be many_to_one".to_string(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CartesianProductRepresentation {
    pub combination_plan: CombinationPlan,
    pub output_unit_level: EntityUnitLevel,
    pub cardinality: RepresentationCardinality,
    #[serde(default = "default_true")]
    pub preserve_provenance: bool,
}

impl CartesianProductRepresentation {
    pub fn validate(&self) -> Result<()> {
        self.combination_plan.validate()?;
        if self.combination_plan.mode != CombinationMode::Cartesian {
            return Err(DagMlError::CampaignValidation(
                "cartesian_product representation requires combination_plan.mode=cartesian"
                    .to_string(),
            ));
        }
        validate_combo_like_output("cartesian_product", self.output_unit_level)?;
        if self.cardinality != RepresentationCardinality::ManyToMany {
            return Err(DagMlError::CampaignValidation(
                "cartesian_product representation cardinality must be many_to_many".to_string(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MonteCarloCartesianRepresentation {
    pub combination_plan: CombinationPlan,
    pub output_unit_level: EntityUnitLevel,
    pub cardinality: RepresentationCardinality,
    #[serde(default = "default_true")]
    pub preserve_provenance: bool,
}

impl MonteCarloCartesianRepresentation {
    pub fn validate(&self) -> Result<()> {
        self.combination_plan.validate()?;
        if self.combination_plan.mode != CombinationMode::SampleK {
            return Err(DagMlError::CampaignValidation(
                "monte_carlo_cartesian representation requires combination_plan.mode=sample_k"
                    .to_string(),
            ));
        }
        validate_combo_like_output("monte_carlo_cartesian", self.output_unit_level)?;
        if self.cardinality != RepresentationCardinality::BoundedMany {
            return Err(DagMlError::CampaignValidation(
                "monte_carlo_cartesian representation cardinality must be bounded_many".to_string(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StackFixedRepresentation {
    pub output_unit_level: EntityUnitLevel,
    pub cardinality: RepresentationCardinality,
    pub expected_cardinality: usize,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub component_source_ids: Vec<String>,
}

impl StackFixedRepresentation {
    pub fn validate(&self) -> Result<()> {
        if self.expected_cardinality == 0 {
            return Err(DagMlError::CampaignValidation(
                "stack_fixed representation expected_cardinality must be positive".to_string(),
            ));
        }
        if self.cardinality != RepresentationCardinality::OneToMany {
            return Err(DagMlError::CampaignValidation(
                "stack_fixed representation cardinality must be one_to_many".to_string(),
            ));
        }
        validate_string_list_entries(
            "stack_fixed representation component_source_ids",
            &self.component_source_ids,
        )?;
        validate_unique_strings(
            "stack_fixed representation component_source_ids",
            &self.component_source_ids,
        )
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StackPaddedMaskedRepresentation {
    pub output_unit_level: EntityUnitLevel,
    pub cardinality: RepresentationCardinality,
    pub expected_cardinality: usize,
    pub missing_source_policy: RepresentationMissingSourcePolicy,
    #[serde(default = "default_true")]
    pub requires_missing_masks: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub component_source_ids: Vec<String>,
}

impl StackPaddedMaskedRepresentation {
    pub fn validate(&self) -> Result<()> {
        if self.expected_cardinality == 0 {
            return Err(DagMlError::CampaignValidation(
                "stack_padded_masked representation expected_cardinality must be positive"
                    .to_string(),
            ));
        }
        if self.cardinality != RepresentationCardinality::BoundedMany {
            return Err(DagMlError::CampaignValidation(
                "stack_padded_masked representation cardinality must be bounded_many".to_string(),
            ));
        }
        if !matches!(
            self.missing_source_policy,
            RepresentationMissingSourcePolicy::Mask | RepresentationMissingSourcePolicy::Pad
        ) {
            return Err(DagMlError::CampaignValidation(
                "stack_padded_masked representation requires missing_source_policy=mask or pad"
                    .to_string(),
            ));
        }
        if !self.requires_missing_masks {
            return Err(DagMlError::CampaignValidation(
                "stack_padded_masked representation requires missing-mask controller support"
                    .to_string(),
            ));
        }
        validate_string_list_entries(
            "stack_padded_masked representation component_source_ids",
            &self.component_source_ids,
        )?;
        validate_unique_strings(
            "stack_padded_masked representation component_source_ids",
            &self.component_source_ids,
        )
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RepresentationSampleObservationMapping {
    pub physical_sample_id: String,
    pub source_id: String,
    pub observation_ids: Vec<String>,
}

impl RepresentationSampleObservationMapping {
    pub fn validate(&self) -> Result<()> {
        validate_non_empty(
            "representation sample observation mapping physical_sample_id",
            &self.physical_sample_id,
        )?;
        validate_non_empty(
            "representation sample observation mapping source_id",
            &self.source_id,
        )?;
        validate_non_empty_list(
            "representation sample observation mapping observation_ids",
            &self.observation_ids,
        )?;
        validate_unique_strings(
            "representation sample observation mapping observation_ids",
            &self.observation_ids,
        )
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RepresentationComboSelectionRecord {
    pub combo_unit_id: String,
    pub physical_sample_id: String,
    pub component_observation_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seed: Option<u64>,
}

impl RepresentationComboSelectionRecord {
    pub fn validate(&self) -> Result<()> {
        validate_non_empty(
            "representation combo selection combo_unit_id",
            &self.combo_unit_id,
        )?;
        validate_non_empty(
            "representation combo selection physical_sample_id",
            &self.physical_sample_id,
        )?;
        validate_non_empty_list(
            "representation combo selection component_observation_ids",
            &self.component_observation_ids,
        )?;
        validate_unique_strings(
            "representation combo selection component_observation_ids",
            &self.component_observation_ids,
        )
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RepresentationCompatibilitySeverity {
    Info,
    Warning,
    Error,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RepresentationCompatibilityOutcome {
    Compatible,
    CompatibleWithFallback,
    Incompatible,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RepresentationCompatibilityReport {
    pub policy: RepresentationMissingSourcePolicy,
    pub outcome: RepresentationCompatibilityOutcome,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fallback_used: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warning_severity: Option<RepresentationCompatibilitySeverity>,
    #[serde(default)]
    pub affected_source_count: u64,
    #[serde(default)]
    pub affected_repetition_count: u64,
    #[serde(default)]
    pub affected_sample_count: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub train_relation_fingerprint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub predict_relation_fingerprint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub train_unit_count: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub predict_unit_count: Option<u64>,
    #[serde(default)]
    pub fixed_width_required: bool,
    #[serde(default)]
    pub final_reducer_stabilizes_output: bool,
    #[serde(default)]
    pub cartesian_combo_count_changed: bool,
    #[serde(default)]
    pub late_fusion_branch_delta: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub messages: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, serde_json::Value>,
}

impl RepresentationCompatibilityReport {
    pub fn validate(&self) -> Result<()> {
        validate_optional_non_empty(
            "representation compatibility fallback_used",
            &self.fallback_used,
        )?;
        if let Some(fingerprint) = &self.train_relation_fingerprint {
            validate_fingerprint("representation compatibility train relation", fingerprint)?;
        }
        if let Some(fingerprint) = &self.predict_relation_fingerprint {
            validate_fingerprint("representation compatibility predict relation", fingerprint)?;
        }
        validate_string_list_entries("representation compatibility messages", &self.messages)?;
        for key in self.metadata.keys() {
            if key.trim().is_empty() {
                return Err(DagMlError::CampaignValidation(
                    "representation compatibility metadata contains an empty key".to_string(),
                ));
            }
        }

        let affected_total = self
            .affected_source_count
            .saturating_add(self.affected_repetition_count)
            .saturating_add(self.affected_sample_count);
        let relation_fingerprint_changed = matches!(
            (
                self.train_relation_fingerprint.as_deref(),
                self.predict_relation_fingerprint.as_deref()
            ),
            (Some(train), Some(predict)) if train != predict
        );
        let unit_count_changed = matches!(
            (self.train_unit_count, self.predict_unit_count),
            (Some(train), Some(predict)) if train != predict
        );
        if affected_total == 0 {
            if relation_fingerprint_changed {
                return Err(DagMlError::CampaignValidation(
                    "representation compatibility relation fingerprint mismatch requires affected units"
                        .to_string(),
                ));
            }
            if unit_count_changed {
                return Err(DagMlError::CampaignValidation(
                    "representation compatibility unit count mismatch requires affected units"
                        .to_string(),
                ));
            }
            if self.outcome == RepresentationCompatibilityOutcome::CompatibleWithFallback {
                return Err(DagMlError::CampaignValidation(
                    "representation compatibility cannot use fallback when no units are affected"
                        .to_string(),
                ));
            }
            if self.warning_severity.is_some() {
                return Err(DagMlError::CampaignValidation(
                    "representation compatibility warning_severity requires affected units"
                        .to_string(),
                ));
            }
        } else if self.policy == RepresentationMissingSourcePolicy::Strict {
            if self.outcome != RepresentationCompatibilityOutcome::Incompatible {
                return Err(DagMlError::CampaignValidation(
                    "strict representation compatibility with affected units must be incompatible"
                        .to_string(),
                ));
            }
            if self.fallback_used.is_some() {
                return Err(DagMlError::CampaignValidation(
                    "strict representation compatibility cannot declare fallback_used".to_string(),
                ));
            }
        } else {
            if self.warning_severity.is_none() {
                return Err(DagMlError::CampaignValidation(
                    "non-strict representation compatibility with affected units requires warning_severity"
                        .to_string(),
                ));
            }
            if self.outcome == RepresentationCompatibilityOutcome::Compatible {
                return Err(DagMlError::CampaignValidation(
                    "representation compatibility with affected units cannot be compatible"
                        .to_string(),
                ));
            }
            if self.outcome == RepresentationCompatibilityOutcome::CompatibleWithFallback
                && self.fallback_used.is_none()
            {
                return Err(DagMlError::CampaignValidation(
                    "compatible_with_fallback representation compatibility requires fallback_used"
                        .to_string(),
                ));
            }
        }

        if self.outcome == RepresentationCompatibilityOutcome::Incompatible
            && self.fallback_used.is_some()
        {
            return Err(DagMlError::CampaignValidation(
                "incompatible representation compatibility cannot declare fallback_used"
                    .to_string(),
            ));
        }

        if self.fixed_width_required && unit_count_changed && !self.allows_fixed_width_fallback() {
            if self.outcome == RepresentationCompatibilityOutcome::Incompatible {
                return Ok(());
            }
            return Err(DagMlError::CampaignValidation(
                "fixed-width representation compatibility mismatch requires mask or pad policy/fallback"
                    .to_string(),
            ));
        }
        if self.cartesian_combo_count_changed && !self.final_reducer_stabilizes_output {
            if self.outcome == RepresentationCompatibilityOutcome::Incompatible {
                return Ok(());
            }
            return Err(DagMlError::CampaignValidation(
                "cartesian representation combo count may vary only when final reducer stabilizes output"
                    .to_string(),
            ));
        }
        if self.late_fusion_branch_delta && !self.allows_late_fusion_delta() {
            if self.outcome == RepresentationCompatibilityOutcome::Incompatible {
                return Ok(());
            }
            return Err(DagMlError::CampaignValidation(
                "late-fusion source deltas require an explicit drop/impute/mask/partial-model/pad policy or fallback"
                    .to_string(),
            ));
        }
        Ok(())
    }

    fn allows_fixed_width_fallback(&self) -> bool {
        matches!(
            self.policy,
            RepresentationMissingSourcePolicy::Mask | RepresentationMissingSourcePolicy::Pad
        ) || self
            .fallback_used
            .as_deref()
            .is_some_and(|fallback| matches!(fallback, "mask" | "pad"))
    }

    fn allows_late_fusion_delta(&self) -> bool {
        matches!(
            self.policy,
            RepresentationMissingSourcePolicy::DropIncomplete
                | RepresentationMissingSourcePolicy::ImputeDeclared
                | RepresentationMissingSourcePolicy::Mask
                | RepresentationMissingSourcePolicy::PartialModel
                | RepresentationMissingSourcePolicy::Pad
        ) || self.fallback_used.as_deref().is_some_and(|fallback| {
            matches!(
                fallback,
                "drop_incomplete" | "impute_declared" | "mask" | "partial_model" | "pad"
            )
        })
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RepresentationReplayManifest {
    pub manifest_id: String,
    pub representation_plan: RepresentationPlan,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub combination_plan: Option<CombinationPlan>,
    pub output_unit_level: EntityUnitLevel,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_representation: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relation_fingerprint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub feature_schema_fingerprint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub final_reduction_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sample_observation_mapping: Vec<RepresentationSampleObservationMapping>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub combo_selection: Vec<RepresentationComboSelectionRecord>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub qc_policy_refs: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub outlier_policy_refs: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub missing_source_policy: Option<RepresentationMissingSourcePolicy>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub missing_repetition_policy: Option<RepresentationMissingSourcePolicy>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prediction_representation: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub final_output_unit_level: Option<EntityUnitLevel>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub train_compatibility: Option<RepresentationCompatibilityReport>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub predict_compatibility: Option<RepresentationCompatibilityReport>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, serde_json::Value>,
}

impl RepresentationReplayManifest {
    pub fn validate(&self) -> Result<()> {
        validate_non_empty("representation replay manifest_id", &self.manifest_id)?;
        self.representation_plan.validate()?;
        if let Some(combination_plan) = &self.combination_plan {
            combination_plan.validate()?;
        }
        if self.output_unit_level != self.representation_plan.output_unit_level() {
            return Err(DagMlError::CampaignValidation(
                "representation replay output_unit_level must match representation_plan"
                    .to_string(),
            ));
        }
        validate_optional_non_empty(
            "representation replay output_representation",
            &self.output_representation,
        )?;
        validate_optional_non_empty(
            "representation replay final_reduction_id",
            &self.final_reduction_id,
        )?;
        validate_string_list_entries("representation replay qc_policy_refs", &self.qc_policy_refs)?;
        validate_unique_strings("representation replay qc_policy_refs", &self.qc_policy_refs)?;
        validate_string_list_entries(
            "representation replay outlier_policy_refs",
            &self.outlier_policy_refs,
        )?;
        validate_unique_strings(
            "representation replay outlier_policy_refs",
            &self.outlier_policy_refs,
        )?;
        validate_optional_non_empty(
            "representation replay prediction_representation",
            &self.prediction_representation,
        )?;
        let mut sample_source_pairs = BTreeSet::new();
        for mapping in &self.sample_observation_mapping {
            mapping.validate()?;
            if !sample_source_pairs.insert((
                mapping.physical_sample_id.as_str(),
                mapping.source_id.as_str(),
            )) {
                return Err(DagMlError::CampaignValidation(format!(
                    "representation replay sample_observation_mapping contains duplicate physical_sample_id/source_id `{}`/`{}`",
                    mapping.physical_sample_id, mapping.source_id
                )));
            }
        }
        let mut combo_unit_ids = BTreeSet::new();
        for record in &self.combo_selection {
            record.validate()?;
            if !combo_unit_ids.insert(record.combo_unit_id.as_str()) {
                return Err(DagMlError::CampaignValidation(format!(
                    "representation replay combo_selection contains duplicate combo_unit_id `{}`",
                    record.combo_unit_id
                )));
            }
        }
        if let Some(report) = &self.train_compatibility {
            report.validate()?;
        }
        if let Some(report) = &self.predict_compatibility {
            report.validate()?;
        }
        if let Some(fingerprint) = &self.relation_fingerprint {
            validate_fingerprint("representation replay relation", fingerprint)?;
        }
        if let Some(fingerprint) = &self.feature_schema_fingerprint {
            validate_fingerprint("representation replay feature schema", fingerprint)?;
        }
        for key in self.metadata.keys() {
            if key.trim().is_empty() {
                return Err(DagMlError::CampaignValidation(
                    "representation replay metadata contains an empty key".to_string(),
                ));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelInputFusionPolicy {
    pub mode: ModelInputFusionMode,
    #[serde(default)]
    pub alignment: Option<String>,
    #[serde(default)]
    pub adapter_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub representation_plan: Option<RepresentationPlan>,
    #[serde(default)]
    pub params: BTreeMap<String, serde_json::Value>,
}

impl ModelInputFusionPolicy {
    pub fn validate(&self) -> Result<()> {
        if self
            .alignment
            .as_ref()
            .is_some_and(|alignment| alignment.trim().is_empty())
        {
            return Err(DagMlError::CampaignValidation(
                "model input fusion policy has empty alignment".to_string(),
            ));
        }
        if self
            .adapter_id
            .as_ref()
            .is_some_and(|adapter_id| adapter_id.trim().is_empty())
        {
            return Err(DagMlError::CampaignValidation(
                "model input fusion policy has empty adapter_id".to_string(),
            ));
        }
        if self.mode == ModelInputFusionMode::Custom && self.adapter_id.is_none() {
            return Err(DagMlError::CampaignValidation(
                "custom model input fusion policy requires adapter_id".to_string(),
            ));
        }
        if let Some(representation_plan) = &self.representation_plan {
            representation_plan.validate()?;
        }
        for key in self.params.keys() {
            if key.trim().is_empty() {
                return Err(DagMlError::CampaignValidation(
                    "model input fusion policy contains an empty param key".to_string(),
                ));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelInputPortSpec {
    pub name: String,
    pub accepted_representations: Vec<String>,
    pub accepted_types: Vec<String>,
    #[serde(default)]
    pub rank: Option<u32>,
    #[serde(default)]
    pub multi_source: bool,
    #[serde(default)]
    pub optional: bool,
    #[serde(default)]
    pub metadata: BTreeMap<String, serde_json::Value>,
}

impl ModelInputPortSpec {
    pub fn validate(&self) -> Result<()> {
        validate_non_empty("model input port name", &self.name)?;
        validate_non_empty_list(
            "model input port accepted_representations",
            &self.accepted_representations,
        )?;
        validate_non_empty_list("model input port accepted_types", &self.accepted_types)?;
        validate_unique_strings(
            "model input port accepted_representations",
            &self.accepted_representations,
        )?;
        validate_unique_strings("model input port accepted_types", &self.accepted_types)?;
        if self.rank.is_some_and(|rank| rank > 16) {
            return Err(DagMlError::CampaignValidation(format!(
                "model input port `{}` rank must be <= 16",
                self.name
            )));
        }
        for key in self.metadata.keys() {
            if key.trim().is_empty() {
                return Err(DagMlError::CampaignValidation(format!(
                    "model input port `{}` contains an empty metadata key",
                    self.name
                )));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelInputSpec {
    #[serde(default = "default_model_input_spec_schema_version")]
    pub schema_version: u32,
    pub ports: Vec<ModelInputPortSpec>,
    #[serde(default)]
    pub default_fusion: Option<ModelInputFusionPolicy>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fit_influence_policy: Option<FitInfluencePolicy>,
    #[serde(default)]
    pub metadata: BTreeMap<String, serde_json::Value>,
}

impl ModelInputSpec {
    pub fn validate(&self) -> Result<()> {
        if self.schema_version != MODEL_INPUT_SPEC_SCHEMA_VERSION {
            return Err(DagMlError::CampaignValidation(format!(
                "model input spec uses unsupported schema_version {}, expected {}",
                self.schema_version, MODEL_INPUT_SPEC_SCHEMA_VERSION
            )));
        }
        if self.ports.is_empty() {
            return Err(DagMlError::CampaignValidation(
                "model input spec must declare at least one port".to_string(),
            ));
        }
        let mut names = BTreeSet::new();
        for port in &self.ports {
            port.validate()?;
            if !names.insert(port.name.as_str()) {
                return Err(DagMlError::CampaignValidation(format!(
                    "model input spec contains duplicate port `{}`",
                    port.name
                )));
            }
        }
        if let Some(default_fusion) = &self.default_fusion {
            default_fusion.validate()?;
        }
        for key in self.metadata.keys() {
            if key.trim().is_empty() {
                return Err(DagMlError::CampaignValidation(
                    "model input spec contains an empty metadata key".to_string(),
                ));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DataPlanStepKind {
    Materialize,
    Adapt,
    Align,
    Join,
    Collate,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DataPlanStep {
    pub kind: DataPlanStepKind,
    #[serde(default)]
    pub inputs: Vec<String>,
    pub output: String,
    #[serde(default)]
    pub adapter_id: Option<String>,
    #[serde(default)]
    pub params: BTreeMap<String, serde_json::Value>,
}

impl DataPlanStep {
    pub fn validate(&self, previous_outputs: &BTreeSet<String>) -> Result<()> {
        validate_non_empty("data plan step output", &self.output)?;
        if self.kind != DataPlanStepKind::Materialize && self.inputs.is_empty() {
            return Err(DagMlError::CampaignValidation(format!(
                "data plan step `{}` requires at least one input",
                self.output
            )));
        }
        for (index, input) in self.inputs.iter().enumerate() {
            validate_non_empty("data plan step input", input)?;
            if self.kind != DataPlanStepKind::Materialize && !previous_outputs.contains(input) {
                return Err(DagMlError::CampaignValidation(format!(
                    "data plan step `{}` input #{index} references `{input}` before it is produced",
                    self.output
                )));
            }
        }
        if self
            .adapter_id
            .as_ref()
            .is_some_and(|adapter_id| adapter_id.trim().is_empty())
        {
            return Err(DagMlError::CampaignValidation(format!(
                "data plan step `{}` has empty adapter_id",
                self.output
            )));
        }
        for key in self.params.keys() {
            if key.trim().is_empty() {
                return Err(DagMlError::CampaignValidation(format!(
                    "data plan step `{}` contains an empty param key",
                    self.output
                )));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DataPlan {
    #[serde(default = "default_data_plan_schema_version")]
    pub schema_version: u32,
    pub id: String,
    pub steps: Vec<DataPlanStep>,
    pub output_ports: BTreeMap<String, String>,
    #[serde(default)]
    pub warnings: Vec<String>,
    #[serde(default)]
    pub requires_user_choice: Vec<String>,
    #[serde(default)]
    pub metadata: BTreeMap<String, serde_json::Value>,
}

impl DataPlan {
    pub fn validate(&self) -> Result<()> {
        if self.schema_version != DATA_PLAN_SCHEMA_VERSION {
            return Err(DagMlError::CampaignValidation(format!(
                "data plan uses unsupported schema_version {}, expected {}",
                self.schema_version, DATA_PLAN_SCHEMA_VERSION
            )));
        }
        validate_non_empty("data plan id", &self.id)?;
        if self.steps.is_empty() {
            return Err(DagMlError::CampaignValidation(format!(
                "data plan `{}` must contain at least one step",
                self.id
            )));
        }
        let mut outputs = BTreeSet::new();
        for step in &self.steps {
            step.validate(&outputs)?;
            if !outputs.insert(step.output.clone()) {
                return Err(DagMlError::CampaignValidation(format!(
                    "data plan `{}` contains duplicate step output `{}`",
                    self.id, step.output
                )));
            }
        }
        if self.output_ports.is_empty() {
            return Err(DagMlError::CampaignValidation(format!(
                "data plan `{}` must declare at least one output port",
                self.id
            )));
        }
        for (port_name, output) in &self.output_ports {
            validate_non_empty("data plan output port", port_name)?;
            validate_non_empty("data plan output reference", output)?;
            if !outputs.contains(output) {
                return Err(DagMlError::CampaignValidation(format!(
                    "data plan `{}` output port `{port_name}` references unknown output `{output}`",
                    self.id
                )));
            }
        }
        validate_string_list_entries("data plan warnings", &self.warnings)?;
        validate_string_list_entries("data plan requires_user_choice", &self.requires_user_choice)?;
        for key in self.metadata.keys() {
            if key.trim().is_empty() {
                return Err(DagMlError::CampaignValidation(format!(
                    "data plan `{}` contains an empty metadata key",
                    self.id
                )));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct DataViewPolicy {
    #[serde(default = "default_fit_partition")]
    pub fit_partition: DataRequestPartition,
    #[serde(default = "default_predict_partition")]
    pub predict_partition: DataRequestPartition,
    #[serde(default)]
    pub include_augmented_train: bool,
    #[serde(default)]
    pub include_augmented_validation: bool,
    #[serde(default)]
    pub include_excluded: bool,
    #[serde(default = "default_true")]
    pub require_sample_ids: bool,
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub unsafe_flags: BTreeSet<String>,
}

impl Default for DataViewPolicy {
    fn default() -> Self {
        Self {
            fit_partition: DataRequestPartition::FoldTrain,
            predict_partition: DataRequestPartition::FoldValidation,
            include_augmented_train: true,
            include_augmented_validation: false,
            include_excluded: false,
            require_sample_ids: true,
            unsafe_flags: BTreeSet::new(),
        }
    }
}

impl DataViewPolicy {
    pub const ALLOW_FIT_CV_FULL_TRAIN_VIEW: &'static str = "allow_fit_cv_full_train_view";
    pub const ALLOW_FIT_CV_VALIDATION_VIEW: &'static str = "allow_fit_cv_validation_view";
    pub const ALLOW_AUGMENTED_VALIDATION_VIEW: &'static str = "allow_augmented_validation_view";
    pub const ALLOW_EXCLUDED_ROWS: &'static str = "allow_excluded_rows";

    pub fn validate(&self) -> Result<()> {
        for unsafe_flag in &self.unsafe_flags {
            if unsafe_flag.trim().is_empty() {
                return Err(DagMlError::CampaignValidation(
                    "data view policy contains an empty unsafe flag".to_string(),
                ));
            }
        }
        match self.fit_partition {
            DataRequestPartition::FoldTrain => {}
            DataRequestPartition::FullTrain
                if self
                    .unsafe_flags
                    .contains(Self::ALLOW_FIT_CV_FULL_TRAIN_VIEW) => {}
            DataRequestPartition::FoldValidation
                if self
                    .unsafe_flags
                    .contains(Self::ALLOW_FIT_CV_VALIDATION_VIEW) => {}
            DataRequestPartition::FullTrain => {
                return Err(DagMlError::CampaignValidation(
                    "data view policy fit_partition=full_train would leak validation rows during FIT_CV; add explicit unsafe flag allow_fit_cv_full_train_view".to_string(),
                ));
            }
            DataRequestPartition::FoldValidation => {
                return Err(DagMlError::CampaignValidation(
                    "data view policy fit_partition=fold_validation would train on validation rows during FIT_CV; add explicit unsafe flag allow_fit_cv_validation_view".to_string(),
                ));
            }
            DataRequestPartition::Predict => {
                return Err(DagMlError::CampaignValidation(
                    "data view policy fit_partition=predict is not valid for FIT_CV".to_string(),
                ));
            }
        }
        match self.predict_partition {
            DataRequestPartition::FoldValidation | DataRequestPartition::Predict => {}
            DataRequestPartition::FoldTrain | DataRequestPartition::FullTrain => {
                return Err(DagMlError::CampaignValidation(format!(
                    "data view policy predict_partition={:?} is not valid for validation/predict views",
                    self.predict_partition
                )));
            }
        }
        if self.include_augmented_validation
            && !self
                .unsafe_flags
                .contains(Self::ALLOW_AUGMENTED_VALIDATION_VIEW)
        {
            return Err(DagMlError::CampaignValidation(
                "data view policy include_augmented_validation=true can leak augmented validation/test rows; add explicit unsafe flag allow_augmented_validation_view".to_string(),
            ));
        }
        if self.include_excluded && !self.unsafe_flags.contains(Self::ALLOW_EXCLUDED_ROWS) {
            return Err(DagMlError::CampaignValidation(
                "data view policy include_excluded=true requires explicit unsafe flag allow_excluded_rows".to_string(),
            ));
        }
        Ok(())
    }
}

fn default_fit_partition() -> DataRequestPartition {
    DataRequestPartition::FoldTrain
}

fn default_predict_partition() -> DataRequestPartition {
    DataRequestPartition::FoldValidation
}

fn default_true() -> bool {
    true
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct DataBinding {
    pub node_id: NodeId,
    pub input_name: String,
    pub request_id: String,
    pub schema_fingerprint: String,
    pub plan_fingerprint: String,
    #[serde(default)]
    pub relation_fingerprint: Option<String>,
    pub output_representation: String,
    #[serde(default)]
    pub feature_set_id: Option<String>,
    #[serde(default)]
    pub source_ids: Vec<String>,
    #[serde(default)]
    pub require_relations: bool,
    #[serde(default)]
    pub view_policy: DataViewPolicy,
    #[serde(default)]
    pub metadata: BTreeMap<String, serde_json::Value>,
}

/// Return the stable wire key used to bind one node input to its external
/// data requirement.
///
/// The `node.input` spelling is part of the V1 JSON contract. Because both
/// coordinates may themselves contain `.`, callers that index more than one
/// binding must still reject distinct coordinates that render to the same
/// key instead of silently overwriting one of them.
pub fn data_binding_requirement_key(node_id: &NodeId, input_name: &str) -> String {
    format!("{node_id}.{input_name}")
}

impl DataBinding {
    pub fn validate(&self) -> Result<()> {
        self.view_policy.validate()?;
        if self.input_name.trim().is_empty() {
            return Err(DagMlError::CampaignValidation(format!(
                "data binding for `{}` has empty input_name",
                self.node_id
            )));
        }
        if self.request_id.trim().is_empty() {
            return Err(DagMlError::CampaignValidation(format!(
                "data binding `{}` on `{}` has empty request_id",
                self.input_name, self.node_id
            )));
        }
        validate_fingerprint("schema", &self.schema_fingerprint)?;
        validate_fingerprint("plan", &self.plan_fingerprint)?;
        if let Some(relation_fingerprint) = &self.relation_fingerprint {
            validate_fingerprint("relation", relation_fingerprint)?;
        } else if self.require_relations {
            return Err(DagMlError::CampaignValidation(format!(
                "data binding `{}` on `{}` requires relations but has no relation_fingerprint",
                self.input_name, self.node_id
            )));
        }
        if self.output_representation.trim().is_empty() {
            return Err(DagMlError::CampaignValidation(format!(
                "data binding `{}` on `{}` has empty output_representation",
                self.input_name, self.node_id
            )));
        }
        if let Some(feature_set_id) = &self.feature_set_id {
            if feature_set_id.trim().is_empty() {
                return Err(DagMlError::CampaignValidation(format!(
                    "data binding `{}` on `{}` has empty feature_set_id",
                    self.input_name, self.node_id
                )));
            }
        }
        for source_id in &self.source_ids {
            if source_id.trim().is_empty() {
                return Err(DagMlError::CampaignValidation(format!(
                    "data binding `{}` on `{}` has empty source id",
                    self.input_name, self.node_id
                )));
            }
        }
        validate_unique_strings(
            &format!(
                "data binding `{}` on `{}` source_ids",
                self.input_name, self.node_id
            ),
            &self.source_ids,
        )?;
        validate_source_index_metadata(
            &format!(
                "data binding `{}` on `{}` metadata.source_index",
                self.input_name, self.node_id
            ),
            self.metadata.get(SOURCE_INDEX_METADATA_KEY),
            &self.source_ids,
        )?;
        Ok(())
    }

    pub fn feature_set_id(&self) -> &str {
        self.feature_set_id.as_deref().unwrap_or(&self.input_name)
    }

    pub fn validate_envelope(&self, envelope: &ExternalDataPlanEnvelope) -> Result<()> {
        self.validate()?;
        envelope.validate()?;
        if self.schema_fingerprint != envelope.schema_fingerprint {
            return Err(DagMlError::CampaignValidation(format!(
                "data binding `{}` on `{}` schema fingerprint mismatch",
                self.input_name, self.node_id
            )));
        }
        if self.plan_fingerprint != envelope.plan_fingerprint {
            return Err(DagMlError::CampaignValidation(format!(
                "data binding `{}` on `{}` plan fingerprint mismatch",
                self.input_name, self.node_id
            )));
        }
        if self.relation_fingerprint != envelope.relation_fingerprint {
            return Err(DagMlError::CampaignValidation(format!(
                "data binding `{}` on `{}` relation fingerprint mismatch",
                self.input_name, self.node_id
            )));
        }
        if self.require_relations && envelope.coordinator_relations.is_none() {
            return Err(DagMlError::CampaignValidation(format!(
                "data binding `{}` on `{}` requires coordinator relations",
                self.input_name, self.node_id
            )));
        }
        Ok(())
    }
}

pub(crate) fn validate_source_index_metadata(
    label: &str,
    value: Option<&serde_json::Value>,
    expected_sources: &[String],
) -> Result<()> {
    let Some(value) = value else {
        return Ok(());
    };
    let Some(source_index) = value.as_object() else {
        return Err(DagMlError::CampaignValidation(format!(
            "{label} must be an object mapping source id to feature-axis block index"
        )));
    };
    if source_index.is_empty() {
        return Err(DagMlError::CampaignValidation(format!(
            "{label} must not be empty"
        )));
    }
    let mut seen_indices = BTreeSet::new();
    for (source_id, index_value) in source_index {
        if source_id.trim().is_empty() {
            return Err(DagMlError::CampaignValidation(format!(
                "{label} contains an empty source id"
            )));
        }
        let Some(index) = index_value.as_u64() else {
            return Err(DagMlError::CampaignValidation(format!(
                "{label} entry `{source_id}` must be a non-negative integer"
            )));
        };
        if !seen_indices.insert(index) {
            return Err(DagMlError::CampaignValidation(format!(
                "{label} contains duplicate feature-axis block index `{index}`"
            )));
        }
    }
    if !expected_sources.is_empty() {
        let actual = source_index.keys().cloned().collect::<BTreeSet<_>>();
        let expected = expected_sources.iter().cloned().collect::<BTreeSet<_>>();
        if actual != expected {
            return Err(DagMlError::CampaignValidation(format!(
                "{label} keys must match data binding source_ids"
            )));
        }
    }
    Ok(())
}

/// The only roles a relation cohort outside the CV fold universe may have.
///
/// This is deliberately distinct from [`DataRequestPartition`]: the latter is
/// a scheduler request while this role determines whether a cohort may carry
/// score-bearing targets at all.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PredictCohortRole {
    ExternalTest,
    Inference,
}

#[derive(Serialize)]
struct PredictCohortFingerprintInput<'a> {
    role: PredictCohortRole,
    physical_sample_ids: &'a [SampleId],
    origin_sample_ids: &'a [SampleId],
    target_names: &'a [String],
    relation_fingerprint: &'a str,
    relations: &'a SampleRelationSet,
    data_content_fingerprint: &'a str,
    target_content_fingerprint: Option<&'a str>,
}

/// Closed, PREDICT-only relation authority introduced by envelope V2.
///
/// It is never a supplement to `coordinator_relations`: CV, OOF, SELECT and
/// training influence continue to consume only the latter. The explicit
/// physical/origin lists prevent a producer from silently changing a cohort by
/// reordering or dropping relation records.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PredictCohort {
    pub role: PredictCohortRole,
    pub physical_sample_ids: Vec<SampleId>,
    pub origin_sample_ids: Vec<SampleId>,
    pub target_names: Vec<String>,
    pub relation_fingerprint: String,
    pub relations: SampleRelationSet,
    pub data_content_fingerprint: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_content_fingerprint: Option<String>,
    pub cohort_fingerprint: String,
}

impl PredictCohort {
    /// Build the closed PREDICT-only authority from its authoritative relation
    /// records.
    ///
    /// Producers must use this constructor instead of reimplementing the
    /// relation, identity and cohort fingerprint algorithms in a host binding.
    /// The relation records remain the sole source of physical and origin
    /// identities; the derived lists are sorted sets so a producer cannot
    /// accidentally make a cohort depend on host iteration order.
    pub fn from_relations(
        role: PredictCohortRole,
        relations: SampleRelationSet,
        target_names: Vec<String>,
        data_content_fingerprint: String,
        target_content_fingerprint: Option<String>,
    ) -> Result<Self> {
        relations.validate()?;
        let physical_sample_ids = relations
            .records
            .iter()
            .map(|record| record.sample_id.clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        let origin_sample_ids = relations
            .records
            .iter()
            .map(|record| {
                record
                    .origin_sample_id
                    .clone()
                    .unwrap_or_else(|| record.sample_id.clone())
            })
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        let relation_fingerprint = relations.fingerprint()?;
        let mut cohort = Self {
            role,
            physical_sample_ids,
            origin_sample_ids,
            target_names,
            relation_fingerprint,
            relations,
            data_content_fingerprint,
            target_content_fingerprint,
            cohort_fingerprint: String::new(),
        };
        cohort.validate_members()?;
        cohort.cohort_fingerprint = cohort.fingerprint()?;
        Ok(cohort)
    }

    fn validate_members(&self) -> Result<()> {
        validate_sorted_unique_sample_ids(
            "predict cohort physical_sample_ids",
            &self.physical_sample_ids,
        )?;
        validate_sorted_unique_sample_ids(
            "predict cohort origin_sample_ids",
            &self.origin_sample_ids,
        )?;
        validate_non_empty_list("predict cohort target_names", &self.target_names)?;
        validate_unique_strings("predict cohort target_names", &self.target_names)?;
        validate_fingerprint("predict cohort relation", &self.relation_fingerprint)?;
        validate_fingerprint(
            "predict cohort data content",
            &self.data_content_fingerprint,
        )?;
        if let Some(target_content_fingerprint) = &self.target_content_fingerprint {
            validate_fingerprint("predict cohort target content", target_content_fingerprint)?;
        }
        match self.role {
            PredictCohortRole::ExternalTest if self.target_content_fingerprint.is_none() => {
                return Err(DagMlError::CampaignValidation(
                    "external_test predict cohort requires target_content_fingerprint".to_string(),
                ));
            }
            PredictCohortRole::Inference if self.target_content_fingerprint.is_some() => {
                return Err(DagMlError::CampaignValidation(
                    "inference predict cohort must not carry target_content_fingerprint"
                        .to_string(),
                ));
            }
            _ => {}
        }
        self.relations.validate()?;
        let relation_fingerprint = self.relations.fingerprint()?;
        if self.relation_fingerprint != relation_fingerprint {
            return Err(DagMlError::CampaignValidation(
                "predict cohort relation_fingerprint does not match relations".to_string(),
            ));
        }
        let relation_samples = self
            .relations
            .records
            .iter()
            .map(|record| record.sample_id.clone())
            .collect::<BTreeSet<_>>();
        let relation_origins = self
            .relations
            .records
            .iter()
            .map(|record| {
                record
                    .origin_sample_id
                    .clone()
                    .unwrap_or_else(|| record.sample_id.clone())
            })
            .collect::<BTreeSet<_>>();
        if relation_samples != self.physical_sample_ids.iter().cloned().collect() {
            return Err(DagMlError::CampaignValidation(
                "predict cohort physical_sample_ids do not exactly cover relation samples"
                    .to_string(),
            ));
        }
        if relation_origins != self.origin_sample_ids.iter().cloned().collect() {
            return Err(DagMlError::CampaignValidation(
                "predict cohort origin_sample_ids do not exactly cover relation origins"
                    .to_string(),
            ));
        }
        Ok(())
    }

    pub fn fingerprint(&self) -> Result<String> {
        self.validate_members()?;
        stable_json_fingerprint(&PredictCohortFingerprintInput {
            role: self.role,
            physical_sample_ids: &self.physical_sample_ids,
            origin_sample_ids: &self.origin_sample_ids,
            target_names: &self.target_names,
            relation_fingerprint: &self.relation_fingerprint,
            relations: &self.relations,
            data_content_fingerprint: &self.data_content_fingerprint,
            target_content_fingerprint: self.target_content_fingerprint.as_deref(),
        })
    }

    pub fn validate(&self) -> Result<()> {
        self.validate_members()?;
        validate_fingerprint("predict cohort", &self.cohort_fingerprint)?;
        if self.cohort_fingerprint != self.fingerprint()? {
            return Err(DagMlError::CampaignValidation(
                "predict cohort fingerprint does not match canonical content".to_string(),
            ));
        }
        Ok(())
    }

    /// External-test rows must never share a physical or origin identity with
    /// the CV universe. Inference is intentionally allowed to replay a known
    /// sample, but cannot carry targets or selection evidence.
    pub fn validate_against_cv_fold_set(&self, fold_set: &FoldSet) -> Result<()> {
        self.validate()?;
        fold_set.validate()?;
        if self.role == PredictCohortRole::Inference {
            return Ok(());
        }
        let cv_ids = fold_set.sample_ids.iter().collect::<BTreeSet<_>>();
        for sample_id in self
            .physical_sample_ids
            .iter()
            .chain(self.origin_sample_ids.iter())
        {
            if cv_ids.contains(sample_id) {
                return Err(DagMlError::CampaignValidation(format!(
                    "external_test predict cohort overlaps CV fold sample or origin `{sample_id}`"
                )));
            }
        }
        Ok(())
    }

    /// Refuse an external-test cohort that intersects the full physical-or-origin
    /// identity closure of the CV relation authority.
    ///
    /// `FoldSet` carries only physical sample ids. The coordinator relation set
    /// is therefore additionally required to prove that a held-out row did not
    /// arrive through a CV origin alias.
    pub fn validate_against_cv_relations(&self, cv_relations: &SampleRelationSet) -> Result<()> {
        self.validate()?;
        cv_relations.validate()?;
        if self.role == PredictCohortRole::Inference {
            return Ok(());
        }
        let cv_identity_closure = cv_relations
            .records
            .iter()
            .flat_map(|record| {
                std::iter::once(record.sample_id.clone()).chain(record.origin_sample_id.clone())
            })
            .collect::<BTreeSet<_>>();
        for sample_id in self
            .physical_sample_ids
            .iter()
            .chain(self.origin_sample_ids.iter())
        {
            if cv_identity_closure.contains(sample_id) {
                return Err(DagMlError::CampaignValidation(format!(
                    "external_test predict cohort overlaps CV relation identity closure `{sample_id}`"
                )));
            }
        }
        Ok(())
    }
}

fn validate_sorted_unique_sample_ids(label: &str, values: &[SampleId]) -> Result<()> {
    if values.is_empty() {
        return Err(DagMlError::CampaignValidation(format!(
            "{label} must not be empty"
        )));
    }
    for pair in values.windows(2) {
        if pair[0] >= pair[1] {
            return Err(DagMlError::CampaignValidation(format!(
                "{label} must be strictly sorted and unique"
            )));
        }
    }
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ExternalDataPlanEnvelope {
    #[serde(default = "default_external_data_plan_envelope_schema_version")]
    pub schema_version: u32,
    pub schema_fingerprint: String,
    pub plan_fingerprint: String,
    #[serde(default)]
    pub relation_fingerprint: Option<String>,
    /// Optional additive identity of the concrete feature/input content. Legacy
    /// V1 envelopes omit it; W1 training requests bind it through
    /// `TrainingDataIdentity` before candidate caches are reusable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_content_fingerprint: Option<String>,
    /// Optional additive identity of the concrete target content. It may be
    /// absent for prediction-only envelopes but is mandatory at the W1
    /// training boundary.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_content_fingerprint: Option<String>,
    #[serde(default)]
    pub coordinator_relations: Option<SampleRelationSet>,
    /// V2-only PREDICT relation authority. It is intentionally not merged with
    /// coordinator_relations, which remains exact to the CV fold universe.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub predict_cohort: Option<PredictCohort>,
}

impl ExternalDataPlanEnvelope {
    pub fn validate(&self) -> Result<()> {
        if !matches!(
            self.schema_version,
            EXTERNAL_DATA_PLAN_ENVELOPE_SCHEMA_VERSION_V1
                | EXTERNAL_DATA_PLAN_ENVELOPE_SCHEMA_VERSION_V2
        ) {
            return Err(DagMlError::CampaignValidation(format!(
                "external data-plan envelope uses unsupported schema_version {}",
                self.schema_version
            )));
        }
        match (self.schema_version, &self.predict_cohort) {
            (EXTERNAL_DATA_PLAN_ENVELOPE_SCHEMA_VERSION_V1, Some(_)) => {
                return Err(DagMlError::CampaignValidation(
                    "external data-plan envelope V1 cannot carry predict_cohort".to_string(),
                ));
            }
            (EXTERNAL_DATA_PLAN_ENVELOPE_SCHEMA_VERSION_V2, None) => {
                return Err(DagMlError::CampaignValidation(
                    "external data-plan envelope V2 requires predict_cohort".to_string(),
                ));
            }
            _ => {}
        }
        validate_fingerprint("schema", &self.schema_fingerprint)?;
        validate_fingerprint("plan", &self.plan_fingerprint)?;
        if let Some(relation_fingerprint) = &self.relation_fingerprint {
            validate_fingerprint("relation", relation_fingerprint)?;
            if self.coordinator_relations.is_none() {
                return Err(DagMlError::CampaignValidation(
                    "relation_fingerprint requires coordinator_relations".to_string(),
                ));
            }
        }
        if let Some(data_content_fingerprint) = &self.data_content_fingerprint {
            validate_fingerprint("data content", data_content_fingerprint)?;
        }
        if let Some(target_content_fingerprint) = &self.target_content_fingerprint {
            validate_fingerprint("target content", target_content_fingerprint)?;
        }
        if let Some(relations) = &self.coordinator_relations {
            relations.validate()?;
        }
        if let Some(predict_cohort) = &self.predict_cohort {
            predict_cohort.validate()?;
            if predict_cohort.role == PredictCohortRole::ExternalTest {
                let cv_relations = self.coordinator_relations.as_ref().ok_or_else(|| {
                    DagMlError::CampaignValidation(
                        "external_test predict cohort requires coordinator_relations to prove CV disjointness"
                            .to_string(),
                    )
                })?;
                predict_cohort.validate_against_cv_relations(cv_relations)?;
            }
        }
        Ok(())
    }
}

pub fn validate_data_binding_envelope(
    binding: &DataBinding,
    envelope: &ExternalDataPlanEnvelope,
) -> Result<()> {
    binding.validate_envelope(envelope)
}

#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
struct DataEnvelopeKey {
    schema_fingerprint: String,
    plan_fingerprint: String,
    relation_fingerprint: Option<String>,
}

impl DataEnvelopeKey {
    fn from_binding(binding: &DataBinding) -> Self {
        Self {
            schema_fingerprint: binding.schema_fingerprint.clone(),
            plan_fingerprint: binding.plan_fingerprint.clone(),
            relation_fingerprint: binding.relation_fingerprint.clone(),
        }
    }

    fn from_envelope(envelope: &ExternalDataPlanEnvelope) -> Self {
        Self {
            schema_fingerprint: envelope.schema_fingerprint.clone(),
            plan_fingerprint: envelope.plan_fingerprint.clone(),
            relation_fingerprint: envelope.relation_fingerprint.clone(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct DataHandleRecord {
    pub handle: HandleRef,
    pub run_id: RunId,
    pub node_id: NodeId,
    pub input_name: String,
    pub phase: Phase,
    pub variant_id: Option<VariantId>,
    pub fold_id: Option<FoldId>,
    pub request_id: String,
    pub schema_fingerprint: String,
    pub plan_fingerprint: String,
    pub relation_fingerprint: Option<String>,
    pub output_representation: String,
    #[serde(default)]
    pub feature_set_id: Option<String>,
    #[serde(default)]
    pub source_ids: Vec<String>,
    pub relation_record_count: Option<usize>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DataViewHandleRecord {
    pub handle: HandleRef,
    pub parent_handle: HandleRef,
    pub run_id: RunId,
    pub node_id: NodeId,
    pub input_name: String,
    pub phase: Phase,
    pub variant_id: Option<VariantId>,
    pub fold_id: Option<FoldId>,
    pub request_id: String,
    pub feature_set_id: String,
    pub view: DataProviderViewSpec,
}

#[derive(Debug)]
pub struct InMemoryDataProvider {
    owner_controller: ControllerId,
    envelopes: BTreeMap<DataEnvelopeKey, ExternalDataPlanEnvelope>,
    next_handle: RefCell<u64>,
    records: RefCell<BTreeMap<u64, DataHandleRecord>>,
    view_records: RefCell<BTreeMap<u64, DataViewHandleRecord>>,
}

impl InMemoryDataProvider {
    pub fn new(owner_controller: ControllerId) -> Self {
        Self {
            owner_controller,
            envelopes: BTreeMap::new(),
            next_handle: RefCell::new(1),
            records: RefCell::new(BTreeMap::new()),
            view_records: RefCell::new(BTreeMap::new()),
        }
    }

    pub fn with_envelope(
        owner_controller: ControllerId,
        envelope: ExternalDataPlanEnvelope,
    ) -> Result<Self> {
        let mut provider = Self::new(owner_controller);
        provider.register_envelope(envelope)?;
        Ok(provider)
    }

    pub fn register_envelope(&mut self, envelope: ExternalDataPlanEnvelope) -> Result<()> {
        envelope.validate()?;
        let key = DataEnvelopeKey::from_envelope(&envelope);
        if let Some(existing) = self.envelopes.get(&key) {
            if existing == &envelope {
                return Ok(());
            }
            return Err(DagMlError::RuntimeValidation(
                "duplicate external data-plan envelope with different payload".to_string(),
            ));
        }
        self.envelopes.insert(key, envelope);
        Ok(())
    }

    pub fn handle_record(&self, handle: u64) -> Option<DataHandleRecord> {
        self.records.borrow().get(&handle).cloned()
    }

    pub fn handle_records(&self) -> Vec<DataHandleRecord> {
        self.records.borrow().values().cloned().collect()
    }

    pub fn view_record(&self, handle: u64) -> Option<DataViewHandleRecord> {
        self.view_records.borrow().get(&handle).cloned()
    }

    pub fn view_records(&self) -> Vec<DataViewHandleRecord> {
        self.view_records.borrow().values().cloned().collect()
    }

    fn next_handle(&self) -> u64 {
        let mut next = self.next_handle.borrow_mut();
        let handle = *next;
        *next += 1;
        handle
    }
}

impl RuntimeDataProvider for InMemoryDataProvider {
    fn materialize(&self, request: &DataMaterializationRequest) -> Result<HandleRef> {
        if request.node_id != request.binding.node_id {
            return Err(DagMlError::RuntimeValidation(format!(
                "data materialization request node `{}` does not match binding node `{}`",
                request.node_id, request.binding.node_id
            )));
        }
        if request.input_name != request.binding.input_name {
            return Err(DagMlError::RuntimeValidation(format!(
                "data materialization request input `{}` does not match binding input `{}`",
                request.input_name, request.binding.input_name
            )));
        }
        let envelope = self
            .envelopes
            .get(&DataEnvelopeKey::from_binding(&request.binding))
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "no external data-plan envelope registered for binding `{}` on `{}`",
                    request.binding.input_name, request.binding.node_id
                ))
            })?;
        request.binding.validate_envelope(envelope)?;

        let handle = HandleRef {
            handle: self.next_handle(),
            kind: HandleKind::Data,
            owner_controller: self.owner_controller.clone(),
        };
        let record = DataHandleRecord {
            handle: handle.clone(),
            run_id: request.run_id.clone(),
            node_id: request.node_id.clone(),
            input_name: request.input_name.clone(),
            phase: request.phase,
            variant_id: request.variant_id.clone(),
            fold_id: request.fold_id.clone(),
            request_id: request.binding.request_id.clone(),
            schema_fingerprint: request.binding.schema_fingerprint.clone(),
            plan_fingerprint: request.binding.plan_fingerprint.clone(),
            relation_fingerprint: request.binding.relation_fingerprint.clone(),
            output_representation: request.binding.output_representation.clone(),
            feature_set_id: request.binding.feature_set_id.clone(),
            source_ids: request.binding.source_ids.clone(),
            relation_record_count: envelope
                .coordinator_relations
                .as_ref()
                .map(|relations| relations.records.len()),
        };
        self.records.borrow_mut().insert(handle.handle, record);
        Ok(handle)
    }

    fn make_view(&self, request: &DataViewRequest) -> Result<HandleRef> {
        request.view.validate()?;
        if request.node_id != request.binding.node_id {
            return Err(DagMlError::RuntimeValidation(format!(
                "data view request node `{}` does not match binding node `{}`",
                request.node_id, request.binding.node_id
            )));
        }
        if request.input_name != request.binding.input_name {
            return Err(DagMlError::RuntimeValidation(format!(
                "data view request input `{}` does not match binding input `{}`",
                request.input_name, request.binding.input_name
            )));
        }
        if request.data_handle.kind != HandleKind::Data {
            return Err(DagMlError::RuntimeValidation(format!(
                "data view request for `{}` on `{}` received non-data parent handle",
                request.input_name, request.node_id
            )));
        }
        let parent = self
            .records
            .borrow()
            .get(&request.data_handle.handle)
            .cloned()
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "unknown data handle `{}` for view request `{}` on `{}`",
                    request.data_handle.handle, request.input_name, request.node_id
                ))
            })?;
        if parent.handle != request.data_handle {
            return Err(DagMlError::RuntimeValidation(format!(
                "data view request parent handle `{}` does not match provider record",
                request.data_handle.handle
            )));
        }
        request.binding.validate()?;
        let handle = HandleRef {
            handle: self.next_handle(),
            kind: HandleKind::DataView,
            owner_controller: self.owner_controller.clone(),
        };
        let record = DataViewHandleRecord {
            handle: handle.clone(),
            parent_handle: request.data_handle.clone(),
            run_id: request.run_id.clone(),
            node_id: request.node_id.clone(),
            input_name: request.input_name.clone(),
            phase: request.phase,
            variant_id: request.variant_id.clone(),
            fold_id: request.fold_id.clone(),
            request_id: request.binding.request_id.clone(),
            feature_set_id: request.binding.feature_set_id().to_string(),
            view: request.view.clone(),
        };
        self.view_records.borrow_mut().insert(handle.handle, record);
        Ok(handle)
    }

    fn training_data_identity(
        &self,
        binding: &DataBinding,
    ) -> Result<Option<crate::training::TrainingDataIdentity>> {
        let envelope = self
            .envelopes
            .get(&DataEnvelopeKey::from_binding(binding))
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "no external data-plan envelope registered for binding `{}` on `{}`",
                    binding.input_name, binding.node_id
                ))
            })?;
        binding.validate_envelope(envelope)?;
        if envelope.relation_fingerprint.is_none()
            || envelope.data_content_fingerprint.is_none()
            || envelope.target_content_fingerprint.is_none()
        {
            return Ok(None);
        }
        Ok(Some(
            crate::training::TrainingDataIdentity::from_binding_envelope(binding, envelope)?,
        ))
    }

    fn coordinator_relations(&self, binding: &DataBinding) -> Result<Option<SampleRelationSet>> {
        let envelope = self
            .envelopes
            .get(&DataEnvelopeKey::from_binding(binding))
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "no external data-plan envelope registered for binding `{}` on `{}`",
                    binding.input_name, binding.node_id
                ))
            })?;
        binding.validate_envelope(envelope)?;
        Ok(envelope.coordinator_relations.clone())
    }

    fn predict_cohort(&self, binding: &DataBinding, phase: Phase) -> Result<Option<PredictCohort>> {
        if phase != Phase::Predict {
            return Err(DagMlError::RuntimeValidation(format!(
                "predict cohort may be requested only during PREDICT, got {phase:?}"
            )));
        }
        let envelope = self
            .envelopes
            .get(&DataEnvelopeKey::from_binding(binding))
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "no external data-plan envelope registered for binding `{}` on `{}`",
                    binding.input_name, binding.node_id
                ))
            })?;
        binding.validate_envelope(envelope)?;
        Ok(envelope.predict_cohort.clone())
    }
}

fn validate_fingerprint(label: &str, value: &str) -> Result<()> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(DagMlError::CampaignValidation(format!(
            "{label} fingerprint must be a 64-character hex digest"
        )));
    }
    Ok(())
}

fn validate_non_empty(label: &str, value: &str) -> Result<()> {
    if value.trim().is_empty() {
        return Err(DagMlError::CampaignValidation(format!(
            "{label} must be a non-empty string"
        )));
    }
    Ok(())
}

fn validate_optional_non_empty(label: &str, value: &Option<String>) -> Result<()> {
    if let Some(value) = value {
        validate_non_empty(label, value)?;
    }
    Ok(())
}

fn validate_combo_like_output(label: &str, unit_level: EntityUnitLevel) -> Result<()> {
    if matches!(
        unit_level,
        EntityUnitLevel::Combo | EntityUnitLevel::Observation
    ) {
        return Ok(());
    }
    Err(DagMlError::CampaignValidation(format!(
        "{label} representation output_unit_level must be combo or observation"
    )))
}

fn validate_non_empty_list(label: &str, values: &[String]) -> Result<()> {
    if values.is_empty() {
        return Err(DagMlError::CampaignValidation(format!(
            "{label} must be a non-empty list"
        )));
    }
    validate_string_list_entries(label, values)
}

fn validate_string_list_entries(label: &str, values: &[String]) -> Result<()> {
    for (index, value) in values.iter().enumerate() {
        if value.trim().is_empty() {
            return Err(DagMlError::CampaignValidation(format!(
                "{label}[{index}] must be a non-empty string"
            )));
        }
    }
    Ok(())
}

fn validate_unique_strings(label: &str, values: &[String]) -> Result<()> {
    let mut seen = BTreeSet::new();
    for value in values {
        if !seen.insert(value.as_str()) {
            return Err(DagMlError::CampaignValidation(format!(
                "{label} contains duplicate value `{value}`"
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fold::{FoldAssignment, FoldPartitionMode};
    use crate::ids::{ControllerId, FoldId, NodeId};
    use crate::runtime::{DataMaterializationRequest, RuntimeDataProvider};

    fn binding() -> DataBinding {
        DataBinding {
            node_id: NodeId::new("model:base").unwrap(),
            input_name: "x".to_string(),
            request_id: "nir-to-tabular".to_string(),
            schema_fingerprint: "f97b37872fa22134b508f98fd8e207e5b776b52594fb8f6f5c3e15bee212246b"
                .to_string(),
            plan_fingerprint: "7c5431d85574b3f337022fa5d25971d5b5cf445b90331b49938f573ff6901e4d"
                .to_string(),
            relation_fingerprint: Some(
                "a3a7e329df35db9f2883a17b8611b7fae6dcaa031875e3ec2c9be1b9e29cbe10".to_string(),
            ),
            output_representation: "tabular_numeric".to_string(),
            feature_set_id: Some("x".to_string()),
            source_ids: vec!["nir".to_string()],
            require_relations: true,
            view_policy: DataViewPolicy::default(),
            metadata: BTreeMap::new(),
        }
    }

    #[test]
    fn validates_data_binding_contract() {
        let binding = binding();
        binding.validate().unwrap();
        assert_eq!(binding.feature_set_id(), "x");
    }

    #[cfg(dag_ml_workspace_contract_fixtures)]
    #[test]
    fn published_model_input_and_data_plan_schemas_declare_current_contract() {
        let model_input_schema: serde_json::Value = serde_json::from_str(include_str!(
            "../../../docs/contracts/model_input_spec.schema.json"
        ))
        .unwrap();
        assert_eq!(model_input_schema["$id"], MODEL_INPUT_SPEC_SCHEMA_ID);
        assert_eq!(
            model_input_schema["properties"]["schema_version"]["const"].as_u64(),
            Some(MODEL_INPUT_SPEC_SCHEMA_VERSION as u64)
        );
        assert!(model_input_schema["$defs"]["input_port"]["required"]
            .as_array()
            .unwrap()
            .iter()
            .any(|field| field.as_str() == Some("accepted_representations")));
        assert!(model_input_schema["$defs"]["fusion_policy"]["properties"]
            .as_object()
            .unwrap()
            .contains_key("representation_plan"));
        assert!(model_input_schema["$defs"]
            .as_object()
            .unwrap()
            .contains_key("combination_plan"));
        assert!(model_input_schema["$defs"]
            .as_object()
            .unwrap()
            .contains_key("representation_plan"));

        let data_plan_schema: serde_json::Value = serde_json::from_str(include_str!(
            "../../../docs/contracts/data_plan.schema.json"
        ))
        .unwrap();
        assert_eq!(data_plan_schema["$id"], DATA_PLAN_SCHEMA_ID);
        assert_eq!(
            data_plan_schema["properties"]["schema_version"]["const"].as_u64(),
            Some(DATA_PLAN_SCHEMA_VERSION as u64)
        );
        assert!(data_plan_schema["$defs"]["data_plan_step_kind"]["enum"]
            .as_array()
            .unwrap()
            .iter()
            .any(|kind| kind.as_str() == Some("collate")));
    }

    #[test]
    fn validates_model_input_and_data_plan_fixtures() {
        let model_input: ModelInputSpec = serde_json::from_str(include_str!(
            "../tests/fixtures/package/data/model_input_spec_tabular_regressor.json"
        ))
        .unwrap();
        model_input.validate().unwrap();
        assert_eq!(model_input.ports[0].rank, Some(2));
        assert!(model_input.ports[0].multi_source);

        let data_plan: DataPlan = serde_json::from_str(include_str!(
            "../tests/fixtures/package/data/data_plan_tabular_fusion.json"
        ))
        .unwrap();
        data_plan.validate().unwrap();
        assert_eq!(data_plan.output_ports.get("x").unwrap(), "x_collated");
    }

    #[test]
    fn data_plan_rejects_forward_step_references() {
        let data_plan = DataPlan {
            schema_version: DATA_PLAN_SCHEMA_VERSION,
            id: "data-plan:bad".to_string(),
            steps: vec![DataPlanStep {
                kind: DataPlanStepKind::Adapt,
                inputs: vec!["missing".to_string()],
                output: "adapted".to_string(),
                adapter_id: Some("adapter:adapt".to_string()),
                params: BTreeMap::new(),
            }],
            output_ports: BTreeMap::from([("x".to_string(), "adapted".to_string())]),
            warnings: Vec::new(),
            requires_user_choice: Vec::new(),
            metadata: BTreeMap::new(),
        };

        let error = data_plan.validate().unwrap_err().to_string();
        assert!(error.contains("before it is produced"));
    }

    #[test]
    fn data_view_policy_rejects_unsafe_fit_and_validation_augmentation_by_default() {
        let mut full_train_binding = binding();
        full_train_binding.view_policy.fit_partition = DataRequestPartition::FullTrain;
        let full_train_error = full_train_binding.validate().unwrap_err().to_string();
        assert!(
            full_train_error.contains("fit_partition=full_train"),
            "unexpected full-train error: {full_train_error}"
        );

        let mut augmented_validation_binding = binding();
        augmented_validation_binding
            .view_policy
            .include_augmented_validation = true;
        let augmented_error = augmented_validation_binding
            .validate()
            .unwrap_err()
            .to_string();
        assert!(
            augmented_error.contains("include_augmented_validation=true"),
            "unexpected augmented-validation error: {augmented_error}"
        );

        let mut excluded_binding = binding();
        excluded_binding.view_policy.include_excluded = true;
        let excluded_error = excluded_binding.validate().unwrap_err().to_string();
        assert!(
            excluded_error.contains("include_excluded=true"),
            "unexpected excluded-row error: {excluded_error}"
        );
    }

    #[test]
    fn data_view_policy_requires_explicit_unsafe_flags_for_debug_views() {
        let mut binding = binding();
        binding.view_policy.fit_partition = DataRequestPartition::FullTrain;
        binding.view_policy.include_augmented_validation = true;
        binding.view_policy.include_excluded = true;
        binding.view_policy.unsafe_flags = BTreeSet::from([
            DataViewPolicy::ALLOW_FIT_CV_FULL_TRAIN_VIEW.to_string(),
            DataViewPolicy::ALLOW_AUGMENTED_VALIDATION_VIEW.to_string(),
            DataViewPolicy::ALLOW_EXCLUDED_ROWS.to_string(),
        ]);

        binding.validate().unwrap();
    }

    #[test]
    fn validates_external_data_envelope_subset() {
        let envelope: ExternalDataPlanEnvelope = serde_json::from_str(include_str!(
            "../tests/fixtures/package/data/coordinator_data_plan_envelope_sample12.json"
        ))
        .unwrap();

        assert_eq!(
            envelope.schema_version,
            EXTERNAL_DATA_PLAN_ENVELOPE_SCHEMA_VERSION
        );
        binding().validate_envelope(&envelope).unwrap();
        assert!(envelope.data_content_fingerprint.is_none());
        assert!(envelope.target_content_fingerprint.is_none());
    }

    fn external_test_predict_cohort() -> PredictCohort {
        let records = vec![
            crate::relation::SampleRelation::new(
                crate::ids::ObservationId::new("obs:holdout:1").unwrap(),
                SampleId::new("sample:holdout:1").unwrap(),
            ),
            crate::relation::SampleRelation::new(
                crate::ids::ObservationId::new("obs:holdout:2").unwrap(),
                SampleId::new("sample:holdout:2").unwrap(),
            ),
        ];
        PredictCohort::from_relations(
            PredictCohortRole::ExternalTest,
            SampleRelationSet { records },
            vec!["classification:y".to_string()],
            "c".repeat(64),
            Some("d".repeat(64)),
        )
        .unwrap()
    }

    fn cv_fold_set(sample_ids: [&str; 2]) -> FoldSet {
        let sample_ids = sample_ids
            .into_iter()
            .map(|sample_id| SampleId::new(sample_id).unwrap())
            .collect::<Vec<_>>();
        FoldSet {
            id: "foldset:cv".to_string(),
            sample_ids: sample_ids.clone(),
            folds: vec![
                FoldAssignment {
                    fold_id: FoldId::new("fold:0").unwrap(),
                    train_sample_ids: vec![sample_ids[1].clone()],
                    validation_sample_ids: vec![sample_ids[0].clone()],
                    metadata: BTreeMap::new(),
                },
                FoldAssignment {
                    fold_id: FoldId::new("fold:1").unwrap(),
                    train_sample_ids: vec![sample_ids[0].clone()],
                    validation_sample_ids: vec![sample_ids[1].clone()],
                    metadata: BTreeMap::new(),
                },
            ],
            sample_groups: BTreeMap::new(),
            partition_mode: FoldPartitionMode::Partition,
        }
    }

    #[test]
    fn external_data_envelope_v2_closes_predict_cohort_identity() {
        let mut envelope: ExternalDataPlanEnvelope = serde_json::from_str(include_str!(
            "../tests/fixtures/package/data/coordinator_data_plan_envelope_sample12.json"
        ))
        .unwrap();
        let cohort = external_test_predict_cohort();
        envelope.schema_version = EXTERNAL_DATA_PLAN_ENVELOPE_SCHEMA_VERSION_V2;
        envelope.predict_cohort = Some(cohort.clone());
        envelope.validate().unwrap();

        let mut v1 = envelope.clone();
        v1.schema_version = EXTERNAL_DATA_PLAN_ENVELOPE_SCHEMA_VERSION_V1;
        assert!(v1
            .validate()
            .unwrap_err()
            .to_string()
            .contains("V1 cannot carry predict_cohort"));

        let mut fingerprint_drift = cohort;
        fingerprint_drift.cohort_fingerprint = "0".repeat(64);
        envelope.predict_cohort = Some(fingerprint_drift);
        assert!(envelope
            .validate()
            .unwrap_err()
            .to_string()
            .contains("predict cohort fingerprint"));
    }

    #[test]
    fn predict_cohort_refuses_noncanonical_identity_and_inference_targets() {
        let mut cohort = external_test_predict_cohort();
        cohort.physical_sample_ids.reverse();
        assert!(cohort
            .validate()
            .unwrap_err()
            .to_string()
            .contains("strictly sorted and unique"));

        let mut inference = external_test_predict_cohort();
        inference.role = PredictCohortRole::Inference;
        assert!(inference
            .validate()
            .unwrap_err()
            .to_string()
            .contains("inference predict cohort must not carry target_content_fingerprint"));
    }

    #[test]
    fn predict_cohort_constructor_derives_closed_identity_from_relations() {
        let mut first = crate::relation::SampleRelation::new(
            crate::ids::ObservationId::new("obs:holdout:one").unwrap(),
            SampleId::new("sample:physical:two").unwrap(),
        );
        first.origin_sample_id = Some(SampleId::new("sample:origin:one").unwrap());
        let second = crate::relation::SampleRelation::new(
            crate::ids::ObservationId::new("obs:holdout:two").unwrap(),
            SampleId::new("sample:physical:one").unwrap(),
        );
        let cohort = PredictCohort::from_relations(
            PredictCohortRole::Inference,
            SampleRelationSet {
                records: vec![first, second],
            },
            vec!["classification:y".to_string()],
            "e".repeat(64),
            None,
        )
        .unwrap();

        assert_eq!(
            cohort.physical_sample_ids,
            vec![
                SampleId::new("sample:physical:one").unwrap(),
                SampleId::new("sample:physical:two").unwrap(),
            ]
        );
        assert_eq!(
            cohort.origin_sample_ids,
            vec![
                SampleId::new("sample:origin:one").unwrap(),
                SampleId::new("sample:physical:one").unwrap(),
            ]
        );
        cohort.validate().unwrap();
    }

    #[test]
    fn external_test_predict_cohort_is_disjoint_from_cv_identity_closure() {
        let cohort = external_test_predict_cohort();
        cohort
            .validate_against_cv_fold_set(&cv_fold_set(["sample:cv:1", "sample:cv:2"]))
            .unwrap();
        let error = cohort
            .validate_against_cv_fold_set(&cv_fold_set(["sample:holdout:1", "sample:cv:2"]))
            .unwrap_err()
            .to_string();
        assert!(
            error.contains("overlaps CV fold sample or origin"),
            "{error}"
        );
    }

    #[test]
    fn external_test_predict_cohort_refuses_cv_origin_alias() {
        let cohort = external_test_predict_cohort();
        let mut cv_relation = crate::relation::SampleRelation::new(
            crate::ids::ObservationId::new("obs:cv:1").unwrap(),
            SampleId::new("sample:cv:1").unwrap(),
        );
        cv_relation.origin_sample_id = Some(SampleId::new("sample:holdout:1").unwrap());
        let cv_relations = SampleRelationSet {
            records: vec![cv_relation],
        };
        let error = cohort
            .validate_against_cv_relations(&cv_relations)
            .unwrap_err()
            .to_string();
        assert!(
            error.contains("overlaps CV relation identity closure"),
            "{error}"
        );
    }

    #[test]
    fn in_memory_provider_exposes_predict_cohort_only_to_predict() {
        let mut envelope: ExternalDataPlanEnvelope = serde_json::from_str(include_str!(
            "../tests/fixtures/package/data/coordinator_data_plan_envelope_sample12.json"
        ))
        .unwrap();
        let cohort = external_test_predict_cohort();
        envelope.schema_version = EXTERNAL_DATA_PLAN_ENVELOPE_SCHEMA_VERSION_V2;
        envelope.predict_cohort = Some(cohort.clone());
        let mut provider =
            InMemoryDataProvider::new(ControllerId::new("controller:data.v2").unwrap());
        provider.register_envelope(envelope).unwrap();

        assert_eq!(
            provider.predict_cohort(&binding(), Phase::Predict).unwrap(),
            Some(cohort)
        );
        let error = provider
            .predict_cohort(&binding(), Phase::Refit)
            .unwrap_err()
            .to_string();
        assert!(error.contains("only during PREDICT"), "{error}");
    }

    #[test]
    fn external_data_envelope_content_identity_is_additive_and_validated() {
        let mut envelope: ExternalDataPlanEnvelope = serde_json::from_str(include_str!(
            "../tests/fixtures/package/data/coordinator_data_plan_envelope_sample12.json"
        ))
        .unwrap();
        envelope.data_content_fingerprint = Some("a".repeat(64));
        envelope.target_content_fingerprint = Some("b".repeat(64));
        envelope.validate().unwrap();

        envelope.data_content_fingerprint = Some("not-a-fingerprint".to_string());
        assert!(envelope
            .validate()
            .unwrap_err()
            .to_string()
            .contains("data content fingerprint"));
    }

    #[test]
    fn in_memory_provider_attests_complete_training_identity() {
        let mut envelope: ExternalDataPlanEnvelope = serde_json::from_str(include_str!(
            "../tests/fixtures/package/data/coordinator_data_plan_envelope_sample12.json"
        ))
        .unwrap();
        envelope.data_content_fingerprint = Some("a".repeat(64));
        envelope.target_content_fingerprint = Some("b".repeat(64));
        let provider = InMemoryDataProvider::with_envelope(
            ControllerId::new("controller:data.provider").unwrap(),
            envelope,
        )
        .unwrap();

        let identity = provider
            .training_data_identity(&binding())
            .unwrap()
            .expect("content-aware envelope must attest training identity");
        identity.validate().unwrap();
        assert_eq!(identity.requirement_key, "model:base.x");
        assert_eq!(identity.data_content_fingerprint, "a".repeat(64));
        assert_eq!(identity.target_content_fingerprint, "b".repeat(64));
    }

    #[test]
    fn validates_multisource_repetition_envelope_fixture() {
        let envelope: ExternalDataPlanEnvelope = serde_json::from_str(include_str!(
            "../tests/fixtures/package/data/coordinator_data_plan_envelope_multisource_repetitions.json"
        ))
        .unwrap();

        envelope.validate().unwrap();
        let relations = envelope.coordinator_relations.as_ref().unwrap();
        assert_eq!(relations.records.len(), 8);
        let source_counts = relations.records.iter().fold(
            BTreeMap::<String, usize>::new(),
            |mut counts, record| {
                if record.unit_level == EntityUnitLevel::Observation {
                    *counts
                        .entry(record.source_id.clone().expect("source_id"))
                        .or_default() += 1;
                }
                counts
            },
        );
        assert_eq!(source_counts["A"], 2);
        assert_eq!(source_counts["B"], 3);
        assert_eq!(source_counts["C"], 2);
        let combo = relations
            .records
            .iter()
            .find(|record| record.unit_level == EntityUnitLevel::Combo)
            .expect("relation-backed combo row");
        assert_eq!(combo.sample_id.as_str(), "sample:1");
        assert_eq!(
            combo.origin_sample_id.as_ref().unwrap().as_str(),
            combo.sample_id.as_str()
        );
        assert_eq!(combo.component_observation_ids.len(), 3);
        for source_id in ["A", "B", "C"] {
            assert!(combo
                .component_observation_ids
                .iter()
                .any(|observation_id| observation_id.as_str().contains(source_id)));
        }
        assert_eq!(
            relations
                .sample_for_observation(
                    &crate::ids::ObservationId::new("obs.s1.combo.A0.B0.C0").unwrap()
                )
                .unwrap()
                .as_str(),
            "sample:1"
        );
    }

    #[cfg(dag_ml_workspace_contract_fixtures)]
    #[test]
    fn published_external_data_envelope_schema_declares_current_version() {
        let schema: serde_json::Value = serde_json::from_str(include_str!(
            "../../../docs/contracts/coordinator_data_plan_envelope.schema.json"
        ))
        .unwrap();

        assert_eq!(
            schema["properties"]["schema_version"]["const"].as_u64(),
            Some(EXTERNAL_DATA_PLAN_ENVELOPE_SCHEMA_VERSION as u64)
        );
        assert!(schema["required"]
            .as_array()
            .unwrap()
            .iter()
            .any(|field| field.as_str() == Some("schema_version")));
    }

    #[test]
    fn refuses_unsupported_external_data_envelope_schema_version() {
        let mut envelope: ExternalDataPlanEnvelope = serde_json::from_str(include_str!(
            "../tests/fixtures/package/data/coordinator_data_plan_envelope_sample12.json"
        ))
        .unwrap();
        envelope.schema_version = EXTERNAL_DATA_PLAN_ENVELOPE_SCHEMA_VERSION + 1;

        assert!(binding().validate_envelope(&envelope).is_err());
    }

    #[test]
    fn refuses_envelope_fingerprint_mismatch() {
        let mut envelope: ExternalDataPlanEnvelope = serde_json::from_str(include_str!(
            "../tests/fixtures/package/data/coordinator_data_plan_envelope_sample12.json"
        ))
        .unwrap();
        envelope.plan_fingerprint = "0".repeat(64);

        assert!(binding().validate_envelope(&envelope).is_err());
    }

    #[test]
    fn in_memory_provider_materializes_validated_data_handles() {
        let envelope: ExternalDataPlanEnvelope = serde_json::from_str(include_str!(
            "../tests/fixtures/package/data/coordinator_data_plan_envelope_sample12.json"
        ))
        .unwrap();
        let provider = InMemoryDataProvider::with_envelope(
            ControllerId::new("controller:data.provider").unwrap(),
            envelope,
        )
        .unwrap();

        let handle = provider
            .materialize(&DataMaterializationRequest {
                run_id: RunId::new("run:data").unwrap(),
                node_id: NodeId::new("model:base").unwrap(),
                input_name: "x".to_string(),
                phase: Phase::FitCv,
                variant_id: Some(VariantId::new("variant:base").unwrap()),
                fold_id: Some(FoldId::new("fold:0").unwrap()),
                binding: binding(),
                predict_cohort: None,
            })
            .unwrap();

        let record = provider.handle_record(handle.handle).unwrap();
        assert_eq!(record.input_name, "x");
        assert_eq!(record.relation_record_count, Some(4));
        assert_eq!(provider.handle_records().len(), 1);
    }

    #[test]
    fn in_memory_provider_registration_is_idempotent_for_same_envelope() {
        let envelope: ExternalDataPlanEnvelope = serde_json::from_str(include_str!(
            "../tests/fixtures/package/data/coordinator_data_plan_envelope_sample12.json"
        ))
        .unwrap();
        let mut provider =
            InMemoryDataProvider::new(ControllerId::new("controller:data.provider").unwrap());

        provider.register_envelope(envelope.clone()).unwrap();
        provider.register_envelope(envelope).unwrap();
    }

    #[test]
    fn in_memory_provider_refuses_unknown_envelope() {
        let provider =
            InMemoryDataProvider::new(ControllerId::new("controller:data.provider").unwrap());

        assert!(provider
            .materialize(&DataMaterializationRequest {
                run_id: RunId::new("run:data").unwrap(),
                node_id: NodeId::new("model:base").unwrap(),
                input_name: "x".to_string(),
                phase: Phase::FitCv,
                variant_id: None,
                fold_id: None,
                binding: binding(),
                predict_cohort: None,
            })
            .is_err());
    }

    fn cartesian_combination() -> CombinationPlan {
        CombinationPlan {
            mode: CombinationMode::Cartesian,
            component_source_ids: vec!["source:a".to_string(), "source:b".to_string()],
            component_unit_ids: Vec::new(),
            match_key: None,
            reference_source_id: None,
            seed: None,
            cap: None,
            budget: Some(32),
            missing_source_policy: Some(RepresentationMissingSourcePolicy::Strict),
            metadata: BTreeMap::new(),
        }
    }

    fn compatibility_report() -> RepresentationCompatibilityReport {
        RepresentationCompatibilityReport {
            policy: RepresentationMissingSourcePolicy::Mask,
            outcome: RepresentationCompatibilityOutcome::CompatibleWithFallback,
            fallback_used: Some("mask".to_string()),
            warning_severity: Some(RepresentationCompatibilitySeverity::Warning),
            affected_source_count: 1,
            affected_repetition_count: 2,
            affected_sample_count: 3,
            train_relation_fingerprint: Some("c".repeat(64)),
            predict_relation_fingerprint: Some("d".repeat(64)),
            train_unit_count: Some(6),
            predict_unit_count: Some(4),
            fixed_width_required: true,
            final_reducer_stabilizes_output: true,
            cartesian_combo_count_changed: true,
            late_fusion_branch_delta: true,
            messages: vec!["mask fallback applied for missing source".to_string()],
            metadata: BTreeMap::new(),
        }
    }

    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    struct D9GoldenFixture {
        schema_version: u32,
        golden_scenarios: Vec<D9GoldenScenario>,
    }

    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    struct D9GoldenScenario {
        scenario_id: String,
        flow: Vec<String>,
        mock_phase_path: Vec<String>,
        representation_replay_manifest: RepresentationReplayManifest,
        assertions: Vec<String>,
    }

    #[test]
    fn d9_golden_multisource_repetition_manifests_validate() {
        let fixture: D9GoldenFixture = serde_json::from_str(include_str!(
            "../tests/fixtures/package/data/d9_golden_multisource_scenarios.json"
        ))
        .unwrap();
        assert_eq!(fixture.schema_version, 1);
        assert_eq!(fixture.golden_scenarios.len(), 7);

        let mut scenario_ids = BTreeSet::new();
        let mut has_same_repetition_replay = false;
        let mut has_changed_repetition_replay = false;
        let mut has_combo_meta_fit_influence = false;
        for scenario in &fixture.golden_scenarios {
            assert!(
                scenario_ids.insert(scenario.scenario_id.as_str()),
                "duplicate D9 scenario {}",
                scenario.scenario_id
            );
            assert!(!scenario.flow.is_empty());
            assert_eq!(scenario.mock_phase_path, ["fit_cv", "refit", "predict"]);
            assert!(!scenario.assertions.is_empty());

            let manifest = &scenario.representation_replay_manifest;
            manifest.validate().unwrap();
            assert_eq!(
                manifest.final_output_unit_level,
                Some(EntityUnitLevel::PhysicalSample),
                "{} must publish sample-level outputs",
                scenario.scenario_id
            );
            if manifest.output_unit_level == EntityUnitLevel::Combo {
                assert!(
                    manifest.final_reduction_id.is_some(),
                    "{} must declare combo-to-sample reduction",
                    scenario.scenario_id
                );
                assert!(
                    !manifest.combo_selection.is_empty(),
                    "{} must retain relation-backed combo identities",
                    scenario.scenario_id
                );
            }

            if let (Some(train), Some(predict)) = (
                &manifest.train_compatibility,
                &manifest.predict_compatibility,
            ) {
                has_same_repetition_replay |= train.train_unit_count == predict.predict_unit_count
                    && train.train_relation_fingerprint == predict.predict_relation_fingerprint;
                has_changed_repetition_replay |= train.train_unit_count
                    != predict.predict_unit_count
                    || train.train_relation_fingerprint != predict.predict_relation_fingerprint;
            }

            if scenario.scenario_id == "d9.combo_meta_post.relation_backed_adapters" {
                has_combo_meta_fit_influence = manifest
                    .metadata
                    .get("fit_influence_policy")
                    .is_some_and(|value| value == "equal_sample_influence");
            }
        }

        assert!(scenario_ids.contains("d9.per_source_aggregate.source_models.sample_reducer"));
        assert!(scenario_ids.contains("d9.late_fusion_by_source.prediction_join.meta_model"));
        assert!(scenario_ids.contains("d9.cartesian_full.model.combo_to_sample_reducer"));
        assert!(scenario_ids.contains("d9.cartesian_mc.deterministic_replay"));
        assert!(scenario_ids.contains("d9.stack_fixed.strict_cardinality"));
        assert!(scenario_ids.contains("d9.stack_padded_masked.missing_repetition"));
        assert!(scenario_ids.contains("d9.combo_meta_post.relation_backed_adapters"));
        assert!(has_same_repetition_replay);
        assert!(has_changed_repetition_replay);
        assert!(has_combo_meta_fit_influence);
    }

    #[test]
    fn representation_plan_validates_cartesian_and_monte_carlo_contracts() {
        let cartesian = RepresentationPlan::CartesianProduct(CartesianProductRepresentation {
            combination_plan: cartesian_combination(),
            output_unit_level: EntityUnitLevel::Combo,
            cardinality: RepresentationCardinality::ManyToMany,
            preserve_provenance: true,
        });
        cartesian.validate().unwrap();

        let monte_carlo =
            RepresentationPlan::MonteCarloCartesian(MonteCarloCartesianRepresentation {
                combination_plan: CombinationPlan {
                    mode: CombinationMode::SampleK,
                    component_source_ids: vec!["source:a".to_string(), "source:b".to_string()],
                    component_unit_ids: Vec::new(),
                    match_key: None,
                    reference_source_id: None,
                    seed: Some(42),
                    cap: Some(8),
                    budget: None,
                    missing_source_policy: Some(RepresentationMissingSourcePolicy::Warn),
                    metadata: BTreeMap::new(),
                },
                output_unit_level: EntityUnitLevel::Observation,
                cardinality: RepresentationCardinality::BoundedMany,
                preserve_provenance: true,
            });
        monte_carlo.validate().unwrap();

        let mut bad = cartesian_combination();
        bad.mode = CombinationMode::SampleK;
        bad.seed = Some(7);
        bad.cap = Some(0);
        assert!(bad.validate().is_err());
    }

    #[test]
    fn stack_representations_validate_cardinality_and_mask_policy() {
        let fixed = RepresentationPlan::StackFixed(StackFixedRepresentation {
            output_unit_level: EntityUnitLevel::SourceSample,
            cardinality: RepresentationCardinality::OneToMany,
            expected_cardinality: 3,
            component_source_ids: vec!["source:a".to_string(), "source:b".to_string()],
        });
        fixed.validate().unwrap();

        let padded = RepresentationPlan::StackPaddedMasked(StackPaddedMaskedRepresentation {
            output_unit_level: EntityUnitLevel::SourceSample,
            cardinality: RepresentationCardinality::BoundedMany,
            expected_cardinality: 4,
            missing_source_policy: RepresentationMissingSourcePolicy::Mask,
            requires_missing_masks: true,
            component_source_ids: vec!["source:a".to_string()],
        });
        padded.validate().unwrap();

        let bad = RepresentationPlan::StackPaddedMasked(StackPaddedMaskedRepresentation {
            output_unit_level: EntityUnitLevel::SourceSample,
            cardinality: RepresentationCardinality::BoundedMany,
            expected_cardinality: 4,
            missing_source_policy: RepresentationMissingSourcePolicy::ImputeDeclared,
            requires_missing_masks: false,
            component_source_ids: Vec::new(),
        });
        assert!(bad.validate().is_err());
    }

    #[test]
    fn representation_compatibility_report_enforces_missingness_policy() {
        compatibility_report().validate().unwrap();

        let strict = RepresentationCompatibilityReport {
            policy: RepresentationMissingSourcePolicy::Strict,
            outcome: RepresentationCompatibilityOutcome::Incompatible,
            fallback_used: None,
            warning_severity: None,
            affected_source_count: 1,
            affected_repetition_count: 0,
            affected_sample_count: 1,
            train_relation_fingerprint: None,
            predict_relation_fingerprint: None,
            train_unit_count: None,
            predict_unit_count: None,
            fixed_width_required: false,
            final_reducer_stabilizes_output: false,
            cartesian_combo_count_changed: false,
            late_fusion_branch_delta: false,
            messages: Vec::new(),
            metadata: BTreeMap::new(),
        };
        strict.validate().unwrap();

        let mut bad_non_strict = compatibility_report();
        bad_non_strict.fallback_used = None;
        assert!(bad_non_strict.validate().is_err());

        let mut bad_fixed_width = compatibility_report();
        bad_fixed_width.policy = RepresentationMissingSourcePolicy::ImputeDeclared;
        bad_fixed_width.fallback_used = Some("impute_declared".to_string());
        assert!(bad_fixed_width.validate().is_err());

        let mut bad_cartesian = compatibility_report();
        bad_cartesian.final_reducer_stabilizes_output = false;
        assert!(bad_cartesian.validate().is_err());

        let bad_relation_drift = RepresentationCompatibilityReport {
            policy: RepresentationMissingSourcePolicy::Strict,
            outcome: RepresentationCompatibilityOutcome::Compatible,
            fallback_used: None,
            warning_severity: None,
            affected_source_count: 0,
            affected_repetition_count: 0,
            affected_sample_count: 0,
            train_relation_fingerprint: Some("a".repeat(64)),
            predict_relation_fingerprint: Some("b".repeat(64)),
            train_unit_count: Some(3),
            predict_unit_count: Some(3),
            fixed_width_required: false,
            final_reducer_stabilizes_output: true,
            cartesian_combo_count_changed: false,
            late_fusion_branch_delta: false,
            messages: Vec::new(),
            metadata: BTreeMap::new(),
        };
        let error = bad_relation_drift.validate().unwrap_err().to_string();
        assert!(
            error.contains("relation fingerprint mismatch requires affected units"),
            "unexpected D9 relation drift error: {error}"
        );

        let mut bad_unit_drift = bad_relation_drift;
        bad_unit_drift.predict_relation_fingerprint =
            bad_unit_drift.train_relation_fingerprint.clone();
        bad_unit_drift.predict_unit_count = Some(2);
        let error = bad_unit_drift.validate().unwrap_err().to_string();
        assert!(
            error.contains("unit count mismatch requires affected units"),
            "unexpected D9 unit-count drift error: {error}"
        );
    }

    #[test]
    fn representation_replay_manifest_round_trips_and_validates() {
        let plan = RepresentationPlan::CartesianProduct(CartesianProductRepresentation {
            combination_plan: cartesian_combination(),
            output_unit_level: EntityUnitLevel::Combo,
            cardinality: RepresentationCardinality::ManyToMany,
            preserve_provenance: true,
        });
        let manifest = RepresentationReplayManifest {
            manifest_id: "repr:combo.ab".to_string(),
            representation_plan: plan,
            combination_plan: Some(cartesian_combination()),
            output_unit_level: EntityUnitLevel::Combo,
            output_representation: Some("combo_observation".to_string()),
            relation_fingerprint: Some("a".repeat(64)),
            feature_schema_fingerprint: Some("b".repeat(64)),
            final_reduction_id: Some("reduction:combo_to_sample".to_string()),
            sample_observation_mapping: vec![
                RepresentationSampleObservationMapping {
                    physical_sample_id: "sample:1".to_string(),
                    source_id: "source:a".to_string(),
                    observation_ids: vec!["obs:a.1".to_string(), "obs:a.2".to_string()],
                },
                RepresentationSampleObservationMapping {
                    physical_sample_id: "sample:1".to_string(),
                    source_id: "source:b".to_string(),
                    observation_ids: vec!["obs:b.1".to_string()],
                },
            ],
            combo_selection: vec![RepresentationComboSelectionRecord {
                combo_unit_id: "combo:sample1:a1:b1".to_string(),
                physical_sample_id: "sample:1".to_string(),
                component_observation_ids: vec!["obs:a.1".to_string(), "obs:b.1".to_string()],
                seed: Some(42),
            }],
            qc_policy_refs: vec!["qc:default".to_string()],
            outlier_policy_refs: vec!["outlier:none".to_string()],
            missing_source_policy: Some(RepresentationMissingSourcePolicy::Strict),
            missing_repetition_policy: Some(RepresentationMissingSourcePolicy::Warn),
            prediction_representation: Some("sample_prediction".to_string()),
            final_output_unit_level: Some(EntityUnitLevel::PhysicalSample),
            train_compatibility: Some(RepresentationCompatibilityReport {
                policy: RepresentationMissingSourcePolicy::Strict,
                outcome: RepresentationCompatibilityOutcome::Compatible,
                fallback_used: None,
                warning_severity: None,
                affected_source_count: 0,
                affected_repetition_count: 0,
                affected_sample_count: 0,
                train_relation_fingerprint: Some("a".repeat(64)),
                predict_relation_fingerprint: None,
                train_unit_count: Some(1),
                predict_unit_count: Some(1),
                fixed_width_required: false,
                final_reducer_stabilizes_output: true,
                cartesian_combo_count_changed: false,
                late_fusion_branch_delta: false,
                messages: Vec::new(),
                metadata: BTreeMap::new(),
            }),
            predict_compatibility: Some(compatibility_report()),
            metadata: BTreeMap::new(),
        };

        manifest.validate().unwrap();
        let encoded = serde_json::to_string(&manifest).unwrap();
        let decoded: RepresentationReplayManifest = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded, manifest);
    }
}
