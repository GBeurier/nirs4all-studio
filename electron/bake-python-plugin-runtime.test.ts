import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const pluginRuntime = require("../scripts/bake-python-plugin-runtime.cjs") as {
  FORBIDDEN_DISTRIBUTIONS: readonly string[];
  PREFLIGHT: string;
  expectedMarker(platform?: string, arch?: string): Record<string, unknown>;
  parseArgs(argv?: string[]): {
    backendRoot: string;
    pluginWheel: string;
    verifyOnly: boolean;
  };
  assertPluginOnlyPayload(
    backendRoot: string,
    runtimeRoot: string,
    sitePackages: string,
  ): string[];
  materializeInternalRuntimeLinks(runtimeRoot: string): void;
  removeEmptyDirectories(runtimeRoot: string): void;
};

describe("plugin-only CPython runtime", () => {
  it("warms only the trusted Windows platform probe before enforcing the spawn audit hook", () => {
    const platformProbe = pluginRuntime.PREFLIGHT.indexOf("platform.machine()\n");
    const auditHook = pluginRuntime.PREFLIGHT.indexOf("sys.addaudithook(deny)\n");
    const pluginImport = pluginRuntime.PREFLIGHT.indexOf("import nirs4all");

    expect(platformProbe).toBeGreaterThan(-1);
    expect(platformProbe).toBeLessThan(auditHook);
    expect(auditHook).toBeLessThan(pluginImport);
    expect(pluginRuntime.PREFLIGHT).toContain(
      'if event in {"subprocess.Popen","os.system","os.spawn","os.posix_spawn","os.fork","os.forkpty","os.exec","pty.spawn"}: raise RuntimeError("spawn denied")',
    );
  });

  it("pins the selected release source and wheel in the exact role marker", () => {
    const marker = pluginRuntime.expectedMarker("linux", "x64");
    expect(marker).toMatchObject({
      schema: "nirs4all.studio-python-plugin-runtime.v1",
      python_role: "library-plugin-host-only",
      product_backend: "rust-sidecar",
      http_listener: "forbidden",
      source_commit: "2096f36633c22ff08a36650b7dd10c6bc0b177c9",
      wheel_sha256:
        "ba977cb04da9c8d5c91749d975e2620848d9f802bc454ed5af6e589936439c94",
      platform: "linux",
      arch: "x64",
      conversion_tools: {
        source_commit: "88c2bc1e29603049cdbf1a1080a35845edf2f3c9",
        wheel_sha256:
          "4f1c2e65ba42af9dc807e0704b7c6ec6b80efc22169d43f8051ae47f679cd819",
        distribution: "nirs4all-tools",
        distribution_version: "0.0.7",
        module: "nirs4all_tools",
        readers: { duckdb: "1.5.5", pyarrow: "25.0.1" },
        functional_probes: {
          duckdb: "in-memory-select-40-plus-2",
          pyarrow_parquet: "in-memory-round-trip",
        },
      },
    });
    expect(marker).not.toHaveProperty("distribution_record_sha256");
    expect(marker.conversion_tools).not.toHaveProperty("distribution_record_sha256");
    expect(pluginRuntime.FORBIDDEN_DISTRIBUTIONS).toEqual(
      expect.arrayContaining(["fastapi", "starlette", "uvicorn", "sentry-sdk"]),
    );
  });

  it("parses an offline exact wheel without accepting source substitution", () => {
    const parsed = pluginRuntime.parseArgs([
      "--backend-root",
      "stage/backend",
      "--plugin-wheel",
      "stage/nirs4all.whl",
      "--tools-wheel",
      "stage/nirs4all_tools.whl",
      "--verify-only",
    ]);
    expect(parsed).toMatchObject({
      backendRoot: path.resolve("stage/backend"),
      pluginWheel: path.resolve("stage/nirs4all.whl"),
      toolsWheel: path.resolve("stage/nirs4all_tools.whl"),
      verifyOnly: true,
    });
  });

  it("rejects FastAPI server transitives and copied Python backend source", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-plugin-deny-"));
    try {
      const runtimeRoot = path.join(root, "python-runtime", "python");
      const sitePackages = path.join(runtimeRoot, "lib", "python3.11", "site-packages");
      const distInfo = path.join(sitePackages, "fastapi-1.0.dist-info");
      fs.mkdirSync(distInfo, { recursive: true });
      fs.writeFileSync(path.join(distInfo, "METADATA"), "Name: fastapi\nVersion: 1.0\n");
      expect(() =>
        pluginRuntime.assertPluginOnlyPayload(root, runtimeRoot, sitePackages),
      ).toThrow(/forbidden Python backend packages: fastapi/);
      fs.rmSync(distInfo, { recursive: true, force: true });
      fs.writeFileSync(path.join(root, "main.py"), "from fastapi import FastAPI\n");
      expect(() =>
        pluginRuntime.assertPluginOnlyPayload(root, runtimeRoot, sitePackages),
      ).toThrow(/backend source is forbidden/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "materializes only links whose targets remain inside the fresh package root",
    () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-plugin-links-"));
      const external = path.join(os.tmpdir(), `n4a-plugin-external-${process.pid}`);
      try {
        const target = path.join(root, "python3.11");
        const internalLink = path.join(root, "python3");
        const externalLink = path.join(root, "substitution");
        fs.writeFileSync(target, "embedded-cpython");
        fs.writeFileSync(external, "path-substitution");
        fs.symlinkSync("python3.11", internalLink);

        pluginRuntime.materializeInternalRuntimeLinks(root);
        expect(fs.lstatSync(internalLink).isSymbolicLink()).toBe(false);
        expect(fs.readFileSync(internalLink, "utf8")).toBe("embedded-cpython");

        fs.symlinkSync(external, externalLink);
        expect(() => pluginRuntime.materializeInternalRuntimeLinks(root)).toThrow(
          /link escapes its package root/,
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(external, { force: true });
      }
    },
  );

  it("removes empty runtime directories before closure attestation", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-plugin-empty-dirs-"));
    try {
      const emptyLeaf = path.join(root, "share", "nested");
      const retained = path.join(root, "lib", "python3.11");
      fs.mkdirSync(emptyLeaf, { recursive: true });
      fs.mkdirSync(retained, { recursive: true });
      fs.writeFileSync(path.join(retained, "stdlib.py"), "pass\n");

      pluginRuntime.removeEmptyDirectories(root);

      expect(fs.existsSync(path.join(root, "share"))).toBe(false);
      expect(fs.readFileSync(path.join(retained, "stdlib.py"), "utf8")).toBe("pass\n");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
