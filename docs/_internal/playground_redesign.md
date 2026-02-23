# Playground Redesign Plan (Code-Audited)

**Date:** 2026-02-22  
**Status:** Proposed  
**Scope:** `src/pages/Playground.tsx`, `src/hooks/usePlaygroundQuery.ts`, `src/hooks/useSpectralData.ts`, `src/context/SelectionContext.tsx`, `src/components/playground/*`, `api/playground.py`, `api/spectra.py`

## 1. Purpose

The previous redesign document captured real pain points but is now partially stale.  
This update is based on the current code and focuses on an incremental refactor that improves performance quickly without a risky "rewrite everything" approach.

## 2. Current State

## 2.1 What Is Already Improved

- `POST /api/playground/execute-dataset` exists and avoids uploading spectra back to backend for workspace datasets.
- Response compression is enabled globally (`GZipMiddleware` in `main.py`).
- Staggered chart mounting exists (`useStaggeredChartMount`).
- Render mode auto-optimization and WebGL-first behavior exist (`renderOptimizer.ts`).
- Selection selector infrastructure exists (`useSelectionSelector`, `useHover`, `useHoveredSample` in `SelectionContext.tsx`).

## 2.2 Confirmed Remaining Bottlenecks

1. Hover updates still fan out too widely.
- `SelectionProvider` keeps a separate `hoveredSample` state, but still injects it into `SelectionContext` value.
- `SelectionContext` value is re-created when hover changes.
- Many heavy components consume `useSelection()` directly (`MainCanvas`, `SpectraWebGL`, `DimensionReductionChart`, histogram/folds/repetitions charts, toolbar hooks).
- Selector hooks exist but are effectively unused by playground components.

2. Workspace load path still downloads full spectra matrix before execution.
- `useSpectralData.loadFromWorkspace()` always calls `loadWorkspaceDataset()`.
- `loadWorkspaceDataset()` calls `GET /api/spectra/{datasetId}?include_y=true` and stores full `number[][]` spectra in frontend memory.
- `usePlaygroundQuery()` still requires `data` even when `datasetId` exists, and query keys still hash `data.spectra`.

3. Backend execution remains monolithic and over-computes.
- `PlaygroundExecutor.execute()` does preprocessing/filter/splitting, then statistics, PCA, optional UMAP, repetition analysis (default enabled), optional metrics, and serializes large arrays in one response.
- Frontend cannot request per-chart outputs independently, except UMAP toggle.
- `compute_repetitions` is not exposed in frontend execute options, so repetition analysis runs by default.

4. Technical debt concentration is high.
- `api/playground.py` is ~1722 lines and includes orchestration + scientific computations + serialization + cache handling.
- Multiple visualization files are very large (about 1424-1691 lines; three exceed 1500: `SpectraWebGL`, `DimensionReductionChart`, `FoldDistributionChartV2`).
- `spectraGeometryWorker.ts` exists but is not wired into runtime rendering.

## 3. Design Principles For The Refactor

1. Keep behavior stable while isolating hot paths.
2. Prioritize latency wins that do not require backend protocol rewrites first.
3. Make computation demand-driven by visible charts.
4. Reduce payload size and frontend memory pressure before introducing complex transport changes.
5. Split files/modules by responsibility as part of each phase, not as a separate "cleanup only" effort.

## 4. Target Architecture

## 4.1 Interaction State Plane

- Keep selection and hover separate in practice, not only in type definitions.
- `SelectionContext` should not include high-frequency hover state.
- Heavy views should use narrow subscriptions:
  - `useHoveredSample()` (or equivalent external store) for hover-only consumers.
  - `useSelectionSelector()` for selected/pinned/count slices.
- Hover dispatch should be throttled to animation frames for charts that emit continuous pointer events.

## 4.2 Data Loading Plane

- Workspace mode should become dataset-reference-first:
  - Do not load full spectra matrix in frontend by default.
  - Fetch only lightweight metadata needed for UI (`sampleIds`, `y`, `wavelengths`, optional metadata columns).
- `usePlaygroundQuery` should support dataset-only mode (`data` can be null when `datasetId` is present).
- Dataset mode query keys should be based on `datasetId + pipelineHash + optionsHash`, not on `data.spectra` fingerprints.

## 4.3 Execution Plane

- Keep current endpoint initially, but make outputs explicit:
  - `compute_pca`
  - `compute_umap`
  - `compute_statistics`
  - `compute_repetitions`
  - `compute_metrics`
  - optional payload fields (`include_original`, `include_processed`, etc.).
- MainCanvas should request only what visible charts need.
- Optional next step: split endpoint into core and per-chart compute routes once payload contracts are stable.

## 4.4 Backend Boundary Plane

- Webapp backend should orchestrate.
- Scientific logic currently in `api/playground.py` and `api/shared/metrics_computer.py` should migrate into `nirs4all` modules incrementally.
- Introduce a cleaner backend module split first (same behavior), then move implementation ownership.

## 5. Phased Implementation Plan

## Phase 0: Baseline And Guardrails (2 days)

- Add explicit timing breakdown in execute response (sampling, steps, PCA, UMAP, repetitions, serialization).
- Add frontend performance marks around interaction and chart render commit.
- Document benchmark dataset sizes and expected budgets.

**Exit criteria**
- We can compare before/after latency for each phase with the same dataset and pipeline.

## Phase 1: Stop Hover Cascade (3-4 days)

- Remove `hoveredSample` from `SelectionContext` value object.
- Migrate hot components from `useSelection()` to narrow selectors and hover hooks.
- Ensure `MainCanvas` and `usePlaygroundShortcuts` are not re-rendering on hover-only updates.

**Exit criteria**
- Hovering one chart no longer triggers global playground rerender spikes.
- P95 hover-to-highlight latency < 16 ms on reference dataset.

## Phase 2: Dataset-Reference-First Frontend Path (4-6 days)

- Add/extend lightweight dataset metadata API.
- Refactor `useSpectralData` workspace loading to avoid full spectra pull by default.
- Refactor `usePlaygroundQuery` dataset mode:
  - no `data` requirement
  - dataset-based query key
  - fallback to raw-data path for demo/upload.

**Exit criteria**
- Workspace first-load no longer downloads full raw spectra matrix by default.
- Frontend heap growth on load is materially reduced.

## Phase 3: Compute Gating And Payload Trimming (5-7 days)

- Extend execute options and frontend types to control repetitions/statistics/payload sections.
- Compute only what currently visible charts need.
- Default `compute_repetitions` to false unless repetitions chart is visible or explicitly requested.

**Exit criteria**
- When only spectra + histogram are visible, backend skips PCA/UMAP/repetitions.
- Response payload size drops significantly for common flows.

## Phase 4: Backend Modularization And Incremental Cache (8-12 days)

- Split `api/playground.py` into smaller modules (`executor`, `embeddings`, `repetitions`, `serialization`, `cache`, `routes`).
- Add step-prefix cache for incremental recompute on pipeline edits.
- Start moving reusable analysis logic to `nirs4all` and replace webapp-local implementations with delegation.

**Exit criteria**
- Editing late pipeline steps avoids full recompute where possible.
- `api/playground.py` route layer becomes thin and testable.

## Phase 5: Optional High-Complexity Optimizations (post-stabilization)

- Wire `spectraGeometryWorker.ts` for off-main-thread decimation.
- Add binary transport for large matrices if JSON+gzip remains a bottleneck.
- Continue splitting oversized visualization components into focused modules/hooks.

## 6. Performance Budgets

| Metric | Target |
|---|---|
| Hover highlight latency (p95) | < 16 ms |
| Selection propagation (p95) | < 50 ms |
| First chart visible after workspace load | < 1.5 s |
| Pipeline edit round-trip (1k x 500, 3 steps, no UMAP) | < 400 ms |
| Browser heap growth on workspace load | No full raw matrix copy by default |

## 7. Risks And Mitigations

| Risk | Mitigation |
|---|---|
| Regressions in cross-chart selection behavior | Add focused interaction tests before state refactor |
| API contract churn across frontend/backend | Gate new options with defaults preserving current behavior |
| Incremental cache complexity in backend | Start with per-request timing + modularization, then add prefix cache |
| Binary transport increases implementation complexity | Keep as optional Phase 5 after low-risk wins |

## 8. Proposed PR Sequence (Pragmatic)

1. `PR-1` Interaction hot-path cleanup (hover/context selectors).
2. `PR-2` Dataset-reference-only query mode and lightweight workspace metadata loading.
3. `PR-3` Execute option expansion + chart-driven compute gating.
4. `PR-4` Backend module split + timing instrumentation.
5. `PR-5` Incremental cache and `nirs4all` delegation migration.

---

This plan intentionally avoids a big-bang rewrite.  
It sequences low-risk, high-impact wins first, then progressively addresses deeper architectural debt.
