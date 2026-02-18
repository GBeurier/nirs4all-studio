# Aggregated Results Page

The **Aggregated Results** page provides a cross-dataset view of model performance. Instead of examining results one dataset at a time, this page ranks models by their average metrics across every dataset they were evaluated on. Use it to identify models that generalize well rather than overfitting to a single dataset.

```{figure} ../_images/results/res-aggregated-overview.png
:alt: Aggregated Results page overview
:width: 100%

The Aggregated Results page showing models ranked by average performance across datasets.
```

---

## When to use this page

The Aggregated Results page is most valuable when you have:

- Multiple datasets from different instruments, sites, or batches.
- A collection of models trained or evaluated on several of those datasets.
- A need to select the model that performs best **on average**, not just on one specific dataset.

:::{tip}
If you are working with a single dataset, the standard {doc}`results-page` gives you a more detailed per-model breakdown. Switch to Aggregated Results once you have run experiments across two or more datasets.
:::

---

## Aggregation table

The main area of the page is a sortable, filterable table that summarizes each model's cross-dataset performance.

### Columns

| Column | Description |
|--------|-------------|
| **Model** | Name of the model (or pipeline chain) as defined during the experiment. |
| **Average R2** | Mean coefficient of determination across all datasets the model was evaluated on. Higher is better. |
| **Average RMSE** | Mean root-mean-square error across datasets. Lower is better. |
| **Dataset Count** | Number of distinct datasets included in the aggregation for this model. |
| **Rank** | Overall rank based on the currently selected sort metric. The top-performing model is ranked 1. |

:::{note}
For classification tasks, **Average Accuracy** and **Average F1** replace R2 and RMSE in the table columns. The page automatically detects the task type from your experiment metadata.
:::

### Sorting

Click any column header to sort the table by that metric. An arrow indicator shows the current sort direction. Click the same header again to toggle between ascending and descending order.

The **Rank** column updates dynamically when you change the sort metric. For example, sorting by Average RMSE ascending recalculates ranks so that the lowest-error model is ranked first.

### Filtering

Use the controls above the table to narrow the results:

| Control | Description |
|---------|-------------|
| **Search** | Text filter that matches against model names. Type a partial name to narrow the list. |
| **Metric selector** | Choose which metric drives the ranking: R2, RMSE, or (for classification) Accuracy, F1. |
| **Minimum dataset count** | Exclude models that were evaluated on fewer than N datasets. Useful for ensuring the aggregation is statistically meaningful. |

---

## Row details

Click any row to expand it and see the per-dataset breakdown for that model:

| Field | Description |
|-------|-------------|
| **Dataset name** | The name of each dataset included in the aggregation. |
| **R2 / RMSE** | The model's score on that specific dataset. |
| **Fold count** | Number of cross-validation folds used for evaluation. |
| **Run date** | When the experiment that produced this result was executed. |

This detail view lets you spot outlier datasets where a generally strong model performed poorly, or vice versa.

---

## Actions

| Action | Description |
|--------|-------------|
| **Export table** | Download the aggregated table as CSV or Excel for external reporting. |
| **Open in Inspector** | Jump to the {doc}`inspector-page` with the selected model pre-loaded for deeper visual analysis. |

---

## How aggregation works

The page groups results by model identity (name and configuration hash). For each group it computes the arithmetic mean of each metric across all datasets present. Models that were evaluated on different subsets of datasets are still shown, but the **Dataset Count** column helps you compare like with like.

:::{seealso}
- {doc}`results-page` -- Detailed per-dataset results for individual experiments.
- {doc}`inspector-page` -- Visual analysis of a specific model's predictions.
- {doc}`predictions-page` -- Access the raw prediction values behind these metrics.
:::
