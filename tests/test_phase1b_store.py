"""Phase 1b tests: long-lived store adapter reuse and event-loop offloading.

These tests verify the store/dashboard event-loop fixes:

* ``WorkspaceManager.get_active_store_adapter`` returns a single cached
  ``StoreAdapter`` instance (one long-lived ``WorkspaceStore`` connection)
  rather than constructing a new one per call, and rebuilds/invalidates the
  cache when the active workspace changes or is unlinked.
* The dashboard endpoints discover runs exactly once per request (the
  previous code called ``discover_runs()`` three times) and run that
  blocking work through ``asyncio.to_thread`` without changing response
  shapes.

Run with: pytest tests/test_phase1b_store.py -v
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Ensure webapp root is importable
sys.path.insert(0, str(Path(__file__).parent.parent))

import api.dashboard  # noqa: E402
from api.workspace_manager import WorkspaceManager  # noqa: E402


# ---------------------------------------------------------------------------
# Cached store-adapter accessor
# ---------------------------------------------------------------------------


class TestActiveStoreAdapterCache:
    """Tests for ``WorkspaceManager.get_active_store_adapter`` caching."""

    def _manager(self) -> WorkspaceManager:
        # Build a manager without running first-launch workspace bootstrap.
        mgr = WorkspaceManager.__new__(WorkspaceManager)
        mgr._store_adapter = None
        mgr._store_adapter_path = None
        import threading
        mgr._store_adapter_lock = threading.Lock()
        return mgr

    def test_reuses_single_adapter(self, tmp_path):
        ws = tmp_path / "ws"
        ws.mkdir()
        (ws / "store.sqlite").touch()

        mgr = self._manager()

        created = []

        def _factory(path):
            adapter = MagicMock(name=f"adapter-{len(created)}")
            created.append(adapter)
            return adapter

        with (
            patch.object(WorkspaceManager, "get_active_workspace_path", return_value=str(ws)),
            patch("api.store_adapter.StoreAdapter", side_effect=_factory),
        ):
            first = mgr.get_active_store_adapter()
            second = mgr.get_active_store_adapter()

        assert first is second
        assert len(created) == 1, "StoreAdapter must be constructed only once"

    def test_no_store_file_returns_none(self, tmp_path):
        ws = tmp_path / "ws"
        ws.mkdir()
        # No store.sqlite / store.duckdb file present.

        mgr = self._manager()
        with patch.object(WorkspaceManager, "get_active_workspace_path", return_value=str(ws)):
            assert mgr.get_active_store_adapter() is None

    def test_no_workspace_returns_none(self):
        mgr = self._manager()
        with patch.object(WorkspaceManager, "get_active_workspace_path", return_value=None):
            assert mgr.get_active_store_adapter() is None

    def test_rebuilds_on_workspace_change(self, tmp_path):
        ws_a = tmp_path / "a"
        ws_a.mkdir()
        (ws_a / "store.sqlite").touch()
        ws_b = tmp_path / "b"
        ws_b.mkdir()
        (ws_b / "store.sqlite").touch()

        mgr = self._manager()

        created = []

        def _factory(path):
            adapter = MagicMock(name=str(path))
            created.append(adapter)
            return adapter

        with patch("api.store_adapter.StoreAdapter", side_effect=_factory):
            with patch.object(WorkspaceManager, "get_active_workspace_path", return_value=str(ws_a)):
                first = mgr.get_active_store_adapter()
            with patch.object(WorkspaceManager, "get_active_workspace_path", return_value=str(ws_b)):
                second = mgr.get_active_store_adapter()

        assert first is not second
        # On workspace change we DROP the old reference but must NOT close it:
        # an in-flight to_thread worker may still hold the previous connection.
        # The orphaned connection is closed when its last reference is released.
        first.close.assert_not_called()
        assert mgr._store_adapter is second

    def test_invalidate_drops_adapter_without_closing(self, tmp_path):
        ws = tmp_path / "ws"
        ws.mkdir()
        (ws / "store.sqlite").touch()

        mgr = self._manager()
        adapter = MagicMock()
        with (
            patch.object(WorkspaceManager, "get_active_workspace_path", return_value=str(ws)),
            patch("api.store_adapter.StoreAdapter", return_value=adapter),
        ):
            assert mgr.get_active_store_adapter() is adapter
            mgr._invalidate_store_adapter()

        # Invalidation drops the cached reference (so the next access rebuilds)
        # but does NOT close the connection underneath a possibly in-flight worker.
        adapter.close.assert_not_called()
        assert mgr._store_adapter is None


# ---------------------------------------------------------------------------
# Dashboard: discover runs once per request
# ---------------------------------------------------------------------------


SAMPLE_RUNS = [
    {
        "id": "run-1",
        "name": "Run 1",
        "status": "completed",
        "created_at": "2026-01-01T00:00:00",
        "completed_at": "2026-01-01T01:00:00",
        "datasets": [{"name": "ds_a"}],
        "summary": {"best_result": {"r2": 0.91}},
    },
    {
        "id": "run-2",
        "name": "Run 2",
        "status": "completed",
        "created_at": "2026-01-02T00:00:00",
        "completed_at": "2026-01-02T01:00:00",
        "datasets": [{"name": "ds_b"}],
        "summary": {"best_result": {"r2": 0.81}},
    },
]


@pytest.fixture()
def dashboard_client():
    from fastapi.testclient import TestClient
    from main import app

    workspace = MagicMock()
    workspace.datasets = ["ds_a", "ds_b"]

    with (
        patch.object(api.dashboard, "workspace_manager") as mock_wm,
        patch.object(api.dashboard, "_count_pipelines", return_value=3),
        patch.object(api.dashboard, "_get_workspace_scanner") as mock_scanner_factory,
    ):
        mock_wm.get_current_workspace.return_value = workspace

        scanner = MagicMock()
        scanner.discover_runs.return_value = list(SAMPLE_RUNS)
        mock_scanner_factory.return_value = scanner

        from fastapi.testclient import TestClient as _TC  # noqa: F401
        with TestClient(app) as c:
            yield c, scanner


class TestDashboardDiscoverOnce:
    """The dashboard must discover runs exactly once per request."""

    def test_dashboard_discovers_runs_once(self, dashboard_client):
        client, scanner = dashboard_client
        resp = client.get("/api/dashboard")
        assert resp.status_code == 200
        data = resp.json()

        # Response shape preserved.
        assert data["stats"]["datasets"] == 2
        assert data["stats"]["pipelines"] == 3
        assert data["stats"]["runs"] == 2
        assert data["stats"]["avgMetric"] == pytest.approx(0.86)
        assert len(data["recent_runs"]) == 2

        # Discovery happened a single time (previously 3x).
        scanner.discover_runs.assert_called_once()

    def test_dashboard_stats_discovers_runs_once(self, dashboard_client):
        client, scanner = dashboard_client
        resp = client.get("/api/dashboard/stats")
        assert resp.status_code == 200
        data = resp.json()
        assert data["stats"]["runs"] == 2
        scanner.discover_runs.assert_called_once()

    def test_recent_runs_discovers_runs_once(self, dashboard_client):
        client, scanner = dashboard_client
        resp = client.get("/api/dashboard/recent-runs?limit=1")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["runs"]) == 1
        scanner.discover_runs.assert_called_once()
