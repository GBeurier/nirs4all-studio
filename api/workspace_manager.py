"""
Workspace management utilities for nirs4all webapp.

This module handles workspace persistence, configuration, and state management.

Phase 8 Implementation:
- Clear separation between App Config folder and Workspace folders
- App Config (global): UI preferences, linked workspaces, dataset links
- Workspace (local): Runs, predictions, artifacts, pipelines, exports
- WorkspaceScanner for auto-discovery of runs, exports, predictions
- LinkedWorkspace management for multiple nirs4all workspaces
- Default workspace auto-creation in current directory
"""

import json
import os
import sys
import yaml
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, asdict, field
from datetime import datetime

from .app_config import app_config, AppConfigManager

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
                           OR the workspace directory itself (contains runs/, exports/, etc.)
        """
        self.workspace_path = Path(workspace_path)

        # Support both structures:
        # 1. Parent directory containing a workspace/ subdirectory
        # 2. The workspace directory itself (contains runs/, exports/, etc.)
        potential_workspace_dir = self.workspace_path / "workspace"
        if potential_workspace_dir.exists() and potential_workspace_dir.is_dir():
            # Structure 1: workspace_path/workspace/runs/
            self.workspace_dir = potential_workspace_dir
        elif (self.workspace_path / "runs").exists() or (self.workspace_path / "exports").exists():
            # Structure 2: workspace_path is already the workspace dir (runs/ is direct child)
            self.workspace_dir = self.workspace_path
        else:
            # Default to the nested structure
            self.workspace_dir = potential_workspace_dir

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
        """Discover all runs by parsing manifest files.

        Supports two formats:
        1. New format: workspace/runs/<run_id>/run_manifest.yaml
           - Contains templates, multiple datasets, run-level metadata
        2. Legacy format: workspace/runs/<dataset>/<pipeline_id>/manifest.yaml
           - Per-dataset, per-pipeline manifests (treated as individual results)

        Returns:
            List of run information dictionaries
        """
        runs = []
        runs_dir = self.workspace_dir / "runs"

        if not runs_dir.exists():
            return runs

        # First, check for new format: run_manifest.yaml files
        new_format_runs = self._discover_runs_new_format(runs_dir)
        if new_format_runs:
            runs.extend(new_format_runs)

        # Also scan for legacy format (per-dataset/pipeline manifests)
        legacy_runs = self._discover_runs_legacy_format(runs_dir)

        # Filter out legacy runs that are already covered by new format
        new_format_run_ids = {r.get("id") for r in new_format_runs}
        for legacy_run in legacy_runs:
            # Check if this legacy run is part of a new-format run
            if legacy_run.get("run_id") not in new_format_run_ids:
                runs.append(legacy_run)

        return runs

    def _discover_runs_new_format(self, runs_dir: Path) -> List[Dict[str, Any]]:
        """Discover runs using new run_manifest.yaml format.

        New format structure:
        workspace/runs/<run_id>/
        ├── run_manifest.yaml
        ├── templates/
        │   ├── template_001.yaml
        │   └── template_002.yaml
        └── results/
            └── <dataset>/
                └── <pipeline_config>/
                    └── manifest.yaml
        """
        runs = []

        for run_dir in runs_dir.iterdir():
            if not run_dir.is_dir() or run_dir.name.startswith("_"):
                continue

            run_manifest = run_dir / "run_manifest.yaml"
            if not run_manifest.exists():
                continue

            try:
                run_info = self._parse_run_manifest(run_manifest, run_dir)
                if run_info:
                    runs.append(run_info)
            except Exception as e:
                print(f"Failed to parse run manifest {run_manifest}: {e}")

        return runs

    def _parse_run_manifest(self, manifest_file: Path, run_dir: Path) -> Optional[Dict[str, Any]]:
        """Parse a run_manifest.yaml file (new format).

        Args:
            manifest_file: Path to run_manifest.yaml
            run_dir: Path to the run directory

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

        # Extract templates information
        templates = manifest.get("templates", [])
        templates_info = []
        for tmpl in templates:
            templates_info.append({
                "id": tmpl.get("id", ""),
                "name": tmpl.get("name", ""),
                "file": tmpl.get("file", ""),
                "expansion_count": tmpl.get("expansion_count", 1),
            })

        # Extract datasets with full metadata
        datasets = manifest.get("datasets", [])
        datasets_info = []
        for ds in datasets:
            datasets_info.append({
                "name": ds.get("name", ""),
                "path": ds.get("path", ""),
                "hash": ds.get("hash", ""),
                "task_type": ds.get("task_type", ""),
                "n_samples": ds.get("n_samples", 0),
                "n_features": ds.get("n_features", 0),
                "y_columns": ds.get("y_columns", []),
                "y_stats": ds.get("y_stats", {}),
                "wavelength_range": ds.get("wavelength_range", []),
                "wavelength_unit": ds.get("wavelength_unit", ""),
                "version": ds.get("version", ""),
            })

        # Extract summary if available
        summary = manifest.get("summary", {})

        # Count results by scanning results directory
        results_count = 0
        results_dir = run_dir / "results"
        if results_dir.exists():
            for dataset_dir in results_dir.iterdir():
                if dataset_dir.is_dir():
                    results_count += len([d for d in dataset_dir.iterdir() if d.is_dir()])

        return {
            "id": manifest.get("uid", run_dir.name),
            "name": manifest.get("name", run_dir.name),
            "description": manifest.get("description", ""),
            "status": manifest.get("status", "unknown"),
            "created_at": manifest.get("created_at", ""),
            "started_at": manifest.get("started_at", ""),
            "completed_at": manifest.get("completed_at", ""),
            "schema_version": manifest.get("schema_version", "2.0"),
            "manifest_path": str(manifest_file),
            "run_dir": str(run_dir),
            # New format specific fields
            "format": "v2",
            "templates": templates_info,
            "total_pipeline_configs": manifest.get("total_pipeline_configs", 0),
            "datasets": datasets_info,
            "config": manifest.get("config", {}),
            "summary": summary,
            "results_count": summary.get("total_results", results_count),
            "completed_results": summary.get("completed_results", 0),
            "failed_results": summary.get("failed_results", 0),
            "best_result": summary.get("best_result", {}),
            # Checkpoints for Phase 5 robustness
            "checkpoints": manifest.get("checkpoints", []),
            "resume_from": manifest.get("resume_from", None),
        }

    def _discover_runs_legacy_format(self, runs_dir: Path) -> List[Dict[str, Any]]:
        """Discover runs using legacy format (per-dataset/pipeline manifests).

        Legacy format structure:
        workspace/runs/<dataset>/<pipeline_id>/manifest.yaml
        """
        runs = []

        # Iterate through dataset directories
        for dataset_dir in runs_dir.iterdir():
            if not dataset_dir.is_dir() or dataset_dir.name.startswith("_"):
                continue

            # Skip if this looks like a new-format run directory (has run_manifest.yaml)
            if (dataset_dir / "run_manifest.yaml").exists():
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
                        run_info["format"] = "v1"
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

        Supports both:
        - New format: runs with 'datasets' array containing full metadata
        - Legacy format: runs with 'dataset' string and 'dataset_info' dict

        Args:
            runs: List of discovered run information

        Returns:
            List of unique dataset information with version tracking and full metadata
        """
        datasets_map: Dict[str, Dict[str, Any]] = {}

        for run in runs:
            run_format = run.get("format", "v1")

            if run_format == "v2":
                # New format: extract from datasets array
                datasets_list = run.get("datasets", [])
                for ds in datasets_list:
                    ds_name = ds.get("name", "")
                    if not ds_name:
                        continue

                    ds_hash = ds.get("hash", "")
                    key = ds_hash if ds_hash else ds_name

                    if key not in datasets_map:
                        datasets_map[key] = {
                            "name": ds_name,
                            "path": ds.get("path", ""),
                            "hash": ds_hash,
                            "task_type": ds.get("task_type", ""),
                            "n_samples": ds.get("n_samples", 0),
                            "n_features": ds.get("n_features", 0),
                            "y_columns": ds.get("y_columns", []),
                            "y_stats": ds.get("y_stats", {}),
                            "wavelength_range": ds.get("wavelength_range", []),
                            "wavelength_unit": ds.get("wavelength_unit", ""),
                            "runs_count": 0,
                            "versions_seen": set(),
                            "hashes_seen": set(),
                            "status": "unknown",  # Will be updated by path resolution
                        }

                    datasets_map[key]["runs_count"] += 1
                    if ds.get("version"):
                        datasets_map[key]["versions_seen"].add(ds["version"])
                    if ds_hash:
                        datasets_map[key]["hashes_seen"].add(ds_hash)
            else:
                # Legacy format: single dataset per run
                dataset_name = run.get("dataset", "")
                if not dataset_name:
                    continue

                dataset_info = run.get("dataset_info", {})
                dataset_path = dataset_info.get("path", "")

                if dataset_name not in datasets_map:
                    datasets_map[dataset_name] = {
                        "name": dataset_name,
                        "path": dataset_path,
                        "hash": dataset_info.get("hash", ""),
                        "task_type": dataset_info.get("task_type", ""),
                        "n_samples": dataset_info.get("n_samples", 0),
                        "n_features": dataset_info.get("n_features", 0),
                        "y_columns": dataset_info.get("y_columns", []),
                        "y_stats": dataset_info.get("y_stats", {}),
                        "wavelength_range": [],
                        "wavelength_unit": "",
                        "runs_count": 0,
                        "versions_seen": set(),
                        "hashes_seen": set(),
                        "status": "unknown",
                    }

                datasets_map[dataset_name]["runs_count"] += 1

                if dataset_info.get("version_at_run"):
                    datasets_map[dataset_name]["versions_seen"].add(dataset_info["version_at_run"])
                if dataset_info.get("hash"):
                    datasets_map[dataset_name]["hashes_seen"].add(dataset_info["hash"])

        # Convert sets to lists for JSON serialization and resolve path status
        result = []
        for key, info in datasets_map.items():
            # Resolve path status
            path = info.get("path", "")
            status = "unknown"
            if path:
                path_obj = Path(path)
                if path_obj.exists():
                    status = "valid"
                else:
                    # Try relative paths
                    workspace_relative = self.workspace_path / path_obj.name
                    if workspace_relative.exists():
                        status = "relocated"
                        info["path"] = str(workspace_relative)
                    else:
                        status = "missing"

            result.append({
                "name": info["name"],
                "path": info["path"],
                "hash": info.get("hash", ""),
                "task_type": info.get("task_type", ""),
                "n_samples": info.get("n_samples", 0),
                "n_features": info.get("n_features", 0),
                "y_columns": info.get("y_columns", []),
                "y_stats": info.get("y_stats", {}),
                "wavelength_range": info.get("wavelength_range", []),
                "wavelength_unit": info.get("wavelength_unit", ""),
                "runs_count": info["runs_count"],
                "versions_seen": list(info["versions_seen"]),
                "hashes_seen": list(info["hashes_seen"]),
                "status": status,
            })

        return result

    def discover_results(self, run_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Discover individual results (pipeline config × dataset combinations).

        Results are the granular level below runs - each result represents
        one specific pipeline configuration executed on one dataset.

        Args:
            run_id: Optional run ID to filter results for a specific run

        Returns:
            List of result information dictionaries
        """
        results = []
        runs_dir = self.workspace_dir / "runs"

        if not runs_dir.exists():
            return results

        # Check for new format runs first
        for run_dir in runs_dir.iterdir():
            if not run_dir.is_dir() or run_dir.name.startswith("_"):
                continue

            # Filter by run_id if specified
            if run_id and run_dir.name != run_id:
                continue

            run_manifest = run_dir / "run_manifest.yaml"
            if run_manifest.exists():
                # New format: look in results subdirectory
                results_dir = run_dir / "results"
                if results_dir.exists():
                    for dataset_dir in results_dir.iterdir():
                        if not dataset_dir.is_dir():
                            continue
                        for config_dir in dataset_dir.iterdir():
                            if not config_dir.is_dir():
                                continue
                            manifest = config_dir / "manifest.yaml"
                            if manifest.exists():
                                result_info = self._parse_result_manifest(
                                    manifest, run_dir.name, dataset_dir.name, config_dir.name
                                )
                                if result_info:
                                    results.append(result_info)
            else:
                # Legacy format: this directory is a dataset directory
                if run_id:
                    continue  # Can't filter legacy by run_id

                dataset_name = run_dir.name
                for config_dir in run_dir.iterdir():
                    if not config_dir.is_dir() or config_dir.name.startswith("_"):
                        continue
                    manifest = config_dir / "manifest.yaml"
                    if manifest.exists():
                        result_info = self._parse_result_manifest(
                            manifest, None, dataset_name, config_dir.name
                        )
                        if result_info:
                            results.append(result_info)

        return results

    def _parse_result_manifest(
        self,
        manifest_file: Path,
        run_id: Optional[str],
        dataset_name: str,
        config_id: str
    ) -> Optional[Dict[str, Any]]:
        """Parse a result manifest.yaml file.

        Args:
            manifest_file: Path to manifest.yaml
            run_id: Parent run ID (None for legacy format)
            dataset_name: Name of the dataset
            config_id: Pipeline configuration ID

        Returns:
            Dict with result information or None if parsing fails
        """
        try:
            with open(manifest_file, "r", encoding="utf-8") as f:
                manifest = yaml.safe_load(f)
        except Exception:
            return None

        if not manifest:
            return None

        # Extract artifacts
        artifacts = manifest.get("artifacts", {})
        if isinstance(artifacts, dict):
            artifact_count = len(artifacts.get("items", []))
        else:
            artifact_count = len(artifacts) if isinstance(artifacts, list) else 0

        # Extract generator choices if available
        generator_choices = manifest.get("generator_choices", [])

        return {
            "id": manifest.get("uid", config_id),
            "run_id": run_id or manifest.get("run_id", ""),
            "template_id": manifest.get("template_id", ""),
            "dataset": dataset_name,
            "pipeline_config": manifest.get("pipeline_config", config_id),
            "pipeline_config_id": config_id,
            "created_at": manifest.get("created_at", ""),
            "schema_version": manifest.get("schema_version", "1.0"),
            "generator_choices": generator_choices,
            "best_score": manifest.get("best_score"),
            "best_model": manifest.get("best_model", ""),
            "metric": manifest.get("metric", ""),
            "task_type": manifest.get("task_type", ""),
            "n_samples": manifest.get("n_samples", 0),
            "n_features": manifest.get("n_features", 0),
            "predictions_count": len(manifest.get("predictions", [])),
            "artifact_count": artifact_count,
            "manifest_path": str(manifest_file),
        }


# ============================================================================
# Phase 2.2: Dataset Registry with File Locking
# ============================================================================

class DatasetRegistry:
    """Manages a workspace's dataset registry with file locking.

    The registry stores discovered datasets with their metadata,
    enabling auto-discovery when linking workspaces and path
    resolution when files are moved.

    File format: datasets.yaml in workspace root
    """

    SCHEMA_VERSION = "1.0"

    def __init__(self, workspace_path: Path):
        """Initialize registry for a workspace.

        Args:
            workspace_path: Root path of the nirs4all workspace
        """
        self.workspace_path = Path(workspace_path)
        self.registry_path = self.workspace_path / "datasets.yaml"
        self._datasets: Dict[str, Dict[str, Any]] = {}
        self._lock_file: Optional[Path] = None

    def _acquire_lock(self, timeout: float = 5.0) -> bool:
        """Acquire file lock for registry operations.

        Args:
            timeout: Maximum time to wait for lock (seconds)

        Returns:
            True if lock acquired, False otherwise
        """
        import time
        import fcntl

        self._lock_file = self.registry_path.with_suffix(".lock")
        start_time = time.time()

        while time.time() - start_time < timeout:
            try:
                # Create lock file if it doesn't exist
                self._lock_fd = open(self._lock_file, "w")
                fcntl.flock(self._lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return True
            except (IOError, OSError):
                time.sleep(0.1)

        return False

    def _release_lock(self) -> None:
        """Release file lock."""
        import fcntl

        if hasattr(self, "_lock_fd") and self._lock_fd:
            try:
                fcntl.flock(self._lock_fd, fcntl.LOCK_UN)
                self._lock_fd.close()
            except Exception:
                pass
            finally:
                self._lock_fd = None

    def load(self) -> Dict[str, Dict[str, Any]]:
        """Load registry from disk with file locking.

        Returns:
            Dict of datasets keyed by hash or name
        """
        if not self._acquire_lock():
            print("Warning: Could not acquire lock for dataset registry")

        try:
            if self.registry_path.exists():
                with open(self.registry_path, "r", encoding="utf-8") as f:
                    data = yaml.safe_load(f) or {}
                    self._datasets = {
                        ds.get("hash") or ds.get("name"): ds
                        for ds in data.get("datasets", [])
                    }
            else:
                self._datasets = {}
        finally:
            self._release_lock()

        return self._datasets

    def save(self) -> bool:
        """Save registry to disk with file locking.

        Returns:
            True if saved successfully
        """
        if not self._acquire_lock():
            print("Warning: Could not acquire lock for saving dataset registry")
            return False

        try:
            data = {
                "schema_version": self.SCHEMA_VERSION,
                "updated_at": datetime.now().isoformat(),
                "datasets": list(self._datasets.values()),
            }
            with open(self.registry_path, "w", encoding="utf-8") as f:
                yaml.dump(data, f, default_flow_style=False, allow_unicode=True)
            return True
        except Exception as e:
            print(f"Error saving dataset registry: {e}")
            return False
        finally:
            self._release_lock()

    def get_by_hash(self, hash_value: str) -> Optional[Dict[str, Any]]:
        """Get dataset by hash.

        Args:
            hash_value: SHA256 hash of dataset

        Returns:
            Dataset dict or None
        """
        return self._datasets.get(hash_value)

    def get_by_name(self, name: str) -> Optional[Dict[str, Any]]:
        """Get dataset by name.

        Args:
            name: Dataset name

        Returns:
            Dataset dict or None
        """
        for ds in self._datasets.values():
            if ds.get("name") == name:
                return ds
        return None

    def add(self, dataset: Dict[str, Any]) -> str:
        """Add or update a dataset in the registry.

        Args:
            dataset: Dataset info dict

        Returns:
            Key used for the dataset
        """
        key = dataset.get("hash") or dataset.get("name")
        if not key:
            raise ValueError("Dataset must have hash or name")

        # Generate ID if not present
        if "id" not in dataset:
            import hashlib
            hash_input = f"{dataset.get('name', '')}_{dataset.get('hash', '')}"
            dataset["id"] = f"ds_{hashlib.sha256(hash_input.encode()).hexdigest()[:12]}"

        # Set timestamps
        now = datetime.now().isoformat()
        if key not in self._datasets:
            dataset["first_used"] = now
        dataset["last_used"] = now

        self._datasets[key] = dataset
        return key

    def update_path(self, key: str, new_path: str) -> bool:
        """Update the path for a dataset.

        Args:
            key: Dataset hash or name
            new_path: New file path

        Returns:
            True if updated successfully
        """
        if key not in self._datasets:
            return False

        self._datasets[key]["current_path"] = new_path
        self._datasets[key]["last_used"] = datetime.now().isoformat()
        return True

    def update_status(self, key: str, status: str) -> bool:
        """Update the status for a dataset.

        Args:
            key: Dataset hash or name
            status: New status (valid, missing, hash_mismatch, relocated)

        Returns:
            True if updated successfully
        """
        if key not in self._datasets:
            return False

        self._datasets[key]["status"] = status
        return True

    def sync_from_runs(self, runs: List[Dict[str, Any]]) -> int:
        """Sync registry with datasets discovered from runs.

        Args:
            runs: List of run information dicts

        Returns:
            Number of new datasets added
        """
        added = 0

        for run in runs:
            run_format = run.get("format", "v1")

            if run_format == "v2":
                # New format: extract from datasets array
                for ds in run.get("datasets", []):
                    key = ds.get("hash") or ds.get("name")
                    if key and key not in self._datasets:
                        self.add(ds)
                        added += 1
            else:
                # Legacy format: extract from dataset_info
                ds_info = run.get("dataset_info", {})
                ds_name = run.get("dataset", "")
                key = ds_info.get("hash") or ds_name
                if key and key not in self._datasets:
                    ds_entry = {
                        "name": ds_name,
                        "path": ds_info.get("path", ""),
                        "hash": ds_info.get("hash", ""),
                        **ds_info,
                    }
                    self.add(ds_entry)
                    added += 1

        return added

    def resolve_paths(self) -> Dict[str, str]:
        """Resolve paths for all datasets using multi-stage filtering.

        Multi-stage resolution:
        1. Check original path (instant)
        2. Check common relative locations (instant)
        3. Filter by file size (instant) - if available
        4. Search workspace by name pattern (fast)
        5. Verify with full hash only for candidates (slow, but targeted)

        Returns:
            Dict mapping dataset keys to their status
        """
        import hashlib

        results = {}

        for key, ds in self._datasets.items():
            original_path = ds.get("path", "")
            expected_hash = ds.get("hash", "")
            expected_size = ds.get("file_size")
            ds_name = ds.get("name", "")

            # Stage 1: Check original path
            if original_path:
                path_obj = Path(original_path)
                if path_obj.exists():
                    # Verify hash if available
                    if expected_hash:
                        actual_hash = self._compute_hash(path_obj)
                        if actual_hash == expected_hash:
                            ds["status"] = "valid"
                            ds["current_path"] = original_path
                            results[key] = "valid"
                            continue
                        else:
                            ds["status"] = "hash_mismatch"
                            results[key] = "hash_mismatch"
                            continue
                    else:
                        ds["status"] = "valid"
                        ds["current_path"] = original_path
                        results[key] = "valid"
                        continue

            # Stage 2: Check relative locations
            candidates = []
            for relative_path in [
                self.workspace_path / Path(original_path).name if original_path else None,
                self.workspace_path / "data" / Path(original_path).name if original_path else None,
                self.workspace_path / ds_name if ds_name else None,
                self.workspace_path / f"{ds_name}.csv" if ds_name else None,
            ]:
                if relative_path and relative_path.exists():
                    candidates.append(relative_path)

            # Stage 3: Filter by file size (if available)
            if expected_size and candidates:
                candidates = [c for c in candidates if c.stat().st_size == expected_size]

            # Stage 4: Search workspace for matching files
            if not candidates and ds_name:
                for pattern in [f"*{ds_name}*", f"*{ds_name}*.csv", f"*{ds_name}*.parquet"]:
                    found = list(self.workspace_path.rglob(pattern))
                    candidates.extend(found[:10])  # Limit to first 10 matches

            # Stage 5: Verify hash for candidates
            if expected_hash and candidates:
                for candidate in candidates:
                    actual_hash = self._compute_hash(candidate)
                    if actual_hash == expected_hash:
                        ds["status"] = "relocated"
                        ds["current_path"] = str(candidate)
                        results[key] = "relocated"
                        break
                else:
                    ds["status"] = "missing"
                    results[key] = "missing"
            elif candidates:
                # No hash to verify, use first candidate
                ds["status"] = "relocated"
                ds["current_path"] = str(candidates[0])
                results[key] = "relocated"
            else:
                ds["status"] = "missing"
                results[key] = "missing"

        return results

    def _compute_hash(self, file_path: Path, algorithm: str = "sha256") -> str:
        """Compute hash of a file.

        Args:
            file_path: Path to file
            algorithm: Hash algorithm (default: sha256)

        Returns:
            Hash string prefixed with algorithm name
        """
        import hashlib

        hasher = hashlib.new(algorithm)
        with open(file_path, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                hasher.update(chunk)
        return f"{algorithm}:{hasher.hexdigest()}"

    def to_api_response(self) -> List[Dict[str, Any]]:
        """Convert registry to API response format.

        Returns:
            List of dataset dicts ready for JSON serialization
        """
        return list(self._datasets.values())


# ============================================================================
# Phase 4: Schema Migration & Backward Compatibility
# ============================================================================

class SchemaMigrator:
    """Handles schema migration for run manifests.

    Supports automatic detection and migration of:
    - v1 → v2: Legacy per-dataset manifests to run-level manifests
    - Format normalization: Ensures consistent field types
    """

    CURRENT_SCHEMA_VERSION = "2.0"

    @classmethod
    def detect_schema_version(cls, manifest: Dict[str, Any]) -> str:
        """Detect the schema version of a manifest.

        Args:
            manifest: Manifest dictionary

        Returns:
            Schema version string
        """
        # Explicit version
        if "schema_version" in manifest:
            return manifest["schema_version"]

        # V2 indicators
        if "templates" in manifest or "total_pipeline_configs" in manifest:
            return "2.0"

        # V1 indicators
        if "artifacts" in manifest or "predictions" in manifest:
            return "1.0"

        return "unknown"

    @classmethod
    def migrate_to_v2(cls, v1_manifest: Dict[str, Any], dataset_name: str) -> Dict[str, Any]:
        """Migrate a v1 manifest to v2 format.

        Args:
            v1_manifest: Legacy manifest dict
            dataset_name: Name of the dataset

        Returns:
            Migrated v2 manifest dict
        """
        return {
            "schema_version": cls.CURRENT_SCHEMA_VERSION,
            "uid": v1_manifest.get("uid", ""),
            "name": v1_manifest.get("name", ""),
            "description": f"Migrated from v1: {dataset_name}",
            "status": "completed",
            "created_at": v1_manifest.get("created_at", ""),
            "completed_at": v1_manifest.get("created_at", ""),
            "templates": [],  # No templates in v1
            "datasets": [{
                "name": dataset_name,
                "path": v1_manifest.get("dataset_info", {}).get("path", ""),
                "hash": v1_manifest.get("dataset_info", {}).get("hash", ""),
            }],
            "total_pipeline_configs": 1,
            "config": {},
            "summary": {
                "total_results": 1,
                "completed_results": 1,
                "failed_results": 0,
            },
            "_migrated_from": "v1",
            "_original_artifacts": v1_manifest.get("artifacts", {}),
            "_original_predictions": v1_manifest.get("predictions", []),
        }

    @classmethod
    def normalize_manifest(cls, manifest: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize manifest fields to consistent types.

        Args:
            manifest: Manifest dictionary

        Returns:
            Normalized manifest dictionary
        """
        normalized = dict(manifest)

        # Ensure arrays are lists, not tuples
        for key in ["templates", "datasets", "checkpoints"]:
            if key in normalized and isinstance(normalized[key], tuple):
                normalized[key] = list(normalized[key])

        # Ensure timestamps are ISO format strings
        for key in ["created_at", "started_at", "completed_at"]:
            if key in normalized:
                val = normalized[key]
                if val and not isinstance(val, str):
                    try:
                        normalized[key] = datetime.fromisoformat(str(val)).isoformat()
                    except Exception:
                        normalized[key] = str(val)

        return normalized


# ============================================================================
# Phase 5: Run Management with Checkpoints and Resource Locking
# ============================================================================

class RunManager:
    """Manages run lifecycle with checkpoint support and resource locking.

    Features:
    - Checkpoint creation and restoration
    - Concurrent run handling with locks
    - State machine validation
    """

    # Valid state transitions
    VALID_TRANSITIONS = {
        "queued": ["running", "failed"],
        "running": ["completed", "failed", "paused", "partial"],
        "paused": ["running", "failed"],
        "failed": ["queued"],  # retry
        "completed": [],  # terminal
        "partial": ["running", "failed"],  # resume or fail
    }

    def __init__(self, workspace_path: Path):
        """Initialize run manager.

        Args:
            workspace_path: Path to the nirs4all workspace
        """
        self.workspace_path = Path(workspace_path)
        workspace_dir = self.workspace_path / "workspace"
        if workspace_dir.exists():
            self.runs_dir = workspace_dir / "runs"
        else:
            self.runs_dir = self.workspace_path / "runs"
        self._locks: Dict[str, Any] = {}

    def is_valid_transition(self, from_status: str, to_status: str) -> bool:
        """Check if a state transition is valid.

        Args:
            from_status: Current status
            to_status: Target status

        Returns:
            True if transition is valid
        """
        valid_targets = self.VALID_TRANSITIONS.get(from_status, [])
        return to_status in valid_targets

    def create_checkpoint(self, run_id: str, result_id: str) -> Dict[str, Any]:
        """Create a checkpoint for a run.

        Args:
            run_id: Run ID
            result_id: ID of the completed result

        Returns:
            Checkpoint info dict
        """
        checkpoint = {
            "result_id": result_id,
            "completed_at": datetime.now().isoformat(),
        }

        # Update run manifest with checkpoint
        run_dir = self.runs_dir / run_id
        manifest_path = run_dir / "run_manifest.yaml"

        if manifest_path.exists():
            try:
                with open(manifest_path, "r") as f:
                    manifest = yaml.safe_load(f) or {}

                checkpoints = manifest.get("checkpoints", [])
                checkpoints.append(checkpoint)
                manifest["checkpoints"] = checkpoints
                manifest["last_checkpoint"] = checkpoint["completed_at"]

                with open(manifest_path, "w") as f:
                    yaml.dump(manifest, f, default_flow_style=False)
            except Exception as e:
                print(f"Failed to save checkpoint: {e}")

        return checkpoint

    def get_checkpoints(self, run_id: str) -> List[Dict[str, Any]]:
        """Get all checkpoints for a run.

        Args:
            run_id: Run ID

        Returns:
            List of checkpoint info dicts
        """
        run_dir = self.runs_dir / run_id
        manifest_path = run_dir / "run_manifest.yaml"

        if not manifest_path.exists():
            return []

        try:
            with open(manifest_path, "r") as f:
                manifest = yaml.safe_load(f) or {}
            return manifest.get("checkpoints", [])
        except Exception:
            return []

    def get_resume_point(self, run_id: str) -> Optional[str]:
        """Get the result ID to resume from.

        Args:
            run_id: Run ID

        Returns:
            Result ID to resume from, or None if starting fresh
        """
        checkpoints = self.get_checkpoints(run_id)
        if checkpoints:
            return checkpoints[-1].get("result_id")
        return None

    def acquire_run_lock(self, run_id: str, timeout: float = 5.0) -> bool:
        """Acquire a lock for a run.

        Prevents concurrent modifications to the same run.

        Args:
            run_id: Run ID
            timeout: Maximum time to wait for lock

        Returns:
            True if lock acquired
        """
        import time
        import fcntl

        run_dir = self.runs_dir / run_id
        lock_file = run_dir / ".lock"

        run_dir.mkdir(parents=True, exist_ok=True)
        start_time = time.time()

        while time.time() - start_time < timeout:
            try:
                lock_fd = open(lock_file, "w")
                fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                self._locks[run_id] = lock_fd
                return True
            except (IOError, OSError):
                time.sleep(0.1)

        return False

    def release_run_lock(self, run_id: str) -> None:
        """Release a run lock.

        Args:
            run_id: Run ID
        """
        import fcntl

        if run_id in self._locks:
            lock_fd = self._locks[run_id]
            try:
                fcntl.flock(lock_fd, fcntl.LOCK_UN)
                lock_fd.close()
            except Exception:
                pass
            finally:
                del self._locks[run_id]

    def update_run_status(
        self,
        run_id: str,
        new_status: str,
        error_message: Optional[str] = None
    ) -> bool:
        """Update run status with state machine validation.

        Args:
            run_id: Run ID
            new_status: Target status
            error_message: Optional error message for failed status

        Returns:
            True if status was updated
        """
        run_dir = self.runs_dir / run_id
        manifest_path = run_dir / "run_manifest.yaml"

        if not manifest_path.exists():
            return False

        if not self.acquire_run_lock(run_id):
            print(f"Could not acquire lock for run {run_id}")
            return False

        try:
            with open(manifest_path, "r") as f:
                manifest = yaml.safe_load(f) or {}

            current_status = manifest.get("status", "unknown")

            # Validate transition
            if current_status != "unknown" and not self.is_valid_transition(current_status, new_status):
                print(f"Invalid transition: {current_status} → {new_status}")
                return False

            # Update status
            manifest["status"] = new_status
            manifest["status_updated_at"] = datetime.now().isoformat()

            if new_status == "completed":
                manifest["completed_at"] = datetime.now().isoformat()
            elif new_status == "failed" and error_message:
                manifest["error_message"] = error_message

            with open(manifest_path, "w") as f:
                yaml.dump(manifest, f, default_flow_style=False)

            return True
        except Exception as e:
            print(f"Failed to update run status: {e}")
            return False
        finally:
            self.release_run_lock(run_id)

    def cleanup_partial_run(self, run_id: str) -> Dict[str, Any]:
        """Clean up a partial run, preserving completed results.

        Args:
            run_id: Run ID

        Returns:
            Cleanup summary dict
        """
        run_dir = self.runs_dir / run_id
        results_dir = run_dir / "results"

        cleanup_summary = {
            "run_id": run_id,
            "preserved_results": [],
            "removed_partial": [],
        }

        if not results_dir.exists():
            return cleanup_summary

        checkpoints = self.get_checkpoints(run_id)
        completed_result_ids = {cp["result_id"] for cp in checkpoints}

        # Scan results directory
        for dataset_dir in results_dir.iterdir():
            if not dataset_dir.is_dir():
                continue
            for config_dir in dataset_dir.iterdir():
                if not config_dir.is_dir():
                    continue

                result_manifest = config_dir / "manifest.yaml"
                if result_manifest.exists():
                    try:
                        with open(result_manifest, "r") as f:
                            result_data = yaml.safe_load(f) or {}
                        result_id = result_data.get("uid", config_dir.name)

                        if result_id in completed_result_ids:
                            cleanup_summary["preserved_results"].append(result_id)
                        # Keep all results that have manifests - they're complete
                    except Exception:
                        pass
                else:
                    # No manifest = incomplete result, can be removed
                    cleanup_summary["removed_partial"].append(str(config_dir))
                    # Optionally remove the incomplete directory
                    # shutil.rmtree(config_dir)

        return cleanup_summary


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
            return self._link_workspace_internal(str(default_path), "Default Workspace", is_new=True)

        except Exception as e:
            print(f"Failed to create default workspace: {e}")
            return None

    def _link_workspace_internal(
        self, path: str, name: str, is_new: bool = False
    ) -> LinkedWorkspace:
        """Internal method to link a workspace without validation.

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

        # Create linked workspace entry
        linked_ws = LinkedWorkspace(
            id=f"ws_{int(datetime.now().timestamp())}_{len(workspaces)}",
            path=str(workspace_path),
            name=name or workspace_path.name,
            is_active=len(workspaces) == 0,  # First workspace is active by default
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

        return linked_ws

    # ----------------------- Legacy Methods (Deprecated) -----------------------
    # The following methods are kept for backward compatibility but delegate
    # to the new architecture where possible.

    def _load_recent_workspaces(self) -> None:
        """Legacy: Load recent workspaces - now uses linked workspaces instead."""
        pass  # No longer used - linked workspaces replace recent workspaces

    def _save_recent_workspaces(self) -> None:
        """Legacy: Save recent workspaces - now uses linked workspaces instead."""
        pass  # No longer used

    def _load_current_workspace(self) -> None:
        """Legacy: Load current workspace - now uses active linked workspace."""
        pass  # No longer used - active linked workspace is the current one

    def _save_current_workspace(self) -> None:
        """Legacy: Save current workspace."""
        pass  # No longer used

    def _load_workspace_config(self) -> None:
        """Legacy: Load workspace config."""
        pass  # No longer used

    def _create_default_workspace_config(self) -> None:
        """Legacy: Create default workspace config."""
        pass  # No longer used

    def _save_workspace_config(self) -> None:
        """Legacy: Save workspace config."""
        pass  # No longer used

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
        for ws in self.get_linked_workspaces():
            if ws.path == str(workspace_path.resolve()):
                self.activate_workspace(ws.id)
                return self._create_workspace_config_from_linked(ws)

        # Link and activate
        linked_ws = self.link_workspace(str(workspace_path))
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
        """Get all dataset groups."""
        return [g.to_dict() for g in self.app_config.get_dataset_groups()]

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
        """Get the predictions directory path for the active workspace."""
        ws_path = self.get_active_workspace_path()
        if not ws_path:
            return None
        # Predictions are stored at workspace root as .meta.parquet files
        return ws_path

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
            pass  # Already linked or invalid

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

    def get_sandbox_settings(self) -> Dict[str, Any]:
        """Get sandbox settings for code execution."""
        return {
            "enabled": True,
            "allowedPackages": ["nirs4all", "sklearn", "scipy", "numpy", "pandas"],
            "requireApproval": False,
            "allowUserNodes": True,
        }

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
        return True

    def activate_workspace(self, workspace_id: str) -> Optional[LinkedWorkspace]:
        """Set a linked workspace as active."""
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

            # Set environment variable for nirs4all
            os.environ["NIRS4ALL_WORKSPACE"] = found.path

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
