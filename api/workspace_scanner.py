"""
Workspace content scanner for nirs4all Studio.

This module hosts :class:`WorkspaceScanner`, which auto-discovers runs,
predictions, exports, and library templates from nirs4all workspaces. It was
extracted from ``workspace_manager.py`` to keep that module focused on
workspace persistence and state management.
"""

from __future__ import annotations

import json
import yaml
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime


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

