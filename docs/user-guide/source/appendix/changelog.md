# Changelog

All notable changes to nirs4all Studio are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

---

## 0.6.2 — 2026-04-17

### Added

- **Variable Importance session state**: Selections, job status, and SHAP results persist across navigation via a dedicated session cache.
- **Prediction coloration**: New color legend and configurable point coloration (by metadata, partition, or residual magnitude) in scatter and residual charts.
- **Enriched run details**: `RunDetailSheet` split into dedicated Overview, Pipelines, and Logs panels backed by store-adapter enrichment and new backend endpoints.
- **Renderable step parameters**: `StepConfigPanel` now uses `getRenderableStepParams` for consistent parameter rendering, with unit coverage.

### Changed

- **ModelSelector (Predictions)**: Reworked with advanced filtering, sorting, and a refreshed UI for faster model discovery.
- **Aggregated predictions API**: Extended response metadata and pipeline canonical handling for richer cross-run views.
- **Score adapters**: Tightened handling of refit/repetition-aware metrics.
- **nirs4all dependency**: Raised the minimum supported nirs4all version to 0.9.1 across all managed compute profiles.
- **README**: Refreshed nirs4all offerings, installation options, and feature descriptions for clarity.

### Licensing

- **CeCILL-2.1**: Added full `LICENSES/` folder with CeCILL-2.1 plus third-party notices (NumPy, Pandas, SciPy, PyTorch, Keras, JAX, SHAP, joblib, PyWavelets, jsonschema) and updated `LICENSE` / `CONTRIBUTING.md`.

---

## 0.6.1 — 2026-04-16

### Fixed

- **Linux standalone packaging**: Switched Linux all-in-one release to tarball format with symlink dereferencing, fixed torch packaging, archive resolution, and smoke test executable detection.
- **macOS build process**: Enhanced notarization checks, spawn command handling, and model class path resolution.
- **Update extraction**: Improved nested app root resolution and extraction logic for standalone bundles.
- **Runtime environment**: Updated Python runtime structure, paths in packaging scripts, and build process handling.

### Changed

- **Release workflows**: Removed dedicated Linux release repair workflow in favor of consolidated build fixes. Added archive size reporting for Linux releases.

---

## 0.6.0 — 2026-04-16

### Added

- **All-in-one standalone bundle**: Added bundled standalone release packaging with dedicated build scripts, embedded runtime support, and smoke tests for archive extraction and executable permissions.
- **Unified prediction detail viewer**: Added richer prediction detail panels with `ChartTile`, `HeroMetrics`, configurable prediction charts, export support, and improved cross-page viewer integration.
- **Operator availability awareness**: Added node-registry loading and operator-availability invalidation so the Pipeline Editor and Settings react when installed capabilities change.

### Changed

- **Pipeline presets**: Refreshed preset loading, variant handling, and preset catalog complexity tiers for experiments and template selection.
- **Runtime modes**: Refined runtime mode detection and surfaced clearer writable vs. read-only UI feedback across environment, dependency, and update flows.
- **Predictions and results UX**: Improved dataset filtering, responsive result cards, and shared detail-sheet behavior across Results, Aggregated Results, and Predictions.
- **nirs4all dependency**: Raised the minimum supported nirs4all version to 0.9.0 across all managed compute profiles and runtime setup flows.
- **Release metadata**: Bumped nirs4all Studio to version 0.6.0 for the next published release.

---

## 0.5.1 — 2026-04-15

### Added

- **Confusion matrix export**: Classification prediction views can now export confusion matrix data directly from the prediction viewer.

### Improved

- **Prediction detail views**: Refined tab handling, model detail displays, and dataset result cards for prediction-focused workflows.
- **Validation and error messaging**: Improved API client and dataset validation feedback, with clearer localized workspace loading messages.
- **Runs redesign coverage**: Expanded visibility checks in end-to-end coverage for the redesigned runs experience.

---

## 0.5.0 — 2026-04-15

### Added

- **Runtime grouping and repetitions**: Added repetition-aware Playground and API support, grouping metadata in spectral/run responses, and new repetition-focused charts and validation.
- **Refit-aware metrics and scores**: Added refit chain lineage handling plus richer metric selection across Runs, Results, Aggregated Results, and Predictions.
- **Function model support**: Extended canonical pipeline import/export and model handling to cover function models and richer pipeline metadata.
- **Webapp node metadata**: Added `_webapp_meta` and `_webapp_split` fields so node definitions can express webapp-only curation and runtime grouping behavior.

### Changed

- **Managed dependencies**: `torch` is now handled through compute profiles rather than exposed as a normal optional dependency.
- **Aggregated views**: Aggregated results and prediction summaries now preserve repetition-aware and refit-aware metadata more consistently.

### Improved

- **Coverage**: Added backend and frontend coverage for runtime grouping, recommended config profile management, score adapters, node registry metadata, and Playground pipeline flows.

---

## 0.4.2 — 2026-04-14

### Added

- **Prediction deletion actions**: Model action menus can now delete predictions at chain or group scope with confirmation dialogs and cache invalidation.
- **Estimation fallback coverage**: Added tests for pipeline variant estimation fallback and enriched run/store adapter responses.

### Improved

- **Pipeline variant estimation**: Improved error handling and fallback behavior when estimating run variants.
- **Inspector and importance visuals**: Refined spectral importance charts, variable-importance controls, histograms, and related score card interactions.

---

## 0.4.1 — 2026-04-13

### Added

- **Canonical pipeline round-tripping**: Added broader canonical pipeline conversion and round-trip handling for presets, imports, and editor execution previews.
- **Preset authoring and editor flows**: Expanded preset loading/generation, pipeline conversion utilities, branch/generator renderers, and execution preview support in the Pipeline Editor.
- **Run progress and readiness feedback**: Added stronger run progress presentation and ML readiness state handling across the app.

### Changed

- **nirs4all dependency**: Updated managed configuration and tests to nirs4all 0.8.9.

### Improved

- **Runs and prediction detail panels**: Refined Run Detail and Model Detail flows, with additional integration coverage for dataset group memberships and presets.

---

## 0.4.0 — 2026-04-08

### Added

- **Shared Query Hooks**: New `useDatasetsQuery` and `useLinkedWorkspacesQuery` hooks centralize dataset and workspace fetching with shared TanStack Query cache, eliminating duplicate API calls across `NewExperiment`, `Predictions`, `Results`, `Runs`, and `Settings` pages.
- **Backend Startup Banner**: New `BackendStartupBanner` component surfaces backend readiness state during app launch.
- **Selected-Only Visualizations**: `SpectraChartV2` and histogram components now support a selected-only view with tooltip toggles. `HistogramClassification` renders stacked bar segments for selection, partition, and metadata modes.
- **Test Coverage**: Added test suites for dataset queries, playground partition selector, color configuration, target histograms, and store integration. New `conftest.py` fixtures isolate user settings during tests.

### Improved

- **Dataset & Workspace Types**: Extended dataset types with groups and score entry structures for richer API responses.
- **Playground**: Enhanced color legend, partition selector, reference mode controls, and histogram data filtering based on sample selection.
- **Settings Page**: Workspace list now uses the shared query hook with a change callback for live updates.
- **Auto Display Mode**: `SpectraChartV2` automatically switches display mode when no samples are selected.

### Fixed

- Dataset top chains deduplication and metadata loading behavior.

---

## 0.3.2 — 2026-04-03

*(Release notes pending)*

---

## 0.3.1 — 2026-04-02

### Added

- **Portable Mode**: Run nirs4all Studio entirely from a USB drive or self-contained folder — no system-wide installation required. Legacy data is automatically migrated.
- **GPU Detection**: Richer GPU diagnostics in Settings, including driver version and detection source.

### Improved

- **Environment Manager**: Better logging and error handling during Python environment setup.
- **Update System**: More reliable version detection for portable deployments.

---

## 0.3.0 — 2026-04-01

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

## 0.1.0 — Initial Release (2026-02-24)

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
