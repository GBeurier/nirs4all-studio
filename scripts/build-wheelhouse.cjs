/**
 * Stage the wheels of the required cohort for a target into backend-dist/wheels/.
 * Windows and Linux installers embed them. A macOS application embeds no
 * wheels (Studio installs its required packages from the package index), so
 * the macOS target is refused.
 *
 * Usage:
 *   node scripts/build-wheelhouse.cjs [--platform <win32|linux>] [--arch x64]
 */

const path = require("node:path");
const { parseTargetArgs } = require("./fetch-uv.cjs");
const { TARGETS, lockedPackages, readLock, stageLockedPackages, targetKey } = require("./python-wheel-lock.cjs");

const projectRoot = path.join(__dirname, "..");

async function buildWheelhouse({ platform, arch }) {
  const backendRoot = path.join(projectRoot, "backend-dist");
  const key = targetKey(platform, arch);
  if (!TARGETS[key].embeddedWheels) throw new Error(`The ${key} application embeds no wheels`);
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
