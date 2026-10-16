"""Exercise the scientific owner using the artificial manual-QA datasets."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api.library_dataset_inspection import inspect_dataset_document  # noqa: E402
from api.library_documents import configure_dataset  # noqa: E402


def verify(root: Path) -> list[dict]:
    """Verify preservation, explicit refusal, and classification projections."""
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
            if folder.name == "missing-spectra":
                strict = {**config, "global_params": {**parsing, "na_policy": "auto"}}
                strict_config = configure_dataset({"record": {"path": str(folder), "config": strict}})
                try:
                    inspect_dataset_document("dataset.preview", {"config": strict_config})
                except ValueError as error:
                    assert "NA" in str(error)
                else:
                    raise AssertionError("Strict spectral loading must report missing X values")
            results.append({"case": folder.name, "success": True, "summary": preview["summary"], "targets": distribution})
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
