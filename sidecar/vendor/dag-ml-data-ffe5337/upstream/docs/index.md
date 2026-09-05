# dag-ml-data

`dag-ml-data` is the Rust-first data-contract and planning layer for typed,
sample-aligned, multi-source ML data. It owns schemas, semantic axes,
representations, immutable data views, sample relations, representation
adapters, data plans, alignment/collation contracts, schema fingerprints and
the host-provider C ABI. ML phases, OOF joins and model execution belong to the
companion `dag-ml` repo.

This site is the contributor and integration entry point for data contracts used
by future nirs4all and nirs4all-core integrations. The nirs4all connector is
owned by `nirs4all-io`; this repo stays NIRS-agnostic.

## Start Here

| Need | Page |
|---|---|
| Build and validate locally | [Installation](installation.md) |
| Understand data/runtime boundaries | [Architecture](ARCHITECTURE.md) |
| Integrate a data provider over C ABI | [C ABI](ABI.md) |
| Run contributor gates and organize local records | [Developer documentation](DEVELOPMENT.md) |
| Check the supported release surface | [Supported surface](SUPPORTED.md) |
| Map aggregation with `dag-ml` | [Aggregation interop](AGGREGATION_INTEROP.md) |
| Run release performance probes | [Performance probes](PERFORMANCE.md) |
| Map nirs4all replacement data capabilities | [Capability matrix](CAPABILITY_MATRIX.md) |
| Inspect shared contracts | [Contract manifests](contracts/README.md) |
| Review shared decisions | [Architecture decisions](adr/README.md) |
| Pick an example by audience | `examples/README.md` |

## API References

- Rust core API: <https://docs.rs/dag-ml-data-core/latest/>
- Rust facade API: <https://docs.rs/dag-ml-data/latest/>
- C ABI source: `crates/dag-ml-data-capi/include/dag_ml_data.h`
- Python binding source: `crates/dag-ml-data-py`
- WASM binding source: `crates/dag-ml-data-wasm`

## The nirs4all ecosystem

<!-- RTD slugs are assumed equal to the repo name; edit a :link: URL if a slug differs at import. -->

::::{grid} 1 2 2 2
:gutter: 2

:::{grid-item-card} dag-ml
:link: https://dag-ml.readthedocs.io/en/latest/
The ML coordinator that consumes this data layer (shared, JSON-identical contracts).
:::
:::{grid-item-card} nirs4all
:link: https://nirs4all.readthedocs.io/en/latest/
Main Python modelling library — pipelines, SpectroDataset, predictions.
:::
:::{grid-item-card} nirs4all-methods
:link: https://nirs4all-methods.readthedocs.io/en/latest/
Portable C-ABI PLS/NIRS engine (libn4m) + bindings.
:::
:::{grid-item-card} nirs4all-formats
:link: https://nirs4all-formats.readthedocs.io/en/latest/
Rust readers for ~58 NIRS/spectroscopy file formats.
:::
:::{grid-item-card} nirs4all-io
:link: https://nirs4all-io.readthedocs.io/en/latest/
Dataset-assembly bridge → SpectroDataset.
:::
:::{grid-item-card} nirs4all-datasets
:link: https://nirs4all-datasets.readthedocs.io/en/latest/
Curated DOI-pinned NIRS dataset catalog (n4a-datasets).
:::
:::{grid-item-card} nirs4all-core
:link: https://nirs4all-core.readthedocs.io/en/latest/
Canonical portable aggregate distribution (Rust, Python, R, WASM, MATLAB/Octave).
:::
::::

```{toctree}
:maxdepth: 2
:hidden:
:caption: Overview

installation
RATIONALE
ARCHITECTURE
```

```{toctree}
:maxdepth: 2
:hidden:
:caption: Contracts & ABI

ABI
CAPABILITY_MATRIX
contracts/README
adr/README
ADR-0001-nirs4all-connector-ownership
```

```{toctree}
:maxdepth: 2
:hidden:
:caption: Support & validation

OOF_FIXTURES
SUPPORTED
AGGREGATION_INTEROP
PERFORMANCE
```

```{toctree}
:maxdepth: 1
:hidden:
:caption: Reference

DEVELOPMENT
```
