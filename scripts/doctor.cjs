#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const failures = [];
const warnings = [];
const notes = [];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), "utf8"));
}

function parseVersion(raw) {
  const match = String(raw || "").match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    raw: match[0],
  };
}

function versionAtLeast(version, major, minor = 0, patch = 0) {
  if (!version) return false;
  if (version.major !== major) return version.major > major;
  if (version.minor !== minor) return version.minor > minor;
  return version.patch >= patch;
}

function run(command, args) {
  return spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    shell: false,
  });
}

function commandPath(command) {
  const resolver = process.platform === "win32" ? "where" : "which";
  const result = run(resolver, [command]);
  if (result.status !== 0) return null;
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null;
}

function isWsl() {
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true;
  try {
    return /microsoft|wsl/i.test(fs.readFileSync("/proc/version", "utf8"));
  } catch {
    return false;
  }
}

function isWslWorkspace() {
  const normalizedRoot = projectRoot.replace(/\\/g, "/").toLowerCase();
  return normalizedRoot.startsWith("//wsl.localhost/") || normalizedRoot.startsWith("//wsl$/");
}

function looksLikeWindowsNodePath(value) {
  const normalized = String(value || "").replace(/\\/g, "/").toLowerCase();
  return normalized.includes("/mnt/c/program files/nodejs") || normalized.includes("program files/nodejs");
}

function checkNode(packageJson) {
  const nodeVersion = parseVersion(process.versions.node);
  if (!versionAtLeast(nodeVersion, 20)) {
    failures.push(`Node ${nodeVersion?.raw || process.version} detected; package.json requires >=20.`);
  }

  const nvmrcPath = path.join(projectRoot, ".nvmrc");
  if (fs.existsSync(nvmrcPath)) {
    const expectedMajor = Number(fs.readFileSync(nvmrcPath, "utf8").trim().replace(/^v/, "").split(".")[0]);
    if (Number.isFinite(expectedMajor) && nodeVersion && nodeVersion.major !== expectedMajor) {
      warnings.push(`.nvmrc recommends Node ${expectedMajor}; current Node is ${nodeVersion.raw}.`);
    }
  }

  if ((isWsl() || isWslWorkspace()) && looksLikeWindowsNodePath(process.execPath)) {
    failures.push(`Windows Node is running inside WSL (${process.execPath}). Run nvm install && nvm use inside WSL.`);
  }

  notes.push(`Node: ${process.version} (${process.execPath})`);
  notes.push(`Required engines: node ${packageJson.engines?.node || "unspecified"}, npm ${packageJson.engines?.npm || "unspecified"}`);
}

function checkNpm() {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const npmPath = commandPath(npmCommand) || commandPath("npm") || process.env.npm_execpath || null;
  const npmVersionResult = run(npmCommand, ["--version"]);
  const userAgentVersion = parseVersion(process.env.npm_config_user_agent);

  if (npmVersionResult.status !== 0 && !userAgentVersion) {
    failures.push("npm is not available on PATH.");
    return;
  }

  const npmVersion = npmVersionResult.status === 0
    ? parseVersion(npmVersionResult.stdout.trim())
    : userAgentVersion;
  if (!versionAtLeast(npmVersion, 10)) {
    failures.push(`npm ${npmVersion?.raw || npmVersionResult.stdout.trim() || "unknown"} detected; package.json requires >=10.`);
  }

  if ((isWsl() || isWslWorkspace()) && looksLikeWindowsNodePath(npmPath)) {
    failures.push(`Windows npm is first on PATH inside WSL (${npmPath}). Use Linux npm from nvm.`);
  }

  notes.push(`npm: ${npmVersion?.raw || npmVersionResult.stdout.trim()}${npmPath ? ` (${npmPath})` : ""}`);
}

function pythonCandidates() {
  const candidates = [];
  if (process.env.PYTHON) candidates.push(process.env.PYTHON);
  candidates.push(
    path.join(projectRoot, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python"),
    "python3",
    "python",
  );
  if (process.platform === "win32") candidates.push("py");
  return [...new Set(candidates)];
}

function checkPython() {
  let best = null;
  for (const candidate of pythonCandidates()) {
    const args = candidate === "py" ? ["-3.11", "--version"] : ["--version"];
    const result = run(candidate, args);
    if (result.status !== 0) continue;
    const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
    const version = parseVersion(output);
    best = { candidate, output, version };
    if (versionAtLeast(version, 3, 11)) break;
  }

  if (!best) {
    failures.push("Python is not available. Create .venv and install requirements-cpu.txt or requirements-gpu.txt.");
    return;
  }

  if (!versionAtLeast(best.version, 3, 11)) {
    failures.push(`${best.output} detected via ${best.candidate}; backend targets Python >=3.11.`);
  }

  if (!fs.existsSync(path.join(projectRoot, ".venv"))) {
    warnings.push(".venv is missing. Create one before backend development.");
  }

  notes.push(`Python: ${best.output} (${best.candidate})`);
}

function checkPackageMetadata(packageJson) {
  const lockPath = path.join(projectRoot, "package-lock.json");
  if (!fs.existsSync(lockPath)) {
    failures.push("package-lock.json is missing.");
    return;
  }

  const packageLock = readJson("package-lock.json");
  if (packageLock.version !== packageJson.version) {
    failures.push(`package-lock.json version ${packageLock.version} does not match package.json ${packageJson.version}.`);
  }

  const rootPackage = packageLock.packages?.[""];
  if (rootPackage?.version !== packageJson.version) {
    failures.push(`package-lock root package version ${rootPackage?.version} does not match package.json ${packageJson.version}.`);
  }

  if (rootPackage?.license !== packageJson.license) {
    warnings.push(`package-lock root license '${rootPackage?.license}' does not match package.json '${packageJson.license}'.`);
  }
}

function checkRequirements() {
  for (const file of ["requirements.txt", "requirements-cpu.txt"]) {
    if (!fs.existsSync(path.join(projectRoot, file))) {
      failures.push(`${file} is missing.`);
    }
  }
}

function printList(title, items) {
  if (!items.length) return;
  console.log(`\n${title}`);
  for (const item of items) console.log(`- ${item}`);
}

function main() {
  const packageJson = readJson("package.json");
  checkNode(packageJson);
  checkNpm();
  checkPython();
  checkPackageMetadata(packageJson);
  checkRequirements();

  console.log("nirs4all-studio environment doctor");
  printList("Detected", notes);
  printList("Warnings", warnings);
  printList("Failures", failures);

  if (failures.length) {
    console.log("\nFix the failures above before running the full dev/test stack.");
    process.exit(1);
  }

  console.log("\nEnvironment checks passed.");
}

main();
