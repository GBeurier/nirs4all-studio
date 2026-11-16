# Electron Architecture Guide

This document describes the Electron-based desktop architecture for nirs4all Studio.

## Table of Contents

1. [Overview](#overview)
2. [Why Electron?](#why-electron)
3. [Architecture](#architecture)
4. [Main Process](#main-process)
5. [Preload Script](#preload-script)
6. [Python Environment](#python-environment)
7. [Development Workflow](#development-workflow)
8. [Security Model](#security-model)
9. [Build System](#build-system)

---

## Overview

nirs4all Studio uses Electron as the desktop shell, replacing the previous PyWebView-based approach. This provides:

- **Consistent WebGL**: Chromium engine on all platforms
- **Better DevTools**: Full Chrome DevTools support
- **Mature Packaging**: electron-builder for multi-OS distribution
- **Updates**: installer-based application updates from GitHub Releases (see [UPDATE_SYSTEM.md](UPDATE_SYSTEM.md))

### Current native-session lifecycle

Electron starts the Rust `studio-sidecar` control plane and creates the
window through `electron/native-session-lifecycle.ts`. No packaged Electron
entrypoint imports or starts a Python HTTP server.

Startup order (`startControlPlane` in `electron/main.ts`):

1. `EnvManager.startupCheck()` settles the Python environment: it reads the
   selection, takes its package inventory and, when a required package is
   missing or out of range and Studio may install it, installs the required
   packages. The splash shows one progress line.
2. The sidecar is started on the selected environment, or without a Python
   host when none is usable.
3. The window is created. The scientific host is confirmed in the background,
   so the window is not delayed by the scientific library's cold start.

Native route selection happens before dispatch. A request selected for the
sidecar is never retried through another server. An unmigrated route returns a
typed fail-closed refusal without acquiring Python. The Rust sidecar invokes a
bounded CPython stdio library/plugin host independently of this HTTP policy.
That host is the interpreter of the one Python environment the user selected
or Studio created; Electron passes it to the sidecar at start (see
[Python Environment](#python-environment)). The child uses `-I -S -B` and owns
no listener.

---

## Why Electron?

### The WebGL Problem

The previous architecture used PyWebView, which wraps the OS's native WebView:

| OS | WebView Engine | WebGL Support |
|----|----------------|---------------|
| Windows | EdgeChromium (WebView2) | Good |
| macOS | WKWebView (WebKit/Safari) | Variable |
| Linux | Qt/WebKit2 or GTK/WebKit2 | **Problematic** |

This caused WebGL rendering inconsistencies, especially on Linux where WebKit2 WebGL support varies significantly.

### Electron Solution

Electron bundles Chromium, providing:
- Identical rendering engine on all platforms
- Consistent WebGL 2.0 support
- Predictable performance characteristics

### Trade-offs

| Aspect | PyWebView | Electron |
|--------|-----------|----------|
| Bundle size | ~50MB | ~150MB |
| WebGL consistency | Variable | Consistent |
| DevTools | Limited | Full Chrome DevTools |
| Auto-update | Manual | Built-in |
| Memory usage | Lower | Higher |

---

## Architecture

The authoritative packaged path is:

```text
renderer request/connection
  -> Electron per-target preselection
     -> native-qualified: Rust studio-sidecar HTTP/WS listener
     -> unmigrated: typed refusal before fetch/spawn/retry

Rust may invoke bounded nirs4all library callables through fresh isolated
CPython JSON-stdio processes. CPython never owns the product listener.
```

Process and module layout:

```text
Electron main process (electron/)
├── main.ts                        window, app lifecycle, IPC handlers
├── native-session-lifecycle.ts    start order: control plane, then window
├── native-sidecar-manager.ts      spawn, readiness line, stop of studio-sidecar
├── packaged-runtime-contract.ts   verifies STUDIO_RUNTIME_CONTRACT.json before spawn
├── env-manager.ts                 coordinator of the one Python environment
└── env/                           detection, inventory, uv, provisioning, adapters
        │ contextBridge (preload.ts)
        ▼
Renderer (src/)                    window.electronApi; HTTP/WS to the sidecar only
        │ HTTP/WebSocket on 127.0.0.1:<port>
        ▼
studio-sidecar (Rust)              product HTTP/WS owner, jobs, state
        │ JSON over stdio
        ▼
CPython worker                     interpreter of the selected environment
```

---

## Main Process

The main process (`electron/main.ts`) handles:

### Window Management

```typescript
mainWindow = new BrowserWindow({
  width: 1400,
  height: 900,
  minWidth: 1024,
  minHeight: 768,
  webPreferences: {
    preload: path.join(__dirname, "preload.cjs"),
    nodeIntegration: false,   // Security: disable Node in renderer
    contextIsolation: true,   // Security: isolate preload context
    sandbox: true,
  },
  show: false,
});
```

### App Lifecycle

```typescript
app.whenReady().then(async () => {
  splashWindow = createSplashWindow();
  await startNativeSession({ startControlPlane, createWindow });
});

app.on("before-quit", (event) => {
  // Stops the sidecar, then quits; a 5 second deadline forces the quit.
});
```

A packaged sidecar that fails its contract verification or does not become
ready stops startup with an error dialog. A Python environment problem never
does: Studio opens and reports it (see [Python Environment](#python-environment)).

### IPC Handlers

Handlers are registered with `ipcMain.handle` under namespaced channels:
`dialog:*`, `system:*`, `window:*`, `telemetry:*`, `sidecar:*`,
`control:getInfo`, `backend:restart`, `env:getInstallLog`, `pythonEnv:*` and
`app:quitForUpdate`.

```typescript
ipcMain.handle("pythonEnv:getState", () => envManager.getState());

ipcMain.handle("pythonEnv:apply", (_event, request) =>
  envManager.apply({
    pythonPath: requireString(request?.pythonPath, "pythonPath"),
    packages: requirePackageNames(request?.packages),
  }));
```

---

## Preload Script

The preload script (`electron/preload.ts`) exposes one object,
`window.electronApi`, through `contextBridge`:

```typescript
const electronApi = {
  selectFolder: () => ipcRenderer.invoke("dialog:selectFolder"),
  openExternal: (url) => ipcRenderer.invoke("system:openExternal", url),
  // ...
  pythonEnv: {
    getState: () => ipcRenderer.invoke("pythonEnv:getState"),
    detect: (refresh) => ipcRenderer.invoke("pythonEnv:detect", refresh),
    // ...
    onState: (handler) => { /* subscribes to "pythonEnv:state" */ },
  } satisfies PythonEnvApi,
  getInstallLog: () => ipcRenderer.invoke("env:getInstallLog"),
  onInstallLog: (callback) => { /* subscribes to "env:installLog" */ },
};
```

### TypeScript Types

The renderer accesses this API via `src/types/electron.d.ts`
(`window.electronApi?: ElectronApi`). The Python environment types are in
`src/types/pythonEnvironment.ts`, imported by both `electron/` and `src/`.

---

## Python Environment

Studio uses exactly one Python environment: the interpreter the user selected,
or the one Studio created. Installers ship no Python. The Electron main
process owns the environment lifecycle; the sidecar only runs the interpreter
it is given. Detailed model:
[environment architecture](_internals/environment-architecture.md).

### Lifecycle (`electron/env-manager.ts`, `electron/env/`)

- **Selection.** `userData/env-settings.json` holds `{ "pythonPath": "..." }`.
- **Inventory.** One subprocess per interpreter lists its distributions from
  metadata; nothing is imported. The inventory of the selected environment is
  cached in `userData/python-inventory.json`.
- **Catalogue.** `recommended-config.json`: `required` packages (accepted
  `range`, exact `install` version) and `optional` recommended packages.
- **uv.** Environments are created and packages installed with the shipped
  `uv` (`resources/backend/tools/uv[.exe]`), with the required wheels as a
  `--find-links` source on Windows and Linux (`resources/backend/wheels/`);
  on macOS the required packages come from the package index. PyTorch is not
  part of a new environment: it is installed on request, with
  `--torch-backend auto`.
- **First launch.** The phase is `unconfigured`; the renderer shows one page
  that lists detected environments. The user picks one or creates a new one
  (`userData/python-env/python` and `userData/python-env/venv`; the pinned
  Python runtime is downloaded, or taken from the offline payload of a Windows
  or Linux offline installer). Required
  packages are installed automatically; recommended packages are per-package
  choices.
- **Later launches.** The environment is reused. Required packages that left
  their range are updated before the sidecar starts. Recommended packages
  older than recommended produce a warning toast and indicator dots.
- **Switch.** Settings has a `Python` tab with the same page. A switch is kept
  only when the sidecar really runs the new interpreter; otherwise the
  previous selection is restored.
- **Editable installs** are never modified.

Phases: `unconfigured`, `ready`, `busy`, `needs_attention`.

### IPC surface: `PythonEnvApi`

Exposed as `window.electronApi.pythonEnv`; contract in
`src/types/pythonEnvironment.ts`.

| Method | IPC channel | Purpose |
|---|---|---|
| `getState()` | `pythonEnv:getState` | Current `PythonEnvState` |
| `detect(refresh?)` | `pythonEnv:detect` | Interpreters found on this machine, with their reports |
| `inspect(path)` | `pythonEnv:inspect` | Report of an interpreter or environment directory, without changing anything |
| `describeNewEnvironment()` | `pythonEnv:describeNewEnvironment` | What Studio would install in an environment it creates |
| `browse()` | `pythonEnv:browse` | File dialog for a Python executable |
| `chooseDirectory()` | `pythonEnv:chooseDirectory` | Folder dialog for a new environment |
| `apply(request)` | `pythonEnv:apply` | Switch to an existing interpreter |
| `create(request)` | `pythonEnv:create` | Create a Studio environment and switch to it |
| `installPackages(packages)` | `pythonEnv:installPackages` | Install or update recommended packages |
| `retry()` | `pythonEnv:retry` | Re-run the startup check and restart the host |
| `onState(handler)` | `pythonEnv:state` (event) | State changes |

The install log is a separate channel shared by every environment operation:
`getInstallLog()` (`env:getInstallLog`) and `onInstallLog()` (`env:installLog`
event). `restartBackend()` (`backend:restart`) restarts the sidecar on the
current selection, or retries when the phase is `needs_attention`.

### Sidecar start variables

`electron/native-sidecar-manager.ts` spawns
`studio-sidecar --host 127.0.0.1 --port <port>` and waits for its
`STUDIO_SIDECAR_READY` line. The Python hand-off is four variables, set only
when the phase is `ready`:

| Variable | Value |
|---|---|
| `NIRS4ALL_PYTHON_PLUGIN_HOST` | Selected interpreter, exactly as selected |
| `NIRS4ALL_PYTHON_PLUGIN_SITE_PACKAGES` | Package directory of the environment |
| `NIRS4ALL_STUDIO_ADAPTERS_DIR` | Directory that contains `studio_document_adapters/` (`resources/backend/adapters` when packaged) |
| `NIRS4ALL_SCIENTIFIC_EXECUTOR` | `cpython-stdio-v1` |

Inherited values of these variables are removed before the spawn, so only
Electron's selection reaches the sidecar. The sidecar also receives
`NIRS4ALL_STUDIO_SESSION_TOKEN`, `NIRS4ALL_APP_VERSION`, `NIRS4ALL_APP_DIR`,
`NIRS4ALL_APP_EXE`, `NIRS4ALL_ELECTRON_PID`, `NIRS4ALL_ELECTRON` and, when the
file exists, `NIRS4ALL_BUILD_INFO_PATH`.

After a start or restart on an environment, the main process polls
`/api/system/readiness` until the host is acquired, then checks that
`/api/system/env-coherence` reports the selected interpreter.

---

## Development Workflow

### Setup

```bash
# Install dependencies
npm install
pip install -r requirements-cpu.txt

# Check local Node/npm/Python coherence
npm run doctor
```

### Development Mode

```bash
# Rust-only Electron + Vite dev mode
npm run start:desktop
```

In development mode:
- Vite serves the React app with HMR
- Electron starts the Rust sidecar and refuses unmigrated renderer routes
- Electron loads from `http://localhost:5173`
- The Python environment is selected on the same page as in the product, and
  stored in `userData/env-settings.json`
- `uv` is resolved from `NIRS4ALL_UV`, then `backend-dist/tools/` (staged by
  `node scripts/fetch-uv.cjs`), then `PATH`; the required wheels are taken
  from `backend-dist/wheels/` when `node scripts/build-wheelhouse.cjs` has
  staged them, otherwise from the package index
- The document adapters are materialised from the source tree into
  `userData/studio-adapters/`

On Windows, the sidecar starts bounded CPython processes through an internal
launcher rather than Python itself. The launcher creates a Job Object with
`KILL_ON_JOB_CLOSE`, assigns itself before spawning Python, and enables no
breakaway flag; Python and every descendant are therefore members without a
spawn/assign race. Timeout or overflow terminates the launcher, and handle close
lets Windows terminate the entire job. Studio no longer relies on `taskkill`.
Windows CI executes the exit-code and escaped-child sentinel tests because
cross-compilation cannot exercise kernel containment.

Legacy (pre-V1, DuckDB) workspaces are not supported. Studio does not convert
them; users convert them offline with the separate `nirs4all-tools` package.

Native researcher training is a separate Rust-only route:
`POST /api/training/native-archive-v2`. It selects one persisted IO dataset
source, executes `SNV(ddof=0) -> Savitzky-Golay(mode=interp) -> PLS` through
IO/DAG-ML/Methods/Core, and registers the resulting Archive V2 in Store v5.
The route supports bounded named multi-target regression and has no CPython,
HPO, fusion, N-D, or fallback branch.

For browser-only web development, run `python main.py --no-reload` beside
`npm run dev`; this does not describe the packaged desktop product.

### Production Preview

```bash
# Build everything
npm run build
npm run build:electron

# Preview
npm run electron:preview
```

---

## Security Model

### Key Security Settings

```typescript
webPreferences: {
  nodeIntegration: false,     // Never enable in renderer
  contextIsolation: true,     // Always enable
  sandbox: true,              // Enable Chromium sandbox
  webSecurity: true,          // Enforce same-origin policy
}
```

### Secure IPC Pattern

**Never expose Node.js directly to renderer**. Use contextBridge:

```typescript
// BAD: Exposes full Node.js
contextBridge.exposeInMainWorld('require', require);

// GOOD: Expose specific functions only
contextBridge.exposeInMainWorld('api', {
  readFile: (path) => ipcRenderer.invoke('fs:read', path),
});
```

### Backend Communication

The renderer communicates with the backend via HTTP/WebSocket only:
- No direct file system access
- No direct process spawning
- All privileged operations go through IPC → main process

---

## Build System

### Electron Build

```bash
# Build the renderer and the Electron main process, then check the packaged graph
npm run build:electron
```

### Full Release

```bash
# Run on the matching host; CPU is the only installer flavor.
npm run release -- --platform linux --flavor cpu

# Offline installer (Windows and Linux; adds the offline payload)
npm run release -- --platform linux --flavor cpu --offline
```

This runs:
1. staging of the installer payload in `backend-dist/`: `uv`, the wheels of
   the required packages, the document adapters and the Rust sidecar (plus the
   offline payload with `--offline`). On macOS no wheels are staged
2. verification of the runtime contract and of that payload
3. `npm run build:electron` (React frontend and Electron main process)
4. electron-builder packaging plus fresh-output/runtime verification

No Python runtime is packaged, and a macOS application embeds no wheels. On
macOS (Apple Silicon only), the Electron Builder `afterPack` hook
pre-signs `libn4m.dylib`, then regenerates `STUDIO_RUNTIME_CONTRACT.json`.
`mac.signIgnore` prevents a second signature from changing those attested
bytes. It does not match `native/studio-sidecar` or `tools/uv`, so Electron
Builder signs them and the outer `.app` normally. See
[PACKAGING.md](PACKAGING.md) for the build inputs, the wheel locks, the
fail-closed signing order and its notarization limits.

The installer helper rejects non-CPU flavors, cross-host targets and
`--platform all`.

---

## Configuration Files

| File | Purpose |
|------|---------|
| `electron/main.ts` | Main process entry point |
| `electron/preload.ts` | IPC bridge |
| `electron/native-session-lifecycle.ts` | Start order of the control plane and the window |
| `electron/native-sidecar-manager.ts` | Rust sidecar lifecycle |
| `electron/packaged-runtime-contract.ts` | Verification of the packaged sidecar and Methods library |
| `electron/env-manager.ts` | Coordinator of the selected Python environment |
| `electron/env/` | Detection, inventory, `uv`, provisioning, adapters |
| `electron/logger.ts` | Persistent file logging |
| `electron-builder.installer.yml` | Installer packaging configuration |
| `electron-builder.offline.yml` | Offline installer packaging configuration |
| `recommended-config.json` | Package catalogue (`required`, `optional`) |
| `scripts/python-runtime-config.cjs` | Pinned Python runtime that Studio installs when it creates an environment |
| `vite.config.ts` | Vite + Electron plugin |
| `build/entitlements.mac.plist` | macOS entitlements |
| `src/types/electron.d.ts` | TypeScript types of `window.electronApi` |
| `src/types/pythonEnvironment.ts` | Python environment contract (`PythonEnvApi`) |

---

## Debugging

### Persistent Log Files

All main process output (including the sidecar's stderr) is written to rotating log files:

| OS | Location |
|----|----------|
| Windows | `%APPDATA%\nirs4all-webapp\logs\nirs4all-YYYY-MM-DD.log` |
| macOS | `~/Library/Application Support/nirs4all-webapp/logs/` |
| Linux | `~/.config/nirs4all-webapp/logs/` |

Logs include:
- All `console.log/warn/error` from the main process
- Sidecar stderr (prefixed with `[Native sidecar]`)
- Python environment state changes and failures (prefixed with `[EnvManager]`)
- Uncaught exceptions and unhandled promise rejections with full stack traces
- App startup information (version, platform, architecture)

Old log files are pruned automatically (last 7 days kept).

The log directory can also be opened from the app via `electronApi.openLogDir()` or the Settings page.

### Main Process Logs

In development, Electron main process logs also appear in the terminal where you launched the app.

### Renderer DevTools

Press `Cmd+Option+I` (macOS) or `Ctrl+Shift+I` (Windows/Linux) to open DevTools.

### Backend Logs

The sidecar's stderr is forwarded to both the main process console and the persistent log files. Also check:
```bash
# If the sidecar fails to start: readiness check without starting a server
sidecar/target/release/studio-sidecar --smoke-readiness
```

The output of `uv` during an environment operation is the install log, shown
on the Python page and available through `electronApi.getInstallLog()`.

### IPC Debugging

Enable verbose IPC logging in development:
```typescript
ipcMain.handle('channel', async (event, ...args) => {
  console.log('IPC:', channel, args);
  // ...
});
```

---

## Crash Reporting (Sentry)

nirs4all Studio supports automatic crash reporting via [Sentry](https://sentry.io/). When enabled, errors from Electron main and the React renderer are reported. The transitional web/diagnostic Python backend also reports when it is explicitly running.

### Setup

1. Create a free Sentry account at https://sentry.io/
2. Create a project (select "Electron" as the platform)
3. Copy the DSN from the project settings
4. Set the `SENTRY_DSN` environment variable:

```bash
# Windows (system environment or before launching the app)
set SENTRY_DSN=https://your-key@o123456.ingest.sentry.io/1234567

# Linux/macOS
export SENTRY_DSN=https://your-key@o123456.ingest.sentry.io/1234567
```

For the React renderer (frontend), set the DSN as a Vite build-time variable:

```bash
# In your .env or .env.production file:
VITE_SENTRY_DSN=https://your-key@o123456.ingest.sentry.io/1234567
```

### Architecture

| Layer | Package | How it works |
|-------|---------|-------------|
| **Electron main** | `@sentry/electron` | Captures uncaught exceptions, unhandled rejections, native crashes |
| **React renderer** | `@sentry/react` | ErrorBoundary for React errors, browser error tracking, performance |
| **Python diagnostic/web backend** | `sentry-sdk[fastapi]` | Captures FastAPI exceptions only while that optional process is explicitly running |

- All three layers send events to the same Sentry project
- When `SENTRY_DSN` is not set, Sentry is completely disabled (zero overhead)
- The Electron main process passes `SENTRY_DSN` to the backend process automatically

### What gets reported

- Uncaught JavaScript exceptions (main + renderer)
- Unhandled promise rejections
- React rendering errors (via ErrorBoundary)
- Explicit Python diagnostic/web backend unhandled exceptions
- App version, OS, and platform metadata
- Performance traces (sampled at 10%)

### Privacy

- No PII (personally identifiable information) is sent by default
- No spectral data or dataset content is included in crash reports
- Only error messages, stack traces, and system metadata are reported
