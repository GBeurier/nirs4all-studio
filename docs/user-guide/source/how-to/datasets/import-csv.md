# Import a CSV Dataset

This guide walks you through importing a CSV file into nirs4all Studio using the dataset import wizard.

## Prerequisites

- A workspace is open in nirs4all Studio.
- You have one or more CSV files containing spectral data.

## Steps

1. **Open the Datasets page.** Click **Datasets** in the sidebar navigation.

2. **Start the import wizard.** Click the **Import** button in the top-right area of the page. The dataset wizard dialog opens.

3. **Select "Files" as the source.** On the **Select Source** step, click **Select Files**. A file browser dialog appears.

   ```{figure} /_static/screenshots/placeholder-wizard-source.png
   :alt: Wizard source step showing Folder and Files options
   :width: 600px

   The source selection step with two options: Select Folder and Select Files.
   ```

4. **Browse for your CSV file(s).** In the file dialog, navigate to and select your CSV file. You can select multiple files at once if your spectral data (X) and target values (Y) are stored in separate files.

5. **Map file roles.** On the **Map Files** step, assign each file a role:

   - **X (Features/Spectra)** -- the file containing your spectral measurements.
   - **Y (Targets/Analyte)** -- the file containing your reference values (e.g., moisture %, protein content).
   - **Metadata** -- any additional sample information (optional).

   Also set the **Split** for each file (Train or Test) and give your dataset a name.

   ```{figure} /_static/screenshots/placeholder-wizard-file-mapping.png
   :alt: File mapping step with role and split selectors
   :width: 600px

   Each file gets a Role (X, Y, Metadata), a Split (Train, Test), and optionally a Source number.
   ```

   :::{tip}
   If you have a single CSV file that contains both spectra and target columns, assign it as **X**. You will select the target column in a later step.
   :::

6. **Configure parsing options.** On the **Parsing Options** step, verify or adjust:

   - **Delimiter** -- comma (`,`), semicolon (`;`), tab, pipe (`|`), or space. The app auto-detects this from your file.
   - **Decimal separator** -- dot (`.`) or comma (`,`).
   - **Header Row** -- toggle on if the first row contains column names (wavelengths or feature labels). This is the most common case for NIRS data.
   - **Header Unit** -- select what the header values represent: Wavelength (nm), Wavenumber (cm-1), Text labels, Numeric index, or No header.
   - **Signal Type** -- Auto-detect, Absorbance, Reflectance, or Transmittance.
   - **NA Handling** -- how to treat missing values (auto, abort, remove sample, remove feature, replace, or ignore).

   Click **Auto-detect** to let the app analyze your file and fill in these settings automatically.

   :::{note}
   Under **Advanced Loading Options**, you can also set the file encoding (UTF-8, Latin-1, etc.), skip rows at the start of the file, or specify an Excel sheet name.
   :::

7. **Configure targets.** On the **Targets** step, the app reads your Y file and detects its columns. For each column, you will see:

   - The detected data type (numeric, categorical, or text).
   - The inferred task type (Regression, Binary classification, or Multiclass classification).

   Select the column you want to use as your target. If multiple target columns exist, click the star icon to set a default. You can also assign a unit (%, mg/L, pH, etc.) for regression targets.

   ```{figure} /_static/screenshots/placeholder-wizard-targets.png
   :alt: Target configuration step showing detected columns
   :width: 600px

   Target columns are auto-detected with their data types and task types.
   ```

8. **Preview and confirm.** On the **Preview** step, the wizard shows:

   - A **Dataset Summary** card with the number of samples, features, train/test split, and detected signal type.
   - A **Spectra Preview** chart displaying the mean, min, and max spectra.
   - A **Target Distribution** histogram with descriptive statistics.
   - A validation status indicator (green check if everything parsed correctly).

   Review the preview. If everything looks correct, click **Add Dataset**.

## Common CSV Formats in NIRS

NIRS CSV files typically follow one of these layouts:

- **Wavelengths as columns, samples as rows.** The first row contains wavelength values (e.g., `1100, 1102, 1104, ...`) and each subsequent row is a sample spectrum. This is the most common format.
- **Separate X and Y files.** One file for spectra and one file for reference values. The row order must match between the two files.
- **Combined file.** A single CSV where some columns are wavelengths (spectra) and others are metadata or target values.

:::{tip}
European-origin instruments often export CSV files with semicolons as delimiters and commas as decimal separators. If your numbers look wrong after import (e.g., `1,234` instead of `1.234`), check the Delimiter and Decimal settings in the Parsing step.
:::

:::{warning}
Make sure your CSV does not contain extra header rows, footer rows, or comments before the data. If it does, use the **Skip Rows** option in the Advanced Loading Options to skip those lines.
:::

## What's Next

- {doc}`inspect-data` -- explore your newly imported dataset.
- {doc}`edit-config` -- adjust parsing or target settings after import.
