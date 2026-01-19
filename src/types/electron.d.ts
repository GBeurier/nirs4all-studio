/**
 * Electron API type declarations
 * These types enable TypeScript support for the Electron desktop integration
 */

/** Backend status types */
type BackendStatus = "stopped" | "starting" | "running" | "error" | "restarting";

interface BackendInfo {
  status: BackendStatus;
  port: number;
  url: string;
  error?: string;
  restartCount: number;
}

interface BackendRestartResult {
  success: boolean;
  port?: number;
  error?: string;
}

interface ElectronApi {
  /**
   * Open a native folder picker dialog
   * @returns The selected folder path or null if cancelled
   */
  selectFolder(): Promise<string | null>;

  /**
   * Open a native file picker dialog
   * @param fileTypes - Optional array of file extensions to filter (e.g., ['.csv', '.xlsx'])
   * @param allowMultiple - Whether to allow selecting multiple files
   * @returns The selected file path(s) or null if cancelled
   */
  selectFile(
    fileTypes?: string[],
    allowMultiple?: boolean
  ): Promise<string | string[] | null>;

  /**
   * Open a native save file dialog
   * @param defaultFilename - Default filename suggestion
   * @param fileTypes - Optional array of file extensions to filter
   * @returns The selected save path or null if cancelled
   */
  saveFile(
    defaultFilename?: string,
    fileTypes?: string[]
  ): Promise<string | null>;

  /**
   * Open a file or folder in the system file explorer
   */
  revealInExplorer(filePath: string): Promise<void>;

  /**
   * Open a URL in the system default browser
   */
  openExternal(url: string): Promise<void>;

  /**
   * Get the port the backend is running on
   */
  getBackendPort(): Promise<number>;

  /**
   * Get the full backend URL (e.g., http://127.0.0.1:8000)
   */
  getBackendUrl(): Promise<string>;

  /**
   * Get full backend information including status
   */
  getBackendInfo(): Promise<BackendInfo>;

  /**
   * Restart the backend server
   */
  restartBackend(): Promise<BackendRestartResult>;

  /**
   * Subscribe to backend status changes
   * @param callback - Called when backend status changes
   * @returns Cleanup function to unsubscribe
   */
  onBackendStatusChanged(callback: (info: BackendInfo) => void): () => void;

  /**
   * The current platform (darwin, win32, linux)
   */
  platform: NodeJS.Platform;

  /**
   * Flag indicating this is running in Electron
   */
  isElectron: true;
}

declare global {
  interface Window {
    /**
     * Electron API object available when running in Electron desktop mode
     * Will be undefined when running in browser/development mode
     */
    electronApi?: ElectronApi;
  }
}

export {};
