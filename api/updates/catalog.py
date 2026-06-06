"""
nirs4all optional-dependency catalog, request/response models, and the
dependency-scan cache.

This is the dependency-management data layer: the catalog definition (sourced
from ``recommended-config.json``), the Pydantic request/response shapes, and the
on-disk scan cache. It is independent of the update-check polling in
``manager`` and is imported by both ``manager`` and the ``dependencies``
endpoints.
"""

import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from ..shared.logger import get_logger
from ..venv_manager import _user_data_dir

# Logger name kept as ``api.updates`` (the package) so callers and tests that
# capture the ``api.updates`` logger see records emitted from this submodule.
logger = get_logger("api.updates")

# App identification
APP_NAME = "nirs4all-webapp"
APP_AUTHOR = "nirs4all"

# Packages that require a backend restart after install/update/uninstall
RESTART_REQUIRED_PACKAGES = {
    "nirs4all", "numpy", "scipy", "scikit-learn", "pandas",
    "pydantic", "fastapi", "uvicorn",
}
PROFILE_MANAGED_DEPENDENCIES = {"torch"}


def _resolve_user_data_dir(app_name: str, app_author: str) -> str:
    """Resolve the user-data dir via the ``api.updates`` package binding.

    Reading through the package lets tests patch ``api.updates._user_data_dir``
    and have it take effect for ``UpdateManager`` / ``DependenciesCache``. During
    package initialization the binding may not exist yet, so fall back to the
    real ``venv_manager._user_data_dir`` imported here.
    """
    import sys as _sys

    pkg = _sys.modules.get("api.updates")
    resolver = getattr(pkg, "_user_data_dir", _user_data_dir)
    return resolver(app_name, app_author)


# ============= nirs4all Optional Dependencies Definition =============


def _normalize_dependency_name(name: str) -> str:
    """Normalize dependency names for comparisons."""
    return name.replace("-", "_").lower()


def _is_profile_managed_dependency(name: str) -> bool:
    """Return whether a dependency is managed by the compute profile."""
    return _normalize_dependency_name(name) in PROFILE_MANAGED_DEPENDENCIES


def _show_optional_when_profile_managed(pkg_data: dict[str, Any]) -> bool:
    """Return whether a profile-managed optional package should stay visible."""
    return bool(pkg_data.get("show_when_profile_managed", False))


def _load_optional_deps_from_config() -> dict[str, Any]:
    """Load optional dependencies from recommended-config.json.

    This keeps the hardcoded definition in sync with the online manifest
    that the setup wizard and config-alignment system use.
    """
    candidates = [
        Path(__file__).parent.parent.parent / "recommended-config.json",
        Path(__file__).parent.parent / "recommended-config.json",
    ]
    for config_path in candidates:
        if not config_path.exists():
            continue
        try:
            with open(config_path, encoding="utf-8") as f:
                config = json.load(f)
        except Exception:
            continue

        categories_meta = config.get("categories", {})
        optional = config.get("optional", {})
        if not optional:
            continue

        profile_managed = {
            _normalize_dependency_name(pkg_name)
            for profile in config.get("profiles", {}).values()
            for pkg_name in profile.get("packages", {})
        }

        # Group packages by category
        groups: dict[str, Any] = {}
        for pkg_name, pkg_data in optional.items():
            if (
                _normalize_dependency_name(pkg_name) in profile_managed
                and not _show_optional_when_profile_managed(pkg_data)
            ):
                continue
            cat_id = pkg_data.get("category", "other")
            if cat_id not in groups:
                cat_meta = categories_meta.get(cat_id, {})
                groups[cat_id] = {
                    "name": cat_meta.get("name", cat_id.replace("_", " ").title()),
                    "description": cat_meta.get("description", ""),
                    "packages": [],
                }
            # Handle both old format ("version": ">=2.1.0") and new format ("min": ">=2.1.0", "recommended": "2.6.0")
            version_spec = pkg_data.get("min") or pkg_data.get("version", "")
            # Strip leading >= for min_version field
            min_version = version_spec.lstrip(">= ") if version_spec else ""
            recommended_version = pkg_data.get("recommended")
            groups[cat_id]["packages"].append({
                "name": pkg_name,
                "min_version": min_version,
                "recommended_version": recommended_version,
                "description": pkg_data.get("description", ""),
                "default_install": bool(pkg_data.get("default_install", False)),
                "managed_by_profile": _normalize_dependency_name(pkg_name) in profile_managed,
            })

        return groups

    return {}


# Load from recommended-config.json; this is the single source of truth
# shared with the setup wizard and config-alignment endpoints.
NIRS4ALL_OPTIONAL_DEPS: dict[str, Any] = _load_optional_deps_from_config() or {
    # Fallback if recommended-config.json is missing (shouldn't happen in practice)
    "deep_learning": {
        "name": "Deep Learning",
        "description": "Deep learning frameworks for neural network models",
        "packages": [
            {"name": "keras", "min_version": "3.0.0", "recommended_version": "3.8.0", "description": "High-level neural networks API"},
            {"name": "jax", "min_version": "0.4.20", "recommended_version": "0.4.38", "description": "JAX numerical computing library"},
            {"name": "jaxlib", "min_version": "0.4.20", "recommended_version": "0.4.38", "description": "JAX backend library"},
            {"name": "flax", "min_version": "0.8.0", "recommended_version": "0.10.4", "description": "Flax neural network library for JAX"},
            {"name": "tabpfn", "min_version": "2.0.0", "recommended_version": "2.0.3", "description": "TabPFN tabular data model"},
            {"name": "tabicl", "min_version": "2.0.0", "recommended_version": "2.0.3", "description": "TabICL in-context learning model for tabular data"},
        ],
    },
    "pls_variants": {
        "name": "PLS Variants",
        "description": "Advanced Partial Least Squares implementations",
        "packages": [
            {"name": "ikpls", "min_version": "1.1.0", "recommended_version": "1.3.0", "description": "Improved kernel PLS algorithms"},
            {"name": "pyopls", "min_version": "20.0", "recommended_version": "20.0", "description": "Orthogonal PLS (OPLS)"},
            {"name": "trendfitter", "min_version": "0.0.6", "recommended_version": "0.0.6", "description": "PLS with trend analysis"},
        ],
    },
    "automl": {
        "name": "AutoML",
        "description": "Automated machine learning frameworks",
        "packages": [
            {"name": "autogluon", "min_version": "1.0.0", "recommended_version": "1.2.0", "description": "AutoGluon AutoML toolkit"},
        ],
    },
    "explainability": {
        "name": "Explainability",
        "description": "Model interpretability and explanation tools",
        "packages": [
            {"name": "shap", "min_version": "0.44", "recommended_version": "0.47.1", "description": "SHAP explanations for model interpretability"},
        ],
    },
    "visualization": {
        "name": "Visualization",
        "description": "Plotting and visualization libraries",
        "packages": [
            {"name": "matplotlib", "min_version": "3.7.0", "recommended_version": "3.10.1", "description": "Core plotting library"},
            {"name": "seaborn", "min_version": "0.12.0", "recommended_version": "0.13.2", "description": "Statistical data visualization"},
            {"name": "plotly", "min_version": "5.0.0", "recommended_version": "6.0.1", "description": "Interactive plotting library"},
        ],
    },
    "dimensionality": {
        "name": "Dimensionality Reduction",
        "description": "Advanced dimensionality reduction methods",
        "packages": [
            {"name": "umap-learn", "min_version": "0.5.0", "recommended_version": "0.5.7", "description": "UMAP dimensionality reduction"},
        ],
    },
    "reports": {
        "name": "Reports",
        "description": "Document and report generation",
        "packages": [
            {"name": "pypandoc", "min_version": "1.12", "recommended_version": "1.12", "description": "Pandoc document conversion"},
            {"name": "PyPDF2", "min_version": "3.0.0", "recommended_version": "3.0.1", "description": "PDF manipulation"},
            {"name": "pdf2image", "min_version": "1.16.0", "recommended_version": "1.17.0", "description": "PDF to image conversion"},
        ],
    },
    "export": {
        "name": "Export",
        "description": "Data export capabilities",
        "packages": [
            {"name": "openpyxl", "min_version": "3.1.0", "recommended_version": "3.1.5", "description": "Excel file support"},
        ],
    },
}


# ============= Data Models =============


class DependencyInfo(BaseModel):
    """Information about a single dependency."""
    name: str
    category: str
    category_name: str
    description: str
    min_version: str
    recommended_version: str | None = None
    installed_version: str | None = None
    latest_version: str | None = None
    is_installed: bool = False
    is_outdated: bool = False
    is_below_recommended: bool = False
    is_above_recommended: bool = False
    can_update: bool = False
    default_install: bool = False
    managed_by_profile: bool = False


class DependencyCategory(BaseModel):
    """A category of dependencies."""
    id: str
    name: str
    description: str
    packages: list[DependencyInfo]
    installed_count: int = 0
    total_count: int = 0


class DependenciesResponse(BaseModel):
    """Response with all dependencies information."""
    categories: list[DependencyCategory]
    runtime_valid: bool
    runtime_path: str
    venv_valid: bool
    venv_path: str
    nirs4all_installed: bool
    nirs4all_version: str | None = None
    total_installed: int = 0
    total_packages: int = 0
    cached_at: str | None = None


class PackageInstallRequest(BaseModel):
    """Request to install a package."""
    package: str
    version: str | None = None
    upgrade: bool = False
    target: str | None = None  # "recommended" | "latest" | None (defaults to recommended)


class PackageUninstallRequest(BaseModel):
    """Request to uninstall a package."""
    package: str


# ============= Dependencies Cache =============


class DependenciesCache:
    """Cache for dependencies scan results."""

    CACHE_FILE = "dependencies_cache.json"
    CACHE_TTL_HOURS = 6

    def __init__(self):
        self._app_data_dir = Path(_resolve_user_data_dir(APP_NAME, APP_AUTHOR))
        self._cache_path = self._app_data_dir / self.CACHE_FILE
        self._cache: dict[str, Any] | None = None
        self._load_cache()

    def _load_cache(self) -> None:
        """Load cache from file."""
        if self._cache_path.exists():
            try:
                with open(self._cache_path, encoding="utf-8") as f:
                    self._cache = json.load(f)
            except Exception:
                self._cache = None

    def _save_cache(self) -> None:
        """Save cache to file."""
        self._app_data_dir.mkdir(parents=True, exist_ok=True)
        try:
            with open(self._cache_path, "w", encoding="utf-8") as f:
                json.dump(self._cache, f, indent=2)
        except Exception as e:
            logger.warning("Could not save dependencies cache: %s", e)

    def get(self, venv_path: str) -> dict[str, Any] | None:
        """Get cached dependencies for a venv path."""
        if not self._cache:
            return None
        if self._cache.get("venv_path") != venv_path:
            return None
        try:
            cached_at_raw = self._cache.get("cached_at")
            if not cached_at_raw:
                return None
            cached_at = datetime.fromisoformat(cached_at_raw)
            if datetime.now() - cached_at > timedelta(hours=self.CACHE_TTL_HOURS):
                return None
        except Exception:
            return None
        return self._cache

    def set(self, venv_path: str, data: dict[str, Any]) -> None:
        """Cache dependencies data for a venv path."""
        self._cache = {
            "venv_path": venv_path,
            "cached_at": datetime.now().isoformat(),
            **data,
        }
        self._save_cache()

    def invalidate(self) -> None:
        """Clear the cache."""
        self._cache = None
        if self._cache_path.exists():
            try:
                self._cache_path.unlink()
            except Exception:
                pass


# Global dependencies cache
_dependencies_cache = DependenciesCache()
