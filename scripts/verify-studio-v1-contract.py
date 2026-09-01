#!/usr/bin/env python3
"""Capture and verify the observable Studio V1 FastAPI sidecar contract.

Snapshots are generated from a quarantined local ASGI application.  They are a
legacy compatibility baseline only: no routes are changed and no replacement
sidecar is implied by this tool.
"""

from __future__ import annotations

import argparse
import asyncio
import difflib
import importlib
import inspect
import json
import os
import re
import shutil
import sys
import tempfile
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator, FormatChecker
from starlette.routing import BaseRoute, Mount, Route, WebSocketRoute

ROOT = Path(__file__).resolve().parents[1]
CONTRACT_DIR = ROOT / "docs" / "contracts" / "studio-v1"
FIXTURES_DIR = CONTRACT_DIR / "fixtures"
SCHEMA_DIR = CONTRACT_DIR / "schema"
CONTRACT_VERSION = "studio-v1"
_DYNAMIC = "$dynamic"
_DYNAMIC_KINDS = frozenset({"identifier", "number", "path", "rfc3339", "secret"})
_OPENAPI_VARIANTS = ("fastapi-pre-0.139", "fastapi-0.139-plus")
_OPENAPI_COMPONENT_KEY_MAPPING = {
    "fastapi-pre-0.139": {"api__evaluation__ConfusionMatrixRequest": "ConfusionMatrixRequest"},
    "fastapi-0.139-plus": {"ConfusionMatrixRequest": "api__evaluation__ConfusionMatrixRequest"},
}
_SYSTEM_CHANNEL_TYPES = frozenset({"connected", "error", "pong"})
_EMITTED_DATA_KEYS = {
    "connected": {"client_id", "message"}, "error": {"error"}, "job_completed": {"job_id", "result"},
    "job_failed": {"error", "job_id", "traceback"}, "job_metrics": {"job_id", "metrics"},
    "job_progress": {"job_id", "message", "metrics", "progress"}, "job_started": {"state"},
    "maintenance_completed": {"job_id", "operation", "report"}, "maintenance_failed": {"error", "job_id", "operation"},
    "maintenance_progress": {"job_id", "message", "progress"}, "maintenance_started": {"details", "job_id", "operation"},
    "pong": {"timestamp"}, "refit_completed": {"job_id", "metrics", "score"},
    "refit_failed": {"error", "job_id", "traceback"}, "refit_progress": {"job_id", "message", "progress"},
    "refit_started": {"description", "job_id", "total_steps"}, "refit_step": {"current_step", "job_id", "step_name", "step_type", "total_steps"},
    "subscribed": {"channel"}, "training_epoch": {"epoch", "job_id", "progress", "total_epochs", "train", "val"},
    "unsubscribed": {"channel"},
}
_EXCEPTION_LEDGER_BY_ID = {
    "STU-V1-REDACTION-001": {
        "approval": "contract-review-required",
        "category": "redaction",
        "permitted_divergence": None,
        "review_trigger": "on_redaction_change",
        "scope": "runtime ASGI response values",
        "version_window": {"first": "studio-v1", "last": "studio-v1"},
    },
    "STU-V1-WEBSOCKET-001": {
        "approval": "contract-review-required",
        "category": "websocket",
        "permitted_divergence": None,
        "review_trigger": "on_websocket_change",
        "scope": "docs/contracts/studio-v1/fixtures/websocket.snapshot.json",
        "version_window": {"first": "studio-v1", "last": "studio-v1"},
    },
    "STU-V1-OPENAPI-001": {
        "approval": "contract-review-required",
        "category": "framework_openapi",
        "permitted_divergence": {
            "component_key_mapping": _OPENAPI_COMPONENT_KEY_MAPPING,
            "json_pointers": [
                "/components/schemas/ValidationError/properties/input",
                "/components/schemas/ValidationError/properties/ctx",
                "/components/schemas/Body_predict_from_file_api_predict_file_post/properties/file/format",
                "/components/schemas/Body_predict_from_file_api_predict_file_post/properties/file/contentMediaType",
            ],
            "variants": list(_OPENAPI_VARIANTS),
        },
        "review_trigger": "on_openapi_framework_change",
        "scope": "scripts/verify-studio-v1-contract.py::_openapi_variant",
        "version_window": {"first": "fastapi-0.115", "last": "fastapi-0.x"},
    },
}

# The project requirements intentionally support a range.  This verifier uses
# only public Route/TestClient APIs that exist throughout this policy; CI tests
# both the project runtime and the available system Python 3.11 runtime.
MIN_FASTAPI = (0, 115, 0)
MIN_STARLETTE = (0, 37, 0)


def _canonical_json(value: Any) -> str:
    return json.dumps(value, indent=2, sort_keys=True, ensure_ascii=True) + "\n"


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _fixture(name: str) -> Path:
    return FIXTURES_DIR / name


def _version_tuple(value: str) -> tuple[int, int, int]:
    numbers = [int(part) for part in re.findall(r"\d+", value)[:3]]
    return tuple((numbers + [0, 0, 0])[:3])  # type: ignore[return-value]


def validate_runtime_policy() -> None:
    """Reject framework versions outside the explicitly supported floor."""
    import fastapi
    import starlette

    if _version_tuple(fastapi.__version__) < MIN_FASTAPI:
        raise AssertionError(f"FastAPI {fastapi.__version__} is below supported {MIN_FASTAPI}")
    if _version_tuple(starlette.__version__) < MIN_STARLETTE:
        raise AssertionError(f"Starlette {starlette.__version__} is below supported {MIN_STARLETTE}")


@contextmanager
def _isolated_runtime() -> Iterator[None]:
    """Keep app startup away from user configuration and external services."""
    keys = ("HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "MPLCONFIGDIR", "NIRS4ALL_WORKSPACE", "NIRS4ALL_PID_FILE", "SENTRY_DSN")
    previous = {key: os.environ.get(key) for key in keys}
    with tempfile.TemporaryDirectory(prefix="studio-v1-contract-") as directory:
        os.environ.update(
            {
                "HOME": directory,
                "XDG_CONFIG_HOME": directory,
                "XDG_DATA_HOME": directory,
                "MPLCONFIGDIR": directory,
                "NIRS4ALL_WORKSPACE": "",
                "NIRS4ALL_PID_FILE": "",
                "SENTRY_DSN": "",
            }
        )
        try:
            yield
        finally:
            for key, value in previous.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value


def _stable_openapi_model_name_map(models: Any) -> dict[Any, str]:
    """Assign FastAPI's existing component-name grammar deterministically.

    FastAPI collects models in a set. When two models share a class name, set
    iteration decides which one retains its bare name, producing a different
    OpenAPI document between otherwise identical process launches. Sorting
    only that selection preserves FastAPI's native names (bare name for the
    first model, ``module__Class`` for the collision) without modifying any
    completed schema or ``$ref``.
    """
    grouped: dict[str, list[Any]] = {}
    for model in models:
        grouped.setdefault(model.__name__, []).append(model)
    result: dict[Any, str] = {}
    for name, candidates in grouped.items():
        for index, model in enumerate(sorted(candidates, key=lambda item: (item.__module__, item.__qualname__))):
            result[model] = name if index == 0 else f"{model.__module__.replace('.', '__')}__{name}"
    return result


def _install_deterministic_openapi_model_names() -> None:
    """Patch only FastAPI's unordered model-name selection for this capture."""
    import fastapi.openapi.utils as openapi_utils

    if hasattr(openapi_utils, "get_compat_model_name_map"):
        # FastAPI 0.128 delegates through this compat helper, which retains a
        # module-global reference to the Pydantic-v2 name function.
        import fastapi._compat.v2 as compat_v2

        compat_v2.get_model_name_map = _stable_openapi_model_name_map
    else:
        # FastAPI 0.139 calls this module-level function directly.
        openapi_utils.get_model_name_map = _stable_openapi_model_name_map


def _load_app() -> FastAPI:
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    _install_deterministic_openapi_model_names()
    return importlib.import_module("main").app


def _route_owner(route: Any) -> str:
    endpoint = getattr(route, "endpoint", None)
    module = getattr(endpoint, "__module__", "")
    name = getattr(endpoint, "__name__", getattr(route, "name", ""))
    return f"{module}.{name}".strip(".")


def _join_path(prefix: str, path: str) -> str:
    joined = f"{prefix.rstrip('/')}/{path.lstrip('/')}"
    return joined if joined.startswith("/") else f"/{joined}"


def _iter_physical_routes(routes: list[Any], prefix: str = "") -> Iterator[tuple[Any, str]]:
    """Yield effective matchers in their real matching order without sorting.

    FastAPI <=0.128 flattens included routers into ``app.routes``; FastAPI
    0.139 keeps private ``_IncludedRouter`` wrappers.  The wrapper is an
    implementation detail, so we traverse it (and mounts/subrouters) into the
    same public, effective route order on both supported runtime families.
    """
    for route in routes:
        context = getattr(route, "include_context", None)
        original_router = getattr(route, "original_router", None)
        if context is not None and original_router is not None:
            child_prefix = _join_path(prefix, getattr(context, "prefix", ""))
            yield from _iter_physical_routes(list(original_router.routes), child_prefix)
            continue
        path = _join_path(prefix, getattr(route, "path", ""))
        yield route, path
        children = getattr(route, "routes", None)
        if isinstance(children, (list, tuple)):
            yield from _iter_physical_routes(list(children), path)


def capture_routes() -> dict[str, Any]:
    """Capture every physical matcher, including FastAPI's documentation routes."""
    app = _load_app()
    captured: list[dict[str, Any]] = []
    for ordinal, (route, path) in enumerate(_iter_physical_routes(app.routes)):
        common = {"match_ordinal": ordinal, "name": getattr(route, "name", None), "path": path}
        if isinstance(route, APIRoute):
            captured.append(
                {
                    **common,
                    "endpoint": _route_owner(route),
                    "include_in_schema": route.include_in_schema,
                    "kind": "http",
                    "methods": sorted(route.methods or ()),
                    "route_class": "APIRoute",
                }
            )
        elif isinstance(route, Route):
            captured.append(
                {
                    **common,
                    "endpoint": _route_owner(route),
                    "include_in_schema": getattr(route, "include_in_schema", False),
                    "kind": "http",
                    "methods": sorted(route.methods or ()),
                    "route_class": "Route",
                }
            )
        elif isinstance(route, WebSocketRoute):
            captured.append({**common, "endpoint": _route_owner(route), "kind": "websocket", "route_class": "WebSocketRoute"})
        elif isinstance(route, Mount):
            captured.append({**common, "kind": "mount", "route_class": "Mount"})
        elif isinstance(route, BaseRoute):
            captured.append({**common, "kind": "other", "route_class": type(route).__name__})
    return {"contract_version": CONTRACT_VERSION, "routes": captured}


def _openapi_variant(schema: dict[str, Any], variant: str) -> dict[str, Any]:
    """Return one explicitly ledgered FastAPI OpenAPI representation.

    Both representations are retained in the fixture.  This is deliberately
    not a lossy normalisation: a framework that exposes ``input`` and ``ctx``
    remains observable in the ``fastapi-0.139-plus`` variant, while older
    FastAPI's binary-field representation remains observable in the other.
    """
    copied = json.loads(json.dumps(schema))

    def project(value: Any) -> None:
        if isinstance(value, list):
            for item in value:
                project(item)
        elif isinstance(value, dict):
            if variant == "fastapi-pre-0.139" and value.get("contentMediaType") == "application/octet-stream":
                value.pop("contentMediaType")
                value["format"] = "binary"
            elif variant == "fastapi-0.139-plus" and value.get("format") == "binary":
                value.pop("format")
                value["contentMediaType"] = "application/octet-stream"
            for item in value.values():
                project(item)

    components = copied.get("components", {}).get("schemas", {})
    if not isinstance(components, dict):
        return copied
    for component in components.values():
        if isinstance(component, dict) and component.get("title") == "ValidationError":
            properties = component.get("properties")
            if isinstance(properties, dict):
                if variant == "fastapi-pre-0.139":
                    properties.pop("ctx", None)
                    properties.pop("input", None)
                else:
                    # These are FastAPI 0.139's exact generated properties,
                    # not an approximation of an arbitrary extension.
                    properties["input"] = {"title": "Input"}
                    properties["ctx"] = {"type": "object", "title": "Context"}
    project(copied)
    # FastAPI 0.128 gives the evaluation ConfusionMatrixRequest the bare name;
    # 0.139 qualifies both colliding models. This is the sole component-key
    # difference retained in the two variants. It is an exact, ledgered
    # key/ref substitution, not a normalisation of arbitrary components.
    for source, target in _OPENAPI_COMPONENT_KEY_MAPPING[variant].items():
        if source not in components:
            continue
        if target in components:
            raise AssertionError(f"ambiguous OpenAPI component mapping: {source} -> {target}")
        components[target] = components.pop(source)

        def rewrite_exact_reference(value: Any) -> None:
            if isinstance(value, list):
                for item in value:
                    rewrite_exact_reference(item)
            elif isinstance(value, dict):
                if value.get("$ref") == f"#/components/schemas/{source}":
                    value["$ref"] = f"#/components/schemas/{target}"
                for item in value.values():
                    rewrite_exact_reference(item)

        rewrite_exact_reference(copied)
    return copied


def capture_openapi() -> dict[str, Any]:
    raw = _load_app().openapi()
    variants = {variant: _openapi_variant(raw, variant) for variant in _OPENAPI_VARIANTS}
    for variant, document in variants.items():
        component_keys = set(document.get("components", {}).get("schemas", {}))
        counterpart = set(raw.get("components", {}).get("schemas", {}))
        expected_changed = set(_OPENAPI_COMPONENT_KEY_MAPPING[variant]) | set(_OPENAPI_COMPONENT_KEY_MAPPING[variant].values())
        if (component_keys ^ counterpart) - expected_changed:
            raise AssertionError(f"{variant} changed unledgered OpenAPI component keys")
    return {
        "contract_version": CONTRACT_VERSION,
        "openapi_variants": variants,
    }


def _dynamic(kind: str) -> dict[str, str]:
    return {_DYNAMIC: kind}


def _redact(value: Any, key: str | None = None) -> Any:
    """Use typed placeholders for values generated by the live process."""
    dynamic_keys = {"timestamp": "rfc3339", "created_at": "rfc3339", "started_at": "rfc3339", "completed_at": "rfc3339", "elapsed_seconds": "number", "duration_seconds": "number"}
    if key in dynamic_keys:
        return _dynamic(dynamic_keys[key])
    if isinstance(value, str) and _contains_absolute_path(value):
        return _dynamic("path")
    if key and (key == "path" or key.endswith("_path") or key in {"working_directory", "home_directory", "python_executable"}) and isinstance(value, str):
        return _dynamic("path")
    if key in {"job_id", "run_id", "client_id", "id"} and isinstance(value, str):
        return _dynamic("identifier")
    if isinstance(value, dict):
        return {name: _redact(item, name) for name, item in value.items()}
    if isinstance(value, list):
        return [_redact(item) for item in value]
    return value


def _response_snapshot(response: Any) -> dict[str, Any]:
    content_type = response.headers.get("content-type", "")
    try:
        body: Any = response.json()
    except ValueError:
        body = response.text
    # Content length is a transport implementation detail: serializers and
    # framework versions legitimately alter it while preserving the body. Keep
    # stable, semantic response metadata only.
    headers = {name.lower(): value for name, value in response.headers.items() if name.lower() == "content-type"}
    return {"body": _redact(body), "content_type": content_type, "headers": headers, "status": response.status_code}


def _wait_for_status(job: Any, expected: str) -> None:
    deadline = time.monotonic() + 3
    while getattr(job.status, "value", job.status) != expected:
        if time.monotonic() >= deadline:
            raise AssertionError(f"job did not reach {expected}; got {job.status}")
        time.sleep(0.01)


def capture_job_transitions() -> dict[str, Any]:
    """Run actual JobManager jobs, including terminal and cooperative paths."""
    from api.jobs.manager import JobManager, JobStatus, JobType

    manager = JobManager(max_workers=2)
    gate = threading.Event()
    started = threading.Event()
    try:
        completed = manager.create_job(JobType.TRAINING, {}, job_id="contract-completed")
        manager.submit_job(completed, lambda _job, _progress: {"outcome": "contract"})
        _wait_for_status(completed, "completed")

        failed = manager.create_job(JobType.TRAINING, {}, job_id="contract-failed")
        def fail(_job: Any, _progress: Any) -> None:
            raise RuntimeError("contract failure")
        manager.submit_job(failed, fail)
        _wait_for_status(failed, "failed")

        pending = manager.create_job(JobType.TRAINING, {}, job_id="contract-pending")
        pending_cancelled = manager.cancel_job(pending.id)

        running = manager.create_job(JobType.TRAINING, {}, job_id="contract-running")
        def hold(_job: Any, _progress: Any) -> dict[str, bool]:
            started.set()
            gate.wait(timeout=3)
            return {"released": True}
        manager.submit_job(running, hold)
        if not started.wait(timeout=3):
            raise AssertionError("running contract job did not start")
        running_cancelled = manager.cancel_job(running.id)
        gate.set()
        _wait_for_status(running, "cancelled")

        return {
            "declared_statuses": sorted(item.value for item in JobStatus),
            "declared_types": sorted(item.value for item in JobType),
            "transitions": {
                "completed": {"result_keys": sorted((completed.result or {}).keys()), "status": completed.status.value},
                "failed": {"error": failed.error, "status": failed.status.value},
                "pending_cancel": {"cancel_returned": pending_cancelled, "status": pending.status.value},
                "running_cancel": {"cancel_returned": running_cancelled, "cancellation_requested": running.cancellation_requested, "status": running.status.value},
            },
        }
    finally:
        gate.set()
        manager.shutdown(wait=True)


def _cancellation_endpoints() -> list[dict[str, Any]]:
    """Discover all handlers that delegate cancellation to the job execution layer."""
    endpoints: list[dict[str, Any]] = []
    for ordinal, (route, path) in enumerate(_iter_physical_routes(_load_app().routes)):
        if not isinstance(route, APIRoute):
            continue
        try:
            source = inspect.getsource(route.endpoint)
        except (OSError, TypeError):
            continue
        if not any(marker in source for marker in ("cancel_job(", "_cancel_run(", "_request_execution_job_cancel(")):
            continue
        endpoints.append({"endpoint": _route_owner(route), "match_ordinal": ordinal, "methods": sorted(route.methods or ()), "path": path})
    return endpoints


class _RecordingSocket:
    """Minimal local WebSocket transport used to exercise serializer producers."""
    def __init__(self) -> None:
        self.frames: list[dict[str, Any]] = []

    async def accept(self) -> None:
        return None

    async def send_text(self, text: str) -> None:
        self.frames.append(json.loads(text))


async def _capture_emitted_ws_messages() -> dict[str, Any]:
    import websocket.manager as manager_module

    original = manager_module.ws_manager
    recorder = manager_module.WebSocketManager()
    socket = _RecordingSocket()
    manager_module.ws_manager = recorder
    try:
        await recorder.connect(socket, "contract-client")
        await recorder.subscribe(socket, "job:contract-job")
        await recorder.unsubscribe(socket, "job:contract-job")
        await recorder.subscribe(socket, "job:contract-job")
        await manager_module.notify_job_started("contract-job", {"state": "started"})
        await manager_module.notify_job_progress("contract-job", 50, "half", {"score": 1.0})
        await manager_module.notify_job_completed("contract-job", {"outcome": "ok"})
        await manager_module.notify_job_failed("contract-job", "failed", None)
        await manager_module.notify_maintenance_started("contract-job", "cleanup", {"count": 1})
        await manager_module.notify_maintenance_progress("contract-job", 50, "half")
        await manager_module.notify_maintenance_completed("contract-job", "cleanup", {"count": 1})
        await manager_module.notify_maintenance_failed("contract-job", "cleanup", "failed")
        await manager_module.notify_training_epoch("contract-job", 1, 2, {"loss": 1.0}, None)
        await manager_module.notify_job_metrics("contract-job", {"score": 1.0})
        await manager_module.notify_refit_started("contract-job", 2, "refit")
        await manager_module.notify_refit_progress("contract-job", 50, "half")
        await manager_module.notify_refit_step("contract-job", 1, 2, "step")
        await manager_module.notify_refit_completed("contract-job", 1.0, {"score": 1.0})
        await manager_module.notify_refit_failed("contract-job", "failed", None)
        return {frame["type"]: _redact(frame) for frame in socket.frames}
    finally:
        manager_module.ws_manager = original


def capture_websocket() -> dict[str, Any]:
    """Capture live ASGI protocol frames and explicitly record refused branches."""
    app = _load_app()
    main = importlib.import_module("main")
    lazy_imports = importlib.import_module("api.lazy_imports")
    workspace_module = importlib.import_module("api.workspace_manager")
    import websocket.manager as manager_module

    original_start = lazy_imports.start_ml_loading
    original_updates = main.check_updates_background
    original_recommended = main.cache_recommended_config_background
    original_active_workspace = workspace_module.workspace_manager.get_active_workspace
    lazy_imports.start_ml_loading = lambda: None
    async def quiescent() -> None:
        return None
    main.check_updates_background = quiescent
    main.cache_recommended_config_background = quiescent
    workspace_module.workspace_manager.get_active_workspace = lambda: None
    main.startup_complete = False
    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            with client.websocket_connect("/ws?client_id=contract-client") as websocket:
                connected = _redact(websocket.receive_json())
                websocket.send_json({"type": "ping", "channel": "system", "data": {}})
                pong = _redact(websocket.receive_json())
                websocket.send_json({"type": "subscribe", "channel": "system", "data": {"channel": "job:contract-job"}})
                subscribe_refusal = _redact(websocket.receive_json())
                websocket.send_json({"type": "unsubscribe", "channel": "system", "data": {"channel": "job:contract-job"}})
                unsubscribe_refusal = _redact(websocket.receive_json())
            with client.websocket_connect("/ws/job/contract-job") as websocket:
                job_connected = _redact(websocket.receive_json())
                job_subscribed = _redact(websocket.receive_json())
                websocket.send_json({"type": "ping", "channel": "system", "data": {}})
                job_pong = _redact(websocket.receive_json())
            with client.websocket_connect("/ws/training/contract-job") as websocket:
                training_connected = _redact(websocket.receive_json())
                training_subscribed = _redact(websocket.receive_json())
                websocket.send_json({"type": "ping", "channel": "system", "data": {}})
                training_pong = _redact(websocket.receive_json())
    finally:
        lazy_imports.start_ml_loading = original_start
        main.check_updates_background = original_updates
        main.cache_recommended_config_background = original_recommended
        workspace_module.workspace_manager.get_active_workspace = original_active_workspace

    emitted = asyncio.run(_capture_emitted_ws_messages())
    # These protocol responses are produced by the live ASGI endpoint rather
    # than a broadcast helper, but are still real reachable message types.
    for frame in (connected, pong, subscribe_refusal, unsubscribe_refusal, job_connected, job_subscribed, job_pong, training_connected, training_subscribed, training_pong):
        emitted[frame["type"]] = frame
    declared = sorted(member.value for member in manager_module.MessageType)
    payload_shapes: dict[str, Any] = {}
    for message_type in declared:
        if message_type in emitted:
            frame = emitted[message_type]
            payload_shapes[message_type] = {
                "channel": frame["channel"],
                "data": frame["data"],
                "envelope_keys": sorted(frame),
                "status": "emitted",
                "type": frame["type"],
            }
        elif message_type == "ping":
            payload_shapes[message_type] = {"reason": "Reachable only as an incoming client frame; it produces pong.", "status": "incoming_only"}
        else:
            payload_shapes[message_type] = {"reason": "No reachable legacy producer exists for this declared enum member.", "status": "unreachable"}
    endpoints = [
        {"endpoint": _route_owner(route), "match_ordinal": ordinal, "name": route.name, "path": path}
        for ordinal, (route, path) in enumerate(_iter_physical_routes(app.routes))
        if isinstance(route, WebSocketRoute)
    ]
    return {
        "contract_version": CONTRACT_VERSION,
        "endpoints": endpoints,
        "message_types": declared,
        "payload_shapes": payload_shapes,
        "protocol": {
            "incoming": {
                "ping": {"channel": "system", "data": {}, "type": "ping"},
                "subscribe": {"channel": "system", "data": {"channel": "job:contract-job"}, "type": "subscribe"},
                "unsubscribe": {"channel": "system", "data": {"channel": "job:contract-job"}, "type": "unsubscribe"},
            },
            "outgoing": {
                "connected": connected,
                "pong": pong,
            },
            "subscription": {
                "job_endpoint_auto_subscription": job_subscribed,
                "training_endpoint_auto_subscription": training_subscribed,
                "legacy_client_subscribe": {"outcome": "refused", "response": subscribe_refusal},
                "legacy_client_unsubscribe": {"outcome": "refused", "response": unsubscribe_refusal},
            },
        },
    }


def _install_contract_probe(app: FastAPI) -> APIRoute:
    async def contract_unmanaged_error() -> None:
        raise RuntimeError("contract unmanaged error")
    route = APIRoute("/__studio_v1_contract_unmanaged_error", contract_unmanaged_error, methods=["GET"], name="contract_unmanaged_error", include_in_schema=False)
    # The legacy SPA catch-all is intentionally registered late.  Put the
    # ephemeral probe before it so it exercises the application's real
    # ``Exception`` handler rather than being served by the SPA fallback.
    app.router.routes.insert(0, route)
    return route


def capture_behavior() -> dict[str, Any]:
    """Use real ASGI requests before and during lifespan; no user data is sent."""
    app = _load_app()
    main = importlib.import_module("main")
    lazy_imports = importlib.import_module("api.lazy_imports")
    workspace_module = importlib.import_module("api.workspace_manager")
    original_start = lazy_imports.start_ml_loading
    original_updates = main.check_updates_background
    original_recommended = main.cache_recommended_config_background
    original_active_workspace = workspace_module.workspace_manager.get_active_workspace
    lazy_imports.start_ml_loading = lambda: None
    async def quiescent() -> None:
        return None
    main.check_updates_background = quiescent
    main.cache_recommended_config_background = quiescent
    workspace_module.workspace_manager.get_active_workspace = lambda: None
    main.startup_complete = False
    probe = _install_contract_probe(app)
    try:
        pre_client = TestClient(app, raise_server_exceptions=False)
        pre_health = _response_snapshot(pre_client.get("/api/health"))
        pre_readiness = _response_snapshot(pre_client.get("/api/system/readiness"))
        pre_client.close()
        with TestClient(app, raise_server_exceptions=False) as client:
            health = _response_snapshot(client.get("/api/health"))
            readiness = _response_snapshot(client.get("/api/system/readiness"))
            validation_error = _response_snapshot(client.post("/api/training/start", json={}))
            unmanaged_error = _response_snapshot(client.get("/__studio_v1_contract_unmanaged_error"))
            workspace_paths = _response_snapshot(client.get("/api/workspace/paths"))
            system_paths = _response_snapshot(client.get("/api/system/paths"))
        if validation_error["status"] != 422:
            raise AssertionError(f"expected real validation 422, got {validation_error['status']}")
        if unmanaged_error["status"] != 500:
            raise AssertionError(f"expected real unmanaged 500, got {unmanaged_error['status']}")
        return {
            "contract_version": CONTRACT_VERSION,
            "errors": {"unmanaged_500": unmanaged_error, "validation_422": validation_error},
            "jobs": {"cancellation_endpoints": _cancellation_endpoints(), **capture_job_transitions()},
            "readiness": {"post_lifespan": {"health": health, "readiness": readiness}, "pre_lifespan": {"health": pre_health, "readiness": pre_readiness}},
            "system_paths": system_paths,
            "workspace_paths": workspace_paths,
        }
    finally:
        app.router.routes.remove(probe)
        lazy_imports.start_ml_loading = original_start
        main.check_updates_background = original_updates
        main.cache_recommended_config_background = original_recommended
        workspace_module.workspace_manager.get_active_workspace = original_active_workspace


def _snapshots() -> dict[str, Any]:
    with _isolated_runtime():
        validate_runtime_policy()
        return {
            "routes.snapshot.json": capture_routes(),
            "http-openapi.snapshot.json": capture_openapi(),
            "websocket.snapshot.json": capture_websocket(),
            "behavior.snapshot.json": capture_behavior(),
        }


def _assert_equal(name: str, actual: Any, expected: Any) -> None:
    if actual == expected:
        return
    diff = "".join(difflib.unified_diff(_canonical_json(expected).splitlines(keepends=True), _canonical_json(actual).splitlines(keepends=True), fromfile=f"committed/{name}", tofile=f"current/{name}"))
    raise AssertionError(f"Studio V1 contract drift in {name}; approved changes require --write.\n{diff}")


def _validate_json(schema_name: str, value: Any, label: str) -> None:
    schema = _read_json(SCHEMA_DIR / schema_name)
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    errors = sorted(validator.iter_errors(value), key=lambda error: list(error.absolute_path))
    if errors:
        rendered = "; ".join(f"{'/'.join(map(str, error.absolute_path)) or '<root>'}: {error.message}" for error in errors[:8])
        raise AssertionError(f"{label} violates {schema_name}: {rendered}")


def _validate_websocket_semantics(value: dict[str, Any]) -> None:
    """Close the parts JSON Schema cannot correlate across map keys."""
    declared = set(value["message_types"])
    payloads = value["payload_shapes"]
    if set(payloads) != declared:
        raise AssertionError("websocket payload_shapes must contain exactly every declared message type")
    for message_type, payload in payloads.items():
        if payload["status"] != "emitted":
            continue
        if payload["type"] != message_type:
            raise AssertionError(f"websocket payload type mismatch for {message_type}")
        expected_channel = "system" if message_type in _SYSTEM_CHANNEL_TYPES else "job:contract-job"
        if payload["channel"] != expected_channel:
            raise AssertionError(f"websocket payload channel mismatch for {message_type}")
        if set(payload["data"]) != _EMITTED_DATA_KEYS[message_type]:
            raise AssertionError(f"websocket payload data shape mismatch for {message_type}")
    for frame_name, frame in value["protocol"]["outgoing"].items():
        if frame["type"] not in declared:
            raise AssertionError(f"unknown outgoing message type at {frame_name}")
        expected_channel = "system" if frame["type"] in _SYSTEM_CHANNEL_TYPES else "job:contract-job"
        if frame["channel"] != expected_channel:
            raise AssertionError(f"outgoing channel mismatch at {frame_name}")
        if set(frame["data"]) != _EMITTED_DATA_KEYS[frame["type"]]:
            raise AssertionError(f"outgoing data shape mismatch at {frame_name}")

    protocol = value["protocol"]
    incoming = protocol["incoming"]
    expected_incoming = {
        "ping": {"channel": "system", "data": {}, "type": "ping"},
        "subscribe": {"channel": "system", "data": {"channel": "job:contract-job"}, "type": "subscribe"},
        "unsubscribe": {"channel": "system", "data": {"channel": "job:contract-job"}, "type": "unsubscribe"},
    }
    if incoming != expected_incoming:
        raise AssertionError("websocket incoming frame shapes do not match the legacy wire protocol")

    outgoing = protocol["outgoing"]
    if set(outgoing) != {"connected", "pong"}:
        raise AssertionError("websocket outgoing protocol must expose only connected and pong system frames")
    if outgoing["connected"]["type"] != "connected":
        raise AssertionError("websocket outgoing.connected must be the declared connected frame")
    if outgoing["pong"]["type"] != "pong":
        raise AssertionError("websocket outgoing.pong must be the declared pong frame")

    expected_subscription = {"channel": "job:contract-job", "data": {"channel": "job:contract-job"}, "type": "subscribed"}
    for name in ("job_endpoint_auto_subscription", "training_endpoint_auto_subscription"):
        frame = protocol["subscription"][name]
        observed = {key: frame[key] for key in ("channel", "data", "type")}
        if observed != expected_subscription:
            raise AssertionError(f"websocket {name} must subscribe to the exact job channel")


def _iter_schema_references(value: Any) -> Iterator[str]:
    """Yield local schema component references without rewriting them."""
    if isinstance(value, list):
        for item in value:
            yield from _iter_schema_references(item)
    elif isinstance(value, dict):
        reference = value.get("$ref")
        if isinstance(reference, str) and reference.startswith("#/components/schemas/"):
            yield reference.rsplit("/", 1)[-1]
        for item in value.values():
            yield from _iter_schema_references(item)


def _validate_openapi_semantics(value: dict[str, Any]) -> None:
    """Ensure variants retain the app's observable component identities."""
    variants = value["openapi_variants"]
    component_keys = {
        variant: set(document.get("components", {}).get("schemas", {}))
        for variant, document in variants.items()
    }
    pre_keys = component_keys["fastapi-pre-0.139"]
    plus_keys = component_keys["fastapi-0.139-plus"]
    expected_pre_only = {"ConfusionMatrixRequest"}
    expected_plus_only = {"api__evaluation__ConfusionMatrixRequest"}
    if pre_keys - plus_keys != expected_pre_only or plus_keys - pre_keys != expected_plus_only:
        raise AssertionError("OpenAPI component key differences must equal the exact ledgered FastAPI mapping")
    for variant, document in variants.items():
        keys = component_keys[variant]
        dangling = sorted(set(_iter_schema_references(document)) - keys)
        if dangling:
            raise AssertionError(f"{variant} contains dangling component references: {', '.join(dangling)}")


_POSIX_PATH = re.compile(r"(?<![A-Za-z0-9._~%+:/-])/(?:[^\s\"'<>`]*)")
_WINDOWS_PATH = re.compile(r"(?<![A-Za-z0-9])(?:[A-Za-z]:[\\/]|\\\\)[^\s\"'<>]*")
_FILE_URI = re.compile(r"(?i)\bfile:(?://)?[^\s\"'<>]+")
_OPENAPI_TEMPLATE_PATH = re.compile(r"^/(?:[A-Za-z0-9][A-Za-z0-9._-]*/)*\{[A-Za-z_][A-Za-z0-9_]*\}$")
_MACHINE_POSIX_ROOTS = ("/home/", "/run/", "/nix/", "/var/", "/tmp/", "/usr/", "/etc/", "/opt/", "/mnt/", "/private/", "/Users/")
_OPENAPI_STATIC_PATHS = frozenset({"/nirs4all.ico", "/nirs4all_icon.svg"})
_SECRET_KEY = re.compile(r"(?i)(?:password|passphrase|token|api[-_]?key|secret|credential|authorization|private[-_]?key)")
_SECRET_VALUE = re.compile(
    r"(?ix)(?:"
    r"bearer\s+[^\s<]+|(?:api[-_]?key|token|password|secret|credential|authorization)\s*[:= ]\s*[^\s<]+|"
    r"gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|"
    r"AKIA[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|"
    r"-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----"
    r")"
)


def _posix_path_tokens(value: str) -> tuple[str, ...]:
    """Return slash-prefixed tokens whose context permits a filesystem path."""
    return tuple(match.group(0).rstrip(".,;:!?)]`") for match in _POSIX_PATH.finditer(value))


def _contains_absolute_path(value: str) -> bool:
    return bool(_posix_path_tokens(value) or _WINDOWS_PATH.search(value) or _FILE_URI.search(value))


def _is_openapi_route_path(value: str) -> bool:
    """Accept only Studio's published OpenAPI path namespace, never host paths."""
    return value == "/" or value.startswith("/api/") or value in _OPENAPI_STATIC_PATHS or bool(_OPENAPI_TEMPLATE_PATH.fullmatch(value))


def _is_machine_posix_path(value: str) -> bool:
    return value.startswith(_MACHINE_POSIX_ROOTS)


def _is_documented_openapi_path(value: str, paths: frozenset[str], raw_value: str) -> bool:
    """Recognize an endpoint or local JSON Pointer only when the spec proves it."""
    return not _is_machine_posix_path(value) and (
        value in paths
        or f"/api{value}" in paths
        or any(path.endswith(value) for path in paths)
        or bool(_OPENAPI_TEMPLATE_PATH.fullmatch(value))
        or raw_value == f"#{value}" and value.startswith("/components/")
    )


def _is_typed_dynamic(value: Any) -> bool:
    return isinstance(value, dict) and set(value) == {_DYNAMIC} and value.get(_DYNAMIC) in _DYNAMIC_KINDS


def _scan_safe(
    value: Any,
    location: str = "$",
    *,
    route_path: bool = False,
    openapi_document: bool = False,
    openapi_paths: frozenset[str] = frozenset(),
) -> None:
    """Refuse source-machine paths and credential-looking strings before write."""
    if isinstance(value, dict):
        if set(value) == {_DYNAMIC}:
            if not _is_typed_dynamic(value):
                raise AssertionError(f"refusing untyped dynamic marker at {location}")
            return
        if openapi_document and "openapi" in value and isinstance(value.get("paths"), dict):
            openapi_paths = frozenset(value["paths"])
        for key, item in value.items():
            if _SECRET_KEY.search(key) and item != _dynamic("secret"):
                raise AssertionError(f"refusing secret-bearing key at {location}.{key}; use {{\"$dynamic\": \"secret\"}}")
            if openapi_document and "openapi" in value and key == "paths":
                for path, path_item in item.items():
                    if not isinstance(path, str) or not _is_openapi_route_path(path):
                        raise AssertionError(f"refusing non-Studio OpenAPI path at {location}.paths")
                    _scan_safe(path_item, f"{location}.paths[{path!r}]", openapi_document=True, openapi_paths=openapi_paths)
                continue
            _scan_safe(
                item,
                f"{location}.{key}",
                route_path=route_path or (key == "path" and (".routes[" in location or ".endpoints[" in location or ".cancellation_endpoints[" in location)),
                openapi_document=openapi_document or key == "openapi_variants",
                openapi_paths=openapi_paths,
            )
    elif isinstance(value, list):
        for index, item in enumerate(value):
            _scan_safe(item, f"{location}[{index}]", route_path=route_path, openapi_document=openapi_document, openapi_paths=openapi_paths)
    elif isinstance(value, str):
        path_tokens = _posix_path_tokens(value)
        sensitive_path = bool(path_tokens or _WINDOWS_PATH.search(value) or _FILE_URI.search(value))
        if openapi_document and path_tokens and all(_is_documented_openapi_path(path, openapi_paths, value) for path in path_tokens):
            sensitive_path = bool(_WINDOWS_PATH.search(value) or _FILE_URI.search(value))
        if not (sensitive_path or _SECRET_VALUE.search(value)):
            return
        # A route fixture's ``path`` field has URL-path grammar, distinct from
        # a response value. All other slash-prefixed strings are treated as
        # filesystem paths and must be represented by a typed marker.
        if route_path and value.startswith("/") and not _SECRET_VALUE.search(value):
            return
        raise AssertionError(f"refusing to write sensitive or machine-specific value at {location}")


def validate_fixture_shapes(snapshots: dict[str, Any] | None = None) -> None:
    """Perform real Draft 2020-12 validation for every fixture and ledger."""
    values = snapshots or {name: _read_json(_fixture(name)) for name in ("routes.snapshot.json", "http-openapi.snapshot.json", "websocket.snapshot.json", "behavior.snapshot.json")}
    schema_by_fixture = {
        "routes.snapshot.json": "route-snapshot.schema.json",
        "http-openapi.snapshot.json": "openapi-snapshot.schema.json",
        "websocket.snapshot.json": "websocket-snapshot.schema.json",
        "behavior.snapshot.json": "behavior-snapshot.schema.json",
    }
    for name, schema in schema_by_fixture.items():
        _validate_json(schema, values[name], name)
        _scan_safe(values[name])
    _validate_websocket_semantics(values["websocket.snapshot.json"])
    _validate_openapi_semantics(values["http-openapi.snapshot.json"])
    exceptions = _read_json(CONTRACT_DIR / "exceptions.json")
    _validate_exception_ledger(exceptions)


def _validate_exception_ledger(exceptions: dict[str, Any]) -> None:
    """Require each approved exception to retain its complete reviewed binding."""
    _validate_json("exceptions.schema.json", exceptions, "exceptions.json")
    ids = [entry["id"] for entry in exceptions["exceptions"]]
    if len(ids) != len(set(ids)):
        raise AssertionError("exceptions.json has duplicate exception ids")
    approved = {entry["id"]: {key: value for key, value in entry.items() if key not in {"id", "justification"}} for entry in exceptions["exceptions"]}
    if approved != _EXCEPTION_LEDGER_BY_ID:
        raise AssertionError("exceptions.json must contain exactly the approved exception bindings")


def check() -> None:
    validate_fixture_shapes()
    actual = _snapshots()
    for name, value in actual.items():
        _assert_equal(name, value, _read_json(_fixture(name)))


def write() -> None:
    """Generate all snapshots, validate and scan them in temp storage, then replace."""
    snapshots = _snapshots()
    validate_fixture_shapes(snapshots)
    for value in snapshots.values():
        _scan_safe(value)
    FIXTURES_DIR.mkdir(parents=True, exist_ok=True)
    temp_dir = Path(tempfile.mkdtemp(prefix=".studio-v1-contract-", dir=CONTRACT_DIR))
    try:
        for name, value in snapshots.items():
            temporary = temp_dir / name
            temporary.write_text(_canonical_json(value), encoding="utf-8")
            _validate_json({
                "routes.snapshot.json": "route-snapshot.schema.json",
                "http-openapi.snapshot.json": "openapi-snapshot.schema.json",
                "websocket.snapshot.json": "websocket-snapshot.schema.json",
                "behavior.snapshot.json": "behavior-snapshot.schema.json",
            }[name], _read_json(temporary), f"temporary {name}")
        for name in snapshots:
            os.replace(temp_dir / name, _fixture(name))
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--write", action="store_true")
    args = parser.parse_args()
    if args.write:
        write()
    else:
        check()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
