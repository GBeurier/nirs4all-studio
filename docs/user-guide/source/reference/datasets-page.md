# Datasets Page

The Datasets page is the central hub for managing spectral datasets in your workspace. It lists all linked datasets, provides import tools, and supports organizing datasets into groups.

```{figure} ../_images/datasets/ds-page-overview.png
:alt: Datasets page overview
:width: 100%

The Datasets page showing dataset cards, statistics bar, and search/filter controls.
```

---

## Page layout

The page is organized from top to bottom:

1. **Header** -- Title, subtitle, and action buttons.
2. **Workspace bar** -- Shows the active workspace path with a **Change** button to switch workspaces via Settings.
3. **Statistics cards** -- Four summary cards displayed in a row.
4. **Search and filter bar** -- Search input, group filter, sort controls, and refresh button.
5. **Dataset list** -- Scrollable list of dataset cards. Clicking a card opens a **Quick View** panel on the right side.

---

## Statistics cards

| Card | Description |
|------|-------------|
| **Total Datasets** | Number of datasets linked in the active workspace. |
| **Total Samples** | Sum of all sample counts across every dataset. |
| **Features** | Range of feature counts (min--max) across datasets, or a single number if all datasets share the same count. |
| **Groups** | Number of dataset groups defined in the workspace. |

---

## Header actions

| Button | Description |
|--------|-------------|
| **Groups** | Opens the Groups management modal to create, rename, delete groups, and assign datasets. |
| **Generate Synthetic** | *(Developer Mode only)* Opens the synthetic data generator dialog. |
| **Add Dataset** | Opens the Dataset Import Wizard to link a new dataset from file. |

---

## Search, filter, and sort

| Control | Description |
|---------|-------------|
| **Search** | Text input that filters datasets by name, file path, or group name. |
| **Group filter** | Dropdown that appears when groups exist. Filters the list to show only datasets belonging to the selected group, or **All Datasets**. |
| **Sort field** | Dropdown to sort by **Name**, **Date Added**, **Samples**, or **Group**. Sort preference is persisted in local storage. |
| **Sort direction** | Toggle button to switch between ascending and descending order. |
| **Refresh** | Re-reads all dataset metadata from disk and reloads the workspace. |

---

## Dataset cards

Each dataset is displayed as a card showing:

| Field | Description |
|-------|-------------|
| **Name** | Display name of the dataset. |
| **Path** | File system path to the source data. |
| **Samples** | Number of samples (rows) in the dataset. |
| **Features** | Number of spectral features (columns). |
| **Signal type** | Detected signal type (e.g., NIR, MIR). |
| **Group badges** | Colored badges for each group the dataset belongs to. |
| **Best score** | If experiment results exist, shows the best model score with metric name and model type. A final (refit) score is distinguished from a CV-only score. |

Clicking a card selects it and opens the **Quick View** panel on the right. The Quick View panel shows a compact summary and an **Edit** button.

---

## Context menu actions

Right-clicking a dataset card (or using the card's action menu) provides:

| Action | Description |
|--------|-------------|
| **View Details** | Navigates to the {doc}`dataset-detail-page`. |
| **Edit** | Opens the edit panel to modify dataset configuration (name, target column, metadata columns, parsing options). |
| **Refresh** | Reloads metadata for this specific dataset from its source file. |
| **Assign Group** | Submenu to add or remove the dataset from groups. Selecting a group toggles membership. Selecting **No Group** removes from all groups. |
| **Delete** | Unlinks the dataset from the workspace (does not delete the source file). Requires confirmation. |

---

## Drag-and-drop import

You can import datasets by dragging files or folders directly onto the Datasets page. A drop-zone overlay appears showing the detected content type and item count.

- **Single file** -- Opens the Import Wizard with the file pre-selected.
- **Single folder** -- Runs auto-detection on the folder contents. If a standard dataset structure is found, opens the Wizard with pre-filled settings. Otherwise, offers a **Batch Scan** dialog.
- **Multiple folders** -- Computes the common parent directory and opens the Batch Scan dialog.

:::{tip}
Supported formats for drag-and-drop: CSV, Excel (`.xlsx`, `.xls`), Parquet, MATLAB (`.mat`), NumPy (`.npy`, `.npz`), and HDF5.
:::

---

## Groups management

The **Groups** modal (opened via the header button) allows:

- **Create** a new group with a custom name.
- **Rename** an existing group.
- **Delete** a group (does not affect the datasets themselves).
- **Assign/remove** datasets to and from groups.

A single dataset can belong to multiple groups simultaneously.

:::{seealso}
- {doc}`dataset-detail-page` -- Detailed view of a single dataset with spectra visualization
- {doc}`supported-formats` -- Complete list of supported file formats
:::
