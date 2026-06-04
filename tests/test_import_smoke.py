"""
Import-smoke test for the FastAPI backend.

This is the test that would have caught "dead-at-runtime" endpoints: handlers
that import-resolve fine at module load (so the server boots) but reference
helpers that no longer exist, raising NameError/ImportError/AttributeError only
when the request hits the function body.

Coverage:
1. ``main.py`` imports without error (boots the whole app graph).
2. Every router module under ``api/`` imports without error.
3. Every FastAPI ``APIRoute`` endpoint resolves (the callable can be referenced).
   This catches handlers that vanished from a module but are still wired into
   the app, and module-scope NameErrors.

Module-level import + endpoint resolution can NOT catch dead references that
live *inside* a handler body (deferred imports, bare names used only at call
time). Those are documented as ``xfail`` placeholders below so the regression
that introduced them is recorded; they flip to passing once Phase 1 restores
the missing helpers.
"""

import importlib
import pkgutil

import pytest
from fastapi.routing import APIRoute

# Heavy / optional third-party packages that the backend imports at module
# scope but that CI does not install (the scientific stack + the optional
# nirs4all library). When a module fails to import *only* because one of these
# is absent, we skip rather than fail — the endpoints guard nirs4all usage and
# the UI runs without it. Any other ImportError (a missing first-party symbol),
# NameError, or AttributeError is a real code bug and must fail the suite.
# Locally (nirs4all + numpy + sklearn installed) nothing is skipped, so the
# full module graph is exercised.
OPTIONAL_DEPENDENCIES = frozenset(
    {
        "nirs4all",
        "numpy",
        "scipy",
        "pandas",
        "sklearn",
        "matplotlib",
        "tensorflow",
        "keras",
        "torch",
        "shap",
        "joblib",
    }
)


def _missing_optional_dependency(exc: ImportError) -> str | None:
    """Return the optional package name if ``exc`` is a missing optional dep.

    Args:
        exc: The import error raised while importing a backend module.

    Returns:
        The top-level package name when the import failed solely because an
        optional/heavy dependency is absent, otherwise ``None`` (signalling a
        genuine code-level failure that must be re-raised).
    """
    missing = getattr(exc, "name", None)
    if not missing:
        return None
    top_level = missing.split(".", 1)[0]
    return top_level if top_level in OPTIONAL_DEPENDENCIES else None


def _router_module_names() -> list[str]:
    """Discover every importable module under the ``api`` package.

    Returns:
        Fully-qualified module names (e.g. ``api.workspace``), excluding
        the package ``__init__`` which is imported implicitly.
    """
    import api

    names: list[str] = []
    for module_info in pkgutil.walk_packages(api.__path__, prefix="api."):
        names.append(module_info.name)
    return sorted(names)


API_MODULE_NAMES = _router_module_names()


def test_main_module_imports():
    """``main.py`` (and therefore the whole router graph) imports cleanly."""
    try:
        main = importlib.import_module("main")
    except ImportError as exc:
        missing = _missing_optional_dependency(exc)
        if missing is None:
            raise
        pytest.skip(f"optional dependency '{missing}' not installed")
    assert main.app is not None


@pytest.mark.parametrize("module_name", API_MODULE_NAMES)
def test_api_module_imports(module_name: str):
    """Every module under ``api/`` imports without error.

    A missing optional/heavy dependency (the scientific stack or nirs4all)
    skips the case; any other import failure is a real bug and fails.
    """
    try:
        module = importlib.import_module(module_name)
    except ImportError as exc:
        missing = _missing_optional_dependency(exc)
        if missing is None:
            raise
        pytest.skip(f"optional dependency '{missing}' not installed")
    assert module is not None


def test_every_api_route_endpoint_resolves():
    """Each ``APIRoute`` endpoint is a resolvable callable.

    Walks ``app.routes`` and asserts every route handler is callable. This
    catches routes wired to a handler that no longer exists at module scope
    (a NameError/ImportError would surface here at collection time).
    """
    try:
        main = importlib.import_module("main")
    except ImportError as exc:
        missing = _missing_optional_dependency(exc)
        if missing is None:
            raise
        pytest.skip(f"optional dependency '{missing}' not installed")

    unresolved: list[str] = []
    for route in main.app.routes:
        if not isinstance(route, APIRoute):
            continue
        endpoint = getattr(route, "endpoint", None)
        if not callable(endpoint):
            unresolved.append(f"{route.path} -> {endpoint!r}")

    assert not unresolved, f"Unresolved route endpoints: {unresolved}"


# ============================================================================
# Phase 1a resolved the four previously dead-at-runtime endpoints:
#   - /evaluation/* and /predictions/{confidence,explain} and
#     /playground/metrics/outliers were deleted (unused by the UI), and
#   - /analysis/shap/compute was routed through nirs4all's ShapAnalyzer.
# The route-resolution test above now covers every remaining endpoint. The one
# standalone guard kept is that the SHAP analyzer symbol resolves, since its
# absence (a bare undefined `ShapAnalyzer()`) was the original NameError bug.
# ============================================================================


def test_shap_analyzer_symbol_resolves():
    """api/shap.py must expose a ShapAnalyzer symbol (was an undefined name -> NameError)."""
    import api.shap

    assert hasattr(api.shap, "ShapAnalyzer")
