#!/usr/bin/env python3
"""Smoke-test the installed dag_ml_data Python wheel."""

from __future__ import annotations

import json
from importlib import metadata
from importlib import resources
from pathlib import Path

import dag_ml_data
from dag_ml_data import _dag_ml_data

SHARED_FOLD_SET_FINGERPRINT = (
    "54d3185d6c628ef0df848828a8d8ae650222a283a78bbd3ab3bc2256f222c05c"
)


def _read(repo: Path, relative: str) -> str:
    return (repo / relative).read_text(encoding="utf-8")


def main() -> None:
    repo = Path(__file__).resolve().parents[1]
    fixture = repo / "examples" / "fixtures" / "oof_campaign"
    schema_json = _read(fixture, "schema_nir_6_samples.json")
    nirs4all_core_schema_json = _read(
        fixture, "schema_nirs4all_core_contract.json"
    )
    model_input_json = _read(fixture, "model_input_tabular_numeric.json")
    registry_json = _read(fixture, "adapter_registry_signal_to_tabular.json")
    relations_json = _read(fixture, "sample_relations_grouped_augmented.json")
    shared_fold_set_json = _read(
        repo, "examples/fixtures/shared/fold_set_cv_partition.json"
    )
    fold_set = {
        "id": "cv.repetition.safe",
        "sample_ids": ["S001", "S002"],
        "folds": [
            {
                "fold_id": "fold:0",
                "train_sample_ids": ["S002"],
                "validation_sample_ids": ["S001"],
            },
            {
                "fold_id": "fold:1",
                "train_sample_ids": ["S001"],
                "validation_sample_ids": ["S002"],
            },
        ],
    }
    fold_set_json = json.dumps(fold_set, sort_keys=True, separators=(",", ":"))
    request_json = json.dumps(
        {"id": "nir-to-tabular", "source_ids": ["nir"]},
        sort_keys=True,
        separators=(",", ":"),
    )

    dag_ml_data.validate_dataset_schema_json(schema_json)
    dag_ml_data.validate_dataset_schema_json(nirs4all_core_schema_json)
    manifest = json.loads(dag_ml_data.contract_manifest_json())
    if dag_ml_data.__version__ != _dag_ml_data.version():
        raise SystemExit("Python facade hides the version of the loaded native extension")
    if metadata.version("dag-ml-data") != _dag_ml_data.version():
        raise SystemExit("installed distribution and loaded native extension versions differ")
    if manifest["crate"] != "dag-ml-data":
        raise SystemExit("contract manifest has wrong crate name")
    if manifest["python_package_version"] != dag_ml_data.version():
        raise SystemExit(
            "contract manifest Python package version does not match package version"
        )
    if "plan_model_input_json" not in manifest["python_exports"]:
        raise SystemExit("contract manifest is missing Python plan export")
    if "plan_model_input_json" not in manifest["wasm_exports"]:
        raise SystemExit("contract manifest is missing WASM plan export")
    if "structured_error_descriptors" not in manifest["capabilities"]:
        raise SystemExit("contract manifest is missing structured error capability")
    if "CoordinatorDataPlanEnvelope" not in manifest["python_facade_exports"]:
        raise SystemExit("contract manifest is missing Python facade envelope export")
    if "dagmldata_coordinator_multi_target_arrow_json" not in manifest["c_abi_symbols"]:
        raise SystemExit("contract manifest is missing multi-target C ABI export")
    if (
        manifest["shared"]["fold_set_fixture_fingerprint"]
        != SHARED_FOLD_SET_FINGERPRINT
    ):
        raise SystemExit("contract manifest shared fold fingerprint drifted")
    dag_ml_data.validate_fold_set_json(fold_set_json)
    dag_ml_data.validate_fold_set_against_sample_relations_json(
        fold_set_json,
        relations_json,
    )
    typed_fold_set = dag_ml_data.FoldSet(fold_set)
    typed_relations = dag_ml_data.SampleRelationTable(relations_json)
    typed_fold_set.validate_against(typed_relations)
    dag_ml_data.validate_fold_set_json(shared_fold_set_json)
    if (
        dag_ml_data.fold_set_fingerprint_json(shared_fold_set_json)
        != SHARED_FOLD_SET_FINGERPRINT
    ):
        raise SystemExit("shared fold set fingerprint drifted")
    if (
        dag_ml_data.FoldSet(shared_fold_set_json).fingerprint()
        != SHARED_FOLD_SET_FINGERPRINT
    ):
        raise SystemExit("typed shared fold set fingerprint drifted")
    fold_fingerprint = dag_ml_data.fold_set_fingerprint_json(fold_set_json)
    if len(fold_fingerprint) != 64:
        raise SystemExit("fold set fingerprint is not a sha256 hex digest")
    reordered_fold_set = {
        **fold_set,
        "sample_ids": list(reversed(fold_set["sample_ids"])),
        "folds": list(reversed(fold_set["folds"])),
    }
    if (
        dag_ml_data.fold_set_fingerprint_json(
            json.dumps(reordered_fold_set, sort_keys=True, separators=(",", ":"))
        )
        != fold_fingerprint
    ):
        raise SystemExit("fold set fingerprint changed after irrelevant reordering")
    invalid_core_schema = json.loads(nirs4all_core_schema_json)
    invalid_core_schema["sources"][0]["shape_contract"]["axis_sizes"]["wavelength"][
        "exact"
    ] = 999
    try:
        dag_ml_data.validate_dataset_schema_json(json.dumps(invalid_core_schema))
    except dag_ml_data.DagMlDataError as error:
        if error.category != "data" or error.code != "data_contract_validation":
            raise SystemExit("DagMlDataError taxonomy attributes drifted")
        descriptor = json.loads(error.descriptor_json)
        if descriptor["context"] != error.context:
            raise SystemExit("DagMlDataError descriptor context does not match attribute")
    else:
        raise SystemExit("invalid nirs4all-core shape_contract was accepted")
    invalid_fold_schema = json.loads(nirs4all_core_schema_json)
    invalid_fold_schema["groups"] = []
    try:
        dag_ml_data.validate_dataset_schema_json(json.dumps(invalid_fold_schema))
    except dag_ml_data.DagMlDataError:
        pass
    else:
        raise SystemExit("invalid nirs4all-core fold group reference was accepted")
    leaking_relations = json.loads(relations_json)
    for row in leaking_relations["rows"]:
        if row["sample_id"] == "S002":
            row["group_id"] = "plant.A"
    try:
        dag_ml_data.validate_fold_set_against_sample_relations_json(
            fold_set_json,
            json.dumps(leaking_relations),
        )
    except dag_ml_data.DagMlDataError:
        pass
    else:
        raise SystemExit("fold set leaking a repetition group was accepted")
    fingerprint = dag_ml_data.dataset_schema_fingerprint_json(schema_json)
    if len(fingerprint) != 64:
        raise SystemExit("schema fingerprint is not a sha256 hex digest")
    lite_fingerprint = dag_ml_data.dataset_schema_fingerprint_json(
        nirs4all_core_schema_json
    )
    if len(lite_fingerprint) != 64:
        raise SystemExit("nirs4all-core schema fingerprint is not a sha256 hex digest")
    plan_json = dag_ml_data.plan_model_input_json(
        schema_json,
        model_input_json,
        registry_json,
        request_json,
    )
    envelope_json = dag_ml_data.build_coordinator_data_plan_envelope_json(
        schema_json,
        plan_json,
    )
    envelope = json.loads(envelope_json)
    if envelope["plan"]["id"] != "nir-to-tabular":
        raise SystemExit("coordinator envelope contains the wrong plan id")
    schema = dag_ml_data.DatasetSchema(schema_json)
    model_input = dag_ml_data.ModelInputSpec(model_input_json)
    registry = dag_ml_data.AdapterRegistry(registry_json)
    typed_plan = dag_ml_data.plan_model_input(
        schema,
        model_input,
        registry,
        {"id": "nir-to-tabular", "source_ids": ["nir"]},
    )
    if typed_plan.fingerprint() != dag_ml_data.data_plan_fingerprint_json(
        typed_plan.json()
    ):
        raise SystemExit("typed data plan fingerprint drifted")
    typed_envelope = dag_ml_data.build_coordinator_data_plan_envelope(
        schema,
        typed_plan,
        typed_relations,
    )
    if typed_envelope.to_dict()["plan"]["id"] != "nir-to-tabular":
        raise SystemExit("typed coordinator envelope contains the wrong plan id")
    if not dag_ml_data.version():
        raise SystemExit("dag_ml_data.version() returned an empty version")
    if dag_ml_data.__version__ != metadata.version("dag-ml-data"):
        raise SystemExit("dag_ml_data.__version__ does not match package metadata")
    if dag_ml_data.version() != dag_ml_data.__version__:
        raise SystemExit("dag_ml_data.version() does not match dag_ml_data.__version__")
    package_root = resources.files("dag_ml_data")
    if not package_root.joinpath("py.typed").is_file():
        raise SystemExit("dag_ml_data wheel is missing py.typed")
    if not package_root.joinpath("__init__.pyi").is_file():
        raise SystemExit("dag_ml_data wheel is missing __init__.pyi")


if __name__ == "__main__":
    main()
