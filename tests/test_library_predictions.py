"""Real fitted-model replay through the thin plugin adapter, without HTTP."""

import hashlib
import json

import numpy as np
import pytest
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.model_selection import KFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from api.library_predictions import available_models, run_prediction


@pytest.fixture
def trained(tmp_path):
    import nirs4all

    X = np.random.default_rng(93).normal(size=(30, 300)).astype(np.float32)
    y = 5 + X[:, 0] - 2 * X[:, 1]
    result = nirs4all.run(
        [StandardScaler(), {"y_processing": StandardScaler()}, KFold(3), Ridge()], (X, y),
        workspace_path=tmp_path, save_charts=False, verbose=0,
    )
    yield result, X, y, tmp_path
    result.close()


def test_catalogue_reads_metadata_without_deserializing_models(trained, monkeypatch):
    import joblib
    from nirs4all.pipeline.storage.workspace_store import WorkspaceStore

    result, _, _, root = trained
    database = root / "store.sqlite"
    before = hashlib.sha256(database.read_bytes()).hexdigest(), database.stat().st_mtime_ns
    entries = sorted(path.name for path in root.iterdir())
    monkeypatch.setattr(joblib, "load", lambda *args, **kwargs: pytest.fail("catalogue deserialized fitted model"))
    monkeypatch.setattr(WorkspaceStore, "__init__", lambda *args, **kwargs: pytest.fail("catalogue opened writable store"))
    catalogue = available_models({"workspace_path": str(root)})
    assert catalogue["total"] >= 1
    model = next(item for item in catalogue["models"] if item["id"] == result.best["chain_id"])
    assert model["has_refit"] is True
    assert model["execution_profile"] == "captured_general"
    assert model["cv_artifacts_available"] is False
    assert "Ridge" in model["model_class"]
    assert (hashlib.sha256(database.read_bytes()).hexdigest(), database.stat().st_mtime_ns) == before
    assert sorted(path.name for path in root.iterdir()) == entries
    json.dumps(catalogue, allow_nan=False)


@pytest.mark.parametrize("source", ["chain", "bundle"])
def test_general_prediction_matches_public_captured_replay_without_training(trained, source, monkeypatch):
    import nirs4all

    result, X, _, root = trained
    expected = nirs4all.predict(result.best, X[:7]).y_pred
    payload = {"workspace_path": str(root), "model_id": result.best["chain_id"], "model_source": source,
               "data_source": "array", "spectra": X[:7].tolist()}
    if source == "bundle":
        path = result.export(root / "exports" / "fitted.n4a")
        payload.update(bundle_path=str(path), archive_fingerprint="sha256:" + hashlib.sha256(path.read_bytes()).hexdigest())
    monkeypatch.setattr(Pipeline, "fit", lambda *args, **kwargs: pytest.fail("prediction retrained"))
    monkeypatch.setattr("nirs4all.pipeline.PipelineRunner.__init__", lambda *args, **kwargs: pytest.fail("legacy backend"))
    predicted = run_prediction(payload)
    np.testing.assert_array_equal(predicted["predictions"], expected)
    assert predicted["num_samples"] == 7
    assert len(set(predicted["sample_ids"])) == 7
    assert predicted["runtime"]["runtime_manifest"]["training_performed"] is False
    assert predicted["runtime"]["runtime_manifest"]["phase"] == "PREDICT"
    json.dumps(predicted, allow_nan=False)


def test_general_dataset_prediction_preserves_partition_and_native_id_order(trained):
    import nirs4all
    from nirs4all.api.dataset_inspection import load_dataset_for_analysis

    result, X, y, root = trained
    files = {}
    for role, values in {"train_x": X[:20], "test_x": X[20:], "train_y": y[:20], "test_y": y[20:]}.items():
        path = root / f"{role}.csv"
        np.savetxt(path, values, delimiter=";")
        files[role] = str(path)
    config = {**files, "train_x_params": {"has_header": False}, "test_x_params": {"has_header": False},
              "train_y_params": {"has_header": False}, "test_y_params": {"has_header": False}}
    dataset, _ = load_dataset_for_analysis(config)
    expected = nirs4all.predict(result.best, dataset)
    predicted = run_prediction({"workspace_path": str(root), "model_id": result.best["chain_id"], "model_source": "chain",
                                "data_source": "dataset", "config": config, "partition": "test"})
    assert predicted["num_samples"] == 10
    assert predicted["partitions"] == ["test"] * 10
    assert predicted["sample_ids"] == expected.metadata["sample_ids"][20:]
    np.testing.assert_array_equal(predicted["predictions"], expected.y_pred[20:])
    np.testing.assert_allclose(predicted["actual_values"], y[20:])
    assert predicted["runtime"]["reader"]["native_load_limits_applied"] is True
    json.dumps(predicted, allow_nan=False)


@pytest.mark.parametrize("classification", [False, True])
def test_general_prediction_keeps_multiple_targets_or_class_labels(tmp_path, classification):
    import nirs4all

    X = np.random.default_rng(33).normal(size=(25, 4)).astype(np.float32)
    y = (X[:, 0] > 0).astype(int) if classification else np.column_stack([X[:, 0] + 2, X[:, 1] - 8])
    model = LogisticRegression() if classification else Ridge()
    result = nirs4all.run([model], (X, y), workspace_path=tmp_path, save_charts=False, verbose=0)
    try:
        expected = nirs4all.predict(result.best, X[:5])
        output = run_prediction({"workspace_path": str(tmp_path), "model_id": result.best["chain_id"], "model_source": "chain",
                                 "data_source": "array", "spectra": X[:5].tolist(), "output_index": 0 if classification else 1})
        np.testing.assert_array_equal(output["prediction_matrix"], np.asarray(expected.y_pred).reshape(5, -1))
        assert output["num_samples"] == 5
        assert len(output["target_names"]) == (1 if classification else 2)
        assert output["predictions"] == [row[output["output_index"]] for row in output["prediction_matrix"]]
    finally:
        result.close()


def test_replaced_general_bundle_is_refused_before_pickle(trained, monkeypatch):
    import joblib

    result, X, _, root = trained
    path = result.export(root / "exports" / "fitted.n4a")
    fingerprint = "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()
    path.write_bytes(b"changed after model selection")
    monkeypatch.setattr(joblib, "load", lambda *args, **kwargs: pytest.fail("unverified pickle"))
    with pytest.raises(ValueError, match="source archive changed"):
        run_prediction({"workspace_path": str(root), "model_id": "exports/fitted.n4a", "model_source": "bundle",
                        "bundle_path": str(path), "archive_fingerprint": fingerprint, "data_source": "array", "spectra": X[:3].tolist()})


@pytest.mark.parametrize("kind", ["csv", "numeric_header", "no_header", "xlsx"])
def test_uploaded_predictions_preserve_labels_and_all_rows_without_inventing_targets(trained, kind):
    import nirs4all
    import pandas as pd

    result, X, _, root = trained
    values = X[:4]
    labels = ["sample A", "sample A", "sample C", "sample D"]
    frame = pd.DataFrame(values, columns=[str(1100 + index * 2) if kind == "numeric_header" else f"band_{index}" for index in range(300)])
    frame.insert(0, "label", labels)
    params = {"has_header": kind != "no_header"}
    path = root / ("upload.xlsx" if kind == "xlsx" else "upload.csv")
    if kind == "xlsx":
        frame.to_excel(path, index=False)
    else:
        frame.to_csv(path, sep=";", index=False, header=kind != "no_header")
        params["delimiter"] = ";"
    expected = nirs4all.predict(result.best, values).y_pred
    output = run_prediction({"workspace_path": str(root), "model_id": result.best["chain_id"], "model_source": "chain",
                             "data_source": "file", "file_path": str(path), "params": params})
    np.testing.assert_allclose(output["predictions"], expected, rtol=1e-6, atol=1e-6)
    assert output["num_samples"] == 4
    assert output["sample_labels"] == labels
    assert len(set(output["sample_ids"])) == 4
    assert output["actual_values"] is None
    assert output["metrics"] is None
    json.dumps(output, allow_nan=False)
