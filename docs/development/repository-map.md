# Repository map

This page maps the repository by ownership. Use it to find the right place for
a change before editing.

## Top-level files

| Path | Purpose |
| --- | --- |
| `main.py` | FastAPI application entry point. |
| `package.json` | Node dependencies and scripts. |
| `vite.config.ts` | Vite, proxy, aliases, Electron build plugin, Sentry sourcemaps. |
| `electron-builder.yml` | Desktop package targets and resources. |
| `backend.spec` | PyInstaller backend bundle configuration. |
| `requirements*.txt` | Python dependency sets for runtime, tests, CPU, GPU, macOS GPU. |
| `.readthedocs.yaml` | Read the Docs build configuration. |
| `mkdocs.yml` | Documentation navigation, theme, extensions, validation. |

## Frontend

| Path | Purpose |
| --- | --- |
| `src/App.tsx` | Route tree. |
| `src/main.tsx` | Provider stack and runtime router selection. |
| `src/pages/` | Route-level page components. |
| `src/components/` | Feature and shared UI components. |
| `src/components/ui/` | shadcn/ui primitives. |
| `src/api/client.ts` | Backend API client and Electron URL resolution. |
| `src/hooks/` | Feature hooks and server-state hooks. |
| `src/context/` | Cross-cutting React context providers. |
| `src/types/` | Shared TypeScript domain types. |
| `src/locales/` | i18n resources. |
| `src/lib/` | Utilities, diagnostics, i18n, motion wrappers. |

## Pipeline editor and node registry

| Path | Purpose |
| --- | --- |
| `src/components/pipeline-editor/` | Editor UI, palette, canvas, config panels, validation UI. |
| `src/components/pipeline-editor/validation/` | Validation engine, rules, hooks, overlays. |
| `src/data/nodes/definitions/` | Static node definitions grouped by category. |
| `src/data/nodes/schema/` | JSON schema for node and parameter definitions. |
| `src/data/nodes/NodeRegistry.ts` | Static node registry runtime. |
| `src/data/nodes/custom/` | User and workspace custom node storage. |
| `public/node-registry/extended.json` | Generated extended operator registry. |

## Backend

| Path | Purpose |
| --- | --- |
| `api/workspace.py` | Workspace routes, settings, groups, custom nodes, linked workspaces. |
| `api/workspace_manager.py` | Active workspace and linked workspace state. |
| `api/app_config.py` | App config folder and persisted app settings. |
| `api/datasets.py` | Dataset detection, preview, validation, generation, refresh. |
| `api/pipelines.py` | Pipeline CRUD, validation, operator discovery, execution. |
| `api/nirs4all_adapter.py` | UI pipeline/dataset to nirs4all conversion. |
| `api/store_adapter.py` | Read/format access to nirs4all workspace store data. |
| `api/runs.py` | Run records, run actions, run logs. |
| `api/jobs/manager.py` | Background job execution and progress callbacks. |
| `api/shared/` | Shared pipeline, metrics, and filter helper logic. |
| `api/telemetry.py` | Backend opt-in diagnostics. |

## Electron

| Path | Purpose |
| --- | --- |
| `electron/main.ts` | Main process, window, IPC, native shell operations. |
| `electron/preload.ts` | `window.electronApi` bridge. |
| `electron/backend-manager.ts` | Backend subprocess lifecycle and health monitoring. |
| `electron/telemetry.ts` | Electron main process opt-in diagnostics. |

## Build and automation

| Path | Purpose |
| --- | --- |
| `scripts/launcher-node.cjs` | Cross-platform launcher entry. |
| `scripts/launcher.sh`, `scripts/launcher.cmd` | Platform launch helpers. |
| `scripts/build-backend.cjs` | PyInstaller backend build orchestration. |
| `scripts/build-release.cjs` | Full release build orchestration. |
| `scripts/validate-nodes.cjs` | Static node schema validation. |
| `scripts/validate-node-registry.cjs` | Extended registry validation. |
| `scripts/generate_extended_registry.py` | Operator discovery and extended registry generation. |
| `scripts/check-registry-snapshot.cjs` | Registry drift guard. |

## Tests and documentation

| Path | Purpose |
| --- | --- |
| `tests/` | Python backend tests. |
| `e2e/` | Playwright end-to-end tests. |
| `.storybook/` | Storybook configuration. |
| `docs/` | Public Read the Docs source plus excluded legacy notes. |
| `docs/_internal/`, `docs/_internals/` | Internal reviews, planning notes, archives. Excluded from RTD nav. |
