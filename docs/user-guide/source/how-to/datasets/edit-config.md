# Edit Dataset Configuration After Import

After importing a dataset, you may realize that certain settings need to be changed -- perhaps the wrong target column was selected, the signal type was misdetected, or you want to update the wavelength units. You can edit these settings without reimporting the data.

## Prerequisites

- A workspace is open in nirs4all Studio.
- You have at least one dataset imported (see {doc}`import-csv` or {doc}`import-folder`).

## Steps

1. **Open the Dataset Detail page.** Click **Datasets** in the sidebar, then click on the dataset you want to edit. The Dataset Detail page opens.

2. **Open the configuration panel.** Click the **Settings** button (the gear icon) in the toolbar at the top of the Dataset Detail page. The configuration panel slides open on the right side.

   ```{figure} /_images/how-to/datasets/edit-config-panel.png
   :alt: Dataset configuration panel with editable fields
   :width: 90%
   :class: screenshot

   The configuration panel lets you modify dataset settings after import.
   ```

3. **Edit the dataset name.** The **Name** field at the top of the panel shows the current dataset name. Click it to edit. Press **Enter** or click elsewhere to confirm.

4. **Change the target column.** Under the **Targets** section, you will see the currently selected target column. To change it:

   a. Click the **target column dropdown**. A list of all available columns appears.

   b. Select the new target column.

   c. The task type (regression or classification) is re-detected automatically based on the column's data type and unique value count.

   :::{note}
   Changing the target column does not affect your spectral data. It only changes which column is used as the prediction target in experiments.
   :::

5. **Update the signal type.** Under the **Signal** section, you can change the signal type:

   - **Absorbance** -- the most common signal type for NIR transmission measurements.
   - **Reflectance** -- for reflectance measurements (e.g., diffuse reflectance).
   - **Transmittance** -- for raw transmittance values.
   - **Log(1/R)** -- log-transformed reflectance, commonly used to convert reflectance to pseudo-absorbance.

   :::{tip}
   The signal type is informational metadata -- it helps nirs4all apply the correct preprocessing defaults. If your data is already in absorbance units, select **Absorbance**.
   :::

6. **Change the wavelength units.** Under the **Wavelengths** section, select the correct unit:

   - **nm** (nanometers) -- the most common unit for NIR.
   - **cm-1** (wavenumber) -- used by some FTIR and FT-NIR instruments.
   - **Index** -- if wavelength values are not meaningful numbers.

   You can also manually edit the **start** and **end** wavelength values if the auto-detection was incorrect.

7. **Edit the description.** The **Description** text area lets you add notes about the dataset: where it came from, what property it measures, any known issues, etc. This text is displayed on the Dataset Detail page and in experiment summaries.

8. **Adjust the default target unit.** For regression targets, you can set the **unit** (e.g., `%`, `mg/L`, `pH`). This unit appears in charts, result tables, and exported reports.

9. **Configure sample ID column.** Under **Identifiers**, you can select which column serves as the sample identifier. This is used to label individual samples in scatter plots and prediction exports.

10. **Save changes.** Click the **Save** button at the bottom of the configuration panel. A confirmation toast appears: *"Dataset configuration updated"*.

:::{warning}
Changing the target column or signal type after running experiments does not retroactively update past results. Future experiments will use the new settings. If you need to rerun previous experiments with the new configuration, launch a new experiment.
:::

## What You Can and Cannot Change

| Setting | Editable? | Notes |
|---|---|---|
| Dataset name | Yes | |
| Description | Yes | |
| Target column | Yes | Re-detects task type automatically |
| Target unit | Yes | Cosmetic; shown in charts and reports |
| Signal type | Yes | Affects default preprocessing suggestions |
| Wavelength unit | Yes | Affects axis labels and some operators |
| Wavelength range | Yes | Manual override of detected range |
| Sample ID column | Yes | |
| Spectral data values | No | To change data, reimport the dataset |
| File format / delimiter | No | These are parsing-time settings |

## What's Next

- {doc}`inspect-data` -- verify your changes by reviewing the dataset tabs.
- {doc}`import-csv` -- if you need to reimport with different parsing settings.
