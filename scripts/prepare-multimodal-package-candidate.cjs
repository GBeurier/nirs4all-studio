/** Patch a disposable Studio checkout for an exact, nonpublishing wheel candidate. */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const STABLE = Object.freeze({
  app: "0.14.1",
  nirs: "1.3.3",
  dag: "0.3.32",
  io: "0.2.2",
  source: "faba4a3f28a1bb1aab024b718056e0e0b93e8149",
  wheel: "e99ea71939527ec401a05784eb51f577bdfa1f2a5527c301840856dcbdd81aa3",
  manifest: "7af7022c83165fc7f5790da826f3d9f1e4c39bdc06c04cdcd0b48384a0d4f8b3",
  constraints: "6ee474ea179d107f3f2eca2190218132cef8b8c0e686bb0abdca5adcefa59b9f",
});

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
  // Some restricted hosts report EPERM after a child has exited. A numeric
  // status proves the command ran; a missing status remains a hard failure.
  assert.notEqual(result.status, null, `Unable to run git ${args[0]}: ${result.error?.message ?? "unknown error"}`);
  return result;
}

function replaceExactly(relativePath, previous, next, expectedCount) {
  const filename = path.join(root, relativePath);
  const source = fs.readFileSync(filename, "utf8");
  const count = source.split(previous).length - 1;
  assert.equal(count, expectedCount, `${relativePath}: expected ${expectedCount} occurrences of ${previous}`);
  fs.writeFileSync(filename, source.split(previous).join(next));
}

function replaceOnce(relativePath, previous, next) {
  replaceExactly(relativePath, previous, next, 1);
}

function parseArgs(argv) {
  const result = {};
  const allowed = new Set([
    "--nirs-wheel", "--nirs-source-commit", "--nirs-installed-manifest-sha256",
    "--dag-version", "--io-version", "--app-version",
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    assert.ok(allowed.has(key) && value && !value.startsWith("--"), `Invalid candidate argument: ${key}`);
    assert.equal(result[key], undefined, `Repeated candidate argument: ${key}`);
    result[key] = value;
  }
  for (const key of allowed) assert.ok(result[key], `Missing candidate argument: ${key}`);
  return result;
}

function prepareDetached(argv) {
  const args = parseArgs(argv);
  const pinnedFiles = [
    "build/constraints/plugin-runtime-cpython311.txt",
    "scripts/setup-python-env.cjs",
    "scripts/bake-python-plugin-runtime.cjs",
    "scripts/python-runtime-config.cjs",
    "electron/packaged-runtime-contract.ts",
    "sidecar/src/scientific_cpython.rs",
    "package.json",
    "package-lock.json",
    "version.json",
  ];
  const pinDiff = git(["diff", "--name-only", "--", ...pinnedFiles]);
  assert.equal(pinDiff.status, 0, pinDiff.stderr);
  assert.equal(pinDiff.stdout, "", "Candidate checkout has modified release pins");
  const wheelPath = path.resolve(args["--nirs-wheel"]);
  const nirsVersion = path.basename(wheelPath).match(/^nirs4all-([0-9][0-9A-Za-z.]*?)-py3-none-any\.whl$/)?.[1];
  assert.ok(nirsVersion && nirsVersion !== STABLE.nirs, "Expected a distinct pure-Python nirs4all candidate wheel");
  const sourceCommit = args["--nirs-source-commit"];
  const manifest = args["--nirs-installed-manifest-sha256"];
  assert.match(sourceCommit, /^[a-f0-9]{40}$/);
  assert.match(manifest, /^[a-f0-9]{64}$/);
  const dagVersion = args["--dag-version"];
  const ioVersion = args["--io-version"];
  const appVersion = args["--app-version"];
  for (const version of [dagVersion, ioVersion, appVersion]) {
    assert.match(version, /^\d+\.\d+\.\d+(?:[.-][a-z0-9.]+)?$/i);
  }
  assert.notEqual(appVersion, STABLE.app, "Migration candidate needs a distinct app version");
  const wheelSha256 = sha256(fs.readFileSync(wheelPath));

  const constraintsPath = "build/constraints/plugin-runtime-cpython311.txt";
  replaceOnce(constraintsPath, `dag-ml==${STABLE.dag}`, `dag-ml==${dagVersion}`);
  replaceOnce(constraintsPath, `nirs4all==${STABLE.nirs}`, `nirs4all==${nirsVersion}`);
  replaceOnce(constraintsPath, `nirs4all-io==${STABLE.io}`, `nirs4all-io==${ioVersion}`);
  const constraintsSha256 = sha256(fs.readFileSync(path.join(root, constraintsPath)));

  for (const file of [
    "scripts/setup-python-env.cjs",
    "scripts/bake-python-plugin-runtime.cjs",
    "electron/packaged-runtime-contract.ts",
  ]) {
    replaceOnce(file, STABLE.source, sourceCommit);
    replaceOnce(file, STABLE.wheel, wheelSha256);
  }
  replaceOnce("scripts/setup-python-env.cjs", `const PLUGIN_WHEEL_FILENAME = "nirs4all-${STABLE.nirs}-py3-none-any.whl"`, `const PLUGIN_WHEEL_FILENAME = "${path.basename(wheelPath)}"`);
  replaceOnce("scripts/setup-python-env.cjs", `selectedPluginWheel, "nirs4all", "${STABLE.nirs}"`, `selectedPluginWheel, "nirs4all", "${nirsVersion}"`);
  replaceOnce("scripts/bake-python-plugin-runtime.cjs", `const PLUGIN_DISTRIBUTION_VERSION = "${STABLE.nirs}"`, `const PLUGIN_DISTRIBUTION_VERSION = "${nirsVersion}"`);
  replaceOnce("scripts/bake-python-plugin-runtime.cjs", STABLE.manifest, manifest);
  replaceOnce("scripts/bake-python-plugin-runtime.cjs", STABLE.constraints, constraintsSha256);
  replaceOnce("electron/packaged-runtime-contract.ts", `marker.distribution_version !== "${STABLE.nirs}"`, `marker.distribution_version !== "${nirsVersion}"`);
  replaceOnce("electron/packaged-runtime-contract.ts", STABLE.manifest, manifest);
  replaceOnce("scripts/python-runtime-config.cjs", `const PLUGIN_DISTRIBUTION_VERSION = "${STABLE.nirs}"`, `const PLUGIN_DISTRIBUTION_VERSION = "${nirsVersion}"`);
  for (const [previous, next] of [
    [STABLE.source, sourceCommit],
    [STABLE.wheel, wheelSha256],
    [STABLE.manifest, manifest],
    [STABLE.nirs, nirsVersion],
  ]) {
    replaceExactly("sidecar/src/scientific_cpython.rs", previous, next, 2);
  }

  for (const relativePath of ["package.json", "package-lock.json", "version.json"]) {
    const filename = path.join(root, relativePath);
    const data = JSON.parse(fs.readFileSync(filename, "utf8"));
    assert.equal(data.version, STABLE.app, `${relativePath}: unexpected app version`);
    data.version = appVersion;
    if (relativePath === "package-lock.json") {
      assert.equal(data.packages?.[""]?.version, STABLE.app, "package-lock root version drift");
      data.packages[""].version = appVersion;
    }
    if (relativePath === "version.json") {
      data.build_date = new Date().toISOString();
      const head = git(["rev-parse", "--short", "HEAD"]);
      assert.equal(head.status, 0, head.stderr);
      data.commit = head.stdout.trim();
    }
    fs.writeFileSync(filename, `${JSON.stringify(data, null, 2)}\n`);
  }
  return { appVersion, nirsVersion, dagVersion, ioVersion, sourceCommit, wheelSha256, manifest, constraintsSha256 };
}

if (require.main === module) {
  try {
    const branch = git(["symbolic-ref", "--quiet", "--short", "HEAD"]);
    if (branch.status !== 1) {
      throw new Error("Candidate preparation requires a detached disposable checkout");
    }
    console.log(JSON.stringify(prepareDetached(process.argv.slice(2)), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = { prepareDetached };
