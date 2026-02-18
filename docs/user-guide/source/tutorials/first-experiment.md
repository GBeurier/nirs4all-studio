(first-experiment)=
# Your First Experiment

**Time**: ~15 minutes | **Level**: Beginner

In this tutorial you will walk through the complete nirs4all Studio workflow: importing a dataset, verifying the data, building a simple analysis pipeline, running an experiment, and viewing the results. By the end you will have a trained model and understand the core loop of the application.

:::{admonition} Prerequisites
:class: note

- nirs4all Studio is installed and running (see {doc}`../getting-started/installation`).
- You have created a workspace during first launch (see {doc}`../getting-started/first-launch`).
- You have a CSV file with spectral data ready to import. If you do not have one, you can generate synthetic data instead (see {doc}`synthetic-data-testing`).
:::

---

## Step 1 -- Verify your workspace

Before importing data, make sure your workspace is properly configured.

1. Click **Settings** in the left sidebar.
2. Under **Workspaces**, confirm that at least one workspace is listed and marked as **Active**.
3. If no workspace appears, click **Link Workspace** and select a folder on your computer. This folder will store datasets, pipelines, and experiment results.

:::{tip}
A workspace is just a folder on your disk. It contains a `store.duckdb` database, an `artifacts/` directory for trained models, and an `exports/` directory for bundles. You can link multiple workspaces and switch between them at any time.
:::

---

## Step 2 -- Import a CSV dataset

1. Click **Datasets** in the left sidebar. You will see the Datasets page listing any previously imported datasets.

   ```{figure} ../_images/datasets/ds-page-overview.png
   :alt: Datasets page overview
   :width: 100%

   The Datasets page shows all datasets in the active workspace.
   ```

2. Click the **Import** button in the top-right corner.
3. In the import wizard, select **CSV** as the file format.
4. Browse to your CSV file and select it. The wizard will show a preview of the detected columns.
5. Confirm the following:
   - **Spectral columns** -- the columns that contain your NIR absorbance values (typically numeric columns named with wavelength values such as `1100`, `1102`, ...).
   - **Target column** -- the column that contains the property you want to predict (for example `protein`, `moisture`, or `sugar`).
   - **Sample ID column** (optional) -- a column that uniquely identifies each sample.
6. Click **Import**. The dataset will be parsed, validated, and stored in your workspace.

:::{admonition} Supported formats
:class: hint

Besides CSV, nirs4all Studio supports Excel (.xlsx), MATLAB (.mat), Parquet, and folder-based imports. See {doc}`../how-to/datasets/import-csv` for detailed instructions on each format.
:::

---

## Step 3 -- Verify the dataset

After import, the application navigates to the **Dataset Detail** page. This page has four tabs: **Overview**, **Spectra**, **Targets**, and **Raw Data**.

### 3a -- Overview tab

The Overview tab shows summary statistics:
- Number of samples and features (wavelengths).
- Target column name and type (regression or classification).
- Wavelength range.

Verify that the sample count and feature count match your expectations.

### 3b -- Spectra tab

Switch to the **Spectra** tab. You will see an overlay plot of all spectra in the dataset. Each line represents one sample plotted across the wavelength axis.

Look for:
- **Noisy or flat spectra** -- these may indicate bad scans.
- **Overall shape** -- NIR spectra typically show broad absorption bands. The shape should be consistent across samples.

### 3c -- Targets tab

Switch to the **Targets** tab. This shows a histogram of the target variable distribution.

Check that:
- The distribution looks reasonable (no extreme outliers, no gaps).
- The range matches your expectations for the property being measured.

:::{tip}
If you spot outliers or suspect data quality issues, you can address them later using outlier filters in your pipeline. For now, proceed with the full dataset.
:::

---

## Step 4 -- Create a pipeline

A pipeline defines the sequence of steps that nirs4all will apply to your data: preprocessing, splitting, and modeling.

1. Click **Pipelines** in the left sidebar.

   ```{figure} ../_images/pipelines/pl-page-overview.png
   :alt: Pipelines page overview
   :width: 100%

   The Pipelines page lists your saved pipelines and built-in presets.
   ```

2. Click **New Pipeline**. This opens the **Pipeline Editor**.

   ```{figure} ../_images/pipelines/pe-overview.png
   :alt: Pipeline Editor overview
   :width: 100%

   The Pipeline Editor has three panels: Step Palette (left), Pipeline Tree (center), and Configuration (right).
   ```

### Option A -- Use a preset (fastest)

The Step Palette on the left contains a **Load Sample Pipeline** option under the menu button (**...**) in the toolbar. Select a preset such as **SNV + PLS Regression**. This loads a ready-made pipeline with:
- **SNV** (Standard Normal Variate) -- a preprocessing step that corrects scatter effects.
- **KennardStone** -- a splitting step that divides data into training and test sets.
- **PLSRegression** -- a Partial Least Squares model for quantitative prediction.

### Option B -- Build manually (recommended for learning)

If you prefer to build the pipeline yourself:

1. In the **Step Palette** (left panel), expand the **Preprocessing** category.
2. Click **SNV** to add it to the pipeline tree.
3. Expand the **Splitting** category and click **KennardStone**. In the Configuration panel on the right, set **test_size** to `0.2` (20% of samples held out for testing).
4. Expand the **Models** category and click **PLSRegression**. In the Configuration panel, set **n_components** to `10`.

Your pipeline tree in the center panel should now show three steps in order:

> SNV --> KennardStone --> PLSRegression

:::{admonition} What do these steps do?
:class: info

- **SNV** normalizes each spectrum by centering and scaling it, which removes physical scatter effects caused by particle size differences.
- **KennardStone** selects a representative calibration set and leaves the rest for validation. It is more robust than random splitting for spectral data.
- **PLSRegression** is the standard workhorse model in NIR spectroscopy. It finds latent components that maximize the covariance between spectra and the target property.
:::

---

## Step 5 -- Save the pipeline

1. Give your pipeline a descriptive name by editing the name field in the top toolbar. For example: `SNV + PLS (first test)`.
2. Click the **Save** button in the toolbar.
3. A confirmation toast will appear: *"SNV + PLS (first test)" saved to library*.

Your pipeline is now stored in the workspace and available for experiments.

---

## Step 6 -- Launch an experiment

1. In the Pipeline Editor toolbar, click the **Use in Experiment** button. This navigates to the **New Experiment** wizard with your pipeline pre-selected.

   Alternatively, click **Experiments** in the left sidebar and then **New Experiment**.

   ```{figure} ../_images/experiments/exp-wizard-overview.png
   :alt: Experiment wizard overview
   :width: 100%

   The experiment wizard guides you through four steps: Select Datasets, Select Pipelines, Review, and Launch.
   ```

2. **Step 1 -- Select Datasets**: Check the box next to the dataset you imported in Step 2. Click **Next**.

3. **Step 2 -- Select Pipelines**: Your pipeline should already be selected (if you came from the editor). If not, check the box next to it. You can filter by **Presets** or **Favorites** using the dropdown. Click **Next**.

4. **Step 3 -- Review**: The wizard shows a summary:
   - **Experiment Name** -- auto-generated from your dataset and pipeline names (e.g., `Corn x SNV + PLS`). You can edit this.
   - **Datasets**: 1
   - **Pipelines**: 1
   - **Total Runs**: 1

   Optionally add a description. Click **Next**.

5. **Step 4 -- Launch**: Review the final summary and click **Launch Experiment**.

:::{important}
An experiment can combine multiple datasets and multiple pipelines. nirs4all will run every combination automatically. For this first experiment, one dataset and one pipeline is sufficient.
:::

---

## Step 7 -- Watch live progress

After launching, you are taken to the **Run Progress** page. This page shows real-time updates as your experiment executes.

You will see:
- A **progress bar** showing overall completion.
- **Step-by-step status** -- each pipeline step (SNV, KennardStone, PLSRegression) transitions from *pending* to *running* to *completed*.
- **Live metrics** -- as cross-validation folds complete, intermediate scores appear.
- A **logs panel** with detailed execution output.

:::{tip}
For a small dataset (under 500 samples) with a PLS model, the experiment typically completes in under a minute. Deep learning models will take longer.
:::

When the progress bar reaches 100% and the status shows **Completed**, your experiment is finished.

---

## Step 8 -- View the results

1. Click the **Results** link in the left sidebar, or click the results link shown on the completed run page.

   ```{figure} ../_images/results/res-scores-overview.png
   :alt: Results page overview
   :width: 100%

   The Results page groups scores by dataset and shows the top-performing pipeline chains.
   ```

2. On the Results page, find your dataset. It will display:
   - **Best validation score** -- for regression tasks this is typically R-squared (R2).
   - **RMSE** (Root Mean Squared Error) -- the lower the better.
   - **Top pipeline chains** -- ranked by score.

3. Click on a chain to see more detail, including per-fold scores and the preprocessing steps used.

### Interpreting the scores

| Metric | Good value | What it means |
|---|---|---|
| **R2** | > 0.90 | The model explains more than 90% of the variance in the target property. |
| **RMSE** | Depends on scale | Lower is better. Compare to the standard deviation of your target. An RMSE much smaller than the standard deviation indicates good prediction. |

:::{admonition} What if the scores are low?
:class: warning

Low scores (e.g., R2 < 0.5) can happen for many reasons:
- The dataset may not contain enough information in the spectral range.
- The preprocessing may not be optimal. Try MSC or Savitzky-Golay derivatives (see {doc}`compare-preprocessing`).
- PLS may need more or fewer components. Try a parameter sweep (see {doc}`build-advanced-pipeline`).
- The data may contain outliers. Use the Playground to explore (see {doc}`compare-preprocessing`).
:::

---

## What you learned

In this tutorial you completed the full nirs4all Studio workflow:

1. Verified your workspace is set up.
2. Imported a CSV dataset and inspected it (overview, spectra, targets).
3. Built a pipeline with SNV preprocessing, KennardStone splitting, and PLS regression.
4. Saved the pipeline to your library.
5. Launched an experiment using the wizard.
6. Monitored live progress.
7. Viewed and interpreted the results.

---

## Next steps

- {doc}`compare-preprocessing` -- Explore different preprocessing methods in the Playground before running full experiments.
- {doc}`build-advanced-pipeline` -- Add parameter sweeps and branching to test many configurations in one experiment.
- {doc}`analyze-model-performance` -- Use the Inspector to deeply analyze model predictions.
