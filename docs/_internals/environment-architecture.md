# Environment Architecture — Internal Reference

How nirs4all-webapp manages Python environments across web, desktop, and Docker modes.

## Overview

Three layers cooperate to provide environment management:

1. **Electron EnvManager** (`electron/env-manager.ts`) — Downloads Python, creates venvs, selects which interpreter to use. Desktop only.
2. **Backend VenvManager** (`api/venv_manager.py`) — Manages package operations (pip install/list), custom venv path persistence. Runs in all modes.
3. **Frontend** (`DependenciesManager.tsx`, `PythonEnvPicker.tsx`) — Displays environment state, coherence warnings, package management UI.

## Components

### Electron EnvManager

**File**: `electron/env-manager.ts`
**Settings**: `{userData}/env-settings.json`

Responsibilities:
- Download `python-build-standalone` on first launch
- Create a managed venv, install `CORE_PACKAGES` (fastapi, uvicorn, nirs4all)
- Store selected env in `env-settings.json`
- Pass `NIRS4ALL_EXPECTED_PYTHON` env var to the backend process
- Clear backend `venv_settings.json` on env changes (`clearBackendVenvSettings()`)
- Detect portable path drift (`validatePortableState()`)

**Python resolution order** (`getPythonPath()`):
1. `customPythonPath` (explicit Python executable path)
2. `customEnvPath` (venv/env folder → derive Python from it)
3. Managed env (`{envDir}/venv/Scripts/python.exe` or `bin/python`)

**Wizard decision** (`shouldShowWizard()`):
- Env not ready → show
- Version changed → show
- Portable mode + not opted out → show

### Backend VenvManager

**File**: `api/venv_manager.py`
**Settings**: `{platformdirs.user_data_dir("nirs4all-webapp")}/venv_settings.json`

| Platform | Settings Location |
|----------|-------------------|
| Windows  | `%LOCALAPPDATA%/nirs4all-webapp/venv_settings.json` |
| macOS    | `~/Library/Application Support/nirs4all-webapp/venv_settings.json` |
| Linux    | `~/.local/share/nirs4all-webapp/venv_settings.json` |

Responsibilities:
- Target a Python environment for package operations (`python_executable`, `pip_executable`)
- Support custom venv paths with **deferred activation** (saved but not active until restart)
- `get_installed_packages()` — pip-based scan (no importlib.metadata fallback)
- `has_pending_path_change` — tells frontend a restart is needed
- Stale path auto-cleanup on settings load (nonexistent custom paths are cleared)

**Deferred activation lifecycle**:
1. `set_custom_venv_path(path)` → validates, saves to `venv_settings.json`, returns `requires_restart: true`
2. Backend restart → `_load_settings()` picks up the saved custom path → active
3. `reset_to_runtime()` → clears custom path immediately, returns to `sys.prefix`

### Coherence Endpoint

**File**: `api/system.py` → `check_env_coherence()`
**URL**: `GET /api/system/env-coherence`

Compares VenvManager's target environment vs the running interpreter:
- `python_match`: `normcase(normpath(venv_manager.python_executable))` == `normcase(normpath(sys.executable))`
- `prefix_match`: `normcase(normpath(venv_manager.venv_path))` == `normcase(normpath(sys.prefix))`
- `coherent`: `python_match AND prefix_match`
- Optional `electron_expected_python` / `electron_match` when `NIRS4ALL_EXPECTED_PYTHON` env var is set

### Preflight Check

**File**: `api/runs.py` → `run_preflight()`
**URL**: `POST /api/runs/preflight`

Pre-run validation that checks:
1. Environment coherence (non-fatal on error)
2. Pipeline operator imports via `check_pipeline_imports()` from `nirs4all_adapter.py`

Issue types: `env_mismatch`, `not_found`, `missing_module`

### Standalone Mode Gating

**File**: `api/updates.py` → `_check_not_standalone()`

Prevents package mutation (install/uninstall/update/venv-path/venv-reset) in PyInstaller frozen builds. Checks `sys._MEIPASS`.

## Data Flow

```
Electron startup:
  EnvManager.validatePortableState()  →  clear stale paths if .exe moved
  EnvManager.ensureBackendPackages()  →  verify fastapi/uvicorn/nirs4all
  EnvManager.clearBackendVenvSettings()  →  remove stale venv_settings.json
  BackendManager.startNonBlocking()  →  spawn Python with NIRS4ALL_EXPECTED_PYTHON

Backend startup:
  VenvManager._load_settings()  →  load custom path from venv_settings.json
  check_env_coherence()  →  compare VenvManager target vs sys.executable

Frontend:
  checkEnvCoherence()  →  GET /api/system/env-coherence
  DependenciesManager  →  show banner if !coherent, disable buttons if frozen
  runPreflight()  →  POST /api/runs/preflight before training
```

## Mode Matrix

| Mode | EnvManager | VenvManager | Wizard | Package Mgmt | Coherence |
|------|-----------|-------------|--------|-------------|-----------|
| Dev (web) | N/A | Default (sys.prefix) | N/A | Yes | Yes |
| Electron installed | Active | Cleared on startup | On version change | Yes | Yes |
| Electron portable | Active | Cleared on startup | On each launch* | Yes | Yes |
| Standalone (PyInstaller) | N/A | Frozen | N/A | No (read-only) | Yes |
| Docker | N/A | Default | N/A | Yes | Yes |

*Unless "don't ask again" is checked.

## Key Design Decisions

1. **No importlib.metadata fallback**: Package detection uses only `pip list` via VenvManager. This prevents "installed but can't import" confusion caused by detecting packages in the wrong environment.

2. **Deferred venv path activation**: Custom paths take effect on restart, not immediately. This prevents the running process from targeting a different environment than it was started with.

3. **Backend venv settings cleanup on startup**: Electron always clears `venv_settings.json` before spawning the backend. This ensures the backend uses the Electron-selected environment, not a stale custom path from a previous session.

4. **Portable path drift detection**: Portable builds validate that stored absolute paths still exist. If the executable has been relocated, settings are cleared and the wizard re-runs.
