/**
 * Bake a standalone backend-dist/ with embedded backend source + Python runtime.
 *
 * Produces the layout expected by the standalone ZIP distribution:
 *   backend-dist/
 *     api/
 *     websocket/
 *     updater/
 *     main.py
 *     recommended-config.json
 *     version.json
 *     python-runtime/
 *       python/
 *       venv/
 *       build_info.json
 *       RUNTIME_READY.json
 *
 * Usage:
 *   node scripts/bake-standalone-backend.cjs --profile cpu [options]
 *
 * Options:
 *   --profile <id>         Product profile to bake (default: cpu)
 *   --platform <id>        Target platform (default: current host platform)
 *   --arch <id>            Target arch (default: current host arch)
 *   --clean                Remove previous backend-dist before baking
 *   --cache-dir <path>     Cache dir for downloaded Python (default: build/.python-cache)
 *   --constraints <path>   Optional pip constraints file for platform/arch/profile
 *   --help                 Show usage
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const {
  PBS_TAG,
  PYTHON_VERSION,
  STANDALONE_V1_PROFILE,
  assertProfileSupportedOnPlatform,
} = require("./python-runtime-config.cjs");

const projectRoot = path.join(__dirname, "..");
const isWindows = process.platform === "win32";

function printHelp() {
  console.log(`Usage:
  node scripts/bake-standalone-backend.cjs --profile cpu [options]

Options:
  --profile <id>         Product profile to bake (default: ${STANDALONE_V1_PROFILE})
  --platform <id>        Target platform (default: ${process.platform})
  --arch <id>            Target arch (default: ${process.arch})
  --clean                Remove previous backend-dist before baking
  --cache-dir <path>     Cache dir for downloaded Python
  --constraints <path>   Optional pip constraints file
  --help                 Show this message`);
}

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    profile: STANDALONE_V1_PROFILE,
    platform: process.platform,
    arch: process.arch,
    clean: false,
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

function resolveConstraintsFile(options, rootDir = projectRoot) {
  if (options.constraintsFile) {
    return options.constraintsFile;
  }

  const candidates = [
    path.join(rootDir, "build", "constraints", "standalone", `${options.profile}-${options.platform}-${options.arch}.txt`),
    path.join(rootDir, "build", "constraints", "standalone", `${options.platform}-${options.arch}-${options.profile}.txt`),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? "";
}

function resolveBakeConfig(rawOptions, host = { platform: process.platform, arch: process.arch }) {
  const config = {
    ...rawOptions,
    constraintsFile: rawOptions.constraintsFile || "",
  };

  assertProfileSupportedOnPlatform(config.profile, config.platform);

  if (config.platform !== host.platform || config.arch !== host.arch) {
    throw new Error(
      `Cross-target bake is not supported on this host. Requested ${config.platform}-${config.arch}, current host is ${host.platform}-${host.arch}. Run the script on the matching target runner.`,
    );
  }

  if (config.constraintsFile && !fs.existsSync(config.constraintsFile)) {
    throw new Error(`Constraints file not found: ${config.constraintsFile}`);
  }

  return config;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`  Running: ${command} ${args.join(" ")}`);
    const proc = spawn(command, args, {
      stdio: "inherit",
      shell: false,
      windowsHide: isWindows,
      cwd: projectRoot,
      ...options,
    });

    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with code ${code}: ${command} ${args.join(" ")}`));
    });
    proc.on("error", reject);
  });
}

function ensureDirRemoved(targetPath) {
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function removePathWithRetries(targetPath, options = {}) {
  const attempts = options.attempts ?? 4;
  const delayMs = options.delayMs ?? 250;
  const isDirectory = fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory();

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      fs.rmSync(targetPath, { recursive: isDirectory, force: true });
      return;
    } catch (error) {
      if (attempt === attempts - 1) {
        throw error;
      }
      await delay(delayMs * (attempt + 1));
    }
  }
}

function copyPathSync(srcPath, destPath) {
  const sourceStats = fs.statSync(srcPath);
  if (sourceStats.isDirectory()) {
    fs.cpSync(srcPath, destPath, { recursive: true, force: true });
  } else {
    fs.copyFileSync(srcPath, destPath);
  }
}

function canFallbackMove(error) {
  return Boolean(error && ["EACCES", "EBUSY", "EPERM", "EXDEV"].includes(error.code));
}

async function moveIfExists(srcPath, destPath, options = {}) {
  if (!fs.existsSync(srcPath)) {
    throw new Error(`Expected path not found: ${srcPath}`);
  }
  ensureDirRemoved(destPath);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  const retryCount = options.retryCount ?? (isWindows ? 4 : 1);
  const retryDelayMs = options.retryDelayMs ?? 250;
  let lastError = null;

  for (let attempt = 0; attempt < retryCount; attempt += 1) {
    try {
      fs.renameSync(srcPath, destPath);
      return;
    } catch (error) {
      lastError = error;
      if (!canFallbackMove(error)) {
        throw error;
      }
      if (attempt < retryCount - 1) {
        await delay(retryDelayMs * (attempt + 1));
      }
    }
  }

  copyPathSync(srcPath, destPath);
  await removePathWithRetries(srcPath, {
    attempts: options.removeAttempts ?? 4,
    delayMs: retryDelayMs,
  });
}

function getVenvPythonPath(runtimeRoot) {
  return isWindows
    ? path.join(runtimeRoot, "venv", "Scripts", "python.exe")
    : path.join(runtimeRoot, "venv", "bin", "python");
}

function writeRuntimeReady(runtimeRoot, config) {
  const payload = {
    mode: "standalone-bundled-runtime",
    profile: config.profile,
    platform: config.platform,
    arch: config.arch,
    python_version: PYTHON_VERSION,
    pbs_tag: PBS_TAG,
    constraints_file: config.constraintsFile ? path.relative(projectRoot, config.constraintsFile) : null,
    created_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(runtimeRoot, "RUNTIME_READY.json"), JSON.stringify(payload, null, 2));
}

async function precompile(runtimeRoot, backendDist) {
  const venvPython = getVenvPythonPath(runtimeRoot);
  const compileTargets = [
    path.join(backendDist, "api"),
    path.join(backendDist, "websocket"),
    path.join(backendDist, "updater"),
    path.join(backendDist, "main.py"),
  ].filter((target) => fs.existsSync(target));

  if (compileTargets.length === 0) {
    return;
  }

  await runCommand(venvPython, ["-m", "compileall", "-q", "-j", "0", ...compileTargets]);
}

async function bakeStandaloneBackend(config) {
  const backendDist = path.join(projectRoot, "backend-dist");
  const runtimeRoot = path.join(backendDist, "python-runtime");
  const nodeExec = process.execPath;

  if (config.clean) {
    console.log("=== Cleaning backend-dist/ ===");
    ensureDirRemoved(backendDist);
  }

  console.log("=== Step 1: Build bundled python-runtime/ ===");
  fs.mkdirSync(backendDist, { recursive: true });
  const setupArgs = [
    path.join("scripts", "setup-python-env.cjs"),
    "--profile",
    config.profile,
    "--cache-dir",
    config.cacheDir,
    "--output-dir",
    runtimeRoot,
    "--runtime-only",
    "--build-mode",
    "standalone-bundled-runtime",
  ];
  if (config.constraintsFile) {
    setupArgs.push("--constraints", config.constraintsFile);
  }
  await runCommand(nodeExec, setupArgs);

  console.log("");
  console.log("=== Step 2: Refresh backend source payload ===");
  await runCommand(nodeExec, [path.join("scripts", "copy-backend-source.cjs")]);

  console.log("");
  console.log("=== Step 3: Write bundled runtime markers ===");
  writeRuntimeReady(runtimeRoot, config);

  console.log("");
  console.log("=== Step 4: Pre-compile bundled backend ===");
  await precompile(runtimeRoot, backendDist);

  console.log("");
  console.log("=== Standalone backend bake complete ===");
  console.log(`  Profile:      ${config.profile}`);
  console.log(`  Target:       ${config.platform}-${config.arch}`);
  console.log(`  Constraints:  ${config.constraintsFile || "(none)"}`);
  console.log(`  Output:       ${backendDist}`);
  console.log(`  Smoke test:   ${getVenvPythonPath(runtimeRoot)} -m uvicorn main:app --host 127.0.0.1 --port 8000`);
}

async function main() {
  const rawOptions = parseArgs();
  if (rawOptions.help) {
    printHelp();
    return;
  }

  const resolvedConstraints = resolveConstraintsFile(rawOptions);
  const config = resolveBakeConfig({
    ...rawOptions,
    constraintsFile: resolvedConstraints,
  });

  console.log("========================================");
  console.log("  Bake Standalone Backend");
  console.log("========================================");
  console.log(`  Profile:      ${config.profile}`);
  console.log(`  Target:       ${config.platform}-${config.arch}`);
  console.log(`  Cache dir:    ${config.cacheDir}`);
  console.log(`  Constraints:  ${config.constraintsFile || "(none)"}`);
  console.log("");

  if (!config.constraintsFile) {
    console.log("  Warning: no platform/arch constraints file found. Baking will proceed with unpinned resolver output.");
    console.log("");
  }

  await bakeStandaloneBackend(config);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Standalone backend bake failed:", error.message);
    process.exit(1);
  });
}

module.exports = {
  bakeStandaloneBackend,
  getVenvPythonPath,
  moveIfExists,
  parseArgs,
  resolveBakeConfig,
  resolveConstraintsFile,
};
