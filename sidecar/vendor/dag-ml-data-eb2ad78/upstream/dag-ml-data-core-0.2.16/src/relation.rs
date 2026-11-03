use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::error::{DataError, Result};
use crate::ids::{GroupId, ObservationId, OriginId, RepetitionId, SampleId, SourceId, TargetId};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AugmentationMetadata {
    pub transform_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params_fingerprint: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, serde_json::Value>,
}

impl AugmentationMetadata {
    pub fn validate(&self) -> Result<()> {
        if self.transform_id.trim().is_empty() {
            return Err(DataError::Validation(
                "augmentation metadata transform_id is empty".to_string(),
            ));
        }
        if let Some(params_fingerprint) = &self.params_fingerprint {
            if params_fingerprint.len() != 64
                || !params_fingerprint
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit())
            {
                return Err(DataError::Validation(format!(
                    "augmentation `{}` params_fingerprint must be a 64-character hex digest",
                    self.transform_id
                )));
            }
        }
        for key in self.metadata.keys() {
            if key.trim().is_empty() {
                return Err(DataError::Validation(format!(
                    "augmentation `{}` metadata contains an empty key",
                    self.transform_id
                )));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct SampleRelation {
    pub observation_id: ObservationId,
    pub sample_id: SampleId,
    pub source_id: Option<SourceId>,
    pub target_id: Option<TargetId>,
    pub group_id: Option<GroupId>,
    pub origin_id: Option<OriginId>,
    pub repetition_id: Option<RepetitionId>,
    #[serde(default)]
    pub augmented: bool,
    #[serde(default)]
    pub excluded: bool,
    #[serde(default)]
    pub metadata: BTreeMap<String, serde_json::Value>,
    // Free-form labels a host can attach to a relation row. Skipped when empty
    // so existing relation sets keep byte-identical fingerprints; carried onto
    // `CoordinatorRelation` so `by_tag` branch views filter natively.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub augmentation: Option<AugmentationMetadata>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct SampleRelationTable {
    pub rows: Vec<SampleRelation>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct FoldAssignment {
    pub fold_id: String,
    pub train_sample_ids: Vec<SampleId>,
    pub validation_sample_ids: Vec<SampleId>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, serde_json::Value>,
}

/// How validation membership is distributed across a fold set (mirrors dag-ml).
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FoldPartitionMode {
    /// Each sample is validated exactly once: a clean out-of-fold partition. Default.
    #[default]
    Partition,
    /// Validation sets may overlap or omit samples (ShuffleSplit, repeated KFold, bootstrap).
    /// Only OOF completeness is relaxed; per-fold train/validation disjointness still holds.
    Resampled,
}

impl FoldPartitionMode {
    fn is_default(&self) -> bool {
        *self == Self::Partition
    }
}

/// Which authority narrows each fold's training cohort (mirrors dag-ml). dag-ml-data only
/// carries it so the shared fold-set JSON and fingerprint stay identical; dag-ml applies it.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FoldTrainExclusion {
    /// Relation-level exclusions are subtracted from every fold-train view. Default.
    #[default]
    Relations,
    /// The fold `train_sample_ids` are authoritative for the fold-train views.
    FoldLocal,
}

impl FoldTrainExclusion {
    fn is_default(&self) -> bool {
        *self == Self::Relations
    }
}

/// Fold assignments over a CV sample universe, mirroring dag-ml's `FoldSet` JSON.
///
/// In the default `partition` mode each sample in `sample_ids` appears in validation exactly
/// once across the fold set. Non-default fields are skipped when serialized, so fold sets that
/// do not use them keep their bytes and fingerprints.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct FoldSet {
    pub id: String,
    pub sample_ids: Vec<SampleId>,
    pub folds: Vec<FoldAssignment>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub sample_groups: BTreeMap<SampleId, GroupId>,
    #[serde(default, skip_serializing_if = "FoldPartitionMode::is_default")]
    pub partition_mode: FoldPartitionMode,
    #[serde(default, skip_serializing_if = "FoldTrainExclusion::is_default")]
    pub train_exclusion: FoldTrainExclusion,
    /// Samples whose target is missing, declared outside the CV universe: never in
    /// `sample_ids`, a fold or `sample_groups`, so they never train or get scored. Relations may
    /// still list them (they stay predictable).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub target_missing_sample_ids: Vec<SampleId>,
}

impl FoldSet {
    pub fn validate(&self) -> Result<()> {
        if self.id.trim().is_empty() {
            return Err(DataError::Validation("fold set id is empty".to_string()));
        }
        if self.sample_ids.is_empty() {
            return Err(DataError::Validation(
                "fold set contains no samples".to_string(),
            ));
        }
        if self.folds.is_empty() {
            return Err(DataError::Validation(
                "fold set contains no folds".to_string(),
            ));
        }
        let universe = unique_samples("fold set sample_ids", &self.sample_ids)?;
        let target_missing = unique_samples(
            "fold set target_missing_sample_ids",
            &self.target_missing_sample_ids,
        )?;
        if let Some(sample_id) = target_missing.intersection(&universe).next() {
            return Err(DataError::Validation(format!(
                "target-missing sample `{sample_id}` must not be part of the fold set sample_ids"
            )));
        }
        if !self.sample_groups.is_empty() {
            for sample_id in self.sample_groups.keys() {
                if !universe.contains(sample_id) {
                    return Err(DataError::Validation(format!(
                        "sample group map references unknown sample `{sample_id}`"
                    )));
                }
            }
            if let Some(sample_id) = self
                .sample_ids
                .iter()
                .find(|sample_id| !self.sample_groups.contains_key(*sample_id))
            {
                return Err(DataError::Validation(format!(
                    "sample `{sample_id}` is missing from non-empty group map"
                )));
            }
        }

        let mut fold_ids = BTreeSet::new();
        let mut validation_counts = self
            .sample_ids
            .iter()
            .cloned()
            .map(|sample_id| (sample_id, 0usize))
            .collect::<BTreeMap<_, _>>();

        for fold in &self.folds {
            if fold.fold_id.trim().is_empty() {
                return Err(DataError::Validation(
                    "fold assignment id is empty".to_string(),
                ));
            }
            if !fold_ids.insert(&fold.fold_id) {
                return Err(DataError::Validation(format!(
                    "duplicate fold id `{}`",
                    fold.fold_id
                )));
            }
            let train = unique_samples(
                &format!("fold `{}` train_sample_ids", fold.fold_id),
                &fold.train_sample_ids,
            )?;
            let validation = unique_samples(
                &format!("fold `{}` validation_sample_ids", fold.fold_id),
                &fold.validation_sample_ids,
            )?;
            if validation.is_empty() {
                return Err(DataError::Validation(format!(
                    "fold `{}` has no validation samples",
                    fold.fold_id
                )));
            }
            for sample_id in train.union(&validation) {
                if !universe.contains(sample_id) {
                    return Err(DataError::Validation(format!(
                        "fold `{}` references unknown sample `{}`",
                        fold.fold_id, sample_id
                    )));
                }
            }
            if let Some(sample_id) = train.intersection(&validation).next() {
                return Err(DataError::Validation(format!(
                    "fold `{}` has train/validation overlap at sample `{}`",
                    fold.fold_id, sample_id
                )));
            }
            for sample_id in &validation {
                *validation_counts
                    .get_mut(*sample_id)
                    .expect("validation sample is in universe") += 1;
            }
            validate_group_boundary(&fold.fold_id, &train, &validation, &self.sample_groups)?;
        }

        if self.partition_mode == FoldPartitionMode::Partition {
            for (sample_id, count) in validation_counts {
                if count != 1 {
                    return Err(DataError::Validation(format!(
                        "sample `{sample_id}` appears in validation {count} time(s), expected exactly once"
                    )));
                }
            }
        }
        Ok(())
    }
}

impl SampleRelationTable {
    pub fn validate(&self) -> Result<()> {
        if self.rows.is_empty() {
            return Err(DataError::Validation(
                "sample relation table contains no rows".to_string(),
            ));
        }

        let mut observation_ids = BTreeSet::new();
        let mut origin_ids = BTreeSet::new();
        let mut sample_groups = BTreeMap::<&SampleId, &GroupId>::new();
        for row in &self.rows {
            if !observation_ids.insert(&row.observation_id) {
                return Err(DataError::Validation(format!(
                    "duplicate observation id `{}`",
                    row.observation_id
                )));
            }
            if let Some(group_id) = &row.group_id {
                if let Some(previous_group_id) = sample_groups.insert(&row.sample_id, group_id) {
                    if previous_group_id != group_id {
                        return Err(DataError::Validation(format!(
                            "sample `{}` appears with conflicting groups `{}` and `{}`",
                            row.sample_id, previous_group_id, group_id
                        )));
                    }
                }
            }
            if row.augmented && row.origin_id.is_none() {
                return Err(DataError::Validation(format!(
                    "augmented observation `{}` has no origin_id",
                    row.observation_id
                )));
            }
            if !row.augmented && row.origin_id.is_some() {
                return Err(DataError::Validation(format!(
                    "non-augmented observation `{}` declares origin_id",
                    row.observation_id
                )));
            }
            if let Some(augmentation) = &row.augmentation {
                augmentation.validate()?;
                if !row.augmented {
                    return Err(DataError::Validation(format!(
                        "non-augmented observation `{}` declares augmentation metadata",
                        row.observation_id
                    )));
                }
            }
            if let Some(origin_id) = &row.origin_id {
                if origin_id.as_str() == row.observation_id.as_str() {
                    return Err(DataError::Validation(format!(
                        "observation `{}` cannot be its own origin",
                        row.observation_id
                    )));
                }
                origin_ids.insert(origin_id);
            }
        }

        for origin_id in origin_ids {
            if !observation_ids
                .iter()
                .any(|observation_id| observation_id.as_str() == origin_id.as_str())
            {
                return Err(DataError::Validation(format!(
                    "origin `{origin_id}` is not present as an observation"
                )));
            }
        }

        Ok(())
    }

    pub fn sample_groups(&self) -> BTreeMap<SampleId, GroupId> {
        self.rows
            .iter()
            .filter_map(|row| {
                row.group_id
                    .as_ref()
                    .map(|group_id| (row.sample_id.clone(), group_id.clone()))
            })
            .collect()
    }

    pub fn validate_fold_set(&self, fold_set: &FoldSet) -> Result<()> {
        self.validate()?;
        fold_set.validate()?;

        let relation_sample_ids = self
            .rows
            .iter()
            .map(|row| row.sample_id.clone())
            .collect::<BTreeSet<_>>();
        let fold_sample_ids = fold_set.sample_ids.iter().cloned().collect::<BTreeSet<_>>();
        // Declared target-missing samples sit outside the CV universe but stay in the relations.
        let known_sample_ids = fold_sample_ids
            .iter()
            .chain(&fold_set.target_missing_sample_ids)
            .cloned()
            .collect::<BTreeSet<_>>();
        if let Some(sample_id) = relation_sample_ids.difference(&known_sample_ids).next() {
            return Err(DataError::Validation(format!(
                "fold set `{}` is missing relation sample `{sample_id}`",
                fold_set.id
            )));
        }
        if let Some(sample_id) = fold_sample_ids.difference(&relation_sample_ids).next() {
            return Err(DataError::Validation(format!(
                "fold set `{}` references sample `{sample_id}` absent from sample relations",
                fold_set.id
            )));
        }

        let relation_groups = self.sample_groups();
        for (sample_id, fold_group_id) in &fold_set.sample_groups {
            if let Some(relation_group_id) = relation_groups.get(sample_id) {
                if relation_group_id != fold_group_id {
                    return Err(DataError::Validation(format!(
                        "fold set `{}` group `{}` for sample `{sample_id}` conflicts with relation group `{}`",
                        fold_set.id, fold_group_id, relation_group_id
                    )));
                }
            }
        }

        for fold in &fold_set.folds {
            let train = fold.train_sample_ids.iter().collect::<BTreeSet<_>>();
            let validation = fold.validation_sample_ids.iter().collect::<BTreeSet<_>>();
            validate_group_boundary(&fold.fold_id, &train, &validation, &relation_groups)?;
            validate_origin_boundary(&fold.fold_id, &train, &validation, self)?;
        }
        Ok(())
    }
}

fn unique_samples<'a>(label: &str, samples: &'a [SampleId]) -> Result<BTreeSet<&'a SampleId>> {
    let mut seen = BTreeSet::new();
    for sample_id in samples {
        if !seen.insert(sample_id) {
            return Err(DataError::Validation(format!(
                "{label} contains duplicate sample `{sample_id}`"
            )));
        }
    }
    Ok(seen)
}

fn validate_group_boundary(
    fold_id: &str,
    train: &BTreeSet<&SampleId>,
    validation: &BTreeSet<&SampleId>,
    sample_groups: &BTreeMap<SampleId, GroupId>,
) -> Result<()> {
    if sample_groups.is_empty() {
        return Ok(());
    }
    let train_groups = train
        .iter()
        .filter_map(|sample_id| sample_groups.get(*sample_id))
        .collect::<BTreeSet<_>>();
    for sample_id in validation {
        if let Some(group_id) = sample_groups.get(*sample_id) {
            if train_groups.contains(group_id) {
                return Err(DataError::RelationBoundaryViolation {
                    kind: "group",
                    detail: format!(
                        "fold `{fold_id}` leaks group `{group_id}` across train/validation"
                    ),
                });
            }
        }
    }
    Ok(())
}

fn validate_origin_boundary(
    fold_id: &str,
    train: &BTreeSet<&SampleId>,
    validation: &BTreeSet<&SampleId>,
    relations: &SampleRelationTable,
) -> Result<()> {
    let origin_sample_ids = relations
        .rows
        .iter()
        .map(|row| (row.observation_id.as_str(), &row.sample_id))
        .collect::<BTreeMap<_, _>>();
    for row in &relations.rows {
        let Some(origin_id) = &row.origin_id else {
            continue;
        };
        let Some(origin_sample_id) = origin_sample_ids.get(origin_id.as_str()) else {
            continue;
        };
        if train.contains(&row.sample_id) && validation.contains(origin_sample_id) {
            return Err(DataError::RelationBoundaryViolation {
                kind: "origin",
                detail: format!(
                    "fold `{fold_id}` leaks augmentation origin `{origin_id}` across train/validation"
                ),
            });
        }
        if validation.contains(&row.sample_id) && train.contains(origin_sample_id) {
            return Err(DataError::RelationBoundaryViolation {
                kind: "origin",
                detail: format!(
                    "fold `{fold_id}` leaks augmentation origin `{origin_id}` across train/validation"
                ),
            });
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn obs(value: &str) -> ObservationId {
        ObservationId::new(value).unwrap()
    }

    fn sample(value: &str) -> SampleId {
        SampleId::new(value).unwrap()
    }

    fn origin(value: &str) -> OriginId {
        OriginId::new(value).unwrap()
    }

    fn row(observation_id: &str, sample_id: &str) -> SampleRelation {
        SampleRelation {
            observation_id: obs(observation_id),
            sample_id: sample(sample_id),
            source_id: None,
            target_id: None,
            group_id: None,
            origin_id: None,
            repetition_id: None,
            augmented: false,
            excluded: false,
            metadata: BTreeMap::new(),
            tags: Vec::new(),
            augmentation: None,
        }
    }

    fn fold_set() -> FoldSet {
        FoldSet {
            id: "cv.group.safe".to_string(),
            sample_ids: vec![sample("s1"), sample("s2")],
            folds: vec![
                FoldAssignment {
                    fold_id: "fold:0".to_string(),
                    train_sample_ids: vec![sample("s2")],
                    validation_sample_ids: vec![sample("s1")],
                    metadata: BTreeMap::new(),
                },
                FoldAssignment {
                    fold_id: "fold:1".to_string(),
                    train_sample_ids: vec![sample("s1")],
                    validation_sample_ids: vec![sample("s2")],
                    metadata: BTreeMap::new(),
                },
            ],
            sample_groups: BTreeMap::new(),
            partition_mode: FoldPartitionMode::Partition,
            train_exclusion: FoldTrainExclusion::Relations,
            target_missing_sample_ids: Vec::new(),
        }
    }

    #[test]
    fn validates_group_and_origin_relations() {
        let mut base = row("obs1", "s1");
        base.group_id = Some(GroupId::new("g1").unwrap());
        let mut augmented = row("obs1_aug", "s1");
        augmented.group_id = Some(GroupId::new("g1").unwrap());
        augmented.origin_id = Some(origin("obs1"));
        augmented.augmented = true;
        augmented.augmentation = Some(AugmentationMetadata {
            transform_id: "snv.augment".to_string(),
            params_fingerprint: Some("a".repeat(64)),
            metadata: BTreeMap::new(),
        });

        let table = SampleRelationTable {
            rows: vec![base, augmented],
        };

        table.validate().unwrap();
        assert_eq!(
            table.sample_groups().get(&sample("s1")),
            Some(&GroupId::new("g1").unwrap())
        );
    }

    #[test]
    fn rejects_duplicate_observations() {
        let table = SampleRelationTable {
            rows: vec![row("obs1", "s1"), row("obs1", "s2")],
        };

        assert!(table.validate().is_err());
    }

    #[test]
    fn rejects_augmented_rows_without_known_origin() {
        let mut augmented = row("obs1_aug", "s1");
        augmented.origin_id = Some(origin("missing"));
        augmented.augmented = true;
        let table = SampleRelationTable {
            rows: vec![augmented],
        };

        assert!(table.validate().is_err());
    }

    #[test]
    fn rejects_invalid_augmentation_metadata() {
        let mut augmented = row("obs1_aug", "s1");
        augmented.origin_id = Some(origin("obs1"));
        augmented.augmented = true;
        augmented.augmentation = Some(AugmentationMetadata {
            transform_id: "snv.augment".to_string(),
            params_fingerprint: Some("not-a-fingerprint".to_string()),
            metadata: BTreeMap::new(),
        });
        let table = SampleRelationTable {
            rows: vec![row("obs1", "s1"), augmented],
        };

        assert!(table.validate().is_err());
    }

    #[test]
    fn validates_fold_set_against_relation_groups() {
        let mut s1 = row("obs1", "s1");
        s1.group_id = Some(GroupId::new("g1").unwrap());
        let mut s2 = row("obs2", "s2");
        s2.group_id = Some(GroupId::new("g2").unwrap());
        let relations = SampleRelationTable { rows: vec![s1, s2] };

        relations.validate_fold_set(&fold_set()).unwrap();
    }

    #[test]
    fn rejects_fold_set_with_missing_validation_assignment() {
        let mut fold_set = fold_set();
        fold_set.folds = vec![FoldAssignment {
            fold_id: "fold:0".to_string(),
            train_sample_ids: vec![sample("s1")],
            validation_sample_ids: vec![sample("s2")],
            metadata: BTreeMap::new(),
        }];

        let error = fold_set.validate().unwrap_err();
        assert!(error.to_string().contains("expected exactly once"));
    }

    #[test]
    fn rejects_fold_set_with_repeated_validation_assignment() {
        let mut fold_set = fold_set();
        fold_set.folds = vec![
            FoldAssignment {
                fold_id: "fold:0".to_string(),
                train_sample_ids: vec![sample("s2")],
                validation_sample_ids: vec![sample("s1")],
                metadata: BTreeMap::new(),
            },
            FoldAssignment {
                fold_id: "fold:1".to_string(),
                train_sample_ids: vec![sample("s2")],
                validation_sample_ids: vec![sample("s1")],
                metadata: BTreeMap::new(),
            },
        ];

        let error = fold_set.validate().unwrap_err();
        assert!(error.to_string().contains("expected exactly once"));
    }

    #[test]
    fn rejects_fold_set_that_splits_relation_group() {
        let mut s1 = row("obs1", "s1");
        s1.group_id = Some(GroupId::new("g1").unwrap());
        let mut s2 = row("obs2", "s2");
        s2.group_id = Some(GroupId::new("g1").unwrap());
        let relations = SampleRelationTable { rows: vec![s1, s2] };

        let error = relations.validate_fold_set(&fold_set()).unwrap_err();
        assert_eq!(error.category(), "data");
        assert_eq!(error.code(), "relation_boundary_violation");
        assert_eq!(error.error_code(), 0x0002_0002);
        assert!(error.to_string().contains("leaks group"));
    }

    #[test]
    fn rejects_fold_set_that_splits_augmentation_origin() {
        let origin_row = row("obs1", "s1");
        let mut augmented = row("obs1_aug", "s2");
        augmented.augmented = true;
        augmented.origin_id = Some(origin("obs1"));
        let relations = SampleRelationTable {
            rows: vec![origin_row, augmented],
        };

        let error = relations.validate_fold_set(&fold_set()).unwrap_err();
        assert!(error.to_string().contains("augmentation origin"));
    }

    #[test]
    fn rejects_fold_set_with_relation_sample_mismatch() {
        let relations = SampleRelationTable {
            rows: vec![row("obs1", "s1")],
        };

        let error = relations.validate_fold_set(&fold_set()).unwrap_err();
        assert!(error.to_string().contains("absent from sample relations"));
    }

    #[test]
    fn target_missing_samples_stay_outside_the_cv_universe() {
        let mut declared = fold_set();
        declared.target_missing_sample_ids = vec![sample("s3")];
        declared.validate().unwrap();
        // Relations keep the target-missing sample; it is neither trained nor validated.
        let relations = SampleRelationTable {
            rows: vec![row("obs1", "s1"), row("obs2", "s2"), row("obs3", "s3")],
        };
        relations.validate_fold_set(&declared).unwrap();
        let error = relations.validate_fold_set(&fold_set()).unwrap_err();
        assert!(error.to_string().contains("missing relation sample `s3`"));

        let mut inside = fold_set();
        inside.target_missing_sample_ids = vec![sample("s1")];
        let error = inside.validate().unwrap_err();
        assert!(error.to_string().contains("target-missing sample `s1`"));

        let mut duplicated = fold_set();
        duplicated.target_missing_sample_ids = vec![sample("s3"), sample("s3")];
        assert!(duplicated.validate().is_err());
    }

    #[test]
    fn non_empty_group_map_must_cover_every_sample() {
        let mut partial = fold_set();
        partial.sample_groups = BTreeMap::from([(sample("s1"), GroupId::new("g1").unwrap())]);
        let error = partial.validate().unwrap_err();
        assert!(error
            .to_string()
            .contains("missing from non-empty group map"));
        partial
            .sample_groups
            .insert(sample("s2"), GroupId::new("g2").unwrap());
        partial.validate().unwrap();
    }

    #[test]
    fn resampled_mode_relaxes_only_oof_completeness() {
        let mut resampled = fold_set();
        resampled.folds[1].validation_sample_ids = vec![sample("s1")];
        resampled.folds[1].train_sample_ids = vec![sample("s2")];
        let error = resampled.validate().unwrap_err();
        assert!(error.to_string().contains("expected exactly once"));

        resampled.partition_mode = FoldPartitionMode::Resampled;
        resampled.validate().unwrap();
        resampled.folds[1].train_sample_ids = vec![sample("s1")];
        let error = resampled.validate().unwrap_err();
        assert!(error.to_string().contains("train/validation overlap"));
    }

    #[test]
    fn default_fold_set_fields_keep_their_bytes() {
        let json = serde_json::to_value(fold_set()).unwrap();
        let object = json.as_object().unwrap();
        for field in [
            "partition_mode",
            "train_exclusion",
            "target_missing_sample_ids",
        ] {
            assert!(!object.contains_key(field), "{field} must be skipped");
        }
        let fixture: FoldSet = serde_json::from_str(include_str!(
            "../../../examples/fixtures/shared/fold_set_target_missing_resampled.json"
        ))
        .unwrap();
        fixture.validate().unwrap();
        assert_eq!(fixture.partition_mode, FoldPartitionMode::Resampled);
        assert_eq!(fixture.train_exclusion, FoldTrainExclusion::FoldLocal);
        assert_eq!(
            fixture.target_missing_sample_ids,
            vec![sample("s6"), sample("s5")]
        );
    }

    #[test]
    fn grouped_augmented_fixture_validates() {
        let table: SampleRelationTable = serde_json::from_str(include_str!(
            "../../../examples/fixtures/oof_campaign/sample_relations_grouped_augmented.json"
        ))
        .unwrap();

        table.validate().unwrap();
        assert_eq!(table.sample_groups().len(), 2);
    }
}
