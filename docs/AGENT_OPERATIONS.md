# Studio operations and navigation

This manually loaded guide retains repository detail from CLAUDE.md. [AGENTS.md](../AGENTS.md) contains the local policy; commands here grant no installation, execution, GUI, publication or deployment authority. Current source/configuration and owner contracts determine support. Longer docs contain historical sections; do not infer capability or resurrect a removed lane from them.

## Environments and development

Studio is npm package `nirs4all-webapp`: React 19/Vite/strict TypeScript, Electron shell and Rust product sidecar. Use Node 24 from `.nvmrc` (engines require Node >=20/npm >=10), npm as declared in `package.json`, and Python 3.11+ for Python tooling. Install only within task authority: `npm install`; Python requirements/environment guidance is in [README](../README.md) and [Electron development](ELECTRON.md#development-workflow).

| Command | Purpose / boundary |
| --- | --- |
| `npm run dev` | Vite renderer. Backend selection is configured by Vite/E2E/desktop context; this command does not start a product Python server. |
| `npm run dev:electron` / `npm run start:desktop` | Vite plus Electron/Rust development session; sidecar preparation uses `scripts/prepare-desktop-sidecar.cjs`. `NIRS4ALL_NATIVE_SIDECAR_PATH` selects a development binary. |
| `python main.py --no-reload` | Explicit transitional FastAPI browser-development/diagnostic server only, never a packaged product listener or fallback. |
| `npm run doctor` / `npm run setup:wsl` | Toolchain diagnostics / WSL setup; setup can mutate the environment. |
| `npm run build` / `npm run build:electron` | Web / Electron renderer builds; the latter also checks the packaged Electron graph. |
| `npm run electron:preview` | Electron preview of prepared outputs. |

`package.json` scripts are authoritative. Do not assume historical `npm start`, `stop`, `storybook`, `build:backend*`, `dev:registry` or `test` scripts exist. [README scripts](../README.md#scripts) retains launcher navigation. `scripts/run-python.cjs` selects `PYTHON`, then local `.venv`, then available Python commands (plus Windows `py`); it can prepend detected SDK sibling source paths to PYTHONPATH. This development runner does not select the packaged CPython closure.

## Verification commands

Choose required checks for the affected coherent batch under AGENTS.md; pool compilation/test work and retain real exits/skips. This catalogue is not a mandatory full-suite rerun for every edit and is not executed evidence.

| Command | Current scope |
| --- | --- |
| `npm run lint:parallel` | ESLint; TypeScript app/node/Electron; node registry; n4m drift; storage; locale keys; UI package/presets; Ruff; backend dependency sync. It does not itself run Python syntax compilation. |
| `npm run test:parallel` | Vitest and backend pytest together. |
| `npm run test:frontend` / `npm run test:backend` | Vitest (`src/` + `electron/`) / `scripts/run-python.cjs -m pytest tests/ -v --tb=short --timeout=120 -n auto`. |
| `npm run test:routes` | Transitional FastAPI route uniqueness/ownership. |
| `npm run test:contract` | Frozen Studio V1 compatibility verifier, check mode. |
| `npm run test:e2e` | Playwright `web-chromium` project with declared project dependencies; current config starts Rust, not FastAPI. |
| `npm run test:vendored-native-sources` | Declared native-source drift verifiers; inspect current source/cohort configuration before interpreting their scope. |
| `npm run test:native-archive-v2` / `npm run test:native-sidecar` | Native archive adapter / selected native-sidecar and Electron transport/runtime contracts. |

Individual scripts: `lint:eslint`, `lint:tsc`, `lint:nodes` / `validate:nodes`, `check:n4m-registry`, `lint:storage`, `lint:locales`, `check:ui-package`, `lint:ruff`, `lint:deps`. Use `package.json` for exact expansions. [.github/workflows/ci.yml](../.github/workflows/ci.yml) retains the current build, native Methods, sidecar, runtime/auth and installer dry-run matrix; workflow-contract tests in `electron/` can be affected by workflow edits. Local full suites and hosted smoke/contract subsets are distinct evidence.

Focused invocations (reference only):

```text
npx vitest run src/pages/Runs.test.tsx
npx vitest run -t "renders runs"
node scripts/run-python.cjs -m pytest tests/test_venv_manager.py -v
node scripts/run-python.cjs -m pytest tests/test_x.py::TestClass::test_method
npx playwright test e2e/tests/smoke.spec.ts --project=web-chromium-smoke
cargo test --manifest-path sidecar/Cargo.toml <name>
```

The `tests/test_x.py` line is placeholder syntax. Vitest patterns/config live in [vitest.config.ts](../vitest.config.ts); pytest markers (`integration_full`, `websocket`, `slow`) and `asyncio_mode=auto` in [pytest.ini](../pytest.ini). E2E specs/page objects are in `e2e/tests/` / `e2e/pages/`; [playwright.config.ts](../playwright.config.ts) runs one worker and defines settings -> navigation -> smoke -> main Chromium project dependencies.

## Rust sidecar

`sidecar/` is the standalone `studio-sidecar` Cargo package. Run from Studio with `--manifest-path sidecar/Cargo.toml`; `sidecar/target/` is generated. Its Cargo configuration forbids unsafe code and enables clippy all/pedantic/nursery warnings. Source/cohort requirements are described at the start of [sidecar/README.md](../sidecar/README.md); local unpublished cohorts may require explicit source overrides. Do not infer registry availability from a pinned version or edit pins as a workaround.

```text
cargo fmt --manifest-path sidecar/Cargo.toml -- --check
cargo clippy --manifest-path sidecar/Cargo.toml --all-targets -- -D warnings
N4M_LIBRARY_PATH=<matching-libn4m> cargo test --manifest-path sidecar/Cargo.toml -- --test-threads=1
cargo build --manifest-path sidecar/Cargo.toml --bin studio-sidecar
sidecar/target/debug/studio-sidecar --smoke-readiness
sidecar/target/debug/studio-sidecar --host 127.0.0.1 --port 0
```

`<matching-libn4m>` is a placeholder for the built ABI-matching Methods library; use the exact owner cohort/configuration, not an arbitrary library. CI's `.github/actions/build-native-methods` provides its build path. A running sidecar prints `STUDIO_SIDECAR_READY {json}` after binding; Electron waits for that readiness line. `--smoke-readiness` does not start a server. Packaging helper navigation: `scripts/build-native-sidecar.cjs --target <triple>`.

## Product routes and CPython

- `electron/main.ts` / `native-session-lifecycle.ts` own desktop lifecycle; `preload.ts` exposes IPC. Historical `backend-manager.ts` examples are not product entrypoints. See [current Electron lifecycle](ELECTRON.md#current-native-session-lifecycle).
- `electron/renderer-transport-selection.ts` preselects HTTP/WS routes and capability requirements before dispatch: Rust or typed refusal, no Python HTTP target/retry. Rust handler/capability support alone does not make an unselected renderer route reachable.
- `src/api/transport.ts` owns shared fetch/base-URL transport. Rust handlers live in `sidecar/src/`; inspect the matching route/capability and owner adapter rather than growing a parallel dispatcher.
- Rust invokes scientific owners directly where supported or through bounded CPython JSON-stdio library/plugin hosts. Packaged host selection uses the attested runtime contract/closure, not arbitrary PATH or user venvs. Preserve isolation, time/size/process-lifecycle bounds; never add a Python listener or implicit fallback.
- `sidecar/contracts/` holds versioned native/cohort contracts; [Studio V1](contracts/studio-v1/README.md) freezes historical FastAPI behavior. Do not rebless goldens to conceal incompatibility; V1 snapshot writes require the documented approved compatibility review.
- Read [native HTTP access](NATIVE_HTTP_ACCESS.md) before handshake changes: loopback binding, Host/Origin and request-body guards, Electron's per-process `X-Nirs4all-Session` secret kept out of renderer storage/URLs. Packaged runtime contract tests require the old Python HTTP diagnostic policy file to remain absent.

## Transitional Python tooling

`main.py` registers domain routers in `api/`; `api/jobs/` owns its Python job manager, `api/workspace/` split workspace routers, `api/updates/` update tooling and `websocket/manager.py` its Python WS manager. These are browser-development/diagnostic paths, not the product port owner. `api/lazy_imports.py` defers scientific imports; readiness-dependent routes use the existing readiness/cache helpers. `api/nirs4all_adapter.py` and `api/store_adapter.py` adapt SDK/store APIs.

[Architecture boundaries](ARCHITECTURE_BOUNDARIES.md#backend-route-ownership) retains detailed transitional route ownership. Dataset list/link/unlink/refresh belongs to `api.workspace.router_datasets`; interpretation/preview/load/stats/verify to `api.datasets`. Never expose the same method/path through two routers; retain `test:routes` for ownership changes. `BACKEND_COMMON_PACKAGES` in `scripts/python-runtime-config.cjs` drives the declared backend dependency sync; `lint:deps` checks the relevant requirements/hiddenimports. Product plugin-only closure and transitional HTTP dependencies have different boundaries.

## Renderer and registry navigation

This is navigation for a future authorized joint GUI batch; it grants no GUI migration/refactoring authority.

- `src/api/`: transport only; `src/lib/`: pure adapters/normalizers; `src/hooks/`: workflow fetching/state; `src/context/`: genuinely shared state; provider `.tsx` exports providers, sibling `.ts` exports contexts/hooks; `src/pages/`: route composition. Follow [architecture boundaries](ARCHITECTURE_BOUNDARIES.md) for per-feature ownership instead of adding policy to page JSX.
- Shared reusable presentation/view-model helpers come from `nirs4all-ui`, consumed via `vendor/npm/`; host APIs, routing, persistence and execution stay in Studio. Browser storage keys belong in `src/lib/clientStorage/keyRegistry.ts`, accessed through the `clientStorage` facade; `lint:storage` enforces the declared boundary.
- The Python node palette is generated from SDK introspection: `scripts/generate_registry.py`, `generate_extended_registry.py`, then `curate-canonical-nodes.cjs` / `curation-rules.json` and `generate-node-reference.cjs`. Runtime palette: `public/node-registry/extended.json`; curated/generated inputs: `src/data/nodes/definitions/` and `generated/canonical-registry.json` / `node-reference.json`.
- `src/data/nodes/NodeRegistry.ts` is the validating public wrapper, `NodeRegistryIndex.ts` owns indexing/merge/search mechanics, and `src/data/nodes/custom/` handles custom nodes. `api/node_registry_loader.py` uses definitions plus canonical registry; do not substitute the reference artifact for that source. [Custom nodes](sources/custom-nodes-guide.md) retains user/API examples.
- Native Methods nodes use the manifest projection: `npm run generate:n4m-registry` projects `src/data/nodes/generated/n4m-manifest.json` through `nirs4all-ui/nodeRegistry`; `--cli <n4m_cli>` / `N4M_CLI` can refresh the manifest. Preserve `source: "n4m"` and portable `n4m:<method_id>` class paths through serialization. `check:n4m-registry` checks drift; `validate:nodes` checks palette schemas/IDs (`type.snake_case`). Regenerate affected artifacts through their owner path and validate when such edits are authorized.

## Further references and tooling

- [Development index](development/README.md) separates current contracts, topic references and history. [Sidecar README](../sidecar/README.md) retains protocol/cohort detail, but its old diagnostic-switch/rollback and coverage paragraphs must not override current Rust-only source/contracts.
- [Packaging](PACKAGING.md#build-entry-points) and [README release profiles](../README.md#desktop-release-profiles) retain matching-host CPU installer commands and disabled portable/all-in-one release policy; [updates](UPDATE_SYSTEM.md) / [API reference](API_UPDATES.md) retain update shapes/navigation. Historical examples are not authority to publish or to acquire Python HTTP. No release/deployment is authorized by AGENTS.md or this guide.
- Sentry configuration: `VITE_SENTRY_DSN` for frontend; `SENTRY_DSN=""` disables Python telemetry in the documented test/development context. Do not log protected environment values.
- Prefix commands with `rtk` when consistent with scope; use `rtk proxy <command>` for exact bytes/raw output and capture true child exits. Filtered summaries do not establish success. Never run `rtk init` / `rtk init --global` or reinject managed blocks. RTK environment/log/history tools are not secret redaction.
- Claude MCP: always pass scoped `allowedTools` on initial/resumed calls. The usual writable-task baseline is `["Bash", "Read", "Write", "Edit", "Glob", "Grep", "Task"]`; narrow for read-only work and permit Task/network only when in scope. Retain sessionId/nextCursor, poll `claude_code_check(action="poll")`, and continue the same session with `claude_code_reply` until completion. An in-scope residual permission may use `allow_for_session`; tool permissions never expand task authority.
