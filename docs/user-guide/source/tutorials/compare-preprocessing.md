(compare-preprocessing)=
# Comparing Preprocessing Methods

**Time**: ~10 minutes | **Level**: Beginner

NIR spectra often contain unwanted effects -- scatter variations, baseline drift, or noise -- that hide the chemical information you want to extract. Preprocessing removes these artifacts before modeling. But which method should you use?

In this tutorial you will use the **Playground** page to visually compare the three most common preprocessing methods: **SNV**, **MSC**, and **Savitzky-Golay derivatives**. You will see their effect on the spectra in real time, check a PCA projection, and export the best option to the Pipeline Editor.

:::{admonition} Prerequisites
:class: note

- You have at least one dataset imported into your workspace (see {doc}`first-experiment`).
:::

---

## Step 1 -- Open the Playground

1. Click **Playground** in the left sidebar.

   ```{figure} ../_images/explore/pg-overview.png
   :alt: Playground page overview
   :width: 100%

   The Playground has a sidebar (left) for operators and a main canvas (right) for visualizations.
   ```

2. The Playground is a sandbox where you can add preprocessing operators and immediately see how they transform your data. Nothing you do here affects your saved datasets or pipelines.

---

## Step 2 -- Load a dataset

1. In the Playground sidebar, click the dataset selector at the top.
2. A list of workspace datasets appears. Select the dataset you want to explore.
3. Wait a moment while the data loads. The main canvas will display the **raw spectra** chart -- an overlay of all samples plotted across wavelengths.

:::{tip}
If you do not have a dataset yet, click **Load Demo Data** to work with a built-in example dataset. This is useful for practicing.
:::

### What you see

- The **Spectra** chart shows every sample as a line. The x-axis is the wavelength, and the y-axis is absorbance.
- Below the spectra chart you may see a **Histogram** of the target values and a **PCA** projection.
- The sidebar shows an empty operator list -- no preprocessing has been applied yet.

---

## Step 3 -- Add SNV and observe the changes

**SNV (Standard Normal Variate)** corrects multiplicative scatter by centering and scaling each spectrum individually. It is the most widely used preprocessing in NIR spectroscopy.

1. In the Playground sidebar, click the **+** button to add an operator.
2. In the operator list, find **SNV** under the **Preprocessing** category and click it.
3. The operator appears in the sidebar list, and the spectra chart updates automatically.

### What to look for

Compare the chart before and after SNV:

- **Before SNV**: Spectra may show vertical offset differences (parallel shifts) caused by scatter. Samples that should be similar may appear spread apart.
- **After SNV**: The spectra overlap more tightly. Offset differences are removed, and the chemical absorption features become clearer.

:::{admonition} How SNV works (simple explanation)
:class: info

For each spectrum, SNV subtracts its own mean and divides by its own standard deviation. This forces every spectrum to have the same average (zero) and the same spread (one). The result is that physical differences between samples (like particle size) are reduced while chemical differences are preserved.
:::

---

## Step 4 -- Try MSC instead

**MSC (Multiplicative Scatter Correction)** also corrects scatter, but it works differently from SNV. It regresses each spectrum against the mean spectrum and corrects the slope and offset.

1. Click the **toggle switch** on the SNV operator to disable it (the eye icon turns off). This temporarily removes its effect without deleting it.
2. Add a new operator: click **+**, find **MSC** under Preprocessing, and click it.
3. Observe the spectra chart.

### Comparing SNV and MSC

To compare them side by side:

1. Enable the **Step Comparison** mode using the toggle in the toolbar above the spectra chart.
2. Use the step slider to switch between the raw spectra, the SNV result, and the MSC result.
3. Look for differences:
   - SNV and MSC produce very similar results on most datasets.
   - MSC can be slightly better when spectra have strong linear scatter components.
   - SNV is faster to compute and does not require a reference spectrum.

:::{admonition} How MSC works (simple explanation)
:class: info

MSC first calculates the average spectrum across all samples. Then, for each individual spectrum, it finds the best straight-line fit (slope and intercept) to that average. Finally, it removes the slope and intercept, leaving only the deviations that represent real chemical differences.
:::

---

## Step 5 -- Try Savitzky-Golay derivatives

**Savitzky-Golay (SG)** smoothing and differentiation is a different approach. Instead of correcting scatter directly, it computes the first or second derivative of the spectra. Derivatives remove baseline effects and sharpen overlapping peaks.

1. Disable the MSC operator (toggle it off).
2. Add a new operator: click **+**, find **SavitzkyGolay** under Preprocessing, and click it.
3. In the operator's parameter panel (shown in the sidebar), set:
   - **window_length**: `11` (the number of points used for local smoothing)
   - **polyorder**: `2` (polynomial order for the fit)
   - **deriv**: `1` (first derivative)
4. Observe the spectra chart.

### What to look for

- The first derivative spectra look completely different from the raw or SNV-corrected spectra. The y-axis now represents the rate of change of absorbance.
- **Peaks** in the raw spectra become **zero crossings** in the first derivative.
- **Shoulders** (hidden peaks) in the raw spectra become visible as separate features in the derivative.
- Baseline offset is completely removed (a constant offset has zero derivative).

:::{tip}
Try changing **deriv** to `2` for the second derivative. This sharpens peaks further but also amplifies noise. Increase **window_length** to `15` or `21` to smooth more aggressively.
:::

---

## Step 6 -- Check the PCA projection

The **PCA** chart in the main canvas shows a 2D projection of your samples. It is useful for spotting clusters, outliers, and the effect of preprocessing.

1. Enable one preprocessing operator at a time and observe how the PCA plot changes.
2. Look for:
   - **Tighter clusters** after preprocessing -- this means scatter noise has been reduced.
   - **Outlier samples** that sit far from the main group -- these may be bad scans.
   - **Group separation** -- if your samples come from different sources or conditions, good preprocessing should reveal this structure.

:::{admonition} Enabling UMAP
:class: hint

For a nonlinear projection, toggle the **UMAP** option in the chart toolbar. UMAP can reveal structure that PCA misses, but it takes longer to compute.
:::

---

## Step 7 -- Export the best preprocessing to the Pipeline Editor

Once you have decided which preprocessing works best for your data:

1. Make sure only the desired operators are enabled in the sidebar. Disable or remove the ones you do not want.
2. Click the **Export** menu in the sidebar toolbar.
3. Select **Export to Pipeline Editor**.
4. nirs4all Studio opens the Pipeline Editor with your operators already loaded as pipeline steps.
5. From here, add a splitting step and a model step to complete the pipeline (as described in {doc}`first-experiment`).

:::{tip}
You can also export the processed data as a CSV file using the **Export Data (CSV)** option in the Export menu. This is useful if you want to analyze the preprocessed spectra in external software.
:::

---

## Quick reference -- When to use each method

| Method | Best for | Removes | Preserves |
|---|---|---|---|
| **SNV** | Most NIR datasets. Fast, simple, no parameters. | Multiplicative scatter (offset + slope) | Chemical absorption features |
| **MSC** | Datasets with strong linear scatter. | Multiplicative scatter (relative to mean spectrum) | Chemical absorption features |
| **SG 1st derivative** | Removing baseline drift, sharpening peaks. | Additive baseline, offset | Peak positions and shapes (as slope) |
| **SG 2nd derivative** | Maximum peak resolution. | Baseline + linear drift | Peak curvature (sharpest features) |

For many practical datasets, **SNV followed by SG first derivative** is an excellent combination. You can chain both operators in the Playground to see their combined effect.

---

## What you learned

In this tutorial you:

1. Loaded a dataset into the Playground.
2. Applied SNV preprocessing and observed the scatter correction.
3. Compared MSC as an alternative scatter correction.
4. Tried Savitzky-Golay derivatives to remove baseline and sharpen peaks.
5. Used PCA to assess the impact of each preprocessing method.
6. Exported the chosen preprocessing to the Pipeline Editor.

---

## Next steps

- {doc}`build-advanced-pipeline` -- Use generators and parameter sweeps to automatically test multiple preprocessing options in a single experiment.
- {doc}`first-experiment` -- Run a full experiment with the preprocessing you selected.
