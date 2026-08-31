import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SIDECAR_PATH_ENV = "NIRS4ALL_NATIVE_SIDECAR_PATH";
const SIDECAR_PORT_ENV = "NIRS4ALL_NATIVE_SIDECAR_PORT";
const SIDECAR_ENABLE_PACKAGED_ENV = "NIRS4ALL_ENABLE_NATIVE_SIDECAR";
const PYTHON_PLUGIN_HOST_ENV = "NIRS4ALL_PYTHON_PLUGIN_HOST";
const PYTHON_PLUGIN_HOST_BUNDLED_ENV = "NIRS4ALL_PYTHON_PLUGIN_HOST_BUNDLED";
const RUNTIME_MODE_ENV = "NIRS4ALL_RUNTIME_MODE";
const RUNTIME_KIND_ENV = "NIRS4ALL_RUNTIME_KIND";
const BUILD_INFO_PATH_ENV = "NIRS4ALL_BUILD_INFO_PATH";
const APP_VERSION_ENV = "NIRS4ALL_APP_VERSION";
const SIDECAR_READY_PREFIX = "STUDIO_SIDECAR_READY ";
const SIDECAR_START_TIMEOUT_MS = 15_000;
const MAX_STARTUP_OUTPUT_BYTES = 8 * 1024;
const electronProcess = process as NodeJS.Process & { resourcesPath?: string };

export type NativeSidecarStatus =
  "disabled" | "starting" | "running" | "stopped" | "error";

export interface NativeSidecarInfo {
  status: NativeSidecarStatus;
  host: string | null;
  port: number | null;
  protocolVersion: string | null;
  url: string | null;
  pythonPluginHostConfigured: boolean;
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
  allowPackagedResource?: boolean;
}

export interface NativeSidecarStartOptions {
  /** Start the packaged binary without requiring a diagnostic environment flag. */
  allowPackagedResource?: boolean;
  /** Explicit library/plugin interpreter; never an HTTP backend command. */
  pythonPluginHost?: string | null;
  /** Product runtime metadata for Rust-owned system inventory responses. */
  runtimeMode?: string | null;
  /** Distinguishes bundled, managed, custom, and development plugin hosts. */
  runtimeKind?: string | null;
  /** Packaged build metadata selected by Electron, never a renderer input. */
  buildInfoPath?: string | null;
  /** Product version supplied by Electron for Rust-owned version inventory. */
  appVersion?: string | null;
}

/**
 * Resolve the explicit developer override first, then a packaged resource
 * when the product launch policy permits it. The sidecar is never selected as
 * a replacement for unmigrated API routes merely because a binary is bundled.
 */
export function resolveNativeSidecarPath({
  environment = process.env,
  resourcesPath = electronProcess.resourcesPath,
  platform = process.platform,
  allowPackagedResource,
}: NativeSidecarPathOptions = {}): string | null {
  const explicitPath = environment[SIDECAR_PATH_ENV]?.trim();
  if (explicitPath) return path.resolve(explicitPath);
  const packagedResourceEnabled =
    allowPackagedResource ?? environment[SIDECAR_ENABLE_PACKAGED_ENV] === "1";
  if (!packagedResourceEnabled || !resourcesPath) return null;

  return path.join(
    resourcesPath,
    "backend",
    "native",
    platform === "win32" ? "studio-sidecar.exe" : "studio-sidecar",
  );
}

/** Resolve an embedded interpreter without treating it as an HTTP backend. */
export function resolveBundledPythonPluginHost({
  resourcesPath = electronProcess.resourcesPath,
  platform = process.platform,
}: Omit<NativeSidecarPathOptions, "environment"> = {}): string | null {
  if (!resourcesPath) return null;
  const runtimeRoot = path.join(resourcesPath, "backend", "python-runtime");
  const candidates =
    platform === "win32"
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
 * Launches the native Studio control plane from an explicit binary in
 * development or the packaged resource in product builds. It deliberately has
 * no Python fallback and does not replace unmigrated FastAPI route families.
 */
export class NativeSidecarManager {
  private process: ChildProcess | null = null;
  private status: NativeSidecarStatus = "disabled";
  private host: string | null = null;
  private port: number | null = null;
  private protocolVersion: string | null = null;
  private pythonPluginHostConfigured = false;
  private lastError: string | null = null;

  getInfo(): NativeSidecarInfo {
    return {
      status: this.status,
      host: this.host,
      port: this.port,
      protocolVersion: this.protocolVersion,
      pythonPluginHostConfigured: this.pythonPluginHostConfigured,
      url:
        this.host !== null && this.port !== null
          ? `http://${this.host}:${this.port}`
          : null,
      ...(this.lastError ? { error: this.lastError } : {}),
    };
  }

  async start(
    options: NativeSidecarStartOptions = {},
  ): Promise<NativeSidecarInfo> {
    const packagedResourceEnabled =
      options.allowPackagedResource ??
      process.env[SIDECAR_ENABLE_PACKAGED_ENV] === "1";
    const configuredPath = resolveNativeSidecarPath({
      allowPackagedResource: packagedResourceEnabled,
    });
    if (!configuredPath) {
      if (packagedResourceEnabled) {
        return this.failBeforeSpawn(
          "Native sidecar was enabled but Electron has no packaged resources path",
        );
      }
      this.status = "disabled";
      this.host = null;
      this.port = null;
      this.protocolVersion = null;
      this.pythonPluginHostConfigured = false;
      this.lastError = null;
      return this.getInfo();
    }
    if (this.process) {
      return this.getInfo();
    }

    const binaryPath = configuredPath;
    if (!fs.existsSync(binaryPath)) {
      return this.failBeforeSpawn(
        `${SIDECAR_PATH_ENV} does not exist: ${binaryPath}`,
      );
    }

    const configuredPort = process.env[SIDECAR_PORT_ENV]?.trim() || "0";
    if (!/^\d+$/.test(configuredPort)) {
      return this.failBeforeSpawn(
        `Invalid ${SIDECAR_PORT_ENV} value: ${configuredPort}`,
      );
    }
    const port = Number.parseInt(configuredPort, 10);
    if (port > 65_535)
      return this.failBeforeSpawn(
        `Invalid ${SIDECAR_PORT_ENV} value: ${configuredPort}`,
      );

    this.status = "starting";
    this.lastError = null;
    this.host = null;
    this.port = null;
    this.protocolVersion = null;
    this.pythonPluginHostConfigured = false;

    let child: ChildProcess;
    const explicitPythonPluginHost =
      process.env[PYTHON_PLUGIN_HOST_ENV]?.trim();
    const selectedPythonPluginHost = options.pythonPluginHost?.trim();
    const bundledPythonPluginHost =
      explicitPythonPluginHost || selectedPythonPluginHost
        ? null
        : resolveBundledPythonPluginHost();
    const pythonPluginHost =
      explicitPythonPluginHost ||
      selectedPythonPluginHost ||
      bundledPythonPluginHost;
    this.pythonPluginHostConfigured = Boolean(pythonPluginHost);
    const childEnvironment: NodeJS.ProcessEnv = { ...process.env };
    if (pythonPluginHost)
      childEnvironment[PYTHON_PLUGIN_HOST_ENV] = pythonPluginHost;
    if (bundledPythonPluginHost)
      childEnvironment[PYTHON_PLUGIN_HOST_BUNDLED_ENV] = "true";
    if (options.runtimeMode?.trim())
      childEnvironment[RUNTIME_MODE_ENV] = options.runtimeMode.trim();
    if (options.runtimeKind?.trim())
      childEnvironment[RUNTIME_KIND_ENV] = options.runtimeKind.trim();
    if (options.buildInfoPath?.trim())
      childEnvironment[BUILD_INFO_PATH_ENV] = options.buildInfoPath.trim();
    if (options.appVersion?.trim())
      childEnvironment[APP_VERSION_ENV] = options.appVersion.trim();
    try {
      child = spawn(
        binaryPath,
        ["--host", "127.0.0.1", "--port", port.toString()],
        {
          env: childEnvironment,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        },
      );
    } catch (error) {
      const startupError =
        error instanceof Error ? error : new Error(String(error));
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
        finish(
          new Error(
            `Native sidecar did not report readiness within ${SIDECAR_START_TIMEOUT_MS}ms`,
          ),
        );
      }, SIDECAR_START_TIMEOUT_MS);

      child.stdout?.on("data", (chunk: Buffer) => {
        if (settled) return;
        stdout += chunk.toString("utf8");
        if (Buffer.byteLength(stdout, "utf8") > MAX_STARTUP_OUTPUT_BYTES) {
          finish(
            new Error(
              "Native sidecar exceeded the bounded startup output limit",
            ),
          );
          return;
        }
        const lines = stdout.split(/\r?\n/);
        stdout = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith(SIDECAR_READY_PREFIX)) continue;
          try {
            const ready = JSON.parse(
              line.slice(SIDECAR_READY_PREFIX.length),
            ) as SidecarReadyLine;
            this.applyReadyLine(ready);
            finish();
          } catch (error) {
            const detail =
              error instanceof Error ? error.message : String(error);
            finish(
              new Error(`Invalid native sidecar readiness line: ${detail}`),
            );
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
          finish(
            new Error(
              `Native sidecar exited before readiness (code ${code}, signal ${signal ?? "none"})`,
            ),
          );
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

  async restart(
    options: NativeSidecarStartOptions = {},
  ): Promise<NativeSidecarInfo> {
    await this.stop();
    return this.start(options);
  }

  private failBeforeSpawn(message: string): NativeSidecarInfo {
    this.status = "error";
    this.lastError = message;
    this.host = null;
    this.port = null;
    this.protocolVersion = null;
    this.pythonPluginHostConfigured = false;
    return this.getInfo();
  }

  private applyReadyLine(ready: SidecarReadyLine): void {
    if (ready.host !== "127.0.0.1") {
      throw new Error("Native sidecar must bind exactly to 127.0.0.1");
    }
    if (
      typeof ready.port !== "number" ||
      !Number.isInteger(ready.port) ||
      ready.port < 1 ||
      ready.port > 65_535
    ) {
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
