"""Regression tests for the ZIP permission smoke-test entrypoint."""

from __future__ import annotations

import os
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest


def test_smoke_update_zip_permissions_script_bootstraps_repo_root(tmp_path):
    repo_root = Path(__file__).resolve().parents[1]
    script_path = repo_root / "scripts" / "smoke-update-zip-permissions.py"
    archive_path = tmp_path / "missing-update.zip"

    result = subprocess.run(
        [sys.executable, str(script_path), "--archive", str(archive_path), "--platform", "linux"],
        cwd=repo_root,
        capture_output=True,
        text=True,
        check=False,
    )

    output = f"{result.stdout}{result.stderr}"

    assert result.returncode != 0
    assert "ModuleNotFoundError: No module named 'api'" not in output

    if os.name == "nt":
        assert "This smoke test only applies to POSIX ZIP permission handling" in output
    else:
        assert f"Archive not found: {archive_path.resolve()}" in output


@pytest.mark.skipif(os.name == "nt", reason="POSIX ZIP permission smoke only runs on Unix hosts")
def test_smoke_update_zip_permissions_script_resolves_linux_app_root_without_app_env(tmp_path, monkeypatch):
    repo_root = Path(__file__).resolve().parents[1]
    script_path = repo_root / "scripts" / "smoke-update-zip-permissions.py"
    archive_path = tmp_path / "linux-update.zip"

    executable_info = zipfile.ZipInfo("nirs4all Studio/nirs4all Studio")
    executable_info.create_system = 3
    executable_info.external_attr = (0o755 << 16)

    runtime_ready_info = zipfile.ZipInfo("nirs4all Studio/resources/backend/python-runtime/RUNTIME_READY.json")
    runtime_ready_info.create_system = 3
    runtime_ready_info.external_attr = (0o644 << 16)

    python_info = zipfile.ZipInfo("nirs4all Studio/resources/backend/python-runtime/python/bin/python3")
    python_info.create_system = 3
    python_info.external_attr = (0o755 << 16)

    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr(executable_info, "#!/bin/sh\nexit 0\n")
        archive.writestr(runtime_ready_info, "{}\n")
        archive.writestr(python_info, "#!/bin/sh\nexit 0\n")
        archive.writestr("LICENSE.electron.txt", "license\n")

    env = os.environ.copy()
    env.pop("NIRS4ALL_APP_EXE", None)

    result = subprocess.run(
        [sys.executable, str(script_path), "--archive", str(archive_path), "--platform", "linux"],
        cwd=repo_root,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )

    output = f"{result.stdout}{result.stderr}"

    assert result.returncode == 0, output
    assert f"Update ZIP smoke passed for {archive_path.name}" in output
