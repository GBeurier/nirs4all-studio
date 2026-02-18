# Import a Folder

This guide explains how to import a dataset from a folder that contains multiple data files. This is the recommended method when your dataset follows a standard folder structure with separate files for spectra, targets, and metadata.

## Prerequisites

- A workspace is open in nirs4all Studio.
- You have a folder containing your dataset files (CSV, Excel, MATLAB, NumPy, or Parquet).

## Method 1: Drag and Drop

The fastest way to import a folder is drag-and-drop.

1. **Open the Datasets page.** Click **Datasets** in the sidebar.

2. **Drag the folder onto the page.** Open your file manager and drag the dataset folder directly onto the Datasets page. A drop zone overlay appears.

   ```{figure} /_static/screenshots/placeholder-datasets-drop-zone.png
   :alt: Drop zone overlay on the Datasets page
   :width: 600px

   Drag a folder onto the Datasets page to start importing.
   ```

3. **Wait for auto-detection.** The import wizard opens and the app scans the folder structure automatically. It detects data files, assigns roles (X, Y, metadata), identifies train/test splits, and reads parsing options.

4. **Review and adjust.** The wizard opens at the **Map Files** step with the detected files pre-filled. Review the file roles and splits. Proceed through the remaining wizard steps (Parsing, Targets, Preview) as described in the CSV or Excel import guides.

5. **Confirm.** Click **Add Dataset** on the Preview step to finish.

## Method 2: Import Wizard

1. **Open the Datasets page.** Click **Datasets** in the sidebar.

2. **Start the import wizard.** Click the **Import** button.

3. **Select "Folder" as the source.** On the **Select Source** step, click **Select Folder**. A folder browser dialog opens.

   ```{figure} /_static/screenshots/placeholder-wizard-source-folder.png
   :alt: Source selection step with the Folder option highlighted
   :width: 600px

   Choose Select Folder to browse for a dataset directory.
   ```

4. **Browse for your folder.** Navigate to and select the folder containing your dataset files. Click **Select** (or **Open**).

5. **Wait for auto-detection.** The app uses nirs4all's folder parser to recursively scan the folder. It identifies data files, assigns them roles based on naming conventions, and detects parsing options. The dataset name is set to the folder name by default.

6. **Review file mapping.** On the **Map Files** step, check that the detected files have the correct roles:

   - Files named `X_train`, `train_x`, `spectra`, etc. are assigned as **X (Train)**.
   - Files named `X_test`, `test_x`, etc. are assigned as **X (Test)**.
   - Files named `Y_train`, `y_train`, `targets`, etc. are assigned as **Y (Train)**.
   - Files containing `fold` or `cv` in the name are detected as cross-validation fold assignments.
   - Files named `metadata` or `info` are assigned as **Metadata**.

   Adjust any incorrect assignments using the Role and Split dropdowns. You can also add files manually using the **Add Files** button or by dragging files into the file list area.

7. **Configure parsing, targets, and preview.** Proceed through the **Parsing Options**, **Targets**, and **Preview** steps as with any other import. The auto-detected settings are pre-filled.

8. **Confirm.** Click **Add Dataset** on the Preview step.

## Recognized Folder Structures

The auto-detection engine recognizes common folder layouts used in NIRS research:

**Flat structure** -- all files in one folder:
```
my_dataset/
  X_train.csv
  Y_train.csv
  X_test.csv
  Y_test.csv
```

**With metadata and folds:**
```
my_dataset/
  spectra.csv
  targets.csv
  metadata.csv
  folds.csv
```

**Multi-source datasets** (e.g., two instruments):
```
my_dataset/
  X_train_source1.csv
  X_train_source2.csv
  Y_train.csv
```

## Supported File Formats

The folder import supports the following file types:

| Format | Extensions |
|---|---|
| CSV | `.csv` |
| Excel | `.xlsx`, `.xls` |
| MATLAB | `.mat` |
| NumPy | `.npy`, `.npz` |
| Parquet | `.parquet` |

:::{tip}
The auto-detection works best when your files follow standard naming conventions (e.g., `X_train.csv`, `Y_test.csv`). If the app cannot determine file roles automatically, you can assign them manually in the Map Files step.
:::

:::{note}
If the folder does not contain recognizable dataset files but has subfolders that do, the app will suggest a **batch scan** to discover datasets in the subdirectories. See {doc}`batch-scan` for details.
:::

## What's Next

- {doc}`inspect-data` -- explore spectra, targets, and raw data in the detail view.
- {doc}`batch-scan` -- import multiple dataset folders at once.
