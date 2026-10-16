"""Inspection adapter is a closed projection, not a second science engine."""

import pytest

from api.library_dataset_inspection import inspect_dataset_document


@pytest.mark.parametrize("operation,symbol,options", [
    ("dataset.preview", "preview_dataset", {"max_samples": 12}),
    ("dataset.stats", "dataset_statistics", {"partition": "test"}),
])
def test_projection_delegates_exact_config_and_options(monkeypatch, operation, symbol, options):
    import nirs4all.api.dataset_inspection as library
    config = {"train_x": "/authorized/X.csv"}
    result = {"reader": {"backend": "witness"}, "summary": {"num_samples": 150}}
    def witness(**kwargs):
        assert kwargs == {"config": config, **options}
        return result
    monkeypatch.setattr(library, symbol, witness)
    assert inspect_dataset_document(operation, {"config": config, **options}) is result


@pytest.mark.parametrize("operation,payload", [
    ("dataset.unknown", {}),
    ("dataset.preview", {"config": {}, "silent_fallback": True}),
    ("dataset.preview", {"config": "/unresolved/folder"}),
    ("dataset.inspect_format", {}),
])
def test_invalid_operation_or_fields_fail_closed(operation, payload):
    with pytest.raises(ValueError):
        inspect_dataset_document(operation, payload)


def test_reader_failure_propagates_without_retry(monkeypatch):
    import nirs4all.api.dataset_inspection as library
    def fail(**kwargs):
        raise ValueError("native shape budget")
    monkeypatch.setattr(library, "preview_dataset", fail)
    with pytest.raises(ValueError, match="native shape budget"):
        inspect_dataset_document("dataset.preview", {"config": {"train_x": "/authorized/X.csv"}})


def test_multimodal_inspection_refuses_extra_fields():
    descriptor = {"schema": "nirs4all.studio-multimodal-dataset.v1", "cohort": {}}
    with pytest.raises(ValueError, match="Unexpected"):
        inspect_dataset_document("dataset.inspect_multimodal", {"dataset_document": descriptor, "path": "/etc"})


def test_multimodal_inspection_restores_real_typed_cohort():
    import numpy as np
    from nirs4all_io import MultimodalDataset, TensorSource

    cohort = MultimodalDataset({"nir": TensorSource(np.array([[1.0], [2.0]]), ["a", "b"], representation_id="signal_1d")},
                               sample_ids=["a", "b"], partitions=["train", "test"])
    result = inspect_dataset_document("dataset.inspect_multimodal", {"dataset_document": {
        "schema": "nirs4all.studio-multimodal-dataset.v1", "cohort": cohort.to_dict(),
    }})
    assert result["summary"]["num_samples"] == 2
    assert result["summary"]["train_samples"] == 1
    assert result["summary"]["test_samples"] == 1


def test_wizard_import_preserves_sparse_multitarget_rows_and_metadata(tmp_path):
    """Exercise the actual IO owner after the wizard supplies role NA defaults."""
    from api.library_documents import configure_dataset

    (tmp_path / "Xcal.csv").write_text("1000;1001\n1;2\n3;4\n5;6\n")
    (tmp_path / "Ycal.csv").write_text("protein;fat\n1.5;10\n;20\n3.5;\n")
    (tmp_path / "Mcal.csv").write_text("subject;batch\na;A\nb;\nc;C\n")
    config = {"name": "sparse targets", "task_type": "regression", "global_params": {"delimiter": ";", "has_header": True, "na_policy": "auto"},
              "files": [{"path": str(tmp_path / filename), "type": role, "split": "train",
                         "overrides": {"delimiter": ";", "has_header": True, "na_policy": "auto" if role == "X" else "ignore"}}
                        for filename, role in [("Xcal.csv", "X"), ("Ycal.csv", "Y"), ("Mcal.csv", "metadata")]]}
    configured = configure_dataset({"record": {"path": str(tmp_path), "config": config}})
    result = inspect_dataset_document("dataset.preview", {"config": configured, "max_samples": 3})
    assert result["success"] is True
    assert result["summary"]["num_samples"] == 3
    assert result["summary"]["metadata_columns"] == ["subject", "batch"]
    assert len(result["target_distributions"]) == 2
    assert result["target_distribution"]["missing_count"] == 1
    assert result["target_distribution"]["mean"] == 2.5
    assert result["target_distributions"]["target_1"]["mean"] == 15


@pytest.mark.parametrize("stored_shape", ["files", "library"])
@pytest.mark.parametrize("policy", ["auto", "ignore", "abort"])
def test_reopened_dataset_retains_sparse_rows_or_reports_explicit_abort(tmp_path, stored_shape, policy):
    """Existing records must behave like a fresh wizard import, for both splits."""
    from api.library_documents import configure_dataset
    files = []
    library = {"global_params": {"delimiter": ";", "has_header": True, "na_policy": policy}, "task_type": "regression"}
    for split, suffix in [("train", "cal"), ("test", "val")]:
        for role, header, rows in [
            ("X", "1000;1001", "1;2\n3;4\n5;6"),
            ("Y", "protein;fat", "1.5;10\nNA;20\n3.5;"),
            ("metadata", "sample_id;batch", "a;A\nb;\nc;C"),
        ]:
            filename = f"{'M' if role == 'metadata' else role}{suffix}.csv"
            (tmp_path / filename).write_text(f"{header}\n{rows}\n")
            files.append({"path": str(tmp_path / filename), "type": role, "split": split})
            library[f"{split}_{'group' if role == 'metadata' else role.lower()}"] = str(tmp_path / filename)
    config = {**library, "files": files} if stored_shape == "files" else library
    configured = configure_dataset({"record": {"path": str(tmp_path), "config": config}})
    if policy == "abort":
        with pytest.raises(ValueError, match="NA"):
            inspect_dataset_document("dataset.preview", {"config": configured})
    else:
        result = inspect_dataset_document("dataset.preview", {"config": configured})
        assert result["summary"]["num_samples"] == 6
        assert result["summary"]["train_samples"] == result["summary"]["test_samples"] == 3
        assert result["target_distribution"]["missing_count"] == 1
        assert result["target_distribution"]["mean"] == 2.5
