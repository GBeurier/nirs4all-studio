from __future__ import annotations

import warnings
from copy import deepcopy
from dataclasses import dataclass
from typing import Any

from nirs4all.controllers.splitters.split import (
    get_split_grouping_capability,
    resolve_split_groups,
)

from .pipeline_service import instantiate_operator

CONFLICT_MESSAGE_SUFFIX = (
    "Remove it from the pipeline and use runtime grouping instead. The legacy "
    "'group' alias is deprecated and will be removed in a future release."
)


@dataclass(frozen=True)
class RuntimeGroupingPreparation:
    steps: list[dict[str, Any]]
    warnings: list[str]
    has_splitters: bool
    has_required_splitters: bool
    has_optional_splitters: bool


def normalize_split_group_by_mapping(
    dataset_ids: list[str],
    raw_mapping: dict[str, str | None] | None,
) -> dict[str, str | None]:
    """Normalize runtime group selection payloads for the selected datasets."""
    normalized: dict[str, str | None] = {}
    raw_mapping = raw_mapping or {}
    known_dataset_ids = set(dataset_ids)
    unknown_dataset_ids = sorted(set(raw_mapping) - known_dataset_ids)

    if unknown_dataset_ids:
        formatted = ", ".join(unknown_dataset_ids)
        raise ValueError(
            "split_group_by_by_dataset contains unknown dataset IDs: "
            f"{formatted}"
        )

    for dataset_id in dataset_ids:
        value = raw_mapping.get(dataset_id)
        if value is None:
            normalized[dataset_id] = None
            continue

        if not isinstance(value, str):
            raise ValueError(
                "split_group_by_by_dataset values must be strings or null."
            )

        cleaned = value.strip()
        normalized[dataset_id] = cleaned or None

    return normalized


def prepare_pipeline_steps_with_runtime_grouping(
    steps: list[dict[str, Any]],
    dataset: Any,
    runtime_group_by: str | None,
) -> RuntimeGroupingPreparation:
    """Validate runtime grouping for split steps and inject runtime-only group_by."""
    prepared_steps = deepcopy(steps)
    warning_messages: list[str] = []
    seen_warnings: set[str] = set()
    has_splitters = False
    has_required_splitters = False
    has_optional_splitters = False

    for step in _iter_steps(prepared_steps):
        if step.get("type") != "splitting":
            continue

        has_splitters = True
        step_name = str(step.get("name") or "UnknownSplitter")
        params = step.setdefault("params", {})
        if not isinstance(params, dict):
            raise ValueError(
                f"Splitter step '{step_name}' has invalid params payload."
            )

        if _has_explicit_group_value(params.get("group_by")) or _has_explicit_group_value(
            params.get("group")
        ):
            raise ValueError(
                f"Splitter step '{step_name}' already persists 'group_by' or legacy "
                f"'group'. {CONFLICT_MESSAGE_SUFFIX}"
            )

        try:
            splitter = instantiate_operator(step_name, params, operator_type="splitting")
        except Exception as exc:
            raise ValueError(
                f"Failed to prepare splitter '{step_name}' for runtime grouping: {exc}"
            ) from exc

        if splitter is None:
            raise ValueError(f"Unknown splitting operator '{step_name}'.")

        capability = get_split_grouping_capability(splitter)
        if capability.group_required:
            has_required_splitters = True
        else:
            has_optional_splitters = True

        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            resolved_groups = resolve_split_groups(
                dataset,
                splitter,
                group_by=runtime_group_by,
                ignore_repetition=bool(params.get("ignore_repetition", False)),
            )

        if runtime_group_by is not None:
            params["group_by"] = runtime_group_by

        if resolved_groups.satisfied_by_repetition_only:
            repetition_column = getattr(dataset, "repetition", None)
            message = (
                f"Splitter '{step_name}' requires an effective group. No additional "
                f"'group_by' was selected, so only the configured dataset repetition "
                f"'{repetition_column}' will be used."
            )
            if message not in seen_warnings:
                seen_warnings.add(message)
                warning_messages.append(message)

    return RuntimeGroupingPreparation(
        steps=prepared_steps,
        warnings=warning_messages,
        has_splitters=has_splitters,
        has_required_splitters=has_required_splitters,
        has_optional_splitters=has_optional_splitters,
    )


def _iter_steps(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    collected: list[dict[str, Any]] = []

    def visit(items: list[dict[str, Any]]) -> None:
        for step in items:
            if not isinstance(step, dict):
                continue
            collected.append(step)

            children = step.get("children")
            if isinstance(children, list):
                visit([child for child in children if isinstance(child, dict)])

            branches = step.get("branches")
            if isinstance(branches, list):
                for branch in branches:
                    if isinstance(branch, list):
                        visit([child for child in branch if isinstance(child, dict)])
                    elif isinstance(branch, dict):
                        visit([branch])

    visit(steps)
    return collected


def _has_explicit_group_value(value: Any) -> bool:
    if value is None:
        return False

    if isinstance(value, str):
        return bool(value.strip())

    if isinstance(value, (list, tuple)):
        return any(isinstance(entry, str) and entry.strip() for entry in value)

    return True
