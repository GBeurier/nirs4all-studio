import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const smoke = require("../scripts/smoke-self-update.cjs") as {
  parseArgs(argv?: string[]): {
    extractedRoot: string;
    platform: string;
    appName: string;
    port: number;
    timeoutMs: number;
    keepSandbox: boolean;
    help: boolean;
  };
  assetNameForPlatform(platformId: string, version: string): string;
  buildReleaseJson(base: string, assetName: string, assetSize: number): {
    tag_name: string;
    assets: Array<{ name: string; browser_download_url: string; size: number }>;
  };
  buildUpdateAsset(
    layout: { appRoot: string; executablePath: string },
    platformId: string,
    appName: string,
    workDir: string,
  ): { assetName: string; assetPath: string; assetSize: number; assetSha: string };
  sentinelInstalledPath(layout: { appRoot: string }, platformId: string): string;
  staleInstalledPath(layout: { appRoot: string }, platformId: string): string;
  startFixtureServer(opts: { assetPath: string; assetName: string; assetSha: string }): Promise<{
    base: string;
    close(): Promise<void>;
  }>;
  driveUpdate(baseUrl: string, timeoutMs: number, backendOutput?: () => string): Promise<void>;
};

// The archive smoke owns the shared post-update native scientific probe.
const archiveSmoke = require("../scripts/smoke-archive-standalone.cjs") as {
  waitForNativeScientificReady(
    port: number,
    timeoutMs: number,
    child: { exitCode: number | null },
    outputBuffer: string[],
  ): Promise<{
    readiness: { native_training_ready: boolean };
    playground: { success: boolean; processed: { shape: number[] } };
  }>;
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

describe("smoke-self-update", () => {
  it("parses CLI flags", () => {
    const parsed = smoke.parseArgs([
      "--extracted-root",
      "release/archive-smoke",
      "--platform=linux",
      "--port",
      "44211",
      "--timeout-ms=120000",
      "--keep-sandbox",
    ]);
    expect(parsed.extractedRoot).toBe(path.resolve("release/archive-smoke"));
    expect(parsed.platform).toBe("linux");
    expect(parsed.port).toBe(44211);
    expect(parsed.timeoutMs).toBe(120000);
    expect(parsed.keepSandbox).toBe(true);
  });

  it("builds platform-specific asset names the selector accepts", () => {
    expect(smoke.assetNameForPlatform("linux", "9.9.9")).toMatch(/^nirs4all\.Studio-/);
    expect(smoke.assetNameForPlatform("linux", "9.9.9")).toMatch(/-all-in-one-linux-(x64|arm64)\.tar\.gz$/);
    expect(smoke.assetNameForPlatform("darwin", "9.9.9")).toMatch(/-all-in-one-mac-(x64|arm64)\.zip$/);
    expect(smoke.assetNameForPlatform("win32", "9.9.9")).toMatch(/-all-in-one-win-(x64|arm64)\.zip$/);
  });

  it("builds a release JSON with asset + sidecar pointing at the fixture base", () => {
    const json = smoke.buildReleaseJson("http://127.0.0.1:5555", "asset-linux-x64.tar.gz", 1234);
    expect(json.tag_name).toBe("999.0.0");
    expect(json.assets).toHaveLength(2);
    expect(json.assets[0].browser_download_url).toBe("http://127.0.0.1:5555/asset-linux-x64.tar.gz");
    expect(json.assets[0].size).toBe(1234);
    expect(json.assets[1].name).toBe("asset-linux-x64.tar.gz.sha256");
  });

  it("resolves the sentinel path per platform", () => {
    expect(smoke.sentinelInstalledPath({ appRoot: "/app" }, "linux")).toBe(path.join("/app", "resources", "UPDATE_SMOKE_SENTINEL"));
    expect(smoke.sentinelInstalledPath({ appRoot: "/X.app" }, "darwin")).toBe(
      path.join("/X.app", "Contents", "Resources", "UPDATE_SMOKE_SENTINEL"),
    );
  });

  it("resolves the stale-file path per platform", () => {
    expect(smoke.staleInstalledPath({ appRoot: "/app" }, "linux")).toBe(path.join("/app", "resources", "UPDATE_SMOKE_STALE"));
    expect(smoke.staleInstalledPath({ appRoot: "/X.app" }, "darwin")).toBe(
      path.join("/X.app", "Contents", "Resources", "UPDATE_SMOKE_STALE"),
    );
  });

  it.skipIf(process.platform === "win32")(
    "builds a full-tree tar.gz asset (whole install + a sentinel, not a minimal overlay)",
    () => {
      const root = makeTempDir("n4a-su-asset-");
      const appRoot = path.join(root, "nirs4all-studio");
      fs.mkdirSync(path.join(appRoot, "resources", "backend"), { recursive: true });
      const exe = path.join(appRoot, "nirs4all-stub");
      fs.writeFileSync(exe, "#!/bin/sh\nexit 0\n");
      fs.chmodSync(exe, 0o755);
      // A file that is NEITHER the executable NOR the sentinel: it must survive
      // into the asset, proving a FULL-tree copy. The directory-mode apply now
      // replaces the whole app dir atomically, so a minimal overlay (which would
      // drop this file) leaves the relaunched app without its runtime/backend.
      fs.writeFileSync(path.join(appRoot, "resources", "backend", "runtime.bin"), "runtime payload");
      const workDir = makeTempDir("n4a-su-work-");

      const asset = smoke.buildUpdateAsset({ appRoot, executablePath: exe }, "linux", "nirs4all Studio", workDir);

      expect(fs.existsSync(asset.assetPath)).toBe(true);
      expect(asset.assetSha).toMatch(/^[0-9a-f]{64}$/);
      expect(crypto.createHash("sha256").update(fs.readFileSync(asset.assetPath)).digest("hex")).toBe(asset.assetSha);

      const extract = makeTempDir("n4a-su-extract-");
      execFileSync("tar", ["-xzf", asset.assetPath, "-C", extract]);
      const top = path.join(extract, "nirs4all-studio");
      expect(fs.existsSync(path.join(top, "nirs4all-stub"))).toBe(true);
      expect(fs.existsSync(path.join(top, "resources", "UPDATE_SMOKE_SENTINEL"))).toBe(true);
      // The whole tree came along — not just the exe + sentinel.
      expect(fs.readFileSync(path.join(top, "resources", "backend", "runtime.bin"), "utf8")).toBe("runtime payload");
    },
  );

  it("serves the fixture release, asset bytes, and sha256 sidecar", async () => {
    const dir = makeTempDir("n4a-su-fixture-");
    const assetPath = path.join(dir, "asset.tar.gz");
    const bytes = Buffer.from("fake-archive-bytes");
    fs.writeFileSync(assetPath, bytes);
    const assetSha = crypto.createHash("sha256").update(bytes).digest("hex");
    const assetName = "nirs4all.Studio-999.0.0-all-in-one-linux-x64.tar.gz";

    const server = await smoke.startFixtureServer({ assetPath, assetName, assetSha });
    try {
      const rel = await (await fetch(`${server.base}/repos/x/y/releases/latest`)).json();
      expect(rel.tag_name).toBe("999.0.0");
      expect(rel.assets[0].browser_download_url).toBe(`${server.base}/${assetName}`);

      const assetRes = await fetch(`${server.base}/${assetName}`);
      const downloaded = Buffer.from(await assetRes.arrayBuffer());
      expect(downloaded.equals(bytes)).toBe(true);

      const sidecar = await (await fetch(`${server.base}/${assetName}.sha256`)).text();
      expect(sidecar.split(/\s+/)[0]).toBe(assetSha);
      expect(sidecar).toContain("/release/nirs4all Studio-999.0.0-all-in-one-linux-x64.tar.gz");
    } finally {
      await server.close();
    }
  });

  it("polls download-info directly, then drives download -> apply", async () => {
    const server = await startFakeBackend({ canApplyInPlace: true });
    try {
      await expect(smoke.driveUpdate(server.base, 10000)).resolves.toBeUndefined();
      expect(server.calls).toContain("GET /api/updates/webapp/download-info");
      expect(server.calls).not.toContain("POST /api/updates/check");
      expect(server.calls).toContain("POST /api/updates/webapp/download-start");
      expect(server.calls).toContain("POST /api/updates/webapp/apply");
    } finally {
      await server.close();
    }
  });

  it("reports the last download-info error and backend output", async () => {
    const server = await startFakeBackend({ downloadInfoFailure: true });
    try {
      await expect(smoke.driveUpdate(server.base, 1000, () => "sidecar diagnostic output")).rejects.toThrow(
        /last error=GET .*download-info -> 503[\s\S]*backend stdout:[\s\S]*sidecar diagnostic output/,
      );
    } finally {
      await server.close();
    }
  });

  it("aborts when the backend refuses in-place update", async () => {
    const server = await startFakeBackend({ canApplyInPlace: false });
    try {
      await expect(smoke.driveUpdate(server.base, 10000)).rejects.toThrow(/refused in-place/);
      expect(server.calls).not.toContain("POST /api/updates/webapp/apply");
    } finally {
      await server.close();
    }
  });

  it("polls readiness and executes the bounded inline Playground facade", async () => {
    const server = await startFakeBackend({ scientificReadiness: "ready-after-poll" });
    const child = { exitCode: null };
    try {
      const payload = await archiveSmoke.waitForNativeScientificReady(server.port, 10000, child, []);
      expect(payload.readiness.native_training_ready).toBe(true);
      expect(payload.playground).toMatchObject({ success: true, processed: { shape: [2, 2] } });
      expect(server.calls.filter((c) => c === "GET /api/system/readiness").length).toBeGreaterThanOrEqual(2);
      expect(server.calls).toContain("POST /api/playground/execute");
    } finally {
      await server.close();
    }
  });

  it("fails with the last native readiness when training never becomes ready", async () => {
    const server = await startFakeBackend({ scientificReadiness: "unavailable" });
    const child = { exitCode: null };
    try {
      await expect(archiveSmoke.waitForNativeScientificReady(server.port, 1500, child, [])).rejects.toThrow(
        /native_training_ready.*false/,
      );
      expect(server.calls).toContain("GET /api/system/readiness");
      expect(server.calls).not.toContain("POST /api/playground/execute");
    } finally {
      await server.close();
    }
  });
});

function startFakeBackend(opts: {
  canApplyInPlace?: boolean;
  scientificReadiness?: "ready-after-poll" | "unavailable";
  downloadInfoFailure?: boolean;
} = {}): Promise<{
  base: string;
  port: number;
  calls: string[];
  close(): Promise<void>;
}> {
  const canApplyInPlace = opts.canApplyInPlace ?? true;
  const scientificReadiness = opts.scientificReadiness ?? "ready-after-poll";
  const calls: string[] = [];
  let statusPolls = 0;
  let readinessPolls = 0;
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = (req.url || "").split("?")[0];
      calls.push(`${req.method} ${url}`);
      const send = (obj: unknown) => {
        const body = Buffer.from(JSON.stringify(obj));
        res.writeHead(200, { "Content-Type": "application/json", "Content-Length": body.length });
        res.end(body);
      };
      if (url === "/api/updates/check") return send({ webapp: {} });
      if (url === "/api/updates/webapp/download-info") {
        if (opts.downloadInfoFailure) {
          res.writeHead(503);
          res.end();
          return;
        }
        return send({ update_available: true, can_apply_in_place: canApplyInPlace, update_channel: canApplyInPlace ? "in_place" : "installer" });
      }
      if (url === "/api/updates/webapp/download-start") return send({ job_id: "job-1" });
      if (url.startsWith("/api/updates/webapp/download-status/")) {
        statusPolls += 1;
        return send({ status: statusPolls >= 2 ? "completed" : "running", progress: 100 });
      }
      if (url === "/api/updates/webapp/apply") return send({ restart_required: true, success: true });
      if (url === "/api/health") return send({ core_ready: true, ready: true });
      if (url === "/api/system/readiness") {
        readinessPolls += 1;
        const ready = scientificReadiness === "ready-after-poll" && readinessPolls >= 2;
        return send({ core_ready: true, native_training_ready: ready });
      }
      if (url === "/api/playground/execute" && req.method === "POST") {
        return send({ success: true, processed: { shape: [2, 2] } });
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        base: `http://127.0.0.1:${port}`,
        port,
        calls,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}
