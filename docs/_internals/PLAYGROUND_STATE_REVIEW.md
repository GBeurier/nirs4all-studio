# Playground State Review

**Date**: January 2026
**Author**: Greg (Senior Full-Stack Developer)
**Status**: Final

**Related Documents**:
- [nirs4all Backend Capabilities](./NIRS4ALL_BACKEND_CAPABILITIES.md)
- [Playground Specifications](./PLAYGROUND_SPECIFICATIONS.md)
- [Implementation Roadmap](./PLAYGROUND_IMPLEMENTATION_ROADMAP.md)

---

## 1. Executive Summary

The Playground is currently a **functional prototype** enabling users to:
- Load spectral data (CSV or synthetic demo)
- Build simple preprocessing pipelines (single branch, no models)
- Visualize before/after effects with 5 chart types

**Key finding**: Processing happens **entirely in the frontend** using JavaScript implementations. This creates:
1. **Fidelity gap**: JS operators ≠ nirs4all operators (different algorithms)
2. **Maintenance burden**: Two codebases for same operators
3. **Scalability limit**: Large datasets freeze UI
4. **Missing splitter support**: No way to visualize cross-validation strategies

**Recommendation**: Move to backend-driven architecture using nirs4all's **StepRunner + StepParser** infrastructure (not direct sklearn calls) to support both preprocessing and splitting operators.

---

## 2. Current Architecture

### 2.1 Component Structure

```
src/pages/Playground.tsx          # Main page coordinator
src/components/playground/
├── PlaygroundSidebar.tsx         # Left panel: data loading + pipeline builder
├── MainCanvas.tsx                # Central visualization area
├── DataUpload.tsx                # File upload & demo data
├── OperatorPalette.tsx           # Available operators grid
├── PipelineBuilder.tsx           # Active pipeline steps list
├── OperatorCard.tsx              # Single operator configuration
├── ColorModeSelector.tsx         # Coloring options (target/dataset/metadata)
├── SampleDetails.tsx             # Selected sample info panel
└── visualizations/
    ├── SpectraChart.tsx          # Line chart with before/after
    ├── YHistogram.tsx            # Target distribution
    ├── PCAPlot.tsx               # 2D dimensionality view
    ├── DifferenceScatterPlot.tsx # Repetition differences
    └── FoldBoxPlots.tsx          # Fold distribution (placeholder)
```

### 2.2 State Management

| Hook | Responsibility |
|------|----------------|
| `useSpectralData` | Loads/parses CSV, generates demo data, manages raw state |
| `usePipeline` | Pipeline operations, undo/redo history, **processes data** |

**Data flow**:
```
rawData → [usePipeline.processedData] → MainCanvas → Visualizations
```

Processing is **synchronous** in `usePipeline.processedData` via `useMemo`.

### 2.3 Frontend Processing Implementation

Location: `src/lib/preprocessing/operators.ts`

**Implemented operators** (11 total):
- SNV, MSC
- Savitzky-Golay, 1st/2nd Derivative, Smoothing
- Mean Center, Normalize
- Baseline, Detrend
- Wavelength Selection

**Quality**: Simplified implementations. Examples:
- No actual Savitzky-Golay polynomial fitting (uses moving average)
- ALS baseline falls back to linear
- No matching with nirs4all operator signatures

---

## 3. Pipeline Editor Comparison

### 3.1 Pipeline Editor Architecture

The Pipeline Editor is a **mature, production-ready** component:

| Feature | Pipeline Editor | Playground |
|---------|-----------------|------------|
| Pipeline format | Full nirs4all syntax | Simplified subset |
| Operators | All nirs4all operators via registry | 11 hardcoded |
| **Splitters** | Yes (KFold, SPXY, etc.) | **No** |
| Branching | Yes (multi-branch, generators) | No |
| Models | Yes | No |
| Y-processing | Yes | No |
| Backend integration | Yes (validation, variant count) | No |
| Step config | Rich parameter panels | Basic sliders |
| DnD | Tree-based, sophisticated | Simple reorder |
| Persistence | localStorage with ID | None |

### 3.2 Shared Concepts

Both use:
- Operator types (preprocessing, splitting, model)
- Step-based pipeline representation
- Enable/disable toggle per step
- Parameter configuration

### 3.3 Compatibility Gap

**Pipeline Editor step format**:
```typescript
interface PipelineStep {
  id: string;
  type: "preprocessing" | "splitting" | "model" | "branch" | ...;
  name: string;  // e.g., "StandardNormalVariate"
  params: Record<string, unknown>;
  branches?: PipelineStep[][];
  paramSweeps?: Record<string, SweepConfig>;
  // ...
}
```

**Playground operator format**:
```typescript
interface PipelineOperator<T extends OperatorType> {
  id: string;
  type: T;  // 'snv' | 'msc' | 'savgol' | ...
  params: OperatorParams[T];
  enabled: boolean;
  name: string;  // Display name
  target: OperatorTarget;
}
```

**Differences**:
- Operator naming convention (camelCase vs PascalCase)
- Operator type enum (limited vs extensible)
- No branch/generator support in Playground
- No y_processing distinction in Playground

---

## 4. Visualization Analysis

### 4.1 Current Visualizations

| Chart | Purpose | Library | Performance Concern |
|-------|---------|---------|---------------------|
| SpectraChart | Before/after spectra | Recharts | ❌ Slow with >100 samples |
| YHistogram | Target distribution | Recharts | ✓ OK |
| PCAPlot | 2D dimensionality | Recharts | ⚠️ Frontend PCA |
| DifferenceScatterPlot | Repetition analysis | Recharts | ⚠️ Niche use case |
| FoldBoxPlots | Fold distribution | Recharts | ⚠️ **No fold data (splitters not supported)** |

### 4.2 Performance Characteristics

- **Subset modes**: Random, quantiles, k-means sampling
- **Max samples**: Capped at 30-50 for reasonable performance
- **Chart responsiveness**: Good <30 samples, degrades after
- **PCA**: Frontend implementation with SVD.js (CPU-bound)

### 4.3 Missing Visualizations

For a complete exploratory tool:
- **Fold distribution chart** (train/test split per fold, Y distribution per fold)
- Correlation heatmap (feature vs feature)
- Statistics summary panel (mean, std, range per wavelength)
- Outlier detection overlay
- Spectral range selector (interactive crop)

---

## 5. Backend API Analysis

### 5.1 Existing Preprocessing API

The webapp already has `api/preprocessing.py` with:
- `POST /preprocessing/apply` - Apply chain to data array
- `POST /preprocessing/preview` - Preview on dataset subset
- `POST /preprocessing/validate` - Validate chain configuration
- `GET /preprocessing/methods` - List available methods

**Gap**: These endpoints exist but playground doesn't use them.

### 5.2 API Limitations for Real-Time Use

| Requirement | Current API | Gap |
|-------------|-------------|-----|
| Sub-100ms latency | HTTP POST | ⚠️ Overhead per request |
| Streaming large data | JSON response | ❌ Full payload each time |
| Cache intermediate | No caching | ❌ Recompute from scratch |
| Debounce/cancel | No support | ❌ Request queuing |

**Recommendation**: Add WebSocket endpoint or optimize HTTP with caching.

---

## 6. Identified Issues

### 5.1 Critical

1. **No backend integration**: All processing is JS-based, not nirs4all
2. **Operator mismatch**: Frontend operators ≠ nirs4all operators
3. **No splitter support**: Cannot visualize cross-validation strategies
4. **No data persistence**: Pipeline/data lost on refresh
5. **Performance ceiling**: Large datasets cause UI freezes

### 5.2 Major

1. **Limited operator set**: Only 11 of 30+ available operators
2. **No parameter validation**: Invalid params not caught
3. **No pipeline export**: Can't use playground config in training
4. **Recharts limitations**: Not designed for scientific visualization

### 5.3 Minor

1. **Inconsistent naming**: `snv` vs `StandardNormalVariate`
2. **Missing error states**: Silent failures on edge cases
3. **No loading indicators**: Processing appears instant/broken
4. **Hardcoded demo data**: No realistic dataset options

---

## 6. Recommendations

### 6.1 Architecture

1. **Use nirs4all pipeline infrastructure**: StepRunner + StepParser for unified operator handling
2. **Support splitters**: CrossValidatorController generates fold assignments
3. **Unify operator format**: Align with Pipeline Editor format (preprocessing + splitting)
4. **Shared service layer**: PlaygroundExecutor should be shared with preprocessing API to avoid duplication
5. **Backend caching**: LRU cache with TTL keyed by (data fingerprint + pipeline hash + options)
6. **Consider WebGL charts**: ECharts or deck.gl for performance if Recharts proves too slow

### 6.2 Integration

1. **Shared operator registry**: Single source of truth for operators
2. **Pipeline format conversion**: Playground ↔ Pipeline Editor (bidirectional)
3. **Import from Editor**: Load editor pipelines into playground (filter unsupported features)
4. **Export to Editor**: Promote validated playground configs
5. **Shared step conversion**: Single `convert_frontend_step()` function used by both endpoints

### 6.3 Performance

1. **Stable React Query keys**: Use hashes, not object identity
2. **Slider debounce strategy**: Use `onValueCommit` instead of `onChange` for sliders
3. **keepPreviousData**: Keep old charts visible while new request loads
4. **Payload controls**: Options for `max_wavelengths_returned`, `max_folds_returned`
5. **Subset-first architecture**: Determine sample indices before processing, avoid full copies

### 6.4 UX

1. **Progressive loading**: Show skeleton while processing
2. **Debounced updates**: Don't recalculate on every slider move
3. **Data sampling strategy**: Smart subset selection backend
4. **Presets**: Common preprocessing combinations

---

## 8. Conclusion

The Playground has a solid UI foundation but requires significant refactoring to deliver a professional real-time analysis tool. The main gaps are:

1. **Backend integration**: Use nirs4all's StepRunner + StepParser (not direct sklearn) for accuracy and extensibility
2. **Splitter support**: Add splitters to pipeline with fold visualization
3. **Format alignment**: Unify with Pipeline Editor's operator format
4. **Performance**: WebSocket or optimized API for real-time updates

**Key architectural decision**: Use **StepRunner** instead of direct sklearn calls:
- Automatic controller routing for transforms and splitters
- Compatibility with all nirs4all operators
- Fold management via CrossValidatorController
- Consistent behavior with training pipelines

**Estimated effort for V1**: 3.5 weeks (see Roadmap document).

---

## Appendix: File References

| File | Lines | Purpose |
|------|-------|---------|
| `src/pages/Playground.tsx` | 52 | Page orchestrator |
| `src/hooks/useSpectralData.ts` | 108 | Data loading logic |
| `src/hooks/usePipeline.ts` | 104 | Pipeline + processing |
| `src/lib/preprocessing/operators.ts` | 290 | Frontend operators |
| `src/components/playground/MainCanvas.tsx` | 125 | Visualization grid |
| `api/preprocessing.py` | 650 | Backend API (unused) |
