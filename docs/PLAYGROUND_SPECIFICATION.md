# Playground Specification

> **Version**: 1.0
> **Status**: Reference Specification
> **Last Updated**: January 2026

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture & Layout](#2-architecture--layout)
3. [Global Controls](#3-global-controls)
4. [Coloration System](#4-coloration-system)
5. [Selection Model](#5-selection-model)
6. [Views](#6-views)
   - [Spectra Chart](#61-spectra-chart)
   - [Target Histogram](#62-target-histogram)
   - [PCA/UMAP Projection](#63-pcaumap-projection)
   - [Partitions Chart](#64-partitions-chart)
   - [Differences Chart](#65-differences-chart)
7. [Pipeline Editor Integration](#7-pipeline-editor-integration)
8. [Export Capabilities](#8-export-capabilities)
9. [Keyboard Shortcuts](#9-keyboard-shortcuts)
10. [Accessibility](#10-accessibility)
11. [Tooltips & Contextual Help](#11-tooltips--contextual-help)
12. [Performance Considerations](#12-performance-considerations)

---

## 1. Overview

### 1.1 Purpose

The Playground is an interactive data visualization dashboard designed for exploring NIRS (Near-Infrared Spectroscopy) datasets and analyzing the effects of preprocessing pipelines. It provides researchers with a unified environment to:

- Visualize raw spectral data and transformed results
- Compare reference data (any pipeline step) against final processed data
- Explore relationships between samples using multiple complementary views
- Identify outliers, patterns, and data quality issues
- Understand the impact of each preprocessing step

### 1.2 Core Concept

The Playground operates on a **dual-dataset comparison model**:

| Dataset | Description |
|---------|-------------|
| **Reference Dataset** | The output of any selected pipeline step (default: raw data, step 0) |
| **Final Dataset** | The output of the last enabled step in the pipeline |

This allows users to observe how data transforms through the pipeline by comparing any intermediate state against the final result.

### 1.3 Key Principles

- **Synchronized Views**: All views share the same selection, coloration, and filtering state
- **Non-Destructive Exploration**: All operations are visual; original data remains unchanged
- **Performance-Aware**: WebGL rendering option for large datasets
- **Scientific Rigor**: All visualizations follow best practices for spectroscopic data analysis

---

## 2. Architecture & Layout

### 2.1 Layout System

The Playground uses an **adaptive grid layout** that automatically adjusts based on the number of active views.

#### Layout Configurations

| Active Views | Layout |
|--------------|--------|
| 1 | Full-width single view |
| 2 | 1×2 horizontal split or 2×1 vertical split (user preference) |
| 3 | 2×2 grid with one cell spanning or 1×3 horizontal |
| 4 | 2×2 grid |
| 5 | 3×2 grid with optimal arrangement |

#### View States

Each view can be in one of the following states:

| State | Description |
|-------|-------------|
| `VISIBLE` | Normal display within the grid |
| `HIDDEN` | View is deactivated, not rendered |
| `MAXIMIZED` | View takes full playground area, others temporarily hidden |
| `MINIMIZED` | View collapsed to header bar only (optional enhancement) |

### 2.2 View Container Structure

Each view container includes:

```
┌─────────────────────────────────────────────────┐
│ [Icon] View Title          [Menu] [Max] [Hide] │  ← Header Bar
├─────────────────────────────────────────────────┤
│                                                 │
│              Visualization Area                 │
│                                                 │
├─────────────────────────────────────────────────┤
│ Status: 150 samples | Selection: 12            │  ← Footer (optional)
└─────────────────────────────────────────────────┘
```

### 2.3 Resize Behavior

- Views resize proportionally when the window or playground area changes
- Minimum view dimensions enforced to maintain usability
- Smooth animation transitions between layout changes
- User can optionally drag dividers between views (enhancement)

---

## 3. Global Controls

### 3.1 Top Menu Bar

The global menu bar provides controls that affect all views simultaneously.

#### 3.1.1 View Toggles

A set of toggle buttons to activate/deactivate each view:

| Button | View | Default State |
|--------|------|---------------|
| 📈 | Spectra Chart | Active |
| 📊 | Target Histogram | Active |
| 🎯 | PCA/UMAP | Active |
| 📋 | Partitions | Active |
| 📐 | Differences | Hidden |

#### 3.1.2 Colormap Selector

Dropdown or palette picker for selecting the color gradient:

**Sequential Colormaps** (for continuous data):
- `viridis` (default)
- `plasma`
- `inferno`
- `magma`
- `cividis`
- `turbo`

**Diverging Colormaps** (for centered data):
- `coolwarm`
- `RdBu`
- `PiYG`
- `PRGn`

**Qualitative Colormaps** (for categorical data):
- `Set1`
- `Set2`
- `Paired`
- `Dark2`
- `tab10`
- `tab20`

#### 3.1.3 Coloration Logic Selector

Icon grid for selecting the coloration source (see [Section 4](#4-coloration-system)):

| Icon | Mode | Description |
|------|------|-------------|
| 🎯 | `TARGET` | Color by Y values |
| 📂 | `PARTITION` | Color by train/test/fold |
| 📋 | `METADATA` | Color by metadata column |
| ✓ | `SELECTION` | Color by selection state |
| ⚠️ | `OUTLIER` | Highlight outliers |
| 🔢 | `INDEX` | Color by sample index (enhancement) |

#### 3.1.4 Display Filtering

Controls to filter which samples are displayed:

| Filter | Options |
|--------|---------|
| **Partition Filter** | All, Train Only, Test Only, Specific Fold |
| **Outlier Filter** | All, Hide Outliers, Outliers Only |
| **Selection Filter** | All, Selected Only, Unselected Only |
| **Metadata Filter** | Filter by metadata column values |

#### 3.1.5 Rendering Mode

Toggle between rendering engines:

| Mode | Use Case |
|------|----------|
| `CANVAS` | Standard rendering, full feature support |
| `WEBGL` | High-performance for large datasets (>1000 samples) |

#### 3.1.6 Global Actions

| Action | Icon | Description |
|--------|------|-------------|
| Reset View | 🔄 | Reset all views to default state |
| Clear Selection | ✕ | Deselect all samples |
| Invert Selection | ⇄ | Select unselected, deselect selected |
| Export All | 📥 | Export all views as a combined report |

---

## 4. Coloration System

### 4.1 Coloration Modes

The coloration system determines the color source for all views. Each view interprets the coloration according to its visualization type.

#### 4.1.1 TARGET Mode

Colors samples based on the target variable (Y).

| Target Type | Behavior |
|-------------|----------|
| **Regression** | Continuous gradient from min to max value |
| **Classification** | Discrete colors, one per class |

*Visual Note*: For regression, the colormap is applied linearly. For classification, qualitative colormaps are preferred.

#### 4.1.2 PARTITION Mode

Colors samples based on their role in the data split.

| Partition | Color Assignment |
|-----------|------------------|
| Train (no folds) | Single color |
| Test | Distinct color |
| Train Fold N | Color from palette index N |
| Validation Fold N | Lighter/darker variant of fold color |

*Visual Note*: When folds exist, each fold gets a distinct hue with train/validation as saturation variants.

#### 4.1.3 METADATA Mode

Colors samples based on a selected metadata column.

| Metadata Type | Detection | Behavior |
|---------------|-----------|----------|
| **Continuous** | Numeric values, >10 unique | Gradient colormap |
| **Discrete** | Strings, ≤10 unique numeric | Categorical colors |
| **Date/Time** | ISO date format | Gradient by chronology |

*Enhancement*: Auto-detection with manual override option.

#### 4.1.4 SELECTION Mode

Binary coloration based on selection state.

| State | Color |
|-------|-------|
| Selected | Vibrant accent color (e.g., cyan, magenta) |
| Unselected | Muted gray (#888888) |

#### 4.1.5 OUTLIER Mode

Highlights samples flagged as outliers.

| State | Color |
|-------|-------|
| Outlier | Red (#FF4444) |
| Normal | Muted gray (#AAAAAA) |

*Important*: In **all other coloration modes**, outliers are **always overlaid in red** regardless of their assigned color. This ensures outliers remain visible.

#### 4.1.6 INDEX Mode (Enhancement)

Colors samples by their dataset index position.

| Position | Color |
|----------|-------|
| First sample | Start of colormap |
| Last sample | End of colormap |

*Use Case*: Useful for time-series data or identifying acquisition order effects.

### 4.2 Color Legend

A dynamic legend displays the current coloration mapping:

- For continuous: gradient bar with min/max labels
- For discrete: list of color swatches with labels
- Legend position: bottom-right of playground (configurable)
- Legend is collapsible to save space

### 4.3 Outlier Overlay

Regardless of the active coloration mode, outliers receive a **red overlay marker** or **red border** to ensure they remain identifiable. This can be toggled off via settings.

---

## 5. Selection Model

### 5.1 Selection State

The selection model is **global** across all views. Selecting samples in one view immediately reflects in all others.

#### Selection Data Structure

```
Selection {
  selectedIndices: Set<number>    // Dataset indices of selected samples
  selectionSource: ViewType       // Which view initiated the selection
  selectionMode: SelectionMode    // How the selection was made
  timestamp: number               // For undo/redo support
}
```

### 5.2 Selection Modes

| Mode | Trigger | Behavior |
|------|---------|----------|
| `SINGLE` | Click | Select one sample, deselect others |
| `ADD` | Shift+Click | Add sample to current selection |
| `TOGGLE` | Ctrl+Click | Toggle sample selection state |
| `RANGE` | Shift+Click (after first) | Select range from last to current |
| `AREA` | Drag | Select all samples within drawn area |

### 5.3 Area Selection

Area selection behavior per view:

| View | Area Selection Behavior |
|------|------------------------|
| Spectra | Rectangle selects all spectra passing through the region |
| PCA/UMAP | Rectangle/lasso selects all points within the shape |
| Differences | Rectangle selects all points within the region |
| Histogram | Click on bar selects all samples in that bin |
| Partitions | Click on bar segment selects those samples |

### 5.4 Selection Visualization

| View | Selected Appearance | Unselected Appearance |
|------|--------------------|-----------------------|
| Spectra | Full opacity, thicker line | Reduced opacity (0.2) |
| PCA/UMAP | Full opacity, larger point | Reduced opacity (0.3), smaller point |
| Histogram | Highlighted bar segment | Normal bar segment |
| Differences | Full opacity, highlighted | Reduced opacity |

### 5.5 Selection Actions

| Action | Shortcut | Description |
|--------|----------|-------------|
| Select All | Ctrl+A | Select all visible samples |
| Deselect All | Escape | Clear selection |
| Invert Selection | Ctrl+I | Invert current selection |
| Delete Selection | - | Mark selected as outliers (enhancement) |

---

## 6. Views

### 6.1 Spectra Chart

The primary view for spectral data visualization.

#### 6.1.1 Display Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| `INDIVIDUAL_LINES` | Each spectrum as a separate line | Small datasets, detailed inspection |
| `MEAN_STD` | Mean line with ±1 standard deviation area | Distribution overview |
| `MEAN_QUANTILES` | Mean line with quantile bands (25%, 50%, 75%, 95%) | Robust distribution view |
| `REPETITION_MEANS` | Mean per biological sample (repetition groups) | Reduce replicate noise |

#### 6.1.2 Display Configuration

| Setting | Options | Default |
|---------|---------|---------|
| **Line Limit** | 50, 100, 250, 500, 1000, All | 250 |
| **Line Style** | Solid, Dashed, Dotted | Solid |
| **Line Width** | 0.5 - 3.0 px | 1.0 |
| **Area Opacity** | 0.1 - 0.5 | 0.3 |
| **Show Grid** | On/Off | On |
| **Show Axis Labels** | On/Off | On |

#### 6.1.3 Dataset Toggle

| Option | Description |
|--------|-------------|
| Reference Only | Show only reference dataset spectra |
| Final Only | Show only final dataset spectra |
| Both (Overlay) | Show both with visual distinction |
| Side-by-Side | Split view with reference left, final right (enhancement) |

*Visual Distinction for Both Mode*:
- Reference: Solid lines
- Final: Dashed lines or different saturation

#### 6.1.4 Axis Controls

| Axis | Interactions |
|------|--------------|
| **X-Axis (Wavelength)** | Zoom: mousewheel, Pan: drag |
| **Y-Axis (Absorbance)** | Auto-scale or fixed range |

*Enhancement*: Double-click to reset zoom to full extent.

#### 6.1.5 Selection Behavior

| Action | Behavior |
|--------|----------|
| Click on line | Select that spectrum |
| Shift+Click | Add to selection |
| Ctrl+Click | Toggle selection |
| Drag rectangle | Select all spectra passing through region |

#### 6.1.6 Rendering Modes

| Mode | Capabilities | Performance |
|------|--------------|-------------|
| `CANVAS` | Full styling, export to PNG/SVG | Good for <500 lines |
| `WEBGL` | Hardware-accelerated | Excellent for 500+ lines |

#### 6.1.7 WebGL-Specific Features

- Anti-aliasing toggle
- Line thickness (GPU-rendered)
- Smooth zoom/pan at 60fps
- Fallback to Canvas if WebGL unavailable

---

### 6.2 Target Histogram

Displays the distribution of target values (Y).

#### 6.2.1 Independence from Pipeline

**Important**: The Target Histogram is **not affected** by reference/final dataset selection. Target values remain constant regardless of preprocessing steps.

#### 6.2.2 Histogram Configuration

| Setting | Options | Default |
|---------|---------|---------|
| **Bin Count** | 5, 10, 15, 20, 25, 30, 50, Auto | Auto |
| **Y-Axis Mode** | Count, Density, Frequency (%) | Count |
| **Orientation** | Vertical, Horizontal | Vertical |
| **Bar Gap** | 0% - 20% | 5% |

#### 6.2.3 Statistical Overlays

Toggleable overlays for statistical reference:

| Overlay | Description | Visual |
|---------|-------------|--------|
| **KDE** | Kernel Density Estimation curve | Smooth line |
| **Mean** | Vertical line at mean | Solid line |
| **Median** | Vertical line at median | Dashed line |
| **1σ Range** | Mean ± 1 standard deviation | Shaded region |
| **2σ Range** | Mean ± 2 standard deviations | Lighter shaded region |
| **Min/Max** | Vertical lines at extremes | Dotted lines |
| **Quartiles** | Q1, Q2, Q3 vertical lines (enhancement) | Thin lines |

#### 6.2.4 Stacked Bar Coloration

Bars represent **stacked segments** colored according to the global coloration mode:

| Coloration Mode | Bar Appearance |
|-----------------|----------------|
| TARGET | Gradient within bar (self-referential) |
| PARTITION | Segments for train/test/fold samples in that bin |
| METADATA | Segments for each metadata value |
| SELECTION | Two segments: selected and unselected |
| OUTLIER | Segment for outliers, segment for normal |

*Visual*: Each bar is composed of horizontal strips, each strip colored by the sample it represents.

#### 6.2.5 Selection Behavior

| Action | Behavior |
|--------|----------|
| Click on bar | Select all samples in that bin |
| Click on segment | Select samples in that specific segment |
| Shift+Click | Add bar/segment samples to selection |
| Drag across bars | Select all samples in touched bins |

---

### 6.3 PCA/UMAP Projection

2D or 3D scatter plot of dimensionally-reduced data.

#### 6.3.1 Projection Methods

| Method | Description | Configuration |
|--------|-------------|---------------|
| **PCA** | Principal Component Analysis | Variance threshold (default: 99.9%) |
| **UMAP** | Uniform Manifold Approximation | n_neighbors, min_dist, metric |

*Switch via top-bar toggle icons.*

#### 6.3.2 Dimension Configuration

| Setting | Options | Default |
|---------|---------|---------|
| **Display Mode** | 2D, 3D | 2D |
| **X Component** | PC1-PCn / UMAP1-2 | 1 |
| **Y Component** | PC1-PCn / UMAP1-2 | 2 |
| **Z Component (3D)** | PC1-PCn / UMAP3 | 3 |

#### 6.3.3 PCA-Specific Settings

| Setting | Options | Default |
|---------|---------|---------|
| **Variance Threshold** | 90%, 95%, 99%, 99.9%, 100% | 99.9% |
| **Scaling** | None, Standard, Robust | Standard |
| **Show Loadings** | On/Off (enhancement) | Off |
| **Show Variance %** | In axis labels | On |

*Display*: Axis labels show "PC1 (45.2%)" indicating explained variance.

#### 6.3.4 UMAP-Specific Settings

| Setting | Options | Default |
|---------|---------|---------|
| **n_neighbors** | 5-100 | 15 |
| **min_dist** | 0.0-1.0 | 0.1 |
| **metric** | euclidean, cosine, manhattan | euclidean |
| **Seed** | Integer | 42 |

#### 6.3.5 Dataset Display

| Option | Behavior |
|--------|----------|
| Reference Only | Plot reference dataset points |
| Final Only | Plot final dataset points |
| Both | Plot both with visual distinction |

*Visual Distinction for Both Mode*:
- Reference points: Circles with light fill
- Final points: Circles with dark fill, or different shape (squares)
- Optional: Lines connecting same sample in both projections (enhancement)

#### 6.3.6 Point Styling

| Setting | Options | Default |
|---------|---------|---------|
| **Point Size** | 2-20 px | 6 |
| **Point Shape** | Circle, Square, Triangle, Diamond | Circle |
| **Border** | None, Thin, Medium | Thin |
| **Opacity** | 0.3-1.0 | 0.8 |

#### 6.3.7 3D-Specific Features

- Orbit rotation: Drag to rotate
- Zoom: Mousewheel
- Pan: Right-drag or Shift+drag
- Reset view button
- Auto-rotation toggle (enhancement)

#### 6.3.8 Selection Behavior

| Action | Behavior |
|--------|----------|
| Click point | Select that sample |
| Shift+Click | Add to selection |
| Ctrl+Click | Toggle selection |
| Drag (2D) | Rectangle selection |
| Lasso tool (enhancement) | Freeform selection area |

#### 6.3.9 Rendering Modes

| Mode | Capabilities |
|------|--------------|
| `CANVAS` | Full 2D, export support |
| `WEBGL` | Required for 3D, better for >500 points |

---

### 6.4 Partitions Chart

Displays the distribution of samples across data partitions.

#### 6.4.1 Partition Types

| Scenario | Bars Displayed |
|----------|----------------|
| Train only | 1 bar: Train |
| Train/Test | 2 bars: Train, Test |
| K-Fold CV | (2K + 1) bars: Train₁, Val₁, Train₂, Val₂, ..., Trainₖ, Valₖ, Test |

#### 6.4.2 Bar Configuration

| Setting | Options | Default |
|---------|---------|---------|
| **Orientation** | Vertical, Horizontal | Vertical |
| **Bar Width** | Thin, Medium, Wide | Medium |
| **Spacing** | Compact, Normal, Wide | Normal |
| **Sort Order** | Default, By Size, Alphabetical | Default |

#### 6.4.3 Stacked Coloration

Like the Target Histogram, bars are **stacked** by the global coloration mode:

| Coloration Mode | Segments |
|-----------------|----------|
| TARGET | Gradient or class colors for samples in partition |
| PARTITION | Single color (self-referential) |
| METADATA | Segments per metadata value |
| SELECTION | Selected / Unselected segments |
| OUTLIER | Outlier / Normal segments |

#### 6.4.4 Additional Information

| Overlay | Description |
|---------|-------------|
| **Count Labels** | Show count on or above each bar |
| **Percentage Labels** | Show percentage of total |
| **Target Mean** | Show mean target value per partition (enhancement) |

#### 6.4.5 Selection Behavior

| Action | Behavior |
|--------|----------|
| Click bar | Select all samples in that partition |
| Click segment | Select samples in that segment |
| Shift+Click | Add to selection |

---

### 6.5 Differences Chart

Visualizes distances between samples under different conditions.

#### 6.5.1 Analysis Modes

| Mode | Description |
|------|-------------|
| **Reference vs Final** | Distance between same sample in reference and final datasets |
| **Repetition Variance** | Distance among repetitions of the same biological sample |

*Switch via top-bar toggle icons.*

#### 6.5.2 X-Axis Configuration

| Mode | X-Axis Represents |
|------|-------------------|
| Reference vs Final | Sample index (0 to N-1) |
| Repetition Variance | Biological sample index (unique samples) |

#### 6.5.3 Distance Metrics

| Metric | Description | Use Case |
|--------|-------------|----------|
| `EUCLIDEAN` | L2 norm | General purpose |
| `MANHATTAN` | L1 norm | Robust to outliers |
| `MAHALANOBIS` | Covariance-weighted | Account for correlations |
| `COSINE` | Angular distance | Shape similarity |
| `PCA_DISTANCE` | Distance in PCA space | Reduced dimensionality |
| `SPECTRAL_ANGLE` | Angle between spectra | Spectral matching |
| `CORRELATION` | 1 - Pearson correlation | Linear relationship |

#### 6.5.4 Repetition Reference Options

For Repetition Variance mode, the reference point can be:

| Option | Description |
|--------|-------------|
| **Group Mean** | Mean of all repetitions for that sample (reference at y=0) |
| **Leave-One-Out Mean** | Mean of other repetitions (each point uses different reference) |
| **First Repetition** | First acquired repetition as reference |
| **Selected Repetition** | User-selected repetition index as reference |

#### 6.5.5 Visualization Options

| Setting | Options | Default |
|---------|---------|---------|
| **Plot Type** | Scatter, Line, Bar | Scatter |
| **Point Size** | 2-12 px | 5 |
| **Show Quantile Lines** | Off, 50%, 75%, 90%, 95% | Off |
| **Show Mean Line** | On/Off | On |
| **Show Zero Line** | On/Off | On |
| **Log Scale Y** | On/Off | Off |

#### 6.5.6 Quantile Reference Lines

When enabled, horizontal lines display distribution thresholds:

| Quantile | Meaning |
|----------|---------|
| 50% (Median) | Half of samples below this distance |
| 75% | Upper quartile |
| 90% | 10% of samples exceed this |
| 95% | Potential outlier threshold |

*Visual*: Dashed lines with quantile labels on the right axis.

#### 6.5.7 Selection Behavior

| Action | Behavior |
|--------|----------|
| Click point | Select that sample |
| Shift+Click | Add to selection |
| Ctrl+Click | Toggle |
| Drag rectangle | Select points in region |

#### 6.5.8 Scientific Enhancements

| Enhancement | Description |
|-------------|-------------|
| **Hotelling's T²** | Show T² control limit for multivariate outlier detection |
| **Q Residual** | Show Q statistic for model-based outlier detection |
| **Highlight High Distance** | Auto-highlight samples above a threshold |

---

## 7. Pipeline Editor Integration

### 7.1 Overview

The Pipeline Editor is embedded in the Playground sidebar or as a collapsible panel. It displays the current pipeline and allows interactive modifications.

### 7.2 Reference Step Selection

Each pipeline step displays an icon/action to designate it as the **reference step**:

| Icon State | Meaning |
|------------|---------|
| ○ (empty) | Not reference |
| ● (filled) | Current reference step |

*Behavior*: Clicking the reference icon on a step sets that step's output as the reference dataset for all views.

### 7.3 Step Controls

| Action | Description |
|--------|-------------|
| **Enable/Disable** | Toggle step execution (disabled steps are skipped) |
| **Move Up/Down** | Reorder step in pipeline |
| **Delete** | Remove step from pipeline |
| **Configure** | Open step parameter editor |
| **Set as Reference** | Make this step the reference for comparison |

### 7.4 Visual Feedback

- **Reference Step**: Highlighted with distinct border/background color
- **Final Step**: Always the last enabled step, marked accordingly
- **Disabled Steps**: Grayed out, strikethrough text
- **Current Processing**: Animation while pipeline recalculates

### 7.5 Auto-Update

When the pipeline changes (steps added, removed, reordered, or parameters modified):

1. Pipeline re-executes from the first modified step
2. Reference and final datasets update
3. All views refresh with new data
4. Selection state is preserved where sample indices remain valid

---

## 8. Export Capabilities

### 8.1 View-Level Export

Each view can be exported individually via its header menu.

#### 8.1.1 Export Formats

| Format | Availability | Description |
|--------|--------------|-------------|
| **PNG** | All views | Raster image at configurable resolution |
| **SVG** | Canvas views | Vector graphics, editable |
| **PDF** | All views (enhancement) | Vector with metadata |

#### 8.1.2 Export Options

| Option | Values | Default |
|--------|--------|---------|
| **Resolution** | 1x, 2x, 3x, 4x | 2x |
| **Background** | Transparent, White, Current Theme | Current Theme |
| **Include Legend** | On/Off | On |
| **Include Title** | On/Off | On |

### 8.2 Data Export

| Export Type | Format | Content |
|-------------|--------|---------|
| **Selected Samples** | CSV, JSON | Sample indices, metadata, values |
| **Current View Data** | CSV | Underlying data for the visualization |
| **Pipeline Configuration** | JSON, YAML | Current pipeline definition |
| **Full Report** | PDF, HTML | All views + statistics + pipeline info |

### 8.3 Report Generation (Enhancement)

Automated report including:

- All active views as figures
- Pipeline configuration summary
- Dataset statistics
- Selection summary
- Timestamp and export metadata

---

## 9. Keyboard Shortcuts

### 9.1 Global Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+A` | Select all visible samples |
| `Escape` | Clear selection |
| `Ctrl+I` | Invert selection |
| `Ctrl+Z` | Undo last selection change |
| `Ctrl+Shift+Z` | Redo selection change |
| `1-5` | Toggle visibility of view 1-5 |
| `F` | Maximize focused view / restore |
| `R` | Reset all views to default |

### 9.2 View-Specific Shortcuts

| Shortcut | View | Action |
|----------|------|--------|
| `+/-` | Spectra | Zoom in/out on X-axis |
| `Home` | Spectra | Reset zoom to full extent |
| `←/→` | PCA | Cycle X component |
| `↑/↓` | PCA | Cycle Y component |
| `2/3` | PCA | Toggle 2D/3D mode |

---

## 10. Accessibility

### 10.1 Color Vision Support

| Feature | Implementation |
|---------|----------------|
| **Colorblind-safe palettes** | Alternative colormaps optimized for deuteranopia, protanopia, tritanopia |
| **Pattern fills** | Optional patterns in addition to color for categorical data |
| **High contrast mode** | Increased contrast for all UI elements |

### 10.2 Screen Reader Support

| Element | Accessible Label |
|---------|------------------|
| Views | Descriptive titles and current state |
| Charts | Summary of data distribution |
| Selection | Announcement of selection changes |
| Controls | Clear action descriptions |

### 10.3 Keyboard Navigation

- Full keyboard navigation for all controls
- Focus indicators clearly visible
- Logical tab order through views and controls

---

## Appendix A: Enums Reference

### A.1 View Types

```
ViewType {
  SPECTRA_CHART
  TARGET_HISTOGRAM
  PCA_UMAP
  PARTITIONS
  DIFFERENCES
}
```

### A.2 Coloration Modes

```
ColorationMode {
  TARGET
  PARTITION
  METADATA
  SELECTION
  OUTLIER
  INDEX
}
```

### A.3 Selection Modes

```
SelectionMode {
  SINGLE
  ADD
  TOGGLE
  RANGE
  AREA
}
```

### A.4 Rendering Modes

```
RenderingMode {
  CANVAS
  WEBGL
}
```

### A.5 Spectra Display Modes

```
SpectraDisplayMode {
  INDIVIDUAL_LINES
  MEAN_STD
  MEAN_QUANTILES
  REPETITION_MEANS
}
```

### A.6 Histogram Y-Axis Modes

```
HistogramYMode {
  COUNT
  DENSITY
  FREQUENCY
}
```

### A.7 Projection Methods

```
ProjectionMethod {
  PCA
  UMAP
}
```

### A.8 Difference Modes

```
DifferenceMode {
  REFERENCE_VS_FINAL
  REPETITION_VARIANCE
}
```

### A.9 Distance Metrics

```
DistanceMetric {
  EUCLIDEAN
  MANHATTAN
  MAHALANOBIS
  COSINE
  PCA_DISTANCE
  SPECTRAL_ANGLE
  CORRELATION
}
```

### A.10 Repetition Reference Types

```
RepetitionReference {
  GROUP_MEAN
  LEAVE_ONE_OUT_MEAN
  FIRST_REPETITION
  SELECTED_REPETITION
}
```

---

## Appendix B: Component Hierarchy

```
Playground
├── GlobalMenuBar
│   ├── ViewToggles
│   ├── ColormapSelector
│   ├── ColorationLogicSelector
│   ├── DisplayFilters
│   ├── RenderingModeToggle
│   └── GlobalActions
├── ColorLegend
├── ViewGrid
│   ├── ViewContainer (×5)
│   │   ├── ViewHeader
│   │   │   ├── Title
│   │   │   ├── ViewMenu
│   │   │   └── ViewActions (Maximize, Hide, Export)
│   │   ├── ViewContent
│   │   │   └── [SpectraChart | TargetHistogram | PCAUmap | Partitions | Differences]
│   │   └── ViewFooter (optional)
│   └── ViewDividers (optional)
├── PipelineEditorPanel
│   └── PipelineEditor
│       ├── StepList
│       │   └── StepItem (×N)
│       │       ├── StepIcon
│       │       ├── StepLabel
│       │       ├── ReferenceToggle
│       │       ├── EnableToggle
│       │       └── StepActions
│       └── AddStepButton
└── SelectionManager (state)
```

---

## Appendix C: State Management

### C.1 Shared State

```
PlaygroundState {
  // Dataset
  referenceStepIndex: number
  referenceDataset: Dataset
  finalDataset: Dataset

  // Display
  activeViews: Set<ViewType>
  maximizedView: ViewType | null
  renderingMode: RenderingMode

  // Coloration
  colorationMode: ColorationMode
  colormap: string
  metadataColumn: string | null

  // Selection
  selectedIndices: Set<number>

  // Filtering
  partitionFilter: PartitionFilter
  outlierFilter: OutlierFilter
  selectionFilter: SelectionFilter

  // Pipeline
  pipeline: PipelineStep[]
}
```

### C.2 Per-View State

Each view maintains its own configuration state that persists across sessions.

---

*End of Specification*
