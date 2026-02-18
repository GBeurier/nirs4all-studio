# Evaluate Dataset Similarity

This guide shows you how to use the Transfer Analysis tool to measure how similar two NIRS datasets are. This is valuable when assessing whether a model trained on one dataset can be applied to another, such as when transferring between instruments or production sites.

## Prerequisites

- A workspace is open in nirs4all Studio.
- At least two datasets have been imported into the workspace.

## Steps

1. **Open the Transfer Analysis tool.** Click **Lab** in the sidebar navigation, then select **Transfer Analysis**.

   ```{figure} ../../_images/lab/lab-transfer-overview.png
   :alt: Transfer Analysis page showing dataset selectors and metric results
   :width: 700px

   The Transfer Analysis page with source and target dataset selectors at the top and metric cards below.
   ```

2. **Select the source dataset.** Use the first dropdown to choose the **source** dataset. This is typically the dataset your model was trained on.

3. **Select the target dataset.** Use the second dropdown to choose the **target** dataset. This is typically the new data you want to apply the model to (e.g., from a different instrument, site, or time period).

   :::{tip}
   If you are comparing data from two instruments measuring the same samples, select the primary instrument as the source and the secondary instrument as the target.
   :::

4. **Run the analysis.** Click **Run Analysis**. The tool computes several similarity metrics between the two datasets. A progress indicator is shown while the computation runs.

5. **Interpret the results.** Once complete, the results panel displays three metric categories:

---

## Understanding the Metrics

### Centroid Distance

The centroid distance measures how far apart the "centers" of the two datasets are in spectral space. A **low value** indicates the datasets occupy a similar region of spectral space. A **high value** suggests significant differences in overall spectral characteristics (e.g., baseline shifts, different concentration ranges, or instrument drift).

### Manifold Alignment

Manifold alignment evaluates whether the internal structure (shape and spread) of the two datasets is compatible. Even if the centroids are close, the datasets may have different variance patterns. A **high alignment score** means the datasets share similar spectral variation patterns, which is a good sign for model transfer.

### KNN Metrics

The K-Nearest Neighbors (KNN) metrics measure how well samples from one dataset can find their nearest neighbors in the other dataset. These metrics include:

- **Coverage** -- the proportion of target samples that have at least one close neighbor in the source data.
- **Average distance** -- the mean distance to the nearest neighbor across datasets.

A high coverage with a low average distance indicates that the target data falls well within the spectral space covered by the source data.

:::{note}
No single metric tells the whole story. Consider all three metric categories together. Two datasets can have a small centroid distance but poor manifold alignment if they have different variance structures.
:::

---

## Interpreting the Overall Result

| Scenario | What it means |
|----------|---------------|
| Low centroid distance + High alignment + High KNN coverage | Excellent transfer potential. A model trained on the source is likely to perform well on the target. |
| Low centroid distance + Low alignment | The datasets are centered similarly but differ in structure. Preprocessing alignment (e.g., standardization) may help. |
| High centroid distance + High alignment | The datasets have similar internal structure but are offset. A simple bias correction may suffice. |
| High centroid distance + Low alignment + Low coverage | Poor transfer potential. Retraining or domain adaptation is recommended. |

:::{important}
Transfer analysis provides guidance, not guarantees. Always validate transfer performance by running predictions on the target dataset and checking the actual error metrics.
:::

## What's Next

- {doc}`shap-importance` -- Analyze which spectral regions drive model predictions.
- {doc}`/how-to/experiments/launch-experiment` -- Train a model on one dataset and test it on another.
