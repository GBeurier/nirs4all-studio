# Known Issues

This page lists known limitations and workarounds for the current version of nirs4all Studio.

---

## General

### Large datasets may slow down the interface
Very large datasets (over 50,000 samples or 10,000 features) can cause slower rendering in the spectral chart and data tables.

**Workaround**: Use a subset of your data for initial exploration. The application handles large datasets during model training, but interactive visualizations perform best with moderate-sized data.

### Browser compatibility (web mode)
When running in web mode, nirs4all Studio works best in modern browsers: Chrome 90+, Firefox 90+, Edge 90+, or Safari 15+. Older browsers may not support all features.

**Workaround**: Use the desktop app for the best experience, or update your browser to the latest version.

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

### First launch on macOS
On macOS, the first launch may trigger a security warning because the app is not signed with an Apple Developer certificate.

**Workaround**: Right-click the app and select "Open" to bypass the warning. You only need to do this once.

### Windows antivirus false positives
Some Windows antivirus software may flag the bundled Python backend as suspicious.

**Workaround**: Add the nirs4all Studio installation directory to your antivirus exclusion list.

---

:::{note}
If you encounter an issue not listed here, please report it on the [GitHub Issues page](https://github.com/gbeurier/nirs4all/issues).
:::
