import importlib
import os

workspace_manager_module = importlib.import_module("api.workspace_manager")


class _FailingNirs4allWorkspace:
    def set_active_workspace(self, path: str) -> None:
        raise RuntimeError("ML dependencies have not started loading yet")


class _WorkingNirs4allWorkspace:
    def __init__(self) -> None:
        self.path = None

    def set_active_workspace(self, path: str) -> None:
        self.path = path


def test_set_active_workspace_falls_back_to_env_when_nirs4all_is_not_ready(monkeypatch):
    monkeypatch.delenv("NIRS4ALL_WORKSPACE", raising=False)
    monkeypatch.setattr(
        workspace_manager_module,
        "nirs4all_workspace",
        _FailingNirs4allWorkspace(),
    )

    result = workspace_manager_module._set_active_workspace_best_effort("/tmp/studio-workspace")

    assert result is False
    assert os.environ["NIRS4ALL_WORKSPACE"] == "/tmp/studio-workspace"


def test_set_active_workspace_uses_nirs4all_when_ready(monkeypatch):
    backend = _WorkingNirs4allWorkspace()
    monkeypatch.delenv("NIRS4ALL_WORKSPACE", raising=False)
    monkeypatch.setattr(workspace_manager_module, "nirs4all_workspace", backend)

    result = workspace_manager_module._set_active_workspace_best_effort("/tmp/studio-workspace")

    assert result is True
    assert backend.path == "/tmp/studio-workspace"
    assert os.environ["NIRS4ALL_WORKSPACE"] == "/tmp/studio-workspace"
