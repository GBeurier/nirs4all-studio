# Experiment Wizard

The Experiment Wizard (New Experiment page) guides you through creating and launching an experiment. An experiment pairs one or more datasets with one or more pipelines, producing a set of runs.

```{figure} ../_images/experiments/exp-wizard-overview.png
:alt: Experiment Wizard overview
:width: 100%

The Experiment Wizard showing the four-step process with step indicator.
```

---

## Step indicator

A horizontal progress bar at the top of the wizard shows the four steps with icons:

| Step | Icon | Label |
|------|------|-------|
| 1 | Database | Select Datasets |
| 2 | Git Branch | Select Pipelines |
| 3 | Checkmark | Review |
| 4 | Play | Launch |

The current step is highlighted with the primary accent color. Completed steps show a checkmark. You can click a completed step to go back to it.

---

## Navigation

| Button | Description |
|--------|-------------|
| **Back** | Returns to the previous step. Disabled on step 1. |
| **Next** | Advances to the next step. Disabled until the current step's requirements are met (at least one selection). |

---

## Step 1 -- Select Datasets

Choose which datasets to include in the experiment.

| Element | Description |
|---------|-------------|
| **Dataset list** | Scrollable list of all datasets in the active workspace. Each row shows a checkbox, dataset name, sample count, and feature count. |
| **Search** | Text input to filter datasets by name. |
| **Select all / Deselect all** | Convenience controls at the top of the list. |
| **Selection count** | Badge showing the number of selected datasets. |

:::{note}
At least one dataset must be selected before you can proceed to step 2.
:::

---

## Step 2 -- Select Pipelines

Choose which pipelines to run against the selected datasets.

| Element | Description |
|---------|-------------|
| **Pipeline list** | Scrollable list of all saved pipelines. Each row shows a checkbox, pipeline name, step summary (as a chain of step names), and variant count. |
| **Search** | Text input to filter pipelines by name. |
| **Filter** | Dropdown to filter by **All**, **Favorites**, or **Presets**. |
| **Variant count** | Each pipeline row shows the number of variants it will generate. This helps estimate total computation. |
| **Favorite indicator** | Star icon on pipelines marked as favorites. |
| **Selection count** | Badge showing the number of selected pipelines. |

If the Pipeline Editor had an unsaved pipeline when navigating to the wizard, it may appear as an additional option labeled with its current name and a "dirty" indicator.

:::{note}
At least one pipeline must be selected before you can proceed to step 3.
:::

---

## Step 3 -- Review

Review the experiment configuration before launching.

| Field | Description |
|-------|-------------|
| **Experiment name** | Editable text input. A default name is generated from the selected datasets and pipelines, but you can customize it. |
| **Description** | Optional text area for notes about the experiment. |
| **Selected datasets** | Summary list of chosen datasets with sample counts. |
| **Selected pipelines** | Summary list of chosen pipelines with step summaries and variant counts. |
| **Total run count** | Calculated as: `datasets x pipeline variants`. Displayed prominently to help you estimate experiment duration. |

:::{tip}
If the total run count is very large, consider reducing the number of datasets or simplifying generator steps in your pipelines to keep experiment time manageable.
:::

---

## Step 4 -- Launch

Final confirmation before starting the experiment.

| Element | Description |
|---------|-------------|
| **Summary card** | Compact summary of the experiment: name, dataset count, pipeline count, total runs. |
| **Launch button** | Starts the experiment. Submits the configuration to the backend, which creates a run and begins execution. |
| **Spinner** | Shown briefly while the run is being created. |

After launching, you are automatically redirected to the {doc}`run-progress-page` to monitor execution in real time.

---

## Pre-selection from other pages

The wizard supports pre-selection via URL query parameters:

- Navigating from a dataset detail page pre-selects that dataset in step 1.
- Navigating from the Pipeline Editor's "Use in Experiment" button pre-selects that pipeline in step 2.

:::{seealso}
- {doc}`datasets-page` -- Managing datasets before running experiments
- {doc}`pipelines-page` -- Managing pipelines before running experiments
- {doc}`run-progress-page` -- Monitoring experiments after launch
:::
