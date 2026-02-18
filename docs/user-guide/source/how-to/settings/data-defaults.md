# Configure Data Loading Defaults

This guide shows you how to set default values for the dataset import wizard. When you configure data loading defaults, these values are pre-filled every time you import a new dataset, saving you from entering the same settings repeatedly.

## Prerequisites

- nirs4all Studio is running.

## Steps

1. **Open the Settings page.** Click **Settings** in the bottom section of the sidebar navigation.

2. **Locate the Data Loading Defaults section.** On the Settings page, find the **Data Loading Defaults** card. This section contains all configurable import defaults.

3. **Set the default delimiter.** Choose the character that separates values in your data files:

   - **Comma** (`,`) -- the standard CSV delimiter.
   - **Semicolon** (`;`) -- common in European-origin instrument exports.
   - **Tab** -- used in TSV (tab-separated values) files.
   - **Auto-detect** -- lets the import wizard determine the delimiter automatically for each file.

4. **Set the default decimal separator.** Choose how decimal numbers are formatted in your files:

   - **Dot** (`.`) -- standard in English-speaking regions (e.g., `1.234`).
   - **Comma** (`,`) -- standard in many European countries (e.g., `1,234`).

   :::{tip}
   If your instruments and software always use the same regional format, setting the decimal separator here avoids a common source of import errors. European instruments frequently use comma as decimal separator combined with semicolon as delimiter.
   :::

5. **Set the default signal type.** Choose the spectral signal type that best matches your data:

   - **Auto-detect** -- the import wizard analyzes the data values and guesses the signal type.
   - **Absorbance** -- select this if your spectrometer outputs absorbance values (typically 0 to 3).
   - **Reflectance** -- select this if your data represents reflectance (typically 0 to 1 or 0% to 100%).
   - **Transmittance** -- select this if your data represents transmittance values.

   :::{note}
   The signal type affects how certain preprocessing steps behave. For example, if your data is in reflectance, some transforms will convert it to absorbance before processing.
   :::

6. **Set the default NA handling.** Choose how missing values should be treated during import:

   - **Auto** -- the wizard decides based on the number and location of missing values.
   - **Abort** -- reject the import if any missing values are found.
   - **Remove sample** -- discard entire rows (samples) that contain missing values.
   - **Remove feature** -- discard entire columns (wavelengths) that contain missing values.
   - **Replace** -- fill missing values with a replacement (e.g., column mean or zero).
   - **Ignore** -- keep missing values as-is (some models can handle them).

7. **Save the defaults.** Changes are saved automatically as you adjust each setting.

---

## How Defaults Are Used

When you open the dataset import wizard, the **Parsing Options** step is pre-filled with the defaults you configured here. You can always override these values for a specific import without changing the global defaults.

These defaults are stored in your **app settings** (located in `~/.nirs4all-webapp/`), so they apply across all workspaces and persist between sessions.

:::{important}
Changing the defaults does not affect datasets that have already been imported. The defaults only apply to new imports going forward.
:::

## What's Next

- {doc}`/how-to/datasets/import-csv` -- Import a CSV dataset using the wizard.
- {doc}`language` -- Change the interface language.
