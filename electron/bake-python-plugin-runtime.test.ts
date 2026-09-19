import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const pluginRuntime = require("../scripts/bake-python-plugin-runtime.cjs") as {
  assertClosedTree(runtimeRoot: string): void;
  assertConstraintsIdentity(path?: string, expectedSha256?: string): void;
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
  verifyPluginRuntime(options: { backendRoot: string; writeMarker: boolean }): unknown;
};

function stagedRuntimeFixture(root: string) {
  const runtimeRoot = path.join(root, "python-runtime", "python");
  const sitePackages = process.platform === "win32"
    ? path.join(runtimeRoot, "Lib", "site-packages")
    : path.join(runtimeRoot, "lib", "python3.11", "site-packages");
  fs.mkdirSync(sitePackages, { recursive: true });
  for (const [name, version] of pluginRuntime.constrainedDistributionVersions()) {
    const directory = path.join(sitePackages, `${name}-${version}.dist-info`);
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, "METADATA"), `Name: ${name}\nVersion: ${version}\n`);
  }
  const marker = path.join(root, "python-runtime", "PLUGIN_RUNTIME_READY.json");
  fs.writeFileSync(marker, JSON.stringify(pluginRuntime.expectedMarker()));
  return { runtimeRoot, sitePackages, marker };
}

describe("plugin-only CPython runtime", () => {
  it.each(["missing", "wrong-version", "duplicate"])(
    "revokes readiness when actual staged package metadata is %s",
    (failure) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-plugin-finalize-"));
      try {
        const { sitePackages, marker } = stagedRuntimeFixture(root);
        const version = pluginRuntime.constrainedDistributionVersions().get("shap");
        const distribution = path.join(sitePackages, `shap-${version}.dist-info`);
        if (failure === "missing") fs.rmSync(distribution, { recursive: true });
        else if (failure === "wrong-version") {
          fs.writeFileSync(path.join(distribution, "METADATA"), "Name: shap\nVersion: 0.0.0\n");
        } else {
          const duplicate = path.join(sitePackages, "shap-0.0.0.dist-info");
          fs.mkdirSync(duplicate);
          fs.writeFileSync(path.join(duplicate, "METADATA"), "Name: shap\nVersion: 0.0.0\n");
        }
        expect(() => pluginRuntime.verifyPluginRuntime({ backendRoot: root, writeMarker: true }))
          .toThrow(/closure drift|Duplicate installed distribution/);
        expect(fs.existsSync(marker)).toBe(false);
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  );

  it("refuses stale installed adapters without leaving a ready marker", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-plugin-adapter-refusal-"));
    try {
      const { sitePackages, marker } = stagedRuntimeFixture(root);
      const { installAdapters } = require("../scripts/studio-document-adapters.cjs");
      installAdapters(process.cwd(), sitePackages);
      fs.appendFileSync(path.join(sitePackages, "studio_document_adapters", "api", "library_documents.py"), "\n# changed\n");
      expect(() => pluginRuntime.verifyPluginRuntime({ backendRoot: root, writeMarker: true }))
        .toThrow(/Adapter member differs/);
      expect(fs.existsSync(marker)).toBe(false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it.skipIf(process.platform === "win32")("executes an isolated cold-cache probe and revokes readiness on process failure", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-plugin-probe-refusal-"));
    try {
      const { runtimeRoot, marker } = stagedRuntimeFixture(root);
      const executable = path.join(runtimeRoot, "bin", "python3");
      const evidence = path.join(root, "probe.json");
      fs.mkdirSync(path.dirname(executable));
      fs.writeFileSync(executable, `#!${process.execPath}\n` + [
        'const fs = require("node:fs");',
        'if (process.argv.some(value => value.includes("import compileall,"))) process.exit(0);',
        `fs.writeFileSync(${JSON.stringify(evidence)}, JSON.stringify({ args: process.argv.slice(2),`,
        'cache: process.env.MPLCONFIGDIR, backend: process.env.MPLBACKEND,',
        'files: fs.readdirSync(process.env.MPLCONFIGDIR) }));',
        'process.stderr.write("fixture import failed"); process.exit(23);',
      ].join("\n"), { mode: 0o755 });
      expect(() => pluginRuntime.verifyPluginRuntime({ backendRoot: root, writeMarker: true }))
        .toThrow(/preflight failed: fixture import failed/);
      const probe = JSON.parse(fs.readFileSync(evidence, "utf8"));
      expect(probe.args.slice(0, 4)).toEqual(["-I", "-S", "-B", "-c"]);
      expect(probe.backend).toBe("Agg");
      expect(probe.files).toEqual([]);
      expect(fs.existsSync(probe.cache)).toBe(false);
      expect(fs.existsSync(marker)).toBe(false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it.each([0, 1, 2, 3])("allows only checked-hash bytecode (flags %i)", (flags) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-bytecode-policy-"));
    try {
      const cache = path.join(root, "__pycache__");
      fs.mkdirSync(cache);
      const header = Buffer.alloc(16);
      header.writeUInt32LE(flags, 4);
      fs.writeFileSync(path.join(cache, "sample.cpython-311.pyc"), header);
      if (flags === 3) expect(() => pluginRuntime.assertClosedTree(root)).not.toThrow();
      else expect(() => pluginRuntime.assertClosedTree(root)).toThrow(/checked source hashes/);
      fs.renameSync(path.join(cache, "sample.cpython-311.pyc"), path.join(root, "sample.pyc"));
      expect(() => pluginRuntime.assertClosedTree(root)).toThrow(/checked source hashes/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it("warms only the trusted Windows platform probe before enforcing the spawn audit hook", () => {
    const platformProbe = pluginRuntime.PREFLIGHT.indexOf("platform.machine()\n");
    const auditHook = pluginRuntime.PREFLIGHT.indexOf("sys.addaudithook(deny)\n");
    const pluginImport = pluginRuntime.PREFLIGHT.indexOf("import nirs4all");

    expect(platformProbe).toBeGreaterThan(-1);
    expect(platformProbe).toBeLessThan(auditHook);
    expect(auditHook).toBeLessThan(pluginImport);
    expect(pluginRuntime.PREFLIGHT).toContain(
      'if event in {"subprocess.Popen","os.system","os.spawn","os.posix_spawn","os.fork","os.forkpty","os.exec","pty.spawn"}: raise PermissionError("spawn denied")',
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
        sha256: "8a9430806d2fb316ba5a415cd03982bb5a4ea71535cd828fe1b9bdbb40348619",
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
      "8a9430806d2fb316ba5a415cd03982bb5a4ea71535cd828fe1b9bdbb40348619",
    );
    expect(fs.readFileSync(path.join(process.cwd(), ".gitattributes"), "utf8")).toContain(
      "build/constraints/*.txt text eol=lf",
    );
    const linux = pluginRuntime.constrainedDistributionVersions("linux", "x64");
    const linuxArm = pluginRuntime.constrainedDistributionVersions("linux", "arm64");
    const macArm = pluginRuntime.constrainedDistributionVersions("darwin", "arm64");
    const macIntel = pluginRuntime.constrainedDistributionVersions("darwin", "x64");
    const windows = pluginRuntime.constrainedDistributionVersions("win32", "x64");
    const { PLUGIN_HOST_PACKAGES } = require("../scripts/python-runtime-config.cjs") as {
      PLUGIN_HOST_PACKAGES: string[];
    };
    for (const spec of PLUGIN_HOST_PACKAGES) {
      const [name, version] = spec.split("==");
      for (const target of [linux, linuxArm, macArm, macIntel, windows]) {
        expect(target.get(name), `${name} must be installed in every packaged host`).toBe(version);
      }
    }
    expect(linux.get("nirs4all")).toBe("1.0.1");
    expect(linux.get("nirs4all-core")).toBe("0.3.30");
    expect(linux.get("scikit-learn")).toBe("1.9.0");
    expect(linux.has("colorama")).toBe(false);
    expect(linux.has("tzdata")).toBe(false);
    expect(linuxArm.get("greenlet")).toBe("3.5.5");
    expect(macArm.has("greenlet")).toBe(false);
    expect(windows.get("colorama")).toBe("0.4.6");
    expect(windows.get("tzdata")).toBe("2025.3");
    expect(macIntel.get("numpy")).toBe("2.3.5");
    expect(macIntel.get("numba")).toBe("0.62.1");
    expect(macIntel.get("llvmlite")).toBe("0.45.1");
    for (const target of [linux, linuxArm, macArm, windows]) {
      expect(target.get("numpy")).toBe("2.4.6");
      expect(target.get("numba")).toBe("0.67.0");
      expect(target.get("llvmlite")).toBe("0.49.0");
    }
  });

  it("binds constraints to checkout bytes and rejects CRLF substitution", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-constraints-bytes-"));
    try {
      const file = path.join(root, "constraints.txt");
      const canonical = "numpy==2.4.6\ngreenlet==3.5.5\n";
      fs.writeFileSync(file, canonical);
      const expected = crypto
        .createHash("sha256")
        .update(canonical)
        .digest("hex");
      expect(() => pluginRuntime.assertConstraintsIdentity(file, expected)).not.toThrow();
      fs.writeFileSync(file, canonical.replaceAll("\n", "\r\n"));
      expect(() => pluginRuntime.assertConstraintsIdentity(file, expected)).toThrow(
        /constraints identity mismatch: expected [0-9a-f]{64}, got [0-9a-f]{64}/,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
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
