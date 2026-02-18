# Launch an Experiment

This guide walks you through launching an experiment in nirs4all Studio. An experiment applies one or more pipelines to one or more datasets and produces scored results for every combination.

:::{admonition} Prerequisites
:class: note

- At least one dataset has been imported into your workspace (see {doc}`../datasets/import-csv`).
- At least one pipeline has been saved to your library (see {doc}`../pipelines/create-pipeline`).
:::

---

## Step 1 -- Select datasets

1. Click **Run** in the left sidebar. The experiment wizard opens on the **Select Datasets** step.

   ```{figure} /_images/how-to/experiments/exp-select-datasets.png
   :alt: Dataset selection step
   :width: 100%

   Check one or more datasets to include in the experiment.
   ```

2. Browse the list of available datasets. Each row shows the dataset name, sample count, and feature count.
3. **Check the box** next to every dataset you want to include. You can select as many as you like.
4. Click **Next** to continue.

:::{tip}
If you have many datasets, use the search bar at the top to filter by name. You can also filter by group if you have organized your datasets into groups.
:::

---

## Step 2 -- Select pipelines

1. On the **Select Pipelines** step, you see all saved pipelines and built-in presets.

   ```{figure} /_images/how-to/experiments/exp-select-pipelines.png
   :alt: Pipeline selection step
   :width: 100%

   Check one or more pipelines to run against the selected datasets.
   ```

2. **Check the box** next to each pipeline you want to run. You can mix your own pipelines with built-in presets.
3. Use the filter dropdown to show only **Presets**, **Favorites**, or **All**.
4. Click **Next** to continue.

:::{note}
Every selected pipeline will be run against every selected dataset. For example, selecting 3 datasets and 2 pipelines produces 6 runs.
:::

---

## Step 3 -- Review the experiment

1. On the **Review** step, you see a summary of your choices.

   ```{figure} /_images/how-to/experiments/exp-review.png
   :alt: Experiment review step
   :width: 100%

   Review your experiment settings before launching.
   ```

2. **Experiment name** -- an auto-generated name appears (for example, `Corn x SNV + PLS`). Edit it if you want a more descriptive name.
3. **Description** -- optionally add notes about the purpose of this experiment.
4. Review the **total run count** displayed at the bottom. This is the number of dataset-pipeline combinations that will be executed.
5. Click **Next** to proceed to the launch step.

---

## Step 4 -- Launch

1. On the **Launch** step, review the final summary one last time.
2. Click **Start** to begin the experiment.

   ```{figure} /_images/how-to/experiments/exp-launch.png
   :alt: Launch button
   :width: 100%

   Click Start to begin running the experiment.
   ```

3. You are automatically redirected to the **Run Progress** page, where you can monitor the experiment in real time.

:::{important}
Once started, the experiment runs in the background. You can navigate to other pages and return to the Run Progress page at any time using the floating run widget in the bottom-right corner of the screen.
:::

---

## What happens next

After launching, nirs4all Studio executes each dataset-pipeline combination sequentially. For each combination it:

1. Loads the dataset.
2. Applies the preprocessing steps from the pipeline.
3. Splits the data according to the splitter configuration.
4. Trains and evaluates the model across all folds.
5. Records the scores and predictions.

When all runs complete, the results are available on the {doc}`../results/view-scores` page.

---

## See also

- {doc}`monitor-progress` -- Watch experiment progress in real time.
- {doc}`stop-experiment` -- Cancel a running experiment.
- {doc}`../results/view-scores` -- View the scores after the experiment finishes.
