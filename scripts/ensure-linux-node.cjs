/*
 * Fails fast when this repo is being run with Windows node/npm against a WSL path.
 * This avoids confusing errors like cmd.exe UNC path failures and missing vite.
 */

const execPath = process.execPath || "";
const platform = process.platform;
const cwd = process.cwd();

const isWindowsNode = platform === "win32";
const looksLikeWslPath = cwd.startsWith("\\\\wsl.localhost\\") || cwd.startsWith("\\\\wsl$\\") || cwd.includes("\\wsl.localhost\\") || cwd.includes("\\wsl$\\");

// Only block the problematic case: Windows Node accessing WSL filesystem paths
// This causes UNC path issues with cmd.exe. Native Windows or native Linux/WSL are fine.
if (isWindowsNode && looksLikeWslPath) {
  console.error("\nERROR: Detected Windows node/npm running against a WSL workspace.");
  console.error("This will spawn cmd.exe and break installs/dev (UNC paths are not supported).\n");
  console.error(`platform: ${platform}`);
  console.error(`execPath:  ${execPath}`);
  console.error(`cwd:      ${cwd}\n`);

  console.error("Fix (recommended): run these commands INSIDE WSL (Ubuntu terminal / VS Code Remote - WSL):");
  console.error("  nvm install && nvm use");
  console.error("  npm install");
  console.error("  npm run dev\n");

  console.error("Permanent fix: disable Windows PATH injection into WSL and restart WSL:");
  console.error("  sudo tee /etc/wsl.conf <<'EOF'\n  [interop]\n  appendWindowsPath=false\n  EOF");
  console.error("  (from Windows) wsl.exe --shutdown\n");

  process.exit(1);
}
