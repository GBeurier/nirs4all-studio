import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const smokeModule = require("../scripts/smoke-archive-standalone.cjs") as {
  assertValidConfig(config: {
    extractedRoot: string;
    platform: string;
    appName: string;
    port: number;
    timeoutMs: number;
    sandboxRoot: string;
    keepSandbox: boolean;
  }): {
    extractedRoot: string;
    platform: string;
    appName: string;
    port: number;
    timeoutMs: number;
    sandboxRoot: string;
    keepSandbox: boolean;
  };
  buildSandboxEnv(platformId: string, sandboxRoot: string, port: number): Record<string, string>;
  cleanupSandboxRoot(
    sandboxRoot: string,
    options?: { retryCount?: number; retryDelayMs?: number },
  ): Promise<boolean>;
  isRetryableCleanupError(error: { code?: string } | null | undefined): boolean;
  parseArgs(argv?: string[]): {
    extractedRoot: string;
    platform: string;
    appName: string;
    port: number;
    timeoutMs: number;
    sandboxRoot: string;
    keepSandbox: boolean;
    help: boolean;
  };
  verifyInstalledProduct(port: number, sessionToken: string): Promise<unknown>;
  verifyRunLaunch(port: number, sessionToken: string): Promise<void>;
  verifySelectedEnvironment(port: number, sessionToken: string, pythonPath: string): Promise<unknown>;
  waitForReady(
    port: number,
    timeoutMs: number,
    child: { exitCode: number | null },
    outputBuffer: string[],
    sessionToken: string,
  ): Promise<{ healthPayload: unknown; readinessPayload: unknown }>;
  pushOutput(buffer: string[], label: string, chunk: Buffer): void;
  resolveLaunchLayout(extractedRoot: string, platformId: string, appName: string): {
    appRoot: string;
    backendRoot: string;
    executablePath: string;
    nativeSidecarPath: string;
  };
  verifyLaunchRuntimeContract(
    launchLayout: {
      appRoot: string;
      backendRoot: string;
    },
    platformId: string,
    arch?: string,
  ): unknown;
  removePathWithRetries(
    targetPath: string,
    options?: { retryCount?: number; retryDelayMs?: number },
  ): Promise<void>;
};

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("smoke-archive-standalone", () => {
  it("parses CLI flags for an extracted bundle smoke test", () => {
    const parsed = smokeModule.parseArgs([
      "--extracted-root",
      "release/archive-smoke",
      "--platform=linux",
      "--app-name",
      "nirs4all Studio",
      "--port",
      "43123",
      "--timeout-ms=90000",
      "--sandbox-root",
      "tmp/smoke-home",
      "--keep-sandbox",
    ]);

    expect(parsed.extractedRoot).toBe(path.resolve("release/archive-smoke"));
    expect(parsed.platform).toBe("linux");
    expect(parsed.appName).toBe("nirs4all Studio");
    expect(parsed.port).toBe(43123);
    expect(parsed.timeoutMs).toBe(90000);
    expect(parsed.sandboxRoot).toBe(path.resolve("tmp/smoke-home"));
    expect(parsed.keepSandbox).toBe(true);
  });

  it("resolves the Windows standalone layout", () => {
    const extractedRoot = makeTempDir("n4a-smoke-win-");
    const layout = smokeModule.resolveLaunchLayout(extractedRoot, "win32", "nirs4all Studio");

    expect(layout.executablePath).toBe(path.join(extractedRoot, "nirs4all Studio.exe"));
    expect(layout.backendRoot).toBe(path.join(extractedRoot, "resources", "backend"));
    expect(layout.nativeSidecarPath).toBe(
      path.join(extractedRoot, "resources", "backend", "native", "studio-sidecar.exe"),
    );
  });

  it("resolves a wrapped Linux standalone layout", () => {
    const extractedRoot = makeTempDir("n4a-smoke-linux-");
    const appRoot = path.join(extractedRoot, "wrapper", "nirs4all Studio");
    fs.mkdirSync(path.join(appRoot, "resources"), { recursive: true });
    fs.writeFileSync(path.join(appRoot, "nirs4all-webapp"), "");

    const layout = smokeModule.resolveLaunchLayout(extractedRoot, "linux", "nirs4all Studio");

    expect(layout.appRoot).toBe(appRoot);
    expect(layout.executablePath).toBe(path.join(appRoot, "nirs4all-webapp"));
    expect(layout.backendRoot).toBe(path.join(appRoot, "resources", "backend"));
    expect(layout.nativeSidecarPath).toBe(
      path.join(appRoot, "resources", "backend", "native", "studio-sidecar"),
    );
  });

  it("rejects an archive whose resources ancestor is an external symlink", () => {
    if (process.platform === "win32") return;
    const extractedRoot = makeTempDir("n4a-smoke-ancestor-link-");
    const appRoot = path.join(extractedRoot, "nirs4all Studio");
    const outsideResources = path.join(extractedRoot, "outside-resources");
    fs.mkdirSync(path.join(outsideResources, "backend"), { recursive: true });
    fs.mkdirSync(appRoot);
    fs.writeFileSync(path.join(appRoot, "nirs4all-webapp"), "");
    fs.symlinkSync(outsideResources, path.join(appRoot, "resources"));

    const layout = smokeModule.resolveLaunchLayout(
      extractedRoot,
      "linux",
      "nirs4all Studio",
    );
    expect(() => smokeModule.verifyLaunchRuntimeContract(
      layout,
      "linux",
      "x64",
    )).toThrow(/boundary component must be a real non-symlink directory/);
  });

  it("resolves the macOS .app layout", () => {
    const extractedRoot = makeTempDir("n4a-smoke-mac-");
    const appBundle = path.join(extractedRoot, "nirs4all Studio.app");
    fs.mkdirSync(appBundle);

    const layout = smokeModule.resolveLaunchLayout(extractedRoot, "darwin", "nirs4all Studio");

    expect(layout.appRoot).toBe(appBundle);
    expect(layout.executablePath).toBe(
      path.join(appBundle, "Contents", "MacOS", "nirs4all Studio"),
    );
    expect(layout.backendRoot).toBe(path.join(appBundle, "Contents", "Resources", "backend"));
    expect(layout.nativeSidecarPath).toBe(
      path.join(appBundle, "Contents", "Resources", "backend", "native", "studio-sidecar"),
    );
  });

  it("creates an isolated Linux sandbox env", () => {
    const sandboxRoot = makeTempDir("n4a-smoke-env-");
    const env = smokeModule.buildSandboxEnv("linux", sandboxRoot, 43123);

    expect(env.NIRS4ALL_OFFLINE).toBe("1");
    expect(env.NIRS4ALL_NATIVE_SIDECAR_PORT).toBe("43123");
    expect(env.NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN).toMatch(/^[a-f0-9]{64}$/);
    expect(env.NIRS4ALL_BACKEND_PORT).toBeUndefined();
    expect(env.HOME).toBe(path.join(sandboxRoot, "home"));
    expect(env.XDG_CACHE_HOME).toBe(path.join(sandboxRoot, "home", ".cache"));
    expect(env.XDG_DATA_HOME).toBe(path.join(sandboxRoot, "home", ".local", "share"));
    expect(env.XDG_CONFIG_HOME).toBe(path.join(sandboxRoot, "home", ".config"));
  });

  it("rejects invalid forced ports", () => {
    const extractedRoot = makeTempDir("n4a-smoke-config-");

    expect(() =>
      smokeModule.assertValidConfig({
        extractedRoot,
        platform: "linux",
        appName: "nirs4all Studio",
        port: 70000,
        timeoutMs: 90000,
        sandboxRoot: "",
        keepSandbox: false,
      }),
    ).toThrow("Invalid --port value: 70000");
  });

  it("waits for the scientific host and reports why it did not start", async () => {
    const child = { exitCode: null };
    const respond = (readiness: object) => vi.fn(async (url: string, options: RequestInit) => {
      expect(options.headers).toMatchObject({ "X-Nirs4all-Session": "test-session" });
      return {
        ok: true,
        json: async () => (url.endsWith("/sidecar/v1/health") ? { sidecar_ready: true } : readiness),
      };
    });
    try {
      vi.stubGlobal("fetch", respond({ ml_loading: false, ml_ready: true }));
      await expect(smokeModule.waitForReady(43123, 5000, child, [], "test-session")).resolves.toEqual({
        healthPayload: { sidecar_ready: true },
        readinessPayload: { ml_loading: false, ml_ready: true },
      });
      vi.stubGlobal("fetch", respond({ ml_loading: false, ml_ready: false, ml_error: "studio_adapters_unavailable" }));
      await expect(smokeModule.waitForReady(43123, 5000, child, ["[stderr] host"], "test-session"))
        .rejects.toThrow(/did not start on the provisioned environment.*studio_adapters_unavailable[\s\S]*\[stderr\] host/);
    } finally { vi.unstubAllGlobals(); }
  });

  it("requires the sidecar to run the provisioned interpreter", async () => {
    const coherence = { configured_python: "/data/python-env/venv/bin/python", coherent: true, core_ready: true };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      expect(url).toBe("http://127.0.0.1:43123/api/system/env-coherence");
      return { ok: true, json: async () => coherence };
    }));
    try {
      await expect(smokeModule.verifySelectedEnvironment(43123, "test-session", coherence.configured_python))
        .resolves.toEqual(coherence);
      await expect(smokeModule.verifySelectedEnvironment(43123, "test-session", "/usr/bin/python3"))
        .rejects.toThrow("does not use the provisioned environment /usr/bin/python3");
    } finally { vi.unstubAllGlobals(); }
  });

  it("exercises metadata with missing cells through the installed wizard routes", async () => {
    let fixture = "";
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit) => {
      calls.push(url);
      expect(options.headers).toMatchObject({ "X-Nirs4all-Session": "test-session" });
      const body = typeof options.body === "string" ? JSON.parse(options.body) : {};
      let value: unknown;
      if (url.endsWith("/datasets/detect-unified")) {
        fixture = body.path;
        expect(fs.readFileSync(path.join(fixture, "Mtrain.csv"), "utf8")).toContain("sample-a;\n");
        value = { metadata_columns: ["sample_id", "nirs_Remarque"], files: [{ path: "Mtrain.csv", type: "metadata" }] };
      } else if (url.endsWith("/datasets/validate-files")) {
        expect(body.files[0].overrides).toMatchObject({ has_header: true, delimiter: ";" });
        value = { shapes: { "Mtrain.csv": { num_rows: 2, num_columns: 2, column_names: ["sample_id", "nirs_Remarque"] } } };
      } else if (url.endsWith("/datasets/link")) {
        expect(body.config.aggregation).toEqual({ enabled: true, column: "sample_id", method: "mean" });
        value = { success: true, dataset: { id: "saved" } };
      } else if (url.endsWith("/datasets/saved")) {
        value = { dataset: { config: { aggregation: { column: "sample_id" } } } };
      } else if (url.includes("/datasets/saved/preview")) {
        value = { success: true, summary: { num_samples: 2, metadata_columns: ["sample_id"] } };
      } else if (url.endsWith("/datasets/saved/refresh")) {
        value = { success: true, dataset: { num_samples: 2 } };
      } else {
        expect(url).toContain("/datasets/preview");
        value = { success: true };
      }
      return { ok: true, json: async () => value };
    }));
    try {
      await smokeModule.verifyInstalledProduct(43123, "test-session");
      expect(calls).toHaveLength(7);
      expect(fs.existsSync(fixture)).toBe(false);
    } finally { vi.unstubAllGlobals(); }
  });

  it("launches one experiment on a dataset with a missing target and requires its completion", async () => {
    const calls: string[] = [];
    let workspacePath = "";
    let polls = 0;
    let refusal: string | null = null;
    vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit) => {
      const route = url.replace("http://127.0.0.1:43123/api", "");
      calls.push(route);
      const body = typeof options.body === "string" ? JSON.parse(options.body) : {};
      let value: unknown = { success: true };
      if (route === "/workspace/select") {
        workspacePath = body.path;
        expect(fs.statSync(workspacePath).isDirectory()).toBe(true);
        expect(fs.existsSync(path.join(workspacePath, "runs"))).toBe(false);
      } else if (route === "/datasets/link") {
        expect(fs.readFileSync(path.join(body.path, "Ytrain.csv"), "utf8").split("\n")[6]).toBe("");
        value = { success: true, dataset: { id: "dataset-a", targets: [{ column: "target", missing_count: 1 }] } };
      } else if (route === "/pipelines/import") {
        value = { pipeline: { id: "pipeline-a" } };
      } else if (route === "/runs/run-groups") {
        expect(body.legacyConfig).toMatchObject({ dataset_ids: ["dataset-a"], pipeline_ids: ["pipeline-a"], missing_target_policy: "predict" });
        if (refusal) return { ok: false, status: 503, text: async () => refusal };
        value = { job_id: "job-a" };
      } else if (route === "/training/job-a") {
        polls += 1;
        const status = polls < 2 ? "running" : "completed";
        if (status === "completed") {
          const jobPath = path.join(workspacePath, "runs", "job-a");
          fs.mkdirSync(jobPath, { recursive: true });
          fs.writeFileSync(path.join(jobPath, "execution_job_record.json"), JSON.stringify({ status }));
        }
        value = { status };
      }
      return { ok: true, json: async () => value };
    }));
    try {
      await smokeModule.verifyRunLaunch(43123, "test-session");
      expect(calls).toEqual(["/workspace/select", "/datasets/link", "/pipelines/import", "/runs/run-groups", "/training/job-a", "/training/job-a"]);
      refusal = JSON.stringify({ code: "scientific_dataset_invalid", detail: "The run cannot start" });
      await expect(smokeModule.verifyRunLaunch(43123, "test-session")).rejects.toThrow(/run-groups: HTTP 503.*scientific_dataset_invalid/);
    } finally { vi.unstubAllGlobals(); }
  });

  it("bounds captured process diagnostics by line count and byte length", () => {
    const output: string[] = [];
    for (let index = 0; index < 100; index += 1) {
      smokeModule.pushOutput(
        output,
        "stderr",
        Buffer.from(`${index}:${"x".repeat(4096)}`),
      );
    }
    expect(output).toHaveLength(80);
    expect(Buffer.byteLength(output.at(-1) ?? "", "utf8")).toBeLessThan(2100);
    expect(output.at(-1)).toContain("…");
  });

  it("retries sandbox removal after transient Windows-style EPERM locks", async () => {
    const sandboxRoot = makeTempDir("n4a-smoke-cleanup-");
    fs.writeFileSync(path.join(sandboxRoot, "lock.txt"), "locked\n");

    const originalRmSync = fs.rmSync;
    let attempts = 0;
    fs.rmSync = (((targetPath, options) => {
      attempts += 1;
      if (attempts < 3) {
        const error = new Error(`locked: ${targetPath}`) as NodeJS.ErrnoException;
        error.code = "EPERM";
        throw error;
      }
      return originalRmSync(targetPath, options);
    }) as typeof fs.rmSync);

    try {
      await smokeModule.removePathWithRetries(sandboxRoot, { retryCount: 3, retryDelayMs: 1 });
    } finally {
      fs.rmSync = originalRmSync;
    }

    expect(attempts).toBe(3);
    expect(fs.existsSync(sandboxRoot)).toBe(false);
  });

  it("treats generated sandbox cleanup as best-effort after a passed smoke", async () => {
    const sandboxRoot = makeTempDir("n4a-smoke-warn-");
    fs.writeFileSync(path.join(sandboxRoot, "lock.txt"), "locked\n");

    const originalRmSync = fs.rmSync;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    fs.rmSync = (((targetPath) => {
      const error = new Error(`locked: ${targetPath}`) as NodeJS.ErrnoException;
      error.code = "EPERM";
      throw error;
    }) as typeof fs.rmSync);

    try {
      await expect(
        smokeModule.cleanupSandboxRoot(sandboxRoot, { retryCount: 1, retryDelayMs: 1 }),
      ).resolves.toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Warning: unable to remove smoke sandbox"));
    } finally {
      fs.rmSync = originalRmSync;
      warnSpy.mockRestore();
    }
  });
});
