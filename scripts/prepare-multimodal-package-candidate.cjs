/**
 * Patch a disposable Studio checkout so that it ships unpublished candidate
 * wheels of required packages through the product's own mechanism.
 *
 * For every candidate wheel the script
 *   - sets the package's `install` version in recommended-config.json
 *     (`required`); the accepted `range` is left as the checkout declares it,
 *   - replaces the package's entry in the target's wheel lock
 *     (build/constraints/python-wheels-<target>.json) with the candidate's
 *     file name and SHA-256,
 *   - copies the wheel into backend-dist/wheels/.
 * `scripts/build-wheelhouse.cjs` then keeps a staged wheel only when its
 * SHA-256 is the locked one and downloads the other required wheels, the
 * runtime contract checks one wheel per required package at its catalogue
 * version, and the application installs the candidates from its shipped
 * `wheels/` when it creates its environment.
 *
 * Only the wheels of the standard installer are adjusted: the offline and
 * Docker closures of the lock still describe the published cohort and must
 * not be built from this checkout. A macOS application embeds no wheels and
 * installs its required packages from the package index, so it cannot ship an
 * unpublished candidate.
 *
 * Usage:
 *   node scripts/prepare-multimodal-package-candidate.cjs \
 *     --wheel <file> [--wheel <file> ...] --app-version <version> \
 *     [--platform <win32|linux>] [--arch x64]
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { TARGETS, lockPath, readLock, targetKey, wheelRank } = require("./python-wheel-lock.cjs");
const { sha256File } = require("./verified-download.cjs");

const projectRoot = path.join(__dirname, "..");
const PINNED_FILES = ["recommended-config.json", "build/constraints", "package.json", "package-lock.json", "version.json"];

function git(args) {
  const result = spawnSync("git", args, { cwd: projectRoot, encoding: "utf8", windowsHide: true });
  // Some restricted hosts report EPERM after a child has exited. A numeric
  // status proves the command ran; a missing status remains a hard failure.
  assert.notEqual(result.status, null, `Unable to run git ${args[0]}: ${result.error?.message ?? "unknown error"}`);
  return result;
}

function normalizeName(name) {
  return name.replace(/[-_.]+/g, "-").toLowerCase();
}

function writeJson(filename, data) {
  fs.writeFileSync(filename, `${JSON.stringify(data, null, 2)}\n`);
}

function parseArgs(argv) {
  const options = { wheels: [], appVersion: "", platform: process.platform, arch: process.arch };
  const flags = { "--app-version": "appVersion", "--platform": "platform", "--arch": "arch" };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    assert.ok((flag === "--wheel" || flags[flag]) && value && !value.startsWith("--"), `Invalid candidate argument: ${flag}`);
    if (flag === "--wheel") options.wheels.push(value);
    else options[flags[flag]] = value;
  }
  assert.ok(options.wheels.length > 0, "Missing candidate argument: --wheel");
  assert.ok(options.appVersion, "Missing candidate argument: --app-version");
  return options;
}

/** Give the checkout a version that no published installer carries. */
function setAppVersion(root, appVersion, commit) {
  assert.match(appVersion, /^\d+\.\d+\.\d+(?:[.-][a-z0-9.-]+)?$/i);
  const released = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  assert.notEqual(appVersion, released, "A candidate needs an app version distinct from the released one");
  for (const relativePath of ["package.json", "package-lock.json", "version.json"]) {
    const filename = path.join(root, relativePath);
    const data = JSON.parse(fs.readFileSync(filename, "utf8"));
    assert.equal(data.version, released, `${relativePath}: unexpected app version`);
    data.version = appVersion;
    if (relativePath === "package-lock.json") {
      assert.equal(data.packages?.[""]?.version, released, "package-lock root version drift");
      data.packages[""].version = appVersion;
    }
    if (relativePath === "version.json") {
      data.build_date = new Date().toISOString();
      data.commit = commit;
    }
    writeJson(filename, data);
  }
}

/**
 * Select the candidate wheels as the required packages that `root` ships for
 * the target, and stage them. Returns what the checkout now pins.
 */
function prepareCandidate({ wheels, appVersion, platform, arch, commit }, root = projectRoot) {
  const key = targetKey(platform, arch);
  assert.ok(TARGETS[key].embeddedWheels,
    `The ${key} application embeds no wheels: it installs its required packages from the package index and cannot ship an unpublished candidate`);
  // Refuses a checkout whose lock and catalogue already disagree.
  const lock = readLock(key, root);
  const cataloguePath = path.join(root, "recommended-config.json");
  const catalogue = JSON.parse(fs.readFileSync(cataloguePath, "utf8"));
  const wheelhouse = path.join(root, "backend-dist", "wheels");
  fs.mkdirSync(wheelhouse, { recursive: true });

  const candidates = [];
  for (const wheel of wheels) {
    const wheelPath = path.resolve(wheel);
    const filename = path.basename(wheelPath);
    const [, distribution, version] = /^([A-Za-z0-9_.]+)-(\d[A-Za-z0-9_.+!]*)-/.exec(filename) ?? [];
    assert.ok(version && wheelRank(filename, key) >= 0, `${filename} is not a wheel that the ${key} application can install`);
    const name = normalizeName(distribution);
    const spec = catalogue.required.find((required) => normalizeName(required.name) === name);
    assert.ok(spec, `${filename}: ${name} is not a required package of recommended-config.json`);
    assert.ok(!candidates.some((candidate) => candidate.name === name), `More than one candidate wheel for ${name}`);
    const sha256 = sha256File(wheelPath);
    fs.copyFileSync(wheelPath, path.join(wheelhouse, filename));
    spec.install = version;
    // The URL records where the candidate came from; the build never downloads it.
    Object.assign(lock.packages.find((entry) => entry.name === name), {
      version, filename, url: pathToFileURL(wheelPath).href, sha256,
    });
    candidates.push({ name, version, filename, sha256 });
  }
  lock.requirements.required = catalogue.required.map((spec) => `${spec.name}==${spec.install}`);
  writeJson(cataloguePath, catalogue);
  writeJson(lockPath(key, root), lock);
  // The build scripts read the lock through the same check.
  readLock(key, root);
  setAppVersion(root, appVersion, commit);
  return { appVersion, target: key, candidates };
}

if (require.main === module) {
  try {
    const branch = git(["symbolic-ref", "--quiet", "--short", "HEAD"]);
    if (branch.status !== 1) {
      throw new Error("Candidate preparation requires a detached disposable checkout");
    }
    const pinDiff = git(["status", "--porcelain", "--", ...PINNED_FILES]);
    assert.equal(pinDiff.status, 0, pinDiff.stderr);
    assert.equal(pinDiff.stdout, "", "Candidate checkout has modified release pins");
    const head = git(["rev-parse", "--short", "HEAD"]);
    assert.equal(head.status, 0, head.stderr);
    console.log(JSON.stringify(prepareCandidate({ ...parseArgs(process.argv.slice(2)), commit: head.stdout.trim() }), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = { prepareCandidate };
