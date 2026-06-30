"""Operator manifests endpoint — the RT ``inspect`` surface for Studio.

A thin proxy over nirs4all's **public** ``runtime.list_controller_manifests()``
accessor (W7). Studio never imports the private dag-ml bridge. When the accessor
is absent (library too old / not installed), the endpoint reports
``available: false`` with an empty manifest list rather than failing, so the
palette degrades gracefully. Blocker ``B-017`` (V1); see
``SW8_RT_STUDIO_IMPL_spec.md`` §3.

Honest scope (V1): the runtime registers only the static **kind-level** manifest
set (``transform`` / ``y_transform`` / ``model`` / ``prediction_join`` /
``meta_model``). The per-operator capability ledger waits on the CTRL-000
adapter and is deferred.
"""

from __future__ import annotations

import importlib
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from .shared.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/operators", tags=["operators"])


class RuntimeInfo(BaseModel):
    """Versions of the runtime libraries backing the manifests."""

    nirs4all_version: str | None = None
    dag_ml_version: str | None = None


class OperatorManifestsResponse(BaseModel):
    """Response for ``GET /api/operators/manifests``."""

    available: bool = Field(..., description="Whether the runtime manifest accessor is available")
    runtime: RuntimeInfo
    manifests: list[dict[str, Any]] = Field(default_factory=list)


def _module_version(name: str) -> str | None:
    """Return ``module.__version__`` for an importable module, else ``None``."""
    try:
        module = importlib.import_module(name)
    except Exception:
        return None
    version = getattr(module, "__version__", None)
    return str(version) if version is not None else None


def list_controller_manifests() -> list[dict[str, Any]] | None:
    """Return the runtime controller manifests, or ``None`` if unavailable.

    Imports **only** the public ``nirs4all.runtime`` accessor (never the private
    ``nirs4all.pipeline.dagml_bridge``). Returns ``None`` when the accessor is
    missing (soft-dependency on W7) or raises.

    Returns:
        The manifest list verbatim from the accessor, or ``None``.
    """
    try:
        from nirs4all.runtime import list_controller_manifests as _accessor
    except Exception:
        return None
    try:
        manifests = _accessor()
    except Exception as exc:  # pragma: no cover - defensive: library-side failure
        logger.warning("nirs4all.runtime.list_controller_manifests() failed: %s", exc)
        return None
    return list(manifests) if manifests is not None else None


@router.get("/manifests", response_model=OperatorManifestsResponse)
async def get_operator_manifests() -> OperatorManifestsResponse:
    """Return the runtime's controller manifests (static kind-level set, V1).

    Orthogonal to ``execution_backend``. When the public runtime accessor is
    unavailable, returns ``available: false`` with an empty manifest list.
    """
    manifests = list_controller_manifests()
    return OperatorManifestsResponse(
        available=manifests is not None,
        runtime=RuntimeInfo(
            nirs4all_version=_module_version("nirs4all"),
            dag_ml_version=_module_version("dag_ml"),
        ),
        manifests=manifests or [],
    )
