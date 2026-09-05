# nirs4all-formats (WebAssembly / JS)

Browser- and Node-friendly bridge to the `nirs4all-formats` Rust core. It runs the
format sniffers **and** the decoders entirely in WebAssembly, from in-memory
bytes — no filesystem required.

## Build

```bash
# Browser (ES modules)
wasm-pack build bindings/wasm --target web --release
# Node.js / Bun
wasm-pack build bindings/wasm --target nodejs --release --out-dir pkg-node
```

This emits the JS glue, `.wasm` binary, and TypeScript typings under `pkg/`
(or `pkg-node/`). Tagged releases publish that surface as
`@nirs4all/formats-wasm` on npm.

## Surface

```ts
import init, {
  version, features, readerCatalog, probeBytes, openBytes, openWithSidecars,
} from "./pkg/nirs4all_formats_wasm.js";

await init();

version();   // "0.1.0-alpha.1"
features();  // { hdf5: true, matlab: true, parquet: true }
readerCatalog(); // [{ reader: "nirs4all_formats::readers::jcamp" }, ...]

const bytes = new Uint8Array(await file.arrayBuffer());

// Sniff: ordered candidate readers, best first
probeBytes(file.name, bytes);
// [{ format: "jcamp-dx", reader: "...", confidence: "definite", reason: "..." }]

// Decode: SpectralRecord[] (same JSON shape as `nirs4all-formats read-json`)
const records = openBytes(file.name, bytes);
```

`openBytes` / `probeBytes` take the file **name** (several sniffers
disambiguate by extension) plus the bytes. The returned records match the
[data model](../../docs/DATA_MODEL.md): `signals`, `signal_type`, `targets`,
`metadata`, `provenance`, `quality_flags`.

### Sidecar formats

Multi-file formats (ENVI Standard `.img`+`.hdr`, ENVI SLI, AVIRIS/ERDAS LAN,
FGI XML+HDF5, NetCDF MFRSR) return an `UnsupportedSidecar` error from
`openBytes`. Supply the companions as a `{ name: Uint8Array }` map instead:

```ts
const records = openWithSidecars("cube.img", imgBytes, { "cube.hdr": hdrBytes });
```

## Scope & feature flags

The default WASM build compiles `fmt-hdf5`, `fmt-matlab`, and `fmt-parquet`
**on**. HDF5/NetCDF-backed readers, MATLAB MAT/RData readers, and Parquet table
readers are available in the browser, including snappy, uncompressed, and
zstd-compressed Parquet pages. Call `features()` to check the active bundle at
runtime.

## Smoke test

```bash
node bindings/wasm/tests/smoke.js
node bindings/wasm/tests/sidecars.test.js
node bindings/wasm/tests/fixture_matrix.js
```

`smoke.js` loads committed fixtures (CSV, JCAMP-DX, ASD binary, a non-data PDF)
and asserts the probe routes each to the expected reader; `sidecars.test.js`
exercises `openWithSidecars`. `fixture_matrix.js` opens a wider set of committed
single-file and sidecar fixtures through the WASM package, checks expected
non-NIRS/refusal paths, and compares the exercised readers to
`readerCatalog()`. The committed matrix covers every compiled reader except
Allotrope ADF, whose sample is local-only/non-redistributable; see
`samples/allotrope_adf/README.md`.
