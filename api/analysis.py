"""
Analysis API routes for nirs4all webapp.

This module provides FastAPI routes for dimensionality reduction and feature analysis,
including PCA, t-SNE, UMAP, feature importance, and correlation analysis.

Dimensionality Reduction:
- PCA with scores, loadings, and explained variance
- t-SNE embedding computation
- UMAP dimensionality reduction

Feature Analysis:
- Feature importance (delegates to nirs4all.explain() for SHAP, sklearn for permutation)
- Feature selection (variance, mutual_info, f_score)
- Correlation matrix computation
- Important wavelengths extraction

Note: For NIRS-specific feature selection (CARS, MCUVE), use those operators
directly via nirs4all pipelines.
"""

from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from .workspace_manager import workspace_manager

import importlib.util

from .lazy_imports import get_cached, is_ml_ready
SKLEARN_AVAILABLE = True

# Check umap availability without importing it (import takes 6+ seconds)
UMAP_AVAILABLE = importlib.util.find_spec("umap") is not None


def _get_umap():
    """Lazy-load umap (6+ second import) — only when actually used."""
    try:
        import umap
        return umap
    except ImportError:
        return None


router = APIRouter()


# ============= Request/Response Models =============


class PCARequest(BaseModel):
    """Request model for PCA computation."""

    dataset_id: str = Field(..., description="ID of the dataset to analyze")
    n_components: int = Field(10, ge=1, le=100, description="Number of PCA components")
    partition: str = Field("train", description="Dataset partition to use")
    preprocessing_chain: list[dict[str, Any]] = Field(
        default=[], description="Preprocessing steps to apply"
    )
    center: bool = Field(True, description="Center data before PCA")
    scale: bool = Field(False, description="Scale data before PCA")


class PCAResult(BaseModel):
    """Result of PCA computation."""

    dataset_id: str
    n_components: int
    n_samples: int
    n_features: int
    scores: list[list[float]]  # (n_samples, n_components)
    loadings: list[list[float]]  # (n_components, n_features)
    explained_variance: list[float]  # (n_components,)
    explained_variance_ratio: list[float]  # (n_components,)
    cumulative_variance_ratio: list[float]  # (n_components,)
    wavelengths: list[float] | None = None
    mean: list[float] | None = None


class TSNERequest(BaseModel):
    """Request model for t-SNE computation."""

    dataset_id: str = Field(..., description="ID of the dataset to analyze")
    n_components: int = Field(2, ge=2, le=3, description="Number of t-SNE components")
    perplexity: float = Field(30.0, ge=5.0, le=100.0, description="Perplexity parameter")
    learning_rate: float = Field(200.0, ge=10.0, le=1000.0, description="Learning rate")
    n_iter: int = Field(1000, ge=250, le=5000, description="Number of iterations")
    partition: str = Field("train", description="Dataset partition to use")
    preprocessing_chain: list[dict[str, Any]] = Field(default=[])
    random_state: int | None = Field(42, description="Random seed")
    init: str = Field("pca", description="Initialization method: random, pca")


class TSNEResult(BaseModel):
    """Result of t-SNE computation."""

    dataset_id: str
    n_components: int
    n_samples: int
    embedding: list[list[float]]  # (n_samples, n_components)
    kl_divergence: float | None = None
    n_iter: int


class UMAPRequest(BaseModel):
    """Request model for UMAP computation."""

    dataset_id: str = Field(..., description="ID of the dataset to analyze")
    n_components: int = Field(2, ge=2, le=10, description="Number of UMAP components")
    n_neighbors: int = Field(15, ge=2, le=200, description="Number of neighbors")
    min_dist: float = Field(0.1, ge=0.0, le=1.0, description="Minimum distance")
    metric: str = Field("euclidean", description="Distance metric")
    partition: str = Field("train", description="Dataset partition to use")
    preprocessing_chain: list[dict[str, Any]] = Field(default=[])
    random_state: int | None = Field(42, description="Random seed")


class UMAPResult(BaseModel):
    """Result of UMAP computation."""

    dataset_id: str
    n_components: int
    n_samples: int
    embedding: list[list[float]]  # (n_samples, n_components)


class ImportanceRequest(BaseModel):
    """Request model for feature importance computation."""

    model_id: str = Field(..., description="ID of the trained model (without extension)")
    dataset_id: str = Field(..., description="ID of the dataset for evaluation")
    method: str = Field(
        "permutation", description="Importance method: shap, permutation, model"
    )
    partition: str = Field("test", description="Dataset partition to use")
    n_repeats: int = Field(10, ge=1, le=100, description="Number of repeats for permutation method")
    preprocessing_chain: list[dict[str, Any]] = Field(default=[])


class ImportanceResult(BaseModel):
    """Result of feature importance computation."""

    model_id: str
    dataset_id: str
    method: str
    wavelengths: list[float]
    importance: list[float]  # (n_features,)
    importance_std: list[float] | None = None  # (n_features,) for permutation
    top_wavelengths: list[dict[str, Any]]  # Top k most important features


class CorrelationRequest(BaseModel):
    """Request model for correlation matrix computation."""

    dataset_id: str = Field(..., description="ID of the dataset to analyze")
    partition: str = Field("train", description="Dataset partition to use")
    method: str = Field("pearson", description="Correlation method: pearson, spearman, kendall")
    sample_features: int | None = Field(
        None, description="Sample features if too many (for performance)"
    )
    preprocessing_chain: list[dict[str, Any]] = Field(default=[])


class CorrelationResult(BaseModel):
    """Result of correlation matrix computation."""

    dataset_id: str
    method: str
    n_features: int
    wavelengths: list[float]
    correlation: list[list[float]]  # (n_features, n_features)
    sampled: bool = False


class FeatureSelectionRequest(BaseModel):
    """Request model for feature selection."""

    dataset_id: str = Field(..., description="ID of the dataset")
    method: str = Field("variance", description="Selection method: variance, mutual_info, f_score")
    k: int = Field(100, ge=1, description="Number of features to select")
    partition: str = Field("train", description="Dataset partition to use")
    preprocessing_chain: list[dict[str, Any]] = Field(default=[])


class FeatureSelectionResult(BaseModel):
    """Result of feature selection."""

    dataset_id: str
    method: str
    k: int
    selected_indices: list[int]
    selected_wavelengths: list[float]
    scores: list[float]


class WavelengthsRequest(BaseModel):
    """Request model for important wavelengths extraction."""

    importance: list[float] = Field(..., description="Feature importance values")
    wavelengths: list[float] = Field(..., description="Wavelength values")
    threshold: float = Field(0.0, ge=0.0, description="Importance threshold")
    top_k: int | None = Field(None, ge=1, description="Return top k wavelengths")


class WavelengthsResult(BaseModel):
    """Result of important wavelengths extraction."""

    wavelengths: list[float]
    importance: list[float]
    indices: list[int]
    threshold_used: float


# ============= Analysis Routes =============


@router.post("/analysis/pca", response_model=PCAResult)
async def compute_pca(request: PCARequest):
    """
    Compute Principal Component Analysis on dataset spectra.

    Returns scores (sample projections), loadings (feature contributions),
    and explained variance information.
    """
    import numpy as np
    if not SKLEARN_AVAILABLE:
        raise HTTPException(
            status_code=501, detail="sklearn not available for PCA computation"
        )

    # Load dataset
    dataset, X, wavelengths = _load_analysis_data(
        request.dataset_id, request.partition, request.preprocessing_chain
    )

    n_samples, n_features = X.shape
    n_components = min(request.n_components, n_samples, n_features)

    # Optionally center and scale
    X_processed = X.copy()
    mean = None

    if request.center:
        mean = np.mean(X_processed, axis=0)
        X_processed = X_processed - mean

    if request.scale:
        std = np.std(X_processed, axis=0)
        std[std == 0] = 1  # Avoid division by zero
        X_processed = X_processed / std

    # Compute PCA
    pca = get_cached("PCA")(n_components=n_components)
    scores = pca.fit_transform(X_processed)

    # Compute cumulative variance
    cumulative = np.cumsum(pca.explained_variance_ratio_)

    return PCAResult(
        dataset_id=request.dataset_id,
        n_components=n_components,
        n_samples=n_samples,
        n_features=n_features,
        scores=scores.tolist(),
        loadings=pca.components_.tolist(),
        explained_variance=pca.explained_variance_.tolist(),
        explained_variance_ratio=pca.explained_variance_ratio_.tolist(),
        cumulative_variance_ratio=cumulative.tolist(),
        wavelengths=wavelengths,
        mean=mean.tolist() if mean is not None else None,
    )


@router.post("/analysis/pca/loadings")
async def get_pca_loadings(
    dataset_id: str,
    n_components: int = Query(10, ge=1, le=100),
    component_index: int = Query(0, ge=0),
    partition: str = Query("train"),
):
    """
    Get PCA loadings for visualization.

    Returns loadings for a specific component with wavelength mapping.
    """
    if not SKLEARN_AVAILABLE:
        raise HTTPException(
            status_code=501, detail="sklearn not available for PCA computation"
        )

    # Load dataset
    dataset, X, wavelengths = _load_analysis_data(dataset_id, partition, [])

    n_samples, n_features = X.shape
    n_components = min(n_components, n_samples, n_features)

    if component_index >= n_components:
        raise HTTPException(
            status_code=400,
            detail=f"Component index {component_index} out of range (max: {n_components - 1})",
        )

    # Compute PCA
    pca = get_cached("PCA")(n_components=n_components)
    pca.fit(X)

    # Get loadings for requested component
    loadings = pca.components_[component_index]

    return {
        "dataset_id": dataset_id,
        "component_index": component_index,
        "n_components": n_components,
        "explained_variance_ratio": float(pca.explained_variance_ratio_[component_index]),
        "wavelengths": wavelengths,
        "loadings": loadings.tolist(),
    }


@router.post("/analysis/pca/scree")
async def get_scree_data(
    dataset_id: str,
    max_components: int = Query(20, ge=1, le=100),
    partition: str = Query("train"),
):
    """
    Get scree plot data for PCA.

    Returns explained variance for each component for scree plot visualization.
    """
    import numpy as np
    if not SKLEARN_AVAILABLE:
        raise HTTPException(
            status_code=501, detail="sklearn not available for PCA computation"
        )

    # Load dataset
    dataset, X, wavelengths = _load_analysis_data(dataset_id, partition, [])

    n_samples, n_features = X.shape
    n_components = min(max_components, n_samples, n_features)

    # Compute PCA
    pca = get_cached("PCA")(n_components=n_components)
    pca.fit(X)

    # Build scree data
    components = list(range(1, n_components + 1))
    explained_variance = pca.explained_variance_.tolist()
    explained_variance_ratio = pca.explained_variance_ratio_.tolist()
    cumulative_variance_ratio = np.cumsum(pca.explained_variance_ratio_).tolist()

    return {
        "dataset_id": dataset_id,
        "n_components": n_components,
        "components": components,
        "explained_variance": explained_variance,
        "explained_variance_ratio": explained_variance_ratio,
        "cumulative_variance_ratio": cumulative_variance_ratio,
    }


@router.post("/analysis/tsne", response_model=TSNEResult)
async def compute_tsne(request: TSNERequest):
    """
    Compute t-SNE embedding on dataset spectra.

    t-SNE is useful for visualizing high-dimensional data in 2D or 3D.
    """
    if not SKLEARN_AVAILABLE:
        raise HTTPException(
            status_code=501, detail="sklearn not available for t-SNE computation"
        )

    # Load dataset
    dataset, X, wavelengths = _load_analysis_data(
        request.dataset_id, request.partition, request.preprocessing_chain
    )

    n_samples = X.shape[0]

    # Adjust perplexity if needed
    perplexity = min(request.perplexity, (n_samples - 1) / 3)

    # Compute t-SNE
    tsne = get_cached("TSNE")(
        n_components=request.n_components,
        perplexity=perplexity,
        learning_rate=request.learning_rate,
        max_iter=request.n_iter,
        init=request.init if request.init in ("random", "pca") else "pca",
        random_state=request.random_state,
    )

    embedding = tsne.fit_transform(X)

    return TSNEResult(
        dataset_id=request.dataset_id,
        n_components=request.n_components,
        n_samples=n_samples,
        embedding=embedding.tolist(),
        kl_divergence=float(tsne.kl_divergence_) if hasattr(tsne, "kl_divergence_") else None,
        n_iter=tsne.n_iter_,
    )


@router.post("/analysis/umap", response_model=UMAPResult)
async def compute_umap_endpoint(request: UMAPRequest):
    """
    Compute UMAP embedding on dataset spectra.

    UMAP preserves both local and global structure better than t-SNE.
    """
    umap_mod = _get_umap()
    if umap_mod is None:
        raise HTTPException(
            status_code=501,
            detail="UMAP not available. Install umap-learn in Settings > Dependencies.",
        )

    import numpy as np

    # Load dataset
    dataset, X, wavelengths = _load_analysis_data(
        request.dataset_id, request.partition, request.preprocessing_chain
    )

    n_samples = X.shape[0]

    # Adjust n_neighbors if needed
    n_neighbors = min(request.n_neighbors, n_samples - 1)

    # Compute UMAP
    try:
        reducer = umap_mod.UMAP(
            n_components=request.n_components,
            n_neighbors=n_neighbors,
            min_dist=request.min_dist,
            metric=request.metric,
            random_state=request.random_state,
            n_jobs=-1,
        )
        embedding = reducer.fit_transform(X)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"UMAP computation failed: {e}")

    return UMAPResult(
        dataset_id=request.dataset_id,
        n_components=request.n_components,
        n_samples=n_samples,
        embedding=embedding.tolist(),
    )


@router.post("/analysis/importance", response_model=ImportanceResult)
async def feature_importance(request: ImportanceRequest):
    """
    Compute feature importance for a trained model.

    Supports:
    - 'shap': Uses nirs4all.explain() for SHAP-based importance (requires .n4a bundle)
    - 'permutation': sklearn permutation importance (works with any model)
    - 'model': Model's built-in feature importance (if available)
    """
    import numpy as np
    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    # Load dataset
    dataset, X, wavelengths = _load_analysis_data(
        request.dataset_id, request.partition, request.preprocessing_chain
    )

    # Get targets (needed for permutation importance)
    from contextlib import suppress

    from .spectra import _load_dataset

    ds = _load_dataset(request.dataset_id)
    selector = {"partition": request.partition}
    y = None
    with suppress(Exception):
        y = ds.y(selector)

    # Compute importance based on method
    if request.method == "shap":
        # Use nirs4all.explain() for SHAP-based importance
        import nirs4all

        # Look for .n4a bundle first
        bundle_path = Path(workspace.path) / "exports" / f"{request.model_id}.n4a"
        if not bundle_path.exists():
            # Try workspace/exports subdirectory
            bundle_path = Path(workspace.path) / "workspace" / "exports" / f"{request.model_id}.n4a"

        if not bundle_path.exists():
            raise HTTPException(
                status_code=404,
                detail=f"Model bundle '{request.model_id}.n4a' not found. SHAP method requires .n4a bundle."
            )

        try:
            explain_result = nirs4all.explain(
                model=str(bundle_path),
                data=X,
                verbose=0,
                plots_visible=False
            )
            importance = explain_result.mean_abs_shap
            importance_std = None  # SHAP doesn't provide std in the same way

        except Exception as e:
            raise HTTPException(
                status_code=500, detail=f"Error computing SHAP importance: {str(e)}"
            ) from None

    elif request.method == "permutation":
        if y is None:
            raise HTTPException(
                status_code=400, detail="Dataset has no target values for permutation importance"
            )

        # Try to load .n4a bundle first, then fall back to .joblib
        model = None
        bundle_path = Path(workspace.path) / "exports" / f"{request.model_id}.n4a"
        if not bundle_path.exists():
            bundle_path = Path(workspace.path) / "workspace" / "exports" / f"{request.model_id}.n4a"

        if bundle_path.exists():
            try:
                from nirs4all.sklearn import NIRSPipeline
                model = NIRSPipeline.from_bundle(str(bundle_path))
            except Exception:
                pass

        if model is None:
            # Fall back to .joblib
            import joblib
            model_path = Path(workspace.path) / "models" / f"{request.model_id}.joblib"
            if not model_path.exists():
                raise HTTPException(
                    status_code=404, detail=f"Model '{request.model_id}' not found"
                )
            try:
                model = joblib.load(model_path)
            except Exception as e:
                raise HTTPException(
                    status_code=500, detail=f"Error loading model: {str(e)}"
                ) from None

        from sklearn.inspection import permutation_importance

        result = permutation_importance(
            model, X, y,
            n_repeats=request.n_repeats,
            random_state=42,
            n_jobs=-1,
        )
        importance = result.importances_mean
        importance_std = result.importances_std

    elif request.method == "model":
        # Load model for built-in feature importance
        model = None
        bundle_path = Path(workspace.path) / "exports" / f"{request.model_id}.n4a"
        if not bundle_path.exists():
            bundle_path = Path(workspace.path) / "workspace" / "exports" / f"{request.model_id}.n4a"

        if bundle_path.exists():
            try:
                from nirs4all.sklearn import NIRSPipeline
                model = NIRSPipeline.from_bundle(str(bundle_path))
            except Exception:
                pass

        if model is None:
            import joblib
            model_path = Path(workspace.path) / "models" / f"{request.model_id}.joblib"
            if not model_path.exists():
                raise HTTPException(
                    status_code=404, detail=f"Model '{request.model_id}' not found"
                )
            try:
                model = joblib.load(model_path)
            except Exception as e:
                raise HTTPException(
                    status_code=500, detail=f"Error loading model: {str(e)}"
                ) from None

        # Use model's built-in feature importance if available
        if hasattr(model, "feature_importances_"):
            importance = model.feature_importances_
            importance_std = None
        elif hasattr(model, "coef_"):
            importance = np.abs(model.coef_).ravel()
            importance_std = None
        else:
            raise HTTPException(
                status_code=400,
                detail="Model does not have built-in feature importance. Use 'permutation' or 'shap' method.",
            )

    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown importance method: {request.method}. Supported: shap, permutation, model",
        )

    # Get top wavelengths
    n_features = len(importance)
    top_k = min(20, n_features)
    top_indices = np.argsort(importance)[-top_k:][::-1]

    top_wavelengths = [
        {
            "index": int(idx),
            "wavelength": wavelengths[idx] if wavelengths and idx < len(wavelengths) else idx,
            "importance": float(importance[idx]),
        }
        for idx in top_indices
    ]

    return ImportanceResult(
        model_id=request.model_id,
        dataset_id=request.dataset_id,
        method=request.method,
        wavelengths=wavelengths if wavelengths else list(range(n_features)),
        importance=importance.tolist(),
        importance_std=importance_std.tolist() if importance_std is not None else None,
        top_wavelengths=top_wavelengths,
    )


@router.post("/analysis/correlation", response_model=CorrelationResult)
async def correlation_matrix(request: CorrelationRequest):
    """
    Compute correlation matrix between wavelengths/features.

    Useful for understanding feature relationships and multicollinearity.
    """
    import numpy as np
    # Load dataset
    dataset, X, wavelengths = _load_analysis_data(
        request.dataset_id, request.partition, request.preprocessing_chain
    )

    n_features = X.shape[1]
    sampled = False

    # Sample features if too many (for performance)
    if request.sample_features and n_features > request.sample_features:
        indices = np.linspace(0, n_features - 1, request.sample_features, dtype=int)
        X = X[:, indices]
        if wavelengths:
            wavelengths = [wavelengths[i] for i in indices]
        n_features = request.sample_features
        sampled = True

    # Compute correlation
    if request.method == "pearson":
        correlation = np.corrcoef(X.T)
    elif request.method == "spearman":
        from scipy.stats import spearmanr

        correlation, _ = spearmanr(X)
    elif request.method == "kendall":
        from scipy.stats import kendalltau

        # Kendall is O(n^2) expensive, compute for small datasets only
        if n_features > 100:
            raise HTTPException(
                status_code=400,
                detail="Kendall correlation is too slow for datasets with >100 features. "
                "Use 'sample_features' parameter or choose a different method.",
            )
        correlation = np.zeros((n_features, n_features))
        for i in range(n_features):
            for j in range(i, n_features):
                tau, _ = kendalltau(X[:, i], X[:, j])
                correlation[i, j] = tau
                correlation[j, i] = tau
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown correlation method: {request.method}. "
            "Supported: pearson, spearman, kendall",
        )

    # Handle NaN values
    correlation = np.nan_to_num(correlation, nan=0.0)

    return CorrelationResult(
        dataset_id=request.dataset_id,
        method=request.method,
        n_features=n_features,
        wavelengths=wavelengths if wavelengths else list(range(n_features)),
        correlation=correlation.tolist(),
        sampled=sampled,
    )


@router.post("/analysis/select", response_model=FeatureSelectionResult)
async def select_features(request: FeatureSelectionRequest):
    """
    Select top features based on various criteria.

    Supports variance-based, mutual information, and F-score selection.

    Note: For NIRS-specific wavelength selection methods (CARS, MCUVE),
    use those operators directly in nirs4all pipelines. They provide
    chemometrics-specific selection based on PLS regression coefficients.
    """
    import numpy as np
    # Load dataset
    dataset, X, wavelengths = _load_analysis_data(
        request.dataset_id, request.partition, request.preprocessing_chain
    )

    # Get targets if needed for supervised selection
    y = None
    if request.method in ("mutual_info", "f_score"):
        from .spectra import _load_dataset

        ds = _load_dataset(request.dataset_id)
        selector = {"partition": request.partition}
        try:
            y = ds.y(selector)
        except Exception:
            pass

        if y is None:
            raise HTTPException(
                status_code=400,
                detail=f"Method '{request.method}' requires target values",
            )

    n_features = X.shape[1]
    k = min(request.k, n_features)

    if request.method == "variance":
        # Variance-based selection
        variances = np.var(X, axis=0)
        scores = variances
        top_indices = np.argsort(variances)[-k:][::-1]

    elif request.method == "mutual_info":
        from sklearn.feature_selection import mutual_info_regression

        scores = mutual_info_regression(X, y.ravel(), random_state=42)
        top_indices = np.argsort(scores)[-k:][::-1]

    elif request.method == "f_score":
        from sklearn.feature_selection import f_regression

        scores, _ = f_regression(X, y.ravel())
        scores = np.nan_to_num(scores, nan=0.0)
        top_indices = np.argsort(scores)[-k:][::-1]

    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown selection method: {request.method}. "
            "Supported: variance, mutual_info, f_score",
        )

    selected_indices = top_indices.tolist()
    selected_wavelengths = (
        [wavelengths[i] for i in selected_indices]
        if wavelengths
        else selected_indices
    )
    selected_scores = [float(scores[i]) for i in selected_indices]

    return FeatureSelectionResult(
        dataset_id=request.dataset_id,
        method=request.method,
        k=k,
        selected_indices=selected_indices,
        selected_wavelengths=selected_wavelengths,
        scores=selected_scores,
    )


@router.post("/analysis/wavelengths", response_model=WavelengthsResult)
async def important_wavelengths(request: WavelengthsRequest):
    """
    Extract important wavelengths based on feature importance values.

    Filters wavelengths by threshold or returns top-k most important.
    """
    import numpy as np
    importance = np.array(request.importance)
    wavelengths = np.array(request.wavelengths)

    if len(importance) != len(wavelengths):
        raise HTTPException(
            status_code=400,
            detail=f"Length mismatch: {len(importance)} importance values vs {len(wavelengths)} wavelengths",
        )

    # Apply threshold or top-k selection
    if request.top_k:
        k = min(request.top_k, len(importance))
        top_indices = np.argsort(importance)[-k:][::-1]
        threshold_used = float(importance[top_indices[-1]]) if k > 0 else 0.0
    else:
        mask = importance >= request.threshold
        top_indices = np.where(mask)[0]
        # Sort by importance descending
        top_indices = top_indices[np.argsort(importance[top_indices])[::-1]]
        threshold_used = request.threshold

    return WavelengthsResult(
        wavelengths=wavelengths[top_indices].tolist(),
        importance=importance[top_indices].tolist(),
        indices=top_indices.tolist(),
        threshold_used=threshold_used,
    )


@router.get("/analysis/methods")
async def list_analysis_methods():
    """
    List all available analysis methods.

    Returns information about supported dimensionality reduction,
    feature selection, and correlation methods.
    """
    methods = {
        "dimensionality_reduction": [
            {
                "name": "pca",
                "display_name": "Principal Component Analysis",
                "description": "Linear dimensionality reduction preserving variance",
                "available": SKLEARN_AVAILABLE,
            },
            {
                "name": "tsne",
                "display_name": "t-SNE",
                "description": "Non-linear embedding for visualization",
                "available": SKLEARN_AVAILABLE,
            },
            {
                "name": "umap",
                "display_name": "UMAP",
                "description": "Uniform Manifold Approximation and Projection",
                "available": UMAP_AVAILABLE,
            },
        ],
        "feature_importance": [
            {
                "name": "shap",
                "display_name": "SHAP Values",
                "description": "SHAP-based feature importance via nirs4all.explain() (requires .n4a bundle)",
                "available": True,
            },
            {
                "name": "permutation",
                "display_name": "Permutation Importance",
                "description": "Model-agnostic feature importance via permutation",
                "available": SKLEARN_AVAILABLE,
            },
            {
                "name": "model",
                "display_name": "Model-based Importance",
                "description": "Use model's built-in feature importance (if available)",
                "available": True,
            },
        ],
        "feature_selection": [
            {
                "name": "variance",
                "display_name": "Variance Threshold",
                "description": "Select features with highest variance",
                "available": True,
            },
            {
                "name": "mutual_info",
                "display_name": "Mutual Information",
                "description": "Select features with highest mutual information with target",
                "available": SKLEARN_AVAILABLE,
            },
            {
                "name": "f_score",
                "display_name": "F-Score",
                "description": "Select features with highest F-score (ANOVA)",
                "available": SKLEARN_AVAILABLE,
            },
        ],
        "correlation": [
            {
                "name": "pearson",
                "display_name": "Pearson Correlation",
                "description": "Linear correlation coefficient",
                "available": True,
            },
            {
                "name": "spearman",
                "display_name": "Spearman Correlation",
                "description": "Rank-based correlation",
                "available": True,
            },
            {
                "name": "kendall",
                "display_name": "Kendall Correlation",
                "description": "Kendall tau correlation (slow for large datasets)",
                "available": True,
            },
        ],
    }

    return {"methods": methods}


# ============= Helper Functions =============


def _load_analysis_data(
    dataset_id: str,
    partition: str,
    preprocessing_chain: list[dict[str, Any]],
) -> tuple:
    """Load dataset and prepare data for analysis.

    Args:
        dataset_id: Dataset ID
        partition: Dataset partition
        preprocessing_chain: Preprocessing steps to apply

    Returns:
        Tuple of (dataset, X, wavelengths)
    """
    from .spectra import _apply_preprocessing_chain, _load_dataset

    dataset = _load_dataset(dataset_id)
    if not dataset:
        raise HTTPException(
            status_code=404, detail=f"Dataset '{dataset_id}' not found"
        )

    # Get spectral data
    selector = {"partition": partition}
    X = dataset.x(selector, layout="2d")

    # Handle multi-source datasets
    if isinstance(X, list):
        X = X[0]

    # Get wavelengths
    wavelengths = None
    try:
        headers = dataset.headers(0)
        wavelengths = [float(h) for h in headers] if headers else None
    except Exception:
        pass

    if wavelengths is None:
        wavelengths = list(range(X.shape[1]))

    # Apply preprocessing
    if preprocessing_chain:
        X = _apply_preprocessing_chain(X, preprocessing_chain)

    return dataset, X, wavelengths
