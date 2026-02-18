# Settings Page

The **Settings** page centralizes all application configuration. It is organized into four tabs: General, Workspaces, Data Defaults, and Advanced. Access it from the bottom of the sidebar.

```{figure} ../_images/settings/st-general.png
:alt: Settings page — General tab
:width: 100%

The Settings page showing the General tab with theme, density, zoom, and language options.
```

---

## General tab

The General tab controls the visual appearance and interaction preferences of the application.

### Theme

| Option | Description |
|--------|-------------|
| **Light** | Light background with dark text. Best for well-lit environments. |
| **Dark** | Dark background with light text. Reduces eye strain in low-light settings. |
| **System** | Follows the operating system's current theme setting. Switches automatically if the OS theme changes. |

### Display density

| Option | Description |
|--------|-------------|
| **Compact** | Reduced padding and smaller fonts. Shows more content on screen. Suited for experienced users or smaller displays. |
| **Comfortable** | Default spacing. Balanced readability and information density. |
| **Spacious** | Increased padding and larger touch targets. Ideal for presentations or touchscreen use. |

### Zoom

| Control | Description |
|---------|-------------|
| **Zoom slider** | Adjusts the global zoom level of the application interface. Range: 75% to 150%. Default: 100%. |

The zoom setting scales all UI elements proportionally, including text, icons, charts, and controls. It applies immediately without requiring a restart.

### Language

| Option | Description |
|--------|-------------|
| **English** | English interface. |
| **French** | French interface (Fran\u00e7ais). |
| **German** | German interface (Deutsch). |

Changing the language updates all labels, tooltips, and system messages. Some technical terms (e.g., model names, metric names) remain in English.

### Animations

| Control | Description |
|---------|-------------|
| **Animations toggle** | Enables or disables UI transition animations (page transitions, panel slides, chart animations). Disabling animations can improve perceived responsiveness on slower hardware. |

---

## Workspaces tab

The Workspaces tab manages the list of workspaces linked to the application. See {doc}`workspace-concept` for a full explanation of the workspace model.

### Workspace list

A table listing all linked workspaces:

| Column | Description |
|--------|-------------|
| **Name** | Display name of the workspace. |
| **Path** | Full filesystem path to the workspace folder. |
| **Active** | A badge indicating which workspace is currently active. Only one workspace is active at a time. |
| **Size** | Disk space used by the workspace database and artifacts. |

### Actions

| Action | Description |
|--------|-------------|
| **Link Workspace** | Opens a folder picker to link an existing workspace folder (one containing a `store.duckdb` file). |
| **Create New** | Opens a dialog to create a new, empty workspace at a chosen location. |
| **Switch** | Activate a different workspace. The entire application context (datasets, runs, results) switches to the selected workspace. |
| **Unlink** | Removes the workspace from the linked list. This does **not** delete the workspace folder or its data -- it only removes the reference from the application. |

:::{note}
Switching workspaces reloads all data views. Any in-progress experiment will continue running in the background, but the UI will show data from the newly active workspace.
:::

---

## Data Defaults tab

The Data Defaults tab sets default values for dataset import operations. These defaults pre-fill the import dialog, saving time when you regularly import data in the same format.

| Setting | Description | Options |
|---------|-------------|---------|
| **Delimiter** | Column separator for CSV files. | Comma, Semicolon, Tab, Space, Auto-detect |
| **Decimal separator** | Character used for decimal points. | Period (`.`), Comma (`,`) |
| **Signal type** | Default spectral signal interpretation. | Absorbance, Reflectance, Transmittance, Log(1/R) |
| **NA handling** | How missing values are treated during import. | Drop rows, Fill with mean, Fill with zero, Keep as NaN |
| **Header mode** | Whether the first row of the file contains column headers. | Auto-detect, First row is header, No header |

:::{tip}
If you always import CSV files from the same instrument software, set the defaults once here and the import dialog will require fewer adjustments each time.
:::

---

## Advanced tab

The Advanced tab provides backend diagnostics, system information, and developer options.

```{figure} ../_images/settings/st-advanced.png
:alt: Settings page — Advanced tab
:width: 100%

The Advanced tab showing backend status, system information, and developer mode toggle.
```

### Backend status

| Field | Description |
|-------|-------------|
| **Status indicator** | A colored dot showing whether the Python backend is running (green), starting (amber), or stopped (red). |
| **Backend URL** | The address and port where the FastAPI backend is serving (e.g., `http://localhost:8000`). |
| **Restart backend** | A button to restart the backend process without restarting the entire application. |

### System information

| Field | Description |
|-------|-------------|
| **Operating system** | Detected OS name and version. |
| **Node.js version** | Version of the Node.js runtime (relevant in desktop mode). |
| **Python version** | Version of the Python interpreter running the backend. |
| **nirs4all version** | Version of the nirs4all library installed in the backend environment. |

### GPU detection

| Field | Description |
|-------|-------------|
| **GPU available** | Whether a compatible GPU was detected for accelerated model training. |
| **GPU name** | The name of the detected GPU (e.g., "NVIDIA RTX 4090"). |
| **CUDA version** | The detected CUDA toolkit version, if applicable. |

:::{note}
GPU acceleration is used automatically by deep learning models (TensorFlow, PyTorch) when available. Traditional models (PLS, Random Forest, Ridge) run on CPU regardless of GPU availability.
:::

### Updates

| Control | Description |
|---------|-------------|
| **Check for updates** | Queries the update server for new versions of nirs4all Studio. Displays the current version, the latest available version, and a download link if an update is available. |
| **Auto-check** | When enabled, the application checks for updates automatically at startup. |

### Developer mode

| Control | Description |
|---------|-------------|
| **Developer mode toggle** | Enables advanced diagnostics and debugging features. When active: API request/response logs are visible in the UI, additional timing information appears on pages, and experimental features are unlocked. |

:::{tip}
Developer mode is intended for troubleshooting and advanced use. For normal operation, leave it disabled to keep the interface clean.
:::

:::{seealso}
- {doc}`workspace-concept` -- Detailed explanation of how workspaces store data.
- {doc}`interface/themes-density` -- More about themes, density, and zoom behavior.
- {doc}`interface/keyboard-shortcuts` -- Keyboard shortcuts for navigating Settings and other pages.
:::
