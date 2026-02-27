#!/usr/bin/env node
/**
 * Curate Canonical Nodes
 *
 * Reads the auto-generated canonical registry and produces curated definition
 * JSON files for nodes not already in curated definitions.
 *
 * - Excludes noise params (copy, verbose, n_jobs, etc.)
 * - Promotes primary params (no isAdvanced)
 * - Converts string params to select where appropriate
 * - Assigns tiers based on rules
 * - Adds finetuning metadata for key params
 * - Skips known duplicates
 *
 * Usage:
 *   node scripts/curate-canonical-nodes.cjs [--dry-run] [--stats]
 */

const fs = require("fs");
const path = require("path");

const RULES_PATH = path.join(__dirname, "curation-rules.json");
const CANONICAL_PATH = path.join(
  __dirname,
  "..",
  "src",
  "data",
  "nodes",
  "generated",
  "canonical-registry.json"
);
const DEFS_DIR = path.join(
  __dirname,
  "..",
  "src",
  "data",
  "nodes",
  "definitions"
);

const DRY_RUN = process.argv.includes("--dry-run");
const STATS_ONLY = process.argv.includes("--stats");

// ============================================================================
// Load data
// ============================================================================

const rules = JSON.parse(fs.readFileSync(RULES_PATH, "utf-8"));
const canonical = JSON.parse(fs.readFileSync(CANONICAL_PATH, "utf-8"));

// Collect all curated node IDs and classPaths
function loadCuratedNodes() {
  const nodes = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".json")) {
        try {
          const data = JSON.parse(fs.readFileSync(full, "utf-8"));
          if (Array.isArray(data)) {
            for (const n of data) {
              n._sourceFile = path.relative(DEFS_DIR, full);
            }
            nodes.push(...data);
          }
        } catch (e) {
          // skip non-JSON
        }
      }
    }
  }
  walk(DEFS_DIR);
  return nodes;
}

const curatedNodes = loadCuratedNodes();
const curatedIds = new Set(curatedNodes.map((n) => n.id));
const curatedClassPaths = new Set();
for (const cn of curatedNodes) {
  if (cn.classPath) curatedClassPaths.add(cn.classPath);
  if (cn.legacyClassPaths) {
    cn.legacyClassPaths.forEach((lp) => curatedClassPaths.add(lp));
  }
}

// Build duplicate map
const duplicateMap = rules.duplicateMap || {};

// Build tier lookup
const tierLookup = {};
for (const [tier, ids] of Object.entries(rules.tierAssignments || {})) {
  if (tier.startsWith("$")) continue;
  for (const id of ids) {
    tierLookup[id] = tier;
  }
}

// ============================================================================
// Curation logic
// ============================================================================

function shouldExcludeParam(paramName) {
  return rules.excludeParams.includes(paramName);
}

function isAlwaysAdvanced(paramName) {
  return rules.alwaysAdvanced.includes(paramName);
}

function isPrimaryParam(paramName, nodeType) {
  const primaries = rules.primaryParams[nodeType] || [];
  return primaries.includes(paramName);
}

function getTypeConversion(paramName) {
  return rules.typeConversions[paramName] || null;
}

function getFinetuningRule(paramName) {
  return rules.finetuningRules[paramName] || null;
}

function curateParam(param, nodeType) {
  const name = param.name;

  // Exclude noise params
  if (shouldExcludeParam(name)) return null;

  const curated = {
    name: name,
    type: param.type,
  };

  // Copy default
  if (param.default != null) curated.default = param.default;

  // Copy description
  if (param.description) curated.description = param.description;

  // Copy min/max
  if (param.min != null) curated.min = param.min;
  if (param.max != null) curated.max = param.max;
  if (param.step != null) curated.step = param.step;

  // Check type conversion (string → select)
  const conversion = getTypeConversion(name);
  if (conversion && (param.type === "string" || param.type === "select")) {
    curated.type = "select";
    curated.options = conversion.options;
  }

  // Copy existing options for select types
  if (param.type === "select" && param.options && !curated.options) {
    curated.options = param.options;
  }

  // Determine visibility
  if (isAlwaysAdvanced(name)) {
    curated.isAdvanced = true;
  } else if (!isPrimaryParam(name, nodeType)) {
    curated.isAdvanced = true;
  }
  // Primary params have no isAdvanced flag (visible by default)

  // Check finetuning
  const ftRule = getFinetuningRule(name);
  if (ftRule && !curated.isAdvanced) {
    curated.finetunable = true;
    curated.finetuneType = ftRule.finetuneType;
    // Constrain finetune range within param min/max
    let ftMin = ftRule.range[0];
    let ftMax = ftRule.range[1];
    if (curated.min != null) ftMin = Math.max(ftMin, curated.min);
    if (curated.max != null) ftMax = Math.min(ftMax, curated.max);
    curated.finetuneRange = [ftMin, ftMax];
  }

  // Mark as sweepable if it's a primary numeric param
  if (
    !curated.isAdvanced &&
    (curated.type === "int" || curated.type === "float") &&
    isPrimaryParam(name, nodeType)
  ) {
    curated.sweepable = true;
  }

  return curated;
}

function curateNode(canonicalNode) {
  const id = canonicalNode.id;
  const nodeType = canonicalNode.type;

  // Curate parameters
  const params = (canonicalNode.parameters || [])
    .map((p) => curateParam(p, nodeType))
    .filter(Boolean);

  // Determine tier
  const tier = tierLookup[id] || "advanced";

  // Check if any params are finetunable
  const hasFinetuning = params.some((p) => p.finetunable);

  // Check if any params are sweepable
  const hasSweeps = params.some((p) => p.sweepable);

  const node = {
    id: id,
    name: canonicalNode.name,
    type: nodeType,
    classPath: canonicalNode.classPath,
    description: canonicalNode.description,
  };

  if (canonicalNode.longDescription) {
    node.longDescription = canonicalNode.longDescription;
  }

  node.category = canonicalNode.category;
  node.tags = canonicalNode.tags || [];
  node.source = canonicalNode.source;
  node.tier = tier;
  node.parameters = params;

  if (hasFinetuning) {
    node.supportsFinetuning = true;
  }
  if (hasSweeps) {
    node.supportsParameterSweeps = true;
  }

  return node;
}

// ============================================================================
// Process all canonical nodes
// ============================================================================

function isAlreadyCurated(canonicalNode) {
  // 1. Exact ID match
  if (curatedIds.has(canonicalNode.id)) return true;
  // 2. ClassPath match
  if (curatedClassPaths.has(canonicalNode.classPath)) return true;
  // 3. Known duplicate
  if (duplicateMap[canonicalNode.id]) return true;
  return false;
}

const newNodes = [];
const skippedDuplicate = [];
const skippedExisting = [];

for (const cn of canonical) {
  if (isAlreadyCurated(cn)) {
    if (duplicateMap[cn.id]) {
      skippedDuplicate.push(cn.id + " → " + duplicateMap[cn.id]);
    } else {
      skippedExisting.push(cn.id);
    }
    continue;
  }

  const curated = curateNode(cn);
  newNodes.push(curated);
}

// ============================================================================
// Group by output file
// ============================================================================

const fileMapping = rules.outputFileMapping || {};

function getOutputFile(node) {
  const key = node.type + "/" + node.category;
  const mapped = fileMapping[key];
  if (mapped) return mapped;

  // Fallback: type/misc
  if (node.type === "model") return "models/sklearn-misc.json";
  if (node.type === "preprocessing") return "preprocessing/sklearn-misc.json";
  if (node.type === "splitting") return "splitting/sklearn-splitters.json";
  if (node.type === "y_processing") return "y-processing/scalers.json";
  return node.type + "/misc.json";
}

const byFile = {};
for (const node of newNodes) {
  const file = getOutputFile(node);
  if (!byFile[file]) byFile[file] = [];
  byFile[file].push(node);
}

// ============================================================================
// Output
// ============================================================================

console.log("=== Canonical Node Curation ===\n");
console.log(`Canonical total: ${canonical.length}`);
console.log(`Already curated: ${skippedExisting.length} (by ID/classPath)`);
console.log(`Known duplicates: ${skippedDuplicate.length}`);
console.log(`New nodes to generate: ${newNodes.length}`);
console.log(`Total after merge: ${curatedNodes.length + newNodes.length}`);
console.log();

if (STATS_ONLY) {
  // Print stats by type
  const byType = {};
  for (const n of newNodes) {
    byType[n.type] = (byType[n.type] || 0) + 1;
  }
  console.log("New nodes by type:");
  for (const [type, count] of Object.entries(byType).sort()) {
    console.log(`  ${type}: ${count}`);
  }
  console.log();

  // Print by tier
  const byTier = {};
  for (const n of newNodes) {
    byTier[n.tier] = (byTier[n.tier] || 0) + 1;
  }
  console.log("New nodes by tier:");
  for (const [tier, count] of Object.entries(byTier).sort()) {
    console.log(`  ${tier}: ${count}`);
  }
  console.log();

  // Print by output file
  console.log("Output files:");
  for (const [file, nodes] of Object.entries(byFile).sort()) {
    console.log(`  ${file}: ${nodes.length} nodes`);
  }
  console.log();

  // Print duplicates
  if (skippedDuplicate.length > 0) {
    console.log("Skipped duplicates:");
    for (const d of skippedDuplicate) {
      console.log(`  ${d}`);
    }
  }
  process.exit(0);
}

if (DRY_RUN) {
  console.log("[DRY RUN] Would write files:\n");
  for (const [file, nodes] of Object.entries(byFile).sort()) {
    console.log(`  ${file}: ${nodes.length} nodes`);
    for (const n of nodes) {
      const ftCount = n.parameters.filter((p) => p.finetunable).length;
      const swCount = n.parameters.filter((p) => p.sweepable).length;
      console.log(
        `    ${n.id} (${n.name}) [${n.tier}] params=${n.parameters.length} ft=${ftCount} sw=${swCount}`
      );
    }
  }
  process.exit(0);
}

// Write files - MERGE with existing curated files where they exist
let filesWritten = 0;
let filesCreated = 0;
let nodesWritten = 0;

for (const [relFile, nodes] of Object.entries(byFile).sort()) {
  const fullPath = path.join(DEFS_DIR, relFile);
  const dir = path.dirname(fullPath);

  // Ensure directory exists
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Check if file already exists - if so, merge
  let existingNodes = [];
  if (fs.existsSync(fullPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
      if (Array.isArray(data)) {
        existingNodes = data;
      }
    } catch (e) {
      console.warn(`Warning: Could not parse existing ${relFile}: ${e.message}`);
    }
  }

  // Merge: existing nodes first, then new ones (no ID conflicts)
  const existingIds = new Set(existingNodes.map((n) => n.id));
  const mergedNodes = [
    ...existingNodes,
    ...nodes.filter((n) => !existingIds.has(n.id)),
  ];

  const added = mergedNodes.length - existingNodes.length;
  if (added === 0) {
    console.log(`  SKIP ${relFile} (all ${nodes.length} nodes already present)`);
    continue;
  }

  fs.writeFileSync(fullPath, JSON.stringify(mergedNodes, null, 2) + "\n", "utf-8");

  if (existingNodes.length > 0) {
    console.log(
      `  MERGE ${relFile}: ${existingNodes.length} existing + ${added} new = ${mergedNodes.length}`
    );
  } else {
    console.log(`  CREATE ${relFile}: ${mergedNodes.length} nodes`);
    filesCreated++;
  }
  filesWritten++;
  nodesWritten += added;
}

console.log(
  `\nDone: ${nodesWritten} nodes written to ${filesWritten} files (${filesCreated} new files)`
);
console.log(
  `Total curated nodes: ${curatedNodes.length + nodesWritten}`
);
