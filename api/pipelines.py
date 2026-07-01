"""
Pipelines API routes for nirs4all webapp.

This module provides FastAPI routes for pipeline management,
including CRUD operations and operator listing from nirs4all.

Phase 2 Implementation:
- Dynamic operator discovery from CONTROLLER_REGISTRY
- Parameter schema extraction via introspection
- Pipeline validation against registered operators
- Pipeline execution preparation
"""

from __future__ import annotations

import inspect
import json
from datetime import datetime
from enum import StrEnum
from pathlib import Path
from typing import Any, get_type_hints

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .pipeline_canonical import (
    canonical_to_editor,
    count_runtime_variants,
    editor_steps_to_runtime_canonical,
    editor_to_canonical,
    hydrate_editor_steps,
    validate_canonical,
)
from .pipeline_canonical import (
    filter_comments as filter_canonical_comments,
)
from .preset_loader import list_presets, load_preset
from .shared.logger import get_logger
from .shared.runtime_grouping import (
    normalize_split_group_by_mapping,
    prepare_pipeline_steps_with_runtime_grouping,
)
from .workspace_manager import workspace_manager

logger = get_logger(__name__)

# nirs4all imports are lazy-loaded via api/lazy_imports.py to speed up backend startup.
from .lazy_imports import get_cached, is_ml_ready

NIRS4ALL_AVAILABLE = True  # Assume available, endpoints guard via require_ml_ready()


class OperatorCategory(StrEnum):
    """Categories for pipeline operators."""
    PREPROCESSING = "preprocessing"
    SPLITTING = "splitting"
    MODELS = "models"
    METRICS = "metrics"
    AUGMENTATION = "augmentation"
    FEATURE_SELECTION = "feature_selection"
    CHARTS = "charts"
    FILTERS = "filters"
    SIGNAL_CONVERSION = "signal_conversion"


class PipelineCreate(BaseModel):
    name: str
    description: str | None = None
    steps: list[dict[str, Any]] = []
    category: str | None = "user"
    task_type: str | None = None  # regression, classification


class PipelineUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    steps: list[dict[str, Any]] | None = None
    is_favorite: bool | None = None
    task_type: str | None = None


class PipelineValidateRequest(BaseModel):
    """Request model for validating a pipeline configuration."""

    steps: list[dict[str, Any]]


class PipelineCountRequest(BaseModel):
    """Request model for counting pipeline variants."""
    steps: list[dict[str, Any]]


class PipelineExecuteRequest(BaseModel):
    """Request model for preparing pipeline execution."""

    dataset_id: str
    partition: str = "train"
    dry_run: bool = False


class PipelineCanonicalImportRequest(BaseModel):
    """Request model for converting canonical payloads into editor steps."""

    content: str | None = None
    payload: Any | None = None
    format: str = "yaml"
    name: str | None = None


class PipelineCanonicalRenderRequest(BaseModel):
    """Request model for rendering current editor steps as canonical content."""

    steps: list[dict[str, Any]]
    name: str | None = None
    description: str | None = None


class PipelineFromPresetRequest(BaseModel):
    """Request model for creating a pipeline from a preset variant."""

    name: str | None = None
    variant: str | None = None


router = APIRouter()


def _get_pipelines_dir() -> Path:
    """Get the pipelines directory for the current workspace."""
    pipelines_path = workspace_manager.get_pipelines_path()
    if not pipelines_path:
        raise HTTPException(status_code=409, detail="No workspace selected")
    path = Path(pipelines_path)
    path.mkdir(exist_ok=True)
    return path


def _load_pipeline(pipeline_id: str) -> dict[str, Any]:
    """Load a pipeline from file."""
    pipelines_dir = _get_pipelines_dir()
    pipeline_file = pipelines_dir / f"{pipeline_id}.json"

    if not pipeline_file.exists():
        raise HTTPException(status_code=404, detail="Pipeline not found")

    try:
        with open(pipeline_file, encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to load pipeline: {str(e)}"
        )


def _save_pipeline(pipeline: dict[str, Any]) -> None:
    """Save a pipeline to file."""
    pipelines_dir = _get_pipelines_dir()
    pipeline_file = pipelines_dir / f"{pipeline['id']}.json"

    try:
        with open(pipeline_file, "w", encoding="utf-8") as f:
            json.dump(pipeline, f, indent=2)
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to save pipeline: {str(e)}"
        )


def _normalize_and_validate_editor_steps(
    steps: list[dict[str, Any]],
    *,
    name: str | None = None,
    description: str | None = None,
) -> list[dict[str, Any]]:
    """Hydrate editor steps and reject invalid definitions before persistence."""
    normalized_steps = hydrate_editor_steps(steps)

    try:
        canonical_payload = editor_to_canonical(
            normalized_steps,
            name=name,
            description=description,
            include_wrapper=True,
        )
        validate_canonical(canonical_payload)
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid pipeline definition: {e}",
        ) from e

    return normalized_steps


@router.get("/pipelines")
async def list_pipelines():
    """List all pipelines in the current workspace."""
    try:
        pipelines_dir = _get_pipelines_dir()
        pipelines = []

        for pipeline_file in pipelines_dir.glob("*.json"):
            try:
                with open(pipeline_file, encoding="utf-8") as f:
                    pipeline = json.load(f)
                    pipelines.append(pipeline)
            except Exception:
                continue

        # Sort by updated_at descending
        pipelines.sort(key=lambda p: p.get("updated_at", ""), reverse=True)

        return {"pipelines": pipelines}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to list pipelines: {str(e)}"
        )


@router.get("/pipelines/presets")
async def get_pipeline_presets():
    """
    Get predefined pipeline presets/templates.

    Presets are loaded from YAML/JSON files in ``api/presets/``. Each file
    is authored in nirs4all's canonical pipeline format. See
    ``docs/_internals/pipeline_preset_authoring.md`` for the schema and
    authoring workflow.

    Files that fail to parse are skipped (and logged) rather than causing
    the endpoint to error.
    """
    presets = list_presets()
    return {
        "presets": presets,
        "total": len(presets),
    }


# ============================================================================
# NOTE: Routes with static paths MUST be defined BEFORE routes with path parameters!
# The routes below forward to their implementations defined later in the file.
# This is necessary because FastAPI matches routes in order of definition.
# ============================================================================


def _resolve_import_payload(
    request: PipelineCanonicalImportRequest,
) -> tuple[list[dict[str, Any]], str | None, str]:
    """Parse an import request and return editor steps plus metadata."""
    import yaml

    try:
        if request.payload is not None:
            imported = request.payload
        elif request.content is not None:
            fmt = request.format.lower()
            if fmt in {"yaml", "yml"}:
                imported = yaml.safe_load(request.content)
            elif fmt == "json":
                imported = json.loads(request.content)
            else:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unsupported import format: {request.format}",
                )
        else:
            raise HTTPException(
                status_code=400,
                detail="Import request must include either 'content' or 'payload'.",
            )
    except HTTPException:
        raise
    except yaml.YAMLError as e:
        raise HTTPException(status_code=400, detail=f"Invalid YAML: {e}") from e
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {e}") from e

    try:
        if isinstance(imported, list):
            imported_steps = canonical_to_editor(imported)
            imported_name = None
            imported_description = ""
        elif isinstance(imported, dict) and "pipeline" in imported:
            imported_steps = canonical_to_editor(imported)
            imported_name = imported.get("name")
            imported_description = imported.get("description", "")
        elif isinstance(imported, dict) and "steps" in imported:
            imported_steps = imported.get("steps", [])
            imported_name = imported.get("name")
            imported_description = imported.get("description", "")
        else:
            raise HTTPException(
                status_code=400,
                detail="Imported payload must be a canonical pipeline wrapper, a canonical step list, or an editor payload with 'steps'.",
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to convert imported pipeline: {e}",
        ) from e

    return imported_steps, imported_name, imported_description


def _render_canonical_pipeline_content(
    steps: list[dict[str, Any]],
    *,
    name: str | None = None,
    description: str | None = None,
) -> dict[str, Any]:
    """Render editor steps into canonical payload plus YAML/JSON strings."""
    import yaml

    normalized_steps = _normalize_and_validate_editor_steps(
        steps,
        name=name,
        description=description,
    )
    canonical_payload = editor_to_canonical(
        normalized_steps,
        name=name,
        description=description,
        include_wrapper=True,
    )
    pipeline_name = (name or "pipeline").replace(" ", "_").lower()

    return {
        "payload": canonical_payload,
        "json": json.dumps(canonical_payload, indent=2),
        "yaml": yaml.safe_dump(
            canonical_payload,
            sort_keys=False,
            default_flow_style=False,
            allow_unicode=False,
        ),
        "filename_stem": pipeline_name,
    }


@router.post("/pipelines/validate")
async def validate_pipeline_forward(request: PipelineValidateRequest):
    """Forward to the validate_pipeline implementation."""
    return await _validate_pipeline_impl(request)


@router.post("/pipelines/count-variants")
async def count_variants_forward(request: PipelineCountRequest):
    """Forward to the count_pipeline_variants implementation."""
    return await _count_variants_impl(request)


@router.post("/pipelines/import-preview")
async def preview_pipeline_import(request: PipelineCanonicalImportRequest):
    """Convert canonical JSON/YAML or editor JSON into editor steps without saving."""
    imported_steps, imported_name, imported_description = _resolve_import_payload(request)

    return {
        "success": True,
        "name": request.name or imported_name or "Imported Pipeline",
        "description": imported_description,
        "steps": imported_steps,
    }


@router.post("/pipelines/render-canonical")
async def render_canonical_pipeline(request: PipelineCanonicalRenderRequest):
    """Render current editor steps into canonical JSON/YAML content."""
    rendered = _render_canonical_pipeline_content(
        request.steps,
        name=request.name,
        description=request.description,
    )

    return {
        "success": True,
        "payload": rendered["payload"],
        "json": rendered["json"],
        "yaml": rendered["yaml"],
        "filename": f"{rendered['filename_stem']}.yaml",
    }


# ============================================================================


@router.get("/pipelines/{pipeline_id}")
async def get_pipeline(pipeline_id: str):
    """Get a specific pipeline by ID."""
    pipeline = _load_pipeline(pipeline_id)
    return {"pipeline": pipeline}


@router.post("/pipelines")
async def create_pipeline(pipeline_data: PipelineCreate):
    """Create a new pipeline."""
    try:
        now = datetime.now().isoformat()
        pipeline_id = f"pipeline_{int(datetime.now().timestamp())}"
        normalized_steps = _normalize_and_validate_editor_steps(
            pipeline_data.steps,
            name=pipeline_data.name,
            description=pipeline_data.description or "",
        )

        pipeline = {
            "id": pipeline_id,
            "name": pipeline_data.name,
            "description": pipeline_data.description or "",
            "category": pipeline_data.category,
            "task_type": pipeline_data.task_type,
            "steps": normalized_steps,
            "is_favorite": False,
            "created_at": now,
            "updated_at": now,
        }

        _save_pipeline(pipeline)

        return {"success": True, "pipeline": pipeline}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to create pipeline: {str(e)}"
        )


@router.put("/pipelines/{pipeline_id}")
async def update_pipeline(pipeline_id: str, update_data: PipelineUpdate):
    """Update an existing pipeline."""
    try:
        pipeline = _load_pipeline(pipeline_id)

        if update_data.name is not None:
            pipeline["name"] = update_data.name
        if update_data.description is not None:
            pipeline["description"] = update_data.description
        if update_data.steps is not None:
            pipeline["steps"] = _normalize_and_validate_editor_steps(
                update_data.steps,
                name=str(pipeline.get("name") or ""),
                description=str(pipeline.get("description") or ""),
            )
        if update_data.is_favorite is not None:
            pipeline["is_favorite"] = update_data.is_favorite
        if update_data.task_type is not None:
            pipeline["task_type"] = update_data.task_type

        pipeline["updated_at"] = datetime.now().isoformat()

        _save_pipeline(pipeline)

        return {"success": True, "pipeline": pipeline}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to update pipeline: {str(e)}"
        )


@router.delete("/pipelines/{pipeline_id}")
async def delete_pipeline(pipeline_id: str):
    """Delete a pipeline."""
    try:
        pipelines_dir = _get_pipelines_dir()
        pipeline_file = pipelines_dir / f"{pipeline_id}.json"

        if not pipeline_file.exists():
            raise HTTPException(status_code=404, detail="Pipeline not found")

        pipeline_file.unlink()

        return {"success": True, "message": "Pipeline deleted"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to delete pipeline: {str(e)}"
        )


@router.post("/pipelines/{pipeline_id}/clone")
async def clone_pipeline(pipeline_id: str, new_name: str | None = None):
    """Clone an existing pipeline."""
    try:
        original = _load_pipeline(pipeline_id)

        now = datetime.now().isoformat()
        new_id = f"pipeline_{int(datetime.now().timestamp())}"

        cloned = {
            **original,
            "id": new_id,
            "name": new_name or f"{original['name']} (Copy)",
            "is_favorite": False,
            "created_at": now,
            "updated_at": now,
        }

        _save_pipeline(cloned)

        return {"success": True, "pipeline": cloned}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to clone pipeline: {str(e)}"
        )


async def _validate_pipeline_impl(request: PipelineValidateRequest):
    """
    Validate a pipeline configuration using nirs4all's validate_spec().

    Checks that all operators exist and parameters are valid.
    Returns validation results with any errors or warnings.
    """
    _validate_spec = get_cached("validate_spec")
    if not is_ml_ready() or _validate_spec is None:
        # Fallback: basic validation
        return {
            "valid": True,
            "steps": [{"index": i, "name": s.get("name", "unknown"), "valid": True, "errors": [], "warnings": []} for i, s in enumerate(request.steps)],
            "errors": [],
            "warnings": ["nirs4all not available for full validation"],
        }

    try:
        normalized_steps = _normalize_and_validate_editor_steps(request.steps)
        nirs4all_steps = filter_canonical_comments(editor_to_canonical(normalized_steps))
    except HTTPException as exc:
        return {
            "valid": False,
            "steps": [
                {
                    "index": i,
                    "name": step.get("name", "unknown"),
                    "type": step.get("type", "unknown"),
                    "valid": False,
                    "errors": [str(exc.detail)],
                    "warnings": [],
                }
                for i, step in enumerate(request.steps)
            ],
            "errors": [str(exc.detail)],
            "warnings": [],
        }

    # Use nirs4all's validate_spec
    validation_result = _validate_spec(nirs4all_steps)

    # Convert ValidationResult to API response format
    errors = [str(e) for e in validation_result.errors]
    warnings = [str(w) for w in validation_result.warnings]

    # Build per-step results
    step_results = []
    for i, step in enumerate(request.steps):
        step_errors = [e for e in errors if f"[{i}]" in e or f"Step {i}" in e]
        step_warnings = [w for w in warnings if f"[{i}]" in w or f"Step {i}" in w]

        step_results.append({
            "index": i,
            "name": step.get("name", "unknown"),
            "type": step.get("type", "unknown"),
            "valid": len(step_errors) == 0,
            "errors": step_errors,
            "warnings": step_warnings,
        })

    return {
        "valid": validation_result.is_valid,
        "steps": step_results,
        "errors": errors,
        "warnings": warnings,
        "node_count": validation_result.node_count,
        "generator_count": validation_result.generator_count,
    }

# ============= Phase 2: Dynamic Operator Discovery =============


def _annotation_to_type_string(annotation) -> str:
    """Convert type annotation to string representation."""
    if annotation is None:
        return "null"

    type_map = {
        int: "int",
        float: "float",
        str: "str",
        bool: "bool",
        list: "array",
        dict: "object",
        type(None): "null",
    }

    if annotation in type_map:
        return type_map[annotation]

    # Handle typing module types
    origin = getattr(annotation, "__origin__", None)
    if origin is not None:
        if origin is list:
            return "array"
        if origin is dict:
            return "object"
        if hasattr(origin, "__name__"):
            return origin.__name__.lower()

    if hasattr(annotation, "__name__"):
        return annotation.__name__.lower()

    return "any"


@router.post("/pipelines/{pipeline_id}/prepare")
async def prepare_pipeline_execution(
    pipeline_id: str,
    request: PipelineExecuteRequest
):
    """
    Prepare a pipeline for execution.

    Validates the pipeline, resolves operators, and returns
    execution configuration. Does not actually run the pipeline.
    """
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="nirs4all library not available for pipeline execution",
        )

    pipeline = _load_pipeline(pipeline_id)

    # Validate pipeline
    validation_result = await _validate_pipeline_impl(
        PipelineValidateRequest(steps=pipeline.get("steps", []))
    )

    if not validation_result["valid"]:
        return {
            "success": False,
            "pipeline_id": pipeline_id,
            "validation": validation_result,
            "message": "Pipeline validation failed",
        }

    # Check dataset exists
    from .spectra import _load_dataset
    dataset = _load_dataset(request.dataset_id)
    if not dataset:
        raise HTTPException(
            status_code=404,
            detail=f"Dataset '{request.dataset_id}' not found",
        )

    # Build execution summary
    steps_summary = []
    for i, step in enumerate(pipeline.get("steps", [])):
        steps_summary.append({
            "index": i,
            "name": step.get("name", "unknown"),
            "type": step.get("type", "unknown"),
            "params": step.get("params", {}),
        })

    execution_config = {
        "pipeline_id": pipeline_id,
        "pipeline_name": pipeline.get("name", "Unnamed"),
        "dataset_id": request.dataset_id,
        "dataset_name": dataset.name,
        "partition": request.partition,
        "num_samples": dataset.num_samples,
        "num_features": dataset.num_features,
        "steps": steps_summary,
        "total_steps": len(steps_summary),
        "dry_run": request.dry_run,
    }

    return {
        "success": True,
        "execution_config": execution_config,
        "validation": validation_result,
        "message": "Pipeline ready for execution",
    }


@router.post("/pipelines/from-preset/{preset_id}")
async def create_pipeline_from_preset(
    preset_id: str,
    request: PipelineFromPresetRequest | None = None,
):
    """
    Create a new pipeline from a preset template.

    Loads the canonical preset file, converts it into the editor JSON shape,
    and persists it as a normal pipeline. Unsupported canonical constructs are
    preserved via ``rawNirs4all`` passthrough so preset import does not fail
    just because the editor cannot fully edit a construct yet.
    """
    request = request or PipelineFromPresetRequest()
    preset = load_preset(preset_id, request.variant)  # raises 404 if missing
    editor_steps = canonical_to_editor(
        {
            "name": preset.get("name", ""),
            "description": preset.get("description", ""),
            "pipeline": preset["pipeline"],
        }
    )

    pipeline_data = PipelineCreate(
        name=request.name or preset["name"],
        description=preset.get("description", ""),
        steps=editor_steps,
        category="preset",
        task_type=preset.get("task_type"),
    )

    return await create_pipeline(pipeline_data)


# ============= Pipeline Variant Counting =============

# Implementation function - called by forwarding route defined earlier
async def _count_variants_impl(request: PipelineCountRequest):
    """
    Count the number of pipeline variants without generating them.

    Uses nirs4all's count_combinations function to efficiently calculate
    the total number of variants a pipeline specification would generate.
    """
    _count_combinations = get_cached("count_combinations")
    if not is_ml_ready() or _count_combinations is None:
        return {
            "count": 1,
            "warning": "nirs4all not available, using simple count",
            "breakdown": {}
        }

    try:
        # Convert frontend/editor steps to canonical nirs4all format
        nirs4all_steps = filter_canonical_comments(editor_to_canonical(request.steps))

        # Count combinations using nirs4all
        total_count = _count_combinations(nirs4all_steps)

        # Calculate per-step breakdown
        breakdown = {}
        for i, step in enumerate(request.steps):
            step_name = step.get("name", f"step_{i}")
            step_id = step.get("id", str(i))
            single_step = filter_canonical_comments(editor_to_canonical([step]))
            step_count = _count_combinations(single_step) if single_step else 1
            breakdown[step_id] = {"name": step_name, "count": step_count}

        # Warning for large search spaces
        warning = None
        if total_count > 10000:
            warning = f"Large search space: {total_count:,} variants. Consider reducing with 'count' limiter."
        elif total_count > 1000:
            warning = f"Moderate search space: {total_count:,} variants."

        return {
            "count": total_count,
            "breakdown": breakdown,
            "warning": warning,
        }

    except Exception as e:
        return {"count": 1, "error": str(e), "breakdown": {}}


# ============= Phase 6: Pipeline Execution =============


class PipelineRunRequest(BaseModel):
    """Request model for running a pipeline."""
    dataset_id: str
    verbose: int = 1
    export_model: bool = True
    model_name: str | None = None
    refit: Any | None = True
    refit_params: dict[str, Any] | None = None
    engine: str | None = Field(None, description="ML engine selector: 'legacy' or 'dag-ml'; omitted uses the nirs4all library default.")
    allow_fallback: bool = Field(False, description="Explicitly allow dag-ml to fall back to legacy when structured RtError says it cannot run.")
    split_group_by_by_dataset: dict[str, str | None] = Field(default_factory=dict)
    inline_pipeline: dict[str, Any] | None = None


class PipelineExportRequest(BaseModel):
    """Request model for exporting pipeline."""
    format: str = "python"  # python, yaml, json
    dataset_path: str | None = None


@router.post("/pipelines/{pipeline_id}/execute")
async def execute_pipeline(pipeline_id: str, request: PipelineRunRequest):
    """
    Execute a pipeline using nirs4all.run().

    This endpoint triggers pipeline execution as a background job
    and returns a job ID for tracking progress via WebSocket.
    """
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="nirs4all library not available for pipeline execution",
        )

    from .jobs import JobType, job_manager
    from .workspace_manager import workspace_manager

    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    try:
        request.split_group_by_by_dataset = normalize_split_group_by_mapping(
            [request.dataset_id],
            request.split_group_by_by_dataset,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Load pipeline
    pipeline = request.inline_pipeline if request.inline_pipeline else _load_pipeline(pipeline_id)

    # Validate dataset exists
    from .nirs4all_adapter import resolve_dataset_path
    from .spectra import _load_dataset
    try:
        dataset_path = resolve_dataset_path(request.dataset_id)
    except HTTPException:
        raise

    dataset = _load_dataset(request.dataset_id)
    if dataset is None:
        raise HTTPException(
            status_code=404,
            detail=f"Dataset '{request.dataset_id}' not found",
        )

    runtime_group_by = request.split_group_by_by_dataset.get(request.dataset_id)
    try:
        prepare_pipeline_steps_with_runtime_grouping(
            pipeline.get("steps", []),
            dataset,
            runtime_group_by,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Dataset '{request.dataset_id}' cannot run pipeline "
                f"'{pipeline.get('name', pipeline_id)}': {exc}"
            ),
        ) from exc

    # Build refit configuration
    refit_value = request.refit
    if refit_value is True and request.refit_params:
        refit_value = {"refit_params": request.refit_params}
    elif isinstance(refit_value, dict) and request.refit_params:
        refit_value.setdefault("refit_params", {}).update(request.refit_params)

    # Create job configuration
    job_config = {
        "pipeline_id": pipeline_id,
        "pipeline_name": pipeline.get("name", "Unknown"),
        "pipeline_steps": pipeline.get("steps", []),
        "dataset_id": request.dataset_id,
        "dataset_path": dataset_path,
        "verbose": request.verbose,
        "export_model": request.export_model,
        "model_name": request.model_name or f"model_{pipeline_id}",
        "workspace_path": workspace.path,
        "refit": refit_value,
        "split_group_by": runtime_group_by,
        "engine": request.engine,
        "allow_fallback": request.allow_fallback,
    }

    # Create and submit job
    job = job_manager.create_job(JobType.TRAINING, job_config)
    job_manager.submit_job(job, _run_pipeline_task)

    return {
        "success": True,
        "job_id": job.id,
        "pipeline_id": pipeline_id,
        "status": job.status.value,
        "message": "Pipeline execution started",
        "websocket_url": f"/ws/job/{job.id}",
    }


def _run_pipeline_task(job, progress_callback):
    """
    Execute the pipeline using nirs4all.run().

    Args:
        job: The job instance with config
        progress_callback: Callback for progress updates

    Returns:
        Execution result dictionary
    """
    from .nirs4all_adapter import ensure_models_dir, extract_best_metrics

    config = job.config
    steps = config.get("pipeline_steps", [])
    dataset_path = config.get("dataset_path")
    dataset_id = config.get("dataset_id")
    workspace_path = config.get("workspace_path")
    split_group_by = config.get("split_group_by")

    # Report starting
    progress_callback(5, "Building pipeline...")

    try:
        from .spectra import _load_dataset

        dataset = _load_dataset(dataset_id)
        if dataset is None:
            raise ValueError(f"Dataset '{dataset_id}' not found")

        prepared = prepare_pipeline_steps_with_runtime_grouping(
            steps,
            dataset,
            split_group_by,
        )
        for warning_message in prepared.warnings:
            logger.warning(
                "Runtime grouping warning for pipeline %s on dataset %s: %s",
                config.get("pipeline_name", config.get("pipeline_id", "unknown")),
                dataset_id,
                warning_message,
            )
        pipeline_steps = editor_steps_to_runtime_canonical(prepared.steps)
        estimated_variants = count_runtime_variants(pipeline_steps)

        if not pipeline_steps:
            raise ValueError("Pipeline has no executable steps")

        progress_callback(10, f"Running pipeline ({estimated_variants} variants)...")

        # Execute using nirs4all.run()
        import nirs4all

        from .runtime_engine import run_with_engine_record

        run_kwargs = {
            "pipeline": pipeline_steps,
            "dataset": dataset_path,
            "verbose": config.get("verbose", 1),
        }
        if "refit" in config:
            run_kwargs["refit"] = config["refit"]

        outcome = run_with_engine_record(
            nirs4all.run,
            run_kwargs=run_kwargs,
            engine=config.get("engine"),
            allow_fallback=bool(config.get("allow_fallback", False)),
            workspace_path=workspace_path,
            pass_workspace_path_to_legacy=False,
        )
        result = outcome.result
        engine_record = outcome.engine_record

        progress_callback(80, "Extracting results...")

        # NaN-safe shared extraction (single source of truth, RUN-02)
        metrics = extract_best_metrics(result)

        # Get top results if available
        top_results = []
        if hasattr(result, 'top'):
            try:
                for i, r in enumerate(result.top(5)):
                    top_results.append({
                        "rank": i + 1,
                        "rmse": getattr(r, 'rmse', None),
                        "r2": getattr(r, 'r2', None),
                        "config": str(r) if hasattr(r, '__str__') else None,
                    })
            except Exception:
                pass

        # Export model if requested
        model_path = None
        if config.get("export_model"):
            progress_callback(90, "Exporting model...")
            try:
                models_dir = ensure_models_dir(workspace_path)
                model_name = config.get("model_name", f"model_{config['pipeline_id']}")
                model_path = str(models_dir / f"{model_name}.n4a")
                result.export(model_path)
            except Exception as e:
                logger.error("Error exporting model: %s", e)

        progress_callback(100, "Complete!")

        return {
            "success": True,
            "metrics": metrics,
            "top_results": top_results,
            "variants_tested": estimated_variants,
            "model_path": model_path,
            **engine_record,
        }

    except Exception as e:
        import traceback

        from .runtime_engine import (
            fallback_policy_record,
            rt_error_envelope_from_exception,
        )

        rt_error = rt_error_envelope_from_exception(e)
        return {
            "success": False,
            "error": str(e),
            "traceback": traceback.format_exc(),
            "engine": None,
            "engine_requested": config.get("engine"),
            "engine_diagnostics": [rt_error] if rt_error is not None else None,
            "fallback_policy": fallback_policy_record(config.get("engine"), bool(config.get("allow_fallback", False))),
        }


@router.post("/pipelines/{pipeline_id}/export")
async def export_pipeline(pipeline_id: str, request: PipelineExportRequest):
    """
    Export pipeline to various formats.

    Supported formats:
    - python: Executable Python code
    - yaml: canonical nirs4all YAML
    - json: canonical nirs4all JSON
    """
    from .nirs4all_adapter import export_pipeline_to_python

    pipeline = _load_pipeline(pipeline_id)
    steps = pipeline.get("steps", [])
    pipeline_name = pipeline.get("name", "pipeline").replace(" ", "_").lower()

    if request.format == "python":
        content = export_pipeline_to_python(
            steps=steps,
            pipeline_name=pipeline_name,
            dataset_path=request.dataset_path or "path/to/your/dataset",
        )
        content_type = "text/x-python"
        extension = "py"

    elif request.format == "yaml":
        rendered = _render_canonical_pipeline_content(
            steps,
            name=pipeline.get("name"),
            description=pipeline.get("description"),
        )
        content = rendered["yaml"]
        content_type = "text/yaml"
        extension = "yaml"

    elif request.format == "json":
        rendered = _render_canonical_pipeline_content(
            steps,
            name=pipeline.get("name"),
            description=pipeline.get("description"),
        )
        content = rendered["json"]
        content_type = "application/json"
        extension = "json"

    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported export format: {request.format}",
        )

    return {
        "success": True,
        "format": request.format,
        "filename": f"{pipeline_name}.{extension}",
        "content": content,
        "content_type": content_type,
    }


@router.post("/pipelines/import")
async def import_pipeline(request: PipelineCanonicalImportRequest):
    """
    Import pipeline from canonical YAML or JSON.

    The canonical nirs4all wrapper ``{name, description, pipeline}`` is the
    primary contract. For compatibility, editor JSON payloads with ``steps``
    are still accepted.
    """
    imported_steps, imported_name, imported_description = _resolve_import_payload(
        request
    )

    # Create pipeline from imported data
    pipeline_data = PipelineCreate(
        name=request.name or imported_name or "Imported Pipeline",
        description=imported_description,
        steps=imported_steps,
        category="imported",
    )

    return await create_pipeline(pipeline_data)


# ============================================================================
# Pipeline Samples API (for testing/demo)
# ============================================================================


def _get_samples_dir() -> Path:
    """Get the pipeline samples directory from nirs4all."""
    # Try relative to nirs4all_webapp (sibling directory)
    samples_path = Path(__file__).parent.parent.parent / "nirs4all" / "examples" / "pipeline_samples"
    if samples_path.exists():
        return samples_path
    # Try via installed nirs4all package
    try:
        import nirs4all
        pkg_path = Path(nirs4all.__file__).parent.parent / "examples" / "pipeline_samples"
        if pkg_path.exists():
            return pkg_path
    except ImportError:
        pass
    raise HTTPException(status_code=404, detail="Pipeline samples directory not found")


def _load_sample_file(filepath: Path) -> dict[str, Any]:
    """Load a pipeline sample file (JSON or YAML)."""
    import yaml

    suffix = filepath.suffix.lower()
    try:
        with open(filepath, encoding='utf-8') as f:
            if suffix == '.json':
                return json.load(f)
            elif suffix in ('.yaml', '.yml'):
                return yaml.safe_load(f)
            else:
                raise HTTPException(status_code=400, detail=f"Unsupported format: {suffix}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load sample: {e}")


def _stable_sort_template(value: Any) -> Any:
    """Return a deterministically key-sorted copy of a JSON-like structure."""
    if isinstance(value, dict):
        return {
            key: _stable_sort_template(child)
            for key, child in sorted(value.items(), key=lambda item: item[0])
        }
    if isinstance(value, list):
        return [_stable_sort_template(item) for item in value]
    return value


def _semantic_pipeline_template(
    steps: list[Any],
    *,
    name: str = "",
    description: str = "",
) -> Any:
    """Build the library-semantic template used for canonical round-trip checks."""
    from nirs4all.pipeline.config.pipeline_config import PipelineConfigs

    filtered_steps = filter_canonical_comments(steps)
    config = PipelineConfigs(filtered_steps, name=name, description=description)
    return _stable_sort_template(config.original_template)


def _get_canonical_pipeline(filepath: Path) -> dict[str, Any]:
    """
    Load a pipeline file and return its canonical serialized form.

    Uses nirs4all's PipelineConfigs to get the canonical representation.
    """
    if not NIRS4ALL_AVAILABLE:
        # Fallback: just load and clean comments
        data = _load_sample_file(filepath)
        steps = data.get("pipeline", data) if isinstance(data, dict) else data
        return {
            "name": data.get("name", filepath.stem) if isinstance(data, dict) else filepath.stem,
            "description": data.get("description", "") if isinstance(data, dict) else "",
            "pipeline": filter_canonical_comments(steps) if isinstance(steps, list) else steps,
            "has_generators": False,
            "num_configurations": 1,
        }

    try:
        from nirs4all.pipeline.config.pipeline_config import PipelineConfigs

        data = _load_sample_file(filepath)

        if isinstance(data, dict):
            steps = data.get("pipeline", [])
            name = data.get("name", filepath.stem)
            description = data.get("description", "")
        elif isinstance(data, list):
            steps = data
            name = filepath.stem
            description = ""
        else:
            raise ValueError("Pipeline must be list or dict with 'pipeline' key")

        steps = filter_canonical_comments(steps)

        # Create PipelineConfigs to get canonical form while preserving the
        # original generator template instead of only the first expansion.
        config = PipelineConfigs(steps, name=name, description=description)
        canonical_steps = _stable_sort_template(config.original_template)

        return {
            "name": name,
            "description": description,
            "pipeline": canonical_steps,
            "has_generators": config.has_configurations,
            "num_configurations": len(config.steps),
        }
    except Exception as e:
        # Fallback to raw load
        data = _load_sample_file(filepath)
        steps = data.get("pipeline", data) if isinstance(data, dict) else data
        return {
            "name": data.get("name", filepath.stem) if isinstance(data, dict) else filepath.stem,
            "description": data.get("description", "") if isinstance(data, dict) else "",
            "pipeline": filter_canonical_comments(steps) if isinstance(steps, list) else steps,
            "has_generators": False,
            "num_configurations": 1,
            "error": str(e),
        }


@router.get("/pipelines/samples")
async def list_pipeline_samples():
    """
    List all available pipeline sample files.

    Returns the list of sample files from nirs4all/examples/pipeline_samples.
    """
    samples_dir = _get_samples_dir()

    samples = []
    for filepath in sorted(samples_dir.glob("*.json")) + sorted(samples_dir.glob("*.yaml")):
        # Skip test and export scripts
        if filepath.stem in ("test_all_pipelines", "export_canonical"):
            continue

        try:
            data = _load_sample_file(filepath)
            name = data.get("name", filepath.stem) if isinstance(data, dict) else filepath.stem
            description = data.get("description", "") if isinstance(data, dict) else ""
        except Exception:
            name = filepath.stem
            description = ""

        samples.append({
            "id": filepath.stem,
            "filename": filepath.name,
            "format": filepath.suffix[1:],
            "name": name,
            "description": description,
        })

    return {
        "samples": samples,
        "total": len(samples),
        "samples_dir": str(samples_dir),
    }


@router.get("/pipelines/samples/{sample_id}")
async def get_pipeline_sample(sample_id: str, canonical: bool = True):
    """
    Get a specific pipeline sample.

    Args:
        sample_id: The sample file stem (e.g., "01_basic_regression")
        canonical: If True, return canonical serialized form via nirs4all

    Returns:
        Pipeline definition in nirs4all format.
    """
    samples_dir = _get_samples_dir()

    # Try both JSON and YAML
    filepath = None
    for ext in [".json", ".yaml", ".yml"]:
        candidate = samples_dir / f"{sample_id}{ext}"
        if candidate.exists():
            filepath = candidate
            break

    if not filepath:
        raise HTTPException(status_code=404, detail=f"Sample '{sample_id}' not found")

    if canonical:
        result = _get_canonical_pipeline(filepath)
    else:
        result = _load_sample_file(filepath)
        if isinstance(result, dict) and "pipeline" in result:
            result["pipeline"] = filter_canonical_comments(result["pipeline"])
        elif isinstance(result, list):
            result = {"pipeline": filter_canonical_comments(result), "name": filepath.stem}

    result["source_file"] = filepath.name
    return result


@router.post("/pipelines/samples/{sample_id}/validate-roundtrip")
async def validate_sample_roundtrip(sample_id: str, editor_steps: list[dict[str, Any]]):
    """
    Validate that editor steps produce identical output to the sample.

    This endpoint is used to test the pipeline editor's import/export fidelity.

    Args:
        sample_id: The sample file stem
        editor_steps: The pipeline steps as exported from the editor

    Returns:
        Validation result with differences if any.
    """
    samples_dir = _get_samples_dir()

    # Load canonical sample
    filepath = None
    for ext in [".json", ".yaml", ".yml"]:
        candidate = samples_dir / f"{sample_id}{ext}"
        if candidate.exists():
            filepath = candidate
            break

    if not filepath:
        raise HTTPException(status_code=404, detail=f"Sample '{sample_id}' not found")

    canonical = _get_canonical_pipeline(filepath)
    original_steps = canonical.get("pipeline", [])

    differences = []

    try:
        original_normalized = _semantic_pipeline_template(
            original_steps,
            name=canonical.get("name", ""),
            description=canonical.get("description", ""),
        )
        editor_normalized = _semantic_pipeline_template(
            editor_steps,
            name=canonical.get("name", ""),
            description=canonical.get("description", ""),
        )
    except Exception:
        original_normalized = _stable_sort_template(filter_canonical_comments(original_steps))
        editor_normalized = _stable_sort_template(filter_canonical_comments(editor_steps))

    original_json = json.dumps(original_normalized, sort_keys=True)
    editor_json = json.dumps(editor_normalized, sort_keys=True)

    is_identical = original_json == editor_json

    if not is_identical:
        # Find specific differences
        if len(original_steps) != len(editor_steps):
            differences.append(f"Step count differs: {len(original_steps)} vs {len(editor_steps)}")

        for i, (orig, edit) in enumerate(zip(original_steps, editor_steps)):
            orig_json = json.dumps(_stable_sort_template(filter_canonical_comments(orig)), sort_keys=True)
            edit_json = json.dumps(_stable_sort_template(filter_canonical_comments(edit)), sort_keys=True)
            if orig_json != edit_json:
                differences.append(f"Step {i} differs")

    return {
        "valid": is_identical,
        "sample_id": sample_id,
        "differences": differences,
        "original_step_count": len(original_steps),
        "editor_step_count": len(editor_steps),
    }


# ============================================================================
# Phase 4: Shape Propagation API
# ============================================================================


class ShapePropagationRequest(BaseModel):
    """Request model for shape propagation calculation."""
    steps: list[dict[str, Any]]
    input_shape: dict[str, int]  # {samples: N, features: M}


class ShapeAtStep(BaseModel):
    """Shape at a specific pipeline step."""
    step_id: str
    step_name: str
    input_shape: dict[str, int]
    output_shape: dict[str, int]
    warnings: list[dict[str, Any]] = []


class ShapePropagationResponse(BaseModel):
    """Response model for shape propagation calculation."""
    shapes: list[ShapeAtStep]
    warnings: list[dict[str, Any]]
    output_shape: dict[str, int]
    is_valid: bool


# Operator shape effects mapping.
#
def _propagate_shape(step: dict[str, Any], input_shape: dict[str, int]) -> tuple:
    """Calculate output shape for a single step.

    Shape semantics are library-owned (PIPE-01):
    nirs4all.pipeline.analysis.shape_inference provides the per-operator
    pre-fit rules and the dimension-bound parameter taxonomy; this function
    only shapes warnings for the editor response.
    """
    from nirs4all.pipeline.analysis.shape_inference import (
        DIMENSION_BOUND_PARAMS,
        infer_output_shape,
    )

    step_name = step.get("name", "")
    params = step.get("params", {})
    warnings = []

    # Check dimension-bounded parameters (taxonomy from the library)
    for param_name, dim_source in DIMENSION_BOUND_PARAMS.items():
        param_value = params.get(param_name)
        if param_value is not None and isinstance(param_value, (int, float)):
            max_value = input_shape.get(dim_source, float("inf"))
            if param_value > max_value:
                warnings.append({
                    "type": "param_exceeds_dimension",
                    "step_id": step.get("id", ""),
                    "step_name": step_name,
                    "message": f"Parameter '{param_name}' ({int(param_value)}) exceeds {dim_source} ({int(max_value)})",
                    "param_name": param_name,
                    "param_value": int(param_value),
                    "max_value": int(max_value),
                    "severity": "error" if param_name == "n_components" else "warning",
                })

    inferred = infer_output_shape(
        step_name, params, input_shape.get("samples", 0), input_shape.get("features", 0)
    )
    if inferred is not None:
        output_shape = {"samples": inferred[0], "features": inferred[1]}
    else:
        # Unknown operator - preserve shape, add warning
        output_shape = input_shape.copy()
        step_type = step.get("type", "")
        if step_type in ("preprocessing", "model"):
            warnings.append({
                "type": "unknown_transform",
                "step_id": step.get("id", ""),
                "step_name": step_name,
                "message": f"Unknown operator '{step_name}' - shape change cannot be predicted",
                "severity": "warning",
            })

    return output_shape, warnings


@router.post("/pipelines/propagate-shape", response_model=ShapePropagationResponse)
async def propagate_shape(request: ShapePropagationRequest):
    """
    Calculate shape propagation through a pipeline.

    Given an input shape and a list of pipeline steps, calculates how
    the data shape changes at each step and reports any dimension warnings.

    This is used by the Pipeline Editor to:
    - T4.5: Show shape at each step
    - T4.6: Display shape changes in the tree
    - T4.7: Warn when parameters exceed data dimensions
    """
    shapes = []
    all_warnings = []
    current_shape = request.input_shape.copy()
    is_valid = True

    for step in request.steps:
        input_shape = current_shape.copy()
        output_shape, step_warnings = _propagate_shape(step, input_shape)

        shapes.append(ShapeAtStep(
            step_id=step.get("id", ""),
            step_name=step.get("name", ""),
            input_shape=input_shape,
            output_shape=output_shape,
            warnings=step_warnings,
        ))

        all_warnings.extend(step_warnings)
        if any(w.get("severity") == "error" for w in step_warnings):
            is_valid = False

        current_shape = output_shape

        # Handle branches recursively (simplified - just check first branch)
        branches = step.get("branches", [])
        children = step.get("children", [])
        for branch in branches + children:
            if isinstance(branch, list):
                for child_step in branch:
                    _, child_warnings = _propagate_shape(child_step, input_shape)
                    all_warnings.extend(child_warnings)
            elif isinstance(branch, dict):
                _, child_warnings = _propagate_shape(branch, input_shape)
                all_warnings.extend(child_warnings)

    return ShapePropagationResponse(
        shapes=shapes,
        warnings=all_warnings,
        output_shape=current_shape,
        is_valid=is_valid,
    )
