"""Corpus test for the single registry-driven operator resolver (T2.2).

Iterates EVERY operator node in the generated node registry and asserts the
``name -> classPath -> canonical`` round-trip is identical to what the registry
declares.  The registry JSON (``src/data/nodes/definitions`` +
``src/data/nodes/generated``) is the single source of truth: after T2.2 the
backend has exactly one resolver (``api.pipeline_canonical.resolve_class_reference``
/ ``resolve_editor_class_path``) and every adapter delegates to it, so this test
pins the contract the whole resolver surface must preserve.
"""
from __future__ import annotations

import importlib

import pytest

from api.node_registry_loader import load_editor_registry_nodes
from api.pipeline_canonical import (
    resolve_class_reference,
    resolve_editor_class_path,
)

# Operator node types that carry an importable class/function classPath.
_OPERATOR_TYPES = {
    "model",
    "preprocessing",
    "splitting",
    "filter",
    "augmentation",
    "y_processing",
}


def _operator_nodes() -> list[dict]:
    return [
        node
        for node in load_editor_registry_nodes()
        if node.get("type") in _OPERATOR_TYPES and node.get("classPath")
    ]


def _canonical_class_path_for(node_type: str, class_path: str) -> str:
    """The canonical classPath the registry assigns to ``class_path``."""
    by_path = {}
    by_leaf = {}
    for node in load_editor_registry_nodes():
        if node.get("type") != node_type:
            continue
        cp = node.get("classPath")
        if not cp:
            continue
        by_path[cp.lower()] = cp
        by_leaf.setdefault(cp.rsplit(".", 1)[-1].lower(), cp)
    return by_path.get(class_path.lower()) or by_leaf.get(
        class_path.rsplit(".", 1)[-1].lower(), class_path
    )


def _node_ids() -> list[str]:
    return [f"{n.get('type')}:{n.get('name')}" for n in _operator_nodes()]


@pytest.mark.parametrize("node", _operator_nodes(), ids=_node_ids())
def test_name_resolves_to_registry_class_path(node: dict):
    """``name -> classPath`` resolves to the registry's declared classPath."""
    node_type = node["type"]
    name = node["name"]
    expected = node["classPath"]

    resolved = resolve_editor_class_path(node_type, name, None)
    assert resolved == expected


@pytest.mark.parametrize("node", _operator_nodes(), ids=_node_ids())
def test_class_path_round_trips_to_canonical(node: dict):
    """``classPath -> {name, type, classPath}`` round-trips to the same classPath."""
    node_type = node["type"]
    expected_class_path = node["classPath"]

    resolved = resolve_class_reference(expected_class_path, forced_type=node_type)
    assert resolved["classPath"] == expected_class_path
    assert resolved["type"] == node_type
    # The resolved name must belong to the same canonical classPath (aliases such
    # as MovingAverage -> SavitzkyGolay collapse onto the canonical node name).
    resolved_class_path = resolve_editor_class_path(
        node_type, resolved["name"], None
    )
    assert _canonical_class_path_for(
        node_type, resolved_class_path
    ) == _canonical_class_path_for(node_type, expected_class_path)


@pytest.mark.parametrize("node", _operator_nodes(), ids=_node_ids())
def test_legacy_class_paths_resolve_to_canonical(node: dict):
    """Every registry ``legacyClassPaths`` entry resolves to the canonical path."""
    node_type = node["type"]
    canonical = node["classPath"]
    for legacy in node.get("legacyClassPaths") or []:
        resolved = resolve_editor_class_path(node_type, node["name"], legacy)
        assert resolved == canonical, (
            f"legacy path {legacy!r} for {node['name']!r} resolved to "
            f"{resolved!r}, expected {canonical!r}"
        )


def test_registry_class_paths_are_importable():
    """Registry classPaths import to a real attribute (skipping optional deps).

    A missing optional package (xgboost, lightgbm, tabpfn, torch, tensorflow,
    ikpls, ...) is allowed; a classPath that points at a nonexistent attribute
    inside an installed module is not.
    """
    failures: list[str] = []
    for node in _operator_nodes():
        class_path = node["classPath"]
        module_path, _, attr = class_path.rpartition(".")
        if not module_path:
            continue
        try:
            module = importlib.import_module(module_path)
        except ImportError:
            # Optional third-party dependency not installed in this env.
            continue
        if getattr(module, attr, None) is None:
            failures.append(f"{node.get('type')}:{node['name']} -> {class_path}")

    assert not failures, "registry classPaths missing in installed modules:\n" + "\n".join(
        failures
    )
