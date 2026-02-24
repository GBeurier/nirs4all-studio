/**
 * Waits for the Vite dev server to be ready, then launches Electron.
 * Cross-platform alternative to `sleep 2 && electron .`
 */

const http = require("http");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const VITE_URL = "http://localhost:5173";
const MAX_RETRIES = 30;
const RETRY_INTERVAL = 500; // ms

function syncElectronAssets(projectRoot) {
  const outDir = path.join(projectRoot, "dist-electron");
  fs.mkdirSync(outDir, { recursive: true });

  const assets = [
    { src: "electron/splash.html", dest: "splash.html" },
    { src: "public/nirs4all_logo.png", dest: "nirs4all_logo.png" },
  ];

  for (const { src, dest } of assets) {
    const srcPath = path.join(projectRoot, src);
    const destPath = path.join(outDir, dest);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function checkServer(url) {
  return new Promise((resolve) => {
    const req = http.get(new URL(url), (res) => {
      resolve(res.statusCode >= 200 && res.statusCode < 400);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer() {
  console.log(`Waiting for Vite dev server at ${VITE_URL}...`);

  for (let i = 0; i < MAX_RETRIES; i++) {
    const isReady = await checkServer(VITE_URL);
    if (isReady) {
      console.log("Vite dev server is ready!");
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL));
  }

  console.error(`Timeout: Vite dev server not ready after ${(MAX_RETRIES * RETRY_INTERVAL) / 1000}s`);
  return false;
}

async function main() {
  const serverReady = await waitForServer();
  if (!serverReady) {
    process.exit(1);
  }

  // Launch Electron
  const electronPath = require.resolve("electron");
  const electronBin = path.join(path.dirname(electronPath), "cli.js");
  const projectRoot = path.join(__dirname, "..");

  // Keep splash/logo in sync for dev relaunches using dist-electron/main.cjs.
  syncElectronAssets(projectRoot);

  const args = [electronBin, projectRoot];

  // Add --no-sandbox on Linux (required for some environments)
  if (process.platform === "linux") {
    args.push("--no-sandbox");
  }

  console.log("Launching Electron...");

  // Create env without ELECTRON_RUN_AS_NODE (which may be set by VSCode)
  // This variable makes Electron run as a plain Node.js process instead of the full Electron environment
  const env = { ...process.env, VITE_DEV_SERVER_URL: VITE_URL };
  delete env.ELECTRON_RUN_AS_NODE;

  const electron = spawn("node", args, {
    stdio: "inherit",
    cwd: projectRoot,
    env,
  });

  electron.on("close", (code) => {
    process.exit(code || 0);
  });
}

main();
