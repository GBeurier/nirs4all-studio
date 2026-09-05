"""Stdlib-only ctypes provider shim for the dag-ml-data C ABI.

This package is a thin, modality-neutral wrapper over the Rust C ABI provider
vtable (`dag-ml-data-capi`). It implements no NIRS, ML, or scheduling logic; it
only hands JSON payloads and host buffers to Rust and decodes the results.
"""

from __future__ import annotations

from ._library import find_capi_library, load_library
from ._provider import InMemoryProvider

__all__ = ["InMemoryProvider", "find_capi_library", "load_library", "__version__"]

__version__ = "0.2.11"
