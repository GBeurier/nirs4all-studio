"""History imports share one library host and preserve strict launch normalization."""

import pytest

from api import library_documents


def test_history_batch_preserves_order_and_skips_invalid_imports(monkeypatch):
    def import_pipeline(document):
        if document["payload"] == "invalid":
            raise ValueError("Unsupported template")
        return {"success": True, "steps": [document["payload"]]}

    monkeypatch.setattr(library_documents, "import_pipeline", import_pipeline)
    requests = [{"operation": "pipeline.import", "payload": {"payload": value}} for value in ["first", "invalid", "last"]]
    assert library_documents.adapt_document("documents.batch", {"requests": requests}) == [
        {"success": True, "steps": ["first"]},
        {"success": False, "error": "Unsupported template"},
        {"success": True, "steps": ["last"]},
    ]


def test_launch_batch_still_rejects_invalid_normalization(monkeypatch):
    def normalize_pipeline(_document):
        raise ValueError("Invalid pipeline")

    monkeypatch.setattr(library_documents, "normalize_pipeline", normalize_pipeline)
    with pytest.raises(ValueError, match="Invalid pipeline"):
        library_documents.adapt_document("documents.batch", {"requests": [{"operation": "pipeline.normalize", "payload": {"steps": []}}]})


def test_missing_optional_model_blocks_execution_but_preserves_editing(monkeypatch):
    from nirs4all.api import studio_scientific_general

    real_import = studio_scientific_general.import_module

    def missing_tabpfn(name):
        if name == "tabpfn":
            raise ModuleNotFoundError("No module named 'tabpfn'")
        return real_import(name)

    monkeypatch.setattr(studio_scientific_general, "import_module", missing_tabpfn)
    document = {"steps": [{"id": "model-1", "type": "model", "name": "TabPFNRegressor", "classPath": "tabpfn.TabPFNRegressor", "params": {}}]}
    editable = library_documents.normalize_pipeline(document)
    assert "execution_validation" not in editable
    result = library_documents.normalize_pipeline({**document, "scientific_run": True})
    assert result["execution_validation"]["valid"] is False
    assert result["execution_validation"]["code"] == "dependency_missing"
    assert "tabpfn" in result["execution_validation"]["message"]
    assert "Traceback" not in result["execution_validation"]["message"]
    assert result["runtime_pipeline"] == editable["runtime_pipeline"]


def test_available_optional_model_passes_execution_check(monkeypatch):
    from types import SimpleNamespace
    from nirs4all.api import studio_scientific_general

    real_import = studio_scientific_general.import_module
    monkeypatch.setattr(studio_scientific_general, "import_module", lambda name: SimpleNamespace(TabPFNRegressor=object) if name == "tabpfn" else real_import(name))
    document = {"steps": [{"id": "model-1", "type": "model", "name": "TabPFNRegressor", "classPath": "tabpfn.TabPFNRegressor", "params": {}}], "scientific_run": True}
    assert library_documents.normalize_pipeline(document)["execution_validation"] == {"valid": True}
