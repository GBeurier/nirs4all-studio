# Electron desktop

Electron provides the packaged desktop shell for nirs4all Studio. It gives the
renderer a consistent Chromium runtime and lets the application launch a local
Python backend.

## Process model

```text
Electron main process
  -> creates BrowserWindow
  -> starts FastAPI backend subprocess
  -> exposes IPC handlers

Electron preload script
  -> exposes window.electronApi

React renderer
  -> calls electronApi for native operations
  -> calls FastAPI through a dynamic local URL

FastAPI backend subprocess
  -> serves /api and /ws
  -> calls nirs4all
```

## Main process

`electron/main.ts` owns:

- app startup and shutdown
- runtime crash guard switches
- `BrowserWindow` creation
- native file and folder dialogs
- open external URL and reveal file operations
- window controls
- backend lifecycle IPC
- diagnostics consent forwarding

## Preload bridge

`electron/preload.ts` exposes a narrow API to the renderer. Keep this bridge
explicit. Do not expose Node.js primitives or arbitrary filesystem access.

Typical bridge capabilities:

- select file
- select folder
- save file
- reveal file in explorer
- open external URL
- get backend port or URL
- get backend status
- set diagnostics consent

## Backend manager

`electron/backend-manager.ts` owns the Python process:

- find a free localhost port
- choose dev, fallback venv, or bundled backend executable
- set `NIRS4ALL_PORT`, `NIRS4ALL_DESKTOP`, and `NIRS4ALL_ELECTRON`
- spawn the backend
- wait for `/api/health`
- forward stdout and stderr
- monitor health
- restart after unexpected failure up to the configured limit
- stop the process on app shutdown

The first health check can take up to 120 seconds because Python imports and
scientific dependencies may be slow on first launch.

## Development mode

```bash
npm run start:desktop
```

or:

```bash
npm run dev:electron
```

In development, Electron loads the Vite dev server and opens DevTools. The
backend runs from the local Python environment unless a bundled backend is
available and explicitly selected.

## Production mode

Production packages include:

- built renderer in `dist/`
- built Electron main/preload output in `dist-electron/`
- PyInstaller backend copied into `backend-dist/` and packaged as an extra
  resource

Preview locally with:

```bash
npm run electron:preview
```

## Security notes

Keep these defaults unless there is a documented reason to change them:

- `nodeIntegration: false`
- `contextIsolation: true`
- no direct Node access in the renderer
- privileged operations behind explicit IPC
- renderer communicates with backend through HTTP/WebSocket

The current window uses `sandbox: false` because dropped file paths are required
for dataset workflows.
