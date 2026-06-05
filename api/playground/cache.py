"""Caching for the playground API.

A single :class:`TTLCache` backs both caching needs of the playground:

- the whole-response cache (keyed by a request fingerprint), bounded by an
  entry count, and
- the step-level prefix cache (keyed by a data fingerprint + step prefix),
  bounded by an approximate byte budget so long pipelines cannot blow up
  memory.

Both share one TTL+LRU eviction implementation instead of two hand-rolled
copies. Eviction is O(1) amortized: entries are kept in insertion/touch order
via an ``OrderedDict``, so the oldest entry is always at the front (no O(n)
``min()`` scan).
"""

from __future__ import annotations

import hashlib
import json
import sys
import time
from collections import OrderedDict
from typing import Any, Callable


class TTLCache:
    """TTL + LRU cache with optional max-entries and/or byte-budget bounds.

    Args:
        ttl_seconds: Entry lifetime; expired entries are dropped on access/insert.
        max_entries: Optional cap on number of entries.
        max_bytes: Optional cap on total estimated byte size.
        sizer: Callable returning the estimated byte size of a value; required
            when ``max_bytes`` is set.
    """

    def __init__(
        self,
        *,
        ttl_seconds: int = 300,
        max_entries: int | None = None,
        max_bytes: int | None = None,
        sizer: Callable[[Any], int] | None = None,
    ):
        self._entries: OrderedDict[str, tuple[float, Any]] = OrderedDict()
        self._sizes: dict[str, int] = {}
        self._total_bytes = 0
        self._ttl_seconds = ttl_seconds
        self._max_entries = max_entries
        self._max_bytes = max_bytes
        self._sizer = sizer

    def get(self, key: str) -> Any | None:
        """Return the cached value if present and not expired, else None."""
        entry = self._entries.get(key)
        if entry is None:
            return None
        ts, value = entry
        if time.time() - ts >= self._ttl_seconds:
            self._evict(key)
            return None
        # Touch for LRU: move to the end and refresh timestamp.
        self._entries.move_to_end(key)
        self._entries[key] = (time.time(), value)
        return value

    def set(self, key: str, value: Any) -> None:
        """Store ``value`` under ``key``, evicting expired/over-budget entries."""
        now = time.time()

        # Drop expired entries first.
        expired = [k for k, (ts, _) in self._entries.items() if now - ts >= self._ttl_seconds]
        for k in expired:
            self._evict(k)

        if key in self._entries:
            self._evict(key)

        size = self._sizer(value) if self._sizer is not None else 0

        if self._max_bytes is not None:
            while self._total_bytes + size > self._max_bytes and self._entries:
                self._evict(next(iter(self._entries)))

        if self._max_entries is not None:
            while len(self._entries) >= self._max_entries and self._entries:
                self._evict(next(iter(self._entries)))

        self._entries[key] = (now, value)
        self._entries.move_to_end(key)
        if self._sizer is not None:
            self._sizes[key] = size
            self._total_bytes += size

    def _evict(self, key: str) -> None:
        if key in self._entries:
            del self._entries[key]
            self._total_bytes -= self._sizes.pop(key, 0)

    def clear(self) -> None:
        self._entries.clear()
        self._sizes.clear()
        self._total_bytes = 0


def _estimate_state_size(state: dict) -> int:
    """Estimate the byte size of a cached step-prefix state dict."""
    import numpy as np
    size = 0
    for v in state.values():
        if isinstance(v, np.ndarray):
            size += v.nbytes
        elif isinstance(v, (list, dict)):
            size += sys.getsizeof(v)
    return max(size, 64)  # minimum 64 bytes per entry


# Whole-response cache: bounded by entry count.
_response_cache: TTLCache = TTLCache(ttl_seconds=300, max_entries=100)

# Step-level prefix cache: bounded by an approximate memory budget.
_step_cache: TTLCache = TTLCache(
    ttl_seconds=300,
    max_bytes=200 * 1024 * 1024,
    sizer=_estimate_state_size,
)


def get_cached_response(cache_key: str):
    """Get a cached whole-response, or None if absent/expired."""
    return _response_cache.get(cache_key)


def set_cached_response(cache_key: str, result) -> None:
    """Cache a whole-response."""
    _response_cache.set(cache_key, result)


def _step_signature(steps: list) -> list:
    """Stable identity tuple for each step (id, name, params)."""
    return [(s.id, s.name, json.dumps(s.params, sort_keys=True)) for s in steps]


def compute_cache_key(data, steps: list, options: dict[str, Any]) -> str:
    """Compute the whole-response cache key for a raw-data request.

    Uses a fingerprint of the data (shape + sampled values) to detect
    identical datasets while avoiding hash collisions.
    """
    n_samples = len(data.x)
    n_features = len(data.x[0]) if data.x else 0

    # Use more samples for fingerprinting to reduce collisions.
    # Sample first, middle, and last samples, plus some distributed positions.
    sample_indices = [0]
    if n_samples > 1:
        sample_indices.append(n_samples - 1)
    if n_samples > 2:
        sample_indices.append(n_samples // 2)
    if n_samples > 10:
        sample_indices.extend([n_samples // 4, 3 * n_samples // 4])

    # Use every Nth feature for efficiency with high-dimensional data.
    fingerprint_samples = []
    for idx in sample_indices[:5]:  # Limit to 5 samples max
        if idx < n_samples:
            sample = data.x[idx]
            subsampled = [round(sample[i], 6) for i in range(0, len(sample), max(1, n_features // 100))]
            fingerprint_samples.append(subsampled)

    y_fingerprint = None
    if data.y:
        y_fingerprint = {
            "len": len(data.y),
            "sum": round(sum(data.y), 4),
            "first": round(data.y[0], 4) if data.y else None,
            "last": round(data.y[-1], 4) if data.y else None,
        }

    key_data = {
        "data_shape": [n_samples, n_features],
        "data_fingerprint": fingerprint_samples,
        "y_fingerprint": y_fingerprint,
        "steps": [(s.id, s.name, s.enabled, json.dumps(s.params, sort_keys=True)) for s in steps],
        "options": json.dumps(options, sort_keys=True),
    }
    return hashlib.md5(json.dumps(key_data, sort_keys=True).encode()).hexdigest()


def compute_dataset_cache_key(dataset_id: str, steps: list, options: dict[str, Any]) -> str:
    """Compute the whole-response cache key for a dataset-ref request.

    Uses dataset_id directly instead of fingerprinting data arrays.
    """
    key_data = {
        "dataset_id": dataset_id,
        "steps": [(s.id, s.name, s.enabled, json.dumps(s.params, sort_keys=True)) for s in steps],
        "options": json.dumps(options, sort_keys=True),
    }
    return hashlib.md5(json.dumps(key_data, sort_keys=True).encode()).hexdigest()


def compute_prefix_key(data_fingerprint: str, steps: list) -> str:
    """Compute the step-cache key for a pipeline prefix.

    Args:
        data_fingerprint: Hash identifying the input data.
        steps: Pipeline steps up to and including the target step.

    Returns:
        MD5 hex digest as cache key.
    """
    raw = f"{data_fingerprint}:{json.dumps(_step_signature(steps), sort_keys=True)}"
    return hashlib.md5(raw.encode()).hexdigest()


def compute_data_fingerprint(X) -> str:
    """Compute a lightweight fingerprint of a numpy data array.

    Uses shape + first/last row bytes for fast identification without
    hashing the entire array.
    """
    parts = [f"{X.shape[0]}x{X.shape[1]}"]
    if X.shape[0] > 0:
        parts.append(X[0, :min(10, X.shape[1])].tobytes().hex()[:32])
    if X.shape[0] > 1:
        parts.append(X[-1, :min(10, X.shape[1])].tobytes().hex()[:32])
    return hashlib.md5(":".join(parts).encode()).hexdigest()
