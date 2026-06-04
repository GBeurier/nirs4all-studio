# Backend

The backend is a FastAPI orchestration layer. It should be boring: validate
requests, call the right library API, format responses, and stream progress.

## Core rule

Do not reimplement `nirs4all` functionality in `api/`.

The backend may:

- validate HTTP request bodies
- manage file upload and path selection flows
- translate UI JSON into nirs4all inputs
- start background jobs
- publish WebSocket progress
- format nirs4all outputs for JSON
- handle missing optional dependencies gracefully

The backend should not implement:

- NIRS data parsing
- preprocessing algorithms
- model training
- prediction logic
- SHAP computation
- synthetic spectra generation
- workspace persistence formats owned by nirs4all

## Important modules

| Module | Role |
| --- | --- |
| `main.py` | FastAPI app creation, router registration, WebSockets, SPA serving. |
| `api/workspace.py` | Workspace, linked workspace, app settings, dataset groups, custom nodes. |
| `api/workspace_manager.py` | Linked workspace and active workspace state. |
| `api/app_config.py` | Cross-platform app config folder and persisted app settings. |
| `api/datasets.py` | Dataset detection, preview, linking, refresh, synthetic generation routes. |
| `api/pipelines.py` | Pipeline CRUD, operator discovery, validation, import/export, execution. |
| `api/nirs4all_adapter.py` | Translation between Studio pipeline JSON and nirs4all configs. |
| `api/store_adapter.py` | Read/format access to nirs4all workspace store data. |
| `api/jobs/manager.py` | Thread-pool job management and progress callbacks. |
| `api/shared/` | Shared services, metrics helpers, filter operators. |
| `api/telemetry.py` | Opt-in backend diagnostics. |

## Router conventions

- Define one router per domain.
- Register routers from `main.py` with `prefix="/api"`.
- Use Pydantic response models for public response shapes.
- Raise `HTTPException` with a clear `detail` for user-actionable errors.
- Sanitize NaN and Inf values before JSON responses.
- Keep imports of `nirs4all` guarded when a route can degrade gracefully.

## Background jobs

Long-running work should run through `JobManager`, not directly in request
handlers. Request handlers should return a job or run record quickly, then
progress should flow over WebSockets.

Use the existing notification helpers for job, training, fold, branch, variant,
and refit progress. Do not hand-build incompatible WebSocket payloads.

## Static serving

When `dist/index.html` exists, FastAPI can serve the built SPA. This supports
`npm run start:web:prod` and backend-hosted previews. API routes and public
static routes are excluded from the catch-all SPA route.

## Local backend commands

```bash
npm run dev:api
```

```bash
python main.py --host 127.0.0.1 --port 8000 --reload
```

```bash
pytest
pytest -m "not slow"
pytest tests/test_run_error_messages.py
```
