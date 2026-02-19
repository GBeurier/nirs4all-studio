"""
SHAP Analysis API routes for nirs4all webapp.

This module provides FastAPI routes for SHAP-based model explanations,
computing feature importance and generating visualizations for model
interpretability.

Uses nirs4all's ShapAnalyzer for SHAP computation and WorkspaceStore
for chain-based model retrieval.
"""

from __future__ import annotations

import sys
import time
import traceback
import uuid
from pathlib import Path
from typing import Any, Callable, Dict, List, Literal, Optional, Tuple

import numpy as np
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from .workspace_manager import workspace_manager

# Add nirs4all to path if needed
nirs4all_path = Path(__file__).parent.parent.parent / "nirs4all"
if str(nirs4all_path) not in sys.path:
    sys.path.insert(0, str(nirs4all_path))

try:
    from nirs4all.visualization.analysis.shap import ShapAnalyzer, SHAP_AVAILABLE
    NIRS4ALL_AVAILABLE = True
except ImportError as e:
    print(f"Note: nirs4all not available for SHAP: {e}")
    NIRS4ALL_AVAILABLE = False
    SHAP_AVAILABLE = False

try:
    from .store_adapter import StoreAdapter, STORE_AVAILABLE
except ImportError:
    STORE_AVAILABLE = False

router = APIRouter()

# In-memory storage for SHAP results (job_id -> results)
_shap_results_cache: Dict[str, Dict[str, Any]] = {}


# ============= Request/Response Models =============


class FeatureImportance(BaseModel):
    """Single feature importance entry."""
    feature_idx: int
    feature_name: str
    wavelength: Optional[float] = None
    importance: float


class BinnedImportanceData(BaseModel):
    """Binned importance data for spectral visualization."""
    bin_centers: List[float]
    bin_values: List[float]
    bin_ranges: List[Tuple[float, float]]
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
    cv_val_score: Optional[float] = None
    final_test_score: Optional[float] = None
    cv_fold_count: int = 0
    has_refit: bool = False


class DatasetChains(BaseModel):
    """Chains grouped by dataset."""
    dataset_name: str
    metric: str = ""
    task_type: Optional[str] = None
    chains: List[AvailableChain]


class AvailableBundle(BaseModel):
    """An exported .n4a bundle available for SHAP analysis."""
    bundle_path: str
    display_name: str
    dataset_name: str = ""


class AvailableModelsResponse(BaseModel):
    """Response listing available models grouped by dataset."""
    datasets: List[DatasetChains]
    bundles: List[AvailableBundle]


class ShapComputeRequest(BaseModel):
    """Request model for SHAP computation."""
    chain_id: Optional[str] = Field(None, description="Chain ID to explain (primary)")
    bundle_path: Optional[str] = Field(None, description="Path to .n4a bundle (alternative)")
    dataset_id: str = Field(..., description="Dataset to explain")
    partition: Literal["train", "test", "all"] = Field("test", description="Data partition to use")
    explainer_type: Literal["auto", "tree", "kernel", "linear"] = Field("auto", description="SHAP explainer type")
    n_samples: Optional[int] = Field(None, description="Limit number of samples (None = all)")
    n_background: int = Field(100, ge=10, le=500, description="Background samples for KernelExplainer")
    bin_size: int = Field(20, ge=5, le=100, description="Bin size for spectral aggregation")
    bin_stride: int = Field(10, ge=1, le=50, description="Stride between bins")
    bin_aggregation: Literal["sum", "sum_abs", "mean", "mean_abs"] = Field("sum", description="Aggregation method")


class ShapComputeResponse(BaseModel):
    """Response for SHAP computation initiation."""
    job_id: str
    status: str
    message: str


class RebinRequest(BaseModel):
    """Request model for rebinning SHAP results."""
    bin_size: int = Field(20, ge=5, le=100)
    bin_stride: int = Field(10, ge=1, le=50)
    bin_aggregation: Literal["sum", "sum_abs", "mean", "mean_abs"] = Field("sum")


class SpectralImportanceData(BaseModel):
    """Data for spectral importance visualization."""
    wavelengths: List[float]
    mean_spectrum: List[float]
    mean_abs_shap: List[float]
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
    points: List[BeeswarmPoint]


class BeeswarmDataResponse(BaseModel):
    """Response for beeswarm data."""
    bins: List[BeeswarmBin]
    base_value: float


class FeatureContribution(BaseModel):
    """Feature contribution for waterfall plot."""
    feature_name: str
    wavelength: Optional[float] = None
    shap_value: float
    feature_value: float
    cumulative: float


class SampleExplanationResponse(BaseModel):
    """Response for single sample explanation (waterfall)."""
    sample_idx: int
    predicted_value: float
    base_value: float
    contributions: List[FeatureContribution]


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
    feature_importance: List[FeatureImportance]
    wavelengths: List[float]
    mean_abs_shap: List[float]
    mean_spectrum: List[float]
    binned_importance: BinnedImportanceData
    sample_indices: List[int]


class ExplainerTypeInfo(BaseModel):
    """Information about an explainer type."""
    name: str
    display_name: str
    description: str
    recommended_for: List[str]


class ShapConfigResponse(BaseModel):
    """Response for SHAP configuration options."""
    explainer_types: List[ExplainerTypeInfo]
    default_bin_size: int
    default_bin_stride: int
    aggregation_methods: List[str]
    shap_available: bool


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
        shap_available=SHAP_AVAILABLE if NIRS4ALL_AVAILABLE else False
    )


@router.get("/analysis/shap/models", response_model=AvailableModelsResponse)
async def get_available_models():
    """List available models (chains) for SHAP analysis, grouped by dataset."""
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(status_code=501, detail="nirs4all not available. SHAP analysis requires nirs4all.")

    datasets: List[DatasetChains] = []
    bundles: List[AvailableBundle] = []

    try:
        datasets = _get_available_chains()
    except Exception as e:
        print(f"Error getting available chains: {e}")

    try:
        bundles = _get_available_bundles()
    except Exception as e:
        print(f"Error getting bundles: {e}")

    return AvailableModelsResponse(datasets=datasets, bundles=bundles)


@router.post("/analysis/shap/compute", response_model=ShapComputeResponse)
async def compute_shap_explanation(request: ShapComputeRequest):
    """Compute SHAP explanations for a model.

    Accepts either a chain_id (from workspace) or bundle_path (.n4a export).
    Uses JobManager for async execution with WebSocket progress updates.
    """
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(status_code=501, detail="nirs4all not available. SHAP analysis requires nirs4all.")
    if not SHAP_AVAILABLE:
        raise HTTPException(status_code=501, detail="SHAP not installed. Install with: pip install shap")
    if not request.chain_id and not request.bundle_path:
        raise HTTPException(status_code=400, detail="Either chain_id or bundle_path is required")

    try:
        from .jobs import job_manager, JobType
        config = request.model_dump()
        job = job_manager.create_job(JobType.ANALYSIS, config)
        job_manager.submit_job(job, _run_shap_task)
        return ShapComputeResponse(job_id=job.id, status="running", message="SHAP analysis started")
    except Exception as e:
        traceback.print_exc()
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
    if job_id not in _shap_results_cache:
        raise HTTPException(status_code=404, detail=f"SHAP results not found for job_id: {job_id}")

    r = _shap_results_cache[job_id]
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
    if job_id not in _shap_results_cache:
        raise HTTPException(status_code=404, detail=f"SHAP results not found for job_id: {job_id}")

    r = _shap_results_cache[job_id]
    return SpectralImportanceData(
        wavelengths=r["wavelengths"],
        mean_spectrum=r["mean_spectrum"],
        mean_abs_shap=r["mean_abs_shap"],
        binned_importance=r["binned_importance"]
    )


@router.get("/analysis/shap/results/{job_id}/spectral-detail")
async def get_spectral_detail(job_id: str, sample_indices: Optional[str] = Query(None)):
    """Get spectral data filtered to specific samples.

    When sample_indices is provided (comma-separated), returns SHAP
    importance and mean spectrum for only those samples.
    """
    if job_id not in _shap_results_cache:
        raise HTTPException(status_code=404, detail=f"SHAP results not found for job_id: {job_id}")

    r = _shap_results_cache[job_id]
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
    if job_id not in _shap_results_cache:
        raise HTTPException(status_code=404, detail=f"SHAP results not found for job_id: {job_id}")

    r = _shap_results_cache[job_id]
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
    if job_id not in _shap_results_cache:
        raise HTTPException(status_code=404, detail=f"SHAP results not found: {job_id}")

    r = _shap_results_cache[job_id]
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
    if job_id not in _shap_results_cache:
        raise HTTPException(status_code=404, detail=f"SHAP results not found for job_id: {job_id}")

    r = _shap_results_cache[job_id]
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


def _run_shap_task(job: Any, progress_callback: Callable[[float, str], bool]) -> Dict[str, Any]:
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
    analyzer = ShapAnalyzer()
    results = analyzer.explain_model(
        model=model, X=X, feature_names=feature_names,
        explainer_type=config.get("explainer_type", "auto"),
        n_background=config.get("n_background", 100),
        bin_size=config.get("bin_size", 20),
        bin_stride=config.get("bin_stride", 10),
        bin_aggregation=config.get("bin_aggregation", "sum"),
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
        bin_aggregation=config.get("bin_aggregation", "sum"),
        execution_time_ms=execution_time
    )
    processed["_y_true"] = y_true
    processed["_y_pred"] = y_pred

    _shap_results_cache[job_id] = processed

    progress_callback(100, "Complete")
    return {"job_id": job_id, "n_samples": processed["n_samples"]}


# ============= Helper Functions =============


def _get_available_chains() -> List[DatasetChains]:
    """Get available trained chains from the workspace store, grouped by dataset."""
    workspace = workspace_manager.get_active_workspace()
    if not workspace or not STORE_AVAILABLE:
        return []

    try:
        with StoreAdapter(Path(workspace.path)) as adapter:
            summaries = adapter.get_chain_summaries()
    except Exception as e:
        print(f"Error querying chain summaries: {e}")
        return []

    # Group by dataset_name
    datasets_map: Dict[str, List[Dict[str, Any]]] = {}
    for chain in summaries:
        ds = chain.get("dataset_name", "")
        if not ds:
            continue
        datasets_map.setdefault(ds, []).append(chain)

    # Check which chains have refit models
    store = None
    refit_chains: set = set()
    try:
        from nirs4all.pipeline.storage import WorkspaceStore
        store = WorkspaceStore(Path(workspace.path))
        for ds_chains in datasets_map.values():
            for c in ds_chains:
                chain_id = c.get("chain_id", "")
                if not chain_id:
                    continue
                chain_detail = store.get_chain(chain_id)
                if chain_detail:
                    fa = chain_detail.get("fold_artifacts") or {}
                    if fa.get("fold_final") or fa.get("final"):
                        refit_chains.add(chain_id)
    except Exception as e:
        print(f"Error checking refit chains: {e}")
    finally:
        if store:
            store.close()

    result = []
    for ds_name in sorted(datasets_map):
        chains = datasets_map[ds_name]
        # Sort: best cv_val_score first
        chains.sort(
            key=lambda c: c.get("cv_val_score") if c.get("cv_val_score") is not None else float("-inf"),
            reverse=True
        )
        metric = next((c.get("metric") for c in chains if c.get("metric")), "")
        task_type = next((c.get("task_type") for c in chains if c.get("task_type")), None)

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
                has_refit=c.get("chain_id", "") in refit_chains,
            )
            for c in chains[:20]
        ]

        result.append(DatasetChains(
            dataset_name=ds_name, metric=metric, task_type=task_type, chains=available
        ))

    return result


def _get_available_bundles() -> List[AvailableBundle]:
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


def _load_model_from_chain(chain_id: str) -> Tuple[Any, Dict[str, Any]]:
    """Load a trained model from a chain's fold_final artifact."""
    workspace = workspace_manager.get_active_workspace()
    if not workspace:
        raise ValueError("No active workspace")

    from nirs4all.pipeline.storage import WorkspaceStore
    store = WorkspaceStore(Path(workspace.path))
    try:
        chain = store.get_chain(chain_id)
        if chain is None:
            raise ValueError(f"Chain not found: {chain_id}")

        fold_artifacts = chain.get("fold_artifacts") or {}
        artifact_id = fold_artifacts.get("fold_final") or fold_artifacts.get("final")
        if not artifact_id:
            raise ValueError(f"No final model artifact for chain {chain_id}. The model may not have been refit.")

        model = store.load_artifact(artifact_id)
        model_info = {
            "chain_id": chain_id,
            "model_class": chain.get("model_class", ""),
            "dataset_name": chain.get("dataset_name", ""),
        }
        return model, model_info
    finally:
        store.close()


def _load_model_from_bundle(bundle_path: str) -> Tuple[Any, Dict[str, Any]]:
    """Load a model from a .n4a bundle."""
    path = Path(bundle_path)
    if not path.exists():
        raise ValueError(f"Bundle not found: {bundle_path}")

    from nirs4all.pipeline.bundle import NIRSBundle
    bundle = NIRSBundle.load(str(path))
    return bundle.model, {"type": "bundle", "path": str(path)}


def _resolve_dataset_id_by_name(name: str) -> Optional[str]:
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
    dataset_id: str, partition: str, n_samples: Optional[int]
) -> Tuple[np.ndarray, Optional[np.ndarray], List[float], List[str], List[int]]:
    """Load dataset for SHAP analysis. Returns (X, y, wavelengths, feature_names, sample_indices).

    The dataset_id may be a dataset link ID (e.g. "dataset_17378_3") or a dataset name
    (e.g. "corn") as stored in chain summaries. We try both lookups.
    """
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
    shap_values: np.ndarray, wavelengths: List[float],
    bin_size: int, bin_stride: int, bin_aggregation: str
) -> BinnedImportanceData:
    """Compute binned importance from raw SHAP values.

    Aggregation modes (applied per bin across wavelengths, then averaged across samples):
    - sum:      sum of raw SHAP per sample, then mean across samples (signed, allows cancellation)
    - sum_abs:  sum of |SHAP| per sample, then mean across samples (unsigned, total magnitude)
    - mean:     mean of raw SHAP per sample, then mean across samples (signed, normalized by bin size)
    - mean_abs: mean of |SHAP| per sample, then mean across samples (unsigned, normalized by bin size)
    """
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
    results: Dict[str, Any], job_id: str, model_id: str, dataset_id: str,
    wavelengths: List[float], sample_indices: List[int], X: np.ndarray,
    bin_size: int, bin_stride: int, bin_aggregation: str, execution_time_ms: float
) -> Dict[str, Any]:
    """Process raw SHAP results into webapp-friendly format."""
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
