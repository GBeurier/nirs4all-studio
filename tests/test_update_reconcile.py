"""Tests for post-update reconciliation (silent-failure detection).

A webapp update is applied by a detached script after the app exits, so a
failure never reaches Sentry live. We record an attempt before quitting and
reconcile it on the next launch by comparing the running version to the staged
one. These tests lock that success/failure logic.
"""

import asyncio

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


def test_failed_apply_is_reported_once_without_duplicate_error_log(monkeypatch):
    import main
    from api import updates as updates_module

    result = {
        "status": "failed",
        "from_version": "0.9.1",
        "to_version": "0.10.0",
        "update_mode": "directory",
        "log_tail": "backup failed",
    }

    class _UpdateManager:
        @staticmethod
        def get_webapp_version():
            return "0.9.1"

    reported = []
    warnings = []
    errors = []
    monkeypatch.setattr(updates_module, "update_manager", _UpdateManager())
    monkeypatch.setattr(updater, "reconcile_apply", lambda _version: result)
    monkeypatch.setattr(updater, "cleanup_old_updates", lambda: None)
    monkeypatch.setattr(main, "_report_update_failure", reported.append)
    monkeypatch.setattr(main.logger, "warning", lambda *args, **_kwargs: warnings.append(args))
    monkeypatch.setattr(main.logger, "error", lambda *args, **_kwargs: errors.append(args))

    asyncio.run(main.cleanup_old_updates_background())

    assert reported == [result]
    assert len(warnings) == 1
    assert "Update apply did NOT complete" in warnings[0][0]
    assert errors == []
