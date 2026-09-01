# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Sample-identity inference + cross-file alignment audit (Epic 3.3, R-IDX).

Detects a **sample-id column** (so the loader can align by id, not row order),
classifies a metadata source as **per-sample (1:1)** vs **shared/dimension (m:1)**,
and audits coverage: does every sample have a target and metadata? Duplicate ids?
These feed the inference engine's resolved spec (keys + joins) and plan warnings.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field

import pandas as pd

# id-like column names (case-insensitive): sample_id, id, name, code, ref, key, *_id, ...
_ID_NAME_RE = re.compile(r"^(sample[_ ]?id|sampleid|sample|id|name|code|ref(erence)?|key|index|spectrum[_ ]?id|scan[_ ]?id|.*_id|id_.*)$", re.IGNORECASE)
_WL_RE = re.compile(r"^\d+(\.\d+)?(nm|cm-1)?$", re.IGNORECASE)


@dataclass
class SampleIdGuess:
    column: str
    score: float
    unique: bool
    evidence: list[str] = field(default_factory=list)


@dataclass
class RepetitionProfile:
    n_rows: int
    n_unique: int
    avg_reps: float
    is_repetition: bool  # systematic repeats (vs sporadic duplicates)


# Replicate-suffix patterns on a filename stem (mango_001_a / sample-rep2 / scan_3 / (2)).
# A bare trailing number (_1, _2) is deliberately EXCLUDED: it is usually the sample
# number, not a replicate index, and would over-group distinct samples.
_REPLICATE_SUFFIX_PATTERNS = [
    r"[_\-. ]rep(?:licate)?[_\-. ]?\d+$",
    r"[_\-. ]r\d+$",
    r"[_\-. ]scan[_\-. ]?\d+$",
    r"[_\-. ]dup(?:licate)?\d*$",
    r"\s*\(\d+\)$",
    r"[_\-. ][a-z]$",  # single trailing letter: mango_001_a / _b / _c
]


@dataclass
class ReplicateGrouping:
    pattern: str
    sample_ids: list[str]  # the grouped sample id per file (suffix stripped)
    n_files: int
    n_samples: int
    avg_reps: float
    evidence: list[str] = field(default_factory=list)


def detect_replicate_grouping(stems: list[str]) -> ReplicateGrouping | None:
    """Detect replicate files of the same sample (mango_001_a/_b/_c -> mango_001).

    Tries replicate-suffix patterns; accepts one only if a majority of stems carry
    it AND stripping it merges files into fewer samples with avg >= 1.5 reps.
    """
    n = len(stems)
    if n < 2:
        return None
    best: tuple[float, ReplicateGrouping] | None = None
    for pat in _REPLICATE_SUFFIX_PATTERNS:
        rx = re.compile(pat, re.IGNORECASE)
        stripped = [rx.sub("", s) for s in stems]
        matched = sum(1 for s, st in zip(stripped, stems, strict=True) if s != st)
        if matched < n * 0.5:  # most files must carry the suffix
            continue
        n_samples = len(set(stripped))
        if n_samples >= n:  # nothing merged
            continue
        avg = n / n_samples
        if avg < 1.5:  # not a real repetition pattern
            continue
        score = matched / n
        if best is None or score > best[0]:
            ev = [f"replicate suffix /{pat}/ on {matched}/{n} files -> {n_samples} sample(s), avg {round(avg, 2)} reps"]
            best = (score, ReplicateGrouping(pat, stripped, n, n_samples, round(avg, 2), ev))
    return best[1] if best else None


def repetition_profile(ids: pd.Series) -> RepetitionProfile:
    """Decide whether a non-unique id column is *repeated measurements* (avg >=1.5
    rows/id) or just sporadic duplicate ids (a data-quality issue)."""
    n = len(ids)
    u = int(ids.nunique(dropna=False)) or 1
    avg = n / u
    return RepetitionProfile(n_rows=n, n_unique=u, avg_reps=round(avg, 2), is_repetition=(u < n and avg >= 1.5))


def detect_sample_id(df: pd.DataFrame) -> SampleIdGuess | None:
    """Pick the most likely sample-id column, or None. Requires score >= 0.5."""
    n = len(df)
    if n == 0:
        return None
    best: SampleIdGuess | None = None
    for col in df.columns:
        name = str(col)
        if _WL_RE.match(name):  # a wavelength column is never the id
            continue
        s = df[col]
        nunique = int(s.nunique(dropna=False))
        unique = nunique == n
        score, ev = 0.0, []
        if _ID_NAME_RE.match(name):
            score += 0.5
            ev.append(f"id-like name '{name}'")
        if unique:
            score += 0.35
            ev.append("unique per row")
        elif nunique >= 0.9 * n:
            score += 0.15
            ev.append("near-unique values")
        if pd.api.types.is_float_dtype(s):
            score -= 0.25  # continuous float is unlikely to be an identifier
        elif not pd.api.types.is_numeric_dtype(s):
            score += 0.1
            ev.append("string identifier")
        if score > 0 and (best is None or score > best.score):
            best = SampleIdGuess(name, min(score, 1.0), unique, ev)
    return best if best and best.score >= 0.5 else None


def coverage_audit(x_ids: pd.Series, other_ids: pd.Series, *, other_name: str) -> dict:
    """Does every sample id have a match in `other_ids`? Report missing/extra/duplicates."""
    x_list = [str(v) for v in x_ids.tolist()]
    o_set = {str(v) for v in other_ids.tolist()}
    x_set = set(x_list)
    missing = sorted(x_set - o_set)
    extra = sorted(o_set - x_set)
    dup_x = sorted(k for k, c in Counter(x_list).items() if c > 1)
    return {
        "against": other_name,
        "n_samples": len(x_set),
        "n_missing": len(missing),
        "missing": missing[:20],
        "n_extra": len(extra),
        "extra": extra[:20],
        "duplicate_sample_ids": dup_x[:20],
    }


def classify_metadata_relation(x_df: pd.DataFrame, meta_df: pd.DataFrame, x_id: str) -> tuple[str, str, list[str]] | None:
    """Classify a metadata source vs the samples: ('1:1'|'m:1', key, evidence).

    1:1 = per-sample metadata keyed by the sample id; m:1 = a shared dimension
    table keyed by a grouping column present in X (fewer rows, broadcast).
    """
    # per-sample: metadata carries the sample id, one row per sample
    if x_id in meta_df.columns and meta_df[x_id].is_unique and len(meta_df) >= len(x_df) * 0.5:
        return "1:1", x_id, [f"keyed by sample id '{x_id}' (one row per sample)"]
    # shared/dimension: a column present in both, unique in metadata, fewer rows than samples
    for col in meta_df.columns:
        if col == x_id or col not in x_df.columns:
            continue
        if meta_df[col].is_unique and len(meta_df) < len(x_df):
            return "m:1", col, [f"shared dimension table keyed by '{col}' ({len(meta_df)} rows broadcast to {len(x_df)} samples)"]
    return None
