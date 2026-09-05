<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/horizontal-dark.svg">
    <img alt="nirs4all-io" src="assets/brand/horizontal.svg" width="440">
  </picture>
</p>

# nirs4all-io

> **Dataset-assembly bridge.** Turn *any* user input — a directory, a list of
> files, a glob, a config dict/JSON/YAML, in-memory arrays, a folder of vendor
> spectra + a reference table — into a pipeline-ready dataset.

`nirs4all-io` owns the dataset-level concepts that the low-level reader library
[`nirs4all-formats`](https://github.com/GBeurier/nirs4all-formats) deliberately
does **not**: X/Y/metadata roles, train/test/folds, multi-source, relational
joins, signal/task-type inference, and a declarative convention system. It
matches the expressiveness of `nirs4all`'s `DatasetConfig`/`DatasetLoader` and
adds a score-based inference engine.

Part of the [open-source NIRS tools](https://nirs4all.org/open-source-nirs-tools.html)
ecosystem: file readers, datasets, methods, browser modelling, reproducible pipelines,
papers, benchmarks, and release dashboards for near-infrared spectroscopy.

```
any input ──► RESOLVE ──► INFER ──► CONFIGURE ──► MATERIALIZE ──► SpectroDataset / DatasetPackage
              (InputSet)  (DatasetPlan, scored)   (DatasetSpec)    or dag-ml-data envelope (Rust bridge)
```

## Status

**Phase 1 (Python MVP) — complete and parity-verified.** `load()` and `infer()`
work end-to-end and target `SpectroDataset`, `AssembledDataset`, and the
target-agnostic `DatasetPackage`; the build is **byte-equivalent to nirs4all's
own `DatasetConfigs`** on the supported topologies (`pytest -m parity`).

**Phase 2 (Rust rewrite + dag-ml-data bridge) — complete.** The Rust workspace
ports the same pipeline and the `dag-ml-data` emit lives in
`crates/nirs4all-io-dagml` (`to_dag_ml_data` + the `emit-dagml` binary). The main
`nirs4all-io` CLI keeps an `emit-dag-ml-data` discovery subcommand that points to
that bridge crate. Its bounded DATA-002 path builds a typed provider directly
from a Rust `DatasetPackage`: `from_package` accepts one dense numeric source,
while `from_package_source` selects one named source without fusing the others.
The provider retains package identity, target names, and a typed row-major f64
feature projection. There is intentionally no Python
`load(..., target="dag-ml-data")` surface. See
[`docs/API.md`](docs/API.md) for the seam,
[`docs/IO_XLG_QUALIFICATION.md`](docs/IO_XLG_QUALIFICATION.md) for binding qualification,
and [`docs/development.md`](docs/development.md) for contributor references and
the private development archive policy.

## Quick start (target API)

```python
import nirs4all_io as nio

# Inspect a directory and get a scored recommendation
plan = nio.infer("data/mango/", conventions=["nirs4all-classic"])
print(plan.recommendations)

# Materialize a spec/plan/input into a SpectroDataset or target-agnostic package
ds = nio.load(plan, target="spectrodataset")
ds = nio.load({"sources": [{"id": "x", "role": "features", "input": "X.csv"}]})
pkg = nio.to_dataset_package(plan)

# Vendor corpus + reference table (headline new capability)
plan = nio.infer(["spectra/*.0", "reference.csv"], conventions=["vendor-corpus"])
```

## What can it load?

[`docs/DATASET_CONFIGURATIONS.md`](docs/DATASET_CONFIGURATIONS.md) is the complete
reference: **every** input form, `DatasetSpec` field, column selector, merge mode,
relational join, partition, fold and loading parameter — with a use-case cookbook
and an honest ✅/🟡/📋 implementation status on each option.

## Language bindings

One Rust core, thin wrappers per language (all over the same canonical-JSON
contract). See [`COMPAT.md`](COMPAT.md) for the full operation matrix.

- **CLI** — `nirs4all-io` (`infer` / `to-spec` / `validate` / `load`; `emit-dag-ml-data` points to the bridge crate).
- **dag-ml-data bridge** — `crates/nirs4all-io-dagml` (`to_dag_ml_data` / `emit-dagml`), validated by the cross-CLI conformance gate.
- **Rust DATA package provider** — `PackageProvider::from_package` or
  `from_package_source`, for one selected dense numeric source plus aligned
  target tables; multi-source fusion and N-D payloads stay on explicit
  `dag-ml-data` provider paths.
- **Python** (pyo3/maturin) — [`bindings/python`](bindings/python/README.md); the only surface that builds a real `SpectroDataset`.
- **R** (`.Call` over the C ABI) — [`bindings/r`](bindings/r/README.md). R-universe can lag the latest RC tag until its rebuild catches up; use the GitHub Release source tarball for exact-version validation, or install the current R-universe build with:
  ```r
  install.packages("nirs4allio", repos = c("https://gbeurier.r-universe.dev", getOption("repos")))
  ```
- **MATLAB / Octave** (MEX over the C ABI) — [`bindings/matlab`](bindings/matlab/README.md).
- **WASM / JS** (wasm-bindgen, fs-free) — [`bindings/wasm`](bindings/wasm/README.md).

## Design principles

- **Self-contained**: no runtime dependency on `nirs4all`. The only touch-point
  is a lazy import of the `SpectroDataset` class at materialization.
- **Parsers live in `nirs4all-formats`**: vendor byte-decoding is never
  reimplemented here; tabular loading logic is copied from `nirs4all`
  (see [`COPY_PROVENANCE.md`](COPY_PROVENANCE.md)).
- **Versioned, machine-validatable `DatasetSpec`** is the canonical contract.

## License

`nirs4all-io` is dual-licensed open-source — **`CeCILL-2.1 OR AGPL-3.0-or-later`** (your choice) —
with an optional **commercial license** for closed-source / SaaS use. For any commercial use, contact
<nirs4all-admin@cirad.fr>. See [`LICENSING.md`](LICENSING.md), the texts under [`LICENSES/`](LICENSES/),
and [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
