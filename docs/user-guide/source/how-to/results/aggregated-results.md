# View Aggregated Results

This guide walks you through the Aggregated Results page, which summarizes model performance across multiple datasets. Use it to identify pipeline chains that generalize well rather than excelling on a single dataset.

## Prerequisites

- At least one experiment has completed that included **two or more datasets** (see {doc}`../experiments/launch-experiment`).

---

## Steps

1. **Open the Aggregated Results page.** Click **Results** in the left sidebar, then select the **Aggregated** tab at the top of the page.

   ```{figure} ../../_images/results/res-aggregated-overview.png
   :alt: Aggregated Results page showing cross-dataset performance
   :width: 100%

   The Aggregated Results page ranks pipeline chains by their average performance across all datasets.
   ```

2. **Understand the aggregation.** The page groups results by **pipeline chain** rather than by dataset. For each chain, it computes summary statistics across all datasets where that chain was evaluated:

   - **Mean score** -- the average R2 (or accuracy) across datasets.
   - **Std deviation** -- how much the score varies from one dataset to another.
   - **Min / Max** -- the worst and best score achieved.
   - **Dataset count** -- how many datasets contributed to the aggregation.

3. **Read the ranking table.** Chains are ranked by their mean score (highest first for R2 and accuracy, lowest first for RMSE). The top-ranked chain is the one that performs best *on average* across your datasets.

   :::{tip}
   A chain with a slightly lower mean but a much smaller standard deviation may be a better choice in practice -- it means the model performs consistently regardless of the dataset.
   :::

4. **Expand a chain row.** Click on any chain to see a **per-dataset breakdown**: the individual score on each dataset, displayed as a small bar or table. This helps you spot datasets where a chain struggles.

5. **Filter by experiment.** Use the experiment selector dropdown to limit the view to a specific experiment, or keep it on **All experiments** to see the broadest aggregation.

6. **Compare across model types.** Look at the pipeline steps column to compare how different model families (PLS, Random Forest, SVM) perform across your datasets. Aggregated Results is the best place to answer the question: "Which model type is most robust for my spectra?"

:::{note}
Aggregation only includes chains that were evaluated on at least two datasets. Chains that ran on a single dataset appear only on the per-dataset Scores page.
:::

:::{important}
Aggregated scores assume that all datasets are equally important. If one dataset is much larger or more representative than others, keep that in mind when interpreting the mean score.
:::

---

## What's Next

- {doc}`view-scores` -- drill down into per-dataset scores for a specific chain.
- {doc}`compare-chains` -- compare individual chains side by side.
- {doc}`export-model` -- export the top-ranked model for deployment.
