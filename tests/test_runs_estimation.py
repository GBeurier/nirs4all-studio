from __future__ import annotations

import logging
from types import SimpleNamespace

import api.runs as runs_api


def test_estimate_pipeline_variants_falls_back_on_canonicalization_error(monkeypatch, caplog):
    pipeline_config = {
        "name": "Broken Pipeline",
        "steps": [
            {
                "id": "split",
                "type": "splitting",
                "name": "KFold",
                "params": {"n_splits": 3},
            },
            {
                "id": "model",
                "type": "model",
                "name": "NonexistentModel",
                "params": {},
            },
        ],
    }

    def fail_canonicalization(_steps):
        raise ValueError(
            "Could not resolve class path for model step 'NonexistentModel'. "
            "Check that the step definition is valid."
        )

    monkeypatch.setattr(runs_api, "editor_steps_to_runtime_canonical", fail_canonicalization)

    with caplog.at_level(logging.WARNING):
        estimate = runs_api._estimate_pipeline_variants(pipeline_config)

    assert estimate.estimated_variants == 1
    assert estimate.has_generators is False
    assert estimate.fold_count == 3
    assert estimate.branch_count == 1
    assert estimate.total_model_count == 3
    assert estimate.model_count_breakdown == "3 folds = 3 models"
    assert "Falling back to default pipeline estimate for Broken Pipeline" in caplog.text


def test_count_tested_pipeline_variants_ignores_fold_partition_and_refit_rows():
    result = SimpleNamespace(
        predictions=SimpleNamespace(
            filter_predictions=lambda load_arrays=False: [
                {"pipeline_id": "pipe-cv-a", "fold_id": "0", "partition": "val"},
                {"pipeline_id": "pipe-cv-a", "fold_id": "0", "partition": "test"},
                {"pipeline_id": "pipe-cv-a", "fold_id": "avg", "partition": "test"},
                {"pipeline_id": "pipe-refit-a", "fold_id": "final", "partition": "test", "refit_context": "standalone"},
                {"pipeline_id": "pipe-cv-b", "fold_id": "1", "partition": "val"},
                {"pipeline_id": "pipe-cv-b", "fold_id": "w_avg", "partition": "test"},
            ]
        )
    )

    assert runs_api._count_tested_pipeline_variants(result, fallback=99) == 2


def test_count_tested_pipeline_variants_falls_back_when_prediction_ids_are_missing():
    result = SimpleNamespace(
        predictions=SimpleNamespace(
            filter_predictions=lambda load_arrays=False: [
                {"fold_id": "0", "partition": "val"},
                {"fold_id": "final", "partition": "test", "refit_context": "standalone"},
            ]
        )
    )

    assert runs_api._count_tested_pipeline_variants(result, fallback=3) == 3
