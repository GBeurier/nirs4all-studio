# Roadmap: Datasets & Workspace Management

> **Status**: Draft
> **Version**: 0.1
> **Last Updated**: 2025-01-07
> **Priority**: High (Core Feature)

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

- [ ] **T1.1**: Design wizard step components (React)
- [ ] **T1.2**: Create `DatasetWizard` container component
- [ ] **T1.3**: Implement step 1: Source selection with folder/file/URL pickers
- [ ] **T1.4**: Implement step 2: File detection with drag-drop reordering
- [ ] **T1.5**: Implement step 3: Parsing config with global/per-file overrides
- [ ] **T1.6**: Implement step 4: Target and metadata column selection
- [ ] **T1.7**: Implement step 5: Preview with spectra chart and stats
- [ ] **T1.8**: Backend API: `/api/datasets/preview` for parsing preview
- [ ] **T1.9**: Backend API: `/api/datasets/detect-files` for folder scanning
- [ ] **T1.10**: Backend API: `/api/datasets/detect-format` for file format detection
- [ ] **T1.11**: Integrate with existing `link_dataset` with extended config
- [ ] **T1.12**: Add validation at each step with helpful error messages
- [ ] **T1.13**: Store complete loading config in workspace.json

---

## Phase 2: Dataset Versioning & Integrity

**Priority**: 🟠 High
**Estimated Effort**: Medium (1 week)

### 2.1 Content Hashing

Compute a hash of the dataset content to detect changes:

```python
# Backend: datasets.py
def compute_dataset_hash(dataset_path: Path) -> str:
    """Compute SHA-256 hash of dataset files."""
    hasher = hashlib.sha256()
    for file in sorted(dataset_path.glob("**/*")):
        if file.is_file():
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

- [ ] **T2.1**: Add `hash`, `last_verified`, `version` fields to dataset schema
- [ ] **T2.2**: Compute hash on dataset link
- [ ] **T2.3**: Background hash verification on workspace load
- [ ] **T2.4**: UI: Status badges (current, modified, missing, unchecked)
- [ ] **T2.5**: UI: Refresh confirmation dialog with change summary
- [ ] **T2.6**: UI: Relink dialog with path picker and validation
- [ ] **T2.7**: API: `POST /api/datasets/{id}/verify` - verify hash
- [ ] **T2.8**: API: `POST /api/datasets/{id}/relink` - update path

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

- [ ] **T3.1**: Update dataset schema to support multiple targets
- [ ] **T3.2**: Wizard step 4: Multi-select for target columns
- [ ] **T3.3**: Store target metadata (type, unit, classes)
- [ ] **T3.4**: Dataset card: Show all targets with types
- [ ] **T3.5**: Experiment wizard: Target selector per dataset
- [ ] **T3.6**: Pipeline Editor: Target selector in dataset binding
- [ ] **T3.7**: Backend: Accept `target_column` param in run/predict

---

## Phase 4: Pipeline Integration

**Priority**: 🟡 Medium
**Estimated Effort**: Medium (1 week)

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

- [ ] **T4.1**: Add "Bind Dataset" dropdown to Pipeline Editor header
- [ ] **T4.2**: Store binding in local state (not saved with pipeline)
- [ ] **T4.3**: Pass bound dataset info to step components
- [ ] **T4.4**: Show sample/feature counts next to binding
- [ ] **T4.5**: Shape propagation calculator
- [ ] **T4.6**: Display shape changes in pipeline tree
- [ ] **T4.7**: Warn when step params exceed data dimensions

---

## Phase 5: Workspace & Settings Improvements

**Priority**: 🟡 Medium
**Estimated Effort**: Small (3-5 days)

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

- [ ] **T5.1**: API: `GET /api/workspace/stats` - compute space usage
- [ ] **T5.2**: UI: Space usage visualization with progress bars
- [ ] **T5.3**: UI: Clean cache action with confirmation
- [ ] **T5.4**: UI: Reorganize Settings page sections
- [ ] **T5.5**: Store data loading defaults in workspace config
- [ ] **T5.6**: Apply defaults in wizard, allow override

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

- [ ] **T6.1**: Add developer mode toggle in Settings
- [ ] **T6.2**: Conditional UI for developer mode features
- [ ] **T6.3**: API: `/api/datasets/generate-synthetic`
- [ ] **T6.4**: Dashboard: Synthetic data generation card
- [ ] **T6.5**: Options for repetitions, metadata, noise
- [ ] **T6.6**: Auto-link generated dataset to workspace

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
| `/api/datasets/generate-synthetic` | POST | Generate synthetic data | 6 |

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
│   ├── index.tsx            # Wizard container
│   ├── WizardContext.tsx    # State management
│   ├── SourceStep.tsx       # Step 1
│   ├── FileMappingStep.tsx  # Step 2
│   ├── ParsingStep.tsx      # Step 3
│   ├── TargetsStep.tsx      # Step 4
│   ├── PreviewStep.tsx      # Step 5
│   └── components/
│       ├── FileTable.tsx
│       ├── ParsingOptions.tsx
│       ├── TargetSelector.tsx
│       └── DataPreview.tsx
├── DatasetCard.tsx          # Enhanced with status badge
├── DatasetStatusBadge.tsx   # NEW: Version status indicator
├── RelinkDialog.tsx         # NEW: Path update dialog
├── RefreshDialog.tsx        # NEW: Change summary dialog
└── index.ts
```

---

## Dependencies

### Phase Dependencies

```
Phase 1 (Wizard) ─────────┬───────────────────────────────────────────┐
                          ↓                                           ↓
Phase 2 (Versioning) ─────┴──→ Phase 3 (Multi-Target) ──→ Phase 4 (Pipeline)
                                                                      ↓
Phase 5 (Settings) ←──────────────────────────────────────────────────┘
                          ↓
Phase 6 (Dev Mode) ←──────┘
```

### External Dependencies

- **nirs4all**: All data loading functionality
- **pywebview**: Native file dialogs (desktop mode)
- **recharts**: Data preview charts
- **shadcn/ui**: UI components

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Dataset loading success rate | > 95% |
| Average wizard completion time | < 3 minutes |
| User confusion (support tickets) | < 5% of users |
| Dataset format support coverage | 100% of nirs4all formats |

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.1 | 2025-01-07 | Copilot | Initial draft from UI_SPECIFICATION annotations |

