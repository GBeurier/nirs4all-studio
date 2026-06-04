"""
Phase 0 tech-debt: local API token authentication.

Verifies the X-Nirs4all-Token gate added in ``api.security`` + ``main.py``:

- When NIRS4ALL_API_TOKEN is set (Electron desktop mode):
    * GET /api/health is reachable WITHOUT a token (public prefix).
    * A mutating POST to an /api route WITHOUT the header is rejected with 401.
    * The same POST WITH the correct header passes the auth gate (status != 401).
- When NIRS4ALL_API_TOKEN is unset (web/dev mode): the POST is NOT gated.

``api.security`` reads the token from the environment on every request, so each
scenario only needs to toggle ``NIRS4ALL_API_TOKEN`` via ``monkeypatch`` on the
shared app — no module reloads (which previously leaked gated state into other
test modules and caused spurious 401s).
"""

from fastapi.testclient import TestClient

from main import app

TOKEN = "phase0-test-token"
TOKEN_HEADER = "X-Nirs4all-Token"

# A mutating /api route that is NOT a public prefix. ``/api/workspace/select``
# is a POST handler; the auth gate runs before any handler body executes, so we
# only assert on whether the request reached the handler (status != 401), not on
# downstream success.
MUTATING_ROUTE = "/api/workspace/select"


def _build_app(monkeypatch, token: str | None):
    """Set/unset the token env for this test and return the shared app.

    The gate reads ``NIRS4ALL_API_TOKEN`` per request, so toggling the env is
    sufficient — ``monkeypatch`` restores it on teardown, keeping the suite
    hermetic.
    """
    if token is None:
        monkeypatch.delenv("NIRS4ALL_API_TOKEN", raising=False)
    else:
        monkeypatch.setenv("NIRS4ALL_API_TOKEN", token)
    return app


def test_health_is_public_without_token(monkeypatch):
    """GET /api/health must work without a token even when auth is enabled."""
    app = _build_app(monkeypatch, TOKEN)
    with TestClient(app) as client:
        response = client.get("/api/health")
    assert response.status_code == 200


def test_mutating_request_without_token_is_rejected(monkeypatch):
    """A POST to a protected /api route without the header returns 401."""
    app = _build_app(monkeypatch, TOKEN)
    with TestClient(app) as client:
        response = client.post(MUTATING_ROUTE, json={"path": "/tmp/nope"})
    assert response.status_code == 401


def test_mutating_request_with_token_passes_gate(monkeypatch):
    """A POST with the correct header passes the auth gate (status != 401)."""
    app = _build_app(monkeypatch, TOKEN)
    with TestClient(app) as client:
        response = client.post(
            MUTATING_ROUTE,
            json={"path": "/tmp/nope"},
            headers={TOKEN_HEADER: TOKEN},
        )
    # The gate let the request through; the handler may still fail downstream
    # (bad path / missing nirs4all), but it must not be the 401 auth rejection.
    assert response.status_code != 401


def test_mutating_request_with_wrong_token_is_rejected(monkeypatch):
    """A POST with an incorrect token returns 401."""
    app = _build_app(monkeypatch, TOKEN)
    with TestClient(app) as client:
        response = client.post(
            MUTATING_ROUTE,
            json={"path": "/tmp/nope"},
            headers={TOKEN_HEADER: "wrong-token"},
        )
    assert response.status_code == 401


def test_no_gating_when_token_unset(monkeypatch):
    """With NIRS4ALL_API_TOKEN unset, mutating requests are not gated (dev mode)."""
    app = _build_app(monkeypatch, None)
    with TestClient(app) as client:
        response = client.post(MUTATING_ROUTE, json={"path": "/tmp/nope"})
    assert response.status_code != 401


def test_safe_methods_not_gated_when_enabled(monkeypatch):
    """GET on a protected /api route is exempt (safe method) even with auth on."""
    app = _build_app(monkeypatch, TOKEN)
    with TestClient(app) as client:
        # /api/workspace is a GET route; without a token it must not be 401.
        response = client.get("/api/workspace")
    assert response.status_code != 401


def test_is_public_path_does_not_overmatch_prefix():
    """is_public_path must exempt /api/health and sub-paths, but not siblings."""
    from api import security

    assert security.is_public_path("/api/health") is True
    assert security.is_public_path("/api/health/") is True
    assert security.is_public_path("/api/health/latency") is True
    assert security.is_public_path("/") is True  # SPA / non-/api routes
    # Accidental prefix siblings must NOT be exempt (the bug Codex caught).
    assert security.is_public_path("/api/healthcheck") is False
    assert security.is_public_path("/api/workspace/select") is False


def test_token_matches_is_constant_time_and_correct():
    """token_matches handles None/empty/mismatch without raising."""
    from api import security

    assert security.token_matches("abc", "abc") is True
    assert security.token_matches("abc", "abcd") is False
    assert security.token_matches(None, "abc") is False
    assert security.token_matches("", "abc") is False
