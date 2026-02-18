# Start from a Preset

Presets are ready-made pipelines built for common NIRS analysis workflows. Starting from a preset saves time and gives you a well-tested starting point that you can customize.

## Prerequisites

- You have nirs4all Studio open and a workspace selected.

## Steps

1. **Go to the Pipelines page.** Click **Pipelines** in the left sidebar. This opens your pipeline library.

2. **Open the Presets tab.** At the top of the page, click the **Presets** tab. You will see a collection of built-in pipeline templates.

   ```{figure} /_images/how-to/pipelines/presets-tab.png
   :alt: Pipelines page showing the Presets tab
   :width: 90%
   :class: screenshot

   The Presets tab shows built-in pipeline templates organized by use case.
   ```

3. **Browse available presets.** Each preset card shows:

   - The pipeline name (e.g., "SNV + PLS", "MSC + Random Forest")
   - A brief description of what it does
   - The steps included

   Common presets include:

   | Preset | Description |
   |---|---|
   | **SNV + PLS** | Standard Normal Variate preprocessing with PLS regression. A classic starting point for NIRS calibration. |
   | **MSC + PLS** | Multiplicative Scatter Correction with PLS regression. |
   | **SG Derivative + PLS** | Savitzky-Golay first derivative with PLS. Good when baseline drift is an issue. |
   | **SNV + Random Forest** | SNV with a Random Forest model. Useful when the relationship is nonlinear. |
   | **SNV + SVR** | SNV with Support Vector Regression. |
   | **Comparison: SNV vs MSC** | A generator pipeline that tests both preprocessing methods. |

4. **Select a preset.** Click on the preset card you want to use. The pipeline opens in the Pipeline Editor with all steps already configured.

5. **Review and customize.** Click on any step in the pipeline tree to see its parameters in the right panel. You can:

   - Change parameter values (e.g., the number of PLS components)
   - Add additional steps (e.g., insert a Savitzky-Golay smoothing before the model)
   - Remove steps you do not need
   - Replace steps (e.g., swap PLSRegression for Ridge)

6. **Save with your own name.** Click **Save** in the toolbar. Enter a new name to save this as your own pipeline. The original preset remains unchanged.

:::{tip}
Presets are a great way to learn how pipelines are structured. Open a few different presets and examine how the steps are arranged and configured.
:::

:::{note}
You can also access presets directly from the Pipeline Editor. Click the menu button in the editor toolbar and select **Load from preset** to browse and load a preset without leaving the editor.
:::

## What's Next

- {doc}`create-pipeline` -- build a pipeline entirely from scratch
- {doc}`add-preprocessing` -- understand what each preprocessing step does
- {doc}`manage-library` -- organize your saved pipelines
