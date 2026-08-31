#!/usr/bin/env node
/**
 * Build the Rust Studio control-plane binary into the packaged backend tree.
 *
 * The binary remains opt-in at runtime.  Keeping it next to the bundled Python
 * runtime gives the Rust process and a future explicit Python plugin host one
 * product-owned resource layout, without reviving a Python HTTP backend.
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "..");

function getNativeSidecarPaths(root = projectRoot, platform = process.platform) {
  const executableName = platform === "win32" ? "studio-sidecar.exe" : "studio-sidecar";
  return {
    manifestPath: path.join(root, "sidecar", "Cargo.toml"),
    builtBinaryPath: path.join(root, "sidecar", "target", "release", executableName),
    packagedBinaryPath: path.join(root, "backend-dist", "native", executableName),
  };
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed (code ${code}, signal ${signal ?? "none"}): ${command} ${args.join(" ")}`));
    });
  });
}

async function buildNativeSidecar({ root = projectRoot, cargo = "cargo", platform = process.platform } = {}) {
  const paths = getNativeSidecarPaths(root, platform);
  await run(cargo, ["build", "--manifest-path", paths.manifestPath, "--release"], root);
  if (!fs.existsSync(paths.builtBinaryPath)) {
    throw new Error(`Native sidecar build did not produce ${paths.builtBinaryPath}`);
  }

  fs.mkdirSync(path.dirname(paths.packagedBinaryPath), { recursive: true });
  fs.copyFileSync(paths.builtBinaryPath, paths.packagedBinaryPath);
  if (platform !== "win32") {
    fs.chmodSync(paths.packagedBinaryPath, 0o755);
  }
  return paths.packagedBinaryPath;
}

if (require.main === module) {
  buildNativeSidecar()
    .then((binaryPath) => console.log(`Native Studio sidecar packaged at ${binaryPath}`))
    .catch((error) => {
      console.error(`Native sidecar build failed: ${error.message}`);
      process.exit(1);
    });
}

module.exports = {
  buildNativeSidecar,
  getNativeSidecarPaths,
};
