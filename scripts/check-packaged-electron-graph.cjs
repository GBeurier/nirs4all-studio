#!/usr/bin/env node
/**
 * Prove that the packaged Electron main/preload graph cannot reach or install
 * the transitional Python HTTP backend. The source walk catches transitive
 * imports; the production build check catches bundler/dynamic-load drift.
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_ENTRYPOINTS = Object.freeze([
  "electron/main.ts",
  "electron/preload.ts",
]);
const DYNAMIC_PACKAGED_FILES = Object.freeze([
  "scripts/python-runtime-config.cjs",
]);
const DIST_ENTRYPOINTS = Object.freeze([
  "dist-electron/main.cjs",
  "dist-electron/preload.cjs",
]);
const FORBIDDEN = Object.freeze([
  ["FastAPI install/import", /(?:fastapi\s*(?:[<>=~!]|\[)|(?:import|from)\s+fastapi\b)/i],
  ["Uvicorn install/import", /(?:uvicorn\s*(?:[<>=~!]|\[)|(?:import|from)\s+uvicorn\b|-m\s+uvicorn\b|uvicorn\.run)/i],
  ["python-multipart install", /python[-_]multipart\s*[<>=~!]/i],
  ["Python Sentry FastAPI integration install", /sentry[-_]sdk\s*\[\s*fastapi\s*\]/i],
  ["transitional Python HTTP config", /python-http-runtime-config/i],
  ["legacy Python backend manager", /(?:^|[/'"`])backend-manager(?:[.'"`/]|$)/im],
  ["legacy Python scientific lifecycle", /scientific-plugin-lifecycle/i],
  ["Python HTTP diagnostic flag", /NIRS4ALL_[A-Z0-9_]*PYTHON_HTTP/i],
  ["Python ASGI entrypoint", /(?:main:app|main\.py|api[\\/]main)/i],
]);
const RESOLVE_SUFFIXES = Object.freeze([
  "",
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  "/index.ts",
  "/index.tsx",
  "/index.js",
]);

function extractLocalSpecifiers(source) {
  const code = stripComments(source);
  const specifiers = new Set();
  const patterns = [
    /(?:import|export)\s+(?:[^'";]*?\s+from\s*)?["']([^"']+)["']/g,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) specifiers.add(match[1]);
  }
  return specifiers;
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function resolveLocalImport(root, importer, specifier) {
  let candidate;
  if (specifier.startsWith(".")) {
    candidate = path.resolve(path.dirname(importer), specifier);
  } else if (specifier.startsWith("@/")) {
    candidate = path.resolve(root, "src", specifier.slice(2));
  } else {
    return null;
  }

  for (const suffix of RESOLVE_SUFFIXES) {
    const resolved = `${candidate}${suffix}`;
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
  }
  throw new Error(
    `Packaged graph import '${specifier}' from '${path.relative(root, importer)}' could not be resolved`,
  );
}

function collectSourceGraph(root) {
  const pending = SOURCE_ENTRYPOINTS.map((entrypoint) => path.join(root, entrypoint));
  const visited = new Set();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    if (!fs.existsSync(current)) throw new Error(`Missing packaged source entrypoint: ${current}`);
    visited.add(current);
    const source = fs.readFileSync(current, "utf8");
    for (const specifier of extractLocalSpecifiers(source)) {
      const resolved = resolveLocalImport(root, current, specifier);
      if (resolved && !visited.has(resolved)) pending.push(resolved);
    }
  }
  for (const relative of DYNAMIC_PACKAGED_FILES) {
    const dynamicFile = path.join(root, relative);
    if (!fs.existsSync(dynamicFile)) throw new Error(`Missing packaged runtime file: ${relative}`);
    visited.add(dynamicFile);
  }
  return [...visited].sort();
}

function assertNoForbiddenContent(root, files, boundary) {
  const violations = [];
  for (const file of files) {
    const source = stripComments(fs.readFileSync(file, "utf8"));
    for (const [label, pattern] of FORBIDDEN) {
      if (pattern.test(source)) {
        violations.push(`${path.relative(root, file)} contains ${label}`);
      }
    }
  }
  if (violations.length > 0) {
    throw new Error(`${boundary} reaches forbidden Python server material:\n- ${violations.join("\n- ")}`);
  }
}

function assertPackagedElectronGraph(options = {}) {
  const root = path.resolve(options.root || ROOT);
  const sourceFiles = collectSourceGraph(root);
  assertNoForbiddenContent(root, sourceFiles, "Packaged Electron source graph");

  const requireDist = options.requireDist !== false;
  const distFiles = DIST_ENTRYPOINTS
    .map((relative) => path.join(root, relative))
    .filter((file) => fs.existsSync(file));
  if (requireDist && distFiles.length !== DIST_ENTRYPOINTS.length) {
    throw new Error(`Production Electron bundle missing; expected ${DIST_ENTRYPOINTS.join(", ")}`);
  }
  if (distFiles.length > 0) {
    assertNoForbiddenContent(root, distFiles, "Production Electron bundle");
  }

  for (const builderConfig of ["electron-builder.installer.yml", "electron-builder.archive.yml"]) {
    const source = fs.readFileSync(path.join(root, builderConfig), "utf8");
    if (/python-http-runtime-config/i.test(source)) {
      throw new Error(`${builderConfig} packages the transitional Python HTTP config`);
    }
  }

  return { sourceFiles, distFiles };
}

if (require.main === module) {
  const result = assertPackagedElectronGraph();
  console.log(
    `✓ packaged Electron graph is plugin-host only (${result.sourceFiles.length} source files, ${result.distFiles.length} bundles)`,
  );
}

module.exports = {
  assertPackagedElectronGraph,
  collectSourceGraph,
};
