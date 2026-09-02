use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::campaign::stable_json_fingerprint;
use crate::error::{DagMlError, Result};
use crate::fold::FoldSet;
use crate::ids::{GroupId, ObservationId, SampleId, TargetId};
use crate::policy::{LeakageUnitPolicy, SplitUnit};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FoldPartition {
    Train,
    Validation,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EntityUnitLevel {
    PhysicalSample,
    SourceSample,
    #[default]
    Observation,
    Combo,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SampleRelation {
    #[serde(default)]
    pub unit_level: EntityUnitLevel,
    #[serde(default)]
    pub unit_id: Option<String>,
    pub observation_id: ObservationId,
    pub sample_id: SampleId,
    #[serde(default)]
    pub source_id: Option<String>,
    #[serde(default)]
    pub rep_id: Option<String>,
    #[serde(default)]
    pub target_id: Option<TargetId>,
    #[serde(default)]
    pub group_id: Option<GroupId>,
    #[serde(default)]
    pub origin_sample_id: Option<SampleId>,
    #[serde(default)]
    pub derived_unit_id: Option<String>,
    #[serde(default)]
    pub component_observation_ids: Vec<ObservationId>,
    #[serde(default)]
    pub sample_influence_weight: Option<f64>,
    #[serde(default)]
    pub quality_flag: Option<String>,
    #[serde(default)]
    pub is_augmented: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub excluded: bool,
    // Metadata + tags carried so a `by_metadata` / `by_tag` branch view selector
    // can match natively in the data provider. Skipped when empty so relation
    // sets without them keep byte-identical fingerprints (existing fixtures and
    // contracts stay unaffected). A non-empty value changes the replay
    // fingerprint because it changes which samples a branch view selects.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, serde_json::Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
}

fn is_false(value: &bool) -> bool {
    !*value
}

impl SampleRelation {
    pub fn new(observation_id: ObservationId, sample_id: SampleId) -> Self {
        Self {
            unit_level: EntityUnitLevel::Observation,
            unit_id: None,
            observation_id,
            sample_id,
            source_id: None,
            rep_id: None,
            target_id: None,
            group_id: None,
            origin_sample_id: None,
            derived_unit_id: None,
            component_observation_ids: Vec::new(),
            sample_influence_weight: None,
            quality_flag: None,
            is_augmented: false,
            excluded: false,
            metadata: BTreeMap::new(),
            tags: Vec::new(),
        }
    }

    pub fn effective_unit_id(&self) -> Result<String> {
        if let Some(unit_id) = non_empty_optional("unit_id", &self.observation_id, &self.unit_id)? {
            return Ok(unit_id.to_string());
        }

        match self.unit_level {
            EntityUnitLevel::PhysicalSample => Ok(self.sample_id.to_string()),
            EntityUnitLevel::SourceSample => {
                let source_id =
                    non_empty_optional("source_id", &self.observation_id, &self.source_id)?
                        .ok_or_else(|| {
                            DagMlError::CampaignValidation(format!(
                                "source-sample relation `{}` requires source_id",
                                self.observation_id
                            ))
                        })?;
                Ok(format!("{}::{source_id}", self.sample_id))
            }
            EntityUnitLevel::Observation => Ok(self.observation_id.to_string()),
            EntityUnitLevel::Combo => {
                let derived_unit_id = non_empty_optional(
                    "derived_unit_id",
                    &self.observation_id,
                    &self.derived_unit_id,
                )?
                .ok_or_else(|| {
                    DagMlError::CampaignValidation(format!(
                        "combo relation `{}` requires derived_unit_id",
                        self.observation_id
                    ))
                })?;
                Ok(derived_unit_id.to_string())
            }
        }
    }

    fn validate(&self) -> Result<()> {
        non_empty_optional("unit_id", &self.observation_id, &self.unit_id)?;
        non_empty_optional("source_id", &self.observation_id, &self.source_id)?;
        non_empty_optional(
            "derived_unit_id",
            &self.observation_id,
            &self.derived_unit_id,
        )?;
        non_empty_optional("quality_flag", &self.observation_id, &self.quality_flag)?;
        validate_optional_identifier("rep_id", &self.observation_id, &self.rep_id)?;

        if let Some(weight) = self.sample_influence_weight {
            if !weight.is_finite() || weight <= 0.0 {
                return Err(DagMlError::CampaignValidation(format!(
                    "relation `{}` has invalid sample_influence_weight",
                    self.observation_id
                )));
            }
        }

        if self.unit_level != EntityUnitLevel::Combo && !self.component_observation_ids.is_empty() {
            return Err(DagMlError::CampaignValidation(format!(
                "relation `{}` has component_observation_ids but is not a combo",
                self.observation_id
            )));
        }

        self.effective_unit_id()?;
        Ok(())
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SampleRelationSet {
    #[serde(default)]
    pub records: Vec<SampleRelation>,
}

pub fn relation_set_fingerprint(relations: &SampleRelationSet) -> Result<String> {
    relations.fingerprint()
}

#[derive(Clone, Debug, Serialize)]
struct CanonicalRelationRecord {
    effective_unit_id: String,
    unit_level: EntityUnitLevel,
    unit_id: Option<String>,
    observation_id: ObservationId,
    sample_id: SampleId,
    source_id: Option<String>,
    rep_id: Option<String>,
    target_id: Option<TargetId>,
    group_id: Option<GroupId>,
    origin_sample_id: Option<SampleId>,
    derived_unit_id: Option<String>,
    component_observation_ids: Vec<ObservationId>,
    sample_influence_weight: Option<f64>,
    quality_flag: Option<String>,
    is_augmented: bool,
    // Skipped when false so `excluded=false` relation sets keep byte-identical
    // fingerprints (and existing fixtures/contracts stay unaffected); an
    // `excluded=true` row correctly changes the replay fingerprint because it
    // changes the training set.
    #[serde(default, skip_serializing_if = "is_false")]
    excluded: bool,
    // Skipped when empty so relations without metadata/tags keep byte-identical
    // fingerprints; a non-empty value correctly changes the replay fingerprint
    // because it changes which samples a `by_metadata` / `by_tag` branch view
    // selects.
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    metadata: BTreeMap<String, serde_json::Value>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tags: Vec<String>,
}

impl SampleRelationSet {
    pub fn validate(&self) -> Result<()> {
        let mut observations = BTreeSet::new();
        let mut observation_samples = BTreeMap::<ObservationId, SampleId>::new();
        let mut unit_ids = BTreeMap::<String, ObservationId>::new();
        let mut sample_targets = BTreeMap::<SampleId, TargetId>::new();
        let mut sample_groups = BTreeMap::<SampleId, GroupId>::new();
        for record in &self.records {
            record.validate()?;
            if !observations.insert(&record.observation_id) {
                return Err(DagMlError::CampaignValidation(format!(
                    "duplicate observation relation `{}`",
                    record.observation_id
                )));
            }
            observation_samples.insert(record.observation_id.clone(), record.sample_id.clone());
            let effective_unit_id = record.effective_unit_id()?;
            if let Some(previous) =
                unit_ids.insert(effective_unit_id.clone(), record.observation_id.clone())
            {
                return Err(DagMlError::CampaignValidation(format!(
                    "relations `{previous}` and `{}` share effective unit id `{effective_unit_id}`",
                    record.observation_id
                )));
            }
            if let Some(target_id) = &record.target_id {
                if let Some(previous) = sample_targets.get(&record.sample_id) {
                    if previous != target_id {
                        return Err(DagMlError::CampaignValidation(format!(
                            "sample `{}` maps to multiple targets",
                            record.sample_id
                        )));
                    }
                } else {
                    sample_targets.insert(record.sample_id.clone(), target_id.clone());
                }
            }
            if let Some(group_id) = &record.group_id {
                if let Some(previous) = sample_groups.get(&record.sample_id) {
                    if previous != group_id {
                        return Err(DagMlError::CampaignValidation(format!(
                            "sample `{}` maps to multiple groups",
                            record.sample_id
                        )));
                    }
                } else {
                    sample_groups.insert(record.sample_id.clone(), group_id.clone());
                }
            }
        }
        for record in &self.records {
            validate_combo_record(record, &observation_samples)?;
        }
        Ok(())
    }

    pub fn fingerprint(&self) -> Result<String> {
        self.validate()?;
        let mut canonical = self
            .records
            .iter()
            .map(|record| {
                let effective_unit_id = record.effective_unit_id()?;
                Ok(CanonicalRelationRecord {
                    effective_unit_id,
                    unit_level: record.unit_level,
                    unit_id: record.unit_id.clone(),
                    observation_id: record.observation_id.clone(),
                    sample_id: record.sample_id.clone(),
                    source_id: record.source_id.clone(),
                    rep_id: record.rep_id.clone(),
                    target_id: record.target_id.clone(),
                    group_id: record.group_id.clone(),
                    origin_sample_id: record.origin_sample_id.clone(),
                    derived_unit_id: record.derived_unit_id.clone(),
                    component_observation_ids: record.component_observation_ids.clone(),
                    sample_influence_weight: record.sample_influence_weight,
                    quality_flag: record.quality_flag.clone(),
                    is_augmented: record.is_augmented,
                    excluded: record.excluded,
                    metadata: record.metadata.clone(),
                    tags: record.tags.clone(),
                })
            })
            .collect::<Result<Vec<_>>>()?;
        canonical.sort_by(|left, right| {
            (
                left.effective_unit_id.as_str(),
                left.observation_id.as_str(),
                left.sample_id.as_str(),
            )
                .cmp(&(
                    right.effective_unit_id.as_str(),
                    right.observation_id.as_str(),
                    right.sample_id.as_str(),
                ))
        });
        stable_json_fingerprint(&canonical)
    }

    pub fn validate_against_fold_set(
        &self,
        fold_set: &FoldSet,
        policy: &LeakageUnitPolicy,
    ) -> Result<()> {
        self.validate()?;
        fold_set.validate()?;
        policy.validate()?;

        let universe = fold_set.sample_ids.iter().collect::<BTreeSet<_>>();
        for record in &self.records {
            if !universe.contains(&record.sample_id) {
                return Err(DagMlError::CampaignValidation(format!(
                    "relation `{}` references sample `{}` outside fold set",
                    record.observation_id, record.sample_id
                )));
            }
            if let Some(origin_sample_id) = &record.origin_sample_id {
                if !universe.contains(origin_sample_id) {
                    return Err(DagMlError::CampaignValidation(format!(
                        "relation `{}` references origin sample `{}` outside fold set",
                        record.observation_id, origin_sample_id
                    )));
                }
            }
            if policy.require_group_ids && record.group_id.is_none() {
                return Err(DagMlError::CampaignValidation(format!(
                    "relation `{}` is missing required group id",
                    record.observation_id
                )));
            }
        }

        let sample_to_target = self.sample_targets();
        let sample_to_group = self.sample_groups();
        validate_fold_set_groups_match_relations(fold_set, &sample_to_group)?;

        for fold in &fold_set.folds {
            let partitions = fold
                .train_sample_ids
                .iter()
                .map(|sample_id| (sample_id, FoldPartition::Train))
                .chain(
                    fold.validation_sample_ids
                        .iter()
                        .map(|sample_id| (sample_id, FoldPartition::Validation)),
                )
                .collect::<BTreeMap<_, _>>();

            if policy.forbid_origin_cross_fold {
                for record in &self.records {
                    if let Some(origin_sample_id) = &record.origin_sample_id {
                        let sample_partition =
                            partitions.get(&record.sample_id).ok_or_else(|| {
                                DagMlError::CampaignValidation(format!(
                                    "fold `{}` does not contain sample `{}`",
                                    fold.fold_id, record.sample_id
                                ))
                            })?;
                        let origin_partition =
                            partitions.get(origin_sample_id).ok_or_else(|| {
                                DagMlError::CampaignValidation(format!(
                                    "fold `{}` does not contain origin sample `{}`",
                                    fold.fold_id, origin_sample_id
                                ))
                            })?;
                        if sample_partition != origin_partition {
                            return Err(DagMlError::CampaignValidation(format!(
                                "fold `{}` leaks origin sample `{}` into {:?} sample `{}`",
                                fold.fold_id, origin_sample_id, sample_partition, record.sample_id
                            )));
                        }
                    }
                }
            }

            match policy.split_unit {
                SplitUnit::PhysicalSample | SplitUnit::Observation | SplitUnit::Sample => {}
                SplitUnit::Target => validate_unit_partitions(
                    &fold.fold_id.to_string(),
                    "target",
                    &partitions,
                    &sample_to_target,
                )?,
                SplitUnit::Group => validate_unit_partitions(
                    &fold.fold_id.to_string(),
                    "group",
                    &partitions,
                    &sample_to_group,
                )?,
            }
        }
        Ok(())
    }

    pub fn sample_for_observation(&self, observation_id: &ObservationId) -> Option<&SampleId> {
        self.records
            .iter()
            .find(|record| &record.observation_id == observation_id)
            .map(|record| &record.sample_id)
    }

    pub fn target_for_sample(&self, sample_id: &SampleId) -> Option<&TargetId> {
        self.records
            .iter()
            .find(|record| &record.sample_id == sample_id)
            .and_then(|record| record.target_id.as_ref())
    }

    pub fn group_for_sample(&self, sample_id: &SampleId) -> Option<&GroupId> {
        self.records
            .iter()
            .find(|record| &record.sample_id == sample_id)
            .and_then(|record| record.group_id.as_ref())
    }

    pub fn observation_count_for_sample(&self, sample_id: &SampleId) -> usize {
        self.records
            .iter()
            .filter(|record| &record.sample_id == sample_id)
            .count()
    }

    /// Samples excluded from training. Exclusion is sample-local: a sample is
    /// excluded if ANY of its relation rows carries `excluded == true`, so a
    /// multi-source / repetition sample can never train through a sibling
    /// non-excluded row. These samples are still validated and predicted.
    pub fn excluded_sample_ids(&self) -> BTreeSet<SampleId> {
        self.records
            .iter()
            .filter(|record| record.excluded)
            .map(|record| record.sample_id.clone())
            .collect()
    }

    pub fn sample_targets(&self) -> BTreeMap<SampleId, TargetId> {
        self.records
            .iter()
            .filter_map(|record| {
                record
                    .target_id
                    .as_ref()
                    .map(|target_id| (record.sample_id.clone(), target_id.clone()))
            })
            .collect()
    }

    pub fn sample_groups(&self) -> BTreeMap<SampleId, GroupId> {
        self.records
            .iter()
            .filter_map(|record| {
                record
                    .group_id
                    .as_ref()
                    .map(|group_id| (record.sample_id.clone(), group_id.clone()))
            })
            .collect()
    }
}

fn non_empty_optional<'a>(
    field: &str,
    observation_id: &ObservationId,
    value: &'a Option<String>,
) -> Result<Option<&'a str>> {
    if let Some(value) = value.as_deref() {
        if value.trim().is_empty() {
            return Err(DagMlError::CampaignValidation(format!(
                "relation `{observation_id}` has empty {field}"
            )));
        }
        Ok(Some(value))
    } else {
        Ok(None)
    }
}

fn validate_optional_identifier(
    field: &str,
    observation_id: &ObservationId,
    value: &Option<String>,
) -> Result<()> {
    let Some(value) = non_empty_optional(field, observation_id, value)? else {
        return Ok(());
    };
    if value.len() > 128
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.' | b':'))
    {
        return Err(DagMlError::CampaignValidation(format!(
            "relation `{observation_id}` has invalid {field}"
        )));
    }
    Ok(())
}

fn validate_combo_record(
    record: &SampleRelation,
    observation_samples: &BTreeMap<ObservationId, SampleId>,
) -> Result<()> {
    if record.unit_level != EntityUnitLevel::Combo {
        return Ok(());
    }
    if record.component_observation_ids.is_empty() {
        return Err(DagMlError::CampaignValidation(format!(
            "combo relation `{}` has no component observations",
            record.observation_id
        )));
    }
    if record.derived_unit_id.is_none() {
        return Err(DagMlError::CampaignValidation(format!(
            "combo relation `{}` requires derived_unit_id",
            record.observation_id
        )));
    }
    if let Some(origin_sample_id) = &record.origin_sample_id {
        if origin_sample_id != &record.sample_id {
            return Err(DagMlError::CampaignValidation(format!(
                "combo relation `{}` origin sample `{}` differs from sample `{}`",
                record.observation_id, origin_sample_id, record.sample_id
            )));
        }
    }

    let mut components = BTreeSet::new();
    for component_observation_id in &record.component_observation_ids {
        if component_observation_id == &record.observation_id {
            return Err(DagMlError::CampaignValidation(format!(
                "combo relation `{}` cannot list itself as a component",
                record.observation_id
            )));
        }
        if !components.insert(component_observation_id) {
            return Err(DagMlError::CampaignValidation(format!(
                "combo relation `{}` repeats component observation `{}`",
                record.observation_id, component_observation_id
            )));
        }
        let component_sample = observation_samples
            .get(component_observation_id)
            .ok_or_else(|| {
                DagMlError::CampaignValidation(format!(
                    "combo relation `{}` references missing component observation `{}`",
                    record.observation_id, component_observation_id
                ))
            })?;
        if component_sample != &record.sample_id {
            return Err(DagMlError::CampaignValidation(format!(
                "combo relation `{}` component observation `{}` belongs to sample `{}` not `{}`",
                record.observation_id, component_observation_id, component_sample, record.sample_id
            )));
        }
    }
    Ok(())
}

fn validate_fold_set_groups_match_relations(
    fold_set: &FoldSet,
    sample_to_group: &BTreeMap<SampleId, GroupId>,
) -> Result<()> {
    for (sample_id, fold_group) in &fold_set.sample_groups {
        if let Some(relation_group) = sample_to_group.get(sample_id) {
            if relation_group != fold_group {
                return Err(DagMlError::CampaignValidation(format!(
                    "sample `{sample_id}` has group `{relation_group}` in relations but `{fold_group}` in fold set"
                )));
            }
        }
    }
    Ok(())
}

fn validate_unit_partitions<Unit: Ord + std::fmt::Display>(
    fold_id: &str,
    label: &str,
    partitions: &BTreeMap<&SampleId, FoldPartition>,
    sample_units: &BTreeMap<SampleId, Unit>,
) -> Result<()> {
    let mut unit_partitions = BTreeMap::<&Unit, FoldPartition>::new();
    for (sample_id, partition) in partitions {
        let Some(unit) = sample_units.get(*sample_id) else {
            return Err(DagMlError::CampaignValidation(format!(
                "fold `{fold_id}` sample `{sample_id}` is missing {label} id"
            )));
        };
        if let Some(previous) = unit_partitions.insert(unit, *partition) {
            if previous != *partition {
                return Err(DagMlError::CampaignValidation(format!(
                    "fold `{fold_id}` leaks {label} `{unit}` across train/validation"
                )));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::ExternalDataPlanEnvelope;
    use crate::fold::{FoldAssignment, FoldPartitionMode};

    fn sid(value: &str) -> SampleId {
        SampleId::new(value).unwrap()
    }

    fn oid(value: &str) -> ObservationId {
        ObservationId::new(value).unwrap()
    }

    fn tid(value: &str) -> TargetId {
        TargetId::new(value).unwrap()
    }

    fn gid(value: &str) -> GroupId {
        GroupId::new(value).unwrap()
    }

    fn fold_set() -> FoldSet {
        FoldSet {
            id: "outer".to_string(),
            sample_ids: vec![sid("s1"), sid("s2"), sid("s3"), sid("s4")],
            folds: vec![
                FoldAssignment {
                    fold_id: crate::ids::FoldId::new("fold:0").unwrap(),
                    train_sample_ids: vec![sid("s3"), sid("s4")],
                    validation_sample_ids: vec![sid("s1"), sid("s2")],
                    metadata: BTreeMap::new(),
                },
                FoldAssignment {
                    fold_id: crate::ids::FoldId::new("fold:1").unwrap(),
                    train_sample_ids: vec![sid("s1"), sid("s2")],
                    validation_sample_ids: vec![sid("s3"), sid("s4")],
                    metadata: BTreeMap::new(),
                },
            ],
            sample_groups: BTreeMap::new(),
            partition_mode: FoldPartitionMode::Partition,
        }
    }

    fn relation(observation: &str, sample: &str, target: &str, group: &str) -> SampleRelation {
        let mut relation = SampleRelation::new(oid(observation), sid(sample));
        relation.target_id = Some(tid(target));
        relation.group_id = Some(gid(group));
        relation
    }

    fn source_relation(observation: &str, sample: &str, source: &str, rep: &str) -> SampleRelation {
        let mut relation = relation(observation, sample, "target:sample", "group:sample");
        relation.source_id = Some(source.to_string());
        relation.rep_id = Some(rep.to_string());
        relation
    }

    #[test]
    fn repeated_observations_validate_at_sample_split_unit() {
        let relations = SampleRelationSet {
            records: vec![
                relation("obs:1a", "s1", "t1", "g1"),
                relation("obs:1b", "s1", "t1", "g1"),
                relation("obs:2a", "s2", "t2", "g2"),
                relation("obs:3a", "s3", "t3", "g3"),
                relation("obs:4a", "s4", "t4", "g4"),
            ],
        };

        relations
            .validate_against_fold_set(&fold_set(), &LeakageUnitPolicy::default())
            .unwrap();
    }

    #[test]
    fn repeated_observations_validate_at_physical_sample_split_unit() {
        let relations = SampleRelationSet {
            records: vec![
                relation("obs:1a", "s1", "t1", "g1"),
                relation("obs:1b", "s1", "t1", "g1"),
                relation("obs:2a", "s2", "t2", "g2"),
                relation("obs:3a", "s3", "t3", "g3"),
                relation("obs:4a", "s4", "t4", "g4"),
            ],
        };
        let policy = LeakageUnitPolicy {
            split_unit: SplitUnit::PhysicalSample,
            ..LeakageUnitPolicy::default()
        };

        relations
            .validate_against_fold_set(&fold_set(), &policy)
            .unwrap();
    }

    #[test]
    fn asymmetric_multisource_repetitions_and_combo_validate_as_relations() {
        let mut combo = relation(
            "obs:s1.combo.a0.b0.c0",
            "s1",
            "target:sample",
            "group:sample",
        );
        combo.unit_level = EntityUnitLevel::Combo;
        combo.source_id = Some("combo".to_string());
        combo.derived_unit_id = Some("combo:s1:a0:b0:c0".to_string());
        combo.origin_sample_id = Some(sid("s1"));
        combo.component_observation_ids =
            vec![oid("obs:s1.A.0"), oid("obs:s1.B.0"), oid("obs:s1.C.0")];
        combo.sample_influence_weight = Some(1.0);
        combo.quality_flag = Some("ok".to_string());

        let relations = SampleRelationSet {
            records: vec![
                source_relation("obs:s1.A.0", "s1", "A", "rep:0"),
                source_relation("obs:s1.A.1", "s1", "A", "rep:1"),
                source_relation("obs:s1.B.0", "s1", "B", "rep:0"),
                source_relation("obs:s1.B.1", "s1", "B", "rep:1"),
                source_relation("obs:s1.B.2", "s1", "B", "rep:2"),
                source_relation("obs:s1.C.0", "s1", "C", "rep:0"),
                source_relation("obs:s1.C.1", "s1", "C", "rep:1"),
                combo,
            ],
        };

        relations.validate().unwrap();
        assert_eq!(
            relations.sample_for_observation(&oid("obs:s1.combo.a0.b0.c0")),
            Some(&sid("s1"))
        );
    }

    #[test]
    fn combo_components_cannot_cross_sample_boundary() {
        let mut combo = relation("obs:s1.combo", "s1", "target:sample", "group:sample");
        combo.unit_level = EntityUnitLevel::Combo;
        combo.derived_unit_id = Some("combo:s1".to_string());
        combo.component_observation_ids = vec![oid("obs:s1.A.0"), oid("obs:s2.B.0")];

        let relations = SampleRelationSet {
            records: vec![
                source_relation("obs:s1.A.0", "s1", "A", "rep:0"),
                source_relation("obs:s2.B.0", "s2", "B", "rep:0"),
                combo,
            ],
        };

        assert!(relations.validate().is_err());
    }

    #[test]
    fn relation_fingerprint_is_order_stable_and_provenance_sensitive() {
        let left = SampleRelationSet {
            records: vec![
                source_relation("obs:s1.A.0", "s1", "A", "rep:0"),
                source_relation("obs:s1.B.0", "s1", "B", "rep:0"),
            ],
        };
        let right = SampleRelationSet {
            records: vec![
                source_relation("obs:s1.B.0", "s1", "B", "rep:0"),
                source_relation("obs:s1.A.0", "s1", "A", "rep:0"),
            ],
        };
        assert_eq!(left.fingerprint().unwrap(), right.fingerprint().unwrap());

        let mut changed = left.clone();
        changed.records[0].rep_id = Some("rep:1".to_string());
        assert_ne!(left.fingerprint().unwrap(), changed.fingerprint().unwrap());
    }

    #[test]
    fn excluded_bit_changes_fingerprint_but_only_when_true() {
        let base = SampleRelationSet {
            records: vec![
                source_relation("obs:s1.A.0", "s1", "A", "rep:0"),
                source_relation("obs:s2.A.0", "s2", "A", "rep:0"),
            ],
        };

        // excluded=false is byte-identical to the default (skip_serializing_if):
        // existing fixtures and contracts stay unaffected.
        let mut explicit_false = base.clone();
        explicit_false.records[0].excluded = false;
        assert_eq!(
            base.fingerprint().unwrap(),
            explicit_false.fingerprint().unwrap()
        );

        // excluded=true changes the training set, so it MUST change the
        // replay fingerprint (else a different exclusion mask could false-hit a
        // cached bundle).
        let mut excluded = base.clone();
        excluded.records[0].excluded = true;
        assert_ne!(base.fingerprint().unwrap(), excluded.fingerprint().unwrap());
    }

    #[test]
    fn metadata_and_tags_change_fingerprint_but_only_when_non_empty() {
        let base = SampleRelationSet {
            records: vec![
                source_relation("obs:s1.A.0", "s1", "A", "rep:0"),
                source_relation("obs:s2.A.0", "s2", "A", "rep:0"),
            ],
        };

        // Empty metadata/tags are skip-serialized, so an explicit empty value is
        // byte-identical to the default: existing fixtures/contracts unaffected.
        let mut explicit_empty = base.clone();
        explicit_empty.records[0].metadata = BTreeMap::new();
        explicit_empty.records[0].tags = Vec::new();
        assert_eq!(
            base.fingerprint().unwrap(),
            explicit_empty.fingerprint().unwrap()
        );

        // Metadata changes which samples a `by_metadata` view selects, so it
        // MUST change the replay fingerprint.
        let mut with_metadata = base.clone();
        with_metadata.records[0]
            .metadata
            .insert("group".to_string(), serde_json::json!("A"));
        assert_ne!(
            base.fingerprint().unwrap(),
            with_metadata.fingerprint().unwrap()
        );

        // Same for tags (used by `by_tag` views).
        let mut with_tags = base.clone();
        with_tags.records[0].tags = vec!["clean".to_string()];
        assert_ne!(
            base.fingerprint().unwrap(),
            with_tags.fingerprint().unwrap()
        );
    }

    #[test]
    fn old_relation_json_defaults_to_observation_unit() {
        let relation: SampleRelation = serde_json::from_value(serde_json::json!({
            "observation_id": "obs:legacy",
            "sample_id": "s1",
            "target_id": "t1",
            "group_id": "g1",
            "source_id": "legacy",
            "is_augmented": false
        }))
        .unwrap();

        assert_eq!(relation.unit_level, EntityUnitLevel::Observation);
        assert!(relation.rep_id.is_none());
        assert!(relation.component_observation_ids.is_empty());
        SampleRelationSet {
            records: vec![relation],
        }
        .validate()
        .unwrap();
    }

    #[test]
    fn relation_contracts_reject_unknown_fields_at_every_nesting_level() {
        let relation = serde_json::json!({
            "observation_id": "obs:strict",
            "sample_id": "sample:strict"
        });

        let mut unknown_set_field = serde_json::json!({"records": [relation.clone()]});
        unknown_set_field.as_object_mut().unwrap().insert(
            "unexpected_contract_field".to_string(),
            serde_json::json!(true),
        );
        assert!(serde_json::from_value::<SampleRelationSet>(unknown_set_field).is_err());

        let mut unknown_record_field = relation.clone();
        unknown_record_field.as_object_mut().unwrap().insert(
            "unexpected_contract_field".to_string(),
            serde_json::json!(true),
        );
        assert!(serde_json::from_value::<SampleRelation>(unknown_record_field.clone()).is_err());

        let envelope = serde_json::json!({
            "schema_version": 1,
            "schema_fingerprint": "0".repeat(64),
            "plan_fingerprint": "1".repeat(64),
            "coordinator_relations": {"records": [unknown_record_field]}
        });
        assert!(serde_json::from_value::<ExternalDataPlanEnvelope>(envelope).is_err());

        let envelope = serde_json::json!({
            "schema_version": 1,
            "schema_fingerprint": "0".repeat(64),
            "plan_fingerprint": "1".repeat(64),
            "coordinator_relations": {
                "records": [relation.clone()],
                "unexpected_contract_field": true
            }
        });
        assert!(serde_json::from_value::<ExternalDataPlanEnvelope>(envelope).is_err());

        let accepted: SampleRelationSet = serde_json::from_value(serde_json::json!({
            "records": [{
                "observation_id": "obs:strict",
                "sample_id": "sample:strict",
                "metadata": {"unexpected_contract_field": "opaque metadata remains open"},
                "tags": ["strict"]
            }]
        }))
        .unwrap();
        assert_eq!(
            accepted.records[0].metadata["unexpected_contract_field"],
            "opaque metadata remains open"
        );
    }

    #[test]
    fn relation_validation_rejects_invalid_new_fields() {
        let mut invalid_rep = source_relation("obs:s1.A.0", "s1", "A", "rep/0");
        assert!(invalid_rep.validate().is_err());

        invalid_rep.rep_id = Some("rep:0".to_string());
        invalid_rep.sample_influence_weight = Some(0.0);
        assert!(invalid_rep.validate().is_err());

        invalid_rep.sample_influence_weight = Some(1.0);
        invalid_rep.quality_flag = Some(" ".to_string());
        assert!(invalid_rep.validate().is_err());
    }

    #[test]
    fn target_split_refuses_shared_target_across_fold_boundary() {
        let relations = SampleRelationSet {
            records: vec![
                relation("obs:1", "s1", "same_target", "g1"),
                relation("obs:2", "s2", "t2", "g2"),
                relation("obs:3", "s3", "same_target", "g3"),
                relation("obs:4", "s4", "t4", "g4"),
            ],
        };
        let policy = LeakageUnitPolicy {
            split_unit: SplitUnit::Target,
            ..LeakageUnitPolicy::default()
        };

        assert!(relations
            .validate_against_fold_set(&fold_set(), &policy)
            .is_err());
    }

    #[test]
    fn augmentation_origin_cannot_cross_train_validation_boundary() {
        let mut generated = relation("obs:aug", "s3", "t3", "g3");
        generated.origin_sample_id = Some(sid("s1"));
        generated.is_augmented = true;
        let relations = SampleRelationSet {
            records: vec![
                relation("obs:1", "s1", "t1", "g1"),
                relation("obs:2", "s2", "t2", "g2"),
                generated,
                relation("obs:4", "s4", "t4", "g4"),
            ],
        };

        assert!(relations
            .validate_against_fold_set(&fold_set(), &LeakageUnitPolicy::default())
            .is_err());
    }
}
