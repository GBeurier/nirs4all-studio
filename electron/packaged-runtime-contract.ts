import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const PACKAGED_RUNTIME_CONTRACT_FILE =
  "STUDIO_RUNTIME_CONTRACT.json";
const CONTRACT_SCHEMA = "nirs4all.studio-packaged-runtime.v1";
const MAX_CONTRACT_BYTES = 64 * 1024;
const PYTHON_CLOSURE_SCHEMA = "nirs4all.studio-python-plugin-closure.v1";
const MAX_PYTHON_CLOSURE_BYTES = 32 * 1024 * 1024;
const MAX_PYTHON_CLOSURE_FILES = 100_000;
const MAX_PYTHON_CLOSURE_DIRECTORIES = 100_000;

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
  python_role: string;
  sidecar: ContractMember;
  python_plugin_host: {
    mode: string;
    member: ContractMember | null;
    closure: ContractMember | null;
    runtime_root: string | null;
    site_packages: string | null;
  };
  methods_library: {
    mode: string;
    member: ContractMember | null;
    abi: { major: number; minor: number };
  };
}

export interface VerifiedPackagedRuntime {
  contractPath: string;
  sidecarPath: string;
  pythonPluginHostPath: string | null;
  pythonPluginHostError: string | null;
  pythonClosurePath: string | null;
  pythonRuntimeRoot: string | null;
  pythonSitePackagesPath: string | null;
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

function validateCanonicalDirectory(
  directoryPath: string,
  label: string,
  boundaryRoot = directoryPath,
): void {
  const stat = fs.lstatSync(directoryPath);
  const relative = path.relative(
    path.resolve(boundaryRoot),
    path.resolve(directoryPath),
  );
  const expected = path.resolve(fs.realpathSync.native(boundaryRoot), relative);
  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    fs.realpathSync.native(directoryPath) !== expected
  ) {
    throw new Error(`${label} must be a canonical non-symlink directory`);
  }
}

interface ClosureFile {
  path: string;
  size: number;
  sha256: string;
}

function collectRuntimeClosure(runtimeRoot: string): {
  files: ClosureFile[];
  directories: string[];
} {
  validateCanonicalDirectory(runtimeRoot, "Bundled Python runtime root");
  const files: ClosureFile[] = [];
  const directories: string[] = [];
  const pending = [runtimeRoot];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) break;
    validateCanonicalDirectory(
      directory,
      "Bundled Python runtime directory",
      runtimeRoot,
    );
    if (directories.length >= MAX_PYTHON_CLOSURE_DIRECTORIES) {
      throw new Error(
        "Bundled Python runtime exceeds the 100000-directory closure limit",
      );
    }
    directories.push(
      path.relative(runtimeRoot, directory).split(path.sep).join("/"),
    );
    const entries = fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      const stat = fs.lstatSync(entryPath);
      if (stat.isSymbolicLink()) {
        throw new Error(
          `Bundled Python runtime must not contain symlinks: ${entryPath}`,
        );
      }
      if (stat.isDirectory()) {
        pending.push(entryPath);
        continue;
      }
      if (!stat.isFile()) {
        throw new Error(
          `Bundled Python runtime contains a special file: ${entryPath}`,
        );
      }
      if (files.length >= MAX_PYTHON_CLOSURE_FILES) {
        throw new Error(
          "Bundled Python runtime exceeds the 100000-file closure limit",
        );
      }
      files.push({
        path: path.relative(runtimeRoot, entryPath).split(path.sep).join("/"),
        size: stat.size,
        sha256: hashFile(entryPath),
      });
    }
  }
  return {
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
    directories: directories.sort(),
  };
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

function verifyPythonRuntimeClosure(
  backendRoot: string,
  plugin: PackagedRuntimeContract["python_plugin_host"],
  platform: NodeJS.Platform,
): {
  closurePath: string;
  runtimeRoot: string;
  sitePackagesPath: string;
} {
  const normalizedSitePackages =
    typeof plugin.site_packages === "string"
      ? path.normalize(plugin.site_packages).split(path.sep).join("/")
      : null;
  if (
    plugin.runtime_root !== "python-runtime/python" ||
    typeof plugin.site_packages !== "string" ||
    normalizedSitePackages !== plugin.site_packages ||
    !plugin.site_packages.startsWith("python-runtime/python/")
  ) {
    throw new Error(
      "Invalid bundled Python closure paths in packaged runtime contract",
    );
  }
  const closurePath = validateMember(
    backendRoot,
    "Bundled Python closure manifest",
    plugin.closure,
    platform,
    false,
  );
  const encoded = fs.readFileSync(closurePath);
  if (encoded.length > MAX_PYTHON_CLOSURE_BYTES) {
    throw new Error("Bundled Python closure manifest exceeds 32 MiB");
  }
  const closure = JSON.parse(encoded.toString("utf8")) as {
    schema?: unknown;
    root?: unknown;
    site_packages?: unknown;
    directories?: unknown;
    files?: unknown;
  };
  if (
    closure.schema !== PYTHON_CLOSURE_SCHEMA ||
    closure.root !== plugin.runtime_root ||
    closure.site_packages !== plugin.site_packages ||
    !Array.isArray(closure.directories) ||
    closure.directories.length < 1 ||
    closure.directories.length > MAX_PYTHON_CLOSURE_DIRECTORIES ||
    !Array.isArray(closure.files) ||
    closure.files.length < 1 ||
    closure.files.length > MAX_PYTHON_CLOSURE_FILES
  ) {
    throw new Error("Invalid bundled Python closure manifest");
  }
  const runtimeRoot = path.join(
    backendRoot,
    ...plugin.runtime_root.split("/"),
  );
  const actualClosure = collectRuntimeClosure(runtimeRoot);
  const actualDirectories = actualClosure.directories;
  const expectedDirectories = closure.directories as string[];
  if (
    actualDirectories.length !== expectedDirectories.length ||
    actualDirectories.some(
      (directory, index) => directory !== expectedDirectories[index],
    )
  ) {
    throw new Error(
      "Bundled Python runtime closure directory inventory mismatch",
    );
  }
  const actual = actualClosure.files;
  const expected = closure.files as ClosureFile[];
  if (actual.length !== expected.length) {
    throw new Error("Bundled Python runtime closure inventory mismatch");
  }
  for (let index = 0; index < actual.length; index += 1) {
    if (
      expected[index]?.path !== actual[index].path ||
      expected[index]?.size !== actual[index].size ||
      expected[index]?.sha256 !== actual[index].sha256
    ) {
      throw new Error(
        `Bundled Python runtime closure mismatch: ${actual[index].path}`,
      );
    }
  }
  const sitePackagesPath = path.join(
    backendRoot,
    ...plugin.site_packages.split("/"),
  );
  validateCanonicalDirectory(
    sitePackagesPath,
    "Bundled Python site-packages",
    runtimeRoot,
  );
  return { closurePath, runtimeRoot, sitePackagesPath };
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
 * Verify the product-owned Rust backend before spawn. A missing or altered
 * bundled CPython disables only the explicit library/plugin host; it never
 * changes the selected product backend or starts an HTTP compatibility server.
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
    contract.product_backend !== "rust-sidecar" ||
    contract.python_role !== "library-plugin-host-only"
  ) {
    throw new Error("Packaged runtime contract metadata mismatch");
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
    methods.abi?.major !== 2 ||
    methods.abi?.minor !== 2
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

  const plugin = contract.python_plugin_host;
  if (!plugin || !["unavailable", "bundled-required"].includes(plugin.mode)) {
    throw new Error("Invalid Python plugin-host policy in packaged runtime contract");
  }
  if (plugin.mode === "unavailable") {
    if (
      plugin.member !== null ||
      plugin.closure !== null ||
      plugin.runtime_root !== null ||
      plugin.site_packages !== null
    ) {
      throw new Error(
        "Unavailable Python plugin-host policy must not select packaged members",
      );
    }
    return {
      contractPath,
      sidecarPath,
      pythonPluginHostPath: null,
      pythonPluginHostError: null,
      pythonClosurePath: null,
      pythonRuntimeRoot: null,
      pythonSitePackagesPath: null,
      methodsLibraryPath,
      methodsLibraryError,
    };
  }

  const expectedPython = platform === "win32"
    ? path.join("python-runtime", "python", "python.exe")
    : path.join("python-runtime", "python", "bin", "python3");
  try {
    if (path.normalize(plugin.member?.path ?? "") !== expectedPython) {
      throw new Error(
        "Packaged runtime contract selects an unexpected Python plugin host",
      );
    }
    const pythonPluginHostPath = validateMember(
      backendRoot,
      "Bundled Python plugin host",
      plugin.member,
      platform,
    );
    const closure = verifyPythonRuntimeClosure(backendRoot, plugin, platform);
    return {
      contractPath,
      sidecarPath,
      pythonPluginHostPath,
      pythonPluginHostError: null,
      pythonClosurePath: closure.closurePath,
      pythonRuntimeRoot: closure.runtimeRoot,
      pythonSitePackagesPath: closure.sitePackagesPath,
      methodsLibraryPath,
      methodsLibraryError,
    };
  } catch (error) {
    return {
      contractPath,
      sidecarPath,
      pythonPluginHostPath: null,
      pythonPluginHostError:
        error instanceof Error ? error.message : String(error),
      pythonClosurePath: null,
      pythonRuntimeRoot: null,
      pythonSitePackagesPath: null,
      methodsLibraryPath,
      methodsLibraryError,
    };
  }
}
