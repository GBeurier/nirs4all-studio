/**
 * Setup embedded Python environment for installer builds.
 * Downloads python-build-standalone, creates a venv, installs dependencies,
 * and copies backend source files into backend-dist/.
 *
 * This replaces the PyInstaller approach for installer builds, enabling
 * runtime package management (pip install in managed venv).
 *
 * Usage:
 *   node scripts/setup-python-env.cjs [options]
 *
 * Options:
 *   --profile <id>               Product profile (cpu, gpu-cuda-torch, gpu-mps)
 *   --flavor cpu|gpu|gpu-metal   Legacy alias mapped to a product profile (default: cpu)
 *   --clean                      Remove previous backend-dist before building
 *   --cache-dir <path>           Cache dir for downloaded Python (default: build/.python-cache)
 *   --constraints <path>         Optional pip constraints file applied to dependency installs
 *   --output-dir <path>          Output directory (default: backend-dist/)
 *   --runtime-only               Build only python/ + venv/ + build_info.json
 *   --build-mode <id>            build_info.json mode value (default: installer)
 *   --local-nirs4all             Install nirs4all from local ../nirs4all instead of PyPI
 */

const { spawn, execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const {
  assertProfileSupportedOnPlatform,
  BACKEND_COMMON_PACKAGES,
  PYTHON_VERSION,
  PBS_TAG,
  getArchiveFilename,
  getDownloadUrl,
  getProfilePackageInstallSpecs,
  listSupportedPlatformArchKeys,
  resolveProfileForFlavor,
} = require("./python-runtime-config.cjs");

const projectRoot = path.join(__dirname, "..");
process.chdir(projectRoot);

const isWindows = process.platform === "win32";

// --- Argument parsing ---
const args = process.argv.slice(2);
let flavor = "cpu";
let explicitProfile = "";
let clean = false;
let cacheDir = path.join(projectRoot, "build", ".python-cache");
let constraintsFile = "";
let localNirs4all = false;
let outputDir = path.join(projectRoot, "backend-dist");
let runtimeOnly = false;
let buildMode = "installer";

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--flavor" && args[i + 1]) {
    flavor = args[++i];
  } else if (args[i] === "--profile" && args[i + 1]) {
    explicitProfile = args[++i];
  } else if (args[i] === "--clean") {
    clean = true;
  } else if (args[i] === "--cache-dir" && args[i + 1]) {
    cacheDir = path.resolve(args[++i]);
  } else if (args[i] === "--constraints" && args[i + 1]) {
    constraintsFile = path.resolve(args[++i]);
  } else if (args[i] === "--output-dir" && args[i + 1]) {
    outputDir = path.resolve(args[++i]);
  } else if (args[i] === "--runtime-only") {
    runtimeOnly = true;
  } else if (args[i] === "--build-mode" && args[i + 1]) {
    buildMode = String(args[++i]).trim() || "installer";
  } else if (args[i] === "--local-nirs4all") {
    localNirs4all = true;
  }
}

let profile = explicitProfile;
if (!profile) {
  try {
    profile = resolveProfileForFlavor(flavor, process.platform);
    if (process.platform === "darwin" && flavor === "gpu") {
      console.log("Note: macOS detected, using 'gpu-mps' product profile for the legacy 'gpu' flavor");
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

try {
  assertProfileSupportedOnPlatform(profile, process.platform);
  getProfilePackageInstallSpecs(profile, {
    includeExtraPackages: false,
    packageNames: ["nirs4all"],
  });
  if (constraintsFile && !fs.existsSync(constraintsFile)) {
    throw new Error(`Constraints file not found: ${constraintsFile}`);
  }
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}

// --- Helpers ---

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getDirSize(dirPath) {
  let totalSize = 0;
  if (!fs.existsSync(dirPath)) return 0;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      totalSize += getDirSize(fullPath);
    } else {
      totalSize += fs.statSync(fullPath).size;
    }
  }
  return totalSize;
}

function getPathSize(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return 0;
  }
  const stats = fs.lstatSync(targetPath);
  if (!stats.isDirectory()) {
    return stats.size;
  }
  return getDirSize(targetPath);
}

function copyDirSync(src, dest, excludePatterns = ["__pycache__"]) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (excludePatterns.includes(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath, excludePatterns);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function isGnuTar() {
  return new Promise((resolve) => {
    execFile("tar", ["--version"], { windowsHide: isWindows }, (err, stdout) => {
      resolve(!err && stdout.includes("GNU tar"));
    });
  });
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
      else reject(new Error(`Command failed with code ${code}`));
    });
    proc.on("error", reject);
  });
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function runCommandWithRetries(command, args, options = {}, retryOptions = {}) {
  const retries = retryOptions.retries ?? 1;
  const delayMs = retryOptions.delayMs ?? 1500;
  const label = retryOptions.label ?? `${command} ${args.join(" ")}`;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await runCommand(command, args, options);
      return;
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }
      console.warn(`  Retry ${attempt}/${retries - 1} after failure: ${label}`);
      await delay(delayMs * attempt);
    }
  }
}

function buildPipInstallArgs(packageSpecs, options = {}) {
  return [
    "-m",
    "pip",
    "install",
    ...(options.upgrade ? ["--upgrade"] : []),
    ...(options.constraintsFile ? ["-c", options.constraintsFile] : []),
    ...packageSpecs,
  ];
}

function isStandaloneBundledRuntimeMode(mode = buildMode) {
  return mode === "standalone-bundled-runtime";
}

function walkTreeSync(rootPath, visitor) {
  if (!fs.existsSync(rootPath)) {
    return;
  }

  const entries = fs.readdirSync(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(rootPath, entry.name);
    const shouldDescend = visitor(fullPath, entry);
    if (shouldDescend !== false && entry.isDirectory()) {
      walkTreeSync(fullPath, visitor);
    }
  }
}

function pruneStandaloneRuntimeArtifacts(runtimeRoot) {
  const pruneDirNames = new Set(["Headers", "cmake", "include", "pkgconfig"]);
  const pruneShareLeafNames = new Set(["doc", "docs", "gtk-doc", "info", "man"]);
  const targets = new Set();

  walkTreeSync(runtimeRoot, (entryPath, entry) => {
    if (!entry.isDirectory()) {
      return true;
    }

    if (pruneDirNames.has(entry.name)) {
      targets.add(entryPath);
      return false;
    }

    const parentName = path.basename(path.dirname(entryPath));
    if (parentName === "share" && pruneShareLeafNames.has(entry.name)) {
      targets.add(entryPath);
      return false;
    }

    return true;
  });

  const sortedTargets = [...targets].sort((left, right) => right.length - left.length);
  let removedBytes = 0;
  let removedPaths = 0;

  for (const targetPath of sortedTargets) {
    if (!fs.existsSync(targetPath)) {
      continue;
    }
    removedBytes += getPathSize(targetPath);
    fs.rmSync(targetPath, { recursive: true, force: true });
    removedPaths += 1;
  }

  return {
    removedBytes,
    removedPaths,
  };
}

function getCompileTargets(options) {
  const {
    backendDist,
    buildMode: activeBuildMode,
    runtimeOnly: isRuntimeOnly,
    venvDir,
  } = options;

  const targets = [];
  if (!isStandaloneBundledRuntimeMode(activeBuildMode)) {
    targets.push(path.join(venvDir, isWindows ? "Lib" : "lib"));
  }

  if (!isRuntimeOnly) {
    targets.push(
      path.join(backendDist, "api"),
      path.join(backendDist, "websocket"),
      path.join(backendDist, "main.py"),
    );
  }

  return targets.filter((targetPath) => fs.existsSync(targetPath));
}

/**
 * Download a file from a URL, following redirects.
 * Shows progress during download.
 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const makeRequest = (requestUrl) => {
      const protocol = requestUrl.startsWith("https") ? https : http;
      protocol.get(requestUrl, (response) => {
        // Follow redirects (GitHub returns 302)
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          return makeRequest(response.headers.location);
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Download failed with status ${response.statusCode}`));
          return;
        }

        const totalBytes = parseInt(response.headers["content-length"] || "0", 10);
        let receivedBytes = 0;
        let lastProgressLog = 0;

        const file = fs.createWriteStream(destPath);
        response.pipe(file);

        response.on("data", (chunk) => {
          receivedBytes += chunk.length;
          if (totalBytes > 0) {
            const percent = Math.floor((receivedBytes / totalBytes) * 100);
            // Log every 10%
            if (percent >= lastProgressLog + 10) {
              lastProgressLog = percent - (percent % 10);
              process.stdout.write(`  Download progress: ${percent}% (${formatSize(receivedBytes)} / ${formatSize(totalBytes)})\n`);
            }
          }
        });

        file.on("finish", () => {
          file.close();
          console.log(`  Download complete: ${formatSize(receivedBytes)}`);
          resolve();
        });

        file.on("error", (err) => {
          fs.unlinkSync(destPath);
          reject(err);
        });
      }).on("error", reject);
    };

    makeRequest(url);
  });
}

// --- Main ---
async function main() {
  const startTime = Date.now();

  console.log("========================================");
  console.log("  Setup Embedded Python Environment");
  console.log("========================================");
  console.log("");
  console.log("Configuration:");
  console.log(`  Flavor:         ${flavor.toUpperCase()}`);
  console.log(`  Profile:        ${profile}`);
  console.log(`  Python:         ${PYTHON_VERSION}`);
  console.log(`  PBS release:    ${PBS_TAG}`);
  console.log(`  Cache dir:      ${cacheDir}`);
  console.log(`  Constraints:    ${constraintsFile || "(none)"}`);
  console.log(`  Output dir:     ${outputDir}`);
  console.log(`  Runtime only:   ${runtimeOnly}`);
  console.log(`  Build mode:     ${buildMode}`);
  console.log(`  Local nirs4all: ${localNirs4all}`);
  console.log("");

  // 1. Resolve platform
  const platformKey = `${process.platform}-${process.arch}`;
  let tarballName;
  let downloadUrl;
  try {
    tarballName = getArchiveFilename(process.platform, process.arch);
    downloadUrl = getDownloadUrl(process.platform, process.arch);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    console.error(`Supported: ${listSupportedPlatformArchKeys().join(", ")}`);
    process.exit(1);
  }
  const backendDist = outputDir;

  // 2. Clean if requested
  if (clean && fs.existsSync(backendDist)) {
    console.log("=== Cleaning backend-dist/ ===");
    fs.rmSync(backendDist, { recursive: true, force: true });
    console.log("  Removed backend-dist/");
    console.log("");
  }

  fs.mkdirSync(backendDist, { recursive: true });

  // 3. Download python-build-standalone (with caching)
  console.log("=== Step 1: Download embedded Python ===");
  fs.mkdirSync(cacheDir, { recursive: true });
  const cachedTarball = path.join(cacheDir, tarballName);

  if (fs.existsSync(cachedTarball)) {
    const cachedSize = fs.statSync(cachedTarball).size;
    console.log(`  Using cached: ${tarballName} (${formatSize(cachedSize)})`);
  } else {
    console.log(`  Downloading: ${tarballName}`);
    console.log(`  From: ${downloadUrl}`);
    await downloadFile(downloadUrl, cachedTarball);
  }

  // Validate tarball size (should be > 10 MB)
  const tarballSize = fs.statSync(cachedTarball).size;
  if (tarballSize < 10 * 1024 * 1024) {
    console.error(`Error: Downloaded file too small (${formatSize(tarballSize)}). May be corrupt.`);
    fs.unlinkSync(cachedTarball);
    process.exit(1);
  }
  console.log("");

  // 4. Extract to backend-dist/python/
  console.log("=== Step 2: Extract Python runtime ===");
  const pythonDir = path.join(backendDist, "python");
  if (fs.existsSync(pythonDir)) {
    console.log("  Python directory already exists, removing...");
    fs.rmSync(pythonDir, { recursive: true, force: true });
  }

  console.log(`  Extracting to backend-dist/python/...`);
  const tarArchive = isWindows ? cachedTarball.replace(/\\/g, "/") : cachedTarball;
  const tarDest = isWindows ? backendDist.replace(/\\/g, "/") : backendDist;
  const tarArgs = ["-xzf", tarArchive, "-C", tarDest];
  // GNU tar (from Git) interprets drive letters as remote hosts and needs --force-local.
  // Windows built-in bsdtar doesn't support --force-local but handles paths natively.
  if (isWindows && await isGnuTar()) tarArgs.push("--force-local");
  await runCommand("tar", tarArgs);

  // Verify extraction
  const embeddedPython = isWindows
    ? path.join(pythonDir, "python.exe")
    : path.join(pythonDir, "bin", "python3");

  if (!fs.existsSync(embeddedPython)) {
    console.error(`Error: Embedded Python not found at ${embeddedPython}`);
    console.error("Expected python-build-standalone to extract to backend-dist/python/");
    process.exit(1);
  }
  console.log(`  Verified: ${embeddedPython}`);
  console.log(`  Size: ${formatSize(getDirSize(pythonDir))}`);
  console.log("");

  // 5. Create venv
  console.log("=== Step 3: Create virtual environment ===");
  const venvDir = path.join(backendDist, "venv");
  if (fs.existsSync(venvDir)) {
    console.log("  Venv directory already exists, removing...");
    fs.rmSync(venvDir, { recursive: true, force: true });
  }

  console.log("  Creating venv (without pip)...");
  await runCommand(embeddedPython, ["-m", "venv", venvDir, "--without-pip"]);

  // Determine venv python path (use python -m pip instead of pip.exe for reliability)
  const venvPython = isWindows
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python");

  if (!fs.existsSync(venvPython)) {
    console.error(`Error: Venv Python not found at ${venvPython}`);
    process.exit(1);
  }

  console.log("  Bootstrapping pip via ensurepip...");
  await runCommand(venvPython, ["-m", "ensurepip", "--upgrade"]);

  // Verify pip is usable
  await runCommand(venvPython, ["-m", "pip", "--version"]);

  // Upgrade pip to latest
  console.log("  Upgrading pip...");
  await runCommandWithRetries(venvPython, ["-m", "pip", "install", "--upgrade", "pip"], {}, {
    retries: isWindows ? 3 : 1,
    label: "pip install --upgrade pip",
  });
  console.log("");

  // 6. Install dependencies
  console.log(`=== Step 4: Install dependencies (${profile}) ===`);
  const dependencySpecs = [
    ...BACKEND_COMMON_PACKAGES,
    ...getProfilePackageInstallSpecs(profile, {
      omitPackages: ["nirs4all"],
    }),
  ];
  console.log(`  Installing ${dependencySpecs.length} backend packages from shared runtime config...`);
  // Large wheel installs on Windows can hit transient RECORD/file-lock races.
  await runCommandWithRetries(venvPython, buildPipInstallArgs(dependencySpecs, {
    constraintsFile,
  }), {}, {
    retries: isWindows ? 3 : 1,
    label: "pip install backend dependencies",
  });

  // 7. Install nirs4all
  console.log("");
  console.log("=== Step 5: Install nirs4all ===");

  const localNirs4allPath = path.join(projectRoot, "..", "nirs4all");
  if (localNirs4all && fs.existsSync(localNirs4allPath)) {
    console.log("  Installing nirs4all from local source (editable)...");
    await runCommandWithRetries(venvPython, [
      "-m",
      "pip",
      "install",
      ...(constraintsFile ? ["-c", constraintsFile] : []),
      "-e",
      localNirs4allPath,
    ], {}, {
      retries: isWindows ? 3 : 1,
      label: "pip install -e ../nirs4all",
    });
  } else if (localNirs4all) {
    console.log("  Warning: --local-nirs4all specified but ../nirs4all not found");
    const [nirs4allSpec] = getProfilePackageInstallSpecs(profile, {
      includeExtraPackages: false,
      packageNames: ["nirs4all"],
    });
    console.log(`  Installing ${nirs4allSpec} from PyPI...`);
    await runCommandWithRetries(venvPython, buildPipInstallArgs([nirs4allSpec], {
      constraintsFile,
    }), {}, {
      retries: isWindows ? 3 : 1,
      label: `pip install ${nirs4allSpec}`,
    });
  } else {
    const [nirs4allSpec] = getProfilePackageInstallSpecs(profile, {
      includeExtraPackages: false,
      packageNames: ["nirs4all"],
    });
    console.log(`  Installing ${nirs4allSpec} from PyPI...`);
    await runCommandWithRetries(venvPython, buildPipInstallArgs([nirs4allSpec], {
      constraintsFile,
    }), {}, {
      retries: isWindows ? 3 : 1,
      label: `pip install ${nirs4allSpec}`,
    });
  }
  console.log("");

  if (!runtimeOnly) {
    // 8. Copy backend source
    console.log("=== Step 6: Copy backend source files ===");

    const filesToCopy = [
      { src: "api", type: "dir" },
      { src: "websocket", type: "dir" },
      { src: "main.py", type: "file" },
      { src: "public", type: "dir" },
    ];

    for (const item of filesToCopy) {
      const srcPath = path.join(projectRoot, item.src);
      const destPath = path.join(backendDist, item.src);

      if (!fs.existsSync(srcPath)) {
        console.log(`  Warning: ${item.src} not found, skipping`);
        continue;
      }

      if (item.type === "dir") {
        if (fs.existsSync(destPath)) {
          fs.rmSync(destPath, { recursive: true, force: true });
        }
        copyDirSync(srcPath, destPath);
        console.log(`  Copied: ${item.src}/ (${formatSize(getDirSize(destPath))})`);
      } else {
        fs.copyFileSync(srcPath, destPath);
        console.log(`  Copied: ${item.src} (${formatSize(fs.statSync(destPath).size)})`);
      }
    }
    console.log("");
  } else {
    console.log("=== Step 6: Skip backend source copy (--runtime-only) ===");
    console.log("");
  }

  if (isStandaloneBundledRuntimeMode(buildMode)) {
    console.log("=== Step 6b: Prune standalone runtime dev artifacts ===");
    const runtimeStats = pruneStandaloneRuntimeArtifacts(backendDist);
    console.log(
      `  Removed ${runtimeStats.removedPaths} development-only directories (${formatSize(runtimeStats.removedBytes)})`,
    );
    console.log("");
  }

  // 9. Pre-compile .pyc bytecode (speeds up first launch significantly)
  console.log("=== Step 7: Pre-compile Python bytecode ===");
  const compileTargets = getCompileTargets({
    backendDist,
    buildMode,
    runtimeOnly,
    venvDir,
  });

  if (compileTargets.length === 0) {
    console.log("  No compile targets for this build mode");
  } else {
    if (isStandaloneBundledRuntimeMode(buildMode)) {
      console.log("  Compiling backend source only for the immutable bundled runtime...");
    } else {
      console.log("  Compiling .py -> .pyc for all packages and backend source...");
    }
    await runCommand(venvPython, ["-m", "compileall", "-q", ...compileTargets]);
    console.log("  Bytecode pre-compilation complete");
  }
  console.log("");

  // 10. Write build metadata
  console.log("=== Step 8: Write build metadata ===");
  const buildInfo = {
    mode: buildMode,
    profile: profile,
    flavor: flavor,
    python_version: PYTHON_VERSION,
    pbs_tag: PBS_TAG,
    platform: platformKey,
    built_at: new Date().toISOString(),
  };
  const buildInfoPath = path.join(backendDist, "build_info.json");
  fs.writeFileSync(buildInfoPath, JSON.stringify(buildInfo, null, 2));
  console.log(`  Written: build_info.json`);
  console.log("");

  // 11. Print summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const pythonSize = getDirSize(pythonDir);
  const venvSize = getDirSize(venvDir);
  const sourceSize = runtimeOnly
    ? 0
    : getDirSize(path.join(backendDist, "api")) +
      getDirSize(path.join(backendDist, "websocket")) +
      (fs.existsSync(path.join(backendDist, "main.py")) ? fs.statSync(path.join(backendDist, "main.py")).size : 0) +
      getDirSize(path.join(backendDist, "public"));
  const totalSize = getDirSize(backendDist);

  console.log("========================================");
  console.log("  Setup Complete!");
  console.log("========================================");
  console.log("");
  console.log(`  Flavor:       ${flavor.toUpperCase()}`);
  console.log(`  Profile:      ${profile}`);
  console.log(`  Python:       ${formatSize(pythonSize)}`);
  console.log(`  Venv:         ${formatSize(venvSize)}`);
  if (!runtimeOnly) {
    console.log(`  Source:       ${formatSize(sourceSize)}`);
  }
  console.log(`  Total:        ${formatSize(totalSize)}`);
  console.log(`  Time:         ${elapsed}s`);
  console.log("");
  console.log(`  Output: ${path.relative(projectRoot, backendDist) || "."}/`);
  console.log("    python/    — Embedded CPython runtime");
  console.log("    venv/      — Managed virtual environment");
  if (!runtimeOnly) {
    console.log("    api/       — FastAPI routers");
    console.log("    websocket/ — WebSocket manager");
    console.log("    main.py    — Backend entry point");
  }
  console.log("");
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Setup failed:", error.message);
    process.exit(1);
  });
}

module.exports = {
  getCompileTargets,
  isStandaloneBundledRuntimeMode,
  pruneStandaloneRuntimeArtifacts,
};
