"""
Spectral Metrics Computer for Playground.

Phase 5 Implementation: Advanced Filtering & Metrics

This module provides a unified system for computing and caching per-sample
spectral descriptors used across filtering, coloring, and analysis.

Metric Categories:
- Amplitude: global_min, global_max, dynamic_range, mean_intensity
- Energy: l2_norm, rms_energy, auc, abs_auc
- Shape: baseline_slope, baseline_offset, peak_count, peak_prominence_max
- Noise: hf_variance, snr_estimate, smoothness
- Quality: nan_count, inf_count, saturation_count, zero_count
- Chemometric (requires PCA): hotelling_t2, q_residual, leverage, distance_to_centroid, lof_score

Note: Chemometric metrics are delegated to nirs4all.operators.filters for computation.
"""

from typing import Any, Dict, List, Optional, Tuple
import numpy as np

try:
    from scipy import stats
    from scipy.signal import find_peaks
    SCIPY_AVAILABLE = True
except ImportError:
    SCIPY_AVAILABLE = False

# Import nirs4all filters for chemometric metrics
try:
    from nirs4all.operators.filters import (
        XOutlierFilter,
        SpectralQualityFilter,
        HighLeverageFilter,
    )
    NIRS4ALL_FILTERS_AVAILABLE = True
except ImportError:
    NIRS4ALL_FILTERS_AVAILABLE = False


# ============= Metric Categories =============

AMPLITUDE_METRICS = [
    'global_min',
    'global_max',
    'dynamic_range',
    'mean_intensity',
]

ENERGY_METRICS = [
    'l2_norm',
    'rms_energy',
    'auc',
    'abs_auc',
]

SHAPE_METRICS = [
    'baseline_slope',
    'baseline_offset',
    'peak_count',
    'peak_prominence_max',
]

NOISE_METRICS = [
    'hf_variance',
    'snr_estimate',
    'smoothness',
]

QUALITY_METRICS = [
    'nan_count',
    'inf_count',
    'saturation_count',
    'zero_count',
]

CHEMOMETRIC_METRICS = [
    'hotelling_t2',
    'q_residual',
    'leverage',
    'distance_to_centroid',
    'lof_score',
]

# Fast metrics that can be computed without dependencies
FAST_METRICS = AMPLITUDE_METRICS + ENERGY_METRICS + QUALITY_METRICS + ['hf_variance', 'snr_estimate', 'smoothness']

# All available metrics
ALL_METRICS = AMPLITUDE_METRICS + ENERGY_METRICS + SHAPE_METRICS + NOISE_METRICS + QUALITY_METRICS + CHEMOMETRIC_METRICS


class MetricsComputer:
    """Compute per-sample spectral descriptors.

    This class provides methods to compute various metrics for spectral data,
    organized by category. Metrics can be computed individually or in batches.

    Chemometric metrics (hotelling_t2, q_residual, leverage, lof_score, distance_to_centroid)
    are delegated to nirs4all.operators.filters for computation.

    Attributes:
        saturation_threshold: Threshold value for saturation detection
        n_pca_components: Number of PCA components for chemometric metrics
        lof_n_neighbors: Number of neighbors for LOF computation
    """

    def __init__(
        self,
        saturation_threshold: Optional[float] = None,
        n_pca_components: int = 5,
        lof_n_neighbors: int = 20,
        lof_contamination: float = 0.1,
    ):
        """Initialize the MetricsComputer.

        Args:
            saturation_threshold: Value threshold for saturation detection.
                If None, uses max value in data.
            n_pca_components: Number of PCA components for chemometric metrics.
            lof_n_neighbors: Number of neighbors for LOF computation.
            lof_contamination: Expected fraction of outliers for LOF.
        """
        self.saturation_threshold = saturation_threshold
        self.n_pca_components = n_pca_components
        self.lof_n_neighbors = lof_n_neighbors
        self.lof_contamination = lof_contamination

    def compute(
        self,
        X: np.ndarray,
        metrics: Optional[List[str]] = None,
        pca_result: Optional[Dict[str, Any]] = None,
        wavelengths: Optional[np.ndarray] = None,
    ) -> Dict[str, np.ndarray]:
        """Compute specified metrics for the data.

        Args:
            X: Feature matrix (n_samples, n_features)
            metrics: List of metrics to compute. If None, computes all fast metrics.
            pca_result: Pre-computed PCA result (for chemometric metrics) - ignored, filters compute their own PCA
            wavelengths: Wavelength array (for proper AUC computation)

        Returns:
            Dict mapping metric names to arrays of per-sample values
        """
        if metrics is None:
            metrics = FAST_METRICS

        results: Dict[str, np.ndarray] = {}

        for metric in metrics:
            try:
                value = self._compute_metric(X, metric, wavelengths)
                if value is not None:
                    results[metric] = value
            except Exception as e:
                # Log error but continue with other metrics
                print(f"Warning: Failed to compute metric '{metric}': {e}")
                continue

        return results

    def _compute_metric(
        self,
        X: np.ndarray,
        metric: str,
        wavelengths: Optional[np.ndarray] = None,
    ) -> Optional[np.ndarray]:
        """Compute a single metric.

        Args:
            X: Feature matrix
            metric: Metric name
            wavelengths: Wavelength array

        Returns:
            Array of metric values, or None if computation failed
        """
        n_samples, n_features = X.shape

        # ======== Amplitude Metrics ========
        if metric == 'global_min':
            return np.nanmin(X, axis=1)

        elif metric == 'global_max':
            return np.nanmax(X, axis=1)

        elif metric == 'dynamic_range':
            return np.nanmax(X, axis=1) - np.nanmin(X, axis=1)

        elif metric == 'mean_intensity':
            return np.nanmean(X, axis=1)

        # ======== Energy Metrics ========
        elif metric == 'l2_norm':
            return np.linalg.norm(X, axis=1)

        elif metric == 'rms_energy':
            return np.sqrt(np.nanmean(X ** 2, axis=1))

        elif metric == 'auc':
            if wavelengths is not None and len(wavelengths) == n_features:
                return np.trapz(X, wavelengths, axis=1)
            return np.trapz(X, axis=1)

        elif metric == 'abs_auc':
            if wavelengths is not None and len(wavelengths) == n_features:
                return np.trapz(np.abs(X), wavelengths, axis=1)
            return np.trapz(np.abs(X), axis=1)

        # ======== Shape Metrics ========
        elif metric == 'baseline_slope':
            # Linear fit slope for each spectrum
            x = np.arange(n_features)
            slopes = np.zeros(n_samples)
            for i in range(n_samples):
                valid_mask = ~np.isnan(X[i])
                if valid_mask.sum() > 1:
                    slope, _, _, _, _ = stats.linregress(x[valid_mask], X[i, valid_mask]) if SCIPY_AVAILABLE else (np.polyfit(x[valid_mask], X[i, valid_mask], 1)[0], 0, 0, 0, 0)
                    slopes[i] = slope
            return slopes

        elif metric == 'baseline_offset':
            # Linear fit intercept for each spectrum
            x = np.arange(n_features)
            offsets = np.zeros(n_samples)
            for i in range(n_samples):
                valid_mask = ~np.isnan(X[i])
                if valid_mask.sum() > 1:
                    if SCIPY_AVAILABLE:
                        _, intercept, _, _, _ = stats.linregress(x[valid_mask], X[i, valid_mask])
                    else:
                        coeffs = np.polyfit(x[valid_mask], X[i, valid_mask], 1)
                        intercept = coeffs[1]
                    offsets[i] = intercept
            return offsets

        elif metric == 'peak_count':
            if not SCIPY_AVAILABLE:
                return None
            counts = np.zeros(n_samples)
            for i in range(n_samples):
                spectrum = X[i]
                valid_spectrum = np.nan_to_num(spectrum, nan=0)
                peaks, _ = find_peaks(valid_spectrum, prominence=np.std(valid_spectrum) * 0.5)
                counts[i] = len(peaks)
            return counts

        elif metric == 'peak_prominence_max':
            if not SCIPY_AVAILABLE:
                return None
            from scipy.signal import peak_prominences
            prominences = np.zeros(n_samples)
            for i in range(n_samples):
                spectrum = X[i]
                valid_spectrum = np.nan_to_num(spectrum, nan=0)
                peaks, _ = find_peaks(valid_spectrum)
                if len(peaks) > 0:
                    proms, _, _ = peak_prominences(valid_spectrum, peaks)
                    prominences[i] = np.max(proms) if len(proms) > 0 else 0
            return prominences

        # ======== Noise Metrics ========
        elif metric == 'hf_variance':
            # Variance of first differences (high-frequency noise proxy)
            diffs = np.diff(X, axis=1)
            return np.nanvar(diffs, axis=1)

        elif metric == 'snr_estimate':
            # Simple signal-to-noise ratio estimate
            mean_signal = np.abs(np.nanmean(X, axis=1))
            noise = np.nanstd(X, axis=1)
            # Avoid division by zero
            noise[noise == 0] = 1e-10
            return mean_signal / noise

        elif metric == 'smoothness':
            # Inverse of high-frequency variance
            hf_var = np.nanvar(np.diff(X, axis=1), axis=1)
            hf_var[hf_var == 0] = 1e-10
            return 1.0 / hf_var

        # ======== Quality Metrics (simple numpy, not using SpectralQualityFilter) ========
        elif metric == 'nan_count':
            return np.sum(np.isnan(X), axis=1).astype(float)

        elif metric == 'inf_count':
            return np.sum(np.isinf(X), axis=1).astype(float)

        elif metric == 'saturation_count':
            threshold = self.saturation_threshold
            if threshold is None:
                threshold = np.nanmax(X) * 0.99  # Default to 99% of max
            return np.sum(X >= threshold, axis=1).astype(float)

        elif metric == 'zero_count':
            return np.sum(X == 0, axis=1).astype(float)

        # ======== Chemometric Metrics (delegated to nirs4all filters) ========
        elif metric == 'hotelling_t2':
            return self._compute_chemometric_via_filter(X, 'pca_leverage')

        elif metric == 'q_residual':
            return self._compute_chemometric_via_filter(X, 'pca_residual')

        elif metric == 'leverage':
            return self._compute_leverage_via_filter(X)

        elif metric == 'distance_to_centroid':
            return self._compute_chemometric_via_filter(X, 'mahalanobis')

        elif metric == 'lof_score':
            return self._compute_chemometric_via_filter(X, 'lof')

        else:
            return None

    def _compute_chemometric_via_filter(
        self,
        X: np.ndarray,
        method: str,
    ) -> Optional[np.ndarray]:
        """Compute chemometric metric using nirs4all XOutlierFilter.

        Args:
            X: Feature matrix
            method: Filter method ('pca_leverage', 'pca_residual', 'mahalanobis', 'lof')

        Returns:
            Array of metric values, or None if computation failed
        """
        if not NIRS4ALL_FILTERS_AVAILABLE:
            return None

        n_samples = X.shape[0]
        if n_samples < 2:
            return None

        try:
            X_clean = np.nan_to_num(X, nan=0)

            filter_obj = XOutlierFilter(
                method=method,
                n_components=min(self.n_pca_components, n_samples - 1, X.shape[1]),
                contamination=self.lof_contamination,
            )
            filter_obj.fit(X_clean)

            # Access internal distances computed during fit
            if filter_obj._distances_ is not None:
                return filter_obj._distances_.copy()

            return None
        except Exception:
            return None

    def _compute_leverage_via_filter(self, X: np.ndarray) -> Optional[np.ndarray]:
        """Compute leverage using nirs4all HighLeverageFilter.

        Args:
            X: Feature matrix

        Returns:
            Array of leverage values, or None if computation failed
        """
        if not NIRS4ALL_FILTERS_AVAILABLE:
            return None

        n_samples = X.shape[0]
        if n_samples < 2:
            return None

        try:
            X_clean = np.nan_to_num(X, nan=0)

            filter_obj = HighLeverageFilter(
                method="pca" if X.shape[1] > n_samples else "hat",
                n_components=min(self.n_pca_components, n_samples - 1, X.shape[1], 50),
            )
            filter_obj.fit(X_clean)

            # Use get_leverages method to get the actual values
            return filter_obj.get_leverages(X_clean)
        except Exception:
            return None

    def get_metric_stats(
        self,
        metric_values: np.ndarray,
    ) -> Dict[str, float]:
        """Compute statistics for a metric array.

        Args:
            metric_values: Array of metric values

        Returns:
            Dict with min, max, mean, std, p5, p25, p50, p75, p95 percentiles
        """
        valid_values = metric_values[~np.isnan(metric_values)]

        if len(valid_values) == 0:
            return {
                'min': 0, 'max': 0, 'mean': 0, 'std': 0,
                'p5': 0, 'p25': 0, 'p50': 0, 'p75': 0, 'p95': 0,
            }

        return {
            'min': float(np.min(valid_values)),
            'max': float(np.max(valid_values)),
            'mean': float(np.mean(valid_values)),
            'std': float(np.std(valid_values)),
            'p5': float(np.percentile(valid_values, 5)),
            'p25': float(np.percentile(valid_values, 25)),
            'p50': float(np.percentile(valid_values, 50)),
            'p75': float(np.percentile(valid_values, 75)),
            'p95': float(np.percentile(valid_values, 95)),
        }

    def get_similar_samples(
        self,
        X: np.ndarray,
        reference_idx: int,
        metric: str = 'euclidean',
        threshold: Optional[float] = None,
        top_k: Optional[int] = None,
    ) -> Tuple[np.ndarray, np.ndarray]:
        """Find samples similar to a reference sample.

        This is a UI-specific feature for interactive sample exploration.

        Args:
            X: Feature matrix
            reference_idx: Index of reference sample
            metric: Distance metric ('euclidean', 'cosine', 'correlation')
            threshold: Distance threshold (return all samples within this distance)
            top_k: Return top K most similar samples

        Returns:
            Tuple of (indices of similar samples, distances)
        """
        reference = X[reference_idx]
        n_samples = X.shape[0]

        if metric == 'euclidean':
            distances = np.sqrt(np.nansum((X - reference) ** 2, axis=1))

        elif metric == 'cosine':
            norms = np.linalg.norm(X, axis=1) * np.linalg.norm(reference)
            norms[norms == 0] = 1e-10
            similarities = np.dot(X, reference) / norms
            distances = 1 - similarities

        elif metric == 'correlation':
            # Correlation distance
            X_centered = X - np.nanmean(X, axis=1, keepdims=True)
            ref_centered = reference - np.nanmean(reference)

            norms = np.linalg.norm(X_centered, axis=1) * np.linalg.norm(ref_centered)
            norms[norms == 0] = 1e-10
            correlations = np.dot(X_centered, ref_centered) / norms
            distances = 1 - correlations

        else:
            distances = np.sqrt(np.nansum((X - reference) ** 2, axis=1))

        # Sort by distance
        sorted_indices = np.argsort(distances)

        if top_k is not None:
            # Return top K (excluding reference itself)
            mask = sorted_indices != reference_idx
            sorted_indices = sorted_indices[mask][:top_k]
            return sorted_indices, distances[sorted_indices]

        elif threshold is not None:
            # Return all within threshold
            mask = (distances <= threshold) & (np.arange(n_samples) != reference_idx)
            return np.where(mask)[0], distances[mask]

        else:
            # Return all sorted
            return sorted_indices, distances[sorted_indices]

    def compute_pairwise_distances(
        self,
        X_ref: np.ndarray,
        X_final: np.ndarray,
        metric: str = 'euclidean',
    ) -> np.ndarray:
        """Compute per-sample distance between reference and final spectra.

        This is a UI-specific feature for preprocessing difference visualization.

        Args:
            X_ref: Reference spectra (n_samples, n_features)
            X_final: Final spectra (n_samples, n_features)
            metric: Distance metric to use:
                - 'euclidean': L2 norm of difference
                - 'manhattan': L1 norm of difference
                - 'cosine': Cosine distance (1 - cosine similarity)
                - 'spectral_angle': Spectral Angle Mapper (arccos of cosine sim)
                - 'correlation': Pearson correlation distance (1 - r)
                - 'mahalanobis': Mahalanobis distance using combined covariance
                - 'pca_distance': Distance in PCA score space

        Returns:
            Array of per-sample distances (n_samples,)
        """
        n_samples = X_ref.shape[0]

        if metric == 'euclidean':
            return np.linalg.norm(X_ref - X_final, axis=1)

        elif metric == 'manhattan':
            return np.sum(np.abs(X_ref - X_final), axis=1)

        elif metric == 'cosine':
            from scipy.spatial.distance import cdist
            # Compute diagonal of pairwise cosine distance matrix
            return np.array([cdist(X_ref[i:i+1], X_final[i:i+1], 'cosine')[0, 0]
                           for i in range(n_samples)])

        elif metric == 'spectral_angle':
            # Spectral Angle Mapper: arccos of cosine similarity
            dot = np.sum(X_ref * X_final, axis=1)
            norm_ref = np.linalg.norm(X_ref, axis=1)
            norm_final = np.linalg.norm(X_final, axis=1)
            cos_sim = dot / (norm_ref * norm_final + 1e-10)
            return np.arccos(np.clip(cos_sim, -1, 1))

        elif metric == 'correlation':
            # 1 - Pearson correlation per sample
            correlations = np.zeros(n_samples)
            for i in range(n_samples):
                r = np.corrcoef(X_ref[i], X_final[i])[0, 1]
                correlations[i] = 1 - r if not np.isnan(r) else 1.0
            return correlations

        elif metric == 'mahalanobis':
            # Mahalanobis using combined covariance
            try:
                from sklearn.covariance import LedoitWolf

                # Need enough samples for covariance estimation
                min_samples_for_cov = X_ref.shape[1] + 2
                if n_samples < min_samples_for_cov:
                    # Fall back to euclidean for small sample sizes
                    return np.linalg.norm(X_ref - X_final, axis=1)

                X_combined = np.vstack([X_ref, X_final])
                # Use LedoitWolf for more stable covariance estimation (shrinkage)
                cov = LedoitWolf().fit(X_combined)
                diff = X_ref - X_final

                # Check if precision matrix is valid
                if not np.all(np.isfinite(cov.precision_)):
                    return np.linalg.norm(X_ref - X_final, axis=1)

                distances = np.sqrt(np.sum(diff @ cov.precision_ * diff, axis=1))

                # Replace any NaN/Inf with euclidean fallback
                euclidean = np.linalg.norm(X_ref - X_final, axis=1)
                mask = ~np.isfinite(distances)
                if np.any(mask):
                    distances[mask] = euclidean[mask]

                return distances
            except Exception:
                # Fall back to euclidean if covariance estimation fails
                return np.linalg.norm(X_ref - X_final, axis=1)

        elif metric == 'pca_distance':
            # Distance in PCA score space (first n_components)
            try:
                from sklearn.decomposition import PCA
                n_components = min(10, X_ref.shape[1], n_samples - 1)
                if n_components < 1:
                    return np.linalg.norm(X_ref - X_final, axis=1)

                pca = PCA(n_components=n_components)
                pca.fit(np.vstack([X_ref, X_final]))
                scores_ref = pca.transform(X_ref)
                scores_final = pca.transform(X_final)
                return np.linalg.norm(scores_ref - scores_final, axis=1)
            except Exception:
                return np.linalg.norm(X_ref - X_final, axis=1)

        else:
            raise ValueError(f"Unknown metric: {metric}")

    def compute_repetition_variance(
        self,
        X: np.ndarray,
        group_ids: np.ndarray,
        reference: str = 'group_mean',
        metric: str = 'euclidean',
    ) -> Dict[str, Any]:
        """Compute variance within repetition groups.

        This is a UI-specific feature for analyzing measurement repeatability.

        Args:
            X: Spectral data (n_samples, n_features)
            group_ids: Array of group identifiers for each sample
            reference: Reference type for distance calculation:
                - 'group_mean': Distance from group mean
                - 'leave_one_out': Distance from mean of other samples in group
                - 'first': Distance from first sample in group
            metric: Distance metric (default 'euclidean')

        Returns:
            Dict with:
                - distances: Array of per-sample distances
                - sample_indices: Original sample indices
                - group_ids: Group ID for each distance
                - quantiles: Dict of quantile values
                - per_group: Dict of per-group statistics
        """
        unique_groups = np.unique(group_ids)
        distances = []
        sample_indices = []
        group_labels = []
        per_group_stats = {}

        def compute_distance(spectrum: np.ndarray, ref: np.ndarray) -> float:
            """Compute distance between spectrum and reference."""
            diff = spectrum - ref

            if metric == 'euclidean':
                return float(np.linalg.norm(diff))

            elif metric == 'manhattan':
                return float(np.sum(np.abs(diff)))

            elif metric == 'cosine':
                norm_s = np.linalg.norm(spectrum)
                norm_r = np.linalg.norm(ref)
                if norm_s < 1e-10 or norm_r < 1e-10:
                    return 0.0
                cos_sim = np.dot(spectrum, ref) / (norm_s * norm_r)
                return float(1 - cos_sim)

            elif metric == 'spectral_angle':
                norm_s = np.linalg.norm(spectrum)
                norm_r = np.linalg.norm(ref)
                if norm_s < 1e-10 or norm_r < 1e-10:
                    return 0.0
                cos_sim = np.dot(spectrum, ref) / (norm_s * norm_r)
                return float(np.arccos(np.clip(cos_sim, -1, 1)))

            elif metric == 'correlation':
                r = np.corrcoef(spectrum, ref)[0, 1]
                return float(1 - r) if np.isfinite(r) else 1.0

            else:
                return float(np.linalg.norm(diff))

        for group_id in unique_groups:
            mask = group_ids == group_id
            group_indices = np.where(mask)[0]
            group_spectra = X[mask]

            if len(group_spectra) < 2:
                # Can't compute variance with single sample
                continue

            group_distances = []

            if reference == 'group_mean':
                ref = group_spectra.mean(axis=0)
                for idx, spectrum in zip(group_indices, group_spectra):
                    d = compute_distance(spectrum, ref)
                    distances.append(d)
                    sample_indices.append(int(idx))
                    group_labels.append(str(group_id))
                    group_distances.append(d)

            elif reference == 'first':
                ref = group_spectra[0]
                for idx, spectrum in zip(group_indices, group_spectra):
                    d = compute_distance(spectrum, ref)
                    distances.append(d)
                    sample_indices.append(int(idx))
                    group_labels.append(str(group_id))
                    group_distances.append(d)

            elif reference == 'leave_one_out':
                for i, (idx, spectrum) in enumerate(zip(group_indices, group_spectra)):
                    others = np.delete(group_spectra, i, axis=0)
                    ref = others.mean(axis=0)
                    d = compute_distance(spectrum, ref)
                    distances.append(d)
                    sample_indices.append(int(idx))
                    group_labels.append(str(group_id))
                    group_distances.append(d)

            else:
                # Default to group_mean for unknown reference types
                ref = group_spectra.mean(axis=0)
                for idx, spectrum in zip(group_indices, group_spectra):
                    d = compute_distance(spectrum, ref)
                    distances.append(d)
                    sample_indices.append(int(idx))
                    group_labels.append(str(group_id))
                    group_distances.append(d)

            # Compute per-group statistics
            if group_distances:
                valid_distances = [d for d in group_distances if np.isfinite(d)]
                if valid_distances:
                    per_group_stats[str(group_id)] = {
                        'mean': float(np.mean(valid_distances)),
                        'std': float(np.std(valid_distances)),
                        'max': float(np.max(valid_distances)),
                        'count': len(valid_distances),
                    }

        distances_arr = np.array(distances)

        # Final validation - replace any remaining NaN/Inf with 0
        distances_arr = np.where(np.isfinite(distances_arr), distances_arr, 0.0)

        return {
            'distances': distances_arr,
            'sample_indices': sample_indices,
            'group_ids': group_labels,
            'quantiles': {
                '50': float(np.percentile(distances_arr, 50)) if len(distances_arr) > 0 else 0,
                '75': float(np.percentile(distances_arr, 75)) if len(distances_arr) > 0 else 0,
                '90': float(np.percentile(distances_arr, 90)) if len(distances_arr) > 0 else 0,
                '95': float(np.percentile(distances_arr, 95)) if len(distances_arr) > 0 else 0,
            },
            'per_group': per_group_stats,
        }


def get_available_metrics() -> Dict[str, List[Dict[str, Any]]]:
    """Get list of available metrics organized by category.

    Returns:
        Dict mapping category names to lists of metric info
    """
    categories = {
        'amplitude': [
            {'name': 'global_min', 'display_name': 'Global Minimum', 'description': 'Minimum intensity value'},
            {'name': 'global_max', 'display_name': 'Global Maximum', 'description': 'Maximum intensity value'},
            {'name': 'dynamic_range', 'display_name': 'Dynamic Range', 'description': 'Max - Min intensity span'},
            {'name': 'mean_intensity', 'display_name': 'Mean Intensity', 'description': 'Average intensity across spectrum'},
        ],
        'energy': [
            {'name': 'l2_norm', 'display_name': 'L2 Norm', 'description': 'Euclidean norm (magnitude)'},
            {'name': 'rms_energy', 'display_name': 'RMS Energy', 'description': 'Root mean square energy'},
            {'name': 'auc', 'display_name': 'Area Under Curve', 'description': 'Integral of spectrum'},
            {'name': 'abs_auc', 'display_name': 'Absolute AUC', 'description': 'Integral of absolute spectrum'},
        ],
        'shape': [
            {'name': 'baseline_slope', 'display_name': 'Baseline Slope', 'description': 'Linear trend slope'},
            {'name': 'baseline_offset', 'display_name': 'Baseline Offset', 'description': 'Linear trend intercept'},
            {'name': 'peak_count', 'display_name': 'Peak Count', 'description': 'Number of detected peaks'},
            {'name': 'peak_prominence_max', 'display_name': 'Max Peak Prominence', 'description': 'Prominence of strongest peak'},
        ],
        'noise': [
            {'name': 'hf_variance', 'display_name': 'HF Variance', 'description': 'High-frequency noise variance'},
            {'name': 'snr_estimate', 'display_name': 'SNR Estimate', 'description': 'Signal-to-noise ratio estimate'},
            {'name': 'smoothness', 'display_name': 'Smoothness', 'description': 'Inverse of HF variance'},
        ],
        'quality': [
            {'name': 'nan_count', 'display_name': 'NaN Count', 'description': 'Number of missing values'},
            {'name': 'inf_count', 'display_name': 'Inf Count', 'description': 'Number of infinite values'},
            {'name': 'saturation_count', 'display_name': 'Saturation Count', 'description': 'Number of saturated values'},
            {'name': 'zero_count', 'display_name': 'Zero Count', 'description': 'Number of zero values'},
        ],
        'chemometric': [
            {'name': 'hotelling_t2', 'display_name': "Hotelling's T²", 'description': 'Distance in PCA space (via nirs4all)', 'requires_pca': True},
            {'name': 'q_residual', 'display_name': 'Q-Residual (SPE)', 'description': 'PCA reconstruction error (via nirs4all)', 'requires_pca': True},
            {'name': 'leverage', 'display_name': 'Leverage', 'description': 'Sample influence on model (via nirs4all)'},
            {'name': 'distance_to_centroid', 'display_name': 'Distance to Centroid', 'description': 'Mahalanobis distance from data center (via nirs4all)'},
            {'name': 'lof_score', 'display_name': 'LOF Score', 'description': 'Local Outlier Factor (via nirs4all)'},
        ],
    }

    return categories
