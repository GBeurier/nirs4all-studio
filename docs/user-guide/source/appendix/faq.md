# Frequently Asked Questions

## General

**What is nirs4all Studio?**
: nirs4all Studio is a desktop application for Near-Infrared Spectroscopy (NIRS) data analysis. It provides a visual interface for importing spectral data, building analysis pipelines, running experiments, and exploring results — without writing code. The separate nirs4all Web product runs client-side in the browser with WASM.

**Is nirs4all Studio free?**
: Yes. nirs4all Studio is open-source software released under the CeCILL-2.1 license.

**What operating systems are supported?**
: Consult the signed manifest of the release you intend to install. A platform is supported only when that release publishes and qualifies its matching artifact; source packaging configurations are not availability claims.

**Can I use nirs4all Studio without an internet connection?**
: Yes. Once installed, the application runs entirely on your local computer. An internet connection is only needed for downloading updates.

---

## Data

**What file formats can I import?**
: CSV, Excel (.xlsx, .xls), Parquet, MATLAB (.mat), NumPy (.npy, .npz), and HDF5. See {doc}`../reference/supported-formats` for details.

**My dataset is not detected during import. What should I do?**
: Check the following:
  - The file is not corrupted or open in another application.
  - For CSV files, verify the delimiter (comma, semicolon, or tab) matches the actual file format.
  - Spectral data should have samples as rows and wavelengths/features as columns.
  - Try the manual file mapping option instead of auto-detection.

**How large can my datasets be?**
: nirs4all Studio can handle datasets with thousands of samples and thousands of features. For very large datasets (over 100,000 samples), performance may be slower. Consider using a subset for initial exploration.

**Can I use data from different spectrometers?**
: Yes. You can import data from any source as long as it is in a supported format. The Transfer Analysis tool in the Lab can help you evaluate how similar datasets from different instruments are.

---

## Pipelines

**What is a pipeline?**
: A pipeline is a sequence of processing steps that transforms raw spectral data into predictions. It typically includes preprocessing (e.g., SNV, Savitzky-Golay), a cross-validation splitter, and a prediction model (e.g., PLS, Random Forest).

**How do I choose the right preprocessing method?**
: Use the Playground to visually compare different methods on your data. Common starting points are SNV (Standard Normal Variate) for scatter correction and Savitzky-Golay for smoothing or derivatives. See the tutorial {doc}`../tutorials/compare-preprocessing`.

**What does the variant count mean?**
: When you use generators (like `_or_` or `_range_`), the pipeline expands into multiple configurations. The variant count shows the total number of combinations that will be tested. For example, 3 preprocessing alternatives with 10 PLS components = 30 variants.

**My experiment is taking a very long time. Is that normal?**
: Execution time depends on dataset size, number of variants, number of folds, and model complexity. For large sweeps (hundreds of variants), consider reducing the search space. Check the Run Progress page for live timing information.

---

## Results

**What do the metrics mean?**
: - **RMSE** (Root Mean Square Error): Lower is better. Measures average prediction error in the same units as your target variable.
  - **R2** (R-squared): Higher is better (max 1.0). Measures how well the model explains the variance in the data.
  - **Accuracy**: For classification tasks. Higher is better (max 1.0 or 100%).

**How do I know if my model is good?**
: There is no universal threshold — it depends on your application. Compare models against each other, look at the scatter plot in the Inspector (points should cluster around the diagonal line), and check that residuals are evenly distributed around zero.

**Can I export my trained model?**
: Yes. After an experiment completes, you can export the best model as a `.n4a` bundle file. This file can be used later for batch predictions or shared with colleagues.

---

## Technical

**The control plane is not connecting. What should I do?**
: Go to Settings > Advanced and check the Backend Status indicator, which
  reports the packaged Rust sidecar. Restart Studio if it is disconnected and
  review the local diagnostic log if the problem repeats. Do not start
  `python main.py`: that source server is a contributor-only legacy diagnostic,
  not a product recovery path.

**How do I enable GPU acceleration?**
: Native Methods training uses the qualified CPU path. A bounded Python library/plugin may use acceleration only when its packaged capability manifest and preflight say so; Studio does not install GPU dependencies into its read-only runtime.

**Where are my files stored?**
: - **Workspace data**: In your workspace folder (wherever you created it). Contains `store.sqlite`, `artifacts/`, and `exports/`.
  - **App settings**: In the operating system's application-data directory reported by Studio diagnostics.
  - **Desktop app**: Installed in the standard application directory for your OS.

**How do I update nirs4all Studio?**
: Go to Settings > Advanced tab. Click "Check for Updates". If an update is available, follow the prompts to download and install it.
