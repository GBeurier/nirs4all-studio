"""Chart computations for the playground.

These functions turn processed spectral data into the visualization payloads
the playground UI renders: per-wavelength statistics, PCA / UMAP projections,
repetition-variability analysis, and spectral metrics. They delegate the heavy
numerical work to nirs4all (PCA), umap-learn (UMAP), and the shared
:class:`MetricsComputer` (metrics), and only add UI-specific shaping.
"""

from __future__ import annotations

from typing import Any

from ..shared.metrics_computer import (
    FAST_METRICS,
    MetricsComputer,
    compute_spectral_statistics,
    get_available_metrics,
)

UMAP_AVAILABLE_DEFAULT = True


def compute_statistics(X) -> dict[str, Any]:
    """Compute per-wavelength statistics.

    Args:
        X: Data array (samples x features)

    Returns:
        Statistics dict
    """
    stats = compute_spectral_statistics(X)
    return {
        "mean": stats["mean"],
        "std": stats["std"],
        "min": stats["min"],
        "max": stats["max"],
        "p5": stats["p5"],
        "p95": stats["p95"],
        "global": stats["global"],
    }


def compute_pca(X, y, fold_info: dict[str, Any] | None) -> dict[str, Any]:
    """Compute PCA projection for visualization.

    Delegates to nirs4all.analysis.compute_pca_projection for the actual
    computation, then adds UI-specific coloring data (y values, fold labels).

    Args:
        X: Processed data
        y: Target values for coloring
        fold_info: Fold assignments for coloring

    Returns:
        PCA result dict
    """
    try:
        from nirs4all.analysis import compute_pca_projection
        pca_data = compute_pca_projection(X, max_components=10, variance_threshold=0.999)
    except Exception as e:
        return {"error": str(e)}

    result = {
        "coordinates": pca_data["coordinates"],
        "explained_variance_ratio": pca_data["explained_variance_ratio"],
        "explained_variance": pca_data["explained_variance"],
        "n_components": pca_data["n_components"],
        "n_components_999": pca_data["n_components_threshold"],
    }

    # Add target values for coloring
    if y is not None:
        result["y"] = y.tolist()

    # Add fold labels for coloring
    if fold_info is not None:
        result["fold_labels"] = fold_info.get("fold_labels")

    return result


def compute_umap(
    X,
    y,
    fold_info: dict[str, Any] | None,
    *,
    umap_available: bool,
    n_neighbors: int = 15,
    min_dist: float = 0.1,
    n_components: int = 2,
) -> dict[str, Any]:
    """Compute UMAP projection for visualization.

    UMAP (Uniform Manifold Approximation and Projection) is a dimension
    reduction technique that preserves local and global data structure
    better than PCA for non-linear relationships.

    Args:
        X: Processed data
        y: Target values for coloring
        fold_info: Fold assignments for coloring
        umap_available: Whether umap-learn is importable.
        n_neighbors: Number of neighbors for UMAP (default 15)
        min_dist: Minimum distance parameter for UMAP (default 0.1)
        n_components: Number of output dimensions (2 or 3)

    Returns:
        UMAP result dict with coordinates and parameters
    """
    if not umap_available:
        return {
            "error": "UMAP not available. Install umap-learn in Settings > Dependencies.",
            "available": False
        }

    # Validate inputs
    n_samples = X.shape[0]
    if n_samples < 10:
        return {
            "error": f"UMAP requires at least 10 samples, got {n_samples}",
            "available": True
        }

    # Clamp n_neighbors to valid range
    n_neighbors = min(max(2, n_neighbors), n_samples - 1)
    n_components = min(max(2, n_components), 3)

    try:
        import umap as _umap
        reducer = _umap.UMAP(
            n_components=n_components,
            n_neighbors=n_neighbors,
            min_dist=min_dist,
            random_state=42,
            n_jobs=-1,
        )
        X_umap = reducer.fit_transform(X)
    except Exception as e:
        return {
            "error": str(e),
            "available": True
        }

    result = {
        "coordinates": X_umap.tolist(),
        "n_components": n_components,
        "params": {
            "n_neighbors": n_neighbors,
            "min_dist": min_dist
        },
        "available": True
    }

    # Add target values for coloring
    if y is not None:
        result["y"] = y.tolist()

    # Add fold labels for coloring
    if fold_info is not None:
        result["fold_labels"] = fold_info.get("fold_labels")

    return result


def _reference_distances(coords, *, metric: str):
    """Distance of each repetition from its group reference.

    Shared distance definition for repetition variability:

    - reference = the first repetition when a group has exactly two members
      (so the pair gets one zero distance + one separation), else the group
      mean.
    - distance = Mahalanobis (when ``metric == 'mahalanobis'`` and the group
      has more than two members and a covariance can be inverted) else the
      Euclidean norm of the difference.

    Args:
        coords: (n_reps, n_dims) array of coordinates in the chosen space.
        metric: Distance metric name.

    Returns:
        List of per-repetition distances (floats).
    """
    import numpy as np

    n = len(coords)
    if n == 2:
        reference = coords[0]
    else:
        reference = np.mean(coords, axis=0)

    if metric == "mahalanobis" and n > 2:
        try:
            from scipy.spatial.distance import mahalanobis
            cov = np.cov(coords, rowvar=False)
            # Add small regularization for numerical stability
            cov += np.eye(cov.shape[0]) * 1e-6
            cov_inv = np.linalg.inv(cov)
            return [mahalanobis(c, reference, cov_inv) for c in coords]
        except Exception:
            # Fall back to Euclidean
            return [float(np.linalg.norm(c - reference)) for c in coords]

    return [float(np.linalg.norm(c - reference)) for c in coords]


def compute_repetition_analysis(
    X,
    sample_ids: list[str] | None,
    metadata,
    pca_result: dict[str, Any] | None,
    umap_result: dict[str, Any] | None,
    y,
    options: dict[str, Any],
) -> dict[str, Any] | None:
    """Compute repetition variability metrics for biological sample repeats.

    Identifies biological samples with multiple measurements (repetitions) and
    computes the variability (distance) between repetitions in various metric
    spaces (PCA, UMAP, Euclidean, Mahalanobis).

    Args:
        X: Processed spectral data (samples x features)
        sample_ids: Optional sample identifiers
        metadata: Optional metadata dict with arrays
        pca_result: PCA projection result (for PCA distance)
        umap_result: UMAP projection result (for UMAP distance)
        y: Target values for coloring
        options: Repetition configuration options:
            - bio_sample_column: Metadata column containing bio sample ID
            - bio_sample_pattern: Regex pattern to extract bio ID from sample_id
            - distance_metric: 'pca', 'umap', 'euclidean', 'mahalanobis'
            - auto_detect: If True, try to auto-detect repetitions

    Returns:
        Repetition analysis dict or None if no repetitions detected
    """
    import re
    from collections import defaultdict

    import numpy as np

    # Get configuration
    bio_sample_column = options.get("bio_sample_column")
    if not bio_sample_column:
        # Dataset-backed playground execution forwards the configured dataset
        # repetition under ``dataset_repetition``. Use it here so repetition
        # analysis stays aligned with the dataset's grouping contract even
        # when raw sample IDs are not present in the request payload.
        bio_sample_column = options.get("dataset_repetition")
    bio_sample_pattern = options.get("bio_sample_pattern")
    auto_detect = options.get("auto_detect_repetitions", True)
    distance_metric = options.get("distance_metric", "pca")

    n_samples = X.shape[0]

    # Normalize sample IDs to match the processed sample count so
    # repetition analysis stays robust after augmentation/filtering.
    if sample_ids is None:
        sample_ids = [f"Sample_{i}" for i in range(n_samples)]
    else:
        normalized_sample_ids = []
        for idx, value in enumerate(sample_ids[:n_samples]):
            normalized_sample_ids.append(f"Sample_{idx}" if value is None else str(value))
        if len(normalized_sample_ids) < n_samples:
            normalized_sample_ids.extend(
                f"Sample_{idx}" for idx in range(len(normalized_sample_ids), n_samples)
            )
        sample_ids = normalized_sample_ids

    # Try to identify biological sample grouping
    bio_sample_map: dict[str, list[int]] = defaultdict(list)

    if bio_sample_column and metadata and bio_sample_column in metadata:
        # Use specified metadata column
        bio_col = metadata[bio_sample_column]
        for idx, bio_id in enumerate(bio_col):
            bio_sample_map[str(bio_id)].append(idx)
    elif auto_detect and metadata:
        from nirs4all.data.repetition_detection import auto_detect_repetition_column

        detected_metadata_column = auto_detect_repetition_column(metadata)
        if detected_metadata_column:
            bio_col = metadata[detected_metadata_column]
            bio_sample_column = detected_metadata_column
            for idx, bio_id in enumerate(bio_col):
                bio_sample_map[str(bio_id)].append(idx)
    elif bio_sample_pattern:
        # Use regex pattern on sample IDs (library-owned grouping semantics)
        from nirs4all.data.repetition_detection import detect_repetition_groups

        try:
            detection = detect_repetition_groups(sample_ids, pattern=bio_sample_pattern)
        except re.error:
            return {"error": f"Invalid regex pattern: {bio_sample_pattern}"}
        for bio_id, indices in detection.groups.items():
            bio_sample_map[bio_id].extend(indices)
    elif auto_detect:
        # Library-owned naming-convention ladder (sample_rep1 / sample_2 / ...)
        from nirs4all.data.repetition_detection import detect_repetition_groups

        detection = detect_repetition_groups(sample_ids)
        if detection.has_repetitions:
            bio_sample_map = defaultdict(list, detection.groups)
        else:
            # No repetitions detected
            return {
                "has_repetitions": False,
                "n_bio_samples": n_samples,
                "n_with_reps": 0,
                "detected_pattern": None,
                "message": "No repetitions detected. Samples appear to be unique."
            }

    # Filter to only bio samples with repetitions
    bio_samples_with_reps = {
        bio_id: indices
        for bio_id, indices in bio_sample_map.items()
        if len(indices) >= 2
    }

    if not bio_samples_with_reps:
        return {
            "has_repetitions": False,
            "n_bio_samples": len(bio_sample_map),
            "n_with_reps": 0,
            "detected_pattern": bio_sample_pattern,
            "message": "No biological samples with repetitions found."
        }

    # Compute distances between repetitions
    data_points = []

    for bio_id, indices in bio_samples_with_reps.items():
        # Get coordinates based on distance metric
        if distance_metric == "pca" and pca_result and "coordinates" in pca_result:
            coords = np.array([pca_result["coordinates"][i] for i in indices])
        elif distance_metric == "umap" and umap_result and "coordinates" in umap_result:
            coords = np.array([umap_result["coordinates"][i] for i in indices])
        elif distance_metric == "mahalanobis":
            # Use full spectral data with covariance
            coords = X[indices]
        else:
            # Default: Euclidean in spectral space
            coords = X[indices]

        # Reference point + distances share a single definition (see
        # _reference_distances): first-rep reference for pairs, group mean
        # otherwise, Mahalanobis or Euclidean per the requested metric.
        distances = _reference_distances(coords, metric=distance_metric)

        # Get y values for this bio sample
        y_values = [float(y[i]) for i in indices] if y is not None else None
        y_mean = float(np.mean(y_values)) if y_values else None

        for rep_idx, (sample_idx, dist) in enumerate(zip(indices, distances)):
            data_points.append({
                "bio_sample": bio_id,
                "rep_index": rep_idx,
                "sample_index": sample_idx,
                "sample_id": sample_ids[sample_idx],
                "distance": dist,
                "y": float(y[sample_idx]) if y is not None else None,
                "y_mean": y_mean,
            })

    # Compute summary statistics
    all_distances = [p["distance"] for p in data_points]
    max_distance = max(all_distances) if all_distances else 0
    mean_distance = float(np.mean(all_distances)) if all_distances else 0

    # Identify high-variability samples (outliers)
    if all_distances:
        distance_threshold = np.percentile(all_distances, 95)
        high_variability = [
            p for p in data_points if p["distance"] > distance_threshold
        ]
    else:
        high_variability = []

    return {
        "has_repetitions": True,
        "n_bio_samples": len(bio_sample_map),
        "n_with_reps": len(bio_samples_with_reps),
        "n_singletons": len(bio_sample_map) - len(bio_samples_with_reps),
        "total_repetitions": sum(len(indices) for indices in bio_samples_with_reps.values()),
        "distance_metric": distance_metric,
        "detected_pattern": bio_sample_pattern,
        "data": data_points,
        "statistics": {
            "mean_distance": mean_distance,
            "max_distance": max_distance,
            "std_distance": float(np.std(all_distances)) if all_distances else 0,
            "p95_distance": float(np.percentile(all_distances, 95)) if all_distances else 0,
        },
        "high_variability_samples": high_variability[:10],  # Top 10 high variability
        "bio_sample_groups": dict(list(bio_samples_with_reps.items())[:50]),  # Limit to 50 for response size
    }


def compute_metrics(
    X,
    pca_result: dict[str, Any] | None = None,
    wavelengths=None,
    requested_metrics: list[str] | None = None,
) -> dict[str, Any]:
    """Compute spectral metrics for each sample.

    Phase 5 Implementation: Spectral Metrics System

    Computes per-sample descriptors for filtering, coloring, and analysis.
    Metrics are organized by category:
    - Amplitude: global_min, global_max, dynamic_range, mean_intensity
    - Energy: l2_norm, rms_energy, auc, abs_auc
    - Shape: baseline_slope, baseline_offset, peak_count, peak_prominence_max
    - Noise: hf_variance, snr_estimate, smoothness
    - Quality: nan_count, inf_count, saturation_count, zero_count
    - Chemometric: hotelling_t2, q_residual, leverage, distance_to_centroid, lof_score

    Args:
        X: Processed spectral data (samples x features)
        pca_result: Pre-computed PCA result (for chemometric metrics)
        wavelengths: Wavelength array (for proper AUC computation)
        requested_metrics: List of specific metrics to compute. If None, computes fast metrics.

    Returns:
        Dict with computed metrics, statistics, and metadata
    """
    n_samples = X.shape[0]

    # Create metrics computer
    computer = MetricsComputer(
        n_pca_components=min(5, n_samples - 1, X.shape[1]),
        lof_n_neighbors=min(20, n_samples - 1),
    )

    # Compute metrics
    metrics_to_compute = requested_metrics if requested_metrics else FAST_METRICS

    # Compute the metrics
    computed = computer.compute(
        X=X,
        metrics=metrics_to_compute,
        pca_result=pca_result,
        wavelengths=wavelengths,
    )

    # Convert numpy arrays to lists for JSON serialization
    metrics_values = {k: v.tolist() for k, v in computed.items()}

    # Compute statistics for each metric
    metrics_stats = {}
    for metric_name, values in computed.items():
        metrics_stats[metric_name] = computer.get_metric_stats(values)

    return {
        "values": metrics_values,
        "statistics": metrics_stats,
        "computed_metrics": list(computed.keys()),
        "available_metrics": list(get_available_metrics().keys()),
        "n_samples": n_samples,
    }
