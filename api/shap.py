"""
SHAP Analysis API routes for nirs4all webapp.

This module provides FastAPI routes for SHAP-based model explanations,
computing feature importance and generating visualizations for model
interpretability.

Uses nirs4all's ShapAnalyzer for SHAP computation and WorkspaceStore
for chain-based model retrieval.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from .analysis_results_repository import resolve_analysis_results_repository
from .execution_driver import (
    AnalysisExecutionRequest,
    ExecutionArtifactRef,
    build_analysis_job_config,
    build_analysis_result_metadata,
    new_execution_job_id,
)
from .results_repository import ResultsRepository, ResultsRepositoryNotFound, resolve_results_repository
from .shared.logger import get_logger
from .workspace_manager import workspace_manager

logger = get_logger(__name__)

from .lazy_imports import get_cached

NIRS4ALL_AVAILABLE = True

# Analysis type key used for durable result persistence.
_SHAP_ANALYSIS_TYPE = "shap"

router = APIRouter()

# In-memory storage for SHAP results (job_id -> results)
_shap_results_cache: dict[str, dict[str, Any]] = {}


# ============= Request/Response Models =============


class FeatureImportance(BaseModel):
    """Single feature importance entry."""
    feature_idx: int
    feature_name: str
    wavelength: float | None = None
    importance: float


class BinnedImportanceData(BaseModel):
    """Binned importance data for spectral visualization."""
    bin_centers: list[float]
    bin_values: list[float]
    bin_ranges: list[tuple[float, float]]
    bin_size: int
    bin_stride: int
    aggregation: str


class AvailableChain(BaseModel):
    """A trained chain (model) available for SHAP analysis."""
    chain_id: str
    dataset_name: str
    model_class: str
    model_name: str = ""
    preprocessings: str = ""
    run_id: str = ""
    metric: str = ""
    cv_val_score: float | None = None
    final_test_score: float | None = None
    cv_fold_count: int = 0
    has_refit: bool = False


class DatasetChains(BaseModel):
    """Chains grouped by dataset."""
    dataset_name: str
    metric: str = ""
    task_type: str | None = None
    chains: list[AvailableChain]


class AvailableBundle(BaseModel):
    """An exported .n4a bundle available for SHAP analysis."""
    bundle_path: str
    display_name: str
    dataset_name: str = ""


class AvailableModelsResponse(BaseModel):
    """Response listing available models grouped by dataset."""
    datasets: list[DatasetChains]
    bundles: list[AvailableBundle]


class ShapComputeRequest(BaseModel):
    """Request model for SHAP computation."""
    chain_id: str | None = Field(None, description="Chain ID to explain (primary)")
    bundle_path: str | None = Field(None, description="Path to .n4a bundle (alternative)")
    dataset_id: str = Field(..., description="Dataset to explain")
    partition: Literal["train", "test", "all"] = Field("test", description="Data partition to use")
    explainer_type: Literal["auto", "tree", "kernel", "linear"] = Field("auto", description="SHAP explainer type")
    n_samples: int | None = Field(None, description="Limit number of samples (None = all)")
    n_background: int = Field(100, ge=10, le=500, description="Background samples for KernelExplainer")
    bin_size: int = Field(20, ge=5, le=100, description="Bin size for spectral aggregation")
    bin_stride: int = Field(10, ge=1, le=50, description="Stride between bins")
    bin_aggregation: Literal["sum", "sum_abs", "mean", "mean_abs"] = Field("mean_abs", description="Aggregation method")


class ShapComputeResponse(BaseModel):
    """Response for SHAP computation initiation."""
    job_id: str
    status: str
    message: str


class RebinRequest(BaseModel):
    """Request model for rebinning SHAP results."""
    bin_size: int = Field(20, ge=5, le=100)
    bin_stride: int = Field(10, ge=1, le=50)
    bin_aggregation: Literal["sum", "sum_abs", "mean", "mean_abs"] = Field("mean_abs")


class SpectralImportanceData(BaseModel):
    """Data for spectral importance visualization."""
    wavelengths: list[float]
    mean_spectrum: list[float]
    mean_abs_shap: list[float]
    binned_importance: BinnedImportanceData


class BeeswarmPoint(BaseModel):
    """Single point in beeswarm plot."""
    sample_idx: int
    shap_value: float
    feature_value: float


class BeeswarmBin(BaseModel):
    """A bin in the beeswarm plot."""
    label: str
    center: float
    start_wavelength: float
    end_wavelength: float
    points: list[BeeswarmPoint]


class BeeswarmDataResponse(BaseModel):
    """Response for beeswarm data."""
    bins: list[BeeswarmBin]
    base_value: float


class FeatureContribution(BaseModel):
    """Feature contribution for waterfall plot."""
    feature_name: str
    wavelength: float | None = None
    shap_value: float
    feature_value: float
    cumulative: float


class SampleExplanationResponse(BaseModel):
    """Response for single sample explanation (waterfall)."""
    sample_idx: int
    predicted_value: float
    base_value: float
    contributions: list[FeatureContribution]


class ShapResultsResponse(BaseModel):
    """Full SHAP results response."""
    job_id: str
    model_id: str
    dataset_id: str
    explainer_type: str
    n_samples: int
    n_features: int
    base_value: float
    execution_time_ms: float
    feature_importance: list[FeatureImportance]
    wavelengths: list[float]
    mean_abs_shap: list[float]
    mean_spectrum: list[float]
    binned_importance: BinnedImportanceData
    sample_indices: list[int]


class ExplainerTypeInfo(BaseModel):
    """Information about an explainer type."""
    name: str
    display_name: str
    description: str
    recommended_for: list[str]


class ShapConfigResponse(BaseModel):
    """Response for SHAP configuration options."""
    explainer_types: list[ExplainerTypeInfo]
    default_bin_size: int
    default_bin_stride: int
    aggregation_methods: list[str]
    shap_available: bool


def _build_shap_job_config(
    request: ShapComputeRequest,
    *,
    job_id: str,
    workspace_path: str | None = None,
) -> dict[str, Any]:
    """Build legacy SHAP config with execution metadata attached."""
    artifacts = [
        ExecutionArtifactRef(
            role="input_dataset",
            artifact_type="dataset",
            artifact_id=request.dataset_id,
            metadata={"partition": request.partition},
        )
    ]
    if request.chain_id:
        artifacts.append(
            ExecutionArtifactRef(
                role="input_model",
                artifact_type="workspace_chain",
                artifact_id=request.chain_id,
            )
        )
    if request.bundle_path:
        artifacts.append(
            ExecutionArtifactRef(
                role="input_model",
                artifact_type="model_bundle",
                path=request.bundle_path,
            )
        )

    execution_request = AnalysisExecutionRequest(
        job_id=job_id,
        analysis_type="shap",
        dataset_id=request.dataset_id,
        workspace_path=workspace_path,
        artifacts=tuple(artifacts),
        parameters={
            "partition": request.partition,
            "explainer_type": request.explainer_type,
            "n_samples": request.n_samples,
            "n_background": request.n_background,
            "bin_size": request.bin_size,
            "bin_stride": request.bin_stride,
            "bin_aggregation": request.bin_aggregation,
        },
        metadata={
            "model_ref_type": "chain" if request.chain_id else "bundle",
        },
    )
    config = build_analysis_job_config(request.model_dump(), execution_request)
    # Carry the workspace path explicitly so the background task can persist
    # the completed result durably without re-resolving the active workspace.
    if workspace_path:
        config["workspace_path"] = workspace_path
    return config


# ============= API Endpoints =============


@router.get("/analysis/shap/config", response_model=ShapConfigResponse)
async def get_shap_config():
    """Get SHAP configuration options and availability."""
    return ShapConfigResponse(
        explainer_types=[
            ExplainerTypeInfo(
                name="auto",
                display_name="Auto-detect",
                description="Automatically select the best explainer based on model type",
                recommended_for=["All models"]
            ),
            ExplainerTypeInfo(
                name="tree",
                display_name="Tree Explainer",
                description="Fast and exact for tree-based models",
                recommended_for=["RandomForest", "GradientBoosting", "XGBoost", "LightGBM"]
            ),
            ExplainerTypeInfo(
                name="linear",
                display_name="Linear Explainer",
                description="Exact for linear models including PLS",
                recommended_for=["PLSRegression", "Ridge", "Lasso", "LinearRegression"]
            ),
            ExplainerTypeInfo(
                name="kernel",
                display_name="Kernel Explainer",
                description="Model-agnostic but slower",
                recommended_for=["Any model", "Complex pipelines"]
            ),
        ],
        default_bin_size=20,
        default_bin_stride=10,
        aggregation_methods=["sum", "sum_abs", "mean", "mean_abs"],
        shap_available=get_cached("SHAP_AVAILABLE", optional=True) or False
    )


@router.get("/analysis/shap/models", response_model=AvailableModelsResponse)
async def get_available_models():
    """List available models (chains) for SHAP analysis, grouped by dataset."""
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(status_code=501, detail="nirs4all not available. SHAP analysis requires nirs4all.")

    datasets: list[DatasetChains] = []
    bundles: list[AvailableBundle] = []

    try:
        datasets = _get_available_chains()
    except Exception as e:
        logger.error("Error getting available chains: %s", e)

    try:
        bundles = _get_available_bundles()
    except Exception as e:
        logger.error("Error getting bundles: %s", e)

    return AvailableModelsResponse(datasets=datasets, bundles=bundles)


@router.post("/analysis/shap/compute", response_model=ShapComputeResponse)
async def compute_shap_explanation(request: ShapComputeRequest):
    """Compute SHAP explanations for a model.

    Accepts either a chain_id (from workspace) or bundle_path (.n4a export).
    Uses JobManager for async execution with WebSocket progress updates.
    """
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(status_code=501, detail="nirs4all not available. SHAP analysis requires nirs4all.")
    if not get_cached("SHAP_AVAILABLE", optional=True):
        raise HTTPException(status_code=501, detail="SHAP not installed. Install with: pip install shap")
    if not request.chain_id and not request.bundle_path:
        raise HTTPException(status_code=400, detail="Either chain_id or bundle_path is required")

    try:
        from .jobs import JobType, job_manager
        job_id = new_execution_job_id(JobType.ANALYSIS)
        workspace = workspace_manager.get_active_workspace()
        config = _build_shap_job_config(
            request,
            job_id=job_id,
            workspace_path=workspace.path if workspace else None,
        )
        job = job_manager.create_job(JobType.ANALYSIS, config, job_id=job_id)
        job_manager.submit_job(job, _run_shap_task)
        return ShapComputeResponse(job_id=job.id, status="running", message="SHAP analysis started")
    except Exception as e:
        logger.error("Failed to start SHAP analysis: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to start SHAP analysis: {str(e)}")


@router.get("/analysis/shap/status/{job_id}")
async def get_shap_status(job_id: str):
    """Get status of a SHAP computation job."""
    from .jobs import job_manager
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")
    return job.to_dict()


@router.get("/analysis/shap/results/{job_id}", response_model=ShapResultsResponse)
async def get_shap_results(job_id: str):
    """Get SHAP results for a completed job."""
    r = _get_shap_result(job_id)
    if r is None:
        raise HTTPException(status_code=404, detail=f"SHAP results not found for job_id: {job_id}")

    return ShapResultsResponse(
        job_id=r["job_id"],
        model_id=r["model_id"],
        dataset_id=r["dataset_id"],
        explainer_type=r["explainer_type"],
        n_samples=r["n_samples"],
        n_features=r["n_features"],
        base_value=r["base_value"],
        execution_time_ms=r["execution_time_ms"],
        feature_importance=r["feature_importance"],
        wavelengths=r["wavelengths"],
        mean_abs_shap=r["mean_abs_shap"],
        mean_spectrum=r["mean_spectrum"],
        binned_importance=r["binned_importance"],
        sample_indices=r["sample_indices"]
    )


@router.get("/analysis/shap/results/{job_id}/spectral", response_model=SpectralImportanceData)
async def get_spectral_importance(job_id: str):
    """Get spectral importance data for visualization."""
    r = _get_shap_result(job_id)
    if r is None:
        raise HTTPException(status_code=404, detail=f"SHAP results not found for job_id: {job_id}")

    return SpectralImportanceData(
        wavelengths=r["wavelengths"],
        mean_spectrum=r["mean_spectrum"],
        mean_abs_shap=r["mean_abs_shap"],
        binned_importance=r["binned_importance"]
    )


@router.get("/analysis/shap/results/{job_id}/spectral-detail")
async def get_spectral_detail(job_id: str, sample_indices: str | None = Query(None)):
    """Get spectral data filtered to specific samples.

    When sample_indices is provided (comma-separated), returns SHAP
    importance and mean spectrum for only those samples.
    """
    import numpy as np
    r = _get_shap_result(job_id)
    if r is None:
        raise HTTPException(status_code=404, detail=f"SHAP results not found for job_id: {job_id}")

    shap_values = r["_raw_shap_values"]
    X = r["_raw_X"]

    if sample_indices:
        try:
            indices = [int(i) for i in sample_indices.split(",")]
            indices = [i for i in indices if 0 <= i < shap_values.shape[0]]
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid sample_indices format")
        if not indices:
            raise HTTPException(status_code=400, detail="No valid sample indices")
        shap_subset = shap_values[indices]
        X_subset = X[indices]
    else:
        shap_subset = shap_values
        X_subset = X

    return {
        "wavelengths": r["wavelengths"],
        "mean_spectrum": X_subset.mean(axis=0).tolist(),
        "mean_abs_shap": np.abs(shap_subset).mean(axis=0).tolist(),
        "n_samples": len(shap_subset),
    }


@router.get("/analysis/shap/results/{job_id}/scatter")
async def get_prediction_scatter(job_id: str):
    """Get prediction scatter data (y_true vs y_pred) for sample selection."""
    r = _get_shap_result(job_id)
    if r is None:
        raise HTTPException(status_code=404, detail=f"SHAP results not found for job_id: {job_id}")

    y_true = r.get("_y_true")
    y_pred = r.get("_y_pred")

    if y_true is None or y_pred is None:
        return {"y_true": [], "y_pred": [], "sample_indices": r["sample_indices"], "residuals": []}

    residuals = [float(yt - yp) for yt, yp in zip(y_true, y_pred)]
    return {
        "y_true": y_true,
        "y_pred": y_pred,
        "sample_indices": r["sample_indices"],
        "residuals": residuals,
    }


@router.post("/analysis/shap/results/{job_id}/rebin")
async def rebin_shap_results(job_id: str, request: RebinRequest):
    """Rebin SHAP results with new parameters without re-computing SHAP values."""
    r = _get_shap_result(job_id)
    if r is None:
        raise HTTPException(status_code=404, detail=f"SHAP results not found: {job_id}")

    binned = _compute_binned_importance(
        r["_raw_shap_values"], r["wavelengths"],
        request.bin_size, request.bin_stride, request.bin_aggregation
    )
    # Update the cached binned importance so subsequent fetches use it
    r["binned_importance"] = binned
    return {"binned_importance": binned.model_dump()}


@router.get("/analysis/shap/results/{job_id}/beeswarm", response_model=BeeswarmDataResponse)
async def get_beeswarm_data(job_id: str, max_samples: int = 200):
    """Get beeswarm plot data."""
    import numpy as np
    r = _get_shap_result(job_id)
    if r is None:
        raise HTTPException(status_code=404, detail=f"SHAP results not found for job_id: {job_id}")

    shap_values = r["_raw_shap_values"]
    X = r["_raw_X"]
    wavelengths = r["wavelengths"]
    bin_size = r["binned_importance"]["bin_size"] if isinstance(r["binned_importance"], dict) else r["binned_importance"].bin_size
    bin_stride = r["binned_importance"]["bin_stride"] if isinstance(r["binned_importance"], dict) else r["binned_importance"].bin_stride

    # Subsample if too many samples
    n_samples = shap_values.shape[0]
    if n_samples > max_samples:
        indices = np.random.choice(n_samples, max_samples, replace=False)
        shap_values = shap_values[indices]
        X = X[indices]
    else:
        indices = np.arange(n_samples)

    # Create bins
    bins = []
    n_features = len(wavelengths)
    start = 0

    while start < n_features - bin_size + 1:
        end = start + bin_size
        bin_shap = shap_values[:, start:end].sum(axis=1)
        bin_features = X[:, start:end].mean(axis=1)

        feat_min, feat_max = bin_features.min(), bin_features.max()
        if feat_max > feat_min:
            bin_features_norm = (bin_features - feat_min) / (feat_max - feat_min)
        else:
            bin_features_norm = np.zeros_like(bin_features)

        points = [
            BeeswarmPoint(sample_idx=int(indices[i]), shap_value=float(bin_shap[i]), feature_value=float(bin_features_norm[i]))
            for i in range(len(bin_shap))
        ]

        bins.append(BeeswarmBin(
            label=f"{wavelengths[start]:.1f}-{wavelengths[end-1]:.1f}",
            center=float(np.mean(wavelengths[start:end])),
            start_wavelength=float(wavelengths[start]),
            end_wavelength=float(wavelengths[end-1]),
            points=points
        ))
        start += bin_stride

    bins.sort(key=lambda b: -np.mean([abs(p.shap_value) for p in b.points]))

    return BeeswarmDataResponse(bins=bins[:20], base_value=r["base_value"])


@router.get("/analysis/shap/results/{job_id}/sample/{sample_idx}", response_model=SampleExplanationResponse)
async def get_sample_explanation(job_id: str, sample_idx: int, top_n: int = 15):
    """Get single sample explanation for waterfall plot."""
    import numpy as np
    if job_id not in _shap_results_cache:
        raise HTTPException(status_code=404, detail=f"SHAP results not found for job_id: {job_id}")

    r = _shap_results_cache[job_id]
    shap_values = r["_raw_shap_values"]
    X = r["_raw_X"]
    wavelengths = r["wavelengths"]
    base_value = r["base_value"]
    binned = r["binned_importance"]
    bin_size = binned["bin_size"] if isinstance(binned, dict) else binned.bin_size
    bin_stride = binned["bin_stride"] if isinstance(binned, dict) else binned.bin_stride

    if sample_idx < 0 or sample_idx >= shap_values.shape[0]:
        raise HTTPException(status_code=400, detail=f"Invalid sample_idx: {sample_idx}. Must be 0-{shap_values.shape[0]-1}")

    sample_shap = shap_values[sample_idx]
    sample_X = X[sample_idx]

    contributions = []
    n_features = len(wavelengths)
    start = 0

    while start < n_features - bin_size + 1:
        end = start + bin_size
        contributions.append({
            "label": f"{wavelengths[start]:.1f}-{wavelengths[end-1]:.1f}",
            "wavelength": float(np.mean(wavelengths[start:end])),
            "shap_value": float(sample_shap[start:end].sum()),
            "feature_value": float(sample_X[start:end].mean())
        })
        start += bin_stride

    contributions.sort(key=lambda c: -abs(c["shap_value"]))
    top_contributions = contributions[:top_n]
    rest_shap = sum(c["shap_value"] for c in contributions[top_n:])

    if abs(rest_shap) > 0.001:
        top_contributions.append({
            "label": f"Other ({len(contributions) - top_n} bins)",
            "wavelength": None,
            "shap_value": rest_shap,
            "feature_value": 0
        })

    cumulative = base_value
    result_contributions = []
    for c in top_contributions:
        cumulative += c["shap_value"]
        result_contributions.append(FeatureContribution(
            feature_name=c["label"], wavelength=c["wavelength"],
            shap_value=c["shap_value"], feature_value=c["feature_value"],
            cumulative=cumulative
        ))

    predicted_value = base_value + sample_shap.sum()
    return SampleExplanationResponse(
        sample_idx=sample_idx,
        predicted_value=float(predicted_value),
        base_value=float(base_value),
        contributions=result_contributions
    )


# ============= Job Task =============


def _run_shap_task(job: Any, progress_callback: Callable[[float, str], bool]) -> dict[str, Any]:
    """Execute SHAP analysis in background thread."""
    config = job.config
    job_id = job.id

    progress_callback(5, "Loading model...")
    if config.get("chain_id"):
        model, model_info = _load_model_from_chain(config["chain_id"])
        model_id = config["chain_id"]
    elif config.get("bundle_path"):
        model, model_info = _load_model_from_bundle(config["bundle_path"])
        model_id = config["bundle_path"]
    else:
        raise ValueError("Either chain_id or bundle_path is required")

    progress_callback(15, "Loading dataset...")
    X, y, wavelengths, feature_names, sample_indices = _load_dataset_for_shap(
        config["dataset_id"], config["partition"], config.get("n_samples")
    )

    progress_callback(25, "Computing SHAP values...")
    analyzer = get_cached("ShapAnalyzer")()
    results = analyzer.explain_model(
        model=model, X=X, feature_names=feature_names,
        explainer_type=config.get("explainer_type", "auto"),
        n_background=config.get("n_background", 100),
        bin_size=config.get("bin_size", 20),
        bin_stride=config.get("bin_stride", 10),
        bin_aggregation=config.get("bin_aggregation", "mean_abs"),
        output_dir=None, visualizations=None, plots_visible=False
    )

    progress_callback(85, "Processing results...")

    # Compute predictions for scatter
    y_pred = None
    y_true = None
    try:
        y_pred = model.predict(X).ravel().tolist()
        if y is not None:
            y_true = y.ravel().tolist()
    except Exception:
        pass

    start_time = config.get("_start_time", time.time())
    execution_time = (time.time() - start_time) * 1000

    processed = _process_shap_results(
        results=results, job_id=job_id, model_id=model_id,
        dataset_id=config["dataset_id"], wavelengths=wavelengths,
        sample_indices=sample_indices, X=X,
        bin_size=config.get("bin_size", 20),
        bin_stride=config.get("bin_stride", 10),
        bin_aggregation=config.get("bin_aggregation", "mean_abs"),
        execution_time_ms=execution_time
    )
    processed["_y_true"] = y_true
    processed["_y_pred"] = y_pred

    _shap_results_cache[job_id] = processed

    # Persist the completed result durably under the workspace when one is
    # available; the in-memory cache remains the fast path / fallback.
    storage = _persist_shap_result(job_id, processed, config.get("workspace_path"))

    execution_metadata = build_analysis_result_metadata(
        config,
        (
            ExecutionArtifactRef(
                role="output_analysis",
                artifact_type="shap_explanation",
                artifact_id=job_id,
                metadata={
                    "dataset_id": config["dataset_id"],
                    "model_id": model_id,
                    "explainer_type": processed["explainer_type"],
                    "n_samples": processed["n_samples"],
                    "n_features": processed["n_features"],
                    "storage": storage,
                },
            ),
        ),
    )

    progress_callback(100, "Complete")
    return {
        "job_id": job_id,
        "n_samples": processed["n_samples"],
        **execution_metadata,
    }


# ============= Durable Result Persistence =============


def _shap_storage_payload(processed: dict[str, Any]) -> dict[str, Any]:
    """Return the JSON-serializable subset of a processed SHAP result.

    Raw numpy arrays (``_raw_*``) are split out into a sidecar; pydantic models
    are flattened to plain dicts so the payload round-trips through JSON.
    """
    payload: dict[str, Any] = {k: v for k, v in processed.items() if not k.startswith("_")}
    payload["feature_importance"] = [
        fi.model_dump() if hasattr(fi, "model_dump") else fi
        for fi in processed.get("feature_importance", [])
    ]
    binned = processed.get("binned_importance")
    payload["binned_importance"] = binned.model_dump() if hasattr(binned, "model_dump") else binned
    # y_true / y_pred power the prediction-scatter endpoint and are JSON-safe.
    payload["_y_true"] = processed.get("_y_true")
    payload["_y_pred"] = processed.get("_y_pred")
    return payload


def _rehydrate_shap_result(payload: dict[str, Any], arrays: dict[str, Any]) -> dict[str, Any]:
    """Reconstruct an in-memory SHAP result dict from a persisted payload."""
    result = dict(payload)
    result["_raw_shap_values"] = arrays["shap_values"]
    result["_raw_X"] = arrays["X"]
    return result


def _persist_shap_result(job_id: str, processed: dict[str, Any], workspace_path: str | None) -> str:
    """Persist a completed SHAP result; return the storage location label."""
    repository = resolve_analysis_results_repository(workspace_path)
    if repository is None:
        return "memory_cache"
    try:
        repository.save(
            _SHAP_ANALYSIS_TYPE,
            job_id,
            _shap_storage_payload(processed),
            arrays={
                "shap_values": processed["_raw_shap_values"],
                "X": processed["_raw_X"],
            },
        )
        return "workspace_repository"
    except Exception as exc:  # durability is best-effort; never fail the job
        logger.error("Failed to persist SHAP result %s: %s", job_id, exc)
        return "memory_cache"


def _get_shap_result(job_id: str) -> dict[str, Any] | None:
    """Return a SHAP result from memory, falling back to durable storage.

    On a durable hit the result is rehydrated into the in-memory cache so the
    array-backed visualization endpoints keep working without re-reading disk.
    """
    cached = _shap_results_cache.get(job_id)
    if cached is not None:
        return cached

    workspace = workspace_manager.get_active_workspace()
    if not workspace:
        return None
    repository = resolve_analysis_results_repository(workspace.path)
    if repository is None:
        return None

    payload = repository.load(_SHAP_ANALYSIS_TYPE, job_id)
    arrays = repository.load_arrays(_SHAP_ANALYSIS_TYPE, job_id)
    if payload is None or arrays is None:
        return None

    result = _rehydrate_shap_result(payload, arrays)
    _shap_results_cache[job_id] = result
    return result


# ============= Helper Functions =============


def _workspace_store_repository_factory(path: Path) -> ResultsRepository:
    """Build the legacy WorkspaceStore only when repository resolution selects it."""
    from nirs4all.pipeline.storage import WorkspaceStore

    return WorkspaceStore(path)


def _resolve_workspace_results_repository(workspace_path: Path) -> ResultsRepository:
    """Resolve the active workspace's results repository for SHAP model lookup."""
    try:
        return resolve_results_repository(
            workspace_path,
            workspace_store_factory=_workspace_store_repository_factory,
        )
    except ResultsRepositoryNotFound as exc:
        raise ValueError(str(exc)) from exc


def _chain_summary_rows(repository: ResultsRepository) -> list[dict[str, Any]]:
    """Return chain summary rows from any ResultsRepository implementation."""
    summaries = repository.query_chain_summaries()
    if hasattr(summaries, "iter_rows"):
        return [dict(row) for row in summaries.iter_rows(named=True)]
    return [dict(row) for row in summaries]


def _final_model_artifact_id(chain_id: str, chain: dict[str, Any], *, raise_on_missing: bool = True) -> str | None:
    """Return the final/refit artifact id for a chain, optionally raising a clear gap error."""
    fold_artifacts = chain.get("fold_artifacts") or {}
    artifact_id = fold_artifacts.get("fold_final") or fold_artifacts.get("final")
    if artifact_id:
        return str(artifact_id)
    if not raise_on_missing:
        return None

    reason = chain.get("artifact_unavailable_reason")
    if reason:
        raise ValueError(f"No final model artifact for chain {chain_id}: {reason}")
    raise ValueError(f"No final model artifact for chain {chain_id}. The model may not have been refit.")


def _get_available_chains() -> list[DatasetChains]:
    """Return refit chains from the active results repository, grouped by dataset.

    Only chains that have a final refit model artifact (``fold_final`` or
    legacy ``final`` in ``fold_artifacts``) are returned -- SHAP analysis
    requires a fitted model to explain.  Datasets with no refit chains
    are omitted from the result entirely.
    """
    workspace = workspace_manager.get_active_workspace()
    if not workspace:
        return []

    repository = None
    try:
        repository = _resolve_workspace_results_repository(Path(workspace.path))
        summaries = _chain_summary_rows(repository)
    except Exception as e:
        logger.error("Error querying chain summaries: %s", e)
        if repository:
            repository.close()
        return []

    # Group by dataset_name
    datasets_map: dict[str, list[dict[str, Any]]] = {}
    for chain in summaries:
        ds = chain.get("dataset_name", "")
        if not ds:
            continue
        datasets_map.setdefault(ds, []).append(chain)

    # Check which chains have refit models
    refit_chains: set = set()
    try:
        for ds_chains in datasets_map.values():
            for c in ds_chains:
                chain_id = c.get("chain_id", "")
                if not chain_id:
                    continue
                chain_detail = repository.get_chain(chain_id) if repository is not None else None
                if chain_detail:
                    if _final_model_artifact_id(chain_id, chain_detail, raise_on_missing=False):
                        refit_chains.add(chain_id)
    except Exception as e:
        logger.error("Error checking refit chains: %s", e)
    finally:
        if repository:
            repository.close()

    result = []
    for ds_name in sorted(datasets_map):
        chains = datasets_map[ds_name]
        # Metric/task_type can be inferred from any chain in the dataset
        # (CV or refit), so resolve before filtering.
        metric = next((c.get("metric") for c in chains if c.get("metric")), "")
        task_type = next((c.get("task_type") for c in chains if c.get("task_type")), None)

        # Keep only chains that have a refit artifact -- SHAP analysis
        # requires the final refit model.  Refit chains have
        # cv_val_score=NULL (their predictions are stored with
        # refit_context!=NULL, so the CV averaging in update_chain_summary
        # excludes them), so they must be filtered BEFORE truncation;
        # otherwise sorting by cv_val_score pushes them past the top-20
        # cutoff and the resulting list is empty.
        refit_only = [c for c in chains if c.get("chain_id", "") in refit_chains]

        # Sort by final_test_score (the score that actually exists on a
        # refit chain), falling back to cv_val_score for legacy rows that
        # may have it populated.  Direction follows the existing
        # higher-is-better convention used by the previous sort.
        def _sort_key(c: dict[str, Any]) -> float:
            score = c.get("final_test_score")
            if score is None:
                score = c.get("cv_val_score")
            return float(score) if score is not None else float("-inf")

        refit_only.sort(key=_sort_key, reverse=True)

        if not refit_only:
            # Skip datasets with no refit chains rather than emit an empty
            # SelectGroup that confuses the UI dropdown.
            continue

        available = [
            AvailableChain(
                chain_id=c.get("chain_id", ""),
                dataset_name=ds_name,
                model_class=c.get("model_class", ""),
                model_name=c.get("model_name", ""),
                preprocessings=c.get("preprocessings", ""),
                run_id=c.get("run_id", ""),
                metric=c.get("metric", ""),
                cv_val_score=c.get("cv_val_score"),
                final_test_score=c.get("final_test_score"),
                cv_fold_count=c.get("cv_fold_count", 0),
                has_refit=True,
            )
            for c in refit_only[:20]
        ]

        result.append(DatasetChains(
            dataset_name=ds_name, metric=metric, task_type=task_type, chains=available
        ))

    return result


def _get_available_bundles() -> list[AvailableBundle]:
    """Get available .n4a bundles from workspace exports."""
    workspace = workspace_manager.get_active_workspace()
    if not workspace:
        return []

    bundles = []
    exports_path = Path(workspace.path) / "workspace" / "exports"
    if not exports_path.exists():
        return bundles

    for n4a_file in exports_path.rglob("*.n4a"):
        bundles.append(AvailableBundle(
            bundle_path=str(n4a_file),
            display_name=n4a_file.stem,
            dataset_name=n4a_file.parent.name if n4a_file.parent != exports_path else "",
        ))

    return bundles


def _load_model_from_chain(chain_id: str) -> tuple[Any, dict[str, Any]]:
    """Load a trained model from a chain's final artifact via the active results repository."""
    workspace = workspace_manager.get_active_workspace()
    if not workspace:
        raise ValueError("No active workspace")

    repository = _resolve_workspace_results_repository(Path(workspace.path))
    try:
        chain = repository.get_chain(chain_id)
        if chain is None:
            raise ValueError(f"Chain not found: {chain_id}")

        artifact_id = _final_model_artifact_id(chain_id, chain)
        load_artifact = getattr(repository, "load_artifact", None)
        if not callable(load_artifact):
            raise ValueError(f"Results repository for chain {chain_id} cannot load model artifacts.")

        model = load_artifact(artifact_id)
        model_info = {
            "chain_id": chain_id,
            "model_class": chain.get("model_class", ""),
            "dataset_name": chain.get("dataset_name", ""),
        }
        return model, model_info
    finally:
        repository.close()


def _load_model_from_bundle(bundle_path: str) -> tuple[Any, dict[str, Any]]:
    """Load a model from a .n4a bundle."""
    path = Path(bundle_path)
    if not path.exists():
        raise ValueError(f"Bundle not found: {bundle_path}")

    from nirs4all.pipeline.bundle import NIRSBundle
    bundle = NIRSBundle.load(str(path))
    return bundle.model, {"type": "bundle", "path": str(path)}


def _resolve_dataset_id_by_name(name: str) -> str | None:
    """Resolve a dataset name (from chain summaries) to a dataset link ID.

    Chain summaries store the human-readable dataset_name (e.g. "corn"),
    but _load_dataset() expects the dataset link ID (e.g. "dataset_17378_3").
    This function finds the matching linked dataset by name or path stem.
    """
    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        return None

    name_lower = name.lower()
    for ds in workspace.datasets:
        ds_name = ds.get("name", "")
        ds_path = ds.get("path", "")
        # Match by name (exact, case-insensitive)
        if ds_name.lower() == name_lower:
            return ds.get("id")
        # Match by path stem (folder or file name without extension)
        if ds_path:
            stem = Path(ds_path).stem.lower()
            if stem == name_lower:
                return ds.get("id")
    return None


def _load_dataset_for_shap(
    dataset_id: str, partition: str, n_samples: int | None
) -> tuple[Any, Any, list[float], list[str], list[int]]:
    """Load dataset for SHAP analysis. Returns (X, y, wavelengths, feature_names, sample_indices).

    The dataset_id may be a dataset link ID (e.g. "dataset_17378_3") or a dataset name
    (e.g. "corn") as stored in chain summaries. We try both lookups.
    """
    import numpy as np

    from .spectra import _load_dataset

    dataset = _load_dataset(dataset_id)

    # If lookup by id failed, try resolving by dataset name
    if dataset is None:
        resolved_id = _resolve_dataset_id_by_name(dataset_id)
        if resolved_id:
            dataset = _load_dataset(resolved_id)

    if dataset is None:
        raise ValueError(f"Dataset not found: {dataset_id}")

    selector = {} if partition == "all" else {"partition": partition}
    X = dataset.x(selector, layout="2d")
    if isinstance(X, list):
        X = X[0]
    X = np.asarray(X)

    # Load target values for prediction scatter
    y = None
    try:
        y = np.asarray(dataset.y(selector))
        if y.ndim > 1:
            y = y.ravel()
    except Exception:
        pass

    # Get wavelengths
    try:
        headers = dataset.headers(0)
        wavelengths = [float(h) for h in headers] if headers else list(range(X.shape[1]))
    except Exception:
        wavelengths = list(range(X.shape[1]))

    feature_names = [f"λ{w:.1f}" for w in wavelengths]
    all_indices = list(range(X.shape[0]))

    if n_samples and n_samples < X.shape[0]:
        indices = np.random.choice(X.shape[0], n_samples, replace=False)
        X = X[indices]
        if y is not None:
            y = y[indices]
        sample_indices = [all_indices[i] for i in indices]
    else:
        sample_indices = all_indices

    return X, y, wavelengths, feature_names, sample_indices


def _compute_binned_importance(
    shap_values, wavelengths: list[float],
    bin_size: int, bin_stride: int, bin_aggregation: str
) -> BinnedImportanceData:
    """Compute binned importance from raw SHAP values.

    Aggregation modes (applied per bin across wavelengths, then averaged across samples):
    - sum:      sum of raw SHAP per sample, then mean across samples (signed, allows cancellation)
    - sum_abs:  sum of |SHAP| per sample, then mean across samples (unsigned, total magnitude)
    - mean:     mean of raw SHAP per sample, then mean across samples (signed, normalized by bin size)
    - mean_abs: mean of |SHAP| per sample, then mean across samples (unsigned, normalized by bin size)
    """
    import numpy as np
    n_features = len(wavelengths)
    bin_centers = []
    bin_values = []
    bin_ranges = []

    start = 0
    while start < n_features - bin_size + 1:
        end = start + bin_size
        bin_wl = wavelengths[start:end]
        # Raw SHAP slice: shape (n_samples, bin_size)
        bin_shap_raw = shap_values[:, start:end]

        bin_centers.append(float(np.mean(bin_wl)))
        bin_ranges.append((float(bin_wl[0]), float(bin_wl[-1])))

        if bin_aggregation == "sum":
            # Sum signed SHAP across wavelengths per sample, then mean across samples
            val = float(bin_shap_raw.sum(axis=1).mean())
        elif bin_aggregation == "sum_abs":
            # Sum |SHAP| across wavelengths per sample, then mean across samples
            val = float(np.abs(bin_shap_raw).sum(axis=1).mean())
        elif bin_aggregation == "mean":
            # Mean signed SHAP across wavelengths per sample, then mean across samples
            val = float(bin_shap_raw.mean(axis=1).mean())
        elif bin_aggregation == "mean_abs":
            # Mean |SHAP| across wavelengths per sample, then mean across samples
            val = float(np.abs(bin_shap_raw).mean(axis=1).mean())
        else:
            val = float(np.abs(bin_shap_raw).sum(axis=1).mean())

        bin_values.append(val)
        start += bin_stride

    return BinnedImportanceData(
        bin_centers=bin_centers, bin_values=bin_values, bin_ranges=bin_ranges,
        bin_size=bin_size, bin_stride=bin_stride, aggregation=bin_aggregation
    )


def _process_shap_results(
    results: dict[str, Any], job_id: str, model_id: str, dataset_id: str,
    wavelengths: list[float], sample_indices: list[int], X,
    bin_size: int, bin_stride: int, bin_aggregation: str, execution_time_ms: float
) -> dict[str, Any]:
    """Process raw SHAP results into webapp-friendly format."""
    import numpy as np
    shap_values = results["shap_values"]
    base_value = results["base_value"]
    n_samples, n_features = shap_values.shape

    mean_abs_shap = np.abs(shap_values).mean(axis=0).tolist()
    mean_spectrum = X.mean(axis=0).tolist()

    binned_importance = _compute_binned_importance(shap_values, wavelengths, bin_size, bin_stride, bin_aggregation)

    importance_indices = np.argsort(mean_abs_shap)[::-1][:20]
    feature_importance = [
        FeatureImportance(
            feature_idx=int(idx), feature_name=f"λ{wavelengths[idx]:.1f}",
            wavelength=float(wavelengths[idx]), importance=float(mean_abs_shap[idx])
        )
        for idx in importance_indices
    ]

    return {
        "job_id": job_id, "model_id": model_id, "dataset_id": dataset_id,
        "explainer_type": results["explainer_type"],
        "n_samples": n_samples, "n_features": n_features,
        "base_value": float(base_value) if base_value is not None else 0.0,
        "execution_time_ms": execution_time_ms,
        "feature_importance": feature_importance,
        "wavelengths": wavelengths,
        "mean_abs_shap": mean_abs_shap,
        "mean_spectrum": mean_spectrum,
        "binned_importance": binned_importance,
        "sample_indices": sample_indices,
        "_raw_shap_values": shap_values,
        "_raw_X": X,
    }
