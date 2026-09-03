/**
 * Native Windows helper for a local Studio RC installer build.
 *
 * This intentionally refuses to run outside Windows: electron-builder can
 * validate config cross-platform, but the RC installer/portable artifacts must
 * be produced on the target host.
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { resolveSpawnCommand } = require("./spawn-command.cjs");

const projectRoot = path.join(__dirname, "..");
process.chdir(projectRoot);

function printHelp() {
  console.log(`Usage:
  node scripts/build-local-windows-rc.cjs --version <semver> [options]

Options:
  --version <semver>  Required RC version, for example 1.0.0-rc.1
  --skip-smoke        Skip npm run release:smoke
  --no-clean          Do not pass --clean to the release build
  --help              Show this message`);
}

function isSemver(value) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
}

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    version: "",
    clean: true,
    skipSmoke: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const [flag, inlineValue] = arg.includes("=") ? arg.split(/=(.+)/, 2) : [arg, undefined];

    if (flag === "--help") {
      parsed.help = true;
    } else if (flag === "--version") {
      parsed.version = inlineValue ?? argv[++i];
    } else if (flag === "--skip-smoke") {
      parsed.skipSmoke = true;
    } else if (flag === "--no-clean") {
      parsed.clean = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    console.log(`Running: ${command} ${args.join(" ")}`);
    const spawnSpec = resolveSpawnCommand(command, args);
    const proc = spawn(spawnSpec.command, spawnSpec.args, {
      stdio: "inherit",
      shell: spawnSpec.shell,
      cwd: projectRoot,
      env: process.env,
    });
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with code ${code}: ${command} ${args.join(" ")}`));
      }
    });
    proc.on("error", reject);
  });
}

function looksLikeWslUncPath(value) {
  return value.startsWith("\\\\wsl.localhost\\")
    || value.startsWith("\\\\wsl$\\")
    || value.includes("\\wsl.localhost\\")
    || value.includes("\\wsl$\\");
}

async function verifyReleaseInputs() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  await runCommand("npm", ["run", "check:ui-package"]);
  console.log(`Release inputs select Studio ${packageJson.version} and the exact vendored UI package.`);
  console.log("");
  return packageJson.version;
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    printHelp();
    return;
  }

  if (process.platform !== "win32") {
    throw new Error(
      `Native Windows RC builds must run on Windows. Current platform: ${process.platform}. `
      + "Use this script from PowerShell or Windows Terminal in a Windows checkout.",
    );
  }
  if (looksLikeWslUncPath(process.cwd())) {
    throw new Error(
      "Windows RC builds must run from a native Windows checkout, not a WSL UNC path. "
      + "Clone or copy the workspace to a drive path such as C:\\src\\nirs4all\\nirs4all-studio.",
    );
  }

  if (!options.version) {
    throw new Error("Missing --version. Use a SemVer prerelease such as --version 1.0.0-rc.1.");
  }
  if (!isSemver(options.version)) {
    throw new Error(`Invalid --version '${options.version}'. Use SemVer, for example 1.0.0-rc.1.`);
  }

  console.log("========================================");
  console.log("  nirs4all Studio Windows RC Build");
  console.log("========================================");
  console.log(`  Version: ${options.version}`);
  console.log("  Publish: never");
  console.log("");

  const packageVersion = await verifyReleaseInputs();
  if (options.version !== packageVersion) {
    throw new Error(
      `Requested version '${options.version}' does not match package.json '${packageVersion}'. `
      + "Bump the release manifests before building the native installer.",
    );
  }

  if (!options.skipSmoke) {
    await runCommand("npm", ["run", "release:smoke"]);
    console.log("");
  }

  const releaseArgs = ["run", "release", "--"];
  if (options.clean) {
    releaseArgs.push("--clean");
  }
  releaseArgs.push("--platform", "win");
  await runCommand("npm", releaseArgs);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Windows RC build failed:", error.message);
    process.exit(1);
  });
}

module.exports = {
  isSemver,
  looksLikeWslUncPath,
  parseArgs,
  verifyReleaseInputs,
};
