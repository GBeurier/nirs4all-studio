#!/usr/bin/env node
/**
 * check-dep-sync.cjs — fail the green gate if the dependency lists of the
 * transitional Python HTTP tooling drift apart.
 *
 * Single source of truth: BACKEND_COMMON_PACKAGES in
 * scripts/python-http-runtime-config.cjs. This transitional source/dev config
 * is intentionally excluded from packaged Electron products.
 *
 * Validated against it:
 *   - requirements.txt      (development and CI install list)
 *   - requirements-cpu.txt  (CPU development install list)
 *
 * Exit 0 when every source agrees; exit 1 with a precise diff otherwise.
 */
const fs = require("fs");
const path = require("path");
const { BACKEND_COMMON_PACKAGES } = require("./python-http-runtime-config.cjs");

const ROOT = path.resolve(__dirname, "..");

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

const canonical = new Map(
  BACKEND_COMMON_PACKAGES.map((s) => {
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
    found.set(base, spec);
  }
  for (const [base, spec] of canonical) {
    if (!found.has(base)) {
      errors.push(`${file}: missing canonical runtime dep '${spec}'`);
    } else if (found.get(base) !== spec) {
      errors.push(`${file}: '${found.get(base)}' must match canonical '${spec}'`);
    }
  }
  for (const [base, spec] of found) {
    if (!canonical.has(base)) {
      errors.push(
        `${file}: '${spec}' is not in canonical BACKEND_COMMON_PACKAGES ` +
          `(add it in scripts/python-http-runtime-config.cjs or remove it here)`,
      );
    }
  }
}

checkRequirements("requirements.txt");
checkRequirements("requirements-cpu.txt");

if (errors.length) {
  console.error("Backend dependency sources are out of sync with BACKEND_COMMON_PACKAGES:\n");
  for (const e of errors) console.error("  ✗ " + e);
  console.error("\nCanonical source: scripts/python-http-runtime-config.cjs (BACKEND_COMMON_PACKAGES).");
  process.exit(1);
}

console.log(
  `✓ backend dependency sources in sync (${canonical.size} runtime packages: ` +
    `requirements.txt, requirements-cpu.txt)`,
);
