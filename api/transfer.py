"""
Transfer Analysis API routes for nirs4all webapp.

This module provides FastAPI routes for transfer learning analysis,
evaluating how preprocessing affects inter-dataset distances and
transfer potential using PCA-based metrics (Grassmann, CKA, RV, etc.).
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .shared.logger import get_logger

logger = get_logger(__name__)

from .lazy_imports import get_cached, is_ml_ready, require_ml_ready

TRANSFER_AVAILABLE = True

router = APIRouter()


# ============= Request/Response Models =============


class PreprocessingStep(BaseModel):
    """Configuration for a single preprocessing step."""

    name: str = Field(..., description="Preprocessing operator name (e.g., 'SNV', 'MSC', 'SG')")
    params: dict[str, Any] = Field(default={}, description="Operator parameters")


class PreprocessingConfig(BaseModel):
    """Configuration for preprocessing in transfer analysis."""

    mode: Literal["preset", "manual"] = Field("preset", description="Preset or manual configuration")
    preset: str | None = Field("balanced", description="Preset name: fast, balanced, thorough, full")
    manual_steps: list[str] | None = Field(None, description="List of preprocessing names for manual mode")


class TransferAnalysisRequest(BaseModel):
    """Request model for transfer analysis."""

    dataset_ids: list[str] = Field(..., min_length=2, description="Dataset IDs to compare (at least 2)")
    preprocessing: PreprocessingConfig = Field(default_factory=PreprocessingConfig)
    n_components: int = Field(10, ge=2, le=50, description="Number of PCA components")
    knn: int = Field(10, ge=2, le=50, description="Number of neighbors for trustworthiness")


class DatasetPairDistance(BaseModel):
    """Distance metrics between a pair of datasets."""

    dataset_1: str
    dataset_2: str
    centroid_dist_raw: float
    centroid_dist_pp: float
    centroid_improvement: float  # Percentage improvement
    spread_dist_raw: float
    spread_dist_pp: float
    spread_improvement: float
    subspace_angle_raw: float | None = None
    subspace_angle_pp: float | None = None


class PreprocessingRankingItem(BaseModel):
    """Ranking item for a preprocessing method."""

    preproc: str
    display_name: str
    avg_distance: float
    reduction_pct: float
    raw_distance: float


class PCACoordinate(BaseModel):
    """PCA coordinate for a sample."""

    sample_index: int
    dataset: str
    x: float  # PC1
    y: float  # PC2
    z: float | None = None  # PC3 (optional)


class MetricConvergenceItem(BaseModel):
    """Metric convergence information for a preprocessing method."""

    preproc: str
    metric: str
    var_raw: float
    var_pp: float
    convergence: float  # Positive = variance reduced


class DatasetInfo(BaseModel):
    """Summary information about a dataset."""

    id: str
    name: str
    n_samples: int
    n_features: int


class TransferAnalysisSummary(BaseModel):
    """Summary statistics of the transfer analysis."""

    best_preprocessing: str
    best_reduction_pct: float
    n_datasets: int
    n_preprocessings: int
    n_pairs: int


class TransferAnalysisResponse(BaseModel):
    """Response model for transfer analysis."""

    success: bool
    execution_time_ms: float

    # Distance matrices per preprocessing
    distance_matrices: dict[str, list[DatasetPairDistance]]

    # Preprocessing ranking by metric
    preprocessing_ranking: dict[str, list[PreprocessingRankingItem]]

    # PCA coordinates for visualization
    pca_coordinates: dict[str, list[PCACoordinate]]

    # Metric convergence data
    metric_convergence: list[MetricConvergenceItem]

    # Summary and metadata
    summary: TransferAnalysisSummary
    datasets: list[DatasetInfo]
    preprocessings: list[str]


class TransferPresetInfo(BaseModel):
    """Information about a transfer analysis preset."""

    name: str
    description: str
    config: dict[str, Any]


class PreprocessingOptionInfo(BaseModel):
    """Information about an available preprocessing option."""

    name: str
    display_name: str
    category: str
    description: str
    default_params: dict[str, Any] = {}


# ============= API Endpoints =============


@router.post("/analysis/transfer", response_model=TransferAnalysisResponse)
async def compute_transfer_analysis(request: TransferAnalysisRequest):
    """
    Compute comprehensive transfer analysis between multiple datasets.

    Evaluates how different preprocessing methods affect inter-dataset distances
    using PCA-based metrics (Grassmann distance, CKA, RV coefficient, etc.).
    """
    if not TRANSFER_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="Transfer analysis not available. Ensure nirs4all is installed.",
        )

    start_time = time.time()

    # Validate datasets
    if len(request.dataset_ids) < 2:
        raise HTTPException(
            status_code=400,
            detail="At least 2 datasets are required for transfer analysis.",
        )

    # Load datasets
    raw_data = {}
    dataset_infos = []

    for dataset_id in request.dataset_ids:
        try:
            dataset, X, wavelengths = _load_dataset_data(dataset_id)
            raw_data[dataset_id] = X
            dataset_infos.append(
                DatasetInfo(
                    id=dataset_id,
                    name=dataset_id,
                    n_samples=X.shape[0],
                    n_features=X.shape[1],
                )
            )
        except Exception as e:
            raise HTTPException(
                status_code=404, detail=f"Error loading dataset '{dataset_id}': {str(e)}"
            )

    # Generate preprocessing pipelines
    preprocessing_pipelines = _generate_preprocessing_pipelines(request.preprocessing)

    # Apply preprocessing to all datasets
    pp_data = {}
    for pp_name, pp_func in preprocessing_pipelines.items():
        pp_data[pp_name] = {}
        for dataset_id, X in raw_data.items():
            try:
                X_pp = pp_func(X.copy())
                pp_data[pp_name][dataset_id] = X_pp
            except Exception as e:
                logger.warning("Preprocessing '%s' failed for '%s': %s", pp_name, dataset_id, e)
                # Skip failed preprocessing for this dataset
                continue

    # Run transfer analysis
    evaluator = get_cached("PreprocPCAEvaluator")(r_components=request.n_components, knn=request.knn)
    evaluator.fit(raw_data, pp_data)

    # Extract results
    distance_matrices = _extract_distance_matrices(evaluator)
    preprocessing_ranking = _extract_preprocessing_ranking(evaluator)
    pca_coordinates = _extract_pca_coordinates(evaluator, raw_data)
    metric_convergence = _extract_metric_convergence(evaluator)

    # Compute summary
    best_pp, best_reduction = _find_best_preprocessing(preprocessing_ranking)
    summary = TransferAnalysisSummary(
        best_preprocessing=best_pp,
        best_reduction_pct=best_reduction,
        n_datasets=len(request.dataset_ids),
        n_preprocessings=len(preprocessing_pipelines),
        n_pairs=len(request.dataset_ids) * (len(request.dataset_ids) - 1) // 2,
    )

    execution_time = (time.time() - start_time) * 1000

    return TransferAnalysisResponse(
        success=True,
        execution_time_ms=execution_time,
        distance_matrices=distance_matrices,
        preprocessing_ranking=preprocessing_ranking,
        pca_coordinates=pca_coordinates,
        metric_convergence=metric_convergence,
        summary=summary,
        datasets=dataset_infos,
        preprocessings=list(preprocessing_pipelines.keys()),
    )


@router.get("/analysis/transfer/presets", response_model=list[TransferPresetInfo])
async def get_transfer_presets():
    """Get available preset configurations for transfer analysis."""
    if not TRANSFER_AVAILABLE:
        raise HTTPException(
            status_code=501, detail="Transfer analysis not available."
        )

    presets_desc = get_cached("list_presets")()
    return [
        TransferPresetInfo(name=name, description=desc, config=get_cached("PRESETS").get(name, {}))
        for name, desc in presets_desc.items()
    ]


@router.get("/analysis/transfer/preprocessing-options", response_model=list[PreprocessingOptionInfo])
async def get_preprocessing_options():
    """Get available preprocessing operators for manual selection."""
    if not TRANSFER_AVAILABLE:
        raise HTTPException(
            status_code=501, detail="Transfer analysis not available."
        )

    # Get base preprocessings from nirs4all
    base_preprocessings = get_cached("get_base_preprocessings")()

    # Metadata for display - maps short names to display info
    # Category assignments based on nirs4all operator types
    metadata = {
        "snv": ("Standard Normal Variate", "Scalers", "Row-wise mean centering and unit variance scaling"),
        "rsnv": ("Robust Standard Normal Variate", "Scalers", "Robust SNV using median absolute deviation"),
        "msc": ("Multiplicative Scatter Correction", "Scatter Correction", "Correct multiplicative and additive scatter effects"),
        "emsc": ("Extended MSC", "Scatter Correction", "Extended MSC with polynomial baseline terms"),
        "savgol": ("Savitzky-Golay (11pt)", "Smoothing", "Polynomial smoothing filter (window=11, order=3)"),
        "savgol_15": ("Savitzky-Golay (15pt)", "Smoothing", "Polynomial smoothing filter (window=15, order=3)"),
        "d1": ("First Derivative", "Derivatives", "First derivative (removes baseline offset)"),
        "d2": ("Second Derivative", "Derivatives", "Second derivative (removes linear baseline)"),
        "savgol_d1": ("SG + 1st Derivative", "Derivatives", "Savitzky-Golay smoothed first derivative"),
        "savgol_d2": ("SG + 2nd Derivative", "Derivatives", "Savitzky-Golay smoothed second derivative"),
        "savgol15_d1": ("SG(15) + 1st Derivative", "Derivatives", "Savitzky-Golay (15pt) smoothed first derivative"),
        "haar": ("Haar Wavelet", "Wavelets", "Haar wavelet transform"),
        "detrend": ("Detrend", "Baseline", "Remove linear or polynomial trend"),
        "gaussian": ("Gaussian Smoothing", "Smoothing", "Gaussian filter smoothing (order=1, sigma=2)"),
        "gaussian2": ("Gaussian Smoothing (2nd)", "Smoothing", "Gaussian filter smoothing (order=2, sigma=2)"),
        "area_norm": ("Area Normalization", "Normalization", "Normalize by total spectral area"),
        "wav_sym5": ("Symlet-5 Wavelet", "Wavelets", "Symlet-5 wavelet transform"),
        "wav_coif3": ("Coiflet-3 Wavelet", "Wavelets", "Coiflet-3 wavelet transform"),
        "identity": ("Identity (No transform)", "Other", "Pass-through transformation"),
    }

    options = []
    for name, transform_obj in base_preprocessings.items():
        display_name, category, description = metadata.get(
            name,
            (name.replace("_", " ").title(), "Other", f"Transform: {type(transform_obj).__name__}")
        )

        # Extract default params if available
        default_params = {}
        if hasattr(transform_obj, "get_params"):
            try:
                default_params = transform_obj.get_params(deep=False)
            except Exception:
                pass

        options.append(
            PreprocessingOptionInfo(
                name=name,
                display_name=display_name,
                category=category,
                description=description,
                default_params=default_params,
            )
        )

    # Sort by category then by name for consistent ordering
    options.sort(key=lambda x: (x.category, x.name))
    return options


# ============= Helper Functions =============


def _load_dataset_data(dataset_id: str) -> tuple:
    """Load dataset and return (dataset, X, wavelengths)."""
    import numpy as np

    from .spectra import _load_dataset

    dataset = _load_dataset(dataset_id)
    if dataset is None:
        raise ValueError(f"Dataset '{dataset_id}' not found")

    # Get spectral data from train partition
    selector = {"partition": "train"}
    X = dataset.x(selector, layout="2d")

    # Handle multi-source datasets
    if isinstance(X, list):
        X = X[0]

    X = np.asarray(X)

    # Get wavelengths
    wavelengths = None
    try:
        headers = dataset.headers(0)
        wavelengths = [float(h) for h in headers] if headers else None
    except Exception:
        pass

    if wavelengths is None:
        wavelengths = list(range(X.shape[1]))

    return dataset, X, wavelengths


def _generate_preprocessing_pipelines(config: PreprocessingConfig) -> dict[str, Any]:
    """Generate preprocessing functions based on configuration."""
    pipelines = {}

    if config.mode == "preset":
        # Generate standard preprocessing combinations based on preset
        preset_name = config.preset or "balanced"

        # Always include baseline preprocessings
        preprocessings = ["SNV", "MSC", "SG_smooth", "FirstDeriv"]

        if preset_name in ("balanced", "thorough", "full"):
            preprocessings.extend(["SNV+SG", "MSC+SG", "SecondDeriv"])

        if preset_name in ("thorough", "full"):
            preprocessings.extend(["Detrend", "Detrend+SNV"])

    else:
        # Manual mode - use specified steps
        preprocessings = config.manual_steps or ["SNV", "MSC"]

    # Build pipeline functions
    for pp_name in preprocessings:
        try:
            pp_func = _build_preprocessing_function(pp_name)
            if pp_func:
                pipelines[pp_name] = pp_func
        except Exception as e:
            logger.warning("Could not build preprocessing '%s': %s", pp_name, e)

    return pipelines


def _build_preprocessing_function(name: str):
    """Build a preprocessing function from a name using nirs4all operators."""
    from nirs4all.operators.transforms.nirs import (
        AreaNormalization,
        FirstDerivative,
        MultiplicativeScatterCorrection,
        SavitzkyGolay,
        SecondDerivative,
    )
    from nirs4all.operators.transforms.scalers import StandardNormalVariate
    from nirs4all.operators.transforms.signal import Detrend
    from sklearn.preprocessing import MinMaxScaler, Normalizer, StandardScaler

    # Define preprocessing mapping using nirs4all operators
    if name == "SNV":
        return lambda X: StandardNormalVariate().fit_transform(X)

    elif name == "MSC":
        return lambda X: MultiplicativeScatterCorrection().fit_transform(X)

    elif name in ("SG", "SG_smooth"):
        return lambda X: SavitzkyGolay(window_length=11, polyorder=2, deriv=0).fit_transform(X)

    elif name in ("FirstDeriv", "FirstDerivative"):
        return lambda X: FirstDerivative().fit_transform(X)

    elif name in ("SecondDeriv", "SecondDerivative"):
        return lambda X: SecondDerivative().fit_transform(X)

    elif name == "Detrend":
        return lambda X: Detrend().fit_transform(X)

    elif name == "MinMaxScaler":
        return lambda X: MinMaxScaler().fit_transform(X)

    elif name == "StandardScaler":
        return lambda X: StandardScaler().fit_transform(X)

    elif name in ("AreaNorm", "AreaNormalization"):
        return lambda X: AreaNormalization().fit_transform(X)

    elif name == "L2Norm":
        return lambda X: Normalizer(norm="l2").fit_transform(X)

    elif name == "SNV+SG":
        snv = StandardNormalVariate()
        sg = SavitzkyGolay(window_length=11, polyorder=2, deriv=0)
        return lambda X: sg.fit_transform(snv.fit_transform(X))

    elif name == "MSC+SG":
        msc = MultiplicativeScatterCorrection()
        sg = SavitzkyGolay(window_length=11, polyorder=2, deriv=0)
        return lambda X: sg.fit_transform(msc.fit_transform(X))

    elif name == "Detrend+SNV":
        det = Detrend()
        snv = StandardNormalVariate()
        return lambda X: snv.fit_transform(det.fit_transform(X))

    else:
        # Unknown preprocessing - return identity
        logger.warning("Unknown preprocessing '%s', using identity", name)
        return lambda X: X


def _extract_distance_matrices(evaluator: Any) -> dict[str, list[DatasetPairDistance]]:
    """Extract distance matrices from evaluator results."""
    import numpy as np
    if evaluator.cross_dataset_df_ is None or evaluator.cross_dataset_df_.empty:
        return {}

    result = {}
    df = evaluator.cross_dataset_df_

    for pp_name in df["preproc"].unique():
        pp_df = df[df["preproc"] == pp_name]
        pairs = []

        for _, row in pp_df.iterrows():
            pairs.append(
                DatasetPairDistance(
                    dataset_1=row["dataset_1"],
                    dataset_2=row["dataset_2"],
                    centroid_dist_raw=float(row["centroid_dist_raw"]),
                    centroid_dist_pp=float(row["centroid_dist_pp"]),
                    centroid_improvement=float(row["centroid_improvement"] * 100),
                    spread_dist_raw=float(row["spread_dist_raw"]),
                    spread_dist_pp=float(row["spread_dist_pp"]),
                    spread_improvement=float(row["spread_improvement"] * 100),
                    subspace_angle_raw=float(row["subspace_angle_raw"]) if not np.isnan(row["subspace_angle_raw"]) else None,
                    subspace_angle_pp=float(row["subspace_angle_pp"]) if not np.isnan(row["subspace_angle_pp"]) else None,
                )
            )

        result[pp_name] = pairs

    return result


def _extract_preprocessing_ranking(evaluator: Any) -> dict[str, list[PreprocessingRankingItem]]:
    """Extract preprocessing ranking from evaluator results."""
    result = {}

    if evaluator.cross_dataset_df_ is None or evaluator.cross_dataset_df_.empty:
        return result

    df = evaluator.cross_dataset_df_

    for metric in ["centroid", "spread"]:
        metric_col_raw = f"{metric}_dist_raw"
        metric_col_pp = f"{metric}_dist_pp"

        # Get average raw distance
        avg_raw = df.groupby(["dataset_1", "dataset_2"])[metric_col_raw].first().mean()

        rankings = []
        for pp_name in df["preproc"].unique():
            pp_df = df[df["preproc"] == pp_name]
            avg_pp = pp_df[metric_col_pp].mean()
            reduction = ((avg_raw - avg_pp) / avg_raw) * 100 if avg_raw > 0 else 0

            # Format display name
            display_name = pp_name.split("|")[-1].replace("MinMax>", "").replace(">", " → ")
            if len(display_name) > 30:
                display_name = display_name[:27] + "..."

            rankings.append(
                PreprocessingRankingItem(
                    preproc=pp_name,
                    display_name=display_name,
                    avg_distance=float(avg_pp),
                    reduction_pct=float(reduction),
                    raw_distance=float(avg_raw),
                )
            )

        # Sort by reduction (descending)
        rankings.sort(key=lambda x: x.reduction_pct, reverse=True)
        result[metric] = rankings

    return result


def _extract_pca_coordinates(
    evaluator: Any, raw_data: dict[str, Any]
) -> dict[str, list[PCACoordinate]]:
    """Extract PCA coordinates for visualization."""
    result = {}

    # Raw PCA coordinates
    raw_coords = []
    for dataset_name in raw_data:
        if dataset_name in evaluator.raw_pcas_:
            Z, _, _ = evaluator.raw_pcas_[dataset_name]
            for i in range(Z.shape[0]):
                raw_coords.append(
                    PCACoordinate(
                        sample_index=i,
                        dataset=dataset_name,
                        x=float(Z[i, 0]),
                        y=float(Z[i, 1]) if Z.shape[1] > 1 else 0.0,
                        z=float(Z[i, 2]) if Z.shape[1] > 2 else None,
                    )
                )
    result["raw"] = raw_coords

    # Preprocessed PCA coordinates
    preprocs = {pp for (ds, pp) in evaluator.pp_pcas_}

    for pp_name in preprocs:
        pp_coords = []
        for dataset_name in raw_data:
            if (dataset_name, pp_name) in evaluator.pp_pcas_:
                Z, _, _ = evaluator.pp_pcas_[(dataset_name, pp_name)]
                for i in range(Z.shape[0]):
                    pp_coords.append(
                        PCACoordinate(
                            sample_index=i,
                            dataset=dataset_name,
                            x=float(Z[i, 0]),
                            y=float(Z[i, 1]) if Z.shape[1] > 1 else 0.0,
                            z=float(Z[i, 2]) if Z.shape[1] > 2 else None,
                        )
                    )
        result[pp_name] = pp_coords

    return result


def _extract_metric_convergence(evaluator: Any) -> list[MetricConvergenceItem]:
    """Extract metric convergence data from evaluator."""
    import numpy as np
    result = []

    try:
        convergence_df = evaluator.get_quality_metric_convergence()

        metrics = ["evr_pre", "cka", "rv", "procrustes", "trustworthiness", "grassmann"]
        metric_display = {
            "evr_pre": "EVR",
            "cka": "CKA",
            "rv": "RV",
            "procrustes": "Procrustes",
            "trustworthiness": "Trustworthiness",
            "grassmann": "Grassmann",
        }

        for _, row in convergence_df.iterrows():
            for metric in metrics:
                var_raw = row.get(f"{metric}_var_raw", 0)
                var_pp = row.get(f"{metric}_var_pp", 0)
                convergence = row.get(f"{metric}_convergence", 0)

                if not np.isnan(convergence):
                    result.append(
                        MetricConvergenceItem(
                            preproc=row["preproc"],
                            metric=metric_display.get(metric, metric),
                            var_raw=float(var_raw) if not np.isnan(var_raw) else 0.0,
                            var_pp=float(var_pp) if not np.isnan(var_pp) else 0.0,
                            convergence=float(convergence),
                        )
                    )
    except Exception as e:
        logger.warning("Could not extract metric convergence: %s", e)

    return result


def _find_best_preprocessing(ranking: dict[str, list[PreprocessingRankingItem]]) -> tuple:
    """Find the best preprocessing based on centroid distance reduction."""
    if "centroid" not in ranking or not ranking["centroid"]:
        return "None", 0.0

    best = ranking["centroid"][0]
    return best.preproc, best.reduction_pct
