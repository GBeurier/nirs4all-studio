# Getting Started with the Inspector

The Inspector is a visualization tool that lets you explore the predictions and performance of a trained model in depth. It offers multiple chart types -- from scatter plots to confusion matrices -- so you can understand *how* your model behaves, not just its headline score.

## Prerequisites

- At least one experiment has completed successfully (see {doc}`../experiments/launch-experiment`).
- You have identified a chain you want to inspect (see {doc}`../results/view-scores`).

---

## Steps

1. **Open the Inspector.** There are two ways to get there:

   - From the **Results** page: click on a chain card, then click the **Inspect** button.
   - From the sidebar: click **Inspector**, then select an experiment and chain from the dropdowns at the top of the page.

   ```{figure} ../../_images/explore/ins-overview.png
   :alt: Inspector page showing visualization tabs and a scatter plot
   :width: 100%

   The Inspector displays interactive visualizations for the selected chain's predictions.
   ```

2. **Select the experiment and chain.** If you opened the Inspector from the sidebar, use the dropdowns at the top to choose:

   - **Experiment** -- the experiment session.
   - **Dataset** -- the dataset within that experiment.
   - **Chain** -- the specific pipeline chain to visualize.

3. **Explore the visualization tabs.** The Inspector offers several views, each accessible as a tab:

   | Tab                  | What it shows                                              |
   | -------------------- | ---------------------------------------------------------- |
   | **Scatter**          | Predicted vs. actual values as a scatter plot.             |
   | **Heatmap**          | Density map of predicted vs. actual values.                |
   | **Histogram**        | Distribution of residuals (prediction errors).             |
   | **Candlestick**      | Per-fold score ranges displayed as candlestick bars.       |
   | **Residuals**        | Residual values plotted against actual values.             |
   | **Confusion Matrix** | Classification accuracy per class (classification only).   |
   | **Rankings**         | Side-by-side metric comparison across chains.              |

   Click any tab to switch to that view.

4. **Interact with the charts.** All Inspector charts are interactive:

   - **Hover** over data points to see tooltips with sample details.
   - **Click** on a data point to highlight it across all views.
   - **Zoom** by clicking and dragging to select a region.
   - **Pan** by holding Shift and dragging.

5. **Filter by fold or split.** Use the controls below the chart to show only specific cross-validation folds or only train/test samples. This helps you check whether the model performs consistently across folds.

   :::{tip}
   Start with the **Scatter** view to get a quick visual sense of model accuracy. If the points cluster tightly around the diagonal line, the model is performing well. Then switch to **Residuals** to check for systematic errors.
   :::

:::{note}
The available tabs depend on the task type. Regression chains show Scatter, Heatmap, Histogram, Candlestick, Residuals, and Rankings. Classification chains show Scatter (with jitter), Confusion Matrix, and Rankings.
:::

---

## What's Next

- {doc}`inspector-views` -- learn what each visualization type tells you and how to interpret it.
- {doc}`../results/compare-chains` -- compare multiple chains before choosing which to inspect.
- {doc}`../results/export-predictions` -- export the prediction data shown in the Inspector.
