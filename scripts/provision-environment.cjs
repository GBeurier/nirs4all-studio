/**
 * Create a Python environment the way Studio does on first launch: the pinned
 * Python runtime, a virtual environment made by the shipped uv, and the
 * required packages installed from the shipped wheels. With an offline payload
 * nothing is fetched from the network. The packaged-application smokes and the
 * Docker image use it.
 *
 * Usage:
 *   node scripts/provision-environment.cjs --backend-root <directory> --env-dir <directory> [--recommended <name,...>]
 *
 * `--backend-root` is the application's `resources/backend` (or backend-dist/):
 * it holds tools/uv, wheels/ and, for the offline variant, offline/.
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const catalogue = require("../recommended-config.json");
const { uvExecutableName } = require("./fetch-uv.cjs");
const { getArchiveFilename, getArchiveSha256, getDownloadUrl } = require("./python-runtime-config.cjs");
const { downloadVerified } = require("./verified-download.cjs");

const COMMAND_TIMEOUT_MS = 20 * 60_000;

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { env, stdio: "inherit", timeout: COMMAND_TIMEOUT_MS, windowsHide: true });
  if (result.error || result.status !== 0) {
    throw new Error(`${path.basename(command)} ${args[0]} failed: ${result.error?.message ?? `exit code ${result.status}`}`);
  }
}

function extractPython(archive, destination) {
  const args = ["-xzf", archive.replace(/\\/g, "/"), "-C", destination.replace(/\\/g, "/")];
  // GNU tar reads a Windows drive letter as a remote host; bsdtar has no such option.
  const gnuTarOnWindows = process.platform === "win32"
    && spawnSync("tar", ["--version"], { encoding: "utf8", windowsHide: true }).stdout?.includes("GNU tar");
  run("tar", gnuTarOnWindows ? [...args, "--force-local"] : args);
}

function recommendedSpecs(names) {
  return names.map((name) => {
    const spec = catalogue.optional[name];
    if (!spec) throw new Error(`"${name}" is not in Studio's package catalogue`);
    return `${name}==${spec.recommended}`;
  });
}

/**
 * Create `<envDir>/python` and `<envDir>/venv`, install the required cohort at
 * its catalogue versions and the `recommended` catalogue packages at their
 * recommended versions, and return the environment's interpreter.
 */
async function provisionEnvironment({
  backendRoot,
  envDir,
  platform = process.platform,
  arch = process.arch,
  recommended = [],
}) {
  const uv = path.join(backendRoot, "tools", uvExecutableName(platform));
  const wheelhouse = path.join(backendRoot, "wheels");
  const offlineRoot = path.join(backendRoot, "offline");
  const offline = fs.existsSync(offlineRoot);
  for (const shipped of [uv, wheelhouse]) {
    if (!fs.existsSync(shipped)) throw new Error(`Missing ${shipped}`);
  }
  fs.mkdirSync(envDir, { recursive: true });
  const archiveName = getArchiveFilename(platform, arch);
  const archive = offline
    ? path.join(offlineRoot, archiveName)
    : await downloadVerified(getDownloadUrl(platform, arch), path.join(envDir, archiveName), getArchiveSha256(platform, arch));
  extractPython(archive, envDir);
  if (!offline) fs.rmSync(archive, { force: true });

  const windows = platform === "win32";
  const basePython = windows ? path.join(envDir, "python", "python.exe") : path.join(envDir, "python", "bin", "python3");
  const venvDir = path.join(envDir, "venv");
  const pythonPath = windows ? path.join(venvDir, "Scripts", "python.exe") : path.join(venvDir, "bin", "python");
  // Studio's own uv settings, with a private cache so that an offline install proves the payload is complete.
  const uvEnvironment = { ...process.env, UV_LINK_MODE: "copy", UV_NATIVE_TLS: "1", UV_CACHE_DIR: path.join(envDir, ".uv-cache") };
  const wheelDirectories = [wheelhouse, ...(offline ? [path.join(offlineRoot, "wheels")] : [])];
  const install = (specs) => run(uv, [
    "pip", "install", "--python", pythonPath,
    ...(offline ? ["--offline", "--no-index"] : []),
    ...wheelDirectories.flatMap((directory) => ["--find-links", directory]),
    ...specs,
  ], uvEnvironment);

  run(uv, ["venv", venvDir, "--python", basePython, ...(offline ? ["--offline"] : [])], uvEnvironment);
  install(catalogue.required.map((spec) => `${spec.name}==${spec.install}`));
  if (recommended.length > 0) install(recommendedSpecs(recommended));
  fs.rmSync(uvEnvironment.UV_CACHE_DIR, { recursive: true, force: true });
  return { pythonPath, offline };
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = { backendRoot: "", envDir: "", recommended: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    if (flag === "--backend-root") options.backendRoot = path.resolve(value);
    else if (flag === "--env-dir") options.envDir = path.resolve(value);
    else if (flag === "--recommended") options.recommended = value.split(",");
    else throw new Error(`Unknown argument: ${flag}`);
  }
  if (!options.backendRoot || !options.envDir) throw new Error("--backend-root and --env-dir are required");
  return options;
}

if (require.main === module) {
  Promise.resolve()
    .then(() => provisionEnvironment(parseArgs()))
    .then(({ pythonPath, offline }) => console.log(`Environment ready${offline ? " (offline payload)" : ""}: ${pythonPath}`))
    .catch((error) => {
      console.error(`Environment provisioning failed: ${error.message}`);
      process.exit(1);
    });
}

module.exports = { provisionEnvironment };
