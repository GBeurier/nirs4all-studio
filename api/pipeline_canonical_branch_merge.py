"""Branch and merge conversion helpers for canonical pipeline payloads."""

from __future__ import annotations

import copy
from typing import Any, Callable
from uuid import uuid4

SEPARATION_BRANCH_KEYS = ("by_tag", "by_metadata", "by_filter", "by_source")

ConvertStepToEditor = Callable[[Any], dict[str, Any]]
SerializeEditorSteps = Callable[[list[dict[str, Any]]], list[Any]]
EnsureMappingPayload = Callable[[Any], dict[str, Any]]
AppendAttachedComment = Callable[[Any, dict[str, Any]], Any]
PassthroughEditorStep = Callable[..., dict[str, Any]]


def _step_id() -> str:
    return f"step-{uuid4().hex[:12]}"


def _clone_value(value: Any) -> Any:
    return copy.deepcopy(value)


def _is_separation_branch(branch_data: Any) -> bool:
    return (
        isinstance(branch_data, dict)
        and "steps" in branch_data
        and any(
            key in branch_data
            for key in SEPARATION_BRANCH_KEYS
        )
    )


def _branch_value_label(value: Any) -> str:
    if isinstance(value, bool):
        return "True" if value else "False"
    if value is None:
        return "null"
    return str(value)


def _build_separation_branch_name(config: dict[str, Any]) -> str:
    kind = config.get("kind")
    if kind == "by_tag":
        return f"Branch by tag: {config.get('key', '')}".rstrip(": ")
    if kind == "by_metadata":
        return f"Branch by metadata: {config.get('key', '')}".rstrip(": ")
    if kind == "by_source":
        return "Branch by source"
    return "Branch by filter"


def _convert_branch_to_editor(
    step: dict[str, Any],
    *,
    convert_step_to_editor: ConvertStepToEditor,
    passthrough_editor_step: PassthroughEditorStep,
) -> dict[str, Any]:
    branch_data = step.get("branch")
    if _is_separation_branch(branch_data):
        separation_config: dict[str, Any] = {}
        for key in SEPARATION_BRANCH_KEYS:
            if key not in branch_data:
                continue
            separation_config["kind"] = key
            if key in {"by_tag", "by_metadata"}:
                separation_config["key"] = _clone_value(branch_data[key])
            elif key == "by_filter":
                separation_config["filter"] = _clone_value(branch_data[key])
            elif key == "by_source":
                separation_config["enabled"] = bool(branch_data.get("by_source", True))
            break

        separation_steps = branch_data.get("steps")
        branches: list[list[dict[str, Any]]] = []
        branch_metadata: list[dict[str, Any]] = []

        if isinstance(separation_steps, list):
            branches.append([convert_step_to_editor(item) for item in separation_steps])
            branch_metadata.append({"name": "All values"})
            separation_config["sharedSteps"] = True
        elif isinstance(separation_steps, dict):
            for branch_value, branch_steps in separation_steps.items():
                items = branch_steps if isinstance(branch_steps, list) else [branch_steps]
                branches.append([convert_step_to_editor(item) for item in items])
                branch_metadata.append(
                    {
                        "name": _branch_value_label(branch_value),
                        "value": _clone_value(branch_value),
                    }
                )
        else:
            return passthrough_editor_step(
                step,
                name=_build_separation_branch_name(separation_config),
                step_type="flow",
                sub_type="branch",
                extra={"branchMode": "separation"},
            )

        return {
            "id": _step_id(),
            "type": "flow",
            "subType": "branch",
            "name": _build_separation_branch_name(separation_config),
            "params": {},
            "branches": branches,
            "branchMetadata": branch_metadata,
            "branchMode": "separation",
            "separationConfig": separation_config,
        }

    if not isinstance(branch_data, (list, dict)):
        return passthrough_editor_step(step, name="ParallelBranch", step_type="flow", sub_type="branch")

    branches: list[list[dict[str, Any]]] = []
    branch_metadata: list[dict[str, Any]] = []

    if isinstance(branch_data, list):
        for branch_steps in branch_data:
            if not isinstance(branch_steps, list):
                branch_steps = [branch_steps]
            branches.append([convert_step_to_editor(item) for item in branch_steps])
            branch_metadata.append({})
    else:
        for branch_name, branch_steps in branch_data.items():
            items = branch_steps if isinstance(branch_steps, list) else [branch_steps]
            branches.append([convert_step_to_editor(item) for item in items])
            branch_metadata.append({"name": branch_name})

    return {
        "id": _step_id(),
        "type": "flow",
        "subType": "branch",
        "name": "ParallelBranch",
        "params": {},
        "branches": branches,
        "branchMetadata": branch_metadata,
        "branchMode": "duplication",
    }


def _convert_merge_to_editor(
    step: dict[str, Any],
    *,
    passthrough_editor_step: PassthroughEditorStep,
) -> dict[str, Any]:
    merge_value = step.get("merge")
    if isinstance(merge_value, str):
        return {
            "id": _step_id(),
            "type": "flow",
            "subType": "merge",
            "name": "Stacking" if merge_value == "predictions" else "Concatenate",
            "params": {"merge_type": merge_value},
            "mergeConfig": {"mode": merge_value},
        }
    if isinstance(merge_value, dict):
        if "sources" in merge_value:
            known_keys = {"sources", "output_as", "on_missing"}
            editor_step = {
                "id": _step_id(),
                "type": "flow",
                "subType": "merge",
                "name": "Concatenate",
                "params": {"merge_type": "sources"},
                "mergeConfig": {
                    "mode": "sources",
                    "sources": _clone_value(merge_value.get("sources")),
                    "output_as": merge_value.get("output_as"),
                    "on_missing": merge_value.get("on_missing"),
                },
            }
            if any(key not in known_keys for key in merge_value):
                editor_step["rawNirs4all"] = _clone_value(step)
            return editor_step
        editor_step = {
            "id": _step_id(),
            "type": "flow",
            "subType": "merge",
            "name": "Stacking",
            "params": {},
            "mergeConfig": {
                "mode": "predictions",
                "predictions": _clone_value(merge_value.get("predictions")),
                "features": _clone_value(merge_value.get("features")),
                "output_as": merge_value.get("output_as"),
                "on_missing": merge_value.get("on_missing"),
            },
        }
        if any(key not in {"predictions", "features", "output_as", "on_missing"} for key in merge_value):
            editor_step["rawNirs4all"] = _clone_value(step)
        return editor_step
    return passthrough_editor_step(step, name="Merge", step_type="flow", sub_type="merge")


def _convert_editor_branch_to_canonical(
    step: dict[str, Any],
    *,
    ensure_mapping_payload: EnsureMappingPayload,
    serialize_editor_steps: SerializeEditorSteps,
    append_attached_comment: AppendAttachedComment,
) -> dict[str, Any]:
    if step.get("branchMode") == "separation":
        separation_config = ensure_mapping_payload(step.get("separationConfig"))
        separation_kind = str(
            separation_config.get("kind")
            or ensure_mapping_payload(step.get("params")).get("separationKind")
            or "by_tag"
        )
        branch_payload: dict[str, Any] = {}
        if separation_kind in {"by_tag", "by_metadata"}:
            branch_payload[separation_kind] = _clone_value(separation_config.get("key"))
        elif separation_kind == "by_filter":
            branch_payload[separation_kind] = _clone_value(separation_config.get("filter"))
        elif separation_kind == "by_source":
            branch_payload["by_source"] = True

        branches = step.get("branches") or []
        metadata_list = step.get("branchMetadata") or []
        shared_steps = bool(separation_config.get("sharedSteps")) and len(branches) == 1
        if shared_steps:
            branch_payload["steps"] = serialize_editor_steps(branches[0])
        else:
            route_steps: dict[Any, Any] = {}
            for index, branch_steps in enumerate(branches):
                metadata = (
                    ensure_mapping_payload(metadata_list[index])
                    if index < len(metadata_list)
                    else {}
                )
                route_key = metadata.get("value", metadata.get("name", f"branch_{index}"))
                route_steps[route_key] = serialize_editor_steps(branch_steps)
            branch_payload["steps"] = route_steps

        return append_attached_comment({"branch": branch_payload}, step)

    branches = step.get("branches") or []
    if not branches:
        payload: dict[str, Any] = {"branch": {}}
        return append_attached_comment(payload, step)

    metadata_list = step.get("branchMetadata") or []
    has_names = any(isinstance(item, dict) and item.get("name") for item in metadata_list)

    if has_names:
        branch_payload: dict[str, Any] = {}
        for index, branch_steps in enumerate(branches):
            metadata = ensure_mapping_payload(metadata_list[index]) if index < len(metadata_list) else {}
            branch_name = metadata.get("name") or f"branch_{index}"
            branch_payload[str(branch_name)] = serialize_editor_steps(branch_steps)
        payload = {"branch": branch_payload}
    else:
        payload = {"branch": [serialize_editor_steps(branch_steps) for branch_steps in branches]}

    return append_attached_comment(payload, step)


def _convert_editor_merge_to_canonical(
    step: dict[str, Any],
    *,
    ensure_mapping_payload: EnsureMappingPayload,
    append_attached_comment: AppendAttachedComment,
) -> dict[str, Any]:
    merge_config = ensure_mapping_payload(step.get("mergeConfig"))
    if merge_config:
        if merge_config.get("sources") is not None or merge_config.get("mode") == "sources":
            merge_payload: dict[str, Any] = {
                "sources": _clone_value(merge_config.get("sources", "concat"))
            }
            for key in ("output_as", "on_missing"):
                if merge_config.get(key) is not None:
                    merge_payload[key] = _clone_value(merge_config[key])
            return append_attached_comment({"merge": merge_payload}, step)

        if merge_config.get("mode") and not merge_config.get("predictions") and not merge_config.get("features"):
            payload = {"merge": merge_config["mode"]}
            return append_attached_comment(payload, step)

        merge_payload: dict[str, Any] = {}
        for key in ("predictions", "features", "output_as", "on_missing"):
            if merge_config.get(key) is not None:
                merge_payload[key] = _clone_value(merge_config[key])
        payload = {"merge": merge_payload}
        return append_attached_comment(payload, step)

    params = ensure_mapping_payload(step.get("params"))
    if params.get("merge_type") and not params.get("predictions"):
        payload = {"merge": params["merge_type"]}
        return append_attached_comment(payload, step)

    payload = {"merge": _clone_value(params)}
    return append_attached_comment(payload, step)
