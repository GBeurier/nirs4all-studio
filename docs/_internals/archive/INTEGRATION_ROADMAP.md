# nirs4all ↔ nirs4all_webapp Integration Roadmap

> **Goal**: Enable complete end-to-end workflow from dataset → pipeline → run → results → predictions

**Created**: January 15, 2026
**Updated**: January 15, 2026 (Phase 4 Complete)
**Status**: Active Development - Phases 1-4 Complete
**Priority**: Critical for MVP

---

## Current Status Assessment

| Step | Component | Status | Notes |
|------|-----------|--------|-------|
| 1. Link Dataset | Workspace/Datasets | ✅ Ready | Workspace linking and dataset discovery working |
| 2. Design Pipeline | Pipeline Editor | ✅ Fixed | Editor saves to API, pipelines appear in list |
| 3. Create Run | NewExperiment wizard | ✅ Fixed | Wizard fetches real datasets/pipelines from API |
| 4. Execute Run | Background execution | ✅ Fixed | API wired to UI, validation in place |
| 5. Monitor Run | RunProgress page | ✅ Fixed | WebSocket integration enhanced with streaming logs |
| 6. View Results | Results page | ⚠️ OK for now | Basic functionality present |
| 7. Make Predictions | Predictions page | ⚠️ OK for now | Basic functionality present |

---

## Phase 1: Critical Fixes (Priority: Immediate) ✅ COMPLETED

### 1.1 Pipeline List Display Bug ✅ FIXED

**Problem**: Saved pipelines from the editor don't appear in the Pipelines page (`/pipelines`).

**Solution Implemented**:
- Updated `PipelineEditor.tsx` to use `useMutation` from TanStack Query
- `handleSave` now calls `savePipeline()` API instead of console.log
- Added query cache invalidation after save
- Navigation redirects to saved pipeline after success

**Actions**:
1. [x] Trace pipeline save flow in PipelineEditor
2. [x] Verify pipeline file is created in `<workspace>/pipelines/<id>.json`
3. [x] Confirm API endpoint reads from same location
4. [x] Added proper save mutation with cache invalidation
5. [x] Test round-trip: save → list → load

---

### 1.2 NewExperiment Wizard - Dataset Selection ✅ FIXED

**Problem**: The wizard (`/runs/new`) shows mock datasets instead of real linked datasets.

**Solution Implemented**:
- Removed hardcoded `mockDatasets` array
- Added `useQuery` hook to fetch datasets from `listDatasets()` API
- Added loading state with skeleton UI during fetch
- Added empty state with guidance when no datasets available
- Added error state handling

**Actions**:
1. [x] Remove `mockDatasets` constant
2. [x] Add TanStack Query for datasets
3. [x] Add loading state during fetch
4. [x] Add empty state when no datasets available
5. [x] Wire dataset selection to form state

---

### 1.3 NewExperiment Wizard - Pipeline Selection ✅ FIXED

**Problem**: Wizard shows mock pipelines instead of real saved pipelines.

**Solution Implemented**:
- Removed hardcoded `mockPipelines` array
- Added `useQuery` hook to fetch pipelines from `listPipelines()` API
- Added loading state with skeleton UI during fetch
- Added empty state with guidance when no pipelines available
- Pipelines display name, model info, preprocessing steps, and CV info

**Actions**:
1. [x] Remove `mockPipelines` constant
2. [x] Add TanStack Query for pipelines
3. [x] Add loading/empty/error states
4. [x] Update pipeline selection UI to use real data

---

### 1.4 NewExperiment - Launch Function ✅ FIXED

**Problem**: `handleLaunch()` function only logs to console, doesn't call API.

**Solution Implemented**:
- Added `useMutation` for `createRun()` API call
- `handleLaunch()` now creates ExperimentConfig and calls mutation
- On success: shows success toast, invalidates queries, navigates to runs page
- On error: shows error toast with message
- Launch button shows loading state while submitting

**Actions**:
1. [x] Import `useMutation` from TanStack Query
2. [x] Import `createRun` from client
3. [x] Add mutation with proper error handling
4. [x] Update button to show loading state
5. [x] Navigate to runs page on success

---

## Phase 2: Run Execution Pipeline ✅ COMPLETED

### 2.1 Backend: CreateRun Validation ✅ FIXED

**Location**: [api/runs.py](../../api/runs.py)

**Solution Implemented**:
- `create_run` endpoint now validates datasets exist via `_load_dataset()`
- `create_run` endpoint now validates pipelines exist via `_load_pipeline()`
- Returns 404 with detailed message if dataset or pipeline not found
- Added `_create_run_from_config()` function that builds Run from validated config
- Runs are persisted to workspace and saved in-memory

**Actions**:
1. [x] Add dataset validation in `create_run`
2. [x] Add pipeline validation in `create_run`
3. [x] Refactor `_create_mock_run` → `_create_run_from_config`
4. [x] Store dataset metadata in run manifest

---

### 2.2 Backend: Pipeline Execution with nirs4all ✅ ENHANCED

**Location**: [api/runs.py](../../api/runs.py) - `_execute_pipeline_training()` function

**Enhancements Implemented**:
- Added `time` import for proper timing measurements
- Enhanced `_execute_pipeline_training()` with async progress callback support
- Detailed logging throughout the training process
- Progress reporting at each stage (loading, preprocessing, CV folds, metrics, saving)
- Cross-validation with fold-by-fold progress updates
- Returns comprehensive result with metrics, model path, and logs
- Model saving with proper path handling

**Key Changes**:
1. [x] Added `time` import for duration tracking
2. [x] Refactored progress callback from boolean to async callable
3. [x] Added detailed step-by-step logging
4. [x] Enhanced progress reporting (5% loading → 25% preprocessing → 80% CV → 100% complete)
5. [x] Added `logs` to return value for frontend display

---

### 2.3 Frontend: Run Progress Updates ✅ ENHANCED

**Location**: [src/pages/RunProgress.tsx](../../src/pages/RunProgress.tsx)

**Enhancements Implemented**:
- Enhanced WebSocket hook with typed message handling (`WsMessage` interface)
- Added streaming logs state for real-time log display
- Implemented exponential backoff for WebSocket reconnection (max 10 attempts)
- Added log extraction from WebSocket progress messages
- Combined persisted logs with streaming logs (no duplicates)
- Toast notifications for run completion and failure
- More accurate progress calculation including running pipeline progress

**Key Changes**:
1. [x] Added `WsMessage` interface for type safety
2. [x] Enhanced `useRunWebSocket` hook with `onLog` callback
3. [x] Added `streamingLogs` state and deduplication logic
4. [x] Implemented exponential backoff reconnection
5. [x] Added toast notifications for completion/failure events
6. [x] Improved progress calculation to include running pipeline contribution

---

### 2.4 Backend: Run Persistence ✅ ENHANCED

**Location**: [api/runs.py](../../api/runs.py)

**Enhancements Implemented**:
- Added `_ensure_runs_loaded()` for lazy loading of persisted runs
- Runs from previous sessions are loaded on first API access
- Interrupted runs (running/queued status) marked as failed on reload
- Added `_ensure_runs_loaded()` to all run endpoints for consistency

**Key Changes**:
1. [x] Added `_runs_loaded` flag for lazy initialization
2. [x] Added `_ensure_runs_loaded()` function
3. [x] Implemented interrupted run detection on startup
4. [x] Added to: `list_runs`, `get_run_stats`, `get_run`, `create_run`, `stop_run`, `pause_run`, `resume_run`, `retry_run`, `delete_run`, `get_pipeline_logs`

---

### 2.5 WebSocket: Log Streaming ✅ ADDED

**Location**: [websocket/manager.py](../../websocket/manager.py)

**New Features**:
- Added `notify_job_log()` helper function for streaming log entries
- Logs sent via WebSocket with level information (info, warn, error)
- Exported in `websocket/__init__.py`

**Usage**:
```python
from websocket import notify_job_log
await notify_job_log(run_id, "[INFO] Training started", "info")
```

---

## Phase 3: Data Flow Verification ✅ COMPLETED

### 3.1 End-to-End Test Scenario ✅ TESTED

**Test Suite Created**: `tests/test_integration_flow.py`

**37 Automated Tests Covering**:
- Health endpoint verification
- Workspace endpoints (selection, stats)
- Datasets endpoints (list, verify, synthetic presets)
- Pipelines endpoints (list, presets, operators, samples, create, validate, count-variants)
- Runs endpoints (list, stats, get, create validation)
- System endpoints (info, capabilities, status)
- WebSocket endpoints (stats)
- API integration structure checks
- Pipeline validation edge cases
- Run creation validation
- Error handling (404, invalid JSON, missing fields)

**Manual Test Steps** (for regression testing):

1. **Setup Workspace**:
   - Go to Settings
   - Link a workspace with sample datasets
   - Verify datasets appear in Datasets page

2. **Create Pipeline**:
   - Go to Pipelines → New
   - Add: SNV → KFold(5) → PLSRegression(10)
   - Save pipeline as "Test PLS Pipeline"
   - Verify it appears in Pipelines list

3. **Create Run**:
   - Go to Runs → New Run
   - Select the dataset from step 1
   - Select the pipeline from step 2
   - Configure name and CV settings
   - Click Launch

4. **Monitor Progress**:
   - Verify redirect to /runs/{id}
   - Watch progress updates
   - Check logs appear
   - Wait for completion

5. **Check Results**:
   - Verify run appears in Runs list as completed
   - Check Results page shows metrics
   - Verify model was exported

6. **Make Prediction** (optional):
   - Go to Predictions
   - Load trained model
   - Upload new data
   - Generate predictions

---

### 3.2 API Integration Checklist ✅ ALL VERIFIED

| Endpoint | Purpose | Used By | Status |
|----------|---------|---------|--------|
| `GET /datasets` | List datasets | NewExperiment, Datasets page | ✅ Tested |
| `GET /datasets?verify=true` | Verify datasets | Datasets integrity check | ✅ Tested |
| `GET /pipelines` | List pipelines | NewExperiment, Pipelines page | ✅ Tested |
| `POST /pipelines` | Save pipeline | PipelineEditor | ✅ Tested |
| `GET /pipelines/presets` | Get presets | NewExperiment | ✅ Tested |
| `GET /pipelines/operators` | List operators | PipelineEditor | ✅ Tested (route fix applied) |
| `POST /pipelines/validate` | Validate pipeline | PipelineEditor | ✅ Tested (route fix applied) |
| `POST /pipelines/count-variants` | Count variants | PipelineEditor | ✅ Tested (route fix applied) |
| `GET /pipelines/samples` | Get sample pipelines | PipelineEditor | ✅ Tested |
| `POST /runs` | Create run | NewExperiment | ✅ Tested |
| `GET /runs/{id}` | Get run details | RunProgress | ✅ Tested |
| `GET /runs/stats` | Get run stats | Dashboard | ✅ Tested |
| `GET /workspaces` | List workspaces | Settings | ✅ Tested |
| `GET /workspace/stats` | Workspace stats | Dashboard | ✅ Tested |
| `GET /system/info` | System information | Settings | ✅ Tested |
| `GET /system/capabilities` | System capabilities | Settings | ✅ Tested |
| `GET /system/status` | System status | Dashboard | ✅ Tested (bug fixed) |
| `GET /ws/stats` | WebSocket stats | Monitoring | ✅ Tested |

### 3.3 Bugs Fixed During Phase 3

| Issue | File | Fix |
|-------|------|-----|
| Route ordering: `/pipelines/operators` returned 404 | `api/pipelines.py` | Moved route handlers before `{pipeline_id}` route using forwarding pattern |
| Route ordering: `/pipelines/validate` returned 404 | `api/pipelines.py` | Same fix - forwarding routes before dynamic route |
| Route ordering: `/pipelines/count-variants` returned 404 | `api/pipelines.py` | Same fix - forwarding routes before dynamic route |
| `AttributeError`: `linked_datasets` not found | `api/system.py` | Changed to `workspace.datasets` |
| `AttributeError`: `last_modified` not found | `api/system.py` | Changed to `workspace.last_accessed` |
| `PipelineCountRequest` undefined at import | `api/pipelines.py` | Moved Pydantic model class before forwarding routes |

---

## Phase 4: Error Handling & UX Polish ✅ COMPLETED

### 4.1 Error States ✅ IMPLEMENTED

**Created**: Reusable state display component library at `src/components/ui/state-display.tsx`

**Components Implemented**:
- `EmptyState` - Generic empty state with customizable icon, title, description, and actions
- `ErrorState` - Full-card error display with retry option
- `InlineError` - Compact inline error message with optional retry button
- `NoWorkspaceState` - Specialized empty state for no workspace linked
- `NoDatasetsState` - Specialized empty state for no datasets available
- `NoPipelinesState` - Specialized empty state for no pipelines saved
- `NoResultsState` - Specialized empty state for no run results
- `RunFailedState` - Run failure display with error message and retry/logs options
- `ReconnectingIndicator` - WebSocket reconnecting indicator with amber styling
- `SearchEmptyState` - Empty state for search with no results and clear option

**Pages Updated**:
- [x] `RunProgress.tsx` - Added WebSocket reconnecting indicator
- [x] `Runs.tsx` - Uses NoWorkspaceState, EmptyState, CardSkeleton
- [x] `Results.tsx` - Uses ErrorState, NoWorkspaceState, NoResultsState, CardSkeleton
- [x] `Predictions.tsx` - Uses LoadingState, ErrorState, NoWorkspaceState, EmptyState
- [x] `Pipelines.tsx` - Uses InlineError, SearchEmptyState, NoPipelinesState
- [x] `NewExperiment.tsx` - Uses InlineLoading, InlineError, NoDatasetsState, NoPipelinesState
- [x] `Dashboard.tsx` - Uses InlineError for error state

### 4.2 Loading States ✅ IMPLEMENTED

**Components**:
- `LoadingState` - Full-card loading indicator with customizable message
- `InlineLoading` - Compact inline loading indicator
- `CardSkeleton` - Card-based skeleton loader with configurable count

**Coverage**:
- [x] Dataset list loading (`NewExperiment.tsx` - InlineLoading)
- [x] Pipeline list loading (`NewExperiment.tsx` - InlineLoading)
- [x] Run list loading (`Runs.tsx` - CardSkeleton)
- [x] Results loading (`Results.tsx` - CardSkeleton)
- [x] Predictions loading (`Predictions.tsx` - LoadingState)
- [x] Run execution progress (`RunProgress.tsx` - enhanced progress indicators)

### 4.3 Empty States ✅ IMPLEMENTED

**Coverage**:
- [x] No runs yet (`Runs.tsx` - EmptyState with "Start Experiment" CTA)
- [x] No results for dataset (`Results.tsx` - NoResultsState)
- [x] No predictions made (`Predictions.tsx` - EmptyState)
- [x] No pipelines saved (`Pipelines.tsx` - NoPipelinesState)
- [x] Search no match (`Pipelines.tsx` - SearchEmptyState)

### 4.4 WebSocket Resilience ✅ ENHANCED

**Implementation in `RunProgress.tsx`**:
- Added `wsReconnecting` state to track WebSocket connection status
- Added `handleReconnecting` and `handleConnected` callbacks
- `ReconnectingIndicator` displays when connection is lost
- Exponential backoff reconnection (already in Phase 2)

---

## Implementation Order

### Week 1: Core Fixes ✅ COMPLETED
1. ✅ Fix pipeline save/list flow (1.1)
2. ✅ Wire NewExperiment to real datasets (1.2)
3. ✅ Wire NewExperiment to real pipelines (1.3)
4. ✅ Implement handleLaunch API call (1.4)
5. ✅ Backend run creation validation (2.1)

### Week 2: Execution ✅ COMPLETED
6. ✅ Enhanced pipeline execution with progress callbacks (2.2)
7. ✅ Enhanced RunProgress page with streaming logs (2.3)
8. ✅ Added run persistence across server restarts (2.4)
9. ✅ Added WebSocket log streaming (2.5)

### Week 3: Testing & Polish ✅ COMPLETED
10. ✅ End-to-end testing (3.1) - Created comprehensive test suite
11. ✅ API integration verification (3.2) - All endpoints tested and working
12. ✅ Error handling (4.1) - Reusable state-display component library
13. ✅ Loading states (4.2) - LoadingState, InlineLoading, CardSkeleton
14. ✅ Empty states (4.3) - Specialized empty states for all pages
15. ✅ WebSocket resilience (4.4) - Reconnecting indicator in RunProgress

---

## Files to Modify

### Frontend
| File | Changes | Status |
|------|---------|--------|
| `src/components/ui/state-display.tsx` | Created reusable state display components | ✅ Created (Phase 4) |
| `src/pages/NewExperiment.tsx` | Remove mocks, add API calls, wire launch, use state components | ✅ Enhanced |
| `src/pages/Pipelines.tsx` | Debug listing issue if needed, use state components | ✅ Enhanced |
| `src/pages/PipelineEditor.tsx` | Verify save function | ✅ OK |
| `src/pages/RunProgress.tsx` | Enhanced WebSocket, streaming logs, progress, reconnecting indicator | ✅ Enhanced |
| `src/pages/Runs.tsx` | Use state display components | ✅ Enhanced (Phase 4) |
| `src/pages/Results.tsx` | Use state display components | ✅ Enhanced (Phase 4) |
| `src/pages/Predictions.tsx` | Use state display components | ✅ Enhanced (Phase 4) |
| `src/pages/Dashboard.tsx` | Use InlineError component | ✅ Enhanced (Phase 4) |
| `src/hooks/usePipelines.ts` | Debug if listing fails | ✅ OK |
| `src/api/client.ts` | Verify all endpoints | ✅ OK |

### Backend
| File | Changes | Status |
|------|---------|--------|
| `api/runs.py` | Validate create_run, improve execution, persistence | ✅ Enhanced |
| `api/pipelines.py` | Fixed route ordering for operators/validate/count-variants | ✅ Fixed |
| `api/datasets.py` | Verify dataset info retrieval | ✅ OK |
| `api/system.py` | Fixed attribute errors (datasets, last_accessed) | ✅ Fixed |
| `api/workspace_manager.py` | Verify paths | ✅ OK |
| `websocket/manager.py` | Added log streaming helper | ✅ Enhanced |
| `websocket/__init__.py` | Export new functions | ✅ Updated |

### Tests
| File | Purpose | Status |
|------|---------|--------|
| `tests/test_integration_flow.py` | Phase 3 integration tests (37 tests) | ✅ Created |

---

## Success Criteria

The integration is complete when:

1. ✅ User can link a workspace with datasets
2. ✅ User can design and save a pipeline in the editor
3. ✅ Saved pipelines appear in the Pipelines page
4. ✅ User can create a new run selecting real datasets and pipelines
5. ✅ Run executes using nirs4all library
6. ✅ Run progress displays in real-time
7. ✅ Completed runs show in Runs list with metrics
8. ✅ Results page displays run results
9. ✅ User can make predictions with trained model

---

## Related Documentation

- [CONCEPTS_RUN_RESULTS_PRED.md](./CONCEPTS_RUN_RESULTS_PRED.md) - Core concepts
- [UI_SPECIFICATION.md](./UI_SPECIFICATION.md) - UI specifications
- [PLAYGROUND_SPECIFICATION.md](./PLAYGROUND_SPECIFICATION.md) - Playground feature
- [nirs4all API docs](../../../nirs4all/docs/) - Library documentation
