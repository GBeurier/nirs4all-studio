# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Value-based detectors: signal type + task type (copied from nirs4all).

Signal type uses the additive-scorer model with water-band tiebreak and a
``best / sum`` normalization gated at 0.7 -> UNKNOWN (from ``data/signal_type.py``,
COPY_PROVENANCE #9). Task type uses the integer/decimal-cardinality rules
(``core/task_detection.py``, COPY_PROVENANCE #10). These are *dataset-context*
inferences (D2) — they live in io, not in the formats file layer.
"""

from __future__ import annotations

import numpy as np

WATER_BANDS_NM = [1450, 1940, 2500]


def detect_task_type(y: np.ndarray, threshold: float = 0.05) -> tuple[str, float]:
    """Return (task_type, score). Integers: 2->binary, 3..100->multiclass, >100->regression."""
    y_flat = np.asarray(y).ravel().astype(float)
    y_clean = y_flat[~np.isnan(y_flat)]
    if y_clean.size == 0:
        return "regression", 0.0
    if np.all(np.equal(np.mod(y_clean, 1), 0)):
        n_unique = len(np.unique(y_clean))
        if n_unique == 2:
            return "binary", 0.9
        if 2 < n_unique <= 100:
            return "multiclass", 0.8
        return "regression", 0.8
    if np.all(y_clean >= 0) and np.all(y_clean <= 1):
        uniq = np.unique(y_clean)
        if len(uniq) == 2 and set(uniq.tolist()) == {0.0, 1.0}:
            return "binary", 0.85
        if len(uniq) <= len(y_clean) * threshold:
            return ("binary" if len(uniq) == 2 else "multiclass"), 0.6
    return "regression", 0.8


def _is_preprocessed(mn: float, mx: float, mean: float, std: float) -> bool:
    return (
        (abs(mean) < 0.01 and std > 0.1)
        or (abs(std - 1.0) < 0.1 and abs(mean) < 0.1)
        or (mn < -0.5 and mx < 0.5 and abs(mean) < 0.01)
    )


def _score_scorers(mn: float, mx: float, mean: float) -> dict[str, float]:
    scores: dict[str, float] = {"reflectance": 0.0, "reflectance%": 0.0, "transmittance": 0.0, "transmittance%": 0.0, "absorbance": 0.0}
    if mn >= 0 and mx <= 1.2:
        scores["reflectance"] += 0.5
        if 0.1 <= mean <= 0.8:
            scores["reflectance"] += 0.3
        if mx <= 1.0:
            scores["reflectance"] += 0.2
        scores["transmittance"] += 0.4
        if 0.05 <= mean <= 0.5:
            scores["transmittance"] += 0.2
    if mn >= 0 and 1.5 < mx <= 120:
        scores["reflectance%"] += 0.5
        if 10 <= mean <= 80:
            scores["reflectance%"] += 0.3
        if mx <= 100:
            scores["reflectance%"] += 0.2
        scores["transmittance%"] += 0.4
        if 5 <= mean <= 50:
            scores["transmittance%"] += 0.2
    if mn >= -0.5 and 0.5 <= mx <= 5.0:
        scores["absorbance"] += 0.4
        if 0.2 <= mean <= 2.0:
            scores["absorbance"] += 0.3
        if mn >= -0.2:
            scores["absorbance"] += 0.2
        if mx >= 1.0:
            scores["absorbance"] += 0.1
    return scores


def _water_band_hint(spectra: np.ndarray, wavelengths_nm: np.ndarray) -> dict[str, float]:
    if wavelengths_nm is None or spectra.ndim != 2 or len(wavelengths_nm) != spectra.shape[1]:
        return {}
    mean_spectrum = np.nanmean(spectra, axis=0)
    peak = dip = 0
    for band in WATER_BANDS_NM:
        if not (wavelengths_nm.min() <= band <= wavelengths_nm.max()):
            continue
        idx = int(np.argmin(np.abs(wavelengths_nm - band)))
        lo, hi = max(0, idx - 10), min(len(mean_spectrum), idx + 10)
        local = float(np.nanmean(mean_spectrum[lo:hi]))
        val = float(mean_spectrum[idx])
        if val > local * 1.05:
            peak += 1
        elif val < local * 0.95:
            dip += 1
    if peak > dip:
        return {"absorbance": 0.3, "reflectance": -0.1, "transmittance": -0.1}
    if dip > peak:
        return {"absorbance": -0.1, "reflectance": 0.2, "transmittance": 0.2}
    return {}


def detect_signal_type(spectra: np.ndarray, wavelengths_nm: np.ndarray | None = None, *, threshold: float = 0.7) -> tuple[str, float, str]:
    """Return (signal_type, score, reason). Below ``threshold`` -> 'unknown'."""
    data = np.asarray(spectra, dtype=float)
    if data.size == 0:
        return "unknown", 0.0, "empty data"
    mn, mx = float(np.nanmin(data)), float(np.nanmax(data))
    mean, std = float(np.nanmean(data)), float(np.nanstd(data))
    if _is_preprocessed(mn, mx, mean, std):
        return "preprocessed", 0.9, "data appears preprocessed (centered/SNV/derivative)"
    scores = _score_scorers(mn, mx, mean)
    for sig, hint in _water_band_hint(data, wavelengths_nm).items() if wavelengths_nm is not None else []:
        if sig in scores:
            scores[sig] += hint * 0.2
    best = max(scores, key=lambda k: scores[k])
    total = sum(scores.values())
    score = scores[best] / total if total > 0 else 0.0
    reason = f"range [{mn:.3f}, {mx:.3f}], mean {mean:.3f} -> {best} ({score:.0%})"
    if score < threshold:
        return "unknown", score, reason
    return best, score, reason
