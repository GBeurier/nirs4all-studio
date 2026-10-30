"""Expected pip refusals stay visible without masking manager defects."""

import io
import logging
import subprocess
import sys

import pytest
import sentry_sdk
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.logging import LoggingIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration
from sentry_sdk.transport import Transport

from api import updates
from api import venv_manager as vm
from api.shared.sentry import backend_before_send
from api.updates.dependencies import router


def _install_client(monkeypatch, popen):
    manager = vm.VenvManager()
    monkeypatch.setattr(manager, "_is_valid_venv", lambda: True)
    monkeypatch.setattr(updates, "venv_manager", manager)
    monkeypatch.setattr(updates, "_ensure_runtime_mutable", lambda: None)
    monkeypatch.setattr(updates, "_ensure_runtime_is_valid", lambda: None)
    monkeypatch.setattr(vm.subprocess, "Popen", popen)
    app = FastAPI()
    app.include_router(router, prefix="/api/updates")
    return TestClient(app, base_url="http://localhost:8000", raise_server_exceptions=False)


@pytest.fixture
def sentry_events(monkeypatch):
    # Exercise production filtering and the real HTTP/logging integrations.
    # This in-memory transport never opens a connection. Override pytest argv
    # so the test-traffic safeguard cannot make these assertions pass falsely.
    monkeypatch.setattr(sys, "argv", ["main.py"])
    events = []

    class MemoryTransport(Transport):
        def capture_envelope(self, envelope):
            for item in envelope.items:
                if item.headers.get("type") == "event":
                    events.append(item.payload.json)

    client = sentry_sdk.Client(
        dsn="https://public@example.invalid/1",
        transport=MemoryTransport,
        default_integrations=False,
        auto_enabling_integrations=False,
        integrations=[FastApiIntegration(), StarletteIntegration(), LoggingIntegration(event_level=logging.ERROR)],
        before_send=backend_before_send,
    )
    with sentry_sdk.new_scope() as scope:
        scope.set_client(client)
        yield events
    client.close()


def test_missing_distribution_is_a_visible_failure_without_error_telemetry(monkeypatch, caplog, sentry_events):
    class RefusedPip:
        stdout = io.StringIO("ERROR: No matching distribution found for this-package-does-not-exist-12345\n")
        returncode = 1

        def wait(self, **kwargs):
            return self.returncode

    with _install_client(monkeypatch, lambda *args, **kwargs: RefusedPip()) as client:
        with caplog.at_level(logging.WARNING):
            response = client.post("/api/updates/dependencies/install", json={"package": "this-package-does-not-exist-12345"})

    assert not sentry_events, [(event.get("logger"), event.get("exception")) for event in sentry_events]
    assert response.status_code == 400
    assert "No matching distribution" in response.json()["detail"]
    assert any("No matching distribution" in record.getMessage() for record in caplog.records)
    assert not any(record.levelno >= logging.ERROR for record in caplog.records)


def test_unexpected_install_manager_failure_remains_reportable(monkeypatch, sentry_events):
    def broken_popen(*args, **kwargs):
        raise RuntimeError("unexpected manager defect")

    with _install_client(monkeypatch, broken_popen) as client:
        response = client.post("/api/updates/dependencies/install", json={"package": "numpy"})

    assert response.status_code == 500
    assert any(
        value.get("type") == "RuntimeError" and value.get("value") == "unexpected manager defect"
        for event in sentry_events
        for value in event.get("exception", {}).get("values", [])
    )
    event = {
        "logger": "api.venv_manager",
        "request": {"url": "http://localhost:8000/api/updates/dependencies/install"},
        "exception": {"values": [{"type": "RuntimeError", "value": "unexpected manager defect"}]},
    }
    assert backend_before_send(event, {}) == event


@pytest.mark.parametrize("failure", [RuntimeError("unexpected manager defect"), PermissionError("Permission denied"), subprocess.TimeoutExpired("pip", 600)])
@pytest.mark.parametrize("partial_output", ["", "ERROR: No matching distribution found for numpy\n"])
def test_operational_install_failure_keeps_traceback_and_500(monkeypatch, sentry_events, failure, partial_output):
    class BrokenPip:
        returncode = None
        stdout = io.StringIO(partial_output)

        def wait(self, **kwargs):
            if self.returncode is None:
                raise failure
            return self.returncode

        def kill(self):
            self.returncode = -9

    with _install_client(monkeypatch, lambda *args, **kwargs: BrokenPip()) as client:
        response = client.post("/api/updates/dependencies/install", json={"package": "numpy"})

    assert response.status_code == 500
    assert any(
        value.get("type") == type(failure).__name__
        for event in sentry_events
        for value in event.get("exception", {}).get("values", [])
    )


@pytest.mark.parametrize("diagnostic", [
    "WARNING: Retrying after SSLError: certificate verify failed",
    "Could not fetch URL https://example.invalid/simple/numpy/: SSLError: certificate verify failed - skipping",
    "Retrying after connection failure",
    "OSError: Permission denied",
])
def test_operational_diagnostic_ending_in_missing_distribution_remains_reportable(monkeypatch, sentry_events, diagnostic):
    class RefusedPip:
        stdout = io.StringIO(
            diagnostic + "\n" +
            "ERROR: Could not find a version that satisfies the requirement numpy\n"
            "ERROR: No matching distribution found for numpy\n"
        )
        returncode = 1

        def wait(self, **kwargs):
            return self.returncode

    with _install_client(monkeypatch, lambda *args, **kwargs: RefusedPip()) as client:
        response = client.post("/api/updates/dependencies/install", json={"package": "numpy"})

    assert response.status_code == 500
    assert sentry_events
