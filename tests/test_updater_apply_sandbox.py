"""End-to-end-ish sandbox test of the updater apply step (directory mode).

This runs the REAL generated shell script against a throwaway app tree and
asserts the full chain works: backup -> replace files in place -> relaunch the
updated executable. It is the keystone that would catch an apply/relaunch
regression (the class of "update downloads but the app doesn't work afterward"
that ships undetected today).

Linux/macOS only (bash script). The Windows .bat path is validated separately.
"""

import json
import os
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


def test_directory_mode_apply_removes_files_missing_from_staging(tmp_path, monkeypatch):
    """Stale files (present in the old install, absent from the new version) must
    be deleted by the atomic replace — an overlay copy would leave them behind
    and produce a mixed-version install (audit finding #4)."""
    app_dir = tmp_path / "app"
    (app_dir / "old_only").mkdir(parents=True)
    staging = tmp_path / "staging"
    (staging / "resources").mkdir(parents=True)

    exe_name = "nirs4all-studio-stub"
    marker = tmp_path / "relaunched.marker"

    # New (staged) executable writes a marker when launched, proving relaunch.
    new_exe = staging / exe_name
    new_exe.write_text(f"#!/bin/sh\necho NEW > '{marker}'\n")
    new_exe.chmod(0o755)
    (staging / "version.json").write_text(json.dumps({"version": "9.9.9"}))

    # Old install: the executable plus files the new version no longer ships.
    old_exe = app_dir / exe_name
    old_exe.write_text("#!/bin/sh\necho OLD\n")
    old_exe.chmod(0o755)
    stale_file = app_dir / "stale_top_level.txt"
    stale_file.write_text("removed in the new version")
    stale_nested = app_dir / "old_only" / "leftover.dll"
    stale_nested.write_text("nested leftover")

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

    # Stale entries (and the directory that only existed in the old version) are gone.
    assert not stale_file.exists(), "a top-level file removed in the new version lingered"
    assert not stale_nested.exists(), "a nested file removed in the new version lingered"
    assert not (app_dir / "old_only").exists(), "a directory removed in the new version lingered"

    # The staged tree is present in its entirety.
    assert (app_dir / exe_name).read_text().startswith("#!/bin/sh\necho NEW")
    assert json.loads((app_dir / "version.json").read_text())["version"] == "9.9.9"
    assert (app_dir / "resources").is_dir()

    # A backup of the previous install was taken (also the cleanup "applied" signal).
    assert (tmp_path / "backup" / exe_name).exists()
    assert (tmp_path / "backup" / "stale_top_level.txt").exists()

    # The updated executable was relaunched.
    deadline = time.time() + 10
    while time.time() < deadline and not marker.exists():
        time.sleep(0.1)
    assert marker.exists(), "the updated app was not relaunched"


@pytest.mark.skipif(os.geteuid() == 0, reason="root ignores the chmod that makes the tree unmovable")
def test_directory_mode_apply_does_not_overlay_on_failure(tmp_path, monkeypatch):
    """A failed atomic replace must NOT leave a half-applied / overlaid install.

    When the app tree cannot be safely backed up or emptied, the script must
    leave the old version in place (or roll back to it) rather than copying the
    staged tree on top — copying onto a partially-processed tree is exactly the
    stale-file/mixed-version bug the atomic replace exists to prevent."""
    app_dir = tmp_path / "app"
    app_dir.mkdir()
    staging = tmp_path / "staging"
    staging.mkdir()

    exe_name = "nirs4all-studio-stub"
    new_marker = tmp_path / "new_relaunched.marker"

    new_exe = staging / exe_name
    new_exe.write_text(f"#!/bin/sh\necho NEW > '{new_marker}'\n")
    new_exe.chmod(0o755)
    (staging / "version.json").write_text(json.dumps({"version": "9.9.9"}))

    old_exe = app_dir / exe_name
    old_exe.write_text("#!/bin/sh\necho OLD\n")
    old_exe.chmod(0o755)

    # A 0-perm directory holding a file makes the tree impossible to back up or
    # empty as a non-root user (`cp -a` / `rm -rf` both fail on it), forcing the
    # script down its failure path.
    locked = app_dir / "locked"
    locked.mkdir()
    (locked / "pinned.txt").write_text("cannot be removed")
    locked.chmod(0o000)
    try:
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

        # The staged tree was NOT applied (no overlay onto a partial tree).
        assert not (app_dir / "version.json").exists(), "staged tree was copied onto a partially-processed install"
        # The old version is still the one on disk (left in place or rolled back).
        assert (app_dir / exe_name).read_text() == "#!/bin/sh\necho OLD\n"
        # The new (unapplied) executable never ran — the old version is relaunched.
        assert not new_marker.exists(), "the new (unapplied) executable was launched"
    finally:
        # Restore traversal perms on every dir under tmp_path, top-down (copies
        # of the 0-perm dir may have landed in the backup/restored trees) so
        # pytest can clean up the temp dir. Top-down so each level is made
        # listable before walking into it.
        for root, dirs, _ in os.walk(tmp_path):
            for name in dirs:
                os.chmod(os.path.join(root, name), 0o755)


@pytest.mark.skipif(os.geteuid() == 0, reason="root ignores the chmod that makes the backup copy fail")
def test_bundle_mode_does_not_delete_app_when_backup_fails(tmp_path, monkeypatch):
    """macOS bundle mode must NOT delete the live .app when the backup copy fails.

    `cp -a` can exit nonzero (disk full / unreadable file) while still leaving a
    PARTIAL backup dir behind, so the guard checks the copy's exit status, not
    just that the dir exists. With the old dir-existence-only guard the live app
    would be deleted and then 'rolled back' from an incomplete backup (Codex
    review of audit #4 on the bundle path)."""
    app_dir = tmp_path / "nirs4all Studio.app"
    (app_dir / "Contents").mkdir(parents=True)
    live_marker = app_dir / "Contents" / "live.txt"
    live_marker.write_text("the installed app")

    # A 0-perm subdir makes `cp -a "$APP_DIR" "$BACKUP_DIR/"` exit nonzero (it
    # cannot read the dir as non-root) yet still create a partial backup dir —
    # the exact case the exit-status guard must catch.
    locked = app_dir / "Contents" / "locked"
    locked.mkdir()
    (locked / "pinned").write_text("x")
    locked.chmod(0o000)

    staging = tmp_path / "staged" / "nirs4all Studio.app"
    (staging / "Contents").mkdir(parents=True)
    (staging / "Contents" / "staged_only.txt").write_text("new version")

    try:
        (tmp_path / "logs").mkdir()
        monkeypatch.setattr(updater.sys, "platform", "darwin")
        monkeypatch.setattr(updater, "get_backup_dir", lambda: tmp_path / "backup")
        monkeypatch.setattr(updater, "_get_update_log_dir", lambda: tmp_path / "logs")
        monkeypatch.delenv("NIRS4ALL_ELECTRON", raising=False)
        monkeypatch.delenv("NIRS4ALL_PORTABLE_EXE", raising=False)
        monkeypatch.delenv("NIRS4ALL_PORTABLE_ROOT", raising=False)

        script_path, content = updater.create_updater_script(staging, app_dir=app_dir, app_pid=NONEXISTENT_PID)
        assert 'UPDATE_MODE="bundle"' in content

        # check=False: the macOS-only `open -n` relaunch tail is a no-op/failure
        # on Linux; we only assert the on-disk state after the abort.
        subprocess.run(["bash", str(script_path)], check=False, timeout=60)

        # The live app was NOT deleted (backup failed -> abort, app untouched).
        assert live_marker.exists(), "the live .app was deleted despite a failed backup"
        assert live_marker.read_text() == "the installed app"
        # The staged tree was NOT applied on top of the (untouched) install.
        assert not (app_dir / "Contents" / "staged_only.txt").exists(), "staged tree applied despite a failed backup"
    finally:
        for root, dirs, _ in os.walk(tmp_path):
            for name in dirs:
                os.chmod(os.path.join(root, name), 0o755)
