"""
Filter operators for playground sample selection.

This module provides filter operators that can remove samples based on
various criteria. It delegates to nirs4all.operators.filters for the
actual filter implementations.

The only webapp-specific filter is SampleIndexFilter, which is used for
the "Filter to Selection" feature in the UI.

Phase 1 Implementation - Foundation & Selection System
"""

from typing import Any

from ..lazy_imports import get_cached

NIRS4ALL_FILTERS_AVAILABLE = True


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
        X,
        y=None,
        metadata=None,
    ):
        """Fit the filter and return a boolean mask.

        Args:
            X: Feature matrix (n_samples, n_features)
            y: Target values (n_samples,) - optional
            metadata: Dict of metadata arrays - optional

        Returns:
            Boolean mask array where True = keep sample
        """
        import numpy as np
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

    def __init__(self, filter_instance: Any):
        self._filter = filter_instance
        self._removal_reason = filter_instance.exclusion_reason

    def fit_predict(
        self,
        X,
        y=None,
        metadata=None,
    ):
        """Fit the filter and return a boolean mask.

        Args:
            X: Feature matrix (n_samples, n_features)
            y: Target values (n_samples,) - optional
            metadata: Dict of metadata arrays - optional

        Returns:
            Boolean mask array where True = keep sample
        """
        import numpy as np
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


from .filter_catalogue import get_filter_methods  # noqa: E402, F401


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
        "XOutlierFilter": get_cached("XOutlierFilter"),
        "YOutlierFilter": get_cached("YOutlierFilter"),
        "SpectralQualityFilter": get_cached("SpectralQualityFilter"),
        "HighLeverageFilter": get_cached("HighLeverageFilter"),
        "MetadataFilter": get_cached("N4AMetadataFilter"),
    }

    filter_cls = filter_map.get(name)
    if filter_cls is None:
        return None

    try:
        filter_instance = filter_cls(**params)
        return _Nirs4AllFilterAdapter(filter_instance)
    except TypeError:
        # Try without invalid params
        import inspect
        sig = inspect.signature(filter_cls.__init__)
        param_names = set(sig.parameters.keys()) - {"self"}
        valid_params = {k: v for k, v in params.items() if k in param_names}
        filter_instance = filter_cls(**valid_params)
        return _Nirs4AllFilterAdapter(filter_instance)
