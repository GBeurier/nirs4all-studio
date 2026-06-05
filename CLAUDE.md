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
../nirs4all/.venv/bin/python -m pytest -m "not slow"      # backend tests — ALWAYS via the sibling venv
../nirs4all/.venv/bin/python -m pytest tests/test_playground.py::TestPlayground::test_x   # single backend test
npm run e2e:web              # Playwright e2e (web mode); auto-starts both servers
npm run e2e:desktop          # Playwright e2e against FastAPI-served build (port 8000)

# Storybook
npm run storybook            # component docs, port 6006
```

The launcher runs the backend with the **sibling nirs4all venv**: `../nirs4all/.venv/bin/python main.py`. Node 22 (`.nvmrc`); a `preinstall`/`predev` hook (`ensure-linux-node.cjs`) enforces the Linux Node version.

### Test-environment gotchas (hard-won)
- **The whole gate is green and CI-blocking**: `validate:nodes`, `tsc -b` (0 errors), vitest, `npm run build`, backend pytest, and an import-smoke test all block CI; only ESLint remains non-blocking. Keep them green.
- If tsc/vitest/build show inexplicable errors (phantom type errors, unresolvable imports like framer-motion), the local `node_modules` is stale — run **`npm ci`** before debugging anything.
- Backend tests need the **sibling venv** (`../nirs4all/.venv/bin/python -m pytest`), which must contain the declared deps (`orjson`, `aiofiles`, `platformdirs` have gone missing locally before and produce dozens of bogus failures).
- Vitest excludes `e2e/**` (Playwright-only) and `**/*benchmark.test.*` (wall-clock timing, flaky on shared runners) via `vite.config.ts` — don't re-include them in the default run.
- Known issue: running the backend suite mutates the real `~/.nirs4all-webapp/` app config (it can switch the active workspace to a pytest temp dir).
- App logs land in `/tmp/nirs4all/{backend,frontend,desktop}.log`. A Playwright MCP server is configured in `.mcp.json` (headless chromium) for driving the app interactively to verify UI changes.

## Architecture

**Data flow:** React → (HTTP `/api`, WS `/ws`) → FastAPI → nirs4all library → nirs4all workspace on disk.

### Backend (`api/`, entry `main.py`)
- `main.py` registers ~20 routers, each `prefix="/api"` (workspace, datasets, pipelines, predictions, aggregated_predictions, training, models, analysis, dashboard, runs, playground, shap, synthesis, transfer, updates, …). It also mounts the SPA: a catch-all route serves `dist/index.html` for non-`/api` paths. The old `evaluation`, `preprocessing`, and `automl` routers were **deliberately deleted** as dead code — do not restore them.
- **`workspace_manager.py`** (module-level singleton `workspace_manager`) — manages *linked* nirs4all workspaces and the *active* one, persisted in app settings under `~/.nirs4all-webapp/`. Calls `nirs4all.workspace.set_active_workspace`. This is the source of truth for "which workspace are we operating on". It also caches one long-lived `StoreAdapter` (`get_active_store_adapter()`) shared across requests — don't open per-request stores. `WorkspaceScanner` lives in `workspace_scanner.py` (re-exported here); pure route helpers in `workspace_helpers.py`.
- **`store_adapter.py`** (`StoreAdapter`) and **`aggregated_predictions.py`** — thin read/format wrappers over nirs4all's `WorkspaceStore` (the workspace `store.sqlite`) and prediction arrays. NaN/Inf are sanitized to `null` for JSON. List endpoints return empty results (200) for a fresh store-less workspace; 404 is reserved for detail lookups.
- **`nirs4all_adapter.py`** — converts the webapp's JSON pipeline/dataset definitions into nirs4all pipeline configs and `DatasetConfigs` (handles generators `_or_`/`_range_`/`_cartesian_`, finetuning, y_processing, augmentation; exports to Python/YAML). This is the bridge that translates UI structures into library calls.
- **`api/jobs/manager.py`** (`JobManager`) — thread-pool queue for long-running tasks (training, AutoML); pushes progress to WebSocket clients via callbacks. Worker count via `NIRS4ALL_JOB_WORKERS` (default 4).
- **`api/shared/`** — cross-router helpers: `pipeline_service.py`, `metrics_computer.py`, `filter_operators.py`, `json_sanitize.py` (the one true NaN/Inf sanitizer), `paths.py` (path-containment guards), `dependencies.py` (`require_workspace` FastAPI dep — use it instead of inline workspace checks), `na_policy.py`.
- **na_policy rule**: nirs4all only accepts `{auto, abort, remove_sample, remove_feature, replace, ignore}`. Legacy stored values (`drop`/`Drop`/`keep`) must be translated via `api/shared/na_policy.py` — `normalize_na_policy_in_config()` is already called at every `DatasetConfigs` construction boundary; keep it that way when adding new ones.
- Blocking work in `async def` routes goes through `asyncio.to_thread` (pip/venv subprocesses, nirs4all loads/predicts, parquet/store reads). `VenvManager`'s mutating ops are serialized by an internal RLock.

### WebSockets (`websocket/manager.py`, singleton `ws_manager`)
Channel-based pub/sub. Endpoints: `/ws` (general, channel subscriptions), `/ws/job/{job_id}`, `/ws/training/{job_id}`. Use the `notify_*` helpers (`notify_job_progress`, `notify_training_epoch`, `notify_fold_progress`, `notify_branch_progress`, `notify_variant_progress`, `notify_refit_*`) — don't hand-build messages.

### Frontend (`src/`)
- **Routing** in `src/App.tsx` (pages in `src/pages/`). Provider stack in `src/main.tsx`: `QueryClient → Router → Theme → Language → UISettings → DeveloperMode → ActiveRun`.
- **Electron vs web** is detected at runtime via `window.electronApi`: Electron uses `HashRouter` (file:// can't do BrowserRouter); web uses `BrowserRouter` and relies on Vite's proxy of `/api` and `/ws` → `127.0.0.1:8000`. In Electron there is no proxy — the transport resolves the backend URL from `electronApi`.
- **API layer:** the HTTP transport (`ApiClient`, `api`, `authorizedFetch`) lives in `src/api/http.ts`; per-domain call modules (`workspace.ts`, `datasets.ts`, `runs.ts`, `updates.ts`, …) import from it, and `src/api/client.ts` is a thin barrel re-exporting everything — existing `@/api/client` imports keep working. Add new endpoints to the matching domain module, not the barrel. Same barrel pattern: `src/utils/pipelineConverter.ts` → `src/utils/pipelineConverter/`, `src/lib/playground/export.ts` → `src/lib/playground/export/`.
- **State:** TanStack Query for server state (5-min staleTime, no refetch on window focus/reconnect); React Context for app state. Note several large domain contexts: `SelectionContext`, `PlaygroundViewContext`, `ActiveRunContext`, `OutliersContext`, `FilterContext`, `ReferenceDatasetContext`. The workspace dataset matrix is cached under `['workspaceDataset', id, name]` (30-min staleTime) — after any dataset mutation, invalidate via `workspaceDatasetQueryKeyPrefix(id)` from `useSpectralData`.
- **UI:** shadcn/ui (Radix) + Tailwind (teal/cyan scientific theme); `@` → `./src`; i18n via i18next (`src/lib/i18n`, `src/locales/`). 3D spectra use three.js / react-three-fiber; charts use recharts. Heavy vendors are split into manual chunks in `vite.config.ts`.

### Playground charts render on demand — preserve the invalidation
The playground WebGL charts no longer run continuous render loops; a redraw only happens when something invalidates. When you add any new visual input (prop/state that changes what is drawn), you MUST wire it into the invalidation or the chart will look frozen:
- `SpectraWebGL.tsx`: r3f `<Canvas frameloop="demand">` — add the input to the `SceneInvalidator` deps (or call `invalidate()` in the relevant controller). Hover hit-testing is rAF-coalesced and capped for hover only (clicks always run the full hit-test).
- Scatter renderers (`ScatterPureWebGL2D/3D`, `ScatterRegl2D`): set `needsRenderRef.current = true` on any new state change (data/colors/selection/camera); a DPR `matchMedia` listener and `ResizeObserver` already cover display changes.
- Run progress is WebSocket-driven; polling is a deliberate slow fallback (20s, 3s when the WS is down). Don't re-add fast `refetchInterval`s.

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
`docs/ELECTRON.md`, `docs/PACKAGING.md` (PyInstaller backend bundling), `docs/UPDATE_SYSTEM.md`, `docs/_internals/PLAYGROUND_SPECIFICATION.md`, `docs/_internals/CONCEPTS_RUN_RESULTS_PRED.md`. The 2026-06 tech-debt audit and its per-phase Codex reviews live in `AUDIT_TECHNIQUE.md` + `docs/audit/2026-06-04/` — check them before re-flagging known debt.
