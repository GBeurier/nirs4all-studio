"""
Local API authentication for the nirs4all Studio backend.

The desktop (Electron) shell spawns this backend on a random localhost port and
passes a per-launch secret via the ``NIRS4ALL_API_TOKEN`` environment variable.
Every state-changing request from the renderer must then echo that secret in the
``X-Nirs4all-Token`` header, closing the "any local process can drive the API"
hole that an unauthenticated, permissively-CORS'd localhost server otherwise
leaves open.

When ``NIRS4ALL_API_TOKEN`` is unset (web/dev mode, where the backend is reached
only through the Vite proxy) the gate is a no-op, preserving the existing
developer workflow.
"""

import os
import secrets

from fastapi import HTTPException, Request

# Header the renderer attaches to authenticate against the spawned backend.
API_TOKEN_HEADER = "X-Nirs4all-Token"

# Environment variable carrying the per-launch secret. The Electron
# backend-manager injects this into the spawned backend's environment.
API_TOKEN_ENV = "NIRS4ALL_API_TOKEN"


def current_token() -> str | None:
    """Return the active per-launch token, or ``None`` when auth is disabled.

    Read from the environment on every call (rather than cached at import) so
    that the gate reflects the current process state — this keeps tests
    hermetic (``monkeypatch.setenv``/``delenv`` take effect immediately, with no
    module reloads or leaked global state) and matches the runtime contract
    where Electron sets the variable before the backend process starts.
    """
    return os.environ.get(API_TOKEN_ENV) or None


# HTTP methods that never mutate state and are therefore exempt from the gate.
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})

# Path prefixes that must remain reachable without a token: health check, the
# auto-generated docs, and the OpenAPI schema. Anything not under ``/api`` (the
# SPA, static assets, icons) is also exempt and handled by ``is_public_path``.
PUBLIC_PATH_PREFIXES = (
    "/api/health",
    "/docs",
    "/openapi.json",
    "/redoc",
)


def auth_enabled() -> bool:
    """Return whether token authentication is active for this process."""
    return current_token() is not None


def is_public_path(path: str) -> bool:
    """Return whether ``path`` is exempt from token authentication.

    Exempt paths are: anything outside ``/api`` (SPA routes, static assets) and
    the explicitly public ``/api`` prefixes (health, docs, OpenAPI schema).
    """
    if not path.startswith("/api"):
        return True
    # Exact match or a sub-path (``/api/health`` and ``/api/health/...``), but
    # NOT an accidental prefix sibling like ``/api/healthcheck``.
    return any(path == prefix or path.startswith(prefix + "/") for prefix in PUBLIC_PATH_PREFIXES)


def token_matches(provided: str | None, token: str) -> bool:
    """Constant-time comparison of a presented token against the active one."""
    return secrets.compare_digest(provided or "", token)


def require_token(request: Request) -> None:
    """Reject a request whose ``X-Nirs4all-Token`` header does not match.

    No-op when authentication is disabled. Intended to be called from the
    middleware after the caller has already confirmed the request targets a
    protected, state-changing ``/api`` route.

    Raises:
        HTTPException: 401 when the header is missing or does not match the
            configured token.
    """
    token = current_token()
    if token is None:
        return
    if not token_matches(request.headers.get(API_TOKEN_HEADER), token):
        raise HTTPException(status_code=401, detail="Invalid or missing API token")
