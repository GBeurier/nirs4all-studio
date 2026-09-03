"""Tests for backend Sentry filtering of benign shutdown events."""

from api.shared.sentry import backend_before_send


def test_backend_before_send_drops_keyboard_interrupt():
    event = {"exception": {"values": [{"type": "KeyboardInterrupt"}]}}

    assert backend_before_send(event, {}) is None


def test_backend_before_send_drops_uvicorn_cancelled_shutdown_event():
    event = {
        "logger": "uvicorn.error",
        "exception": {"values": [{"type": "CancelledError"}]},
        "message": "KeyboardInterrupt ... CancelledError",
    }

    assert backend_before_send(event, {}) is None


def test_backend_before_send_keeps_unrelated_cancelled_error():
    event = {
        "logger": "api.jobs",
        "exception": {"values": [{"type": "CancelledError"}]},
        "message": "background job cancelled",
    }

    assert backend_before_send(event, {}) == event


def test_backend_before_send_drops_job_notification_pending_task_shutdown_event():
    event = {
        "logger": "asyncio",
        "message": (
            "Task was destroyed but it is pending! task: <Task pending "
            "coro=<JobManager._dispatch_websocket_notification.<locals>."
            "send_notification() running at api/jobs/manager.py:391>>"
        ),
    }

    assert backend_before_send(event, {}) is None


def test_backend_before_send_drops_job_notification_pending_task_logentry_message():
    event = {
        "logger": "asyncio",
        "logentry": {
            "message": (
                "Task was destroyed but it is pending! task: <Task pending "
                "coro=<JobManager._dispatch_websocket_notification.<locals>."
                "send_notification() running at api/jobs/manager.py:391>>"
            ),
        },
    }

    assert backend_before_send(event, {}) is None


def test_backend_before_send_drops_nirs4all_pipeline_execution_failure():
    event = {
        "logger": "nirs4all.pipeline.execution.orchestrator",
        "logentry": {
            "message": (
                "Dataset 'spad' failed: Pipeline step 1 failed: estimator "
                "requires y to be passed, but the target y is None"
            ),
        },
    }

    assert backend_before_send(event, {}) is None


def test_backend_before_send_drops_run_worker_pipeline_execution_error():
    event = {
        "logger": "api.runs",
        "logentry": {"message": "Pipeline execution error: %s"},
    }

    assert backend_before_send(event, {}) is None


def test_backend_before_send_drops_expected_ml_startup_503():
    event = {
        "transaction": "/api/playground/operators",
        "exception": {
            "values": [
                {
                    "type": "HTTPException",
                    "value": (
                        "ML dependencies are still loading. "
                        "Please wait a moment and retry."
                    ),
                }
            ]
        },
    }

    assert backend_before_send(event, {}) is None


def test_backend_before_send_keeps_other_ml_http_exceptions():
    event = {
        "transaction": "/api/playground/operators",
        "exception": {
            "values": [
                {
                    "type": "HTTPException",
                    "value": "ML component 'PipelineRunner' is not available.",
                }
            ]
        },
    }

    assert backend_before_send(event, {}) == event


def test_backend_before_send_keeps_genuine_run_worker_error():
    event = {
        "logger": "api.runs",
        "logentry": {"message": "Error saving run manifest: %s"},
    }

    assert backend_before_send(event, {}) == event


def test_backend_before_send_keeps_run_postprocessing_failure():
    # A failure after the pipeline trained is a studio defect, not an expected
    # run outcome, and uses a distinct message so it stays reportable.
    event = {
        "logger": "api.runs",
        "logentry": {"message": "Run result post-processing failed: %s"},
    }

    assert backend_before_send(event, {}) == event


def test_backend_before_send_redacts_sensitive_payload_data():
    event = {
        "user": {"id": "local-user"},
        "request": {
            "url": "http://127.0.0.1:8000/api/datasets?token=secret#fragment",
            "headers": {"authorization": "Bearer secret"},
            "cookies": {"session": "secret"},
            "data": {"raw": "secret"},
            "query_string": "token=secret",
            "env": {"HOME": "/Users/example"},
        },
        "extra": {
            "dataset_path": "/private/dataset.csv",
            "safe_count": 3,
        },
        "contexts": {
            "workspace": {"path": "/private/workspace"},
            "runtime": {"name": "python"},
        },
    }

    filtered = backend_before_send(event, {})

    assert filtered is not None
    assert "user" not in filtered
    assert filtered["request"] == {"url": "http://127.0.0.1:8000/api/datasets"}
    assert filtered["extra"] == {
        "dataset_path": "[Filtered]",
        "safe_count": 3,
    }
    assert filtered["contexts"] == {
        "workspace": "[Filtered]",
        "runtime": {"name": "python"},
    }
