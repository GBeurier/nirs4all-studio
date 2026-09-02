//! Native split-conformal regression kernels.
//!
//! This module implements split absolute-residual calibration, interval
//! application, and interval metrics without owning predictors or feature
//! buffers. It is intentionally a typed Rust surface only: persistence and
//! binding contracts are added separately once their wire formats are frozen.

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Largest calibration sample count accepted by the exact rank routine.
///
/// The rank convention uses `n + 1`, so `u64::MAX` itself is excluded. The
/// routine performs the remaining decimal arithmetic in `u128` and returns a
/// rank in `1..=n+1` without binary64 multiplication.
pub const MAX_CONFORMAL_SAMPLE_COUNT: u64 = u64::MAX - 1;

const MAX_EXACT_METRIC_COUNT: u64 = (1_u64 << 53) - 1;
const MAX_SHORTEST_DECIMAL_COEFFICIENT: u128 = 99_999_999_999_999_999;
const MAX_U128_POWER_OF_TEN: u32 = 38;

/// Multi-target nonconformity reduction for split regression intervals.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConformalMultiTargetPolicy {
    /// Calibrate one absolute-residual quantile per target.
    Marginal,
    /// Reduce every calibration row to its maximum target residual.
    JointMax,
}

/// Behavior when `ceil((n + 1) * coverage)` exceeds `n`.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConformalSmallSamplePolicy {
    /// Refuse calibration because no finite order statistic exists.
    Error,
    /// Emit a tagged unbounded radius; never synthesize an infinite sentinel.
    Unbounded,
}

/// One calibrated radius.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "status", content = "value")]
pub enum ConformalRadius {
    Finite(f64),
    Unbounded,
}

/// Quantile record for one requested coverage.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SplitConformalQuantile {
    pub coverage: f64,
    /// One-indexed finite-sample rank. It may equal `n + 1` for an unbounded
    /// small-sample record.
    pub rank: u64,
    /// Per-target radii for [`ConformalMultiTargetPolicy::Marginal`], or one
    /// shared radius for [`ConformalMultiTargetPolicy::JointMax`].
    pub radii: Vec<ConformalRadius>,
}

/// One regression interval cell.
///
/// The tagged form makes unbounded endpoints inseparable, avoiding `(-inf,
/// +inf)` sentinels and half-unbounded states.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "status")]
pub enum RegressionIntervalCell {
    Finite { lower: f64, upper: f64 },
    Unbounded,
}

impl RegressionIntervalCell {
    /// Return wire-shaped paired endpoints (`None, None` when unbounded).
    pub fn endpoints(self) -> (Option<f64>, Option<f64>) {
        match self {
            Self::Finite { lower, upper } => (Some(lower), Some(upper)),
            Self::Unbounded => (None, None),
        }
    }

    /// Return a finite midpoint without overflowing endpoint addition.
    pub fn midpoint(self) -> Option<f64> {
        match self {
            Self::Finite { lower, upper } => Some(finite_midpoint(lower, upper)),
            Self::Unbounded => None,
        }
    }
}

/// Multi-row, multi-target interval at one coverage.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegressionConformalInterval {
    pub coverage: f64,
    pub cells: Vec<Vec<RegressionIntervalCell>>,
}

/// Availability of finite width and interval-score summaries.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ConformalMeasurementStatus {
    Finite,
    Unbounded,
}

/// Reconstructed regression interval metrics for one coverage and target scope.
#[derive(Clone, Debug, PartialEq)]
pub struct RegressionConformalMetrics {
    /// Target column for marginal metrics; `None` for a joint-max summary.
    pub target_index: Option<usize>,
    pub measurement_status: ConformalMeasurementStatus,
    pub empirical_coverage: f64,
    pub coverage_gap: f64,
    pub mean_width: Option<f64>,
    pub median_width: Option<f64>,
    pub interval_score: Option<f64>,
}

/// Validation or finite-arithmetic failure in the native conformal kernels.
#[derive(Clone, Debug, Eq, PartialEq, Error)]
pub enum ConformalError {
    #[error("conformal coverages must be non-empty")]
    EmptyCoverages,

    #[error("coverage at index {index} must be finite and strictly inside (0, 1)")]
    InvalidCoverage { index: usize },

    #[error("coverage at index {index} is not strictly greater than its predecessor")]
    NonIncreasingCoverage { index: usize },

    #[error("sample_count must be in 1..={MAX_CONFORMAL_SAMPLE_COUNT}, got {sample_count}")]
    InvalidSampleCount { sample_count: u64 },

    #[error("failed to recover a shortest decimal binary64 representation")]
    DecimalConversion,

    #[error("{matrix} matrix must be non-empty")]
    EmptyMatrix { matrix: &'static str },

    #[error("{matrix} row {row} must be non-empty")]
    EmptyMatrixRow { matrix: &'static str, row: usize },

    #[error("{matrix} row {row} has width {actual}, expected the rectangular width {expected}")]
    RaggedMatrix {
        matrix: &'static str,
        row: usize,
        expected: usize,
        actual: usize,
    },

    #[error("{matrix} value at row {row}, target {target} must be finite")]
    NonFiniteMatrixValue {
        matrix: &'static str,
        row: usize,
        target: usize,
    },

    #[error("residual at row {row}, target {target} must be non-negative")]
    NegativeResidual { row: usize, target: usize },

    #[error("finite-sample rank {rank} exceeds calibration size {sample_count}")]
    SmallSampleRank { rank: u64, sample_count: u64 },

    #[error("split-conformal quantiles must be non-empty")]
    EmptyQuantiles,

    #[error("quantile {coverage_index} has rank zero")]
    ZeroQuantileRank { coverage_index: usize },

    #[error("quantile rank decreases at coverage index {coverage_index}")]
    DecreasingQuantileRank { coverage_index: usize },

    #[error(
        "quantile {coverage_index} has {actual} radii, expected {expected} for this target policy"
    )]
    QuantileShape {
        coverage_index: usize,
        expected: usize,
        actual: usize,
    },

    #[error("quantile {coverage_index}, radius {radius_index} must be finite and non-negative")]
    InvalidRadius {
        coverage_index: usize,
        radius_index: usize,
    },

    #[error("quantile {coverage_index} mixes finite and unbounded radii")]
    MixedRadiusStatus { coverage_index: usize },

    #[error(
        "quantile radius is not nested at coverage index {coverage_index}, radius {radius_index}"
    )]
    NonNestedRadius {
        coverage_index: usize,
        radius_index: usize,
    },

    #[error("{left} and {right} matrix row counts differ")]
    MatrixRowCountMismatch {
        left: &'static str,
        right: &'static str,
    },

    #[error("{left} and {right} matrix target widths differ")]
    MatrixTargetCountMismatch {
        left: &'static str,
        right: &'static str,
    },

    #[error("interval cell at row {row}, target {target} must contain ordered finite bounds")]
    InvalidIntervalCell { row: usize, target: usize },

    #[error("finite arithmetic overflow while computing {operation}")]
    ArithmeticOverflow { operation: &'static str },

    #[error(
        "finite interval at coverage {coverage_index}, row {row}, target {target} cannot preserve the W0 decimal midpoint and radius closures"
    )]
    UnrepresentableInterval {
        coverage_index: usize,
        row: usize,
        target: usize,
    },

    #[error("metric cell count exceeds the exact binary64 integer range")]
    MetricCountTooLarge,
}

/// Validate a non-empty, strictly increasing list of finite binary64 coverages.
pub fn validate_conformal_coverages(coverages: &[f64]) -> Result<(), ConformalError> {
    if coverages.is_empty() {
        return Err(ConformalError::EmptyCoverages);
    }
    for (index, coverage) in coverages.iter().copied().enumerate() {
        if !(coverage.is_finite() && 0.0 < coverage && coverage < 1.0) {
            return Err(ConformalError::InvalidCoverage { index });
        }
        if index > 0 && coverages[index - 1] >= coverage {
            return Err(ConformalError::NonIncreasingCoverage { index });
        }
    }
    Ok(())
}

/// Compute `ceil((n + 1) * coverage)` from the binary64 shortest decimal.
///
/// Rust and Python may choose fixed versus exponent notation differently, but
/// their shortest-roundtrip renderings denote the same exact decimal. Parsing
/// that decimal into integer arithmetic reproduces Python's
/// `Decimal(repr(coverage))` convention and avoids a binary64 multiplication
/// near integer rank boundaries.
pub fn finite_sample_conformal_rank(
    sample_count: u64,
    coverage: f64,
) -> Result<u64, ConformalError> {
    if sample_count == 0 || sample_count > MAX_CONFORMAL_SAMPLE_COUNT {
        return Err(ConformalError::InvalidSampleCount { sample_count });
    }
    validate_conformal_coverages(&[coverage])?;
    let decimal = shortest_decimal(coverage)?;
    let multiplier = u128::from(
        sample_count
            .checked_add(1)
            .ok_or(ConformalError::InvalidSampleCount { sample_count })?,
    );
    let scaled =
        multiplier
            .checked_mul(decimal.coefficient)
            .ok_or(ConformalError::ArithmeticOverflow {
                operation: "finite-sample rank numerator",
            })?;

    // A binary64 shortest coefficient has at most 17 significant decimal
    // digits. With n <= u64::MAX - 1, scaled < 10^37; any denominator >= 10^39
    // therefore yields the exact positive ceiling 1 without materializing the
    // (potentially 10^324) denominator.
    let rank = if decimal.scale > MAX_U128_POWER_OF_TEN {
        1_u128
    } else {
        let denominator = checked_power_of_ten(decimal.scale)?;
        let quotient = scaled / denominator;
        quotient + u128::from(scaled % denominator != 0)
    };
    u64::try_from(rank).map_err(|_| ConformalError::ArithmeticOverflow {
        operation: "finite-sample rank result",
    })
}

/// Calibrate split absolute-residual radii for every requested coverage.
///
/// Negative-zero residuals are normalized to positive zero before ordering so
/// equal scores have one deterministic binary64 representation.
pub fn split_absolute_residual_quantiles(
    residuals: &[Vec<f64>],
    coverages: &[f64],
    multi_target_policy: ConformalMultiTargetPolicy,
    small_sample_policy: ConformalSmallSamplePolicy,
) -> Result<Vec<SplitConformalQuantile>, ConformalError> {
    let target_count = validate_finite_matrix(residuals, "residuals", true)?;
    validate_conformal_coverages(coverages)?;
    let sample_count =
        u64::try_from(residuals.len()).map_err(|_| ConformalError::InvalidSampleCount {
            sample_count: u64::MAX,
        })?;
    if sample_count > MAX_CONFORMAL_SAMPLE_COUNT {
        return Err(ConformalError::InvalidSampleCount { sample_count });
    }

    let score_count = match multi_target_policy {
        ConformalMultiTargetPolicy::Marginal => target_count,
        ConformalMultiTargetPolicy::JointMax => 1,
    };
    let mut ordered_scores = (0..score_count)
        .map(|_| Vec::with_capacity(residuals.len()))
        .collect::<Vec<_>>();
    for row in residuals {
        match multi_target_policy {
            ConformalMultiTargetPolicy::Marginal => {
                for (target, residual) in row.iter().copied().enumerate() {
                    ordered_scores[target].push(normalized_zero(residual));
                }
            }
            ConformalMultiTargetPolicy::JointMax => {
                let maximum = row
                    .iter()
                    .copied()
                    .map(normalized_zero)
                    .fold(0.0_f64, f64::max);
                ordered_scores[0].push(maximum);
            }
        }
    }
    for scores in &mut ordered_scores {
        scores.sort_by(f64::total_cmp);
    }

    let mut quantiles = Vec::with_capacity(coverages.len());
    for coverage in coverages.iter().copied() {
        let rank = finite_sample_conformal_rank(sample_count, coverage)?;
        let radii = if rank > sample_count {
            match small_sample_policy {
                ConformalSmallSamplePolicy::Error => {
                    return Err(ConformalError::SmallSampleRank { rank, sample_count });
                }
                ConformalSmallSamplePolicy::Unbounded => {
                    vec![ConformalRadius::Unbounded; score_count]
                }
            }
        } else {
            let index =
                usize::try_from(rank - 1).map_err(|_| ConformalError::ArithmeticOverflow {
                    operation: "quantile order-statistic index",
                })?;
            ordered_scores
                .iter()
                .map(|scores| ConformalRadius::Finite(scores[index]))
                .collect()
        };
        quantiles.push(SplitConformalQuantile {
            coverage,
            rank,
            radii,
        });
    }
    Ok(quantiles)
}

/// Apply calibrated radii to a finite multi-target prediction matrix.
///
/// Quantile coverages and ranks must be ordered, and radii must be nested. A
/// finite bound overflow is rejected rather than converted into an unbounded
/// interval, preserving the distinction between arithmetic failure and the
/// explicit small-sample policy. Finite endpoints are the correctly rounded
/// binary64 conversions of `Decimal(repr(point)) +/- Decimal(repr(radius))`,
/// as frozen by W0.  The two decimal operations are rounded independently;
/// their rendered binary64 values therefore need not reconstruct an exact
/// decimal midpoint or width after a second arithmetic operation.  A finite
/// non-zero radius is rejected only when both canonical endpoint conversions
/// collapse to the same binary64 value.
pub fn apply_split_absolute_residual(
    point_predictions: &[Vec<f64>],
    quantiles: &[SplitConformalQuantile],
    multi_target_policy: ConformalMultiTargetPolicy,
) -> Result<Vec<RegressionConformalInterval>, ConformalError> {
    let target_count = validate_finite_matrix(point_predictions, "point predictions", false)?;
    validate_quantiles(quantiles, target_count, multi_target_policy)?;

    let mut intervals = Vec::with_capacity(quantiles.len());
    for (coverage_index, quantile) in quantiles.iter().enumerate() {
        let mut cells = Vec::with_capacity(point_predictions.len());
        for (row_index, row) in point_predictions.iter().enumerate() {
            let mut interval_row = Vec::with_capacity(target_count);
            for (target, point) in row.iter().copied().enumerate() {
                let radius = quantile.radii[match multi_target_policy {
                    ConformalMultiTargetPolicy::Marginal => target,
                    ConformalMultiTargetPolicy::JointMax => 0,
                }];
                let cell = match radius {
                    ConformalRadius::Unbounded => RegressionIntervalCell::Unbounded,
                    ConformalRadius::Finite(radius) => {
                        let radius = normalized_zero(radius);
                        let (lower, upper) = decimal_conformal_endpoints(point, radius)?;
                        if !decimal_interval_closes(point, radius, lower, upper)? {
                            return Err(ConformalError::UnrepresentableInterval {
                                coverage_index,
                                row: row_index,
                                target,
                            });
                        }
                        RegressionIntervalCell::Finite { lower, upper }
                    }
                };
                interval_row.push(cell);
            }
            cells.push(interval_row);
        }
        intervals.push(RegressionConformalInterval {
            coverage: quantile.coverage,
            cells,
        });
    }
    Ok(intervals)
}

/// Reconstruct regression coverage, width, and Winkler interval score.
///
/// Marginal mode returns one record per target. Joint-max mode counts a row as
/// covered only when all targets are covered, while widths and scores are
/// flattened in row-major `(row, target)` order. If any summarized cell is
/// unbounded, coverage remains available but width and score fields are tagged
/// unavailable.
pub fn regression_conformal_metrics(
    truth: &[Vec<f64>],
    interval: &RegressionConformalInterval,
    multi_target_policy: ConformalMultiTargetPolicy,
) -> Result<Vec<RegressionConformalMetrics>, ConformalError> {
    validate_conformal_coverages(&[interval.coverage])?;
    let target_count = validate_finite_matrix(truth, "truth", false)?;
    let interval_target_count = validate_interval_matrix(&interval.cells)?;
    if truth.len() != interval.cells.len() {
        return Err(ConformalError::MatrixRowCountMismatch {
            left: "truth",
            right: "interval",
        });
    }
    if target_count != interval_target_count {
        return Err(ConformalError::MatrixTargetCountMismatch {
            left: "truth",
            right: "interval",
        });
    }

    let alpha = 1.0 - interval.coverage;
    let miss_scale = 2.0 / alpha;
    let mut covered = Vec::with_capacity(truth.len());
    let mut widths = Vec::with_capacity(truth.len());
    let mut scores = Vec::with_capacity(truth.len());
    for (row_index, (truth_row, interval_row)) in truth.iter().zip(&interval.cells).enumerate() {
        let mut covered_row = Vec::with_capacity(target_count);
        let mut width_row = Vec::with_capacity(target_count);
        let mut score_row = Vec::with_capacity(target_count);
        for (target, (value, cell)) in truth_row
            .iter()
            .copied()
            .zip(interval_row.iter().copied())
            .enumerate()
        {
            match cell {
                RegressionIntervalCell::Unbounded => {
                    covered_row.push(true);
                    width_row.push(None);
                    score_row.push(None);
                }
                RegressionIntervalCell::Finite { lower, upper } => {
                    if !lower.is_finite() || !upper.is_finite() || lower > upper {
                        return Err(ConformalError::InvalidIntervalCell {
                            row: row_index,
                            target,
                        });
                    }
                    let width = checked_finite(upper - lower, "interval width")?;
                    let miss_distance = if value < lower {
                        lower - value
                    } else if value > upper {
                        value - upper
                    } else {
                        0.0
                    };
                    let penalty = checked_finite(
                        miss_scale * checked_finite(miss_distance, "interval miss distance")?,
                        "Winkler miss penalty",
                    )?;
                    let score = checked_finite(width + penalty, "Winkler interval score")?;
                    covered_row.push(lower <= value && value <= upper);
                    width_row.push(Some(width));
                    score_row.push(Some(score));
                }
            }
        }
        covered.push(covered_row);
        widths.push(width_row);
        scores.push(score_row);
    }

    match multi_target_policy {
        ConformalMultiTargetPolicy::Marginal => (0..target_count)
            .map(|target| {
                summarize_metrics(
                    interval.coverage,
                    covered.iter().map(|row| row[target]).collect(),
                    widths.iter().map(|row| row[target]).collect(),
                    scores.iter().map(|row| row[target]).collect(),
                    Some(target),
                )
            })
            .collect(),
        ConformalMultiTargetPolicy::JointMax => summarize_metrics(
            interval.coverage,
            covered
                .iter()
                .map(|row| row.iter().all(|value| *value))
                .collect(),
            widths.iter().flatten().copied().collect(),
            scores.iter().flatten().copied().collect(),
            None,
        )
        .map(|summary| vec![summary]),
    }
}

#[derive(Clone, Copy, Debug)]
struct ShortestDecimal {
    coefficient: u128,
    scale: u32,
}

/// Exact finite decimal recovered from a binary64 shortest-roundtrip token.
///
/// `digits * 10^exponent` is stored independently of binary floating-point so
/// W0 endpoint arithmetic never performs an intermediate binary64 operation.
#[derive(Clone, Debug, Eq, PartialEq)]
struct ExactDecimal {
    negative: bool,
    digits: Vec<u8>,
    exponent: i32,
}

impl ExactDecimal {
    fn zero(negative: bool) -> Self {
        Self {
            negative,
            digits: vec![0],
            exponent: 0,
        }
    }

    fn is_zero(&self) -> bool {
        self.digits == [0]
    }
}

fn shortest_decimal(value: f64) -> Result<ShortestDecimal, ConformalError> {
    let rendered = value.to_string();
    let (mantissa, exponent) = match rendered.find(['e', 'E']) {
        Some(index) => {
            let exponent = rendered[index + 1..]
                .parse::<i32>()
                .map_err(|_| ConformalError::DecimalConversion)?;
            (&rendered[..index], exponent)
        }
        None => (rendered.as_str(), 0),
    };
    let mut coefficient = 0_u128;
    let mut fractional_digits = 0_i32;
    let mut after_decimal = false;
    let mut saw_digit = false;
    for byte in mantissa.bytes() {
        match byte {
            b'.' if !after_decimal => after_decimal = true,
            b'0'..=b'9' => {
                saw_digit = true;
                coefficient = coefficient
                    .checked_mul(10)
                    .and_then(|current| current.checked_add(u128::from(byte - b'0')))
                    .ok_or(ConformalError::DecimalConversion)?;
                if after_decimal {
                    fractional_digits = fractional_digits
                        .checked_add(1)
                        .ok_or(ConformalError::DecimalConversion)?;
                }
            }
            _ => return Err(ConformalError::DecimalConversion),
        }
    }
    if !saw_digit || coefficient == 0 || coefficient > MAX_SHORTEST_DECIMAL_COEFFICIENT {
        return Err(ConformalError::DecimalConversion);
    }
    let scale = fractional_digits
        .checked_sub(exponent)
        .ok_or(ConformalError::DecimalConversion)?;
    if scale <= 0 {
        return Err(ConformalError::DecimalConversion);
    }
    Ok(ShortestDecimal {
        coefficient,
        scale: u32::try_from(scale).map_err(|_| ConformalError::DecimalConversion)?,
    })
}

fn exact_decimal_from_f64(value: f64) -> Result<ExactDecimal, ConformalError> {
    if !value.is_finite() {
        return Err(ConformalError::DecimalConversion);
    }
    let rendered = value.to_string();
    let (negative, unsigned) = rendered
        .strip_prefix('-')
        .map_or((false, rendered.as_str()), |rest| (true, rest));
    let (mantissa, scientific_exponent) = match unsigned.find(['e', 'E']) {
        Some(index) => {
            let exponent = unsigned[index + 1..]
                .parse::<i32>()
                .map_err(|_| ConformalError::DecimalConversion)?;
            (&unsigned[..index], exponent)
        }
        None => (unsigned, 0),
    };

    let mut digits = Vec::with_capacity(mantissa.len());
    let mut fractional_digits = 0_i32;
    let mut after_decimal = false;
    for byte in mantissa.bytes() {
        match byte {
            b'.' if !after_decimal => after_decimal = true,
            b'0'..=b'9' => {
                digits.push(byte - b'0');
                if after_decimal {
                    fractional_digits = fractional_digits
                        .checked_add(1)
                        .ok_or(ConformalError::DecimalConversion)?;
                }
            }
            _ => return Err(ConformalError::DecimalConversion),
        }
    }
    if digits.is_empty() {
        return Err(ConformalError::DecimalConversion);
    }

    let first_nonzero = digits.iter().position(|digit| *digit != 0);
    let Some(first_nonzero) = first_nonzero else {
        return Ok(ExactDecimal::zero(negative));
    };
    digits.drain(..first_nonzero);
    let exponent = scientific_exponent
        .checked_sub(fractional_digits)
        .ok_or(ConformalError::DecimalConversion)?;
    normalize_exact_decimal(ExactDecimal {
        negative,
        digits,
        exponent,
    })
}

fn normalize_exact_decimal(mut value: ExactDecimal) -> Result<ExactDecimal, ConformalError> {
    while value.digits.len() > 1 && value.digits.last() == Some(&0) {
        value.digits.pop();
        value.exponent = value
            .exponent
            .checked_add(1)
            .ok_or(ConformalError::DecimalConversion)?;
    }
    Ok(value)
}

fn aligned_decimal_digits(
    value: &ExactDecimal,
    common_exponent: i32,
) -> Result<Vec<u8>, ConformalError> {
    let trailing_zeros = value
        .exponent
        .checked_sub(common_exponent)
        .and_then(|count| usize::try_from(count).ok())
        .ok_or(ConformalError::DecimalConversion)?;
    let expanded_len = value
        .digits
        .len()
        .checked_add(trailing_zeros)
        .ok_or(ConformalError::DecimalConversion)?;
    let mut digits = Vec::with_capacity(expanded_len);
    digits.extend_from_slice(&value.digits);
    digits.resize(expanded_len, 0);
    Ok(digits)
}

fn add_decimal_magnitudes(left: &[u8], right: &[u8]) -> Vec<u8> {
    let digit_count = left.len().max(right.len());
    let mut left = left.iter().rev();
    let mut right = right.iter().rev();
    let mut reversed = Vec::with_capacity(digit_count + 1);
    let mut carry = 0_u8;
    for _ in 0..digit_count {
        let sum = left.next().copied().unwrap_or(0) + right.next().copied().unwrap_or(0) + carry;
        reversed.push(sum % 10);
        carry = sum / 10;
    }
    if carry != 0 {
        reversed.push(carry);
    }
    reversed.reverse();
    reversed
}

fn subtract_decimal_magnitudes(larger: &[u8], smaller: &[u8]) -> Result<Vec<u8>, ConformalError> {
    let mut smaller = smaller.iter().rev();
    let mut reversed = Vec::with_capacity(larger.len());
    let mut borrow = 0_i16;
    for larger_digit in larger.iter().rev().copied() {
        let smaller_digit = i16::from(smaller.next().copied().unwrap_or(0));
        let mut difference = i16::from(larger_digit) - smaller_digit - borrow;
        if difference < 0 {
            difference += 10;
            borrow = 1;
        } else {
            borrow = 0;
        }
        reversed.push(u8::try_from(difference).map_err(|_| ConformalError::DecimalConversion)?);
    }
    if borrow != 0 {
        return Err(ConformalError::DecimalConversion);
    }
    reversed.reverse();
    let leading_zeros = reversed
        .iter()
        .position(|digit| *digit != 0)
        .unwrap_or(reversed.len().saturating_sub(1));
    reversed.drain(..leading_zeros);
    Ok(reversed)
}

fn add_exact_decimals(
    left: &ExactDecimal,
    right: &ExactDecimal,
    subtract_right: bool,
) -> Result<ExactDecimal, ConformalError> {
    if left.is_zero() && right.is_zero() {
        return Ok(ExactDecimal::zero(false));
    }
    if right.is_zero() {
        return Ok(left.clone());
    }
    if left.is_zero() {
        let mut result = right.clone();
        result.negative ^= subtract_right;
        return Ok(result);
    }

    let common_exponent = left.exponent.min(right.exponent);
    let left_digits = aligned_decimal_digits(left, common_exponent)?;
    let right_digits = aligned_decimal_digits(right, common_exponent)?;
    let right_negative = right.negative ^ subtract_right;
    let (negative, digits) = if left.negative == right_negative {
        (
            left.negative,
            add_decimal_magnitudes(&left_digits, &right_digits),
        )
    } else {
        let magnitude_order = left_digits
            .len()
            .cmp(&right_digits.len())
            .then_with(|| left_digits.cmp(&right_digits));
        match magnitude_order {
            std::cmp::Ordering::Greater => (
                left.negative,
                subtract_decimal_magnitudes(&left_digits, &right_digits)?,
            ),
            std::cmp::Ordering::Less => (
                right_negative,
                subtract_decimal_magnitudes(&right_digits, &left_digits)?,
            ),
            std::cmp::Ordering::Equal => return Ok(ExactDecimal::zero(false)),
        }
    };
    normalize_exact_decimal(ExactDecimal {
        negative,
        digits,
        exponent: common_exponent,
    })
}

fn exact_decimal_to_f64(
    value: &ExactDecimal,
    operation: &'static str,
) -> Result<f64, ConformalError> {
    if value.is_zero() {
        return Ok(f64::from_bits(u64::from(value.negative) << 63));
    }
    let scientific_exponent = value
        .exponent
        .checked_add(
            i32::try_from(value.digits.len() - 1).map_err(|_| ConformalError::DecimalConversion)?,
        )
        .ok_or(ConformalError::DecimalConversion)?;
    let mut rendered = String::with_capacity(value.digits.len() + 16);
    if value.negative {
        rendered.push('-');
    }
    rendered.push(char::from(b'0' + value.digits[0]));
    if value.digits.len() > 1 {
        rendered.push('.');
        rendered.extend(
            value.digits[1..]
                .iter()
                .map(|digit| char::from(b'0' + digit)),
        );
    }
    rendered.push('e');
    rendered.push_str(&scientific_exponent.to_string());
    let rounded = rendered
        .parse::<f64>()
        .map_err(|_| ConformalError::DecimalConversion)?;
    checked_finite(rounded, operation)
}

fn decimal_conformal_endpoints(point: f64, radius: f64) -> Result<(f64, f64), ConformalError> {
    let point_decimal = exact_decimal_from_f64(point)?;
    let radius_decimal = exact_decimal_from_f64(radius)?;
    let mut lower_decimal = add_exact_decimals(&point_decimal, &radius_decimal, true)?;
    let mut upper_decimal = add_exact_decimals(&point_decimal, &radius_decimal, false)?;

    // Decimal's signed-zero results for the only zero-radius ambiguity:
    // `-0 - +0` remains negative, while `-0 + +0` is positive.
    if lower_decimal.is_zero() {
        lower_decimal.negative = point == 0.0 && point.is_sign_negative();
    }
    if upper_decimal.is_zero() {
        upper_decimal.negative = false;
    }

    Ok((
        exact_decimal_to_f64(&lower_decimal, "finite conformal lower endpoint")?,
        exact_decimal_to_f64(&upper_decimal, "finite conformal upper endpoint")?,
    ))
}

fn decimal_interval_closes(
    point: f64,
    radius: f64,
    lower: f64,
    upper: f64,
) -> Result<bool, ConformalError> {
    let (expected_lower, expected_upper) = decimal_conformal_endpoints(point, radius)?;
    let matches_canonical_endpoints =
        lower.to_bits() == expected_lower.to_bits() && upper.to_bits() == expected_upper.to_bits();
    let non_zero_radius_collapsed = radius != 0.0 && lower.to_bits() == upper.to_bits();
    Ok(matches_canonical_endpoints && !non_zero_radius_collapsed)
}

fn checked_power_of_ten(power: u32) -> Result<u128, ConformalError> {
    let mut value = 1_u128;
    for _ in 0..power {
        value = value
            .checked_mul(10)
            .ok_or(ConformalError::ArithmeticOverflow {
                operation: "decimal rank denominator",
            })?;
    }
    Ok(value)
}

fn validate_finite_matrix(
    matrix: &[Vec<f64>],
    name: &'static str,
    non_negative: bool,
) -> Result<usize, ConformalError> {
    if matrix.is_empty() {
        return Err(ConformalError::EmptyMatrix { matrix: name });
    }
    let expected = matrix[0].len();
    if expected == 0 {
        return Err(ConformalError::EmptyMatrixRow {
            matrix: name,
            row: 0,
        });
    }
    for (row_index, row) in matrix.iter().enumerate() {
        if row.len() != expected {
            return Err(ConformalError::RaggedMatrix {
                matrix: name,
                row: row_index,
                expected,
                actual: row.len(),
            });
        }
        for (target, value) in row.iter().copied().enumerate() {
            if !value.is_finite() {
                return Err(ConformalError::NonFiniteMatrixValue {
                    matrix: name,
                    row: row_index,
                    target,
                });
            }
            if non_negative && value < 0.0 {
                return Err(ConformalError::NegativeResidual {
                    row: row_index,
                    target,
                });
            }
        }
    }
    Ok(expected)
}

fn validate_interval_matrix(
    matrix: &[Vec<RegressionIntervalCell>],
) -> Result<usize, ConformalError> {
    if matrix.is_empty() {
        return Err(ConformalError::EmptyMatrix { matrix: "interval" });
    }
    let expected = matrix[0].len();
    if expected == 0 {
        return Err(ConformalError::EmptyMatrixRow {
            matrix: "interval",
            row: 0,
        });
    }
    for (row, cells) in matrix.iter().enumerate() {
        if cells.len() != expected {
            return Err(ConformalError::RaggedMatrix {
                matrix: "interval",
                row,
                expected,
                actual: cells.len(),
            });
        }
        for (target, cell) in cells.iter().copied().enumerate() {
            if let RegressionIntervalCell::Finite { lower, upper } = cell {
                if !lower.is_finite() || !upper.is_finite() || lower > upper {
                    return Err(ConformalError::InvalidIntervalCell { row, target });
                }
            }
        }
    }
    Ok(expected)
}

fn validate_quantiles(
    quantiles: &[SplitConformalQuantile],
    target_count: usize,
    policy: ConformalMultiTargetPolicy,
) -> Result<(), ConformalError> {
    if quantiles.is_empty() {
        return Err(ConformalError::EmptyQuantiles);
    }
    let coverages = quantiles
        .iter()
        .map(|quantile| quantile.coverage)
        .collect::<Vec<_>>();
    validate_conformal_coverages(&coverages)?;
    let expected = match policy {
        ConformalMultiTargetPolicy::Marginal => target_count,
        ConformalMultiTargetPolicy::JointMax => 1,
    };
    let mut previous_rank = 0_u64;
    let mut previous = vec![None; expected];
    for (coverage_index, quantile) in quantiles.iter().enumerate() {
        if quantile.rank == 0 {
            return Err(ConformalError::ZeroQuantileRank { coverage_index });
        }
        if coverage_index > 0 && quantile.rank < previous_rank {
            return Err(ConformalError::DecreasingQuantileRank { coverage_index });
        }
        previous_rank = quantile.rank;
        if quantile.radii.len() != expected {
            return Err(ConformalError::QuantileShape {
                coverage_index,
                expected,
                actual: quantile.radii.len(),
            });
        }
        let first_is_unbounded = matches!(quantile.radii[0], ConformalRadius::Unbounded);
        if quantile
            .radii
            .iter()
            .any(|radius| matches!(radius, ConformalRadius::Unbounded) != first_is_unbounded)
        {
            return Err(ConformalError::MixedRadiusStatus { coverage_index });
        }
        for (radius_index, radius) in quantile.radii.iter().copied().enumerate() {
            if let ConformalRadius::Finite(value) = radius {
                if !value.is_finite() || value < 0.0 {
                    return Err(ConformalError::InvalidRadius {
                        coverage_index,
                        radius_index,
                    });
                }
            }
            if let Some(previous_radius) = previous[radius_index] {
                let nested = match (previous_radius, radius) {
                    (ConformalRadius::Finite(left), ConformalRadius::Finite(right)) => {
                        left <= right
                    }
                    (ConformalRadius::Finite(_), ConformalRadius::Unbounded)
                    | (ConformalRadius::Unbounded, ConformalRadius::Unbounded) => true,
                    (ConformalRadius::Unbounded, ConformalRadius::Finite(_)) => false,
                };
                if !nested {
                    return Err(ConformalError::NonNestedRadius {
                        coverage_index,
                        radius_index,
                    });
                }
            }
            previous[radius_index] = Some(radius);
        }
    }
    Ok(())
}

fn summarize_metrics(
    coverage: f64,
    covered: Vec<bool>,
    widths: Vec<Option<f64>>,
    scores: Vec<Option<f64>>,
    target_index: Option<usize>,
) -> Result<RegressionConformalMetrics, ConformalError> {
    let count = u64::try_from(covered.len()).map_err(|_| ConformalError::MetricCountTooLarge)?;
    if count == 0 || count > MAX_EXACT_METRIC_COUNT {
        return Err(ConformalError::MetricCountTooLarge);
    }
    let measurement_count =
        u64::try_from(widths.len()).map_err(|_| ConformalError::MetricCountTooLarge)?;
    if measurement_count == 0
        || measurement_count > MAX_EXACT_METRIC_COUNT
        || widths.len() != scores.len()
    {
        return Err(ConformalError::MetricCountTooLarge);
    }
    let covered_count = u64::try_from(covered.iter().filter(|value| **value).count())
        .map_err(|_| ConformalError::MetricCountTooLarge)?;
    let empirical_coverage = (covered_count as f64) / (count as f64);
    let coverage_gap = empirical_coverage - coverage;
    if widths.iter().chain(&scores).any(Option::is_none) {
        return Ok(RegressionConformalMetrics {
            target_index,
            measurement_status: ConformalMeasurementStatus::Unbounded,
            empirical_coverage,
            coverage_gap,
            mean_width: None,
            median_width: None,
            interval_score: None,
        });
    }

    let mut finite_widths = widths.into_iter().flatten().collect::<Vec<_>>();
    let finite_scores = scores.into_iter().flatten().collect::<Vec<_>>();
    finite_widths.sort_by(f64::total_cmp);
    let mean_width = checked_mean(&finite_widths, "mean interval width")?;
    let interval_score = checked_mean(&finite_scores, "mean Winkler interval score")?;
    let middle = finite_widths.len() / 2;
    let median_width = if finite_widths.len() % 2 == 1 {
        finite_widths[middle]
    } else {
        finite_midpoint(finite_widths[middle - 1], finite_widths[middle])
    };
    Ok(RegressionConformalMetrics {
        target_index,
        measurement_status: ConformalMeasurementStatus::Finite,
        empirical_coverage,
        coverage_gap,
        mean_width: Some(mean_width),
        median_width: Some(median_width),
        interval_score: Some(interval_score),
    })
}

fn checked_mean(values: &[f64], operation: &'static str) -> Result<f64, ConformalError> {
    if values.is_empty() {
        return Err(ConformalError::MetricCountTooLarge);
    }
    let count = u64::try_from(values.len()).map_err(|_| ConformalError::MetricCountTooLarge)?;
    let mut sum = 0.0_f64;
    let mut sum_is_finite = true;
    for value in values.iter().copied() {
        let next = sum + value;
        if !next.is_finite() {
            sum_is_finite = false;
            break;
        }
        sum = next;
    }
    if sum_is_finite {
        // This is the frozen W0 order-sensitive `sum(values) / len(values)`
        // path. The online fallback below is used only when that sum overflows
        // even though its mathematical mean can remain representable.
        return Ok(sum / (count as f64));
    }

    let mut mean = 0.0_f64;
    for (index, value) in values.iter().copied().enumerate() {
        let count = u64::try_from(index + 1).map_err(|_| ConformalError::MetricCountTooLarge)?;
        let delta = checked_finite(value - mean, operation)?;
        mean = checked_finite(mean + (delta / (count as f64)), operation)?;
    }
    Ok(mean)
}

fn checked_finite(value: f64, operation: &'static str) -> Result<f64, ConformalError> {
    if value.is_finite() {
        Ok(value)
    } else {
        Err(ConformalError::ArithmeticOverflow { operation })
    }
}

fn normalized_zero(value: f64) -> f64 {
    if value == 0.0 {
        0.0
    } else {
        value
    }
}

fn finite_midpoint(lower: f64, upper: f64) -> f64 {
    let opposite_signs = lower.is_sign_negative() != upper.is_sign_negative();
    if opposite_signs || (lower.abs() <= f64::MAX / 2.0 && upper.abs() <= f64::MAX / 2.0) {
        (lower + upper) / 2.0
    } else {
        (lower / 2.0) + (upper / 2.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_close(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() <= 1e-12,
            "expected {expected:?}, got {actual:?}"
        );
    }

    fn finite(value: f64) -> ConformalRadius {
        ConformalRadius::Finite(value)
    }

    fn finite_cell(lower: f64, upper: f64) -> RegressionIntervalCell {
        RegressionIntervalCell::Finite { lower, upper }
    }

    #[test]
    fn exact_rank_matches_frozen_standard_coverages() {
        let cases = [(0.8, 17), (0.9, 19), (0.95, 20), (0.99, 21), (0.999, 21)];
        for (coverage, rank) in cases {
            assert_eq!(finite_sample_conformal_rank(20, coverage).unwrap(), rank);
        }
    }

    #[test]
    fn exact_rank_avoids_naive_binary64_boundary_drift() {
        assert_eq!((25.0_f64 * 0.28).ceil() as u64, 8);
        assert_eq!(finite_sample_conformal_rank(24, 0.28).unwrap(), 7);

        let above_one_third = 0.333_333_333_333_333_37_f64;
        assert_eq!((3.0 * above_one_third).ceil() as u64, 1);
        assert_eq!(finite_sample_conformal_rank(2, above_one_third).unwrap(), 2);
    }

    #[test]
    fn exact_rank_handles_binary64_extremes_and_sample_limit() {
        let minimum_subnormal = f64::from_bits(1);
        assert_eq!(
            finite_sample_conformal_rank(MAX_CONFORMAL_SAMPLE_COUNT, minimum_subnormal).unwrap(),
            1
        );
        assert_eq!(
            finite_sample_conformal_rank(MAX_CONFORMAL_SAMPLE_COUNT, f64::MIN_POSITIVE).unwrap(),
            1
        );
        assert_eq!(
            finite_sample_conformal_rank(1, f64::from_bits(1.0_f64.to_bits() - 1)).unwrap(),
            2
        );
        assert!(matches!(
            finite_sample_conformal_rank(u64::MAX, 0.5),
            Err(ConformalError::InvalidSampleCount { .. })
        ));
        assert_eq!(
            finite_sample_conformal_rank(MAX_CONFORMAL_SAMPLE_COUNT, 0.999_999_999_999_999_9)
                .unwrap(),
            18_446_744_073_709_549_771
        );
    }

    #[test]
    fn exact_rank_exercises_the_u128_power_of_ten_boundary() {
        assert_eq!(checked_power_of_ten(38).unwrap(), 10_u128.pow(38));
        assert_eq!(finite_sample_conformal_rank(1, 1.0e-38).unwrap(), 1);
    }

    #[test]
    fn calibration_covers_odd_even_ties_and_small_n() {
        let odd = vec![vec![1.0], vec![2.0], vec![3.0], vec![4.0], vec![5.0]];
        let even = vec![vec![1.0], vec![2.0], vec![3.0], vec![4.0]];
        let ties = vec![vec![1.0], vec![2.0], vec![2.0], vec![4.0]];
        for (residuals, expected) in [(&odd, 3.0), (&even, 3.0), (&ties, 2.0)] {
            let result = split_absolute_residual_quantiles(
                residuals,
                &[0.5],
                ConformalMultiTargetPolicy::Marginal,
                ConformalSmallSamplePolicy::Error,
            )
            .unwrap();
            assert_eq!(result[0].rank, 3);
            assert_eq!(result[0].radii, vec![finite(expected)]);
        }

        let one = vec![vec![1.0, 2.0]];
        assert!(matches!(
            split_absolute_residual_quantiles(
                &one,
                &[0.9],
                ConformalMultiTargetPolicy::Marginal,
                ConformalSmallSamplePolicy::Error,
            ),
            Err(ConformalError::SmallSampleRank {
                rank: 2,
                sample_count: 1
            })
        ));
        let unbounded = split_absolute_residual_quantiles(
            &one,
            &[0.9],
            ConformalMultiTargetPolicy::Marginal,
            ConformalSmallSamplePolicy::Unbounded,
        )
        .unwrap();
        assert_eq!(
            unbounded[0].radii,
            vec![ConformalRadius::Unbounded, ConformalRadius::Unbounded]
        );
    }

    #[test]
    fn frozen_w0_unsorted_residual_quantiles_match() {
        let residuals = [
            0.4, 1.0, 0.2, 1.8, 0.6, 1.2, 0.8, 2.0, 0.1, 1.6, 0.3, 1.4, 0.5, 1.9, 0.7, 1.1, 0.9,
            1.3, 1.5, 1.7,
        ]
        .into_iter()
        .map(|value| vec![value])
        .collect::<Vec<_>>();
        let quantiles = split_absolute_residual_quantiles(
            &residuals,
            &[0.9, 0.95],
            ConformalMultiTargetPolicy::Marginal,
            ConformalSmallSamplePolicy::Error,
        )
        .unwrap();
        assert_eq!(quantiles[0].rank, 19);
        assert_eq!(quantiles[0].radii, vec![finite(1.9)]);
        assert_eq!(quantiles[1].rank, 20);
        assert_eq!(quantiles[1].radii, vec![finite(2.0)]);
    }

    #[test]
    fn marginal_and_joint_max_calibration_are_distinct() {
        let residuals = vec![
            vec![1.0, 4.0],
            vec![2.0, 1.0],
            vec![3.0, 3.0],
            vec![4.0, 2.0],
        ];
        let marginal = split_absolute_residual_quantiles(
            &residuals,
            &[0.5],
            ConformalMultiTargetPolicy::Marginal,
            ConformalSmallSamplePolicy::Error,
        )
        .unwrap();
        assert_eq!(marginal[0].radii, vec![finite(3.0), finite(3.0)]);

        let joint = split_absolute_residual_quantiles(
            &residuals,
            &[0.5],
            ConformalMultiTargetPolicy::JointMax,
            ConformalSmallSamplePolicy::Error,
        )
        .unwrap();
        assert_eq!(joint[0].radii, vec![finite(4.0)]);
    }

    #[test]
    fn multi_coverage_application_is_nested_and_preserves_midpoints() {
        let residuals = (1..=20)
            .map(|value| vec![f64::from(value), f64::from(value) / 2.0])
            .collect::<Vec<_>>();
        let quantiles = split_absolute_residual_quantiles(
            &residuals,
            &[0.8, 0.9, 0.95, 0.99],
            ConformalMultiTargetPolicy::Marginal,
            ConformalSmallSamplePolicy::Unbounded,
        )
        .unwrap();
        let points = vec![vec![100.0, 10.0], vec![200.0, 20.0]];
        let intervals = apply_split_absolute_residual(
            &points,
            &quantiles,
            ConformalMultiTargetPolicy::Marginal,
        )
        .unwrap();
        assert_eq!(intervals.len(), 4);
        assert_eq!(intervals[0].cells[0][0], finite_cell(83.0, 117.0));
        assert_eq!(intervals[1].cells[0][0], finite_cell(81.0, 119.0));
        assert_eq!(intervals[2].cells[0][0], finite_cell(80.0, 120.0));
        assert_eq!(intervals[3].cells[0][0], RegressionIntervalCell::Unbounded);
        assert_eq!(intervals[0].cells[0][0].midpoint(), Some(100.0));
        assert_eq!(intervals[3].cells[0][0].endpoints(), (None, None));
    }

    #[test]
    fn joint_radius_expands_to_every_prediction_target() {
        let quantiles = vec![SplitConformalQuantile {
            coverage: 0.8,
            rank: 4,
            radii: vec![finite(2.0)],
        }];
        let intervals = apply_split_absolute_residual(
            &[vec![10.0, 20.0]],
            &quantiles,
            ConformalMultiTargetPolicy::JointMax,
        )
        .unwrap();
        assert_eq!(
            intervals[0].cells[0],
            vec![finite_cell(8.0, 12.0), finite_cell(18.0, 22.0)]
        );
    }

    #[test]
    fn decimal_endpoints_match_w0_instead_of_binary64_intermediate_arithmetic() {
        let quantiles = vec![SplitConformalQuantile {
            coverage: 0.8,
            rank: 1,
            radii: vec![finite(0.2)],
        }];
        let interval = apply_split_absolute_residual(
            &[vec![0.1]],
            &quantiles,
            ConformalMultiTargetPolicy::Marginal,
        )
        .unwrap();
        let RegressionIntervalCell::Finite { lower, upper } = interval[0].cells[0][0] else {
            panic!("W0 decimal endpoints must be finite");
        };
        assert_eq!(lower.to_bits(), (-0.1_f64).to_bits());
        assert_eq!(upper.to_bits(), 0.3_f64.to_bits());
        assert_ne!(upper.to_bits(), (0.1_f64 + 0.2_f64).to_bits());
        assert!(decimal_interval_closes(0.1, 0.2, lower, upper).unwrap());

        let (lower, upper) = decimal_conformal_endpoints(100.0, 90.0).unwrap();
        assert_eq!((lower, upper), (10.0, 190.0));
        assert!(decimal_interval_closes(100.0, 90.0, lower, upper).unwrap());
        let (lower, upper) = decimal_conformal_endpoints(-100.0, 90.0).unwrap();
        assert_eq!((lower, upper), (-190.0, -10.0));
        assert!(decimal_interval_closes(-100.0, 90.0, lower, upper).unwrap());
    }

    #[test]
    fn decimal_endpoints_accept_independently_rounded_non_collapsed_intervals() {
        // These are canonical W0 decimal endpoints, but a *second* decimal
        // addition of their rendered binary64 values does not reconstruct the
        // original point.  That post-rounding equality is not an interval
        // invariant: endpoint derivation is.
        let point = 0.1;
        let radius = 1.423_415_354_928_408_8;
        let (lower, upper) = decimal_conformal_endpoints(point, radius).unwrap();
        assert!(lower < upper);
        assert!(decimal_interval_closes(point, radius, lower, upper).unwrap());
        let quantiles = vec![SplitConformalQuantile {
            coverage: 0.8,
            rank: 1,
            radii: vec![finite(radius)],
        }];
        assert!(apply_split_absolute_residual(
            &[vec![point]],
            &quantiles,
            ConformalMultiTargetPolicy::Marginal,
        )
        .is_ok());
    }

    #[test]
    fn decimal_endpoints_reject_a_radius_below_the_point_ulp() {
        let quantiles = vec![SplitConformalQuantile {
            coverage: 0.8,
            rank: 1,
            radii: vec![finite(0.5)],
        }];
        assert!(matches!(
            apply_split_absolute_residual(
                &[vec![1.0e16]],
                &quantiles,
                ConformalMultiTargetPolicy::Marginal,
            ),
            Err(ConformalError::UnrepresentableInterval {
                coverage_index: 0,
                row: 0,
                target: 0,
            })
        ));
    }

    #[test]
    fn decimal_endpoints_preserve_signed_zero_and_minimum_subnormal() {
        let zero_quantile = vec![SplitConformalQuantile {
            coverage: 0.5,
            rank: 1,
            radii: vec![finite(-0.0)],
        }];
        let zero_interval = apply_split_absolute_residual(
            &[vec![-0.0]],
            &zero_quantile,
            ConformalMultiTargetPolicy::Marginal,
        )
        .unwrap();
        let RegressionIntervalCell::Finite { lower, upper } = zero_interval[0].cells[0][0] else {
            panic!("zero-radius interval must be finite");
        };
        assert_eq!(lower.to_bits(), (-0.0_f64).to_bits());
        assert_eq!(upper.to_bits(), 0.0_f64.to_bits());
        assert!(decimal_interval_closes(-0.0, 0.0, lower, upper).unwrap());

        let minimum_subnormal = f64::from_bits(1);
        let subnormal_quantile = vec![SplitConformalQuantile {
            coverage: 0.5,
            rank: 1,
            radii: vec![finite(minimum_subnormal)],
        }];
        let subnormal_interval = apply_split_absolute_residual(
            &[vec![0.0], vec![minimum_subnormal]],
            &subnormal_quantile,
            ConformalMultiTargetPolicy::Marginal,
        )
        .unwrap();
        assert_eq!(
            subnormal_interval[0].cells[0][0],
            finite_cell(-minimum_subnormal, minimum_subnormal)
        );
        assert_eq!(
            subnormal_interval[0].cells[1][0],
            finite_cell(0.0, f64::from_bits(2))
        );
        for (point, cell) in [0.0, minimum_subnormal]
            .into_iter()
            .zip(&subnormal_interval[0].cells)
        {
            let RegressionIntervalCell::Finite { lower, upper } = cell[0] else {
                panic!("subnormal interval must be finite");
            };
            assert!(decimal_interval_closes(point, minimum_subnormal, lower, upper).unwrap());
        }
    }

    #[test]
    fn midpoint_is_stable_for_subnormal_and_extreme_bounds() {
        let minimum_subnormal = f64::from_bits(1);
        assert_eq!(
            finite_cell(minimum_subnormal, minimum_subnormal).midpoint(),
            Some(minimum_subnormal)
        );
        assert_eq!(finite_cell(f64::MAX, f64::MAX).midpoint(), Some(f64::MAX));
        assert_eq!(finite_cell(-f64::MAX, f64::MAX).midpoint(), Some(0.0));
        assert_eq!(
            finite_cell(-minimum_subnormal, 0.0)
                .midpoint()
                .unwrap()
                .to_bits(),
            (-0.0_f64).to_bits()
        );
        assert_eq!(
            finite_cell(minimum_subnormal, f64::from_bits(2)).midpoint(),
            Some(f64::from_bits(2))
        );
    }

    #[test]
    fn finite_metrics_match_marginal_and_joint_w0_semantics() {
        let truth = vec![vec![1.0, 10.0], vec![3.0, 20.0]];
        let interval = RegressionConformalInterval {
            coverage: 0.8,
            cells: vec![
                vec![finite_cell(0.0, 2.0), finite_cell(9.0, 11.0)],
                vec![finite_cell(0.0, 2.0), finite_cell(19.0, 21.0)],
            ],
        };
        let marginal =
            regression_conformal_metrics(&truth, &interval, ConformalMultiTargetPolicy::Marginal)
                .unwrap();
        assert_eq!(marginal.len(), 2);
        assert_close(marginal[0].empirical_coverage, 0.5);
        assert_close(marginal[0].coverage_gap, -0.3);
        assert_close(marginal[0].mean_width.unwrap(), 2.0);
        assert_close(marginal[0].median_width.unwrap(), 2.0);
        assert_close(marginal[0].interval_score.unwrap(), 7.0);
        assert_close(marginal[1].empirical_coverage, 1.0);
        assert_close(marginal[1].interval_score.unwrap(), 2.0);

        let joint =
            regression_conformal_metrics(&truth, &interval, ConformalMultiTargetPolicy::JointMax)
                .unwrap();
        assert_eq!(joint.len(), 1);
        assert_eq!(joint[0].target_index, None);
        assert_close(joint[0].empirical_coverage, 0.5);
        assert_close(joint[0].mean_width.unwrap(), 2.0);
        assert_close(joint[0].median_width.unwrap(), 2.0);
        assert_close(joint[0].interval_score.unwrap(), 4.5);
    }

    #[test]
    fn frozen_w0_prediction_blocks_and_metrics_match() {
        let points = vec![vec![10.0, 20.0], vec![11.0, 21.0]];
        let truth = vec![vec![10.0, 21.0], vec![14.0, 21.0]];

        let marginal_quantiles = vec![
            SplitConformalQuantile {
                coverage: 0.8,
                rank: 1,
                radii: vec![finite(2.0), finite(2.0)],
            },
            SplitConformalQuantile {
                coverage: 0.9,
                rank: 2,
                radii: vec![finite(3.0), finite(3.0)],
            },
        ];
        let marginal_intervals = apply_split_absolute_residual(
            &points,
            &marginal_quantiles,
            ConformalMultiTargetPolicy::Marginal,
        )
        .unwrap();
        assert_eq!(
            marginal_intervals[0].cells,
            vec![
                vec![finite_cell(8.0, 12.0), finite_cell(18.0, 22.0)],
                vec![finite_cell(9.0, 13.0), finite_cell(19.0, 23.0)],
            ]
        );
        let marginal_80 = regression_conformal_metrics(
            &truth,
            &marginal_intervals[0],
            ConformalMultiTargetPolicy::Marginal,
        )
        .unwrap();
        assert_close(marginal_80[0].empirical_coverage, 0.5);
        assert_close(marginal_80[0].coverage_gap, -0.300_000_000_000_000_04);
        assert_close(marginal_80[0].mean_width.unwrap(), 4.0);
        assert_close(marginal_80[0].median_width.unwrap(), 4.0);
        assert_close(marginal_80[0].interval_score.unwrap(), 9.0);
        assert_close(marginal_80[1].empirical_coverage, 1.0);
        assert_close(marginal_80[1].interval_score.unwrap(), 4.0);
        let marginal_90 = regression_conformal_metrics(
            &truth,
            &marginal_intervals[1],
            ConformalMultiTargetPolicy::Marginal,
        )
        .unwrap();
        for metric in marginal_90 {
            assert_close(metric.empirical_coverage, 1.0);
            assert_close(metric.mean_width.unwrap(), 6.0);
            assert_close(metric.interval_score.unwrap(), 6.0);
        }

        let joint_quantiles = vec![
            SplitConformalQuantile {
                coverage: 0.8,
                rank: 1,
                radii: vec![finite(3.0)],
            },
            SplitConformalQuantile {
                coverage: 0.9,
                rank: 2,
                radii: vec![finite(4.0)],
            },
        ];
        let joint_intervals = apply_split_absolute_residual(
            &points,
            &joint_quantiles,
            ConformalMultiTargetPolicy::JointMax,
        )
        .unwrap();
        for (interval, expected_width) in joint_intervals.iter().zip([6.0, 8.0]) {
            let metric = regression_conformal_metrics(
                &truth,
                interval,
                ConformalMultiTargetPolicy::JointMax,
            )
            .unwrap();
            assert_close(metric[0].empirical_coverage, 1.0);
            assert_close(metric[0].mean_width.unwrap(), expected_width);
            assert_close(metric[0].median_width.unwrap(), expected_width);
            assert_close(metric[0].interval_score.unwrap(), expected_width);
        }
    }

    #[test]
    fn unbounded_metrics_keep_coverage_and_tag_measurements_unavailable() {
        let truth = vec![vec![1.0, 10.0], vec![3.0, 20.0]];
        let interval = RegressionConformalInterval {
            coverage: 0.9,
            cells: vec![
                vec![RegressionIntervalCell::Unbounded, finite_cell(9.0, 11.0)],
                vec![RegressionIntervalCell::Unbounded, finite_cell(19.0, 21.0)],
            ],
        };
        let marginal =
            regression_conformal_metrics(&truth, &interval, ConformalMultiTargetPolicy::Marginal)
                .unwrap();
        assert_eq!(
            marginal[0].measurement_status,
            ConformalMeasurementStatus::Unbounded
        );
        assert_eq!(marginal[0].empirical_coverage, 1.0);
        assert_eq!(marginal[0].mean_width, None);
        assert_eq!(
            marginal[1].measurement_status,
            ConformalMeasurementStatus::Finite
        );

        let joint =
            regression_conformal_metrics(&truth, &interval, ConformalMultiTargetPolicy::JointMax)
                .unwrap();
        assert_eq!(
            joint[0].measurement_status,
            ConformalMeasurementStatus::Unbounded
        );
        assert_eq!(joint[0].empirical_coverage, 1.0);
        assert_eq!(joint[0].interval_score, None);
    }

    #[test]
    fn finite_metric_means_do_not_overflow_when_the_mean_is_representable() {
        let interval = RegressionConformalInterval {
            coverage: 0.5,
            cells: vec![
                vec![finite_cell(0.0, f64::MAX)],
                vec![finite_cell(0.0, f64::MAX)],
            ],
        };
        let metrics = regression_conformal_metrics(
            &[vec![0.0], vec![f64::MAX]],
            &interval,
            ConformalMultiTargetPolicy::Marginal,
        )
        .unwrap();
        assert_eq!(metrics[0].mean_width, Some(f64::MAX));
        assert_eq!(metrics[0].median_width, Some(f64::MAX));
        assert_eq!(metrics[0].interval_score, Some(f64::MAX));
    }

    #[test]
    fn finite_metric_mean_keeps_w0_sequential_sum_rounding() {
        let values = [1.0, 1.0, 1.0e16];
        let mut sequential_sum = 0.0;
        for value in values {
            sequential_sum += value;
        }
        assert_eq!(sequential_sum / 3.0, 3_333_333_333_333_334.0);
        assert_eq!(
            checked_mean(&values, "rounding parity").unwrap(),
            sequential_sum / 3.0
        );
    }

    #[test]
    fn invalid_coverages_and_residual_matrices_are_rejected() {
        for coverages in [
            vec![],
            vec![0.0],
            vec![1.0],
            vec![f64::NAN],
            vec![0.9, 0.8],
            vec![0.9, 0.9],
        ] {
            assert!(validate_conformal_coverages(&coverages).is_err());
        }
        let invalid = [
            vec![],
            vec![vec![]],
            vec![vec![1.0], vec![1.0, 2.0]],
            vec![vec![f64::INFINITY]],
            vec![vec![-1.0]],
        ];
        for residuals in invalid {
            assert!(split_absolute_residual_quantiles(
                &residuals,
                &[0.5],
                ConformalMultiTargetPolicy::Marginal,
                ConformalSmallSamplePolicy::Error,
            )
            .is_err());
        }
    }

    #[test]
    fn application_rejects_bad_shape_status_order_and_overflow() {
        let points = vec![vec![1.0, 2.0]];
        let bad_shape = vec![SplitConformalQuantile {
            coverage: 0.8,
            rank: 2,
            radii: vec![finite(1.0)],
        }];
        assert!(apply_split_absolute_residual(
            &points,
            &bad_shape,
            ConformalMultiTargetPolicy::Marginal
        )
        .is_err());

        let mixed = vec![SplitConformalQuantile {
            coverage: 0.8,
            rank: 2,
            radii: vec![finite(1.0), ConformalRadius::Unbounded],
        }];
        assert!(matches!(
            apply_split_absolute_residual(&points, &mixed, ConformalMultiTargetPolicy::Marginal),
            Err(ConformalError::MixedRadiusStatus { .. })
        ));

        let non_nested = vec![
            SplitConformalQuantile {
                coverage: 0.8,
                rank: 2,
                radii: vec![finite(2.0), finite(2.0)],
            },
            SplitConformalQuantile {
                coverage: 0.9,
                rank: 3,
                radii: vec![finite(1.0), finite(2.0)],
            },
        ];
        assert!(matches!(
            apply_split_absolute_residual(
                &points,
                &non_nested,
                ConformalMultiTargetPolicy::Marginal
            ),
            Err(ConformalError::NonNestedRadius { .. })
        ));

        let overflow = vec![SplitConformalQuantile {
            coverage: 0.8,
            rank: 2,
            radii: vec![finite(f64::MAX)],
        }];
        assert!(matches!(
            apply_split_absolute_residual(
                &[vec![f64::MAX]],
                &overflow,
                ConformalMultiTargetPolicy::Marginal
            ),
            Err(ConformalError::ArithmeticOverflow { .. })
        ));
    }

    #[test]
    fn metrics_reject_invalid_shapes_bounds_and_nonfinite_truth() {
        let valid_interval = RegressionConformalInterval {
            coverage: 0.8,
            cells: vec![vec![finite_cell(0.0, 2.0)]],
        };
        assert!(regression_conformal_metrics(
            &[vec![f64::NAN]],
            &valid_interval,
            ConformalMultiTargetPolicy::Marginal
        )
        .is_err());
        assert!(regression_conformal_metrics(
            &[vec![1.0], vec![2.0]],
            &valid_interval,
            ConformalMultiTargetPolicy::Marginal
        )
        .is_err());
        let bad_bounds = RegressionConformalInterval {
            coverage: 0.8,
            cells: vec![vec![finite_cell(2.0, 1.0)]],
        };
        assert!(matches!(
            regression_conformal_metrics(
                &[vec![1.0]],
                &bad_bounds,
                ConformalMultiTargetPolicy::Marginal
            ),
            Err(ConformalError::InvalidIntervalCell { .. })
        ));
    }
}
