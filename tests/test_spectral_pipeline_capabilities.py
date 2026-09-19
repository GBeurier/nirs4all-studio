"""Unsupported palette contexts fail before fitting, with an actionable reason."""
from __future__ import annotations

import asyncio

import pytest

import api.shared  # noqa: F401
from api import runs, system
from api.nirs4all_adapter import check_pipeline_imports
from api.operator_capabilities import pipeline_capability_issues


def operator(name, kind="preprocessing", module="sklearn.preprocessing"):
    return {"id": name, "name": name, "type": kind, "classPath": f"{module}.{name}"}


@pytest.mark.parametrize("step, expected", [
    (operator("TSNE", module="sklearn.manifold"), "unseen spectra"),
    (operator("EPO", module="nirs4all.operators.transforms.orthogonalization"), "distinct from prediction targets"),
    *[({"id": name, "name": name, "type": "flow", "subType": "generator", "classPath": name}, "parameter editor")
      for name in ("_range_", "_log_range_", "_sample_", "_grid_", "_zip_")],
    (operator("PatchExtractor", module="sklearn.feature_extraction.image"), "image height"),
    (operator("CountVectorizer", module="sklearn.feature_extraction.text"), "text"),
    (operator("DictVectorizer", module="sklearn.feature_extraction"), "dictionaries"),
    (operator("LabelEncoder"), "target labels"),
    (operator("Normalizer", "y_processing"), "original prediction units"),
    (operator("Binarizer", "y_processing"), "invertible"),
])
def test_preflight_and_palette_explain_context_instead_of_installing(step, expected, monkeypatch):
    async def coherent():
        return {"coherent": True}

    monkeypatch.setattr(system, "check_env_coherence", coherent)
    monkeypatch.setattr(system, "_load_operator_reference", lambda: {"nodes": [step]})
    result = asyncio.run(runs.run_preflight(runs.PreflightRequest(inline_pipeline={"name": "Invalid context", "steps": [step]})))
    assert not result["ready"]
    assert result["issues"][0]["type"] == "unsupported_operator"
    assert expected in result["issues"][0]["message"]
    assert "Install it" not in result["issues"][0]["message"]
    availability = asyncio.run(system.system_operator_availability())
    assert availability["unavailable"] == []  # not a missing package
    assert availability["capabilities"][0]["level"] == "metadata"
    assert expected in availability["capabilities"][0]["reason"]


def test_nested_late_invalid_operator_is_rejected_before_any_fit(monkeypatch):
    import nirs4all

    def never_fit(**kwargs):
        pytest.fail("Execution must stop before any scientific fit")

    monkeypatch.setattr(nirs4all, "run", never_fit)
    steps = [operator("Ridge", "model", "sklearn.linear_model"), {
        "type": "flow", "subType": "branch", "branches": [[operator("TSNE", module="sklearn.manifold")]]}]
    pipeline = runs.PipelineRun(id="invalid", pipeline_id="invalid", pipeline_name="invalid", model="Ridge",
                                preprocessing="TSNE", split_strategy="none", status="queued", config={"steps": steps})
    with pytest.raises(ValueError, match="unseen spectra"):
        runs._execute_pipeline_training(pipeline, "unused", None, "unused", engine="legacy")


def test_valid_spectral_and_invertible_target_contexts_stay_available():
    steps = [operator("Normalizer"), operator("Binarizer"), operator("StandardScaler", "y_processing"),
             operator("PCA", module="sklearn.decomposition"), operator("TfidfTransformer", module="sklearn.feature_extraction.text")]
    assert pipeline_capability_issues(steps) == []
    assert check_pipeline_imports(steps) == []


def test_parameter_generators_remain_valid_inside_parameters():
    steps = [operator("Ridge", "model", "sklearn.linear_model")]
    steps[0]["params"] = {"alpha": {"_range_": [1, 3]}}
    assert pipeline_capability_issues(steps) == []
    assert check_pipeline_imports(steps) == []
