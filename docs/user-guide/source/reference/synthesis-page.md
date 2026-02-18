# Spectra Synthesis Page

The **Spectra Synthesis** page (found under **Lab**) generates synthetic near-infrared spectral datasets. Synthetic data is useful for testing pipelines, benchmarking models, and educational purposes. The generator uses 111 built-in spectral components to produce realistic absorption profiles with configurable noise and scattering effects.

```{figure} ../_images/lab/lab-synthesis-overview.png
:alt: Spectra Synthesis page overview
:width: 100%

The Spectra Synthesis page showing configuration controls on the left and a preview chart on the right.
```

---

## Page layout

| Region | Position | Purpose |
|--------|----------|---------|
| **Configuration panel** | Left side | Set generation parameters: sample count, complexity, noise, and scattering. |
| **Preview chart** | Right side | Displays a real-time preview of the spectra that will be generated. |
| **Action bar** | Bottom | Generate and import buttons. |

---

## Configuration controls

### Sample count

| Control | Description |
|---------|-------------|
| **n_samples slider** | Set the number of spectra to generate. Range: 10 to 5000. Default: 500. |
| **Numeric input** | Type an exact value directly instead of using the slider. |

### Complexity

| Option | Description |
|--------|-------------|
| **Simple** | Spectra with 1--3 absorption peaks. Clean, well-separated bands. Suitable for quick testing. |
| **Moderate** | Spectra with 3--8 peaks and mild overlap. Represents typical controlled laboratory conditions. |
| **Realistic** | Spectra with many overlapping peaks, baseline drift, and inter-sample variability. Mimics real-world NIRS data from field instruments. |

### Noise level

| Control | Description |
|---------|-------------|
| **Noise slider** | Controls the amplitude of random noise added to each spectrum. Range: 0 (none) to 1 (high). Default: 0.1. |

At zero noise the spectra are perfectly smooth. Increasing noise adds Gaussian random perturbations to simulate detector noise.

### Scattering

| Control | Description |
|---------|-------------|
| **Scattering toggle** | Enable or disable multiplicative scattering effects. |
| **Scattering intensity** | When enabled, controls the magnitude of scattering variation across samples. Range: 0.01 to 0.5. |

Scattering simulates the physical light-scattering variability common in diffuse reflectance NIRS measurements (e.g., particle-size effects in powders).

---

## Spectral components

The generator draws from a library of **111 built-in spectral components** corresponding to common near-infrared absorption bands. These include:

- O-H stretching and combination bands (water, alcohols).
- C-H stretching (lipids, carbohydrates, organic matter).
- N-H stretching and bending (proteins, amines).
- C=O overtones and combinations.

The **complexity** setting determines how many components are mixed into each spectrum and how much their concentrations vary between samples.

:::{note}
The exact component selection and mixing proportions are randomized. Each generation run produces a different dataset, even with the same parameters.
:::

---

## Preview chart

The preview chart updates in real time as you adjust the configuration controls. It shows a subset of the spectra that would be produced with the current settings (typically the first 50 spectra for performance).

| Interaction | Description |
|-------------|-------------|
| **Hover** | See the wavelength and absorbance value for a specific point. |
| **Zoom** | Scroll to zoom into a wavelength region. |
| **Reset** | Double-click to restore the full view. |

The preview lets you visually verify that the complexity, noise, and scattering settings produce spectra with the characteristics you need before committing to a full generation.

---

## Actions

### Generate

Click **Generate** to produce the full dataset with the configured parameters. A progress indicator appears during generation. For large sample counts (>2000), generation may take several seconds.

### Import as dataset

After generation completes, click **Import as Dataset** to save the synthetic data as a new dataset in your workspace. You will be prompted to provide a name for the dataset. Once imported, the synthetic dataset appears on the {doc}`datasets-page` and can be used in experiments like any other dataset.

The generated dataset includes:

| Field | Description |
|-------|-------------|
| **Spectra (X)** | The synthetic absorbance spectra, one row per sample. |
| **Target values (y)** | Known concentration values derived from the component mixing proportions. These serve as ground-truth labels for regression tasks. |
| **Wavelengths** | The wavelength axis matching standard NIR ranges. |
| **Metadata** | Records the generation parameters (complexity, noise, scattering) for reproducibility. |

:::{tip}
Synthetic datasets with known target values are ideal for validating that your pipeline and model selection logic work correctly before applying them to real data.
:::

:::{seealso}
- {doc}`datasets-page` -- Manage imported datasets, including synthetic ones.
- {doc}`playground-page` -- Apply preprocessing to synthetic spectra interactively.
- {doc}`transfer-page` -- Compare synthetic data against real data to assess similarity.
:::
