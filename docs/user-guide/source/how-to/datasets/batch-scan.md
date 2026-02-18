# Batch Scan a Folder

This guide explains how to scan a directory for multiple datasets and import them all at once. This is useful when you have a folder containing several dataset subfolders (e.g., data from multiple experiments, instruments, or time periods) and want to import them in a single operation.

## Prerequisites

- A workspace is open in nirs4all Studio.
- You have a parent folder that contains one or more subfolders, each holding dataset files (CSV, Excel, MATLAB, NumPy, or Parquet).

## How Batch Scan Works

The batch scan feature recursively searches a directory tree for folders that contain recognizable dataset files. For each candidate folder, it applies the same auto-detection logic as a single folder import: identifying spectra files, target files, metadata, and parsing options. You then review the detected datasets and choose which ones to import.

## Steps

1. **Open the Datasets page.** Click **Datasets** in the sidebar navigation.

2. **Open the Import menu.** Click the **Import** button in the top-right area. In the import wizard, select **Select Folder** on the source selection step.

3. **Select the parent directory.** In the folder browser, navigate to the parent folder that contains your dataset subfolders. Select it and click **Open**.

   For example, if your folder structure looks like this:

   ```
   nirs_projects/
   ├── corn_2024/
   │   ├── X_train.csv
   │   └── Y_train.csv
   ├── wheat_2024/
   │   ├── spectra.xlsx
   │   └── targets.xlsx
   └── soy_2024/
       ├── X.mat
       └── Y.mat
   ```

   Select the `nirs_projects` folder.

4. **Wait for the scan.** The application recursively scans all subfolders. A progress indicator shows the scan status. For large directory trees, this may take a few seconds.

   ```{figure} /_images/how-to/datasets/batch-scan-progress.png
   :alt: Batch scan progress indicator
   :width: 90%
   :class: screenshot

   The batch scan scans subfolders and identifies candidate datasets.
   ```

5. **Review detected datasets.** After scanning, the wizard displays a list of all detected datasets. Each entry shows:

   - **Folder name** -- used as the default dataset name.
   - **File count** -- how many data files were found.
   - **Detected roles** -- which files were identified as X (spectra), Y (targets), metadata.
   - **Status** -- a green check if auto-detection succeeded, or a yellow warning if manual review is needed.
   - **Checkbox** -- to include or exclude the dataset from the import.

6. **Select which datasets to import.** By default, all successfully detected datasets are checked. Uncheck any that you do not want to import. You can also click on a dataset row to expand it and review or adjust file role assignments.

   :::{tip}
   Use the **Select All** / **Deselect All** buttons at the top of the list to quickly toggle all datasets. This is handy when you only want to import a few datasets from a large scan.
   :::

7. **Configure shared settings (optional).** Click **Shared Settings** to apply common parsing options to all selected datasets at once:

   - **Delimiter** (for CSV files)
   - **Decimal separator**
   - **Signal type** (absorbance, reflectance, transmittance, or auto-detect)
   - **Header unit** (wavelength, wavenumber, etc.)

   Individual datasets can override these shared settings if needed.

8. **Start the batch import.** Click **Import Selected**. The application imports each dataset sequentially, showing a progress bar with the current dataset name.

9. **Review the results.** When the batch import completes, a summary dialog shows:

   - Number of datasets successfully imported.
   - Number of datasets that failed (if any), with error details.
   - A link to go to the Datasets page.

   Click **Done** to close the dialog.

:::{note}
Each imported dataset appears independently on the Datasets page. They are not automatically grouped, but you can organize them into groups afterward (see {doc}`organize-groups`).
:::

:::{warning}
The batch scan skips folders that do not contain any recognized data files. If a subfolder contains only images, PDFs, or other non-data files, it will not appear in the detected datasets list.
:::

## Supported Folder Layouts

The batch scan recognizes the same folder structures as the single folder import:

| Layout | Example |
|---|---|
| Flat files | `X_train.csv`, `Y_train.csv` in one folder |
| Separate train/test | `X_train.csv`, `X_test.csv`, `Y_train.csv`, `Y_test.csv` |
| Named by content | `spectra.csv`, `targets.csv`, `metadata.csv` |
| Multi-source | `X_source1.csv`, `X_source2.csv`, `Y.csv` |

## What's Next

- {doc}`organize-groups` -- group the imported datasets for easier management.
- {doc}`inspect-data` -- explore each imported dataset in the detail view.
