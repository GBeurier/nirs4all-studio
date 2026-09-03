import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const pluginRuntime = require("../scripts/bake-python-plugin-runtime.cjs") as {
  FORBIDDEN_DISTRIBUTIONS: readonly string[];
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
  it("pins the selected release source and wheel in the exact role marker", () => {
    expect(pluginRuntime.expectedMarker("linux", "x64")).toMatchObject({
      schema: "nirs4all.studio-python-plugin-runtime.v1",
      python_role: "library-plugin-host-only",
      product_backend: "rust-sidecar",
      http_listener: "forbidden",
      source_commit: "3a38f589e5acbda58c5d071c95036f2572972ecd",
      wheel_sha256:
        "906c151a80c3bbdf2ef1264b904a8fd61a2a67fbe0ded2cba92453e44fbce230",
      platform: "linux",
      arch: "x64",
      conversion_tools: {
        source_commit: "e3a332633f87b4652a06f8993e63c386a3568698",
        wheel_sha256:
          "372ecec41b18c25c607fd660060f19780cdaf8aea378239fa5ade5a61d81c8dc",
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
