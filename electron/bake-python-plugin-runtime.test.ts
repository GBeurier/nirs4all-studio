import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const pluginRuntime = require("../scripts/bake-python-plugin-runtime.cjs") as {
  FORBIDDEN_DISTRIBUTIONS: readonly string[];
  PLUGIN_CONSTRAINTS_PATH: string;
  PLUGIN_CONSTRAINTS_SHA256: string;
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
  constrainedDistributionVersions(platform?: string, arch?: string): Map<string, string>;
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
      source_commit: "bf21c552b9d0929daf2dcc2ac7b220c9631ffa07",
      wheel_sha256:
        "d6f696580d4e52aeb6d39ecce47d30b3e10dc0b867f88f89f39dc1205cf93103",
      distribution_version: "1.0.1",
      installed_manifest_sha256:
        "768e65e0ca900f1a50a88a01f6c09cc7870ce033383cac5c968bfac8fee25bbe",
      constraints: {
        path: "build/constraints/plugin-runtime-cpython311.txt",
        sha256: "0b11bc09f82a7806055b18fc478ece69554e00932f7d0138656804a57d36ccb1",
      },
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

  it("loads an exact deterministic distribution closure with bounded platform additions", () => {
    expect(pluginRuntime.PLUGIN_CONSTRAINTS_PATH).toBe(
      path.join(process.cwd(), "build", "constraints", "plugin-runtime-cpython311.txt"),
    );
    expect(pluginRuntime.PLUGIN_CONSTRAINTS_SHA256).toBe(
      "0b11bc09f82a7806055b18fc478ece69554e00932f7d0138656804a57d36ccb1",
    );
    const linux = pluginRuntime.constrainedDistributionVersions("linux", "x64");
    const linuxArm = pluginRuntime.constrainedDistributionVersions("linux", "arm64");
    const macArm = pluginRuntime.constrainedDistributionVersions("darwin", "arm64");
    const windows = pluginRuntime.constrainedDistributionVersions("win32", "x64");
    expect(linux.get("nirs4all")).toBe("1.0.1");
    expect(linux.get("nirs4all-core")).toBe("0.3.30");
    expect(linux.get("scikit-learn")).toBe("1.9.0");
    expect(linux.has("colorama")).toBe(false);
    expect(linux.has("tzdata")).toBe(false);
    expect(linuxArm.get("greenlet")).toBe("3.5.5");
    expect(macArm.has("greenlet")).toBe(false);
    expect(windows.get("colorama")).toBe("0.4.6");
    expect(windows.get("tzdata")).toBe("2025.3");
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
      constraints: pluginRuntime.PLUGIN_CONSTRAINTS_PATH,
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
