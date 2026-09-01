# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Inference: neutral describe + value detectors + scored DatasetPlan (Epic 3)."""

from .describe import FileDescription, describe
from .detectors import detect_signal_type, detect_task_type
from .engine import infer, infer_column_roles
from .plan import DatasetPlan, Decision

__all__ = [
    "infer",
    "infer_column_roles",
    "describe",
    "FileDescription",
    "detect_signal_type",
    "detect_task_type",
    "DatasetPlan",
    "Decision",
]
