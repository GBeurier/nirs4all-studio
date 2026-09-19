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
