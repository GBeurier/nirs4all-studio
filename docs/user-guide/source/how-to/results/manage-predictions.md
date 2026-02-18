# Manage Stored Predictions

This guide explains how to view, filter, and delete stored predictions in nirs4all Studio. Predictions are automatically saved when experiments complete, and you can manage them from the Predictions page.

## Prerequisites

- At least one experiment has completed and generated predictions (see {doc}`../experiments/launch-experiment`).

---

## Steps

### View stored predictions

1. **Open the Predictions page.** Click **Results** in the left sidebar, then select the **Predictions** tab.

2. **Browse the prediction list.** The table shows all stored prediction sets. Each row displays:

   - **Experiment name** -- the experiment that produced this prediction set.
   - **Dataset** -- which dataset the predictions were generated for.
   - **Chain** -- the specific pipeline chain (preprocessing + model combination).
   - **Date** -- when the predictions were created.
   - **Sample count** -- how many samples are included.
   - **Metric summary** -- the headline score (R2 or accuracy) for quick reference.

3. **View prediction details.** Click on any row to expand it and see a preview of the predicted vs. actual values in a small table.

### Filter predictions

4. **Filter by experiment.** Use the **Experiment** dropdown at the top to show only predictions from a specific experiment.

5. **Filter by dataset.** Use the **Dataset** dropdown to narrow down predictions to a single dataset.

6. **Search by name.** Type in the search bar to filter by chain name, experiment name, or dataset name.

   :::{tip}
   Combine filters to quickly find a specific prediction set. For example, select an experiment *and* a dataset to see only the chains evaluated on that combination.
   :::

### Delete predictions

7. **Select predictions to delete.** Check the box next to one or more prediction sets.

8. **Click Delete.** Click the **Delete** button in the toolbar that appears. A confirmation dialog asks you to confirm.

9. **Confirm the deletion.** Click **Confirm** to permanently remove the selected prediction sets from the workspace.

:::{warning}
Deleting predictions is permanent. The prediction data is removed from the workspace database and cannot be recovered. The experiment results and trained models are *not* affected -- only the stored prediction values are removed.
:::

:::{note}
Predictions are linked to their parent experiment. If you delete an experiment from the History page, all associated predictions are also deleted automatically. Deleting individual prediction sets from this page does not affect the experiment or its scores.
:::

---

## How Predictions Are Linked

Each prediction set is tied to three things:

- **Experiment** -- the run session that produced it.
- **Dataset** -- the specific data the model was evaluated on.
- **Chain** -- the exact pipeline variant (preprocessing + splitter + model) that generated the predictions.

This three-way link means you can always trace a prediction back to its origin. It also means that running the same pipeline on the same dataset in a new experiment creates a *new* prediction set -- it does not overwrite the previous one.

---

## What's Next

- {doc}`export-predictions` -- export prediction sets as CSV or Excel files.
- {doc}`../explore/inspector-basics` -- visualize predictions with interactive charts.
- {doc}`view-scores` -- review the scores associated with these predictions.
