from __future__ import annotations

from pathlib import Path

from api.run_store_repository import RunStoreRepository


def test_run_store_repository_delegates_lifecycle_writes_and_closes(tmp_path):
    class DummyStore:
        def __init__(self) -> None:
            self.calls = []
            self.closed = False

        def begin_run(self, *, name, config, datasets):
            self.calls.append(("begin_run", name, config, datasets))
            return "store-run-1"

        def set_run_project(self, run_id, project_id):
            self.calls.append(("set_run_project", run_id, project_id))

        def complete_run(self, run_id, summary):
            self.calls.append(("complete_run", run_id, summary))

        def fail_run(self, run_id, message):
            self.calls.append(("fail_run", run_id, message))

        def delete_run(self, run_id, *, delete_artifacts=True):
            self.calls.append(("delete_run", run_id, delete_artifacts))
            return 3

        def close(self):
            self.closed = True

    stores = []

    def store_factory(workspace_path: Path):
        assert workspace_path == tmp_path
        store = DummyStore()
        stores.append(store)
        return store

    repository = RunStoreRepository(tmp_path, store_factory=store_factory)

    assert repository.begin_run(
        name="Run",
        config={"n_pipelines": 2},
        datasets=[{"name": "Dataset A"}],
    ) == "store-run-1"
    repository.set_project("store-run-1", "project-1")
    repository.complete_run("store-run-1", {"total_pipelines": 2})
    repository.fail_run("store-run-1", "failed")
    assert repository.delete_run("store-run-1", delete_artifacts=False) == 3

    assert [store.calls for store in stores] == [
        [("begin_run", "Run", {"n_pipelines": 2}, [{"name": "Dataset A"}])],
        [("set_run_project", "store-run-1", "project-1")],
        [("complete_run", "store-run-1", {"total_pipelines": 2})],
        [("fail_run", "store-run-1", "failed")],
        [("delete_run", "store-run-1", False)],
    ]
    assert all(store.closed for store in stores)
