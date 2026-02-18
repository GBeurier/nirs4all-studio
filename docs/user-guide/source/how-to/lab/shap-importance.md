# Analyze Variable Importance with SHAP

This guide shows you how to use the Variable Importance tool to understand which spectral regions (wavelengths) contribute most to a model's predictions. The tool uses SHAP (SHapley Additive exPlanations) to provide detailed, interpretable explanations.

## Prerequisites

- A workspace is open in nirs4all Studio.
- At least one experiment has been completed with a trained model.

## Steps

1. **Open the Variable Importance tool.** Click **Lab** in the sidebar navigation, then select **Variable Importance**.

   ```{figure} ../../_images/lab/lab-shap-overview.png
   :alt: Variable Importance page showing SHAP spectral plot and model selector
   :width: 700px

   The Variable Importance page with a model selector at the top and SHAP visualization below.
   ```

2. **Select a trained model.** Use the model dropdown to choose the model you want to explain. The list shows all models from completed experiment runs in the current workspace, along with their scores.

3. **Run the SHAP analysis.** Click **Run SHAP Analysis**. The tool computes SHAP values for every sample and every spectral feature. This may take a few seconds to a few minutes depending on the model complexity and dataset size.

   :::{note}
   SHAP computation time depends on the model type. Linear models (PLS, Ridge) are fast. Tree-based models (Random Forest, XGBoost) take longer. Deep learning models may require several minutes.
   :::

4. **Explore the visualizations.** Once the analysis is complete, four visualization tabs become available. Each one provides a different perspective on variable importance.

---

## Visualization Tabs

### Spectral View

The spectral view plots SHAP importance values along the wavelength axis. Peaks in this plot indicate spectral regions that strongly influence the model's predictions.

- **High peaks** correspond to wavelengths with strong predictive power.
- **Low or flat regions** indicate wavelengths that contribute little to the prediction.

This view is especially useful for identifying known chemical absorption bands and verifying that the model is using chemically meaningful features.

:::{tip}
Compare the SHAP spectral plot with known absorption bands for your analyte. If the model highlights wavelengths that align with known chemistry, it increases confidence in the model's validity.
:::

### Beeswarm Plot

The beeswarm plot shows the SHAP value distribution for every feature across all samples. Each dot represents one sample at one wavelength:

- The **horizontal position** shows the SHAP value (positive = pushes prediction up, negative = pushes prediction down).
- The **color** indicates the feature value (red = high spectral intensity, blue = low spectral intensity).

This plot reveals not just which features are important, but *how* they affect predictions -- whether higher absorbance at a given wavelength increases or decreases the predicted value.

### Bar Plot

The bar plot ranks features by their mean absolute SHAP value. This is the simplest summary of overall feature importance: taller bars mean more important wavelengths. Use this view when you need a quick ranking of the most influential spectral regions.

### Per-Sample View

The per-sample view lets you select an individual sample and see how each wavelength contributed to that specific prediction. This is a force-plot style breakdown:

- Features pushing the prediction **higher** are shown in one color.
- Features pushing the prediction **lower** are shown in another.
- The sum of all contributions equals the model's prediction for that sample.

:::{important}
Per-sample explanations are valuable for diagnosing outlier predictions. If a sample has an unexpectedly high or low predicted value, the per-sample view shows exactly which wavelengths caused it.
:::

---

## Tips for Interpretation

- **Consistent peaks across views** -- If the same wavelength regions appear important in the spectral, beeswarm, and bar views, the result is robust.
- **Scattered importance** -- If importance is spread evenly across all wavelengths with no clear peaks, the model may be overfitting to noise rather than learning meaningful spectral features.
- **Unexpected regions** -- If the model relies on wavelengths outside the known absorption range of your analyte, it may be using a spurious correlation. Investigate further before trusting the model.

## What's Next

- {doc}`transfer-analysis` -- Evaluate whether your model can transfer to a new dataset.
- {doc}`/how-to/experiments/launch-experiment` -- Train new models with different preprocessing to compare SHAP results.
