# First Launch

When you open nirs4all Studio for the first time, the application starts with no workspace configured. Before you can import datasets or run experiments, you need to create or link a workspace.

This page walks you through that process.

## What Is a Workspace?

A **workspace** is a folder on your computer where nirs4all Studio stores everything related to your analysis work:

- **Datasets** you have imported
- **Pipelines** you have built
- **Trained models** and their artifacts
- **Experiment results**, scores, and predictions
- **Exported files** (models, reports)

Inside the workspace folder, you will find:

| Item | Purpose |
|---|---|
| `store.duckdb` | A database file that holds metadata for all your datasets, pipelines, runs, and results |
| `artifacts/` | Trained models, serialized objects, and other binary files |
| `exports/` | Exported models and prediction files |

:::{tip}
Think of a workspace like a project folder. If you work on different projects (for example, food quality analysis and pharmaceutical testing), you can create a separate workspace for each one.
:::

## Creating Your First Workspace

To create a new workspace:

1. Open the **Settings** page by clicking **Settings** at the bottom of the sidebar.
2. Go to the **Workspace** tab.
3. In the **Create New Workspace** section, enter a name for your workspace (for example, "My First Workspace").
4. Choose a location on your computer where the workspace folder will be created. Click **Browse** to pick a directory.
5. Click **Create Workspace**.

```{figure} /_images/getting-started/gs-create-workspace.png
:alt: Creating a new workspace in Settings
:width: 80%

The Workspace tab in Settings, showing the Create New Workspace form.
```

The application will create the workspace folder with the necessary structure and switch to it automatically. You are now ready to start importing data and building pipelines.

:::{note}
The workspace folder is created inside the location you chose. For example, if you pick `C:\Users\Jane\Documents` and name your workspace "NIRS Project", the workspace will be at `C:\Users\Jane\Documents\NIRS Project`.
:::

## Linking an Existing Workspace

If you already have a workspace folder (for example, from a colleague or a previous installation), you can link it instead of creating a new one:

1. Go to **Settings** > **Workspace** tab.
2. In the **Current Workspace** section, click **Select Workspace**.
3. Browse to the existing workspace folder and select it.
4. The application will detect the workspace structure and connect to it.

```{figure} /_images/getting-started/gs-link-workspace.png
:alt: Linking an existing workspace
:width: 80%

Selecting an existing workspace folder to link to the application.
```

:::{warning}
Make sure you select a folder that was created by nirs4all Studio (it should contain a `store.duckdb` file). Selecting a regular folder will not work.
:::

## Switching Between Workspaces

You can have multiple workspaces and switch between them at any time. The **Recent Workspaces** list in the Workspace tab shows all the workspaces you have used before.

To switch to a different workspace, click on it in the list. The application will reload with the data from the selected workspace.

```{figure} /_images/getting-started/gs-recent-workspaces.png
:alt: Recent workspaces list
:width: 80%

The Recent Workspaces section shows previously used workspaces for quick switching.
```

:::{tip}
Use separate workspaces to keep different projects organized. Each workspace is completely independent -- datasets, pipelines, and results in one workspace do not appear in another.
:::

## Next Steps

Now that your workspace is ready, take a moment to learn the application layout in the {doc}`interface-tour`, or jump straight to the {doc}`quickstart` to run your first experiment.
