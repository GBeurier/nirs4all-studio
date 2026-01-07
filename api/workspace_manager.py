"""
Workspace management utilities for nirs4all webapp.

This module handles workspace persistence, configuration, and state management.

Phase 6 Implementation:
- List all workspaces
- Recent workspaces tracking
- Workspace export utilities
- Enhanced configuration management
"""

import json
import os
import sys
from pathlib import Path
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, asdict, field
from datetime import datetime
import platformdirs

# Try to import nirs4all components (optional)
try:
    nirs4all_path = Path(__file__).parent.parent.parent / "nirs4all"
    if str(nirs4all_path) not in sys.path:
        sys.path.insert(0, str(nirs4all_path))
    from nirs4all.data import DatasetConfigs
    from nirs4all.data.config_parser import parse_config
    from nirs4all.data.loaders.loader import handle_data
    NIRS4ALL_AVAILABLE = True
except ImportError as e:
    print(f"Note: nirs4all not available, using stub functionality: {e}")
    DatasetConfigs = None
    parse_config = None
    handle_data = None
    NIRS4ALL_AVAILABLE = False


@dataclass
class WorkspaceConfig:
    """Configuration for a workspace."""
    path: str
    name: str
    created_at: str
    last_accessed: str
    datasets: List[Dict[str, Any]]
    pipelines: List[Dict[str, Any]]
    groups: List[Dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "WorkspaceConfig":
        return cls(
            path=data.get("path", ""),
            name=data.get("name", Path(data.get("path", "")).name if data.get("path") else "Unknown"),
            created_at=data.get("created_at", datetime.now().isoformat()),
            last_accessed=data.get("last_accessed", datetime.now().isoformat()),
            datasets=data.get("datasets", []),
            pipelines=data.get("pipelines", []),
            groups=data.get("groups", []),
        )


class WorkspaceManager:
    """Manages workspace operations and persistence."""

    def __init__(self):
        # Get app data directory for persistence
        self.app_data_dir = Path(platformdirs.user_data_dir("nirs4all-webapp", "nirs4all"))
        self.app_data_dir.mkdir(parents=True, exist_ok=True)
        self.config_file = self.app_data_dir / "workspace_config.json"
        self.recent_workspaces_file = self.app_data_dir / "recent_workspaces.json"

        # Load current workspace
        self._current_workspace_path: Optional[str] = None
        self._workspace_config: Optional[WorkspaceConfig] = None
        self._recent_workspaces: List[Dict[str, Any]] = []
        self._load_recent_workspaces()
        self._load_current_workspace()

    def _load_recent_workspaces(self) -> None:
        """Load the list of recent workspaces from persistent storage."""
        if self.recent_workspaces_file.exists():
            try:
                with open(self.recent_workspaces_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self._recent_workspaces = data.get("workspaces", [])
            except Exception as e:
                print(f"Failed to load recent workspaces: {e}")
                self._recent_workspaces = []

    def _save_recent_workspaces(self) -> None:
        """Save the list of recent workspaces to persistent storage."""
        try:
            data = {
                "workspaces": self._recent_workspaces,
                "last_updated": datetime.now().isoformat(),
            }
            with open(self.recent_workspaces_file, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            print(f"Failed to save recent workspaces: {e}")

    def _load_current_workspace(self) -> None:
        """Load the current workspace from persistent storage."""
        if self.config_file.exists():
            try:
                with open(self.config_file, "r", encoding="utf-8") as f:
                    config_data = json.load(f)
                    workspace_path = config_data.get("current_workspace_path")
                    if workspace_path and Path(workspace_path).exists():
                        self._current_workspace_path = workspace_path
                        self._load_workspace_config()
            except Exception as e:
                print(f"Failed to load workspace config: {e}")

    def _save_current_workspace(self) -> None:
        """Save the current workspace to persistent storage."""
        try:
            config_data = {
                "current_workspace_path": self._current_workspace_path,
                "last_updated": datetime.now().isoformat(),
            }
            with open(self.config_file, "w", encoding="utf-8") as f:
                json.dump(config_data, f, indent=2)
        except Exception as e:
            print(f"Failed to save workspace config: {e}")

    def _load_workspace_config(self) -> None:
        """Load workspace configuration from the workspace folder."""
        if not self._current_workspace_path:
            return

        workspace_path = Path(self._current_workspace_path)
        config_file = workspace_path / "workspace.json"

        if config_file.exists():
            try:
                with open(config_file, "r", encoding="utf-8") as f:
                    config_data = json.load(f)
                    self._workspace_config = WorkspaceConfig.from_dict(config_data)
                    self._workspace_config.last_accessed = datetime.now().isoformat()
                    self._save_workspace_config()
            except Exception as e:
                print(f"Failed to load workspace config: {e}")
                self._create_default_workspace_config()
        else:
            self._create_default_workspace_config()

    def _create_default_workspace_config(self) -> None:
        """Create a default workspace configuration."""
        if not self._current_workspace_path:
            return

        workspace_path = Path(self._current_workspace_path)
        now = datetime.now().isoformat()

        self._workspace_config = WorkspaceConfig(
            path=str(workspace_path),
            name=workspace_path.name,
            created_at=now,
            last_accessed=now,
            datasets=[],
            pipelines=[],
        )

        # Create required directories
        (workspace_path / "results").mkdir(exist_ok=True)
        (workspace_path / "pipelines").mkdir(exist_ok=True)

        self._save_workspace_config()

    def _save_workspace_config(self) -> None:
        """Save workspace configuration to the workspace folder."""
        if not self._current_workspace_path or not self._workspace_config:
            return

        workspace_path = Path(self._current_workspace_path)
        config_file = workspace_path / "workspace.json"

        try:
            with open(config_file, "w", encoding="utf-8") as f:
                json.dump(self._workspace_config.to_dict(), f, indent=2)
        except Exception as e:
            print(f"Failed to save workspace config: {e}")

    def set_workspace(self, path: str) -> WorkspaceConfig:
        """Set the current workspace and create necessary structure."""
        workspace_path = Path(path)

        if not workspace_path.exists():
            raise ValueError(f"Workspace path does not exist: {path}")

        if not workspace_path.is_dir():
            raise ValueError(f"Workspace path is not a directory: {path}")

        self._current_workspace_path = str(workspace_path.resolve())
        self._save_current_workspace()
        self._load_workspace_config()

        if not self._workspace_config:
            raise RuntimeError("Failed to create workspace configuration")

        # Add to recent workspaces
        self.add_to_recent(self._current_workspace_path, self._workspace_config.name)

        return self._workspace_config

    def get_current_workspace(self) -> Optional[WorkspaceConfig]:
        """Get the current workspace configuration."""
        return self._workspace_config

    def link_dataset(self, dataset_path: str, config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Link a dataset to the current workspace."""
        if not self._workspace_config:
            raise RuntimeError("No workspace selected")

        dataset_path = str(Path(dataset_path).resolve())

        if not Path(dataset_path).exists():
            raise ValueError(f"Dataset path does not exist: {dataset_path}")

        # Check if already linked
        for existing in self._workspace_config.datasets:
            if existing["path"] == dataset_path:
                raise ValueError("Dataset already linked")

        # Compute hash for integrity tracking (Phase 2)
        dataset_hash = self._compute_dataset_hash(Path(dataset_path))
        dataset_stats = self._compute_dataset_stats(Path(dataset_path))
        now = datetime.now().isoformat()

        # Create dataset info
        dataset_info = {
            "id": f"dataset_{len(self._workspace_config.datasets) + 1}_{int(datetime.now().timestamp())}",
            "name": Path(dataset_path).name,
            "path": dataset_path,
            "linked_at": now,
            "num_samples": 0,
            "num_features": 0,
            "num_targets": 0,
            "config": config or {},
            # Phase 2: Versioning fields
            "hash": dataset_hash,
            "version": 1,
            "version_status": "current",
            "last_verified": now,
            "_stats": dataset_stats,
        }

        # Add to workspace
        self._workspace_config.datasets.append(dataset_info)
        self._workspace_config.last_accessed = now
        self._save_workspace_config()

        return dataset_info

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
        """Compute basic statistics about a dataset for change detection."""
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
                is_data_file = suffix in extensions
                if suffix in compressed:
                    inner_suffix = Path(file.stem).suffix.lower()
                    is_data_file = inner_suffix in extensions
                if is_data_file:
                    stats["file_count"] += 1
                    stats["total_size_bytes"] += file.stat().st_size
                    stats["files"].append(str(file.relative_to(dataset_path)))

        return stats

    def unlink_dataset(self, dataset_id: str) -> bool:
        """Unlink a dataset from the current workspace."""
        if not self._workspace_config:
            raise RuntimeError("No workspace selected")

        original_count = len(self._workspace_config.datasets)
        self._workspace_config.datasets = [
            d for d in self._workspace_config.datasets if d["id"] != dataset_id
        ]

        if len(self._workspace_config.datasets) == original_count:
            return False

        self._workspace_config.last_accessed = datetime.now().isoformat()
        self._save_workspace_config()
        return True

    def refresh_dataset(self, dataset_id: str) -> Optional[Dict[str, Any]]:
        """Refresh dataset information."""
        if not self._workspace_config:
            raise RuntimeError("No workspace selected")

        dataset_info = next(
            (d for d in self._workspace_config.datasets if d.get("id") == dataset_id),
            None,
        )
        if dataset_info:
            dataset_info["last_refreshed"] = datetime.now().isoformat()
            self._save_workspace_config()

        return dataset_info

    def get_results_path(self) -> Optional[str]:
        """Get the results directory path for the current workspace."""
        if not self._current_workspace_path:
            return None
        return str(Path(self._current_workspace_path) / "results")

    def get_pipelines_path(self) -> Optional[str]:
        """Get the pipelines directory path for the current workspace."""
        if not self._current_workspace_path:
            return None
        return str(Path(self._current_workspace_path) / "pipelines")

    def get_predictions_path(self) -> Optional[str]:
        """Get the predictions directory path for the current workspace."""
        if not self._current_workspace_path:
            return None
        return str(Path(self._current_workspace_path) / "predictions")

    # ----------------------- Groups management -----------------------
    def get_groups(self) -> List[Dict[str, Any]]:
        if not self._workspace_config:
            return []
        return self._workspace_config.groups

    def create_group(self, name: str) -> Dict[str, Any]:
        if not self._workspace_config:
            raise RuntimeError("No workspace selected")
        group = {
            "id": f"group_{len(self._workspace_config.groups) + 1}_{int(datetime.now().timestamp())}",
            "name": name,
            "dataset_ids": [],
            "created_at": datetime.now().isoformat(),
        }
        self._workspace_config.groups.append(group)
        self._save_workspace_config()
        return group

    def rename_group(self, group_id: str, new_name: str) -> bool:
        if not self._workspace_config:
            raise RuntimeError("No workspace selected")
        for g in self._workspace_config.groups:
            if g.get("id") == group_id:
                g["name"] = new_name
                self._save_workspace_config()
                return True
        return False

    def delete_group(self, group_id: str) -> bool:
        if not self._workspace_config:
            raise RuntimeError("No workspace selected")
        original = len(self._workspace_config.groups)
        self._workspace_config.groups = [
            g for g in self._workspace_config.groups if g.get("id") != group_id
        ]
        if len(self._workspace_config.groups) != original:
            self._save_workspace_config()
            return True
        return False

    def add_dataset_to_group(self, group_id: str, dataset_id: str) -> bool:
        if not self._workspace_config:
            raise RuntimeError("No workspace selected")
        for g in self._workspace_config.groups:
            if g.get("id") == group_id:
                if dataset_id not in g.get("dataset_ids", []):
                    g.setdefault("dataset_ids", []).append(dataset_id)
                    self._save_workspace_config()
                return True
        return False

    def remove_dataset_from_group(self, group_id: str, dataset_id: str) -> bool:
        if not self._workspace_config:
            raise RuntimeError("No workspace selected")
        for g in self._workspace_config.groups:
            if g.get("id") == group_id:
                if dataset_id in g.get("dataset_ids", []):
                    g["dataset_ids"] = [d for d in g["dataset_ids"] if d != dataset_id]
                    self._save_workspace_config()
                return True
        return False

    # ----------------------- Recent Workspaces Management (Phase 6) -----------------------

    def add_to_recent(self, workspace_path: str, name: Optional[str] = None) -> None:
        """Add a workspace to the recent workspaces list."""
        workspace_path = str(Path(workspace_path).resolve())
        now = datetime.now().isoformat()

        # Remove if already exists
        self._recent_workspaces = [
            ws for ws in self._recent_workspaces
            if ws.get("path") != workspace_path
        ]

        # Load config for additional info
        config = self.load_workspace_config(workspace_path)
        num_datasets = len(config.get("datasets", [])) if config else 0
        num_pipelines = len(config.get("pipelines", [])) if config else 0
        description = config.get("description") if config else None

        # Add to front of list
        self._recent_workspaces.insert(0, {
            "path": workspace_path,
            "name": name or (config.get("name") if config else None) or Path(workspace_path).name,
            "created_at": config.get("created_at", now) if config else now,
            "last_accessed": now,
            "num_datasets": num_datasets,
            "num_pipelines": num_pipelines,
            "description": description,
        })

        # Keep only last 20 workspaces
        self._recent_workspaces = self._recent_workspaces[:20]
        self._save_recent_workspaces()

    def remove_from_recent(self, workspace_path: str) -> bool:
        """Remove a workspace from the recent workspaces list."""
        workspace_path = str(Path(workspace_path).resolve())
        original_len = len(self._recent_workspaces)
        self._recent_workspaces = [
            ws for ws in self._recent_workspaces
            if ws.get("path") != workspace_path
        ]
        if len(self._recent_workspaces) != original_len:
            self._save_recent_workspaces()
            return True
        return False

    def get_recent_workspaces(self, limit: int = 10) -> List[Dict[str, Any]]:
        """Get the list of recent workspaces."""
        # Filter out workspaces that no longer exist
        valid_workspaces = []
        for ws in self._recent_workspaces:
            path = ws.get("path", "")
            if path and Path(path).exists():
                valid_workspaces.append(ws)

        # Update list if some were invalid
        if len(valid_workspaces) != len(self._recent_workspaces):
            self._recent_workspaces = valid_workspaces
            self._save_recent_workspaces()

        return valid_workspaces[:limit]

    def list_workspaces(self) -> List[Dict[str, Any]]:
        """List all known workspaces (from recent list)."""
        return self.get_recent_workspaces(limit=100)

    def find_workspace_by_name(self, name: str) -> Optional[str]:
        """Find a workspace path by its name."""
        for ws in self._recent_workspaces:
            if ws.get("name") == name:
                path = ws.get("path")
                if path and Path(path).exists():
                    return path
        return None

    def load_workspace_config(self, workspace_path: str) -> Optional[Dict[str, Any]]:
        """Load workspace configuration from a given path."""
        config_file = Path(workspace_path) / "workspace.json"
        if not config_file.exists():
            return None

        try:
            with open(config_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Failed to load workspace config: {e}")
            return None

    def update_workspace_config(
        self,
        workspace_path: str,
        updates: Dict[str, Any]
    ) -> bool:
        """Update workspace configuration."""
        config_file = Path(workspace_path) / "workspace.json"
        if not config_file.exists():
            return False

        try:
            with open(config_file, "r", encoding="utf-8") as f:
                config = json.load(f)

            # Only allow updating certain fields
            allowed_fields = {"name", "description"}
            for key, value in updates.items():
                if key in allowed_fields:
                    config[key] = value

            config["last_accessed"] = datetime.now().isoformat()

            with open(config_file, "w", encoding="utf-8") as f:
                json.dump(config, f, indent=2)

            # Update recent workspaces list
            for ws in self._recent_workspaces:
                if ws.get("path") == workspace_path:
                    for key in allowed_fields:
                        if key in updates:
                            ws[key] = updates[key]
                    ws["last_accessed"] = config["last_accessed"]
            self._save_recent_workspaces()

            # Update current workspace if it's the same
            if self._current_workspace_path == workspace_path:
                self._load_workspace_config()

            return True

        except Exception as e:
            print(f"Failed to update workspace config: {e}")
            return False

    # ----------------------- Custom Nodes Management (Phase 5) -----------------------

    def get_custom_nodes_path(self) -> Optional[Path]:
        """Get the path to the custom nodes file for the current workspace."""
        if not self._current_workspace_path:
            return None
        workspace_path = Path(self._current_workspace_path)
        nirs4all_dir = workspace_path / ".nirs4all"
        nirs4all_dir.mkdir(exist_ok=True)
        return nirs4all_dir / "custom_nodes.json"

    def get_custom_nodes(self) -> List[Dict[str, Any]]:
        """Get all custom nodes for the current workspace."""
        nodes_path = self.get_custom_nodes_path()
        if not nodes_path or not nodes_path.exists():
            return []

        try:
            with open(nodes_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data.get("nodes", [])
        except Exception as e:
            print(f"Failed to load custom nodes: {e}")
            return []

    def save_custom_nodes(self, nodes: List[Dict[str, Any]]) -> bool:
        """Save all custom nodes for the current workspace."""
        nodes_path = self.get_custom_nodes_path()
        if not nodes_path:
            return False

        try:
            data = {
                "nodes": nodes,
                "version": "1.0",
                "last_updated": datetime.now().isoformat(),
            }
            with open(nodes_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            return True
        except Exception as e:
            print(f"Failed to save custom nodes: {e}")
            return False

    def add_custom_node(self, node: Dict[str, Any]) -> Dict[str, Any]:
        """Add a new custom node to the workspace."""
        if not self._workspace_config:
            raise RuntimeError("No workspace selected")

        nodes = self.get_custom_nodes()

        # Check for duplicate ID
        node_id = node.get("id")
        if any(n.get("id") == node_id for n in nodes):
            raise ValueError(f"Custom node with ID '{node_id}' already exists")

        # Add metadata
        node["created_at"] = datetime.now().isoformat()
        node["updated_at"] = node["created_at"]
        node["source"] = "workspace"

        nodes.append(node)
        self.save_custom_nodes(nodes)
        return node

    def update_custom_node(self, node_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update an existing custom node."""
        if not self._workspace_config:
            raise RuntimeError("No workspace selected")

        nodes = self.get_custom_nodes()
        for i, node in enumerate(nodes):
            if node.get("id") == node_id:
                # Preserve certain fields
                updates["id"] = node_id
                updates["created_at"] = node.get("created_at", datetime.now().isoformat())
                updates["updated_at"] = datetime.now().isoformat()
                updates["source"] = "workspace"
                nodes[i] = updates
                self.save_custom_nodes(nodes)
                return updates
        return None

    def delete_custom_node(self, node_id: str) -> bool:
        """Delete a custom node from the workspace."""
        if not self._workspace_config:
            raise RuntimeError("No workspace selected")

        nodes = self.get_custom_nodes()
        original_len = len(nodes)
        nodes = [n for n in nodes if n.get("id") != node_id]

        if len(nodes) != original_len:
            self.save_custom_nodes(nodes)
            return True
        return False

    def import_custom_nodes(self, nodes_to_import: List[Dict[str, Any]], overwrite: bool = False) -> Dict[str, Any]:
        """Import custom nodes from an external source.

        Args:
            nodes_to_import: List of node definitions to import
            overwrite: If True, overwrite existing nodes with same ID

        Returns:
            Dict with 'imported', 'skipped', 'errors' counts
        """
        if not self._workspace_config:
            raise RuntimeError("No workspace selected")

        existing_nodes = self.get_custom_nodes()
        existing_ids = {n.get("id") for n in existing_nodes}

        imported = 0
        skipped = 0
        errors = 0

        for node in nodes_to_import:
            try:
                node_id = node.get("id")
                if not node_id:
                    errors += 1
                    continue

                if node_id in existing_ids:
                    if overwrite:
                        # Remove old version
                        existing_nodes = [n for n in existing_nodes if n.get("id") != node_id]
                        existing_ids.discard(node_id)
                    else:
                        skipped += 1
                        continue

                # Add metadata
                node["imported_at"] = datetime.now().isoformat()
                node["updated_at"] = node["imported_at"]
                node["source"] = "workspace"

                existing_nodes.append(node)
                existing_ids.add(node_id)
                imported += 1

            except Exception as e:
                print(f"Failed to import node: {e}")
                errors += 1

        self.save_custom_nodes(existing_nodes)
        return {"imported": imported, "skipped": skipped, "errors": errors}

    def get_custom_node_settings(self) -> Dict[str, Any]:
        """Get custom node settings for the workspace."""
        nodes_path = self.get_custom_nodes_path()
        if not nodes_path or not nodes_path.exists():
            return self._default_custom_node_settings()

        try:
            with open(nodes_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data.get("settings", self._default_custom_node_settings())
        except Exception:
            return self._default_custom_node_settings()

    def save_custom_node_settings(self, settings: Dict[str, Any]) -> bool:
        """Save custom node settings for the workspace."""
        nodes_path = self.get_custom_nodes_path()
        if not nodes_path:
            return False

        try:
            # Load existing data or create new
            if nodes_path.exists():
                with open(nodes_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
            else:
                data = {"nodes": [], "version": "1.0"}

            data["settings"] = settings
            data["last_updated"] = datetime.now().isoformat()

            with open(nodes_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            return True
        except Exception as e:
            print(f"Failed to save custom node settings: {e}")
            return False

    def _default_custom_node_settings(self) -> Dict[str, Any]:
        """Get default custom node settings."""
        return {
            "enabled": True,
            "allowedPackages": ["nirs4all", "sklearn", "scipy", "numpy", "pandas"],
            "requireApproval": False,
            "allowUserNodes": True,
        }

    # ----------------------- Workspace Settings (Phase 5) -----------------------

    def get_settings_path(self) -> Optional[Path]:
        """Get the path to the workspace settings file."""
        if not self._current_workspace_path:
            return None
        workspace_path = Path(self._current_workspace_path)
        nirs4all_dir = workspace_path / ".nirs4all"
        nirs4all_dir.mkdir(exist_ok=True)
        return nirs4all_dir / "settings.json"

    def get_workspace_settings(self) -> Dict[str, Any]:
        """Get workspace settings including data loading defaults."""
        settings_path = self.get_settings_path()
        if not settings_path or not settings_path.exists():
            return self._default_workspace_settings()

        try:
            with open(settings_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                # Merge with defaults to ensure all fields exist
                defaults = self._default_workspace_settings()
                return self._deep_merge(defaults, data)
        except Exception as e:
            print(f"Failed to load workspace settings: {e}")
            return self._default_workspace_settings()

    @staticmethod
    def _deep_merge(base: Dict[str, Any], overrides: Dict[str, Any]) -> Dict[str, Any]:
        """Deep-merge two dicts.

        Values from overrides take precedence. Nested dicts are merged recursively.
        This is important for partial settings updates (e.g. updating general.language
        should not overwrite other general.* fields).
        """

        merged: Dict[str, Any] = dict(base)
        for key, value in overrides.items():
            if (
                key in merged
                and isinstance(merged[key], dict)
                and isinstance(value, dict)
            ):
                merged[key] = WorkspaceManager._deep_merge(merged[key], value)
            else:
                merged[key] = value
        return merged

    def save_workspace_settings(self, settings: Dict[str, Any]) -> bool:
        """Save workspace settings."""
        settings_path = self.get_settings_path()
        if not settings_path:
            return False

        try:
            # Merge with existing settings (deep merge to avoid overwriting nested dicts)
            existing = self.get_workspace_settings()
            merged = self._deep_merge(existing, settings)
            merged["last_updated"] = datetime.now().isoformat()

            with open(settings_path, "w", encoding="utf-8") as f:
                json.dump(merged, f, indent=2)
            return True
        except Exception as e:
            print(f"Failed to save workspace settings: {e}")
            return False

    def _default_workspace_settings(self) -> Dict[str, Any]:
        """Get default workspace settings."""
        return {
            "data_loading_defaults": {
                "delimiter": ";",
                "decimal_separator": ".",
                "has_header": True,
                "header_unit": "nm",
                "signal_type": "auto",
                "na_policy": "drop",
                "auto_detect": True,
            },
            "developer_mode": False,
            "cache_enabled": True,
            "backup_enabled": False,
            "backup_interval_hours": 24,
            "backup_max_count": 5,
            "backup_include_results": True,
            "backup_include_models": True,
            "general": {
                "theme": "system",
                "ui_density": "comfortable",
                "reduce_animations": False,
                "sidebar_collapsed": False,
                "language": "en",
            },
        }

    def get_data_loading_defaults(self) -> Dict[str, Any]:
        """Get default data loading settings for the wizard."""
        settings = self.get_workspace_settings()
        return settings.get("data_loading_defaults", self._default_workspace_settings()["data_loading_defaults"])

    def save_data_loading_defaults(self, defaults: Dict[str, Any]) -> bool:
        """Save data loading default settings."""
        settings = self.get_workspace_settings()
        settings["data_loading_defaults"] = defaults
        return self.save_workspace_settings(settings)


# Global workspace manager instance
workspace_manager = WorkspaceManager()
