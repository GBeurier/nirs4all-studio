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
 *   --runtime-only               Build only the embedded python runtime payload + build_info.json
 *   --build-mode <id>            build_info.json mode value (default: installer)
 *   --plugin-wheel <path>        Exact pinned wheel for studio-python-plugin-runtime
 *   --tools-wheel <path>         Exact pinned nirs4all-tools wheel for the stdio converter
 *   --local-nirs4all             Install nirs4all from local source instead of PyPI
 *   --local-nirs4all-path <path> Local nirs4all source path (default: ../nirs4all, then ./nirs4all-lib)
 *   --local-dag-ml-path <path>   Optional local dag-ml Python package path
 *   --local-dag-ml-data-path <path>
 *                                Optional local dag-ml-data Python package path
 */

const { spawn, execFile } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const {
  assertProfileSupportedOnPlatform,
  PYTHON_VERSION,
  PBS_TAG,
  getArchiveFilename,
  getDownloadUrl,
  getProfileManagedPackageInstallSpecs,
  getProfilePackageInstallSpecs,
  listSupportedPlatformArchKeys,
  resolveProfileForFlavor,
} = require("./python-runtime-config.cjs");
const { BACKEND_COMMON_PACKAGES } = require("./python-http-runtime-config.cjs");

const projectRoot = path.join(__dirname, "..");
process.chdir(projectRoot);

const isWindows = process.platform === "win32";
const TORCH_CPU_INDEX_URL = "https://download.pytorch.org/whl/cpu";
const TORCH_CUDA_INDEX_URL = "https://download.pytorch.org/whl/cu124";
const TORCH_PROFILE_PACKAGE = "torch";
const CUDA_TORCH_PROFILE = "gpu-cuda-torch";
const PLUGIN_BUILD_MODE = "studio-python-plugin-runtime";
const PLUGIN_SOURCE_COMMIT = "322265576ccfaeb1ee22332d05ae04b87be4b538";
const PLUGIN_WHEEL_SHA256 = "00326c703b933ff2c4b106905e1c44f81906b918db30bb5d05aa189846c48940";
const PLUGIN_SOURCE_URL = `git+https://github.com/GBeurier/nirs4all.git@${PLUGIN_SOURCE_COMMIT}`;
const TOOLS_SOURCE_COMMIT = "e3a332633f87b4652a06f8993e63c386a3568698";
const TOOLS_WHEEL_SHA256 = "372ecec41b18c25c607fd660060f19780cdaf8aea378239fa5ade5a61d81c8dc";
const TOOLS_SOURCE_URL = `git+https://github.com/GBeurier/nirs4all-tools.git@${TOOLS_SOURCE_COMMIT}`;
const TOOLS_READER_PACKAGES = Object.freeze(["duckdb==1.5.5", "pyarrow==25.0.1"]);

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
let localNirs4allPath = "";
let localDagMlPath = "";
let localDagMlDataPath = "";
let pluginWheel = "";
let toolsWheel = "";

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
  } else if (args[i] === "--local-nirs4all-path" && args[i + 1]) {
    localNirs4allPath = path.resolve(args[++i]);
  } else if (args[i] === "--local-dag-ml-path" && args[i + 1]) {
    localDagMlPath = path.resolve(args[++i]);
  } else if (args[i] === "--local-dag-ml-data-path" && args[i + 1]) {
    localDagMlDataPath = path.resolve(args[++i]);
  } else if (args[i] === "--plugin-wheel" && args[i + 1]) {
    pluginWheel = path.resolve(args[++i]);
  } else if (args[i] === "--tools-wheel" && args[i + 1]) {
    toolsWheel = path.resolve(args[++i]);
  }
}

const pluginOnly = buildMode === PLUGIN_BUILD_MODE;

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
  if (pluginOnly && (localNirs4all || localNirs4allPath || localDagMlPath || localDagMlDataPath)) {
    throw new Error("Plugin-only runtime refuses local source and dag-ml path substitution");
  }
  if (pluginWheel && !fs.existsSync(pluginWheel)) {
    throw new Error(`Plugin wheel not found: ${pluginWheel}`);
  }
  if (toolsWheel && !fs.existsSync(toolsWheel)) {
    throw new Error(`Tools wheel not found: ${toolsWheel}`);
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

function sha256File(filePath) {
  const digest = crypto.createHash("sha256");
  digest.update(fs.readFileSync(filePath));
  return digest.digest("hex");
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
    ...(options.isolated ? ["-I"] : []),
    "-m",
    "pip",
    "install",
    "--prefer-binary",
    ...(options.noCompile ? ["--no-compile"] : []),
    ...(options.upgrade ? ["--upgrade"] : []),
    ...(options.extraPipArgs ?? []),
    ...(options.constraintsFile ? ["-c", options.constraintsFile] : []),
    ...packageSpecs,
  ];
}

function getLocalNirs4allCandidates(explicitPath = localNirs4allPath, env = process.env) {
  const candidates = [];
  if (explicitPath) {
    candidates.push(path.resolve(explicitPath));
  }
  if (env.NIRS4ALL_LOCAL_SOURCE_PATH) {
    candidates.push(path.resolve(env.NIRS4ALL_LOCAL_SOURCE_PATH));
  }
  candidates.push(path.join(projectRoot, "..", "nirs4all"));
  candidates.push(path.join(projectRoot, "nirs4all-lib"));
  return Object.freeze([...new Set(candidates)]);
}

function resolveLocalNirs4allPath(explicitPath = localNirs4allPath, env = process.env) {
  const candidates = getLocalNirs4allCandidates(explicitPath, env);
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function resolveRequiredLocalPackagePath(label, explicitPath) {
  if (!explicitPath) {
    return null;
  }
  const resolvedPath = path.resolve(explicitPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`${label} local source path not found: ${resolvedPath}`);
  }
  return resolvedPath;
}

async function installLocalPythonSource(runtimePython, label, sourcePath, options = {}) {
  const editable = Boolean(options.editable);
  console.log(`  Installing ${label} from local source (${editable ? "editable" : "copy"})...`);
  await runCommandWithRetries(runtimePython, [
    "-m",
    "pip",
    "install",
    "--prefer-binary",
    ...(options.noCompile ? ["--no-compile"] : []),
    ...(options.constraintsFile ? ["-c", options.constraintsFile] : []),
    ...(editable ? ["-e"] : []),
    sourcePath,
  ], {}, {
    retries: isWindows ? 3 : 1,
    label: `pip install ${editable ? "-e " : ""}${sourcePath}`,
  });
}

function getStandaloneTorchIndexArgs(profileId, platform = process.platform) {
  if (profileId === CUDA_TORCH_PROFILE) {
    return Object.freeze(["--index-url", TORCH_CUDA_INDEX_URL]);
  }
  if (profileId === "cpu" && platform !== "darwin") {
    return Object.freeze(["--index-url", TORCH_CPU_INDEX_URL]);
  }
  return Object.freeze([]);
}

function getDependencyInstallPhases(profileId, platform = process.platform) {
  const torchExtraPipArgs = getStandaloneTorchIndexArgs(profileId, platform);
  const torchSpecs = getProfileManagedPackageInstallSpecs(profileId, {
    omitPackages: ["nirs4all"],
    packageNames: [TORCH_PROFILE_PACKAGE],
  });
  const remainingSpecs = Object.freeze([
    ...BACKEND_COMMON_PACKAGES,
    ...getProfilePackageInstallSpecs(profileId, {
      omitPackages: ["nirs4all", TORCH_PROFILE_PACKAGE],
    }),
  ]);

  if (torchSpecs.length === 0 || torchExtraPipArgs.length === 0) {
    return Object.freeze([
      Object.freeze({
        label: "backend dependencies",
        packageSpecs: Object.freeze([
          ...BACKEND_COMMON_PACKAGES,
          ...getProfilePackageInstallSpecs(profileId, {
            omitPackages: ["nirs4all"],
          }),
        ]),
        extraPipArgs: Object.freeze([]),
      }),
    ]);
  }

  return Object.freeze([
    Object.freeze({
      label: `${TORCH_PROFILE_PACKAGE} runtime`,
      packageSpecs: torchSpecs,
      extraPipArgs: torchExtraPipArgs,
    }),
    Object.freeze({
      label: "backend dependencies",
      packageSpecs: remainingSpecs,
      extraPipArgs: Object.freeze([]),
    }),
  ]);
}

function isStandaloneBundledRuntimeMode(mode = buildMode) {
  return mode === "standalone-bundled-runtime" || mode === PLUGIN_BUILD_MODE;
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
  const pruneDirNames = new Set(["Headers", "cmake", "include", "pkgconfig", "__pycache__"]);
  const pruneShareLeafNames = new Set(["doc", "docs", "gtk-doc", "info", "man"]);
  if (pluginOnly) {
    // The library/plugin worker has no terminal UI. PBS ships terminfo largely
    // as symlink aliases, which are forbidden in the packaged closure.
    pruneShareLeafNames.add("terminfo");
  }
  const targets = new Set();

  walkTreeSync(runtimeRoot, (entryPath, entry) => {
    const parentName = path.basename(path.dirname(entryPath));
    if (pluginOnly && parentName === "site-packages" && (
      ["pip", "setuptools", "pkg_resources", "_distutils_hack"].includes(entry.name) ||
      /^(?:pip|setuptools)-.*\.dist-info$/i.test(entry.name)
    )) {
      targets.add(entryPath);
      return false;
    }
    if (pluginOnly && entry.isFile() && (
      entry.name.endsWith(".pth") ||
      entry.name === "direct_url.json" ||
      entry.name === "INSTALLER" ||
      entry.name === "REQUESTED"
    )) {
      targets.add(entryPath);
      return false;
    }
    if (!entry.isDirectory()) {
      return true;
    }

    if (pruneDirNames.has(entry.name)) {
      targets.add(entryPath);
      return false;
    }

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

async function restorePinnedWheelRecord(runtimePython, runtimeRoot, wheelPath, distribution, version) {
  const script = String.raw`import pathlib,sys,zipfile
root=pathlib.Path(sys.argv[1])
wheel=pathlib.Path(sys.argv[2])
distribution=sys.argv[3]
version=sys.argv[4]
with zipfile.ZipFile(wheel) as archive:
    suffix=f"{distribution}-{version}.dist-info/RECORD"
    members=[name for name in archive.namelist() if name.endswith(suffix)]
    if len(members) != 1: raise RuntimeError(f"expected one wheel RECORD, found {len(members)}")
    payload=archive.read(members[0])
candidates=list(root.glob(f"python/Lib/site-packages/{suffix}"))+list(root.glob(f"python/lib/python3.*/site-packages/{suffix}"))
if len(candidates) != 1: raise RuntimeError(f"expected one installed RECORD, found {len(candidates)}")
candidates[0].write_bytes(payload)`;
  await runCommand(runtimePython, ["-I", "-S", "-B", "-c", script, runtimeRoot, wheelPath, distribution, version]);
}

function pruneStandaloneRuntimeLaunchers(buildRoot) {
  const targets = [];
  const windowsScriptsDir = path.join(buildRoot, "python", "Scripts");
  const posixBinDir = path.join(buildRoot, "python", "bin");
  const keepPosixLauncherPattern = /^python(?:\d+(?:\.\d+)*)?$/;

  if (fs.existsSync(windowsScriptsDir)) {
    targets.push(windowsScriptsDir);
  }

  if (fs.existsSync(posixBinDir)) {
    const entries = fs.readdirSync(posixBinDir, { withFileTypes: true });
    for (const entry of entries) {
      if (keepPosixLauncherPattern.test(entry.name)) {
        continue;
      }
      targets.push(path.join(posixBinDir, entry.name));
    }
  }

  let removedBytes = 0;
  let removedPaths = 0;

  for (const targetPath of targets) {
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
  console.log(`  Plugin wheel:   ${pluginWheel || "(rebuild pinned source)"}`);
  console.log(`  Local nirs4all: ${localNirs4all}`);
  if (localNirs4all) {
    console.log(`  Local source:   ${resolveLocalNirs4allPath() || "(not found)"}`);
  }
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

  // 5. Prepare Python runtime
  const venvDir = path.join(backendDist, "venv");
  const useBundledBasePython = isStandaloneBundledRuntimeMode(buildMode);
  let runtimePython = embeddedPython;

  if (useBundledBasePython) {
    console.log("=== Step 3: Prepare bundled Python runtime ===");
    if (fs.existsSync(venvDir)) {
      console.log("  Removing stale legacy venv/ from previous builds...");
      fs.rmSync(venvDir, { recursive: true, force: true });
    }
    console.log("  Using embedded Python directly for the relocatable standalone runtime...");
  } else {
    console.log("=== Step 3: Create virtual environment ===");
    if (fs.existsSync(venvDir)) {
      console.log("  Venv directory already exists, removing...");
      fs.rmSync(venvDir, { recursive: true, force: true });
    }

    console.log("  Creating venv (without pip)...");
    await runCommand(embeddedPython, ["-m", "venv", venvDir, "--without-pip"]);

    runtimePython = isWindows
      ? path.join(venvDir, "Scripts", "python.exe")
      : path.join(venvDir, "bin", "python");

    if (!fs.existsSync(runtimePython)) {
      console.error(`Error: Venv Python not found at ${runtimePython}`);
      process.exit(1);
    }
  }

  console.log("  Bootstrapping pip via ensurepip...");
  const isolatedPythonArgs = pluginOnly ? ["-I"] : [];
  await runCommand(runtimePython, [...isolatedPythonArgs, "-m", "ensurepip", "--upgrade"]);

  // Verify pip is usable
  await runCommand(runtimePython, [...isolatedPythonArgs, "-m", "pip", "--version"]);

  // The plugin runtime uses the pip bundled by the pinned PBS archive. Pulling
  // an unpinned "latest" pip would make its packaged closure time-dependent.
  if (pluginOnly) {
    console.log("  Keeping the pinned python-build-standalone pip...");
  } else {
    console.log("  Upgrading pip...");
    await runCommandWithRetries(runtimePython, [
      "-m",
      "pip",
      "install",
      ...(useBundledBasePython ? ["--no-compile"] : []),
      "--upgrade",
      "pip",
    ], {}, {
      retries: isWindows ? 3 : 1,
      label: "pip install --upgrade pip",
    });
  }
  console.log("");

  // 6. Install dependencies
  console.log(`=== Step 4: Install dependencies (${profile}) ===`);
  const dependencyInstallPhases = pluginOnly
    ? Object.freeze([])
    : getDependencyInstallPhases(profile, process.platform);
  const dependencyCount = dependencyInstallPhases.reduce((total, phase) => total + phase.packageSpecs.length, 0);
  console.log(`  Installing ${dependencyCount} backend packages from shared runtime config...`);
  // Large wheel installs on Windows can hit transient RECORD/file-lock races.
  for (const phase of dependencyInstallPhases) {
    const pipArgs = buildPipInstallArgs(phase.packageSpecs, {
      constraintsFile,
      extraPipArgs: phase.extraPipArgs,
      noCompile: useBundledBasePython,
    });
    const sourceLabel = phase.extraPipArgs.length > 0 ? ` via ${phase.extraPipArgs.join(" ")}` : "";
    console.log(`  Installing ${phase.packageSpecs.length} packages for ${phase.label}${sourceLabel}...`);
    await runCommandWithRetries(runtimePython, pipArgs, {}, {
      retries: isWindows ? 3 : 1,
      label: `pip install ${phase.label}`,
    });
  }

  // 7. Install optional local dag-ml runtimes before nirs4all so the Python
  // oracle/runtime package resolves against the RC native backend stack.
  const resolvedLocalDagMlDataPath = pluginOnly
    ? null
    : resolveRequiredLocalPackagePath("dag-ml-data", localDagMlDataPath);
  const resolvedLocalDagMlPath = pluginOnly
    ? null
    : resolveRequiredLocalPackagePath("dag-ml", localDagMlPath);
  if (resolvedLocalDagMlDataPath || resolvedLocalDagMlPath) {
    console.log("");
    console.log("=== Step 5: Install dag-ml runtime packages ===");
    const editable = !useBundledBasePython;
    if (resolvedLocalDagMlDataPath) {
      await installLocalPythonSource(runtimePython, "dag-ml-data", resolvedLocalDagMlDataPath, {
        constraintsFile,
        editable,
        noCompile: useBundledBasePython,
      });
    }
    if (resolvedLocalDagMlPath) {
      await installLocalPythonSource(runtimePython, "dag-ml", resolvedLocalDagMlPath, {
        constraintsFile,
        editable,
        noCompile: useBundledBasePython,
      });
    }
  }

  // 8. Install nirs4all
  console.log("");
  console.log("=== Step 6: Install nirs4all ===");

  const resolvedLocalNirs4allPath = pluginOnly ? null : resolveLocalNirs4allPath();
  let selectedPluginWheel = null;
  let selectedToolsWheel = null;
  if (pluginOnly) {
    const wheelDir = path.join(cacheDir, "studio-python-plugin-wheel");
    fs.mkdirSync(wheelDir, { recursive: true });
    if (pluginWheel) {
      selectedPluginWheel = pluginWheel;
    } else {
      for (const entry of fs.readdirSync(wheelDir)) {
        if (entry.endsWith(".whl")) fs.rmSync(path.join(wheelDir, entry), { force: true });
      }
      await runCommandWithRetries(runtimePython, [
        "-I",
        "-m",
        "pip",
        "wheel",
        "--no-deps",
        "--wheel-dir",
        wheelDir,
        PLUGIN_SOURCE_URL,
      ], {}, {
        retries: isWindows ? 3 : 1,
        label: "build pinned nirs4all plugin wheel",
      });
      const wheels = fs.readdirSync(wheelDir)
        .filter((entry) => /^nirs4all-.*\.whl$/i.test(entry));
      if (wheels.length !== 1) {
        throw new Error(`Pinned plugin build produced ${wheels.length} nirs4all wheels`);
      }
      selectedPluginWheel = path.join(wheelDir, wheels[0]);
    }
    const actualWheelSha256 = sha256File(selectedPluginWheel);
    if (actualWheelSha256 !== PLUGIN_WHEEL_SHA256) {
      throw new Error(
        `Pinned plugin wheel identity mismatch: expected ${PLUGIN_WHEEL_SHA256}, got ${actualWheelSha256}`,
      );
    }
    await runCommandWithRetries(runtimePython, buildPipInstallArgs([selectedPluginWheel], {
      constraintsFile,
      isolated: true,
      noCompile: true,
    }), {}, {
      retries: isWindows ? 3 : 1,
      label: "install pinned nirs4all plugin wheel",
    });
    await runCommandWithRetries(runtimePython, buildPipInstallArgs(TOOLS_READER_PACKAGES, {
      constraintsFile,
      isolated: true,
      noCompile: true,
      upgrade: true,
    }), {}, {
      retries: isWindows ? 3 : 1,
      label: "install exact legacy converter readers",
    });
    const toolsWheelDir = path.join(cacheDir, "studio-python-tools-wheel");
    fs.mkdirSync(toolsWheelDir, { recursive: true });
    if (toolsWheel) {
      selectedToolsWheel = toolsWheel;
    } else {
      for (const entry of fs.readdirSync(toolsWheelDir)) {
        if (entry.endsWith(".whl")) fs.rmSync(path.join(toolsWheelDir, entry), { force: true });
      }
      await runCommandWithRetries(runtimePython, [
        "-I", "-m", "pip", "wheel", "--no-deps", "--wheel-dir", toolsWheelDir, TOOLS_SOURCE_URL,
      ], {}, {
        retries: isWindows ? 3 : 1,
        label: "build pinned nirs4all-tools wheel",
      });
      const wheels = fs.readdirSync(toolsWheelDir)
        .filter((entry) => /^nirs4all_tools-.*\.whl$/i.test(entry));
      if (wheels.length !== 1) {
        throw new Error(`Pinned tools build produced ${wheels.length} nirs4all-tools wheels`);
      }
      selectedToolsWheel = path.join(toolsWheelDir, wheels[0]);
    }
    const actualToolsWheelSha256 = sha256File(selectedToolsWheel);
    if (actualToolsWheelSha256 !== TOOLS_WHEEL_SHA256) {
      throw new Error(
        `Pinned tools wheel identity mismatch: expected ${TOOLS_WHEEL_SHA256}, got ${actualToolsWheelSha256}`,
      );
    }
    await runCommandWithRetries(runtimePython, buildPipInstallArgs([selectedToolsWheel], {
      constraintsFile,
      isolated: true,
      noCompile: true,
      extraPipArgs: ["--no-deps"],
    }), {}, {
      retries: isWindows ? 3 : 1,
      label: "install pinned nirs4all-tools wheel",
    });
  } else if (localNirs4all && resolvedLocalNirs4allPath) {
    // A distributable bundle must NOT install nirs4all editable: an editable
    // install leaves path-dependent artifacts (__editable__*.pth / *_finder.py
    // / direct_url.json) pointing at the build machine's checkout, so
    // `import nirs4all` fails on the user's machine. Install a *copy*
    // (non-editable) into the bundled runtime. Editable is kept only for
    // non-bundled dev setups where live-editing the local source is wanted.
    await installLocalPythonSource(runtimePython, "nirs4all", resolvedLocalNirs4allPath, {
      constraintsFile,
      editable: !useBundledBasePython,
      noCompile: useBundledBasePython,
    });
  } else if (localNirs4all) {
    console.log(`  Warning: --local-nirs4all specified but no local source was found. Checked: ${getLocalNirs4allCandidates().join(", ")}`);
    const [nirs4allSpec] = getProfilePackageInstallSpecs(profile, {
      includeExtraPackages: false,
      packageNames: ["nirs4all"],
    });
    console.log(`  Installing ${nirs4allSpec} from PyPI...`);
    await runCommandWithRetries(runtimePython, buildPipInstallArgs([nirs4allSpec], {
      constraintsFile,
      noCompile: useBundledBasePython,
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
    await runCommandWithRetries(runtimePython, buildPipInstallArgs([nirs4allSpec], {
      constraintsFile,
      noCompile: useBundledBasePython,
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
    const launcherStats = pruneStandaloneRuntimeLaunchers(backendDist);
    console.log(
      `  Removed ${runtimeStats.removedPaths + launcherStats.removedPaths} development-only paths (${formatSize(runtimeStats.removedBytes + launcherStats.removedBytes)})`,
    );
    if (pluginOnly) {
      await restorePinnedWheelRecord(runtimePython, backendDist, selectedPluginWheel, "nirs4all", "0.10.3");
      await restorePinnedWheelRecord(runtimePython, backendDist, selectedToolsWheel, "nirs4all_tools", "0.0.7");
      console.log("  Restored both exact pinned wheel RECORDs after isolated installation");
    }
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
    console.log(
      isStandaloneBundledRuntimeMode(buildMode)
        ? "  Compiling backend source..."
        : "  Compiling .py -> .pyc for all packages and backend source...",
    );
    await runCommand(runtimePython, ["-m", "compileall", "-q", ...compileTargets]);
    console.log("  Bytecode pre-compilation complete");
  }

  // The bundled runtime is pip-installed with --no-compile, so its third-party
  // packages (fastapi/pydantic/nirs4all/...) ship without .pyc and compile on
  // first import — a major cause of slow first launch (notably Intel macOS).
  // Pre-compile the whole runtime here. Best-effort: a single odd .py in some
  // dependency must not fail the bake.
  if (buildMode === "standalone-bundled-runtime" && fs.existsSync(pythonDir)) {
    console.log("  Pre-compiling the bundled runtime (third-party packages)...");
    try {
      await runCommand(runtimePython, ["-m", "compileall", "-q", "-j", "0", pythonDir]);
      console.log("  Runtime bytecode pre-compilation complete");
    } catch (err) {
      console.log(`  Warning: runtime pre-compile reported errors (non-fatal): ${err.message}`);
    }
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
    python_role: pluginOnly ? "library-plugin-host-only" : null,
    selected_source_commit: pluginOnly ? PLUGIN_SOURCE_COMMIT : null,
    selected_wheel_sha256: pluginOnly ? PLUGIN_WHEEL_SHA256 : null,
    selected_wheel_filename: selectedPluginWheel ? path.basename(selectedPluginWheel) : null,
    conversion_tools_source_commit: pluginOnly ? TOOLS_SOURCE_COMMIT : null,
    conversion_tools_wheel_sha256: pluginOnly ? TOOLS_WHEEL_SHA256 : null,
    conversion_tools_wheel_filename: selectedToolsWheel ? path.basename(selectedToolsWheel) : null,
  };
  const buildInfoPath = path.join(backendDist, "build_info.json");
  fs.writeFileSync(buildInfoPath, JSON.stringify(buildInfo, null, 2));
  console.log(`  Written: build_info.json`);
  console.log("");

  // 11. Print summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const pythonSize = getDirSize(pythonDir);
  const venvSize = useBundledBasePython ? 0 : getDirSize(venvDir);
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
  if (!useBundledBasePython) {
    console.log(`  Venv:         ${formatSize(venvSize)}`);
  }
  if (!runtimeOnly) {
    console.log(`  Source:       ${formatSize(sourceSize)}`);
  }
  console.log(`  Total:        ${formatSize(totalSize)}`);
  console.log(`  Time:         ${elapsed}s`);
  console.log("");
  console.log(`  Output: ${path.relative(projectRoot, backendDist) || "."}/`);
  if (useBundledBasePython) {
    console.log("    python/    — Embedded CPython runtime with bundled packages");
  } else {
    console.log("    python/    — Embedded CPython runtime");
    console.log("    venv/      — Managed virtual environment");
  }
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
  buildPipInstallArgs,
  getLocalNirs4allCandidates,
  resolveLocalNirs4allPath,
  getDependencyInstallPhases,
  pruneStandaloneRuntimeArtifacts,
  pruneStandaloneRuntimeLaunchers,
};
