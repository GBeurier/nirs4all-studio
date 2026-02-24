# Changelog

All notable changes to nirs4all Studio are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

---

## [0.1.0] — 2026-02-24

Initial release.

### Added

- **Datasets**: Import and manage NIRS datasets from CSV, Excel, Parquet, MATLAB, NumPy, and HDF5 files. Multi-step import wizard with auto-detection. Dataset groups for organization. Drag-and-drop import. Batch folder scanning.
- **Dataset Detail**: View spectra charts, target distributions, raw data tables, and dataset metadata.
- **Pipelines**: Visual drag-and-drop Pipeline Editor with step palette. Built-in preset library. Pipeline import/export as JSON. Support for branching, merging, and generators (`_or_`, `_range_`, `_log_range_`, `_cartesian_`).
- **Experiments**: Multi-step experiment wizard. Real-time progress monitoring with WebSocket updates. Live log streaming. Fold and variant tracking.
- **Results**: Dataset-grouped performance scores. Aggregated results across chains. Prediction storage and export.
- **Playground**: Interactive preprocessing and visualization. Real-time spectral chart updates. PCA/UMAP projections. Step comparison mode. Reference dataset overlay.
- **Inspector**: Model performance analysis with scatter, heatmap, histogram, candlestick, residuals, confusion matrix, and rankings views.
- **Lab — Spectra Synthesis**: Generate synthetic NIRS datasets with 111 spectral components. Configurable complexity, noise, and scattering.
- **Lab — Transfer Analysis**: Evaluate dataset similarity with centroid distance, manifold alignment, and KNN metrics.
- **Lab — Variable Importance**: SHAP-based feature importance with spectral, beeswarm, bar, and per-sample visualizations.
- **Settings**: Light/Dark/System themes. Compact/Comfortable/Spacious display density. UI zoom (75%–150%). Three languages (English, French, German). Workspace management. Data loading defaults. Developer mode.
- **Desktop app**: Electron-based with native window management, file dialogs, and auto-updates.
- **Cross-platform**: Windows, macOS, and Linux support. GPU acceleration (CUDA/Metal) for deep learning models.
