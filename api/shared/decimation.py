"""
Wavelength decimation utilities for spectral data visualization.

Provides LTTB (Largest-Triangle-Three-Buckets) downsampling that preserves
spectral features (peaks, valleys) better than uniform subsampling.
"""

from __future__ import annotations

def lttb_decimate(x, y, target_points: int):
    """Downsample using Largest-Triangle-Three-Buckets (LTTB) algorithm.

    LTTB preserves visual features (peaks, valleys, inflection points) by
    selecting points that maximize triangle area with neighboring buckets.
    This is superior to uniform subsampling for spectral data visualization.

    Args:
        x: X-axis values (e.g., wavelengths). Shape (n,).
        y: Y-axis values (e.g., mean absorbance). Shape (n,).
        target_points: Number of points to keep.

    Returns:
        Array of selected indices, sorted in ascending order. Shape (target_points,).
    """
    import numpy as np
    n = len(x)
    if n <= target_points or target_points < 3:
        return np.arange(n)

    # Always keep first and last point
    indices = np.empty(target_points, dtype=np.intp)
    indices[0] = 0
    indices[-1] = n - 1

    bucket_size = (n - 2) / (target_points - 2)

    a_idx = 0  # Previously selected point index

    for i in range(1, target_points - 1):
        # Current bucket range
        bucket_start = int(1 + (i - 1) * bucket_size)
        bucket_end = int(1 + i * bucket_size)
        if bucket_end > n - 1:
            bucket_end = n - 1

        # Next bucket range (for computing average)
        next_start = bucket_end
        next_end = int(1 + (i + 1) * bucket_size)
        if next_end > n - 1:
            next_end = n - 1
        # Ensure at least one point in next bucket
        if next_start >= next_end:
            next_end = next_start + 1
            if next_end > n:
                next_end = n

        # Average of next bucket
        avg_x = np.mean(x[next_start:next_end])
        avg_y = np.mean(y[next_start:next_end])

        # Vectorized triangle area computation for current bucket
        # Area = |( (x[a] - avg_x) * (y[j] - y[a]) ) - ( (x[a] - x[j]) * (avg_y - y[a]) )|
        x_a = x[a_idx]
        y_a = y[a_idx]

        bucket_x = x[bucket_start:bucket_end]
        bucket_y = y[bucket_start:bucket_end]

        areas = np.abs(
            (x_a - avg_x) * (bucket_y - y_a) - (x_a - bucket_x) * (avg_y - y_a)
        )

        max_idx = bucket_start + np.argmax(areas)
        indices[i] = max_idx
        a_idx = max_idx

    return indices


def decimate_wavelengths(
    wavelengths,
    spectra,
    target_points: int,
):
    """Select wavelength indices using LTTB on the mean spectrum.

    Computes the mean spectrum across all samples, then applies LTTB to
    determine which wavelength indices best preserve the visual shape.
    The same indices are then applied to all spectra uniformly.

    Args:
        wavelengths: Wavelength values. Length must match spectra columns.
        spectra: Spectral data, shape (n_samples, n_wavelengths).
        target_points: Number of wavelengths to keep.

    Returns:
        Sorted array of selected wavelength indices.
    """
    import numpy as np
    wl = np.asarray(wavelengths, dtype=np.float64)
    mean_spectrum = np.mean(spectra, axis=0)
    return lttb_decimate(wl, mean_spectrum, target_points)
