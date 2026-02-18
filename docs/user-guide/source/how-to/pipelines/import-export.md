# Import and Export Pipelines

Pipelines in nirs4all Studio can be exported as JSON files and imported back. This lets you share pipeline configurations with colleagues, back up your work, or transfer pipelines between workspaces or machines.

## Prerequisites

- You have nirs4all Studio open with a workspace selected.
- For exporting: you have at least one saved pipeline.
- For importing: you have a pipeline JSON file (`.json`).

## Steps

### Export a pipeline

1. **Open the pipeline you want to export.** Go to **Pipelines** in the sidebar and click on a pipeline to open it in the Pipeline Editor. Alternatively, if you are already in the Pipeline Editor with a saved pipeline, you can export directly from there.

2. **Open the export menu.** In the Pipeline Editor toolbar, click the **menu button** (the three-dot icon or the **...** button).

3. **Select Export as JSON.** Click **Export as JSON** from the dropdown menu.

4. **Choose a save location.** A file save dialog appears. Navigate to the folder where you want to save the file. The default filename is the pipeline name with a `.json` extension (e.g., `SNV + PLS Regression.json`).

5. **Save.** Click **Save**. The pipeline is exported as a JSON file.

   ```{figure} /_images/how-to/pipelines/export-json.png
   :alt: Export menu showing the Export as JSON option
   :width: 90%
   :class: screenshot

   The Export as JSON option in the Pipeline Editor toolbar menu.
   ```

:::{tip}
The exported JSON file contains the complete pipeline definition: all steps, their parameters, generators, sweeps, branches, and merge strategies. It does not include trained model weights -- only the pipeline configuration. To export a trained model, see the model export feature on the Results page.
:::

### What the JSON file looks like

The exported JSON is a structured representation of your pipeline. Here is a simplified example:

```json
{
  "name": "SNV + PLS Regression",
  "version": "1.0",
  "steps": [
    {
      "type": "preprocessing",
      "name": "SNV",
      "params": {}
    },
    {
      "type": "splitter",
      "name": "KennardStone",
      "params": {
        "test_size": 0.2
      }
    },
    {
      "type": "model",
      "name": "PLSRegression",
      "params": {
        "n_components": 10
      }
    }
  ]
}
```

Generators, parameter sweeps, and branches are also included in the JSON structure when present.

### Import a pipeline

6. **Go to the Pipelines page.** Click **Pipelines** in the sidebar.

7. **Open the import dialog.** Click the **Import** button in the toolbar at the top of the page (look for the upload icon or a button labeled **Import**).

8. **Select the JSON file.** A file browser dialog opens. Navigate to the `.json` file you want to import and select it. Click **Open**.

9. **Review the imported pipeline.** A preview dialog shows:
   - The pipeline name (from the JSON file).
   - The number of steps.
   - A brief summary of the pipeline structure.

   You can edit the name if a pipeline with the same name already exists in your library.

10. **Confirm the import.** Click **Import**. The pipeline is added to your library and appears on the Pipelines page.

11. **Open and verify.** Click on the newly imported pipeline to open it in the Pipeline Editor. Verify that all steps, parameters, and generators are correct.

:::{note}
If the JSON file references step types that are not available in your installation (for example, a neural network model when deep learning backends are not installed), the import will still succeed but those steps will be marked with a warning. You can replace them with available alternatives.
:::

### Share a pipeline with a colleague

To share a pipeline with someone else:

1. **Export** the pipeline as JSON (steps 1-5 above).
2. **Send** the `.json` file via email, shared drive, or any file transfer method.
3. The recipient **imports** the JSON file in their nirs4all Studio (steps 6-11 above).

The imported pipeline will have the same steps and parameters. It is independent of the original -- changes made by either person do not affect the other.

:::{warning}
Pipeline JSON files do not include dataset-specific information. The imported pipeline works with any compatible dataset. However, parameter values (like the number of PLS components) may need adjustment for different datasets.
:::

### Export from the Pipelines page (alternative)

You can also export without opening the Pipeline Editor:

1. On the **Pipelines** page, right-click the pipeline you want to export.
2. Select **Export as JSON** from the context menu.
3. Choose a save location and save.

## What's Next

- {doc}`manage-library` -- organize your imported and exported pipelines.
- {doc}`create-pipeline` -- build a new pipeline from scratch.
- {doc}`use-preset` -- start from a built-in preset instead of importing.
