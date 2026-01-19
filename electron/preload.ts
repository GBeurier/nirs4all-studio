/* eslint-disable @typescript-eslint/no-require-imports */
// Use require for electron to avoid Rollup ESM/CJS interop issues
const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");

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

  /**
   * Backend management
   */
  getBackendPort: (): Promise<number> => ipcRenderer.invoke("backend:getPort"),

  getBackendUrl: (): Promise<string> => ipcRenderer.invoke("backend:getUrl"),

  getBackendInfo: (): Promise<{
    status: "stopped" | "starting" | "running" | "error" | "restarting";
    port: number;
    url: string;
    error?: string;
    restartCount: number;
  }> => ipcRenderer.invoke("backend:getInfo"),

  restartBackend: (): Promise<{ success: boolean; port?: number; error?: string }> =>
    ipcRenderer.invoke("backend:restart"),

  onBackendStatusChanged: (
    callback: (info: {
      status: "stopped" | "starting" | "running" | "error" | "restarting";
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

  /**
   * Platform info
   */
  platform: process.platform,
  isElectron: true,
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld("electronApi", electronApi);

// Type declaration for the exposed API
export type ElectronApi = typeof electronApi;
