//! Chain-effect analysis contract + per-dataset score normalization.
//!
//! Turns a corpus of executed *linear* pipelines ("chains", e.g.
//! `SNV → SavGol → PLS`), each with a comparable scalar score, into a stable,
//! serializable [`ChainEffectAnalysis`] artifact: every chain projected to a
//! comparable "goodness" (higher is always better) under a normalization
//! [`ChainEffectLens`]. The *authoritative* piece that must live natively here
//! is the per-dataset score normalization (rank / z); downstream consumers such
//! as `nirs4all-ui/chains` derive the per-node / position / order aggregates
//! descriptively from the emitted points.
//!
//! Boundary: this operates only on stable identifiers, ordered step
//! tokens/roles and scalar scores — never on feature matrices, tensors or
//! fitted operators, consistent with the dag-ml ownership boundary.
//!
//! Construction is fail-closed: [`ChainEffectAnalysis::from_observations`]
//! rejects empty input, non-finite scores, duplicate ids, mixed evaluation
//! scopes, and (for the rank/z lenses) any observation missing a dataset
//! identity. Repeated ordered tokens are preserved verbatim — position and
//! order are meaningful to downstream consumers.
//!
//! Deferred (a follow-up slice): building [`ChainObservation`]s from a
//! [`crate::plan::GraphPlan`] + [`crate::metrics::ScoreSet`]. `ScoreSet` carries
//! no dataset/source identity (only `plan_id`); the dataset key must come from
//! the representation mapping
//! ([`crate::data::RepresentationSampleObservationMapping`]) and the per-variant
//! node walk needs its own design, so this slice takes host-supplied
//! observations.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::error::{DagMlError, Result};
use crate::graph::NodeKind;
use crate::selection::{EvaluationScope, MetricObjective};

/// Stable `$id` of the serialized chain-effect analysis schema.
pub const CHAIN_EFFECT_SCHEMA_ID: &str =
    "https://github.com/GBeurier/dag-ml/schemas/chain_effect_analysis.v1.schema.json";

/// Current schema version of [`ChainEffectAnalysis`].
pub const CHAIN_EFFECT_SCHEMA_VERSION: u32 = 1;

/// Coarse role of a chain step; drives color/legend and position/order scoping
/// in downstream consumers.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChainStepRole {
    Split,
    Preprocess,
    Feature,
    Model,
    Augmentation,
    Target,
    Other,
}

/// Map a graph [`NodeKind`] to its coarse [`ChainStepRole`].
///
/// Exhaustive by design (no wildcard arm): adding a `NodeKind` must be
/// classified here rather than silently falling through to `Other`.
pub fn chain_role_for_node_kind(kind: &NodeKind) -> ChainStepRole {
    match kind {
        NodeKind::Transform => ChainStepRole::Preprocess,
        NodeKind::YTransform => ChainStepRole::Target,
        NodeKind::Split => ChainStepRole::Split,
        NodeKind::Model => ChainStepRole::Model,
        NodeKind::Augmentation => ChainStepRole::Augmentation,
        NodeKind::FeatureJoin | NodeKind::SourceJoin => ChainStepRole::Feature,
        // `Exclude` removes samples from training (a filter/control op, not a
        // feature-space transform), so it is classified as `Other`.
        NodeKind::Fork
        | NodeKind::Map
        | NodeKind::PredictionJoin
        | NodeKind::MixedJoin
        | NodeKind::Tag
        | NodeKind::Exclude
        | NodeKind::Adapter
        | NodeKind::Aggregator
        | NodeKind::Generator
        | NodeKind::Restructure
        | NodeKind::Tuner
        | NodeKind::Subgraph
        | NodeKind::Chart => ChainStepRole::Other,
    }
}

/// Normalization lens that makes heterogeneous datasets comparable.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChainEffectLens {
    /// Oriented score as-is (best for a single dataset).
    Raw,
    /// Percentile rank within each dataset (0..1, 1 = best).
    RankByDataset,
    /// Z-score within each dataset (higher = better).
    ZByDataset,
}

impl ChainEffectLens {
    /// Wire spelling of the lens (matches the `serde` rename).
    pub fn as_wire(self) -> &'static str {
        match self {
            Self::Raw => "raw",
            Self::RankByDataset => "rank_by_dataset",
            Self::ZByDataset => "z_by_dataset",
        }
    }

    /// Whether this lens requires an explicit dataset identity per observation.
    pub fn requires_dataset(self) -> bool {
        matches!(self, Self::RankByDataset | Self::ZByDataset)
    }
}

/// The metric the scores are expressed in, plus its optimization direction.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChainEffectMetric {
    pub key: String,
    pub label: String,
    /// `true` for error metrics (nRMSE, RMSE); `false` for R²/accuracy.
    pub lower_is_better: bool,
}

impl ChainEffectMetric {
    /// The equivalent [`MetricObjective`] for the metric direction.
    pub fn objective(&self) -> MetricObjective {
        if self.lower_is_better {
            MetricObjective::Minimize
        } else {
            MetricObjective::Maximize
        }
    }

    fn validate(&self) -> Result<()> {
        require_non_empty("chain effect metric key", &self.key)?;
        require_non_empty("chain effect metric label", &self.label)
    }
}

/// One node occurrence inside a chain.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChainEffectStep {
    pub token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub role: ChainStepRole,
}

impl ChainEffectStep {
    fn validate(&self, ctx: &str) -> Result<()> {
        require_non_empty(&format!("{ctx} token"), &self.token)?;
        if let Some(label) = &self.label {
            require_non_empty(&format!("{ctx} label"), label)?;
        }
        Ok(())
    }
}

/// Host-supplied observation: one executed chain with a comparable score.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChainObservation {
    pub id: String,
    /// Ordered steps, first → last (repeats preserved).
    pub steps: Vec<ChainEffectStep>,
    pub score: f64,
    /// Dataset the chain ran on — the unit of per-dataset normalization.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dataset: Option<String>,
    /// Source / modality (multisource, multimodal).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// Evaluation scope provenance of `score`; mixing distinct scopes is refused.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evaluation_scope: Option<EvaluationScope>,
}

/// One chain projected to a comparable goodness (higher = better).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChainEffectPoint {
    pub id: String,
    /// Raw metric value (for tooltips).
    pub score: f64,
    /// Oriented, lens-normalized score; higher is always better.
    pub goodness: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dataset: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// Ordered steps, verbatim from the observation (repeats preserved).
    pub ordered_tokens: Vec<ChainEffectStep>,
}

/// The serialized chain-effect analysis artifact.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChainEffectAnalysis {
    pub schema_id: String,
    pub schema_version: u32,
    pub metric: ChainEffectMetric,
    pub lens: ChainEffectLens,
    /// Reference goodness (global median); the diverging color pivot downstream.
    pub baseline: f64,
    /// Shared evaluation scope of the corpus, when every observation declared one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evaluation_scope: Option<EvaluationScope>,
    pub points: Vec<ChainEffectPoint>,
}

impl ChainEffectAnalysis {
    /// Build the authoritative analysis from host-supplied observations.
    ///
    /// Fail-closed: rejects empty input, non-finite scores, duplicate ids,
    /// empty step lists, mixed evaluation scopes, and (for rank/z lenses) any
    /// observation without a dataset identity.
    pub fn from_observations(
        observations: &[ChainObservation],
        metric: ChainEffectMetric,
        lens: ChainEffectLens,
    ) -> Result<Self> {
        metric.validate()?;
        if observations.is_empty() {
            return Err(DagMlError::RuntimeValidation(
                "chain effect analysis requires at least one observation".to_string(),
            ));
        }

        let mut seen_ids: BTreeSet<&str> = BTreeSet::new();
        let mut scopes: BTreeSet<Option<EvaluationScope>> = BTreeSet::new();
        for obs in observations {
            require_non_empty("chain observation id", &obs.id)?;
            if !seen_ids.insert(obs.id.as_str()) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "duplicate chain observation id `{}`",
                    obs.id
                )));
            }
            if !obs.score.is_finite() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "chain observation `{}` has a non-finite score",
                    obs.id
                )));
            }
            if obs.steps.is_empty() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "chain observation `{}` has no steps",
                    obs.id
                )));
            }
            for step in &obs.steps {
                step.validate(&format!("chain observation `{}` step", obs.id))?;
            }
            if let Some(dataset) = &obs.dataset {
                require_non_empty(&format!("chain observation `{}` dataset", obs.id), dataset)?;
            }
            if let Some(source) = &obs.source {
                require_non_empty(&format!("chain observation `{}` source", obs.id), source)?;
            }
            scopes.insert(obs.evaluation_scope);
        }
        if scopes.len() > 1 {
            return Err(DagMlError::RuntimeValidation(
                "chain observations mix different evaluation scopes".to_string(),
            ));
        }
        let evaluation_scope = scopes.into_iter().next().flatten();

        if lens.requires_dataset() && observations.iter().any(|obs| obs.dataset.is_none()) {
            return Err(DagMlError::RuntimeValidation(format!(
                "lens `{}` requires a dataset id on every observation",
                lens.as_wire()
            )));
        }

        let lower = metric.lower_is_better;
        let oriented: Vec<f64> = observations
            .iter()
            .map(|obs| orient(obs.score, lower))
            .collect();

        let mut goodness = vec![0.0_f64; observations.len()];
        match lens {
            ChainEffectLens::Raw => {
                goodness.copy_from_slice(&oriented);
            }
            ChainEffectLens::RankByDataset | ChainEffectLens::ZByDataset => {
                let mut groups: BTreeMap<&str, Vec<usize>> = BTreeMap::new();
                for (index, obs) in observations.iter().enumerate() {
                    // `requires_dataset` guaranteed a dataset above.
                    let key = obs.dataset.as_deref().unwrap_or_default();
                    groups.entry(key).or_default().push(index);
                }
                for indices in groups.values() {
                    let values: Vec<f64> = indices.iter().map(|&index| oriented[index]).collect();
                    let transformed = if matches!(lens, ChainEffectLens::RankByDataset) {
                        percentile_ranks(&values)
                    } else {
                        z_scores(&values)
                    };
                    for (position, &index) in indices.iter().enumerate() {
                        goodness[index] = transformed[position];
                    }
                }
            }
        }

        for (index, value) in goodness.iter().enumerate() {
            if !value.is_finite() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "chain observation `{}` produced a non-finite goodness",
                    observations[index].id
                )));
            }
        }

        let baseline = median(&goodness);
        if !baseline.is_finite() {
            return Err(DagMlError::RuntimeValidation(
                "chain effect baseline is non-finite".to_string(),
            ));
        }

        let points = observations
            .iter()
            .enumerate()
            .map(|(index, obs)| ChainEffectPoint {
                id: obs.id.clone(),
                score: obs.score,
                goodness: goodness[index],
                dataset: obs.dataset.clone(),
                source: obs.source.clone(),
                ordered_tokens: obs.steps.clone(),
            })
            .collect();

        let analysis = Self {
            schema_id: CHAIN_EFFECT_SCHEMA_ID.to_string(),
            schema_version: CHAIN_EFFECT_SCHEMA_VERSION,
            metric,
            lens,
            baseline,
            evaluation_scope,
            points,
        };
        analysis.validate()?;
        Ok(analysis)
    }

    /// Parse + validate a serialized artifact.
    pub fn from_json(json: &str) -> Result<Self> {
        let value: Self = serde_json::from_str(json)?;
        value.validate()?;
        Ok(value)
    }

    /// Serialize to canonical JSON.
    pub fn to_json(&self) -> Result<String> {
        Ok(serde_json::to_string(self)?)
    }

    /// Structural + semantic validation of the artifact.
    pub fn validate(&self) -> Result<()> {
        if self.schema_id != CHAIN_EFFECT_SCHEMA_ID {
            return Err(DagMlError::RuntimeValidation(format!(
                "chain effect analysis schema_id `{}` is unexpected (current `{CHAIN_EFFECT_SCHEMA_ID}`)",
                self.schema_id
            )));
        }
        if self.schema_version != CHAIN_EFFECT_SCHEMA_VERSION {
            return Err(DagMlError::RuntimeValidation(format!(
                "chain effect analysis schema_version {} is unsupported (current {CHAIN_EFFECT_SCHEMA_VERSION})",
                self.schema_version
            )));
        }
        self.metric.validate()?;
        if self.points.is_empty() {
            return Err(DagMlError::RuntimeValidation(
                "chain effect analysis has no points".to_string(),
            ));
        }
        if !self.baseline.is_finite() {
            return Err(DagMlError::RuntimeValidation(
                "chain effect baseline is non-finite".to_string(),
            ));
        }

        let mut seen_ids: BTreeSet<&str> = BTreeSet::new();
        for point in &self.points {
            require_non_empty("chain effect point id", &point.id)?;
            if !seen_ids.insert(point.id.as_str()) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "duplicate chain effect point id `{}`",
                    point.id
                )));
            }
            if !point.score.is_finite() || !point.goodness.is_finite() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "chain effect point `{}` has a non-finite score or goodness",
                    point.id
                )));
            }
            if point.ordered_tokens.is_empty() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "chain effect point `{}` has no ordered tokens",
                    point.id
                )));
            }
            for step in &point.ordered_tokens {
                step.validate(&format!("chain effect point `{}` token", point.id))?;
            }
            if let Some(dataset) = &point.dataset {
                require_non_empty(
                    &format!("chain effect point `{}` dataset", point.id),
                    dataset,
                )?;
            }
            if let Some(source) = &point.source {
                require_non_empty(&format!("chain effect point `{}` source", point.id), source)?;
            }
        }

        if self.lens.requires_dataset() && self.points.iter().any(|point| point.dataset.is_none()) {
            return Err(DagMlError::RuntimeValidation(format!(
                "lens `{}` requires a dataset id on every point",
                self.lens.as_wire()
            )));
        }

        // Semantic invariants of the goodness/baseline definitions, so a parsed
        // artifact cannot claim a lens whose numbers contradict it.
        let goodness: Vec<f64> = self.points.iter().map(|point| point.goodness).collect();
        let recomputed = median(&goodness);
        if !approx_eq(recomputed, self.baseline) {
            return Err(DagMlError::RuntimeValidation(format!(
                "chain effect baseline {} is not the median of goodness ({recomputed})",
                self.baseline
            )));
        }
        match self.lens {
            ChainEffectLens::Raw => {
                let lower = self.metric.lower_is_better;
                for point in &self.points {
                    if !approx_eq(point.goodness, orient(point.score, lower)) {
                        return Err(DagMlError::RuntimeValidation(format!(
                            "chain effect point `{}` raw goodness disagrees with its oriented score",
                            point.id
                        )));
                    }
                }
            }
            ChainEffectLens::RankByDataset => {
                for point in &self.points {
                    if point.goodness < -RANK_EPS || point.goodness > 1.0 + RANK_EPS {
                        return Err(DagMlError::RuntimeValidation(format!(
                            "chain effect point `{}` rank goodness {} is outside [0, 1]",
                            point.id, point.goodness
                        )));
                    }
                }
            }
            ChainEffectLens::ZByDataset => {}
        }
        Ok(())
    }
}

/// Absolute tolerance for rank-goodness bounds.
const RANK_EPS: f64 = 1e-9;

/// Relative/absolute float comparison for validation invariants.
fn approx_eq(a: f64, b: f64) -> bool {
    (a - b).abs() <= 1e-9 * (1.0 + a.abs().max(b.abs()))
}

fn require_non_empty(label: &str, value: &str) -> Result<()> {
    if value.trim().is_empty() {
        return Err(DagMlError::RuntimeValidation(format!("{label} is empty")));
    }
    Ok(())
}

/// Orient a score so higher is always better.
pub fn orient(score: f64, lower_is_better: bool) -> f64 {
    if lower_is_better {
        -score
    } else {
        score
    }
}

/// Percentile rank of each value in `[0, 1]` (1 = largest); average ties.
///
/// A single value maps to `0.5`; an empty slice returns an empty vector.
pub fn percentile_ranks(values: &[f64]) -> Vec<f64> {
    let n = values.len();
    if n == 0 {
        return Vec::new();
    }
    if n == 1 {
        return vec![0.5];
    }
    let mut order: Vec<usize> = (0..n).collect();
    order.sort_by(|&a, &b| values[a].total_cmp(&values[b]));
    let denom = (n - 1) as f64;
    let mut ranks = vec![0.0_f64; n];
    let mut i = 0;
    while i < n {
        let mut j = i;
        // Group ties by numeric equality so `-0.0` and `+0.0` average together
        // (a deterministic `total_cmp` sort orders them; only tie *grouping*
        // should treat them as equal).
        while j + 1 < n && values[order[j + 1]] == values[order[i]] {
            j += 1;
        }
        let averaged = ((i + j) as f64) / 2.0 / denom;
        for slot in &order[i..=j] {
            ranks[*slot] = averaged;
        }
        i = j + 1;
    }
    ranks
}

/// Sample z-scores (mean 0, unit sd, `n - 1` divisor); zero variance → all `0`.
pub fn z_scores(values: &[f64]) -> Vec<f64> {
    let n = values.len();
    if n == 0 {
        return Vec::new();
    }
    if n < 2 {
        return vec![0.0; n];
    }
    let mean = values.iter().sum::<f64>() / n as f64;
    let variance = values.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / (n as f64 - 1.0);
    let sd = variance.sqrt();
    if sd == 0.0 || !sd.is_finite() {
        return vec![0.0; n];
    }
    values.iter().map(|v| (v - mean) / sd).collect()
}

/// Median of the finite values (linear interpolation at the midpoint).
pub fn median(values: &[f64]) -> f64 {
    let mut sorted: Vec<f64> = values.iter().copied().filter(|v| v.is_finite()).collect();
    if sorted.is_empty() {
        return f64::NAN;
    }
    sorted.sort_by(f64::total_cmp);
    let n = sorted.len();
    if n % 2 == 1 {
        sorted[n / 2]
    } else {
        // Overflow-safe midpoint (avoids `MAX + MAX`).
        let lo = sorted[n / 2 - 1];
        let hi = sorted[n / 2];
        lo + (hi - lo) / 2.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn step(token: &str, role: ChainStepRole) -> ChainEffectStep {
        ChainEffectStep {
            token: token.to_string(),
            label: Some(token.to_uppercase()),
            role,
        }
    }

    fn obs(id: &str, dataset: &str, pre: &str, score: f64) -> ChainObservation {
        ChainObservation {
            id: id.to_string(),
            steps: vec![
                step("split_kfold", ChainStepRole::Split),
                step(pre, ChainStepRole::Preprocess),
                step("pls", ChainStepRole::Model),
            ],
            score,
            dataset: Some(dataset.to_string()),
            source: Some("nir".to_string()),
            evaluation_scope: Some(EvaluationScope::Oof),
        }
    }

    fn nrmse() -> ChainEffectMetric {
        ChainEffectMetric {
            key: "nrmse".to_string(),
            label: "nRMSE".to_string(),
            lower_is_better: true,
        }
    }

    #[test]
    fn role_mapping_is_exhaustive_and_correct() {
        assert_eq!(
            chain_role_for_node_kind(&NodeKind::Transform),
            ChainStepRole::Preprocess
        );
        assert_eq!(
            chain_role_for_node_kind(&NodeKind::YTransform),
            ChainStepRole::Target
        );
        assert_eq!(
            chain_role_for_node_kind(&NodeKind::Split),
            ChainStepRole::Split
        );
        assert_eq!(
            chain_role_for_node_kind(&NodeKind::Model),
            ChainStepRole::Model
        );
        assert_eq!(
            chain_role_for_node_kind(&NodeKind::Augmentation),
            ChainStepRole::Augmentation
        );
        assert_eq!(
            chain_role_for_node_kind(&NodeKind::FeatureJoin),
            ChainStepRole::Feature
        );
        assert_eq!(
            chain_role_for_node_kind(&NodeKind::SourceJoin),
            ChainStepRole::Feature
        );
        for kind in [
            NodeKind::Fork,
            NodeKind::Map,
            NodeKind::PredictionJoin,
            NodeKind::MixedJoin,
            NodeKind::Tag,
            NodeKind::Exclude,
            NodeKind::Adapter,
            NodeKind::Aggregator,
            NodeKind::Generator,
            NodeKind::Restructure,
            NodeKind::Tuner,
            NodeKind::Subgraph,
            NodeKind::Chart,
        ] {
            assert_eq!(chain_role_for_node_kind(&kind), ChainStepRole::Other);
        }
    }

    #[test]
    fn percentile_ranks_average_ties() {
        assert_eq!(percentile_ranks(&[10.0, 20.0, 30.0]), vec![0.0, 0.5, 1.0]);
        let ties = percentile_ranks(&[5.0, 5.0, 9.0]);
        assert!((ties[0] - 0.25).abs() < 1e-12);
        assert!((ties[1] - 0.25).abs() < 1e-12);
        assert!((ties[2] - 1.0).abs() < 1e-12);
        assert_eq!(percentile_ranks(&[42.0]), vec![0.5]);
        assert!(percentile_ranks(&[]).is_empty());
    }

    #[test]
    fn z_scores_center_and_handle_zero_variance() {
        let z = z_scores(&[1.0, 2.0, 3.0]);
        assert!(z[1].abs() < 1e-12);
        assert!((z[0] + z[2]).abs() < 1e-12);
        assert_eq!(z_scores(&[7.0, 7.0, 7.0]), vec![0.0, 0.0, 0.0]);
        assert_eq!(z_scores(&[5.0]), vec![0.0]);
        assert!(z_scores(&[]).is_empty());
    }

    #[test]
    fn median_handles_odd_and_even() {
        assert!((median(&[3.0, 1.0, 2.0]) - 2.0).abs() < 1e-12);
        assert!((median(&[1.0, 2.0, 3.0, 4.0]) - 2.5).abs() < 1e-12);
        assert!(median(&[]).is_nan());
    }

    #[test]
    fn rank_lens_normalizes_per_dataset() {
        let observations = vec![
            obs("a", "d1", "snv", 0.10),
            obs("b", "d1", "msc", 0.20),
            obs("c", "d2", "snv", 5.00),
            obs("d", "d2", "msc", 9.00),
        ];
        let analysis = ChainEffectAnalysis::from_observations(
            &observations,
            nrmse(),
            ChainEffectLens::RankByDataset,
        )
        .unwrap();
        let goodness = |id: &str| {
            analysis
                .points
                .iter()
                .find(|point| point.id == id)
                .unwrap()
                .goodness
        };
        // best (lowest nRMSE) in each dataset → 1.0; worst → 0.0
        assert!((goodness("a") - 1.0).abs() < 1e-12);
        assert!((goodness("b") - 0.0).abs() < 1e-12);
        assert!((goodness("c") - 1.0).abs() < 1e-12);
        assert!((goodness("d") - 0.0).abs() < 1e-12);
        assert!((analysis.baseline - 0.5).abs() < 1e-12);
        assert_eq!(analysis.evaluation_scope, Some(EvaluationScope::Oof));
    }

    #[test]
    fn raw_lens_keeps_oriented_score() {
        let observations = vec![obs("a", "d1", "snv", 0.10)];
        let analysis =
            ChainEffectAnalysis::from_observations(&observations, nrmse(), ChainEffectLens::Raw)
                .unwrap();
        assert!((analysis.points[0].goodness + 0.10).abs() < 1e-12);
    }

    #[test]
    fn preserves_repeated_ordered_tokens() {
        let observation = ChainObservation {
            id: "x".to_string(),
            steps: vec![
                step("snv", ChainStepRole::Preprocess),
                step("snv", ChainStepRole::Preprocess),
                step("pls", ChainStepRole::Model),
            ],
            score: 0.1,
            dataset: None,
            source: None,
            evaluation_scope: None,
        };
        let analysis =
            ChainEffectAnalysis::from_observations(&[observation], nrmse(), ChainEffectLens::Raw)
                .unwrap();
        assert_eq!(analysis.points[0].ordered_tokens.len(), 3);
    }

    #[test]
    fn rejects_invalid_input() {
        // empty
        assert!(
            ChainEffectAnalysis::from_observations(&[], nrmse(), ChainEffectLens::Raw).is_err()
        );
        // duplicate id
        let dup = vec![obs("a", "d1", "snv", 0.1), obs("a", "d1", "msc", 0.2)];
        assert!(ChainEffectAnalysis::from_observations(
            &dup,
            nrmse(),
            ChainEffectLens::RankByDataset
        )
        .is_err());
        // non-finite score
        let nan = vec![obs("a", "d1", "snv", f64::NAN)];
        assert!(
            ChainEffectAnalysis::from_observations(&nan, nrmse(), ChainEffectLens::Raw).is_err()
        );
        // rank lens without dataset
        let mut no_ds = obs("a", "d1", "snv", 0.1);
        no_ds.dataset = None;
        assert!(ChainEffectAnalysis::from_observations(
            &[no_ds],
            nrmse(),
            ChainEffectLens::RankByDataset
        )
        .is_err());
        // mixed scopes
        let mut holdout = obs("b", "d1", "msc", 0.2);
        holdout.evaluation_scope = Some(EvaluationScope::Holdout);
        let mixed = vec![obs("a", "d1", "snv", 0.1), holdout];
        assert!(ChainEffectAnalysis::from_observations(
            &mixed,
            nrmse(),
            ChainEffectLens::RankByDataset
        )
        .is_err());
    }

    #[test]
    fn round_trips_and_emits_wire_field_names() {
        let observations = vec![obs("a", "d1", "snv", 0.10), obs("b", "d1", "msc", 0.20)];
        let analysis = ChainEffectAnalysis::from_observations(
            &observations,
            nrmse(),
            ChainEffectLens::RankByDataset,
        )
        .unwrap();
        let json = analysis.to_json().unwrap();
        assert!(json.contains("\"lower_is_better\""));
        assert!(json.contains("\"ordered_tokens\""));
        assert!(json.contains("\"rank_by_dataset\""));
        assert!(json.contains(CHAIN_EFFECT_SCHEMA_ID));
        let parsed = ChainEffectAnalysis::from_json(&json).unwrap();
        assert_eq!(parsed, analysis);
    }

    #[test]
    fn percentile_ranks_treats_signed_zero_as_tie() {
        let ranks = percentile_ranks(&[-0.0, 0.0, 1.0]);
        assert!((ranks[0] - 0.25).abs() < 1e-12);
        assert!((ranks[1] - 0.25).abs() < 1e-12);
        assert!((ranks[2] - 1.0).abs() < 1e-12);
    }

    #[test]
    fn validate_rejects_inconsistent_goodness_and_baseline() {
        let observations = vec![obs("a", "d1", "snv", 0.10), obs("b", "d1", "msc", 0.20)];
        // tampered baseline
        let mut tampered = ChainEffectAnalysis::from_observations(
            &observations,
            nrmse(),
            ChainEffectLens::RankByDataset,
        )
        .unwrap();
        tampered.baseline = 0.9;
        assert!(tampered.validate().is_err());
        // tampered raw goodness (must equal the oriented score)
        let mut raw = ChainEffectAnalysis::from_observations(
            &observations[..1],
            nrmse(),
            ChainEffectLens::Raw,
        )
        .unwrap();
        raw.points[0].goodness = 42.0;
        raw.baseline = 42.0;
        assert!(raw.validate().is_err());
        // out-of-range rank goodness
        let mut rank = ChainEffectAnalysis::from_observations(
            &observations,
            nrmse(),
            ChainEffectLens::RankByDataset,
        )
        .unwrap();
        rank.points[0].goodness = 2.0;
        rank.baseline = median(&rank.points.iter().map(|p| p.goodness).collect::<Vec<_>>());
        assert!(rank.validate().is_err());
    }

    #[test]
    fn from_json_rejects_bad_schema_id_and_version() {
        let observations = vec![obs("a", "d1", "snv", 0.10)];
        let mut analysis =
            ChainEffectAnalysis::from_observations(&observations, nrmse(), ChainEffectLens::Raw)
                .unwrap();
        analysis.schema_id = "https://example.com/wrong".to_string();
        assert!(analysis.validate().is_err());
        analysis.schema_id = CHAIN_EFFECT_SCHEMA_ID.to_string();
        analysis.schema_version = 999;
        assert!(analysis.validate().is_err());
    }

    #[cfg(dag_ml_workspace_contract_fixtures)]
    #[test]
    fn published_schema_declares_current_contract() {
        let schema: serde_json::Value = serde_json::from_str(include_str!(
            "../../../docs/contracts/chain_effect_analysis.schema.json"
        ))
        .unwrap();
        assert_eq!(schema["$id"], CHAIN_EFFECT_SCHEMA_ID);
        assert_eq!(
            schema["additionalProperties"],
            serde_json::Value::Bool(false)
        );
        let required = schema["required"].as_array().unwrap();
        for field in [
            "schema_id",
            "schema_version",
            "metric",
            "lens",
            "baseline",
            "points",
        ] {
            assert!(
                required.iter().any(|value| value == field),
                "missing {field}"
            );
        }
    }

    #[test]
    fn published_fixture_matches_contract() {
        let fixture = include_str!("../tests/fixtures/package/chain_effect_analysis.json");
        let analysis = ChainEffectAnalysis::from_json(fixture).unwrap();
        assert_eq!(analysis.schema_id, CHAIN_EFFECT_SCHEMA_ID);
        assert!(!analysis.points.is_empty());
    }
}
