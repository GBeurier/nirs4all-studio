#!/usr/bin/env node
/**
 * Generate node reference documents from curated definitions.
 *
 * Produces:
 *   - src/data/nodes/generated/node-reference.json (machine-readable)
 *   - docs/node-reference.md (human-readable)
 *
 * Usage:
 *   node scripts/generate-node-reference.cjs
 */

const fs = require("fs");
const path = require("path");

const DEFS_DIR = path.join(__dirname, "..", "src", "data", "nodes", "definitions");
const JSON_OUT = path.join(__dirname, "..", "src", "data", "nodes", "generated", "node-reference.json");
const MD_OUT = path.join(__dirname, "..", "docs", "node-reference.md");

// Load all definition JSON files
function loadAllNodes() {
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
            nodes.push(...data);
          }
        } catch (e) {
          console.error(`Error reading ${full}: ${e.message}`);
        }
      }
    }
  }
  walk(DEFS_DIR);
  return nodes;
}

// Group nodes by type
function groupByType(nodes) {
  const groups = {};
  for (const node of nodes) {
    if (!groups[node.type]) groups[node.type] = [];
    groups[node.type].push(node);
  }
  return groups;
}

// Generate JSON reference
function generateJSON(nodes) {
  const ref = {
    version: "2.0.0",
    generatedAt: new Date().toISOString().split("T")[0],
    totalNodes: nodes.length,
    stats: {},
    nodes: [],
  };

  const groups = groupByType(nodes);
  for (const [type, typeNodes] of Object.entries(groups)) {
    ref.stats[type] = {
      count: typeNodes.length,
      withFinetuning: typeNodes.filter((n) => n.supportsFinetuning).length,
      withSweepPresets: typeNodes.filter((n) =>
        n.parameters?.some((p) => p.sweepPresets?.length)
      ).length,
    };
  }

  for (const node of nodes) {
    const entry = {
      id: node.id,
      name: node.name,
      type: node.type,
      classPath: node.classPath,
      description: node.description,
      source: node.source,
      tier: node.tier || "standard",
      category: node.category,
      supportsFinetuning: !!node.supportsFinetuning,
      supportsParameterSweeps: !!node.supportsParameterSweeps,
      parameters: (node.parameters || []).map((p) => {
        const param = {
          name: p.name,
          type: p.type,
          default: p.default,
          description: p.description,
        };
        if (p.min != null) param.min = p.min;
        if (p.max != null) param.max = p.max;
        if (p.options) param.options = p.options.map((o) => (typeof o === "object" ? o.value : o));
        if (p.isAdvanced) param.isAdvanced = true;
        if (p.sweepable) param.sweepable = true;
        if (p.finetunable) {
          param.finetunable = true;
          param.finetuneType = p.finetuneType;
          param.finetuneRange = p.finetuneRange;
        }
        if (p.sweepPresets) {
          param.sweepPresets = p.sweepPresets.map((sp) => ({
            label: sp.label,
            type: sp.type,
            values: sp.values,
          }));
        }
        return param;
      }),
    };
    ref.nodes.push(entry);
  }

  return ref;
}

// Generate Markdown reference
function generateMarkdown(nodes) {
  const TYPE_ORDER = [
    "preprocessing",
    "model",
    "splitting",
    "augmentation",
    "y_processing",
    "filter",
    "flow",
    "utility",
  ];
  const TYPE_LABELS = {
    preprocessing: "Preprocessing",
    model: "Models",
    splitting: "Splitting",
    augmentation: "Augmentation",
    y_processing: "Y-Processing",
    filter: "Filters",
    flow: "Flow Control",
    utility: "Utilities",
  };

  const groups = groupByType(nodes);
  const totalFinetuning = nodes.filter((n) => n.supportsFinetuning).length;
  const totalSweepPresets = nodes.filter((n) =>
    n.parameters?.some((p) => p.sweepPresets?.length)
  ).length;

  let md = `# Node Reference\n\n`;
  md += `> Auto-generated from curated node definitions. ${nodes.length} nodes total.\n\n`;

  // Summary table
  md += `## Summary\n\n`;
  md += `| Type | Count | With Finetuning | With Sweep Presets |\n`;
  md += `|------|-------|-----------------|---------|\n`;
  for (const type of TYPE_ORDER) {
    const g = groups[type] || [];
    const ft = g.filter((n) => n.supportsFinetuning).length;
    const sp = g.filter((n) =>
      n.parameters?.some((p) => p.sweepPresets?.length)
    ).length;
    md += `| ${TYPE_LABELS[type] || type} | ${g.length} | ${ft} | ${sp} |\n`;
  }
  md += `| **Total** | **${nodes.length}** | **${totalFinetuning}** | **${totalSweepPresets}** |\n\n`;

  // Detailed sections by type
  for (const type of TYPE_ORDER) {
    const typeNodes = groups[type];
    if (!typeNodes || typeNodes.length === 0) continue;

    md += `---\n\n## ${TYPE_LABELS[type] || type}\n\n`;

    // Group by category within type
    const byCategory = {};
    for (const node of typeNodes) {
      const cat = node.category || "Other";
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(node);
    }

    for (const [category, catNodes] of Object.entries(byCategory)) {
      md += `### ${category}\n\n`;
      md += `| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |\n`;
      md += `|------|--------|------|---------------|------------|--------|\n`;

      for (const node of catNodes) {
        const params = (node.parameters || [])
          .filter((p) => !p.isAdvanced && !p.isHidden)
          .map((p) => {
            let s = `\`${p.name}\``;
            if (p.type === "select" && p.options) {
              s += ` (${p.options.map((o) => (typeof o === "object" ? o.value : o)).join("/")})`;
            } else if (p.default != null) {
              s += `=${p.default}`;
            }
            return s;
          });
        const paramStr = params.length > 0 ? params.join(", ") : "-";

        const ftParams = (node.parameters || []).filter((p) => p.finetunable);
        const ftStr = ftParams.length > 0
          ? ftParams.map((p) => `\`${p.name}\` [${p.finetuneRange?.join("-")}]`).join(", ")
          : "-";

        const spParams = (node.parameters || []).filter(
          (p) => p.sweepPresets?.length
        );
        const spStr = spParams.length > 0
          ? spParams.map((p) => `\`${p.name}\``).join(", ")
          : "-";

        md += `| **${node.name}** | ${node.source} | ${node.tier || "standard"} | ${paramStr} | ${ftStr} | ${spStr} |\n`;
      }
      md += `\n`;
    }
  }

  md += `---\n\n*Generated on ${new Date().toISOString().split("T")[0]}*\n`;
  return md;
}

// Main
const nodes = loadAllNodes();
console.log(`Loaded ${nodes.length} nodes`);

const jsonRef = generateJSON(nodes);
fs.writeFileSync(JSON_OUT, JSON.stringify(jsonRef, null, 2), "utf-8");
console.log(`JSON reference written to ${JSON_OUT}`);

const mdRef = generateMarkdown(nodes);
fs.writeFileSync(MD_OUT, mdRef, "utf-8");
console.log(`Markdown reference written to ${MD_OUT}`);

// Print stats
const groups = groupByType(nodes);
for (const [type, typeNodes] of Object.entries(groups).sort()) {
  const ft = typeNodes.filter((n) => n.supportsFinetuning).length;
  console.log(`  ${type}: ${typeNodes.length} nodes (${ft} with finetuning)`);
}
