# Review Execution Logs

This guide explains how to use the log panel on the Run Progress page to find information about experiment execution, diagnose failures, and understand unexpected results.

---

## Open the log panel

1. Go to the **Run Progress** page. You can get there from the left sidebar by clicking **Run**, or by clicking the **floating run widget** if an experiment is active.
2. At the bottom of the page, locate the **log panel**. Click on it or click the **expand** icon to open it to full height.

```{figure} /_images/how-to/experiments/exp-logs-expanded.png
:alt: Expanded log panel
:width: 100%

The expanded log panel shows timestamped execution entries.
```

---

## Filter logs by level

The log panel provides level filters to help you focus on what matters. Click the filter buttons at the top of the log panel to toggle each level:

| Level | What it shows |
|---|---|
| **Error** | Failures that prevented a fold or variant from completing. |
| **Warning** | Non-fatal issues such as convergence warnings, missing values handled automatically, or unusually high error values. |
| **Info** | Normal execution milestones: step started, fold completed, metrics computed. |
| **Debug** | Detailed internal information useful for troubleshooting: data shapes, parameter values, timing. |

:::{tip}
Start with **Error** and **Warning** filters if you are investigating a problem. Switch to **Info** to get the full picture of what happened, and use **Debug** only when you need deep detail.
:::

---

## Search through logs

Use the **search bar** at the top of the log panel to find specific entries. You can search by:

- Step name (for example, `PLSRegression` or `SNV`).
- Fold number (for example, `Fold 3`).
- Error messages or keywords (for example, `convergence` or `singular`).

The log panel highlights matching entries and scrolls to the first match. Use the up and down arrows next to the search bar to navigate between matches.

---

## Understand log context

Each log entry includes contextual information:

- **Timestamp** -- when the event occurred.
- **Level** -- the severity (error, warning, info, or debug).
- **Fold/variant context** -- which fold and variant the entry belongs to (for example, `[Fold 2/5, Variant 3/12]`).
- **Step name** -- which pipeline step produced the entry.

This context makes it easy to pinpoint exactly where an issue occurred, even in experiments with many folds and variants.

---

## Common log patterns

### Successful execution

```text
[INFO] Step SNV started
[INFO] Step SNV completed (0.12s)
[INFO] Fold 1/5 - RMSE: 0.423, R2: 0.951
[INFO] Fold 2/5 - RMSE: 0.441, R2: 0.947
```

### Convergence warning

```text
[WARNING] PLSRegression: convergence not reached after 500 iterations
```

This usually means the model needs more iterations or fewer components. Consider adjusting the model parameters.

### Data issue

```text
[WARNING] 3 samples contain NaN values in target column - excluded from training
```

Check your dataset for missing values. See {doc}`../datasets/inspect-data` for how to explore raw data.

### Failure

```text
[ERROR] Fold 3/5 failed: singular matrix encountered in PLSRegression
```

This can happen when the data has highly collinear features or too few samples for the number of components. Try reducing `n_components` in your PLS model or adding preprocessing steps.

---

## Use logs to diagnose failures

If an experiment fails or produces unexpected results:

1. **Filter by Error** to see if any folds failed outright.
2. **Filter by Warning** to check for convergence issues or data problems.
3. **Search for the model name** to see all entries related to the model step.
4. **Check fold-by-fold scores** in the Info entries to see if a specific fold is the outlier.

:::{note}
Log entries persist after the experiment completes. You can return to the Run Progress page for any past experiment to review its logs.
:::

---

## See also

- {doc}`monitor-progress` -- Overview of the Run Progress page.
- {doc}`stop-experiment` -- Stop an experiment when logs reveal a problem.
- {doc}`../results/view-scores` -- Check the final scores alongside the logs.
