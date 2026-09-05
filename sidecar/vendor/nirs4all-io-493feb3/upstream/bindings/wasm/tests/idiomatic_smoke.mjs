// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
// Smoke test for the idiomatic ESM wrapper. Build first:
//   wasm-pack build bindings/wasm --target nodejs --out-dir pkg
// then: node bindings/wasm/tests/idiomatic_smoke.mjs
import assert from "node:assert";
import * as nio from "../idiomatic.mjs";

// toSpec: a native JS object in, a canonical spec OBJECT out (no manual JSON).
const spec = nio.toSpec({
  name: "wasm-idiomatic",
  sources: [{ id: "x", role: "features", input: "x.csv" }],
});
assert.strictEqual(typeof spec, "object", "toSpec returns an object");
assert.strictEqual(spec.schema_version, 1, "schema_version is 1");

// validateSpec: the produced object passes; a bad object throws.
nio.validateSpec(spec);
assert.throws(() => nio.validateSpec({ partitions: { by: "random" } }), "bad spec throws");

assert.match(nio.version(), /^\d+\.\d+\.\d+/, "version looks like semver");

// inferFiles: object plan out, options defaulted.
const plan = nio.inferFiles([
  {
    name: "combined.csv",
    bytes: new TextEncoder().encode("sample_id;1000;1005;protein\ns1;0.1;0.2;11.2\ns2;0.3;0.4;12.5\n"),
  },
]);
assert.strictEqual(plan.structure.value, "single_combined", "structure inferred");
assert.ok(plan.resolved_spec.sources.length >= 1, "resolved spec sourced");

// assembleDataset accepts the resolved_spec OBJECT directly (wrapper stringifies).
const SIGNAL_WIDTH = 4;
const rec = (id) => ({
  signals: {
    signal: {
      values: Array.from({ length: SIGNAL_WIDTH }, (_, i) => i * 0.01),
      axis: { values: Array.from({ length: SIGNAL_WIDTH }, (_, i) => 1000 + i), unit: "nm" },
    },
  },
  metadata: { sample_id: id },
});
const records = [rec("s1"), rec("s2")];
const recPlan = nio.inferDataset([{ name: "nir.spc", bytes: new Uint8Array([0, 1]) }], [
  { source: "nir.spc", format: "galactic-spc", records },
]);
const assembled = nio.assembleDataset([], [{ source: "nir.spc", records }], recPlan.resolved_spec);
assert.strictEqual(assembled.blocks.train.n_samples, 2, "two assembled samples");
assert.strictEqual(assembled.blocks.train.x[0].n_cols, SIGNAL_WIDTH, "feature width");

// CSV bytes path: public assembleDataset must apply the native NA policy.
const assembledCsv = nio.assembleDataset(
  [{ name: "X.csv", bytes: new TextEncoder().encode("1000;1005\n1;\n2;3\n") }],
  [],
  {
    sources: [{
      id: "x",
      role: "features",
      input: "X.csv",
      params: { na: { policy: "replace", fill: { method: "value", fill_value: 7.0 } } },
    }],
  },
);
assert.strictEqual(assembledCsv.blocks.train.x[0].n_rows, 2, "CSV NA rows preserved");
assert.deepStrictEqual(assembledCsv.blocks.train.x[0].data, [1.0, 7.0, 2.0, 3.0], "CSV NA is replaced");

// proposeDataset is re-exported and returns the iterative result object.
const proposed = nio.proposeDataset(
  [
    { name: "Xcal.csv", bytes: new TextEncoder().encode("sample_id;1000;1005\ns1;0.1;0.2\ns2;0.2;0.3\n") },
    { name: "Ycal.csv", bytes: new TextEncoder().encode("sample_id;protein\ns1;11\ns2;12\n") },
  ],
  [],
);
assert.ok(Array.isArray(proposed.proposals), "proposals is an array");

// the raw string surface stays reachable through the wrapper.
assert.strictEqual(typeof nio.to_spec(JSON.stringify({ name: "r", sources: [{ id: "x", role: "features", input: "x.csv" }] })), "string");

console.log("wasm idiomatic smoke OK");
