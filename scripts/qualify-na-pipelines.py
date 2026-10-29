"""Run real Studio scientific jobs from the tailored NA files in owned workspaces."""
import json
import sys
from pathlib import Path

import nirs4all
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from api.library_documents import configure_dataset  # noqa: E402


def qualify(fixtures: Path, output: Path) -> list[dict]:
    """Train, persist and inspect each fixture through the strict product API."""
    output.mkdir(parents=True, exist_ok=False)
    results = []
    for folder in sorted(path for path in fixtures.iterdir() if path.is_dir()):
        classification = folder.name == "sparse-classes"
        files = [{"path": str(file), "type": {"X": "X", "Y": "Y", "M": "metadata"}[file.name[0]],
                  "split": "train" if "cal" in file.name else "test",
                  **({"overrides": {"na_policy": "remove_sample"}} if file.name.startswith("Y") or (folder.name == "missing-spectra" and file.name.startswith("X")) else {})}
                 for file in folder.glob("*.csv")]
        config = configure_dataset({"record": {"path": str(folder), "config": {
            "files": files, "task_type": "binary_classification" if classification else "regression",
            "global_params": {"delimiter": ";", "has_header": folder.name != "headerless", "decimal_separator": "," if folder.name == "decimal-comma" else "."},
        }}})
        response = nirs4all.studio_scientific_job_v2({
            "schema": "nirs4all.studio-scientific-job.v2", "operation": "run", "job_id": f"na-{folder.name}",
            "pipeline": ["sklearn.preprocessing.StandardScaler",
                         {"class": "sklearn.model_selection.StratifiedKFold" if classification else "sklearn.model_selection.KFold", "params": {"n_splits": 3}},
                         "sklearn.linear_model.LogisticRegression" if classification else "sklearn.linear_model.Ridge"],
            "dataset": config, "options": {"workspace_path": str(output / folder.name), "project": "na-qualification", "verbose": 0, "save_charts": False},
        })
        assert response["engine"] == "dag-ml" and response["result"]["native_score_sets_available"], response
        result = response["result"]
        assert result["run_ids"] and result["prediction_count"] > 0 and np.isfinite(result["validation_score"]), result
        from nirs4all.pipeline.storage import WorkspaceStore

        with WorkspaceStore(output / folder.name) as store:
            assert all(store.get_run(run_id)["status"] == "completed" for run_id in result["run_ids"])
            assert store.query_predictions().height == result["prediction_count"]
        results.append({"case": folder.name, "sdk": nirs4all.__version__, **result})
        print(json.dumps({"case": folder.name, "sdk": nirs4all.__version__, "status": "passed", "predictions": result["prediction_count"]}), flush=True)
    (output / "qualification.json").write_text(json.dumps(results, indent=2, allow_nan=False), encoding="utf-8")
    return results


if __name__ == "__main__":
    qualify(Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve())
