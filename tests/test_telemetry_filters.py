from api import telemetry


def test_before_send_drops_expected_nan_pipeline_error(monkeypatch):
    monkeypatch.setattr(telemetry, "_debug_data_sharing_enabled", True)
    event = {
        "exception": {
            "values": [
                {
                    "type": "NAError",
                    "value": "Transform 'SavitzkyGolay' received NaN input. Set na_policy on this step.",
                }
            ]
        }
    }

    assert telemetry._before_send(event, {}) is None


def test_before_send_drops_expected_pls_hyperparameter_error(monkeypatch):
    monkeypatch.setattr(telemetry, "_debug_data_sharing_enabled", True)
    event = {
        "logentry": {
            "formatted": (
                "Invalid hyperparameters for PLSRegression with current dataset: "
                "`n_components` upper bound is 1. Got 15 instead."
            )
        }
    }

    assert telemetry._before_send(event, {}) is None


def test_before_send_drops_expected_update_check_network_error(monkeypatch):
    monkeypatch.setattr(telemetry, "_debug_data_sharing_enabled", True)
    event = {
        "logentry": {
            "formatted": "Error checking PyPI releases: ConnectTimeout('')"
        }
    }

    assert telemetry._before_send(event, {}) is None


def test_before_send_drops_expected_outdated_package_timeout(monkeypatch):
    monkeypatch.setattr(telemetry, "_debug_data_sharing_enabled", True)
    event = {
        "message": (
            "Error checking outdated packages: "
            "Command '['python', '-m', 'pip', 'list', '--outdated', '--format=json'] "
            "timed out after 60 seconds"
        )
    }

    assert telemetry._before_send(event, {}) is None


def test_before_send_drops_expected_user_cancelled_run(monkeypatch):
    monkeypatch.setattr(telemetry, "_debug_data_sharing_enabled", True)
    event = {
        "exception": {
            "values": [
                {
                    "type": "ValueError",
                    "value": "Cancelled by user",
                }
            ]
        }
    }

    assert telemetry._before_send(event, {}) is None


def test_before_send_drops_expected_pip_install_timeout(monkeypatch):
    monkeypatch.setattr(telemetry, "_debug_data_sharing_enabled", True)
    event = {
        "message": (
            "pip install timed out after 900s while installing nirs4all. "
            "Check the internet connection or retry later."
        )
    }

    assert telemetry._before_send(event, {}) is None


def test_before_send_drops_expected_sample_count_error(monkeypatch):
    monkeypatch.setattr(telemetry, "_debug_data_sharing_enabled", True)
    event = {
        "exception": {
            "values": [
                {
                    "type": "ValueError",
                    "value": "Found input variables with inconsistent numbers of samples: [377, 3770]",
                }
            ]
        }
    }

    assert telemetry._before_send(event, {}) is None


def test_before_send_keeps_unexpected_error_and_scrubs_request(monkeypatch):
    monkeypatch.setattr(telemetry, "_debug_data_sharing_enabled", True)
    monkeypatch.setattr(telemetry, "_accepted_event_count", 0)
    event = {
        "user": {"id": "u1"},
        "message": "Unexpected backend error",
        "request": {
            "url": "http://127.0.0.1:8000/api/runs?token=secret",
            "headers": {"Authorization": "Bearer secret", "User-Agent": "test"},
            "cookies": "session=secret",
            "data": {"body": "removed"},
            "query_string": "token=secret",
        },
    }

    filtered = telemetry._before_send(event, {})

    assert filtered is not None
    assert "user" not in filtered
    assert filtered["request"]["url"] == "http://127.0.0.1:8000/api/runs"
    assert filtered["request"]["headers"]["Authorization"] == "[Filtered]"
    assert filtered["request"]["headers"]["User-Agent"] == "test"
    assert "cookies" not in filtered["request"]
    assert "data" not in filtered["request"]
    assert "query_string" not in filtered["request"]


def test_before_send_enforces_session_event_budget(monkeypatch):
    monkeypatch.setattr(telemetry, "_debug_data_sharing_enabled", True)
    monkeypatch.setattr(telemetry, "_accepted_event_count", 0)
    monkeypatch.setenv("SENTRY_MAX_EVENTS_PER_SESSION", "1")

    assert telemetry._before_send({"message": "Unexpected backend error 1"}, {}) is not None
    assert telemetry._before_send({"message": "Unexpected backend error 2"}, {}) is None
