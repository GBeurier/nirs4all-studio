/**
 * End-to-end self-update smoke for a packaged, already-extracted all-in-one bundle.
 *
 * Drives the REAL desktop self-update against a local fixture "GitHub" release
 * server and verifies the app comes back after applying:
 *   1. launch the packaged Electron app on a forced port, pointed at the fixture
 *      via NIRS4ALL_UPDATE_API_BASE (no internet needed — is_online() is not a
 *      network probe, it only honours NIRS4ALL_OFFLINE, which we do NOT set)
 *   2. wait for /api/health
 *   3. drive /updates/check -> /webapp/download-start -> poll -> /webapp/apply
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
  return `nirs4all-studio-${version}-all-in-one-${osKeyword}-${arch}.${ext}`;
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
 * Linux/Windows use directory-mode apply (the updater overlays staged files onto
 * the app dir with `cp -a STAGING/. APP_DIR/` / xcopy), so a minimal overlay
 * asset — the real executable + resources/<sentinel> — is enough to prove the
 * replace while keeping the relaunched app intact. macOS uses bundle-mode apply
 * (`rm -rf APP_DIR; cp -a STAGING APP_PARENT`), which is wholesale, so the asset
 * must be a complete .app; we ditto-zip it to preserve framework symlinks.
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
    // Linux/Windows directory-mode overlay: the real executable + a sentinel
    // under resources/. The updater (cp -a / xcopy) merges it onto the app dir.
    const topName = path.basename(layout.appRoot);
    const stageDir = path.join(workDir, "stage");
    const stageTop = path.join(stageDir, topName);
    fs.mkdirSync(path.join(stageTop, "resources"), { recursive: true });
    const exeName = path.basename(layout.executablePath);
    fs.copyFileSync(layout.executablePath, path.join(stageTop, exeName));
    if (platformId !== "win32") {
      fs.chmodSync(path.join(stageTop, exeName), 0o755);
    }
    fs.writeFileSync(path.join(stageTop, "resources", SENTINEL_NAME), "self-update smoke\n");
    if (platformId === "win32") {
      // Windows all-in-one is a .zip; Compress-Archive the top folder so the
      // staged layout matches the tar case (one top dir with exe + resources).
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
        const body = Buffer.from(`${assetSha}  ${assetName}\n`);
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

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) {
    throw new Error(`GET ${url} -> ${res.status}`);
  }
  return res.json();
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

/** Drive the backend through check -> download -> apply over HTTP. */
async function driveUpdate(baseUrl, timeoutMs) {
  // The in-app GitHub check can transiently fail under CI load (short HTTP
  // timeout), so the fixture release may not be seen on the first try. Re-run
  // the forced check until it is, bounded by the timeout. The last
  // download-info is included in the error to tell a failed fetch
  // (latest_version null) from a version-comparison miss (latest set).
  const checkDeadline = Date.now() + Math.min(timeoutMs, 120000);
  let info = {};
  for (;;) {
    try {
      await postJson(`${baseUrl}/api/updates/check`);
      info = await getJson(`${baseUrl}/api/updates/webapp/download-info`);
    } catch {
      info = {};
    }
    if (info.update_available) {
      break;
    }
    if (Date.now() > checkDeadline) {
      throw new Error(`fixture release was not seen as an available update after retries; last download-info=${JSON.stringify(info)}`);
    }
    await delay(5000);
  }
  if (info.can_apply_in_place === false) {
    throw new Error(`backend refused in-place update (channel=${info.update_channel})`);
  }

  const start = await postJson(`${baseUrl}/api/updates/webapp/download-start`);
  const jobId = start.job_id;
  if (!jobId) {
    throw new Error("download-start returned no job id");
  }

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await getJson(`${baseUrl}/api/updates/webapp/download-status/${jobId}`);
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

  const applied = await postJson(`${baseUrl}/api/updates/webapp/apply`, { confirm: true });
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

async function isHealthy(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) {
      return false;
    }
    const payload = await res.json();
    return Boolean(payload.core_ready || payload.ready);
  } catch {
    return false;
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

  const deadline = Date.now() + timeoutMs;
  while (!(await isHealthy(port))) {
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

  // Two distinct ports/sandboxes: the update is driven on port1; the post-update
  // bundle is re-booted on port2. They never compete, so the updater's own
  // (platform-specific) auto-relaunch on port1 can linger harmlessly on the
  // ephemeral CI runner instead of racing us.
  const port1 = await choosePort(config.port);
  const port2 = await choosePort(0, [port1]);
  const sandbox1 = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-selfupdate-s1-"));
  const sandbox2 = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-selfupdate-s2-"));
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-selfupdate-asset-"));
  const sentinelPath = sentinelInstalledPath(layout, config.platform);
  const stalePath = staleInstalledPath(layout, config.platform);

  let fixture;
  let child;

  console.log(`Self-update smoke root: ${config.extractedRoot}`);
  console.log(`Executable:             ${layout.executablePath}`);

  try {
    // Clear any stale marker left by a previous interrupted run BEFORE building the
    // asset — on macOS the asset is a `cp -a` of the whole .app, so a leftover marker
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
    const env1 = archiveSmoke.buildSandboxEnv(config.platform, sandbox1, port1);
    delete env1.NIRS4ALL_OFFLINE;
    env1.SENTRY_DSN = "";
    env1.NIRS4ALL_UPDATE_API_BASE = fixture.base;
    child = await launchHealthy(layout, env1, port1, config.timeoutMs, "launch#1");
    await driveUpdate(`http://127.0.0.1:${port1}`, config.timeoutMs);
    console.log("Update applied. Quitting so the updater can replace files...");
    await quitApp(child);
    child = null;

    // Phase 2: the updater must have replaced files in place.
    await waitForSentinel(sentinelPath, config.timeoutMs);
    console.log("Updater replaced files in place (sentinel present).");

    // Phase 2b: the stale file (present in the install, absent from the asset)
    // must be GONE — proving the updater replaces the tree atomically rather than
    // merging onto it. The sentinel write and the stale removal are the same swap,
    // so once the sentinel is visible the stale file's fate is already decided.
    // NOTE: this assertion is expected to FAIL until the atomic-replace fix (audit
    // #4) lands on directory-mode (Linux/Windows); it is the validator for that fix.
    if (fs.existsSync(stalePath)) {
      throw new Error(
        `stale file survived the update (overlay merge, not atomic replace): ${stalePath}. `
        + "Expected the updater to remove files absent from the new version.",
      );
    }
    console.log("Stale file removed by the update (atomic replace).");

    // Phase 3: boot the UPDATED bundle ourselves, offline, on a distinct
    // port + sandbox. A clean boot of the on-disk bundle is the real "the app
    // works after the update" signal — and on macOS it proves the ditto-zipped
    // .app extracted with intact framework symlinks. We don't reach for the
    // updater's own relaunch (its env/port is platform-specific and unreliable).
    const env2 = archiveSmoke.buildSandboxEnv(config.platform, sandbox2, port2);
    env2.SENTRY_DSN = "";
    child = await launchHealthy(layout, env2, port2, config.timeoutMs, "post-update boot");

    // Phase 3b: the UPDATED bundle must be able to `import nirs4all` (Phase 2 /
    // ml_ready), not just boot FastAPI — this proves the updated runtime is whole,
    // catching a broken editable/partial nirs4all install that ships green.
    await archiveSmoke.waitForMlReady(port2, config.timeoutMs, child, []);
    console.log("Self-update smoke passed: files replaced, stale file gone, and the updated bundle imports nirs4all.");
  } finally {
    await quitApp(child);
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
