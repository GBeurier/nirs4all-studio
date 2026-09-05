//! ADR-07 canonical prediction-aggregation reducer contract.
//!
//! `dag-ml-data` owns the reducer *names, parameters and validation* so the
//! conformance pack is complete and every binding agrees on the surface. The
//! numerical execution (mean/median/robust-mean, the Hotelling T² outlier
//! boundary, vote tallies) belongs to the host bridge — there is no reducer
//! math in this layer. `skipna = true` is fixed ADR-07 contract behaviour and is
//! not configurable in v1.
//!
//! The policy is a flat struct with `deny_unknown_fields` (not an internally
//! tagged enum) so the JSON wire shape stays flat — `{"reducer": "robust_mean",
//! "trim_fraction": 0.1}` — yet unknown keys such as `skipna` are rejected at the
//! boundary, keeping the Rust deserializer and the C ABI validator
//! (`dagmldata_aggregation_policy_validate_json`) in agreement. Type-level
//! looseness (a parameter that belongs to another reducer) is caught
//! semantically by [`AggregationPolicy::validate`]. No shared JSON schema is
//! published yet — the conformance pack pins only the validator symbol (the
//! dag-ml coordinator-level aggregation policy stays a distinct contract; see the
//! ADR-07 reconciliation follow-up).

use serde::{Deserialize, Serialize};

use crate::error::{DataError, Result};

/// Default `trim_fraction` for `robust_mean` when unspecified (ADR-07).
pub const DEFAULT_TRIM_FRACTION: f64 = 0.1;
/// Default `threshold` for `exclude_outliers` when unspecified (ADR-07).
pub const DEFAULT_THRESHOLD: f64 = 0.95;

/// A reducer label (weight column, custom reducer id) must be non-empty, carry no
/// leading or trailing whitespace, and contain no control characters.
fn is_clean_label(value: &str) -> bool {
    !value.is_empty() && value == value.trim() && !value.chars().any(char::is_control)
}

/// The canonical reducer names. The `custom` escape hatch is intentionally not
/// listed; it is addressed by `custom_reducer_id` instead. This array is the
/// source of truth for the canonical set (the conformance pack pins only the C
/// ABI validator symbol, not a shared reducer list).
pub const CANONICAL_AGGREGATION_REDUCERS: [&str; 6] = [
    "mean",
    "weighted_mean",
    "median",
    "vote",
    "robust_mean",
    "exclude_outliers",
];

/// Canonical per-sample aggregation reducer name (ADR-07).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AggregationReducerName {
    /// Arithmetic mean of valid values.
    Mean,
    /// Mean weighted by a provider-supplied per-row weight column.
    WeightedMean,
    /// Sample median.
    Median,
    /// Majority vote (classification only); refused on a regression task.
    Vote,
    /// Trimmed mean: drop the top/bottom `trim_fraction` before averaging.
    RobustMean,
    /// Drop rows outside a Hotelling T² confidence boundary at `threshold`, then mean.
    ExcludeOutliers,
    /// Host-controller reducer addressed by a stable `custom_reducer_id`.
    Custom,
}

impl AggregationReducerName {
    /// The snake_case wire name for diagnostics.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Mean => "mean",
            Self::WeightedMean => "weighted_mean",
            Self::Median => "median",
            Self::Vote => "vote",
            Self::RobustMean => "robust_mean",
            Self::ExcludeOutliers => "exclude_outliers",
            Self::Custom => "custom",
        }
    }
}

/// Prediction task kind needed to validate task-sensitive reducers. This is a
/// deliberately tiny enum; the bridge maps its richer task type into it. It does
/// not make `dag-ml-data` the home of DAG-ML task semantics.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PredictionTaskKind {
    Regression,
    Classification,
}

/// Aggregation policy: which reducer collapses repeated predictions to one value
/// per sample, plus the single parameter that reducer accepts. Parameters that
/// do not belong to the chosen reducer must be absent (enforced by
/// [`validate`](Self::validate)). `None` numeric parameters take the ADR-07
/// defaults ([`DEFAULT_TRIM_FRACTION`], [`DEFAULT_THRESHOLD`]).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "snake_case")]
pub struct AggregationPolicy {
    pub reducer: AggregationReducerName,
    /// `robust_mean` trim fraction in `[0.0, 0.5)`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trim_fraction: Option<f64>,
    /// `exclude_outliers` confidence threshold in `(0.0, 1.0)`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub threshold: Option<f64>,
    /// `weighted_mean` provider-supplied per-row weight column.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weight_column: Option<String>,
    /// `custom` host-controller reducer id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_reducer_id: Option<String>,
}

impl AggregationPolicy {
    /// Validate the reducer and its parameters: the reducer's own parameter is
    /// range-checked, and any parameter belonging to a different reducer must be
    /// absent. No task context (see [`validate_for_task`](Self::validate_for_task)).
    pub fn validate(&self) -> Result<()> {
        use AggregationReducerName as R;

        // Each reducer permits exactly one optional parameter (or none).
        let (allow_trim, allow_threshold, allow_weight, allow_custom) = match self.reducer {
            R::Mean | R::Median | R::Vote => (false, false, false, false),
            R::RobustMean => (true, false, false, false),
            R::ExcludeOutliers => (false, true, false, false),
            R::WeightedMean => (false, false, true, false),
            R::Custom => (false, false, false, true),
        };
        self.reject_unexpected("trim_fraction", self.trim_fraction.is_some(), allow_trim)?;
        self.reject_unexpected("threshold", self.threshold.is_some(), allow_threshold)?;
        self.reject_unexpected("weight_column", self.weight_column.is_some(), allow_weight)?;
        self.reject_unexpected(
            "custom_reducer_id",
            self.custom_reducer_id.is_some(),
            allow_custom,
        )?;

        match self.reducer {
            R::Mean | R::Median | R::Vote => {}
            R::RobustMean => {
                if let Some(trim) = self.trim_fraction {
                    if !trim.is_finite() || !(0.0..0.5).contains(&trim) {
                        return Err(DataError::Validation(format!(
                            "aggregation reducer `robust_mean` trim_fraction must be in [0.0, 0.5), got {trim}"
                        )));
                    }
                }
            }
            R::ExcludeOutliers => {
                if let Some(threshold) = self.threshold {
                    if !threshold.is_finite() || threshold <= 0.0 || threshold >= 1.0 {
                        return Err(DataError::Validation(format!(
                            "aggregation reducer `exclude_outliers` threshold must be in (0.0, 1.0), got {threshold}"
                        )));
                    }
                }
            }
            R::WeightedMean => {
                let column = self.weight_column.as_deref().unwrap_or_default();
                if !is_clean_label(column) {
                    return Err(DataError::Validation(
                        "aggregation reducer `weighted_mean` requires a non-empty weight_column with no surrounding whitespace or control characters"
                            .to_string(),
                    ));
                }
            }
            R::Custom => {
                let id = self.custom_reducer_id.as_deref().unwrap_or_default();
                if !is_clean_label(id) {
                    return Err(DataError::Validation(
                        "aggregation reducer `custom` requires a non-empty custom_reducer_id with no surrounding whitespace or control characters"
                            .to_string(),
                    ));
                }
                if CANONICAL_AGGREGATION_REDUCERS.contains(&id) || id == "custom" {
                    return Err(DataError::Validation(format!(
                        "custom_reducer_id `{id}` collides with a reserved reducer name"
                    )));
                }
            }
        }
        Ok(())
    }

    /// Validate parameters and refuse task-incompatible reducers (`vote` on a
    /// regression task), raising [`DataError::IncompatibleReducer`].
    pub fn validate_for_task(&self, task: PredictionTaskKind) -> Result<()> {
        self.validate()?;
        if matches!(
            (self.reducer, task),
            (AggregationReducerName::Vote, PredictionTaskKind::Regression)
        ) {
            return Err(DataError::IncompatibleReducer {
                reducer: "vote",
                task: "regression",
            });
        }
        Ok(())
    }

    fn reject_unexpected(&self, param: &str, present: bool, allowed: bool) -> Result<()> {
        if present && !allowed {
            return Err(DataError::Validation(format!(
                "aggregation reducer `{}` does not accept parameter `{param}`",
                self.reducer.as_str()
            )));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy(reducer: AggregationReducerName) -> AggregationPolicy {
        AggregationPolicy {
            reducer,
            trim_fraction: None,
            threshold: None,
            weight_column: None,
            custom_reducer_id: None,
        }
    }

    #[test]
    fn flat_wire_shape_and_strict_unknown_fields() {
        let text = serde_json::to_string(&policy(AggregationReducerName::Mean)).unwrap();
        assert_eq!(text, r#"{"reducer":"mean"}"#);
        let mut robust = policy(AggregationReducerName::RobustMean);
        robust.trim_fraction = Some(0.2);
        let text = serde_json::to_string(&robust).unwrap();
        assert_eq!(text, r#"{"reducer":"robust_mean","trim_fraction":0.2}"#);

        // unknown keys (e.g. skipna) are rejected at the boundary
        assert!(
            serde_json::from_str::<AggregationPolicy>(r#"{"reducer":"mean","skipna":false}"#)
                .is_err()
        );
        // a missing reducer is rejected
        assert!(serde_json::from_str::<AggregationPolicy>(r#"{}"#).is_err());
        // a bare string is not the policy shape
        assert!(serde_json::from_str::<AggregationPolicy>(r#""mean""#).is_err());
    }

    #[test]
    fn cross_parameter_contamination_is_rejected() {
        let mut mean = policy(AggregationReducerName::Mean);
        mean.trim_fraction = Some(0.1);
        assert!(mean.validate().is_err());
        let mut robust = policy(AggregationReducerName::RobustMean);
        robust.threshold = Some(0.9);
        assert!(robust.validate().is_err());
        let mut custom = policy(AggregationReducerName::Custom);
        custom.custom_reducer_id = Some("ok.id".to_string());
        custom.weight_column = Some("w".to_string());
        assert!(custom.validate().is_err());
    }

    #[test]
    fn no_param_reducers_validate_clean() {
        for reducer in [
            AggregationReducerName::Mean,
            AggregationReducerName::Median,
            AggregationReducerName::Vote,
        ] {
            assert!(policy(reducer).validate().is_ok());
        }
    }

    #[test]
    fn robust_mean_trim_fraction_bounds() {
        let mut p = policy(AggregationReducerName::RobustMean);
        assert!(p.validate().is_ok()); // None -> default applies downstream
        for good in [0.0, 0.25, 0.49] {
            p.trim_fraction = Some(good);
            assert!(p.validate().is_ok(), "trim {good} should pass");
        }
        for bad in [-0.1, 0.5, 0.9, f64::NAN, f64::INFINITY] {
            p.trim_fraction = Some(bad);
            assert!(p.validate().is_err(), "trim {bad} should fail");
        }
    }

    #[test]
    fn exclude_outliers_threshold_bounds() {
        let mut p = policy(AggregationReducerName::ExcludeOutliers);
        assert!(p.validate().is_ok());
        p.threshold = Some(0.95);
        assert!(p.validate().is_ok());
        for bad in [0.0, 1.0, -0.5, 1.5, f64::NAN] {
            p.threshold = Some(bad);
            assert!(p.validate().is_err(), "threshold {bad} should fail");
        }
    }

    #[test]
    fn weighted_mean_requires_weight_column() {
        let mut p = policy(AggregationReducerName::WeightedMean);
        assert!(p.validate().is_err()); // missing
        p.weight_column = Some("   ".to_string());
        assert!(p.validate().is_err()); // blank
        p.weight_column = Some("weight".to_string());
        assert!(p.validate().is_ok());
        // surrounding whitespace / control characters are rejected
        p.weight_column = Some(" weight ".to_string());
        assert!(p.validate().is_err());
        p.weight_column = Some("we\tight".to_string());
        assert!(p.validate().is_err());
    }

    #[test]
    fn custom_reducer_id_non_empty_and_not_reserved() {
        let mut p = policy(AggregationReducerName::Custom);
        assert!(p.validate().is_err()); // missing
        p.custom_reducer_id = Some("site.special".to_string());
        assert!(p.validate().is_ok());
        for reserved in ["mean", "robust_mean", "custom"] {
            p.custom_reducer_id = Some(reserved.to_string());
            assert!(p.validate().is_err(), "reserved `{reserved}` should fail");
        }
        // surrounding whitespace / control characters are rejected
        for dirty in [" site.special", "site.special ", "site\tspecial"] {
            p.custom_reducer_id = Some(dirty.to_string());
            assert!(p.validate().is_err(), "dirty `{dirty:?}` should fail");
        }
    }

    #[test]
    fn vote_is_classification_only() {
        let vote = policy(AggregationReducerName::Vote);
        assert!(vote
            .validate_for_task(PredictionTaskKind::Classification)
            .is_ok());
        let error = vote
            .validate_for_task(PredictionTaskKind::Regression)
            .unwrap_err();
        assert_eq!(error.code(), "incompatible_reducer");
        assert_eq!(error.error_code(), 0x0002_0003);
        assert!(policy(AggregationReducerName::Mean)
            .validate_for_task(PredictionTaskKind::Regression)
            .is_ok());
    }

    #[test]
    fn canonical_names_round_trip() {
        for name in CANONICAL_AGGREGATION_REDUCERS {
            let json = format!(r#"{{"reducer":"{name}"}}"#);
            let parsed: AggregationPolicy = serde_json::from_str(&json).unwrap();
            assert_eq!(parsed.reducer.as_str(), name);
        }
        assert_eq!(CANONICAL_AGGREGATION_REDUCERS.len(), 6);
    }
}
