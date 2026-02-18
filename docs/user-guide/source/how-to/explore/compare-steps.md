# Compare Preprocessing Steps

This guide shows you how to use the Playground's comparison mode to view the effect of different preprocessing methods side by side. This is useful for deciding between methods like SNV, MSC, and Savitzky-Golay before committing to a pipeline.

## Prerequisites

- You have opened the Playground and selected a dataset (see {doc}`playground-basics`).

---

## Steps

1. **Open the Playground.** Click **Playground** in the left sidebar and select a dataset from the dropdown.

2. **Activate comparison mode.** Click the **Compare** toggle button in the toolbar above the spectra chart. The view splits into two or more panels, each showing the same dataset.

3. **Configure the first panel.** In the left panel, add the preprocessing steps you want to evaluate. For example, add **SNV** as a single step.

4. **Configure the second panel.** In the right panel, add a different preprocessing method. For example, add **MSC**. The spectra in each panel update independently.

5. **Add more comparison panels.** Click the **+** button to add a third panel if you want to compare three methods at once -- for example, SNV vs. MSC vs. Savitzky-Golay first derivative.

   :::{tip}
   Keep comparisons focused. Comparing two or three methods at a time is easier to interpret than comparing five or more. You can always swap out methods to test new combinations.
   :::

6. **Inspect the differences.** Look at each panel and compare:

   - **Spectral shape** -- has the baseline been corrected? Are the spectra smoother?
   - **Noise level** -- which method reduces noise without losing important features?
   - **Outlier visibility** -- some preprocessing methods make outlier samples more or less visible.

7. **Switch to projection view.** Click the **PCA** or **UMAP** tab in any panel to see how each preprocessing method affects sample grouping. A method that produces tighter, more separated clusters in the projection is often a better choice.

8. **Lock the axis scale.** Click the **Lock Axes** button to synchronize the Y-axis range across all panels. This makes visual comparison more reliable since all panels use the same scale.

:::{note}
Comparison mode applies each panel's steps independently to the same raw data. The panels do not interact with each other -- changing a step in one panel has no effect on the others.
:::

:::{important}
The "best" preprocessing method depends on your data and your modeling goal. There is no universally superior choice. Use the Playground to make an informed decision based on what you see in your own spectra.
:::

---

## What's Next

- {doc}`reference-datasets` -- overlay a reference dataset to compare against a known standard.
- {doc}`export-to-editor` -- once you have found the best preprocessing, export those steps to build a pipeline.
- {doc}`playground-basics` -- revisit the basics if you need a refresher.
