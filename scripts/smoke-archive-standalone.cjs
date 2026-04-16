/**
 * Smoke-test a packaged standalone archive that has already been extracted.
 *
 * The goal is to validate the real bundled runtime path:
 *   - launch the packaged Electron app with offline forced via env
 *   - force a deterministic backend port
 *   - wait for /api/health
 *   - verify /api/system/build reports runtime_mode=bundled
 *
 * Usage:
 *   node scripts/smoke-archive-standalone.cjs --extracted-root <path> [options]
 */

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createServer } = require("net");

const DEFAULT_APP_NAME = "nirs4all Studio";
const DEFAULT_TIMEOUT_MS = 180000;
const DEFAULT_POLL_INTERVAL_MS = 1000;

function printHelp() {
  console.log(`Usage:
  node scripts/smoke-archive-standalone.cjs --extracted-root <path> [options]

Options:
  --extracted-root <path>  Root directory created after unzipping the archive
  --platform <id>         win32 | linux | darwin (default: current platform)
  --app-name <name>       Expected packaged app name (default: ${DEFAULT_APP_NAME})
  --port <n>              Backend port to force via NIRS4ALL_BACKEND_PORT
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

function resolveLaunchLayout(extractedRoot, platformId, appName) {
  if (platformId === "darwin") {
    const appBundle = findMacAppBundle(extractedRoot, appName);
    const resourcesDir = path.join(appBundle, "Contents", "Resources");
    return {
      appRoot: appBundle,
      executablePath: path.join(appBundle, "Contents", "MacOS", appName),
      runtimeReadyPath: path.join(resourcesDir, "backend", "python-runtime", "RUNTIME_READY.json"),
      bundledPythonPath: path.join(resourcesDir, "backend", "python-runtime", "venv", "bin", "python"),
    };
  }

  const executableName = platformId === "win32" ? `${appName}.exe` : appName;
  return {
    appRoot: extractedRoot,
    executablePath: path.join(extractedRoot, executableName),
    runtimeReadyPath: path.join(extractedRoot, "resources", "backend", "python-runtime", "RUNTIME_READY.json"),
    bundledPythonPath:
      platformId === "win32"
        ? path.join(extractedRoot, "resources", "backend", "python-runtime", "venv", "Scripts", "python.exe")
        : path.join(extractedRoot, "resources", "backend", "python-runtime", "venv", "bin", "python"),
  };
}

function ensurePathExists(targetPath, label) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`${label} not found: ${targetPath}`);
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function buildSandboxEnv(platformId, sandboxRoot, port) {
  const env = {
    ...process.env,
    CI: "1",
    ELECTRON_ENABLE_LOGGING: "1",
    NIRS4ALL_OFFLINE: "1",
    NIRS4ALL_BACKEND_PORT: String(port),
  };

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

async function waitForReady(port, timeoutMs, child, outputBuffer) {
  const deadline = Date.now() + timeoutMs;
  const healthUrl = `http://127.0.0.1:${port}/api/health`;
  const buildUrl = `http://127.0.0.1:${port}/api/system/build`;
  const infoUrl = `http://127.0.0.1:${port}/api/system/info`;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`App exited before health check completed (code ${child.exitCode}).\n${outputBuffer.join("\n")}`);
    }

    try {
      const healthResponse = await fetch(healthUrl, { signal: AbortSignal.timeout(3000) });
      if (healthResponse.ok) {
        const healthPayload = await healthResponse.json();
        if (healthPayload.core_ready || healthPayload.ready) {
          const buildResponse = await fetch(buildUrl, { signal: AbortSignal.timeout(3000) });
          const buildPayload = buildResponse.ok ? await buildResponse.json() : null;
          const infoResponse = await fetch(infoUrl, { signal: AbortSignal.timeout(3000) });
          const infoPayload = infoResponse.ok ? await infoResponse.json() : null;
          return {
            healthPayload,
            buildPayload,
            infoPayload,
          };
        }
      }
    } catch {
      // Ignore transient connection errors during startup.
    }

    await new Promise((resolve) => setTimeout(resolve, DEFAULT_POLL_INTERVAL_MS));
  }

  throw new Error(`Timed out waiting for ${healthUrl}.\n${outputBuffer.join("\n")}`);
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
    return;
  }

  child.kill("SIGTERM");
  const exited = await new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), 5000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve(true);
    });
  });
  if (!exited) {
    child.kill("SIGKILL");
  }
}

async function smokeArchiveStandalone(rawConfig) {
  const config = assertValidConfig(rawConfig);
  const launchLayout = resolveLaunchLayout(config.extractedRoot, config.platform, config.appName);
  ensurePathExists(launchLayout.executablePath, "Packaged executable");
  ensurePathExists(launchLayout.runtimeReadyPath, "Bundled runtime marker");
  ensurePathExists(launchLayout.bundledPythonPath, "Bundled Python");

  const port = await choosePort(config.port);
  const sandboxRoot = config.sandboxRoot || fs.mkdtempSync(path.join(os.tmpdir(), "n4a-archive-smoke-"));
  const env = buildSandboxEnv(config.platform, sandboxRoot, port);
  const outputBuffer = [];

  console.log(`Smoke root:     ${config.extractedRoot}`);
  console.log(`Executable:     ${launchLayout.executablePath}`);
  console.log(`Bundled Python: ${launchLayout.bundledPythonPath}`);
  console.log(`Sandbox:        ${sandboxRoot}`);
  console.log(`Backend port:   ${port}`);

  const child = spawn(launchLayout.executablePath, [], {
    cwd: launchLayout.appRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stdout?.on("data", (chunk) => pushOutput(outputBuffer, "stdout", chunk));
  child.stderr?.on("data", (chunk) => pushOutput(outputBuffer, "stderr", chunk));

  try {
    const { buildPayload, infoPayload } = await waitForReady(port, config.timeoutMs, child, outputBuffer);
    const runtimeMode = buildPayload?.runtime_mode;
    const pythonExecutable = infoPayload?.python?.executable ?? "";

    if (runtimeMode !== "bundled") {
      throw new Error(`Expected runtime_mode=bundled, got ${runtimeMode ?? "undefined"}`);
    }
    if (!String(pythonExecutable).includes("python-runtime")) {
      throw new Error(`Expected bundled python executable, got ${pythonExecutable || "undefined"}`);
    }

    console.log("Smoke check passed.");
    console.log(`  runtime_mode: ${runtimeMode}`);
    console.log(`  python:       ${pythonExecutable}`);
  } finally {
    await terminateApp(child);
    if (!config.keepSandbox && !config.sandboxRoot && fs.existsSync(sandboxRoot)) {
      fs.rmSync(sandboxRoot, { recursive: true, force: true });
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
  parseArgs,
  resolveLaunchLayout,
  smokeArchiveStandalone,
};
