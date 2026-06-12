import json
import subprocess
from pathlib import Path


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
