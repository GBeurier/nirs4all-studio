# Playground Performance Optimization Review

**Date**: 2026-02-10
**Scope**: Full-stack analysis of the Playground page — data loading, backend processing, frontend rendering, visualization
**Status**: Investigation complete — proposals for review

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Critical Finding: Data Loading Bottleneck](#3-critical-finding-data-loading-bottleneck)
4. [Optimization Proposals](#4-optimization-proposals)
   - [OPT-1: Eliminate Double Data Round-Trip](#opt-1-eliminate-double-data-round-trip)
   - [OPT-2: Backend-Side Processing Split (Parallel Charts)](#opt-2-backend-side-processing-split-parallel-charts)
   - [OPT-3: "Visible Spectra Only" Mode](#opt-3-visible-spectra-only-mode)
   - [OPT-4: Spectra Wavelength Decimation (Point Reduction)](#opt-4-spectra-wavelength-decimation-point-reduction)
   - [OPT-5: Replace Recharts with Canvas/WebGL-First Rendering](#opt-5-replace-recharts-with-canvaswebgl-first-rendering)
   - [OPT-6: Web Worker Offloading for Geometry Computation](#opt-6-web-worker-offloading-for-geometry-computation)
   - [OPT-7: Streaming / Chunked Dataset Loading](#opt-7-streaming--chunked-dataset-loading)
   - [OPT-8: Lazy Chart Mounting](#opt-8-lazy-chart-mounting)
   - [OPT-9: Backend Response Compression & Binary Format](#opt-9-backend-response-compression--binary-format)
   - [OPT-10: Component Splitting for YHistogramV2](#opt-10-component-splitting-for-yhistogramv2)
5. [Summary Matrix](#5-summary-matrix)
6. [Recommended Implementation Order](#6-recommended-implementation-order)

---

## 1. Executive Summary

The Playground page suffers from several compounding performance issues:

1. **Data is sent to the backend twice** — first loaded via `/spectra/{id}`, then immediately re-sent in full (all spectra as JSON) to `/playground/execute`. For a 700×200 dataset this means ~1.1MB uploaded, for a 2000×1000 dataset this means ~16MB+ uploaded per execution. This is the **primary cause of the "very very slow" first load**.

2. **All processing is monolithic** — the `/playground/execute` endpoint computes preprocessing, PCA, UMAP, folds, repetitions, statistics in a single synchronous call. The frontend blocks on the entire response before rendering any chart.

3. **Recharts SVG rendering scales poorly** — the spectra chart creates one `<Line>` SVG element per displayed sample, the histogram creates one `<Cell>` per bar segment, and the PCA scatter creates one `<Cell>` per point. WebGL alternatives exist but are not the default.

4. **No "work on visible subset" mode** — all charts always process all samples, even when only a subset is visible or relevant.

5. **No wavelength decimation at the API level** — the full wavelength resolution is sent even when the chart container is 800px wide (making 1000+ wavelength points wasteful).

---

## 2. Architecture Overview

### Current Data Flow

```
User selects dataset
        │
        ▼
GET /spectra/{id}?include_y=true          ← Load full dataset (SpectroDataset → .tolist() → JSON)
        │
        ▼
Frontend stores rawData in React state     ← All spectra in memory as number[][]
        │
        ▼
POST /playground/execute                   ← Sends ALL spectra back to backend as JSON body
  body: { data: { x: [[...]], y: [...], wavelengths: [...] }, steps: [...], options: {...} }
        │
        ▼
Backend: numpy conversion, fit_transform, PCA, UMAP, stats, repetitions
        │
        ▼
JSON response with original + processed spectra, PCA coords, folds, stats
        │
        ▼
Frontend renders: SpectraChartV2, YHistogramV2, DimensionReductionChart, FoldDistributionChartV2, RepetitionsChart
```

### Key Files

| Layer | File | Role |
|-------|------|------|
| Page | `src/pages/Playground.tsx` | Orchestrator, session persistence |
| Data loading | `src/hooks/useSpectralData.ts` | Loads data via `loadWorkspaceDataset()` |
| API client | `src/api/playground.ts` | `loadWorkspaceDataset()`, `executePlayground()`, `buildExecuteRequest()` |
| Pipeline hook | `src/hooks/usePlaygroundPipeline.ts` | Manages operators, delegates to `usePlaygroundQuery` |
| Query hook | `src/hooks/usePlaygroundQuery.ts` | TanStack Query wrapper with debounce, abort, caching |
| Backend execute | `api/playground.py` | `PlaygroundExecutor.execute()` — the monolithic pipeline |
| Backend spectra | `api/spectra.py` | `GET /spectra/{id}` — dataset loading via nirs4all |
| Spectra chart | `src/components/playground/visualizations/SpectraChartV2.tsx` | Recharts + WebGL dual mode |
| WebGL spectra | `src/components/playground/visualizations/SpectraWebGL.tsx` | Three.js line rendering |
| Histogram | `src/components/playground/visualizations/YHistogramV2.tsx` | Recharts BarChart (2400 lines) |
| PCA/UMAP | `src/components/playground/visualizations/DimensionReductionChart.tsx` | Recharts + WebGL scatter |
| Folds | `src/components/playground/visualizations/FoldDistributionChartV2.tsx` | Recharts BarChart |
| Repetitions | `src/components/playground/visualizations/RepetitionsChart.tsx` | Recharts + WebGL scatter |

---

## 3. Critical Finding: Data Loading Bottleneck

### The Double Round-Trip Problem

When a workspace dataset is loaded:

1. **Step 1** — `loadWorkspaceDataset(datasetId)` calls `GET /spectra/{datasetId}?include_y=true`
   - Backend loads `SpectroDataset`, calls `X.tolist()` (numpy → Python lists), serializes to JSON
   - Payload: `{ spectra: number[][], wavelengths: number[], y: number[] }`
   - **For 700 samples × 200 wavelengths**: ~1.1MB JSON download

2. **Step 2** — `usePlaygroundQuery` immediately calls `POST /playground/execute`
   - Request body includes `data.x` = the **entire spectra matrix sent back** to the backend
   - Backend does `np.array(data.x)` to convert back to numpy
   - **Same 1.1MB data is uploaded back to the server that just sent it**

3. **Step 3** — Backend processes and returns `original` + `processed` spectra
   - Response includes the full original spectra array AGAIN plus the processed version
   - **~2.2MB JSON download**

**Total data transferred for a 700×200 dataset on first load: ~4.4MB of JSON**
**For a 2000×1000 dataset: ~60MB+ of JSON across 3 transfers**

This is the **#1 cause** of the slow first load. The roundtrip is:
```
Backend → Frontend (load) → Backend (execute) → Frontend (result)
```
When it should be:
```
Backend (load + execute) → Frontend (result)
```

### Why sampling doesn't help

In `Playground.tsx` line 97-99:
```typescript
sampling: {
  method: 'all',    // ← ALL samples are sent and processed
},
```

The playground is configured with `method: 'all'`, meaning no server-side sampling is applied. Every sample is sent, processed, and returned.

### Additional Backend Serialization Cost

- `np.ndarray.tolist()` is inherently slow for large arrays (Python loop over elements)
- `JSON.stringify()` on the frontend for the POST body is also expensive for large arrays
- No compression (gzip/brotli) is explicitly configured for these large payloads
- The backend uses `ORJSONResponse` for the execute endpoint (good), but `loadWorkspaceDataset` uses the default `JSONResponse` via the spectra router (slower)

---

## 4. Optimization Proposals

---

### OPT-1: Eliminate Double Data Round-Trip

**Problem**: Data is loaded from backend, sent to frontend, then sent back to backend for processing.

**Proposal**: Add a `POST /playground/execute-dataset` endpoint that accepts a `dataset_id` instead of raw data. The backend loads the dataset directly from its cache and processes it without any data transfer.

```python
# New endpoint
@router.post("/execute-dataset")
async def execute_dataset_pipeline(request: ExecuteDatasetRequest):
    """Execute pipeline on a workspace dataset without sending data."""
    dataset = _load_dataset(request.dataset_id)  # Already cached from spectra.py
    X = dataset.x({"partition": "train"}, layout="2d")
    y = dataset.y({"partition": "train"})
    # ... execute pipeline directly on numpy arrays
```

Frontend change:
```typescript
// Instead of sending all data:
const response = await executePlayground({ data: { x: rawData.spectra, ... }, steps, options });

// Send only dataset reference:
const response = await executeDatasetPlayground({ dataset_id: "xxx", steps, options });
```

The first load becomes a single request: the frontend asks "process dataset X with steps Y", the backend loads + processes + returns results.

**For raw data that isn't from a workspace** (demo data, uploads), keep the current POST-with-data path as fallback.

| Aspect | Assessment |
|--------|-----------|
| **Impact** | **CRITICAL** — eliminates ~70% of data transfer on first load and every execution |
| **Difficulty** | Medium — new endpoint + frontend conditional logic |
| **Risk** | Low — additive change, old endpoint remains as fallback |
| **Lines of code** | ~80 backend, ~40 frontend |
| **Pros** | Massive latency reduction, less memory pressure, enables server-side caching of dataset numpy arrays |
| **Cons** | Two code paths to maintain (dataset-id vs raw-data). Dataset must be in workspace. |

---

### OPT-2: Backend-Side Processing Split (Parallel Charts)

**Problem**: The `/playground/execute` endpoint computes everything synchronously — preprocessing, PCA, UMAP, statistics, folds, repetitions — and returns one monolithic response. The frontend blocks until everything is done.

**Proposal**: Split the backend response into independent chunks that can be returned progressively or requested in parallel:

**Option A — Parallel endpoints** (simpler):
```
POST /playground/execute       → returns: processed spectra + original (core data)
POST /playground/execute/pca   → returns: PCA coordinates (computed from processed)
POST /playground/execute/stats → returns: statistics
POST /playground/execute/folds → returns: fold assignments
POST /playground/execute/umap  → returns: UMAP (expensive, on-demand)
```

Frontend fires all in parallel after preprocessing is done:
```typescript
const [processed, pca, stats, folds] = await Promise.all([
  executeCore(datasetId, steps),
  executePca(datasetId, steps),
  executeStats(datasetId, steps),
  executeFolds(datasetId, steps),
]);
```

The spectra chart renders as soon as `processed` returns. PCA chart renders when `pca` returns. Each chart has its own loading state (already supported via `chartLoadingStates`).

**Option B — Streaming response via WebSocket** (more complex):
Use the existing WebSocket infrastructure to stream partial results as they're computed. The backend pushes `spectra_ready`, `pca_ready`, `folds_ready` events.

**Option C — Single endpoint with internal parallelism** (minimal frontend change):
Keep single endpoint but use `asyncio.gather` / `concurrent.futures.ThreadPoolExecutor` internally to compute PCA, stats, folds concurrently after preprocessing.

| Aspect | Assessment |
|--------|-----------|
| **Impact** | **HIGH** — spectra chart appears 200-500ms sooner, PCA/histogram render independently |
| **Difficulty** | Option A: Medium. Option B: High. Option C: Low-Medium |
| **Risk** | Option A: Low (additive). Option B: Medium (WebSocket complexity). Option C: Low |
| **Lines of code** | A: ~200 backend + ~100 frontend. B: ~400. C: ~60 backend |
| **Pros** | Progressive rendering, perceived performance boost, each chart independent |
| **Cons** | A: Cache coordination between endpoints needed. B: Significant complexity. C: Limited perceived improvement since frontend still waits for full response |


CHOICE: OPTION A

---

### OPT-3: "Visible Spectra Only" Mode

**Problem**: All charts always process all N samples in the dataset. PCA is computed on all samples, histograms bin all samples, folds assign all samples. For exploration, working on a visible subset (e.g., 200 of 2000) would be much faster.

**Proposal**: Add a "Live Subset" toggle per chart or globally. When enabled:

- **Spectra chart**: Already has client-side sampling (LTTB). No change needed.
- **PCA chart**: Compute PCA only on the displayed/sampled subset (e.g., 200 random samples). Scatter plot shows only those points.
- **Histogram**: Bin only the sampled subset's Y values. Faster binning + fewer bars.
- **Folds chart**: Show fold distribution for the subset only.

Implementation:
- Add a `subsetMode: 'all' | 'visible'` option to the execute request
- When `subsetMode: 'visible'`, the backend applies `sampling` before processing (instead of after, which is current behavior — sampling currently selects which samples to *return*, but still processes all)
- Frontend adds a toggle in the toolbar: "Process all samples" / "Process visible only (faster)"
- When switching to "all", full results are fetched and cached

```typescript
// Toolbar toggle
<Toggle value={subsetMode} onChange={setSubsetMode}>
  <ToggleItem value="all">All samples</ToggleItem>
  <ToggleItem value="visible">Visible only (fast)</ToggleItem>
</Toggle>
```

| Aspect | Assessment |
|--------|-----------|
| **Impact** | **HIGH** — reduces computation and transfer by 5-10x for large datasets |
| **Difficulty** | Low-Medium — sampling logic already exists in backend |
| **Risk** | Low — opt-in feature, "all" remains default |
| **Lines of code** | ~30 backend, ~60 frontend |
| **Pros** | Dramatically faster for exploration. Users can switch to "all" for final analysis. Natural UX pattern (progressive detail) |
| **Cons** | PCA on subset may not represent full data structure. Histogram shape may differ. Users need to understand the tradeoff. Fold distributions are meaningless on a random subset |
| **Mitigation** | Show clear "Subset mode: N of M samples" indicator. Disable subset mode for folds chart (always use all). Consider stratified sampling to preserve Y distribution |

---

### OPT-4: Spectra Wavelength Decimation (Point Reduction)

**Problem**: Spectra often have 1000-2000 wavelength points, but the chart container is typically 800-1200px wide. Rendering 2000 points per spectrum when only ~800 pixels are available is wasteful — both in data transfer and rendering.

**Proposal**: Apply wavelength decimation (downsampling) at the backend level before sending data:

1. **Backend-side**: Add `max_wavelengths_display` option to the execute request. Default to `min(original_count, container_width * 1.5)`. Use LTTB (Largest-Triangle-Three-Buckets) or simple uniform decimation on each spectrum.

2. **Frontend-side**: Pass the chart container width to the query hook so it can request an appropriate resolution.

```python
# Backend: decimate wavelengths for display
if max_display_wavelengths and n_features > max_display_wavelengths:
    # LTTB decimation preserves visual shape
    indices = lttb_decimate_indices(wavelengths, max_display_wavelengths)
    X_display = X_processed[:, indices]
    wavelengths_display = [wavelengths[i] for i in indices]
```

Note: The backend already has `max_wavelengths_returned` in options, but it uses simple uniform subsampling (`np.linspace`). Upgrading to LTTB would preserve spectral features better.

| Aspect | Assessment |
|--------|-----------|
| **Impact** | **MEDIUM** — reduces data size by 2-5x for high-resolution spectra, faster rendering |
| **Difficulty** | Low — `max_wavelengths_returned` already exists, just needs LTTB + smarter defaults |
| **Risk** | Very Low — already partially implemented, just underused |
| **Lines of code** | ~30 backend (LTTB), ~10 frontend (pass container width) |
| **Pros** | Less data transfer, faster chart rendering, no visual quality loss if LTTB is used |
| **Cons** | Slight CPU cost for LTTB on backend. Users inspecting fine spectral details need full resolution (provide "full resolution" toggle) |
| **Note** | The WebGL renderer (`SpectraWebGL.tsx`) already does client-side LTTB decimation per spectrum. Doing it server-side would save transfer time AND client CPU |

---

### OPT-5: Replace Recharts with Canvas/WebGL-First Rendering

**Problem**: Recharts renders SVG elements — one `<Line>` per spectrum, one `<Cell>` per bar/point. This creates thousands of DOM elements that are expensive to create, update, and paint.

Current rendering stack per chart:
- **Spectra**: Recharts SVG (default) or Three.js WebGL (opt-in). WebGL has LTTB, batched geometry, good LOD.
- **Histogram**: Recharts SVG only. Per-Cell rendering in stacked modes.
- **PCA/UMAP**: Recharts SVG (default) or WebGL scatter (opt-in via toggle).
- **Folds**: Recharts SVG only.
- **Repetitions**: Recharts SVG (default) or WebGL scatter (opt-in).

**Proposal**: Make WebGL/Canvas the default rendering mode and keep SVG as fallback for small datasets or exports.

**Sub-proposals**:

#### OPT-5a: Default to WebGL for Spectra
The spectra chart already has a WebGL mode via Three.js. Change the `renderOptimizer` thresholds to prefer WebGL by default (the current `canvasComplexityLimit` of 5000 is very low — a 50-sample dataset with 100 wavelengths already exceeds it, but the mode selection depends on `forceMode` which persists in localStorage).

**Change**: Set `canvasComplexityLimit: 0` (always WebGL when available) or at least lower the threshold so WebGL kicks in for any dataset >20 samples.

| Aspect | Assessment |
|--------|-----------|
| **Impact** | Medium-High — WebGL spectra already exist and perform well |
| **Difficulty** | Trivial — change one constant |
| **Risk** | Low — WebGL renderer is mature, canvas fallback remains |

#### OPT-5b: Canvas-based Histogram
Replace Recharts histogram with an HTML5 Canvas 2D rendering approach. A canvas histogram with 50-100 bins is trivial to draw and eliminates 100s of React elements.

Consider using a lightweight library like `@nivo/bar` (Canvas mode), `uPlot`, or a custom Canvas renderer.

| Aspect | Assessment |
|--------|-----------|
| **Impact** | Medium — histogram is not the slowest chart, but it's 2400 lines due to Recharts complexity |
| **Difficulty** | High — YHistogramV2 has 6 render modes, selection, drag, stacking, KDE... Full rewrite |
| **Risk** | Medium — complex feature parity needed (selection, stacking modes, tooltips) |
| **Recommendation** | Defer unless histogram is a proven bottleneck. Focus on OPT-5a and OPT-5c first |

#### OPT-5c: Default to WebGL for PCA/UMAP Scatter
The scatter chart already has WebGL (Three.js `InstancedMesh`) and REGL renderers. Make WebGL the default for >100 points.

| Aspect | Assessment |
|--------|-----------|
| **Impact** | Medium — scatter performance becomes O(1) draw calls instead of O(N) React elements |
| **Difficulty** | Low — renderers exist, just change default selection logic |
| **Risk** | Low — fallback to SVG for accessibility/export |

#### OPT-5d: Consider uPlot or Lightweight Alternatives
`uPlot` is a Canvas-based charting library that is 10-50x faster than Recharts for time-series-like data. It handles 100k+ points at 60fps and is ~35KB gzipped.

For the spectra chart specifically, uPlot would be a strong alternative to Three.js — simpler API, built-in zoom/pan, native Canvas 2D (no WebGL context issues), better text rendering for axes/labels.

| Aspect | Assessment |
|--------|-----------|
| **Impact** | High — uPlot would solve spectra + histogram rendering in one migration |
| **Difficulty** | High — significant migration, new dependency, custom integration needed |
| **Risk** | Medium — different API model, selection/tooltip system must be rebuilt |
| **Pros** | Proven performance, tiny bundle, no WebGL dependency, great for line charts |
| **Cons** | Less flexible than Three.js for custom rendering (selections, overlays). Learning curve. No React wrapper (need thin integration). Not suited for scatter plots (use WebGL for PCA) |

---

### OPT-6: Web Worker Offloading for Geometry Computation

**Problem**: The WebGL spectra renderer (`SpectraWebGL.tsx`) computes LTTB decimation, color grouping, and `Float32Array` geometry construction on the main thread. For 1000+ spectra, this can block the UI for 100-300ms during zoom/pan.

**Proposal**: Move geometry computation to a Web Worker:

```typescript
// Main thread
const worker = new Worker('./spectraGeometryWorker.ts');
worker.postMessage({ spectra, visibleIndices, xRange, colors, qualityLevel });
worker.onmessage = (e) => {
  // Receive pre-built Float32Array buffers via transferable objects
  updateGeometry(e.data.positions, e.data.colors);
};
```

The worker receives spectra data, performs LTTB decimation, groups by color, builds `Float32Array` buffers, and transfers them back via zero-copy `Transferable` objects.

| Aspect | Assessment |
|--------|-----------|
| **Impact** | Medium — eliminates 100-300ms UI jank during zoom/pan on large datasets |
| **Difficulty** | Medium — Worker setup, transferable objects, sync with React state |
| **Risk** | Low — isolated change, affects only WebGL path |
| **Lines of code** | ~200 (worker + integration) |
| **Pros** | UI stays responsive during heavy computation. Can also offload PCA scatter geometry |
| **Cons** | Worker communication latency (1-5ms). Complexity of managing worker lifecycle. Double memory during transfer if not using Transferable properly |

---

### OPT-7: Streaming / Chunked Dataset Loading

**Problem**: `loadWorkspaceDataset()` loads the entire dataset in one request. For large datasets (5000+ samples), this means a multi-second blocking fetch.

**Proposal**: If OPT-1 (server-side dataset reference) is not implemented, add chunked loading:

1. **First chunk** (fast): Load first 200 samples + wavelengths + Y values. Render immediately.
2. **Background chunks**: Load remaining samples in batches of 500. Merge into state as they arrive.
3. **Processing**: Run pipeline on available data, re-run when new chunks arrive (with debounce).

Alternatively, with OPT-1 this becomes unnecessary since data never leaves the backend.

| Aspect | Assessment |
|--------|-----------|
| **Impact** | Medium — first-paint happens in <500ms instead of 2-5s |
| **Difficulty** | High — streaming state management, partial results, re-renders |
| **Risk** | Medium — complex state transitions, potential flickering |
| **Lines of code** | ~200 frontend, ~50 backend |
| **Pros** | Progressive loading UX, early interactivity |
| **Cons** | Complex implementation. Superseded by OPT-1 (preferred approach) |
| **Recommendation** | **Skip if OPT-1 is implemented** (OPT-1 makes this unnecessary) |

---

### OPT-8: Lazy Chart Mounting

**Problem**: All visible charts mount and attempt to render simultaneously when data arrives. Even hidden charts (e.g., repetitions) compute derived data.

**Proposal**: Use `React.lazy` + `Suspense` or manual lazy mounting with `IntersectionObserver`:

1. **Priority 1**: Mount spectra chart immediately (already gets priority via `useDeferredValue`)
2. **Priority 2**: Mount histogram after spectra is rendered (next frame)
3. **Priority 3**: Mount PCA after histogram
4. **Priority 4**: Mount folds/repetitions last

```typescript
// Staggered mounting
const [mountedCharts, setMountedCharts] = useState<Set<ChartType>>(new Set(['spectra']));

useEffect(() => {
  if (result) {
    // Mount next chart each frame
    requestAnimationFrame(() => setMountedCharts(prev => new Set([...prev, 'histogram'])));
    setTimeout(() => setMountedCharts(prev => new Set([...prev, 'pca'])), 100);
    setTimeout(() => setMountedCharts(prev => new Set([...prev, 'folds'])), 200);
  }
}, [result]);
```

The current code already uses `useDeferredValue(result)` for secondary charts, which is a React 18 concurrent feature. But it only defers the *value*, not the *mounting* — the chart components still mount and run their `useMemo` hooks.

| Aspect | Assessment |
|--------|-----------|
| **Impact** | Low-Medium — reduces initial rendering burst, smoother perceived load |
| **Difficulty** | Low — simple state-based conditional mounting |
| **Risk** | Very Low — additive, no functional change |
| **Lines of code** | ~30 in MainCanvas |
| **Pros** | Smoother initial render, spectra appears faster |
| **Cons** | Slight delay for secondary charts (100-200ms stagger). May look "jumpy" without transitions |

---

### OPT-9: Backend Response Compression & Binary Format

**Problem**: The `/playground/execute` response is a large JSON payload containing nested arrays of floats. JSON is verbose for numeric data (each float takes 8-15 bytes as text vs 4-8 bytes binary).

**Proposal (two tiers)**:

#### OPT-9a: Enable gzip/brotli compression (quick win)
Ensure FastAPI responses are compressed. Add `GZipMiddleware` if not already present:

```python
from starlette.middleware.gzip import GZipMiddleware
app.add_middleware(GZipMiddleware, minimum_size=1000)
```

JSON arrays of floats compress very well (typically 5-10x reduction).

| Aspect | Assessment |
|--------|-----------|
| **Impact** | Medium — reduces transfer size by 5-10x |
| **Difficulty** | Trivial — one line of middleware |
| **Risk** | None |

#### OPT-9b: Binary format (MessagePack / Arrow / raw Float32)
For maximum performance, return numeric arrays as binary:

- **MessagePack**: Drop-in JSON replacement, 2-3x smaller for numeric data. Libraries: `msgpack` (Python), `@msgpack/msgpack` (JS).
- **Apache Arrow IPC**: Zero-copy columnar format. Best for very large datasets. Overhead for small payloads.
- **Raw Float32Array**: Custom binary protocol. Maximum efficiency, maximum complexity.

| Aspect | Assessment |
|--------|-----------|
| **Impact** | Medium-High — 3-5x smaller than gzipped JSON for large numeric payloads |
| **Difficulty** | Medium (MessagePack) to High (Arrow/custom) |
| **Risk** | Medium — new serialization layer, debugging harder |
| **Recommendation** | Start with OPT-9a (gzip). Consider MessagePack only if transfer is still a bottleneck after OPT-1 |

---

### OPT-10: Component Splitting for YHistogramV2

**Problem**: `YHistogramV2.tsx` is 2421 lines with 6 render modes (`renderSimpleChart`, `renderStackedByPartition`, `renderStackedByFold`, `renderStackedByMetadata`, `renderStackedBySelection`, `renderClassificationChart`). Each mode duplicates similar Recharts structure. This bloats the bundle and makes the component expensive to parse/compile.

**Proposal**: Extract each render mode into a separate component:

```
visualizations/
  histogram/
    HistogramBase.tsx          # Shared bins, KDE, axes, tooltip
    HistogramSimple.tsx        # Simple mode
    HistogramByPartition.tsx   # Stacked by train/test
    HistogramByFold.tsx        # Stacked by fold
    HistogramByMetadata.tsx    # Stacked by metadata column
    HistogramBySelection.tsx   # Stacked by selection state
    HistogramClassification.tsx # Classification mode
    index.tsx                  # Mode router (lazy-loads appropriate sub-component)
```

| Aspect | Assessment |
|--------|-----------|
| **Impact** | Low-Medium — better code-splitting, slightly faster initial parse |
| **Difficulty** | Medium — refactoring 2400 lines with shared state |
| **Risk** | Low — pure refactor, no behavior change |
| **Lines of code** | Net zero (redistribution) |
| **Pros** | Smaller per-mode bundle, easier maintenance, each mode testable in isolation |
| **Cons** | More files to navigate. Shared state (bins, KDE, axes) needs careful prop drilling or shared hook |

---

## 5. Summary Matrix

| ID | Optimization | Impact | Difficulty | Risk | Priority |
|----|-------------|--------|-----------|------|----------|
| **OPT-1** | Eliminate double data round-trip | **Critical** | Medium | Low | **P0** |
| **OPT-9a** | Enable gzip compression | **Medium** | Trivial | None | **P0** |
| **OPT-5a** | Default WebGL for spectra | **Medium-High** | Trivial | Low | **P1** |
| **OPT-5c** | Default WebGL for PCA scatter | **Medium** | Low | Low | **P1** |
| **OPT-3** | "Visible spectra only" mode | **High** | Low-Medium | Low | **P1** |
| **OPT-2C** | Backend internal parallelism | **Medium** | Low-Medium | Low | **P1** |
| **OPT-4** | Wavelength decimation (LTTB) | **Medium** | Low | Very Low | **P2** |
| **OPT-8** | Lazy chart mounting | **Low-Medium** | Low | Very Low | **P2** |
| **OPT-6** | Web Worker geometry offload | **Medium** | Medium | Low | **P2** |
| **OPT-2A** | Parallel chart endpoints | **High** | Medium | Low | **P3** |
| **OPT-10** | Split YHistogramV2 | **Low-Medium** | Medium | Low | **P3** |
| **OPT-5d** | uPlot migration | **High** | High | Medium | **P3** |
| **OPT-5b** | Canvas histogram | **Medium** | High | Medium | **P4** |
| **OPT-9b** | Binary format (MessagePack) | **Medium-High** | Medium | Medium | **P4** |
| **OPT-7** | Streaming dataset loading | **Medium** | High | Medium | **Skip** (if OPT-1) |

---

## 6. Recommended Implementation Order

### Phase 1 — Quick Wins (1-2 days)

1. **OPT-9a**: Add `GZipMiddleware` — one line, immediate 5-10x transfer reduction
2. **OPT-5a**: Lower WebGL threshold for spectra — one constant change
3. **OPT-5c**: Default WebGL for PCA scatter — small logic change
4. **OPT-8**: Lazy chart mounting — 30 lines in MainCanvas

**Expected improvement**: 2-4x faster perceived rendering for medium datasets

### Phase 2 — Core Fix (2-3 days)

5. **OPT-1**: Server-side dataset reference endpoint — eliminates the fundamental bottleneck
6. **OPT-2C**: Backend internal parallelism (ThreadPoolExecutor for PCA/stats/folds)
7. **OPT-4**: LTTB wavelength decimation at backend level with smart defaults

**Expected improvement**: 5-10x faster first load for workspace datasets

### Phase 3 — Advanced Features (3-5 days)

8. **OPT-3**: "Visible spectra only" mode with UI toggle
9. **OPT-6**: Web Worker for WebGL geometry
10. **OPT-2A**: Parallel chart endpoints (if OPT-2C is insufficient)

**Expected improvement**: Smooth 60fps interaction even on 5000+ sample datasets

### Phase 4 — Long-term (optional)

11. **OPT-10**: Split YHistogramV2 into sub-components
12. **OPT-5d**: Evaluate uPlot as Recharts replacement for line/bar charts
13. **OPT-9b**: Binary format evaluation
14. **OPT-5b**: Canvas-based histogram (only if Recharts is proven bottleneck)

---

## Appendix: Payload Size Estimates

| Dataset Size | Current Transfer (all 3 trips) | After OPT-1 (response only) | After OPT-1 + OPT-9a (gzipped) |
|-------------|-------------------------------|----------------------------|-------------------------------|
| 200 × 200 | ~640KB | ~320KB | ~50KB |
| 700 × 200 | ~4.4MB | ~1.1MB | ~170KB |
| 2000 × 500 | ~32MB | ~8MB | ~1.2MB |
| 2000 × 1000 | ~64MB | ~16MB | ~2.5MB |
| 5000 × 2000 | ~320MB | ~80MB | ~12MB |

*Estimates based on ~8 bytes/float in JSON, ~1.5 bytes/float gzipped, 2x for original+processed.*
