# Getting Started with the Playground

The Playground is an interactive workspace where you can apply preprocessing steps to your spectra and see the results update in real time. Use it to experiment with different transformations before building a full pipeline.

## Prerequisites

- A workspace is open in nirs4all Studio.
- At least one dataset has been imported (see {doc}`../datasets/import-csv`).

---

## Steps

1. **Open the Playground.** Click **Playground** in the left sidebar.

   ```{figure} ../../_images/explore/pg-overview.png
   :alt: Playground page showing spectra chart and step controls
   :width: 100%

   The Playground displays your spectra on the left and preprocessing controls on the right.
   ```

2. **Select a dataset.** Use the **Dataset** dropdown at the top of the page to choose which dataset to work with. The spectra chart immediately displays all samples from the selected dataset.

3. **Explore the raw spectra.** Before applying any preprocessing, take a moment to examine the raw spectra:

   - **Hover** over the chart to see wavelength and absorbance values for individual samples.
   - **Zoom** by clicking and dragging on the chart to focus on a specific wavelength region.
   - **Reset zoom** by double-clicking the chart.

4. **Add a preprocessing step.** Click the **Add Step** button below the chart. A dropdown menu appears listing available preprocessing methods:

   - **SNV** (Standard Normal Variate) -- removes scatter effects.
   - **MSC** (Multiplicative Scatter Correction) -- corrects for scatter using a reference spectrum.
   - **Savitzky-Golay** -- smoothing or derivative calculation.
   - **Detrend** -- removes baseline trends.
   - **Baseline Correction** -- corrects baseline drift.
   - **Scaling** (Mean Center, Auto Scale) -- centers or normalizes the spectra.

   Select a method to add it.

5. **Watch the spectra update.** The chart immediately redraws to show the transformed spectra. The original (raw) spectra are shown as faint lines in the background for comparison.

6. **Adjust step parameters.** Click on the step card to expand its parameter panel. For example, for Savitzky-Golay you can adjust the window length, polynomial order, and derivative order. Each parameter change triggers an instant chart update.

   :::{tip}
   Start with scatter correction (SNV or MSC) as your first step, then add smoothing or derivatives. This mirrors the typical preprocessing workflow in NIRS analysis.
   :::

7. **Add more steps.** Click **Add Step** again to chain additional preprocessing methods. Steps are applied in order from top to bottom, just like in a pipeline.

8. **Reorder or remove steps.** Drag a step card up or down to change the order. Click the **X** button on a step card to remove it.

9. **View projections.** Click the **PCA** or **UMAP** tab above the chart to see a dimensionality-reduction projection of your preprocessed data. This helps you assess whether preprocessing improves the separation of sample groups.

:::{note}
The Playground does not modify your original dataset. All transformations are applied on the fly for visualization purposes only. Your data remains untouched until you build and run a pipeline.
:::

---

## What's Next

- {doc}`compare-steps` -- compare different preprocessing methods side by side.
- {doc}`reference-datasets` -- overlay a reference dataset for visual comparison.
- {doc}`export-to-editor` -- send your Playground steps to the Pipeline Editor.
