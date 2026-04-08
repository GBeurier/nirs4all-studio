# Changelog

All notable changes to nirs4all Studio are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

---

## [0.3.7] — 2026-04-08

*(Release notes pending)*

---

## [0.3.2] — 2026-04-03

*(Release notes pending)*

---

## [0.3.1] — 2026-04-02

### Added

- **Portable Mode**: Full portable deployment support — the app can run entirely from a USB drive or self-contained folder with no system-wide installation. Includes automatic migration of legacy data layouts.
- **GPU Detection**: New shared GPU hardware detection module (`gpu_detection.py`) with nvidia-smi, Windows WMI, and PyTorch runtime probes. The `/system` endpoint now returns richer GPU diagnostics (driver version, detection source).
- **Runtime Paths**: Centralized runtime path resolution (`runtime_paths.py`) for consistent directory handling across installed and portable modes.
- **Build Versioning**: Release build scripts now embed version info from `package.json` automatically.
- **Smoke Test Script**: PowerShell script (`smoke-portable-isolation.ps1`) for validating portable-mode isolation.

### Improved

- **Environment Manager**: Refactored Electron env-manager to support portable backend directories and improved logging/error handling for package management.
- **Update System**: Updater now prefers runtime-detected version over cached data; portable-aware backend directory resolution.
- **Dependencies Manager UI**: Updated to reflect base version management.
- **Recommended Config**: Refactored configuration endpoint with improved GPU info response fields.

---

## [0.3.0] — 2026-04-01

### Changed

- **nirs4all dependency**: Updated to nirs4all 0.8.6 (from 0.7.1). All compute profiles (CPU, GPU-CUDA, GPU-MPS) now require >=0.8.6.

### Added

- **Predictions**: New prediction feature with model selection and data input.
- **Dependencies Manager**: Enhanced with version status indicators and revert actions.
- **Playground**: New augmentation methods and updated category configurations.
- **Results & Runs**: Metric selection, best_params display, and improved UI.
- **Dataset Wizard**: Refactored to support effective parsing parameters and improved data handling.
- **Preprocessing**: Enhanced operators with comprehensive operator definitions.
- **Chain Summaries**: New endpoint for retrieving all chain summaries for a dataset.
- **Translations**: Added Chinese (Simplified) translations.

### Improved

- **Storage**: Migrated from DuckDB to SQLite for hybrid storage.
- **Environment Management**: Refactored Python environment setup, improved wizard and app readiness checks.
- **Crash Reporting**: Integrated Sentry across all layers (frontend, backend, Electron).
- **Update System**: Refactored and improved update process and test coverage.
- **App Settings**: Atomic JSON writes for reliability.

---

## [0.2.0] — 2026-02-24

Intermediate releases (0.2.1–0.2.5) are folded into 0.3.0 above.

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
