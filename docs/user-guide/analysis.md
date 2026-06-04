# Analysis tools

nirs4all Studio includes several analysis surfaces for exploring datasets,
prediction outputs, model behavior, and synthetic spectra.

## Playground

The Playground is an interactive workspace for trying operators and visualizing
spectral transformations. It includes:

- operator palette
- data upload and source dataset selection
- spectra views
- dimensionality reduction views
- fold distribution views
- outlier and selection tools
- reference and difference modes
- export helpers

Use it before formalizing a pipeline when you need to understand how an
operator changes the data.

## Predictions

The Predictions page focuses on prediction chains and sample-level outputs. It
can inspect stored prediction arrays from linked workspaces and show chain
details where the backend can resolve them.

## Analysis page

The Analysis page exposes backend analysis endpoints such as:

- PCA
- PCA loadings
- scree data
- t-SNE
- UMAP
- correlation
- feature selection
- wavelength selection
- method discovery

These endpoints operate on datasets or arrays that the backend can load from
the active workspace.

## Transfer analysis

Transfer analysis compares dataset or preprocessing behavior across domains. It
uses transfer presets and preprocessing options returned by the backend.

## Variable importance

Variable importance views use trained model outputs and SHAP-oriented backend
routes where available. They are intended for model inspection, not as a
replacement for scientific validation.

## Spectra synthesis

The Synthesis page builds synthetic NIRS-like datasets for development,
testing, demonstrations, and stress testing. It can preview and generate
spectra with configurable targets, metadata, feature structure, nonlinear
effects, batch effects, and partitions.

Synthetic datasets are not evidence for scientific performance. Use them to
exercise workflows and UI behavior.
