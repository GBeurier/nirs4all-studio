"""Playground API package.

Real-time spectral pipeline preview for the studio UI. The package is split
into focused modules:

- ``models``        — Pydantic request/response contracts.
- ``cache``         — unified TTL/LRU cache (whole-response + step-prefix).
- ``serialization`` — MessagePack/JSON response negotiation.
- ``steps``         — per-step executors (sampling/preprocessing/aug/filter/split).
- ``charts``        — stats / PCA / UMAP / repetition / metrics computations.
- ``executor``      — ``PlaygroundExecutor`` orchestration.
- ``routes``        — FastAPI router and endpoints.

``api.playground.router`` is the package's public surface (imported by
``main``).
"""

from .routes import router

__all__ = ["router"]
