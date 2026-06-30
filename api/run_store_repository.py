"""Write-side repository for persisted run lifecycle state."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

WorkspaceStoreFactory = Callable[[Path], Any]


def _default_workspace_store_factory(workspace_path: Path) -> Any:
    from nirs4all.pipeline.storage import WorkspaceStore

    return WorkspaceStore(workspace_path)


class RunStoreRepository:
    """Delegate run lifecycle writes to the workspace store."""

    def __init__(
        self,
        workspace_path: str | Path,
        *,
        store_factory: WorkspaceStoreFactory = _default_workspace_store_factory,
    ) -> None:
        self._workspace_path = Path(workspace_path)
        self._store_factory = store_factory

    def begin_run(self, *, name: str, config: dict[str, Any], datasets: list[dict[str, Any]]) -> str:
        store = self._open_store()
        try:
            return store.begin_run(name=name, config=config, datasets=datasets)
        finally:
            self._close_store(store)

    def set_project(self, run_id: str, project_id: str) -> None:
        store = self._open_store()
        try:
            store.set_run_project(run_id, project_id)
        finally:
            self._close_store(store)

    def complete_run(self, run_id: str, summary: dict[str, Any]) -> None:
        store = self._open_store()
        try:
            store.complete_run(run_id, summary)
        finally:
            self._close_store(store)

    def fail_run(self, run_id: str, message: str) -> None:
        store = self._open_store()
        try:
            store.fail_run(run_id, message)
        finally:
            self._close_store(store)

    def delete_run(self, run_id: str, *, delete_artifacts: bool = True) -> int:
        store = self._open_store()
        try:
            return int(store.delete_run(run_id, delete_artifacts=delete_artifacts) or 0)
        finally:
            self._close_store(store)

    def _open_store(self) -> Any:
        return self._store_factory(self._workspace_path)

    @staticmethod
    def _close_store(store: Any) -> None:
        close = getattr(store, "close", None)
        if callable(close):
            close()
