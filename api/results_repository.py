"""Results repository contract and workspace resolver.

This module names the structured results surface Studio needs without tying
callers to a concrete storage backend.  Today that surface is implemented by
``WorkspaceStore`` and the read-only ``NativeResultsAdapter``; future backends
such as n4a-repo or cluster artifact stores should implement the same protocol.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any, Protocol

NATIVE_RESULTS_DIRNAME = "nirs4all_results"
STORE_DB_FILENAMES = ("store.sqlite", "store.duckdb")


class ResultsRepository(Protocol):
    """Structured results query surface consumed by Studio endpoints."""

    def close(self) -> None:
        """Release repository resources."""

    def query_chain_summaries(self, **filters: Any) -> Any:
        """Return chain summary rows."""

    def query_top_chains(self, **filters: Any) -> Any:
        """Return ranked chain summary rows."""

    def count_chain_summaries(self, **filters: Any) -> int:
        """Return the number of chain summary rows matching filters."""

    def get_chain_predictions(self, chain_id: str, partition: str | None = None, fold_id: str | None = None) -> Any:
        """Return prediction rows for one chain."""

    def get_prediction_arrays(self, prediction_id: str) -> dict[str, Any] | None:
        """Return persisted arrays for one prediction."""

    def get_prediction(self, prediction_id: str, load_arrays: bool = True) -> dict[str, Any] | None:
        """Return one prediction row."""

    def get_chain(self, chain_id: str) -> dict[str, Any] | None:
        """Return one chain descriptor."""

    def load_artifact(self, artifact_id: str) -> Any:
        """Return one persisted artifact payload."""

    def get_chains_for_pipeline(self, pipeline_id: str) -> Any:
        """Return chains attached to one pipeline."""

    def get_pipeline(self, pipeline_id: str) -> dict[str, Any] | None:
        """Return one pipeline descriptor."""

    def _fetch_pl(self, sql: str, params: list[Any] | None = None) -> Any:
        """Run a read-only structured-query fallback used by legacy endpoints."""


class ResultsRepositoryNotFound(RuntimeError):
    """Raised when a workspace has no supported results repository."""


def workspace_content_dir(workspace_path: Path) -> Path:
    """Return the directory that carries workspace content for discovery.

    Studio callers pass both the project root (containing ``workspace/``) and
    the workspace directory itself.  Keep that normalization in one place so
    discovery and repository resolution make the same store/native decision.
    """
    path = Path(workspace_path)
    nested = path / "workspace"
    if nested.is_dir():
        return nested
    if (path / "runs").exists() or (path / "exports").exists():
        return path
    return nested


def workspace_location_candidates(workspace_path: Path) -> tuple[Path, ...]:
    """Return candidate roots that may contain a store or native results."""
    path = Path(workspace_path)
    candidates = [workspace_content_dir(path), path]
    unique: list[Path] = []
    for candidate in candidates:
        if candidate not in unique:
            unique.append(candidate)
    return tuple(unique)


def workspace_store_path(workspace_path: Path) -> Path | None:
    """Return the first WorkspaceStore database path for a workspace."""
    for candidate in workspace_location_candidates(workspace_path):
        for filename in STORE_DB_FILENAMES:
            store_path = candidate / filename
            if store_path.exists():
                return store_path
    return None


def workspace_store_root(workspace_path: Path) -> Path | None:
    """Return the root directory for a legacy WorkspaceStore database."""
    store_path = workspace_store_path(workspace_path)
    return store_path.parent if store_path is not None else None


def native_results_root(workspace_path: Path) -> Path | None:
    """Return the native results root iff it contains at least one native run."""
    for candidate in workspace_location_candidates(workspace_path):
        root = candidate / NATIVE_RESULTS_DIRNAME
        if not root.is_dir():
            continue
        has_run = any(child.is_dir() and (child / "manifest.json").is_file() for child in root.iterdir())
        if has_run:
            return root
    return None


def workspace_store_exists(workspace_path: Path) -> bool:
    """Return whether the workspace contains a legacy WorkspaceStore database."""
    return workspace_store_root(workspace_path) is not None


def resolve_results_repository(
    workspace_path: Path,
    *,
    workspace_store_factory: Callable[[Path], ResultsRepository],
) -> ResultsRepository:
    """Resolve the current repository implementation for a workspace.

    Legacy WorkspaceStore wins when present to preserve existing behavior.  A
    native results directory is used only for workspaces without a store DB.
    """
    path = Path(workspace_path)
    store_root = workspace_store_root(path)
    if store_root is not None:
        return workspace_store_factory(store_root)

    native_root = native_results_root(path)
    if native_root is not None:
        from .native_results_adapter import NativeResultsAdapter

        return NativeResultsAdapter(native_root)

    raise ResultsRepositoryNotFound(f"No results repository found in workspace: {path}")
