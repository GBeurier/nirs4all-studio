/**
 * macOS applications ship no wheels: pack the staged wheelhouse of the
 * required cohort as a release asset and leave its descriptor in its place.
 *
 * Moves backend-dist/wheels/ into release/<asset>.tar.gz (single top-level
 * directory `wheels/`), writes release/<asset>.tar.gz.sha256 and
 * backend-dist/wheelhouse.json: `{ url, sha256, filename }`, where `url` is
 * the asset of the GitHub release `<tag>`. Studio downloads and verifies that
 * archive the first time it installs the required packages.
 *
 * Usage:
 *   node scripts/pack-remote-wheelhouse.cjs --tag <release tag> --version <version> [--platform darwin] [--arch arm64]
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { parseTargetArgs } = require("./fetch-uv.cjs");
const { remoteWheelhouseAssetName, targetKey } = require("./python-wheel-lock.cjs");
const { sha256File } = require("./verified-download.cjs");

const projectRoot = path.join(__dirname, "..");
const RELEASE_DOWNLOAD_URL = "https://github.com/GBeurier/nirs4all-studio/releases/download";

function packRemoteWheelhouse({ platform, arch, tag, version }) {
  if (!tag || !version) throw new Error("--tag and --version are required");
  const filename = remoteWheelhouseAssetName(targetKey(platform, arch), version);
  const backendRoot = path.join(projectRoot, "backend-dist");
  const wheelhouse = path.join(backendRoot, "wheels");
  if (!fs.existsSync(wheelhouse) || !fs.readdirSync(wheelhouse).some((name) => name.endsWith(".whl"))) {
    throw new Error(`No staged wheelhouse in ${wheelhouse}; run node scripts/build-wheelhouse.cjs first`);
  }
  const archive = path.join(projectRoot, "release", filename);
  fs.mkdirSync(path.dirname(archive), { recursive: true });
  const result = spawnSync("tar", ["-czf", archive, "-C", backendRoot, "wheels"], {
    stdio: "inherit",
    // Keep macOS tar from adding AppleDouble `._*` members.
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Could not pack ${filename}: ${result.error?.message ?? `tar exited with ${result.status}`}`);
  }
  const sha256 = sha256File(archive);
  fs.writeFileSync(`${archive}.sha256`, `${sha256}  ${filename}\n`);
  fs.writeFileSync(
    path.join(backendRoot, "wheelhouse.json"),
    `${JSON.stringify({ url: `${RELEASE_DOWNLOAD_URL}/${tag}/${filename}`, sha256, filename }, null, 2)}\n`,
  );
  fs.rmSync(wheelhouse, { recursive: true });
  return archive;
}

try {
  const archive = packRemoteWheelhouse(parseTargetArgs(undefined, { valueFlags: ["tag", "version"] }));
  console.log(`Remote wheelhouse packed as ${archive}`);
} catch (error) {
  console.error(`Remote wheelhouse packing failed: ${error.message}`);
  process.exit(1);
}
