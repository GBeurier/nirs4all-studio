# Known Issues

This page lists known limitations and workarounds for the current version of nirs4all Studio.

---

## General

### Large datasets may slow down the interface
Very large datasets (over 50,000 samples or 10,000 features) can cause slower rendering in the spectral chart and data tables.

**Workaround**: Use a subset of your data for initial exploration. The application handles large datasets during model training, but interactive visualizations perform best with moderate-sized data.

### Browser delivery is a separate product
nirs4all Studio has no current browser/FastAPI deployment mode. The separate
nirs4all Web application is client-side WASM and publishes its own browser
requirements.

**Workaround**: Use a qualified Studio desktop artifact, or use nirs4all Web
when its documented client-side capability set is sufficient.

---

## Data Import

### Excel files with merged cells
Excel files that contain merged cells or complex formatting may not import correctly.

**Workaround**: Save the data as a plain CSV file before importing.

### MATLAB v7.3 files
MATLAB files saved in v7.3 format (HDF5-based) may have limited support depending on the internal structure.

**Workaround**: Re-save the file in MATLAB v5 format using `save('filename.mat', '-v6')` in MATLAB.

---

## Pipeline Editor

### Very deep pipelines with many branches
Pipelines with more than 5 levels of nesting (branches within branches) may be difficult to navigate visually.

**Workaround**: Simplify complex pipelines by reducing branch nesting depth or breaking them into separate experiments.

### Generator variant count limits
Extremely large sweeps (10,000+ variants) are accepted by the editor but may take very long to execute or exhaust available memory.

**Workaround**: Use targeted sweeps. Start with coarse ranges and refine around promising values.

---

## Visualization

### WebGL chart rendering on some Linux systems
On some Linux systems with limited GPU drivers, the spectral chart may not render correctly.

**Workaround**: Use the desktop app (which bundles Chromium with consistent WebGL support) or update your GPU drivers.

### Dark theme chart colors
Some chart color palettes may have reduced contrast in dark theme.

**Workaround**: Switch to light theme for detailed visual analysis of charts.

---

## Desktop App

### Candidate platform availability
Local packaging configuration does not prove that a platform artifact is
published, signed, or qualified.

**Workaround**: Install only an artifact named by the matching signed release
manifest. Do not bypass operating-system signature checks or add broad antivirus
exclusions for an unqualified build.

---

:::{note}
If you encounter an issue not listed here, please report it on the [Studio GitHub Issues page](https://github.com/GBeurier/nirs4all-studio/issues).
:::
