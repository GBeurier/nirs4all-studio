#!/usr/bin/env node
/**
 * Fails when the bundled UI locales (en, fr) do not expose the same key set.
 *
 * Locale modules are plain TypeScript objects (`const <lng> = {...}; export
 * default <lng>;`), so they are transpiled with the project's TypeScript and
 * evaluated in isolation.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "..");
const localesRoot = path.join(projectRoot, "src", "locales");
const bundledLocales = ["en", "fr"];

function loadLocale(code) {
  const source = fs.readFileSync(path.join(localesRoot, code, "index.ts"), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const sandbox = { exports: {}, module: { exports: {} } };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(outputText, sandbox);
  return sandbox.module.exports.default;
}

function flattenKeys(node, prefix, keys) {
  for (const [key, value] of Object.entries(node)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      flattenKeys(value, fullKey, keys);
    } else {
      keys.add(fullKey);
    }
  }
  return keys;
}

const keySets = new Map(bundledLocales.map((code) => [code, flattenKeys(loadLocale(code), "", new Set())]));
const [baseCode, ...otherCodes] = bundledLocales;
const baseKeys = keySets.get(baseCode);
let failed = false;

for (const code of otherCodes) {
  const keys = keySets.get(code);
  const missing = [...baseKeys].filter((key) => !keys.has(key));
  const extra = [...keys].filter((key) => !baseKeys.has(key));
  if (missing.length > 0 || extra.length > 0) {
    failed = true;
    console.error(`Locale "${code}" differs from "${baseCode}":`);
    for (const key of missing) console.error(`  missing in ${code}: ${key}`);
    for (const key of extra) console.error(`  missing in ${baseCode}: ${key}`);
  }
}

if (failed) {
  process.exit(1);
}
console.log(`Locale keys OK (${bundledLocales.join(", ")}: ${baseKeys.size} keys).`);
