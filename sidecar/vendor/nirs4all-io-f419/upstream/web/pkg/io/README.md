<!-- SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later -->
# WASM binding (EPIC 11.4)

`wasm-bindgen` binding built with `wasm-pack`, backed directly by
`nirs4all-io-core` (the pure core, **not** the native filesystem facade). WASM
has no filesystem (D-R7), so this binding exposes the fs-free JSON surface and a
browser-oriented in-memory inference entry point.

A thin wrapper: every function just translates strings to/from the single Rust
core, identical to the other bindings.

## Exposed functions

```js
to_spec(spec_json)   // String -> canonical DatasetSpec JSON string
validate(spec_json)  // String -> undefined; throws when the spec is invalid
inferFiles(files, options) // [{name, bytes: Uint8Array}], {conventions?} -> DatasetPlan object
inferRecords(recordSets)   // decoded nirs4all-formats records -> DatasetPlan object
inferDataset(files, recordSets, options) // browser raw files + decoded records -> DatasetPlan object
proposeDataset(files, recordSets, options) // iterative builder: -> {plan, proposals, spec, valid, validation_errors}
assembleDataset(files, recordSets, specJson) // materialize a DatasetSpec -> AssembledDataset object
version()            // () -> crate version string (semver)
```

`to_spec` normalizes a spec/config JSON string into the canonical `DatasetSpec`
JSON. `validate` parses a `DatasetSpec` JSON string and throws on an invalid
spec. `inferFiles` runs the same convention / column-role / signal / task
inference over named byte buffers and returns a `DatasetPlan` with an editable
`resolved_spec`. `inferRecords` infers from the decoded spectral record shape
emitted by `nirs4all-formats`. `inferDataset` is the one-shot browser entry
point: it combines raw files and decoded records in Rust, keeping the page as a
thin UI.

`proposeDataset` is the **iterative** builder entry point. It post-processes
`inferDataset`: it synthesises a *provisional* source for each un-sourced tabular
file, applies the user's `options.confirmed` decisions (an array of
`{kind, target, value, status?}` *locks* over
structure/role/partition/identity/pairing/signal_type/task_type/folds — rewriting
the spec fields the assembler reads; `structure` is advisory), and returns the
still-open decisions as confirmable
`proposals` (each with `alternatives`, `evidence`, `score`, `ambiguous`),
including a pairing-by-row-count heuristic. Feed an accepted proposal back as a
`confirmed` lock and call it again to refine. `assembleDataset` materializes the
resulting `spec` into per-partition X/y/metadata blocks for a preview.

## Build & install

```bash
wasm-pack build bindings/wasm --target nodejs --out-dir pkg
```

This emits `bindings/wasm/pkg/` (the `nirs4all_io_wasm.js` module + the `.wasm`).
Require it from Node:

```js
const wasm = require("./bindings/wasm/pkg/nirs4all_io_wasm.js");
```

## Usage

```js
const wasm = require("./pkg/nirs4all_io_wasm.js");

const specJson = wasm.to_spec(JSON.stringify({
  name: "wasm-smoke",
  sources: [{ id: "x", role: "features", input: "x.csv" }],
}));

wasm.validate(specJson);   // ok; throws on an invalid spec
const plan = wasm.inferFiles([
  { name: "dataset.csv", bytes: new TextEncoder().encode("id;1000;1005;y\ns1;0.1;0.2;1\n") },
], {});
const browserPlan = wasm.inferDataset(
  [{ name: "scan.asd", bytes: new Uint8Array([0, 1, 2, 3]) }],
  [{
    source: "scan.asd",
    format: "asd-fieldspec",
    records: [{
      signals: { absorbance: { values: [0.1, 0.2], axis: { values: [1000, 1005], unit: "nm" } } },
      targets: { protein: 12.4 },
      metadata: { sample_id: "s1" },
    }],
  }],
  {}
);
console.log(wasm.version());
```

## Test

```bash
wasm-pack build bindings/wasm --target nodejs --out-dir pkg
node bindings/wasm/tests/node_smoke.cjs
```
