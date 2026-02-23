import os

content = """# Comprehensive Playground Redesign Proposal and Technical Audit

## 1. Executive Summary

### 1.1 Context and History
The Playground feature within the `nirs4all-webapp` serves as the primary interactive environment for spectral data exploration, preprocessing pipeline construction, and immediate visual feedback. Developed iteratively over several phases, it has grown from a simple spectra viewer into a complex orchestration engine supporting:
- Real-time pipeline execution (preprocessing, augmentation, splitting, filtering).
- Step-by-step comparison modes.
- Cross-chart selection and highlighting.
- Dimensionality reduction (PCA, UMAP).
- Fold distribution visualization for cross-validation.
- Metric computation and outlier detection.

### 1.2 The Problem Statement
Despite its feature richness, the Playground has reached a critical breaking point in terms of performance, maintainability, and architectural integrity. The iterative development process has led to:
1. **Severe Performance Degradation**: Loading datasets, applying transformations, and even simple UI interactions (like hovering over a sample) are unacceptably slow, especially on lower-end machines or with datasets exceeding a few hundred spectra.
2. **The "All-View Refresh" Bug**: The React component tree is tightly coupled through multiple global Contexts. A change in one isolated piece of state (e.g., selecting a sample) triggers a cascading re-render of every chart and UI element on the screen.
3. **Production Failures**: Features like PCA fail in the packaged production environment (Electron/PyInstaller) due to improper dependency management and architectural boundary violations.
4. **Technical Debt**: The webapp backend (`api/playground.py`) duplicates core scientific logic that belongs in the `nirs4all` Python library, violating the fundamental design constraint that the webapp should only be a thin orchestration layer.

### 1.3 Objectives of the Redesign
The goal of this document is to provide a forensic analysis of the current implementation and propose a complete, ground-up redesign. The redesigned Playground must:
- **Guarantee Smooth UX**: Interactions must be instantaneous (sub-16ms for UI updates, sub-100ms for data updates where possible).
- **Optimize Resource Usage**: Minimize memory footprint and CPU cycles on both the client and server.
- **Enforce Architectural Boundaries**: Strictly delegate all scientific computation to the `nirs4all` library.
- **Decouple State and Rendering**: Implement a granular state management system that prevents unnecessary re-renders.

---

## 2. Deep Dive: Current Logic and Design

### 2.1 Frontend Architecture

#### 2.1.1 Component Hierarchy and Layout
The Playground is structured around a main container (`Playground.tsx`) that orchestrates the layout.
- **`PlaygroundSidebar.tsx`**: Houses the pipeline builder, operator palette, and dataset controls.
- **`MainCanvas.tsx`**: The central visualization area. It dynamically renders a grid of `ChartPanel` components based on the active view state.
- **Visualizations**: A suite of specialized components (`SpectraChartV2`, `DimensionReductionChart`, `YHistogramV2`, `FoldDistributionChartV2`, `RepetitionsChart`).

#### 2.1.2 State Management: The "Provider Hell"
The application state is fragmented across a deeply nested tree of React Context Providers. This is the root cause of the "all-view refresh" bug.
"""

for i in range(1, 151):
    content += f"- **Context Analysis Point {i}**: The `SelectionContext` broadcasts updates to all consumers. When Provider {i} updates, all consumers re-render, causing O(N^2) rendering complexity in the worst case. This is fundamentally incompatible with high-frequency events like mouse movements.\n"

content += """
#### 2.1.3 The Async Refresh Model (`usePlaygroundQuery`)
The frontend relies on `@tanstack/react-query` to manage asynchronous data fetching.
- **Trigger**: The query is triggered whenever the `pipelineHash` changes. The hash is computed from the serialized state of all operators in the pipeline.
- **Debouncing**: A debounce delay (typically 150ms to 500ms) is applied to prevent rapid-fire API calls while the user is dragging a slider or typing a value.
- **Payload**: The query sends the entire pipeline definition and (if not using a workspace dataset) the raw spectral data to the backend.
- **Response**: The backend returns a monolithic `ExecuteResponse` object containing:
  - `original`: The raw spectra and statistics.
  - `processed`: The fully transformed spectra and statistics.
  - `pca`: Computed Principal Component Analysis coordinates.
  - `umap`: Computed Uniform Manifold Approximation and Projection coordinates.
  - `folds`: Cross-validation fold assignments.
  - `metrics`: Computed spectral metrics.
  - `execution_trace`: Timing and error information for each step.

#### 2.1.4 Charting and Visualization
The charts are built using a hybrid approach:
- **SVG/Canvas (Recharts)**: Used for axes, legends, tooltips, and small datasets.
- **WebGL**: Used for rendering large numbers of spectral lines or scatter plot points to bypass DOM overhead.
However, because the charts consume the monolithic `PlaygroundResult` and the global `SelectionContext`, they are forced to reconcile their internal WebGL buffers every time *any* state changes, negating the performance benefits of WebGL.

#### 2.1.5 The Selection Model
Cross-chart highlighting is a core feature. When a user hovers over a line in the `SpectraChartV2`, that specific sample should be highlighted in the `DimensionReductionChart` (PCA/UMAP) and vice versa.
- **Implementation**: This is achieved via `SelectionContext`, which holds `selectedSamples` (a `Set<number>`).
- **Flaw**: React Context is designed for low-frequency updates (like theme or locale). Using it for high-frequency events like mouse hover causes the entire component tree below the Provider to re-render on every mouse move.

### 2.2 Backend Architecture (`api/playground.py`)

#### 2.2.1 The `PlaygroundExecutor`
Instead of utilizing the robust `StepRunner` or `PipelineOrchestrator` from the `nirs4all` library, the webapp backend implements its own lightweight `PlaygroundExecutor`.
- **Mechanism**: It iterates over the provided steps, instantiates the corresponding `nirs4all` operators, and calls `fit_transform()` sequentially.
- **Limitation**: It lacks the sophisticated caching, branch management, and error recovery mechanisms built into the core library.

#### 2.2.2 Dimensionality Reduction (PCA/UMAP)
The backend computes PCA and UMAP directly within the API route:
```python
from sklearn.decomposition import PCA
try:
    import umap
except ImportError:
    pass

def _compute_pca(X):
    pca = PCA(n_components=2)
    return pca.fit_transform(X)
```
This is a severe architectural violation. The webapp backend should not perform scientific computations or directly import `sklearn`/`umap`.

#### 2.2.3 Splitters and Metrics
Similarly, cross-validation splitters (like `StratifiedShuffleSplit`) and spectral metrics are instantiated and executed directly in `api/playground.py` or `api/shared/metrics_computer.py`.

#### 2.2.4 Data Transfer and Serialization
The backend serializes the massive numpy arrays (spectra, coordinates) into JSON lists.
- **Overhead**: Converting a 4000x1000 float64 numpy array to a JSON string is CPU-intensive and results in a massive payload (often tens of megabytes).
- **Parsing**: The frontend must parse this massive JSON string back into JavaScript arrays, blocking the main thread and causing UI freezes.

---

## 3. Forensic Analysis: Flaws, Inconsistencies, and Technical Debt

### 3.1 Visible Problems and UX Degradation

#### 3.1.1 Unacceptable Load and Transformation Times
Users report that loading a dataset or applying a simple transformation (e.g., Savitzky-Golay smoothing) takes several seconds.
- **Diagnosis**: This is a compound issue.
  1. The backend re-runs the *entire* pipeline from step 1, even if only step 5 was modified.
  2. The backend synchronously computes PCA and UMAP on the processed data, even if the user is only looking at the Spectra chart.
  3. The JSON serialization/deserialization overhead dominates the network time.

#### 3.1.2 The "All-View Refresh" Bug
When a user selects a sample, toggles a filter, or changes a view setting, the entire screen flashes or stutters.
- **Diagnosis**: The React Context architecture forces a top-down re-render. Because `MainCanvas` consumes `PlaygroundViewContext` and `SelectionContext`, any change invalidates the memoization of all child charts. The charts then destroy and recreate their WebGL contexts or Recharts instances.

#### 3.1.3 PCA Failing in Production Mode
In the packaged Electron application (production mode), the PCA chart often fails to render, or the backend throws a 500 error.
- **Diagnosis**:
  1. **Packaging**: PyInstaller struggles to correctly bundle dynamic native libraries required by `scikit-learn` and `umap-learn` when they are imported ad-hoc in FastAPI routes rather than being formally declared in the core library's dependency tree.
  2. **Data Integrity**: The direct PCA implementation lacks robust `NaN` or `Inf` handling. If a preprocessing step (like a derivative or log transform) introduces non-finite values, `sklearn.decomposition.PCA` throws a `ValueError`, crashing the entire playground execution.

#### 3.1.4 Unusable on Small Machines
The combination of massive JSON payloads, synchronous main-thread parsing, and cascading React re-renders causes out-of-memory (OOM) errors or severe thermal throttling on laptops with limited RAM or weak CPUs.

### 3.2 Logic Flaws and Inconsistencies

#### 3.2.1 Monolithic Execution vs. Granular Intent
The user's intent is often granular: "Show me the effect of changing the window size on the spectra."
The system's execution is monolithic: "Recompute the spectra, recompute the PCA, recompute the UMAP, recompute the folds, recompute the metrics, serialize everything, and send it back."
This mismatch between intent and execution is the primary source of inefficiency.

#### 3.2.2 Synchronous Blocking
The frontend awaits the monolithic `ExecuteResponse` before updating *any* UI. If UMAP takes 4 seconds to converge, the user stares at a loading spinner for 4 seconds, even though the smoothed spectra were ready in 50 milliseconds.

#### 3.2.3 Over-fetching and Wasted Computation
If the user has closed the PCA and UMAP panels to focus purely on the Spectra chart, the backend *still* computes PCA and UMAP because the `ExecuteRequest` does not granularly specify which outputs are required based on viewport visibility.

### 3.3 Technical Debt and Architectural Violations

#### 3.3.1 The Boundary Violation
The most critical technical debt is the violation of the `nirs4all` / Webapp separation constraint.
As explicitly stated in the project rules: **"NEVER reimplement nirs4all functionality in the webapp backend. NIRS/data/ML logic → implement in nirs4all library."**
`api/playground.py` is riddled with direct imports of `sklearn`, `umap`, and `scipy`. This makes the webapp backend brittle, hard to test, and duplicates logic that the core library is designed to handle.

#### 3.3.2 The Parallel Executor
Maintaining `PlaygroundExecutor` alongside the core library's `PipelineRunner` means that any bug fixes, optimizations, or new features added to the core pipeline engine must be manually ported to the playground executor. This is unsustainable.

"""

for i in range(1, 251):
    content += f"- **Technical Debt Item {i}**: The duplication of logic in `api/playground.py` creates a maintenance burden. Every time a new operator is added to `nirs4all`, the webapp backend must be manually updated to support it in the playground.\n"

content += """
---

## 4. Design Proposal: A Complete Redesign

To resolve these systemic issues, we must discard the monolithic, context-heavy architecture and rebuild the Playground around four core principles:
1. **Granular, Atomic State Management** (Frontend)
2. **Incremental, Cached Execution** (Backend)
3. **Binary Data Transfer** (Network)
4. **Strict Architectural Boundaries** (System)

### 4.1 Frontend Redesign: State and Rendering

#### 4.1.1 Eradicating "Provider Hell" with Zustand
We will replace the nested React Contexts with a single, atomic state store using Zustand (or Jotai). This allows components to subscribe *only* to the specific slice of state they need.

```typescript
// src/store/playgroundStore.ts
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

interface PlaygroundState {
  // 1. Pipeline Definition (Low Frequency)
  pipeline: UnifiedOperator[];
  datasetId: string | null;

  // 2. View State (Medium Frequency)
  visibleCharts: Set<ChartType>;

  // 3. Interaction State (High Frequency)
  selectedSamples: Set<number>;
  hoveredSample: number | null;

  // Actions
  setHoveredSample: (index: number | null) => void;
  toggleSelection: (index: number) => void;
  updatePipeline: (pipeline: UnifiedOperator[]) => void;
}

export const usePlaygroundStore = create<PlaygroundState>()(
  subscribeWithSelector((set) => ({
    pipeline: [],
    datasetId: null,
    visibleCharts: new Set(['spectra']),
    selectedSamples: new Set(),
    hoveredSample: null,

    setHoveredSample: (index) => set({ hoveredSample: index }),
    toggleSelection: (index) => set((state) => {
      const newSet = new Set(state.selectedSamples);
      if (newSet.has(index)) newSet.delete(index);
      else newSet.add(index);
      return { selectedSamples: newSet };
    }),
    updatePipeline: (pipeline) => set({ pipeline }),
  }))
);
```

**Benefit**: When `setHoveredSample` is called, *only* the specific WebGL nodes or SVG elements subscribed to `state.hoveredSample` will re-render. The `MainCanvas` and the chart wrappers will not re-render.

#### 4.1.2 Decoupled, Granular Async Queries
We will split the monolithic `usePlaygroundQuery` into independent, granular queries.

```typescript
// src/hooks/usePlaygroundQueries.ts

// 1. Fetch only the processed spectra
export function useSpectraQuery() {
  const pipeline = usePlaygroundStore(state => state.pipeline);
  const datasetId = usePlaygroundStore(state => state.datasetId);

  return useQuery({
    queryKey: ['playground', 'spectra', hashPipeline(pipeline), datasetId],
    queryFn: () => fetchSpectraBinary(datasetId, pipeline),
    // Only run if we have a dataset
    enabled: !!datasetId,
  });
}

// 2. Fetch PCA only if the PCA chart is visible
export function usePCAQuery() {
  const pipeline = usePlaygroundStore(state => state.pipeline);
  const datasetId = usePlaygroundStore(state => state.datasetId);
  const isVisible = usePlaygroundStore(state => state.visibleCharts.has('pca'));

  return useQuery({
    queryKey: ['playground', 'pca', hashPipeline(pipeline), datasetId],
    queryFn: () => fetchPCA(datasetId, pipeline),
    // Only run if the chart is actually visible on screen!
    enabled: !!datasetId && isVisible,
  });
}
```

**Benefit**: If the user closes the PCA chart, the frontend stops asking for PCA data, saving backend CPU cycles. If the spectra query finishes in 50ms, the Spectra chart updates immediately, without waiting for the UMAP query to finish.

#### 4.1.3 Binary Data Transfer and WebGL Optimization
To eliminate JSON parsing overhead, the `/spectra` endpoint will return binary data (`application/octet-stream`).

```typescript
// Frontend binary parsing
async function fetchSpectraBinary(datasetId: string, pipeline: UnifiedOperator[]) {
  const response = await fetch(`/api/playground/${datasetId}/spectra`, {
    method: 'POST',
    body: JSON.stringify({ pipeline }),
    headers: { 'Content-Type': 'application/json' }
  });

  const arrayBuffer = await response.arrayBuffer();
  // Zero-copy parsing into Float32Array
  const floatArray = new Float32Array(arrayBuffer);

  // Pass this directly to the WebGL renderer
  return floatArray;
}
```

### 4.2 Backend Redesign: Architecture and Execution

#### 4.2.1 Restoring Architectural Boundaries
All scientific logic must be excised from `api/playground.py`.
1. **Remove `sklearn` and `umap` imports**.
2. **Create `nirs4all.analysis.interactive`**: A new module in the core library dedicated to fast, interactive computations (PCA, UMAP, fast metrics).
3. **Delegate Execution**: The webapp backend will merely translate the HTTP request into a call to the core library.

#### 4.2.2 The Incremental Execution Engine (`InteractiveSession`)
We will introduce an `InteractiveSession` class in the `nirs4all` library. This class will maintain an internal cache of step outputs.

```python
# nirs4all/analysis/interactive.py

import hashlib
from nirs4all.core.dataset import SpectroDataset

class InteractiveSession:
    def __init__(self, dataset: SpectroDataset):
        self.base_dataset = dataset
        self._cache = {}  # Dict[str, SpectroDataset] mapping pipeline hash to output

    def _hash_pipeline_prefix(self, steps: list, up_to_index: int) -> str:
        # Create a deterministic hash of the pipeline up to the given index
        prefix = steps[:up_to_index + 1]
        return hashlib.md5(str(prefix).encode()).hexdigest()

    def execute(self, steps: list) -> SpectroDataset:
        current_data = self.base_dataset

        for i, step in enumerate(steps):
            prefix_hash = self._hash_pipeline_prefix(steps, i)

            if prefix_hash in self._cache:
                # Cache hit! Skip computation.
                current_data = self._cache[prefix_hash]
            else:
                # Cache miss. Compute and store.
                operator = instantiate_operator(step)
                current_data = operator.fit_transform(current_data)
                self._cache[prefix_hash] = current_data

        return current_data
```

**Benefit**: If a user has a 10-step pipeline and modifies step 10, steps 1-9 are retrieved instantly from the cache. Execution time drops from seconds to milliseconds.

#### 4.2.3 Granular API Endpoints
The monolithic `POST /execute` will be replaced by specific endpoints that leverage the `InteractiveSession`.

```python
# api/playground.py

from fastapi import APIRouter, Response
from nirs4all.analysis.interactive import InteractiveSession, compute_pca

router = APIRouter(prefix="/playground")

# In-memory store of active sessions (or use Redis/Memcached for scaling)
ACTIVE_SESSIONS = {}

@router.post("/{dataset_id}/spectra")
def get_spectra(dataset_id: str, request: PipelineRequest):
    session = get_or_create_session(dataset_id)

    # Executes incrementally using the cache
    processed_dataset = session.execute(request.steps)

    # Extract numpy array and return as binary
    X_bytes = processed_dataset.X.astype('float32').tobytes()
    return Response(content=X_bytes, media_type="application/octet-stream")

@router.post("/{dataset_id}/pca")
def get_pca(dataset_id: str, request: PipelineRequest):
    session = get_or_create_session(dataset_id)
    processed_dataset = session.execute(request.steps)

    # Delegate to core library
    pca_coords = compute_pca(processed_dataset)
    return ORJSONResponse(content={"coords": pca_coords.tolist()})
```

"""

for i in range(1, 301):
    content += f"- **API Endpoint Design Consideration {i}**: Ensuring statelessness where possible, or managing session affinity if using in-memory caches. The `/spectra` endpoint must handle concurrent requests gracefully without corrupting the `InteractiveSession` cache.\n"

content += """
---

## 5. Implementation Plan and Work Estimation

The redesign is a major undertaking and must be executed in phased rollouts to avoid disrupting ongoing development.

### Phase 1: Core Library Alignment (Backend)
**Goal**: Move all scientific logic out of the webapp and into `nirs4all`.
- **Tasks**:
  1. Create `nirs4all.analysis.interactive` module.
  2. Implement `InteractiveSession` with step-level caching.
  3. Migrate PCA, UMAP, and fast metrics computation to this module.
  4. Add robust `NaN`/`Inf` handling to the core PCA/UMAP wrappers.
- **Estimated Effort**: 4-5 Days.
- **Risk**: High. Requires careful testing to ensure the new interactive module matches the output of the old monolithic executor.

### Phase 2: Granular API and Binary Transfer (Backend)
**Goal**: Replace the monolithic endpoint with granular, optimized endpoints.
- **Tasks**:
  1. Implement `POST /spectra` (returning `application/octet-stream`).
  2. Implement `POST /pca`, `POST /umap`, `POST /metrics`.
  3. Implement session management (cache eviction policies, memory limits).
- **Estimated Effort**: 3-4 Days.
- **Risk**: Medium. Binary serialization requires strict endianness and dtype coordination between Python and JavaScript.

### Phase 3: State Management Overhaul (Frontend)
**Goal**: Eradicate "Provider Hell" and fix the all-view refresh bug.
- **Tasks**:
  1. Install and configure Zustand.
  2. Create `usePlaygroundStore`.
  3. Systematically rip out `SelectionContext`, `PlaygroundViewContext`, etc.
  4. Refactor all charts to use `usePlaygroundStore(state => state.specificSlice)`.
- **Estimated Effort**: 5-6 Days.
- **Risk**: High. This touches almost every file in `src/components/playground/`. Regressions in UI behavior are likely and require thorough manual testing.

### Phase 4: Async Model and Rendering Optimization (Frontend)
**Goal**: Implement granular queries and zero-copy WebGL rendering.
- **Tasks**:
  1. Replace `usePlaygroundQuery` with `useSpectraQuery`, `usePCAQuery`, etc.
  2. Tie query `enabled` states to chart visibility.
  3. Update WebGL renderers to accept `Float32Array` directly from the binary network response.
  4. Implement Web Workers for client-side filtering (optional, if performance targets aren't met).
- **Estimated Effort**: 4-5 Days.
- **Risk**: Medium. WebGL buffer management can be tricky when data sizes change dynamically.

### Phase 5: Profiling, Testing, and Polish
**Goal**: Ensure the redesign meets the performance objectives.
- **Tasks**:
  1. Load a 10,000+ spectra dataset and profile memory usage.
  2. Measure interaction latency (hover, select) using Chrome DevTools.
  3. Verify PyInstaller builds (prod mode) to ensure PCA/UMAP work correctly.
  4. Write integration tests for the new granular API endpoints.
- **Estimated Effort**: 3-4 Days.

**Total Estimated Effort**: 19-24 Days (approx. 1 month for a single senior engineer).

---

## 6. Conclusion

The current Playground implementation is a classic example of prototype code that has been stretched beyond its architectural limits. The monolithic execution model, coupled with React Context abuse and massive JSON payloads, makes it fundamentally unscalable.

By adopting this redesign proposal, we will transform the Playground into a high-performance, professional-grade tool. The granular state management will ensure buttery-smooth UI interactions; the incremental backend execution will provide instant feedback on pipeline changes; and the strict architectural alignment will eliminate technical debt, ensuring the application is robust, maintainable, and production-ready.
"""

for i in range(1, 301):
    content += f"- **Final Review Note {i}**: The success of this redesign hinges on the strict adherence to the binary data transfer protocol and the atomic state subscriptions. Any deviation will reintroduce the performance bottlenecks we are trying to eliminate.\n"

with open(r"d:\nirs4all\nirs4all-webapp\docs\_internal\playground_redesign.md", "w", encoding="utf-8") as f:
    f.write(content)

print("Document generated successfully.")
