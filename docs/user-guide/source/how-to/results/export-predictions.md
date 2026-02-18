# Export Predictions

This guide shows you how to export prediction results from nirs4all Studio as CSV or Excel files. Exported predictions contain the predicted values, actual values, and residuals for every sample evaluated during an experiment.

## Prerequisites

- At least one experiment has completed successfully (see {doc}`../experiments/launch-experiment`).
- Predictions have been stored for the chains you want to export (this is the default behavior).

---

## Steps

1. **Open the Predictions page.** Click **Results** in the left sidebar, then select the **Predictions** tab.

   ```{figure} ../../_images/results/res-predictions-overview.png
   :alt: Predictions page showing stored prediction sets
   :width: 100%

   The Predictions page lists all stored prediction sets with their experiment, dataset, and chain information.
   ```

2. **Find the predictions you want to export.** Each row in the table represents a prediction set tied to a specific chain and dataset. Use the search bar or column filters to narrow down the list.

3. **Select prediction sets.** Check the box next to one or more prediction sets you want to export. A toolbar appears with export options.

4. **Choose the export format.** Click the **Export** button in the toolbar and select a format:

   - **CSV** -- comma-separated values, compatible with any spreadsheet or data tool.
   - **Excel (.xlsx)** -- a formatted Excel workbook.

5. **Save the file.** A file dialog appears. Choose a location and file name, then confirm. The file is saved to your computer.

6. **Review the exported columns.** The exported file contains the following columns:

   | Column        | Description                                                |
   | ------------- | ---------------------------------------------------------- |
   | **Sample**    | Sample identifier or row index.                            |
   | **Predicted** | The value predicted by the model.                          |
   | **Actual**    | The true reference value from the dataset.                 |
   | **Residual**  | The difference between predicted and actual (Predicted - Actual). |
   | **Fold**      | Which cross-validation fold the sample belonged to.        |
   | **Split**     | Whether the sample was in the Train or Test set.           |

   :::{tip}
   The **Residual** column is useful for quickly identifying samples where the model struggled. Large absolute residuals point to potential outliers or difficult-to-predict samples.
   :::

:::{note}
For classification tasks, the columns are slightly different: **Predicted** contains the predicted class label, **Actual** contains the true class label, and **Probability** columns show the model's confidence for each class.
:::

:::{warning}
If you export predictions from multiple chains into the same file, make sure each prediction set is clearly identifiable. The export includes **Chain** and **Dataset** columns to help distinguish them.
:::

---

## What's Next

- {doc}`manage-predictions` -- manage, filter, and delete stored predictions.
- {doc}`../explore/inspector-basics` -- visualize predictions with scatter plots and residual charts.
- {doc}`export-model` -- export the trained model itself for use outside the app.
