(synthetic-data-testing)=
# Test with Synthetic Data

**Time**: ~10 minutes | **Level**: Beginner

Sometimes you want to test a pipeline, explore the application, or teach a colleague how nirs4all Studio works -- but you do not have a real NIRS dataset at hand. The **Spectra Synthesis** tool in the Lab section generates realistic synthetic NIRS datasets with configurable properties. The generated data includes 111 built-in spectral components that mimic real absorption features, with adjustable complexity, noise levels, and scattering effects.

In this tutorial you will generate a synthetic dataset, import it into your workspace, and run a quick experiment to verify that everything works.

:::{admonition} Prerequisites
:class: note

- nirs4all Studio is installed and running (see {doc}`../getting-started/installation`).
- You have a workspace configured (see {doc}`../getting-started/first-launch`).
:::

---

## Step 1 -- Open the Spectra Synthesis tool

1. Click **Lab** in the left sidebar. The Lab section contains advanced tools for specialized tasks.
2. Click **Spectra Synthesis**. The synthesis configuration page opens.

```{figure} ../_images/lab/synth-overview.png
:alt: Spectra Synthesis page with configuration controls
:width: 100%

The Spectra Synthesis page lets you configure and generate realistic synthetic NIRS datasets.
```

The page is divided into two areas:
- **Left panel** -- configuration controls for the synthetic dataset.
- **Right panel** -- a live preview that updates as you adjust settings.

---

## Step 2 -- Configure the dataset parameters

The synthesis tool offers several settings that control the characteristics of the generated data. Adjust them based on what you want to test.

### 2a -- Basic settings

1. **Number of samples** (`n_samples`): set the number of spectra to generate. Start with `200` for a quick test or `500` for a more realistic dataset.
2. **Dataset name**: give the dataset a descriptive name, such as `Synthetic Test 200`.
3. **Task type**: choose between **Regression** (continuous target values) and **Classification** (categorical labels).

### 2b -- Spectral complexity

1. **Complexity**: select from **simple**, **moderate**, or **realistic**.
   - **Simple** -- spectra are based on a small number of components with clean, distinct peaks. Ideal for learning and quick tests.
   - **Moderate** -- more overlapping components and subtle features. A good middle ground.
   - **Realistic** -- uses many of the 111 built-in spectral components with overlapping absorption bands, producing spectra that closely resemble real NIRS measurements.

:::{admonition} About the 111 spectral components
:class: info

The synthesis engine includes 111 pre-defined spectral absorption components modeled after real organic molecules commonly measured in NIRS: water, proteins, sugars, fats, cellulose, starch, and many others. Each component has a characteristic absorption profile. The complexity setting controls how many of these components are mixed together.
:::

### 2c -- Noise and scattering

1. **Noise level**: controls the amount of random noise added to each spectrum. Use `low` for clean data or `high` to simulate noisy instruments.
2. **Scattering**: toggles multiplicative scatter effects (similar to particle-size variations in real samples). Enable this to make the data more realistic and to test whether your preprocessing (SNV, MSC) handles scatter properly.
3. **Baseline drift**: toggles a slowly varying baseline offset. Enable this to test baseline correction methods.

### 2d -- Target properties

1. **Number of targets**: how many target variables to include (default: 1). You can generate multi-target datasets.
2. **Target range**: the approximate range of values for the target variable (e.g., 0 to 100 for a percentage measurement).
3. **Target noise**: the amount of noise in the relationship between spectra and targets. Low noise means the relationship is very learnable; high noise means even a perfect model will have residual error.

:::{tip}
For your first synthetic dataset, use these settings: 200 samples, moderate complexity, low noise, scattering enabled. This produces a dataset that is realistic enough to be interesting but easy enough for a simple PLS model to handle well.
:::

---

## Step 3 -- Preview and generate

1. As you adjust settings, the **live preview** in the right panel updates:
   - A **spectra overlay** showing what the generated spectra will look like.
   - A **target distribution** histogram.
   - Summary statistics (sample count, wavelength range, signal-to-noise ratio).

2. Review the preview. If the spectra look reasonable, click the **Generate** button.

3. A progress bar appears briefly while the dataset is computed. For 200 samples, this takes a few seconds.

4. When generation completes, a success message appears with two options:
   - **Import to Workspace** -- adds the generated dataset to your active workspace.
   - **Download as CSV** -- saves the data as a CSV file to your computer.

```{figure} ../_images/lab/synth-preview.png
:alt: Synthesis preview showing generated spectra and target distribution
:width: 100%

The preview updates in real time as you adjust parameters, showing the spectra and target distribution.
```

---

## Step 4 -- Import the synthetic dataset

1. Click **Import to Workspace**. The dataset is added to your workspace immediately.
2. A confirmation toast appears: *"Synthetic Test 200" imported to workspace*.
3. Click the link in the toast (or navigate to **Datasets** in the sidebar) to see the dataset on the Datasets page.

The imported dataset behaves exactly like any real dataset -- you can inspect it, use it in experiments, and compare it with other datasets.

---

## Step 5 -- Verify the dataset

1. Click on the synthetic dataset in the Datasets list. The **Dataset Detail** page opens.
2. Check the four tabs:

   - **Overview** -- verify the sample count, feature count, and target column.
   - **Spectra** -- the overlay chart should show spectra with the characteristics you configured (noise, scatter, complexity).
   - **Targets** -- the histogram should show a distribution matching the target range you set.
   - **Raw Data** -- the data table should display numeric spectral values.

:::{note}
Synthetic datasets are tagged with a *Synthetic* badge on the Datasets page, so you can easily distinguish them from real data.
:::

---

## Step 6 -- Run a quick experiment

Now use the synthetic dataset to test a pipeline:

1. Click **Pipelines** in the sidebar and select a pipeline (or create one -- see {doc}`first-experiment`, step 4).
2. Click **Use in Experiment** to open the experiment wizard.
3. In the wizard:
   - **Select Datasets**: check the synthetic dataset.
   - **Select Pipelines**: confirm your pipeline is selected.
   - **Review**: verify the summary.
   - **Launch**: click **Launch Experiment**.
4. Watch the progress on the Run Progress page.
5. When the experiment completes, go to **Results** to see the scores.

### Interpreting results on synthetic data

Because you control the target noise level, you know what to expect:

| Target noise setting | Expected R2 | What this tells you |
|---|---|---|
| **Low** | > 0.95 | If R2 is much lower, the pipeline may be misconfigured |
| **Moderate** | 0.80 - 0.95 | A reasonable result; the model captures the main signal |
| **High** | 0.50 - 0.80 | Even a perfect model cannot fully predict noisy targets |

:::{tip}
Synthetic data is excellent for benchmarking. If a pipeline achieves R2 > 0.95 on low-noise synthetic data but R2 < 0.5 on your real data, the issue is likely with the real data (quality, spectral range, or complexity) rather than the pipeline configuration.
:::

---

## Bonus -- Use synthetic data for teaching

Synthetic datasets are ideal for workshops, demonstrations, and training sessions:

- Generate datasets with known properties so students can verify their results.
- Create a **simple** dataset first to show how a basic pipeline works, then increase complexity and noise to demonstrate when advanced techniques (derivatives, branching, parameter sweeps) become necessary.
- Generate classification datasets (3-5 classes) to demonstrate the classification workflow.

---

## What you learned

In this tutorial you:

1. Opened the Spectra Synthesis tool in the Lab section.
2. Configured dataset parameters: sample count, complexity, noise, and scattering.
3. Previewed the generated spectra and target distribution.
4. Generated the dataset and imported it into your workspace.
5. Verified the dataset using the Dataset Detail page.
6. Ran an experiment on the synthetic data and interpreted the results.

---

## Next steps

- {doc}`first-experiment` -- If this was your first time using nirs4all Studio, follow the full experiment tutorial with a real dataset.
- {doc}`build-advanced-pipeline` -- Use synthetic data to safely experiment with advanced pipeline features like generators and branching.
- {doc}`compare-preprocessing` -- Generate a synthetic dataset with scattering enabled, then use the Playground to see how SNV and MSC correct it.
