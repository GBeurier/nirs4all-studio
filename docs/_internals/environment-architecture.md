# Environment Architecture

Internal reference for how `nirs4all-webapp` manages Python runtimes after the
single-runtime refactor.

## Core Model

The desktop app has exactly one active Python runtime at a time.

That runtime is the single source of truth for:

- backend startup
- package scans
- `nirs4all` importability
- dependency installation
- config alignment
- pipeline execution

Electron persists one setting, `pythonPath`, which is always the Python
executable the next backend restart should use.

## Main Components

### Electron EnvManager

**File:** `electron/env-manager.ts`

**Settings file:** `{userData}/env-settings.json`

Responsibilities:

- persist `pythonPath`
- discover managed, local venv, conda, bundled, and global runtimes
- inspect a candidate runtime before switching
- create a managed runtime for convenience
- install missing backend-core packages only after explicit confirmation
- expose configured runtime metadata to the backend launcher

Important distinctions:

- `getConfiguredPythonPath()` returns the interpreter Electron is configured to
  launch next
- the currently running backend may still differ until restart
- there is no second backend-side custom-path control plane anymore

### Electron BackendManager

**File:** `electron/backend-manager.ts`

Responsibilities:

- launch the backend under the configured interpreter in both dev and packaged
  desktop modes
- pass runtime metadata to the backend:
  - `NIRS4ALL_EXPECTED_PYTHON`
  - `NIRS4ALL_ENV_SETTINGS_PATH`
  - `NIRS4ALL_RUNTIME_MODE`
  - `NIRS4ALL_RUNTIME_KIND`
  - `NIRS4ALL_IS_BUNDLED_DEFAULT`
  - `NIRS4ALL_BUNDLED_RUNTIME_AVAILABLE`

Launch contract:

- if a configured desktop runtime exists, use it
- in dev, `../.venv` is only a fallback when no desktop runtime is configured
- in bundled builds, the embedded runtime is the default only until the user
  switches away from it

### Backend Runtime Manager

**File:** `api/venv_manager.py`

Responsibilities:

- operate on the Python interpreter that is currently running the backend
- provide package scans, `pip` installs, uninstalls, and snapshot restore
  against `sys.executable` / `sys.prefix`

Non-responsibilities:

- no persisted custom venv path
- no deferred activation
- no `venv_settings.json` control plane

### Runtime Summary Endpoint

**File:** `api/system.py`

**URL:** `GET /api/system/env-coherence`

This is the runtime contract used by the frontend. It reports:

- `configured_python`
- `running_python`
- `running_prefix`
- `runtime_kind`
- `is_bundled_default`
- `bundled_runtime_available`
- `configured_matches_running`
- `core_ready`
- `missing_core_packages`
- `missing_optional_packages`

`coherent` now means:

- the backend is running under the same interpreter Electron is configured to
  use

It does not mean "some backend helper object agrees with itself."

## Runtime States

### Managed runtime

An app-created runtime under `{userData}/python-env/venv`.

- writable
- used like any other configured Python
- created by Electron, then made the active runtime

### Custom runtime

A user-selected interpreter from:

- local venv
- conda env
- global/system Python
- another user-managed environment

### Bundled embedded runtime

The Python embedded in an all-in-one bundle.

- default on first launch of bundled builds
- read-only
- safe to inspect and run
- must not be mutated in place

### Bundled build switched to external runtime

Still the same app build, but no longer using the embedded interpreter.

- allowed
- backend runs on the selected external interpreter after restart
- dependency and update actions target that external runtime
- frontend should warn that the app is no longer using the embedded runtime

## Package Semantics

There is one runtime, but two readiness levels inside it:

### Core readiness

Packages required to boot the backend, including:

- `fastapi`
- `uvicorn`
- `nirs4all`

If these are missing, the runtime cannot run the app correctly.

### Optional feature readiness

Packages needed only for specific operators or pages, such as:

- `shap`
- `xgboost`
- other optional packages from `recommended-config.json`

If these are missing:

- the runtime may still be valid for supported workflows
- unsupported operators should fail preflight or show as unavailable
- the app should not pretend a second environment exists

## Switch Flow

The same runtime switch contract should be used everywhere:

1. inspect the candidate interpreter
2. classify it
3. report missing core and optional packages
4. optionally install missing core packages after explicit confirmation
5. persist `pythonPath`
6. restart the backend under that exact interpreter
7. fetch the runtime summary and post-switch validation data

This applies in:

- first-launch wizard
- settings runtime picker
- bundled-to-external switching
- managed runtime creation

## Data Flow

### Desktop startup

1. `EnvManager.validateConfiguredState()`
2. `EnvManager.ensureBackendPackages()`
3. `BackendManager` launches the backend under the configured interpreter
4. backend reports configured-vs-running state through `/api/system/env-coherence`

### Runtime switch

1. user selects a runtime in the wizard or settings
2. Electron inspects it without mutating it
3. user chooses:
   - use as-is
   - install missing core packages and switch
4. Electron persists `pythonPath`
5. backend restarts
6. frontend refreshes runtime summary, GPU/profile hints, and dependency state

## Mode Matrix

| Mode | Default runtime | Mutable runtime? | Can switch to another runtime? |
|---|---|---|---|
| Web dev | current Python process | yes | n/a |
| Electron installer | managed or configured external runtime | yes | yes |
| Electron portable | managed or configured external runtime | yes | yes |
| All-in-one bundled build | embedded bundled runtime | only after switching away | yes |
| Legacy PyInstaller backend | packaged backend runtime | no | no |
| Docker | container Python runtime | yes | container-managed |

## Key Decisions

1. Only one active runtime exists at a time.
2. Switching Python must change the real backend interpreter after restart.
3. Selecting an existing interpreter never mutates it silently.
4. Optional-package gaps do not create a second environment; they only reduce
   available features inside the current runtime.
5. Bundled builds may switch to external runtimes, but the embedded runtime
   itself stays read-only.
