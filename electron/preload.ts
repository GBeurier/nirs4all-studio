/* eslint-disable @typescript-eslint/no-require-imports */
// Use require for electron to avoid Rollup ESM/CJS interop issues
const { contextBridge, ipcRenderer, webUtils } =
  require("electron") as typeof import("electron");

import type { InstallLogSnapshot } from "../src/types/installLog";
import type { PythonEnvApi, PythonEnvState } from "../src/types/pythonEnvironment";

/**
 * Electron API exposed to the renderer process via contextBridge.
 * This provides a secure interface for the React app to access native features.
 */
const electronApi = {
  getDefaultWorkspaceLocation: (): Promise<string> =>
    ipcRenderer.invoke("workspace:defaultLocation"),
  /**
   * File dialogs
   */
  selectFolder: (): Promise<string | null> =>
    ipcRenderer.invoke("dialog:selectFolder"),

  confirmDroppedFolder: (folderName: string): Promise<string | null> =>
    ipcRenderer.invoke("dialog:confirmDroppedFolder", folderName),

  selectFile: (
    fileTypes?: string[],
    allowMultiple?: boolean,
  ): Promise<string | string[] | null> =>
    ipcRenderer.invoke("dialog:selectFile", fileTypes, allowMultiple),

  saveFile: (
    defaultFilename?: string,
    fileTypes?: string[],
  ): Promise<string | null> =>
    ipcRenderer.invoke("dialog:saveFile", defaultFilename, fileTypes),

  /**
   * System operations
   */
  revealInExplorer: (filePath: string): Promise<void> =>
    ipcRenderer.invoke("system:revealInExplorer", filePath),

  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke("system:openExternal", url),

  getLogPath: (): Promise<string | null> =>
    ipcRenderer.invoke("system:getLogPath"),

  openLogDir: (): Promise<void> => ipcRenderer.invoke("system:openLogDir"),

  /**
   * Telemetry consent
   */
  getTelemetryConsent: (): Promise<"accepted" | "declined" | "unset"> =>
    ipcRenderer.invoke("telemetry:getConsent"),

  setTelemetryConsent: (
    enabled: boolean,
  ): Promise<{
    status: "accepted" | "declined";
    decidedAt: string;
    backendRestarted?: boolean;
  }> => ipcRenderer.invoke("telemetry:setConsent", enabled),

  getNativeSidecarInfo: (): Promise<{
    status: "disabled" | "starting" | "running" | "stopped" | "error";
    host: string | null;
    port: number | null;
    protocolVersion: string | null;
    url: string | null;
    pythonPluginHostConfigured: boolean;
    error?: string;
  }> => ipcRenderer.invoke("sidecar:getInfo"),

  preselectRendererTransport: (request:
    | { kind: "http"; method: string; path: string }
    | { kind: "websocket"; path: string },
  ): Promise<{
    schema_id: "nirs4all.studio-renderer-transport-selection-decision.v1";
    kind: "http" | "websocket";
    method: string | null;
    path: string;
    surface: string;
    target: "native-sidecar" | "reject";
    base_url: string | null;
    renderer_transport: boolean;
    scientific_execution: false;
    reason: string;
    fallback_after_native_selection: "none";
    status: number;
  }> => ipcRenderer.invoke("sidecar:preselectRendererTransport", request),

  preselectWorkspaceRunDetail: (
    workspaceId: string,
  ): Promise<{
    schema_id: "nirs4all.studio-run-detail-preselection-decision.v1";
    workspace_id: string;
    target: "native-sidecar" | "reject";
    verified_store_v5: boolean;
    store_schema_version: 5 | null;
    reason: string;
    fallback_after_native_selection: "none";
    status: number;
  }> => ipcRenderer.invoke("sidecar:preselectWorkspaceRunDetail", workspaceId),

  getControlPlaneInfo: (): Promise<{
    role: "control-plane";
    ready: boolean;
    status: "disabled" | "starting" | "running" | "stopped" | "error";
    host: string | null;
    port: number | null;
    protocolVersion: string | null;
    url: string | null;
    pythonPluginHostConfigured: boolean;
    error?: string;
  }> => ipcRenderer.invoke("control:getInfo"),

  restartBackend: (): Promise<{ success: boolean; port?: number; error?: string }> =>
    ipcRenderer.invoke("backend:restart"),

  /**
   * Python environment (contract: src/types/pythonEnvironment.ts)
   */
  pythonEnv: {
    getState: () => ipcRenderer.invoke("pythonEnv:getState"),
    detect: (refresh) => ipcRenderer.invoke("pythonEnv:detect", refresh),
    inspect: (path) => ipcRenderer.invoke("pythonEnv:inspect", path),
    describeNewEnvironment: () => ipcRenderer.invoke("pythonEnv:describeNewEnvironment"),
    browse: () => ipcRenderer.invoke("pythonEnv:browse"),
    chooseDirectory: () => ipcRenderer.invoke("pythonEnv:chooseDirectory"),
    apply: (request) => ipcRenderer.invoke("pythonEnv:apply", request),
    create: (request) => ipcRenderer.invoke("pythonEnv:create", request),
    installPackages: (packages) => ipcRenderer.invoke("pythonEnv:installPackages", packages),
    retry: () => ipcRenderer.invoke("pythonEnv:retry"),
    onState: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, state: PythonEnvState) => handler(state);
      ipcRenderer.on("pythonEnv:state", listener);
      return () => { ipcRenderer.removeListener("pythonEnv:state", listener); };
    },
  } satisfies PythonEnvApi,

  /** Output of the running or last package installation. */
  getInstallLog: (): Promise<InstallLogSnapshot> => ipcRenderer.invoke("env:getInstallLog"),
  onInstallLog: (callback: (snapshot: InstallLogSnapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: InstallLogSnapshot) => callback(snapshot);
    ipcRenderer.on("env:installLog", handler);
    return () => ipcRenderer.removeListener("env:installLog", handler);
  },

  /**
   * Window management
   */
  resizeWindow: (width: number, height: number): Promise<boolean> =>
    ipcRenderer.invoke("window:resize", width, height),

  minimizeWindow: (): Promise<boolean> => ipcRenderer.invoke("window:minimize"),

  maximizeWindow: (): Promise<boolean> => ipcRenderer.invoke("window:maximize"),

  restoreWindow: (): Promise<boolean> => ipcRenderer.invoke("window:restore"),

  getWindowSize: (): Promise<{ width: number; height: number } | null> =>
    ipcRenderer.invoke("window:getSize"),

  /**
   * App lifecycle
   */
  quitForUpdate: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("app:quitForUpdate"),

  /**
   * Platform info
   */
  platform: process.platform,
  isElectron: true,

  /**
   * Get the filesystem path for a dropped File object
   * Uses Electron's webUtils API to resolve the real path
   */
  getPathForFile: (file: File): string => {
    return webUtils.getPathForFile(file);
  },
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld("electronApi", electronApi);

// Type declaration for the exposed API
export type ElectronApi = typeof electronApi;
