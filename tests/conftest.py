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
