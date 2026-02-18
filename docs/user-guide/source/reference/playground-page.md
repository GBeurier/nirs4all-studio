# Playground Page

The **Playground** is an interactive preprocessing workbench. It lets you build a sequence of preprocessing steps, apply them to a dataset, and see the effect on your spectra in real time. Use it to experiment with transforms before committing them to a pipeline.

```{figure} ../_images/explore/pg-overview.png
:alt: Playground page overview
:width: 100%

The Playground layout: dataset selector at the top, step list on the left, spectral chart in the center, and projection panel on the right.
```

---

## Page layout

The Playground is divided into four regions:

| Region | Position | Purpose |
|--------|----------|---------|
| **Dataset selector** | Top bar | Choose the dataset to work with. |
| **Step pipeline** | Left panel | Build and manage the ordered list of preprocessing steps. |
| **Spectral chart** | Center | Displays the current spectra, updated in real time as you add or modify steps. |
| **Projection panel** | Right panel (collapsible) | Shows PCA or UMAP projections of the processed data. |

---

## Dataset selector

The dropdown at the top of the page lists all datasets in the active workspace. Selecting a dataset loads its spectra into the chart immediately. The dataset name, sample count, and wavelength range are displayed beside the selector.

---

## Step pipeline

The left panel contains the ordered list of preprocessing steps applied to the spectra.

### Step controls

| Control | Description |
|---------|-------------|
| **Add step** | Opens a step picker dialog where you can choose from available preprocessing transforms (SNV, MSC, Savitzky-Golay, baseline correction, derivatives, normalization, and others). |
| **Remove step** | Deletes the selected step from the pipeline. The chart updates immediately. |
| **Reorder** | Drag a step up or down to change its position in the sequence. Processing order matters -- the chart reflects the new order in real time. |
| **Configure** | Click a step to expand its parameter panel. Each step exposes its own set of parameters (e.g., window size for Savitzky-Golay, derivative order, polynomial degree). |
| **Enable / Disable** | Toggle a step on or off without removing it. Disabled steps are skipped during processing but remain in the list for quick re-activation. |

:::{tip}
Drag-and-drop reordering provides instant visual feedback. This makes it easy to test whether applying SNV before or after a derivative produces better-looking spectra.
:::

### Step parameters

When you click a step to configure it, a parameter form appears below the step name. Parameter types vary by step:

| Parameter type | Example |
|----------------|---------|
| **Numeric slider** | Window size (3--51), polynomial order (1--5). |
| **Dropdown** | Derivative order, correction method. |
| **Checkbox** | Mean-centering toggle. |

Changes to parameters update the spectral chart in real time.

---

## Spectral chart

The center area displays the spectra after all active steps have been applied. The chart is a line plot with wavelength on the horizontal axis and absorbance (or transformed intensity) on the vertical axis.

### Chart interactions

| Interaction | Description |
|-------------|-------------|
| **Zoom** | Scroll to zoom into a wavelength region. |
| **Pan** | Click and drag to pan across the wavelength axis. |
| **Hover** | Hover over a spectrum to see the exact wavelength and value in a tooltip. |
| **Reset zoom** | Double-click the chart to reset to the full wavelength range. |

### Comparison mode

Toggle **Comparison mode** to split the chart into a before/after view:

- **Left panel**: Spectra before the most recently added step.
- **Right panel**: Spectra after the step is applied.

This side-by-side layout makes it straightforward to assess the impact of individual transforms.

### Reference overlay

Click the **Reference** button in the chart toolbar to overlay spectra from a second dataset. This is useful for visually comparing spectra from different instruments or batches to check alignment before and after preprocessing.

| Control | Description |
|---------|-------------|
| **Reference dataset** | A dropdown that lists all datasets in the workspace. Select one to overlay its spectra in a contrasting color. |
| **Opacity slider** | Adjust the opacity of the reference overlay so it does not obscure the primary spectra. |
| **Toggle** | Show or hide the reference overlay without removing the selection. |

---

## Projection panel

The collapsible right panel computes and displays a low-dimensional projection of the processed spectra.

| Projection | Description |
|------------|-------------|
| **PCA** | Principal Component Analysis. Displays a 2D scatter plot of the first two principal components. Colored by target value or class label. |
| **UMAP** | Uniform Manifold Approximation and Projection. Provides a nonlinear projection that often reveals cluster structure more clearly than PCA. |

### Projection controls

| Control | Description |
|---------|-------------|
| **Method toggle** | Switch between PCA and UMAP. |
| **Color by** | Choose the variable used to color the scatter points: target value, class label, or sample metadata. |
| **Recompute** | Projections recompute automatically when steps change, but you can also force a manual recompute. |

:::{note}
UMAP computation may take a few seconds for large datasets. A loading indicator appears while the projection is being calculated.
:::

---

## Export to Pipeline Editor

Once you are satisfied with your preprocessing sequence, click **Send to Pipeline Editor** in the toolbar. This action:

1. Converts the current step list into pipeline nodes.
2. Opens the {doc}`pipeline-editor-page` with those nodes pre-populated.
3. Preserves all parameter values you configured in the Playground.

This workflow lets you prototype interactively and then formalize your preprocessing into a reusable pipeline.

:::{seealso}
- {doc}`pipeline-editor-page` -- Build full analysis pipelines including models and evaluation.
- {doc}`inspector-page` -- Visually analyze model outputs after running an experiment.
- {doc}`../reference/interface/keyboard-shortcuts` -- Keyboard shortcuts available in the Playground.
:::
