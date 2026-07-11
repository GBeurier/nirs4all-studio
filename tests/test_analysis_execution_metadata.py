from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

import api.shap as shap_api
from api.automl import AutoMLRequest, _build_automl_job_config
from api.execution_driver import (
    AnalysisExecutionRequest,
    ExecutionArtifactRef,
    build_analysis_job_config,
    build_analysis_result_metadata,
)
from api.shap import ShapComputeRequest, _build_shap_job_config


def test_analysis_execution_request_metadata_tracks_artifacts_without_workspace_path():
    artifact = ExecutionArtifactRef(
        role="input_model",
        artifact_type="workspace_chain",
        artifact_id="chain-1",
        metadata={"fold": "final"},
    )
    request = AnalysisExecutionRequest(
        job_id="analysis_12345678",
        analysis_type="shap",
        dataset_id="dataset-1",
        workspace_path="/tmp/workspace",
        artifacts=(artifact,),
        parameters={"partition": "test"},
        metadata={"source": "unit-test"},
    )

    metadata = request.to_metadata()

    assert metadata == {
        "kind": "analysis",
        "job_id": "analysis_12345678",
        "analysis_type": "shap",
        "requested_backend": "local-python",
        "dataset_id": "dataset-1",
        "has_workspace": True,
        "fallback_policy": {
            "source": "nirs4all.run.allow_fallback",
            "engine_requested": None,
            "allow_fallback": False,
            "mode": "refuse_fallback",
        },
        "parameters": {"partition": "test"},
        "metadata": {"source": "unit-test"},
        "artifacts": [
            {
                "role": "input_model",
                "artifact_type": "workspace_chain",
                "artifact_id": "chain-1",
                "metadata": {"fold": "final"},
            }
        ],
    }
    assert "workspace_path" not in metadata


def test_build_analysis_job_config_preserves_legacy_keys():
    artifact = ExecutionArtifactRef(
        role="input_dataset",
        artifact_type="dataset",
        artifact_id="dataset-1",
    )
    request = AnalysisExecutionRequest(
        job_id="automl_12345678",
        analysis_type="automl",
        dataset_id="dataset-1",
        artifacts=(artifact,),
    )

    config = build_analysis_job_config(
        {"dataset_id": "dataset-1", "n_trials": 5},
        request,
    )

    assert config["dataset_id"] == "dataset-1"
    assert config["n_trials"] == 5
    assert config["execution_backend"] == "local-python"
    assert config["execution_request"]["job_id"] == "automl_12345678"
    assert config["execution_request"]["analysis_type"] == "automl"
    assert config["execution_request"]["fallback_policy"] == {
        "source": "nirs4all.run.allow_fallback",
        "engine_requested": None,
        "allow_fallback": False,
        "mode": "refuse_fallback",
    }
    assert config["execution_artifacts"] == [artifact.to_dict()]


def test_build_analysis_result_metadata_adds_output_refs_to_request_artifacts():
    input_artifact = ExecutionArtifactRef(
        role="input_dataset",
        artifact_type="dataset",
        artifact_id="dataset-1",
        metadata={"partition": "train"},
    )
    output_artifact = ExecutionArtifactRef(
        role="output_model",
        artifact_type="model_bundle",
        path="/tmp/workspace/models/best.n4a",
        metadata={"model_name": "PLSRegression"},
    )
    request = AnalysisExecutionRequest(
        job_id="automl_12345678",
        analysis_type="automl",
        dataset_id="dataset-1",
        artifacts=(input_artifact,),
    )
    config = build_analysis_job_config({"dataset_id": "dataset-1"}, request)

    metadata = build_analysis_result_metadata(config, (output_artifact,))

    assert metadata["execution_artifacts"] == [
        input_artifact.to_dict(),
        output_artifact.to_dict(),
    ]
    assert metadata["execution_request"]["artifacts"] == [
        input_artifact.to_dict(),
        output_artifact.to_dict(),
    ]
    assert config["execution_request"]["artifacts"] == [input_artifact.to_dict()]


def test_shap_job_config_attaches_dataset_and_model_refs():
    config = _build_shap_job_config(
        ShapComputeRequest(
            chain_id="chain-1",
            dataset_id="dataset-1",
            partition="test",
        ),
        job_id="analysis_12345678",
        workspace_path="/tmp/workspace",
    )

    assert config["chain_id"] == "chain-1"
    assert config["dataset_id"] == "dataset-1"
    assert config["execution_request"]["analysis_type"] == "shap"
    assert config["execution_request"]["parameters"]["partition"] == "test"
    assert config["execution_request"]["metadata"]["model_ref_type"] == "chain"
    assert config["execution_artifacts"] == [
        {
            "role": "input_dataset",
            "artifact_type": "dataset",
            "artifact_id": "dataset-1",
            "metadata": {"partition": "test"},
        },
        {
            "role": "input_model",
            "artifact_type": "workspace_chain",
            "artifact_id": "chain-1",
        },
    ]


def test_shap_task_result_metadata_adds_output_ref(monkeypatch):
    class FakeModel:
        def predict(self, X):
            return np.array([1.5, 2.5])

    class FakeAnalyzer:
        def explain_model(self, **kwargs):
            X = kwargs["X"]
            return {
                "shap_values": np.ones_like(X, dtype=float),
                "base_value": 0.5,
                "explainer_type": kwargs["explainer_type"],
            }

    def fake_get_cached(name, *args, **kwargs):
        if name == "ShapAnalyzer":
            return FakeAnalyzer
        raise AssertionError(f"Unexpected cached dependency: {name}")

    X = np.array([[1.0, 2.0, 3.0], [3.0, 4.0, 5.0]])
    job_id = "analysis_12345678"
    config = _build_shap_job_config(
        ShapComputeRequest(
            chain_id="chain-1",
            dataset_id="dataset-1",
            partition="test",
        ),
        job_id=job_id,
    )

    monkeypatch.setattr(shap_api, "get_cached", fake_get_cached)
    monkeypatch.setattr(shap_api, "_load_model_from_chain", lambda chain_id: (FakeModel(), {}))
    monkeypatch.setattr(
        shap_api,
        "_load_dataset_for_shap",
        lambda dataset_id, partition, n_samples: (X, np.array([1.0, 2.0]), [100.0, 110.0, 120.0], ["a", "b", "c"], [0, 1]),
    )

    try:
        result = shap_api._run_shap_task(
            SimpleNamespace(id=job_id, config=config),
            lambda progress, message: True,
        )

        output_artifact = {
            "role": "output_analysis",
            "artifact_type": "shap_explanation",
            "artifact_id": job_id,
            "metadata": {
                "dataset_id": "dataset-1",
                "model_id": "chain-1",
                "explainer_type": "auto",
                "n_samples": 2,
                "n_features": 3,
                "storage": "memory_cache",
            },
        }

        assert result["execution_artifacts"] == [*config["execution_artifacts"], output_artifact]
        assert result["execution_request"]["artifacts"] == result["execution_artifacts"]
        assert config["execution_request"]["artifacts"] == config["execution_artifacts"]
    finally:
        shap_api._shap_results_cache.pop(job_id, None)


def test_shap_load_model_from_chain_uses_results_repository(monkeypatch):
    model = object()

    class FakeRepository:
        def __init__(self):
            self.closed = False

        def get_chain(self, chain_id):
            assert chain_id == "chain-1"
            return {
                "chain_id": chain_id,
                "fold_artifacts": {"fold_final": "artifact-1"},
                "model_class": "PLSRegression",
                "dataset_name": "corn",
            }

        def load_artifact(self, artifact_id):
            assert artifact_id == "artifact-1"
            return model

        def close(self):
            self.closed = True

    repository = FakeRepository()

    def fake_resolve_results_repository(workspace_path, *, workspace_store_factory):
        assert workspace_path == Path("/tmp/workspace")
        return repository

    monkeypatch.setattr(shap_api.workspace_manager, "get_active_workspace", lambda: SimpleNamespace(path="/tmp/workspace"))
    monkeypatch.setattr(shap_api, "resolve_results_repository", fake_resolve_results_repository)

    loaded, info = shap_api._load_model_from_chain("chain-1")

    assert loaded is model
    assert info == {"chain_id": "chain-1", "model_class": "PLSRegression", "dataset_name": "corn"}
    assert repository.closed is True


def test_native_results_adapter_loads_single_refit_artifact_for_shap(monkeypatch):
    from api.native_results_adapter import NativeResultsAdapter

    class FakePredictions:
        def __init__(self, rows):
            self._rows = rows

        def filter_predictions(self, load_arrays=False):
            return [dict(row) for row in self._rows]

    class FakeEstimator:
        def predict(self, X):
            return np.asarray(X, dtype=float).reshape(len(X), -1).sum(axis=1)

    class FakeYTransform:
        def inverse_transform(self, values):
            return np.asarray(values, dtype=float) + 10.0

    read = {
        "manifest": {
            "selected_variant": "base",
            "capabilities": {"has_model_artifacts": True},
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
                },
                {
                    "config_name": "base_refit",
                    "fold_id": "final",
                    "refit_context": "refit",
                    "model_name": "PLSRegression",
                    "dataset_name": "corn",
                    "metric": "rmse",
                    "task_type": "regression",
                    "test_score": 0.2,
                },
            ]
        ),
        "artifacts": [
            {
                "artifact_id": "artifact:model:nirs4all:refit:base",
                "estimator": FakeEstimator(),
                "y_transform": FakeYTransform(),
            }
        ],
    }
    adapter = NativeResultsAdapter.__new__(NativeResultsAdapter)
    monkeypatch.setattr(adapter, "_iter_runs", lambda: [("run-1", read)])

    chain = adapter.get_chain("run-1::base")
    assert chain is not None
    artifact_id = chain["fold_artifacts"]["fold_final"]

    model = adapter.load_artifact(artifact_id)

    assert chain["native_artifact_id"] == "artifact:model:nirs4all:refit:base"
    assert np.allclose(np.asarray(model.predict([[1.0], [2.0]])).ravel(), [11.0, 12.0])


def test_shap_load_model_from_chain_surfaces_repository_artifact_gap(monkeypatch):
    class FakeRepository:
        def __init__(self):
            self.closed = False

        def get_chain(self, chain_id):
            return {
                "chain_id": chain_id,
                "fold_artifacts": {},
                "artifact_unavailable_reason": "Native results manifest reports has_model_artifacts=false.",
            }

        def load_artifact(self, artifact_id):
            raise AssertionError("load_artifact must not be called without a final artifact id")

        def close(self):
            self.closed = True

    repository = FakeRepository()
    monkeypatch.setattr(shap_api.workspace_manager, "get_active_workspace", lambda: SimpleNamespace(path="/tmp/workspace"))
    monkeypatch.setattr(shap_api, "resolve_results_repository", lambda workspace_path, *, workspace_store_factory: repository)

    with pytest.raises(ValueError, match="has_model_artifacts=false"):
        shap_api._load_model_from_chain("chain-1")

    assert repository.closed is True


def test_automl_job_config_attaches_dataset_ref_and_search_parameters():
    request = AutoMLRequest(
        dataset_id="dataset-1",
        task_type="regression",
        metric="r2",
        n_trials=5,
        engine="dag-ml",
        allow_fallback=True,
    )
    model = {"model_name": "PLSRegression", "enabled": True, "params": []}

    config = _build_automl_job_config(
        request,
        dataset_name="Dataset 1",
        enabled_models=[model],
        workspace_path="/tmp/workspace",
        job_id="automl_12345678",
    )

    assert config["dataset_name"] == "Dataset 1"
    assert config["models"] == [model]
    assert config["engine"] == "dag-ml"
    assert config["allow_fallback"] is True
    assert config["execution_request"]["analysis_type"] == "automl"
    assert config["execution_request"]["requested_engine"] == "dag-ml"
    assert config["execution_request"]["fallback_policy"] == {
        "source": "nirs4all.run.allow_fallback",
        "engine_requested": "dag-ml",
        "allow_fallback": True,
        "mode": "allow_fallback",
    }
    assert config["execution_request"]["parameters"]["n_trials"] == 5
    assert config["execution_request"]["parameters"]["enabled_model_count"] == 1
    assert config["execution_artifacts"] == [
        {
            "role": "input_dataset",
            "artifact_type": "dataset",
            "artifact_id": "dataset-1",
            "metadata": {"partition": "train"},
        }
    ]
