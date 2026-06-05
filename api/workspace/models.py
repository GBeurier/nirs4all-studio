"""Pydantic request/response models for the workspace API package."""

from typing import Any

from pydantic import BaseModel, Field

# ============= Core workspace models =============


class CreateWorkspaceRequest(BaseModel):
    """Request model for creating a new workspace."""
    path: str = Field(..., description="Path to the workspace directory")
    name: str = Field(..., description="Display name for the workspace")
    description: str | None = Field(None, description="Workspace description")
    create_dir: bool = Field(True, description="Create directory if it doesn't exist")


class SetWorkspaceRequest(BaseModel):
    """Request model for setting the current workspace."""
    path: str
    persist_global: bool = True


class LinkDatasetRequest(BaseModel):
    """Request model for linking a dataset."""
    path: str
    config: dict[str, Any] | None = None


class ExportWorkspaceRequest(BaseModel):
    """Request model for exporting a workspace."""
    output_path: str = Field(..., description="Path for the exported archive")
    include_datasets: bool = Field(False, description="Include dataset files (may be large)")
    include_models: bool = Field(True, description="Include trained models")
    include_results: bool = Field(True, description="Include results and predictions")


class WorkspaceResponse(BaseModel):
    """Response model for workspace details."""
    workspace: dict[str, Any] | None
    datasets: list[dict[str, Any]]


class WorkspaceInfo(BaseModel):
    """Summary info for a workspace."""
    path: str
    name: str
    created_at: str
    last_accessed: str
    num_datasets: int = 0
    num_pipelines: int = 0
    description: str | None = None


class WorkspaceListResponse(BaseModel):
    """Response model for listing workspaces."""
    workspaces: list[WorkspaceInfo]
    total: int


class ImportWorkspaceRequest(BaseModel):
    """Request model for importing a workspace from archive."""
    archive_path: str = Field(..., description="Path to the archive file")
    destination_path: str = Field(..., description="Path where workspace will be extracted")
    workspace_name: str | None = Field(None, description="Name for the imported workspace")


# ============= Groups =============


class CreateGroupRequest(BaseModel):
    name: str


# ============= Custom nodes =============


class CustomNodeDefinition(BaseModel):
    """Definition of a custom node."""
    id: str = Field(..., description="Unique identifier (e.g., 'custom.my_transform')")
    label: str = Field(..., description="Display name for the node")
    category: str = Field("custom", description="Category in the palette")
    description: str | None = Field(None, description="Node description")
    classPath: str = Field(..., description="Python class path (e.g., 'mypackage.MyTransform')")
    stepType: str = Field("processing", description="Step type: preprocessing, processing, model, etc.")
    parameters: list[dict[str, Any]] = Field(default_factory=list, description="Parameter definitions")
    icon: str | None = Field(None, description="Icon name for the node")
    color: str | None = Field(None, description="Node color")


class ImportCustomNodesRequest(BaseModel):
    """Request to import custom nodes."""
    nodes: list[dict[str, Any]] = Field(..., description="Nodes to import")
    overwrite: bool = Field(False, description="Overwrite existing nodes with same ID")


class CustomNodeSettingsRequest(BaseModel):
    """Request to update custom node settings."""
    enabled: bool = Field(True, description="Whether custom nodes are enabled")
    allowedPackages: list[str] = Field(
        default_factory=lambda: ["nirs4all", "sklearn", "scipy", "numpy", "pandas"],
        description="Allowed Python packages for classPath"
    )
    requireApproval: bool = Field(False, description="Require admin approval for new nodes")
    allowUserNodes: bool = Field(True, description="Allow users to create custom nodes")


# ============= Statistics, storage & maintenance =============


class SpaceUsageItem(BaseModel):
    """Space usage for a category."""
    name: str = Field(..., description="Category name (results, models, etc.)")
    size_bytes: int = Field(0, description="Size in bytes")
    file_count: int = Field(0, description="Number of files")
    percentage: float = Field(0.0, description="Percentage of total workspace size")


class WorkspaceStatsResponse(BaseModel):
    """Response model for workspace statistics."""
    path: str = Field(..., description="Workspace path")
    name: str = Field(..., description="Workspace name")
    total_size_bytes: int = Field(0, description="Total workspace size in bytes")
    space_usage: list[SpaceUsageItem] = Field(default_factory=list, description="Breakdown by category")
    linked_datasets_count: int = Field(0, description="Number of globally linked datasets (workspace-independent)")
    linked_datasets_external_size: int = Field(0, description="Total size of external datasets")
    duckdb_size_bytes: int = Field(0, description="Metadata store size (SQLite)")
    parquet_arrays_size_bytes: int = Field(0, description="Total Parquet array files size")
    storage_mode: str = Field("unknown", description="Storage backend: migrated, legacy, new")
    created_at: str = Field(..., description="Workspace creation time")
    last_accessed: str = Field(..., description="Last access time")
    # Workspace-scoped counts (from the active store / scan)
    runs_count: int = Field(0, description="Number of runs in this workspace")
    datasets_count: int = Field(0, description="Number of distinct datasets in this workspace")
    predictions_count: int = Field(0, description="Number of predictions in this workspace")
    models_count: int = Field(0, description="Number of trained model exports in this workspace")


class StorageStatusResponse(BaseModel):
    """Response model for workspace storage status."""
    storage_mode: str
    has_prediction_arrays_table: bool
    has_arrays_directory: bool
    migration_needed: bool


class MigrationRequest(BaseModel):
    """Request to migrate prediction arrays to Parquet."""
    dry_run: bool = Field(False, description="Run migration in dry-run mode")
    batch_size: int | None = Field(None, description="Batch size for migration")


class MigrationJobResponse(BaseModel):
    """Response when a migration job is enqueued."""
    job_id: str


class MigrationStatusResponse(BaseModel):
    """Response for migration status."""
    migration_needed: bool
    storage_mode: str
    legacy_row_count: int | None = None
    estimated_duration_seconds: int | None = None


class MigrationReportResponse(BaseModel):
    """Migration report (dry run or completed)."""
    total_rows: int = 0
    rows_migrated: int = 0
    datasets_migrated: list[str] = Field(default_factory=list)
    verification_passed: bool = False
    verification_sample_size: int = 0
    verification_mismatches: int = 0
    duckdb_size_before: int = 0
    duckdb_size_after: int = 0
    parquet_total_size: int = 0
    duration_seconds: float = 0.0
    errors: list[str] = Field(default_factory=list)


class CompactRequest(BaseModel):
    dataset_name: str | None = Field(None, description="Dataset name to compact (all if omitted)")


class CompactDatasetStats(BaseModel):
    rows_before: int = 0
    rows_after: int = 0
    rows_removed: int = 0
    bytes_before: int = 0
    bytes_after: int = 0


class CompactReport(BaseModel):
    datasets: dict[str, CompactDatasetStats] = Field(default_factory=dict)


class CleanDeadLinksRequest(BaseModel):
    dry_run: bool = Field(False, description="Preview cleanup without deleting")


class CleanDeadLinksReport(BaseModel):
    metadata_orphans_removed: int = 0
    array_orphans_removed: int = 0


class RemoveBottomRequest(BaseModel):
    fraction: float = Field(..., ge=0.0, le=1.0)
    metric: str | None = None
    partition: str | None = None
    dataset_name: str | None = None
    dry_run: bool = Field(False, description="Preview removal without deleting")


class RemoveBottomReport(BaseModel):
    removed: int = 0
    remaining: int = 0
    threshold_score: float = 0.0


class DatasetStorageInfo(BaseModel):
    name: str
    prediction_count: int = 0
    parquet_size_bytes: int = 0


class StorageHealthResponse(BaseModel):
    storage_mode: str
    migration_needed: bool
    duckdb_size_bytes: int = 0
    parquet_total_size_bytes: int = 0
    total_predictions: int = 0
    total_datasets: int = 0
    datasets: list[DatasetStorageInfo] = Field(default_factory=list)
    orphan_metadata_count: int = 0
    orphan_array_count: int = 0
    corrupt_files: list[str] = Field(default_factory=list)


class CleanCacheRequest(BaseModel):
    """Request model for cleaning cache."""
    clean_temp: bool = Field(True, description="Clean temporary files")
    clean_orphan_results: bool = Field(False, description="Clean results without associated runs")
    clean_old_predictions: bool = Field(False, description="Clean predictions older than threshold")
    days_threshold: int = Field(30, description="Age threshold for cleaning old files")


class CleanCacheResponse(BaseModel):
    """Response model for clean cache operation."""
    success: bool
    files_removed: int = Field(0, description="Number of files removed")
    bytes_freed: int = Field(0, description="Bytes freed")
    categories_cleaned: list[str] = Field(default_factory=list, description="Categories that were cleaned")


# ============= Settings =============


class DataLoadingDefaults(BaseModel):
    """Default settings for data loading."""
    delimiter: str = Field(";", description="Default CSV delimiter")
    decimal_separator: str = Field(".", description="Default decimal separator")
    has_header: bool = Field(True, description="Default header setting")
    header_unit: str = Field("nm", description="Default header unit (nm, cm-1, text, none, index)")
    signal_type: str = Field("auto", description="Default signal type")
    na_policy: str = Field("auto", description="Default NA handling policy")
    auto_detect: bool = Field(True, description="Enable auto-detection")


class GeneralSettings(BaseModel):
    """General UI settings."""
    theme: str = Field("system", description="Theme: light, dark, or system")
    ui_density: str = Field("comfortable", description="UI density: compact, comfortable, or spacious")
    reduce_animations: bool = Field(False, description="Reduce motion for accessibility")
    sidebar_collapsed: bool = Field(False, description="Whether sidebar is collapsed")
    language: str = Field("en", description="Interface language: en, fr, or de")


class WorkspaceSettingsResponse(BaseModel):
    """Response model for workspace settings."""
    data_loading_defaults: DataLoadingDefaults
    developer_mode: bool = Field(False, description="Developer mode enabled")
    cache_enabled: bool = Field(True, description="Cache enabled")
    general: GeneralSettings | None = Field(None, description="General UI settings")


# ============= Linked workspaces & app settings =============


class LinkWorkspaceRequest(BaseModel):
    """Request model for linking a nirs4all workspace."""
    path: str = Field(..., description="Path to the nirs4all workspace")
    name: str | None = Field(None, description="Display name (defaults to directory name)")


class LinkedWorkspaceResponse(BaseModel):
    """Response model for a linked workspace."""
    id: str
    path: str
    name: str
    is_active: bool
    linked_at: str
    last_scanned: str | None
    discovered: dict[str, Any]


class LinkedWorkspacesListResponse(BaseModel):
    """Response model for listing linked workspaces."""
    workspaces: list[LinkedWorkspaceResponse]
    active_workspace_id: str | None
    total: int


class WorkspaceScanResponse(BaseModel):
    """Response model for workspace scan results."""
    scanned_at: str
    summary: dict[str, int]
    runs: list[dict[str, Any]]
    predictions: list[dict[str, Any]]
    exports: list[dict[str, Any]]
    templates: list[dict[str, Any]]
    datasets: list[dict[str, Any]]


class AppSettingsResponse(BaseModel):
    """Response model for app settings."""
    version: str
    linked_workspaces_count: int
    favorite_pipelines: list[str]
    ui_preferences: dict[str, Any]


class UpdateAppSettingsRequest(BaseModel):
    """Request model for updating app settings."""
    ui_preferences: dict[str, Any] | None = None


class FavoritePipelineRequest(BaseModel):
    """Request model for adding/removing favorite pipelines."""
    pipeline_id: str


class SetConfigPathRequest(BaseModel):
    """Request model for setting the app config folder path."""
    path: str = Field(..., description="Path to the new config folder")
