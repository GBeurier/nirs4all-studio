"""
Workspace management utilities for nirs4all webapp.

This module handles workspace persistence, configuration, and state management.

Phase 6 Implementation:
- List all workspaces
- Recent workspaces tracking
- Workspace export utilities
- Enhanced configuration management

Phase 7 Implementation:
- Clear separation between App Settings and nirs4all Workspaces
- WorkspaceScanner for auto-discovery of runs, exports, predictions
- LinkedWorkspace management for multiple nirs4all workspaces
- Dataset versioning with run-compatibility tracking
"""

import json
import os
import sys
import yaml
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple
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


class WorkspaceScanner:
    """Scans and discovers content from nirs4all workspaces.

    This class handles auto-discovery of:
    - Runs (from workspace/runs/<dataset>/NNNN_xxx/manifest.yaml)
    - Predictions (from <dataset>.meta.parquet files)
    - Exports (from workspace/exports/<dataset>/)
    - Library templates (from workspace/library/)
    """

    def __init__(self, workspace_path: Path):
        """Initialize scanner for a nirs4all workspace.

        Args:
            workspace_path: Root path of the nirs4all workspace (contains workspace/ subdirectory)
        """
        self.workspace_path = Path(workspace_path)
        self.workspace_dir = self.workspace_path / "workspace"

    def is_valid_workspace(self) -> Tuple[bool, str]:
        """Check if the path is a valid nirs4all workspace.

        Returns:
            Tuple of (is_valid, reason)
        """
        if not self.workspace_path.exists():
            return False, "Path does not exist"

        if not self.workspace_path.is_dir():
            return False, "Path is not a directory"

        # Check for workspace subdirectory or direct workspace structure
        has_workspace_dir = self.workspace_dir.exists()
        has_runs = (self.workspace_dir / "runs").exists() if has_workspace_dir else False
        has_exports = (self.workspace_dir / "exports").exists() if has_workspace_dir else False
        has_predictions = any(self.workspace_path.glob("*.meta.parquet"))

        if not (has_runs or has_exports or has_predictions):
            return False, "No runs/, exports/, or prediction files found"

        return True, "Valid nirs4all workspace"

    def scan(self) -> Dict[str, Any]:
        """Perform a full scan of the workspace.

        Returns:
            Dict with discovered runs, predictions, exports, templates, and datasets
        """
        result = {
            "scanned_at": datetime.now().isoformat(),
            "runs": [],
            "predictions": [],
            "exports": [],
            "templates": [],
            "datasets": [],
            "summary": {
                "runs_count": 0,
                "predictions_count": 0,
                "exports_count": 0,
                "templates_count": 0,
                "datasets_count": 0,
            }
        }

        # Scan runs
        result["runs"] = self.discover_runs()
        result["summary"]["runs_count"] = len(result["runs"])

        # Scan predictions
        result["predictions"] = self.discover_predictions()
        result["summary"]["predictions_count"] = len(result["predictions"])

        # Scan exports
        result["exports"] = self.discover_exports()
        result["summary"]["exports_count"] = len(result["exports"])

        # Scan library templates
        result["templates"] = self.discover_templates()
        result["summary"]["templates_count"] = len(result["templates"])

        # Extract unique datasets from runs
        result["datasets"] = self.extract_datasets(result["runs"])
        result["summary"]["datasets_count"] = len(result["datasets"])

        return result

    def discover_runs(self) -> List[Dict[str, Any]]:
        """Discover all runs by parsing manifest.yaml files.

        Returns:
            List of run information dictionaries
        """
        runs = []
        runs_dir = self.workspace_dir / "runs"

        if not runs_dir.exists():
            return runs

        # Iterate through dataset directories
        for dataset_dir in runs_dir.iterdir():
            if not dataset_dir.is_dir() or dataset_dir.name.startswith("_"):
                continue

            dataset_name = dataset_dir.name

            # Find all pipeline directories (NNNN_xxx format)
            for pipeline_dir in dataset_dir.iterdir():
                if not pipeline_dir.is_dir() or pipeline_dir.name.startswith("_"):
                    continue

                manifest_file = pipeline_dir / "manifest.yaml"
                if not manifest_file.exists():
                    continue

                try:
                    run_info = self._parse_manifest(manifest_file, dataset_name, pipeline_dir.name)
                    if run_info:
                        runs.append(run_info)
                except Exception as e:
                    print(f"Failed to parse manifest {manifest_file}: {e}")

        return runs

    def _parse_manifest(self, manifest_file: Path, dataset_name: str, pipeline_id: str) -> Optional[Dict[str, Any]]:
        """Parse a manifest.yaml file and extract run information.

        Args:
            manifest_file: Path to manifest.yaml
            dataset_name: Name of the dataset
            pipeline_id: Pipeline directory name (NNNN_xxx)

        Returns:
            Dict with run information or None if parsing fails
        """
        try:
            with open(manifest_file, "r", encoding="utf-8") as f:
                manifest = yaml.safe_load(f)
        except Exception:
            return None

        if not manifest:
            return None

        # Extract dataset info for version tracking
        dataset_info = manifest.get("dataset_info", {})

        # Count artifacts
        artifacts = manifest.get("artifacts", {})
        if isinstance(artifacts, dict):
            # V2 format
            artifact_count = len(artifacts.get("items", []))
        else:
            # V1 format (list)
            artifact_count = len(artifacts) if isinstance(artifacts, list) else 0

        return {
            "id": manifest.get("uid", pipeline_id),
            "pipeline_id": pipeline_id,
            "name": manifest.get("name", pipeline_id),
            "dataset": dataset_name,
            "created_at": manifest.get("created_at", ""),
            "schema_version": manifest.get("schema_version", "1.0"),
            "artifact_count": artifact_count,
            "predictions_count": len(manifest.get("predictions", [])),
            "dataset_info": dataset_info,
            "manifest_path": str(manifest_file),
        }

    def discover_predictions(self) -> List[Dict[str, Any]]:
        """Discover prediction databases (.meta.parquet files).

        Returns:
            List of prediction database information
        """
        predictions = []

        # Look for .meta.parquet files in workspace root
        for parquet_file in self.workspace_path.glob("*.meta.parquet"):
            dataset_name = parquet_file.stem.replace(".meta", "")
            predictions.append({
                "dataset": dataset_name,
                "path": str(parquet_file),
                "format": "parquet",
                "size_bytes": parquet_file.stat().st_size,
            })

        # Also check for legacy .json prediction files
        for json_file in self.workspace_path.glob("*.json"):
            # Skip workspace.json and other config files
            if json_file.stem in ["workspace", "config", "settings"]:
                continue
            # Check if it looks like a predictions file
            if not json_file.stem.endswith("_predictions"):
                continue
            dataset_name = json_file.stem.replace("_predictions", "")
            predictions.append({
                "dataset": dataset_name,
                "path": str(json_file),
                "format": "json",
                "size_bytes": json_file.stat().st_size,
            })

        return predictions

    def discover_exports(self) -> List[Dict[str, Any]]:
        """Discover all exports (n4a bundles, pipeline.json, summary.json, predictions.csv).

        Returns:
            List of export information dictionaries
        """
        exports = []
        exports_dir = self.workspace_dir / "exports"

        if not exports_dir.exists():
            return exports

        # Iterate through dataset export directories
        for dataset_dir in exports_dir.iterdir():
            if not dataset_dir.is_dir():
                # Check for .n4a bundles at exports root
                if dataset_dir.suffix == ".n4a":
                    exports.append(self._parse_n4a_bundle(dataset_dir))
                continue

            dataset_name = dataset_dir.name

            # Find all export files in this dataset directory
            for export_file in dataset_dir.iterdir():
                if not export_file.is_file():
                    continue

                export_info = None
                if export_file.suffix == ".n4a":
                    export_info = self._parse_n4a_bundle(export_file, dataset_name)
                elif export_file.name.endswith("_pipeline.json"):
                    export_info = self._parse_pipeline_json(export_file, dataset_name)
                elif export_file.name.endswith("_summary.json"):
                    export_info = self._parse_summary_json(export_file, dataset_name)
                elif export_file.name.endswith("_predictions.csv"):
                    export_info = {
                        "type": "predictions_csv",
                        "dataset": dataset_name,
                        "model_name": export_file.stem.replace("_predictions", ""),
                        "path": str(export_file),
                        "size_bytes": export_file.stat().st_size,
                    }

                if export_info:
                    exports.append(export_info)

        return exports

    def _parse_n4a_bundle(self, bundle_path: Path, dataset_name: str = "") -> Dict[str, Any]:
        """Parse an .n4a bundle (ZIP file with manifest.json).

        Args:
            bundle_path: Path to the .n4a file
            dataset_name: Optional dataset name

        Returns:
            Export information dict
        """
        import zipfile

        export_info = {
            "type": "n4a_bundle",
            "name": bundle_path.stem,
            "dataset": dataset_name,
            "path": str(bundle_path),
            "size_bytes": bundle_path.stat().st_size,
        }

        try:
            with zipfile.ZipFile(bundle_path, "r") as zf:
                if "manifest.json" in zf.namelist():
                    manifest_data = json.loads(zf.read("manifest.json"))
                    export_info["bundle_format_version"] = manifest_data.get("bundle_format_version")
                    export_info["nirs4all_version"] = manifest_data.get("nirs4all_version")
                    export_info["pipeline_uid"] = manifest_data.get("pipeline_uid")
        except Exception as e:
            print(f"Failed to read n4a bundle {bundle_path}: {e}")

        return export_info

    def _parse_pipeline_json(self, pipeline_file: Path, dataset_name: str) -> Dict[str, Any]:
        """Parse a pipeline.json export file.

        Args:
            pipeline_file: Path to the *_pipeline.json file
            dataset_name: Dataset name

        Returns:
            Export information dict
        """
        export_info = {
            "type": "pipeline_json",
            "model_name": pipeline_file.stem.replace("_pipeline", ""),
            "dataset": dataset_name,
            "path": str(pipeline_file),
            "size_bytes": pipeline_file.stat().st_size,
        }

        try:
            with open(pipeline_file, "r", encoding="utf-8") as f:
                pipeline_data = json.load(f)
                if isinstance(pipeline_data, list):
                    export_info["steps_count"] = len(pipeline_data)
        except Exception:
            pass

        return export_info

    def _parse_summary_json(self, summary_file: Path, dataset_name: str) -> Dict[str, Any]:
        """Parse a summary.json export file.

        Args:
            summary_file: Path to the *_summary.json file
            dataset_name: Dataset name

        Returns:
            Export information dict
        """
        export_info = {
            "type": "summary_json",
            "model_name": summary_file.stem.replace("_summary", ""),
            "dataset": dataset_name,
            "path": str(summary_file),
        }

        try:
            with open(summary_file, "r", encoding="utf-8") as f:
                summary_data = json.load(f)
                export_info["test_score"] = summary_data.get("test_score")
                export_info["val_score"] = summary_data.get("val_score")
                export_info["export_date"] = summary_data.get("export_date")
                export_info["export_mode"] = summary_data.get("export_mode")
        except Exception:
            pass

        return export_info

    def discover_templates(self) -> List[Dict[str, Any]]:
        """Discover library templates.

        Returns:
            List of template information dictionaries
        """
        templates = []
        library_dir = self.workspace_dir / "library"

        if not library_dir.exists():
            return templates

        # Check templates directory
        templates_dir = library_dir / "templates"
        if templates_dir.exists():
            for template_file in templates_dir.glob("*.json"):
                templates.append(self._parse_template(template_file, "template"))

        # Check trained/pipeline directory
        trained_pipeline_dir = library_dir / "trained" / "pipeline"
        if trained_pipeline_dir.exists():
            for pipeline_dir in trained_pipeline_dir.iterdir():
                if pipeline_dir.is_dir():
                    pipeline_json = pipeline_dir / "pipeline.json"
                    if pipeline_json.exists():
                        templates.append(self._parse_template(pipeline_json, "trained_pipeline"))

        # Check trained/filtered directory
        trained_filtered_dir = library_dir / "trained" / "filtered"
        if trained_filtered_dir.exists():
            for pipeline_dir in trained_filtered_dir.iterdir():
                if pipeline_dir.is_dir():
                    pipeline_json = pipeline_dir / "pipeline.json"
                    if pipeline_json.exists():
                        templates.append(self._parse_template(pipeline_json, "filtered"))

        return templates

    def _parse_template(self, template_file: Path, template_type: str) -> Dict[str, Any]:
        """Parse a template file.

        Args:
            template_file: Path to the template JSON file
            template_type: Type of template (template, trained_pipeline, filtered)

        Returns:
            Template information dict
        """
        template_info = {
            "type": template_type,
            "name": template_file.parent.name if template_type != "template" else template_file.stem,
            "path": str(template_file),
        }

        try:
            with open(template_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                if template_type == "template":
                    template_info["description"] = data.get("description", "")
                    template_info["created_at"] = data.get("created_at", "")
                else:
                    # For pipeline configs
                    if isinstance(data, list):
                        template_info["steps_count"] = len(data)
        except Exception:
            pass

        return template_info

    def extract_datasets(self, runs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Extract unique datasets from discovered runs.

        Args:
            runs: List of discovered run information

        Returns:
            List of unique dataset information with version tracking
        """
        datasets_map: Dict[str, Dict[str, Any]] = {}

        for run in runs:
            dataset_name = run.get("dataset", "")
            if not dataset_name:
                continue

            dataset_info = run.get("dataset_info", {})
            dataset_path = dataset_info.get("path", "")

            if dataset_name not in datasets_map:
                datasets_map[dataset_name] = {
                    "name": dataset_name,
                    "path": dataset_path,
                    "runs_count": 0,
                    "versions_seen": set(),
                    "hashes_seen": set(),
                }

            datasets_map[dataset_name]["runs_count"] += 1

            if dataset_info.get("version_at_run"):
                datasets_map[dataset_name]["versions_seen"].add(dataset_info["version_at_run"])
            if dataset_info.get("hash"):
                datasets_map[dataset_name]["hashes_seen"].add(dataset_info["hash"])

        # Convert sets to lists for JSON serialization
        result = []
        for dataset_name, info in datasets_map.items():
            result.append({
                "name": info["name"],
                "path": info["path"],
                "runs_count": info["runs_count"],
                "versions_seen": list(info["versions_seen"]),
                "hashes_seen": list(info["hashes_seen"]),
            })

        return result


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

    # ----------------------- Linked Workspaces Management (Phase 7) -----------------------

    def _get_app_settings_path(self) -> Path:
        """Get the path to the app settings file."""
        return self.app_data_dir / "app_settings.json"

    def _load_app_settings(self) -> Dict[str, Any]:
        """Load app settings from persistent storage."""
        settings_path = self._get_app_settings_path()
        if settings_path.exists():
            try:
                with open(settings_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                print(f"Failed to load app settings: {e}")
        return self._default_app_settings()

    def _save_app_settings(self, settings: Dict[str, Any]) -> None:
        """Save app settings to persistent storage."""
        settings_path = self._get_app_settings_path()
        try:
            settings["last_updated"] = datetime.now().isoformat()
            with open(settings_path, "w", encoding="utf-8") as f:
                json.dump(settings, f, indent=2)
        except Exception as e:
            print(f"Failed to save app settings: {e}")

    def _default_app_settings(self) -> Dict[str, Any]:
        """Get default app settings."""
        return {
            "version": "2.0",
            "linked_workspaces": [],
            "favorite_pipelines": [],
            "ui_preferences": {
                "theme": "system",
                "density": "comfortable",
                "language": "en",
            },
        }

    def get_app_settings(self) -> Dict[str, Any]:
        """Get app settings (webapp-specific, not workspace-specific)."""
        return self._load_app_settings()

    def save_app_settings(self, settings: Dict[str, Any]) -> bool:
        """Save app settings."""
        try:
            current = self._load_app_settings()
            merged = self._deep_merge(current, settings)
            self._save_app_settings(merged)
            return True
        except Exception as e:
            print(f"Failed to save app settings: {e}")
            return False

    def get_linked_workspaces(self) -> List[LinkedWorkspace]:
        """Get all linked nirs4all workspaces."""
        settings = self._load_app_settings()
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
        """Link a nirs4all workspace for discovery.

        Args:
            path: Path to the nirs4all workspace
            name: Optional display name (defaults to directory name)

        Returns:
            The created LinkedWorkspace

        Raises:
            ValueError: If path is invalid or already linked
        """
        workspace_path = Path(path).resolve()

        # Validate workspace
        scanner = WorkspaceScanner(workspace_path)
        is_valid, reason = scanner.is_valid_workspace()
        if not is_valid:
            raise ValueError(f"Invalid nirs4all workspace: {reason}")

        # Check if already linked
        settings = self._load_app_settings()
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
            is_active=len(workspaces) == 0,  # First workspace is active by default
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

        # Save
        workspaces.append(linked_ws.to_dict())
        settings["linked_workspaces"] = workspaces
        self._save_app_settings(settings)

        return linked_ws

    def unlink_workspace(self, workspace_id: str) -> bool:
        """Unlink a nirs4all workspace (doesn't delete files).

        Args:
            workspace_id: ID of the workspace to unlink

        Returns:
            True if workspace was unlinked
        """
        settings = self._load_app_settings()
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

        # If we removed the active workspace, activate another one
        if was_active and workspaces:
            workspaces[0]["is_active"] = True

        settings["linked_workspaces"] = workspaces
        self._save_app_settings(settings)
        return True

    def activate_workspace(self, workspace_id: str) -> Optional[LinkedWorkspace]:
        """Set a linked workspace as active.

        Args:
            workspace_id: ID of the workspace to activate

        Returns:
            The activated LinkedWorkspace or None if not found
        """
        settings = self._load_app_settings()
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
            self._save_app_settings(settings)

        return found

    def scan_workspace(self, workspace_id: str) -> Dict[str, Any]:
        """Trigger a scan of a linked workspace.

        Args:
            workspace_id: ID of the workspace to scan

        Returns:
            Scan results dict

        Raises:
            ValueError: If workspace not found
        """
        settings = self._load_app_settings()
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
                self._save_app_settings(settings)

                return scan_result

        raise ValueError(f"Workspace not found: {workspace_id}")

    def get_workspace_runs(self, workspace_id: str) -> List[Dict[str, Any]]:
        """Get discovered runs from a linked workspace.

        Args:
            workspace_id: ID of the workspace

        Returns:
            List of run information dicts
        """
        ws = self._find_linked_workspace(workspace_id)
        if not ws:
            return []

        scanner = WorkspaceScanner(Path(ws.path))
        return scanner.discover_runs()

    def get_workspace_predictions(self, workspace_id: str) -> List[Dict[str, Any]]:
        """Get discovered predictions from a linked workspace.

        Args:
            workspace_id: ID of the workspace

        Returns:
            List of prediction database info
        """
        ws = self._find_linked_workspace(workspace_id)
        if not ws:
            return []

        scanner = WorkspaceScanner(Path(ws.path))
        return scanner.discover_predictions()

    def get_workspace_exports(self, workspace_id: str) -> List[Dict[str, Any]]:
        """Get discovered exports from a linked workspace.

        Args:
            workspace_id: ID of the workspace

        Returns:
            List of export information dicts
        """
        ws = self._find_linked_workspace(workspace_id)
        if not ws:
            return []

        scanner = WorkspaceScanner(Path(ws.path))
        return scanner.discover_exports()

    def get_workspace_templates(self, workspace_id: str) -> List[Dict[str, Any]]:
        """Get discovered templates from a linked workspace.

        Args:
            workspace_id: ID of the workspace

        Returns:
            List of template information dicts
        """
        ws = self._find_linked_workspace(workspace_id)
        if not ws:
            return []

        scanner = WorkspaceScanner(Path(ws.path))
        return scanner.discover_templates()

    def _find_linked_workspace(self, workspace_id: str) -> Optional[LinkedWorkspace]:
        """Find a linked workspace by ID."""
        for ws in self.get_linked_workspaces():
            if ws.id == workspace_id:
                return ws
        return None

    # ----------------------- Favorite Pipelines (Phase 7) -----------------------

    def get_favorite_pipelines(self) -> List[str]:
        """Get list of favorite pipeline IDs."""
        settings = self._load_app_settings()
        return settings.get("favorite_pipelines", [])

    def add_favorite_pipeline(self, pipeline_id: str) -> bool:
        """Add a pipeline to favorites.

        Args:
            pipeline_id: ID of the pipeline to favorite

        Returns:
            True if added (False if already favorited)
        """
        settings = self._load_app_settings()
        favorites = settings.get("favorite_pipelines", [])

        if pipeline_id in favorites:
            return False

        favorites.append(pipeline_id)
        settings["favorite_pipelines"] = favorites
        self._save_app_settings(settings)
        return True

    def remove_favorite_pipeline(self, pipeline_id: str) -> bool:
        """Remove a pipeline from favorites.

        Args:
            pipeline_id: ID of the pipeline to unfavorite

        Returns:
            True if removed
        """
        settings = self._load_app_settings()
        favorites = settings.get("favorite_pipelines", [])

        if pipeline_id not in favorites:
            return False

        favorites.remove(pipeline_id)
        settings["favorite_pipelines"] = favorites
        self._save_app_settings(settings)
        return True


# Global workspace manager instance
workspace_manager = WorkspaceManager()
