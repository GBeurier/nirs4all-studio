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
loadSummary(files, recordSets, specJson) // canonical native structural summary JSON
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

## TypeScript types

wasm-bindgen types every `JsValue` parameter/return as `any`. Hand-written types
in [`types/nirs4all-io.d.ts`](types/nirs4all-io.d.ts) give the real shapes
(`NamedFile`, `RecordSet`, `InferOptions`, `ProposeOptions`, `DatasetPlan`,
`DatasetSpec`, `Proposal`, `ProposeResult`, `AssembledDataset`) and typed views
of every export, so call sites are checked by `tsc`.

## Idiomatic ESM wrapper

[`idiomatic.mjs`](idiomatic.mjs) (typed by [`idiomatic.d.ts`](idiomatic.d.ts)) is
a thin, dependency-free wrapper over the wasm-pack module. The object-returning
entry points (`inferFiles` / `inferRecords` / `inferDataset` / `proposeDataset` /
`assembleDataset`) are re-exported with default options; the string-JSON surface
gains native-JS conveniences `toSpec` (object → canonical spec **object**) and
`validateSpec` (object in; throws when invalid). `assembleDataset` also accepts a
spec **object** directly. The raw `to_spec` / `validate` string functions stay
reachable for the cross-binding JSON contract.

```js
import * as nio from "@nirs4all/io-wasm/idiomatic";
const spec = nio.toSpec({ name: "run", sources: [{ id: "x", role: "features", input: "x.csv" }] });
nio.validateSpec(spec);                         // throws on an invalid spec
const plan = nio.inferFiles(files);             // options default to {}
const ds = nio.assembleDataset([], recordSets, plan.resolved_spec); // object spec OK
```

## Legal payload policy

`scripts/stage_wasm_package.mjs --check-legal` requires this binding's `LICENSE`,
`LICENSING.md`, `THIRD_PARTY_NOTICES.md`, `COPY_PROVENANCE.md`, and complete
`LICENSES/` directory to be byte-identical to the canonical files at the repository
root. The release staging step copies that verified mirror into the npm package.

For dependencies licensed as `MIT OR Apache-2.0` or `Unlicense OR MIT`, the WASM
distribution relies on the MIT option and bundles `LICENSES/MIT.txt`; a separate
Unlicense text is therefore not required. Apache Arrow is Apache-only but is not in
the fs-free WASM dependency graph. The locked WASM closure does, however, include
`ryu 1.0.23` (`Apache-2.0 OR BSL-1.0`) through `csv`. This distribution selects
Apache-2.0 and bundles `LICENSES/Apache-2.0.txt`, imported from the exact upstream
crate whose SHA-256 matches `bindings/wasm/Cargo.lock`; BSL-1.0 therefore does not
apply. The staging guard pins both the crate and Apache-text hashes so an upgrade
cannot silently reuse an unaudited payload. The same audit covers the mandatory
Unicode-3.0 branch of `unicode-ident 1.0.24`; its exact locked upstream text is
bundled as `LICENSES/Unicode-3.0.txt` and pinned by the guard. A normalized digest
of every package name, version, and SPDX expression returned by locked Cargo
metadata makes any other closure change fail closed pending a fresh audit.

The same staging command emits `nirs4all-io-wasm.cdx.json`, a deterministic
CycloneDX 1.6 SBOM with all 55 locked Cargo components, their SPDX expressions,
crate hashes, purls, and dependency edges. Its subject is `nirs4all-io-wasm`
`0.1.14`; source properties attest the full Git commit and tree. Timestamps,
UUIDs, local paths, and other volatile fields are intentionally excluded.

## Test

```bash
wasm-pack build bindings/wasm --target nodejs --out-dir pkg
node bindings/wasm/tests/node_smoke.cjs          # raw exports
node bindings/wasm/tests/idiomatic_smoke.mjs     # idiomatic.mjs wrapper
```

The release workflow runs both smokes again against the staged npm package and
retains the exact `.tgz`, including the wrapper, detailed types, and canonical
project license/provenance inventory plus the closure-specific CycloneDX SBOM.
