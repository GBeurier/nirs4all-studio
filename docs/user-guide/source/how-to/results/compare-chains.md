# Compare Pipeline Chains

This guide explains how to select multiple pipeline chains and compare their performance side by side. Comparing chains helps you decide which preprocessing and model combination works best for your data.

## Prerequisites

- An experiment has completed with at least two chains (see {doc}`view-scores`).

## What Is a Chain?

A **chain** is one specific pipeline variant that was evaluated during an experiment. When a pipeline includes generators -- for example, `_or_: [SNV, MSC]` to try two scatter-correction methods -- the pipeline expands into multiple chains at run time. Each chain represents a unique path through the pipeline: a fixed combination of preprocessing steps, splitter, and model with specific hyperparameters.

Comparing chains lets you answer questions like: "Does SNV followed by PLS with 10 components outperform MSC followed by PLS with 8 components on this dataset?"

---

## Steps

1. **Open the Results page.** Click **Results** in the left sidebar. Make sure you are on the **Scores** tab.

2. **Select chains to compare.** Hold **Ctrl** (or **Cmd** on macOS) and click on two or more chain cards. A blue selection highlight appears around each selected card. A **Compare** button appears in the toolbar.

   :::{tip}
   You can select chains from different dataset groups to compare how the same pipeline variant behaves on different data.
   :::

3. **Open the comparison view.** Click the **Compare** button. A side-by-side panel opens showing the selected chains.

4. **Read the comparison table.** The table displays one column per selected chain and rows for:

   - **Metrics** -- R2, RMSE, MAE (regression) or Accuracy, F1, Precision, Recall (classification).
   - **Fold scores** -- individual fold values so you can assess stability.
   - **Standard deviation** -- how much scores vary across folds. Lower is better.
   - **Pipeline steps** -- the exact sequence of steps in each chain, making it easy to spot differences.

5. **Use the ranking.** The comparison view highlights the **best value** in each metric row with a bold style. This makes it straightforward to see which chain wins on each criterion.

6. **Narrow down your selection.** If you selected many chains, use the column visibility toggles at the top to hide chains you are no longer interested in, without leaving the comparison view.

:::{note}
The ranking uses the same direction convention as the Scores page: for R2 and accuracy, higher is better; for RMSE and MAE, lower is better. The best value in each row is always highlighted.
:::

:::{warning}
Comparing chains across datasets with very different sample sizes or target ranges requires caution. An R2 of 0.90 on a small, noisy dataset may be more impressive than an R2 of 0.95 on a large, clean one. Always consider the context alongside raw numbers.
:::

---

## What's Next

- {doc}`../explore/inspector-basics` -- open a chain in the Inspector to visualize its predictions.
- {doc}`export-model` -- export the best chain as a reusable model bundle.
- {doc}`aggregated-results` -- view cross-dataset aggregation of chain performance.
