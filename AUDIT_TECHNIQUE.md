# nirs4all-studio — Technical-Debt & Bottleneck Audit + Roadmap

**Date:** 2026-06-04
**Scope:** `api/` (FastAPI backend), `src/` (React 19 + Vite + TS), `electron/`, `websocket/`, build/packaging/CI, dependencies.
**Codebase size at audit:** ~30k LOC Python (`api/`), ~150k LOC TS/TSX (`src/`), ~1.1k LOC Electron.

> This document is the **consolidated deliverable**. It merges five independent perspectives, flags where they agree (high confidence) and where they conflict (corrected), and ends with a single **unified roadmap**. The raw per-agent reports are preserved verbatim under [`docs/audit/2026-06-04/`](docs/audit/2026-06-04/) for traceability.
>
> _(Written in English to match the repo's other engineering docs — `BACKEND_RULES.md`, `api_cleaning.md`, `Roadmap.md`. Ask if you want a French version.)_

---

## How this audit was produced (method)

Two AI systems audited the codebase **independently and in parallel**, then one reviewed the other:

| # | Source | What it did | Raw report |
|---|--------|-------------|-----------|
| 1 | **Claude** multi-agent workflow (123 agents) | 9 specialist auditors (backend boundary / async-perf / quality / security; frontend arch / perf / quality; tests-CI; build-deps). **Every one of 113 findings was re-checked by an independent adversarial verifier** that re-read the cited code and could reject it. All 113 survived verification. | [`01_claude_audit.md`](docs/audit/2026-06-04/01_claude_audit.md) · [`01_claude_findings.json`](docs/audit/2026-06-04/01_claude_findings.json) |
| 2 | **Codex** (GPT, `codex exec`) — backend | Independent audit of `api/`, `websocket/`, `main.py`. | [`02_codex_backend.md`](docs/audit/2026-06-04/02_codex_backend.md) |
| 3 | **Codex** — frontend | Independent audit of `src/`, `electron/`. | [`03_codex_frontend.md`](docs/audit/2026-06-04/03_codex_frontend.md) |
| 4 | **Codex** — cross-cutting | Independent audit of build, packaging, deps, tests, CI, architecture. | [`04_codex_crosscutting.md`](docs/audit/2026-06-04/04_codex_crosscutting.md) |
| 5 | **Codex** — reviewer of Claude's audit | Was given Claude's full audit + the repo; validated, disputed, and found gaps. | [`05_codex_review_of_claude.md`](docs/audit/2026-06-04/05_codex_review_of_claude.md) |

**Confidence legend used below:**
- **🟢 Cross-confirmed** — found independently by Claude *and* Codex (or explicitly validated by the Codex review). Highest confidence.
- **🔵 Verified single-source** — found by one system and confirmed against the code (adversarial verifier or Codex spot-check), but not independently corroborated.
- **🟠 Corrected** — Claude's original claim was overstated/mis-located; the corrected version is stated here (per the Codex review).

---

## Executive summary

1. **🟢 The async surface is a façade — heavy work runs on the event loop.** Of **261 `async def` handlers**, blocking work is offloaded in essentially **one place** (zip extraction, `api/update_downloader.py:227,245`). Synchronous `pip install` blocks the loop for **up to 15 minutes** (`api/venv_manager.py:518` ← `api/updates.py:821`); `nirs4all.predict()`, dataset loads, preprocessing, `permutation_importance(n_jobs=-1)`, SHAP, and SQLite reads all run inline. A single worker (`main.py`) means one heavy request freezes the whole UI and the WebSocket loop. **This is the primary cause of the "desktop app feels frozen" complaint.**

2. **🟢 The desktop app ships an unauthenticated, CORS-`*` local API with destructive + code-execution endpoints.** `main.py:100` sets `allow_origins=["*"]` with no auth. Any web page the user visits while the app runs can drive **arbitrary `pip install`** (`api/updates.py:1322` → `api/venv_manager.py:491`), **`shutil.rmtree`** of a dataset path (`api/datasets.py:1036`), and **pickle-based model loads** (`api/predictions.py:914`). The auto-updater **verifies no checksum** (`api/update_downloader.py:148` returns `True` when absent) and accepts an **attacker-settable GitHub repo** via unauthenticated `PUT /api/settings` (`api/updates.py:471,735`) → **remote code execution at next launch**. This is the highest-priority cluster.

3. **🟢 Several "thin-layer" violations are not just debt — the endpoints are dead at runtime.** `evaluation.py`, `predictions.py` (confidence/explain), `shap.py`, and `playground.py` (`/metrics/outliers`) reference helpers that **no longer exist**, raising `ImportError`/`NameError`/`AttributeError` *on call*. **All four confirmed by the Codex reviewer:** `_get_model_instance` (`api/evaluation.py:662`), `get_loaded_model` (`api/predictions.py:907`), `ShapAnalyzer` (`api/shap.py:310`), `MetricsComputer.get_outlier_mask` (`api/playground.py:1638`). A one-line CI import-smoke test would have caught every one.

4. **🟢 CI gates are decorative.** Main CI (`.github/workflows/ci.yml:7`) triggers on `main`/`develop`, but the live branch is **`master`** → it never runs on PRs. Vitest runs with `continue-on-error: true` (`ci.yml:45`). **pytest is never invoked** in any workflow. The one `master`-targeting workflow (Playwright) **can't pass** — it provisions no Python venv though `webServer` runs `.venv/bin/python main.py`.

5. **🟢 The Electron self-update path cannot work as built.** The Python self-updater relaunches a hard-coded `nirs4all-studio` binary (`updater/__init__.py:82`), the packaged backend is actually `nirs4all-backend` (`electron/backend-manager.ts:68`), the build is `asar`-packed (`electron-builder.yml:22`), and **`electron-updater` is not a dependency** (absent from `package.json`). At best the feature no-ops.

6. **🟢 Per-request resource churn on hot endpoints.** Dashboard/predictions endpoints open a **fresh `WorkspaceStore`** (new SQLite connection) per request instead of reusing the cached adapter (`api/aggregated_predictions.py:182`, `api/workspace.py:1628`, 3× per `get_dashboard()`), and **count rows by loading the full prediction table into Python** (`api/store_adapter.py:178,239`) instead of SQL `COUNT`/`GROUP BY`. _(🟠 the store **is** closed in `finally` at `api/aggregated_predictions.py:220` — the original "leaked `atexit`" claim was not verifiable.)_

7. **🟢 Frontend: a continuous 60 fps loop + cache-less refetching.** `SpectraWebGL` runs `frameloop='always'` forever and recomputes its projection every frame (`SpectraWebGL.tsx:1780,1201`), and is **not** `React.memo`-wrapped (`SpectraWebGL.tsx:1919`). The **playground transform cache is broken at the root**: cache-hash keys include a transient operator `id` built from `Date.now()-Math.random()` (`src/lib/playground/hashing.ts:72`), so the same pipeline hashes differently after import/restore → permanent cache misses. Several high-traffic pages refetch full NIRS matrices via raw `useState`/`useEffect` (`DatasetDetail.tsx:64`, `useSpectralData.ts:91`). _(🟠 React Query **is** used correctly elsewhere — `Runs.tsx:256`, `useDashboard.ts:22` — so this is "specific pages bypass it", not "no caching".)_

8. **🟢 God-files + dead code inflate the change surface.** `api/workspace_manager.py` is **2772 lines** holding **~730 lines of fully dead, rule-violating code** (`DatasetRegistry`/`SchemaMigrator`/`RunManager`, lines 1122–1856, zero external references). `src/api/client.ts` is a **2126-line** module mirroring every router. `src/components/playground/visualizations/YHistogramV2.tsx` is **2420 lines**. **Four divergent NaN-sanitization helpers** produce inconsistent JSON (`api/runs.py:120` coerces ints→float; `store_adapter.py` does not).

---

## Top risks (ranked, cross-validated)

| # | Sev | Area | Risk | Location(s) | Found by | Conf |
|---|-----|------|------|-------------|----------|------|
| 1 | **Critical** | Security | Updater skips checksum + arbitrary update source via unauth API → RCE at next launch | `api/update_downloader.py:148`, `api/updates.py:471,735` | Claude + Codex(be,arch) + Review | 🟢 |
| 2 | **Critical** | Security | No auth + CORS `*` exposes install/delete/export to any browser tab on localhost | `main.py:100`, `api/updates.py:1322`, `api/datasets.py:1036` | Claude + Codex(be) + Review | 🟢 |
| 3 | **Critical** | Security | Unauthenticated arbitrary `pip install` (supply-chain RCE) | `api/updates.py:1322`, `api/venv_manager.py:491` | Claude + Codex(be) + Review | 🟢 |
| 4 | **High** | Security | Unsafe `joblib`/pickle deserialization on absolute / `..` paths | `api/predictions.py:229,914`, `api/shap.py:669` | Claude + Codex(be) | 🟢 |
| 5 | **High** | Perf | Sync `pip install` / venv-create / `nirs4all.predict` / SHAP / PCA on the event loop | `api/venv_manager.py:518`, `api/updates.py:821`, `api/predictions.py:536`, `api/analysis.py:547` | Claude + Codex(be) + Review | 🟢 |
| 6 | **High** | Correctness | 4 endpoints **dead at runtime** (reference removed helpers) | `api/evaluation.py:662`, `api/predictions.py:907`, `api/shap.py:310`, `api/playground.py:1638` | Claude + Review (all 4 confirmed) | 🟢 |
| 7 | **High** | Boundary | `evaluation.py` loads raw `.joblib` + hand-rolls CV (leakage-prone) outside nirs4all | `api/evaluation.py:176,411,424`, vs `api/training.py:526` | Claude + Codex(be) + Review | 🟢 |
| 8 | **High** | Tests/CI | CI doesn't run on `master`; pytest never run; Vitest non-blocking; Playwright can't pass | `.github/workflows/ci.yml:7,45,88`, `playwright.yml` | Claude + Codex(arch) + Review | 🟢 |
| 9 | **High** | Build | Electron self-updater structurally broken; `electron-updater` absent | `updater/__init__.py:82`, `electron-builder.yml:22`, `package.json` | Claude + Codex(arch) + Review | 🟢 |
| 10 | **High** | Perf | Per-request `WorkspaceStore` + full-table scans for counts | `api/aggregated_predictions.py:182`, `api/store_adapter.py:239`, `api/dashboard.py:212` | Claude + Codex(be) | 🟢 |
| 11 | **High** | FE Perf | `SpectraWebGL` 60 fps idle loop, not memoized; scatter renderers loop at 60 fps while idle | `SpectraWebGL.tsx:1780,1919`, `scatter/ScatterRegl2D.tsx:607` | Claude + Codex(fe) | 🟢 |
| 12 | **High** | FE Perf | Playground transform cache broken: random operator IDs in hash keys | `src/lib/playground/hashing.ts:72`, `operatorFormat.ts:231` | Codex(fe) | 🔵 |
| 13 | **High** | Build/Deps | CPU release packaging never installs `nirs4all` (comment-only line) | `.github/workflows/electron-release.yml:128`, `requirements-cpu.txt:25` | Codex(review) | 🔵 |
| 14 | **Med** | Security | Zip-Slip in workspace import + update extraction | `api/workspace.py:751`, `api/update_downloader.py:240` | Claude | 🔵 |
| 15 | **Med** | DoS | Unbounded `PredictBatchRequest.spectra`, converted+predicted inline | `api/predictions.py:88,593` | Codex(review) | 🔵 |

> **Severity note:** Claude's adversarial verifiers capped the security items at "High"; in the realistic desktop threat model (a localhost server reachable by any browser tab the user opens), the CORS-`*` + unauth-`pip install` + unverified-updater chain is **Critical** — it yields code execution with no user interaction beyond visiting a page. Codex's review independently concluded the roadmap should hit API hardening *first*. This document promotes that cluster to Critical accordingly.

---

## Consolidated findings by theme

### A. Performance bottlenecks 🟢

- **Event-loop blocking (systemic).** 261 `async def`, one offload site. Offenders: sync `pip install`/venv-create/`pip list` (`api/venv_manager.py:424,518,570` ← `api/updates.py:821,1343`); inline `nirs4all.predict()` + `_load_dataset` (`api/predictions.py:536,597,666,687`); spectra load + `fit_transform` on the most-clicked panels (`api/spectra.py:260,355,462,541,595,682`); `joblib.load` + `permutation_importance(n_jobs=-1)` + PCA/t-SNE/UMAP `fit_transform` (`api/analysis.py:254,394,438,547`); `evaluation.py` `cross_val_score`/`cross_val_predict` (`api/evaluation.py:427,433`). **Fix:** route long subprocess work through `JobManager` (it already has `UPDATE`/`VENV` job types); wrap CPU/sync calls in `asyncio.to_thread`; cap analysis input sizes and concurrency.
- **Per-request store + full scans.** New `WorkspaceStore`/`WorkspaceScanner` per call (`api/aggregated_predictions.py:182`, `api/workspace.py:1628,1762,1806,1952,2204`; 3× per `get_dashboard()` `api/dashboard.py:212`). Counts/breakdowns load the whole table into Python (`api/store_adapter.py:178,239`). **Fix:** reuse the long-lived `StoreAdapter` on the `workspace_manager` singleton; add SQL `COUNT(*)`/`GROUP BY`; run via `to_thread`. _(🟠 store is closed in `finally`; the "atexit leak / 21 DDL" specifics are unverified — drop that wording.)_
- **Legacy parquet path.** Glob + `pd.read_parquet` + `groupby` inline with only a 5 s TTL (`api/workspace.py:1663,1667,1970,1977`, TTL `:34`); reads every parquet before paginating (`:1996-2041`). **Fix:** push columns/filter/limit into pyarrow/polars; materialize run summaries; invalidation-based cache.
- **JobManager** fixed at 4 workers, no backpressure/queue bound, shared by 9 job types (`api/jobs/manager.py:102,160`). **WS** re-serializes `to_json()` per subscriber (`websocket/manager.py:268`) with an `asyncio.run()` fallback (`api/jobs/manager.py:405`). **Fix:** configurable workers + queue-depth metric; serialize once + throttle progress; capture the app loop at startup and use `run_coroutine_threadsafe`.
- **Unbounded module-level `_dataset_cache`** never evicted on workspace switch (`api/spectra.py:47`; `activate_workspace` `api/workspace.py:1554` doesn't clear it) — and **not invalidated on dataset-config update** (`PUT /datasets/{id}` `api/datasets.py:992` vs cached IDs `api/spectra.py:264`, Codex-review gap). **Fix:** LRU bound + explicit eviction on activate/update.
- **Frontend render perf:** `frameloop='always'` + per-frame projection (`SpectraWebGL.tsx:1780,1201`); `SpectraWebGL`/`RepetitionsChart` not memoized (`:1919`, `RepetitionsChart.tsx:1580`); memoized charts defeated by fresh `Set`/object props (`MainCanvas.tsx:947`); WebGL geometry rebuilt on every selection click (`SpectraWebGL.tsx:1712,338`); scatter WebGL/regl loops render at 60 fps while idle and re-draw the pick buffer every frame (`scatter/ScatterRegl2D.tsx:567,607`); O(lines×points) hover hit-testing per mousemove (`SpectraWebGL.tsx:1074-1117`); `Math.min(...hugeArray)` stack-overflow risk (`YHistogramV2.tsx:351`, `FoldDistributionChartV2.tsx:690`). **Fix:** `frameloop='demand'` + `invalidate()`; memo wrappers; stable props; rAF-throttled + thresholded hover; loop-based `minMax()`.
- **Data fetching:** several pages bypass React Query (`DatasetDetail.tsx:64`, `useSpectralData.ts:91`, `api/playground.ts:242`) → full reload per navigation; global QueryClient lacks `refetchOnWindowFocus/Reconnect:false` (`src/main.tsx:26`); duplicate polling alongside WS invalidation (`ActiveRunContext.tsx:87` @3 s, `RunProgress.tsx:702` @1 s); under-specified query keys can serve wrong cached results (`useReferenceDatasetQuery.ts:98`). **Fix:** migrate page loaders to `useQuery` with long `staleTime`/`gcTime`; let WS drive progress; include dataset id/version + content hash in keys.

### B. Architecture & boundary violations 🟢

- **Dead-at-runtime + boundary (the worst cluster):** `evaluation/run` loads `.joblib` & runs raw `model.predict` though only `.n4a` is written (`api/evaluation.py:176,221` vs `api/training.py:526`); `evaluation/crossval` imports nonexistent `_get_model_instance` and fits preprocessing on full X before `KFold` — dead **and** leakage-prone (`api/evaluation.py:411,424,662`); `predictions.py` confidence/explain import removed `get_loaded_model` and reimplement importance as a single-feature ±1σ perturbation (`api/predictions.py:907,1064,1082`); `shap.py` calls undefined `ShapAnalyzer` + `joblib.load`s directly (`api/shap.py:33,310,719`); `playground.py /metrics/outliers` calls nonexistent `MetricsComputer.get_outlier_mask` (`api/playground.py:1638`). `metrics_computer.py` reaches into **private** `XOutlierFilter._distances_` with a bare `except: return None` (`api/shared/metrics_computer.py:351,355`). `automl.py` hardcodes sklearn model/transformer maps + raw `KFold` (`api/automl.py:631,714,829`). `spectra.py` reimplements CSV delimiter detection (`api/spectra.py:207`) though `datasets.py:448` already uses nirs4all `AutoDetector`. **Fix:** route through `nirs4all.predict()/run()/explain()`/`ShapAnalyzer`/`instantiate_filter`; request a public `get_scores(X)` for filter distances; delete home-grown code.
- **`api_cleaning.md` is partly stale** (both systems agree): filters/training/models/single-predict are already remediated (`api/filter_operators.py:18`, `api/training.py:462`, `api/models.py:31`, `api/predictions.py:536`). Treat it as historical; the live debt is the dead cross-references above. **Add an import-smoke test.**
- **Frontend architecture:** 4 divergent "is Electron" predicates with no shared module (`src/api/client.ts:21`, `src/lib/websocket.ts:81`, `src/main.tsx:7`, `src/utils/fileDialogs.ts:9`); `ActiveRunContext` hand-builds its WS URL from `window.location.host` → `ws:///ws` in Electron (`ActiveRunContext.tsx:105`); module-level cache pins the `/api` failure fallback permanently (`src/api/client.ts:13,83`); `client.ts` god-module (138 fns / 43 interfaces / 18 domains); a dual `AxiosLikeClient` kept "for backward compatibility" used in exactly one file (`src/api/client.ts:231`); `SelectionContext`'s `useSyncExternalStore` selector store has **0 consumers** while 22 sites use coarse `useSelection()` → every selection re-renders WebGL charts; `ActiveRunContext` value built inline, mounted app-wide, re-renders all consumers each 3 s poll/WS tick; Playground prop-drills ~50 props into `PlaygroundContent` / ~29 into `MainCanvas`. **Fix:** `src/lib/runtime.ts` (single `isElectron`/`waitForElectronApi`/`getApiBaseUrl`/`getWebSocketBaseUrl`); cache only success; adopt or delete the selector store; split read/write contexts; introduce a `PlaygroundPipelineContext`.

### C. Backend technical debt 🟢

- **~730 LOC of fully dead, rule-violating code** in `api/workspace_manager.py:1122-1856` (`DatasetRegistry`/`SchemaMigrator`/`RunManager`). Delete, then split the 2772-line, 7-class god-file into `workspace_manager.py` + `workspace_scanner.py`.
- **335 broad `except Exception`, ~63 with bare `pass`** (e.g. `api/nirs4all_adapter.py:768`, `api/pipelines.py:499,1117`); **~106 `print()` diagnostics, no module loggers, no logging config in `main.py`**; **19 endpoints leak raw exception text into HTTP 500 detail** echoed to the renderer (`api/datasets.py:474`, `api/analysis.py:440`, `main.py:72`). **Fix:** narrow exceptions + `logging.getLogger` per module + a generic 500 handler with error codes.
- **Four divergent NaN-sanitizers** with behavioral drift (`api/runs.py:114,120,384`, `api/store_adapter.py:27`, `api/aggregated_predictions.py:129`) → consolidate into `api/shared/json_sanitize.py`. **Two "known user error" catalogs** already diverged (regex `api/runs.py:128` vs substring `api/telemetry.py:111`) → one shared catalog.
- **Oversized functions:** `_execute_pipeline_training` 466 LOC (`api/runs.py:885`), `PlaygroundExecutor.execute` 240 (`api/playground.py:194`), `_compute_repetition_analysis` 227 (`api/playground.py:833`). **Dead introspection endpoints** with no callers (`api/pipelines.py:974-1170`). **45 inline no-workspace guards** (replace with a `require_workspace()` dependency). **88% of route handlers lack return-type annotations**; no mypy config.

### D. Frontend technical debt 🟢

- **i18n drift:** entire `shap.*` and `analysis.transfer.*` namespaces exist in `en` but are missing from `fr`/`de` (`src/locales/en/index.ts:850,832`), plus an orphan `fr` key (`:258`). No parity gate. **Dead component** `ScatterWebGL.tsx` (732 LOC, exported, never instantiated). **Backward-compat shim** `NodeRegistryContext.tsx` re-exporting `.v2` (violates the no-shim rule). **Vestigial `V2` naming + "Phase N" comments** with no V1 counterparts.
- **God-components:** `YHistogramV2.tsx` (2420), `pipelineConverter.ts` (1773), `client.ts` (2126), pipeline-editor triple (`usePipelineEditor.ts` 927 + `PipelineEditor.tsx` 1124 + `types.ts` 1085). **163 ungated `console.*`** + `memoryMonitor.ts` polling heap and exposing itself on `window` (`:257,315`). **Competing scatter renderer families** (Pure WebGL vs Regl, 2D+3D, ~3415 LOC) kept identical by hand with a copied `calculateBounds` + "must match" comment. **Dead UI controls:** "Delete predictions" only toasts "not supported" (`Predictions.tsx:324`); "Backup Now" is a no-op (`WorkspaceStats.tsx:284`). **Untyped escape hatches:** `window.__scatter3d_reset` + `as any` (`ScatterPlot3D.tsx:473`). **Fix:** logger + ESLint `no-console`; pick one scatter backend; extract pure compute into hooks; locale-parity CI gate.

### E. Security 🟢 (desktop/local threat model)

- **Auto-update integrity bypass → RCE** (#1 above): `checksum_sha256` never populated (`api/updates.py:489-520`), `verify_checksum` returns `True` when absent (`api/update_downloader.py:148`), `github_repo` settable via unauth `PUT /api/settings` (`api/updates.py:471,735`). **Mandate signed-checksum verification (fail closed); pin the repo.**
- **No auth + CORS `*`** (`main.py:100`) over a browser-reachable localhost server. **Restrict origins to the renderer/dev origin; add a startup-generated bearer token on mutating routes; gate `/updates/*`, install/uninstall, dataset-delete-with-files, and `/webapp/apply`.**
- **Arbitrary `pip install`** (`api/updates.py:1322` → `api/venv_manager.py:491`, honors URL/VCS/local specifiers). **Allowlist + PEP440 version regex + token.**
- **Unsafe deserialization / path traversal:** `_resolve_model_path` accepts absolute paths (`api/predictions.py:229`); `_load_model` builds unguarded `models/{id}.joblib` (`:914`); `shap.py` treats `model_id` as a raw path (`api/shap.py:669`); dataset/workspace/spectra endpoints accept arbitrary absolute paths with no containment (`api/datasets.py:311`, `api/workspace.py:142`, `api/spectra.py:208`); deprecated prediction IDs concatenate unvalidated into paths (`api/predictions.py:262,398`, Codex-review gap). **Single realpath-containment helper; reject absolute/`..`.**
- **Zip-Slip:** `zf.extract(item, dest)` with no member validation (`api/workspace.py:751`, `api/update_downloader.py:240`) — contrast the safe `tar.extract(..., filter="data")` at `:222`. **Destructive `shutil.rmtree`** unauth on a stored path (`api/datasets.py:1036`). **Custom-node `classPath` never validated** against its stored `allowedPackages` allowlist (`api/workspace_manager.py:2315`). **Base64-decoded workspace-ID → arbitrary path** read/limited-write (`api/workspace.py:1359`, `api/workspace_manager.py:2232`). **Electron IPC** exposes `shell.openExternal` with arbitrary URLs + `sandbox:false` (`electron/preload.ts:37`, `electron/main.ts:78,183`, Codex-review gap).

### F. Tests, build & dependencies 🟢

- **CI:** add `master` trigger (`ci.yml:7`); remove Vitest `continue-on-error` (`:45`); add a `pytest -m "not slow"` job (backend CI only runs `py_compile`/import checks, `:88`, and never installs `requirements-test.txt`); provision Python/venv in `playwright.yml`; wire the node-registry snapshot guard (`package.json:54`) into CI. **No ruff/mypy/`pyproject.toml`** — the documented Python green gate doesn't exist. ESLint is `recommended` (not type-checked), `no-unused-vars: off`, no `--max-warnings 0`. **No coverage measurement** on either side.
- **Highest-value test gaps:** `nirs4all_adapter.py` (1210 LOC bridge, pure dict transforms) has **zero direct tests**; `client.ts` (2126) untested; `pipelineConverter.ts` (1773) has only a 327-line test missing generator/finetuning round-trips; integration suites exist but never run in CI.
- **Build/packaging:** Electron self-updater mismatched to `asar` package, `electron-updater` absent (#9); **two divergent PyInstaller specs** — `nirs4all-studio.spec:228` references a nonexistent `launcher.py` (and `scripts/build.py:156` points at it); **orphaned NSIS installer** with a missing `icon.ico` (`installer/nsis/nirs4all-studio.nsi:53`); **no manual chunking / `React.lazy`** — three.js/drei/fiber/regl/recharts in one bundle, ~3.9 MB main JS chunk, 17 statically-imported pages (`vite.config.ts:117`, `src/App.tsx`); `console=True` in `backend.spec:223` (stray Windows console); launcher's broad `pkill -f electron|vite|esbuild` can kill unrelated apps (`scripts/launcher.sh:164`); sourcemaps emitted only conditionally → unsymbolicated Sentry.
- **Dependencies:** floor-only (`>=`) requirements, **no lockfile/hashes** (non-reproducible builds); **CPU release packaging never installs `nirs4all`** (`electron-release.yml:128` + comment-only `requirements-cpu.txt:25`, Codex-review gap); **GPU flavor installs no GPU stack** yet ships `-gpu`-suffixed artifacts (`requirements-gpu.txt`); GPU release continues after `pip install nirs4all[gpu] || echo ... continuing`; **`version.json` decoupled** from the build (reports `1.0.0`/`development`); `engines.node ">=20"` vs `.nvmrc 22`; **Electron 40 near EOL (2026-06-30)**.

---

## Calibration & corrections (from the Codex review of Claude's audit)

The Codex reviewer validated the major risks and corrected these overstatements — incorporated above:

| Original Claude claim | Correction |
|---|---|
| "Only 2 of ~261 async handlers offload" + cites `api/predictions.py:510` | Count is right (261), but the **only real offload is `update_downloader.py:227,245`**; `predictions.py:510` is **not** an offload site (mis-attribution). |
| Per-request store "leaks `atexit` + runs 21 DDL" | Store **is** closed in `finally` (`api/aggregated_predictions.py:220`); the leak/DDL specifics depend on library internals and are **unverified**. The churn itself is real. |
| One bullet: "`analysis.py:497`/`shap.py` correctly call `nirs4all.explain()`" | Only **`analysis.py:497`** does. `shap.py` is the **broken** one (undefined `ShapAnalyzer` + `joblib.load`). |
| "No React Query caching on pages" | Overbroad — RQ **is** used (`Runs.tsx:256`, `useDashboard.ts:22`); restate as "**specific** high-traffic pages bypass it". |
| "CI never runs on the live branch" | `ci.yml` misses `master`, but **Playwright targets `master`** (`playwright.yml:4`) — though it still can't pass (no venv). |
| Electron updater "targets the PyInstaller exe" | Mismatch is real, but the packaged backend is **`nirs4all-backend`**; the Python updater relaunches **`nirs4all-studio`** (`updater/__init__.py:82`). |

The "dead at runtime" claims (the highest-impact correctness findings) were **all independently confirmed TRUE** by the reviewer.

## Additional gaps surfaced only by the Codex review (incorporated above)

`sys.path.insert(0, ../nirs4all)` sibling-checkout reliance (`api/workspace_manager.py:30`) · optional-import guard catches only `ImportError`, so a non-import failure crashes backend startup (`:29`) · Electron backend fallback uses wrong venv path `process.cwd()/../.venv` (`electron/backend-manager.ts:86`) · `ActiveRun` WebSocket cleanup runs on every map replacement (`ActiveRunContext.tsx:268`) · unbounded `PredictBatchRequest` (DoS, `api/predictions.py:88,593`) · dataset-config update doesn't invalidate the spectra cache (`api/spectra.py:264` vs `api/datasets.py:992`) · prediction-ID path escape (`api/predictions.py:262,398`) · Electron `openExternal` + `sandbox:false`.

---

## Unified roadmap (Claude + Codex)

Re-prioritized per the Codex review: **security hardening goes first** (closes an active RCE/destructive surface before any cleanup). Effort: **S** ≤1 day · **M** days · **L** ~1–2 weeks · **XL** multi-week.

### Phase 0 — Stop the bleeding (security + gates, days)

1. **Lock down the local API.** Restrict CORS to the renderer/dev origin; add a startup-generated bearer token required on all mutating routes; gate `/updates/*`, dependency install/uninstall, dataset-delete-with-files, and `/webapp/apply`. — `main.py:100`, `api/updates.py`, `api/datasets.py:1036` — **M** (Risks #1–3)
2. **Make the updater fail-closed:** require a signed SHA-256 (`verify_checksum` must reject when absent); pin `github_repo` to a constant; restrict `download_url` host. — `api/update_downloader.py:148`, `api/updates.py:471` — **M** (Risk #1)
3. **Containment helper** (single realpath check) before every `rmtree`/`extract`/model-load/path-join; add Zip-Slip member validation; reject absolute/`..` model & prediction IDs. — `api/datasets.py:1036`, `api/workspace.py:751`, `api/predictions.py:229,262`, `api/shap.py:669` — **M** (Risks #4, #14)
4. **Fix CI gates:** add `master`; remove Vitest `continue-on-error`; add a `pytest -m "not slow"` job that installs `requirements-test.txt`; add an **import-smoke test that imports every router and resolves cross-module helpers** (catches all 4 dead endpoints); provision Python in `playwright.yml`. — `.github/workflows/*` — **S/M** (Risks #6, #8)
5. **Bound `pip install`** to an allowlist + PEP440 version regex. — `api/venv_manager.py:491` — **S** (Risk #3)

### Phase 1 — Make it work & feel fast (high-impact, ~weeks)

6. **Fix the dead/boundary endpoints together:** route `evaluation` run/crossval, `predictions` confidence/explain, `shap`, and `playground /metrics/outliers` through `nirs4all.predict()/run()/explain()`/`ShapAnalyzer`/`instantiate_filter`; delete the home-grown sklearn/SHAP/importance/CV code. — `api/evaluation.py`, `api/predictions.py`, `api/shap.py`, `api/playground.py` — **L** (Risks #6, #7)
7. **Stop blocking the loop:** move `pip install`/venv-create through `JobManager`; wrap `nirs4all.predict`, `_load_dataset`, preprocessing, `permutation_importance`, PCA/UMAP, and SQLite/polars reads in `asyncio.to_thread`. — `api/updates.py:821`, `api/venv_manager.py:518`, `api/predictions.py:536`, `api/spectra.py:355`, `api/analysis.py:547` — **M** each (Risk #5)
8. **Reuse a long-lived `StoreAdapter`** instead of per-request stores; replace full-table counts with SQL `COUNT`/`GROUP BY`; bound/evict `_dataset_cache` (LRU + clear on workspace activate **and** dataset-config update). — `api/aggregated_predictions.py:182`, `api/store_adapter.py:239`, `api/spectra.py:47` — **M** (Risk #10)
9. **Frontend perf:** `frameloop='demand'` + `invalidate()` in `SpectraWebGL`; `React.memo` the unmemoized charts; switch scatter renderers to invalidation-driven; rAF-throttle + threshold hover hit-testing; **remove the transient `id` from cache-hash keys** + batch operator restore; migrate `DatasetDetail`/`useSpectralData` to React Query; add `refetchOnWindowFocus/Reconnect:false`; let WS (not polling) drive run progress. — `SpectraWebGL.tsx`, `src/lib/playground/hashing.ts:72`, `useSpectralData.ts`, `src/main.tsx:26` — **M** combined (Risks #11, #12)
10. **Fix packaging correctness:** make CPU/GPU release workflows install `nirs4all` (fatal on failure); stamp `version.json` from the release script; decide the desktop-update model (adopt `electron-updater`, or scope the Python updater to the in-venv library only) and delete the dead PyInstaller spec / `scripts/build.py` / NSIS installer; set `console=False`; require an installed/editable `nirs4all` (drop the `/home/delete` `sys.path.insert` fallback). — `electron-release.yml`, `updater/__init__.py`, `nirs4all-studio.spec`, `api/workspace_manager.py:30` — **L** (Risks #9, #13)

### Phase 2 — Pay down structural debt

11. Delete the ~730 LOC dead code in `workspace_manager.py`; split it into manager + scanner. Delete `ScatterWebGL.tsx`, the `NodeRegistryContext` shim, and the dead introspection endpoints. — **S/M**
12. Consolidate the 4 NaN-sanitizers into `api/shared/json_sanitize.py`; add a `require_workspace()` dependency for the 45 inline guards; add a generic 500 handler so paths stop leaking. — **M/L**
13. `src/lib/runtime.ts` (one Electron/URL/WS resolver, typed `window.electronApi`, cache only success); split `client.ts` per domain + delete `AxiosLikeClient`. — **L**
14. Add `pyproject.toml` + ruff + mypy (non-blocking → ratchet); upgrade ESLint to `recommendedTypeChecked` + `--max-warnings 0`; enable Vitest + pytest coverage with a ratcheting floor; add a hash-pinned Python lockfile (pip-compile/uv). — **M/L**
15. Add Vite `manualChunks` (react / recharts / three+fiber+drei / regl) + route-level `React.lazy`; add a bundle-size CI budget. — **M**

### Phase 3 — Longer-term quality

16. Decompose the frontend god-components (`YHistogramV2`, `pipelineConverter`, the pipeline-editor triple) into hooks/per-domain modules. — **L/XL**
17. Consolidate the competing scatter renderer families onto one backend; adopt the `SelectionContext` selector store (or delete it) + split read/write contexts; remove the ~50-prop Playground drilling via a `PlaygroundPipelineContext`. — **L**
18. Narrow the 335 broad excepts (+ ruff BLE001/S110); replace `print()`s with module loggers; DEV-gated frontend `logger.ts` + ESLint `no-console`. — **L**
19. Add the i18n locale-parity gate + backfill `fr`/`de`; push code generation (`export_pipeline_to_python`), reference-dataset alignment, AutoML operator maps, and the private-attribute spectral metrics **down into `nirs4all`/`nirs4all-io`** (request public APIs) so Studio stops duplicating library knowledge. — **M/L**
20. Plan the **Electron major upgrade** (40 → current supported) as a release-blocking task before 2026-06-30 EOL. — **M**

---

## Appendix — raw reports

- [`docs/audit/2026-06-04/01_claude_audit.md`](docs/audit/2026-06-04/01_claude_audit.md) — Claude synthesized audit
- [`docs/audit/2026-06-04/01_claude_findings.json`](docs/audit/2026-06-04/01_claude_findings.json) — all 113 verified findings (structured)
- [`docs/audit/2026-06-04/02_codex_backend.md`](docs/audit/2026-06-04/02_codex_backend.md) — Codex backend audit
- [`docs/audit/2026-06-04/03_codex_frontend.md`](docs/audit/2026-06-04/03_codex_frontend.md) — Codex frontend audit
- [`docs/audit/2026-06-04/04_codex_crosscutting.md`](docs/audit/2026-06-04/04_codex_crosscutting.md) — Codex build/deps/tests/CI audit
- [`docs/audit/2026-06-04/05_codex_review_of_claude.md`](docs/audit/2026-06-04/05_codex_review_of_claude.md) — Codex's review of Claude's audit
