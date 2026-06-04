# API overview

The backend is a FastAPI application mounted from `main.py`. All HTTP routes
are under `/api` unless noted otherwise. WebSocket routes are mounted under
`/ws`.

When the backend is running, use the live OpenAPI UI:

- Swagger UI: `http://127.0.0.1:8000/docs`
- OpenAPI JSON: `http://127.0.0.1:8000/openapi.json`

## Base URLs

| Mode | Base URL |
| --- | --- |
| Web development | relative `/api`, proxied by Vite to `http://127.0.0.1:8000/api` |
| Backend direct | `http://127.0.0.1:8000/api` |
| Electron | dynamic `http://127.0.0.1:<port>/api` resolved through the preload bridge |

## Error shape

Most backend errors use FastAPI's standard JSON error shape:

```json
{
  "detail": "Human-readable error message"
}
```

Unexpected server exceptions are logged and returned as:

```json
{
  "detail": "Internal server error"
}
```

## Route groups

| Group | Prefix | Purpose |
| --- | --- | --- |
| Health and system | `/health`, `/system/*` | Health, status, build info, paths, capabilities, operator availability, error log. |
| Workspace | `/workspace/*`, `/workspaces/*` | Active workspace, linked workspaces, scans, stats, import/export, settings, favorites. |
| Datasets | `/datasets/*` | Link, preview, detect, validate, load, refresh, generate synthetic datasets. |
| Pipelines | `/pipelines/*` | CRUD, presets, operator discovery, validation, shape propagation, execution, import/export. |
| Runs | `/runs/*` | List, create, quick run, pause, resume, stop, retry, delete, logs. |
| Results and predictions | `/predictions/*`, `/aggregated-predictions/*` | Prediction records, arrays, chain summaries and detail. |
| Models | `/models/*` | Model discovery, parameter schema, trained bundles, comparison, instantiation. |
| Preprocessing | `/preprocessing/*` | Method discovery, schemas, apply, preview, validate, presets, chain optimization. |
| Analysis | `/analysis/*` | PCA, t-SNE, UMAP, importance, correlation, selection, wavelengths, transfer analysis. |
| AutoML | `/automl/*` | Start, stop, inspect jobs, trials, results, and available models. |
| Playground | `/execute`, `/operators`, `/validate`, `/presets`, `/capabilities` | Interactive operator execution and playground metadata. |
| Synthesis | `/preview`, `/generate`, `/components`, `/validate`, `/status` | Synthetic spectra preview and generation. |
| Updates | `/updates/*` | App and library version checks, dependency management, update downloads, venv path. |
| SHAP | `/shap/*` | SHAP and variable-importance related backend routes. |

## WebSockets

| Endpoint | Purpose |
| --- | --- |
| `/ws` | General channel subscription endpoint. |
| `/ws/job/{job_id}` | Job-specific progress stream. |
| `/ws/training/{job_id}` | Training-oriented progress stream. |
| `/api/ws/stats` | Current WebSocket connection count. |

General messages use this shape:

```json
{
  "type": "subscribe",
  "channel": "job:<job_id>",
  "data": {}
}
```

The server also accepts `unsubscribe` and `ping` messages.

## Frontend API client

All frontend HTTP calls should go through `src/api/client.ts`. The client:

- resolves the backend URL differently for web and Electron modes
- serializes JSON request bodies
- throws `ApiRequestError` with `detail` and `status`
- records diagnostics breadcrumbs only when debug data sharing is enabled

Avoid calling `fetch` directly from feature code unless there is a specific
streaming or browser API reason.
