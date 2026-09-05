# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Neutral file description + axis detection (Epic 1.1/1.2, copied from detector.py).

``describe`` reports *neutral, context-free* evidence about a tabular file —
delimiter/decimal/header candidates, table shape, per-column numeric stats, and a
wavelength-axis verdict with its unit. It deliberately does NOT assign dataset
roles (X/Y/metadata) or infer signal type from bare values — those need dataset
context and live in :mod:`nirs4all_io.infer.engine` (design decision D2).

Constants and algorithms are reproduced from nirs4all ``data/detection/detector.py``
(COPY_PROVENANCE #7/#8).
"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

DELIMITERS = [",", ";", "\t", "|", " "]

HEADER_PATTERNS: dict[str, list[str]] = {
    "nm": [r"^\d{3,4}(?:\.\d+)?$", r"^\d{3,4}(?:\.\d+)?nm$"],
    "cm-1": [r"^\d{4,5}(?:\.\d+)?$", r"^\d{4,5}(?:\.\d+)?cm-1$", r"^\d{4,5}(?:\.\d+)?wavenumber$"],
    "text": [r"^[a-zA-Z]", r"^feature_\d+$", r"^[xX]_?\d+$"],
    "index": [r"^\d{1,3}$"],
}


@dataclass
class FileDescription:
    delimiter: str = ";"
    decimal_separator: str = "."
    has_header: bool = True
    header_unit: str = "text"
    n_rows: int = 0
    n_cols: int = 0
    is_wavelength_header: bool = False
    axis_range: tuple[float, float] | None = None
    confidence: dict[str, float] = field(default_factory=dict)
    column_names: list[str] = field(default_factory=list)


def _is_numeric(value: str, decimal_sep: str = ".") -> bool:
    value = value.strip()
    if not value:
        return False
    try:
        if "e" in value.lower():
            float(value.replace(decimal_sep, "."))
        else:
            float(value.replace(",", ".") if decimal_sep == "," else value)
        return True
    except ValueError:
        return False


def _score_delimiter(lines: list[str], delim: str) -> float:
    try:
        counts = [len(row) for row in csv.reader(io.StringIO("\n".join(lines)), delimiter=delim) if row]
    except csv.Error:
        return 0.0
    if not counts:
        return 0.0
    from collections import Counter

    most_common_count, freq = Counter(counts).most_common(1)[0]
    if most_common_count == 1:
        return 0.1
    consistency = freq / len(counts)
    return consistency * 5 + min(most_common_count / 10, 5)


def _detect_delimiter(lines: list[str]) -> tuple[str, float]:
    best, score = ";", 0.0
    for delim in DELIMITERS:
        s = _score_delimiter(lines, delim)
        if s > score:
            best, score = delim, s
    return best, min(score / 10, 1.0)


def _detect_decimal(rows: list[list[str]]) -> tuple[str, float]:
    dot_count = dot_valid = comma_count = comma_valid = 0
    for row in rows[1:]:
        for cell in row:
            cell = cell.strip()
            if "." in cell and "," not in cell:
                dot_count += 1
                dot_valid += _is_numeric(cell)
            elif "," in cell and "." not in cell:
                comma_count += 1
                comma_valid += _is_numeric(cell.replace(",", "."))
    if dot_valid >= comma_valid:
        return ".", min((dot_valid + 1) / (max(dot_count, 1) + comma_count + 1), 1.0)
    return ",", min((comma_valid + 1) / (max(comma_count, 1) + dot_count + 1), 1.0)


def _detect_header(rows: list[list[str]], decimal_sep: str) -> tuple[bool, float]:
    if len(rows) < 2:
        return True, 0.5
    first = rows[0]
    data_rows = rows[1 : min(10, len(rows))]
    first_ratio = (sum(_is_numeric(c, decimal_sep) for c in first) / len(first)) if first else 0.0
    ratios = [sum(_is_numeric(c, decimal_sep) for c in r) / len(r) for r in data_rows if r]
    if not ratios:
        return True, 0.5
    avg = float(np.mean(ratios))
    if first_ratio < avg - 0.3:
        return True, min((avg - first_ratio) * 2, 1.0)
    if first_ratio > 0.9 and len(first) >= 10:
        is_wl, conf = detect_wavelength_header(first, data_rows, decimal_sep)
        if is_wl:
            return True, conf
    if abs(first_ratio - avg) < 0.1:
        return False, 0.7
    return True, 0.5


def detect_wavelength_header(first_row: list[str], data_rows: list[list[str]], decimal_sep: str) -> tuple[bool, float]:
    """Numeric monotonic spectral axis (heuristic C). Reject CV > 0.5."""
    try:
        values = [float(c.strip().replace(decimal_sep, ".")) for c in first_row]
    except ValueError:
        return False, 0.0
    if len(values) < 10:
        return False, 0.0
    diffs = np.diff(values)
    if not (np.all(diffs > 0) or np.all(diffs < 0)):
        return False, 0.0
    lo, hi = min(values), max(values)
    is_nm = 200 <= lo <= 2600 and 350 <= hi <= 2600
    is_cm1 = 400 <= lo <= 15000 and 1000 <= hi <= 15000
    if not (is_nm or is_cm1):
        return False, 0.0
    abs_diffs = np.abs(diffs)
    cv = float(np.std(abs_diffs) / np.mean(abs_diffs)) if np.mean(abs_diffs) > 0 else 1.0
    if cv > 0.5:
        return False, 0.0
    return True, 0.85


def detect_header_unit(header_row: list[str]) -> tuple[str, float]:
    scores = {unit: 0 for unit in HEADER_PATTERNS}
    for cell in header_row:
        cell = cell.strip()
        if not cell:
            continue
        for unit, patterns in HEADER_PATTERNS.items():
            if any(re.match(p, cell, re.IGNORECASE) for p in patterns):
                scores[unit] += 1
                break
    total = sum(scores.values())
    if total == 0:
        return "text", 0.5
    best = max(scores, key=lambda k: scores[k])
    if best in ("nm", "cm-1"):
        try:
            vals = [float(c.strip()) for c in header_row if c.strip()]
            lo, hi = min(vals), max(vals)
            if 350 <= lo <= 2500 and hi <= 2500:
                return "nm", 0.8
            if 400 <= lo <= 12500 and hi <= 12500 and lo > 2500:
                return "cm-1", 0.8
        except ValueError:
            pass
    return best, scores[best] / total


def describe(source: str | Path, *, sample_lines: int = 50) -> FileDescription:
    """Describe a delimited text file (neutral structural evidence)."""
    path = Path(source)
    text = path.read_text(encoding="utf-8", errors="replace")
    lines = [ln.strip() for ln in text.split("\n")[:sample_lines] if ln.strip()]
    desc = FileDescription()
    if not lines:
        return desc
    desc.delimiter, dconf = _detect_delimiter(lines)
    rows = [row for row in csv.reader(io.StringIO("\n".join(lines)), delimiter=desc.delimiter) if any(c.strip() for c in row)]
    if not rows:
        return desc
    desc.n_cols = max(len(r) for r in rows)
    desc.n_rows = len(rows)
    desc.decimal_separator, decconf = _detect_decimal(rows)
    desc.has_header, hconf = _detect_header(rows, desc.decimal_separator)
    if desc.has_header:
        desc.column_names = [c.strip() for c in rows[0]]
        is_wl, _ = detect_wavelength_header(rows[0], rows[1:6], desc.decimal_separator) if len(rows[0]) >= 10 else (False, 0.0)
        desc.is_wavelength_header = is_wl
        desc.header_unit, uconf = detect_header_unit(rows[0])
        if is_wl:
            try:
                vals = [float(c.strip().replace(desc.decimal_separator, ".")) for c in rows[0]]
                desc.axis_range = (min(vals), max(vals))
            except ValueError:
                pass
        desc.confidence["header_unit"] = uconf
    desc.confidence.update({"delimiter": dconf, "decimal_separator": decconf, "has_header": hconf})
    return desc
