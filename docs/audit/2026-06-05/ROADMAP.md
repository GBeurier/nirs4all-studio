# nirs4all-studio — Tech-Debt Remediation Roadmap (multi-agent)

> **Date:** 2026-06-05 · **Baseline:** `main` @ `eba503f` (v0.6.3) · **Inputs:** `AUDIT_TECHNIQUE.md` (139 findings), `CODEX_REVIEW.md` (independent verification) · **Goal:** resorb the audited debt before v1 — delete all legacy/compat/dead code, fix the verified bugs, break the god classes, and make loading & usage fluid.

This roadmap is written **for execution by multiple parallel agents**. Tasks are grouped into **waves**: every task inside a wave can run concurrently because no two tasks own the same file; waves are sequenced only where a real dependency exists (Codex correction: the nirs4all boundary contract blocks *only* the chain-summary/inspector/aggregated-predictions work — everything else is independent).

---

## 1. Ground rules (every agent, every task)

1. **Branch per task**, named `techdebt/<task-id>-<slug>` (e.g. `techdebt/T0.1-pipeline-converter-bugs`), cut from latest `main`. One PR per task. Use a separate git worktree per agent when running concurrently.
2. **File ownership is exclusive within a wave.** A task may only edit the files listed in its card (plus its own tests). If you discover a needed edit in a file owned by another task, leave a TODO note in the PR description instead — do not edit it.
3. **Pre-v1 deletion policy:** no deprecation warnings, no compat shims, no re-export stubs, no "keep just in case". Deleted means deleted (git history is the archive). Tests that exist only to pin dead code are deleted with it.
4. **Boundary rule:** if a fix needs NIRS/data/ML logic, it must call `nirs4all` — never re-implement. If `nirs4all` lacks the capability, **stop and flag it** (it almost always exists); library-side changes are coordinated through task T2.1 only.
5. **Green gate before merge** (from repo root, backend python = `../nirs4all/.venv/bin/python`):
   ```bash
   npm run lint:parallel     # eslint + tsc + validate-node-registry + ruff + py-syntax
   npm run test:parallel     # vitest + pytest (tests/, -n auto)
   ```
   Record the **baseline failures on `main`** once, before Wave 0 (task T0.0); a PR may not add a single new failure.
6. **Behavior-preserving by default.** Except for the bug-fix tasks (T0.1, T0.3, T1.4) and explicit deletions, refactors must not change endpoint contracts or UI behavior. When splitting a module, re-export from the original import path is **not** allowed — update all call sites (rule 3).
7. **Report honestly.** Every PR description lists: findings addressed (IDs), LOC deleted/moved, gate output, and anything discovered out of scope.

---

## 2. Hot-file collision map (single owner per wave)

These files are touched by many findings. They have **one owner per wave**; no other task may edit them in that wave (Codex flagged this as the main parallelization risk):

| File | Findings touching it | Owner sequence |
|---|---|---|
| `src/utils/pipelineConverter.ts` | PCV-02/03/04/05/06/08 | W0: T0.1 (bugs) → W1: T1.3 (dead twin deletion) → W3: T3.8 (model/boundary refactor) |
| `api/store_adapter.py` | BV-06/07/08, WS-03/05/08/10, BL-07 | W1: T1.1 (dead methods) → W2: T2.1 (boundary) → W3: T3.10 (split+perf) |
| `api/runs.py` | RUN-01..07, BL-12, RUN-04 | W1: T1.4 owns *everything* runs.py (incl. its bugs & dead code) |
| `api/workspace.py` | WS-01/04/06/07, +caches | W2: T2.1 (only lines 414–503, dataset-metadata boundary) → W3: T3.1 (split + async offload as ONE task, per Codex) |
| `api/nirs4all_adapter.py` | BV-01/02/03/04/05/09/10, BL-01/02/03/10 | W1: T1.2 (purge ~1,500 dead LOC) → W2: T2.2 (resolver unification) |
| `api/playground.py` | PG-01..08, PERF-02, PKG-01 | W0: T0.2 (no code edit, packaging only) → W1: T1.1 (dead endpoints) → W3: T3.2 (split+perf) |
| `src/api/client.ts` | CLIENT-01..06 | W1: T1.3 (dead exports only) → W3: T3.6 (transport + domain split) |
| `api/inspector.py` | INS-01..05, BL-05 | W1: T1.6 (sanitize import swap) → W3: T3.3 (boundary + perf) |
| `api/aggregated_predictions.py` | AGG-01..04, PERF-06, BL-05 | W0: T0.3 (AGG-02 one-line bug) → W2: T2.1 (dedup vs store_adapter) |

---

## 3. Dependency graph

```
W0  T0.0 baseline ─┐
    T0.1 converter bugs (CRITICAL PCV-03)      ─┐
    T0.2 packaging single-source                │  all parallel
    T0.3 quick bug fixes                        │
    T0.4 build clutter deletion                ─┘
W1  T1.1 backend dead-code sweep   ─┐
    T1.2 nirs4all_adapter purge     │
    T1.3 frontend dead-code+renames │  all parallel; T1.6 runs LAST in the wave
    T1.4 runs.py → JobManager       │  (it touches many files others edit)
    T1.5 electron lifecycle         │
    T1.6 sanitize util + F401 sweep─┘
W2  T2.1 nirs4all boundary contract  ←— the only cross-repo task (KEYSTONE)
    T2.2 operator-resolver unification   (parallel with T2.1; needs T1.2 done)
    T2.3 datasets boundary & dedup       (parallel)
W3  T3.1 workspace split+offload | T3.2 playground | T3.3 inspector (needs T2.1)
    T3.4 updates | T3.5 cold-start+spectra perf | T3.6 client.ts split
    T3.7 charts perf | T3.8 editor model | T3.9 env-manager | T3.10 store_adapter split (needs T2.1)
W4  T4.1 final verification & debt-zero check
```

---

## 4. Wave 0 — Correctness & hygiene (parallel, ~4 agents, ≈3 agent-days)

### T0.0 — Record the baseline *(S, do first, 30 min)*
Run `npm run lint:parallel` and `npm run test:parallel` on `main`; commit the raw output to `docs/audit/2026-06-05/BASELINE.md`. Every later PR is judged against this.

### T0.1 — Fix the pipeline-converter data-loss bugs 🔴 *(M, risk med)* — `PCV-03` (critical), `PCV-04`, `PCV-05`
**Files:** `src/utils/pipelineConverter.ts`, `src/components/pipeline-editor/config/step-renderers/GeneratorRenderer.tsx`, `src/components/pipeline-editor/types.ts` (creation path only), tests.
- Make `scalarGeneratorConfig` the single source of truth for scalar generators in **both** directions: export must read it (grid/zip) and emit a `_sample_` branch (today it falls through to `{_or_: []}` — `pipelineConverter.ts:2714`); import (`:1926`, `:1993`) must populate it so imported scalar generators stop rendering empty.
- `PCV-04`: stop leaking editor-internal `merge_type` into the canonical payload (`:2273-2285`).
- `PCV-05`: honor inline `y_processing` params on import (`:1485-1507`).
- **Acceptance:** new round-trip tests (editor → nirs4all JSON → editor) for grid/zip/sample scalar generators, merge steps, and y_processing; all pass; no payload diff for non-generator pipelines on a corpus of existing saved pipelines.

### T0.2 — Packaging: one source of truth for backend deps *(S–M)* — `PKG-01`, `PKG-02`, `PKG-06`
**Files:** `requirements*.txt`, `scripts/python-runtime-config.cjs`, `backend.spec`, CI config, **no `.py` edits**.
- Add `msgpack` to the packaged sources (CPU builds currently silently lose MessagePack — Codex-verified guarded import, *not* a crash).
- Pick one canonical dependency list and make the other two generated from it or CI-validated against it (a `scripts/check-dep-sync.{cjs,py}` that fails on drift is enough).
- **Acceptance:** drift checker runs in CI/green gate and passes; a deliberately removed pin makes it fail.

### T0.3 — Quick verified bug fixes *(S)* — `FE-01-state`, `AGG-02`
**Files:** `src/context/SelectionContext.tsx` (keydown handler only), `api/aggregated_predictions.py:523`.
- Fix the competing global keydown handlers that clobber playground undo (Ctrl+Z) — scope or coordinate the two listeners.
- Fix the operator-precedence bug in `_normalize_chain_payload` that skips normalization of nested class/function payloads.
- **Acceptance:** regression test for each (vitest for the keydown routing; pytest for the normalization).

### T0.4 — Delete the dead build/packaging generation *(M)* — `PKG-03`, `PKG-04`, `PKG-05`, `BLD-01`–`BLD-08` (incl. merged `BLD-03`)
**Files:** `scripts/build.py`, `nirs4all-webapp.spec`, `launcher.py`, `electron-builder.yml`, `scripts/build-release.sh` & PowerShell mirrors, `.storybook/` + stories + eslint plugin, `package.json` (dead deps `encoding`, `@tailwindcss/typography`; `@types/three` → devDeps; redundant script aliases; fix or drop Windows-only `ci:local*`; drop `lint:py-syntax` if ruff covers it), empty `.mcp.json`.
- The pywebview stack (`build.py` + `nirs4all-webapp.spec` + `launcher.py`, ~803 LOC) is a dead packaging generation — delete it whole.
- `electron-builder.yml` is byte-identical to `electron-builder.installer.yml` — keep one, fix references.
- **Acceptance:** `npm run build` + `npm run build:electron` still succeed; a desktop package builds from the remaining config; green gate passes.

---

## 5. Wave 1 — Deletion sweep & isolated consolidations (parallel, ~6 agents, ≈12 agent-days)

> Pure subtraction plus two self-contained consolidations. Everything here was **verified dead or duplicated** (codegraph + grep + Codex spot-checks). T1.6 starts only after T1.1–T1.5 merge (it sweeps files they touch).

### T1.1 — Backend dead-code & legacy purge *(L, risk low)* — `WS-02`(+`BL-04`), `WS-03`, `PG-02`, `PG-03`, `PRED-01`, `UPD-02`, `INS-03`, `BL-07`, `BL-08`, `BL-09`, `RUN-04`→note, `BL-11`/`DS-03`→note
**Files:** `api/workspace_manager.py`, `api/store_adapter.py` (dead methods/aliases only), `api/playground.py` (dead `/metrics` family + dead imports only), `api/predictions.py`, `api/updates.py` (no-op legacy proxies only), `api/inspector.py` (dead helpers only), `api/shared/filter_operators.py:515-526`, `api/venv_manager.py`. **Not** `api/runs.py` (T1.4) and **not** `api/nirs4all_adapter.py` (T1.2).
- Delete `DatasetRegistry`, `SchemaMigrator`, `RunManager` (~700 LOC, zero callers), the dead `/metrics` endpoint family, the dead+boundary-violating `predictions.py` single/confidence/explain endpoints, dead store-adapter methods & `# Deprecated alias` lines (update the tests that pin them), dead venv/create + legacy download endpoints, dead compat exports.
- `BL-11`/`DS-03` (live na_policy/filter-name normalization shims): write a one-shot migration for stored workspace configs, then delete the shims; if migration is too invasive now, document the blocker in the PR — do not silently keep.
- **Acceptance:** green gate; grep proves zero remaining references to every deleted symbol; LOC report in PR (expect ≥1,500 LOC removed).

### T1.2 — `nirs4all_adapter.py` dead-builder purge *(M, risk low)* — `BV-01`(+`BL-01`), `BV-02`(+`BL-02`), `BV-03`(+`BL-03`), `BV-10`, `BL-10`
**Files:** `api/nirs4all_adapter.py`, `api/training.py` (unused import), their tests.
- Delete the dead legacy pipeline builder (`build_full_pipeline` + helper subtree), the dead native-format builder (`build_native_pipeline` + `_build_native_step` + helpers), dead YAML import/export, dead `extract_metrics_from_prediction`, the no-op MinMaxScaler compat branch. (~1,500 LOC; only test callers exist — Codex-verified.)
- **Acceptance:** green gate; the file shrinks to the canonical-conversion + execution surface only; zero references remain.

### T1.3 — Frontend dead-code purge & migration renames *(L, risk low-med)* — `PCV-01`(+`PCV-02`), `CLIENT-03`, `FE-01-reg`…`FE-05-reg`, `FE-02-state`, `FE-03-state`, `FE-11-state`, `VIZ-06`, `VIZ-07`, `VIZ-08`, `FE-06-reg` callers
**Files:** `src/utils/nativePipelineFormat.ts` (delete), `src/api/client.ts` (dead exports only), `src/components/pipeline-editor/contexts/NodeRegistryContext*.tsx`, `src/components/playground/visualizations/` (V2 renames, chartConfig deprecated helpers, FoldDistribution dead branches), `src/context/SelectionContext.tsx` (dead selector-store/Hover machinery only — the keydown fix from T0.1/T0.3 is already merged), `src/pages/PipelineEditor.tsx` (dead render block), `src/context/InspectorColorContext.tsx`, `src/vite-env.d.ts`.
- Delete `nativePipelineFormat.ts` (1,695-LOC dead twin converter — only its own test imports it) and its test.
- Finish the node-registry migration: delete the 9-line shim, rename `.v2.tsx` → canonical, delete the always-true `USE_NODE_REGISTRY` flag + dead Phase-1 branch + `isJsonRegistry` plumbing (incl. the constant branches in `stepMetadata.ts`).
- Drop the vestigial `V2` suffixes (SpectraChartV2/FoldDistributionChartV2/YHistogramV2 — no V1 exists) and the `YHistogramV2` re-export shim; update `MainCanvas`, barrels, tests, `performanceBaselines.ts` keys.
- Delete the six zero-importer `@deprecated` chartConfig helpers; migrate the three live-importer deprecated constants to `colorConfig.ts` and delete (`FE-06-reg`).
- **Acceptance:** green gate; `grep -ri "v2\|deprecated" src/components/playground/visualizations src/components/pipeline-editor/contexts` returns only legitimate hits; LOC report (expect ≥2,500 LOC removed).

### T1.4 — Unify run execution on JobManager (single owner of `api/runs.py`) *(L–XL, risk high)* — `RUN-01`, `RUN-02`, `RUN-03`, `RUN-04`, `RUN-05`, `RUN-06`, `RUN-07`, `BL-12`
**Files:** `api/runs.py`, `api/jobs/manager.py`, `api/pipelines.py` + `api/training.py` (their run-wrapper paths only — coordinate: T1.1 does not touch these functions), tests.
- Replace the bespoke ThreadPoolExecutor/queue/regex-log-scraping engine with `JobManager`; collapse the three divergent `nirs4all.run()` wrappers into one with consistent metric extraction (kills the `rmse=999` sentinel, `RUN-06`).
- `RUN-07` (Codex finding): make stop real — thread cancellation into the execution layer (nirs4all session/callback; if the library lacks a cancel hook, flag to T2.1), forbid a cancelled run from overwriting terminal status, and remove the cosmetic pause control (or implement it for real).
- Replace regex log-scraping with structured progress callbacks; delete `_create_mock_run`, the legacy double-nested `workspace/workspace/runs` scan.
- **Acceptance:** integration test: launch → progress → completes with correct metrics; launch → stop → worker actually exits, status stays terminal, no further store writes; green gate.

### T1.5 — Electron lifecycle & spawn cleanup *(M–L, risk med)* — `BM-01`–`BM-04`, `ENV-02`, `ENV-03`, `ENV-04`, `ENV-06`
**Files:** `electron/backend-manager.ts`, `electron/env-manager.ts` (dead methods, legacy migration branch, copy-pasted helpers only — the god split is T3.9), their tests.
- De-duplicate the ~80-line spawn path (`startInternal` vs `startInternalNonBlocking`); await the orphan/timeout kill path (zombie race, `BM-03`); stop `pollMlReadiness` after window/backend teardown (`BM-02`); collapse the redundant launch-mode env vars; delete `getRuntimeMode`/`validatePortableState` and the `customPythonPath` legacy migration; unify the envRoot helper and the network-probe list with the backend's.
- **Acceptance:** existing electron vitest suites green; manual check: `npm run dev:electron` start/stop/restart leaves zero orphan python processes (`ps` before/after).

### T1.6 — Shared sanitize util + unused-import sweep *(S–M, risk low — runs LAST in wave)* — `BL-05`, `BL-06`
**Files:** new `api/shared/json_safe.py`; the 5 `_sanitize_float`/3 `_sanitize_dict` definition sites; repo-wide F401 removal.
- Extract the byte-identical sanitize helpers into one module; replace all definitions with imports. Then `ruff check --select F401 --fix` the whole backend (166 hits at audit time) and clean remaining by hand.
- **Acceptance:** `ruff check api/ --select F401` = 0 errors; green gate.

---

## 6. Wave 2 — Boundary contract & unification (≈3 agents, ≈15 agent-days)

> T2.1 is the **keystone and the only cross-repo task**. Per Codex: it blocks *only* T3.3 (inspector) and T3.10 (store_adapter split) — T2.2/T2.3 and all of Wave 3's frontend work proceed in parallel.

### T2.1 — nirs4all chain-summary/refit contract; delete backend reverse-engineering *(XL, risk high)* — `WS-06`, `BV-06`, `BV-07`, `AGG-01`, `AGG-03`, `AGG-04`, `PERF-06`
**Files:** `api/store_adapter.py`, `api/aggregated_predictions.py`, `api/workspace.py:414-503` (dataset-metadata block only); **plus a coordinated change in `../nirs4all`** (workspace store query/view).
- Today the backend reverse-engineers CV/refit-chain pairing, synthesizes refit scores, and re-parses splitter class paths (`store_adapter.py:413-572`, `:170-312`), and `aggregated_predictions.py` duplicates the whole enrichment suite (`:465`, `:672`) with an N+1 re-query. Specify the *view* the studio actually needs (enriched chain summary: refit pairing, final scores, CV strategy/folds, dataset metadata) and add it to the `nirs4all` workspace store (this is a query/view change in the library — its CLAUDE.md gate applies there: ruff+mypy+pytest).
- Then delete the studio-side inference wholesale and consume the view. Drop the deprecated alias shims (`AGG-04`).
- **Process:** the library change is PR #1 (in `nirs4all`), the studio consumption+deletion is PR #2; both reviewed together. If the library already exposes part of this (check `v_chain_summary` & friends first!), use it instead of adding.
- **Acceptance:** byte-identical API responses for `runs`, `results/summary`, `aggregated-predictions` endpoints on a reference workspace (snapshot test before/after); the strings `_chain_match_signature`, `_chain_signature`, splitter-path parsing gone from `api/`; both repos' green gates pass.

### T2.2 — One registry-driven operator resolver *(L, risk med)* — `BV-04`, `BV-05`, `BV-09`, `BV-11`, `PIPE-01`, `PIPE-02`, `PIPE-03`
**Files:** `api/nirs4all_adapter.py`, `api/pipeline_canonical.py`, `api/shared/pipeline_service.py`, `api/pipelines.py`.
- Collapse the triplicated operator name→class resolution, the two diverging `_normalize_params`, the codegen-export alias maps, and the hardcoded model alias maps onto **one** resolver driven by the generated node registry (`api/node_registry_loader.py`).
- `PIPE-01`/`PIPE-02`: replace `SHAPE_TRANSFORMS`/`_propagate_shape` hand-math and the six operator allow-lists with registry/nirs4all-sourced metadata (if shape semantics aren't queryable from nirs4all, flag to T2.1 — do not keep the hand-rolled math silently).
- Unify pipeline-comment filtering on the shared helper.
- **Acceptance:** a corpus test: every node type in the registry round-trips name→class→canonical identically before/after; green gate.

### T2.3 — Datasets boundary & detection dedup *(M, risk med)* — `DS-01`, `DS-02`, `DS-04`
**Files:** `api/datasets.py`, `api/shared/dataset_config.py` (remaining shims if T1.1 deferred them).
- Stop reaching into `nirs4all` private parser internals (`FILE_PATTERNS`, private methods at `datasets.py:590-656`) — route the list/scan paths through the same public `FolderParser.parse` the unified path uses (extend `nirs4all-io`'s public surface via T2.1's process if needed).
- Deduplicate the three detection endpoints' copy-pasted `FolderParser→DetectedFile→options` block; kill the full dataset load used only to back-fill cached sample counts (`DS-04`).
- **Acceptance:** detection endpoints return identical JSON on a corpus of sample dataset folders (snapshot test); no `_private` attribute access on nirs4all objects in `api/datasets.py`.

---

## 7. Wave 3 — God-class splits & performance (parallel, ~8 agents, ≈30 agent-days)

> All tasks parallel; T3.3 and T3.10 need T2.1 merged. Splits are **move-only refactors** (no behavior change); each split lands as a sequence of small PRs (one domain at a time), not one mega-PR.

### T3.1 — Split `workspace.py` + async offload (ONE task, per Codex) *(XL, risk med)* — `WS-01`, `WS-04`, `WS-07`, `WS-09`
**Files:** `api/workspace.py` → `api/workspace/` package (e.g. `router_workspaces.py`, `router_datasets.py`, `router_groups.py`, `router_custom_nodes.py`, `router_maintenance.py`, `router_discovery.py`, `router_results.py`, `router_settings.py` + `services/`), `api/workspace_manager.py`, `main.py` (router registration).
- Split the 4,388-LOC router along its 9 existing section seams; extract `RerunService`, `DatasetMappingService`, and the results-cache module out of route handlers.
- While moving each handler, wrap its blocking store/parquet/`DatasetConfigs` work in `asyncio.to_thread` (this is why Codex says split+offload must be one owner — the same lines move and change). Fix the `list(executor.map(...))` loop-blocker at `:4112`. Fold the triplicated discovery flows into one scanner path (`WS-07`); remove the `WorkspaceManager` facade/private-reaching (`WS-09`).
- **Acceptance:** route table identical before/after (`/openapi.json` diff = empty); a slow-store smoke test shows `/health` stays responsive during a heavy workspace query; green gate.

### T3.2 — Split `playground.py` + execution offload *(L–XL, risk med)* — `PG-01`, `PG-04`, `PG-05`, `PG-06`, `PG-07`, `PG-08`, `PERF-02`
**Files:** `api/playground.py` (+ extracted `api/playground/` modules), `api/shared/metrics_computer.py`, `api/shared/decimation.py`.
- Break `PlaygroundExecutor` (~11 responsibilities) into pipeline-execution / caching / serialization units; offload `/execute` & `/execute-dataset` sklearn work via `asyncio.to_thread` (`PERF-02`); unify the two hand-rolled caches into one; deduplicate repetition-variability vs `metrics_computer` (`PG-04`); replace the in-backend repetition heuristics/stratified binning with nirs4all calls (`PG-06`, `PG-08` — flag to T2.1 if missing); stop full-matrix `.tolist()` + per-step deep copies in the hot path (`PG-07`).
- **Acceptance:** playground E2E (execute, preview, charts) returns identical payloads on a reference dataset; event-loop responsiveness smoke test during execute; green gate.

### T3.3 — Inspector: push analytics down, kill N+1 *(L, risk med — needs T2.1)* — `INS-01`, `INS-02`, `INS-04`, `INS-05`
**Files:** `api/inspector.py`.
- Replace per-endpoint full-scans + Python stats with store-side queries from T2.1's contract; batch the N+1 pipeline-metadata/array fetches; move bias-variance/robustness/learning-curve math into nirs4all (coordinate via T2.1's library PR) and delete `_is_lower_better` in favor of the library's metric-direction logic.
- **Acceptance:** inspector endpoints byte-identical on the reference workspace; query-count assertion (≤2 queries per endpoint) in tests.

### T3.4 — Split `updates.py` *(M–L, risk low)* — `UPD-01`, `UPD-03`
**Files:** `api/updates.py` (+ extracted modules), `api/update_downloader.py`.
- Separate version-check / download / install / progress-ws / config concerns; make the network probe + download path non-blocking with sane timeouts.

### T3.5 — Cold start & spectra perf *(M, risk low)* — `PERF-01`, `PERF-03`, `PERF-04`, `PERF-05`
**Files:** `api/shared/runtime_grouping.py`, `main.py`, `api/spectra.py`, `api/lazy_imports.py`.
- Break the eager `router → runtime_grouping → nirs4all(+sklearn)` import chain (defer to first use; `PERF-01`) — **measure** cold start before/after (`time python -c "import main"`); offload spectra parquet loads, bound the unbounded module-level dataset cache (LRU), apply `decimate_wavelengths` to full-width spectra responses.
- **Acceptance:** cold-start time recorded in PR (expect multi-second win); spectra endpoints payload-compatible (decimation behind the existing query param if one exists, else default-on with UI verified).

### T3.6 — Split `client.ts` per domain *(L, risk med)* — `CLIENT-01`, `CLIENT-02`, `CLIENT-04`, `CLIENT-05`, `CLIENT-06`
**Files:** `src/api/client.ts` → `src/api/` per-domain modules (mirroring backend routers) + `src/api/transport.ts`; ~90 importer files (mechanical import updates).
- Extract the transport core first (dedup the 3× fetch-error block, add an `AbortSignal` pass-through, `CLIENT-05`); delete the `AxiosLikeClient` shim + legacy aliases (`CLIENT-04`); then split by domain. Name the inlined response shapes (`CLIENT-06`).
- **Acceptance:** tsc/eslint green across all importers; zero `client.ts` monolith left; bundle builds.

### T3.7 — Chart hot-path perf & scaffolding dedup *(L–XL, risk med)* — `VIZ-01`, `VIZ-02`, `VIZ-04`, `VIZ-05`, `VIZ-09`, `VIZ-03` (incremental)
**Files:** `src/components/playground/visualizations/*` (post-T1.3 names), `src/lib/playground/*`.
- Memoize `SpectraWebGL` and hoist LTTB decimation out of render; stop per-render `Float32Array` allocation in Highlighted/HoveredLine; stop SpectraChart's per-render O(samples×wavelengths) rebuild; extract the copy-pasted DOM-geometry selection scaffolding into shared hooks (start of the `VIZ-03` god-component split — extract hooks opportunistically, full split is post-roadmap); move outlier/stat recomputation to backend/nirs4all data (`VIZ-09`, may flag T2.1).
- **Acceptance:** React Profiler trace in PR showing render counts before/after on hover/selection; `performanceBaselines.ts` updated; vitest green.

### T3.8 — Pipeline-editor data model & remaining converter debt *(L, risk med)* — `PCV-06`, `PCV-07`, `PCV-08`, `FE-05-state`, `FE-04-state`
**Files:** `src/components/pipeline-editor/types.ts`, `src/utils/pipelineConverter.ts`, `src/context/SelectionContext.tsx` + `src/context/InspectorSelectionContext.tsx`, `src/pages/RunProgress.tsx` (polling effect only).
- Collapse the redundant parallel step representations that force every exporter to triple-handle state (`PCV-06`); delete the deprecated variant-count family in favor of the backend hook (`PCV-07`); replace hardcoded sklearn private-module paths with registry-driven mappings (`PCV-08`, aligns with T2.2's backend resolver); merge the Selection/InspectorSelection duplicated twins; fix the RunProgress polling-interval churn.
- **Acceptance:** round-trip corpus from T0.1 still green; selection behavior E2E unchanged.

### T3.9 — Split `EnvManager` *(L, risk med)* — `ENV-01`, `ENV-05`
**Files:** `electron/env-manager.ts` → focused modules (detection / provisioning / settings / probing …).
- Split the 2,198-line god class along its 7 responsibilities; parallelize or cache `detectExistingEnvs` python spawns (6 ecosystems × 5s timeout serial today, `ENV-05`).
- **Acceptance:** env-manager vitest suite green; settings → env detection flow manually verified; startup detection time recorded before/after.

### T3.10 — Split `store_adapter.py` + query perf *(L, risk med — needs T2.1)* — `BV-08`, `WS-05`, `WS-08`, `WS-10`
**Files:** `api/store_adapter.py` (+ extracted repository modules).
- Split SQL access / ranking / response shaping; rewrite `get_enriched_runs` (470-LOC monolith) on T2.1's view without per-run N+1; merge the near-duplicate `get_all_chains_for_*`; single-query pagination with window-function count (`WS-10`).
- **Acceptance:** responses byte-identical on reference workspace; query-count assertions in tests.

---

## 8. Wave 4 — Close-out (1 agent, ≈2 agent-days)

### T4.1 — Debt-zero verification & audit close
- Re-run the audit's mechanical checks and record results in `docs/audit/2026-06-05/CLOSEOUT.md`:
  - `ruff check api/ --select F401` = 0 · `grep -ri "deprecated\|legacy\|backward.compat" api/ src/ electron/` → only legitimate hits, each justified in CLOSEOUT · no `.v2.` / vestigial `V2` filenames · dependency-drift checker green.
  - Full gate: `npm run lint:parallel && npm run test:parallel && npm run test:e2e`.
  - Perf scorecard vs baselines recorded in T3.5/T3.7/T3.9: backend cold start, playground execute round-trip, chart hover render count, electron startup.
  - For each of the 139 finding IDs: status `fixed` / `wontfix(reason)` / `deferred(issue#)` — table in CLOSEOUT.
- Anything `deferred` gets a GitHub issue with the finding text. The audit is then closed.

---

## 9. Effort & schedule summary

| Wave | Tasks | Parallel agents | Agent-days (sum) | Wall-clock (parallel) |
|---|---|---|---|---|
| W0 | T0.0–T0.4 | 4 | ≈3 | ~1 day |
| W1 | T1.1–T1.6 | 6 | ≈12 | ~3 days |
| W2 | T2.1–T2.3 | 3 | ≈15 | ~5 days (T2.1 critical path) |
| W3 | T3.1–T3.10 | 8 | ≈30 | ~5–6 days |
| W4 | T4.1 | 1 | ≈2 | ~1 day |
| **Total** | **24 tasks** | — | **≈62** | **≈3 weeks** |

Critical path: **T0.0 → (W1 merge) → T2.1 → T3.3/T3.10 → T4.1**. Everything else floats.

Expected LOC delta (deletion-dominated): **≥ −12,000 LOC** net (dead converters ~3,400, dead workspace classes ~700, pywebview stack ~800, dead builders ~1,500, dead endpoints/helpers/Storybook/scripts ~2,000+, plus dedup consolidation), with the god-files reduced from 10 files >2k LOC to 0.

---

## 10. Standing risks & mitigations

| Risk | Mitigation |
|---|---|
| T2.1 needs nirs4all-side changes (separate repo, own release) | Spec the view first; check existing store queries before adding; two linked PRs; studio keeps a snapshot test pinning response payloads |
| Refactor PRs silently change payloads | Snapshot tests on a reference workspace are a **prerequisite** for T2.1/T3.1/T3.2/T3.3/T3.10 (write them as the first commit of each task) |
| Parallel agents drift on shared types | Hot-file ownership map (§2) is enforced in PR review; waves are merge barriers |
| `runs.py` consolidation (T1.4) breaks run lifecycles | High-risk task: integration tests first (launch/progress/stop), feature-flag-free but staged behind its own snapshot of run records |
| Baseline test suite already has failures | T0.0 records them; PRs judged on *delta*, not absolute green |
