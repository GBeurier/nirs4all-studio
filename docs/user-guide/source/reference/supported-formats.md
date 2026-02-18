# Supported File Formats

nirs4all Studio can import spectral data from a variety of file formats commonly used in NIRS and scientific computing.

## Format overview

| Format | Extensions | Description |
|--------|-----------|-------------|
| CSV | `.csv` | Comma-separated values. The most widely supported format. |
| Excel | `.xlsx`, `.xls` | Microsoft Excel spreadsheets. Both modern and legacy formats. |
| Parquet | `.parquet` | Columnar storage format, efficient for large datasets. |
| MATLAB | `.mat` | MATLAB data files (v5 and later). |
| NumPy | `.npy`, `.npz` | NumPy array files. `.npz` may contain multiple arrays. |
| HDF5 | `.h5`, `.hdf5` | Hierarchical Data Format, used for large scientific datasets. |

## Spectral data layout

Regardless of file format, nirs4all Studio expects your data to follow this general layout:

- **Rows** represent individual samples (one spectrum per row).
- **Columns** represent features (one column per wavelength or measurement point).
- **Target values** are in a separate column (or separate file) and contain the property you want to predict.
- **Metadata columns** (optional) contain extra information such as sample ID, origin, or collection date.

```
| sample_id | wavelength_1 | wavelength_2 | ... | wavelength_n | protein |
|-----------|-------------|-------------|-----|-------------|---------|
| S001      | 0.452       | 0.448       | ... | 0.312       | 12.3    |
| S002      | 0.461       | 0.455       | ... | 0.320       | 11.8    |
| ...       | ...         | ...         | ... | ...         | ...     |
```

```{tip}
Column headers for wavelengths can be numeric values (like `1100`, `1102`, `1104`) and nirs4all will automatically detect them as wavelength columns. Non-numeric column names are treated as metadata or target candidates.
```

## Format-specific notes

### CSV files

- Standard comma-separated files with a header row.
- Semicolons and tabs are also accepted as delimiters (auto-detected).
- UTF-8 encoding is recommended.
- The import wizard lets you specify which columns are wavelengths, which is the target, and which are metadata.

### Excel files

- The first sheet is read by default; you can select a different sheet during import.
- Merged cells and complex formatting should be avoided -- use a simple tabular layout.
- Both `.xlsx` (modern) and `.xls` (legacy) formats are supported.

### Parquet files

- A high-performance columnar format used in data engineering.
- Excellent for very large datasets: fast to load and compact on disk.
- Column names and types are preserved automatically.

### MATLAB files

- Supports `.mat` files saved in MATLAB v5 format and later.
- Variables inside the file are listed during import so you can select which arrays to use for spectra and targets.

### NumPy files

- `.npy` files contain a single array; `.npz` files contain multiple named arrays.
- For `.npz` files, you select which array is the spectra and which is the target during import.
- Wavelength information is not embedded in NumPy files, so you may need to provide it separately or let nirs4all use index-based wavelengths.

### HDF5 files

- Hierarchical files that can contain multiple datasets organized in groups.
- The import wizard lets you browse the file structure and select the correct datasets.
- Commonly used in large-scale spectroscopy projects and instrument software exports.

## Drag-and-drop import

You can import files by dragging them directly onto the Datasets page. nirs4all Studio will detect the file format automatically and open the import wizard to guide you through the configuration.

```{seealso}
For step-by-step import instructions, see the How-To guides:
- {doc}`/how-to/datasets/import-csv`
- {doc}`/how-to/datasets/import-excel`
- {doc}`/how-to/datasets/import-matlab`
```
