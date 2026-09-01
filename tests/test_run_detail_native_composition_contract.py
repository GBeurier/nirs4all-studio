"""Differential golden for the native Store-v5 run-detail composition."""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
from typing import Any

import api.runs as _runs_api  # noqa: F401  # initialize the established API import graph
from api.store_adapter import (
    _aggregate_runtime_fields,
    _apply_runtime_fields_to_pipelines,
    _strategy_key_from_reference,
)
from api.workspace.services import _normalize_run_dataset_entries, _resolve_dataset_mapping

FIXTURES = Path(__file__).parents[1] / "sidecar" / "tests" / "fixtures"
CONTRACTS = Path(__file__).parents[1] / "sidecar" / "contracts"


def _compose_fastapi_store_oracle(
    owner_output: dict[str, Any], linked_datasets: list[dict[str, str]]
) -> dict[str, Any]:
    """Apply the current FastAPI adapter policy to Store-owned inputs."""
    run = copy.deepcopy(owner_output["run_detail"])
    splitters = owner_output["pipeline_splitters"]
    first_splitter = next(
        (row["splitter"] for row in splitters if row["splitter"] is not None),
        None,
    )
    inferred: dict[str, Any] = {}
    if first_splitter is not None:
        reference = first_splitter.get("reference")
        splitter_class = first_splitter.get("splitter_class") or reference
        inferred = {
            key: value
            for key, value in {
                "cv_strategy": _strategy_key_from_reference(reference)
                or splitter_class
                or reference,
                "splitter_class": splitter_class,
                "cv_folds": first_splitter.get("n_splits"),
                "random_state": first_splitter.get("random_state"),
                "shuffle": first_splitter.get("shuffle"),
                "test_size": first_splitter.get("test_size"),
                "group_by": first_splitter.get("group_by"),
            }.items()
            if value is not None
        }
    run["config"] = {
        **inferred,
        **{key: value for key, value in run["config"].items() if value is not None},
    }

    for pipeline, splitter_row, runtime_row in zip(
        run["pipelines"],
        splitters,
        owner_output["pipeline_runtime"],
        strict=True,
    ):
        splitter = splitter_row["splitter"]
        pipeline["splitter_class"] = (
            splitter.get("splitter_class") or splitter.get("reference")
            if splitter is not None
            else None
        )
        for field, provenance in owner_output["runtime_column_provenance"].items():
            if provenance == "stored_column":
                pipeline[field] = copy.deepcopy(runtime_row[field])

    runtime = _aggregate_runtime_fields(run["config"], run["pipelines"])
    run.update(runtime)
    _apply_runtime_fields_to_pipelines(run["pipelines"], runtime)

    datasets = _normalize_run_dataset_entries(run["datasets"])
    _resolve_dataset_mapping(datasets, linked_datasets)
    unresolved = [
        str(dataset.get("name") or "")
        for dataset in datasets
        if not dataset.get("linked_dataset_id")
    ]
    run["datasets"] = datasets
    run["rerun_ready"] = not unresolved and bool(run["pipelines"])
    run["unresolved_dataset_names"] = unresolved
    run["results"] = copy.deepcopy(owner_output["results"])
    run["results_count"] = owner_output["results_count"]
    return run


def test_fastapi_oracle_matches_the_native_composition_golden() -> None:
    contract = CONTRACTS / "studio_run_detail_http_v1.json"
    owner_fixture = FIXTURES / "workspace_store_v5_run_detail_http_inputs.response.json"
    assert hashlib.sha256(contract.read_bytes()).hexdigest() == (
        "773ee2bd36e154a9090c8e2978c1f7703eebff68e02c0e3c2dab2ca30eeb0a8d"
    )
    assert hashlib.sha256(owner_fixture.read_bytes()).hexdigest() == (
        "1053274a5d5a900bb3511afc3290c0adae5a1c2b84beacb742fd650f806c19bd"
    )

    owner = json.loads(owner_fixture.read_text(encoding="utf-8"))
    before = copy.deepcopy(owner)
    actual = _compose_fastapi_store_oracle(
        owner,
        [{"id": "linked-corn", "name": "Corn", "path": "/datasets/corn"}],
    )
    expected = json.loads(
        (FIXTURES / "workspace_store_v5_run_detail_composed.response.json").read_text(
            encoding="utf-8"
        )
    )

    assert actual == expected
    assert owner == before
