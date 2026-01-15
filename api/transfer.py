"""
Transfer Analysis API routes for nirs4all webapp.

This module provides FastAPI routes for transfer learning analysis,
evaluating how preprocessing affects inter-dataset distances and
transfer potential using PCA-based metrics (Grassmann, CKA, RV, etc.).
"""

import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .workspace_manager import workspace_manager

# Add nirs4all to path if needed
nirs4all_path = Path(__file__).parent.parent.parent / "nirs4all"
if str(nirs4all_path) not in sys.path:
    sys.path.insert(0, str(nirs4all_path))

try:
    from nirs4all.visualization.analysis.transfer import PreprocPCAEvaluator
    from nirs4all.analysis.presets import PRESETS, list_presets

    TRANSFER_AVAILABLE = True
except ImportError as e:
    print(f"Note: Transfer analysis not available: {e}")
    TRANSFER_AVAILABLE = False

router = APIRouter()


# ============= Request/Response Models =============


class PreprocessingStep(BaseModel):
    """Configuration for a single preprocessing step."""

    name: str = Field(..., description="Preprocessing operator name (e.g., 'SNV', 'MSC', 'SG')")
    params: Dict[str, Any] = Field(default={}, description="Operator parameters")


class PreprocessingConfig(BaseModel):
    """Configuration for preprocessing in transfer analysis."""

    mode: Literal["preset", "manual"] = Field("preset", description="Preset or manual configuration")
    preset: Optional[str] = Field("balanced", description="Preset name: fast, balanced, thorough, full")
    manual_steps: Optional[List[str]] = Field(None, description="List of preprocessing names for manual mode")


class TransferAnalysisRequest(BaseModel):
    """Request model for transfer analysis."""

    dataset_ids: List[str] = Field(..., min_length=2, description="Dataset IDs to compare (at least 2)")
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
    subspace_angle_raw: Optional[float] = None
    subspace_angle_pp: Optional[float] = None


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
    z: Optional[float] = None  # PC3 (optional)


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
    distance_matrices: Dict[str, List[DatasetPairDistance]]

    # Preprocessing ranking by metric
    preprocessing_ranking: Dict[str, List[PreprocessingRankingItem]]

    # PCA coordinates for visualization
    pca_coordinates: Dict[str, List[PCACoordinate]]

    # Metric convergence data
    metric_convergence: List[MetricConvergenceItem]

    # Summary and metadata
    summary: TransferAnalysisSummary
    datasets: List[DatasetInfo]
    preprocessings: List[str]


class TransferPresetInfo(BaseModel):
    """Information about a transfer analysis preset."""

    name: str
    description: str
    config: Dict[str, Any]


class PreprocessingOptionInfo(BaseModel):
    """Information about an available preprocessing option."""

    name: str
    display_name: str
    category: str
    description: str
    default_params: Dict[str, Any] = {}


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
                print(f"Warning: Preprocessing '{pp_name}' failed for '{dataset_id}': {e}")
                # Skip failed preprocessing for this dataset
                continue

    # Run transfer analysis
    evaluator = PreprocPCAEvaluator(r_components=request.n_components, knn=request.knn)
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


@router.get("/analysis/transfer/presets", response_model=List[TransferPresetInfo])
async def get_transfer_presets():
    """Get available preset configurations for transfer analysis."""
    if not TRANSFER_AVAILABLE:
        raise HTTPException(
            status_code=501, detail="Transfer analysis not available."
        )

    presets_desc = list_presets()
    return [
        TransferPresetInfo(name=name, description=desc, config=PRESETS.get(name, {}))
        for name, desc in presets_desc.items()
    ]


@router.get("/analysis/transfer/preprocessing-options", response_model=List[PreprocessingOptionInfo])
async def get_preprocessing_options():
    """Get available preprocessing operators for manual selection."""
    # Define available preprocessing options
    options = [
        # Scalers
        PreprocessingOptionInfo(
            name="SNV",
            display_name="Standard Normal Variate",
            category="Scalers",
            description="Row-wise mean centering and unit variance scaling",
        ),
        PreprocessingOptionInfo(
            name="MinMaxScaler",
            display_name="Min-Max Scaler",
            category="Scalers",
            description="Scale features to [0, 1] range",
        ),
        PreprocessingOptionInfo(
            name="StandardScaler",
            display_name="Standard Scaler",
            category="Scalers",
            description="Column-wise standardization (mean=0, std=1)",
        ),
        # Scatter correction
        PreprocessingOptionInfo(
            name="MSC",
            display_name="Multiplicative Scatter Correction",
            category="Scatter Correction",
            description="Correct multiplicative and additive scatter effects",
        ),
        PreprocessingOptionInfo(
            name="EMSC",
            display_name="Extended MSC",
            category="Scatter Correction",
            description="Extended MSC with polynomial baseline terms",
        ),
        # Derivatives
        PreprocessingOptionInfo(
            name="SG",
            display_name="Savitzky-Golay",
            category="Smoothing",
            description="Polynomial smoothing filter",
            default_params={"window_length": 11, "polyorder": 2, "deriv": 0},
        ),
        PreprocessingOptionInfo(
            name="FirstDerivative",
            display_name="1st Derivative",
            category="Derivatives",
            description="First derivative (removes baseline offset)",
        ),
        PreprocessingOptionInfo(
            name="SecondDerivative",
            display_name="2nd Derivative",
            category="Derivatives",
            description="Second derivative (removes linear baseline)",
        ),
        # Baseline correction
        PreprocessingOptionInfo(
            name="Detrend",
            display_name="Detrend",
            category="Baseline",
            description="Remove linear or polynomial trend",
        ),
        PreprocessingOptionInfo(
            name="AirPLS",
            display_name="AirPLS Baseline",
            category="Baseline",
            description="Adaptive iteratively reweighted penalized least squares",
        ),
        PreprocessingOptionInfo(
            name="ArPLS",
            display_name="ArPLS Baseline",
            category="Baseline",
            description="Asymmetrically reweighted penalized least squares",
        ),
        # Normalization
        PreprocessingOptionInfo(
            name="AreaNorm",
            display_name="Area Normalization",
            category="Normalization",
            description="Normalize by total spectral area",
        ),
        PreprocessingOptionInfo(
            name="L2Norm",
            display_name="L2 Normalization",
            category="Normalization",
            description="Unit vector normalization",
        ),
    ]

    return options


# ============= Helper Functions =============


def _load_dataset_data(dataset_id: str) -> tuple:
    """Load dataset and return (dataset, X, wavelengths)."""
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


def _generate_preprocessing_pipelines(config: PreprocessingConfig) -> Dict[str, callable]:
    """Generate preprocessing functions based on configuration."""
    from sklearn.preprocessing import MinMaxScaler, StandardScaler

    # Import nirs4all operators
    try:
        from nirs4all.operators.transforms.scalers import StandardNormalVariate
        from nirs4all.operators.transforms.nirs import (
            MultiplicativeScatterCorrection,
            SavitzkyGolay,
            FirstDerivative,
            SecondDerivative,
            AreaNormalization,
        )
        from nirs4all.operators.transforms.signal import Detrend

        NIRS4ALL_OPS = True
    except ImportError:
        NIRS4ALL_OPS = False

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
            pp_func = _build_preprocessing_function(pp_name, NIRS4ALL_OPS)
            if pp_func:
                pipelines[pp_name] = pp_func
        except Exception as e:
            print(f"Warning: Could not build preprocessing '{pp_name}': {e}")

    return pipelines


def _build_preprocessing_function(name: str, use_nirs4all: bool = True) -> callable:
    """Build a preprocessing function from a name."""
    from sklearn.preprocessing import MinMaxScaler, StandardScaler, Normalizer

    if use_nirs4all:
        try:
            from nirs4all.operators.transforms.scalers import StandardNormalVariate
            from nirs4all.operators.transforms.nirs import (
                MultiplicativeScatterCorrection,
                SavitzkyGolay,
                FirstDerivative,
                SecondDerivative,
                AreaNormalization,
            )
            from nirs4all.operators.transforms.signal import Detrend
        except ImportError:
            use_nirs4all = False

    # Define preprocessing mapping
    if name == "SNV":
        if use_nirs4all:
            return lambda X: StandardNormalVariate().fit_transform(X)
        else:
            # Fallback: row-wise standardization
            return lambda X: (X - X.mean(axis=1, keepdims=True)) / (X.std(axis=1, keepdims=True) + 1e-10)

    elif name == "MSC":
        if use_nirs4all:
            return lambda X: MultiplicativeScatterCorrection().fit_transform(X)
        else:
            return lambda X: X  # Fallback: no-op

    elif name in ("SG", "SG_smooth"):
        if use_nirs4all:
            return lambda X: SavitzkyGolay(window_length=11, polyorder=2, deriv=0).fit_transform(X)
        else:
            return lambda X: X

    elif name in ("FirstDeriv", "FirstDerivative"):
        if use_nirs4all:
            return lambda X: FirstDerivative().fit_transform(X)
        else:
            return lambda X: np.diff(X, axis=1)

    elif name in ("SecondDeriv", "SecondDerivative"):
        if use_nirs4all:
            return lambda X: SecondDerivative().fit_transform(X)
        else:
            return lambda X: np.diff(X, n=2, axis=1)

    elif name == "Detrend":
        if use_nirs4all:
            return lambda X: Detrend().fit_transform(X)
        else:
            return lambda X: X

    elif name == "MinMaxScaler":
        return lambda X: MinMaxScaler().fit_transform(X)

    elif name == "StandardScaler":
        return lambda X: StandardScaler().fit_transform(X)

    elif name in ("AreaNorm", "AreaNormalization"):
        if use_nirs4all:
            return lambda X: AreaNormalization().fit_transform(X)
        else:
            return lambda X: X / (np.abs(X).sum(axis=1, keepdims=True) + 1e-10)

    elif name == "L2Norm":
        return lambda X: Normalizer(norm="l2").fit_transform(X)

    elif name == "SNV+SG":
        if use_nirs4all:
            snv = StandardNormalVariate()
            sg = SavitzkyGolay(window_length=11, polyorder=2, deriv=0)
            return lambda X: sg.fit_transform(snv.fit_transform(X))
        else:
            return lambda X: X

    elif name == "MSC+SG":
        if use_nirs4all:
            msc = MultiplicativeScatterCorrection()
            sg = SavitzkyGolay(window_length=11, polyorder=2, deriv=0)
            return lambda X: sg.fit_transform(msc.fit_transform(X))
        else:
            return lambda X: X

    elif name == "Detrend+SNV":
        if use_nirs4all:
            det = Detrend()
            snv = StandardNormalVariate()
            return lambda X: snv.fit_transform(det.fit_transform(X))
        else:
            return lambda X: X

    else:
        # Unknown preprocessing - return identity
        print(f"Warning: Unknown preprocessing '{name}', using identity")
        return lambda X: X


def _extract_distance_matrices(evaluator: PreprocPCAEvaluator) -> Dict[str, List[DatasetPairDistance]]:
    """Extract distance matrices from evaluator results."""
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


def _extract_preprocessing_ranking(evaluator: PreprocPCAEvaluator) -> Dict[str, List[PreprocessingRankingItem]]:
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
    evaluator: PreprocPCAEvaluator, raw_data: Dict[str, np.ndarray]
) -> Dict[str, List[PCACoordinate]]:
    """Extract PCA coordinates for visualization."""
    result = {}

    # Raw PCA coordinates
    raw_coords = []
    for dataset_name in raw_data.keys():
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
    preprocs = set(pp for (ds, pp) in evaluator.pp_pcas_.keys())

    for pp_name in preprocs:
        pp_coords = []
        for dataset_name in raw_data.keys():
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


def _extract_metric_convergence(evaluator: PreprocPCAEvaluator) -> List[MetricConvergenceItem]:
    """Extract metric convergence data from evaluator."""
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
        print(f"Warning: Could not extract metric convergence: {e}")

    return result


def _find_best_preprocessing(ranking: Dict[str, List[PreprocessingRankingItem]]) -> tuple:
    """Find the best preprocessing based on centroid distance reduction."""
    if "centroid" not in ranking or not ranking["centroid"]:
        return "None", 0.0

    best = ranking["centroid"][0]
    return best.preproc, best.reduction_pct
