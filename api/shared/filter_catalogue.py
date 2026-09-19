"""Shared Studio filter catalogue metadata, without filter execution."""
from typing import Any

NIRS4ALL_FILTERS_AVAILABLE = True

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
