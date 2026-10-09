"""Closed Studio adapters preserve exact owner provenance without refitting."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import numpy as np
import pytest

from api.library_documents import adapt_document


@pytest.fixture
def owner():
    return pytest.importorskip("nirs4all.api.studio_lineage")


def request(workspace):
    return {"workspace_path": str(workspace), "job_id": "run_native_lineage_test", "pipeline": [], "datasets": [],
            "run_name": "QA exact lineage", "started_at": "2026-10-09T10:00:00Z", "completed_at": "2026-10-09T10:00:01Z"}


def test_recovery_delegates_only_exact_authorized_identity_fields(owner, monkeypatch, tmp_path):
    payload = request(tmp_path)
    payload["pipeline"] = [{"model": {"class": "sklearn.cross_decomposition.PLSRegression", "params": {"n_components": 2}}}]
    payload["datasets"] = [{"dataset_id": "dataset-exact", "config": {"train_x": "/authorized/X.csv"}}]
    expected = {"run_ids": ["owner-run"], "dataset_run_ids": {"owner-run": "dataset-exact"}}
    calls = []

    def reconcile(**kwargs):
        calls.append(kwargs)
        return expected

    monkeypatch.setattr(owner, "reconcile_studio_job_lineage", reconcile)
    result = adapt_document("runs.recover_lineage", payload)
    assert calls == [payload]
    assert result == expected
    assert set(result) == {"run_ids", "dataset_run_ids"}
    assert not set(result) & {"workspace_path", "config", "pipeline", "datasets"}


def test_recovery_normalizes_equivalent_windows_workspace_path_without_mutating_request(owner, monkeypatch):
    calls = []
    monkeypatch.setattr(owner, "reconcile_studio_job_lineage", lambda **kwargs: calls.append(kwargs) or {"run_ids": [], "dataset_run_ids": {}})
    payload = request(r"\\?\D:\authorized\workspace")
    adapt_document("runs.recover_lineage", payload)
    assert calls[0]["workspace_path"] == r"D:\authorized\workspace"
    assert payload["workspace_path"] == r"\\?\D:\authorized\workspace"


@pytest.mark.parametrize("field,value", [("query", "SELECT * FROM runs"), ("config", {}), ("allow_fallback", True), ("workspace", "/other")])
def test_recovery_rejects_unreviewed_fields_before_owner_access(owner, monkeypatch, tmp_path, field, value):
    monkeypatch.setattr(owner, "reconcile_studio_job_lineage", lambda **kwargs: pytest.fail("Invalid transport must not access the workspace owner"))
    with pytest.raises(ValueError, match="Unexpected lineage recovery fields"):
        adapt_document("runs.recover_lineage", {**request(tmp_path), field: value})


def test_recovery_requires_complete_identity_envelope(owner, monkeypatch, tmp_path):
    monkeypatch.setattr(owner, "reconcile_studio_job_lineage", lambda **kwargs: pytest.fail("Incomplete identity must not reach the owner"))
    payload = request(tmp_path)
    del payload["job_id"]
    with pytest.raises(ValueError, match="Unexpected lineage recovery fields"):
        adapt_document("runs.recover_lineage", payload)


@pytest.mark.parametrize("extra", [{"workspace_path": "/other"}, {"query": "limit=1"}, {"path": "/outside/X.csv"}])
def test_fingerprint_rejects_extra_authority_and_query_fields(monkeypatch, extra):
    inspection = pytest.importorskip("nirs4all.api.dataset_inspection")
    monkeypatch.setattr(inspection, "load_dataset_for_analysis", lambda *args, **kwargs: pytest.fail("Invalid transport must not load files"))
    with pytest.raises(ValueError, match="only an authorized config"):
        adapt_document("dataset.fingerprint", {"config": {}, **extra})


@pytest.mark.integration_full
def test_real_fingerprint_is_exact_owner_hash_and_changes_with_same_shape_features(tmp_path):
    inspection = pytest.importorskip("nirs4all.api.dataset_inspection")
    x, y = tmp_path / "X.csv", tmp_path / "Y.csv"
    np.savetxt(x, np.arange(24, dtype=float).reshape(8, 3), delimiter=";")
    np.savetxt(y, np.arange(8, dtype=float), delimiter=";")
    config = {"train_x": str(x), "train_y": str(y), "global_params": {"delimiter": ";", "has_header": False}}
    dataset, _ = inspection.load_dataset_for_analysis(config)
    initial = adapt_document("dataset.fingerprint", {"config": config})
    assert initial == {"content_hash": dataset.content_hash()}
    assert len(initial["content_hash"]) == 64
    np.savetxt(x, np.arange(24, dtype=float).reshape(8, 3) + 1, delimiter=";")
    assert adapt_document("dataset.fingerprint", {"config": config}) != initial


def train_fixture(tmp_path, *, count=1):
    nirs4all = pytest.importorskip("nirs4all")
    from nirs4all.pipeline.config.component_serialization import serialize_component
    from sklearn.cross_decomposition import PLSRegression
    from sklearn.model_selection import KFold

    rng = np.random.default_rng(31)
    x = rng.normal(size=(24, 6))
    features, targets = tmp_path / "X.csv", tmp_path / "Y.csv"
    np.savetxt(features, x, delimiter=";")
    np.savetxt(targets, x[:, 0] + x[:, 1], delimiter=";")
    data = {"train_x": str(features), "train_y": str(targets), "global_params": {"delimiter": ";", "has_header": False}}
    pipeline = [KFold(3), {"model": PLSRegression(2)}]
    started = datetime.now(UTC).replace(microsecond=0)
    ids = []
    for _ in range(count):
        result = nirs4all.run(pipeline, data, engine="dag-ml", name="QA exact lineage", verbose=0, save_charts=False, workspace_path=tmp_path)
        try:
            ids.append(next(iter(result.per_dataset.values()))["run_id"])
        finally:
            result.close()
    return {"workspace_path": str(tmp_path), "job_id": "run_native_lineage_test", "pipeline": serialize_component(pipeline),
            "datasets": [{"dataset_id": "dataset-exact", "config": data}], "run_name": "QA exact lineage",
            "started_at": started.isoformat(), "completed_at": (datetime.now(UTC) + timedelta(seconds=1)).isoformat()}, ids


@pytest.mark.integration_full
def test_real_recovery_attaches_exact_provenance_and_never_fits(owner, monkeypatch, tmp_path):
    from nirs4all.api.studio_scientific import StudioScientificJobError
    from nirs4all.pipeline.dagml.dataset import _materialize_dataset
    from nirs4all.pipeline.storage.workspace_store import WorkspaceStore
    from sklearn.cross_decomposition import PLSRegression

    payload, ids = train_fixture(tmp_path)
    digest = _materialize_dataset(payload["datasets"][0]["config"]).content_hash()
    assert adapt_document("dataset.fingerprint", {"config": payload["datasets"][0]["config"]}) == {"content_hash": digest}
    monkeypatch.setattr(PLSRegression, "fit", lambda *args, **kwargs: pytest.fail("Metadata reconciliation must never train a model"))
    result = adapt_document("runs.recover_lineage", payload)
    assert result == {"run_ids": ids, "dataset_run_ids": {ids[0]: "dataset-exact"}}
    with WorkspaceStore(tmp_path, read_only=True) as store:
        record = store.get_run(ids[0])
    assert record["config"]["studio_provenance"] == {"job_id": payload["job_id"], "dataset_ids_by_hash": {digest: "dataset-exact"}}
    assert record["datasets"][0]["linked_dataset_id"] == "dataset-exact"
    assert not set(result) & {"workspace_path", "config", "pipeline", "datasets"}
    for mismatch in ({"run_name": "Other"}, {"pipeline": [{"model": {"class": "sklearn.cross_decomposition.PLSRegression", "params": {"n_components": 3}}}]}):
        assert adapt_document("runs.recover_lineage", {**payload, **mismatch}) == {"run_ids": [], "dataset_run_ids": {}}
    with pytest.raises(StudioScientificJobError, match="already belongs to different Studio provenance"):
        adapt_document("runs.recover_lineage", {**payload, "job_id": "run_native_other_job"})
    with WorkspaceStore(tmp_path, read_only=True) as store:
        assert store.get_run(ids[0])["config"]["studio_provenance"]["job_id"] == payload["job_id"]


@pytest.mark.integration_full
def test_real_recovery_refuses_ambiguous_matching_completed_runs(owner, monkeypatch, tmp_path):
    from nirs4all.pipeline.storage.workspace_store import WorkspaceStore
    from sklearn.cross_decomposition import PLSRegression

    payload, ids = train_fixture(tmp_path, count=2)
    monkeypatch.setattr(PLSRegression, "fit", lambda *args, **kwargs: pytest.fail("Ambiguity must not trigger training"))
    assert adapt_document("runs.recover_lineage", payload) == {"run_ids": [], "dataset_run_ids": {}}
    with WorkspaceStore(tmp_path, read_only=True) as store:
        for identifier in ids:
            assert "studio_provenance" not in store.get_run(identifier)["config"]
