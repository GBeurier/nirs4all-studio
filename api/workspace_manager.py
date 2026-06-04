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
import yaml
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple
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


class WorkspaceScanner:
    """Scans and discovers content from nirs4all workspaces.

    Primary discovery uses the ``WorkspaceStore`` (``store.sqlite``).
    Falls back to filesystem scanning only when the store file does not
    exist (legacy workspaces).

    Discovery targets:
    - Runs (from ``store.sqlite`` or ``workspace/runs/`` manifests)
    - Predictions (from ``store.sqlite`` or ``.meta.parquet`` files)
    - Exports (from ``workspace/exports/``)
    - Library templates (from ``workspace/library/``)
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

        # Lazily initialised StoreAdapter (only when store file exists)
        self._store_adapter = None

    @property
    def store_adapter(self):
        """Return a ``StoreAdapter`` if a workspace store file exists, else ``None``."""
        if self._store_adapter is not None:
            return self._store_adapter
        store_db = self._find_store_file()
        if store_db is not None:
            try:
                from .store_adapter import StoreAdapter
                self._store_adapter = StoreAdapter(store_db.parent)
            except Exception as exc:
                print(f"Note: Could not open WorkspaceStore: {exc}")
        return self._store_adapter

    def _find_store_file(self) -> "Path | None":
        """Locate the workspace store file (SQLite preferred, DuckDB legacy fallback)."""
        for name in ("store.sqlite", "store.duckdb"):
            for parent in (self.workspace_dir, self.workspace_path):
                candidate = parent / name
                if candidate.exists():
                    return candidate
        return None

    def _has_store(self) -> bool:
        """Return ``True`` if a workspace store is available."""
        return self.store_adapter is not None

    def is_valid_workspace(self) -> Tuple[bool, str]:
        """Check if the path is a valid nirs4all workspace.

        Returns:
            Tuple of (is_valid, reason)
        """
        if not self.workspace_path.exists():
            return False, "Path does not exist"

        if not self.workspace_path.is_dir():
            return False, "Path is not a directory"

        # Workspace store is the primary indicator
        if self._has_store():
            return True, "Valid nirs4all workspace (store found)"

        # workspace.json is a strong indicator (created by create_workspace)
        if (self.workspace_path / "workspace.json").exists():
            return True, "Valid nirs4all workspace (workspace.json)"

        # Check for workspace subdirectory or direct workspace structure
        has_workspace_dir = self.workspace_dir.exists()
        has_runs = (self.workspace_dir / "runs").exists() if has_workspace_dir else False
        has_exports = (self.workspace_dir / "exports").exists() if has_workspace_dir else False
        has_predictions = any(self.workspace_path.glob("*.meta.parquet"))

        # Also accept legacy directory structure
        has_legacy = (
            (self.workspace_path / "results").exists()
            or (self.workspace_path / "pipelines").exists()
            or (self.workspace_path / "models").exists()
        )

        if not (has_runs or has_exports or has_predictions or has_legacy):
            return False, "No runs/, exports/, prediction files, or workspace.json found"

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
        """Discover all runs.

        When a workspace store exists, runs are read from ``store.list_runs()``.
        Otherwise falls back to filesystem manifest scanning (legacy path).

        Returns:
            List of run information dictionaries.
        """
        # ---- Store path (primary) ----
        if self._has_store():
            return self._discover_runs_from_store()

        # ---- Legacy filesystem path ----
        runs: List[Dict[str, Any]] = []
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

    def _discover_runs_from_store(self) -> List[Dict[str, Any]]:
        """Discover runs via ``WorkspaceStore.list_runs()``.

        Returns:
            List of run information dictionaries formatted for the webapp.
        """
        adapter = self.store_adapter
        if adapter is None:
            return []
        df = adapter.store.list_runs(limit=500)
        runs = []
        for row in df.iter_rows(named=True):
            created_at = row.get("created_at")
            if isinstance(created_at, datetime):
                created_at = created_at.isoformat()
            completed_at = row.get("completed_at")
            if isinstance(completed_at, datetime):
                completed_at = completed_at.isoformat()

            # Deserialise JSON fields that the store returns as strings
            datasets_raw = row.get("datasets")
            datasets = []
            if isinstance(datasets_raw, str):
                try:
                    datasets = json.loads(datasets_raw)
                except (json.JSONDecodeError, TypeError):
                    pass
            elif isinstance(datasets_raw, list):
                datasets = datasets_raw

            summary_raw = row.get("summary")
            summary = {}
            if isinstance(summary_raw, str):
                try:
                    summary = json.loads(summary_raw)
                except (json.JSONDecodeError, TypeError):
                    pass
            elif isinstance(summary_raw, dict):
                summary = summary_raw

            runs.append({
                "id": row.get("run_id", ""),
                "name": row.get("name", ""),
                "status": row.get("status", "unknown"),
                "created_at": created_at or "",
                "completed_at": completed_at or "",
                "format": "store",
                "datasets": datasets,
                "summary": summary,
                "error": row.get("error"),
            })
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
        """Discover prediction databases.

        When a workspace store exists, predictions are read from
        ``store.query_predictions()``.  Otherwise falls back to scanning
        ``.meta.parquet`` / JSON files on the filesystem (legacy path).

        Returns:
            List of prediction database information.
        """
        # ---- Store path (primary) ----
        if self._has_store():
            return self._discover_predictions_from_store()

        # ---- Legacy filesystem path ----
        predictions: List[Dict[str, Any]] = []

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

    def _discover_predictions_from_store(self) -> List[Dict[str, Any]]:
        """Discover predictions via ``WorkspaceStore.query_predictions()``.

        Groups predictions by dataset and returns one entry per dataset,
        matching the legacy format that the frontend expects.

        Returns:
            List of prediction summaries (one per dataset).
        """
        adapter = self.store_adapter
        if adapter is None:
            return []
        df = adapter.store.query_predictions()
        if len(df) == 0:
            return []

        # Group by dataset_name to mirror the old per-file structure
        dataset_counts: Dict[str, int] = {}
        for row in df.iter_rows(named=True):
            ds = row.get("dataset_name", "unknown")
            dataset_counts[ds] = dataset_counts.get(ds, 0) + 1

        return [
            {"dataset": ds_name, "format": "store", "prediction_count": count}
            for ds_name, count in sorted(dataset_counts.items())
        ]

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
        """Discover individual results (pipeline config x dataset combinations).

        When a workspace store exists, results are read from
        ``store.list_pipelines()``.  Otherwise falls back to filesystem
        manifest scanning (legacy path).

        Args:
            run_id: Optional run ID to filter results for a specific run.

        Returns:
            List of result information dictionaries.
        """
        # ---- Store path (primary) ----
        if self._has_store():
            return self._discover_results_from_store(run_id)

        # ---- Legacy filesystem path ----
        results: List[Dict[str, Any]] = []
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

    def _discover_results_from_store(self, run_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Discover results via ``WorkspaceStore.list_pipelines()``.

        Args:
            run_id: Optional run ID to filter results.

        Returns:
            List of result information dictionaries formatted for the webapp.
        """
        adapter = self.store_adapter
        if adapter is None:
            return []
        df = adapter.store.list_pipelines(run_id=run_id)
        results = []
        for row in df.iter_rows(named=True):
            created_at = row.get("created_at")
            if isinstance(created_at, datetime):
                created_at = created_at.isoformat()
            results.append({
                "id": row.get("pipeline_id", ""),
                "run_id": row.get("run_id", ""),
                "dataset": row.get("dataset_name", ""),
                "pipeline_config": row.get("name", ""),
                "pipeline_config_id": row.get("pipeline_id", ""),
                "created_at": created_at or "",
                "best_score": row.get("best_val"),
                "best_test_score": row.get("best_test"),
                "metric": row.get("metric", ""),
                "status": row.get("status", ""),
                "duration_ms": row.get("duration_ms"),
                "format": "store",
            })
        return results


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
