"""End-to-end-ish sandbox test of the updater apply step (directory mode).

This runs the REAL generated shell script against a throwaway app tree and
asserts the full chain works: backup -> replace files in place -> relaunch the
updated executable. It is the keystone that would catch an apply/relaunch
regression (the class of "update downloads but the app doesn't work afterward"
that ships undetected today).

Linux/macOS only (bash script). The Windows .bat path is validated separately.
"""

import json
import subprocess
import sys
import time

import pytest

import updater

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="bash updater script (Windows .bat tested separately)")

# A PID that does not exist, so the script's 'wait for app to exit' loop returns
# immediately instead of blocking for 30 s.
NONEXISTENT_PID = 99_999_999


def test_directory_mode_apply_replaces_and_relaunches(tmp_path, monkeypatch):
    app_dir = tmp_path / "app"
    app_dir.mkdir()
    staging = tmp_path / "staging"
    (staging / "resources").mkdir(parents=True)

    exe_name = "nirs4all-studio-stub"
    marker = tmp_path / "relaunched.marker"

    # New (staged) executable writes a marker when launched, proving relaunch.
    new_exe = staging / exe_name
    new_exe.write_text(f"#!/bin/sh\necho NEW > '{marker}'\n")
    new_exe.chmod(0o755)
    (staging / "version.json").write_text(json.dumps({"version": "9.9.9"}))

    # Old executable currently installed.
    old_exe = app_dir / exe_name
    old_exe.write_text("#!/bin/sh\necho OLD\n")
    old_exe.chmod(0o755)

    # Keep backup + log under tmp; identify the executable; force directory mode.
    (tmp_path / "logs").mkdir()
    monkeypatch.setattr(updater, "get_backup_dir", lambda: tmp_path / "backup")
    monkeypatch.setattr(updater, "_get_update_log_dir", lambda: tmp_path / "logs")
    monkeypatch.setenv("NIRS4ALL_APP_EXE", exe_name)
    monkeypatch.delenv("NIRS4ALL_ELECTRON", raising=False)
    monkeypatch.delenv("NIRS4ALL_PORTABLE_EXE", raising=False)
    monkeypatch.delenv("NIRS4ALL_PORTABLE_ROOT", raising=False)

    script_path, content = updater.create_updater_script(staging, app_dir=app_dir, app_pid=NONEXISTENT_PID)
    assert 'UPDATE_MODE="directory"' in content

    subprocess.run(["bash", str(script_path)], check=True, timeout=60)

    # Files were replaced in place.
    assert (app_dir / exe_name).read_text().startswith("#!/bin/sh\necho NEW")
    assert (app_dir / "version.json").exists()
    assert json.loads((app_dir / "version.json").read_text())["version"] == "9.9.9"

    # A backup of the previous install was taken before replacing.
    assert (tmp_path / "backup" / exe_name).exists()

    # The updated executable was relaunched.
    deadline = time.time() + 10
    while time.time() < deadline and not marker.exists():
        time.sleep(0.1)
    assert marker.exists(), "the updated app was not relaunched"
