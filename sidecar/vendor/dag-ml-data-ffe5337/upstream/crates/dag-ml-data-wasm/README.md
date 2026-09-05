# dag-ml-data WASM bindings

Browser-friendly bindings for `dag-ml-data`.

The **default build** exposes validation, planning, fingerprint and coordinator
envelope helpers over UTF-8 JSON strings, with no host data buffers, provider
vtables or file I/O.

The opt-in **`provider` feature** adds `WasmInMemoryProvider`, an eager in-WASM
provider over `dag-ml-data-provider`'s `InMemoryProvider` (JSON in, JSON out;
handles cross as decimal strings because JS cannot represent the full `u64`
range). Build/test it with `--features provider`. An async JS buffer-fetcher
provider (host buffers fetched on demand via a Promise) is intentionally
deferred. With the feature on, `contract_manifest_json()` gains distinct
`provider_surface` / `provider_exports` / `provider_capabilities` sections.

`contract_manifest_json()` returns a stable JSON manifest with the package
version, supported contract ids, exported Python/WASM function names and shared
fixture digests. Browser integrations should check it before accepting cached
pipelines or persisted `nirs4all-core` workspaces.

## Build

```bash
cargo test -p dag-ml-data-wasm
node_out_dir="$PWD/target/wasm/dag-ml-data-wasm"
wasm-pack build crates/dag-ml-data-wasm --target nodejs --out-dir "$node_out_dir" --release
node scripts/smoke_wasm_bindings.cjs "$node_out_dir"
web_out_dir="$PWD/target/wasm-web/dag-ml-data-wasm"
wasm-pack build crates/dag-ml-data-wasm --target web --out-dir "$web_out_dir" --release
node scripts/smoke_wasm_web_bindings.mjs "$web_out_dir"
```

## JavaScript Surface

```js
import init, {
  contract_manifest_json,
  dataset_schema_fingerprint_json,
  plan_model_input_json,
} from "./pkg/dag_ml_data_wasm.js";

await init();
const manifest = JSON.parse(contract_manifest_json());
const fingerprint = dataset_schema_fingerprint_json(JSON.stringify(schema));
const plan = JSON.parse(
  plan_model_input_json(
    JSON.stringify(schema),
    JSON.stringify(modelInput),
    JSON.stringify(adapterRegistry),
    JSON.stringify(request),
  ),
);
```

Rust-side validation failures are returned as JSON strings with the ADR-11
descriptor fields `category`, `code`, `severity`, `message`,
`remediation_hint` and `context`.

`validate_fold_set_json` checks only the exhaustive partition shape of a
`FoldSet`: every sample must appear in validation exactly once. Use
`validate_fold_set_against_sample_relations_json` when the browser workflow also
needs group and augmentation-origin leakage checks.
