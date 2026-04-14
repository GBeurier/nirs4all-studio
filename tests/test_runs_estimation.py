from __future__ import annotations

import logging

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
