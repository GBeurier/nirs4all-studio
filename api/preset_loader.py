"""
File-based pipeline preset loader.

Reads YAML/JSON preset files from ``api/presets/`` and exposes them to the
pipelines API. Each preset file is authored in nirs4all's canonical pipeline
format (the same format produced by
``nirs4all.pipeline.config.component_serialization.serialize_component``)
plus webapp-specific metadata fields (``id``, ``task_type``).

The preset's ``pipeline`` block is already the product contract. Runtime,
import, export, and counting now consume that canonical payload through the
backend converter instead of downgrading presets into a legacy editor shape.
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

REQUIRED_PRESET_KEYS = ("id", "name", "description", "task_type", "pipeline")
VALID_TASK_TYPES = {"regression", "classification"}


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

    if data["task_type"] not in VALID_TASK_TYPES:
        raise ValueError(
            f"Preset 'task_type' must be one of {sorted(VALID_TASK_TYPES)}, "
            f"got {data['task_type']!r}"
        )

    if not isinstance(data["pipeline"], list) or not data["pipeline"]:
        raise ValueError("Preset 'pipeline' must be a non-empty list")

    return data


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

    Each entry exposes ``id``, ``name``, ``description``, ``task_type``, and
    an integer ``steps_count``. The full ``pipeline`` block is intentionally
    omitted from the listing — the frontend only renders metadata + a step
    count, and the canonical block can be heavy.

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
        entries.append(
            {
                "id": data["id"],
                "name": data["name"],
                "description": data["description"],
                "task_type": data["task_type"],
                "steps_count": len(data["pipeline"]),
                # Include the canonical pipeline so the frontend can render
                "pipeline": data["pipeline"],
                # the same stats and tree preview it shows for saved pipelines.
            }
        )

    entries.sort(key=lambda e: (e.get("order", 0), e["id"]))
    return entries


def load_preset(preset_id: str) -> dict[str, Any]:
    """Return the parsed preset matching ``preset_id``.

    Raises:
        HTTPException 404: if no preset file declares this id.
        HTTPException 500: if the matched file fails to parse.
    """
    for path in _iter_preset_files():
        try:
            data = _read_preset_file(path)
        except Exception as exc:
            logger.warning("Skipping invalid preset file %s: %s", path.name, exc)
            continue
        if data["id"] == preset_id:
            return data

    raise HTTPException(status_code=404, detail=f"Preset '{preset_id}' not found")
