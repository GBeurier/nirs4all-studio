# Codex Review — nirs4all-studio Tech-Debt Audit

> **Reviewer:** OpenAI Codex CLI v0.137.0 (`gpt-5.5`, reasoning effort xhigh, read-only sandbox) · **Date:** 2026-06-05 · **Reviewed artifact:** `AUDIT_TECHNIQUE.md` @ commit `eba503f` · **Mandate:** verify the audit's claims against the actual code — confirm/refute criticals, spot-check high-severity findings, flag false positives, identify missed debt, critique prioritization.
>
> Review reproduced verbatim below (file paths relativized to the repo root). All corrections listed at the end have been folded into `AUDIT_TECHNIQUE.md` §0 and `ROADMAP.md`.

## Verdict

The audit is broadly actionable, but not fully trustworthy as written: one of its two “critical” findings (PKG-01) is materially wrong about import failure. PCV-03 and most high-severity architecture/debt claims I checked do hold up against commit `eba503f`. The main correction is to separate real boundary/debt issues from overstated release-blocker language.

## Critical findings — verification

| Finding | Status | Evidence | Review |
|---|---|---|---|
| PKG-01 | **Refuted as critical; dependency drift confirmed** | [api/playground.py](api/playground.py:36) wraps `import msgpack` in `try/except ImportError`, sets `MSGPACK_AVAILABLE=False` at [api/playground.py](api/playground.py:39), and only calls `msgpack.packb` when available at [api/playground.py](api/playground.py:1799). `msgpack` exists in [requirements.txt](requirements.txt:8), but not in [requirements-cpu.txt](requirements-cpu.txt:5), [scripts/python-runtime-config.cjs](scripts/python-runtime-config.cjs:21), or the hiddenimports utility list ending at [backend.spec](backend.spec:158). | CPU builds should still import the playground router and fall back to JSON. The true issue is packaging drift / missing optional MessagePack support, not a CPU-build startup crash. Downgrade from critical. |
| PCV-03 | **Confirmed** | New scalar generators are created with `scalarGeneratorConfig` and `branches: undefined` at [types.ts](src/components/pipeline-editor/types.ts:1349) and [types.ts](src/components/pipeline-editor/types.ts:1376). The renderer reads and updates `scalarGeneratorConfig` at [GeneratorRenderer.tsx](src/components/pipeline-editor/config/step-renderers/GeneratorRenderer.tsx:410) and [GeneratorRenderer.tsx](src/components/pipeline-editor/config/step-renderers/GeneratorRenderer.tsx:495). Export reads `step.branches` at [pipelineConverter.ts](src/utils/pipelineConverter.ts:2657), emits grid/zip from branches at [pipelineConverter.ts](src/utils/pipelineConverter.ts:2679), and has no `_sample_` export branch before falling back to `_or_` at [pipelineConverter.ts](src/utils/pipelineConverter.ts:2714). | Critical data-loss bug is real. Grid/zip scalar edits export as empty objects; sample edits can export as `{ _or_: [] }`. |

## High-severity spot-checks

| Finding id | Claim holds? | Evidence | Note |
|---|---|---|---|
| WS-06 | **True, partly broad** | Dataset linking loads `DatasetConfigs` then reaches dataset attrs/private fields at [workspace.py](api/workspace.py:426), [workspace.py](api/workspace.py:455), [workspace.py](api/workspace.py:461). CV strategy mapping is hardcoded at [store_adapter.py](api/store_adapter.py:194). | Dataset part is not pure reimplementation, but private attr use and target synthesis still violate the intended boundary. |
| BV-06 | **True** | Refit/CV matching signature at [store_adapter.py](api/store_adapter.py:413), synthetic final scores at [store_adapter.py](api/store_adapter.py:458), fallback mutation at [store_adapter.py](api/store_adapter.py:481), sibling enrichment at [store_adapter.py](api/store_adapter.py:519). | Real boundary violation. |
| BV-07 | **True** | Splitter names map to UI strategy keys at [store_adapter.py](api/store_adapter.py:203), folds/random state inferred from params at [store_adapter.py](api/store_adapter.py:239), rerun mapping duplicated at [workspace.py](api/workspace.py:3315). | Should come from nirs4all/store metadata. |
| AGG-01 | **True, drift overstated** | Duplicates chain signature at [aggregated_predictions.py](api/aggregated_predictions.py:465) versus [store_adapter.py](api/store_adapter.py:413); duplicates enrichment at [aggregated_predictions.py](api/aggregated_predictions.py:672) versus [store_adapter.py](api/store_adapter.py:519). | Duplication and extra query are real; the actual matching formula is effectively the same. |
| INS-04 | **True** | Robustness computes fold-score std/gap normalization at [inspector.py](api/inspector.py:1615); bias/variance computes sample prediction means/vars at [inspector.py](api/inspector.py:2158); learning curve estimates train size at [inspector.py](api/inspector.py:2321). | Backend is doing ML analytics, not just serving stored results. |
| PIPE-01 / PIPE-02 | **True** | Shape semantics hardcoded in `SHAPE_TRANSFORMS` at [pipelines.py](api/pipelines.py:2135), including PLS/PCA/Crop/Wavelet math at [pipelines.py](api/pipelines.py:2162). Operator allow-lists start at [pipelines.py](api/pipelines.py:729), [pipelines.py](api/pipelines.py:846), [pipelines.py](api/pipelines.py:1005). | Clear registry/boundary debt. |
| DS-01 | **True, with nuance** | `detect_unified` delegates to `FolderParser.parse` at [datasets.py](api/datasets.py:455), but list/scan paths import `FILE_PATTERNS` and call private parser methods at [datasets.py](api/datasets.py:590), [datasets.py](api/datasets.py:640), [datasets.py](api/datasets.py:656). | Claim holds for two paths; not all detection code is violating. |
| WS-02 | **True** | `git grep` found only class definitions for `DatasetRegistry`, `SchemaMigrator`, `RunManager`: [workspace_manager.py](api/workspace_manager.py:1095), [workspace_manager.py](api/workspace_manager.py:1448), [workspace_manager.py](api/workspace_manager.py:1553). | Dead-code claim holds. |
| PCV-01 / PCV-02 | **True** | `nativePipelineFormat.ts` states it is a distinct converter at [nativePipelineFormat.ts](src/utils/nativePipelineFormat.ts:14). Its only tracked importer is its test at [nativePipelineFormat.test.ts](src/utils/__tests__/nativePipelineFormat.test.ts:13); live editor imports `pipelineConverter` at [usePipelineEditor.ts](src/hooks/usePipelineEditor.ts:16). | Dead parallel converter confirmed. |
| RUN-01 / RUN-02 | **True** | `runs.py` creates its own queue/executor at [runs.py](api/runs.py:1114) and [runs.py](api/runs.py:1439); other endpoints use `JobManager` at [pipelines.py](api/pipelines.py:1591) and [training.py](api/training.py:173). Metric extraction differs across [runs.py](api/runs.py:1281), [pipelines.py](api/pipelines.py:1657), [training.py](api/training.py:456). | Strongly confirmed. |
| PERF-01 | **True** | `main.py` eagerly imports routers at [main.py](main.py:69), including pipelines at [main.py](main.py:77). `pipelines.py` imports runtime grouping at [pipelines.py](api/pipelines.py:39), which imports nirs4all at [runtime_grouping.py](api/shared/runtime_grouping.py:8). | This defeats the intended lazy ML startup. |
| WS-04 | **True, with nuance** | Async workspace endpoints call sync scanner/store/parquet work directly: [workspace.py](api/workspace.py:2631), [workspace.py](api/workspace.py:2698), [workspace.py](api/workspace.py:2801), [workspace.py](api/workspace.py:3726). One path uses `ThreadPoolExecutor` but blocks on `list(executor.map(...))` at [workspace.py](api/workspace.py:4112). | Workspace claim holds; don’t generalize it to `runs.py`, which does use a worker thread. |

## False positives / overstated

- **PKG-01 as a critical import crash is false.** The import is guarded; CPU builds degrade to JSON instead of failing router import. Keep PKG-02 dependency drift, but downgrade PKG-01.
- **“msgpack imported unconditionally” is factually wrong.** It is guarded at [api/playground.py](api/playground.py:36).
- **AGG-01 “already drifted” needs tighter wording.** The duplicated enrichment exists, but the signature logic is not obviously semantically different; the clearest drift is query scope/performance.
- **Perf wording around runs should be corrected.** `runs.py` does not run `nirs4all.run()` directly on the event loop; it uses `ThreadPoolExecutor`. The debt there is bespoke execution/cancellation, not absence of any thread offload.

## Missed debt

- **Run stop/pause controls are cosmetic for in-flight work.** `stop_run` sets `_run_cancellation_flags` and marks the run failed at [runs.py](api/runs.py:2122), but the worker only exits the polling loop and calls `executor.shutdown(wait=False)` at [runs.py](api/runs.py:1535), leaving `nirs4all.run()` running in the thread. `pause_run` only mutates statuses at [runs.py](api/runs.py:2141); `_execute_run` later overwrites terminal status at [runs.py](api/runs.py:911). Add a RUN bug for “stop/pause do not stop/pause execution and can keep writing store/artifacts.”
- **PCV-03 is broader than export loss.** Imported `_grid_`/`_zip_`/`_sample_` populate `branches`/`params`, not `scalarGeneratorConfig`, at [pipelineConverter.ts](src/utils/pipelineConverter.ts:1926) and [pipelineConverter.ts](src/utils/pipelineConverter.ts:1993), while renderer/tree labels read scalar config at [GeneratorRenderer.tsx](src/components/pipeline-editor/config/step-renderers/GeneratorRenderer.tsx:410) and [utils.ts](src/components/pipeline-editor/core/tree-node/utils.ts:239). Imported scalar generators can render as empty/zero before export corruption.

## Prioritization & sequencing critique

The order needs adjustment because PKG-01 is not a release-blocking crash. Put PCV-03 first, with PCV-04/05 if verified, then dependency-source consolidation as a small packaging hygiene task.

The “boundary contract must land before dedup/perf” dependency is only true for chain-summary/refit/inspector work. It is not a blocker for frontend converter fixes, dead converter deletion, JobManager consolidation, `runtime_grouping` lazy import cleanup, or mechanical unused-import/sanitize cleanup.

Parallelization has hidden collision risks. `api/store_adapter.py` is touched by BV-06/BV-07/AGG-01/WS-05/INS work; `src/utils/pipelineConverter.ts` is touched by PCV-03/04/05/06/08; `api/runs.py` is touched by RUN-01/RUN-02/RUN-06 and the missed stop/pause bug. Those should not be assigned as independent parallel edits without an explicit owner/order.

Splitting `workspace.py` after offload is debatable. Surgical `asyncio.to_thread` wrappers can land early, but deeper WS-04 fixes will collide with WS-01 router/service extraction. Treat them as one workstream or define very narrow first patches.

## Corrections to apply

- Downgrade PKG-01; rewrite as “MessagePack optional dependency missing from CPU/package sources; router still imports via guarded fallback.”
- Promote PCV-03 as the top critical fix and include sample fallthrough plus import/render mismatch.
- Tighten AGG-01 language: duplication confirmed; “drift” is mainly query-scope/perf unless more semantic divergence is shown.
- Add a RUN finding for stop/pause not controlling the worker thread.
- Add a collision map for `store_adapter.py`, `pipelineConverter.ts`, `runs.py`, and `workspace.py`.
- Reword sequencing: boundary contract first only for chain-summary/inspector/aggregated-predictions work, not for unrelated deletion, packaging, frontend conversion, or JobManager cleanup.