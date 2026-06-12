# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**nirs4all Studio** (npm package name `nirs4all-webapp`) — a desktop/web app for Near-Infrared Spectroscopy analysis. React 19 + Vite + TypeScript frontend (`src/`), FastAPI backend (`api/` + `main.py`), Electron shell (`electron/`). It is a UI on top of the **`nirs4all`** Python library, which lives in the sibling checkout `../nirs4all`.

**The cardinal rule (see `AGENTS.md`):** the backend is a *thin orchestration layer* — HTTP routing, request validation, file uploads, the job queue, WebSockets, workspace/UI state, and adapters. It NEVER reimplements NIRS / data / ML logic; that belongs to `nirs4all`. If something looks missing, it almost certainly already exists in `nirs4all` — check there before adding it here. The app must also run with `nirs4all` absent (imports are guarded), so the UI works for pure frontend development.

## Commands

`package.json` scripts are the source of truth. The README's "Scripts" section is partly stale — `npm start`, `npm run stop`, `npm run storybook`, `npm run build:backend*`, `npm run dev:registry`, and `npm run test` no longer exist.

### Dev
- **Frontend (web):** `npm run dev` — Vite at http://localhost:5173. In web mode it proxies `/api` and `/ws` to `127.0.0.1:8000`.
- **Backend:** `python main.py` — uvicorn at `127.0.0.1:8000` (flags: `--port`, `--host`, `--no-reload`; auto-reload is on by default unless `NIRS4ALL_DESKTOP=true`). Use the project `.venv`; at startup the backend resolves the sibling `../nirs4all` onto `sys.path` (and the launcher resolves `../nirs4all/.venv`).
- **Desktop (Electron):** `npm run dev:electron` (alias `npm run start:desktop`) — pre-builds the electron entry, runs Vite with `ELECTRON=true`, and launches Electron, which **spawns and manages the Python backend itself** — you do not start the backend separately in this mode.

### Green gate (run before reporting work complete)
- `npm run lint:parallel` — eslint + `tsc --noEmit` + node-registry validation + ruff + backend dep-sync.
- `npm run test:parallel` — Vitest (frontend + electron TS) and pytest (backend) together.
- `npm run test:e2e` — Playwright (`web-chromium` project).

Individual gates: `lint:eslint`, `lint:tsc`, `lint:nodes` (= `validate:nodes`), `lint:ruff`, `lint:deps`, `test:frontend`, `test:backend`. CI (`.github/workflows/ci.yml`) additionally builds the web + electron frontends and runs an `electron-builder --dir` dry-run on Node 24 / Python 3.11.

### Single test
- **Frontend (Vitest):** `npx vitest run src/pages/Runs.test.tsx`, or by name `npx vitest run -t "renders runs"`. Globs: `src/**/*.test.{ts,tsx}` and `electron/**/*.test.ts`.
- **Backend (pytest):** `python -m pytest tests/test_venv_manager.py -v`, or one case `... tests/test_x.py::TestClass::test_method`. `test:backend` runs with `-n auto`; markers in `pytest.ini`: `integration_full`, `websocket`, `slow`; `asyncio_mode=auto`.
- **E2E (Playwright):** `npx playwright test e2e/tests/smoke.spec.ts --project=web-chromium`. Specs in `e2e/tests/`, page objects in `e2e/pages/`. Runs serially (`workers: 1`) because backend state is shared.

### Build / release
- Frontend: `npm run build` (web) / `npm run build:electron` (Electron renderer, relative `./` base).
- Full release: `node scripts/build-release.cjs --mode {installer|standalone} --flavor {cpu|gpu|gpu-metal}` (or `npm run release`, `npm run release:all-in-one`):
  - **installer** — embeds a Python venv, allows runtime `pip install`, produces native installers (`.exe`/`.dmg`/`.deb`).
  - **standalone** — freezes the backend with PyInstaller (`backend.spec`) into a portable archive; no Python needed on the target.
- Docker-isolated CI locally: `npm run ci:docker[:frontend|:backend|:e2e|:lint]`.

## Architecture

### The nirs4all boundary + two-phase startup
`api/lazy_imports.py` defers all `nirs4all` imports so the server boots fast and runs even when the library is missing:
- **Phase 1 (core_ready):** FastAPI up, workspace restored, basic endpoints work; all routers are registered but ML imports are deferred.
- **Phase 2 (ml_ready):** `nirs4all` (controllers, `PipelineConfigs`, `SpectroDataset`, metrics, operators/models, …) is loaded in a background thread; heavy pages (Playground, PipelineEditor, Training) become functional.

Routes needing the library call `require_ml_ready()` / `get_cached(key)`; `/api/health` blocks the UI until `startup_complete`. `api/nirs4all_adapter.py` and `api/store_adapter.py` are the translation layers to the library and its SQLite+Parquet workspace store.

### Backend (`api/`, `main.py`, `websocket/`)
`main.py` builds the FastAPI app and mounts one router per domain. Routers are flat modules in `api/` (e.g. `datasets`, `pipelines`, `training`, `predict`, `predictions`, `runs`, `models`, `shap`, `synthesis`, `transfer`, `inspector`, `evaluation`, `analysis`, `automl`, `spectra`, `preprocessing`, `recommended_config`, `playground`, `workspace`, `updates`, `system`). Sub-packages: `api/shared/` (logger, sentry, gpu_detection, metrics, dataset_config, json_safe, runtime_paths, …), `api/jobs/` (background job manager), `api/playground/`, `api/workspace/` (split routers), `api/updates/` (auto-updater). Real-time training/progress is pushed over `websocket/manager.py` (`ws_manager`).

### Frontend (`src/`)
React 19 + TS (strict), Tailwind + shadcn/ui (Radix primitives), TanStack Query for server state, react-router v6, i18next, Framer Motion; three.js / `@react-three/*` + `regl` for 3D/WebGL spectra, recharts for charts. `@/` aliases `src/`. There is one route component per feature page in `src/pages/` (`Datasets`, `PipelineEditor`, `Playground`, `Runs`, `Results`, `Predict`, `Inspector`, `SpectraSynthesis`, `TransferAnalysis`, `Settings`, `SetupWizard`, …). The API client lives in `src/api/`.

### Node registry (the load-bearing cross-cutting system)
The pipeline editor's palette of "nodes" (preprocessing / model / splitting / y-processing / … operators) is *generated from `nirs4all` by introspection*, not hand-written. Flow:
1. **Generate** (Python, under `scripts/`, introspect nirs4all): `generate_registry.py`, `generate_extended_registry.py`; `.cjs` helpers `curate-canonical-nodes.cjs` (+ `curation-rules.json`) and `generate-node-reference.cjs` curate/derive the editor artifacts.
2. **Artifacts:** `public/node-registry/extended.json` (runtime palette served to the browser); `src/data/nodes/generated/canonical-registry.json` + `node-reference.json` (generated); `src/data/nodes/definitions/<category>/` (curated editor definitions).
3. **Consume:** frontend via `src/data/nodes/NodeRegistry.ts` (`createNodeRegistry`; user/custom nodes in `src/data/nodes/custom/`); backend via `api/node_registry_loader.py`, which merges `definitions/` with `generated/canonical-registry.json` — and deliberately does NOT treat `node-reference.json` as the source of truth (that artifact is stale for some DL regressors/classifiers).
4. **Validate** (green gate): `npm run validate:nodes` checks every `public/node-registry/*.json` against `src/data/nodes/schema/{node,parameter}.schema.json`. Node ids must match `type.snake_case`.

When you add or change a node, regenerate the artifacts and then run `validate:nodes`.

### Electron shell (`electron/`)
`main.ts` (window/app lifecycle, splash) · `preload.ts` (contextBridge IPC; types in `src/types/electron.d.ts`) · `backend-manager.ts` (spawns/monitors the Python backend, sets `NIRS4ALL_DESKTOP`) · `env-manager.ts` + `setup-python-env` (detect/provision the embedded Python env) · `portable-paths.ts` · `logger.ts` (rotating file logs under the OS app-data dir). Electron `*.test.ts` files run under Vitest. Packaging configs: `electron-builder.installer.yml`, `electron-builder.archive.yml`.

## Conventions worth knowing
- **Backend runtime deps have one source of truth:** `BACKEND_COMMON_PACKAGES` in `scripts/python-runtime-config.cjs`. `requirements.txt`, `requirements-cpu.txt`, and `backend.spec` hiddenimports must all agree with it — `npm run lint:deps` fails the gate on drift (`nirs4all` and `pyinstaller` are excluded from the set).
- **Python:** 3.11+, ruff (`line-length = 220`, config in `ruff.toml`), Google-style docstrings. **TypeScript:** strict, 2-space indent, PascalCase components, `use*` hooks, prefer existing shadcn/ui + Radix + TanStack helpers.
- **Sentry** is optional: the frontend uses `VITE_SENTRY_DSN`; the backend ships a default DSN, so set `SENTRY_DSN=""` to disable (tests do).
- Generated/output dirs are not committed: `dist/`, `dist-electron/`, `backend-dist/`, `release/`, `workspace/`, `test-results/`, `playwright-report/`.
- Deeper docs: `docs/ELECTRON.md`, `docs/PACKAGING.md`, `docs/UPDATE_SYSTEM.md` (+ `docs/API_UPDATES.md`), `docs/sources/custom-nodes-guide.md`. `AGENTS.md` is the short contributor brief.

<!-- rtk-instructions v2 -->
# RTK (Rust Token Killer) - Token-Optimized Commands

## Golden Rule

**Always prefix commands with `rtk`**. If RTK has a dedicated filter, it uses it. If not, it passes through unchanged. This means RTK is always safe to use.

**Important**: Even in command chains with `&&`, use `rtk`:
```bash
# ❌ Wrong
git add . && git commit -m "msg" && git push

# ✅ Correct
rtk git add . && rtk git commit -m "msg" && rtk git push
```

## RTK Commands by Workflow

### Build & Compile (80-90% savings)
```bash
rtk cargo build         # Cargo build output
rtk cargo check         # Cargo check output
rtk cargo clippy        # Clippy warnings grouped by file (80%)
rtk tsc                 # TypeScript errors grouped by file/code (83%)
rtk lint                # ESLint/Biome violations grouped (84%)
rtk prettier --check    # Files needing format only (70%)
rtk next build          # Next.js build with route metrics (87%)
```

### Test (60-99% savings)
```bash
rtk cargo test          # Cargo test failures only (90%)
rtk go test             # Go test failures only (90%)
rtk jest                # Jest failures only (99.5%)
rtk vitest              # Vitest failures only (99.5%)
rtk playwright test     # Playwright failures only (94%)
rtk pytest              # Python test failures only (90%)
rtk rake test           # Ruby test failures only (90%)
rtk rspec               # RSpec test failures only (60%)
rtk test <cmd>          # Generic test wrapper - failures only
```

### Git (59-80% savings)
```bash
rtk git status          # Compact status
rtk git log             # Compact log (works with all git flags)
rtk git diff            # Compact diff (80%)
rtk git show            # Compact show (80%)
rtk git add             # Ultra-compact confirmations (59%)
rtk git commit          # Ultra-compact confirmations (59%)
rtk git push            # Ultra-compact confirmations
rtk git pull            # Ultra-compact confirmations
rtk git branch          # Compact branch list
rtk git fetch           # Compact fetch
rtk git stash           # Compact stash
rtk git worktree        # Compact worktree
```

Note: Git passthrough works for ALL subcommands, even those not explicitly listed.

### GitHub (26-87% savings)
```bash
rtk gh pr view <num>    # Compact PR view (87%)
rtk gh pr checks        # Compact PR checks (79%)
rtk gh run list         # Compact workflow runs (82%)
rtk gh issue list       # Compact issue list (80%)
rtk gh api              # Compact API responses (26%)
```

### JavaScript/TypeScript Tooling (70-90% savings)
```bash
rtk pnpm list           # Compact dependency tree (70%)
rtk pnpm outdated       # Compact outdated packages (80%)
rtk pnpm install        # Compact install output (90%)
rtk npm run <script>    # Compact npm script output
rtk npx <cmd>           # Compact npx command output
rtk prisma              # Prisma without ASCII art (88%)
```

### Files & Search (60-75% savings)
```bash
rtk ls <path>           # Tree format, compact (65%)
rtk read <file>         # Code reading with filtering (60%)
rtk grep <pattern>      # Search grouped by file (75%). Format flags (-c, -l, -L, -o, -Z) run raw.
rtk find <pattern>      # Find grouped by directory (70%)
```

### Analysis & Debug (70-90% savings)
```bash
rtk err <cmd>           # Filter errors only from any command
rtk log <file>          # Deduplicated logs with counts
rtk json <file>         # JSON structure without values
rtk deps                # Dependency overview
rtk env                 # Environment variables compact
rtk summary <cmd>       # Smart summary of command output
rtk diff                # Ultra-compact diffs
```

### Infrastructure (85% savings)
```bash
rtk docker ps           # Compact container list
rtk docker images       # Compact image list
rtk docker logs <c>     # Deduplicated logs
rtk kubectl get         # Compact resource list
rtk kubectl logs        # Deduplicated pod logs
```

### Network (65-70% savings)
```bash
rtk curl <url>          # Compact HTTP responses (70%)
rtk wget <url>          # Compact download output (65%)
```

### Meta Commands
```bash
rtk gain                # View token savings statistics
rtk gain --history      # View command history with savings
rtk discover            # Analyze Claude Code sessions for missed RTK usage
rtk proxy <cmd>         # Run command without filtering (for debugging)
rtk init                # Add RTK instructions to CLAUDE.md
rtk init --global       # Add RTK to ~/.claude/CLAUDE.md
```

## Token Savings Overview

| Category | Commands | Typical Savings |
|----------|----------|-----------------|
| Tests | vitest, playwright, cargo test | 90-99% |
| Build | next, tsc, lint, prettier | 70-87% |
| Git | status, log, diff, add, commit | 59-80% |
| GitHub | gh pr, gh run, gh issue | 26-87% |
| Package Managers | pnpm, npm, npx | 70-90% |
| Files | ls, read, grep, find | 60-75% |
| Infrastructure | docker, kubectl | 85% |
| Network | curl, wget | 65-70% |

Overall average: **60-90% token reduction** on common development operations.
<!-- /rtk-instructions -->
