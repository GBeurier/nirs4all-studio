import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const contractModulePath = path.resolve(
  "scripts/installer-release-contract.cjs",
);
const contract = require(contractModulePath) as {
  packageAndVerifyInstallerOutputs(options: {
    releaseRoot: string;
    requestedPlatform: string;
    hostPlatform?: string;
    runBuilder(stagingRoot: string): Promise<void>;
    verifyRuntimeContract(options: {
      backendRoot: string;
      platform: string;
      arch: string;
      requireBundledPythonPlugin: boolean;
    }): { sidecarPath: string };
    smokeSidecar?(sidecarPath: string): void;
  }): Promise<{
    producedNames: string[];
    outputs: Array<{ backendRoot: string }>;
  }>;
};

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "nirs4all-installer-contract-test-"),
  );
  temporaryRoots.push(root);
  return root;
}

function writeLinuxOutputs(stagingRoot: string): string {
  const backendRoot = path.join(
    stagingRoot,
    "linux-unpacked",
    "resources",
    "backend",
  );
  const nativeRoot = path.join(backendRoot, "native");
  fs.mkdirSync(nativeRoot, { recursive: true });
  fs.writeFileSync(path.join(backendRoot, "contract.ok"), "valid");
  fs.writeFileSync(path.join(nativeRoot, "studio-sidecar"), "sidecar");
  fs.writeFileSync(
    path.join(stagingRoot, "nirs4all Studio-0.10.3-linux-x64.AppImage"),
    "appimage",
  );
  fs.writeFileSync(
    path.join(stagingRoot, "nirs4all Studio-0.10.3-linux-x64.deb"),
    "deb",
  );
  return backendRoot;
}

function verifier(options: {
  backendRoot: string;
  platform: string;
  arch: string;
  requireBundledPythonPlugin: boolean;
}): { sidecarPath: string } {
  expect(options.platform).toBe("linux");
  expect(options.arch).toBe("x64");
  expect(options.requireBundledPythonPlugin).toBe(true);
  const markerPath = path.join(options.backendRoot, "contract.ok");
  if (!fs.existsSync(markerPath)) {
    throw new Error("packaged backend contract was removed");
  }
  if (fs.readFileSync(markerPath, "utf8") !== "valid") {
    throw new Error("packaged backend contract was mutated");
  }
  const sidecarPath = path.join(
    options.backendRoot,
    "native",
    "studio-sidecar",
  );
  if (!fs.existsSync(sidecarPath)) {
    throw new Error("packaged sidecar was removed");
  }
  return { sidecarPath };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("installer release post-package contract", () => {
  it("publishes only the fresh, unambiguous invocation after two-stage verification", async () => {
    const root = temporaryRoot();
    const releaseRoot = path.join(root, "release");
    const verify = vi.fn(verifier);
    const smoke = vi.fn();

    const result = await contract.packageAndVerifyInstallerOutputs({
      releaseRoot,
      requestedPlatform: "linux",
      hostPlatform: "linux",
      runBuilder: async (stagingRoot) => {
        writeLinuxOutputs(stagingRoot);
      },
      verifyRuntimeContract: verify,
      smokeSidecar: smoke,
    });

    expect(result.producedNames).toEqual([
      "linux-unpacked",
      "nirs4all Studio-0.10.3-linux-x64.AppImage",
      "nirs4all Studio-0.10.3-linux-x64.deb",
    ]);
    expect(result.outputs[0]?.backendRoot).toBe(
      path.join(releaseRoot, "linux-unpacked", "resources", "backend"),
    );
    expect(verify).toHaveBeenCalledTimes(4);
    expect(smoke).toHaveBeenCalledTimes(2);
  });

  it("rejects a successful builder exit with expected outputs absent", async () => {
    const root = temporaryRoot();
    await expect(
      contract.packageAndVerifyInstallerOutputs({
        releaseRoot: path.join(root, "release"),
        requestedPlatform: "linux",
        hostPlatform: "linux",
        runBuilder: async (stagingRoot) => {
          fs.writeFileSync(path.join(stagingRoot, "builder-debug.yml"), "ok");
        },
        verifyRuntimeContract: verifier,
        smokeSidecar: () => undefined,
      }),
    ).rejects.toThrow("Linux unpacked application must resolve to exactly one");
  });

  it("rejects stale-only release outputs from a prior invocation", async () => {
    const root = temporaryRoot();
    const releaseRoot = path.join(root, "release");
    writeLinuxOutputs(releaseRoot);

    await expect(
      contract.packageAndVerifyInstallerOutputs({
        releaseRoot,
        requestedPlatform: "linux",
        hostPlatform: "linux",
        runBuilder: async () => undefined,
        verifyRuntimeContract: verifier,
        smokeSidecar: () => undefined,
      }),
    ).rejects.toThrow("stale release artifacts are not accepted");
  });

  it("rejects ambiguous unpacked outputs", async () => {
    const root = temporaryRoot();
    await expect(
      contract.packageAndVerifyInstallerOutputs({
        releaseRoot: path.join(root, "release"),
        requestedPlatform: "linux",
        hostPlatform: "linux",
        runBuilder: async (stagingRoot) => {
          writeLinuxOutputs(stagingRoot);
          fs.cpSync(
            path.join(stagingRoot, "linux-unpacked"),
            path.join(stagingRoot, "linux-x64-unpacked"),
            { recursive: true },
          );
        },
        verifyRuntimeContract: verifier,
        smokeSidecar: () => undefined,
      }),
    ).rejects.toThrow("Linux unpacked application must resolve to exactly one");
  });

  it("rejects backend deletion after electron-builder returns", async () => {
    const root = temporaryRoot();
    await expect(
      contract.packageAndVerifyInstallerOutputs({
        releaseRoot: path.join(root, "release"),
        requestedPlatform: "linux",
        hostPlatform: "linux",
        runBuilder: async (stagingRoot) => {
          const backendRoot = writeLinuxOutputs(stagingRoot);
          fs.rmSync(backendRoot, { recursive: true });
        },
        verifyRuntimeContract: verifier,
        smokeSidecar: () => undefined,
      }),
    ).rejects.toThrow("linux packaged backend is missing");
  });

  it("rejects backend mutation after electron-builder returns", async () => {
    const root = temporaryRoot();
    await expect(
      contract.packageAndVerifyInstallerOutputs({
        releaseRoot: path.join(root, "release"),
        requestedPlatform: "linux",
        hostPlatform: "linux",
        runBuilder: async (stagingRoot) => {
          const backendRoot = writeLinuxOutputs(stagingRoot);
          fs.writeFileSync(path.join(backendRoot, "contract.ok"), "tampered");
        },
        verifyRuntimeContract: verifier,
        smokeSidecar: () => undefined,
      }),
    ).rejects.toThrow("packaged backend contract was mutated");
  });

  it("exits non-zero when the post-package command sees no fresh outputs", () => {
    const root = temporaryRoot();
    const script = `
const contract = require(${JSON.stringify(contractModulePath)});
contract.packageAndVerifyInstallerOutputs({
  releaseRoot: ${JSON.stringify(path.join(root, "release"))},
  requestedPlatform: "linux",
  hostPlatform: "linux",
  runBuilder: async () => undefined,
  verifyRuntimeContract: () => ({ sidecarPath: "unused" }),
  smokeSidecar: () => undefined,
}).catch((error) => { console.error(error.message); process.exit(7); });
`;
    const completed = spawnSync(process.execPath, ["-e", script], {
      encoding: "utf8",
    });

    expect(completed.status).toBe(7);
    expect(completed.stderr).toContain("stale release artifacts are not accepted");
  });
});
