"""Pydantic request/response models for the playground API.

These describe the wire contract for the playground endpoints (real-time
spectral pipeline preview). They carry no behavior — only validation and
serialization shapes.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class PlaygroundStep(BaseModel):
    """A single pipeline step in the playground."""

    id: str = Field(..., description="Unique step identifier")
    type: str = Field(..., description="Step type: 'preprocessing', 'augmentation', 'splitting', or 'filter'")
    name: str = Field(..., description="Operator class name (e.g., 'StandardNormalVariate')")
    params: dict[str, Any] = Field(default_factory=dict, description="Operator parameters")
    enabled: bool = Field(default=True, description="Whether the step is enabled")


class PlaygroundData(BaseModel):
    """Input data for playground execution."""

    x: list[list[float]] = Field(..., description="2D spectral data (samples x features)")
    y: list[float] | None = Field(None, description="Target values (optional)")
    wavelengths: list[float] | None = Field(None, description="Wavelength headers")
    sample_ids: list[str] | None = Field(None, description="Sample identifiers")
    metadata: dict[str, list[Any]] | None = Field(None, description="Additional metadata columns")
    header_unit: str | None = Field(
        None,
        description=(
            "Unit of the wavelength axis (e.g. 'nm', 'cm-1'). Forwarded to the "
            "executor so the response can label charts with the correct axis."
        ),
    )


class SamplingOptions(BaseModel):
    """Options for data sampling."""

    method: str = Field("random", description="Sampling method: 'random', 'stratified', 'kmeans', 'all'")
    n_samples: int = Field(100, ge=1, le=1000, description="Number of samples to select")
    seed: int = Field(42, ge=0, description="Random seed for reproducibility")


class ExecuteRequest(BaseModel):
    """Request model for executing playground pipeline."""

    data: PlaygroundData = Field(..., description="Spectral data to process")
    steps: list[PlaygroundStep] = Field(default_factory=list, description="Pipeline steps to execute")
    sampling: SamplingOptions | None = Field(None, description="Sampling options for large datasets")
    options: dict[str, Any] = Field(
        default_factory=dict,
        description="Additional options: compute_pca, compute_statistics, max_wavelengths_returned, split_index"
    )


class ExecuteDatasetRequest(BaseModel):
    """Request model for executing playground pipeline on a workspace dataset.

    Instead of sending the full spectral data matrix, the client sends only
    a dataset_id. The backend loads the dataset server-side, eliminating the
    data round-trip (Backend → Frontend → Backend).
    """

    dataset_id: str = Field(..., description="Workspace dataset identifier")
    partition: str = Field("all", description="Dataset partition to load: train, test, or all")
    steps: list[PlaygroundStep] = Field(default_factory=list, description="Pipeline steps to execute")
    sampling: SamplingOptions | None = Field(None, description="Sampling options for large datasets")
    options: dict[str, Any] = Field(
        default_factory=dict,
        description="Additional options: compute_pca, compute_statistics, max_wavelengths_returned, split_index"
    )


class ChartComputeRequest(BaseModel):
    """Request for computing a specific chart from cached pipeline data.

    Used by parallel chart endpoints (/playground/pca, /playground/repetitions)
    to compute individual chart data independently of the main execute response.
    """

    dataset_id: str | None = Field(None, description="Workspace dataset identifier (for server-side data loading)")
    steps: list[PlaygroundStep] = Field(default_factory=list, description="Pipeline steps (used for step cache lookup)")
    sampling: SamplingOptions | None = Field(None, description="Sampling options")
    options: dict[str, Any] = Field(default_factory=dict, description="Execution options")


class StepTrace(BaseModel):
    """Execution trace for a single step."""

    step_id: str
    name: str
    duration_ms: float
    success: bool
    error: str | None = None
    output_shape: list[int] | None = None


class SpectrumStats(BaseModel):
    """Statistics for a spectrum or set of spectra."""

    mean: list[float]
    std: list[float]
    min: list[float]
    max: list[float]
    p5: list[float]
    p95: list[float]
    global_stats: dict[str, float]


class FoldInfo(BaseModel):
    """Information about a single fold."""

    train_count: int
    test_count: int
    train_indices: list[int]
    test_indices: list[int]
    y_train_stats: dict[str, float] | None = None
    y_test_stats: dict[str, float] | None = None


class ExecuteResponse(BaseModel):
    """Response model for playground execution."""

    success: bool
    execution_time_ms: float
    original: dict[str, Any] = Field(
        default_factory=dict,
        description="Original data: spectra subset, statistics, sample_indices"
    )
    processed: dict[str, Any] = Field(
        default_factory=dict,
        description="Processed data: spectra subset, statistics"
    )
    pca: dict[str, Any] | None = Field(None, description="PCA projection if computed")
    umap: dict[str, Any] | None = Field(None, description="UMAP projection if computed")
    folds: dict[str, Any] | None = Field(None, description="Fold information if splitter present")
    filter_info: dict[str, Any] | None = Field(None, description="Filter results if filters applied")
    augmentation_info: dict[str, Any] | None = Field(None, description="Augmentation results: original_count, total_count, steps applied")
    repetitions: dict[str, Any] | None = Field(None, description="Repetition analysis if detected or configured")
    metrics: dict[str, Any] | None = Field(None, description="Spectral metrics if computed (Phase 5)")
    subset_info: dict[str, Any] | None = Field(None, description="Subset mode info: subset_mode, total_samples, displayed_samples")
    execution_trace: list[StepTrace] = Field(default_factory=list, description="Per-step execution info")
    step_errors: list[dict[str, Any]] = Field(default_factory=list, description="Any step-level errors")
    warnings: list[str] = Field(default_factory=list, description="Non-blocking execution warnings")
    is_raw_data: bool = Field(default=False, description="True if no operators were applied")
    source_partitions: dict[str, Any] | None = Field(
        None,
        description="Source dataset partition info: {has_test, n_train, n_test}. Set when the executor is invoked on a dataset with a known partition layout.",
    )


class DiffComputeRequest(BaseModel):
    """Request model for computing differences between reference and final datasets."""

    X_ref: list[list[float]] = Field(..., description="Reference spectra (n_samples x n_features)")
    X_final: list[list[float]] = Field(..., description="Final spectra (n_samples x n_features)")
    metric: str = Field(
        "euclidean",
        description="Distance metric: 'euclidean', 'manhattan', 'cosine', 'spectral_angle', 'correlation', 'mahalanobis', 'pca_distance'",
    )
    scale: str = Field("linear", description="Scale type: 'linear' or 'log'")


class RepetitionVarianceRequest(BaseModel):
    """Request model for computing variance within repetition groups."""

    X: list[list[float]] = Field(..., description="Spectral data (n_samples x n_features)")
    group_ids: list[str] = Field(..., description="Group identifiers for each sample")
    reference: str = Field(
        "group_mean",
        description="Reference type: 'group_mean', 'leave_one_out', 'first'",
    )
    metric: str = Field("euclidean", description="Distance metric to use")
