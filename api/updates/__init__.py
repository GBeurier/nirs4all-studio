"""
Update management API for nirs4all webapp.

This package provides API endpoints for:
- Checking for updates (webapp via GitHub, nirs4all via PyPI)
- Inspecting the current Python runtime
- Downloading and applying webapp updates
- Installing/upgrading nirs4all and optional dependencies in the current runtime
- Capturing and restoring pip-freeze config snapshots

The module is split across focused submodules (``catalog``, ``manager``,
``app_updates``, ``dependencies``, ``snapshots``). Shared state and helpers are
bound at this package level so the endpoint submodules and the test suite can
reach them as ``api.updates.<name>`` — patching ``api.updates.venv_manager`` /
``api.updates._dependencies_cache`` takes effect across all submodules.
"""

import platform  # noqa: F401  (re-exported for test patching: updates_module.platform)

from fastapi import APIRouter

# ``_user_data_dir`` is re-exported so tests can patch ``api.updates._user_data_dir``
# and have ``UpdateManager`` / ``DependenciesCache`` honor it (see catalog._resolve_user_data_dir).
from ..venv_manager import _user_data_dir  # noqa: F401

# Endpoint submodules import ``api.updates`` (this package) for shared state,
# but only access ``api.updates.<name>`` at request time — so importing them
# here (before the re-exports below) is safe; their routers are aggregated at
# the bottom. Runtime guards live in ``dependencies`` and are referenced as
# ``api.updates._ensure_runtime_*`` by the mutating endpoints.
from . import app_updates, dependencies, snapshots  # noqa: E402

# Shared state, catalog, models, and helpers re-exported at the package level so
# the endpoint submodules' ``from api import updates as _u`` references and the
# test suite's ``api.updates.<name>`` patches resolve here.
from .catalog import (  # noqa: F401
    APP_AUTHOR,
    APP_NAME,
    NIRS4ALL_OPTIONAL_DEPS,
    PROFILE_MANAGED_DEPENDENCIES,
    RESTART_REQUIRED_PACKAGES,
    DependenciesCache,
    DependenciesResponse,
    DependencyCategory,
    DependencyInfo,
    PackageInstallRequest,
    PackageUninstallRequest,
    _dependencies_cache,
    _is_profile_managed_dependency,
    _load_optional_deps_from_config,
    _normalize_dependency_name,
    _resolve_user_data_dir,
    logger,
)
from .dependencies import (  # noqa: E402, F401
    _ensure_runtime_is_valid,
    _ensure_runtime_mutable,
    _get_pypi_version,
    get_dependencies,
    install_dependency,
    refresh_dependencies,
    revert_dependency,
    uninstall_dependency,
    update_dependency,
)
from .manager import (  # noqa: F401
    DEFAULT_CHECK_INTERVAL_HOURS,
    DEFAULT_GITHUB_REPO,
    DEFAULT_PYPI_PACKAGE,
    HTTPX_AVAILABLE,
    InstallRequest,
    Nirs4allUpdateInfo,
    UpdateManager,
    UpdateSettings,
    UpdateStatus,
    WebappUpdateInfo,
    _describe_exception,
    _is_expected_update_transport_error,
    _is_offline_update_error,
    get_update_manager,
    update_manager,
    venv_manager,
)
from .staging import (  # noqa: F401
    STAGED_UPDATE_METADATA_FILE,
    StagedUpdateLayout,
    _expected_update_mode,
    _is_portable_runtime,
    _read_staged_update_metadata,
    _resolve_staged_content_dir,
    _staging_entries,
    _validate_staged_update_layout,
    _write_staged_update_metadata,
)

router = APIRouter(prefix="/updates", tags=["updates"])
router.include_router(app_updates.router)
router.include_router(dependencies.router)
router.include_router(snapshots.router)
