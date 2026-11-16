# Python environment redesign (2026-11-16)

Maintainer-requested rewrite of how Studio finds, prepares and uses Python.
This document is the working specification for the branch
`feat/python-env-redesign-20261116`. The renderer/main contract is
`src/types/pythonEnvironment.ts`; do not change it without updating this file.

## Why

- Every installer shipped a complete Python runtime (about 1.5 GB, 17,000
  files). An application update reinstalled all of it.
- Two environment systems overlapped: the included runtime (exact pins,
  SHA-attested) and the selected environment (version ranges), with a silent
  session fallback from one to the other.
- The first launch after an update invalidated caches, re-hashed nirs4all files
  under a 180 s budget and imported torch/tensorflow/jax to probe capabilities.
- The sidecar refused selected environments on layout grounds
  (`scientific_distribution_tampered`) and re-walked files on every readiness
  poll and around every request.
- Five renderer views showed "installed vs recommended" from different sources;
  an older wizard was dead code; three renderer calls had no Rust route.

## Maintainer decisions

1. Light installer without Python, plus a separate offline installer variant.
2. Wheels of the required packages are embedded in the installer; PyPI serves
   everything else.
3. `uv` is embedded and replaces pip/venv for creation and installation.
4. User experience:
   - First launch: one page lists detected environments with what each lacks,
     from a package listing only (no import tests). The user picks one and
     chooses, package by package, what to install or update; or creates a new
     environment. Required packages are installed automatically.
   - Later launches and updates reuse the same environment without asking.
     Required packages are updated automatically when they leave the required
     range.
   - Recommended packages older than recommended: a small warning at startup,
     plus an indicator dot on Settings and on its Python tab.
   - Settings can switch environment through the same page.
   - Fast and seamless: an update replaces the application core and at most
     the required packages.

## Model

- **One environment.** Studio uses the interpreter stored in
  `userData/env-settings.json` as `{ "pythonPath": "..." }`. There is no
  included runtime, no fallback and no wizard flags. Older settings shapes are
  not migrated: without a usable `pythonPath` the phase is `unconfigured` and
  the setup page is shown once.
- **Catalogue.** `recommended-config.json` is the single source for package
  requirements:
  - `required`: list of `{ name, range, install }`. `range` is the accepted
    specifier (may be empty); `install` is the exact version of the qualified
    cohort that Studio installs. The required set is nirs4all and its owner
    packages (nirs4all-core, dag-ml, dag-ml-data, nirs4all-io,
    nirs4all-methods, nirs4all-formats).
  - `optional`: the recommended catalogue (`min`, `recommended`, `category`,
    `description`, `default_install`, optional `python`).
  - `profiles` are removed at the end of the work (the GPU choice is handled by
    `uv --torch-backend auto`); until then nothing new may depend on them.
  `scripts/python-runtime-config.cjs` and the Rust sidecar derive their values
  from this file. No other file hard-codes a nirs4all version or range.
- **Admission is a range, installation is exact.** An environment is usable
  when every required package is within `range`. When Studio installs or
  repairs, it installs every required package at its exact `install` version.
- **Inventory.** One subprocess per interpreter
  (`python -I -B -c <importlib.metadata listing>`) returns the Python version,
  every distribution with its version, which ones are editable
  (`direct_url.json`), whether the environment is externally managed
  (PEP 668 marker) and whether its package directory is writable. Nothing is
  imported.
- **Editable installs are never modified.** An editable required package within
  range is `ok`; out of range it is `editable` and the phase is
  `needs_attention` (`required_not_installable`).

## Electron main: owner of the lifecycle (`electron/env/`)

- Detection: existing discovery of candidates, then one inventory per
  candidate (bounded parallelism), giving a `PythonEnvReport` each.
- `uv`: resolved from `NIRS4ALL_UV`, then `resources/backend/tools/uv[.exe]`,
  then `backend-dist/tools/`, then `PATH` (development). Always invoked with
  `--python <interpreter>`, `UV_LINK_MODE=copy`, the system certificate store
  (`UV_NATIVE_TLS=1`) and output streamed to the existing install log.
- Wheelhouse: `resources/backend/wheels/` is passed as `--find-links`. The
  offline installer also carries `resources/backend/offline/` (Python archive
  and the full wheel closure of the required packages and default recommended
  packages); when present, creation and required installs run with
  `--offline --no-index`.
- Create: obtain the pinned python-build-standalone archive (offline payload,
  else the existing hardened download), extract into
  `userData/python-env/python`, `uv venv userData/python-env/venv`, install the
  required packages and the chosen recommended packages. `torch` is installed
  with `--torch-backend auto`.
- Startup: read settings; if unconfigured, start the sidecar without a Python
  host and let the renderer show the setup page. Otherwise take the inventory
  (cached by environment fingerprint and required specs). If a required package
  is missing or out of range and the environment is writable and not editable,
  install the required set automatically (splash shows one progress line), then
  start the sidecar. On failure Studio still opens, phase `needs_attention`.
- Switch/apply: install, select, restart the sidecar, wait for
  `/api/system/readiness`, confirm `/api/system/env-coherence` reports the
  selected interpreter; on failure restore the previous selection.
- IPC: only the `PythonEnvApi` surface plus the existing install-log channel.
  All previous `env:*` handlers, the bundled-runtime helpers, the verify cache,
  `ensureBackendPackages`/`verifyBackend*`, `runtimeFallback`,
  `prepareRuntimeAdapters`, `backend-manager.ts` and
  `scientific-plugin-lifecycle.ts` are removed.

## Rust sidecar

- Receives `NIRS4ALL_PYTHON_PLUGIN_HOST`, its site-packages and
  `NIRS4ALL_STUDIO_ADAPTERS_DIR` (the adapters shipped with the application;
  they are no longer copied into the user's environment).
- Admission: CPython 3.11+, nirs4all version within the catalogue range (read
  from distribution metadata), and the worker bootstrap importing nirs4all and
  its Studio callables. A failure reports the real reason.
- Removed: the packaged/bundled policy (closure manifest, RECORD hashing, wheel
  /commit/manifest pins, host verification cache), the selected layout guard,
  the per-poll and per-request file walks, and the
  `_BUNDLED`/`_CLOSURE`/`_RUNTIME_ROOT` variables.
- The worker protocol, isolation flags, time/size/process bounds and all
  scientific execution paths are unchanged.
- `/api/system/capabilities` reads distribution metadata instead of importing
  torch/tensorflow/jax. GPU detection stays an explicit, on-demand probe.
- Removed routes (now owned by Electron or obsolete): `/api/config/recommended`,
  `/api/config/diff`, `/api/config/setup-status`, `/api/config/complete-setup`,
  `/api/config/skip-setup`, `/api/updates/dependencies*`,
  `/api/updates/runtime/*`, with their renderer-transport allow-list entries
  and the embedded `api/library_runtime_config.py`.

## Renderer

- One page component, used by the `/setup` route and by a new Settings tab
  `python`: current environment, detected environments (with what each lacks),
  browse, create, and the package table (required rows are automatic and
  locked; recommended rows have one checkbox each, grouped by category), one
  Apply button, progress and a collapsible install log.
- Startup: navigate to `/setup` only when the phase is `unconfigured`. Show one
  toast per session when `outdatedRecommendedCount > 0`. Show a banner with
  Retry when the phase is `needs_attention`.
- Indicator dot on the sidebar Settings entry and on the Python tab when
  `outdatedRecommendedCount > 0` or the phase is `needs_attention`.
- Outside Electron (browser, Docker) the tab is a read-only summary from
  `/api/system/info`; there is no setup route.
- Removed: `components/setup/EnvSetup*`, `settings/PythonEnvPicker*`,
  `ConfigAlignment`, `DependenciesManager*`, `dependencyVersionState`,
  `UpdatesNirs4allDialog`, the runtime/snapshot panel of the Updates tab, the
  web setup wizards, `lib/pythonRuntimeSwitch`, `lib/pythonRuntimeNotice`, their
  API clients, tests and locale keys (en, fr).

## Packaging and CI (last phase)

- Installer payload: `resources/backend/native/` (sidecar, libn4m, contract),
  `tools/uv`, `wheels/` (required cohort for the platform), `adapters/`.
- Offline installer: the same plus `offline/`; asset name suffix `-offline`.
  The in-app update check always selects the light installer.
- Removed: runtime bake scripts, closure manifests, the Python parts of the
  packaged runtime contract, PyInstaller leftovers, stale docs.
- Docker builds its environment from the same catalogue with `uv` and passes it
  as the selected interpreter.

## Phases and ownership

| Phase | Scope | Files |
| --- | --- | --- |
| E | Electron lifecycle | `electron/env/**`, `electron/env-manager.ts`, `electron/main.ts`, `electron/preload.ts`, `electron/native-sidecar-manager.ts`, `scripts/python-runtime-config.cjs`, `recommended-config.json` (`required` block) and their tests |
| R | Sidecar | `sidecar/**`, `electron/renderer-transport-selection.ts` (+test), `api/library_runtime_config.py`, `tests/` for pins and runtime config |
| U | Renderer | `src/**` (except `src/types/pythonEnvironment.ts`), `e2e/**` |
| P | Packaging, CI, Docker, docs | build scripts, workflows, `electron-builder*.yml`, `electron/packaged-runtime-contract.ts`, `Dockerfile`, `docs/` |

Each phase is reviewed independently before the next checkpoint.
