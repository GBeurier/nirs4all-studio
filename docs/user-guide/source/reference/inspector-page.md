# Inspector Page

The **Inspector** provides a comprehensive visual analysis toolkit for evaluating model performance. Select an experiment and a model, then explore predictions through multiple chart types. Each visualization highlights a different aspect of model quality, from overall accuracy to per-fold variability and residual patterns.

```{figure} ../_images/explore/ins-overview.png
:alt: Inspector page overview
:width: 100%

The Inspector page with the model selector on the left and a scatter plot of predicted vs. actual values in the main area.
```

---

## Page layout

| Region | Description |
|--------|-------------|
| **Experiment selector** | Dropdown at the top to choose a completed experiment (run). |
| **Model selector** | Secondary dropdown or list that shows all models evaluated in the selected experiment. |
| **Visualization tabs** | Tab bar below the selectors that switches between chart types. |
| **Chart area** | Main region displaying the active visualization. |

---

## Experiment and model selection

1. **Experiment**: Select a completed run from the dropdown. Only runs with stored predictions are listed.
2. **Model**: Once an experiment is selected, all models (pipeline chains) evaluated in that run appear. Select one to load its prediction data into the charts.

:::{tip}
If you arrived from the {doc}`results-page` or {doc}`aggregated-results-page` via the "Open in Inspector" action, the experiment and model are pre-selected automatically.
:::

---

## Visualization tabs

The Inspector offers seven chart types, each accessible as a tab. All charts share a common set of interactive features described in the [Interactive elements](#interactive-elements) section below.

### Scatter

A predicted-vs-actual scatter plot. Each point represents one sample.

| Element | Description |
|---------|-------------|
| **Diagonal reference line** | The 1:1 line. Points on this line have zero error. |
| **Fold coloring** | Points are colored by their cross-validation fold, making it easy to spot folds that deviate from the overall trend. |
| **R2 and RMSE annotations** | Summary metrics displayed in the chart legend. |

### Heatmap

Displays prediction error intensity across wavelength regions and samples.

| Element | Description |
|---------|-------------|
| **Horizontal axis** | Wavelength range. |
| **Vertical axis** | Samples, ordered by target value or prediction error. |
| **Color scale** | Gradient from low error (cool) to high error (warm). |

The heatmap helps identify spectral regions where the model struggles, which can guide preprocessing or feature-selection decisions.

### Histogram

A histogram of residual values (predicted minus actual) across all samples.

| Element | Description |
|---------|-------------|
| **Bins** | Residuals grouped into bins. Bin count adjusts automatically or can be set manually. |
| **Normal overlay** | An optional Gaussian curve overlay to assess whether residuals are normally distributed. |
| **Mean and std annotations** | The mean residual and standard deviation are displayed. |

A well-performing regression model should show a narrow, symmetric histogram centered near zero.

### Candlestick

Per-fold score ranges displayed in a candlestick format.

| Element | Description |
|---------|-------------|
| **One candlestick per fold** | Each fold is a vertical bar showing the range of per-sample scores. |
| **Body** | Represents the interquartile range (25th to 75th percentile). |
| **Whiskers** | Extend to the minimum and maximum scores within the fold. |
| **Median line** | Horizontal line inside the body marking the fold's median score. |

This chart reveals whether certain folds are significantly harder than others, which may indicate non-uniform data splits or distribution shifts.

### Residuals

A residuals-vs-predicted plot for diagnosing systematic errors.

| Element | Description |
|---------|-------------|
| **Horizontal axis** | Predicted values. |
| **Vertical axis** | Residuals (Predicted - Actual). |
| **Zero reference line** | A horizontal line at residual = 0. |
| **Fold coloring** | Points colored by fold, consistent with the Scatter tab. |

Patterns in this plot (e.g., a funnel shape or curvature) indicate heteroscedasticity or model bias.

### Confusion Matrix

Available for **classification tasks only**. Displays a grid of true vs. predicted class counts.

| Element | Description |
|---------|-------------|
| **Rows** | True class labels. |
| **Columns** | Predicted class labels. |
| **Cell values** | Count of samples in each true/predicted combination. |
| **Color intensity** | Darker cells indicate higher counts. Diagonal cells (correct predictions) are highlighted in the accent color. |

:::{note}
The Confusion Matrix tab is hidden when the selected model was trained on a regression task.
:::

### Rankings

A ranked bar chart of all models in the selected experiment, sorted by the chosen metric.

| Element | Description |
|---------|-------------|
| **Bars** | One horizontal bar per model, length proportional to the metric value. |
| **Highlight** | The currently selected model is highlighted in the accent color. |
| **Metric selector** | A dropdown above the chart to switch between R2, RMSE, Accuracy, or F1. |

Use this tab to quickly see where your selected model stands relative to all others in the experiment.

---

## Interactive elements

All chart types share a consistent set of interactive behaviors:

| Interaction | Description |
|-------------|-------------|
| **Hover tooltips** | Hover over any data point, bar, or cell to see detailed values (sample ID, predicted value, actual value, residual, fold). |
| **Zoom** | Scroll or pinch to zoom into a region of interest. |
| **Pan** | Click and drag to pan across the zoomed view. |
| **Selection** | Click a data point to highlight it across all tabs. Switching tabs preserves the selection. |
| **Reset** | Double-click the chart background to reset zoom and pan to the default view. |

:::{seealso}
- {doc}`results-page` -- Tabular performance summaries for all models in an experiment.
- {doc}`predictions-page` -- Export raw prediction values for external analysis.
- {doc}`shap-page` -- Understand which wavelengths drive the model's predictions.
:::
