"""Explicit spectral-pipeline constraints, distinct from missing dependencies.

These checks do not instantiate estimators or fit data. They apply equally to
palette availability, saved-pipeline preflight and actual execution.
"""
from __future__ import annotations

from typing import Any

_TEXT_INPUT = {"CountVectorizer", "HashingVectorizer", "TfidfVectorizer", "DictVectorizer", "FeatureHasher"}
_TARGET_INPUT = {"LabelEncoder", "LabelBinarizer", "MultiLabelBinarizer"}
_ANALYSIS_ONLY = {"TSNE", "MDS", "SpectralEmbedding"}
_NONINVERTIBLE_TARGET = {"Normalizer", "Binarizer"}


def spectral_pipeline_constraint(step_type: str, class_path: str) -> str | None:
    """Explain why an imported operator cannot execute at this pipeline position."""
    if step_type == "flow" and class_path in {"_range_", "_log_range_", "_sample_", "_grid_", "_zip_"}:
        return (f"{class_path} generates parameter values, not executable pipeline steps. "
                "Use it inside a model or transformer parameter through the parameter editor; remove this standalone node.")
    if step_type == "preprocessing" and class_path == "nirs4all.operators.transforms.orthogonalization.EPO":
        return ("EPO requires external calibration measurements d, distinct from prediction targets y. "
                "Studio does not yet map those measurements into EPO.fit(X, d). Configure EPO with external measurements "
                "through the Python API, or remove this step from the Studio pipeline; do not substitute target labels for d.")
    if not class_path.startswith("sklearn."):
        return None
    name = class_path.rsplit(".", 1)[-1]
    if step_type == "preprocessing" and name in _ANALYSIS_ONLY:
        return (f"{name} fits an embedding of the supplied samples but has no transform for unseen spectra. "
                "It cannot be a predictive preprocessing step. Use PCA or another transformer with out-of-sample transform; "
                "keep this embedding as a separate exploratory analysis.")
    if step_type == "preprocessing" and name == "PatchExtractor":
        return ("PatchExtractor requires image height and width dimensions; Studio spectral pipelines pass a two-dimensional "
                "samples-by-wavelengths matrix. Extract image patches separately before importing numeric spectra.")
    if step_type == "preprocessing" and name in _TEXT_INPUT:
        return (f"{name} requires text, dictionaries or token sequences, whereas Studio spectral pipelines pass numeric spectra. "
                "Encode those non-spectral inputs separately, then import the resulting numeric features.")
    if step_type == "preprocessing" and name in _TARGET_INPUT:
        return (f"{name} encodes target labels rather than a numeric spectral feature matrix. "
                "Use a target-processing step with compatible labels, or remove it from spectral preprocessing.")
    if step_type == "y_processing" and name in _NONINVERTIBLE_TARGET:
        return (f"{name} cannot invert transformed targets back to the original prediction units. "
                "Use an invertible target transformer such as StandardScaler, or use this operator on spectral features instead.")
    return None


def pipeline_capability_issues(steps: list[dict[str, Any]]) -> list[dict[str, str | None]]:
    """Walk nested editor steps and return actionable structural constraints."""
    from .pipeline_canonical import resolve_editor_class_path

    issues: list[dict[str, str | None]] = []
    for step in steps:
        kind = str(step.get("type", ""))
        if kind in {"preprocessing", "y_processing", "flow"}:
            reference = resolve_editor_class_path(kind, str(step.get("name", "")), step.get("classPath"))
            reason = spectral_pipeline_constraint(kind, reference)
            if reason:
                issues.append({"issue_type": "unsupported_operator", "step_id": step.get("id"),
                               "step_name": str(step.get("name", "")), "step_type": kind,
                               "class_path": reference, "error": reason})
        issues.extend(pipeline_capability_issues(step.get("children", [])))
        for branch in step.get("branches", []):
            if isinstance(branch, list):
                issues.extend(pipeline_capability_issues(branch))
        for branch in (step.get("namedBranches") or {}).values():
            if isinstance(branch, list):
                issues.extend(pipeline_capability_issues(branch))
    return issues
