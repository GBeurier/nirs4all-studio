# Use Inspector Visualization Views

This guide details each visualization view available in the Inspector. Each view reveals a different aspect of your model's predictions, helping you build a complete picture of its strengths and weaknesses.

## Prerequisites

- You have opened the Inspector and selected a chain (see {doc}`inspector-basics`).

---

## Scatter (Predicted vs. Actual)

The scatter plot places **actual values** on the X-axis and **predicted values** on the Y-axis. A perfect model would place every point exactly on the diagonal line.

- **Tight cluster along the diagonal** -- the model is accurate and consistent.
- **Spread around the diagonal** -- the model has variance; predictions are noisy.
- **Curved pattern** -- the model may have a systematic bias at certain value ranges.
- **Isolated points far from the diagonal** -- potential outliers or samples the model cannot handle.

:::{tip}
Look for clusters of points that deviate from the diagonal in a specific value range. This often indicates that the model needs more training data in that region or that the preprocessing is not handling those samples well.
:::

---

## Heatmap

The heatmap is a 2D density version of the scatter plot. Instead of individual points, it shows colored regions where brighter colors mean more samples are concentrated. This view is especially useful when you have many samples and the scatter plot becomes crowded.

- **Bright diagonal band** -- most predictions are close to the true values.
- **Off-diagonal hotspots** -- groups of samples where the model consistently over- or under-predicts.

---

## Histogram (Residual Distribution)

The histogram shows the **distribution of residuals** (predicted minus actual). A well-performing model produces a narrow, bell-shaped histogram centered at zero.

- **Centered at zero** -- the model has no systematic bias.
- **Shifted left or right** -- the model consistently over-predicts (right shift) or under-predicts (left shift).
- **Wide distribution** -- the model has high variance and its predictions are imprecise.
- **Long tails** -- a few samples have very large errors, which may be outliers.

:::{note}
The histogram also displays summary statistics: mean residual, standard deviation, and the percentage of samples within one and two standard deviations.
:::

---

## Candlestick (Fold Scores)

The candlestick chart shows the **score range across cross-validation folds**, displayed similarly to a financial candlestick chart. Each bar represents one fold:

- The **body** spans from the 25th to the 75th percentile of the score.
- The **wicks** extend to the minimum and maximum score.
- The **center line** marks the median.

This view helps you assess **model stability**. If the bars are similar in height and position, the model performs consistently. If one bar is much lower, that fold may contain difficult samples.

---

## Residuals (Residuals vs. Actual)

The residuals plot places **actual values** on the X-axis and **residuals** (predicted minus actual) on the Y-axis. In an ideal model, the residuals are randomly scattered around zero with no pattern.

- **Random scatter around zero** -- the model has no systematic bias.
- **Fan shape** (wider at one end) -- the model's error increases with the magnitude of the target value. This is called heteroscedasticity.
- **Curved pattern** -- the model is missing a nonlinear relationship in the data.

:::{warning}
A clear pattern in the residuals plot is a sign that the model is not capturing all the structure in the data. Consider adding more preprocessing steps, trying a different model, or checking for missing covariates.
:::

---

## Confusion Matrix (Classification Only)

The confusion matrix is a grid showing how the model classified samples across all classes. Rows represent **actual classes** and columns represent **predicted classes**.

- **Diagonal cells** -- correctly classified samples. Higher numbers are better.
- **Off-diagonal cells** -- misclassifications. The row tells you the true class, and the column tells you what the model predicted instead.

The matrix is color-coded: darker cells indicate higher counts. Use it to identify which classes the model confuses most often.

:::{tip}
If two classes are frequently confused, their spectra may be very similar. Consider adding more preprocessing or collecting more training samples for those classes.
:::

---

## Rankings

The rankings view compares **multiple chains** side by side on key metrics. Each chain is shown as a row with columns for R2, RMSE, MAE (regression) or Accuracy, F1, Precision, Recall (classification). The best value in each column is highlighted.

This view is available even when you opened the Inspector for a single chain -- it shows all chains from the same experiment and dataset for context. Use it to confirm that your selected chain is indeed the best performer, or to discover close alternatives.

---

## What's Next

- {doc}`inspector-basics` -- revisit the Inspector layout and interaction controls.
- {doc}`../results/view-scores` -- return to the Scores page to pick a different chain.
- {doc}`../results/export-predictions` -- export the prediction data you have been visualizing.
