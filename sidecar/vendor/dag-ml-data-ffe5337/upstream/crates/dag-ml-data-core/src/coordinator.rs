use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::error::{DataError, Result};
use crate::fingerprint::{data_plan_fingerprint, sample_relation_fingerprint, schema_fingerprint};
use crate::ids::{GroupId, ObservationId, SampleId, SourceId, TargetId};
use crate::model::DatasetSchema;
use crate::plan::DataPlan;
use crate::relation::SampleRelationTable;

pub const COORDINATOR_DATA_PLAN_ENVELOPE_SCHEMA_VERSION: u32 = 1;
pub const COORDINATOR_BRANCH_VIEW_SCHEMA_VERSION: u32 = 1;
pub const COORDINATOR_BRANCH_VIEW_SCHEMA_ID: &str =
    "https://github.com/GBeurier/dag-ml-data/schemas/coordinator_branch_view.v1.schema.json";

fn default_coordinator_data_plan_envelope_schema_version() -> u32 {
    COORDINATOR_DATA_PLAN_ENVELOPE_SCHEMA_VERSION
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CoordinatorRelation {
    pub observation_id: ObservationId,
    pub sample_id: SampleId,
    #[serde(default)]
    pub target_id: Option<TargetId>,
    #[serde(default)]
    pub group_id: Option<GroupId>,
    #[serde(default)]
    pub origin_sample_id: Option<SampleId>,
    #[serde(default)]
    pub source_id: Option<SourceId>,
    #[serde(default)]
    pub is_augmented: bool,
    #[serde(default)]
    pub excluded: bool,
    // Metadata + tags carried from the source `SampleRelation` so `by_metadata`
    // and `by_tag` branch views filter natively in the in-memory provider.
    // Skipped when empty so existing coordinator relations stay byte-identical.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, serde_json::Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CoordinatorBranchViewMode {
    Separation,
    BySource,
    ByMetadata,
    ByTag,
    ByFilter,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CoordinatorBranchViewSelector {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub source_ids: Vec<SourceId>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, serde_json::Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter: Option<serde_json::Value>,
}

/// Closed native predicate accepted by a `by_filter` coordinator branch view.
///
/// This deliberately describes only relation properties that are already
/// present in a coordinator envelope. It is not a general JSON query language:
/// accepting an unrecognised predicate would let a host believe a scientific
/// partition was applied when the provider cannot prove that it was.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct NativeBranchViewFilter {
    #[serde(default)]
    pub metadata_equals: BTreeMap<String, serde_json::Value>,
    #[serde(default)]
    pub tags_all: Vec<String>,
}

pub(crate) fn parse_native_branch_view_filter(
    value: &serde_json::Value,
    label: &str,
) -> Result<NativeBranchViewFilter> {
    let filter = serde_json::from_value::<NativeBranchViewFilter>(value.clone()).map_err(|error| {
        DataError::Validation(format!(
            "{label} mode=by_filter requires the native predicate {{metadata_equals, tags_all}}: {error}"
        ))
    })?;
    if filter.metadata_equals.is_empty() && filter.tags_all.is_empty() {
        return Err(DataError::Validation(format!(
            "{label} mode=by_filter predicate must constrain metadata_equals or tags_all"
        )));
    }
    for (key, value) in &filter.metadata_equals {
        if key.trim().is_empty() {
            return Err(DataError::Validation(format!(
                "{label} mode=by_filter metadata_equals contains an empty key"
            )));
        }
        if value.is_null() {
            return Err(DataError::Validation(format!(
                "{label} mode=by_filter metadata_equals `{key}` must not be null"
            )));
        }
    }
    let mut seen_tags = std::collections::BTreeSet::new();
    for tag in &filter.tags_all {
        if tag.trim().is_empty() {
            return Err(DataError::Validation(format!(
                "{label} mode=by_filter tags_all contains an empty entry"
            )));
        }
        if !seen_tags.insert(tag) {
            return Err(DataError::Validation(format!(
                "{label} mode=by_filter tags_all contains duplicate `{tag}`"
            )));
        }
    }
    Ok(filter)
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CoordinatorBranchView {
    pub view_id: String,
    pub branch_id: String,
    pub mode: CoordinatorBranchViewMode,
    pub selector: CoordinatorBranchViewSelector,
    #[serde(default)]
    pub allow_overlap: bool,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, serde_json::Value>,
}

impl CoordinatorBranchViewSelector {
    // Error message phrasings are intentionally more specific than dag-ml's
    // generic `validate_unique_strings`/`validate_string_list_entries`
    // helpers; host adapters that present a unified error surface across the
    // two repos must avoid cross-repo string matching on these messages.
    pub fn validate(&self, label: &str) -> Result<()> {
        if self.source_ids.is_empty()
            && self.metadata.is_empty()
            && self.tags.is_empty()
            && self.filter.is_none()
        {
            return Err(DataError::Validation(format!(
                "{label} selector must constrain source_ids, metadata, tags or filter"
            )));
        }
        let mut seen_sources = std::collections::BTreeSet::new();
        for source_id in &self.source_ids {
            if !seen_sources.insert(source_id) {
                return Err(DataError::Validation(format!(
                    "{label} selector source_ids contains duplicate `{source_id}`"
                )));
            }
        }
        let mut seen_tags = std::collections::BTreeSet::new();
        for tag in &self.tags {
            if tag.trim().is_empty() {
                return Err(DataError::Validation(format!(
                    "{label} selector tags contains an empty entry"
                )));
            }
            if !seen_tags.insert(tag) {
                return Err(DataError::Validation(format!(
                    "{label} selector tags contains duplicate `{tag}`"
                )));
            }
        }
        for key in self.metadata.keys() {
            if key.trim().is_empty() {
                return Err(DataError::Validation(format!(
                    "{label} selector contains an empty metadata key"
                )));
            }
        }
        if matches!(self.filter, Some(serde_json::Value::Null)) {
            return Err(DataError::Validation(format!(
                "{label} selector filter must not be null"
            )));
        }
        Ok(())
    }
}

impl CoordinatorBranchView {
    pub fn validate(&self) -> Result<()> {
        if self.view_id.trim().is_empty() {
            return Err(DataError::Validation(
                "coordinator branch view view_id is empty".to_string(),
            ));
        }
        if self.branch_id.trim().is_empty() {
            return Err(DataError::Validation(format!(
                "coordinator branch view `{}` branch_id is empty",
                self.view_id
            )));
        }
        let label = format!("coordinator branch view `{}`", self.view_id);
        self.selector.validate(&label)?;
        for key in self.metadata.keys() {
            if key.trim().is_empty() {
                return Err(DataError::Validation(format!(
                    "{label} metadata contains an empty key"
                )));
            }
        }
        match self.mode {
            CoordinatorBranchViewMode::BySource if self.selector.source_ids.is_empty() => Err(
                DataError::Validation(format!("{label} mode=by_source requires source_ids")),
            ),
            CoordinatorBranchViewMode::ByMetadata if self.selector.metadata.is_empty() => Err(
                DataError::Validation(format!("{label} mode=by_metadata requires metadata")),
            ),
            CoordinatorBranchViewMode::ByTag if self.selector.tags.is_empty() => Err(
                DataError::Validation(format!("{label} mode=by_tag requires tags")),
            ),
            CoordinatorBranchViewMode::ByFilter => {
                if !self.selector.source_ids.is_empty()
                    || !self.selector.metadata.is_empty()
                    || !self.selector.tags.is_empty()
                {
                    return Err(DataError::Validation(format!(
                        "{label} mode=by_filter accepts constraints only inside filter"
                    )));
                }
                let filter = self.selector.filter.as_ref().ok_or_else(|| {
                    DataError::Validation(format!("{label} mode=by_filter requires filter"))
                })?;
                parse_native_branch_view_filter(filter, &label)?;
                Ok(())
            }
            _ => Ok(()),
        }
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct CoordinatorRelationSet {
    #[serde(default)]
    pub records: Vec<CoordinatorRelation>,
}

impl CoordinatorRelationSet {
    pub fn validate(&self) -> Result<()> {
        if self.records.is_empty() {
            return Err(DataError::Validation(
                "coordinator relation set contains no records".to_string(),
            ));
        }
        let mut seen = std::collections::BTreeSet::new();
        for record in &self.records {
            if !seen.insert(&record.observation_id) {
                return Err(DataError::Validation(format!(
                    "duplicate coordinator observation `{}`",
                    record.observation_id
                )));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CoordinatorDataPlanEnvelope {
    #[serde(default = "default_coordinator_data_plan_envelope_schema_version")]
    pub schema_version: u32,
    pub schema_fingerprint: String,
    pub plan_fingerprint: String,
    #[serde(default)]
    pub relation_fingerprint: Option<String>,
    /// Optional additive identity of the concrete feature/input content.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_content_fingerprint: Option<String>,
    /// Optional additive identity of the concrete target content.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_content_fingerprint: Option<String>,
    pub plan: DataPlan,
    #[serde(default)]
    pub coordinator_relations: Option<CoordinatorRelationSet>,
    #[serde(default)]
    pub metadata: BTreeMap<String, serde_json::Value>,
}

impl CoordinatorDataPlanEnvelope {
    pub fn from_parts(
        schema: &DatasetSchema,
        plan: DataPlan,
        relations: Option<&SampleRelationTable>,
    ) -> Result<Self> {
        let schema_fingerprint = schema_fingerprint(schema)?;
        let plan_fingerprint = data_plan_fingerprint(&plan)?;
        let relation_fingerprint = relations.map(sample_relation_fingerprint).transpose()?;
        let coordinator_relations = relations
            .map(coordinator_relations_from_sample_table)
            .transpose()?;
        let envelope = Self {
            schema_version: COORDINATOR_DATA_PLAN_ENVELOPE_SCHEMA_VERSION,
            schema_fingerprint,
            plan_fingerprint,
            relation_fingerprint,
            data_content_fingerprint: None,
            target_content_fingerprint: None,
            plan,
            coordinator_relations,
            metadata: BTreeMap::new(),
        };
        envelope.validate()?;
        Ok(envelope)
    }

    /// Validate the envelope.
    ///
    /// Only the `plan` fingerprint is *recomputed* and matched against the
    /// declared value (the plan is carried in the envelope), so a tampered plan
    /// is rejected with [`DataError::FingerprintMismatch`]. The `schema` and
    /// `relation` fingerprints are replay keys for source artifacts (the
    /// `DatasetSchema` and the source `SampleRelationTable`) that are *not*
    /// carried here, so they are format-validated only; the embedded
    /// `coordinator_relations` is a derived view validated structurally, not
    /// against the fingerprint.
    pub fn validate(&self) -> Result<()> {
        if self.schema_version != COORDINATOR_DATA_PLAN_ENVELOPE_SCHEMA_VERSION {
            return Err(DataError::Validation(format!(
                "coordinator data-plan envelope uses unsupported schema_version {}, expected {}",
                self.schema_version, COORDINATOR_DATA_PLAN_ENVELOPE_SCHEMA_VERSION
            )));
        }
        validate_fingerprint("schema", &self.schema_fingerprint)?;
        validate_fingerprint("plan", &self.plan_fingerprint)?;
        self.plan.validate()?;
        let actual_plan = data_plan_fingerprint(&self.plan)?;
        if actual_plan != self.plan_fingerprint {
            return Err(DataError::FingerprintMismatch {
                kind: "plan",
                expected: self.plan_fingerprint.clone(),
                actual: actual_plan,
            });
        }
        if let Some(relations) = &self.coordinator_relations {
            relations.validate()?;
        }
        if let Some(relation_fingerprint) = &self.relation_fingerprint {
            validate_fingerprint("relation", relation_fingerprint)?;
            if self.coordinator_relations.is_none() {
                return Err(DataError::Validation(
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
        Ok(())
    }
}

pub fn coordinator_relations_from_sample_table(
    relations: &SampleRelationTable,
) -> Result<CoordinatorRelationSet> {
    relations.validate()?;
    let observation_to_sample = relations
        .rows
        .iter()
        .map(|row| (&row.observation_id, &row.sample_id))
        .collect::<BTreeMap<_, _>>();
    let mut records = relations
        .rows
        .iter()
        .map(|row| {
            let origin_sample_id = row
                .origin_id
                .as_ref()
                .map(|origin_id| {
                    observation_to_sample
                        .iter()
                        .find_map(|(observation_id, sample_id)| {
                            (observation_id.as_str() == origin_id.as_str())
                                .then_some((*sample_id).clone())
                        })
                        .ok_or_else(|| {
                            DataError::Validation(format!(
                                "origin `{origin_id}` is not present as an observation"
                            ))
                        })
                })
                .transpose()?;
            Ok(CoordinatorRelation {
                observation_id: row.observation_id.clone(),
                sample_id: row.sample_id.clone(),
                target_id: row.target_id.clone(),
                group_id: row.group_id.clone(),
                origin_sample_id,
                source_id: row.source_id.clone(),
                is_augmented: row.augmented,
                excluded: row.excluded,
                metadata: row.metadata.clone(),
                tags: row.tags.clone(),
            })
        })
        .collect::<Result<Vec<_>>>()?;
    records.sort_by(|left, right| left.observation_id.cmp(&right.observation_id));
    let converted = CoordinatorRelationSet { records };
    converted.validate()?;
    Ok(converted)
}

pub(crate) fn validate_fingerprint(label: &str, value: &str) -> Result<()> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(DataError::Validation(format!(
            "{label} fingerprint must be a 64-character hex digest"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn load_schema() -> DatasetSchema {
        serde_json::from_str(include_str!(
            "../../../examples/fixtures/oof_campaign/schema_nir_6_samples.json"
        ))
        .unwrap()
    }

    fn load_plan() -> DataPlan {
        serde_json::from_str(include_str!(
            "../../../examples/fixtures/oof_campaign/expected_data_plan_nir_to_tabular.json"
        ))
        .unwrap()
    }

    fn load_relations() -> SampleRelationTable {
        serde_json::from_str(include_str!(
            "../../../examples/fixtures/oof_campaign/sample_relations_grouped_augmented.json"
        ))
        .unwrap()
    }

    #[test]
    fn converts_data_relations_to_coordinator_relations() {
        let converted = coordinator_relations_from_sample_table(&load_relations()).unwrap();

        let augmented = converted
            .records
            .iter()
            .find(|record| record.observation_id.as_str() == "obs.S001.aug0")
            .unwrap();
        assert_eq!(
            augmented.origin_sample_id.as_ref().map(ToString::to_string),
            Some("S001".to_string())
        );
        assert!(augmented.is_augmented);
    }

    #[test]
    fn conversion_carries_excluded_bit() {
        use crate::ids::ObservationId;
        use crate::relation::{SampleRelation, SampleRelationTable};

        let row = |observation: &str, sample: &str, excluded: bool| SampleRelation {
            observation_id: ObservationId::new(observation).unwrap(),
            sample_id: SampleId::new(sample).unwrap(),
            source_id: None,
            target_id: None,
            group_id: None,
            origin_id: None,
            repetition_id: None,
            augmented: false,
            excluded,
            metadata: BTreeMap::new(),
            tags: Vec::new(),
            augmentation: None,
        };
        let table = SampleRelationTable {
            rows: vec![row("obs.X", "X", true), row("obs.Y", "Y", false)],
        };

        let converted = coordinator_relations_from_sample_table(&table).unwrap();
        let x = converted
            .records
            .iter()
            .find(|record| record.observation_id.as_str() == "obs.X")
            .unwrap();
        let y = converted
            .records
            .iter()
            .find(|record| record.observation_id.as_str() == "obs.Y")
            .unwrap();
        assert!(
            x.excluded,
            "excluded bit must propagate into coordinator relation"
        );
        assert!(!y.excluded, "non-excluded rows stay excluded=false");
    }

    #[test]
    fn envelope_validates_fingerprints_and_payloads() {
        let envelope = CoordinatorDataPlanEnvelope::from_parts(
            &load_schema(),
            load_plan(),
            Some(&load_relations()),
        )
        .unwrap();

        envelope.validate().unwrap();
        assert_eq!(
            envelope.schema_version,
            COORDINATOR_DATA_PLAN_ENVELOPE_SCHEMA_VERSION
        );
        assert!(envelope.coordinator_relations.is_some());
    }

    #[test]
    fn envelope_refuses_unsupported_schema_version() {
        let mut envelope =
            CoordinatorDataPlanEnvelope::from_parts(&load_schema(), load_plan(), None).unwrap();
        envelope.schema_version = COORDINATOR_DATA_PLAN_ENVELOPE_SCHEMA_VERSION + 1;

        assert!(envelope.validate().is_err());
    }

    #[test]
    fn envelope_refuses_plan_fingerprint_mismatch() {
        let mut envelope =
            CoordinatorDataPlanEnvelope::from_parts(&load_schema(), load_plan(), None).unwrap();
        envelope.plan_fingerprint = "0".repeat(64);

        let error = envelope.validate().unwrap_err();
        assert_eq!(error.category(), "compatibility");
        assert_eq!(error.code(), "fingerprint_mismatch");
        assert_eq!(error.error_code(), 0x0008_0002);
    }

    #[test]
    fn fixture_envelope_validates() {
        let envelope: CoordinatorDataPlanEnvelope = serde_json::from_str(include_str!(
            "../../../examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json"
        ))
        .unwrap();

        envelope.validate().unwrap();
    }

    #[test]
    fn envelope_content_fingerprints_are_additive_and_validated() {
        let mut envelope: CoordinatorDataPlanEnvelope = serde_json::from_str(include_str!(
            "../../../examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json"
        ))
        .unwrap();
        assert!(envelope.data_content_fingerprint.is_none());
        assert!(envelope.target_content_fingerprint.is_none());
        let legacy = serde_json::to_value(&envelope).unwrap();
        assert!(legacy.get("data_content_fingerprint").is_none());
        assert!(legacy.get("target_content_fingerprint").is_none());

        envelope.data_content_fingerprint = Some("a".repeat(64));
        envelope.target_content_fingerprint = Some("b".repeat(64));
        envelope.validate().unwrap();
        envelope.data_content_fingerprint = Some("invalid".to_string());
        assert!(envelope.validate().is_err());
    }

    #[test]
    fn published_envelope_schema_declares_current_version() {
        let schema: serde_json::Value = serde_json::from_str(include_str!(
            "../../../docs/contracts/coordinator_data_plan_envelope.schema.json"
        ))
        .unwrap();

        assert_eq!(
            schema["properties"]["schema_version"]["const"].as_u64(),
            Some(COORDINATOR_DATA_PLAN_ENVELOPE_SCHEMA_VERSION as u64)
        );
        assert!(schema["required"]
            .as_array()
            .unwrap()
            .iter()
            .any(|field| field.as_str() == Some("schema_version")));
    }

    #[test]
    fn coordinator_branch_view_validates_mode_field_agreement() {
        let mut view = CoordinatorBranchView {
            view_id: "branch_view:1".to_string(),
            branch_id: "branch:1".to_string(),
            mode: CoordinatorBranchViewMode::BySource,
            selector: CoordinatorBranchViewSelector {
                source_ids: vec![SourceId::new("nir").unwrap()],
                ..Default::default()
            },
            allow_overlap: false,
            metadata: BTreeMap::new(),
        };
        view.validate().unwrap();

        view.selector.source_ids.clear();
        view.selector.tags = vec!["clean".to_string()];
        let error = view.validate().unwrap_err();
        assert!(format!("{error}").contains("mode=by_source requires source_ids"));

        view.mode = CoordinatorBranchViewMode::ByMetadata;
        view.selector.tags.clear();
        let error = view.validate().unwrap_err();
        assert!(format!("{error}").contains("must constrain source_ids, metadata, tags or filter"));

        view.selector
            .metadata
            .insert("site".to_string(), serde_json::json!("a"));
        view.validate().unwrap();

        view.view_id = "".to_string();
        let error = view.validate().unwrap_err();
        assert!(format!("{error}").contains("view_id is empty"));
    }

    #[test]
    fn published_branch_view_schema_declares_current_id() {
        let schema: serde_json::Value = serde_json::from_str(include_str!(
            "../../../docs/contracts/coordinator_branch_view.schema.json"
        ))
        .unwrap();
        assert_eq!(
            schema["$id"].as_str(),
            Some(COORDINATOR_BRANCH_VIEW_SCHEMA_ID)
        );
        assert!(
            schema["$id"].as_str().unwrap().ends_with(&format!(
                "v{COORDINATOR_BRANCH_VIEW_SCHEMA_VERSION}.schema.json"
            )),
            "schema $id `{}` must encode version v{COORDINATOR_BRANCH_VIEW_SCHEMA_VERSION}",
            schema["$id"]
        );
        let modes = schema["$defs"]["branch_view_mode"]["enum"]
            .as_array()
            .unwrap();
        for expected in [
            "separation",
            "by_source",
            "by_metadata",
            "by_tag",
            "by_filter",
        ] {
            assert!(
                modes.iter().any(|value| value.as_str() == Some(expected)),
                "schema branch_view_mode is missing `{expected}`"
            );
        }
    }

    #[test]
    fn coordinator_branch_view_selector_refuses_duplicates_and_empties() {
        let label = "branch view `branch_view:1`";
        let selector = CoordinatorBranchViewSelector {
            source_ids: vec![SourceId::new("nir").unwrap(), SourceId::new("nir").unwrap()],
            ..Default::default()
        };
        let error = selector.validate(label).unwrap_err();
        assert!(format!("{error}").contains("source_ids contains duplicate"));

        let selector = CoordinatorBranchViewSelector {
            tags: vec!["clean".to_string(), "clean".to_string()],
            ..Default::default()
        };
        let error = selector.validate(label).unwrap_err();
        assert!(format!("{error}").contains("tags contains duplicate"));

        let selector = CoordinatorBranchViewSelector {
            tags: vec!["   ".to_string()],
            ..Default::default()
        };
        let error = selector.validate(label).unwrap_err();
        assert!(format!("{error}").contains("tags contains an empty entry"));

        let selector = CoordinatorBranchViewSelector {
            filter: Some(serde_json::Value::Null),
            ..Default::default()
        };
        let error = selector.validate(label).unwrap_err();
        assert!(format!("{error}").contains("filter must not be null"));
    }
}
