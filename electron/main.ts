/* eslint-disable @typescript-eslint/no-require-imports */
// Use require for electron to avoid Rollup ESM/CJS interop issues
const electron = require("electron") as typeof import("electron");
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = electron;

import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import type { BrowserWindow as BrowserWindowInstance } from "electron";
import type { ErrorEvent as SentryErrorEvent } from "@sentry/electron/main";
import type {
  ApplyPythonEnvRequest,
  CreatePythonEnvRequest,
  PythonEnvState,
} from "../src/types/pythonEnvironment";
import { EnvManager } from "./env-manager";
import { loadNetworkTrust } from "./env/external-config";
import { getInstallLog, subscribeInstallLog } from "./env/install-log";
import { confirmScientificHost, describeActiveRuns as describeSidecarRuns } from "./env/scientific-host";
import { resolveStudioAdaptersDir } from "./env/studio-adapters";
import { initLogger, getLogFilePath, getLogDir } from "./logger";
import { ensureDesktopWorkspace } from "./default-workspace";
import { resolveDocumentsDirectory } from "./workspace-location";
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

loadNetworkTrust().configureSystemTrust();
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

function sanitizeSentryEvent(event: SentryErrorEvent): SentryErrorEvent {
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

const envManager = new EnvManager({
  userDataDir: app.getPath("userData"),
  restartHost: restartScientificHost,
  stopHost: stopScientificHost,
  describeActiveRuns,
});
const nativeSidecarManager = new NativeSidecarManager();
let nativePythonPluginHostStale = false;
/** Incremented at every sidecar restart, so that a check of an earlier sidecar is ignored. */
let sidecarGeneration = 0;
console.log("Rust-only renderer transport; Python is restricted to bounded stdio plugins");

/** Studio's document adapters; without them the sidecar reports why the host is unavailable. */
function studioAdaptersDir(): string | null {
  try {
    return resolveStudioAdaptersDir({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      cacheDir: path.join(app.getPath("userData"), "studio-adapters"),
    });
  } catch (error) {
    console.error("Studio document adapters are unavailable:", error);
    return null;
  }
}

function nativeSidecarStartOptions() {
  const host = envManager.getHost();
  const buildInfoPath = app.isPackaged
    ? path.join(process.resourcesPath, "backend", "build_info.json")
    : path.join(process.cwd(), "backend-dist", "build_info.json");
  return {
    allowPackagedResource: app.isPackaged,
    pythonPluginHost: host?.pythonPath ?? null,
    pythonPluginSitePackages: host?.sitePackages ?? null,
    studioAdaptersDir: host ? studioAdaptersDir() : null,
    buildInfoPath: fs.existsSync(buildInfoPath) ? buildInfoPath : null,
    appVersion: app.getVersion(),
  };
}

/** Start the Rust sidecar on the selected environment, or without Python when none is usable. */
async function startNativeSidecar(): Promise<void> {
  const info = await nativeSidecarManager.start(nativeSidecarStartOptions());
  if (info.status === "running") {
    if (info.url) {
      await ensureDesktopWorkspace(info.url, resolveDocumentsDirectory(name => app.getPath(name)), nativeSidecarManager.authenticatedFetch);
    }
    nativePythonPluginHostStale = false;
    console.log(
      `Native Studio sidecar ready at ${info.url} (${info.protocolVersion})`,
    );
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

/** Confirm that the running sidecar loaded the scientific library from `expectedPython`. */
async function confirmHostRuns(expectedPython: string): Promise<void> {
  const { url } = nativeSidecarManager.getInfo();
  if (!url) throw new Error("The analysis backend could not be started.");
  await confirmScientificHost(url, expectedPython, nativeSidecarManager.authenticatedFetch);
}

/**
 * Stop a sidecar that runs a Python environment, before packages are installed
 * into that environment. A sidecar without Python holds none of its files.
 */
async function stopScientificHost(): Promise<boolean> {
  if (!nativeSidecarManager.getInfo().pythonPluginHostConfigured || nativeSidecarManager.getInfo().status !== "running") return false;
  sidecarGeneration += 1;
  nativePythonPluginHostStale = true;
  await nativeSidecarManager.stop();
  return true;
}

/** The runs a restart of the sidecar would interrupt, or null. */
async function describeActiveRuns(): Promise<string | null> {
  const info = nativeSidecarManager.getInfo();
  return info.status === "running" && info.url
    ? describeSidecarRuns(info.url, nativeSidecarManager.authenticatedFetch)
    : null;
}

/**
 * Restart the sidecar on the environment manager's current selection and
 * confirm it. The environment manager restores the previous selection and
 * calls this again when it rejects.
 */
async function restartScientificHost(): Promise<void> {
  sidecarGeneration += 1;
  nativePythonPluginHostStale = true;
  await nativeSidecarManager.stop();
  await startNativeSidecar();
  const host = envManager.getHost();
  if (host) await confirmHostRuns(host.pythonPath);
}

let mainWindow: BrowserWindowInstance | null = null;
let splashWindow: BrowserWindowInstance | null = null;

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

// --offline: forces offline mode for this process and the sidecar, which
// inherits the variable.
if (
  app.commandLine.hasSwitch("offline") ||
  process.argv.includes("--offline")
) {
  process.env.NIRS4ALL_OFFLINE = "1";
  console.log("[main] --offline flag detected; forcing offline mode");
}

function createSplashWindow(): BrowserWindowInstance {
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

  // Authenticate requests in the actual renderer session before loadFile or
  // loadURL. The renderer never receives the sidecar session credential.
  installNativeSessionAuth(mainWindow.webContents.session, () => mainWindow,
    STUDIO_ENTRYPOINT, (url) => nativeSidecarManager.sessionHeaders(url));

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
ipcMain.handle("workspace:defaultLocation", () => path.join(resolveDocumentsDirectory(name => app.getPath(name)), "nirs4all Studio"));

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

ipcMain.handle("backend:restart", async () => {
  const result = await envManager.restartBackend();
  const { port } = getNativeSidecarInfo();
  return result.success
    ? { success: true, port: port ?? undefined }
    : { success: false, error: result.message };
});

// The install log is shared by every environment operation.
ipcMain.handle("env:getInstallLog", () => getInstallLog());
subscribeInstallLog((snapshot) => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("env:installLog", snapshot);
  }
});

// IPC handlers of the Python environment contract (src/types/pythonEnvironment.ts).
function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string`);
  return value;
}

function requirePackageNames(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((name) => typeof name === "string")) {
    throw new Error("packages must be a list of package names");
  }
  return value as string[];
}

/** One plain line on the splash while a startup operation runs; the renderer gets every state. */
function publishPythonEnvState(state: PythonEnvState): void {
  if (state.activity && splashWindow && !splashWindow.isDestroyed()) {
    void splashWindow.webContents
      .executeJavaScript(`window.showStartupProgress(${JSON.stringify(state.activity.detail)})`)
      .catch(() => undefined);
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("pythonEnv:state", state);
}
envManager.onStateChange(publishPythonEnvState);

ipcMain.handle("pythonEnv:getState", () => envManager.getState());

ipcMain.handle("pythonEnv:detect", (_event, refresh?: unknown) => envManager.detect(refresh === true));

ipcMain.handle("pythonEnv:inspect", (_event, target: unknown) =>
  envManager.inspect(requireString(target, "path")));

ipcMain.handle("pythonEnv:describeNewEnvironment", () => envManager.describeNewEnvironment());

ipcMain.handle("pythonEnv:browse", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select Python executable",
    properties: ["openFile"],
    filters: process.platform === "win32"
      ? [{ name: "Python Executable", extensions: ["exe"] }]
      : [{ name: "All Files", extensions: ["*"] }],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("pythonEnv:chooseDirectory", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose where to create the Python environment",
    properties: ["openDirectory", "createDirectory"],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("pythonEnv:apply", (_event, request: Partial<ApplyPythonEnvRequest> | null) =>
  envManager.apply({
    pythonPath: requireString(request?.pythonPath, "pythonPath"),
    packages: requirePackageNames(request?.packages),
  }));

ipcMain.handle("pythonEnv:create", async (_event, request: Partial<CreatePythonEnvRequest> | null) => {
  const result = await envManager.create({
    ...(request?.directory === undefined ? {} : { directory: requireString(request.directory, "directory") }),
    packages: requirePackageNames(request?.packages),
  });
  if (!result.success) SentryMain?.captureException(new Error(result.message), { tags: { component: "env-setup" } });
  return result;
});

ipcMain.handle("pythonEnv:installPackages", (_event, packages: unknown) =>
  envManager.installPackages(requirePackageNames(packages)));

ipcMain.handle("pythonEnv:retry", () => envManager.retry());

/**
 * Startup: settle the Python environment (installing required packages when
 * needed), start the sidecar on it, then confirm the host in the background so
 * that the window is not delayed by the scientific library's cold start.
 */
async function startControlPlane(): Promise<void> {
  await envManager.startupCheck();
  await startNativeSidecar();
  const host = envManager.getHost();
  if (host) {
    const generation = sidecarGeneration;
    void confirmHostRuns(host.pythonPath).catch((error) => {
      // A sidecar restarted meanwhile is confirmed by the operation that restarted it.
      if (generation !== sidecarGeneration) return;
      envManager.reportHostFailure(error instanceof Error ? error.message : String(error));
    });
  }
}

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

  // Packaged products always start the Rust control plane. The default session
  // refuses every unmigrated renderer route. The
  // bounded CPython stdio host remains an optional sidecar dependency.
  console.log("Creating native session (renderer owner: Rust sidecar)");
  await startNativeSession({
    startControlPlane,
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
