import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import publicMethodsWheel from "../scripts/methods-public-wheel-profile.json";

export const PACKAGED_RUNTIME_CONTRACT_FILE =
  "STUDIO_RUNTIME_CONTRACT.json";
const CONTRACT_SCHEMA = "nirs4all.studio-packaged-runtime.v1";
const MAX_CONTRACT_BYTES = 64 * 1024;
const METHODS_ABI_MAJOR = 2;
const METHODS_ABI_MINOR = 22;
const METHODS_SOURCE_COMMIT = "41b5d4e02e2574a94cd9dad6fcfa6269573b5eed";
const METHODS_SOURCE_TREE = "61406cd2cf11204273a9972e4f268acfde7eb424";
const METHODS_PROJECT_VERSION = "1.3.15";
const WINDOWS_NATIVE_RUNTIME_LINKAGE = {
  profile: "studio-msvc-static-crt-v1",
  methods_cmake_runtime: "MultiThreaded",
  sidecar_rust_target_feature: "+crt-static",
  forbidden_dynamic_import_prefixes: ["MSVCP", "VCRUNTIME"],
} as const;
interface ContractMember {
  path: string;
  size: number;
  sha256: string;
}

interface PackagedRuntimeContract {
  schema: string;
  platform: string;
  arch: string;
  product_backend: string;
  sidecar: ContractMember;
  methods_library: {
    mode: string;
    member: ContractMember | null;
    abi: { major: number; minor: number };
  } & (
    | { source: { commit: string; tree: string; project_version: string }; artifact?: never }
    | { artifact: Omit<typeof publicMethodsWheel.artifact, "kind"> & { kind: "public-wheel" }; source?: never }
  );
  native_runtime_linkage?: {
    profile?: unknown;
    methods_cmake_runtime?: unknown;
    sidecar_rust_target_feature?: unknown;
    forbidden_dynamic_import_prefixes?: unknown;
  };
}

// This is an exact product selection, not a claim about the wheel's source tree.
export function hasExactPublicMethodsArtifact(
  methods: unknown,
  platform: string,
  arch: string,
): boolean {
  if (methods === null || typeof methods !== "object") return false;
  const policy = methods as PackagedRuntimeContract["methods_library"];
  return Object.keys(policy).length === 4 &&
    policy.mode === "bundled-required" &&
    platform === publicMethodsWheel.platform && arch === publicMethodsWheel.arch &&
    isDeepStrictEqual(policy.abi, publicMethodsWheel.abi) &&
    isDeepStrictEqual(policy.artifact, publicMethodsWheel.artifact) &&
    policy.member != null && Object.keys(policy.member).length === 3 &&
    policy.member.path === "native/libn4m.so" &&
    policy.member.size === publicMethodsWheel.library.size &&
    policy.member.sha256 === publicMethodsWheel.library.sha256;
}

export function hasExactWindowsNativeRuntimeLinkage(
  linkage: PackagedRuntimeContract["native_runtime_linkage"],
): boolean {
  return linkage !== undefined &&
    Object.keys(linkage).length === 4 &&
    Object.hasOwn(linkage, "profile") &&
    Object.hasOwn(linkage, "methods_cmake_runtime") &&
    Object.hasOwn(linkage, "sidecar_rust_target_feature") &&
    Object.hasOwn(linkage, "forbidden_dynamic_import_prefixes") &&
    linkage.profile === WINDOWS_NATIVE_RUNTIME_LINKAGE.profile &&
    linkage.methods_cmake_runtime ===
      WINDOWS_NATIVE_RUNTIME_LINKAGE.methods_cmake_runtime &&
    linkage.sidecar_rust_target_feature ===
      WINDOWS_NATIVE_RUNTIME_LINKAGE.sidecar_rust_target_feature &&
    Array.isArray(linkage.forbidden_dynamic_import_prefixes) &&
    linkage.forbidden_dynamic_import_prefixes.length === 2 &&
    linkage.forbidden_dynamic_import_prefixes[0] === "MSVCP" &&
    linkage.forbidden_dynamic_import_prefixes[1] === "VCRUNTIME";
}

export interface VerifiedPackagedRuntime {
  contractPath: string;
  sidecarPath: string;
  methodsLibraryPath: string | null;
  methodsLibraryError: string | null;
}

function hashFile(filePath: string): string {
  const hash = createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function validateMember(
  backendRoot: string,
  label: string,
  member: ContractMember | null | undefined,
  platform: NodeJS.Platform,
  allowPlatformSignature = true,
): string {
  if (
    !member ||
    typeof member.path !== "string" ||
    !Number.isSafeInteger(member.size) ||
    member.size < 1 ||
    typeof member.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(member.sha256)
  ) {
    throw new Error(`Invalid ${label} member in packaged runtime contract`);
  }
  const normalized = path.normalize(member.path);
  if (
    path.isAbsolute(member.path) ||
    normalized === ".." ||
    normalized.startsWith(`..${path.sep}`)
  ) {
    throw new Error(`Invalid ${label} path in packaged runtime contract`);
  }
  const memberPath = path.join(backendRoot, normalized);
  if (!fs.existsSync(memberPath)) {
    throw new Error(`${label} not found: ${memberPath}`);
  }
  const stat = fs.lstatSync(memberPath);
  const backendStat = fs.lstatSync(backendRoot);
  const expectedCanonicalPath = path.resolve(
    fs.realpathSync.native(backendRoot),
    normalized,
  );
  if (
    backendStat.isSymbolicLink() ||
    !backendStat.isDirectory() ||
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    fs.realpathSync.native(memberPath) !== expectedCanonicalPath ||
    ((stat.size !== member.size || hashFile(memberPath) !== member.sha256) &&
      !(allowPlatformSignature && hasValidPlatformSignature(memberPath, platform)))
  ) {
    throw new Error(`${label} integrity mismatch: ${memberPath}`);
  }
  return memberPath;
}

function hasValidPlatformSignature(
  filePath: string,
  platform: NodeJS.Platform,
): boolean {
  if (platform === "darwin") {
    return spawnSync(
      "/usr/bin/codesign",
      ["--verify", "--strict", "--verbose=2", filePath],
      { stdio: "ignore" },
    ).status === 0;
  }
  if (platform === "win32") {
    return spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$signature = Get-AuthenticodeSignature -LiteralPath $args[0]; if ($signature.Status -eq 'Valid') { exit 0 } else { exit 1 }",
        filePath,
      ],
      { stdio: "ignore", windowsHide: true },
    ).status === 0;
  }
  return false;
}

/**
 * Verify the product-owned Rust backend before spawn, and that the packaged
 * application still carries what environment setup needs: the shipped uv and
 * the document adapters. Python itself is never part of the package.
 */
export function verifyPackagedRuntimeContract({
  resourcesPath,
  platform = process.platform,
  arch = process.arch,
}: {
  resourcesPath: string;
  platform?: NodeJS.Platform;
  arch?: string;
}): VerifiedPackagedRuntime {
  const backendRoot = path.join(resourcesPath, "backend");
  const contractPath = path.join(
    backendRoot,
    "native",
    PACKAGED_RUNTIME_CONTRACT_FILE,
  );
  if (!fs.existsSync(contractPath)) {
    throw new Error(`Packaged runtime contract not found: ${contractPath}`);
  }
  const raw = fs.readFileSync(contractPath);
  if (raw.length > MAX_CONTRACT_BYTES) {
    throw new Error("Packaged runtime contract exceeds 64 KiB");
  }
  let contract: PackagedRuntimeContract;
  try {
    contract = JSON.parse(raw.toString("utf8")) as PackagedRuntimeContract;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid packaged runtime contract JSON: ${detail}`);
  }
  if (
    contract.schema !== CONTRACT_SCHEMA ||
    contract.platform !== platform ||
    contract.arch !== arch ||
    contract.product_backend !== "rust-sidecar"
  ) {
    throw new Error("Packaged runtime contract metadata mismatch");
  }
  if (
    (platform === "win32" &&
      !hasExactWindowsNativeRuntimeLinkage(contract.native_runtime_linkage)) ||
    (platform !== "win32" && contract.native_runtime_linkage !== undefined)
  ) {
    throw new Error("Packaged native runtime linkage profile mismatch");
  }
  const expectedSidecar = path.join(
    "native",
    platform === "win32" ? "studio-sidecar.exe" : "studio-sidecar",
  );
  if (path.normalize(contract.sidecar?.path ?? "") !== expectedSidecar) {
    throw new Error("Packaged runtime contract selects an unexpected sidecar path");
  }
  const sidecarPath = validateMember(
    backendRoot,
    "Native Studio sidecar",
    contract.sidecar,
    platform,
  );

  const methods = contract.methods_library;
  if (
    !methods ||
    !["unavailable", "bundled-required"].includes(methods.mode) ||
    methods.abi?.major !== METHODS_ABI_MAJOR ||
    methods.abi?.minor !== METHODS_ABI_MINOR ||
    (Object.hasOwn(methods, "artifact")
      ? !hasExactPublicMethodsArtifact(methods, platform, arch)
      : Object.keys(methods).length !== 4 || !isDeepStrictEqual(methods.source, {
          commit: METHODS_SOURCE_COMMIT,
          tree: METHODS_SOURCE_TREE,
          project_version: METHODS_PROJECT_VERSION,
        }))
  ) {
    throw new Error("Invalid native Methods policy in packaged runtime contract");
  }
  let methodsLibraryPath: string | null = null;
  let methodsLibraryError: string | null = null;
  if (methods.mode === "unavailable") {
    if (methods.member !== null) {
      throw new Error("Unavailable native Methods policy must not select a member");
    }
  } else {
    const expectedMethods = path.join(
      "native",
      platform === "win32"
        ? "n4m.dll"
        : platform === "darwin"
          ? "libn4m.dylib"
          : "libn4m.so",
    );
    try {
      if (path.normalize(methods.member?.path ?? "") !== expectedMethods) {
        throw new Error(
          "Packaged runtime contract selects an unexpected native Methods library",
        );
      }
      methodsLibraryPath = validateMember(
        backendRoot,
        "Bundled native Methods library",
        methods.member,
        platform,
        false,
      );
    } catch (error) {
      methodsLibraryError = error instanceof Error ? error.message : String(error);
    }
  }

  const uvPath = path.join(backendRoot, "tools", platform === "win32" ? "uv.exe" : "uv");
  if (!fs.existsSync(uvPath)) {
    throw new Error(`Packaged uv not found: ${uvPath}`);
  }
  const adaptersPath = path.join(backendRoot, "adapters", "studio_document_adapters");
  if (!fs.existsSync(adaptersPath)) {
    throw new Error(`Packaged document adapters not found: ${adaptersPath}`);
  }

  return { contractPath, sidecarPath, methodsLibraryPath, methodsLibraryError };
}
