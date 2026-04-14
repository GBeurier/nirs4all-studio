/* eslint-disable @typescript-eslint/no-require-imports */
// Use require for electron to avoid Rollup ESM/CJS interop issues
const electron = require("electron") as typeof import("electron");
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = electron;

import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { BackendManager } from "./backend-manager";
import { EnvManager } from "./env-manager";
import { initLogger, getLogFilePath, getLogDir } from "./logger";
import { applyPortablePathOverrides } from "./portable-paths";

const portableLayout = applyPortablePathOverrides(app);

// Initialize Sentry crash reporting (must be as early as possible).
const SENTRY_DSN_DEFAULT = "https://64e47a03956ed609a0ec182af6fa517a@o4510941267951616.ingest.de.sentry.io/4510941353082960";
const SentryMain = (() => {
  try {
    const dsn = process.env.SENTRY_DSN || SENTRY_DSN_DEFAULT;
    // Propagate DSN to child processes (Python backend) via environment
    if (!process.env.SENTRY_DSN) process.env.SENTRY_DSN = dsn;
    const Sentry = require("@sentry/electron/main") as typeof import("@sentry/electron/main");
    Sentry.init({
      dsn,
      release: `nirs4all-studio@${app.getVersion()}`,
      environment: process.env.NODE_ENV || "production",
    });
    return Sentry;
  } catch {
    // Sentry not available or failed to init — non-fatal
    return null;
  }
})();

// WSL2/WSLg fixes - must be set before app is ready
if (process.platform === "linux" && process.env.WSL_DISTRO_NAME) {
  // Force X11 backend which has better cursor support in WSLg
  app.commandLine.appendSwitch("ozone-platform-hint", "x11");
}

// Disable Autofill CDP domain (not supported in Electron, causes DevTools errors)
app.commandLine.appendSwitch("disable-features", "Autofill,AutofillServerCommunication");

// Initialize persistent file logging (writes to {userData}/logs/)
initLogger();
if (portableLayout) {
  console.log(`Portable mode state root: ${portableLayout.portableRoot}`);
}
if (SentryMain) console.log("Sentry crash reporting enabled (main process)");

const envManager = new EnvManager();
const backendManager = new BackendManager();
backendManager.setEnvManager(envManager);

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;

// The desktop app is single-window today. Prevent a second Electron process
// from racing the first one during startup and trying to launch another backend.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

app.on("second-instance", () => {
  const windowToFocus = mainWindow && !mainWindow.isDestroyed()
    ? mainWindow
    : splashWindow && !splashWindow.isDestroyed()
      ? splashWindow
      : null;

  if (!windowToFocus) {
    return;
  }

  if (windowToFocus.isMinimized()) {
    windowToFocus.restore();
  }
  windowToFocus.focus();
});

// VITE_DEV_SERVER_URL is set by vite-plugin-electron in dev mode
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const DIST_PATH = path.join(__dirname, "../dist");

// Dev mode: Vite dev server OR --dev command-line flag
const isDev = VITE_DEV_SERVER_URL !== undefined;
const devMode = isDev || app.commandLine.hasSwitch("dev");

function createSplashWindow(): BrowserWindow {
  const splash = new BrowserWindow({
    width: 460,
    height: 420,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    center: true,
    backgroundColor: "#ffffff",
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  // In dev, logo is at ../public/; in prod build, copied to dist-electron/
  const logoFile = isDev
    ? path.join(__dirname, "..", "public", "nirs4all_logo.png")
    : path.join(__dirname, "nirs4all_logo.png");
  const logoUrl = pathToFileURL(logoFile).href;
  splash.loadFile(path.join(__dirname, "splash.html"), {
    query: { logo: logoUrl },
  });
  return splash;
}

function closeSplash(): void {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
  }
  splashWindow = null;
}

function getMainWindowIconPath(): string {
  const iconFileName = process.platform === "win32" ? "nirs4all.ico" : "nirs4all_logo.png";
  return isDev
    ? path.join(__dirname, "..", "public", iconFileName)
    : path.join(__dirname, iconFileName);
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      // Sandbox enabled: the preload exposes webUtils.getPathForFile() via
      // contextBridge, which is the Electron-recommended API for resolving
      // drag-and-drop file paths and works correctly with sandbox enabled.
      // contextIsolation + nodeIntegration:false remain enabled so the
      // renderer has no direct Node access; all privileged operations go
      // through the validated IPC handlers below.
      sandbox: true,
    },
    icon: getMainWindowIconPath(),
    show: false, // Show after ready-to-show
  });

  // Show main window and close splash when ready
  mainWindow.once("ready-to-show", () => {
    closeSplash();
    mainWindow?.show();
  });

  // Load the app
  if (VITE_DEV_SERVER_URL) {
    // Development mode: load from Vite dev server
    await mainWindow.loadURL(VITE_DEV_SERVER_URL);
    if (devMode) mainWindow.webContents.openDevTools();
  } else {
    // Production mode: load built files
    await mainWindow.loadFile(path.join(DIST_PATH, "index.html"));
    if (devMode) mainWindow.webContents.openDevTools();
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// IPC Handler for update-triggered app quit
// After apply_webapp_update launches the updater script (which waits for our PID
// to die), we quit so it can proceed with the file copy and relaunch.
ipcMain.handle("app:quitForUpdate", () => {
  console.log("Quitting for update — updater script will relaunch the app");
  // Tell backend manager to skip tree-kill so the updater script survives
  backendManager.setQuittingForUpdate();
  // Small delay so the IPC response reaches the renderer before we exit
  setTimeout(() => app.quit(), 500);
  // Hard deadline: if the normal quit flow gets stuck (before-quit handler,
  // backend stop, window close), force-exit so the updater script can proceed.
  setTimeout(() => {
    console.error("Force exiting — normal quit did not complete within 10 s");
    process.exit(0);
  }, 10_000);
  return { success: true };
});

// IPC Handlers for file dialogs
ipcMain.handle("dialog:selectFolder", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle(
  "dialog:confirmDroppedFolder",
  async (_, folderName: string) => {
    if (!mainWindow) return null;
    // Show folder selection dialog to confirm the dropped folder
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
      title: `Select the folder "${folderName}" you just dropped`,
      message: `Please select the folder "${folderName}" to confirm its location`,
    });
    return result.canceled ? null : result.filePaths[0];
  }
);

ipcMain.handle(
  "dialog:selectFile",
  async (_, fileTypes?: string[], allowMultiple?: boolean) => {
    if (!mainWindow) return null;

    const filters =
      fileTypes && fileTypes.length > 0
        ? [
            {
              name: "Allowed Files",
              extensions: fileTypes.map((t) => t.replace(/^\./, "")),
            },
          ]
        : [];

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: allowMultiple
        ? ["openFile", "multiSelections"]
        : ["openFile"],
      filters,
    });

    if (result.canceled) return null;
    return allowMultiple ? result.filePaths : result.filePaths[0];
  }
);

ipcMain.handle(
  "dialog:saveFile",
  async (_, defaultFilename?: string, fileTypes?: string[]) => {
    if (!mainWindow) return null;

    const filters =
      fileTypes && fileTypes.length > 0
        ? [
            {
              name: "Save As",
              extensions: fileTypes.map((t) => t.replace(/^\./, "")),
            },
          ]
        : [];

    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultFilename,
      filters,
    });

    return result.canceled ? null : result.filePath;
  }
);

// IPC Handlers for system operations
const ALLOWED_EXTERNAL_PROTOCOLS = ["https:", "http:", "mailto:"];

ipcMain.handle("system:revealInExplorer", async (_, filePath: string) => {
  if (typeof filePath !== "string" || filePath.trim() === "") return;
  // Normalize and resolve to an absolute path to prevent traversal attacks
  const resolved = path.resolve(filePath);
  // Verify the path actually exists on disk before revealing
  if (!fs.existsSync(resolved)) return;
  shell.showItemInFolder(resolved);
});

ipcMain.handle("system:openExternal", async (_, url: string) => {
  if (typeof url !== "string") return;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return; // Reject malformed URLs
  }
  if (!ALLOWED_EXTERNAL_PROTOCOLS.includes(parsed.protocol)) return;
  await shell.openExternal(url);
});

// IPC Handlers for window management
ipcMain.handle("window:resize", (_, width: number, height: number) => {
  mainWindow?.setSize(width, height);
  return true;
});

ipcMain.handle("window:minimize", () => {
  mainWindow?.minimize();
  return true;
});

ipcMain.handle("window:maximize", () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
  return true;
});

ipcMain.handle("window:restore", () => {
  mainWindow?.restore();
  return true;
});

ipcMain.handle("window:getSize", () => {
  if (!mainWindow) return null;
  const [width, height] = mainWindow.getSize();
  return { width, height };
});

// IPC Handlers for log access
ipcMain.handle("system:getLogPath", () => getLogFilePath());
ipcMain.handle("system:getLogDir", () => getLogDir());
ipcMain.handle("system:openLogDir", () => {
  const dir = getLogDir();
  if (dir && fs.existsSync(dir)) shell.openPath(dir);
});

// IPC Handlers for backend management
ipcMain.handle("backend:getPort", () => {
  return backendManager.getPort();
});

ipcMain.handle("backend:getUrl", () => {
  return backendManager.getUrl();
});

ipcMain.handle("backend:getInfo", () => {
  return backendManager.getInfo();
});

ipcMain.handle("backend:restart", async () => {
  try {
    await envManager.ensureBackendPackages();
    const port = await backendManager.restart();
    return { success: true, port };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

ipcMain.handle("backend:getMlStatus", async () => {
  try {
    const response = await fetch(
      `${backendManager.getUrl()}/api/system/readiness`,
      { signal: AbortSignal.timeout(3000) }
    );
    if (response.ok) {
      return response.json();
    }
    return {
      core_ready: false,
      ml_ready: false,
      ml_loading: true,
      ml_error: null,
      workspace_ready: false,
    };
  } catch {
    return {
      core_ready: false,
      ml_ready: false,
      ml_loading: true,
      ml_error: null,
      workspace_ready: false,
    };
  }
});

// IPC Handlers for Python environment management
ipcMain.handle("env:getStatus", () => {
  return envManager.getStatus();
});

ipcMain.handle("env:isReady", () => {
  return envManager.isReady();
});

ipcMain.handle("env:getInfo", async () => {
  return envManager.getInfo();
});

ipcMain.handle("env:detectExisting", async () => {
  return envManager.detectExistingEnvs();
});

ipcMain.handle("env:useExisting", async (_, envPath: string) => {
  return envManager.useExistingEnv(envPath);
});

ipcMain.handle("env:useExistingPython", async (_, pythonPath: string) => {
  return envManager.useExistingPython(pythonPath);
});

ipcMain.handle("dialog:selectPythonExe", async () => {
  if (!mainWindow) return null;
  const filters = process.platform === "win32"
    ? [{ name: "Python Executable", extensions: ["exe"] }]
    : [{ name: "All Files", extensions: ["*"] }];
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select Python executable",
    properties: ["openFile"],
    filters,
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("env:shouldShowWizard", () => {
  return envManager.shouldShowWizard();
});

ipcMain.handle("env:markWizardComplete", (_, skipNextTime: boolean) => {
  envManager.markWizardComplete(skipNextTime);
});

ipcMain.handle("env:getCurrentEnvSummary", async () => {
  return envManager.getCurrentEnvSummary();
});

ipcMain.handle("env:isPortable", () => {
  return envManager.isPortable();
});

ipcMain.handle("env:startSetup", async (_, targetDir?: string) => {
  try {
    await envManager.setup((percent, step, detail) => {
      // Broadcast progress to all renderer windows
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        win.webContents.send("env:setupProgress", { percent, step, detail });
      }
    }, targetDir);

    // Python env is ready — restart the backend to pick up the new environment.
    // Always use restart(): stop() is a no-op when no process exists, and it
    // correctly handles stuck starting/error states that start() would skip.
    console.log("Python environment ready, starting backend...");
    const port = await backendManager.restart();
    console.log(`Backend started on port ${port}`);

    return { success: true };
  } catch (error) {
    SentryMain?.captureException(error, { tags: { component: "env-setup" } });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

// App lifecycle
app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) {
    return;
  }

  // Remove application menu in production mode (keep it for dev/debug)
  if (!devMode) {
    Menu.setApplicationMenu(null);
  }

  // Show splash screen immediately (gives visual feedback during startup)
  splashWindow = createSplashWindow();

  // Validate persisted runtime state before we decide whether startup can reuse
  // it. This clears stale custom/portable paths instead of failing later in a
  // less obvious backend-start step.
  envManager.validateConfiguredState();

  if (isDev) {
    // Dev mode: start backend non-blocking, show window immediately
    try {
      const port = await backendManager.startNonBlocking();
      console.log(`Backend spawned on port ${port} (health check in background)`);
    } catch (error) {
      console.error("Failed to spawn backend:", error);
    }
    await createWindow();
  } else if (envManager.isReady()) {
    // Python env exists. We deliberately do NOT block window creation on
    // ensureBackendPackages() any more — that path can spawn Python and import
    // heavy modules, which used to delay the first paint. Instead:
    //   1. spawn the backend non-blocking (it has its own health check loop)
    //   2. open the window immediately
    //   3. run ensureBackendPackages() in the background as a repair step
    //
    // The blocking ensure path is still used by explicit setup/restart flows
    // (see ipcMain.handle("backend:restart") and env:startSetup).
    try {
      const backendStart = Date.now();
      const port = await backendManager.startNonBlocking();
      console.log(`Backend spawned on port ${port} (health check in background) in ${Date.now() - backendStart}ms`);
    } catch (error) {
      console.error("Failed to spawn backend:", error);
    }
    const windowStart = Date.now();
    console.log("createWindow: start");
    await createWindow();
    console.log(`createWindow: done in ${Date.now() - windowStart}ms`);

    // Background repair: if a stale managed env is missing core packages,
    // reinstall them without holding up the UI. Failures are logged; the
    // backend health check will surface a connection error to the renderer
    // if the repair was actually required.
    void (async () => {
      const ensureStart = Date.now();
      console.log("ensureBackendPackages: start (background)");
      try {
        const repaired = await envManager.ensureBackendPackages({ timeoutMs: 90_000 });
        console.log(`ensureBackendPackages: done in ${Date.now() - ensureStart}ms`);
        if (repaired) {
          console.log("ensureBackendPackages: repaired runtime, restarting backend");
          const restartStart = Date.now();
          const port = await backendManager.restart();
          console.log(`Backend restarted on port ${port} in ${Date.now() - restartStart}ms`);
        }
      } catch (error) {
        console.error(
          `ensureBackendPackages failed after ${Date.now() - ensureStart}ms:`,
          error,
        );
      }
    })();
  } else {
    // No Python env: show window immediately (it will display the setup screen)
    console.log("Python environment not found, showing setup screen...");
    await createWindow();
  }

  app.on("activate", () => {
    // macOS: re-create window when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  // Quit on all platforms except macOS
  if (process.platform !== "darwin") {
    app.quit();
  }
});

let isQuitting = false;

app.on("before-quit", (event) => {
  if (isQuitting) return; // Re-entry after stop() completes — let quit proceed
  isQuitting = true;
  event.preventDefault();
  // Await backend stop before allowing quit — prevents Electron exiting
  // before taskkill runs. stop() has a 2s force-kill timeout as safety net.
  backendManager.stop().finally(() => {
    app.quit(); // Re-enters before-quit with isQuitting=true, then proceeds
  });
  // Hard deadline: if stop() never resolves (stuck process, missing exit event),
  // force the quit after 5 seconds so the app doesn't hang indefinitely.
  setTimeout(() => {
    console.error("before-quit: backend stop did not complete within 5 s, forcing quit");
    app.exit(0);
  }, 5000);
});

// Safety net: force-exit after 2 seconds if pending async operations keep
// the event loop alive. Not unref'd so the timer actually fires.
app.on("will-quit", () => {
  setTimeout(() => process.exit(0), 2000);
});

// Note: uncaught exceptions and unhandled rejections are captured by electron/logger.ts
