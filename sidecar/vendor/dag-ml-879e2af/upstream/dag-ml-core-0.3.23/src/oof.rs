use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::campaign::stable_json_fingerprint;
use crate::error::{DagMlError, OofLeakageReport, OofLeakageViolation, Result};
use crate::fold::{FoldAssignment, FoldPartitionMode, FoldSet};
use crate::ids::{FoldId, NodeId, SampleId};

pub const STACKING_OOF_REFIT_CONTRACT_METADATA_KEY: &str = "stacking_oof_refit_contract";

#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PredictionPartition {
    Train,
    Validation,
    Test,
    Final,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PredictionJoinKey {
    SampleId,
}

fn default_prediction_join_key() -> PredictionJoinKey {
    PredictionJoinKey::SampleId
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PredictionBlock {
    #[serde(default)]
    pub prediction_id: Option<String>,
    pub producer_node: NodeId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub producer_port: Option<String>,
    pub partition: PredictionPartition,
    pub fold_id: Option<FoldId>,
    pub sample_ids: Vec<SampleId>,
    pub values: Vec<Vec<f64>>,
    #[serde(default)]
    pub target_names: Vec<String>,
}

impl PredictionBlock {
    pub fn validate_shape(&self) -> Result<usize> {
        if self.sample_ids.len() != self.values.len() {
            return Err(DagMlError::OofValidation(format!(
                "producer `{}` has {} sample ids but {} prediction rows",
                self.producer_node,
                self.sample_ids.len(),
                self.values.len()
            )));
        }
        let width = self.values.first().map_or(0, Vec::len);
        if width == 0 {
            return Err(DagMlError::OofValidation(format!(
                "producer `{}` emitted empty prediction rows",
                self.producer_node
            )));
        }
        if self.values.iter().any(|row| row.len() != width) {
            return Err(DagMlError::OofValidation(format!(
                "producer `{}` emitted ragged prediction rows",
                self.producer_node
            )));
        }
        if !self.target_names.is_empty() && self.target_names.len() != width {
            return Err(DagMlError::OofValidation(format!(
                "producer `{}` has {} target names for width {}",
                self.producer_node,
                self.target_names.len(),
                width
            )));
        }
        Ok(width)
    }

    /// Mandatory, central content invariant for a prediction block — the single gate every
    /// path that *stores* or *scores* a `PredictionBlock` must pass through. It is a strict
    /// superset of [`validate_shape`](Self::validate_shape): it first checks dimensions/width,
    /// then enforces the two content invariants `validate_shape` does not — every prediction
    /// value must be finite (no `NaN`/`Inf`) and no `sample_id` may repeat within the block
    /// (a within-block duplicate double-counts in every identity-keyed reducer). A block that
    /// is already valid passes unchanged and returns the same `width`; only malformed or
    /// adversarial blocks are rejected.
    pub fn validate_content(&self) -> Result<usize> {
        let width = self.validate_shape()?;
        if self.values.iter().flatten().any(|value| !value.is_finite()) {
            return Err(DagMlError::OofValidation(format!(
                "producer `{}` emitted non-finite prediction values",
                self.producer_node
            )));
        }
        let mut seen = BTreeSet::new();
        for sample_id in &self.sample_ids {
            if !seen.insert(sample_id) {
                return Err(DagMlError::OofValidation(format!(
                    "producer `{}` emitted duplicate prediction for sample `{sample_id}`",
                    self.producer_node
                )));
            }
        }
        Ok(width)
    }
}

/// Mandatory, central OOF *coverage* invariant — the single gate every path that *concatenates a
/// producer's per-fold validation predictions into one out-of-fold set* must pass through. Spec
/// `COORDINATOR_SPEC.md` §"OOF And Leakage Rules" rule 3: every producer must provide **exactly one
/// validation prediction per requested sample** unless an explicit aggregation policy says otherwise.
///
/// The gate is [`FoldPartitionMode`]-aware, matching the same Partition/Resampled split that
/// [`FoldSet::validate`](crate::fold::FoldSet::validate) already enforces on the fold layout:
///
/// - **Partition** (KFold-style, the default): a clean out-of-fold partition. Every block passes
///   [`PredictionBlock::validate_content`] (shape, finite, no within-block dup) AND **uniqueness** —
///   no `sample_id` appears in more than one block (a cross-fold duplicate; the signature of either a
///   duplicated fold or, since [`PredictionBlock`] carries no variant tag, a run context that mixed
///   several variants — see audit R-P0-1). This is the central analogue of the runtime merge handler's
///   "the run context mixes several variants" guard, on the *scoring* path.
/// - **Resampled** (ShuffleSplit / repeated KFold / bootstrap): a sample may legitimately be validated
///   in several folds, so its OOF predictions are *aggregated* (averaged by
///   [`reduce_predictions_across_folds`](crate::aggregation::reduce_predictions_across_folds)). The
///   across-fold uniqueness check is therefore relaxed: a sample appearing in multiple blocks is
///   allowed. The per-block content gate (including within-block uniqueness via `validate_content`)
///   still runs, so a duplicate *within one fold's block* is still refused — only the cross-fold
///   multiplicity is permitted.
///
/// The "unless an explicit aggregation policy says otherwise" carve-out (the branch-merge concat
/// partition case, where each branch legitimately covers only its partition of samples) is handled by
/// the dedicated separation-merge runtime handler and partition-aware bundle group validators, which
/// never route a producer's raw cross-fold blocks through this gate — so this validator does not
/// over-reject those legitimate partial-partition merges.
///
/// `requested_samples`, when `Some`, additionally pins **completeness**: every requested sample must
/// have at least one validation prediction and no unexpected sample may be present. Under `Partition`,
/// combined with the uniqueness check above, this is exactly-once coverage; under `Resampled`, it is
/// at-least-once coverage (each requested sample covered, possibly several times). When `None`, only
/// the mode-appropriate uniqueness is enforced over whatever OOF the producer emitted (the cross-fold
/// scoring path, which scores over the producer's own OOF union and has no externally-fixed universe).
pub fn validate_producer_oof_coverage(
    producer_node: &NodeId,
    blocks: &[&PredictionBlock],
    partition_mode: FoldPartitionMode,
    requested_samples: Option<&BTreeSet<SampleId>>,
) -> Result<()> {
    let mut covered: BTreeSet<SampleId> = BTreeSet::new();
    for block in blocks {
        if block.partition != PredictionPartition::Validation {
            continue;
        }
        block.validate_content()?;
        for sample_id in &block.sample_ids {
            let first_time = covered.insert(sample_id.clone());
            // Partition is a clean OOF set: a sample seen twice across blocks is a duplicated fold or a
            // mixed-variant context, and is refused. Resampled aggregates a multiply-validated sample,
            // so a repeat across blocks is expected and allowed (within-block dups are still caught by
            // `validate_content` above).
            if !first_time && partition_mode == FoldPartitionMode::Partition {
                return Err(DagMlError::OofValidation(format!(
                    "producer `{producer_node}` emitted more than one validation prediction for sample `{sample_id}` — the OOF set is not unique (a duplicated fold, or a run context that mixed several variants); concatenate exactly one validation prediction per sample"
                )));
            }
        }
    }
    if let Some(requested) = requested_samples {
        if &covered != requested {
            let missing = requested.difference(&covered).count();
            let extra = covered.difference(requested).count();
            let expectation = match partition_mode {
                FoldPartitionMode::Partition => {
                    "exactly one validation prediction per requested sample is required"
                }
                FoldPartitionMode::Resampled => {
                    "every requested sample needs at least one validation prediction and no extra sample may appear"
                }
            };
            return Err(DagMlError::OofValidation(format!(
                "producer `{producer_node}` OOF coverage is not exact: {missing} requested sample(s) missing, {extra} unexpected sample(s) present — {expectation}"
            )));
        }
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StackingOofRefitPolicy {
    /// Default: a stacking meta-model may enter REFIT only when every upstream
    /// producer has validation OOF coverage for the complete refit sample
    /// universe.
    #[default]
    RequireFullCoverage,
    /// Explicit CV-only behavior: skip the REFIT task for this stacking node.
    CvOnly,
    /// Allow REFIT to be skipped when coverage is incomplete, while still
    /// rejecting malformed OOF blocks.
    SkipRefitOnIncompleteOof,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct StackingOofRefitContract {
    #[serde(default)]
    pub policy: StackingOofRefitPolicy,
}

impl Default for StackingOofRefitContract {
    fn default() -> Self {
        Self {
            policy: StackingOofRefitPolicy::RequireFullCoverage,
        }
    }
}

impl StackingOofRefitContract {
    pub fn from_metadata(metadata: &BTreeMap<String, Value>) -> Result<Self> {
        let Some(value) = metadata.get(STACKING_OOF_REFIT_CONTRACT_METADATA_KEY) else {
            return Ok(Self::default());
        };
        let contract = serde_json::from_value::<Self>(value.clone()).map_err(|error| {
            DagMlError::OofValidation(format!(
                "`{STACKING_OOF_REFIT_CONTRACT_METADATA_KEY}` must be an object with policy \
                 `require_full_coverage`, `cv_only` or `skip_refit_on_incomplete_oof`: {error}"
            ))
        })?;
        Ok(contract)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StackingOofRefitDecision {
    RefitAllowed(StackingOofRefitCoverageDiagnostic),
    SkipRefit(StackingOofRefitCoverageDiagnostic),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StackingOofRefitCause {
    FullCoverage,
    CvOnly,
    IncompleteOofCoverage,
    PartialOofWithoutPolicy,
    MissingFoldId,
    UnknownFold,
    FoldCoverageMismatch,
    DuplicateValidationSample,
    NonValidationPartition,
}

impl StackingOofRefitCause {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::FullCoverage => "full_coverage",
            Self::CvOnly => "cv_only",
            Self::IncompleteOofCoverage => "incomplete_oof_coverage",
            Self::PartialOofWithoutPolicy => "partial_oof_without_policy",
            Self::MissingFoldId => "missing_fold_id",
            Self::UnknownFold => "unknown_fold",
            Self::FoldCoverageMismatch => "fold_coverage_mismatch",
            Self::DuplicateValidationSample => "duplicate_validation_sample",
            Self::NonValidationPartition => "non_validation_partition",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct StackingOofRefitCoverageDiagnostic {
    pub policy: StackingOofRefitPolicy,
    pub cause: StackingOofRefitCause,
    pub requested_sample_count: usize,
    pub covered_sample_count: usize,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub missing_sample_ids: Vec<SampleId>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extra_sample_ids: Vec<SampleId>,
}

impl StackingOofRefitDecision {
    pub fn diagnostic(&self) -> &StackingOofRefitCoverageDiagnostic {
        match self {
            Self::RefitAllowed(diagnostic) | Self::SkipRefit(diagnostic) => diagnostic,
        }
    }

    pub fn should_skip_refit(&self) -> bool {
        matches!(self, Self::SkipRefit(_))
    }
}

pub fn validate_stacking_oof_refit_contract(
    producer_node: &NodeId,
    blocks: &[&PredictionBlock],
    fold_set: &FoldSet,
    contract: &StackingOofRefitContract,
) -> Result<StackingOofRefitDecision> {
    fold_set.validate()?;
    if contract.policy == StackingOofRefitPolicy::CvOnly {
        return Ok(StackingOofRefitDecision::SkipRefit(
            StackingOofRefitCoverageDiagnostic {
                policy: contract.policy,
                cause: StackingOofRefitCause::CvOnly,
                requested_sample_count: fold_set.sample_ids.len(),
                covered_sample_count: 0,
                missing_sample_ids: fold_set.sample_ids.clone(),
                extra_sample_ids: Vec::new(),
            },
        ));
    }

    let folds = fold_set
        .folds
        .iter()
        .map(|fold| (&fold.fold_id, fold))
        .collect::<BTreeMap<_, _>>();
    let mut covered = BTreeSet::new();
    for block in blocks {
        if block.partition != PredictionPartition::Validation {
            return Err(stacking_refit_contract_error(
                producer_node,
                StackingOofRefitCause::NonValidationPartition,
                format!(
                    "selected {:?} predictions for REFIT stacking; only validation OOF may train a meta-model",
                    block.partition
                ),
            ));
        }
        block.validate_content()?;
        let fold_id = block.fold_id.as_ref().ok_or_else(|| {
            stacking_refit_contract_error(
                producer_node,
                StackingOofRefitCause::MissingFoldId,
                "validation OOF block is missing fold_id".to_string(),
            )
        })?;
        let fold = folds.get(fold_id).ok_or_else(|| {
            stacking_refit_contract_error(
                producer_node,
                StackingOofRefitCause::UnknownFold,
                format!("validation OOF block references unknown fold `{fold_id}`"),
            )
        })?;
        validate_stacking_block_matches_fold(producer_node, block, fold)?;
        for sample_id in &block.sample_ids {
            if !covered.insert(sample_id.clone())
                && fold_set.partition_mode == FoldPartitionMode::Partition
            {
                return Err(stacking_refit_contract_error(
                    producer_node,
                    StackingOofRefitCause::DuplicateValidationSample,
                    format!(
                        "sample `{sample_id}` appears in validation OOF for more than one fold"
                    ),
                ));
            }
        }
    }

    let requested = fold_set.sample_ids.iter().cloned().collect::<BTreeSet<_>>();
    if covered == requested {
        return Ok(StackingOofRefitDecision::RefitAllowed(
            StackingOofRefitCoverageDiagnostic {
                policy: contract.policy,
                cause: StackingOofRefitCause::FullCoverage,
                requested_sample_count: requested.len(),
                covered_sample_count: covered.len(),
                missing_sample_ids: Vec::new(),
                extra_sample_ids: Vec::new(),
            },
        ));
    }

    let diagnostic = StackingOofRefitCoverageDiagnostic {
        policy: contract.policy,
        cause: match contract.policy {
            StackingOofRefitPolicy::SkipRefitOnIncompleteOof => {
                StackingOofRefitCause::IncompleteOofCoverage
            }
            StackingOofRefitPolicy::RequireFullCoverage => {
                StackingOofRefitCause::PartialOofWithoutPolicy
            }
            StackingOofRefitPolicy::CvOnly => StackingOofRefitCause::CvOnly,
        },
        requested_sample_count: requested.len(),
        covered_sample_count: covered.len(),
        missing_sample_ids: requested.difference(&covered).cloned().collect(),
        extra_sample_ids: covered.difference(&requested).cloned().collect(),
    };
    if contract.policy == StackingOofRefitPolicy::SkipRefitOnIncompleteOof {
        return Ok(StackingOofRefitDecision::SkipRefit(diagnostic));
    }
    Err(stacking_refit_contract_error(
        producer_node,
        diagnostic.cause,
        format!(
            "OOF predictions do not cover the refit sample universe: {} requested sample(s), {} covered, {} missing, {} extra",
            diagnostic.requested_sample_count,
            diagnostic.covered_sample_count,
            diagnostic.missing_sample_ids.len(),
            diagnostic.extra_sample_ids.len()
        ),
    ))
}

fn validate_stacking_block_matches_fold(
    producer_node: &NodeId,
    block: &PredictionBlock,
    fold: &FoldAssignment,
) -> Result<()> {
    let actual = block.sample_ids.iter().collect::<BTreeSet<_>>();
    let expected = fold.validation_sample_ids.iter().collect::<BTreeSet<_>>();
    if actual != expected {
        return Err(stacking_refit_contract_error(
            producer_node,
            StackingOofRefitCause::FoldCoverageMismatch,
            format!(
                "fold `{}` OOF samples do not match the fold validation samples",
                fold.fold_id
            ),
        ));
    }
    Ok(())
}

fn stacking_refit_contract_error(
    producer_node: &NodeId,
    cause: StackingOofRefitCause,
    detail: String,
) -> DagMlError {
    DagMlError::OofValidation(format!(
        "stacking OOF refit contract violation for producer `{producer_node}`: cause={}; {detail}",
        cause.as_str()
    ))
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct OofMatrix {
    pub sample_ids: Vec<SampleId>,
    pub columns: Vec<String>,
    pub values: Vec<Vec<f64>>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct OofCampaign {
    pub fold_set: FoldSet,
    pub join_policy: PredictionJoinPolicy,
    pub requested_sample_order: Vec<SampleId>,
    pub prediction_blocks: Vec<PredictionBlock>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct PredictionJoinPolicy {
    pub node_id: NodeId,
    #[serde(default = "default_prediction_join_key")]
    pub join_on: PredictionJoinKey,
    #[serde(default)]
    pub allow_train_predictions_as_features: bool,
    #[serde(default)]
    pub include_partitions: Vec<PredictionPartition>,
}

#[derive(Clone, Debug)]
struct ProducerPredictions {
    width: usize,
    target_names: Vec<String>,
    by_sample: BTreeMap<SampleId, Vec<f64>>,
}

pub fn join_oof_features(
    blocks: &[PredictionBlock],
    required_samples: &[SampleId],
) -> Result<OofMatrix> {
    validate_prediction_blocks_are_oof(
        &PredictionJoinPolicy {
            node_id: NodeId::new("prediction_join")?,
            join_on: PredictionJoinKey::SampleId,
            allow_train_predictions_as_features: false,
            include_partitions: vec![PredictionPartition::Validation],
        },
        blocks,
    )?;
    if required_samples.is_empty() {
        return Err(DagMlError::OofValidation(
            "required sample set is empty".to_string(),
        ));
    }

    let required = required_samples.iter().collect::<BTreeSet<_>>();
    if required.len() != required_samples.len() {
        return Err(DagMlError::OofValidation(
            "required sample set contains duplicates".to_string(),
        ));
    }

    let mut rows = required_samples
        .iter()
        .cloned()
        .map(|sample_id| (sample_id, Vec::<f64>::new()))
        .collect::<BTreeMap<_, _>>();
    let mut columns = Vec::new();

    for block in blocks {
        let width = block.validate_shape()?;
        let mut seen = BTreeSet::new();
        let mut by_sample = BTreeMap::new();
        for (sample_id, values) in block.sample_ids.iter().zip(block.values.iter()) {
            if !seen.insert(sample_id) {
                return Err(DagMlError::OofValidation(format!(
                    "producer `{}` emitted duplicate prediction for sample `{}`",
                    block.producer_node, sample_id
                )));
            }
            by_sample.insert(sample_id, values);
        }

        for sample_id in required_samples {
            let values = by_sample.get(sample_id).ok_or_else(|| {
                DagMlError::OofValidation(format!(
                    "producer `{}` is missing required sample `{}`",
                    block.producer_node, sample_id
                ))
            })?;
            rows.get_mut(sample_id)
                .expect("required sample row exists")
                .extend(values.iter().copied());
        }

        for column_idx in 0..width {
            let target = block
                .target_names
                .get(column_idx)
                .cloned()
                .unwrap_or_else(|| format!("p{column_idx}"));
            columns.push(format!("{}__{target}", block.producer_node));
        }
    }

    Ok(OofMatrix {
        sample_ids: required_samples.to_vec(),
        columns,
        values: required_samples
            .iter()
            .map(|sample_id| rows.remove(sample_id).expect("row exists"))
            .collect(),
    })
}

pub fn join_oof_campaign_features(
    policy: &PredictionJoinPolicy,
    blocks: &[PredictionBlock],
    required_samples: &[SampleId],
) -> Result<OofMatrix> {
    validate_prediction_blocks_are_oof(policy, blocks)?;
    ensure_required_samples(required_samples)?;

    let required = required_samples.iter().collect::<BTreeSet<_>>();
    let included_partitions = effective_partitions(policy);
    let mut producers = BTreeMap::<NodeId, ProducerPredictions>::new();

    for block in blocks {
        if !included_partitions.contains(&block.partition) {
            continue;
        }
        let width = block.validate_shape()?;
        let target_names = normalized_targets(block, width);
        let producer = producers
            .entry(block.producer_node.clone())
            .or_insert_with(|| ProducerPredictions {
                width,
                target_names: target_names.clone(),
                by_sample: BTreeMap::new(),
            });
        if producer.width != width {
            return Err(DagMlError::OofValidation(format!(
                "producer `{}` changed prediction width from {} to {}",
                block.producer_node, producer.width, width
            )));
        }
        if producer.target_names != target_names {
            return Err(DagMlError::OofValidation(format!(
                "producer `{}` changed target names across folds",
                block.producer_node
            )));
        }

        for (sample_id, values) in block.sample_ids.iter().zip(block.values.iter()) {
            if !required.contains(sample_id) {
                return Err(DagMlError::OofValidation(format!(
                    "producer `{}` emitted unexpected sample `{}`",
                    block.producer_node, sample_id
                )));
            }
            if producer
                .by_sample
                .insert(sample_id.clone(), values.clone())
                .is_some()
            {
                return Err(DagMlError::OofValidation(format!(
                    "producer `{}` emitted duplicate OOF prediction for sample `{}`",
                    block.producer_node, sample_id
                )));
            }
        }
    }

    if producers.is_empty() {
        return Err(DagMlError::OofValidation(
            "no prediction blocks were selected for OOF join".to_string(),
        ));
    }

    for (producer_node, producer) in &producers {
        for sample_id in required_samples {
            if !producer.by_sample.contains_key(sample_id) {
                return Err(DagMlError::OofValidation(format!(
                    "producer `{producer_node}` is missing required sample `{sample_id}`"
                )));
            }
        }
    }

    let producer_predictions = producers.into_iter().collect::<Vec<_>>();
    let columns = producer_predictions
        .iter()
        .flat_map(|(producer_node, producer)| {
            producer
                .target_names
                .iter()
                .map(move |target| format!("{producer_node}__{target}"))
        })
        .collect::<Vec<_>>();
    let values = required_samples
        .iter()
        .map(|sample_id| {
            let mut row = Vec::new();
            for (_producer_node, producer) in &producer_predictions {
                row.extend(
                    producer
                        .by_sample
                        .get(sample_id)
                        .expect("required sample was checked")
                        .iter()
                        .copied(),
                );
            }
            row
        })
        .collect::<Vec<_>>();

    Ok(OofMatrix {
        sample_ids: required_samples.to_vec(),
        columns,
        values,
    })
}

pub fn validate_oof_campaign(campaign: &OofCampaign) -> Result<OofMatrix> {
    campaign.fold_set.validate()?;
    validate_requested_samples_match_fold_set(
        &campaign.requested_sample_order,
        &campaign.fold_set,
    )?;
    validate_prediction_blocks_against_folds(&campaign.fold_set, &campaign.prediction_blocks)?;
    join_oof_campaign_features(
        &campaign.join_policy,
        &campaign.prediction_blocks,
        &campaign.requested_sample_order,
    )
}

pub fn oof_campaign_fingerprint(campaign: &OofCampaign) -> Result<String> {
    campaign.fold_set.validate()?;
    validate_requested_samples_match_fold_set(
        &campaign.requested_sample_order,
        &campaign.fold_set,
    )?;
    validate_prediction_blocks_against_folds(&campaign.fold_set, &campaign.prediction_blocks)?;
    stable_json_fingerprint(campaign)
}

pub fn validate_prediction_blocks_against_folds(
    fold_set: &FoldSet,
    blocks: &[PredictionBlock],
) -> Result<()> {
    fold_set.validate()?;
    let folds = fold_set
        .folds
        .iter()
        .map(|fold| (&fold.fold_id, fold))
        .collect::<BTreeMap<_, _>>();
    for block in blocks {
        block.validate_shape()?;
        let Some(fold_id) = &block.fold_id else {
            if matches!(
                block.partition,
                PredictionPartition::Train | PredictionPartition::Validation
            ) {
                return Err(DagMlError::OofValidation(format!(
                    "producer `{}` emitted {:?} predictions without fold_id",
                    block.producer_node, block.partition
                )));
            }
            continue;
        };
        let fold = folds.get(fold_id).ok_or_else(|| {
            DagMlError::OofValidation(format!(
                "producer `{}` references unknown fold `{fold_id}`",
                block.producer_node
            ))
        })?;
        match block.partition {
            PredictionPartition::Train => {
                assert_exact_partition_samples(block, &fold.train_sample_ids, "train")?
            }
            PredictionPartition::Validation => {
                assert_exact_partition_samples(block, &fold.validation_sample_ids, "validation")?
            }
            PredictionPartition::Test | PredictionPartition::Final => {}
        }
    }
    Ok(())
}

pub fn validate_prediction_blocks_are_oof(
    policy: &PredictionJoinPolicy,
    blocks: &[PredictionBlock],
) -> Result<()> {
    if policy.allow_train_predictions_as_features {
        return Ok(());
    }
    let violators = blocks
        .iter()
        .filter(|block| block.partition != PredictionPartition::Validation)
        .map(|block| OofLeakageViolation {
            producer_node: block.producer_node.to_string(),
            partition: format!("{:?}", block.partition).to_lowercase(),
            fold_id: block.fold_id.as_ref().map(ToString::to_string),
        })
        .collect::<Vec<_>>();
    if violators.is_empty() {
        Ok(())
    } else {
        crate::observability::emit_oof_refusal(policy.node_id.as_str(), violators.len());
        Err(DagMlError::OofLeakage(Box::new(OofLeakageReport {
            node_id: policy.node_id.to_string(),
            violators,
            allow_train_predictions_as_features: policy.allow_train_predictions_as_features,
            remediation: "Use only OOF validation predictions as training features, or explicitly set allow_train_predictions_as_features=true for an unsafe run.".to_string(),
        })))
    }
}

fn validate_requested_samples_match_fold_set(
    requested_sample_order: &[SampleId],
    fold_set: &FoldSet,
) -> Result<()> {
    ensure_required_samples(requested_sample_order)?;
    let requested = requested_sample_order.iter().collect::<BTreeSet<_>>();
    let expected = fold_set.sample_ids.iter().collect::<BTreeSet<_>>();
    if requested != expected {
        return Err(DagMlError::OofValidation(
            "requested sample order does not match fold-set sample universe".to_string(),
        ));
    }
    Ok(())
}

fn assert_exact_partition_samples(
    block: &PredictionBlock,
    expected_samples: &[SampleId],
    partition_name: &str,
) -> Result<()> {
    let actual = unique_block_samples(block)?;
    let expected = expected_samples.iter().collect::<BTreeSet<_>>();
    if actual != expected {
        return Err(DagMlError::OofValidation(format!(
            "producer `{}` fold `{}` {} predictions do not match fold {} samples",
            block.producer_node,
            block.fold_id.as_ref().expect("fold id exists"),
            partition_name,
            partition_name
        )));
    }
    Ok(())
}

fn unique_block_samples(block: &PredictionBlock) -> Result<BTreeSet<&SampleId>> {
    let mut seen = BTreeSet::new();
    for sample_id in &block.sample_ids {
        if !seen.insert(sample_id) {
            return Err(DagMlError::OofValidation(format!(
                "producer `{}` emitted duplicate prediction for sample `{sample_id}`",
                block.producer_node
            )));
        }
    }
    Ok(seen)
}

fn ensure_required_samples(required_samples: &[SampleId]) -> Result<()> {
    if required_samples.is_empty() {
        return Err(DagMlError::OofValidation(
            "required sample set is empty".to_string(),
        ));
    }
    let required = required_samples.iter().collect::<BTreeSet<_>>();
    if required.len() != required_samples.len() {
        return Err(DagMlError::OofValidation(
            "required sample set contains duplicates".to_string(),
        ));
    }
    Ok(())
}

fn effective_partitions(policy: &PredictionJoinPolicy) -> BTreeSet<PredictionPartition> {
    if policy.include_partitions.is_empty() {
        BTreeSet::from([PredictionPartition::Validation])
    } else {
        policy.include_partitions.iter().cloned().collect()
    }
}

fn normalized_targets(block: &PredictionBlock, width: usize) -> Vec<String> {
    if block.target_names.is_empty() {
        (0..width)
            .map(|column_idx| format!("p{column_idx}"))
            .collect()
    } else {
        block.target_names.clone()
    }
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use super::*;

    fn sid(value: &str) -> SampleId {
        SampleId::new(value).unwrap()
    }

    fn producer() -> NodeId {
        NodeId::new("model:base").unwrap()
    }

    fn block(partition: PredictionPartition) -> PredictionBlock {
        PredictionBlock {
            prediction_id: None,
            producer_node: producer(),
            producer_port: None,
            partition,
            fold_id: Some(FoldId::new("fold0").unwrap()),
            sample_ids: vec![sid("s2"), sid("s1")],
            values: vec![vec![20.0], vec![10.0]],
            target_names: vec!["y".to_string()],
        }
    }

    fn campaign_block(producer_node: &str, fold_id: &str, samples: &[&str]) -> PredictionBlock {
        PredictionBlock {
            prediction_id: None,
            producer_node: NodeId::new(producer_node).unwrap(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new(fold_id).unwrap()),
            sample_ids: samples.iter().copied().map(sid).collect(),
            values: samples
                .iter()
                .map(|sample_id| {
                    let suffix = sample_id.trim_start_matches('s').parse::<f64>().unwrap();
                    vec![suffix]
                })
                .collect(),
            target_names: vec!["y".to_string()],
        }
    }

    fn contract_fold_set() -> FoldSet {
        FoldSet {
            id: "folds:stacking.contract".to_string(),
            sample_ids: ["s1", "s2", "s3", "s4"].iter().map(|s| sid(s)).collect(),
            folds: vec![
                FoldAssignment {
                    fold_id: FoldId::new("fold0").unwrap(),
                    train_sample_ids: ["s3", "s4"].iter().map(|s| sid(s)).collect(),
                    validation_sample_ids: ["s1", "s2"].iter().map(|s| sid(s)).collect(),
                    metadata: BTreeMap::new(),
                },
                FoldAssignment {
                    fold_id: FoldId::new("fold1").unwrap(),
                    train_sample_ids: ["s1", "s2"].iter().map(|s| sid(s)).collect(),
                    validation_sample_ids: ["s3", "s4"].iter().map(|s| sid(s)).collect(),
                    metadata: BTreeMap::new(),
                },
            ],
            sample_groups: BTreeMap::new(),
            partition_mode: FoldPartitionMode::Partition,
        }
    }

    fn load_fixture(source: &str) -> OofCampaign {
        serde_json::from_str(source).unwrap()
    }

    #[test]
    fn aligns_oof_by_sample_id_not_position() {
        let joined = join_oof_features(
            &[block(PredictionPartition::Validation)],
            &[sid("s1"), sid("s2")],
        )
        .unwrap();

        assert_eq!(joined.values, vec![vec![10.0], vec![20.0]]);
        assert_eq!(joined.columns, vec!["model:base__y"]);
    }

    #[test]
    fn rejects_train_predictions_as_training_features() {
        let err = join_oof_features(
            &[block(PredictionPartition::Train)],
            &[sid("s1"), sid("s2")],
        )
        .unwrap_err();

        match err {
            DagMlError::OofLeakage(report) => {
                assert_eq!(report.violators[0].producer_node, "model:base");
                assert_eq!(report.violators[0].partition, "train");
            }
            other => panic!("expected OOF leakage error, got {other:?}"),
        }
    }

    #[test]
    fn rejects_duplicate_samples() {
        let mut duplicate = block(PredictionPartition::Validation);
        duplicate.sample_ids = vec![sid("s1"), sid("s1")];

        assert!(join_oof_features(&[duplicate], &[sid("s1")]).is_err());
    }

    #[test]
    fn validate_content_passes_valid_block_unchanged() {
        let valid = block(PredictionPartition::Validation);
        // A valid block passes both gates with the same width — behavior is unchanged.
        assert_eq!(
            valid.validate_content().unwrap(),
            valid.validate_shape().unwrap()
        );
    }

    #[test]
    fn validate_content_rejects_non_finite_values() {
        for poison in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            let mut tainted = block(PredictionPartition::Validation);
            tainted.values = vec![vec![poison], vec![10.0]];
            // validate_shape still accepts it (dimensions only); validate_content must reject it.
            assert!(tainted.validate_shape().is_ok());
            let err = tainted.validate_content().unwrap_err();
            assert!(err.to_string().contains("non-finite"), "got: {err}");
        }
    }

    #[test]
    fn validate_content_rejects_duplicate_sample_id() {
        let mut dup = block(PredictionPartition::Validation);
        dup.sample_ids = vec![sid("s1"), sid("s1")];
        // Dimensions match, so validate_shape accepts; validate_content must reject the duplicate.
        assert!(dup.validate_shape().is_ok());
        let err = dup.validate_content().unwrap_err();
        assert!(
            err.to_string().contains("duplicate prediction"),
            "got: {err}"
        );
    }

    #[test]
    fn producer_oof_coverage_accepts_disjoint_folds() {
        // Two folds of one producer, disjoint OOF samples — exactly one validation prediction per
        // sample. This is the well-formed single-variant case and must pass unchanged.
        let f0 = campaign_block("model:pls", "fold0", &["s1", "s2"]);
        let f1 = campaign_block("model:pls", "fold1", &["s3", "s4"]);
        let producer = NodeId::new("model:pls").unwrap();
        validate_producer_oof_coverage(&producer, &[&f0, &f1], FoldPartitionMode::Partition, None)
            .unwrap();
        // With the requested universe pinned, exact coverage also passes.
        let requested = ["s1", "s2", "s3", "s4"].iter().map(|s| sid(s)).collect();
        validate_producer_oof_coverage(
            &producer,
            &[&f0, &f1],
            FoldPartitionMode::Partition,
            Some(&requested),
        )
        .unwrap();
    }

    #[test]
    fn producer_oof_coverage_resampled_allows_multiply_validated_sample() {
        // ShuffleSplit / repeated CV (Resampled): the SAME sample `s1` is legitimately validated in
        // two folds — its OOF predictions are aggregated (averaged) downstream. The Partition uniqueness
        // gate would reject this; the Resampled mode must accept it. Coverage stays exact over the
        // requested universe (at-least-once for every requested sample, no extras).
        let f0 = campaign_block("model:pls", "fold0", &["s1", "s2"]);
        let f1 = campaign_block("model:pls", "fold1", &["s1", "s3"]);
        let producer = NodeId::new("model:pls").unwrap();
        validate_producer_oof_coverage(&producer, &[&f0, &f1], FoldPartitionMode::Resampled, None)
            .unwrap();
        let requested = ["s1", "s2", "s3"].iter().map(|s| sid(s)).collect();
        validate_producer_oof_coverage(
            &producer,
            &[&f0, &f1],
            FoldPartitionMode::Resampled,
            Some(&requested),
        )
        .unwrap();
    }

    #[test]
    fn producer_oof_coverage_resampled_still_rejects_within_block_duplicate() {
        // Even in Resampled mode, a duplicate WITHIN one fold's block is a double-count and stays
        // refused by the per-block content gate (only ACROSS-fold multiplicity is relaxed).
        let mut f0 = campaign_block("model:pls", "fold0", &["s1", "s2"]);
        f0.sample_ids = vec![sid("s1"), sid("s1")];
        let producer = NodeId::new("model:pls").unwrap();
        let err =
            validate_producer_oof_coverage(&producer, &[&f0], FoldPartitionMode::Resampled, None)
                .unwrap_err();
        assert!(
            err.to_string().contains("duplicate prediction"),
            "got: {err}"
        );
    }

    #[test]
    fn producer_oof_coverage_resampled_requires_at_least_once_coverage() {
        // Resampled relaxes uniqueness but still demands completeness: a requested sample with NO
        // validation prediction is refused.
        let f0 = campaign_block("model:pls", "fold0", &["s1", "s2"]);
        let producer = NodeId::new("model:pls").unwrap();
        let missing: BTreeSet<SampleId> = ["s1", "s2", "s3"].iter().map(|s| sid(s)).collect();
        let err = validate_producer_oof_coverage(
            &producer,
            &[&f0],
            FoldPartitionMode::Resampled,
            Some(&missing),
        )
        .unwrap_err();
        assert!(err.to_string().contains("not exact"), "got: {err}");
    }

    #[test]
    fn producer_oof_coverage_rejects_cross_fold_duplicate_sample() {
        // The SAME sample `s1` appears in two of this producer's blocks — the signature of a
        // duplicated fold or a context that mixed several variants (PredictionBlock carries no variant
        // tag). The central gate must refuse this rather than let it be silently double-counted.
        let f0 = campaign_block("model:pls", "fold0", &["s1", "s2"]);
        let f1 = campaign_block("model:pls", "fold1", &["s1", "s3"]);
        let producer = NodeId::new("model:pls").unwrap();
        let err = validate_producer_oof_coverage(
            &producer,
            &[&f0, &f1],
            FoldPartitionMode::Partition,
            None,
        )
        .unwrap_err();
        assert!(
            err.to_string().contains("not unique")
                && err.to_string().contains("mixed several variants"),
            "got: {err}"
        );
    }

    #[test]
    fn producer_oof_coverage_requested_universe_is_exact() {
        // Coverage must equal the requested universe exactly: a missing or extra sample is refused.
        let f0 = campaign_block("model:pls", "fold0", &["s1", "s2"]);
        let producer = NodeId::new("model:pls").unwrap();
        let missing: BTreeSet<SampleId> = ["s1", "s2", "s3"].iter().map(|s| sid(s)).collect();
        let err = validate_producer_oof_coverage(
            &producer,
            &[&f0],
            FoldPartitionMode::Partition,
            Some(&missing),
        )
        .unwrap_err();
        assert!(err.to_string().contains("not exact"), "got: {err}");
    }

    #[test]
    fn producer_oof_coverage_ignores_non_validation_blocks() {
        // Train/Test/Final blocks are not OOF validation predictions and are skipped by the gate.
        let mut train = campaign_block("model:pls", "fold0", &["s1"]);
        train.partition = PredictionPartition::Train;
        let val = campaign_block("model:pls", "fold1", &["s1"]);
        let producer = NodeId::new("model:pls").unwrap();
        // s1 appears in a train block AND a validation block — only the validation one counts, so this
        // is unique and accepted.
        validate_producer_oof_coverage(
            &producer,
            &[&train, &val],
            FoldPartitionMode::Partition,
            None,
        )
        .unwrap();
    }

    #[test]
    fn stacking_oof_refit_contract_allows_full_coverage() {
        let fold_set = contract_fold_set();
        let f0 = campaign_block("model:pls", "fold0", &["s1", "s2"]);
        let f1 = campaign_block("model:pls", "fold1", &["s3", "s4"]);
        let producer = NodeId::new("model:pls").unwrap();

        let decision = validate_stacking_oof_refit_contract(
            &producer,
            &[&f0, &f1],
            &fold_set,
            &StackingOofRefitContract::default(),
        )
        .unwrap();

        match decision {
            StackingOofRefitDecision::RefitAllowed(diagnostic) => {
                assert_eq!(diagnostic.cause, StackingOofRefitCause::FullCoverage);
                assert_eq!(diagnostic.requested_sample_count, 4);
                assert_eq!(diagnostic.covered_sample_count, 4);
            }
            other => panic!("full OOF coverage must allow refit, got {other:?}"),
        }
    }

    #[test]
    fn stacking_oof_refit_contract_rejects_partial_without_policy() {
        let fold_set = contract_fold_set();
        let f0 = campaign_block("model:pls", "fold0", &["s1", "s2"]);
        let producer = NodeId::new("model:pls").unwrap();

        let error = validate_stacking_oof_refit_contract(
            &producer,
            &[&f0],
            &fold_set,
            &StackingOofRefitContract::default(),
        )
        .unwrap_err()
        .to_string();

        assert!(error.contains("cause=partial_oof_without_policy"));
        assert!(error.contains("do not cover the refit sample universe"));
    }

    #[test]
    fn stacking_oof_refit_contract_skips_incomplete_when_explicit() {
        let fold_set = contract_fold_set();
        let f0 = campaign_block("model:pls", "fold0", &["s1", "s2"]);
        let producer = NodeId::new("model:pls").unwrap();
        let contract = StackingOofRefitContract {
            policy: StackingOofRefitPolicy::SkipRefitOnIncompleteOof,
        };

        let decision =
            validate_stacking_oof_refit_contract(&producer, &[&f0], &fold_set, &contract).unwrap();

        match decision {
            StackingOofRefitDecision::SkipRefit(diagnostic) => {
                assert_eq!(
                    diagnostic.cause,
                    StackingOofRefitCause::IncompleteOofCoverage
                );
                assert_eq!(diagnostic.covered_sample_count, 2);
                assert_eq!(diagnostic.missing_sample_ids, vec![sid("s3"), sid("s4")]);
            }
            other => panic!("partial OOF with explicit skip policy must skip refit, got {other:?}"),
        }
    }

    #[test]
    fn stacking_oof_refit_contract_cv_only_skips_without_oof() {
        let fold_set = contract_fold_set();
        let producer = NodeId::new("model:pls").unwrap();
        let contract = StackingOofRefitContract {
            policy: StackingOofRefitPolicy::CvOnly,
        };

        let decision =
            validate_stacking_oof_refit_contract(&producer, &[], &fold_set, &contract).unwrap();

        match decision {
            StackingOofRefitDecision::SkipRefit(diagnostic) => {
                assert_eq!(diagnostic.cause, StackingOofRefitCause::CvOnly);
                assert_eq!(diagnostic.missing_sample_ids, fold_set.sample_ids);
            }
            other => panic!("cv_only stacking policy must skip refit, got {other:?}"),
        }
    }

    #[test]
    fn stacking_oof_refit_contract_rejects_invalid_oof_even_with_skip_policy() {
        let fold_set = contract_fold_set();
        let mut f0 = campaign_block("model:pls", "fold0", &["s1", "s2"]);
        f0.partition = PredictionPartition::Train;
        let producer = NodeId::new("model:pls").unwrap();
        let contract = StackingOofRefitContract {
            policy: StackingOofRefitPolicy::SkipRefitOnIncompleteOof,
        };

        let error = validate_stacking_oof_refit_contract(&producer, &[&f0], &fold_set, &contract)
            .unwrap_err()
            .to_string();

        assert!(error.contains("cause=non_validation_partition"));
    }

    #[test]
    fn joins_fold_blocks_by_producer_for_campaigns() {
        let mut b1_fold0 = campaign_block("branch:b1.model:rf", "fold0", &["s4", "s1"]);
        b1_fold0.values = vec![vec![40.0], vec![10.0]];
        let mut b1_fold1 = campaign_block("branch:b1.model:rf", "fold1", &["s2", "s3"]);
        b1_fold1.values = vec![vec![20.0], vec![30.0]];
        let mut b0_fold0 = campaign_block("branch:b0.model:pls", "fold0", &["s4", "s1"]);
        b0_fold0.values = vec![vec![4.0], vec![1.0]];
        let mut b0_fold1 = campaign_block("branch:b0.model:pls", "fold1", &["s2", "s3"]);
        b0_fold1.values = vec![vec![2.0], vec![3.0]];

        let joined = join_oof_campaign_features(
            &PredictionJoinPolicy {
                node_id: NodeId::new("merge:pred").unwrap(),
                join_on: PredictionJoinKey::SampleId,
                allow_train_predictions_as_features: false,
                include_partitions: vec![PredictionPartition::Validation],
            },
            &[b1_fold0, b1_fold1, b0_fold0, b0_fold1],
            &[sid("s1"), sid("s2"), sid("s3"), sid("s4")],
        )
        .unwrap();

        assert_eq!(
            joined.columns,
            vec!["branch:b0.model:pls__y", "branch:b1.model:rf__y"]
        );
        assert_eq!(
            joined.values,
            vec![
                vec![1.0, 10.0],
                vec![2.0, 20.0],
                vec![3.0, 30.0],
                vec![4.0, 40.0]
            ]
        );
    }

    #[test]
    fn uc6_fixture_joins_successfully() {
        let fixture = load_fixture(include_str!(
            "../tests/fixtures/package/oof/uc6_oof_success_predictions.json"
        ));

        let joined = validate_oof_campaign(&fixture).unwrap();
        assert_eq!(
            oof_campaign_fingerprint(&fixture).unwrap(),
            oof_campaign_fingerprint(&fixture).unwrap()
        );

        assert_eq!(joined.columns.len(), 3);
        assert_eq!(joined.values[0], vec![1.0, 10.0, 100.0]);
        assert_eq!(joined.values[5], vec![6.0, 60.0, 600.0]);
    }

    #[test]
    fn uc11_fixture_refuses_train_predictions() {
        let fixture = load_fixture(include_str!(
            "../tests/fixtures/package/oof/uc11_train_prediction_refusal.json"
        ));

        let err = validate_oof_campaign(&fixture).unwrap_err();

        match err {
            DagMlError::OofLeakage(report) => {
                assert_eq!(report.node_id, "merge:pred");
                assert!(!report.allow_train_predictions_as_features);
                assert_eq!(report.violators.len(), 1);
                assert_eq!(report.violators[0].partition, "train");
            }
            other => panic!("expected OOF leakage error, got {other:?}"),
        }
    }

    #[test]
    fn fold_validation_rejects_wrong_validation_partition_samples() {
        let mut fixture = load_fixture(include_str!(
            "../tests/fixtures/package/oof/uc6_oof_success_predictions.json"
        ));
        fixture.prediction_blocks[0].sample_ids = vec![sid("S001"), sid("S002")];

        let err = validate_oof_campaign(&fixture).unwrap_err();

        assert!(err
            .to_string()
            .contains("do not match fold validation samples"));
    }

    #[test]
    #[ignore = "perf sanity probe; run with --release --ignored --nocapture"]
    fn oof_join_large_campaign_under_1500ms() {
        let sample_count = 12_000usize;
        let producer_count = 4usize;
        let fold_count = 6usize;
        let required_samples = (0..sample_count)
            .map(|sample_idx| sid(&format!("s{sample_idx:05}")))
            .collect::<Vec<_>>();
        let mut blocks = Vec::new();

        for producer_idx in 0..producer_count {
            for fold_idx in 0..fold_count {
                let sample_ids = (fold_idx..sample_count)
                    .step_by(fold_count)
                    .map(|sample_idx| sid(&format!("s{sample_idx:05}")))
                    .collect::<Vec<_>>();
                let values = (fold_idx..sample_count)
                    .step_by(fold_count)
                    .map(|sample_idx| vec![producer_idx as f64, sample_idx as f64])
                    .collect::<Vec<_>>();
                blocks.push(PredictionBlock {
                    prediction_id: None,
                    producer_node: NodeId::new(format!("model:p{producer_idx}")).unwrap(),
                    producer_port: None,
                    partition: PredictionPartition::Validation,
                    fold_id: Some(FoldId::new(format!("fold:{fold_idx}")).unwrap()),
                    sample_ids,
                    values,
                    target_names: vec!["score".to_string(), "rank".to_string()],
                });
            }
        }

        let started = Instant::now();
        let joined = join_oof_campaign_features(
            &PredictionJoinPolicy {
                node_id: NodeId::new("merge:perf").unwrap(),
                join_on: PredictionJoinKey::SampleId,
                allow_train_predictions_as_features: false,
                include_partitions: vec![PredictionPartition::Validation],
            },
            &blocks,
            &required_samples,
        )
        .unwrap();
        let elapsed = started.elapsed();

        assert_eq!(joined.sample_ids.len(), sample_count);
        assert_eq!(joined.columns.len(), producer_count * 2);
        assert!(
            elapsed <= Duration::from_millis(1_500),
            "large OOF join took {elapsed:?}"
        );
    }
}
