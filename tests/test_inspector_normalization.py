from __future__ import annotations

import math

from api.inspector_normalization import (
    _build_available_targets,
    _flatten_numeric_params,
    _is_classification_task,
    _matches_task_type_filter,
    _normalize_chain_record,
    _normalize_chain_records,
    _parse_json_like,
)


class MockDataFrame:
    def __init__(self, rows: list[dict]):
        self._rows = rows

    def iter_rows(self, named: bool = False):
        if named:
            yield from self._rows
            return
        for row in self._rows:
            yield tuple(row.values())


class PipelineMetadataStore:
    def __init__(self, rows: list[dict]):
        self._rows = rows
        self.list_pipelines_calls = 0

    def list_pipelines(self):
        self.list_pipelines_calls += 1
        return MockDataFrame(self._rows)


def test_parse_json_like_only_parses_object_and_array_strings() -> None:
    assert _parse_json_like('{"alpha": 0.2, "enabled": true}') == {"alpha": 0.2, "enabled": True}
    assert _parse_json_like(' ["root", "branch"] ') == ["root", "branch"]

    assert _parse_json_like('"plain string"') == '"plain string"'
    assert _parse_json_like("42") == "42"
    assert _parse_json_like("{not-json") == "{not-json"
    assert _parse_json_like({"already": "parsed"}) == {"already": "parsed"}


def test_task_type_filters_match_broad_legacy_scalars() -> None:
    assert _matches_task_type_filter("binary_classification", "classification")
    assert _matches_task_type_filter("multiclass classification", "classification")
    assert _matches_task_type_filter("pls_regression", "regression")
    assert _matches_task_type_filter(" Regression ", "regression")
    assert _matches_task_type_filter("spectral", "spectral")
    assert _matches_task_type_filter("regression", None)

    assert not _matches_task_type_filter("regression", "classification")
    assert not _matches_task_type_filter("classification", "regression")
    assert not _matches_task_type_filter(None, "classification")
    assert not _matches_task_type_filter("spectral", "classification")

    assert _is_classification_task("binary_classification")
    assert _is_classification_task("multiclass classification")
    assert not _is_classification_task("regression")
    assert not _is_classification_task(None)


def test_flatten_numeric_params_preserves_nested_names_and_skips_non_finite_values() -> None:
    params = {
        "alpha": 0.2,
        "max_iter": 100,
        "model": {
            "depth": 4,
            "learning_rate": 0.05,
            "nan_value": math.nan,
            "inf_value": math.inf,
            "label": "fast",
        },
        "weights": [1, 2],
        "none_value": None,
    }

    assert _flatten_numeric_params(params) == {
        "alpha": 0.2,
        "max_iter": 100.0,
        "model.depth": 4.0,
        "model.learning_rate": 0.05,
    }
    assert _flatten_numeric_params({"depth": 2}, prefix="variant") == {"variant.depth": 2.0}
    assert _flatten_numeric_params(["not", "a", "dict"]) == {}


def test_normalize_chain_record_parses_metadata_and_merges_variant_params() -> None:
    record = _normalize_chain_record(
        {
            "chain_id": "chain-1",
            "pipeline_id": "pipe-1",
            "model_step_idx": "2",
            "preprocessings": " SNV | MSC | SNV ",
            "best_params": '{"alpha": 0.3, "n_components": 8}',
            "branch_path": '["root", "model"]',
            "variant_params": '{"result_metadata": {"result_id": "result-1"}, "existing": true, "alpha": 0.05}',
            "score_maps": '{"cv": {"targets": {"protein": {"rmse": 0.31}}}}',
        },
        {
            "pipe-1": {
                "name": "PLS Pipeline",
                "expanded_config": '[{"params": {"ignored": true}}, {"model": {"params": {"alpha": 0.1, "solver": "svd"}}}]',
            }
        },
    )

    assert record["best_params"] == {"alpha": 0.3, "n_components": 8}
    assert record["branch_path"] == ["root", "model"]
    assert record["score_maps"] == {"cv": {"targets": {"protein": {"rmse": 0.31}}}}
    assert record["variant_params"] == {
        "result_metadata": {"result_id": "result-1"},
        "existing": True,
        "alpha": 0.3,
        "solver": "svd",
        "n_components": 8,
    }
    assert record["pipeline_name"] == "PLS Pipeline"
    assert record["preprocessing_steps"] == ["SNV", "MSC"]


def test_normalize_chain_records_loads_pipeline_metadata_once_for_matching_pipelines() -> None:
    store = PipelineMetadataStore(
        [
            {
                "pipeline_id": "pipe-1",
                "name": "Pipeline One",
                "expanded_config": [{"model": {"params": {"alpha": 0.1}}}],
            },
            {
                "pipeline_id": "unrelated",
                "name": "Unrelated",
                "expanded_config": [{"model": {"params": {"ignored": True}}}],
            },
        ]
    )
    df = MockDataFrame(
        [
            {
                "chain_id": "chain-1",
                "pipeline_id": "pipe-1",
                "model_step_idx": 1,
                "preprocessings": "SNV",
                "best_params": '{"alpha": 0.2}',
                "branch_path": None,
            },
            {
                "chain_id": "chain-2",
                "pipeline_id": "pipe-2",
                "model_step_idx": 1,
                "preprocessings": None,
                "best_params": '{"depth": 4}',
                "branch_path": None,
            },
        ]
    )

    records = _normalize_chain_records(store, df)

    assert store.list_pipelines_calls == 1
    assert records[0]["pipeline_name"] == "Pipeline One"
    assert records[0]["variant_params"] == {"alpha": 0.2}
    assert records[1]["pipeline_name"] is None
    assert records[1]["variant_params"] == {"depth": 4}


def test_build_available_targets_uses_result_metadata_dimensions() -> None:
    targets = _build_available_targets(
        [
            {
                "chain_id": "chain-1",
                "variant_params": {
                    "result_metadata": {
                        "target_name": "moisture",
                        "dimensions": {"target_index": 0},
                    },
                },
            },
            {
                "chain_id": "chain-2",
                "variant_params": {
                    "result_metadata": {
                        "target_name": "protein",
                        "dimensions": {"target_index": "1"},
                    },
                },
            },
            {
                "chain_id": "chain-3",
                "variant_params": {
                    "result_metadata": {
                        "target_name": "protein",
                        "target_index": 1,
                    },
                },
            },
        ]
    )

    assert targets == [
        {
            "index": 0,
            "label": "moisture (Target 1)",
            "count": 1,
            "target_names": ["moisture"],
        },
        {
            "index": 1,
            "label": "protein (Target 2)",
            "count": 2,
            "target_names": ["protein"],
        },
    ]


def test_build_available_targets_handles_mixed_names_and_name_only_metadata() -> None:
    targets = _build_available_targets(
        [
            {"variant_params": {"result_metadata": {"target_name": "moisture"}}},
            {"variant_params": {"result_metadata": {"target_name": "protein"}}},
            {"variant_params": {"result_metadata": {"target_index": "not-a-number"}}},
        ]
    )

    assert targets == [
        {
            "index": 0,
            "label": "Target 1 (2 names)",
            "count": 2,
            "target_names": ["moisture", "protein"],
        },
    ]
