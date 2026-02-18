# Workspaces

A **workspace** is a folder on your computer that stores everything related to a set of NIRS analyses. Think of it as a project folder that nirs4all Studio uses to keep your data, models, and results organized.

## What is inside a workspace?

Every workspace folder contains three things:

| Item | Description |
|------|-------------|
| `store.duckdb` | A local database file that holds all your runs, results, metrics, pipeline configurations, and dataset references. |
| `artifacts/` | A folder containing trained models, intermediate files, and other binary data produced during experiments. |
| `exports/` | A folder where exported models (`.n4a` bundles) and prediction files are saved. |

```{admonition} You never need to open these files manually
nirs4all Studio manages the workspace contents automatically. You interact with everything through the application interface.
```

## App settings vs. workspace data

nirs4all Studio stores two kinds of information in separate locations:

**App settings** (stored in `~/.nirs4all-webapp/`)
: Your personal preferences that apply across all workspaces: theme choice, display density, language, the list of linked workspaces, and favorite items.

**Workspace data** (stored in the workspace folder you choose)
: All analysis data: datasets, pipelines, runs, results, predictions, trained models, and exports. This data belongs to the specific workspace.

This separation means you can share a workspace folder with a colleague without sharing your personal preferences, and your settings follow you even if you switch between workspaces.

## Working with multiple workspaces

You can create as many workspaces as you need. Common reasons to use separate workspaces:

- **Different projects** -- Keep wheat protein analysis separate from soil carbon analysis.
- **Different instruments** -- One workspace per spectrometer to avoid mixing data.
- **Experimentation** -- Use a test workspace when trying new approaches, keeping your production workspace clean.

### Creating a workspace

1. Open **Settings** and go to the **Workspaces** tab.
2. Click **Create New**.
3. Choose a folder location and give the workspace a name.
4. The new workspace is automatically set as your active workspace.

### Linking an existing workspace

If you already have a workspace folder (perhaps shared by a colleague or created on another machine):

1. Open **Settings** and go to the **Workspaces** tab.
2. Click **Link Workspace**.
3. Navigate to the folder containing the `store.duckdb` file.
4. The workspace appears in your workspace list.

### Switching workspaces

When you switch your active workspace, the entire application context changes:

- The Datasets page shows datasets from the new workspace.
- The History page shows runs from the new workspace.
- Results, predictions, and pipelines all come from the new workspace.

```{tip}
You can quickly switch workspaces from the **Workspaces** tab in Settings. The active workspace is highlighted with a badge.
```

## Workspace statistics

The Workspaces tab in Settings displays statistics about your active workspace:

- Number of runs completed
- Number of datasets referenced
- Number of exported models
- Database size on disk

This helps you understand the scope of your project and monitor disk usage.

## Backing up a workspace

Since a workspace is simply a folder, you can back it up by copying the entire folder to another location, an external drive, or cloud storage. All data -- the database, models, and exports -- travels with the folder.

```{important}
Make sure nirs4all Studio is not actively running an experiment when you copy the workspace folder. Closing the application or waiting for experiments to finish ensures the database file is not being written to.
```
