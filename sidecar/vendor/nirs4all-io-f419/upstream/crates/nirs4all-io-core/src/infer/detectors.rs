// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Value-based detectors: signal type + task type (ports `infer/detectors.py`).
//!
//! Signal type uses the additive-scorer model with a water-band tiebreak and a
//! `best / sum` normalization gated at 0.7 → "unknown". Task type uses the
//! integer/decimal-cardinality rules. These are dataset-context inferences (they
//! live in io, not the file layer). The reason string embeds `:.3f`/`:.0%`
//! formatted values — reproduced via `pyfmt`.

use crate::pyfmt::{nanmax, nanmean, nanmin, nanstd, py_fmt_f3, py_pct0};

const WATER_BANDS_NM: [f64; 3] = [1450.0, 1940.0, 2500.0];

/// Return `(task_type, score)`. Integers: 2→binary, 3..=100→multiclass, else regression.
pub fn detect_task_type(y: &[f64], threshold: f64) -> (&'static str, f64) {
    let clean: Vec<f64> = y.iter().copied().filter(|v| !v.is_nan()).collect();
    if clean.is_empty() {
        return ("regression", 0.0);
    }
    let all_integer = clean.iter().all(|v| v.rem_euclid(1.0) == 0.0);
    if all_integer {
        let n_unique = unique_count(&clean);
        return match n_unique {
            2 => ("binary", 0.9),
            n if (2..=100).contains(&n) => ("multiclass", 0.8),
            _ => ("regression", 0.8),
        };
    }
    if clean.iter().all(|&v| (0.0..=1.0).contains(&v)) {
        let uniq = unique_sorted(&clean);
        if uniq.len() == 2 && uniq[0] == 0.0 && uniq[1] == 1.0 {
            return ("binary", 0.85);
        }
        if (uniq.len() as f64) <= clean.len() as f64 * threshold {
            return (
                if uniq.len() == 2 {
                    "binary"
                } else {
                    "multiclass"
                },
                0.6,
            );
        }
    }
    ("regression", 0.8)
}

fn unique_sorted(xs: &[f64]) -> Vec<f64> {
    let mut v: Vec<f64> = xs.to_vec();
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v.dedup();
    v
}

fn unique_count(xs: &[f64]) -> usize {
    unique_sorted(xs).len()
}

fn is_preprocessed(mn: f64, mx: f64, mean: f64, std: f64) -> bool {
    (mean.abs() < 0.01 && std > 0.1)
        || ((std - 1.0).abs() < 0.1 && mean.abs() < 0.1)
        || (mn < -0.5 && mx < 0.5 && mean.abs() < 0.01)
}

/// Additive scorers, in the exact Python insertion order (ties → first wins).
fn score_scorers(mn: f64, mx: f64, mean: f64) -> [(&'static str, f64); 5] {
    let mut reflectance = 0.0;
    let mut reflectance_pct = 0.0;
    let mut transmittance = 0.0;
    let mut transmittance_pct = 0.0;
    let mut absorbance = 0.0;
    if mn >= 0.0 && mx <= 1.2 {
        reflectance += 0.5;
        if (0.1..=0.8).contains(&mean) {
            reflectance += 0.3;
        }
        if mx <= 1.0 {
            reflectance += 0.2;
        }
        transmittance += 0.4;
        if (0.05..=0.5).contains(&mean) {
            transmittance += 0.2;
        }
    }
    if mn >= 0.0 && mx > 1.5 && mx <= 120.0 {
        reflectance_pct += 0.5;
        if (10.0..=80.0).contains(&mean) {
            reflectance_pct += 0.3;
        }
        if mx <= 100.0 {
            reflectance_pct += 0.2;
        }
        transmittance_pct += 0.4;
        if (5.0..=50.0).contains(&mean) {
            transmittance_pct += 0.2;
        }
    }
    if mn >= -0.5 && (0.5..=5.0).contains(&mx) {
        absorbance += 0.4;
        if (0.2..=2.0).contains(&mean) {
            absorbance += 0.3;
        }
        if mn >= -0.2 {
            absorbance += 0.2;
        }
        if mx >= 1.0 {
            absorbance += 0.1;
        }
    }
    [
        ("reflectance", reflectance),
        ("reflectance%", reflectance_pct),
        ("transmittance", transmittance),
        ("transmittance%", transmittance_pct),
        ("absorbance", absorbance),
    ]
}

/// `(scorer_key, hint)` pairs to add (×0.2) when a water-band signature is found.
fn water_band_hint(data: &[f64], ncols: usize, wl: &[f64]) -> Vec<(&'static str, f64)> {
    let nrows = data.len().checked_div(ncols).unwrap_or(0);
    if wl.len() != ncols || nrows == 0 {
        return vec![];
    }
    // per-column nanmean (mean spectrum)
    let mean_spectrum: Vec<f64> = (0..ncols)
        .map(|j| {
            let col: Vec<f64> = (0..nrows).map(|i| data[i * ncols + j]).collect();
            nanmean(&col).unwrap_or(f64::NAN)
        })
        .collect();
    let (wl_min, wl_max) = (
        wl.iter().copied().fold(f64::INFINITY, f64::min),
        wl.iter().copied().fold(f64::NEG_INFINITY, f64::max),
    );
    let mut peak = 0;
    let mut dip = 0;
    for &band in &WATER_BANDS_NM {
        if !(wl_min <= band && band <= wl_max) {
            continue;
        }
        let idx = argmin_abs_diff(wl, band);
        let lo = idx.saturating_sub(10);
        let hi = (idx + 10).min(mean_spectrum.len());
        let local = nanmean(&mean_spectrum[lo..hi]).unwrap_or(f64::NAN);
        let val = mean_spectrum[idx];
        if val > local * 1.05 {
            peak += 1;
        } else if val < local * 0.95 {
            dip += 1;
        }
    }
    if peak > dip {
        vec![
            ("absorbance", 0.3),
            ("reflectance", -0.1),
            ("transmittance", -0.1),
        ]
    } else if dip > peak {
        vec![
            ("absorbance", -0.1),
            ("reflectance", 0.2),
            ("transmittance", 0.2),
        ]
    } else {
        vec![]
    }
}

fn argmin_abs_diff(wl: &[f64], band: f64) -> usize {
    let mut best = 0;
    let mut best_val = f64::INFINITY;
    for (i, &v) in wl.iter().enumerate() {
        let d = (v - band).abs();
        if d < best_val {
            best_val = d;
            best = i;
        }
    }
    best
}

/// Return `(signal_type, score, reason)`. Below `threshold` → "unknown".
/// `data` is row-major `nrows × ncols`; `wl` (optional) aligns to columns.
pub fn detect_signal_type(
    data: &[f64],
    ncols: usize,
    wl: Option<&[f64]>,
    threshold: f64,
) -> (String, f64, String) {
    if data.is_empty() {
        return ("unknown".into(), 0.0, "empty data".into());
    }
    let mn = nanmin(data).unwrap_or(f64::NAN);
    let mx = nanmax(data).unwrap_or(f64::NAN);
    let mean = nanmean(data).unwrap_or(f64::NAN);
    let std = nanstd(data).unwrap_or(f64::NAN);
    if is_preprocessed(mn, mx, mean, std) {
        return (
            "preprocessed".into(),
            0.9,
            "data appears preprocessed (centered/SNV/derivative)".into(),
        );
    }
    let mut scores = score_scorers(mn, mx, mean);
    if let Some(wl) = wl {
        for (sig, hint) in water_band_hint(data, ncols, wl) {
            if let Some(entry) = scores.iter_mut().find(|(k, _)| *k == sig) {
                entry.1 += hint * 0.2;
            }
        }
    }
    // max by value, first-in-order wins (matches Python max over dict).
    let (best, best_score) = scores
        .iter()
        .fold(scores[0], |acc, &cur| if cur.1 > acc.1 { cur } else { acc });
    let total: f64 = scores.iter().map(|(_, s)| *s).sum();
    let score = if total > 0.0 { best_score / total } else { 0.0 };
    let reason = format!(
        "range [{}, {}], mean {} -> {best} ({})",
        py_fmt_f3(mn),
        py_fmt_f3(mx),
        py_fmt_f3(mean),
        py_pct0(score)
    );
    if score < threshold {
        ("unknown".into(), score, reason)
    } else {
        (best.to_string(), score, reason)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block() -> Vec<f64> {
        // 6x12: cols 0..6 = 0.40, cols 6..12 = 1.30 (contract corpus feature block).
        let mut v = Vec::new();
        for _ in 0..6 {
            v.extend(std::iter::repeat_n(0.40, 6));
            v.extend(std::iter::repeat_n(1.30, 6));
        }
        v
    }

    #[test]
    fn signal_absorbance_on_corpus() {
        let (sig, score, reason) = detect_signal_type(&block(), 12, None, 0.7);
        assert_eq!(sig, "absorbance");
        assert_eq!(score, 1.0);
        assert_eq!(
            reason,
            "range [0.400, 1.300], mean 0.850 -> absorbance (100%)"
        );
    }

    #[test]
    fn task_regression_floats() {
        let (task, score) = detect_task_type(&[12.5, 8.3, 15.1, 9.7, 11.2, 13.8], 0.05);
        assert_eq!(task, "regression");
        assert_eq!(score, 0.8);
    }

    #[test]
    fn task_integer_cardinality() {
        assert_eq!(
            detect_task_type(&[0.0, 1.0, 0.0, 1.0], 0.05),
            ("binary", 0.9)
        );
        assert_eq!(
            detect_task_type(&[0.0, 1.0, 2.0, 3.0], 0.05),
            ("multiclass", 0.8)
        );
    }
}
