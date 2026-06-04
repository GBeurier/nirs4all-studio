# Runs and results

Runs are long-running executions of a pipeline against one or more datasets.
The backend stores run state, logs, metrics, artifacts, and prediction outputs
through nirs4all workspace storage.

## Create a run

Typical flow:

1. Link and validate a dataset.
2. Build or select a pipeline.
3. Bind the pipeline to the dataset.
4. Validate the pipeline.
5. Launch the run from the editor or the Runs area.

The backend creates a job and streams progress to the UI through WebSockets.

## Run actions

Available actions depend on the current state:

| Action | Purpose |
| --- | --- |
| stop | Request cancellation of a running job. |
| pause | Pause a supported run. |
| resume | Continue a paused run. |
| retry | Recreate a failed or stopped run from stored configuration. |
| delete | Remove the run record from the Studio view. |

## Progress updates

Progress is delivered over these WebSocket endpoints:

- `/ws`
- `/ws/job/{job_id}`
- `/ws/training/{job_id}`

The UI subscribes to job channels and renders training, fold, branch, variant,
and refit progress where the backend emits it.

## Results page

The **Results** page summarizes completed outputs from the active or linked
workspace. Use it to inspect model metrics, compare run outputs, and open detail
sheets for individual results.

## Aggregated results

Aggregated results are derived from stored prediction chains and result arrays.
They are useful when several runs or pipeline branches generated comparable
prediction outputs.

## Logs

Run logs are available through the Runs interface and the backend endpoint for
pipeline-specific logs. If the UI only shows a generic failure, inspect the run
detail and backend terminal output.
