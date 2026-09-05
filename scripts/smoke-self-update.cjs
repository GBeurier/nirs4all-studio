/**
 * End-to-end self-update smoke for a packaged, already-extracted all-in-one bundle.
 *
 * Drives the REAL desktop self-update against a local fixture "GitHub" release
 * server and verifies the app comes back after applying:
 *   1. launch the packaged Electron app on a forced port, pointed at the fixture
 *      via NIRS4ALL_UPDATE_API_BASE (no internet needed — is_online() is not a
 *      network probe, it only honours NIRS4ALL_OFFLINE, which we do NOT set)
 *   2. wait for /api/health
 *   3. poll /webapp/download-info -> /webapp/download-start -> poll -> /webapp/apply
 *   4. quit the app so the updater script replaces files and relaunches
 *   5. verify a sentinel planted in the update asset now exists on disk (the
 *      replace happened) AND /api/health is back up on the same port (the
 *      relaunched app boots). On macOS the asset is a ditto zip of the .app, so
 *      this also exercises symlink-preserving extraction on a real bundle.
 *
 * CI-only: needs a built+extracted bundle and (on Linux) a display via xvfb.
 *
 * Usage:
 *   node scripts/smoke-self-update.cjs --extracted-root <path> [--platform <id>] [options]
 */

const { spawn, execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { createServer } = require("net");

const archiveSmoke = require("./smoke-archive-standalone.cjs");

const DEFAULT_APP_NAME = "nirs4all Studio";
const DEFAULT_TIMEOUT_MS = 240000;
const SENTINEL_NAME = "UPDATE_SMOKE_SENTINEL";
// A file that exists ONLY in the installed bundle and NOT in the update asset.
// An atomic-replace updater must delete it; a merge-overlay updater leaves it,
// producing a mixed-version install. This is the validator for the atomic-replace
// fix (audit #4) — it may legitimately fail until that fix lands.
const STALE_NAME = "UPDATE_SMOKE_STALE";
// Far above any real version so the fixture release always reads as "newer".
const FIXTURE_VERSION = "999.0.0";
const childOutput = new WeakMap();

function printHelp() {
  console.log(`Usage:
  node scripts/smoke-self-update.cjs --extracted-root <path> [options]

Options:
  --extracted-root <path>  Root directory created after unpacking the archive
  --platform <id>          win32 | linux | darwin (default: current platform)
  --app-name <name>        Expected packaged app name (default: ${DEFAULT_APP_NAME})
  --port <n>               Backend port to force (default: an ephemeral free port)
  --timeout-ms <n>         Per-phase timeout (default: ${DEFAULT_TIMEOUT_MS})
  --keep-sandbox           Keep the generated sandbox + work dirs for inspection
  --help                   Show this message`);
}

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    extractedRoot: "",
    platform: process.platform,
    appName: DEFAULT_APP_NAME,
    port: 0,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    keepSandbox: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const [flag, inlineValue] = arg.includes("=") ? arg.split(/=(.+)/, 2) : [arg, undefined];

    if (flag === "--help") {
      parsed.help = true;
    } else if (flag === "--extracted-root") {
      parsed.extractedRoot = path.resolve(inlineValue ?? argv[++i]);
    } else if (flag === "--platform") {
      parsed.platform = inlineValue ?? argv[++i];
    } else if (flag === "--app-name") {
      parsed.appName = inlineValue ?? argv[++i];
    } else if (flag === "--port") {
      parsed.port = Number.parseInt(inlineValue ?? argv[++i], 10);
    } else if (flag === "--timeout-ms") {
      parsed.timeoutMs = Number.parseInt(inlineValue ?? argv[++i], 10);
    } else if (flag === "--keep-sandbox") {
      parsed.keepSandbox = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function assertValidConfig(rawConfig) {
  const config = {
    ...rawConfig,
    extractedRoot: rawConfig.extractedRoot ? path.resolve(rawConfig.extractedRoot) : "",
  };
  if (!config.extractedRoot) {
    throw new Error("--extracted-root is required");
  }
  if (!fs.existsSync(config.extractedRoot)) {
    throw new Error(`Extracted root not found: ${config.extractedRoot}`);
  }
  if (!["win32", "linux", "darwin"].includes(config.platform)) {
    throw new Error(`Unsupported platform: ${config.platform}`);
  }
  if (config.port && (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535)) {
    throw new Error(`Invalid --port value: ${config.port}`);
  }
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1000) {
    throw new Error(`Invalid --timeout-ms value: ${config.timeoutMs}`);
  }
  return config;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sampleFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
    server.on("error", reject);
  });
}

async function choosePort(preferredPort, exclude = []) {
  if (preferredPort) {
    return preferredPort;
  }
  // Free-port samples are released immediately, so the OS can hand the same
  // port out twice — retry until we get one not already in use by the smoke.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = await sampleFreePort();
    if (!exclude.includes(port)) {
      return port;
    }
  }
  throw new Error(`could not find a free port distinct from ${exclude.join(", ")}`);
}

function assetNameForPlatform(platformId, version) {
  const osKeyword = platformId === "darwin" ? "mac" : platformId === "win32" ? "win" : "linux";
  const ext = platformId === "linux" ? "tar.gz" : "zip";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return `nirs4all.Studio-${version}-all-in-one-${osKeyword}-${arch}.${ext}`;
}

function buildReleaseJson(base, assetName, assetSize) {
  const encoded = encodeURIComponent(assetName);
  return {
    tag_name: FIXTURE_VERSION,
    html_url: `${base}/releases/tag/${FIXTURE_VERSION}`,
    body: "self-update smoke fixture release",
    published_at: "2026-01-01T00:00:00Z",
    prerelease: false,
    assets: [
      { name: assetName, browser_download_url: `${base}/${encoded}`, size: assetSize },
      { name: `${assetName}.sha256`, browser_download_url: `${base}/${encoded}.sha256`, size: 80 },
    ],
  };
}

function sentinelInstalledPath(layout, platformId) {
  return platformId === "darwin"
    ? path.join(layout.appRoot, "Contents", "Resources", SENTINEL_NAME)
    : path.join(layout.appRoot, "resources", SENTINEL_NAME);
}

/** Path of the stale-file marker inside the installed bundle (mirrors the sentinel layout). */
function staleInstalledPath(layout, platformId) {
  return platformId === "darwin"
    ? path.join(layout.appRoot, "Contents", "Resources", STALE_NAME)
    : path.join(layout.appRoot, "resources", STALE_NAME);
}

/**
 * Build the "N+1" update asset from the installed bundle, with a sentinel file
 * the smoke can look for after the update is applied.
 *
 * The asset is a COMPLETE copy of the installed app tree (plus the sentinel) on
 * every platform, because both apply modes are wholesale replacements: macOS
 * bundle mode (`rm -rf APP_DIR; cp -a STAGING APP_PARENT`) and the Linux/Windows
 * directory mode (atomic empty-then-copy, audit #4). A minimal overlay asset
 * would leave the relaunched app missing its runtime/backend after the swap.
 * macOS is ditto-zipped to preserve framework symlinks; Linux is tar.gz; Windows
 * is a .zip. The stale marker is planted in the install AFTER this runs, so it is
 * never part of the asset.
 */
function buildUpdateAsset(layout, platformId, appName, workDir) {
  const assetName = assetNameForPlatform(platformId, FIXTURE_VERSION);
  const assetPath = path.join(workDir, assetName);

  if (platformId === "darwin") {
    const stageApp = path.join(workDir, `${appName}.app`);
    execFileSync("cp", ["-a", layout.appRoot, stageApp]);
    fs.writeFileSync(path.join(stageApp, "Contents", "Resources", SENTINEL_NAME), "self-update smoke\n");
    execFileSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", stageApp, assetPath]);
  } else {
    // Linux/Windows directory mode replaces the whole app dir atomically, so the
    // asset must be a FULL copy of the installed tree + the sentinel — anything
    // less leaves the post-update bundle unbootable.
    const topName = path.basename(layout.appRoot);
    const stageDir = path.join(workDir, "stage");
    const stageTop = path.join(stageDir, topName);
    fs.mkdirSync(stageDir, { recursive: true });
    if (platformId === "win32") {
      // Node's recursive copy is cross-platform and keeps symlinks verbatim.
      fs.cpSync(layout.appRoot, stageTop, { recursive: true, verbatimSymlinks: true });
    } else {
      // cp -a preserves perms, timestamps, and symlinks (bundled runtime).
      execFileSync("cp", ["-a", layout.appRoot, stageTop]);
    }
    fs.mkdirSync(path.join(stageTop, "resources"), { recursive: true });
    fs.writeFileSync(path.join(stageTop, "resources", SENTINEL_NAME), "self-update smoke\n");
    if (platformId === "win32") {
      // Windows all-in-one is a .zip; Compress-Archive the top folder so the
      // staged layout matches the tar case (one top dir).
      execFileSync("powershell", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Compress-Archive -Path '${stageTop}' -DestinationPath '${assetPath}' -Force`,
      ]);
    } else {
      execFileSync("tar", ["-czf", assetPath, "-C", stageDir, topName]);
    }
  }

  const bytes = fs.readFileSync(assetPath);
  const assetSha = crypto.createHash("sha256").update(bytes).digest("hex");
  return { assetName, assetPath, assetSize: bytes.length, assetSha };
}

function startFixtureServer({ assetPath, assetName, assetSha }) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent((req.url || "").split("?")[0]);
      const base = `http://127.0.0.1:${server.address().port}`;

      if (url.endsWith("/releases/latest")) {
        const size = fs.statSync(assetPath).size;
        const body = Buffer.from(JSON.stringify(buildReleaseJson(base, assetName, size)));
        res.writeHead(200, { "Content-Type": "application/json", "Content-Length": body.length });
        res.end(body);
        return;
      }
      if (url.endsWith(".sha256")) {
        const releaseBasename = assetName.replace(/^nirs4all\.Studio-/, "nirs4all Studio-");
        const body = Buffer.from(
          `${assetSha}  /home/runner/work/nirs4all-studio/nirs4all-studio/release/${releaseBasename}\n`,
        );
        res.writeHead(200, { "Content-Type": "text/plain", "Content-Length": body.length });
        res.end(body);
        return;
      }
      if (url.endsWith(`/${assetName}`)) {
        const size = fs.statSync(assetPath).size;
        res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": size });
        fs.createReadStream(assetPath).pipe(res);
        return;
      }
      res.writeHead(404);
      res.end();
    });

    server.listen(0, "127.0.0.1", () => {
      resolve({
        base: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

function sessionHeaders(sessionToken) {
  return sessionToken ? { "X-Nirs4all-Session": sessionToken } : {};
}

async function getJson(url, sessionToken) {
  const res = await fetch(url, {
    headers: sessionHeaders(sessionToken),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`GET ${url} -> ${res.status}`);
  }
  return res.json();
}

async function postJson(url, body, sessionToken) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...sessionHeaders(sessionToken),
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = JSON.stringify(await res.json());
    } catch {
      // ignore non-JSON error bodies
    }
    throw new Error(`POST ${url} -> ${res.status} ${detail}`);
  }
  return res.json();
}

/** Drive the backend through download discovery -> download -> apply over HTTP. */
async function driveUpdate(baseUrl, timeoutMs, backendOutput = () => "", sessionToken) {
  // The packaged app starts its own update check. Poll its read-only state
  // directly instead of repeatedly starting competing checks. Preserve the
  // last payload/error and backend output so CI failures remain actionable.
  const checkDeadline = Date.now() + Math.min(timeoutMs, 120000);
  let info = null;
  let lastError = null;
  for (;;) {
    try {
      info = await getJson(`${baseUrl}/api/updates/webapp/download-info`, sessionToken);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (info?.update_available) {
      break;
    }
    if (Date.now() > checkDeadline) {
      const output = backendOutput();
      throw new Error(
        `fixture release was not seen as an available update after retries; last download-info=${JSON.stringify(info)}; `
        + `last error=${lastError || "none"}\nbackend stdout:\n${output || "(empty)"}`,
      );
    }
    await delay(1000);
  }
  if (info.can_apply_in_place === false) {
    throw new Error(`backend refused in-place update (channel=${info.update_channel})`);
  }

  const start = await postJson(`${baseUrl}/api/updates/webapp/download-start`, undefined, sessionToken);
  const jobId = start.job_id;
  if (!jobId) {
    throw new Error("download-start returned no job id");
  }

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await getJson(`${baseUrl}/api/updates/webapp/download-status/${jobId}`, sessionToken);
    if (status.status === "completed") {
      break;
    }
    if (status.status === "failed") {
      throw new Error(`download job failed: ${status.error || "unknown"}`);
    }
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for the update download to complete");
    }
    await delay(500);
  }

  const applied = await postJson(`${baseUrl}/api/updates/webapp/apply`, { confirm: true }, sessionToken);
  if (!applied.restart_required) {
    throw new Error("apply did not request a restart");
  }
}

async function waitForChildExit(child, timeoutMs = 8000) {
  if (!child || child.exitCode !== null) {
    return true;
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

/** Quit the running app so the (already launched) updater can replace + relaunch. */
async function quitApp(child) {
  if (!child || child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  if (!(await waitForChildExit(child))) {
    child.kill("SIGKILL");
    await waitForChildExit(child, 4000);
  }
}

async function isHealthy(port, sessionToken) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: sessionHeaders(sessionToken),
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) {
      return false;
    }
    const payload = await res.json();
    return Boolean(payload.core_ready || payload.ready);
  } catch {
    return false;
  }
}

/** Prove that the detached native updater itself relaunched a complete app. */
async function waitForUpdaterRelaunch(port, sessionToken, timeoutMs) {
  await archiveSmoke.waitForNativeScientificReady(
    port,
    timeoutMs,
    { exitCode: null },
    [],
    sessionToken,
  );
}

async function getRelaunchPid(port, sessionToken, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const result = await getJson(
        `http://127.0.0.1:${port}/api/updates/webapp/last-apply-result`,
        sessionToken,
      );
      if (Number.isInteger(result.relaunch_pid) && result.relaunch_pid > 0) {
        return result.relaunch_pid;
      }
    } catch {
      // The helper/new process may still be reconciling its apply result.
    }
    await delay(250);
  }
  throw new Error("native updater did not publish its relaunch PID");
}

async function terminateRelaunch(pid, port, sessionToken, timeoutMs) {
  const pidAlive = () => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      if (error?.code === "ESRCH") return false;
      throw error;
    }
  };
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
  const deadline = Date.now() + Math.min(timeoutMs, 15000);
  while (Date.now() < deadline) {
    if (!pidAlive() && !(await isHealthy(port, sessionToken))) return;
    await delay(250);
  }
  if (process.platform === "win32") {
    try {
      execFileSync(
        "taskkill.exe",
        ["/PID", String(pid), "/T", "/F"],
        { stdio: "ignore" },
      );
    } catch {
      // The process may have exited between the liveness check and taskkill.
    }
  } else {
    try {
      process.kill(pid, "SIGKILL");
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }
  const forcedDeadline = Date.now() + 5000;
  while (Date.now() < forcedDeadline && (pidAlive() || (await isHealthy(port, sessionToken)))) {
    await delay(100);
  }
  if (pidAlive() || (await isHealthy(port, sessionToken))) {
    throw new Error(`helper-relaunched app (PID ${pid}) remained healthy after termination`);
  }
}

/** Wait until the updater has replaced files in place (its sentinel appears). */
async function waitForSentinel(sentinelPath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(sentinelPath)) {
      return;
    }
    await delay(1000);
  }
  throw new Error(`updater did not replace files in place (no sentinel at ${sentinelPath})`);
}

/** Wait until the updated executable is fully written (exists + size stable
 *  across two checks). The staged asset is a FULL app tree, so the updater's
 *  `cp -a STAGING/. APP_DIR/` can still be copying when the sentinel (a file
 *  under resources/) appears — spawning the exe before its copy finishes would
 *  ENOENT under CI load. The subsequent health poll absorbs the rest of the copy. */
async function waitForStableExecutable(exePath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastSize = -1;
  while (Date.now() < deadline) {
    if (fs.existsSync(exePath)) {
      const size = fs.statSync(exePath).size;
      if (size > 0 && size === lastSize) {
        return;
      }
      lastSize = size;
    }
    await delay(1000);
  }
  throw new Error(`updated executable not present/stable after timeout: ${exePath}`);
}

/** Spawn the packaged app and wait until /api/health reports ready. */
async function launchHealthy(layout, env, port, timeoutMs, label) {
  const child = spawn(layout.executablePath, [], {
    cwd: layout.appRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const out = [];
  const capture = (chunk) => {
    const text = chunk.toString().trim();
    if (text) out.push(text);
    while (out.length > 60) out.shift();
  };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);
  childOutput.set(child, out);

  const deadline = Date.now() + timeoutMs;
  const sessionToken = env.NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN;
  if (!sessionToken) {
    throw new Error("archive smoke session token is missing");
  }
  while (!(await isHealthy(port, sessionToken))) {
    if (child.exitCode !== null) {
      throw new Error(`${label}: app exited before /api/health (code ${child.exitCode}).\n${out.join("\n")}`);
    }
    if (Date.now() > deadline) {
      await quitApp(child);
      throw new Error(`${label}: timed out waiting for /api/health.\n${out.join("\n")}`);
    }
    await delay(1000);
  }
  console.log(`${label}: healthy on port ${port}`);
  return child;
}

async function smokeSelfUpdate(rawConfig) {
  const config = assertValidConfig(rawConfig);
  const layout = archiveSmoke.resolveLaunchLayout(config.extractedRoot, config.platform, config.appName);

  if (!fs.existsSync(layout.executablePath)) {
    throw new Error(`Packaged executable not found: ${layout.executablePath}`);
  }
  if (!fs.existsSync(layout.runtimeReadyPath)) {
    throw new Error(`Bundled runtime marker not found: ${layout.runtimeReadyPath}`);
  }

  // Two distinct ports/sandboxes: the update is driven and its helper relaunch
  // proved on port1, then that process is terminated before an independent cold
  // boot on port2. This also proves the single-instance lock was released.
  const port1 = await choosePort(config.port);
  const port2 = await choosePort(0, [port1]);
  const sandbox1 = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-selfupdate-s1-"));
  const sandbox2 = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-selfupdate-s2-"));
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-selfupdate-asset-"));
  const sentinelPath = sentinelInstalledPath(layout, config.platform);
  const stalePath = staleInstalledPath(layout, config.platform);

  let fixture;
  let child;
  let relaunchPid = null;
  let env1 = null;

  console.log(`Self-update smoke root: ${config.extractedRoot}`);
  console.log(`Executable:             ${layout.executablePath}`);

  try {
    // Clear any stale marker left by a previous interrupted run BEFORE building the
    // asset — the asset is a full copy of the installed tree, so a leftover marker
    // would otherwise be baked into the asset and survive even a correct atomic
    // replace, falsely failing Phase 2b.
    fs.rmSync(stalePath, { force: true });

    const asset = buildUpdateAsset(layout, config.platform, config.appName, workDir);
    console.log(`Update asset:           ${asset.assetName} (${asset.assetSize} bytes)`);

    // Plant a stale marker in the INSTALLED bundle only — after the asset is built
    // so the asset never contains it. A correct (atomic-replace) updater swaps the
    // whole tree and the stale file disappears; a merge-overlay updater leaves it.
    fs.writeFileSync(stalePath, "self-update smoke stale file\n");
    console.log(`Planted stale marker:   ${stalePath}`);

    fixture = await startFixtureServer(asset);
    console.log(`Fixture release server: ${fixture.base}`);

    // Phase 1: launch the real app ONLINE against the fixture (drop
    // NIRS4ALL_OFFLINE; point updates at the fixture; disable Sentry so the
    // intentional version non-advance can't emit an external event), drive the
    // update through its backend, then quit so the updater replaces files.
    env1 = archiveSmoke.buildSandboxEnv(config.platform, sandbox1, port1);
    delete env1.NIRS4ALL_OFFLINE;
    env1.SENTRY_DSN = "";
    env1.NIRS4ALL_UPDATE_API_BASE = fixture.base;
    child = await launchHealthy(layout, env1, port1, config.timeoutMs, "launch#1");
    await driveUpdate(
      `http://127.0.0.1:${port1}`,
      config.timeoutMs,
      () => childOutput.get(child)?.join("\n") || "",
      env1.NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN,
    );
    await delay(1000);
    if (fs.existsSync(sentinelPath)) {
      throw new Error("update helper replaced the application before Electron exited");
    }
    console.log("Update applied. Quitting so the updater can replace files...");
    await quitApp(child);
    child = null;

    // Phase 2: the updater must have replaced files in place.
    await waitForSentinel(sentinelPath, config.timeoutMs);
    console.log("Updater replaced files in place (sentinel present).");
    await waitForUpdaterRelaunch(
      port1,
      env1.NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN,
      config.timeoutMs,
    );
    console.log("Native updater relaunched a healthy, scientifically ready app.");
    relaunchPid = await getRelaunchPid(
      port1,
      env1.NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN,
      config.timeoutMs,
    );
    await terminateRelaunch(
      relaunchPid,
      port1,
      env1.NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN,
      config.timeoutMs,
    );
    console.log(`Stopped helper-relaunched app PID ${relaunchPid} before the independent cold boot.`);
    relaunchPid = null;

    // Phase 2b: the stale file (present in the install, absent from the asset)
    // must be GONE — proving the updater replaces the tree atomically rather than
    // merging onto it. The sentinel write and the stale removal are the same swap,
    // so once the sentinel is visible the stale file's fate is already decided.
    // This is the regression guard for the atomic-replace fix (audit #4).
    if (fs.existsSync(stalePath)) {
      throw new Error(
        `stale file survived the update (overlay merge, not atomic replace): ${stalePath}. `
        + "Expected the updater to remove files absent from the new version.",
      );
    }
    console.log("Stale file removed by the update (atomic replace).");

    // Phase 3: independently boot the UPDATED bundle offline on a distinct
    // port + sandbox. The helper relaunch above proves the real lifecycle; this
    // second launch isolates on-disk integrity and macOS framework symlinks.
    const env2 = archiveSmoke.buildSandboxEnv(config.platform, sandbox2, port2);
    env2.SENTRY_DSN = "";
    // The staged asset is a full app tree, so the updater's copy can still be in
    // flight when the sentinel appeared. Wait for the executable to be fully
    // written before booting, so spawn() doesn't race the copy (ENOENT under load).
    await waitForStableExecutable(layout.executablePath, config.timeoutMs);
    child = await launchHealthy(layout, env2, port2, config.timeoutMs, "post-update boot");

    // Phase 3b: prove the UPDATED bundle remains scientifically usable through
    // the migrated Rust/native surface and its bounded installed owner facade.
    await archiveSmoke.waitForNativeScientificReady(
      port2,
      config.timeoutMs,
      child,
      childOutput.get(child) ?? [],
      env2.NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN,
    );
    console.log("Self-update smoke passed: atomic replacement, relaunch, native training, and inline Playground facade all verified.");
  } finally {
    await quitApp(child);
    if (relaunchPid) {
      await terminateRelaunch(
        relaunchPid,
        port1,
        env1?.NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN,
        config.timeoutMs,
      ).catch(() => {});
    }
    if (fixture) {
      await fixture.close();
    }
    if (!config.keepSandbox) {
      await archiveSmoke.cleanupSandboxRoot(sandbox1);
      await archiveSmoke.cleanupSandboxRoot(sandbox2);
      await archiveSmoke.cleanupSandboxRoot(workDir);
    }
  }
}

async function main() {
  const parsed = parseArgs();
  if (parsed.help) {
    printHelp();
    return;
  }
  await smokeSelfUpdate(parsed);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Self-update smoke failed:", error.message);
    process.exit(1);
  });
}

module.exports = {
  assetNameForPlatform,
  assertValidConfig,
  buildReleaseJson,
  buildUpdateAsset,
  driveUpdate,
  parseArgs,
  sentinelInstalledPath,
  staleInstalledPath,
  startFixtureServer,
};
