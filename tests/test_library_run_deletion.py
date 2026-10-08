"""Run-history deletion uses the library cascade, including failed empty runs."""

import pytest
from nirs4all.pipeline.storage import WorkspaceStore

from api.library_documents import adapt_document


@pytest.mark.parametrize("partial_results", [False, True])
def test_failed_run_deletion_removes_history_and_partial_results(tmp_path, partial_results):
    with WorkspaceStore(tmp_path) as store:
        run_id = store.begin_run(name="Failed run", config={}, datasets=[])
        other_id = store.begin_run(name="Keep this run", config={}, datasets=[])
        store.complete_run(other_id, {})
        if partial_results:
            pipeline_id = store.begin_pipeline(run_id, "Partial pipeline", [], [], "wheat", "hash")
            store.log_step(pipeline_id, 0, "PLSRegression", "error", message="Training failed")
        store.fail_run(run_id, "Training failed")

    result = adapt_document("runs.delete", {"workspace_path": str(tmp_path), "run_id": run_id})

    assert result == {"success": True, "deleted_rows": 3 if partial_results else 1, "run_id": run_id}
    with WorkspaceStore(tmp_path, read_only=True) as store:
        assert store.get_run(run_id) is None
        assert store.get_run(other_id) is not None
        assert store.list_pipelines(run_id=run_id).is_empty()


def test_active_run_is_preserved(tmp_path):
    with WorkspaceStore(tmp_path) as store:
        run_id = store.begin_run(name="Active run", config={}, datasets=[])

    assert adapt_document("runs.delete", {"workspace_path": str(tmp_path), "run_id": run_id}) == {
        "success": False, "reason": "run_active",
    }
    with WorkspaceStore(tmp_path, read_only=True) as store:
        assert store.get_run(run_id) is not None


def test_missing_run_does_not_create_a_store(tmp_path):
    assert adapt_document("runs.delete", {"workspace_path": str(tmp_path), "run_id": "missing"}) == {
        "success": False, "reason": "run_not_found",
    }
    assert not (tmp_path / "store.sqlite").exists()


def test_missing_run_in_existing_store(tmp_path):
    with WorkspaceStore(tmp_path):
        pass
    assert adapt_document("runs.delete", {"workspace_path": str(tmp_path), "run_id": "missing"}) == {
        "success": False, "reason": "run_not_found",
    }
