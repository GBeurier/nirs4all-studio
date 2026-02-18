# Transfer Analysis Page

The **Transfer Analysis** page (found under **Lab**) measures the similarity between two datasets using statistical metrics. This is essential for calibration transfer -- determining whether a model trained on one instrument or site can be applied to data from another without significant loss of accuracy.

```{figure} ../_images/lab/lab-transfer-overview.png
:alt: Transfer Analysis page overview
:width: 100%

The Transfer Analysis page with dataset pair selectors, similarity metrics, and a PCA projection overlay.
```

---

## Page layout

| Region | Position | Purpose |
|--------|----------|---------|
| **Dataset pair selector** | Top bar | Choose two datasets to compare. |
| **Metrics panel** | Left side | Displays computed similarity metrics. |
| **Visualization area** | Center/right | PCA projection overlay and per-feature distance chart. |

---

## Dataset pair selector

Two dropdown selectors at the top of the page let you pick the **source** and **target** datasets. Both dropdowns list all datasets in the active workspace.

| Selector | Description |
|----------|-------------|
| **Source dataset** | The reference dataset, typically the one your model was trained on. |
| **Target dataset** | The dataset you want to transfer the model to (e.g., from a different instrument or measurement campaign). |
| **Swap button** | Reverses source and target. Useful for quickly checking whether metrics are symmetric. |

:::{note}
Both datasets must share the same wavelength range (or an overlapping subset) for the comparison to be meaningful. The page displays a warning if the wavelength ranges do not align.
:::

---

## Similarity metrics

Once you select two datasets, the metrics panel computes and displays the following:

| Metric | Description |
|--------|-------------|
| **Centroid distance** | Euclidean distance between the mean spectra (centroids) of the two datasets. A smaller value indicates that the average spectral profiles are similar. |
| **Manifold alignment score** | Measures how well the local geometric structure of one dataset's spectra aligns with the other's in a shared embedding space. Values closer to 1 indicate strong alignment. |
| **KNN accuracy** | The accuracy of a K-nearest-neighbors classifier trained to distinguish samples from the source dataset vs. the target dataset. A value near 50% means the datasets are nearly indistinguishable (good for transfer). A value near 100% means they are very different. |

### Interpreting the metrics

| Scenario | Centroid distance | KNN accuracy | Transfer feasibility |
|----------|-------------------|--------------|----------------------|
| Same instrument, same conditions | Low | ~50% | Direct transfer likely works. |
| Same instrument, different conditions | Moderate | 60--75% | Transfer may require preprocessing alignment (e.g., standardization). |
| Different instruments | High | >80% | Transfer will likely require calibration transfer methods or retraining. |

:::{tip}
Use KNN accuracy as the primary indicator. It captures distributional differences that centroid distance alone may miss. A KNN accuracy below 65% is generally a good sign for direct model transfer.
:::

---

## Visualizations

### PCA projection overlay

A 2D scatter plot showing the first two principal components of both datasets projected into a shared PCA space.

| Element | Description |
|---------|-------------|
| **Source points** | Scatter points from the source dataset, displayed in one color. |
| **Target points** | Scatter points from the target dataset, displayed in a contrasting color. |
| **Legend** | Identifies which color corresponds to which dataset. |
| **Overlap** | Visually assess how much the two point clouds overlap. Greater overlap suggests higher similarity. |

#### PCA chart interactions

| Interaction | Description |
|-------------|-------------|
| **Hover** | Displays the sample ID, dataset name, and PC1/PC2 coordinates. |
| **Zoom** | Scroll to zoom into a cluster of interest. |
| **Pan** | Click and drag to reposition the view. |
| **Reset** | Double-click to restore the default view. |

### Per-feature distance chart

A bar chart showing the distance between the two datasets for each wavelength (feature).

| Element | Description |
|---------|-------------|
| **Horizontal axis** | Wavelength values. |
| **Vertical axis** | Absolute difference between the source and target mean spectra at each wavelength. |
| **Highlight threshold** | An optional horizontal line marking a user-defined threshold. Wavelengths above this line are the most different between the datasets. |

This chart helps pinpoint which spectral regions drive the difference between the two datasets, guiding targeted preprocessing or feature exclusion.

---

## Use cases

| Use case | Description |
|----------|-------------|
| **Calibration transfer** | Assess whether a model calibrated on Instrument A can predict samples measured on Instrument B. |
| **Batch monitoring** | Compare a new batch of samples against the original training data to detect drift. |
| **Site comparison** | Evaluate spectral consistency between samples collected at different field sites. |
| **Synthetic vs. real** | Verify that synthetically generated data (from the {doc}`synthesis-page`) resembles real measurements. |

:::{seealso}
- {doc}`synthesis-page` -- Generate synthetic datasets for comparison or augmentation.
- {doc}`playground-page` -- Apply preprocessing to align datasets before re-running the transfer analysis.
- {doc}`aggregated-results-page` -- Evaluate models across multiple datasets to find those that transfer well.
:::
