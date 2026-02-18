# Create a Pipeline from Scratch

This guide walks you through building a new analysis pipeline from an empty canvas using the Pipeline Editor.

## Prerequisites

- You have nirs4all Studio open and a workspace selected.

## The Pipeline Editor Layout

The Pipeline Editor has three main panels:

- **Left panel -- Step Palette**: a searchable catalog of all available steps, organized by category.
- **Center panel -- Pipeline Tree**: the visual representation of your pipeline, displayed as a vertical tree of steps.
- **Right panel -- Step Configuration**: the parameter editor for the currently selected step.

## Steps

1. **Open the Pipeline Editor.** Click **Pipeline Editor** in the left sidebar. An empty pipeline tree appears in the center panel.

   ```{figure} /_images/how-to/pipelines/editor-empty.png
   :alt: Empty Pipeline Editor with three panels
   :width: 90%
   :class: screenshot

   The Pipeline Editor with an empty pipeline. The Step Palette is on the left, the pipeline tree in the center, and the configuration panel on the right.
   ```

2. **Browse the Step Palette.** In the left panel, steps are grouped into categories:

   - **Preprocessing** -- scatter correction, smoothing, derivatives, baseline, scaling
   - **Target Processing** -- target variable scaling and transformation
   - **Splitting** -- cross-validation strategies
   - **Models** -- regression and classification algorithms
   - **Filters** -- sample filtering and outlier removal
   - **Augmentation** -- training-time data augmentation
   - **Flow Control** -- branching, merging, and generators
   - **Utility** -- visualization and documentation

   Click a category header to expand or collapse it. Use the search box at the top to filter steps by name.

3. **Add your first step.** You have two options:

   - **Drag and drop**: click and hold a step in the palette, then drag it onto the pipeline tree. A drop indicator shows where the step will be placed.
   - **Click the + button**: click the **+** button that appears between steps (or at the top of an empty tree) and select a step from the popup menu.

   The step appears as a node in the pipeline tree.

4. **Configure the step.** Click on the newly added step in the pipeline tree. The right panel displays its parameters. Adjust values as needed. Changes are applied immediately.

   ```{figure} /_images/how-to/pipelines/step-config-panel.png
   :alt: Step configuration panel showing parameters
   :width: 90%
   :class: screenshot

   Clicking a step in the tree reveals its parameters in the right panel.
   ```

5. **Build your pipeline by adding more steps.** A typical pipeline follows this order:

   1. **Preprocessing** (e.g., SNV, Savitzky-Golay) -- clean and prepare the spectra
   2. **Splitter** (e.g., KFold) -- define how to split data for cross-validation
   3. **Model** (e.g., PLSRegression) -- the algorithm that learns to predict

   Add steps one by one in this order. Each new step appears below the previous one in the tree.

6. **Reorder steps if needed.** Drag a step up or down within the tree to change its position. The order matters: steps execute from top to bottom.

7. **Save your pipeline.** Click the **Save** button in the toolbar at the top of the editor. Enter a descriptive name (e.g., "SNV + PLS 10 components") and confirm.

:::{tip}
You can right-click any step in the pipeline tree to access a context menu with options to duplicate, delete, or disable the step.
:::

## What's Next

- {doc}`add-preprocessing` -- learn about available preprocessing steps
- {doc}`add-model` -- choose the right model for your data
- {doc}`add-splitter` -- set up cross-validation
- {doc}`use-preset` -- start from a pre-built pipeline instead
