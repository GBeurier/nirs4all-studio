import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const macRuntime = require("../scripts/macos-attested-runtime.cjs") as {
  isMachO(filePath: string): boolean;
  MACOS_ATTESTED_SIGN_IGNORE: readonly string[];
  signMachO(
    filePath: string,
    options: {
      identity: string;
      entitlementsPath: string;
      keychainFile: string;
      spawnSyncImpl: (
        command: string,
        args: string[],
        options: Record<string, unknown>,
      ) => { status: number; stderr?: string };
    },
  ): void;
  prepareMacosAttestedRuntime(options: {
    backendRoot: string;
    artifactBoundaryRoot: string;
    arch: string;
    signingIdentity: string | null;
    entitlementsPath?: string | null;
    keychainFile?: string | null;
    signMachOImpl?: (filePath: string, options: { identity: string }) => void;
    verifyRuntimeContractImpl: (options: Record<string, unknown>) => {
      pythonRuntimeRoot: string;
      pythonPluginHostPath: string;
      methodsLibraryPath: string | null;
    };
    writeRuntimeContractImpl: (options: Record<string, unknown>) => void;
  }): { machOs: string[] };
  resolveElectronBuilderSigningIdentity(
    context: {
      arch: string;
      packager: {
        platformSpecificBuildOptions: Record<string, unknown>;
        codeSigningInfo: { value: Promise<{ keychainFile: string | null }> };
        forceCodeSigning: boolean;
      };
    },
    findIdentity: (
      type: string,
      qualifier: string | undefined,
      keychain: string | null,
    ) => Promise<{ hash?: string; name: string } | null>,
  ): Promise<string | null>;
};

function writeMachO(filePath: string, payload: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.concat([
    Buffer.from("feedfacf", "hex"),
    Buffer.from(payload),
  ]));
}

function digest(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

describe("macOS attested packaged runtime", () => {
  it("recognizes thin and fat Mach-O magic without trusting extensions", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-macho-magic-"));
    try {
      const thin = path.join(root, "python3");
      const fat = path.join(root, "extension.data");
      const text = path.join(root, "libn4m.dylib");
      fs.writeFileSync(thin, Buffer.from("cffaedfe00", "hex"));
      fs.writeFileSync(fat, Buffer.from("cafebabe00", "hex"));
      fs.writeFileSync(text, "not-mach-o");

      expect(macRuntime.isMachO(thin)).toBe(true);
      expect(macRuntime.isMachO(fat)).toBe(true);
      expect(macRuntime.isMachO(text)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("pre-signs only attested Mach-O members before rewriting their contract", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-macos-attested-"));
    try {
      const backendRoot = path.join(root, "App.app", "Contents", "Resources", "backend");
      const runtimeRoot = path.join(backendRoot, "python-runtime", "python");
      const pythonPath = path.join(runtimeRoot, "bin", "python3");
      const extensionPath = path.join(runtimeRoot, "lib", "python3.11", "site-packages", "native.so");
      const textPath = path.join(runtimeRoot, "lib", "python3.11", "site-packages", "module.py");
      const methodsPath = path.join(backendRoot, "native", "libn4m.dylib");
      const sidecarPath = path.join(backendRoot, "native", "studio-sidecar");
      writeMachO(pythonPath, "python-before-sign");
      writeMachO(extensionPath, "extension-before-sign");
      writeMachO(methodsPath, "methods-before-sign");
      writeMachO(sidecarPath, "sidecar-owned-by-electron-builder");
      fs.writeFileSync(textPath, "print('not code signed')\n");
      const sidecarBefore = digest(sidecarPath);
      const events: string[] = [];
      const verifyRuntimeContractImpl = vi.fn(() => {
        events.push("verify");
        return {
          pythonRuntimeRoot: runtimeRoot,
          pythonPluginHostPath: pythonPath,
          methodsLibraryPath: methodsPath,
        };
      });
      const observedHashes: Record<string, string> = {};
      const writeRuntimeContractImpl = vi.fn((options: Record<string, unknown>) => {
        events.push("write");
        observedHashes.python = digest(pythonPath);
        observedHashes.extension = digest(extensionPath);
        observedHashes.methods = digest(methodsPath);
        expect(options).toMatchObject({
          backendRoot,
          platform: "darwin",
          arch: "arm64",
          methodsLibraryPath: methodsPath,
        });
      });
      const signMachOImpl = vi.fn((filePath: string, options: { identity: string }) => {
        events.push(`sign:${path.basename(filePath)}`);
        expect(options.identity).toBe("DEVELOPER-ID-HASH");
        fs.appendFileSync(filePath, "-signed");
      });

      const result = macRuntime.prepareMacosAttestedRuntime({
        backendRoot,
        artifactBoundaryRoot: path.join(root, "App.app"),
        arch: "arm64",
        signingIdentity: "DEVELOPER-ID-HASH",
        entitlementsPath: path.join(root, "entitlements.plist"),
        signMachOImpl,
        verifyRuntimeContractImpl,
        writeRuntimeContractImpl,
      });

      expect(result.machOs).toEqual([
        methodsPath,
        pythonPath,
        extensionPath,
      ].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))));
      expect(signMachOImpl).toHaveBeenCalledTimes(3);
      expect(events[0]).toBe("verify");
      expect(events.at(-2)).toBe("write");
      expect(events.at(-1)).toBe("verify");
      expect(observedHashes).toEqual({
        python: digest(pythonPath),
        extension: digest(extensionPath),
        methods: digest(methodsPath),
      });
      expect(fs.readFileSync(textPath, "utf8")).toBe("print('not code signed')\n");
      expect(digest(sidecarPath)).toBe(sidecarBefore);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not rewrite the contract after a signing failure", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-macos-sign-failure-"));
    try {
      const backendRoot = path.join(root, "backend");
      const runtimeRoot = path.join(backendRoot, "python-runtime", "python");
      const pythonPath = path.join(runtimeRoot, "bin", "python3");
      writeMachO(pythonPath, "python");
      const writeRuntimeContractImpl = vi.fn();

      expect(() => macRuntime.prepareMacosAttestedRuntime({
        backendRoot,
        artifactBoundaryRoot: root,
        arch: "x64",
        signingIdentity: "DEVELOPER-ID-HASH",
        signMachOImpl: () => {
          throw new Error("codesign rejected member");
        },
        verifyRuntimeContractImpl: () => ({
          pythonRuntimeRoot: runtimeRoot,
          pythonPluginHostPath: pythonPath,
          methodsLibraryPath: null,
        }),
        writeRuntimeContractImpl,
      })).toThrow("codesign rejected member");
      expect(writeRuntimeContractImpl).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("passes the selected identity, keychain, and entitlements to codesign", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-macos-codesign-"));
    try {
      const binaryPath = path.join(root, "native.dylib");
      const entitlementsPath = path.join(root, "entitlements.plist");
      writeMachO(binaryPath, "native");
      fs.writeFileSync(entitlementsPath, "<plist/>\n");
      const calls: Array<{ command: string; args: string[] }> = [];
      macRuntime.signMachO(binaryPath, {
        identity: "DEVELOPER-ID-HASH",
        entitlementsPath,
        keychainFile: "/tmp/release.keychain",
        spawnSyncImpl: (command, args) => {
          calls.push({ command, args });
          return { status: 0 };
        },
      });

      expect(calls).toHaveLength(2);
      expect(calls[0]).toEqual({
        command: "/usr/bin/codesign",
        args: [
          "--force",
          "--sign",
          "DEVELOPER-ID-HASH",
          "--options",
          "runtime",
          "--timestamp",
          "--keychain",
          "/tmp/release.keychain",
          "--entitlements",
          entitlementsPath,
          binaryPath,
        ],
      });
      expect(calls[1]).toEqual({
        command: "/usr/bin/codesign",
        args: ["--verify", "--strict", "--verbose=2", binaryPath],
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a selected libn4m that is not Mach-O", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-macos-methods-format-"));
    try {
      const runtimeRoot = path.join(root, "python-runtime", "python");
      const pythonPath = path.join(runtimeRoot, "bin", "python3");
      const methodsPath = path.join(root, "native", "libn4m.dylib");
      writeMachO(pythonPath, "python");
      fs.mkdirSync(path.dirname(methodsPath), { recursive: true });
      fs.writeFileSync(methodsPath, "ELF-by-mistake");
      const writeRuntimeContractImpl = vi.fn();

      expect(() => macRuntime.prepareMacosAttestedRuntime({
        backendRoot: root,
        artifactBoundaryRoot: root,
        arch: "arm64",
        signingIdentity: "-",
        verifyRuntimeContractImpl: () => ({
          pythonRuntimeRoot: runtimeRoot,
          pythonPluginHostPath: pythonPath,
          methodsLibraryPath: methodsPath,
        }),
        writeRuntimeContractImpl,
      })).toThrow("Methods library is not a Mach-O");
      expect(writeRuntimeContractImpl).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("excludes only the pre-signed closure and libn4m from builder signing", () => {
    const patterns = macRuntime.MACOS_ATTESTED_SIGN_IGNORE.map(
      (source) => new RegExp(source),
    );
    const app = "/tmp/nirs4all Studio.app/Contents/Resources/backend";
    expect(patterns.some((pattern) => pattern.test(`${app}/python-runtime/python/bin/python3`))).toBe(true);
    expect(patterns.some((pattern) => pattern.test(`${app}/native/libn4m.dylib`))).toBe(true);
    expect(patterns.some((pattern) => pattern.test(`${app}/native/studio-sidecar`))).toBe(false);
    expect(patterns.some((pattern) => pattern.test("/tmp/nirs4all Studio.app"))).toBe(false);
  });

  it("uses builder's identity and fails closed when requested signing cannot resolve it", async () => {
    const baseContext = {
      arch: "x64",
      packager: {
        platformSpecificBuildOptions: {},
        codeSigningInfo: { value: Promise.resolve({ keychainFile: "/tmp/release.keychain" }) },
        forceCodeSigning: false,
      },
    };
    const findIdentity = vi.fn(async () => ({
      hash: "DEVELOPER-ID-HASH",
      name: "Developer ID Application: nirs4all",
    }));
    await expect(macRuntime.resolveElectronBuilderSigningIdentity(
      baseContext,
      findIdentity,
    )).resolves.toBe("DEVELOPER-ID-HASH");
    expect(findIdentity).toHaveBeenCalledWith(
      "Developer ID Application",
      undefined,
      "/tmp/release.keychain",
    );

    await expect(macRuntime.resolveElectronBuilderSigningIdentity(
      {
        ...baseContext,
        packager: { ...baseContext.packager, forceCodeSigning: true },
      },
      async () => null,
    )).rejects.toThrow("no identity can pre-sign");
  });
});
