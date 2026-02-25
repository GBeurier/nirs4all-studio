/**
 * Quick-build electron main process and preload for dev mode.
 *
 * In dev mode, vite-plugin-electron is disabled so electron/*.ts files are
 * NOT rebuilt automatically. This script uses esbuild (already a vite dep)
 * to bundle them into dist-electron/ before launching Electron.
 *
 * Chained into dev:electron so changes are always picked up on restart.
 */

const { build } = require("esbuild");
const path = require("path");
const fs = require("fs");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "dist-electron");
fs.mkdirSync(outDir, { recursive: true });

async function main() {
  // Build main process
  await build({
    entryPoints: [path.join(root, "electron/main.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: path.join(outDir, "main.cjs"),
    external: ["electron", "@sentry/*", "node:*"],
    logLevel: "warning",
  });

  // Build preload
  await build({
    entryPoints: [path.join(root, "electron/preload.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: path.join(outDir, "preload.cjs"),
    external: ["electron", "node:*"],
    logLevel: "warning",
  });

  console.log("Electron dev build complete → dist-electron/");
}

main().catch((err) => {
  console.error("Electron dev build failed:", err);
  process.exit(1);
});
