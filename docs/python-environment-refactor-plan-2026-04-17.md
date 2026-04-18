# Python Environment Refactor Plan

Date: 2026-04-17

Scope:
- desktop install wizard
- desktop settings Python selection
- backend runtime startup
- package management and dependency scans
- bundled build behavior when switching away from the embedded runtime

Related:
- `docs/python-environment-review-2026-04-17.md`

## Problematic detailed

### 1. The product currently exposes more than one truth about Python

Today the application mixes two separate concepts:
- the Python interpreter selected by Electron
- the Python interpreter actually running the backend

For the user, these should be the same thing. If the user changes Python, the whole application should change Python after restart.

In the current codebase, that is not guaranteed.

Consequences:
- the Python shown in Settings can differ from the Python used by the backend
- dependency status can be computed in one env while the app runs in another
- installs or updates can appear successful but not affect the actual running backend

### 2. Development mode breaks the expected switch behavior

In development, backend startup is still hardcoded to `../.venv` through `electron/backend-manager.ts`.

That means:
- user changes Python in wizard or settings
- app restarts backend
- backend still launches in `../.venv`

This is the main reason the current experience can look like "nothing changed".

### 3. Package management is tied to the running backend, but the UI still presents a separate "managed env" idea

Backend-side package operations now use the running interpreter:
- `sys.executable`
- `sys.prefix`

But the UI still presents:
- "Managed Environment"
- "managed venv"
- backend-owned venv creation and mutation semantics

This is misleading because the real current behavior is:
- package management targets the backend runtime currently in use
- there is not a second independent active env for package operations

### 4. Selecting an external Python can mutate it immediately

When the user chooses an existing Python that does not contain required backend packages, the app may directly install packages into it.

This is problematic for:
- a global system Python
- a shared conda env
- an externally managed lab env

The desired user experience is simpler and safer:
- inspect the selected env
- explain what is missing
- propose install
- let the user decide

### 5. Bundled mode is modeled too rigidly

The bundled build currently treats the embedded runtime as read-only and largely blocks environment mutation flows.

That is only half-correct.

The right model is:
- when the app starts from a bundled build, the embedded runtime is the default initial runtime
- the user may choose to switch to another Python env
- if the user switches, the app should restart under that env like any other desktop user
- the app should warn clearly that it is leaving the embedded runtime, but should not forbid it

What must remain read-only is only the embedded runtime itself, not the user's freedom to switch to another runtime.

### 6. The current readiness model is not user-centered

There are really two different dependency levels:

1. Backend core readiness
   - `fastapi`
   - `uvicorn`
   - `nirs4all`
   - anything else needed to boot the API

2. Feature/operator readiness
   - `torch`
   - `shap`
   - `xgboost`
   - optional packages required by specific models or pages

These should not create two environments. They should be two status levels inside one active environment.

### 7. Existing environment discovery is too weak for the target workflow

The desired workflow is:
- user may reuse a local venv
- or a conda env
- or a global Python
- or a managed env created by the app

Current discovery is not strong enough for that target because it does not robustly inspect:
- conda env inventories
- Windows launcher-discovered Pythons
- nearby project envs
- environment classification and writability

## Solution proposed

### Core principle

The application should have exactly one active Python runtime at a time.

That runtime is the single source of truth for:
- backend startup
- package scans
- `nirs4all` importability
- dependency installation
- config alignment
- pipeline execution

### Functional model

#### 1. One persisted setting

Electron persists one value:
- `pythonPath`

This is always the absolute path to the Python executable actually intended to launch the backend.

No second active backend env setting should exist.

#### 2. One runtime contract

At runtime, the backend reports:
- running Python executable
- running prefix
- runtime kind
- whether it matches the configured Python from Electron

The frontend should always show:
- Configured Python
- Running Python
- Match / mismatch state

#### 3. One env switch action

When the user selects a new Python:
1. inspect the candidate env
2. classify it
3. report missing core packages and missing optional packages
4. ask user what to do
5. if accepted, persist `pythonPath`
6. restart backend under that exact interpreter
7. refresh runtime summary and dependency state

This same action model also applies during install / first launch:
- user may keep the default runtime proposed by the app
- or choose an alternative existing env immediately during install
- the chosen env becomes the one active runtime for the application
- after selection, the app must inspect it, report missing core and optional packages, and propose the next action before setup completes

#### 4. Dependency handling inside the single env

The app should distinguish two package categories inside the same env:

- Core backend packages
  - required for the app to start and serve the API
- Optional feature packages
  - required for specific features, operators, and compute profiles

This leads to clearer UX:
- "This Python can run the app"
- "These features are currently unavailable in this Python"

#### 5. Managed env remains only as a convenience

The app may still offer:
- "Create managed Python environment"

But this must mean only:
- create a new env for convenience
- then make it the single active runtime

It must not create a second conceptual control plane.

#### 6. Bundled build behavior

Bundled mode should behave as follows:

- default runtime on first launch: embedded bundled Python
- package mutation while still using embedded bundled Python: disallowed or warned as read-only
- switching to an external env: allowed
- after switching to an external env:
  - backend starts from external env
  - package management targets external env
  - warning banner explains that the app is no longer using the embedded runtime

Recommended warning copy direction:
- "You are switching from the bundled Python runtime to an external Python environment. This external environment is now user-managed."

#### 7. Coherence definition

Coherence must be redefined as:
- running backend interpreter matches the configured interpreter

Not merely:
- backend helper state matches `sys.executable`

This coherence status must be used by:
- Settings
- preflight checks before runs
- dependency and install flows

## Detailed roadmap

### Phase 1. Define the runtime contract

Goal:
- establish one authoritative runtime model across Electron, backend, and frontend

Tasks:
- introduce a runtime summary contract with:
  - `configured_python`
  - `running_python`
  - `running_prefix`
  - `runtime_kind`
  - `is_bundled_default`
  - `configured_matches_running`
  - `core_ready`
  - `missing_core_packages`
  - `missing_optional_packages`
- expose that from the backend system API
- update frontend consumers to use this contract instead of inferring env state from multiple places

Likely files:
- `electron/main.ts`
- `electron/backend-manager.ts`
- `api/system.py`
- `src/api/client.ts`

Success criteria:
- frontend can display configured and running Python separately
- backend mismatch is visible immediately

### Phase 2. Fix backend launch so switching really switches Python

Goal:
- guarantee that backend restart uses the selected Python in all desktop modes

Tasks:
- refactor `electron/backend-manager.ts:getBackendPath()`
- remove the dev-mode override that forces `../.venv` when a configured runtime exists
- keep `../.venv` only as a fallback when no desktop runtime has been configured
- verify restart flow after:
  - wizard env selection
  - settings env selection
  - managed env creation

Likely files:
- `electron/backend-manager.ts`
- `electron/main.ts`
- `electron/backend-manager.test.ts`

Success criteria:
- after switch and restart, backend `sys.executable` equals selected `pythonPath`
- dev and packaged desktop modes behave the same way

### Phase 3. Replace auto-install-on-selection with inspect-and-confirm

Goal:
- make env reuse safe and predictable

Tasks:
- split env selection into:
  - inspect candidate env
  - confirm action
  - optional install/alignment
- inspection result should include:
  - Python version
  - env kind: `system`, `venv`, `conda`, `managed`, `bundled`
  - writable / likely writable
  - core package availability
  - optional package gaps
  - profile alignment guess
- remove silent mutation when simply selecting an env
- apply the same inspect-and-confirm flow in the install wizard when the user chooses:
  - an existing global Python
  - an existing local venv
  - an existing conda env
  - an external env while starting from a bundled build

Likely files:
- `electron/env-manager.ts`
- `electron/preload.ts`
- `src/components/settings/PythonEnvPicker.tsx`
- `src/components/setup/EnvSetup.tsx`

Success criteria:
- selecting a Python never mutates it without an explicit user action
- user can choose:
  - use as-is
  - install core backend packages
  - align to recommended profile

### Phase 4. Unify package-management semantics around the current runtime

Goal:
- eliminate the fake split between "runtime env" and "managed env"

Tasks:
- redefine backend update/dependency APIs as operating on the current runtime
- rename UI copy:
  - "Managed Environment" -> "Current Python Runtime" or similar
- review whether backend `create_venv` endpoints should remain backend-owned
- if kept, they must create an env and then switch runtime to it explicitly

Likely files:
- `api/venv_manager.py`
- `api/updates.py`
- `src/components/settings/UpdatesSection.tsx`
- `src/components/settings/DependenciesManager.tsx`
- `src/api/client.ts`

Success criteria:
- all dependency pages clearly refer to the currently running Python
- no UI implies a second active env

### Phase 5. Support bundled-to-external switching cleanly

Goal:
- make bundled behavior flexible instead of blocked

Tasks:
- distinguish two states:
  - using embedded bundled runtime
  - using external runtime from a bundled app build
- remove blanket prohibition on env switching from bundled builds
- keep protection against mutating the embedded runtime itself
- add warning banner when leaving bundled runtime
- add indicator showing whether user is on:
  - bundled embedded runtime
  - external user-selected runtime

Likely files:
- `electron/env-manager.ts`
- `electron/backend-manager.ts`
- `api/system.py`
- `src/components/settings/PythonEnvPicker.tsx`
- `src/components/settings/UpdatesSection.tsx`

Success criteria:
- bundled app launches on embedded Python by default
- user can switch to external Python
- external Python then behaves like the active mutable runtime

### Phase 6. Reuse the same post-switch validation flow everywhere

Goal:
- wizard and settings should behave consistently after a runtime change

Tasks:
- extract a shared post-switch flow:
  - restart backend
  - fetch runtime summary
  - detect compute profile
  - compare required packages
  - propose alignment/install actions
- use this same flow in:
  - first-launch wizard
  - advanced settings Python switch
  - bundled-to-external switch path
  - install-time selection of an alternative existing env

Likely files:
- `src/components/setup/EnvSetup.tsx`
- `src/components/settings/PythonEnvPicker.tsx`
- shared utility or hook under `src/lib` or `src/hooks`

Success criteria:
- no matter where user changes Python, the next step is identical and predictable

### Phase 7. Improve environment discovery

Goal:
- make reuse of existing envs practical

Tasks:
- add discovery strategies:
  - `conda env list --json`
  - `py -0p` on Windows
  - nearby project envs
  - optional `pyenv` detection
- enrich detected env metadata:
  - executable path
  - env root
  - env kind
  - version
  - core readiness
  - likely write access

Likely files:
- `electron/env-manager.ts`
- `src/components/settings/PythonEnvPicker.tsx`
- tests around discovery

Success criteria:
- conda, venv, and global interpreters are found and described clearly

### Phase 8. Clean stale docs and tests

Goal:
- make the codebase documentation match the new single-runtime design

Tasks:
- update or remove docs that describe:
  - backend custom venv path control plane
  - deferred backend venv-path activation
  - obsolete bundled restrictions
- update tests that still encode the old env model

Likely files:
- `docs/_internals/environment-architecture.md`
- `docs/API_UPDATES.md`
- `docs/UPDATE_SYSTEM.md`
- `src/components/settings/__tests__/DependenciesManager.test.tsx`
- backend integration tests

Success criteria:
- docs explain one active runtime model
- tests enforce the new behavior instead of the old split model

### Phase 9. Add end-to-end coverage for the target workflows

Goal:
- prevent regressions in the most sensitive user flows

Must-cover scenarios:
- switch from managed env to existing local venv
- switch from managed env to conda env
- switch from bundled embedded runtime to external env
- switch back to app-created managed env
- choose env with missing core packages and accept install
- choose env with missing core packages and refuse install
- choose env with missing optional packages and run only supported features
- verify pipeline preflight catches configured-vs-running mismatch

Likely files:
- `electron/*.test.ts`
- `tests/integration/*`
- `e2e/tests/settings.spec.ts`

Success criteria:
- switching Python always changes the real backend runtime
- package scans and execution follow the same env after restart

## Recommended implementation order

1. Phase 1 and Phase 2
   - without this, Python switching is still fundamentally unreliable
2. Phase 3 and Phase 6
   - improves user safety and consistency
3. Phase 4 and Phase 5
   - removes conceptual confusion and fixes bundled-mode behavior
4. Phase 7
   - broadens env reuse support
5. Phase 8 and Phase 9
   - locks the new architecture in place

## Expected end-state

When the refactor is complete, the user experience should be:

1. The app shows the current active Python runtime clearly.
2. During install or later in Settings, the user can select any valid Python env: local, global, conda, or app-created.
3. The app inspects it and explains what is missing.
4. The app only installs packages after explicit confirmation.
5. On restart, the whole app uses that one env.
6. Dependency pages, updates, config alignment, and pipeline execution all reflect the same runtime.
7. Bundled users start on the embedded runtime by default, but may switch to an external runtime with a warning instead of a prohibition.
