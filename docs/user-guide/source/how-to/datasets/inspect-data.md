# Inspect Dataset Details

After importing a dataset, it is important to verify the data before using it in experiments. The **Dataset Detail** page provides four tabs that let you explore your data from different angles: summary statistics, spectral plots, target distributions, and the raw data table.

## Prerequisites

- A workspace is open in nirs4all Studio.
- You have at least one dataset imported (see {doc}`import-csv` or {doc}`import-folder`).

## Steps

1. **Open the Dataset Detail page.** Click **Datasets** in the sidebar. Click on the dataset you want to inspect. The Dataset Detail page opens.

---

### Tab 1: Overview

2. **Review the Overview tab.** This is the default tab and shows a summary of the dataset:

   - **Sample count** -- total number of spectra in the dataset.
   - **Feature count** -- number of wavelength points per spectrum.
   - **Wavelength range** -- the start and end wavelengths (e.g., 1100 nm - 2500 nm).
   - **Signal type** -- absorbance, reflectance, or transmittance.
   - **Target column** -- the selected prediction target.
   - **Task type** -- regression or classification (auto-detected from the target).
   - **Train/Test split** -- if the dataset was imported with separate train and test files, the split is shown here.
   - **Import date** and **file source**.

   ```{figure} /_images/how-to/datasets/detail-overview.png
   :alt: Dataset Detail Overview tab with summary statistics
   :width: 90%
   :class: screenshot

   The Overview tab shows key statistics about the imported dataset.
   ```

   **What to check:**
   - Does the sample count match what you expect? If samples are missing, the import may have skipped rows with missing values.
   - Does the feature count match the number of wavelengths in your original file?
   - Is the target column correct? If not, see {doc}`edit-config` to change it.

---

### Tab 2: Spectra

3. **Switch to the Spectra tab.** Click the **Spectra** tab. An overlay chart displays all spectra in the dataset.

   - The **x-axis** represents wavelengths (in nm or cm-1).
   - The **y-axis** represents signal intensity (absorbance, reflectance, or transmittance).
   - Each line is one sample.

   ```{figure} /_images/how-to/datasets/detail-spectra.png
   :alt: Spectra tab showing an overlay of all sample spectra
   :width: 90%
   :class: screenshot

   The Spectra tab plots every sample spectrum as a line across the wavelength axis.
   ```

   **What to look for:**

   | Observation | Possible cause | Suggested action |
   |---|---|---|
   | All spectra have a consistent shape with smooth curves | Normal NIR data | Proceed with your analysis |
   | One or more spectra are flat lines (no absorption features) | Empty scan, instrument error, or placeholder values | Consider removing these samples |
   | One or more spectra have extreme values (spikes or dips) | Instrument malfunction or sample contamination | Use outlier filters in your pipeline |
   | Spectra show large vertical offsets between samples | Scatter effects from particle size or sample thickness | Apply scatter correction (SNV, MSC) in your pipeline |
   | The wavelength axis shows unexpected values | Incorrect wavelength unit or header parsing | Edit the configuration (see {doc}`edit-config`) |

   :::{tip}
   Use the chart toolbar to zoom into specific wavelength regions. Click and drag on the chart to zoom. Double-click to reset the zoom.
   :::

---

### Tab 3: Targets

4. **Switch to the Targets tab.** Click the **Targets** tab. This tab shows the distribution of the target variable.

   **For regression targets:**
   - A **histogram** of the target values, with the y-axis showing the number of samples in each bin.
   - **Descriptive statistics**: mean, standard deviation, minimum, maximum, median, and quartiles.

   **For classification targets:**
   - A **bar chart** showing the number of samples per class.
   - A **class balance indicator** highlighting any imbalanced classes.

   ```{figure} /_images/how-to/datasets/detail-targets.png
   :alt: Targets tab showing a histogram of regression target values
   :width: 90%
   :class: screenshot

   The Targets tab visualizes the distribution of the target variable.
   ```

   **What to look for:**

   | Observation | Possible cause | Suggested action |
   |---|---|---|
   | Smooth, well-spread distribution | Good coverage of the target range | Proceed with your analysis |
   | Extreme outliers (values far from the main distribution) | Measurement errors or labeling mistakes | Investigate those samples; consider using a `YOutlierFilter` in your pipeline |
   | Gaps in the distribution | Missing data in certain ranges | The model may extrapolate poorly in those ranges; collect more samples if possible |
   | One class has far more samples than others (classification) | Class imbalance | Consider augmentation or stratified splitting |

---

### Tab 4: Raw Data

5. **Switch to the Raw Data tab.** Click the **Raw Data** tab. This tab shows the underlying data as an interactive table.

   - Each **row** is a sample.
   - **Columns** include the sample ID (if assigned), all spectral features (wavelengths), the target column, and any metadata columns.
   - The table supports **sorting** (click a column header), **searching** (use the search box), and **scrolling** (both horizontal and vertical).

   ```{figure} /_images/how-to/datasets/detail-raw-data.png
   :alt: Raw Data tab showing the data table with spectral values
   :width: 90%
   :class: screenshot

   The Raw Data tab displays the full dataset as a scrollable, searchable table.
   ```

   **What to look for:**
   - **Missing values** -- cells with `NaN` or blank values. These may cause errors during model training.
   - **Non-numeric spectral values** -- text or symbols in spectral columns indicate a parsing issue.
   - **Duplicate rows** -- identical spectra may inflate the apparent dataset size.
   - **Metadata columns** -- verify that additional columns (sample ID, batch number, date, etc.) are present and correct.

   :::{tip}
   Click a column header to sort the table by that column. This is a quick way to find the minimum and maximum values or spot unusual entries.
   :::

---

## Summary Checklist

Before using a dataset in an experiment, verify the following:

- [ ] Sample count matches your expectation.
- [ ] Feature count corresponds to the correct number of wavelengths.
- [ ] Spectra have a consistent shape without flat lines or extreme spikes.
- [ ] Target distribution is reasonable with no unexpected gaps or outliers.
- [ ] No missing values in spectral columns.
- [ ] The target column and signal type are correctly assigned.

## What's Next

- {doc}`edit-config` -- adjust settings if something looks wrong.
- {doc}`organize-groups` -- organize this dataset into a group with related datasets.
- {doc}`../pipelines/create-pipeline` -- build a pipeline to analyze this dataset.
