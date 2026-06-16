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
  startFixtureServer(opts: { assetPath: string; assetName: string; assetSha: string }): Promise<{
    base: string;
    close(): Promise<void>;
  }>;
  driveUpdate(baseUrl: string, timeoutMs: number): Promise<void>;
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

  it.skipIf(process.platform === "win32")(
    "builds a minimal overlay tar.gz asset with the executable + a sentinel",
    () => {
      const root = makeTempDir("n4a-su-asset-");
      const appRoot = path.join(root, "nirs4all-studio");
      fs.mkdirSync(path.join(appRoot, "resources"), { recursive: true });
      const exe = path.join(appRoot, "nirs4all-stub");
      fs.writeFileSync(exe, "#!/bin/sh\nexit 0\n");
      fs.chmodSync(exe, 0o755);
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
    },
  );

  it("serves the fixture release, asset bytes, and sha256 sidecar", async () => {
    const dir = makeTempDir("n4a-su-fixture-");
    const assetPath = path.join(dir, "asset.tar.gz");
    const bytes = Buffer.from("fake-archive-bytes");
    fs.writeFileSync(assetPath, bytes);
    const assetSha = crypto.createHash("sha256").update(bytes).digest("hex");
    const assetName = "nirs4all-studio-999.0.0-all-in-one-linux-x64.tar.gz";

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
    } finally {
      await server.close();
    }
  });

  it("drives check -> download -> apply against a fake backend", async () => {
    const server = await startFakeBackend({ canApplyInPlace: true });
    try {
      await expect(smoke.driveUpdate(server.base, 10000)).resolves.toBeUndefined();
      expect(server.calls).toContain("POST /api/updates/check");
      expect(server.calls).toContain("POST /api/updates/webapp/download-start");
      expect(server.calls).toContain("POST /api/updates/webapp/apply");
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
});

function startFakeBackend(opts: { canApplyInPlace: boolean }): Promise<{
  base: string;
  calls: string[];
  close(): Promise<void>;
}> {
  const calls: string[] = [];
  let statusPolls = 0;
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
        return send({ update_available: true, can_apply_in_place: opts.canApplyInPlace, update_channel: opts.canApplyInPlace ? "in_place" : "installer" });
      }
      if (url === "/api/updates/webapp/download-start") return send({ job_id: "job-1" });
      if (url.startsWith("/api/updates/webapp/download-status/")) {
        statusPolls += 1;
        return send({ status: statusPolls >= 2 ? "completed" : "running", progress: 100 });
      }
      if (url === "/api/updates/webapp/apply") return send({ restart_required: true, success: true });
      res.writeHead(404);
      res.end();
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        base: `http://127.0.0.1:${port}`,
        calls,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}
