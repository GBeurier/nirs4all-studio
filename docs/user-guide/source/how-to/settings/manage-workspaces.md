# Manage Workspaces

This guide shows you how to link, switch, and unlink workspaces in nirs4all Studio. A workspace is a folder on your computer that stores all your analysis data -- datasets, pipelines, runs, results, and exported models.

## Prerequisites

- nirs4all Studio is running.

## Steps

### Link a New Workspace

1. **Open the Settings page.** Click **Settings** in the bottom section of the sidebar navigation.

2. **Go to the Workspaces section.** The workspace management controls are displayed on the Settings page.

3. **Click "Link Workspace".** A folder browser dialog opens.

4. **Choose a folder.** Navigate to an existing workspace folder (one that contains a `store.duckdb` file), or select an empty folder to create a new workspace.

   - If the folder already contains workspace data, it will be linked as-is.
   - If the folder is empty, nirs4all Studio creates the required workspace structure automatically.

5. **Confirm the link.** The workspace appears in your workspace list, and it becomes the active workspace.

:::{tip}
Use descriptive folder names for your workspaces, such as `wheat-protein-2025` or `soil-carbon-siteA`. This makes it easy to identify them in the workspace list.
:::

---

### Switch Between Workspaces

1. **Open Settings** and locate the workspace list.

2. **Click the workspace you want to activate.** The active workspace is highlighted with a badge.

3. **Confirm the switch.** When you switch workspaces, the entire application context changes: the Datasets, Pipelines, Runs, and Results pages all show data from the newly selected workspace.

:::{important}
Switching workspaces does not delete or modify anything in the previous workspace. Your data remains intact and you can switch back at any time.
:::

---

### Unlink a Workspace

1. **Open Settings** and locate the workspace list.

2. **Click the unlink button** next to the workspace you want to remove from the list.

3. **Confirm the action.** The workspace is removed from your workspace list.

:::{note}
Unlinking a workspace only removes it from the nirs4all Studio list. The workspace folder and all its data remain untouched on your computer. You can re-link it at any time by following the "Link a New Workspace" steps above.
:::

---

## What Is Inside a Workspace?

Every workspace folder contains three items:

| Item | Purpose |
|------|---------|
| `store.duckdb` | A local database that holds all runs, results, metrics, pipeline configurations, and dataset references. |
| `artifacts/` | A folder containing trained models, intermediate files, and binary data produced during experiments. |
| `exports/` | A folder where exported models (`.n4a` bundles) and prediction CSV files are saved. |

You never need to open or modify these files manually. nirs4all Studio manages them through the application interface.

:::{warning}
Do not rename, move, or delete files inside a workspace folder while nirs4all Studio is running. This could corrupt the workspace database. If you need to relocate a workspace, close the application first, move the entire folder, then re-link it from Settings.
:::

## Backing Up a Workspace

Since a workspace is a regular folder, you can back it up by copying the entire folder to another location, an external drive, or cloud storage. Make sure no experiment is running when you copy the folder.

## What's Next

- {doc}`change-theme` -- Customize the application appearance.
- {doc}`/reference/workspace-concept` -- Learn more about the workspace architecture.
