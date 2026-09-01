/**
 * Electron API type declarations
 * These types enable TypeScript support for the Electron desktop integration
 */

import type {
  DesktopDetectedEnv,
  DesktopEnvActionResult,
} from "@/types/pythonRuntime";

/** Backend status types */
type BackendStatus =
  | "stopped"
  | "starting"
  | "running"
  | "error"
  | "restarting"
  | "setup_required";

interface BackendInfo {
  status: BackendStatus;
  port: number;
  url: string;
  error?: string;
  restartCount: number;
  httpMode?: "rust-only" | "python-http-diagnostic";
  activationSource?: "default" | "explicit-cli" | "explicit-dev-env";
}

interface BackendRestartResult {
  success: boolean;
  port?: number;
  error?: string;
}

interface BackendRestartOptions {
  skipEnsure?: boolean;
}

interface NativeSidecarInfo {
  status: "disabled" | "starting" | "running" | "stopped" | "error";
  host: string | null;
  port: number | null;
  protocolVersion: string | null;
  url: string | null;
  pythonPluginHostConfigured: boolean;
  error?: string;
}

interface WorkspaceRunDetailPreselection {
  schema_id: "nirs4all.studio-run-detail-preselection-decision.v1";
  workspace_id: string;
  target: "native-sidecar" | "scientific-plugin" | "reject";
  verified_store_v5: boolean;
  store_schema_version: 5 | null;
  reason: string;
  fallback_after_native_selection: "none";
  status: number;
}

type RendererTransportRequest =
  | { kind: "http"; method: string; path: string }
  | { kind: "websocket"; path: string };

interface RendererTransportSelection {
  schema_id: "nirs4all.studio-renderer-transport-selection-decision.v1";
  kind: "http" | "websocket";
  method: string | null;
  path: string;
  surface: string;
  target: "native-sidecar" | "scientific-plugin" | "reject";
  base_url: string | null;
  renderer_transport: boolean;
  scientific_execution: false;
  reason: string;
  fallback_after_native_selection: "none";
  status: number;
}

interface ControlPlaneInfo extends NativeSidecarInfo {
  role: "control-plane";
  ready: boolean;
}

interface ScientificPluginInfo {
  role: "scientific-plugin";
  status: BackendStatus;
  ready: boolean;
  requested: boolean;
  port: number | null;
  url: string | null;
  error?: string;
  restartCount: number;
  httpMode?: "rust-only" | "python-http-diagnostic";
  activationSource?: "default" | "explicit-cli" | "explicit-dev-env";
}

interface ScientificReadiness {
  scientific_status: string;
  scientific_requested: boolean;
  python_http_mode?: "rust-only" | "python-http-diagnostic";
  core_ready: boolean;
  ml_ready: boolean;
  ml_loading: boolean;
  ml_error: string | null;
  workspace_ready?: boolean;
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
    allowMultiple?: boolean,
  ): Promise<string | string[] | null>;

  /**
   * Open a native save file dialog
   * @param defaultFilename - Default filename suggestion
   * @param fileTypes - Optional array of file extensions to filter
   * @returns The selected save path or null if cancelled
   */
  saveFile(
    defaultFilename?: string,
    fileTypes?: string[],
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
   * Read the persisted telemetry/crash-reporting consent.
   */
  getTelemetryConsent(): Promise<"accepted" | "declined" | "unset">;

  /**
   * Persist telemetry/crash-reporting consent.
   */
  setTelemetryConsent(enabled: boolean): Promise<{
    status: "accepted" | "declined";
    decidedAt: string;
    backendRestarted?: boolean;
  }>;

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

  /** Get the transitional port in explicit Python HTTP diagnostic mode. */
  getBackendPort(): Promise<number>;

  /** Get the transitional URL in explicit Python HTTP diagnostic mode. */
  getBackendUrl(): Promise<string>;

  /**
   * Get full backend information including status
   */
  getBackendInfo(): Promise<BackendInfo>;

  /** Get the explicit native-sidecar diagnostic state. */
  getNativeSidecarInfo(): Promise<NativeSidecarInfo>;

  /** Select a renderer HTTP/WS transport before acquiring either runtime. */
  preselectRendererTransport(
    request: RendererTransportRequest,
  ): Promise<RendererTransportSelection>;

  /** Select one linked-workspace run-detail target before its HTTP request. */
  preselectWorkspaceRunDetail(
    workspaceId: string,
  ): Promise<WorkspaceRunDetailPreselection>;

  /** Read the mandatory Rust control-plane state without starting Python. */
  getControlPlaneInfo(): Promise<ControlPlaneInfo>;

  /** Inspect the optional scientific/FastAPI plugin without activating it. */
  getScientificPluginInfo(): Promise<ScientificPluginInfo>;

  /** Acquire FastAPI only after explicit process-wide diagnostic activation. */
  getScientificPluginUrl(): Promise<string>;

  /** Inspect scientific readiness without activating the plugin. */
  getScientificReadiness(): Promise<ScientificReadiness>;

  /**
   * Restart the backend server
   */
  restartBackend(
    options?: BackendRestartOptions,
  ): Promise<BackendRestartResult>;

  restartScientificPlugin(
    options?: BackendRestartOptions,
  ): Promise<BackendRestartResult>;

  /**
   * Subscribe to backend status changes
   * @param callback - Called when backend status changes
   * @returns Cleanup function to unsubscribe
   */
  onBackendStatusChanged(callback: (info: BackendInfo) => void): () => void;

  onScientificPluginStatusChanged(
    callback: (info: BackendInfo) => void,
  ): () => void;

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
  detectExistingEnvs(): Promise<DesktopDetectedEnv[]>;
  inspectExistingEnv(envPath: string): Promise<DesktopEnvActionResult>;
  useExistingEnv(envPath: string): Promise<DesktopEnvActionResult>;
  /**
   * Open a file dialog to select a Python executable directly
   */
  selectPythonExe(): Promise<string | null>;
  /**
   * Configure using a direct path to a Python executable
   */
  inspectExistingPython(pythonPath: string): Promise<DesktopEnvActionResult>;
  useExistingPython(pythonPath: string): Promise<DesktopEnvActionResult>;
  applyExistingEnv(
    envPath: string,
    options?: { installCorePackages?: boolean },
  ): Promise<DesktopEnvActionResult>;
  applyExistingPython(
    pythonPath: string,
    options?: { installCorePackages?: boolean },
  ): Promise<DesktopEnvActionResult>;
  startEnvSetup(
    targetDir?: string,
  ): Promise<{ success: boolean; error?: string }>;
  onEnvSetupProgress(
    callback: (progress: {
      percent: number;
      step: string;
      detail: string;
    }) => void,
  ): () => void;
  /**
   * Check if the setup wizard should be shown (new install, update, or portable mode)
   */
  shouldShowWizard(): Promise<boolean>;
  /**
   * Mark the setup wizard as completed and save preferences
   * @param skipNextTime - If true, suppresses wizard on subsequent launches (portable mode)
   */
  markWizardComplete(skipNextTime: boolean): Promise<void>;
  /**
   * Get summary of the currently configured Python environment (for pre-filling the wizard)
   */
  getCurrentEnvSummary(): Promise<{
    pythonPath: string;
    envPath: string;
    version: string;
  } | null>;
  /**
   * Check if the app is running as a portable (non-installed) build
   */
  isPortable(): Promise<boolean>;

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
