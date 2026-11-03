use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::aggregation::{
    reduce_predictions_across_folds, AggregatedPredictionBlock, PredictionUnitId,
};
use crate::error::{DagMlError, Result};
use crate::fold::FoldPartitionMode;
use crate::ids::{FoldId, NodeId, SampleId, VariantId};
use crate::metric_provider::{
    builtin_metric_reference, builtin_metric_registry, MetricEvaluationScope, MetricEvaluationTask,
    MetricUnitId,
};
use crate::oof::{validate_producer_oof_coverage, PredictionBlock, PredictionPartition};
use crate::policy::PredictionLevel;
use crate::runtime::ClassificationProbabilityBlock;
use crate::selection::{CandidateScore, MetricObjective};
use crate::{LearningTaskKind, PredictionKind};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RegressionMetricKind {
    Mse,
    Rmse,
    Mae,
    R2,
    /// Classification accuracy: fraction of predictions whose label matches the target (integer
    /// label encoding, matched after rounding both labels). Meaningless on continuous regression targets (≈0) but
    /// always emitted so the host can score classification natively without a separate code path.
    Accuracy,
    /// Balanced classification accuracy: the macro-average of per-class recall (mean over the
    /// classes *present in `y_true`* of `correct_in_class / count_in_class`), matching scikit-learn's
    /// `balanced_accuracy_score`. This is nirs4all's DEFAULT classification ranking metric (its
    /// `_resolve_effective_metric` returns `balanced_accuracy` for a classification candidate), so it
    /// must be emitted natively for the dag-ml engine to reproduce the legacy classification
    /// `cv_best_score`. On a class-collapsed predictor it can be far below plain `accuracy`; on a
    /// continuous regression target it is meaningless (≈ chance) but always emitted, like `accuracy`.
    BalancedAccuracy,
    /// Support-weighted per-class F1, matching sklearn's `average="weighted"`.
    F1,
}

impl RegressionMetricKind {
    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "mse" => Some(Self::Mse),
            "rmse" => Some(Self::Rmse),
            "mae" => Some(Self::Mae),
            "r2" => Some(Self::R2),
            "accuracy" => Some(Self::Accuracy),
            "balanced_accuracy" => Some(Self::BalancedAccuracy),
            "f1" => Some(Self::F1),
            _ => None,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Mse => "mse",
            Self::Rmse => "rmse",
            Self::Mae => "mae",
            Self::R2 => "r2",
            Self::Accuracy => "accuracy",
            Self::BalancedAccuracy => "balanced_accuracy",
            Self::F1 => "f1",
        }
    }

    pub fn objective(self) -> MetricObjective {
        match self {
            Self::Mse | Self::Rmse | Self::Mae => MetricObjective::Minimize,
            Self::R2 | Self::Accuracy | Self::BalancedAccuracy | Self::F1 => {
                MetricObjective::Maximize
            }
        }
    }

    /// Resolve and validate the canonical metric/objective/output-kind matrix
    /// shared by training request projection, native execution, and standalone
    /// outcome verification.
    pub fn resolve_for_prediction_kind(
        name: &str,
        objective: MetricObjective,
        prediction_kind: crate::training::PredictionKind,
    ) -> Result<Self> {
        let metric = Self::from_name(name).ok_or_else(|| {
            DagMlError::CampaignValidation(format!("unsupported native selection metric `{name}`"))
        })?;
        let kind_compatible = match prediction_kind {
            crate::training::PredictionKind::RegressionPoint => {
                matches!(metric, Self::Mse | Self::Rmse | Self::Mae | Self::R2)
            }
            crate::training::PredictionKind::ClassLabel => {
                matches!(metric, Self::Accuracy | Self::BalancedAccuracy | Self::F1)
            }
            crate::training::PredictionKind::ClassProbability
            | crate::training::PredictionKind::DecisionScore => false,
        };
        if objective != metric.objective() || !kind_compatible {
            return Err(DagMlError::CampaignValidation(format!(
                "selection metric `{name}` with objective {objective:?} is not supported for {prediction_kind:?} output"
            )));
        }
        Ok(metric)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegressionTargetBlock {
    pub level: PredictionLevel,
    pub unit_ids: Vec<PredictionUnitId>,
    pub values: Vec<Vec<f64>>,
    /// Sample-major validity: true means observed; absent means every cell is observed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub validity_masks: Option<Vec<Vec<bool>>>,
    #[serde(default)]
    pub target_names: Vec<String>,
}

impl RegressionTargetBlock {
    pub fn validate_shape(&self) -> Result<usize> {
        if self.unit_ids.len() != self.values.len() {
            return Err(DagMlError::OofValidation(format!(
                "target block has {} unit ids but {} target rows",
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
                "target block contains units outside level {:?}",
                self.level
            )));
        }
        let unique = self.unit_ids.iter().collect::<BTreeSet<_>>();
        if unique.len() != self.unit_ids.len() {
            return Err(DagMlError::OofValidation(
                "target block contains duplicate unit ids".to_string(),
            ));
        }
        let width = self.values.first().map_or(0, Vec::len);
        if width == 0 {
            return Err(DagMlError::OofValidation(
                "target block has empty target rows".to_string(),
            ));
        }
        if self.values.iter().any(|row| row.len() != width) {
            return Err(DagMlError::OofValidation(
                "target block has ragged target rows".to_string(),
            ));
        }
        if let Some(masks) = &self.validity_masks {
            if masks.len() != self.values.len() || masks.iter().any(|row| row.len() != width) {
                return Err(DagMlError::OofValidation(
                    "target validity_masks shape must match target values (sample-major)"
                        .to_string(),
                ));
            }
        }
        if self.values.iter().flatten().any(|value| !value.is_finite()) {
            return Err(DagMlError::OofValidation(
                "target block contains non-finite values".to_string(),
            ));
        }
        if !self.target_names.is_empty() && self.target_names.len() != width {
            return Err(DagMlError::OofValidation(format!(
                "target block has {} target names for width {}",
                self.target_names.len(),
                width
            )));
        }
        Ok(width)
    }

    pub(crate) fn has_missing_values(&self) -> bool {
        self.validity_masks
            .as_ref()
            .is_some_and(|masks| masks.iter().flatten().any(|observed| !observed))
    }

    /// Canonical finite transport for hidden labels, without changing identity or row coverage.
    pub(crate) fn canonicalized(&self) -> Result<Self> {
        self.validate_shape()?;
        let mut block = self.clone();
        if let Some(masks) = &block.validity_masks {
            for (row, mask) in block.values.iter_mut().zip(masks) {
                for (value, observed) in row.iter_mut().zip(mask) {
                    if !observed {
                        *value = 0.0;
                    }
                }
            }
        }
        Ok(block)
    }

    pub(crate) fn require_complete_targets(&self, operation: &str) -> Result<()> {
        self.validate_shape()?;
        if self.has_missing_values() {
            return Err(DagMlError::OofValidation(format!(
                "masked regression targets are unsupported for {operation}; use sample-level scoring without prediction merges"
            )));
        }
        Ok(())
    }
}

/// Mandatory, central *merge target-coverage* invariant — the single gate every merge reassembly
/// handler (separation/concat, fusion, off-fold) must pass through before emitting (or declining to
/// emit) a producer-level [`RegressionTargetBlock`] for a reassembled merge prediction. It closes
/// audit R-P1-9: a merge that *should* be scored must never silently produce **no** score.
///
/// A merge reassembles its output's `y_true` by collecting the per-branch validation/off-fold target
/// records into `by_sample_target`. The scoring path ([`super::runtime`]'s `apply_result_scoring`)
/// pairs a prediction block 1:1 with a target block that covers *exactly* its samples — so a partial
/// target block cannot be scored. There are exactly three legitimate outcomes:
///
/// 1. **No contributing branch emitted targets** (`by_sample_target` empty) — the merge is simply
///    unscored. Returns `Ok(None)`; the caller emits no [`RegressionTargetBlock`]. This is the common
///    "host never emitted `regression_targets`" case and stays a no-op (unchanged behavior).
/// 2. **Every merged sample is covered** — emit the 1:1 target block. Returns `Ok(Some(block))` in the
///    merge's declared `sample_id` order, ready to score.
/// 3. **At least one branch emitted targets but coverage is INCOMPLETE** — previously the partial
///    targets were silently dropped (`Vec::new()` → no score), so a merge that should have been scored
///    silently vanished from selection. This is now a hard validation **ERROR**: once ANY branch
///    contributes targets, the merge universe must be covered completely or the run fails loudly.
///
/// `merge_sample_ids` is the merge output's sample order (the universe to cover); `target_names` is the
/// reassembled target name vector (already unified across branches by the caller). The map is consumed
/// by `remove` on the success path so the caller need not clone it.
pub fn reassemble_merge_targets(
    producer_node: &NodeId,
    merge_sample_ids: &[SampleId],
    by_sample_target: &mut BTreeMap<SampleId, Vec<f64>>,
    target_names: Vec<String>,
) -> Result<Option<RegressionTargetBlock>> {
    if by_sample_target.is_empty() {
        return Ok(None);
    }
    let missing: Vec<String> = merge_sample_ids
        .iter()
        .filter(|sample_id| !by_sample_target.contains_key(*sample_id))
        .map(ToString::to_string)
        .collect();
    if !missing.is_empty() {
        return Err(DagMlError::OofValidation(format!(
            "merge node `{producer_node}` has partial target coverage: {} of {} merged sample(s) lack a y_true row ({}) while other contributing branch(es) emitted targets — a merge that some branch scores must have COMPLETE target coverage across the merge universe, never a silent no-score",
            missing.len(),
            merge_sample_ids.len(),
            missing.join(", ")
        )));
    }
    let values: Vec<Vec<f64>> = merge_sample_ids
        .iter()
        .map(|sample_id| {
            by_sample_target
                .remove(sample_id)
                .expect("target coverage was just verified complete")
        })
        .collect();
    Ok(Some(RegressionTargetBlock {
        validity_masks: None,
        level: PredictionLevel::Sample,
        unit_ids: merge_sample_ids
            .iter()
            .cloned()
            .map(PredictionUnitId::Sample)
            .collect(),
        values,
        target_names,
    }))
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RegressionMetricReport {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_domain: Option<crate::target_domain::TargetDomain>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grouping_key: Option<crate::policy::AggregationGroupingKey>,
    #[serde(default)]
    pub prediction_id: Option<String>,
    pub producer_node: NodeId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub producer_port: Option<String>,
    /// Variant this score belongs to — distinguishes per-variant candidates when a generated
    /// campaign scores several variants, so native SELECT can pick the best. Skipped (None) for
    /// single-variant runs, so existing fixtures/fingerprints are byte-identical.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variant_id: Option<VariantId>,
    /// Cross-language CONTENT fingerprint (hex sha256) of the operator-variant this score belongs to:
    /// the canonical form of the variant's LOWERED operator sub-sequence (Phase 5). The nirs4all host
    /// recomputes the SAME bytes from its own operator-choice config, so it can map a per-variant
    /// dag-ml report back to the config that produced it (replacing a brittle positional zip). Set
    /// only for operator-SELECT reports (the choice fingerprint from `OperatorVariantModel`'s
    /// `variant_labels`); skipped (None) for param-variant / single-variant runs, so existing
    /// fixtures/fingerprints stay byte-identical.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variant_label: Option<String>,
    pub partition: PredictionPartition,
    pub fold_id: Option<FoldId>,
    pub level: PredictionLevel,
    pub row_count: usize,
    pub target_width: usize,
    #[serde(default)]
    pub target_names: Vec<String>,
    pub metrics: BTreeMap<String, f64>,
}

impl RegressionMetricReport {
    pub fn validate(&self) -> Result<()> {
        if let Some(domain) = &self.target_domain {
            domain.validate()?;
            if self.level != PredictionLevel::Sample || self.target_width != 1 {
                return Err(DagMlError::OofValidation(
                    "categorical target domain requires mono-y sample score".into(),
                ));
            }
        }
        if let Some(key) = &self.grouping_key {
            key.validate()?;
            if self.level != PredictionLevel::Group {
                return Err(DagMlError::OofValidation(
                    "grouping_key requires a Group score report".into(),
                ));
            }
        }
        if self.row_count == 0 {
            return Err(DagMlError::OofValidation(
                "regression metric report has zero rows".to_string(),
            ));
        }
        if self.target_width == 0 {
            return Err(DagMlError::OofValidation(
                "regression metric report has zero target width".to_string(),
            ));
        }
        if !self.target_names.is_empty() && self.target_names.len() != self.target_width {
            return Err(DagMlError::OofValidation(format!(
                "regression metric report has {} target names for width {}",
                self.target_names.len(),
                self.target_width
            )));
        }
        if self.metrics.is_empty() {
            return Err(DagMlError::OofValidation(
                "regression metric report has no metrics".to_string(),
            ));
        }
        for (name, value) in &self.metrics {
            if name.trim().is_empty() {
                return Err(DagMlError::OofValidation(
                    "regression metric report contains an empty metric name".to_string(),
                ));
            }
            if !value.is_finite() {
                return Err(DagMlError::OofValidation(format!(
                    "regression metric `{name}` is not finite"
                )));
            }
        }
        Ok(())
    }

    pub fn into_candidate_score(self, candidate_id: impl Into<String>) -> Result<CandidateScore> {
        self.validate()?;
        let mut metadata = BTreeMap::from([
            (
                "producer_node".to_string(),
                serde_json::json!(self.producer_node),
            ),
            ("partition".to_string(), serde_json::json!(self.partition)),
            (
                "metric_level".to_string(),
                serde_json::json!(prediction_level_name(self.level)),
            ),
            ("row_count".to_string(), serde_json::json!(self.row_count)),
            (
                "target_width".to_string(),
                serde_json::json!(self.target_width),
            ),
        ]);
        if let Some(prediction_id) = self.prediction_id {
            metadata.insert(
                "prediction_id".to_string(),
                serde_json::json!(prediction_id),
            );
        }
        if let Some(producer_port) = self.producer_port {
            metadata.insert(
                "producer_port".to_string(),
                serde_json::json!(producer_port),
            );
        }
        if let Some(fold_id) = self.fold_id {
            metadata.insert("fold_id".to_string(), serde_json::json!(fold_id));
        }
        if let Some(variant_id) = self.variant_id {
            metadata.insert("variant_id".to_string(), serde_json::json!(variant_id));
        }
        if !self.target_names.is_empty() {
            metadata.insert(
                "target_names".to_string(),
                serde_json::json!(self.target_names),
            );
        }
        if let Some(key) = &self.grouping_key {
            metadata.insert("grouping_key".into(), serde_json::to_value(key)?);
        }
        let score = CandidateScore {
            candidate_id: candidate_id.into(),
            metrics: self.metrics,
            metadata,
        };
        score.validate()?;
        Ok(score)
    }
}

pub fn regression_report_to_candidate_score(
    candidate_id: impl Into<String>,
    report: RegressionMetricReport,
) -> Result<CandidateScore> {
    report.into_candidate_score(candidate_id)
}

pub fn score_regression_prediction_block(
    predictions: &PredictionBlock,
    targets: &RegressionTargetBlock,
    metrics: &[RegressionMetricKind],
) -> Result<RegressionMetricReport> {
    let width = validate_sample_prediction_block(predictions)?;
    let prediction_units = predictions
        .sample_ids
        .iter()
        .cloned()
        .map(PredictionUnitId::Sample)
        .collect::<Vec<_>>();
    score_regression_rows(
        PredictionRows {
            level: PredictionLevel::Sample,
            unit_ids: &prediction_units,
            values: &predictions.values,
            target_names: &predictions.target_names,
            width,
            origin: PredictionReportOrigin {
                prediction_id: predictions.prediction_id.clone(),
                producer_node: predictions.producer_node.clone(),
                producer_port: predictions.producer_port.clone(),
                partition: predictions.partition.clone(),
                fold_id: predictions.fold_id.clone(),
            },
        },
        targets,
        metrics,
    )
}

/// Score the emitted numeric feature as usual, but use an attested complete
/// class distribution for classification metrics. A projected one-column
/// probability is a valid stacking feature; it is not a multiclass label.
pub fn score_prediction_with_class_probabilities(
    predictions: &PredictionBlock,
    probabilities: &ClassificationProbabilityBlock,
    targets: &RegressionTargetBlock,
    metrics: &[RegressionMetricKind],
) -> Result<RegressionMetricReport> {
    probabilities.validate()?;
    if probabilities.producer_node != predictions.producer_node
        || probabilities.producer_port != predictions.producer_port
        || probabilities.partition != predictions.partition
        || probabilities.fold_id != predictions.fold_id
        || probabilities.sample_ids.iter().collect::<BTreeSet<_>>()
            != predictions.sample_ids.iter().collect::<BTreeSet<_>>()
    {
        return Err(DagMlError::OofValidation(
            "classification probabilities do not match their prediction block".to_string(),
        ));
    }
    let by_sample = probabilities
        .sample_ids
        .iter()
        .zip(&probabilities.values)
        .collect::<BTreeMap<_, _>>();
    let class_values = predictions
        .sample_ids
        .iter()
        .map(|sample| {
            let row = by_sample
                .get(sample)
                .expect("matched probability identities");
            let selected = row
                .iter()
                .enumerate()
                .max_by(|left, right| left.1.total_cmp(right.1).then_with(|| right.0.cmp(&left.0)))
                .expect("validated probability rows have classes")
                .0;
            vec![probabilities.class_labels[selected]]
        })
        .collect();
    let mut label_block = predictions.clone();
    label_block.values = class_values;
    let classification_metrics = metrics
        .iter()
        .copied()
        .filter(|metric| {
            matches!(
                metric,
                RegressionMetricKind::Accuracy
                    | RegressionMetricKind::BalancedAccuracy
                    | RegressionMetricKind::F1
            )
        })
        .collect::<Vec<_>>();
    let class_report =
        score_regression_prediction_block(&label_block, targets, &classification_metrics)?;
    let mut report = score_regression_prediction_block(predictions, targets, metrics)?;
    for (metric, value) in class_report.metrics {
        report.metrics.insert(metric, value);
    }
    Ok(report)
}

pub fn score_regression_aggregated_block(
    predictions: &AggregatedPredictionBlock,
    targets: &RegressionTargetBlock,
    metrics: &[RegressionMetricKind],
) -> Result<RegressionMetricReport> {
    let width = predictions.validate_shape()?;
    score_regression_rows(
        PredictionRows {
            level: predictions.level,
            unit_ids: &predictions.unit_ids,
            values: &predictions.values,
            target_names: &predictions.target_names,
            width,
            origin: PredictionReportOrigin {
                prediction_id: predictions.prediction_id.clone(),
                producer_node: predictions.producer_node.clone(),
                producer_port: predictions.producer_port.clone(),
                partition: predictions.partition.clone(),
                fold_id: predictions.fold_id.clone(),
            },
        },
        targets,
        metrics,
    )
}

/// Current on-disk schema version for newly written [`ScoreSet`] documents.
pub const SCORE_SET_SCHEMA_VERSION: u32 = 2;
pub const LEGACY_SCORE_SET_SCHEMA_VERSION: u32 = 1;
pub const MIN_READABLE_SCORE_SET_SCHEMA_VERSION: u32 = 1;

fn default_score_set_schema_version() -> u32 {
    LEGACY_SCORE_SET_SCHEMA_VERSION
}

/// A persisted collection of per-block regression metric reports — the native, cross-language
/// score record produced by a run (one report per `(producer_node, partition, fold_id, level)`).
///
/// Unlike the prediction-*value* cache (which is Validation-only and leakage-gated), scores are
/// scalars derived from `y_true` and carry no feature data, so they are safe to persist for
/// every partition (train / validation / test / final). This is the score half of "dag-ml owns
/// prediction/score persistence natively" — the Python (or any host) `RunResult` reads these
/// scalars by identity, with no recomputation.
/// Identity of a score report within a [`ScoreSet`] — unique per producer port, variant,
/// partition, fold and level.
type ScoreReportKey = (
    NodeId,
    Option<String>,
    Option<VariantId>,
    PredictionPartition,
    Option<FoldId>,
    PredictionLevel,
);

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ScoreSet {
    #[serde(default = "default_score_set_schema_version")]
    pub schema_version: u32,
    pub plan_id: String,
    /// The metric SELECT optimized for this run (e.g. `"rmse"`), if a selection ran. Metadata only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selection_metric: Option<String>,
    pub reports: Vec<RegressionMetricReport>,
}

impl ScoreSet {
    /// Validate the version, plan id, every report, and report-key uniqueness.
    pub fn validate(&self) -> Result<()> {
        if self.schema_version < MIN_READABLE_SCORE_SET_SCHEMA_VERSION
            || self.schema_version > SCORE_SET_SCHEMA_VERSION
        {
            return Err(DagMlError::OofValidation(format!(
                "score set schema version {} is unsupported (current {SCORE_SET_SCHEMA_VERSION})",
                self.schema_version
            )));
        }
        if self.plan_id.trim().is_empty() {
            return Err(DagMlError::OofValidation(
                "score set has an empty plan_id".to_string(),
            ));
        }
        let mut seen: BTreeSet<ScoreReportKey> = BTreeSet::new();
        for report in &self.reports {
            report.validate()?;
            match (self.schema_version, report.producer_port.as_deref()) {
                (LEGACY_SCORE_SET_SCHEMA_VERSION, Some(_)) => {
                    return Err(DagMlError::OofValidation(
                        "score set V1 reports must not carry producer_port".to_string(),
                    ));
                }
                (SCORE_SET_SCHEMA_VERSION, Some(port)) if port.trim().is_empty() => {
                    return Err(DagMlError::OofValidation(
                        "score set V2 report has an empty producer_port".to_string(),
                    ));
                }
                (SCORE_SET_SCHEMA_VERSION, None) => {
                    return Err(DagMlError::OofValidation(
                        "score set V2 requires producer_port on every report".to_string(),
                    ));
                }
                _ => {}
            }
            let key = (
                report.producer_node.clone(),
                report.producer_port.clone(),
                report.variant_id.clone(),
                report.partition.clone(),
                report.fold_id.clone(),
                report.level,
            );
            if !seen.insert(key) {
                return Err(DagMlError::OofValidation(format!(
                    "score set has a duplicate report for node `{}` port {:?} partition {:?} fold {:?} level {:?}",
                    report.producer_node,
                    report.producer_port,
                    report.partition,
                    report.fold_id,
                    report.level
                )));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug)]
struct PredictionReportOrigin {
    prediction_id: Option<String>,
    producer_node: NodeId,
    producer_port: Option<String>,
    partition: PredictionPartition,
    fold_id: Option<FoldId>,
}

#[derive(Clone, Debug)]
struct PredictionRows<'a> {
    level: PredictionLevel,
    unit_ids: &'a [PredictionUnitId],
    values: &'a [Vec<f64>],
    target_names: &'a [String],
    width: usize,
    origin: PredictionReportOrigin,
}

fn score_regression_rows(
    predictions: PredictionRows<'_>,
    targets: &RegressionTargetBlock,
    metrics: &[RegressionMetricKind],
) -> Result<RegressionMetricReport> {
    if metrics.is_empty() {
        return Err(DagMlError::OofValidation(
            "no regression metrics requested".to_string(),
        ));
    }
    let mut requested_metrics = BTreeSet::new();
    for metric in metrics {
        if !requested_metrics.insert(*metric) {
            return Err(DagMlError::OofValidation(format!(
                "duplicate regression metric `{}` requested",
                metric.name()
            )));
        }
    }

    let target_width = targets.validate_shape()?;
    if predictions.width != target_width {
        return Err(DagMlError::OofValidation(format!(
            "prediction width {} does not match target width {target_width}",
            predictions.width
        )));
    }
    if predictions.level != targets.level {
        return Err(DagMlError::OofValidation(format!(
            "prediction level {:?} does not match target level {:?}",
            predictions.level, targets.level
        )));
    }
    if !predictions.target_names.is_empty()
        && !targets.target_names.is_empty()
        && predictions.target_names != targets.target_names
    {
        return Err(DagMlError::OofValidation(
            "prediction target names do not match target block names".to_string(),
        ));
    }

    let target_by_unit = targets
        .unit_ids
        .iter()
        .zip(targets.values.iter().map(Vec::as_slice))
        .collect::<BTreeMap<_, _>>();
    let mut aligned_predictions = Vec::with_capacity(predictions.unit_ids.len());
    let mut aligned_targets = Vec::with_capacity(predictions.unit_ids.len());
    for (unit_id, prediction_row) in predictions.unit_ids.iter().zip(predictions.values.iter()) {
        let target_row = target_by_unit.get(unit_id).ok_or_else(|| {
            DagMlError::OofValidation(format!(
                "prediction unit `{unit_id}` is missing from target block"
            ))
        })?;
        aligned_predictions.push(prediction_row.as_slice());
        aligned_targets.push(*target_row);
    }
    if aligned_predictions.len() != target_by_unit.len() {
        return Err(DagMlError::OofValidation(
            "target block contains units not present in predictions".to_string(),
        ));
    }

    let target_names = if !predictions.target_names.is_empty() {
        predictions.target_names.to_vec()
    } else {
        targets.target_names.clone()
    };
    if targets.has_missing_values() {
        return score_masked_regression_rows(predictions, targets, metrics, target_names);
    }
    let metric_suffixes = target_metric_names(predictions.width, &target_names);
    let provider_output_ids = (0..predictions.width)
        .map(|index| format!("output:{index}"))
        .collect::<Vec<_>>();
    let metric_units = predictions
        .unit_ids
        .iter()
        .map(MetricUnitId::from)
        .collect::<Vec<_>>();
    let prediction_values = aligned_predictions
        .iter()
        .map(|row| row.to_vec())
        .collect::<Vec<_>>();
    let target_values = aligned_targets
        .iter()
        .map(|row| row.to_vec())
        .collect::<Vec<_>>();
    let scope = MetricEvaluationScope {
        producer_node: predictions.origin.producer_node.clone(),
        producer_port: predictions.origin.producer_port.clone(),
        prediction_id: predictions.origin.prediction_id.clone(),
        variant_id: None,
        partition: predictions.origin.partition.clone(),
        fold_id: predictions.origin.fold_id.clone(),
        level: predictions.level,
    };
    let registry = builtin_metric_registry()?;
    let mut values = BTreeMap::new();
    for metric in metrics {
        let (task_kind, prediction_kind) = match metric {
            RegressionMetricKind::Mse
            | RegressionMetricKind::Rmse
            | RegressionMetricKind::Mae
            | RegressionMetricKind::R2 => (
                LearningTaskKind::Regression,
                PredictionKind::RegressionPoint,
            ),
            RegressionMetricKind::Accuracy
            | RegressionMetricKind::BalancedAccuracy
            | RegressionMetricKind::F1 => (
                LearningTaskKind::MulticlassClassification,
                PredictionKind::ClassLabel,
            ),
        };
        let task = MetricEvaluationTask::new(
            format!(
                "metric:{}:{}",
                predictions.origin.producer_node,
                metric.name()
            ),
            builtin_metric_reference(*metric)?,
            task_kind,
            prediction_kind,
            scope.clone(),
            metric_units.clone(),
            prediction_values.clone(),
            target_values.clone(),
            provider_output_ids.clone(),
            None,
            None,
            None,
        )?;
        let evaluation = registry.evaluate(&task)?;
        values.insert(metric.name().to_string(), evaluation.aggregate);
        for (component, suffix) in evaluation.result.values.into_iter().zip(&metric_suffixes) {
            values.insert(format!("{}:{suffix}", metric.name()), component.value);
        }
    }

    let report = RegressionMetricReport {
        target_domain: None,
        grouping_key: None,
        prediction_id: predictions.origin.prediction_id,
        producer_node: predictions.origin.producer_node,
        producer_port: predictions.origin.producer_port,
        variant_id: None,
        variant_label: None,
        partition: predictions.origin.partition,
        fold_id: predictions.origin.fold_id,
        level: predictions.level,
        row_count: predictions.unit_ids.len(),
        target_width: predictions.width,
        target_names,
        metrics: values,
    };
    report.validate()?;
    Ok(report)
}

/// Slice observed cells in the coordinator, then reuse the same native metric providers.
/// Each output is evaluated independently and the public scalar is their unweighted mean.
fn score_masked_regression_rows(
    predictions: PredictionRows<'_>,
    targets: &RegressionTargetBlock,
    metrics: &[RegressionMetricKind],
    target_names: Vec<String>,
) -> Result<RegressionMetricReport> {
    score_masked_regression_rows_with_grouping(predictions, targets, metrics, target_names, false)
}

pub(crate) fn score_independent_unit_block(
    predictions: &AggregatedPredictionBlock,
    targets: &RegressionTargetBlock,
    metrics: &[RegressionMetricKind],
    key: &crate::policy::AggregationGroupingKey,
) -> Result<RegressionMetricReport> {
    key.validate()?;
    if predictions.level != PredictionLevel::Group || targets.level != PredictionLevel::Group {
        return Err(DagMlError::OofValidation(
            "independent-unit score requires Group rows".into(),
        ));
    }
    let mut report = if targets.validity_masks.is_some() {
        predictions.validate_shape()?;
        targets.validate_shape()?;
        if predictions.unit_ids.iter().collect::<BTreeSet<_>>()
            != targets.unit_ids.iter().collect::<BTreeSet<_>>()
            || predictions.values[0].len() != targets.values[0].len()
        {
            return Err(DagMlError::OofValidation(
                "independent-unit score identity/width mismatch".into(),
            ));
        }
        score_masked_regression_rows_with_grouping(
            PredictionRows {
                level: predictions.level,
                unit_ids: &predictions.unit_ids,
                values: &predictions.values,
                target_names: &predictions.target_names,
                width: predictions.values[0].len(),
                origin: PredictionReportOrigin {
                    prediction_id: predictions.prediction_id.clone(),
                    producer_node: predictions.producer_node.clone(),
                    producer_port: predictions.producer_port.clone(),
                    partition: predictions.partition.clone(),
                    fold_id: predictions.fold_id.clone(),
                },
            },
            targets,
            metrics,
            predictions.target_names.clone(),
            true,
        )?
    } else {
        score_regression_aggregated_block(predictions, targets, metrics)?
    };
    report.grouping_key = Some(key.clone());
    report.validate()?;
    Ok(report)
}

fn score_masked_regression_rows_with_grouping(
    predictions: PredictionRows<'_>,
    targets: &RegressionTargetBlock,
    metrics: &[RegressionMetricKind],
    target_names: Vec<String>,
    independent_group: bool,
) -> Result<RegressionMetricReport> {
    if predictions.level != PredictionLevel::Sample && !independent_group {
        targets.require_complete_targets("group/target/observation scoring")?;
    }
    let masks = targets
        .validity_masks
        .as_ref()
        .expect("missing values have a mask");
    let target_rows = targets
        .unit_ids
        .iter()
        .enumerate()
        .map(|(index, unit)| (unit, index))
        .collect::<BTreeMap<_, _>>();
    let suffixes = target_metric_names(predictions.width, &target_names);
    let mut values = BTreeMap::new();
    for (column, suffix) in suffixes.iter().enumerate() {
        let mut unit_ids = Vec::new();
        let mut observed_predictions = Vec::new();
        let mut observed_targets = Vec::new();
        for (unit, prediction) in predictions.unit_ids.iter().zip(predictions.values) {
            let row = target_rows[unit];
            if masks[row][column] {
                unit_ids.push(unit.clone());
                observed_predictions.push(vec![prediction[column]]);
                observed_targets.push(vec![targets.values[row][column]]);
            }
        }
        if unit_ids.is_empty() {
            return Err(DagMlError::OofValidation(format!(
                "masked regression target `{suffix}` has no observed values in scored partition {:?} fold {:?}",
                predictions.origin.partition, predictions.origin.fold_id
            )));
        }
        let observed = RegressionTargetBlock {
            level: predictions.level,
            unit_ids: unit_ids.clone(),
            values: observed_targets,
            validity_masks: None,
            target_names: Vec::new(),
        };
        let report = score_regression_rows(
            PredictionRows {
                level: predictions.level,
                unit_ids: &unit_ids,
                values: &observed_predictions,
                target_names: &[],
                width: 1,
                origin: predictions.origin.clone(),
            },
            &observed,
            metrics,
        )?;
        for metric in metrics {
            let value = report.metrics[metric.name()];
            values.insert(format!("{}:{suffix}", metric.name()), value);
            *values.entry(metric.name().to_string()).or_insert(0.0) +=
                value / predictions.width as f64;
        }
    }
    let report = RegressionMetricReport {
        target_domain: None,
        grouping_key: None,
        prediction_id: predictions.origin.prediction_id,
        producer_node: predictions.origin.producer_node,
        producer_port: predictions.origin.producer_port,
        variant_id: None,
        variant_label: None,
        partition: predictions.origin.partition,
        fold_id: predictions.origin.fold_id,
        level: predictions.level,
        row_count: predictions.unit_ids.len(),
        target_width: predictions.width,
        target_names,
        metrics: values,
    };
    report.validate()?;
    Ok(report)
}

fn validate_sample_prediction_block(block: &PredictionBlock) -> Result<usize> {
    block.validate_content()
}

pub(crate) fn compute_metric_per_target(
    metric: RegressionMetricKind,
    width: usize,
    predictions: &[&[f64]],
    targets: &[&[f64]],
) -> Vec<f64> {
    (0..width)
        .map(|target_idx| match metric {
            RegressionMetricKind::Mse => {
                predictions
                    .iter()
                    .zip(targets.iter())
                    .map(|(prediction, target)| {
                        let error = prediction[target_idx] - target[target_idx];
                        error * error
                    })
                    .sum::<f64>()
                    / predictions.len() as f64
            }
            RegressionMetricKind::Rmse => (predictions
                .iter()
                .zip(targets.iter())
                .map(|(prediction, target)| {
                    let error = prediction[target_idx] - target[target_idx];
                    error * error
                })
                .sum::<f64>()
                / predictions.len() as f64)
                .sqrt(),
            RegressionMetricKind::Mae => {
                predictions
                    .iter()
                    .zip(targets.iter())
                    .map(|(prediction, target)| (prediction[target_idx] - target[target_idx]).abs())
                    .sum::<f64>()
                    / predictions.len() as f64
            }
            RegressionMetricKind::R2 => r2_for_target(target_idx, predictions, targets),
            RegressionMetricKind::Accuracy => {
                predictions
                    .iter()
                    .zip(targets.iter())
                    .filter(|(prediction, target)| {
                        prediction[target_idx].round() == target[target_idx].round()
                    })
                    .count() as f64
                    / predictions.len() as f64
            }
            RegressionMetricKind::BalancedAccuracy => {
                balanced_accuracy_for_target(target_idx, predictions, targets)
            }
            RegressionMetricKind::F1 => weighted_f1_for_target(target_idx, predictions, targets),
        })
        .collect()
}

fn weighted_f1_for_target(target_idx: usize, predictions: &[&[f64]], targets: &[&[f64]]) -> f64 {
    let mut counts: BTreeMap<i64, (usize, usize, usize)> = BTreeMap::new();
    for (prediction, target) in predictions.iter().zip(targets.iter()) {
        let actual = target[target_idx].round() as i64;
        let predicted = prediction[target_idx].round() as i64;
        counts.entry(actual).or_default().2 += 1;
        if actual == predicted {
            counts.entry(actual).or_default().0 += 1;
        } else {
            counts.entry(predicted).or_default().1 += 1;
        }
    }
    let total = targets.len() as f64;
    counts
        .values()
        .map(|(true_positive, false_positive, support)| {
            let false_negative = support - true_positive;
            let denominator = 2 * true_positive + false_positive + false_negative;
            if denominator == 0 {
                0.0
            } else {
                (2 * true_positive) as f64 / denominator as f64 * (*support as f64 / total)
            }
        })
        .sum()
}

/// Balanced classification accuracy for one target column: the macro-average of per-class recall over
/// the integer labels present in `y_true`, matching scikit-learn's `balanced_accuracy_score`. Labels
/// are matched the same way as [`RegressionMetricKind::Accuracy`] — a prediction counts for true class
/// `c` when rounded class identities agree — so the two metrics share one label-encoding convention. Returns the
/// unweighted mean of `correct_in_class / count_in_class`; an empty target set yields `0.0` (the rows
/// are non-empty here because the scoring path rejects zero-row blocks before this is reached).
fn balanced_accuracy_for_target(
    target_idx: usize,
    predictions: &[&[f64]],
    targets: &[&[f64]],
) -> f64 {
    // Group sample rows by their (rounded) true class label, preserving determinism via BTreeMap.
    let mut per_class: BTreeMap<i64, (usize, usize)> = BTreeMap::new();
    for (prediction, target) in predictions.iter().zip(targets.iter()) {
        let true_value = target[target_idx];
        let class = true_value.round() as i64;
        let entry = per_class.entry(class).or_insert((0, 0));
        entry.1 += 1;
        if prediction[target_idx].round() == true_value.round() {
            entry.0 += 1;
        }
    }
    if per_class.is_empty() {
        return 0.0;
    }
    let recall_sum: f64 = per_class
        .values()
        .map(|(correct, count)| *correct as f64 / *count as f64)
        .sum();
    recall_sum / per_class.len() as f64
}

fn r2_for_target(target_idx: usize, predictions: &[&[f64]], targets: &[&[f64]]) -> f64 {
    let mean = targets.iter().map(|row| row[target_idx]).sum::<f64>() / targets.len() as f64;
    let ss_res = predictions
        .iter()
        .zip(targets.iter())
        .map(|(prediction, target)| {
            let error = prediction[target_idx] - target[target_idx];
            error * error
        })
        .sum::<f64>();
    let ss_tot = targets
        .iter()
        .map(|target| {
            let centered = target[target_idx] - mean;
            centered * centered
        })
        .sum::<f64>();
    if ss_tot == 0.0 {
        if ss_res == 0.0 {
            1.0
        } else {
            0.0
        }
    } else {
        1.0 - ss_res / ss_tot
    }
}

fn target_metric_names(width: usize, target_names: &[String]) -> Vec<String> {
    if target_names.is_empty() {
        (0..width).map(|idx| format!("target_{idx}")).collect()
    } else {
        target_names.to_vec()
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

/// A host-emitted `y_true` block tagged with the prediction it scores (producer/partition/fold), so
/// the runtime can aggregate ground truth across folds to score cross-fold ensembles natively.
#[derive(Clone, Debug, PartialEq)]
pub struct RegressionTargetRecord {
    pub producer_node: NodeId,
    pub producer_port: Option<String>,
    /// Variant that produced the scored block — lets the cross-fold OOF average be computed
    /// per-variant (for native SELECT) without tagging every PredictionBlock with a variant.
    pub variant_id: Option<VariantId>,
    pub partition: PredictionPartition,
    pub fold_id: Option<FoldId>,
    pub block: RegressionTargetBlock,
}

/// Combine a producer's per-fold targets into one block (dedup by unit id — a sample's
/// ground truth is fold-independent), aligned to the producer's predictions.
///
/// Defense-in-depth (audit R-P0-1): records are grouped only by `producer_node`, but each carries a
/// `variant_id`. A sample's ground truth is variant-independent, so the same unit seen again must
/// carry the SAME `y_true`. If two records (e.g. from two variants sharing one context) disagree on a
/// unit's target, the ground truth has been mixed and the combined block would silently score against
/// a corrupted reference — that is refused rather than keeping whichever value happened to be first.
fn combine_partition_targets(
    producer: &NodeId,
    producer_port: &Option<String>,
    records: &[RegressionTargetRecord],
    partition: PredictionPartition,
) -> Result<RegressionTargetBlock> {
    let mut seen: BTreeMap<PredictionUnitId, (Vec<f64>, Vec<bool>)> = BTreeMap::new();
    let mut unit_ids = Vec::new();
    let mut values = Vec::new();
    let mut validity_masks = Vec::new();
    let mut has_masks = false;
    let mut target_names = Vec::new();
    for record in records {
        if &record.producer_node != producer
            || &record.producer_port != producer_port
            || record.partition != partition
        {
            continue;
        }
        if target_names.is_empty() {
            target_names = record.block.target_names.clone();
        }
        let block = record.block.canonicalized()?;
        has_masks |= block.validity_masks.is_some();
        for (index, (unit_id, row)) in block.unit_ids.iter().zip(&block.values).enumerate() {
            let mask = block
                .validity_masks
                .as_ref()
                .map_or_else(|| vec![true; row.len()], |masks| masks[index].clone());
            match seen.get(unit_id) {
                None => {
                    seen.insert(unit_id.clone(), (row.clone(), mask.clone()));
                    unit_ids.push(unit_id.clone());
                    values.push(row.clone());
                    validity_masks.push(mask);
                }
                Some((existing, existing_mask)) if existing != row || existing_mask != &mask => {
                    return Err(DagMlError::OofValidation(format!(
                        "producer `{producer}` has conflicting ground truth for unit `{unit_id:?}` across partition records — the y_true reference is mixed (e.g. several variants in one context); refusing to score against a corrupted reference"
                    )));
                }
                Some(_) => {}
            }
        }
    }
    Ok(RegressionTargetBlock {
        validity_masks: has_masks.then_some(validity_masks),
        level: PredictionLevel::Sample,
        unit_ids,
        values,
        target_names,
    })
}

/// The per-sample cross-fold OOF average of one producer, surfaced alongside its scalar report so the
/// host can show each OOF sample's averaged prediction (nirs4all's `(validation, avg)` row y_pred),
/// not only the pooled scalar. The block is keyed by `producer_node` / `partition = Validation` /
/// `fold_id = "avg"` — identical to the scalar [`RegressionMetricReport`] this pairs with — and the
/// `y_true` covers exactly the block's samples (same id set), so the host pairs them by id. This is
/// REPORT-grade output: it carries no variant tag (the block has none; the variant is stamped on the
/// report downstream) and never feeds a training/feature path, so OOF/leakage invariants are
/// unaffected. For a projected probability feature, classification metrics may instead be
/// scored from the matching complete class distribution.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OofAverageBlock {
    pub predictions: AggregatedPredictionBlock,
    pub y_true: RegressionTargetBlock,
}

/// The output of [`cross_fold_validation_reports`]: the scalar cross-fold OOF average reports (one per
/// producer, `fold_id = "avg"`) plus — purely additively — the per-sample OOF average block + `y_true`
/// each report was computed from. Callers that only need the scalars read `reports` and ignore
/// `oof_averages`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CrossFoldValidation {
    pub reports: Vec<RegressionMetricReport>,
    pub oof_averages: Vec<OofAverageBlock>,
}

/// Score the cross-fold OOF average per producer port: concatenate each `(producer_node,
/// producer_port)` pair's per-fold VALIDATION predictions into one block and score it against the
/// matching combined `y_true`. Yields one report per producer port with `fold_id = "avg"` —
/// nirs4all's `cv_best_score` row — plus, additively, the per-sample OOF average block + `y_true`
/// each report was computed from (so the host can fill the `(validation, avg)` row's per-sample
/// y_pred, not only the scalar). The per-fold join is identity-keyed; producer ports with a single
/// fold are skipped (nothing to ensemble).
///
/// `partition_mode` mirrors the campaign [`FoldPartitionMode`]:
/// under `Partition` (KFold) the per-producer OOF must be unique (each sample scored exactly once);
/// under `Resampled` (ShuffleSplit / repeated CV) a sample may appear in several folds — those
/// predictions are averaged by [`reduce_predictions_across_folds`] — so the across-fold uniqueness
/// gate is relaxed accordingly.
pub fn cross_fold_validation_reports(
    prediction_blocks: &[PredictionBlock],
    target_records: &[RegressionTargetRecord],
    metrics: &[RegressionMetricKind],
    partition_mode: FoldPartitionMode,
) -> Result<CrossFoldValidation> {
    cross_fold_validation_reports_with_probabilities(
        prediction_blocks,
        &[],
        target_records,
        metrics,
        partition_mode,
    )
}

/// Retain the projected OOF prediction values while scoring class labels from
/// their complete probability distributions when a host supplies both.
pub fn cross_fold_validation_reports_with_probabilities(
    prediction_blocks: &[PredictionBlock],
    probability_blocks: &[ClassificationProbabilityBlock],
    target_records: &[RegressionTargetRecord],
    metrics: &[RegressionMetricKind],
    partition_mode: FoldPartitionMode,
) -> Result<CrossFoldValidation> {
    cross_fold_validation_reports_with_classification(
        prediction_blocks,
        probability_blocks,
        target_records,
        metrics,
        partition_mode,
        &BTreeSet::new(),
    )
}

/// Score explicitly typed classification producers by vote when probabilities
/// are unavailable, even when regression metrics are retained in the report.
pub fn cross_fold_validation_reports_with_classification(
    prediction_blocks: &[PredictionBlock],
    probability_blocks: &[ClassificationProbabilityBlock],
    target_records: &[RegressionTargetRecord],
    metrics: &[RegressionMetricKind],
    partition_mode: FoldPartitionMode,
    classification_producers: &BTreeSet<NodeId>,
) -> Result<CrossFoldValidation> {
    let mut producers: Vec<(NodeId, Option<String>)> = Vec::new();
    let mut by_producer: BTreeMap<(NodeId, Option<String>), Vec<PredictionBlock>> = BTreeMap::new();
    for block in prediction_blocks {
        if block.partition != PredictionPartition::Validation {
            continue;
        }
        let key = (block.producer_node.clone(), block.producer_port.clone());
        if !by_producer.contains_key(&key) {
            producers.push(key.clone());
        }
        by_producer.entry(key).or_default().push(block.clone());
    }
    let mut reports = Vec::new();
    let mut oof_averages = Vec::new();
    for (producer, producer_port) in &producers {
        let blocks = &by_producer[&(producer.clone(), producer_port.clone())];
        if blocks.len() < 2 {
            continue;
        }
        // Mandatory OOF coverage gate (spec rule 3), mode-aware. Under `Partition` the producer's
        // per-fold validation blocks must be UNIQUE — exactly one validation prediction per sample; a
        // sample appearing in two blocks would be a duplicated fold or — since `PredictionBlock` carries
        // no variant tag — two variants' OOF in a shared context (audit R-P0-1), and is refused (the
        // scoring-path analogue of the runtime merge handler's "mixes several variants" guard, so
        // cross-variant CV scores can NEVER mix here). Under `Resampled` (ShuffleSplit / repeated CV) a
        // sample is legitimately validated in several folds and its predictions are averaged by
        // `reduce_predictions_across_folds` below, so across-fold multiplicity is allowed; the per-block
        // within-fold uniqueness still holds via `validate_content`.
        let block_refs = blocks.iter().collect::<Vec<_>>();
        validate_producer_oof_coverage(producer, &block_refs, partition_mode, None)?;
        let targets = combine_partition_targets(
            producer,
            producer_port,
            target_records,
            PredictionPartition::Validation,
        )?;
        if targets.unit_ids.is_empty() {
            // No y_true was emitted for this producer (e.g. mock controllers) — nothing to score.
            continue;
        }
        let mut average = reduce_predictions_across_folds(blocks, None, "avg")?;
        // Attested probabilities determine the class used for scoring while
        // retaining the original numeric stacking feature. Without probabilities,
        // repeated class identities must be voted rather than averaged.
        let probability_average =
            average_validation_probabilities(blocks, probability_blocks, &average)?;
        if probability_average.is_none()
            && (classification_producers.contains(producer)
                || (!metrics.is_empty()
                    && metrics.iter().all(|metric| {
                        matches!(
                            metric,
                            RegressionMetricKind::Accuracy
                                | RegressionMetricKind::BalancedAccuracy
                                | RegressionMetricKind::F1
                        )
                    })))
        {
            average = reduce_classification_folds(
                blocks,
                &[],
                None,
                "avg",
                PredictionPartition::Validation,
            )?;
        }
        reports.push(if let Some(probabilities) = probability_average.as_ref() {
            score_prediction_with_class_probabilities(&average, probabilities, &targets, metrics)?
        } else {
            score_regression_prediction_block(&average, &targets, metrics)?
        });
        oof_averages.push(oof_average_block(&average, &targets));
    }
    Ok(CrossFoldValidation {
        reports,
        oof_averages,
    })
}

fn average_validation_probabilities(
    blocks: &[PredictionBlock],
    probability_blocks: &[ClassificationProbabilityBlock],
    average: &PredictionBlock,
) -> Result<Option<ClassificationProbabilityBlock>> {
    let mut matched = Vec::new();
    for block in blocks {
        let candidates = probability_blocks
            .iter()
            .filter(|candidate| {
                candidate.producer_node == block.producer_node
                    && candidate.producer_port == block.producer_port
                    && candidate.partition == PredictionPartition::Validation
                    && candidate.fold_id == block.fold_id
                    && candidate.sample_ids.iter().collect::<BTreeSet<_>>()
                        == block.sample_ids.iter().collect::<BTreeSet<_>>()
            })
            .collect::<Vec<_>>();
        if candidates.len() > 1 {
            return Err(DagMlError::OofValidation(
                "cross-fold classification probabilities are ambiguous".to_string(),
            ));
        }
        if let Some(candidate) = candidates.first() {
            candidate.validate()?;
            matched.push(*candidate);
        }
    }
    if matched.is_empty() {
        return Ok(None);
    }
    if matched.len() != blocks.len() {
        return Err(DagMlError::OofValidation(
            "cross-fold classification probabilities omit a validation fold".to_string(),
        ));
    }
    let mut class_labels = matched
        .iter()
        .flat_map(|block| block.class_labels.iter().copied())
        .collect::<Vec<_>>();
    class_labels.sort_by(f64::total_cmp);
    class_labels.dedup();
    let mut sums: BTreeMap<SampleId, (Vec<f64>, usize)> = BTreeMap::new();
    for block in matched {
        for (sample, row) in block.sample_ids.iter().zip(&block.values) {
            let entry = sums
                .entry(sample.clone())
                .or_insert_with(|| (vec![0.0; class_labels.len()], 0));
            for (index, label) in block.class_labels.iter().enumerate() {
                let position = class_labels
                    .binary_search_by(|candidate| candidate.total_cmp(label))
                    .expect("class label came from validated probability block");
                entry.0[position] += row[index];
            }
            entry.1 += 1;
        }
    }
    let values = average
        .sample_ids
        .iter()
        .map(|sample| {
            let (sum, count) = sums.get(sample).ok_or_else(|| {
                DagMlError::OofValidation(format!(
                    "OOF average sample `{sample}` has no class probabilities"
                ))
            })?;
            Ok(sum
                .iter()
                .map(|value| value / *count as f64)
                .collect::<Vec<_>>())
        })
        .collect::<Result<Vec<_>>>()?;
    let averaged = ClassificationProbabilityBlock {
        producer_node: average.producer_node.clone(),
        producer_port: average.producer_port.clone(),
        partition: PredictionPartition::Validation,
        fold_id: average.fold_id.clone(),
        sample_ids: average.sample_ids.clone(),
        class_labels,
        values,
    };
    averaged.validate()?;
    Ok(Some(averaged))
}

/// Score the held-out test cohort with each CV estimator's predictions combined by an equal
/// mean and, when every fold has a validation score, a validation-score-weighted mean. Test
/// identities must be identical across folds; a partial fold cannot silently change the
/// population being evaluated. A sparse branch may predict test rows in a fold with no
/// validation rows, so it can contribute to `avg` but cannot be assigned a `w_avg` weight.
pub fn cross_fold_test_reports(
    prediction_blocks: &[PredictionBlock],
    probability_blocks: &[ClassificationProbabilityBlock],
    target_records: &[RegressionTargetRecord],
    validation_reports: &[RegressionMetricReport],
    selection_metric: RegressionMetricKind,
    metrics: &[RegressionMetricKind],
) -> Result<CrossFoldValidation> {
    let classification = matches!(
        selection_metric,
        RegressionMetricKind::Accuracy
            | RegressionMetricKind::BalancedAccuracy
            | RegressionMetricKind::F1
    );
    let mut by_producer: BTreeMap<(NodeId, Option<String>), Vec<PredictionBlock>> = BTreeMap::new();
    for block in prediction_blocks
        .iter()
        .filter(|block| block.partition == PredictionPartition::Test && block.fold_id.is_some())
    {
        by_producer
            .entry((block.producer_node.clone(), block.producer_port.clone()))
            .or_default()
            .push(block.clone());
    }
    let mut output = CrossFoldValidation::default();
    for ((producer, port), blocks) in by_producer {
        if blocks.len() < 2 {
            continue;
        }
        let expected: BTreeSet<_> = blocks[0].sample_ids.iter().cloned().collect();
        let mut folds = BTreeSet::new();
        for block in &blocks {
            block.validate_content()?;
            let fold = block.fold_id.as_ref().expect("filtered above");
            if !folds.insert(fold.clone()) {
                return Err(DagMlError::OofValidation(format!(
                    "producer `{producer}` has duplicate test fold `{fold}`"
                )));
            }
            if block.sample_ids.iter().cloned().collect::<BTreeSet<_>>() != expected {
                return Err(DagMlError::OofValidation(format!(
                    "producer `{producer}` has inconsistent test sample identities across CV folds"
                )));
            }
        }
        let targets =
            combine_partition_targets(&producer, &port, target_records, PredictionPartition::Test)?;
        if targets.unit_ids.is_empty() {
            continue;
        }
        let mut scores = Vec::with_capacity(blocks.len());
        for block in &blocks {
            let report = validation_reports.iter().find(|report| {
                report.producer_node == producer
                    && report.producer_port == port
                    && report.partition == PredictionPartition::Validation
                    && report.fold_id == block.fold_id
                    && report.level == PredictionLevel::Sample
            });
            let Some(report) = report else {
                continue;
            };
            let score = report.metrics.get(selection_metric.name()).ok_or_else(|| {
                DagMlError::OofValidation(format!(
                    "producer `{producer}` test fold {:?} has no validation score for `{}`",
                    block.fold_id,
                    selection_metric.name()
                ))
            })?;
            scores.push(*score);
        }
        let weights = (scores.len() == blocks.len())
            .then(|| validation_score_weights(&scores, selection_metric.objective()));
        for (label, weights) in [("avg", None), ("w_avg", weights.as_deref())] {
            if label == "w_avg" && weights.is_none() {
                continue;
            }
            let average = if classification {
                reduce_classification_folds(
                    &blocks,
                    probability_blocks,
                    weights,
                    label,
                    PredictionPartition::Test,
                )?
            } else {
                reduce_predictions_across_folds(&blocks, weights, label)?
            };
            output.reports.push(score_regression_prediction_block(
                &average, &targets, metrics,
            )?);
            output
                .oof_averages
                .push(oof_average_block(&average, &targets));
        }
    }
    Ok(output)
}

/// Report the average prediction of CV estimators on the whole training pool.
/// Per-fold `Train` reports remain scoped to each estimator's fit rows; the
/// separate `TrainPool` blocks provide one prediction from every fold estimator
/// for every training sample. These are report-only and never enter OOF selection.
pub fn cross_fold_train_reports(
    prediction_blocks: &[PredictionBlock],
    probability_blocks: &[ClassificationProbabilityBlock],
    target_records: &[RegressionTargetRecord],
    validation_reports: &[RegressionMetricReport],
    selection_metric: RegressionMetricKind,
    metrics: &[RegressionMetricKind],
) -> Result<CrossFoldValidation> {
    let classification = matches!(
        selection_metric,
        RegressionMetricKind::Accuracy
            | RegressionMetricKind::BalancedAccuracy
            | RegressionMetricKind::F1
    );
    let mut by_producer: BTreeMap<(NodeId, Option<String>), Vec<PredictionBlock>> = BTreeMap::new();
    for block in prediction_blocks.iter().filter(|block| {
        block.partition == PredictionPartition::TrainPool && block.fold_id.is_some()
    }) {
        by_producer
            .entry((block.producer_node.clone(), block.producer_port.clone()))
            .or_default()
            .push(block.clone());
    }
    let mut output = CrossFoldValidation::default();
    for ((producer, port), blocks) in by_producer {
        if blocks.len() < 2 {
            continue;
        }
        let mut folds = BTreeSet::new();
        for block in &blocks {
            block.validate_content()?;
            if !folds.insert(block.fold_id.clone().expect("filtered above")) {
                return Err(DagMlError::OofValidation(format!(
                    "producer `{producer}` has duplicate train fold {:?}",
                    block.fold_id
                )));
            }
        }
        let targets = combine_partition_targets(
            &producer,
            &port,
            target_records,
            PredictionPartition::TrainPool,
        )?;
        if targets.unit_ids.is_empty() {
            continue;
        }
        let mut scores = Vec::with_capacity(blocks.len());
        for block in &blocks {
            let report = validation_reports.iter().find(|report| {
                report.producer_node == producer
                    && report.producer_port == port
                    && report.partition == PredictionPartition::Validation
                    && report.fold_id == block.fold_id
                    && report.level == PredictionLevel::Sample
            });
            let Some(report) = report else { continue };
            let score = report.metrics.get(selection_metric.name()).ok_or_else(|| {
                DagMlError::OofValidation(format!(
                    "producer `{producer}` train fold {:?} has no validation score for `{}`",
                    block.fold_id,
                    selection_metric.name()
                ))
            })?;
            scores.push(*score);
        }
        let weights = (scores.len() == blocks.len())
            .then(|| validation_score_weights(&scores, selection_metric.objective()));
        for (label, weights) in [("avg", None), ("w_avg", weights.as_deref())] {
            if label == "w_avg" && weights.is_none() {
                continue;
            }
            let average = if classification {
                reduce_classification_folds(
                    &blocks,
                    probability_blocks,
                    weights,
                    label,
                    PredictionPartition::TrainPool,
                )?
            } else {
                reduce_predictions_across_folds(&blocks, weights, label)?
            };
            let mut average = average;
            average.partition = PredictionPartition::Train;
            output.reports.push(score_regression_prediction_block(
                &average, &targets, metrics,
            )?);
            output
                .oof_averages
                .push(oof_average_block(&average, &targets));
        }
    }
    Ok(output)
}

/// Aggregate class identities by aligned probability mean, falling back to a hard vote only
/// when at least one fold cannot provide probabilities. A numeric class label is never averaged.
fn reduce_classification_folds(
    blocks: &[PredictionBlock],
    probability_blocks: &[ClassificationProbabilityBlock],
    weights: Option<&[f64]>,
    fold_label: &str,
    partition: PredictionPartition,
) -> Result<PredictionBlock> {
    let first = &blocks[0];
    let probabilities = blocks
        .iter()
        .map(|block| {
            probability_blocks.iter().find(|candidate| {
                candidate.producer_node == block.producer_node
                    && candidate.producer_port == block.producer_port
                    && candidate.fold_id == block.fold_id
                    && candidate.partition == partition
            })
        })
        .collect::<Vec<_>>();
    let soft = probabilities.iter().all(|candidate| candidate.is_some());
    let mut classes = if soft {
        probabilities
            .iter()
            .flat_map(|candidate| candidate.unwrap().class_labels.iter().copied())
            .collect::<Vec<_>>()
    } else {
        blocks
            .iter()
            .flat_map(|block| block.values.iter().map(|row| row[0]))
            .collect::<Vec<_>>()
    };
    if blocks
        .iter()
        .any(|block| block.values.iter().any(|row| row.len() != 1))
    {
        return Err(DagMlError::OofValidation(
            "classification ensemble requires one target".to_string(),
        ));
    }
    classes.sort_by(f64::total_cmp);
    classes.dedup();
    if classes.is_empty() || classes.iter().any(|value| !value.is_finite()) {
        return Err(DagMlError::OofValidation(
            "classification ensemble has invalid class labels".to_string(),
        ));
    }
    let mut ids = Vec::new();
    let mut seen = BTreeSet::new();
    for block in blocks {
        for sample_id in &block.sample_ids {
            if seen.insert(sample_id.clone()) {
                ids.push(sample_id.clone());
            }
        }
    }
    let mut rows = Vec::with_capacity(ids.len());
    for sample_id in &ids {
        let mut scores = vec![0.0; classes.len()];
        let mut total = 0.0;
        for (fold_index, block) in blocks.iter().enumerate() {
            let position = block.sample_ids.iter().position(|id| id == sample_id);
            let Some(position) = position else {
                if partition == PredictionPartition::Test {
                    return Err(DagMlError::OofValidation(
                        "classification test folds have inconsistent sample identities".to_string(),
                    ));
                }
                continue;
            };
            let base_weight = weights.map_or(1.0, |weights| weights[fold_index]);
            if !base_weight.is_finite() || base_weight < 0.0 {
                return Err(DagMlError::OofValidation(
                    "classification fold weight must be finite and non-negative".to_string(),
                ));
            }
            if soft {
                let probability = probabilities[fold_index].unwrap();
                probability.validate()?;
                let probability_position = probability
                    .sample_ids
                    .iter()
                    .position(|id| id == sample_id)
                    .ok_or_else(|| {
                        DagMlError::OofValidation(
                            "classification probability sample identities differ from predictions"
                                .to_string(),
                        )
                    })?;
                let row = &probability.values[probability_position];
                let confidence = if weights.is_some() {
                    row.iter().copied().fold(0.0, f64::max)
                } else {
                    1.0
                };
                let weight = base_weight * confidence;
                for (class_index, class) in probability.class_labels.iter().enumerate() {
                    let aligned = classes
                        .binary_search_by(|value| value.total_cmp(class))
                        .expect("class universe contains fold class");
                    scores[aligned] += weight * row[class_index];
                }
                total += weight;
            } else {
                let label = block.values[position][0];
                let aligned = classes
                    .binary_search_by(|value| value.total_cmp(&label))
                    .expect("class universe contains fold label");
                scores[aligned] += base_weight;
                total += base_weight;
            }
        }
        if total <= 0.0 {
            return Err(DagMlError::OofValidation(
                "classification ensemble has zero total fold weight".to_string(),
            ));
        }
        let winner = scores
            .iter()
            .enumerate()
            .max_by(|(left_index, left), (right_index, right)| {
                left.total_cmp(right)
                    .then_with(|| right_index.cmp(left_index))
            })
            .expect("nonempty classes")
            .0;
        rows.push(vec![classes[winner]]);
    }
    Ok(PredictionBlock {
        prediction_id: None,
        producer_node: first.producer_node.clone(),
        producer_port: first.producer_port.clone(),
        partition,
        fold_id: Some(FoldId::new(fold_label)?),
        sample_ids: ids,
        values: rows,
        target_names: first.target_names.clone(),
    })
}

fn validation_score_weights(scores: &[f64], objective: MetricObjective) -> Vec<f64> {
    let min = scores.iter().copied().fold(f64::INFINITY, f64::min);
    let max = scores.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    if (max - min).abs() <= 1e-8 + 1e-5 * max.abs() {
        return vec![1.0; scores.len()];
    }
    match objective {
        MetricObjective::Maximize => {
            if min < 0.0 {
                scores.iter().map(|score| (score - min).max(1e-8)).collect()
            } else {
                scores.iter().map(|score| score.max(1e-8)).collect()
            }
        }
        MetricObjective::Minimize => scores
            .iter()
            .map(|score| {
                let positive = if min <= 0.0 {
                    score - min + 1e-8
                } else {
                    *score
                };
                1.0 / positive
            })
            .collect(),
    }
}

/// Build the per-sample OOF average surface (block + `y_true`) from the SAME `average`
/// [`PredictionBlock`] and combined `targets` the scalar report was computed from. The block is the
/// sample-level lift of `average` (its sample ids become `Sample` unit ids, values unchanged), keyed
/// identically (producer / `Validation` / `avg`). The `y_true` is `targets` realigned to the block's
/// sample order so a host pairs y_pred ↔ y_true per sample without re-sorting; every `average` sample
/// has a y_true row because [`combine_partition_targets`] pools every per-fold target record and
/// the OOF coverage gate guarantees each averaged sample was validated.
fn oof_average_block(
    average: &PredictionBlock,
    targets: &RegressionTargetBlock,
) -> OofAverageBlock {
    let unit_ids: Vec<PredictionUnitId> = average
        .sample_ids
        .iter()
        .cloned()
        .map(PredictionUnitId::Sample)
        .collect();
    let predictions = AggregatedPredictionBlock {
        prediction_id: None,
        producer_node: average.producer_node.clone(),
        producer_port: average.producer_port.clone(),
        partition: average.partition.clone(),
        fold_id: average.fold_id.clone(),
        level: PredictionLevel::Sample,
        unit_ids: unit_ids.clone(),
        values: average.values.clone(),
        target_names: average.target_names.clone(),
    };
    let target_by_unit: BTreeMap<&PredictionUnitId, &Vec<f64>> =
        targets.unit_ids.iter().zip(&targets.values).collect();
    let mask_by_unit = targets.validity_masks.as_ref().map(|masks| {
        targets
            .unit_ids
            .iter()
            .zip(masks)
            .collect::<BTreeMap<_, _>>()
    });
    let y_true = RegressionTargetBlock {
        validity_masks: mask_by_unit
            .map(|masks| unit_ids.iter().map(|unit| masks[unit].clone()).collect()),
        level: PredictionLevel::Sample,
        unit_ids: unit_ids.clone(),
        values: unit_ids
            .iter()
            .map(|unit_id| target_by_unit[unit_id].clone())
            .collect(),
        target_names: targets.target_names.clone(),
    };
    OofAverageBlock {
        predictions,
        y_true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ids::{FoldId, GroupId, NodeId, SampleId, TargetId};
    use crate::oof::PredictionPartition;

    fn sid(value: &str) -> SampleId {
        SampleId::new(value).unwrap()
    }

    fn sample_unit(value: &str) -> PredictionUnitId {
        PredictionUnitId::Sample(sid(value))
    }

    fn target_unit(value: &str) -> PredictionUnitId {
        PredictionUnitId::Target(TargetId::new(value).unwrap())
    }

    fn group_unit(value: &str) -> PredictionUnitId {
        PredictionUnitId::Group(GroupId::new(value).unwrap())
    }

    fn assert_close(left: f64, right: f64) {
        assert!((left - right).abs() < 1e-12, "expected {right}, got {left}");
    }

    #[test]
    fn weighted_f1_matches_sklearn_multiclass_oracle() {
        let predictions = [0.0, 0.0, 1.0, 1.0, 2.0, 2.0].map(|value| [value]);
        let targets = [0.0, 0.0, 0.0, 1.0, 1.0, 2.0].map(|value| [value]);
        let prediction_rows = predictions
            .iter()
            .map(|row| row.as_slice())
            .collect::<Vec<_>>();
        let target_rows = targets.iter().map(|row| row.as_slice()).collect::<Vec<_>>();
        let scores =
            compute_metric_per_target(RegressionMetricKind::F1, 1, &prediction_rows, &target_rows);
        assert_close(scores[0], 61.0 / 90.0);
        assert_eq!(
            RegressionMetricKind::F1.objective(),
            MetricObjective::Maximize
        );
        assert!(builtin_metric_reference(RegressionMetricKind::F1).is_ok());
    }

    #[test]
    fn multiclass_probability_scores_use_argmax_without_changing_stacking_feature() {
        let producer = NodeId::new("meta:first").unwrap();
        let sample_ids = vec![sid("s:0"), sid("s:1"), sid("s:2")];
        let projected = PredictionBlock {
            prediction_id: None,
            producer_node: producer.clone(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new("fold:0").unwrap()),
            sample_ids: sample_ids.clone(),
            values: vec![vec![0.1], vec![0.2], vec![0.7]],
            target_names: vec!["class".to_string()],
        };
        let probabilities = ClassificationProbabilityBlock {
            producer_node: producer,
            producer_port: None,
            partition: projected.partition.clone(),
            fold_id: projected.fold_id.clone(),
            sample_ids: sample_ids.clone(),
            class_labels: vec![0.0, 1.0, 2.0],
            values: vec![
                vec![0.1, 0.8, 0.1],
                vec![0.2, 0.1, 0.7],
                vec![0.7, 0.2, 0.1],
            ],
        };
        let targets = RegressionTargetBlock {
            validity_masks: None,
            level: PredictionLevel::Sample,
            unit_ids: sample_ids
                .iter()
                .cloned()
                .map(PredictionUnitId::Sample)
                .collect(),
            values: vec![vec![1.0], vec![2.0], vec![0.0]],
            target_names: vec!["class".to_string()],
        };
        let metrics = [
            RegressionMetricKind::Accuracy,
            RegressionMetricKind::BalancedAccuracy,
        ];
        let old = score_regression_prediction_block(&projected, &targets, &metrics).unwrap();
        assert!(old.metrics["accuracy"] < 1.0);
        let scored = score_prediction_with_class_probabilities(
            &projected,
            &probabilities,
            &targets,
            &metrics,
        )
        .unwrap();
        assert_close(scored.metrics["accuracy"], 1.0);
        assert_close(scored.metrics["balanced_accuracy"], 1.0);
        assert_eq!(projected.values, vec![vec![0.1], vec![0.2], vec![0.7]]);
    }

    #[test]
    fn multiclass_oof_average_scores_attested_class_distributions() {
        let producer = NodeId::new("meta:first").unwrap();
        let blocks = [
            ("fold:0", "s:0", 0.1, [0.1, 0.8, 0.1], 1.0),
            ("fold:1", "s:1", 0.2, [0.2, 0.1, 0.7], 2.0),
        ]
        .into_iter()
        .map(|(fold, sample, scalar, row, label)| {
            let fold_id = Some(FoldId::new(fold).unwrap());
            let prediction = PredictionBlock {
                prediction_id: None,
                producer_node: producer.clone(),
                producer_port: None,
                partition: PredictionPartition::Validation,
                fold_id: fold_id.clone(),
                sample_ids: vec![sid(sample)],
                values: vec![vec![scalar]],
                target_names: vec!["class".to_string()],
            };
            let probabilities = ClassificationProbabilityBlock {
                producer_node: producer.clone(),
                producer_port: None,
                partition: PredictionPartition::Validation,
                fold_id: fold_id.clone(),
                sample_ids: vec![sid(sample)],
                class_labels: vec![0.0, 1.0, 2.0],
                values: vec![row.to_vec()],
            };
            let record = RegressionTargetRecord {
                producer_node: producer.clone(),
                producer_port: None,
                variant_id: None,
                partition: PredictionPartition::Validation,
                fold_id,
                block: RegressionTargetBlock {
                    validity_masks: None,
                    level: PredictionLevel::Sample,
                    unit_ids: vec![sample_unit(sample)],
                    values: vec![vec![label]],
                    target_names: vec!["class".to_string()],
                },
            };
            (prediction, probabilities, record)
        })
        .collect::<Vec<_>>();
        let result = cross_fold_validation_reports_with_probabilities(
            &blocks.iter().map(|row| row.0.clone()).collect::<Vec<_>>(),
            &blocks.iter().map(|row| row.1.clone()).collect::<Vec<_>>(),
            &blocks.iter().map(|row| row.2.clone()).collect::<Vec<_>>(),
            &[
                RegressionMetricKind::Accuracy,
                RegressionMetricKind::BalancedAccuracy,
            ],
            FoldPartitionMode::Partition,
        )
        .unwrap();
        assert_eq!(result.reports.len(), 1);
        assert_close(result.reports[0].metrics["accuracy"], 1.0);
        assert_close(result.reports[0].metrics["balanced_accuracy"], 1.0);
        assert_eq!(
            result.oof_averages[0].predictions.values,
            vec![vec![0.1], vec![0.2]]
        );
    }

    #[test]
    fn held_out_test_ensembles_use_matching_fold_validation_scores() {
        let producer = NodeId::new("model:test-ensemble").unwrap();
        let target = RegressionTargetBlock {
            validity_masks: None,
            level: PredictionLevel::Sample,
            unit_ids: vec![sample_unit("test:0"), sample_unit("test:1")],
            values: vec![vec![1.0], vec![3.0]],
            target_names: vec!["y".to_string()],
        };
        let blocks: Vec<_> = [("fold:0", [0.0, 2.0]), ("fold:1", [2.0, 4.0])]
            .into_iter()
            .map(|(fold, values)| PredictionBlock {
                prediction_id: None,
                producer_node: producer.clone(),
                producer_port: Some("prediction".to_string()),
                partition: PredictionPartition::Test,
                fold_id: Some(FoldId::new(fold).unwrap()),
                sample_ids: vec![sid("test:0"), sid("test:1")],
                values: values.into_iter().map(|value| vec![value]).collect(),
                target_names: vec!["y".to_string()],
            })
            .collect();
        let target_records: Vec<_> = blocks
            .iter()
            .map(|block| RegressionTargetRecord {
                producer_node: producer.clone(),
                producer_port: block.producer_port.clone(),
                variant_id: None,
                partition: PredictionPartition::Test,
                fold_id: block.fold_id.clone(),
                block: target.clone(),
            })
            .collect();
        let mut validation_reports = Vec::new();
        for (block, score) in blocks.iter().zip([1.0, 3.0]) {
            let mut report =
                score_regression_prediction_block(block, &target, &[RegressionMetricKind::Rmse])
                    .unwrap();
            report.partition = PredictionPartition::Validation;
            report.metrics.insert("rmse".to_string(), score);
            validation_reports.push(report);
        }
        let result = cross_fold_test_reports(
            &blocks,
            &[],
            &target_records,
            &validation_reports,
            RegressionMetricKind::Rmse,
            &[RegressionMetricKind::Rmse],
        )
        .unwrap();
        assert_eq!(result.reports.len(), 2);
        assert_eq!(result.reports[0].fold_id.as_ref().unwrap().as_str(), "avg");
        assert_close(result.reports[0].metrics["rmse"], 0.0);
        assert_eq!(
            result.reports[1].fold_id.as_ref().unwrap().as_str(),
            "w_avg"
        );
        assert_close(result.reports[1].metrics["rmse"], 0.5);
        assert_eq!(
            result.oof_averages[1].predictions.values,
            vec![vec![0.5], vec![2.5]]
        );
        let sparse_validation = cross_fold_test_reports(
            &blocks,
            &[],
            &target_records,
            &validation_reports[..1],
            RegressionMetricKind::Rmse,
            &[RegressionMetricKind::Rmse],
        )
        .unwrap();
        assert_eq!(sparse_validation.reports.len(), 1);
        assert_eq!(
            sparse_validation.reports[0]
                .fold_id
                .as_ref()
                .unwrap()
                .as_str(),
            "avg"
        );
        assert_close(sparse_validation.reports[0].metrics["rmse"], 0.0);
        let mut incomplete = blocks.clone();
        incomplete[1].sample_ids.pop();
        incomplete[1].values.pop();
        assert!(cross_fold_test_reports(
            &incomplete,
            &[],
            &target_records,
            &validation_reports,
            RegressionMetricKind::Rmse,
            &[RegressionMetricKind::Rmse]
        )
        .is_err());
        assert!(cross_fold_test_reports(
            &blocks,
            &[],
            &target_records,
            &validation_reports,
            RegressionMetricKind::BalancedAccuracy,
            &[RegressionMetricKind::BalancedAccuracy],
        )
        .is_err());
    }

    #[test]
    fn train_fold_ensembles_join_overlapping_training_ids_without_selection_leakage() {
        let producer = NodeId::new("model:train-ensemble").unwrap();
        let blocks: Vec<_> = [
            ("fold:0", vec!["s0", "s1"], vec![0.0, 2.0]),
            ("fold:1", vec!["s1", "s2"], vec![4.0, 6.0]),
        ]
        .into_iter()
        .map(|(fold, ids, values)| PredictionBlock {
            prediction_id: None,
            producer_node: producer.clone(),
            producer_port: Some("prediction".to_string()),
            partition: PredictionPartition::TrainPool,
            fold_id: Some(FoldId::new(fold).unwrap()),
            sample_ids: ids.into_iter().map(sid).collect(),
            values: values.into_iter().map(|value| vec![value]).collect(),
            target_names: vec!["y".to_string()],
        })
        .collect();
        let targets = blocks
            .iter()
            .map(|block| RegressionTargetRecord {
                producer_node: producer.clone(),
                producer_port: block.producer_port.clone(),
                variant_id: None,
                partition: PredictionPartition::TrainPool,
                fold_id: block.fold_id.clone(),
                block: RegressionTargetBlock {
                    validity_masks: None,
                    level: PredictionLevel::Sample,
                    unit_ids: block
                        .sample_ids
                        .iter()
                        .cloned()
                        .map(PredictionUnitId::Sample)
                        .collect(),
                    values: block
                        .sample_ids
                        .iter()
                        .map(|id| {
                            vec![match id.as_str() {
                                "s0" => 0.0,
                                "s1" => 3.0,
                                _ => 6.0,
                            }]
                        })
                        .collect(),
                    target_names: vec!["y".to_string()],
                },
            })
            .collect::<Vec<_>>();
        let validation = blocks
            .iter()
            .zip([1.0, 3.0])
            .map(|(block, rmse)| RegressionMetricReport {
                target_domain: None,
                grouping_key: None,
                prediction_id: None,
                producer_node: block.producer_node.clone(),
                producer_port: block.producer_port.clone(),
                variant_id: None,
                variant_label: None,
                partition: PredictionPartition::Validation,
                fold_id: block.fold_id.clone(),
                level: PredictionLevel::Sample,
                row_count: 1,
                target_width: 1,
                target_names: vec!["y".to_string()],
                metrics: BTreeMap::from([("rmse".to_string(), rmse)]),
            })
            .collect::<Vec<_>>();
        let result = cross_fold_train_reports(
            &blocks,
            &[],
            &targets,
            &validation,
            RegressionMetricKind::Rmse,
            &[RegressionMetricKind::Rmse],
        )
        .unwrap();
        assert_eq!(result.reports.len(), 2);
        assert_eq!(
            result.oof_averages[0].predictions.values,
            vec![vec![0.0], vec![3.0], vec![6.0]]
        );
        assert_eq!(
            result.oof_averages[1].predictions.values,
            vec![vec![0.0], vec![2.5], vec![6.0]]
        );
        assert_close(result.reports[0].metrics["rmse"], 0.0);
        assert_close(result.reports[1].metrics["rmse"], (0.25_f64 / 3.0).sqrt());
    }

    #[test]
    fn held_out_classification_aligns_probabilities_and_never_averages_labels() {
        let producer = NodeId::new("model:classifier").unwrap();
        let target = RegressionTargetBlock {
            validity_masks: None,
            level: PredictionLevel::Sample,
            unit_ids: vec![sample_unit("test:0")],
            values: vec![vec![0.0]],
            target_names: vec!["y".to_string()],
        };
        let blocks = [("fold:0", 0.0), ("fold:1", 2.0)]
            .into_iter()
            .map(|(fold, label)| PredictionBlock {
                prediction_id: None,
                producer_node: producer.clone(),
                producer_port: Some("prediction".to_string()),
                partition: PredictionPartition::Test,
                fold_id: Some(FoldId::new(fold).unwrap()),
                sample_ids: vec![sid("test:0")],
                values: vec![vec![label]],
                target_names: vec!["y".to_string()],
            })
            .collect::<Vec<_>>();
        let probabilities = [
            (vec![0.0, 2.0], vec![0.8, 0.2]),
            (vec![2.0, 0.0], vec![0.7, 0.3]),
        ]
        .into_iter()
        .zip(&blocks)
        .map(
            |((class_labels, values), block)| ClassificationProbabilityBlock {
                producer_node: producer.clone(),
                producer_port: block.producer_port.clone(),
                partition: PredictionPartition::Test,
                fold_id: block.fold_id.clone(),
                sample_ids: vec![sid("test:0")],
                class_labels,
                values: vec![values],
            },
        )
        .collect::<Vec<_>>();
        let targets = blocks
            .iter()
            .map(|block| RegressionTargetRecord {
                producer_node: producer.clone(),
                producer_port: block.producer_port.clone(),
                variant_id: None,
                partition: PredictionPartition::Test,
                fold_id: block.fold_id.clone(),
                block: target.clone(),
            })
            .collect::<Vec<_>>();
        let mut validation = blocks
            .iter()
            .map(|block| {
                let mut report = score_regression_prediction_block(
                    block,
                    &target,
                    &[RegressionMetricKind::BalancedAccuracy],
                )
                .unwrap();
                report.partition = PredictionPartition::Validation;
                report
            })
            .collect::<Vec<_>>();
        validation[0]
            .metrics
            .insert("balanced_accuracy".to_string(), 0.2);
        validation[1]
            .metrics
            .insert("balanced_accuracy".to_string(), 0.8);
        let result = cross_fold_test_reports(
            &blocks,
            &probabilities,
            &targets,
            &validation,
            RegressionMetricKind::BalancedAccuracy,
            &[RegressionMetricKind::BalancedAccuracy],
        )
        .unwrap();
        assert_eq!(result.oof_averages[0].predictions.values, vec![vec![0.0]]);
        assert_eq!(result.oof_averages[1].predictions.values, vec![vec![2.0]]);
        let hard = cross_fold_test_reports(
            &blocks,
            &[],
            &targets,
            &validation,
            RegressionMetricKind::BalancedAccuracy,
            &[RegressionMetricKind::BalancedAccuracy],
        )
        .unwrap();
        assert_eq!(hard.oof_averages[0].predictions.values, vec![vec![0.0]]);
        assert_eq!(hard.oof_averages[1].predictions.values, vec![vec![2.0]]);
        let mut malformed = probabilities.clone();
        malformed[1].values[0] = vec![0.7, 0.7];
        assert!(cross_fold_test_reports(
            &blocks,
            &malformed,
            &targets,
            &validation,
            RegressionMetricKind::BalancedAccuracy,
            &[RegressionMetricKind::BalancedAccuracy],
        )
        .is_err());
    }

    fn masked_fixture() -> (PredictionBlock, RegressionTargetBlock) {
        let predictions = PredictionBlock {
            prediction_id: None,
            producer_node: NodeId::new("model:masked").unwrap(),
            producer_port: Some("prediction".to_string()),
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new("fold:0").unwrap()),
            sample_ids: vec![sid("s1"), sid("s2"), sid("s3")],
            values: vec![vec![2.0, 12.0], vec![4.0, 18.0], vec![6.0, 100.0]],
            target_names: vec!["first".to_string(), "second".to_string()],
        };
        // Target order differs from prediction order; a different subset is observed per output.
        let targets = RegressionTargetBlock {
            level: PredictionLevel::Sample,
            unit_ids: vec![sample_unit("s3"), sample_unit("s1"), sample_unit("s2")],
            values: vec![vec![5.0, 999.0], vec![1.0, 10.0], vec![-999.0, 20.0]],
            validity_masks: Some(vec![vec![true, false], vec![true, true], vec![false, true]]),
            target_names: predictions.target_names.clone(),
        };
        (predictions, targets)
    }

    #[test]
    fn masked_scores_observed_cells_per_target_and_macro_without_dropping_rows() {
        let (predictions, targets) = masked_fixture();
        let metrics = [
            RegressionMetricKind::Rmse,
            RegressionMetricKind::Mse,
            RegressionMetricKind::Mae,
            RegressionMetricKind::R2,
        ];
        let report = score_regression_prediction_block(&predictions, &targets, &metrics).unwrap();
        assert_eq!(report.row_count, 3);
        assert_eq!(report.target_width, 2);
        assert_close(report.metrics["rmse:first"], 1.0);
        assert_close(report.metrics["rmse:second"], 2.0);
        assert_close(report.metrics["rmse"], 1.5);
        assert_close(report.metrics["mse"], 2.5);
        assert_close(report.metrics["mae"], 1.5);
        assert_close(report.metrics["r2:first"], 0.75);
        assert_close(report.metrics["r2:second"], 0.84);
        assert_close(report.metrics["r2"], 0.795);
        let mut changed = targets.clone();
        changed.values[0][1] = -1e100;
        changed.values[2][0] = 1e100;
        assert_eq!(
            report,
            score_regression_prediction_block(&predictions, &changed, &metrics).unwrap()
        );
        assert_eq!(
            targets.canonicalized().unwrap(),
            changed.canonicalized().unwrap()
        );
        assert_eq!(
            targets.canonicalized().unwrap().values,
            vec![vec![5.0, 0.0], vec![1.0, 10.0], vec![0.0, 20.0]]
        );
    }

    #[test]
    fn masked_target_contract_rejects_shape_nonfinite_and_unobserved_output() {
        let (predictions, targets) = masked_fixture();
        for mask in [vec![], vec![vec![true]; 3], vec![vec![true, true]; 2]] {
            let mut invalid = targets.clone();
            invalid.validity_masks = Some(mask);
            assert!(invalid
                .validate_shape()
                .unwrap_err()
                .to_string()
                .contains("validity_masks shape"));
        }
        let mut invalid = targets.clone();
        invalid.values[0][1] = f64::NAN;
        assert!(invalid
            .validate_shape()
            .unwrap_err()
            .to_string()
            .contains("non-finite"));
        for mask in [vec![vec![false, false]; 3], vec![vec![true, false]; 3]] {
            let mut invalid = targets.clone();
            invalid.validity_masks = Some(mask);
            let error = score_regression_prediction_block(
                &predictions,
                &invalid,
                &[RegressionMetricKind::Rmse],
            )
            .unwrap_err();
            assert!(error.to_string().contains("no observed values"), "{error}");
        }
        let mut invalid = serde_json::to_value(&targets).unwrap();
        invalid["validity_masks"][0][0] = serde_json::json!(1);
        assert!(serde_json::from_value::<RegressionTargetBlock>(invalid).is_err());
    }

    #[test]
    fn absent_and_all_observed_masks_preserve_original_scores_and_wire_contract() {
        let (predictions, mut targets) = masked_fixture();
        targets.validity_masks = None;
        let legacy = serde_json::to_value(&targets).unwrap();
        assert!(legacy.get("validity_masks").is_none());
        assert_eq!(
            serde_json::from_value::<RegressionTargetBlock>(legacy.clone()).unwrap(),
            targets
        );
        let mut null = legacy;
        null["validity_masks"] = serde_json::Value::Null;
        assert_eq!(
            serde_json::from_value::<RegressionTargetBlock>(null).unwrap(),
            targets
        );
        let expected = score_regression_prediction_block(
            &predictions,
            &targets,
            &[RegressionMetricKind::Rmse],
        )
        .unwrap();
        targets.validity_masks = Some(vec![vec![true, true]; 3]);
        assert_eq!(
            score_regression_prediction_block(
                &predictions,
                &targets,
                &[RegressionMetricKind::Rmse]
            )
            .unwrap(),
            expected
        );
        assert_eq!(
            serde_json::from_value::<RegressionTargetBlock>(
                serde_json::to_value(&targets).unwrap()
            )
            .unwrap(),
            targets
        );
    }

    #[test]
    fn masked_oof_preserves_identity_masks_and_ignores_hidden_conflicts() {
        let (predictions, targets) = masked_fixture();
        let mut second = predictions.clone();
        second.fold_id = Some(FoldId::new("fold:1").unwrap());
        let record =
            |block: &PredictionBlock, targets: RegressionTargetBlock| RegressionTargetRecord {
                producer_node: block.producer_node.clone(),
                producer_port: block.producer_port.clone(),
                variant_id: None,
                partition: block.partition.clone(),
                fold_id: block.fold_id.clone(),
                block: targets,
            };
        let mut changed = targets.clone();
        changed.values[0][1] = -1000.0;
        let records = vec![
            record(&predictions, targets.clone()),
            record(&second, changed),
        ];
        let result = cross_fold_validation_reports(
            &[predictions.clone(), second.clone()],
            &records,
            &[RegressionMetricKind::Rmse],
            FoldPartitionMode::Resampled,
        )
        .unwrap();
        let average = &result.oof_averages[0];
        assert_eq!(
            average.predictions.unit_ids,
            vec![sample_unit("s1"), sample_unit("s2"), sample_unit("s3")]
        );
        assert_eq!(average.y_true.unit_ids, average.predictions.unit_ids);
        assert_eq!(
            average.y_true.validity_masks,
            Some(vec![vec![true, true], vec![false, true], vec![true, false]])
        );
        assert_eq!(
            average.y_true.values,
            vec![vec![1.0, 10.0], vec![0.0, 20.0], vec![5.0, 0.0]]
        );
        assert_eq!(average.predictions.values, predictions.values);
        assert_eq!(result.reports[0].row_count, 3);
        assert_close(result.reports[0].metrics["rmse"], 1.5);
        let mut conflicting = records;
        conflicting[1].block.validity_masks.as_mut().unwrap()[0][1] = true;
        assert!(cross_fold_validation_reports(
            &[predictions, second],
            &conflicting,
            &[RegressionMetricKind::Rmse],
            FoldPartitionMode::Resampled
        )
        .unwrap_err()
        .to_string()
        .contains("conflicting ground truth"));
    }

    #[test]
    fn masked_targets_refuse_group_scoring_and_merge_aggregation() {
        let (predictions, mut targets) = masked_fixture();
        let grouped = AggregatedPredictionBlock {
            prediction_id: None,
            producer_node: predictions.producer_node,
            producer_port: predictions.producer_port,
            partition: predictions.partition,
            fold_id: predictions.fold_id,
            level: PredictionLevel::Group,
            unit_ids: vec![group_unit("s1"), group_unit("s2"), group_unit("s3")],
            values: predictions.values,
            target_names: predictions.target_names,
        };
        targets.level = PredictionLevel::Group;
        targets.unit_ids = vec![group_unit("s3"), group_unit("s1"), group_unit("s2")];
        assert!(score_regression_aggregated_block(
            &grouped,
            &targets,
            &[RegressionMetricKind::Rmse]
        )
        .unwrap_err()
        .to_string()
        .contains("unsupported"));
        assert!(targets
            .require_complete_targets("prediction merge/late fusion")
            .unwrap_err()
            .to_string()
            .contains("prediction merge/late fusion"));
    }

    #[test]
    fn metric_objectives_match_selection_direction() {
        assert_eq!(
            RegressionMetricKind::Rmse.objective(),
            MetricObjective::Minimize
        );
        assert_eq!(
            RegressionMetricKind::Mae.objective(),
            MetricObjective::Minimize
        );
        assert_eq!(
            RegressionMetricKind::Mse.objective(),
            MetricObjective::Minimize
        );
        assert_eq!(
            RegressionMetricKind::R2.objective(),
            MetricObjective::Maximize
        );
    }

    #[test]
    fn reassemble_merge_targets_empty_map_is_unscored_none() {
        // No contributing branch emitted targets: the merge is legitimately unscored.
        let producer = NodeId::new("merge:m").unwrap();
        let mut by_sample: BTreeMap<SampleId, Vec<f64>> = BTreeMap::new();
        let block = reassemble_merge_targets(
            &producer,
            &[sid("s1"), sid("s2")],
            &mut by_sample,
            vec!["y".to_string()],
        )
        .unwrap();
        assert!(
            block.is_none(),
            "empty targets -> unscored None, not an error"
        );
    }

    #[test]
    fn reassemble_merge_targets_complete_coverage_emits_ordered_block() {
        let producer = NodeId::new("merge:m").unwrap();
        let mut by_sample: BTreeMap<SampleId, Vec<f64>> = BTreeMap::new();
        by_sample.insert(sid("s2"), vec![20.0]);
        by_sample.insert(sid("s1"), vec![10.0]);
        let block = reassemble_merge_targets(
            &producer,
            &[sid("s1"), sid("s2")],
            &mut by_sample,
            vec!["y".to_string()],
        )
        .unwrap()
        .expect("complete coverage -> a target block");
        // Emitted in the merge's declared sample order, not map order.
        assert_eq!(
            block.unit_ids,
            vec![sample_unit("s1"), sample_unit("s2")],
            "targets follow the merge sample order"
        );
        assert_eq!(block.values, vec![vec![10.0], vec![20.0]]);
        assert_eq!(block.level, PredictionLevel::Sample);
        block.validate_shape().unwrap();
    }

    #[test]
    fn reassemble_merge_targets_partial_coverage_is_validation_error() {
        // R-P1-9: one branch contributed a target (s1) but the merge universe also
        // covers s2, which has no y_true row. Previously this silently dropped the
        // targets (no score); it must now be a hard validation error.
        let producer = NodeId::new("merge:m").unwrap();
        let mut by_sample: BTreeMap<SampleId, Vec<f64>> = BTreeMap::new();
        by_sample.insert(sid("s1"), vec![10.0]);
        let err = reassemble_merge_targets(
            &producer,
            &[sid("s1"), sid("s2")],
            &mut by_sample,
            vec!["y".to_string()],
        )
        .unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains("partial target coverage") && msg.contains("s2"),
            "partial coverage names the missing sample: {msg}"
        );
    }

    #[test]
    fn scores_sample_predictions_and_exports_candidate_metrics() {
        let predictions = PredictionBlock {
            prediction_id: Some("pred:sample".to_string()),
            producer_node: NodeId::new("model:pls").unwrap(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: None,
            sample_ids: vec![sid("sample:1"), sid("sample:2")],
            values: vec![vec![2.0], vec![4.0]],
            target_names: vec!["y".to_string()],
        };
        let targets = RegressionTargetBlock {
            validity_masks: None,
            level: PredictionLevel::Sample,
            unit_ids: vec![sample_unit("sample:2"), sample_unit("sample:1")],
            values: vec![vec![5.0], vec![1.0]],
            target_names: vec!["y".to_string()],
        };

        let report = score_regression_prediction_block(
            &predictions,
            &targets,
            &[
                RegressionMetricKind::Rmse,
                RegressionMetricKind::Mae,
                RegressionMetricKind::R2,
            ],
        )
        .unwrap();

        assert_eq!(report.level, PredictionLevel::Sample);
        assert_close(report.metrics["rmse"], 1.0);
        assert_close(report.metrics["rmse:y"], 1.0);
        assert_close(report.metrics["mae"], 1.0);
        assert_close(report.metrics["r2"], 0.75);
        let candidate = regression_report_to_candidate_score("model:pls", report).unwrap();
        assert_eq!(candidate.metrics["rmse"], 1.0);
        assert_eq!(candidate.metadata["metric_level"], "sample");
        assert_eq!(candidate.metadata["producer_node"], "model:pls");
        assert_eq!(candidate.metadata["partition"], "validation");
        assert_eq!(candidate.metadata["prediction_id"], "pred:sample");
        assert_eq!(candidate.metadata["target_names"], serde_json::json!(["y"]));
    }

    #[test]
    fn provider_adapter_preserves_display_target_names_with_spaces() {
        let predictions = PredictionBlock {
            prediction_id: None,
            producer_node: NodeId::new("model:pls").unwrap(),
            producer_port: Some("prediction".to_string()),
            partition: PredictionPartition::Validation,
            fold_id: None,
            sample_ids: vec![sid("sample:1"), sid("sample:2")],
            values: vec![vec![2.0], vec![4.0]],
            target_names: vec!["protein content".to_string()],
        };
        let targets = RegressionTargetBlock {
            validity_masks: None,
            level: PredictionLevel::Sample,
            unit_ids: vec![sample_unit("sample:1"), sample_unit("sample:2")],
            values: vec![vec![1.0], vec![5.0]],
            target_names: vec!["protein content".to_string()],
        };

        let report = score_regression_prediction_block(
            &predictions,
            &targets,
            &[RegressionMetricKind::Rmse],
        )
        .unwrap();
        assert_close(report.metrics["rmse"], 1.0);
        assert_close(report.metrics["rmse:protein content"], 1.0);
    }

    #[test]
    fn scores_target_and_group_prediction_blocks() {
        let predictions = AggregatedPredictionBlock {
            prediction_id: Some("pred:target".to_string()),
            producer_node: NodeId::new("model:pls").unwrap(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: None,
            level: PredictionLevel::Target,
            unit_ids: vec![target_unit("target:a"), target_unit("target:b")],
            values: vec![vec![1.0, 10.0], vec![3.0, 30.0]],
            target_names: vec!["y1".to_string(), "y2".to_string()],
        };
        let targets = RegressionTargetBlock {
            validity_masks: None,
            level: PredictionLevel::Target,
            unit_ids: vec![target_unit("target:b"), target_unit("target:a")],
            values: vec![vec![2.0, 28.0], vec![2.0, 12.0]],
            target_names: vec!["y1".to_string(), "y2".to_string()],
        };
        let report = score_regression_aggregated_block(
            &predictions,
            &targets,
            &[RegressionMetricKind::Mse, RegressionMetricKind::Rmse],
        )
        .unwrap();

        assert_eq!(report.level, PredictionLevel::Target);
        assert_close(report.metrics["mse:y1"], 1.0);
        assert_close(report.metrics["mse:y2"], 4.0);
        assert_close(report.metrics["mse"], 2.5);
        assert_close(report.metrics["rmse:y1"], 1.0);
        assert_close(report.metrics["rmse:y2"], 2.0);
        assert_close(report.metrics["rmse"], 1.5);

        let group_predictions = AggregatedPredictionBlock {
            prediction_id: Some("pred:group".to_string()),
            producer_node: NodeId::new("model:pls").unwrap(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: None,
            level: PredictionLevel::Group,
            unit_ids: vec![group_unit("group:a")],
            values: vec![vec![3.0]],
            target_names: vec!["y".to_string()],
        };
        let group_targets = RegressionTargetBlock {
            validity_masks: None,
            level: PredictionLevel::Group,
            unit_ids: vec![group_unit("group:a")],
            values: vec![vec![1.0]],
            target_names: vec!["y".to_string()],
        };
        let group_report = score_regression_aggregated_block(
            &group_predictions,
            &group_targets,
            &[RegressionMetricKind::Mae],
        )
        .unwrap();
        assert_eq!(group_report.level, PredictionLevel::Group);
        assert_close(group_report.metrics["mae"], 2.0);
    }

    #[test]
    fn refuses_metric_alignment_and_contract_mismatches() {
        let predictions = AggregatedPredictionBlock {
            prediction_id: None,
            producer_node: NodeId::new("model:pls").unwrap(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: None,
            level: PredictionLevel::Target,
            unit_ids: vec![target_unit("target:a")],
            values: vec![vec![1.0]],
            target_names: vec!["y".to_string()],
        };
        let missing_target = RegressionTargetBlock {
            validity_masks: None,
            level: PredictionLevel::Target,
            unit_ids: vec![target_unit("target:b")],
            values: vec![vec![1.0]],
            target_names: vec!["y".to_string()],
        };
        assert!(score_regression_aggregated_block(
            &predictions,
            &missing_target,
            &[RegressionMetricKind::Rmse],
        )
        .is_err());

        let wrong_level = RegressionTargetBlock {
            validity_masks: None,
            level: PredictionLevel::Group,
            unit_ids: vec![group_unit("group:a")],
            values: vec![vec![1.0]],
            target_names: vec!["y".to_string()],
        };
        assert!(score_regression_aggregated_block(
            &predictions,
            &wrong_level,
            &[RegressionMetricKind::Rmse],
        )
        .is_err());

        assert!(score_regression_aggregated_block(&predictions, &missing_target, &[]).is_err());
        assert!(score_regression_aggregated_block(
            &predictions,
            &RegressionTargetBlock {
                validity_masks: None,
                level: PredictionLevel::Target,
                unit_ids: vec![target_unit("target:a")],
                values: vec![vec![1.0]],
                target_names: vec!["other".to_string()],
            },
            &[RegressionMetricKind::Rmse],
        )
        .is_err());
        assert!(score_regression_aggregated_block(
            &predictions,
            &RegressionTargetBlock {
                validity_masks: None,
                level: PredictionLevel::Target,
                unit_ids: vec![target_unit("target:a")],
                values: vec![vec![1.0]],
                target_names: vec!["y".to_string()],
            },
            &[RegressionMetricKind::Rmse, RegressionMetricKind::Rmse],
        )
        .is_err());
    }

    #[test]
    fn refuses_duplicate_and_non_finite_sample_predictions() {
        let targets = RegressionTargetBlock {
            validity_masks: None,
            level: PredictionLevel::Sample,
            unit_ids: vec![sample_unit("sample:1")],
            values: vec![vec![1.0]],
            target_names: vec!["y".to_string()],
        };
        let mut predictions = PredictionBlock {
            prediction_id: None,
            producer_node: NodeId::new("model:pls").unwrap(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: None,
            sample_ids: vec![sid("sample:1")],
            values: vec![vec![f64::INFINITY]],
            target_names: vec!["y".to_string()],
        };
        assert!(score_regression_prediction_block(
            &predictions,
            &targets,
            &[RegressionMetricKind::Rmse],
        )
        .is_err());

        predictions.values = vec![vec![1.0], vec![1.0]];
        predictions.sample_ids = vec![sid("sample:1"), sid("sample:1")];
        assert!(score_regression_prediction_block(
            &predictions,
            &targets,
            &[RegressionMetricKind::Rmse],
        )
        .is_err());
    }

    #[test]
    fn constant_target_r2_is_finite_and_deterministic() {
        let targets = RegressionTargetBlock {
            validity_masks: None,
            level: PredictionLevel::Sample,
            unit_ids: vec![sample_unit("sample:1"), sample_unit("sample:2")],
            values: vec![vec![2.0], vec![2.0]],
            target_names: vec!["y".to_string()],
        };
        let exact_predictions = PredictionBlock {
            prediction_id: None,
            producer_node: NodeId::new("model:exact").unwrap(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: None,
            sample_ids: vec![sid("sample:1"), sid("sample:2")],
            values: vec![vec![2.0], vec![2.0]],
            target_names: vec!["y".to_string()],
        };
        let exact_report = score_regression_prediction_block(
            &exact_predictions,
            &targets,
            &[RegressionMetricKind::R2],
        )
        .unwrap();
        assert_close(exact_report.metrics["r2"], 1.0);

        let off_predictions = PredictionBlock {
            values: vec![vec![2.0], vec![3.0]],
            ..exact_predictions
        };
        let off_report = score_regression_prediction_block(
            &off_predictions,
            &targets,
            &[RegressionMetricKind::R2],
        )
        .unwrap();
        assert_close(off_report.metrics["r2"], 0.0);
    }

    fn score_report(
        partition: PredictionPartition,
        fold: Option<&str>,
        rmse: f64,
    ) -> RegressionMetricReport {
        RegressionMetricReport {
            target_domain: None,
            grouping_key: None,
            prediction_id: None,
            producer_node: NodeId::new("model:compat.0").unwrap(),
            producer_port: None,
            variant_id: None,
            variant_label: None,
            partition,
            fold_id: fold.map(|value| FoldId::new(value).unwrap()),
            level: PredictionLevel::Sample,
            row_count: 10,
            target_width: 1,
            target_names: vec!["y".to_string()],
            metrics: BTreeMap::from([("rmse".to_string(), rmse), ("r2".to_string(), 0.5)]),
        }
    }

    fn score_report_for_port(
        port: Option<&str>,
        partition: PredictionPartition,
        fold: Option<&str>,
        rmse: f64,
    ) -> RegressionMetricReport {
        RegressionMetricReport {
            target_domain: None,
            producer_port: port.map(ToString::to_string),
            ..score_report(partition, fold, rmse)
        }
    }

    #[test]
    fn score_set_round_trips_validates_and_rejects_duplicates() {
        let set = ScoreSet {
            schema_version: LEGACY_SCORE_SET_SCHEMA_VERSION,
            plan_id: "plan:demo".to_string(),
            selection_metric: Some("rmse".to_string()),
            reports: vec![
                score_report(PredictionPartition::Validation, Some("avg"), 18.75),
                score_report(PredictionPartition::Test, Some("final"), 13.28),
            ],
        };
        set.validate().unwrap();

        // JSON round-trip is lossless.
        let json = serde_json::to_string(&set).unwrap();
        let back: ScoreSet = serde_json::from_str(&json).unwrap();
        assert_eq!(back, set);

        // schema_version defaults when omitted (forward-compatible read).
        let parsed: ScoreSet =
            serde_json::from_value(serde_json::json!({"plan_id": "p", "reports": []})).unwrap();
        assert_eq!(parsed.schema_version, LEGACY_SCORE_SET_SCHEMA_VERSION);

        // Sibling ports of the same node are distinct score identities.
        let siblings = ScoreSet {
            schema_version: SCORE_SET_SCHEMA_VERSION,
            reports: vec![
                score_report_for_port(Some("pred"), PredictionPartition::Test, Some("final"), 1.0),
                score_report_for_port(Some("aux"), PredictionPartition::Test, Some("final"), 2.0),
            ],
            ..set.clone()
        };
        siblings.validate().unwrap();

        // Duplicate (producer_node, producer_port, partition, fold_id, level) is rejected.
        let dup = ScoreSet {
            schema_version: SCORE_SET_SCHEMA_VERSION,
            reports: vec![
                score_report_for_port(Some("pred"), PredictionPartition::Test, Some("final"), 1.0),
                score_report_for_port(Some("pred"), PredictionPartition::Test, Some("final"), 2.0),
            ],
            ..set.clone()
        };
        assert!(dup.validate().is_err());

        // Families are all-or-nothing: V1 forbids ports; V2 requires them.
        let legacy_with_port = ScoreSet {
            reports: vec![score_report_for_port(
                Some("pred"),
                PredictionPartition::Test,
                Some("final"),
                1.0,
            )],
            ..set.clone()
        };
        assert!(legacy_with_port.validate().is_err());
        let v2_without_port = ScoreSet {
            schema_version: SCORE_SET_SCHEMA_VERSION,
            reports: vec![score_report(PredictionPartition::Test, Some("final"), 1.0)],
            ..set.clone()
        };
        assert!(v2_without_port.validate().is_err());

        // Empty plan_id is rejected.
        let blank = ScoreSet {
            plan_id: "  ".to_string(),
            reports: vec![score_report(PredictionPartition::Test, Some("final"), 1.0)],
            ..set
        };
        assert!(blank.validate().is_err());
    }

    #[test]
    fn accuracy_and_balanced_accuracy_match_sklearn_on_imbalanced_classification() {
        // #60 root-cause lock: dag-ml emits BOTH plain `accuracy` and `balanced_accuracy`. nirs4all's
        // DEFAULT classification ranking metric is balanced_accuracy (its `_resolve_effective_metric`),
        // so the legacy `cv_best_score` for a classification sweep is balanced_accuracy — NOT plain
        // accuracy. A class-collapsed predictor on imbalanced data makes the two diverge sharply (the
        // 0.32-vs-0.16 STOP report). Ground truth here is scikit-learn on the same labels:
        //   y    = [0,0,0,0,0,0, 1,1, 2,2]  (majority class 0)
        //   pred = [0,0,0,0,0,0, 1,0, 0,0]  (collapses wrong rows to class 0)
        //   accuracy_score          = 7/10 = 0.70
        //   balanced_accuracy_score = mean(recall(c0)=6/6, recall(c1)=1/2, recall(c2)=0/2) = 0.50
        let predictions = PredictionBlock {
            prediction_id: Some("pred:classif".to_string()),
            producer_node: NodeId::new("model:rf").unwrap(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: None,
            sample_ids: (0..10).map(|i| sid(&format!("s{i}"))).collect(),
            values: vec![
                vec![0.0],
                vec![0.0],
                vec![0.0],
                vec![0.0],
                vec![0.0],
                vec![0.0],
                vec![1.0],
                vec![0.0],
                vec![0.0],
                vec![0.0],
            ],
            target_names: vec!["y".to_string()],
        };
        let targets = RegressionTargetBlock {
            validity_masks: None,
            level: PredictionLevel::Sample,
            unit_ids: (0..10).map(|i| sample_unit(&format!("s{i}"))).collect(),
            values: vec![
                vec![0.0],
                vec![0.0],
                vec![0.0],
                vec![0.0],
                vec![0.0],
                vec![0.0],
                vec![1.0],
                vec![1.0],
                vec![2.0],
                vec![2.0],
            ],
            target_names: vec!["y".to_string()],
        };

        let report = score_regression_prediction_block(
            &predictions,
            &targets,
            &[
                RegressionMetricKind::Accuracy,
                RegressionMetricKind::BalancedAccuracy,
            ],
        )
        .unwrap();

        assert_close(report.metrics["accuracy"], 0.70);
        assert_close(report.metrics["balanced_accuracy"], 0.50);
        // Both maximize — the host SELECT ranks them in the same direction.
        assert_eq!(
            RegressionMetricKind::BalancedAccuracy.objective(),
            MetricObjective::Maximize
        );
    }

    #[test]
    fn cross_fold_balanced_accuracy_pools_oof_and_matches_sklearn() {
        // The real #60 path: per-fold VALIDATION OOF blocks pooled into the `avg` report (nirs4all's
        // `cv_best_score` row), scored against the combined y_true. Two disjoint KFold folds carry the
        // same imbalanced class-collapse as the per-block lock above, so the POOLED OOF accuracy is
        // 0.70 and pooled balanced_accuracy is 0.50 — proving the cross-fold reduction + metric agree
        // with scikit-learn's `accuracy_score` / `balanced_accuracy_score` on the same labels, and that
        // dag-ml's `accuracy` (0.70) was never wrong: it is simply a DIFFERENT metric from the legacy's
        // default `balanced_accuracy` (0.50).
        let model = NodeId::new("model:rf").unwrap();
        let fold_block = |fold: &str, ids: &[usize], preds: &[f64]| PredictionBlock {
            prediction_id: Some(format!("pred:{fold}")),
            producer_node: model.clone(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new(fold).unwrap()),
            sample_ids: ids.iter().map(|i| sid(&format!("s{i}"))).collect(),
            values: preds.iter().map(|p| vec![*p]).collect(),
            target_names: vec!["y".to_string()],
        };
        let target_record = |fold: &str, ids: &[usize], trues: &[f64]| RegressionTargetRecord {
            producer_node: model.clone(),
            producer_port: None,
            variant_id: None,
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new(fold).unwrap()),
            block: RegressionTargetBlock {
                validity_masks: None,
                level: PredictionLevel::Sample,
                unit_ids: ids.iter().map(|i| sample_unit(&format!("s{i}"))).collect(),
                values: trues.iter().map(|t| vec![*t]).collect(),
                target_names: vec!["y".to_string()],
            },
        };

        // Fold 0 (samples 0..5): preds [0,0,0,1,0] vs true [0,0,0,1,2]
        // Fold 1 (samples 5..10): preds [0,0,0,0,0] vs true [0,0,0,1,2]
        // Pooled: true=[0,0,0,1,2,0,0,0,1,2], pred=[0,0,0,1,0,0,0,0,0,0]
        //   accuracy          = 7/10 = 0.70
        //   balanced_accuracy = mean(recall0=6/6, recall1=1/2, recall2=0/2) = 0.50
        let f0 = (0..5).collect::<Vec<_>>();
        let f1 = (5..10).collect::<Vec<_>>();
        let blocks = vec![
            fold_block("0", &f0, &[0.0, 0.0, 0.0, 1.0, 0.0]),
            fold_block("1", &f1, &[0.0, 0.0, 0.0, 0.0, 0.0]),
        ];
        let targets = vec![
            target_record("0", &f0, &[0.0, 0.0, 0.0, 1.0, 2.0]),
            target_record("1", &f1, &[0.0, 0.0, 0.0, 1.0, 2.0]),
        ];

        let outcome = cross_fold_validation_reports(
            &blocks,
            &targets,
            &[
                RegressionMetricKind::Accuracy,
                RegressionMetricKind::BalancedAccuracy,
            ],
            FoldPartitionMode::Partition,
        )
        .unwrap();

        assert_eq!(
            outcome.reports.len(),
            1,
            "one pooled `avg` report for the producer"
        );
        let avg = &outcome.reports[0];
        assert_eq!(avg.fold_id, Some(FoldId::new("avg").unwrap()));
        assert_eq!(avg.row_count, 10, "all OOF samples pooled exactly once");
        assert_close(avg.metrics["accuracy"], 0.70);
        assert_close(avg.metrics["balanced_accuracy"], 0.50);

        // Additive per-sample OOF average surface: one block per scored producer, keyed identically to
        // the scalar report (producer / Validation / avg), with the SAME pooled values and one y_true
        // row per averaged sample (same id set), realigned to the block's sample order.
        assert_eq!(outcome.oof_averages.len(), 1, "one OOF average block");
        let oof = &outcome.oof_averages[0];
        assert_eq!(oof.predictions.partition, PredictionPartition::Validation);
        assert_eq!(oof.predictions.fold_id, Some(FoldId::new("avg").unwrap()));
        assert_eq!(oof.predictions.level, PredictionLevel::Sample);
        assert_eq!(oof.predictions.unit_ids.len(), 10);
        assert_eq!(oof.y_true.unit_ids, oof.predictions.unit_ids);
        // The pooled per-sample preds are the across-fold mean (each KFold sample validated once):
        // [0,0,0,1,0] ++ [0,0,0,0,0] against y_true [0,0,0,1,2] ++ [0,0,0,1,2].
        assert_eq!(
            oof.predictions.values,
            vec![
                vec![0.0],
                vec![0.0],
                vec![0.0],
                vec![1.0],
                vec![0.0],
                vec![0.0],
                vec![0.0],
                vec![0.0],
                vec![0.0],
                vec![0.0],
            ]
        );
        assert_eq!(
            oof.y_true.values,
            vec![
                vec![0.0],
                vec![0.0],
                vec![0.0],
                vec![1.0],
                vec![2.0],
                vec![0.0],
                vec![0.0],
                vec![0.0],
                vec![1.0],
                vec![2.0],
            ]
        );
    }
}
