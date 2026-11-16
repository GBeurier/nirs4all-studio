/**
 * Stage the wheels of the required cohort for a target into backend-dist/wheels/.
 * Windows and Linux installers ship them; the macOS build publishes them as a
 * release asset instead (see scripts/pack-remote-wheelhouse.cjs).
 *
 * Usage:
 *   node scripts/build-wheelhouse.cjs [--platform <win32|linux|darwin>] [--arch <x64|arm64>]
 */

const path = require("node:path");
const { parseTargetArgs } = require("./fetch-uv.cjs");
const { lockedPackages, readLock, stageLockedPackages, targetKey } = require("./python-wheel-lock.cjs");

const projectRoot = path.join(__dirname, "..");

async function buildWheelhouse({ platform, arch }) {
  const backendRoot = path.join(projectRoot, "backend-dist");
  const key = targetKey(platform, arch);
  const destination = path.join(backendRoot, "wheels");
  const wheels = await stageLockedPackages(lockedPackages(readLock(key), "required"), destination, key, backendRoot);
  return { destination, wheels };
}

Promise.resolve()
  .then(() => buildWheelhouse(parseTargetArgs()))
  .then(({ destination, wheels }) => console.log(`${wheels.length} required wheels staged in ${destination}`))
  .catch((error) => {
    console.error(`Wheelhouse build failed: ${error.message}`);
    process.exit(1);
  });
