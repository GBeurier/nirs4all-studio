(batch-predictions)=
# Batch Predictions

**Time**: ~10 minutes | **Level**: Intermediate

Once you have trained a model that performs well, the next step is to use it on new, unseen samples. In this tutorial you will export a trained model as a portable `.n4a` bundle, load it on the Predictions page, upload new spectral data, run a batch prediction, and export the results.

:::{admonition} Prerequisites
:class: note

- You have completed at least one experiment with satisfactory scores (see {doc}`first-experiment`).
- You have a file of new spectral data (CSV, Excel, or another supported format) that you want to predict. The spectra must cover the same wavelength range as the training data.
:::

---

## Step 1 -- Export the trained model

Before you can predict new samples, you need to export the best model from your experiment as a `.n4a` bundle. A bundle packages the entire pipeline chain -- preprocessing steps, splitter configuration, and trained model weights -- into a single portable file.

1. Click **Results** in the left sidebar.
2. Locate the experiment and dataset you want to use. The results table shows all pipeline chains ranked by score.
3. Click on the **best-scoring chain** to open its detail view.
4. Click the **Export Model** button (the download icon) in the chain detail toolbar.
5. In the export dialog, choose a location and filename. The file is saved with the `.n4a` extension.

```{figure} ../_images/results/res-export-model.png
:alt: Export model dialog showing the download button and file name field
:width: 100%

The Export Model dialog lets you save the trained pipeline chain as a portable .n4a bundle.
```

:::{tip}
You can also export a model directly from the **Runs** page. Click on a completed run, then use the **Export** action in the run detail view.
:::

:::{admonition} What is a .n4a bundle?
:class: info

A `.n4a` file is a self-contained archive that includes:
- The complete preprocessing chain (e.g., SNV, Savitzky-Golay settings).
- The trained model weights (e.g., PLS regression coefficients).
- Metadata about the training dataset (wavelength range, target column, signal type).

You can share this file with colleagues, use it on another computer, or load it in a Python script with `nirs4all.predict("model.n4a", new_data)`.
:::

---

## Step 2 -- Go to the Predictions page

1. Click **Predictions** in the left sidebar.
2. The Predictions page shows a list of past prediction sessions (if any) and a prominent **New Prediction** button.

```{figure} ../_images/predictions/pred-page-overview.png
:alt: Predictions page with the New Prediction button
:width: 100%

The Predictions page lists previous prediction sessions and provides access to create new ones.
```

3. Click **New Prediction** to start a new batch prediction session.

---

## Step 3 -- Load the model bundle

The prediction wizard opens with the first step: **Select Model**.

1. Click **Browse** and navigate to the `.n4a` file you exported in Step 1.
2. Alternatively, if the model was exported within the current workspace, it appears in the **Recent Models** list. Click it to select it.
3. After loading, the wizard displays a summary of the model:
   - Pipeline chain (e.g., SNV --> KennardStone --> PLSRegression).
   - Training dataset name and size.
   - Expected wavelength range.
   - Target property name and task type (regression or classification).

4. Verify that the model summary matches your expectations. Click **Next**.

:::{warning}
The new data you want to predict must cover the same wavelength range as the training data. If the ranges do not match, the prediction will fail or produce unreliable results. The wizard will warn you if a mismatch is detected.
:::

---

## Step 4 -- Upload new spectral data

The second step of the wizard is **Upload Data**.

1. Click **Select Files** and browse to the file containing your new spectra. Supported formats include CSV, Excel (.xlsx), MATLAB (.mat), Parquet, and NumPy (.npy).
2. The wizard parses the file and shows a preview:
   - Number of samples detected.
   - Number of spectral features (wavelengths).
   - A mini spectra overlay chart.
3. If the wavelength range of your new data matches the model, a green checkmark appears. If there is a partial mismatch, the wizard shows which wavelengths overlap and which are missing.
4. Optionally, assign a **Sample ID column** if your file contains identifiers for each sample.
5. Click **Next**.

```{figure} ../_images/predictions/pred-upload-data.png
:alt: Upload data step showing file preview and wavelength match indicator
:width: 100%

The upload step shows a preview of the new spectra and checks compatibility with the loaded model.
```

:::{tip}
You do not need to preprocess the new data yourself. The `.n4a` bundle contains the full preprocessing chain and will apply it automatically during prediction.
:::

---

## Step 5 -- Run the batch prediction

The third step is **Review & Run**.

1. Review the summary:
   - **Model**: the pipeline chain and target property.
   - **Data**: number of new samples and wavelength coverage.
   - **Prediction name** (optional): give this prediction session a name for easy reference later.

2. Click **Run Prediction**.

3. A progress indicator appears as the prediction executes. For most models and dataset sizes, this takes only a few seconds. The steps are:
   - Applying preprocessing (SNV, derivatives, etc.) to the new spectra.
   - Running the trained model to generate predicted values.
   - Packaging the results.

4. When the prediction completes, the wizard transitions to the **Results** view.

---

## Step 6 -- View the prediction results

After the prediction finishes, you see the results panel with several sections:

### 6a -- Predictions table

A table listing each sample with its predicted value. Columns include:

| Column | Description |
|---|---|
| **Sample** | The sample ID or row number |
| **Predicted Value** | The model's prediction for the target property |
| **Confidence** (if available) | An uncertainty estimate for the prediction |

For classification tasks, the table shows the predicted class and class probabilities.

### 6b -- Distribution chart

A histogram of the predicted values. This gives you a quick overview of the distribution:
- Are the predictions within the expected range?
- Are there outliers (samples with unusually high or low predictions)?

### 6c -- Spectra overlay

The new spectra are plotted with a color gradient based on predicted values. This helps you visually correlate spectral features with the predictions.

:::{note}
If you provided reference values (actual measurements) alongside the new spectra, the results view will also show a **Predicted vs Actual** scatter plot and compute error metrics (R2, RMSE). This is useful for validating the model on new data.
:::

---

## Step 7 -- Export the results

You can export the prediction results for further analysis or reporting.

1. Click the **Export** button in the results toolbar.
2. Choose the export format:
   - **CSV** -- a table with sample IDs and predicted values, ready for spreadsheets or other software.
   - **Excel** -- an .xlsx file with the same data plus formatting.
3. Select a save location and click **Save**.

The exported file includes all columns from the predictions table, plus any metadata columns from the original data file.

:::{tip}
You can return to any past prediction session from the Predictions page. Each session is saved in your workspace with its model reference, input data, and results. Click on a session to review or re-export the results at any time.
:::

---

## What you learned

In this tutorial you:

1. Exported a trained model as a `.n4a` bundle from the Results page.
2. Opened the Predictions page and started a new prediction session.
3. Loaded the model bundle and reviewed its configuration.
4. Uploaded new spectral data and verified wavelength compatibility.
5. Ran a batch prediction and viewed the results (table, distribution, spectra).
6. Exported the predictions to CSV or Excel.

---

## Next steps

- {doc}`analyze-model-performance` -- Before running predictions, use the Inspector to verify that your model generalizes well.
- {doc}`build-advanced-pipeline` -- If your model scores are not satisfactory, build a more advanced pipeline with parameter sweeps to find a better configuration.
- {doc}`synthetic-data-testing` -- Generate synthetic data to test your prediction workflow before using real samples.
