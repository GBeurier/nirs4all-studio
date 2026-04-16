/**
 * Build a standalone Electron archive with a fully baked backend runtime.
 *
 * This is the lot 4 packaging entrypoint for the archive-based standalone product.
 * It is intentionally locked to the v1 standalone scope: profile=cpu only.
 *
 * Usage:
 *   node scripts/build-archive-standalone.cjs [options]
 *
 * Options:
 *   --profile <id>        Product profile to bake (default: cpu, and must stay cpu in v1)
 *   --platform <id>       Target platform (default: current host platform)
 *   --arch <id>           Target arch (default: current host arch)
 *   --clean               Clean build artifacts before packaging
 *   --skip-backend        Reuse the existing backend-dist/
 *   --skip-frontend       Reuse dist/ and dist-electron/
 *   --cache-dir <path>    Cache dir for python-build-standalone downloads
 *   --constraints <path>  Optional pip constraints file for the bake step
 *   --help                Show usage
 */

const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const {
  STANDALONE_V1_PROFILE,
} = require("./python-runtime-config.cjs");
const { resolveSpawnCommand } = require("./spawn-command.cjs");

const projectRoot = path.join(__dirname, "..");
const isWindows = process.platform === "win32";
const PRODUCT_NAME = "nirs4all Studio";

function printHelp() {
  console.log(`Usage:
  node scripts/build-archive-standalone.cjs [options]

Options:
  --profile <id>        Product profile to bake (default: ${STANDALONE_V1_PROFILE})
  --platform <id>       Target platform (default: ${process.platform})
  --arch <id>           Target arch (default: ${process.arch})
  --clean               Clean build artifacts before packaging
  --skip-backend        Reuse the existing backend-dist/
  --skip-frontend       Reuse dist/ and dist-electron/
  --cache-dir <path>    Cache dir for python-build-standalone downloads
  --constraints <path>  Optional pip constraints file for the bake step
  --help                Show this message`);
}

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    profile: STANDALONE_V1_PROFILE,
    platform: process.platform,
    arch: process.arch,
    clean: false,
    skipBackend: false,
    skipFrontend: false,
    cacheDir: path.join(projectRoot, "build", ".python-cache"),
    constraintsFile: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const [flag, inlineValue] = arg.includes("=") ? arg.split(/=(.+)/, 2) : [arg, undefined];

    if (flag === "--help") {
      parsed.help = true;
    } else if (flag === "--profile") {
      parsed.profile = inlineValue ?? argv[++i];
    } else if (flag === "--platform") {
      parsed.platform = inlineValue ?? argv[++i];
    } else if (flag === "--arch") {
      parsed.arch = inlineValue ?? argv[++i];
    } else if (flag === "--clean") {
      parsed.clean = true;
    } else if (flag === "--skip-backend") {
      parsed.skipBackend = true;
    } else if (flag === "--skip-frontend") {
      parsed.skipFrontend = true;
    } else if (flag === "--cache-dir") {
      parsed.cacheDir = path.resolve(inlineValue ?? argv[++i]);
    } else if (flag === "--constraints") {
      parsed.constraintsFile = path.resolve(inlineValue ?? argv[++i]);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function resolveBuildConfig(rawOptions, host = { platform: process.platform, arch: process.arch }) {
  const config = {
    ...rawOptions,
    cacheDir: path.resolve(rawOptions.cacheDir),
    constraintsFile: rawOptions.constraintsFile ? path.resolve(rawOptions.constraintsFile) : "",
  };

  if (config.profile !== STANDALONE_V1_PROFILE) {
    throw new Error(
      `Standalone archive packaging is locked to the '${STANDALONE_V1_PROFILE}' profile in v1. Requested profile: '${config.profile}'.`,
    );
  }

  if (config.platform !== host.platform || config.arch !== host.arch) {
    throw new Error(
      `Archive packaging must run on the matching target host. Requested ${config.platform}-${config.arch}, current host is ${host.platform}-${host.arch}.`,
    );
  }

  if (config.constraintsFile && !fs.existsSync(config.constraintsFile)) {
    throw new Error(`Constraints file not found: ${config.constraintsFile}`);
  }

  return config;
}

function getElectronBuilderArgs(config) {
  const args = [
    path.join("node_modules", "electron-builder", "cli.js"),
    "--config",
    "electron-builder.archive.yml",
    "--publish",
    "never",
  ];

  if (config.platform === "win32") {
    args.push("--win");
  } else if (config.platform === "darwin") {
    args.push("--mac");
    // Build the unpacked .app bundle and zip it with `ditto` ourselves.
    // This avoids electron-builder's mac ZIP blockmap generation, which is
    // expensive for the large all-in-one archive and stalls CI on macOS Intel.
    args.push("--dir");
  } else if (config.platform === "linux") {
    args.push("--linux");
    // Build the unpacked directory first, then create the tarball ourselves.
    // This avoids extremely slow archive generation inside electron-builder.
    args.push("--dir");
  }

  if (config.arch === "x64") {
    args.push("--x64");
  } else if (config.arch === "arm64") {
    args.push("--arm64");
  }

  return args;
}

function getPackageVersion() {
  const pkgPath = path.join(projectRoot, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  return pkg.version;
}

function getMacAppBundlePath(config) {
  const appDir = config.arch === "arm64" ? "mac-arm64" : "mac";
  return path.join(projectRoot, "release", appDir, `${PRODUCT_NAME}.app`);
}

function getMacZipPath(config) {
  return path.join(projectRoot, "release", `${PRODUCT_NAME}-${getPackageVersion()}-all-in-one-mac-${config.arch}.zip`);
}

function getLinuxAppDir() {
  return path.join(projectRoot, "release", "linux-unpacked");
}

function getLinuxTarPath(config) {
  return path.join(projectRoot, "release", `${PRODUCT_NAME}-${getPackageVersion()}-all-in-one-linux-${config.arch}.tar.gz`);
}

function getLinuxCompressProgram() {
  return (process.env.NIRS4ALL_TAR_GZIP_PROGRAM || "").trim();
}

async function createMacZip(config) {
  const appPath = getMacAppBundlePath(config);
  const zipPath = getMacZipPath(config);

  if (!fs.existsSync(appPath)) {
    throw new Error(`Expected packaged macOS app bundle was not found: ${appPath}`);
  }

  if (fs.existsSync(zipPath)) {
    fs.rmSync(zipPath, { force: true });
  }

  console.log("=== Step 4: Create macOS ZIP archive ===");
  await runCommand("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, zipPath]);
  console.log("");
}

async function createLinuxTarball(config) {
  const appPath = getLinuxAppDir();
  const tarPath = getLinuxTarPath(config);
  const releaseDir = path.join(projectRoot, "release");
  const compressProgram = getLinuxCompressProgram();

  if (!fs.existsSync(appPath)) {
    throw new Error(`Expected packaged Linux app directory was not found: ${appPath}`);
  }

  if (fs.existsSync(tarPath)) {
    fs.rmSync(tarPath, { force: true });
  }

  const tarArgs = [
    "--dereference",
    "-C",
    releaseDir,
    `--transform=s|^linux-unpacked|${PRODUCT_NAME}|`,
  ];

  if (compressProgram) {
    tarArgs.push(`--use-compress-program=${compressProgram}`, "-cf", tarPath, "linux-unpacked");
  } else {
    tarArgs.push("-czf", tarPath, "linux-unpacked");
  }

  console.log("=== Step 4: Create Linux tar.gz archive ===");
  await runCommand("tar", tarArgs);
  console.log("");
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`Running: ${command} ${args.join(" ")}`);
    const spawnSpec = resolveSpawnCommand(command, args);
    const proc = spawn(spawnSpec.command, spawnSpec.args, {
      stdio: "inherit",
      shell: spawnSpec.shell,
      cwd: projectRoot,
      windowsHide: isWindows,
      ...options,
    });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with code ${code}: ${command} ${args.join(" ")}`));
    });
    proc.on("error", reject);
  });
}

function getNodeCommand() {
  return process.execPath;
}

function getNpmCommand() {
  return "npm";
}

function rmrf(relativePath) {
  const fullPath = path.join(projectRoot, relativePath);
  if (fs.existsSync(fullPath)) {
    fs.rmSync(fullPath, { recursive: true, force: true });
    console.log(`  Removed: ${relativePath}`);
  }
}

function ensureBuildInputsExist(config) {
  if (!config.skipBackend) {
    return;
  }

  const backendDistPath = path.join(projectRoot, "backend-dist");
  const runtimeReady = path.join(backendDistPath, "python-runtime", "RUNTIME_READY.json");
  if (!fs.existsSync(runtimeReady)) {
    throw new Error(
      "backend-dist/ does not contain a baked standalone runtime. Re-run without --skip-backend or bake the runtime first.",
    );
  }
}

function ensureFrontendOutputsExist(config) {
  if (!config.skipFrontend) {
    return;
  }

  if (!fs.existsSync(path.join(projectRoot, "dist")) || !fs.existsSync(path.join(projectRoot, "dist-electron"))) {
    throw new Error("dist/ or dist-electron/ not found but --skip-frontend was specified");
  }
}

function getGitCommitShort() {
  try {
    return execSync("git rev-parse --short HEAD", {
      cwd: projectRoot,
      encoding: "utf-8",
    }).trim();
  } catch {
    return "unknown";
  }
}

function syncVersionJsonFromPackage() {
  const versionPath = path.join(projectRoot, "version.json");
  const versionData = {
    version: getPackageVersion(),
    build_date: new Date().toISOString(),
    commit: getGitCommitShort(),
  };
  fs.writeFileSync(versionPath, `${JSON.stringify(versionData, null, 2)}\n`);
}

async function buildArchiveStandalone(config) {
  syncVersionJsonFromPackage();

  if (config.clean) {
    console.log("=== Cleaning build artifacts ===");
    rmrf("dist");
    rmrf("dist-electron");
    rmrf("backend-dist");
    rmrf("release");
    console.log("");
  }

  if (!config.skipBackend) {
    console.log("=== Step 1: Bake standalone backend runtime ===");
    const bakeArgs = [
      path.join("scripts", "bake-standalone-backend.cjs"),
      "--profile",
      config.profile,
      "--platform",
      config.platform,
      "--arch",
      config.arch,
      "--cache-dir",
      config.cacheDir,
      "--clean",
    ];
    if (config.constraintsFile) {
      bakeArgs.push("--constraints", config.constraintsFile);
    }
    await runCommand(getNodeCommand(), bakeArgs);
    console.log("");
  } else {
    console.log("=== Step 1: Reusing existing backend-dist/ ===");
    ensureBuildInputsExist(config);
    console.log("");
  }

  if (!config.skipFrontend) {
    console.log("=== Step 2: Build frontend (Electron mode) ===");
    await runCommand(getNpmCommand(), ["run", "build:electron"]);
    console.log("");
  } else {
    console.log("=== Step 2: Reusing existing frontend outputs ===");
    ensureFrontendOutputsExist(config);
    console.log("");
  }

  console.log("=== Step 3: Package standalone archive ===");
  await runCommand(getNodeCommand(), getElectronBuilderArgs(config));
  console.log("");

  if (config.platform === "darwin") {
    await createMacZip(config);
  } else if (config.platform === "linux") {
    await createLinuxTarball(config);
  }
}

async function main() {
  const rawOptions = parseArgs();
  if (rawOptions.help) {
    printHelp();
    return;
  }

  const config = resolveBuildConfig(rawOptions);

  console.log("========================================");
  console.log("  Build Standalone Archive");
  console.log("========================================");
  console.log(`  Profile:      ${config.profile}`);
  console.log(`  Target:       ${config.platform}-${config.arch}`);
  console.log(`  Cache dir:    ${config.cacheDir}`);
  console.log(`  Constraints:  ${config.constraintsFile || "(none)"}`);
  console.log("");

  if (config.platform === "darwin") {
    console.log("  Note: final notarized/stapled ZIP creation still belongs to the macOS CI release flow.");
    console.log("");
  }

  await buildArchiveStandalone(config);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Standalone archive build failed:", error.message);
    process.exit(1);
  });
}

module.exports = {
  buildArchiveStandalone,
  getElectronBuilderArgs,
  parseArgs,
  resolveBuildConfig,
};
