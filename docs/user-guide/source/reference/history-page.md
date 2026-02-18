# History (Runs) Page

The History page lists all experiment runs in the active workspace. It provides an overview of past, running, and queued experiments with their status, timing, and key metrics.

```{figure} ../_images/results/res-history-overview.png
:alt: History page overview
:width: 100%

The History page showing run cards with status badges, durations, and summary statistics.
```

---

## Page layout

1. **Header** -- Title and a **New Experiment** button.
2. **Statistics bar** -- Summary counts for running, queued, completed, and failed runs, plus total pipeline runs.
3. **Project filter** -- Optional filter by project/workspace.
4. **Run list** -- Scrollable list of run cards, sorted by date (newest first).

---

## Statistics bar

| Stat | Description |
|------|-------------|
| **Running** | Number of runs currently executing (live-updating). |
| **Queued** | Number of runs waiting to start. |
| **Completed** | Number of successfully finished runs. |
| **Failed** | Number of runs that encountered errors. |
| **Total Pipelines** | Sum of all pipeline runs across all experiments. |

---

## Run cards

Each run is displayed as a card (or row) with the following information:

| Field | Description |
|-------|-------------|
| **Run name** | The experiment name as set in the wizard. |
| **Status badge** | Color-coded status: **Running** (blue pulse), **Queued** (gray), **Completed** (green), **Failed** (red), **Stopped** (amber). |
| **Created at** | Date and time the run was launched. |
| **Duration** | Wall-clock time from start to completion (or current elapsed time for running experiments). |
| **Datasets count** | Number of datasets included in the experiment. |
| **Pipeline runs count** | Total number of pipeline variant executions. |
| **Final models** | Number of final (refit) models produced. |
| **Total models trained** | Total number of models trained across all folds and variants. |
| **Total folds** | Total number of cross-validation folds executed. |
| **Artifact size** | Disk space used by saved models and artifacts. |

---

## Status badges

| Status | Color | Description |
|--------|-------|-------------|
| **Running** | Blue (animated) | Experiment is actively executing. Click to open the {doc}`run-progress-page`. |
| **Queued** | Gray | Experiment is waiting in the job queue. |
| **Completed** | Green | All pipeline variants finished successfully. |
| **Failed** | Red | One or more pipeline variants encountered errors. |
| **Stopped** | Amber | Experiment was manually cancelled before completion. |

---

## Run actions

Clicking a run card opens a **Detail Sheet** (slide-out panel) with expanded information. Actions available:

| Action | Description |
|--------|-------------|
| **View Progress** | *(Running/Queued only)* Opens the {doc}`run-progress-page` for live monitoring. |
| **View Results** | *(Completed/Stopped)* Navigates to the {doc}`results-page` filtered to this run's results. |
| **Dataset breakdown** | Shows per-dataset statistics: dataset name, chain count, best score, and metric. |
| **Re-run** | Creates a new experiment with the same configuration (datasets and pipeline). |

---

## Filtering

| Control | Description |
|---------|-------------|
| **Project filter** | Dropdown to filter runs by project. Projects correspond to workspace partitions if configured. |
| **Status filter** | *(Implicit)* The statistics bar badges act as quick filters -- clicking a status count filters the list to show only runs with that status. |

---

## Sorting

Runs are sorted by creation date (newest first) by default. Running and queued runs always appear at the top of the list, regardless of creation date, to ensure active experiments are immediately visible.

---

## Live updates

For running experiments, the History page periodically polls for status changes:

- Run status transitions (queued to running, running to completed/failed) are reflected automatically.
- Duration counters update in real time for active runs.
- The statistics bar counts update as runs complete or fail.

:::{note}
The History page polls every 10 seconds for active runs and every 30 seconds for the full enriched run list from the DuckDB store. For real-time granular progress, open the {doc}`run-progress-page` for a specific run.
:::

:::{seealso}
- {doc}`experiment-wizard` -- Creating new experiments
- {doc}`run-progress-page` -- Real-time monitoring of a single run
- {doc}`results-page` -- Detailed analysis of experiment results
:::
