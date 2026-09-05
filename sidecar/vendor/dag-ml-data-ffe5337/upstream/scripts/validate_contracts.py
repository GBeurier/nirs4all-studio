#!/usr/bin/env python3
"""Validate shared contract artifacts with dag-ml.

The script intentionally uses only the Python standard library so CI can run it
before any project dependency is installed. It validates the published envelope
schema shape, validates the local fixture shape, and compares the sibling schema
copy when a dag-ml checkout is available.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_REL = Path("docs/contracts/coordinator_data_plan_envelope.schema.json")
PREDICT_COHORT_ENVELOPE_V2_SCHEMA_REL = Path(
    "docs/contracts/coordinator_data_plan_envelope.v2.schema.json"
)
FEATURE_FUSION_SCHEMA_REL = Path("docs/contracts/feature_fusion_selector.schema.json")
BRANCH_VIEW_SCHEMA_REL = Path("docs/contracts/coordinator_branch_view.schema.json")
FITTED_ADAPTER_SCHEMA_REL = Path("docs/contracts/fitted_adapter_ref.schema.json")
REPRESENTATION_REGISTRY_REL = Path("docs/contracts/representation_registry.v1.json")
CONFORMANCE_PACK_REL = Path("docs/contracts/conformance_pack.v1.json")
PARITY_ORACLE_REL = Path("docs/contracts/parity_oracle.v1.json")
LOCAL_FIXTURE_REL = Path(
    "examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json"
)
LOCAL_FEATURE_FUSION_FIXTURE_REL = Path(
    "examples/fixtures/oof_campaign/feature_fusion_selector_nir_chem.json"
)
LOCAL_MODEL_INPUT_SPEC_FIXTURE_REL = Path(
    "examples/fixtures/data/model_input_spec_tabular_regressor.json"
)
SHARED_FOLD_SET_FIXTURE_REL = Path("examples/fixtures/shared/fold_set_cv_partition.json")
LOCAL_C_HEADER_REL = Path("crates/dag-ml-data-capi/include/dag_ml_data.h")
SIBLING_FIXTURE_REL = Path("examples/fixtures/data/coordinator_data_plan_envelope_nir.json")
SIBLING_FEATURE_FUSION_FIXTURE_REL = Path(
    "examples/fixtures/data/feature_fusion_selector_nir_chem.json"
)
SIBLING_MODEL_INPUT_SPEC_FIXTURE_REL = Path(
    "examples/fixtures/data/model_input_spec_tabular_regressor.json"
)
SIBLING_C_HEADER_REL = Path("crates/dag-ml-capi/include/dag_ml.h")
LOCAL_SCHEMA_ID = (
    "https://github.com/GBeurier/dag-ml-data/schemas/"
    "coordinator_data_plan_envelope.v1.schema.json"
)
LOCAL_PREDICT_COHORT_ENVELOPE_V2_SCHEMA_ID = (
    "https://github.com/GBeurier/dag-ml-data/schemas/"
    "coordinator_data_plan_envelope.v2.schema.json"
)
LOCAL_FEATURE_FUSION_SCHEMA_ID = (
    "https://github.com/GBeurier/dag-ml-data/schemas/"
    "feature_fusion_selector.v1.schema.json"
)
LOCAL_BRANCH_VIEW_SCHEMA_ID = (
    "https://github.com/GBeurier/dag-ml-data/schemas/"
    "coordinator_branch_view.v1.schema.json"
)
LOCAL_FITTED_ADAPTER_SCHEMA_ID = (
    "https://github.com/GBeurier/dag-ml-data/schemas/"
    "fitted_adapter_ref.v1.schema.json"
)
SIBLING_SCHEMA_ID = (
    "https://github.com/GBeurier/dag-ml/schemas/"
    "coordinator_data_plan_envelope.v1.schema.json"
)
SIBLING_PREDICT_COHORT_ENVELOPE_V2_SCHEMA_ID = (
    "https://github.com/GBeurier/dag-ml/schemas/"
    "coordinator_data_plan_envelope.v2.schema.json"
)
SIBLING_FEATURE_FUSION_SCHEMA_ID = (
    "https://github.com/GBeurier/dag-ml/schemas/"
    "feature_fusion_selector.v1.schema.json"
)
SHA256_RE = re.compile(r"^[0-9A-Fa-f]{64}$")
IDENTIFIER_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")
CONFORMANCE_PACK_ID = "dag-ml.shared.conformance.v1"
PARITY_ORACLE_ID = "dag-ml.nirs4all.parity_oracle.v1"
REQUIRED_PARITY_CASE_IDS = {
    "nirs4all_core_browser_compile_plan",
    "repetition_group_leakage_refusal",
    "controller_registry_selector_parity",
    "branch_merge_oof_refit_replay",
    "python_wheel_facade_integration",
}
SHARED_FOLD_SET_FINGERPRINT = (
    "54d3185d6c628ef0df848828a8d8ae650222a283a78bbd3ab3bc2256f222c05c"
)


class ContractError(RuntimeError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ContractError(message)


def load_json(path: Path) -> Any:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError as exc:
        raise ContractError(f"missing JSON file: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ContractError(f"invalid JSON in {path}: {exc}") from exc


def load_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise ContractError(f"missing text file: {path}") from exc


def require_non_empty_string(value: Any, label: str) -> None:
    require(isinstance(value, str) and bool(value), f"{label} must be a non-empty string")


def require_sha256(value: Any, label: str) -> None:
    require(
        isinstance(value, str) and SHA256_RE.fullmatch(value) is not None,
        f"{label} must be a 64-character hex digest",
    )


def validate_schema_artifact(schema: Any, expected_id: str, label: str) -> None:
    require(isinstance(schema, dict), f"{label} schema must be a JSON object")
    require(
        schema.get("$schema") == "https://json-schema.org/draft/2020-12/schema",
        f"{label} schema must declare Draft 2020-12",
    )
    require(schema.get("$id") == expected_id, f"{label} schema has unexpected $id")
    require(schema.get("type") == "object", f"{label} schema root must be an object")

    required = schema.get("required")
    require(isinstance(required, list), f"{label} schema required list is missing")
    for field in ("schema_version", "schema_fingerprint", "plan_fingerprint", "plan"):
        require(field in required, f"{label} schema does not require `{field}`")

    properties = schema.get("properties")
    require(isinstance(properties, dict), f"{label} schema properties are missing")
    require(
        properties.get("schema_version", {}).get("const") == 1,
        f"{label} schema_version const must be 1",
    )

    defs = schema.get("$defs")
    require(isinstance(defs, dict), f"{label} schema $defs are missing")
    require(
        defs.get("sha256", {}).get("pattern") == "^[0-9A-Fa-f]{64}$",
        f"{label} sha256 definition is not the expected contract",
    )

    relation = defs.get("coordinator_relation")
    require(isinstance(relation, dict), f"{label} relation definition is missing")
    relation_required = relation.get("required")
    require(
        isinstance(relation_required, list)
        and "observation_id" in relation_required
        and "sample_id" in relation_required,
        f"{label} relation must require observation_id and sample_id",
    )
    require(
        relation.get("additionalProperties") is False,
        f"{label} relation must reject unknown identity fields",
    )


def validate_predict_cohort_envelope_v2_schema(
    schema: Any, expected_id: str, label: str
) -> None:
    require(isinstance(schema, dict), f"{label} V2 schema must be a JSON object")
    require(
        schema.get("$schema") == "https://json-schema.org/draft/2020-12/schema",
        f"{label} V2 schema must declare Draft 2020-12",
    )
    require(schema.get("$id") == expected_id, f"{label} V2 schema has unexpected $id")
    require(schema.get("type") == "object", f"{label} V2 schema root must be an object")
    require(
        schema.get("additionalProperties") is False,
        f"{label} V2 envelope root must be closed",
    )
    required = schema.get("required")
    require(isinstance(required, list), f"{label} V2 required list is missing")
    for field in (
        "schema_version",
        "schema_fingerprint",
        "plan_fingerprint",
        "plan",
        "predict_cohort",
    ):
        require(field in required, f"{label} V2 does not require `{field}`")
    properties = schema.get("properties")
    require(isinstance(properties, dict), f"{label} V2 properties are missing")
    require(
        properties.get("schema_version", {}).get("const") == 2,
        f"{label} V2 schema_version const must be 2",
    )
    require(
        properties.get("predict_cohort", {}).get("$ref") == "#/$defs/predict_cohort",
        f"{label} V2 must reference the closed predict_cohort definition",
    )
    defs = schema.get("$defs")
    require(isinstance(defs, dict), f"{label} V2 schema defs are missing")
    cohort = defs.get("predict_cohort")
    require(isinstance(cohort, dict), f"{label} V2 predict_cohort definition is missing")
    require(
        cohort.get("additionalProperties") is False,
        f"{label} V2 predict_cohort must reject unknown fields",
    )
    cohort_required = cohort.get("required")
    require(
        isinstance(cohort_required, list),
        f"{label} V2 predict_cohort required list is missing",
    )
    for field in (
        "role",
        "physical_sample_ids",
        "origin_sample_ids",
        "target_names",
        "relation_fingerprint",
        "relations",
        "data_content_fingerprint",
        "cohort_fingerprint",
    ):
        require(
            field in cohort_required,
            f"{label} V2 predict_cohort does not require `{field}`",
        )
    cohort_properties = cohort.get("properties")
    require(
        isinstance(cohort_properties, dict)
        and cohort_properties.get("role", {}).get("enum")
        == ["external_test", "inference"],
        f"{label} V2 predict_cohort roles must be external_test/inference",
    )
    require(
        cohort_properties.get("relations", {}).get("$ref")
        == "#/$defs/coordinator_relation_set",
        f"{label} V2 predict_cohort must carry closed relation records",
    )
    require(
        isinstance(cohort.get("allOf"), list) and cohort["allOf"],
        f"{label} V2 predict_cohort must distinguish external_test targets from inference",
    )


def validate_feature_fusion_schema_artifact(schema: Any, expected_id: str, label: str) -> None:
    require(isinstance(schema, dict), f"{label} feature-fusion schema must be a JSON object")
    require(
        schema.get("$schema") == "https://json-schema.org/draft/2020-12/schema",
        f"{label} feature-fusion schema must declare Draft 2020-12",
    )
    require(
        schema.get("$id") == expected_id,
        f"{label} feature-fusion schema has unexpected $id",
    )
    require(schema.get("type") == "object", f"{label} feature-fusion root must be an object")
    required = schema.get("required")
    require(isinstance(required, list), f"{label} feature-fusion required list is missing")
    for field in ("schema_version", "feature_set_id", "sources", "alignment"):
        require(field in required, f"{label} feature-fusion schema does not require `{field}`")
    properties = schema.get("properties")
    require(isinstance(properties, dict), f"{label} feature-fusion properties are missing")
    require(
        properties.get("schema_version", {}).get("const") == 1,
        f"{label} feature-fusion schema_version const must be 1",
    )
    defs = schema.get("$defs")
    require(isinstance(defs, dict), f"{label} feature-fusion $defs are missing")
    for name in ("source", "alignment", "presence_mask", "source_layout"):
        require(name in defs, f"{label} feature-fusion schema misses `{name}` definition")


def validate_branch_view_schema_artifact(schema: Any, expected_id: str, label: str) -> None:
    require(isinstance(schema, dict), f"{label} branch-view schema must be a JSON object")
    require(
        schema.get("$schema") == "https://json-schema.org/draft/2020-12/schema",
        f"{label} branch-view schema must declare Draft 2020-12",
    )
    require(
        schema.get("$id") == expected_id,
        f"{label} branch-view schema has unexpected $id",
    )
    require(schema.get("type") == "object", f"{label} branch-view root must be an object")
    required = schema.get("required")
    require(isinstance(required, list), f"{label} branch-view required list is missing")
    for field in ("view_id", "branch_id", "mode", "selector"):
        require(field in required, f"{label} branch-view schema does not require `{field}`")
    defs = schema.get("$defs")
    require(isinstance(defs, dict), f"{label} branch-view $defs are missing")
    for name in ("branch_view_mode", "branch_view_selector"):
        require(name in defs, f"{label} branch-view schema misses `{name}` definition")
    modes = defs.get("branch_view_mode", {}).get("enum")
    require(
        isinstance(modes, list),
        f"{label} branch-view mode enum is missing",
    )
    for expected in ("separation", "by_source", "by_metadata", "by_tag", "by_filter"):
        require(
            expected in modes,
            f"{label} branch-view mode enum must include `{expected}`",
        )


def validate_fitted_adapter_ref_schema_artifact(
    schema: Any, expected_id: str, label: str
) -> None:
    require(isinstance(schema, dict), f"{label} fitted-adapter schema must be a JSON object")
    require(
        schema.get("$schema") == "https://json-schema.org/draft/2020-12/schema",
        f"{label} fitted-adapter schema must declare Draft 2020-12",
    )
    require(
        schema.get("$id") == expected_id,
        f"{label} fitted-adapter schema has unexpected $id",
    )
    require(schema.get("type") == "object", f"{label} fitted-adapter root must be an object")
    required = schema.get("required")
    require(isinstance(required, list), f"{label} fitted-adapter required list is missing")
    for field in ("adapter_id", "adapter_version", "params_fingerprint"):
        require(field in required, f"{label} fitted-adapter schema does not require `{field}`")
    properties = schema.get("properties")
    require(isinstance(properties, dict), f"{label} fitted-adapter properties are missing")
    require(
        properties.get("schema_version", {}).get("const") == 1,
        f"{label} fitted-adapter schema_version const must be 1",
    )
    defs = schema.get("$defs")
    require(isinstance(defs, dict), f"{label} fitted-adapter $defs are missing")
    for name in ("non_empty_id", "hex_fingerprint", "backend"):
        require(name in defs, f"{label} fitted-adapter schema misses `{name}` definition")
    backends = defs.get("backend", {}).get("enum")
    require(isinstance(backends, list), f"{label} fitted-adapter backend enum is missing")
    for expected in ("joblib", "pickle", "json", "numpy", "onnx", "raw"):
        require(
            expected in backends,
            f"{label} fitted-adapter backend enum must include `{expected}`",
        )


def validate_envelope(envelope: Any, label: str) -> None:
    require(isinstance(envelope, dict), f"{label} envelope must be a JSON object")
    require(envelope.get("schema_version") == 1, f"{label} envelope schema_version must be 1")
    require_sha256(envelope.get("schema_fingerprint"), f"{label} schema_fingerprint")
    require_sha256(envelope.get("plan_fingerprint"), f"{label} plan_fingerprint")
    relation_fingerprint = envelope.get("relation_fingerprint")
    if relation_fingerprint is not None:
        require_sha256(relation_fingerprint, f"{label} relation_fingerprint")
    for field in ("data_content_fingerprint", "target_content_fingerprint"):
        fingerprint = envelope.get(field)
        if fingerprint is not None:
            require_sha256(fingerprint, f"{label} {field}")

    plan = envelope.get("plan")
    require(isinstance(plan, dict), f"{label} plan must be an object")
    require_non_empty_string(plan.get("id"), f"{label} plan.id")
    require(isinstance(plan.get("steps"), list), f"{label} plan.steps must be an array")
    require_non_empty_string(
        plan.get("output_representation"), f"{label} plan.output_representation"
    )

    relations = envelope.get("coordinator_relations")
    if relations is None:
        return
    require(isinstance(relations, dict), f"{label} coordinator_relations must be an object")
    records = relations.get("records")
    require(
        isinstance(records, list) and records,
        f"{label} coordinator_relations.records must be a non-empty array",
    )
    for index, record in enumerate(records):
        record_label = f"{label} coordinator relation #{index}"
        require(isinstance(record, dict), f"{record_label} must be an object")
        require_non_empty_string(record.get("observation_id"), f"{record_label}.observation_id")
        require_non_empty_string(record.get("sample_id"), f"{record_label}.sample_id")
        for field in ("target_id", "group_id", "origin_sample_id", "source_id"):
            value = record.get(field)
            if value is not None:
                require_non_empty_string(value, f"{record_label}.{field}")
        if "is_augmented" in record:
            require(
                isinstance(record["is_augmented"], bool),
                f"{record_label}.is_augmented must be boolean",
            )


def validate_feature_fusion_selector(selector: Any, label: str) -> None:
    require(isinstance(selector, dict), f"{label} selector must be a JSON object")
    require(selector.get("schema_version") == 1, f"{label} selector schema_version must be 1")
    require_non_empty_string(selector.get("feature_set_id"), f"{label}.feature_set_id")
    sources = selector.get("sources")
    require(isinstance(sources, list) and sources, f"{label}.sources must be a non-empty array")
    source_ids: list[str] = []
    for index, source in enumerate(sources):
        source_label = f"{label}.sources[{index}]"
        require(isinstance(source, dict), f"{source_label} must be an object")
        require_non_empty_string(source.get("source_id"), f"{source_label}.source_id")
        require_non_empty_string(source.get("feature_set_id"), f"{source_label}.feature_set_id")
        source_ids.append(source["source_id"])
        columns = source.get("columns")
        if columns is not None:
            require(
                isinstance(columns, list) and columns,
                f"{source_label}.columns must be a non-empty array when present",
            )
            for column_index, column in enumerate(columns):
                require_non_empty_string(column, f"{source_label}.columns[{column_index}]")
    require(len(set(source_ids)) == len(source_ids), f"{label}.sources contain duplicate source ids")

    alignment = selector.get("alignment")
    require(isinstance(alignment, dict), f"{label}.alignment must be an object")
    require(
        alignment.get("mode") in {"inner", "left", "outer"},
        f"{label}.alignment.mode must be inner, left or outer",
    )
    sample_ids = alignment.get("sample_ids")
    require(
        isinstance(sample_ids, list) and sample_ids,
        f"{label}.alignment.sample_ids must be a non-empty array",
    )
    for index, sample_id in enumerate(sample_ids):
        require_non_empty_string(sample_id, f"{label}.alignment.sample_ids[{index}]")
    require(
        len(set(sample_ids)) == len(sample_ids),
        f"{label}.alignment.sample_ids contain duplicates",
    )
    masks = alignment.get("masks")
    require(isinstance(masks, list) and masks, f"{label}.alignment.masks must be non-empty")
    mask_source_ids: list[str] = []
    for index, mask in enumerate(masks):
        mask_label = f"{label}.alignment.masks[{index}]"
        require(isinstance(mask, dict), f"{mask_label} must be an object")
        require_non_empty_string(mask.get("source_id"), f"{mask_label}.source_id")
        mask_source_ids.append(mask["source_id"])
        require(mask.get("sample_ids") == sample_ids, f"{mask_label}.sample_ids order mismatch")
        present = mask.get("present")
        require(
            isinstance(present, list) and len(present) == len(sample_ids),
            f"{mask_label}.present length must match sample_ids",
        )
        for present_index, value in enumerate(present):
            require(isinstance(value, bool), f"{mask_label}.present[{present_index}] must be bool")
    require(set(mask_source_ids) == set(source_ids), f"{label}.alignment masks must match sources")

    policy = selector.get("policy")
    if policy is not None:
        require(isinstance(policy, dict), f"{label}.policy must be an object")
        namespace_columns = policy.get("namespace_columns")
        if namespace_columns is not None:
            require(
                isinstance(namespace_columns, bool),
                f"{label}.policy.namespace_columns must be bool",
            )

    source_layout = selector.get("source_layout")
    if source_layout is not None:
        validate_feature_fusion_source_layout(
            source_layout,
            selector["feature_set_id"],
            sources,
            policy,
            label,
        )


def validate_feature_fusion_source_layout(
    source_layout: Any,
    feature_set_id: str,
    sources: list[Any],
    policy: Any,
    label: str,
) -> None:
    require(isinstance(source_layout, dict), f"{label}.source_layout must be an object")
    require(
        source_layout.get("kind") == "by_source_concat",
        f"{label}.source_layout.kind must be by_source_concat",
    )
    source_order = source_layout.get("source_order")
    require(
        isinstance(source_order, list) and source_order,
        f"{label}.source_layout.source_order must be a non-empty array",
    )
    for index, source_id in enumerate(source_order):
        require_non_empty_string(source_id, f"{label}.source_layout.source_order[{index}]")
    require(
        len(set(source_order)) == len(source_order),
        f"{label}.source_layout.source_order contains duplicates",
    )
    selector_order = [source["source_id"] for source in sources]
    require(
        source_order == selector_order,
        f"{label}.source_layout.source_order must match sources order",
    )

    blocks = source_layout.get("blocks")
    require(
        isinstance(blocks, list) and len(blocks) == len(source_order),
        f"{label}.source_layout.blocks must match source_order length",
    )
    expected_column_start = 0
    for index, block in enumerate(blocks):
        block_label = f"{label}.source_layout.blocks[{index}]"
        require(isinstance(block, dict), f"{block_label} must be an object")
        require(
            block.get("source_id") == source_order[index],
            f"{block_label}.source_id must match source_order",
        )
        preprocessing_output = block.get("preprocessing_output")
        require(
            isinstance(preprocessing_output, dict),
            f"{block_label}.preprocessing_output must be an object",
        )
        require_non_empty_string(
            preprocessing_output.get("feature_set_id"),
            f"{block_label}.preprocessing_output.feature_set_id",
        )
        require_non_empty_string(
            preprocessing_output.get("representation_id"),
            f"{block_label}.preprocessing_output.representation_id",
        )
        source = sources[index]
        require(
            preprocessing_output["feature_set_id"] == source["feature_set_id"],
            f"{block_label}.preprocessing_output.feature_set_id must match source feature_set_id",
        )
        fit_scope = preprocessing_output.get("fit_scope")
        if fit_scope is not None:
            require(
                fit_scope in {"stateless", "fold_train", "full_train", "inference_only"},
                f"{block_label}.preprocessing_output.fit_scope is invalid",
            )
        adapter_id = preprocessing_output.get("adapter_id")
        if adapter_id is not None:
            require_non_empty_string(adapter_id, f"{block_label}.preprocessing_output.adapter_id")
        column_start = block.get("column_start")
        require(
            isinstance(column_start, int) and column_start == expected_column_start,
            f"{block_label}.column_start must be contiguous",
        )
        column_count = block.get("column_count")
        require(
            isinstance(column_count, int) and column_count > 0,
            f"{block_label}.column_count must be a positive integer",
        )
        feature_names = block.get("feature_names")
        if feature_names is not None:
            require(
                isinstance(feature_names, list) and len(feature_names) == column_count,
                f"{block_label}.feature_names length must match column_count",
            )
            require(
                len(set(feature_names)) == len(feature_names),
                f"{block_label}.feature_names contains duplicates",
            )
            for feature_index, feature_name in enumerate(feature_names):
                require_non_empty_string(
                    feature_name,
                    f"{block_label}.feature_names[{feature_index}]",
                )
            columns = source.get("columns")
            if columns is not None:
                require(
                    feature_names == columns,
                    f"{block_label}.feature_names must match source columns",
                )
        expected_column_start += column_count

    concat = source_layout.get("concat")
    require(isinstance(concat, dict), f"{label}.source_layout.concat must be an object")
    require(
        concat.get("feature_set_id") == feature_set_id,
        f"{label}.source_layout.concat.feature_set_id must match selector feature_set_id",
    )
    require_non_empty_string(
        concat.get("representation_id"),
        f"{label}.source_layout.concat.representation_id",
    )
    require(
        concat.get("axis") == "feature",
        f"{label}.source_layout.concat.axis must be feature",
    )
    require(
        concat.get("total_column_count") == expected_column_start,
        f"{label}.source_layout.concat.total_column_count must match block spans",
    )
    require(
        concat.get("preserve_source_order") is True,
        f"{label}.source_layout.concat.preserve_source_order must be true",
    )
    namespace_columns = concat.get("namespace_columns")
    require(
        isinstance(namespace_columns, bool),
        f"{label}.source_layout.concat.namespace_columns must be bool",
    )
    if isinstance(policy, dict) and "namespace_columns" in policy:
        require(
            namespace_columns == policy["namespace_columns"],
            f"{label}.source_layout.concat.namespace_columns must match policy",
        )


def validate_representation_registry(registry: Any, label: str) -> dict[str, dict[str, Any]]:
    require(isinstance(registry, dict), f"{label} representation registry must be an object")
    require(
        registry.get("schema_version") == 1,
        f"{label} representation registry schema_version must be 1",
    )
    require(
        registry.get("registry_id") == "dag-ml-data.representation_registry.v1",
        f"{label} representation registry id mismatch",
    )
    representations = registry.get("representations")
    require(
        isinstance(representations, list) and representations,
        f"{label} representation registry entries must be non-empty",
    )
    by_id: dict[str, dict[str, Any]] = {}
    for index, entry in enumerate(representations):
        entry_label = f"{label}.representations[{index}]"
        require(isinstance(entry, dict), f"{entry_label} must be an object")
        representation_id = entry.get("representation_id")
        require_non_empty_string(representation_id, f"{entry_label}.representation_id")
        require(
            representation_id not in by_id,
            f"{label} duplicate representation `{representation_id}`",
        )
        representation = entry.get("representation")
        require(isinstance(representation, dict), f"{entry_label}.representation must be an object")
        require(
            representation.get("id") == representation_id,
            f"{entry_label}.representation.id mismatch",
        )
        require_non_empty_string(representation.get("type_id"), f"{entry_label}.type_id")
        rank = representation.get("rank")
        require(
            rank is None or (isinstance(rank, int) and rank >= 0),
            f"{entry_label}.rank must be null or non-negative int",
        )
        by_id[representation_id] = representation
    return by_id


def validate_model_input_spec(
    value: Any,
    label: str,
    registry_by_id: dict[str, dict[str, Any]],
) -> None:
    require(isinstance(value, dict), f"{label} ModelInputSpec must be an object")
    schema_version = value.get("schema_version")
    if schema_version is not None:
        require(schema_version == 1, f"{label}.schema_version must be 1 when present")
    ports = value.get("ports")
    require(isinstance(ports, list) and ports, f"{label}.ports must be non-empty")
    seen_ports: set[str] = set()
    for index, port in enumerate(ports):
        port_label = f"{label}.ports[{index}]"
        require(isinstance(port, dict), f"{port_label} must be an object")
        name = port.get("name")
        require_non_empty_string(name, f"{port_label}.name")
        require(name not in seen_ports, f"{label} duplicate port `{name}`")
        seen_ports.add(name)
        accepted_representations = port.get("accepted_representations")
        accepted_types = port.get("accepted_types")
        require(
            isinstance(accepted_representations, list) and accepted_representations,
            f"{port_label}.accepted_representations must be non-empty",
        )
        require(
            isinstance(accepted_types, list) and accepted_types,
            f"{port_label}.accepted_types must be non-empty",
        )
        for accepted_type in accepted_types:
            require_non_empty_string(accepted_type, f"{port_label}.accepted_types[]")
        rank = port.get("rank")
        require(
            rank is None or (isinstance(rank, int) and 0 <= rank <= 16),
            f"{port_label}.rank must be null or an int between 0 and 16",
        )
        for representation_id in accepted_representations:
            require_non_empty_string(
                representation_id,
                f"{port_label}.accepted_representations[]",
            )
            representation = registry_by_id.get(representation_id)
            require(
                representation is not None,
                f"{port_label} accepts unknown representation `{representation_id}`",
            )
            type_id = representation.get("type_id")
            require(
                type_id in accepted_types,
                f"{port_label} representation `{representation_id}` type `{type_id}` is not accepted",
            )
            representation_rank = representation.get("rank")
            if rank is not None and representation_rank is not None:
                require(
                    rank == representation_rank,
                    f"{port_label} rank {rank} does not match representation `{representation_id}` rank {representation_rank}",
                )


def validate_identifier(value: Any, label: str) -> None:
    require(
        isinstance(value, str) and IDENTIFIER_RE.fullmatch(value) is not None,
        f"{label} must be a shared DAG-ML identifier",
    )


def validate_fold_set_fixture(fold_set: Any, label: str) -> None:
    require(isinstance(fold_set, dict), f"{label} fold set must be an object")
    require_non_empty_string(fold_set.get("id"), f"{label}.id")
    sample_ids = fold_set.get("sample_ids")
    require(isinstance(sample_ids, list) and sample_ids, f"{label}.sample_ids must be non-empty")
    for index, sample_id in enumerate(sample_ids):
        validate_identifier(sample_id, f"{label}.sample_ids[{index}]")
    require(len(set(sample_ids)) == len(sample_ids), f"{label}.sample_ids contain duplicates")
    sample_set = set(sample_ids)

    sample_groups = fold_set.get("sample_groups", {})
    require(isinstance(sample_groups, dict), f"{label}.sample_groups must be an object")
    for sample_id, group_id in sample_groups.items():
        require(sample_id in sample_set, f"{label}.sample_groups references unknown sample")
        validate_identifier(group_id, f"{label}.sample_groups[{sample_id}]")
    if sample_groups:
        require(
            set(sample_groups) == sample_set,
            f"{label}.sample_groups must cover every sample when present",
        )

    folds = fold_set.get("folds")
    require(isinstance(folds, list) and folds, f"{label}.folds must be non-empty")
    fold_ids: list[str] = []
    validation_counts = {sample_id: 0 for sample_id in sample_ids}
    for index, fold in enumerate(folds):
        fold_label = f"{label}.folds[{index}]"
        require(isinstance(fold, dict), f"{fold_label} must be an object")
        validate_identifier(fold.get("fold_id"), f"{fold_label}.fold_id")
        fold_ids.append(fold["fold_id"])
        train = fold.get("train_sample_ids")
        validation = fold.get("validation_sample_ids")
        require(isinstance(train, list), f"{fold_label}.train_sample_ids must be an array")
        require(
            isinstance(validation, list) and validation,
            f"{fold_label}.validation_sample_ids must be non-empty",
        )
        for sample_id in train + validation:
            validate_identifier(sample_id, f"{fold_label} sample id")
            require(sample_id in sample_set, f"{fold_label} references unknown sample `{sample_id}`")
        require(len(set(train)) == len(train), f"{fold_label}.train_sample_ids contain duplicates")
        require(
            len(set(validation)) == len(validation),
            f"{fold_label}.validation_sample_ids contain duplicates",
        )
        require(
            set(train).isdisjoint(validation),
            f"{fold_label} has train/validation overlap",
        )
        for sample_id in validation:
            validation_counts[sample_id] += 1
    require(len(set(fold_ids)) == len(fold_ids), f"{label}.fold_id contains duplicates")
    for sample_id, count in validation_counts.items():
        require(
            count == 1,
            f"{label} sample `{sample_id}` appears in validation {count} time(s)",
        )


def canonical_fold_set_fingerprint(fold_set: Any) -> str:
    canonical = copy.deepcopy(fold_set)
    canonical["sample_ids"] = sorted(canonical["sample_ids"])
    canonical["folds"] = sorted(canonical["folds"], key=lambda fold: fold["fold_id"])
    for fold in canonical["folds"]:
        fold["train_sample_ids"] = sorted(fold["train_sample_ids"])
        fold["validation_sample_ids"] = sorted(fold["validation_sample_ids"])
        if fold.get("metadata") == {}:
            fold.pop("metadata")
    if canonical.get("sample_groups") == {}:
        canonical.pop("sample_groups")
    return canonical_json_sha256(canonical)


def validate_data_provider_header(header: str, label: str) -> None:
    require(
        "#define DAG_ML_DATA_PROVIDER_VTABLE_ABI_VERSION 2u" in header,
        f"{label} header must declare DAG_ML_DATA_PROVIDER_VTABLE_ABI_VERSION=2",
    )
    require(
        "#define DAG_ML_DATA_VTABLE_DEFINED" in header,
        f"{label} header must guard the shared DagMlDataVTable definition",
    )
    require(
        "typedef struct DagMlDataVTable" in header,
        f"{label} header must expose DagMlDataVTable",
    )
    for field in (
        "materialize",
        "make_view",
        "view_identity",
        "target_arrow",
        "feature_arrow",
        "release",
        "destroy",
    ):
        require(field in header, f"{label} DagMlDataVTable must expose `{field}`")


def validate_dag_ml_data_tensor_header(header: str, label: str) -> None:
    require(
        "#define DAG_ML_DATA_TENSOR_F64_ABI_VERSION 1u" in header,
        f"{label} header must declare DAG_ML_DATA_TENSOR_F64_ABI_VERSION=1",
    )
    require("DagMlDataTensorF64" in header, f"{label} header must expose DagMlDataTensorF64")
    require(
        "dagmldata_inmemory_provider_feature_collation_tensor_f64_json" in header,
        f"{label} header must expose provider tensor collation",
    )
    require(
        "dagmldata_inmemory_provider_feature_buffer_manifest_json" in header,
        f"{label} header must expose provider feature-buffer manifests",
    )
    require(
        "dagmldata_inmemory_provider_new_with_f64_features_json" in header,
        f"{label} header must expose typed f64 feature provider construction",
    )
    require(
        "DagMlDataFeatureMatrixF64View" in header,
        f"{label} header must expose borrowed f64 feature matrix views",
    )
    require(
        "dagmldata_inmemory_provider_new_with_f64_feature_views" in header,
        f"{label} header must expose borrowed f64 feature matrix provider construction",
    )
    require(
        "dagmldata_inmemory_provider_data_feature_buffer_manifest_json" in header,
        f"{label} header must expose data-handle feature-buffer manifests",
    )
    require(
        "#define DAG_ML_DATA_BORROWED_TENSOR_VIEW_ABI_VERSION 1u" in header,
        f"{label} header must declare DAG_ML_DATA_BORROWED_TENSOR_VIEW_ABI_VERSION=1",
    )
    require(
        "#define DAG_ML_DATA_OWNED_TENSOR_ABI_VERSION 1u" in header,
        f"{label} header must declare DAG_ML_DATA_OWNED_TENSOR_ABI_VERSION=1",
    )
    for symbol in (
        "DagMlDataTensorDType",
        "DagMlDataBorrowedTensorView",
        "DagMlDataOwnedTensor",
        "dagmldata_inmemory_provider_new_with_tensor_views",
        "dagmldata_inmemory_provider_nd_tensor_manifest_json",
        "dagmldata_inmemory_provider_data_nd_tensor_manifest_json",
        "dagmldata_inmemory_provider_nd_tensor_export_json",
        "dagmldata_nd_tensor_free",
    ):
        require(symbol in header, f"{label} header must expose `{symbol}`")


def canonical_json_sha256(value: Any) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def normalize_schema(schema: Any) -> Any:
    normalized = copy.deepcopy(schema)
    if isinstance(normalized, dict):
        normalized.pop("$id", None)
    return normalized


def validate_digest_record(
    record: Any,
    expected_sha256: str,
    expected_kind: str | None,
    expected_schema_version: int | None,
    label: str,
) -> None:
    require(isinstance(record, dict), f"{label} must be an object")
    if expected_kind is not None:
        require(record.get("kind") == expected_kind, f"{label}.kind must be {expected_kind}")
    if expected_schema_version is not None:
        require(
            record.get("schema_version") == expected_schema_version,
            f"{label}.schema_version must be {expected_schema_version}",
        )
    digest = record.get("normalized_sha256", record.get("canonical_json_sha256"))
    require_sha256(digest, f"{label} digest")
    require(digest == expected_sha256, f"{label} digest does not match local artifact")


def validate_conformance_pack(
    pack: Any,
    schema: Any,
    feature_fusion_schema: Any,
    branch_view_schema: Any,
    fitted_adapter_schema: Any,
    parity_oracle: Any,
    representation_registry: Any,
    fixture: Any,
    feature_fusion_fixture: Any,
    model_input_spec_fixture: Any,
    header: str,
    label: str,
) -> None:
    require(isinstance(pack, dict), f"{label} conformance pack must be a JSON object")
    require(pack.get("schema_version") == 1, f"{label} conformance pack schema_version must be 1")
    require(pack.get("pack_id") == CONFORMANCE_PACK_ID, f"{label} conformance pack id mismatch")

    contracts = pack.get("contracts")
    require(isinstance(contracts, dict), f"{label} conformance pack contracts must be an object")
    validate_digest_record(
        contracts.get("coordinator_data_plan_envelope.v1"),
        canonical_json_sha256(normalize_schema(schema)),
        "json_schema",
        1,
        f"{label} coordinator envelope contract",
    )
    validate_digest_record(
        contracts.get("feature_fusion_selector.v1"),
        canonical_json_sha256(normalize_schema(feature_fusion_schema)),
        "json_schema",
        1,
        f"{label} feature fusion selector contract",
    )
    validate_digest_record(
        contracts.get("coordinator_branch_view.v1"),
        canonical_json_sha256(normalize_schema(branch_view_schema)),
        "json_schema",
        1,
        f"{label} coordinator branch view contract",
    )
    validate_digest_record(
        contracts.get("fitted_adapter_ref.v1"),
        canonical_json_sha256(normalize_schema(fitted_adapter_schema)),
        "json_schema",
        1,
        f"{label} fitted adapter ref contract",
    )
    validate_digest_record(
        contracts.get("parity_oracle.v1"),
        canonical_json_sha256(parity_oracle),
        "parity_oracle_manifest",
        1,
        f"{label} parity oracle contract",
    )
    validate_digest_record(
        contracts.get("representation_registry.v1"),
        canonical_json_sha256(representation_registry),
        "representation_registry_manifest",
        1,
        f"{label} representation registry contract",
    )

    fixtures = pack.get("fixtures")
    require(isinstance(fixtures, dict), f"{label} conformance pack fixtures must be an object")
    coordinator_fixture = fixtures.get("coordinator_data_plan_envelope_nir.v1")
    validate_digest_record(
        coordinator_fixture,
        canonical_json_sha256(fixture),
        None,
        None,
        f"{label} coordinator envelope fixture",
    )
    require(
        coordinator_fixture.get("contract") == "coordinator_data_plan_envelope.v1",
        f"{label} coordinator fixture must reference coordinator contract",
    )
    fusion_fixture = fixtures.get("feature_fusion_selector_nir_chem.v1")
    validate_digest_record(
        fusion_fixture,
        canonical_json_sha256(feature_fusion_fixture),
        None,
        None,
        f"{label} feature fusion fixture",
    )
    require(
        fusion_fixture.get("contract") == "feature_fusion_selector.v1",
        f"{label} feature fusion fixture must reference feature fusion contract",
    )
    model_input_record = fixtures.get("model_input_spec_tabular_regressor.v1")
    validate_digest_record(
        model_input_record,
        canonical_json_sha256(model_input_spec_fixture),
        None,
        None,
        f"{label} model input spec fixture",
    )
    require(
        model_input_record.get("contract") == "model_input_spec.v1",
        f"{label} model input fixture must reference model input contract",
    )

    c_abi = pack.get("c_abi")
    require(isinstance(c_abi, dict), f"{label} conformance pack c_abi must be an object")
    require(
        c_abi.get("data_provider_vtable_abi_version") == 2,
        f"{label} provider ABI version must be 2",
    )
    callbacks = c_abi.get("required_provider_callbacks")
    require(isinstance(callbacks, list), f"{label} required callbacks must be a list")
    for callback in (
        "materialize",
        "make_view",
        "view_identity",
        "target_arrow",
        "feature_arrow",
        "release",
        "destroy",
    ):
        require(callback in callbacks, f"{label} conformance pack must require `{callback}`")
        require(callback in header, f"{label} header must expose `{callback}`")
    data_symbols = c_abi.get("required_dag_ml_data_symbols")
    require(isinstance(data_symbols, list), f"{label} dag-ml-data symbols must be a list")
    if "DagMlDataTensorF64" in header:
        require(
            c_abi.get("data_tensor_f64_abi_version") == 1,
            f"{label} f64 tensor ABI version must be 1",
        )
        for symbol in data_symbols:
            require_non_empty_string(symbol, f"{label} dag-ml-data symbol")
            require(symbol in header, f"{label} header must expose `{symbol}`")
    if "DagMlDataTensorF32" in header:
        require(
            c_abi.get("data_tensor_f32_abi_version") == 1,
            f"{label} f32 tensor ABI version must be 1",
        )
    if "DagMlDataBorrowedTensorView" in header:
        require(
            c_abi.get("data_borrowed_tensor_view_abi_version") == 1,
            f"{label} borrowed tensor view ABI version must be 1",
        )
    if "DagMlDataOwnedTensor" in header:
        require(
            c_abi.get("data_owned_tensor_abi_version") == 1,
            f"{label} owned tensor ABI version must be 1",
        )

    cross_repo = pack.get("cross_repo_conformance")
    require(isinstance(cross_repo, dict), f"{label} cross_repo_conformance must be an object")
    required_tests = cross_repo.get("required_when_sibling_checkout_present")
    require(isinstance(required_tests, list), f"{label} cross-repo tests must be a list")
    for test_id in (
        "contracts.schema_and_fixture_equivalence",
        "headers.include_order",
        "provider.f64_predict_replay",
        "fold_set.fingerprint_parity",
        "representation_registry.parity",
        "model_input_spec.fixture_equivalence",
    ):
        require(test_id in required_tests, f"{label} conformance pack must require `{test_id}`")


def validate_parity_oracle_manifest(
    oracle: Any,
    roots_by_repo: dict[str, Path],
    label: str,
) -> None:
    require(isinstance(oracle, dict), f"{label} parity oracle must be a JSON object")
    require(oracle.get("schema_version") == 1, f"{label} parity oracle schema_version must be 1")
    require(oracle.get("oracle_id") == PARITY_ORACLE_ID, f"{label} parity oracle id mismatch")
    require(oracle.get("status") == "producer_handoff", f"{label} parity oracle status mismatch")

    consumer_ledger = oracle.get("consumer_ledger")
    require(isinstance(consumer_ledger, dict), f"{label} parity oracle ledger must be an object")
    require(
        consumer_ledger.get("repo") == "nirs4all",
        f"{label} parity oracle ledger must point to nirs4all",
    )
    require(
        consumer_ledger.get("path") == "docs/compatibility.md",
        f"{label} parity oracle ledger path mismatch",
    )
    require(
        consumer_ledger.get("required_before_bridge") is True,
        f"{label} parity oracle ledger must be required before bridge wiring",
    )

    shared = oracle.get("shared")
    require(isinstance(shared, dict), f"{label} parity oracle shared block must be an object")
    require(
        shared.get("fold_set_fixture_fingerprint") == SHARED_FOLD_SET_FINGERPRINT,
        f"{label} parity oracle shared fold-set fingerprint drifted",
    )

    tolerance_profiles = oracle.get("tolerance_profiles")
    require(
        isinstance(tolerance_profiles, list) and tolerance_profiles,
        f"{label} parity oracle must declare tolerance profiles",
    )
    profile_ids: set[str] = set()
    for index, profile in enumerate(tolerance_profiles):
        profile_label = f"{label} parity oracle tolerance_profiles[{index}]"
        require(isinstance(profile, dict), f"{profile_label} must be an object")
        require(
            isinstance(profile.get("profile_id"), str)
            and IDENTIFIER_RE.fullmatch(profile["profile_id"]),
            f"{profile_label}.profile_id must be a shared identifier",
        )
        require_non_empty_string(profile.get("metric"), f"{profile_label}.metric")
        require_non_empty_string(profile.get("owner"), f"{profile_label}.owner")
        require(
            isinstance(profile.get("absolute_tolerance"), (int, float)),
            f"{profile_label}.absolute_tolerance must be numeric",
        )
        require(
            isinstance(profile.get("relative_tolerance"), (int, float)),
            f"{profile_label}.relative_tolerance must be numeric",
        )
        require(
            profile["profile_id"] not in profile_ids,
            f"{profile_label}.profile_id is duplicated",
        )
        profile_ids.add(profile["profile_id"])

    required_case_ids = oracle.get("required_case_ids")
    require(
        isinstance(required_case_ids, list),
        f"{label} parity oracle required_case_ids must be a list",
    )
    require(
        set(required_case_ids) == REQUIRED_PARITY_CASE_IDS,
        f"{label} parity oracle required_case_ids changed",
    )

    cases = oracle.get("cases")
    require(isinstance(cases, list) and cases, f"{label} parity oracle cases must be non-empty")
    case_ids: set[str] = set()
    for index, case in enumerate(cases):
        case_label = f"{label} parity oracle cases[{index}]"
        require(isinstance(case, dict), f"{case_label} must be an object")
        require(
            isinstance(case.get("case_id"), str) and IDENTIFIER_RE.fullmatch(case["case_id"]),
            f"{case_label}.case_id must be a shared identifier",
        )
        require(case["case_id"] not in case_ids, f"{case_label}.case_id is duplicated")
        case_ids.add(case["case_id"])
        for field in ("ledger_topics", "fixtures", "gates", "invariants"):
            require(
                isinstance(case.get(field), list) and case[field],
                f"{case_label}.{field} must be a non-empty list",
            )
        for topic_index, topic in enumerate(case["ledger_topics"]):
            require_non_empty_string(topic, f"{case_label}.ledger_topics[{topic_index}]")
        for invariant_index, invariant in enumerate(case["invariants"]):
            require_non_empty_string(invariant, f"{case_label}.invariants[{invariant_index}]")
        for fixture_index, fixture in enumerate(case["fixtures"]):
            fixture_label = f"{case_label}.fixtures[{fixture_index}]"
            require(isinstance(fixture, dict), f"{fixture_label} must be an object")
            repo = fixture.get("repo")
            require(repo in {"dag-ml", "dag-ml-data"}, f"{fixture_label}.repo is invalid")
            require_non_empty_string(fixture.get("path"), f"{fixture_label}.path")
            require_non_empty_string(fixture.get("kind"), f"{fixture_label}.kind")
            root = roots_by_repo.get(repo)
            if root is not None:
                require((root / fixture["path"]).is_file(), f"{fixture_label} path is missing")
        for gate_index, gate in enumerate(case["gates"]):
            gate_label = f"{case_label}.gates[{gate_index}]"
            require(isinstance(gate, dict), f"{gate_label} must be an object")
            require(gate.get("repo") in {"dag-ml", "dag-ml-data"}, f"{gate_label}.repo is invalid")
            require_non_empty_string(gate.get("command"), f"{gate_label}.command")
            require_non_empty_string(gate.get("proves"), f"{gate_label}.proves")
    require(case_ids == REQUIRED_PARITY_CASE_IDS, f"{label} parity oracle case set changed")


def extract_function_body(source: str, signature_substring: str, label: str) -> str:
    """Locate a Rust `fn <signature>` and return its body (text between the
    opening `{` and the matching `}`). Used to compare the byte-copied
    `validate_relative_uri` / `validate_relative_artifact_uri` helpers across
    repos: any drift in the rule set is caught here even if the rest of the
    file changes."""
    start = source.find(signature_substring)
    if start == -1:
        raise ContractError(f"{label}: could not locate `{signature_substring}`")
    brace_open = source.find("{", start)
    if brace_open == -1:
        raise ContractError(f"{label}: `{signature_substring}` has no body")
    depth = 0
    for index in range(brace_open, len(source)):
        char = source[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return source[brace_open + 1 : index]
    raise ContractError(f"{label}: unbalanced braces in `{signature_substring}`")


def validate_relative_uri_rule_parity(local_body: str, sibling_body: str) -> None:
    """Assert that both portable-URI validators implement the same rule set.
    The check looks for distinctive code fragments that encode the safety
    rules; if one side adds or removes a rule the check fails before any
    silent divergence reaches users."""
    required_fragments = [
        ("control characters guard", "chars().any(char::is_control)"),
        ("absolute path guard", "starts_with('/')"),
        ("backslash absolute guard", "starts_with('\\\\')"),
        ("drive prefix guard", "is_ascii_alphabetic()"),
        ("scheme guard via first segment", "first_segment.contains(':')"),
        ("traversal guard", 'segment == ".."'),
    ]
    for label, fragment in required_fragments:
        require(
            fragment in local_body,
            f"dag-ml-data validate_relative_uri is missing `{label}` ({fragment!r})",
        )
        require(
            fragment in sibling_body,
            f"dag-ml validate_relative_artifact_uri is missing `{label}` ({fragment!r})",
        )


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--require-sibling",
        action="store_true",
        help="Fail when the sibling dag-ml checkout is not available.",
    )
    parser.add_argument(
        "--sibling-root",
        type=Path,
        default=None,
        help="Explicit dag-ml checkout path; overrides env/default candidates.",
    )
    parser.add_argument(
        "--local-only",
        action="store_true",
        help="Validate only dag-ml-data artifacts and skip sibling dag-ml checks.",
    )
    return parser.parse_args(argv)


def candidate_sibling_roots(explicit_root: Path | None = None) -> list[Path]:
    if explicit_root is not None:
        return [explicit_root.expanduser()]
    candidates = []
    env_path = os.environ.get("DAG_ML_REPO")
    if env_path:
        candidates.append(Path(env_path).expanduser())
    candidates.append(ROOT.parent / "dag-ml")
    candidates.append(ROOT / "external" / "dag-ml")
    return candidates


def sibling_root(explicit_root: Path | None = None) -> Path | None:
    env_path = os.environ.get("DAG_ML_REPO")
    for candidate in candidate_sibling_roots(explicit_root):
        if candidate.exists():
            return candidate.resolve()
    if explicit_root is not None:
        raise ContractError(f"--sibling-root points to a missing checkout: {explicit_root}")
    if env_path:
        raise ContractError(f"DAG_ML_REPO points to a missing checkout: {env_path}")
    return None


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.local_only and args.require_sibling:
            raise ContractError("--local-only cannot be combined with --require-sibling")

        local_schema = load_json(ROOT / SCHEMA_REL)
        local_predict_cohort_envelope_v2_schema = load_json(
            ROOT / PREDICT_COHORT_ENVELOPE_V2_SCHEMA_REL
        )
        local_feature_fusion_schema = load_json(ROOT / FEATURE_FUSION_SCHEMA_REL)
        local_branch_view_schema = load_json(ROOT / BRANCH_VIEW_SCHEMA_REL)
        local_fitted_adapter_schema = load_json(ROOT / FITTED_ADAPTER_SCHEMA_REL)
        local_representation_registry = load_json(ROOT / REPRESENTATION_REGISTRY_REL)
        local_pack = load_json(ROOT / CONFORMANCE_PACK_REL)
        local_parity_oracle = load_json(ROOT / PARITY_ORACLE_REL)
        local_fixture = load_json(ROOT / LOCAL_FIXTURE_REL)
        local_feature_fusion_fixture = load_json(ROOT / LOCAL_FEATURE_FUSION_FIXTURE_REL)
        local_model_input_spec_fixture = load_json(ROOT / LOCAL_MODEL_INPUT_SPEC_FIXTURE_REL)
        local_fold_set_fixture = load_json(ROOT / SHARED_FOLD_SET_FIXTURE_REL)
        local_header = load_text(ROOT / LOCAL_C_HEADER_REL)
        validate_schema_artifact(local_schema, LOCAL_SCHEMA_ID, "dag-ml-data")
        validate_predict_cohort_envelope_v2_schema(
            local_predict_cohort_envelope_v2_schema,
            LOCAL_PREDICT_COHORT_ENVELOPE_V2_SCHEMA_ID,
            "dag-ml-data",
        )
        validate_feature_fusion_schema_artifact(
            local_feature_fusion_schema,
            LOCAL_FEATURE_FUSION_SCHEMA_ID,
            "dag-ml-data",
        )
        validate_branch_view_schema_artifact(
            local_branch_view_schema,
            LOCAL_BRANCH_VIEW_SCHEMA_ID,
            "dag-ml-data",
        )
        validate_fitted_adapter_ref_schema_artifact(
            local_fitted_adapter_schema,
            LOCAL_FITTED_ADAPTER_SCHEMA_ID,
            "dag-ml-data",
        )
        validate_envelope(local_fixture, "dag-ml-data")
        validate_feature_fusion_selector(local_feature_fusion_fixture, "dag-ml-data")
        local_registry_by_id = validate_representation_registry(
            local_representation_registry,
            "dag-ml-data",
        )
        validate_model_input_spec(
            local_model_input_spec_fixture,
            "dag-ml-data",
            local_registry_by_id,
        )
        validate_fold_set_fixture(local_fold_set_fixture, "dag-ml-data shared")
        require(
            canonical_fold_set_fingerprint(local_fold_set_fixture)
            == SHARED_FOLD_SET_FINGERPRINT,
            "dag-ml-data shared fold set fingerprint drifted",
        )
        validate_data_provider_header(local_header, "dag-ml-data")
        validate_dag_ml_data_tensor_header(local_header, "dag-ml-data")
        validate_parity_oracle_manifest(
            local_parity_oracle,
            {"dag-ml-data": ROOT},
            "dag-ml-data",
        )
        validate_conformance_pack(
            local_pack,
            local_schema,
            local_feature_fusion_schema,
            local_branch_view_schema,
            local_fitted_adapter_schema,
            local_parity_oracle,
            local_representation_registry,
            local_fixture,
            local_feature_fusion_fixture,
            local_model_input_spec_fixture,
            local_header,
            "dag-ml-data",
        )

        if args.local_only:
            print("validated dag-ml-data contract locally; sibling dag-ml skipped")
            return 0

        sibling = sibling_root(args.sibling_root)
        if sibling is None:
            if args.require_sibling:
                raise ContractError("sibling dag-ml checkout is required but was not found")
            print("validated dag-ml-data contract; sibling dag-ml checkout not present")
            return 0

        sibling_schema = load_json(sibling / SCHEMA_REL)
        sibling_predict_cohort_envelope_v2_schema = load_json(
            sibling / PREDICT_COHORT_ENVELOPE_V2_SCHEMA_REL
        )
        sibling_feature_fusion_schema = load_json(sibling / FEATURE_FUSION_SCHEMA_REL)
        sibling_pack = load_json(sibling / CONFORMANCE_PACK_REL)
        sibling_parity_oracle = load_json(sibling / PARITY_ORACLE_REL)
        sibling_representation_registry = load_json(sibling / REPRESENTATION_REGISTRY_REL)
        sibling_fixture = load_json(sibling / SIBLING_FIXTURE_REL)
        sibling_feature_fusion_fixture = load_json(
            sibling / SIBLING_FEATURE_FUSION_FIXTURE_REL
        )
        sibling_model_input_spec_fixture = load_json(
            sibling / SIBLING_MODEL_INPUT_SPEC_FIXTURE_REL
        )
        sibling_fold_set_fixture = load_json(sibling / SHARED_FOLD_SET_FIXTURE_REL)
        sibling_header = load_text(sibling / SIBLING_C_HEADER_REL)
        validate_schema_artifact(sibling_schema, SIBLING_SCHEMA_ID, "dag-ml")
        validate_predict_cohort_envelope_v2_schema(
            sibling_predict_cohort_envelope_v2_schema,
            SIBLING_PREDICT_COHORT_ENVELOPE_V2_SCHEMA_ID,
            "dag-ml",
        )
        validate_feature_fusion_schema_artifact(
            sibling_feature_fusion_schema,
            SIBLING_FEATURE_FUSION_SCHEMA_ID,
            "dag-ml",
        )
        validate_envelope(sibling_fixture, "dag-ml")
        validate_feature_fusion_selector(sibling_feature_fusion_fixture, "dag-ml")
        sibling_registry_by_id = validate_representation_registry(
            sibling_representation_registry,
            "dag-ml",
        )
        validate_model_input_spec(
            sibling_model_input_spec_fixture,
            "dag-ml",
            sibling_registry_by_id,
        )
        validate_fold_set_fixture(sibling_fold_set_fixture, "dag-ml shared")
        require(
            canonical_fold_set_fingerprint(sibling_fold_set_fixture)
            == SHARED_FOLD_SET_FINGERPRINT,
            "dag-ml shared fold set fingerprint drifted",
        )
        validate_data_provider_header(sibling_header, "dag-ml")

        local_fitted_adapter_source = load_text(
            ROOT / "crates/dag-ml-data-core/src/fitted_adapter.rs"
        )
        sibling_runtime_source = load_text(
            sibling / "crates/dag-ml-core/src/runtime/prediction_store.rs"
        )
        local_uri_body = extract_function_body(
            local_fitted_adapter_source,
            "fn validate_relative_uri(",
            "dag-ml-data fitted_adapter.rs",
        )
        sibling_uri_body = extract_function_body(
            sibling_runtime_source,
            "fn validate_relative_artifact_uri(",
            "dag-ml runtime/prediction_store.rs",
        )
        validate_relative_uri_rule_parity(local_uri_body, sibling_uri_body)
        # dag-ml does not yet publish a standalone coordinator_branch_view schema —
        # its `branch_view_plan` lives inline in `campaign_spec.schema.json` $defs.
        # When dag-ml publishes a standalone schema, mirror the local
        # `validate_branch_view_schema_artifact` + conformance-pack call here.
        validate_parity_oracle_manifest(
            sibling_parity_oracle,
            {"dag-ml-data": ROOT, "dag-ml": sibling},
            "dag-ml",
        )
        validate_conformance_pack(
            sibling_pack,
            sibling_schema,
            sibling_feature_fusion_schema,
            local_branch_view_schema,
            local_fitted_adapter_schema,
            sibling_parity_oracle,
            sibling_representation_registry,
            sibling_fixture,
            sibling_feature_fusion_fixture,
            sibling_model_input_spec_fixture,
            sibling_header,
            "dag-ml",
        )
        require(
            normalize_schema(local_schema) == normalize_schema(sibling_schema),
            "coordinator envelope schemas diverge beyond repository-specific $id",
        )
        require(
            normalize_schema(local_predict_cohort_envelope_v2_schema)
            == normalize_schema(sibling_predict_cohort_envelope_v2_schema),
            "predict-cohort V2 envelope schemas diverge beyond repository-specific $id",
        )
        require(
            normalize_schema(local_feature_fusion_schema)
            == normalize_schema(sibling_feature_fusion_schema),
            "feature fusion selector schemas diverge beyond repository-specific $id",
        )
        require(
            local_fixture == sibling_fixture,
            "coordinator envelope fixtures diverge",
        )
        require(
            local_feature_fusion_fixture == sibling_feature_fusion_fixture,
            "feature fusion selector fixtures diverge",
        )
        require(
            local_representation_registry == sibling_representation_registry,
            "representation registries diverge",
        )
        require(
            local_model_input_spec_fixture == sibling_model_input_spec_fixture,
            "model input spec fixtures diverge",
        )
        require(
            canonical_fold_set_fingerprint(local_fold_set_fixture)
            == canonical_fold_set_fingerprint(sibling_fold_set_fixture),
            "shared fold set canonical fingerprints diverge",
        )
        require(local_pack == sibling_pack, "shared conformance packs diverge")
        require(local_parity_oracle == sibling_parity_oracle, "parity oracle manifests diverge")
        print(f"validated dag-ml-data contract against dag-ml at {sibling}")
        return 0
    except ContractError as exc:
        print(f"contract validation failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
