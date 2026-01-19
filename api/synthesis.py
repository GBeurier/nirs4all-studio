"""
Synthesis API - Generate synthetic NIRS datasets

This module provides FastAPI endpoints for generating synthetic NIRS data
using the nirs4all SyntheticDatasetBuilder API.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime
from pathlib import Path
import time

router = APIRouter(prefix="/synthesis", tags=["synthesis"])

# ============= Check nirs4all availability =============

try:
    import nirs4all
    from nirs4all.data.synthetic import SyntheticDatasetBuilder
    NIRS4ALL_AVAILABLE = True
except ImportError:
    NIRS4ALL_AVAILABLE = False
    nirs4all = None
    SyntheticDatasetBuilder = None

# Import workspace manager for linking datasets
try:
    from .workspace_manager import workspace_manager
    WORKSPACE_AVAILABLE = True
except ImportError:
    WORKSPACE_AVAILABLE = False
    workspace_manager = None


def require_nirs4all():
    """Raise error if nirs4all is not available."""
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail="nirs4all library is not installed. Synthesis features require nirs4all."
        )


# ============= Request/Response Models =============

class SynthesisStep(BaseModel):
    """A single builder step configuration."""
    id: str
    type: str  # features, targets, classification, etc.
    method: str  # with_features, with_targets, etc.
    params: Dict[str, Any] = Field(default_factory=dict)
    enabled: bool = True


class SynthesisConfig(BaseModel):
    """Complete synthesis configuration."""
    name: str = "synthetic_nirs"
    n_samples: int = Field(default=1000, ge=10, le=100000)
    random_state: Optional[int] = None
    steps: List[SynthesisStep] = Field(default_factory=list)


class PreviewRequest(BaseModel):
    """Request for preview generation."""
    config: SynthesisConfig
    preview_samples: int = Field(default=100, ge=10, le=500)
    include_statistics: bool = True


class PreviewStatistics(BaseModel):
    """Statistics about generated data."""
    spectra_mean: float
    spectra_std: float
    spectra_min: float
    spectra_max: float
    targets_mean: float
    targets_std: float
    targets_min: float
    targets_max: float
    n_wavelengths: int
    n_components: Optional[int] = None
    class_distribution: Optional[Dict[str, int]] = None


class PreviewResponse(BaseModel):
    """Preview generation response."""
    success: bool
    spectra: List[List[float]]  # Shape: (n_preview_samples, n_wavelengths)
    wavelengths: List[float]
    targets: List[float]
    target_type: str  # "regression" or "classification"
    statistics: Optional[PreviewStatistics] = None
    execution_time_ms: float
    actual_samples: int  # Full dataset would have this many
    error: Optional[str] = None


class GenerateRequest(BaseModel):
    """Request for full dataset generation."""
    config: SynthesisConfig
    export_to_workspace: bool = False  # Save to workspace and link
    export_to_csv: Optional[str] = None  # Custom CSV export path
    dataset_name: Optional[str] = None  # Override dataset name


class GenerateResponse(BaseModel):
    """Full generation response."""
    success: bool
    dataset_id: Optional[str] = None
    dataset_name: Optional[str] = None
    export_path: Optional[str] = None
    shape: Tuple[int, int]
    execution_time_ms: float
    linked_to_workspace: bool = False
    error: Optional[str] = None


class ComponentInfo(BaseModel):
    """Information about a predefined component."""
    name: str
    display_name: str
    description: str
    category: str


class ValidationResult(BaseModel):
    """Validation result."""
    valid: bool
    errors: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


# ============= Helper Functions =============

def build_from_config(config: SynthesisConfig):
    """Build a SyntheticDatasetBuilder from config."""
    require_nirs4all()

    builder = SyntheticDatasetBuilder(
        n_samples=config.n_samples,
        random_state=config.random_state,
        name=config.name,
    )

    # Method mapping
    method_map = {
        'features': 'with_features',
        'targets': 'with_targets',
        'classification': 'with_classification',
        'metadata': 'with_metadata',
        'sources': 'with_sources',
        'partitions': 'with_partitions',
        'batch_effects': 'with_batch_effects',
        'nonlinear_targets': 'with_nonlinear_targets',
        'target_complexity': 'with_target_complexity',
        'complex_landscape': 'with_complex_target_landscape',
        'output': 'with_output',
    }

    # Apply each enabled step
    for step in config.steps:
        if not step.enabled:
            continue

        method_name = method_map.get(step.type)
        if method_name and hasattr(builder, method_name):
            method = getattr(builder, method_name)

            # Convert params for specific methods
            params = step.params.copy()

            # Handle wavelength_range tuple
            if 'wavelength_range' in params:
                wr = params['wavelength_range']
                if isinstance(wr, list):
                    params['wavelength_range'] = tuple(wr)

            # Handle range tuple
            if 'range' in params:
                r = params['range']
                if isinstance(r, list):
                    params['range'] = tuple(r)

            # Handle "custom" complexity - pass physics params directly
            if step.type == 'features' and params.get('complexity') == 'custom':
                # When custom, don't pass complexity - just use the individual physics params
                # Use 'realistic' as base complexity to get reasonable defaults
                params['complexity'] = 'realistic'
                # Physics params are kept as-is (they're already individual kwargs)

            # Remove None values
            params = {k: v for k, v in params.items() if v is not None}

            try:
                method(**params)
            except Exception as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"Error applying {method_name}: {str(e)}"
                )

    return builder


# ============= Endpoints =============

@router.post("/preview", response_model=PreviewResponse)
async def generate_preview(request: PreviewRequest):
    """
    Generate a preview of synthetic data.
    Returns a small sample for visualization.
    """
    require_nirs4all()

    start_time = time.time()

    try:
        # Create a smaller version for preview
        preview_config = request.config.model_copy()
        preview_config.n_samples = request.preview_samples

        builder = build_from_config(preview_config)
        dataset = builder.build()

        # Extract data
        import numpy as np

        X = dataset.x({}, layout='2d')
        y = dataset.y({})

        # Handle multi-component targets (2D array) - use first component
        if y.ndim > 1:
            y = y[:, 0]
        # Get wavelengths from headers (they are stored as strings like "1000.0")
        # Use float_headers() if available, otherwise convert headers manually
        if hasattr(dataset, 'float_headers') and callable(dataset.float_headers):
            wavelengths = np.array(dataset.float_headers(0))
        else:
            headers = dataset.headers(0)
            wavelengths = np.array([float(h) for h in headers])

        # Determine target type
        target_type = "classification" if any(
            s.type == "classification" and s.enabled
            for s in request.config.steps
        ) else "regression"

        # Calculate statistics
        statistics = None
        if request.include_statistics:
            statistics = PreviewStatistics(
                spectra_mean=float(np.mean(X)),
                spectra_std=float(np.std(X)),
                spectra_min=float(np.min(X)),
                spectra_max=float(np.max(X)),
                targets_mean=float(np.mean(y)),
                targets_std=float(np.std(y)),
                targets_min=float(np.min(y)),
                targets_max=float(np.max(y)),
                n_wavelengths=len(wavelengths),
            )

            if target_type == "classification":
                unique, counts = np.unique(y, return_counts=True)
                statistics.class_distribution = {
                    str(int(u)): int(c) for u, c in zip(unique, counts)
                }

        execution_time = (time.time() - start_time) * 1000

        return PreviewResponse(
            success=True,
            spectra=X.tolist(),
            wavelengths=wavelengths.tolist(),
            targets=y.tolist(),
            target_type=target_type,
            statistics=statistics,
            execution_time_ms=execution_time,
            actual_samples=request.config.n_samples,
        )

    except HTTPException:
        raise
    except Exception as e:
        execution_time = (time.time() - start_time) * 1000
        return PreviewResponse(
            success=False,
            spectra=[],
            wavelengths=[],
            targets=[],
            target_type="regression",
            execution_time_ms=execution_time,
            actual_samples=0,
            error=str(e),
        )


@router.post("/generate", response_model=GenerateResponse)
async def generate_dataset(request: GenerateRequest):
    """
    Generate full synthetic dataset.
    Optionally exports to workspace or custom CSV path.
    """
    require_nirs4all()

    start_time = time.time()

    try:
        builder = build_from_config(request.config)

        # Generate dataset name
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        dataset_name = request.dataset_name or request.config.name or f"synthetic_{timestamp}"

        export_path = None
        dataset_id = None
        linked = False

        # Handle export to workspace
        if request.export_to_workspace:
            if not WORKSPACE_AVAILABLE or workspace_manager is None:
                raise HTTPException(status_code=503, detail="Workspace manager not available")

            workspace = workspace_manager.get_current_workspace()
            if not workspace:
                raise HTTPException(status_code=409, detail="No workspace selected")

            # Create output directory
            workspace_path = Path(workspace.path)
            datasets_dir = workspace_path / "datasets" / "synthetic"
            datasets_dir.mkdir(parents=True, exist_ok=True)
            output_path = datasets_dir / dataset_name

            # Export using builder
            export_path = str(builder.export(str(output_path), format="standard"))

            # Link to workspace
            try:
                # Determine task type
                target_type = "regression"
                for step in request.config.steps:
                    if step.type == "classification" and step.enabled:
                        target_type = "classification"
                        break

                link_config = {
                    "synthetic": True,
                    "generated_at": datetime.now().isoformat(),
                    "generation_params": {
                        "n_samples": request.config.n_samples,
                        "steps": [s.type for s in request.config.steps if s.enabled],
                    },
                    "targets": [{
                        "column": "target",
                        "type": target_type,
                        "is_default": True,
                    }],
                    "default_target": "target",
                }

                dataset_info = workspace_manager.link_dataset(
                    export_path,
                    config=link_config
                )
                linked = True
                dataset_id = dataset_info.get("id")
            except Exception as e:
                # Linking failed but dataset was still created
                pass

        elif request.export_to_csv:
            # Export to custom CSV path
            export_path = str(builder.export(request.export_to_csv, format="standard"))

        # Build the dataset to get shape info
        dataset = builder.build()
        X = dataset.x({}, layout='2d')

        execution_time = (time.time() - start_time) * 1000

        return GenerateResponse(
            success=True,
            dataset_id=dataset_id,
            dataset_name=dataset_name,
            export_path=export_path,
            shape=(X.shape[0], X.shape[1]),
            execution_time_ms=execution_time,
            linked_to_workspace=linked,
        )

    except HTTPException:
        raise
    except Exception as e:
        execution_time = (time.time() - start_time) * 1000
        return GenerateResponse(
            success=False,
            shape=(0, 0),
            execution_time_ms=execution_time,
            error=str(e),
        )


@router.get("/components", response_model=List[ComponentInfo])
async def list_components():
    """List all available predefined components."""
    # Return hardcoded list - matches the frontend definitions
    components = [
        # Water
        ComponentInfo(name="water", display_name="Water", description="H2O absorption bands", category="water"),
        ComponentInfo(name="moisture", display_name="Moisture", description="Sample moisture content", category="water"),
        # Proteins
        ComponentInfo(name="protein", display_name="Protein", description="General protein content", category="proteins"),
        ComponentInfo(name="nitrogen_compound", display_name="Nitrogen Compound", description="N-H bonds", category="proteins"),
        ComponentInfo(name="casein", display_name="Casein", description="Milk protein", category="proteins"),
        ComponentInfo(name="gluten", display_name="Gluten", description="Wheat protein", category="proteins"),
        # Carbohydrates
        ComponentInfo(name="starch", display_name="Starch", description="Starch content", category="carbohydrates"),
        ComponentInfo(name="cellulose", display_name="Cellulose", description="Cellulose fiber", category="carbohydrates"),
        ComponentInfo(name="glucose", display_name="Glucose", description="Simple sugar", category="carbohydrates"),
        ComponentInfo(name="sucrose", display_name="Sucrose", description="Table sugar", category="carbohydrates"),
        ComponentInfo(name="lactose", display_name="Lactose", description="Milk sugar", category="carbohydrates"),
        # Lipids
        ComponentInfo(name="lipid", display_name="Lipid", description="General fat content", category="lipids"),
        ComponentInfo(name="oil", display_name="Oil", description="Liquid fats", category="lipids"),
        # Alcohols
        ComponentInfo(name="ethanol", display_name="Ethanol", description="Alcohol content", category="alcohols"),
    ]
    return components


@router.post("/validate", response_model=ValidationResult)
async def validate_config(config: SynthesisConfig):
    """Validate a synthesis configuration."""
    errors = []
    warnings = []

    enabled_steps = [s for s in config.steps if s.enabled]
    enabled_types = {s.type for s in enabled_steps}

    # Check mutual exclusivity
    if "targets" in enabled_types and "classification" in enabled_types:
        errors.append("Cannot have both Targets (Regression) and Classification enabled")

    # Check dependencies
    complexity_steps = {"nonlinear_targets", "target_complexity", "complex_landscape"}
    for step in enabled_steps:
        if step.type in complexity_steps and "targets" not in enabled_types:
            warnings.append(f"{step.type} works best with Targets step enabled")

    # Warn if no steps
    if len(enabled_steps) == 0:
        warnings.append("No steps enabled. Add at least a Features step for basic generation.")

    return ValidationResult(
        valid=len(errors) == 0,
        errors=errors,
        warnings=warnings,
    )


@router.get("/status")
async def get_status():
    """Check if synthesis is available."""
    return {
        "available": NIRS4ALL_AVAILABLE,
        "message": "Synthesis API is ready" if NIRS4ALL_AVAILABLE else "nirs4all library not installed",
    }
