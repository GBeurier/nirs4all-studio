"""Tests for the neutral RtError runtime envelope and its execution-driver wiring."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from api.execution_driver import (
    CLUSTER_UNAVAILABLE_CAPABILITY,
    LOCAL_PYTHON_CAPABILITY,
    ExecutionRequest,
    get_execution_driver,
    list_execution_driver_capabilities,
)
from api.runtime_errors import (
    RtError,
    RtUnsupportedError,
    rt_error_from_execution_metadata,
)

# --- envelope serialization -------------------------------------------------

def test_rt_error_to_envelope_omits_unset_optionals():
    envelope = RtError(verb="run", cause="unavailable_backend", message="nope").to_envelope()
    assert envelope == {"verb": "run", "cause": "unavailable_backend", "message": "nope"}


def test_rt_error_to_envelope_includes_set_optionals():
    envelope = RtError(
        verb="run",
        cause="unsupported_capability",
        message="missing capability",
        mitigation="install the dependency",
        unsupported_capability="generates_data",
        portable_level="execute_local",
    ).to_envelope()
    assert envelope == {
        "verb": "run",
        "cause": "unsupported_capability",
        "message": "missing capability",
        "mitigation": "install the dependency",
        "unsupported_capability": "generates_data",
        "portable_level": "execute_local",
    }


# --- classifier -------------------------------------------------------------

def test_rt_error_from_execution_metadata_returns_none_when_available():
    assert (
        rt_error_from_execution_metadata(
            verb="run",
            backend="local-python",
            available=True,
            metadata={"runner": "nirs4all.run"},
        )
        is None
    )


def test_rt_error_from_execution_metadata_maps_driver_unavailable():
    rt_error = rt_error_from_execution_metadata(
        verb="run",
        backend="cluster",
        available=False,
        metadata={"reason": "driver_unavailable", "message": "Cluster is not configured."},
    )
    assert rt_error is not None
    assert rt_error.verb == "run"
    assert rt_error.cause == "unavailable_backend"
    assert rt_error.message == "Cluster is not configured."
    assert rt_error.mitigation is not None


def test_rt_error_from_execution_metadata_unknown_reason_defaults_to_unavailable_backend():
    rt_error = rt_error_from_execution_metadata(
        verb="run",
        backend="cluster",
        available=False,
        metadata={"reason": "something_new", "message": "Down for maintenance."},
    )
    assert rt_error is not None
    assert rt_error.cause == "unavailable_backend"
    assert rt_error.message == "Down for maintenance."


def test_rt_error_from_execution_metadata_missing_message_uses_fallback():
    rt_error = rt_error_from_execution_metadata(
        verb="run",
        backend="wasm-local",
        available=False,
        metadata={"reason": "driver_unavailable"},
    )
    assert rt_error is not None
    assert rt_error.message == "Execution backend 'wasm-local' is typed but no execution driver is configured."


# --- typed exception --------------------------------------------------------

def test_rt_unsupported_error_is_runtime_error_and_carries_envelope():
    rt_error = RtError(verb="run", cause="unavailable_backend", message="no cluster driver is configured")
    err = RtUnsupportedError(rt_error)
    assert isinstance(err, RuntimeError)
    assert str(err) == "no cluster driver is configured"
    assert err.rt_error is rt_error


# --- driver integration -----------------------------------------------------

def test_local_python_capability_rt_error_is_none():
    assert LOCAL_PYTHON_CAPABILITY.rt_error() is None


def test_unavailable_capability_rt_error_maps_to_unavailable_backend():
    rt_error = CLUSTER_UNAVAILABLE_CAPABILITY.rt_error("run")
    assert rt_error is not None
    assert rt_error.cause == "unavailable_backend"
    assert rt_error.verb == "run"
    assert "Cluster execution" in rt_error.message


def test_capability_rt_error_does_not_mutate_frozen_wire_shape():
    # The /execution-backends wire shape is contract-frozen; the accessor must
    # not leak rt_error fields into metadata or to_dict().
    for capability in list_execution_driver_capabilities():
        capability.rt_error("run")
        payload = capability.to_dict()
        assert set(payload) == {
            "backend",
            "label",
            "available",
            "mode",
            "supports_progress",
            "supports_cancellation",
            "metadata",
        }
        if not capability.available:
            assert payload["metadata"]["reason"] == "driver_unavailable"


@pytest.mark.parametrize("backend", ["cluster", "wasm-local"])
def test_unavailable_driver_submit_raises_structured_rt_unsupported_error(backend):
    driver = get_execution_driver(backend)
    request = ExecutionRequest(run_id="run-x", run_name="Run X", requested_backend=backend)

    with pytest.raises(RtUnsupportedError, match="no .* driver is configured") as exc_info:
        driver.submit(request, SimpleNamespace(), lambda job, progress: None)

    err = exc_info.value
    assert isinstance(err, RuntimeError)
    assert err.rt_error.cause == "unavailable_backend"
    assert err.rt_error.verb == "run"
