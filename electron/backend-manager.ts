import { spawn, ChildProcess } from "node:child_process";
import { createServer, AddressInfo } from "node:net";
import path from "node:path";
import type { EnvManager } from "./env-manager";

/* eslint-disable @typescript-eslint/no-require-imports */
// Use require for electron to avoid Rollup ESM/CJS interop issues
const electron = require("electron") as typeof import("electron");
const { BrowserWindow } = electron;

const HEALTH_CHECK_TIMEOUT = 30000; // 30 seconds (only waits for core_ready now, not ML)
const HEALTH_CHECK_INTERVAL = 500; // 500ms between retries
const HEALTH_MONITOR_INTERVAL = 10000; // 10 seconds between periodic health checks
const MAX_RESTART_ATTEMPTS = 3;
const RESTART_DELAY = 2000; // 2 seconds before restart attempt

export type BackendStatus = "stopped" | "starting" | "running" | "error" | "restarting" | "setup_required";

export interface BackendInfo {
  status: BackendStatus;
  port: number;
  url: string;
  error?: string;
  restartCount: number;
}

export class BackendManager {
  private process: ChildProcess | null = null;
  private port: number = 0;
  private status: BackendStatus = "stopped";
  private restartCount: number = 0;
  private healthMonitorInterval: NodeJS.Timeout | null = null;
  private isShuttingDown: boolean = false;
  private lastError: string | null = null;
  private envManager: EnvManager | null = null;
  /** When true, stop() kills only the backend process (no tree kill)
   *  so that child processes like the updater script survive. */
  private _quittingForUpdate: boolean = false;

  /** Set the env manager for Python path resolution */
  setEnvManager(envManager: EnvManager): void {
    this.envManager = envManager;
  }

  /** Signal that we're quitting for an update. stop() will kill only
   *  the backend process (no /t tree kill) so the updater script survives. */
  setQuittingForUpdate(): void {
    this._quittingForUpdate = true;
  }

  /**
   * Find an available port dynamically
   */
  private async findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer();
      server.listen(0, "127.0.0.1", () => {
        const address = server.address() as AddressInfo;
        const port = address.port;
        server.close((err) => {
          if (err) reject(err);
          else resolve(port);
        });
      });
      server.on("error", reject);
    });
  }

  /**
   * Get the path to the Python backend.
   * Priority order:
   *   1. Dev mode / forced venv: use ../.venv + uvicorn
   *   2. EnvManager: Python env downloaded/configured at runtime (user data dir)
   *   3. Standalone mode: PyInstaller executable in resources/backend/
   *   4. Fallback: dev venv (for local prod testing)
   */
  private getBackendPath(): { command: string; args: string[]; cwd?: string; env?: Record<string, string> } {
    const isDev = process.env.VITE_DEV_SERVER_URL !== undefined;
    const forceVenv = process.env.NIRS4ALL_USE_VENV === "true";

    // 1. Dev mode or forced venv: use the development .venv
    if (isDev || forceVenv) {
      return this.getDevBackendPath();
    }

    const fs = require("fs");
    const resourcesPath = process.resourcesPath;
    const backendDir = path.join(resourcesPath, "backend");

    // 2. EnvManager: Python runtime in user data directory
    //    The Python env is downloaded on first launch and stored in AppData.
    //    Uses the venv's Python directly (not base Python + PYTHONPATH) so that
    //    sys.prefix points to the venv and VenvManager's pip/install works correctly.
    if (this.envManager && this.envManager.isReady()) {
      const pythonPath = this.envManager.getPythonPath();

      if (pythonPath) {
        console.log("Using EnvManager Python backend (venv Python)");
        console.log(`  Python: ${pythonPath}`);
        return {
          command: pythonPath,
          args: [
            "-m",
            "uvicorn",
            "main:app",
            "--host",
            "127.0.0.1",
            "--port",
            this.port.toString(),
          ],
          cwd: backendDir,
        };
      }
    }

    // 3. Standalone mode: PyInstaller executable
    const execName =
      process.platform === "win32"
        ? "nirs4all-backend.exe"
        : "nirs4all-backend";
    const bundledBackendPath = path.join(backendDir, execName);

    if (fs.existsSync(bundledBackendPath)) {
      console.log("Using PyInstaller bundled backend");
      return {
        command: bundledBackendPath,
        args: ["--port", this.port.toString()],
      };
    }

    // 4. Fallback: dev venv (for local prod testing)
    console.log("Bundled backend not found, falling back to dev venv");
    return this.getDevBackendPath();
  }

  /**
   * Get backend path for development mode.
   * Uses the .venv relative to the webapp's parent directory.
   */
  private getDevBackendPath(): { command: string; args: string[]; cwd?: string; env?: Record<string, string> } {
    const venvPath = path.join(process.cwd(), "..", ".venv");
    const pythonPath =
      process.platform === "win32"
        ? path.join(venvPath, "Scripts", "python.exe")
        : path.join(venvPath, "bin", "python");

    return {
      command: pythonPath,
      args: [
        "-m",
        "uvicorn",
        "main:app",
        "--host",
        "127.0.0.1",
        "--port",
        this.port.toString(),
      ],
      cwd: process.cwd(),
    };
  }

  /**
   * Wait for the backend to respond to health checks.
   * Waits for core_ready (Phase 1) — FastAPI running, basic endpoints work.
   * ML dependencies load in the background (Phase 2) and are tracked separately.
   */
  private async waitForHealthCheck(): Promise<void> {
    const startTime = Date.now();
    const url = `http://127.0.0.1:${this.port}/api/health`;

    while (Date.now() - startTime < HEALTH_CHECK_TIMEOUT) {
      try {
        const response = await fetch(url, { method: "GET" });
        if (response.ok) {
          const data = await response.json() as {
            ready?: boolean;
            core_ready?: boolean;
            ml_ready?: boolean;
          };
          // Phase 1: show window as soon as core is ready
          if (data.core_ready || data.ready) {
            console.log(`Backend core ready (ml_ready: ${data.ml_ready ?? "unknown"})`);
            return;
          }
          // Server is up but startup event hasn't finished — keep polling
          console.log("Backend responding but not yet ready, waiting...");
        }
      } catch {
        // Ignore connection errors during startup
      }
      await new Promise((resolve) => setTimeout(resolve, HEALTH_CHECK_INTERVAL));
    }

    throw new Error(
      `Backend did not respond within ${HEALTH_CHECK_TIMEOUT / 1000} seconds`
    );
  }

  /**
   * Poll for ML readiness and notify renderer when ready.
   * Called non-blocking after startInternal() succeeds.
   */
  private async pollMlReadiness(): Promise<void> {
    const url = `http://127.0.0.1:${this.port}/api/system/readiness`;
    const pollInterval = 1000;
    const maxWait = 120000; // 2 minutes
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      if (this.isShuttingDown) return;

      try {
        const response = await fetch(url, {
          method: "GET",
          signal: AbortSignal.timeout(5000),
        });
        if (response.ok) {
          const data = await response.json() as { ml_ready?: boolean };
          if (data.ml_ready) {
            console.log("ML dependencies loaded, notifying renderer");
            this.notifyMlReady(true);
            return;
          }
        }
      } catch {
        // Ignore errors, keep polling
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    console.warn("ML readiness polling timed out after 2 minutes");
    this.notifyMlReady(false, "ML loading timed out");
  }

  /**
   * Notify renderer windows of ML readiness state change
   */
  private notifyMlReady(ready: boolean, error?: string): void {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      win.webContents.send("backend:mlReady", { ready, error });
    }
  }

  /**
   * Start the Python backend (blocking — waits for health check).
   * @returns The port number the backend is running on
   */
  async start(): Promise<number> {
    if (this.process) {
      console.warn("Backend already running");
      return this.port;
    }

    this.isShuttingDown = false;
    this.restartCount = 0;
    this.lastError = null;
    this.status = "starting";
    this.notifyRenderer();

    // Find a free port
    this.port = await this.findFreePort();

    try {
      await this.startInternal();
      return this.port;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.status = "error";
      this.notifyRenderer();
      throw error;
    }
  }

  /**
   * Start the Python backend non-blocking — spawns the process and returns
   * immediately. The health check runs in the background and updates status
   * via IPC when ready.
   * @returns The port number allocated for the backend
   */
  async startNonBlocking(): Promise<number> {
    if (this.process) {
      console.warn("Backend already running");
      return this.port;
    }

    this.isShuttingDown = false;
    this.restartCount = 0;
    this.lastError = null;
    this.status = "starting";
    this.notifyRenderer();

    // Find a free port (fast, ~10ms)
    this.port = await this.findFreePort();

    // Spawn the process and run health check in background
    this.startInternalNonBlocking();

    return this.port;
  }

  /**
   * Spawn the backend process and monitor health in background.
   * Does not block — health check completion is signaled via IPC.
   */
  private startInternalNonBlocking(): void {
    console.log(`Starting backend on port ${this.port} (non-blocking)...`);

    const { command, args, cwd, env: extraEnv } = this.getBackendPath();

    console.log(`Executing: ${command} ${args.join(" ")}`);
    if (cwd) console.log(`Working directory: ${cwd}`);

    const pythonPath = this.envManager?.getPythonPath() || "";
    const env = {
      ...process.env,
      NIRS4ALL_PORT: this.port.toString(),
      NIRS4ALL_DESKTOP: "true",
      NIRS4ALL_ELECTRON: "true",
      NIRS4ALL_APP_DIR: path.dirname(process.execPath),
      NIRS4ALL_APP_EXE: path.basename(process.execPath),
      NIRS4ALL_EXPECTED_PYTHON: pythonPath,
      // Portable mode: electron-builder sets PORTABLE_EXECUTABLE_FILE
      ...(process.env.PORTABLE_EXECUTABLE_FILE
        ? { NIRS4ALL_PORTABLE_EXE: process.env.PORTABLE_EXECUTABLE_FILE }
        : {}),
      ...extraEnv,
    };

    this.process = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    this.process.stdout?.on("data", (data: Buffer) => {
      console.log(`[Backend] ${data.toString().trim()}`);
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      console.error(`[Backend Error] ${data.toString().trim()}`);
    });

    this.process.on("exit", (code, signal) => {
      console.log(`Backend exited with code ${code}, signal ${signal}`);
      const wasRunning = this.status === "running";
      this.process = null;

      if (wasRunning && !this.isShuttingDown) {
        this.status = "error";
        this.notifyRenderer();
      }
    });

    this.process.on("error", (error) => {
      console.error("Backend process error:", error);
      this.lastError = error.message;
      this.process = null;
      this.status = "error";
      this.notifyRenderer();
    });

    // Run health check in background — don't block
    this.waitForHealthCheck()
      .then(() => {
        this.status = "running";
        this.notifyRenderer();
        this.startHealthMonitor();
        this.pollMlReadiness();
        console.log("Backend is ready (health check passed)");
      })
      .catch((error) => {
        this.lastError = error instanceof Error ? error.message : String(error);
        this.status = "error";
        this.notifyRenderer();
        console.error("Backend health check failed:", error);
      });
  }

  /**
   * Internal method to start the backend process
   * Used by both start() and restart logic
   */
  private async startInternal(): Promise<void> {
    console.log(`Starting backend on port ${this.port}...`);

    const { command, args, cwd, env: extraEnv } = this.getBackendPath();

    console.log(`Executing: ${command} ${args.join(" ")}`);
    if (cwd) console.log(`Working directory: ${cwd}`);

    // Set environment variables
    const pythonPathForEnv = this.envManager?.getPythonPath() || "";
    const env = {
      ...process.env,
      NIRS4ALL_PORT: this.port.toString(),
      NIRS4ALL_DESKTOP: "true",
      NIRS4ALL_ELECTRON: "true",
      NIRS4ALL_APP_DIR: path.dirname(process.execPath),
      NIRS4ALL_APP_EXE: path.basename(process.execPath),
      NIRS4ALL_EXPECTED_PYTHON: pythonPathForEnv,
      // Portable mode: electron-builder sets PORTABLE_EXECUTABLE_FILE
      ...(process.env.PORTABLE_EXECUTABLE_FILE
        ? { NIRS4ALL_PORTABLE_EXE: process.env.PORTABLE_EXECUTABLE_FILE }
        : {}),
      ...extraEnv,
    };

    // Spawn the backend process
    this.process = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    // Log stdout
    this.process.stdout?.on("data", (data: Buffer) => {
      console.log(`[Backend] ${data.toString().trim()}`);
    });

    // Log stderr
    this.process.stderr?.on("data", (data: Buffer) => {
      console.error(`[Backend Error] ${data.toString().trim()}`);
    });

    // Handle process exit
    this.process.on("exit", (code, signal) => {
      console.log(`Backend exited with code ${code}, signal ${signal}`);
      const wasRunning = this.status === "running";
      this.process = null;

      // Only trigger crash handling if we were running and not shutting down
      if (wasRunning && !this.isShuttingDown) {
        this.status = "error";
        this.notifyRenderer();
        // Crash handling is done via health monitor
      }
    });

    this.process.on("error", (error) => {
      console.error("Backend process error:", error);
      this.lastError = error.message;
      this.process = null;
      this.status = "error";
      this.notifyRenderer();
    });

    // Wait for the backend to be ready
    await this.waitForHealthCheck();

    // Successfully started
    this.status = "running";
    this.notifyRenderer();

    // Start health monitoring
    this.startHealthMonitor();

    // Start polling for ML readiness in background (non-blocking)
    this.pollMlReadiness();
  }

  /**
   * Stop the Python backend gracefully
   */
  async stop(): Promise<void> {
    this.isShuttingDown = true;
    this.stopHealthMonitor();

    if (!this.process) {
      this.status = "stopped";
      return;
    }

    console.log("Stopping backend...");

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        // Force kill if graceful shutdown takes too long
        console.warn("Backend did not stop gracefully, force killing...");
        this.process?.kill("SIGKILL");
        this.process = null;
        this.status = "stopped";
        this.notifyRenderer();
        resolve();
      }, 5000);

      this.process!.once("exit", () => {
        clearTimeout(timeout);
        this.process = null;
        this.status = "stopped";
        this.notifyRenderer();
        console.log("Backend stopped");
        resolve();
      });

      // Terminate the backend process
      if (process.platform === "win32") {
        // Use /f (force) because console apps don't handle WM_CLOSE from
        // plain taskkill, causing a 5-second hang until the timeout fires.
        // When quitting for update, skip /t (tree kill) so the updater
        // script (a child of the backend) survives to apply the update.
        const args = this._quittingForUpdate
          ? ["/pid", this.process!.pid!.toString(), "/f"]
          : ["/pid", this.process!.pid!.toString(), "/t", "/f"];
        spawn("taskkill", args);
      } else {
        this.process!.kill("SIGTERM");
      }
    });
  }

  /**
   * Restart the backend
   */
  async restart(): Promise<number> {
    await this.stop();
    this.isShuttingDown = false;
    this.restartCount = 0;
    return this.start();
  }

  /**
   * Get the port the backend is running on
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Check if the backend is running
   */
  isRunning(): boolean {
    return this.process !== null && this.status === "running";
  }

  /**
   * Get the backend URL
   */
  getUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /**
   * Get full backend information
   */
  getInfo(): BackendInfo {
    return {
      status: this.status,
      port: this.port,
      url: this.getUrl(),
      error: this.lastError ?? undefined,
      restartCount: this.restartCount,
    };
  }

  /**
   * Start periodic health monitoring
   */
  private startHealthMonitor(): void {
    if (this.healthMonitorInterval) {
      clearInterval(this.healthMonitorInterval);
    }

    this.healthMonitorInterval = setInterval(async () => {
      if (this.isShuttingDown || this.status !== "running") {
        return;
      }

      try {
        const response = await fetch(`http://127.0.0.1:${this.port}/api/health`, {
          method: "GET",
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) {
          throw new Error(`Health check failed with status ${response.status}`);
        }
      } catch (error) {
        console.error("Health check failed:", error);
        // Backend might have crashed, attempt restart
        if (!this.isShuttingDown && this.restartCount < MAX_RESTART_ATTEMPTS) {
          await this.handleCrash();
        }
      }
    }, HEALTH_MONITOR_INTERVAL);
  }

  /**
   * Stop the health monitor
   */
  private stopHealthMonitor(): void {
    if (this.healthMonitorInterval) {
      clearInterval(this.healthMonitorInterval);
      this.healthMonitorInterval = null;
    }
  }

  /**
   * Handle a backend crash - attempt to restart
   */
  private async handleCrash(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    console.log(`Backend crashed, attempting restart (${this.restartCount + 1}/${MAX_RESTART_ATTEMPTS})...`);
    this.status = "restarting";
    this.restartCount++;
    this.notifyRenderer();

    // Clean up the old process
    if (this.process) {
      this.process.removeAllListeners();
      this.process = null;
    }

    // Wait before restarting
    await new Promise((resolve) => setTimeout(resolve, RESTART_DELAY));

    try {
      await this.startInternal();
      console.log("Backend restarted successfully");
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.status = "error";
      this.notifyRenderer();
      console.error("Failed to restart backend:", error);
    }
  }

  /**
   * Notify renderer windows of status change
   */
  private notifyRenderer(): void {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      win.webContents.send("backend:statusChanged", this.getInfo());
    }
  }
}
