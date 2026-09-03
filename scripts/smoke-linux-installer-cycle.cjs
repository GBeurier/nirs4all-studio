#!/usr/bin/env node
/**
 * Bounded Linux AppImage lifecycle smoke for INST-001.
 *
 * Both candidate artifacts and their SHA-256 identities must be supplied. This
 * script never builds, downloads, installs system packages, or uses a shell.
 */

const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const { createServer } = require("node:net");
const os = require("node:os");
const path = require("node:path");

const DIGEST = /^[0-9a-f]{64}$/;
const DEFAULT_TIMEOUT_MS = 120000;
const HEALTH_PATH = "/sidecar/v1/health";

function printHelp() {
  console.log(`Usage:
  node scripts/smoke-linux-installer-cycle.cjs \\
    --install-artifact <candidate.AppImage> --install-sha256 <digest> \\
    --update-artifact <updated.AppImage> --update-sha256 <digest> \\
    --report <report.json> [--work-root <directory>] [--launch-arg <arg>]

The launch arguments are repeated verbatim. Typical AppImage runs under CI may
need: --launch-arg=--appimage-extract-and-run --launch-arg=--no-sandbox`);
}

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    installArtifact: "",
    installSha256: "",
    updateArtifact: "",
    updateSha256: "",
    report: "",
    workRoot: "",
    timeoutMs: DEFAULT_TIMEOUT_MS,
    launchArgs: [],
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    const [flag, inline] = raw.includes("=") ? raw.split(/=(.+)/, 2) : [raw, undefined];
    const value = () => inline ?? argv[++index];
    if (flag === "--install-artifact") parsed.installArtifact = path.resolve(value());
    else if (flag === "--install-sha256") parsed.installSha256 = value();
    else if (flag === "--update-artifact") parsed.updateArtifact = path.resolve(value());
    else if (flag === "--update-sha256") parsed.updateSha256 = value();
    else if (flag === "--report") parsed.report = path.resolve(value());
    else if (flag === "--work-root") parsed.workRoot = path.resolve(value());
    else if (flag === "--timeout-ms") parsed.timeoutMs = Number.parseInt(value(), 10);
    else if (flag === "--launch-arg") parsed.launchArgs.push(value());
    else if (flag === "--help") parsed.help = true;
    else throw new Error(`Unknown argument: ${raw}`);
  }
  return parsed;
}

function assertValidConfig(raw) {
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error("The prepared INST-001 slice applies only to Linux x64");
  }
  for (const [label, value] of [
    ["--install-artifact", raw.installArtifact],
    ["--update-artifact", raw.updateArtifact],
    ["--report", raw.report],
  ]) {
    if (!value) throw new Error(`${label} is required`);
  }
  if (!raw.installArtifact.endsWith(".AppImage") || !raw.updateArtifact.endsWith(".AppImage")) {
    throw new Error("Both supplied artifacts must use the .AppImage contract");
  }
  if (!DIGEST.test(raw.installSha256) || !DIGEST.test(raw.updateSha256)) {
    throw new Error("Both artifact SHA-256 values must be lowercase 64-character digests");
  }
  if (raw.installSha256 === raw.updateSha256) {
    throw new Error("The update artifact must have a distinct SHA-256 identity");
  }
  if (!Number.isInteger(raw.timeoutMs) || raw.timeoutMs < 1000 || raw.timeoutMs > 600000) {
    throw new Error("--timeout-ms must be an integer between 1000 and 600000");
  }
  if (raw.workRoot && !fs.statSync(raw.workRoot, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error("--work-root must be an existing directory");
  }
  return { ...raw };
}

function sha256File(filePath) {
  const hash = createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function verifyArtifact(filePath, expectedSha256, label) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch {
    throw new Error(`${label} artifact is missing: ${filePath}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} artifact must be a regular non-symlink file`);
  }
  const actual = sha256File(filePath);
  if (actual !== expectedSha256) {
    throw new Error(`${label} artifact SHA-256 mismatch: expected ${expectedSha256}, observed ${actual}`);
  }
  return { name: path.basename(filePath), sha256: actual, size_bytes: stat.size };
}

function installArtifact(source, destination, expectedSha256) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.next`;
  fs.rmSync(temporary, { force: true });
  fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(temporary, 0o755);
  const copied = sha256File(temporary);
  if (copied !== expectedSha256) {
    fs.rmSync(temporary, { force: true });
    throw new Error(`copied artifact SHA-256 mismatch: expected ${expectedSha256}, observed ${copied}`);
  }
  fs.renameSync(temporary, destination);
}

async function choosePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function sandboxEnvironment(sandboxRoot, port) {
  const home = path.join(sandboxRoot, "home");
  const temporary = path.join(sandboxRoot, "tmp");
  const config = path.join(home, ".config");
  const cache = path.join(home, ".cache");
  const data = path.join(home, ".local", "share");
  for (const directory of [home, temporary, config, cache, data]) fs.mkdirSync(directory, { recursive: true });
  const environment = {
    ...process.env,
    CI: "1",
    HOME: home,
    TMPDIR: temporary,
    XDG_CONFIG_HOME: config,
    XDG_CACHE_HOME: cache,
    XDG_DATA_HOME: data,
    NIRS4ALL_OFFLINE: "1",
    NIRS4ALL_NATIVE_SIDECAR_PORT: String(port),
  };
  delete environment.NIRS4ALL_BACKEND_PORT;
  delete environment.NIRS4ALL_ENABLE_PYTHON_HTTP_DIAGNOSTIC;
  return environment;
}

function launchApp(executable, launchArgs, sandboxRoot, port) {
  return spawn(executable, launchArgs, {
    cwd: path.dirname(executable),
    detached: true,
    env: sandboxEnvironment(sandboxRoot, port),
    stdio: "ignore",
  });
}

async function waitForReady(child, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const url = `http://127.0.0.1:${port}${HEALTH_PATH}`;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`application exited before readiness (code ${child.exitCode}, signal ${child.signalCode})`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      const payload = response.ok ? await response.json() : null;
      if (payload?.sidecar_ready === true && payload?.protocol_version === "studio-sidecar-r1") return payload;
    } catch {
      // Transient startup failure; bounded by the caller's deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${url}`);
}

async function waitForExit(child, timeoutMs = 5000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve(true);
    });
  });
}

async function stopProcessGroup(child, signalName) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, signalName);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  if (!(await waitForExit(child))) {
    process.kill(-child.pid, "SIGKILL");
    if (!(await waitForExit(child))) throw new Error("application process group did not exit");
  }
}

function passedStep(id, extra = {}) {
  return { id, status: "passed", ...extra };
}

async function runCycle(rawConfig) {
  const config = assertValidConfig(rawConfig);
  const report = {
    schema_version: "nirs4all.studio-inst001-linux-cycle.v1",
    scope: "isolated Linux x64 AppImage lifecycle only",
    status: "failed",
    evidence_state: "prepared_linux_harness",
    inst001_complete: false,
    release_eligible: false,
    holds: [
      "real_candidate_artifacts_required",
      "deb_package_manager_cycle_not_covered",
      "windows_and_macos_not_covered",
      "signing_and_publication_not_covered",
    ],
    artifacts: {},
    steps: [],
    failure: null,
  };
  let sandboxRoot = null;
  let child = null;
  let activeStep = "verify-artifacts";
  try {
    report.artifacts.install = verifyArtifact(config.installArtifact, config.installSha256, "install");
    report.artifacts.update = verifyArtifact(config.updateArtifact, config.updateSha256, "update");
    report.holds = report.holds.filter((hold) => hold !== "real_candidate_artifacts_required");
    report.steps.push(passedStep(activeStep));

    const workRoot = config.workRoot || os.tmpdir();
    sandboxRoot = fs.mkdtempSync(path.join(workRoot, "n4a-inst001-linux-"));
    const installRoot = path.join(sandboxRoot, "install");
    const installedApp = path.join(installRoot, "nirs4all-studio.AppImage");

    activeStep = "install";
    installArtifact(config.installArtifact, installedApp, config.installSha256);
    report.steps.push(passedStep(activeStep, { installed_sha256: sha256File(installedApp) }));

    activeStep = "launch";
    let port = await choosePort();
    child = launchApp(installedApp, config.launchArgs, sandboxRoot, port);
    await waitForReady(child, port, config.timeoutMs);
    report.steps.push(passedStep(activeStep));

    activeStep = "crash";
    await stopProcessGroup(child, "SIGKILL");
    child = null;
    report.steps.push(passedStep(activeStep));

    activeStep = "restart";
    port = await choosePort();
    child = launchApp(installedApp, config.launchArgs, sandboxRoot, port);
    await waitForReady(child, port, config.timeoutMs);
    report.steps.push(passedStep(activeStep));
    await stopProcessGroup(child, "SIGTERM");
    child = null;

    activeStep = "update";
    installArtifact(config.updateArtifact, installedApp, config.updateSha256);
    report.steps.push(passedStep(activeStep, { installed_sha256: sha256File(installedApp) }));

    activeStep = "launch-updated";
    port = await choosePort();
    child = launchApp(installedApp, config.launchArgs, sandboxRoot, port);
    await waitForReady(child, port, config.timeoutMs);
    report.steps.push(passedStep(activeStep));
    await stopProcessGroup(child, "SIGTERM");
    child = null;

    activeStep = "uninstall";
    fs.rmSync(installRoot, { recursive: true, force: false });
    if (fs.existsSync(installRoot)) throw new Error("isolated install root remains after uninstall");
    report.steps.push(passedStep(activeStep));
    report.status = "passed";
    report.evidence_state = "advanced_local_linux_appimage_cycle";
  } catch (error) {
    report.steps.push({ id: activeStep, status: "failed" });
    report.failure = error instanceof Error ? error.message : String(error);
  } finally {
    await stopProcessGroup(child, "SIGKILL");
    if (sandboxRoot) fs.rmSync(sandboxRoot, { recursive: true, force: true });
  }
  return report;
}

function writeReport(reportPath, report) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    printHelp();
    return 0;
  }
  const report = await runCycle(parsed);
  writeReport(parsed.report, report);
  if (report.status !== "passed") {
    console.error(`Linux installer cycle refused: ${report.failure}`);
    return 1;
  }
  console.log(`Linux installer cycle passed; receipt: ${parsed.report}`);
  return 0;
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(`Linux installer cycle refused: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  assertValidConfig,
  installArtifact,
  main,
  parseArgs,
  runCycle,
  sha256File,
  verifyArtifact,
  writeReport,
};
