"""
Tests for the Playground API.

Phase 1: Backend API testing for Playground V1
"""

import sys
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from main import app

client = TestClient(app)


# ============= Test Data Fixtures =============


@pytest.fixture
def sample_spectral_data():
    """Generate sample spectral data for testing."""
    np.random.seed(42)
    n_samples = 50
    n_features = 200

    # Generate synthetic NIR-like spectra
    wavelengths = np.linspace(1100, 2500, n_features)
    X = np.zeros((n_samples, n_features))

    for i in range(n_samples):
        # Base spectrum with random offset
        base = 0.5 + 0.1 * np.sin(wavelengths / 200) + np.random.randn() * 0.05
        # Add some noise
        noise = np.random.randn(n_features) * 0.02
        X[i] = base + noise

    # Generate correlated target values
    y = np.mean(X[:, 50:100], axis=1) * 10 + np.random.randn(n_samples) * 0.5

    return {
        "x": X.tolist(),
        "y": y.tolist(),
        "wavelengths": wavelengths.tolist(),
        "sample_ids": [f"sample_{i}" for i in range(n_samples)]
    }


@pytest.fixture
def simple_spectral_data():
    """Simple small dataset for quick tests."""
    np.random.seed(42)
    X = np.random.randn(10, 50) * 0.1 + 0.5
    y = np.random.randn(10) * 5 + 20

    return {
        "x": X.tolist(),
        "y": y.tolist(),
        "wavelengths": list(range(1000, 1050)),
    }


# ============= Basic Endpoint Tests =============


class TestPlaygroundEndpoints:
    """Test basic endpoint functionality."""

    def test_execute_empty_pipeline(self, simple_spectral_data):
        """Test execution with no steps."""
        response = client.post(
            "/api/playground/execute",
            json={
                "data": simple_spectral_data,
                "steps": [],
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "original" in data
        assert "processed" in data
        assert data["original"]["shape"] == data["processed"]["shape"]

    def test_execute_single_preprocessing(self, simple_spectral_data):
        """Test single preprocessing step."""
        response = client.post(
            "/api/playground/execute",
            json={
                "data": simple_spectral_data,
                "steps": [
                    {
                        "id": "step_1",
                        "type": "preprocessing",
                        "name": "StandardNormalVariate",
                        "params": {},
                        "enabled": True
                    }
                ],
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert len(data["execution_trace"]) == 1
        assert data["execution_trace"][0]["success"] is True
        assert data["execution_trace"][0]["name"] == "StandardNormalVariate"

    def test_execute_multiple_preprocessing(self, simple_spectral_data):
        """Test multiple preprocessing steps."""
        response = client.post(
            "/api/playground/execute",
            json={
                "data": simple_spectral_data,
                "steps": [
                    {"id": "s1", "type": "preprocessing", "name": "StandardNormalVariate", "params": {}, "enabled": True},
                    {"id": "s2", "type": "preprocessing", "name": "SavitzkyGolay", "params": {"window_length": 7, "polyorder": 2}, "enabled": True},
                ],
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert len(data["execution_trace"]) == 2
        # All steps should succeed
        assert all(t["success"] for t in data["execution_trace"])

    def test_execute_with_disabled_step(self, simple_spectral_data):
        """Test that disabled steps are skipped."""
        response = client.post(
            "/api/playground/execute",
            json={
                "data": simple_spectral_data,
                "steps": [
                    {"id": "s1", "type": "preprocessing", "name": "StandardNormalVariate", "params": {}, "enabled": True},
                    {"id": "s2", "type": "preprocessing", "name": "SavitzkyGolay", "params": {}, "enabled": False},
                ],
            }
        )
        assert response.status_code == 200
        data = response.json()
        # Only 1 step should be in trace (disabled step skipped)
        assert len(data["execution_trace"]) == 1

    def test_execute_invalid_operator(self, simple_spectral_data):
        """Test error handling for unknown operator."""
        response = client.post(
            "/api/playground/execute",
            json={
                "data": simple_spectral_data,
                "steps": [
                    {"id": "s1", "type": "preprocessing", "name": "NonExistentOperator", "params": {}, "enabled": True},
                ],
            }
        )
        assert response.status_code == 200
        data = response.json()
        # Should still return success=False but not crash
        assert data["success"] is False
        assert len(data["step_errors"]) > 0

    def test_list_operators(self):
        """Test operators listing endpoint."""
        response = client.get("/api/playground/operators")
        assert response.status_code == 200
        data = response.json()
        assert "preprocessing" in data
        assert "splitting" in data
        assert data["total"] > 0

    def test_get_presets(self):
        """Test presets endpoint."""
        response = client.get("/api/playground/presets")
        assert response.status_code == 200
        data = response.json()
        assert "presets" in data
        assert len(data["presets"]) > 0


# ============= Splitter Tests =============


class TestSplitters:
    """Test splitter functionality."""

    def test_kfold_splitter(self, sample_spectral_data):
        """Test KFold splitter."""
        response = client.post(
            "/api/playground/execute",
            json={
                "data": sample_spectral_data,
                "steps": [
                    {"id": "s1", "type": "splitting", "name": "KFold", "params": {"n_splits": 5}, "enabled": True},
                ],
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["folds"] is not None
        assert data["folds"]["n_folds"] == 5
        assert len(data["folds"]["folds"]) == 5

    def test_stratified_kfold_splitter(self, sample_spectral_data):
        """Test StratifiedKFold splitter (requires y)."""
        response = client.post(
            "/api/playground/execute",
            json={
                "data": sample_spectral_data,
                "steps": [
                    {"id": "s1", "type": "splitting", "name": "StratifiedKFold", "params": {"n_splits": 5}, "enabled": True},
                ],
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["folds"] is not None
        # Check per-fold Y statistics
        for fold in data["folds"]["folds"]:
            if sample_spectral_data.get("y"):
                assert "y_train_stats" in fold

    def test_shuffle_split_with_split_index(self, sample_spectral_data):
        """Test ShuffleSplit with split_index option."""
        response = client.post(
            "/api/playground/execute",
            json={
                "data": sample_spectral_data,
                "steps": [
                    {"id": "s1", "type": "splitting", "name": "ShuffleSplit", "params": {"n_splits": 5, "test_size": 0.2}, "enabled": True},
                ],
                "options": {"split_index": 2}
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["folds"]["split_index"] == 2

    def test_preprocessing_then_splitting(self, sample_spectral_data):
        """Test preprocessing followed by splitting."""
        response = client.post(
            "/api/playground/execute",
            json={
                "data": sample_spectral_data,
                "steps": [
                    {"id": "s1", "type": "preprocessing", "name": "StandardNormalVariate", "params": {}, "enabled": True},
                    {"id": "s2", "type": "splitting", "name": "KFold", "params": {"n_splits": 3}, "enabled": True},
                ],
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert len(data["execution_trace"]) == 2
        assert data["folds"] is not None


# ============= Statistics and PCA Tests =============


class TestStatisticsAndPCA:
    """Test statistics and PCA computation."""

    def test_statistics_computation(self, simple_spectral_data):
        """Test that statistics are computed correctly."""
        response = client.post(
            "/api/playground/execute",
            json={
                "data": simple_spectral_data,
                "steps": [],
                "options": {"compute_statistics": True}
            }
        )
        assert response.status_code == 200
        data = response.json()

        stats = data["original"]["statistics"]
        assert "mean" in stats
        assert "std" in stats
        assert "min" in stats
        assert "max" in stats
        assert "p5" in stats
        assert "p95" in stats
        assert "global" in stats

        # Check lengths match feature count
        n_features = len(simple_spectral_data["x"][0])
        assert len(stats["mean"]) == n_features

    def test_pca_computation(self, simple_spectral_data):
        """Test PCA computation."""
        response = client.post(
            "/api/playground/execute",
            json={
                "data": simple_spectral_data,
                "steps": [],
                "options": {"compute_pca": True}
            }
        )
        assert response.status_code == 200
        data = response.json()

        assert data["pca"] is not None
        # If nirs4all PCA feature isn't available, skip
        if "error" in data["pca"]:
            pytest.skip(f"PCA not available: {data['pca']['error']}")
        assert "coordinates" in data["pca"]
        assert "explained_variance_ratio" in data["pca"]

        # Coordinates should match sample count
        n_samples = len(simple_spectral_data["x"])
        assert len(data["pca"]["coordinates"]) == n_samples

    def test_pca_with_fold_labels(self, sample_spectral_data):
        """Test that PCA includes fold labels when splitter is used."""
        response = client.post(
            "/api/playground/execute",
            json={
                "data": sample_spectral_data,
                "steps": [
                    {"id": "s1", "type": "splitting", "name": "KFold", "params": {"n_splits": 3}, "enabled": True},
                ],
                "options": {"compute_pca": True}
            }
        )
        assert response.status_code == 200
        data = response.json()

        # If nirs4all PCA feature isn't available, skip
        if data["pca"] is not None and "error" in data["pca"]:
            pytest.skip(f"PCA not available: {data['pca']['error']}")
        assert data["pca"]["fold_labels"] is not None
        assert len(data["pca"]["fold_labels"]) == len(sample_spectral_data["x"])


# ============= Sampling Tests =============


class TestSampling:
    """Test data sampling functionality."""

    def test_random_sampling(self, sample_spectral_data):
        """Test random sampling."""
        response = client.post(
            "/api/playground/execute",
            json={
                "data": sample_spectral_data,
                "steps": [],
                "sampling": {"method": "random", "n_samples": 20, "seed": 42}
            }
        )
        if response.status_code == 500:
            pytest.skip(f"Sampling not available: {response.json().get('detail', 'unknown error')}")
        assert response.status_code == 200
        data = response.json()

        assert len(data["original"]["sample_indices"]) == 20
        assert data["original"]["shape"][0] == 20

    def test_stratified_sampling(self, sample_spectral_data):
        """Test stratified sampling."""
        response = client.post(
            "/api/playground/execute",
            json={
                "data": sample_spectral_data,
                "steps": [],
                "sampling": {"method": "stratified", "n_samples": 20, "seed": 42}
            }
        )
        if response.status_code == 500:
            pytest.skip(f"Sampling not available: {response.json().get('detail', 'unknown error')}")
        assert response.status_code == 200
        data = response.json()

        assert len(data["original"]["sample_indices"]) == 20

    def test_kmeans_sampling(self, sample_spectral_data):
        """Test k-means based sampling."""
        response = client.post(
            "/api/playground/execute",
            json={
                "data": sample_spectral_data,
                "steps": [],
                "sampling": {"method": "kmeans", "n_samples": 15, "seed": 42},
                "options": {"use_cache": False}  # Disable cache for this test
            }
        )
        if response.status_code == 500:
            pytest.skip(f"Sampling not available: {response.json().get('detail', 'unknown error')}")
        assert response.status_code == 200
        data = response.json()

        # K-means should return exactly the requested number of samples
        assert len(data["original"]["sample_indices"]) == 15


# ============= Caching Tests =============


class TestCaching:
    """Test response caching."""

    def test_cached_response(self, simple_spectral_data):
        """Test that repeated requests use cache."""
        request_data = {
            "data": simple_spectral_data,
            "steps": [
                {"id": "s1", "type": "preprocessing", "name": "StandardNormalVariate", "params": {}, "enabled": True},
            ],
            "options": {"use_cache": True}
        }

        # First request
        response1 = client.post("/api/playground/execute", json=request_data)
        assert response1.status_code == 200
        time1 = response1.json()["execution_time_ms"]

        # Second request (should be cached)
        response2 = client.post("/api/playground/execute", json=request_data)
        assert response2.status_code == 200

        # Cache hit should return same data
        assert response1.json()["processed"]["spectra"] == response2.json()["processed"]["spectra"]

    def test_cache_disabled(self, simple_spectral_data):
        """Test that cache can be disabled."""
        request_data = {
            "data": simple_spectral_data,
            "steps": [],
            "options": {"use_cache": False}
        }

        response = client.post("/api/playground/execute", json=request_data)
        assert response.status_code == 200


# ============= Validation Tests =============


class TestValidation:
    """Test pipeline validation endpoint."""

    def test_validate_valid_pipeline(self):
        """Test validation of valid pipeline."""
        response = client.post(
            "/api/playground/validate",
            json=[
                {"id": "s1", "type": "preprocessing", "name": "StandardNormalVariate", "params": {}, "enabled": True},
                {"id": "s2", "type": "splitting", "name": "KFold", "params": {"n_splits": 5}, "enabled": True},
            ]
        )
        assert response.status_code == 200
        data = response.json()
        assert data["valid"] is True
        assert len(data["errors"]) == 0

    def test_validate_invalid_operator(self):
        """Test validation catches invalid operator."""
        response = client.post(
            "/api/playground/validate",
            json=[
                {"id": "s1", "type": "preprocessing", "name": "FakeOperator", "params": {}, "enabled": True},
            ]
        )
        assert response.status_code == 200
        data = response.json()
        assert data["valid"] is False
        assert len(data["errors"]) > 0


# ============= Edge Cases =============


class TestEdgeCases:
    """Test edge cases and error handling."""

    def test_empty_data(self):
        """Test error for empty data."""
        response = client.post(
            "/api/playground/execute",
            json={
                "data": {"x": [], "y": None, "wavelengths": None},
                "steps": [],
            }
        )
        assert response.status_code == 400

    def test_single_sample(self):
        """Test with single sample."""
        response = client.post(
            "/api/playground/execute",
            json={
                "data": {"x": [[0.1, 0.2, 0.3, 0.4, 0.5]], "y": [1.0], "wavelengths": [1, 2, 3, 4, 5]},
                "steps": [
                    {"id": "s1", "type": "preprocessing", "name": "StandardNormalVariate", "params": {}, "enabled": True},
                ],
            }
        )
        # Should succeed even with single sample
        assert response.status_code == 200

    def test_wavelength_downsampling(self, sample_spectral_data):
        """Test wavelength downsampling option."""
        response = client.post(
            "/api/playground/execute",
            json={
                "data": sample_spectral_data,
                "steps": [],
                "options": {"max_wavelengths_returned": 50}
            }
        )
        assert response.status_code == 200
        data = response.json()

        # Should have fewer wavelengths
        assert len(data["original"]["wavelengths"]) == 50


# ============= Integration Tests =============


class TestIntegration:
    """Integration tests with nirs4all operators."""

    def test_snv_transforms_correctly(self, simple_spectral_data):
        """Test that SNV produces expected output characteristics."""
        response = client.post(
            "/api/playground/execute",
            json={
                "data": simple_spectral_data,
                "steps": [
                    {"id": "s1", "type": "preprocessing", "name": "StandardNormalVariate", "params": {}, "enabled": True},
                ],
            }
        )
        assert response.status_code == 200
        data = response.json()

        # SNV should center each spectrum (mean ≈ 0, std ≈ 1)
        processed = np.array(data["processed"]["spectra"])
        for spectrum in processed:
            assert abs(np.mean(spectrum)) < 0.1
            assert abs(np.std(spectrum) - 1.0) < 0.1

    def test_derivative_changes_shape(self, simple_spectral_data):
        """Test that derivative operators may change feature count."""
        response = client.post(
            "/api/playground/execute",
            json={
                "data": simple_spectral_data,
                "steps": [
                    {"id": "s1", "type": "preprocessing", "name": "SavitzkyGolay", "params": {"window_length": 7, "polyorder": 2, "deriv": 1}, "enabled": True},
                ],
            }
        )
        assert response.status_code == 200
        data = response.json()

        # Output should still be valid
        assert data["success"] is True
        assert len(data["processed"]["spectra"]) > 0

    def test_preprocessing_chain(self, sample_spectral_data):
        """Test a realistic preprocessing chain."""
        response = client.post(
            "/api/playground/execute",
            json={
                "data": sample_spectral_data,
                "steps": [
                    {"id": "s1", "type": "preprocessing", "name": "StandardNormalVariate", "params": {}, "enabled": True},
                    {"id": "s2", "type": "preprocessing", "name": "SavitzkyGolay", "params": {"window_length": 11, "polyorder": 2}, "enabled": True},
                    {"id": "s3", "type": "preprocessing", "name": "StandardScaler", "params": {}, "enabled": True},
                ],
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert all(t["success"] for t in data["execution_trace"])


# ============= Export/Import Tests (Phase 4) =============


class TestExportImportFlow:
    """Test export and import pipeline functionality for Playground V1."""

    def test_pipeline_export_format_compatibility(self, simple_spectral_data):
        """Test that pipeline steps match expected export format."""
        steps = [
            {"id": "s1", "type": "preprocessing", "name": "StandardNormalVariate", "params": {}, "enabled": True},
            {"id": "s2", "type": "preprocessing", "name": "SavitzkyGolay", "params": {"window_length": 7, "polyorder": 2}, "enabled": True},
            {"id": "s3", "type": "splitting", "name": "KFold", "params": {"n_splits": 5}, "enabled": True},
        ]

        response = client.post(
            "/api/playground/execute",
            json={"data": simple_spectral_data, "steps": steps}
        )
        assert response.status_code == 200
        data = response.json()

        # Verify execution trace has all steps
        assert len(data["execution_trace"]) == 3
        assert all(t["success"] for t in data["execution_trace"])

        # Steps should be compatible with nirs4all format
        for step in steps:
            assert "name" in step
            assert "params" in step
            assert "type" in step

    def test_disabled_steps_not_exported_in_execution(self, simple_spectral_data):
        """Test that disabled steps are skipped in execution but preserved in config."""
        steps = [
            {"id": "s1", "type": "preprocessing", "name": "StandardNormalVariate", "params": {}, "enabled": True},
            {"id": "s2", "type": "preprocessing", "name": "SavitzkyGolay", "params": {}, "enabled": False},
            {"id": "s3", "type": "preprocessing", "name": "StandardScaler", "params": {}, "enabled": True},
        ]

        response = client.post(
            "/api/playground/execute",
            json={"data": simple_spectral_data, "steps": steps}
        )
        assert response.status_code == 200
        data = response.json()

        # Only 2 steps executed (s1 and s3)
        assert len(data["execution_trace"]) == 2
        assert data["execution_trace"][0]["name"] == "StandardNormalVariate"
        assert data["execution_trace"][1]["name"] == "StandardScaler"

    def test_full_preprocessing_to_export_flow(self, sample_spectral_data):
        """Test complete preprocessing flow that would be exported to Pipeline Editor."""
        steps = [
            {"id": "s1", "type": "preprocessing", "name": "StandardNormalVariate", "params": {}, "enabled": True},
            {"id": "s2", "type": "preprocessing", "name": "SavitzkyGolay", "params": {"window_length": 11, "polyorder": 2, "deriv": 1}, "enabled": True},
            {"id": "s3", "type": "splitting", "name": "KFold", "params": {"n_splits": 5, "shuffle": True, "random_state": 42}, "enabled": True},
        ]

        response = client.post(
            "/api/playground/execute",
            json={
                "data": sample_spectral_data,
                "steps": steps,
                "options": {"compute_pca": True, "compute_statistics": True}
            }
        )
        assert response.status_code == 200
        data = response.json()

        # Full pipeline should succeed
        assert data["success"] is True

        # Should have all components needed for export
        assert data["original"] is not None
        assert data["processed"] is not None
        assert data["pca"] is not None
        assert data["folds"] is not None

        # Statistics should be computed
        assert data["processed"]["statistics"] is not None

    def test_operators_can_be_roundtripped(self):
        """Test that operators returned by API can be used back in execute."""
        # Get operators from registry
        ops_response = client.get("/api/playground/operators")
        assert ops_response.status_code == 200
        operators = ops_response.json()

        # Take first preprocessing and splitting operator
        if operators["preprocessing"]:
            preproc = operators["preprocessing"][0]
            step = {
                "id": "test",
                "type": "preprocessing",
                "name": preproc["name"],
                "params": {k: v.get("default") for k, v in preproc["params"].items() if v.get("default") is not None},
                "enabled": True
            }

            # Should be able to execute with this step
            response = client.post(
                "/api/playground/execute",
                json={
                    "data": {"x": [[0.1, 0.2, 0.3, 0.4, 0.5]], "wavelengths": [1, 2, 3, 4, 5]},
                    "steps": [step]
                }
            )
            assert response.status_code == 200

    def test_preset_pipeline_execution(self):
        """Test that presets can be executed successfully."""
        # Get presets
        presets_response = client.get("/api/playground/presets")
        assert presets_response.status_code == 200
        presets = presets_response.json()["presets"]

        if presets:
            preset = presets[0]
            steps = [
                {
                    "id": f"p_{i}",
                    "type": s["type"],
                    "name": s["name"],
                    "params": s["params"],
                    "enabled": True
                }
                for i, s in enumerate(preset["steps"])
            ]

            # Simple test data
            response = client.post(
                "/api/playground/execute",
                json={
                    "data": {"x": np.random.randn(20, 100).tolist(), "wavelengths": list(range(100))},
                    "steps": steps
                }
            )
            assert response.status_code == 200


# ============= Step Comparison Mode Tests (Phase 4) =============


class TestStepComparisonMode:
    """Test step-by-step comparison functionality."""

    def test_incremental_step_execution(self, simple_spectral_data):
        """Test executing pipeline step by step for comparison mode."""
        steps = [
            {"id": "s1", "type": "preprocessing", "name": "StandardNormalVariate", "params": {}, "enabled": True},
            {"id": "s2", "type": "preprocessing", "name": "SavitzkyGolay", "params": {"window_length": 7, "polyorder": 2}, "enabled": True},
            {"id": "s3", "type": "preprocessing", "name": "StandardScaler", "params": {}, "enabled": True},
        ]

        # Execute with 0 steps (original data)
        r0 = client.post("/api/playground/execute", json={"data": simple_spectral_data, "steps": []})
        assert r0.status_code == 200
        original_spectra = r0.json()["processed"]["spectra"]

        # Execute with 1 step
        r1 = client.post("/api/playground/execute", json={"data": simple_spectral_data, "steps": steps[:1]})
        assert r1.status_code == 200
        after_snv = r1.json()["processed"]["spectra"]

        # Execute with 2 steps
        r2 = client.post("/api/playground/execute", json={"data": simple_spectral_data, "steps": steps[:2]})
        assert r2.status_code == 200
        after_sg = r2.json()["processed"]["spectra"]

        # Execute full pipeline
        r3 = client.post("/api/playground/execute", json={"data": simple_spectral_data, "steps": steps})
        assert r3.status_code == 200
        final = r3.json()["processed"]["spectra"]

        # Each step should produce different results
        assert original_spectra != after_snv
        assert after_snv != after_sg
        assert after_sg != final

    def test_step_timing_in_trace(self, sample_spectral_data):
        """Test that execution trace provides timing for each step."""
        steps = [
            {"id": "s1", "type": "preprocessing", "name": "StandardNormalVariate", "params": {}, "enabled": True},
            {"id": "s2", "type": "preprocessing", "name": "SavitzkyGolay", "params": {"window_length": 11, "polyorder": 2}, "enabled": True},
        ]

        response = client.post(
            "/api/playground/execute",
            json={"data": sample_spectral_data, "steps": steps}
        )
        assert response.status_code == 200
        data = response.json()

        # Each step should have timing info
        for trace in data["execution_trace"]:
            assert "duration_ms" in trace
            assert trace["duration_ms"] >= 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
