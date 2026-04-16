"""Regression tests for the ZIP permission smoke-test entrypoint."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


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
