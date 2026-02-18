# Quickstart

This guide walks you through a complete analysis workflow in about 5 minutes: importing a dataset, creating a pipeline, running an experiment, and viewing the results.

:::{tip}
Before you begin, make sure you have a workspace set up. If you have not done that yet, follow the steps in {doc}`first-launch` first.
:::

## Step 1: Import a Dataset

1. Click **Datasets** in the sidebar.
2. Click the **Import** button at the top of the page.
3. Select a CSV file containing your spectral data. The file should have wavelength columns (your spectra) and at least one target column (the property you want to predict).
4. The **import wizard** opens to guide you through the configuration.

```{figure} /_images/getting-started/gs-quickstart-import.png
:alt: Importing a dataset
:width: 80%

The import wizard after selecting a CSV file.
```

:::{tip}
A typical NIRS dataset has columns like `850nm, 852nm, 854nm, ...` for wavelengths and a column like `protein` or `moisture` for the target value. The import wizard will help you identify which columns are which.
:::

## Step 2: Configure the Import

In the import wizard:

1. **Map your files**: Confirm that the application has detected your file correctly.
2. **Set the target column**: Select the column that contains the values you want to predict (for example, "protein" or "moisture").
3. **Review and confirm**: Check the summary and click **Confirm** to import the dataset.

The dataset will appear in your Datasets list, ready for analysis.

```{figure} /_images/getting-started/gs-quickstart-dataset-ready.png
:alt: Dataset imported successfully
:width: 80%

Your imported dataset showing in the Datasets page.
```

## Step 3: Create a Pipeline

A pipeline defines the sequence of processing steps applied to your data: preprocessing, cross-validation, and modeling.

You have two options:

### Option A: Use a Preset

1. Click **Pipelines** in the sidebar.
2. Click **New Pipeline** and choose a preset template (for example, **SNV + PLS**).
3. The preset creates a ready-made pipeline with sensible defaults: an SNV (Standard Normal Variate) preprocessing step, a cross-validation splitter, and a PLS (Partial Least Squares) regression model.

### Option B: Build from Scratch

1. Click **Pipeline Editor** in the sidebar.
2. Drag and drop steps from the step catalog onto the canvas: add a preprocessor, a splitter, and a model.
3. Save your pipeline with a name.

```{figure} /_images/getting-started/gs-quickstart-pipeline.png
:alt: A simple pipeline in the editor
:width: 80%

A simple pipeline with SNV preprocessing, K-Fold cross-validation, and PLS regression.
```

:::{tip}
If this is your first time, start with a preset. You can always edit it later or build more complex pipelines once you are comfortable.
:::

## Step 4: Launch an Experiment

1. Click **Run** in the sidebar to open the experiment wizard.
2. **Select your dataset**: Choose the dataset you just imported.
3. **Select your pipeline**: Choose the pipeline you just created (or the preset).
4. **Review the configuration** and click **Launch**.

```{figure} /_images/getting-started/gs-quickstart-launch.png
:alt: Launching an experiment
:width: 80%

The experiment wizard, ready to launch with a dataset and pipeline selected.
```

## Step 5: Monitor Progress

After launching, the application navigates to the **Run Progress** page where you can follow the experiment in real time.

You will see:

- A **progress bar** showing overall completion
- **Live log messages** as each step executes
- **Fold-by-fold progress** for cross-validation

```{figure} /_images/getting-started/gs-quickstart-progress.png
:alt: Experiment progress
:width: 80%

The Run Progress page showing a running experiment with live updates.
```

:::{tip}
You do not need to stay on this page. Navigate anywhere in the app and the **floating run widget** in the bottom-right corner will keep you updated on progress. See {doc}`interface-tour` for details.
:::

## Step 6: View Your Results

Once the experiment finishes:

1. Click **Results** in the sidebar (or click the link in the completion notification).
2. The Results page shows the scores and metrics for each pipeline chain that was evaluated.
3. Explore the details: prediction vs. observed plots, residual charts, per-fold breakdowns, and more.

```{figure} /_images/getting-started/gs-quickstart-results.png
:alt: Experiment results
:width: 80%

The Results page showing scores, metrics, and charts for the completed experiment.
```

:::{note}
Key metrics to look at for regression tasks include **RMSE** (Root Mean Square Error -- lower is better), **R2** (coefficient of determination -- closer to 1 is better), and **RPD** (Ratio of Performance to Deviation). For classification tasks, look at **Accuracy**, **F1 Score**, and the **Confusion Matrix**.
:::

## What's Next?

You have just completed your first end-to-end analysis. Here are some things to try next:

- **Explore your spectra** in the {doc}`../tutorials/first-experiment` tutorial, which covers the full workflow in more depth.
- **Compare preprocessing methods** visually using the Playground.
- **Build more complex pipelines** with branching, parameter sweeps, and multiple models.
- **Export your best model** to use for predictions on new data.

For a complete step-by-step walkthrough with detailed explanations, see the {doc}`../tutorials/first-experiment` tutorial.
