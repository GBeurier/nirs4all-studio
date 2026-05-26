# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`nirs4all_webapp` is the desktop/web app for the nirs4all NIRS analysis library: a **React 19 + Vite + TypeScript** frontend, a **FastAPI** backend, and an **Electron** desktop shell. The backend is a thin orchestration layer over the sibling `nirs4all` Python library (`../nirs4all`).

## The single most important rule

**The backend (`api/`) NEVER reimplements nirs4all functionality.** It is HTTP routing, request validation, file-upload handling, the job queue, WebSockets, and UI-state only. Any NIRS/data/ML logic (loading, parsing, shape/signal detection, pipeline execution, prediction, SHAP, retraining, generation, bundle export, workspace storage) lives in `nirs4all` and is called from here. See `BACKEND_RULES.md`. If a needed capability is missing from nirs4all, **ask before implementing** — it almost always already exists. Webapp endpoints guard the import (`try: import nirs4all … except ImportError`) so the UI can run without nirs4all installed.

## Commands

Use `npm run start:*` — there is **no `launch.sh`** despite what parent docs may say. The npm scripts delegate to `scripts/launcher-node.cjs` → `scripts/launcher.sh` (Linux/macOS) / `launcher.cmd` (Windows).

```bash
# Run the app (frontend + backend together, managed/backgrounded with logs)
npm run start:web            # web:dev  — Vite (5173) + FastAPI (8000), hot reload
npm run start:desktop        # desktop:dev — Electron + Vite
npm run start:web:prod       # FastAPI serves the built frontend
npm run stop / restart / status / clean

# Run pieces individually (foreground)
npm run dev                  # Vite dev server only (port 5173)
npm run dev:api              # python main.py (backend only, port 8000)

# Build
npm run build                # validate:nodes → tsc -b → vite build   (note: node validation gates the build)
npm run build:electron       # Electron production renderer build

# Quality
npm run lint                 # ESLint
npm run validate:nodes       # JSON-schema-validate node definitions (also runs in build)

# Tests
npm run test                 # Vitest (frontend unit) — run once
npm run test:watch
npx vitest run src/data/nodes/NodeRegistry.test.ts        # single frontend test file
pytest                       # backend tests (config in pytest.ini; asyncio_mode=auto)
pytest tests/test_playground.py::TestPlayground::test_x   # single backend test
pytest -m "not slow"         # skip slow/integration tests
npm run e2e:web              # Playwright e2e (web mode); auto-starts both servers
npm run e2e:desktop          # Playwright e2e against FastAPI-served build (port 8000)

# Storybook
npm run storybook            # component docs, port 6006
```

The launcher runs the backend with the **sibling nirs4all venv**: `../nirs4all/.venv/bin/python main.py`. Node 22 (`.nvmrc`); a `preinstall`/`predev` hook (`ensure-linux-node.cjs`) enforces the Linux Node version.

## Architecture

**Data flow:** React → (HTTP `/api`, WS `/ws`) → FastAPI → nirs4all library → nirs4all workspace on disk.

### Backend (`api/`, entry `main.py`)
- `main.py` registers ~22 routers, each `prefix="/api"` (workspace, datasets, pipelines, predictions, aggregated_predictions, training, models, analysis, evaluation, automl, dashboard, runs, playground, shap, synthesis, transfer, updates, …). It also mounts the SPA: a catch-all route serves `dist/index.html` for non-`/api` paths.
- **`workspace_manager.py`** (module-level singleton `workspace_manager`) — manages *linked* nirs4all workspaces and the *active* one, persisted in app settings under `~/.nirs4all-webapp/`. Calls `nirs4all.workspace.set_active_workspace`. This is the source of truth for "which workspace are we operating on".
- **`store_adapter.py`** (`StoreAdapter`) and **`aggregated_predictions.py`** — thin read/format wrappers over nirs4all's `WorkspaceStore` (the workspace `store.sqlite`) and prediction arrays. NaN/Inf are sanitized to `null` for JSON.
- **`nirs4all_adapter.py`** — converts the webapp's JSON pipeline/dataset definitions into nirs4all pipeline configs and `DatasetConfigs` (handles generators `_or_`/`_range_`/`_cartesian_`, finetuning, y_processing, augmentation; exports to Python/YAML). This is the bridge that translates UI structures into library calls.
- **`api/jobs/manager.py`** (`JobManager`) — thread-pool queue for long-running tasks (training, AutoML); pushes progress to WebSocket clients via callbacks.
- **`api/shared/`** — `pipeline_service.py`, `metrics_computer.py`, `filter_operators.py` shared across routers.

### WebSockets (`websocket/manager.py`, singleton `ws_manager`)
Channel-based pub/sub. Endpoints: `/ws` (general, channel subscriptions), `/ws/job/{job_id}`, `/ws/training/{job_id}`. Use the `notify_*` helpers (`notify_job_progress`, `notify_training_epoch`, `notify_fold_progress`, `notify_branch_progress`, `notify_variant_progress`, `notify_refit_*`) — don't hand-build messages.

### Frontend (`src/`)
- **Routing** in `src/App.tsx` (pages in `src/pages/`). Provider stack in `src/main.tsx`: `QueryClient → Router → Theme → Language → UISettings → DeveloperMode → ActiveRun`.
- **Electron vs web** is detected at runtime via `window.electronApi`: Electron uses `HashRouter` (file:// can't do BrowserRouter); web uses `BrowserRouter` and relies on Vite's proxy of `/api` and `/ws` → `127.0.0.1:8000`. In Electron there is no proxy — `src/api/client.ts` resolves the backend URL from `electronApi`. All HTTP goes through the `ApiClient` in `src/api/client.ts`.
- **State:** TanStack Query for server state (5-min staleTime); React Context for app state. Note several large domain contexts: `SelectionContext`, `PlaygroundViewContext`, `ActiveRunContext`, `OutliersContext`, `FilterContext`, `ReferenceDatasetContext`.
- **UI:** shadcn/ui (Radix) + Tailwind (teal/cyan scientific theme); `@` → `./src`; i18n via i18next (`src/lib/i18n`, `src/locales/`). 3D spectra use three.js / react-three-fiber; charts use recharts.

### Node registry (pipeline editor palette) — `src/data/nodes/`
Two layers feed the drag-and-drop pipeline editor:
1. **Static definitions** in `src/data/nodes/definitions/` (typed `NodeDefinition[]`, organized by category), loaded by `NodeRegistry.ts`. Validated against `src/data/nodes/schema/node.schema.json` by `npm run validate:nodes` (**gates the build**).
2. **Extended registry** `public/node-registry/extended.json` — a large catalog generated by introspecting sklearn / nirs4all / TensorFlow operators via `scripts/generate_extended_registry.py` (`npm run generate:extended-registry`). A snapshot guard (`npm run registry:snapshot`) detects drift. Custom user-defined nodes live in `src/data/nodes/custom/`.

When adding/changing operators exposed in the editor, update the relevant definition file (or regenerate the extended registry) and run `validate:nodes`.

### Electron desktop (`electron/`)
- `main.ts` (window + IPC), `preload.ts` (context bridge exposing `electronApi`), `backend-manager.ts` (spawns the Python backend — bundled PyInstaller exe in prod, venv python in dev; passes `--port`, sets `NIRS4ALL_DESKTOP=true` and `NIRS4ALL_PORT`, health-checks `/api/health`).
- In the backend, `DESKTOP_MODE` (`NIRS4ALL_DESKTOP=true`) disables uvicorn auto-reload and skips dev-only middleware.

## Workspace layout (two distinct locations)
- **App settings** `~/.nirs4all-webapp/` — webapp-only state: linked/active workspaces, favorites, UI prefs.
- **nirs4all workspace** (user-chosen path) — analysis data owned by the library: `store.sqlite` (runs/pipelines/chains/logs), `arrays/*.parquet` (prediction arrays), `artifacts/*.joblib`, `runs/<dataset>/…/manifest.yaml`, `exports/`, `library/templates/`.

## Conventions
- Backend: type hints on public APIs, FastAPI routers per domain, guard nirs4all imports so the UI degrades gracefully when the library is absent.
- Frontend: TypeScript strict; functional components; match existing context/query patterns.
- No dead/deprecated/backward-compat code — keep the repo clean. Don't over-engineer; make only the change asked.

## Reference docs
`docs/ELECTRON.md`, `docs/PACKAGING.md` (PyInstaller backend bundling), `docs/UPDATE_SYSTEM.md`, `docs/_internals/PLAYGROUND_SPECIFICATION.md`, `docs/_internals/CONCEPTS_RUN_RESULTS_PRED.md`.
