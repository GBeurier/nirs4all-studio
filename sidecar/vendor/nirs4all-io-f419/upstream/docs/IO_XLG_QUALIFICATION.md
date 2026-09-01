<!-- SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later -->
# IO-XLG-001 cross-language qualification

This gate proves a deliberately bounded claim: Rust, Python, WASM, R,
MATLAB/Octave, and the direct C ABI all invoke the same Rust assembly engine for
the public assembled-summary-v2 contract. It does not claim that every host has
Python's richer `SpectroDataset` adapter or that materialized arrays cross the
v0 C ABI.

The frozen corpus under `tests/cross_binding/corpus/` includes explicit sample,
observation, repetition, group, source, partition, and fold identity. Every
binding must reproduce `identity.expected.canonical` byte-for-byte. That golden
is also checked structurally so an accidental removal of an identity axis cannot
be hidden by updating only the comparison harness. `DatasetSpec` and canonical
JSON remain at version 1; the formerly unversioned assembled artifact becomes
the explicit `assembled_schema_version: 2` wire required by this gate.

Run the strict gate:

```bash
bash tests/cross_binding/verify.sh --output io-xlg-001-report.json
```

The report has exactly one row per surface. Its dispositions are:

- `passed`: the runtime built a real distribution artifact and reproduced the
  frozen summary;
- `refused`: the runtime existed, but build, execution, or contract parity did
  not complete;
- `unavailable`: the required local runtime/toolchain was absent.

`overall_complete` is true only when all six rows are `passed`; the strict
command exits non-zero otherwise. For an honest local inventory on a partial
developer machine, use `--allow-incomplete`. This changes only the process exit
code, never a row disposition or `overall_complete`.

Python is qualified from a built wheel whose extension is loaded by absolute
path: there is no editable install or `PYTHONPATH`. R builds the vendored package
path and requires `jsonlite` to be present before the run; the strict harness
never installs or downloads it. CI provisions the pinned `jsonlite` 1.8.9 source
archive only after verifying its SHA-256. WASM runs the produced `.wasm` under Node. MATLAB/Octave loads the built
MEX, and C compiles a direct probe against the built cdylib. No leg discovers a
sibling checkout.

## Selected-RC WASM regression check

The broader WASM smoke is green both on the clean selected RC
`1fc6c12088dcd5e8d8702fedd3cf339d296c3a02` and on this reconciliation under
Node 22.21.1 with wasm-bindgen 0.2.122:

```bash
wasm-pack build --mode no-install --dev --target nodejs --out-dir pkg
node bindings/wasm/tests/node_smoke.cjs
```

The dedicated WASM runner additionally calls the pre-existing
`assembleDataset` and the new canonical `loadSummary` over the same rich fixture,
and refuses unless their identity, fold provenance, and per-block source ids
agree. No selected-RC WASM regression is hidden or relabelled by IO-XLG-001.
