/**
 * Build an installer on the matching host: the installer payload (uv, the
 * wheels of the required packages, the document adapters, the Rust sidecar),
 * the frontend, then the electron-builder package.
 *
 * Usage:
 *   node scripts/build-release.cjs [options]
 *
 * Options:
 *   --flavor cpu          Build flavor (only supported release profile)
 *   --mode installer      Installer mode (the only supported distribution)
 *   --offline             Build the offline installer (Windows and Linux; adds the offline payload)
 *   --clean               Clean all build artifacts before building
 *   --skip-backend        Reuse the installer payload already in backend-dist/
 *   --skip-frontend       Skip building the frontend (use existing)
 *   --platform            Current host only: win, mac, or linux (default: current)
 */

const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { resolveSpawnCommand } = require("./spawn-command.cjs");
const { verifyRuntimeContract } = require("./native-runtime-contract.cjs");
const {
  packageAndVerifyInstallerOutputs,
} = require("./installer-release-contract.cjs");

const projectRoot = path.join(__dirname, "..");
process.chdir(projectRoot);

// Parse arguments
const args = process.argv.slice(2);
let flavor = "cpu";
let mode = "installer";
let offline = false;
let clean = false;
let skipBackend = false;
let skipFrontend = false;
let platform = "";
let argumentError = "";

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--flavor") {
    if (!args[i + 1] || args[i + 1].startsWith("--")) {
      argumentError = "--flavor requires a value";
      break;
    }
    flavor = args[++i];
  } else if (args[i] === "--offline") {
    offline = true;
  } else if (args[i] === "--clean") {
    clean = true;
  } else if (args[i] === "--mode") {
    if (!args[i + 1] || args[i + 1].startsWith("--")) {
      argumentError = "--mode requires a value";
      break;
    }
    mode = args[++i];
  } else if (args[i] === "--standalone") {
    mode = "standalone";
  } else if (args[i] === "--skip-backend") {
    skipBackend = true;
  } else if (args[i] === "--skip-frontend") {
    skipFrontend = true;
  } else if (args[i] === "--platform") {
    if (!args[i + 1] || args[i + 1].startsWith("--")) {
      argumentError = "--platform requires a value";
      break;
    }
    platform = args[++i];
  } else {
    argumentError = `Unknown argument: ${args[i]}`;
    break;
  }
}

if (argumentError) {
  console.error(`Error: ${argumentError}.`);
  process.exit(1);
}

if (offline && process.platform === "darwin") {
  console.error("Error: there is no macOS offline installer; a macOS application cannot embed wheels.");
  process.exit(1);
}

if (flavor !== "cpu") {
  console.error(
    `Error: Release flavor '${flavor}' is not implemented. Use '--flavor cpu'.`,
  );
  process.exit(1);
}

if (mode !== "installer") {
  console.error(
    `Error: Release mode '${mode}' is not supported. Only installers are enabled; portable and all-in-one releases are disabled.`,
  );
  process.exit(1);
}

const hostPlatform = { win32: "win", darwin: "mac", linux: "linux" }[process.platform];
if (!hostPlatform) {
  console.error(`Error: Unsupported release host '${process.platform}'.`);
  process.exit(1);
}
const supportedHostArch = process.arch === (process.platform === "darwin" ? "arm64" : "x64");
if (!supportedHostArch) {
  console.error(
    `Error: Installer packaging is not attested on '${process.platform}/${process.arch}'.`,
  );
  process.exit(1);
}
if (platform && platform !== hostPlatform) {
  console.error(
    `Error: Cross-platform installer packaging '${platform}' from '${hostPlatform}' is not attested. Run this helper on the matching host.`,
  );
  process.exit(1);
}

// A release tag on HEAD is authoritative. On an untagged preparation branch,
// retain package.json instead of silently downgrading to the previous release.
function syncVersionFromGitTag() {
  let tag;
  try {
    tag = execSync("git describe --tags --exact-match HEAD", {
      cwd: projectRoot,
      encoding: "utf-8",
    }).trim();
  } catch {
    console.warn(
      "No exact release tag on HEAD; using package.json version as-is.",
    );
    return;
  }

  const version = tag.replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+/.test(version)) {
    console.warn(
      `Warning: git tag '${tag}' is not a valid semver version, skipping version validation.`,
    );
    return;
  }
  const pkgPath = path.join(projectRoot, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  if (pkg.version !== version) {
    console.error(
      `Error: exact release tag '${tag}' does not match package.json version '${pkg.version}'.`,
    );
    process.exit(1);
  }
}

function getGitCommitShort() {
  try {
    return execSync("git rev-parse --short HEAD", {
      cwd: projectRoot,
      encoding: "utf-8",
    }).trim();
  } catch {
    return "unknown";
  }
}

function syncVersionJsonFromPackage() {
  const pkgPath = path.join(projectRoot, "package.json");
  const versionPath = path.join(projectRoot, "version.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  const versionData = {
    version: pkg.version,
    build_date: new Date().toISOString(),
    commit: getGitCommitShort(),
  };
  fs.writeFileSync(versionPath, `${JSON.stringify(versionData, null, 2)}\n`);
}

syncVersionFromGitTag();
syncVersionJsonFromPackage();

console.log("========================================");
console.log("  nirs4all Release Build");
console.log("========================================");
console.log("");
console.log("Build configuration:");
console.log(`  Mode: ${mode}${offline ? " (offline)" : ""}`);
console.log(`  Flavor: ${flavor.toUpperCase()}`);
console.log(`  Platform: ${platform || "current"}`);
console.log("");

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`Running: ${command} ${args.join(" ")}`);
    const spawnSpec = resolveSpawnCommand(command, args);
    const proc = spawn(spawnSpec.command, spawnSpec.args, {
      stdio: "inherit",
      shell: spawnSpec.shell,
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
      console.log("Clean complete");
      console.log("");
    }

    // Step 1: Stage what the installer ships beside the application. Python
    // itself is never packaged; Studio creates the user's environment with uv.
    const backendRoot = path.join(projectRoot, "backend-dist");
    if (!skipBackend) {
      console.log("=== Step 1: Staging uv, required wheels, adapters and the native sidecar ===");
      await runCommand("node", ["scripts/fetch-uv.cjs"]);
      await runCommand("node", ["scripts/build-wheelhouse.cjs"]);
      if (process.platform === "darwin") {
        // The macOS application names its required wheels instead of embedding them.
        const { version } = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"));
        await runCommand("node", ["scripts/pack-remote-wheelhouse.cjs", "--tag", version, "--version", version]);
      }
      await runCommand("node", ["scripts/studio-document-adapters.cjs", "--install", path.join(backendRoot, "adapters")]);
      await runCommand("node", ["scripts/build-native-sidecar.cjs"]);
    } else {
      console.log("=== Step 1: Reusing the installer payload in backend-dist/ ===");
    }
    if (offline) {
      await runCommand("node", ["scripts/build-offline-payload.cjs"]);
    } else {
      // A light installer must not pick up a payload left by an offline build.
      rmrf("backend-dist/offline");
    }
    verifyRuntimeContract({
      backendRoot,
      artifactBoundaryRoot: backendRoot,
      requirePythonPayload: true,
      requireBundledMethods: true,
    });
    console.log("");

    // Step 2: Build frontend (Vite + Electron)
    if (!skipFrontend) {
      console.log("=== Step 2: Building frontend ===");
      await runCommand("npm", ["run", "build:electron"]);
      console.log("");
    } else {
      console.log("=== Step 2: Skipping frontend build ===");
      if (
        !fs.existsSync(path.join(projectRoot, "dist")) ||
        !fs.existsSync(path.join(projectRoot, "dist-electron"))
      ) {
        console.error(
          "Error: dist or dist-electron not found but --skip-frontend was specified",
        );
        process.exit(1);
      }
      console.log("");
    }

    // Step 3: Package installer targets with electron-builder
    console.log(
      "=== Step 3: Packaging installer targets with electron-builder ===",
    );

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

    const releasePath = path.join(projectRoot, "release");
    const packaged = await packageAndVerifyInstallerOutputs({
      releaseRoot: releasePath,
      requestedPlatform: platform,
      verifyRuntimeContract,
      runBuilder: (stagingRoot) =>
        runCommand("npx", [
          "electron-builder",
          "--config",
          offline ? "electron-builder.offline.yml" : "electron-builder.installer.yml",
          "--publish",
          "never",
          `--config.directories.output=${stagingRoot}`,
          ...builderArgs,
        ]),
    });

    console.log("");
    console.log("========================================");
    console.log("  Build Complete!");
    console.log("========================================");
    console.log("");
    console.log(`Flavor: ${flavor.toUpperCase()}`);
    console.log("Output files are in: release/");
    console.log(
      `Verified outputs from this invocation: ${packaged.producedNames.join(", ")}`,
    );

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
  } catch (error) {
    console.error("Build failed:", error.message);
    process.exit(1);
  }
}

main();
