/* eslint-disable @typescript-eslint/no-require-imports */
// Use require for electron to avoid Rollup ESM/CJS interop issues
const { contextBridge, ipcRenderer, webUtils } = require("electron") as typeof import("electron");

/**
 * Electron API exposed to the renderer process via contextBridge.
 * This provides a secure interface for the React app to access native features.
 */
const electronApi = {
  /**
   * File dialogs
   */
  selectFolder: (): Promise<string | null> =>
    ipcRenderer.invoke("dialog:selectFolder"),

  confirmDroppedFolder: (folderName: string): Promise<string | null> =>
    ipcRenderer.invoke("dialog:confirmDroppedFolder", folderName),

  selectFile: (
    fileTypes?: string[],
    allowMultiple?: boolean
  ): Promise<string | string[] | null> =>
    ipcRenderer.invoke("dialog:selectFile", fileTypes, allowMultiple),

  saveFile: (
    defaultFilename?: string,
    fileTypes?: string[]
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

  openLogDir: (): Promise<void> =>
    ipcRenderer.invoke("system:openLogDir"),

  /**
   * Backend management
   */
  getBackendPort: (): Promise<number> => ipcRenderer.invoke("backend:getPort"),

  getBackendUrl: (): Promise<string> => ipcRenderer.invoke("backend:getUrl"),

  getBackendInfo: (): Promise<{
    status: "stopped" | "starting" | "running" | "error" | "restarting" | "setup_required";
    port: number;
    url: string;
    error?: string;
    restartCount: number;
  }> => ipcRenderer.invoke("backend:getInfo"),

  restartBackend: (): Promise<{ success: boolean; port?: number; error?: string }> =>
    ipcRenderer.invoke("backend:restart"),

  onBackendStatusChanged: (
    callback: (info: {
      status: "stopped" | "starting" | "running" | "error" | "restarting" | "setup_required";
      port: number;
      url: string;
      error?: string;
      restartCount: number;
    }) => void
  ) => {
    const handler = (_event: Electron.IpcRendererEvent, info: unknown) =>
      callback(info as Parameters<typeof callback>[0]);
    ipcRenderer.on("backend:statusChanged", handler);
    // Return cleanup function
    return () => ipcRenderer.removeListener("backend:statusChanged", handler);
  },

  /** Check ML readiness status */
  getMlStatus: (): Promise<{
    ml_ready: boolean;
    ml_loading: boolean;
    ml_error: string | null;
    core_ready: boolean;
  }> => ipcRenderer.invoke("backend:getMlStatus"),

  /** Listen for ML ready notification */
  onMlReady: (callback: (info: { ready: boolean; error?: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, info: unknown) =>
      callback(info as Parameters<typeof callback>[0]);
    ipcRenderer.on("backend:mlReady", handler);
    return () => ipcRenderer.removeListener("backend:mlReady", handler);
  },

  /**
   * Python environment management
   */
  getEnvStatus: (): Promise<string> =>
    ipcRenderer.invoke("env:getStatus"),

  isEnvReady: (): Promise<boolean> =>
    ipcRenderer.invoke("env:isReady"),

  getEnvInfo: (): Promise<{
    status: string;
    envDir: string;
    pythonPath: string | null;
    sitePackages: string | null;
    pythonVersion: string | null;
    isCustom: boolean;
    error?: string;
  }> => ipcRenderer.invoke("env:getInfo"),

  detectExistingEnvs: (): Promise<Array<{
    path: string;
    pythonVersion: string;
    hasNirs4all: boolean;
  }>> => ipcRenderer.invoke("env:detectExisting"),

  useExistingEnv: (envPath: string): Promise<{
    success: boolean;
    message: string;
    info?: { path: string; pythonVersion: string; hasNirs4all: boolean };
  }> => ipcRenderer.invoke("env:useExisting", envPath),

  selectPythonExe: (): Promise<string | null> =>
    ipcRenderer.invoke("dialog:selectPythonExe"),

  useExistingPython: (pythonPath: string): Promise<{
    success: boolean;
    message: string;
    info?: { path: string; pythonVersion: string; hasNirs4all: boolean };
  }> => ipcRenderer.invoke("env:useExistingPython", pythonPath),

  startEnvSetup: (targetDir?: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("env:startSetup", targetDir),

  shouldShowWizard: (): Promise<boolean> =>
    ipcRenderer.invoke("env:shouldShowWizard"),

  markWizardComplete: (skipNextTime: boolean): Promise<void> =>
    ipcRenderer.invoke("env:markWizardComplete", skipNextTime),

  getCurrentEnvSummary: (): Promise<{
    pythonPath: string;
    envPath: string;
    version: string;
  } | null> => ipcRenderer.invoke("env:getCurrentEnvSummary"),

  isPortable: (): Promise<boolean> =>
    ipcRenderer.invoke("env:isPortable"),

  onEnvSetupProgress: (
    callback: (progress: { percent: number; step: string; detail: string }) => void
  ) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: unknown) =>
      callback(progress as Parameters<typeof callback>[0]);
    ipcRenderer.on("env:setupProgress", handler);
    return () => ipcRenderer.removeListener("env:setupProgress", handler);
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
