"""Integration: Studio DISPLAYS a nirs4all NATIVE results dir via the read-only fallback adapter.

These tests produce a REAL native results directory with a genuine dag-ml run
(``nirs4all.run([...], dataset, results_path=tmp)`` — NOT mocked: a real manifest.json +
score_set.json + predictions.parquet + artifacts/), then point both:

* the :class:`~api.native_results_adapter.NativeResultsAdapter` directly, and
* the ``/api/aggregated-predictions`` endpoints (through the ``_get_store`` graceful fallback)

at that dir and assert the chain summaries carry the right scores, the prediction arrays
(``y_true`` / ``y_pred``) load, and the best-metric ranking renders. A final test pins the
NON-BREAKING contract: a workspace WITH a ``store.sqlite`` still uses ``WorkspaceStore``, never the
native adapter.

The native results feature lives in nirs4all-core (``nirs4all.pipeline.dagml.native_results``) and a
native run needs the dag-ml backend. When either is absent (an older installed nirs4all, or no dag-ml
backend) the real-native-run tests skip; the legacy-untouched test still runs (it only checks routing).
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

# Ensure the webapp root is importable (mirrors tests/test_aggregated_predictions_api.py).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

pytestmark = [pytest.mark.integration_full, pytest.mark.slow]


def _native_results_available() -> bool:
    """The installed nirs4all exposes the native results reader (nirs4all-core feature)."""
    try:
        import nirs4all.pipeline.dagml.native_results  # noqa: F401
    except Exception:
        return False
    return True


_SKIP_NO_NATIVE = pytest.mark.skipif(
    not _native_results_available(),
    reason="installed nirs4all has no nirs4all.pipeline.dagml.native_results (native results reader)",
)


def _build_regression_dataset():
    """A small in-memory regression SpectroDataset (no workspace, no files)."""
    from nirs4all.data.dataset import SpectroDataset

    rng = np.random.default_rng(0)
    n_feat = 24

    def _make(n: int):
        x = rng.normal(size=(n, n_feat))
        y = x[:, :3].sum(axis=1) + rng.normal(scale=0.1, size=n)
        return x, y

    x_train, y_train = _make(60)
    x_test, y_test = _make(20)
    dataset = SpectroDataset("native_fmt_reg")
    headers = [str(i) for i in range(n_feat)]
    dataset.add_samples(x_train, {"partition": "train"}, headers=headers, header_unit="nm")
    dataset.add_samples(x_test, {"partition": "test"}, headers=headers, header_unit="nm")
    dataset.add_targets(np.concatenate([y_train, y_test]).reshape(-1, 1))
    return dataset


@pytest.fixture()
def native_results_root(tmp_path: Path) -> Path:
    """Produce a REAL native results dir via a genuine dag-ml run; return its root.

    Skips when the dag-ml backend is unavailable (the run would fall back to legacy, which ignores
    ``results_path`` and writes no native dir).
    """
    import nirs4all
    from sklearn.cross_decomposition import PLSRegression
    from sklearn.model_selection import KFold

    results_root = tmp_path / "nirs4all_results"
    dataset = _build_regression_dataset()
    pipeline = [KFold(n_splits=3, shuffle=True, random_state=42), {"model": PLSRegression(n_components=5)}]

    # engine defaults to dag-ml; results_path threads natively (no workspace_path → no legacy fallback).
    result = nirs4all.run(pipeline, dataset, results_path=str(results_root))
    assert result.num_predictions > 0

    if not results_root.is_dir() or not any(results_root.iterdir()):
        pytest.skip("dag-ml backend unavailable: the run fell back to legacy and wrote no native results")

    run_dirs = sorted(results_root.iterdir())
    assert len(run_dirs) == 1
    assert {p.name for p in run_dirs[0].iterdir()} >= {"manifest.json", "score_set.json", "predictions.parquet"}
    return results_root


# ---------------------------------------------------------------------------
# (1) The adapter reads a real native dir directly.
# ---------------------------------------------------------------------------


@_SKIP_NO_NATIVE
class TestNativeResultsAdapter:
    """Direct adapter tests over a genuine native results dir."""

    def test_chain_summaries_carry_scores(self, native_results_root: Path) -> None:
        """The merged chain summary carries the CV OOF score, the refit final score, and real fold count."""
        from api.native_results_adapter import NativeResultsAdapter

        adapter = NativeResultsAdapter(native_results_root)
        try:
            df = adapter.query_chain_summaries()
            assert df.height >= 1
            row = df.row(0, named=True)
            # The CV/refit rows fold into ONE chain carrying both scores.
            assert row["cv_val_score"] is not None and row["cv_val_score"] > 0
            assert row["final_test_score"] is not None and row["final_test_score"] > 0
            assert row["cv_fold_count"] == 3  # avg/w_avg aggregate rows excluded from the real-fold count
            assert row["model_class"] == "PLSRegression"
            assert row["metric"] == "rmse"
            assert row["task_type"] == "regression"
            assert row["run_id"] and row["chain_id"].startswith(row["run_id"] + "::")
        finally:
            adapter.close()

    def test_prediction_arrays_load(self, native_results_root: Path) -> None:
        """A direct-block prediction row's y_true / y_pred arrays round-trip through the adapter."""
        from api.native_results_adapter import NativeResultsAdapter

        adapter = NativeResultsAdapter(native_results_root)
        try:
            chain_id = adapter.query_chain_summaries().row(0, named=True)["chain_id"]
            preds = adapter.get_chain_predictions(chain_id)
            assert preds.height > 0

            # Find a prediction row that actually carries arrays (a val fold or the refit test row).
            filled_id = None
            for prow in preds.iter_rows(named=True):
                arrays = adapter.get_prediction_arrays(prow["prediction_id"])
                if arrays and arrays.get("y_pred") is not None and np.asarray(arrays["y_pred"]).size:
                    filled_id = prow["prediction_id"]
                    y_true = np.asarray(arrays["y_true"]).ravel()
                    y_pred = np.asarray(arrays["y_pred"]).ravel()
                    break
            assert filled_id is not None, "at least one prediction row must carry y arrays"
            assert y_true.size > 0 and y_pred.size == y_true.size

            assert adapter.get_prediction_arrays("does-not-exist") is None
        finally:
            adapter.close()

    def test_top_chains_rank_by_metric(self, native_results_root: Path) -> None:
        """query_top_chains returns the ranked best chain (best metrics render)."""
        from api.native_results_adapter import NativeResultsAdapter

        adapter = NativeResultsAdapter(native_results_root)
        try:
            top = adapter.query_top_chains(metric="rmse", n=10)
            assert top.height >= 1
            best = top.row(0, named=True)
            assert best["cv_val_score"] is not None
            assert best["metric"] == "rmse"
        finally:
            adapter.close()


# ---------------------------------------------------------------------------
# (2) The endpoints serve a real native dir via the _get_store fallback.
# ---------------------------------------------------------------------------


@pytest.fixture()
def native_workspace(tmp_path: Path, native_results_root: Path) -> MagicMock:
    """A workspace dir holding the native results (and NO store.sqlite/store.duckdb)."""
    workspace_dir = tmp_path / "workspace"
    workspace_dir.mkdir()
    # Move the native results under the workspace at the documented location.
    target = workspace_dir / "nirs4all_results"
    native_results_root.rename(target)
    assert not (workspace_dir / "store.sqlite").exists()
    assert not (workspace_dir / "store.duckdb").exists()

    ws = MagicMock()
    ws.path = str(workspace_dir)
    return ws


@pytest.fixture()
def native_client(native_workspace: MagicMock):
    """FastAPI TestClient whose workspace resolves to the native-results-only workspace."""
    from fastapi.testclient import TestClient

    import api.aggregated_predictions  # noqa: F401
    from main import app

    with (
        patch.object(api.aggregated_predictions, "workspace_manager") as mock_wm,
        patch.object(api.aggregated_predictions, "STORE_AVAILABLE", True),
    ):
        mock_wm.get_current_workspace.return_value = native_workspace
        with TestClient(app) as client:
            yield client


@_SKIP_NO_NATIVE
class TestNativeResultsEndpointFallback:
    """The /api/aggregated-predictions endpoints serve native results through the fallback adapter."""

    def test_get_aggregated_predictions(self, native_client) -> None:
        """GET /aggregated-predictions returns native chain summaries with scores."""
        resp = native_client.get("/api/aggregated-predictions")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["total"] >= 1
        summary = body["predictions"][0]
        assert summary["model_class"] == "PLSRegression"
        assert summary["cv_val_score"] is not None
        # final_test_score is present directly (refit chain) — no synthetic fallback needed.
        assert summary["final_test_score"] is not None

    def test_get_top(self, native_client) -> None:
        """GET /aggregated-predictions/top ranks native chains by metric."""
        resp = native_client.get("/api/aggregated-predictions/top", params={"metric": "rmse", "n": 5})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["metric"] == "rmse"
        assert body["total"] >= 1
        assert body["predictions"][0]["cv_val_score"] is not None

    def test_prediction_arrays_endpoint(self, native_client) -> None:
        """GET /aggregated-predictions/{prediction_id}/arrays loads native y_true/y_pred arrays."""
        # Discover a chain, then a filled prediction id, through the chain-detail endpoint.
        summary = native_client.get("/api/aggregated-predictions").json()["predictions"][0]
        detail = native_client.get(f"/api/aggregated-predictions/chain/{summary['chain_id']}")
        assert detail.status_code == 200, detail.text
        prediction_rows = detail.json()["predictions"]
        assert prediction_rows, "chain detail must expose prediction rows"

        found = False
        for prow in prediction_rows:
            arrays = native_client.get(f"/api/aggregated-predictions/{prow['prediction_id']}/arrays")
            assert arrays.status_code == 200, arrays.text
            data = arrays.json()
            if data.get("y_pred"):
                assert len(data["y_true"]) == len(data["y_pred"])
                assert data["n_samples"] == len(data["y_pred"])
                found = True
                break
        assert found, "at least one prediction row exposes y arrays via the endpoint"


# ---------------------------------------------------------------------------
# (3) NON-BREAKING: a workspace WITH a store still uses WorkspaceStore, not the adapter.
# ---------------------------------------------------------------------------


def test_legacy_store_path_unchanged(tmp_path: Path) -> None:
    """A workspace WITH store.sqlite resolves to WorkspaceStore — the native adapter is NOT used."""
    import api.aggregated_predictions as agg

    workspace_dir = tmp_path / "legacy_ws"
    workspace_dir.mkdir()
    (workspace_dir / "store.sqlite").touch()
    # A native dir ALSO present — the store must still win (legacy is preferred, non-breaking).
    native_dir = workspace_dir / "nirs4all_results" / "20260101T000000000000Z-deadbeef"
    native_dir.mkdir(parents=True)
    (native_dir / "manifest.json").write_text("{}")

    ws = MagicMock()
    ws.path = str(workspace_dir)

    sentinel_store = MagicMock(name="WorkspaceStore-instance")
    store_cls = MagicMock(return_value=sentinel_store)

    with (
        patch.object(agg, "workspace_manager") as mock_wm,
        patch.object(agg, "STORE_AVAILABLE", True),
        patch.object(agg, "_get_workspace_store_cls", return_value=store_cls),
        patch.object(agg, "NativeResultsAdapter", create=True) as mock_adapter_cls,
    ):
        mock_wm.get_current_workspace.return_value = ws
        resolved = agg._get_store()

    assert resolved is sentinel_store, "store.sqlite must resolve to WorkspaceStore"
    store_cls.assert_called_once_with(workspace_dir)
    mock_adapter_cls.assert_not_called()


def test_native_fallback_selected_when_no_store(tmp_path: Path) -> None:
    """No store.sqlite/duckdb but a native dir present → _get_store returns the NativeResultsAdapter."""
    import api.aggregated_predictions as agg

    workspace_dir = tmp_path / "native_ws"
    workspace_dir.mkdir()
    native_dir = workspace_dir / "nirs4all_results" / "20260101T000000000000Z-deadbeef"
    native_dir.mkdir(parents=True)
    (native_dir / "manifest.json").write_text("{}")

    ws = MagicMock()
    ws.path = str(workspace_dir)

    sentinel_adapter = MagicMock(name="NativeResultsAdapter-instance")

    with (
        patch.object(agg, "workspace_manager") as mock_wm,
        patch.object(agg, "STORE_AVAILABLE", True),
        patch("api.native_results_adapter.NativeResultsAdapter", return_value=sentinel_adapter) as mock_adapter_cls,
    ):
        mock_wm.get_current_workspace.return_value = ws
        resolved = agg._get_store()

    assert resolved is sentinel_adapter
    mock_adapter_cls.assert_called_once()
    # The adapter is constructed against the workspace's native results root.
    called_arg = Path(mock_adapter_cls.call_args.args[0])
    assert called_arg == workspace_dir / "nirs4all_results"


def test_no_store_no_native_raises_404(tmp_path: Path) -> None:
    """Neither a store nor native results → 404 (unchanged behavior)."""
    from fastapi import HTTPException

    import api.aggregated_predictions as agg

    workspace_dir = tmp_path / "empty_ws"
    workspace_dir.mkdir()

    ws = MagicMock()
    ws.path = str(workspace_dir)

    with (
        patch.object(agg, "workspace_manager") as mock_wm,
        patch.object(agg, "STORE_AVAILABLE", True),
    ):
        mock_wm.get_current_workspace.return_value = ws
        with pytest.raises(HTTPException) as exc_info:
            agg._get_store()

    assert exc_info.value.status_code == 404


# ---------------------------------------------------------------------------
# (4) Codex MUST-FIX regressions: metric direction, score-column aliases,
#     sparse-row polars schema, and the _fetch_pl SQL refusal.
# ---------------------------------------------------------------------------


@_SKIP_NO_NATIVE
def test_metric_direction_delegates_to_library() -> None:
    """_infer_metric_ascending matches the library registry for descending (r2) AND ascending (rmse/bias).

    The old local token heuristic returned the WRONG direction for ``bias`` (no error token) and for
    unknown metrics; this pins parity with nirs4all.core.metrics.infer_ascending.
    """
    from nirs4all.core.metrics import infer_ascending

    from api.native_results_adapter import _infer_metric_ascending

    assert _infer_metric_ascending("r2") is infer_ascending("r2") is False  # higher-is-better → desc
    assert _infer_metric_ascending("rmse") is infer_ascending("rmse") is True  # lower-is-better → asc
    assert _infer_metric_ascending("bias") is infer_ascending("bias")  # token heuristic got this wrong
    assert _infer_metric_ascending("unknown_metric_xyz") is infer_ascending("unknown_metric_xyz")
    assert _infer_metric_ascending(None) is True  # absent metric defaults ascending (legacy parity)


@_SKIP_NO_NATIVE
def test_top_chains_accepts_legacy_score_column_alias(native_results_root: Path) -> None:
    """query_top_chains ranks with a legacy ALIAS (avg_val_score → cv_val_score) instead of 0 rows."""
    from api.native_results_adapter import NativeResultsAdapter

    adapter = NativeResultsAdapter(native_results_root)
    try:
        aliased = adapter.query_top_chains(metric="rmse", n=10, score_column="avg_val_score")
        canonical = adapter.query_top_chains(metric="rmse", n=10, score_column="cv_val_score")
        assert aliased.height == canonical.height >= 1
        assert aliased.row(0, named=True)["chain_id"] == canonical.row(0, named=True)["chain_id"]

        with pytest.raises(ValueError, match="Invalid score column"):
            adapter.query_top_chains(metric="rmse", score_column="not_a_column")
    finally:
        adapter.close()


def test_summaries_df_handles_sparse_rows_and_empty_is_typed() -> None:
    """The summaries DataFrame infers across ALL rows (sparse first row) and the empty frame is typed.

    Reproduces the Codex case: a first row with a null score column followed by a row with a float — the
    default first-rows inference flips/throws; the explicit schema does not. Also pins the empty frame to
    the EXACT 28-column typed v_chain_summary shape (not all-Utf8).
    """
    import polars as pl

    from api.native_results_adapter import _CHAIN_SUMMARY_SCHEMA, NativeResultsAdapter

    adapter = NativeResultsAdapter.__new__(NativeResultsAdapter)

    empty = adapter._summaries_df([])
    assert list(empty.columns) == list(_CHAIN_SUMMARY_SCHEMA)
    assert empty.schema["cv_val_score"] == pl.Float64
    assert empty.schema["model_step_idx"] == pl.Int64
    assert empty.schema["chain_id"] == pl.Utf8

    sparse = adapter._summaries_df([
        {"chain_id": "a", "cv_val_score": None},
        {"chain_id": "b", "cv_val_score": 0.42},
    ])
    assert sparse.height == 2
    assert sparse.schema["cv_val_score"] == pl.Float64
    assert sparse.row(1, named=True)["cv_val_score"] == pytest.approx(0.42)


def test_fetch_pl_refuses_raw_sql() -> None:
    """The native store refuses raw SQL with a clear error (no faked empty result)."""
    from api.native_results_adapter import NativeResultsAdapter

    adapter = NativeResultsAdapter.__new__(NativeResultsAdapter)
    with pytest.raises(NotImplementedError, match="not supported on a native results store"):
        adapter._fetch_pl("SELECT 1")


@_SKIP_NO_NATIVE
def test_query_endpoint_surfaces_unsupported_on_native(native_client) -> None:
    """POST /aggregated-predictions/query on a native-only workspace surfaces 400, not a fake success."""
    resp = native_client.post(
        "/api/aggregated-predictions/query",
        json={"sql": "SELECT chain_id FROM v_chain_summary"},
    )
    assert resp.status_code == 400, resp.text
    assert "native results store" in resp.json()["detail"]
