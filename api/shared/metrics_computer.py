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
"""

from functools import lru_cache
from typing import Any, Dict, List, Optional, Tuple, Union
import numpy as np

try:
    from sklearn.decomposition import PCA
    from sklearn.neighbors import LocalOutlierFactor
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False

try:
    from scipy import stats
    from scipy.signal import find_peaks
    from scipy.ndimage import uniform_filter1d
    SCIPY_AVAILABLE = True
except ImportError:
    SCIPY_AVAILABLE = False


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

        # Cache for expensive computations
        self._pca_cache: Dict[str, Any] = {}
        self._lof_cache: Dict[str, np.ndarray] = {}

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
            pca_result: Pre-computed PCA result (for chemometric metrics)
            wavelengths: Wavelength array (for proper AUC computation)

        Returns:
            Dict mapping metric names to arrays of per-sample values
        """
        if metrics is None:
            metrics = FAST_METRICS

        n_samples, n_features = X.shape
        results: Dict[str, np.ndarray] = {}

        for metric in metrics:
            try:
                value = self._compute_metric(X, metric, pca_result, wavelengths)
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
        pca_result: Optional[Dict[str, Any]] = None,
        wavelengths: Optional[np.ndarray] = None,
    ) -> Optional[np.ndarray]:
        """Compute a single metric.

        Args:
            X: Feature matrix
            metric: Metric name
            pca_result: Pre-computed PCA result
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

        # ======== Quality Metrics ========
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

        # ======== Chemometric Metrics ========
        elif metric == 'hotelling_t2':
            return self._compute_hotelling_t2(X, pca_result)

        elif metric == 'q_residual':
            return self._compute_q_residual(X, pca_result)

        elif metric == 'leverage':
            return self._compute_leverage(X)

        elif metric == 'distance_to_centroid':
            centroid = np.nanmean(X, axis=0)
            return np.sqrt(np.nansum((X - centroid) ** 2, axis=1))

        elif metric == 'lof_score':
            return self._compute_lof_score(X)

        else:
            return None

    def _compute_hotelling_t2(
        self,
        X: np.ndarray,
        pca_result: Optional[Dict[str, Any]] = None,
    ) -> Optional[np.ndarray]:
        """Compute Hotelling's T² statistic for each sample.

        T² measures the distance from the center in PCA score space,
        weighted by the explained variance of each component.

        Args:
            X: Feature matrix
            pca_result: Pre-computed PCA result with 'coordinates' and 'explained_variance'

        Returns:
            Array of T² values
        """
        if not SKLEARN_AVAILABLE:
            return None

        n_samples = X.shape[0]

        if pca_result is not None and 'coordinates' in pca_result and 'explained_variance' in pca_result:
            # Use pre-computed PCA
            coords = np.array(pca_result['coordinates'])
            variance = np.array(pca_result['explained_variance'])

            # Use only as many components as we have variance values
            n_components = min(coords.shape[1], len(variance))
            coords = coords[:, :n_components]
            variance = variance[:n_components]

            # Avoid division by zero
            variance[variance == 0] = 1e-10

            # T² = Σ(score_i² / variance_i)
            t2 = np.sum((coords ** 2) / variance, axis=1)
            return t2
        else:
            # Compute PCA on the fly
            n_components = min(self.n_pca_components, X.shape[0] - 1, X.shape[1])
            if n_components < 1:
                return None

            try:
                pca = PCA(n_components=n_components)
                scores = pca.fit_transform(np.nan_to_num(X, nan=0))
                variance = pca.explained_variance_
                variance[variance == 0] = 1e-10
                t2 = np.sum((scores ** 2) / variance, axis=1)
                return t2
            except Exception:
                return None

    def _compute_q_residual(
        self,
        X: np.ndarray,
        pca_result: Optional[Dict[str, Any]] = None,
    ) -> Optional[np.ndarray]:
        """Compute Q-residual (SPE) for each sample.

        Q-residual measures the reconstruction error after PCA projection.
        High Q-residual indicates the sample doesn't fit the PCA model well.

        Args:
            X: Feature matrix
            pca_result: Pre-computed PCA result

        Returns:
            Array of Q-residual values
        """
        if not SKLEARN_AVAILABLE:
            return None

        n_samples, n_features = X.shape
        n_components = min(self.n_pca_components, n_samples - 1, n_features)

        if n_components < 1:
            return None

        try:
            # Need to fit PCA to get the components for reconstruction
            pca = PCA(n_components=n_components)
            X_clean = np.nan_to_num(X, nan=0)
            scores = pca.fit_transform(X_clean)
            X_reconstructed = pca.inverse_transform(scores)

            # Q = ||X - X_reconstructed||²
            residuals = X_clean - X_reconstructed
            q = np.sum(residuals ** 2, axis=1)
            return q
        except Exception:
            return None

    def _compute_leverage(self, X: np.ndarray) -> Optional[np.ndarray]:
        """Compute leverage (hat values) for each sample.

        Leverage measures how much influence each sample has on the model.
        High leverage samples are potentially influential outliers.

        Args:
            X: Feature matrix

        Returns:
            Array of leverage values
        """
        n_samples, n_features = X.shape

        try:
            X_clean = np.nan_to_num(X, nan=0)
            # Center the data
            X_centered = X_clean - np.mean(X_clean, axis=0)

            # Compute leverage using SVD for numerical stability
            # H = X @ (X'X)^-1 @ X'
            # Leverage = diag(H)

            # Use reduced SVD for efficiency
            n_components = min(n_samples - 1, n_features, 50)  # Limit to 50 for speed
            if SKLEARN_AVAILABLE:
                from sklearn.decomposition import TruncatedSVD
                svd = TruncatedSVD(n_components=n_components)
                X_reduced = svd.fit_transform(X_centered)
            else:
                # Simple fallback using numpy
                U, s, Vt = np.linalg.svd(X_centered, full_matrices=False)
                X_reduced = U[:, :n_components] * s[:n_components]

            # Leverage in reduced space
            XtX_inv = np.linalg.pinv(X_reduced.T @ X_reduced)
            leverage = np.sum((X_reduced @ XtX_inv) * X_reduced, axis=1)

            return leverage
        except Exception:
            return None

    def _compute_lof_score(self, X: np.ndarray) -> Optional[np.ndarray]:
        """Compute Local Outlier Factor scores.

        LOF measures local density deviation of a sample compared to its neighbors.
        Values significantly greater than 1 indicate outliers.

        Args:
            X: Feature matrix

        Returns:
            Array of LOF scores (negative = outlier in sklearn convention)
        """
        if not SKLEARN_AVAILABLE:
            return None

        n_samples = X.shape[0]
        n_neighbors = min(self.lof_n_neighbors, n_samples - 1)

        if n_neighbors < 2:
            return None

        try:
            X_clean = np.nan_to_num(X, nan=0)
            lof = LocalOutlierFactor(
                n_neighbors=n_neighbors,
                contamination=self.lof_contamination,
                novelty=False,
            )
            lof.fit(X_clean)
            # Return negative outlier factor (more negative = more outlier)
            return -lof.negative_outlier_factor_
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

    def get_outlier_mask(
        self,
        X: np.ndarray,
        method: str = 'hotelling_t2',
        threshold: float = 0.95,
        pca_result: Optional[Dict[str, Any]] = None,
    ) -> Tuple[np.ndarray, Dict[str, Any]]:
        """Get mask of samples identified as outliers.

        Args:
            X: Feature matrix
            method: Detection method ('hotelling_t2', 'q_residual', 'lof', 'distance')
            threshold: Threshold for outlier detection (interpretation depends on method)
            pca_result: Pre-computed PCA result

        Returns:
            Tuple of (boolean mask where True = inlier, info dict)
        """
        n_samples = X.shape[0]

        if method == 'hotelling_t2':
            values = self._compute_hotelling_t2(X, pca_result)
            if values is None:
                return np.ones(n_samples, dtype=bool), {'error': 'Failed to compute T²'}

            # Use chi-squared threshold
            if SCIPY_AVAILABLE:
                n_components = min(self.n_pca_components, X.shape[0] - 1, X.shape[1])
                critical_value = stats.chi2.ppf(threshold, n_components)
            else:
                critical_value = np.percentile(values, threshold * 100)

            mask = values <= critical_value
            return mask, {
                'method': 'hotelling_t2',
                'threshold': float(critical_value),
                'n_outliers': int(np.sum(~mask)),
                'values': values.tolist(),
            }

        elif method == 'q_residual':
            values = self._compute_q_residual(X, pca_result)
            if values is None:
                return np.ones(n_samples, dtype=bool), {'error': 'Failed to compute Q-residual'}

            # Use percentile threshold
            critical_value = np.percentile(values, threshold * 100)
            mask = values <= critical_value
            return mask, {
                'method': 'q_residual',
                'threshold': float(critical_value),
                'n_outliers': int(np.sum(~mask)),
                'values': values.tolist(),
            }

        elif method == 'lof':
            values = self._compute_lof_score(X)
            if values is None:
                return np.ones(n_samples, dtype=bool), {'error': 'Failed to compute LOF'}

            # LOF > threshold indicates outlier
            # Typical threshold: 1.5-2.0 for moderate outliers
            lof_threshold = 1.0 + (1.0 - threshold) * 5  # Map 0.95 -> 1.25, 0.9 -> 1.5
            mask = values <= lof_threshold
            return mask, {
                'method': 'lof',
                'threshold': float(lof_threshold),
                'n_outliers': int(np.sum(~mask)),
                'values': values.tolist(),
            }

        elif method == 'distance':
            values = self.compute(X, metrics=['distance_to_centroid'])['distance_to_centroid']
            critical_value = np.percentile(values, threshold * 100)
            mask = values <= critical_value
            return mask, {
                'method': 'distance_to_centroid',
                'threshold': float(critical_value),
                'n_outliers': int(np.sum(~mask)),
                'values': values.tolist(),
            }

        else:
            return np.ones(n_samples, dtype=bool), {'error': f'Unknown method: {method}'}

    def get_similar_samples(
        self,
        X: np.ndarray,
        reference_idx: int,
        metric: str = 'euclidean',
        threshold: Optional[float] = None,
        top_k: Optional[int] = None,
    ) -> Tuple[np.ndarray, np.ndarray]:
        """Find samples similar to a reference sample.

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
            {'name': 'hotelling_t2', 'display_name': "Hotelling's T²", 'description': 'Distance in PCA space (requires PCA)', 'requires_pca': True},
            {'name': 'q_residual', 'display_name': 'Q-Residual (SPE)', 'description': 'PCA reconstruction error (requires PCA)', 'requires_pca': True},
            {'name': 'leverage', 'display_name': 'Leverage', 'description': 'Sample influence on model'},
            {'name': 'distance_to_centroid', 'display_name': 'Distance to Centroid', 'description': 'Euclidean distance from data center'},
            {'name': 'lof_score', 'display_name': 'LOF Score', 'description': 'Local Outlier Factor (density-based)'},
        ],
    }

    return categories
