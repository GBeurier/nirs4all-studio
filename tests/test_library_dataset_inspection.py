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
