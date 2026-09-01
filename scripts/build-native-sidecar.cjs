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
const { writeRuntimeContract } = require("./native-runtime-contract.cjs");

const projectRoot = path.join(__dirname, "..");

const TARGETS = Object.freeze({
  "x86_64-unknown-linux-gnu": { platform: "linux", arch: "x64" },
  "x86_64-pc-windows-msvc": { platform: "win32", arch: "x64" },
  "x86_64-apple-darwin": { platform: "darwin", arch: "x64" },
  "aarch64-apple-darwin": { platform: "darwin", arch: "arm64" },
});

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

async function buildNativeSidecar({
  root = projectRoot,
  cargo = "cargo",
  platform = process.platform,
  targetTriple = null,
  cargoTargetDir = process.env.CARGO_TARGET_DIR || null,
} = {}) {
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
  const contract = writeRuntimeContract({
    backendRoot,
    platform: targetPlatform,
    arch: target?.arch ?? process.arch,
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
  buildNativeSidecar,
  getNativeSidecarPaths,
  parseArgs,
};
