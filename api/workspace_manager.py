"""
Workspace management utilities for nirs4all Studio.

This module handles workspace persistence, configuration, and state management.

Phase 8 Implementation:
- Clear separation between App Config folder and Workspace folders
- App Config (global): UI preferences, linked workspaces, dataset links
- Workspace (local): Runs, predictions, artifacts, pipelines, exports
- WorkspaceScanner for auto-discovery of runs, exports, predictions
- LinkedWorkspace management for multiple nirs4all workspaces
- Default workspace auto-creation in current directory
"""

from __future__ import annotations

import json
import os
import sys
import threading
from pathlib import Path
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, asdict, field
from datetime import datetime

from .app_config import app_config

# Try to import nirs4all components (optional)
try:
    nirs4all_path = Path(__file__).parent.parent.parent / "nirs4all"
    if str(nirs4all_path) not in sys.path:
        sys.path.insert(0, str(nirs4all_path))
    from nirs4all.data import DatasetConfigs
    from nirs4all.data.config_parser import parse_config
    from nirs4all.data.loaders.loader import handle_data
    from nirs4all import workspace as nirs4all_workspace
    NIRS4ALL_AVAILABLE = True
except ImportError as e:
    print(f"Note: nirs4all not available, using stub functionality: {e}")
    DatasetConfigs = None
    parse_config = None
    handle_data = None
    nirs4all_workspace = None
    NIRS4ALL_AVAILABLE = False


def _set_active_workspace_best_effort(path: str) -> bool:
    """Synchronize the active workspace with nirs4all when it is ready.

    During desktop startup, the workspace registry is initialized before all ML
    dependencies may be ready. The Studio workspace should still be created and
    persisted; nirs4all can pick up the path from the environment once ready.
    """
    os.environ["NIRS4ALL_WORKSPACE"] = path

    if nirs4all_workspace is None:
        return False

    try:
        nirs4all_workspace.set_active_workspace(path)
        return True
    except Exception as exc:
        detail = getattr(exc, "detail", None) or str(exc)
        print(
            "Could not sync active workspace with nirs4all yet; "
            f"using NIRS4ALL_WORKSPACE fallback: {exc.__class__.__name__}: {detail}"
        )
        return False


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
    last_scanned: Optional[str] = None
    discovered: Dict[str, Any] = field(default_factory=lambda: {
        "runs_count": 0,
        "datasets_count": 0,
        "exports_count": 0,
        "templates_count": 0,
    })

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "LinkedWorkspace":
        return cls(
            id=data.get("id", ""),
            path=data.get("path", ""),
            name=data.get("name", ""),
            is_active=data.get("is_active", False),
            linked_at=data.get("linked_at", ""),
            last_scanned=data.get("last_scanned"),
            discovered=data.get("discovered", {
                "runs_count": 0,
                "datasets_count": 0,
                "exports_count": 0,
                "templates_count": 0,
            }),
        )


# WorkspaceScanner now lives in its own module; re-exported here so that
# existing importers (api.workspace, api.dashboard, tests) keep working via
# ``from .workspace_manager import WorkspaceScanner``.
from .workspace_scanner import WorkspaceScanner


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

        # For backward compatibility, keep app_data_dir reference
        self.app_data_dir = self.app_config.config_dir

        # Long-lived StoreAdapter cache (one open WorkspaceStore connection
        # reused across requests). Keyed by the active workspace path so a
        # workspace switch transparently rebuilds it.
        self._store_adapter = None
        self._store_adapter_path: Optional[str] = None
        self._store_adapter_lock = threading.Lock()

        # Ensure default workspace exists on first launch
        self.ensure_default_workspace()

    def ensure_default_workspace(self) -> Optional[LinkedWorkspace]:
        """Create and link a default workspace if none exists.

        This is called on first launch to ensure users have a workspace
        ready to use. The default workspace is created in the current
        working directory as ./workspace.

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
        default_path = Path.cwd() / "workspace"

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
            print(f"Failed to create default workspace: {e}")
            return None

    def link_workspace_internal(
        self, path: str, name: str, is_new: bool = False
    ) -> LinkedWorkspace:
        """Link a workspace without validation.

        Used for creating new workspaces where the directory structure
        is already set up but may not have runs/exports yet.
        """
        workspace_path = Path(path).resolve()
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
            id=f"ws_{int(datetime.now().timestamp())}_{len(workspaces)}",
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
            _set_active_workspace_best_effort(str(workspace_path))

        return linked_ws

    def set_workspace(self, path: str) -> "WorkspaceConfig":
        """Legacy: Set current workspace - now links and activates the workspace.

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
                self.activate_workspace(ws.id)
                return self._create_workspace_config_from_linked(ws)

        # Link and activate - try validated link first, fall back to internal
        try:
            linked_ws = self.link_workspace(resolved)
        except ValueError:
            # Workspace may be newly created or have non-standard structure
            # Use internal link which bypasses strict validation
            linked_ws = self.link_workspace_internal(resolved, workspace_path.name)
        self.activate_workspace(linked_ws.id)
        return self._create_workspace_config_from_linked(linked_ws)

    def get_current_workspace(self) -> Optional["WorkspaceConfig"]:
        """Legacy: Get current workspace config.

        Returns a WorkspaceConfig for the active linked workspace.
        Datasets are now global (via app_config), not per-workspace.
        """
        active = self.get_active_workspace()
        if not active:
            return None
        return self._create_workspace_config_from_linked(active)

    def _create_workspace_config_from_linked(self, ws: LinkedWorkspace) -> "WorkspaceConfig":
        """Create a WorkspaceConfig from a LinkedWorkspace for backward compatibility."""
        # Load workspace.json if it exists
        workspace_path = Path(ws.path)
        config_file = workspace_path / "workspace.json"
        config_data = {}

        if config_file.exists():
            try:
                with open(config_file, "r", encoding="utf-8") as f:
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

    def reload_workspace(self) -> Optional["WorkspaceConfig"]:
        """Legacy: Reload workspace config."""
        return self.get_current_workspace()

    # ----------------------- Dataset Management (Now Global) -----------------------
    # These methods now delegate to app_config for global dataset management.

    def link_dataset(self, dataset_path: str, config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Link a dataset globally (accessible across all workspaces)."""
        dataset = self.app_config.link_dataset(dataset_path, config)
        return dataset.to_dict()

    def unlink_dataset(self, dataset_id: str) -> bool:
        """Unlink a dataset globally."""
        return self.app_config.unlink_dataset(dataset_id)

    def update_dataset(self, dataset_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update a dataset's configuration."""
        dataset = self.app_config.update_dataset(dataset_id, updates)
        return dataset.to_dict() if dataset else None

    def refresh_dataset(self, dataset_id: str) -> Optional[Dict[str, Any]]:
        """Refresh dataset information (hash, stats)."""
        dataset = self.app_config.refresh_dataset(dataset_id)
        return dataset.to_dict() if dataset else None

    # ----------------------- Groups Management (Now Global) -----------------------

    def get_groups(self) -> List[Dict[str, Any]]:
        """Get all dataset groups with populated dataset_ids."""
        groups = [g.to_dict() for g in self.app_config.get_dataset_groups()]
        datasets = self.app_config.get_datasets()

        # Build a map of group_id -> dataset_ids
        group_datasets: Dict[str, List[str]] = {}
        for ds in datasets:
            gid = ds.group_id
            if gid:
                if gid not in group_datasets:
                    group_datasets[gid] = []
                group_datasets[gid].append(ds.id)

        # Populate dataset_ids for each group
        for g in groups:
            g["dataset_ids"] = group_datasets.get(g["id"], [])

        return groups

    def create_group(self, name: str) -> Dict[str, Any]:
        """Create a new dataset group."""
        group = self.app_config.create_dataset_group(name)
        return group.to_dict()

    def rename_group(self, group_id: str, new_name: str) -> bool:
        """Rename a dataset group."""
        # Update via the full group structure
        data = self.app_config._load_dataset_links()
        groups = data.get("groups", [])
        for g in groups:
            if g.get("id") == group_id:
                g["name"] = new_name
                data["groups"] = groups
                return self.app_config._save_dataset_links(data)
        return False

    def delete_group(self, group_id: str) -> bool:
        """Delete a dataset group."""
        return self.app_config.delete_dataset_group(group_id)

    def add_dataset_to_group(self, group_id: str, dataset_id: str) -> bool:
        """Add a dataset to a group."""
        return self.app_config.add_dataset_to_group(dataset_id, group_id)

    def remove_dataset_from_group(self, group_id: str, dataset_id: str) -> bool:
        """Remove a dataset from its group."""
        return self.app_config.remove_dataset_from_group(dataset_id)

    # ----------------------- Workspace Paths -----------------------

    def get_active_workspace_path(self) -> Optional[str]:
        """Get the path to the active workspace for nirs4all runs."""
        active = self.get_active_workspace()
        return active.path if active else None

    def get_active_store_adapter(self):
        """Return a long-lived ``StoreAdapter`` for the active workspace.

        The adapter wraps a single ``WorkspaceStore`` SQLite connection
        (opened with ``check_same_thread=False`` and guarded by an internal
        lock), so it is safe to reuse across requests and worker threads.
        The adapter is rebuilt when the active workspace path changes and
        returns ``None`` when no workspace is selected or no store file
        exists yet.

        Returns:
            A cached :class:`~api.store_adapter.StoreAdapter`, or ``None``.
        """
        ws_path = self.get_active_workspace_path()
        with self._store_adapter_lock:
            if ws_path is None:
                self._drop_store_adapter_locked()
                return None

            if self._store_adapter is not None and self._store_adapter_path == ws_path:
                return self._store_adapter

            # Active workspace changed (or first access) -- rebuild. We drop the
            # reference rather than close(): an in-flight to_thread worker may
            # still be using the previous connection, and closing it underneath
            # would raise "WorkspaceStore is closed". The orphaned connection is
            # released (and closed) once the last in-flight request lets it go.
            self._drop_store_adapter_locked()

            # Locate the store the same way WorkspaceScanner does -- it supports
            # both <path>/store.sqlite and <path>/workspace/store.sqlite -- so the
            # adapter resolves for every linked-workspace layout (otherwise some
            # layouts would 404 in aggregated_predictions).
            try:
                adapter = WorkspaceScanner(Path(ws_path)).store_adapter
            except Exception as exc:
                print(f"Note: Could not open WorkspaceStore: {exc}")
                adapter = None
            if adapter is None:
                return None
            self._store_adapter = adapter
            self._store_adapter_path = ws_path
            return self._store_adapter

    def _drop_store_adapter_locked(self) -> None:
        """Drop the cached store adapter reference (caller holds the lock).

        Deliberately does NOT close the underlying connection: a concurrent
        to_thread worker may still hold it, and closing underneath would raise
        "WorkspaceStore is closed". Python closes the SQLite connection when the
        last reference is released.
        """
        self._store_adapter = None
        self._store_adapter_path = None

    def _invalidate_store_adapter(self) -> None:
        """Drop the cached store adapter (e.g. on workspace switch/unlink)."""
        with self._store_adapter_lock:
            self._drop_store_adapter_locked()

    def get_results_path(self) -> Optional[str]:
        """Get the results directory path for the active workspace."""
        ws_path = self.get_active_workspace_path()
        if not ws_path:
            return None
        return str(Path(ws_path) / "runs")

    def get_pipelines_path(self) -> Optional[str]:
        """Get the pipelines directory path for the active workspace."""
        ws_path = self.get_active_workspace_path()
        if not ws_path:
            return None
        return str(Path(ws_path) / "pipelines")

    def get_predictions_path(self) -> Optional[str]:
        """Get the predictions directory path for the active workspace.

        Returns the path to the 'predictions' subdirectory within the workspace
        where JSON prediction records are stored.
        """
        ws_path = self.get_active_workspace_path()
        if not ws_path:
            return None
        return str(Path(ws_path) / "predictions")

    # ----------------------- Recent Workspaces (Legacy -> Linked) -----------------------

    def add_to_recent(self, workspace_path: str, name: Optional[str] = None) -> None:
        """Legacy: Add to recent workspaces - now links workspace instead."""
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
        """Legacy: Remove from recent - unlinks the workspace."""
        workspace_path = str(Path(workspace_path).resolve())
        for ws in self.get_linked_workspaces():
            if ws.path == workspace_path:
                return self.unlink_workspace(ws.id)
        return False

    def get_recent_workspaces(self, limit: int = 10) -> List[Dict[str, Any]]:
        """Legacy: Get recent workspaces - returns linked workspaces instead."""
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

    def list_workspaces(self) -> List[Dict[str, Any]]:
        """List all linked workspaces."""
        return self.get_recent_workspaces(limit=100)

    def find_workspace_by_name(self, name: str) -> Optional[str]:
        """Find a workspace path by its name."""
        for ws in self.get_linked_workspaces():
            if ws.name == name:
                return ws.path
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

    def update_workspace_config(self, workspace_path: str, updates: Dict[str, Any]) -> bool:
        """Update workspace configuration."""
        config_file = Path(workspace_path) / "workspace.json"
        if not config_file.exists():
            return False

        try:
            with open(config_file, "r", encoding="utf-8") as f:
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
            print(f"Failed to update workspace config: {e}")
            return False

    # ----------------------- Custom Nodes Management -----------------------

    def get_custom_nodes_path(self) -> Optional[Path]:
        """Get the path to the custom nodes file for the active workspace."""
        ws_path = self.get_active_workspace_path()
        if not ws_path:
            return None
        workspace_path = Path(ws_path)
        nirs4all_dir = workspace_path / ".nirs4all"
        nirs4all_dir.mkdir(exist_ok=True)
        return nirs4all_dir / "custom_nodes.json"

    def get_custom_nodes(self) -> List[Dict[str, Any]]:
        """Get all custom nodes for the active workspace."""
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
            print(f"Failed to save custom nodes: {e}")
            return False

    def add_custom_node(self, node: Dict[str, Any]) -> Dict[str, Any]:
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

    def update_custom_node(self, node_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
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

    def import_custom_nodes(self, nodes_to_import: List[Dict[str, Any]], overwrite: bool = False) -> Dict[str, Any]:
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

    def get_custom_node_settings_path(self) -> Optional[Path]:
        """Get the path to the custom node settings file for the active workspace."""
        ws_path = self.get_active_workspace_path()
        if not ws_path:
            return None
        nirs4all_dir = Path(ws_path) / ".nirs4all"
        nirs4all_dir.mkdir(exist_ok=True)
        return nirs4all_dir / "custom_node_settings.json"

    def get_custom_node_settings(self) -> Dict[str, Any]:
        """Get custom node settings (security allowlist) for the active workspace.

        Returns persisted settings merged over the defaults, or the defaults when
        no workspace is active or no settings have been saved yet.
        """
        defaults = {
            "enabled": True,
            "allowedPackages": ["nirs4all", "sklearn", "scipy", "numpy", "pandas"],
            "requireApproval": False,
            "allowUserNodes": True,
        }
        settings_path = self.get_custom_node_settings_path()
        if not settings_path or not settings_path.exists():
            return defaults

        try:
            with open(settings_path, "r", encoding="utf-8") as f:
                saved = json.load(f)
            return {**defaults, **saved}
        except Exception as e:
            print(f"Failed to load custom node settings: {e}")
            return defaults

    def save_custom_node_settings(self, settings: Dict[str, Any]) -> bool:
        """Save custom node settings for the active workspace."""
        settings_path = self.get_custom_node_settings_path()
        if not settings_path:
            return False

        try:
            with open(settings_path, "w", encoding="utf-8") as f:
                json.dump(settings, f, indent=2)
            return True
        except Exception as e:
            print(f"Failed to save custom node settings: {e}")
            return False

    # ----------------------- Workspace Settings -----------------------

    def get_settings_path(self) -> Optional[Path]:
        """Get the path to the workspace settings file."""
        ws_path = self.get_active_workspace_path()
        if not ws_path:
            return None
        workspace_path = Path(ws_path)
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
                defaults = self._default_workspace_settings()
                return self._deep_merge(defaults, data)
        except Exception as e:
            print(f"Failed to load workspace settings: {e}")
            return self._default_workspace_settings()

    @staticmethod
    def _deep_merge(base: Dict[str, Any], overrides: Dict[str, Any]) -> Dict[str, Any]:
        """Deep-merge two dicts."""
        merged: Dict[str, Any] = dict(base)
        for key, value in overrides.items():
            if key in merged and isinstance(merged[key], dict) and isinstance(value, dict):
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

    def get_data_loading_defaults(self) -> Dict[str, Any]:
        """Get default data loading settings for the wizard."""
        settings = self.get_workspace_settings()
        return settings.get("data_loading_defaults", self._default_workspace_settings()["data_loading_defaults"])

    def save_data_loading_defaults(self, defaults: Dict[str, Any]) -> bool:
        """Save data loading default settings."""
        settings = self.get_workspace_settings()
        settings["data_loading_defaults"] = defaults
        return self.save_workspace_settings(settings)

    # ----------------------- App Settings (Delegate to AppConfig) -----------------------

    def _get_app_settings_path(self) -> Path:
        """Get the path to the app settings file."""
        return self.app_config._app_settings_path

    def _load_app_settings(self) -> Dict[str, Any]:
        """Load app settings from persistent storage."""
        return self.app_config.get_app_settings()

    def _save_app_settings(self, settings: Dict[str, Any]) -> None:
        """Save app settings to persistent storage."""
        self.app_config.save_app_settings(settings)

    def _default_app_settings(self) -> Dict[str, Any]:
        """Get default app settings."""
        return self.app_config._default_app_settings()

    def get_app_settings(self) -> Dict[str, Any]:
        """Get app settings (webapp-specific, not workspace-specific)."""
        return self.app_config.get_app_settings()

    def save_app_settings(self, settings: Dict[str, Any]) -> bool:
        """Save app settings."""
        return self.app_config.update_app_settings(settings)

    # ----------------------- Linked Workspaces -----------------------

    def get_linked_workspaces(self) -> List[LinkedWorkspace]:
        """Get all linked nirs4all workspaces."""
        settings = self.app_config.get_app_settings()
        workspaces_data = settings.get("linked_workspaces", [])
        return [LinkedWorkspace.from_dict(ws) for ws in workspaces_data]

    def get_active_workspace(self) -> Optional[LinkedWorkspace]:
        """Get the currently active linked workspace."""
        workspaces = self.get_linked_workspaces()
        for ws in workspaces:
            if ws.is_active:
                return ws
        return None

    def link_workspace(self, path: str, name: Optional[str] = None) -> LinkedWorkspace:
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
            id=f"ws_{int(datetime.now().timestamp())}_{len(workspaces)}",
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
        if was_active:
            self._invalidate_store_adapter()
        return True

    def activate_workspace(self, workspace_id: str) -> Optional[LinkedWorkspace]:
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

            self._invalidate_store_adapter()
            _set_active_workspace_best_effort(found.path)

        return found

    def scan_workspace(self, workspace_id: str) -> Dict[str, Any]:
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

    def get_workspace_runs(
        self, workspace_id: str, source: str = "unified"
    ) -> List[Dict[str, Any]]:
        """Get discovered runs from a workspace."""
        ws = self._find_linked_workspace(workspace_id)
        if not ws:
            raise ValueError(f"Workspace not found: {workspace_id}")

        scanner = WorkspaceScanner(Path(ws.path))
        return scanner.discover_runs()

    def get_workspace_predictions(self, workspace_id: str) -> List[Dict[str, Any]]:
        """Get discovered predictions from a workspace."""
        ws = self._find_linked_workspace(workspace_id)
        if not ws:
            raise ValueError(f"Workspace not found: {workspace_id}")

        scanner = WorkspaceScanner(Path(ws.path))
        return scanner.discover_predictions()

    def get_workspace_exports(self, workspace_id: str) -> List[Dict[str, Any]]:
        """Get discovered exports from a workspace."""
        ws = self._find_linked_workspace(workspace_id)
        if not ws:
            raise ValueError(f"Workspace not found: {workspace_id}")

        scanner = WorkspaceScanner(Path(ws.path))
        return scanner.discover_exports()

    def get_workspace_templates(self, workspace_id: str) -> List[Dict[str, Any]]:
        """Get discovered templates from a workspace."""
        ws = self._find_linked_workspace(workspace_id)
        if not ws:
            raise ValueError(f"Workspace not found: {workspace_id}")

        scanner = WorkspaceScanner(Path(ws.path))
        return scanner.discover_templates()

    def _find_linked_workspace(self, workspace_id: str) -> Optional[LinkedWorkspace]:
        """Find a linked workspace by ID."""
        for ws in self.get_linked_workspaces():
            if ws.id == workspace_id:
                return ws
        return None

    # ----------------------- Favorite Pipelines -----------------------

    def get_favorite_pipelines(self) -> List[str]:
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
