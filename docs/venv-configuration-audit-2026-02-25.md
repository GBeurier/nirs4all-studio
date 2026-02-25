# nirs4all Studio - Venv Configuration Audit

Audit date: 2026-02-25  
Scope: environment setup/switch/update flows in Electron + webapp backend, with focus on:
- First-launch wizard (`EnvSetup`)
- Advanced settings env controls (`PythonEnvPicker`, `DependenciesManager`, `UpdatesSection`, `ConfigAlignment`)
- Runtime backend env changes (`EnvManager`, `BackendManager`, IPC handlers)
- Portable vs installable behavior and persistence

This is an audit only. No code fixes are included.

## Executive Summary

The implementation currently has two independent environment control planes:
- Runtime backend interpreter selection (Electron `EnvManager` + `BackendManager`)
- Package-management target environment (backend `venv_manager` via `/api/updates/*` and `/api/config/*`)

These planes are not strongly synchronized and persist configuration in different stores. This is the primary architectural source of instability when changing environment via wizard vs advanced settings vs updates/config alignment flows.

The highest-risk issues found are:
- Non-atomic env switch persistence (path is saved before installation success)
- Auto-setup not clearing previous custom env selection
- Runtime env and managed-package env divergence
- Backend restart race/short-circuit after setup when process exists but is not `running`
- Stale backend URL cache after restarts in some settings flows

## Architecture Map

### Runtime interpreter plane
- `electron/env-manager.ts` selects Python executable and manages setup/switch:
  - readiness + path resolution: `isReady()` and `getPythonPath()` at `electron/env-manager.ts:144-187`
  - env switching: `useExistingEnv()` / `useExistingPython()` at `electron/env-manager.ts:438-510`
  - full setup: `setup()` at `electron/env-manager.ts:536-676`
- `electron/backend-manager.ts` launches backend using `envManager.getPythonPath()`:
  - interpreter choice: `electron/backend-manager.ts:94-113`
- IPC setup entrypoint:
  - `env:startSetup` restarts/starts backend after setup: `electron/main.ts:379-399`

### Package-management plane
- `api/venv_manager.py` controls where package installs/scans happen:
  - default path is current process `sys.prefix`: `api/venv_manager.py:98`
  - default python executable is `sys.executable` when no custom path: `api/venv_manager.py:210-212`
  - custom path switching: `set_custom_venv_path`: `api/venv_manager.py:157-200`
- Used by:
  - updates/dependencies endpoints: `api/updates.py:1437-1752`
  - config alignment endpoint: `api/recommended_config.py:516-607`

## State & Persistence Map

There are multiple persistence stores with overlapping responsibilities:

- Electron env settings (`customEnvPath`, `customPythonPath`, wizard flags):
  - `env-settings.json` in `app.getPath("userData")`: `electron/env-manager.ts:67`, `electron/env-manager.ts:96-97`, `electron/env-manager.ts:106-131`
- Backend venv settings (`custom_venv_path`):
  - `venv_settings.json` under backend app-data dir: `api/venv_manager.py:91`, `api/venv_manager.py:95-99`, `api/venv_manager.py:108-130`
- Backend first-launch profile state (`setup_status.json`):
  - `api/recommended_config.py:142`, `api/recommended_config.py:173-195`
- Additional global config path system:
  - `api/app_config.py:125-157`

The wizard completion gate and setup-status gate are independent:
- Electron gate for showing `EnvSetup`: `electron/env-manager.ts:254-267`, consumed in `src/App.tsx:273-290`
- Backend setup-status gate that can redirect to legacy `/setup`: `src/hooks/useStartupUpdateCheck.ts:34-36`, route exists at `src/App.tsx:322`

## Findings

## P0-1: Env switch is persisted before package installation succeeds (non-atomic switch)

Evidence:
- `useExistingEnv()` saves custom env path before dependency install:
  - set+save: `electron/env-manager.ts:457-459`
  - install may fail and returns error: `electron/env-manager.ts:462-468`
- `useExistingPython()` has same pattern:
  - set+save: `electron/env-manager.ts:494-496`
  - install may fail and returns error: `electron/env-manager.ts:499-505`

Impact:
- Failed switch can still persist a broken interpreter/env as active.
- Next launches may keep selecting the broken env, causing repeated startup/setup failures.

Repro path:
- Select interpreter missing required packages while offline or with pip failure.
- Switch returns failure, then relaunch app.

## P0-2: Auto-setup does not clear previous custom env selection

Evidence:
- Path resolution prioritizes custom paths:
  - `electron/env-manager.ts:159-177`
- In `setup()`, custom path is saved only when `targetDir` is provided:
  - `electron/env-manager.ts:662-667`
- No clearing of `customPythonPath/customEnvPath` when running default auto-setup.

Impact:
- User runs "auto setup" but backend may still use old custom env due path precedence.
- Perceived setup success does not actually switch active interpreter.

Repro path:
- Select a custom env first.
- Later run auto setup without target dir.
- Backend continues from old custom env.

## P0-3: Runtime env and package-management env can diverge

Evidence:
- Runtime backend interpreter comes from Electron `EnvManager`:
  - `electron/backend-manager.ts:94-113`
- Package management target can be switched separately via backend API:
  - `/updates/venv/path`: `api/updates.py:1713-1752`
  - setter in manager: `api/venv_manager.py:157-200`
- Advanced settings exposes this separate switch:
  - `src/components/settings/DependenciesManager.tsx:346-352`, `src/components/settings/DependenciesManager.tsx:372-376`
- Config alignment uses `venv_manager.install_package()` (same package-management plane):
  - `api/recommended_config.py:576`

Impact:
- Installing/updating/alignment can run in env B while backend executes env A.
- UI can report packages installed/aligned but runtime process still missing them.

Repro path:
- Set custom venv path in Dependencies Manager.
- Keep runtime Python set through PythonEnvPicker/EnvSetup to a different env.
- Run Config Alignment or install packages; observe backend behavior unchanged.

## P0-4: Setup restart race when process exists but status is not `running`

Evidence:
- `env:startSetup` chooses `restart()` only if `isRunning()`:
  - `electron/main.ts:393-395`
- `isRunning()` requires `process !== null && status === "running"`:
  - `electron/backend-manager.ts:530-531`
- `start()` early-returns if a process exists regardless status:
  - `electron/backend-manager.ts:250-253`
- `startNonBlocking()` can leave status `starting` while process exists:
  - `electron/backend-manager.ts:290-299`, `electron/backend-manager.ts:328`

Impact:
- Setup can return success without actually restarting backend into new interpreter.
- Old backend process can remain active after env setup.

Repro path:
- Trigger env setup soon after launch while backend still `starting` (or in error state with process present).
- Setup path takes `start()` branch and short-circuits.

## P0-5: URL cache invalidation is inconsistent after backend restart

Evidence:
- API client caches backend URL and requires explicit reset:
  - cache: `src/api/client.ts:12-15`
  - reset: `src/api/client.ts:101-104`
- `PythonEnvPicker` full setup path does not reset URL:
  - starts setup: `src/components/settings/PythonEnvPicker.tsx:216`
  - on success only sets `needsRestart`: `src/components/settings/PythonEnvPicker.tsx:218-219`
- But `env:startSetup` now already restarts/starts backend:
  - `electron/main.ts:389-396`
- `UpdatesSection` restart button also omits `resetBackendUrl()`:
  - restart path: `src/components/settings/UpdatesSection.tsx:252-258`

Impact:
- Frontend can keep calling stale port after restart.
- Produces intermittent "backend unreachable" symptoms in settings flows.

Repro path:
- Run setup from PythonEnvPicker or restart from UpdatesSection.
- Perform API operations without full page/app reload.

## P1-1: No in-app recovery when backend fails but env is considered ready

Evidence:
- Startup catches backend spawn failures but still opens window:
  - `electron/main.ts:432-439`
- App hard-gates on `!coreReady` with connecting screen:
  - `src/App.tsx:294-296`
- Readiness polling ignores backend errors and keeps polling:
  - `src/context/MlReadinessContext.tsx:156-158`
- For direct custom python selection, readiness trusts executable existence:
  - `electron/env-manager.ts:148-149`

Impact:
- Users can be trapped on infinite connecting screen with no path to env reconfiguration.

## P1-2: "Create in folder" can remove existing `python/` and `venv/` directories without confirmation

Evidence:
- Setup removes `<target>/python` and `<target>/venv` recursively:
  - `electron/env-manager.ts:569-571`
  - `electron/env-manager.ts:591-593`
- UI entry points:
  - wizard: `src/components/setup/EnvSetup.tsx:592-595`
  - settings: `src/components/settings/PythonEnvPicker.tsx:485-493`

Impact:
- Existing folder content in these subdirectories can be destroyed unintentionally.

## P1-3: Dependency scan fallbacks can mask wrong-target environment

Evidence:
- Dependencies endpoint merges fallback packages from current process env:
  - `api/updates.py:1471-1478`
- Also falls back to direct `import nirs4all` in current process env:
  - `api/updates.py:1538-1543`

Impact:
- UI may show package as installed from process env even if selected venv path lacks it.
- Hides environment divergence problems.

## P1-4: Long-running pip install operations can hang indefinitely

Evidence:
- `venv_manager.install_package()` uses `subprocess.Popen` stream loop with no timeout:
  - `api/venv_manager.py:463-487`

Impact:
- API requests may stall indefinitely on blocked pip operations.
- User-facing setup/update appears frozen.

## P1-5: Dual wizard systems can drift and produce conflicting setup UX

Evidence:
- Primary env wizard gate is Electron-based (`shouldShowWizard`):
  - `src/App.tsx:273-290`, `electron/env-manager.ts:254-267`
- Legacy setup route still exists:
  - route: `src/App.tsx:322`
  - auto redirect trigger: `src/hooks/useStartupUpdateCheck.ts:34-36`

Impact:
- Users can complete one setup path and still be redirected into another setup flow.
- Increases confusion during reinstall/update scenarios.

## P1-6: Portable/installable behavior uses multiple storage roots with weak coupling

Evidence:
- Portable logic in env manager:
  - `electron/env-manager.ts:242-243`, `electron/env-manager.ts:265`
- Backend manager/settings use `platformdirs` app data (`nirs4all-webapp`):
  - `api/venv_manager.py:32`, `api/venv_manager.py:95-99`
- Global app config uses yet another resolution chain including portable-adjacent folder:
  - `api/app_config.py:125-157`
- Installer uninstall script cleans multiple distinct directories:
  - `build/installer.nsh:36-46`

Impact:
- Environment/setup state portability across installable/portable modes is hard to reason about.
- State may appear "lost" or inconsistent across distribution types.

## P2-1: Test coverage gaps around env state machine and cross-plane synchronization

Evidence:
- No tests found targeting env switch/setup IPC state machine or venv-plane synchronization paths.
- Existing references only include a setup-status call in e2e fixture:
  - `e2e/fixtures/global-setup.ts:60`

Impact:
- Regressions in high-risk setup flows are likely to recur undetected.

## Observed Recent Changes and Their Remaining Gaps

Recent touched files (as provided) addressed important issues (restart-on-setup, retry/backoff, pip invocation improvements). Remaining problems are mostly architectural/state-consistency issues:
- Atomicity and rollback of env switch persistence
- Cross-plane synchronization contract (runtime env vs package-management env)
- Restart lifecycle race conditions
- URL cache invalidation consistency after restart
- UX recovery path when backend never reaches `core_ready`

## Recommended Remediation Plan (Design-Level, No Code Here)

1. Define a single source of truth for "active runtime env" and make package-management env derive from it by default.
2. Make env switch/setup transactional: validate/install first, persist path only after success, rollback on failure.
3. Unify restart semantics:
   - `env:startSetup` should use explicit restart contract robust to `starting/error` states.
   - All renderer restart entrypoints must call `resetBackendUrl()` and emit one common `backend-restarted` event.
4. Add explicit recovery UX for backend-start failure from connecting screen (open env/setup actions).
5. Separate "managed env" vs "current process env" terminology and behavior in backend APIs and settings UI.
6. Add focused tests:
   - env switching rollback
   - start/setup while backend is `starting`
   - runtime/package-plane divergence detection
   - portable/installable persistence continuity

## Audit Scope Notes

This audit reviewed implementation paths and state coupling. It did not execute end-to-end manual runtime scenarios or modify code.

