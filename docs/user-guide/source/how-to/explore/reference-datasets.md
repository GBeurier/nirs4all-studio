# Use Reference Dataset Overlay

This guide explains how to load a reference dataset in the Playground and overlay its spectra on top of your working dataset. Reference overlays help you visually compare your data against a known standard, check for instrument drift, or verify that a new batch of samples falls within the expected spectral range.

## Prerequisites

- You have opened the Playground and selected a working dataset (see {doc}`playground-basics`).
- A second dataset has been imported into the workspace to serve as your reference.

---

## Steps

1. **Open the Playground.** Click **Playground** in the left sidebar. Select your primary (working) dataset from the **Dataset** dropdown.

2. **Enable reference overlay.** Click the **Reference** button in the toolbar above the spectra chart. A secondary dataset selector appears.

3. **Select the reference dataset.** Choose a dataset from the **Reference Dataset** dropdown. The reference spectra appear overlaid on the chart in a distinct color (typically a lighter shade or dashed lines) so you can distinguish them from your working data.

4. **Compare the spectra visually.** With both datasets displayed, look for:

   - **Baseline shifts** -- if the reference spectra sit higher or lower than your working data, there may be an instrument calibration difference.
   - **Shape differences** -- changes in peak positions or relative intensities may indicate different sample composition.
   - **Range coverage** -- verify that your working data falls within the spectral range covered by the reference set.

   :::{tip}
   Use a well-characterized dataset (e.g., a calibration set from your lab) as the reference. This gives you a reliable baseline for comparison.
   :::

5. **Apply preprocessing to both.** When you add preprocessing steps in the Playground, they are applied to **both** the working and reference datasets simultaneously. This lets you see how preprocessing affects the relationship between the two datasets.

6. **Toggle the overlay.** Click the **Reference** button again or use the eye icon next to the reference dataset name to show or hide the reference spectra without removing the selection.

7. **Switch to projection view.** Click the **PCA** or **UMAP** tab to see both datasets projected together. Samples from the two datasets are colored differently. If the clusters overlap, the datasets are spectrally similar. If they separate, there may be meaningful differences between them.

:::{note}
The reference overlay is purely visual and does not affect any computations. It is a tool for exploration and quality control, not for modeling.
:::

:::{warning}
For the overlay to be meaningful, both datasets should cover the same wavelength range. If the reference dataset has a different wavelength range, the Playground will display only the overlapping region.
:::

---

## What's Next

- {doc}`compare-steps` -- combine reference overlay with step comparison for deeper analysis.
- {doc}`export-to-editor` -- export your preprocessing steps once you are satisfied.
- {doc}`playground-basics` -- return to the Playground basics.
