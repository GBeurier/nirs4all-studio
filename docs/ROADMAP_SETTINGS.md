# Roadmap: Settings Page

> **Status**: Complete
> **Version**: 0.6
> **Last Updated**: 2026-01-07
> **Priority**: Medium
>
> ### Progress Summary
> | Phase | Status | Description |
> |-------|--------|-------------|
> | Phase 1 | ✅ Complete | Basic Settings Structure (via Datasets Roadmap Phase 5) |
> | Phase 2 | ✅ Complete | General Settings Enhancements |
> | Phase 3 | ✅ Complete | Workspace Management Enhancements |
> | Phase 4 | ✅ Complete | Developer Mode & Synthetic Data |
> | Phase 5 | ✅ Complete | System Information & Diagnostics |
> | Phase 6 | ✅ Complete | Localization |

---

## Overview

The Settings page serves as the central configuration hub for the nirs4all webapp. It evolved from a simple theme toggle to a comprehensive settings center through the Datasets Roadmap Phase 5 implementation. This roadmap defines the remaining work to complete the Settings functionality.

### Current State (Implemented)

The Settings page currently has 4 tabs:

| Tab | Contents | Status |
|-----|----------|--------|
| **General** | Theme selection, UI density, reduce animations toggle, keyboard shortcuts | ✅ Complete |
| **Workspace** | Current workspace, WorkspaceStats component | ✅ Complete |
| **Data Defaults** | DataLoadingDefaultsForm component | ✅ Complete |
| **Advanced** | Developer mode toggle, backend URL, troubleshooting | ✅ Complete |

### Target Vision

Transform Settings into a complete application configuration center that:
1. Provides all user preferences in an intuitive interface
2. Exposes developer/power-user features conditionally
3. Offers comprehensive system diagnostics
4. Supports internationalization (i18n)
5. Enables synthetic data generation for testing/demos

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Phase 1: Basic Structure (Complete)](#phase-1-basic-structure-complete)
3. [Phase 2: General Settings Enhancements](#phase-2-general-settings-enhancements)
4. [Phase 3: Workspace Management Enhancements](#phase-3-workspace-management-enhancements)
5. [Phase 4: Developer Mode & Synthetic Data](#phase-4-developer-mode--synthetic-data)
6. [Phase 5: System Information & Diagnostics](#phase-5-system-information--diagnostics)
7. [Phase 6: Localization](#phase-6-localization)
8. [Backend API Reference](#backend-api-reference)
9. [Component Structure](#component-structure)
10. [Technical Considerations](#technical-considerations)

---

## Architecture Overview

### Current Backend Architecture

```
api/
├── workspace.py              # Workspace & settings endpoints
│   ├── GET /workspace/stats          # Space usage breakdown
│   ├── POST /workspace/clean-cache   # Clean temp files
│   ├── POST /workspace/backup        # Create backup
│   ├── GET /workspace/settings       # Workspace settings
│   ├── PUT /workspace/settings       # Update settings
│   ├── GET /workspace/data-defaults  # Data loading defaults
│   ├── PUT /workspace/data-defaults  # Update defaults
│   └── ... (other workspace endpoints)
│
├── workspace_manager.py      # Core workspace management
│   ├── WorkspaceManager class
│   ├── get_settings_path()
│   ├── get_workspace_settings()
│   ├── save_workspace_settings()
│   ├── get_data_loading_defaults()
│   └── save_data_loading_defaults()
│
└── system.py                 # System info endpoints
    ├── GET /health               # Health check
    ├── GET /system/info          # Python & system info
    ├── GET /system/status        # Current status
    ├── GET /system/capabilities  # Available features
    └── GET /system/paths         # Important paths
```

### Current Frontend Architecture

```
src/
├── pages/
│   └── Settings.tsx          # Main settings page (4 tabs)
│
├── components/settings/
│   ├── WorkspaceStats.tsx    # Space usage visualization
│   ├── DataLoadingDefaultsForm.tsx  # Parsing defaults form
│   └── index.ts              # Barrel exports
│
├── types/
│   └── settings.ts           # TypeScript types
│       ├── SpaceUsageItem
│       ├── WorkspaceStatsResponse
│       ├── CleanCacheRequest/Response
│       ├── BackupWorkspaceResponse
│       ├── DataLoadingDefaults
│       └── WorkspaceSettings
│
└── api/
    └── client.ts             # API client functions
        ├── getWorkspaceStats()
        ├── cleanWorkspaceCache()
        ├── backupWorkspace()
        ├── getWorkspaceSettings()
        ├── updateWorkspaceSettings()
        ├── getDataLoadingDefaults()
        └── updateDataLoadingDefaults()
```

### Settings Storage Architecture

```
~/.local/share/nirs4all-webapp/        # Global app data (platformdirs)
├── workspace_config.json              # Current workspace path
└── recent_workspaces.json             # Recent workspaces list

<workspace>/                           # Per-workspace storage
├── workspace.json                     # Workspace config (datasets, pipelines)
└── .nirs4all/
    ├── settings.json                  # Workspace-specific settings
    ├── custom_nodes.json              # Custom operator definitions
    └── last_backup.json               # Backup timestamp
```

---

## Phase 1: Basic Structure (Complete)

**Status**: ✅ Complete (via Datasets Roadmap Phase 5)

This phase was completed as part of the Datasets & Workspace roadmap. Key deliverables:

### Implemented Features

1. **Settings Page with Tabs**
   - 4-tab organization: General, Workspace, Data Defaults, Advanced
   - Framer Motion animations
   - Responsive layout

2. **WorkspaceStats Component**
   - Space usage breakdown by category
   - Progress bar visualization
   - Clean cache with options dialog
   - Backup creation
   - Refresh button

3. **DataLoadingDefaultsForm Component**
   - All parsing options (delimiter, decimal, header, etc.)
   - Auto-detect toggle
   - Save/revert/reset actions
   - Defaults loaded into Dataset Wizard

4. **Developer Mode Toggle**
   - Persisted to workspace settings
   - Exposes additional features when enabled

5. **Backend APIs**
   - Full workspace settings CRUD
   - Space statistics calculation
   - Cache cleaning with options
   - Backup creation

---

## Phase 2: General Settings Enhancements

**Status**: ✅ **COMPLETE** (as of 2026-01-07)
**Priority**: 🟡 Medium
**Estimated Effort**: Small (2-3 days)

### 2.1 Theme Persistence Improvements

Current: Theme stored in localStorage only.

Target: Theme saved to workspace settings for cross-device consistency.

**Tasks**:
- [x] **T2.1.1**: Add `theme` field to workspace settings schema ✅ *Implemented in GeneralSettings*
- [x] **T2.1.2**: Sync theme to backend on change ✅ *ThemeContext syncs to backend*
- [x] **T2.1.3**: Load theme from workspace settings on app startup ✅ *ThemeContext loads from backend*
- [x] **T2.1.4**: Fallback to localStorage for unauthenticated state ✅ *localStorage fallback when no workspace*

### 2.2 UI Density Option

Add compact/comfortable/spacious display density option.

```typescript
type UIDensity = "compact" | "comfortable" | "spacious";

interface GeneralSettings {
  theme: "light" | "dark" | "system";
  ui_density: UIDensity;
  reduce_animations: boolean;
  sidebar_collapsed: boolean;
}
```

**Tasks**:
- [x] **T2.2.1**: Add density toggle in General tab ✅ *ToggleGroup with 3 options*
- [x] **T2.2.2**: Create CSS custom properties for density ✅ *--density-* variables in index.css*
- [x] **T2.2.3**: Apply density class to root element ✅ *UISettingsContext applies classes*
- [x] **T2.2.4**: Persist to workspace settings ✅ *Syncs to backend general.ui_density*

### 2.3 Animation Toggle

Allow disabling animations for accessibility/performance.

**Tasks**:
- [x] **T2.3.1**: Add animations toggle in General tab ✅ *Switch with "Reduce animations" label*
- [x] **T2.3.2**: Conditionally apply `reduce-motion` class ✅ *UISettingsContext applies class*
- [x] **T2.3.3**: Persist to workspace settings ✅ *Syncs to backend general.reduce_animations*

### 2.4 Keyboard Shortcuts Reference

Display available keyboard shortcuts.

```
┌─────────────────────────────────────────────────────────────┐
│ Keyboard Shortcuts                                          │
├─────────────────────────────────────────────────────────────┤
│ Global:                                                     │
│   Ctrl+K          Open command palette                      │
│   Ctrl+/          Toggle sidebar                            │
│   Ctrl+,          Open settings                             │
│                                                             │
│ Pipeline Editor:                                            │
│   Ctrl+S          Save pipeline                             │
│   Ctrl+Z          Undo                                      │
│   Ctrl+Shift+Z    Redo                                      │
│   Delete          Remove selected step                      │
│   Tab             Next panel                                │
│                                                             │
│ Playground:                                                 │
│   Ctrl+Enter      Apply pipeline                            │
│   Ctrl+E          Export                                    │
└─────────────────────────────────────────────────────────────┘
```

**Tasks**:
- [x] **T2.4.1**: Create keyboard shortcuts reference component ✅ *KeyboardShortcuts.tsx*
- [x] **T2.4.2**: Add to General tab as collapsible section ✅ *Collapsible card in Settings*
- [ ] **T2.4.3**: Consider customizable shortcuts (future) ⏳ *Deferred to future enhancement*

> **Phase 2 Implementation Summary** (2026-01-07):
>
> **Frontend Components**:
> - `src/context/UISettingsContext.tsx` - UI density and reduce animations context
> - `src/components/settings/KeyboardShortcuts.tsx` - Collapsible shortcuts reference
> - `src/components/ui/toggle-group.tsx` - Toggle group component for density selection
> - Enhanced `ThemeContext.tsx` - Backend sync with localStorage fallback
> - Updated `Settings.tsx` - UI density, animations toggle, keyboard shortcuts
>
> **Types (src/types/settings.ts)**:
> - `UIDensity` type: "compact" | "comfortable" | "spacious"
> - `GeneralSettings` interface with theme, ui_density, reduce_animations, sidebar_collapsed
> - Updated `WorkspaceSettings` with optional `general` field
> - `DEFAULT_GENERAL_SETTINGS` constant
>
> **CSS (src/index.css)**:
> - `--density-*` CSS custom properties for spacing, padding, gap, font-size
> - `.density-compact`, `.density-comfortable`, `.density-spacious` classes
> - `.reduce-motion` class for accessibility
>
> **Backend (api/workspace.py, api/workspace_manager.py)**:
> - `GeneralSettings` Pydantic model
> - Updated `WorkspaceSettingsResponse` with `general` field
> - Updated `_default_workspace_settings()` with general settings

---

## Phase 3: Workspace Management Enhancements

**Status**: ✅ **COMPLETE** (as of 2026-01-08)
**Priority**: 🟡 Medium
**Estimated Effort**: Medium (1 week)

### 3.1 Recent Workspaces List

Display and manage recent workspaces.

```
┌─────────────────────────────────────────────────────────────┐
│ Recent Workspaces                                           │
├─────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 📁 wheat_project                                        │ │
│ │    /home/user/nirs/wheat                                │ │
│ │    Last accessed: 2 hours ago | 5 datasets, 12 pipelines│ │
│ │    [Open] [Remove from list]                            │ │
│ └─────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 📁 corn_analysis                                        │ │
│ │    /data/nirs/corn                                      │ │
│ │    Last accessed: 3 days ago | 2 datasets, 4 pipelines  │ │
│ │    [Open] [Remove from list]                            │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**Backend** (Already exists):
- `GET /workspace/recent` - returns recent workspaces
- `DELETE /workspace/remove?path=...` - removes from list

**Tasks**:
- [x] **T3.1.1**: Create `RecentWorkspacesList` component ✅
- [x] **T3.1.2**: Implement workspace switch action ✅
- [x] **T3.1.3**: Add relative time display (e.g., "2 hours ago") ✅ *Uses shared formatRelativeTime*
- [x] **T3.1.4**: Add remove from list action ✅
- [x] **T3.1.5**: Replace placeholder in Settings.tsx ✅

### 3.2 Create New Workspace

Wizard to create a new workspace.

```
┌─────────────────────────────────────────────────────────────┐
│ Create New Workspace                                        │
├─────────────────────────────────────────────────────────────┤
│ Name:        [my_project________________]                   │
│ Location:    [/home/user/nirs___________] [Browse]          │
│ Description: [Optional description........]                 │
│                                                             │
│ ☑ Create standard folder structure                          │
│   (results/, pipelines/, models/, predictions/)             │
│                                                             │
│ [Cancel]                              [Create Workspace]    │
└─────────────────────────────────────────────────────────────┘
```

**Backend** (Already exists):
- `POST /workspace/create` - creates new workspace

**Tasks**:
- [x] **T3.2.1**: Create `CreateWorkspaceDialog` component ✅
- [x] **T3.2.2**: Add "Create New" button to Workspace tab ✅ *FolderPlus button in header*
- [x] **T3.2.3**: Integrate with workspace creation API ✅
- [x] **T3.2.4**: Auto-switch to new workspace after creation ✅

### 3.3 Workspace Export/Import Improvements

Enhance the export functionality with better UI feedback.

**Tasks**:
- [x] **T3.3.1**: Add export progress indicator ✅ *Progress bar with percentage*
- [x] **T3.3.2**: Show export summary (files, size) ✅ *formatBytes for size display*
- [x] **T3.3.3**: Add workspace import feature ✅ *Import tab in dialog*
- [x] **T3.3.4**: Validate import compatibility ✅ *Backend validates archive structure*

### 3.4 Scheduled Backups

Allow scheduling automatic backups.

```typescript
interface BackupSettings {
  enabled: boolean;
  interval_hours: number;  // e.g., 24
  max_backups: number;     // Keep last N backups
  include_results: boolean;
  include_models: boolean;
}
```

**Tasks**:
- [x] **T3.4.1**: Add backup settings to workspace settings schema ✅ *Extended WorkspaceSettings*
- [x] **T3.4.2**: Create backup settings form ✅ *BackupSettings.tsx component*
- [x] **T3.4.3**: Backend: Implement scheduled backup check ✅ *Settings stored, check on startup*
- [x] **T3.4.4**: Backend: Auto-cleanup old backups ✅ *max_backups setting honored*

> **Phase 3 Implementation Summary** (2026-01-08):
>
> **Frontend Components Created**:
> - `src/components/settings/RecentWorkspacesList.tsx` - Recent workspaces display with open/remove actions
> - `src/components/settings/CreateWorkspaceDialog.tsx` - Wizard dialog for new workspace creation
> - `src/components/settings/ExportImportDialog.tsx` - Tabbed export/import with progress indicators
> - `src/components/settings/BackupSettings.tsx` - Scheduled backup configuration form
>
> **Shared Utilities Created**:
> - `src/utils/formatters.ts` - Shared formatting functions:
>   - `formatRelativeTime(dateString)` - "Just now", "2 hours ago", etc.
>   - `formatBytes(bytes)` - "1.5 MB", "256 KB", etc.
>   - `formatShortDate(dateString)`, `formatDateTime(dateString)`
>
> **Types Extended (src/types/settings.ts)**:
> - `WorkspaceInfo` - Workspace metadata for list display
> - `WorkspaceListResponse` - API response for workspace listing
> - `CreateWorkspaceRequest`, `ExportWorkspaceRequest/Response`
> - `ImportWorkspaceRequest`, `ImportWorkspaceResponse`
> - `BackupSettings` interface with `DEFAULT_BACKUP_SETTINGS`
> - Extended `WorkspaceSettings` with `backup_max_count`, `backup_include_results`, `backup_include_models`
>
> **API Client Functions Added (src/api/client.ts)**:
> - `getRecentWorkspaces()`, `listWorkspaces()`
> - `createWorkspace()`, `removeWorkspaceFromList()`
> - `exportWorkspace()`, `importWorkspace()`
> - `getBackupSettings()`, `updateBackupSettings()`
>
> **Backend Updates (api/workspace.py, api/workspace_manager.py)**:
> - `ImportWorkspaceRequest` Pydantic model
> - `POST /workspace/import` endpoint
> - Extended `WorkspaceSettingsResponse` with backup fields
> - Updated `_default_workspace_settings()` with backup defaults
>
> **Settings.tsx Integration**:
> - Added Create Workspace button (FolderPlus icon)
> - Added Export/Import button (FileArchive icon)
> - Integrated BackupSettings component in Workspace tab
> - Replaced placeholder with RecentWorkspacesList component
>
> **Refactoring**:
> - Extracted duplicate `formatRelativeTime` from useDashboard.ts to shared utils
> - Extracted duplicate `formatBytes` from WorkspaceStats.tsx to shared utils
> - useDashboard.ts re-exports formatRelativeTime for backward compatibility

---

## Phase 4: Developer Mode & Synthetic Data

**Status**: ✅ **COMPLETE** (as of 2026-01-08)
**Priority**: 🟢 Low (but impactful for testing)
**Estimated Effort**: Medium (1 week)

### 4.1 Developer Mode Conditional UI

When developer mode is enabled, show additional features.

**Affected Areas**:
| Location | Developer Feature |
|----------|------------------|
| Dashboard | Synthetic data generation card |
| Datasets | Generate synthetic dataset button |
| Pipeline Editor | Debug info panel |
| Runs | Force retry failed steps |
| Settings | System diagnostics tab |

**Tasks**:
- [x] **T4.1.1**: Create `useDeveloperMode` hook ✅ *Exists in DeveloperModeContext.tsx*
- [x] **T4.1.2**: Add `DeveloperModeContext` provider ✅ *DeveloperModeProvider in context*
- [x] **T4.1.3**: Conditionally render developer features ✅ *useIsDeveloperMode hook*

### 4.2 Synthetic Data Generation (Dashboard)

Add synthetic data generation to Dashboard quick actions when in dev mode.

```
┌─────────────────────────────────────────────────────────────┐
│ 🧪 Developer Quick Start                                    │
├─────────────────────────────────────────────────────────────┤
│ Generate Synthetic Dataset:                                 │
│                                                             │
│ ○ Regression (250 samples)                                  │
│ ○ Regression (2500 samples, with repetitions)               │
│ ○ Classification (300 samples, 3 classes)                   │
│ ○ Custom...                                                 │
│                                                             │
│ Options:                                                    │
│ [✓] Include repetitions (3 per sample)                      │
│ [✓] Include metadata (batch, date, operator)                │
│ [✓] Add realistic noise                                     │
│                                                             │
│ [Generate & Load]                                           │
└─────────────────────────────────────────────────────────────┘
```

### 4.3 Backend: Synthetic Data Generation API

The backend endpoint uses `nirs4all.generate` with the `SyntheticDatasetBuilder` for flexible configuration.

```python
# api/datasets.py - Implemented

@router.post("/datasets/generate-synthetic")
async def generate_synthetic_dataset(request: GenerateSyntheticRequest):
    """Generate synthetic NIRS dataset using nirs4all.generate."""
    from nirs4all.data.synthetic import SyntheticDatasetBuilder

    builder = SyntheticDatasetBuilder(n_samples=request.n_samples, ...)
    builder.with_features(complexity=request.complexity)

    if request.task_type == "regression":
        builder.with_targets(range=request.target_range)
    else:
        builder.with_classification(n_classes=request.n_classes)

    output_path = builder.export(path, format="standard")
    # Auto-link to workspace if requested
```

### 4.4 Tasks

- [x] **T4.4.1**: Add `POST /datasets/generate-synthetic` endpoint ✅
- [x] **T4.4.2**: Create `SyntheticDataGenerator` component ✅ *DeveloperQuickStart.tsx*
- [x] **T4.4.3**: Add to Dashboard (dev mode only) ✅ *Conditional rendering in Dashboard.tsx*
- [x] **T4.4.4**: Add to Datasets page header (dev mode only) ✅ *SyntheticDataDialog component*
- [x] **T4.4.5**: Support repetitions generation ✅ *include_repetitions parameter*
- [x] **T4.4.6**: Support metadata generation ✅ *include_metadata parameter*
- [x] **T4.4.7**: Auto-link generated dataset to workspace ✅ *auto_link parameter*

> **Phase 4 Implementation Summary** (2026-01-08):
>
> **Frontend Components**:
> - `src/context/DeveloperModeContext.tsx` - Context provider with hooks:
>   - `useDeveloperMode()` - Full context access (isDeveloperMode, toggle, etc.)
>   - `useIsDeveloperMode()` - Simple boolean check
> - `src/components/dashboard/DeveloperQuickStart.tsx` - Dashboard synthetic generation card
> - `src/components/datasets/SyntheticDataDialog.tsx` - Full-featured dialog for Datasets page
>   - Tabbed interface: Quick Presets / Custom Configuration
>   - Preset selection with detailed configuration
>   - Advanced options (batch effects, repetitions, noise level)
>   - Auto-link to workspace option
>
> **Backend Endpoints (api/datasets.py)**:
> - `POST /datasets/generate-synthetic` - Generate synthetic dataset using nirs4all.generate
>   - Uses `SyntheticDatasetBuilder` for flexible configuration
>   - Supports regression and classification tasks
>   - Configurable complexity, noise, train ratio
>   - Auto-links to workspace for immediate use
> - `GET /datasets/synthetic-presets` - Get preset configurations for quick setup
>
> **API Client Functions (src/api/client.ts)**:
> - `generateSyntheticDataset(request)` - Generate synthetic dataset
> - `getSyntheticPresets()` - Get available preset configurations
>
> **Types (src/types/settings.ts)**:
> - `GenerateSyntheticRequest` - Request parameters
> - `GenerateSyntheticResponse` - Response with dataset info
> - `SyntheticPreset` - Preset configuration
> - `DEFAULT_SYNTHETIC_CONFIG` - Default values
>
> **Integration Points**:
> - Dashboard.tsx: Shows `DeveloperQuickStart` when `isDeveloperMode` is true
> - Datasets.tsx: Shows "Generate" button when `isDeveloperMode` is true
> - Settings.tsx: Developer mode toggle in Advanced tab

---

## Phase 5: System Information & Diagnostics

**Status**: ✅ **COMPLETE** (as of 2026-01-07)
**Priority**: 🟢 Low
**Estimated Effort**: Small (2-3 days)

### 5.1 System Information Panel

Display detailed system information (developer mode).

```
┌─────────────────────────────────────────────────────────────┐
│ System Information                                          │
├─────────────────────────────────────────────────────────────┤
│ Python:                                                     │
│   Version: 3.11.5                                           │
│   Executable: /home/user/.venv/bin/python                   │
│                                                             │
│ System:                                                     │
│   OS: Linux (Ubuntu 22.04)                                  │
│   Architecture: x86_64                                      │
│                                                             │
│ nirs4all:                                                   │
│   Version: 0.6.2                                            │
│   Backends: sklearn ✓, tensorflow ✓, pytorch ✓              │
│                                                             │
│ Key Packages:                                               │
│   numpy: 1.26.0        scikit-learn: 1.3.2                  │
│   pandas: 2.1.3        scipy: 1.11.4                        │
│   tensorflow: 2.15.0   torch: 2.1.0                         │
│                                                             │
│ Capabilities:                                               │
│   ✓ GPU (CUDA)   ✓ Excel Export   ✓ Visualization           │
└─────────────────────────────────────────────────────────────┘
```

**Backend** (Already exists):
- `GET /system/info` - Python & system info
- `GET /system/capabilities` - Available features

**Tasks**:
- [x] **T5.1.1**: Create `SystemInfo` component ✅
- [x] **T5.1.2**: Fetch and display `/system/info` ✅
- [x] **T5.1.3**: Show capabilities with check/cross icons ✅
- [x] **T5.1.4**: Add to Advanced tab (dev mode) ✅

### 5.2 Health Check Display

Show backend connection status.

```
┌─────────────────────────────────────────────────────────────┐
│ Backend Status                                              │
├─────────────────────────────────────────────────────────────┤
│ ● Connected                                                 │
│ URL: http://127.0.0.1:8000                                  │
│ Latency: 12ms                                               │
│ Last check: Just now                                        │
│                                                             │
│ [Test Connection]                                           │
└─────────────────────────────────────────────────────────────┘
```

**Tasks**:
- [x] **T5.2.1**: Create `BackendStatus` component ✅
- [x] **T5.2.2**: Periodic health check (every 30s) ✅
- [x] **T5.2.3**: Show latency measurement ✅
- [x] **T5.2.4**: Manual test connection button ✅

### 5.3 Error Log Viewer

Display recent errors for debugging.

**Tasks**:
- [x] **T5.3.1**: Backend: Store last N errors in memory ✅
- [x] **T5.3.2**: API: `GET /system/errors` endpoint ✅
- [x] **T5.3.3**: Create `ErrorLogViewer` component ✅
- [x] **T5.3.4**: Show in Advanced tab (dev mode) ✅

> **Phase 5 Implementation Summary** (2026-01-07):
>
> **Frontend Components Created**:
> - `src/components/settings/SystemInfo.tsx` - System information panel:
>   - Python version, platform, and executable path
>   - OS details (name, release, architecture)
>   - nirs4all version with badge
>   - Capabilities grid with check/cross icons
>   - Collapsible package versions list
>   - Copy to clipboard functionality
>   - Compact mode support
>
> - `src/components/settings/BackendStatus.tsx` - Connection status component:
>   - Real-time connection status indicator (connected/disconnected/degraded)
>   - Latency measurement using performance.now()
>   - Periodic health checks (configurable interval, default 30s)
>   - Connection history visualization (bar chart)
>   - Average latency and success rate stats
>   - Manual "Test Connection" button
>   - Compact mode for minimal display
>
> - `src/components/settings/ErrorLogViewer.tsx` - Error log display:
>   - List of recent errors with expandable details
>   - Error level indicators (error, warning, critical)
>   - Traceback display for debugging
>   - Copy error details functionality
>   - Clear logs with confirmation dialog
>   - Auto-refresh support (optional)
>   - Graceful handling of 404 (endpoint not found)
>
> **Backend Updates (api/system.py)**:
> - In-memory error log storage using thread-safe `deque` (max 100 entries)
> - `log_error(endpoint, message, level, details, exc)` function for logging
> - `GET /system/errors` - Retrieve recent errors with limit parameter
> - `DELETE /system/errors` - Clear all error logs
>
> **Exception Handler Integration (main.py)**:
> - Added HTTP exception handler that logs 5xx errors
> - Added general exception handler for unhandled exceptions
> - Errors automatically captured with endpoint, message, and traceback
>
> **Types Added (src/types/settings.ts)**:
> - `PythonInfo`, `SystemDetails`, `PackageVersions`
> - `SystemInfoResponse`, `SystemCapabilities`, `SystemCapabilitiesResponse`
> - `HealthCheckResponse`, `HealthCheckWithLatency`
> - `SystemStatusResponse`, `SystemPathsResponse`
> - `ErrorLogEntry`, `ErrorLogResponse`
>
> **API Client Functions Added (src/api/client.ts)**:
> - `getSystemInfo()` - Fetch system information
> - `getSystemCapabilities()` - Fetch available capabilities
> - `getSystemStatus()` - Fetch current system status
> - `getSystemPaths()` - Fetch important paths
> - `performHealthCheck()` - Health check with latency measurement
> - `getErrorLogs(limit)` - Fetch error logs
> - `clearErrorLogs()` - Clear all error logs
>
> **Settings.tsx Integration**:
> - `BackendStatus` shown always in Advanced tab
> - `SystemInfo` shown conditionally when developer mode enabled
> - `ErrorLogViewer` shown conditionally when developer mode enabled


---

## Phase 6: Localization

**Status**: ✅ **COMPLETE** (as of 2026-01-07)
**Priority**: 🟢 Low
**Estimated Effort**: Large (2-3 weeks for full i18n)

### 6.1 i18n Infrastructure

Set up internationalization framework using react-i18next.

```typescript
// Supported locales
type SupportedLanguage = "en" | "fr" | "de";

// Translation structure (centralized in src/locales/*/index.ts)
interface Translations {
  common: { save, cancel, delete, loading, error, success, ... };
  settings: { title, tabs, general, workspace, dataDefaults, advanced, ... };
  shortcuts: { title, categories, actions, ... };
  nav: { dashboard, datasets, pipelines, playground, runs, settings };
  dashboard: { title, quickActions, recentRuns, ... };
  datasets: { title, empty, columns, ... };
  pipelines: { title, empty, editor, ... };
  runs: { title, status, ... };
  errors: { notFound, serverError, ... };
  confirm: { delete, unsavedChanges, ... };
  a11y: { openMenu, closeDialog, ... };
  time: { justNow, minutesAgo, hoursAgo, daysAgo, weeksAgo, monthsAgo };
}
```

**Tasks**:
- [x] **T6.1.1**: Install i18n library (i18next, react-i18next, i18next-browser-languagedetector) ✅
- [x] **T6.1.2**: Create translation files structure (`src/locales/{en,fr,de}/index.ts`) ✅
- [x] **T6.1.3**: Set up language context provider (`LanguageContext.tsx`) ✅
- [x] **T6.1.4**: Create i18n initialization module (`src/lib/i18n.ts`) ✅

### 6.2 Language Selector

Enable language selection in Settings.

**Tasks**:
- [x] **T6.2.1**: Create `LanguageSelector` component with flag icons ✅
- [x] **T6.2.2**: Replace placeholder in General tab ✅
- [x] **T6.2.3**: Persist language preference to backend (`general.language`) with localStorage fallback ✅
- [x] **T6.2.4**: Load correct translations on change (i18n.changeLanguage) ✅

### 6.3 Translation Files

Create translation files for supported languages.

**Files Structure**:
```
src/
├── lib/
│   └── i18n.ts              # i18next initialization and helpers
├── context/
│   └── LanguageContext.tsx  # Language provider with persistence
├── locales/
│   ├── en/
│   │   └── index.ts         # English translations (base)
│   ├── fr/
│   │   └── index.ts         # French translations
│   └── de/
│       └── index.ts         # German translations
└── components/settings/
    └── LanguageSelector.tsx # Language picker component
```

**Tasks**:
- [x] **T6.3.1**: Extract hardcoded strings from Settings page ✅
- [x] **T6.3.2**: Create English base translations ✅
- [x] **T6.3.3**: Translate to French ✅
- [x] **T6.3.4**: Translate to German ✅
- [x] **T6.3.5**: Integrate translations in Settings.tsx and KeyboardShortcuts.tsx ✅

> **Phase 6 Implementation Summary** (2026-01-07):
>
> **Dependencies Installed**:
> - `i18next` - Core internationalization framework
> - `react-i18next` - React bindings for i18next
> - `i18next-browser-languagedetector` - Auto-detect browser language
> - `i18next-http-backend` - (installed, available for future lazy loading)
>
> **Core Infrastructure (`src/lib/i18n.ts`)**:
> - i18next initialization with LanguageDetector plugin
> - `supportedLanguages` array with name, nativeName, and flag emoji
> - `SupportedLanguage` type: `"en" | "fr" | "de"`
> - Helper functions: `getCurrentLanguage()`, `changeLanguage()`, `isLanguageSupported()`
> - Detection order: localStorage → navigator → htmlTag
> - Fallback language: English
> - Suspense mode enabled for React.lazy compatibility
>
> **Language Context (`src/context/LanguageContext.tsx`)**:
> - `LanguageProvider` wraps app with language state
> - On mount: loads language from backend (`general.language`) with localStorage fallback
> - On change: updates i18n, persists to localStorage, syncs to backend
> - Hooks: `useLanguage()` for full context, `useCurrentLanguage()` for simple access
>
> **Language Selector (`src/components/settings/LanguageSelector.tsx`)**:
> - Dropdown using shadcn Select component
> - Shows flag emoji + native language name
> - Checkmark indicator for current language
> - Uses translations for labels (`settings.general.language.*`)
>
> **Translation Resources (`src/locales/{en,fr,de}/index.ts`)**:
> - Comprehensive translation trees covering:
>   - Common actions (save, cancel, delete, etc.)
>   - Navigation labels
>   - Settings page (all tabs, all sections)
>   - Keyboard shortcuts reference
>   - Dashboard, Datasets, Pipelines, Runs sections
>   - Error messages, confirmation dialogs
>   - Accessibility labels
>   - Relative time formatting
>
> **App Integration (`src/main.tsx`)**:
> - Imports i18n initialization (`import "@/lib/i18n"`)
> - Wraps app with React `Suspense` for async loading
> - `LanguageProvider` nested in provider hierarchy
>
> **Settings Page (`src/pages/Settings.tsx`)**:
> - Uses `useTranslation()` hook throughout
> - All hardcoded strings replaced with `t(...)` calls
> - LanguageSelector integrated in General/Appearance card
>
> **Keyboard Shortcuts (`src/components/settings/KeyboardShortcuts.tsx`)**:
> - Migrated to use translation keys
> - Shortcut descriptions and category names from translations
>
> **Backend Persistence (`api/workspace.py`, `api/workspace_manager.py`)**:
> - `GeneralSettings` Pydantic model extended with `language` field
> - Default value: `"en"`
> - Deep-merge in `save_workspace_settings()` ensures partial updates don't overwrite siblings
>
> **Types (`src/types/settings.ts`)**:
> - `LanguageCode = "en" | "fr" | "de"`
> - `GeneralSettings` extended with `language?: LanguageCode`
> - `DEFAULT_GENERAL_SETTINGS` includes `language: "en"`

---

## Backend API Reference

### Existing Endpoints

| Endpoint | Method | Description | Phase |
|----------|--------|-------------|-------|
| `/health` | GET | Health check | - |
| `/system/info` | GET | Python & system info | 5 |
| `/system/status` | GET | Current status | 5 |
| `/system/capabilities` | GET | Available features | 5 |
| `/system/paths` | GET | Important paths | 5 |
| `/workspace` | GET | Current workspace | 1 |
| `/workspace/select` | POST | Set workspace | 1 |
| `/workspace/create` | POST | Create workspace | 3 |
| `/workspace/list` | GET | All workspaces | 3 |
| `/workspace/recent` | GET | Recent workspaces | 3 |
| `/workspace/stats` | GET | Space usage | 1 |
| `/workspace/clean-cache` | POST | Clean cache | 1 |
| `/workspace/backup` | POST | Create backup | 1 |
| `/workspace/settings` | GET/PUT | Workspace settings | 1 |
| `/workspace/data-defaults` | GET/PUT | Data loading defaults | 1 |

### New Endpoints Needed

| Endpoint | Method | Description | Phase |
|----------|--------|-------------|-------|
| `/datasets/generate-synthetic` | POST | Generate synthetic data | 4 ✅ |
| `/system/errors` | GET | Recent error log | 5 ✅ |
| `/system/errors` | DELETE | Clear error log | 5 ✅ |

---

## Component Structure

### Current Structure

```
src/components/settings/
├── WorkspaceStats.tsx           # ✅ Space usage visualization
├── DataLoadingDefaultsForm.tsx  # ✅ Parsing defaults form
├── KeyboardShortcuts.tsx        # ✅ Shortcuts reference (Phase 2)
├── RecentWorkspacesList.tsx     # ✅ Recent workspaces display (Phase 3)
├── CreateWorkspaceDialog.tsx    # ✅ New workspace wizard (Phase 3)
├── ExportImportDialog.tsx       # ✅ Tabbed export/import (Phase 3)
├── BackupSettings.tsx           # ✅ Scheduled backup config (Phase 3)
├── SystemInfo.tsx               # ✅ System information panel (Phase 5)
├── BackendStatus.tsx            # ✅ Connection status (Phase 5)
├── ErrorLogViewer.tsx           # ✅ Error log display (Phase 5)
├── LanguageSelector.tsx         # ✅ Language picker (Phase 6)
└── index.ts                     # ✅ Barrel exports

src/components/datasets/
├── SyntheticDataDialog.tsx      # ✅ Full synthetic data dialog (Phase 4)
└── ... (other dataset components)

src/components/dashboard/
├── DeveloperQuickStart.tsx      # ✅ Dashboard synthetic card (Phase 4)
└── ... (other dashboard components)

src/context/
├── ThemeContext.tsx             # ✅ Theme with backend sync (Phase 2)
├── DeveloperModeContext.tsx     # ✅ Developer mode state (Phase 4)
├── UISettingsContext.tsx        # ✅ UI density & animations (Phase 2)
├── LanguageContext.tsx          # ✅ i18n language state (Phase 6)
└── SelectionContext.tsx         # ✅ Selection state

src/lib/
└── i18n.ts                      # ✅ i18next initialization (Phase 6)

src/locales/
├── en/index.ts                  # ✅ English translations (Phase 6)
├── fr/index.ts                  # ✅ French translations (Phase 6)
└── de/index.ts                  # ✅ German translations (Phase 6)

src/components/ui/
├── toggle-group.tsx             # ✅ Toggle group component (Phase 2)
└── ... (other UI components)
```

### Target Structure

✅ **All planned components implemented!**

The Settings page is now feature-complete with all 6 phases implemented.

---

## Technical Considerations

### Settings Schema

```typescript
// Complete workspace settings schema
interface WorkspaceSettings {
  // General
  theme: "light" | "dark" | "system";
  density: "compact" | "comfortable" | "spacious";
  animations_enabled: boolean;
  sidebar_collapsed: boolean;
  locale: "en" | "fr" | "de";

  // Data Loading
  data_loading_defaults: {
    delimiter: string;
    decimal_separator: string;
    has_header: boolean;
    header_unit: "nm" | "cm-1" | "none" | "text" | "index";
    signal_type: "auto" | "absorbance" | "reflectance" | "reflectance%" | "transmittance" | "transmittance%";
    na_policy: "drop" | "fill_mean" | "fill_median" | "fill_zero";
    auto_detect: boolean;
  };

  // Developer
  developer_mode: boolean;

  // Backup
  backup_enabled: boolean;
  backup_interval_hours: number;
  backup_max_count: number;
  backup_include_results: boolean;
  backup_include_models: boolean;

  // Cache
  cache_enabled: boolean;
}
```

### Migration Path

When adding new settings fields:

1. Add to `_default_workspace_settings()` in `workspace_manager.py`
2. Add TypeScript types to `src/types/settings.ts`
3. Handle missing fields gracefully (merge with defaults)
4. Document in API response schemas

### Developer Mode Feature Flags

```typescript
// Features enabled in developer mode
const DEVELOPER_FEATURES = {
  synthetic_data: true,        // Generate synthetic datasets
  system_diagnostics: true,    // System info panel
  error_logs: true,            // Error log viewer
  debug_panels: true,          // Debug info in editors
  force_retry: true,           // Force retry failed runs
  raw_api_access: false,       // Direct API testing (future)
};
```

---

## Dependencies

### Phase Dependencies

```
Phase 1 (Complete) ─────────────────────────────────────────┐
         ✅                                                  │
                                                             ↓
Phase 2 (General) ──→ Phase 3 (Workspace) ──→ Phase 5 (System)
         ⏳                    ⏳                     ⏳
                                    ↓
Phase 4 (Developer) ←───────────────┘
         ⏳                    ↓
Phase 6 (i18n) ←───────────────┘
         ⏳
```

### External Dependencies

| Package | Purpose | Phase |
|---------|---------|-------|
| react-i18next | Internationalization | 6 |
| date-fns | Relative time formatting | 3 |
| framer-motion | Animations (existing) | - |

---

## Success Metrics

| Metric | Target | Current |
|--------|--------|---------|
| Settings completeness | All preferences exposed | ~90% |
| Theme/preference sync | Cross-session consistency | ✅ Complete |
| Developer onboarding | < 2 min to generate test data | ✅ Complete |
| System diagnostics | Full visibility in dev mode | ✅ Complete |
| Localization coverage | 3 languages, 100% strings | 0% |

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.1 | 2026-01-07 | Copilot | Initial draft based on UI_SPECIFICATION annotations |
| 0.2 | 2026-01-07 | Copilot | Phase 2 Complete: General Settings Enhancements |
| 0.3 | 2026-01-08 | Copilot | Phase 3 Complete: Workspace Management Enhancements |
| 0.4 | 2026-01-08 | Copilot | Phase 4 Complete: Developer Mode & Synthetic Data |
| 0.5 | 2026-01-07 | Copilot | Phase 5 Complete: System Information & Diagnostics |
