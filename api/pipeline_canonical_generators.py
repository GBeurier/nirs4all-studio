"""Generator conversion helpers for canonical pipeline payloads."""

from __future__ import annotations

import copy
from typing import Any, Callable
from uuid import uuid4

GENERATOR_KEYWORDS = {
    "_or_",
    "_range_",
    "_log_range_",
    "_grid_",
    "_cartesian_",
    "_zip_",
    "_chain_",
    "_sample_",
}

ConvertStepToEditor = Callable[[Any], dict[str, Any]]


def _step_id() -> str:
    return f"step-{uuid4().hex[:12]}"


def _clone_value(value: Any) -> Any:
    return copy.deepcopy(value)


def _create_no_op_editor_step() -> dict[str, Any]:
    return {
        "id": _step_id(),
        "type": "utility",
        "name": "NoOp",
        "params": {},
        "isNoOp": True,
        "rawNirs4all": None,
    }


def _passthrough_generator_step(
    raw_step: Any,
    *,
    name: str,
    generator_kind: str,
) -> dict[str, Any]:
    return {
        "id": _step_id(),
        "type": "flow",
        "subType": "generator",
        "name": name,
        "params": {},
        "rawNirs4all": _clone_value(raw_step),
        "generatorKind": generator_kind,
    }


def _convert_generator_branch_to_editor(
    branch_value: Any,
    *,
    convert_step_to_editor: ConvertStepToEditor,
) -> list[dict[str, Any]]:
    if branch_value is None:
        return [_create_no_op_editor_step()]
    if isinstance(branch_value, list):
        return [convert_step_to_editor(item) for item in branch_value]
    return [convert_step_to_editor(branch_value)]


def _sequence_child_from_steps(steps: list[dict[str, Any]]) -> dict[str, Any]:
    if len(steps) == 1:
        return steps[0]
    return {
        "id": _step_id(),
        "type": "flow",
        "subType": "sequential",
        "name": "Sequential",
        "params": {},
        "children": steps,
    }


def _convert_or_generator_to_editor(
    step: dict[str, Any],
    *,
    convert_step_to_editor: ConvertStepToEditor,
) -> dict[str, Any]:
    alternatives = step.get("_or_") or []
    return {
        "id": _step_id(),
        "type": "flow",
        "subType": "generator",
        "name": "Or",
        "params": {},
        "branches": [
            _convert_generator_branch_to_editor(
                item,
                convert_step_to_editor=convert_step_to_editor,
            )
            for item in alternatives
        ],
        "generatorKind": "or",
        "generatorOptions": {
            "pick": step.get("pick"),
            "arrange": step.get("arrange"),
            "then_pick": step.get("then_pick"),
            "then_arrange": step.get("then_arrange"),
            "count": step.get("count"),
        },
    }


def _convert_cartesian_generator_to_editor(
    step: dict[str, Any],
    *,
    convert_step_to_editor: ConvertStepToEditor,
) -> dict[str, Any]:
    stages = step.get("_cartesian_") or []
    params = {"_seed_": step.get("_seed_")} if "_seed_" in step else {}
    return {
        "id": _step_id(),
        "type": "flow",
        "subType": "generator",
        "name": "Cartesian",
        "params": params,
        "branches": [
            _convert_generator_branch_to_editor(
                stage,
                convert_step_to_editor=convert_step_to_editor,
            )
            for stage in stages
        ],
        "generatorKind": "cartesian",
        "generatorOptions": {
            "pick": step.get("pick"),
            "arrange": step.get("arrange"),
            "count": step.get("count"),
        },
    }


def _convert_chain_generator_to_editor(
    step: dict[str, Any],
    *,
    convert_step_to_editor: ConvertStepToEditor,
) -> dict[str, Any]:
    configs = step.get("_chain_") or []
    params = {"_seed_": step.get("_seed_")} if "_seed_" in step else {}
    return {
        "id": _step_id(),
        "type": "flow",
        "subType": "generator",
        "name": "Chain",
        "params": params,
        "branches": [
            _convert_generator_branch_to_editor(
                config,
                convert_step_to_editor=convert_step_to_editor,
            )
            for config in configs
        ],
        "generatorKind": "chain",
        "generatorOptions": {"count": step.get("count")},
    }


def _convert_scalar_generator_to_editor(
    step: dict[str, Any],
    *,
    kind: str,
) -> dict[str, Any]:
    params = {"_seed_": step.get("_seed_")} if "_seed_" in step else {}
    generator_options = {"count": step.get("count")} if step.get("count") is not None else {}

    if kind in {"grid", "zip"}:
        payload = step.get(f"_{kind}_")
        if not isinstance(payload, dict):
            return _passthrough_generator_step(
                step,
                name=kind.capitalize(),
                generator_kind=kind,
            )
        entries = [
            {
                "id": _step_id(),
                "key": str(param_name),
                "values": _clone_value(values if isinstance(values, list) else [values]),
            }
            for param_name, values in payload.items()
        ]
        return {
            "id": _step_id(),
            "type": "flow",
            "subType": "generator",
            "name": "Grid" if kind == "grid" else "Zip",
            "params": params,
            "generatorKind": kind,
            "generatorOptions": generator_options,
            "scalarGeneratorConfig": {"entries": entries},
        }

    payload = step.get("_sample_")
    if not isinstance(payload, dict):
        return _passthrough_generator_step(
            step,
            name="Sample",
            generator_kind="sample",
        )
    return {
        "id": _step_id(),
        "type": "flow",
        "subType": "generator",
        "name": "Sample",
        "params": params,
        "generatorKind": "sample",
        "generatorOptions": generator_options,
        "scalarGeneratorConfig": {"sample": _clone_value(payload)},
    }
