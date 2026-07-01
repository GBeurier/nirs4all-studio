"""Read-only preview of nirs4all-tools legacy migration reports."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

REPORT_SCHEMA_ID = "nirs4all-tools/contracts/legacy_migration_report.v1.json"
MANIFEST_SCHEMA_ID = "nirs4all-tools/contracts/legacy_migration_manifest.v1.json"
UNSUPPORTED_REPORT_SCHEMA_ID = "nirs4all-tools/contracts/legacy_unsupported_report.v1.json"
SCHEMA_VERSION = 1
TARGET_KIND = "nirs4all-workspace-v2"
TARGET_SCHEMA_VERSION = 2
MAX_CONTRACT_BYTES = 2 * 1024 * 1024
MAX_TEXT_LENGTH = 2000


class LegacyMigrationPreviewError(ValueError):
    """Raised when a migration contract cannot be previewed safely."""


def _resolve_existing_file(path: str, *, label: str) -> Path:
    candidate = Path(path).expanduser()
    try:
        resolved = candidate.resolve(strict=True)
    except OSError as exc:
        raise FileNotFoundError(f"{label} does not exist: {candidate}") from exc
    if not resolved.is_file():
        raise LegacyMigrationPreviewError(f"{label} is not a file: {resolved}")
    return resolved


def _read_json_object(path: Path, *, label: str) -> dict[str, Any]:
    try:
        if path.stat().st_size > MAX_CONTRACT_BYTES:
            raise LegacyMigrationPreviewError(f"{label} exceeds the {MAX_CONTRACT_BYTES} byte preview limit")
        value: Any = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise LegacyMigrationPreviewError(f"{label} is not valid JSON: {exc.msg}") from exc
    if not isinstance(value, dict):
        raise LegacyMigrationPreviewError(f"{label} must be a JSON object")
    return value


def _validate_contract(document: dict[str, Any], *, label: str, schema_id: str) -> None:
    if document.get("$id") != schema_id:
        raise LegacyMigrationPreviewError(f"{label} has unexpected $id: {document.get('$id')!r}")
    if document.get("schema_version") != SCHEMA_VERSION:
        raise LegacyMigrationPreviewError(f"{label} has unsupported schema_version: {document.get('schema_version')!r}")


def _as_dict(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _as_list(value: Any) -> list[Any]:
    return list(value) if isinstance(value, list) else []


def _safe_str(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    return value[:MAX_TEXT_LENGTH]


def _safe_str_list(value: Any) -> list[str]:
    return [item[:MAX_TEXT_LENGTH] for item in _as_list(value) if isinstance(item, str)]


def _coerce_count(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and math.isfinite(value):
        return int(value)
    return None


def _safe_count_dict(value: Any) -> dict[str, int]:
    counts: dict[str, int] = {}
    for key, raw_count in _as_dict(value).items():
        if not isinstance(key, str):
            continue
        count = _coerce_count(raw_count)
        if count is not None:
            counts[key] = count
    return counts


def _safe_source_summary(value: Any) -> dict[str, Any]:
    source_summary = _as_dict(value)
    return {
        "kinds": _safe_str_list(source_summary.get("kinds")),
        "row_counts": _safe_count_dict(source_summary.get("row_counts")),
        "bundles": _coerce_count(source_summary.get("bundles")) or 0,
        "artifacts": _coerce_count(source_summary.get("artifacts")) or 0,
    }


def _safe_target_summary(value: Any) -> dict[str, Any]:
    target_summary = _as_dict(value)
    path = _safe_str(target_summary.get("path"))
    return {"path": path}


def _safe_verification_summary(value: Any) -> dict[str, Any]:
    verification = _as_dict(value)
    checks: dict[str, dict[str, str | None]] = {}
    for name, raw_check in _as_dict(verification.get("checks")).items():
        if not isinstance(name, str):
            continue
        check = _as_dict(raw_check)
        checks[name] = {"status": _safe_str(check.get("status"))}
    passed = verification.get("passed")
    return {
        "ran": bool(verification.get("ran", False)),
        "passed": passed if isinstance(passed, bool) or passed is None else None,
        "checks": checks,
        "mismatches": _coerce_count(verification.get("mismatches")) or 0,
    }


def _safe_errors(value: Any) -> list[dict[str, str | None]]:
    errors: list[dict[str, str | None]] = []
    for item in _as_list(value):
        raw_error = _as_dict(item)
        if not raw_error:
            continue
        errors.append(
            {
                "code": _safe_str(raw_error.get("code")),
                "cause": _safe_str(raw_error.get("cause")),
                "message": _safe_str(raw_error.get("message")),
                "mitigation": _safe_str(raw_error.get("mitigation")),
            }
        )
    return errors


def _validate_target_kind(target: dict[str, Any], *, label: str) -> None:
    if target.get("kind") != TARGET_KIND:
        raise LegacyMigrationPreviewError(f"{label} target.kind must be {TARGET_KIND!r}")


def _validate_target_schema_version(target: dict[str, Any], *, label: str) -> None:
    _validate_target_kind(target, label=label)
    if target.get("schema_version") != TARGET_SCHEMA_VERSION:
        raise LegacyMigrationPreviewError(f"{label} target.schema_version must be {TARGET_SCHEMA_VERSION}")


def preview_legacy_migration_report(
    *,
    report_path: str,
    unsupported_report_path: str | None = None,
    manifest_path: str | None = None,
) -> dict[str, Any]:
    """Load nirs4all-tools migration contracts and return a UI-safe summary.

    The preview reads only the explicit JSON contract paths supplied by the
    caller. It does not import ``nirs4all_tools``, execute recommended commands,
    inspect preserved payloads, or mutate source/target workspaces.
    """

    resolved_report = _resolve_existing_file(report_path, label="migration report")
    report = _read_json_object(resolved_report, label="migration report")
    _validate_contract(report, label="migration report", schema_id=REPORT_SCHEMA_ID)
    target_summary = _as_dict(report.get("target_summary"))
    _validate_target_kind(target_summary, label="migration report")
    if "schema_version" in target_summary and target_summary.get("schema_version") != TARGET_SCHEMA_VERSION:
        raise LegacyMigrationPreviewError(f"migration report target_summary.schema_version must be {TARGET_SCHEMA_VERSION}")

    manifest: dict[str, Any] | None = None
    if manifest_path is not None:
        resolved_manifest = _resolve_existing_file(manifest_path, label="migration manifest")
        manifest = _read_json_object(resolved_manifest, label="migration manifest")
        _validate_contract(manifest, label="migration manifest", schema_id=MANIFEST_SCHEMA_ID)
        _validate_target_schema_version(_as_dict(manifest.get("target")), label="migration manifest")

    unsupported_report: dict[str, Any] | None = None
    if unsupported_report_path is not None:
        resolved_unsupported = _resolve_existing_file(unsupported_report_path, label="unsupported report")
        unsupported_report = _read_json_object(resolved_unsupported, label="unsupported report")
        _validate_contract(unsupported_report, label="unsupported report", schema_id=UNSUPPORTED_REPORT_SCHEMA_ID)
        _validate_target_schema_version(_as_dict(unsupported_report.get("target")), label="unsupported report")

    target_schema_version_validated = (
        manifest is not None
        or unsupported_report is not None
        or target_summary.get("schema_version") == TARGET_SCHEMA_VERSION
    )
    warnings = _safe_str_list(report.get("warnings"))
    if not target_schema_version_validated:
        warnings.append("target schema version was not validated; provide migration-manifest.json or unsupported-report.json")

    recommended_next_command = report.get("recommended_next_command")
    if recommended_next_command is not None and not isinstance(recommended_next_command, str):
        raise LegacyMigrationPreviewError("migration report recommended_next_command must be a string or null")

    return {
        "status": str(report.get("status", "")),
        "source_summary": _safe_source_summary(report.get("source_summary")),
        "target_summary": _safe_target_summary(target_summary),
        "target_schema_version_validated": target_schema_version_validated,
        "migrated_counts": _safe_count_dict(report.get("migrated_counts")),
        "preserved_counts": _safe_count_dict(report.get("preserved_counts")),
        "unsupported_counts": _safe_count_dict(report.get("unsupported_counts")),
        "verification_summary": _safe_verification_summary(report.get("verification_summary")),
        "errors": _safe_errors(report.get("errors")),
        "warnings": warnings,
        "recommended_next_command": recommended_next_command,
    }
