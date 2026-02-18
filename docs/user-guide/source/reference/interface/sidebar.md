# Sidebar Navigation

The sidebar is the main navigation element on the left side of the application. It organizes all pages into three logical groups, plus a settings link at the bottom.

The sidebar can be collapsed to show only icons, giving you more screen space for your work. Click the collapse/expand toggle at the bottom of the sidebar to switch between modes.

## Navigation groups

### Prepare

The **Prepare** group contains pages for setting up your data and analysis pipelines.

| Page | Icon | Description |
|------|------|-------------|
| **Datasets** | Database | Browse, import, and manage your spectral datasets. |
| **Pipelines** | Git Fork | View and manage your pipeline library. |
| **Pipeline Editor** | Pencil | Build and edit analysis pipelines visually. |
| **New Experiment** | Play | Launch a new experiment by pairing datasets with pipelines. |

### Explore

The **Explore** group contains interactive tools for investigating your data and models.

| Page | Icon | Description |
|------|------|-------------|
| **Playground** | Ball | Apply preprocessing steps interactively and see the effect in real time. |
| **Inspector** | Search | Compare datasets, view distribution charts, and explore data quality. |
| **Lab** | Flask | Access advanced tools: Spectra Synthesis, Transfer Analysis, and Variable Importance (SHAP). |

### Results

The **Results** group contains pages for reviewing experiment outcomes.

| Page | Icon | Description |
|------|------|-------------|
| **History** | Play | View all past runs with their status, duration, and configuration. |
| **Results** | Trophy | Explore model performance grouped by dataset, with top chains highlighted. |
| **Predictions** | Table | Manage prediction results: view, filter, export, and delete. |

### Settings

The **Settings** link appears at the bottom of the sidebar, separated from the main groups. It opens the settings page where you can configure the application theme, workspaces, data defaults, and advanced options.

## Active page indicator

The currently active page is highlighted in the sidebar with a teal accent color and a vertical bar on the left edge. This helps you quickly identify where you are in the application.

## Collapsed mode

When the sidebar is collapsed:

- Only icons are visible, without text labels.
- Hovering over an icon shows a tooltip with the page name.
- Badge indicators (such as update notifications) appear as small dots on the icon.

```{tip}
The collapsed sidebar is especially useful on smaller screens or when working with the Pipeline Editor, where horizontal space is valuable.
```

## Lab sub-pages

The **Lab** page serves as a hub for three specialized tools. Navigating to Lab shows links to:

- **Spectra Synthesis** -- Generate synthetic spectral datasets.
- **Transfer Analysis** -- Compare datasets and assess model transferability.
- **Variable Importance (SHAP)** -- Explain model predictions and identify important wavelengths.

Each of these tools has its own dedicated page accessible from the Lab hub.
