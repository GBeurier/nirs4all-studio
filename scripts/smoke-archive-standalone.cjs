/**
 * Smoke-test an unpacked or installed Studio application.
 *
 * The goal is to validate what a packaged application ships and that it runs
 * on an environment made from it:
 *   - create the Python environment with the shipped uv from the shipped
 *     wheels. With the offline payload nothing comes from the network, the
 *     default recommended packages are installed too, and then the packages
 *     the payload carries for installation on request (XGBoost, PyTorch): the payload
 *     must be complete on this platform
 *   - launch the packaged Electron app on that environment in a private profile
 *   - force a deterministic Rust control-plane port
 *   - wait for the sidecar and for the scientific host to be ready, then
 *     exercise the Playground and dataset routes through the Rust sidecar
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
const { provisionEnvironment } = require("./provision-environment.cjs");
const { lockedOfflineNames, readLock, targetKey } = require("./python-wheel-lock.cjs");

const DEFAULT_APP_NAME = "nirs4all Studio";
const DEFAULT_TIMEOUT_MS = 180000;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const ARCHIVE_SMOKE_SESSION_TOKEN_ENV = "NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN";
const MAX_DIAGNOSTIC_LINE_BYTES = 2048;

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
    return {
      appRoot: appBundle,
      backendRoot: path.join(resourcesDir, "backend"),
      executablePath: path.join(appBundle, "Contents", "MacOS", appName),
      nativeSidecarPath: path.join(resourcesDir, "backend", "native", nativeSidecarName),
    };
  }

  const executableName = platformId === "win32"
    ? `${appName}.exe`
    : platformId === "linux"
      ? (process.env.NIRS4ALL_APP_EXE || packageJson.name)
      : appName;
  const appRoot = findDirectoryAppRoot(extractedRoot, executableName);
  return {
    appRoot,
    backendRoot: path.join(appRoot, "resources", "backend"),
    executablePath: path.join(appRoot, executableName),
    nativeSidecarPath: path.join(appRoot, "resources", "backend", "native", nativeSidecarName),
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
    requirePythonPayload: true,
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

function buildSandboxEnv(platformId, sandboxRoot, port) {
  const env = {
    ...process.env,
    CI: "1",
    ELECTRON_ENABLE_LOGGING: "1",
    NIRS4ALL_OFFLINE: "1",
    NIRS4ALL_NATIVE_SIDECAR_PORT: String(port),
    // The Electron main process accepts this fresh credential only under CI,
    // then passes it to the sidecar under the ordinary private session name.
    // This lets the external harness exercise the authenticated product routes
    // without disabling the access policy or printing the credential.
    [ARCHIVE_SMOKE_SESSION_TOKEN_ENV]: crypto.randomBytes(32).toString("hex"),
  };
  delete env.NIRS4ALL_BACKEND_PORT;
  delete env.BASELINE_GITHUB_TOKEN;

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

/**
 * Create the environment where Studio creates its own and record it as the
 * selection that the application reads at startup from its data directory.
 * An offline payload must also provide every default recommended package
 * and, added to that environment afterwards, every package it carries for
 * installation on request.
 */
async function provisionSelectedEnvironment(backendRoot, userDataDir) {
  const lock = fs.existsSync(path.join(backendRoot, "offline")) ? readLock(targetKey(process.platform, process.arch)) : null;
  const environment = await provisionEnvironment({
    backendRoot,
    envDir: path.join(userDataDir, "python-env"),
    recommended: lock ? lockedOfflineNames(lock, "recommended") : [],
    onRequest: lock ? lockedOfflineNames(lock, "offline_extras") : [],
  });
  fs.writeFileSync(
    path.join(userDataDir, "env-settings.json"),
    `${JSON.stringify({ pythonPath: environment.pythonPath }, null, 2)}\n`,
  );
  return environment;
}

/** Wait for the sidecar, then for the scientific host of the selected environment. */
async function waitForReady(port, timeoutMs, child, outputBuffer, sessionToken) {
  const deadline = Date.now() + timeoutMs;
  const healthUrl = `http://127.0.0.1:${port}/sidecar/v1/health`;
  const readinessUrl = `http://127.0.0.1:${port}/api/system/readiness`;
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
          // The scientific host is acquired after the sidecar is ready.
          const readinessResponse = await fetch(readinessUrl, {
            headers,
            signal: AbortSignal.timeout(3000),
          });
          const readinessPayload = readinessResponse.ok ? await readinessResponse.json() : null;
          if (readinessPayload?.ml_ready === true) {
            return { healthPayload, readinessPayload };
          }
          if (readinessPayload?.ml_loading === false) {
            throw new ScientificHostError(
              `The scientific host did not start on the provisioned environment: ${JSON.stringify(readinessPayload)}`
              + `\n${outputBuffer.join("\n")}`,
            );
          }
          lastFailure = `scientific host still loading: ${JSON.stringify(readinessPayload)}`;
        } else {
          lastFailure = `health payload not ready: ${JSON.stringify(healthPayload)}`;
        }
      } else {
        lastFailure = `health HTTP ${healthResponse.status}: ${await healthResponse.text()}`;
      }
    } catch (error) {
      if (error instanceof ScientificHostError) throw error;
      lastFailure = error instanceof Error ? error.message : String(error);
    }

    await delay(DEFAULT_POLL_INTERVAL_MS);
  }

  throw new Error(
    `Timed out waiting for ${readinessUrl}; last failure: ${lastFailure}.\n${outputBuffer.join("\n")}`,
  );
}

class ScientificHostError extends Error {}

/** The sidecar must run the interpreter Studio selected, with nirs4all importable. */
async function verifySelectedEnvironment(port, sessionToken, pythonPath) {
  const response = await fetch(`http://127.0.0.1:${port}/api/system/env-coherence`, {
    headers: { "X-Nirs4all-Session": sessionToken },
    signal: AbortSignal.timeout(60000),
  });
  const coherence = response.ok ? await response.json() : { status: response.status, body: await response.text() };
  if (coherence.configured_python !== pythonPath || coherence.coherent !== true || coherence.core_ready !== true) {
    throw new Error(`The sidecar does not use the provisioned environment ${pythonPath}: ${JSON.stringify(coherence)}`);
  }
  return coherence;
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
        lastReadiness.native_training_ready === true &&
        lastReadiness.ml_ready === true
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

function pushOutput(buffer, label, chunk) {
  const text = chunk.toString().trim();
  if (!text) {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const encoded = Buffer.from(line, "utf8");
    const bounded = encoded.length > MAX_DIAGNOSTIC_LINE_BYTES
      ? `${encoded.subarray(0, MAX_DIAGNOSTIC_LINE_BYTES).toString("utf8")}…`
      : line;
    buffer.push(`[${label}] ${bounded}`);
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
  ensurePathExists(launchLayout.nativeSidecarPath, "Native Studio sidecar");
  const verifiedRuntime = verifyLaunchRuntimeContract(
    launchLayout,
    config.platform,
  );
  if (verifiedRuntime.sidecarPath !== launchLayout.nativeSidecarPath) {
    throw new Error("Runtime contract did not select the packaged native sidecar");
  }

  const port = await choosePort(config.port);
  const sandboxRoot = config.sandboxRoot || fs.mkdtempSync(path.join(os.tmpdir(), "n4a-archive-smoke-"));
  const env = buildSandboxEnv(config.platform, sandboxRoot, port);
  const userDataDir = path.join(sandboxRoot, "electron-user-data");
  const outputBuffer = [];

  console.log(`Smoke root:     ${config.extractedRoot}`);
  console.log(`Executable:     ${launchLayout.executablePath}`);
  console.log(`Native sidecar: ${launchLayout.nativeSidecarPath}`);
  console.log(`Sandbox:        ${sandboxRoot}`);
  console.log(`Sidecar port:   ${port}`);

  const environment = await provisionSelectedEnvironment(launchLayout.backendRoot, userDataDir);
  console.log(`Environment:    ${environment.pythonPath}${environment.offline ? " (offline payload)" : ""}`);

  // An extracted package on a hosted runner may lack a usable setuid zygote.
  // Opt in only for that candidate smoke; normal launches still exercise it.
  const launchArgs = [
    `--user-data-dir=${userDataDir}`,
    ...(config.platform === "linux" && process.env.N4A_SMOKE_ELECTRON_NO_SANDBOX === "1" ? ["--no-sandbox"] : []),
  ];
  const child = spawn(launchLayout.executablePath, launchArgs, {
    cwd: launchLayout.appRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stdout?.on("data", (chunk) => pushOutput(outputBuffer, "stdout", chunk));
  child.stderr?.on("data", (chunk) => pushOutput(outputBuffer, "stderr", chunk));

  try {
    const sessionToken = env[ARCHIVE_SMOKE_SESSION_TOKEN_ENV];
    const { healthPayload } = await waitForReady(port, config.timeoutMs, child, outputBuffer, sessionToken);
    if (healthPayload.protocol_version !== "studio-sidecar-r1") {
      throw new Error(`Unexpected sidecar protocol: ${healthPayload.protocol_version ?? "undefined"}`);
    }
    await verifySelectedEnvironment(port, sessionToken, environment.pythonPath);
    await waitForNativeScientificReady(port, config.timeoutMs, child, outputBuffer, sessionToken);
    await verifyInstalledProduct(port, sessionToken);
    await verifyRunLaunch(port, sessionToken);

    console.log("Smoke check passed.");
    console.log(`  product backend:  Rust sidecar (${healthPayload.protocol_version})`);
    console.log(`  Python:           environment created by the shipped uv${environment.offline ? " from the offline payload alone, with the default recommended packages and then the on-request ones" : ""}`);
    console.log("  Scientific probe: native training ready + inline Playground facade executed + one experiment launched and completed");
  } finally {
    await terminateApp(child);
    if (!config.keepSandbox && !config.sandboxRoot) {
      await cleanupSandboxRoot(sandboxRoot);
    }
  }
}

/** The renderer's JSON calls to the installed product's sidecar. */
function productRequest(port, sessionToken) {
  const headers = { "Content-Type": "application/json", "X-Nirs4all-Session": sessionToken };
  return async (route, body) => {
    const response = await fetch(`http://127.0.0.1:${port}/api${route}`, {
      headers, method: body === undefined ? "GET" : "POST",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error(`Installed product ${route}: HTTP ${response.status}: ${await response.text()}`);
    return response.json();
  };
}

/** Verify the exact dataset wizard path through the installed product. */
async function verifyInstalledProduct(port, sessionToken) {
  const request = productRequest(port, sessionToken);
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "studio-wizard-smoke-"));
  try {
    fs.writeFileSync(path.join(fixture, "Xtrain.csv"), "1000;1100\n1;2\n3;4\n");
    fs.writeFileSync(path.join(fixture, "Ytrain.csv"), "target\n1\n2\n");
    fs.writeFileSync(path.join(fixture, "Mtrain.csv"), "sample_id;nirs_Remarque\nsample-a;\nsample-a;ok\n");
    const detected = await request("/datasets/detect-unified", { path: fixture });
    const parsing = { delimiter: ";", decimal_separator: ".", has_header: true, na_policy: "auto" };
    // Header detection is ambiguous for tiny all-text metadata. Exercise the
    // user's local correction and ensure validation recovers identifier names.
    const files = detected.files.map(file => ({
      ...file, overrides: { ...file.overrides, has_header: true, delimiter: ";" },
    }));
    const validation = await request("/datasets/validate-files", {
      path: fixture, files, parsing,
    });
    for (const file of files) {
      if (validation.shapes?.[file.path]?.num_rows !== 2 || validation.shapes[file.path].error) {
        throw new Error(`Dataset wizard validation failed: ${JSON.stringify(validation)}`);
      }
      if (file.type === "metadata" && !validation.shapes[file.path].column_names?.includes("sample_id")) {
        throw new Error(`Metadata identifiers unavailable after local parsing: ${JSON.stringify(validation)}`);
      }
    }
    const preview = await request("/datasets/preview", {
      path: fixture, files, parsing, max_samples: 2,
    });
    if (preview.success !== true || preview.error) {
      throw new Error(`Dataset wizard preview failed: ${JSON.stringify(preview)}`);
    }
    const linked = await request("/datasets/link", {
      path: fixture,
      config: {
        name: "Metadata repetitions smoke",
        files,
        global_params: parsing,
        aggregation: { enabled: true, column: "sample_id", method: "mean" },
      },
    });
    const id = linked.dataset?.id;
    if (linked.success !== true || !id) {
      throw new Error(`Dataset registration failed: ${JSON.stringify(linked)}`);
    }
    const saved = await request(`/datasets/${encodeURIComponent(id)}`);
    if (saved.dataset?.config?.aggregation?.column !== "sample_id") {
      throw new Error(`Dataset repetition identifier was lost: ${JSON.stringify(saved)}`);
    }
    const reloaded = await request(`/datasets/${encodeURIComponent(id)}/preview?max_samples=2`);
    if (reloaded.success !== true || reloaded.summary?.num_samples !== 2
        || !reloaded.summary?.metadata_columns?.includes("sample_id")) {
      throw new Error(`Saved dataset reload failed: ${JSON.stringify(reloaded)}`);
    }
    const refreshed = await request(`/datasets/${encodeURIComponent(id)}/refresh`, {});
    if (refreshed.success !== true || refreshed.dataset?.num_samples !== 2) {
      throw new Error(`Saved dataset refresh failed: ${JSON.stringify(refreshed)}`);
    }
    return { preview };
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

/**
 * Launch one experiment with the renderer's own calls and wait for its end.
 * A product whose runs cannot start (a refused dataset, a host that lacks a
 * capability) fails here. The dataset has a sample without a target value,
 * which the run keeps and predicts.
 */
async function verifyRunLaunch(port, sessionToken) {
  const request = productRequest(port, sessionToken);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-run-smoke-"));
  try {
    const workspace = path.join(root, "workspace");
    // An existing linked workspace may not have the Studio runs directory yet.
    fs.mkdirSync(workspace);
    await request("/workspace/select", { path: workspace });
    const data = path.join(root, "data");
    fs.mkdirSync(data);
    const spectra = ["1000;1100;1200;1300"];
    const targets = ["target"];
    for (let index = 0; index < 24; index += 1) {
      const row = [index / 7, Math.sin(index), Math.cos(index / 3), (index % 5) / 2];
      spectra.push(row.join(";"));
      targets.push(index === 5 ? "" : String(2 * row[0] - row[1] + 0.4 * row[2] + row[3]));
    }
    fs.writeFileSync(path.join(data, "Xtrain.csv"), `${spectra.join("\n")}\n`);
    fs.writeFileSync(path.join(data, "Ytrain.csv"), `${targets.join("\n")}\n`);
    const linked = await request("/datasets/link", { path: data, config: {
      name: "Run smoke", delimiter: ";", has_header: true,
      files: [{ path: "Xtrain.csv", type: "X", split: "train" }, { path: "Ytrain.csv", type: "Y", split: "train" }],
    } });
    const dataset = linked.dataset?.id;
    if (linked.success !== true || !dataset || linked.dataset.targets?.[0]?.missing_count !== 1) {
      throw new Error(`Run smoke dataset registration failed: ${JSON.stringify(linked)}`);
    }
    const imported = await request("/pipelines/import", { payload: { name: "Run smoke PLS", pipeline: [
      { class: "sklearn.preprocessing.StandardScaler" },
      { class: "sklearn.model_selection.KFold", params: { n_splits: 3 } },
      { class: "sklearn.cross_decomposition.PLSRegression", params: { n_components: 2 } },
    ] } });
    const pipeline = imported.pipeline.id;
    const pair = `${dataset}::${pipeline}`;
    const name = "Run smoke";
    const submitted = await request("/runs/run-groups", {
      legacyConfig: { name, dataset_ids: [dataset], pipeline_ids: [pipeline], execution_backend: "local-python",
        engine: "dag-ml", allow_fallback: false, missing_target_policy: "predict" },
      manifest: { version: "studio.native-launch-payload.v1", legacyExperimentName: name, legacyDatasetCount: 1,
        legacyPipelineCount: 1, strictCampaignCount: 1, skippedRunCount: 0, sourceRunIds: [pair], skippedRunIds: [] },
      strictCampaignSpecs: { splitSpecs: [{ id: `single-pair:${pair}`, sourceRunId: pair, sourceDatasetId: dataset,
        sourcePipelineId: pipeline, campaign: { name, mode: "paired_by_index", executionBackend: "local-python",
          datasets: [{ id: dataset, name, splitGroupBy: null }],
          pipelines: [{ id: pipeline, name: "Run smoke PLS", source: "saved" }],
          runMatrix: [{ id: pair, datasetId: dataset, pipelineId: pipeline, datasetIndex: 0, pipelineIndex: 0, splitGroupBy: null }] } }],
        skippedRunIds: [] },
    });
    const deadline = Date.now() + 180000;
    for (;;) {
      const job = await request(`/training/${encodeURIComponent(submitted.job_id)}`);
      if (job.status === "completed") {
        const receipt = path.join(workspace, "runs", submitted.job_id, "execution_job_record.json");
        if (JSON.parse(fs.readFileSync(receipt, "utf8")).status !== "completed") {
          throw new Error("Run smoke did not persist its completion receipt");
        }
        return;
      }
      if (["failed", "error", "cancelled"].includes(job.status) || Date.now() > deadline) {
        throw new Error(`Run smoke did not complete: ${JSON.stringify(job).slice(0, 4000)}`);
      }
      await delay(500);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
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
  isRetryableCleanupError,
  parseArgs,
  provisionSelectedEnvironment,
  pushOutput,
  removePathWithRetries,
  resolveLaunchLayout,
  verifyLaunchRuntimeContract,
  smokeArchiveStandalone,
  verifyRunLaunch,
  waitForChildExit,
  waitForNativeScientificReady,
  verifyInstalledProduct,
  verifySelectedEnvironment,
  waitForReady,
};
