import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SIDECAR_PATH_ENV = "NIRS4ALL_NATIVE_SIDECAR_PATH";
const SIDECAR_PORT_ENV = "NIRS4ALL_NATIVE_SIDECAR_PORT";
const SIDECAR_ENABLE_PACKAGED_ENV = "NIRS4ALL_ENABLE_NATIVE_SIDECAR";
const PYTHON_PLUGIN_HOST_ENV = "NIRS4ALL_PYTHON_PLUGIN_HOST";
const SIDECAR_READY_PREFIX = "STUDIO_SIDECAR_READY ";
const SIDECAR_START_TIMEOUT_MS = 15_000;
const MAX_STARTUP_OUTPUT_BYTES = 8 * 1024;
const electronProcess = process as NodeJS.Process & { resourcesPath?: string };

export type NativeSidecarStatus = "disabled" | "starting" | "running" | "stopped" | "error";

export interface NativeSidecarInfo {
  status: NativeSidecarStatus;
  host: string | null;
  port: number | null;
  protocolVersion: string | null;
  url: string | null;
  error?: string;
}

interface SidecarReadyLine {
  protocol_version: unknown;
  host: unknown;
  port: unknown;
}

export interface NativeSidecarPathOptions {
  environment?: NodeJS.ProcessEnv;
  resourcesPath?: string;
  platform?: NodeJS.Platform;
}

/**
 * Resolve the explicit developer override first, then the packaged resource
 * only when the dual-run flag is set.  The sidecar is never auto-selected as
 * the HTTP backend merely because a binary was bundled with the application.
 */
export function resolveNativeSidecarPath({
  environment = process.env,
  resourcesPath = electronProcess.resourcesPath,
  platform = process.platform,
}: NativeSidecarPathOptions = {}): string | null {
  const explicitPath = environment[SIDECAR_PATH_ENV]?.trim();
  if (explicitPath) return path.resolve(explicitPath);
  if (environment[SIDECAR_ENABLE_PACKAGED_ENV] !== "1" || !resourcesPath) return null;

  return path.join(resourcesPath, "backend", "native", platform === "win32" ? "studio-sidecar.exe" : "studio-sidecar");
}

/** Resolve an embedded interpreter without treating it as an HTTP backend. */
export function resolveBundledPythonPluginHost({
  resourcesPath = electronProcess.resourcesPath,
  platform = process.platform,
}: Omit<NativeSidecarPathOptions, "environment"> = {}): string | null {
  if (!resourcesPath) return null;
  const runtimeRoot = path.join(resourcesPath, "backend", "python-runtime");
  const candidates = platform === "win32"
    ? [
        path.join(runtimeRoot, "python", "python.exe"),
        path.join(runtimeRoot, "venv", "Scripts", "python.exe"),
      ]
    : [
        path.join(runtimeRoot, "python", "bin", "python3"),
        path.join(runtimeRoot, "python", "bin", "python"),
        path.join(runtimeRoot, "venv", "bin", "python"),
      ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

/**
 * Launches the native Studio sidecar only when an explicit binary path is
 * configured. It deliberately has no Python fallback and does not replace the
 * current FastAPI backend yet: R1/R2 can exercise both processes side by side
 * while route migration proceeds.
 */
export class NativeSidecarManager {
  private process: ChildProcess | null = null;
  private status: NativeSidecarStatus = "disabled";
  private host: string | null = null;
  private port: number | null = null;
  private protocolVersion: string | null = null;
  private lastError: string | null = null;

  getInfo(): NativeSidecarInfo {
    return {
      status: this.status,
      host: this.host,
      port: this.port,
      protocolVersion: this.protocolVersion,
      url: this.host !== null && this.port !== null ? `http://${this.host}:${this.port}` : null,
      ...(this.lastError ? { error: this.lastError } : {}),
    };
  }

  async start(): Promise<NativeSidecarInfo> {
    const configuredPath = resolveNativeSidecarPath();
    if (!configuredPath) {
      if (process.env[SIDECAR_ENABLE_PACKAGED_ENV] === "1") {
        return this.failBeforeSpawn("Native sidecar was enabled but Electron has no packaged resources path");
      }
      this.status = "disabled";
      this.host = null;
      this.port = null;
      this.protocolVersion = null;
      this.lastError = null;
      return this.getInfo();
    }
    if (this.process) {
      return this.getInfo();
    }

    const binaryPath = configuredPath;
    if (!fs.existsSync(binaryPath)) {
      return this.failBeforeSpawn(`${SIDECAR_PATH_ENV} does not exist: ${binaryPath}`);
    }

    const configuredPort = process.env[SIDECAR_PORT_ENV]?.trim() || "0";
    if (!/^\d+$/.test(configuredPort)) {
      return this.failBeforeSpawn(`Invalid ${SIDECAR_PORT_ENV} value: ${configuredPort}`);
    }
    const port = Number.parseInt(configuredPort, 10);
    if (port > 65_535) return this.failBeforeSpawn(`Invalid ${SIDECAR_PORT_ENV} value: ${configuredPort}`);

    this.status = "starting";
    this.lastError = null;
    this.host = null;
    this.port = null;
    this.protocolVersion = null;

    let child: ChildProcess;
    const pythonPluginHost = process.env[PYTHON_PLUGIN_HOST_ENV]?.trim() || resolveBundledPythonPluginHost();
    const childEnvironment: NodeJS.ProcessEnv = { ...process.env };
    if (pythonPluginHost) childEnvironment[PYTHON_PLUGIN_HOST_ENV] = pythonPluginHost;
    try {
      child = spawn(binaryPath, ["--host", "127.0.0.1", "--port", port.toString()], {
        env: childEnvironment,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      const startupError = error instanceof Error ? error : new Error(String(error));
      this.lastError = startupError.message;
      this.status = "error";
      throw startupError;
    }
    this.process = child;

    return new Promise<NativeSidecarInfo>((resolve, reject) => {
      let settled = false;
      let stdout = "";

      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) {
          this.lastError = error.message;
          this.status = "error";
          this.process = null;
          child.kill("SIGTERM");
          reject(error);
          return;
        }
        this.status = "running";
        resolve(this.getInfo());
      };

      const timeout = setTimeout(() => {
        finish(new Error(`Native sidecar did not report readiness within ${SIDECAR_START_TIMEOUT_MS}ms`));
      }, SIDECAR_START_TIMEOUT_MS);

      child.stdout?.on("data", (chunk: Buffer) => {
        if (settled) return;
        stdout += chunk.toString("utf8");
        if (Buffer.byteLength(stdout, "utf8") > MAX_STARTUP_OUTPUT_BYTES) {
          finish(new Error("Native sidecar exceeded the bounded startup output limit"));
          return;
        }
        const lines = stdout.split(/\r?\n/);
        stdout = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith(SIDECAR_READY_PREFIX)) continue;
          try {
            const ready = JSON.parse(line.slice(SIDECAR_READY_PREFIX.length)) as SidecarReadyLine;
            this.applyReadyLine(ready);
            finish();
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            finish(new Error(`Invalid native sidecar readiness line: ${detail}`));
          }
          return;
        }
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        console.error(`[Native sidecar] ${chunk.toString("utf8").trim()}`);
      });
      child.once("error", (error) => finish(error));
      child.once("exit", (code, signal) => {
        if (!settled) {
          finish(new Error(`Native sidecar exited before readiness (code ${code}, signal ${signal ?? "none"})`));
          return;
        }
        if (this.process === child) {
          this.process = null;
          this.status = "stopped";
        }
      });
    });
  }

  async stop(): Promise<void> {
    const child = this.process;
    if (!child) {
      if (this.status !== "disabled") this.status = "stopped";
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (this.process === child) this.process = null;
        this.status = "stopped";
        resolve();
      };
      const timeout = setTimeout(finish, 2_000);
      child.once("exit", finish);
      child.once("error", finish);
      child.kill("SIGTERM");
    });
  }

  private failBeforeSpawn(message: string): NativeSidecarInfo {
    this.status = "error";
    this.lastError = message;
    this.host = null;
    this.port = null;
    this.protocolVersion = null;
    return this.getInfo();
  }

  private applyReadyLine(ready: SidecarReadyLine): void {
    if (ready.host !== "127.0.0.1") {
      throw new Error("Native sidecar must bind exactly to 127.0.0.1");
    }
    if (typeof ready.port !== "number" || !Number.isInteger(ready.port) || ready.port < 1 || ready.port > 65_535) {
      throw new Error("Native sidecar readiness has an invalid port");
    }
    if (typeof ready.protocol_version !== "string" || !ready.protocol_version) {
      throw new Error("Native sidecar readiness has no protocol version");
    }
    this.host = ready.host;
    this.port = ready.port;
    this.protocolVersion = ready.protocol_version;
  }
}
