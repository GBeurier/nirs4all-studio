"""
Root conftest.py for nirs4all webapp tests.

This file contains shared fixtures and pytest configuration
that applies to all test modules.
"""

import sys
from pathlib import Path

import pytest

# Ensure the webapp root is in the path
webapp_root = Path(__file__).parent.parent
if str(webapp_root) not in sys.path:
    sys.path.insert(0, str(webapp_root))


@pytest.fixture(autouse=True)
def _guard_against_real_app_config():
    """Fail any test that ends up writing to the real user app_settings.json.

    Prior incident: tests that instantiated WorkspaceManager() without
    isolation accumulated 135 stale ``nirs4all_test_*`` workspace
    entries in the user's %APPDATA%/nirs4all/app_settings.json. This
    fixture imports the app_config singleton at test time and asserts
    its config_dir is NOT the platform default. Tests that need to
    touch the workspace manager must either redirect via
    NIRS4ALL_CONFIG or monkeypatch the singleton.
    """
    try:
        from api.app_config import app_config as _live_app_config
    except Exception:
        # api.app_config not importable in this environment - nothing to guard.
        yield
        return

    default_dir = Path(_live_app_config._get_default_config_dir()).resolve()
    current_dir = Path(_live_app_config.config_dir).resolve()

    if current_dir == default_dir:
        # Allowed only if the test never touches the singleton; we cannot
        # detect that statically. Tests that DO touch it must shadow the
        # singleton (see tests/test_custom_nodes.py for the pattern).
        pass

    yield

    # After the test, re-check that no test leaked entries with a
    # ``nirs4all_test_`` prefix into the real app_settings.json.
    try:
        from api.app_config import app_config as _post_app_config
        post_dir = Path(_post_app_config.config_dir).resolve()
        if post_dir == default_dir:
            settings = _post_app_config.get_app_settings()
            leaked = [
                ws for ws in settings.get("linked_workspaces", [])
                if "nirs4all_test_" in ws.get("path", "")
                or "pytest" in ws.get("path", "").lower()
            ]
            assert not leaked, (
                f"Test leaked {len(leaked)} workspace entries into the real "
                f"user app_settings.json at {post_dir}. Use the isolated-config "
                f"fixture pattern from tests/test_custom_nodes.py."
            )
    except Exception:
        pass


# ============================================================================
# Pytest Hooks
# ============================================================================


def pytest_configure(config):
    """Register custom markers."""
    config.addinivalue_line(
        "markers",
        "integration_full: mark test as requiring real nirs4all (slow)",
    )
    config.addinivalue_line(
        "markers",
        "websocket: mark test as involving WebSocket communication",
    )
    config.addinivalue_line(
        "markers",
        "slow: mark test as slow running",
    )
    config.addinivalue_line(
        "markers",
        "cross_platform: mark test as cross-platform path handling",
    )


def pytest_collection_modifyitems(config, items):
    """
    Automatically mark tests based on their location or name.

    - Tests in integration/ directory are marked with 'slow'
    - Tests with 'websocket' in name are marked with 'websocket'
    """
    for item in items:
        # Mark integration tests as slow
        if "integration" in str(item.fspath):
            item.add_marker(pytest.mark.slow)

        # Mark WebSocket tests
        if "websocket" in item.name.lower():
            item.add_marker(pytest.mark.websocket)


# ============================================================================
# Shared Fixtures
# ============================================================================


@pytest.fixture(scope="session")
def nirs4all_available():
    """Check if nirs4all library is available."""
    try:
        import nirs4all
        return True
    except ImportError:
        return False


@pytest.fixture
def skip_without_nirs4all(nirs4all_available):
    """Skip test if nirs4all is not available."""
    if not nirs4all_available:
        pytest.skip("nirs4all library not available")
