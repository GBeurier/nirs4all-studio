## Summary

- Playground transform caching is effectively unstable: cache keys include random operator IDs, and import/session restore regenerates those IDs.
- Desktop slowness is likely dominated by selection hover cascades plus WebGL/scatter renderers doing continuous work while idle.
- Large chart components still do expensive render-time transforms, object-matrix construction, and per-pointer React state updates.
- Dataset loading bypasses TanStack Query, so workspace spectra are reloaded on page restore/navigation instead of being cached.
- The Electron/web split has duplicated runtime detection, and router/API base-url behavior diverges in production desktop mode.

## Findings

1. **Random operator IDs break playground transform caching**  
   **SEVERITY:** Critical | **CATEGORY:** bottleneck | **LOCATIONS:** `src/lib/playground/hashing.ts:72`, `src/lib/playground/operatorFormat.ts:231`, `src/hooks/usePlaygroundPipeline.ts:293`, `src/pages/Playground.tsx:223`, `src/pages/Playground.tsx:349`  
   **Evidence:** `hashOperator()` includes `id: operator.id`, while operators are created with `` `${name}-${Date.now()}-${Math.random()...}` `` and restored via `addOperatorByName(...)`.  
   **IMPACT:** Same semantic pipeline gets a different hash after import/restore/reload, causing React Query/backend cache misses. This directly matches the “playground transforms caching is broken” report.  
   **FIX:** Remove transient `id` from cache hashes; hash ordered `{type,name,params,enabled}` only. Add a batched `setOperators(importedOps)` restore path that preserves imported IDs or generates deterministic IDs.  
   **EFFORT:** M

2. **Hover still invalidates the main `SelectionContext`**  
   **SEVERITY:** Critical | **CATEGORY:** bottleneck | **LOCATIONS:** `src/context/SelectionContext.tsx:845`, `src/context/SelectionContext.tsx:1033`, `src/context/SelectionContext.tsx:1067`, `src/components/playground/visualizations/SpectraWebGL.tsx:1361`, `src/components/playground/MainCanvas.tsx:439`  
   **Evidence:** Comment says hover is separate, but main value still contains `hoveredSample` and depends on it: `hoveredSample, // Override with separate hover state`.  
   **IMPACT:** Every hover update can re-render broad consumers, including `MainCanvas`, spectra, histogram, folds, PCA, and WebGL charts.  
   **FIX:** Remove `hoveredSample` from `SelectionContextValue`; make charts use `HoverContext` or selector hooks. Split state/actions or use `use-context-selector`.  
   **EFFORT:** L

3. **Spectra hover hit-testing is O(lines × points) per mousemove**  
   **SEVERITY:** High | **CATEGORY:** bottleneck | **LOCATIONS:** `src/components/playground/visualizations/SpectraWebGL.tsx:1074`, `src/components/playground/visualizations/SpectraWebGL.tsx:1092`, `src/components/playground/visualizations/SpectraWebGL.tsx:1099`, `src/components/playground/visualizations/SpectraWebGL.tsx:1117`, `src/components/playground/visualizations/SpectraWebGL.tsx:1379`  
   **Evidence:** `for (const line of linesRef.current)` then `for (let i = 0; i < nPoints; i++)`, followed by `selectionCtx.setHovered(index)`.  
   **IMPACT:** Dense spectra can run millions of JS checks per pointer event and then trigger the context cascade above.  
   **FIX:** Throttle with `requestAnimationFrame`; disable hover above a sample/point threshold; add x-bucket spatial indexing or GPU picking.  
   **EFFORT:** M

4. **Scatter WebGL/regl renderers run continuous idle loops**  
   **SEVERITY:** High | **CATEGORY:** bottleneck | **LOCATIONS:** `src/components/playground/visualizations/scatter/ScatterRegl2D.tsx:607`, `src/components/playground/visualizations/scatter/ScatterRegl2D.tsx:567`, `src/components/playground/visualizations/scatter/ScatterPureWebGL2D.tsx:785`, `src/components/playground/visualizations/scatter/ScatterPureWebGL3D.tsx:805`  
   **Evidence:** `render(); animationFrameRef.current = requestAnimationFrame(loop);`; regl also renders the picking buffer every frame with `regl({ framebuffer: pickFbo })(...)`.  
   **IMPACT:** Static charts consume CPU/GPU at 60fps in Electron, hurting responsiveness and battery.  
   **FIX:** Switch to invalidation-driven rendering; continuous loop only while dragging/animating. Render picking buffer only when camera/data/selection changes.  
   **EFFORT:** M

5. **Workspace dataset loading bypasses TanStack Query**  
   **SEVERITY:** High | **CATEGORY:** bottleneck | **LOCATIONS:** `src/hooks/useSpectralData.ts:10`, `src/hooks/useSpectralData.ts:91`, `src/api/playground.ts:242`, `src/pages/Playground.tsx:341`  
   **Evidence:** `const [rawData, setRawData] = useState(...)`; `const data = await loadWorkspaceDataset(...)`; restore calls `loadFromWorkspace(...)`.  
   **IMPACT:** Full spectra reload on every Playground mount/session restore; no shared stale/cache window.  
   **FIX:** Replace with `useQuery(['workspace-dataset', datasetId, includeY], ...)` using long `staleTime/gcTime`; store dataset identity separately from data. Consider persisted query cache/IndexedDB for Electron.  
   **EFFORT:** M

6. **Debounced playground query can mismatch hash and operators**  
   **SEVERITY:** High | **CATEGORY:** bottleneck | **LOCATIONS:** `src/hooks/usePlaygroundQuery.ts:128`, `src/hooks/usePlaygroundQuery.ts:144`, `src/hooks/usePlaygroundQuery.ts:151`, `src/hooks/usePlaygroundQuery.ts:179`, `src/lib/playground/hashing.ts:119`  
   **Evidence:** `if (hashPipeline(stableOperatorsRef.current) !== debouncedPipelineHash) stableOperatorsRef.current = operators;`; data hash samples only first/middle/last spectra.  
   **IMPACT:** Query key and request body can temporarily diverge during debounce; sampled data hashes can collide for edited datasets.  
   **FIX:** Debounce the operator object and hash together; key and request must use the same object. Use dataset id/version or robust content hash.  
   **EFFORT:** M

7. **Manual playground refetch invalidates cache instead of using it**  
   **SEVERITY:** High | **CATEGORY:** bottleneck | **LOCATION:** `src/hooks/usePlaygroundQuery.ts:278`  
   **Evidence:** `queryClient.invalidateQueries({ queryKey });`  
   **IMPACT:** A “refresh” always marks the transform stale and can POST `/playground/execute` again instead of serving cached data.  
   **FIX:** Use `query.refetch()` only for explicit recomputation; otherwise use `ensureQueryData` or cache-first reads.  
   **EFFORT:** S

8. **Reference dataset query key is under-specified**  
   **SEVERITY:** High | **CATEGORY:** quality | **LOCATION:** `src/hooks/useReferenceDatasetQuery.ts:98`  
   **Evidence:** Query key uses only `referenceData.spectra.length`, `referenceData.wavelengths.length`, and pipeline hash.  
   **IMPACT:** Different datasets with identical shapes can reuse wrong cached reference results.  
   **FIX:** Include dataset id/version, wavelength checksum, and data/y hash in the key.  
   **EFFORT:** S

9. **SpectraWebGL updates camera projection every frame**  
   **SEVERITY:** High | **CATEGORY:** bottleneck | **LOCATION:** `src/components/playground/visualizations/SpectraWebGL.tsx:1201`  
   **Evidence:** `useFrame(() => { ... camera.updateProjectionMatrix(); });`  
   **IMPACT:** Static spectra views still do per-frame camera work and encourage continuous r3f rendering.  
   **FIX:** Move to `useLayoutEffect`/`useEffect` keyed by `size.width/height`; use r3f `frameloop="demand"` where possible.  
   **EFFORT:** S

10. **SpectraWebGL recreates highlight buffers during render**  
    **SEVERITY:** High | **CATEGORY:** bottleneck | **LOCATIONS:** `src/components/playground/visualizations/SpectraWebGL.tsx:416`, `src/components/playground/visualizations/SpectraWebGL.tsx:459`  
    **Evidence:** `const positions = new Float32Array(line.pointCount * 3);` inside `HighlightedLines` and `HoveredLine`.  
    **IMPACT:** Selection/hover creates GC pressure and GPU buffer churn.  
    **FIX:** Reuse buffer attributes via refs; update one hover/highlight buffer imperatively, or encode highlight state in shader attributes.  
    **EFFORT:** M

11. **SpectraChartV2 Recharts path creates huge object matrices and many `<Line>` nodes**  
    **SEVERITY:** High | **CATEGORY:** bottleneck | **LOCATIONS:** `src/components/playground/visualizations/SpectraChartV2.tsx:410`, `src/components/playground/visualizations/SpectraChartV2.tsx:420`, `src/components/playground/visualizations/SpectraChartV2.tsx:1467`, `src/components/playground/visualizations/SpectraChartV2.tsx:1489`  
    **Evidence:** `wavelengths.map(...)` builds `p${displayIdx}` / `o${displayIdx}` fields, then `displayIndices.map(...)` renders many `<Line>` elements.  
    **IMPACT:** Non-WebGL spectra mode can allocate `wavelengths × samples` properties and thousands of React/SVG elements.  
    **FIX:** Hard-cap Recharts individual lines; default to WebGL/aggregation above threshold; build Recharts data only for small datasets.  
    **EFFORT:** M

12. **Spectra difference/stat computations are UI-thread O(samples × wavelengths)**  
    **SEVERITY:** High | **CATEGORY:** bottleneck | **LOCATIONS:** `src/components/playground/visualizations/SpectraChartV2.tsx:220`, `src/components/playground/visualizations/SpectraChartV2.tsx:225`, `src/components/playground/visualizations/SpectraChartV2.tsx:716`  
    **Evidence:** `processed.spectra.map(... proc.map(...))`; y-domain scans every value with nested loops.  
    **IMPACT:** Toggling difference/ROI/view mode blocks the renderer on large spectra.  
    **FIX:** Cache derived spectra/stats by `{datasetId,pipelineHash,viewMode,roi}` or move to Web Worker/backend.  
    **EFFORT:** M

13. **YHistogramV2 recomputes render-local stacked data**  
    **SEVERITY:** High | **CATEGORY:** bottleneck | **LOCATIONS:** `src/components/playground/visualizations/YHistogramV2.tsx:980`, `src/components/playground/visualizations/YHistogramV2.tsx:1214`, `src/components/playground/visualizations/YHistogramV2.tsx:1444`, `src/components/playground/visualizations/YHistogramV2.tsx:1899`  
    **Evidence:** `const stackedData = histogramData.map(...)` inside render helpers; KDE merge loops `for (const kp of kdeData)`.  
    **IMPACT:** Selection/filter/hover-driven rerenders redo histogram transformations and allocate arrays repeatedly.  
    **FIX:** Hoist transformed datasets into `useMemo`; pre-index KDE points; compute only for the active histogram mode.  
    **EFFORT:** M

14. **Large-array spread min/max risks crashes and allocations**  
    **SEVERITY:** Medium | **CATEGORY:** quality | **LOCATIONS:** `src/components/playground/visualizations/YHistogramV2.tsx:351`, `src/components/playground/visualizations/FoldDistributionChartV2.tsx:690`  
    **Evidence:** `Math.min(...values)`, `Math.max(...y)`.  
    **IMPACT:** Large datasets can hit maximum call-stack/argument limits and allocate huge argument lists.  
    **FIX:** Use a shared loop-based `minMax()` helper across charts.  
    **EFFORT:** S

15. **Embedding chart duplicates metadata per point and updates React state on every pointer move**  
    **SEVERITY:** Medium | **CATEGORY:** bottleneck | **LOCATIONS:** `src/components/playground/visualizations/DimensionReductionChart.tsx:370`, `src/components/playground/visualizations/DimensionReductionChart.tsx:1446`, `src/components/playground/visualizations/DimensionReductionChart.tsx:1463`  
    **Evidence:** `point.metadata = {}; for (const [key, values] of Object.entries(metadata)) ...`; `setMousePos(...)`; `chartData.find(...)`.  
    **IMPACT:** Large PCA/UMAP data duplicates columnar metadata into point objects and rerenders tooltip state per mouse event.  
    **FIX:** Keep metadata columnar; use `dataByIndex` map; store mouse position in a ref/rAF loop or renderer-managed tooltip.  
    **EFFORT:** M

16. **Charts subscribe to SelectionContext even when `useSelectionContext` is false**  
    **SEVERITY:** Medium | **CATEGORY:** bottleneck | **LOCATIONS:** `src/components/playground/visualizations/DimensionReductionChart.tsx:266`, `src/components/playground/visualizations/YHistogramV2.tsx:284`, `src/components/playground/visualizations/scatter/ScatterRegl2D.tsx:210`, `src/components/playground/visualizations/scatter/ScatterPureWebGL2D.tsx:368`  
    **Evidence:** `const selectionHook = useSelection(); const selectionCtx = useSelectionContext ? selectionHook : null;`  
    **IMPACT:** Manual/embedded chart modes still subscribe to broad selection updates and can throw outside the provider.  
    **FIX:** Use optional context reads or split context dispatch/state; only subscribe when enabled.  
    **EFFORT:** S

17. **MainCanvas prop churn defeats `React.memo` chart wrappers**  
    **SEVERITY:** Medium | **CATEGORY:** bottleneck | **LOCATIONS:** `src/components/playground/MainCanvas.tsx:700`, `src/components/playground/MainCanvas.tsx:747`, `src/components/playground/MainCanvas.tsx:947`, `src/components/playground/visualizations/SpectraChartV2.tsx:1617`  
    **Evidence:** `outlierIndices={lastOutlierResult ? new Set(...) : undefined}` while charts export `React.memo(...)`.  
    **IMPACT:** Memoized charts still receive fresh object/Set props and rerender.  
    **FIX:** Pass the existing memoized `outlierIndicesSet`; split stable color data from selection overlays; avoid new Sets in JSX.  
    **EFFORT:** S

18. **Global active-run polling and WebSocket state cause app-wide churn**  
    **SEVERITY:** Medium | **CATEGORY:** bottleneck | **LOCATIONS:** `src/context/ActiveRunContext.tsx:87`, `src/context/ActiveRunContext.tsx:90`, `src/context/ActiveRunContext.tsx:197`, `src/context/ActiveRunContext.tsx:288`, `src/main.tsx:45`  
    **Evidence:** `refetchInterval: 3000`; `connectToRun` depends on `wsConnections`; provider value is a fresh object.  
    **IMPACT:** App-level provider polls and mutates maps while the user is in unrelated screens, including slow playground views.  
    **FIX:** Store sockets in refs; memoize provider value; poll only when widget is visible or active runs exist; prefer one realtime path.  
    **EFFORT:** M

19. **RunProgress duplicates polling with WebSocket invalidation**  
    **SEVERITY:** Medium | **CATEGORY:** bottleneck | **LOCATIONS:** `src/pages/RunProgress.tsx:702`, `src/pages/RunProgress.tsx:715`  
    **Evidence:** Active runs poll every `1000` ms, and WebSocket messages also call `queryClient.invalidateQueries(...)`.  
    **IMPACT:** Active runs can trigger redundant backend requests during already noisy training/progress updates.  
    **FIX:** Let WebSocket drive progress; keep polling as fallback after disconnect or at a slower heartbeat.  
    **EFFORT:** S

20. **Electron router detection is inconsistent with API detection**  
    **SEVERITY:** Medium | **CATEGORY:** quality | **LOCATIONS:** `src/main.tsx:6`, `src/api/client.ts:21`, `electron/main.ts:60`  
    **Evidence:** Router uses only `window.electronApi !== undefined`; API also checks `window.location.protocol === "file:"`; Electron production uses `window.loadFile(indexPath)`.  
    **IMPACT:** If preload is late/unavailable at initial render, Electron can choose `BrowserRouter` under `file://`, breaking routes/reloads.  
    **FIX:** Centralize `isElectronEnvironment()` and use the same `file:` fallback for router, API, websocket, and file dialogs.  
    **EFFORT:** S

21. **API base-url configuration is declared but ignored**  
    **SEVERITY:** Medium | **CATEGORY:** tech-debt | **LOCATIONS:** `src/vite-env.d.ts:11`, `src/api/client.ts:10`, `src/api/client.ts:83`, `src/api/client.ts:93`, `vite.config.ts:26`  
    **Evidence:** `VITE_API_URL` exists, but web mode always sets `resolvedBackendUrl = DEFAULT_API_BASE_URL`; Electron failure falls back to `/api`.  
    **IMPACT:** Non-proxied web deployments cannot configure API URL; Electron backend-resolution failure silently becomes bad `/api` calls.  
    **FIX:** Honor `import.meta.env.VITE_API_URL` in web mode; in Electron, surface a clear backend-unavailable error or retry instead of falling back to `/api`.  
    **EFFORT:** S

22. **`src/api/client.ts` is a leaky 2k-line god file**  
    **SEVERITY:** Medium | **CATEGORY:** tech-debt | **LOCATIONS:** `src/api/client.ts:127`, `src/api/client.ts:232`, `src/api/client.ts:256`, `src/api/client.ts:548`  
    **Evidence:** Same file defines transport `class ApiClient`, compatibility `class AxiosLikeClient`, all domain endpoints, and direct `fetch(...)` upload paths.  
    **IMPACT:** Cache/query fixes and endpoint changes have high conflict risk; transport concerns leak around the wrapper.  
    **FIX:** Split `transport`, `runtimeBaseUrl`, and domain modules (`datasets`, `runs`, `pipelines`, `settings`); keep direct upload fetch behind the same error/diagnostic layer.  
    **EFFORT:** L

23. **Playground session provider appears unused while manual restore duplicates it**  
    **SEVERITY:** Medium | **CATEGORY:** dead-code | **LOCATIONS:** `src/pages/Playground.tsx:24`, `src/context/PlaygroundSessionContext.tsx:143`, `src/pages/Playground.tsx:348`  
    **Evidence:** `PlaygroundSessionProvider` and `usePlaygroundSession` are imported, but grep only finds the provider definition; restore uses `setTimeout(() => session.operators.forEach(...))`.  
    **IMPACT:** Dead/duplicated session paths make restore behavior harder to reason about and contribute to unbatched operator/cache churn.  
    **FIX:** Either wire the provider into `Playground` or delete it; replace delayed per-operator restore with one batched state update.  
    **EFFORT:** M

24. **3D fallback uses individual meshes and global `any` reset hook**  
    **SEVERITY:** Medium | **CATEGORY:** quality | **LOCATIONS:** `src/components/playground/visualizations/ScatterPlot3D.tsx:271`, `src/components/playground/visualizations/ScatterPlot3D.tsx:460`, `src/components/playground/visualizations/ScatterPlot3D.tsx:473`  
    **Evidence:** `const maxPoints = Math.min(normalized.length, 500)`; `const controlsRef = useRef<any>(null)`; `(window as any).__scatter3d_reset = handleReset`.  
    **IMPACT:** 3D view silently drops points beyond 500 and the global reset hook breaks with multiple chart instances.  
    **FIX:** Use real `InstancedMesh`/buffered points; expose reset via `forwardRef/useImperativeHandle`; type controls as OrbitControls.  
    **EFFORT:** M

25. **Production console noise is widespread**  
    **SEVERITY:** Low | **CATEGORY:** quality | **LOCATIONS:** `src/api/client.ts:74`, `src/api/client.ts:81`, `src/components/playground/visualizations/DimensionReductionChart.tsx:356`, `src/hooks/usePlaygroundPipeline.ts:47`  
    **Evidence:** 185 `console.log/debug/warn/error` calls in `src`; examples include `[API Client] Using Electron backend URL` and per-invalid-point warnings.  
    **IMPACT:** Slower noisy renders, leaked runtime details, and harder debugging in production.  
    **FIX:** Add a small logger gated by `import.meta.env.DEV` or diagnostics consent; aggregate repeated chart warnings.  
    **EFFORT:** S