# Manage the Pipeline Library

The **Pipelines** page is your library for all pipeline configurations -- both built-in presets and pipelines you have created or imported. This guide covers how to browse, organize, and manage your pipeline collection.

## Prerequisites

- You have nirs4all Studio open with a workspace selected.

## Steps

### Browse pipelines

1. **Open the Pipelines page.** Click **Pipelines** in the sidebar. The library displays all pipelines as a list or grid of cards.

2. **Filter by category.** Use the filter tabs at the top of the page:

   | Tab | Shows |
   |---|---|
   | **All** | Every pipeline in the workspace |
   | **Presets** | Built-in pipeline templates provided by nirs4all |
   | **Custom** | Pipelines you have created or imported |
   | **Favorites** | Pipelines you have marked as favorites |

3. **Search.** Use the **search box** at the top to filter pipelines by name. Type part of the name (e.g., "PLS" or "SNV") and the list updates instantly.

   ```{figure} /_images/how-to/pipelines/library-overview.png
   :alt: Pipeline library with filter tabs and search box
   :width: 90%
   :class: screenshot

   The pipeline library with filter tabs, search, and pipeline cards.
   ```

4. **View pipeline details.** Each pipeline card shows:
   - **Name** -- the pipeline name.
   - **Steps summary** -- a compact view of the step sequence (e.g., "SNV --> KFold --> PLS").
   - **Variant count** -- how many variants the pipeline generates (if it uses generators).
   - **Last modified date**.
   - **Favorite star** -- whether the pipeline is favorited.

### Rename a pipeline

5. **Right-click** on the pipeline card and select **Rename** from the context menu. Alternatively, click the three-dot menu on the card and select **Rename**.

6. The name becomes an editable text field. Type the new name and press **Enter** to confirm.

:::{note}
Built-in presets cannot be renamed. If you want a customized version with a different name, duplicate the preset first (see below) and then rename the copy.
:::

### Duplicate a pipeline

7. **Right-click** on the pipeline card and select **Duplicate**.

8. A copy of the pipeline is created with the name `[Original Name] (copy)`. It appears in the library immediately.

9. You can rename the duplicate and edit its steps independently. The original pipeline is not affected.

:::{tip}
Duplicating is useful when you want to create variations of a pipeline. Duplicate a working pipeline, then modify the copy to test a different configuration.
:::

### Favorite a pipeline

10. Click the **star icon** on the pipeline card. The star fills in to indicate the pipeline is favorited.

11. Favorited pipelines appear in the **Favorites** filter tab for quick access.

12. Click the star again to remove from favorites.

Favorites are helpful when you have many pipelines and want quick access to the ones you use most often. Favorited pipelines also appear first in the pipeline selection step of the experiment wizard.

### Delete a pipeline

13. **Right-click** on the pipeline card and select **Delete**.

14. A confirmation dialog appears: *"Are you sure you want to delete [Pipeline Name]?"*

15. Click **Delete** to confirm, or **Cancel** to keep the pipeline.

:::{warning}
Deleting a pipeline is permanent. The pipeline is removed from your workspace. However, any experiments that previously used this pipeline still retain their results -- deleting the pipeline does not affect past experiment data.
:::

:::{note}
Built-in presets cannot be deleted. They are part of the application and are always available.
:::

### Sort pipelines

16. Click the **Sort** dropdown in the toolbar to change the sort order:

    | Sort option | Description |
    |---|---|
    | **Name (A-Z)** | Alphabetical order |
    | **Name (Z-A)** | Reverse alphabetical |
    | **Last Modified** | Most recently edited first |
    | **Date Created** | Newest first |
    | **Variant Count** | Pipelines with more variants first |

### Open a pipeline in the editor

17. **Click** on a pipeline card to open it in the Pipeline Editor. From there you can view, edit, or use it in an experiment.

18. Alternatively, **double-click** a pipeline card to open it directly.

## Pipeline Card Actions Summary

| Action | How to access |
|---|---|
| Open in editor | Click or double-click the card |
| Rename | Right-click > Rename |
| Duplicate | Right-click > Duplicate |
| Favorite / unfavorite | Click the star icon |
| Delete | Right-click > Delete |
| Export as JSON | Right-click > Export as JSON |
| Use in experiment | Right-click > Use in Experiment |

## What's Next

- {doc}`create-pipeline` -- create a new pipeline from scratch.
- {doc}`use-preset` -- start from a built-in preset.
- {doc}`import-export` -- import pipelines from JSON files or export them to share.
