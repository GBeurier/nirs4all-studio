"""Regression tests for the frozen Studio V1 legacy-sidecar boundary."""

from __future__ import annotations

import copy
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
VERIFY_SCRIPT = ROOT / "scripts" / "verify-studio-v1-contract.py"


def _verifier_module():
    spec = importlib.util.spec_from_file_location("studio_v1_contract_verifier", VERIFY_SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_studio_v1_contract_snapshots_are_current() -> None:
    """Contract drift must be explicit and reviewed rather than silent."""
    result = subprocess.run(
        [sys.executable, str(VERIFY_SCRIPT), "--check"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_studio_v1_contract_is_portable_to_system_python_311() -> None:
    """Exercise the supported FastAPI 0.139-style included-router runtime when available."""
    system_python = Path("/usr/bin/python3.11")
    if not system_python.exists() or system_python.resolve() == Path(sys.executable).resolve():
        pytest.skip("distinct system Python 3.11 is not available")
    dependencies = subprocess.run(
        [str(system_python), "-c", "import fastapi, jsonschema, starlette"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if dependencies.returncode:
        pytest.skip("system Python 3.11 does not provide the contract dependencies")
    result = subprocess.run(
        [str(system_python), str(VERIFY_SCRIPT), "--check"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr


@pytest.mark.parametrize(
    "value",
    [
        {"password": "not-a-placeholder"},
        {"accessToken": "abc"},
        {"API_KEY": "abc"},
        {"nested": {"credential": "abc"}},
        {"description": "token=abc"},
        {"description": "/home/alice/private"},
        {"description": "/run/user/1000/private"},
        {"description": "/nix/store/private"},
        {"description": "comma,/home/alice/private"},
        {"description": "semicolon;/run/user/1000/private"},
        {"description": "brace{/nix/store/private"},
        {"description": "bracket[/var/private"},
        {"description": "pipe|/tmp/private"},
        {"description": "question?/etc/private"},
        {"description": "bang!/opt/private"},
        {"description": "close)/mnt/private"},
        {"description": "file:///var/private"},
        {"description": r"C:\\Users\\alice\\private"},
        {"description": r"\\server\\share\\private"},
        {"description": r"comma,C:\\Users\\alice\\private"},
        {"description": r"semicolon;\\server\\share\\private"},
        {"description": "Bearer abcdefghijklmnopqrstuvwxyz"},
        {"description": "ghp_abcdefghijklmnopqrstuvwxyz1234567890"},
    ],
)
def test_contract_scanner_fails_closed_for_secrets_and_machine_paths(value: dict) -> None:
    verifier = _verifier_module()
    with pytest.raises(AssertionError):
        verifier._scan_safe(value)


def test_contract_scanner_accepts_only_typed_redaction_markers() -> None:
    verifier = _verifier_module()
    verifier._scan_safe({"access_token": {"$dynamic": "secret"}, "path": {"$dynamic": "path"}})
    with pytest.raises(AssertionError):
        verifier._scan_safe({"access_token": {"$dynamic": "redacted"}})
    with pytest.raises(AssertionError):
        verifier._scan_safe({"access_token": {"$dynamic": "path"}})


def test_contract_scanner_checks_openapi_prose_but_accepts_proven_endpoint_references() -> None:
    verifier = _verifier_module()
    openapi = {
        "openapi": "3.1.0",
        "info": {"title": "Studio", "version": "v1"},
        "paths": {"/api/health": {}},
    }
    verifier._scan_safe({"openapi_variants": {"test": {**openapi, "description": "See /api/health, /health, and https://docs.example.test/studio."}}})
    for description in ("Do not expose /home/alice/private.", r"Do not expose C:\\Users\\alice\\private.", r"Do not expose \\server\\share\\private."):
        with pytest.raises(AssertionError):
            verifier._scan_safe({"openapi_variants": {"test": {**openapi, "description": description}}})
    with pytest.raises(AssertionError):
        verifier._scan_safe({"openapi_variants": {"test": {**openapi, "paths": {"/home/alice/private": {}}}}})


def test_contract_schemas_refuse_unreviewed_structural_fields() -> None:
    verifier = _verifier_module()
    fixtures = {
        name: json.loads((ROOT / "docs" / "contracts" / "studio-v1" / "fixtures" / name).read_text())
        for name in ("routes.snapshot.json", "http-openapi.snapshot.json", "websocket.snapshot.json", "behavior.snapshot.json")
    }
    mutated_openapi = copy.deepcopy(fixtures)
    mutated_openapi["http-openapi.snapshot.json"]["unexpected"] = True
    with pytest.raises(AssertionError):
        verifier.validate_fixture_shapes(mutated_openapi)

    mutated_websocket = copy.deepcopy(fixtures)
    emitted = mutated_websocket["websocket.snapshot.json"]["payload_shapes"]["job_started"]
    emitted["data"]["unreviewed"] = True
    with pytest.raises(AssertionError, match="data shape mismatch"):
        verifier.validate_fixture_shapes(mutated_websocket)

    mutated_protocol = copy.deepcopy(fixtures)
    protocol = mutated_protocol["websocket.snapshot.json"]["protocol"]
    protocol["outgoing"]["connected"]["type"] = "pong"
    with pytest.raises(AssertionError, match="outgoing"):
        verifier.validate_fixture_shapes(mutated_protocol)

    mutated_subscribe = copy.deepcopy(fixtures)
    protocol = mutated_subscribe["websocket.snapshot.json"]["protocol"]
    protocol["incoming"]["subscribe"]["channel"] = "job:contract-job"
    with pytest.raises(AssertionError, match="incoming frame"):
        verifier.validate_fixture_shapes(mutated_subscribe)

    mutated_training_subscription = copy.deepcopy(fixtures)
    protocol = mutated_training_subscription["websocket.snapshot.json"]["protocol"]
    protocol["subscription"]["training_endpoint_auto_subscription"]["type"] = "pong"
    with pytest.raises(AssertionError, match="training_endpoint_auto_subscription"):
        verifier.validate_fixture_shapes(mutated_training_subscription)

    mutated_behavior = copy.deepcopy(fixtures)
    mutated_behavior["behavior.snapshot.json"]["workspace_paths"]["body"]["unreviewed"] = True
    with pytest.raises(AssertionError):
        verifier.validate_fixture_shapes(mutated_behavior)

    mutated_transition = copy.deepcopy(fixtures)
    mutated_transition["behavior.snapshot.json"]["jobs"]["transitions"]["running_cancel"]["unreviewed"] = True
    with pytest.raises(AssertionError):
        verifier.validate_fixture_shapes(mutated_transition)

    exceptions = json.loads((ROOT / "docs" / "contracts" / "studio-v1" / "exceptions.json").read_text())
    exceptions["exceptions"][0]["unreviewed"] = True
    with pytest.raises(AssertionError):
        verifier._validate_json("exceptions.schema.json", exceptions, "adversarial exceptions")


def test_exception_ledger_refuses_swapped_scope_or_divergence() -> None:
    verifier = _verifier_module()
    exceptions = json.loads((ROOT / "docs" / "contracts" / "studio-v1" / "exceptions.json").read_text())
    redaction, websocket, openapi = exceptions["exceptions"]

    swapped_scope = copy.deepcopy(exceptions)
    swapped_scope["exceptions"][0]["scope"], swapped_scope["exceptions"][1]["scope"] = websocket["scope"], redaction["scope"]
    with pytest.raises(AssertionError):
        verifier._validate_exception_ledger(swapped_scope)

    swapped_divergence = copy.deepcopy(exceptions)
    swapped_divergence["exceptions"][0]["permitted_divergence"] = openapi["permitted_divergence"]
    with pytest.raises(AssertionError):
        verifier._validate_exception_ledger(swapped_divergence)

    swapped_window = copy.deepcopy(exceptions)
    swapped_window["exceptions"][2]["version_window"] = redaction["version_window"]
    with pytest.raises(AssertionError):
        verifier._validate_exception_ledger(swapped_window)


def test_system_paths_fixture_is_live_capture_with_typed_path_values() -> None:
    behavior = json.loads((ROOT / "docs" / "contracts" / "studio-v1" / "fixtures" / "behavior.snapshot.json").read_text())
    paths = behavior["system_paths"]["body"]["paths"]
    assert set(paths) == {"working_directory", "home_directory", "python_executable"}
    assert paths == {name: {"$dynamic": "path"} for name in paths}


def test_openapi_component_keys_are_native_or_exactly_ledgered() -> None:
    """Only the documented FastAPI collision may differ between variants."""
    verifier = _verifier_module()
    fixture = json.loads((ROOT / "docs" / "contracts" / "studio-v1" / "fixtures" / "http-openapi.snapshot.json").read_text())
    variants = fixture["openapi_variants"]
    pre_keys = set(variants["fastapi-pre-0.139"]["components"]["schemas"])
    plus_keys = set(variants["fastapi-0.139-plus"]["components"]["schemas"])
    assert pre_keys - plus_keys == {"ConfusionMatrixRequest"}
    assert plus_keys - pre_keys == {"api__evaluation__ConfusionMatrixRequest"}

    raw = verifier._load_app().openapi()
    for variant in variants:
        projected = verifier._openapi_variant(raw, variant)
        assert set(projected["components"]["schemas"]) == set(variants[variant]["components"]["schemas"])

    broken = copy.deepcopy(fixture)
    schemas = broken["openapi_variants"]["fastapi-0.139-plus"]["components"]["schemas"]
    schemas["unreviewed_component"] = schemas.pop("api__evaluation__ConfusionMatrixRequest")
    with pytest.raises(AssertionError, match="component key differences"):
        verifier._validate_openapi_semantics(broken)


def test_response_headers_exclude_transport_dynamic_content_length() -> None:
    """Content type is retained while serializer-specific lengths are not frozen."""
    behavior = json.loads((ROOT / "docs" / "contracts" / "studio-v1" / "fixtures" / "behavior.snapshot.json").read_text())
    for response in (
        behavior["errors"]["unmanaged_500"],
        behavior["errors"]["validation_422"],
        behavior["readiness"]["pre_lifespan"]["health"],
        behavior["workspace_paths"],
    ):
        assert response["headers"] == {"content-type": "application/json"}
