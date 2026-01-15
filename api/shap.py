"""
SHAP Analysis API routes for nirs4all webapp.

This module provides FastAPI routes for SHAP-based model explanations,
computing feature importance and generating visualizations for model
interpretability.
"""

import sys
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Tuple

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .workspace_manager import workspace_manager

# Add nirs4all to path if needed
nirs4all_path = Path(__file__).parent.parent.parent / "nirs4all"
if str(nirs4all_path) not in sys.path:
    sys.path.insert(0, str(nirs4all_path))

try:
    import nirs4all
    from nirs4all.visualization.analysis.shap import ShapAnalyzer, SHAP_AVAILABLE
    NIRS4ALL_AVAILABLE = True
except ImportError as e:
    print(f"Note: nirs4all not available for SHAP: {e}")
    NIRS4ALL_AVAILABLE = False
    SHAP_AVAILABLE = False

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


class ShapComputeRequest(BaseModel):
    """Request model for SHAP computation."""
    model_source: Literal["run", "bundle"] = Field(..., description="Source of the model")
    model_id: str = Field(..., description="Run ID or bundle path")
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


class ShapResultsSummary(BaseModel):
    """Summary of SHAP computation results."""
    job_id: str
    model_id: str
    dataset_id: str
    explainer_type: str
    n_samples: int
    n_features: int
    base_value: float
    execution_time_ms: float


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

    # Feature importance (top features)
    feature_importance: List[FeatureImportance]

    # Wavelengths and raw data
    wavelengths: List[float]
    mean_abs_shap: List[float]

    # Binned data for spectral visualization
    binned_importance: BinnedImportanceData

    # Sample info
    sample_indices: List[int]


class AvailableModel(BaseModel):
    """Information about an available model for SHAP analysis."""
    source: Literal["run", "bundle"]
    model_id: str
    display_name: str
    model_type: str
    dataset_name: str
    created_at: Optional[str] = None
    metrics: Dict[str, float] = {}


class AvailableModelsResponse(BaseModel):
    """Response listing available models."""
    runs: List[AvailableModel]
    bundles: List[AvailableModel]


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
    """List available models for SHAP analysis."""
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="nirs4all not available. SHAP analysis requires nirs4all."
        )

    runs: List[AvailableModel] = []
    bundles: List[AvailableModel] = []

    # Get models from completed runs
    try:
        runs_data = _get_models_from_runs()
        runs.extend(runs_data)
    except Exception as e:
        print(f"Error getting models from runs: {e}")

    # Get exported bundles
    try:
        bundles_data = _get_models_from_bundles()
        bundles.extend(bundles_data)
    except Exception as e:
        print(f"Error getting bundles: {e}")

    return AvailableModelsResponse(runs=runs, bundles=bundles)


@router.post("/analysis/shap/compute", response_model=ShapComputeResponse)
async def compute_shap_explanation(request: ShapComputeRequest):
    """
    Compute SHAP explanations for a model.

    This endpoint computes SHAP values synchronously for now.
    For large datasets, consider implementing async with job polling.
    """
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="nirs4all not available. SHAP analysis requires nirs4all."
        )

    if not SHAP_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="SHAP not installed. Install with: pip install shap"
        )

    job_id = str(uuid.uuid4())[:8]
    start_time = time.time()

    try:
        # Load model
        model, model_info = _load_model(request.model_source, request.model_id)

        # Load dataset
        X, wavelengths, feature_names, sample_indices = _load_dataset_for_shap(
            request.dataset_id,
            request.partition,
            request.n_samples
        )

        # Create SHAP analyzer and compute
        analyzer = ShapAnalyzer()

        results = analyzer.explain_model(
            model=model,
            X=X,
            feature_names=feature_names,
            explainer_type=request.explainer_type,
            n_background=request.n_background,
            bin_size=request.bin_size,
            bin_stride=request.bin_stride,
            bin_aggregation=request.bin_aggregation,
            output_dir=None,  # Don't save files
            visualizations=None,  # Generate data only
            plots_visible=False
        )

        execution_time = (time.time() - start_time) * 1000

        # Process and cache results
        processed_results = _process_shap_results(
            results=results,
            job_id=job_id,
            model_id=request.model_id,
            dataset_id=request.dataset_id,
            wavelengths=wavelengths,
            sample_indices=sample_indices,
            X=X,
            bin_size=request.bin_size,
            bin_stride=request.bin_stride,
            bin_aggregation=request.bin_aggregation,
            execution_time_ms=execution_time
        )

        _shap_results_cache[job_id] = processed_results

        return ShapComputeResponse(
            job_id=job_id,
            status="completed",
            message=f"SHAP analysis completed in {execution_time:.0f}ms"
        )

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"SHAP computation failed: {str(e)}"
        )


@router.get("/analysis/shap/results/{job_id}", response_model=ShapResultsResponse)
async def get_shap_results(job_id: str):
    """Get SHAP results for a completed job."""
    if job_id not in _shap_results_cache:
        raise HTTPException(
            status_code=404,
            detail=f"SHAP results not found for job_id: {job_id}"
        )

    results = _shap_results_cache[job_id]

    return ShapResultsResponse(
        job_id=results["job_id"],
        model_id=results["model_id"],
        dataset_id=results["dataset_id"],
        explainer_type=results["explainer_type"],
        n_samples=results["n_samples"],
        n_features=results["n_features"],
        base_value=results["base_value"],
        execution_time_ms=results["execution_time_ms"],
        feature_importance=results["feature_importance"],
        wavelengths=results["wavelengths"],
        mean_abs_shap=results["mean_abs_shap"],
        binned_importance=results["binned_importance"],
        sample_indices=results["sample_indices"]
    )


@router.get("/analysis/shap/results/{job_id}/spectral", response_model=SpectralImportanceData)
async def get_spectral_importance(job_id: str):
    """Get spectral importance data for visualization."""
    if job_id not in _shap_results_cache:
        raise HTTPException(
            status_code=404,
            detail=f"SHAP results not found for job_id: {job_id}"
        )

    results = _shap_results_cache[job_id]

    return SpectralImportanceData(
        wavelengths=results["wavelengths"],
        mean_spectrum=results["mean_spectrum"],
        mean_abs_shap=results["mean_abs_shap"],
        binned_importance=results["binned_importance"]
    )


@router.get("/analysis/shap/results/{job_id}/beeswarm", response_model=BeeswarmDataResponse)
async def get_beeswarm_data(job_id: str, max_samples: int = 200):
    """Get beeswarm plot data."""
    if job_id not in _shap_results_cache:
        raise HTTPException(
            status_code=404,
            detail=f"SHAP results not found for job_id: {job_id}"
        )

    results = _shap_results_cache[job_id]

    # Get raw data needed for beeswarm
    shap_values = results["_raw_shap_values"]
    X = results["_raw_X"]
    wavelengths = results["wavelengths"]
    bin_size = results["binned_importance"]["bin_size"]
    bin_stride = results["binned_importance"]["bin_stride"]

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

        # Aggregate SHAP values for this bin
        bin_shap = shap_values[:, start:end].sum(axis=1)
        bin_features = X[:, start:end].mean(axis=1)

        # Normalize feature values for coloring
        feat_min, feat_max = bin_features.min(), bin_features.max()
        if feat_max > feat_min:
            bin_features_norm = (bin_features - feat_min) / (feat_max - feat_min)
        else:
            bin_features_norm = np.zeros_like(bin_features)

        # Create points
        points = [
            BeeswarmPoint(
                sample_idx=int(indices[i]),
                shap_value=float(bin_shap[i]),
                feature_value=float(bin_features_norm[i])
            )
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

    # Sort bins by mean absolute SHAP (most important first)
    bins.sort(key=lambda b: -np.mean([abs(p.shap_value) for p in b.points]))

    return BeeswarmDataResponse(
        bins=bins[:20],  # Top 20 bins
        base_value=results["base_value"]
    )


@router.get("/analysis/shap/results/{job_id}/sample/{sample_idx}", response_model=SampleExplanationResponse)
async def get_sample_explanation(job_id: str, sample_idx: int, top_n: int = 15):
    """Get single sample explanation for waterfall plot."""
    if job_id not in _shap_results_cache:
        raise HTTPException(
            status_code=404,
            detail=f"SHAP results not found for job_id: {job_id}"
        )

    results = _shap_results_cache[job_id]

    # Get raw data
    shap_values = results["_raw_shap_values"]
    X = results["_raw_X"]
    wavelengths = results["wavelengths"]
    base_value = results["base_value"]
    bin_size = results["binned_importance"]["bin_size"]
    bin_stride = results["binned_importance"]["bin_stride"]

    # Validate sample index
    if sample_idx < 0 or sample_idx >= shap_values.shape[0]:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid sample_idx: {sample_idx}. Must be 0-{shap_values.shape[0]-1}"
        )

    sample_shap = shap_values[sample_idx]
    sample_X = X[sample_idx]

    # Bin the values
    contributions = []
    n_features = len(wavelengths)
    start = 0

    while start < n_features - bin_size + 1:
        end = start + bin_size

        bin_shap = sample_shap[start:end].sum()
        bin_feature = sample_X[start:end].mean()

        contributions.append({
            "label": f"{wavelengths[start]:.1f}-{wavelengths[end-1]:.1f}",
            "wavelength": float(np.mean(wavelengths[start:end])),
            "shap_value": float(bin_shap),
            "feature_value": float(bin_feature)
        })

        start += bin_stride

    # Sort by absolute SHAP value
    contributions.sort(key=lambda c: -abs(c["shap_value"]))

    # Take top N and aggregate rest
    top_contributions = contributions[:top_n]
    rest_shap = sum(c["shap_value"] for c in contributions[top_n:])

    if abs(rest_shap) > 0.001:
        top_contributions.append({
            "label": f"Other ({len(contributions) - top_n} bins)",
            "wavelength": None,
            "shap_value": rest_shap,
            "feature_value": 0
        })

    # Build cumulative values
    cumulative = base_value
    result_contributions = []

    for c in top_contributions:
        cumulative += c["shap_value"]
        result_contributions.append(FeatureContribution(
            feature_name=c["label"],
            wavelength=c["wavelength"],
            shap_value=c["shap_value"],
            feature_value=c["feature_value"],
            cumulative=cumulative
        ))

    predicted_value = base_value + sample_shap.sum()

    return SampleExplanationResponse(
        sample_idx=sample_idx,
        predicted_value=float(predicted_value),
        base_value=float(base_value),
        contributions=result_contributions
    )


# ============= Helper Functions =============


def _get_models_from_runs() -> List[AvailableModel]:
    """Get available models from completed training runs."""
    models = []

    # Get workspace paths
    workspace = workspace_manager.get_active_workspace()
    if not workspace:
        return models

    runs_path = Path(workspace.path) / "workspace" / "runs"
    if not runs_path.exists():
        return models

    # Scan for completed runs with models
    for dataset_dir in runs_path.iterdir():
        if not dataset_dir.is_dir():
            continue

        for run_dir in dataset_dir.iterdir():
            if not run_dir.is_dir():
                continue

            manifest_path = run_dir / "manifest.yaml"
            if not manifest_path.exists():
                continue

            try:
                import yaml
                with open(manifest_path) as f:
                    manifest = yaml.safe_load(f)

                # Check if run has models
                if manifest.get("status") != "completed":
                    continue

                best_config = manifest.get("best_config", {})
                if not best_config:
                    continue

                model_type = best_config.get("model_class", "Unknown")
                metrics = {}
                if "metrics" in best_config:
                    metrics = {k: float(v) for k, v in best_config["metrics"].items()
                              if isinstance(v, (int, float))}

                models.append(AvailableModel(
                    source="run",
                    model_id=run_dir.name,
                    display_name=f"{dataset_dir.name}/{run_dir.name}",
                    model_type=model_type,
                    dataset_name=dataset_dir.name,
                    created_at=manifest.get("end_time"),
                    metrics=metrics
                ))

            except Exception as e:
                print(f"Error reading manifest {manifest_path}: {e}")
                continue

    return models


def _get_models_from_bundles() -> List[AvailableModel]:
    """Get available models from exported .n4a bundles."""
    models = []

    workspace = workspace_manager.get_active_workspace()
    if not workspace:
        return models

    exports_path = Path(workspace.path) / "workspace" / "exports"
    if not exports_path.exists():
        return models

    # Scan for .n4a files
    for n4a_file in exports_path.rglob("*.n4a"):
        try:
            models.append(AvailableModel(
                source="bundle",
                model_id=str(n4a_file),
                display_name=n4a_file.stem,
                model_type="Bundle",
                dataset_name=n4a_file.parent.name if n4a_file.parent != exports_path else "exports",
                created_at=None,
                metrics={}
            ))
        except Exception:
            continue

    return models


def _load_model(source: str, model_id: str) -> Tuple[Any, Dict[str, Any]]:
    """Load model from run or bundle."""
    if source == "bundle":
        # Load from .n4a bundle
        bundle_path = Path(model_id)
        if not bundle_path.exists():
            raise ValueError(f"Bundle not found: {model_id}")

        # Use nirs4all to load bundle
        from nirs4all.pipeline.bundle import NIRSBundle
        bundle = NIRSBundle.load(str(bundle_path))
        model = bundle.model
        model_info = {"type": "bundle", "path": str(bundle_path)}

    else:  # source == "run"
        # Load from training run
        workspace = workspace_manager.get_active_workspace()
        if not workspace:
            raise ValueError("No active workspace")

        runs_path = Path(workspace.path) / "workspace" / "runs"

        # Find the run directory
        run_dir = None
        for dataset_dir in runs_path.iterdir():
            if not dataset_dir.is_dir():
                continue
            candidate = dataset_dir / model_id
            if candidate.exists():
                run_dir = candidate
                break

        if not run_dir:
            raise ValueError(f"Run not found: {model_id}")

        # Load model from artifacts
        import yaml
        manifest_path = run_dir / "manifest.yaml"
        with open(manifest_path) as f:
            manifest = yaml.safe_load(f)

        best_config = manifest.get("best_config", {})
        model_path = best_config.get("model_path")

        if not model_path:
            # Try to find model in binaries
            binaries_path = Path(workspace.path) / "workspace" / "binaries"
            model_files = list(binaries_path.rglob("*.joblib"))
            if model_files:
                model_path = str(model_files[0])

        if not model_path or not Path(model_path).exists():
            raise ValueError(f"Model file not found for run: {model_id}")

        import joblib
        model = joblib.load(model_path)
        model_info = {"type": "run", "run_id": model_id, "path": model_path}

    return model, model_info


def _load_dataset_for_shap(
    dataset_id: str,
    partition: str,
    n_samples: Optional[int]
) -> Tuple[np.ndarray, List[float], List[str], List[int]]:
    """Load dataset for SHAP analysis."""
    from .spectra import _load_dataset

    dataset = _load_dataset(dataset_id)
    if dataset is None:
        raise ValueError(f"Dataset not found: {dataset_id}")

    # Get data based on partition
    if partition == "all":
        selector = {}
    else:
        selector = {"partition": partition}

    X = dataset.x(selector, layout="2d")

    # Handle multi-source datasets
    if isinstance(X, list):
        X = X[0]

    X = np.asarray(X)

    # Get wavelengths
    try:
        headers = dataset.headers(0)
        wavelengths = [float(h) for h in headers] if headers else list(range(X.shape[1]))
    except Exception:
        wavelengths = list(range(X.shape[1]))

    # Create feature names
    feature_names = [f"λ{w:.1f}" for w in wavelengths]

    # Sample indices
    all_indices = list(range(X.shape[0]))

    # Limit samples if requested
    if n_samples and n_samples < X.shape[0]:
        indices = np.random.choice(X.shape[0], n_samples, replace=False)
        X = X[indices]
        sample_indices = [all_indices[i] for i in indices]
    else:
        sample_indices = all_indices

    return X, wavelengths, feature_names, sample_indices


def _process_shap_results(
    results: Dict[str, Any],
    job_id: str,
    model_id: str,
    dataset_id: str,
    wavelengths: List[float],
    sample_indices: List[int],
    X: np.ndarray,
    bin_size: int,
    bin_stride: int,
    bin_aggregation: str,
    execution_time_ms: float
) -> Dict[str, Any]:
    """Process raw SHAP results into webapp-friendly format."""
    shap_values = results["shap_values"]
    base_value = results["base_value"]
    n_samples, n_features = shap_values.shape

    # Mean absolute SHAP per feature
    mean_abs_shap = np.abs(shap_values).mean(axis=0).tolist()

    # Mean spectrum
    mean_spectrum = X.mean(axis=0).tolist()

    # Create binned importance data
    bin_centers = []
    bin_values = []
    bin_ranges = []

    start = 0
    while start < n_features - bin_size + 1:
        end = start + bin_size

        bin_wavelengths = wavelengths[start:end]
        bin_shap = np.abs(shap_values[:, start:end]).mean(axis=0)

        bin_centers.append(float(np.mean(bin_wavelengths)))
        bin_ranges.append((float(bin_wavelengths[0]), float(bin_wavelengths[-1])))

        # Aggregate based on method
        if bin_aggregation == "sum":
            bin_values.append(float(bin_shap.sum()))
        elif bin_aggregation == "sum_abs":
            bin_values.append(float(np.abs(bin_shap).sum()))
        elif bin_aggregation == "mean":
            bin_values.append(float(bin_shap.mean()))
        elif bin_aggregation == "mean_abs":
            bin_values.append(float(np.abs(bin_shap).mean()))

        start += bin_stride

    binned_importance = BinnedImportanceData(
        bin_centers=bin_centers,
        bin_values=bin_values,
        bin_ranges=bin_ranges,
        bin_size=bin_size,
        bin_stride=bin_stride,
        aggregation=bin_aggregation
    )

    # Top feature importance
    importance_indices = np.argsort(mean_abs_shap)[::-1][:20]
    feature_importance = [
        FeatureImportance(
            feature_idx=int(idx),
            feature_name=f"λ{wavelengths[idx]:.1f}",
            wavelength=float(wavelengths[idx]),
            importance=float(mean_abs_shap[idx])
        )
        for idx in importance_indices
    ]

    return {
        "job_id": job_id,
        "model_id": model_id,
        "dataset_id": dataset_id,
        "explainer_type": results["explainer_type"],
        "n_samples": n_samples,
        "n_features": n_features,
        "base_value": float(base_value) if base_value is not None else 0.0,
        "execution_time_ms": execution_time_ms,
        "feature_importance": feature_importance,
        "wavelengths": wavelengths,
        "mean_abs_shap": mean_abs_shap,
        "mean_spectrum": mean_spectrum,
        "binned_importance": binned_importance,
        "sample_indices": sample_indices,
        # Keep raw data for beeswarm/waterfall
        "_raw_shap_values": shap_values,
        "_raw_X": X
    }
