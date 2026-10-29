"""Exercise the scientific owner using the artificial manual-QA datasets."""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import Ridge

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api.library_dataset_inspection import inspect_dataset_document  # noqa: E402
from api.library_documents import configure_dataset  # noqa: E402


def verify(root: Path) -> list[dict]:
    """Verify preservation, explicit refusal, and classification projections."""
    from nirs4all.api.dataset_inspection import load_dataset_for_analysis

    expected = json.loads((root / "expected.json").read_text(encoding="utf-8"))
    results = []
    for folder in sorted(path for path in root.iterdir() if path.is_dir()):
        files = [{"path": str(file), "type": {"X": "X", "Y": "Y", "M": "metadata"}[file.name[0]],
                  "split": "train" if "cal" in file.name else "test"} for file in folder.glob("*.csv")]
        parsing = {"delimiter": ";", "decimal_separator": "," if folder.name == "decimal-comma" else ".",
                   "has_header": folder.name != "headerless", "na_policy": "ignore" if folder.name == "missing-spectra" else "auto"}
        config = {"files": files, "global_params": parsing,
                  "task_type": "binary_classification" if folder.name == "sparse-classes" else "regression"}
        try:
            configured = configure_dataset({"record": {"path": str(folder), "config": config}})
            preview = inspect_dataset_document("dataset.preview", {"config": configured})
            assert preview["summary"]["num_samples"] == 48, preview
            assert preview["summary"]["train_samples"] == 36
            assert preview["summary"]["test_samples"] == 12
            distribution = preview["target_distribution"]
            if folder.name == "sparse-classes":
                assert distribution["missing_count"] == 5, distribution
                assert len(distribution["classes"]) == 2, distribution
                assert sum(distribution["class_counts"].values()) == 31
            elif folder.name != "clean":
                assert distribution["missing_count"] == 5, distribution
            dropped_files = [dict(file, **({"overrides": {"na_policy": "remove_sample"}}
                if file["type"] == "Y" or (folder.name == "missing-spectra" and file["type"] == "X") else {})) for file in files]
            dropped_config = configure_dataset({"record": {"path": str(folder), "config": {**config, "files": dropped_files}}})
            dataset, reader = load_dataset_for_analysis(dropped_config)
            assert reader["backend"] == "nirs4all-io.native", reader
            kept_key = "keptSamplesXY" if folder.name == "missing-spectra" else "keptSamplesY"
            arrays = {}
            for partition, split in [("train", "cal"), ("test", "val")]:
                indices = expected[f"{folder.name}/{split}"][kept_key]
                x = np.asarray(dataset.x({"partition": partition}))
                y = np.asarray(dataset.y({"partition": partition}))
                assert x.shape == (len(indices), 16), x.shape
                assert y.shape[0] == len(indices), y.shape
                assert np.isfinite(x).all() and not pd.isna(y).any()
                spectral_values = [round(2 + index * 0.05 + np.sin(index / 20), 5) for index in indices]
                np.testing.assert_allclose(x[:, 0], spectral_values, rtol=1e-6)
                if folder.name != "headerless":
                    identifiers = dataset.metadata_column("sample_id", {"partition": partition})
                    assert list(identifiers) == [f"sample-{index:03}" for index in indices], identifiers
                arrays[partition] = x, y
            model = RandomForestClassifier(n_estimators=12, random_state=42) if folder.name == "sparse-classes" else Ridge(alpha=1)
            train_x, train_y = arrays["train"]
            model.fit(train_x, train_y.ravel() if folder.name == "sparse-classes" else train_y)
            prediction = model.predict(arrays["test"][0])
            assert prediction.shape[0] == len(arrays["test"][0]) and not pd.isna(prediction).any()
            if folder.name == "missing-spectra":
                strict = {**config, "global_params": {**parsing, "na_policy": "auto"}}
                strict_config = configure_dataset({"record": {"path": str(folder), "config": strict}})
                try:
                    inspect_dataset_document("dataset.preview", {"config": strict_config})
                except ValueError as error:
                    assert "NA" in str(error)
                else:
                    raise AssertionError("Strict spectral loading must report missing X values")
            results.append({"case": folder.name, "success": True, "summary": preview["summary"], "targets": distribution,
                            "removal": {"train": len(train_x), "test": len(prediction), "model": type(model).__name__, "fit_predict": "passed"}})
        except Exception as error:
            results.append({"case": folder.name, "success": False, "error": str(error)})
    return results


if __name__ == "__main__":
    dataset_root = Path(sys.argv[1]).resolve()
    report = verify(dataset_root)
    serialized = json.dumps(report, indent=2)
    (dataset_root.parent / "library-fixture-results.json").write_text(serialized, encoding="utf-8")
    print(serialized)
    raise SystemExit(0 if all(row["success"] for row in report) else 1)
