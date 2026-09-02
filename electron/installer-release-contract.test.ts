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
      artifactBoundaryRoot: string;
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

function writeWindowsOutputs(stagingRoot: string): string {
  const backendRoot = path.join(stagingRoot, "win-unpacked", "resources", "backend");
  const nativeRoot = path.join(backendRoot, "native");
  fs.mkdirSync(nativeRoot, { recursive: true });
  fs.writeFileSync(path.join(backendRoot, "contract.ok"), "valid");
  fs.writeFileSync(path.join(nativeRoot, "studio-sidecar.exe"), "sidecar");
  fs.writeFileSync(path.join(stagingRoot, "nirs4all Studio Setup 0.10.3.exe"), "nsis");
  fs.writeFileSync(path.join(stagingRoot, "nirs4all Studio-0.10.3-portable.exe"), "portable");
  return backendRoot;
}

function writeMacOutputs(stagingRoot: string): string {
  const appRoot = path.join(stagingRoot, "mac", "nirs4all Studio.app");
  const backendRoot = path.join(appRoot, "Contents", "Resources", "backend");
  const nativeRoot = path.join(backendRoot, "native");
  fs.mkdirSync(nativeRoot, { recursive: true });
  fs.writeFileSync(path.join(backendRoot, "contract.ok"), "valid");
  fs.writeFileSync(path.join(nativeRoot, "studio-sidecar"), "sidecar");
  fs.writeFileSync(path.join(stagingRoot, "nirs4all Studio-0.10.3.dmg"), "dmg");
  return backendRoot;
}

function verifier(options: {
  backendRoot: string;
  artifactBoundaryRoot: string;
  platform: string;
  arch: string;
  requireBundledPythonPlugin: boolean;
}): { sidecarPath: string } {
  expect(["linux", "win32", "darwin"]).toContain(options.platform);
  expect(options.arch).toBe(options.platform === "darwin" ? process.arch : "x64");
  expect(options.requireBundledPythonPlugin).toBe(true);
  const expectedBoundary = options.platform === "darwin"
    ? path.resolve(options.backendRoot, "../../..")
    : path.resolve(options.backendRoot, "../..");
  expect(options.artifactBoundaryRoot).toBe(expectedBoundary);
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
    options.platform === "win32" ? "studio-sidecar.exe" : "studio-sidecar",
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
    ).rejects.toThrow("linux packaged backend component 'backend' is missing");
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

  it("rejects an unpacked resources ancestor symlink to an older valid backend", async () => {
    if (process.platform === "win32") return;
    const root = temporaryRoot();
    const externalResources = path.join(root, "old-package-resources");
    const externalBackend = path.join(externalResources, "backend");
    fs.mkdirSync(path.join(externalBackend, "native"), { recursive: true });
    fs.writeFileSync(path.join(externalBackend, "contract.ok"), "valid");
    fs.writeFileSync(path.join(externalBackend, "native", "studio-sidecar"), "sidecar");

    await expect(contract.packageAndVerifyInstallerOutputs({
      releaseRoot: path.join(root, "release"),
      requestedPlatform: "linux",
      hostPlatform: "linux",
      runBuilder: async (stagingRoot) => {
        fs.mkdirSync(path.join(stagingRoot, "linux-unpacked"));
        fs.symlinkSync(externalResources, path.join(stagingRoot, "linux-unpacked", "resources"));
        fs.writeFileSync(path.join(stagingRoot, "fake.AppImage"), "fake");
        fs.writeFileSync(path.join(stagingRoot, "fake.deb"), "fake");
      },
      verifyRuntimeContract: verifier,
      smokeSidecar: () => undefined,
    })).rejects.toThrow(/component 'resources' must be a real directory/);
  });

  it("rejects a top-level unpacked symlink", async () => {
    if (process.platform === "win32") return;
    const root = temporaryRoot();
    const external = path.join(root, "old-linux-unpacked");
    fs.mkdirSync(path.join(external, "resources", "backend", "native"), { recursive: true });
    fs.writeFileSync(path.join(external, "resources", "backend", "contract.ok"), "valid");
    fs.writeFileSync(path.join(external, "resources", "backend", "native", "studio-sidecar"), "sidecar");

    await expect(contract.packageAndVerifyInstallerOutputs({
      releaseRoot: path.join(root, "release"),
      requestedPlatform: "linux",
      hostPlatform: "linux",
      runBuilder: async (stagingRoot) => {
        fs.symlinkSync(external, path.join(stagingRoot, "linux-unpacked"));
        fs.writeFileSync(path.join(stagingRoot, "fake.AppImage"), "fake");
        fs.writeFileSync(path.join(stagingRoot, "fake.deb"), "fake");
      },
      verifyRuntimeContract: verifier,
      smokeSidecar: () => undefined,
    })).rejects.toThrow(/component 'linux-unpacked' must be a real directory/);
  });

  it.each(["release", "build"])(
    "rejects an initial %s parent symlink without writing through it",
    async (name) => {
      if (process.platform === "win32") return;
      const root = temporaryRoot();
      const external = temporaryRoot();
      fs.symlinkSync(external, path.join(root, name));

      await expect(contract.packageAndVerifyInstallerOutputs({
        releaseRoot: path.join(root, "release"),
        requestedPlatform: "linux",
        hostPlatform: "linux",
        runBuilder: async () => {
          throw new Error("builder must not start");
        },
        verifyRuntimeContract: verifier,
        smokeSidecar: () => undefined,
      })).rejects.toThrow(/must be a real directory/);
      expect(fs.readdirSync(external)).toEqual([]);
    },
  );

  it("rejects a release-root symlink swap during the builder without external writes", async () => {
    if (process.platform === "win32") return;
    const root = temporaryRoot();
    const releaseRoot = path.join(root, "release");
    const external = temporaryRoot();

    await expect(contract.packageAndVerifyInstallerOutputs({
      releaseRoot,
      requestedPlatform: "linux",
      hostPlatform: "linux",
      runBuilder: async (stagingRoot) => {
        writeLinuxOutputs(stagingRoot);
        fs.renameSync(releaseRoot, path.join(root, "release-before-swap"));
        fs.symlinkSync(external, releaseRoot);
      },
      verifyRuntimeContract: verifier,
      smokeSidecar: () => undefined,
    })).rejects.toThrow(/release root.*must be a real directory/i);
    expect(fs.readdirSync(external)).toEqual([]);
  });

  it("rejects a build-root symlink swap and never cleans an external lookalike", async () => {
    if (process.platform === "win32") return;
    const root = temporaryRoot();
    const buildRoot = path.join(root, "build");
    const external = temporaryRoot();
    let externalSentinel = "";

    await expect(contract.packageAndVerifyInstallerOutputs({
      releaseRoot: path.join(root, "release"),
      requestedPlatform: "linux",
      hostPlatform: "linux",
      runBuilder: async (stagingRoot) => {
        writeLinuxOutputs(stagingRoot);
        const externalStaging = path.join(
          external,
          "installer-invocations",
          path.basename(stagingRoot),
        );
        fs.mkdirSync(externalStaging, { recursive: true });
        externalSentinel = path.join(externalStaging, "must-survive");
        fs.writeFileSync(externalSentinel, "outside");
        fs.renameSync(buildRoot, path.join(root, "build-before-swap"));
        fs.symlinkSync(external, buildRoot);
      },
      verifyRuntimeContract: verifier,
      smokeSidecar: () => undefined,
    })).rejects.toThrow(/staging root.*must be a real directory/i);
    expect(fs.readFileSync(externalSentinel, "utf8")).toBe("outside");
  });

  it("refuses rollback through a release symlink swapped during published verify", async () => {
    if (process.platform === "win32") return;
    const root = temporaryRoot();
    const external = temporaryRoot();
    const releaseRoot = path.join(root, "release");
    const oldBackend = writeLinuxOutputs(releaseRoot);
    fs.writeFileSync(path.join(oldBackend, "contract.ok"), "old-release");
    const externalBackend = writeLinuxOutputs(external);
    const externalAppImage = path.join(
      external,
      "nirs4all Studio-0.10.3-linux-x64.AppImage",
    );
    const externalDeb = path.join(
      external,
      "nirs4all Studio-0.10.3-linux-x64.deb",
    );
    fs.writeFileSync(path.join(externalBackend, "contract.ok"), "outside-backend");
    fs.writeFileSync(externalAppImage, "outside-appimage");
    fs.writeFileSync(externalDeb, "outside-deb");
    let verifyCount = 0;

    await expect(contract.packageAndVerifyInstallerOutputs({
      releaseRoot,
      requestedPlatform: "linux",
      hostPlatform: "linux",
      runBuilder: async (stagingRoot) => {
        writeLinuxOutputs(stagingRoot);
      },
      verifyRuntimeContract: (options) => {
        const result = verifier(options);
        verifyCount += 1;
        if (verifyCount === 3) {
          fs.renameSync(releaseRoot, path.join(root, "release-after-swap"));
          fs.symlinkSync(external, releaseRoot);
          throw new Error("forced failure after published verify");
        }
        return result;
      },
      smokeSidecar: () => undefined,
    })).rejects.toThrow(/rollback refused and recovery backup retained/);

    expect(fs.readFileSync(path.join(externalBackend, "contract.ok"), "utf8"))
      .toBe("outside-backend");
    expect(fs.readFileSync(externalAppImage, "utf8")).toBe("outside-appimage");
    expect(fs.readFileSync(externalDeb, "utf8")).toBe("outside-deb");
    const invocationRoot = path.join(root, "build", "installer-invocations");
    const backups = fs.readdirSync(invocationRoot).filter((name) =>
      name.startsWith(".installer-backup-"),
    );
    expect(backups).toHaveLength(1);
    expect(fs.readFileSync(path.join(
      invocationRoot,
      backups[0],
      "linux-unpacked",
      "resources",
      "backend",
      "contract.ok",
    ), "utf8")).toBe("old-release");
  });

  it("rejects a special file in the expected installer artifacts", async () => {
    if (process.platform === "win32") return;
    const root = temporaryRoot();
    await expect(contract.packageAndVerifyInstallerOutputs({
      releaseRoot: path.join(root, "release"),
      requestedPlatform: "linux",
      hostPlatform: "linux",
      runBuilder: async (stagingRoot) => {
        writeLinuxOutputs(stagingRoot);
        const debPath = path.join(stagingRoot, "nirs4all Studio-0.10.3-linux-x64.deb");
        fs.unlinkSync(debPath);
        const made = spawnSync("mkfifo", [debPath]);
        if (made.status !== 0) throw new Error("mkfifo unavailable for special-file test");
      },
      verifyRuntimeContract: verifier,
      smokeSidecar: () => undefined,
    })).rejects.toThrow(/installer artifact must be a real regular file/i);
  });

  it("rejects unexpected fresh top-level outputs instead of promoting them", async () => {
    const root = temporaryRoot();
    await expect(contract.packageAndVerifyInstallerOutputs({
      releaseRoot: path.join(root, "release"),
      requestedPlatform: "linux",
      hostPlatform: "linux",
      runBuilder: async (stagingRoot) => {
        writeLinuxOutputs(stagingRoot);
        fs.writeFileSync(path.join(stagingRoot, "unexpected.payload"), "unverified");
      },
      verifyRuntimeContract: verifier,
      smokeSidecar: () => undefined,
    })).rejects.toThrow("Unexpected fresh electron-builder output");
  });

  it("rolls back prior outputs when a published backend mutates after smoke", async () => {
    const root = temporaryRoot();
    const releaseRoot = path.join(root, "release");
    const oldBackend = writeLinuxOutputs(releaseRoot);
    fs.writeFileSync(path.join(oldBackend, "contract.ok"), "old");
    let smokeCount = 0;

    await expect(contract.packageAndVerifyInstallerOutputs({
      releaseRoot,
      requestedPlatform: "linux",
      hostPlatform: "linux",
      runBuilder: async (stagingRoot) => {
        writeLinuxOutputs(stagingRoot);
      },
      verifyRuntimeContract: verifier,
      smokeSidecar: () => {
        smokeCount += 1;
        if (smokeCount === 2) {
          fs.writeFileSync(
            path.join(releaseRoot, "linux-unpacked", "resources", "backend", "contract.ok"),
            "tampered",
          );
        }
      },
    })).rejects.toThrow("packaged backend contract was mutated");
    expect(
      fs.readFileSync(path.join(oldBackend, "contract.ok"), "utf8"),
    ).toBe("old");
  });

  it("rejects installer artifact mutation during staged sidecar smoke", async () => {
    const root = temporaryRoot();
    let staging = "";
    await expect(contract.packageAndVerifyInstallerOutputs({
      releaseRoot: path.join(root, "release"),
      requestedPlatform: "linux",
      hostPlatform: "linux",
      runBuilder: async (stagingRoot) => {
        staging = stagingRoot;
        writeLinuxOutputs(stagingRoot);
      },
      verifyRuntimeContract: verifier,
      smokeSidecar: () => {
        fs.appendFileSync(
          path.join(staging, "nirs4all Studio-0.10.3-linux-x64.AppImage"),
          "tampered",
        );
      },
    })).rejects.toThrow("installer artifact identity mismatch");
  });

  it("promotes and rehashes allowlisted updater metadata", async () => {
    const root = temporaryRoot();
    const releaseRoot = path.join(root, "release");
    const result = await contract.packageAndVerifyInstallerOutputs({
      releaseRoot,
      requestedPlatform: "linux",
      hostPlatform: "linux",
      runBuilder: async (stagingRoot) => {
        writeLinuxOutputs(stagingRoot);
        fs.writeFileSync(path.join(stagingRoot, "latest-linux.yml"), "version: 0.10.3\n");
      },
      verifyRuntimeContract: verifier,
      smokeSidecar: () => undefined,
    });

    expect(result.producedNames).toContain("latest-linux.yml");
    expect(fs.readFileSync(path.join(releaseRoot, "latest-linux.yml"), "utf8"))
      .toBe("version: 0.10.3\n");
  });

  it("rejects updater metadata mutation during staged smoke", async () => {
    const root = temporaryRoot();
    let staging = "";
    await expect(contract.packageAndVerifyInstallerOutputs({
      releaseRoot: path.join(root, "release"),
      requestedPlatform: "linux",
      hostPlatform: "linux",
      runBuilder: async (stagingRoot) => {
        staging = stagingRoot;
        writeLinuxOutputs(stagingRoot);
        fs.writeFileSync(path.join(stagingRoot, "latest-linux.yml"), "version: 0.10.3\n");
      },
      verifyRuntimeContract: verifier,
      smokeSidecar: () => {
        fs.appendFileSync(path.join(staging, "latest-linux.yml"), "tampered: true\n");
      },
    })).rejects.toThrow("installer artifact identity mismatch");
  });

  it("rejects installer mutation after final staged verify and before promotion", async () => {
    const root = temporaryRoot();
    let staging = "";
    let verifyCount = 0;
    await expect(contract.packageAndVerifyInstallerOutputs({
      releaseRoot: path.join(root, "release"),
      requestedPlatform: "linux",
      hostPlatform: "linux",
      runBuilder: async (stagingRoot) => {
        staging = stagingRoot;
        writeLinuxOutputs(stagingRoot);
      },
      verifyRuntimeContract: (options) => {
        const result = verifier(options);
        verifyCount += 1;
        if (verifyCount === 2) {
          fs.appendFileSync(
            path.join(staging, "nirs4all Studio-0.10.3-linux-x64.deb"),
            "tampered",
          );
        }
        return result;
      },
      smokeSidecar: () => undefined,
    })).rejects.toThrow("installer artifact identity mismatch");
  });

  it("rolls back prior outputs when a published installer mutates after smoke", async () => {
    const root = temporaryRoot();
    const releaseRoot = path.join(root, "release");
    writeLinuxOutputs(releaseRoot);
    const appImage = path.join(
      releaseRoot,
      "nirs4all Studio-0.10.3-linux-x64.AppImage",
    );
    fs.writeFileSync(appImage, "old-appimage");
    let smokeCount = 0;

    await expect(contract.packageAndVerifyInstallerOutputs({
      releaseRoot,
      requestedPlatform: "linux",
      hostPlatform: "linux",
      runBuilder: async (stagingRoot) => {
        writeLinuxOutputs(stagingRoot);
      },
      verifyRuntimeContract: verifier,
      smokeSidecar: () => {
        smokeCount += 1;
        if (smokeCount === 2) {
          fs.appendFileSync(appImage, "tampered");
        }
      },
    })).rejects.toThrow("installer artifact identity mismatch");
    expect(fs.readFileSync(appImage, "utf8")).toBe("old-appimage");
  });

  it("rolls back when mutation lands after the published post-check", async () => {
    const root = temporaryRoot();
    const releaseRoot = path.join(root, "release");
    writeLinuxOutputs(releaseRoot);
    const appImage = path.join(
      releaseRoot,
      "nirs4all Studio-0.10.3-linux-x64.AppImage",
    );
    fs.writeFileSync(appImage, "old-post-check");
    let verifyCount = 0;

    await expect(contract.packageAndVerifyInstallerOutputs({
      releaseRoot,
      requestedPlatform: "linux",
      hostPlatform: "linux",
      runBuilder: async (stagingRoot) => {
        writeLinuxOutputs(stagingRoot);
      },
      verifyRuntimeContract: (options) => {
        const result = verifier(options);
        verifyCount += 1;
        if (verifyCount === 4) {
          fs.appendFileSync(appImage, "tampered-after-post-check");
        }
        return result;
      },
      smokeSidecar: () => undefined,
    })).rejects.toThrow("installer artifact identity mismatch");
    expect(fs.readFileSync(appImage, "utf8")).toBe("old-post-check");
  });

  it("discovers and verifies Linux, Windows and macOS outputs with exact boundaries", async () => {
    const root = temporaryRoot();
    const verify = vi.fn(verifier);
    const result = await contract.packageAndVerifyInstallerOutputs({
      releaseRoot: path.join(root, "release"),
      requestedPlatform: "all",
      hostPlatform: "linux",
      runBuilder: async (stagingRoot) => {
        writeLinuxOutputs(stagingRoot);
        writeWindowsOutputs(stagingRoot);
        writeMacOutputs(stagingRoot);
        fs.writeFileSync(path.join(stagingRoot, "latest-linux.yml"), "linux\n");
        fs.writeFileSync(path.join(stagingRoot, "latest.yml"), "windows\n");
        fs.writeFileSync(path.join(stagingRoot, "latest-mac.yml"), "mac\n");
        fs.writeFileSync(
          path.join(stagingRoot, "nirs4all Studio Setup 0.10.3.exe.blockmap"),
          "windows-blockmap",
        );
        fs.writeFileSync(
          path.join(stagingRoot, "nirs4all Studio-0.10.3.dmg.blockmap"),
          "mac-blockmap",
        );
        if (process.platform !== "win32") {
          const frameworks = path.join(
            stagingRoot,
            "mac",
            "nirs4all Studio.app",
            "Contents",
            "Frameworks",
          );
          fs.mkdirSync(path.join(frameworks, "Versions", "A"), { recursive: true });
          fs.symlinkSync("A", path.join(frameworks, "Versions", "Current"));
        }
      },
      verifyRuntimeContract: verify,
      smokeSidecar: () => undefined,
    });

    expect(result.outputs).toHaveLength(3);
    expect(new Set(verify.mock.calls.map(([options]) => options.platform))).toEqual(
      new Set(["linux", "win32", "darwin"]),
    );
    expect(verify).toHaveBeenCalledTimes(12);
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
