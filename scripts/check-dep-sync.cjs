#!/usr/bin/env node
/**
 * check-dep-sync.cjs — fail the green gate if the backend runtime dependency
 * sources drift apart.
 *
 * Single source of truth: BACKEND_COMMON_PACKAGES in scripts/python-runtime-config.cjs
 * (it already feeds the standalone build and is profile-aware).
 *
 * Validated against it:
 *   - requirements.txt          (dev / CI / PyInstaller fallback install list)
 *   - requirements-cpu.txt      (the live PyInstaller CPU build install list)
 *   - backend.spec hiddenimports (the frozen-build module roster)
 *
 * Build-only tooling (pyinstaller) is ignored. Transitional diagnostic tools
 * are declared separately in BACKEND_TRANSITION_TOOL_PACKAGES: they must stay
 * in both requirements files without entering the runtime/hiddenimport set.
 *
 * Exit 0 when every source agrees; exit 1 with a precise diff otherwise.
 */
const fs = require("fs");
const path = require("path");
const {
  BACKEND_COMMON_PACKAGES,
  BACKEND_TRANSITION_TOOL_PACKAGES,
} = require("./python-runtime-config.cjs");

const ROOT = path.resolve(__dirname, "..");
const BUILD_ONLY = new Set(["pyinstaller"]);

// pip import-name overrides (package name -> module imported in backend.spec)
const IMPORT_NAME = {
  "pyyaml": "yaml",
  "python-multipart": "python_multipart",
  "sentry-sdk": "sentry_sdk",
};

/** "uvicorn[standard]>=0.34.0" -> { base: "uvicorn", spec: "uvicorn[standard]>=0.34.0" } */
function parseSpec(line) {
  const spec = line.trim();
  const base = spec
    .replace(/\[.*?\]/g, "") // drop extras
    .split(/[<>=!~ ]/)[0] // drop version operators
    .trim()
    .toLowerCase();
  return { base, spec };
}

function importNameFor(base) {
  return IMPORT_NAME[base] || base.replace(/-/g, "_");
}

const canonical = new Map(
  BACKEND_COMMON_PACKAGES.map((s) => {
    const { base, spec } = parseSpec(s);
    return [base, spec];
  }),
);
const transitionTools = new Map(
  BACKEND_TRANSITION_TOOL_PACKAGES.map((s) => {
    const { base, spec } = parseSpec(s);
    return [base, spec];
  }),
);

const errors = [];

function checkRequirements(file) {
  const lines = fs.readFileSync(path.join(ROOT, file), "utf8").split("\n");
  const found = new Map();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("-r")) continue;
    const { base, spec } = parseSpec(line);
    if (BUILD_ONLY.has(base)) continue;
    found.set(base, spec);
  }
  for (const [base, spec] of canonical) {
    if (!found.has(base)) {
      errors.push(`${file}: missing canonical runtime dep '${spec}'`);
    } else if (found.get(base) !== spec) {
      errors.push(`${file}: '${found.get(base)}' must match canonical '${spec}'`);
    }
  }
  for (const [base, spec] of transitionTools) {
    if (!found.has(base)) {
      errors.push(`${file}: missing transitional tooling dep '${spec}'`);
    } else if (found.get(base) !== spec) {
      errors.push(`${file}: '${found.get(base)}' must match transitional tooling '${spec}'`);
    }
  }
  for (const [base, spec] of found) {
    if (!canonical.has(base) && !transitionTools.has(base)) {
      errors.push(
        `${file}: '${spec}' is not in canonical BACKEND_COMMON_PACKAGES ` +
          `or BACKEND_TRANSITION_TOOL_PACKAGES ` +
          `(classify it in scripts/python-runtime-config.cjs or remove it here)`,
      );
    }
  }
}

function checkBackendSpec() {
  const text = fs.readFileSync(path.join(ROOT, "backend.spec"), "utf8");
  for (const [base] of canonical) {
    const imp = importNameFor(base);
    const re = new RegExp(`['"]${imp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"]`);
    if (!re.test(text)) {
      errors.push(`backend.spec: hiddenimports missing '${imp}' (for canonical dep '${base}')`);
    }
  }
}

checkRequirements("requirements.txt");
checkRequirements("requirements-cpu.txt");
checkBackendSpec();

if (errors.length) {
  console.error("Backend dependency sources are out of sync with BACKEND_COMMON_PACKAGES:\n");
  for (const e of errors) console.error("  ✗ " + e);
  console.error("\nCanonical source: scripts/python-runtime-config.cjs (BACKEND_COMMON_PACKAGES).");
  process.exit(1);
}

console.log(
  `✓ backend dependency sources in sync (${canonical.size} runtime packages: ` +
    `requirements.txt, requirements-cpu.txt, backend.spec; ` +
    `${transitionTools.size} transitional tooling package)`,
);
