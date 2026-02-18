# Add Preprocessing Steps

Preprocessing transforms raw spectra before they are fed to a model. Choosing the right preprocessing can significantly improve your results. This guide describes the available preprocessing steps and how to add them to your pipeline.

## Prerequisites

- You have a pipeline open in the Pipeline Editor (see {doc}`create-pipeline`).

## Where Preprocessing Goes

Preprocessing steps are placed **at the beginning** of the pipeline, before the splitter and model. You can chain multiple preprocessing steps -- they will execute in order, from top to bottom.

A common pattern:

```
Scatter correction (SNV or MSC)
  --> Smoothing or derivative (Savitzky-Golay)
    --> Splitter (KFold)
      --> Model (PLS Regression)
```

## Adding a Preprocessing Step

1. In the Step Palette (left panel), expand the **Preprocessing** category.
2. Find the step you want. Use the search box to filter by name.
3. Drag the step into the pipeline tree at the desired position, or click the **+** button and select it from the menu.
4. Click the step in the tree to configure its parameters in the right panel.

## Available Preprocessing Steps

### Scatter Correction

These steps correct for physical scattering effects that add unwanted variation to NIR spectra. Scattering happens because of differences in particle size, sample density, or measurement conditions.

SNV (Standard Normal Variate)
: Normalizes each spectrum individually so it has a mean of zero and a standard deviation of one. This removes differences in overall signal intensity between samples.
: **Parameters**: none (parameter-free).
: **When to use**: as a default first step for most NIRS analyses.

MSC (Multiplicative Scatter Correction)
: Corrects each spectrum by comparing it to a reference spectrum (typically the average of all spectra). Removes both additive and multiplicative scatter effects.
: **Parameters**: `reference` -- by default, uses the mean spectrum.
: **When to use**: similar to SNV. Try both and compare results.

Detrend
: Removes polynomial baseline trends from spectra by fitting and subtracting a polynomial.
: **Parameters**: `order` -- polynomial degree (default: 2). Higher values remove more complex trends.
: **When to use**: when spectra show a curved or sloping baseline.

### Smoothing and Derivatives

Savitzky-Golay
: A versatile filter that can smooth spectra, compute first or second derivatives, or both. It works by fitting a polynomial to a sliding window of points.
: **Key parameters**:
  - `window_length` -- size of the smoothing window (must be an odd number; default: 11). Larger windows give more smoothing.
  - `polyorder` -- polynomial degree (default: 2). Must be less than the window length.
  - `deriv` -- derivative order: 0 = smoothing only, 1 = first derivative, 2 = second derivative. Derivatives can remove baseline effects and highlight peaks.
: **When to use**: for smoothing noisy spectra, or to compute derivatives that emphasize changes in spectral shape.

:::{tip}
The first derivative (`deriv=1`) removes constant baseline offsets. The second derivative (`deriv=2`) removes both offset and slope, and sharpens peaks. However, each derivative amplifies noise, so you may need to increase the window length for higher derivatives.
:::

### Baseline Correction

BaselineCorrection
: Fits a polynomial baseline to the spectrum and subtracts it. Useful when spectra have a slowly varying background signal.
: **Parameters**: `order` -- polynomial degree (default: 2).

ALS (Asymmetric Least Squares)
: An advanced baseline correction that iteratively fits a smooth baseline below the spectrum. Good for complex baselines that a simple polynomial cannot capture.
: **Parameters**: `lam` (smoothness) and `p` (asymmetry weight).

### Scaling

StandardScaler
: Scales each wavelength (feature) across all samples to have zero mean and unit variance. This is different from SNV, which normalizes each sample individually.
: **Parameters**: none.
: **When to use**: when wavelength ranges differ greatly in magnitude.

MinMaxScaler
: Scales each feature to a fixed range (by default, 0 to 1).
: **Parameters**: `feature_range_min` and `feature_range_max`.

### Feature Selection

WavelengthSelector
: Restricts the analysis to a specific spectral range by selecting only certain wavelengths. Removing uninformative regions can improve model performance.
: **Parameters**: start and end wavelengths.

CARS (Competitive Adaptive Reweighted Sampling)
: An automated variable selection method that uses PLS to iteratively identify the most informative wavelengths.
: **Parameters**: `n_pls_components`, `n_sampling_runs`.

## Combining Preprocessing Steps

You can chain multiple preprocessing steps. Common combinations:

| Combination | Benefit |
|---|---|
| SNV then Savitzky-Golay (1st derivative) | Removes scatter, then removes baseline and highlights peaks |
| MSC then StandardScaler | Removes scatter, then equalizes wavelength ranges |
| Savitzky-Golay (smoothing) then SNV | Reduces noise before scatter correction |
| Detrend then SNV | Removes trends, then normalizes |

:::{warning}
The order of preprocessing steps matters. For example, applying a derivative before scatter correction produces different results than scatter correction followed by a derivative. A general guideline is: scatter correction first, then derivatives or smoothing.
:::

## What's Next

- {doc}`add-model` -- add a model to complete your pipeline
- {doc}`add-splitter` -- set up cross-validation
- {doc}`use-generators` -- automatically compare different preprocessing methods
