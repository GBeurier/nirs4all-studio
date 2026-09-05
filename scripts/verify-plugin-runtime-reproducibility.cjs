#!/usr/bin/env node
/** Rebuild the bounded CPython host twice and prove an identical closure. */

const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  PLUGIN_CONSTRAINTS_SHA256,
  findSitePackages,
  installedDistributionVersions,
} = require("./bake-python-plugin-runtime.cjs");
const { writePythonRuntimeClosure } = require("./native-runtime-contract.cjs");

const projectRoot = path.join(__dirname, "..");
const CLOSURE_FILE = "PYTHON_PLUGIN_CLOSURE.json";
const MARKER_FILE = "PLUGIN_RUNTIME_READY.json";

function sha256(payload) {
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    pluginWheel: "",
    toolsWheel: "",
    cacheDir: path.join(projectRoot, "build", ".python-cache"),
    evidence: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      const selected = argv[++index];
      if (!selected || selected.startsWith("--")) throw new Error(`${argument} requires a value`);
      return path.resolve(selected);
    };
    if (argument === "--plugin-wheel") options.pluginWheel = value();
    else if (argument === "--tools-wheel") options.toolsWheel = value();
    else if (argument === "--cache-dir") options.cacheDir = value();
    else if (argument === "--evidence") options.evidence = value();
    else throw new Error(`Unknown argument: ${argument}`);
  }
  for (const [label, filePath] of [
    ["plugin wheel", options.pluginWheel],
    ["tools wheel", options.toolsWheel],
  ]) {
    if (!filePath || !fs.existsSync(filePath) || !fs.lstatSync(filePath).isFile()) {
      throw new Error(`${label} must be an existing regular file`);
    }
  }
  return options;
}

function buildOnce(options, backendRoot) {
  const result = spawnSync(process.execPath, [
    path.join(__dirname, "bake-python-plugin-runtime.cjs"),
    "--backend-root", backendRoot,
    "--cache-dir", options.cacheDir,
    "--plugin-wheel", options.pluginWheel,
    "--tools-wheel", options.toolsWheel,
  ], { cwd: projectRoot, stdio: "inherit", windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`fresh plugin runtime bake failed with code ${result.status}`);
  }
  const runtimeDirectory = path.join(backendRoot, "python-runtime");
  const runtimeRoot = path.join(runtimeDirectory, "python");
  writePythonRuntimeClosure(backendRoot);
  const markerBytes = fs.readFileSync(path.join(runtimeDirectory, MARKER_FILE));
  const closureBytes = fs.readFileSync(path.join(runtimeDirectory, CLOSURE_FILE));
  const distributions = Object.fromEntries(
    installedDistributionVersions(findSitePackages(runtimeRoot)),
  );
  return {
    marker: JSON.parse(markerBytes),
    marker_sha256: sha256(markerBytes),
    closure_sha256: sha256(closureBytes),
    closure: JSON.parse(closureBytes),
    distributions,
  };
}

function differingClosurePaths(firstClosure, secondClosure) {
  const firstFiles = new Map(firstClosure.files.map((entry) => [entry.path, entry]));
  const secondFiles = new Map(secondClosure.files.map((entry) => [entry.path, entry]));
  const paths = new Set([...firstFiles.keys(), ...secondFiles.keys()]);
  return [...paths]
    .sort()
    .filter((filePath) => JSON.stringify(firstFiles.get(filePath)) !== JSON.stringify(secondFiles.get(filePath)));
}

function main() {
  const options = parseArgs();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-plugin-repro-"));
  try {
    const first = buildOnce(options, path.join(scratch, "first"));
    const second = buildOnce(options, path.join(scratch, "second"));
    for (const field of ["marker_sha256", "closure_sha256"]) {
      if (first[field] !== second[field]) {
        const detail = field === "closure_sha256"
          ? `: ${differingClosurePaths(first.closure, second.closure).slice(0, 20).join(", ")}`
          : "";
        throw new Error(`fresh plugin runtime ${field} differs across identical builds${detail}`);
      }
    }
    if (JSON.stringify(first.distributions) !== JSON.stringify(second.distributions)) {
      throw new Error("fresh plugin runtime distribution inventories differ");
    }
    const evidence = {
      schema: "nirs4all.studio-python-plugin-reproducibility.v1",
      platform: process.platform,
      arch: process.arch,
      constraints_sha256: PLUGIN_CONSTRAINTS_SHA256,
      marker_sha256: first.marker_sha256,
      closure_sha256: first.closure_sha256,
      distribution_count: Object.keys(first.distributions).length,
      distributions: first.distributions,
      identical_fresh_builds: true,
    };
    const payload = `${JSON.stringify(evidence, null, 2)}\n`;
    if (options.evidence) {
      fs.mkdirSync(path.dirname(options.evidence), { recursive: true });
      fs.writeFileSync(options.evidence, payload);
    }
    process.stdout.write(payload);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Plugin runtime reproducibility failed: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { buildOnce, differingClosurePaths, parseArgs, sha256 };
