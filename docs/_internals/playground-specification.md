# NIR Playground Advanced Specification

**Version:** 2.0
**Status:** Draft
**Author:** Steve Cromwell, Senior Frontend Developer
**Date:** January 2026

---

## Executive Summary

The Playground is an interactive exploration environment for testing preprocessing, splitting, filtering, and augmentation pipelines before committing to full model training. Its core value proposition is **real-time visual comparison** between source data and transformed data across multiple synchronized views.

This specification defines a comprehensive upgrade from the current V1 Playground to a fully-featured V2 that delivers:
- **5 core visualization charts** with cross-chart selection synchronization
- **Advanced spectrum subset selection** with 11 distinct selection/filtering modes
- **Intelligent rendering** with automatic aggregation and WebGL optimization
- **Complete operator coverage** including filters (new)
- **Rich export capabilities** for charts and data

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Visualization Area](#2-visualization-area)
3. [Pipeline Editor Panel](#3-pipeline-editor-panel)
4. [Cross-Chart Selection System](#4-cross-chart-selection-system)
5. [Spectra Chart Specification](#5-spectra-chart-specification)
6. [Target Histogram Chart](#6-target-histogram-chart)
7. [PCA/UMAP Chart](#7-pcaumap-chart)
8. [Folds Distribution Chart](#8-folds-distribution-chart)
9. [Repetitions Chart](#9-repetitions-chart)
10. [Spectral Metrics System](#10-spectral-metrics-system)
11. [Performance & Rendering Strategy](#11-performance--rendering-strategy)
12. [Export System](#12-export-system)
13. [Additional View Proposals](#13-additional-view-proposals)
14. [Error-Driven Selection (Predictions Mode)](#14-error-driven-selection-predictions-mode)
15. [Accessibility & Internationalization](#15-accessibility--internationalization)

---

## 1. Architecture Overview

### 1.1 Component Hierarchy

```
Playground
├── PlaygroundSidebar (Left Panel)
│   ├── DatasetSelector
│   ├── OperatorPalette
│   │   ├── PreprocessingMenu
│   │   ├── AugmentationMenu
│   │   ├── SplittingMenu
│   │   └── FilteringMenu (NEW)
│   └── PipelineBuilder
│       ├── SourceDatasetSelector (NEW)
│       └── OperatorSequence
├── VisualizationArea (Center)
│   ├── ChartToolbar
│   │   ├── ChartVisibilityToggles
│   │   ├── GlobalColorModeSelector
│   │   ├── PartitionSelector
│   │   └── RenderModeToggle (Canvas/WebGL)
│   └── ChartGrid
│       ├── SpectraChart
│       ├── TargetHistogram
│       ├── DimensionReductionChart (PCA/UMAP)
│       ├── FoldsChart
│       └── RepetitionsChart
└── SelectionStateProvider (Context)
    ├── selectedSamples: Set<number>
    ├── pinnedSamples: Set<number>
    ├── savedSelections: Map<string, Selection>
    └── selectionHistory: Selection[]
```

### 1.2 Data Flow

```
RawData (SpectroDataset)
    ↓
[Source Dataset Selection] ← User can choose raw or intermediate step
    ↓
[Pipeline Execution (Backend)] ← OPTIONAL: can be empty
    ↓
ProcessedData + FoldInfo + PCA + Statistics
    ↓
[Chart Components] ← Synchronized via SelectionStateProvider
```

### 1.3 Raw Data Mode

**The Playground MUST work with raw data only, without any pipeline operators.**

When no operators are added:
- All charts display the raw dataset directly
- PCA/UMAP is computed on raw features
- Y Histogram shows raw target distribution
- Folds chart shows "No splitter defined" placeholder
- Repetitions chart shows data if metadata exists, else placeholder
- All selection and export features remain fully functional

**UI Behavior:**
- Empty pipeline shows: "Visualizing raw data. Add operators to see transformations."
- Step slider is hidden when pipeline is empty
- Comparison mode is disabled (nothing to compare)

### 1.4 State Management

The Playground manages three categories of state:

| Category | Scope | Persistence |
|----------|-------|-------------|
| Pipeline State | Operators, order, params | SessionStorage |
| Selection State | Selected samples, pinned, saved | SessionStorage |
| View State | Visible charts, zoom, axis choices | SessionStorage |
| Data State | Raw/processed data | Memory only (reload on change) |

---

## 2. Visualization Area

### 2.1 Chart Grid

The visualization area displays a configurable grid of up to 5 charts (extensible). Charts can be:
- **Shown/Hidden** via toggle buttons
- **Resized** within the grid (future: drag-to-resize)
- **Maximized** to full canvas (double-click header)

**Grid Layout Rules:**
| Active Charts | Layout |
|---------------|--------|
| 1 | 1×1 full width |
| 2 | 1×2 side-by-side |
| 3-4 | 2×2 grid |
| 5-6 | 2×3 grid |

### 2.2 Chart Toolbar

The global toolbar provides controls that affect all charts:

| Control | Options | Description |
|---------|---------|-------------|
| Show/Hide | Per-chart toggles | Enable/disable charts in grid |
| Color Mode | target, fold, metadata, metric | Global coloring scheme |
| Partition Filter | train, test, train/test, folds, all | Filter visible samples |
| Render Mode | Canvas, WebGL | Performance vs. quality trade-off |
| Export All | PNG, SVG, JSON | Batch export all visible charts |

### 2.3 Common Chart Features

Every chart provides:

| Feature | Description |
|---------|-------------|
| Color Configuration | Theme-aware palette customization |
| PNG Export | Export rendered chart as image |
| SVG Export | Export as vector (where supported) |
| Data Export | Export underlying data (nirs4all formats) |
| Selection Tools | Lasso, box, click, shift+click |
| Zoom/Pan | Standard navigation (chart-specific) |
| Partition Visibility | Toggle train/test/fold visibility |
| Loading States | Skeleton + spinner during updates |

---

## 3. Pipeline Editor Panel

### 3.1 Dataset Source Selector (NEW)

The pipeline now supports selecting a **source dataset** for comparison:

| Source Option | Description |
|---------------|-------------|
| Raw | Original unprocessed spectra (default) |
| Step N | Output after step N in pipeline |

This enables comparisons like:
- Raw vs. SNV (default)
- SNV vs. SNV > SavGol > Haar (intermediate comparison)

### 3.2 Operator Categories

| Category | Type | Examples |
|----------|------|----------|
| Preprocessing | Transformation | SNV, MSC, Detrend, SavGol, Derivatives |
| Augmentation | Transformation | GaussianNoise, SpectrumShift, Mixup |
| Splitting | Cross-validation | KFold, SPXY, Kennard-Stone, GroupKFold |
| **Filtering** (NEW) | Sample removal | OutlierRemoval, RangeFilter, QCFilter |

### 3.3 Operator Configuration

Each operator card displays:
- **Name** and **icon**
- **Enabled/disabled** toggle
- **Parameter editor** (expandable)
- **Drag handle** for reordering
- **Delete** button
- **Status indicator** (success/error from last execution)

---

## 4. Cross-Chart Selection System

### 4.1 Selection Philosophy

Selections are **sample-centric**: selecting samples in any chart highlights those same samples across all charts. This enables multi-perspective exploration of subsets.

### 4.2 Selection Actions

| Action | Behavior |
|--------|----------|
| Click | Select single sample (replace) |
| Shift+Click | Add to selection |
| Ctrl+Click | Toggle in selection |
| Lasso | Select all samples in region |
| Box | Select all samples in rectangle |
| Double-click | Clear selection |

### 4.3 Selection Visualization

| Chart | Selection Display |
|-------|-------------------|
| Spectra | Highlighted lines (thicker, brighter) |
| Histogram | Highlighted bars (overlay color) |
| PCA/UMAP | Highlighted points (larger, outlined) |
| Folds | Highlighted bar segments |
| Repetitions | Highlighted markers |

### 4.4 Selection State

```typescript
interface SelectionState {
  // Current working selection
  selectedSamples: Set<number>;

  // Pinned samples (always visible regardless of filters)
  pinnedSamples: Set<number>;

  // Named saved selections
  savedSelections: Map<string, SavedSelection>;

  // Undo/redo history
  history: SelectionHistoryEntry[];
  historyIndex: number;
}

interface SavedSelection {
  id: string;
  name: string;
  description?: string;
  criteria: SelectionCriteria;  // How it was created
  sampleIndices: number[];       // Resulting samples
  createdAt: Date;
}
```

### 4.5 Selection Modes

After selection, users can:
- **Filter to selection**: Show only selected samples
- **Invert selection**: Select everything except current
- **Pin selection**: Lock samples as reference (always visible)
- **Save selection**: Name and store for later recall
- **Clear selection**: Return to showing all samples

---

## 5. Spectra Chart Specification

### 5.1 Display Modes

| Mode | Description |
|------|-------------|
| Processed Only | Show final pipeline output |
| Original Only | Show source dataset |
| Both (Overlay) | Show both with visual differentiation |

**Overlay Styling Options:**
- Original: reduced opacity (0.3)
- Original: dashed lines
- Original: desaturated colors
- User preference stored in settings

### 5.2 Spectrum Subset Selection System

This is the core innovation of V2 Spectra Chart. Users have 11 distinct methods to select which spectra to display:

#### 5.2.1 Selection via Embedding (PCA/UMAP)

A mini scatter plot overlay allows:
- Lasso/box selection in embedding space
- Color by metadata or target
- Toggle between raw and processed embedding basis
- Sync with main PCA chart selection

#### 5.2.2 Sampling Strategies

| Strategy | Description | Use Case |
|----------|-------------|----------|
| Random | Uniform random selection | Quick overview |
| Stratified | Preserve target/metadata distribution | Representative sample |
| Coverage (Maximin) | Maximize feature space coverage | Diversity exploration |
| Progressive | Level-of-detail (50→200→1000) | Performance scaling |

#### 5.2.3 Metadata Filters

| Filter | Options |
|--------|---------|
| Split/Fold | train, val, test, fold_k, OOF |
| Metadata Fields | instrument, batch, site, date, variety... |
| Target Range | [y_min, y_max] or quantile selection |
| QC Status | accepted, rejected, missing_y, flagged |
| Pipeline Context | raw, preprocessed, branch_id |

#### 5.2.4 Spectral Descriptor Filters

Fast precomputed filters based on per-spectrum metrics:

| Metric | Description |
|--------|-------------|
| Amplitude | Global min/max thresholds |
| Dynamic Range | max - min |
| L2 Norm / RMS | Energy content |
| AUC | Area under curve |
| Baseline Slope | Drift indicator |
| Baseline Offset | DC shift |
| HF Variance | Noise proxy |
| SNR | Signal-to-noise estimate |
| NaN/Inf Count | Data integrity |
| Saturation Count | Clipped values |
| Similarity to Reference | Distance to median/selected spectrum |

#### 5.2.5 Outlier Selection

| Method | Description |
|--------|-------------|
| Hotelling's T² | Outliers in PCA space |
| Q-Residual / SPE | Reconstruction error outliers |
| Distance to Centroid | Simple Euclidean outliers |
| LOF Score | Local outlier factor |
| Per-Group Outliers | Outliers within each batch/group |

#### 5.2.6 Comparison-Oriented Selection

| Mode | Description |
|------|-------------|
| Same Sample Across Preprocessings | Compare raw vs. processed for same samples |
| Pipeline A vs B | Compare two branches on same sample IDs |
| Difference Visualization | Show (processed − raw) curves |

### 5.3 Aggregation Modes

When selection is large (>threshold), automatically switch to aggregated views:

| Mode | Display |
|------|---------|
| Quantile Bands | Median + p10-p90 band (configurable) |
| Mean ± Std | Mean curve with std envelope |
| Min/Max Envelope | Extreme value bounds |
| Grouped Aggregates | Per-group mean curves |
| 2D Density Map | Heatmap (wavelength × intensity) |

### 5.4 Wavelength Focus

| Feature | Description |
|---------|-------------|
| Range Slider | Select wavelength window |
| ROI Presets | Predefined NIR regions |
| Edge Masking | Hide noisy instrument edges |
| Derivative View | 1st/2nd derivative within range |

### 5.5 Performance Controls

| Control | Description |
|---------|-------------|
| Hard Cap | Maximum individual lines (default: 200) |
| "Show More" | Manual override to increase limit |
| Auto-Aggregate | Switch to bands when >threshold |
| Render Priority | Pinned → Selected → Recent → Rest |

---

## 6. Target Histogram Chart

### 6.1 Basic Features

| Feature | Description |
|---------|-------------|
| Bin Count | Adjustable (auto, 10, 20, 50, custom) |
| Selection | Click/shift-click bars to select samples |
| Highlight | Show selected samples as overlay |

### 6.2 Coloring Modes

| Mode | Description |
|------|-------------|
| Uniform | Single color for all bars |
| By Metadata | Color bars by metadata value |
| By Spectral Metric | Color by PCA component, UMAP dim, distance... |

### 6.3 Partition Display Modes

When folds are present:

| Mode | Description |
|------|-------------|
| Stacked | Folds stacked within each bin |
| Overlaid + Transparency | All folds visible with alpha blending |
| Ridge Plot | Vertically offset distributions per fold |

### 6.4 Extended Options

| Option | Description |
|--------|-------------|
| Y-axis | Count, Frequency, Density |
| Show Mean/Median | Vertical reference lines |
| KDE Overlay | Smooth density estimate |
| Comparison Mode | Source vs. processed Y (if transformed) |

---

## 7. PCA/UMAP Chart

### 7.1 Core Requirements

| Requirement | Description |
|-------------|-------------|
| Aspect Ratio | Always 1:1 (square) to preserve distances |
| Methods | PCA (99.9% variance) or UMAP |
| Dimensions | 2D scatter or 3D (Three.js) |

### 7.2 Axis Configuration

| Control | Options |
|---------|---------|
| X-Axis | PC1, PC2, PC3... or UMAP1, UMAP2 |
| Y-Axis | PC1, PC2, PC3... or UMAP1, UMAP2 |
| Z-Axis (3D) | Any component |

### 7.3 Coloring Options

| Mode | Description |
|------|-------------|
| By Target (y) | Continuous colormap |
| By Fold | Discrete fold colors |
| By Metadata Column | Categorical or continuous |
| By Spectral Metric | Norm, slope, SNR, etc. |

### 7.4 Selection Tools

| Tool | Behavior |
|------|----------|
| Click | Select single point |
| Lasso | Freeform region selection |
| Box | Rectangular selection |
| 3D Orbit | Rotate view (3D mode) |

### 7.5 Information Display

| Element | Content |
|---------|---------|
| Axis Labels | PC1 (45.2%), PC2 (23.1%) |
| Tooltip | Sample ID, coordinates, y value, fold |
| Legend | Fold colors or colorbar for continuous |

---

## 8. Folds Distribution Chart

### 8.1 Purpose

Visualize partition proportions as stacked or grouped bar charts.

### 8.2 Default Display

| Scenario | Display |
|----------|---------|
| No splitter | Disabled/hidden |
| Train/Test only | 2 bars: train, test |
| K-Fold | K+1 bars: test, fold1_train, fold1_val, ... |

### 8.3 Coloring Options

| Mode | Description |
|------|-------------|
| By Partition | Train=blue, Val=green, Test=red |
| By Target Mean | Color intensity by mean y of partition |
| By Metadata | Color by dominant metadata value |
| By Spectral Metric | Average metric per partition |

### 8.4 Interaction

| Action | Effect |
|--------|--------|
| Click bar | Select all samples in that partition |
| Hover | Show partition statistics |

---

## 9. Repetitions Chart

### 9.1 Purpose

Visualize intra-sample variability when multiple measurements exist per biological sample.

### 9.2 Data Model

```typescript
interface RepetitionData {
  biologicalSampleId: string;  // Unique bio sample
  measurementIndices: number[]; // All spectra from this sample
  referenceIndex?: number;       // Which measurement is reference
}
```

### 9.3 Display Modes

| Mode | Condition | Behavior |
|------|-----------|----------|
| Pairwise | n_reps = 2 | One rep is zero, show distance of other |
| Mean-Centered | n_reps > 2 | Mean is zero, show distances from mean |

### 9.4 Axes

| Axis | Content |
|------|---------|
| X | Biological sample ID (1, 2, 3...) |
| Y | Distance from reference in chosen metric |

### 9.5 Distance Metrics

| Metric | Description |
|--------|-------------|
| PCA Distance | Euclidean in PC1-PC3 space |
| UMAP Distance | Euclidean in UMAP space |
| Spectral Euclidean | L2 norm of spectral difference |
| Spectral Correlation | 1 - correlation coefficient |
| Mahalanobis | Considering covariance structure |

### 9.6 Coloring

Same options as other charts: target, metadata, metrics.

### 9.7 Selection

Clicking a point (or group) selects all repetitions for that biological sample across all charts.

---

## 10. Spectral Metrics System

### 10.1 Overview

A unified system for computing and caching per-sample spectral descriptors used across filtering, coloring, and analysis.

### 10.2 Metric Categories

#### 10.2.1 Amplitude Metrics
| Metric | Formula | Description |
|--------|---------|-------------|
| `global_min` | min(spectrum) | Minimum intensity |
| `global_max` | max(spectrum) | Maximum intensity |
| `dynamic_range` | max - min | Intensity span |
| `mean_intensity` | mean(spectrum) | Average intensity |

#### 10.2.2 Energy Metrics
| Metric | Formula | Description |
|--------|---------|-------------|
| `l2_norm` | √(Σx²) | Euclidean norm |
| `rms_energy` | √(mean(x²)) | Root mean square |
| `auc` | trapz(spectrum) | Area under curve |
| `abs_auc` | trapz(abs(spectrum)) | Absolute AUC |

#### 10.2.3 Shape Metrics
| Metric | Formula | Description |
|--------|---------|-------------|
| `baseline_slope` | linear_fit.slope | Global trend |
| `baseline_offset` | linear_fit.intercept | DC offset |
| `peak_count` | count(local_maxima) | Number of peaks |
| `peak_prominence_max` | max(peak_prominences) | Strongest peak |

#### 10.2.4 Noise Metrics
| Metric | Formula | Description |
|--------|---------|-------------|
| `hf_variance` | var(diff(spectrum)) | High-freq noise |
| `snr_estimate` | mean / std | Simple SNR |
| `smoothness` | 1 / hf_variance | Inverse noise |

#### 10.2.5 Quality Metrics
| Metric | Formula | Description |
|--------|---------|-------------|
| `nan_count` | count(isnan) | Missing values |
| `inf_count` | count(isinf) | Infinite values |
| `saturation_count` | count(x >= threshold) | Clipped high |
| `zero_count` | count(x == 0) | Zero values |

#### 10.2.6 Chemometric Metrics (requires PCA)
| Metric | Formula | Description |
|--------|---------|-------------|
| `hotelling_t2` | Σ(pc_i² / λ_i) | Distance in PC space |
| `q_residual` | ‖x - x̂‖² | Reconstruction error |
| `leverage` | diag(X @ (XᵀX)⁻¹ @ Xᵀ) | Sample influence |
| `distance_to_centroid` | ‖x - mean(X)‖ | Simple outlier metric |

### 10.3 Computation Strategy

| Dataset Size | Strategy |
|--------------|----------|
| < 1,000 samples | Compute all on load |
| 1,000 - 10,000 | Compute on-demand + cache |
| > 10,000 | Compute for visible subset only |

Metrics are cached in the backend and returned with the `/execute` response when requested.

---

## 11. Performance & Rendering Strategy

### 11.1 Rendering Modes

| Mode | Technology | Best For |
|------|------------|----------|
| Canvas | Recharts/D3 | < 500 lines, standard interactivity |
| WebGL | Three.js / regl | > 500 lines, smooth pan/zoom |

### 11.2 Auto-Optimization

```typescript
function selectRenderMode(n_samples: number, n_wavelengths: number): RenderMode {
  const complexity = n_samples * n_wavelengths;

  if (complexity < 100_000) return 'canvas';
  if (complexity < 1_000_000) return 'webgl_2d';
  return 'webgl_aggregated';  // Force aggregation
}
```

### 11.3 Progressive Loading

| Phase | Display | Timing |
|-------|---------|--------|
| Immediate | Skeleton + statistics summary | 0ms |
| Quick | Aggregated view (mean ± std) | <100ms |
| Full | Individual lines (if within threshold) | <500ms |

### 11.4 Debouncing Strategy

| Action | Debounce | Rationale |
|--------|----------|-----------|
| Pipeline parameter change | 300ms | Avoid cascade on slider drag |
| Brush/zoom | 150ms | Responsive but not excessive |
| Selection change | 0ms | Immediate feedback |

---

## 12. Export System

### 12.1 Chart Exports

| Format | Content | Use Case |
|--------|---------|----------|
| PNG | Rendered chart image | Quick sharing |
| SVG | Vector graphics | Publication quality |
| JSON | Chart configuration + data | Reproducibility |

### 12.2 Data Exports

| Data Type | Format | Content |
|-----------|--------|---------|
| Spectra | CSV | wavelengths × samples matrix |
| Targets | CSV | sample_id, y, metadata columns |
| PCA | CSV | sample_id, PC1, PC2, PC3, y |
| Folds | TXT | nirs4all fold format |
| Repetitions | CSV | bio_sample, rep_id, distance |

### 12.3 Pipeline Export

| Target | Format | Description |
|--------|--------|-------------|
| Pipeline Editor | JSON (internal) | Full step configuration |
| nirs4all Config | YAML | Python-executable pipeline |
| Python Script | .py | Standalone script with operators |

---

## 13. Additional View Proposals

### 13.1 Correlation Matrix View

**Purpose:** Visualize wavelength-wavelength correlations and identify redundant regions.

| Feature | Description |
|---------|-------------|
| Display | Heatmap of correlation coefficients |
| Selection | Click to highlight correlated wavelengths |
| Filtering | Show only correlations > threshold |

### 13.2 Feature Importance View (Post-Model)

**Purpose:** When predictions exist, show wavelength importance.

| Feature | Description |
|---------|-------------|
| Methods | PLS loadings, permutation importance, SHAP |
| Display | Bar chart or overlaid on spectra |
| Integration | Link to specific model from training |

### 13.3 Sample Similarity Matrix

**Purpose:** Interactive exploration of sample relationships.

| Feature | Description |
|---------|-------------|
| Display | Heatmap of pairwise distances |
| Metrics | Euclidean, Mahalanobis, spectral correlation |
| Selection | Click to select sample pairs |
| Clustering | Dendrogram overlay option |

### 13.4 Time Series View (if temporal metadata exists)

**Purpose:** Track measurements over time.

| Feature | Description |
|---------|-------------|
| X-Axis | Date/time |
| Y-Axis | Selected metric or target |
| Grouping | Color by batch/instrument |

---

---

## 14. Error-Driven Selection (Predictions Mode)

When model predictions exist (from training page or loaded predictions), the Playground enables prediction-error-driven exploration.

### 14.1 Prerequisites

| Requirement | Description |
|-------------|-------------|
| Loaded Predictions | y_pred and y_true available for samples |
| Model Reference | Link to source model/run |

### 14.2 Selection Modes

| Mode | Description |
|------|-------------|
| Top-K Errors | Select samples with largest \|y - ŷ\| |
| Error Quantiles | Select by error percentile |
| Error by Group | Identify groups with worst average error |
| High Leverage | Select high-influence samples (PLS leverage) |

### 14.3 Visualization

When predictions are available, charts gain additional features:
- **Spectra**: Option to color by prediction error
- **PCA**: Option to size points by error magnitude
- **Histogram**: Overlay predicted vs. actual distributions

---

## 15. Accessibility & Internationalization

### 15.1 Accessibility Requirements

| Requirement | Implementation |
|-------------|----------------|
| WCAG 2.1 AA | Color contrast, focus management |
| Keyboard Navigation | Full chart interaction via keyboard |
| Screen Readers | ARIA labels, live regions for updates |
| Reduced Motion | Disable animations when prefers-reduced-motion |

### 15.2 Internationalization

| Element | Approach |
|---------|----------|
| UI Labels | i18n keys with react-intl or i18next |
| Number Formats | Locale-aware formatting |
| Chart Tooltips | Localized strings |
| Error Messages | Translation-ready |

---

## Review: Self-Assessment Questions

### Q1: How do we handle the performance impact of computing all spectral metrics for 10,000+ samples?

**A:** Metrics are computed on-demand in the backend and cached. For large datasets, we only compute metrics for the currently visible/sampled subset. The sampling strategy (random, stratified, coverage) ensures representative metrics. Heavy metrics like Hotelling's T² are computed lazily when the user explicitly requests outlier filtering.

### Q2: How do we ensure cross-chart selection remains performant with large selections?

**A:** Selection state uses `Set<number>` for O(1) lookup. Charts use virtualization (only render visible items) and throttle selection updates to 60fps. When selection exceeds 1,000 samples, charts switch to aggregated highlighting (e.g., "1,247 samples selected" overlay rather than individual highlights).

### Q3: What happens if the user loads a dataset without repetition metadata but tries to use the Repetitions chart?

**A:** The Repetitions chart is hidden from the chart selector when no repetition metadata is detected. If users have repetition data in a metadata column that wasn't auto-detected, they can manually configure it via a "Repetition Setup" dialog that lets them specify which metadata column identifies biological samples.

### Q4: How do we handle multi-target datasets (multiple Y columns)?

**A:** The histogram and coloring systems support a "target selector" dropdown when multiple Y columns exist. PCA/UMAP can color by any target. The folds chart shows statistics for the primary target by default with an option to switch.

### Q5: How does the Playground interact with ongoing training runs?

**A:** The Playground is independent of training. However, a "Send to Training" action exports the current pipeline configuration to the training page as a starting point. When predictions exist from a completed run, they can be loaded into the Playground for error analysis.

---

## Appendix A: Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+Z | Undo pipeline/selection change |
| Ctrl+Shift+Z | Redo |
| Ctrl+A | Select all visible samples |
| Escape | Clear selection |
| Ctrl+S | Save current selection |
| Delete | Remove selected operator |
| 1-5 | Toggle chart visibility |
| Space | Toggle selected operator enabled |

---

## Appendix B: Color Palettes

### Continuous (Target)
- **Viridis** (default): Perceptually uniform, colorblind-safe
- **Magma**: High contrast for dark themes
- **Coolwarm**: Diverging for centered data

### Categorical (Folds)
- **Set2**: Soft, distinguishable colors (up to 8)
- **Tab10**: Standard categorical (up to 10)
- **Custom**: User-defined palette storage

### Status
- **Selected**: Primary color with glow
- **Pinned**: Secondary color with border
- **Hover**: Lighten 20%
- **Disabled**: Grayscale 50%
