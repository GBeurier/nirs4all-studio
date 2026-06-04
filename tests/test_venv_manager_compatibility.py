import importlib

venv_manager_module = importlib.import_module("api.venv_manager")

from api.venv_manager import (  # noqa: E402
    VenvManager,
    _resolve_package_version_for_python,
    _split_exact_package_spec,
)


def test_tabpfn_203_stays_pinned_on_python_311():
    version, note = _resolve_package_version_for_python("tabpfn", "2.0.3", (3, 11))

    assert version == "2.0.3"
    assert note is None


def test_tabpfn_203_uses_204_on_python_312():
    version, note = _resolve_package_version_for_python("tabpfn", "2.0.3", (3, 12))

    assert version == "2.0.4"
    assert note is not None
    assert "requires Python <3.12" in note


def test_tabpfn_203_uses_latest_compatible_on_python_313():
    version, note = _resolve_package_version_for_python("tabpfn", "2.0.3", (3, 13))

    assert version is None
    assert note is not None
    assert "latest compatible tabpfn" in note


def test_tabpfn_202_uses_same_python_312_override():
    version, note = _resolve_package_version_for_python("tabpfn", "2.0.2", (3, 12))

    assert version == "2.0.4"
    assert note is not None


def test_other_packages_are_not_rewritten():
    version, note = _resolve_package_version_for_python("torch", "2.0.3", (3, 12))

    assert version == "2.0.3"
    assert note is None


def test_split_exact_package_spec_accepts_pinned_package_argument():
    package, version = _split_exact_package_spec("tabpfn==2.0.3", None)

    assert package == "tabpfn"
    assert version == "2.0.3"


def test_install_package_applies_tabpfn_override_before_pip(monkeypatch):
    calls = []

    class _FakeStdout:
        def __init__(self):
            self._lines = iter(["Successfully installed tabpfn-2.0.4\n", ""])

        def readline(self):
            return next(self._lines)

    class _FakeProcess:
        def __init__(self, cmd, **kwargs):
            calls.append(cmd)
            self.returncode = 0

        def communicate(self, timeout=None):
            return "Successfully installed tabpfn-2.0.4\n", None

    manager = VenvManager()
    monkeypatch.setattr(manager, "_is_valid_venv", lambda: True)
    monkeypatch.setattr(manager, "_get_target_python_version", lambda: (3, 12))
    monkeypatch.setattr(manager, "_load_metadata", lambda: {})
    monkeypatch.setattr(manager, "_save_metadata", lambda metadata: None)
    monkeypatch.setattr(venv_manager_module.subprocess, "Popen", _FakeProcess)

    success, message, _ = manager.install_package("tabpfn", version="2.0.3")

    assert success is True
    assert calls[0][-1] == "tabpfn==2.0.4"
    assert "requires Python <3.12" in message


def test_install_package_returns_clean_message_on_timeout(monkeypatch):
    class _FakeProcess:
        returncode = None

        def communicate(self, timeout=None):
            raise venv_manager_module.subprocess.TimeoutExpired(
                cmd=["pip", "install", "nirs4all"],
                timeout=timeout,
            )

        def kill(self):
            self.returncode = -9

    calls = []

    def _fake_popen(cmd, **kwargs):
        calls.append((cmd, kwargs))
        return _FakeProcess()

    manager = VenvManager()
    monkeypatch.setattr(manager, "_is_valid_venv", lambda: True)
    monkeypatch.setattr(manager, "_get_target_python_version", lambda: (3, 12))
    monkeypatch.setattr(venv_manager_module.subprocess, "Popen", _fake_popen)

    success, message, output = manager.install_package("nirs4all")

    assert success is False
    assert output == []
    assert calls[0][0][-1] == "nirs4all"
    assert f"timed out after {venv_manager_module.PIP_INSTALL_TIMEOUT_SECONDS}s" in message


def test_get_outdated_packages_returns_empty_on_timeout(monkeypatch):
    manager = VenvManager()
    captured = {}

    def _fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        captured["timeout"] = kwargs.get("timeout")
        raise venv_manager_module.subprocess.TimeoutExpired(cmd=cmd, timeout=kwargs.get("timeout"))

    monkeypatch.setattr(manager, "_is_valid_venv", lambda: True)
    monkeypatch.setattr(venv_manager_module.subprocess, "run", _fake_run)

    assert manager.get_outdated_packages() == []
    assert captured["cmd"][-3:] == ["list", "--outdated", "--format=json"]
    assert captured["timeout"] == venv_manager_module.OUTDATED_PACKAGES_TIMEOUT_SECONDS
