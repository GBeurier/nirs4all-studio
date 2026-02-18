# Import an Excel File

This guide explains how to import an Excel spreadsheet (.xlsx or .xls) into nirs4all Studio.

## Prerequisites

- A workspace is open in nirs4all Studio.
- You have an Excel file containing spectral data and/or target values.

## Steps

1. **Open the Datasets page.** Click **Datasets** in the sidebar.

2. **Start the import wizard.** Click the **Import** button. The dataset wizard dialog opens.

3. **Select "Files" as the source.** On the **Select Source** step, click **Select Files**. In the file dialog, choose your `.xlsx` or `.xls` file. You can select multiple files if spectra and targets are in separate workbooks.

4. **Map file roles.** On the **Map Files** step, assign each file its role:

   - **X (Features/Spectra)** for the file with spectral measurements.
   - **Y (Targets/Analyte)** for the file with reference values.
   - **Metadata** for any extra sample information.

   Set the **Split** (Train or Test) and enter a dataset name.

   ```{figure} /_static/screenshots/placeholder-wizard-file-mapping.png
   :alt: File mapping step with Excel files
   :width: 600px

   Assign roles to each imported Excel file.
   ```

5. **Configure parsing options.** On the **Parsing Options** step:

   - **Header Row** -- verify that the toggle is on if your first row contains column headers (wavelengths, feature names, etc.).
   - **Header Unit** -- select the appropriate unit (Wavelength nm, Wavenumber cm-1, Text labels, etc.).
   - **Signal Type** -- choose Auto-detect or select your signal type.
   - **NA Handling** -- set how missing or empty cells are treated.

   :::{note}
   For Excel files, the delimiter and decimal separator settings do not apply -- Excel stores values directly in cells. The app handles this automatically.
   :::

6. **Select the sheet (multi-sheet workbooks).** If your Excel file has multiple sheets, expand **Advanced Loading Options** in the Parsing step and type the **Sheet Name** you want to use. If you leave this blank, the app reads the first sheet by default.

   ```{figure} /_static/screenshots/placeholder-wizard-parsing-advanced.png
   :alt: Advanced loading options showing Sheet Name field
   :width: 600px

   Use the Sheet Name field to specify which sheet to read from a multi-sheet workbook.
   ```

   :::{tip}
   If you are unsure of the sheet name, open the file in Excel first and note the name on the sheet tab at the bottom.
   :::

7. **Configure targets.** On the **Targets** step, the wizard detects columns in your Y file and infers their types. Select the column to use as your target. Set the task type (Regression, Binary, or Multiclass) if the auto-detected type is incorrect. Use the star icon to mark the default target when there are multiple columns.

8. **Preview and confirm.** The **Preview** step displays a dataset summary, a spectra chart (mean/min/max), a target distribution histogram, and a validation indicator. Review the information and click **Add Dataset** to finish.

## Excel-Specific Notes

- **Supported formats:** Both `.xlsx` (modern Excel) and `.xls` (legacy Excel 97-2003) are supported.
- **Formatting:** The app reads raw cell values. Cell formatting (colors, borders, fonts) is ignored. Number formats are respected for parsing.
- **Merged cells:** Avoid merged cells in your data range. Merged cells can cause columns to misalign during import.
- **Named ranges:** The app reads the full sheet. Named ranges are not selectable -- use the Sheet Name option to target the right sheet and the Skip Rows option to skip any header material.
- **Formulas:** Excel formulas are evaluated and their computed values are imported. The app does not import formula definitions.

:::{warning}
Very large Excel files (tens of thousands of rows with hundreds of columns) may take longer to import than CSV equivalents. If performance is a concern, consider exporting your data as CSV first.
:::

## What's Next

- {doc}`inspect-data` -- explore spectra, targets, and raw values.
- {doc}`edit-config` -- change parsing or target settings after import.
