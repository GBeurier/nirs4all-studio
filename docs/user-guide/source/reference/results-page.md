# Results Page

The Results page displays experiment outcomes grouped by dataset. It provides a structured view of model performance, allowing you to compare preprocessing chains, scores, and metrics across all experiments in the workspace.

```{figure} ../_images/results/res-scores-overview.png
:alt: Results page overview
:width: 100%

The Results page showing dataset cards with expandable chain lists and score comparisons.
```

---

## Page layout

1. **Header** -- Title, summary statistics, and a refresh button.
2. **Search bar** -- Text input to filter datasets by name.
3. **Dataset cards** -- Collapsible cards, one per dataset, listing the top-performing chains.

---

## Summary statistics

Displayed as compact stat cards at the top of the page:

| Stat | Description |
|------|-------------|
| **Datasets** | Number of datasets with results. |
| **Total models** | Total number of chains (preprocessing + model combinations) across all datasets. |
| **Best final score** | The highest final (refit) test score found across all datasets, with its metric name and model type. |
| **Best CV score** | The highest cross-validation score found, with its metric name. |

---

## Search

The search input filters the dataset card list by dataset name (case-insensitive substring match). Only datasets whose names match the query are displayed.

---

## Dataset cards

Each dataset that has experiment results is shown as a collapsible card. The first dataset is expanded by default.

### Card header

| Element | Description |
|---------|-------------|
| **Dataset name** | Name of the dataset. |
| **Metric** | The primary evaluation metric for this dataset (e.g., R2, RMSE, accuracy). Auto-detected based on task type (regression vs. classification). |
| **Chain count** | Number of unique preprocessing+model chains evaluated for this dataset. |
| **Expand/collapse** | Chevron icon to toggle the chain list visibility. |

### Chain list

When expanded, the card shows a ranked list of the top-performing chains (sorted by score, best first). Each chain entry displays:

| Column | Description |
|--------|-------------|
| **Rank** | Position in the ranking (1 = best). |
| **Chain description** | Preprocessing steps and model name displayed as a chain (e.g., "SNV > SavitzkyGolay(d=1) > PLSRegression(10)"). |
| **Model name** | The model used in this chain (e.g., PLSRegression, Ridge, RandomForest). |
| **CV score** | Average cross-validation score across all folds. This is the primary ranking metric. |
| **CV std** | Standard deviation of the cross-validation scores across folds, indicating score stability. |
| **Final test score** | Score from the final refit model evaluated on held-out test data. Shown only when a refit was performed. Highlighted with a distinct badge. |
| **Fold count** | Number of cross-validation folds used. |

:::{note}
Chains with a final test score are highlighted because the final score is evaluated on data the model has never seen during cross-validation, making it the most reliable performance estimate.
:::

---

## Score formatting

Scores are formatted based on the metric type:

| Metric | Format | Better direction |
|--------|--------|-----------------|
| **R2** | Decimal (e.g., 0.9542) | Higher is better |
| **RMSE** | Decimal (e.g., 0.312) | Lower is better |
| **MAE** | Decimal (e.g., 0.245) | Lower is better |
| **Accuracy** | Percentage (e.g., 95.4%) | Higher is better |
| **F1** | Decimal (e.g., 0.921) | Higher is better |

The sorting logic accounts for the metric direction -- chains are always ranked with the best score first, regardless of whether lower or higher values are better.

---

## Export

| Action | Description |
|--------|-------------|
| **Export CSV** | Exports the full results table (all datasets, all chains) as a CSV file to the workspace `exports/` directory. |
| **View in Aggregated Results** | Link to the Aggregated Results page for cross-dataset comparison and advanced filtering. |

---

## Interaction with other pages

- **From History**: After an experiment completes, the History page provides a "View Results" link that navigates here.
- **To Aggregated Results**: The Results page links to the Aggregated Results page for deeper analysis.
- **To Predictions**: Individual chains can be selected to generate predictions on new data via the Predictions page.

:::{tip}
If you have run the same pipeline on multiple datasets, use the search bar to quickly locate a specific dataset's results. For cross-dataset comparison, use the Aggregated Results page instead.
:::

:::{seealso}
- {doc}`history-page` -- Viewing all experiment runs
- {doc}`run-progress-page` -- Monitoring experiments in real time
- {doc}`experiment-wizard` -- Creating new experiments
:::
