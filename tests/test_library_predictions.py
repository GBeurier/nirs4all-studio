"""Real fitted-model replay through the thin plugin adapter, without HTTP."""

import hashlib
import json
from types import SimpleNamespace

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
    entries = {path.name for path in root.iterdir()}
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
    # A real read transaction sees concurrent WAL commits. SQLite may create
    # its shared-memory bookkeeping and an empty WAL on the first reader;
    # immutable=1 avoided these files by incorrectly ignoring live writers.
    after_entries = {path.name for path in root.iterdir()}
    assert entries <= after_entries
    assert after_entries - entries <= {"store.sqlite-wal", "store.sqlite-shm"}
    if "store.sqlite-wal" in after_entries - entries:
        assert (root / "store.sqlite-wal").stat().st_size == 0
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


def test_multimodal_prediction_reconstructs_ragged_missing_cohort_without_fit(tmp_path, monkeypatch):
    import nirs4all.pipeline.dagml.general_archive as archive
    from nirs4all_io import MultimodalDataset, RaggedSeriesSource, TensorSource

    ids = ["sample-b", "sample-a", "sample-c"]
    series = RaggedSeriesSource(
        np.array([[1.0], [2.0], [3.0], [4.0]]), np.array([0, 1, 3, 4]), ids,
        time_coordinates=np.array([0.0, 0.0, 1.0, 0.0]), channel_names=["sensor"],
        presence_mask=[True, False, True],
    )
    cohort = MultimodalDataset({
        "signal": TensorSource(np.array([[1.0], [2.0], [3.0]]), ids, representation_id="signal_1d"),
        "series": series,
    }, sample_ids=ids, partitions=["predict", "test", "train"], source_alignment="left")
    descriptor = {"schema": "nirs4all.studio-multimodal-dataset.v1", "cohort": cohort.to_dict()}
    observed = []

    def replay(path, data, *, expected_archive_fingerprint):
        assert path == str(tmp_path / "exports" / "captured.n4a")
        assert expected_archive_fingerprint == "sha256:" + "a" * 64
        assert isinstance(data, MultimodalDataset)
        assert list(data.sample_ids) == ids
        assert data.sources["series"].presence_mask.tolist() == [True, False, True]
        assert data.sources["series"].offsets.tolist() == [0, 1, 3, 4]
        observed.append(data)
        return SimpleNamespace(y_pred=np.array([10.0, 20.0, 30.0]),
                               metadata={"sample_ids": ids, "target_names": ["y"], "training_performed": False},
                               model_name="captured", preprocessing_steps=[])

    monkeypatch.setattr(archive, "predict_general_archive", replay)
    monkeypatch.setattr("sklearn.pipeline.Pipeline.fit", lambda *args, **kwargs: pytest.fail("prediction retrained"))
    payload = {"workspace_path": str(tmp_path), "model_id": "exports/captured.n4a", "model_source": "bundle",
               "bundle_path": str(tmp_path / "exports" / "captured.n4a"), "archive_fingerprint": "sha256:" + "a" * 64,
               "data_source": "dataset", "config": descriptor, "partition": "test"}
    output = run_prediction(payload)
    assert len(observed) == 1
    assert output["sample_ids"] == ["sample-b", "sample-a"]
    assert output["predictions"] == [10.0, 20.0]
    assert output["partitions"] == ["test", "test"]
    assert output["actual_values"] is None
    assert output["metrics"] is None
    assert output["runtime"]["reader"]["source"] == "inline_multimodal"
    json.dumps(output, allow_nan=False)

    # serde_json counts compact UTF-8 bytes. Ordinary json.dumps spacing would
    # reject this exact-boundary document before the scientific loader sees it.
    boundary = {"schema": descriptor["schema"], "cohort": {"padding": ""}}
    def compact(value):
        return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")

    boundary["cohort"]["padding"] = "x" * (1024 * 1024 - len(compact(boundary)))
    assert len(compact(boundary)) == 1024 * 1024
    assert len(json.dumps(boundary).encode("utf-8")) > 1024 * 1024
    monkeypatch.setattr("nirs4all.api.studio_scientific_general._inline_dataset_arrays", lambda _: observed[0])
    assert run_prediction({**payload, "config": boundary})["sample_ids"] == ["sample-b", "sample-a"]

    for invalid in [
        {**descriptor, "extra": True},
        {"schema": descriptor["schema"], "cohort": {"padding": "x" * (1024 * 1024)}},
    ]:
        with pytest.raises(ValueError, match="descriptor"):
            run_prediction({**payload, "config": invalid})
    with pytest.raises(ValueError, match="fingerprinted exported bundle"):
        run_prediction({**payload, "model_source": "chain"})


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
