/**
 * Hash-pinned Python distributions shipped by the installers.
 *
 * One lock per target lives in build/constraints/python-wheels-<target>.json.
 * It names, for CPython 3.11 on that target, the exact file of every package
 * in the offline closure: the required cohort of recommended-config.json
 * (`required`, at its `install` versions), the recommended packages installed
 * by default (`default_install`), and all their dependencies. The build
 * scripts only download the locked files and verify their SHA-256; nothing is
 * resolved at build time.
 *
 * Regenerate every lock after changing the catalogue (needs `uv` and network):
 *   node scripts/python-wheel-lock.cjs
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { uvExecutableName } = require("./fetch-uv.cjs");
const { downloadVerified, fetchText } = require("./verified-download.cjs");

const projectRoot = path.join(__dirname, "..");
const LOCK_SCHEMA = "nirs4all.studio.python-wheel-lock.v1";
const PYTHON_MINOR = 11;
const UV_ENV = "NIRS4ALL_UV";

// Published as source only on every target (pure Python).
const SOURCE_ONLY_PACKAGES = Object.freeze(["pyopls"]);

/**
 * `uvPlatform` drives the resolution; `platformRank` accepts a wheel platform
 * tag for the same baseline (glibc 2.35, macOS 12) and ranks the best match.
 * `sourceBuilds` names the packages that publish no wheel for the target:
 * their locked source distribution is built into a wheel on that host when
 * the payload is built.
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
  },
  "win32-x64": {
    uvPlatform: "x86_64-pc-windows-msvc",
    platformRank: (tag) => (tag === "win_amd64" ? 1 : -1),
  },
  "darwin-x64": {
    uvPlatform: "x86_64-apple-darwin",
    platformRank: (tag) => macosRank(tag, "x86_64"),
    sourceBuilds: ["nirs4all-core", "nirs4all-io", "nirs4all-formats"],
    // PyTorch publishes no Intel macOS wheel for the catalogue version.
    unavailable: ["torch"],
  },
  "darwin-arm64": {
    uvPlatform: "aarch64-apple-darwin",
    platformRank: (tag) => macosRank(tag, "arm64"),
    sourceBuilds: ["nirs4all-formats"],
  },
});
const MACOS_DEPLOYMENT_TARGET = "12.0";

function macosRank(tag, machine) {
  const match = /^macosx_(\d+)_(\d+)_(.+)$/.exec(tag);
  if (!match || ![machine, "universal2"].includes(match[3])) return -1;
  const [major, minor] = [Number(match[1]), Number(match[2])];
  if (major > 12 || (major === 12 && minor > 0)) return -1;
  return major * 100 + minor + (match[3] === machine ? 0.5 : 0);
}

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

function lockPath(key, root = projectRoot) {
  return path.join(root, "build", "constraints", `python-wheels-${key}.json`);
}

/** Requirements of a target, derived from recommended-config.json alone. */
function catalogueRequirements(key, catalogue = require("../recommended-config.json")) {
  const unavailable = new Set(TARGETS[key].unavailable ?? []);
  return {
    required: catalogue.required.map((spec) => `${spec.name}==${spec.install}`),
    recommended: Object.entries(catalogue.optional)
      .filter(([name, spec]) => spec.default_install === true && !unavailable.has(name))
      .map(([name, spec]) => `${name}==${spec.recommended}`),
  };
}

/** Rank of a wheel for CPython 3.11 on the target, or -1 when it cannot be installed there. */
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

async function generateLock(key, uv = process.env[UV_ENV]?.trim() || "uv") {
  const requirements = catalogueRequirements(key);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-wheel-lock-"));
  try {
    const input = path.join(workDir, "requirements.in");
    fs.writeFileSync(input, `${[...requirements.required, ...requirements.recommended].join("\n")}\n`);
    const result = spawnSync(uv, [
      "pip", "compile", input,
      "--python-version", `3.${PYTHON_MINOR}`, "--python-platform", TARGETS[key].uvPlatform,
      "--only-binary", ":all:", ...sourcePackages(key).flatMap((name) => ["--no-binary", name]),
      // CPU builds of torch keep the offline payload small.
      "--torch-backend", "cpu",
      "--generate-hashes", "--emit-index-annotation", "--no-annotate", "--no-header", "--quiet",
    ], {
      encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true,
      env: { ...process.env, MACOSX_DEPLOYMENT_TARGET: MACOS_DEPLOYMENT_TARGET },
    });
    if (result.error || result.status !== 0) {
      throw new Error(`uv could not resolve the ${key} closure: ${result.error?.message ?? result.stderr}`);
    }
    const packages = [];
    for (const resolved of parseCompiledRequirements(result.stdout)) packages.push(await lockPackage(resolved, key));
    packages.sort((left, right) => left.name.localeCompare(right.name, "en"));
    return { schema: LOCK_SCHEMA, target: key, python: `3.${PYTHON_MINOR}`, requirements, packages };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

/** Read a lock and refuse one that no longer matches the catalogue. */
function readLock(key, root = projectRoot) {
  const lock = JSON.parse(fs.readFileSync(lockPath(key, root), "utf8"));
  const expected = catalogueRequirements(key, JSON.parse(fs.readFileSync(path.join(root, "recommended-config.json"), "utf8")));
  if (lock.schema !== LOCK_SCHEMA || lock.target !== key || JSON.stringify(lock.requirements) !== JSON.stringify(expected)) {
    throw new Error(`${path.relative(root, lockPath(key, root))} does not match recommended-config.json; run node scripts/python-wheel-lock.cjs`);
  }
  return lock;
}

/** Locked files of the required cohort (`required: true`) or of the rest of the offline closure. */
function lockedPackages(lock, { required }) {
  const requiredNames = new Set(lock.requirements.required.map((spec) => normalizeName(spec.split("==")[0])));
  return lock.packages.filter((entry) => requiredNames.has(entry.name) === required);
}

/** uv for build steps: `NIRS4ALL_UV`, the binary staged for this host, else `uv` on PATH. */
function buildUv(key, backendRoot) {
  const staged = path.join(backendRoot, "tools", uvExecutableName(process.platform));
  const stagedForHost = key === `${process.platform}-${process.arch}` && fs.existsSync(staged);
  return process.env[UV_ENV]?.trim() || (stagedForHost ? staged : "uv");
}

/** Build the wheel of a locked source distribution; native packages only build on their target host. */
async function buildLockedWheel(entry, destination, key, uv) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-wheel-build-"));
  try {
    const sdist = await downloadVerified(entry.url, path.join(workDir, entry.filename), entry.sha256);
    const outDir = path.join(workDir, "dist");
    const result = spawnSync(uv, ["build", "--wheel", "--python", `3.${PYTHON_MINOR}`, "--out-dir", outDir, sdist], {
      stdio: "inherit", windowsHide: true,
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
  parseCompiledRequirements,
  readLock,
  stageLockedPackages,
  targetKey,
  wheelRank,
};
