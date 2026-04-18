# Python Environment Management Review

Date: 2026-04-17

Scope:
- first-launch/install flow (`EnvSetup`)
- advanced settings Python selector (`PythonEnvPicker`)
- update/dependency/config-alignment flows
- Electron/backend handoff for interpreter selection
- reuse of external Python contexts (global Python, venv, conda)

## Executive Summary

The current implementation does not have one authoritative model of "the active Python".

There are two different truths in the product:
- Electron stores a **configured interpreter** in `env-settings.json`
- the backend package-management APIs operate on **whatever interpreter actually launched the backend** (`sys.executable` / `sys.prefix`)

That split is survivable in packaged desktop mode only if backend restart always honors the Electron-selected interpreter. It does not hold in all modes.

The most important direct cause of the user-reported symptom is:

1. In development runs, backend startup ignores the selected interpreter and always launches from `../.venv`. Selecting another Python in the wizard or in Settings can therefore look successful while the backend, dependencies, and update flows stay on the original env.

The next architectural problems are:

2. The coherence/preflight logic cannot reliably detect that mismatch.
3. The selection flow auto-installs into external/global envs instead of detecting missing packages and proposing install first.
4. Existing-env discovery is too weak for conda/global/modern local-env workflows.
5. The UI still talks about a "managed venv" even though backend-side package operations are now hard-bound to the running interpreter.

## Current Architecture

### Runtime selection plane

- `electron/env-manager.ts`
  - stores selected interpreter in `env-settings.json`
  - supports:
    - bundled runtime
    - managed runtime under `{userData}/python-env/venv`
    - custom external interpreter path
- `electron/backend-manager.ts`
  - chooses which interpreter actually launches `uvicorn main:app`
- `electron/main.ts`
  - exposes IPC for selection, setup, restart

### Backend package-management plane

- `api/venv_manager.py`
  - now always targets:
    - `python_executable = sys.executable`
    - `venv_path = sys.prefix`
- `api/updates.py`
  - updates, dependency install/uninstall, venv status, snapshots
- `api/recommended_config.py`
  - config diff/alignment also uses `venv_manager`

### User-visible consequence

`PythonEnvPicker` shows the interpreter Electron is configured to use.

`UpdatesSection`, `DependenciesManager`, and `ConfigAlignment` act on the interpreter the backend is actually running under.

Those are not guaranteed to be the same.

## Findings

### P0-1: Development mode ignores the selected interpreter completely

Evidence:
- `electron/backend-manager.ts:156-163` short-circuits to `getDevBackendPath()` whenever `VITE_DEV_SERVER_URL` is set.
- `electron/backend-manager.ts:257-279` hardcodes backend launch to `../.venv`.
- `electron/main.ts:348-352` restarts the backend after env changes, but restart still goes through the same dev-only hardcoded path.

Impact:
- In dev/Electron runs, choosing another Python in:
  - the install wizard
  - Settings > Advanced > Python Environment
  does not change the backend runtime.
- Dependency scans, updates, config alignment, and operator availability stay bound to `../.venv`.

Why this matches the reported bug:
- The user changes Python.
- Restart happens.
- Backend comes back on the same `../.venv`.
- Package state and paths therefore appear unchanged.

### P0-2: The coherence endpoint cannot catch the desktop/runtime mismatch that matters most

Evidence:
- `api/system.py:454-487` defines `coherent` only from:
  - `venv_manager.python_executable` vs `sys.executable`
  - `venv_manager.venv_path` vs `sys.prefix`
- `api/venv_manager.py:140-157` makes `venv_manager` mirror the running process by design.
- Therefore `coherent` is effectively always true once the backend has started.
- `electron/backend-manager.ts:554-563` does pass `NIRS4ALL_EXPECTED_PYTHON`, and `api/system.py:481-485` exposes `electron_match`, but:
  - `api/runs.py:1607-1614` preflight only checks `coherent`
  - no frontend settings panel consumes `electron_match`

Impact:
- The system has a mismatch detector, but the actual desktop mismatch is non-blocking and mostly invisible.
- In the dev-mode failure above, preflight can still say the environment is coherent.

### P1-1: Selecting an external interpreter mutates it immediately instead of proposing install

Evidence:
- `electron/env-manager.ts:1013-1024` and `1047-1079` auto-install core packages when the chosen env lacks them.
- `scripts/python-runtime-config.cjs:201-207` defines those core packages.

Impact:
- Picking a global Python or a conda env can trigger immediate `pip install` into that environment without a confirmation step.
- That is risky for:
  - system/global interpreters
  - shared conda envs
  - externally managed research envs
- It does not meet the desired behavior of "detect missing libs and propose install".

### P1-2: Existing-environment discovery is too weak for real-world reuse

Evidence:
- `electron/env-manager.ts:860-930` only scans:
  - `PATH`
  - a few home-directory venv/conda locations
  - Homebrew python paths on macOS

Gaps:
- no `conda env list --json`
- no `py -0p` support on Windows
- no `pyenv` support
- no Poetry/uv project env detection
- no scan of nearby workspace-local `.venv` / `venv`
- no environment classification (`conda`, `venv`, `system`, `bundled`, `managed`)

Impact:
- Reusing an existing env is much less reliable than the UI suggests.
- Many valid conda/global/local envs will only be reachable through manual browsing.

### P1-3: The "managed venv" model shown in Settings is no longer the real backend model

Evidence:
- `api/venv_manager.py:140-157` binds venv info to `sys.prefix` / `sys.executable`.
- `api/venv_manager.py:271-352` `create_venv()` is written as if it owns a separate venv, but its target path is still `sys.prefix`.
- `api/updates.py:1228-1284` exposes that as `/updates/venv/status` and `/updates/venv/create`.
- `src/components/settings/UpdatesSection.tsx:409-507` renders it as "Managed Environment".
- `src/components/settings/DependenciesManager.tsx:313-315`, `745-746` and `src/api/client.ts:2161-2187` still use "managed venv" terminology.

Impact:
- The UI implies a separate backend-managed environment that can be created/managed independently.
- In reality, package operations target the current backend interpreter.
- That wording is especially misleading when the active interpreter is:
  - a global Python
  - a conda env
  - a user-selected external venv

### P1-4: Settings mixes configured interpreter state with active runtime state

Evidence:
- `electron/main.ts:397-410` exposes `env:getInfo` and selection IPC from Electron state.
- `electron/env-manager.ts:435-450` returns configured interpreter info.
- `src/components/settings/PythonEnvPicker.tsx:123-197` uses that configured state.
- `src/components/settings/UpdatesSection.tsx:89`, `409-507` and `DependenciesManager.tsx:449-468` fetch backend package/runtime state from API.

Impact:
- Different panels can legitimately describe different interpreters.
- There is no explicit "configured vs running" distinction in the UI.
- This makes failures hard to diagnose and makes successful restart impossible to verify at a glance.

### P1-5: Advanced settings do not re-validate the selected compute profile after Python changes

Evidence:
- Wizard flow:
  - `src/components/setup/EnvSetup.tsx:353-396`
  - `src/components/setup/EnvSetup.tsx:405-432`
  switches env, restarts backend, then drives profile/config alignment.
- Advanced settings flow:
  - `src/components/settings/PythonEnvPicker.tsx:185-206`
  - `src/components/settings/PythonEnvPicker.tsx:245-256`
  switches env and restarts backend, but does not automatically reconcile:
  - active compute profile
  - missing recommended packages
  - changed torch variant / GPU profile

Impact:
- A user can switch from one env to another and land in a partially compatible state with no guided follow-up.
- The current UX does not proactively answer:
  - "What is missing in this Python?"
  - "Do you want to align it to CPU / CUDA / MPS?"

### P2-1: Internal docs and some tests still describe removed env concepts

Evidence:
- `docs/_internals/environment-architecture.md`
- `docs/_internals/support-runbook-env-mismatch.md`
- `docs/venv-configuration-audit-2026-02-25.md`
- `docs/API_UPDATES.md`
- `src/components/settings/__tests__/DependenciesManager.test.tsx`

Examples of drift:
- custom backend `venv_settings.json`
- deferred custom venv-path activation
- coherence banners and fields that no longer match live code

Impact:
- The team is reasoning from outdated architecture documents.
- This raises regression risk during fixes, especially around restart, package targeting, and troubleshooting.

## Recommended Target Model

The product should have one explicit contract:

1. **Configured interpreter**
   - stored by Electron
   - absolute path to the Python executable
   - source of truth for what desktop mode intends to run

2. **Running interpreter**
   - reported by backend (`sys.executable`, `sys.prefix`)
   - source of truth for where package operations are currently applied

3. **Environment classification**
   - `bundled`
   - `managed`
   - `venv`
   - `conda`
   - `system`

4. **Readiness state**
   - core backend packages present: `fastapi`, `uvicorn`, `nirs4all`
   - recommended profile alignment status
   - missing optional/operator packages

The UI should always show both:
- Configured Python
- Running Python

and whether they match.

## Recommended Refactor

### 1. Make backend launch respect the selected interpreter in all desktop modes

Required change:
- stop hardcoding `../.venv` in dev when a custom or managed Electron runtime exists

Recommended rule:
- if Electron has a selected/managed interpreter and it passes backend validation, use it
- only fall back to `../.venv` when no desktop interpreter has been configured

Implementation direction:
- refactor `electron/backend-manager.ts:getBackendPath()`
- keep a dev fallback, but do not let it override explicit user selection

### 2. Redefine coherence around configured-vs-running interpreter

Required change:
- `coherent` must include Electron’s expected interpreter when present

Suggested API:
- `/api/system/runtime` or expand `/api/system/env-coherence` with:
  - `configured_python`
  - `running_python`
  - `configured_matches_running`
  - `env_kind`
  - `runtime_mode`

Also change:
- `api/runs.py` preflight should treat desktop configured-vs-running mismatch as `env_mismatch`

### 3. Replace auto-install-on-selection with detect-and-confirm

Desired behavior:
1. User selects Python.
2. App inspects it.
3. App shows:
   - interpreter kind
   - version
   - core packages missing/present
   - profile alignment status
   - optional packages/operators unavailable
4. App offers explicit actions:
   - "Use as-is"
   - "Install backend core packages"
   - "Align to recommended CPU profile"
   - "Align to recommended GPU profile"

Why:
- safe reuse of global/conda envs
- better transparency
- avoids surprising mutation of third-party envs

### 4. Collapse misleading "managed venv" terminology

Recommended product language:
- `Python Runtime`
- `Current Runtime`
- `Bundled Runtime`
- `Managed Runtime`
- `External Runtime`

Avoid in UI unless literally true:
- `managed venv`
- `create managed environment`

Recommended product split:
- Electron owns creation of a new managed runtime
- backend only reports and mutates the current runtime

That means:
- `UpdatesSection` should become "Current Python Runtime"
- `/updates/venv/create` should either be removed from backend or turned into an Electron-triggered runtime-creation action

### 5. Strengthen existing-env discovery

Recommended detection backends:
- `conda env list --json`
- `py -0p` on Windows
- `pyenv versions --bare` + resolved executable paths
- workspace-local `.venv`, `venv`, `.conda`, `.pixi/envs`, etc.
- Poetry/uv known env folders
- manual browse for:
  - executable
  - env root folder

Recommended metadata returned per candidate:
- `pythonPath`
- `envRoot`
- `kind`
- `manager`
- `pythonVersion`
- `corePackagesOk`
- `profileAlignment`
- `writable`

### 6. Reconcile profile/config state after every interpreter switch

After restart on a new Python:
- fetch recommended config
- infer likely profile from installed runtime
- compare required packages
- immediately prompt user with missing/alignment actions

The advanced-settings flow should reuse the same post-switch logic as the install wizard.

### 7. Separate runtime creation from package mutation

Recommended responsibilities:
- `EnvManager`
  - create managed runtime
  - select interpreter
  - restart backend under that interpreter
- backend API
  - inspect current runtime
  - install/uninstall/align packages in current runtime

Do not pretend the backend can independently create a different env while already running inside another interpreter.

## Concrete Fix Order

### Immediate hotfixes

1. Fix `BackendManager` so user-selected Python is honored in dev mode.
2. Update coherence/preflight so configured-vs-running mismatch fails loudly.
3. Add a visible "Configured Python" vs "Running Python" section in Settings.

### Short-term product fixes

4. Change selection flow from auto-install to inspect-then-confirm.
5. Reuse wizard post-switch alignment flow in advanced settings.
6. Rename/remove "Managed Environment" backend UI where it really means "Current Runtime".

### Medium-term cleanup

7. Expand environment discovery and classify env kinds.
8. Remove or redesign backend `create_venv` semantics.
9. Clean stale docs/tests that still describe old `venv_settings.json` / deferred custom-path behavior.

## Test Gaps To Add

### Electron/backend integration

- selecting custom Python in dev mode changes actual backend `sys.executable`
- selecting custom Python in packaged mode changes actual backend `sys.executable`
- restart after env switch updates backend URL and runtime summary

### API behavior

- `env-coherence` / runtime endpoint fails when configured Python != running Python
- run preflight reports `env_mismatch` on desktop/runtime divergence

### External env reuse

- global interpreter with missing core packages -> detection + confirm path
- conda env with missing packages -> detection + confirm path
- existing venv already aligned -> zero-install fast path

### UI

- Python picker shows configured and running interpreter separately
- advanced switch flow surfaces profile-alignment actions after restart
- updates/dependencies terminology reflects current runtime rather than a fictional managed venv

## Bottom Line

The current bug is real and reproducible from the codebase.

The most likely immediate cause is the dev-mode backend launcher ignoring the selected interpreter. Even beyond that bug, the webapp still needs a larger cleanup: one authoritative Python-runtime model, explicit configured-vs-running visibility, safe reuse of external envs, and package-install proposals instead of silent mutation.
