# Variable Importance (SHAP) Page

The **Variable Importance** page (found under **Lab**) uses SHAP (SHapley Additive exPlanations) to explain which wavelengths and spectral regions drive a model's predictions. This is critical for understanding model behavior, validating that the model relies on chemically meaningful bands, and building trust in the results.

```{figure} ../_images/lab/lab-shap-overview.png
:alt: Variable Importance (SHAP) page overview
:width: 100%

The Variable Importance page showing SHAP values plotted along the wavelength axis for a selected model.
```

---

## Page layout

| Region | Position | Purpose |
|--------|----------|---------|
| **Model selector** | Top bar | Choose the trained model to explain. |
| **Computation status** | Below selector | Progress indicator during SHAP computation. |
| **View tabs** | Below status | Switch between Spectral, Beeswarm, Bar, and Per-sample views. |
| **Chart area** | Center | Displays the active SHAP visualization. |

---

## Model selector

The dropdown at the top lists all trained models in the active workspace. Select a model to begin SHAP computation for it.

| Field | Description |
|-------|-------------|
| **Model name** | The pipeline chain name and model type. |
| **Dataset** | The dataset the model was trained on. |
| **Task type** | Regression or classification. |

:::{note}
SHAP values are computed on demand. Selecting a model triggers the computation, which may take from a few seconds to several minutes depending on model complexity and dataset size. A progress bar shows the computation status.
:::

---

## SHAP computation

When you select a model, the backend computes SHAP values for every sample in the evaluation set. The computation time depends on:

| Factor | Impact |
|--------|--------|
| **Model type** | Tree-based models (PLS, Random Forest) are fastest. Deep learning models take longer. |
| **Sample count** | More samples means more SHAP values to compute. |
| **Feature count** | More wavelengths increases computation time proportionally. |

A progress bar and estimated time remaining are displayed during computation. You can navigate away and return later -- the results are cached in the workspace.

:::{tip}
For very large datasets, consider running SHAP on a representative subset first. You can do this by creating a smaller dataset via sampling before running the experiment.
:::

---

## View tabs

### Spectral

SHAP values plotted along the wavelength axis, showing which spectral regions matter most to the model.

| Element | Description |
|---------|-------------|
| **Horizontal axis** | Wavelength (nm). |
| **Vertical axis** | Mean absolute SHAP value at each wavelength. |
| **Line plot** | A continuous line connecting the mean |SHAP| at each wavelength, forming a spectral importance profile. |
| **Shaded regions** | Optional confidence band showing the standard deviation of SHAP values across samples. |
| **Peak annotations** | The most important wavelength peaks are automatically labeled with their wavelength values. |

This view directly answers the question: "Which parts of the spectrum does the model rely on?" Peaks should correspond to known absorption bands for the target analyte.

### Beeswarm

A beeswarm plot showing all individual SHAP values for every feature (wavelength).

| Element | Description |
|---------|-------------|
| **Vertical axis** | Wavelengths, ordered by importance (most important at the top). |
| **Horizontal axis** | SHAP value for each sample at that wavelength. |
| **Point color** | Colored by the feature value (absorbance at that wavelength): red for high, blue for low. |
| **Distribution** | Points are spread vertically to show density. Clusters of points reveal common SHAP value patterns. |

The beeswarm plot reveals not just importance but also the **direction** of each feature's effect. For example, if high absorbance at a wavelength (red points) consistently pushes predictions up (positive SHAP), you can infer a positive correlation.

### Bar

A horizontal bar chart of mean absolute SHAP values per wavelength.

| Element | Description |
|---------|-------------|
| **Bars** | One bar per wavelength (or grouped into wavelength bins for very high-resolution data). |
| **Length** | Proportional to mean |SHAP|. Longer bars indicate more important features. |
| **Top-N display** | By default, only the top 20 most important wavelengths are shown. Use the slider to adjust this count. |
| **Sort order** | Sorted descending by importance. |

This is the simplest importance view and is useful for quick comparisons or for including in reports.

### Per-sample

Individual SHAP explanations for selected samples.

| Element | Description |
|---------|-------------|
| **Sample selector** | Dropdown or click to choose a specific sample from the dataset. |
| **Waterfall chart** | Shows how each wavelength's SHAP value pushes the prediction from the base value (expected output) to the final prediction. |
| **Force plot** | An alternative compact visualization where positive and negative contributions are shown as colored bands pushing the prediction up or down. |

:::{note}
The per-sample view helps diagnose individual predictions. If a sample has an unusually high residual, inspect its SHAP breakdown to understand which wavelengths caused the deviation.
:::

---

## Interactive elements

All SHAP charts share a consistent set of interactions:

| Interaction | Description |
|-------------|-------------|
| **Hover** | Hover over any data point or bar to see the exact wavelength and SHAP value. In the Beeswarm plot, hover also shows the sample's feature value and predicted target. |
| **Zoom** | Scroll to zoom into a wavelength range of interest. |
| **Pan** | Click and drag to navigate the zoomed view. |
| **Reset** | Double-click the chart background to restore the default view. |

---

## Caching

Computed SHAP values are stored in the workspace database. If you revisit a model that has already been explained, the cached results load instantly without recomputation. Retraining a model or changing the evaluation data invalidates the cache for that model.

:::{seealso}
- {doc}`inspector-page` -- Visual model performance analysis (scatter, residuals, rankings).
- {doc}`results-page` -- Overview of model metrics across all experiments.
- {doc}`playground-page` -- Experiment with preprocessing for the important wavelength regions identified by SHAP.
:::
