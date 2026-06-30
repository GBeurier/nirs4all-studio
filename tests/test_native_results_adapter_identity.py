import json
import re
from pathlib import Path

from api.native_results_adapter import (
    _SCORE_COLUMN_ALIASES,
    _VALID_SCORE_COLUMNS,
    NativeResultsAdapter,
    _native_base_config,
    _native_chain_id,
    _native_prediction_id,
)

ROOT = Path(__file__).resolve().parents[1]


class _FakePredictions:
    def __init__(self, rows):
        self._rows = rows

    def filter_predictions(self, load_arrays=False):
        return [dict(row) for row in self._rows]


def test_native_base_config_strips_refit_suffix() -> None:
    assert _native_base_config("foo_refit") == "foo"
    assert _native_base_config("foo") == "foo"


def test_native_chain_id_joins_run_and_base_config() -> None:
    assert _native_chain_id("run-1", "cfg") == "run-1::cfg"


def test_native_prediction_id_ignores_random_row_id_and_uses_identity_fields() -> None:
    row = {
        "id": "random-a",
        "config_name": "cfg",
        "partition": "validation",
        "fold_id": "fold-1",
    }
    same_identity_row = {
        **row,
        "id": "random-b",
    }

    stable_id = _native_prediction_id("run-1", row)

    assert _native_prediction_id("run-1", same_identity_row) == stable_id
    assert _native_prediction_id("run-1", {**row, "config_name": "other"}) != stable_id
    assert _native_prediction_id("run-1", {**row, "partition": "test"}) != stable_id
    assert _native_prediction_id("run-1", {**row, "fold_id": "fold-2"}) != stable_id


def test_variant_summaries_surface_projected_score_maps_and_result_metadata() -> None:
    class FakePredictions:
        def __init__(self, rows):
            self._rows = rows

        def filter_predictions(self, load_arrays=False):
            return [dict(row) for row in self._rows]

    read = {
        "manifest": {
            "metric": "rmse",
            "task_type": "regression",
            "selected_variant": "base",
            "result_metadata": {"manifest_result": "manifest-1"},
        },
        "predictions": FakePredictions(
            [
                {
                    "config_name": "base",
                    "fold_id": "avg",
                    "model_name": "PLSRegression",
                    "dataset_name": "corn",
                    "metric": "rmse",
                    "task_type": "regression",
                    "val_score": 0.25,
                    "test_score": 0.30,
                    "scores": {
                        "val": {"rmse": 0.25, "mae": 0.20},
                        "test": {"rmse": 0.30},
                        "targets": {"protein": {"rmse": 0.31}},
                    },
                },
                {
                    "config_name": "base",
                    "fold_id": "fold-1",
                    "model_name": "PLSRegression",
                    "dataset_name": "corn",
                    "metric": "rmse",
                    "task_type": "regression",
                    "val_score": 0.27,
                },
                {
                    "config_name": "base_refit",
                    "fold_id": "final",
                    "refit_context": "refit",
                    "model_name": "PLSRegression",
                    "dataset_name": "corn",
                    "metric": "rmse",
                    "task_type": "regression",
                    "test_score": 0.21,
                    "train_score": 0.12,
                    "scores": {
                        "test": {"rmse": 0.21, "mae": 0.16},
                        "train": {"rmse": 0.12},
                        "targets": {"protein": {"rmse": 0.27}},
                    },
                    "result_metadata": {"result_id": "native-result-1"},
                },
            ]
        ),
    }
    adapter = NativeResultsAdapter.__new__(NativeResultsAdapter)

    summary = adapter._variant_summaries("run-1", read)[0]
    assert summary["branch_path"] is None
    assert summary["source_index"] is None
    assert summary["cv_scores"] == {
        "val": {"rmse": 0.25, "mae": 0.20},
        "test": {"rmse": 0.30},
    }
    assert summary["final_scores"] == {
        "test": {"rmse": 0.21, "mae": 0.16},
        "train": {"rmse": 0.12},
    }
    assert summary["score_maps"] == {
        "cv": {
            "val": {"rmse": 0.25, "mae": 0.20},
            "test": {"rmse": 0.30},
            "targets": {"protein": {"rmse": 0.31}},
        },
        "final": {
            "test": {"rmse": 0.21, "mae": 0.16},
            "train": {"rmse": 0.12},
            "targets": {"protein": {"rmse": 0.27}},
        },
    }
    assert summary["variant_params"]["result_metadata"] == {
        "source": "native_results",
        "run_id": "run-1",
        "chain_id": "run-1::base",
        "config_name": "base",
        "selected_variant": "base",
        "manifest_result": "manifest-1",
        "result_id": "native-result-1",
    }

    row = adapter._summaries_df([summary]).row(0, named=True)
    assert row["branch_path"] is None
    assert row["source_index"] is None
    assert row["cv_scores"]["val"]["mae"] == 0.20
    assert row["final_scores"]["test"]["rmse"] == 0.21
    assert row["score_maps"]["cv"]["targets"]["protein"]["rmse"] == 0.31
    assert row["score_maps"]["final"]["targets"]["protein"]["rmse"] == 0.27
    assert row["variant_params"]["result_metadata"]["result_id"] == "native-result-1"


def test_variant_summaries_preserve_native_identity_from_rows() -> None:
    read = {
        "manifest": {"metric": "rmse", "task_type": "regression"},
        "predictions": _FakePredictions(
            [
                {
                    "config_name": "base",
                    "fold_id": "avg",
                    "model_name": "PLSRegression",
                    "dataset_name": "corn",
                    "metric": "rmse",
                    "task_type": "regression",
                    "val_score": 0.25,
                    "branch_path": [0, "model"],
                    "source_idx": "2",
                },
                {
                    "config_name": "base_refit",
                    "fold_id": "final",
                    "refit_context": "refit",
                    "model_name": "PLSRegression",
                    "dataset_name": "corn",
                    "metric": "rmse",
                    "task_type": "regression",
                    "test_score": 0.21,
                },
            ]
        ),
    }
    adapter = NativeResultsAdapter.__new__(NativeResultsAdapter)

    summary = adapter._variant_summaries("run-1", read)[0]
    assert json.loads(summary["branch_path"]) == [0, "model"]
    assert summary["source_index"] == 2

    row = adapter._summaries_df([summary]).row(0, named=True)
    assert json.loads(row["branch_path"]) == [0, "model"]
    assert row["source_index"] == 2


def test_variant_summaries_preserve_native_identity_from_manifest_aliases() -> None:
    for field_name, raw_value, expected_source_index in (
        ("source_index", 1, 1),
        ("source_idx", "2", 2),
        ("source", 3.0, 3),
    ):
        read = {
            "manifest": {
                "metric": "rmse",
                "task_type": "regression",
                "variants": {
                    "base": {
                        "branch_path": ["manifest", field_name],
                        field_name: raw_value,
                    },
                },
            },
            "predictions": _FakePredictions(
                [
                    {
                        "config_name": "base",
                        "fold_id": "avg",
                        "model_name": "PLSRegression",
                        "dataset_name": "corn",
                        "metric": "rmse",
                        "task_type": "regression",
                        "val_score": 0.25,
                    },
                ]
            ),
        }
        adapter = NativeResultsAdapter.__new__(NativeResultsAdapter)

        summary = adapter._variant_summaries("run-1", read)[0]
        assert json.loads(summary["branch_path"]) == ["manifest", field_name]
        assert summary["source_index"] == expected_source_index


def test_native_prediction_rows_and_arrays_preserve_source_target_context() -> None:
    row = {
        "config_name": "base",
        "fold_id": "fold-1",
        "partition": "validation",
        "model_name": "PLSRegression",
        "dataset_name": "corn",
        "metric": "rmse",
        "task_type": "regression",
        "val_score": 0.25,
        "scores": {
            "val": {"rmse": 0.25, "mae": 0.20},
            "targets": {"protein": {"rmse": 0.31}},
        },
        "best_params": {"n_components": 8},
        "branch_path": ["root", "target-2"],
        "source_index": "3",
        "source_name": "nir",
        "y_true": [[1.0, 10.0], [2.0, 20.0]],
        "y_pred": [[1.1, 10.1], [2.1, 20.1]],
        "sample_indices": [4, 5],
        "result_metadata": {
            "target_name": "protein",
            "dimensions": {"target_index": "1"},
        },
    }
    read = {
        "manifest": {"metric": "rmse", "task_type": "regression"},
        "predictions": _FakePredictions([row]),
    }
    adapter = NativeResultsAdapter.__new__(NativeResultsAdapter)
    adapter._iter_runs = lambda: [("run-1", read)]  # type: ignore[method-assign]

    chain_id = _native_chain_id("run-1", "base")
    prediction_id = _native_prediction_id("run-1", row)

    prediction_record = adapter.get_chain_predictions(chain_id).row(0, named=True)
    assert prediction_record["scores"]["targets"]["protein"]["rmse"] == 0.31
    assert prediction_record["best_params"] == {"n_components": 8}
    assert json.loads(prediction_record["branch_path"]) == ["root", "target-2"]
    assert prediction_record["source_index"] == 3
    assert prediction_record["source_name"] == "nir"
    assert prediction_record["target_index"] == 1
    assert prediction_record["target_name"] == "protein"
    assert prediction_record["result_metadata"]["target_name"] == "protein"

    arrays = adapter.get_prediction_arrays(prediction_id)
    assert arrays is not None
    assert json.loads(arrays["branch_path"]) == ["root", "target-2"]
    assert arrays["source_index"] == 3
    assert arrays["target_index"] == 1
    assert arrays["target_name"] == "protein"
    assert arrays["y_true"] == [[1.0, 10.0], [2.0, 20.0]]
    assert arrays["y_pred"] == [[1.1, 10.1], [2.1, 20.1]]


def _extract_quoted_values(block: str) -> set[str]:
    return set(re.findall(r"[\"']([^\"']+)[\"']", block))


def _extract_ts_score_column_union() -> set[str]:
    source = (ROOT / "src/types/inspector.ts").read_text(encoding="utf-8")
    match = re.search(r"export type ScoreColumn\s*=\s*(.*?);", source, re.DOTALL)
    assert match is not None
    return _extract_quoted_values(match.group(1))


def _extract_ts_score_column_options() -> set[str]:
    source = (ROOT / "src/types/inspector.ts").read_text(encoding="utf-8")
    match = re.search(r"export const SCORE_COLUMNS:[^\n]+=\s*\[(.*?)\];", source, re.DOTALL)
    assert match is not None
    return set(re.findall(r"value:\s*[\"']([^\"']+)[\"']", match.group(1)))


def _extract_metric_observation_score_columns() -> set[str]:
    source = (ROOT / "src/lib/inspector/metricObservationProjection.ts").read_text(encoding="utf-8")
    match = re.search(
        r"INSPECTOR_METRIC_OBSERVATION_SCORE_COLUMNS:[^\n]+=\s*\[(.*?)\]",
        source,
        re.DOTALL,
    )
    assert match is not None
    return _extract_quoted_values(match.group(1))


def test_frontend_score_columns_match_backend_canonical_columns() -> None:
    backend_canonical = set(_VALID_SCORE_COLUMNS) - set(_SCORE_COLUMN_ALIASES)

    assert _extract_ts_score_column_union() == backend_canonical
    assert _extract_ts_score_column_options() == backend_canonical
    assert _extract_metric_observation_score_columns() == backend_canonical
