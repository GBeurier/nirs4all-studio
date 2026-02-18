# Export Playground Steps to Pipeline Editor

After finding a good preprocessing sequence in the Playground, you can export those steps directly to the Pipeline Editor. This saves you from manually recreating each step and ensures the exact same parameters are carried over.

## Prerequisites

- You have added one or more preprocessing steps in the Playground (see {doc}`playground-basics`).

---

## Steps

1. **Open the Playground.** Click **Playground** in the left sidebar. Make sure you have at least one preprocessing step configured.

2. **Verify your steps.** Review the list of preprocessing steps shown below the chart. Confirm that the order and parameters are what you want in your final pipeline.

   :::{tip}
   Take a final look at the spectra chart and projections before exporting. Once in the Pipeline Editor, you will not have the same real-time visual feedback until you run an experiment.
   :::

3. **Click Export to Pipeline.** Click the **Export to Pipeline** button in the Playground toolbar. A dialog opens with two options:

   - **Create new pipeline** -- creates a fresh pipeline in the Pipeline Editor containing only the exported preprocessing steps.
   - **Append to existing pipeline** -- adds the steps to an existing saved pipeline, inserting them before the splitter and model steps.

4. **Choose an option and confirm.**

   - If you select **Create new pipeline**, enter a name for the new pipeline (e.g., "SNV + SG from Playground") and click **Create**.
   - If you select **Append to existing pipeline**, choose a pipeline from the dropdown list and click **Append**.

5. **Open the Pipeline Editor.** After exporting, click the **Open in Editor** button that appears in the confirmation message, or navigate to **Pipeline Editor** in the sidebar. Your exported steps appear in the pipeline tree.

6. **Complete the pipeline.** The exported steps cover preprocessing only. You still need to add:

   - A **splitter** (e.g., KFold, Kennard-Stone) for cross-validation.
   - A **model** (e.g., PLSRegression, Random Forest) for training.

   Add these steps in the Pipeline Editor to create a complete, runnable pipeline.

:::{note}
The export carries over the exact parameter values from the Playground. If you set Savitzky-Golay to window length 11 and polynomial order 2, those same values appear in the exported step.
:::

:::{important}
If you are in comparison mode with multiple panels, only the **active panel** (the one with the highlighted border) is exported. Make sure the panel with your preferred steps is selected before clicking Export.
:::

---

## What's Next

- {doc}`../pipelines/create-pipeline` -- learn more about building pipelines in the editor.
- {doc}`../experiments/launch-experiment` -- run your newly created pipeline on a dataset.
- {doc}`playground-basics` -- return to the Playground to try more combinations.
