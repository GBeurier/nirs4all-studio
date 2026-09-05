use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::campaign::stable_json_fingerprint;
use crate::error::{DagMlError, Result};
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
    /// Group-aware inner K-fold, built in-core from outer-train sample groups.
    #[serde(rename = "group_kfold")]
    GroupKFold(GroupKFoldSpec),
    /// Target-stratified inner K-fold, with labels bound to stable sample ids.
    #[serde(rename = "stratified_kfold")]
    StratifiedKFold(StratifiedNestedCvSpec),
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
        let inner_id = format!("{}.inner", outer.fold_id);
        let mut inner = match self {
            Self::KFold(spec) => spec.split(inner_id, &outer.train_sample_ids)?,
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
        };
        resampled.validate().unwrap(); // overlapping / incomplete validation is allowed

        // The leakage guard (train ∩ validation per fold) still holds in Resampled mode.
        let leaky = FoldSet {
            id: "leaky".to_string(),
            sample_ids: vec![sid("s1"), sid("s2")],
            folds: vec![fold("f", &["s1"], &["s1"])],
            sample_groups: BTreeMap::new(),
            partition_mode: FoldPartitionMode::Resampled,
        };
        assert!(
            leaky.validate().is_err(),
            "Resampled must still reject train/validation overlap"
        );
    }
}
