# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""The confidence-scored :class:`DatasetPlan` (Appendix F).

Scores are **scores, not calibrated probabilities** (Critique C5): there is no
labelled calibration corpus yet, so they are for ranking/triage. Every decision
carries an evidence trace; close calls are marked ``ambiguous``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ..spec import DatasetSpec


@dataclass
class Decision:
    value: Any
    score: float = 0.0
    evidence: list[str] = field(default_factory=list)
    alternatives: list[dict] = field(default_factory=list)
    ambiguous: bool = False

    def to_dict(self) -> dict:
        return {"value": self.value, "score": round(self.score, 3), "evidence": self.evidence, "alternatives": self.alternatives, "ambiguous": self.ambiguous}


@dataclass
class DatasetPlan:
    input: dict = field(default_factory=dict)
    structure: Decision | None = None
    assignments: list[dict] = field(default_factory=list)
    columns: list[dict] = field(default_factory=list)
    params: dict = field(default_factory=dict)
    axis: dict | None = None
    identity: Decision | None = None  # detected sample-id column
    alignment: list[dict] = field(default_factory=list)  # per-sample y/metadata coverage audit
    signal_type: Decision | None = None
    task_type: Decision | None = None
    warnings: list[str] = field(default_factory=list)
    recommendations: list[str] = field(default_factory=list)
    dropped_rows: list[dict] = field(default_factory=list)
    resolved_spec: DatasetSpec | None = None
    overall_score: float = 0.0
    calibration: dict = field(default_factory=lambda: {"method": "none", "note": "scores are uncalibrated (C5)"})

    def accept(self, **overrides: Any) -> DatasetSpec:
        """Return the resolved DatasetSpec (optionally overriding top-level fields)."""
        if self.resolved_spec is None:
            raise ValueError("plan has no resolved_spec")
        spec = self.resolved_spec
        for key, value in overrides.items():
            setattr(spec, key, value)
        return spec

    def to_dict(self) -> dict:
        return {
            "input": self.input,
            "structure": self.structure.to_dict() if self.structure else None,
            "assignments": self.assignments,
            "columns": self.columns,
            "params": self.params,
            "axis": self.axis,
            "identity": self.identity.to_dict() if self.identity else None,
            "alignment": self.alignment,
            "signal_type": self.signal_type.to_dict() if self.signal_type else None,
            "task_type": self.task_type.to_dict() if self.task_type else None,
            "warnings": self.warnings,
            "recommendations": self.recommendations,
            "dropped_rows": self.dropped_rows,
            "resolved_spec": self.resolved_spec.to_dict() if self.resolved_spec else None,
            "overall_score": round(self.overall_score, 3),
            "calibration": self.calibration,
        }
