use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::campaign::stable_json_fingerprint;
use crate::error::{DagMlError, Result, TargetMissingRefusal, TargetMissingReport};
use crate::ids::{FoldId, GroupId, SampleId};
use crate::rng::SeedContext;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct FoldAssignment {
    pub fold_id: FoldId,
    pub train_sample_ids: Vec<SampleId>,
    pub validation_sample_ids: Vec<SampleId>,
    #[serde(default)]
    pub metadata: BTreeMap<String, serde_json::Value>,
}

/// How validation membership is distributed across a fold set.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FoldPartitionMode {
    /// Each sample is validated EXACTLY once — a clean out-of-fold partition (KFold-style). Default.
    #[default]
    Partition,
    /// Validation sets may overlap or omit samples (resampling CV: ShuffleSplit, repeated KFold,
    /// bootstrap). The per-fold `train ∩ validation = ∅` leakage guard still holds; only OOF
    /// *completeness* is relaxed. Predictions for a multiply-validated sample are aggregated.
    Resampled,
}

fn is_partition_mode_default(mode: &FoldPartitionMode) -> bool {
    *mode == FoldPartitionMode::Partition
}

/// Which authority narrows each fold's FIT_CV training cohort.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FoldTrainExclusion {
    /// Relation-level exclusions (`SampleRelation.excluded`) are subtracted from every fold-train
    /// view and from the REFIT cohort. Default.
    #[default]
    Relations,
    /// The fold `train_sample_ids` are authoritative for FIT_CV: the host already applied its
    /// exclusions inside each fold's own training rows (e.g. a supervised outlier filter fitted
    /// per fold), so relation-excluded samples listed in a fold train are trained on in that fold.
    /// Validation views are unchanged, and relation exclusions still narrow the REFIT cohort and
    /// every other non-fold-train fit.
    FoldLocal,
}

fn is_train_exclusion_default(mode: &FoldTrainExclusion) -> bool {
    *mode == FoldTrainExclusion::Relations
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct FoldSet {
    pub id: String,
    pub sample_ids: Vec<SampleId>,
    pub folds: Vec<FoldAssignment>,
    #[serde(default)]
    pub sample_groups: BTreeMap<SampleId, GroupId>,
    /// Validation-distribution mode. Skipped when `Partition` (the default), so existing OOF fold
    /// sets serialize byte-identically — no fingerprint or fixture churn.
    #[serde(default, skip_serializing_if = "is_partition_mode_default")]
    pub partition_mode: FoldPartitionMode,
    /// Fold-train exclusion authority. Skipped when `Relations` (the default), so existing fold
    /// sets serialize byte-identically — no fingerprint or fixture churn.
    #[serde(default, skip_serializing_if = "is_train_exclusion_default")]
    pub train_exclusion: FoldTrainExclusion,
    /// Samples whose target is missing. They are declared OUTSIDE the CV universe: never in
    /// `sample_ids`, any fold train/validation list or `sample_groups`, so they never train in
    /// FIT_CV or REFIT (`FullTrain` is `sample_ids`) and never reach OOF scoring or SELECT. They
    /// stay eligible for PREDICT. Skipped when empty, so existing fold sets serialize
    /// byte-identically — no fingerprint or fixture churn. A non-empty list changes the
    /// fingerprint, which records the exclusion (and its count) in plan lineage.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub target_missing_sample_ids: Vec<SampleId>,
}

impl FoldSet {
    pub fn validate(&self) -> Result<()> {
        if self.id.trim().is_empty() {
            return Err(DagMlError::OofValidation(
                "fold set id is empty".to_string(),
            ));
        }
        if self.sample_ids.is_empty() {
            return Err(DagMlError::OofValidation(
                "fold set contains no samples".to_string(),
            ));
        }
        if self.folds.is_empty() {
            return Err(DagMlError::OofValidation(
                "fold set contains no folds".to_string(),
            ));
        }
        let universe = unique_samples("fold set sample_ids", &self.sample_ids)?;
        if !self.sample_groups.is_empty() {
            for sample_id in self.sample_groups.keys() {
                if !universe.contains(sample_id) {
                    return Err(DagMlError::OofValidation(format!(
                        "sample group map references unknown sample `{sample_id}`"
                    )));
                }
            }
            for sample_id in &self.sample_ids {
                if !self.sample_groups.contains_key(sample_id) {
                    return Err(DagMlError::OofValidation(format!(
                        "sample `{sample_id}` is missing from non-empty group map"
                    )));
                }
            }
        }
        let target_missing = unique_samples(
            "fold set target_missing_sample_ids",
            &self.target_missing_sample_ids,
        )?;
        let in_universe = target_missing
            .iter()
            .filter(|sample_id| universe.contains(*sample_id))
            .map(|sample_id| (*sample_id).clone())
            .collect::<BTreeSet<_>>();
        if !in_universe.is_empty() {
            return Err(self.target_missing_error(
                TargetMissingRefusal::InCvUniverse,
                None,
                &in_universe,
                "target-missing samples must not be part of the fold set sample_ids",
            ));
        }
        let mut fold_ids = BTreeSet::new();
        let mut validation_counts = self
            .sample_ids
            .iter()
            .cloned()
            .map(|sample_id| (sample_id, 0usize))
            .collect::<BTreeMap<_, _>>();

        for fold in &self.folds {
            if !fold_ids.insert(&fold.fold_id) {
                return Err(DagMlError::OofValidation(format!(
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
                return Err(DagMlError::OofValidation(format!(
                    "fold `{}` has no validation samples",
                    fold.fold_id
                )));
            }
            for sample_id in train.union(&validation) {
                if !universe.contains(sample_id) {
                    return Err(DagMlError::OofValidation(format!(
                        "fold `{}` references unknown sample `{}`",
                        fold.fold_id, sample_id
                    )));
                }
            }
            let overlap = train.intersection(&validation).collect::<Vec<_>>();
            if !overlap.is_empty() {
                return Err(DagMlError::OofValidation(format!(
                    "fold `{}` has train/validation overlap at sample `{}`",
                    fold.fold_id, overlap[0]
                )));
            }
            for sample_id in validation {
                *validation_counts
                    .get_mut(sample_id)
                    .expect("validation sample is in universe") += 1;
            }
            self.validate_group_boundary(fold, &train)?;
        }

        // OOF completeness: a clean Partition requires every sample validated exactly once. The
        // Resampled mode (ShuffleSplit/repeated CV) drops this — a sample may be validated any
        // number of times — while the per-fold train/validation disjointness (the leakage guard,
        // enforced above) still holds for every fold.
        if self.partition_mode == FoldPartitionMode::Partition {
            for (sample_id, count) in validation_counts {
                if count != 1 {
                    return Err(DagMlError::OofValidation(format!(
                        "sample `{}` appears in validation {} time(s), expected exactly once",
                        sample_id, count
                    )));
                }
            }
        }

        Ok(())
    }

    /// Build `spec`'s nested inner fold set for `outer`, one of this set's folds. The inner set
    /// inherits this set's groups, `train_exclusion` and `target_missing_sample_ids`: its train
    /// lists are subsets of `outer`'s training rows, so a fold-local exclusion authority and the
    /// target-missing declaration carry down to every nested level.
    pub fn nested_fold_set(
        &self,
        spec: &NestedCvSpec,
        outer: &FoldAssignment,
    ) -> Result<NestedFoldSet> {
        let mut nested = spec.build_nested_fold_set(outer, &self.sample_groups)?;
        nested.inner_fold_set.train_exclusion = self.train_exclusion;
        nested
            .inner_fold_set
            .target_missing_sample_ids
            .clone_from(&self.target_missing_sample_ids);
        nested.inner_fold_set.validate()?;
        Ok(nested)
    }

    /// Remove target-missing samples from this fold set's CV universe.
    ///
    /// Each sample in `target_missing` is dropped from `sample_ids`, from every fold's train and
    /// validation lists and from `sample_groups`, and recorded in `target_missing_sample_ids`.
    /// Samples already recorded there are accepted (the operation is idempotent). The narrowed
    /// fold set is refused with a structured [`DagMlError::TargetMissing`] when an id is unknown,
    /// when no target-observed sample is left, or when a fold loses all of its validation or all
    /// of its training samples. Splitting the observed universe directly
    /// (`split_with_target_missing`) keeps folds balanced; this narrowing is for host-supplied
    /// fold sets.
    pub fn exclude_target_missing(&self, target_missing: &BTreeSet<SampleId>) -> Result<FoldSet> {
        self.validate()?;
        let universe = self.sample_ids.iter().collect::<BTreeSet<_>>();
        let declared = self
            .target_missing_sample_ids
            .iter()
            .collect::<BTreeSet<_>>();
        let unknown = target_missing
            .iter()
            .filter(|sample_id| !universe.contains(sample_id) && !declared.contains(sample_id))
            .cloned()
            .collect::<BTreeSet<_>>();
        if !unknown.is_empty() {
            return Err(self.target_missing_error(
                TargetMissingRefusal::UnknownSample,
                None,
                &unknown,
                "declared target-missing samples are not part of the fold set",
            ));
        }
        let removed = target_missing
            .iter()
            .filter(|sample_id| universe.contains(sample_id))
            .cloned()
            .collect::<BTreeSet<_>>();
        if removed.is_empty() {
            return Ok(self.clone());
        }
        let mut narrowed = self.clone();
        narrowed
            .sample_ids
            .retain(|sample_id| !removed.contains(sample_id));
        narrowed
            .sample_groups
            .retain(|sample_id, _| !removed.contains(sample_id));
        narrowed.target_missing_sample_ids = declared
            .into_iter()
            .chain(removed.iter())
            .cloned()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        if narrowed.sample_ids.is_empty() {
            return Err(narrowed.target_missing_error(
                TargetMissingRefusal::NoObservedTargets,
                None,
                &removed,
                "every fold set sample is target-missing",
            ));
        }
        let mut refusal = None;
        for fold in &mut narrowed.folds {
            let had_train = !fold.train_sample_ids.is_empty();
            fold.train_sample_ids
                .retain(|sample_id| !removed.contains(sample_id));
            fold.validation_sample_ids
                .retain(|sample_id| !removed.contains(sample_id));
            if fold.validation_sample_ids.is_empty() {
                refusal = Some((
                    TargetMissingRefusal::EmptyValidationFold,
                    fold.fold_id.to_string(),
                    "fold has no validation sample once target-missing samples are excluded",
                ));
            } else if had_train && fold.train_sample_ids.is_empty() {
                refusal = Some((
                    TargetMissingRefusal::EmptyTrainFold,
                    fold.fold_id.to_string(),
                    "fold has no training sample once target-missing samples are excluded",
                ));
            }
            if refusal.is_some() {
                break;
            }
        }
        if let Some((reason, fold_id, detail)) = refusal {
            return Err(narrowed.target_missing_error(reason, Some(fold_id), &removed, detail));
        }
        narrowed.validate()?;
        Ok(narrowed)
    }

    /// Refuse declared target-missing samples among `scored` ids: rows a controller emitted for a
    /// training, training-pool or validation partition, or as scoring targets. Only test and final
    /// predictions may carry target-missing samples.
    pub fn refuse_scored_target_missing<'a>(
        &self,
        scored: impl IntoIterator<Item = &'a SampleId>,
    ) -> Result<()> {
        if self.target_missing_sample_ids.is_empty() {
            return Ok(());
        }
        let declared = self
            .target_missing_sample_ids
            .iter()
            .collect::<BTreeSet<_>>();
        let offending = scored
            .into_iter()
            .filter(|sample_id| declared.contains(sample_id))
            .cloned()
            .collect::<BTreeSet<_>>();
        if offending.is_empty() {
            return Ok(());
        }
        Err(self.target_missing_error(
            TargetMissingRefusal::ScoredResult,
            None,
            &offending,
            "a controller emitted training, validation or scoring-target rows for target-missing samples",
        ))
    }

    fn target_missing_error(
        &self,
        reason: TargetMissingRefusal,
        fold_id: Option<String>,
        sample_ids: &BTreeSet<SampleId>,
        detail: &str,
    ) -> DagMlError {
        let declared = self
            .target_missing_sample_ids
            .iter()
            .chain(sample_ids)
            .collect::<BTreeSet<_>>();
        let observed_count = self
            .sample_ids
            .iter()
            .filter(|sample_id| !declared.contains(sample_id))
            .count();
        target_missing_refusal(
            &self.id,
            reason,
            fold_id,
            sample_ids,
            (declared.len(), observed_count),
            detail,
        )
    }

    fn validate_group_boundary(
        &self,
        fold: &FoldAssignment,
        train: &BTreeSet<&SampleId>,
    ) -> Result<()> {
        if self.sample_groups.is_empty() {
            return Ok(());
        }
        let train_groups = train
            .iter()
            .filter_map(|sample_id| self.sample_groups.get(*sample_id))
            .collect::<BTreeSet<_>>();
        for sample_id in &fold.validation_sample_ids {
            let Some(group_id) = self.sample_groups.get(sample_id) else {
                continue;
            };
            if train_groups.contains(group_id) {
                return Err(DagMlError::OofValidation(format!(
                    "fold `{}` leaks group `{}` across train/validation",
                    fold.fold_id, group_id
                )));
            }
        }
        Ok(())
    }
}

pub fn fold_set_fingerprint(fold_set: &FoldSet) -> Result<String> {
    let mut canonical = fold_set.clone();
    canonical.validate()?;
    canonical.sample_ids.sort();
    canonical.target_missing_sample_ids.sort();
    canonical
        .folds
        .sort_by(|left, right| left.fold_id.cmp(&right.fold_id));
    for fold in &mut canonical.folds {
        fold.train_sample_ids.sort();
        fold.validation_sample_ids.sort();
    }

    let mut value = serde_json::to_value(&canonical)?;
    remove_empty_fold_set_maps(&mut value);
    // This fingerprint has always hashed a recursively key-sorted JSON value,
    // not typed struct field order. Preserve that published contract when an
    // embedding aggregate enables serde_json/preserve_order.
    value.sort_all_objects();
    stable_json_fingerprint(&value)
}

fn remove_empty_fold_set_maps(value: &mut serde_json::Value) {
    let Some(object) = value.as_object_mut() else {
        return;
    };
    if object
        .get("sample_groups")
        .and_then(serde_json::Value::as_object)
        .is_some_and(serde_json::Map::is_empty)
    {
        object.remove("sample_groups");
    }
    let Some(folds) = object
        .get_mut("folds")
        .and_then(serde_json::Value::as_array_mut)
    else {
        return;
    };
    for fold in folds {
        let Some(fold_object) = fold.as_object_mut() else {
            continue;
        };
        if fold_object
            .get("metadata")
            .and_then(serde_json::Value::as_object)
            .is_some_and(serde_json::Map::is_empty)
        {
            fold_object.remove("metadata");
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct KFoldSpec {
    pub n_splits: usize,
    #[serde(default)]
    pub shuffle: bool,
    pub seed: Option<u64>,
}

impl KFoldSpec {
    /// Split only the target-observed samples and declare `target_missing` outside the CV
    /// universe (see [`FoldSet::target_missing_sample_ids`]). Unknown ids, an all-missing
    /// universe, or fewer observed samples than `n_splits` are refused with a structured
    /// [`DagMlError::TargetMissing`].
    pub fn split_with_target_missing(
        &self,
        id: impl Into<String>,
        samples: &[SampleId],
        target_missing: &BTreeSet<SampleId>,
    ) -> Result<FoldSet> {
        let id = id.into();
        unique_samples("KFold samples", samples)?;
        let observed = observed_universe(
            &id,
            samples.iter(),
            target_missing,
            self.n_splits,
            Clone::clone,
        )?;
        declare_target_missing(self.split(id, &observed)?, target_missing)
    }

    pub fn split(&self, id: impl Into<String>, samples: &[SampleId]) -> Result<FoldSet> {
        if self.n_splits < 2 {
            return Err(DagMlError::OofValidation(
                "KFold requires at least two splits".to_string(),
            ));
        }
        let unique = unique_samples("KFold samples", samples)?;
        if self.n_splits > unique.len() {
            return Err(DagMlError::OofValidation(format!(
                "KFold n_splits={} exceeds sample count {}",
                self.n_splits,
                unique.len()
            )));
        }
        let ordered = ordered_samples(samples, self.shuffle, self.seed.unwrap_or(0));
        let folds = (0..self.n_splits)
            .map(|fold_idx| {
                let validation = ordered
                    .iter()
                    .enumerate()
                    .filter_map(|(idx, sample_id)| {
                        (idx % self.n_splits == fold_idx).then_some(sample_id.clone())
                    })
                    .collect::<Vec<_>>();
                let validation_set = validation.iter().collect::<BTreeSet<_>>();
                let train = ordered
                    .iter()
                    .filter(|sample_id| !validation_set.contains(sample_id))
                    .cloned()
                    .collect::<Vec<_>>();
                Ok(FoldAssignment {
                    fold_id: FoldId::new(format!("fold{fold_idx}"))?,
                    train_sample_ids: train,
                    validation_sample_ids: validation,
                    metadata: BTreeMap::new(),
                })
            })
            .collect::<Result<Vec<_>>>()?;
        let fold_set = FoldSet {
            id: id.into(),
            sample_ids: ordered_samples(samples, false, 0),
            folds,
            sample_groups: BTreeMap::new(),
            partition_mode: FoldPartitionMode::Partition,
            train_exclusion: FoldTrainExclusion::Relations,
            target_missing_sample_ids: Vec::new(),
        };
        fold_set.validate()?;
        Ok(fold_set)
    }
}

/// Stratified K-fold: each sample is validated exactly once (OOF-safe like
/// plain K-fold), but folds are balanced by a per-sample class label so every
/// fold mirrors the overall class distribution. `strata` maps each sample id to
/// its class label (identity-keyed metadata — never feature values).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct StratifiedKFoldSpec {
    pub n_splits: usize,
    #[serde(default)]
    pub shuffle: bool,
    pub seed: Option<u64>,
}

/// Nested stratified K-fold with the identity-keyed class labels required to
/// construct folds inside each outer-training universe.
///
/// Keeping the labels on the fingerprinted policy lets the coordinator build
/// every inner fold without inspecting feature buffers or asking a model
/// controller to reinterpret target rows.  Labels for outer-validation samples
/// may be present, but [`NestedCvSpec::build_nested_fold_set`] selects only the
/// owning outer fold's training ids before splitting.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct StratifiedNestedCvSpec {
    #[serde(flatten)]
    pub splitter: StratifiedKFoldSpec,
    pub strata: BTreeMap<SampleId, String>,
}

impl StratifiedKFoldSpec {
    /// Stratified variant of [`KFoldSpec::split_with_target_missing`]. Target-missing samples
    /// need no stratum label.
    pub fn split_with_target_missing(
        &self,
        id: impl Into<String>,
        samples: &[SampleId],
        strata: &BTreeMap<SampleId, String>,
        target_missing: &BTreeSet<SampleId>,
    ) -> Result<FoldSet> {
        let id = id.into();
        unique_samples("StratifiedKFold samples", samples)?;
        let observed = observed_universe(
            &id,
            samples.iter(),
            target_missing,
            self.n_splits,
            Clone::clone,
        )?;
        declare_target_missing(self.split(id, &observed, strata)?, target_missing)
    }

    pub fn split(
        &self,
        id: impl Into<String>,
        samples: &[SampleId],
        strata: &BTreeMap<SampleId, String>,
    ) -> Result<FoldSet> {
        if self.n_splits < 2 {
            return Err(DagMlError::OofValidation(
                "StratifiedKFold requires at least two splits".to_string(),
            ));
        }
        let unique = unique_samples("StratifiedKFold samples", samples)?;
        if self.n_splits > unique.len() {
            return Err(DagMlError::OofValidation(format!(
                "StratifiedKFold n_splits={} exceeds sample count {}",
                self.n_splits,
                unique.len()
            )));
        }
        // Group samples by class (deterministic label order), preserving the
        // within-class order, then assign folds by GLOBAL round-robin over that
        // class-grouped order. Each sample lands in exactly one fold (OOF) and
        // every class is spread across folds; crucially no fold is left empty
        // whenever KFold's `n_splits <= n_samples` invariant holds (the previous
        // per-class counter could pile singleton classes all into fold 0).
        let ordered = ordered_samples(samples, self.shuffle, self.seed.unwrap_or(0));
        let mut by_label: BTreeMap<String, Vec<SampleId>> = BTreeMap::new();
        for sample_id in &ordered {
            let label = strata.get(sample_id).ok_or_else(|| {
                DagMlError::OofValidation(format!(
                    "StratifiedKFold: sample `{sample_id}` has no stratum label"
                ))
            })?;
            by_label
                .entry(label.clone())
                .or_default()
                .push(sample_id.clone());
        }
        let mut fold_of: BTreeMap<SampleId, usize> = BTreeMap::new();
        let mut position = 0usize;
        for members in by_label.values() {
            for sample_id in members {
                fold_of.insert(sample_id.clone(), position % self.n_splits);
                position += 1;
            }
        }
        let folds = (0..self.n_splits)
            .map(|fold_idx| {
                let validation = ordered
                    .iter()
                    .filter(|s| fold_of.get(*s) == Some(&fold_idx))
                    .cloned()
                    .collect::<Vec<_>>();
                let train = ordered
                    .iter()
                    .filter(|s| fold_of.get(*s) != Some(&fold_idx))
                    .cloned()
                    .collect::<Vec<_>>();
                Ok(FoldAssignment {
                    fold_id: FoldId::new(format!("fold{fold_idx}"))?,
                    train_sample_ids: train,
                    validation_sample_ids: validation,
                    metadata: BTreeMap::new(),
                })
            })
            .collect::<Result<Vec<_>>>()?;
        let fold_set = FoldSet {
            id: id.into(),
            sample_ids: ordered_samples(samples, false, 0),
            folds,
            sample_groups: BTreeMap::new(),
            partition_mode: FoldPartitionMode::Partition,
            train_exclusion: FoldTrainExclusion::Relations,
            target_missing_sample_ids: Vec::new(),
        };
        fold_set.validate()?;
        Ok(fold_set)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct GroupKFoldSpec {
    pub n_splits: usize,
}

impl GroupKFoldSpec {
    /// Group-disjoint variant of [`KFoldSpec::split_with_target_missing`]. The observed universe
    /// must still hold at least `n_splits` distinct groups.
    pub fn split_with_target_missing(
        &self,
        id: impl Into<String>,
        sample_groups: &BTreeMap<SampleId, GroupId>,
        target_missing: &BTreeSet<SampleId>,
    ) -> Result<FoldSet> {
        let id = id.into();
        let observed = observed_universe(
            &id,
            sample_groups.keys(),
            target_missing,
            self.n_splits,
            |sample_id| sample_groups[sample_id].clone(),
        )?;
        let observed_groups = observed
            .into_iter()
            .map(|sample_id| {
                let group_id = sample_groups[&sample_id].clone();
                (sample_id, group_id)
            })
            .collect();
        declare_target_missing(self.split(id, &observed_groups)?, target_missing)
    }

    pub fn split(
        &self,
        id: impl Into<String>,
        sample_groups: &BTreeMap<SampleId, GroupId>,
    ) -> Result<FoldSet> {
        if self.n_splits < 2 {
            return Err(DagMlError::OofValidation(
                "GroupKFold requires at least two splits".to_string(),
            ));
        }
        if sample_groups.is_empty() {
            return Err(DagMlError::OofValidation(
                "GroupKFold requires sample groups".to_string(),
            ));
        }
        let mut groups = BTreeMap::<GroupId, Vec<SampleId>>::new();
        for (sample_id, group_id) in sample_groups {
            groups
                .entry(group_id.clone())
                .or_default()
                .push(sample_id.clone());
        }
        if self.n_splits > groups.len() {
            return Err(DagMlError::OofValidation(format!(
                "GroupKFold n_splits={} exceeds group count {}",
                self.n_splits,
                groups.len()
            )));
        }

        let mut grouped = groups.into_iter().collect::<Vec<_>>();
        grouped.sort_by(|(left_group, left_samples), (right_group, right_samples)| {
            right_samples
                .len()
                .cmp(&left_samples.len())
                .then_with(|| left_group.cmp(right_group))
        });

        let mut fold_validation = vec![Vec::<SampleId>::new(); self.n_splits];
        for (_group_id, mut samples) in grouped {
            samples.sort();
            let fold_idx = fold_validation
                .iter()
                .enumerate()
                .min_by(|(left_idx, left), (right_idx, right)| {
                    left.len()
                        .cmp(&right.len())
                        .then_with(|| left_idx.cmp(right_idx))
                })
                .map(|(idx, _)| idx)
                .expect("at least one fold");
            fold_validation[fold_idx].extend(samples);
        }

        let mut sample_ids = sample_groups.keys().cloned().collect::<Vec<_>>();
        sample_ids.sort();
        let folds = fold_validation
            .into_iter()
            .enumerate()
            .map(|(fold_idx, mut validation)| {
                validation.sort();
                let validation_set = validation.iter().collect::<BTreeSet<_>>();
                let train = sample_ids
                    .iter()
                    .filter(|sample_id| !validation_set.contains(sample_id))
                    .cloned()
                    .collect::<Vec<_>>();
                Ok(FoldAssignment {
                    fold_id: FoldId::new(format!("fold{fold_idx}"))?,
                    train_sample_ids: train,
                    validation_sample_ids: validation,
                    metadata: BTreeMap::new(),
                })
            })
            .collect::<Result<Vec<_>>>()?;

        let fold_set = FoldSet {
            id: id.into(),
            sample_ids,
            folds,
            sample_groups: sample_groups.clone(),
            partition_mode: FoldPartitionMode::Partition,
            train_exclusion: FoldTrainExclusion::Relations,
            target_missing_sample_ids: Vec::new(),
        };
        fold_set.validate()?;
        Ok(fold_set)
    }
}

/// Inner (nested) cross-validation policy.
///
/// Declared globally on the `CampaignSpec` and/or locally on a `NodePlan`
/// (e.g. a finetune/tuner or branch node); the local policy overrides the global
/// default (see [`resolve_inner_cv`]). dag-ml builds the inner `FoldSet` from each
/// outer fold's **training** samples via [`NestedCvSpec::build_inner_fold_set`],
/// so the inner folds are a subset of outer-train *by construction* — nested CV
/// cannot leak outer-validation rows into inner tuning.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum NestedCvSpec {
    /// Index-based inner K-fold, built in-core from outer-train samples.
    #[serde(rename = "kfold")]
    KFold(KFoldSpec),
    /// Resolve a K-fold count from attested fit-capacity hints in the graph.
    /// The nested runtime resolves this to `KFold` before building folds.
    #[serde(rename = "capacity_kfold")]
    CapacityKFold(CapacityKFoldSpec),
    /// Group-aware inner K-fold, built in-core from outer-train sample groups.
    #[serde(rename = "group_kfold")]
    GroupKFold(GroupKFoldSpec),
    /// Target-stratified inner K-fold, with labels bound to stable sample ids.
    #[serde(rename = "stratified_kfold")]
    StratifiedKFold(StratifiedNestedCvSpec),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CapacityKFoldSpec {
    pub min_splits: usize,
    pub max_splits: usize,
    #[serde(default)]
    pub shuffle: bool,
    #[serde(default)]
    pub seed: Option<u64>,
}

/// One inner fold set bound to the exact outer fold that owns its training
/// universe.  The parent is a first-class identity: nested schedulers and OOF
/// caches must not infer it by parsing an inner fold-set identifier.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct NestedFoldSet {
    pub parent_outer_fold_id: FoldId,
    pub inner_fold_set: FoldSet,
}

impl NestedFoldSet {
    /// Validate both the explicit parent binding and the no-leakage subset
    /// invariant.  A structurally valid inner set cannot be reused under a
    /// different outer fold.
    pub fn validate_for_outer(&self, outer: &FoldAssignment) -> Result<()> {
        if self.parent_outer_fold_id != outer.fold_id {
            return Err(DagMlError::OofValidation(format!(
                "nested CV parent fold `{}` does not match outer fold `{}`",
                self.parent_outer_fold_id, outer.fold_id
            )));
        }
        validate_inner_fold_set_within_outer(&self.inner_fold_set, outer)
    }
}

impl NestedCvSpec {
    /// Validate the nested-CV policy's parameters independently of any outer fold.
    /// Mirrors the checks the splitters enforce (`n_splits >= 2`) so a malformed
    /// declaration is rejected at plan time rather than deferred to FIT_CV.
    pub fn validate(&self) -> Result<()> {
        match self {
            Self::KFold(spec) => {
                if spec.n_splits < 2 {
                    return Err(DagMlError::OofValidation(
                        "inner KFold requires at least two splits".to_string(),
                    ));
                }
            }
            Self::CapacityKFold(spec) => {
                if spec.min_splits < 2 || spec.max_splits < spec.min_splits {
                    return Err(DagMlError::OofValidation(
                        "capacity KFold requires 2 <= min_splits <= max_splits".to_string(),
                    ));
                }
            }
            Self::GroupKFold(spec) => {
                if spec.n_splits < 2 {
                    return Err(DagMlError::OofValidation(
                        "inner GroupKFold requires at least two splits".to_string(),
                    ));
                }
            }
            Self::StratifiedKFold(spec) => {
                if spec.splitter.n_splits < 2 {
                    return Err(DagMlError::OofValidation(
                        "inner StratifiedKFold requires at least two splits".to_string(),
                    ));
                }
                if spec.strata.is_empty() || spec.strata.values().any(|label| label.is_empty()) {
                    return Err(DagMlError::OofValidation(
                        "inner StratifiedKFold requires non-empty identity-keyed strata"
                            .to_string(),
                    ));
                }
            }
        }
        Ok(())
    }

    /// Build the inner `FoldSet` for one outer fold from its **training** samples
    /// only. `outer_groups` is the outer `FoldSet.sample_groups` (used by
    /// `GroupKFold`; ignored otherwise). The result is validated to lie entirely
    /// within the outer fold's training set.
    pub fn build_inner_fold_set(
        &self,
        outer: &FoldAssignment,
        outer_groups: &BTreeMap<SampleId, GroupId>,
    ) -> Result<FoldSet> {
        Ok(self
            .build_nested_fold_set(outer, outer_groups)?
            .inner_fold_set)
    }

    /// Build an inner fold set together with its non-optional outer-fold
    /// ownership.  New scheduler paths should retain this wrapper throughout
    /// execution rather than carrying a bare `FoldSet`.
    pub fn build_nested_fold_set(
        &self,
        outer: &FoldAssignment,
        outer_groups: &BTreeMap<SampleId, GroupId>,
    ) -> Result<NestedFoldSet> {
        if !outer_groups.is_empty() && !matches!(self, Self::GroupKFold(_)) {
            return Err(DagMlError::OofValidation(
                "grouped samples require a group-aware inner CV policy".to_string(),
            ));
        }
        let inner_id = format!("{}.inner", outer.fold_id);
        let mut inner = match self {
            Self::KFold(spec) => spec.split(inner_id, &outer.train_sample_ids)?,
            Self::CapacityKFold(_) => {
                return Err(DagMlError::OofValidation(
                    "capacity KFold must be resolved against graph fit-capacity hints before building folds".to_string(),
                ));
            }
            Self::GroupKFold(spec) => {
                let train = outer.train_sample_ids.iter().collect::<BTreeSet<_>>();
                let inner_groups = outer_groups
                    .iter()
                    .filter(|(sample_id, _)| train.contains(sample_id))
                    .map(|(sample_id, group_id)| (sample_id.clone(), group_id.clone()))
                    .collect::<BTreeMap<_, _>>();
                spec.split(inner_id, &inner_groups)?
            }
            Self::StratifiedKFold(spec) => {
                let train = outer.train_sample_ids.iter().collect::<BTreeSet<_>>();
                let inner_strata = spec
                    .strata
                    .iter()
                    .filter(|(sample_id, _)| train.contains(sample_id))
                    .map(|(sample_id, label)| (sample_id.clone(), label.clone()))
                    .collect::<BTreeMap<_, _>>();
                spec.splitter
                    .split(inner_id, &outer.train_sample_ids, &inner_strata)?
            }
        };
        // Splitters name folds locally (`fold0`, `fold1`, …).  Nested OOF is
        // retained in one run context across every outer fold, so local names
        // would collide in the prediction store. Namespace every assignment by
        // the explicit parent rather than relying on the fold-set id (which is
        // not carried by `PredictionBlock`).
        for fold in &mut inner.folds {
            fold.fold_id = FoldId::new(format!("{}.inner.{}", outer.fold_id, fold.fold_id))?;
        }
        let nested = NestedFoldSet {
            parent_outer_fold_id: outer.fold_id.clone(),
            inner_fold_set: inner,
        };
        nested.validate_for_outer(outer)?;
        Ok(nested)
    }
}

/// Resolve the effective inner-CV policy for a node: a node-local policy
/// overrides the campaign-global default; `None` means no nested CV.
pub fn resolve_inner_cv<'a>(
    node_inner_cv: Option<&'a NestedCvSpec>,
    campaign_inner_cv: Option<&'a NestedCvSpec>,
) -> Option<&'a NestedCvSpec> {
    node_inner_cv.or(campaign_inner_cv)
}

/// Enforce the nested-CV invariant: every sample in `inner` — both the top-level
/// universe and every fold's train/validation members — must be an outer-fold
/// **training** sample (never an outer-validation sample). Holds by construction
/// for dag-ml-built inner folds, and also validates inner folds supplied from
/// elsewhere. Refuses with an OOF-validation error on any leaking sample.
pub fn validate_inner_fold_set_within_outer(inner: &FoldSet, outer: &FoldAssignment) -> Result<()> {
    // Ensure the inner fold set is structurally sound first; otherwise a malformed
    // supplied fold set could hide a leaking sample in a fold while omitting it
    // from `sample_ids`. After this, fold members are guaranteed ⊆ `sample_ids`.
    inner.validate()?;
    let train = outer.train_sample_ids.iter().collect::<BTreeSet<_>>();
    let ensure_train = |sample_id: &SampleId| -> Result<()> {
        if !train.contains(sample_id) {
            return Err(DagMlError::OofValidation(format!(
                "nested CV leakage: inner-CV sample `{sample_id}` for outer fold `{}` is not an outer training sample",
                outer.fold_id
            )));
        }
        Ok(())
    };
    for sample_id in &inner.sample_ids {
        ensure_train(sample_id)?;
    }
    // Defence-in-depth: check every fold member directly, independent of the
    // sample_ids / structural invariants above.
    for fold in &inner.folds {
        for sample_id in fold
            .train_sample_ids
            .iter()
            .chain(&fold.validation_sample_ids)
        {
            ensure_train(sample_id)?;
        }
    }
    Ok(())
}

/// Build the structured refusal. `counts` is `(target_missing_count, observed_count)`.
fn target_missing_refusal(
    fold_set_id: &str,
    reason: TargetMissingRefusal,
    fold_id: Option<String>,
    sample_ids: &BTreeSet<SampleId>,
    counts: (usize, usize),
    detail: &str,
) -> DagMlError {
    let detail = match &fold_id {
        Some(fold_id) => format!("fold set `{fold_set_id}` fold `{fold_id}`: {detail}"),
        None => format!("fold set `{fold_set_id}`: {detail}"),
    };
    DagMlError::TargetMissing(Box::new(TargetMissingReport {
        reason,
        fold_set_id: Some(fold_set_id.to_string()),
        fold_id,
        target_missing_count: counts.0,
        observed_count: counts.1,
        sample_ids: sample_ids.iter().map(ToString::to_string).collect(),
        detail,
    }))
}

/// Split `candidates` into the target-observed universe a splitter partitions. Every declared
/// target-missing id must be a candidate, and at least `n_units` observed units (samples, or groups
/// via `unit_of`) must remain for `n_splits` non-empty folds.
fn observed_universe<'a, Unit: Ord>(
    fold_set_id: &str,
    candidates: impl Iterator<Item = &'a SampleId>,
    target_missing: &BTreeSet<SampleId>,
    n_splits: usize,
    unit_of: impl Fn(&SampleId) -> Unit,
) -> Result<Vec<SampleId>> {
    let candidates = candidates.cloned().collect::<BTreeSet<_>>();
    let unknown = target_missing
        .difference(&candidates)
        .cloned()
        .collect::<BTreeSet<_>>();
    let missing_count = target_missing.len();
    if !unknown.is_empty() {
        return Err(target_missing_refusal(
            fold_set_id,
            TargetMissingRefusal::UnknownSample,
            None,
            &unknown,
            (missing_count, candidates.difference(target_missing).count()),
            "declared target-missing samples are not split candidates",
        ));
    }
    let observed = candidates
        .difference(target_missing)
        .cloned()
        .collect::<Vec<_>>();
    if observed.is_empty() {
        return Err(target_missing_refusal(
            fold_set_id,
            TargetMissingRefusal::NoObservedTargets,
            None,
            target_missing,
            (missing_count, 0),
            "every split candidate is target-missing",
        ));
    }
    let units = observed.iter().map(&unit_of).collect::<BTreeSet<_>>();
    if !target_missing.is_empty() && units.len() < n_splits {
        return Err(target_missing_refusal(
            fold_set_id,
            TargetMissingRefusal::InsufficientObservedTargets,
            None,
            target_missing,
            (missing_count, observed.len()),
            &format!(
                "{} target-observed split unit(s) cannot fill n_splits={n_splits} folds",
                units.len()
            ),
        ));
    }
    Ok(observed)
}

/// Record the declared target-missing ids on a fold set built over the observed universe.
fn declare_target_missing(
    mut fold_set: FoldSet,
    target_missing: &BTreeSet<SampleId>,
) -> Result<FoldSet> {
    fold_set.target_missing_sample_ids = target_missing.iter().cloned().collect();
    fold_set.validate()?;
    Ok(fold_set)
}

fn unique_samples<'a>(label: &str, samples: &'a [SampleId]) -> Result<BTreeSet<&'a SampleId>> {
    let mut seen = BTreeSet::new();
    for sample_id in samples {
        if !seen.insert(sample_id) {
            return Err(DagMlError::OofValidation(format!(
                "{label} contains duplicate sample `{sample_id}`"
            )));
        }
    }
    Ok(seen)
}

fn ordered_samples(samples: &[SampleId], shuffle: bool, seed: u64) -> Vec<SampleId> {
    let mut ordered = samples.to_vec();
    ordered.sort();
    if shuffle {
        let context = SeedContext::root(seed).child("kfold");
        ordered.sort_by(|left, right| {
            context
                .derive_u64(left.as_str())
                .cmp(&context.derive_u64(right.as_str()))
                .then_with(|| left.cmp(right))
        });
    }
    ordered
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHARED_FOLD_SET_FINGERPRINT: &str =
        "54d3185d6c628ef0df848828a8d8ae650222a283a78bbd3ab3bc2256f222c05c";
    const SHARED_TARGET_MISSING_FOLD_SET_FINGERPRINT: &str =
        "316839e75f30271a949f07ccd9068f3152d9c60c3334318d05a4faf7256153ef";

    fn sid(value: &str) -> SampleId {
        SampleId::new(value).unwrap()
    }

    fn gid(value: &str) -> GroupId {
        GroupId::new(value).unwrap()
    }

    #[test]
    fn kfold_is_deterministic_and_covers_samples_once() {
        let samples = ["s1", "s2", "s3", "s4", "s5", "s6"]
            .into_iter()
            .map(sid)
            .collect::<Vec<_>>();
        let spec = KFoldSpec {
            n_splits: 3,
            shuffle: true,
            seed: Some(42),
        };

        let left = spec.split("kfold", &samples).unwrap();
        let right = spec.split("kfold", &samples).unwrap();

        assert_eq!(left, right);
        left.validate().unwrap();
        for fold in &left.folds {
            assert_eq!(fold.validation_sample_ids.len(), 2);
            assert_eq!(fold.train_sample_ids.len(), 4);
        }
    }

    #[test]
    fn outer_oof_is_not_safe_training_evidence_for_an_outer_fold_meta_model() {
        let samples = (0..12)
            .map(|index| SampleId::new(format!("s{index}")).unwrap())
            .collect::<Vec<_>>();
        let policy = KFoldSpec {
            n_splits: 2,
            shuffle: false,
            seed: None,
        };
        let outer = policy.split("outer", &samples).unwrap();
        let inner_policy = NestedCvSpec::KFold(policy);

        for parent in &outer.folds {
            let parent_validation = parent.validation_sample_ids.iter().collect::<BTreeSet<_>>();
            // An outer OOF prediction for a row in this fold's training set
            // comes from the other fold's model, which has seen this fold's
            // validation labels. It cannot train a leakage-safe meta-model.
            for train_row in &parent.train_sample_ids {
                let source_fold = outer
                    .folds
                    .iter()
                    .find(|fold| fold.validation_sample_ids.contains(train_row))
                    .unwrap();
                assert!(source_fold
                    .train_sample_ids
                    .iter()
                    .any(|row| parent_validation.contains(row)));
            }

            let inner = inner_policy
                .build_nested_fold_set(parent, &outer.sample_groups)
                .unwrap();
            for fold in &inner.inner_fold_set.folds {
                assert!(fold
                    .train_sample_ids
                    .iter()
                    .all(|row| !parent_validation.contains(row)));
            }
        }
    }

    #[test]
    fn fold_validation_rejects_overlap() {
        let fold_set = FoldSet {
            id: "bad".to_string(),
            sample_ids: vec![sid("s1"), sid("s2")],
            folds: vec![FoldAssignment {
                fold_id: FoldId::new("fold0").unwrap(),
                train_sample_ids: vec![sid("s1")],
                validation_sample_ids: vec![sid("s1")],
                metadata: BTreeMap::new(),
            }],
            sample_groups: BTreeMap::new(),
            partition_mode: FoldPartitionMode::Partition,
            train_exclusion: FoldTrainExclusion::Relations,
            target_missing_sample_ids: Vec::new(),
        };

        assert!(fold_set.validate().is_err());
    }

    #[test]
    fn fold_validation_rejects_partial_group_maps() {
        let fold_set = FoldSet {
            id: "bad-groups".to_string(),
            sample_ids: vec![sid("s1"), sid("s2")],
            folds: vec![FoldAssignment {
                fold_id: FoldId::new("fold0").unwrap(),
                train_sample_ids: vec![sid("s2")],
                validation_sample_ids: vec![sid("s1")],
                metadata: BTreeMap::new(),
            }],
            sample_groups: BTreeMap::from([(sid("s1"), gid("g1"))]),
            partition_mode: FoldPartitionMode::Partition,
            train_exclusion: FoldTrainExclusion::Relations,
            target_missing_sample_ids: Vec::new(),
        };

        assert!(fold_set.validate().is_err());
    }

    #[test]
    fn fold_set_fingerprint_is_independent_of_ordering() {
        let mut left = FoldSet {
            id: "cv.partition".to_string(),
            sample_ids: vec![sid("s3"), sid("s2"), sid("s1")],
            folds: vec![
                FoldAssignment {
                    fold_id: FoldId::new("fold1").unwrap(),
                    train_sample_ids: vec![sid("s2"), sid("s1")],
                    validation_sample_ids: vec![sid("s3")],
                    metadata: BTreeMap::new(),
                },
                FoldAssignment {
                    fold_id: FoldId::new("fold0").unwrap(),
                    train_sample_ids: vec![sid("s3")],
                    validation_sample_ids: vec![sid("s2"), sid("s1")],
                    metadata: BTreeMap::new(),
                },
            ],
            sample_groups: BTreeMap::new(),
            partition_mode: FoldPartitionMode::Partition,
            train_exclusion: FoldTrainExclusion::Relations,
            target_missing_sample_ids: Vec::new(),
        };
        let mut right = left.clone();
        right.sample_ids.reverse();
        right.folds.reverse();
        for fold in &mut right.folds {
            fold.train_sample_ids.reverse();
            fold.validation_sample_ids.reverse();
        }

        assert_eq!(
            fold_set_fingerprint(&left).unwrap(),
            fold_set_fingerprint(&right).unwrap()
        );

        left.id = "cv.partition.changed".to_string();
        assert_ne!(
            fold_set_fingerprint(&left).unwrap(),
            fold_set_fingerprint(&right).unwrap()
        );
    }

    #[test]
    fn shared_fold_set_fixture_fingerprint_is_locked() {
        let fixture = include_str!("../tests/fixtures/package/fold_set_cv_partition.json");
        let fold_set = serde_json::from_str::<FoldSet>(fixture).unwrap();

        assert_eq!(
            fold_set_fingerprint(&fold_set).unwrap(),
            SHARED_FOLD_SET_FINGERPRINT
        );
    }

    #[test]
    fn shared_target_missing_fold_set_fixture_fingerprint_is_locked() {
        // Byte-identical to dag-ml-data's shared fixture: resampled, fold-local and
        // target-missing fields must hash the same on both sides of the contract.
        let fixture =
            include_str!("../tests/fixtures/package/fold_set_target_missing_resampled.json");
        let fold_set = serde_json::from_str::<FoldSet>(fixture).unwrap();
        assert_eq!(fold_set.partition_mode, FoldPartitionMode::Resampled);
        assert_eq!(fold_set.train_exclusion, FoldTrainExclusion::FoldLocal);
        assert_eq!(
            fold_set_fingerprint(&fold_set).unwrap(),
            SHARED_TARGET_MISSING_FOLD_SET_FINGERPRINT
        );
    }

    #[test]
    fn group_kfold_keeps_groups_out_of_train_validation_overlap() {
        let groups = BTreeMap::from([
            (sid("s1"), gid("g1")),
            (sid("s2"), gid("g1")),
            (sid("s3"), gid("g2")),
            (sid("s4"), gid("g2")),
            (sid("s5"), gid("g3")),
            (sid("s6"), gid("g3")),
        ]);
        let fold_set = GroupKFoldSpec { n_splits: 3 }
            .split("group-kfold", &groups)
            .unwrap();

        fold_set.validate().unwrap();
        for fold in &fold_set.folds {
            let train_groups = fold
                .train_sample_ids
                .iter()
                .map(|sample_id| groups.get(sample_id).unwrap())
                .collect::<BTreeSet<_>>();
            for sample_id in &fold.validation_sample_ids {
                assert!(!train_groups.contains(groups.get(sample_id).unwrap()));
            }
        }
    }

    #[test]
    fn stratified_kfold_is_oof_safe_and_balances_classes() {
        // 8 samples, 2 classes (4 each); 2-fold stratified → each fold gets 2 of each class.
        let samples = (0..8).map(|i| sid(&format!("s{i}"))).collect::<Vec<_>>();
        let strata = BTreeMap::from_iter(samples.iter().enumerate().map(|(i, s)| {
            (
                s.clone(),
                if i % 2 == 0 {
                    "A".to_string()
                } else {
                    "B".to_string()
                },
            )
        }));
        let fold_set = StratifiedKFoldSpec {
            n_splits: 2,
            shuffle: false,
            seed: Some(0),
        }
        .split("strat", &samples, &strata)
        .unwrap();
        fold_set.validate().unwrap(); // OOF: each sample validated exactly once
        assert_eq!(fold_set.folds.len(), 2);
        for fold in &fold_set.folds {
            let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
            for s in &fold.validation_sample_ids {
                *counts.entry(strata.get(s).unwrap().as_str()).or_insert(0) += 1;
            }
            assert_eq!(counts.get("A"), Some(&2));
            assert_eq!(counts.get("B"), Some(&2));
        }
    }

    #[test]
    fn stratified_kfold_singleton_classes_leave_no_empty_fold() {
        // Codex repro: 3 singleton classes with n_splits=3 must not pile all
        // samples into fold0 (which FoldSet.validate rejects as an empty fold1).
        let samples = ["s0", "s1", "s2"].into_iter().map(sid).collect::<Vec<_>>();
        let strata = BTreeMap::from_iter([
            (sid("s0"), "A".to_string()),
            (sid("s1"), "B".to_string()),
            (sid("s2"), "C".to_string()),
        ]);
        let fold_set = StratifiedKFoldSpec {
            n_splits: 3,
            shuffle: false,
            seed: Some(0),
        }
        .split("strat", &samples, &strata)
        .expect("singleton-class stratified split must succeed");
        fold_set.validate().unwrap();
        for fold in &fold_set.folds {
            assert_eq!(fold.validation_sample_ids.len(), 1);
        }
    }

    #[test]
    fn stratified_kfold_rejects_missing_label() {
        let samples = (0..4).map(|i| sid(&format!("s{i}"))).collect::<Vec<_>>();
        let strata = BTreeMap::from_iter([(sid("s0"), "A".to_string())]); // incomplete
        let err = StratifiedKFoldSpec {
            n_splits: 2,
            shuffle: false,
            seed: Some(0),
        }
        .split("strat", &samples, &strata);
        assert!(err.is_err());
    }

    fn refusal(error: DagMlError) -> TargetMissingReport {
        match error {
            DagMlError::TargetMissing(report) => *report,
            other => panic!("expected a target-missing refusal, got {other}"),
        }
    }

    fn assert_outside_cv(fold_set: &FoldSet, missing: &BTreeSet<SampleId>) {
        assert!(fold_set.sample_ids.iter().all(|id| !missing.contains(id)));
        assert!(fold_set
            .sample_groups
            .keys()
            .all(|id| !missing.contains(id)));
        for fold in &fold_set.folds {
            assert!(fold
                .train_sample_ids
                .iter()
                .chain(&fold.validation_sample_ids)
                .all(|id| !missing.contains(id)));
        }
        assert_eq!(
            fold_set.target_missing_sample_ids,
            missing.iter().cloned().collect::<Vec<_>>()
        );
        fold_set.validate().unwrap();
    }

    #[test]
    fn splitters_keep_target_missing_samples_out_of_every_fold() {
        let samples = (0..8).map(|i| sid(&format!("s{i}"))).collect::<Vec<_>>();
        let missing = BTreeSet::from([sid("s2"), sid("s5")]);
        let kfold = KFoldSpec {
            n_splits: 3,
            shuffle: true,
            seed: Some(7),
        };
        let folds = kfold
            .split_with_target_missing("outer", &samples, &missing)
            .unwrap();
        assert_outside_cv(&folds, &missing);
        assert_eq!(folds.sample_ids.len(), 6);
        // The exclusion is part of the fingerprinted contract; an empty
        // declaration keeps the historical bytes and fingerprint.
        let unmarked = kfold
            .split_with_target_missing("outer", &samples, &BTreeSet::new())
            .unwrap();
        assert_eq!(unmarked, kfold.split("outer", &samples).unwrap());
        assert!(!serde_json::to_value(&unmarked)
            .unwrap()
            .as_object()
            .unwrap()
            .contains_key("target_missing_sample_ids"));
        let mut observed_only = kfold.split("outer", &folds.sample_ids).unwrap();
        assert_ne!(
            fold_set_fingerprint(&folds).unwrap(),
            fold_set_fingerprint(&observed_only).unwrap()
        );
        observed_only.target_missing_sample_ids = vec![sid("s5"), sid("s2")];
        assert_eq!(
            fold_set_fingerprint(&folds).unwrap(),
            fold_set_fingerprint(&observed_only).unwrap(),
            "the declared list is canonicalized"
        );

        let strata = samples
            .iter()
            .filter(|id| !missing.contains(*id))
            .enumerate()
            .map(|(i, id)| (id.clone(), if i % 2 == 0 { "A" } else { "B" }.to_string()))
            .collect::<BTreeMap<_, _>>();
        let stratified = StratifiedKFoldSpec {
            n_splits: 2,
            shuffle: false,
            seed: None,
        }
        .split_with_target_missing("outer", &samples, &strata, &missing)
        .unwrap();
        assert_outside_cv(&stratified, &missing);

        let groups = samples
            .iter()
            .enumerate()
            .map(|(i, id)| (id.clone(), gid(&format!("g{}", i / 2))))
            .collect::<BTreeMap<_, _>>();
        let grouped = GroupKFoldSpec { n_splits: 3 }
            .split_with_target_missing("outer", &groups, &missing)
            .unwrap();
        assert_outside_cv(&grouped, &missing);
    }

    #[test]
    fn nested_fold_sets_carry_the_target_missing_declaration() {
        let samples = (0..9).map(|i| sid(&format!("s{i}"))).collect::<Vec<_>>();
        let missing = BTreeSet::from([sid("s3")]);
        let outer = KFoldSpec {
            n_splits: 3,
            shuffle: false,
            seed: None,
        }
        .split_with_target_missing("outer", &samples, &missing)
        .unwrap();
        let inner_spec = NestedCvSpec::KFold(KFoldSpec {
            n_splits: 2,
            shuffle: false,
            seed: None,
        });
        for fold in &outer.folds {
            let nested = outer.nested_fold_set(&inner_spec, fold).unwrap();
            assert_eq!(
                nested.inner_fold_set.target_missing_sample_ids,
                vec![sid("s3")]
            );
            assert_outside_cv(&nested.inner_fold_set, &missing);
        }
    }

    #[test]
    fn splitters_refuse_unknown_all_missing_and_too_few_observed_targets() {
        let samples = (0..4).map(|i| sid(&format!("s{i}"))).collect::<Vec<_>>();
        let kfold = KFoldSpec {
            n_splits: 3,
            shuffle: false,
            seed: None,
        };
        let unknown = refusal(
            kfold
                .split_with_target_missing("outer", &samples, &BTreeSet::from([sid("zz")]))
                .unwrap_err(),
        );
        assert_eq!(unknown.reason, TargetMissingRefusal::UnknownSample);
        assert_eq!(unknown.sample_ids, vec!["zz".to_string()]);
        assert_eq!(
            unknown.observed_count, 4,
            "unknown ids are not observed samples"
        );

        let all = samples.iter().cloned().collect::<BTreeSet<_>>();
        let none_observed = refusal(
            kfold
                .split_with_target_missing("outer", &samples, &all)
                .unwrap_err(),
        );
        assert_eq!(
            none_observed.reason,
            TargetMissingRefusal::NoObservedTargets
        );
        assert_eq!(none_observed.target_missing_count, 4);

        let too_few = refusal(
            kfold
                .split_with_target_missing(
                    "outer",
                    &samples,
                    &BTreeSet::from([sid("s0"), sid("s1")]),
                )
                .unwrap_err(),
        );
        assert_eq!(
            too_few.reason,
            TargetMissingRefusal::InsufficientObservedTargets
        );
        assert_eq!(
            (too_few.target_missing_count, too_few.observed_count),
            (2, 2)
        );

        // GroupKFold counts observed GROUPS, not samples.
        let groups = BTreeMap::from([
            (sid("s0"), gid("g0")),
            (sid("s1"), gid("g0")),
            (sid("s2"), gid("g1")),
            (sid("s3"), gid("g2")),
        ]);
        let grouped = refusal(
            GroupKFoldSpec { n_splits: 3 }
                .split_with_target_missing("outer", &groups, &BTreeSet::from([sid("s2")]))
                .unwrap_err(),
        );
        assert_eq!(
            grouped.reason,
            TargetMissingRefusal::InsufficientObservedTargets
        );
    }

    #[test]
    fn exclude_target_missing_narrows_host_fold_sets_and_refuses_empty_folds() {
        let samples = (0..6).map(|i| sid(&format!("s{i}"))).collect::<Vec<_>>();
        // fold0 validates s0,s3; fold1 s1,s4; fold2 s2,s5.
        let folds = KFoldSpec {
            n_splits: 3,
            shuffle: false,
            seed: None,
        }
        .split("outer", &samples)
        .unwrap();
        let missing = BTreeSet::from([sid("s2")]);
        let narrowed = folds.exclude_target_missing(&missing).unwrap();
        assert_outside_cv(&narrowed, &missing);
        assert_eq!(narrowed.folds[2].validation_sample_ids, vec![sid("s5")]);
        assert_eq!(
            narrowed.exclude_target_missing(&missing).unwrap(),
            narrowed,
            "re-declaring an excluded sample is idempotent"
        );

        let empty_validation = refusal(
            folds
                .exclude_target_missing(&BTreeSet::from([sid("s2"), sid("s5")]))
                .unwrap_err(),
        );
        assert_eq!(
            empty_validation.reason,
            TargetMissingRefusal::EmptyValidationFold
        );
        assert_eq!(empty_validation.fold_id.as_deref(), Some("fold2"));
        assert_eq!(empty_validation.fold_set_id.as_deref(), Some("outer"));
        assert_eq!(empty_validation.target_missing_count, 2);
        assert_eq!(empty_validation.observed_count, 4);

        // A hand-built fold whose only training sample lacks a target.
        let host = FoldSet {
            id: "host".to_string(),
            sample_ids: vec![sid("a"), sid("b"), sid("c")],
            folds: vec![
                FoldAssignment {
                    fold_id: FoldId::new("f0").unwrap(),
                    train_sample_ids: vec![sid("a")],
                    validation_sample_ids: vec![sid("b"), sid("c")],
                    metadata: BTreeMap::new(),
                },
                FoldAssignment {
                    fold_id: FoldId::new("f1").unwrap(),
                    train_sample_ids: vec![sid("b"), sid("c")],
                    validation_sample_ids: vec![sid("a")],
                    metadata: BTreeMap::new(),
                },
            ],
            sample_groups: BTreeMap::new(),
            partition_mode: FoldPartitionMode::Resampled,
            train_exclusion: FoldTrainExclusion::Relations,
            target_missing_sample_ids: Vec::new(),
        };
        let train_empty = refusal(
            host.exclude_target_missing(&BTreeSet::from([sid("a")]))
                .unwrap_err(),
        );
        assert_eq!(train_empty.reason, TargetMissingRefusal::EmptyTrainFold);
        assert_eq!(train_empty.fold_id.as_deref(), Some("f0"));

        let all = samples.iter().cloned().collect::<BTreeSet<_>>();
        assert_eq!(
            refusal(folds.exclude_target_missing(&all).unwrap_err()).reason,
            TargetMissingRefusal::NoObservedTargets
        );
        assert_eq!(
            refusal(
                folds
                    .exclude_target_missing(&BTreeSet::from([sid("zz")]))
                    .unwrap_err()
            )
            .reason,
            TargetMissingRefusal::UnknownSample
        );
    }

    #[test]
    fn fold_set_refuses_target_missing_samples_inside_cv_universe() {
        let mut folds = KFoldSpec {
            n_splits: 2,
            shuffle: false,
            seed: None,
        }
        .split("outer", &[sid("s0"), sid("s1"), sid("s2")])
        .unwrap();
        folds.target_missing_sample_ids = vec![sid("s1")];
        let error = folds.validate().unwrap_err();
        let descriptor = error.descriptor();
        assert_eq!(descriptor.category, "validation");
        assert_eq!(descriptor.code, "target_missing_exclusion");
        assert_eq!(descriptor.context["reason"], "in_cv_universe");
        assert_eq!(error.error_code(), 0x0000_0006);
        assert_eq!(refusal(error).reason, TargetMissingRefusal::InCvUniverse);
        folds.target_missing_sample_ids = vec![sid("s9"), sid("s9")];
        assert!(folds.validate().is_err(), "duplicates are refused");
    }

    fn outer_kfold(samples: &[SampleId]) -> FoldSet {
        KFoldSpec {
            n_splits: 2,
            shuffle: false,
            seed: Some(0),
        }
        .split("outer", samples)
        .unwrap()
    }

    #[test]
    fn nested_kfold_inner_folds_are_subset_of_outer_train() {
        let samples = ["s1", "s2", "s3", "s4", "s5", "s6"]
            .into_iter()
            .map(sid)
            .collect::<Vec<_>>();
        let outer = outer_kfold(&samples);
        let spec = NestedCvSpec::KFold(KFoldSpec {
            n_splits: 2,
            shuffle: false,
            seed: Some(1),
        });
        for outer_fold in &outer.folds {
            let inner = spec
                .build_inner_fold_set(outer_fold, &outer.sample_groups)
                .expect("inner fold set");
            let outer_train = outer_fold.train_sample_ids.iter().collect::<BTreeSet<_>>();
            // Every inner sample is an outer training sample.
            for sample_id in &inner.sample_ids {
                assert!(outer_train.contains(sample_id));
            }
            // The inner fold set is itself valid and covers exactly outer-train.
            inner.validate().unwrap();
            assert_eq!(
                inner.sample_ids.iter().collect::<BTreeSet<_>>(),
                outer_train
            );
        }
    }

    #[test]
    fn nested_fold_set_binds_inner_evidence_to_its_outer_fold() {
        let samples = ["s1", "s2", "s3", "s4", "s5", "s6"]
            .into_iter()
            .map(sid)
            .collect::<Vec<_>>();
        let outer = outer_kfold(&samples);
        let spec = NestedCvSpec::KFold(KFoldSpec {
            n_splits: 2,
            shuffle: false,
            seed: Some(1),
        });
        let first = &outer.folds[0];
        let nested = spec
            .build_nested_fold_set(first, &outer.sample_groups)
            .expect("nested fold set");
        assert_eq!(nested.parent_outer_fold_id, first.fold_id);
        nested.validate_for_outer(first).unwrap();
        assert!(nested.inner_fold_set.folds.iter().all(|fold| fold
            .fold_id
            .as_str()
            .starts_with(&format!("{}.inner.", first.fold_id))));

        let second = &outer.folds[1];
        let error = nested
            .validate_for_outer(second)
            .expect_err("inner evidence must not be transplantable across outer folds");
        assert!(error.to_string().contains("parent fold"));
    }

    #[test]
    fn nested_cv_validation_refuses_inner_sample_from_outer_validation() {
        let samples = ["s1", "s2", "s3", "s4"]
            .into_iter()
            .map(sid)
            .collect::<Vec<_>>();
        let outer = outer_kfold(&samples);
        let outer_fold = &outer.folds[0];
        // A STRUCTURALLY VALID inner fold set that nonetheless includes an outer
        // VALIDATION sample — the nested-CV boundary check must refuse it.
        let leaking_sample = outer_fold.validation_sample_ids[0].clone();
        let train_sample = outer_fold.train_sample_ids[0].clone();
        let inner = FoldSet {
            id: "leaky.inner".to_string(),
            sample_ids: vec![train_sample.clone(), leaking_sample.clone()],
            folds: vec![
                FoldAssignment {
                    fold_id: FoldId::new("if0").unwrap(),
                    train_sample_ids: vec![leaking_sample.clone()],
                    validation_sample_ids: vec![train_sample.clone()],
                    metadata: BTreeMap::new(),
                },
                FoldAssignment {
                    fold_id: FoldId::new("if1").unwrap(),
                    train_sample_ids: vec![train_sample],
                    validation_sample_ids: vec![leaking_sample],
                    metadata: BTreeMap::new(),
                },
            ],
            sample_groups: BTreeMap::new(),
            partition_mode: FoldPartitionMode::Partition,
            train_exclusion: FoldTrainExclusion::Relations,
            target_missing_sample_ids: Vec::new(),
        };
        inner
            .validate()
            .expect("inner fold set is structurally valid");
        let err = validate_inner_fold_set_within_outer(&inner, outer_fold)
            .expect_err("inner fold leaking an outer-validation sample must be refused");
        assert!(err.to_string().contains("nested CV leakage"));
    }

    #[test]
    fn nested_cv_validation_refuses_leak_hidden_in_fold_members() {
        // A malformed supplied inner fold set hides an outer-validation sample in a
        // fold's members while omitting it from the top-level `sample_ids`. It must
        // still be refused (structural validation catches the inconsistency).
        let samples = ["s1", "s2", "s3", "s4"]
            .into_iter()
            .map(sid)
            .collect::<Vec<_>>();
        let outer = outer_kfold(&samples);
        let outer_fold = &outer.folds[0];
        let leaking_sample = outer_fold.validation_sample_ids[0].clone();
        let train_sample = outer_fold.train_sample_ids[0].clone();
        let inner = FoldSet {
            id: "hidden.inner".to_string(),
            // `sample_ids` omits the leaking sample, but a fold member smuggles it in.
            sample_ids: vec![train_sample.clone()],
            folds: vec![FoldAssignment {
                fold_id: FoldId::new("if0").unwrap(),
                train_sample_ids: vec![train_sample],
                validation_sample_ids: vec![leaking_sample],
                metadata: BTreeMap::new(),
            }],
            sample_groups: BTreeMap::new(),
            partition_mode: FoldPartitionMode::Partition,
            train_exclusion: FoldTrainExclusion::Relations,
            target_missing_sample_ids: Vec::new(),
        };
        assert!(validate_inner_fold_set_within_outer(&inner, outer_fold).is_err());
    }

    #[test]
    fn nested_cv_spec_json_shape_is_stable() {
        let spec = NestedCvSpec::KFold(KFoldSpec {
            n_splits: 3,
            shuffle: false,
            seed: Some(7),
        });
        let value = serde_json::to_value(&spec).unwrap();
        assert_eq!(value["kind"], "kfold");
        assert_eq!(value["n_splits"], 3);
        assert_eq!(value["seed"], 7);
        let round: NestedCvSpec = serde_json::from_value(value).unwrap();
        assert_eq!(round, spec);

        let group = NestedCvSpec::GroupKFold(GroupKFoldSpec { n_splits: 2 });
        let gv = serde_json::to_value(&group).unwrap();
        assert_eq!(gv["kind"], "group_kfold");
        assert_eq!(gv["n_splits"], 2);
        assert_eq!(serde_json::from_value::<NestedCvSpec>(gv).unwrap(), group);

        let stratified = NestedCvSpec::StratifiedKFold(StratifiedNestedCvSpec {
            splitter: StratifiedKFoldSpec {
                n_splits: 2,
                shuffle: true,
                seed: Some(11),
            },
            strata: BTreeMap::from([(sid("s0"), "A".to_string()), (sid("s1"), "B".to_string())]),
        });
        let sv = serde_json::to_value(&stratified).unwrap();
        assert_eq!(sv["kind"], "stratified_kfold");
        assert_eq!(sv["n_splits"], 2);
        assert_eq!(sv["strata"]["s0"], "A");
        assert_eq!(
            serde_json::from_value::<NestedCvSpec>(sv).unwrap(),
            stratified
        );
    }

    #[test]
    fn nested_stratified_cv_uses_only_outer_training_labels_and_balances_inner_folds() {
        let samples = (0..12)
            .map(|index| sid(&format!("s{index}")))
            .collect::<Vec<_>>();
        let outer = KFoldSpec {
            n_splits: 3,
            shuffle: false,
            seed: Some(0),
        }
        .split("outer", &samples)
        .unwrap();
        let outer_fold = &outer.folds[0];
        let strata = BTreeMap::from_iter(samples.iter().enumerate().map(|(index, sample)| {
            (
                sample.clone(),
                if index % 2 == 0 { "A" } else { "B" }.to_string(),
            )
        }));
        let spec = NestedCvSpec::StratifiedKFold(StratifiedNestedCvSpec {
            splitter: StratifiedKFoldSpec {
                n_splits: 2,
                shuffle: false,
                seed: Some(0),
            },
            strata: strata.clone(),
        });
        let nested = spec
            .build_nested_fold_set(outer_fold, &BTreeMap::new())
            .unwrap();
        nested.validate_for_outer(outer_fold).unwrap();
        let mut externally_poisoned_strata = strata;
        for sample in &outer_fold.validation_sample_ids {
            externally_poisoned_strata
                .insert(sample.clone(), "poisoned-external-label".to_string());
        }
        let externally_poisoned = NestedCvSpec::StratifiedKFold(StratifiedNestedCvSpec {
            splitter: StratifiedKFoldSpec {
                n_splits: 2,
                shuffle: false,
                seed: Some(0),
            },
            strata: externally_poisoned_strata,
        })
        .build_nested_fold_set(outer_fold, &BTreeMap::new())
        .unwrap();
        assert_eq!(nested, externally_poisoned);
        for fold in &nested.inner_fold_set.folds {
            let training_labels = fold
                .train_sample_ids
                .iter()
                .map(|sample| {
                    match sample
                        .as_str()
                        .trim_start_matches('s')
                        .parse::<usize>()
                        .unwrap()
                        % 2
                    {
                        0 => "A",
                        _ => "B",
                    }
                })
                .collect::<BTreeSet<_>>();
            assert_eq!(training_labels, BTreeSet::from(["A", "B"]));
            assert!(fold
                .train_sample_ids
                .iter()
                .chain(&fold.validation_sample_ids)
                .all(|sample| outer_fold.train_sample_ids.contains(sample)));
        }
    }

    #[test]
    fn resolve_inner_cv_prefers_node_over_campaign() {
        let node = NestedCvSpec::KFold(KFoldSpec {
            n_splits: 3,
            shuffle: false,
            seed: Some(2),
        });
        let campaign = NestedCvSpec::KFold(KFoldSpec {
            n_splits: 5,
            shuffle: false,
            seed: Some(3),
        });
        assert_eq!(resolve_inner_cv(Some(&node), Some(&campaign)), Some(&node));
        assert_eq!(resolve_inner_cv(None, Some(&campaign)), Some(&campaign));
        assert_eq!(resolve_inner_cv(Some(&node), None), Some(&node));
        assert_eq!(resolve_inner_cv(None, None), None);
    }

    #[test]
    fn resampled_mode_allows_non_oof_validation_but_still_blocks_leakage() {
        let fold = |id: &str, train: &[&str], val: &[&str]| FoldAssignment {
            fold_id: FoldId::new(id).unwrap(),
            train_sample_ids: train.iter().map(|s| sid(s)).collect(),
            validation_sample_ids: val.iter().map(|s| sid(s)).collect(),
            metadata: BTreeMap::new(),
        };
        let samples = vec![sid("s1"), sid("s2"), sid("s3"), sid("s4")];
        // s1 is validated twice and s4 never — not an OOF partition (ShuffleSplit-like).
        let folds = vec![
            fold("f0", &["s3", "s4"], &["s1", "s2"]),
            fold("f1", &["s2", "s4"], &["s1", "s3"]),
        ];

        let partition = FoldSet {
            id: "partition".to_string(),
            sample_ids: samples.clone(),
            folds: folds.clone(),
            sample_groups: BTreeMap::new(),
            partition_mode: FoldPartitionMode::Partition,
            train_exclusion: FoldTrainExclusion::Relations,
            target_missing_sample_ids: Vec::new(),
        };
        assert!(
            partition.validate().is_err(),
            "Partition mode must reject non-OOF validation"
        );

        let resampled = FoldSet {
            id: "resampled".to_string(),
            sample_ids: samples,
            folds,
            sample_groups: BTreeMap::new(),
            partition_mode: FoldPartitionMode::Resampled,
            train_exclusion: FoldTrainExclusion::Relations,
            target_missing_sample_ids: Vec::new(),
        };
        resampled.validate().unwrap(); // overlapping / incomplete validation is allowed

        // The leakage guard (train ∩ validation per fold) still holds in Resampled mode.
        let leaky = FoldSet {
            id: "leaky".to_string(),
            sample_ids: vec![sid("s1"), sid("s2")],
            folds: vec![fold("f", &["s1"], &["s1"])],
            sample_groups: BTreeMap::new(),
            partition_mode: FoldPartitionMode::Resampled,
            train_exclusion: FoldTrainExclusion::Relations,
            target_missing_sample_ids: Vec::new(),
        };
        assert!(
            leaky.validate().is_err(),
            "Resampled must still reject train/validation overlap"
        );
    }

    #[test]
    fn train_exclusion_default_serializes_byte_identically_and_fold_local_round_trips() {
        let json = r#"{"id":"outer","sample_ids":["s1","s2"],"folds":[{"fold_id":"fold:0","train_sample_ids":["s2"],"validation_sample_ids":["s1"],"metadata":{}},{"fold_id":"fold:1","train_sample_ids":["s1"],"validation_sample_ids":["s2"],"metadata":{}}],"sample_groups":{}}"#;
        let relations: FoldSet = serde_json::from_str(json).unwrap();
        assert_eq!(relations.train_exclusion, FoldTrainExclusion::Relations);
        // The default is skipped: the serialized bytes and the fingerprint are unchanged.
        assert_eq!(serde_json::to_string(&relations).unwrap(), json);
        let fingerprint = fold_set_fingerprint(&relations).unwrap();

        let mut fold_local = relations.clone();
        fold_local.train_exclusion = FoldTrainExclusion::FoldLocal;
        fold_local.validate().unwrap();
        let encoded = serde_json::to_string(&fold_local).unwrap();
        assert!(encoded.ends_with(r#""sample_groups":{},"train_exclusion":"fold_local"}"#));
        assert_eq!(
            serde_json::from_str::<FoldSet>(&encoded).unwrap(),
            fold_local
        );
        // A different fold-train authority is a different training contract.
        assert_ne!(fold_set_fingerprint(&fold_local).unwrap(), fingerprint);

        let unknown = json.replace(
            r#""sample_groups":{}"#,
            r#""sample_groups":{},"train_exclusion":"fold"}"#,
        );
        assert!(serde_json::from_str::<FoldSet>(&unknown).is_err());
    }

    #[test]
    fn fold_local_keeps_structural_leakage_checks() {
        let mut fold_set = FoldSet {
            id: "fold-local".to_string(),
            sample_ids: vec![sid("s1"), sid("s2"), sid("s3")],
            folds: vec![
                FoldAssignment {
                    fold_id: FoldId::new("f0").unwrap(),
                    // s2 was dropped by the host's fold-local filter.
                    train_sample_ids: vec![sid("s3")],
                    validation_sample_ids: vec![sid("s1")],
                    metadata: BTreeMap::new(),
                },
                FoldAssignment {
                    fold_id: FoldId::new("f1").unwrap(),
                    train_sample_ids: vec![sid("s1"), sid("s3")],
                    validation_sample_ids: vec![sid("s2")],
                    metadata: BTreeMap::new(),
                },
                FoldAssignment {
                    fold_id: FoldId::new("f2").unwrap(),
                    train_sample_ids: vec![sid("s1"), sid("s2")],
                    validation_sample_ids: vec![sid("s3")],
                    metadata: BTreeMap::new(),
                },
            ],
            sample_groups: BTreeMap::new(),
            partition_mode: FoldPartitionMode::Partition,
            train_exclusion: FoldTrainExclusion::FoldLocal,
            target_missing_sample_ids: Vec::new(),
        };
        fold_set.validate().unwrap();

        fold_set.folds[0].train_sample_ids.push(sid("s1"));
        assert!(fold_set
            .validate()
            .unwrap_err()
            .to_string()
            .contains("train/validation overlap"));
        fold_set.folds[0].train_sample_ids = vec![sid("s3"), sid("s9")];
        assert!(fold_set
            .validate()
            .unwrap_err()
            .to_string()
            .contains("unknown sample `s9`"));
    }

    #[test]
    fn nested_fold_sets_inherit_the_parent_train_exclusion() {
        let samples = (0..6).map(|i| sid(&format!("s{i}"))).collect::<Vec<_>>();
        let mut outer = KFoldSpec {
            n_splits: 2,
            shuffle: false,
            seed: None,
        }
        .split("outer", &samples)
        .unwrap();
        let spec = NestedCvSpec::KFold(KFoldSpec {
            n_splits: 2,
            shuffle: false,
            seed: None,
        });
        let relations = outer.nested_fold_set(&spec, &outer.folds[0]).unwrap();
        assert_eq!(
            relations.inner_fold_set.train_exclusion,
            FoldTrainExclusion::Relations
        );

        outer.train_exclusion = FoldTrainExclusion::FoldLocal;
        let nested = outer.nested_fold_set(&spec, &outer.folds[0]).unwrap();
        assert_eq!(
            nested.inner_fold_set.train_exclusion,
            FoldTrainExclusion::FoldLocal
        );
        nested.validate_for_outer(&outer.folds[0]).unwrap();
        // Everything but the inherited authority matches the plain splitter output.
        let mut plain = spec
            .build_nested_fold_set(&outer.folds[0], &outer.sample_groups)
            .unwrap();
        plain.inner_fold_set.train_exclusion = FoldTrainExclusion::FoldLocal;
        assert_eq!(nested, plain);
    }
}
