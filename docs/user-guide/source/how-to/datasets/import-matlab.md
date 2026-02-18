# Import a MATLAB File

This guide explains how to import a MATLAB `.mat` file into nirs4all Studio. MATLAB files are commonly used to exchange spectral datasets in research.

## Prerequisites

- A workspace is open in nirs4all Studio.
- You have a `.mat` file containing spectral data.

## Steps

1. **Open the Datasets page.** Click **Datasets** in the sidebar.

2. **Start the import wizard.** Click the **Import** button. The dataset wizard dialog opens.

3. **Select "Files" as the source.** On the **Select Source** step, click **Select Files**. In the file dialog, browse for your `.mat` file. The file filter accepts `.mat` files along with CSV and Excel formats.

4. **Map file roles.** On the **Map Files** step, you will see your `.mat` file listed with the format badge showing **MAT**. Assign the file its role:

   - If the `.mat` file contains spectral data, set the role to **X (Features/Spectra)**.
   - If you have a separate `.mat` file (or CSV/Excel file) for target values, add it and set its role to **Y (Targets/Analyte)**.
   - If the `.mat` file contains both spectra and targets as separate variables, assign it as **X**. You will map the target variable later.

   Set the **Split** (Train or Test) and give your dataset a name.

   ```{figure} /_static/screenshots/placeholder-wizard-file-mapping-mat.png
   :alt: File mapping step with a MATLAB file
   :width: 600px

   A .mat file listed with the MAT format badge. Assign it the appropriate role.
   ```

5. **Configure parsing options.** On the **Parsing Options** step:

   - **Header Row** and **Delimiter** are not relevant for MATLAB files (these are CSV-specific settings). The app handles binary `.mat` parsing internally.
   - **Signal Type** -- select the signal type or leave as Auto-detect.
   - **NA Handling** -- choose how to handle any missing values (NaN entries).

   :::{note}
   MATLAB files store data as named variables (matrices, vectors, structs). The app's backend reads the `.mat` file using nirs4all's MATLAB loader, which automatically identifies the relevant matrices for spectra (X) and targets (Y) based on variable names and shapes.
   :::

6. **Configure targets.** On the **Targets** step, the wizard detects the columns or variables available as targets. Select the column to use as your target variable. Set the task type if the auto-detection is incorrect.

7. **Preview and confirm.** On the **Preview** step, review:

   - **Dataset Summary** -- number of samples, features, and signal type.
   - **Spectra Preview** -- mean/min/max spectral overlay chart.
   - **Target Distribution** -- histogram and statistics.

   If everything looks correct, click **Add Dataset** to import.

## MATLAB Variable Mapping

MATLAB `.mat` files store data as named variables. Common conventions in NIRS include:

| Variable name | Typical content |
|---|---|
| `X`, `spectra`, `data` | Spectral matrix (samples x wavelengths) |
| `Y`, `y`, `targets`, `conc` | Target/concentration values |
| `wavelengths`, `wl`, `wn` | Wavelength or wavenumber vector |
| `metadata`, `info`, `labels` | Sample metadata |

The nirs4all loader attempts to match variable names to these conventions automatically. If your file uses non-standard variable names, the loader falls back to selecting the largest 2D matrix as spectra.

## MATLAB Format Versions

:::{note}
nirs4all supports **MATLAB v5** format (`.mat` files saved with `-v6` or `-v7` in MATLAB). This is the default save format in MATLAB.

**MATLAB v7.3** format (HDF5-based, saved with `-v7.3`) is also supported, but requires the `h5py` library. If you encounter an import error mentioning HDF5 or v7.3, make sure the Python environment has `h5py` installed.
:::

:::{tip}
If you are unsure which format version your file uses, try importing it directly. If the import fails with a format error, open the file in MATLAB and re-save it using `save('filename.mat', '-v7')` to convert it to the v5/v7 format.
:::

## What's Next

- {doc}`inspect-data` -- explore your imported spectral data.
- {doc}`edit-config` -- adjust target or parsing configuration after import.
