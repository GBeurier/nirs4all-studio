(analyze-model-performance)=
# Analyze Model Performance

**Time**: ~15 minutes | **Level**: Intermediate

A single score number (R2, RMSE, accuracy) tells you *how well* a model performs, but not *where* or *why* it fails. The **Inspector** page in nirs4all Studio provides a suite of interactive visualizations that let you diagnose model behavior in depth: spot outlier predictions, identify bias, understand error patterns, and compare models.

In this tutorial you will walk through each Inspector view, learn what it reveals, and understand how to use the insights to improve your analysis.

:::{admonition} Prerequisites
:class: note

- You have completed at least one experiment with results (see {doc}`first-experiment`).
- The experiment should have at least one completed run with predictions available. Multi-variant experiments (see {doc}`build-advanced-pipeline`) are ideal because you can compare across configurations.
:::

---

## Step 1 -- Open the Inspector

1. Click **Inspector** in the left sidebar. The Inspector page opens.
2. At the top of the page, you will see a **Select Experiment** dropdown. Click it and choose the experiment you want to analyze.
3. If the experiment contains multiple runs (multiple datasets or pipeline variants), a second dropdown appears to select a specific **run** or **chain**. You can also select **All Runs** to compare across variants.

```{figure} ../_images/inspector/insp-overview.png
:alt: Inspector page with experiment selector and visualization tabs
:width: 100%

The Inspector page with the experiment selector at the top and visualization tabs below.
```

4. Once you select an experiment, the Inspector loads the predictions, actual values, and model metadata. The main area displays a set of visualization tabs.

---

## Step 2 -- Scatter plot (Predicted vs Actual)

The scatter plot is the most fundamental model diagnostic for regression tasks. It plots predicted values on the y-axis against actual (reference) values on the x-axis.

1. Click the **Scatter** tab (this is usually the default view).
2. Each point represents one sample. The diagonal dashed line is the **identity line** (where predicted equals actual).

```{figure} ../_images/inspector/insp-scatter.png
:alt: Predicted vs Actual scatter plot with identity line and regression fit
:width: 100%

The scatter plot shows each sample's predicted value against its actual reference value.
```

### What to look for

| Pattern | Meaning | Action |
|---|---|---|
| Points tightly clustered around the diagonal | Excellent model -- predictions match reality | None needed |
| Points scattered widely around the diagonal | High prediction error | Try more preprocessing, more components, or a different model |
| Points curve away from the diagonal at extremes | Nonlinear bias -- the model under-predicts high values or over-predicts low values | Consider a nonlinear model (Random Forest, SVR) or polynomial PLS |
| A few points far from the diagonal | Outlier samples | Investigate those samples; they may have measurement errors |
| Points form a horizontal band | The model predicts nearly the same value for all samples | The model has not learned; check your pipeline and data |

### Interactive features

- **Hover** over a point to see the sample ID, actual value, and predicted value.
- **Click** on a point to select it. Selected samples are highlighted across all Inspector views.
- **Lasso selection**: click and drag to select a group of points. This is useful for investigating clusters of poorly predicted samples.
- The **statistics panel** on the side shows R2, RMSE, RMSEP, bias, and the regression line equation.

:::{tip}
If you ran multiple pipeline variants, use the **Chain** dropdown to switch between them. The scatter plot updates instantly, letting you visually compare how different configurations affect prediction quality.
:::

---

## Step 3 -- Residuals plot

The residuals plot shows the prediction errors (residuals) for each sample. A residual is the difference between the predicted value and the actual value.

1. Click the **Residuals** tab.
2. The chart plots residuals on the y-axis against the actual values (or sample index) on the x-axis. A horizontal line at zero represents perfect prediction.

```{figure} ../_images/inspector/insp-residuals.png
:alt: Residuals plot showing prediction errors across samples
:width: 100%

The residuals plot reveals patterns in prediction errors that the scatter plot may hide.
```

### What to look for

| Pattern | Meaning | Action |
|---|---|---|
| Residuals randomly scattered around zero | No systematic bias -- the model errors are random | Good sign |
| Residuals trend upward or downward | Systematic bias -- the model consistently over- or under-predicts in certain ranges | The model may be too simple; try adding components or changing the model type |
| Residuals fan out (wider at higher values) | Heteroscedasticity -- prediction error increases with the magnitude of the target | Consider log-transforming the target or using a y-processing step |
| A few residuals much larger than others | Outlier samples | Investigate those samples for data quality issues |

:::{note}
You can toggle between plotting residuals against **actual values** and against **sample index** using the x-axis selector in the toolbar. Plotting against sample index can reveal temporal patterns (e.g., instrument drift over time).
:::

---

## Step 4 -- Heatmap

The heatmap provides a matrix view of prediction performance across different subsets of the data.

1. Click the **Heatmap** tab.
2. The heatmap displays a grid where rows and columns represent bins of actual and predicted values. The color intensity indicates how many samples fall into each bin.

```{figure} ../_images/inspector/insp-heatmap.png
:alt: Heatmap showing density of predicted vs actual value bins
:width: 100%

The heatmap reveals where predictions concentrate and where errors occur.
```

### What to look for

- A **strong diagonal band** of dark cells indicates that most predictions are close to the actual values.
- **Off-diagonal clusters** indicate systematic errors in specific value ranges.
- **Empty regions** along the diagonal indicate gaps in the training data distribution.

:::{tip}
The heatmap is particularly useful for large datasets (hundreds or thousands of samples) where the scatter plot becomes too crowded to read. The binned view makes density patterns clearly visible.
:::

---

## Step 5 -- Error histogram

The histogram view shows the distribution of prediction errors across all samples.

1. Click the **Histogram** tab.
2. The chart displays a histogram of residuals (predicted minus actual). The x-axis is the error magnitude, and the y-axis is the number of samples.

```{figure} ../_images/inspector/insp-histogram.png
:alt: Histogram of prediction errors with a bell curve overlay
:width: 100%

The error histogram shows whether prediction errors follow a normal distribution.
```

### What to look for

| Pattern | Meaning |
|---|---|
| Symmetric bell shape centered at zero | Errors are normally distributed with no bias -- ideal |
| Bell shape shifted left or right of zero | Systematic bias (the model consistently over- or under-predicts) |
| Long tails on one or both sides | Heavy-tailed error distribution; outlier predictions are present |
| Multiple peaks | The data may contain subgroups that the model handles differently |

The histogram also displays summary statistics: mean error, standard deviation, skewness, and kurtosis.

---

## Step 6 -- Candlestick chart

The candlestick view summarizes cross-validation fold performance, showing the variability of scores across folds.

1. Click the **Candlestick** tab.
2. Each candlestick represents one pipeline chain. The body shows the interquartile range (25th to 75th percentile of fold scores), and the whiskers show the minimum and maximum fold scores. A horizontal line marks the median.

```{figure} ../_images/inspector/insp-candlestick.png
:alt: Candlestick chart showing score variability across cross-validation folds
:width: 100%

The candlestick chart shows how stable each pipeline chain performs across cross-validation folds.
```

### What to look for

| Pattern | Meaning | Action |
|---|---|---|
| Short body and short whiskers | Stable performance across folds -- the model generalizes consistently | Good sign |
| Long body or long whiskers | High variability -- performance depends heavily on which samples are in the test set | The model may be overfitting; try more regularization or more data |
| One chain with higher median and shorter whiskers than another | That chain is both more accurate and more stable | Prefer that chain |

:::{tip}
This view is most useful when you have run multiple pipeline variants. It lets you compare not just average performance but also stability. A model with slightly lower average score but much tighter whiskers may be preferable in practice.
:::

---

## Step 7 -- Confusion matrix (classification only)

If your experiment involves a classification task (predicting categories rather than continuous values), the Inspector provides a confusion matrix.

1. Click the **Confusion Matrix** tab. This tab appears only for classification experiments.
2. The matrix shows a grid where rows are the actual classes and columns are the predicted classes. Each cell contains the count (or percentage) of samples.

```{figure} ../_images/inspector/insp-confusion-matrix.png
:alt: Confusion matrix for a classification experiment
:width: 100%

The confusion matrix shows which classes are correctly and incorrectly predicted.
```

### What to look for

- **Diagonal cells** (top-left to bottom-right) represent correct predictions. High numbers on the diagonal mean good classification.
- **Off-diagonal cells** represent misclassifications. A large number in a specific off-diagonal cell tells you which classes the model confuses.
- The **color gradient** highlights cells with higher counts.

Below the matrix, classification metrics are displayed:

| Metric | Description |
|---|---|
| **Accuracy** | Percentage of all samples correctly classified |
| **Precision** | For each class, the fraction of predicted positives that are correct |
| **Recall** | For each class, the fraction of actual positives that are correctly identified |
| **F1 Score** | The harmonic mean of precision and recall |

:::{note}
If you have an imbalanced dataset (one class has many more samples than another), accuracy alone can be misleading. Pay attention to precision and recall for the minority class.
:::

---

## Step 8 -- Rankings view

The rankings view provides a sortable leaderboard of all pipeline chains tested in the experiment.

1. Click the **Rankings** tab.
2. A table lists every chain with its key metrics: R2, RMSE, MAE (for regression) or accuracy, F1, precision, recall (for classification).
3. Click any column header to sort by that metric.
4. Click on a chain row to load its predictions into the other Inspector views (scatter, residuals, etc.).

```{figure} ../_images/inspector/insp-rankings.png
:alt: Rankings table showing all pipeline chains sorted by R2 score
:width: 100%

The rankings view lets you compare all pipeline chains side by side and drill into the best performers.
```

### Using rankings effectively

- Sort by **R2** (descending) to find the most accurate models.
- Sort by **RMSE** (ascending) to find the models with the smallest errors.
- Look at the **preprocessing chain** column to understand which preprocessing steps contribute to the best results.
- Select the top 2-3 chains and switch between them in the scatter and residuals views to understand how they differ.

:::{tip}
You can multi-select chains (hold Ctrl/Cmd and click) to overlay their scatter plots. This makes it easy to see where one model outperforms another.
:::

---

## Putting it all together

A recommended analysis workflow:

1. **Start with Rankings** to identify the best-performing chains.
2. **Open the Scatter plot** for the best chain to get an overall picture.
3. **Check the Residuals** for systematic bias or heteroscedasticity.
4. **Look at the Histogram** to confirm error distribution is approximately normal.
5. **Use the Candlestick** chart to check stability across folds.
6. **Compare** the top 2-3 chains to decide which one to export for predictions.

---

## What you learned

In this tutorial you:

1. Opened the Inspector and selected an experiment to analyze.
2. Used the **scatter plot** to assess overall prediction quality and identify outlier samples.
3. Used the **residuals plot** to detect systematic bias and error patterns.
4. Used the **heatmap** to visualize prediction density across value ranges.
5. Used the **error histogram** to check the distribution of prediction errors.
6. Used the **candlestick chart** to evaluate cross-validation stability.
7. Used the **confusion matrix** to diagnose classification performance.
8. Used the **rankings view** to compare all pipeline chains and select the best one.

---

## Next steps

- {doc}`batch-predictions` -- Export the best model and use it to predict new samples.
- {doc}`build-advanced-pipeline` -- If none of the models perform well enough, build a more advanced pipeline with more options.
- {doc}`compare-preprocessing` -- Use the Playground to explore preprocessing interactively before running a full experiment.
