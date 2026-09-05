/**
 * Smoke-test a packaged standalone archive that has already been extracted.
 *
 * The goal is to validate the real bundled runtime path:
 *   - launch the packaged Electron app with offline forced via env
 *   - force a deterministic Rust control-plane port
 *   - wait for sidecar-specific readiness and capabilities
 *   - explicitly preflight the bundled CPython library/plugin host
 *
 * Usage:
 *   node scripts/smoke-archive-standalone.cjs --extracted-root <path> [options]
 */

const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createServer } = require("net");
const packageJson = require("../package.json");
const { verifyRuntimeContract } = require("./native-runtime-contract.cjs");

const DEFAULT_APP_NAME = "nirs4all Studio";
const DEFAULT_TIMEOUT_MS = 180000;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const PLUGIN_PREFLIGHT_REQUEST_TIMEOUT_MS = 75000;
const ARCHIVE_SMOKE_SESSION_TOKEN_ENV = "NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN";

function printHelp() {
  console.log(`Usage:
  node scripts/smoke-archive-standalone.cjs --extracted-root <path> [options]

Options:
  --extracted-root <path>  Root directory created after unzipping the archive
  --platform <id>         win32 | linux | darwin (default: current platform)
  --app-name <name>       Expected packaged app name (default: ${DEFAULT_APP_NAME})
  --port <n>              Rust sidecar port via NIRS4ALL_NATIVE_SIDECAR_PORT
  --timeout-ms <n>        Timeout for health/runtime checks (default: ${DEFAULT_TIMEOUT_MS})
  --sandbox-root <path>   Optional isolated HOME/AppData root
  --keep-sandbox          Keep the generated sandbox directory for inspection
  --help                  Show this message`);
}

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    extractedRoot: "",
    platform: process.platform,
    appName: DEFAULT_APP_NAME,
    port: 0,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    sandboxRoot: "",
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
    } else if (flag === "--sandbox-root") {
      parsed.sandboxRoot = path.resolve(inlineValue ?? argv[++i]);
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
    sandboxRoot: rawConfig.sandboxRoot ? path.resolve(rawConfig.sandboxRoot) : "",
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

function findMacAppBundle(extractedRoot, appName) {
  if (extractedRoot.endsWith(".app")) {
    return extractedRoot;
  }

  const entries = fs.readdirSync(extractedRoot, { withFileTypes: true });
  const directMatch = entries.find((entry) => entry.isDirectory() && entry.name === `${appName}.app`);
  if (directMatch) {
    return path.join(extractedRoot, directMatch.name);
  }

  const fallback = entries.find((entry) => entry.isDirectory() && entry.name.endsWith(".app"));
  if (fallback) {
    return path.join(extractedRoot, fallback.name);
  }

  throw new Error(`No .app bundle found under ${extractedRoot}`);
}

function findDirectoryAppRoot(extractedRoot, executableName, maxDepth = 2) {
  const initialRoot = path.resolve(extractedRoot);
  let frontier = [initialRoot];
  const seen = new Set();

  for (let depth = 0; depth <= maxDepth; depth += 1) {
    const matches = frontier.filter((candidate) => (
      fs.existsSync(path.join(candidate, executableName))
      && fs.existsSync(path.join(candidate, "resources"))
    ));

    if (matches.length === 1) {
      return matches[0];
    }
    if (matches.length > 1) {
      break;
    }

    const nextFrontier = [];
    for (const candidate of frontier) {
      if (seen.has(candidate)) {
        continue;
      }
      seen.add(candidate);
      for (const entry of fs.readdirSync(candidate, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          nextFrontier.push(path.join(candidate, entry.name));
        }
      }
    }
    frontier = nextFrontier;
    if (frontier.length === 0) {
      break;
    }
  }

  return initialRoot;
}

function resolveLaunchLayout(extractedRoot, platformId, appName) {
  const nativeSidecarName = platformId === "win32" ? "studio-sidecar.exe" : "studio-sidecar";
  if (platformId === "darwin") {
    const appBundle = findMacAppBundle(extractedRoot, appName);
    const resourcesDir = path.join(appBundle, "Contents", "Resources");
    const runtimeRoot = path.join(resourcesDir, "backend", "python-runtime");
    return {
      appRoot: appBundle,
      backendRoot: path.join(resourcesDir, "backend"),
      executablePath: path.join(appBundle, "Contents", "MacOS", appName),
      runtimeReadyPath: path.join(runtimeRoot, "PLUGIN_RUNTIME_READY.json"),
      nativeSidecarPath: path.join(resourcesDir, "backend", "native", nativeSidecarName),
      bundledPythonPath: path.join(runtimeRoot, "python", "bin", "python3"),
      bundledPythonCandidates: [
        path.join(runtimeRoot, "python", "bin", "python3"),
      ],
    };
  }

  const executableName = platformId === "win32"
    ? `${appName}.exe`
    : platformId === "linux"
      ? (process.env.NIRS4ALL_APP_EXE || packageJson.name)
      : appName;
  const appRoot = findDirectoryAppRoot(extractedRoot, executableName);
  const runtimeRoot = path.join(appRoot, "resources", "backend", "python-runtime");
  return {
    appRoot,
    backendRoot: path.join(appRoot, "resources", "backend"),
    executablePath: path.join(appRoot, executableName),
    runtimeReadyPath: path.join(runtimeRoot, "PLUGIN_RUNTIME_READY.json"),
    nativeSidecarPath: path.join(appRoot, "resources", "backend", "native", nativeSidecarName),
    bundledPythonPath:
      platformId === "win32"
        ? path.join(runtimeRoot, "python", "python.exe")
        : path.join(runtimeRoot, "python", "bin", "python3"),
    bundledPythonCandidates:
      platformId === "win32"
        ? [
            path.join(runtimeRoot, "python", "python.exe"),
          ]
        : [
            path.join(runtimeRoot, "python", "bin", "python3"),
          ],
  };
}

function ensurePathExists(targetPath, label) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`${label} not found: ${targetPath}`);
  }
}

function verifyLaunchRuntimeContract(launchLayout, platformId, arch = process.arch) {
  return verifyRuntimeContract({
    backendRoot: launchLayout.backendRoot,
    artifactBoundaryRoot: launchLayout.appRoot,
    platform: platformId,
    arch,
    requireBundledPythonPlugin: true,
    requireBundledMethods: true,
  });
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function pluginPreflightTimeoutMs(remainingMs) {
  return Math.max(1, Math.min(PLUGIN_PREFLIGHT_REQUEST_TIMEOUT_MS, remainingMs));
}

function collectRuntimePathLeaks(runtimeRoot, disallowedFragments) {
  const leaks = [];
  const queue = [runtimeRoot];
  const binaryExtensions = new Set([".a", ".dll", ".dylib", ".exe", ".lib", ".pdb", ".pyc", ".pyd", ".so", ".whl", ".zip"]);

  while (queue.length > 0) {
    const currentDir = queue.pop();
    if (!currentDir || !fs.existsSync(currentDir)) {
      continue;
    }

    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__pycache__") {
          continue;
        }
        queue.push(entryPath);
        continue;
      }

      try {
        const stat = fs.lstatSync(entryPath);
        if (stat.isSymbolicLink()) {
          const target = fs.readlinkSync(entryPath);
          const matched = disallowedFragments.filter((fragment) => fragment && target.includes(fragment));
          if (matched.length > 0) {
            leaks.push({ path: entryPath, kind: "symlink", matches: matched });
          }
          continue;
        }

        if (!stat.isFile() || stat.size > 1024 * 1024) {
          continue;
        }

        const ext = path.extname(entry.name).toLowerCase();
        const parentName = path.basename(path.dirname(entryPath));
        const shouldInspect = entry.name === "pyvenv.cfg"
          || parentName === "Scripts"
          || parentName === "bin"
          || [".cfg", ".pth"].includes(ext)
          || entry.name.startsWith("activate");
        if (!shouldInspect || binaryExtensions.has(ext)) {
          continue;
        }

        const buffer = fs.readFileSync(entryPath);
        if (buffer.includes(0)) {
          continue;
        }

        const text = buffer.toString("utf-8");
        const matched = disallowedFragments.filter((fragment) => fragment && text.includes(fragment));
        if (matched.length > 0) {
          leaks.push({ path: entryPath, kind: "text", matches: matched });
        }
      } catch {
        // Ignore unreadable runtime files during leak scanning.
      }
    }
  }

  return leaks;
}

function buildSandboxEnv(platformId, sandboxRoot, port, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const env = {
    ...process.env,
    CI: "1",
    ELECTRON_ENABLE_LOGGING: "1",
    NIRS4ALL_OFFLINE: "1",
    NIRS4ALL_NATIVE_SIDECAR_PORT: String(port),
    NIRS4ALL_PLUGIN_RUNTIME_VERIFY_TIMEOUT_MS: String(timeoutMs),
    NIRS4ALL_PLUGIN_PACKAGE_VERIFY_TIMEOUT_MS: String(timeoutMs),
    // The Electron main process accepts this fresh credential only under CI,
    // then passes it to the sidecar under the ordinary private session name.
    // This lets the external harness exercise the authenticated product routes
    // without disabling the access policy or printing the credential.
    [ARCHIVE_SMOKE_SESSION_TOKEN_ENV]: crypto.randomBytes(32).toString("hex"),
  };
  delete env.NIRS4ALL_BACKEND_PORT;

  if (platformId === "win32") {
    const userProfile = path.join(sandboxRoot, "UserProfile");
    const appData = path.join(userProfile, "AppData", "Roaming");
    const localAppData = path.join(userProfile, "AppData", "Local");
    const tempDir = path.join(localAppData, "Temp");
    [userProfile, appData, localAppData, tempDir].forEach(ensureDir);
    env.USERPROFILE = userProfile;
    env.HOME = userProfile;
    env.APPDATA = appData;
    env.LOCALAPPDATA = localAppData;
    env.TEMP = tempDir;
    env.TMP = tempDir;
    return env;
  }

  const homeDir = path.join(sandboxRoot, "home");
  const cacheDir = path.join(homeDir, ".cache");
  const dataDir = path.join(homeDir, ".local", "share");
  const configDir = path.join(homeDir, ".config");
  const tempDir = path.join(sandboxRoot, "tmp");
  [homeDir, cacheDir, dataDir, configDir, tempDir].forEach(ensureDir);
  env.HOME = homeDir;
  env.TMPDIR = tempDir;

  if (platformId === "linux") {
    env.XDG_CACHE_HOME = cacheDir;
    env.XDG_DATA_HOME = dataDir;
    env.XDG_CONFIG_HOME = configDir;
  }

  return env;
}

async function choosePort(preferredPort) {
  if (preferredPort) {
    return preferredPort;
  }

  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
    server.on("error", reject);
  });
}

async function waitForChildExit(child, timeoutMs = 5000) {
  if (!child || child.exitCode !== null) {
    return true;
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (didExit) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      child.removeListener("exit", onExit);
      resolve(didExit);
    };
    const onExit = () => finish(true);
    const timeout = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", onExit);
  });
}

function isRetryableCleanupError(error) {
  return Boolean(error && ["EACCES", "EBUSY", "ENOTEMPTY", "EPERM"].includes(error.code));
}

async function removePathWithRetries(targetPath, options = {}) {
  const retryCount = options.retryCount ?? (process.platform === "win32" ? 6 : 2);
  const retryDelayMs = options.retryDelayMs ?? 250;

  for (let attempt = 0; attempt < retryCount; attempt += 1) {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!isRetryableCleanupError(error) || attempt === retryCount - 1) {
        throw error;
      }
      await delay(retryDelayMs * Math.pow(2, attempt));
    }
  }
}

async function cleanupSandboxRoot(sandboxRoot, options = {}) {
  if (!fs.existsSync(sandboxRoot)) {
    return true;
  }

  try {
    await removePathWithRetries(sandboxRoot, options);
    return true;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : "unknown";
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Warning: unable to remove smoke sandbox ${sandboxRoot} (${code}): ${message}`);
    return false;
  }
}

async function waitForReady(port, timeoutMs, child, outputBuffer, sessionToken) {
  const deadline = Date.now() + timeoutMs;
  const healthUrl = `http://127.0.0.1:${port}/sidecar/v1/health`;
  const capabilitiesUrl = `http://127.0.0.1:${port}/sidecar/v1/capabilities`;
  const pluginPreflightUrl = `http://127.0.0.1:${port}/sidecar/v1/python/preflight`;
  const headers = { "X-Nirs4all-Session": sessionToken };
  let lastFailure = "no response";

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`App exited before health check completed (code ${child.exitCode}).\n${outputBuffer.join("\n")}`);
    }

    try {
      const healthResponse = await fetch(healthUrl, {
        headers,
        signal: AbortSignal.timeout(3000),
      });
      if (healthResponse.ok) {
        const healthPayload = await healthResponse.json();
        if (healthPayload.sidecar_ready === true) {
          const capabilitiesResponse = await fetch(capabilitiesUrl, {
            headers,
            signal: AbortSignal.timeout(3000),
          });
          const capabilitiesPayload = capabilitiesResponse.ok ? await capabilitiesResponse.json() : null;
          const pluginResponse = await fetch(pluginPreflightUrl, {
            headers,
            signal: AbortSignal.timeout(pluginPreflightTimeoutMs(deadline - Date.now())),
          });
          const pluginPayload = pluginResponse.ok ? await pluginResponse.json() : null;
          return {
            healthPayload,
            capabilitiesPayload,
            pluginPayload,
            pluginStatus: pluginResponse.status,
          };
        }
        lastFailure = `health payload not ready: ${JSON.stringify(healthPayload)}`;
      } else {
        lastFailure = `health HTTP ${healthResponse.status}: ${await healthResponse.text()}`;
      }
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }

    await delay(DEFAULT_POLL_INTERVAL_MS);
  }

  throw new Error(
    `Timed out waiting for ${healthUrl}; last failure: ${lastFailure}.\n${outputBuffer.join("\n")}`,
  );
}

/** Prove the migrated product is scientifically usable without a Python HTTP
 * backend: native training must be ready and the installed owner facade must
 * execute one bounded inline Playground request through the Rust route. */
async function waitForNativeScientificReady(port, timeoutMs, child, outputBuffer, sessionToken) {
  const deadline = Date.now() + timeoutMs;
  const healthUrl = `http://127.0.0.1:${port}/api/health`;
  const readinessUrl = `http://127.0.0.1:${port}/api/system/readiness`;
  const playgroundUrl = `http://127.0.0.1:${port}/api/playground/execute`;
  const headers = sessionToken ? { "X-Nirs4all-Session": sessionToken } : {};
  let lastHealth = null;
  let lastReadiness = null;
  let lastPlayground = null;
  let lastFailure = "no response";

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`App exited before native scientific readiness completed (code ${child.exitCode}).\n${outputBuffer.join("\n")}`);
    }
    try {
      const [healthResponse, readinessResponse] = await Promise.all([
        fetch(healthUrl, { headers, signal: AbortSignal.timeout(5000) }),
        fetch(readinessUrl, { headers, signal: AbortSignal.timeout(5000) }),
      ]);
      if (!healthResponse.ok || !readinessResponse.ok) {
        lastFailure = `health/readiness HTTP ${healthResponse.status}/${readinessResponse.status}`;
        await delay(DEFAULT_POLL_INTERVAL_MS);
        continue;
      }
      lastHealth = await healthResponse.json();
      lastReadiness = await readinessResponse.json();
      if (
        (lastHealth.core_ready === true || lastHealth.ready === true) &&
        lastReadiness.native_training_ready === true
      ) {
        const playgroundResponse = await fetch(playgroundUrl, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            data: { x: [[1, 2], [3, 4]] },
            steps: [],
          }),
          signal: AbortSignal.timeout(60000),
        });
        lastPlayground = playgroundResponse.ok ? await playgroundResponse.json() : {
          status: playgroundResponse.status,
          body: await playgroundResponse.text(),
        };
        if (
          playgroundResponse.ok &&
          lastPlayground?.success === true &&
          JSON.stringify(lastPlayground?.processed?.shape) === "[2,2]"
        ) {
          return { health: lastHealth, readiness: lastReadiness, playground: lastPlayground };
        }
        lastFailure = `inline Playground probe failed: ${JSON.stringify(lastPlayground)}`;
      } else {
        lastFailure = `native readiness incomplete: ${JSON.stringify(lastReadiness)}`;
      }
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    await delay(DEFAULT_POLL_INTERVAL_MS);
  }
  throw new Error(
    `Timed out proving native scientific readiness; last failure: ${lastFailure}; `
    + `health=${JSON.stringify(lastHealth)} readiness=${JSON.stringify(lastReadiness)} `
    + `playground=${JSON.stringify(lastPlayground)}\n${outputBuffer.join("\n")}`,
  );
}

async function probeNativeScientificSurface(port, timeoutMs, child, outputBuffer, sessionToken) {
  return waitForNativeScientificReady(port, timeoutMs, child, outputBuffer, sessionToken);
}

function pushOutput(buffer, label, chunk) {
  const text = chunk.toString().trim();
  if (!text) {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    buffer.push(`[${label}] ${line}`);
  }
  while (buffer.length > 80) {
    buffer.shift();
  }
}

async function terminateApp(child) {
  if (!child || child.exitCode !== null) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.once("close", () => resolve());
      killer.once("error", () => resolve());
    });
    await waitForChildExit(child);
    return;
  }

  child.kill("SIGTERM");
  const exited = await waitForChildExit(child);
  if (!exited) {
    child.kill("SIGKILL");
    await waitForChildExit(child, 2000);
  }
}

async function smokeArchiveStandalone(rawConfig) {
  const config = assertValidConfig(rawConfig);
  const launchLayout = resolveLaunchLayout(config.extractedRoot, config.platform, config.appName);
  ensurePathExists(launchLayout.executablePath, "Packaged executable");
  ensurePathExists(launchLayout.runtimeReadyPath, "Bundled runtime marker");
  ensurePathExists(launchLayout.nativeSidecarPath, "Native Studio sidecar");
  const bundledPythonPath = launchLayout.bundledPythonCandidates.find((candidate) => fs.existsSync(candidate))
    ?? launchLayout.bundledPythonPath;
  ensurePathExists(bundledPythonPath, "Bundled Python");
  const verifiedRuntime = verifyLaunchRuntimeContract(
    launchLayout,
    config.platform,
  );
  if (verifiedRuntime.sidecarPath !== launchLayout.nativeSidecarPath) {
    throw new Error("Runtime contract did not select the packaged native sidecar");
  }
  if (verifiedRuntime.pythonPluginHostPath !== bundledPythonPath) {
    throw new Error("Runtime contract did not select the bundled Python plugin host");
  }

  const pathLeaks = collectRuntimePathLeaks(
    path.dirname(launchLayout.runtimeReadyPath),
    [process.cwd(), path.resolve("backend-dist")],
  );
  if (pathLeaks.length > 0) {
    const sample = pathLeaks
      .slice(0, 5)
      .map((leak) => `${leak.kind}:${leak.path} -> ${leak.matches.join(", ")}`)
      .join("\n");
    throw new Error(`Bundled runtime still references the build workspace.\n${sample}`);
  }

  const port = await choosePort(config.port);
  const sandboxRoot = config.sandboxRoot || fs.mkdtempSync(path.join(os.tmpdir(), "n4a-archive-smoke-"));
  const env = buildSandboxEnv(config.platform, sandboxRoot, port, config.timeoutMs);
  const outputBuffer = [];

  console.log(`Smoke root:     ${config.extractedRoot}`);
  console.log(`Executable:     ${launchLayout.executablePath}`);
  console.log(`Bundled Python: ${bundledPythonPath}`);
  console.log(`Native sidecar: ${launchLayout.nativeSidecarPath}`);
  console.log(`Sandbox:        ${sandboxRoot}`);
  console.log(`Sidecar port:   ${port}`);

  const child = spawn(launchLayout.executablePath, [], {
    cwd: launchLayout.appRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stdout?.on("data", (chunk) => pushOutput(outputBuffer, "stdout", chunk));
  child.stderr?.on("data", (chunk) => pushOutput(outputBuffer, "stderr", chunk));

  try {
    const { healthPayload, capabilitiesPayload, pluginPayload, pluginStatus } =
      await waitForReady(
        port,
        config.timeoutMs,
        child,
        outputBuffer,
        env[ARCHIVE_SMOKE_SESSION_TOKEN_ENV],
      );
    if (healthPayload.protocol_version !== "studio-sidecar-r1") {
      throw new Error(`Unexpected sidecar protocol: ${healthPayload.protocol_version ?? "undefined"}`);
    }
    if (
      capabilitiesPayload?.features?.scientific_execution !== false ||
      capabilitiesPayload?.features?.native_archive_v2_training !== true ||
      capabilitiesPayload?.features?.playground_routes !== true ||
      capabilitiesPayload?.features?.dataset_synthetic_generation_routes !== true ||
      capabilitiesPayload?.features?.legacy_api_routes !== false ||
      capabilitiesPayload?.features?.python_plugin_preflight !== true
    ) {
      throw new Error(`Unexpected native capabilities: ${JSON.stringify(capabilitiesPayload)}`);
    }
    if (
      pluginStatus !== 200 ||
      pluginPayload?.python_plugin_host !== "ready" ||
      pluginPayload?.nirs4all_import !== true ||
      pluginPayload?.scientific_execution !== "unavailable"
    ) {
      throw new Error(`Bundled Python plugin-host preflight failed: ${JSON.stringify(pluginPayload)}`);
    }
    await probeNativeScientificSurface(
      port,
      config.timeoutMs,
      child,
      outputBuffer,
      env[ARCHIVE_SMOKE_SESSION_TOKEN_ENV],
    );

    console.log("Smoke check passed.");
    console.log(`  product backend: Rust sidecar (${healthPayload.protocol_version})`);
    console.log(`  Python role:     explicit library/plugin host (${pluginPayload.bridge})`);
    console.log("  Scientific probe: native training ready + inline Playground facade executed");
    console.log("  Python HTTP fallback: not selected");
  } finally {
    await terminateApp(child);
    if (!config.keepSandbox && !config.sandboxRoot) {
      await cleanupSandboxRoot(sandboxRoot);
    }
  }
}

async function main() {
  const parsed = parseArgs();
  if (parsed.help) {
    printHelp();
    return;
  }
  await smokeArchiveStandalone(parsed);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Standalone archive smoke failed:", error.message);
    process.exit(1);
  });
}

module.exports = {
  assertValidConfig,
  buildSandboxEnv,
  cleanupSandboxRoot,
  collectRuntimePathLeaks,
  isRetryableCleanupError,
  parseArgs,
  pluginPreflightTimeoutMs,
  probeNativeScientificSurface,
  removePathWithRetries,
  resolveLaunchLayout,
  verifyLaunchRuntimeContract,
  smokeArchiveStandalone,
  waitForChildExit,
  waitForNativeScientificReady,
};
