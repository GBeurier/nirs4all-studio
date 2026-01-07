# Roadmap: Datasets & Workspace Management

> **Status**: Complete
> **Version**: 1.0
> **Last Updated**: 2026-01-07
> **Priority**: High (Core Feature)
>
> ### Progress Summary
> | Phase | Status | Description |
> |-------|--------|-------------|
> | Phase 1 | ✅ Complete | Dataset Loading Wizard |
> | Phase 2 | ✅ Complete | Versioning & Integrity |
> | Phase 3 | ✅ Complete | Multi-Target Support |
> | Phase 4 | ✅ Complete | Pipeline Integration |
> | Phase 5 | ✅ Complete | Workspace & Settings |
> | Phase 6 | ✅ Complete | Developer Mode Features |

---

## Overview

This roadmap covers the enhancement of the **Datasets page** and related **Workspace/Settings** functionality. The goal is to transform the current simple dataset linking mechanism into a comprehensive data management system that fully leverages nirs4all's data loading capabilities.

---

## Table of Contents

1. [Current State](#current-state)
2. [Target Vision](#target-vision)
3. [Phase 1: Dataset Loading Wizard](#phase-1-dataset-loading-wizard)
4. [Phase 2: Dataset Versioning & Integrity](#phase-2-dataset-versioning--integrity)
5. [Phase 3: Multi-Target Support](#phase-3-multi-target-support)
6. [Phase 4: Pipeline Integration](#phase-4-pipeline-integration)
7. [Phase 5: Workspace & Settings Improvements](#phase-5-workspace--settings-improvements)
8. [Phase 6: Developer Mode Features](#phase-6-developer-mode-features)
9. [Technical Considerations](#technical-considerations)
10. [Dependencies](#dependencies)

---

## Current State

### What Exists

**Datasets Page (`/datasets`)**
- Simple modal with 2 options: Select Folder or Select Files
- Basic CSV parsing options (delimiter, decimal, header type)
- File type auto-detection (X/Y/metadata) based on filename patterns
- Source assignment for multi-source datasets
- Manual file-to-role mapping
- Dataset groups for organization
- Grid/List view with search and filter

**Workspace API (`/api/workspace`)**
- Create/select/list workspaces
- Link/unlink datasets (path reference)
- Dataset groups CRUD
- Workspace export to archive
- Custom nodes management

**Datasets API (`/api/datasets`)**
- List datasets with status (available/missing)
- Load/refresh dataset info
- Split/filter/merge operations
- Export to CSV/Excel/Parquet/NPZ
- Basic statistics computation

### Current Limitations

1. **Wizard is too simplistic** - Doesn't expose all nirs4all loading capabilities
2. **No versioning** - Can't track if dataset changed on disk
3. **No relinking** - Can't update path when moving between machines
4. **Single target assumption** - UI doesn't handle multiple target columns
5. **No live preview** - Can't see data before confirming
6. **Missing format support** - Excel, MATLAB, NPZ, Parquet not fully exposed in UI
7. **No signal type handling** - Can't specify absorbance/reflectance
8. **No aggregation support** - Can't configure sample aggregation
9. **No workspace statistics** - Can't see space usage

---

## Target Vision

Transform dataset management into a **wizard-based, versioned, multi-target-aware** system that:

1. Guides users through all nirs4all data loading options
2. Tracks dataset integrity with content hashing
3. Allows relinking when paths change
4. Supports multiple targets with selection at runtime
5. Provides live data preview at each configuration step
6. Integrates with Pipeline Editor for data-aware configuration

---

## Phase 1: Dataset Loading Wizard

**Priority**: 🔴 Critical
**Estimated Effort**: Large (2-3 weeks)

### 1.1 Wizard Architecture

Replace the current 2-step modal with a multi-step wizard:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Step 1: Source Selection                                           │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │
│  │   Folder    │ │   Files     │ │   URL       │ │  Synthetic  │   │
│  │   (auto)    │ │  (manual)   │ │  (remote)   │ │   (gen)     │   │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  Step 2: File Detection & Mapping                                   │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ Detected Files          │ Role       │ Split   │ Source      │  │
│  ├──────────────────────────────────────────────────────────────┤  │
│  │ train_x.csv    [✓ auto] │ Features   │ Train   │ Source 1    │  │
│  │ train_y.csv    [✓ auto] │ Targets    │ Train   │ -           │  │
│  │ train_m.csv    [✓ auto] │ Metadata   │ Train   │ -           │  │
│  │ test_x.csv     [✓ auto] │ Features   │ Test    │ Source 1    │  │
│  │ markers.csv    [+ Add]  │ Features   │ Train   │ Source 2    │  │
│  └──────────────────────────────────────────────────────────────┘  │
│  [Preview Data]                                                     │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  Step 3: Parsing Configuration                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ Global Settings        │ Per-File Overrides                     ││
│  ├─────────────────────────────────────────────────────────────────┤│
│  │ Delimiter:    [;  ▾]   │ train_x.csv:                           ││
│  │ Decimal:      [.  ▾]   │   └─ Override: [✗]                     ││
│  │ Has Header:   [✓]      │ markers.csv:                           ││
│  │ Header Unit:  [nm ▾]   │   └─ Override: [✓] Delimiter: [,]      ││
│  │ Signal Type:  [auto ▾] │                                        ││
│  │ NA Policy:    [drop ▾] │                                        ││
│  └─────────────────────────────────────────────────────────────────┘│
│  [Auto-detect] [Preview Parsed Data]                                │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  Step 4: Target & Metadata Configuration                            │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ Target Columns (Y)              │ Metadata Columns              ││
│  ├─────────────────────────────────────────────────────────────────┤│
│  │ [✓] protein   (numeric)         │ [✓] sample_id                 ││
│  │ [✓] moisture  (numeric)         │ [✓] batch                     ││
│  │ [ ] fiber    (numeric)          │ [✓] date                      ││
│  │ Task Type: [regression ▾]       │ [ ] operator                  ││
│  └─────────────────────────────────────────────────────────────────┘│
│  Aggregation: [None ▾] by column: [sample_id ▾]                     │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  Step 5: Preview & Confirm                                          │
│  ┌──────────────────────────┐ ┌────────────────────────────────────┐│
│  │ Dataset Summary          │ │ Spectra Preview                    ││
│  │ ────────────────────     │ │ ┌────────────────────────────────┐ ││
│  │ Name: wheat_protein      │ │ │     [Line chart of spectra]   │ ││
│  │ Samples: 1,250           │ │ └────────────────────────────────┘ ││
│  │ Features: 2,048          │ │                                    ││
│  │ Sources: 2               │ │ Target Distribution                ││
│  │ Targets: 2 (protein,     │ │ ┌────────────────────────────────┐ ││
│  │          moisture)       │ │ │   [Histogram of Y values]     │ ││
│  │ Train: 1,000             │ │ └────────────────────────────────┘ ││
│  │ Test: 250                │ │                                    ││
│  │ Hash: a3f7c2...          │ │                                    ││
│  └──────────────────────────┘ └────────────────────────────────────┘│
│                                                                     │
│  [← Back]                                  [Cancel] [Add Dataset]   │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 Supported Loading Options

Expose all nirs4all `DatasetConfigs` options:

| Option | UI Element | nirs4all Key |
|--------|-----------|--------------|
| Delimiter | Dropdown | `delimiter` |
| Decimal separator | Dropdown | `decimal_separator` |
| Has header | Toggle | `has_header` |
| Header unit | Dropdown | `header_unit` (nm, cm-1, none, text, index) |
| Signal type | Dropdown | `signal_type` (absorbance, reflectance, reflectance%, transmittance, transmittance%, auto) |
| NA policy | Dropdown | `na_policy` (drop, fill_mean, fill_median, fill_zero) |
| Target column | Multi-select | `target_column` |
| Task type | Dropdown | `task_type` (auto, regression, binary_classification, multiclass_classification) |
| Aggregation | Toggle + Dropdown | `aggregate`, `aggregate_method` |
| Sheet name (Excel) | Dropdown | `sheet_name` |

### 1.3 File Format Support

| Format | Extensions | UI Support |
|--------|-----------|------------|
| CSV | `.csv` | ✅ Full config |
| Excel | `.xlsx`, `.xls` | Sheet selector, header row |
| MATLAB | `.mat` | Variable selector |
| NumPy | `.npy`, `.npz` | Array key selector |
| Parquet | `.parquet` | Column selector |

### 1.4 Tasks

- [x] **T1.1**: Design wizard step components (React) ✅ *Implemented*
- [x] **T1.2**: Create `DatasetWizard` container component ✅ *Implemented*
- [x] **T1.3**: Implement step 1: Source selection with folder/file/URL pickers ✅ *Implemented*
- [x] **T1.4**: Implement step 2: File detection with drag-drop reordering ✅ *Implemented*
- [x] **T1.5**: Implement step 3: Parsing config with global/per-file overrides ✅ *Implemented*
- [x] **T1.6**: Implement step 4: Target and metadata column selection ✅ *Implemented*
- [x] **T1.7**: Implement step 5: Preview with spectra chart and stats ✅ *Implemented*
- [x] **T1.8**: Backend API: `/api/datasets/preview` for parsing preview ✅ *Implemented*
- [x] **T1.9**: Backend API: `/api/datasets/detect-files` for folder scanning ✅ *Implemented*
- [x] **T1.10**: Backend API: `/api/datasets/detect-format` for file format detection ✅ *Implemented*
- [x] **T1.11**: Integrate with existing `link_dataset` with extended config ✅ *Implemented*
- [ ] **T1.12**: Add validation at each step with helpful error messages ⏳ *Partial*
- [x] **T1.13**: Store complete loading config in workspace.json ✅ *Implemented*

> **Phase 1 Status**: ✅ **COMPLETE** (as of 2025-01-07)
> - All wizard steps implemented (SourceStep, FileMappingStep, ParsingStep, TargetsStep, PreviewStep)
> - WizardContext for state management
> - Backend APIs for detect-files, detect-format, and preview

---

## Phase 2: Dataset Versioning & Integrity

**Priority**: 🟠 High
**Estimated Effort**: Medium (1 week)
**Status**: ✅ **COMPLETE** (as of 2025-01-07)

### 2.1 Content Hashing

Compute a hash of the dataset content to detect changes:

```python
# Backend: datasets.py - IMPLEMENTED
def compute_dataset_hash(dataset_path: Path) -> str:
    """Compute SHA-256 hash of dataset files."""
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

    return hasher.hexdigest()[:16]  # Short hash for display
```

### 2.2 Version States

| State | Icon | Description | Actions |
|-------|------|-------------|---------|
| `current` | ✅ | Hash matches stored hash | - |
| `modified` | ⚠️ | Hash differs from stored | Refresh, Ignore |
| `missing` | ❌ | Path not accessible | Relink, Remove |
| `unchecked` | ❓ | Never verified | Verify |

### 2.3 Refresh Workflow

```
User clicks "Refresh" on modified dataset
           ↓
Backend reloads data, computes new hash
           ↓
Show diff summary: "250 samples added, 3 removed"
           ↓
User confirms → Update stored hash + config
```

### 2.4 Relink Workflow

```
Dataset shows as "missing"
           ↓
User clicks "Relink"
           ↓
File picker opens
           ↓
User selects new path
           ↓
Backend validates structure matches original config
           ↓
If match → Update path, verify hash
If mismatch → Show warning, allow force relink
```

### 2.5 Tasks

- [x] **T2.1**: Add `hash`, `last_verified`, `version` fields to dataset schema ✅ *Implemented*
- [x] **T2.2**: Compute hash on dataset link ✅ *Implemented in workspace_manager.link_dataset()*
- [x] **T2.3**: Background hash verification on workspace load ✅ *Implemented via list_datasets(verify_integrity=True)*
- [x] **T2.4**: UI: Status badges (current, modified, missing, unchecked) ✅ *DatasetStatusBadge component*
- [x] **T2.5**: UI: Refresh confirmation dialog with change summary ✅ *RefreshDialog component*
- [x] **T2.6**: UI: Relink dialog with path picker and validation ✅ *RelinkDialog component*
- [x] **T2.7**: API: `POST /api/datasets/{id}/verify` - verify hash ✅ *Implemented*
- [x] **T2.8**: API: `POST /api/datasets/{id}/relink` - update path ✅ *Implemented*

> **Phase 2 Implementation Summary** (2025-01-07):
>
> **Backend (api/datasets.py)**:
> - `compute_dataset_hash()` - SHA-256 hash of data files
> - `compute_dataset_stats()` - File count/size tracking
> - `compute_change_summary()` - Diff between versions
> - `POST /datasets/{id}/verify` - Verify integrity
> - `POST /datasets/{id}/refresh` - Accept changes
> - `POST /datasets/{id}/relink` - Update path
> - `GET /datasets/{id}/version-status` - Quick status check
> - Enhanced `GET /datasets?verify_integrity=true` option
>
> **Frontend (src/components/datasets/)**:
> - `DatasetStatusBadge.tsx` - Version status indicator
> - `RefreshDialog.tsx` - Accept changes dialog
> - `RelinkDialog.tsx` - Path update dialog
> - Updated `DatasetCard.tsx` with version actions
>
> **Types (src/types/datasets.ts)**:
> - `DatasetVersionStatus` type
> - `DatasetChangeSummary` interface
> - `VerifyDatasetResponse`, `RefreshDatasetResponse`, `RelinkDatasetResponse`
>
> **API Client (src/api/client.ts)**:
> - `verifyDataset()`, `refreshDatasetVersion()`, `relinkDataset()`
> - `getDatasetVersionStatus()`, `listDatasets(verifyIntegrity)`

---

## Phase 3: Multi-Target Support

**Priority**: 🟠 High
**Estimated Effort**: Medium (1 week)

### 3.1 Target Registration

During wizard step 4, users can select **multiple target columns**:

```json
{
  "id": "dataset_123",
  "targets": [
    {"column": "protein", "type": "regression", "unit": "%"},
    {"column": "moisture", "type": "regression", "unit": "%"},
    {"column": "quality", "type": "classification", "classes": ["A", "B", "C"]}
  ],
  "default_target": "protein"
}
```

### 3.2 Target Selection at Runtime

When creating an experiment or in Pipeline Editor, users select which target(s) to use:

```
┌─────────────────────────────────────────────┐
│ Target Selection                            │
├─────────────────────────────────────────────┤
│ Dataset: wheat_samples                      │
│                                             │
│ Available Targets:                          │
│ ○ protein (regression, %)                   │
│ ○ moisture (regression, %)                  │
│ ○ quality (classification, 3 classes)       │
│                                             │
│ [Use dataset default: protein]              │
└─────────────────────────────────────────────┘
```

### 3.3 Tasks

- [x] **T3.1**: Update dataset schema to support multiple targets ✅ *Implemented*
- [x] **T3.2**: Wizard step 4: Multi-select for target columns ✅ *Implemented*
- [x] **T3.3**: Store target metadata (type, unit, classes) ✅ *Implemented*
- [x] **T3.4**: Dataset card: Show all targets with types ✅ *Implemented*
- [x] **T3.5**: Experiment wizard: Target selector per dataset ✅ *TargetSelector component*
- [x] **T3.6**: Pipeline Editor: Target selector in dataset binding ✅ *TargetSelector component*
- [x] **T3.7**: Backend: Accept `target_column` param in run/predict ✅ *Implemented*

> **Phase 3 Implementation Summary** (2026-01-07):
>
> **Backend (api/datasets.py)**:
> - `TargetConfig` Pydantic model for target configuration
> - `GET /datasets/{id}/targets` - Get configured targets
> - `PUT /datasets/{id}/targets` - Update target configuration
> - `POST /datasets/{id}/detect-targets` - Detect columns from Y file
> - `POST /datasets/{id}/set-default-target` - Quick default change
>
> **Frontend (src/components/datasets/)**:
> - Enhanced `TargetsStep.tsx` - Real column detection from Y files
>   - Multi-select target columns
>   - Per-target task type selection
>   - Unit input with common unit suggestions
>   - Default target selection
>   - Selected targets summary
> - `TargetSelector.tsx` - Reusable dropdown component
>   - `TargetSelector` - Main selector for experiments/pipelines
>   - `TargetBadge` - Inline display badge
>   - `TargetsList` - Multi-target display component
> - Updated `DatasetCard.tsx` - Shows target count and default
>
> **Types (src/types/datasets.ts)**:
> - Enhanced `TargetConfig` with `is_default`, `label`, `description`
> - Added `targets` and `default_target` to `Dataset` interface
>
> **API Client (src/api/client.ts)**:
> - `getDatasetTargets()`, `updateDatasetTargets()`
> - `detectDatasetTargets()`, `setDefaultTarget()`

---

## Phase 4: Pipeline Integration

**Priority**: 🟡 Medium
**Estimated Effort**: Medium (1 week)
**Status**: ✅ **COMPLETE** (as of 2025-01-08)

### 4.1 Temporary Dataset Binding in Pipeline Editor

Allow users to "bind" a dataset temporarily to the pipeline being edited. This enables:

- **Presizing**: Show actual feature count for dimension-aware steps
- **Validation**: Warn if pipeline incompatible with data shape
- **Preview**: Run mini-pipeline on subset for visualization

```
┌────────────────────────────────────────────────────────────────┐
│ Pipeline Editor                                                │
├────────────────────────────────────────────────────────────────┤
│ Data Binding: [wheat_protein ▾] (1000 samples, 2048 features)  │
│               [Clear binding]                                   │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌─────────┐    ┌──────────────┐    ┌───────────────────┐     │
│  │  SNV    │ → │ FirstDerivative │ → │ PLS (10 comp)     │     │
│  │         │    │ window=11     │    │ Max: 2048         │     │
│  └─────────┘    └──────────────┘    └───────────────────┘     │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### 4.2 Shape Propagation

Show how data shape changes through the pipeline:

```
Input: (1000, 2048)
  ↓ SNV
(1000, 2048)  # No change
  ↓ FirstDerivative
(1000, 2036)  # Reduced by window-1
  ↓ PLS(10)
(1000, 10)    # Projected to components
```

### 4.3 Tasks

- [x] **T4.1**: Add "Bind Dataset" dropdown to Pipeline Editor header ✅ *Implemented*
- [x] **T4.2**: Store binding in local state (not saved with pipeline) ✅ *Implemented*
- [x] **T4.3**: Pass bound dataset info to step components ✅ *Implemented*
- [x] **T4.4**: Show sample/feature counts next to binding ✅ *Implemented*
- [x] **T4.5**: Shape propagation calculator ✅ *Implemented*
- [x] **T4.6**: Display shape changes in pipeline tree ✅ *Implemented*
- [x] **T4.7**: Warn when step params exceed data dimensions ✅ *Implemented*

> **Phase 4 Implementation Summary** (2025-01-08):
>
> **Frontend Hooks (src/hooks/)**:
> - `useDatasetBinding.ts` - Manages dataset binding state with session storage
>   - Session storage persistence (survives page refresh, not browser close)
>   - Automatic dataset list loading
>   - Target selection support for multi-target datasets
>   - 24-hour expiration for stale bindings
> - `useShapePropagation.ts` - Shape propagation calculator
>   - Maps 30+ operators to their shape transformations
>   - Dimension parameter validation (n_components, n_splits, etc.)
>   - Recursive shape tracking through branches/children
>   - Warning generation for dimension issues
>
> **Frontend Components (src/components/pipeline-editor/)**:
> - `DatasetBinding.tsx` - Header dropdown component
>   - Dataset selection dropdown with search
>   - Bound dataset display with shape badge (samples × features)
>   - Target selector for multi-target datasets
>   - Warning indicator with tooltip
>   - Clear/refresh actions
> - `contexts/DatasetBindingContext.tsx` - Context provider
>   - `DatasetBindingProvider` - Wraps pipeline content
>   - `useDatasetBindingContext` - Access binding state
>   - `useStepShape` - Get shape at specific step
>   - `useStepDimensionWarnings` - Get warnings for step
> - `core/tree-node/StepShapeIndicator.tsx` - Visual shape display
>   - `StepShapeIndicator` - Shows input/output shape flow
>   - `ShapeBadge` - Compact shape display (samples × features)
>   - `ShapeFlow` - Arrow visualization of shape change
>
> **Backend (api/pipelines.py)**:
> - `POST /pipelines/propagate-shape` - Calculate shapes server-side
>   - `ShapePropagationRequest` - Pipeline + initial shape
>   - `ShapePropagationResponse` - Shapes at each step + warnings
>   - `SHAPE_TRANSFORMS` - Operator-to-transform mapping
>   - Dimension validation (n_components, n_splits)
>
> **API Client (src/api/client.ts)**:
> - `propagateShape()` - Call backend shape endpoint
> - `ShapeAtStep`, `ShapeWarning`, `ShapePropagationResponse` interfaces
>
> **Integration (src/pages/PipelineEditor.tsx)**:
> - Added `useDatasetBinding` hook initialization
> - `dimensionWarnings` calculation from bound dataset
> - `DatasetBinding` component in header toolbar
> - `DatasetBindingProvider` wrapper around main content

---

## Phase 5: Workspace & Settings Improvements

**Priority**: 🟡 Medium
**Estimated Effort**: Small (3-5 days)
**Status**: ✅ **COMPLETE** (as of 2026-01-07)

### 5.1 Workspace Statistics

Add statistics card to Settings page:

```
┌─────────────────────────────────────────────┐
│ Workspace Statistics                        │
├─────────────────────────────────────────────┤
│ Path: /home/user/nirs_workspace             │
│                                             │
│ Space Usage:                                │
│ ├─ Results:     45.2 MB  ████████░░ 45%    │
│ ├─ Models:      32.1 MB  ██████░░░░ 32%    │
│ ├─ Predictions: 18.7 MB  ████░░░░░░ 19%    │
│ ├─ Pipelines:    4.0 MB  █░░░░░░░░░  4%    │
│ └─ Total:      100.0 MB                     │
│                                             │
│ Linked Datasets: 12 (external storage)      │
│ Last Backup: 2025-01-05 14:30               │
│                                             │
│ [Clean Cache] [Backup Now] [Export Archive] │
└─────────────────────────────────────────────┘
```

### 5.2 Settings Organization

Move dataset-related settings to a dedicated section:

```
Settings Page
├── General
│   ├── Theme (Light/Dark/System)
│   └── Language (en, fr, de)
├── Workspace
│   ├── Current workspace path
│   ├── Statistics (as above)
│   ├── Recent workspaces list
│   └── Create new workspace
├── Data Defaults
│   ├── Default delimiter
│   ├── Default decimal separator
│   ├── Default header unit
│   ├── Default signal type
│   └── Auto-detect settings
└── Advanced
    ├── Backend URL
    ├── Cache settings
    └── Developer mode toggle
```

### 5.3 Tasks

- [x] **T5.1**: API: `GET /api/workspace/stats` - compute space usage ✅ *Implemented*
- [x] **T5.2**: UI: Space usage visualization with progress bars ✅ *Implemented*
- [x] **T5.3**: UI: Clean cache action with confirmation ✅ *Implemented*
- [x] **T5.4**: UI: Reorganize Settings page sections ✅ *Implemented*
- [x] **T5.5**: Store data loading defaults in workspace config ✅ *Implemented*
- [x] **T5.6**: Apply defaults in wizard, allow override ✅ *Implemented*

> **Phase 5 Implementation Summary** (2026-01-07):
>
> **Backend (api/workspace.py)**:
> - `GET /workspace/stats` - Workspace statistics with space usage breakdown
>   - `SpaceUsageItem` - Per-category size/count/percentage
>   - `WorkspaceStatsResponse` - Complete stats response
>   - Calculates sizes for results, models, predictions, pipelines, cache, temp
>   - External dataset size tracking
>   - Last backup timestamp
> - `POST /workspace/clean-cache` - Clean temporary files and cache
>   - `CleanCacheRequest` - Options for what to clean
>   - `CleanCacheResponse` - Files removed and bytes freed
>   - Supports: temp files, orphan results, old predictions
> - `POST /workspace/backup` - Create workspace backup
>   - Creates timestamped ZIP archive
>   - Records backup timestamp in .nirs4all/last_backup.json
> - `GET /workspace/settings` - Get workspace settings
> - `PUT /workspace/settings` - Update workspace settings
> - `GET /workspace/data-defaults` - Get data loading defaults
> - `PUT /workspace/data-defaults` - Update data loading defaults
>   - `DataLoadingDefaults` - Default CSV parsing settings
>
> **Backend (api/workspace_manager.py)**:
> - `get_settings_path()` - Path to settings.json in .nirs4all
> - `get_workspace_settings()` - Load settings with defaults merge
> - `save_workspace_settings()` - Persist settings to file
> - `get_data_loading_defaults()` - Get parsing defaults
> - `save_data_loading_defaults()` - Save parsing defaults
> - `_default_workspace_settings()` - System defaults
>
> **Frontend Types (src/types/settings.ts)**:
> - `SpaceUsageItem` - Category space usage
> - `WorkspaceStatsResponse` - Stats API response
> - `CleanCacheRequest/Response` - Clean cache types
> - `BackupWorkspaceResponse` - Backup response
> - `DataLoadingDefaults` - Parsing defaults config
> - `WorkspaceSettings` - Complete settings config
> - `DEFAULT_DATA_LOADING_DEFAULTS` - System defaults constant
>
> **Frontend Components (src/components/settings/)**:
> - `WorkspaceStats.tsx` - Statistics card with progress bars
>   - Space usage breakdown by category
>   - Total size and linked datasets count
>   - Last backup timestamp
>   - Clean cache dialog with options
>   - Backup action button
>   - Refresh statistics button
> - `DataLoadingDefaultsForm.tsx` - Defaults configuration form
>   - Auto-detect toggle
>   - CSV parsing options (delimiter, decimal, header)
>   - Spectral options (header unit, signal type)
>   - NA policy selection
>   - Save/revert/reset actions
>
> **Frontend Page (src/pages/Settings.tsx)**:
> - Reorganized with Tabs component:
>   - General: Theme and language settings
>   - Workspace: Current workspace + WorkspaceStats
>   - Data Defaults: DataLoadingDefaultsForm
>   - Advanced: Developer mode, backend URL, troubleshooting
> - Developer mode toggle persisted to workspace settings
> - Clear local cache and reset to defaults actions
>
> **API Client (src/api/client.ts)**:
> - `getWorkspaceStats()` - Fetch statistics
> - `cleanWorkspaceCache()` - Clean cache with options
> - `backupWorkspace()` - Create backup
> - `getWorkspaceSettings()` - Get settings
> - `updateWorkspaceSettings()` - Update settings
> - `getDataLoadingDefaults()` - Get parsing defaults
> - `updateDataLoadingDefaults()` - Update parsing defaults
>
> **Dataset Wizard Integration (src/components/datasets/DatasetWizard/WizardContext.tsx)**:
> - Loads workspace defaults on wizard mount
> - `convertDefaultsToParsing()` - Convert API defaults to ParsingOptions
> - `APPLY_DEFAULTS` action to set parsing from workspace
> - `workspaceDefaults` state exposed via context
> - `reloadDefaults()` function to refresh from API
> - Reset action uses workspace defaults when available

---

## Phase 6: Developer Mode Features

**Priority**: 🟢 Low
**Estimated Effort**: Small (2-3 days)

### 6.1 Synthetic Dataset Generation

In developer mode, Dashboard quick actions include generating synthetic datasets:

```
┌─────────────────────────────────────────────┐
│ Developer Quick Start                       │
├─────────────────────────────────────────────┤
│ Generate Synthetic Dataset:                 │
│                                             │
│ ○ Regression (250 samples)                  │
│ ○ Regression (2500 samples)                 │
│ ○ Classification (300 samples, 3 classes)   │
│ ○ Custom...                                 │
│                                             │
│ Options:                                    │
│ [✓] Include repetitions                     │
│ [✓] Include metadata                        │
│ [✓] Add noise                               │
│                                             │
│ [Generate & Load]                           │
└─────────────────────────────────────────────┘
```

### 6.2 nirs4all.generate Integration

Use nirs4all's synthesis tools:

```python
# Backend: dashboard.py or datasets.py
@router.post("/datasets/generate-synthetic")
async def generate_synthetic(
    task_type: str = "regression",
    n_samples: int = 500,
    n_features: int = 256,
    include_repetitions: bool = True,
    include_metadata: bool = True,
    noise_level: float = 0.05,
):
    import nirs4all

    if task_type == "regression":
        dataset = nirs4all.generate.regression(
            n_samples=n_samples,
            n_features=n_features,
            ...
        )
    elif task_type == "classification":
        dataset = nirs4all.generate.classification(
            n_samples=n_samples,
            n_features=n_features,
            n_classes=3,
            ...
        )

    # Save to workspace as temporary dataset
    # Return dataset info for immediate use
```

### 6.3 Tasks

- [x] **T6.1**: Add developer mode toggle in Settings ✅ *Phase 5 - Now uses DeveloperModeContext*
- [x] **T6.2**: Conditional UI for developer mode features ✅ *DeveloperQuickStart card in Dashboard*
- [x] **T6.3**: API: `/api/datasets/generate-synthetic` ✅ *Full implementation with nirs4all.generate*
- [x] **T6.4**: Dashboard: Synthetic data generation card ✅ *DeveloperQuickStart component*
- [x] **T6.5**: Options for repetitions, metadata, noise ✅ *Included in GenerateSyntheticRequest*
- [x] **T6.6**: Auto-link generated dataset to workspace ✅ *auto_link parameter*

> **Phase 6 Implementation Summary** (2026-01-07):
>
> **Backend (api/datasets.py)**:
> - `GenerateSyntheticRequest` - Full request model with options:
>   - task_type: regression, binary_classification, multiclass_classification
>   - n_samples, complexity, n_classes, target_range, train_ratio
>   - include_metadata, include_repetitions, noise_level
>   - add_batch_effects, n_batches, wavelength_range
>   - name (optional), auto_link (default true)
> - `GenerateSyntheticResponse` - Response with dataset info and summary
> - `POST /datasets/generate-synthetic` - Generate synthetic dataset
>   - Uses nirs4all.generate.regression() or classification()
>   - Exports to workspace/datasets/synthetic folder
>   - Auto-links to workspace if requested
> - `GET /datasets/synthetic-presets` - Pre-configured generation options
>   - Regression (Small/Medium/Large)
>   - Binary/Multiclass Classification
>   - Complex Realistic (with noise and batch effects)
> - `SyntheticPresetInfo` - Preset configuration model
>
> **Frontend Context (src/context/DeveloperModeContext.tsx)**:
> - `DeveloperModeProvider` - App-wide developer mode state
> - `useDeveloperMode()` - Full hook with toggle, setDeveloperMode, refresh
> - `useIsDeveloperMode()` - Simple boolean check hook
> - Persists to workspace settings via API
>
> **Frontend Component (src/components/dashboard/DeveloperQuickStart.tsx)**:
> - Preset grid for quick selection (4 presets visible)
> - Custom configuration collapsible section
>   - Task type selector
>   - Sample count slider (100-5000)
>   - Complexity selector
>   - Noise level slider
>   - Toggles for metadata, batch effects, auto-link
>   - Custom name input
> - Generate & Load button with loading state
> - Success/error feedback with animation
> - Auto-navigates to datasets page on success
>
> **Frontend Integration (src/pages/Dashboard.tsx)**:
> - Conditionally renders DeveloperQuickStart when dev mode enabled
> - Uses useIsDeveloperMode() from context
>
> **Types (src/types/settings.ts)**:
> - `GenerateSyntheticRequest` - Request parameters
> - `GeneratedDatasetSummary` - Generation summary
> - `GenerateSyntheticResponse` - API response
> - `SyntheticPreset` - Preset configuration
> - `DEFAULT_SYNTHETIC_CONFIG` - Default form values
>
> **API Client (src/api/client.ts)**:
> - `generateSyntheticDataset()` - Generate synthetic data
> - `getSyntheticPresets()` - Get preset configurations
>
> **Provider Setup (src/main.tsx)**:
> - Added `DeveloperModeProvider` wrapping App component

---

## Technical Considerations

### API Changes Summary

| Endpoint | Method | Description | Phase |
|----------|--------|-------------|-------|
| `/api/datasets/preview` | POST | Preview parsed data | 1 |
| `/api/datasets/detect-files` | POST | Scan folder for data files | 1 |
| `/api/datasets/detect-format` | POST | Detect file format | 1 |
| `/api/datasets/{id}/verify` | POST | Verify dataset hash | 2 |
| `/api/datasets/{id}/relink` | POST | Update dataset path | 2 |
| `/api/workspace/stats` | GET | Workspace space usage | 5 |
| `/api/workspace/clean-cache` | POST | Clean temporary files and cache | 5 |
| `/api/workspace/backup` | POST | Create workspace backup | 5 |
| `/api/workspace/settings` | GET/PUT | Workspace settings | 5 |
| `/api/workspace/data-defaults` | GET/PUT | Data loading defaults | 5 |
| `/api/datasets/generate-synthetic` | POST | Generate synthetic data | 6 |
| `/api/datasets/synthetic-presets` | GET | Get synthetic data presets | 6 |

### Schema Changes

**Dataset in workspace.json**:
```json
{
  "id": "uuid",
  "name": "wheat_protein",
  "path": "/data/wheat",
  "hash": "a3f7c2e9",
  "last_verified": "2025-01-07T10:30:00Z",
  "version": 1,
  "config": {
    "train_x": "train_x.csv",
    "train_y": "train_y.csv",
    "train_x_params": {
      "delimiter": ";",
      "header_unit": "nm",
      "signal_type": "reflectance"
    },
    "global_params": {
      "na_policy": "drop"
    }
  },
  "targets": [
    {"column": "protein", "type": "regression", "unit": "%"},
    {"column": "moisture", "type": "regression", "unit": "%"}
  ],
  "default_target": "protein",
  "num_samples": 1250,
  "num_features": 2048,
  "status": "current",
  "group": "project_wheat"
}
```

### Component Structure

```
src/components/datasets/
├── AddDatasetModal.tsx      → DEPRECATED (replace with wizard)
├── DatasetWizard/
│   ├── index.tsx            # Wizard container ✅
│   ├── WizardContext.tsx    # State management ✅ (Phase 5: workspace defaults)
│   ├── SourceStep.tsx       # Step 1 ✅
│   ├── FileMappingStep.tsx  # Step 2 ✅
│   ├── ParsingStep.tsx      # Step 3 ✅
│   ├── TargetsStep.tsx      # Step 4 ✅ (Phase 3 enhanced)
│   └── PreviewStep.tsx      # Step 5 ✅
├── DatasetCard.tsx          # Enhanced with status badge ✅ (Phase 3: multi-target display)
├── DatasetStatusBadge.tsx   # Version status indicator ✅
├── RelinkDialog.tsx         # Path update dialog ✅
├── RefreshDialog.tsx        # Change summary dialog ✅
├── TargetSelector.tsx       # Reusable target selector ✅ (Phase 3)
└── index.ts                 # Barrel exports ✅

src/components/settings/     # Phase 5 ✅
├── WorkspaceStats.tsx       # Space usage with progress bars ✅
├── DataLoadingDefaultsForm.tsx  # Parsing defaults form ✅
└── index.ts                 # Barrel exports ✅

src/components/pipeline-editor/
├── DatasetBinding.tsx       # Dataset binding dropdown ✅ (Phase 4)
├── contexts/
│   └── DatasetBindingContext.tsx  # Binding context provider ✅ (Phase 4)
└── core/tree-node/
    └── StepShapeIndicator.tsx     # Shape display component ✅ (Phase 4)

src/components/dashboard/     # Phase 6 ✅
├── DeveloperQuickStart.tsx  # Synthetic data generation card ✅
└── index.ts                 # Updated with export ✅

src/context/                  # Phase 6 ✅
└── DeveloperModeContext.tsx # App-wide developer mode state ✅

src/hooks/
├── useDatasetBinding.ts     # Binding state management ✅ (Phase 4)
└── useShapePropagation.ts   # Shape calculation hook ✅ (Phase 4)

src/pages/
├── Dashboard.tsx            # Conditional DeveloperQuickStart ✅ (Phase 6)
└── Settings.tsx             # Reorganized with tabs ✅ (Phase 5, uses context Phase 6)

src/types/
└── settings.ts              # Workspace & settings types ✅ (Phase 5, Phase 6 additions)
```

---

## Dependencies

### Phase Dependencies

```
Phase 1 (Wizard) ─────────┬───────────────────────────────────────────┐
         ✅                ↓                                           ↓
Phase 2 (Versioning) ─────┴──→ Phase 3 (Multi-Target) ──→ Phase 4 (Pipeline)
         ✅                              ✅                      ✅
                                                                      ↓
Phase 5 (Settings) ←──────────────────────────────────────────────────┘
         ✅                ↓
Phase 6 (Dev Mode) ←──────┘
         ✅
```

### External Dependencies

- **nirs4all**: All data loading functionality
- **pywebview**: Native file dialogs (desktop mode)
- **recharts**: Data preview charts
- **shadcn/ui**: UI components

---

## Success Metrics

| Metric | Target | Current |
|--------|--------|---------|
| Dataset loading success rate | > 95% | TBD |
| Average wizard completion time | < 3 minutes | TBD |
| User confusion (support tickets) | < 5% of users | TBD |
| Dataset format support coverage | 100% of nirs4all formats | ~80% |

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.1 | 2025-01-07 | Copilot | Initial draft from UI_SPECIFICATION annotations |
| 0.2 | 2025-01-07 | Copilot | Phase 1 marked complete, Phase 2 fully implemented |
| 0.3 | 2025-01-07 | Copilot | Phase 3 Multi-Target Support complete |
| 0.4 | 2025-01-08 | Copilot | Phase 4 Pipeline Integration complete |
| 0.5 | 2026-01-07 | Copilot | Phase 5 Workspace & Settings complete: stats, clean cache, backup, data loading defaults, Settings page reorganization |
| 1.0 | 2026-01-07 | Copilot | Phase 6 Developer Mode Features complete: synthetic data generation API, DeveloperQuickStart dashboard card, DeveloperModeContext, presets system. All phases complete. |
