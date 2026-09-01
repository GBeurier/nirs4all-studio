import type { BackendInfo } from "./backend-manager";

export interface ScientificPluginBackend {
  start(): Promise<number>;
  restart(): Promise<number>;
  stop(): Promise<void>;
  getInfo(): BackendInfo;
  getUrl(): string;
}

export interface ScientificPluginInfo {
  role: "scientific-plugin";
  status: BackendInfo["status"];
  ready: boolean;
  requested: boolean;
  port: number | null;
  url: string | null;
  error?: string;
  restartCount: number;
}

/**
 * Owns the optional FastAPI compatibility/scientific plugin lifecycle.
 *
 * Merely constructing or inspecting this object never starts Python. Even URL
 * acquisition is authorized first by the process-wide diagnostic policy,
 * before runtime preparation or spawn. An authorized diagnostic acquisition
 * performs one shared, blocking start and waits for backend health.
 */
export class ScientificPluginLifecycle {
  private activationPromise: Promise<number> | null = null;
  private activationError: Error | null = null;
  private requested = false;

  constructor(
    private readonly backend: ScientificPluginBackend,
    private readonly prepare: () => Promise<void>,
    private readonly authorizeActivation: () => void = () => undefined,
  ) {}

  getInfo(): ScientificPluginInfo {
    const info = this.backend.getInfo();
    const ready = info.status === "running";
    return {
      role: "scientific-plugin",
      status: info.status,
      ready,
      requested: this.requested,
      port: ready ? info.port : null,
      url: ready ? info.url : null,
      error: info.error,
      restartCount: info.restartCount,
    };
  }

  async ensureRunning(): Promise<number> {
    this.authorizeActivation();
    const info = this.backend.getInfo();
    if (info.status === "running") return info.port;
    if (this.activationPromise) return this.activationPromise;
    if (this.activationError) throw this.activationError;

    this.requested = true;
    this.activationPromise = (async () => {
      await this.prepare();
      const port = await this.backend.start();
      const started = this.backend.getInfo();
      if (started.status !== "running") {
        throw new Error(
          started.error ?? "Scientific plugin did not become ready",
        );
      }
      return port;
    })();

    try {
      return await this.activationPromise;
    } catch (error) {
      this.activationError =
        error instanceof Error ? error : new Error(String(error));
      throw this.activationError;
    } finally {
      this.activationPromise = null;
    }
  }

  async getUrl(): Promise<string> {
    await this.ensureRunning();
    const info = this.getInfo();
    if (!info.ready || !info.url) {
      throw new Error(info.error ?? "Scientific plugin is unavailable");
    }
    return info.url;
  }

  async restart(skipPrepare = false): Promise<number> {
    this.authorizeActivation();
    this.requested = true;
    this.activationError = null;
    if (!skipPrepare) await this.prepare();
    const port = await this.backend.restart();
    const info = this.backend.getInfo();
    if (info.status !== "running") {
      throw new Error(info.error ?? "Scientific plugin did not become ready");
    }
    return port;
  }

  async stop(): Promise<void> {
    await this.backend.stop();
  }

  /** Allow a newly selected interpreter to satisfy a later explicit acquire. */
  clearFailure(): void {
    this.activationError = null;
  }
}
