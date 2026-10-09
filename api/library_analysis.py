"""Pure projections for Rust-owned analysis routes and jobs.

All scientific generation, captured-model replay, SHAP and robustness calculations
are delegated to nirs4all. This module has no HTTP listener or application state.
"""
from __future__ import annotations

import importlib.util
import time
from pathlib import Path
from typing import Any

import numpy as np

from .shared.json_safe import sanitize_dict

SYNTHESIS_METHODS = {
    "features": "with_features", "targets": "with_targets", "classification": "with_classification",
    "metadata": "with_metadata", "sources": "with_sources", "partitions": "with_partitions",
    "batch_effects": "with_batch_effects", "nonlinear_targets": "with_nonlinear_targets",
    "target_complexity": "with_target_complexity", "complex_landscape": "with_complex_target_landscape",
    "output": "with_output",
}


def synthesis_builder(config: dict[str, Any], samples: int | None = None) -> Any:
    """Apply only known builder methods; nirs4all validates their parameters."""
    from nirs4all.synthesis import SyntheticDatasetBuilder

    builder = SyntheticDatasetBuilder(n_samples=samples or config.get("n_samples", 1000),
                                      random_state=config.get("random_state"), name=config.get("name", "synthetic_nirs"))
    for step in config.get("steps", []):
        if not step.get("enabled", True):
            continue
        method = SYNTHESIS_METHODS.get(step["type"])
        if method is None or step.get("method", method) != method:
            raise ValueError("Unsupported synthesis step")
        params = {key: value for key, value in step.get("params", {}).items() if value is not None}
        for key in ("range", "wavelength_range"):
            if isinstance(params.get(key), list):
                params[key] = tuple(params[key])
        if step["type"] == "features" and params.get("complexity") == "custom":
            params["complexity"] = "realistic"
        getattr(builder, method)(**params)
    return builder


def synthesis(operation: str, document: dict[str, Any]) -> Any:
    """Adapt the Lab builder contract without replacing its scientific owner."""
    if operation == "synthesis.status":
        available = importlib.util.find_spec("nirs4all.synthesis") is not None
        return {"available": available, "message": "Synthesis API is ready" if available else "Synthesis library unavailable"}
    if operation == "synthesis.components":
        from nirs4all.synthesis import available_components, get_component

        return [{"name": name, "display_name": name.replace("_", " ").title(),
                 "description": get_component(name).formula or f"{len(get_component(name).bands)} absorption bands",
                 "category": get_component(name).category or "other"} for name in available_components()]
    config = document.get("config", document)
    enabled = {step["type"] for step in config.get("steps", []) if step.get("enabled", True)}
    if operation == "synthesis.validate":
        errors = ["Cannot enable both regression targets and classification"] if {"targets", "classification"} <= enabled else []
        try:
            synthesis_builder(config)
        except (TypeError, ValueError) as error:
            errors.append(str(error))
        return {"valid": not errors, "errors": errors, "warnings": []}
    if {"targets", "classification"} <= enabled:
        raise ValueError("Cannot enable both regression targets and classification")
    started = time.monotonic()
    count = document.get("preview_samples", 100) if operation == "synthesis.preview" else None
    builder = synthesis_builder(config, count)
    # Studio's preview/export contract consumes dataset axes. This changes only
    # the library return representation, never its generated scientific values.
    builder.with_output(as_dataset=True)
    dataset = builder.build()
    X = np.asarray(dataset.x({}, layout="2d"))
    y = np.asarray(dataset.y({}))
    y = y[:, 0] if y.ndim > 1 else y
    if operation == "synthesis.generate":
        output = Path(document["output_path"]) if document.get("output_path") else None
        if output is not None:
            builder.export(str(output), format="standard")
        return {"shape": list(X.shape), "execution_time_ms": (time.monotonic() - started) * 1000,
                "export_path": str(output) if output is not None else None, "target_type": "classification" if "classification" in enabled else "regression"}
    headers = dataset.headers(0)
    try:
        wavelengths = [float(value) for value in headers]
    except (TypeError, ValueError):
        wavelengths = []
    axis_unit = "nm"
    if len(wavelengths) != X.shape[1]:
        wavelengths = list(range(X.shape[1]))
        axis_unit = "index"
    stats = None
    if document.get("include_statistics", True):
        stats = {"n_wavelengths": len(wavelengths), "n_components": None, "class_distribution": None}
        for label, values in (("spectra", X), ("targets", y)):
            for metric, fn in (("mean", np.mean), ("std", np.std), ("min", np.min), ("max", np.max)):
                stats[f"{label}_{metric}"] = float(fn(values)) if values.size else 0.0
        if "classification" in enabled:
            keys, counts = np.unique(y, return_counts=True)
            stats["class_distribution"] = dict(zip(map(str, keys.tolist()), counts.tolist(), strict=True))
    return sanitize_dict({"success": True, "spectra": X.tolist(), "wavelengths": wavelengths,
                          "axis_unit": axis_unit,
                          "targets": y.tolist(), "target_type": "classification" if "classification" in enabled else "regression",
                          "statistics": stats, "actual_samples": config.get("n_samples", 1000),
                          "execution_time_ms": (time.monotonic() - started) * 1000, "error": None})


def binned(values: np.ndarray, wavelengths: list[float], config: dict[str, Any]) -> dict[str, Any]:
    """Project raw SHAP contributions into the existing display bins."""
    size, stride, aggregation = config.get("bin_size", 20), config.get("bin_stride", 10), config.get("bin_aggregation", config.get("aggregation", "mean_abs"))
    centers, ranges, scores = [], [], []
    for start in range(0, values.shape[1], stride):
        end = min(start + size, values.shape[1])
        part = values[:, start:end]
        transformed = np.abs(part) if aggregation in {"sum_abs", "mean_abs"} else part
        score = transformed.sum(axis=1).mean() if aggregation in {"sum", "sum_abs"} else transformed.mean()
        centers.append(float(np.mean(wavelengths[start:end])))
        ranges.append([wavelengths[start], wavelengths[end - 1]])
        scores.append(float(score))
    return {"bin_centers": centers, "bin_values": scores, "bin_ranges": ranges, "bin_size": size, "bin_stride": stride, "aggregation": aggregation}


def shap_axis(data: Any, width: int) -> tuple[list[float], str | None]:
    """Project the owner's numeric axis and unit, or an explicit feature index."""
    try:
        coordinates = [float(value) for value in data.headers(0)]
    except (TypeError, ValueError):
        coordinates = []
    if len(coordinates) != width or not np.isfinite(coordinates).all():
        return list(map(float, range(width))), "index"
    unit = data.header_unit(0)
    return coordinates, unit if isinstance(unit, str) and unit else None


def shap_compute(document: dict[str, Any]) -> dict[str, Any]:
    """Explain a captured full predictor with the library's general SHAP API."""
    import nirs4all
    from nirs4all.api.dataset_inspection import load_dataset_for_analysis

    started = time.monotonic()
    data, _ = load_dataset_for_analysis(document["config"], max_input_bytes=512 * 1024 * 1024)
    selector = {} if document.get("partition") == "all" else {"partition": document.get("partition", "test")}
    X = np.asarray(data.x(selector, layout="2d"))
    y = np.asarray(data.y(selector))
    indices = list(range(len(X)))
    if document.get("n_samples") and len(X) > document["n_samples"]:
        indices = sorted(np.random.default_rng(42).choice(len(X), document["n_samples"], replace=False).tolist())
    if not X.size or X.size > 2_000_000:
        raise ValueError("SHAP partition is empty or exceeds the 2 million cell input budget; choose a smaller partition")
    if len(indices) * X.shape[1] > 500_000:
        raise ValueError("SHAP explanation exceeds the bounded result budget; reduce n_samples")
    wavelengths, axis_unit = shap_axis(data, X.shape[1])
    names = [f"Feature {index}" if axis_unit == "index" else f"{value:.1f} {axis_unit or ''}".strip() for index, value in enumerate(wavelengths)]
    source = {"chain_id": document["model_id"], "workspace_path": document["workspace_path"]} if document["model_source"] == "chain" else document["bundle_path"]
    session = None
    if document["model_source"] == "bundle":
        from nirs4all.api.session import Session

        # The library's captured explanation loader verifies this selection
        # fingerprint on its private archive snapshot before deserialization.
        session = Session(name="Studio SHAP", engine="dag-ml")
        session._general_archive_fingerprint = document["archive_fingerprint"]
    explanation = nirs4all.explain(model=source, data=X, engine="dag-ml", verbose=0, plots_visible=False,
                                  session=session,
                                  explainer_type=document.get("explainer_type", "auto"),
                                  background_samples=document.get("n_background", 100), feature_names=names,
                                  workspace_path=document["workspace_path"], visualizations=[], sample_indices=indices)
    X, y = X[indices], y[indices] if y.size else y
    if y.ndim > 1:
        y = y[:, 0]
    values = np.asarray(explanation.shap_values)
    if values.shape != X.shape or not np.isfinite(values).all():
        raise ValueError("SHAP owner returned invalid contribution dimensions")
    base = float(np.asarray(explanation.base_value).reshape(-1)[0])
    importance = np.abs(values).mean(axis=0)
    feature_importance = [{"feature_idx": int(index), "feature_name": names[index], "wavelength": wavelengths[index],
                           "importance": float(importance[index])} for index in np.argsort(importance)[::-1][:20]]
    if document["model_source"] == "chain":
        predicted = nirs4all.predict(chain_id=document["model_id"], workspace_path=document["workspace_path"], data=X, engine="dag-ml", verbose=0).y_pred
    else:
        from nirs4all.pipeline.dagml.general_archive import predict_general_archive

        predicted = predict_general_archive(document["bundle_path"], X, expected_archive_fingerprint=document["archive_fingerprint"]).y_pred
    predicted = np.asarray(predicted).reshape(len(X), -1)[:, 0]
    return sanitize_dict({"job_id": document["job_id"], "model_id": document["model_id"], "dataset_id": document["dataset_id"],
                          "explainer_type": explanation.explainer_type, "n_samples": len(X), "n_features": X.shape[1], "base_value": base,
                          "execution_time_ms": (time.monotonic() - started) * 1000, "feature_importance": feature_importance,
                          "wavelengths": wavelengths, "axis_unit": axis_unit, "mean_abs_shap": importance.tolist(), "mean_spectrum": X.mean(axis=0).tolist(),
                          "binned_importance": binned(values, wavelengths, document), "sample_indices": indices,
                          "_raw_shap_values": values.tolist(), "_raw_X": X.tolist(), "_y_true": y.reshape(-1).tolist() if y.size else None,
                          "_y_pred": np.asarray(predicted).reshape(-1).tolist() if predicted is not None else None})


def shap_view(document: dict[str, Any]) -> dict[str, Any]:
    """Return the same durable SHAP result through its visualization contracts."""
    result = document["result"]
    view = document.get("view", "results")
    values, X = np.asarray(result["_raw_shap_values"]), np.asarray(result["_raw_X"])
    wavelengths = result["wavelengths"]
    axis_unit = result.get("axis_unit")
    if view == "results":
        return {**{key: value for key, value in result.items() if not key.startswith("_")}, "axis_unit": axis_unit}
    if view == "spectral":
        return {**{key: result[key] for key in ("wavelengths", "mean_spectrum", "mean_abs_shap", "binned_importance")}, "axis_unit": axis_unit}
    if view == "spectral-detail":
        rows = document.get("sample_indices") or list(range(len(values)))
        if any(index < 0 or index >= len(values) for index in rows):
            raise ValueError("Invalid SHAP sample index")
        return {"wavelengths": wavelengths, "axis_unit": axis_unit, "mean_spectrum": X[rows].mean(axis=0).tolist(),
                "mean_abs_shap": np.abs(values[rows]).mean(axis=0).tolist(), "n_samples": len(rows)}
    if view == "scatter":
        truth, predictions = result.get("_y_true"), result.get("_y_pred")
        numeric = truth is not None and predictions is not None and np.asarray(truth).dtype.kind in "biuf" and np.asarray(predictions).dtype.kind in "biuf"
        return {"y_true": truth if numeric else [], "y_pred": predictions if numeric else [], "sample_indices": result["sample_indices"],
                "residuals": (np.asarray(truth) - np.asarray(predictions)).tolist() if numeric else []}
    if view == "rebin":
        return {"binned_importance": binned(values, wavelengths, document), "axis_unit": axis_unit}
    config = result["binned_importance"]
    bins = binned(values, wavelengths, config)
    size, stride = config["bin_size"], config["bin_stride"]
    if view == "beeswarm":
        rows = list(range(min(document.get("max_samples", 200), len(values))))
        entries = []
        for index, (start_w, end_w) in enumerate(bins["bin_ranges"]):
            start, end = index * stride, min(index * stride + size, values.shape[1])
            features = X[rows, start:end].mean(axis=1)
            scale = np.ptp(features)
            features = (features - features.min()) / scale if scale else np.zeros(len(features))
            entries.append({"label": f"{start_w:.0f}–{end_w:.0f}", "center": bins["bin_centers"][index],
                            "start_wavelength": start_w, "end_wavelength": end_w,
                            "points": [{"sample_idx": row, "shap_value": float(values[row, start:end].sum()), "feature_value": float(features[i])} for i, row in enumerate(rows)]})
        entries.sort(key=lambda entry: -np.mean([abs(point["shap_value"]) for point in entry["points"]]))
        return {"bins": entries, "base_value": result["base_value"], "axis_unit": axis_unit}
    if view == "sample":
        row = document["sample_idx"]
        if not 0 <= row < len(values):
            raise ValueError("Invalid SHAP sample index")
        # Waterfalls use disjoint bins so contributions remain additive.
        contributions = [{"feature_name": f"{wavelengths[start]:.0f}–{wavelengths[min(start+size, values.shape[1])-1]:.0f}",
                          "wavelength": float(np.mean(wavelengths[start:start+size])), "shap_value": float(values[row, start:start+size].sum()),
                          "feature_value": float(X[row, start:start+size].mean())} for start in range(0, values.shape[1], size)]
        contributions.sort(key=lambda entry: -abs(entry["shap_value"]))
        top = document.get("top_n", 15)
        if len(contributions) > top:
            rest = contributions[top:]
            contributions = contributions[:top] + [{"feature_name": "Other features", "wavelength": None, "feature_value": 0,
                                                    "shap_value": sum(entry["shap_value"] for entry in rest)}]
        cumulative = result["base_value"]
        for entry in contributions:
            cumulative += entry["shap_value"]
            entry["cumulative"] = cumulative
        return {"sample_idx": row, "base_value": result["base_value"], "axis_unit": axis_unit, "predicted_value": float(result["base_value"] + values[row].sum()), "contributions": contributions}
    raise ValueError("Unsupported SHAP view")


def robustness(operation: str, document: dict[str, Any]) -> dict[str, Any]:
    """Evaluate persisted prediction arrays through nirs4all.robustness."""
    from .library_aggregated_results import read_aggregated_results
    from .robustness_contract import ROBUSTNESS_SPECTRAL_SCENARIO_KINDS, normalize_robustness_launch_payload

    if operation == "analysis.robustness_export":
        from nirs4all.api.robustness import load_workspace_robustness_report

        report = load_workspace_robustness_report(document["workspace_path"], document["robustness_id"])
        format_name = document.get("format", "json")
        return {"body": {"json": report.to_json, "markdown": report.to_markdown, "html": report.to_html}[format_name]()}
    arrays = read_aggregated_results("results.arrays", {"workspace_path": document["workspace_path"], "prediction_id": document["prediction_id"]})
    ready = all(arrays.get(key) is not None and len(arrays[key]) for key in ("y_true", "y_pred"))
    identities = {key: arrays.get(key) for key in ("run_id", "pipeline_id", "chain_id")}
    if operation == "analysis.robustness_evidence":
        return {"prediction_id": document["prediction_id"], **identities, "stored_prediction_scenarios": ["observed", "prediction_bias", "prediction_noise"] if ready else [],
                "spectral_scenarios": sorted(ROBUSTNESS_SPECTRAL_SCENARIO_KINDS), "can_compute_stored_prediction_report": ready,
                "can_compute_spectral_report": False, "status": "ready_for_prediction_space_only" if ready else "missing_prediction_evidence",
                "requirements": [{"id": key, "label": key, "present": arrays.get(key) is not None, "source": f"prediction_arrays.{key}", "detail": None} for key in ("y_true", "y_pred")],
                "blockers": ["Spectral replay requires explicitly persisted row-aligned spectra and a frozen predictor bundle"]}
    if not ready:
        raise ValueError("Stored truth and predictions are required")
    plan = normalize_robustness_launch_payload(document["robustness"])
    if any(scenario["kind"] in ROBUSTNESS_SPECTRAL_SCENARIO_KINDS for scenario in plan["scenarios"]):
        raise ValueError("Spectral replay requires explicitly persisted row-aligned spectra and a frozen predictor bundle")
    from nirs4all.api.result import PredictResult
    from nirs4all.api.robustness import robustness as evaluate
    from nirs4all.api.robustness import save_workspace_robustness_report

    prediction = PredictResult(y_pred=np.asarray(arrays["y_pred"]), model_name=arrays.get("model_name", ""),
                               sample_indices=np.asarray(arrays["sample_indices"]) if arrays.get("sample_indices") is not None else None)
    report = evaluate(prediction, y_true=arrays["y_true"], mode=plan["mode"], scenarios=plan["scenarios"], slice_by=plan.get("slice_by"), seed=document.get("seed"))
    report_id = save_workspace_robustness_report(document["workspace_path"], report, name=document.get("name", "Studio robustness report"),
                                                robustness_id=document.get("robustness_id"), prediction_id=document["prediction_id"], **identities)
    summary = report.summary_artifact()
    return {"robustness_id": report_id, "prediction_id": document["prediction_id"], **identities, "summary_artifact": summary,
            "report_fingerprint": summary.get("fingerprint") or report.fingerprint}


def adapt_analysis(operation: str, document: dict[str, Any]) -> Any:
    """Closed host dispatch for authorized native analysis requests."""
    if operation.startswith("synthesis."):
        return synthesis(operation, document)
    if operation.startswith("analysis.robustness_"):
        return robustness(operation, document)
    if operation == "analysis.shap_config":
        return {"explainer_types": [{"name": name, "display_name": name.title(), "description": description, "recommended_for": ["Captured models"]}
                                    for name, description in (("auto", "Automatic captured predictor explanation"), ("kernel", "Model-agnostic raw input explanation"))],
                "default_bin_size": 20, "default_bin_stride": 10, "aggregation_methods": ["sum", "sum_abs", "mean", "mean_abs"],
                "shap_available": importlib.util.find_spec("shap") is not None}
    if operation == "analysis.shap_models":
        from .library_predictions import available_models

        groups: dict[str, Any] = {}
        bundles = []
        for model in available_models(document)["models"]:
            name = model.get("dataset_name") or "Unknown dataset"
            if model["source"] == "bundle":
                bundles.append({"bundle_path": model["id"], "display_name": model["name"], "dataset_name": name})
                continue
            group = groups.setdefault(name, {"dataset_name": name, "metric": model.get("metric") or "", "task_type": model.get("task_type"), "chains": []})
            group["chains"].append({"chain_id": model["id"], "dataset_name": name, "model_class": model["model_class"], "model_name": model["name"],
                                    "preprocessings": model.get("preprocessing") or "", "run_id": "", "metric": model.get("metric") or "",
                                    "cv_val_score": model.get("best_score"), "final_test_score": model.get("prediction_score"), "cv_fold_count": 0, "has_refit": True})
        return {"datasets": list(groups.values()), "bundles": bundles}
    if operation == "analysis.shap_compute":
        return shap_compute(document)
    if operation == "analysis.shap_view":
        return shap_view(document)
    raise ValueError("Unsupported analysis operation")
