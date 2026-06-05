# nirs4all-studio — Technical-Debt Audit (pre-v1)

> **Date:** 2026-06-05 · **Commit:** `eba503f` (v0.6.3, branch `main`) · **Scope:** full studio — FastAPI backend (`api/`, ~47k LOC / 48 files), React 19 + Vite + TS frontend (`src/`, ~198k LOC / 513 files), Electron shell (`electron/`), packaging & build config.

This audit treats the codebase as **pre-v1**: there is *no backward-compatibility contract*. Legacy, deprecated, and compat-shim code is therefore counted as debt to **delete**, not preserve. It was produced by a 16-agent parallel audit (one auditor per area + an architect synthesis pass), then reviewed by Codex (see `CODEX_REVIEW.md`). The companion remediation plan is in `ROADMAP.md`.

---

## 0. Post-review corrections (Codex)

The independent Codex review (`CODEX_REVIEW.md` — gpt-5.5, read-only sandbox, verification against the actual code) confirmed PCV-03 and 12/13 high-severity spot-checks, refuted one critical, and found one missed bug. The following corrections are **already folded into this document**:

- **`PKG-01` downgraded critical → medium.** The original claim ("a CPU build cannot import the playground router") was wrong: `api/playground.py:36-40` guards `import msgpack` with `try/except`. The real debt is silent MessagePack degradation in packaged builds + three-way dependency-source drift (`PKG-02`).
- **`PCV-03` (the one remaining critical) broadened.** The scalar-generator state is a dead end in *both* converter directions: UI edits are dropped on export, there is no `_sample_` export branch (falls through to `{_or_: []}`), and *imported* scalar generators render empty because import populates `branches`/`params`, never `scalarGeneratorConfig`. Independently verified by the audit author and Codex.
- **`RUN-07` added (high, bug, found by Codex).** Run stop/pause controls are cosmetic: the in-flight `nirs4all.run()` worker keeps executing and writing artifacts; `_execute_run` can overwrite the terminal status.
- **`AGG-01` tightened.** The duplicated enrichment/signature suite is confirmed, but today's demonstrable drift is query-scope/perf, not matching semantics — the risk is *future* semantic drift.
- **`WS-04` nuanced.** The blocking-I/O claim holds for workspace/store/parquet endpoints (incl. blocking on `list(executor.map(...))` at `workspace.py:4112`) but must not be generalized to `runs.py`, which does use a worker thread — its debt is the bespoke engine (`RUN-01`).
- **Priorities re-ranked.** PCV-03's converter fixes are now #1; packaging hygiene demoted to #2. Sequencing reworded: the nirs4all boundary contract blocks only the chain-summary/inspector/aggregated-predictions work — deletion sweeps, converter fixes, JobManager consolidation, and packaging are independent.
- **File-collision map added** (see `ROADMAP.md` §2): `store_adapter.py`, `pipelineConverter.ts`, `runs.py`, and `workspace.py` are each touched by several findings and must have a single owner per phase.

---

## 1. Executive summary

nirs4all-studio carries roughly 28k LOC of backend god-modules and ~12k LOC of frontend/electron god-files, and the rot concentrates in four predictable places. First, the boundary rule ("backend never reimplements nirs4all") is broken in exactly the spots that matter for v1 correctness: store_adapter and aggregated_predictions reverse-engineer nirs4all CV/refit-chain pairing and synthesize refit scores (WS-06, BV-06, BV-07, AGG-01), inspector recomputes bias-variance/robustness/learning-curve ML analytics (INS-04), pipelines hardcodes operator shape semantics and six operator allow-lists (PIPE-01, PIPE-02), datasets reaches into nirs4all private parser internals (DS-01), and the frontend even recomputes outlier stats (VIZ-09, PG-06). Second, half-finished V1->V2/canonical migrations were shipped without the deletion pass, leaving two of nearly everything: two pipeline converters (PCV-01/PCV-02, one fully dead), three operator-name resolvers (BV-04), three nirs4all.run() wrappers plus a bespoke job engine that duplicates JobManager (RUN-01, RUN-02), two dead legacy pipeline builders (BV-01/BV-02/BL-01/BL-02), a dead SchemaMigrator (WS-02/BL-04), and a dead pywebview packaging stack (PKG-03/BLD-01). Third, the async layer is a systemic perf trap: heavy sklearn/parquet/SQLite work runs synchronously on the event loop with zero thread offload (PERF-02/PERF-03, WS-04), an eager router import chain defeats lazy startup (PERF-01), and N+1 SQL fan-outs riddle the query path (WS-05, INS-01, AGG-03). Fourth, there are real shipping bugs: msgpack is missing from CPU packaging so packaged builds silently lose MessagePack support — concrete proof the three dependency sources drifted (PKG-01/PKG-02), UI-edited scalar generators are silently dropped on export and imported ones render empty (PCV-03, the one confirmed critical), competing keydown handlers clobber playground undo (FE-01-state), and sentinel rmse=999 metrics get written to completed runs (RUN-06). The root causes are: (a) the router-never-delegated-to-services pattern producing 4k-LOC god-files, (b) boundary erosion where the backend re-derives nirs4all semantics instead of asking for a view, (c) migrations left half-landed with no compat contract to justify the residue, and (d) blocking ML/IO treated as cheap async. The cleanup is highly parallelizable because the debt clusters by file: dead-code/legacy deletion and packaging fixes are near-zero-risk and unblock everything, the god-class splits are file-local, and the boundary fixes need to land first only for the work built on the chain-summary contract (inspector/aggregated-predictions dedup and the query-path perf) — deletion sweeps, converter fixes, JobManager consolidation and packaging hygiene are independent. [This summary was corrected after the Codex review — see CODEX_REVIEW.md: PKG-01 downgraded (guarded import), PCV-03 broadened, RUN-07 (cosmetic stop/pause) added.]

## 2. Debt dashboard

**139 findings** across **15 areas**.

| Severity | Count | | Category | Count |
|---|---:|---|---|---:|
| 🔴 Critical | 1 | | Dead code | 33 |
| 🟠 High | 47 | | Duplication | 27 |
| 🟡 Medium | 59 | | Performance | 21 |
| ⚪ Low | 32 | | Legacy/compat | 18 |
|  |  | | Boundary violation | 11 |
|  |  | | Bug | 10 |
|  |  | | God class | 9 |
|  |  | | Antipattern | 8 |
|  |  | | Build | 1 |
|  |  | | Packaging | 1 |

**Reading guide:** finding IDs are area-prefixed (e.g. `WS-01`, `PCV-03`). Effort: `S` < 0.5d · `M` ~1–2d · `L` ~3–5d · `XL` > 1wk. Risk = chance a fix changes behavior.

---

## 3. Cross-cutting themes

The 139 findings collapse into eight recurring patterns. These are the *root causes*; the per-area findings (§5) are the instances.

### T1. Backend reimplements nirs4all (boundary violations)

The backend re-derives ML/dataset semantics that nirs4all already owns: CV/refit-chain pairing and refit-score synthesis, CV-strategy/folds inference by re-parsing splitter class paths, dataset metadata inference, file-role inference via private parser internals, operator shape math and class-name allow-lists, ML analytics (bias-variance/robustness/learning-curve), repetition-variability and outlier stats. These should delegate to nirs4all (often a query/view change) and are the load-bearing pre-v1 boundary debt.

**Evidence (13 findings):** `WS-06`, `BV-06`, `BV-07`, `AGG-01`, `INS-04`, `INS-05`, `PIPE-01`, `PIPE-02`, `DS-01`, `PG-06`, `PG-08`, `VIZ-09`, `PCV-08`

### T2. Half-landed V1->V2 / canonical migrations left a dead twin of everything

Phase-based migrations (canonical pipeline converter, V2 viz, node-registry v2, JobManager) shipped without deleting the superseded path, so the repo carries two of nearly everything — two editor<->nirs4all converters (one fully dead), three operator-name resolvers, three run() wrappers + a bespoke job engine, dead legacy/native pipeline builders, dead SchemaMigrator, a node-registry re-export shim, and orphaned V2/.v2 naming.

**Evidence (17 findings):** `PCV-01`, `PCV-02`, `BV-01`, `BV-02`, `BV-03`, `BL-01`, `BL-02`, `BL-03`, `BL-04`, `WS-02`, `RUN-01`, `RUN-02`, `BV-04`, `FE-01-reg`, `FE-02-reg`, `FE-03-reg`, `FE-04-reg`

### T3. Router-never-delegated god-classes

Every large module is a route layer that absorbed business logic and computation instead of delegating to service/repository objects, producing 2k-4k-LOC god-files across backend, the frontend API client, the pipeline converter, chart components, and the electron env/backend managers.

**Evidence (11 findings):** `WS-01`, `PG-01`, `BV-08`, `UPD-01`, `INS-01`, `CLIENT-01`, `PCV-06`, `VIZ-03`, `ENV-01`, `FE-06-state`, `FE-07-state`

### T4. Blocking ML/IO on the asyncio event loop + N+1 query fan-out

Heavy sklearn fit_transform, PCA/UMAP, parquet loads and SQLite queries run synchronously inside async handlers with zero thread offload (0 run_in_executor in playground/runs), an eager router import drags the full nirs4all+sklearn stack into cold start, and the query path repeatedly full-scans chain summaries with per-row N+1 fetches.

**Evidence (15 findings):** `WS-04`, `WS-05`, `WS-10`, `PG-07`, `PERF-01`, `PERF-02`, `PERF-03`, `PERF-04`, `PERF-05`, `PERF-06`, `INS-01`, `INS-02`, `AGG-03`, `DS-04`, `PG-05`

### T5. Copy-pasted helpers with no shared util (drifting duplication)

The same logic is pasted across modules with no extraction: JSON-sanitize helpers in 5 backend files, the chain-enrichment helper suite duplicated and already drifted between store_adapter and aggregated_predictions, triplicated discovery flows, duplicated detection blocks, duplicated spawn paths, and copy-pasted chart selection scaffolding and context history blocks.

**Evidence (12 findings):** `BL-05`, `AGG-01`, `WS-07`, `WS-08`, `DS-02`, `BM-01`, `ENV-04`, `VIZ-04`, `FE-05-state`, `CLIENT-02`, `BV-05`, `PIPE-03`

### T6. Eager dead/legacy code and orphaned build/packaging stacks

Large swaths of unreferenced code and config remain pre-v1: dead /metrics and predictions endpoints, dead selector/Hover machinery, 166 unused imports, dead pywebview build path, orphaned Storybook, byte-identical electron-builder configs, orphaned shell-script mirrors, and dead npm deps.

**Evidence (24 findings):** `PG-02`, `PG-03`, `PRED-01`, `FE-02-state`, `BL-06`, `BLD-01`, `BLD-02`, `BLD-03`, `PKG-03`, `PKG-04`, `PKG-05`, `BLD-06`, `WS-03`, `BL-07`, `BL-08`, `BL-09`, `BL-10`, `RUN-05`, `INS-03`, `CLIENT-03`, `VIZ-06`, `VIZ-08`, `FE-05-reg`, `ENV-02`

### T7. Three independently hand-maintained dependency/alias sources that disagree

Backend runtime deps live in requirements*.txt, python-runtime-config.cjs, and backend.spec hiddenimports with no single source of truth (msgpack already missing from CPU build), and model/operator alias maps are hardcoded in multiple modules duplicating the generated node registry.

**Evidence (5 findings):** `PKG-01`, `PKG-02`, `PKG-06`, `BV-11`, `CLIENT-04`

### T8. Live shipping bugs in conversion, runs, and process lifecycle

Concrete user-facing defects: silent drop of UI-edited scalar generators on export, merge_type leak into canonical payload, sentinel rmse=999 written to runs, operator-precedence bug skipping nested normalization, competing keydown handlers clobbering undo, fire-and-forget pollMlReadiness/orphan-kill races.

**Evidence (8 findings):** `PCV-03`, `PCV-04`, `PCV-05`, `RUN-06`, `AGG-02`, `FE-01-state`, `BM-02`, `BM-03`

---

## 4. Prioritized remediation order

Ranked by (impact × how much it unblocks a clean v1) ÷ effort. Each row maps to the workstreams in `ROADMAP.md`.

| # | Priority | Findings | Why |
|---:|---|---|---|
| 1 | **Fix the pipeline-converter data-loss bugs (scalar generators, merge_type, y_processing)** | `PCV-03`, `PCV-04`, `PCV-05` | [Re-ranked #1 after Codex review] PCV-03 is the only confirmed CRITICAL: bidirectional silent data loss for scalar generators (UI edits dropped on export, sample exports as {_or_:[]}, imports render empty). PCV-04/PCV-05 ride along in the same file. All small, all in pipelineConverter.ts, all directly corrupt the artifact a v1 user runs. |
| 2 | **Packaging hygiene: msgpack gap + single source of truth for the three dependency sources** | `PKG-01`, `PKG-02` | [Downgraded from #1 after Codex review: the msgpack import is guarded (playground.py:36-40), so CPU builds degrade silently rather than crash.] msgpack is missing from requirements-cpu.txt, python-runtime-config.cjs and backend.spec — proof the three hand-maintained dependency sources already drifted. Fix the gap and consolidate to one validated source (PKG-02). Small effort, removes a whole failure class before v1. |
| 3 | **Delete the dead parallel pipeline converter and builders** | `PCV-01`, `PCV-02`, `BV-01`, `BV-02`, `BV-03` | ~3,400 LOC of dead, drifting converters removed at low risk (verified: nativePipelineFormat.ts has 0 production importers; legacy/native builders referenced only by tests). Eliminates a whole source-of-truth ambiguity, shrinks the operator-resolver dedup surface (BV-04), and makes the converter god-class tractable. |
| 4 | **Establish the nirs4all CV/refit/chain-summary contract and delete backend reverse-engineering** | `WS-06`, `BV-06`, `BV-07`, `AGG-01` | Highest-impact boundary fix and the main blocker for the dedup/perf work. store_adapter and aggregated_predictions independently reverse-engineer (and have already drifted on) refit-chain pairing and score synthesis (verified: _chain_match_signature vs _chain_signature). Needs a nirs4all-side view/query change, so it must land before dependents that consume the enriched output. High effort/risk but it is the keystone. |
| 5 | **Unify run execution on JobManager; kill the bespoke engine and divergent run() wrappers** | `RUN-01`, `RUN-02`, `RUN-03`, `RUN-06`, `RUN-07` | runs.py ships its own ThreadPoolExecutor + queue + regex log-scraping engine (verified raw executor.submit) while pipelines.py/training.py use JobManager, giving three divergent run() wrappers with inconsistent metric extraction and a sentinel rmse=999 bug (RUN-06). Consolidating removes the largest single duplication and the structured-progress path retires the regex log-scraping. Codex additionally found stop/pause are cosmetic (RUN-07) — the JobManager consolidation is where real cancellation lands. |
| 6 | **Offload blocking ML/IO off the event loop + fix the eager-import cold start** | `PERF-01`, `PERF-02`, `PERF-03`, `WS-04` | Systemic responsiveness fix: playground /execute, spectra/preview, and every workspace query run synchronously on the loop (verified 0 run_in_executor in playground/runs), blocking websockets/health during multi-second fits. PERF-01's eager router->runtime_grouping->nirs4all import defeats two-phase lazy startup. Medium effort, low risk, large felt-perf win before v1. |
| 7 | **Collapse the triplicated operator-name resolution / alias / normalize-params** | `BV-04`, `BV-05`, `BV-11`, `PIPE-02` | Operator name->class resolution is triplicated across nirs4all_adapter, pipeline_canonical and pipeline_service with drift, plus duplicate _normalize_params and hardcoded alias maps duplicating the node registry. Unifying on one registry-driven resolver removes a recurring correctness hazard. Best done right after the dead builders (rank 3) shrink the migration surface. |
| 8 | **Extract a shared sanitize/util module and remove 166 unused imports** | `BL-05`, `BL-06` | Near-zero-risk, S effort, large surface cleanup: _sanitize_float/_sanitize_dict are pasted across 5 files (verified) and ruff reports 166 F401 hits. Mechanical, parallelizable, and clears noise that hides real issues — ideal early parallel-agent work. |
| 9 | **Push inspector analytics into the store and kill the full-scan + N+1 pattern** | `INS-01`, `INS-02`, `INS-04`, `INS-05` | Every one of 16 inspector endpoints full-scans chain summaries and does all stats in Python with N+1 pipeline/array fetches, and reimplements ranking/metric-direction/bias-variance that WorkspaceStore/nirs4all already expose. High perf + boundary payoff; depends on the chain-summary contract (rank 4). |
| 10 | **Split workspace.py god-router into domain routers + service layer** | `WS-01`, `WS-07`, `WS-09` | workspace.py is a 4,388-LOC router with ~70 endpoints across 9 domains and triplicated discovery flows. Splitting it (and folding the triplicated/legacy discovery into one scanner) is the single largest structural unlock for the backend, and is a prerequisite for cleanly addressing WS-04/WS-06 inside it. |
| 11 | **Delete dead endpoint families and legacy/back-compat code paths** | `PG-02`, `PRED-01`, `WS-02`, `BL-04`, `UPD-02`, `FE-02-state` | Large dead/legacy removal at low risk: dead /metrics endpoints, dead+boundary-violating predictions endpoints, dead SchemaMigrator/DatasetRegistry/RunManager (~700 LOC), updates legacy shims, and dead selector/Hover machinery. Pure subtraction, highly parallelizable across files. |
| 12 | **Split the 3052-LOC frontend API client into per-domain modules** | `CLIENT-01`, `CLIENT-02`, `CLIENT-03`, `CLIENT-04` | client.ts (193 fns, 268 exports, 90 importers) mirrors the backend routers and should split the same way; first extract the transport core (dedup the 3x-copied fetch error block) and delete the AxiosLikeClient/legacy aliases and dead wrappers. Enables independent frontend evolution but touches many import sites, so sequence after transport extraction. |
| 13 | **Memoize the chart hot paths and de-dup chart selection scaffolding** | `VIZ-01`, `VIZ-02`, `VIZ-04`, `VIZ-05` | SpectraWebGL isn't memoized and re-runs LTTB decimation every parent render while Highlighted/HoveredLine allocate Float32Arrays in the render body on every hover; SpectraChartV2 rebuilds an O(samples x wavelengths) array per render. Medium effort, directly fixes the sluggish playground feel; selection scaffolding dedup is incremental. |
| 14 | **De-duplicate electron spawn path and fix process-lifecycle races** | `BM-01`, `BM-02`, `BM-03`, `ENV-02`, `ENV-03` | backend-manager duplicates its entire ~80-line spawn path across startInternal/startInternalNonBlocking, and pollMlReadiness/orphan-kill run unawaited (zombie/port-race). Fixing the races prevents flaky startup/restart; deleting dead getRuntimeMode/validatePortableState and the legacy migration branch is free. Isolated to electron/, fully parallel with backend work. |
| 15 | **Clean the build/packaging clutter: pywebview path, Storybook, duplicate configs** | `PKG-03`, `BLD-01`, `BLD-02`, `PKG-04`, `BLD-03`, `PKG-05` | Removes an entire dead packaging generation and confusing duplicate config: dead pywebview build (build.py + nirs4all-webapp.spec + launcher.py), orphaned non-functional Storybook, byte-identical electron-builder configs, and orphaned shell mirrors. Low risk, clarifies the build story for v1; deps from PKG-03 (PKG-06) ride along. |

---

## 5. Detailed findings by area

Each finding: severity · category · location · evidence · impact · recommendation · effort/risk. Findings marked **⤿ merged** overlap a canonical finding elsewhere (see §6) and are not double-counted in the roadmap.

### 5.1 Frontend pipeline-format conversion (pipelineConverter.ts, nativePipelineFormat.ts, pipeline-editor/types.ts; export.ts traced)

*Reviewed: src/utils/pipelineConverter.ts (2823), src/utils/nativePipelineFormat.ts (1695), src/components/pipeline-editor/types.ts (1432), src/lib/playground/export.ts (1484, traced — no overlap), src/hooks/usePipelineEditor.ts (consumer, partial), src/utils/__tests__/{pipelineConverter,nativePipelineFormat}.test.ts (consumers), GeneratorRenderer.tsx/MergeRenderer.tsx (field source-of-truth confirmation)*

The conversion layer has a major structural debt: TWO full bidirectional editor<->nirs4all converters exist (pipelineConverter.ts 2823 LOC using full class paths; nativePipelineFormat.ts 1695 LOC using short names), but only pipelineConverter.ts is wired into the app (via usePipelineEditor.ts). nativePipelineFormat.ts has ZERO non-test production importers — it is ~1700 LOC of dead, parallel, drifting code kept alive only by its own 52-test suite, duplicating every conversion concept (generators, branches, finetune search-space parsing, _min/_max tuple splitting). The two modules have already diverged (e.g. sample_filter exports `exclude`, finetune handling differs), so they cannot be trusted as interchangeable. Beyond the duplication, there are concrete round-trip bugs: scalar generators (grid/zip/sample) edited in the UI are silently dropped on export because the exporter reads `branches` while the renderer/variant-counter use `scalarGeneratorConfig`; the merge fallback path leaks the editor's `merge_type` param into the canonical payload; y_processing import ignores inline params (asymmetric with split/preprocessing). The PipelineStep type carries multiple parallel legacy representations of the same data (children vs branches vs *Config objects; stackingConfig; customName vs stepMetadata.customName) that every export branch must defensively re-handle, which is the root cause of the size and the silent-drop bugs. export.ts is unrelated (playground chart/CSV/PNG export) and shares nothing with pipeline conversion — no overlap there. The root cause is two-sources-of-truth: an over-rich editor model with redundant fields, mapped by two competing converters.

| ID | Sev | Cat | Title | Effort/Risk |
|---|---|---|---|---|
| `PCV-03` | 🔴 | Bug | Scalar-generator config is a dead-end state: UI edits dropped on export, imports render empty, sample exports as `{_or_: []}` | M/med |
| `PCV-01` | 🟠 | Dead code | nativePipelineFormat.ts (1695 LOC) is a dead, parallel converter with zero production callers | S/low |
| `PCV-02` | 🟠 | Duplication | Two full bidirectional converters duplicate every conversion concept | S/low |
| `PCV-04` | 🟠 | Bug | Merge export fallback leaks editor-internal merge_type param into canonical payload | S/low |
| `PCV-06` | 🟠 | Antipattern | PipelineStep carries redundant parallel representations forcing every exporter to triple-handle each step | L/med |
| `PCV-05` | 🟡 | Bug | y_processing import ignores inline params (asymmetric with split/preprocessing) | S/low |
| `PCV-07` | 🟡 | Legacy/compat | calculateSweepVariants/calculatePipelineVariants family deprecated in favor of backend useVariantCount but still shipped | M/med |
| `PCV-08` | 🟡 | Boundary violation | CLASS_PATH_MAPPINGS / NAME_TO_CLASS_PATH hardcode sklearn private module paths and a partial operator catalog | M/med |

<details><summary><code>PCV-03</code> 🔴 <b>Scalar-generator config is a dead-end state: UI edits dropped on export, imports render empty, sample exports as `{_or_: []}`</b> <i>(Bug, M/med)</i></summary>

- **Location:** `src/utils/pipelineConverter.ts:2679-2700, 1993-2008; src/components/pipeline-editor/config/step-renderers/GeneratorRenderer.tsx:495-520`
- **Evidence:** GeneratorRenderer writes grid/zip parameter values into step.scalarGeneratorConfig.entries and _sample_ into scalarGeneratorConfig.sample (GeneratorRenderer.tsx:497-503, 510-517). createStepFromOption seeds these (types.ts:1349-1365) and calculateGeneratorExpansionCount reads them (types.ts:506-524, 539-540), proving scalarGeneratorConfig is the source of truth. But convertEditorGeneratorToNirs4all reads ONLY step.branches/step.branchMetadata for grid (2679-2688), zip (2691-2700), and reads step.params/_seed_ for sample (convertEditorGeneratorToNirs4all has no 'sample' branch at all; convertSampleGeneratorToEditor:1993 only sets params on import). A user who configures Grid/Zip param values or a Sample distribution in the UI exports `{_grid_: {}}`/`{_zip_: {}}` or loses the sample config. nativePipelineFormat.ts:623-664 has the identical blind spot. [Broadened after Codex review:] (1) Export: convertEditorStepToNirs4all emits grid/zip exclusively from step.branches (pipelineConverter.ts:2679-2700) and there is NO `_sample_` export branch before the `_or_` fallback (2714) — a sample generator exports as `{_or_: []}`. The renderer writes ONLY scalarGeneratorConfig (GeneratorRenderer.tsx:495-520); nothing syncs it to branches; `scalarGeneratorConfig` does not appear once in pipelineConverter.ts. (2) Import: convertGrid/Zip/SampleGeneratorToEditor populate branches/params, not scalarGeneratorConfig (pipelineConverter.ts:1926, 1993), while the renderer and tree labels read scalarGeneratorConfig (GeneratorRenderer.tsx:410, tree-node/utils.ts:239) — imported scalar generators render as empty/zero before being re-exported corrupted. (3) New steps are created with scalarGeneratorConfig and branches: undefined (types.ts:1349, 1376).
- **Impact:** Silent, bidirectional data loss in the core artifact users build: scalar grid/zip edits export as empty objects, sample generators export as `{_or_: []}`, and imported scalar generators display as empty. Independently confirmed by Codex and by the audit author.
- **Recommendation:** Make scalarGeneratorConfig the single source of truth for scalar generators in BOTH converter directions: export must read it (and emit a `_sample_` branch), import must populate it. Add round-trip tests (editor -> nirs4all JSON -> editor) for grid/zip/sample scalar generators.

</details>

<details><summary><code>PCV-01</code> 🟠 <b>nativePipelineFormat.ts (1695 LOC) is a dead, parallel converter with zero production callers</b> <i>(Dead code, S/low)</i></summary>

- **Location:** `src/utils/nativePipelineFormat.ts:1-1696`
- **Evidence:** grep for nativePipelineFormat/toNativeFormat/fromNativeFormat/toNativePipelineJSON/toNativePipelineYAML/NativePipelineStep across src/ excluding the file itself and tests returns NOTHING (Bash 'completed with no output'). codegraph blast radius for toNativeFormat: '7 callers in src/utils/nativePipelineFormat.ts' (all self); fromNativeFormat: '5 callers in src/utils/nativePipelineFormat.ts' (all self). The only external references are src/utils/__tests__/nativePipelineFormat.test.ts (52 tests). The live editor instead imports exportToNirs4all/hydrateEditorPipelineSteps from pipelineConverter.ts (usePipelineEditor.ts:13-16).
- **Impact:** ~1700 LOC plus a 1095-LOC test file are maintained, type-checked, and bundled but never executed by the app. It re-implements the entire editor<->nirs4all mapping a second time (a boundary the studio is supposed to keep thin), and has already drifted from pipelineConverter (different sample_filter/exclude handling, no class-path resolution, no hydration), so it is an active trap: a future dev may wire it in or copy from it and get different output. Blocks a clean v1 conversion story.
- **Recommendation:** Delete src/utils/nativePipelineFormat.ts and src/utils/__tests__/nativePipelineFormat.test.ts entirely. If the short-name/YAML output is a desired future feature, it belongs as one option inside the single pipelineConverter, not a forked module. Confirm no dynamic import via a final grep before removal.

</details>

<details><summary><code>PCV-02</code> 🟠 <b>Two full bidirectional converters duplicate every conversion concept</b> <i>(Duplication, S/low)</i></summary>

- **Location:** `src/utils/pipelineConverter.ts:1117-2823 vs src/utils/nativePipelineFormat.ts:249-1483`
- **Evidence:** Both implement the same step dispatch: pipelineConverter.convertStepToEditor (1125) / convertEditorStepToNirs4all (2038) vs nativePipelineFormat.convertNativeToEditor (841) / convertStepToNative (259). Both duplicate: finetune search-space parsing (parseFinetuneParamConfig 941 vs parseNativeFinetuneParamConfig 149 — byte-identical SEARCH_SPACE_TOKEN_ALIASES/SEARCH_SPACE_TOKENS at pipelineConverter:766-767 and nativePipelineFormat:93-94, identical normalizeSearchSpaceToken/normalizeSearchSpaceRawValue/cloneParamValue==cloneNativeValue); generator handling (convertEditorGeneratorToNirs4all 2657 vs convertGeneratorToNative 602, both with the same addModifiers closure and _cartesian_/_grid_/_zip_/_chain_/_or_ branches); branch named/indexed logic (2220 vs 432); createNoOpEditorStep/createSequentialEditorStep defined identically in both files (pipelineConverter:859/870, nativePipelineFormat:217/228).
- **Impact:** Every conversion rule must be edited in two places that have already diverged; bug fixes (e.g. the scalar-generator drop, finetune normalization) land in one and not the other. This is the structural driver of both modules' size.
- **Recommendation:** Pick pipelineConverter.ts as the single source of truth (it is the one in use and has class-path resolution + hydration). Remove nativePipelineFormat.ts (PCV-01). The shared finetune-search-space helpers should exist once.
- **Depends on:** PCV-01

</details>

<details><summary><code>PCV-04</code> 🟠 <b>Merge export fallback leaks editor-internal merge_type param into canonical payload</b> <i>(Bug, S/low)</i></summary>

- **Location:** `src/utils/pipelineConverter.ts:2273-2285`
- **Evidence:** convertEditorMergeToNirs4all, when step.mergeConfig is absent, falls back to `const params = step.params`. If params.merge_type is set with no params.predictions, it returns `{ merge: params.merge_type }` (ok); but the final fallback (2282-2284) returns `{ merge: params as Nirs4allMergeStep['merge'] }`, i.e. the ENTIRE editor params object — including merge_type plus any UI-only keys — as the merge payload. Import sets params.merge_type for simple merges (convertMergeToEditor:1571 `params: { merge_type: merge }`), so an imported simple merge whose mergeConfig is later cleared exports `{merge:{merge_type:'predictions'}}` instead of `{merge:'predictions'}`.
- **Impact:** Produces a malformed canonical merge dict that nirs4all does not expect, or silently carries UI-only keys across the boundary. Round-trip non-idempotent for merge steps lacking mergeConfig.
- **Recommendation:** Drop the raw-params fallback; require mergeConfig (set on every import and by MergeRenderer) and strip merge_type/UI keys before emitting. If params fallback must stay, whitelist known canonical keys only.

</details>

<details><summary><code>PCV-06</code> 🟠 <b>PipelineStep carries redundant parallel representations forcing every exporter to triple-handle each step</b> <i>(Antipattern, L/med)</i></summary>

- **Location:** `src/components/pipeline-editor/types.ts:285-378; consumed throughout pipelineConverter.ts:2287-2595`
- **Evidence:** Container steps store the same data three ways: children (PipelineStep[]), branches (PipelineStep[][]), and a typed *Config (sampleAugmentationConfig/featureAugmentationConfig/sampleFilterConfig/concatTransformConfig). Every editor->nirs4all converter re-handles all three in priority order: convertEditorSampleAugmentationToNirs4all checks children (2289) then sampleAugmentationConfig (2303) then branches (2330) then empty (2343); same 3-4 way fallback in convertEditorFeatureAugmentationToNirs4all (2352-2465), convertEditorSampleFilterToNirs4all (2467-2540), convertEditorConcatTransformToNirs4all (2542-2595). Import populates ALL of them at once (e.g. convertSampleAugmentationToEditor:1640-1663 sets children AND branches AND sampleAugmentationConfig, comment 'Legacy: ... prefer children'). Plus duplicated scalar fields: customName vs stepMetadata.customName (read at 322-340 native / 2144 converter), trainingConfig vs stepMetadata.trainParams, stackingConfig (2596-1606) marked 'Legacy ... for backward compatibility'.
- **Impact:** This redundancy is the root cause of both the file size and the silent-drop class of bugs (PCV-03): the exporter and the renderer disagree on which field is authoritative. Pre-v1 with no compat contract, maintaining 3 copies of container contents and writing N-way fallbacks is pure debt.
- **Recommendation:** Pick children as the single representation for container contents and branches only for true parallel/generator nodes; delete the *Config duplicates and the branches mirror on import (convertSampleAugmentationToEditor etc. should stop writing branches+config). Drop stackingConfig and the customName/trainingConfig legacy aliases in favor of stepMetadata. Collapse the N-way export fallbacks to one path. This is the change that actually shrinks the god-module.
- **Depends on:** PCV-01

</details>

<details><summary><code>PCV-05</code> 🟡 <b>y_processing import ignores inline params (asymmetric with split/preprocessing)</b> <i>(Bug, S/low)</i></summary>

- **Location:** `src/utils/pipelineConverter.ts:1485-1507 vs 1187-1217 / 1254-1282`
- **Evidence:** The 'split' (1187) and 'preprocessing' (1254) importers call extractInlineComponentParams(step, [...]) to capture params sitting as sibling keys next to the wrapper key. convertYProcessingToEditor (1485) does NOT: for a string it returns params:{} (1493) and for an object it reads only yProc.params (1504), never sibling/inline params. The export side, convertEditorYProcessingToNirs4all (2212), always nests params inside {y_processing:{class,params}}, so a self-produced doc round-trips, but any externally-authored y_processing with inline params loses them on import.
- **Impact:** Silent param drop when importing third-party / hand-written pipelines that put y_processing params inline. Inconsistent with the two sibling importers, which is a correctness and least-surprise defect.
- **Recommendation:** Apply the same extractInlineComponentParams(step, ['y_processing']) merge used by the split/preprocessing branches, so all three wrapper importers are symmetric.

</details>

<details><summary><code>PCV-07</code> 🟡 <b>calculateSweepVariants/calculatePipelineVariants family deprecated in favor of backend useVariantCount but still shipped</b> <i>(Legacy/compat, M/med)</i></summary>

- **Location:** `src/components/pipeline-editor/types.ts:434-760`
- **Evidence:** Five exported symbols carry explicit @deprecated JSDoc pointing to the useVariantCount hook 'which calls the nirs4all backend API for accurate variant counting': calculateSweepVariants (439), calculateStepVariants (547), calculatePipelineVariants (681), VariantBreakdown/getVariantBreakdown (710-724). They drag in ~250 LOC of local combinatorics (permutation, binomialCoefficient, calculateGeneratorValue, calculateCartesianStageVariants, calculateGeneratorExpansionCount) that the comments admit 'may not match nirs4all's actual behavior'.
- **Impact:** A second, knowingly-inaccurate variant-count implementation lives alongside the authoritative backend one — a boundary violation in spirit (re-deriving nirs4all expansion math in the frontend) and ~250 LOC of legacy math to keep correct. Pre-v1 this should go.
- **Recommendation:** Grep callers of each; if only the deprecated hook-fallback uses them, delete the local family and rely on useVariantCount. If an offline fallback is truly required, keep one minimal function and delete the rest.

</details>

<details><summary><code>PCV-08</code> 🟡 <b>CLASS_PATH_MAPPINGS / NAME_TO_CLASS_PATH hardcode sklearn private module paths and a partial operator catalog</b> <i>(Boundary violation, M/med)</i></summary>

- **Location:** `src/utils/pipelineConverter.ts:176-351`
- **Evidence:** CLASS_PATH_MAPPINGS hardcodes internal sklearn paths like 'sklearn.preprocessing._data.MinMaxScaler', 'sklearn.cross_decomposition._pls.PLSRegression', 'sklearn.ensemble._gb.GradientBoostingRegressor', and nirs4all-internal paths like 'nirs4all.operators.models.pytorch.nicon.customizable_nicon' (176-281), with a hand-maintained reverse map NAME_TO_CLASS_PATH (286-351). These are a frontend copy of class-resolution knowledge that nirs4all owns (the controller registry resolves short names at runtime). The list is also partial/inconsistent vs the node definitions already imported (SUPPORTED_OPERATOR_NODES at 353-360 with node.classPath/legacyClassPaths), so resolveClassPath maintains two overlapping resolution systems (the static maps + buildClassReferenceLookup at 529).
- **Impact:** Duplicates and hardcodes nirs4all/sklearn internals in the studio (boundary the project explicitly guards). Drifts whenever sklearn renames a private module or nirs4all moves an operator; the two resolution systems (static maps vs node-registry lookup) can disagree. Maintenance tax on every operator addition.
- **Recommendation:** Make the node-definition registry (classPath/aliases/legacyClassPaths) the single resolution source and delete the static CLASS_PATH_MAPPINGS/NAME_TO_CLASS_PATH that duplicate it; for anything genuinely needed, source class paths from the backend operator catalog rather than hardcoding sklearn private paths.

</details>


### 5.2 Backend god classes — inspection & run management (api/inspector.py, api/runs.py, api/pipelines.py)

*Reviewed: api/inspector.py (2387, full), api/runs.py (2321, full), api/pipelines.py (2312, full), api/jobs/manager.py (466, full), nirs4all/pipeline/storage/workspace_store.py:1916-2066 (query_chain_summaries/query_top_chains signatures), nirs4all/pipeline/analysis/ (dir listing)*

All three files are oversized FastAPI route modules that mix routing with substantial computation. The single biggest debt is in runs.py: it ships an entirely bespoke training-execution engine (_execute_run + _execute_pipeline_training with its own asyncio.create_task, raw ThreadPoolExecutor, queue-based log streaming, and regex log-scraping for progress) that duplicates the shared JobManager (api/jobs/manager.py) already used by pipelines.py, training.py, automl.py and shap.py — so there are now THREE divergent nirs4all.run() wrappers (runs.py:_execute_pipeline_training, pipelines.py:_run_pipeline_task, training.py:_run_training_task) with different metric-extraction logic. inspector.py is a 16-endpoint analytics module that performs all statistics in Python after pulling the full chain-summary table on every request (query_chain_summaries + _normalize_chain_records called 16x, each doing an N+1 get_pipeline loop), and reimplements ranking/sort/task-type filtering and metric-direction that WorkspaceStore already exposes (query_top_chains, task_type filter, _infer_metric_ascending) — a boundary smell plus a real perf drag. pipelines.py hardcodes ML operator knowledge in SHAPE_TRANSFORMS / _propagate_shape (PLS n_components, wavelet level, crop math) and maintains six manual operator class-name allow-lists, both of which should come from the nirs4all registry. Dead code (_create_mock_run, _normalize_chain_rows, unused timezone import, unused Pydantic response models, no-op _NaNSafeJSONEncoder.default) and a live legacy run-format scan (workspace/workspace/runs) round out the debt.

| ID | Sev | Cat | Title | Effort/Risk |
|---|---|---|---|---|
| `INS-01` | 🟠 | Performance | Every inspector endpoint full-scans chain summaries and does all stats in Python (no push-down) | L/med |
| `PIPE-01` | 🟠 | Boundary violation | SHAPE_TRANSFORMS / _propagate_shape hardcode ML operator shape semantics in the backend | M/med |
| `RUN-01` | 🟠 | Duplication | runs.py reimplements its own job-execution engine instead of using the shared JobManager | L/high |
| `RUN-02` | 🟠 | Duplication | Three divergent nirs4all.run() wrappers with inconsistent metric extraction | M/med |
| `RUN-07` | 🟠 | Bug | Run stop/pause controls are cosmetic: the nirs4all.run() worker keeps executing and writing artifacts | M/med |
| `INS-02` | 🟡 | Performance | N+1 pipeline-metadata fetch and per-prediction array fetch in normalization/aggregation | M/med |
| `INS-04` | 🟡 | Boundary violation | Backend computes ML analytics (bias-variance, robustness, learning-curve) that belong in nirs4all | L/med |
| `PIPE-02` | 🟡 | Boundary violation | Six hand-maintained operator class-name allow-lists duplicate the nirs4all registry | M/med |
| `RUN-03` | 🟡 | Antipattern | Progress reported by regex-scraping log strings rather than structured callbacks | M/med |
| `RUN-04` | 🟡 | Legacy/compat | Live legacy run-format scan (workspace/workspace/runs) | S/low |
| `RUN-06` | 🟡 | Bug | Fabricated sentinel regression metrics (rmse=999.0) written to completed runs | S/med |
| `INS-03` | ⚪ | Dead code | Dead helper _normalize_chain_rows, unused timezone import, unused response-model classes | S/low |
| `INS-05` | ⚪ | Duplication | _is_lower_better duplicates nirs4all's metric-direction logic | S/low |
| `PIPE-03` | ⚪ | Duplication | Pipeline-comment filtering duplicated three ways (local _filter_comments vs shared filter_canonical_comments) | S/low |
| `RUN-05` | ⚪ | Dead code | Dead function _create_mock_run and no-op JSON encoder override | S/low |

<details><summary><code>INS-01</code> 🟠 <b>Every inspector endpoint full-scans chain summaries and does all stats in Python (no push-down)</b> <i>(Performance, L/med)</i></summary>

- **Location:** `api/inspector.py — _normalize_chain_records + store.query_chain_summaries called in 16 endpoints (e.g. 573/600 data, 729 histogram, 800 rankings, 868 heatmap, 951 candlestick, 1120 branch, 1636 robustness, 1789 correlation, 2009 prep-impact, 2087 hyperparam, 2178 bias-var, 2296 learning-curve)`
- **Evidence:** get_inspector_data issues query_chain_summaries TWICE per request (line 573 filtered + line 600 unfiltered facet pool) and normalizes both. Heatmap/candlestick/branch/correlation/prep-impact pull the entire table then group/aggregate with numpy in the route. /rankings (784-851) pulls all rows, sorts in Python (`records.sort(key=sort_key)`), then slices offset:limit — yet WorkspaceStore.query_top_chains(metric,n,score_column,ascending) already does ranked top-N in SQL. task_type filtering is re-done in Python (_matches_task_type_filter, 416) though query_chain_summaries accepts a task_type arg (workspace_store.py:2005).
- **Impact:** O(all-chains) materialization + per-pipeline N+1 (see INS-02) on every chart interaction; rankings pagination loads the whole table to return 50 rows. As stored runs grow this becomes the dominant latency of the Inspector. Also a boundary smell: ranking/sort/metric-direction logic duplicated from the store.
- **Recommendation:** Push filters and ranking into query_chain_summaries/query_top_chains (pass task_type, score_column, ascending, n/offset); compute facet lists once and cache per store snapshot; replace the /rankings Python sort+slice with query_top_chains. Stop calling query_chain_summaries twice in /data.
- **Depends on:** INS-02

</details>

<details><summary><code>PIPE-01</code> 🟠 <b>SHAPE_TRANSFORMS / _propagate_shape hardcode ML operator shape semantics in the backend</b> <i>(Boundary violation, M/med)</i></summary>

- **Location:** `api/pipelines.py:2136-2256 (SHAPE_TRANSFORMS, DIMENSION_PARAMS, _propagate_shape), endpoint :2259`
- **Evidence:** A 65-line dict maps operator names to lambdas encoding their feature-shape effect: PLSRegression/IKPLS/OPLS → `min(n_components, features, samples)` (2162-2177), Wavelet/Haar → `features // (2 ** level)` (2194-2201), CropTransformer → `end - start` (2188-2191), Resampler → target_points (2180-2187). This is nirs4all operator domain knowledge living in the studio backend and is necessarily incomplete (unknown operators just preserve shape + warn, 2244-2254).
- **Impact:** Direct violation of the 'backend never reimplements nirs4all logic' rule. Every new/changed nirs4all operator silently produces wrong or 'unknown' shape predictions in the editor. Hand-maintained ML math the library should own.
- **Recommendation:** Ask nirs4all to expose per-operator output-shape inference and call it; delete SHAPE_TRANSFORMS/DIMENSION_PARAMS/_propagate_shape. If the library cannot yet, this endpoint should be feature-flagged off rather than encoding operator math here.

</details>

<details><summary><code>RUN-01</code> 🟠 <b>runs.py reimplements its own job-execution engine instead of using the shared JobManager</b> <i>(Duplication, L/high)</i></summary>

- **Location:** `api/runs.py:740-1537 (_execute_run, _execute_pipeline_training) vs api/jobs/manager.py:106-466 (JobManager)`
- **Evidence:** runs.py drives background work with raw `asyncio.create_task(_execute_run(run.id))` (lines 1782, 2103, 2189, 2267), a hand-rolled `concurrent.futures.ThreadPoolExecutor(max_workers=1)` (line 1439), a `queue.Queue` log pump with a custom `_QueueLogHandler` (lines 1116, 1184-1197), manual cancellation flags `_run_cancellation_flags` (line 344), and a polling loop `while not future.done(): await asyncio.sleep(0.05)` (line 1483). JobManager already provides create_job/submit_job/cancel_job/progress_callback/WebSocket dispatch and is the path used by pipelines.py:1591, training.py:173, automl.py:315, shap.py:289.
- **Impact:** Two parallel concurrency models for the same 'run a nirs4all pipeline in the background' task. The runs.py engine is the most complex and least reusable, owns its own cancellation/persistence/WS semantics, and any fix (e.g. thread-pool sizing, cancellation correctness) must be made twice. It is the primary reason runs.py is 2321 LOC.
- **Recommendation:** Migrate run execution onto JobManager: register a JobType.TRAINING task that wraps the existing per-pipeline body, delete the bespoke executor/queue/polling/cancellation-flag machinery, and let JobManager own progress + WS dispatch. Keeps Run manifest persistence as a thin callback.
- **Depends on:** RUN-03

</details>

<details><summary><code>RUN-02</code> 🟠 <b>Three divergent nirs4all.run() wrappers with inconsistent metric extraction</b> <i>(Duplication, M/med)</i></summary>

- **Location:** `api/runs.py:1281-1378 (run_pipeline_in_thread), api/pipelines.py:1654-1712 (_run_pipeline_task), api/training.py:~_run_training_task`
- **Evidence:** runs.py builds run_kwargs and extracts metrics with extensive NaN-guarding, classification handling, RPD computation and fold summaries (lines 1281-1378); pipelines.py:1657-1712 builds a near-identical run_kwargs and extracts `best_rmse`/`best_r2`/`best_score` but with NO NaN guarding (`metrics['rmse'] = float(result.best_rmse)` line 1672 — best_rmse returns float('nan') when unavailable per runs.py comment at line 1322) and a different top_results shape. Both then `result.export(model_path)` to an ensure_models_dir path.
- **Impact:** The same library call produces different metric dicts depending on which endpoint launched it (/runs vs /pipelines/{id}/execute), and pipelines.py can emit NaN metrics that runs.py is careful to strip. Divergence is a correctness/consistency bug surface and triples maintenance of the extraction logic.
- **Recommendation:** Extract one `run_pipeline_and_extract_metrics(steps, dataset, ...) -> result_dict` helper (in nirs4all_adapter.py) with the runs.py NaN-safe extraction as the single implementation; have all three task functions call it.

</details>

<details><summary><code>RUN-07</code> 🟠 <b>Run stop/pause controls are cosmetic: the nirs4all.run() worker keeps executing and writing artifacts</b> <i>(Bug, M/med)</i></summary>

- **Location:** `api/runs.py:2122 (stop_run), :1535 (worker loop exit), :2141 (pause_run), :911 (_execute_run overwrites terminal status)`
- **Evidence:** [Found by Codex review] stop_run sets _run_cancellation_flags and marks the run failed (runs.py:2122), but the worker only exits its polling loop and calls executor.shutdown(wait=False) (runs.py:1535) — the in-flight nirs4all.run() keeps running on its thread and keeps writing to the store/artifacts. pause_run only mutates statuses (runs.py:2141); _execute_run later overwrites the terminal status (runs.py:911).
- **Impact:** Users believe a run is stopped/paused while it continues consuming CPU/GPU and writing results; a 'failed' run can be resurrected to 'completed' by the still-running worker. Misleading state machine + wasted compute + potentially corrupted run records.
- **Recommendation:** Implement real cooperative cancellation: thread the cancellation flag into the execution layer (nirs4all session/callback if available — coordinate with the library), prevent a cancelled run from writing terminal status, and either implement pause for real or remove the pause control from the UI. Folding runs.py onto JobManager (RUN-01/RUN-02) is the natural place to fix this.
- **Depends on:** RUN-01

</details>

<details><summary><code>INS-02</code> 🟡 <b>N+1 pipeline-metadata fetch and per-prediction array fetch in normalization/aggregation</b> <i>(Performance, M/med)</i></summary>

- **Location:** `api/inspector.py:351-413 (_load_pipeline_metadata_map / _normalize_chain_records), :480-486 (_get_arrays) called per row in scatter/confusion/bias-variance/learning-curve`
- **Evidence:** _normalize_chain_records collects all pipeline_ids then loops `for pipeline_id in {...}: store.get_pipeline(pipeline_id)` (lines 358-364) — one DB round-trip per distinct pipeline, on every endpoint, every request. scatter (663-689), confusion (1521-1542) and bias-variance (2215-2239) loop over each fold row and call `_get_arrays(store, prediction_id)` (one fetch per prediction), accumulating full y_true/y_pred vectors in Python lists.
- **Impact:** Two stacked N+1 patterns: N pipelines × every request, plus M prediction-array fetches per multi-chain chart. Large prediction sets are fully materialized into Python lists before serialization, inflating memory and latency.
- **Recommendation:** Add a batch get_pipelines(ids) on the store (or join pipeline name/expanded_config into v_chain_summary) and a batch array fetch; cache the normalized facet pool. Materialize arrays only for the requested chains/partition.

</details>

<details><summary><code>INS-04</code> 🟡 <b>Backend computes ML analytics (bias-variance, robustness, learning-curve) that belong in nirs4all</b> <i>(Boundary violation, L/med)</i></summary>

- **Location:** `api/inspector.py:1615-1775 (robustness), :2158-2283 (bias-variance), :2286-2387 (learning-curve)`
- **Evidence:** bias-variance reconstructs per-sample fold predictions keyed by (dataset, sample_idx) and computes bias² = (mean_pred - y_true)² and variance = Var(preds) across folds (lines 2241-2253). robustness derives CV stability from `np.std(fold_scores, ddof=1)`, train-test gap, normalized score and fold-count ratio (1676-1737). learning-curve infers training size by reading prediction-array lengths and approximating `total ≈ val_size*fold/(fold-1)` (2348-2351). These are statistical/ML analyses, not HTTP/UI-state.
- **Impact:** Violates the studio rule that NIRS/ML analysis lives in nirs4all (BACKEND_RULES.md). The library already owns analysis (pipeline/analysis/topology.py is used here at 1213; core/metrics.py exists), so this logic should be a library call, not 400+ lines of numpy in route handlers. Training-size approximation in particular is a guess the library could answer exactly.
- **Recommendation:** Move bias-variance / robustness / learning-curve computation into nirs4all (e.g. pipeline/analysis), call it from these endpoints, and keep inspector.py as request-shaping + serialization only.

</details>

<details><summary><code>PIPE-02</code> 🟡 <b>Six hand-maintained operator class-name allow-lists duplicate the nirs4all registry</b> <i>(Boundary violation, M/med)</i></summary>

- **Location:** `api/pipelines.py:714-1076 (_discover_transform/splitter/model/augmentation/feature_selection/filter_operators)`
- **Evidence:** Each discovery fn defines a literal list of class names to expose, e.g. transform_classes (729-764, ~35 names), model_classes (846-865, 18 names incl IKPLS/OPLS/MBPLS/KOPLS/FCKPLS), augmenter_classes (901-923, 21 names), splitter_classes (803-810), fs_classes (1005-1013), filter_classes (1048-1054), then `getattr(module, name, None)`. The set is curated by hand and silently skips anything not listed.
- **Impact:** Operator availability shown in the editor is a stale hardcoded subset of what nirs4all actually registers; new operators don't appear until someone edits these lists. Boundary smell — the library's CONTROLLER_REGISTRY/registry is the real source. ~360 LOC of allow-lists.
- **Recommendation:** Drive discovery from nirs4all's operator registry (the docstring at _list_operators_impl even says 'dynamic discovery from CONTROLLER_REGISTRY'); iterate the registry and categorize, removing the six literal name lists.

</details>

<details><summary><code>RUN-03</code> 🟡 <b>Progress reported by regex-scraping log strings rather than structured callbacks</b> <i>(Antipattern, M/med)</i></summary>

- **Location:** `api/runs.py:50-123 (FOLD/BRANCH/VARIANT/STEP_PATTERN, parse_log_for_progress), used at 1045`
- **Evidence:** runs.py defines seven regexes (e.g. `FOLD_PATTERN = re.compile(r"[Ff]old\s*(\d+)\s*[/of]+\s*(\d+)")`) and parse_log_for_progress() greps every emitted log line to recover fold/branch/variant indices, which then drive notify_fold_progress/notify_branch_progress/notify_variant_progress. The actual progress while the thread runs is a fabricated synthetic ramp: `progress_phases` with hardcoded percentages (lines 1450-1478) advanced by `if elapsed_ticks % 10 == 0: progress_step += 1` (line 1504).
- **Impact:** Progress and granular fold/variant tracking are brittle string-coupled inferences from nirs4all's human log format; any wording change in the library silently breaks UI progress. The synthetic ramp means the percentage shown is unrelated to real work. This is non-trivial code that only exists because RUN-01 doesn't use a real callback channel.
- **Recommendation:** Drop the regex scraper and synthetic ramp; consume nirs4all's structured progress/verbose hooks (or JobManager's progress_callback) for fold/variant counts. Delete FOLD/BRANCH/VARIANT/STEP patterns and progress_phases.
- **Depends on:** RUN-01

</details>

<details><summary><code>RUN-04</code> 🟡 <b>Live legacy run-format scan (workspace/workspace/runs)</b> <i>(Legacy/compat, S/low)</i></summary>

- **Location:** `api/runs.py:454-504 (_load_persisted_runs)`
- **Evidence:** After scanning the correct `workspace.path/runs`, the function additionally walks `legacy_runs_dir = Path(workspace.path)/"workspace"/"runs"` (line 485) 'for runs created before the path fix' with full dedup-by-seen_run_ids logic (lines 481-502). Comment at 457-458 explicitly labels it backward-compatibility.
- **Impact:** Pre-v1 there is no compat contract; this double directory scan runs on every workspace load (lazy, but per workspace switch) and carries a second open()/json.load() loop purely to read a path layout that should no longer exist.
- **Recommendation:** Delete the legacy_runs_dir block and the seen_run_ids dedup it requires; keep only the primary runs_dir scan.

</details>

<details><summary><code>RUN-06</code> 🟡 <b>Fabricated sentinel regression metrics (rmse=999.0) written to completed runs</b> <i>(Bug, S/med)</i></summary>

- **Location:** `api/runs.py:1353-1363`
- **Evidence:** For non-classification runs, when a metric is missing the code injects fake values: `metrics['rmse'] = 999.0` (line 1359), `metrics['r2'] = 0.0` (1357), `metrics['rpd'] = 0.0` (1363), commented 'Preserve regression defaults for legacy UI summaries'. These are then persisted into the Run manifest and surfaced as RunMetrics.
- **Impact:** A successful run whose metric the extractor failed to read is reported to the UI as RMSE 999 / R2 0 — indistinguishable from a genuinely terrible model, and the 999.0 sentinel can corrupt downstream sorting/aggregation. Driven by a 'legacy UI' assumption that has no contract pre-v1.
- **Recommendation:** Leave missing metrics as None (RunMetrics fields are already Optional) and let the UI render 'N/A'; delete the 999.0/0.0 fabrication block.

</details>

<details><summary><code>INS-03</code> ⚪ <b>Dead helper _normalize_chain_rows, unused timezone import, unused response-model classes</b> <i>(Dead code, S/low)</i></summary>

- **Location:** `api/inspector.py:393-403 (_normalize_chain_rows), :28 (timezone), :49-74 InspectorChainSummary, :138-154 RankingRow`
- **Evidence:** _normalize_chain_rows is defined but never called (grep finds only the definition; all callers use _normalize_chain_records). `from datetime import UTC, datetime, timezone` imports timezone but only UTC/datetime are used. InspectorChainSummary and RankingRow Pydantic models are declared but never referenced as response_model or instantiated — endpoints return hand-built dicts (e.g. /data returns InspectorDataResponse with `chains: list[dict]`, /rankings builds dicts inline at 827-841).
- **Impact:** Misleading dead schema/helpers in an already 2387-LOC file; readers assume RankingRow/InspectorChainSummary are the contract when they are not enforced anywhere.
- **Recommendation:** Delete _normalize_chain_rows, drop timezone from the import, and either wire RankingRow/InspectorChainSummary in as response models or delete them.

</details>

<details><summary><code>INS-05</code> ⚪ <b>_is_lower_better duplicates nirs4all's metric-direction logic</b> <i>(Duplication, S/low)</i></summary>

- **Location:** `api/inspector.py:536-543 (_LOWER_BETTER_METRICS, _is_lower_better)`
- **Evidence:** inspector hardcodes `_LOWER_BETTER_METRICS = {"rmse","mse","mae","rmsecv","rmsep","secv","sep","bias"}` and _is_lower_better used in 5 endpoints (rankings 810, heatmap 902, branch 1173, robustness 1712, prep-impact 2028). WorkspaceStore already exposes _infer_metric_ascending (workspace_store.py:2064) for query_top_chains.
- **Impact:** Two sources of truth for which metrics are lower-better; they can drift, silently inverting sort/aggregate direction in charts vs the store's ranking.
- **Recommendation:** Expose the library's metric-direction helper and use it in inspector instead of the local set; remove _LOWER_BETTER_METRICS.

</details>

<details><summary><code>PIPE-03</code> ⚪ <b>Pipeline-comment filtering duplicated three ways (local _filter_comments vs shared filter_canonical_comments)</b> <i>(Duplication, S/low)</i></summary>

- **Location:** `api/pipelines.py:1846-1868 (_filter_comments) vs imported filter_canonical_comments (pipeline_canonical, used at 587/1453/1463)`
- **Evidence:** pipelines.py imports `filter_comments as filter_canonical_comments` from pipeline_canonical (line 34-36) and uses it in validate/count paths, but also defines its own recursive `_filter_comments` (1846-1868) that strips `_comment` keys, used in the samples/roundtrip code (1892, 1910, 1931, 2027, 2079, 2093). Two implementations of 'remove _comment metadata'.
- **Impact:** Two comment-stripping routines that can diverge in edge cases (e.g. `{_comment}`-only dicts); maintenance hazard in round-trip fidelity checks.
- **Recommendation:** Standardize on the shared filter_canonical_comments and delete the local _filter_comments (or vice-versa), then update the samples/roundtrip call sites.

</details>

<details><summary><code>RUN-05</code> ⚪ <b>Dead function _create_mock_run and no-op JSON encoder override</b> <i>(Dead code, S/low)</i></summary>

- **Location:** `api/runs.py:691-737 (_create_mock_run), api/runs.py:403-409 (_NaNSafeJSONEncoder.default)`
- **Evidence:** _create_mock_run is defined but has zero callers (grep across api/, src/, tests/ returns only the definition; create_run uses _create_run_from_config instead). It hardcodes fake `model="PLS", preprocessing="SNV"`. Separately, _NaNSafeJSONEncoder.default (line 405) only does `return super().default(obj)` — a pure no-op override; the real work is in _sanitize/iterencode.
- **Impact:** Dead scaffolding that misleads readers (fake PLS/SNV mock) and an inert override that adds noise to the encoder.
- **Recommendation:** Delete _create_mock_run entirely. Remove the no-op default() override from _NaNSafeJSONEncoder.

</details>


### 5.3 Backend — updates, datasets, predictions, aggregation

*Reviewed: api/datasets.py (1968), api/updates.py (2289), api/aggregated_predictions.py (1316), api/predictions.py (745), api/predict.py (326), api/update_downloader.py (423), api/store_adapter.py (2396, partial — function inventory + enrichment helpers + get_chain_summaries/get_all_chains_for_dataset), api/shared/dataset_config.py (352, na_policy section), main.py (router registration), src/api/client.ts + PredictDialog.tsx (caller verification)*

The biggest debt is in the prediction/aggregation cluster. `aggregated_predictions.py` reimplements ~10 chain-enrichment helpers (variant-param attach, refit marking, synthetic-refit fallback, CV-sibling enrichment, chain signature, CV-payload detection) that already exist verbatim in `store_adapter.py`; the two copies have already drifted (different tuple arities, `_chain_signature` vs `_chain_match_signature`) and must be unified. `predictions.py` is largely dead and a boundary violation simultaneously: its `single`/`confidence`/`explain` endpoints (with hand-rolled bootstrap/jackknife/permutation-importance numerics) have no frontend/test/python callers and reimplement ML/uncertainty logic that belongs in nirs4all. `datasets.py` is a 1968-LOC god module whose detection endpoints duplicate each other and one (`detect_files_list`) reaches into nirs4all's private `parser._pattern_matches`/`_get_stem` to re-derive file-role inference — a boundary violation. `updates.py` is a 2289-LOC kitchen-sink mixing GitHub/PyPI polling, a dependency-manager, snapshot CRUD, and the apply/staging flow. Legacy/compat shims (na_policy normalization, deprecated aliases, the `/webapp/download` legacy endpoint, the `_LazyUpdateManager` proxy) are scattered and should be deleted pre-v1. There is a real operator-precedence bug in `_normalize_chain_payload`.

| ID | Sev | Cat | Title | Effort/Risk |
|---|---|---|---|---|
| `AGG-01` | 🟠 | Duplication | aggregated_predictions.py reimplements the entire chain-enrichment helper suite already in store_adapter.py | L/med |
| `DS-01` | 🟠 | Boundary violation | detect_files_list reaches into nirs4all private parser internals and re-derives file-role inference | M/med |
| `PRED-01` | 🟠 | Dead code | predictions.py single/confidence/explain endpoints are dead AND reimplement ML logic (boundary violation) | M/low |
| `UPD-01` | 🟠 | God class | updates.py is a 2289-LOC god module mixing five unrelated responsibilities | L/med |
| `AGG-02` | 🟡 | Bug | _normalize_chain_payload operator-precedence bug skips normalization of nested class/function payloads | S/low |
| `AGG-03` | 🟡 | Performance | _enrich_refit_with_cv re-queries full chain_summaries per affected dataset (N+1 / redundant full scan) | M/med |
| `DS-02` | 🟡 | Duplication | datasets.py detection endpoints duplicate the same FolderParser→DetectedFile→parsing-options→metadata block four times | M/low |
| `UPD-02` | 🟡 | Legacy/compat | Dead/no-op legacy-compat code in updates.py: _LazyUpdateManager proxy, legacy create/download endpoints, no-op filter | M/med |
| `AGG-04` ⤿ | ⚪ | Legacy/compat | Deprecated aliases for renamed chain-summary types/methods kept as compat shims | S/low |
| `DS-03` ⤿ | ⚪ | Legacy/compat | na_policy legacy normalization shim should be removable once stored configs are migrated | M/med |
| `DS-04` | ⚪ | Performance | preview_dataset_by_id does a full dataset load purely to back-fill cached sample counts on every call | M/low |
| `UPD-03` | ⚪ | Performance | Network probe + per-request 3s timeouts make update-status latency-prone; download job spins a fresh event loop | M/med |

<details><summary><code>AGG-01</code> 🟠 <b>aggregated_predictions.py reimplements the entire chain-enrichment helper suite already in store_adapter.py</b> <i>(Duplication, L/med)</i></summary>

- **Location:** `api/aggregated_predictions.py:367-757 vs api/store_adapter.py:430-559`
- **Evidence:** aggregated_predictions defines private copies of: `_attach_variant_params_inplace` (agg:437 vs store_adapter:498), `_mark_refit_only_records`/`_mark_refit_only_entries_inplace` (agg:376 vs sa:438), `_has_cv_summary_payload` (agg:389 vs sa:447), `_apply_synthetic_refit_fallback` logic via `_enrich_refit_with_cv` (agg:672 vs sa `_enrich_refit_with_cv_inplace`:519), `_chain_signature` (agg:465) vs `_chain_match_signature` (sa), `_signature_params` (agg:457 vs sa:`_signature_params`), `_stable_serialize` (agg:400 vs sa `_stable_serialize_for_signature`). The endpoints at agg:776-855 re-run this pipeline (`_mark_refit_only_records`/`_enrich_with_fold_artifacts`/`_enrich_refit_with_cv`/`_apply_synthetic_refit_fallback_inplace`) instead of using store_adapter's already-assembled `get_all_chains_for_dataset` (sa:2042-2080) which runs the canonical sequence. Copies have already drifted: agg `_chain_signature` returns a 4-tuple while sa builds a 6-tuple signature key. [Tightened after Codex review: the duplicated enrichment/signature suite is confirmed (aggregated_predictions.py:465/672 vs store_adapter.py:413/519) but the matching formula is effectively the same today — the demonstrable drift is in query scope/performance (extra full-table query), not yet in matching semantics. The risk is future semantic drift.]
- **Impact:** Two divergent implementations of refit/CV reconciliation produce subtly different chain summaries depending on which endpoint the UI hits; every bug fix must be applied twice and the drift proves this already fails. ~390 LOC of pure duplication.
- **Recommendation:** Delete the duplicated helpers from aggregated_predictions.py. Either call the existing `WorkspaceStoreAdapter` methods, or have store_adapter export the enrichment pipeline (`_mark_refit_only_entries_inplace`, `_enrich_refit_with_cv_inplace`, `_apply_synthetic_refit_fallback_inplace`, `_attach_variant_params_inplace`, `_chain_match_signature`) and import them. Keep one signature-tuple shape.

</details>

<details><summary><code>DS-01</code> 🟠 <b>detect_files_list reaches into nirs4all private parser internals and re-derives file-role inference</b> <i>(Boundary violation, M/med)</i></summary>

- **Location:** `api/datasets.py:584-751 (esp. 616-663)`
- **Evidence:** Hardcodes role heuristics `stem_patterns = {"train_x": ["x"], "train_y": ["y"], "train_group": ["m","meta","metadata","group"]}` (616-620) and loops calling private nirs4all methods `parser._pattern_matches(lower_name, pattern.lower())` (640) and `parser._get_stem(filename)` (656). nirs4all's folder_parser already implements this exact FILE_PATTERNS loop (folder_parser.py:211) and exposes `_pattern_matches`/`_get_stem`/`_has_supported_extension` as private. The webapp re-implements the dataset-assembly role-detection that is nirs4all-io/nirs4all's domain.
- **Impact:** Dataset file-role inference logic lives in two places and the webapp couples to private (underscore) nirs4all API that can break on any library refactor. Adding a new role pattern requires editing the webapp too.
- **Recommendation:** Ask nirs4all/nirs4all-io for a public file-list detection entrypoint (it already has the FILE_PATTERNS path); delete the hand-rolled stem_patterns loop and private-method calls. The webapp should pass the path list down and translate the returned config, not re-derive roles.

</details>

<details><summary><code>PRED-01</code> 🟠 <b>predictions.py single/confidence/explain endpoints are dead AND reimplement ML logic (boundary violation)</b> <i>(Dead code, M/low)</i></summary>

- **Location:** `api/predictions.py:185-744`
- **Evidence:** No caller in src/, tests, or python for `/predictions/single`, `/predictions/confidence`, `/predictions/explain` (grep across *.ts/*.tsx/*.py outside predictions.py returns nothing; only `/predictions/batch` and `/predictions/dataset` are used by PredictDialog.tsx:419,438). The dead endpoints carry hand-rolled numerics that reimplement library ML: `_bootstrap_confidence` (574, adds gaussian noise to fake uncertainty), `_jackknife_confidence` (618, scipy z-intervals), `_ensemble_confidence` (662), `_permutation_importance_single` (700), `_gradient_importance` (730, just calls permutation). `_load_model` (537) loads `.joblib` directly — the live path (predict.py) uses nirs4all `.n4a` bundles.
- **Impact:** ~400 LOC of dead code that also violates the 'backend never reimplements nirs4all' rule (uncertainty + feature-importance are nirs4all/SHAP concerns). The bootstrap method fabricates confidence by perturbing inputs with noise — scientifically misleading if ever re-exposed.
- **Recommendation:** Delete `predict_single`, `predict_with_confidence`, `explain_prediction` and all six helper functions plus `_load_model`. Keep only `predict_batch`/`predict_dataset` (still used) or migrate those two to predict.py and delete predictions.py entirely.

</details>

<details><summary><code>UPD-01</code> 🟠 <b>updates.py is a 2289-LOC god module mixing five unrelated responsibilities</b> <i>(God class, L/med)</i></summary>

- **Location:** `api/updates.py:1-2290`
- **Evidence:** Single file holds: (1) UpdateManager GitHub/PyPI polling + caching + asset matching (`check_github_release` 750, `check_pypi_release` 982, `_find_platform_asset` 909); (2) the webapp download/stage/apply lifecycle endpoints (download-start 1334, apply 1473, staged-update 1525, cleanup); (3) a full optional-dependency manager with its own cache class `DependenciesCache` (418) and `NIRS4ALL_OPTIONAL_DEPS` 60-line hardcoded fallback (175-244) + install/uninstall/revert/update/refresh endpoints (1870-2134); (4) pip-freeze config-snapshot CRUD (2156-2289); (5) runtime/venv status. ~25 endpoints in one router.
- **Impact:** Any change to dependency management, the updater, or snapshots risks the others; the file is impossible to reason about as a unit and the dependency-manager portion is conceptually a separate feature from app self-update.
- **Recommendation:** Split into `updates_app.py` (GitHub/PyPI + download/stage/apply), `dependencies.py` (DependenciesCache + NIRS4ALL_OPTIONAL_DEPS + install/uninstall/revert/update/refresh), and `runtime_snapshots.py` (snapshot CRUD + runtime status). Move the dataclass/Pydantic models with their owners.

</details>

<details><summary><code>AGG-02</code> 🟡 <b>_normalize_chain_payload operator-precedence bug skips normalization of nested class/function payloads</b> <i>(Bug, S/low)</i></summary>

- **Location:** `api/aggregated_predictions.py:523`
- **Evidence:** `if key in {"class", "function"} or key in {"model", "y_processing"} and isinstance(value, str):` — `and` binds tighter than `or`, so this evaluates as `key in {class,function}` OR `(key in {model,y_processing} and isinstance(value,str))`. When key is 'class'/'function' with a NON-string value (a nested dict/list), it calls `_normalize_chain_reference(value)` which (505-511) returns non-str unchanged, so the `else` recursion into `_normalize_chain_payload(value)` is never taken and nested legacy refs (e.g. xgboost.sklearn aliases at agg:77-81) inside that subtree stay un-normalized.
- **Impact:** Stored chains whose 'class'/'function' value is a nested config object reload into the editor with legacy class references un-aliased, so the round-trip importFromNirs4all can resolve the wrong operator.
- **Recommendation:** Parenthesize intent: `if (key in {"class","function"} or key in {"model","y_processing"}) and isinstance(value, str):`, then fall through to recursion for the non-string case.

</details>

<details><summary><code>AGG-03</code> 🟡 <b>_enrich_refit_with_cv re-queries full chain_summaries per affected dataset (N+1 / redundant full scan)</b> <i>(Performance, M/med)</i></summary>

- **Location:** `api/aggregated_predictions.py:672-757 (698-708)`
- **Evidence:** After the endpoint already loaded `records` via `store.query_chain_summaries(...)`, `_enrich_refit_with_cv` issues a SECOND full `store.query_chain_summaries(dataset_name=dataset_name)` for every distinct dataset among refit records (loop at 698) and iterates all returned rows into `cv_pool`, then calls `_build_pipeline_metadata_map` + `_attach_variant_params_inplace` on the union. For the unfiltered `GET /aggregated-predictions` this re-reads essentially the whole chain table a second time.
- **Impact:** On large workspaces the aggregated-predictions list endpoint does roughly 2x the chain-summary IO plus a pipeline-metadata join, on every request, with no pagination on the endpoint itself.
- **Recommendation:** Build the CV-sibling map from the rows already in hand when the query is unfiltered (the store_adapter `_enrich_refit_with_cv_inplace` already matches within the in-memory row set). Only issue the extra query for the narrow chain_id/single-dataset drill-down case. Unify with AGG-01.
- **Depends on:** AGG-01

</details>

<details><summary><code>DS-02</code> 🟡 <b>datasets.py detection endpoints duplicate the same FolderParser→DetectedFile→parsing-options→metadata block four times</b> <i>(Duplication, M/low)</i></summary>

- **Location:** `api/datasets.py:454-575 (detect_unified), 622-751 (detect_files_list), 1825-1910 (scan_folder._build_detected_files)`
- **Evidence:** The identical `key_to_type_split` map is redefined three times (463-471, 605-613, 1815-1823). The 'get parsing options from first X file' block (508-521, 694-712, 1874-1892) and the 'extract metadata columns via load_file with na_policy=ignore' block (523-536, 715-728, 1896-1908) are copy-pasted with only minor variance. `_get_file_format`/`_is_detectable_format` checks duplicated against an inline `first_x.suffix.lower() in (".csv",".gz",".zip")` at 1877.
- **Impact:** Three near-identical detection paths drift independently (scan_folder uses a different detectability check than _is_detectable_format); ~150 LOC of duplication in a 1968-LOC module.
- **Recommendation:** Extract one `_build_detection_payload(folder_or_paths)` helper returning (files, parsing_options, confidence, metadata_columns, fold info) and call it from all three endpoints. Hoist `key_to_type_split` to a module constant.

</details>

<details><summary><code>UPD-02</code> 🟡 <b>Dead/no-op legacy-compat code in updates.py: _LazyUpdateManager proxy, legacy create/download endpoints, no-op filter</b> <i>(Legacy/compat, M/med)</i></summary>

- **Location:** `api/updates.py:1121-1129, 1253-1271, 1594-1615, 1687-1689`
- **Evidence:** `_LazyUpdateManager` proxy class (1122) duplicates `get_update_manager()`'s lazy-init that already exists (1113) — comment literally says 'For backward compatibility'. `create_venv` (1253) is a registered endpoint that only raises HTTP 400 ('Legacy endpoint kept for compatibility'). `download_webapp_update` (1594) is documented '(legacy endpoint)' and superseded by `/webapp/download-start`. `_filter_profile_managed_categories` (1687) is a no-op that returns its argument unchanged but is still called at 1710. Dual `@router.get("/runtime/...")`+`@router.get("/venv/...")` aliases on every runtime endpoint (1236-1237, 2140-2141, 2169-2170, etc.) are legacy path duplication.
- **Impact:** Dead/no-op surface that the no-backcompat pre-v1 policy says must disappear; the venv/runtime dual aliases double the endpoint count for one feature.
- **Recommendation:** Delete `_LazyUpdateManager` (use the module-level `get_update_manager()`), remove `create_venv` and `download_webapp_update` legacy endpoints, delete `_filter_profile_managed_categories` and inline its callsite, and drop the `/venv/*` aliases keeping only `/runtime/*` (update src/api/client.ts accordingly).

</details>

<details><summary><code>AGG-04</code> ⚪ <b>Deprecated aliases for renamed chain-summary types/methods kept as compat shims</b> <i>(Legacy/compat, S/low)</i> · **⤿ merged**</summary>

- **Location:** `api/aggregated_predictions.py:131-132,143-144; api/store_adapter.py:1321-1322,1350-1351`
- **Evidence:** `AggregatedPrediction = ChainSummary` and `AggregatedPredictionsResponse = ChainSummariesResponse` (agg:132,144, both labelled '# Deprecated alias'); `get_aggregated_predictions = get_chain_summaries` and `get_top_aggregated_predictions = get_top_chain_summaries` (sa:1322,1351). The `AggregatedPrediction` model alias has no python importer; the store_adapter method aliases are not referenced.
- **Impact:** Naming-debt: two names for one concept across the codebase. The endpoint functions are also still named `get_aggregated_predictions`/`get_top_aggregated_predictions` perpetuating the old vocabulary.
- **Recommendation:** Delete the four alias lines. Rename the endpoint route/handlers to the chain-summary vocabulary if the route path can change pre-v1; otherwise at least drop the unused symbol aliases.

</details>

<details><summary><code>DS-03</code> ⚪ <b>na_policy legacy normalization shim should be removable once stored configs are migrated</b> <i>(Legacy/compat, M/med)</i> · **⤿ merged**</summary>

- **Location:** `api/shared/dataset_config.py:37-75,120-122,213-214; api/datasets.py:265-266`
- **Evidence:** `_LEGACY_NA_POLICY_ALIASES = {"drop": "remove_sample", "keep": "ignore"}` plus `normalize_na_policy` and `normalize_na_policy_in_config` were added (commit 41d61fb) to repair 'older webapp builds [that] stored na_policy as drop/Drop/keep'. The sweep runs `normalize_na_policy_in_config(config)` over global_params + every *_params block on every config build (214). This is a data-migration shim for legacy persisted dataset configs.
- **Impact:** Per-build full-config sweep on every preview/link to compensate for legacy stored values; pure compatibility tax that should not exist post-v1.
- **Recommendation:** Run a one-time migration over workspace-stored dataset configs/settings to rewrite legacy na_policy values, then delete `_LEGACY_NA_POLICY_ALIASES`/`normalize_na_policy_in_config` and have the translator pass the value through. Track as a pre-v1 migration task.

</details>

<details><summary><code>DS-04</code> ⚪ <b>preview_dataset_by_id does a full dataset load purely to back-fill cached sample counts on every call</b> <i>(Performance, M/low)</i></summary>

- **Location:** `api/datasets.py:1221-1303 (1285-1301)`
- **Evidence:** After `preview_dataset` fully loads the dataset (DatasetConfigs + x()/y() across partitions), the handler unconditionally `app_config.update_dataset(...)` to 'always refresh train/test sample counts' (1286-1299). The preview itself (preview_dataset, 989) builds spectra for train/test/all by repeatedly calling `dataset.x({partition})`/`dataset.y(...)` and concatenating (_build_spectra_preview_by_partition 362, _build_target_distribution_by_partition 399) — multiple full materializations per request with no caching of the loaded dataset across calls.
- **Impact:** Opening the dataset preview re-loads and re-materializes the whole dataset (and writes back to app_config) on every navigation, even when counts are already stored; scales poorly with large datasets.
- **Recommendation:** Only write back stats when missing (guard the unconditional train/test update), and reuse the already-loaded `_load_dataset` cache instead of re-running DatasetConfigs in the preview path. Decimate once and reuse for the per-partition views.

</details>

<details><summary><code>UPD-03</code> ⚪ <b>Network probe + per-request 3s timeouts make update-status latency-prone; download job spins a fresh event loop</b> <i>(Performance, M/med)</i></summary>

- **Location:** `api/updates.py:727-748 (_fetch_url), 1375-1421 (_execute_download_job)`
- **Evidence:** `_fetch_url` (727) calls `await is_online()` before every fetch and uses `timeout=3.0`; `get_update_status` (1079) fans out github+pypi but each path can independently stall on the probe + 3s. `_execute_download_job` (1388-1400) builds a brand-new `asyncio.new_event_loop()` inside the threadpool worker to run the async downloader, while `update_downloader.download()` itself is built on blocking `urllib.request.urlopen` (update_downloader.py:112) wrapped in async — i.e. async-over-sync.
- **Impact:** Update checks can add multi-second latency to settings UI; the new-event-loop-per-job pattern and async-wrapping of blocking urllib is fragile and defeats the async surface.
- **Recommendation:** Cache the online-probe result for a short TTL instead of probing per fetch; make the downloader genuinely sync and run it via `run_in_threadpool` rather than constructing an event loop inside a thread. Lower-priority cleanup.

</details>


### 5.4 Backend-wide dead-code & legacy/compat sweep (api/*.py, 48 files, ~47k LOC)

*Reviewed: api/nirs4all_adapter.py (~2090), api/store_adapter.py (~2300+, partial), api/aggregated_predictions.py (~1020, partial), api/inspector.py (partial), api/workspace_manager.py (legacy + SchemaMigrator regions), api/workspace.py (legacy/migration regions), api/runs.py (legacy run scan + sanitize), api/updates.py (legacy endpoints), api/venv_manager.py, api/shared/filter_operators.py, api/shared/dataset_config.py, api/pipeline_canonical.py (header), api/node_registry_loader.py; ruff F401 across all 48 api/*.py*

The backend carries two distinct legacy pipeline-builder code paths in nirs4all_adapter.py (build_full_pipeline + build_native_pipeline and their exclusive helper subtrees) that are entirely dead — runs actually build pipelines via pipeline_canonical.editor_steps_to_runtime_canonical, so ~400 lines of "legacy editor format" / "native format" conversion plus YAML export/import are unreferenced (only a single test imports build_full_pipeline). A whole "Phase 4 Schema Migration" class (SchemaMigrator, ~105 lines) is dead with zero callers. Several deprecated aliases (store_adapter method aliases, filter_operators BaseFilter=None/FILTER_REGISTRY={} compat exports, venv_manager.create_venv method, downloadWebappUpdate legacy endpoint) are unreferenced shims that should be deleted pre-v1. The biggest cross-file duplication is _sanitize_float/_sanitize_dict copy-pasted verbatim across 3-5 modules with no shared util. Module headers carry 166 ruff F401 unused imports (mostly copy-pasted typing.Dict/List/Optional and lazy_imports.is_ml_ready/require_ml_ready). Live legacy-compat shims (na_policy aliases, filter-name translation, chain-id prefix resolution, runs double-nested-dir scan) remain but are riskier to remove because they read already-saved data. Root cause: the codebase accreted "v1→v2" format/migration paths and per-module helper copies that were never consolidated or deleted after the canonical path landed.

| ID | Sev | Cat | Title | Effort/Risk |
|---|---|---|---|---|
| `BL-01` | 🟠 | Dead code | Dead legacy pipeline builder: build_full_pipeline + entire editor-format helper subtree | M/low |
| `BL-02` | 🟠 | Dead code | Dead native pipeline builder: build_native_pipeline + _build_native_step | M/low |
| `BL-04` ⤿ | 🟠 | Dead code | Dead SchemaMigrator class (v1->v2 manifest migration, 'Phase 4: Backward Compatibility') | S/low |
| `BL-05` | 🟠 | Duplication | Triplicated/quintuplicated JSON-sanitize helpers across modules (no shared util) | S/low |
| `BL-03` | 🟡 | Dead code | Dead YAML pipeline export/import functions | S/low |
| `BL-06` | 🟡 | Dead code | 166 module-scale unused imports (F401), dominated by copy-pasted typing & lazy_imports headers | S/low |
| `BL-09` | 🟡 | Dead code | Dead VenvManager.create_venv method and dead downloadWebappUpdate legacy endpoint | S/low |
| `BL-11` | 🟡 | Legacy/compat | Live legacy-compat normalization shims reading already-saved data (na_policy, filter names, chain refs) | M/med |
| `BL-07` | ⚪ | Legacy/compat | Deprecated store_adapter method aliases never invoked | S/low |
| `BL-08` | ⚪ | Legacy/compat | Dead backward-compat filter exports (BaseFilter=None, FILTER_REGISTRY={}) | S/low |
| `BL-10` | ⚪ | Dead code | Dead no-op backward-compat branch in _normalize_params (MinMaxScaler) | S/low |
| `BL-12` | ⚪ | Legacy/compat | Legacy double-nested runs directory scan (workspace/workspace/runs) | S/low |

<details><summary><code>BL-01</code> 🟠 <b>Dead legacy pipeline builder: build_full_pipeline + entire editor-format helper subtree</b> <i>(Dead code, M/low)</i></summary>

- **Location:** `api/nirs4all_adapter.py:1039-1172 (build_full_pipeline); helpers 746-1038 (build_full_step, _build_generator_step, _build_branch, _build_or_generator, _build_branches_flat/_as_stages)`
- **Evidence:** build_full_pipeline is docstring-marked '.. deprecated:: Use build_native_pipeline instead' and 'handles the legacy editor format ... kept for backward compatibility'. codegraph_callers + grep show its ONLY caller is tests/test_pipeline_canonical.py:859. build_full_step's callers (codegraph: _build_or_generator/_build_branch/_build_branches_flat/_build_branches_as_stages/_build_generator_step/build_full_pipeline) are all inside this same subtree. Runs build pipelines via editor_steps_to_runtime_canonical (api/runs.py:1249,1254), never via build_full_pipeline.
- **Impact:** ~134 lines of the function plus its ~290-line exclusive helper subtree are unreachable in production, doubling the apparent pipeline-build surface and confusing which path is authoritative. Blocks a clean v1 where there is exactly one editor->runtime conversion.
- **Recommendation:** Delete build_full_pipeline and its exclusive helpers (build_full_step, _build_generator_step, _build_branch, _build_or_generator, _build_branches_flat, _build_branches_as_stages) and the FullPipelineBuildResult/PipelineVariant types only used by them; delete or rewrite tests/test_pipeline_canonical.py::test_build_full_pipeline_prefers_class_model_classpath against the canonical path.
- **Depends on:** Confirm expand_pipeline_variants (live, used by runs.py) does not transitively need build_full_step before removal.

</details>

<details><summary><code>BL-02</code> 🟠 <b>Dead native pipeline builder: build_native_pipeline + _build_native_step</b> <i>(Dead code, M/low)</i></summary>

- **Location:** `api/nirs4all_adapter.py:1757-1926 (build_native_pipeline, _build_native_step, _build_native_finetune_params)`
- **Evidence:** build_native_pipeline is documented as the live replacement ('Use build_native_pipeline instead'), but grep across api/, src/, tests/ shows its only references are self-recursive (nirs4all_adapter.py:1836, 1843 inside _build_native_step) and docstrings. No external caller in runs.py/pipelines.py/playground.py/training.py/recommended_config.py/automl.py. The real build path is editor_steps_to_runtime_canonical in pipeline_canonical.py.
- **Impact:** Both the 'old' and the 'new' adapter builders are dead; the module's own header comment advertises build_native_pipeline as the entry point, which is actively misleading. ~170 dead lines.
- **Recommendation:** Delete build_native_pipeline, _build_native_step, _build_native_finetune_params, and the _instantiate_native/_instantiate_native_list/_resolve_class_by_name helpers if they become orphaned. Update the module docstring header (lines 11-14) that references these as the live API.
- **Depends on:** BL-01 (verify _resolve_class_by_name/_instantiate_native not shared with a live path before deleting).

</details>

<details><summary><code>BL-04</code> 🟠 <b>Dead SchemaMigrator class (v1->v2 manifest migration, 'Phase 4: Backward Compatibility')</b> <i>(Dead code, S/low)</i> · **⤿ merged**</summary>

- **Location:** `api/workspace_manager.py:1448-1552 (class SchemaMigrator: detect_schema_version, migrate_to_v2)`
- **Evidence:** Header comment 'Phase 4: Schema Migration & Backward Compatibility'. codegraph_callers('migrate_to_v2')='No callers found'. grep for SchemaMigrator / migrate_to_v2 / detect_schema_version across api/, src/, tests/ returns only the definitions — zero call sites.
- **Impact:** ~105 lines of dead v1->v2 manifest migration scaffolding presented as a maintained subsystem; nothing detects or migrates schema versions at runtime. Pure pre-v1 debt with no compatibility contract to honor.
- **Recommendation:** Delete the entire SchemaMigrator class.

</details>

<details><summary><code>BL-05</code> 🟠 <b>Triplicated/quintuplicated JSON-sanitize helpers across modules (no shared util)</b> <i>(Duplication, S/low)</i></summary>

- **Location:** `_sanitize_float: api/inspector.py:246, api/aggregated_predictions.py:253, api/store_adapter.py:47, api/predict.py:63, api/runs.py:126; _sanitize_dict: api/inspector.py:253, api/aggregated_predictions.py:260, api/store_adapter.py:54`
- **Evidence:** _sanitize_float bodies at inspector.py:246-250, aggregated_predictions.py:253-257, store_adapter.py:47-51 are byte-identical ('Convert NaN / Inf to None for JSON serialization' + same isnan/isinf check). _sanitize_dict at the three sites is the same recursive walk (only whitespace/line-wrap differs). predict.py:63 and runs.py:126 are variant spellings of the same NaN/Inf->None logic. No shared sanitize util exists in api/shared/ (grep for def sanitize/_sanitize/to_json_safe in api/shared returns nothing).
- **Impact:** Five copies of the same JSON-safety primitive means a fix (e.g. handling numpy floats or nested tuples) must be applied 5 places or silently diverge; aggregated_predictions imports _sanitize_dict from store_adapter in some paths yet redefines its own at line 260, so two of the three live in the same call graph.
- **Recommendation:** Add one shared helper (e.g. api/shared/json_safe.py with sanitize_float/sanitize_dict) and replace all 5 _sanitize_float / 3 _sanitize_dict definitions with imports.

</details>

<details><summary><code>BL-03</code> 🟡 <b>Dead YAML pipeline export/import functions</b> <i>(Dead code, S/low)</i></summary>

- **Location:** `api/nirs4all_adapter.py:1583-1679 (export_pipeline_to_yaml, import_pipeline_from_yaml)`
- **Evidence:** codegraph_callers returns 'No callers found' for both. grep across api/, src/ (incl. client.ts), tests/ finds zero references other than the defs themselves — no /pipelines yaml route, no exportYaml/importYaml frontend caller.
- **Impact:** ~95 lines of unreachable serialization code. Implies a YAML import/export feature that was never wired up or was removed from the UI, leaving the backend half.
- **Recommendation:** Delete export_pipeline_to_yaml and import_pipeline_from_yaml.

</details>

<details><summary><code>BL-06</code> 🟡 <b>166 module-scale unused imports (F401), dominated by copy-pasted typing & lazy_imports headers</b> <i>(Dead code, S/low)</i></summary>

- **Location:** `api/*.py (ruff F401, 166 hits); e.g. typing.Dict/List/Optional at datasets.py:18, evaluation.py:15, inspector.py:30, models.py:15, nirs4all_adapter.py:23; .lazy_imports.is_ml_ready/require_ml_ready at automl.py:35, datasets.py:28, evaluation.py:24, inspector.py:35, models.py:25; pipeline_canonical.py:6 json, :8 pathlib.Path`
- **Evidence:** ruff check api/ --select F401 = 166 violations: typing.Dict x28, typing.List x28, typing.Optional x28, typing.Tuple x8, typing.Union x4, .lazy_imports.is_ml_ready x12, .lazy_imports.require_ml_ready x11, .lazy_imports.get_cached x3, datetime.timezone x5, plus 2x bare 'import nirs4all' unused. These modules use lowercase builtins (dict/list) yet import the capitalized typing aliases via copy-pasted headers.
- **Impact:** Import headers no longer reflect dependencies; the repeated lazy_imports.is_ml_ready/require_ml_ready imports falsely suggest each module gates on ML-readiness when it does not. Adds noise to every file's top and to the green gate (ruff is part of the gate).
- **Recommendation:** Run ruff check api/ --select F401 --fix (158 auto-fixable), then hand-review the 8 non-auto-fixable (the 2 'import nirs4all' availability probes likely need a noqa or find_spec rewrite).

</details>

<details><summary><code>BL-09</code> 🟡 <b>Dead VenvManager.create_venv method and dead downloadWebappUpdate legacy endpoint</b> <i>(Dead code, S/low)</i></summary>

- **Location:** `api/venv_manager.py:273-... (VenvManager.create_venv 'Legacy helper that creates a Python environment in-place'); api/updates.py:1594 (@router.post('/webapp/download') legacy endpoint); src/api/client.ts:2351 (downloadWebappUpdate)`
- **Evidence:** venv_manager.create_venv: grep '.create_venv(' / 'create_venv(' finds only its own def and the unrelated 400-stub route updates.py:1255 — no method invocation. downloadWebappUpdate (client.ts:2351, docstring '(legacy endpoint)') has zero callers in src/ (grep returns only its own definition); the UI uses /webapp/download-start (client.ts:2421). The /webapp/download backend route docstring says 'Use /webapp/download-start for the new job-based download.'
- **Impact:** An entire legacy in-process venv-creation method (~80 lines) is superseded by the desktop-managed flow (the route create_venv now just raises 400). The legacy webapp/download endpoint + its frontend wrapper are an unused parallel download path.
- **Recommendation:** Delete VenvManager.create_venv (and the legacy in-place builder body). Delete the /webapp/download route (updates.py:1594) and the downloadWebappUpdate client wrapper (client.ts:2351), keeping only download-start/-status/-cancel.
- **Depends on:** Confirm Electron shell does not POST /updates/webapp/download directly (it calls download-start).

</details>

<details><summary><code>BL-11</code> 🟡 <b>Live legacy-compat normalization shims reading already-saved data (na_policy, filter names, chain refs)</b> <i>(Legacy/compat, M/med)</i></summary>

- **Location:** `api/shared/dataset_config.py:42-75 (_LEGACY_NA_POLICY_ALIASES / normalize_na_policy*); api/shared/filter_operators.py:409-512 (legacy filter-name map + _translate_legacy_params); api/aggregated_predictions.py:76-81 + 504-526 (CHAIN_LEGACY_REFERENCE_ALIASES, _normalize_chain_reference) + 480-503 (_resolve_chain_id prefix match for 'legacy short IDs')`
- **Evidence:** dataset_config: '_LEGACY_NA_POLICY_ALIASES = {drop->remove_sample, keep->ignore}' added by recent commit 41d61fb to translate 'Drop'/'drop'/'keep' from 'older webapp builds'. filter_operators: '# Legacy name mappings for backward compatibility' maps OutlierFilter/RangeFilter/QCFilter/DistanceFilter to nirs4all classes via _translate_legacy_params (method/param remaps). aggregated_predictions: CHAIN_LEGACY_REFERENCE_ALIASES maps xgboost.sklearn.* -> xgboost.* for 'legacy short IDs', _resolve_chain_id does prefix match for '12-16 char truncated UUIDs from older runs'. All three are LIVE (called on every dataset build / filter instantiate / chain summary read).
- **Impact:** These are the genuine pre-v1 compat shims: they exist solely to keep datasets/pipelines/runs saved by older webapp builds working. With no backward-compat contract, they are removal targets — but unlike BL-01..BL-10 they touch persisted data, so deletion needs a one-time normalize-on-load or a clean-break decision.
- **Recommendation:** Decide the pre-v1 break: either (a) drop these shims and document that pre-v1 saved datasets/runs are not supported, or (b) keep ONLY na_policy/filter-name translation behind an explicit one-shot dataset/run upgrade step and delete the per-read translation. Do not silently keep all three indefinitely.
- **Depends on:** Product decision on whether v1 must read pre-v1 workspaces.

</details>

<details><summary><code>BL-07</code> ⚪ <b>Deprecated store_adapter method aliases never invoked</b> <i>(Legacy/compat, S/low)</i></summary>

- **Location:** `api/store_adapter.py:1322 (get_aggregated_predictions = get_chain_summaries), :1351 (get_top_aggregated_predictions = get_top_chain_summaries)`
- **Evidence:** Both lines are class-body assignment aliases tagged '# Deprecated alias'. grep for '.get_aggregated_predictions(' / '.get_top_aggregated_predictions(' across api/ and src/ returns zero method-call sites; the route functions of the same name in aggregated_predictions.py:777/816 are unrelated FastAPI handlers that call get_chain_summaries directly.
- **Impact:** Dead aliases that imply a second public name for store methods; no caller exists in any layer.
- **Recommendation:** Delete both alias lines (1322 and 1351).

</details>

<details><summary><code>BL-08</code> ⚪ <b>Dead backward-compat filter exports (BaseFilter=None, FILTER_REGISTRY={})</b> <i>(Legacy/compat, S/low)</i></summary>

- **Location:** `api/shared/filter_operators.py:515-526 (BaseFilter/OutlierFilter/RangeFilter/QCFilter/DistanceFilter = None; FILTER_REGISTRY = {})`
- **Evidence:** Block comment '# Backward compatibility exports (deprecated) ... kept only for imports that might reference them directly'. BaseFilter and FILTER_REGISTRY have 0 references anywhere (api/, src/). The OutlierFilter/RangeFilter/QCFilter/DistanceFilter names that DO appear (lines 410-413, 448-497) are string dict keys in the live filter_map / _translate_legacy_params, NOT uses of these =None module attributes.
- **Impact:** Module attributes set to None purely as removed-symbol placeholders; nothing imports them, so they are pure noise that suggests a public filter API that no longer exists.
- **Recommendation:** Delete lines 515-526 (the five =None assignments and the empty FILTER_REGISTRY).

</details>

<details><summary><code>BL-10</code> ⚪ <b>Dead no-op backward-compat branch in _normalize_params (MinMaxScaler)</b> <i>(Dead code, S/low)</i></summary>

- **Location:** `api/nirs4all_adapter.py:221-226 (if name == 'MinMaxScaler': ... pass)`
- **Evidence:** The branch body is only a comment ('MinMaxScaler is already handled by the generic logic above ... Keep a fallback for backwards-compatibility with old configs that might still use the tuple directly.') followed by `pass`. It performs no operation.
- **Impact:** A pure no-op kept 'for backwards-compatibility' that does nothing; misleads readers into thinking MinMaxScaler needs special handling.
- **Recommendation:** Delete the entire `if name == 'MinMaxScaler':` block (lines 221-226).

</details>

<details><summary><code>BL-12</code> ⚪ <b>Legacy double-nested runs directory scan (workspace/workspace/runs)</b> <i>(Legacy/compat, S/low)</i></summary>

- **Location:** `api/runs.py:481-503 (legacy_runs_dir = Path(workspace.path)/'workspace'/'runs')`
- **Evidence:** Comment 'Legacy location: workspace.path / workspace / runs (for runs created before the path fix)'. The loader scans the primary runs dir, then re-scans a double-nested dir and dedupes by run.id — purely to surface runs written by a build with a since-fixed path bug.
- **Impact:** Duplicate filesystem scan + dedup logic kept only for runs created before a path bug was fixed; pre-v1 there is no need to honor that mislocated layout.
- **Recommendation:** Delete the legacy_runs_dir block (481-503) and the backward-compat note in the docstring (457-458).
- **Depends on:** BL-11 product decision (same 'support pre-v1 on-disk data?' question).

</details>


### 5.5 Backend boundary violations — adapter layer (api/nirs4all_adapter.py, api/pipeline_canonical.py, api/store_adapter.py [boundary lens], api/shared/pipeline_service.py, api/shared/dataset_config.py, api/recommended_config.py)

*Reviewed: api/nirs4all_adapter.py (2087, full), api/pipeline_canonical.py (2248, full), api/store_adapter.py (2396, boundary-relevant sections ~1-520, 1540-2220), api/shared/pipeline_service.py (981, full), api/shared/dataset_config.py (352, full), api/recommended_config.py (1-120), plus caller tracing in api/runs.py, api/training.py, api/pipelines.py, api/system.py, api/workspace.py and tests/*

The adapter layer's biggest debt is a large, dead, pre-canonical pipeline-build path in nirs4all_adapter.py (build_full_pipeline / build_full_step / the generator builders / build_native_pipeline / YAML import-export) that has been superseded by pipeline_canonical.py + expand_pipeline_variants but never deleted — only tests reference it. The root cause is two generations of editor↔nirs4all converters coexisting: pipeline_canonical.py is the live registry-driven converter, while nirs4all_adapter.py still carries the old hand-rolled converter plus a third operator resolver in pipeline_service.py, so operator name→class resolution, alias maps, and param normalization are triplicated with drift. On the genuine boundary axis, the backend does NOT compute metrics (it correctly delegates to nirs4all.get_metric_info), but store_adapter.py reverse-engineers nirs4all pipeline/CV semantics — pairing refit chains to CV chains by re-deriving signatures, synthesizing refit scores, and inferring CV strategy/folds by re-parsing splitter class paths — logic that belongs in nirs4all's storage/query layer that already produces v_chain_summary. store_adapter is also a 2396-LOC god module mixing SQL, ranking, and ML-structure inference. Lower-severity debt: an unused import in training.py and hardcoded model alias maps duplicating the node registry.

| ID | Sev | Cat | Title | Effort/Risk |
|---|---|---|---|---|
| `BV-01` ⤿ | 🟠 | Dead code | Dead legacy pipeline-build path: build_full_pipeline / build_full_step / generator builders | M/low |
| `BV-02` ⤿ | 🟠 | Dead code | Dead native-format pipeline builder: build_native_pipeline + _build_native_step + native helpers | M/low |
| `BV-04` | 🟠 | Duplication | Operator name→class resolution triplicated across three adapter modules | L/med |
| `BV-06` | 🟠 | Boundary violation | Backend reverse-engineers nirs4all CV/refit-chain pairing and refit-score synthesis | L/high |
| `BV-03` ⤿ | 🟡 | Dead code | Dead YAML import/export pipeline serializers | S/low |
| `BV-05` | 🟡 | Duplication | Two implementations of _normalize_params with diverging operator special-cases | M/med |
| `BV-07` | 🟡 | Boundary violation | Backend infers CV strategy/folds by re-parsing splitter class paths from expanded config | M/med |
| `BV-08` ⤿ | 🟡 | God class | store_adapter.py is a 2396-LOC god module mixing SQL, ranking, and ML-structure inference | L/med |
| `BV-09` | 🟡 | Duplication | Parallel Python-codegen export path with its own alias maps (export_pipeline_to_python) | M/med |
| `BV-10` | ⚪ | Dead code | Unused import extract_metrics_from_prediction in training.py (and dead function) | S/low |
| `BV-11` | ⚪ | Legacy/compat | Hardcoded model alias maps duplicate the generated node registry | M/low |

<details><summary><code>BV-01</code> 🟠 <b>Dead legacy pipeline-build path: build_full_pipeline / build_full_step / generator builders</b> <i>(Dead code, M/low)</i> · **⤿ merged**</summary>

- **Location:** `api/nirs4all_adapter.py:476-531 (build_pipeline_steps), 594-851 (_build_generator_sweep/_sweep_to_param_node/_build_or_generator/_build_branch/_build_generator_step), 853-1169 (build_full_step/build_full_pipeline)`
- **Evidence:** codegraph_callers: build_full_pipeline → only test_build_full_pipeline_prefers_class_model_classpath (tests/test_pipeline_canonical.py:846); build_pipeline_steps → 'No callers found'. Grep across api/ for build_full_pipeline, build_full_step, build_pipeline_steps, _build_or_generator, _build_generator_step, _step_to_python_code returns zero non-definition hits outside nirs4all_adapter.py. The live runtime path is expand_pipeline_variants() (nirs4all_adapter.py:1183) which uses editor_steps_to_runtime_canonical() from pipeline_canonical.py, NOT build_full_*. build_full_pipeline's own docstring says '.. deprecated:: Use build_native_pipeline instead' (line 1043).
- **Impact:** ~700 LOC of unmaintained converter logic with its own generator/branch/sweep semantics that must be mentally reconciled against the live pipeline_canonical converter. It is a magnet for 'fix the bug in both places' mistakes and inflates the adapter's apparent surface. Pre-v1 with no compat contract, it is pure debt.
- **Recommendation:** Delete build_pipeline_steps, build_full_step, build_full_pipeline, _build_generator_sweep, _sweep_to_param_node, _build_or_generator, _build_branch, _build_generator_step, FullPipelineBuildResult, PipelineBuildResult and the test test_build_full_pipeline_prefers_class_model_classpath. Keep expand_pipeline_variants and the helpers it shares (_resolve_operator_class, _operator_reference_from_step, _component_display_name).
- **Depends on:** Confirm _normalize_params/_resolve_class still needed by export_pipeline_to_python and _build_y_processing (they are — 6/15 refs).

</details>

<details><summary><code>BV-02</code> 🟠 <b>Dead native-format pipeline builder: build_native_pipeline + _build_native_step + native helpers</b> <i>(Dead code, M/low)</i> · **⤿ merged**</summary>

- **Location:** `api/nirs4all_adapter.py:1680-1986 (_resolve_class_by_name, _instantiate_native, _instantiate_native_list, build_native_pipeline, _build_native_step, _build_native_finetune_params) and 1714-1755`
- **Evidence:** codegraph_callers: build_native_pipeline → only _build_native_step (api/nirs4all_adapter.py:1793), i.e. it only calls itself recursively. Grep for build_native_pipeline / _build_native_step across api/ and tests/ returns zero external callers. This whole 'Phase 5 Native Pipeline Format' block (header comment line 1657) is orphaned; the editor sends editor-format steps that go through pipeline_canonical.editor_to_canonical, and runtime uses editor_steps_to_runtime_canonical.
- **Impact:** ~300 LOC of a second, never-invoked instantiation path (instantiates operators eagerly via importlib, duplicating _resolve_operator_class) plus _resolve_class_by_name (a fourth alias/module resolver, lines 1680-1711). Dead code that re-implements operator instantiation the live canonical path already covers.
- **Recommendation:** Delete build_native_pipeline, _build_native_step, _instantiate_native, _instantiate_native_list, _build_native_finetune_params, _resolve_class_by_name, and the ALL_RESOLVE_MODULES/_ALL_ALIASES module-globals (1662-1677) that only _resolve_class_by_name uses.

</details>

<details><summary><code>BV-04</code> 🟠 <b>Operator name→class resolution triplicated across three adapter modules</b> <i>(Duplication, L/med)</i></summary>

- **Location:** `api/nirs4all_adapter.py:392-473 (_resolve_class/_resolve_operator_class), api/pipeline_canonical.py:330-427 (resolve_class_reference/resolve_editor_class_path), api/shared/pipeline_service.py:35-340 (_build_*_cache/resolve_operator)`
- **Evidence:** Three independent resolvers each with their own module-scan lists and alias maps: nirs4all_adapter has PREPROCESSING_ALIASES/SPLITTER_ALIASES/MODEL_ALIASES + NIRS4ALL_*_MODULES/SKLEARN_*_MODULES/THIRDPARTY_MODEL_MODULES (lines 39-101) and walks them in _resolve_class; pipeline_service builds _preprocessing_cache/_splitter_cache/_augmentation_cache by importlib-scanning ~17 sklearn modules + nirs4all __all__ (lines 88-215) with its OWN common_aliases (snv/msc/savgol…) at 52-60; pipeline_canonical resolves via the generated node registry (_reference_lookup) plus MODEL_CLASS_PATH_ALIASES (53-75). The sklearn module lists and alias spellings differ between the three (e.g. pipeline_service includes sklearn.cluster/manifold/impute; nirs4all_adapter does not).
- **Impact:** A new operator or alias must be added in up to three places with three different conventions; they already drift (different sklearn module coverage, different alias spellings). High maintenance tax and a source of 'works in playground, fails at run' class-resolution mismatches.
- **Recommendation:** Make pipeline_canonical's registry-backed resolver (resolve_class_reference / resolve_editor_class_path) the single resolver. Have pipeline_service.resolve_operator and nirs4all_adapter delegate to it (resolving the dotted classPath, then a thin importlib import). Delete the duplicate alias maps and module-scan lists once callers are migrated.
- **Depends on:** BV-01, BV-02 (delete dead consumers of nirs4all_adapter's resolver first to shrink migration surface).

</details>

<details><summary><code>BV-06</code> 🟠 <b>Backend reverse-engineers nirs4all CV/refit-chain pairing and refit-score synthesis</b> <i>(Boundary violation, L/high)</i></summary>

- **Location:** `api/store_adapter.py:413-572 (_chain_match_signature, _enrich_refit_with_cv_inplace, _mark_refit_only_entries_inplace, _build_synthetic_final_scores, _apply_synthetic_refit_fallback_inplace)`
- **Evidence:** _enrich_refit_with_cv_inplace (519-572) re-derives the relationship between refit-only chains and their CV siblings by building a signature (model_class, model_name, preprocessings, serialized variant_params) — _chain_match_signature (413-424) — and copying cv_* fields across rows. _apply_synthetic_refit_fallback_inplace (481-495) fabricates final_test_score/final_scores from cv_* values and sets synthetic_refit=True, and _build_synthetic_final_scores (458-478) reconstructs a per-partition {metric: score} payload. This is ML run-structure knowledge (which chain is a refit of which CV variant, what a 'final' score means) reconstructed in the webapp from raw rows, instead of being produced by nirs4all's v_chain_summary / WorkspaceStore query layer.
- **Impact:** The webapp encodes nirs4all's CV/refit semantics; if nirs4all changes how refit chains relate to CV chains (e.g. chain_id scheme, variant_params shape), the studio silently mis-pairs or fabricates wrong 'final' scores. This is exactly the boundary the BACKEND_RULES forbid: data/ML logic leaking into the orchestration layer. Comments even call these 'webapp-only' fallbacks (line 482), acknowledging the divergence.
- **Recommendation:** Push the refit↔CV pairing and synthetic-final logic into nirs4all's storage/query layer (extend v_chain_summary or add a WorkspaceStore method returning paired/enriched chain summaries). The studio should consume enriched rows and only sanitize/format for JSON. If nirs4all lacks it, raise upstream rather than maintaining the signature-matching here.
- **Depends on:** Requires a nirs4all-side query/view change; coordinate before deleting the studio fallbacks.

</details>

<details><summary><code>BV-03</code> 🟡 <b>Dead YAML import/export pipeline serializers</b> <i>(Dead code, S/low)</i> · **⤿ merged**</summary>

- **Location:** `api/nirs4all_adapter.py:1583-1626 (export_pipeline_to_yaml), 1629-1654 (import_pipeline_from_yaml)`
- **Evidence:** Grep for export_pipeline_to_yaml and import_pipeline_from_yaml across api/ and tests/ returns zero non-definition hits. They build an ad-hoc {name,description,version:'1.0',steps:[...]} YAML shape that is NOT nirs4all canonical YAML (which pipeline_canonical/validate_canonical handle via PipelineConfigs). Only export_pipeline_to_python (line 1422) is actually wired (pipelines.py:1740).
- **Impact:** Bespoke non-canonical YAML schema that, if ever revived, would diverge from nirs4all's real YAML/JSON pipeline format owned by pipeline_canonical. Confusing dead surface in the export region.
- **Recommendation:** Delete export_pipeline_to_yaml and import_pipeline_from_yaml. If YAML round-trip is ever needed, route it through editor_to_canonical/canonical_to_editor + yaml.dump so a single canonical schema is used.

</details>

<details><summary><code>BV-05</code> 🟡 <b>Two implementations of _normalize_params with diverging operator special-cases</b> <i>(Duplication, M/med)</i></summary>

- **Location:** `api/nirs4all_adapter.py:197-244 (_normalize_params) vs api/shared/pipeline_service.py:391-497 (normalize_params)`
- **Evidence:** Both reconstruct tuple params from _min/_max suffix pairs (nirs4all_adapter 205-219; pipeline_service 410-418) — near-identical loops. They then diverge: nirs4all_adapter special-cases SavitzkyGolay/MovingAverage/CropTransformer; pipeline_service special-cases LogTransform/CARS/Resampler/MinMaxScaler/RobustScaler and injects nested estimators for sklearn meta-estimators (464-496). Neither is a superset of the other, so the same frontend params normalize differently depending on which path runs (playground via pipeline_service vs export/expand via nirs4all_adapter).
- **Impact:** Operator params can be normalized inconsistently between playground preview and actual run/export, producing 'preview worked but run failed' or silently different constructor args. Two places to fix any param-mapping bug.
- **Recommendation:** Consolidate into one normalize_params in shared/pipeline_service.py (the richer one) and have nirs4all_adapter import it. Merge the SavitzkyGolay/MovingAverage/CropTransformer cases into it.
- **Depends on:** BV-01 (removes the build_full_step caller; remaining nirs4all_adapter callers are export_pipeline_to_python and _build_y_processing).

</details>

<details><summary><code>BV-07</code> 🟡 <b>Backend infers CV strategy/folds by re-parsing splitter class paths from expanded config</b> <i>(Boundary violation, M/med)</i></summary>

- **Location:** `api/store_adapter.py:170-312 (_is_internal_refit_splitter_reference, _strategy_key_from_reference, _infer_pipeline_runtime_config, _infer_run_config_from_pipelines)`
- **Evidence:** _strategy_key_from_reference (194-218) hardcodes a class-name→strategy map (kfold→kfold, stratifiedkfold→stratified_kfold, fulltrainfoldsplitter→full_train, …) and _infer_pipeline_runtime_config (221-282) walks the stored expanded_config steps, extracts the splitter class via _extract_step_reference, and reverse-engineers cv_folds (n_splits/cv_folds), random_state, shuffle, test_size, group_by. It even special-cases nirs4all's internal '_FullTrainFoldSplitter' (170-173) to detect refit pipelines.
- **Impact:** The webapp re-implements knowledge of nirs4all's splitter taxonomy and internal refit-splitter naming. Adding/renaming a splitter in nirs4all (or the internal full-train splitter) silently breaks CV-strategy display and refit detection. The CV configuration that produced a run should come from nirs4all run metadata, not be re-parsed from serialized steps in the UI layer.
- **Recommendation:** Persist/return CV strategy + folds + refit flags from nirs4all run metadata (the runner already knows them) and read them in store_adapter instead of re-deriving from class-path string matching. At minimum, move the splitter taxonomy map into nirs4all and import it.
- **Depends on:** BV-06 (same v_chain_summary / run-metadata enrichment effort).

</details>

<details><summary><code>BV-08</code> 🟡 <b>store_adapter.py is a 2396-LOC god module mixing SQL, ranking, and ML-structure inference</b> <i>(God class, L/med)</i> · **⤿ merged**</summary>

- **Location:** `api/store_adapter.py:1-2396 (module-level helpers 47-573 + StoreAdapter class 575-2396)`
- **Evidence:** Single module holds: float/json sanitizers (47-90), prediction-record normalization (315-339), pipeline-runtime inference (170-312), refit/CV chain-pairing (377-572), and the StoreAdapter class with hand-written DuckDB SQL incl. nested UNNEST/json_keys artifact-size queries (1900-1933), per-dataset Python ranking with deferred JSON deserialization (2118-2220), top-5 chain assembly (1625-1725). Methods like get_dataset_top_chains carry multi-paragraph 'Phase 5 of the startup-perf plan' docstrings (2127-2141) describing bespoke ranking. 2396 LOC, dozens of free functions + one large class.
- **Impact:** Hard to navigate/test; the boundary-violating inference (BV-06/BV-07) is entangled with legitimate thin-adapter SQL formatting, so it is hard to see where the studio overreaches. Raises the cost of every results-page change.
- **Recommendation:** After BV-06/BV-07 move chain-pairing/CV-inference into nirs4all, split the remainder: a results_query module (SQL + ranking) and a serialization module (_sanitize_*/_normalize_prediction_record/_serialize_chain_summary_row). Keep StoreAdapter as a thin facade over WorkspaceStore.
- **Depends on:** BV-06, BV-07

</details>

<details><summary><code>BV-09</code> 🟡 <b>Parallel Python-codegen export path with its own alias maps (export_pipeline_to_python)</b> <i>(Duplication, M/med)</i></summary>

- **Location:** `api/nirs4all_adapter.py:1422-1580 (export_pipeline_to_python, _step_to_python_code, _finetune_to_python_code)`
- **Evidence:** export_pipeline_to_python (live: pipelines.py:1740) emits nirs4all source by string-templating steps via _step_to_python_code (1497-1561), re-applying PREPROCESSING_ALIASES/SPLITTER_ALIASES/MODEL_ALIASES (1509-1516) and re-encoding generator syntax ({"_range_": ...}, 1540-1551) and finetune params (1564-1580) — a third encoding of nirs4all pipeline syntax independent of pipeline_canonical's editor_to_canonical and of build_full_step. The import header it emits (1444-1458) hardcodes a fixed set of nirs4all/sklearn classes regardless of what the pipeline uses.
- **Impact:** Generated code can drift from the canonical representation and from runtime behavior (different alias resolution, hardcoded imports that may not match used operators or may import unused ones). Any nirs4all syntax change must be mirrored in this string templater too.
- **Recommendation:** Generate the Python export from the canonical representation (editor_to_canonical) — emit `pipeline = <repr of canonical list>` and a generic `nirs4all.run(pipeline=pipeline, dataset=...)`, deriving imports from the actual class paths in the canonical steps. Removes the parallel alias/generator encoding.
- **Depends on:** BV-04 (shared resolver) helps derive imports from classPaths.

</details>

<details><summary><code>BV-10</code> ⚪ <b>Unused import extract_metrics_from_prediction in training.py (and dead function)</b> <i>(Dead code, S/low)</i></summary>

- **Location:** `api/nirs4all_adapter.py:537-558 (extract_metrics_from_prediction), imported at api/training.py:33`
- **Evidence:** codegraph_callers: extract_metrics_from_prediction → 'No callers found'. Repo-wide grep shows the only reference is the import statement at training.py:33; there is no call site. The function itself hand-extracts r2/rmse/mae/rpd/nrmse from a prediction dict — metric values that originate in nirs4all predictions.
- **Impact:** Misleading import implying the webapp post-processes metrics; small but it is exactly the kind of metric-handling that must not creep back into the backend. Trivial dead code.
- **Recommendation:** Remove the function and the unused import in training.py.

</details>

<details><summary><code>BV-11</code> ⚪ <b>Hardcoded model alias maps duplicate the generated node registry</b> <i>(Legacy/compat, M/low)</i></summary>

- **Location:** `api/pipeline_canonical.py:53-102 (MODEL_CLASS_PATH_ALIASES, MODEL_DISPLAY_NAME_ALIASES) and api/nirs4all_adapter.py:39-63 (PREPROCESSING_ALIASES/SPLITTER_ALIASES/MODEL_ALIASES)`
- **Evidence:** pipeline_canonical already resolves via the generated node registry (_reference_lookup/_name_type_lookup, which read node.name/classPath/aliases/legacyClassPaths from load_editor_registry_nodes), yet still carries ~50 hardcoded lowercase→classPath model mappings (xgboost/lightgbm/tabpfn variants, incl. legacy 'nirs4all.operators.models.tabpfn' paths at 73-74,97). The legacyClassPaths field in the registry (referenced at pipeline_canonical.py:262) is the intended home for these; the inline maps are a parallel, manually-maintained alias source.
- **Impact:** Aliases must be kept in sync between the JSON registry and these inline dicts; the explicit 'legacy' nirs4all.operators.models.tabpfn entries are stale-path shims that should live as registry legacyClassPaths, not code constants.
- **Recommendation:** Move the model classPath/display aliases and legacy paths into the node registry (aliases / legacyClassPaths) and resolve everything through _reference_lookup. Delete MODEL_CLASS_PATH_ALIASES/MODEL_DISPLAY_NAME_ALIASES once the registry carries them; fold nirs4all_adapter's alias dicts into the shared resolver (BV-04).
- **Depends on:** BV-04

</details>


### 5.6 Frontend state management, large pages, antipatterns & visible bugs (src/context/* cluster + RunProgress/PipelineEditor/Predictions)

*Reviewed: src/context/SelectionContext.tsx (1136), src/context/InspectorSelectionContext.tsx (452), src/context/InspectorDataContext.tsx (451), src/context/InspectorViewContext.tsx (317), src/context/InspectorColorContext.tsx (223), src/context/InspectorFilterContext.tsx (212), src/context/InspectorSessionContext.tsx (208), src/context/PlaygroundViewContext.tsx (446), src/context/PlaygroundSessionContext.tsx (238), src/context/FilterContext.tsx (323), src/context/OutliersContext.tsx (335), src/pages/RunProgress.tsx (1425), src/pages/PipelineEditor.tsx (1289), src/pages/Predictions.tsx (1069), src/hooks/usePlaygroundShortcuts.ts (partial), src/pages/Inspector.tsx + Playground.tsx provider stacks, src/types/inspector.ts (color defaults)*

The context layer is over-built relative to what consumers actually use. SelectionContext (1136 LOC) ships an entire second state-distribution mechanism — a useSyncExternalStore selector store plus a separate HoverContext — that has zero consumers; the page-level HoverContext hooks (useHover/useHoveredSample) and all selector hooks (useSelectionSelector/useSelectedSamples/usePinnedSamples/useIsSelected) and useSelectionState are dead. SelectionContext and InspectorSelectionContext are near-identical twins (number-indices vs string-chain-ids) but one extracted the history helper and the other inlined the slice/push/shift block 15 times. The biggest concrete bug is competing global keydown handlers: SelectionContext and usePlaygroundShortcuts both bind window keydown for Escape/Ctrl+Z/Ctrl+Shift+Z on the Playground page, so SelectionContext clobbers selection state the playground hook deliberately tries to preserve for pipeline-undo. The three audited pages are god-components (Predictions 1069, PipelineEditor 1289, RunProgress 1425) mixing data-massaging, IO, and 700+ lines of inline JSX; PipelineEditor carries a dead DatasetBinding render (false &&) plus its feeding useMemo and three copy-pasted import useEffects, and RunProgress tears down/recreates its log-polling interval every 1s because the react-query run object is in the effect deps.

| ID | Sev | Cat | Title | Effort/Risk |
|---|---|---|---|---|
| `FE-01-state` | 🟠 | Bug | Competing global keydown handlers on Playground: SelectionContext clobbers selection on Ctrl+Z/Escape | S/med |
| `FE-02-state` | 🟠 | Dead code | Dead selector-store + HoverContext machinery in SelectionContext (zero consumers) | S/low |
| `FE-03-state` | 🟡 | Dead code | Dead DatasetBinding render block + feeding useMemo + duplicate import useEffects in PipelineEditor | M/low |
| `FE-04-state` | 🟡 | Performance | RunProgress log-polling interval recreated every 1s (effect depends on react-query run object) | S/med |
| `FE-05-state` | 🟡 | Duplication | SelectionContext & InspectorSelectionContext are duplicated twins; history block inlined 15x in one, extracted in the other | M/low |
| `FE-06-state` | 🟡 | God class | Predictions.tsx is a god-page: data transforms, IO, sorting, paging, export, and 4 viewers in one 1069-line component | L/med |
| `FE-07-state` | 🟡 | God class | RunProgress god-page conflates a WebSocket protocol layer, 5 presentational subcomponents, and a 225-line render | L/med |
| `FE-08-state` | ⚪ | Antipattern | Context-provider over-fragmentation: 6 Inspector + 5 Playground providers nested per page, several mostly pass-through | L/med |
| `FE-09-state` | ⚪ | Antipattern | OutliersContext initialDetectedOutliers prop is captured once in lazy initializer — silently stale on prop change | S/low |
| `FE-10-state` | ⚪ | Antipattern | InspectorSessionContext.hasSession useMemo([]) calls loadSession() at render and never updates | S/low |
| `FE-11-state` | ⚪ | Dead code | InspectorColorContext.getChainOpacity branches on highlightHover/highlightSelection config that has no setter | S/low |

<details><summary><code>FE-01-state</code> 🟠 <b>Competing global keydown handlers on Playground: SelectionContext clobbers selection on Ctrl+Z/Escape</b> <i>(Bug, S/med)</i></summary>

- **Location:** `src/context/SelectionContext.tsx:877-918 and src/hooks/usePlaygroundShortcuts.ts:289-296,354-391,566`
- **Evidence:** SelectionContext mounts its own window.addEventListener('keydown') (line 916) that unconditionally dispatches UNDO on Ctrl+Z (889-893), REDO on Ctrl+Shift+Z/Ctrl+Y (896-907), and CLEAR on Escape (910-913). usePlaygroundShortcuts ALSO binds window keydown (line 566) with id:'undo' keys:'Ctrl+Z' whose handler prioritizes pipeline undo: `if (canUndo && onUndo) onUndo(); else if (canUndoSelection) selectionUndo();` (360-363), and id:'clear-selection' keys:'Escape' (293-295). Both providers are live simultaneously on Playground (Playground.tsx:438 SelectionProvider, :696 usePlaygroundShortcuts).
- **Impact:** On Playground a single Ctrl+Z fires BOTH listeners: the playground hook may intend a pipeline undo (leaving selection intact) but SelectionContext's listener also runs and pops selection history, so selection state changes unexpectedly. Escape triggers two CLEAR dispatches. Non-deterministic undo/clear behavior — a user-visible correctness bug.
- **Recommendation:** Remove the keyboard useEffect from SelectionContext (877-918) entirely and let usePlaygroundShortcuts be the single owner of Playground keybindings (it already calls selectionUndo/selectionRedo/clear). Inspector has the same duplicate pattern in InspectorSelectionContext:340-370 — keep only one owner per page.

</details>

<details><summary><code>FE-02-state</code> 🟠 <b>Dead selector-store + HoverContext machinery in SelectionContext (zero consumers)</b> <i>(Dead code, S/low)</i></summary>

- **Location:** `src/context/SelectionContext.tsx:737-786, 845-866, 1101-1114, 1128-1134`
- **Evidence:** useSelectionSelector/useSelectedSamples/usePinnedSamples/useIsSelected (756-786) and useHover/useHoveredSample (721-735) and useSelectionState (1131) are exported but grep across all of src finds zero callers outside SelectionContext.tsx. The supporting infra is therefore also dead: SelectionStore interface + SelectionStoreContext (741-746), stateRef/subscribersRef + store useMemo (849-861), the subscriber-notify useEffect (864-866), useSyncExternalStore (764), the separate hoveredSample useState (846) and HoverContext.Provider/SelectionStoreContext.Provider wrappers (1108-1114), and the hoverValue useMemo (1102-1105). Hover is in fact consumed only via useSelection().hoveredSample which is overridden into the main value at line 1035.
- **Impact:** ~200 LOC of unused state-distribution machinery (two parallel mechanisms next to the real reducer) inflates the largest context file, runs a subscriber-notify effect on every state change for no subscriber, and confuses future maintainers about which path is canonical.
- **Recommendation:** Delete useSelectionSelector/useSelectedSamples/usePinnedSamples/useIsSelected/useHover/useHoveredSample/useSelectionState and all SelectionStore/HoverContext infrastructure. Keep hoveredSample as the existing useState exposed through the single useSelection value.

</details>

<details><summary><code>FE-03-state</code> 🟡 <b>Dead DatasetBinding render block + feeding useMemo + duplicate import useEffects in PipelineEditor</b> <i>(Dead code, M/low)</i></summary>

- **Location:** `src/pages/PipelineEditor.tsx:211-236, 836-852, 266-372`
- **Evidence:** The only <DatasetBinding> render is gated by `{/* eslint-disable-next-line no-constant-binary-expression */ false && ( <DatasetBinding ... /> )}` (837-852) — permanently dead. Its sole feeder, the dimensionWarnings useMemo (211-236, iterating all steps/branches/children), produces a value used only inside that dead block (hasWarnings/warningMessage at 846-848). Separately, three import useEffects (playground @266-307, chainId @310-340, runPipelineId @343-372) are ~90% identical copy-paste differing only in the API call and toast text.
- **Impact:** Dead UI plus a non-trivial recursive useMemo recomputed on every steps/boundDataset change for output nobody renders; three near-duplicate effects triple the maintenance surface for the import flow.
- **Recommendation:** Delete the false && DatasetBinding block, the dimensionWarnings useMemo, and the DatasetBinding import/destructured fields it needs (boundDataset etc. are still used by DatasetBindingProvider at 1150, so keep those). Collapse the three import effects into one effect that reads a (paramName, fetcher, reloadDescriber) table.

</details>

<details><summary><code>FE-04-state</code> 🟡 <b>RunProgress log-polling interval recreated every 1s (effect depends on react-query run object)</b> <i>(Performance, S/med)</i></summary>

- **Location:** `src/pages/RunProgress.tsx:1078-1090, 969-1000`
- **Evidence:** The polling effect deps are [run, runId, loadPersistedLogs] (1090); loadPersistedLogs deps are [runId, run] (1000). The run query polls every 1000ms while running (refetchInterval at 797-804) and react-query returns a fresh object each poll, so `run` identity changes every second. That re-runs the effect, clearing and recreating the 5s setInterval (1083-1086) and immediately re-invoking loadPersistedLogs (1080) on every 1s poll. Additionally handleWsUpdate calls queryClient.invalidateQueries on EVERY ws message (811), compounding refetch churn.
- **Impact:** While a run is active, persisted logs are re-fetched far more often than the intended 5s cadence (effectively ~1s plus every ws message), each fetch fanning out one getPipelineLogs request per pipeline (983-991). Wasted network and CPU; the 5s interval never actually governs cadence.
- **Recommendation:** Depend on run.status (not the whole run object) for the polling effect, and gate loadPersistedLogs on stable inputs (runId + status). Debounce/throttle the ws-driven invalidateQueries so each message doesn't force a refetch.

</details>

<details><summary><code>FE-05-state</code> 🟡 <b>SelectionContext & InspectorSelectionContext are duplicated twins; history block inlined 15x in one, extracted in the other</b> <i>(Duplication, M/low)</i></summary>

- **Location:** `src/context/SelectionContext.tsx:160-703 and src/context/InspectorSelectionContext.tsx:120-279`
- **Evidence:** Both files implement the same reducer surface (SELECT/DESELECT/TOGGLE/SELECT_ALL/INVERT/UNDO/REDO/PIN/UNPIN/SAVE_SELECTION/LOAD_SELECTION/RESTORE), same MAX_HISTORY=10, same sessionStorage persist+keyboard pattern, differing only in number-index vs string-chain-id. InspectorSelectionContext extracted the slice/push/shift history step into a pushHistory() helper (line 120) and calls it; SelectionContext inlines the identical `const newHistory = state.selectionHistory.slice(...); newHistory.push(...); if (newHistory.length > MAX_HISTORY) newHistory.shift();` block 15 times (grep -c newHistory.push = 15).
- **Impact:** ~1100 LOC of parallel logic that must be edited in lockstep; the inlined 15x history block in SelectionContext is a transcription-error magnet and proves the helper refactor was applied to only one twin.
- **Recommendation:** At minimum extract a pushHistory() helper in SelectionContext mirroring the Inspector one to kill the 15 inline copies. Longer-term, factor a generic createSelectionReducer<T>(idType) shared by both contexts.

</details>

<details><summary><code>FE-06-state</code> 🟡 <b>Predictions.tsx is a god-page: data transforms, IO, sorting, paging, export, and 4 viewers in one 1069-line component</b> <i>(God class, L/med)</i></summary>

- **Location:** `src/pages/Predictions.tsx:239-1069`
- **Evidence:** Single default export holds 27 useState slices (241-266), pagination, 11 useMemo facet/derivation blocks (289-538) including buildPredictionModelRows grouping/merge logic, the entire sort comparator with metric/score map traversal (377-423), export dialog + blob download (618-665), and ~320 lines of inline JSX with an inner SortableHeader component (672-693) and an inline IIFE-rendered viewer (1010-1039). Free helper functions (predictionGroupKey, foldSortValue, buildPredictionModelRows, etc., 91-237) are score-shaping logic that lives in the page file.
- **Impact:** Every concern is coupled in one render scope; the sort closure and facet memos all re-run together and the file is hard to test (the test file targets only fragments). High change-friction before v1.
- **Recommendation:** Extract buildPredictionModelRows + sort/facet derivations into a usePredictionRows() hook (or src/lib/predictions), move the export-dialog and quick-view/detail viewers into child components, and lift SortableHeader out of the component body.

</details>

<details><summary><code>FE-07-state</code> 🟡 <b>RunProgress god-page conflates a WebSocket protocol layer, 5 presentational subcomponents, and a 225-line render</b> <i>(God class, L/med)</i></summary>

- **Location:** `src/pages/RunProgress.tsx:57-231, 253-758, 760-1425`
- **Evidence:** One file declares the full ws message contract (WsMessage/ProgressState/GranularProgress/RefitState 57-131), the useRunWebSocket connection+reconnect hook (134-231), five subcomponents (StatusBadge, MetricsCard, PipelineProgress, LogsPanel, RefitPhaseIndicator 242-757) plus parseLogContext/downloadTextFile/sanitizeFilename, and the page itself with 14 useState slices and a 130-message-type switch in handleWsUpdate (808-911). handleWsUpdate manually fans 12+ message.type string literals into setGranularProgress/setRefitState.
- **Impact:** ML run-progress protocol decoding, reconnection, and presentation are all in one 1425-line module; the message-type switch is brittle and untestable in isolation, and the ws types duplicate fields (total_folds appears twice in the same interface, 73/85).
- **Recommendation:** Move WsMessage types + useRunWebSocket + the message->state reducer into src/lib/run-progress (a single reducer over message.type instead of stacked if-blocks), and split the five subcomponents into src/components/runs. Keep the page as orchestration only.

</details>

<details><summary><code>FE-08-state</code> ⚪ <b>Context-provider over-fragmentation: 6 Inspector + 5 Playground providers nested per page, several mostly pass-through</b> <i>(Antipattern, L/med)</i></summary>

- **Location:** `src/pages/Inspector.tsx:22-34, src/pages/Playground.tsx:435-511, src/context/ (18 context files)`
- **Evidence:** Inspector nests Session>Data>Selection>Filter>Color>View 6 deep (Inspector.tsx:22-34); Playground nests PipelineEditorPreferences>NodeRegistry>PlaygroundView>Selection>Filter>Outliers>ReferenceDataset 7 deep (Playground.tsx:435-441). InspectorSessionContext is a thin sessionStorage shim consumed only by sibling contexts via useInspectorSessionOptional (InspectorDataContext.tsx:20, InspectorViewContext.tsx:19) — it exists to wire other contexts, not UI. PlaygroundView and InspectorView are duplicate implementations of the same visible/hidden/maximized/minimized panel reducer with different element-type unions.
- **Impact:** Deep provider towers add render layers and make data flow hard to trace; the Session contexts are plumbing dressed as React context, and the two View contexts are copy-paste (PlaygroundViewContext.tsx:107-253 vs InspectorViewContext.tsx:83-164).
- **Recommendation:** Collapse the Session 'context' into a plain module/hook (it stores to sessionStorage via refs anyway), and factor the shared panel-visibility reducer into one generic createViewContext<PanelType>() used by both Inspector and Playground.

</details>

<details><summary><code>FE-09-state</code> ⚪ <b>OutliersContext initialDetectedOutliers prop is captured once in lazy initializer — silently stale on prop change</b> <i>(Antipattern, S/low)</i></summary>

- **Location:** `src/context/OutliersContext.tsx:180-191`
- **Evidence:** useReducer lazy init reads initialDetectedOutliers into merged.detectedOutliers (186-188) only on mount. There is no effect syncing later changes to the initialDetectedOutliers prop, and setDetectedOutliers (219) is the only update path. If a parent passes a new initialDetectedOutliers after detection completes, the context keeps the mount-time value.
- **Impact:** A prop named like a controlled input behaves as initialize-once; any caller updating it expects new detected outliers and gets stale ones — a latent correctness foot-gun.
- **Recommendation:** Either drop the prop and require callers to call setDetectedOutliers, or add a useEffect that dispatches SET_DETECTED when initialDetectedOutliers changes. Don't keep an initialize-once prop that looks controlled.

</details>

<details><summary><code>FE-10-state</code> ⚪ <b>InspectorSessionContext.hasSession useMemo([]) calls loadSession() at render and never updates</b> <i>(Antipattern, S/low)</i></summary>

- **Location:** `src/context/InspectorSessionContext.tsx:177-179, src/context/PlaygroundSessionContext.tsx:199-201`
- **Evidence:** hasSession = useMemo(() => loadSession() !== null, []) reads sessionStorage during render (a side-effect in render) with an empty dep array, so it is computed once at mount and never reflects later saveSession/clearSession. The identical pattern is in PlaygroundSessionContext:199-201. clearSession (169-175) nulls the ref but hasSession stays true.
- **Impact:** hasSession is effectively a constant snapshot; any consumer using it to show a 'resume session' affordance will be wrong after the session is cleared or first created in the same mount. Also performs a JSON.parse in render.
- **Recommendation:** Derive hasSession from sessionRef state with a setter (or expose hasSession via state updated in save/clear), and never call sessionStorage/JSON.parse inside useMemo render — move it to the mount useEffect that already loads the session.

</details>

<details><summary><code>FE-11-state</code> ⚪ <b>InspectorColorContext.getChainOpacity branches on highlightHover/highlightSelection config that has no setter</b> <i>(Dead code, S/low)</i></summary>

- **Location:** `src/context/InspectorColorContext.tsx:34-44, 185-191`
- **Evidence:** getChainOpacity reads config.highlightHover (186) and config.highlightSelection (187) to decide opacity, but the context value (InspectorColorContextValue, 34-44) exposes only setMode/setContinuousPalette/setCategoricalPalette/setUnselectedOpacity/resetConfig — there is NO setter for highlightHover or highlightSelection. Both default true (types/inspector.ts:238-239) and can never be toggled by any UI, so the branches are effectively constant.
- **Impact:** Two config booleans are read but unsettable — either dead config fields or a missing/abandoned setter; consumers cannot disable hover/selection highlighting despite the config shape implying they can.
- **Recommendation:** Either add setHighlightHover/setHighlightSelection and wire them to UI, or remove highlightHover/highlightSelection from InspectorColorConfig and hardcode the behavior. Don't branch on config with no mutation path.

</details>


### 5.7 Backend god classes — workspace layer (api/workspace.py, api/workspace_manager.py, api/store_adapter.py)

*Reviewed: api/workspace.py (4388, full), api/workspace_manager.py (2913, full), api/store_adapter.py (2396, full); cross-checked api/spectra.py, api/aggregated_predictions.py, api/inspector.py, api/shap.py, tests/test_store_integration.py, tests/test_aggregated_predictions_api.py via grep + codegraph callers*

The workspace layer is ~9,700 LOC spread across three files that have grown into god-modules with overlapping concerns. api/workspace.py is a single 4,388-LOC router holding ~70 endpoints across 9 unrelated domains (workspace CRUD, global datasets, groups, custom-nodes, storage-maintenance/migration, linked-workspace discovery, runs/results/predictions, app-settings, config-path) plus heavy business logic embedded in handlers (rerun cloning at 2904-3058, dataset-name→linked-id matching at 3167-3255, dataset-scores aggregation at 3447-3541). api/workspace_manager.py (2,913 LOC) bundles five classes, three of which — DatasetRegistry, SchemaMigrator, RunManager (~700 LOC) — are completely unreferenced dead code. api/store_adapter.py (2,396 LOC) is the cleanest layer but carries deprecated aliases and several methods only reachable from tests, plus a 470-LOC get_enriched_runs() monolith with per-run N+1 SQL. The biggest root cause is that the router never delegated to service/repository objects: discovery flows are duplicated three ways (WorkspaceScanner store-vs-legacy branches, workspace.py inline legacy-parquet fallbacks, workspace_manager wrappers), and every async endpoint performs blocking SQLite/Parquet/DatasetConfigs I/O directly on the event loop. There are also true boundary violations where the backend reimplements nirs4all dataset metadata inference and CV-strategy/refit semantics.

| ID | Sev | Cat | Title | Effort/Risk |
|---|---|---|---|---|
| `WS-01` | 🟠 | God class | workspace.py is a 4388-LOC god-router mixing ~9 domains and embedded business logic | L/med |
| `WS-02` | 🟠 | Dead code | Three fully dead classes in workspace_manager.py: DatasetRegistry, SchemaMigrator, RunManager (~700 LOC) | S/low |
| `WS-04` | 🟠 | Performance | Blocking SQLite/Parquet/DatasetConfigs I/O runs synchronously on the event loop in every async endpoint | M/med |
| `WS-05` | 🟠 | Performance | get_enriched_runs(): 470-LOC monolith with per-run N+1 SQL fan-out | L/med |
| `WS-06` | 🟠 | Boundary violation | Boundary violation: backend reimplements nirs4all dataset metadata inference and CV/refit semantics | XL/high |
| `WS-03` | 🟡 | Dead code | Dead StoreAdapter methods + deprecated aliases reachable only from tests | M/low |
| `WS-07` | 🟡 | Duplication | Triplicated discovery: store-vs-legacy branches in WorkspaceScanner duplicated by inline legacy-parquet fallbacks in workspace.py and by workspace_manager wrappers | M/med |
| `WS-09` | 🟡 | Legacy/compat | WorkspaceManager facade duplicates app_config and reaches into its privates; legacy/back-compat shims throughout | M/med |
| `WS-10` | 🟡 | Performance | get_predictions_page double-queries the store (page + full table) for total count on every call | S/low |
| `WS-08` | ⚪ | Duplication | near-duplicate get_all_chains_for_dataset / get_all_chains_for_results_dataset | S/low |

<details><summary><code>WS-01</code> 🟠 <b>workspace.py is a 4388-LOC god-router mixing ~9 domains and embedded business logic</b> <i>(God class, L/med)</i></summary>

- **Location:** `api/workspace.py:1-4389 (single APIRouter, ~70 @router endpoints)`
- **Evidence:** One module/router holds: workspace CRUD (325-385, 676-793, 2359-2431), global datasets (390-568), groups (586-670), custom-nodes (1070-1226), storage maintenance/migration (1706-2261), linked-workspace discovery (2497-2628, 3636-4211), runs/results/predictions (2631-3947), app-settings/favorites (4217-4297), config-path (4308-4388). Beyond routing it embeds heavy logic: rerun pipeline cloning (rerun_workspace_run 2904-3058), dataset-name→linked-id fuzzy matching (_resolve_dataset_mapping 3167-3255), dataset-scores aggregation (_build_dataset_scores_payload 3447-3541), NaN-safe parquet serialization (3744-3830).
- **Impact:** Every workspace change forces edits in one 4.4k-LOC file; reviewers cannot reason about a single endpoint's blast radius; module-level mutable caches (_workspace_runs_cache, _RESULTS_SUMMARY_CACHE, _DATASET_SCORES_CACHE) are tangled with routing. Blocks a clean v1 surface.
- **Recommendation:** Split into routers by domain (workspace_router, datasets_router, groups_router, custom_nodes_router, maintenance_router, discovery_router, settings_router) and extract non-routing logic into services: a RerunService (clone+launch), a DatasetMappingService (_resolve_dataset_mapping/_dataset_match_key/_normalize_run_dataset_entries), and a ResultsCache module. Seams are already clean: each block is delimited by section comments and shares no local state except the three caches.
- **Depends on:** WS-09

</details>

<details><summary><code>WS-02</code> 🟠 <b>Three fully dead classes in workspace_manager.py: DatasetRegistry, SchemaMigrator, RunManager (~700 LOC)</b> <i>(Dead code, S/low)</i></summary>

- **Location:** `api/workspace_manager.py:1095-1441 (DatasetRegistry), 1448-1546 (SchemaMigrator), 1553-1827 (RunManager)`
- **Evidence:** codegraph_callers returns 'No callers found' for DatasetRegistry, SchemaMigrator, RunManager. Repo-wide grep for each class name (and their unique methods resolve_paths, sync_from_runs, migrate_to_v2, normalize_manifest, cleanup_partial_run, create_checkpoint, acquire_run_lock, to_api_response) returns zero references outside their own definitions — no production caller, no test. RunManager even ships its own fcntl file-locking, a VALID_TRANSITIONS state machine, and YAML checkpoint I/O that nothing invokes.
- **Impact:** ~700 LOC of unmaintained machinery (file locks, hash resolution, schema migration) implies capabilities the app does not have, misleads readers, and is a magnet for security/IO bugs that no test covers.
- **Recommendation:** Delete DatasetRegistry, SchemaMigrator, and RunManager outright. None are imported anywhere; removal is mechanical and shrinks the module by ~25%.

</details>

<details><summary><code>WS-04</code> 🟠 <b>Blocking SQLite/Parquet/DatasetConfigs I/O runs synchronously on the event loop in every async endpoint</b> <i>(Performance, M/med)</i></summary>

- **Location:** `api/workspace.py async endpoints throughout (e.g. 2631 get_workspace_runs, 2780 get_enriched_workspace_runs, 3337 results/summary, 3680 predictions/data, 4046 predictions/summary); api/store_adapter.py all query methods`
- **Evidence:** grep for run_in_executor/asyncio.to_thread in workspace.py and store_adapter.py returns 0. Async handlers directly call StoreAdapter (synchronous WorkspaceStore SQLite/DuckDB queries), pandas pd.read_parquet loops (2698, 3726, 3984), pyarrow ParquetFile reads (4094), and DatasetConfigs(...).get_datasets() which loads full NIRS arrays from disk (link_dataset 414-516, _extract_dataset_metadata_columns 85-121). get_workspace_stats (1706) even runs a full WorkspaceScanner scan plus rglob directory walks inside the request. [Nuance from Codex review: one workspace path does use ThreadPoolExecutor but then blocks the loop on list(executor.map(...)) (workspace.py:4112). The claim holds for workspace/store/parquet endpoints; it should NOT be generalized to runs.py, which executes nirs4all.run() on a worker thread — the runs.py debt is the bespoke engine (RUN-01), not missing offload.]
- **Impact:** A single slow store query or large-parquet read stalls the whole FastAPI event loop, blocking all other concurrent requests (websocket job progress, UI polling). On large workspaces this is the dominant latency source and will not scale to v1 multi-user/Electron concurrency.
- **Recommendation:** Wrap synchronous store/parquet/DatasetConfigs work in asyncio.to_thread (or make the endpoints def + threadpool). At minimum offload the StoreAdapter calls and the legacy pandas/pyarrow fallbacks; ideally push the whole data-access into a sync service called via to_thread.
- **Depends on:** WS-01

</details>

<details><summary><code>WS-05</code> 🟠 <b>get_enriched_runs(): 470-LOC monolith with per-run N+1 SQL fan-out</b> <i>(Performance, L/med)</i></summary>

- **Location:** `api/store_adapter.py:1419-1892 (get_enriched_runs)`
- **Evidence:** For each run row in the page, the loop issues independent store queries: list_pipelines(run_id) (1458), query_aggregated_predictions(run_id) (1467), per-dataset query_predictions(run_id,dataset_name,limit=1) (1528) inside a nested dataset loop, a refit-prediction _fetch_pl JOIN (1608), _get_run_artifact_size → recursive json-unnest query (1790/1894), three count _fetch_pl queries final/folds/models (1754,1764,1776), model-class GROUP BY (1795), cv-info FIRST(metric) (1814), and _get_dataset_historical_best per dataset (1588). With limit=50 runs × multiple datasets this is dozens-to-hundreds of round-trips per request. The method also inlines ~25 JSON-parse blocks and synthetic-refit reconstruction.
- **Impact:** Results dashboard latency grows linearly with runs×datasets; this is the single most expensive store path and runs on the event loop (see WS-04). Unmaintainable: one method owns ranking, refit fallback, artifact sizing, CV inference, and run-name derivation.
- **Recommendation:** Extract per-concern helpers (_run_counts, _run_model_classes, _run_cv_config, _enrich_dataset) and batch the per-run/per-dataset queries into set-based queries keyed by the page's run_ids (single list_pipelines IN(...), single aggregated query, single historical-best query). Split the 470-LOC body into an EnrichedRunsBuilder service.
- **Depends on:** WS-03

</details>

<details><summary><code>WS-06</code> 🟠 <b>Boundary violation: backend reimplements nirs4all dataset metadata inference and CV/refit semantics</b> <i>(Boundary violation, XL/high)</i></summary>

- **Location:** `api/workspace.py:414-503 (link_dataset metadata derivation), 85-156 (_extract/_maybe_enrich_dataset_metadata_columns), 3315-3334 (_normalize_rerun_cv_strategy); api/store_adapter.py:194-312 (_strategy_key_from_reference, _infer_pipeline_runtime_config, _infer_run_config_from_pipelines), 438-573 (refit/CV synthesis)`
- **Evidence:** link_dataset constructs DatasetConfigs, reads ds.task_type/signal_types/metadata_columns/target_columns, and re-derives task_type/targets/default_target in the router (440-497) — NIRS task-type and target detection belong to nirs4all. store_adapter hardcodes a splitter-class→strategy map (KFold/StratifiedKFold/GroupKFold/RepeatedKFold/LeaveOneOut/ShuffleSplit/TimeSeriesSplit → UI keys, 203-218) and detects the internal 'FullTrainFoldSplitter' refit splitter (170-173, 240-252), plus synthesizes CV/refit scores (_build_synthetic_final_scores 458-478, _enrich_refit_with_cv_inplace 519-573). _normalize_rerun_cv_strategy duplicates the same splitter taxonomy (3321-3333). These encode nirs4all pipeline/CV internals in the webapp.
- **Impact:** Per BACKEND_RULES the backend must not reimplement nirs4all data/ML logic. This couples the UI to nirs4all internal class names and refit conventions; any nirs4all change to splitter names or refit markers silently breaks the dashboard, and the logic drifts from the library's own metadata.
- **Recommendation:** Move task-type/target/metadata derivation into nirs4all (or call an existing nirs4all API) and have link_dataset only persist what the library returns. Ask nirs4all to expose chain CV/refit/strategy metadata on the store rows/views so store_adapter stops inferring it from class-name string matching; delete _strategy_key_from_reference/_infer_* and the synthetic-refit reconstruction once the store provides it.

</details>

<details><summary><code>WS-03</code> 🟡 <b>Dead StoreAdapter methods + deprecated aliases reachable only from tests</b> <i>(Dead code, M/low)</i></summary>

- **Location:** `api/store_adapter.py:666 get_runs_summary, 1322 get_aggregated_predictions (alias), 1324 get_top_chain_summaries, 1351 get_top_aggregated_predictions (alias), 1353 get_chain_predictions`
- **Evidence:** Production adapter-call tally across api/ shows get_run_detail, get_store_status, get_enriched_runs, get_dataset_top_chains, get_chain_summaries, get_all_chains_for_*, get_predictions_*, get_prediction_scatter, get_score_distribution, delete_* are used — but get_runs_summary, get_top_chain_summaries, adapter.get_chain_predictions are NOT. codegraph_callers: get_runs_summary → only tests/test_store_integration.py; get_top_chain_summaries → none. Lines 1321 and 1350 are literally commented '# Deprecated alias' (get_aggregated_predictions = get_chain_summaries; get_top_aggregated_predictions = get_top_chain_summaries) — the inspector/aggregated_predictions callers use store.get_chain_predictions (the nirs4all WorkspaceStore), not the adapter method.
- **Impact:** Dead read-paths and deprecated aliases keep ~5 methods alive only to satisfy tests, contradicting the no-deprecated-code rule and inflating the adapter surface pre-v1.
- **Recommendation:** Delete get_runs_summary, get_top_chain_summaries, the adapter's own get_chain_predictions, and both '# Deprecated alias' lines (get_aggregated_predictions, get_top_aggregated_predictions); update/remove the tests that pin them. Keep get_prediction_arrays and get_chain_summaries (still called by aggregated_predictions.py / shap.py).

</details>

<details><summary><code>WS-07</code> 🟡 <b>Triplicated discovery: store-vs-legacy branches in WorkspaceScanner duplicated by inline legacy-parquet fallbacks in workspace.py and by workspace_manager wrappers</b> <i>(Duplication, M/med)</i></summary>

- **Location:** `api/workspace_manager.py:234-1088 (WorkspaceScanner discover_runs/predictions/results store+legacy) and 2852-2888 (get_workspace_runs/predictions/exports/templates thin wrappers); api/workspace.py:2671-2778 (inline legacy parquet run discovery), 3714-3841 (inline legacy predictions/data), 3981-4037 (inline legacy scatter), 4074-4180 (inline legacy predictions/summary)`
- **Evidence:** WorkspaceScanner already implements the 'store path primary / legacy filesystem fallback' split for runs (244-269), predictions (536-596), results (941-996). Yet workspace.py re-implements the SAME legacy *.meta.parquet scanning a second time inside endpoints when scanner._has_store() is false (get_workspace_runs builds runs from meta.parquet via pandas at 2694-2761; get_workspace_predictions_data re-reads meta.parquet with bespoke clean_nan/NaNSafeEncoder at 3724-3830; predictions/summary re-reads parquet footers at 4079-4180). Separately, workspace_manager.get_workspace_runs/predictions/exports/templates (2852-2888) are pass-through wrappers around the same scanner that the endpoints also call directly, so two call paths exist for the same data.
- **Impact:** The legacy-parquet read logic exists in two places and can diverge (e.g. column lists, NaN handling, dedup rules); maintainers must fix bugs twice. The redundant manager wrappers add a third indirection with no behavior.
- **Recommendation:** Move all legacy-parquet fallback readers into WorkspaceScanner (it already owns the store-vs-legacy decision) so endpoints call one method regardless of backend. Delete the workspace_manager.get_workspace_* pass-through wrappers (or the direct scanner usage in endpoints) so there is a single discovery entry point.
- **Depends on:** WS-01

</details>

<details><summary><code>WS-09</code> 🟡 <b>WorkspaceManager facade duplicates app_config and reaches into its privates; legacy/back-compat shims throughout</b> <i>(Legacy/compat, M/med)</i></summary>

- **Location:** `api/workspace_manager.py:2116-2171 (dataset/group delegators), 2576-2601 (_get_app_settings_path/_load/_save/_default app-settings passthroughs), 2043-2114 + 2207-2248 (methods docstringed 'Legacy:')`
- **Evidence:** Many WorkspaceManager methods are one-line passthroughs to app_config (link_dataset/unlink_dataset/update_dataset/refresh_dataset 2119-2136; get_groups/create_group/delete_group/add/remove 2140-2171; get_app_settings/save_app_settings 2594-2600). rename_group (2149) and rename via reach into privates app_config._load_dataset_links()/_save_dataset_links(). At least 8 methods are explicitly labeled 'Legacy:' in docstrings (set_workspace 2043, get_current_workspace 2074, reload_workspace 2112, add_to_recent 2207, remove_from_recent 2223, get_recent_workspaces 2231, list_workspaces 2246) and exist only to bridge an old 'recent workspaces' concept onto the new linked-workspace model. __init__ keeps app_data_dir 'for backward compatibility' (1872).
- **Impact:** Two facades over the same app_config inflate the surface and let routers bypass it inconsistently (some endpoints call workspace_manager.*, some call app_config.* directly — e.g. workspace.py:148 app_config.update_dataset vs 497 workspace_manager.update_dataset for the same dataset). Reaching into app_config privates couples the layers. The 'recent'/'legacy' shims are pre-v1 debt with no external contract.
- **Recommendation:** Drop the passthrough delegators and have routers call app_config directly (or make app_config the single dataset/group/settings API); add a public rename_dataset_group to app_config so rename_group stops using _load/_save_dataset_links. Remove the 'Legacy:' recent-workspace methods and the app_data_dir back-compat field, folding any still-needed behavior into the linked-workspace API.
- **Depends on:** WS-01

</details>

<details><summary><code>WS-10</code> 🟡 <b>get_predictions_page double-queries the store (page + full table) for total count on every call</b> <i>(Performance, S/low)</i></summary>

- **Location:** `api/store_adapter.py:975-1061 (get_predictions_page)`
- **Evidence:** The method calls self._store.query_predictions(... limit, offset) for the page (997) and then immediately calls query_predictions(...) again WITHOUT limit (1006) and does total = len(total_df) — i.e. it materializes the entire predictions table in memory just to count rows, on a hot paginated endpoint (/workspaces/{id}/predictions/data via scanner.store_adapter.get_predictions_page). It then issues further per-page _fetch_pl for refit cv_val_score (1028) and _get_predict_chain_target_map which runs additional query_chain_summaries per (run_id,dataset_name) peer group (1097).
- **Impact:** Pagination cost is O(total rows) not O(page); on large workspaces each page load loads and counts every prediction row, defeating the point of limit/offset and compounding the event-loop blocking from WS-04.
- **Recommendation:** Use a COUNT(*) query for total (the fallback path already does this at 1209) instead of len(query_predictions()). Consider caching the count per filter set within the request.

</details>

<details><summary><code>WS-08</code> ⚪ <b>near-duplicate get_all_chains_for_dataset / get_all_chains_for_results_dataset</b> <i>(Duplication, S/low)</i></summary>

- **Location:** `api/store_adapter.py:2042-2080 get_all_chains_for_dataset vs 2082-2112 get_all_chains_for_results_dataset`
- **Evidence:** The two methods are byte-for-byte identical except the query filter (query_chain_summaries(run_id=run_id, dataset_name=dataset_name) vs query_chain_summaries(dataset_name=dataset_name)). Both then run the same pipeline: rows=…, _get_pipeline_metadata_map, _attach_variant_params_inplace, _mark_refit_only_entries_inplace, _enrich_refit_with_cv_inplace, _apply_synthetic_refit_fallback_inplace, metric pick, get_metric_info, scored/unscored sort, _serialize_chain_summary_row.
- **Impact:** ~40 LOC duplicated; refit/CV enrichment changes must be edited in both, risking divergence.
- **Recommendation:** Extract a private _chains_payload(df) helper and have both methods build df then delegate (get_all_chains_for_dataset passes run_id, the results variant omits it).

</details>


### 5.8 Electron shell — env & backend management (env-manager.ts, backend-manager.ts, main.ts)

*Reviewed: electron/env-manager.ts (2198), electron/backend-manager.ts (888), electron/main.ts (612); cross-checked electron/preload.ts, src/types/electron.d.ts, src/components/setup/EnvSetup.tsx via grep + codegraph callers*

env-manager.ts is a 2198-line god-module that mixes seven distinct responsibilities behind a single EnvManager class: settings persistence + legacy migration, network probing, Python discovery across 6+ ecosystems (PATH/conda/pyenv/homebrew/nearby-project/Windows-launcher), env inspection/scoring, package install/repair, a full python-build-standalone download+extract+venv+compileall installer, and process spawning helpers (runCommand/rmWithRetry). These are independent concerns with clean split seams. backend-manager.ts carries a near-complete duplicate of its own spawn path: startInternalNonBlocking() (lines 455-537) and startInternal() (543-627) repeat the ~30-line env object and all four process event handlers verbatim, and the blocking start() path exists only to serve restart()/handleCrash(). There is confirmed dead code (getRuntimeMode, validatePortableState) and a live legacy-migration branch (customPythonPath/customEnvPath) that has no pre-v1 reason to exist. The startup path in main.ts is correctly non-blocking, but two real process-management bugs exist: a fire-and-forget pollMlReadiness that keeps polling/notifying after the window is gone, and orphan-kill that spawns taskkill without awaiting it. The root cause across the area is that one class accreted every Python-lifecycle concern with no module boundary, and a backward-compat instinct kept legacy install-layout branches alive in a repo that has no compat contract.

| ID | Sev | Cat | Title | Effort/Risk |
|---|---|---|---|---|
| `BM-01` | 🟠 | Duplication | startInternalNonBlocking() and startInternal() duplicate the entire spawn path (~80 lines) | M/med |
| `ENV-01` | 🟠 | God class | EnvManager is a 2198-line god-class spanning 7 unrelated responsibilities | L/med |
| `BM-02` | 🟡 | Bug | pollMlReadiness() keeps polling and notifying renderer for up to 2 min after the window/backend is gone | M/med |
| `BM-03` | 🟡 | Bug | Orphan/timeout kills spawn taskkill (and SIGKILL fallback) without awaiting completion — zombie/port-race window | M/med |
| `ENV-02` | 🟡 | Dead code | Dead methods getRuntimeMode() and validatePortableState() | S/low |
| `ENV-03` | 🟡 | Legacy/compat | Live legacy settings-migration branch for customPythonPath/customEnvPath | S/low |
| `ENV-05` | 🟡 | Performance | detectExistingEnvs spawns Python (5s timeout) for every candidate across 6 ecosystems — heavy when invoked on startup-adjacent flows | M/med |
| `BM-04` | ⚪ | Antipattern | Backend launch-mode env vars carry redundant/overlapping signals (RUNTIME_MODE vs RUNTIME_KIND vs IS_BUNDLED_DEFAULT) | S/med |
| `ENV-04` | ⚪ | Duplication | envRoot-from-executable derivation copy-pasted 4 times instead of using the existing helper | S/low |
| `ENV-06` | ⚪ | Duplication | Network-probe URL list and TTL duplicated between Electron env-manager and backend network_state.py | M/low |

<details><summary><code>BM-01</code> 🟠 <b>startInternalNonBlocking() and startInternal() duplicate the entire spawn path (~80 lines)</b> <i>(Duplication, M/med)</i></summary>

- **Location:** `electron/backend-manager.ts:455-537 vs 543-627`
- **Evidence:** Both methods independently: call getBackendPath(), build the identical 30-line env object (NIRS4ALL_PORT...KERAS_BACKEND + PORTABLE_EXECUTABLE_FILE splat, lines 463-482 ≈ 552-571 byte-for-byte), spawn(command,args,{cwd,env,stdio,detached:false}), and register the SAME four handlers (stdout/stderr/exit/error, 491-520 ≈ 582-613 identical). The only real difference is blocking vs background health-check wiring (516-537 vs 615-627). The blocking start()→startInternal() path is reached ONLY by restart() (codegraph: start has 1 caller=restart) and handleCrash().
- **Impact:** Any change to env vars, PID-file plumbing, or crash handling must be made in two places or drift; this is a prime source of subtle restart-vs-startup behavior divergence. High maintainability drag in the gnarliest process-management code.
- **Recommendation:** Extract a private spawnBackend() that returns the wired ChildProcess (getBackendPath + env build + spawn + the 4 handlers), then have both start paths call it and differ only in await waitForHealthCheck() (blocking) vs background .then() (non-blocking). Collapses ~80 duplicated lines to one.

</details>

<details><summary><code>ENV-01</code> 🟠 <b>EnvManager is a 2198-line god-class spanning 7 unrelated responsibilities</b> <i>(God class, L/med)</i></summary>

- **Location:** `electron/env-manager.ts:292-2198`
- **Evidence:** Single EnvManager class owns: settings load/save + legacy migration (loadSettings/saveSettings 312-355), network probing (probeNetworkOnline + probeOne + module-level cache 50-140), Python discovery across 6 ecosystems (listPathPythonCandidates, listCommonHomePythonCandidates, getCondaCommandCandidates, listCondaEnvPythonCandidates, listWindowsLauncherPythonCandidates, listNearbyProjectPythonCandidates, listPyenvPythonCandidates 608-879), env inspection/scoring (compareDetectedEnvs, getEnvKind, isLikelyWritable, guessProfileAlignment, buildInspectedEnv 881-1075), verify/repair (verifyBackendRuntime, verifyBackendPackages, computeEnvFingerprint, verify-cache read/write, ensureBackendPackages 1243-1493), a full PBS download+extract+venv+compileall installer (setup, downloadFile, extractTarball, isGnuTar 1815-2074), and generic process helpers (runCommand, rmWithRetry, execFileText 731-751, 2076-2197). The probeNetworkOnline/probeOne network probe and module-level networkProbeCache are not even methods of the class.
- **Impact:** No reviewer can hold the file in their head; every edit risks unrelated breakage; the class has no test seam between discovery and install. This is the single biggest file in the repo and the main maintainability drag in the Electron shell pre-v1.
- **Recommendation:** Split along the existing seams into modules: network-probe.ts (probeNetworkOnline/probeOne/cache), python-discovery.ts (all list*Candidates + candidate-map helpers), python-runtime-installer.ts (setup/downloadFile/extractTarball/isGnuTar/removeQuarantine/runCommand/rmWithRetry), env-inspection.ts (checkPython/inspectPythonPackages/buildInspectedEnv/compare/score), and keep EnvManager as a thin coordinator over settings + verify-cache. Free functions, not a single class.

</details>

<details><summary><code>BM-02</code> 🟡 <b>pollMlReadiness() keeps polling and notifying renderer for up to 2 min after the window/backend is gone</b> <i>(Bug, M/med)</i></summary>

- **Location:** `electron/backend-manager.ts:329-365 (loop guard 336-337), 372-377`
- **Evidence:** pollMlReadiness() is launched fire-and-forget from startInternal()/startInternalNonBlocking() (lines 528, 626) and loops `while (Date.now() - startTime < maxWait)` with maxWait=120000. Its only early-exit is `if (this.isShuttingDown) return;` (337). It is NOT cancelled on a backend crash/exit: the exit handler (499-512) sets status='error' and nulls this.process but never sets isShuttingDown, so the loop fetches a dead port for up to 2 minutes, and on timeout calls notifyMlReady(false,...) which does win.webContents.send on every window with no isDestroyed() guard (notifyMlReady 372-377, unlike notifyRenderer 876-887 which guards). After handleCrash restarts, a second pollMlReadiness starts while the first is still running — concurrent pollers race to notify.
- **Impact:** Wasted polling against a dead/replaced backend, duplicate/contradictory backend:mlReady IPC during crash-recovery, and a potential throw if a window was destroyed (no isDestroyed guard). Visible flakiness in ML-ready UI state after a backend restart.
- **Recommendation:** Track the active poller (e.g. an AbortController or a generation counter checked each loop iteration) and cancel it in terminateProcess()/the exit handler; guard notifyMlReady with win.isDestroyed() like notifyRenderer does.

</details>

<details><summary><code>BM-03</code> 🟡 <b>Orphan/timeout kills spawn taskkill (and SIGKILL fallback) without awaiting completion — zombie/port-race window</b> <i>(Bug, M/med)</i></summary>

- **Location:** `electron/backend-manager.ts:85-93 (killOrphan), 659-669 (terminateProcess timeout), env-manager.ts:2108-2113 (runCommand timeout)`
- **Evidence:** killOrphan() does `spawn("taskkill", ["/pid", pid, "/t", "/f"])` then a fixed `await sleep(500)` — it never waits for taskkill to actually exit, so on a slow machine start() proceeds to resolveStartupPort()/spawn while the orphan may still hold a port. terminateProcess()'s force-kill timeout (659) likewise fires `spawn("taskkill", ...)` then `setTimeout(finish, 250)` — a fixed 250ms guess rather than awaiting the kill or the proc 'exit'. env-manager runCommand's timeout path (2108) does the same unawaited taskkill before rejecting. None capture taskkill's own exit/error.
- **Impact:** On Windows under load the replacement backend can collide with a not-yet-dead predecessor on the same/ephemeral port, producing intermittent 'port in use' / health-check failures at startup — directly hurting the stated startup-fluidity priority and hard to reproduce.
- **Recommendation:** Await the kill: wrap taskkill in a promise that resolves on its 'exit', and in terminateProcess key 'finish' off the actual proc 'exit' event rather than a 250ms timer. In killOrphan, poll the port (or the PID) until free instead of a blind 500ms sleep.

</details>

<details><summary><code>ENV-02</code> 🟡 <b>Dead methods getRuntimeMode() and validatePortableState()</b> <i>(Dead code, S/low)</i></summary>

- **Location:** `electron/env-manager.ts:483-491, 1206-1208`
- **Evidence:** codegraph_callers reports 'No callers found' for both. getRuntimeMode() (483) has zero production callers — only env-manager.test.ts:697 references it; the live API is getConfiguredRuntimeMode() (468) which IS wired through backend-manager.ts:167 and getInfo. validatePortableState() (1206) is a one-line wrapper `return this.validateConfiguredState();` with literally zero references anywhere (grep over electron/, src/, scripts/ returns only its own definition and a @link doc comment); main.ts:510 calls validateConfiguredState() directly.
- **Impact:** Two public methods that look load-bearing (one even backed by a passing test) but are never used in the app — pure confusion and a false test signal pre-v1.
- **Recommendation:** Delete getRuntimeMode() and its test at env-manager.test.ts:697 (or repoint the test to getConfiguredRuntimeMode). Delete validatePortableState() entirely and have any future portable caller use validateConfiguredState().

</details>

<details><summary><code>ENV-03</code> 🟡 <b>Live legacy settings-migration branch for customPythonPath/customEnvPath</b> <i>(Legacy/compat, S/low)</i></summary>

- **Location:** `electron/env-manager.ts:319-334`
- **Evidence:** loadSettings() carries a migration block: `// Migration: convert legacy customPythonPath / customEnvPath to pythonPath` that reads data.customPythonPath / data.customEnvPath, probes Scripts/bin candidates, and rewrites settings via saveSettings(). The current EnvSettings interface (242-248) only defines pythonPath/appVersion/skipWizardOnLaunch; customPythonPath/customEnvPath are not part of any written schema and grep finds no code that writes them.
- **Impact:** Backward-compat shim for an on-disk settings format that no shipped release writes — explicitly forbidden by the repo's 'no backward-compatibility shims' rule. Adds an extra disk write on every legacy-key hit and complicates the hot loadSettings path.
- **Recommendation:** Delete the `else if (data.customPythonPath)` / `else if (data.customEnvPath)` branches; keep only `if (data.pythonPath)`. Drop the candidate-probe loop with them.

</details>

<details><summary><code>ENV-05</code> 🟡 <b>detectExistingEnvs spawns Python (5s timeout) for every candidate across 6 ecosystems — heavy when invoked on startup-adjacent flows</b> <i>(Performance, M/med)</i></summary>

- **Location:** `electron/env-manager.ts:1503-1586, checkPython 1589-1634`
- **Evidence:** detectExistingEnvs() gathers candidates from PATH, $HOME venvs, ~10 conda roots, nearby project dirs (readdirSync of cwd + parent and each subdir for .venv/venv/.env/env, lines 813-839), pyenv versions, `py -0p`, and `conda env list --json` (12s timeout), then `Promise.all` runs checkPython() — an execFile spawning Python with a metadata-enumerating -c script (5s timeout each) — for EVERY deduped candidate. On a dev machine with many interpreters this is dozens of Python spawns plus a 12s conda discovery. The 30s in-memory TTL cache (DETECT_ENVS_TTL_MS) helps repeats but not the first call.
- **Impact:** The Settings/wizard 'detect environments' action can stall for many seconds and hammers the disk/process table; the nearby-project directory walk (readdirSync of every sibling dir) is unbounded fan-out. Not on the cold-start critical path today, but a latent startup risk if ever wired into auto-detection.
- **Recommendation:** Bound the discovery: cap candidate count, drop the nearby-project sibling-dir walk (or gate it behind an explicit 'scan project folders' opt-in), and run conda/py-launcher discovery lazily only when the cheap sources yield nothing. Consider lowering per-candidate checkPython concurrency to avoid a spawn storm.

</details>

<details><summary><code>BM-04</code> ⚪ <b>Backend launch-mode env vars carry redundant/overlapping signals (RUNTIME_MODE vs RUNTIME_KIND vs IS_BUNDLED_DEFAULT)</b> <i>(Antipattern, S/med)</i></summary>

- **Location:** `electron/backend-manager.ts:174-197, 218-224, 269-274`
- **Evidence:** getBackendPath() emits four overlapping env vars per branch: NIRS4ALL_RUNTIME_MODE (bundled|managed|development|pyinstaller), NIRS4ALL_RUNTIME_KIND (= configuredRuntimeMode, often equal to MODE), NIRS4ALL_IS_BUNDLED_DEFAULT ('true' only when bundled, derivable from MODE==='bundled'), and NIRS4ALL_BUNDLED_RUNTIME_AVAILABLE. RUNTIME_KIND and IS_BUNDLED_DEFAULT are computed from configuredRuntimeMode and are redundant with RUNTIME_MODE in 3 of 4 branches.
- **Impact:** Four near-synonymous flags the Python side must interpret consistently; easy to set an inconsistent combination during edits and a backend boundary-coupling smell.
- **Recommendation:** Collapse to one canonical NIRS4ALL_RUNTIME_KIND and let the backend derive 'is bundled' from it; drop IS_BUNDLED_DEFAULT and the MODE/KIND split unless the Python side genuinely needs both (verify in api/ before deleting).

</details>

<details><summary><code>ENV-04</code> ⚪ <b>envRoot-from-executable derivation copy-pasted 4 times instead of using the existing helper</b> <i>(Duplication, S/low)</i></summary>

- **Location:** `electron/env-manager.ts:547, 560, 567, 1293`
- **Evidence:** The pattern `const dirName = path.basename(dir).toLowerCase(); ... (dirName === "scripts" || dirName === "bin") ? path.dirname(dir) : dir` is inlined in getSitePackages (544-547), getSitePackagesForPythonPath (558-560), getEnvRootForPythonPath (565-567), and computeEnvFingerprint (1291-1295). getEnvRootForPythonPath already encapsulates exactly this logic but the other three reimplement it.
- **Impact:** Four divergence points for the same Windows/Unix layout assumption; a layout fix (e.g. a new interpreter dir name) silently misses three of them.
- **Recommendation:** Make getSitePackages/getSitePackagesForPythonPath/computeEnvFingerprint call getEnvRootForPythonPath(pythonPath) and delete the inlined copies.

</details>

<details><summary><code>ENV-06</code> ⚪ <b>Network-probe URL list and TTL duplicated between Electron env-manager and backend network_state.py</b> <i>(Duplication, M/low)</i></summary>

- **Location:** `electron/env-manager.ts:50-140`
- **Evidence:** Comment at line 50-52 states the probe is `(shared with backend network_state.py)` and hardcodes NETWORK_PROBE_URLS (cloudflare/pypi/github/google), NETWORK_PROBE_TIMEOUT_MS=4000, NETWORK_PROBE_TTL_MS=60000, plus the NIRS4ALL_OFFLINE truthiness parser isOfflineForced(). The same probe semantics are reimplemented in the Python backend, so the two can drift (different URL set / TTL → inconsistent online/offline decisions between main process and backend).
- **Impact:** Two sources of truth for 'are we online' that the comment itself admits should be one; drift produces contradictory offline behavior (Electron repair refuses while backend thinks it is online, or vice versa).
- **Recommendation:** Pick one owner. Since this is a connectivity policy (not NIRS/ML logic), keeping a small shared JSON of probe URLs/TTL consumed by both, or having the backend expose the decision and the Electron side defer to it, removes the duplication. At minimum extract the URL/TTL constants to a shared config file referenced by both.

</details>


### 5.9 Frontend visualization god components + render performance (playground/visualizations)

*Reviewed: SpectraWebGL.tsx (1949), SpectraChartV2.tsx (1655), RepetitionsChart.tsx (1730), DimensionReductionChart.tsx (1680), FoldDistributionChartV2.tsx (1677), chartConfig.ts (652); plus grep tracing of callers across src/components/playground and src/lib/playground*

The 5 chart components total ~8,700 LOC (1655-1949 each) and are textbook god-components: each inlines its own toolbar, color logic, zoom/pan controller, Recharts-or-WebGL renderer switch, selection DOM-mapping, tooltip, and legend in one function. The dominant root cause is that no chart scaffolding was extracted — selection-by-DOM-geometry, screen↔data coordinate mapping, and the renderer-toggle UI are copy-pasted across files instead of shared hooks. The biggest perf drags: SpectraWebGL is NOT memoized despite doing synchronous LTTB decimation, and its HighlightedLines/HoveredLine subcomponents allocate fresh Float32Arrays in the render body on every render (incl. every hover); SpectraChartV2 rebuilds an O(samples×wavelengths) Recharts data array and calls getColor per-line on every render. There is also a meaningful dead-code tail: a never-called getYMeanColor, an unreachable 'metric' color mode, an unused spectralMetrics prop on two charts, and a whole block of @deprecated color helpers in chartConfig.ts whose live callers are gone. None of this blocks v1 correctness, but the duplication + missing memoization is what makes the playground feel sluggish and is the main maintainability tax before v1.

| ID | Sev | Cat | Title | Effort/Risk |
|---|---|---|---|---|
| `VIZ-01` | 🟠 | Performance | SpectraWebGL is not memoized and re-runs LTTB decimation on every parent render | M/med |
| `VIZ-02` | 🟠 | Performance | HighlightedLines/HoveredLine allocate Float32Array geometries in the render body every render | M/med |
| `VIZ-03` | 🟠 | God class | Five chart god-components (1655-1949 LOC each) with no extracted hooks/subcomponents | XL/med |
| `VIZ-04` | 🟡 | Duplication | Recharts DOM-geometry selection scaffolding copy-pasted between RepetitionsChart and DimensionReductionChart | M/low |
| `VIZ-05` | 🟡 | Performance | SpectraChartV2 rebuilds O(samples×wavelengths) Recharts data and recolors every line on each render | M/med |
| `VIZ-06` | 🟡 | Dead code | Dead code: getYMeanColor helper, unreachable 'metric' color mode, and unused spectralMetrics prop | S/low |
| `VIZ-07` ⤿ | 🟡 | Legacy/compat | chartConfig.ts ships a block of @deprecated color helpers whose live callers are gone | M/low |
| `VIZ-09` | 🟡 | Boundary violation | Frontend recomputes ML/outlier statistics that belong in the nirs4all library | L/med |
| `VIZ-08` | ⚪ | Dead code | FoldDistributionChartV2 internal config.colorMode/metadataKey/metricKey/barOrientation are vestigial — live color comes from globalColorConfig | M/low |

<details><summary><code>VIZ-01</code> 🟠 <b>SpectraWebGL is not memoized and re-runs LTTB decimation on every parent render</b> <i>(Performance, M/med)</i></summary>

- **Location:** `src/components/playground/visualizations/SpectraWebGL.tsx:1407-1441,1700-1741,1949`
- **Evidence:** `export function SpectraWebGL(...)` ends with `export default SpectraWebGL;` (line 1949) with NO React.memo wrapper — unlike SpectraChartV2/DimensionReductionChart/FoldDistributionChartV2 which all end with `export default React.memo(...)`. Its only caller is SpectraChartV2 (line 1316), which re-renders on every selection/hover/config change and passes fresh objects (e.g. `folds={folds ?? undefined}`, `aggregatedStats={...}`, inline `sampleColors` arrays at 1333-1337). The heavy `decimation = useMemo(computeDecimation(...))` (1702-1706) runs synchronous LTTB over all visible spectra; without memoizing the component, parent re-renders that change an unrelated prop force the whole subtree to reconcile.
- **Impact:** Every hover/selection in the parent re-renders the entire WebGL chart tree. Combined with inline object props (new array/object identity each render) the useMemo guards inside still re-run when those identities change, so large datasets re-decimate needlessly — the primary cause of laggy spectra interaction.
- **Recommendation:** Wrap export in `React.memo`. Stabilize the props SpectraChartV2 passes: memoize the `aggregatedStats`/`groupedStats` wrapper objects and the `sampleColors` array, and pass a stable `folds` reference. Verify decimation deps no longer churn on hover.

</details>

<details><summary><code>VIZ-02</code> 🟠 <b>HighlightedLines/HoveredLine allocate Float32Array geometries in the render body every render</b> <i>(Performance, M/med)</i></summary>

- **Location:** `src/components/playground/visualizations/SpectraWebGL.tsx:483-513,525-555`
- **Evidence:** In `HighlightedLines` the JSX maps each line and builds `const positions = new Float32Array(line.pointCount * 3)` plus a fill loop INSIDE the map callback (489-494) on every render — no useMemo. `HoveredLine` does the same: `const positions = new Float32Array(hoveredLine.pointCount * 3)` and a fill loop in the render body (531-536), and it runs on every hover-state change. These build new BufferAttribute args (`args={[positions, 3]}`) each render, forcing three.js to re-upload geometry.
- **Impact:** On hover (which fires continuously on mousemove via SpectraInteractionController) every selected/pinned line plus the hovered line reallocates and re-uploads GPU geometry, producing jank proportional to selection size. This is the per-frame cost that makes hovering over a dense spectra plot stutter.
- **Recommendation:** Memoize the positions arrays (useMemo keyed on line.points/pointCount/zOrder) or precompute geometries once per LineData and reuse, so hover only swaps a color/material, not the buffer. The existing comment at 1708-1711 already establishes selection state is intentionally kept out of LineData — extend that to keep geometry stable too.
- **Depends on:** VIZ-01

</details>

<details><summary><code>VIZ-03</code> 🟠 <b>Five chart god-components (1655-1949 LOC each) with no extracted hooks/subcomponents</b> <i>(God class, XL/med)</i></summary>

- **Location:** `src/components/playground/visualizations/SpectraWebGL.tsx:1-1949; SpectraChartV2.tsx:1-1655; RepetitionsChart.tsx:1-1730; DimensionReductionChart.tsx:1-1680; FoldDistributionChartV2.tsx:1-1677`
- **Evidence:** Each component bundles: toolbar/header JSX (e.g. DimRed 1241-1438, Reps 1143-1368), renderer-toggle SVG/WebGL/Regl buttons (DimRed 1350-1401, Reps 1258-1293), zoom/pan handlers (Reps handleWheel/handlePan* 882-978; SpectraWebGL XZoomController 987-1122), selection logic (3+ handlers each), tooltip render-prop, and legend. SpectraChartV2's main function spans ~150-1650 with ~25 useMemo/useCallback hooks. RepetitionsChart's single `useMemo` for plotData (344-598) is 250 lines with two large branches.
- **Impact:** Any change (a new color mode, a tooltip field) requires navigating ~1700-line files; logic that is conceptually shared (zoom, selection, renderer toggle) is re-implemented per chart, so fixes must be applied 3-5 times. This is the main maintainability tax pre-v1.
- **Recommendation:** Extract shared hooks: `useChartZoomPan` (wheel/drag domain state, duplicated in Reps + SpectraWebGL), `useRendererToggle` (SVG/WebGL/Regl button group, duplicated in Reps + DimRed), and a `RechartsDomSelection` helper (see VIZ-04). Move the per-chart toolbar JSX into dedicated <XxxToolbar> components like the existing SpectraChartToolbar. Target each main component under ~600 LOC.

</details>

<details><summary><code>VIZ-04</code> 🟡 <b>Recharts DOM-geometry selection scaffolding copy-pasted between RepetitionsChart and DimensionReductionChart</b> <i>(Duplication, M/low)</i></summary>

- **Location:** `src/components/playground/visualizations/RepetitionsChart.tsx:723-810; src/components/playground/visualizations/DimensionReductionChart.tsx:765-862`
- **Evidence:** Both `handleSelectionComplete` implementations contain the identical selector list `['.recharts-scatter-symbol', '.recharts-symbols', '.recharts-layer.recharts-scatter .recharts-symbols', '.recharts-scatter path', '.recharts-layer path[fill]']`, the same `for (const selector of selectors)` first-match loop, the same `pointScreenPositions` build via `symbol.getBoundingClientRect()` + center calc, and the same isPointInPolygon/isPointInBox branch. The WebGL screen→data variants (`handleSelectionCompleteWebGL` Reps 813-872, DimRed 677-724) are likewise near-identical.
- **Impact:** Selection bugs (e.g. Recharts changing its DOM class names) must be fixed in 2-4 places; the brittle 5-selector fallback list is a smell duplicated verbatim. Adds ~180 duplicated lines.
- **Recommendation:** Extract a `selectRechartsPointsInArea(container, pointCount, result, getDataIndex)` and a `selectPointsInDataSpace(points, result, screenToData)` helper into selectionHandlers.ts (which already owns computeAreaSelectionAction). Have both charts call them.

</details>

<details><summary><code>VIZ-05</code> 🟡 <b>SpectraChartV2 rebuilds O(samples×wavelengths) Recharts data and recolors every line on each render</b> <i>(Performance, M/med)</i></summary>

- **Location:** `src/components/playground/visualizations/SpectraChartV2.tsx:430-504,1505-1545,558-607`
- **Evidence:** `chartData` useMemo (430-504) iterates `wavelengths.map(...)` and for each wavelength loops `displayIndices.forEach(...)` writing `point[\`p${displayIdx}\`]` — an O(W×S) object-of-arrays rebuilt whenever any dep changes (deps include `referenceDataset`, `config.*`). In the render body, both `displayIndices.map(...)` blocks (1505-1545) call `getColor(displayIdx, ...)` per line; `getColor` (558-607) is a useCallback whose deps include `selectedSamples`/`pinnedSamples`/`hoveredSample`, so it changes on every hover and re-colors every visible Recharts <Line>.
- **Impact:** In Canvas/Recharts mode, hovering recreates the color of every line and the wide chartData object churns on config toggles, making the SVG path the slow fallback. Why WebGL exists, but Canvas is still the default (renderMode='canvas').
- **Recommendation:** Skip per-line stroke recompute on hover by reading hover/selection state inside the Cell/Line via a cheaper path (as WebGL already does), or gate Recharts to small sample counts. Ensure chartData deps don't include hover state (they currently don't, but getColor churn defeats it).

</details>

<details><summary><code>VIZ-06</code> 🟡 <b>Dead code: getYMeanColor helper, unreachable 'metric' color mode, and unused spectralMetrics prop</b> <i>(Dead code, S/low)</i></summary>

- **Location:** `src/components/playground/visualizations/FoldDistributionChartV2.tsx:221-235,106,243; src/components/playground/visualizations/DimensionReductionChart.tsx:131,513-515,151,247`
- **Evidence:** `getYMeanColor` (Fold:221) has exactly one occurrence in the whole repo — its own definition (grep `getYMeanColor` over src returns only line 221) — so it is never called. DimRed declares `ColorMode = ... | 'metric'` (131) with a switch branch `case 'metric': // TODO ... return 'hsl(239, 84%, 67%)'` (513-515) that is never selectable: the settings dropdown only offers target/fold/metadata radio items (1020-1025) and `config.metricKey` is never set via updateConfig. `spectralMetrics` is a prop on both DimRed (151, destructured 247) and Fold (106, destructured 243) but is read nowhere in either body.
- **Impact:** Misleads readers into thinking metric-based coloring works; carries a dead TODO and an unused prop through the component contract. Per project rule 'no dead code', this is debt to delete before v1.
- **Recommendation:** Delete `getYMeanColor`; remove the `'metric'` member from ColorMode plus its switch branch and `metricKey`/`metricKey?` config field; drop the `spectralMetrics` prop from both DimensionReductionChartProps and FoldDistributionChartV2Props (and their call sites).

</details>

<details><summary><code>VIZ-07</code> 🟡 <b>chartConfig.ts ships a block of @deprecated color helpers whose live callers are gone</b> <i>(Legacy/compat, M/low)</i> · **⤿ merged**</summary>

- **Location:** `src/components/playground/visualizations/chartConfig.ts:182-255,320-399,510-530`
- **Evidence:** 9 `@deprecated` markers in chartConfig.ts. The deprecated exports FOLD_COLORS, getFoldColor, getSampleColorByY, getSampleColorByFold, TRAIN_TEST_COLORS, getSelectionStateColor, getFoldLegendItems, getTrainTestLegendItems have NO real callers outside chartConfig.ts — grep across src shows only comment references (colorConfig.ts:49 comment, colorEncoding.ts:166 comment, SpectraWebGL.tsx:226 comment). The header explicitly says 'All color constants below are DEPRECATED — Use ... colorConfig instead'. (SELECTION_COLORS is still live in 3 files, so it must stay or be migrated separately.)
- **Impact:** Two parallel color systems (chartConfig deprecated vs lib/playground/colorConfig) invite accidental reuse and bloat the shared module. Pre-v1 with no compat contract, the deprecated tail should disappear.
- **Recommendation:** Delete FOLD_COLORS/getFoldColor/getSampleColorByY/getSampleColorByFold/TRAIN_TEST_COLORS/getSelectionStateColor/getFoldLegendItems/getTrainTestLegendItems. Migrate SpectraWebGL/SavedSelections/InspectorSavedSelections off SELECTION_COLORS to colorConfig's HIGHLIGHT_COLORS, then remove SELECTION_COLORS too.

</details>

<details><summary><code>VIZ-09</code> 🟡 <b>Frontend recomputes ML/outlier statistics that belong in the nirs4all library</b> <i>(Boundary violation, L/med)</i></summary>

- **Location:** `src/components/playground/visualizations/SpectraChartV2.tsx:360-405,816-941; src/components/playground/visualizations/RepetitionsChart.tsx (no-rep fallback)`
- **Evidence:** SpectraChartV2 `outlierSamples` useMemo (360-405) computes a mean spectrum, per-sample RMS deviation, mean/std of deviations, and flags samples >2σ as outliers entirely in the browser as a 'Fallback: compute outliers from spectral deviation'. `handleRangeMouseUp` (816-941) again computes per-sample range means, global mean/std, and a 2σ outlier threshold to drive selection. RepetitionsChart correctly delegates distance computation to `computeRepetitionVariance` (api/playground), showing the backend path exists — the spectral-deviation outlier stats do not.
- **Impact:** Duplicates statistical logic the library owns (per CLAUDE.md the studio must not reimplement NIRS/ML logic). Results can diverge from library outlier definitions, and the heavy O(samples×wavelengths) loops run on the UI thread.
- **Recommendation:** Move spectral-deviation outlier detection behind an API endpoint (mirroring computeRepetitionVariance) and have the chart consume `outlierIndices`; keep only the cheap selection-mapping in the component. Confirm with the library whether an outlier helper already exists before adding an endpoint.

</details>

<details><summary><code>VIZ-08</code> ⚪ <b>FoldDistributionChartV2 internal config.colorMode/metadataKey/metricKey/barOrientation are vestigial — live color comes from globalColorConfig</b> <i>(Dead code, M/low)</i></summary>

- **Location:** `src/components/playground/visualizations/FoldDistributionChartV2.tsx:123-132,191-198,299,1091-1099`
- **Evidence:** Rendering uses `effectiveColorMode = globalColorConfig?.mode ?? 'partition'` (299) everywhere (1295,1572,1593,1642). The internal `ChartConfig.colorMode` is only mutated by one radio group offering `partition`/`target_mean` (1091-1099), but `target_mean` never matches any `effectiveColorMode` case (which expects 'target'/'fold'/'outlier'/etc.), so selecting it has no effect on colors. `config.metadataKey`, `config.metricKey`, and `config.barOrientation` are never mutated by any UI (no updateConfig call sets them); barOrientation is read at 1114/1129-1133/1334 but is permanently 'vertical'.
- **Impact:** Confusing dead control surface: a user-visible 'Target Mean' radio that does nothing, plus three config fields wired into render branches that can never change. Adds noise to an already huge component.
- **Recommendation:** Remove the internal colorMode radio group and FoldColorMode type (color is globally driven), drop unused metadataKey/metricKey config fields, and either expose barOrientation via UI or hardcode the vertical layout and delete the horizontal branches (1133-1145).
- **Depends on:** VIZ-06

</details>


### 5.10 Backend god class — api/playground.py (3158 LOC)

*Reviewed: api/playground.py (3158, full), api/shared/pipeline_service.py (982, full), api/shared/decimation.py (104, full), api/shared/metrics_computer.py (~640, headers + key methods), api/spectra.py (_load_dataset cache), src/api/playground.ts (endpoint call sites)*

api/playground.py is a 3158-LOC module dominated by one ~1560-LOC god class (PlaygroundExecutor, lines 215-1778) that crams together at least 11 distinct responsibilities: numpy conversion, subset/sampling, step orchestration with two hand-rolled caches, preprocessing/augmentation/filter/splitter execution, statistics, PCA, UMAP, repetition variability analysis, and spectral metrics. The module also defines 18 FastAPI endpoints, four of which (the entire /metrics REST family) are dead — they have zero callers in src/api/playground.ts or anywhere in the repo. The root cause is feature-by-feature accretion ("Phase 4/5/7" comments throughout) with no extraction into api/shared services and no deletion of superseded paths. There are two genuine boundary-violations: repetition-group auto-detection heuristics and inter-repetition distance math (Mahalanobis, percentile thresholds) are reimplemented in the backend rather than delegated to nirs4all, and that same repetition-variability logic exists twice (in this file and in shared/metrics_computer.py). A cluster of dead imports rounds out the cleanup. Biggest pre-v1 debts: split the god class, delete the dead /metrics endpoints + models, and de-duplicate repetition analysis.

| ID | Sev | Cat | Title | Effort/Risk |
|---|---|---|---|---|
| `PG-01` | 🟠 | God class | PlaygroundExecutor is a 1560-LOC god class with ~11 responsibilities | L/med |
| `PG-02` | 🟠 | Dead code | Dead /metrics endpoint family (4 endpoints + 3 models) with no callers | S/low |
| `PG-04` | 🟠 | Duplication | Repetition variability computed twice (playground vs metrics_computer) | M/med |
| `PG-03` | 🟡 | Dead code | Dead imports: typing aliases, lazy_imports helpers, ALL_METRICS, lru_cache, convert_frontend_step | S/low |
| `PG-05` | 🟡 | Antipattern | Two overlapping hand-rolled caches (TTL result cache + byte-bounded step cache) | M/med |
| `PG-06` | 🟡 | Boundary violation | Repetition auto-detection heuristics and distance math reimplemented in backend | L/med |
| `PG-07` | 🟡 | Performance | Full-matrix .tolist() materialization and per-step deep copies in the hot path | M/med |
| `PG-08` | ⚪ | Boundary violation | Inline stratified-target binning reimplemented in _execute_splitter | S/med |

<details><summary><code>PG-01</code> 🟠 <b>PlaygroundExecutor is a 1560-LOC god class with ~11 responsibilities</b> <i>(God class, L/med)</i></summary>

- **Location:** `api/playground.py:215-1778`
- **Evidence:** Single class PlaygroundExecutor holds execute() (267-833, ~560 LOC) plus _apply_sampling, _execute_preprocessing, _execute_augmentation, _execute_filter, _execute_splitter (1034-1267, ~230 LOC), _compute_statistics, _compute_pca, _compute_umap, _compute_repetition_analysis (1419-1714, ~295 LOC), _compute_metrics. execute() interleaves numpy coercion, subset_mode selection, sampling, source_partition re-sorting, a per-step prefix cache (470-683), step dispatch on step.type, and six independent post-compute blocks (stats/PCA/UMAP/repetitions/metrics/decimation).
- **Impact:** No single concern can be tested or changed in isolation; execute() mutates ~15 parallel arrays (X_processed, y_sampled, metadata_sampled, sample_ids_sampled, filter_mask, kept_indices, fold_info, ...) making correctness fragile. Blocks a clean v1 service boundary.
- **Recommendation:** Extract per-step executors (preprocessing/augmentation/filter/splitter) into api/shared/playground_steps.py, the chart computations (_compute_statistics/_compute_pca/_compute_umap/_compute_repetition_analysis/_compute_metrics) into api/shared/playground_charts.py, and the prefix-cache loop into a small StepPipeline class. Leave PlaygroundExecutor.execute() as thin orchestration over those services.
- **Depends on:** PG-05

</details>

<details><summary><code>PG-02</code> 🟠 <b>Dead /metrics endpoint family (4 endpoints + 3 models) with no callers</b> <i>(Dead code, S/low)</i></summary>

- **Location:** `api/playground.py:2864-3033 (GET /metrics, POST /metrics/compute, /metrics/outliers, /metrics/similar) and models at 2889-2913`
- **Evidence:** src/api/playground.ts only references /playground/{execute,execute-dataset,operators,presets,capabilities,validate,pca,repetitions,diff/compute,diff/repetition-variance,metadata-columns}. Repo-wide grep for 'metrics/compute', 'metrics/outliers', 'metrics/similar', 'playground/metrics', get_metrics_info, compute_metrics, detect_outliers, find_similar_samples returns zero hits outside this file. MetricsRequest/OutlierRequest/SimilarityRequest (2889-2913) are used only by these dead endpoints.
- **Impact:** ~170 LOC of unreachable surface that still has to be maintained, type-checked, and reasoned about; ships dead REST routes pre-v1.
- **Recommendation:** Delete get_metrics_info, compute_metrics, detect_outliers, find_similar_samples and the three request models. If GET /metrics info is ever needed it can be re-derived from get_available_metrics().

</details>

<details><summary><code>PG-04</code> 🟠 <b>Repetition variability computed twice (playground vs metrics_computer)</b> <i>(Duplication, M/med)</i></summary>

- **Location:** `api/playground.py:1419-1714 (_compute_repetition_analysis) vs api/shared/metrics_computer.py:480 (compute_pairwise_distances) + 588 (compute_repetition_variance)`
- **Evidence:** _compute_repetition_analysis builds bio-sample groups and computes per-rep distances to a group reference (np.linalg.norm, Mahalanobis via scipy at 1656-1664, p95 thresholds at 1690). metrics_computer.compute_repetition_variance does the same group-reference variance computation ('group_mean'/'leave_one_out'/'first', metric dispatch) and compute_pairwise_distances re-implements euclidean/manhattan/cosine/mahalanobis. The /repetitions endpoint uses the playground copy; /diff/repetition-variance uses the metrics_computer copy — two answers for the same question.
- **Impact:** Divergent distance definitions for the same UI concept; bug fixes must be applied in two places; ~300 LOC of the god class duplicates a shared service.
- **Recommendation:** Make _compute_repetition_analysis delegate grouping + distance computation to a single shared function (in metrics_computer or a new repetition module), keeping only the playground-specific response shaping. Remove the duplicated Mahalanobis/norm blocks.

</details>

<details><summary><code>PG-03</code> 🟡 <b>Dead imports: typing aliases, lazy_imports helpers, ALL_METRICS, lru_cache, convert_frontend_step</b> <i>(Dead code, S/low)</i></summary>

- **Location:** `api/playground.py:22, 24, 32, 48, 55`
- **Evidence:** Line 22 'from functools import lru_cache' — lru_cache never used. Line 24 imports Dict, List, Optional, Tuple, Union — grep for subscript use ('Dict[' etc.) returns 0; code uses lowercase dict/list and X|None. Line 32 imports get_cached, is_ml_ready, require_ml_ready from .lazy_imports — none used (the _get_cached at 2096/2365 is an unrelated local function). Line 48 ALL_METRICS imported but never referenced (only FAST_METRICS/CHEMOMETRIC_METRICS used). Line 55 convert_frontend_step imported from pipeline_service but never called.
- **Impact:** Misleads readers into thinking the module participates in lazy-ml-gating and frontend-step conversion when it does not; trips ruff F401 cleanliness gate.
- **Recommendation:** Remove lru_cache, the five typing aliases (keep only Any), get_cached/is_ml_ready/require_ml_ready, ALL_METRICS, and convert_frontend_step from the imports.

</details>

<details><summary><code>PG-05</code> 🟡 <b>Two overlapping hand-rolled caches (TTL result cache + byte-bounded step cache)</b> <i>(Antipattern, M/med)</i></summary>

- **Location:** `api/playground.py:1785-1912 (_cache + _get_cached/_set_cached) and 1918-1999 (_StepCache + _compute_prefix_key/_compute_data_fingerprint)`
- **Evidence:** _cache is a module dict with manual TTL+LRU eviction (O(n) min() scan on every set, line 1909) keyed by _compute_cache_key/_compute_dataset_cache_key. Separately _StepCache (1918) re-implements TTL+LRU with byte accounting and its own min() scans (1965). Both expire at 300s. execute() writes the step cache inside the loop (664-683) doing deep .copy() of X/y/metadata/masks per step.
- **Impact:** Two cache implementations to reason about and tune; O(n) eviction scans; duplicated TTL constants. The per-step deep-copy caching multiplies memory for long pipelines.
- **Recommendation:** Collapse to one small LRU/TTL cache utility in api/shared (e.g. cachetools.TTLCache) used for both whole-response and step-prefix caching; drop the manual min()-scan eviction and duplicate fingerprint helpers.

</details>

<details><summary><code>PG-06</code> 🟡 <b>Repetition auto-detection heuristics and distance math reimplemented in backend</b> <i>(Boundary violation, L/med)</i></summary>

- **Location:** `api/playground.py:1456-1601 (regex/metadata bio-sample detection) and 1628-1666 (Mahalanobis/Euclidean distance)`
- **Evidence:** _compute_repetition_analysis contains _normalize_metadata_name, _looks_like_repeat_index, _auto_detect_metadata_group_column plus four hard-coded sample-id regex patterns (1566-1571) to infer biological-sample grouping, then computes covariance/Mahalanobis (1656-1664). This is NIRS dataset-domain logic (repetition grouping is a first-class SpectroDataset concept — the splitter path already calls dataset.set_repetition and nirs4all resolve_split_groups at 1118-1132). The backend is meant to be HTTP/UI-state only.
- **Impact:** Duplicates/forks nirs4all's repetition contract in the webapp; if the library changes how repetitions are grouped, split preview and repetition charts drift apart. Violates the studio backend boundary rule.
- **Recommendation:** Push bio-sample grouping + repetition variability into nirs4all (or reuse its existing repetition/grouping API) and have the endpoint only marshal the result for charts. At minimum, share the detection heuristics with the splitter path instead of a second regex bank.
- **Depends on:** PG-04

</details>

<details><summary><code>PG-07</code> 🟡 <b>Full-matrix .tolist() materialization and per-step deep copies in the hot path</b> <i>(Performance, M/med)</i></summary>

- **Location:** `api/playground.py:792-816 (response build) and 664-683 (step-cache writes)`
- **Evidence:** The ExecuteResponse serializes X_sampled_out.tolist() and X_processed_out.tolist() plus full metadata/y .tolist() (792-816) for every request even when MessagePack could pass arrays via _msgpack_default. Inside the step loop, every executed step writes _step_cache.put({'X': X_processed.copy(), 'y': ...copy(), 'metadata': {k: v.copy()...}, 'filter_mask': ...copy(), 'kept_indices': ...copy(), ...}) (665-683), deep-copying the whole working set per step. Decimation (777-783) only fires when max_wavelengths_returned is explicitly set, so default responses return full-width matrices.
- **Impact:** For wide spectra the .tolist() conversion and N deep copies (N = step count) dominate latency/memory of the real-time preview; the step cache can balloon to its 200MB cap quickly with long pipelines.
- **Recommendation:** Skip .tolist() when responding as MessagePack (let _msgpack_default handle ndarrays); cache only the final/needed prefixes rather than every step, or store views/compressed arrays; apply a sane default decimation cap for the wavelength axis in the response.
- **Depends on:** PG-05

</details>

<details><summary><code>PG-08</code> ⚪ <b>Inline stratified-target binning reimplemented in _execute_splitter</b> <i>(Boundary violation, S/med)</i></summary>

- **Location:** `api/playground.py:1175-1185`
- **Evidence:** After delegating group resolution to nirs4all resolve_split_groups (1124), _execute_splitter manually re-bins continuous y for any 'Stratified' splitter: computes np.unique, n_bins=min(5,...), and np.digitize(split_y, np.percentile(...)) to fabricate class labels. This ML preprocessing decision (how to discretize a regression target for stratification) lives in the backend rather than the library.
- **Impact:** The webapp's stratification preview can disagree with how nirs4all actually stratifies during a real run, giving a misleading fold preview. Small but a correctness/boundary smell.
- **Recommendation:** Use nirs4all's own target-binning for stratified splitters (or a shared helper) so preview folds match library behavior; do not hard-code the 5-bin percentile scheme in the route layer.

</details>


### 5.11 Build tooling, dependencies, and config debt

*Reviewed: package.json (142), vite.config.ts (125), vitest.config.ts (17), eslint.config.js (29), tsconfig.json/app.json/node.json, postcss.config.js, ruff.toml, .gitignore, electron-builder.yml/.installer.yml/.archive.yml (3x126), backend.spec, nirs4all-webapp.spec, scripts/build.py, launcher.py, scripts/check-py-syntax.py, .storybook/main.ts+preview.ts+preview.tsx, .mcp.json, requirements*.txt (5), plus grep/codegraph cross-refs across scripts/ .github/ src/ api/*

The studio's build/config surface carries two distinct dead build pipelines and a fully orphaned Storybook setup, plus a layer of redundant npm-script aliases and duplicated electron-builder configs. The root cause is accretion: a legacy PyInstaller path (scripts/build.py + nirs4all-webapp.spec + launcher.py) was superseded by backend.spec + build-backend.cjs/sh + build-release.cjs but never deleted; a Storybook install was started (config + 8 stories + eslint plugin) but its core packages were never added (or were removed) leaving non-functional config; and electron-builder.yml is a byte-identical "compatibility default" copy of electron-builder.installer.yml. Dependency hygiene is mostly good (msgpack, tailwindcss-animate, regl, three all genuinely used), with only two truly dead deps (encoding, @tailwindcss/typography) and one misplaced type package. Generated dirs are correctly gitignored; the only stray tracked-but-useless file is an empty .mcp.json. None of this is a correctness bug, but it is meaningful pre-v1 clutter that makes the build story confusing (e.g. docs already flag nirs4all-webapp.spec as a "Critical" wrong reference).

| ID | Sev | Cat | Title | Effort/Risk |
|---|---|---|---|---|
| `BLD-01` | 🟠 | Dead code | Dead legacy PyInstaller build path: scripts/build.py + nirs4all-webapp.spec + launcher.py | S/low |
| `BLD-02` | 🟠 | Dead code | Orphaned, non-functional Storybook setup (config + 8 stories + eslint plugin, no core packages) | M/low |
| `BLD-03` ⤿ | 🟡 | Duplication | electron-builder.yml is a byte-identical duplicate of electron-builder.installer.yml | S/low |
| `BLD-05` | 🟡 | Build | ci:local* scripts hardcode Windows-only 'scripts\ci-local.cmd' (broken on the Linux/WSL dev platform) | S/low |
| `BLD-04` | ⚪ | Duplication | Redundant duplicate npm script aliases (lint/test/type-check/nodes) | S/low |
| `BLD-06` | ⚪ | Dead code | Dead npm dependencies: 'encoding' and '@tailwindcss/typography' | S/low |
| `BLD-07` | ⚪ | Duplication | lint:py-syntax (check-py-syntax.py) is redundant with ruff in the green gate | S/low |
| `BLD-08` | ⚪ | Packaging | @types/three placed in dependencies instead of devDependencies; empty tracked .mcp.json | S/low |

<details><summary><code>BLD-01</code> 🟠 <b>Dead legacy PyInstaller build path: scripts/build.py + nirs4all-webapp.spec + launcher.py</b> <i>(Dead code, S/low)</i></summary>

- **Location:** `scripts/build.py:1-300+, nirs4all-webapp.spec:1-239, launcher.py:1`
- **Evidence:** scripts/build.py is referenced NOWHERE across the tracked tree (git grep for 'build.py' excluding the unrelated build-backend/copy-backend/etc. scripts returns 0 hits; not in any .cjs, .sh, .github/workflows, or package.json). It is the ONLY consumer of nirs4all-webapp.spec (build.py:156 'spec_file = project_dir / nirs4all-webapp.spec'). nirs4all-webapp.spec:239 is the ONLY reference to launcher.py ([str(spec_dir / 'launcher.py')]); launcher.py:7 self-documents 'This file is referenced by nirs4all-webapp.spec (line 228)'. The LIVE PyInstaller path uses backend.spec (entry main.py at backend.spec:214) via build-backend.cjs:143, build-backend.sh:108, build-release.cjs. docs/_internals/review-config-cicd.md:49 already calls nirs4all-webapp.spec references 'Critical' wrong (file is actually backend.spec).
- **Impact:** Three files (~13KB: a 300+ line build orchestrator, a 9KB spec, a launcher) present a second, broken build story. New contributors can't tell which spec/launcher is real; docs already had to issue a 'this reference is wrong' warning. Pure pre-v1 clutter with zero callers.
- **Recommendation:** Delete scripts/build.py, nirs4all-webapp.spec, and launcher.py. Update README.md:360-361 (which still lists launcher.py and nirs4all-webapp.spec in the tree diagram) to reflect backend.spec as the sole spec.

</details>

<details><summary><code>BLD-02</code> 🟠 <b>Orphaned, non-functional Storybook setup (config + 8 stories + eslint plugin, no core packages)</b> <i>(Dead code, M/low)</i></summary>

- **Location:** `.storybook/main.ts:1-17, .storybook/preview.ts, .storybook/preview.tsx, eslint.config.js:2,29, package.json:130`
- **Evidence:** .storybook/main.ts imports '@storybook/react-vite' and lists 5 addons (@chromatic-com/storybook, @storybook/addon-vitest, @storybook/addon-a11y, @storybook/addon-docs, @storybook/addon-onboarding). NONE of storybook, @storybook/* core, or those addons are in package.json devDependencies, and none are installed (ls node_modules/storybook -> not present). There is NO 'storybook' or 'build-storybook' npm script (grep returns 0). 11 tracked files exist (3 .storybook config + 8 *.stories.tsx). Only the lint plugin remains: eslint.config.js:29 applies storybook.configs['flat/recommended'] and devDep eslint-plugin-storybook@10.2.10 (package.json:130). Both .storybook/preview.ts AND preview.tsx exist (duplicate preview config).
- **Impact:** Storybook cannot run (npx storybook would fail on missing @storybook/react-vite). The whole surface (config, 8 story files, duplicate preview files, eslint plugin, lint rules) is dead weight enforcing a tooling story that doesn't exist. The eslint plugin still loads a flat config for tooling nobody can launch.
- **Recommendation:** Decide: either (a) fully restore Storybook (add @storybook/react-vite + addons + a 'storybook' script), or (b) delete it. Given no script and no core deps, recommend deletion: remove .storybook/, the 8 *.stories.tsx files, the storybook import + storybook.configs line in eslint.config.js, and the eslint-plugin-storybook devDep. Also collapse preview.ts/preview.tsx duplication if kept.

</details>

<details><summary><code>BLD-03</code> 🟡 <b>electron-builder.yml is a byte-identical duplicate of electron-builder.installer.yml</b> <i>(Duplication, S/low)</i> · **⤿ merged**</summary>

- **Location:** `electron-builder.yml:1-126, electron-builder.installer.yml:1-126`
- **Evidence:** diff electron-builder.yml electron-builder.installer.yml reports the files are identical (126 lines each). electron-builder.yml:17-18 self-describes as a 'Compatibility default: installer packaging remains the implicit electron-builder config.' The actual build commands use the explicit installer file: build-release.cjs:225 ('electron-builder --config electron-builder.installer.yml') and build-release.sh:171. The bare electron-builder.yml is referenced ONLY by build-test.cjs:166's config-iteration loop ['electron-builder.yml','electron-builder.installer.yml','electron-builder.archive.yml']. electron-builder.archive.yml shares ~90% of the same blocks (same appId, directories, files, license extraResources, mac/linux skeleton), differing only in targets (zip/dir) and backend filter ('**/*' vs the api/websocket/updater allowlist).
- **Impact:** A maintained config file (icons, nsis options, deb depends, dmg layout, publish target) is kept in two identical copies plus a third 90%-overlapping one. Any change must be made in 2-3 places or they silently diverge; the 'compatibility default' framing is exactly the pre-v1 legacy pattern to remove.
- **Recommendation:** Delete electron-builder.yml (the unused identical copy) and update build-test.cjs:166 to drop it from the iteration list. Optionally factor the shared blocks (appId/directories/files/license extraResources/nsis/dmg/deb) of installer.yml and archive.yml into a base via electron-builder's 'extends', leaving only the target/backend-filter deltas per file.

</details>

<details><summary><code>BLD-05</code> 🟡 <b>ci:local* scripts hardcode Windows-only 'scripts\ci-local.cmd' (broken on the Linux/WSL dev platform)</b> <i>(Build, S/low)</i></summary>

- **Location:** `package.json:36-40`
- **Evidence:** ci:local, ci:local:lint, ci:local:test, ci:local:build, ci:local:e2e all invoke 'scripts\\ci-local.cmd' with a backslash Windows path. ls scripts/ci-local.* shows ONLY scripts/ci-local.cmd (a 4.6KB .cmd batch) — there is no ci-local.sh. On Linux/macOS (the actual dev tree here is WSL2 Linux) npm cannot execute a .cmd, so these 5 scripts are non-functional off Windows. A fully cross-platform alternative already exists: the ci:docker:* family (lines 41-47) runs via 'bash scripts/ci-test.sh'.
- **Impact:** Five advertised CI scripts silently fail on the primary dev OS, while a parallel cross-platform ci:docker set does the same job — confusing and a maintenance trap pre-v1.
- **Recommendation:** Either add a POSIX scripts/ci-local.sh and make the npm scripts OS-aware (or just call the shell script on non-Windows), or delete the ci:local* scripts entirely and standardize on ci:docker:* / the green-gate :parallel scripts.

</details>

<details><summary><code>BLD-04</code> ⚪ <b>Redundant duplicate npm script aliases (lint/test/type-check/nodes)</b> <i>(Duplication, S/low)</i></summary>

- **Location:** `package.json:22-25,29-34`
- **Evidence:** Four pairs of scripts run identical commands: lint (22) and lint:eslint (23) are both 'eslint .'; test (29) and test:frontend (30) are both 'vitest run'; type-check (33) and lint:tsc (24) are both 'tsc --noEmit'; lint:nodes (25) and validate:nodes (34) are both 'node scripts/validate-node-registry.cjs'. The :parallel aggregators reference the namespaced variants (lint:eslint/lint:tsc/lint:nodes), and CLAUDE.md green-gate names validate:nodes — so each pair has one 'real' consumer and one bare alias kept for convenience.
- **Impact:** Doubles the script surface a reader must reconcile; ambiguous which alias is canonical for CI vs local. Minor but compounds the overall script clutter.
- **Recommendation:** Keep the namespaced forms used by lint:parallel/test:parallel/green-gate (lint:eslint, test:frontend, lint:tsc, validate:nodes) and remove the bare duplicates (lint, test as alias-of-frontend if not the documented entry, type-check, lint:nodes) — or keep exactly one canonical name per task and point :parallel at it. Trim to a single source per command.

</details>

<details><summary><code>BLD-06</code> ⚪ <b>Dead npm dependencies: 'encoding' and '@tailwindcss/typography'</b> <i>(Dead code, S/low)</i></summary>

- **Location:** `package.json:94 (encoding), package.json:117 (@tailwindcss/typography)`
- **Evidence:** 'encoding' (dep, line 94): zero import/require sites in src/ or electron/ (the only 'encoding' hits are unrelated text — sklearn-encoding.json import and a canonical-registry.json string). It is pulled in transitively anyway as a node-fetch dependency (package-lock.json shows encoding under node-fetch@^2 at lines 10445/10694), so the direct declaration is redundant. '@tailwindcss/typography' (devDep, line 117): not present in tailwind.config.ts plugins (grep 'typography' tailwind.config.ts -> 0 matches; tailwind.config.ts:174 only registers require('tailwindcss-animate')) and imported nowhere. By contrast @msgpack/msgpack (dynamic import in src/api/client.ts:403), tailwindcss-animate (tailwind.config.ts:174), regl, three, @react-three/* are all genuinely used and must stay.
- **Impact:** Two declared deps that contribute nothing — install-time and audit-surface noise, and a false signal that the typography prose plugin / encoding shim are part of the app.
- **Recommendation:** Remove 'encoding' from dependencies and '@tailwindcss/typography' from devDependencies; run npm install to prune the lockfile. (encoding remains available transitively via node-fetch if any runtime path needs it.)

</details>

<details><summary><code>BLD-07</code> ⚪ <b>lint:py-syntax (check-py-syntax.py) is redundant with ruff in the green gate</b> <i>(Duplication, S/low)</i></summary>

- **Location:** `package.json:27, scripts/check-py-syntax.py:1-20`
- **Evidence:** lint:py-syntax runs scripts/check-py-syntax.py, which py_compile's 'main.py' + glob('api/*.py') purely to detect syntax errors. The parallel gate (lint:parallel, package.json:28) ALSO runs lint:ruff ('ruff check .'), and ruff reports syntax/parse errors as E999 before any other rule — covering the same Python files (ruff.toml targets the backend). So py-syntax is a strict subset of what ruff already validates, run as a separate concurrently lane.
- **Impact:** An extra green-gate lane and a maintained helper script that duplicates ruff's parse step; adds startup cost and one more name in lint:parallel for no additional coverage.
- **Recommendation:** Drop the lint:py-syntax script and scripts/check-py-syntax.py, and remove py-syntax from the lint:parallel concurrently list (rely on ruff's E999). Keep only if ruff is ever scoped to exclude main.py/api — which it currently is not.

</details>

<details><summary><code>BLD-08</code> ⚪ <b>@types/three placed in dependencies instead of devDependencies; empty tracked .mcp.json</b> <i>(Packaging, S/low)</i></summary>

- **Location:** `package.json:89 (@types/three), .mcp.json:1-3`
- **Evidence:** @types/three@^0.182.0 is listed under 'dependencies' (line 89) rather than 'devDependencies'; @types/* are type-only, consumed at build/type-check time, never shipped at runtime. .mcp.json is tracked (git ls-files confirms) but contains only {"mcpServers": {}} — an empty, no-op config committed to the repo.
- **Impact:** Minor packaging hygiene: a type package in the runtime dependency set misleads dependency tooling/audits and could be pulled into a 'production' install. The empty .mcp.json is a useless tracked file (each dev's MCP setup is local).
- **Recommendation:** Move @types/three to devDependencies. Remove .mcp.json from git (add to .gitignore if any dev wants a local one) since it carries no shared config.

</details>


### 5.12 Frontend incomplete migrations / duplicated components (legacy-compat + duplication)

*Reviewed: src/components/pipeline-editor/contexts/NodeRegistryContext.tsx (9), NodeRegistryContext.v2.tsx (660), contexts/index.ts (54), src/data/nodes/NodeRegistry.ts (656, partial), src/components/datasets/charts/SpectraChart.tsx (212), src/components/spectra-synthesis/chart/SpectraChart.tsx (305), src/components/playground/visualizations/YHistogramV2.tsx (22), chartConfig.ts (deprecated clusters lines 182-540), src/components/pipeline-editor/types.ts (deprecated variant fns), plus grep marker sweep across src/*

The pipeline-editor's node registry migration was never finished: NodeRegistryContext.v2.tsx is the only real implementation, fronted by a 9-line re-export shim NodeRegistryContext.tsx whose sole purpose is to keep the ".v2" filename out of import sites. Both production mount points (PipelineEditor.tsx:1148, Playground.tsx:436) hardcode `useJsonRegistry`, and USE_NODE_REGISTRY defaults to true, so the entire Phase-1 "legacy stepOptions" branch (~90 lines) plus the prop/env-flag plumbing is unreachable legacy-compat. The playground "V2" visualization suffix (SpectraChartV2, FoldDistributionChartV2, YHistogramV2) is orphaned naming noise — git history confirms no V1 ever existed in playground/visualizations; YHistogramV2.tsx is an explicit backward-compat re-export shim that is itself the live import path. The two SpectraChart implementations (datasets/charts vs spectra-synthesis/chart) are NOT pure duplication — different inputs and concerns — but share Recharts scaffolding. data/nodes/NodeRegistry.ts is the data-structure class consumed by the context, not a competing third registry. The chartConfig.ts deprecated-color cluster is half-dead: several `@deprecated` symbols are only self-referenced (dead), while others (SELECTION_COLORS, FOLD_COLORS, getSampleColorByY) still have live importers. Root cause: phased migrations (Phase 1→2 registry, V1→V2 viz, color-config consolidation) were shipped without the final deletion pass, leaving shims, feature flags, and "vN" suffixes as permanent residue with no v1 compat contract to justify them.

| ID | Sev | Cat | Title | Effort/Risk |
|---|---|---|---|---|
| `FE-01-reg` | 🟠 | Legacy/compat | NodeRegistryContext.tsx is a pure re-export shim hiding an unfinished .v2 rename | S/low |
| `FE-02-reg` | 🟠 | Dead code | Dead Phase-1 'legacy stepOptions' branch and useJsonRegistry/USE_NODE_REGISTRY feature flag in node registry context | M/med |
| `FE-03-reg` | 🟡 | Legacy/compat | Orphaned 'V2' suffix across playground visualization components (no V1 ever existed) | S/low |
| `FE-05-reg` | 🟡 | Dead code | Dead @deprecated color/legend helpers in chartConfig.ts (only self-referenced, no live importers) | S/low |
| `FE-06-reg` | 🟡 | Legacy/compat | @deprecated color constants still imported by live components (incomplete colorConfig migration) | M/med |
| `FE-04-reg` | ⚪ | Legacy/compat | YHistogramV2.tsx is a backward-compat re-export shim over histogram/ split | S/low |
| `FE-07-reg` | ⚪ | Duplication | Two SpectraChart implementations with duplicated Recharts scaffolding (datasets vs spectra-synthesis) | M/low |

<details><summary><code>FE-01-reg</code> 🟠 <b>NodeRegistryContext.tsx is a pure re-export shim hiding an unfinished .v2 rename</b> <i>(Legacy/compat, S/low)</i></summary>

- **Location:** `src/components/pipeline-editor/contexts/NodeRegistryContext.tsx:1-9; src/components/pipeline-editor/contexts/NodeRegistryContext.v2.tsx:1-660`
- **Evidence:** NodeRegistryContext.tsx is 9 lines: `export * from "./NodeRegistryContext.v2";` with comment 'thin re-export so existing imports ... continue to work while the actual implementation lives in NodeRegistryContext.v2.tsx'. All live importers (StepPalette.tsx:40, shared/stepMetadata.ts:7, contexts/index.ts:27) go through the shim; only NodeRegistryContext.v2.test.tsx:8 imports `.v2` directly. There is no NodeRegistryContext (non-shim, non-v2) implementation — the 'v2' suffix has no v1 sibling.
- **Impact:** Two files, one dead indirection, for a single live context. The '.v2' filename is migration residue: every reader must hop through a meaningless shim, and the name implies a v1 that does not exist. Pre-v1 with no compat contract, this is gratuitous.
- **Recommendation:** Rename NodeRegistryContext.v2.tsx -> NodeRegistryContext.tsx (overwriting the shim), delete the shim, and repoint NodeRegistryContext.v2.test.tsx and any '.v2' import to the canonical path. Single file, single name.

</details>

<details><summary><code>FE-02-reg</code> 🟠 <b>Dead Phase-1 'legacy stepOptions' branch and useJsonRegistry/USE_NODE_REGISTRY feature flag in node registry context</b> <i>(Dead code, M/med)</i></summary>

- **Location:** `src/components/pipeline-editor/contexts/NodeRegistryContext.v2.tsx:44-52 (USE_NODE_REGISTRY), 167-179 (stepOptionToNodeDefinition), 209-218 (useJsonRegistry prop), 467-550 (legacy value object)`
- **Evidence:** USE_NODE_REGISTRY (line 49-51) defaults true unless VITE_USE_NODE_REGISTRY==='false'. NodeRegistryProvider defaults `useJsonRegistry = USE_NODE_REGISTRY`. codegraph callers of NodeRegistryProvider = 3: PipelineEditor.tsx:103, Playground.tsx:45, and the test. Both production mounts pass the flag explicitly: Playground.tsx:436 `<NodeRegistryProvider useJsonRegistry>` and PipelineEditor.tsx:1148 `<NodeRegistryProvider useJsonRegistry>`. The flag is therefore always true, so the entire `else` branch at lines 467-550 (the Map<StepType,NodeDefinition[]> built from stepOptions, with getParameterDef/getSweepableParams/getCategoryConfig returning empty stubs and isJsonRegistry:false), plus stepOptionToNodeDefinition (167-179), are unreachable. grep finds no caller passing useJsonRegistry={false}.
- **Impact:** ~90 lines of legacy-compat dead code in a 660-line context, including stub method implementations that silently degrade (getParameterDef:()=>undefined) and a parallel data-shaping path. It forces every reader to reason about a 'legacy mode' that can never execute and keeps the VITE_USE_NODE_REGISTRY env knob and stepOptionToNodeDefinition alive.
- **Recommendation:** Delete the legacy branch (467-550), stepOptionToNodeDefinition, the useJsonRegistry prop, the USE_NODE_REGISTRY const, the VITE_USE_NODE_REGISTRY entry in vite-env.d.ts:8, and the `useJsonRegistry` attribute at the two mount sites. Collapse the useMemo value to the JSON-registry-only object. Note stepOptions itself stays (still used by FeatureAugmentationPanel/StackingPanel/stepMetadata/pipelineConverter); only its use INSIDE the context dies.
- **Depends on:** FE-01-reg

</details>

<details><summary><code>FE-03-reg</code> 🟡 <b>Orphaned 'V2' suffix across playground visualization components (no V1 ever existed)</b> <i>(Legacy/compat, S/low)</i></summary>

- **Location:** `src/components/playground/visualizations/SpectraChartV2.tsx:134; FoldDistributionChartV2.tsx:239; visualizations/index.ts:11,14,17; histogram/index.tsx:56; consumed in MainCanvas.tsx:1003,1026,1103,1138`
- **Evidence:** find shows only V2 files exist; grep for `function SpectraChart`/`function FoldDistributionChart`/`function YHistogram` (non-V2) in src/components/playground returns nothing. `git log --all -- src/components/playground/visualizations/SpectraChart.tsx` returns no history (file never existed). index.ts comments say 'SpectraChart - Enhanced with Phase 3 features', 'YHistogram - Enhanced with KDE', 'FoldDistributionChart - Enhanced with SelectionContext' — i.e. these ARE the only versions. The 'V2' is a leftover from an in-place rewrite, not a coexisting v1/v2 pair.
- **Impact:** Misleading naming: implies a deprecated V1 to migrate off, and the suffix propagates into prop type names (SpectraChartV2Props, YHistogramV2Props), hook code (useHistogramData(props: YHistogramV2Props)), and test filenames (FoldDistributionChartV2.test.ts). Pure cosmetic debt but pervasive and confusing for a v1 cut.
- **Recommendation:** Drop the 'V2' suffix from SpectraChartV2/FoldDistributionChartV2/YHistogramV2 and their Props types in one rename pass; update the three re-exports in visualizations/index.ts, the four usages in MainCanvas.tsx, and the test file. Note this collides with FE-04 (delete YHistogramV2.tsx shim) — do them together.
- **Depends on:** FE-04-reg

</details>

<details><summary><code>FE-05-reg</code> 🟡 <b>Dead @deprecated color/legend helpers in chartConfig.ts (only self-referenced, no live importers)</b> <i>(Dead code, S/low)</i></summary>

- **Location:** `src/components/playground/visualizations/chartConfig.ts:211 getFoldColor, 219 TRAIN_TEST_COLORS, 244 getSampleColorByFold, 352 getSelectionStateColor, 514 getFoldLegendItems, 525 getTrainTestLegendItems`
- **Evidence:** All six are marked `@deprecated DO NOT USE - Use ... from '@/lib/playground/colorConfig'`. grep across src/ (excluding chartConfig.ts and tests) finds zero live importers for getFoldColor, getSelectionStateColor, getFoldLegendItems, getTrainTestLegendItems, getSampleColorByFold, TRAIN_TEST_COLORS. Their only remaining references are internal to chartConfig.ts itself (e.g. getFoldColor called at 254/517; TRAIN_TEST_COLORS at 527-528; getFoldLegendItems/getTrainTestLegendItems are leaf exports with no callers at all). The replacement module colorConfig.ts is the live one.
- **Impact:** A cluster of deprecated color helpers kept alive only by referencing each other — a self-sustaining dead island in a chart-config file that already has a designated successor (colorConfig.ts). Pre-v1 these should be gone, not annotated.
- **Recommendation:** Delete getFoldColor, getSampleColorByFold, getSelectionStateColor, getFoldLegendItems, getTrainTestLegendItems, TRAIN_TEST_COLORS and their now-dead internal call sites (the DEPRECATED Color Palettes / Selection Colors sections lines 182-360, 505-540). Do NOT touch SELECTION_COLORS, FOLD_COLORS, getSampleColorByY — see FE-06.

</details>

<details><summary><code>FE-06-reg</code> 🟡 <b>@deprecated color constants still imported by live components (incomplete colorConfig migration)</b> <i>(Legacy/compat, M/med)</i></summary>

- **Location:** `src/components/playground/visualizations/chartConfig.ts: SELECTION_COLORS (321), FOLD_COLORS (~185), getSampleColorByY; live importers: inspector/InspectorSavedSelections.tsx, playground/visualizations/SpectraWebGL.tsx, playground/SavedSelections.tsx, lib/playground/colorConfig.ts, visualizations/scatter/utils/colorEncoding.ts`
- **Evidence:** SELECTION_COLORS is marked `@deprecated ... Use HIGHLIGHT_COLORS from colorConfig` yet imported by 3 live files (InspectorSavedSelections.tsx, SpectraWebGL.tsx, SavedSelections.tsx). FOLD_COLORS (deprecated) is imported by colorConfig.ts and scatter/utils/colorEncoding.ts. getSampleColorByY (deprecated, '... Use getUnifiedSampleColor') is imported by SpectraWebGL.tsx. So the colorConfig consolidation is half-done: the new module exists but live call sites were never migrated off the deprecated symbols.
- **Impact:** A live legacy path that is documented as 'DO NOT USE' yet actively used, including by colorConfig.ts (the supposed replacement importing the thing it deprecates). This is the load-bearing kind of debt: the deprecation markers are now lies and block deleting chartConfig's color layer.
- **Recommendation:** Finish the migration: repoint InspectorSavedSelections/SpectraWebGL/SavedSelections to HIGHLIGHT_COLORS, SpectraWebGL to getUnifiedSampleColor, and scatter/colorEncoding + colorConfig.ts to the canonical fold color from colorConfig; then delete SELECTION_COLORS/FOLD_COLORS/getSampleColorByY. If the replacements are not behavior-equivalent, that is a real porting task, not a rename — verify before deleting.
- **Depends on:** FE-05-reg

</details>

<details><summary><code>FE-04-reg</code> ⚪ <b>YHistogramV2.tsx is a backward-compat re-export shim over histogram/ split</b> <i>(Legacy/compat, S/low)</i></summary>

- **Location:** `src/components/playground/visualizations/YHistogramV2.tsx:1-22; re-exported again by visualizations/index.ts:14`
- **Evidence:** YHistogramV2.tsx body is 3 export lines: `export { YHistogramV2 } from './histogram'`, `export type { BinCountOption }`, `export { default } from './histogram'`, with header 'This file preserves backward compatibility for existing imports. The component has been split into sub-components'. The real implementation is histogram/index.tsx:56. The only live importer is visualizations/index.ts:14 which immediately re-exports it, so it is a shim feeding a barrel (double indirection).
- **Impact:** An extra file whose only job is to forward to ./histogram, after the histogram split already shipped. Minor, but it is exactly the 'preserve backward compatibility' pattern the no-compat-shim rule forbids pre-v1.
- **Recommendation:** Delete YHistogramV2.tsx; change visualizations/index.ts:14 to `export { YHistogramV2 } from './histogram'` (and BinCountOption from './histogram/types'). Fold the rename into FE-03.

</details>

<details><summary><code>FE-07-reg</code> ⚪ <b>Two SpectraChart implementations with duplicated Recharts scaffolding (datasets vs spectra-synthesis)</b> <i>(Duplication, M/low)</i></summary>

- **Location:** `src/components/datasets/charts/SpectraChart.tsx:61-212; src/components/spectra-synthesis/chart/SpectraChart.tsx:112-305`
- **Evidence:** Both export a component named `SpectraChart` built on the same Recharts ComposedChart/XAxis/YAxis/CartesianGrid/Tooltip/Line scaffold with hsl(var(--*)) theming and a useMemo data transform. They differ in input contract and concern: datasets/charts takes PRE-AGGREGATED arrays (meanSpectrum/min/maxSpectrum) and derives unit-aware axis labels via getWavelengthAxisLabel (nm vs cm-1); spectra-synthesis/chart takes RAW spectra[][]+targets, computes mean/std itself (lines 136-150), draws up-to-50 target-colored sample lines (getColorForTarget, 78-110), and hardcodes 'Wavelength (nm)'/'Absorbance'. The datasets copy is re-exported via datasets/index.ts and used in PreviewStep/DatasetQuickView/DatasetSpectraTab; the synthesis copy is local to spectra-synthesis.
- **Impact:** Same component name, overlapping chart-shell boilerplate, and the synthesis copy reimplements mean/std and hardcodes the nm label that the datasets copy already solved generically. Two NIRS spectra renderers drift independently (unit handling, tooltip formatting). Real but bounded duplication; not dead code.
- **Recommendation:** Extract the shared ComposedChart shell (axes/grid/tooltip/theme + unit-aware label) into one base spectra chart and have both call it, OR (lighter) port the synthesis chart's nm hardcoding to reuse getWavelengthAxisLabel/formatWavelengthUnit from chartConfig so unit handling lives in one place. Do not merge the input contracts (aggregated vs raw) — they are legitimately different.

</details>


### 5.13 Backend PERFORMANCE bottlenecks (api/)

*Reviewed: main.py (629), launcher.py (63), api/lazy_imports.py (341), api/shared/decimation.py (104), api/shared/runtime_grouping.py (head), api/shared/pipeline_service.py (head), api/shared/dataset_config.py (head), api/spectra.py (1-422), api/datasets.py (preview/stats/list endpoints), api/playground.py (execute/execute-dataset/pca/repetitions + PlaygroundExecutor), api/aggregated_predictions.py (367-855), api/runs.py (list_runs + endpoint map), api/recommended_config.py (271-300), api/updates.py (735-748), websocket/manager.py (head)*

The two-phase lazy-startup design (api/lazy_imports.py + main.py lifespan) is well-intentioned but partially defeated: an eager router import chain (main.py imports pipelines_router/runs_router → those import api.shared.runtime_grouping → it imports nirs4all.controllers.splitters.split at module top) drags the ENTIRE nirs4all+sklearn stack (~1.3-1.7s) into cold start synchronously, before the background thread even runs. The dominant runtime bottleneck is that nearly every heavy compute/IO endpoint is declared `async def` yet performs fully synchronous, multi-second CPU/IO work directly on the asyncio event loop with zero thread offloading (grep: 0 run_in_executor/to_thread in playground.py, only 1 in runs.py): playground /execute and /execute-dataset run the full sklearn fit_transform pipeline (up to 10k×4k matrices); /pca and /repetitions run PCA/TSNE/UMAP; spectra and dataset preview endpoints do full DatasetConfigs parquet loads + dataset.x() materialization. While one runs, websocket progress, health checks, and all concurrent requests are blocked. Secondary debts: an unbounded module-level dataset cache (spectra.py:39) that pins every materialized SpectroDataset in memory forever, and full-dataset materialization in spectra endpoints where the existing decimate_wavelengths helper (used only in playground) is never applied. Root cause: the backend treats blocking ML/IO work as if it were cheap async handlers, and lazy-import boundaries are not enforced at the router-import layer.

| ID | Sev | Cat | Title | Effort/Risk |
|---|---|---|---|---|
| `PERF-01` | 🟠 | Performance | Eager router import chain loads the full nirs4all+sklearn stack at cold start, defeating two-phase lazy loading | M/low |
| `PERF-02` | 🟠 | Performance | Playground /execute and /execute-dataset run full sklearn pipeline synchronously on the event loop (no thread offload) | M/low |
| `PERF-03` | 🟠 | Performance | Spectra and dataset-preview endpoints do full parquet load + matrix materialization synchronously in async handlers | M/low |
| `PERF-04` | 🟡 | Performance | Unbounded module-level _dataset_cache pins every materialized SpectroDataset in memory for the process lifetime | S/low |
| `PERF-05` | 🟡 | Performance | Spectra endpoints return full-width spectra (all wavelengths) — decimate_wavelengths helper exists but is never applied outside playground | S/low |
| `PERF-06` | 🟡 | Performance | Aggregated-predictions query endpoints run multi-step DB enrichment + parquet reads synchronously on the event loop | S/low |

<details><summary><code>PERF-01</code> 🟠 <b>Eager router import chain loads the full nirs4all+sklearn stack at cold start, defeating two-phase lazy loading</b> <i>(Performance, M/low)</i></summary>

- **Location:** `api/shared/runtime_grouping.py:8 (via api/pipelines.py:39 and api/runs.py:36, eagerly imported by main.py:77,84)`
- **Evidence:** runtime_grouping.py line 8 does a module-level `from nirs4all.controllers.splitters.split import (get_split_grouping_capability, resolve_split_groups, ...)`. pipelines.py:39 and runs.py:36 import it at module top; main.py:77/84 import pipelines_router/runs_router eagerly. Measured: `python -c 'from api.shared.runtime_grouping import prepare_pipeline_steps_with_runtime_grouping'` = 1.29s warm / 1.7s cold (importtime shows nirs4all, nirs4all.api.explain, nirs4all.data, nirs4all.core.metrics, sklearn all pulled in). After this import `nirs4all` and `sklearn` are already in sys.modules.
- **Impact:** The entire lazy_imports.py / _do_load_ml_deps background-thread design exists to keep nirs4all+sklearn off the cold-start path so FastAPI Phase 1 (startup_complete) is fast and Electron can show the window. This eager chain loads ~1.7s of heavy deps synchronously during router import (before lifespan even runs), so Phase 1 is no longer cheap and the background thread re-loads what is already imported. The STARTUP TIMING logs in main.py for 'All router imports' will show this cost.
- **Recommendation:** Make runtime_grouping defer its nirs4all import: move `from nirs4all.controllers.splitters.split import ...` inside the functions that use it (prepare_pipeline_steps_with_runtime_grouping etc.) or fetch via lazy_imports.get_cached. Audit every router module imported in main.py for transitive module-level nirs4all/sklearn imports and push them into function bodies, so router import stays import-light and the background ML loader is the only place the heavy stack is loaded.

</details>

<details><summary><code>PERF-02</code> 🟠 <b>Playground /execute and /execute-dataset run full sklearn pipeline synchronously on the event loop (no thread offload)</b> <i>(Performance, M/low)</i></summary>

- **Location:** `api/playground.py:2026 execute_pipeline, api/playground.py:2124 execute_dataset_pipeline (PlaygroundExecutor.execute at :239)`
- **Evidence:** execute_pipeline is `async def` (line 2026) and calls `result = executor.execute(...)` directly (line 2104). PlaygroundExecutor.execute (line 239) is a plain synchronous method that calls `operator.fit_transform(X, ...)` (lines 928, 987), `filter_op.fit_predict` (1029), `reducer.fit_transform` (1392, TSNE/UMAP/PCA). Limits allow up to MAX_SAMPLES=10000 × MAX_FEATURES=4000 matrices. grep `run_in_executor|to_thread|run_in_threadpool` in playground.py = 0 matches.
- **Impact:** This is the most-used interactive endpoint (real-time pipeline preview). Every call blocks the single asyncio event loop for the full CPU-bound duration (can be seconds for TSNE/UMAP on 10k×4k), freezing websocket training/progress streams, /api/health used by Electron readiness, and all concurrent HTTP requests. Under any concurrency the backend appears frozen.
- **Recommendation:** Offload the synchronous executor.execute / _compute_pca / reducer.fit_transform calls to a thread via `await anyio.to_thread.run_sync(...)` or `await asyncio.get_running_loop().run_in_executor(None, ...)`. Apply the same to compute_pca_chart/_compute_pca and compute_repetitions_chart.

</details>

<details><summary><code>PERF-03</code> 🟠 <b>Spectra and dataset-preview endpoints do full parquet load + matrix materialization synchronously in async handlers</b> <i>(Performance, M/low)</i></summary>

- **Location:** `api/spectra.py:263 get_spectra, :378 get_spectrum, api/datasets.py:990 preview_dataset, :1602 get_dataset_stats`
- **Evidence:** All four are `async def` but call blocking work inline: spectra.get_spectra calls `_load_dataset` (DatasetConfigs().get_datasets() parquet read, spectra.py:148-151) then `_get_partition_arrays` which calls `dataset.x(sel, layout='2d', ...)` and `np.concatenate` (spectra.py:197,246) then `X_slice.tolist()` (:344). datasets.preview_dataset calls `get_cached('DatasetConfigs')(config).get_datasets()` and multiple `dataset.x({'partition':...})` (datasets.py:1018,1031,1036,1098). get_dataset_stats calls `dataset.x(...)` at :1614. None use run_in_executor/to_thread.
- **Impact:** Dataset loads read parquet/CSV from disk and materialize full (n_samples × n_wavelengths) numpy arrays plus a Python-list JSON conversion — all on the event loop. For real datasets this is hundreds of ms to seconds, blocking every other request and websocket message for that window. Dataset preview/stats are triggered on UI navigation, so the freeze is user-visible.
- **Recommendation:** Wrap the blocking dataset load + .x()/.y() materialization + .tolist() in `await anyio.to_thread.run_sync(...)`. Consolidate the repeated `_load_dataset`+materialize pattern (spectra get_spectra/get_spectrum/datasets get_dataset_stats/playground compute_pca_chart all repeat it) into one thread-offloaded helper.

</details>

<details><summary><code>PERF-04</code> 🟡 <b>Unbounded module-level _dataset_cache pins every materialized SpectroDataset in memory for the process lifetime</b> <i>(Performance, S/low)</i></summary>

- **Location:** `api/spectra.py:39 (_dataset_cache: dict[str, Any] = {}); written at :160, never size-bounded or TTL-evicted`
- **Evidence:** `_dataset_cache: dict[str, Any] = {}` (spectra.py:39). _load_dataset stores `_dataset_cache[dataset_id] = dataset` (line 160) with no max-size, no LRU, no TTL. Only eviction is explicit `_clear_dataset_cache(dataset_id)` (line 169) called on dataset refresh/load. This same cache is shared by spectra endpoints, datasets.get_dataset (datasets.py:1462), get_dataset_stats (1610), and playground.compute_pca_chart (playground.py:2537).
- **Impact:** Each cached entry is a fully-materialized SpectroDataset holding the entire spectral matrix in RAM. A user browsing many datasets accumulates all of them with no upper bound, so backend RSS grows monotonically — a slow memory leak in a desktop app that already loads tensorflow/torch/sklearn. Contrast with playground._cache (playground.py:1907) which DOES bound entries (_cache_max_entries) and TTL-evict (:1902).
- **Recommendation:** Replace the bare dict with a small bounded LRU (e.g. functools.lru_cache-style or the same _StepCache/OrderedDict-with-cap pattern already used in playground.py:1907), capping to a few datasets and evicting the least-recently-used. Reuse the existing bounded-cache helper rather than adding a new abstraction.

</details>

<details><summary><code>PERF-05</code> 🟡 <b>Spectra endpoints return full-width spectra (all wavelengths) — decimate_wavelengths helper exists but is never applied outside playground</b> <i>(Performance, S/low)</i></summary>

- **Location:** `api/spectra.py:344 get_spectra (X_slice.tolist()); api/shared/decimation.py:81 decimate_wavelengths used only at api/playground.py:780`
- **Evidence:** decimate_wavelengths (decimation.py:81, LTTB feature-preserving downsample) is imported and used only in playground.py:42/780. spectra.get_spectra paginates rows (`X_slice = X[start:end]`, :309) but serializes the FULL wavelength axis: `'spectra': X_slice.tolist()` (:344) with `num_features: X.shape[1]` — no max_wavelengths/decimation parameter exists on the endpoint (signature lines 263-272).
- **Impact:** For wide NIRS spectra (commonly 1000-4000+ wavelengths) the JSON payload is rows × full-width floats — large response bodies and large client-side render cost — even though the chart only needs a few hundred visually-significant points, which the LTTB helper already provides for playground. Inconsistent: playground decimates, the raw spectra viewer does not.
- **Recommendation:** Add an optional `max_wavelengths_returned` query param to get_spectra and apply the existing decimate_wavelengths(headers, X_slice, max) before .tolist(), mirroring playground.py:771-780. No new code needed — reuse api/shared/decimation.py.

</details>

<details><summary><code>PERF-06</code> 🟡 <b>Aggregated-predictions query endpoints run multi-step DB enrichment + parquet reads synchronously on the event loop</b> <i>(Performance, S/low)</i></summary>

- **Location:** `api/aggregated_predictions.py:776 get_aggregated_predictions, :815 get_top_aggregated_predictions, :858 get_chain_detail`
- **Evidence:** These `async def` endpoints call `store.query_chain_summaries(...)` then `_enrich_with_fold_artifacts(records, store)` (:802), `_enrich_refit_with_cv(records, store)` (:803) and a per-record loop `for record in records: _apply_synthetic_refit_fallback_inplace(record)` (:804). _enrich_refit_with_cv issues an extra `store.query_chain_summaries(dataset_name=...)` per affected dataset (:700) plus a pipeline-metadata SQL fetch (_build_pipeline_metadata_map, :424). All SQLite/polars work runs inline on the event loop (no offload).
- **Impact:** The chain-summary list is loaded on the Predictions/Results pages. The enrichment does several SQLite round-trips and polars DataFrame iteration synchronously, blocking the event loop. The enrichment is reasonably batched (no per-record N+1), so the issue is blocking-on-loop rather than algorithmic complexity, but it compounds with PERF-02/03 to make the loop the global serialization point.
- **Recommendation:** Offload the store.query_* + enrichment block to a thread via anyio.to_thread.run_sync. The enrichment functions themselves are already batched and need no algorithmic change.
- **Depends on:** PERF-02

</details>


### 5.14 Frontend god module — src/api/client.ts (3052 LOC)

*Reviewed: src/api/client.ts (3052, read fully); cross-ref greps across src/ (90 importers); backend routers under api/ (datasets.py, pipelines.py, runs.py, workspace.py, updates.py, system.py, projects.py, aggregated_predictions.py, recommended_config.py); callers in src/hooks/useUpdates.ts, src/hooks/usePipelineExecution.ts, src/pages/Datasets.tsx, src/components/datasets/BatchScanDialog.tsx, src/api/playground.ts*

src/api/client.ts is a single 3052-LOC module exporting 193 functions and 73 interfaces/types (268 top-level exports) for the entire surface of the FastAPI backend — workspace, datasets, pipelines, runs, predictions, custom-nodes, system, updates, dependencies, config, projects, aggregated-predictions, enriched-runs — with 90 source files importing from it. The root cause is that one file accreted a thin wrapper per endpoint with no domain boundary, even though the backend is already cleanly partitioned into per-domain routers (api/datasets.py, api/pipelines.py, api/runs.py, api/workspace.py, api/updates.py, api/system.py, etc.). On top of the size, there is a parallel `AxiosLikeClient` ({data}) wrapper kept "for backward compatibility", a duplicated raw-fetch error-handling block copied three times, and a cluster of dead/legacy wrappers (checkHealth, listGroups, downloadWebappUpdate, getWebappDownloadInfo, refreshDatasetVersion, VenvInfo) plus explicit "legacy"/"backward-compatible" aliases (getVenvStatus, createVenv). There is no request-level cancellation or caching primitive: RequestOptions forwards RequestInit.signal but no client function exposes it, and every read re-fetches. The typing is otherwise disciplined (no `any`; `unknown` used at boundaries), so the debt is structure and dead/legacy code, not type safety.

| ID | Sev | Cat | Title | Effort/Risk |
|---|---|---|---|---|
| `CLIENT-01` | 🟠 | God class | 3052-LOC single API client should split into per-domain modules matching backend routers | L/med |
| `CLIENT-04` | 🟠 | Legacy/compat | Explicitly-labeled legacy/backward-compat aliases and the AxiosLikeClient shim | M/med |
| `CLIENT-02` | 🟡 | Duplication | Raw-fetch error-handling block duplicated three times with divergent behavior | M/med |
| `CLIENT-03` | 🟡 | Dead code | Dead exported functions/types — never imported anywhere in src/ | S/low |
| `CLIENT-05` | 🟡 | Performance | No request cancellation or caching primitive across read endpoints | M/low |
| `CLIENT-06` | ⚪ | Antipattern | Large response shapes inlined as anonymous return types instead of named interfaces | S/low |

<details><summary><code>CLIENT-01</code> 🟠 <b>3052-LOC single API client should split into per-domain modules matching backend routers</b> <i>(God class, L/med)</i></summary>

- **Location:** `src/api/client.ts:1-3052`
- **Evidence:** One module exports 193 functions + 73 interfaces/types (268 `export` lines), covering every backend domain: workspace (getWorkspace, getGroups...), datasets (listDatasets...detectUnified...), pipelines (listPipelines, propagateShape...), runs (listRuns, quickRun, runPreflight...), custom-nodes, system (getSystemInfo, getBuildInfo...), updates+dependencies (getUpdateStatus, installDependency...), config (getRecommendedConfig, alignConfig...), projects, aggregated-predictions, enriched-runs. 90 files import from '@/api/client'. The file is structured by hand-numbered 'Phase 2..7' comment banners rather than modules.
- **Impact:** Any change forces editing/loading a 3052-LOC file; every importer pulls the whole module's type graph; no domain isolation makes ownership, tree-shaking, and review of one area impossible. Blocks a clean v1 module layout.
- **Recommendation:** Split into src/api/<domain>.ts mirroring the existing backend routers (workspace.ts, datasets.ts, pipelines.ts, runs.ts, predictions.ts, customNodes.ts, system.ts, updates.ts, dependencies.ts, config.ts, projects.ts, aggregatedPredictions.ts, enrichedRuns.ts). Keep only the transport core (ApiClient, getApiBaseUrl/resetBackendUrl, formatApiErrorDetail, requestBinary) in a shared src/api/http.ts. Re-export from an index barrel only if needed to avoid touching all 90 importers at once.
- **Depends on:** CLIENT-02 (extract transport core first)

</details>

<details><summary><code>CLIENT-04</code> 🟠 <b>Explicitly-labeled legacy/backward-compat aliases and the AxiosLikeClient shim</b> <i>(Legacy/compat, M/med)</i></summary>

- **Location:** `src/api/client.ts:426-449 (AxiosLikeClient/apiClient), 2293-2298 (getVenvStatus), 2300-2315 (createVenv), 2245-2246 (VenvInfo/VenvStatus aliases)`
- **Evidence:** Line 426 comment: 'Axios-like wrapper for backward compatibility with hooks expecting response.data pattern' — class AxiosLikeClient (427-447) duplicates get/post/put/delete just to wrap results in `{ data }`; used by exactly one file (src/hooks/usePipelineExecution.ts, 4 call sites). getVenvStatus (2296) is documented 'Backward-compatible alias for the current runtime status request' and just calls getRuntimeStatus(); createVenv (2303) is documented 'Legacy desktop-managed runtime creation endpoint'. `export type VenvStatus = RuntimeStatus` / `VenvInfo = RuntimeInfo` (2245-2246) are rename shims. With no pre-v1 compat contract, all of these are debt to remove.
- **Impact:** Two parallel client objects (api and apiClient) with different return conventions confuse callers and double the transport surface; venv-named aliases preserve a superseded 'venv' vocabulary alongside the 'runtime' vocabulary, a live legacy path.
- **Recommendation:** Delete AxiosLikeClient/apiClient and migrate usePipelineExecution.ts's 4 calls to `api.post<T>()` (drop `.data`). Replace getVenvStatus→getRuntimeStatus and VenvStatus→RuntimeStatus at the one consumer (useUpdates.ts) and delete the aliases; remove createVenv if the desktop-managed-runtime flow is gone, or rename it to the current vocabulary if still wired.

</details>

<details><summary><code>CLIENT-02</code> 🟡 <b>Raw-fetch error-handling block duplicated three times with divergent behavior</b> <i>(Duplication, M/med)</i></summary>

- **Location:** `src/api/client.ts:320-342 (request), 391-420 (postMsgpack), 463-469 (requestBinary), 813-818 (previewDatasetWithUploads)`
- **Evidence:** The block `const errorData = await response.json().catch(() => ({})); ... formatApiErrorDetail(errorData.detail ?? errorData, response.status)` appears 3x (lines 323, 394, 465), and the catch `{ detail: error instanceof Error ? error.message : 'Network error', status: 0 }` appears 2x (lines 338-341, 416-419). previewDatasetWithUploads (805-818) instead does `const error = await response.json()` with no `.catch` and throws a plain `new Error(error.detail ...)`, an inconsistent error shape vs the ApiError used everywhere else. requestBinary (451-470) and previewDatasetWithUploads (789-819) bypass fetchWithRetry entirely, so they get no Electron transient-network retry.
- **Impact:** Error parsing/shape drifts between paths; the upload path can throw on a non-JSON 500 (unhandled) and produces a non-ApiError that breaks isApiError consumers; binary/upload requests silently lose the Electron retry behavior.
- **Recommendation:** Extract a single `parseError(response): Promise<ApiError>` and `toApiError(error): ApiError` helper and route request, postMsgpack, requestBinary, and previewDatasetWithUploads through fetchWithRetry + these helpers so all four share one error contract and the retry logic.

</details>

<details><summary><code>CLIENT-03</code> 🟡 <b>Dead exported functions/types — never imported anywhere in src/</b> <i>(Dead code, S/low)</i></summary>

- **Location:** `src/api/client.ts:473 (checkHealth), 663 (listGroups), 2245 (VenvInfo), 2335 (getWebappDownloadInfo), 2351 (downloadWebappUpdate), 860 (refreshDatasetVersion)`
- **Evidence:** grep across src/ (excluding client.ts and the test file) returns 0 importers for: checkHealth (line 473), downloadWebappUpdate (2351), getWebappDownloadInfo (2335), VenvInfo (`export type VenvInfo = RuntimeInfo`, 2245), listGroups (663). listGroups is an exact duplicate of getGroups (both `api.get("/workspace/groups")`, lines 550 vs 664) — getGroups is the live one (BatchScanDialog.tsx:123). refreshDatasetVersion (860, POST `/datasets/{id}/refresh`) has 0 importers and duplicates the live refreshDataset (543, same POST endpoint, used in Datasets.tsx:462,893).
- **Impact:** Dead wrappers and a duplicate group/refresh endpoint inflate the surface, mislead readers about which call is canonical, and ship unused code to v1.
- **Recommendation:** Delete checkHealth, downloadWebappUpdate, getWebappDownloadInfo, VenvInfo, listGroups, and refreshDatasetVersion. Confirm health checks go through performHealthCheck (1692) which already hits '/health' directly.

</details>

<details><summary><code>CLIENT-05</code> 🟡 <b>No request cancellation or caching primitive across read endpoints</b> <i>(Performance, M/low)</i></summary>

- **Location:** `src/api/client.ts:302-371 (request/get/post), 451-470 (requestBinary), 777-819 (previewDatasetWithUploads)`
- **Evidence:** RequestOptions extends RequestInit so `signal` could be forwarded, but no exported function in client.ts exposes or passes an AbortSignal (grep `signal` in client.ts = 2 hits, both unrelated substrings inside type bodies). Cancellation only exists in the separate src/api/playground.ts (which passes `{ signal }` to postMsgpack). requestBinary (451) and previewDatasetWithUploads (805) build their own `fetch` with no signal at all. There is no response cache: every getWorkspace/listDatasets/getSystemInfo call re-hits the network.
- **Impact:** Long-running reads (preview, scatter, results-summary, binary parquet export) cannot be cancelled on unmount/navigation, causing wasted backend work and races where a stale response overwrites fresh UI state; repeated identical GETs add latency.
- **Recommendation:** Thread an optional `signal` through requestBinary and previewDatasetWithUploads (route them through fetchWithRetry per CLIENT-02 so signal+retry are uniform), and standardize on passing AbortSignal from the calling hooks. Caching belongs in the data layer (e.g. React Query keys per domain module) rather than in the client — do not add a bespoke cache here.
- **Depends on:** CLIENT-02

</details>

<details><summary><code>CLIENT-06</code> ⚪ <b>Large response shapes inlined as anonymous return types instead of named interfaces</b> <i>(Antipattern, S/low)</i></summary>

- **Location:** `src/api/client.ts:719-736 (autoDetectFile), 918-940 (detectDatasetTargets), 1863-1906 (getN4AWorkspaceResults), 1934-1953 (getN4AWorkspaceDiscoveredDatasets), 2303-2314 (createVenv), 2335-2346 (getWebappDownloadInfo)`
- **Evidence:** Several functions declare their entire response object inline in the Promise<...> position, e.g. getN4AWorkspaceResults (1872-1897) inlines a ~25-field object including a nested `results: Array<{...}>`; getN4AWorkspaceDiscoveredDatasets (1936-1951) inlines a `datasets: Array<{ ...; status: 'valid'|'missing'|... }>`; autoDetectFile (722-734) and detectDatasetTargets (921-937) inline multi-field shapes. These response types are not exported and so cannot be reused by consuming components, which then re-declare or use loose types.
- **Impact:** Inlined shapes can't be shared with callers/tests, encourage drift between client and UI, and bloat the function signatures; minor but compounds the readability cost of the god module.
- **Recommendation:** During the CLIENT-01 split, promote these inline return shapes to exported interfaces in the relevant domain module (or @/types/*), matching the pattern already used for most endpoints (e.g. WorkspaceStatsResponse, PreviewDataResponse).
- **Depends on:** CLIENT-01

</details>


### 5.15 Packaging & build-config duplication (PyInstaller specs, electron-builder configs, requirements files, build/CI scripts)

*Reviewed: backend.spec (260), nirs4all-webapp.spec (353), electron-builder.yml (126), electron-builder.installer.yml (126), electron-builder.archive.yml (74), requirements.txt (27), requirements-cpu.txt (24), requirements-gpu.txt (23), requirements-gpu-macos.txt (12), requirements-test.txt (12), scripts/build-backend.cjs (110-165), scripts/build-release.cjs (refs), scripts/build-archive-standalone.cjs (refs), scripts/bake-standalone-backend.cjs (refs), scripts/setup-python-env.cjs (600-680), scripts/python-runtime-config.cjs (18-62), .github/workflows/release-unified.yml (build refs), .github/workflows/ci.yml (requirements refs), package.json (scripts), main.py (22-55), api/playground.py (37)*

Studio carries two parallel packaging stacks but ships only one. The live Electron path is build-release.cjs -> build-backend.cjs -> backend.spec (entry main.py) for installers, and build-archive-standalone.cjs -> bake-standalone-backend.cjs -> setup-python-env.cjs (pins from python-runtime-config.cjs) for all-in-one archives. A second, fully dead pywebview path (scripts/build.py -> nirs4all-webapp.spec -> launcher.py) is referenced by nothing in package.json or .github/workflows and was last meaningfully touched in Feb 2026; its docstring even mis-claims it is built by CI. The most dangerous debt is pin drift: the backend's runtime imports are spread across THREE independently hand-maintained dependency lists (requirements*.txt, python-runtime-config.cjs BACKEND_COMMON_PACKAGES, backend.spec hiddenimports) that disagree — msgpack is imported unconditionally at api/playground.py:37 yet is absent from requirements-cpu.txt, from python-runtime-config.cjs, AND from backend.spec hiddenimports, so a CPU release build can ship a backend that cannot import the playground router. electron-builder.yml and electron-builder.installer.yml are byte-identical (differ only in two comment lines), and orphaned .sh/.ps1 mirrors of the .cjs build scripts (build-release.sh, build-backend.sh, pre-publish.*) duplicate the live JS logic. Root cause: the codebase migrated from pywebview+Python-driven builds to Electron+Node-driven builds without deleting the old generation, and never unified backend dependency declaration into a single source of truth.

| ID | Sev | Cat | Title | Effort/Risk |
|---|---|---|---|---|
| `PKG-02` | 🟠 | Duplication | Backend runtime dependencies declared in three divergent, hand-maintained sources | M/med |
| `PKG-03` ⤿ | 🟠 | Dead code | Dead pywebview build path: scripts/build.py + nirs4all-webapp.spec + launcher.py (803 LOC) referenced by nothing live | S/low |
| `PKG-01` | 🟡 | Bug | msgpack optional dependency missing from CPU/package dependency sources (silent degradation, packaging drift) | S/low |
| `PKG-04` | 🟡 | Duplication | electron-builder.yml and electron-builder.installer.yml are byte-identical duplicates (one is unused) | S/low |
| `PKG-05` | 🟡 | Dead code | Orphaned shell/PowerShell mirrors of the live Node build scripts (build-release.sh, build-backend.sh, pre-publish.*) | M/med |
| `PKG-06` | ⚪ | Duplication | backend.spec and nirs4all-webapp.spec duplicate a 30+ line API-module hiddenimports list that must be hand-maintained on router changes | S/low |

<details><summary><code>PKG-02</code> 🟠 <b>Backend runtime dependencies declared in three divergent, hand-maintained sources</b> <i>(Duplication, M/med)</i></summary>

- **Location:** `requirements.txt:1-27; requirements-cpu.txt:1-24; scripts/python-runtime-config.cjs:21-31; backend.spec:78-162`
- **Evidence:** Three independent backend dep lists exist and disagree. (1) requirements.txt has fastapi/uvicorn/pydantic/orjson/msgpack/python-multipart/httpx/pyyaml/packaging/platformdirs/sentry-sdk + pyinstaller. (2) requirements-cpu.txt (used by the live PyInstaller build via build-backend.cjs:130) drops orjson, msgpack AND sentry-sdk — `comm` diff: IN-MAIN-NOT-CPU = msgpack, orjson, sentry-sdk. (3) python-runtime-config.cjs BACKEND_COMMON_PACKAGES (used by the live standalone-archive build) has sentry-sdk + pyyaml but lacks orjson and msgpack. The pins also share copy-paste version strings (fastapi>=0.115.0, uvicorn[standard]>=0.34.0, pydantic>=2.10.0, httpx>=0.27.0, packaging>=24.0, platformdirs>=4.0.0) that must be edited in lockstep across all three files.
- **Impact:** Any backend dependency change must be applied in three places by hand or the artifact silently differs from dev. This is the root cause of PKG-01 and a recurring correctness/maintenance hazard: orjson and sentry import-guards in main.py:25-31,46-50 currently mask the drift, but msgpack does not, and the next un-guarded import will ship broken again.
- **Recommendation:** Pick one source of truth for backend runtime pins. Recommended: make python-runtime-config.cjs BACKEND_COMMON_PACKAGES canonical (it already feeds the standalone build and is profile-aware) and generate requirements-cpu.txt from it (or have build-backend.cjs install from the shared config instead of a static requirements file). Delete requirements.txt as a separate hand-list; keep only the generated/derived files. Ensure backend.spec hiddenimports is reconciled (orjson, msgpack, sentry_sdk, yaml all present).

</details>

<details><summary><code>PKG-03</code> 🟠 <b>Dead pywebview build path: scripts/build.py + nirs4all-webapp.spec + launcher.py (803 LOC) referenced by nothing live</b> <i>(Dead code, S/low)</i> · **⤿ merged**</summary>

- **Location:** `scripts/build.py:1-387; nirs4all-webapp.spec:1-353; launcher.py:1-63`
- **Evidence:** nirs4all-webapp.spec is referenced ONLY by scripts/build.py:156 (`spec_file = project_dir / 'nirs4all-webapp.spec'`). scripts/build.py is referenced by nothing: grep across .github/, all scripts/*.cjs/.sh/.cmd/.ps1, and package.json found zero invocations. launcher.py is the spec's entry (launcher.py:7 docstring: 'referenced by nirs4all-webapp.spec (line 228) and built by the release/pre-release CI workflows') but that claim is false — release-unified.yml builds via build-backend.cjs/backend.spec (main.py entry) and build-archive-standalone.cjs only. nirs4all-webapp.spec is pywebview-based (entry launcher.py, COLLECT+BUNDLE, hiddenimports 'webview', gi.repository.WebKit2 etc.) whereas the live backend.spec is Electron-based (entry main.py, one-file EXE, console=True). launcher.py and main.py both detect pywebview but the live Electron path never spawns pywebview. Last meaningful edits: build.py 2026-02-24, nirs4all-webapp.spec/launcher.py 2026-02-25; live backend.spec touched 2026-06-05.
- **Impact:** 803 LOC of a second, obsolete packaging stack plus a misleading 'built by CI' docstring. Maintainers reading launcher.py/nirs4all-webapp.spec will believe pywebview is a supported target and may keep its pin/import lists in sync (wasted effort) or break the real Electron build by editing the wrong file. Pre-v1, there is no compat reason to keep it.
- **Recommendation:** Delete scripts/build.py, nirs4all-webapp.spec, and launcher.py. Remove the residual pywebview detection paths in main.py (line 66 'skip middleware when running in pywebview') if pywebview is no longer a target. Keep only backend.spec.

</details>

<details><summary><code>PKG-01</code> 🟡 <b>msgpack optional dependency missing from CPU/package dependency sources (silent degradation, packaging drift)</b> <i>(Bug, S/low)</i></summary>

- **Location:** `api/playground.py:37; requirements-cpu.txt:1-19; scripts/python-runtime-config.cjs:21-31; backend.spec:78-162`
- **Evidence:** api/playground.py:36-40 wraps `import msgpack` in try/except ImportError and sets MSGPACK_AVAILABLE=False; msgpack.packb is only called when available (playground.py:1799). msgpack is pinned in requirements.txt:8 but absent from requirements-cpu.txt, requirements-gpu*.txt, scripts/python-runtime-config.cjs and backend.spec hiddenimports. [Corrected after Codex review: the original claim that a CPU build cannot import the playground router was WRONG — the import is guarded.]
- **Impact:** CPU/packaged builds silently ship without MessagePack support: every playground response that requests `Accept: application/x-msgpack` falls back to JSON (larger payloads, slower playground). More importantly it is concrete proof that the three hand-maintained dependency sources (requirements*, python-runtime-config.cjs, backend.spec) have already drifted (PKG-02).
- **Recommendation:** Add msgpack to the packaged dependency sources — but fix the root cause via PKG-02: one source of truth that requirements files, python-runtime-config.cjs and backend.spec are generated from or validated against in CI.
- **Depends on:** PKG-02

</details>

<details><summary><code>PKG-04</code> 🟡 <b>electron-builder.yml and electron-builder.installer.yml are byte-identical duplicates (one is unused)</b> <i>(Duplication, S/low)</i></summary>

- **Location:** `electron-builder.yml:1-126; electron-builder.installer.yml:1-126`
- **Evidence:** `diff electron-builder.yml electron-builder.installer.yml` reports 'Files are identical' (the only real difference is comment lines 17-18: yml says 'Compatibility default: installer packaging remains the implicit electron-builder config', installer.yml says 'Installer builds ship backend source only'). The live release path uses ONLY the .installer.yml: build-release.cjs:225 `electron-builder --config electron-builder.installer.yml`, build-release.sh:171 likewise, and release-unified.yml runs `electron-builder --config electron-builder.installer.yml` for all 4 OS jobs. The default electron-builder.yml is referenced only by scripts/build-test.cjs:166, which iterates all three configs for a validation test, not a build.
- **Impact:** Two identical 126-line YAMLs must be edited in lockstep; the comment on electron-builder.yml asserting it is the 'implicit default' is misleading since no build path uses the implicit (unflagged) config. Divergence between them (someone edits one) would silently affect nothing or, worse, the wrong one.
- **Recommendation:** Delete electron-builder.yml; keep electron-builder.installer.yml (the one CI/release actually pass via --config) and electron-builder.archive.yml (used by build-archive-standalone.cjs:122). Update build-test.cjs:166 to iterate the two surviving configs.

</details>

<details><summary><code>PKG-05</code> 🟡 <b>Orphaned shell/PowerShell mirrors of the live Node build scripts (build-release.sh, build-backend.sh, pre-publish.*)</b> <i>(Dead code, M/med)</i></summary>

- **Location:** `scripts/build-release.sh:1-198; scripts/build-backend.sh:1-137; scripts/pre-publish.sh:1-325; scripts/pre-publish.cmd:1-41; scripts/pre-publish.ps1:1-350`
- **Evidence:** package.json release scripts invoke only the .cjs versions (release -> build-release.cjs, release:all-in-one -> build-archive-standalone.cjs). release-unified.yml and ci.yml never call build-release.sh, build-backend.sh, or any pre-publish.*. Repo-wide grep (excluding .venv/site/node_modules) found build-release.sh referenced only in docs/ELECTRON.md:432-435 (stale doc), build-backend.sh referenced nowhere outside itself, and pre-publish.* referenced only in CHANGELOG.md:26 / docs changelog (historical note). build-backend.sh:103/108 duplicates build-backend.cjs:135-143 logic (same requirements-${flavor}.txt selection, same `pyinstaller backend.spec --noconfirm`, same NIRS4ALL_BUILD_FLAVOR env), so the two can drift (e.g. only one gets a new flavor or pin fix).
- **Impact:** ~1050 LOC of parallel build logic that nothing runs but that re-encodes the same flavor/requirements/PyInstaller decisions as the live .cjs scripts. A fix applied to build-backend.cjs (e.g. PKG-01's msgpack) will not reach build-backend.sh, and a contributor following docs/ELECTRON.md will run the stale .sh path.
- **Recommendation:** Delete build-release.sh, build-backend.sh, and the pre-publish.{sh,cmd,ps1} trio unless one is the documented local-release entry point — confirm with the maintainer; if a local-release helper is wanted, keep exactly one and have it shell out to the .cjs scripts rather than re-implementing them. Update docs/ELECTRON.md:432-435 to reference `npm run release`.

</details>

<details><summary><code>PKG-06</code> ⚪ <b>backend.spec and nirs4all-webapp.spec duplicate a 30+ line API-module hiddenimports list that must be hand-maintained on router changes</b> <i>(Duplication, S/low)</i></summary>

- **Location:** `backend.spec:104-146; nirs4all-webapp.spec:108-153`
- **Evidence:** Both specs hard-code the identical explicit list of api.* router modules (api.aggregated_predictions, api.analysis, api.automl, api.datasets, ... api.workspace, api.workspace_manager, api.jobs, api.jobs.manager, api.shared.* ). This list must be edited whenever a router is added/removed, in two files. The list is already stale-prone: e.g. main.py imports api.network_state (router) and api.shared.sentry / api.telemetry, none of which appear in either spec's hiddenimports.
- **Impact:** Adding a router and forgetting to update the spec yields a router silently missing from the frozen build (only reproduces in release, not dev). The duplication doubles the maintenance and the chance of drift. (Mostly subsumed once PKG-03 deletes nirs4all-webapp.spec, leaving one copy.)
- **Recommendation:** After deleting nirs4all-webapp.spec (PKG-03), replace the hand list in backend.spec with PyInstaller's collect_submodules('api') (and collect_submodules for websocket/updater) so new routers are picked up automatically and the hand-maintained module roster disappears.
- **Depends on:** PKG-03

</details>


---

## 6. Merged / overlapping findings

These findings describe the same underlying debt as a canonical finding in another area. They are kept for traceability but counted once in the roadmap:

| Merged ID | Title | Theme it belongs to |
|---|---|---|
| `BV-01` | Dead legacy pipeline-build path: build_full_pipeline / build_full_step / generator builders | Half-landed V1->V2 / canonical migrations left a dead twin of everything |
| `BV-02` | Dead native-format pipeline builder: build_native_pipeline + _build_native_step + native helpers | Half-landed V1->V2 / canonical migrations left a dead twin of everything |
| `BV-03` | Dead YAML import/export pipeline serializers | Half-landed V1->V2 / canonical migrations left a dead twin of everything |
| `BV-08` | store_adapter.py is a 2396-LOC god module mixing SQL, ranking, and ML-structure inference | Router-never-delegated god-classes |
| `BL-04` | Dead SchemaMigrator class (v1->v2 manifest migration, 'Phase 4: Backward Compatibility') | Half-landed V1->V2 / canonical migrations left a dead twin of everything |
| `PKG-03` | Dead pywebview build path: scripts/build.py + nirs4all-webapp.spec + launcher.py (803 LOC) referenced by nothing live | Eager dead/legacy code and orphaned build/packaging stacks |
| `BLD-03` | electron-builder.yml is a byte-identical duplicate of electron-builder.installer.yml | Eager dead/legacy code and orphaned build/packaging stacks |
| `DS-03` | na_policy legacy normalization shim should be removable once stored configs are migrated | — |
| `AGG-04` | Deprecated aliases for renamed chain-summary types/methods kept as compat shims | — |
| `VIZ-07` | chartConfig.ts ships a block of @deprecated color helpers whose live callers are gone | — |

---

## 7. Method & caveats

- **How:** 16 parallel auditors, each scoped to one area, read the target files in full and cross-checked with the codegraph index (callers/callees), `grep`, and `ruff`. An architect pass deduplicated and synthesized. Every finding cites concrete `file:line` evidence; none are speculative.
- **Confidence:** dead-code claims were verified with codegraph caller traces *and* repo-wide grep. Boundary-violation claims compare what the backend imports from `nirs4all` against what it hand-rolls. Where a fix needs a change in the sibling `nirs4all` library (§3 T1), this is called out explicitly.
- **Not covered:** runtime profiling (perf findings are static/structural, not measured), security audit (separate concern), and the sibling `nirs4all`/`nirs4all-io` libraries themselves (only the studio boundary to them).
- **Next:** see `CODEX_REVIEW.md` for the independent review and `ROADMAP.md` for the parallel-agent remediation plan.
