"""
Filter operators for playground sample selection.

This module provides filter operators that can remove samples based on
various criteria such as outlier detection, range filtering, and metadata matching.

Filters are applied AFTER preprocessing (so outliers are detected on transformed data)
and BEFORE splitters (so folds are created on filtered data).

Phase 1 Implementation - Foundation & Selection System
"""

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Union
import numpy as np

try:
    from sklearn.neighbors import LocalOutlierFactor
    from sklearn.decomposition import PCA
    from sklearn.covariance import EllipticEnvelope

    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False


class BaseFilter(ABC):
    """Base class for all filter operators.

    Filters work differently from transformers:
    - They don't transform X, they select which samples to keep
    - fit_predict returns a boolean mask (True = keep, False = remove)
    - They can use X, y, and metadata for filtering decisions
    """

    @abstractmethod
    def fit_predict(
        self,
        X: np.ndarray,
        y: Optional[np.ndarray] = None,
        metadata: Optional[Dict[str, np.ndarray]] = None,
    ) -> np.ndarray:
        """Fit the filter and return a boolean mask.

        Args:
            X: Feature matrix (n_samples, n_features)
            y: Target values (n_samples,) - optional
            metadata: Dict of metadata arrays - optional

        Returns:
            Boolean mask array where True = keep sample
        """
        pass

    def get_removal_reason(self) -> str:
        """Return human-readable reason for removal."""
        return "Filtered out"


class OutlierFilter(BaseFilter):
    """Filter samples based on outlier detection in PCA space.

    Uses Hotelling's T² statistic and Q-residual (SPE) for outlier detection.
    Can also use Local Outlier Factor (LOF) for density-based detection.

    Parameters:
        method: Detection method - 'hotelling', 'q_residual', 'lof', or 'elliptic'
        threshold: Outlier threshold (interpretation depends on method)
        n_components: Number of PCA components to use (for hotelling/q_residual)
        contamination: Expected fraction of outliers (for lof/elliptic)
    """

    def __init__(
        self,
        method: str = "hotelling",
        threshold: float = 0.95,
        n_components: int = 3,
        contamination: float = 0.1,
    ):
        self.method = method
        self.threshold = threshold
        self.n_components = n_components
        self.contamination = contamination
        self._removal_reason = "Outlier detected"

    def fit_predict(
        self,
        X: np.ndarray,
        y: Optional[np.ndarray] = None,
        metadata: Optional[Dict[str, np.ndarray]] = None,
    ) -> np.ndarray:
        if not SKLEARN_AVAILABLE:
            raise ImportError("sklearn is required for OutlierFilter")

        n_samples, n_features = X.shape

        if self.method == "hotelling":
            return self._hotelling_filter(X)
        elif self.method == "q_residual":
            return self._q_residual_filter(X)
        elif self.method == "lof":
            return self._lof_filter(X)
        elif self.method == "elliptic":
            return self._elliptic_filter(X)
        else:
            raise ValueError(f"Unknown outlier method: {self.method}")

    def _hotelling_filter(self, X: np.ndarray) -> np.ndarray:
        """Filter using Hotelling's T² statistic."""
        n_samples = X.shape[0]
        n_components = min(self.n_components, X.shape[1], n_samples - 1)

        pca = PCA(n_components=n_components)
        scores = pca.fit_transform(X)

        # Compute T² statistic
        t2 = np.sum((scores / np.sqrt(pca.explained_variance_)) ** 2, axis=1)

        # Threshold based on chi-square distribution
        from scipy import stats

        threshold = stats.chi2.ppf(self.threshold, n_components)

        mask = t2 <= threshold
        self._removal_reason = f"Hotelling T² > {threshold:.2f}"
        return mask

    def _q_residual_filter(self, X: np.ndarray) -> np.ndarray:
        """Filter using Q-residual (SPE) statistic."""
        n_samples = X.shape[0]
        n_components = min(self.n_components, X.shape[1], n_samples - 1)

        pca = PCA(n_components=n_components)
        scores = pca.fit_transform(X)

        # Reconstruct X
        X_reconstructed = pca.inverse_transform(scores)

        # Compute Q-residual
        residuals = X - X_reconstructed
        q = np.sum(residuals**2, axis=1)

        # Use percentile-based threshold
        threshold = np.percentile(q, self.threshold * 100)

        mask = q <= threshold
        self._removal_reason = f"Q-residual > {threshold:.4f}"
        return mask

    def _lof_filter(self, X: np.ndarray) -> np.ndarray:
        """Filter using Local Outlier Factor."""
        lof = LocalOutlierFactor(
            n_neighbors=min(20, X.shape[0] - 1), contamination=self.contamination
        )
        predictions = lof.fit_predict(X)

        mask = predictions == 1  # 1 = inlier, -1 = outlier
        self._removal_reason = f"LOF outlier (contamination={self.contamination})"
        return mask

    def _elliptic_filter(self, X: np.ndarray) -> np.ndarray:
        """Filter using Elliptic Envelope (robust covariance)."""
        # Reduce dimensionality if needed for stable covariance estimation
        if X.shape[1] > X.shape[0]:
            pca = PCA(n_components=min(self.n_components, X.shape[0] - 1))
            X_reduced = pca.fit_transform(X)
        else:
            X_reduced = X

        envelope = EllipticEnvelope(contamination=self.contamination)
        predictions = envelope.fit_predict(X_reduced)

        mask = predictions == 1
        self._removal_reason = f"Elliptic envelope outlier"
        return mask

    def get_removal_reason(self) -> str:
        return self._removal_reason


class RangeFilter(BaseFilter):
    """Filter samples based on target value range.

    Parameters:
        min_value: Minimum Y value (inclusive)
        max_value: Maximum Y value (inclusive)
        quantile_mode: If True, min/max are interpreted as percentiles (0-100)
    """

    def __init__(
        self,
        min_value: Optional[float] = None,
        max_value: Optional[float] = None,
        quantile_mode: bool = False,
    ):
        self.min_value = min_value
        self.max_value = max_value
        self.quantile_mode = quantile_mode
        self._actual_min = min_value
        self._actual_max = max_value

    def fit_predict(
        self,
        X: np.ndarray,
        y: Optional[np.ndarray] = None,
        metadata: Optional[Dict[str, np.ndarray]] = None,
    ) -> np.ndarray:
        n_samples = X.shape[0]

        if y is None:
            # No filtering if no Y values
            return np.ones(n_samples, dtype=bool)

        # Compute actual thresholds
        if self.quantile_mode:
            self._actual_min = (
                np.percentile(y, self.min_value) if self.min_value is not None else None
            )
            self._actual_max = (
                np.percentile(y, self.max_value) if self.max_value is not None else None
            )
        else:
            self._actual_min = self.min_value
            self._actual_max = self.max_value

        mask = np.ones(n_samples, dtype=bool)

        if self._actual_min is not None:
            mask &= y >= self._actual_min

        if self._actual_max is not None:
            mask &= y <= self._actual_max

        return mask

    def get_removal_reason(self) -> str:
        parts = []
        if self._actual_min is not None:
            parts.append(f"Y < {self._actual_min:.4f}")
        if self._actual_max is not None:
            parts.append(f"Y > {self._actual_max:.4f}")
        return " or ".join(parts) if parts else "Range filter"


class MetadataFilter(BaseFilter):
    """Filter samples based on metadata column values.

    Parameters:
        column: Metadata column name to filter on
        include: List of values to include (keep samples with these values)
        exclude: List of values to exclude (remove samples with these values)
        regex: Regular expression pattern for string matching
    """

    def __init__(
        self,
        column: str,
        include: Optional[List[Any]] = None,
        exclude: Optional[List[Any]] = None,
        regex: Optional[str] = None,
    ):
        self.column = column
        self.include = include
        self.exclude = exclude
        self.regex = regex
        self._removal_reason = f"Metadata filter on {column}"

    def fit_predict(
        self,
        X: np.ndarray,
        y: Optional[np.ndarray] = None,
        metadata: Optional[Dict[str, np.ndarray]] = None,
    ) -> np.ndarray:
        n_samples = X.shape[0]

        if metadata is None or self.column not in metadata:
            # No filtering if column not found
            return np.ones(n_samples, dtype=bool)

        values = metadata[self.column]
        mask = np.ones(n_samples, dtype=bool)

        if self.include is not None:
            include_set = set(self.include)
            mask &= np.array([v in include_set for v in values])

        if self.exclude is not None:
            exclude_set = set(self.exclude)
            mask &= np.array([v not in exclude_set for v in values])

        if self.regex is not None:
            import re

            pattern = re.compile(self.regex)
            mask &= np.array([bool(pattern.search(str(v))) for v in values])

        return mask

    def get_removal_reason(self) -> str:
        return self._removal_reason


class QCFilter(BaseFilter):
    """Filter samples based on quality control status.

    Checks for data quality issues like NaN values, infinite values,
    saturation, and zero values.

    Parameters:
        max_nan_ratio: Maximum ratio of NaN values per sample (0-1)
        max_inf_ratio: Maximum ratio of infinite values per sample (0-1)
        max_saturation_ratio: Maximum ratio of saturated values (0-1)
        saturation_threshold: Value threshold for saturation detection
        require_y: If True, remove samples with missing Y values
    """

    def __init__(
        self,
        max_nan_ratio: float = 0.0,
        max_inf_ratio: float = 0.0,
        max_saturation_ratio: float = 0.1,
        saturation_threshold: Optional[float] = None,
        require_y: bool = True,
    ):
        self.max_nan_ratio = max_nan_ratio
        self.max_inf_ratio = max_inf_ratio
        self.max_saturation_ratio = max_saturation_ratio
        self.saturation_threshold = saturation_threshold
        self.require_y = require_y
        self._removal_reasons: List[str] = []

    def fit_predict(
        self,
        X: np.ndarray,
        y: Optional[np.ndarray] = None,
        metadata: Optional[Dict[str, np.ndarray]] = None,
    ) -> np.ndarray:
        n_samples, n_features = X.shape
        self._removal_reasons = []

        mask = np.ones(n_samples, dtype=bool)

        # Check for NaN values
        nan_ratio = np.sum(np.isnan(X), axis=1) / n_features
        nan_mask = nan_ratio <= self.max_nan_ratio
        if not nan_mask.all():
            self._removal_reasons.append("NaN values")
        mask &= nan_mask

        # Check for infinite values
        inf_ratio = np.sum(np.isinf(X), axis=1) / n_features
        inf_mask = inf_ratio <= self.max_inf_ratio
        if not inf_mask.all():
            self._removal_reasons.append("Inf values")
        mask &= inf_mask

        # Check for saturation
        if self.saturation_threshold is not None:
            sat_ratio = np.sum(X >= self.saturation_threshold, axis=1) / n_features
            sat_mask = sat_ratio <= self.max_saturation_ratio
            if not sat_mask.all():
                self._removal_reasons.append("Saturation")
            mask &= sat_mask

        # Check for missing Y
        if self.require_y and y is not None:
            y_mask = ~np.isnan(y)
            if not y_mask.all():
                self._removal_reasons.append("Missing Y")
            mask &= y_mask

        return mask

    def get_removal_reason(self) -> str:
        if self._removal_reasons:
            return ", ".join(self._removal_reasons)
        return "QC filter"


class DistanceFilter(BaseFilter):
    """Filter samples based on distance to centroid or reference sample.

    Parameters:
        threshold: Distance threshold (samples beyond this are removed)
        quantile: If set, use this percentile of distances as threshold
        metric: Distance metric ('euclidean', 'mahalanobis', 'cosine')
        reference: 'centroid' (mean) or sample index
    """

    def __init__(
        self,
        threshold: Optional[float] = None,
        quantile: Optional[float] = 0.95,
        metric: str = "euclidean",
        reference: Union[str, int] = "centroid",
    ):
        self.threshold = threshold
        self.quantile = quantile
        self.metric = metric
        self.reference = reference
        self._actual_threshold = threshold

    def fit_predict(
        self,
        X: np.ndarray,
        y: Optional[np.ndarray] = None,
        metadata: Optional[Dict[str, np.ndarray]] = None,
    ) -> np.ndarray:
        n_samples = X.shape[0]

        # Compute reference point
        if self.reference == "centroid":
            ref = np.mean(X, axis=0)
        elif isinstance(self.reference, int):
            ref = X[self.reference]
        else:
            ref = np.mean(X, axis=0)

        # Compute distances
        if self.metric == "euclidean":
            distances = np.sqrt(np.sum((X - ref) ** 2, axis=1))
        elif self.metric == "cosine":
            norms = np.linalg.norm(X, axis=1) * np.linalg.norm(ref)
            norms[norms == 0] = 1  # Avoid division by zero
            distances = 1 - np.dot(X, ref) / norms
        elif self.metric == "mahalanobis":
            # Use pseudo-inverse for stability
            try:
                cov = np.cov(X.T)
                cov_inv = np.linalg.pinv(cov)
                diff = X - ref
                distances = np.sqrt(np.sum(diff @ cov_inv * diff, axis=1))
            except Exception:
                # Fallback to euclidean
                distances = np.sqrt(np.sum((X - ref) ** 2, axis=1))
        else:
            distances = np.sqrt(np.sum((X - ref) ** 2, axis=1))

        # Determine threshold
        if self.threshold is not None:
            self._actual_threshold = self.threshold
        elif self.quantile is not None:
            self._actual_threshold = np.percentile(distances, self.quantile * 100)
        else:
            self._actual_threshold = np.max(distances)

        mask = distances <= self._actual_threshold
        return mask

    def get_removal_reason(self) -> str:
        return f"Distance > {self._actual_threshold:.4f} ({self.metric})"


class SampleIndexFilter(BaseFilter):
    """Filter samples based on explicit sample indices.

    This filter is used by the "Filter to Selection" feature in the UI,
    allowing users to keep only manually selected samples.

    Parameters:
        indices: List of sample indices to keep or remove
        mode: 'keep' to keep only these indices, 'remove' to remove them
    """

    def __init__(
        self,
        indices: List[int],
        mode: str = "keep",
    ):
        self.indices = set(indices) if indices else set()
        self.mode = mode
        self._n_filtered = 0

    def fit_predict(
        self,
        X: np.ndarray,
        y: Optional[np.ndarray] = None,
        metadata: Optional[Dict[str, np.ndarray]] = None,
    ) -> np.ndarray:
        n_samples = X.shape[0]

        if self.mode == "keep":
            # Keep only the specified indices
            mask = np.array([i in self.indices for i in range(n_samples)], dtype=bool)
        else:
            # Remove the specified indices
            mask = np.array([i not in self.indices for i in range(n_samples)], dtype=bool)

        self._n_filtered = np.sum(~mask)
        return mask

    def get_removal_reason(self) -> str:
        if self.mode == "keep":
            return f"Sample index not in selection ({len(self.indices)} kept)"
        return f"Sample index in exclusion list ({len(self.indices)} removed)"


# Registry of available filters
FILTER_REGISTRY: Dict[str, type] = {
    "OutlierFilter": OutlierFilter,
    "RangeFilter": RangeFilter,
    "MetadataFilter": MetadataFilter,
    "QCFilter": QCFilter,
    "DistanceFilter": DistanceFilter,
    "SampleIndexFilter": SampleIndexFilter,
}


def get_filter_methods() -> List[Dict[str, Any]]:
    """Get list of available filter methods with metadata.

    Returns:
        List of method info dicts with name, display_name, category, params
    """
    methods = []

    filter_info = [
        {
            "name": "OutlierFilter",
            "display_name": "Outlier Filter",
            "description": "Remove outliers using statistical methods (T², Q-residual, LOF)",
            "category": "outlier",
            "params": {
                "method": {
                    "required": False,
                    "default": "hotelling",
                    "type": "string",
                    "options": ["hotelling", "q_residual", "lof", "elliptic"],
                },
                "threshold": {
                    "required": False,
                    "default": 0.95,
                    "type": "float",
                },
                "n_components": {
                    "required": False,
                    "default": 3,
                    "type": "int",
                },
                "contamination": {
                    "required": False,
                    "default": 0.1,
                    "type": "float",
                },
            },
        },
        {
            "name": "RangeFilter",
            "display_name": "Range Filter",
            "description": "Filter samples by target value range",
            "category": "range",
            "params": {
                "min_value": {
                    "required": False,
                    "default": None,
                    "type": "float",
                },
                "max_value": {
                    "required": False,
                    "default": None,
                    "type": "float",
                },
                "quantile_mode": {
                    "required": False,
                    "default": False,
                    "type": "bool",
                },
            },
        },
        {
            "name": "MetadataFilter",
            "display_name": "Metadata Filter",
            "description": "Filter samples by metadata column values",
            "category": "metadata",
            "params": {
                "column": {
                    "required": True,
                    "type": "string",
                },
                "include": {
                    "required": False,
                    "default": None,
                    "type": "list",
                },
                "exclude": {
                    "required": False,
                    "default": None,
                    "type": "list",
                },
                "regex": {
                    "required": False,
                    "default": None,
                    "type": "string",
                },
            },
        },
        {
            "name": "QCFilter",
            "display_name": "QC Filter",
            "description": "Filter samples by quality control criteria (NaN, saturation, etc.)",
            "category": "quality",
            "params": {
                "max_nan_ratio": {
                    "required": False,
                    "default": 0.0,
                    "type": "float",
                },
                "max_inf_ratio": {
                    "required": False,
                    "default": 0.0,
                    "type": "float",
                },
                "max_saturation_ratio": {
                    "required": False,
                    "default": 0.1,
                    "type": "float",
                },
                "saturation_threshold": {
                    "required": False,
                    "default": None,
                    "type": "float",
                },
                "require_y": {
                    "required": False,
                    "default": True,
                    "type": "bool",
                },
            },
        },
        {
            "name": "DistanceFilter",
            "display_name": "Distance Filter",
            "description": "Filter samples by distance to centroid or reference",
            "category": "distance",
            "params": {
                "threshold": {
                    "required": False,
                    "default": None,
                    "type": "float",
                },
                "quantile": {
                    "required": False,
                    "default": 0.95,
                    "type": "float",
                },
                "metric": {
                    "required": False,
                    "default": "euclidean",
                    "type": "string",
                    "options": ["euclidean", "mahalanobis", "cosine"],
                },
                "reference": {
                    "required": False,
                    "default": "centroid",
                    "type": "string",
                },
            },
        },
        {
            "name": "SampleIndexFilter",
            "display_name": "Sample Index Filter",
            "description": "Keep or remove samples by explicit index (used by 'Filter to Selection')",
            "category": "selection",
            "params": {
                "indices": {
                    "required": True,
                    "type": "list",
                    "description": "List of sample indices",
                },
                "mode": {
                    "required": False,
                    "default": "keep",
                    "type": "string",
                    "options": ["keep", "remove"],
                },
            },
        },
    ]

    for info in filter_info:
        methods.append({
            "name": info["name"],
            "display_name": info["display_name"],
            "description": info["description"],
            "category": info["category"],
            "params": info["params"],
            "type": "filter",
            "source": "nirs4all_webapp",
        })

    return methods


def instantiate_filter(name: str, params: Dict[str, Any]) -> Optional[BaseFilter]:
    """Create a filter instance from name and parameters.

    Args:
        name: Filter class name
        params: Parameters to pass to constructor

    Returns:
        Instantiated filter, or None if not found
    """
    filter_cls = FILTER_REGISTRY.get(name)
    if filter_cls is None:
        return None

    try:
        return filter_cls(**params)
    except TypeError as e:
        # Try without invalid params
        valid_params = {}
        import inspect

        sig = inspect.signature(filter_cls.__init__)
        param_names = set(sig.parameters.keys()) - {"self"}

        for k, v in params.items():
            if k in param_names:
                valid_params[k] = v

        return filter_cls(**valid_params)
