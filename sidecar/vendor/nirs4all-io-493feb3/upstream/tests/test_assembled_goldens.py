# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Assembled (load) goldens — Python side.

Drives each contract corpus directory through infer → accept → load(assembled),
serializes a canonical structural summary (shapes, headers, partitions, rounded
X/y values, folds), and freezes it. The Rust facade
(`crates/nirs4all-io/tests/assembled_goldens.rs`) reproduces the same summary
byte-for-byte, validating the materialize/load path. Using the (already
byte-identical) resolved_spec isolates the assemble logic.

Re-bless with `NIRS4ALL_IO_ACCEPT_GOLDENS=1 pytest tests/test_assembled_goldens.py`.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

import nirs4all_io as nio
from nirs4all_io.canonical_json import canonical_json
from nirs4all_io.materialize.assemble import ASSEMBLED_DATASET_VERSION

_DIR = Path(__file__).parent / "goldens" / "contract"
_ACCEPT = os.environ.get("NIRS4ALL_IO_ACCEPT_GOLDENS") == "1"
_CASES = ["single_combined", "train_test", "x_y_separate"]


def _round_mat(arr) -> list[list[float]]:
    return [[round(float(v), 4) for v in row] for row in arr]


def _block_summary(b) -> dict:
    return {
        "n_samples": b.n_samples,
        "source_ids": b.source_ids,
        "x_shapes": [list(x.shape) for x in b.X],
        "x": [_round_mat(x) for x in b.X],
        "feature_headers": b.feature_headers,
        "header_units": b.header_units,
        "signal_types": b.signal_types,
        "y_shape": list(b.y.shape) if b.y is not None else None,
        "y": _round_mat(b.y) if b.y is not None else None,
        "y_headers": b.y_headers,
        "y_categorical": b.y_categorical,
        "metadata_columns": list(b.metadata.columns) if b.metadata is not None else [],
        "weights_header": b.weights_header,
        "processings": [[name for name, _ in src] for src in b.processings],
    }


def _summary(a) -> dict:
    return {
        "assembled_schema_version": ASSEMBLED_DATASET_VERSION,
        "name": a.name,
        "task_type": a.task_type,
        "signal_type": a.signal_type,
        "n_sources": a.n_sources,
        "blocks": {p: _block_summary(b) for p, b in a.blocks.items()},
        "folds": [[list(tr), list(vl)] for tr, vl in a.folds],
        "fold_provenance": a.fold_provenance,
        "identity": {"provenance": a.identity},
        "repetition": a.repetition,
        "aggregate": (
            {
                "by": a.aggregate.by,
                "method": a.aggregate.method.value,
                "exclude_outliers": a.aggregate.exclude_outliers,
                "outlier_threshold": a.aggregate.outlier_threshold,
            }
            if a.aggregate
            else None
        ),
    }


def _read_v2_golden(path: Path) -> str:
    """Accept only the explicitly versioned assembled-summary artifact wire."""
    value = json.loads(path.read_text(encoding="utf-8"))
    assert value.get("assembled_schema_version") == ASSEMBLED_DATASET_VERSION, (
        "assembled golden uses the retired unversioned v1 wire; re-bless it as v2"
    )
    return canonical_json(value)


@pytest.mark.parametrize("case", _CASES)
def test_assembled_golden(case: str) -> None:
    spec = nio.infer(str(_DIR / "corpus" / case)).accept()
    assembled = nio.load(spec, target="assembled")
    produced = canonical_json(_summary(assembled))
    golden = _DIR / f"{case}.assembled.canonical"
    if _ACCEPT:
        golden.write_text(produced, encoding="utf-8")
        return
    assert produced == _read_v2_golden(golden), f"assembled drift for {case}"
