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
    from nirs4all.data.dataset_config import DatasetConfigs
    from nirs4all.data.dataset_config_parser import parse_config
    from nirs4all.data.loader import handle_data
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

        # Create dataset info
        dataset_info = {
            "id": f"dataset_{len(self._workspace_config.datasets) + 1}_{int(datetime.now().timestamp())}",
            "name": Path(dataset_path).name,
            "path": dataset_path,
            "linked_at": datetime.now().isoformat(),
            "num_samples": 0,
            "num_features": 0,
            "num_targets": 0,
            "config": config or {},
        }

        # Check if already linked
        for existing in self._workspace_config.datasets:
            if existing["path"] == dataset_info["path"]:
                raise ValueError("Dataset already linked")

        # Add to workspace
        self._workspace_config.datasets.append(dataset_info)
        self._workspace_config.last_accessed = datetime.now().isoformat()
        self._save_workspace_config()

        return dataset_info

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


# Global workspace manager instance
workspace_manager = WorkspaceManager()
