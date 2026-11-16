/**
 * Fetch the pinned uv release for a target into backend-dist/tools/.
 *
 * Usage:
 *   node scripts/fetch-uv.cjs [--platform <win32|linux|darwin>] [--arch <x64|arm64>]
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { downloadVerified } = require("./verified-download.cjs");

const projectRoot = path.join(__dirname, "..");
const UV_VERSION = "0.10.4";
const UV_BASE_URL = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}`;

// SHA-256 values from the `.sha256` files published with the release.
const UV_ARCHIVES = Object.freeze({
  "linux-x64": Object.freeze({
    filename: "uv-x86_64-unknown-linux-gnu.tar.gz",
    sha256: "6b52a47358deea1c5e173278bf46b2b489747a59ae31f2a4362ed5c6c1c269f7",
  }),
  "win32-x64": Object.freeze({
    filename: "uv-x86_64-pc-windows-msvc.zip",
    sha256: "0f0e22d7507633bfb38d9b42fb6a0341f1f74b8e80b070a31231c354812432a3",
  }),
  "darwin-x64": Object.freeze({
    filename: "uv-x86_64-apple-darwin.tar.gz",
    sha256: "df6dd1c3ebeab4369a098c516c15c233c62bf789a40a4864b30dad1d38d7604e",
  }),
  "darwin-arm64": Object.freeze({
    filename: "uv-aarch64-apple-darwin.tar.gz",
    sha256: "a6852e4dc565c8fedcf5adcdf09fca7caf5347739bed512bd95b15dada36db51",
  }),
});

function uvExecutableName(platform) {
  return platform === "win32" ? "uv.exe" : "uv";
}

function parseTargetArgs(argv = process.argv.slice(2)) {
  const target = { platform: process.platform, arch: process.arch };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag !== "--platform" && flag !== "--arch") throw new Error(`Unknown argument: ${flag}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    target[flag.slice(2)] = value;
  }
  return target;
}

function extractArchive(archivePath, destination) {
  // Only bsdtar reads ZIP archives. Windows ships it in System32; a GNU tar
  // from Git may come first on PATH there.
  const zip = archivePath.endsWith(".zip");
  const windowsTar = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  const [command, args] = zip && process.platform !== "win32"
    ? ["unzip", ["-q", archivePath, "-d", destination]]
    : [zip ? windowsTar : "tar", ["-xf", archivePath, "-C", destination]];
  const result = spawnSync(command, args, { stdio: "inherit", windowsHide: true });
  if (result.error || result.status !== 0) {
    throw new Error(`Could not extract ${path.basename(archivePath)}: ${result.error?.message ?? `${command} exited with ${result.status}`}`);
  }
}

function findFile(directory, name) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === name) return entryPath;
    const nested = entry.isDirectory() ? findFile(entryPath, name) : null;
    if (nested) return nested;
  }
  return null;
}

async function fetchUv({ platform, arch }) {
  const backendRoot = path.join(projectRoot, "backend-dist");
  const archive = UV_ARCHIVES[`${platform}-${arch}`];
  if (!archive) {
    throw new Error(`No pinned uv release for '${platform}-${arch}'. Supported: ${Object.keys(UV_ARCHIVES).join(", ")}`);
  }
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-uv-"));
  try {
    const archivePath = await downloadVerified(`${UV_BASE_URL}/${archive.filename}`, path.join(workDir, archive.filename), archive.sha256);
    const extracted = path.join(workDir, "extracted");
    fs.mkdirSync(extracted);
    extractArchive(archivePath, extracted);
    const executable = findFile(extracted, uvExecutableName(platform));
    if (!executable) throw new Error(`${archive.filename} does not contain ${uvExecutableName(platform)}`);
    const destination = path.join(backendRoot, "tools", uvExecutableName(platform));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(executable, destination);
    if (platform !== "win32") fs.chmodSync(destination, 0o755);
    return destination;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  Promise.resolve()
    .then(() => fetchUv(parseTargetArgs()))
    .then((destination) => console.log(`uv ${UV_VERSION} staged at ${destination}`))
    .catch((error) => {
      console.error(`uv fetch failed: ${error.message}`);
      process.exit(1);
    });
}

module.exports = { UV_ARCHIVES, parseTargetArgs, uvExecutableName };
