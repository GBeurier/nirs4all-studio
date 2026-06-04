# Architecture

nirs4all Studio is a local-first application with three cooperating runtimes:

```text
React renderer
  -> HTTP /api and WebSocket /ws
FastAPI backend
  -> nirs4all Python library
nirs4all workspace on disk
```

In desktop mode, Electron owns the native window and starts the backend as a
local subprocess. In web development mode, Vite serves the renderer and proxies
API traffic to FastAPI.

## Responsibilities

| Layer | Owns | Does not own |
| --- | --- | --- |
| React renderer | UI state, routes, forms, visualizations, API client calls. | Python execution, filesystem writes outside explicit IPC/API flows. |
| Electron main | Window lifecycle, file dialogs, backend process lifecycle, native shell actions. | Scientific logic, direct renderer data access. |
| FastAPI backend | HTTP routes, WebSockets, request validation, adapters, job orchestration. | Reimplementation of nirs4all algorithms. |
| nirs4all library | NIRS parsing, preprocessing, model training, predictions, SHAP, synthesis, workspace storage. | Studio UI state. |

## Backend route composition

`main.py` creates the FastAPI app, installs CORS, registers routers with
`prefix="/api"`, configures WebSocket endpoints, initializes diagnostics, and
serves the built SPA when `dist/index.html` exists.

Startup restores the active workspace from app settings and applies it to
`nirs4all.workspace` when the library is available.

## Data flow

1. The user acts in the renderer.
2. The renderer calls `src/api/client.ts`.
3. The client resolves `/api` differently for web and Electron modes.
4. FastAPI validates the request.
5. Backend adapters translate Studio JSON into nirs4all library inputs.
6. Long-running work is scheduled through the job manager.
7. Progress is emitted over WebSocket channels.
8. Results are stored in the nirs4all workspace.
9. The UI reads summaries, arrays, logs, and artifacts through API routes.

## Workspace model

Studio stores app-level state in the app config folder. nirs4all stores
scientific and execution state in the active workspace. Keep this boundary
clear:

- app settings can remember what the user selected
- library storage is the source of truth for scientific outputs
- adapters may read and format library outputs for the UI
- backend routes should not create independent parallel result formats

## Desktop runtime

Electron creates a `BrowserWindow`, exposes a narrow `electronApi` through the
preload script, launches the backend on a free local port, and waits for
`/api/health` before the renderer uses the API.

Security defaults:

- `nodeIntegration: false`
- `contextIsolation: true`
- privileged operations go through explicit IPC handlers
- renderer/backend communication uses HTTP and WebSocket

## Web runtime

Vite serves the renderer on port `5173`. Requests to `/api` and `/ws` are
proxied to FastAPI on port `8000`. The renderer uses `BrowserRouter`.

Electron uses `HashRouter` because packaged `file://` pages cannot rely on
browser history fallback.
