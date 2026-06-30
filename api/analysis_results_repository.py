"""Durable storage for completed analysis (SHAP/AutoML) result payloads.

The analysis routers (``api/shap.py``, ``api/automl.py``) historically kept
finished result payloads only in a process-local in-memory cache, so the data
vanished on backend restart even though the model artifacts they were derived
from are durable through :mod:`api.results_repository`.  This module provides a
minimal, dependency-light place to persist those completed payloads under the
active workspace/project, alongside the artifacts they explain.

Layout (per workspace root)::

    <workspace>/analysis_results/<analysis_type>/<job_id>.json   # JSON payload
    <workspace>/analysis_results/<analysis_type>/<job_id>.npz    # raw arrays

The JSON payload carries the serializable result surface; the optional ``.npz``
sidecar carries the large numpy arrays (e.g. raw SHAP values) that some
visualization endpoints need.  Both are written atomically.  This module owns
neither the SHAP/AutoML payload schema nor the workspace lifecycle -- callers
decide what to persist and pass an already-resolved workspace path.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from .shared.logger import get_logger

logger = get_logger(__name__)

ANALYSIS_RESULTS_DIRNAME = "analysis_results"


def _safe_segment(value: str, *, label: str) -> str:
    """Return a path segment for repository keys, rejecting traversal."""
    segment = str(value)
    if not segment or segment in {".", ".."} or "/" in segment or "\\" in segment:
        raise ValueError(f"Invalid {label}: {value!r}")
    return segment


def _json_default(value: Any) -> Any:
    """Best-effort coercion of numpy scalars/arrays for ``json.dump``."""
    tolist = getattr(value, "tolist", None)
    if callable(tolist):
        return tolist()
    item = getattr(value, "item", None)
    if callable(item):
        return item()
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


class AnalysisResultsRepository:
    """File-backed store for completed analysis result payloads."""

    def __init__(self, root: Path) -> None:
        self.root = Path(root) / ANALYSIS_RESULTS_DIRNAME

    def _type_dir(self, analysis_type: str) -> Path:
        return self.root / _safe_segment(analysis_type, label="analysis_type")

    def _json_path(self, analysis_type: str, job_id: str) -> Path:
        return self._type_dir(analysis_type) / f"{_safe_segment(job_id, label='job_id')}.json"

    def _arrays_path(self, analysis_type: str, job_id: str) -> Path:
        return self._type_dir(analysis_type) / f"{_safe_segment(job_id, label='job_id')}.npz"

    def save(
        self,
        analysis_type: str,
        job_id: str,
        payload: dict[str, Any],
        arrays: dict[str, Any] | None = None,
    ) -> None:
        """Persist a completed payload (and optional numpy arrays) atomically."""
        type_dir = self._type_dir(analysis_type)
        type_dir.mkdir(parents=True, exist_ok=True)

        json_path = self._json_path(analysis_type, job_id)
        tmp_path = json_path.with_suffix(".json.tmp")
        with open(tmp_path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, default=_json_default)
        os.replace(tmp_path, json_path)

        if arrays:
            import numpy as np

            arrays_path = self._arrays_path(analysis_type, job_id)
            tmp_arrays = arrays_path.with_suffix(".npz.tmp")
            with open(tmp_arrays, "wb") as fh:
                np.savez(fh, **{k: np.asarray(v) for k, v in arrays.items()})
            os.replace(tmp_arrays, arrays_path)

    def load(self, analysis_type: str, job_id: str) -> dict[str, Any] | None:
        """Return the persisted JSON payload, or ``None`` when absent."""
        json_path = self._json_path(analysis_type, job_id)
        if not json_path.exists():
            return None
        try:
            with open(json_path, encoding="utf-8") as fh:
                return json.load(fh)
        except (OSError, ValueError) as exc:
            logger.error("Failed to read analysis result %s/%s: %s", analysis_type, job_id, exc)
            return None

    def load_arrays(self, analysis_type: str, job_id: str) -> dict[str, Any] | None:
        """Return the persisted numpy arrays, or ``None`` when absent."""
        arrays_path = self._arrays_path(analysis_type, job_id)
        if not arrays_path.exists():
            return None
        try:
            import numpy as np

            with np.load(arrays_path) as data:
                return {key: data[key] for key in data.files}
        except (OSError, ValueError) as exc:
            logger.error("Failed to read analysis arrays %s/%s: %s", analysis_type, job_id, exc)
            return None

    def exists(self, analysis_type: str, job_id: str) -> bool:
        """Return whether a persisted JSON payload exists for the job."""
        return self._json_path(analysis_type, job_id).exists()


def resolve_analysis_results_repository(
    workspace_path: str | Path | None,
) -> AnalysisResultsRepository | None:
    """Build a repository rooted at ``workspace_path`` when one is available.

    Returns ``None`` when no workspace is active so callers transparently fall
    back to their in-memory cache.
    """
    if not workspace_path:
        return None
    return AnalysisResultsRepository(Path(workspace_path))
