# Backlog: Webapp Adaptation — Hybrid DuckDB + Parquet Storage

**Date**: 2026-02-18
**Status**: Draft — Pending team approval
**Source**: `nirs4all/docs/backlog_option_a_hybrid_storage.md`
**Scope**: Backend (`api/`), Frontend (`src/`), WebSocket (`websocket/`)

---

## Goal

Adapt the webapp to the nirs4all library's hybrid storage architecture (DuckDB metadata + Parquet array sidecar files). The webapp is a **thin orchestration layer** — it does not implement storage logic. This backlog covers:

1. Updating the backend to consume the new nirs4all storage API correctly.
2. Exposing migration, maintenance, and storage health features to the user.
3. Extending the frontend with storage management UI and Parquet export capabilities.
4. Adding WebSocket events for long-running maintenance operations.

**Guiding principle**: all storage logic lives in nirs4all. The webapp routes, validates, queues, and displays.

---

## Phased Delivery

| Phase | Name | Description | Depends on |
|-------|------|-------------|------------|
| **W1** | Transparent adaptation | Backend works with new WorkspaceStore API, no new features | nirs4all Phase 1 |
| **W2** | Migration UI | User can trigger and monitor workspace migration | nirs4all Phase 2, W1 |
| **W3** | Maintenance & storage health | Compact, cleanup, integrity check, storage stats | nirs4all Phase 3, W1 |
| **W4** | Portable export & new features | Parquet download, merge stores UI, advanced stats | nirs4all Phase 3, W3 |

Phases W1 and W2 can start as soon as nirs4all Phases 1 and 2 are respectively complete. W3 and W4 can be done in parallel once their dependencies are met.

---

## Phase W1 — Transparent Adaptation

The nirs4all library's `WorkspaceStore` interface is designed so that callers do not need to know whether arrays come from DuckDB or Parquet. Most webapp code should work unchanged. This phase identifies and fixes the few places that do need attention.

### W1.1 Verify StoreAdapter compatibility

**File**: `api/store_adapter.py`

The `StoreAdapter` calls `self._store.get_prediction_arrays(prediction_id)` and `self._store.get_prediction(prediction_id, load_arrays=True)`. After nirs4all Phase 1, these methods delegate to `ArrayStore` internally. The return type (dict of numpy arrays) is unchanged.

**Action**: Verify that all existing `StoreAdapter` methods work without modification after nirs4all Phase 1. Specifically:

| Method | Line | Expected behavior |
|--------|------|-------------------|
| `get_prediction_scatter()` | 289 | Calls `store.get_prediction(id, load_arrays=True)` — transparent |
| `get_prediction_arrays()` | 418 | Calls `store.get_prediction_arrays(id)` — transparent |
| `get_predictions_summary()` | 169 | Metadata-only query — unchanged |
| `get_predictions_page()` | 217 | Metadata-only query — unchanged |
| `get_chain_summaries()` | all chain methods | DuckDB views — unchanged |

No code changes expected. Validation only.

### W1.2 Verify inspector.py array loading

**File**: `api/inspector.py`

The inspector loads arrays at lines 392, 1215, 1865, 1971, 1985 via `store.get_prediction_arrays(pid)`. All calls return `dict[str, np.ndarray]` — unchanged after migration.

**Action**: Verify all inspector endpoints work. No code changes expected.

### W1.3 Verify aggregated_predictions.py

**File**: `api/aggregated_predictions.py`

The `GET /{prediction_id}/arrays` endpoint (line 351) calls `store.get_prediction_arrays(prediction_id)`. Transparent.

**Action**: Verify endpoint works. No code changes expected.

### W1.4 Verify training pipeline

**File**: `api/training.py`

`nirs4all.run()` handles array storage internally. The webapp only reads results after completion. The batch flush optimization (nirs4all 1.7) changes the write cadence but not the API contract.

**Action**: Run a full training job through the webapp, verify predictions appear correctly in Results/AggregatedResults/Inspector pages.

### W1.5 Update workspace stats to include `arrays/` directory

**File**: `api/workspace.py` — `get_workspace_stats()` (line 1074)

The current implementation computes space usage by scanning workspace subdirectories. After migration, a new `arrays/` directory will hold Parquet files that can be significant in size.

**Changes**:
- Add `arrays/` to the categories scanned in the stats endpoint.
- Report it as a separate category ("Prediction arrays") in the `space_usage` breakdown.

```python
# Add to the categories dict alongside existing entries
categories = {
    ...
    "Prediction arrays": workspace_path / "arrays",
}
```

### W1.6 Handle legacy store detection gracefully

**File**: `api/store_adapter.py` or `api/workspace.py`

After nirs4all Phase 2.4, `WorkspaceStore.__init__` detects legacy stores (with `prediction_arrays` DuckDB table but no `arrays/` directory) and logs a warning. The webapp should surface this status to the user.

**Changes**:
- Add a method `get_store_status()` on `StoreAdapter` that returns the storage mode:

```python
def get_store_status(self) -> dict[str, Any]:
    """Return storage backend status.

    Returns:
        {
            "storage_mode": "migrated" | "legacy" | "mid_migration" | "new",
            "has_prediction_arrays_table": bool,
            "has_arrays_directory": bool,
            "migration_needed": bool,
        }
    """
```

- Expose this via a new endpoint: `GET /workspace/storage-status`.

### W1.7 Update workspace_manager.py legacy fallback

**File**: `api/workspace_manager.py`

The `WorkspaceScanner` has a fallback path for workspaces without `store.duckdb` (line 526). This path is unchanged. But the scanner should now also recognize the `arrays/` directory as part of a valid workspace.

**Action**: If `WorkspaceScanner._has_store()` checks for `store.duckdb`, no change needed. If it scans for content, update to recognize `arrays/` as a valid workspace artifact.

---

## Phase W2 — Migration UI

### W2.1 Migration background job

**File**: `api/workspace.py` (new endpoints) + `api/jobs/manager.py`

Add a migration endpoint that triggers nirs4all's `migrate_arrays_to_parquet()` as a background job. The user should be able to:
1. See if migration is needed.
2. Run a dry run.
3. Execute the migration.
4. Monitor progress via WebSocket.
5. See the migration report.

**New endpoints**:

```
POST /workspace/migrate
    Body: { "dry_run": bool, "batch_size": int? }
    Returns: { "job_id": str }  (if dry_run=false, runs as background job)
             or MigrationReport  (if dry_run=true, runs synchronously)

GET /workspace/migrate/status
    Returns: { "migration_needed": bool, "storage_mode": str,
               "legacy_row_count": int?, "estimated_duration_seconds": int? }
```

**Implementation**:
- Dry run: call `migrate_arrays_to_parquet(workspace_path, dry_run=True)` synchronously and return the `MigrationReport`.
- Full migration: submit as a `JobType.MAINTENANCE` job (new job type) via `JobManager`. Send WebSocket progress events.
- Import from nirs4all: `from nirs4all.pipeline.storage.migration import migrate_arrays_to_parquet, MigrationReport`.

### W2.2 WebSocket events for migration

**File**: `websocket/manager.py`

Add new message types for maintenance operations:

```python
# Add to MessageType enum
MAINTENANCE_STARTED = "maintenance_started"
MAINTENANCE_PROGRESS = "maintenance_progress"
MAINTENANCE_COMPLETED = "maintenance_completed"
MAINTENANCE_FAILED = "maintenance_failed"
```

Add helper functions:

```python
async def notify_maintenance_started(job_id: str, operation: str, details: dict) -> None: ...
async def notify_maintenance_progress(job_id: str, progress: float, message: str) -> None: ...
async def notify_maintenance_completed(job_id: str, operation: str, report: dict) -> None: ...
async def notify_maintenance_failed(job_id: str, operation: str, error: str) -> None: ...
```

The `operation` field distinguishes between migration, compact, cleanup, etc.

### W2.3 Migration progress reporting

**File**: `api/workspace.py`

The nirs4all migration function processes one dataset at a time. The webapp should report progress per dataset.

**Implementation**:
- Wrap the migration call in a job function that:
  1. Queries the total dataset count before starting.
  2. Calls `migrate_arrays_to_parquet()` (which processes sequentially).
  3. After each dataset completes, sends a `MAINTENANCE_PROGRESS` WebSocket event.
- Since `migrate_arrays_to_parquet()` is a single blocking call, progress granularity depends on nirs4all exposing a callback. If not available, send a single `MAINTENANCE_STARTED` + `MAINTENANCE_COMPLETED` pair with the full report.

### W2.4 Frontend — Migration banner and dialog

**Files**: `src/components/settings/WorkspaceTab.tsx` (or equivalent), new component

When a legacy store is detected (`storage_mode == "legacy"`), display a persistent banner:

```
⚠ Legacy array storage detected. Migration to Parquet recommended for better performance.
[Run Dry Run]  [Migrate Now]
```

**Migration dialog** (triggered by "Migrate Now"):
1. Show current stats: legacy row count, estimated duration.
2. Remind user to back up `store.duckdb`.
3. "Start Migration" button → calls `POST /workspace/migrate`.
4. Progress bar driven by WebSocket `MAINTENANCE_PROGRESS` events.
5. On completion: show `MigrationReport` summary (rows migrated, size before/after, duration).
6. On failure: show error + "Store is untouched, you can retry."

**Dry run dialog** (triggered by "Run Dry Run"):
1. Synchronous call → shows report immediately.
2. Displays what would be migrated without making changes.

### W2.5 Frontend — API client additions

**File**: `src/api/client.ts`

```typescript
// Storage status
export async function getStorageStatus(): Promise<StorageStatusResponse> {
  return api.get("/workspace/storage-status");
}

// Migration
export async function getMigrationStatus(): Promise<MigrationStatusResponse> {
  return api.get("/workspace/migrate/status");
}

export async function startMigration(options?: {
  dry_run?: boolean;
  batch_size?: number;
}): Promise<MigrationJobResponse | MigrationReport> {
  return api.post("/workspace/migrate", options ?? {});
}
```

### W2.6 Frontend — TypeScript types

**File**: `src/types/workspace.ts` (or new file `src/types/storage.ts`)

```typescript
interface StorageStatusResponse {
  storage_mode: "migrated" | "legacy" | "mid_migration" | "new";
  has_prediction_arrays_table: boolean;
  has_arrays_directory: boolean;
  migration_needed: boolean;
}

interface MigrationStatusResponse {
  migration_needed: boolean;
  storage_mode: string;
  legacy_row_count: number | null;
  estimated_duration_seconds: number | null;
}

interface MigrationReport {
  total_rows: number;
  rows_migrated: number;
  datasets_migrated: string[];
  verification_passed: boolean;
  verification_sample_size: number;
  verification_mismatches: number;
  duckdb_size_before: number;
  duckdb_size_after: number;
  parquet_total_size: number;
  duration_seconds: number;
  errors: string[];
}

interface MigrationJobResponse {
  job_id: string;
}
```

---

## Phase W3 — Maintenance & Storage Health

### W3.1 Maintenance endpoints

**File**: `api/workspace.py` (new endpoints)

Expose nirs4all's `Predictions` maintenance methods as backend endpoints:

```
POST /workspace/compact
    Body: { "dataset_name": str? }
    Returns: CompactReport (synchronous for single dataset, background job for all)

POST /workspace/clean-dead-links
    Body: { "dry_run": bool }
    Returns: { "metadata_orphans_removed": int, "array_orphans_removed": int }

POST /workspace/remove-bottom
    Body: { "fraction": float, "metric": str?, "partition": str?, "dataset_name": str?, "dry_run": bool }
    Returns: { "removed": int, "remaining": int, "threshold_score": float }

GET /workspace/storage-health
    Returns: StorageHealthResponse (integrity check + stats)
```

**Implementation**: each endpoint opens a `WorkspaceStore`, calls the corresponding nirs4all `Predictions` method, and returns the result.

### W3.2 Storage health endpoint

**File**: `api/workspace.py`

```python
@router.get("/workspace/storage-health")
async def get_storage_health():
    """Combined storage health: integrity check + stats + migration status."""
```

Returns:

```python
class StorageHealthResponse(BaseModel):
    storage_mode: str                    # "migrated" | "legacy" | "mid_migration" | "new"
    migration_needed: bool
    duckdb_size_bytes: int
    parquet_total_size_bytes: int
    total_predictions: int
    total_datasets: int
    datasets: list[DatasetStorageInfo]   # per-dataset: name, prediction_count, parquet_bytes
    orphan_metadata_count: int           # predictions with missing arrays
    orphan_array_count: int              # arrays with missing predictions
    corrupt_files: list[str]             # from integrity_check
```

### W3.3 Extend workspace stats

**File**: `api/workspace.py` — `get_workspace_stats()` and `WorkspaceStatsResponse`

Add hybrid storage breakdown to the existing stats endpoint:

```python
class WorkspaceStatsResponse(BaseModel):
    ...  # existing fields
    # New fields
    duckdb_size_bytes: int = Field(0, description="DuckDB metadata store size")
    parquet_arrays_size_bytes: int = Field(0, description="Total Parquet array files size")
    storage_mode: str = Field("unknown", description="Storage backend: migrated, legacy, new")
```

This extends the existing response — frontend can show a breakdown without calling a separate endpoint.

### W3.4 Frontend — Storage health widget

**File**: `src/components/settings/StorageHealthWidget.tsx` (new)

A card in the Settings > Workspace tab showing:

| Section | Content |
|---------|---------|
| **Status** | Badge: "Migrated" (green) / "Legacy" (amber) / "New" (blue) |
| **Storage breakdown** | DuckDB: X MB — Parquet arrays: Y MB — Artifacts: Z MB |
| **Integrity** | "Healthy" (green) / "N orphans detected" (amber) / "Corrupt files" (red) |
| **Per-dataset** | Collapsible list: dataset name, prediction count, Parquet file size |
| **Actions** | [Compact] [Clean Dead Links] [Run Integrity Check] |

### W3.5 Frontend — Maintenance actions

**File**: `src/components/settings/MaintenanceActions.tsx` (new)

Buttons wired to the maintenance endpoints:

1. **Compact**: calls `POST /workspace/compact`. Shows result: rows removed, space reclaimed per dataset.
2. **Clean Dead Links**: calls `POST /workspace/clean-dead-links` with `dry_run=true` first, shows preview, then confirms.
3. **Remove Bottom %**: dialog with fraction slider + metric/partition selectors. Dry run preview, then confirm.
4. **Integrity Check**: calls `GET /workspace/storage-health`, displays detailed results.

All destructive actions require a dry-run preview step before confirmation.

### W3.6 Frontend — API client additions

**File**: `src/api/client.ts`

```typescript
export async function getStorageHealth(): Promise<StorageHealthResponse> {
  return api.get("/workspace/storage-health");
}

export async function compactStorage(datasetName?: string): Promise<CompactReport> {
  return api.post("/workspace/compact", { dataset_name: datasetName });
}

export async function cleanDeadLinks(dryRun: boolean): Promise<CleanDeadLinksReport> {
  return api.post("/workspace/clean-dead-links", { dry_run: dryRun });
}

export async function removeBottomPredictions(options: {
  fraction: number;
  metric?: string;
  partition?: string;
  dataset_name?: string;
  dry_run: boolean;
}): Promise<RemoveBottomReport> {
  return api.post("/workspace/remove-bottom", options);
}
```

### W3.7 Frontend — TypeScript types

**File**: `src/types/storage.ts`

```typescript
interface StorageHealthResponse {
  storage_mode: string;
  migration_needed: boolean;
  duckdb_size_bytes: number;
  parquet_total_size_bytes: number;
  total_predictions: number;
  total_datasets: number;
  datasets: DatasetStorageInfo[];
  orphan_metadata_count: number;
  orphan_array_count: number;
  corrupt_files: string[];
}

interface DatasetStorageInfo {
  name: string;
  prediction_count: number;
  parquet_size_bytes: number;
}

interface CompactReport {
  datasets: Record<string, {
    rows_before: number;
    rows_after: number;
    rows_removed: number;
    bytes_before: number;
    bytes_after: number;
  }>;
}

interface CleanDeadLinksReport {
  metadata_orphans_removed: number;
  array_orphans_removed: number;
}

interface RemoveBottomReport {
  removed: number;
  remaining: number;
  threshold_score: number;
}
```

---

## Phase W4 — Portable Export & New Features

### W4.1 Parquet file download endpoint

**File**: `api/aggregated_predictions.py` (new endpoint)

```
GET /aggregated-predictions/export/{dataset_name}.parquet
    Query params: partition?, model_name?
    Returns: FileResponse (application/octet-stream)
```

**Implementation**:
- Open workspace store.
- Call `ArrayStore.load_dataset(dataset_name)` to get the Parquet DataFrame.
- Optionally filter by partition/model_name.
- Write to a temp file and return as `FileResponse`.
- The downloaded file is self-describing (contains model_name, fold_id, partition, metric, val_score, task_type + arrays).

### W4.2 Bulk export endpoint

**File**: `api/aggregated_predictions.py` (new endpoint)

```
POST /aggregated-predictions/export
    Body: { "dataset_names": list[str]?, "format": "parquet" | "zip" }
    Returns: FileResponse
```

- If `dataset_names` is null, export all datasets.
- If `format == "zip"`, bundle multiple `.parquet` files into a ZIP archive.
- If `format == "parquet"` and single dataset, return the file directly.

### W4.3 Frontend — Export button on Predictions page

**File**: `src/pages/Predictions.tsx`

Add an "Export Predictions" action that:
1. Opens a dialog to select datasets (checkboxes from available datasets).
2. Downloads the Parquet file(s) via the export endpoint.
3. For single dataset: direct `.parquet` download.
4. For multiple datasets: `.zip` download.

### W4.4 Frontend — Export button on AggregatedResults page

**File**: `src/pages/AggregatedResults.tsx`

Add a "Download Parquet" action per dataset group. Downloads the portable Parquet file for that dataset.

### W4.5 Merge stores UI (stretch goal)

**File**: `api/workspace.py` (new endpoint) + new frontend dialog

```
POST /workspace/merge-stores
    Body: {
        "source_paths": list[str],
        "on_conflict": "keep_best" | "keep_latest" | "keep_all" | "skip",
        "datasets": list[str]?
    }
    Returns: { "job_id": str }
```

**Implementation**: calls `Predictions.merge_stores(sources, target, on_conflict=..., datasets=...)` as a background job. Target is the current workspace.

**Frontend dialog**:
1. Select source workspaces (folder picker via Electron IPC or manual path entry).
2. Choose conflict resolution strategy.
3. Optionally filter datasets.
4. Progress via WebSocket.
5. Show merge report on completion.

This is a stretch goal — can be deferred if the core phases are complete.

### W4.6 SQL query endpoint for power users

**File**: `api/aggregated_predictions.py` (new endpoint)

```
POST /aggregated-predictions/query
    Body: { "sql": str }
    Returns: { "columns": list[str], "rows": list[list[Any]], "row_count": int }
```

**Implementation**: calls `predictions.query(sql)` which executes read-only SQL against DuckDB. Arrays are not included. This exposes the full power of SQL for advanced users.

**Security**: validate that the SQL is read-only (no INSERT, UPDATE, DELETE, DROP, ALTER). Reject if not.

**Frontend**: add a "Query" tab or panel in a Developer Mode section of the Results/AggregatedResults page. Simple SQL editor with results table.

---

## File Change Summary

| File | Phase | Changes |
|------|-------|---------|
| `api/store_adapter.py` | W1 | Add `get_store_status()` method, verify existing methods |
| `api/workspace.py` | W1, W2, W3 | Add `arrays/` to stats (W1), migration endpoints (W2), maintenance endpoints (W3) |
| `api/workspace_manager.py` | W1 | Verify `arrays/` directory recognition |
| `api/aggregated_predictions.py` | W1, W4 | Verify array endpoint (W1), add Parquet export (W4), SQL query (W4) |
| `api/inspector.py` | W1 | Verify array loading — no code changes expected |
| `api/training.py` | W1 | Verify training pipeline — no code changes expected |
| `api/jobs/manager.py` | W2 | Add `MAINTENANCE` job type |
| `websocket/manager.py` | W2 | Add `MAINTENANCE_*` message types and notify helpers |
| `src/api/client.ts` | W2, W3, W4 | New API functions for migration, maintenance, export |
| `src/types/storage.ts` | W2, W3 | **New file** — storage/migration/maintenance types |
| `src/components/settings/StorageHealthWidget.tsx` | W3 | **New component** — storage health card |
| `src/components/settings/MaintenanceActions.tsx` | W3 | **New component** — maintenance action buttons |
| `src/components/settings/MigrationDialog.tsx` | W2 | **New component** — migration wizard |
| `src/pages/Settings.tsx` | W2, W3 | Integrate migration banner + storage health widget |
| `src/pages/Predictions.tsx` | W4 | Add Parquet export action |
| `src/pages/AggregatedResults.tsx` | W4 | Add per-dataset Parquet download |

---

## Testing Strategy

### Backend tests

| Test | Phase | What it covers |
|------|-------|---------------|
| `test_store_adapter_arrays_after_migration` | W1 | `StoreAdapter.get_prediction_arrays()` works on migrated store |
| `test_store_adapter_scatter_after_migration` | W1 | `StoreAdapter.get_prediction_scatter()` works on migrated store |
| `test_inspector_scatter_after_migration` | W1 | Inspector scatter endpoint returns correct data from Parquet |
| `test_workspace_stats_includes_arrays` | W1 | `GET /workspace/stats` includes `arrays/` category |
| `test_storage_status_legacy` | W1 | `GET /workspace/storage-status` detects legacy store |
| `test_storage_status_migrated` | W1 | `GET /workspace/storage-status` detects migrated store |
| `test_migrate_endpoint_dry_run` | W2 | `POST /workspace/migrate` with `dry_run=true` returns report without changes |
| `test_migrate_endpoint_full` | W2 | `POST /workspace/migrate` triggers background job, returns job_id |
| `test_migrate_websocket_events` | W2 | WebSocket receives MAINTENANCE_STARTED + MAINTENANCE_COMPLETED |
| `test_compact_endpoint` | W3 | `POST /workspace/compact` compacts arrays and returns stats |
| `test_clean_dead_links_endpoint` | W3 | `POST /workspace/clean-dead-links` removes orphans |
| `test_remove_bottom_dry_run` | W3 | `POST /workspace/remove-bottom` with `dry_run=true` previews removal |
| `test_storage_health_endpoint` | W3 | `GET /workspace/storage-health` returns complete health report |
| `test_export_parquet_single_dataset` | W4 | `GET /aggregated-predictions/export/wheat.parquet` returns valid file |
| `test_export_parquet_filtered` | W4 | Export with partition filter returns subset |
| `test_sql_query_endpoint` | W4 | `POST /aggregated-predictions/query` executes read-only SQL |
| `test_sql_query_rejects_write` | W4 | Write SQL is rejected with 400 |

### Frontend tests (Vitest)

| Test | Phase | What it covers |
|------|-------|---------------|
| `test_migration_banner_shows_on_legacy` | W2 | Banner renders when `storage_mode == "legacy"` |
| `test_migration_banner_hidden_on_migrated` | W2 | Banner not rendered when `storage_mode == "migrated"` |
| `test_migration_dialog_dry_run` | W2 | Dry run button triggers correct API call |
| `test_storage_health_widget_renders` | W3 | Widget shows status, sizes, integrity |
| `test_maintenance_compact_flow` | W3 | Compact button → confirmation → API call → result display |
| `test_export_predictions_dialog` | W4 | Export dialog shows dataset checkboxes and triggers download |

### Integration tests

| Test | Phase | What it covers |
|------|-------|---------------|
| `test_full_training_to_results_migrated_store` | W1 | Run training → Results page shows correct data from Parquet arrays |
| `test_inspector_full_flow_migrated_store` | W1 | Training → Inspector scatter/confusion/bias-variance all work |
| `test_migration_then_browse` | W2 | Legacy store → migrate via UI → browse results → data intact |
| `test_export_reimport_portable` | W4 | Export Parquet → open in standalone Polars → all portable columns present |

---

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| WorkspaceStore API breaks backward compatibility | Low | High | nirs4all backlog explicitly preserves API; W1 is a verification phase |
| Migration endpoint runs too long, user closes browser | Medium | Low | Background job runs independently; WebSocket reconnects and picks up status |
| Large Parquet export causes memory pressure in FastAPI | Medium | Medium | Stream the response using `StreamingResponse`; set reasonable size limits |
| User triggers compact during an active training run | Low | High | Check for active jobs before maintenance operations; return 409 if busy |
| Frontend polls storage-health too aggressively | Low | Low | Use TanStack Query with `staleTime: 30_000` (30s) and manual invalidation |
| Legacy store fallback path in workspace_manager.py breaks | Low | Medium | W1 includes explicit verification of fallback behavior |

---

## Out of Scope

- Implementing any storage logic in the webapp backend — all storage is in nirs4all.
- Multi-workspace merge UI (deferred to W4 stretch goal; can be shipped later).
- Cloud/remote storage for Parquet files — not in this iteration.
- Changes to the pipeline editor, playground, or dataset management — unaffected by storage migration.
- Electron-specific changes — the backend API is the same in web and desktop modes.

---

## Definition of Done

Each phase is independently shippable. A phase is done when:

1. All listed tests pass.
2. Existing test suite passes without modification (no regressions).
3. `npm run lint` and `npm run test` clean.
4. Backend endpoints documented with FastAPI auto-generated OpenAPI schema.
5. Code reviewed and merged.

**Full project done** when Phase W4 is shipped and users can migrate, maintain, and export predictions entirely from the webapp UI.
