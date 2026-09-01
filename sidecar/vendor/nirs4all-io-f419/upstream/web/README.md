# nirs4all-io web — browser dataset builder

Browser-only dataset builder using:

- `nirs4all-formats` WASM for spectroscopy/proprietary file decoding and format-owned sidecar declarations. The default bundle is built with HDF5/NetCDF, MATLAB/RData, and Parquet reader families enabled.
- `nirs4all-io` WASM for in-memory browser dataset inference (`inferDataset`), iterative proposals (`proposeDataset`), materialization (`assembleDataset`), and `DatasetSpec` validation.

## Two modes (nav toggle)

- **One-shot** (default): drop everything at once → `inferDataset` proposes a full
  `DatasetSpec` you can edit. This is the original flow, unchanged.
- **Iterative builder**: add files one at a time and **validate each inferred
  decision** before moving on. Each `proposeDataset` call surfaces the still-open
  decisions (structure, per-file role, partition, identity, **X↔Y pairing** by id
  or row count, signal/task type) as confirmable cards with alternatives and
  evidence. Confirming a decision feeds it back as a *lock* so the next inference
  honours it; a step timeline narrates the build, a "dataset so far" panel shows
  the working `DatasetSpec`, and a materialized preview (`assembleDataset`) shows
  the per-partition X/y shapes as you go.

Build the local WASM bundles:

```bash
./build-wasm.sh
```

For development, the modular page can be served from this directory:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080/` from this directory. The page supports adding
files incrementally, selecting an entire folder, or dropping a folder when the
browser exposes directory entries. Relative paths are preserved so train/test
folders and same-directory sidecars can be inferred correctly. The sample
dataset exercises cumulative multi-file upload with `X_train`, `y_train`,
metadata, and test files. Proprietary files are decoded by `nirs4all-formats`;
each file row shows the best detected format/reader and decode errors when a
payload is not usable. Raw files and decoded records are then handed to
`nirs4all-io` as one dataset inference request.

The inference panel exposes the `DatasetPlan` evidence that matters when
checking an inferred dataset: file assignments, column/record roles, spectral
axis, browser inference parameters, warnings, and recommendations. The
`Dataset properties` form is pre-filled from `nirs4all-io` and edits the
canonical `DatasetSpec` fields for identity, repetitions, partitions/folds,
aggregation, sources, joins, column selectors, and loading parameters.
The same panel also reads the `nirs4all-formats` WASM registry at runtime and
shows the compiled reader catalog, including optional HDF5/NetCDF, MATLAB/RData,
and Parquet support in the default bundle.
Files that a format reader explicitly refuses as non-spectral, such as PP
Systems derived vegetation-index products, are shown as format refusals and are
excluded from `X` inference so `nirs4all-io` does not fabricate a spectral
dataset from numeric metadata columns.

To generate the page intended for use without a server, build a single
standalone HTML file:

```bash
node make-standalone.mjs
```

The output is `dist/nirs4all-io-standalone.html`. It inlines the CSS, the
application code, both WASM modules, and the sample files, so it can be opened
directly with `file://` or copied elsewhere without a local HTTP server.

## Standalone smoke test

After generating `dist/nirs4all-io-standalone.html`, run the browser smoke test
with Playwright:

```bash
node tests/standalone-smoke.mjs
node tests/standalone-formats-smoke.mjs
node tests/standalone-all-samples-smoke.mjs
```

If Playwright is not installed in this directory, point `PLAYWRIGHT_MODULE` at an
installed `playwright/index.mjs`. The test opens the standalone file through
`file://` and checks the sample dataset, sidecar alerts, folder upload,
reader-catalog display, Y histogram, and non-spectral format refusals.
`standalone-formats-smoke.mjs` additionally uploads real fixtures from the
sibling `nirs4all-formats/samples` directory, including single-file and sidecar
formats, to verify the full browser path from upload to `DatasetSpec`.
`standalone-all-samples-smoke.mjs` is the long-form audit: it discovers data
fixtures from `samples/`, `samples_local/`, `local_samples/`, and `new_samples/`
when those directories exist, groups known sidecars, and checks that every case
is either loaded into a valid `DatasetSpec` or refused explicitly by the UI. Set
`NIRS4ALL_ALL_SAMPLES_STRICT=1` to make decode refusals fail, and
`NIRS4ALL_ALL_SAMPLES_LIMIT=<n>` for a quick partial run.
