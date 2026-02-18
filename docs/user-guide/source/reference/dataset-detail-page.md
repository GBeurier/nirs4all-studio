# Dataset Detail Page

The Dataset Detail page provides a comprehensive view of a single dataset. It is opened by navigating from the {doc}`datasets-page` (clicking **View Details** on a dataset card).

---

## Page header

The header area contains:

| Element | Description |
|---------|-------------|
| **Back link** | Returns to the Datasets page. |
| **Dataset icon** | File spreadsheet icon with primary accent background. |
| **Name** | The dataset display name (large, bold). |
| **Path** | Monospace text showing the full file system path to the source data. Truncated with a tooltip for long paths. |

### Header actions

| Button | Description |
|--------|-------------|
| **Edit** | Opens the dataset configuration panel to modify name, target column, metadata columns, and parsing settings. |
| **Export** | Exports the dataset data. |
| **Run Analysis** | Navigates to the New Experiment wizard with this dataset pre-selected. |

---

## Quick statistics

Four summary cards are displayed below the header:

| Card | Description |
|------|-------------|
| **Samples** | Total number of sample rows in the dataset. |
| **Features** | Number of spectral feature columns. |
| **Spectral Range** | Wavelength range in nm (min--max), derived from the column headers. Shown as `--` if wavelengths are not detected. |
| **Targets** | Number of target variables configured for this dataset. |

---

## Tabs

The page has four tabs: **Overview**, **Spectra**, **Targets**, and **Raw Data**.

### Overview tab

Displays dataset metadata and configuration details:

| Field | Description |
|-------|-------------|
| **Dataset name** | Editable display name. |
| **File source** | Original file path and format (CSV, Excel, MATLAB, etc.). |
| **Signal type** | Detected or configured signal type (NIR, MIR, Raman, UV-Vis, or unknown). |
| **Sample count** | Number of rows. |
| **Feature count** | Number of spectral columns. |
| **Wavelength range** | First and last wavelength values with unit. |
| **Target column(s)** | Name(s) of the configured target variable(s). |
| **Metadata columns** | List of non-spectral, non-target columns (sample ID, origin, etc.). |
| **Creation date** | When the dataset was linked to the workspace. |
| **Version / checksum** | Data integrity information. |

---

### Spectra tab

An interactive chart showing all spectra (or a preview subset) overlaid on a single plot.

| Feature | Description |
|---------|-------------|
| **X axis** | Wavelength (nm or index). |
| **Y axis** | Absorbance / reflectance / intensity value. |
| **Zoom** | Scroll to zoom in/out. Click and drag to select a rectangular zoom region. |
| **Pan** | Hold Shift and drag to pan the view. |
| **Hover** | Hovering over a line shows a tooltip with the sample index and value at that wavelength. |
| **Line selection** | Clicking a spectrum line highlights it and dims the others for easier inspection. |
| **Reset view** | Double-click to reset zoom and pan to the default view. |

:::{note}
For large datasets, the Spectra tab displays a preview of up to 100 samples. The full dataset can be explored in the Raw Data tab.
:::

---

### Targets tab

Visualizations and statistics for the target variable(s).

| Component | Description |
|-----------|-------------|
| **Histogram** | Distribution of target values with configurable bin count. |
| **Box plot** | Shows median, quartiles, whiskers, and outliers for each target. |
| **Statistics table** | Descriptive statistics including count, mean, std, min, Q1, median, Q3, max, skewness, and kurtosis. |

:::{tip}
Use the Targets tab to quickly check for outliers, skewed distributions, or data quality issues before running experiments.
:::

---

### Raw Data tab

A paginated, sortable data table showing the full dataset contents.

| Feature | Description |
|---------|-------------|
| **Columns** | All columns are displayed: metadata, spectral features, and target(s). Spectral columns show wavelength headers. |
| **Sorting** | Click a column header to sort ascending; click again for descending. |
| **Column search** | Filter visible columns by typing a column name. Useful when datasets have hundreds of wavelength columns. |
| **Pagination** | Navigate through rows with page controls at the bottom. Default page size depends on display density setting. |
| **Refresh** | Reload the data preview from the source file. |

---

## Error handling

If the dataset file is missing, corrupted, or cannot be loaded, the page shows an error state with:

- An error icon and message describing the issue.
- A **Go Back** button to return to the Datasets page.
- A **Refresh** button to retry loading.

:::{seealso}
- {doc}`datasets-page` -- Managing all datasets in the workspace
- {doc}`supported-formats` -- Details on supported file formats and data layout requirements
:::
