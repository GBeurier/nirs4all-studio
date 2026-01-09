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
10. [Tooltips & Contextual Help](#10-tooltips--contextual-help)
11. [Performance Considerations](#11-performance-considerations)

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
| **Reference Dataset** | The output of any selected pipeline step (default: raw data, step 0), OR another dataset with the same pipeline applied |
| **Final Dataset** | The output of the last enabled step in the pipeline |

This allows users to observe how data transforms through the pipeline by comparing any intermediate state against the final result, or to compare two different datasets processed through the same pipeline.

### 1.3 Reference Modes

The Playground supports two distinct reference modes:

| Mode | Description | Use Case |
|------|-------------|----------|
| **Step Reference** | Reference is a specific pipeline step output from the same dataset | Analyzing pipeline transformation effects |
| **Dataset Reference** | Reference is another dataset with the same pipeline applied | Comparing two acquisitions, calibration transfer, batch effects |

When **Dataset Reference** mode is active:
- Step reference selection in the Pipeline Editor is disabled
- Both datasets are processed through the full pipeline
- Comparison views show Final vs Final (each from their respective dataset)
- Views that depend on metadata (Metadata coloration, Partitions) use the primary dataset's information
- The reference dataset adopts a default coloration (typically INDEX or a neutral gray gradient)

### 1.4 Key Principles

- **Synchronized Views**: All views share the same selection, coloration, and filtering state
- **Non-Destructive Exploration**: All operations are visual; original data remains unchanged
- **Performance-Aware**: WebGL rendering option for large datasets
- **Scientific Rigor**: All visualizations follow best practices for spectroscopic data analysis

### 1.5 Regression vs Classification Mode

The Playground automatically adapts its behavior based on the dataset's target type:

| Aspect | Regression | Classification |
|--------|------------|----------------|
| **Target Histogram** | Continuous bins | Discrete class bars |
| **Target Coloration** | Gradient colormap | Qualitative colormap |
| **Default Colormap** | Sequential (viridis) | Categorical (tab10) |
| **Statistical Overlays** | Mean, std, KDE | Class counts, proportions |
| **Legend** | Gradient bar | Class swatches |

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
| `MINIMIZED` | View collapsed to header bar only |

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

#### 3.1.2 Reference Mode Selector

Toggle between reference modes:

| Mode | Icon | Description |
|------|------|-------------|
| **Step Reference** | 🔗 | Use a pipeline step as reference (default) |
| **Dataset Reference** | 📁 | Use another dataset as reference |

When Dataset Reference is selected:
- A dataset picker dropdown appears to select the reference dataset
- Only compatible datasets are shown (same wavelength range recommended)
- The reference dataset selector in the Pipeline Editor becomes disabled

#### 3.1.3 Colormap Selector

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

#### 3.1.4 Coloration Logic Selector

Icon grid for selecting the coloration source (see [Section 4](#4-coloration-system)):

| Icon | Mode | Description |
|------|------|-------------|
| 🎯 | `TARGET` | Color by Y values |
| 📂 | `PARTITION` | Color by train/test/fold |
| 📋 | `METADATA` | Color by metadata column (user selects column via sub-menu) |
| ✓ | `SELECTION` | Color by selection state |
| ⚠️ | `OUTLIER` | Highlight outliers |
| 🔢 | `INDEX` | Color by sample index |

*Note*: In **Dataset Reference** mode, the reference dataset uses a default coloration (INDEX or neutral gradient) since its metadata, partitions, and targets may differ from the primary dataset.

#### 3.1.5 Display Filtering

Controls to filter which samples are displayed:

| Filter | Options |
|--------|---------|
| **Partition Filter** | All, Train Only, Test Only, Specific Fold |
| **Outlier Filter** | All, Hide Outliers, Outliers Only |
| **Selection Filter** | All, Selected Only, Unselected Only |
| **Metadata Filter** | Filter by metadata column values | ← user can choose the column and value

#### 3.1.6 Rendering Mode

Toggle between rendering engines (applies to views that support it: Spectra, PCA/UMAP, Differences):

| Mode | Use Case |
|------|----------|
| `CANVAS` | Standard rendering, full feature support |
| `WEBGL` | High-performance for large datasets (>1000 samples) |

#### 3.1.7 Global Actions

| Action | Icon | Description |
|--------|------|-------------|
| Reset View | 🔄 | Reset all views to default state |
| Clear Selection | ✕ | Deselect all samples |
| Invert Selection | ⇄ | Select unselected, deselect selected |
| Export All Views | 📄 | Export all views as a combined report (PNG/PDF) |
| Export Selected Data | 📤 | Export selected samples data to CSV |

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

#### 4.1.6 INDEX Mode

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
| Mark as Outliers | Ctrl+O | Mark selected samples as outliers (adds outlier flag to pipeline context) |

---

## 6. Views

### 6.1 Spectra Chart

The primary view for spectral data visualization.

#### 6.1.0 View Menu Bar

The Spectra Chart has a dedicated menu bar with the following controls:

| Control | Type | Options |
|---------|------|---------|
| **Display Mode** | Toggle Group | Lines, Mean±Std, Quantiles, Repetition Means |
| **Dataset** | Toggle Group | Reference, Final, Both, Difference |
| **Line Limit** | Dropdown | 50, 100, 250, 500, 1000, All, Per-Quantile (10%, 25%, 50%, 75%, 90%), Extrema (min/max only) |
| **Rendering** | Toggle | Canvas / WebGL |
| **More Options** | Menu | Grid, Labels, Line Style, Width, Area Opacity |

#### 6.1.1 Display Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| `INDIVIDUAL_LINES` | Each spectrum as a separate line | Small datasets, detailed inspection |
| `MEAN_STD` | Mean line with ±1 standard deviation area | Distribution overview |
| `MEAN_QUANTILES` | Mean line with configurable quantile bands (default: 25%, 50%, 75%, 95%) + optional extrema | Robust distribution view |
| `REPETITION_MEANS` | Mean per biological sample (repetition groups) | Reduce replicate noise |

#### 6.1.2 Display Configuration for reference and final data

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

*Visual Distinction for Both Mode* (default):
- Reference: Solid lines
- Final: Dashed lines or different saturation

#### 6.1.4 Axis Controls

| Axis | Interactions |
|------|--------------|
| **X-Axis (Wavelength)** | Zoom: mousewheel, Pan: drag |
| **Y-Axis (Absorbance)** | Auto-scale or fixed range |

Double-click to reset zoom to full extent.

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
| `WEBGL` | Hardware-accelerated, identical visual output to Canvas | Excellent for 500+ lines |

*Note*: WebGL rendering must produce visually identical results to Canvas mode (same colors, saturation, brightness).

#### 6.1.7 WebGL-Specific Features

- Anti-aliasing toggle
- Line thickness (GPU-rendered)
- Smooth zoom/pan at 60fps
- Fallback to Canvas if WebGL unavailable
- Rendering quality selector: Low, Medium, High, Full (Full displays all points without decimation)

---

### 6.2 Target Histogram

Displays the distribution of target values (Y).

#### 6.2.0 View Menu Bar

| Control | Type | Options |
|---------|------|---------|
| **Dataset Source** | Toggle | Primary / Reference (Dataset Reference mode only) |
| **Bin Count** | Dropdown/Slider | 5-50, Auto |
| **Y-Axis Mode** | Toggle Group | Count, Density, Frequency |
| **Overlays** | Multi-toggle | KDE, Mean, Median, 1σ, 2σ, 3σ |
| **Orientation** | Toggle | Vertical / Horizontal |

#### 6.2.1 Independence from Pipeline

**Important**: The Target Histogram is **not affected** by reference/final dataset selection in Step Reference mode. Target values remain constant regardless of preprocessing steps.

#### 6.2.2 Dataset Reference Mode Behavior

In **Dataset Reference** mode, the Target Histogram gains a **Dataset Source** toggle:

| Source | Displays |
|--------|----------|
| **Primary** | Target distribution of the primary (final) dataset |
| **Reference** | Target distribution of the reference dataset |

When displaying the reference dataset's targets:
- Coloration defaults to INDEX mode (gradient by sample position)
- METADATA and PARTITION coloration are disabled (reference dataset may have different structure)
- TARGET coloration uses the reference dataset's own target values

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
| **3σ Range** | Mean ± 3 standard deviations | Lightest shaded region |
| **Min/Max** | Vertical lines at extremes | Dotted lines |
| **Quartiles** | Q1, Q2, Q3 vertical lines | Thin lines |

#### 6.2.4 Stacked Bar Coloration

Bars represent **stacked segments** colored according to the global coloration mode:

| Coloration Mode | Bar Appearance |
|-----------------|----------------|
| TARGET | Gradient within bar (self-referential) |
| PARTITION | Segments for train/test/fold samples in that bin |
| METADATA | Segments for each metadata value |
| SELECTION | Two segments: selected and unselected |
| OUTLIER | Segment for outliers, segment for normal |

*Visual*: Each bar is composed of horizontal strips, each strip colored by the sample it represents but grouped for optimal display.

#### 6.2.5 Selection Behavior

| Action | Behavior |
|--------|----------|
| Click on bar | Select all samples in that bin |
| Click on segment | Select samples in that specific segment |
| Shift+Click | Add bar/segment samples to selection |
| Drag across bars | Select all samples in touched bins |
| Ctrl+Click | Toggle selection |

---

### 6.3 PCA/UMAP Projection

2D or 3D scatter plot of dimensionally-reduced data.

#### 6.3.0 View Menu Bar

| Control | Type | Options |
|---------|------|---------|
| **Method** | Toggle | PCA / UMAP |
| **Dimensions** | Toggle | 2D / 3D |
| **X Component** | Dropdown | PC1-PCn or UMAP1 |
| **Y Component** | Dropdown | PC1-PCn or UMAP2 |
| **Z Component** | Dropdown | PC1-PCn (visible in 3D mode only) |
| **Dataset** | Toggle Group | Reference, Final, Both |
| **Settings** | Menu | Point size, opacity, variance threshold, UMAP params |

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
| **Show Loadings** | On/Off | Off |
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
- Optional: Lines connecting same sample in both projections

#### 6.3.6 Point Styling for reference and final

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
- Reset view button (or on double click)
- Auto-rotation toggle

#### 6.3.8 Selection Behavior

| Action | Behavior |
|--------|----------|
| Click point | Select that sample |
| Shift+Click | Add to selection |
| Ctrl+Click | Toggle selection |
| Drag (2D) | Rectangle selection |
| Lasso tool | Freeform selection area |

#### 6.3.9 Rendering Modes

| Mode | Capabilities |
|------|--------------|
| `CANVAS` | Full 2D, export support |
| `WEBGL` | Required for 3D, better for >500 points |

*Note*: WebGL rendering produces visually identical results to Canvas mode.

---

### 6.4 Partitions Chart

Displays the distribution of samples across data partitions.

#### 6.4.0 View Menu Bar

| Control | Type | Options |
|---------|------|---------|
| **Orientation** | Toggle | Vertical / Horizontal |
| **Labels** | Multi-toggle | Count, Percentage |
| **Sort** | Dropdown | Default, By Size, Alphabetical |

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
| **Target Mean** | Show mean target value per partition |

#### 6.4.5 Selection Behavior

| Action | Behavior |
|--------|----------|
| Click bar | Select all samples in that partition |
| Click segment | Select samples in that segment |
| Shift+Click | Add to selection |
| Ctrl+Click | Toggle selection |
| Drag across bars | Select all samples in touched bins |

---

### 6.5 Differences Chart

Visualizes distances between samples under different conditions.

#### 6.5.0 View Menu Bar

| Control | Type | Options |
|---------|------|---------|
| **Mode** | Toggle | Reference vs Final / Repetition Variance |
| **Dataset Source** | Toggle | Primary / Reference (Dataset Reference mode, Rep. Variance only) |
| **Metric** | Dropdown | Euclidean, Manhattan, Mahalanobis, Cosine, PCA, Spectral Angle, Correlation |
| **Plot Type** | Toggle | Scatter, Line, Bar |
| **Quantiles** | Multi-toggle | 50%, 75%, 90%, 95% |
| **Reference (Rep. mode)** | Dropdown | Group Mean, Leave-One-Out, First, Selected |
| **Scale** | Toggle | Linear / Log |

#### 6.5.1 Analysis Modes

| Mode | Description |
|------|-------------|
| **Reference vs Final** | Distance between same sample in reference and final datasets |
| **Repetition Variance** | Distance among repetitions of the same biological sample |

*Switch via top-bar toggle icons.*

#### 6.5.2 Dataset Reference Mode Behavior

In **Dataset Reference** mode, the Differences chart behavior changes:

| Mode | Step Reference Behavior | Dataset Reference Behavior |
|------|------------------------|---------------------------|
| **Reference vs Final** | Distance between pipeline step output and final | Distance between same sample in two different datasets (both at final pipeline output) |
| **Repetition Variance** | Repetition variance within the primary dataset | Dataset Source toggle allows switching between primary and reference dataset analysis |

When analyzing the reference dataset's repetition variance:
- Coloration defaults to INDEX mode
- METADATA and PARTITION coloration are disabled
- Selection still syncs globally (by sample index where applicable)

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

Advanced statistical overlays for outlier detection and quality control:

| Enhancement | Description | Configuration |
|-------------|-------------|---------------|
| **Hotelling's T²** | Multivariate control limit based on T² statistic; samples exceeding this limit are potential multivariate outliers | Confidence level (95%, 99%) |
| **Q Residual** | Residual statistic measuring distance from the PCA model; high Q indicates samples not well-represented by the model | Number of PCs, confidence level |
| **High Distance Threshold** | Horizontal line marking a user-defined or auto-computed threshold; samples above are highlighted | Threshold value (percentile or absolute) |

These overlays integrate as horizontal reference lines in the chart. Samples exceeding thresholds can be optionally auto-selected or marked.

#### 6.5.9 Implementation Note

> **Note**: In the current implementation, the Differences Chart is implemented as a **view mode within the Spectra Chart** rather than as a separate view component. This pragmatic decision was made because:
>
> 1. The "difference" mode shares the same rendering infrastructure (wavelengths on X-axis, values on Y-axis)
> 2. It reduces code duplication and maintenance burden
> 3. Users can quickly toggle between processed and difference views within the same chart
>
> **Accessing Difference Mode**:
> - Via the global toolbar: Click the "Diff" button to toggle difference mode
> - Via the Spectra Chart toolbar: Select "Difference" from the View Mode dropdown
>
> **Features Available in Difference Mode**:
> - Toggle between signed (±Δ) and absolute (|Δ|) differences
> - High-difference wavelength regions are automatically highlighted (orange overlay)
> - Statistics footer shows Mean Absolute Difference (MAD), Max Difference, and RMSE
> - All standard Spectra Chart features remain available (sampling, aggregation, zoom/pan)
>
> The separate Differences Chart described above (with distance metrics, Hotelling's T², etc.) remains available for future implementation as an advanced analysis view.

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
| — (disabled) | Dataset Reference mode active (step reference unavailable) |

*Behavior*: Clicking the reference icon on a step sets that step's output as the reference dataset for all views and unsets any other reference step.

**Note**: When **Dataset Reference** mode is active in the global menu, the reference step selection is disabled. The reference becomes the other dataset processed through the full pipeline.

### 7.3 Step Controls

| Action | Description |
|--------|-------------|
| **Enable/Disable** | Toggle step execution (disabled steps are skipped) |
| **Move Up/Down** | Reorder step in pipeline |
| **Delete** | Remove step from pipeline |
| **Configure** | Open step parameter editor |
| **Set as Reference** | Make this step the reference for comparison (Step Reference mode only) |

Steps are draggable and droppable.

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
| **PDF** | All views | Vector with metadata |

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

### 8.3 Report Generation

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

## 10. Tooltips & Contextual Help

### 10.1 Hover Tooltips

Interactive elements display contextual information on hover:

| Element | Tooltip Content |
|---------|-----------------|
| **Spectrum line** | Single tooltip on hover (one line at a time): Sample ID, target value, metadata summary, min/max absorbance values |
| **PCA/UMAP point** | Sample ID, coordinates, target, distance to centroid |
| **Histogram bar** | Bin range, count, percentage, sample list preview |
| **Partition bar** | Partition name, count, percentage, target mean/std |
| **Difference point** | Sample ID, distance value, percentile rank |

### 10.2 Metric Explanations

Each distance metric and statistical measure includes an info icon (ⓘ) that displays:

- Brief mathematical description
- When to use this metric
- Interpretation guidance

---

## 11. Performance Considerations

### 11.1 Sample Count Thresholds

| Sample Count | Recommended Settings |
|--------------|---------------------|
| < 100 | All features available, Canvas rendering |
| 100-500 | Canvas or WebGL, full line display |
| 500-2000 | WebGL recommended, limit visible lines to 500 |
| 2000-10000 | WebGL required, limit visible lines to 250, use aggregation modes |
| > 10000 | WebGL required, aggregation modes only, sampling for selections |

Auto-optimization can be toggled on/off in settings. When enabled, the system automatically applies the recommended settings based on sample count.

### 11.2 Automatic Optimizations

- **Progressive rendering**: Large datasets render incrementally
- **Level-of-detail**: Reduced point sizes when zoomed out (depends on display quality setting)
- **Viewport culling**: Only render visible elements
- **Debounced updates**: Selection and filter changes debounced during rapid interactions
- **Loading indicator**: Rotating spinner shown during long computations (pipeline execution, complex display changes)

### 11.3 Memory Management

- Computed projections (PCA, UMAP) are cached until pipeline changes
- Distance computations (Differences chart) are cached until reference/final datasets change
- Color arrays are shared across views
- WebGL contexts are reused when possible

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

### A.5 Reference Modes

```
ReferenceMode {
  STEP      // Reference is a pipeline step output
  DATASET   // Reference is another dataset
}
```

### A.6 Spectra Display Modes

```
SpectraDisplayMode {
  INDIVIDUAL_LINES
  MEAN_STD
  MEAN_QUANTILES
  REPETITION_MEANS
}
```

### A.7 Histogram Y-Axis Modes

```
HistogramYMode {
  COUNT
  DENSITY
  FREQUENCY
}
```

### A.8 Projection Methods

```
ProjectionMethod {
  PCA
  UMAP
}
```

### A.9 Difference Modes

```
DifferenceMode {
  REFERENCE_VS_FINAL
  REPETITION_VARIANCE
}
```

### A.10 Distance Metrics

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

### A.11 Repetition Reference Types

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
│   ├── ReferenceModeSelector
│   │   ├── StepReferenceToggle
│   │   ├── DatasetReferenceToggle
│   │   └── DatasetPicker (when Dataset Reference active)
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
│       │       ├── ReferenceToggle (disabled in Dataset Reference mode)
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
  // Reference Mode
  referenceMode: ReferenceMode           // STEP or DATASET
  referenceStepIndex: number             // Used in Step Reference mode
  referenceDatasetId: string | null      // Used in Dataset Reference mode

  // Datasets
  primaryDataset: Dataset
  referenceDataset: Dataset              // Pipeline step output OR external dataset
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

## Appendix D: Interaction Patterns Summary

### D.1 Mouse Interactions

| Action | Global Behavior |
|--------|-----------------|
| **Click** | Select single element (clears previous selection) |
| **Shift+Click** | Add element to selection |
| **Ctrl+Click** | Toggle element selection |
| **Drag** | Area/rectangle selection or pan (view-dependent) |
| **Mousewheel** | Zoom (Spectra: X-axis, PCA 3D: distance) |
| **Double-click** | Reset zoom / view to default |
| **Right-click** | Context menu (export, reset, info) |

---

## Appendix E: View Feature Matrix

| Feature | Spectra | Histogram | PCA/UMAP | Partitions | Differences |
|---------|---------|-----------|----------|------------|-------------|
| Affected by Reference/Final | ✓ | ✗ | ✓ | ✗ | ✓ |
| Dataset Source Toggle (Dataset Ref. mode) | ✗ | ✓ | ✗ | ✗ | ✓ (Rep. mode) |
| Supports WebGL | ✓ | ✗ | ✓ | ✗ | ✓ |
| Area Selection | ✓ | ✓ (bars) | ✓ | ✓ (bars) | ✓ |
| Zoom/Pan | ✓ (X) | ✗ | ✓ (3D) | ✗ | ✓ |
| 3D Mode | ✗ | ✗ | ✓ | ✗ | ✗ |
| SVG Export | ✓ | ✓ | ✓ (2D/3D) | ✓ | ✓ |
| Stacked Coloration | ✗ | ✓ | ✗ | ✓ | ✗ |
| Statistical Overlays | ✓ | ✓ | ✗ | ✓ | ✓ |

---

## Appendix F: Data Requirements

### F.1 Minimum Dataset Requirements

| Requirement | Value | Behavior When Missing |
|-------------|-------|----------------------|
| Minimum samples | 2 | Required |
| Minimum wavelengths | 1 | Required |
| Target values | Optional | Target Histogram hidden, TARGET coloration disabled |
| Metadata | Optional | METADATA coloration disabled |
| Repetitions | Optional | Repetition features disabled |
| Folds | Optional | Fold-specific partitions disabled |

### F.2 Optional Data for Enhanced Features

| Data | Enables |
|------|---------|
| **Repetition IDs** | Repetition variance analysis, aggregated spectra |
| **Fold assignments** | Fold-aware partition visualization |
| **Metadata columns** | Metadata coloration mode |
| **Outlier flags** | Outlier coloration mode, highlighting |
| **Wavelength labels** | Meaningful X-axis labels in spectra |

---

*End of Specification*
