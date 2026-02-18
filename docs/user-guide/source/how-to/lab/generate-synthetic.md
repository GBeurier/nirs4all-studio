# Generate Synthetic Spectra

This guide shows you how to generate synthetic NIRS datasets using the Spectra Synthesis tool. Synthetic data is useful for testing pipelines, teaching, benchmarking preprocessing methods, or augmenting small datasets.

## Prerequisites

- A workspace is open in nirs4all Studio.

## Steps

1. **Open the Spectra Synthesis tool.** Click **Lab** in the sidebar navigation, then select **Spectra Synthesis**.

   ```{figure} ../../_images/lab/lab-synthesis-overview.png
   :alt: Spectra Synthesis overview page showing configuration controls and a spectral preview
   :width: 700px

   The Spectra Synthesis page with parameter controls on the left and a live spectral preview on the right.
   ```

2. **Set the number of samples.** Use the **Number of Samples** field to specify how many spectra you want to generate. Typical values range from 50 to 5000 depending on your use case.

3. **Choose a complexity level.** The **Complexity** selector controls how realistic the generated spectra are:

   - **Simple** -- smooth spectra with a few broad absorption peaks.
   - **Moderate** -- additional overlapping peaks and baseline variation.
   - **Realistic** -- full spectral complexity with 111 spectral components, mimicking real-world NIRS measurements.

   :::{tip}
   Start with **Realistic** complexity if you want data that closely resembles real instrument output. Use **Simple** when you need clean data to test a specific preprocessing step in isolation.
   :::

4. **Adjust the noise level.** The **Noise** slider controls the amount of random noise added to the spectra. A low value produces clean spectra; a high value simulates noisy instrument conditions.

5. **Configure scattering effects.** The **Scattering** option adds multiplicative and additive scatter to the spectra, simulating particle size variation and path length differences commonly seen in diffuse reflectance measurements.

   :::{note}
   Enabling scattering is recommended when you want to evaluate how well preprocessing methods such as SNV or MSC handle scatter correction.
   :::

6. **Preview the spectra.** As you adjust parameters, the preview chart on the right updates in real time. The chart shows a sample of the generated spectra so you can visually verify they match your expectations.

7. **Generate the dataset.** Click the **Generate** button. The synthesis engine creates the full dataset based on your configuration. A progress indicator appears during generation.

8. **Review the generated data.** Once generation is complete, a summary appears showing the number of samples, the number of spectral features (wavelengths), the target variable statistics, and a spectral overview chart.

9. **Import as a dataset.** Click **Import as Dataset** to add the synthetic data to your workspace. Give it a descriptive name (e.g., "Synthetic - Realistic 500 samples") so you can easily identify it later in the Datasets page.

---

## What Can You Do with Synthetic Data?

- **Test pipelines** -- Run a pipeline on synthetic data before committing real datasets.
- **Benchmark preprocessing** -- Compare how SNV, MSC, or Savitzky-Golay perform on data with known scatter.
- **Teach and demonstrate** -- Use clean, predictable spectra for training sessions.
- **Augment small datasets** -- Supplement limited real-world data with synthetic samples to improve model robustness.

:::{warning}
Synthetic spectra approximate real measurements but do not replace them. Always validate models on real instrument data before deploying them.
:::

## What's Next

- {doc}`/how-to/datasets/import-csv` -- Learn about importing real-world datasets.
- {doc}`transfer-analysis` -- Compare your synthetic dataset against a real one to evaluate similarity.
