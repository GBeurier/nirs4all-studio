// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
const fs = require("node:fs");
const assert = require("node:assert/strict");

if (process.argv.length !== 5) {
  throw new Error("usage: node wasm_identity.cjs <pkg-js> <csv> <spec>");
}
const wasm = require(process.argv[2]);
const csvPath = process.argv[3];
const specPath = process.argv[4];
const files = [{ name: "identity.csv", bytes: fs.readFileSync(csvPath) }];
const spec = fs.readFileSync(specPath, "utf8");
const full = wasm.assembleDataset(files, [], spec);
const output = wasm.loadSummary(files, [], spec);
const summary = JSON.parse(output);

// Refactoring the shared input decoder for loadSummary must not change the
// established full-value assembleDataset path.
assert.deepStrictEqual(full.identity, summary.identity, "identity provenance mismatch");
assert.deepStrictEqual(full.fold_provenance, summary.fold_provenance, "fold provenance mismatch");
for (const partition of Object.keys(summary.blocks)) {
  assert.deepStrictEqual(
    full.blocks[partition].source_ids,
    summary.blocks[partition].source_ids,
    `source ids mismatch in ${partition}`
  );
}
process.stdout.write(output);
