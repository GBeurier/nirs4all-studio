"""
Global app configuration manager for nirs4all webapp.

This module manages the cross-platform app configuration folder that stores:
- app_settings.json: UI preferences, linked workspaces list, favorites
- dataset_links.json: Global dataset registry accessible across all workspaces

The app config folder location is determined by (in order of priority):
1. NIRS4ALL_CONFIG environment variable
2. Redirect file (~/.nirs4all/config_redirect.txt) pointing to custom path
3. Default platform-specific location:
   - Linux/macOS: ~/.nirs4all/
   - Windows: %APPDATA%/nirs4all/
"""

import json
import os
import sys
from pathlib import Path
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, asdict, field
from datetime import datetime


# Default config directory name
_CONFIG_DIR_NAME = "nirs4all"
_REDIRECT_FILE_NAME = "config_redirect.txt"


@dataclass
class DatasetLink:
    """A globally linked dataset accessible across all workspaces."""
    id: str
    name: str
    path: str
    linked_at: str
    hash: str = ""
    version: int = 1
    version_status: str = "current"
    last_verified: str = ""
    config: Dict[str, Any] = field(default_factory=dict)
    stats: Dict[str, Any] = field(default_factory=dict)
    group_ids: List[str] = field(default_factory=list)
    # Computed fields from nirs4all
    num_samples: Optional[int] = None
    num_features: Optional[int] = None
    n_sources: int = 1
    task_type: Optional[str] = None
    signal_types: List[str] = field(default_factory=list)
    targets: List[Dict[str, Any]] = field(default_factory=list)
    default_target: Optional[str] = None
    description: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "DatasetLink":
        return cls(
            id=data.get("id", ""),
            name=data.get("name", ""),
            path=data.get("path", ""),
            linked_at=data.get("linked_at", ""),
            hash=data.get("hash", ""),
            version=data.get("version", 1),
            version_status=data.get("version_status", "current"),
            last_verified=data.get("last_verified", ""),
            config=data.get("config", {}),
            stats=data.get("stats", {}),
            group_ids=data.get("group_ids") or ([data["group_id"]] if data.get("group_id") else []),
            num_samples=data.get("num_samples"),
            num_features=data.get("num_features"),
            n_sources=data.get("n_sources", 1),
            task_type=data.get("task_type"),
            signal_types=data.get("signal_types", []),
            targets=data.get("targets", []),
            default_target=data.get("default_target"),
            description=data.get("description"),
        )


@dataclass
class DatasetGroup:
    """A group for organizing datasets."""
    id: str
    name: str
    dataset_ids: List[str] = field(default_factory=list)
    color: str = "#3b82f6"
    created_at: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "DatasetGroup":
        return cls(
            id=data.get("id", ""),
            name=data.get("name", ""),
            dataset_ids=data.get("dataset_ids", []),
            color=data.get("color", "#3b82f6"),
            created_at=data.get("created_at", ""),
        )


class AppConfigManager:
    """Manages the global app configuration folder.

    Handles cross-platform storage for:
    - App settings (UI preferences, linked workspaces, favorites)
    - Global dataset links
    """

    def __init__(self):
        self._config_dir = self._get_config_dir()
        self._config_dir.mkdir(parents=True, exist_ok=True)

        # File paths
        self._app_settings_path = self._config_dir / "app_settings.json"
        self._dataset_links_path = self._config_dir / "dataset_links.json"

    def _get_config_dir(self) -> Path:
        """Get the config directory following priority order.

        Priority:
        1. NIRS4ALL_CONFIG environment variable
        2. Standalone/portable mode (config next to exe)
        3. Redirect file pointing to custom path
        4. Default platform-specific location
        """
        # 1. Environment variable override
        env_config = os.environ.get("NIRS4ALL_CONFIG")
        if env_config:
            return Path(env_config)

        # 2. Standalone/portable mode (config next to exe)
        exe_path = Path(sys.executable).parent
        portable_config = exe_path / ".nirs4all"
        if portable_config.exists():
            return portable_config

        # 3. Check redirect file in default location
        default_path = self._get_default_config_dir()
        redirect_file = default_path / _REDIRECT_FILE_NAME
        if redirect_file.exists():
            try:
                redirect_path = redirect_file.read_text(encoding="utf-8").strip()
                if redirect_path and Path(redirect_path).exists():
                    return Path(redirect_path)
            except Exception:
                pass  # Fall back to default

        # 4. Default platform-specific location
        return default_path

    def _get_default_config_dir(self) -> Path:
        """Get the default platform-specific config directory.

        Returns:
            - Linux/macOS: ~/.nirs4all/
            - Windows: %APPDATA%/nirs4all/
        """
        if sys.platform == "win32":
            appdata = os.environ.get("APPDATA")
            if appdata:
                return Path(appdata) / _CONFIG_DIR_NAME
            return Path.home() / "AppData" / "Roaming" / _CONFIG_DIR_NAME
        else:
            return Path.home() / f".{_CONFIG_DIR_NAME}"

    @property
    def config_dir(self) -> Path:
        """Get the config directory path."""
        return self._config_dir

    # ============================================================================
    # Config Path Management
    # ============================================================================

    def get_config_path(self) -> str:
        """Get the current config folder path."""
        return str(self._config_dir)

    def get_default_config_path(self) -> str:
        """Get the default platform-specific config folder path."""
        return str(self._get_default_config_dir())

    def is_using_custom_path(self) -> bool:
        """Check if using a custom (non-default) config path."""
        return self._config_dir != self._get_default_config_dir()

    def set_config_path(self, path: str) -> bool:
        """Set a custom config folder path.

        This writes a redirect file in the default config location that points
        to the custom path. The new path must exist.

        Args:
            path: Path to the new config folder

        Returns:
            True if the redirect was set successfully

        Raises:
            ValueError: If the path doesn't exist
        """
        new_path = Path(path).resolve()

        if not new_path.exists():
            raise ValueError(f"Config path does not exist: {path}")

        # Ensure default config dir exists for the redirect file
        default_path = self._get_default_config_dir()
        default_path.mkdir(parents=True, exist_ok=True)

        # Write redirect file
        redirect_file = default_path / _REDIRECT_FILE_NAME
        try:
            redirect_file.write_text(str(new_path), encoding="utf-8")

            # Update internal state
            self._config_dir = new_path
            self._app_settings_path = self._config_dir / "app_settings.json"
            self._dataset_links_path = self._config_dir / "dataset_links.json"

            return True
        except Exception as e:
            print(f"Failed to set config path: {e}")
            return False

    def reset_config_path(self) -> bool:
        """Reset config folder to the default location.

        This removes the redirect file if it exists.

        Returns:
            True if reset was successful
        """
        default_path = self._get_default_config_dir()
        redirect_file = default_path / _REDIRECT_FILE_NAME

        try:
            if redirect_file.exists():
                redirect_file.unlink()

            # Update internal state
            self._config_dir = default_path
            self._config_dir.mkdir(parents=True, exist_ok=True)
            self._app_settings_path = self._config_dir / "app_settings.json"
            self._dataset_links_path = self._config_dir / "dataset_links.json"

            return True
        except Exception as e:
            print(f"Failed to reset config path: {e}")
            return False

    # ============================================================================
    # App Settings
    # ============================================================================

    def _default_app_settings(self) -> Dict[str, Any]:
        """Get default app settings."""
        return {
            "version": "3.0",
            "linked_workspaces": [],
            "favorite_pipelines": [],
            "ui_preferences": {
                "theme": "system",
                "density": "comfortable",
                "language": "en",
            },
            "last_updated": datetime.now().isoformat(),
        }

    def get_app_settings(self) -> Dict[str, Any]:
        """Load app settings from disk."""
        if self._app_settings_path.exists():
            try:
                with open(self._app_settings_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                print(f"Failed to load app settings: {e}")
        return self._default_app_settings()

    def save_app_settings(self, settings: Dict[str, Any]) -> bool:
        """Save app settings to disk."""
        try:
            settings["last_updated"] = datetime.now().isoformat()
            with open(self._app_settings_path, "w", encoding="utf-8") as f:
                json.dump(settings, f, indent=2)
            return True
        except Exception as e:
            print(f"Failed to save app settings: {e}")
            return False

    def update_app_settings(self, updates: Dict[str, Any]) -> bool:
        """Update app settings with deep merge."""
        current = self.get_app_settings()
        merged = self._deep_merge(current, updates)
        return self.save_app_settings(merged)

    def _deep_merge(self, base: Dict, updates: Dict) -> Dict:
        """Deep merge two dictionaries."""
        result = base.copy()
        for key, value in updates.items():
            if key in result and isinstance(result[key], dict) and isinstance(value, dict):
                result[key] = self._deep_merge(result[key], value)
            else:
                result[key] = value
        return result

    # ============================================================================
    # UI Preferences
    # ============================================================================

    def get_ui_preferences(self) -> Dict[str, Any]:
        """Get UI preferences."""
        settings = self.get_app_settings()
        return settings.get("ui_preferences", {})

    def save_ui_preferences(self, preferences: Dict[str, Any]) -> bool:
        """Save UI preferences."""
        settings = self.get_app_settings()
        settings["ui_preferences"] = {**settings.get("ui_preferences", {}), **preferences}
        return self.save_app_settings(settings)

    # ============================================================================
    # Favorites
    # ============================================================================

    def get_favorites(self) -> List[str]:
        """Get favorite pipeline IDs."""
        settings = self.get_app_settings()
        return settings.get("favorite_pipelines", [])

    def add_favorite(self, pipeline_id: str) -> bool:
        """Add a pipeline to favorites."""
        settings = self.get_app_settings()
        favorites = settings.get("favorite_pipelines", [])
        if pipeline_id not in favorites:
            favorites.append(pipeline_id)
            settings["favorite_pipelines"] = favorites
            return self.save_app_settings(settings)
        return True

    def remove_favorite(self, pipeline_id: str) -> bool:
        """Remove a pipeline from favorites."""
        settings = self.get_app_settings()
        favorites = settings.get("favorite_pipelines", [])
        if pipeline_id in favorites:
            favorites.remove(pipeline_id)
            settings["favorite_pipelines"] = favorites
            return self.save_app_settings(settings)
        return True

    # ============================================================================
    # Global Dataset Links
    # ============================================================================

    def _default_dataset_links(self) -> Dict[str, Any]:
        """Get default dataset links structure."""
        return {
            "version": "1.0",
            "datasets": [],
            "groups": [],
            "last_updated": datetime.now().isoformat(),
        }

    def _load_dataset_links(self) -> Dict[str, Any]:
        """Load dataset links from disk."""
        if self._dataset_links_path.exists():
            try:
                with open(self._dataset_links_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                print(f"Failed to load dataset links: {e}")
        return self._default_dataset_links()

    def _save_dataset_links(self, data: Dict[str, Any]) -> bool:
        """Save dataset links to disk."""
        try:
            data["last_updated"] = datetime.now().isoformat()
            with open(self._dataset_links_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            return True
        except Exception as e:
            print(f"Failed to save dataset links: {e}")
            return False

    def get_datasets(self) -> List[DatasetLink]:
        """Get all linked datasets."""
        data = self._load_dataset_links()
        return [DatasetLink.from_dict(d) for d in data.get("datasets", [])]

    def get_dataset(self, dataset_id: str) -> Optional[DatasetLink]:
        """Get a specific dataset by ID."""
        for ds in self.get_datasets():
            if ds.id == dataset_id:
                return ds
        return None

    def link_dataset(self, path: str, config: Optional[Dict[str, Any]] = None) -> DatasetLink:
        """Link a dataset globally.

        Args:
            path: Path to the dataset file or directory
            config: Optional configuration for loading the dataset

        Returns:
            The created DatasetLink

        Raises:
            ValueError: If path doesn't exist or is already linked
        """
        dataset_path = Path(path).resolve()

        if not dataset_path.exists():
            raise ValueError(f"Dataset path does not exist: {path}")

        # Check if already linked
        data = self._load_dataset_links()
        datasets = data.get("datasets", [])
        for ds in datasets:
            if ds.get("path") == str(dataset_path):
                raise ValueError("Dataset already linked")

        # Compute hash and stats
        dataset_hash = self._compute_dataset_hash(dataset_path)
        dataset_stats = self._compute_dataset_stats(dataset_path)
        now = datetime.now().isoformat()

        # Create dataset link
        dataset = DatasetLink(
            id=f"dataset_{int(datetime.now().timestamp())}_{len(datasets)}",
            name=dataset_path.name,
            path=str(dataset_path),
            linked_at=now,
            hash=dataset_hash,
            version=1,
            version_status="current",
            last_verified=now,
            config=config or {},
            stats=dataset_stats,
        )

        datasets.append(dataset.to_dict())
        data["datasets"] = datasets
        if not self._save_dataset_links(data):
            raise RuntimeError("Failed to save dataset link to disk")

        return dataset

    def unlink_dataset(self, dataset_id: str) -> bool:
        """Unlink a dataset (doesn't delete files).

        Args:
            dataset_id: ID of the dataset to unlink

        Returns:
            True if dataset was unlinked
        """
        data = self._load_dataset_links()
        datasets = data.get("datasets", [])
        original_len = len(datasets)

        datasets = [ds for ds in datasets if ds.get("id") != dataset_id]

        if len(datasets) == original_len:
            return False

        data["datasets"] = datasets
        return self._save_dataset_links(data)

    def update_dataset(self, dataset_id: str, updates: Dict[str, Any]) -> Optional[DatasetLink]:
        """Update a dataset's configuration.

        Args:
            dataset_id: ID of the dataset to update
            updates: Dictionary of fields to update

        Returns:
            Updated DatasetLink or None if not found
        """
        data = self._load_dataset_links()
        datasets = data.get("datasets", [])

        for ds in datasets:
            if ds.get("id") == dataset_id:
                # Update allowed fields - including computed fields and stats
                allowed_fields = [
                    "name", "config", "group_ids", "stats", "description",
                    "num_samples", "num_features", "n_sources", "task_type",
                    "signal_types", "targets", "default_target",
                    "hash", "version", "version_status", "last_verified", "last_refreshed",
                ]
                for key in allowed_fields:
                    if key in updates:
                        ds[key] = updates[key]

                data["datasets"] = datasets
                self._save_dataset_links(data)
                return DatasetLink.from_dict(ds)

        return None

    def refresh_dataset(self, dataset_id: str) -> Optional[DatasetLink]:
        """Refresh a dataset's hash and stats.

        Args:
            dataset_id: ID of the dataset to refresh

        Returns:
            Updated DatasetLink or None if not found
        """
        data = self._load_dataset_links()
        datasets = data.get("datasets", [])

        for ds in datasets:
            if ds.get("id") == dataset_id:
                dataset_path = Path(ds["path"])
                if not dataset_path.exists():
                    ds["version_status"] = "missing"
                else:
                    old_hash = ds.get("hash", "")
                    new_hash = self._compute_dataset_hash(dataset_path)

                    if old_hash and new_hash != old_hash:
                        ds["version"] = ds.get("version", 1) + 1
                        ds["version_status"] = "updated"
                    else:
                        ds["version_status"] = "current"

                    ds["hash"] = new_hash
                    ds["stats"] = self._compute_dataset_stats(dataset_path)

                ds["last_verified"] = datetime.now().isoformat()

                data["datasets"] = datasets
                self._save_dataset_links(data)
                return DatasetLink.from_dict(ds)

        return None

    def _compute_dataset_hash(self, dataset_path: Path) -> str:
        """Compute SHA-256 hash of dataset files for integrity checking."""
        import hashlib

        hasher = hashlib.sha256()
        extensions = {".csv", ".xlsx", ".xls", ".parquet", ".npy", ".npz", ".mat"}
        compressed = {".gz", ".bz2", ".xz", ".zip"}

        if dataset_path.is_file():
            hasher.update(dataset_path.read_bytes())
        elif dataset_path.is_dir():
            for file in sorted(dataset_path.rglob("*")):
                if not file.is_file():
                    continue
                suffix = file.suffix.lower()
                if suffix in compressed:
                    inner_suffix = Path(file.stem).suffix.lower()
                    if inner_suffix and inner_suffix in extensions:
                        hasher.update(file.read_bytes())
                elif suffix in extensions:
                    hasher.update(file.read_bytes())

        return hasher.hexdigest()[:16]

    def _compute_dataset_stats(self, dataset_path: Path) -> Dict[str, Any]:
        """Compute basic statistics about a dataset."""
        stats = {
            "file_count": 0,
            "total_size_bytes": 0,
            "files": [],
        }
        extensions = {".csv", ".xlsx", ".xls", ".parquet", ".npy", ".npz", ".mat"}
        compressed = {".gz", ".bz2", ".xz", ".zip"}

        if dataset_path.is_file():
            stats["file_count"] = 1
            stats["total_size_bytes"] = dataset_path.stat().st_size
            stats["files"] = [dataset_path.name]
        elif dataset_path.is_dir():
            for file in sorted(dataset_path.rglob("*")):
                if not file.is_file():
                    continue
                suffix = file.suffix.lower()
                if suffix in compressed:
                    inner_suffix = Path(file.stem).suffix.lower()
                    if inner_suffix and inner_suffix in extensions:
                        stats["file_count"] += 1
                        stats["total_size_bytes"] += file.stat().st_size
                        stats["files"].append(str(file.relative_to(dataset_path)))
                elif suffix in extensions:
                    stats["file_count"] += 1
                    stats["total_size_bytes"] += file.stat().st_size
                    stats["files"].append(str(file.relative_to(dataset_path)))

        return stats

    # ============================================================================
    # Dataset Groups
    # ============================================================================

    def get_dataset_groups(self) -> List[DatasetGroup]:
        """Get all dataset groups."""
        data = self._load_dataset_links()
        return [DatasetGroup.from_dict(g) for g in data.get("groups", [])]

    def create_dataset_group(self, name: str, color: str = "#3b82f6") -> DatasetGroup:
        """Create a new dataset group.

        Args:
            name: Group name
            color: Group color (hex)

        Returns:
            The created DatasetGroup
        """
        data = self._load_dataset_links()
        groups = data.get("groups", [])

        now = datetime.now().isoformat()
        group = DatasetGroup(
            id=f"group_{int(datetime.now().timestamp())}_{len(groups)}",
            name=name,
            color=color,
            created_at=now,
        )

        groups.append(group.to_dict())
        data["groups"] = groups
        self._save_dataset_links(data)

        return group

    def delete_dataset_group(self, group_id: str) -> bool:
        """Delete a dataset group.

        Args:
            group_id: ID of the group to delete

        Returns:
            True if group was deleted
        """
        data = self._load_dataset_links()
        groups = data.get("groups", [])
        datasets = data.get("datasets", [])
        original_len = len(groups)

        groups = [g for g in groups if g.get("id") != group_id]

        if len(groups) == original_len:
            return False

        # Remove group_id from any datasets' group_ids lists
        for ds in datasets:
            gids = ds.get("group_ids", [])
            # Also handle legacy group_id field
            if ds.get("group_id") == group_id:
                ds.pop("group_id", None)
            if group_id in gids:
                ds["group_ids"] = [g for g in gids if g != group_id]

        data["groups"] = groups
        data["datasets"] = datasets
        return self._save_dataset_links(data)

    def add_dataset_to_group(self, dataset_id: str, group_id: str) -> bool:
        """Add a dataset to a group (additive multi-group).

        Args:
            dataset_id: ID of the dataset
            group_id: ID of the group

        Returns:
            True if successful
        """
        data = self._load_dataset_links()
        datasets = data.get("datasets", [])

        for ds in datasets:
            if ds.get("id") == dataset_id:
                gids = ds.get("group_ids", [])
                # Migrate legacy group_id
                if not gids and ds.get("group_id"):
                    gids = [ds["group_id"]]
                if group_id not in gids:
                    gids.append(group_id)
                ds["group_ids"] = gids
                ds.pop("group_id", None)
                data["datasets"] = datasets
                self._save_dataset_links(data)
                return True

        return False

    def remove_dataset_from_group(self, dataset_id: str, group_id: Optional[str] = None) -> bool:
        """Remove a dataset from a specific group.

        Args:
            dataset_id: ID of the dataset
            group_id: ID of the group to remove from. If None, removes all groups.

        Returns:
            True if successful
        """
        data = self._load_dataset_links()
        datasets = data.get("datasets", [])

        for ds in datasets:
            if ds.get("id") == dataset_id:
                if group_id is None:
                    ds["group_ids"] = []
                else:
                    gids = ds.get("group_ids", [])
                    ds["group_ids"] = [g for g in gids if g != group_id]
                ds.pop("group_id", None)
                data["datasets"] = datasets
                self._save_dataset_links(data)
                return True

        return False


# Global instance
app_config = AppConfigManager()
