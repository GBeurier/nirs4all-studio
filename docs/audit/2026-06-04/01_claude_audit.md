### Executive summary

- **The async surface is a façade: heavy work runs on the event loop.** Only 2 of ~261 async handlers offload blocking work (`api/predictions.py:510`, `api/update_downloader.py:227`). Synchronous pip installs block the loop for up to 15 minutes (`api/venv_manager.py:518`, `api/updates.py:821`); `nirs4all.predict()`, dataset loads, and SQLite work all run inline (`api/predictions.py:536`, `api/spectra.py:355`, `api/aggregated_predictions.py:182`). This is the single largest driver of the "desktop app feels frozen" complaint.
- **The "thin orchestration layer" rule is broken in the worst-affected modules, and several of those reimplementations are already dead at runtime.** `evaluation.py`, `predictions.py`, and `shap.py` load raw `.joblib`, re-apply preprocessing, and hand-roll cross-validation / SHAP binning / feature importance — bypassing the bundle pipeline and producing scientifically wrong, leakage-prone results. Worse, they reference helpers that no longer exist (`_get_model_instance` at `api/evaluation.py:662`, `get_loaded_model` at `api/predictions.py:907`, `ShapAnalyzer` at `api/shap.py:310`, `get_outlier_mask` at `api/playground.py:1638`) — every one raises `ImportError`/`NameError`/`AttributeError` on call. A CI import-smoke test would have caught all of them.
- **The desktop app ships an unauthenticated, CORS-`*` local API exposing destructive and code-execution endpoints.** `main.py:100` sets `allow_origins=["*"]` with no auth; any web page the user visits can drive arbitrary `pip install` (`api/updates.py:1322`), `shutil.rmtree` (`api/datasets.py:1036`), and pickle-based model loads (`api/predictions.py:914`). The auto-updater verifies no checksum (`api/update_downloader.py:148`) and accepts an attacker-set GitHub repo (`api/updates.py:471`) — remote code execution at next launch.
- **The Electron self-update path is structurally broken and cannot work.** The Python self-updater targets a PyInstaller exe (`updater/__init__.py:82`) that the `asar`-packed Electron build never produces (`electron-builder.yml:22`); `electron-updater` is not even a dependency. At best the feature no-ops, at worst it corrupts the install.
- **CI does not run on the live branch and its gates are decorative.** `ci.yml:7` triggers on `main`/`develop` but the default branch is `master`; pytest is never invoked in any workflow; vitest runs with `continue-on-error: true` (`ci.yml:45`); the only `master`-targeting workflow (Playwright) can never pass because it provisions no Python venv (`playwright.yml:12-21`).
- **Per-request resource churn on hot endpoints.** Every dashboard/predictions call opens a fresh `WorkspaceStore` (new SQLite connection + 21 DDL statements + leaked `atexit.register`) instead of the cached adapter (`api/aggregated_predictions.py:182`, `api/workspace.py:1628`), and full prediction tables are scanned in Python just to count rows (`api/store_adapter.py:239`).
- **Frontend: a continuous 60 fps render loop plus pervasive cache-less refetching.** `SpectraWebGL` runs `frameloop='always'` forever (`SpectraWebGL.tsx:1780`) and is not even `React.memo`-wrapped (`SpectraWebGL.tsx:1919`); list/detail pages refetch via raw `useState`/`useEffect` with zero React Query caching (`DatasetDetail.tsx:64`, `useSpectralData.ts:91`), re-downloading large NIRS matrices on every navigation.
- **God-files and dead code inflate the change surface.** `workspace_manager.py` is 2772 lines holding ~730 lines of fully dead, rule-violating code (`api/workspace_manager.py:1122-1856`); `src/api/client.ts` is a 2126-line module mirroring all routers; and four duplicated NaN-sanitization helpers produce divergent JSON contracts (`api/runs.py:120` coerces ints to float, `store_adapter.py` does not).

### Top risks (ranked)

| # | Severity | Area | Finding | Location | Fix | Effort |
|---|---|---|---|---|---|---|
| 1 | High | Security | Auto-update skips checksum verification + arbitrary update source via API → RCE at next launch | `api/update_downloader.py:148`, `api/updates.py:471` | Mandatory signed-checksum verification; pin `github_repo` | M |
| 2 | High | Security | No auth + CORS `*` exposes install/delete/export to any local web page | `main.py:100`, `api/updates.py:1322`, `api/datasets.py:1036` | Restrict origins; per-session bearer token on mutating routes | M |
| 3 | High | Security | Unauthenticated arbitrary `pip install` (supply-chain RCE) | `api/updates.py:1322`, `api/venv_manager.py:447` | Allowlist packages + PEP440 version regex + token | M |
| 4 | High | Security | Unsafe `joblib`/bundle deserialization on attacker-influenced/absolute paths (pickle RCE) | `api/predictions.py:914`, `api/shap.py:669` | Resolve model_id inside workspace; reject path traversal/absolute | M |
| 5 | High | Performance | Synchronous pip install (`subprocess`) runs inside async route, freezes loop for minutes | `api/updates.py:821`, `api/venv_manager.py:518` | Route through `JobManager` or `asyncio.to_thread` | M |
| 6 | High | Performance | Per-request `WorkspaceStore` (new SQLite conn + DDL + leaked `atexit`) on hot endpoints | `api/aggregated_predictions.py:182`, `api/workspace_manager.py:152` | Reuse cached `StoreAdapter`; run via `to_thread` | M |
| 7 | High | Boundary | `evaluation.py` loads raw `.joblib` + re-runs prediction/CV outside nirs4all; broken import → dead endpoints | `api/evaluation.py:183`, `api/evaluation.py:662` | Route through `nirs4all.predict()`/`run()`; delete sklearn paths | M |
| 8 | High | Boundary | `predictions.py`/`shap.py` confidence/explain/SHAP reference removed helpers (`ImportError`/`NameError`) and reimplement SHAP/importance | `api/predictions.py:907`, `api/shap.py:310` | Use `nirs4all.explain()`/`ShapAnalyzer`; delete home-grown methods | M |
| 9 | High | Build/deps | Electron self-updater targets a PyInstaller exe the `asar` build never produces | `updater/__init__.py:82`, `electron-builder.yml:22` | Adopt `electron-updater`; scope Python updater to in-venv lib only | L |
| 10 | High | Tests/CI | CI triggers on `main`/`develop` but default branch is `master` → no gates on PRs | `.github/workflows/ci.yml:7` | Add `master` to trigger branches | S |
| 11 | High | Tests/CI | pytest never run in CI; vitest `continue-on-error: true`; Playwright job has no venv | `ci.yml:45`, `playwright.yml:12-21` | Add pytest job; remove `continue-on-error`; provision Python | M |
| 12 | High | Frontend perf | `SpectraWebGL` runs 60 fps loop forever and is not `React.memo`-wrapped | `SpectraWebGL.tsx:1780`, `SpectraWebGL.tsx:1919` | `frameloop='demand'` + `invalidate()`; wrap in `React.memo` | M |

### Performance bottlenecks

- **Synchronous pip install on the event loop** — `venv_manager.install_package` uses `subprocess.Popen(...).communicate(timeout=900)` (`api/venv_manager.py:518`) and `create_venv` blocks on `subprocess.run(timeout=120)` (`api/venv_manager.py:424`), both called bare from `async def install_nirs4all`/`install_dependency` (`api/updates.py:821`, `api/updates.py:1343`). `get_installed_packages` adds a 30 s blocking `subprocess.run` (`api/venv_manager.py:570`). Route through `JobManager` (it already has `UPDATE`/`VENV` job types) like `start_webapp_download` (`api/updates.py:866`).
- **Per-request `WorkspaceStore` churn** — `_get_store()` returns a new `WorkspaceStore` per call (`api/aggregated_predictions.py:182`); each opens a SQLite connection, runs 21 DDL statements, and calls `atexit.register(self.close)` without `atexit.unregister` (leak). All five endpoints run synchronous SQLite/polars on the loop. The reusable `workspace_manager.scanner.store_adapter` (`api/workspace_manager.py:152`) is bypassed. Same pattern in `api/workspace.py:1628/1762/1806/1952/2204` and three scanners per `get_dashboard()` (`api/dashboard.py:212`).
- **Full-table scans for counts/breakdown** — `query_predictions` is called with no `limit` then counted/aggregated in Python (`api/store_adapter.py:178`, `api/store_adapter.py:239`); pagination provides no relief. Use SQL `COUNT(*)`/`GROUP BY` in `WorkspaceStore`.
- **Synchronous `nirs4all.predict()` in async routes** — `predict_single/batch/dataset` call `nirs4all.predict(...)` and `_load_dataset` inline (`api/predictions.py:536/597/687/666`); no `asyncio` import in the file. Uvicorn runs a single worker (`main.py:359`). Wrap in `asyncio.to_thread`.
- **Synchronous dataset load + preprocessing in every spectra route** — `_load_dataset` (`api/spectra.py:260`) and `_apply_preprocessing_chain` → `fit_transform` (`api/spectra.py:682`) run on the loop for the most-clicked panels (`api/spectra.py:355/462/541/595`).
- **`joblib.load` + `permutation_importance(n_jobs=-1)` inline in analysis/evaluation** — `api/analysis.py:547`, `api/analysis.py:539/578`, `api/evaluation.py:183`; pins a core for seconds-minutes and fights uvicorn for cores. Offload or route through `JobManager`.
- **Bootstrap/jackknife confidence loops** — thousands of sequential `model.predict` calls on the loop (`api/predictions.py:957/1001/1038/1064`); note these endpoints are currently unreachable from the frontend (dead).
- **Legacy parquet glob + `pd.read_parquet` + `groupby` inline** — `api/workspace.py:1663/1667`, `api/workspace.py:1970/1977`; 5 s TTL cache (`api/workspace.py:34`) only helps repeat hits.
- **Per-request `WorkspaceScanner` reopens and leaks the store** — `api/workspace.py:1628`; dashboard creates 3 scanners/connections per page load (`api/dashboard.py:76/212/252`).
- **Repeated recursive NaN/Inf sanitization per row** — Python per-cell walks at `api/store_adapter.py:183/236` and `api/aggregated_predictions.py:214/288`; vectorize at the polars level.
- **JobManager fixed at 4 workers, no backpressure/queue bound** — `api/jobs/manager.py:102/160`; all 9 job types share one pool; make worker count configurable and surface queue depth.
- **WS notify per progress tick** — `to_json()` re-serialized per subscriber (`websocket/manager.py:268`) and an `asyncio.run()` fallback path (`api/jobs/manager.py:405`); serialize once and throttle progress.
- **Unbounded module-level dataset cache** — `_dataset_cache` (`api/spectra.py:47`) never evicted on workspace switch (`activate_workspace` at `api/workspace.py:1554` does not call `_clear_dataset_cache`); bound with LRU.

Frontend:
- **Continuous 60 fps render loop** — `<Canvas>` defaults to `frameloop='always'` and `useFrame` recomputes the orthographic projection every frame (`SpectraWebGL.tsx:1780`, `SpectraWebGL.tsx:1201`).
- **Heaviest charts not memoized** — `SpectraWebGL` and `RepetitionsChart` export bare (`SpectraWebGL.tsx:1919`, `RepetitionsChart.tsx:1580`) while all four peer charts use `React.memo`.
- **Memoized charts defeated by fresh props** — new `Set`/object literals every render despite a memoized `outlierIndicesSet` already existing (`MainCanvas.tsx:947` vs `MainCanvas.tsx:547`); `SpectraChartV2` is `React.memo` with shallow comparison (`SpectraChartV2.tsx:1617`).
- **WebGL geometry rebuilt on selection** — `lines` useMemo depends on `selectedIndicesSet`/`pinnedIndicesSet` (`SpectraWebGL.tsx:1712`), tearing down/rebuilding per-color `BufferGeometry` (`SpectraWebGL.tsx:338`) on every click (hover is correctly decoupled).
- **No React Query caching on pages** — `DatasetDetail.tsx:64`, `Datasets.tsx`, `Predictions.tsx`, `Results.tsx`, and `useSpectralData.ts:91` re-fetch full datasets on every visit, defeating the configured 5-min `staleTime`.
- **Global QueryClient lacks refetch-storm guards** — `src/main.tsx:26` sets only `staleTime`/`retry`; no `refetchOnWindowFocus:false`/`refetchOnReconnect:false`.
- Lower-impact: per-action context-value recreation (`PlaygroundViewContext.tsx:369`, `SelectionContext.tsx:1033`), per-render `THREE.Color`/buffer allocation (`SpectraWebGL.tsx:594`), and double session-persist (`Playground.tsx:362` + `usePlaygroundPipeline.ts:55`).

### Architecture & boundary violations

Backend (the thin-layer rule, with several reimplementations already broken at runtime):
- **`evaluation.py /evaluation/run`** loads `.joblib` and runs raw `model.predict(X)` (`api/evaluation.py:183/221`), but training writes only `.n4a` bundles (`api/training.py:526`) and `_resolve_model_path` never searches `.joblib` (`api/predictions.py:237`) — 404s on every real model. Route through `nirs4all.predict()` + `eval_multi`.
- **`evaluation.py /evaluation/crossval`** imports a nonexistent `_get_model_instance` (`api/evaluation.py:662`) and fits preprocessing on full X before `KFold` (`api/evaluation.py:411` then `424`) — dead and leakage-prone. Express CV as a nirs4all splitter via `nirs4all.run`.
- **`predictions.py` confidence/explain** import a removed `get_loaded_model` (`api/predictions.py:907`) and reimplement importance as a single-feature +1σ perturbation (`_permutation_importance_single` at `api/predictions.py:1064`; `_gradient_importance` just delegates to it at `api/predictions.py:1082`) while `analysis.py:497`/`shap.py` correctly call `nirs4all.explain()`. Use `nirs4all.explain()`/`get_feature_importance()`.
- **`shap.py`** calls `ShapAnalyzer()` that is never imported → `NameError` (`api/shap.py:310/33`), reimplements bin aggregation (`api/shap.py:805`), and `joblib.load`s models directly (`api/shap.py:719`).
- **`playground.py /metrics/outliers`** calls `MetricsComputer.get_outlier_mask` which does not exist → `AttributeError` (`api/playground.py:1638`); reroute through `instantiate_filter('XOutlierFilter', ...)`.
- **`metrics_computer.py`** reaches into private `XOutlierFilter._distances_` (`api/shared/metrics_computer.py:351`) with a bare `except: return None` swallowing failures (`api/shared/metrics_computer.py:355`); request a public `get_scores(X)` on the nirs4all filter.
- **`automl.py`** hardcodes a 13-entry sklearn model map (`api/automl.py:631`), an 8-entry transformer map (`api/automl.py:829`), and raw sklearn `KFold` (`api/automl.py:714`) instead of `pipeline_service.resolve_operator` / nirs4all splitters.
- **`spectra.py`** reimplements single-line CSV delimiter detection (`api/spectra.py:207-227`) instead of nirs4all `AutoDetector` (already used in `api/datasets.py:448`).
- **`nirs4all_adapter.export_pipeline_to_python`** emits a fixed import header (`api/nirs4all_adapter.py:1000`) that omits operators like `CropTransformer`, producing non-runnable scripts.
- **Note:** `api_cleaning.md` "CRITICAL" claims for filters/metrics/training/models are already remediated (`api/filter_operators.py:18`, `api/training.py:462`, `api/models.py:31`); treat it as historical and add an import-smoke test that would catch the dead cross-references above.

Frontend architecture:
- **`ActiveRunContext` hand-rolls its WebSocket URL** from `window.location.host` (`ActiveRunContext.tsx:105`), yielding `ws:///ws` in Electron; should await `getWebSocketBaseUrl()` (`src/lib/websocket.ts:106`).
- **Four divergent "is Electron" predicates** with no shared module (`src/api/client.ts:21`, `src/lib/websocket.ts:81`, `src/main.tsx:7`, `src/utils/fileDialogs.ts:9`); create `src/lib/runtime.ts`.
- **Module-level mutable backend-URL cache** caches the failure fallback `/api` permanently (`src/api/client.ts:13/83`); cache success only and add a reset for tests.
- **Untyped `window.electronApi`** — `unknown` casts everywhere despite a declared global `Window.electronApi` (`src/main.tsx:7`, `electron.d.ts:151`).
- **`client.ts` god-module** — 2126 lines, ~138 functions + 43 interfaces across 18 domains (`src/api/client.ts:1-2126`); split per domain mirroring `playground.ts`/`shap.ts`.
- **Dual API clients** — `AxiosLikeClient` kept "for backward compatibility" used in exactly one file (`src/api/client.ts:231`, `src/hooks/usePipelineExecution.ts`); migrate and delete.
- **`SelectionContext` selector store is dead** — `useSyncExternalStore` hooks have 0 consumers; all 22 use coarse `useSelection()` (`SelectionContext.tsx:737`), so every selection re-renders WebGL charts. Adopt the selectors or delete the machinery.
- **`ActiveRunContext` builds its value inline** (no outer `useMemo`, `useCallback` inside the object literal) and is mounted app-wide (`ActiveRunContext.tsx:288`, `src/main.tsx:45`); re-renders all consumers on every 3 s poll/WS tick.
- **Playground prop-drills ~50 props** into `PlaygroundContent` and ~29 into `MainCanvas` despite available contexts, with a legacy `selectedSample` duplicating `SelectionContext` (`src/pages/Playground.tsx:423`, `MainCanvas.tsx:79`).
- **Reference-dataset compatibility/alignment runs client-side in TS** with a hardcoded 0.1 nm tolerance gating pipeline execution (`src/lib/playground/referenceDataset.ts:116`, `ReferenceDatasetContext.tsx:86`) — candidate nirs4all/nirs4all-io boundary concern.

### Backend technical debt

- **~730 lines of fully dead, rule-violating code** in `workspace_manager.py`: `DatasetRegistry`, `SchemaMigrator` (an explicit v1→v2 migration shim), `RunManager` — zero references outside their definitions (`api/workspace_manager.py:1122-1856`). Delete.
- **`workspace_manager.py` is a 2772-line, 7-class god-file** with the live singleton at the bottom (`api/workspace_manager.py:2772`); after deleting dead classes, split into `workspace_manager.py` + `workspace_scanner.py`.
- **Four divergent NaN-sanitization helpers** with real behavioral drift — `runs.py:120` coerces ints to float, `store_adapter.py:27` passes them through, `NaNSafeJSONEncoder` ignores ints (`api/store_adapter.py:27`, `api/aggregated_predictions.py:129`, `api/runs.py:114/384`). Consolidate into `api/shared/json_sanitize.py`.
- **`workspace.py` raw-data endpoint stacks three NaN cleaners** in one legacy-fallback function with double traversal and inline `import math/numpy` (`api/workspace.py:1996-2071`).
- **335 broad `except Exception`, ~63 with bare `pass`** swallowing failures silently (e.g. wrong variant count at `api/nirs4all_adapter.py:768`, type-hint introspection at `api/pipelines.py:499`, three import guards at `api/pipelines.py:1117`). Narrow types; log with `exc_info`.
- **Oversized functions** — `_execute_pipeline_training` (466 lines, `api/runs.py:885`), `PlaygroundExecutor.execute` (240, `api/playground.py:194`), `_compute_repetition_analysis` (227, `api/playground.py:833`). Extract `_build_progress_callbacks`/`_extract_run_metrics`.
- **Two drift-prone "known user error" definitions** — regex formatter (`api/runs.py:128`) vs substring matcher (`api/telemetry.py:111`), already diverged. Define one shared catalog.
- **Dead introspection endpoints** — `discover_operators`/`_discover_sklearn_operators`/`get_operator_details` hardcode an sklearn catalog with zero frontend callers (`api/pipelines.py:974-1170`); the UI uses only `/pipelines/operators` (`src/hooks/usePipelines.ts:82`).
- **19 endpoints leak raw exception text into HTTP 500 detail** (`api/datasets.py:474`, `api/analysis.py:440`, etc.), echoed to the renderer via `main.py:72`; centralize with a generic handler + error code.
- **~106 `print()` diagnostics, no module loggers** (`api/workspace_manager.py:39/163/380`); no logging config in `main.py`. Add per-module `logging.getLogger`.
- **45 inline no-workspace guards** with one `success=False`-in-200 outlier (`api/datasets.py:774`) and one wrong-status outlier (`api/workspace.py:981`); add a `require_workspace()` FastAPI dependency.
- **209/238 (88%) route handlers lack return-type annotations** (`api/workspace.py:343`, `api/pipelines.py:1058`); 74 already use `response_model=`. No mypy config exists.
- **Function-level inline imports** of `math`/`numpy`/`pandas`/`re` in hot paths and lazy cross-router imports masking a `runs↔pipelines↔spectra` circular dependency (`api/workspace.py:1998`, `api/runs.py:1100/1411/1434`).

### Frontend technical debt

- **i18n drift** — the entire `shap.*` and `analysis.transfer.*` namespaces exist in `en` but are missing from `fr`/`de` (`src/locales/en/index.ts:850`, `:832`), plus an orphan `fr` key (`src/locales/fr/index.ts:258`). No locale-parity CI gate. Add missing keys + a flatten-and-diff check.
- **Dead component** — `ScatterWebGL.tsx` (732 LOC) exported but never instantiated (`src/components/playground/visualizations/ScatterWebGL.tsx`, `index.ts:33`). Delete.
- **Backward-compat shim** — `NodeRegistryContext.tsx` re-exports `NodeRegistryContext.v2.tsx`, violating the no-shim rule (`NodeRegistryContext.tsx:1-10`). Rename over the shim.
- **Vestigial `V2` naming + "Phase N" comments** across the viz layer with no V1 counterparts (`visualizations/index.ts:4`, `SpectraChartV2.tsx`, `FoldDistributionChartV2.tsx:2`). Drop suffixes/comments.
- **God-components** — `YHistogramV2.tsx` (2420 LOC, largest in src), `pipelineConverter.ts` (1773, both conversion directions), `client.ts` (2126), and the pipeline-editor triple `usePipelineEditor.ts` (927) + `PipelineEditor.tsx` (1124) + `types.ts` (1085). Extract pure computation into hooks/per-domain modules.
- **163 ungated `console.*` calls**, no logger abstraction; `memoryMonitor.ts` dumps heap in a polling interval and exposes itself on `window` (`src/lib/playground/memoryMonitor.ts:257`, `:315`). Add a DEV-gated `src/lib/logger.ts` + ESLint `no-console`.
- **Competing scatter renderer families** — Pure WebGL vs Regl (2D+3D, ~3415 LOC) kept behaviorally identical by hand with a copied `calculateBounds` and an explicit "must match" comment (`scatter/ScatterPureWebGL2D.tsx:210`, `scatter/ScatterRegl2D.tsx:50`, `DimensionReductionChart.tsx:610`). Pick one backend.
- **Prop drilling** — `SpectraChartV2` receives ~20 props via two near-duplicate invocation blocks (`MainCanvas.tsx:931/954`) despite already reading `SelectionContext` directly (`SpectraChartV2.tsx:168`).
- **Untyped escape hatches** — `window.__scatter3d_reset` with 4 `as any` casts (`ScatterPlot3D.tsx:473`); untyped recharts callbacks (`RepetitionsChart.tsx:1013/1481`, `EmbeddingSelector.tsx:301`). Use `useImperativeHandle`/typed payloads.
- **Dead UI controls** — "Delete predictions" shows a confirm dialog but only toasts "not supported" (`src/pages/Predictions.tsx:324`); "Backup Now" is a rendered no-op (`WorkspaceStats.tsx:284`). Wire to library or hide.

### Security

- **Auto-update integrity bypass** — `checksum_sha256` is never populated (`api/updates.py:489-520`) and `verify_checksum` returns `True` when absent (`api/update_downloader.py:148`); `github_repo` is settable via unauthenticated `PUT /api/settings` and interpolated into the API URL (`api/updates.py:735/471`). RCE at next launch. Mandate signed-checksum verification; pin the repo.
- **No authentication + CORS `*`** (`main.py:100`) over a localhost-bound server reachable by any browser tab; exposes install/update/delete/export. Restrict origins; add a startup-generated bearer token on mutating endpoints.
- **Unauthenticated arbitrary `pip install`** — `request.package` flows unchecked into `pip install` (`api/updates.py:1322`, `api/venv_manager.py:447`); honors URL/VCS/local-path specifiers. Allowlist + version regex.
- **Unsafe deserialization** — `_resolve_model_path` accepts absolute paths (`api/predictions.py:229`), `_load_model` builds an unguarded `models/{id}.joblib` allowing `../` traversal (`api/predictions.py:914`), and `shap.py` treats `model_id` as a raw path (`api/shap.py:669`). Confine to workspace `models/`; reject traversal/absolute.
- **Path traversal / enumeration** — dataset/workspace/spectra endpoints accept arbitrary absolute paths with no containment check anywhere in `api/` (`api/datasets.py:311`, `api/workspace.py:142`, `api/spectra.py:208`). Add a single realpath-containment helper.
- **Zip Slip** — `zf.extract(item, destination_path)` with no member validation in workspace import (`api/workspace.py:751`) and update extraction (`api/update_downloader.py:240`); contrast the safe `tar.extract(..., filter="data")` at `api/update_downloader.py:222`.
- **Destructive `shutil.rmtree`** on a stored path with no containment guard, reachable unauthenticated (`api/datasets.py:1036`). Restrict to a managed datasets root.
- **Custom-node `classPath` never validated** against the advertised `allowedPackages` allowlist (`api/workspace_manager.py:2315`); the allowlist is stored but never read (current RCE impact is blocked because `custom` step types hit `else: cls = None` at `api/nirs4all_adapter.py:304`, but the false sense of safety remains). Enforce at write + resolution time.
- **Workspace ID as base64-decoded arbitrary path** enabling read of any `workspace.json`-shaped file and field-limited writes (`api/workspace.py:1359`, `api/workspace_manager.py:2232`). Map IDs to the linked-workspaces registry.
- **Information disclosure** — HTTPException details echo raw absolute paths and library errors to the client (`api/spectra.py:292`, `api/datasets.py:474/569`). Return generic messages; keep detail server-side.
- **Update fetch defense-in-depth** — `follow_redirects=True` without host pinning (`api/update_downloader.py:89`); the real gap is the missing checksum above. Restrict `download_url` to github.com/objects.githubusercontent.com.

### Tests, build & dependencies

CI / tests:
- **CI never runs on the live branch** — `ci.yml:7` triggers on `main`/`develop`; default is `master`. Add `master`.
- **pytest absent from all workflows** — backend CI only runs `py_compile` + import check (`ci.yml:83-107`); `requirements-test.txt` is never referenced. Add a `pytest -m "not slow"` job.
- **vitest is decorative** — `continue-on-error: true` (`ci.yml:45`). Remove it.
- **Playwright job cannot pass** — no Python/venv though `webServer` runs `.venv/bin/python main.py` (`playwright.yml:12-21`, `playwright.config.ts:85`). Provision Python + select a project.
- **`nirs4all_adapter.py` (1210 LOC bridge) has zero direct tests** (`api/nirs4all_adapter.py`) — pure dict transforms, highest value-per-effort gap.
- **`client.ts` (2126) untested; `pipelineConverter.ts` (1773) has only a 327-line test** missing generator/finetuning round-trips (`src/utils/__tests__/pipelineConverter.test.ts`).
- **Integration suites (run lifecycle/errors) never run in CI** despite the mocked "Quick CI Mode" design (`tests/integration/`, `tests/conftest.py:49`).
- **Node-registry snapshot guard wired into no workflow** (`package.json:54`, `scripts/check-registry-snapshot.cjs`); only `validate:nodes` runs (`ci.yml:37`).
- **No ruff/mypy, no `pyproject.toml`** (`requirements.txt`, `ci.yml:62-107`); the documented Python green gate does not exist.
- **ESLint catches almost nothing** — `recommended` (not type-checked), `no-unused-vars: off`, no `--max-warnings 0` (`eslint.config.js:11/27`, `package.json:47`).
- **No coverage measurement** on either side (`vite.config.ts`, `pytest.ini:8`, `package.json:49`).
- **God-file routers exercised only indirectly** by CI-disabled integration tests; the real gap is pytest absence (`api/runs.py`, `api/pipelines.py`).

Build / deps:
- **Self-updater mismatched to package format** — Python updater xcopies over a PyInstaller exe dir (`updater/__init__.py:82/186`) but the build is `asar`-packed Electron (`electron-builder.yml:22`) with `electron-updater` not a dependency; `/webapp/apply` is live and unguarded (`api/updates.py:1006`). Adopt `electron-updater` or scope the Python updater to the in-venv library only.
- **Two divergent PyInstaller specs** — `nirs4all-studio.spec:228` references a nonexistent `launcher.py` (the pywebview-monolith path) vs the real `backend.spec:188`; `scripts/build.py:156` points at the broken one. Delete the dead spec/scripts.
- **Orphaned NSIS installer** references a missing `icon.ico` and an unbuilt PyInstaller layout (`installer/nsis/nirs4all-studio.nsi:53/103`); `electron-builder.yml:35` already covers NSIS. Delete.
- **No manual chunking / code-splitting** — three.js/drei/fiber/regl/recharts all in one bundle; no `manualChunks`, no `React.lazy` for 17 statically-imported pages (`vite.config.ts:117`, `src/App.tsx`). Add vendor chunks + route lazy-loading.
- **Floor-only (`>=`) requirements, no lockfile/hashes** (`requirements.txt:4`); non-reproducible backend builds. Adopt pip-compile/uv lock.
- **`version.json` decoupled from the live build** — `electron-release.yml` bumps `package.json` but never stamps `version.json`, so builds report `1.0.0`/`development` (`version.json:1`, `api/updates.py:387`). Stamp it in `build-release.cjs` or read `package.json`.
- **GPU flavor installs no GPU stack** — `requirements-gpu.txt` is comments only yet the artifact is `-gpu`-suffixed and `backend.spec:139` expects TF (`requirements-gpu.txt:7`, `scripts/build-release.cjs:179`). Make the flavor real or remove it.
- **`backend.spec` ships `console=True`** → stray Windows console window; pipes already capture logs (`backend.spec:223`, `electron/backend-manager.ts:197`). Set `console=False`.
- **Launcher uses broad `pkill -f`** matching `electron`/`vite`/`esbuild`, can kill unrelated user apps (`scripts/launcher.sh:164-167`); kill by saved PID files instead.
- **Inconsistent icon assets** — macOS uses a PNG where `.icns` is required; specs/NSIS point at missing icons (`electron-builder.yml:56`, `nirs4all-studio.spec:287`, `installer/nsis/nirs4all-studio.nsi:53`). Standardize a proper icon set.
- **Sourcemaps emitted only conditionally** — default prod build ships no maps, leaving Sentry traces unsymbolicated (`vite.config.ts:13/119`). Always emit hidden maps; make Sentry upload a release requirement.
- **Node engine floor disagrees with the pin** — `engines.node: ">=20"` vs `.nvmrc` `22` (`package.json:9`, `.nvmrc:1`). Tighten to `>=22`.

### Proposed roadmap (Claude)

**Phase 0 — Quick wins (<1 day each)**
- Add `master` to CI triggers; remove `continue-on-error: true` from vitest (`ci.yml:7/45`) — **S**, re-enables all frontend/build gates immediately (Top risks #10, #11).
- Delete the ~730 lines of dead `DatasetRegistry`/`SchemaMigrator`/`RunManager` (`api/workspace_manager.py:1122-1856`), dead `ScatterWebGL.tsx`, the `NodeRegistryContext` shim, and the dead introspection endpoints (`api/pipelines.py:974-1170`) — **S**.
- Bound `_dataset_cache` with an LRU and evict on workspace switch (`api/spectra.py:47`, `api/workspace.py:1554`) — **S**.
- Pin `github_repo` to a constant and reject non-github hosts (`api/updates.py:471`); add realpath-containment before `shutil.rmtree` (`api/datasets.py:1036`) and Zip Slip checks (`api/workspace.py:751`, `api/update_downloader.py:240`) — **S** each (Security #1 partial, plus traversal items).
- Add an import-smoke test that imports every router and resolves cross-module helpers — would have caught `_get_model_instance`, `get_loaded_model`, `ShapAnalyzer`, `get_outlier_mask` — **S**.
- Fix `ActiveRunContext` WebSocket URL to use `getWebSocketBaseUrl()` (`ActiveRunContext.tsx:105`); wrap `SpectraWebGL`/`RepetitionsChart` in `React.memo` (`SpectraWebGL.tsx:1919`, `RepetitionsChart.tsx:1580`) — **S** each.
- Stamp `version.json` in `build-release.cjs`; set `backend.spec console=False`; scope launcher kills to PID files; tighten `engines.node` to `>=22` — **S** each.
- Provision Python/venv in `playwright.yml` and select a web project (`playwright.yml:12-21`) — **S/M** (#11).

**Phase 1 — High-impact (~weeks)**
- **Close the security holes:** mandatory signed-checksum verification in the updater, fail-closed when absent (`api/update_downloader.py:148`); restrict CORS to known origins + startup bearer token on mutating routes (`main.py:100`); allowlist+version-regex for `pip install` (`api/updates.py:1322`); confine all model loading to workspace `models/` and reject absolute/`..` paths (`api/predictions.py:229/914`, `api/shap.py:669`) — **M** each (Top risks #1-4).
- **Stop blocking the event loop:** route pip install/venv create through `JobManager` (`api/updates.py:821`, `api/venv_manager.py:518`); wrap `nirs4all.predict`, `_load_dataset`, preprocessing, `permutation_importance`, and SQLite/polars reads in `asyncio.to_thread` (`api/predictions.py:536`, `api/spectra.py:355`, `api/analysis.py:547`) — **M** each (Top risks #5).
- **Wire pytest into CI** (`pytest -m "not slow"` + `requirements-test.txt`) and add the first targeted suite for `nirs4all_adapter.py` (`api/nirs4all_adapter.py`) — **M** (Tests).
- **Fix the boundary violations that are also broken endpoints:** route `evaluation.py` run/crossval, `predictions.py` confidence/explain, `shap.py`, and `playground.py /metrics/outliers` through `nirs4all.predict()`/`run()`/`explain()`/`ShapAnalyzer`/`instantiate_filter`; delete the home-grown sklearn/SHAP/importance code (`api/evaluation.py:183/662`, `api/predictions.py:907/1064`, `api/shap.py:310`, `api/playground.py:1638`) — **L** combined (Top risks #7, #8).
- **Reuse a long-lived `StoreAdapter`** on the `workspace_manager` singleton instead of per-request `WorkspaceStore`/`WorkspaceScanner`; replace full-table count/breakdown with SQL `COUNT`/`GROUP BY` (`api/aggregated_predictions.py:182`, `api/workspace.py:1628`, `api/store_adapter.py:239`) — **M** (Top risks #6).
- **Decide and fix the desktop update model** — adopt `electron-updater` driven from the main process, or scope the Python updater to the in-venv library only; remove the dead PyInstaller spec/`scripts/build.py`/NSIS installer (`updater/__init__.py:82`, `nirs4all-studio.spec`, `installer/nsis/nirs4all-studio.nsi`) — **L** (Top risks #9).
- **Frontend perf:** set `frameloop='demand'` + `invalidate()` in `SpectraWebGL` (`SpectraWebGL.tsx:1780`); migrate page loaders and `useSpectralData` to React Query (`DatasetDetail.tsx:64`, `useSpectralData.ts:91`); add `refetchOnWindowFocus/Reconnect:false` to the global QueryClient (`src/main.tsx:26`) — **M** combined (Top risks #12).

**Phase 2 — Structural**
- Consolidate the four NaN-sanitizers into `api/shared/json_sanitize.py` and the workspace.py raw-data path onto it (`api/store_adapter.py:27`, `api/runs.py:114`, `api/workspace.py:1996`) — **M**.
- Add a `require_workspace()` FastAPI dependency replacing the 45 inline guards; centralize a generic 500 handler so detail strings stop leaking paths (`api/datasets.py:474/774`, `main.py:72`) — **M/L**.
- Create `src/lib/runtime.ts` (`isElectron`/`waitForElectronApi`/`getApiBaseUrl`/`getWebSocketBaseUrl`), type `window.electronApi`, and route the router/base-URL choice through it; cache only successful URL resolution (`src/api/client.ts:13/21`, `src/main.tsx:7`) — **M**.
- Split `client.ts` per domain and migrate off `AxiosLikeClient` (`src/api/client.ts:231`); split `workspace_manager.py` into manager + scanner after the dead-code deletion — **L** each.
- Add `pyproject.toml` with ruff + mypy (mypy non-blocking, then ratchet), upgrade ESLint to `recommendedTypeChecked` with `--max-warnings 0`, enable vitest + pytest coverage with a ratcheting floor (`eslint.config.js:11`, `pytest.ini`) — **M/L**.
- Add manual vendor chunking + route-level `React.lazy` (`vite.config.ts:117`, `src/App.tsx`); adopt a hash-pinned Python lockfile (`requirements.txt:4`) — **M** each.
- Refactor the oversized backend functions into cohesive helpers (`api/runs.py:885`, `api/playground.py:194`) — **L**.

**Phase 3 — Longer-term**
- Decompose the frontend god-components (`YHistogramV2.tsx`, `pipelineConverter.ts`, `PipelineEditor.tsx`+`usePipelineEditor.ts`+`types.ts`) into hooks/per-domain modules — **L/XL**.
- Consolidate the competing scatter renderer families onto a single backend (`scatter/ScatterPureWebGL*.tsx` vs `scatter/ScatterRegl*.tsx`) — **L**.
- Adopt the `SelectionContext` selector store (or delete it) and split read/write contexts across the heavy Playground contexts; remove the ~50-prop drilling via a `PlaygroundPipelineContext` (`SelectionContext.tsx:737`, `src/pages/Playground.tsx:423`) — **L**.
- Narrow the 335 broad `except Exception` clauses and add a ruff BLE001/S110 rule; replace ~106 `print()`s with module loggers configured in `main.py`; introduce a DEV-gated frontend `logger.ts` + ESLint `no-console` (`api/runs.py`, `src/lib/playground/memoryMonitor.ts:257`) — **L**.
- Add the i18n locale-parity CI gate and backfill `fr`/`de` for `shap.*`/`analysis.transfer.*` (`src/locales/en/index.ts:850`); decouple `WorkspaceStore` schema/migration ownership back into nirs4all where the backend currently reaches into private attributes (`api/shared/metrics_computer.py:351`) by requesting public `get_scores(X)` — **M** each.
- Push code generation (`export_pipeline_to_python`), reference-dataset compatibility/alignment, and the AutoML operator maps down into nirs4all/nirs4all-io so the studio stops duplicating library knowledge (`api/nirs4all_adapter.py:1000`, `src/lib/playground/referenceDataset.ts:116`, `api/automl.py:631`) — **M/L**.