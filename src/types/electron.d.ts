/**
 * Electron API type declarations
 * These types enable TypeScript support for the Electron desktop integration
 */

/** Backend status types */
type BackendStatus = "stopped" | "starting" | "running" | "error" | "restarting" | "setup_required";

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
   * Confirm a dropped folder by opening a folder dialog
   * Used when drag-drop doesn't provide the folder path
   * @param folderName - The name of the dropped folder
   * @returns The selected folder path or null if cancelled
   */
  confirmDroppedFolder(folderName: string): Promise<string | null>;

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
   * Get the current log file path
   */
  getLogPath(): Promise<string | null>;

  /**
   * Open the log directory in the system file explorer
   */
  openLogDir(): Promise<void>;

  /**
   * Resize the window to specified dimensions
   */
  resizeWindow(width: number, height: number): Promise<boolean>;

  /**
   * Minimize the window
   */
  minimizeWindow(): Promise<boolean>;

  /**
   * Toggle maximize/restore the window
   */
  maximizeWindow(): Promise<boolean>;

  /**
   * Restore the window from minimized state
   */
  restoreWindow(): Promise<boolean>;

  /**
   * Get current window size
   */
  getWindowSize(): Promise<{ width: number; height: number } | null>;

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
   * Python environment management
   */
  getEnvStatus(): Promise<string>;
  isEnvReady(): Promise<boolean>;
  getEnvInfo(): Promise<{
    status: string;
    envDir: string;
    pythonPath: string | null;
    sitePackages: string | null;
    pythonVersion: string | null;
    isCustom: boolean;
    error?: string;
  }>;
  detectExistingEnvs(): Promise<Array<{
    path: string;
    pythonVersion: string;
    hasNirs4all: boolean;
  }>>;
  useExistingEnv(envPath: string): Promise<{
    success: boolean;
    message: string;
    info?: { path: string; pythonVersion: string; hasNirs4all: boolean };
  }>;
  /**
   * Open a file dialog to select a Python executable directly
   */
  selectPythonExe(): Promise<string | null>;
  /**
   * Configure using a direct path to a Python executable
   */
  useExistingPython(pythonPath: string): Promise<{
    success: boolean;
    message: string;
    info?: { path: string; pythonVersion: string; hasNirs4all: boolean };
  }>;
  startEnvSetup(): Promise<{ success: boolean; error?: string }>;
  onEnvSetupProgress(callback: (progress: {
    percent: number;
    step: string;
    detail: string;
  }) => void): () => void;

  /**
   * The current platform (darwin, win32, linux)
   */
  platform: NodeJS.Platform;

  /**
   * Flag indicating this is running in Electron
   */
  isElectron: true;

  /**
   * Get the filesystem path for a dropped File object
   * Uses Electron's webUtils API to resolve the real path
   * Works for both files and folders
   */
  getPathForFile(file: File): string;
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
