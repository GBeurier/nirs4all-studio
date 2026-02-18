# Run Progress Page

The Run Progress page provides real-time monitoring of an experiment run. It is displayed automatically after launching an experiment from the {doc}`experiment-wizard`, and can also be accessed from the {doc}`history-page` for running experiments.

---

## Page layout

The page is organized into:

1. **Header** -- Run name, status badge, and action buttons.
2. **Progress section** -- Overall progress bar and timing information.
3. **Step status panel** -- Per-step breakdown of the pipeline execution.
4. **Metrics panel** -- Live fold scores and summary statistics.
5. **Log panel** -- Scrollable real-time log stream.

---

## Header

| Element | Description |
|---------|-------------|
| **Back link** | Returns to the History (Runs) page. |
| **Run name** | The experiment name as configured in the wizard. |
| **Status badge** | Current run status: **Queued**, **Running**, **Completed**, **Failed**, or **Stopped**. Color-coded (blue, green, red, amber). |
| **Stop button** | Sends a cancellation request to the backend. Visible only when the run status is Running or Queued. |

---

## Real-time updates via WebSocket

The page maintains a WebSocket connection to receive live updates from the backend. Messages include:

| Message type | Description |
|-------------|-------------|
| `JOB_PROGRESS` | Overall progress percentage and status message. |
| `JOB_LOG` | Log entry with level (info, warning, error) and optional context (fold, branch, variant). |
| `JOB_METRICS` | Metric values as they become available (e.g., per-fold scores). |
| `JOB_COMPLETED` | Run has finished successfully. Includes final result summary. |
| `JOB_FAILED` | Run has failed. Includes error message and traceback. |
| `FOLD_PROGRESS` | Current fold number and total folds. |
| `STEP_PROGRESS` | Current step name and progress within the refit phase. |
| `VARIANT_PROGRESS` | Current variant index, total variants, and variant description. |

If the WebSocket connection is lost, a **Reconnecting** indicator appears. The page attempts automatic reconnection.

---

## Progress section

| Element | Description |
|---------|-------------|
| **Overall progress bar** | Horizontal bar showing completion percentage (0--100%). |
| **Progress message** | Text description of the current operation (e.g., "Fitting fold 3/5 - Ridge"). |
| **Elapsed time** | Time since the run started, updated every second. |
| **Estimated remaining** | Estimated time to completion based on current progress rate. |

---

## Step status panel

Displays each pipeline step with its current execution state.

| Status | Icon | Description |
|--------|------|-------------|
| **Pending** | Clock (gray) | Step has not started yet. |
| **Running** | Spinner (blue) | Step is currently executing. |
| **Completed** | Checkmark (green) | Step finished successfully. |
| **Failed** | Alert circle (red) | Step encountered an error. |

Additional granular information when available:

| Detail | Description |
|--------|-------------|
| **Fold progress** | Shows "Fold 3/5" during cross-validation. |
| **Branch path** | Indicates which branch is currently executing in parallel pipelines. |
| **Variant indicator** | Shows "Variant 7/30" and a short description of the current variant configuration. |

---

## Metrics panel

As cross-validation folds complete, their scores appear in the metrics panel.

| Element | Description |
|---------|-------------|
| **Per-fold scores** | Table or list showing the score for each completed fold (R2, RMSE, or accuracy depending on the task type). |
| **Running average** | The mean score across all completed folds, updated live. |
| **Score chart** | Optional mini-chart plotting fold scores as they arrive. |

---

## Log panel

A scrollable, auto-scrolling panel showing the log stream from the backend.

| Feature | Description |
|---------|-------------|
| **Log entries** | Each entry shows a timestamp, log level (info/warning/error), and message text. |
| **Level coloring** | Info entries are neutral, warnings are amber, errors are red. |
| **Auto-scroll** | The panel automatically scrolls to the latest entry. Scrolling up pauses auto-scroll; scrolling back to the bottom resumes it. |
| **Context tags** | Log entries may include context tags (fold number, branch name, variant index) for easier filtering. |

---

## Completion states

### Successful completion

When the run completes:

- The status badge changes to **Completed** (green).
- A summary card appears with the best score, total models trained, and duration.
- A **View Results** link navigates to the {doc}`results-page`.
- Export options become available (e.g., download best model as `.n4a` bundle).

### Failure

When the run fails:

- The status badge changes to **Failed** (red).
- An error card displays the error message and Python traceback.
- The log panel shows the full error context.

### Stopped

When the run is manually stopped:

- The status badge changes to **Stopped** (amber).
- Partial results (from completed folds/variants before stopping) are preserved and accessible in Results.

:::{seealso}
- {doc}`experiment-wizard` -- Creating experiments
- {doc}`history-page` -- Viewing all past runs
- {doc}`results-page` -- Exploring completed run results
:::
