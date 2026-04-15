"""
File-based pipeline preset loader.

Reads YAML/JSON preset files from ``api/presets/`` and exposes them to the
pipelines API. Each preset file is authored in nirs4all's canonical pipeline
format (the same format produced by
``nirs4all.pipeline.config.component_serialization.serialize_component``)
plus webapp-specific metadata fields (``id``, ``default_variant`` and
``variants``).

The loader still accepts the legacy single-``pipeline`` format and normalizes
it into a single-variant preset, but the current contract exposes a
``variants`` mapping so the UI can offer regression and classification entries
independently.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import yaml
from fastapi import HTTPException

from .shared.logger import get_logger

logger = get_logger(__name__)

PRESETS_DIR = Path(__file__).parent / "presets"

REQUIRED_PRESET_KEYS = ("id", "name", "description")
VALID_PRESET_VARIANTS = {"regression", "classification"}
VALID_PRESET_FORMATS = {"json", "yaml", "yml"}
DEFAULT_PRESET_VARIANT = "regression"


def _normalize_variant_name(value: Any) -> str:
    """Return a normalized preset variant identifier."""
    return str(value).strip().lower()


def _normalize_variant_payload(raw: Any, *, preset_id: str, variant_name: str) -> dict[str, Any]:
    """Normalize one preset variant payload into ``{"format", "pipeline"}``."""
    format_name = "yaml"
    pipeline: Any = None

    if isinstance(raw, list):
        pipeline = raw
    elif isinstance(raw, dict):
        format_name = _normalize_variant_name(raw.get("format") or raw.get("file_format") or "yaml")
        pipeline = raw.get("pipeline", raw.get("steps"))
    else:
        raise ValueError(
            f"Preset '{preset_id}' variant '{variant_name}' must be a list or mapping"
        )

    if format_name == "yml":
        format_name = "yaml"
    if format_name not in VALID_PRESET_FORMATS:
        raise ValueError(
            f"Preset '{preset_id}' variant '{variant_name}' has unsupported format {format_name!r}"
        )

    if not isinstance(pipeline, list) or not pipeline:
        raise ValueError(
            f"Preset '{preset_id}' variant '{variant_name}' must contain a non-empty pipeline list"
        )

    return {
        "format": format_name,
        "pipeline": pipeline,
    }


def _normalize_preset_data(data: dict[str, Any], *, source_name: str) -> dict[str, Any]:
    """Normalize a preset file into the current preset contract."""
    normalized: dict[str, Any] = dict(data)
    normalized_variants: dict[str, dict[str, Any]] = {}

    raw_variants = data.get("variants")
    if isinstance(raw_variants, dict) and raw_variants:
        for raw_variant_name, raw_variant_payload in raw_variants.items():
            variant_name = _normalize_variant_name(raw_variant_name)
            if variant_name not in VALID_PRESET_VARIANTS:
                raise ValueError(
                    f"Preset '{source_name}' declares unsupported variant {variant_name!r}"
                )
            normalized_variants[variant_name] = _normalize_variant_payload(
                raw_variant_payload,
                preset_id=str(data.get("id", source_name)),
                variant_name=variant_name,
            )
    elif "pipeline" in data:
        variant_name = _normalize_variant_name(data.get("default_variant") or data.get("task_type") or DEFAULT_PRESET_VARIANT)
        if variant_name not in VALID_PRESET_VARIANTS:
            variant_name = DEFAULT_PRESET_VARIANT
        normalized_variants[variant_name] = _normalize_variant_payload(
            {
                "format": data.get("format", "yaml"),
                "pipeline": data["pipeline"],
            },
            preset_id=str(data.get("id", source_name)),
            variant_name=variant_name,
        )
    else:
        raise ValueError(f"Preset '{source_name}' must define either 'variants' or 'pipeline'")

    if not normalized_variants:
        raise ValueError(f"Preset '{source_name}' does not define any valid variants")

    default_variant = _normalize_variant_name(
        data.get("default_variant") or data.get("task_type") or next(iter(normalized_variants))
    )
    if default_variant not in normalized_variants:
        default_variant = next(iter(normalized_variants))

    normalized["variants"] = normalized_variants
    normalized["available_variants"] = list(normalized_variants.keys())
    normalized["default_variant"] = default_variant
    normalized["task_type"] = default_variant
    normalized["pipeline"] = normalized_variants[default_variant]["pipeline"]
    normalized["format"] = normalized_variants[default_variant]["format"]
    normalized["steps_count"] = len(normalized["pipeline"])
    return normalized


def _read_preset_file(path: Path) -> dict[str, Any]:
    """Parse one preset file (.yaml/.yml/.json) into a dict."""
    suffix = path.suffix.lower()
    with open(path, encoding="utf-8") as f:
        if suffix in (".yaml", ".yml"):
            data = yaml.safe_load(f)
        elif suffix == ".json":
            data = json.load(f)
        else:
            raise ValueError(f"Unsupported preset file extension: {suffix}")

    if not isinstance(data, dict):
        raise ValueError(f"Preset file root must be a mapping, got {type(data).__name__}")

    missing = [k for k in REQUIRED_PRESET_KEYS if k not in data]
    if missing:
        raise ValueError(f"Preset is missing required keys: {missing}")

    return _normalize_preset_data(data, source_name=path.name)


def _iter_preset_files() -> list[Path]:
    """Return all candidate preset files in PRESETS_DIR, sorted by name."""
    if not PRESETS_DIR.exists():
        return []
    files = []
    for path in sorted(PRESETS_DIR.iterdir()):
        if path.is_file() and path.suffix.lower() in (".yaml", ".yml", ".json"):
            if path.name.startswith((".", "_")):
                continue
            files.append(path)
    return files


def list_presets() -> list[dict[str, Any]]:
    """Return all valid presets as listing entries.

    Each entry exposes ``id``, ``name``, ``description``, ``default_variant``,
    ``available_variants``, ``variants``, and a default ``pipeline`` payload
    for preview/stats rendering.

    Files that fail to parse or validate are logged and skipped (the listing
    endpoint must not crash because of one bad file).
    """
    entries: list[dict[str, Any]] = []
    for path in _iter_preset_files():
        try:
            data = _read_preset_file(path)
        except Exception as exc:
            logger.warning("Skipping invalid preset file %s: %s", path.name, exc)
            continue
        selected_variant = data["default_variant"]
        entries.append(
            {
                "id": data["id"],
                "name": data["name"],
                "description": data["description"],
                "task_type": data["task_type"],
                "default_variant": selected_variant,
                "available_variants": data["available_variants"],
                "variants": data["variants"],
                "steps_count": data["steps_count"],
                # Include the default canonical pipeline so the frontend can render
                "pipeline": data["pipeline"],
            }
        )

    entries.sort(key=lambda e: (e.get("order", 0), e["id"]))
    return entries


def load_preset(preset_id: str, variant: str | None = None) -> dict[str, Any]:
    """Return the parsed preset matching ``preset_id``.

    Raises:
        HTTPException 404: if no preset file declares this id.
        HTTPException 400: if the requested variant is unavailable.
        HTTPException 500: if the matched file fails to parse.
    """
    for path in _iter_preset_files():
        try:
            data = _read_preset_file(path)
        except Exception as exc:
            logger.warning("Skipping invalid preset file %s: %s", path.name, exc)
            continue
        if data["id"] == preset_id:
            selected_variant = _normalize_variant_name(
                variant or data["default_variant"]
            )
            if selected_variant not in data["variants"]:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Preset '{preset_id}' does not provide variant '{selected_variant}'"
                    ),
                )
            selected_payload = data["variants"][selected_variant]
            return {
                "id": data["id"],
                "name": data["name"],
                "description": data["description"],
                "task_type": selected_variant,
                "default_variant": data["default_variant"],
                "available_variants": data["available_variants"],
                "variants": data["variants"],
                "variant": selected_variant,
                "format": selected_payload["format"],
                "pipeline": selected_payload["pipeline"],
                "steps_count": len(selected_payload["pipeline"]),
            }

    raise HTTPException(status_code=404, detail=f"Preset '{preset_id}' not found")
