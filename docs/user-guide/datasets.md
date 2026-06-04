# Datasets

Datasets are linked globally in the app configuration and can be used from the
active workspace. The dataset screen lets you link files or folders, inspect
detected structure, group datasets, and refresh metadata after files change.

## Supported input formats

The dataset wizard recognizes these file formats:

| Format | Extensions |
| --- | --- |
| CSV | `.csv`, `.csv.gz`, `.csv.zip` |
| Excel | `.xlsx`, `.xls` |
| Parquet | `.parquet` |
| NumPy | `.npy`, `.npz` |
| MATLAB | `.mat` |

## Dataset roles

The loader maps files into roles:

| Role | Meaning |
| --- | --- |
| `X` | Spectral matrix or feature matrix. |
| `Y` | Targets or labels. |
| `metadata` | Sample metadata. |
| folds | Cross-validation fold assignments. |

Files can be assigned to train or test splits. Multi-source datasets can group
multiple X sources and link them through shared metadata or targets.

## Link a dataset

Open **Datasets** and use one of these flows:

- drag a folder or files into the page
- choose **Add dataset**
- use the dataset wizard to select files, map roles, configure parsing, choose
  targets, and preview the result

The wizard stores the dataset link and parsing configuration. It does not copy
large source files by default.

## Parsing options

For delimited files, configure:

- delimiter
- decimal separator
- header presence
- wavelength header unit
- signal type
- missing-value policy
- encoding
- rows to skip

Excel files can also choose a sheet.

## Targets and task type

Targets can be configured as:

- automatic
- regression
- binary classification
- multiclass classification

When a file contains multiple targets, choose the default target used by new
pipelines and runs. The analysis views can still expose alternate targets where
the backend provides them.

## Dataset refresh and integrity

Use refresh when source files change. Studio recalculates stored metadata such
as sample counts, feature counts, detected targets, status, and version state.

Common statuses:

| Status | Meaning |
| --- | --- |
| available | Files are reachable and the saved configuration can be loaded. |
| missing | One or more source files cannot be found. |
| loading | Studio is checking or loading the dataset. |
| error | The saved configuration could not be loaded. |

## Synthetic datasets

Developer mode exposes synthetic dataset generation. Generated datasets can be
auto-linked and exported in the standard nirs4all format.
