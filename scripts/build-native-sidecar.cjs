#!/usr/bin/env node
/**
 * Build the Rust Studio control-plane binary into the packaged backend tree.
 *
 * Packaged products select this binary as their default backend. Keeping it
 * next to the optional Python library/plugin host gives both processes one
 * product-owned resource layout, without reviving a Python HTTP backend.
 *
 * Usage:
 *   node scripts/build-native-sidecar.cjs [--target <rust-target-triple>]
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const {
  bundledMethodsRelativePath,
  sha256File,
  writeRuntimeContract,
} = require("./native-runtime-contract.cjs");

const projectRoot = path.join(__dirname, "..");
const METHODS_BUILD_SOURCE_ENV = "NIRS4ALL_BUILD_METHODS_LIBRARY";
const METHODS_BUILD_SHA256_ENV = "NIRS4ALL_BUILD_METHODS_SHA256";
const MAX_METHODS_LIBRARY_BYTES = 64 * 1024 * 1024;

const TARGETS = Object.freeze({
  "x86_64-unknown-linux-gnu": { platform: "linux", arch: "x64" },
  "x86_64-pc-windows-msvc": { platform: "win32", arch: "x64" },
  "x86_64-apple-darwin": { platform: "darwin", arch: "x64" },
  "aarch64-apple-darwin": { platform: "darwin", arch: "arm64" },
});

function assertMethodsBuildIdentityConfigured(sourcePath, expectedSha256) {
  if (sourcePath === null || expectedSha256 === null) {
    throw new Error(
      `Native Methods ABI 2.4 is required: set ${METHODS_BUILD_SOURCE_ENV} and ${METHODS_BUILD_SHA256_ENV}`,
    );
  }
}

function getNativeSidecarPaths(
  root = projectRoot,
  platform = process.platform,
  targetTriple = null,
  cargoTargetDir = null,
) {
  const executableName = platform === "win32" ? "studio-sidecar.exe" : "studio-sidecar";
  const targetRoot = cargoTargetDir
    ? path.resolve(cargoTargetDir)
    : path.join(root, "sidecar", "target");
  const targetReleaseDir = targetTriple
    ? path.join(targetRoot, targetTriple, "release")
    : path.join(targetRoot, "release");
  return {
    manifestPath: path.join(root, "sidecar", "Cargo.toml"),
    builtBinaryPath: path.join(targetReleaseDir, executableName),
    packagedBinaryPath: path.join(root, "backend-dist", "native", executableName),
  };
}

function parseArgs(argv = process.argv.slice(2)) {
  let targetTriple = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--target") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--target requires a Rust target triple");
      }
      targetTriple = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--target=")) {
      targetTriple = argument.slice("--target=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (targetTriple !== null && !TARGETS[targetTriple]) {
    throw new Error(`Unsupported native sidecar target: ${targetTriple}`);
  }
  return { targetTriple };
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed (code ${code}, signal ${signal ?? "none"}): ${command} ${args.join(" ")}`));
    });
  });
}

function stagePackagedMethodsLibrary({
  backendRoot,
  platform,
  sourcePath = process.env[METHODS_BUILD_SOURCE_ENV]?.trim() || null,
  expectedSha256 = process.env[METHODS_BUILD_SHA256_ENV]?.trim() || null,
}) {
  if (sourcePath === null && expectedSha256 === null) return null;
  if (sourcePath === null || expectedSha256 === null) {
    throw new Error(
      `${METHODS_BUILD_SOURCE_ENV} and ${METHODS_BUILD_SHA256_ENV} must be provided together`,
    );
  }
  if (!path.isAbsolute(sourcePath) || !/^[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new Error("Native Methods build source must be absolute and content-addressed");
  }
  const normalizedSource = path.resolve(sourcePath);
  const sourceStat = fs.lstatSync(normalizedSource);
  if (
    sourceStat.isSymbolicLink() ||
    !sourceStat.isFile() ||
    sourceStat.size < 1 ||
    sourceStat.size > MAX_METHODS_LIBRARY_BYTES ||
    fs.realpathSync.native(normalizedSource) !== normalizedSource
  ) {
    throw new Error("Native Methods build source must be a bounded canonical non-symlink file");
  }
  if (sha256File(normalizedSource) !== expectedSha256) {
    throw new Error("Native Methods build source SHA-256 mismatch");
  }
  const stagedPath = path.join(backendRoot, bundledMethodsRelativePath(platform));
  fs.mkdirSync(path.dirname(stagedPath), { recursive: true });
  if (fs.realpathSync.native(path.dirname(stagedPath)) !== path.resolve(path.dirname(stagedPath))) {
    throw new Error("Native Methods packaged directory must be canonical and contain no symlinks");
  }
  if (path.resolve(stagedPath) === normalizedSource) return stagedPath;
  let stagedStat = null;
  try {
    stagedStat = fs.lstatSync(stagedPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (stagedStat !== null) {
    if (stagedStat.isSymbolicLink() || !stagedStat.isFile()) {
      throw new Error("Native Methods packaged destination must not be a symlink or special file");
    }
    if (
      fs.realpathSync.native(stagedPath) !== path.resolve(stagedPath) ||
      stagedStat.size !== sourceStat.size ||
      sha256File(stagedPath) !== expectedSha256
    ) {
      throw new Error("Stale native Methods packaged destination differs from the build identity");
    }
    return stagedPath;
  }
  const temporaryPath = `${stagedPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.copyFileSync(normalizedSource, temporaryPath, fs.constants.COPYFILE_EXCL);
    const temporaryStat = fs.lstatSync(temporaryPath);
    if (
      temporaryStat.isSymbolicLink() ||
      !temporaryStat.isFile() ||
      temporaryStat.size !== sourceStat.size ||
      sha256File(temporaryPath) !== expectedSha256
    ) {
      throw new Error("Temporary native Methods stage differs from the build identity");
    }
    fs.renameSync(temporaryPath, stagedPath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
  }
  const finalStat = fs.lstatSync(stagedPath);
  if (
    finalStat.isSymbolicLink() ||
    !finalStat.isFile() ||
    finalStat.size !== sourceStat.size ||
    fs.realpathSync.native(stagedPath) !== path.resolve(stagedPath) ||
    sha256File(stagedPath) !== expectedSha256
  ) {
    throw new Error("Staged native Methods library identity changed after installation");
  }
  return stagedPath;
}

async function buildNativeSidecar({
  root = projectRoot,
  cargo = "cargo",
  platform = process.platform,
  targetTriple = null,
  cargoTargetDir = process.env.CARGO_TARGET_DIR || null,
  methodsLibrarySource = process.env[METHODS_BUILD_SOURCE_ENV]?.trim() || null,
  methodsLibrarySha256 = process.env[METHODS_BUILD_SHA256_ENV]?.trim() || null,
} = {}) {
  assertMethodsBuildIdentityConfigured(methodsLibrarySource, methodsLibrarySha256);
  const target = targetTriple ? TARGETS[targetTriple] : null;
  const targetPlatform = target?.platform ?? platform;
  if (targetTriple && platform !== targetPlatform) {
    throw new Error(
      `Native sidecar target ${targetTriple} is for ${targetPlatform}, not ${platform}`,
    );
  }
  const paths = getNativeSidecarPaths(
    root,
    targetPlatform,
    targetTriple,
    cargoTargetDir,
  );
  const cargoArgs = ["build", "--manifest-path", paths.manifestPath, "--release"];
  if (targetTriple) cargoArgs.push("--target", targetTriple);
  await run(cargo, cargoArgs, root);
  if (!fs.existsSync(paths.builtBinaryPath)) {
    throw new Error(`Native sidecar build did not produce ${paths.builtBinaryPath}`);
  }

  fs.mkdirSync(path.dirname(paths.packagedBinaryPath), { recursive: true });
  fs.copyFileSync(paths.builtBinaryPath, paths.packagedBinaryPath);
  if (platform !== "win32") {
    fs.chmodSync(paths.packagedBinaryPath, 0o755);
  }
  const backendRoot = path.join(root, "backend-dist");
  const methodsLibraryPath = stagePackagedMethodsLibrary({
    backendRoot,
    platform: targetPlatform,
    sourcePath: methodsLibrarySource,
    expectedSha256: methodsLibrarySha256,
  });
  if (methodsLibraryPath === null) {
    throw new Error(
      `Native Methods ABI 2.4 is required: set ${METHODS_BUILD_SOURCE_ENV} and ${METHODS_BUILD_SHA256_ENV}`,
    );
  }
  const contract = writeRuntimeContract({
    backendRoot,
    platform: targetPlatform,
    arch: target?.arch ?? process.arch,
    methodsLibraryPath,
  });
  paths.runtimeContractPath = contract.contractPath;
  return paths.packagedBinaryPath;
}

if (require.main === module) {
  let options;
  try {
    options = parseArgs();
  } catch (error) {
    console.error(`Native sidecar build configuration failed: ${error.message}`);
    process.exit(1);
  }
  buildNativeSidecar(options)
    .then((binaryPath) => console.log(`Native Studio sidecar packaged at ${binaryPath}`))
    .catch((error) => {
      console.error(`Native sidecar build failed: ${error.message}`);
      process.exit(1);
    });
}

module.exports = {
  assertMethodsBuildIdentityConfigured,
  buildNativeSidecar,
  getNativeSidecarPaths,
  parseArgs,
  stagePackagedMethodsLibrary,
};
