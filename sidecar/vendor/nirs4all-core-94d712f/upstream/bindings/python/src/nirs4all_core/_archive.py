"""Validated native Archive V2/V3 access and callback-free Methods replay.

The Python facade intentionally has no ZIP parser. The optional Rust extension
validates archives and delegates signed package/replay semantics to DAG-ML.
The portable execution surface accepts numeric Methods inputs only; it has no
Python callback or serialized host-model path.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any


class NativeArchiveUnavailableError(RuntimeError):
    """The installed Python facade has no matching native archive bridge."""


def _contract_json(value: Any, label: str) -> str:
    if isinstance(value, bytes):
        try:
            return value.decode("utf-8")
        except UnicodeDecodeError as error:
            raise ValueError(f"{label} bytes must be UTF-8 JSON") from error
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)
    except (TypeError, ValueError) as error:
        raise TypeError(f"{label} must be JSON-compatible") from error


def _native_replay(name: str, version: str) -> Any:
    try:
        from . import _native
    except ImportError as error:  # pragma: no cover - depends on wheel build
        raise NativeArchiveUnavailableError(
            f"Archive {version} replay requires the nirs4all-core native wheel; "
            "install a matching nirs4all-core distribution."
        ) from error
    replay = getattr(_native, name, None)
    if not callable(replay):
        raise NativeArchiveUnavailableError(
            f"The installed nirs4all-core native wheel does not expose Archive {version} replay; "
            "install a matching nirs4all-core distribution."
        )
    return replay


def _decode_replay_outcome(payload: Any, version: str) -> dict[str, Any]:
    if not isinstance(payload, str):
        raise RuntimeError(f"native Archive {version} replay returned a non-JSON payload")
    try:
        outcome = json.loads(payload)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"native Archive {version} replay returned invalid JSON") from error
    if not isinstance(outcome, dict):
        raise RuntimeError(f"native Archive {version} replay returned a non-object outcome")
    return outcome


def read_portable_predictor_package_v2(path: str | Path) -> bytes:
    """Read exact Package V2 bytes from a Rust-validated Archive V2.

    This function neither opens ZIP members in Python nor decodes the package.
    Archive integrity and version dispatch remain owned by ``nirs4all-core``;
    DAG-ML owns the returned package's semantic validation and execution.
    """

    try:
        from . import _native
    except ImportError as error:  # pragma: no cover - depends on wheel build
        raise NativeArchiveUnavailableError(
            "Archive V2 access requires the nirs4all-core native wheel; "
            "install a matching nirs4all-core distribution."
        ) from error

    return bytes(_native.read_portable_predictor_package_v2(str(Path(path))))


def read_portable_refit_package_v3(path: str | Path) -> bytes:
    """Read exact Package V3 refit bytes from a Rust-validated Archive V3.

    This function neither opens ZIP members in Python nor decodes the package.
    Archive integrity and version dispatch remain owned by ``nirs4all-core``;
    DAG-ML owns the returned package's semantic validation and execution.
    """

    try:
        from . import _native
    except ImportError as error:  # pragma: no cover - depends on wheel build
        raise NativeArchiveUnavailableError(
            "Archive V3 access requires the nirs4all-core native wheel; "
            "install a matching nirs4all-core distribution."
        ) from error

    return bytes(_native.read_portable_refit_package_v3(str(Path(path))))


def inspect_methods_archive_v2_predictors(
    path: str | Path,
    *,
    methods_library_path: str | Path,
    methods_library_sha256: str,
) -> list[dict[str, Any]]:
    """Return native predictor descriptors derived from Archive V2 bytes.

    Rust validates the archive and attests the selected libn4m before DAG-ML
    derives each descriptor through Methods' complete N4MM inspection API.
    Historical Archive V2 packages without an embedded descriptor remain
    supported; Python never reconstructs or trusts descriptor metadata.
    """

    inspect = _native_replay("inspect_methods_archive_v2_predictors_json", "V2 inspection")
    payload = inspect(
        str(Path(path)),
        str(Path(methods_library_path)),
        methods_library_sha256,
    )
    if not isinstance(payload, str):
        raise RuntimeError("native Archive V2 inspection returned a non-JSON payload")
    try:
        descriptors = json.loads(payload)
    except json.JSONDecodeError as error:
        raise RuntimeError("native Archive V2 inspection returned invalid JSON") from error
    if not isinstance(descriptors, list) or not all(
        isinstance(descriptor, dict) for descriptor in descriptors
    ):
        raise RuntimeError("native Archive V2 inspection returned an invalid descriptor list")
    return descriptors


def replay_methods_archive_v2(
    path: str | Path,
    request: Any,
    data_envelopes: Any,
    methods_inputs: Any,
    *,
    methods_library_path: str | Path,
    outcome_id: str,
    run_id: str,
    warnings: Any = (),
    diagnostics: Any = None,
) -> dict[str, Any]:
    """Replay a portable Methods Archive V2 without Python model callbacks.

    Rust Core validates and opens the archive before DAG-ML parses the signed
    replay contracts or configures a fresh N4MM runtime. ``methods_inputs`` is
    an exact requirement-keyed map of numeric matrices; callbacks, estimator
    handles, pickle, and joblib sidecars are not accepted by this API.
    """

    replay = _native_replay("replay_methods_archive_v2_json", "V2")
    payload = replay(
        str(Path(path)),
        _contract_json(request, "replay request"),
        _contract_json(data_envelopes, "data envelopes"),
        _contract_json(methods_inputs, "Methods inputs"),
        str(Path(methods_library_path)),
        outcome_id,
        run_id,
        _contract_json(warnings, "warnings"),
        _contract_json({} if diagnostics is None else diagnostics, "diagnostics"),
    )
    return _decode_replay_outcome(payload, "V2")


def predict_methods_archive_v2_matrix(
    path: str | Path,
    sample_ids: list[str],
    x: list[list[float]],
    expected_target_names: list[str],
    *,
    methods_library_path: str | Path,
    methods_library_sha256: str,
    request_id: str,
    outcome_id: str,
    run_id: str,
    warnings: Any = (),
    diagnostics: Any = None,
) -> dict[str, Any]:
    """Execute one closed, attested X-only Archive V2 prediction.

    Core derives every DAG-ML replay contract, requires one finalized output
    binding and one external data requirement, checks sample/target order, and
    loads a private snapshot of the exact SHA-256-addressed libn4m after ABI
    2.5 preflight. Python only transports the host matrix and strict JSON
    result; it cannot select a fallback, fit/refit phase or callback.
    """

    predict = _native_replay("predict_methods_archive_v2_matrix_json", "V2 matrix prediction")
    payload = predict(
        str(Path(path)),
        _contract_json(
            {
                "sample_ids": sample_ids,
                "x": x,
                "expected_target_names": expected_target_names,
                "methods_library_path": str(Path(methods_library_path)),
                "methods_library_sha256": methods_library_sha256,
                "request_id": request_id,
                "outcome_id": outcome_id,
                "run_id": run_id,
                "warnings": warnings,
                "diagnostics": {} if diagnostics is None else diagnostics,
            },
            "Archive V2 matrix prediction request",
        ),
    )
    return _decode_replay_outcome(payload, "V2 matrix prediction")


def replay_methods_archive_v2_conformal_presentation_v1(
    path: str | Path,
    request: Any,
    data_envelopes: Any,
    methods_inputs: Any,
    *,
    methods_library_path: str | Path,
    outcome_id: str,
    run_id: str,
    warnings: Any = (),
    diagnostics: Any = None,
) -> dict[str, Any]:
    """Replay a calibrated Archive V2 into a closed UI presentation.

    The native DAG-ML coordinator computes and validates the complete
    presentation from the package calibration and replay outcome. Python only
    serializes input contracts and decodes the returned JSON object; it does
    not calculate conformal quantiles, bounds, fingerprints, or sample joins.
    """

    replay = _native_replay(
        "replay_methods_archive_v2_conformal_presentation_v1_json", "V2 conformal"
    )
    payload = replay(
        str(Path(path)),
        _contract_json(request, "replay request"),
        _contract_json(data_envelopes, "data envelopes"),
        _contract_json(methods_inputs, "Methods inputs"),
        str(Path(methods_library_path)),
        outcome_id,
        run_id,
        _contract_json(warnings, "warnings"),
        _contract_json({} if diagnostics is None else diagnostics, "diagnostics"),
    )
    return _decode_replay_outcome(payload, "V2 conformal presentation")


def replay_methods_archive_v3(
    path: str | Path,
    request: Any,
    data_envelopes: Any,
    methods_inputs: Any,
    *,
    methods_library_path: str | Path,
    outcome_id: str,
    run_id: str,
    warnings: Any = (),
    diagnostics: Any = None,
) -> dict[str, Any]:
    """Replay a portable Methods Archive V3 without host controllers.

    The Python surface always supplies an empty supplemental-controller
    registry. A V3 package requiring a Python/plugin controller therefore
    fails closed instead of hydrating a callback or serialized host model.
    """

    replay = _native_replay("replay_methods_archive_v3_json", "V3")
    payload = replay(
        str(Path(path)),
        _contract_json(request, "replay request"),
        _contract_json(data_envelopes, "data envelopes"),
        _contract_json(methods_inputs, "Methods inputs"),
        str(Path(methods_library_path)),
        outcome_id,
        run_id,
        _contract_json(warnings, "warnings"),
        _contract_json({} if diagnostics is None else diagnostics, "diagnostics"),
    )
    return _decode_replay_outcome(payload, "V3")


def write_archive_v2_from_native_payloads(
    path: str | Path,
    manifest: Mapping[str, Any],
    members: Mapping[str, bytes | bytearray | memoryview],
) -> dict[str, str]:
    """Atomically write a native Archive V2 from DAG-ML-assembled bytes.

    This facade owns no ZIP format, member hashing or DAG-ML replay semantics.
    It passes the manifest and exact opaque members to Core, which validates the
    closed Archive V2 contract and refuses existing targets before publishing.
    """

    if not isinstance(manifest, Mapping):
        raise TypeError("Archive V2 manifest must be a mapping")
    payloads: list[tuple[str, bytes]] = []
    for member_path, payload in sorted(members.items()):
        if not isinstance(member_path, str):
            raise TypeError("Archive V2 member paths must be strings")
        if not isinstance(payload, (bytes, bytearray, memoryview)):
            raise TypeError("Archive V2 member payloads must be bytes-like")
        payloads.append((member_path, bytes(payload)))
    try:
        from . import _native
    except ImportError as error:  # pragma: no cover - depends on wheel build
        raise NativeArchiveUnavailableError(
            "Archive V2 access requires the nirs4all-core native wheel; "
            "install a matching nirs4all-core distribution."
        ) from error
    archive_id, archive_sha256 = _native.write_archive_v2_from_native_payloads(
        str(Path(path)), dict(manifest), payloads
    )
    return {"archive_id": str(archive_id), "archive_sha256": str(archive_sha256)}


def write_archive_v3_from_native_payloads(
    path: str | Path,
    manifest: Mapping[str, Any],
    members: Mapping[str, bytes | bytearray | memoryview],
) -> dict[str, str]:
    """Atomically write a native Archive V3 from opaque DAG-ML bytes.

    The aggregate deliberately does not parse the portable refit package or
    its N4MM payload.  It gives the canonical manifest and bytes to Rust Core,
    which validates the closed V3 contract, recomputes inventory hashes and
    publishes only if the destination does not already exist.
    """

    if not isinstance(manifest, Mapping):
        raise TypeError("Archive V3 manifest must be a mapping")
    payloads: list[tuple[str, bytes]] = []
    for member_path, payload in sorted(members.items()):
        if not isinstance(member_path, str):
            raise TypeError("Archive V3 member paths must be strings")
        if not isinstance(payload, (bytes, bytearray, memoryview)):
            raise TypeError("Archive V3 member payloads must be bytes-like")
        payloads.append((member_path, bytes(payload)))
    try:
        from . import _native
    except ImportError as error:  # pragma: no cover - depends on wheel build
        raise NativeArchiveUnavailableError(
            "Archive V3 access requires the nirs4all-core native wheel; "
            "install a matching nirs4all-core distribution."
        ) from error
    archive_id, archive_sha256 = _native.write_archive_v3_from_native_payloads(
        str(Path(path)), dict(manifest), payloads
    )
    return {"archive_id": str(archive_id), "archive_sha256": str(archive_sha256)}
