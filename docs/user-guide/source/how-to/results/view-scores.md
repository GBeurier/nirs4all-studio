# View Experiment Scores

This guide shows you how to navigate to the Results page and read the scores produced by your experiments. Each score card summarizes how well a specific pipeline chain performed on a given dataset.

## Prerequisites

- You have completed at least one experiment (see {doc}`../experiments/launch-experiment`).
- The experiment has finished running and shows a green **Completed** status.

## Steps

1. **Open the Results page.** Click **Results** in the left sidebar. The Scores tab is shown by default.

   ```{figure} ../../_images/results/res-scores-overview.png
   :alt: Results page showing score cards grouped by dataset
   :width: 100%

   The Scores page displays results grouped by dataset, with pipeline chains ranked inside each group.
   ```

2. **Understand the layout.** Results are organized into collapsible groups -- one per dataset used in the experiment. Inside each group, you see a list of **chains** sorted by their best score.

3. **Read a score card.** Each card shows:

   - **Chain name** -- the specific combination of preprocessing, splitter, and model that was evaluated.
   - **Primary metric** -- the headline score. For regression tasks this is typically **R2** (coefficient of determination). For classification tasks it is **Accuracy**.
   - **Secondary metrics** -- additional numbers such as **RMSE** (Root Mean Squared Error), **MAE**, or **F1-score** depending on the task type.
   - **Fold summary** -- the mean and standard deviation across cross-validation folds.

   :::{tip}
   A higher R2 (closer to 1.0) means the model explains more of the variation in your data. A lower RMSE means the model's predictions are closer to the actual values. For classification, higher accuracy means more correct predictions.
   :::

4. **Sort the chains.** Use the **Sort by** dropdown above the chain list to rank chains by a different metric (R2, RMSE, MAE, or accuracy). The default sort places the best-performing chain at the top.

5. **Filter results.** Use the search bar or filter controls to narrow down results:

   - **By experiment** -- select a specific experiment from the dropdown.
   - **By pipeline** -- show only chains that originate from a particular pipeline.
   - **By text** -- type a keyword to filter chain names.

6. **Expand a chain for details.** Click on any chain card to expand it. The expanded view shows per-fold scores, timing information, and quick-action buttons to open the chain in the Inspector or export the model.

:::{note}
A **chain** is a single fully-resolved variant of a pipeline. If your pipeline contains generators (such as `_or_` or `_range_`), each generated combination becomes a separate chain. A pipeline with `_or_: [SNV, MSC]` and `_range_: [5, 15, 3]` for PLS components produces multiple chains -- one for each SNV/MSC and component-count combination.
:::

---

## What's Next

- {doc}`compare-chains` -- select multiple chains and compare them side by side.
- {doc}`../explore/inspector-basics` -- visualize a chain's predictions in detail.
- {doc}`export-model` -- export the best chain's trained model.
