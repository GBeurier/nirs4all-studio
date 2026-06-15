"""Tests for post-update reconciliation (silent-failure detection).

A webapp update is applied by a detached script after the app exits, so a
failure never reaches Sentry live. We record an attempt before quitting and
reconcile it on the next launch by comparing the running version to the staged
one. These tests lock that success/failure logic.
"""

import updater


def test_reconcile_returns_none_without_attempt(tmp_path, monkeypatch):
    monkeypatch.setattr(updater, "_get_update_state_dir", lambda: tmp_path)
    assert updater.reconcile_apply("0.8.2") is None


def test_reconcile_success_when_version_advanced(tmp_path, monkeypatch):
    monkeypatch.setattr(updater, "_get_update_state_dir", lambda: tmp_path)

    updater.record_apply_attempt(from_version="0.8.2", to_version="0.8.3", update_mode="directory")
    result = updater.reconcile_apply("0.8.3")

    assert result is not None
    assert result["status"] == "success"
    assert "log_tail" not in result
    # Marker is consumed so we don't re-report on the next launch.
    assert not (tmp_path / updater.APPLY_ATTEMPT_FILE).exists()
    # Result is persisted and readable, then dismissable.
    stored = updater.read_apply_result()
    assert stored is not None and stored["status"] == "success"
    updater.clear_apply_result()
    assert updater.read_apply_result() is None


def test_reconcile_failure_when_still_on_old_version(tmp_path, monkeypatch):
    monkeypatch.setattr(updater, "_get_update_state_dir", lambda: tmp_path)
    monkeypatch.setattr(updater, "_get_update_log_dir", lambda: tmp_path)
    (tmp_path / "update.log").write_text("starting update\nboom: copy failed\n", encoding="utf-8")

    updater.record_apply_attempt(from_version="0.8.2", to_version="0.8.3", update_mode="directory")
    result = updater.reconcile_apply("0.8.2")  # never advanced

    assert result is not None
    assert result["status"] == "failed"
    assert "boom: copy failed" in result["log_tail"]
    assert result["from_version"] == "0.8.2"
    assert result["to_version"] == "0.8.3"
    assert not (tmp_path / updater.APPLY_ATTEMPT_FILE).exists()


def test_clear_apply_attempt_removes_marker(tmp_path, monkeypatch):
    monkeypatch.setattr(updater, "_get_update_state_dir", lambda: tmp_path)

    updater.record_apply_attempt("0.8.2", "0.8.3", "directory")
    assert (tmp_path / updater.APPLY_ATTEMPT_FILE).exists()

    updater.clear_apply_attempt()
    assert not (tmp_path / updater.APPLY_ATTEMPT_FILE).exists()
    # No marker -> no signal, so a launch failure that cleared it won't false-alarm.
    assert updater.reconcile_apply("0.8.2") is None


def test_version_advanced_logic():
    assert updater._version_advanced("0.8.2", "0.8.3", "0.8.3") is True
    assert updater._version_advanced("0.8.2", "0.9.0", "0.8.3") is True  # current >= to
    assert updater._version_advanced("0.8.2", "0.8.2", "0.8.3") is False  # stayed on old
    assert updater._version_advanced("0.8.2", "unknown", "0.8.3") is False
