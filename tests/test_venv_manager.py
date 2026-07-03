import json
import subprocess
from pathlib import Path


def _fake_version_run(cmd, **_kwargs):
    class Result:
        returncode = 0
        stderr = ""

        if "pip" in str(cmd[0]):
            stdout = "pip 25.0 from /tmp/pip (python 3.11)"
        else:
            stdout = "Python 3.11.15"

    return Result()


def test_get_venv_info_skips_size_for_system_runtime(monkeypatch):
    from api import venv_manager as vm

    manager = vm.VenvManager()

    monkeypatch.setattr(vm.sys, "prefix", "/usr")
    monkeypatch.setattr(vm.sys, "base_prefix", "/usr", raising=False)
    monkeypatch.setattr(vm.sys, "executable", "/usr/bin/python3.11")
    monkeypatch.delenv("NIRS4ALL_RUNTIME_MODE", raising=False)
    monkeypatch.setattr(vm.VenvManager, "_is_valid_venv", lambda _self: True)
    monkeypatch.setattr(vm.subprocess, "run", _fake_version_run)

    def fail_size(_self, _path):
        raise AssertionError("system runtime size should not be scanned")

    monkeypatch.setattr(vm.VenvManager, "_get_directory_size", fail_size)

    info = manager.get_venv_info()

    assert info.path == "/usr"
    assert info.size_bytes == 0


def test_get_venv_info_counts_size_for_virtualenv(monkeypatch, tmp_path):
    from api import venv_manager as vm

    venv = tmp_path / "venv"
    venv.mkdir()
    (venv / "pyvenv.cfg").write_text("", encoding="utf-8")
    manager = vm.VenvManager()

    monkeypatch.setattr(vm.sys, "prefix", str(venv))
    monkeypatch.setattr(vm.sys, "base_prefix", "/usr", raising=False)
    monkeypatch.setattr(vm.sys, "executable", str(venv / "bin" / "python"))
    monkeypatch.setattr(vm.VenvManager, "_is_valid_venv", lambda _self: True)
    monkeypatch.setattr(vm.subprocess, "run", _fake_version_run)
    monkeypatch.setattr(vm.VenvManager, "_get_directory_size", lambda _self, _path: 123)

    info = manager.get_venv_info()

    assert info.path == str(venv)
    assert info.size_bytes == 123


def test_get_outdated_packages_returns_stale_cache_after_timeout(monkeypatch):
    from api import venv_manager as vm

    vm.invalidate_installed_packages_cache()

    manager = vm.VenvManager()
    fake_python = Path("/tmp/nirs4all-test-python")
    calls: list[list[str]] = []
    timestamps = iter([
        100.0,
        100.0 + vm._OUTDATED_PACKAGES_CACHE_TTL_SECONDS + 1,
    ])

    class Result:
        returncode = 0
        stdout = json.dumps([
            {
                "name": "nirs4all",
                "version": "0.6.3",
                "latest_version": "0.7.0",
            }
        ])
        stderr = ""

    def fake_run(cmd, **_kwargs):
        calls.append(cmd)
        if len(calls) == 1:
            return Result()
        raise subprocess.TimeoutExpired(cmd=cmd, timeout=30)

    monkeypatch.setattr(vm.time, "monotonic", lambda: next(timestamps))
    monkeypatch.setattr(vm.VenvManager, "_is_valid_venv", lambda _self: True)
    monkeypatch.setattr(vm.VenvManager, "python_executable", property(lambda _self: fake_python))
    monkeypatch.setattr(vm.subprocess, "run", fake_run)

    first = manager.get_outdated_packages()
    second = manager.get_outdated_packages()

    assert first == second == [
        {
            "name": "nirs4all",
            "current_version": "0.6.3",
            "latest_version": "0.7.0",
        }
    ]
    assert calls[0][3] == "--disable-pip-version-check"
    assert len(calls) == 2


def test_get_outdated_packages_returns_stale_cache_after_pip_error(monkeypatch):
    from api import venv_manager as vm

    vm.invalidate_installed_packages_cache()

    manager = vm.VenvManager()
    fake_python = Path("/tmp/nirs4all-test-python")
    calls: list[list[str]] = []
    timestamps = iter([
        100.0,
        100.0 + vm._OUTDATED_PACKAGES_CACHE_TTL_SECONDS + 1,
    ])

    class OkResult:
        returncode = 0
        stdout = json.dumps([
            {
                "name": "nirs4all",
                "version": "0.6.3",
                "latest_version": "0.7.0",
            }
        ])
        stderr = ""

    class ErrorResult:
        returncode = 1
        stdout = ""
        stderr = "Invalid version: '2.22.1ubuntu1.2'"

    def fake_run(cmd, **_kwargs):
        calls.append(cmd)
        if len(calls) == 1:
            return OkResult()
        return ErrorResult()

    monkeypatch.setattr(vm.time, "monotonic", lambda: next(timestamps))
    monkeypatch.setattr(vm.VenvManager, "_is_valid_venv", lambda _self: True)
    monkeypatch.setattr(vm.VenvManager, "python_executable", property(lambda _self: fake_python))
    monkeypatch.setattr(vm.subprocess, "run", fake_run)

    first = manager.get_outdated_packages()
    second = manager.get_outdated_packages()

    assert first == second == [
        {
            "name": "nirs4all",
            "current_version": "0.6.3",
            "latest_version": "0.7.0",
        }
    ]
    assert len(calls) == 2


def test_get_outdated_packages_caches_empty_after_first_pip_error(monkeypatch):
    from api import venv_manager as vm

    vm.invalidate_installed_packages_cache()

    manager = vm.VenvManager()
    fake_python = Path("/tmp/nirs4all-test-python")
    calls: list[list[str]] = []

    class ErrorResult:
        returncode = 1
        stdout = ""
        stderr = "Invalid version: '2.22.1ubuntu1.2'"

    def fake_run(cmd, **_kwargs):
        calls.append(cmd)
        return ErrorResult()

    monkeypatch.setattr(vm.time, "monotonic", lambda: 100.0)
    monkeypatch.setattr(vm.VenvManager, "_is_valid_venv", lambda _self: True)
    monkeypatch.setattr(vm.VenvManager, "python_executable", property(lambda _self: fake_python))
    monkeypatch.setattr(vm.subprocess, "run", fake_run)

    first = manager.get_outdated_packages()
    second = manager.get_outdated_packages()

    assert first == second == []
    assert len(calls) == 1
