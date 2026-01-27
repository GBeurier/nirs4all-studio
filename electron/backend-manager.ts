import { spawn, ChildProcess } from "node:child_process";
import { createServer, AddressInfo } from "node:net";
import path from "node:path";

/* eslint-disable @typescript-eslint/no-require-imports */
// Use require for electron to avoid Rollup ESM/CJS interop issues
const electron = require("electron") as typeof import("electron");
const { BrowserWindow } = electron;

const HEALTH_CHECK_TIMEOUT = 30000; // 30 seconds
const HEALTH_CHECK_INTERVAL = 500; // 500ms between retries
const HEALTH_MONITOR_INTERVAL = 10000; // 10 seconds between periodic health checks
const MAX_RESTART_ATTEMPTS = 3;
const RESTART_DELAY = 2000; // 2 seconds before restart attempt

export type BackendStatus = "stopped" | "starting" | "running" | "error" | "restarting";

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
   * Get the path to the Python backend executable
   * In dev: uses uvicorn directly
   * In production: uses PyInstaller-bundled executable
   * Fallback: if bundled backend not found, use venv (for local prod testing)
   */
  private getBackendPath(): { command: string; args: string[]; cwd?: string } {
    const isDev = process.env.VITE_DEV_SERVER_URL !== undefined;
    const forceVenv = process.env.NIRS4ALL_USE_VENV === "true";

    // Check if bundled backend exists (production build)
    const resourcesPath = process.resourcesPath;
    const backendDir = path.join(resourcesPath, "backend");
    const execName =
      process.platform === "win32"
        ? "nirs4all-backend.exe"
        : "nirs4all-backend";
    const bundledBackendPath = path.join(backendDir, execName);

    const fs = require("fs");
    const hasBundledBackend = fs.existsSync(bundledBackendPath);

    // Use venv if: dev mode, forced, or bundled backend not available
    const useVenv = isDev || forceVenv || !hasBundledBackend;

    if (useVenv) {
      if (!isDev && !forceVenv && !hasBundledBackend) {
        console.log("Bundled backend not found, falling back to venv");
      }
      // Development/fallback mode: run uvicorn with Python
      // The venv is at ../.venv relative to the webapp directory
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
        cwd: process.cwd(), // Need cwd for uvicorn to find main.py
      };
    } else {
      // Production mode: use packaged backend
      return {
        command: bundledBackendPath,
        args: ["--port", this.port.toString()],
      };
    }
  }

  /**
   * Wait for the backend to respond to health checks
   */
  private async waitForHealthCheck(): Promise<void> {
    const startTime = Date.now();
    const url = `http://127.0.0.1:${this.port}/api/health`;

    while (Date.now() - startTime < HEALTH_CHECK_TIMEOUT) {
      try {
        const response = await fetch(url, { method: "GET" });
        if (response.ok) {
          console.log("Backend health check passed");
          return;
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
   * Start the Python backend
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
   * Internal method to start the backend process
   * Used by both start() and restart logic
   */
  private async startInternal(): Promise<void> {
    console.log(`Starting backend on port ${this.port}...`);

    const { command, args, cwd } = this.getBackendPath();

    console.log(`Executing: ${command} ${args.join(" ")}`);
    if (cwd) console.log(`Working directory: ${cwd}`);

    // Set environment variables
    const env = {
      ...process.env,
      NIRS4ALL_PORT: this.port.toString(),
      NIRS4ALL_DESKTOP: "true",
      NIRS4ALL_ELECTRON: "true",
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

      // Send SIGTERM for graceful shutdown
      if (process.platform === "win32") {
        // Windows doesn't support SIGTERM, use taskkill
        spawn("taskkill", ["/pid", this.process!.pid!.toString(), "/t"]);
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
