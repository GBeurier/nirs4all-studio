"""
Root conftest.py for nirs4all webapp tests.

This file contains shared fixtures and pytest configuration
that applies to all test modules.
"""

import os
import sys
import tempfile
import time
from pathlib import Path

import pytest

# Never let a developer or CI host's telemetry configuration turn test failures
# into production Sentry issues. This must run before test modules import main.py.
os.environ["SENTRY_DSN"] = ""

# Isolate before collection: several modules create their config singleton at
# import time, before an autouse fixture can redirect it. Each xdist worker gets
# its own directory, including when the caller has a real NIRS4ALL_CONFIG set.
_test_config = tempfile.TemporaryDirectory(prefix="studio-pytest-config-")
os.environ["NIRS4ALL_CONFIG"] = _test_config.name

# Ensure the webapp root is in the path
webapp_root = Path(__file__).parent.parent
if str(webapp_root) not in sys.path:
    sys.path.insert(0, str(webapp_root))

# Ensure the nirs4all core checkout is importable in every worker. Some focused
# integration tests monkeypatch nirs4all.run directly, so this cannot depend on
# another test module having already adjusted sys.path.
for nirs4all_path in (
    webapp_root.parent / "nirs4all",
    webapp_root.parent / "RC-v1-nirs4all-python",
    webapp_root.parent.parent / "nirs4all",
):
    if nirs4all_path.exists():
        if str(nirs4all_path) not in sys.path:
            sys.path.insert(0, str(nirs4all_path))
        break


@pytest.fixture(autouse=True)
def _drain_background_jobs():
    """Ensure no background job outlives its test.

    Run/training execution happens on the shared JobManager thread pool. A
    worker that outlives its test would keep writing run manifests and store
    entries into the NEXT test's freshly created workspace (the pool threads
    are long-lived, so joining threads is not an option). Cancel anything still
    active at teardown and wait for it to drain.
    """
    yield

    try:
        from api.jobs.manager import JobStatus, job_manager
    except Exception:
        return

    deadline = time.time() + 15.0
    active = []
    while time.time() < deadline:
        active = [
            j
            for j in job_manager.list_jobs(limit=1000)
            if j.status in (JobStatus.PENDING, JobStatus.RUNNING)
        ]
        if not active:
            return
        for job in active:
            job_manager.cancel_job(job.id)
        time.sleep(0.05)

    raise RuntimeError(
        f"Background jobs still active 15s after test teardown: {[j.id for j in active]}"
    )


@pytest.fixture(autouse=True)
def _guard_against_real_app_config():
    """Reject a singleton redirected back to the user's real configuration."""
    _assert_config_is_isolated()
    yield
    _assert_config_is_isolated()


def _assert_config_is_isolated():
    from api.app_config import app_config

    current_dir = Path(app_config.config_dir).resolve()
    default_dir = Path(app_config._get_default_config_dir()).resolve()
    assert current_dir != default_dir, (
        f"Test configuration points at the real user directory {default_dir}. "
        "Redirect NIRS4ALL_CONFIG before creating an AppConfigManager."
    )


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
        import nirs4all  # noqa: F401 (availability probe)
        return True
    except ImportError:
        return False


@pytest.fixture
def skip_without_nirs4all(nirs4all_available):
    """Skip test if nirs4all is not available."""
    if not nirs4all_available:
        pytest.skip("nirs4all library not available")
