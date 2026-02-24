# Backlog

Development backlog for nirs4all Studio. Items are organized by area.

---

## Priority / Next

- Add mypy check
- Add documentation links and update warnings in the UI
- Stop full dataset list refresh on single dataset delete

### Packaging & Distribution

- Clean results display
- Verify update mechanism
- Code signing for app stores

---

## Global

- Multi-target handling: select target(s) in run/pipeline, Playground sorting, prediction visualization (2D/3D/PCA)
- Clean remaining `console.log` calls
- Review runs/predictions/results loading with correct Parquet table (see nirs4all Parquet format extension)
- Add ability to browse predictions Parquet directly, and workspaces (runs, results, predictions)
- Auto-detect CUDA/Metal and display GPU status; pre-configure library install per platform (PyTorch GPU on Windows, TF/PyTorch/JAX on Linux, etc.)

---

## Desktop

- Mouse wheel zoom or zoom menu
- Window resize to match screen size (too small on large screens)

---

## Dashboard

- Rethink as a settings hub or remove entirely

---

## Datasets

### Features

- Multiple target support
- Drag-and-drop files or folders — directly into dataset creation or the dataset wizard, anywhere in the app
- Scrollbar in file list within the import wizard
- Enhance the detailed view
- Preview should allow viewing all / test / train partitions
- Managing dataset versioning, hashing, and update history

### Caching

- Initial loading and refresh should store quantiles, min/max, and summary statistics for future data visualization
- Cache dataset on the page (currently reloads every time)
- Cache frequently used charts (Y histogram, spectra with quantiles, train/test/folds)
- Test/train split not preserved after wizard — no test data available in Playground

### Bugs

- Default dataset name should use folder name
- Signal type should be auto-detected
- NA handling should offer a "keep NA" option
- "Skip rows" option is useless — remove or rethink
- Task type should move from parsing options to the target step
- Preview fails with row count mismatch: `X(0) Y(48)`
- Parsing options: initial state differs from auto-detect state — ensure auto-detect works for all settings
- Activating per-file overrides should expand the section and support auto-detect (if not already automatic)
- Auto-detection should run per-file and globally if files are compatible
- After parsing, display CSV shapes
- Task type as parsing option: auto-detect gives a pre-config that can be reset or re-run
- Aggregation settings without metadata should suggest target columns as aggregation key; method should be explicit (default scoring per sample) and depend on task type; remove "exclude outliers"
- Load preview fails with all datasets
- Targets and sources views should be switchable
- At preview, validate the dataset and cache the preview as an "ID card" — recalculate only on manual refresh

---

## Runs / Results

- Design the role of Runs vs Results and define the focus of each page

---

## Settings

- Add Chinese language
- "Remove animation" toggle does not work (actually makes it worse)
- Reduce ping frequency to the backend

### Update / Package

- Ensure robustness of the update mechanism
- Allow library reinstall from advanced settings (GPU/CPU version selection)
- Display installation errors clearly

---

## Pipeline Builder

### Refactoring

- Refactor components — significant redundancy across renderers
- Review parameter panels — many duplicate elements and unnecessary divs

### Features

- Extend generators to cover all existing nirs4all generators; add advanced validation
- Fix menu item overlap (except charts) — reduce item width
- Evaluate whether a sequential operator (equivalent of `[` `]` in nirs4all) is still needed
- Move "best model training" from finetuning into a separate "Training" tab
- Improve drop zone at the last position of nested lists
- Relocate the seed setting — should not be in the settings panel

---

## Pipelines

- Show saved pipelines vs presets in the pipeline list
- Review layout
- Add documentation and links to ReadTheDocs for each step
- Pipeline diagram preview when a dataset is linked; allow direct run creation from linked dataset; validate data shape on run or diagram
- Review seed handling

---

## Playground

### Features

- All views open by default
- Restore maximize/minimize for view panels
- Default reference selection should be "raw" with a dropdown in the menu bar to choose another step
- Save/load configuration (pipeline, views, options) — just a name and a list for now
- Finish/clean/fix the global export feature
- Add export to Pipeline Editor (and vice-versa) / import-from or export-to
- Add different reset levels: dataset, pipeline, views, view parameters

### Interactions

- Step labels inverted: affects preprocessed instead of original — rename step, change reference
- Single click selects one sample; click-drag selects an area (both enabled by default). Non-rectangular area selection as an option only
- Outlier detection and display
- Image export: popup with properties (extension, title, filename, etc.)

### Performance

- Desktop mode is very slow
- Ensure caching on transformations and data visualization works (not working in desktop mode)
- Dataset reloads on every page visit — should be cached
- Global sample filter (quartiles, std, min/max, all) and local filter for spectra and PCA

### Bugs

- Text in chart components is selectable — annoying when drawing; make unselectable
- First split in pipeline should generate test set, not fold — verify
- Spurious "one splitter only allowed" warning when opening a view — likely caused by a default splitter; remove it
- Verify coloration and warnings on classification tasks
- Metadata column coloration is bugged for some columns

### Folds View

- Hover tooltip
- Transform dropdown into checkable icons
- Bug on some metadata columns
- On color "partition", validation/test colors inconsistent with other charts

### Spectra View

- Selected samples should render on top; same for test and hovered samples
- cm-1 mode: WebGL and canvas are mirrored
- Review right-click menu — or use right-click for panning, left-click for selection
- Settings panel is unused — remove or update
- 3D grid option and quality should match the canvas renderer
- "Keep color" option in selected color mode
- Deactivate tooltip during panning and click
- Add colormap option for quantile drawing
- Some WebGL views lack zoom/pan controls

### PCA View

- Toggle between reference / final / both
- 3D: hidden points behind are not selected
- Verify hover popup consistency between canvas, regl, and WebGL — consider removing regl
- 3D: "show grid" option is useless
- Canvas rotation and selection controls should match WebGL
- Add skewness and kurtosis as metrics for PCA/Embedding

### Diff View

- Global filters (e.g., "selected only") do not update the view
- "Repetition variance" — clarify what it does
- Linear/log toggle: either remove or convert to radio button
- Line to display overall difference across all samples
- "Select quantile" option for outlier selection
- Click on message (e.g., "10 samples with high variability") to select those samples
- Display lines at 2-sigma and 3-sigma

### Target Histogram

- Replace bin count dropdown with checkable icons
- Allow target selection when multiple targets exist

---

## API

- Review functions that should be moved to the nirs4all library (e.g., UMAP)
