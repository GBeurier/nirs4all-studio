/**
 * Stage an offline payload for a target into backend-dist/offline/: the pinned
 * python-build-standalone archive and, under wheels/, the rest of a locked
 * closure. The required cohort itself stays in backend-dist/wheels/.
 *
 * Without `--image` the closure is the one of the offline installer
 * (dependencies of the required cohort, the recommended packages installed by
 * default and those the catalogue keeps in the payload although they are
 * installed on request only). With `--image` it is the one of the Docker
 * image, whose environment is then created from pinned files only.
 *
 * Usage:
 *   node scripts/build-offline-payload.cjs [--platform <win32|linux>] [--arch x64] [--image]
 */

const fs = require("node:fs");
const path = require("node:path");
const { parseTargetArgs } = require("./fetch-uv.cjs");
const { getArchiveFilename, getArchiveSha256, getDownloadUrl } = require("./python-runtime-config.cjs");
const { lockedPackages, readLock, stageLockedPackages, targetKey } = require("./python-wheel-lock.cjs");
const { downloadVerified } = require("./verified-download.cjs");

const projectRoot = path.join(__dirname, "..");

async function buildOfflinePayload({ platform, arch, image = false }) {
  const backendRoot = path.join(projectRoot, "backend-dist");
  const key = targetKey(platform, arch);
  const entries = lockedPackages(readLock(key), image ? "image" : "offline");
  const destination = path.join(backendRoot, "offline");
  const archive = getArchiveFilename(platform, arch);
  fs.mkdirSync(destination, { recursive: true });
  for (const name of fs.readdirSync(destination)) {
    if (name !== archive && name !== "wheels") fs.rmSync(path.join(destination, name), { recursive: true, force: true });
  }
  await downloadVerified(getDownloadUrl(platform, arch), path.join(destination, archive), getArchiveSha256(platform, arch));
  const wheels = await stageLockedPackages(entries, path.join(destination, "wheels"), key, backendRoot);
  return { destination, archive, wheels };
}

Promise.resolve()
  .then(() => buildOfflinePayload(parseTargetArgs(undefined, { booleanFlags: ["image"] })))
  .then(({ destination, archive, wheels }) => console.log(`${archive} and ${wheels.length} wheels staged in ${destination}`))
  .catch((error) => {
    console.error(`Offline payload build failed: ${error.message}`);
    process.exit(1);
  });
