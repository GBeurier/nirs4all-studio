/* eslint-disable @typescript-eslint/no-require-imports */
// Use require for electron to avoid Rollup ESM/CJS interop issues
const electron = require("electron") as typeof import("electron");
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = electron;

import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { EnvManager } from "./env-manager";
import { initLogger, getLogFilePath, getLogDir } from "./logger";
import { NativeSidecarManager } from "./native-sidecar-manager";
import { startNativeSession } from "./native-session-lifecycle";
import { installNativeSessionAuth, isStudioDocument } from "./native-session-auth";
import { preselectRendererTransport } from "./renderer-transport-selection";
import { preselectWorkspaceRunDetail } from "./workspace-route-preselection";
import { applyPortablePathOverrides } from "./portable-paths";
import {
  getTelemetryConsentStatus,
  writeTelemetryConsent,
  type TelemetryConsentStatus,
} from "./telemetry-consent";

const portableLayout = applyPortablePathOverrides(app);

const SENTRY_DSN_DEFAULT =
  "https://64e47a03956ed609a0ec182af6fa517a@o4510941267951616.ingest.de.sentry.io/4510941353082960";
const SENTRY_DSN_FROM_ENV = process.env.SENTRY_DSN?.trim() || "";
type SentryMainModule = typeof import("@sentry/electron/main");
let SentryMain: SentryMainModule | null = null;

function resolveSentryDsn(consentStatus: TelemetryConsentStatus): string {
  return consentStatus === "accepted"
    ? SENTRY_DSN_FROM_ENV || SENTRY_DSN_DEFAULT
    : "";
}

function syncSentryEnvironment(consentStatus: TelemetryConsentStatus): string {
  const dsn = resolveSentryDsn(consentStatus);
  // Child processes inherit this. Empty string explicitly disables the Python SDK.
  process.env.SENTRY_DSN = dsn;
  return dsn;
}

function sanitizeSentryEvent(event: {
  user?: unknown;
  request?: Record<string, unknown>;
}): typeof event {
  delete event.user;

  if (event.request && typeof event.request === "object") {
    delete event.request.headers;
    delete event.request.cookies;
    delete event.request.data;
    delete event.request.query_string;
    const url = event.request.url;
    if (typeof url === "string") {
      event.request.url = url.split("?")[0].split("#")[0];
    }
  }

  return event;
}

function enableMainSentry(
  consentStatus: TelemetryConsentStatus = getTelemetryConsentStatus(app),
): void {
  const dsn = syncSentryEnvironment(consentStatus);
  if (!dsn || SentryMain) return;

  try {
    const Sentry =
      require("@sentry/electron/main") as typeof import("@sentry/electron/main");
    Sentry.init({
      dsn,
      release: `nirs4all-studio@${app.getVersion()}`,
      environment: process.env.NODE_ENV || "production",
      sendDefaultPii: false,
      beforeSend: sanitizeSentryEvent,
    });
    SentryMain = Sentry;
  } catch {
    // Sentry not available or failed to init — non-fatal
    SentryMain = null;
  }
}

function disableMainSentry(): void {
  syncSentryEnvironment("declined");
  if (!SentryMain) return;

  const current = SentryMain;
  SentryMain = null;
  void current.close(2000);
}

function applyTelemetryConsent(consentStatus: TelemetryConsentStatus): void {
  if (consentStatus === "accepted") {
    enableMainSentry(consentStatus);
  } else {
    disableMainSentry();
  }
}

applyTelemetryConsent(getTelemetryConsentStatus(app));

// WSL2/WSLg fixes - must be set before app is ready
if (process.platform === "linux" && process.env.WSL_DISTRO_NAME) {
  // Force X11 backend which has better cursor support in WSLg
  app.commandLine.appendSwitch("ozone-platform-hint", "x11");
}

// Disable Autofill CDP domain (not supported in Electron, causes DevTools errors)
app.commandLine.appendSwitch(
  "disable-features",
  "Autofill,AutofillServerCommunication",
);

// Initialize persistent file logging (writes to {userData}/logs/)
initLogger();
if (portableLayout) {
  console.log(`Portable mode state root: ${portableLayout.portableRoot}`);
}
if (SentryMain) console.log("Sentry crash reporting enabled (main process)");

const envManager = new EnvManager();
const nativeSidecarManager = new NativeSidecarManager();
let nativePythonPluginHostStale = false;
console.log("Rust-only renderer transport; Python is restricted to bounded stdio plugins");

function nativeSidecarStartOptions() {
  const configuredRuntime = envManager.getConfiguredRuntimeMode();
  const runtimeMode = configuredRuntime === "bundled"
    ? "bundled"
    : configuredRuntime === "none"
      ? (app.isPackaged ? "pyinstaller" : "development")
      : (app.isPackaged ? "managed" : "development");
  const runtimeKind = configuredRuntime === "none"
    ? (app.isPackaged ? "pyinstaller" : "development")
    : configuredRuntime;
  const resourceRoot = process.resourcesPath ?? process.cwd();
  const buildInfoCandidates = app.isPackaged
    ? [
        path.join(resourceRoot, "backend", "python-runtime", "build_info.json"),
        path.join(resourceRoot, "backend", "build_info.json"),
      ]
    : [path.join(process.cwd(), "backend-dist", "build_info.json")];

  return {
    allowPackagedResource: app.isPackaged,
    pythonPluginHost: envManager.getConfiguredPythonPath(),
    runtimeMode,
    runtimeKind,
    buildInfoPath: buildInfoCandidates.find((candidate) => fs.existsSync(candidate)) ?? null,
    appVersion: app.getVersion(),
  };
}

async function startNativeSidecar(): Promise<void> {
  const info = await nativeSidecarManager.start(nativeSidecarStartOptions());
  if (info.status === "running") {
    nativePythonPluginHostStale = false;
    console.log(
      `Native Studio sidecar ready at ${info.url} (${info.protocolVersion})`,
    );
    if (info.pythonPluginHostError) {
      console.error(
        `Bundled Python plugin host disabled: ${info.pythonPluginHostError}`,
      );
    }
    return;
  }
  if (app.isPackaged || info.status === "error") {
    throw new Error(
      info.error ?? "Packaged native Studio sidecar did not become ready",
    );
  }
}

function getNativeSidecarInfo() {
  const info = nativeSidecarManager.getInfo();
  return nativePythonPluginHostStale
    ? { ...info, pythonPluginHostConfigured: false }
    : info;
}

async function applyPythonRuntimeChange<T extends { success: boolean }>(
  change: () => Promise<T>,
): Promise<T> {
  const result = await change();
  if (result.success) {
    // The running sidecar was launched with the previous plugin-host path.
    // Mark that optional capability unavailable until the next app launch so
    // route selection happens before (not after) choosing the compatibility
    // plugin. Never restart the Rust control plane to rebind Python.
    nativePythonPluginHostStale = true;
  }
  return result;
}

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;

// The desktop app is single-window today. Prevent a second Electron process
// from racing the first one during startup and trying to launch another backend.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

app.on("second-instance", () => {
  const windowToFocus =
    mainWindow && !mainWindow.isDestroyed()
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
const STUDIO_ENTRYPOINT = VITE_DEV_SERVER_URL ?? pathToFileURL(path.join(DIST_PATH, "index.html")).href;

// Dev mode: Vite dev server OR --dev command-line flag
const isDev = VITE_DEV_SERVER_URL !== undefined;
const devMode = isDev || app.commandLine.hasSwitch("dev");

// --offline: forces offline mode for this process and the spawned Python backend.
// The env var is inherited by backend-manager's spawn calls (they splat process.env),
// so the Python side reads NIRS4ALL_OFFLINE via api/network_state.py.
if (
  app.commandLine.hasSwitch("offline") ||
  process.argv.includes("--offline")
) {
  process.env.NIRS4ALL_OFFLINE = "1";
  console.log("[main] --offline flag detected; forcing offline mode");
}

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
  const iconFileName =
    process.platform === "win32" ? "nirs4all.ico" : "nirs4all_icon.png";
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
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isStudioDocument(url, STUDIO_ENTRYPOINT)) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
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

ipcMain.handle("dialog:confirmDroppedFolder", async (_, folderName: string) => {
  if (!mainWindow) return null;
  // Show folder selection dialog to confirm the dropped folder
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title: `Select the folder "${folderName}" you just dropped`,
    message: `Please select the folder "${folderName}" to confirm its location`,
  });
  return result.canceled ? null : result.filePaths[0];
});

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
  },
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
  },
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

// IPC Handlers for telemetry consent
ipcMain.handle("telemetry:getConsent", () => {
  return getTelemetryConsentStatus(app);
});

ipcMain.handle("telemetry:setConsent", (_event, enabled: boolean) => {
  const status: Exclude<TelemetryConsentStatus, "unset"> = enabled
    ? "accepted"
    : "declined";
  const record = writeTelemetryConsent(app, status);
  applyTelemetryConsent(status);
  return { ...record, backendRestarted: false };
});

ipcMain.handle("sidecar:getInfo", () => {
  return getNativeSidecarInfo();
});

ipcMain.handle("sidecar:preselectRendererTransport", (_event, request: unknown) =>
  preselectRendererTransport(request, getNativeSidecarInfo, nativeSidecarManager.authenticatedFetch),
);

ipcMain.handle(
  "sidecar:preselectWorkspaceRunDetail",
  (_event, workspaceId: string) =>
    preselectWorkspaceRunDetail(workspaceId, getNativeSidecarInfo, nativeSidecarManager.authenticatedFetch),
);

ipcMain.handle("control:getInfo", () => {
  const info = getNativeSidecarInfo();
  return {
    ...info,
    role: "control-plane" as const,
    ready: info.status === "running",
  };
});

async function restartNativeBackend() {
  try {
    await nativeSidecarManager.stop();
    await startNativeSidecar();
    const info = getNativeSidecarInfo();
    return { success: true, port: info.port ?? undefined };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

ipcMain.handle("backend:restart", (_event, _options) =>
  restartNativeBackend());

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

ipcMain.handle("env:inspectExisting", async (_, envPath: string) => {
  return envManager.inspectExistingEnv(envPath);
});

ipcMain.handle("env:inspectExistingPython", async (_, pythonPath: string) => {
  return envManager.inspectExistingPython(pythonPath);
});

ipcMain.handle("env:useExisting", async (_, envPath: string) => {
  return applyPythonRuntimeChange(() => envManager.useExistingEnv(envPath));
});

ipcMain.handle("env:useExistingPython", async (_, pythonPath: string) => {
  return applyPythonRuntimeChange(() =>
    envManager.useExistingPython(pythonPath));
});

ipcMain.handle(
  "env:applyExisting",
  async (_, envPath: string, options?: { installCorePackages?: boolean }) => {
    return applyPythonRuntimeChange(() =>
      envManager.applyExistingEnv(envPath, options));
  },
);

ipcMain.handle(
  "env:applyExistingPython",
  async (
    _,
    pythonPath: string,
    options?: { installCorePackages?: boolean },
  ) => {
    return applyPythonRuntimeChange(() =>
      envManager.applyExistingPython(pythonPath, options));
  },
);

ipcMain.handle("dialog:selectPythonExe", async () => {
  if (!mainWindow) return null;
  const filters =
    process.platform === "win32"
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
    nativePythonPluginHostStale = true;

    // Runtime setup configures only the bounded CPython library/plugin host.
    console.log(
      "Python library/plugin host ready; restart the Rust sidecar to bind it",
    );

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

  // Authenticate HTTP and WebSocket handshakes in the main process. The
  // renderer receives neither the token nor a reusable credential-bearing URL.
  installNativeSessionAuth(electron.session.defaultSession, () => mainWindow,
    STUDIO_ENTRYPOINT, (url) => nativeSidecarManager.sessionHeaders(url));

  // Validate persisted runtime state before we decide whether startup can reuse
  // it. This clears stale custom/portable paths instead of failing later in a
  // less obvious backend-start step.
  envManager.validateConfiguredState();

  // Packaged products always start the Rust control plane. The default session
  // refuses every unmigrated renderer route. The
  // bounded CPython stdio host remains an optional sidecar dependency.
  console.log("Creating native session (renderer owner: Rust sidecar)");
  await startNativeSession({
    startControlPlane: startNativeSidecar,
    createWindow,
  });

  app.on("activate", () => {
    // macOS: re-create window when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}).catch((error) => {
  const detail = error instanceof Error ? error.message : String(error);
  console.error("Native Studio startup failed closed:", detail);
  dialog.showErrorBox(
    "nirs4all Studio could not start",
    `The packaged Rust backend did not pass readiness checks.\n\n${detail}`,
  );
  app.quit();
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
  Promise.allSettled([nativeSidecarManager.stop()]).finally(() => {
    app.quit(); // Re-enters before-quit with isQuitting=true, then proceeds
  });
  // Hard deadline: if stop() never resolves (stuck process, missing exit event),
  // force the quit after 5 seconds so the app doesn't hang indefinitely.
  setTimeout(() => {
    console.error(
      "before-quit: backend stop did not complete within 5 s, forcing quit",
    );
    app.exit(0);
  }, 5000);
});

// Safety net: force-exit after 2 seconds if pending async operations keep
// the event loop alive. Not unref'd so the timer actually fires.
app.on("will-quit", () => {
  setTimeout(() => process.exit(0), 2000);
});

// Note: uncaught exceptions and unhandled rejections are captured by electron/logger.ts
