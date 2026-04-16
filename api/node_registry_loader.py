"""Shared loader for the editor node registry.

The frontend palette is sourced from the curated JSON definitions under
``src/data/nodes/definitions`` and then extended with canonical-only nodes from
``generated/canonical-registry.json``.  Some older generated artifacts
(``node-reference.json``) are stale for a subset of deep-learning regressors and
do not include all classifier variants, so backend availability checks and
backend-side hydration must not rely on them as the primary source of truth.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

_ROOT_DIR = Path(__file__).resolve().parent.parent
_DEFINITIONS_DIR = _ROOT_DIR / "src" / "data" / "nodes" / "definitions"
_GENERATED_DIR = _ROOT_DIR / "src" / "data" / "nodes" / "generated"


def _normalize_path(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    return normalized or None


def _load_json_nodes(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []

    with open(path, encoding="utf-8") as handle:
        payload = json.load(handle)

    if isinstance(payload, list):
        return [node for node in payload if isinstance(node, dict)]

    if isinstance(payload, dict):
        nodes = payload.get("nodes")
        if isinstance(nodes, list):
            return [node for node in nodes if isinstance(node, dict)]

    return []


def _definition_files() -> list[Path]:
    if not _DEFINITIONS_DIR.exists():
        return []
    return sorted(_DEFINITIONS_DIR.rglob("*.json"))


def _class_path_aliases(node: dict[str, Any]) -> set[str]:
    aliases: set[str] = set()

    normalized_class_path = _normalize_path(node.get("classPath"))
    if normalized_class_path:
        aliases.add(normalized_class_path)

    legacy_paths = node.get("legacyClassPaths")
    if isinstance(legacy_paths, list):
        for legacy_path in legacy_paths:
            normalized = _normalize_path(legacy_path)
            if normalized:
                aliases.add(normalized)

    return aliases


def _type_name_key(node: dict[str, Any]) -> tuple[str, str] | None:
    node_type = str(node.get("type", "") or "").strip().lower()
    name = str(node.get("name", "") or "").strip().lower()
    if not node_type or not name:
        return None
    return (node_type, name)


def _merge_legacy_class_paths(target: dict[str, Any], incoming: dict[str, Any]) -> None:
    target_class_path = _normalize_path(target.get("classPath"))
    merged: list[str] = []
    seen: set[str] = set()

    def register(path: Any) -> None:
        normalized = _normalize_path(path)
        if not normalized or normalized == target_class_path or normalized in seen:
            return
        merged.append(str(path))
        seen.add(normalized)

    for existing in target.get("legacyClassPaths") or []:
        register(existing)

    register(incoming.get("classPath"))
    for incoming_legacy in incoming.get("legacyClassPaths") or []:
        register(incoming_legacy)

    if merged:
        target["legacyClassPaths"] = merged


def _merge_registry_nodes(
    preferred_nodes: list[dict[str, Any]],
    incoming_nodes: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    merged_nodes = [dict(node) for node in preferred_nodes]
    by_id: dict[str, int] = {}
    by_alias: dict[str, int] = {}
    by_type_name: dict[tuple[str, str], int] = {}

    def register(node: dict[str, Any], index: int) -> None:
        node_id = str(node.get("id", "") or "").strip()
        if node_id:
            by_id[node_id] = index

        type_name_key = _type_name_key(node)
        if type_name_key:
            by_type_name[type_name_key] = index

        for alias in _class_path_aliases(node):
            by_alias[alias] = index

    for index, node in enumerate(merged_nodes):
        register(node, index)

    for incoming in incoming_nodes:
        candidate = dict(incoming)
        duplicate_index: int | None = None

        candidate_id = str(candidate.get("id", "") or "").strip()
        if candidate_id and candidate_id in by_id:
            duplicate_index = by_id[candidate_id]

        if duplicate_index is None:
            for alias in _class_path_aliases(candidate):
                if alias in by_alias:
                    duplicate_index = by_alias[alias]
                    break

        if duplicate_index is None:
            type_name_key = _type_name_key(candidate)
            if type_name_key and type_name_key in by_type_name:
                duplicate_index = by_type_name[type_name_key]

        if duplicate_index is not None:
            _merge_legacy_class_paths(merged_nodes[duplicate_index], candidate)
            register(merged_nodes[duplicate_index], duplicate_index)
            continue

        next_index = len(merged_nodes)
        merged_nodes.append(candidate)
        register(candidate, next_index)

    return merged_nodes


@lru_cache(maxsize=1)
def load_editor_registry_nodes() -> list[dict[str, Any]]:
    curated_nodes: list[dict[str, Any]] = []
    for definition_file in _definition_files():
        curated_nodes.extend(_load_json_nodes(definition_file))

    canonical_nodes = _load_json_nodes(_GENERATED_DIR / "canonical-registry.json")
    merged_nodes = _merge_registry_nodes(curated_nodes, canonical_nodes)
    if merged_nodes:
        return merged_nodes

    # Fallback for older checkouts that only carry the legacy generated file.
    return _load_json_nodes(_GENERATED_DIR / "node-reference.json")


@lru_cache(maxsize=1)
def load_editor_registry_reference() -> dict[str, Any]:
    nodes = load_editor_registry_nodes()
    source_files = [
        *_definition_files(),
        _GENERATED_DIR / "canonical-registry.json",
        _GENERATED_DIR / "node-reference.json",
    ]
    existing_files = [path for path in source_files if path.exists()]
    generated_at: str | None = None
    if existing_files:
        latest_mtime = max(path.stat().st_mtime for path in existing_files)
        generated_at = datetime.fromtimestamp(latest_mtime, tz=UTC).isoformat()

    version = "editor-definitions+canonical"
    if not nodes and (_GENERATED_DIR / "node-reference.json").exists():
        version = "node-reference-fallback"

    return {
        "version": version,
        "generatedAt": generated_at,
        "totalNodes": len(nodes),
        "nodes": nodes,
    }
