"""Real SQLite result pages through the same adapter used by Rust stdio."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest
from nirs4all.pipeline.storage import WorkspaceStore

from api.library_prediction_results import read_prediction_results


def test_prediction_page_preserves_records_filters_and_live_wal_without_writes(tmp_path: Path):
    workspace = tmp_path / "workspace"
    with WorkspaceStore(workspace) as writer:
        run = writer.begin_run("real predictions", config={}, datasets=[{"name": "wheat"}])
        pipeline = writer.begin_pipeline(run, "PLS", expanded_config=[], generator_choices=[], dataset_name="wheat", dataset_hash="hash")
        chain = writer.save_chain(pipeline, steps=[], model_step_idx=0, model_class="PLSRegression", preprocessings="SNV", fold_strategy="per_fold", fold_artifacts={}, shared_artifacts={})
        ids = []
        for index in range(1005):
            ids.append(writer.save_prediction(
                pipeline_id=pipeline, chain_id=chain, dataset_name="wheat", model_name="PLS", model_class="PLSRegression",
                fold_id=str(index), partition="test", val_score=0.25, test_score=0.3, train_score=0.2,
                metric="rmse", task_type="regression", n_samples=50, n_features=200,
                scores={"test": {"rmse": 0.3}}, best_params={"n_components": 3},
                branch_id=None, branch_name=None, exclusion_count=0, exclusion_rate=0.0,
            ))
        # Hold a live WAL, including committed results not checkpointed to main.
        connection = sqlite3.connect(workspace / "store.sqlite")
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA wal_autocheckpoint=0")
        connection.execute("UPDATE predictions SET model_name='LIVE-WAL' WHERE prediction_id=?", (ids[-1],))
        connection.commit()
        before = {p.name: p.read_bytes() for p in workspace.glob("store.sqlite*") if p.suffix != ".sqlite-shm"}
        page = read_prediction_results("results.page", {"workspace_path": str(workspace), "limit": 1000, "offset": 0, "dataset": "wheat", "partition": "test"})
        tail = read_prediction_results("results.page", {"workspace_path": str(workspace), "limit": 1000, "offset": 1000})
        json.dumps(page, allow_nan=False)
        json.dumps(tail, allow_nan=False)
        records = page["records"] + tail["records"]
        assert page["total"] == 1005 and page["has_more"]
        assert len(tail["records"]) == 5 and not tail["has_more"]
        assert {record["id"] for record in records} == set(ids)
        assert any(record["model_name"] == "LIVE-WAL" for record in records)
        assert records[0]["model_classname"] == "PLSRegression"
        assert records[0]["best_params"] == {"n_components": 3}
        assert records[0]["scores"] == {"test": {"rmse": 0.3}}
        empty = read_prediction_results("results.page", {"workspace_path": str(workspace), "limit": 1000, "offset": 0, "partition": "train"})
        assert empty["total"] == 0 and empty["records"] == []
        summary = read_prediction_results("results.summary", {"workspace_path": str(workspace)})
        assert summary["total_predictions"] == 1005
        assert summary["models"] == [{"name": "PLSRegression", "count": 1005, "avg_val_score": 0.25}]
        assert before == {name: (workspace / name).read_bytes() for name in before}
        connection.close()


def test_existing_legacy_predictions_are_not_reported_as_empty(tmp_path: Path):
    (tmp_path / "wheat.meta.parquet").write_bytes(b"legacy storage")
    with pytest.raises(ValueError, match="migration"):
        read_prediction_results("results.page", {"workspace_path": str(tmp_path), "limit": 1000, "offset": 0})


def test_aggregated_chain_detail_and_real_arrays_with_live_writer(tmp_path: Path):
    import numpy as np

    from api.library_aggregated_results import read_aggregated_results

    with WorkspaceStore(tmp_path) as writer:
        run = writer.begin_run("aggregate real", config={}, datasets=[{"name": "wheat"}])
        pipeline = writer.begin_pipeline(run, "PLS", expanded_config=[], generator_choices=[], dataset_name="wheat", dataset_hash="hash")
        chain = writer.save_chain(pipeline, steps=[], model_step_idx=0, model_class="PLSRegression", preprocessings="SNV", fold_strategy="per_fold", fold_artifacts={"0": "models/fold.n4a"}, shared_artifacts={})
        prediction = writer.save_prediction(pipeline, chain, "wheat", "PLS", "PLSRegression", "0", "val", 0.25, None, None, "rmse", "regression", 3, 20, {"val": {"rmse": 0.25}}, {"n_components": 3}, None, None, 0, 0.0)
        writer.array_store.save_batch([{"prediction_id": prediction, "dataset_name": "wheat", "model_name": "PLS", "fold_id": "0", "partition": "val", "metric": "rmse", "val_score": 0.25, "task_type": "regression", "y_true": np.array([1., 2., 3.]), "y_pred": np.array([1.1, 1.9, 3.2]), "sample_indices": np.array([8, 3, 2])}])
        writer.update_chain_summary(chain)
        base = {"workspace_path": str(tmp_path)}
        listed = read_aggregated_results("results.chains", base)
        assert listed["total"] == 1 and listed["predictions"][0]["chain_id"] == chain
        assert listed["predictions"][0]["fold_artifacts"] == {"0": "models/fold.n4a"}
        top = read_aggregated_results("results.top", {**base, "metric": "rmse", "n": 10, "score_column": "cv_val_score"})
        assert top["total"] == 1
        detail = read_aggregated_results("results.chain", {**base, "chain_id": chain})
        assert detail["pipeline"]["pipeline_id"] == pipeline
        assert detail["predictions"][0]["prediction_id"] == prediction
        assert detail["predictions"][0]["test_score"] is None
        assert detail["summary"]["final_test_score"] is None
        partition = read_aggregated_results("results.chain_detail", {**base, "chain_id": chain, "partition": "val", "fold_id": "0"})
        assert partition["total"] == 1
        pipeline_steps = read_aggregated_results("results.pipeline_steps", {**base, "pipeline_id": pipeline})
        assert pipeline_steps["reload"]["source"] == "expanded_snapshot"
        assert pipeline_steps["pipeline"] == []
        chain_steps = read_aggregated_results("results.chain_steps", {**base, "chain_id": chain})
        assert chain_steps["reload"]["is_editable_template"] is False
        arrays = read_aggregated_results("results.arrays", {**base, "prediction_id": prediction})
        assert arrays["n_samples"] == 3
        assert arrays["y_true"] == [1., 2., 3.] and arrays["y_pred"] == [1.1, 1.9, 3.2]
        assert arrays["sample_indices"] == [8, 3, 2]
        with pytest.raises(ValueError, match="not_found"):
            read_aggregated_results("results.arrays", {**base, "prediction_id": "missing"})


def test_verbatim_windows_workspace_paths_reach_the_library_plain(monkeypatch):
    import api.library_aggregated_results as aggregated
    from api.library_documents import adapt_document, plain_windows_path

    assert plain_windows_path("\\\\?\\D:\\a\\ws") == "D:\\a\\ws"
    assert plain_windows_path("\\\\?\\UNC\\srv\\share\\ws") == "\\\\srv\\share\\ws"
    assert plain_windows_path("\\\\?\\Volume{0}\\ws") == "\\\\?\\Volume{0}\\ws"
    assert plain_windows_path("/home/ws") == "/home/ws"
    seen = {}
    monkeypatch.setattr(aggregated, "read_aggregated_results", lambda operation, document: seen.update(document) or {})
    adapt_document("results.chains", {"workspace_path": "\\\\?\\D:\\a\\ws"})
    assert seen["workspace_path"] == "D:\\a\\ws"


def test_dag_chain_and_authoring_pipeline_reload_keep_the_editor_response_contract(tmp_path: Path, monkeypatch):
    import importlib

    from api.library_documents import adapt_document

    snapshot_module = importlib.import_module("nirs4all.api.workspace_chain_snapshot")
    snapshot = [
        {"class": "sklearn.model_selection.KFold", "params": {"n_splits": 3}},
        {"y_processing": "sklearn.preprocessing.StandardScaler"},
        {"class": "nirs4all.operators.transforms.StandardNormalVariate"},
        {"class": "sklearn.preprocessing.StandardScaler"},
        {"model": {"class": "sklearn.cross_decomposition.PLSRegression", "params": {"n_components": 4}}},
    ]
    calls = []

    def owner_snapshot(workspace_path, chain_id):
        calls.append((workspace_path, chain_id))
        return snapshot

    monkeypatch.setattr(snapshot_module, "workspace_chain_snapshot", owner_snapshot)
    template = {"pipeline": [{"_or_": ["StandardScaler", "MinMaxScaler"]}, {"model": "PLSRegression"}]}
    with WorkspaceStore(tmp_path) as writer:
        run = writer.begin_run("stored editor reload", config={}, datasets=[{"name": "Corn"}])
        pipeline = writer.begin_pipeline(
            run, "Editable Corn template", expanded_config=snapshot, generator_choices=[],
            dataset_name="Corn", dataset_hash="corn", original_template=template,
        )
        chain = writer.save_chain(
            pipeline, steps=[{"dagml_host_replay": {"artifact": "models/verified.n4a"}}], model_step_idx=4,
            model_class="sklearn.cross_decomposition.PLSRegression", preprocessings="SNV+StandardScaler",
            fold_strategy="per_fold", fold_artifacts={}, shared_artifacts={},
        )
    before = (tmp_path / "store.sqlite").read_bytes()
    document = {"workspace_path": str(tmp_path)}
    # Exercise the JSON document exchanged by the Rust stdio host, not an HTTP fallback.
    response = json.loads(json.dumps(adapt_document("results.chain_steps", {**document, "chain_id": chain})))
    assert response == {
        "chain_id": chain, "name": "SNV+StandardScaler → PLSRegression", "pipeline": snapshot,
        "reload": {"source": "chain_snapshot", "selection_scope": "preprocessing_chain_plus_selected_model", "is_editable_template": False},
    }
    assert calls == [(str(tmp_path), chain)]
    pipeline_response = adapt_document("results.pipeline_steps", {**document, "pipeline_id": pipeline})
    assert pipeline_response == {
        "pipeline_id": pipeline, "name": "Editable Corn template", "pipeline": template["pipeline"],
        "reload": {"source": "authoring_template", "is_editable_template": True, "is_legacy_fallback": False},
    }
    assert (tmp_path / "store.sqlite").read_bytes() == before
    monkeypatch.setattr(snapshot_module, "workspace_chain_snapshot", lambda *args: None)
    with pytest.raises(ValueError, match="not_found: Chain snapshot"):
        adapt_document("results.chain_steps", {**document, "chain_id": chain})
