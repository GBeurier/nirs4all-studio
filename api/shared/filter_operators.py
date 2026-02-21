"""
Filter operators for playground sample selection.

This module provides filter operators that can remove samples based on
various criteria. It delegates to nirs4all.operators.filters for the
actual filter implementations.

The only webapp-specific filter is SampleIndexFilter, which is used for
the "Filter to Selection" feature in the UI.

Phase 1 Implementation - Foundation & Selection System
"""

from typing import Any, Dict, List, Optional, Union

import numpy as np

# Import nirs4all filters
try:
    from nirs4all.operators.filters import (
        HighLeverageFilter,
        SampleFilter,
        SpectralQualityFilter,
        XOutlierFilter,
        YOutlierFilter,
    )
    from nirs4all.operators.filters import (
        MetadataFilter as N4AMetadataFilter,
    )
    NIRS4ALL_FILTERS_AVAILABLE = True
except ImportError:
    NIRS4ALL_FILTERS_AVAILABLE = False
    SampleFilter = None
    XOutlierFilter = None
    YOutlierFilter = None
    SpectralQualityFilter = None
    HighLeverageFilter = None
    N4AMetadataFilter = None


class SampleIndexFilter:
    """Filter samples based on explicit sample indices.

    This filter is used by the "Filter to Selection" feature in the UI,
    allowing users to keep only manually selected samples.

    This is webapp-specific and not part of nirs4all since it operates
    on explicit UI selections rather than data-driven criteria.

    Parameters:
        indices: List of sample indices to keep or remove
        mode: 'keep' to keep only these indices, 'remove' to remove them
    """

    def __init__(
        self,
        indices: list[int],
        mode: str = "keep",
    ):
        self.indices = set(indices) if indices else set()
        self.mode = mode
        self._n_filtered = 0

    def fit_predict(
        self,
        X: np.ndarray,
        y: np.ndarray | None = None,
        metadata: dict[str, np.ndarray] | None = None,
    ) -> np.ndarray:
        """Fit the filter and return a boolean mask.

        Args:
            X: Feature matrix (n_samples, n_features)
            y: Target values (n_samples,) - optional
            metadata: Dict of metadata arrays - optional

        Returns:
            Boolean mask array where True = keep sample
        """
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
        """Return human-readable reason for removal."""
        if self.mode == "keep":
            return f"Sample index not in selection ({len(self.indices)} kept)"
        return f"Sample index in exclusion list ({len(self.indices)} removed)"


class _Nirs4AllFilterAdapter:
    """Adapter to make nirs4all filters work with the webapp's fit_predict API.

    nirs4all filters use fit() + get_mask() while the webapp expects fit_predict().
    This adapter bridges that gap.
    """

    def __init__(self, filter_instance: "SampleFilter"):
        self._filter = filter_instance
        self._removal_reason = filter_instance.exclusion_reason

    def fit_predict(
        self,
        X: np.ndarray,
        y: np.ndarray | None = None,
        metadata: dict[str, np.ndarray] | None = None,
    ) -> np.ndarray:
        """Fit the filter and return a boolean mask.

        Args:
            X: Feature matrix (n_samples, n_features)
            y: Target values (n_samples,) - optional
            metadata: Dict of metadata arrays - optional

        Returns:
            Boolean mask array where True = keep sample
        """
        self._filter.fit(X, y)

        # Handle MetadataFilter specially since it needs metadata passed to get_mask
        if hasattr(self._filter, 'get_mask'):
            import inspect
            sig = inspect.signature(self._filter.get_mask)
            if 'metadata' in sig.parameters:
                return self._filter.get_mask(X, y, metadata=metadata)
            return self._filter.get_mask(X, y)

        return np.ones(X.shape[0], dtype=bool)

    def get_removal_reason(self) -> str:
        """Return human-readable reason for removal."""
        return self._removal_reason


def get_filter_methods() -> list[dict[str, Any]]:
    """Get list of available filter methods with metadata.

    Introspects nirs4all filters dynamically to provide method information.

    Returns:
        List of method info dicts with name, display_name, category, params
    """
    methods = []

    if not NIRS4ALL_FILTERS_AVAILABLE:
        # Fallback: return only SampleIndexFilter info
        methods.append({
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
            "type": "filter",
            "source": "nirs4all_webapp",
        })
        return methods

    # XOutlierFilter - X-based outlier detection
    methods.append({
        "name": "XOutlierFilter",
        "display_name": "X Outlier Filter",
        "description": "Remove outliers using X-based statistical methods (Mahalanobis, PCA, LOF, Isolation Forest)",
        "category": "outlier",
        "params": {
            "method": {
                "required": False,
                "default": "mahalanobis",
                "type": "string",
                "options": ["mahalanobis", "robust_mahalanobis", "pca_residual", "pca_leverage", "isolation_forest", "lof"],
            },
            "threshold": {
                "required": False,
                "default": 3.0,
                "type": "float",
                "description": "Detection threshold (method-specific)",
            },
            "n_components": {
                "required": False,
                "default": None,
                "type": "int",
                "description": "Number of PCA components for PCA-based methods",
            },
            "contamination": {
                "required": False,
                "default": 0.1,
                "type": "float",
                "description": "Expected proportion of outliers (for isolation_forest/lof)",
            },
        },
        "type": "filter",
        "source": "nirs4all",
    })

    # YOutlierFilter - Y-based outlier detection
    methods.append({
        "name": "YOutlierFilter",
        "display_name": "Y Outlier Filter",
        "description": "Remove outliers based on target value (IQR, z-score, percentile, MAD)",
        "category": "outlier",
        "params": {
            "method": {
                "required": False,
                "default": "iqr",
                "type": "string",
                "options": ["iqr", "zscore", "percentile", "mad"],
            },
            "threshold": {
                "required": False,
                "default": 1.5,
                "type": "float",
                "description": "Threshold for IQR/zscore/MAD methods",
            },
            "lower_percentile": {
                "required": False,
                "default": 1.0,
                "type": "float",
                "description": "Lower percentile cutoff (for percentile method)",
            },
            "upper_percentile": {
                "required": False,
                "default": 99.0,
                "type": "float",
                "description": "Upper percentile cutoff (for percentile method)",
            },
        },
        "type": "filter",
        "source": "nirs4all",
    })

    # SpectralQualityFilter - Quality control
    methods.append({
        "name": "SpectralQualityFilter",
        "display_name": "Spectral Quality Filter",
        "description": "Filter samples by quality control criteria (NaN, zeros, variance, saturation)",
        "category": "quality",
        "params": {
            "max_nan_ratio": {
                "required": False,
                "default": 0.1,
                "type": "float",
                "description": "Maximum ratio of NaN values per sample (0-1)",
            },
            "max_zero_ratio": {
                "required": False,
                "default": 0.5,
                "type": "float",
                "description": "Maximum ratio of zero values per sample (0-1)",
            },
            "min_variance": {
                "required": False,
                "default": 1e-8,
                "type": "float",
                "description": "Minimum variance threshold",
            },
            "max_value": {
                "required": False,
                "default": None,
                "type": "float",
                "description": "Maximum allowed value (saturation detection)",
            },
            "min_value": {
                "required": False,
                "default": None,
                "type": "float",
                "description": "Minimum allowed value",
            },
            "check_inf": {
                "required": False,
                "default": True,
                "type": "bool",
                "description": "Check for infinite values",
            },
        },
        "type": "filter",
        "source": "nirs4all",
    })

    # HighLeverageFilter - Leverage-based filtering
    methods.append({
        "name": "HighLeverageFilter",
        "display_name": "High Leverage Filter",
        "description": "Filter high-leverage samples that may unduly influence models",
        "category": "outlier",
        "params": {
            "method": {
                "required": False,
                "default": "hat",
                "type": "string",
                "options": ["hat", "pca"],
            },
            "threshold_multiplier": {
                "required": False,
                "default": 2.0,
                "type": "float",
                "description": "Multiple of average leverage to use as threshold",
            },
            "absolute_threshold": {
                "required": False,
                "default": None,
                "type": "float",
                "description": "Absolute leverage threshold (overrides multiplier)",
            },
            "n_components": {
                "required": False,
                "default": None,
                "type": "int",
                "description": "Number of PCA components (for pca method)",
            },
        },
        "type": "filter",
        "source": "nirs4all",
    })

    # MetadataFilter - Metadata-based filtering
    methods.append({
        "name": "MetadataFilter",
        "display_name": "Metadata Filter",
        "description": "Filter samples by metadata column values",
        "category": "metadata",
        "params": {
            "column": {
                "required": True,
                "type": "string",
                "description": "Metadata column name to filter on",
            },
            "values_to_exclude": {
                "required": False,
                "default": None,
                "type": "list",
                "description": "List of values to exclude",
            },
            "values_to_keep": {
                "required": False,
                "default": None,
                "type": "list",
                "description": "List of values to keep (only one of exclude/keep can be set)",
            },
            "exclude_missing": {
                "required": False,
                "default": True,
                "type": "bool",
                "description": "Exclude samples with missing/None values",
            },
        },
        "type": "filter",
        "source": "nirs4all",
    })

    # SampleIndexFilter - Webapp-specific
    methods.append({
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
        "type": "filter",
        "source": "nirs4all_webapp",
    })

    return methods


def instantiate_filter(name: str, params: dict[str, Any]) -> SampleIndexFilter | _Nirs4AllFilterAdapter | None:
    """Create a filter instance from name and parameters.

    Args:
        name: Filter class name
        params: Parameters to pass to constructor

    Returns:
        Instantiated filter (wrapped in adapter if nirs4all filter), or None if not found
    """
    # Handle webapp-specific SampleIndexFilter
    if name == "SampleIndexFilter":
        try:
            return SampleIndexFilter(**params)
        except TypeError:
            # Filter invalid params
            import inspect
            sig = inspect.signature(SampleIndexFilter.__init__)
            param_names = set(sig.parameters.keys()) - {"self"}
            valid_params = {k: v for k, v in params.items() if k in param_names}
            return SampleIndexFilter(**valid_params)

    if not NIRS4ALL_FILTERS_AVAILABLE:
        return None

    # Map filter names to nirs4all classes
    filter_map = {
        "XOutlierFilter": XOutlierFilter,
        "YOutlierFilter": YOutlierFilter,
        "SpectralQualityFilter": SpectralQualityFilter,
        "HighLeverageFilter": HighLeverageFilter,
        "MetadataFilter": N4AMetadataFilter,
        # Legacy name mappings for backward compatibility
        "OutlierFilter": XOutlierFilter,  # Map old OutlierFilter to XOutlierFilter
        "RangeFilter": YOutlierFilter,    # Map old RangeFilter to YOutlierFilter (percentile method)
        "QCFilter": SpectralQualityFilter,  # Map old QCFilter to SpectralQualityFilter
        "DistanceFilter": XOutlierFilter,  # Map old DistanceFilter to XOutlierFilter (mahalanobis)
    }

    filter_cls = filter_map.get(name)
    if filter_cls is None:
        return None

    # Handle parameter translation for legacy filters
    translated_params = _translate_legacy_params(name, params)

    try:
        filter_instance = filter_cls(**translated_params)
        return _Nirs4AllFilterAdapter(filter_instance)
    except TypeError:
        # Try without invalid params
        import inspect
        sig = inspect.signature(filter_cls.__init__)
        param_names = set(sig.parameters.keys()) - {"self"}
        valid_params = {k: v for k, v in translated_params.items() if k in param_names}
        filter_instance = filter_cls(**valid_params)
        return _Nirs4AllFilterAdapter(filter_instance)


def _translate_legacy_params(name: str, params: dict[str, Any]) -> dict[str, Any]:
    """Translate legacy filter parameters to nirs4all equivalents.

    Args:
        name: Original filter name
        params: Original parameters

    Returns:
        Translated parameters for nirs4all filters
    """
    translated = params.copy()

    if name == "OutlierFilter":
        # Map old OutlierFilter methods to XOutlierFilter methods
        method_map = {
            "hotelling": "pca_leverage",
            "q_residual": "pca_residual",
            "lof": "lof",
            "elliptic": "isolation_forest",  # Closest equivalent
        }
        if "method" in translated:
            translated["method"] = method_map.get(translated["method"], "mahalanobis")
        # Remove old threshold param if it was a percentile (0-1 range)
        if "threshold" in translated and translated["threshold"] <= 1:
            # Old filter used percentile thresholds, new one uses different scaling
            # For pca_leverage/pca_residual, threshold is auto-computed from percentile
            del translated["threshold"]

    elif name == "RangeFilter":
        # Map old RangeFilter to YOutlierFilter with percentile method
        translated["method"] = "percentile"
        if "min_value" in translated and translated["min_value"] is not None:
            # Convert min_value to lower_percentile if quantile_mode was True
            if translated.get("quantile_mode", False):
                translated["lower_percentile"] = translated.pop("min_value")
            else:
                # Can't directly translate absolute values to percentiles
                # Use a placeholder - the filter will need re-fitting
                translated.pop("min_value", None)
        if "max_value" in translated and translated["max_value"] is not None:
            if translated.get("quantile_mode", False):
                translated["upper_percentile"] = translated.pop("max_value")
            else:
                translated.pop("max_value", None)
        translated.pop("quantile_mode", None)

    elif name == "QCFilter":
        # Map old QCFilter params to SpectralQualityFilter
        # max_nan_ratio, max_inf_ratio -> max_nan_ratio, check_inf
        if "max_inf_ratio" in translated:
            translated["check_inf"] = translated.pop("max_inf_ratio") <= 0
        if "max_saturation_ratio" in translated:
            # SpectralQualityFilter uses max_value instead of saturation_ratio
            del translated["max_saturation_ratio"]
        if "saturation_threshold" in translated:
            translated["max_value"] = translated.pop("saturation_threshold")
        if "require_y" in translated:
            # SpectralQualityFilter doesn't have this param
            del translated["require_y"]

    elif name == "DistanceFilter":
        # Map old DistanceFilter to XOutlierFilter with mahalanobis
        translated["method"] = "mahalanobis"
        if "metric" in translated:
            metric = translated.pop("metric")
            if metric == "mahalanobis":
                translated["method"] = "mahalanobis"
            elif metric == "euclidean":
                translated["method"] = "mahalanobis"  # Closest available
            # cosine not directly supported
        if "quantile" in translated:
            # XOutlierFilter doesn't use quantile directly
            del translated["quantile"]
        if "reference" in translated:
            del translated["reference"]

    return translated


# Backward compatibility exports (deprecated)
# These are kept only for imports that might reference them directly
# The actual implementations are in nirs4all.operators.filters
BaseFilter = None  # Removed - use SampleFilter from nirs4all
OutlierFilter = None  # Removed - use XOutlierFilter from nirs4all
RangeFilter = None  # Removed - use YOutlierFilter from nirs4all
QCFilter = None  # Removed - use SpectralQualityFilter from nirs4all
DistanceFilter = None  # Removed - use XOutlierFilter from nirs4all

# Registry for backward compatibility - maps to instantiate_filter
FILTER_REGISTRY: dict[str, type] = {}  # Empty - use instantiate_filter instead
