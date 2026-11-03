//! Leakage-checked, sample-keyed targets for a second-stage residual learner.
//!
//! The caller supplies the base model's validation predictions from an inner
//! FoldSet over the learner's training universe. The FoldSet must be scoped to
//! the current outer fold during CV; a global OOF set would let outer-validation
//! targets influence residual targets used to fit the learner.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::error::{DagMlError, Result};
use crate::fold::FoldSet;
use crate::ids::{FoldId, VariantId};
use crate::ids::{NodeId, SampleId};
use crate::oof::{
    validate_prediction_blocks_against_folds, validate_producer_oof_coverage, PredictionBlock,
    PredictionPartition,
};

/// An OOF-derived target view in the exact order declared by its FoldSet.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ResidualTargetSet {
    pub base_producer: NodeId,
    pub sample_ids: Vec<SampleId>,
    pub values: Vec<Vec<f64>>,
    pub target_names: Vec<String>,
}

/// Gate policy for a residual learner. `Automatic` is estimated solely from
/// the learner's OOF predictions over the residual training universe.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub enum ResidualGate {
    Disabled,
    Fixed(f64),
    Automatic { rli_threshold: f64 },
}

/// A calibrated scalar and the residual-learnability index used to derive it.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct ResidualGateResult {
    pub gate: f64,
    pub rli: f64,
}

/// Persisted calibration evidence for one selected variant and scope.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResidualGateRecord {
    pub variant_id: Option<VariantId>,
    pub fold_id: Option<FoldId>,
    pub gate: f64,
    pub rli: f64,
}

/// Calibrate the learner weight from OOF rows, joined by sample identity.
///
/// The caller must supply learner predictions over the exact universe of the
/// base OOF-derived residual targets. No held-out/test prediction is accepted
/// here; using one to choose the gate would leak the evaluation targets.
pub fn calibrate_residual_gate(
    targets: &ResidualTargetSet,
    learner_oof: &BTreeMap<SampleId, Vec<f64>>,
    policy: ResidualGate,
) -> Result<ResidualGateResult> {
    let samples = targets.sample_ids.iter().cloned().collect::<BTreeSet<_>>();
    if samples.len() != targets.sample_ids.len()
        || learner_oof.keys().cloned().collect::<BTreeSet<_>>() != samples
    {
        return Err(DagMlError::OofValidation(
            "residual gate requires learner OOF over exactly the residual target samples"
                .to_string(),
        ));
    }
    let width = targets.values.first().map_or(0, Vec::len);
    if width == 0 || targets.values.len() != targets.sample_ids.len() {
        return Err(DagMlError::OofValidation(
            "residual gate received malformed residual targets".to_string(),
        ));
    }
    let mut residual: Vec<f64> = Vec::with_capacity(targets.values.len() * width);
    let mut learner: Vec<f64> = Vec::with_capacity(targets.values.len() * width);
    for (sample, row) in targets.sample_ids.iter().zip(&targets.values) {
        let prediction = &learner_oof[sample];
        if row.len() != width
            || prediction.len() != width
            || row.iter().chain(prediction).any(|value| !value.is_finite())
        {
            return Err(DagMlError::OofValidation(format!(
                "residual gate requires {width} finite target and learner values for sample `{sample}`"
            )));
        }
        residual.extend(row);
        learner.extend(prediction);
    }
    let threshold = match policy {
        ResidualGate::Disabled => 0.0,
        ResidualGate::Fixed(value) => value,
        ResidualGate::Automatic { rli_threshold } => rli_threshold,
    };
    if !threshold.is_finite() {
        return Err(DagMlError::OofValidation(
            "residual gate policy must be finite".to_string(),
        ));
    }
    let mean = residual.iter().sum::<f64>() / residual.len() as f64;
    let variance = residual
        .iter()
        .map(|value| (value - mean).powi(2))
        .sum::<f64>()
        / residual.len() as f64;
    let sd = variance.sqrt();
    let sd = if sd == 0.0 { 1.0 } else { sd };
    let rmse = (residual
        .iter()
        .zip(&learner)
        .map(|(target, prediction)| (target - prediction).powi(2))
        .sum::<f64>()
        / residual.len() as f64)
        .sqrt();
    let rli = 1.0 - rmse / sd;
    let gate = match policy {
        ResidualGate::Disabled => 1.0,
        ResidualGate::Fixed(value) => value,
        ResidualGate::Automatic { rli_threshold } => {
            let denominator = learner.iter().map(|value| value * value).sum::<f64>();
            let fitted = if denominator > 1e-12 {
                residual
                    .iter()
                    .zip(&learner)
                    .map(|(target, prediction)| target * prediction)
                    .sum::<f64>()
                    / denominator
            } else {
                0.0
            };
            if rli <= rli_threshold {
                0.0
            } else {
                fitted.clamp(0.0, 1.0)
            }
        }
    };
    Ok(ResidualGateResult { gate, rli })
}

/// Compose base and learner predictions by sample key after the OOF gate has
/// been calibrated. This is the same operation for CV validation and replay.
pub fn fuse_residual_predictions(
    base: &BTreeMap<SampleId, Vec<f64>>,
    learner: &BTreeMap<SampleId, Vec<f64>>,
    lambda: f64,
    gate: ResidualGateResult,
) -> Result<BTreeMap<SampleId, Vec<f64>>> {
    if !lambda.is_finite() || !gate.gate.is_finite() {
        return Err(DagMlError::OofValidation(
            "residual fusion requires finite lambda and gate".to_string(),
        ));
    }
    if base.is_empty() || base.keys().ne(learner.keys()) {
        return Err(DagMlError::OofValidation(
            "residual fusion requires matching non-empty base and learner sample identities"
                .to_string(),
        ));
    }
    base.iter()
        .map(|(sample, base_row)| {
            let learner_row = &learner[sample];
            if base_row.is_empty()
                || base_row.len() != learner_row.len()
                || base_row.iter().chain(learner_row).any(|value| !value.is_finite())
            {
                return Err(DagMlError::OofValidation(format!(
                    "residual fusion received inconsistent finite prediction widths for sample `{sample}`"
                )));
            }
            let fused = base_row
                .iter()
                .zip(learner_row)
                .map(|(base, learned)| base + lambda * gate.gate * learned)
                .collect::<Vec<_>>();
            if fused.iter().any(|value| !value.is_finite()) {
                return Err(DagMlError::OofValidation(format!(
                    "residual fusion is non-finite for sample `{sample}`"
                )));
            }
            Ok((sample.clone(), fused))
        })
        .collect()
}

/// Derive `observed - base OOF` without joining rows by their array positions.
///
/// Every supplied prediction must be a finite validation block from the same
/// producer and exactly match its declared fold validation membership. The OOF
/// union must cover the whole requested training universe; resampled folds may
/// predict one sample more than once, in which case their predictions are
/// averaged before subtraction. This operation never accepts train predictions.
pub fn derive_residual_targets(
    fold_set: &FoldSet,
    base_producer: &NodeId,
    base_predictions: &[PredictionBlock],
    observed_targets: &BTreeMap<SampleId, Vec<f64>>,
) -> Result<ResidualTargetSet> {
    fold_set.validate()?;
    if base_predictions.is_empty() {
        return Err(DagMlError::OofValidation(
            "residual target derivation requires base validation OOF predictions".to_string(),
        ));
    }

    let mut width = None;
    let mut target_names: Option<Vec<String>> = None;
    for block in base_predictions {
        if &block.producer_node != base_producer {
            return Err(DagMlError::OofValidation(format!(
                "residual target derivation expected base producer `{base_producer}`, got `{}`",
                block.producer_node
            )));
        }
        if block.partition != PredictionPartition::Validation {
            return Err(DagMlError::OofValidation(format!(
                "residual target derivation accepts only validation OOF, got {:?}",
                block.partition
            )));
        }
        let block_width = block.validate_content()?;
        if width
            .replace(block_width)
            .is_some_and(|previous| previous != block_width)
        {
            return Err(DagMlError::OofValidation(
                "residual base predictions have inconsistent target widths".to_string(),
            ));
        }
        if let Some(previous) = &target_names {
            if previous != &block.target_names {
                return Err(DagMlError::OofValidation(
                    "residual base predictions have inconsistent target names".to_string(),
                ));
            }
        } else {
            target_names = Some(block.target_names.clone());
        }
    }
    validate_prediction_blocks_against_folds(fold_set, base_predictions)?;
    let requested = fold_set.sample_ids.iter().cloned().collect::<BTreeSet<_>>();
    let block_refs = base_predictions.iter().collect::<Vec<_>>();
    validate_producer_oof_coverage(
        base_producer,
        &block_refs,
        fold_set.partition_mode,
        Some(&requested),
    )?;

    let width = width.expect("nonempty base predictions have a validated width");
    let mut sums: BTreeMap<SampleId, (Vec<f64>, usize)> = BTreeMap::new();
    for block in base_predictions {
        for (sample, prediction) in block.sample_ids.iter().zip(&block.values) {
            let (sum, count) = sums
                .entry(sample.clone())
                .or_insert_with(|| (vec![0.0; width], 0));
            for (total, value) in sum.iter_mut().zip(prediction) {
                *total += value;
            }
            *count += 1;
        }
    }

    let mut values = Vec::with_capacity(fold_set.sample_ids.len());
    for sample in &fold_set.sample_ids {
        let observed = observed_targets.get(sample).ok_or_else(|| {
            DagMlError::OofValidation(format!(
                "residual target derivation has no observed target for sample `{sample}`"
            ))
        })?;
        if observed.len() != width || observed.iter().any(|value| !value.is_finite()) {
            return Err(DagMlError::OofValidation(format!(
                "residual observed target for sample `{sample}` must have {width} finite value(s)"
            )));
        }
        let (sum, count) = sums
            .get(sample)
            .expect("validated OOF covers all requested samples");
        let residual = observed
            .iter()
            .zip(sum)
            .map(|(target, total)| target - total / *count as f64)
            .collect::<Vec<_>>();
        if residual.iter().any(|value| !value.is_finite()) {
            return Err(DagMlError::OofValidation(format!(
                "residual target for sample `{sample}` is non-finite"
            )));
        }
        values.push(residual);
    }

    Ok(ResidualTargetSet {
        base_producer: base_producer.clone(),
        sample_ids: fold_set.sample_ids.clone(),
        values,
        target_names: target_names.unwrap_or_default(),
    })
}
