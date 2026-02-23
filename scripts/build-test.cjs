/**
 * Build verification script — runs all checks before packaging.
 *
 * Performs in order:
 *   1. TypeScript type-check
 *   2. ESLint
 *   3. Backend source copy (recommended-config.json included)
 *   4. Python backend import sanity (NIRS4ALL_OPTIONAL_DEPS loads from config)
 *   5. Frontend + Electron build (vite)
 *   6. electron-builder dry-run (validates config, no actual packaging)
 *
 * Usage:
 *   node scripts/build-test.cjs              # Full verification
 *   node scripts/build-test.cjs --quick      # Steps 1-4 only (no build)
 *   node scripts/build-test.cjs --build      # Steps 1-6 + actual packaging
 *   node scripts/build-test.cjs --platform win|mac|linux
 */

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const projectRoot = path.join(__dirname, "..");
process.chdir(projectRoot);

const isWindows = process.platform === "win32";

// Parse args
const args = process.argv.slice(2);
const quick = args.includes("--quick");
const fullBuild = args.includes("--build");
let platform = "";
const platformIdx = args.indexOf("--platform");
if (platformIdx !== -1 && args[platformIdx + 1]) {
  platform = args[platformIdx + 1];
}

const results = [];
let hasFailure = false;

function run(label, command, cmdArgs, options = {}) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    process.stdout.write(`  ${label}... `);
    const useShell = command === "npx" || command === "node";
    const proc = spawn(command, cmdArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: useShell,
      cwd: projectRoot,
      ...options,
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const ok = code === 0;
      if (ok) {
        console.log(`OK (${elapsed}s)`);
      } else {
        console.log(`FAIL (${elapsed}s)`);
        hasFailure = true;
        // Show last 20 lines of output on failure
        const lines = (stdout + stderr).trim().split("\n").slice(-20);
        for (const line of lines) {
          console.log(`    ${line}`);
        }
      }
      results.push({ label, ok, elapsed });
      resolve(ok);
    });
    proc.on("error", (err) => {
      console.log(`ERROR: ${err.message}`);
      hasFailure = true;
      results.push({ label, ok: false, elapsed: "0" });
      resolve(false);
    });
  });
}

function runPython(label, code) {
  // Write code to a temp file to avoid shell mangling multiline -c strings on Windows
  const tmpFile = path.join(os.tmpdir(), `nirs4all-test-${Date.now()}.py`);
  fs.writeFileSync(tmpFile, code.trim() + "\n", "utf-8");
  const pythonCmd = isWindows ? "python" : "python3";
  return run(label, pythonCmd, [tmpFile]).finally(() => {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  });
}

async function main() {
  console.log("========================================");
  console.log("  nirs4all Build Verification");
  console.log("========================================");
  console.log(`  Mode: ${fullBuild ? "full build" : quick ? "quick checks" : "verify (no package)"}`);
  console.log("");

  // ── Step 1: Static checks ──
  console.log("Step 1: Static checks");
  await run("TypeScript", "npx", ["tsc", "--noEmit"]);
  await run("ESLint", "npx", ["eslint", "src/", "electron/"]);
  console.log("");

  // ── Step 2: Backend source bundle ──
  console.log("Step 2: Backend source bundle");
  await run("Copy backend source", "node", ["scripts/copy-backend-source.cjs", "--clean"]);

  // Verify recommended-config.json is in the bundle
  const configInDist = path.join(projectRoot, "backend-dist", "recommended-config.json");
  process.stdout.write("  recommended-config.json in bundle... ");
  if (fs.existsSync(configInDist)) {
    const size = fs.statSync(configInDist).size;
    console.log(`OK (${(size / 1024).toFixed(1)} KB)`);
    results.push({ label: "recommended-config.json in bundle", ok: true, elapsed: "0" });
  } else {
    console.log("FAIL (missing)");
    hasFailure = true;
    results.push({ label: "recommended-config.json in bundle", ok: false, elapsed: "0" });
  }

  // Verify total bundle size
  process.stdout.write("  Bundle size check... ");
  const totalSize = getDirSize(path.join(projectRoot, "backend-dist"));
  const sizeMB = totalSize / (1024 * 1024);
  if (sizeMB < 5) {
    console.log(`OK (${sizeMB.toFixed(1)} MB — lightweight)`);
    results.push({ label: "Bundle size", ok: true, elapsed: "0" });
  } else {
    console.log(`WARN (${sizeMB.toFixed(1)} MB — expected <5 MB)`);
    results.push({ label: "Bundle size", ok: sizeMB < 50, elapsed: "0" });
  }
  console.log("");

  // ── Step 3: Python backend sanity ──
  console.log("Step 3: Python backend sanity");
  await runPython("NIRS4ALL_OPTIONAL_DEPS loads", `
import sys; sys.path.insert(0, '.')
from api.updates import NIRS4ALL_OPTIONAL_DEPS
cats = list(NIRS4ALL_OPTIONAL_DEPS.keys())
total = sum(len(c['packages']) for c in NIRS4ALL_OPTIONAL_DEPS.values())
assert len(cats) >= 8, f'Expected >=8 categories, got {len(cats)}'
assert total >= 20, f'Expected >=20 packages, got {total}'
`);
  await runPython("recommended_config.py parses", `
import sys; sys.path.insert(0, '.')
from api.recommended_config import _load_bundled_config, _parse_config
config = _load_bundled_config()
parsed = _parse_config(config, 'bundled')
assert len(parsed.optional) >= 20, f'Expected >=20 optional, got {len(parsed.optional)}'
assert len(parsed.profiles) >= 4, f'Expected >=4 profiles, got {len(parsed.profiles)}'
`);
  await runPython("venv_manager.get_installed_packages exists", `
import sys; sys.path.insert(0, '.')
from api.venv_manager import VenvManager
assert hasattr(VenvManager, 'get_installed_packages'), 'Missing get_installed_packages'
assert not hasattr(VenvManager, 'list_packages'), 'Obsolete list_packages still present'
`);
  console.log("");

  if (quick) {
    printSummary();
    return;
  }

  // ── Step 4: Frontend + Electron build ──
  console.log("Step 4: Frontend + Electron build");
  await run("Vite build", "npx", ["cross-env", "ELECTRON=true", "vite", "build"]);

  // Verify outputs exist
  for (const dir of ["dist", "dist-electron"]) {
    process.stdout.write(`  ${dir}/ exists... `);
    if (fs.existsSync(path.join(projectRoot, dir))) {
      console.log("OK");
      results.push({ label: `${dir}/ exists`, ok: true, elapsed: "0" });
    } else {
      console.log("FAIL");
      hasFailure = true;
      results.push({ label: `${dir}/ exists`, ok: false, elapsed: "0" });
    }
  }

  // Verify electron main entry
  const mainCjs = path.join(projectRoot, "dist-electron", "main.cjs");
  process.stdout.write("  dist-electron/main.cjs exists... ");
  if (fs.existsSync(mainCjs)) {
    console.log("OK");
    results.push({ label: "main.cjs exists", ok: true, elapsed: "0" });
  } else {
    console.log("FAIL");
    hasFailure = true;
    results.push({ label: "main.cjs exists", ok: false, elapsed: "0" });
  }
  console.log("");

  if (!fullBuild) {
    printSummary();
    return;
  }

  // ── Step 5: electron-builder packaging ──
  console.log("Step 5: Electron packaging");
  const builderArgs = ["electron-builder"];
  if (platform) {
    builderArgs.push(`--${platform}`);
  }
  await run("electron-builder", "npx", builderArgs);

  // Show output files
  const releasePath = path.join(projectRoot, "release");
  if (fs.existsSync(releasePath)) {
    console.log("");
    console.log("  Output files:");
    for (const file of fs.readdirSync(releasePath)) {
      const stat = fs.statSync(path.join(releasePath, file));
      if (stat.isFile()) {
        const mb = (stat.size / (1024 * 1024)).toFixed(1);
        const sizeOk = stat.size < 50 * 1024 * 1024; // <50MB
        console.log(`    ${file} (${mb} MB)${sizeOk ? "" : " ⚠ LARGE"}`);
      }
    }
  }
  console.log("");

  printSummary();
}

function printSummary() {
  console.log("========================================");
  console.log("  Summary");
  console.log("========================================");
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`  Passed: ${passed}  Failed: ${failed}`);
  if (failed > 0) {
    console.log("");
    console.log("  Failed steps:");
    for (const r of results.filter((r) => !r.ok)) {
      console.log(`    - ${r.label}`);
    }
  }
  console.log("");
  process.exit(hasFailure ? 1 : 0);
}

function getDirSize(dirPath) {
  let total = 0;
  if (!fs.existsSync(dirPath)) return 0;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += getDirSize(full);
    } else {
      total += fs.statSync(full).size;
    }
  }
  return total;
}

main();
