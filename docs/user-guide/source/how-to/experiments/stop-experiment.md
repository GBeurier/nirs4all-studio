# Stop an Experiment

This guide explains how to stop a running experiment and what happens to partial results.

---

## Step 1 -- Open the Run Progress page

Navigate to the **Run Progress** page. If you are on another page, click the **floating run widget** in the bottom-right corner to go there directly.

---

## Step 2 -- Click the Stop button

1. Locate the **Stop** button near the top of the Run Progress page, next to the progress bar.

   ```{figure} /_images/how-to/experiments/exp-stop-button.png
   :alt: Stop button on the Run Progress page
   :width: 100%

   Click Stop to cancel the running experiment.
   ```

2. Click **Stop**. A confirmation dialog appears asking you to confirm the cancellation.
3. Click **Confirm** to proceed.

---

## What happens when you stop

The experiment does not terminate immediately. Instead, it **stops gracefully** after completing the current fold. This approach ensures that no partial fold data is left in an inconsistent state.

- **Completed folds and variants** are saved. Any results that were already computed remain available.
- **The current fold** finishes processing before the experiment halts.
- **Remaining folds and variants** are skipped.

:::{note}
Depending on the model complexity and dataset size, there may be a short delay between clicking Stop and the experiment actually halting. This is because the current fold needs to finish.
:::

---

## Step 3 -- Review partial results

After the experiment stops, the Run Progress page shows a status of **Stopped** along with a summary of what was completed.

1. Go to the **Results** page from the left sidebar.
2. Find the stopped experiment. Partial results are available for all folds and variants that completed before the stop.
3. You can review these partial results just like you would for a fully completed experiment.

:::{tip}
Partial results can still be useful. If you stopped early because you noticed poor scores, the completed folds give you enough information to decide whether to adjust your pipeline before running again.
:::

---

## See also

- {doc}`monitor-progress` -- Track experiment progress in real time.
- {doc}`review-logs` -- Check logs for errors or warnings that prompted the stop.
- {doc}`../results/view-scores` -- View the scores from completed folds.
