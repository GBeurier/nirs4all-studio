/**
 * Hash-pinned Python distributions shipped by the installers.
 *
 * One lock per target lives in build/constraints/python-wheels-<target>.json.
 * It names, for the pinned CPython minor version on that target, the exact
 * file of every package Studio ships: the required cohort of
 * recommended-config.json (`required`, at its `install` versions) and, for
 * the targets that have an offline installer, the recommended packages
 * installed by default (`default_install`) with every dependency. The Linux
 * lock also carries the closure of the Docker image (`image_packages`: the
 * required cohort and the image extras). The build scripts only download the
 * locked files and verify their SHA-256; nothing is resolved at build time.
 *
 * Regenerate every lock after changing the catalogue (needs `uv` and network):
 *   node scripts/python-wheel-lock.cjs
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { uvExecutableName } = require("./fetch-uv.cjs");
const { PYTHON_VERSION } = require("./python-runtime-config.cjs");
const { downloadVerified, fetchText } = require("./verified-download.cjs");

const projectRoot = path.join(__dirname, "..");
const LOCK_SCHEMA = "nirs4all.studio.python-wheel-lock.v1";
// The locks are resolved for the Python that Studio installs.
const PYTHON = PYTHON_VERSION.split(".").slice(0, 2).join(".");
const PYTHON_MINOR = Number(PYTHON.split(".")[1]);
const UV_ENV = "NIRS4ALL_UV";

// Published as source only on every target (pure Python).
const SOURCE_ONLY_PACKAGES = Object.freeze(["pyopls"]);

/**
 * `uvPlatform` drives the resolution; `platformRank` accepts a wheel platform
 * tag for the same baseline (glibc 2.35, macOS 12) and ranks the best match.
 * `sourceBuilds` names the packages that publish no wheel for the target:
 * their locked source distribution is built into a wheel on that host when
 * the payload is built. `offlineInstaller` marks the targets whose offline
 * installer ships the whole closure. `remoteWheelhouse` is the asset-name
 * label of a target whose application ships no wheels and downloads the
 * required cohort from its release instead. `imageExtras` names the catalogue
 * packages that the Docker image adds to the required cohort, at their
 * recommended versions.
 */
const TARGETS = Object.freeze({
  "linux-x64": {
    uvPlatform: "x86_64-manylinux_2_35",
    platformRank(tag) {
      const manylinux = /^manylinux_2_(\d+)_x86_64$/.exec(tag);
      if (manylinux) return Number(manylinux[1]) <= 35 ? 100 + Number(manylinux[1]) : -1;
      const legacy = { manylinux2014_x86_64: 117, manylinux2010_x86_64: 112, manylinux1_x86_64: 105, linux_x86_64: 1 };
      return legacy[tag] ?? -1;
    },
    offlineInstaller: true,
    imageExtras: ["shap", "matplotlib", "lightgbm"],
  },
  "win32-x64": {
    uvPlatform: "x86_64-pc-windows-msvc",
    platformRank: (tag) => (tag === "win_amd64" ? 1 : -1),
    offlineInstaller: true,
  },
  "darwin-arm64": {
    uvPlatform: "aarch64-apple-darwin",
    platformRank(tag) {
      const match = /^macosx_(\d+)_(\d+)_(arm64|universal2)$/.exec(tag);
      if (!match) return -1;
      const [major, minor] = [Number(match[1]), Number(match[2])];
      if (major > MACOS_DEPLOYMENT_TARGET || (major === MACOS_DEPLOYMENT_TARGET && minor > 0)) return -1;
      return major * 100 + minor + (match[3] === "arm64" ? 0.5 : 0);
    },
    sourceBuilds: ["nirs4all-formats"],
    remoteWheelhouse: "mac-arm64",
  },
});
// Oldest supported macOS: resolution, wheel selection and source builds all use it.
const MACOS_DEPLOYMENT_TARGET = 12;
const MACOS_ENVIRONMENT = Object.freeze({ MACOSX_DEPLOYMENT_TARGET: `${MACOS_DEPLOYMENT_TARGET}.0` });

function normalizeName(name) {
  return name.replace(/[-_.]+/g, "-").toLowerCase();
}

function targetKey(platform, arch) {
  const key = `${platform}-${arch}`;
  if (!TARGETS[key]) throw new Error(`Unsupported target '${key}'. Supported: ${Object.keys(TARGETS).join(", ")}`);
  return key;
}

function sourcePackages(key) {
  return [...SOURCE_ONLY_PACKAGES, ...(TARGETS[key].sourceBuilds ?? [])];
}

/** Release asset that carries the required wheels of a target without embedded wheels. */
function remoteWheelhouseAssetName(key, version) {
  const label = TARGETS[key].remoteWheelhouse;
  if (!label) throw new Error(`The ${key} application ships its wheels; it has no remote wheelhouse`);
  return `nirs4all.Studio-${version}-${label}-wheels.tar.gz`;
}

function lockPath(key, root = projectRoot) {
  return path.join(root, "build", "constraints", `python-wheels-${key}.json`);
}

/**
 * Everything a lock is resolved from: the catalogue's exact versions and the
 * rules of its target. A lock is valid only while these are unchanged.
 */
function lockInputs(key, catalogue = require("../recommended-config.json")) {
  const target = TARGETS[key];
  const recommended = (name) => `${name}==${catalogue.optional[name].recommended}`;
  return {
    python: PYTHON,
    rules: {
      platform: target.uvPlatform,
      ...(key.startsWith("darwin-") ? { macos_deployment_target: MACOS_ENVIRONMENT.MACOSX_DEPLOYMENT_TARGET } : {}),
      source_builds: sourcePackages(key),
    },
    requirements: {
      required: catalogue.required.map((spec) => `${spec.name}==${spec.install}`),
      ...(target.offlineInstaller ? {
        recommended: Object.entries(catalogue.optional)
          .filter(([, spec]) => spec.default_install === true)
          .map(([name]) => recommended(name)),
      } : {}),
      ...(target.imageExtras ? { image_extras: target.imageExtras.map(recommended) } : {}),
    },
  };
}

/** Rank of a wheel for the pinned CPython on the target, or -1 when it cannot be installed there. */
function wheelRank(filename, key) {
  const parts = filename.replace(/\.whl$/, "").split("-");
  if (!filename.endsWith(".whl") || parts.length < 5) return -1;
  const [pythonTags, abiTags, platformTags] = parts.slice(-3).map((part) => part.split("."));
  const interpreter = pythonTags.some((python) => abiTags.some((abi) => {
    const minor = /^(?:cp|py)3(\d*)$/.exec(python)?.[1];
    if (minor === undefined || Number(minor) > PYTHON_MINOR) return false;
    if (python === `cp3${PYTHON_MINOR}` && abi === python) return true;
    return python.startsWith("cp") ? abi === "abi3" || (abi === "none" && Number(minor) === PYTHON_MINOR) : abi === "none";
  }));
  if (!interpreter) return -1;
  return Math.max(...platformTags.map((tag) => (tag === "any" ? 0 : TARGETS[key].platformRank(tag))));
}

/** Parse `uv pip compile --generate-hashes --emit-index-annotation` output. */
function parseCompiledRequirements(text) {
  const packages = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const requirement = /^([A-Za-z0-9_.-]+)==(\S+)/.exec(line);
    const hash = /^--hash=sha256:([0-9a-f]{64})/.exec(line);
    const index = /^# from (\S+)/.exec(line);
    if (requirement) packages.push({ name: normalizeName(requirement[1]), version: requirement[2], hashes: new Set(), index: null });
    else if (hash) packages.at(-1).hashes.add(hash[1]);
    else if (index) packages.at(-1).index = index[1];
  }
  return packages;
}

/** Files of one project on a PEP 503 index, with their SHA-256. */
async function indexFiles(index, name) {
  const pageUrl = `${index.replace(/\/$/, "")}/${name}/`;
  const html = await fetchText(pageUrl);
  return [...html.matchAll(/<a\s[^>]*href="([^"#]+)#sha256=([0-9a-f]{64})"/g)].map(([, href, sha256]) => {
    const url = new URL(href, pageUrl).toString();
    return { filename: decodeURIComponent(path.posix.basename(new URL(url).pathname)), url, sha256 };
  });
}

async function lockPackage(resolved, key) {
  const files = (await indexFiles(resolved.index, resolved.name)).filter((file) => resolved.hashes.has(file.sha256));
  const wheel = files
    .map((file) => ({ file, rank: wheelRank(file.filename, key) }))
    .filter((candidate) => candidate.rank >= 0)
    .sort((left, right) => right.rank - left.rank || left.file.filename.localeCompare(right.file.filename))[0]?.file;
  const sdist = sourcePackages(key).includes(resolved.name) ? files.find((file) => file.filename.endsWith(".tar.gz")) : undefined;
  const selected = wheel ?? sdist;
  if (!selected) throw new Error(`No installable file for ${resolved.name}==${resolved.version} on ${key}`);
  return { name: resolved.name, version: resolved.version, ...selected };
}

/**
 * Resolve `specs` for the target with uv and select one hash-pinned file per
 * package: the whole closure, or with `closure: false` the named packages only.
 */
async function resolveClosure(key, specs, { constraints = [], closure = true }, uv) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-wheel-lock-"));
  try {
    const input = path.join(workDir, "requirements.in");
    const pins = path.join(workDir, "constraints.txt");
    fs.writeFileSync(input, `${specs.join("\n")}\n`);
    fs.writeFileSync(pins, `${constraints.join("\n")}\n`);
    const result = spawnSync(uv, [
      "pip", "compile", input, "--constraint", pins, ...(closure ? [] : ["--no-deps"]),
      "--python-version", PYTHON, "--python-platform", TARGETS[key].uvPlatform,
      "--only-binary", ":all:", ...sourcePackages(key).flatMap((name) => ["--no-binary", name]),
      // CPU builds of torch keep the offline payload small.
      "--torch-backend", "cpu",
      "--generate-hashes", "--emit-index-annotation", "--no-annotate", "--no-header", "--quiet",
    ], {
      encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true,
      env: { ...process.env, ...MACOS_ENVIRONMENT },
    });
    if (result.error || result.status !== 0) {
      throw new Error(`uv could not resolve the ${key} closure: ${result.error?.message ?? result.stderr}`);
    }
    const packages = [];
    for (const resolved of parseCompiledRequirements(result.stdout)) packages.push(await lockPackage(resolved, key));
    return packages.sort((left, right) => left.name.localeCompare(right.name, "en"));
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

async function generateLock(key, uv = process.env[UV_ENV]?.trim() || "uv") {
  const inputs = lockInputs(key);
  const { required, recommended, image_extras: imageExtras } = inputs.requirements;
  // Without an offline installer only the required cohort itself is shipped.
  const packages = await resolveClosure(key, [...required, ...(recommended ?? [])], { closure: recommended !== undefined }, uv);
  const lock = { schema: LOCK_SCHEMA, target: key, ...inputs, packages };
  if (imageExtras) {
    // The image shares the versions of the offline closure wherever both need a package.
    const constraints = packages.map((entry) => `${entry.name}==${entry.version}`);
    lock.image_packages = await resolveClosure(key, [...required, ...imageExtras], { constraints }, uv);
  }
  return lock;
}

/** Read a lock and refuse one that no longer matches the catalogue, the pinned Python or its target's rules. */
function readLock(key, root = projectRoot) {
  const lock = JSON.parse(fs.readFileSync(lockPath(key, root), "utf8"));
  const expected = lockInputs(key, JSON.parse(fs.readFileSync(path.join(root, "recommended-config.json"), "utf8")));
  const actual = { python: lock.python, rules: lock.rules, requirements: lock.requirements };
  if (lock.schema !== LOCK_SCHEMA || lock.target !== key || JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${path.relative(root, lockPath(key, root))} does not match recommended-config.json, Python ${PYTHON} or the ${key} rules; run node scripts/python-wheel-lock.cjs`);
  }
  return lock;
}

/**
 * Locked files of one shipped set: `required` (the cohort every installer
 * ships), `offline` (the rest of the offline closure) or `image` (the rest of
 * the Docker image closure).
 */
function lockedPackages(lock, set) {
  const requiredNames = new Set(lock.requirements.required.map((spec) => normalizeName(spec.split("==")[0])));
  if (set === "required") return lock.packages.filter((entry) => requiredNames.has(entry.name));
  const closure = set === "image" ? lock.image_packages : lock.requirements.recommended && lock.packages;
  if (!closure) throw new Error(`The ${lock.target} lock has no ${set} closure`);
  return closure.filter((entry) => !requiredNames.has(entry.name));
}

/** Catalogue names of the recommended packages that the offline closure of a lock covers. */
function lockedRecommendedNames(lock) {
  return lock.requirements.recommended.map((spec) => spec.split("==")[0]);
}

/** uv for build steps: `NIRS4ALL_UV`, the binary staged for this host, else `uv` on PATH. */
function buildUv(key, backendRoot) {
  const staged = path.join(backendRoot, "tools", uvExecutableName(process.platform));
  const stagedForHost = key === `${process.platform}-${process.arch}` && fs.existsSync(staged);
  return process.env[UV_ENV]?.trim() || (stagedForHost ? staged : "uv");
}

/**
 * Build the wheel of a locked source distribution; native packages only build
 * on their target host. A uv-managed Python and the deployment target of the
 * locks keep the wheel's tags independent of the build machine.
 */
async function buildLockedWheel(entry, destination, key, uv) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-wheel-build-"));
  try {
    const sdist = await downloadVerified(entry.url, path.join(workDir, entry.filename), entry.sha256);
    const outDir = path.join(workDir, "dist");
    const result = spawnSync(uv, ["build", "--wheel", "--managed-python", "--python", PYTHON, "--out-dir", outDir, sdist], {
      stdio: "inherit", windowsHide: true, env: { ...process.env, ...MACOS_ENVIRONMENT },
    });
    const wheels = result.status === 0 ? fs.readdirSync(outDir).filter((name) => name.endsWith(".whl")) : [];
    if (wheels.length !== 1 || wheelRank(wheels[0], key) < 0) {
      throw new Error(`Building ${entry.filename} did not produce a wheel for ${key}${result.error ? `: ${result.error.message}` : ""}`);
    }
    fs.copyFileSync(path.join(outDir, wheels[0]), path.join(destination, wheels[0]));
    return wheels[0];
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

/**
 * Make `destination` contain exactly the wheels of `entries`: locked wheels are
 * downloaded and verified, locked source distributions are verified and built.
 */
async function stageLockedPackages(entries, destination, key, backendRoot) {
  const lockedWheels = new Set(entries.map((entry) => entry.filename).filter((name) => name.endsWith(".whl")));
  fs.mkdirSync(destination, { recursive: true });
  for (const name of fs.readdirSync(destination)) {
    if (!lockedWheels.has(name)) fs.rmSync(path.join(destination, name), { recursive: true, force: true });
  }
  const staged = [];
  for (const entry of entries) {
    if (lockedWheels.has(entry.filename)) {
      await downloadVerified(entry.url, path.join(destination, entry.filename), entry.sha256);
      staged.push(entry.filename);
    } else {
      staged.push(await buildLockedWheel(entry, destination, key, buildUv(key, backendRoot)));
    }
  }
  return staged;
}

if (require.main === module) {
  (async () => {
    for (const key of Object.keys(TARGETS)) {
      const lock = await generateLock(key);
      fs.writeFileSync(lockPath(key), `${JSON.stringify(lock, null, 2)}\n`);
      console.log(`${path.relative(projectRoot, lockPath(key))}: ${lock.packages.length} packages`);
    }
  })().catch((error) => {
    console.error(`Wheel lock generation failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  TARGETS,
  lockPath,
  lockedPackages,
  lockedRecommendedNames,
  parseCompiledRequirements,
  readLock,
  remoteWheelhouseAssetName,
  stageLockedPackages,
  targetKey,
  wheelRank,
};
