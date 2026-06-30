from __future__ import annotations

import numpy as np
import pytest

from api.analysis_results_repository import AnalysisResultsRepository, resolve_analysis_results_repository


def test_analysis_results_repository_round_trips_json_and_arrays(tmp_path):
    repository = AnalysisResultsRepository(tmp_path)

    repository.save(
        "shap",
        "analysis_12345678",
        {
            "job_id": "analysis_12345678",
            "score": np.float64(0.42),
            "values": np.array([1, 2, 3]),
        },
        arrays={
            "shap_values": np.array([[1.0, 2.0], [3.0, 4.0]]),
            "X": np.array([[10.0, 20.0], [30.0, 40.0]]),
        },
    )

    assert repository.exists("shap", "analysis_12345678")
    assert repository.load("shap", "analysis_12345678") == {
        "job_id": "analysis_12345678",
        "score": 0.42,
        "values": [1, 2, 3],
    }
    arrays = repository.load_arrays("shap", "analysis_12345678")
    assert arrays is not None
    np.testing.assert_allclose(arrays["shap_values"], [[1.0, 2.0], [3.0, 4.0]])
    np.testing.assert_allclose(arrays["X"], [[10.0, 20.0], [30.0, 40.0]])


def test_analysis_results_repository_rejects_path_traversal(tmp_path):
    repository = AnalysisResultsRepository(tmp_path)

    with pytest.raises(ValueError):
        repository.save("../outside", "job", {})
    with pytest.raises(ValueError):
        repository.save("shap", "../job", {})


def test_resolve_analysis_results_repository_handles_missing_workspace():
    assert resolve_analysis_results_repository(None) is None
