#!/usr/bin/env node
/**
 * Generate the n4m node registry from the native method manifest.
 *
 * The checked-in manifest (src/data/nodes/generated/n4m-manifest.json, the
 * `n4m_cli --manifest-json` output) is projected through nirs4all-ui's
 * `projectN4mManifest` into NodeDefinition[] nodes whose classPath is the
 * portable `n4m:<method_id>` token.
 *
 * Usage:
 *   node scripts/generate-n4m-registry.mjs                  # regenerate the registry
 *   node scripts/generate-n4m-registry.mjs --cli <n4m_cli>  # refresh the manifest first
 *   node scripts/generate-n4m-registry.mjs --check          # fail on drift (manifest too with --cli)
 * `N4M_CLI` may replace --cli.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectN4mManifest } from "nirs4all-ui/nodeRegistry";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generatedDir = path.join(repoRoot, "src", "data", "nodes", "generated");
const manifestPath = path.join(generatedDir, "n4m-manifest.json");
const registryPath = path.join(generatedDir, "n4m-registry.json");
const metaPath = path.join(generatedDir, "n4m-registry.meta.json");

const args = process.argv.slice(2);
const check = args.includes("--check");
const cliFlag = args.indexOf("--cli");
const cli = cliFlag >= 0 ? path.resolve(args[cliFlag + 1]) : process.env.N4M_CLI;

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

const outputs = new Map();
if (cli) {
  const manifest = JSON.parse(execFileSync(cli, ["--manifest-json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
  outputs.set(manifestPath, json(manifest));
}
const manifest = JSON.parse(outputs.get(manifestPath) ?? readFileSync(manifestPath, "utf8"));

// Names get an "(n4m)" suffix: the editor keys steps by type + name, and several
// n4m methods share a name with the Python nirs4all/sklearn operators.
const nodes = projectN4mManifest(manifest).map((node) => ({ ...node, name: `${node.name} (n4m)` }));
const countsByType = {};
for (const node of nodes) countsByType[node.type] = (countsByType[node.type] ?? 0) + 1;

outputs.set(registryPath, json(nodes));
outputs.set(metaPath, json({
  nodeCount: nodes.length,
  abi: manifest.abi,
  generator: { script: "scripts/generate-n4m-registry.mjs", format: "NodeDefinition[]" },
  countsByType,
}));

let stale = false;
for (const [file, text] of outputs) {
  const rel = path.relative(repoRoot, file);
  if (check) {
    let current = null;
    try {
      current = readFileSync(file, "utf8");
    } catch {
      current = null;
    }
    if (current !== text) {
      stale = true;
      console.error(`✗ ${rel} is stale — run node scripts/generate-n4m-registry.mjs${file === manifestPath ? " --cli <n4m_cli>" : ""}`);
    }
  } else {
    writeFileSync(file, text);
    console.log(`Wrote ${rel}`);
  }
}
if (stale) process.exit(1);
if (check) console.log(`✅ n4m registry in sync (ABI ${manifest.abi}, ${nodes.length} nodes)`);
