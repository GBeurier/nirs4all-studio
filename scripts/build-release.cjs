/**
 * Cross-platform build script for complete nirs4all release.
 * Builds frontend + backend + Electron packaging.
 *
 * Usage:
 *   node scripts/build-release.cjs [options]
 *
 * Options:
 *   --flavor cpu|gpu      Build flavor (default: cpu)
 *   --clean               Clean all build artifacts before building
 *   --skip-backend        Skip building the Python backend (use existing)
 *   --skip-frontend       Skip building the frontend (use existing)
 *   --platform            Target platform: win, mac, linux, or all (default: current)
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "..");
process.chdir(projectRoot);

const isWindows = process.platform === "win32";

// Parse arguments
const args = process.argv.slice(2);
let flavor = "cpu";
let clean = false;
let skipBackend = false;
let skipFrontend = false;
let platform = "";

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--flavor" && args[i + 1]) {
    flavor = args[++i];
  } else if (args[i] === "--clean") {
    clean = true;
  } else if (args[i] === "--skip-backend") {
    skipBackend = true;
  } else if (args[i] === "--skip-frontend") {
    skipFrontend = true;
  } else if (args[i] === "--platform" && args[i + 1]) {
    platform = args[++i];
  }
}

// Validate flavor
if (!["cpu", "gpu"].includes(flavor)) {
  console.error(`Error: Invalid flavor '${flavor}'. Must be 'cpu' or 'gpu'.`);
  process.exit(1);
}

console.log("========================================");
console.log("  nirs4all Release Build");
console.log("========================================");
console.log("");
console.log("Build configuration:");
console.log(`  Flavor: ${flavor.toUpperCase()}`);
console.log(`  Platform: ${platform || "current"}`);
console.log("");

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`Running: ${command} ${args.join(" ")}`);
    const proc = spawn(command, args, {
      stdio: "inherit",
      shell: true,
      cwd: projectRoot,
      ...options,
    });
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with code ${code}`));
      }
    });
    proc.on("error", reject);
  });
}

function rmrf(dirPath) {
  const fullPath = path.join(projectRoot, dirPath);
  if (fs.existsSync(fullPath)) {
    fs.rmSync(fullPath, { recursive: true, force: true });
    console.log(`  Removed: ${dirPath}`);
  }
}

async function main() {
  try {
    // Clean if requested
    if (clean) {
      console.log("=== Cleaning build artifacts ===");
      rmrf("dist");
      rmrf("dist-electron");
      rmrf("backend-dist");
      rmrf("release");
      rmrf("build/nirs4all-backend");
      console.log("Clean complete");
      console.log("");
    }

    // Step 1: Build Python backend
    if (!skipBackend) {
      console.log(`=== Step 1: Building Python backend (${flavor.toUpperCase()}) ===`);
      await runCommand("node", ["scripts/build-backend.cjs", "--flavor", flavor]);
      console.log("");
    } else {
      console.log("=== Step 1: Skipping backend build ===");
      const backendDistPath = path.join(projectRoot, "backend-dist");
      if (!fs.existsSync(backendDistPath) || fs.readdirSync(backendDistPath).length === 0) {
        console.error("Error: backend-dist is empty but --skip-backend was specified");
        process.exit(1);
      }
      console.log("");
    }

    // Step 2: Build frontend (Vite + Electron)
    if (!skipFrontend) {
      console.log("=== Step 2: Building frontend ===");
      await runCommand("npm", ["run", "build:electron"]);
      console.log("");
    } else {
      console.log("=== Step 2: Skipping frontend build ===");
      if (!fs.existsSync(path.join(projectRoot, "dist")) || !fs.existsSync(path.join(projectRoot, "dist-electron"))) {
        console.error("Error: dist or dist-electron not found but --skip-frontend was specified");
        process.exit(1);
      }
      console.log("");
    }

    // Step 3: Package with electron-builder
    console.log("=== Step 3: Packaging with electron-builder ===");

    const builderArgs = [];
    switch (platform) {
      case "win":
        builderArgs.push("--win");
        break;
      case "mac":
        builderArgs.push("--mac");
        break;
      case "linux":
        builderArgs.push("--linux");
        break;
      case "all":
        builderArgs.push("--win", "--mac", "--linux");
        break;
      default:
        // Current platform (no flags needed)
        break;
    }

    await runCommand("npx", ["electron-builder", ...builderArgs]);

    console.log("");
    console.log("========================================");
    console.log("  Build Complete!");
    console.log("========================================");
    console.log("");
    console.log(`Flavor: ${flavor.toUpperCase()}`);
    console.log("Output files are in: release/");

    const releasePath = path.join(projectRoot, "release");
    if (fs.existsSync(releasePath)) {
      const files = fs.readdirSync(releasePath);
      for (const file of files) {
        const stat = fs.statSync(path.join(releasePath, file));
        if (stat.isFile()) {
          const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);
          console.log(`  ${file} (${sizeMB}M)`);
        }
      }
    }
    console.log("");

    // Rename output files to include flavor if GPU
    if (flavor === "gpu" && fs.existsSync(releasePath)) {
      console.log("Renaming output files to include GPU flavor...");
      const files = fs.readdirSync(releasePath);
      for (const file of files) {
        const filePath = path.join(releasePath, file);
        if (fs.statSync(filePath).isFile() && !file.includes("-gpu")) {
          const newName = file.replace(/(nirs4all-[\d.]+)/, "$1-gpu");
          if (newName !== file) {
            fs.renameSync(filePath, path.join(releasePath, newName));
            console.log(`  ${file} -> ${newName}`);
          }
        }
      }
    }
  } catch (error) {
    console.error("Build failed:", error.message);
    process.exit(1);
  }
}

main();
