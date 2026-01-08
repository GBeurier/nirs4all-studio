#!/usr/bin/env node
/**
 * Lightweight regression check for node registries (Milestone 6).
 *
 * Compares a small snapshot of counts-by-type for:
 * - Curated definitions in src/data/nodes/definitions/**
 * - Extended registry in public/node-registry/extended.json (if present)
 *
 * Usage:
 *   node scripts/check-registry-snapshot.cjs          # validate against snapshot
 *   node scripts/check-registry-snapshot.cjs --update # write snapshot
 */

const fs = require("fs");
const path = require("path");

const repoRoot = path.join(__dirname, "..");
const curatedDir = path.join(repoRoot, "src", "data", "nodes", "definitions");
const extendedPath = path.join(repoRoot, "public", "node-registry", "extended.json");
const snapshotPath = path.join(repoRoot, "scripts", "registry-stats.snapshot.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function isJsonFile(name) {
  return name.endsWith(".json") && !name.includes("schema");
}

function listJsonFilesRecursive(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listJsonFilesRecursive(full));
    } else if (entry.isFile() && isJsonFile(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

function countNodes(nodes) {
  const byType = {};
  for (const n of nodes) {
    const type = n?.type;
    if (typeof type !== "string") continue;
    byType[type] = (byType[type] ?? 0) + 1;
  }
  return {
    total: nodes.length,
    byType,
  };
}

function loadCuratedStats() {
  if (!fs.existsSync(curatedDir)) {
    return { total: 0, byType: {} };
  }

  const files = listJsonFilesRecursive(curatedDir);
  const all = [];
  for (const file of files) {
    const data = readJson(file);
    if (Array.isArray(data)) {
      all.push(...data);
    } else if (data && typeof data === "object") {
      all.push(data);
    }
  }
  return countNodes(all);
}

function loadExtendedStats() {
  if (!fs.existsSync(extendedPath)) {
    return null;
  }
  const data = readJson(extendedPath);
  if (!Array.isArray(data)) {
    throw new Error("public/node-registry/extended.json must be an array");
  }
  return countNodes(data);
}

function stableStringify(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort(), 2);
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function main() {
  const update = process.argv.includes("--update");

  const curated = loadCuratedStats();
  const extended = loadExtendedStats();

  const snapshot = {
    curated,
    extended,
  };

  if (update) {
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
    console.log(`✅ Wrote snapshot: ${path.relative(repoRoot, snapshotPath)}`);
    console.log(`   Curated total: ${curated.total}`);
    console.log(`   Extended total: ${extended?.total ?? 0}`);
    process.exit(0);
  }

  if (!fs.existsSync(snapshotPath)) {
    console.log(`ℹ️ Snapshot not found: ${path.relative(repoRoot, snapshotPath)}`);
    console.log("Run: node scripts/check-registry-snapshot.cjs --update");
    process.exit(1);
  }

  const expected = readJson(snapshotPath);

  if (!deepEqual(expected, snapshot)) {
    console.log("❌ Registry snapshot mismatch");
    console.log(`Expected: ${path.relative(repoRoot, snapshotPath)}`);
    console.log("\n--- expected ---\n" + JSON.stringify(expected, null, 2));
    console.log("\n--- actual ---\n" + JSON.stringify(snapshot, null, 2));
    process.exit(1);
  }

  console.log("✅ Registry snapshot OK");
  console.log(`   Curated total: ${curated.total}`);
  console.log(`   Extended total: ${extended?.total ?? 0}`);
  process.exit(0);
}

main();
