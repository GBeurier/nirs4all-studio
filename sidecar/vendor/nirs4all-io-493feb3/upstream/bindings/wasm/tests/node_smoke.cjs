// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
// Node smoke test for the wasm binding. Build first:
//   wasm-pack build bindings/wasm --target nodejs --out-dir pkg
// then: node bindings/wasm/tests/node_smoke.cjs
const assert = require("node:assert");
const wasm = require("../pkg/nirs4all_io_wasm.js");

// to_spec: normalize a minimal config dict into a canonical DatasetSpec.
const specJson = wasm.to_spec(
  JSON.stringify({ name: "wasm-smoke", sources: [{ id: "x", role: "features", input: "x.csv" }] })
);
assert.ok(specJson.endsWith("\n"), "canonical JSON ends with a newline");
const spec = JSON.parse(specJson);
assert.strictEqual(spec.schema_version, 1, "schema_version is 1");

// validate: the produced spec passes; a bad partition mode throws.
wasm.validate(specJson);
assert.throws(() => wasm.validate(JSON.stringify({ partitions: { by: "random" } })));

assert.match(wasm.version(), /^\d+\.\d+\.\d+/, "version looks like semver");

// inferFiles: browser/no-fs inference from named Uint8Array files.
const plan = wasm.inferFiles(
  [
    {
      name: "combined.csv",
      bytes: new TextEncoder().encode(
        "sample_id;1000;1005;protein;batch\ns1;0.10;0.20;11.2;A\ns2;0.30;0.40;12.5;B\n"
      ),
    },
  ],
  {}
);
assert.strictEqual(plan.structure.value, "single_combined");
assert.ok(plan.resolved_spec.sources.length >= 1, "resolved spec has sources");
assert.ok(plan.columns[0].column_roles.length >= 1, "column roles were inferred");

// inferDataset: browser orchestration is implemented in Rust, not in the page.
const browserPlan = wasm.inferDataset(
  [{ name: "scan.asd", bytes: new Uint8Array([0, 1, 2, 3]) }],
  [{
    source: "scan.asd",
    format: "asd-fieldspec",
    records: [{
      signals: {
        absorbance: {
          values: [0.1, 0.2, 0.3],
          axis: { values: [1000, 1005, 1010], unit: "nm" },
        },
      },
      targets: { protein: 12.4 },
      metadata: { sample_id: "s1" },
    }],
  }],
  {}
);
assert.strictEqual(browserPlan.input.selected_inference, "decoded_records");
assert.strictEqual(browserPlan.resolved_spec.sources[0].role, "mixed");

// assembleDataset: feed inferDataset(...).resolved_spec straight back into the
// fs-free assembler. A 700-wide galactic nir.spc record (signal + metadata, no
// targets) must materialize to X whose width == the signal width (no sample_id /
// metadata leak into the features). Codex #3 regression guard.
const SIGNAL_WIDTH = 700;
const wideRecord = (sampleId) => ({
  signals: {
    signal: {
      values: Array.from({ length: SIGNAL_WIDTH }, (_, i) => i * 0.001),
      axis: {
        values: Array.from({ length: SIGNAL_WIDTH }, (_, i) => 1000 + i),
        unit: "nm",
      },
    },
  },
  metadata: { sample_id: sampleId, galactic_spc: true, galactic_spc_log: "ok" },
});
const spcRecords = [wideRecord("s1"), wideRecord("s2"), wideRecord("s3")];
const spcPlan = wasm.inferDataset(
  [{ name: "nir.spc", bytes: new Uint8Array([0, 1, 2, 3]) }],
  [{ source: "nir.spc", format: "galactic-spc", records: spcRecords }],
  {}
);
const assembled = wasm.assembleDataset(
  [],
  [{ source: "nir.spc", records: spcRecords }],
  JSON.stringify(spcPlan.resolved_spec)
);
// assembleDataset returns the full-value shape: blocks[part].x = [{data, n_rows,
// n_cols}], metadata = {n_rows, columns: [{name, values}]}.
assert.strictEqual(assembled.assembled_schema_version, 2, "assembled wire is explicitly v2");
const block = assembled.blocks.train;
assert.strictEqual(block.n_samples, 3, "three assembled samples");
assert.strictEqual(
  block.x[0].n_cols,
  SIGNAL_WIDTH,
  "feature count equals the signal width (no metadata/id leak)"
);
assert.strictEqual(
  block.feature_headers[0].length,
  SIGNAL_WIDTH,
  "feature headers count equals the signal width"
);
assert.ok(
  !block.feature_headers[0].includes("sample_id"),
  "sample_id is identity, never a feature"
);
const metaCols = (block.metadata ? block.metadata.columns : []).map((c) => c.name);
assert.ok(metaCols.includes("galactic_spc"), "metadata frame is populated");
assert.ok(metaCols.includes("sample_id"), "sample_id identity is retained as metadata");
assert.ok(!block.y, "no targets => no y");

// CSV/tabular bytes path: assembleDataset applies the same native NA policy in
// the fs-free core as the native facade and Python binding.
const assembledCsv = wasm.assembleDataset(
  [{ name: "X.csv", bytes: new TextEncoder().encode("1000;1005\n1;\n2;3\n") }],
  [],
  JSON.stringify({
    sources: [{
      id: "x",
      role: "features",
      input: "X.csv",
      params: { na: { policy: "replace", fill: { method: "value", fill_value: 7.0 } } },
    }],
  })
);
const csvBlock = assembledCsv.blocks.train;
assert.strictEqual(csvBlock.x[0].n_rows, 2, "CSV NA rows preserved");
assert.deepStrictEqual(csvBlock.x[0].data, [1.0, 7.0, 2.0, 3.0], "CSV NA is replaced");
const summaryCsv = JSON.parse(wasm.loadSummary(
  [{ name: "X.csv", bytes: new TextEncoder().encode("1000;1005\n1;\n2;3\n") }],
  [],
  JSON.stringify({
    sources: [{
      id: "x",
      role: "features",
      input: "X.csv",
      params: { na: { policy: "replace", fill: { method: "value", fill_value: 7.0 } } },
    }],
  })
));
assert.strictEqual(summaryCsv.assembled_schema_version, 2, "summary wire is explicitly v2");
assert.deepStrictEqual(summaryCsv.blocks.train.source_ids, ["x"], "summary preserves source ids");

// proposeDataset: iterative builder surface. An X/y pair sharing sample_id ->
// the proposal layer surfaces a pairing decision; confirming it as a join writes
// a SourceSpec.join and suppresses the open proposal.
const xCsv = {
  name: "Xcal.csv",
  bytes: new TextEncoder().encode(
    "sample_id;1000;1005;1010\ns1;0.1;0.2;0.3\ns2;0.2;0.3;0.4\ns3;0.3;0.4;0.5\n"
  ),
};
const yCsv = {
  name: "Ycal.csv",
  bytes: new TextEncoder().encode("sample_id;protein\ns1;11\ns2;12\ns3;13\n"),
};
const proposed = wasm.proposeDataset([xCsv, yCsv], [], {});
assert.ok(Array.isArray(proposed.proposals), "proposals is an array");
assert.ok(proposed.spec.sources.length >= 2, "X and y are both sourced");
const pairing = proposed.proposals.find((p) => p.kind === "pairing");
assert.ok(pairing, "a pairing decision is proposed");
assert.strictEqual(pairing.value.mode, "join_id", "shared sample_id => join_id");

// Confirm the pairing -> the joined source carries a join, and the open pairing
// proposal is gone (it returns as a status:'confirmed' echo instead).
const confirmed = wasm.proposeDataset([xCsv, yCsv], [], {
  confirmed: [{ kind: "pairing", target: pairing.target, value: { mode: "join_id", on: "sample_id" } }],
});
const hasJoin = confirmed.spec.sources.some((s) => s.join);
assert.ok(hasJoin, "join_id lock writes a SourceSpec.join");
const stillOpen = confirmed.proposals.some(
  (p) => p.kind === "pairing" && p.target === pairing.target && p.status === "proposed"
);
assert.ok(!stillOpen, "the confirmed pairing proposal is suppressed");

console.log("wasm node smoke OK");
