# Electron Architecture Guide

This document describes the Electron-based desktop architecture for nirs4all-webapp.

## Table of Contents

1. [Overview](#overview)
2. [Why Electron?](#why-electron)
3. [Architecture](#architecture)
4. [Main Process](#main-process)
5. [Preload Script](#preload-script)
6. [Backend Manager](#backend-manager)
7. [Development Workflow](#development-workflow)
8. [Security Model](#security-model)
9. [Build System](#build-system)

---

## Overview

nirs4all-webapp uses Electron as the desktop shell, replacing the previous PyWebView-based approach. This provides:

- **Consistent WebGL**: Chromium engine on all platforms
- **Better DevTools**: Full Chrome DevTools support
- **Mature Packaging**: electron-builder for multi-OS distribution
- **Auto-Updates**: Built-in electron-updater support

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

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Electron Application                             │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                    Main Process (Node.js)                          │ │
│  │                                                                    │ │
│  │  electron/main.ts                                                  │ │
│  │  ├── BrowserWindow creation                                        │ │
│  │  ├── App lifecycle (ready, quit, activate)                         │ │
│  │  ├── IPC handlers (file dialogs, system info)                      │ │
│  │  └── Backend lifecycle (via backend-manager.ts)                    │ │
│  │                                                                    │ │
│  │  electron/backend-manager.ts                                       │ │
│  │  ├── spawn() - Start Python backend subprocess                     │ │
│  │  ├── healthCheck() - Poll /api/health endpoint                     │ │
│  │  ├── shutdown() - Graceful SIGTERM                                 │ │
│  │  └── restart() - Auto-restart on failure                           │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                               │                                          │
│                               │ contextBridge.exposeInMainWorld()        │
│                               │                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                   Preload Script (Isolated)                        │ │
│  │                                                                    │ │
│  │  electron/preload.ts                                               │ │
│  │  └── window.electronAPI = {                                        │ │
│  │        getBackendPort(),     // Get dynamic port                   │ │
│  │        openFileDialog(),     // Native file picker                 │ │
│  │        openDirectoryDialog(),// Native folder picker               │ │
│  │        saveFileDialog(),     // Native save dialog                 │ │
│  │        getPlatform(),        // OS detection                       │ │
│  │        getAppVersion(),      // App version                        │ │
│  │      }                                                             │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                               │                                          │
│                               │ window.electronAPI                       │
│                               ▼                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                  Renderer Process (Chromium)                       │ │
│  │                                                                    │ │
│  │  React Application (src/)                                          │ │
│  │  ├── Pipeline Editor (WebGL via Regl)                              │ │
│  │  ├── Spectral Visualization                                        │ │
│  │  └── API Client → http://localhost:{PORT}/api/...                  │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
                               │
                               │ HTTP/WebSocket (localhost:PORT)
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    Python Backend (Subprocess)                           │
│                                                                          │
│  FastAPI + Uvicorn                                                       │
│  ├── /api/health          - Health check (used by backend-manager)       │
│  ├── /api/system/build    - Build info + GPU detection                   │
│  ├── /api/workspace/*     - Workspace management                         │
│  ├── /api/datasets/*      - Dataset operations                           │
│  └── /api/pipelines/*     - Pipeline execution                           │
│                                                                          │
│  nirs4all library (lazy-loaded)                                          │
│  ├── TensorFlow/PyTorch (GPU if available)                               │
│  └── scikit-learn, numpy, pandas                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Main Process

The main process (`electron/main.ts`) handles:

### Window Management

```typescript
const mainWindow = new BrowserWindow({
  width: 1400,
  height: 900,
  webPreferences: {
    nodeIntegration: false,      // Security: disable Node in renderer
    contextIsolation: true,      // Security: isolate preload context
    preload: path.join(__dirname, 'preload.js'),
  },
});
```

### App Lifecycle

```typescript
app.on('ready', async () => {
  // 1. Start backend
  await backendManager.spawn();
  await backendManager.waitForHealth();

  // 2. Create window
  createMainWindow();
});

app.on('before-quit', async () => {
  // Graceful backend shutdown
  await backendManager.shutdown();
});
```

### IPC Handlers

```typescript
ipcMain.handle('dialog:openFile', async (event, options) => {
  return dialog.showOpenDialog(mainWindow, options);
});

ipcMain.handle('backend:getPort', () => {
  return backendManager.getPort();
});
```

---

## Preload Script

The preload script (`electron/preload.ts`) creates a secure bridge:

```typescript
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Backend communication
  getBackendPort: () => ipcRenderer.invoke('backend:getPort'),

  // File dialogs
  openFileDialog: (options) => ipcRenderer.invoke('dialog:openFile', options),
  openDirectoryDialog: (options) => ipcRenderer.invoke('dialog:openDirectory', options),
  saveFileDialog: (options) => ipcRenderer.invoke('dialog:saveFile', options),

  // System info
  getPlatform: () => process.platform,
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
});
```

### TypeScript Types

The renderer accesses this API via `src/types/electron.d.ts`:

```typescript
interface ElectronAPI {
  getBackendPort(): Promise<number>;
  openFileDialog(options?: OpenDialogOptions): Promise<OpenDialogReturnValue>;
  openDirectoryDialog(options?: OpenDialogOptions): Promise<OpenDialogReturnValue>;
  saveFileDialog(options?: SaveDialogOptions): Promise<SaveDialogReturnValue>;
  getPlatform(): string;
  getAppVersion(): Promise<string>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
```

---

## Backend Manager

The backend manager (`electron/backend-manager.ts`) handles:

### Spawning the Backend

```typescript
class BackendManager {
  private process: ChildProcess | null = null;
  private port: number = 0;

  async spawn(): Promise<void> {
    // Find free port
    this.port = await findFreePort();

    // Locate backend binary
    const backendPath = this.getBackendPath();

    // Spawn subprocess
    this.process = spawn(backendPath, [
      '--port', String(this.port),
      '--host', '127.0.0.1',
    ]);

    // Handle stdout/stderr
    this.process.stdout?.on('data', (data) => {
      console.log(`[Backend] ${data}`);
    });
  }

  private getBackendPath(): string {
    if (app.isPackaged) {
      // Production: backend in resources folder
      return path.join(process.resourcesPath, 'backend', 'nirs4all-backend');
    } else {
      // Development: use local binary or Python directly
      return path.join(__dirname, '..', 'backend-dist', 'nirs4all-backend');
    }
  }
}
```

### Health Monitoring

```typescript
async waitForHealth(timeout = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(`http://127.0.0.1:${this.port}/api/health`);
      if (response.ok) {
        console.log('Backend is healthy');
        return;
      }
    } catch {
      // Backend not ready yet
    }
    await sleep(100);
  }
  throw new Error('Backend health check timeout');
}
```

### Graceful Shutdown

```typescript
async shutdown(): Promise<void> {
  if (this.process) {
    // Send SIGTERM for graceful shutdown
    this.process.kill('SIGTERM');

    // Wait for process to exit
    await new Promise((resolve) => {
      this.process?.on('exit', resolve);
      // Force kill after timeout
      setTimeout(() => {
        this.process?.kill('SIGKILL');
        resolve(null);
      }, 5000);
    });
  }
}
```

---

## Development Workflow

### Setup

```bash
# Install dependencies
npm install
pip install -r requirements-cpu.txt

# Build backend (optional, can use Python directly in dev)
npm run build:backend:cpu
```

### Development Mode

```bash
# Terminal 1: Vite dev server
npm run dev

# Terminal 2: Python backend (with hot reload)
python main.py --port 8000 --reload

# Terminal 3: Electron (dev mode)
npm run electron:dev
```

In development mode:
- Vite serves the React app with HMR
- Python backend runs directly (no PyInstaller)
- Electron loads from `http://localhost:5173`

### Production Preview

```bash
# Build everything
npm run build
npm run build:backend:cpu

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

### Backend Build (PyInstaller)

```bash
# CPU build
NIRS4ALL_BUILD_FLAVOR=cpu pyinstaller backend.spec --noconfirm

# GPU build (CUDA on Linux/Windows)
NIRS4ALL_BUILD_FLAVOR=gpu pyinstaller backend.spec --noconfirm

# GPU build (Metal on macOS)
NIRS4ALL_BUILD_FLAVOR=gpu-metal pyinstaller backend.spec --noconfirm
```

The `backend.spec` file configures:
- Hidden imports for dynamic modules
- Data files (frontend build, public assets)
- Exclusions (reduce bundle size)
- Platform-specific settings

### Electron Build

```bash
# Build main process (TypeScript → JavaScript)
npm run build:electron

# Package for distribution
npm run dist           # Current platform
npm run dist:linux     # Linux (AppImage, DEB)
npm run dist:win       # Windows (NSIS, portable)
npm run dist:mac       # macOS (DMG)
```

### Full Release

```bash
# CPU edition
./scripts/build-release.sh --flavor cpu

# GPU edition
./scripts/build-release.sh --flavor gpu
```

This runs:
1. `npm run build` (React frontend)
2. `npm run build:backend:{flavor}` (Python backend)
3. `npm run build:electron` (Electron main process)
4. `npm run dist` (electron-builder packaging)

---

## Configuration Files

| File | Purpose |
|------|---------|
| `electron/main.ts` | Main process entry point |
| `electron/preload.ts` | IPC bridge |
| `electron/backend-manager.ts` | Backend lifecycle |
| `electron-builder.yml` | Packaging configuration |
| `backend.spec` | PyInstaller configuration |
| `vite.config.ts` | Vite + Electron plugin |
| `build/entitlements.mac.plist` | macOS entitlements |
| `src/types/electron.d.ts` | TypeScript types |

---

## Debugging

### Main Process Logs

Electron main process logs appear in the terminal where you launched the app.

### Renderer DevTools

Press `Cmd+Option+I` (macOS) or `Ctrl+Shift+I` (Windows/Linux) to open DevTools.

### Backend Logs

Backend stdout/stderr is forwarded to main process logs. Also check:
```bash
# If backend fails to start
./backend-dist/nirs4all-backend --port 8000
```

### IPC Debugging

Enable verbose IPC logging in development:
```typescript
ipcMain.handle('channel', async (event, ...args) => {
  console.log('IPC:', channel, args);
  // ...
});
```
