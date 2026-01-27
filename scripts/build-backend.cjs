/**
 * Cross-platform build script for the Python backend.
 * This script works on Windows (PowerShell/cmd), Linux, and macOS.
 *
 * Usage:
 *   node scripts/build-backend.cjs [options]
 *
 * Options:
 *   --flavor cpu|gpu|gpu-metal   Build flavor (default: cpu)
 *   --clean                      Remove previous build artifacts before building
 */

const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "..");
process.chdir(projectRoot);

// Parse arguments
const args = process.argv.slice(2);
let flavor = "cpu";
let clean = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--flavor" && args[i + 1]) {
    flavor = args[++i];
  } else if (args[i] === "--clean") {
    clean = true;
  }
}

// Validate flavor
const validFlavors = ["cpu", "gpu", "gpu-metal"];
if (!validFlavors.includes(flavor)) {
  console.error(`Error: Invalid flavor '${flavor}'. Must be one of: ${validFlavors.join(", ")}`);
  process.exit(1);
}

// Auto-detect: on macOS, 'gpu' should use 'gpu-metal'
if (process.platform === "darwin" && flavor === "gpu") {
  console.log("Note: macOS detected, using 'gpu-metal' (Metal) instead of 'gpu' (CUDA)");
  flavor = "gpu-metal";
}

console.log(`=== Building nirs4all backend (${flavor.toUpperCase()} flavor) ===`);

// Clean previous builds if requested
if (clean) {
  console.log("Cleaning previous builds...");
  const dirsToClean = [
    "dist/nirs4all-backend",
    "dist/nirs4all-backend.exe",
    "build/nirs4all-backend",
    "backend-dist",
  ];
  for (const dir of dirsToClean) {
    const fullPath = path.join(projectRoot, dir);
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { recursive: true, force: true });
    }
  }
}

// Check virtual environment
const venvPath = path.join(projectRoot, ".venv");
if (!fs.existsSync(venvPath)) {
  console.error("Error: Virtual environment not found at .venv");
  console.error("Please create it first:");
  console.error("  python -m venv .venv");
  if (process.platform === "win32") {
    console.error("  .venv\\Scripts\\activate");
  } else {
    console.error("  source .venv/bin/activate");
  }
  console.error(`  pip install -r requirements-${flavor}.txt`);
  process.exit(1);
}

// Determine paths based on platform
const isWindows = process.platform === "win32";
const pythonPath = isWindows
  ? path.join(venvPath, "Scripts", "python.exe")
  : path.join(venvPath, "bin", "python");
const pipPath = isWindows
  ? path.join(venvPath, "Scripts", "pip.exe")
  : path.join(venvPath, "bin", "pip");

// Check if Python exists in venv
if (!fs.existsSync(pythonPath)) {
  console.error(`Error: Python not found at ${pythonPath}`);
  process.exit(1);
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`Running: ${command} ${args.join(" ")}`);
    const proc = spawn(command, args, {
      stdio: "inherit",
      shell: isWindows,
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

async function main() {
  try {
    // Ensure PyInstaller is installed
    console.log("Checking PyInstaller installation...");
    try {
      await runCommand(pipPath, ["show", "pyinstaller"]);
    } catch {
      console.log("Installing PyInstaller...");
      await runCommand(pipPath, ["install", "pyinstaller>=6.12.0"]);
    }

    // Install flavor-specific dependencies
    let requirementsFile;
    if (flavor === "gpu-metal") {
      requirementsFile = "requirements-gpu-macos.txt";
    } else {
      requirementsFile = `requirements-${flavor}.txt`;
    }

    if (fs.existsSync(path.join(projectRoot, requirementsFile))) {
      console.log(`Installing ${flavor} dependencies from ${requirementsFile}...`);
      await runCommand(pipPath, ["install", "-q", "-r", requirementsFile]);
    } else if (fs.existsSync(path.join(projectRoot, "requirements.txt"))) {
      console.log(`Warning: ${requirementsFile} not found, using default requirements.txt`);
      await runCommand(pipPath, ["install", "-q", "-r", "requirements.txt"]);
    }

    // Build the backend with PyInstaller
    console.log(`Running PyInstaller (${flavor} flavor)...`);
    await runCommand(pythonPath, ["-m", "PyInstaller", "backend.spec", "--noconfirm"], {
      env: { ...process.env, NIRS4ALL_BUILD_FLAVOR: flavor },
    });

    // Create backend-dist directory
    const backendDistPath = path.join(projectRoot, "backend-dist");
    if (!fs.existsSync(backendDistPath)) {
      fs.mkdirSync(backendDistPath, { recursive: true });
    }

    // Copy the built executable
    const exeName = isWindows ? "nirs4all-backend.exe" : "nirs4all-backend";
    const srcExe = path.join(projectRoot, "dist", exeName);
    const destExe = path.join(backendDistPath, exeName);

    if (fs.existsSync(srcExe)) {
      fs.copyFileSync(srcExe, destExe);
      console.log(`Backend built successfully: backend-dist/${exeName}`);

      // Make executable on Unix
      if (!isWindows) {
        fs.chmodSync(destExe, 0o755);
      }

      // Show file size
      const stats = fs.statSync(destExe);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
      console.log("");
      console.log(`=== Backend build complete (${flavor.toUpperCase()}) ===`);
      console.log(`Output: backend-dist/${exeName}`);
      console.log(`Size: ${sizeMB}M`);
    } else {
      console.error(`Error: Backend executable not found at ${srcExe}`);
      process.exit(1);
    }
  } catch (error) {
    console.error("Build failed:", error.message);
    process.exit(1);
  }
}

main();
