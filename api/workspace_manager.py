"""
Workspace management utilities for nirs4all webapp.

This module handles workspace persistence, configuration, and state management.

Phase 8 Implementation:
- Clear separation between App Config folder and Workspace folders
- App Config (global): UI preferences, linked workspaces, dataset links
- Workspace (local): Runs, predictions, artifacts, pipelines, exports
- WorkspaceScanner for auto-discovery of runs, exports, predictions
- LinkedWorkspace management for multiple nirs4all workspaces
- Default workspace auto-creation in a stable user-writable location
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from .app_config import app_config
from .shared.logger import get_logger
from .shared.runtime_paths import get_portable_root
from .workspace_scanner import WorkspaceScanner

logger = get_logger(__name__)

# nirs4all imports are lazy-loaded via api/lazy_imports.py to speed up backend startup.
# Access via _get_nirs4all_workspace() at call sites.
NIRS4ALL_AVAILABLE = True


# ============================================================================
# Phase 7: Linked Workspace and Scanner classes
# ============================================================================

@dataclass
class LinkedWorkspace:
    """A nirs4all workspace linked to the webapp for discovery."""
    id: str
    path: str
    name: str
    is_active: bool = False
    linked_at: str = ""
    last_scanned: str | None = None
    discovered: dict[str, Any] = field(default_factory=lambda: {
        "runs_count": 0,
        "datasets_count": 0,
        "exports_count": 0,
        "templates_count": 0,
    })

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> LinkedWorkspace:
        return cls(
            id=data.get("id", ""),
            path=data.get("path", ""),
            name=data.get("name", ""),
            is_active=data.get("is_active", False),
            linked_at=data.get("linked_at", ""),
            last_scanned=data.get("last_scanned"),
            discovered=data.get("discovered") or {
                "runs_count": 0,
                "datasets_count": 0,
                "exports_count": 0,
                "templates_count": 0,
            },
        )


@dataclass
class WorkspaceConfig:
    """Configuration for a workspace."""
    path: str
    name: str
    created_at: str
    last_accessed: str
    datasets: list[dict[str, Any]]
    pipelines: list[dict[str, Any]]
    groups: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> WorkspaceConfig:
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
    """Manages nirs4all workspace operations.

    The workspace manager now uses the global AppConfigManager for:
    - App settings (UI preferences, favorites)
    - Linked workspaces list
    - Global dataset links

    Workspace-specific data is stored in each workspace folder.
    """

    def __init__(self):
        # Use the global app config manager
        self.app_config = app_config


        # Keep a process-local active workspace so requests/tests do not depend
        # entirely on the shared app_settings.json state.
        self._active_workspace_override: LinkedWorkspace | None = None

        # Ensure default workspace exists on first launch
        self._active_workspace_override = self.ensure_default_workspace()

    def _set_process_local_active_workspace(self, workspace: LinkedWorkspace | None) -> None:
        """Record active workspace for the current process and sync env state."""
        self._active_workspace_override = workspace
        if workspace is None:
            return

        from .lazy_imports import get_cached, is_ml_ready

        if is_ml_ready():
            _nirs4all_ws = get_cached("nirs4all_workspace", optional=True)
            if _nirs4all_ws is not None:
                _nirs4all_ws.set_active_workspace(workspace.path)
                return
        os.environ["NIRS4ALL_WORKSPACE"] = workspace.path

    def ensure_default_workspace(self) -> LinkedWorkspace | None:
        """Create and link a default workspace if none exists.

        This is called on first launch to ensure users have a workspace
        ready to use. Desktop builds use a stable per-user location instead
        of the current working directory so launch behavior does not depend on
        installer location, shell cwd, or OS launcher quirks.

        Returns:
            The active LinkedWorkspace, or None if creation fails
        """
        workspaces = self.get_linked_workspaces()

        # If workspaces exist, return the active one
        if workspaces:
            active = self.get_active_workspace()
            if active:
                return active
            # If no active, activate the first one
            return self.activate_workspace(workspaces[0].id)

        # No workspaces linked - create default workspace
        default_path = self._get_default_workspace_path()

        try:
            # Create workspace directory structure
            default_path.mkdir(parents=True, exist_ok=True)
            (default_path / "runs").mkdir(exist_ok=True)
            (default_path / "exports").mkdir(exist_ok=True)
            (default_path / "library").mkdir(exist_ok=True)
            (default_path / "library" / "templates").mkdir(exist_ok=True)
            (default_path / "library" / "trained").mkdir(exist_ok=True)

            # Create workspace.json
            workspace_json = {
                "name": "Default Workspace",
                "created_at": datetime.now().isoformat(),
                "settings": {},
            }
            workspace_config_file = default_path / "workspace.json"
            with open(workspace_config_file, "w", encoding="utf-8") as f:
                json.dump(workspace_json, f, indent=2)

            # Link and activate the workspace
            # Use internal method to bypass validation (workspace is empty but valid)
            return self.link_workspace_internal(str(default_path), "Default Workspace", is_new=True)

        except Exception as e:
            logger.error("Failed to create default workspace: %s", e)
            return None

    def _get_default_workspace_path(self) -> Path:
        """Return the default workspace path for the current runtime mode."""
        portable_root = get_portable_root()
        if portable_root is not None:
            return portable_root / "workspace"

        if os.environ.get("NIRS4ALL_DESKTOP") == "true" or getattr(sys, "frozen", False):
            return Path.home() / "Documents" / "nirs4all Studio" / "workspace"

        return Path.cwd() / "workspace"

    def link_workspace_internal(
        self, path: str, name: str, is_new: bool = False, allow_temp: bool = False
    ) -> LinkedWorkspace:
        """Link a workspace without validation.

        Used for creating new workspaces where the directory structure
        is already set up but may not have runs/exports yet.

        Refuses to register paths that live under the OS temp directory
        unless ``allow_temp=True`` is passed. This guards against tests or
        ad-hoc scripts polluting the user's persistent registry with
        short-lived temp directories.
        """
        workspace_path = Path(path).resolve()

        # Guard: refuse to write temp-directory paths into a *production*
        # app_settings.json. Tests that legitimately use temp paths must
        # also redirect the app config dir into the temp tree (e.g. via
        # NIRS4ALL_CONFIG); in that case the guard stays out of the way.
        if not allow_temp:
            temp_root = Path(tempfile.gettempdir()).resolve()
            try:
                workspace_path.relative_to(temp_root)
                workspace_under_temp = True
            except ValueError:
                workspace_under_temp = False

            if workspace_under_temp:
                try:
                    self.app_config.config_dir.resolve().relative_to(temp_root)
                    config_under_temp = True
                except ValueError:
                    config_under_temp = False

                if not config_under_temp:
                    raise ValueError(
                        f"Refusing to register workspace under OS temp directory: {workspace_path}. "
                        "Pass allow_temp=True if this is intentional, or redirect the app "
                        "config dir via NIRS4ALL_CONFIG."
                    )

        now = datetime.now().isoformat()

        settings = self.app_config.get_app_settings()
        workspaces = settings.get("linked_workspaces", [])

        # Check if already linked
        for ws in workspaces:
            if ws.get("path") == str(workspace_path):
                return LinkedWorkspace.from_dict(ws)

        is_first = len(workspaces) == 0  # First workspace is active by default

        # Create linked workspace entry
        linked_ws = LinkedWorkspace(
            id=f"ws_{uuid.uuid4().hex[:16]}",
            path=str(workspace_path),
            name=name or workspace_path.name,
            is_active=is_first,
            linked_at=now,
            last_scanned=now if is_new else None,
            discovered={
                "runs_count": 0,
                "datasets_count": 0,
                "exports_count": 0,
                "templates_count": 0,
            },
        )

        workspaces.append(linked_ws.to_dict())
        settings["linked_workspaces"] = workspaces
        self.app_config.save_app_settings(settings)

        # Set nirs4all workspace if this is the active one
        if is_first:
            from .lazy_imports import get_cached
            _nirs4all_ws = get_cached("nirs4all_workspace", optional=True)
            if _nirs4all_ws is not None:
                _nirs4all_ws.set_active_workspace(str(workspace_path))
            else:
                os.environ["NIRS4ALL_WORKSPACE"] = str(workspace_path)

        return linked_ws

    def set_workspace(self, path: str) -> WorkspaceConfig:
        """Set current workspace by path: links it if needed, then activates it.

        For backward compatibility, this method links the workspace if not
        already linked, then activates it.
        """
        workspace_path = Path(path)
        if not workspace_path.exists():
            raise ValueError(f"Workspace path does not exist: {path}")
        if not workspace_path.is_dir():
            raise ValueError(f"Workspace path is not a directory: {path}")

        # Check if already linked
        resolved = str(workspace_path.resolve())
        for ws in self.get_linked_workspaces():
            if ws.path == resolved:
                active_ws = self.activate_workspace(ws.id)
                self._set_process_local_active_workspace(active_ws or ws)
                return self._create_workspace_config_from_linked(ws)

        # Link and activate - try validated link first, fall back to internal
        try:
            linked_ws = self.link_workspace(resolved)
        except ValueError:
            # Workspace may be newly created or have non-standard structure
            # Use internal link which bypasses strict validation
            linked_ws = self.link_workspace_internal(resolved, workspace_path.name)
        active_ws = self.activate_workspace(linked_ws.id)
        self._set_process_local_active_workspace(active_ws or linked_ws)
        return self._create_workspace_config_from_linked(linked_ws)

    def get_current_workspace(self) -> WorkspaceConfig | None:
        """Get the active workspace as a WorkspaceConfig.

        Returns a WorkspaceConfig for the active linked workspace.
        Datasets are now global (via app_config), not per-workspace.
        """
        active = self.get_active_workspace()
        if not active:
            return None
        return self._create_workspace_config_from_linked(active)

    def _create_workspace_config_from_linked(self, ws: LinkedWorkspace) -> WorkspaceConfig:
        """Create a WorkspaceConfig from a LinkedWorkspace for backward compatibility."""
        # Load workspace.json if it exists
        workspace_path = Path(ws.path)
        config_file = workspace_path / "workspace.json"
        config_data = {}

        if config_file.exists():
            try:
                with open(config_file, encoding="utf-8") as f:
                    config_data = json.load(f)
            except Exception:
                pass

        # Datasets are now global - get from app_config
        datasets = [d.to_dict() for d in self.app_config.get_datasets()]

        return WorkspaceConfig(
            path=ws.path,
            name=ws.name or config_data.get("name", workspace_path.name),
            created_at=ws.linked_at or config_data.get("created_at", datetime.now().isoformat()),
            last_accessed=ws.last_scanned or config_data.get("last_accessed", datetime.now().isoformat()),
            datasets=datasets,
            pipelines=config_data.get("pipelines", []),
            groups=[g.to_dict() for g in self.app_config.get_dataset_groups()],
        )

    def reload_workspace(self) -> WorkspaceConfig | None:
        """Reload the active workspace config."""
        return self.get_current_workspace()

    # ----------------------- Dataset Management (Now Global) -----------------------
    # Thin delegators to app_config, kept for callers in api/datasets.py and
    # api/synthesis.py. Workspace routers call app_config directly.

    def link_dataset(self, dataset_path: str, config: dict[str, Any] | None = None) -> dict[str, Any]:
        """Link a dataset globally (accessible across all workspaces)."""
        dataset = self.app_config.link_dataset(dataset_path, config)
        return dataset.to_dict()

    def unlink_dataset(self, dataset_id: str) -> bool:
        """Unlink a dataset globally."""
        return self.app_config.unlink_dataset(dataset_id)

    def update_dataset(self, dataset_id: str, updates: dict[str, Any]) -> dict[str, Any] | None:
        """Update a dataset's configuration."""
        dataset = self.app_config.update_dataset(dataset_id, updates)
        return dataset.to_dict() if dataset else None

    def refresh_dataset(self, dataset_id: str) -> dict[str, Any] | None:
        """Refresh dataset information (hash, stats)."""
        dataset = self.app_config.refresh_dataset(dataset_id)
        return dataset.to_dict() if dataset else None

    # ----------------------- Workspace Paths -----------------------

    def get_active_workspace_path(self) -> str | None:
        """Get the path to the active workspace for nirs4all runs."""
        active = self.get_active_workspace()
        return active.path if active else None

    def get_results_path(self) -> str | None:
        """Get the results directory path for the active workspace."""
        ws_path = self.get_active_workspace_path()
        if not ws_path:
            return None
        return str(Path(ws_path) / "runs")

    def get_pipelines_path(self) -> str | None:
        """Get the pipelines directory path for the active workspace."""
        ws_path = self.get_active_workspace_path()
        if not ws_path:
            return None
        return str(Path(ws_path) / "pipelines")

    def get_predictions_path(self) -> str | None:
        """Get the predictions directory path for the active workspace.

        Returns the path to the 'predictions' subdirectory within the workspace
        where JSON prediction records are stored.
        """
        ws_path = self.get_active_workspace_path()
        if not ws_path:
            return None
        return str(Path(ws_path) / "predictions")

    # ----------------------- Recent Workspaces (Legacy -> Linked) -----------------------

    def add_to_recent(self, workspace_path: str, name: str | None = None) -> None:
        """Back the /workspace/recent REST contract: linking IS the recents list."""
        # For backward compatibility, link the workspace if not already linked
        workspace_path = str(Path(workspace_path).resolve())
        for ws in self.get_linked_workspaces():
            if ws.path == workspace_path:
                return  # Already linked
        try:
            self.link_workspace(workspace_path, name)
        except ValueError:
            # Validation failed - use internal link as fallback
            try:
                self.link_workspace_internal(workspace_path, name or Path(workspace_path).name)
            except Exception:
                pass  # Truly cannot link

    def remove_from_recent(self, workspace_path: str) -> bool:
        """Back the /workspace/recent REST contract: unlink the workspace."""
        workspace_path = str(Path(workspace_path).resolve())
        for ws in self.get_linked_workspaces():
            if ws.path == workspace_path:
                return self.unlink_workspace(ws.id)
        return False

    def get_recent_workspaces(self, limit: int = 10) -> list[dict[str, Any]]:
        """Back the /workspace/recent REST contract: list linked workspaces."""
        workspaces = []
        for ws in self.get_linked_workspaces()[:limit]:
            workspaces.append({
                "path": ws.path,
                "name": ws.name,
                "created_at": ws.linked_at,
                "last_accessed": ws.last_scanned or ws.linked_at,
                "num_datasets": ws.discovered.get("datasets_count", 0),
                "num_pipelines": 0,  # Pipelines are per-workspace, not tracked here
                "description": None,
            })
        return workspaces

    def list_workspaces(self) -> list[dict[str, Any]]:
        """List all linked workspaces."""
        return self.get_recent_workspaces(limit=100)

    def find_workspace_by_name(self, name: str) -> str | None:
        """Find a workspace path by its name."""
        for ws in self.get_linked_workspaces():
            if ws.name == name:
                return ws.path
        return None

    def load_workspace_config(self, workspace_path: str) -> dict[str, Any] | None:
        """Load workspace configuration from a given path."""
        config_file = Path(workspace_path) / "workspace.json"
        if not config_file.exists():
            return None

        try:
            with open(config_file, encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error("Failed to load workspace config: %s", e)
            return None

    def update_workspace_config(self, workspace_path: str, updates: dict[str, Any]) -> bool:
        """Update workspace configuration."""
        config_file = Path(workspace_path) / "workspace.json"
        if not config_file.exists():
            return False

        try:
            with open(config_file, encoding="utf-8") as f:
                config = json.load(f)

            # Only allow updating certain fields
            allowed_fields = {"name", "description", "settings"}
            for key, value in updates.items():
                if key in allowed_fields:
                    config[key] = value

            config["last_accessed"] = datetime.now().isoformat()

            with open(config_file, "w", encoding="utf-8") as f:
                json.dump(config, f, indent=2)

            return True

        except Exception as e:
            logger.error("Failed to update workspace config: %s", e)
            return False

    # ----------------------- Custom Nodes Management -----------------------

    def get_custom_nodes_path(self) -> Path | None:
        """Get the path to the custom nodes file for the active workspace."""
        ws_path = self.get_active_workspace_path()
        if not ws_path:
            return None
        workspace_path = Path(ws_path)
        nirs4all_dir = workspace_path / ".nirs4all"
        nirs4all_dir.mkdir(exist_ok=True)
        return nirs4all_dir / "custom_nodes.json"

    def get_custom_nodes(self) -> list[dict[str, Any]]:
        """Get all custom nodes for the active workspace."""
        nodes_path = self.get_custom_nodes_path()
        if not nodes_path or not nodes_path.exists():
            return []

        try:
            with open(nodes_path, encoding="utf-8") as f:
                data = json.load(f)
                return data.get("nodes", [])
        except Exception as e:
            logger.error("Failed to load custom nodes: %s", e)
            return []

    def save_custom_nodes(self, nodes: list[dict[str, Any]]) -> bool:
        """Save all custom nodes for the active workspace."""
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
            logger.error("Failed to save custom nodes: %s", e)
            return False

    def add_custom_node(self, node: dict[str, Any]) -> dict[str, Any]:
        """Add a new custom node to the workspace."""
        if not self.get_active_workspace_path():
            raise RuntimeError("No active workspace")

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

    def update_custom_node(self, node_id: str, updates: dict[str, Any]) -> dict[str, Any] | None:
        """Update an existing custom node."""
        if not self.get_active_workspace_path():
            raise RuntimeError("No active workspace")

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
        if not self.get_active_workspace_path():
            raise RuntimeError("No active workspace")

        nodes = self.get_custom_nodes()
        original_len = len(nodes)
        nodes = [n for n in nodes if n.get("id") != node_id]

        if len(nodes) != original_len:
            self.save_custom_nodes(nodes)
            return True
        return False

    def import_custom_nodes(self, nodes_to_import: list[dict[str, Any]], overwrite: bool = False) -> dict[str, Any]:
        """Import custom nodes from an external source."""
        if not self.get_active_workspace_path():
            raise RuntimeError("No active workspace")

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
                        existing_nodes = [n for n in existing_nodes if n.get("id") != node_id]
                        existing_ids.discard(node_id)
                    else:
                        skipped += 1
                        continue

                node["created_at"] = datetime.now().isoformat()
                node["updated_at"] = node["created_at"]
                node["source"] = "imported"
                existing_nodes.append(node)
                existing_ids.add(node_id)
                imported += 1
            except Exception:
                errors += 1

        self.save_custom_nodes(existing_nodes)
        return {"imported": imported, "skipped": skipped, "errors": errors}

    def get_sandbox_settings(self) -> dict[str, Any]:
        """Get sandbox settings for code execution."""
        return {
            "enabled": True,
            "allowedPackages": ["nirs4all", "sklearn", "scipy", "numpy", "pandas"],
            "requireApproval": False,
            "allowUserNodes": True,
        }

    def _default_custom_node_settings(self) -> dict[str, Any]:
        """Default custom node settings."""
        return {
            "enabled": True,
            "allowedPackages": ["nirs4all", "sklearn", "scipy", "numpy", "pandas"],
            "requireApproval": False,
            "allowUserNodes": True,
        }

    def get_custom_node_settings(self) -> dict[str, Any]:
        """Get custom node settings for the active workspace."""
        nodes_path = self.get_custom_nodes_path()
        if not nodes_path:
            return self._default_custom_node_settings()

        settings_path = nodes_path.parent / "custom_node_settings.json"
        if not settings_path.exists():
            return self._default_custom_node_settings()

        try:
            with open(settings_path, encoding="utf-8") as f:
                data = json.load(f)
                defaults = self._default_custom_node_settings()
                return {**defaults, **data}
        except Exception as e:
            logger.error("Failed to load custom node settings: %s", e)
            return self._default_custom_node_settings()

    def save_custom_node_settings(self, settings: dict[str, Any]) -> bool:
        """Save custom node settings for the active workspace."""
        nodes_path = self.get_custom_nodes_path()
        if not nodes_path:
            return False

        try:
            settings_path = nodes_path.parent / "custom_node_settings.json"
            with open(settings_path, "w", encoding="utf-8") as f:
                json.dump(settings, f, indent=2)
            return True
        except Exception as e:
            logger.error("Failed to save custom node settings: %s", e)
            return False

    # ----------------------- Workspace Settings -----------------------

    def get_settings_path(self) -> Path | None:
        """Get the path to the workspace settings file."""
        ws_path = self.get_active_workspace_path()
        if not ws_path:
            return None
        workspace_path = Path(ws_path)
        nirs4all_dir = workspace_path / ".nirs4all"
        nirs4all_dir.mkdir(exist_ok=True)
        return nirs4all_dir / "settings.json"

    def get_workspace_settings(self) -> dict[str, Any]:
        """Get workspace settings including data loading defaults."""
        settings_path = self.get_settings_path()
        if not settings_path or not settings_path.exists():
            return self._default_workspace_settings()

        try:
            with open(settings_path, encoding="utf-8") as f:
                data = json.load(f)
                defaults = self._default_workspace_settings()
                return self._deep_merge(defaults, data)
        except Exception as e:
            logger.error("Failed to load workspace settings: %s", e)
            return self._default_workspace_settings()

    @staticmethod
    def _deep_merge(base: dict[str, Any], overrides: dict[str, Any]) -> dict[str, Any]:
        """Deep-merge two dicts."""
        merged: dict[str, Any] = dict(base)
        for key, value in overrides.items():
            if key in merged and isinstance(merged[key], dict) and isinstance(value, dict):
                merged[key] = WorkspaceManager._deep_merge(merged[key], value)
            else:
                merged[key] = value
        return merged

    def save_workspace_settings(self, settings: dict[str, Any]) -> bool:
        """Save workspace settings."""
        settings_path = self.get_settings_path()
        if not settings_path:
            return False

        try:
            existing = self.get_workspace_settings()
            merged = self._deep_merge(existing, settings)
            merged["last_updated"] = datetime.now().isoformat()

            with open(settings_path, "w", encoding="utf-8") as f:
                json.dump(merged, f, indent=2)
            return True
        except Exception as e:
            logger.error("Failed to save workspace settings: %s", e)
            return False

    def _default_workspace_settings(self) -> dict[str, Any]:
        """Get default workspace settings."""
        return {
            "data_loading_defaults": {
                "delimiter": ";",
                "decimal_separator": ".",
                "has_header": True,
                "header_unit": "nm",
                "signal_type": "auto",
                "na_policy": "auto",
                "auto_detect": True,
            },
            "developer_mode": False,
            "cache_enabled": True,
            "general": {
                "theme": "system",
                "ui_density": "comfortable",
                "reduce_animations": False,
                "sidebar_collapsed": False,
                "language": "en",
            },
        }

    def get_data_loading_defaults(self) -> dict[str, Any]:
        """Get default data loading settings for the wizard."""
        settings = self.get_workspace_settings()
        return settings.get("data_loading_defaults", self._default_workspace_settings()["data_loading_defaults"])

    def save_data_loading_defaults(self, defaults: dict[str, Any]) -> bool:
        """Save data loading default settings."""
        settings = self.get_workspace_settings()
        settings["data_loading_defaults"] = defaults
        return self.save_workspace_settings(settings)

    # ----------------------- App Settings (Delegate to AppConfig) -----------------------

    def _get_app_settings_path(self) -> Path:
        """Get the path to the app settings file."""
        return self.app_config._app_settings_path

    def _load_app_settings(self) -> dict[str, Any]:
        """Load app settings from persistent storage."""
        return self.app_config.get_app_settings()

    def _save_app_settings(self, settings: dict[str, Any]) -> None:
        """Save app settings to persistent storage."""
        self.app_config.save_app_settings(settings)

    def _default_app_settings(self) -> dict[str, Any]:
        """Get default app settings."""
        return self.app_config._default_app_settings()

    def get_app_settings(self) -> dict[str, Any]:
        """Get app settings (webapp-specific, not workspace-specific)."""
        return self.app_config.get_app_settings()

    def save_app_settings(self, settings: dict[str, Any]) -> bool:
        """Save app settings."""
        return self.app_config.update_app_settings(settings)

    # ----------------------- Linked Workspaces -----------------------

    def get_linked_workspaces(self) -> list[LinkedWorkspace]:
        """Get all linked nirs4all workspaces."""
        settings = self.app_config.get_app_settings()
        workspaces_data = settings.get("linked_workspaces", [])

        # Migrate legacy colliding IDs (older builds used `ws_{ts}_{len}` which
        # could collide on unlink/relink races). Reassign fresh UUID-based IDs
        # to any duplicates so the frontend never sees two entries sharing a key.
        seen_ids: set[str] = set()
        mutated = False
        for ws in workspaces_data:
            ws_id = ws.get("id")
            if not ws_id or ws_id in seen_ids:
                ws["id"] = f"ws_{uuid.uuid4().hex[:16]}"
                mutated = True
            seen_ids.add(ws["id"])
        if mutated:
            settings["linked_workspaces"] = workspaces_data
            self.app_config.save_app_settings(settings)

        return [LinkedWorkspace.from_dict(ws) for ws in workspaces_data]

    def get_active_workspace(self) -> LinkedWorkspace | None:
        """Get the currently active linked workspace."""
        if self._active_workspace_override and Path(self._active_workspace_override.path).exists():
            return self._active_workspace_override

        workspaces = self.get_linked_workspaces()
        for ws in workspaces:
            if ws.is_active:
                self._set_process_local_active_workspace(ws)
                return ws

        env_workspace = os.environ.get("NIRS4ALL_WORKSPACE")
        if env_workspace:
            env_path = Path(env_workspace).resolve()
            if env_path.exists():
                for ws in workspaces:
                    if Path(ws.path).resolve() == env_path:
                        ws.is_active = True
                        self._set_process_local_active_workspace(ws)
                        return ws

                fallback = LinkedWorkspace(
                    id="env_active_workspace",
                    path=str(env_path),
                    name=env_path.name,
                    is_active=True,
                    linked_at="",
                )
                self._set_process_local_active_workspace(fallback)
                return fallback
        return None

    def link_workspace(self, path: str, name: str | None = None) -> LinkedWorkspace:
        """Link a nirs4all workspace for discovery."""
        workspace_path = Path(path).resolve()

        # Validate workspace
        scanner = WorkspaceScanner(workspace_path)
        is_valid, reason = scanner.is_valid_workspace()
        if not is_valid:
            raise ValueError(f"Invalid nirs4all workspace: {reason}")

        # Check if already linked
        settings = self.app_config.get_app_settings()
        workspaces = settings.get("linked_workspaces", [])
        for ws in workspaces:
            if ws.get("path") == str(workspace_path):
                raise ValueError("Workspace already linked")

        # Create linked workspace entry
        now = datetime.now().isoformat()
        linked_ws = LinkedWorkspace(
            id=f"ws_{uuid.uuid4().hex[:16]}",
            path=str(workspace_path),
            name=name or workspace_path.name,
            is_active=len(workspaces) == 0,
            linked_at=now,
        )

        # Perform initial scan
        scan_result = scanner.scan()
        linked_ws.last_scanned = now
        linked_ws.discovered = {
            "runs_count": scan_result["summary"]["runs_count"],
            "datasets_count": scan_result["summary"]["datasets_count"],
            "exports_count": scan_result["summary"]["exports_count"],
            "templates_count": scan_result["summary"]["templates_count"],
        }

        workspaces.append(linked_ws.to_dict())
        settings["linked_workspaces"] = workspaces
        self.app_config.save_app_settings(settings)

        return linked_ws

    def unlink_workspace(self, workspace_id: str) -> bool:
        """Unlink a nirs4all workspace (doesn't delete files)."""
        settings = self.app_config.get_app_settings()
        workspaces = settings.get("linked_workspaces", [])
        original_len = len(workspaces)

        was_active = False
        for ws in workspaces:
            if ws.get("id") == workspace_id and ws.get("is_active"):
                was_active = True
                break

        workspaces = [ws for ws in workspaces if ws.get("id") != workspace_id]

        if len(workspaces) == original_len:
            return False

        if was_active and workspaces:
            workspaces[0]["is_active"] = True

        settings["linked_workspaces"] = workspaces
        self.app_config.save_app_settings(settings)
        return True

    def prune_missing_workspaces(self) -> list[dict[str, Any]]:
        """Remove leaked/orphan workspace entries.

        An entry is removed when either:
          - its directory no longer exists on disk, OR
          - its path lives under the OS temp directory (temp paths are
            always considered leaked test/debug artefacts; the
            ``link_workspace_internal`` guard prevents new ones from
            being added in the first place).

        Returns the list of removed entries (id, path, name). If the
        active workspace is among the removed entries, the first
        remaining workspace is activated; if none remain, a new default
        workspace is created.
        """
        settings = self.app_config.get_app_settings()
        workspaces = settings.get("linked_workspaces", [])
        temp_root = Path(tempfile.gettempdir()).resolve()

        kept: list[dict[str, Any]] = []
        removed: list[dict[str, Any]] = []
        active_removed = False

        for ws in workspaces:
            path_str = ws.get("path", "")
            try:
                exists = bool(path_str) and Path(path_str).exists()
            except OSError:
                exists = False

            under_temp = False
            if path_str:
                try:
                    Path(path_str).resolve().relative_to(temp_root)
                    under_temp = True
                except (ValueError, OSError):
                    under_temp = False

            if exists and not under_temp:
                kept.append(ws)
            else:
                removed.append({
                    "id": ws.get("id", ""),
                    "path": path_str,
                    "name": ws.get("name", ""),
                    "reason": "under_temp" if under_temp else "missing",
                })
                if ws.get("is_active"):
                    active_removed = True

        if not removed:
            return []

        if active_removed and kept and not any(ws.get("is_active") for ws in kept):
            kept[0]["is_active"] = True

        settings["linked_workspaces"] = kept
        self.app_config.save_app_settings(settings)

        # If we just removed the active workspace, refresh the process-local
        # active state from whatever is now active (or recreate a default).
        if active_removed:
            new_active = self.get_active_workspace()
            if new_active is None:
                new_active = self.ensure_default_workspace()
            if new_active is not None:
                self._set_process_local_active_workspace(new_active)

        return removed

    def activate_workspace(self, workspace_id: str) -> LinkedWorkspace | None:
        """Set a linked workspace as active.

        This updates the webapp's active workspace and also calls
        nirs4all.workspace.set_active_workspace() to ensure the nirs4all
        library uses the same workspace path.
        """
        settings = self.app_config.get_app_settings()
        workspaces = settings.get("linked_workspaces", [])

        found = None
        for ws in workspaces:
            if ws.get("id") == workspace_id:
                ws["is_active"] = True
                found = LinkedWorkspace.from_dict(ws)
            else:
                ws["is_active"] = False

        if found:
            settings["linked_workspaces"] = workspaces
            self.app_config.save_app_settings(settings)
            self._set_process_local_active_workspace(found)

        return found

    def scan_workspace(self, workspace_id: str) -> dict[str, Any]:
        """Trigger a scan of a linked workspace."""
        settings = self.app_config.get_app_settings()
        workspaces = settings.get("linked_workspaces", [])

        for ws in workspaces:
            if ws.get("id") == workspace_id:
                scanner = WorkspaceScanner(Path(ws["path"]))
                is_valid, reason = scanner.is_valid_workspace()
                if not is_valid:
                    raise ValueError(f"Workspace no longer valid: {reason}")

                scan_result = scanner.scan()
                now = datetime.now().isoformat()

                ws["last_scanned"] = now
                ws["discovered"] = {
                    "runs_count": scan_result["summary"]["runs_count"],
                    "datasets_count": scan_result["summary"]["datasets_count"],
                    "exports_count": scan_result["summary"]["exports_count"],
                    "templates_count": scan_result["summary"]["templates_count"],
                }

                settings["linked_workspaces"] = workspaces
                self.app_config.save_app_settings(settings)

                return scan_result

        raise ValueError(f"Workspace not found: {workspace_id}")

    # ----------------------- Workspace Discovery -----------------------

    def get_workspace_predictions(self, workspace_id: str) -> list[dict[str, Any]]:
        """Get discovered predictions from a workspace."""
        ws = self._find_linked_workspace(workspace_id)
        if not ws:
            raise ValueError(f"Workspace not found: {workspace_id}")

        scanner = WorkspaceScanner(Path(ws.path))
        return scanner.discover_predictions()

    def get_workspace_exports(self, workspace_id: str) -> list[dict[str, Any]]:
        """Get discovered exports from a workspace."""
        ws = self._find_linked_workspace(workspace_id)
        if not ws:
            raise ValueError(f"Workspace not found: {workspace_id}")

        scanner = WorkspaceScanner(Path(ws.path))
        return scanner.discover_exports()

    def get_workspace_templates(self, workspace_id: str) -> list[dict[str, Any]]:
        """Get discovered templates from a workspace."""
        ws = self._find_linked_workspace(workspace_id)
        if not ws:
            raise ValueError(f"Workspace not found: {workspace_id}")

        scanner = WorkspaceScanner(Path(ws.path))
        return scanner.discover_templates()

    def _find_linked_workspace(self, workspace_id: str) -> LinkedWorkspace | None:
        """Find a linked workspace by ID."""
        for ws in self.get_linked_workspaces():
            if ws.id == workspace_id:
                return ws
        return None

    # ----------------------- Favorite Pipelines -----------------------

    def get_favorite_pipelines(self) -> list[str]:
        """Get list of favorite pipeline IDs."""
        return self.app_config.get_favorites()

    def add_favorite_pipeline(self, pipeline_id: str) -> bool:
        """Add a pipeline to favorites."""
        return self.app_config.add_favorite(pipeline_id)

    def remove_favorite_pipeline(self, pipeline_id: str) -> bool:
        """Remove a pipeline from favorites."""
        return self.app_config.remove_favorite(pipeline_id)


# Global workspace manager instance
workspace_manager = WorkspaceManager()
