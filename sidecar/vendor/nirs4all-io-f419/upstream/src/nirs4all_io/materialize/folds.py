# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Fold-file parsing (Epic 4 / A.8).

Copied and re-orchestrated from ``nirs4all`` ``controllers/splitters/fold_file_loader.py``
(COPY_PROVENANCE #14). Supports csv-nirs4all (columns of TRAIN ids, val = complement),
csv-assignment (a ``fold`` column of VAL membership, train = complement), JSON/YAML
(``[{train, val|test}]``) and TXT (even lines, alternating train/val).
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

import yaml

from ..spec.enums import SpecError

Fold = tuple[list[int], list[int]]
_EXT_FORMAT = {".csv": "csv", ".json": "json", ".yaml": "yaml", ".yml": "yaml", ".txt": "txt"}


def parse_fold_file(path: str | Path, fmt: str = "auto") -> list[Fold]:
    path = Path(path)
    if not path.exists():
        raise SpecError(f"fold file not found: {path}")
    if fmt in (None, "auto"):
        fmt = _EXT_FORMAT.get(path.suffix.lower(), "")
        if not fmt:
            raise SpecError(f"cannot infer fold-file format from {path.suffix!r}; set folds.format")
    if fmt == "csv":
        return _parse_csv(path)
    if fmt == "json":
        return _parse_json(json.loads(path.read_text(encoding="utf-8")))
    if fmt in ("yaml", "yml"):
        return _parse_json(yaml.safe_load(path.read_text(encoding="utf-8")))
    if fmt == "txt":
        return _parse_txt(path)
    raise SpecError(f"unsupported fold-file format: {fmt!r}")


def _parse_csv(path: Path) -> list[Fold]:
    with path.open(newline="", encoding="utf-8") as fh:
        reader = csv.reader(fh)
        headers = next(reader)
        rows = list(reader)
    if all(h.startswith("fold_") for h in headers):
        return _csv_nirs4all(headers, rows)
    if "fold" in [h.lower() for h in headers]:
        return _csv_assignment(headers, rows)
    return _csv_nirs4all(headers, rows)


def _csv_nirs4all(headers: list[str], rows: list[list[str]]) -> list[Fold]:
    n_folds = len(headers)
    fold_train: list[list[int]] = [[] for _ in range(n_folds)]
    for row in rows:
        for i, value in enumerate(row):
            if i < n_folds and value.strip():
                try:
                    fold_train[i].append(int(value.strip()))
                except ValueError:
                    pass
    all_ids = sorted({sid for train in fold_train for sid in train})
    return [(sorted(train), sorted([s for s in all_ids if s not in set(train)])) for train in fold_train]


def _csv_assignment(headers: list[str], rows: list[list[str]]) -> list[Fold]:
    lower = [h.lower() for h in headers]
    fold_col = lower.index("fold")
    sample_col = next((lower.index(c) for c in ("sample_id", "id", "index", "sample") if c in lower), None)
    fold_to_samples: dict[int, list[int]] = {}
    for row_idx, row in enumerate(rows):
        fold_value = int(row[fold_col].strip())
        sample_id = row_idx if sample_col is None else int(row[sample_col].strip())
        fold_to_samples.setdefault(fold_value, []).append(sample_id)
    all_samples = sorted({s for v in fold_to_samples.values() for s in v})
    return [(sorted([s for s in all_samples if s not in set(fold_to_samples[f])]), sorted(fold_to_samples[f])) for f in sorted(fold_to_samples)]


def _parse_json(data: object) -> list[Fold]:
    if not isinstance(data, list):
        raise SpecError("fold JSON/YAML must be a list of {train, val} objects")
    folds: list[Fold] = []
    for obj in data:
        if not isinstance(obj, dict):
            raise SpecError("each fold entry must be a mapping with 'train' and 'val'/'test'")
        train = obj.get("train") or []
        val = obj.get("val") or obj.get("test") or []
        folds.append((list(train), list(val)))
    return folds


def _parse_txt(path: Path) -> list[Fold]:
    lines = [ln.strip() for ln in path.read_text(encoding="utf-8").splitlines() if ln.strip()]
    if len(lines) % 2 != 0:
        raise SpecError("TXT fold file must have an even number of non-empty lines (train/val pairs)")
    folds: list[Fold] = []
    for i in range(0, len(lines), 2):
        train = [int(x) for x in lines[i].split(",") if x.strip()]
        val = [int(x) for x in lines[i + 1].split(",") if x.strip()]
        folds.append((train, val))
    return folds
