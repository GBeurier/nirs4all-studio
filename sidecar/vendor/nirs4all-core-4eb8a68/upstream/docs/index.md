# nirs4all-core

`nirs4all-core` is the **portable aggregate
distribution** of the nirs4all
ecosystem. It is a thin portability layer that records the same upstream domain
map across **Rust, Python, R, MATLAB/Octave, and JavaScript/WASM** from one
canonical package surface - without becoming a second implementation of parsing,
datasets, ML orchestration, or numerical methods.

## What it re-exports

`nirs4all-core` aggregates exactly six upstream libraries. Any real work is
delegated to those libraries when the current host language has a matching
runtime binding:

- [`dag-ml`](https://dag-ml.readthedocs.io/en/latest/) — reproducible,
  OOF/leakage-safe ML coordinator.
- [`dag-ml-data`](https://dag-ml-data.readthedocs.io/en/latest/) — typed,
  sample-aligned multi-source data contracts.
- [`nirs4all-formats`](https://nirs4all-formats.readthedocs.io/en/latest/) —
  Rust readers for NIRS/spectroscopy vendor file formats.
- [`nirs4all-io`](https://nirs4all-io.readthedocs.io/en/latest/) — dataset
  assembly bridge to a `SpectroDataset`.
- [`nirs4all-datasets`](https://nirs4all-datasets.readthedocs.io/en/latest/) —
  curated, DOI-pinned NIRS dataset catalog.
- [`nirs4all-methods`](https://nirs4all-methods.readthedocs.io/en/latest/) —
  portable C-ABI PLS/NIRS numerical engine (`libn4m`).

Each binding records these upstream domains as `formats`, `io`, `datasets`,
`methods`, `dag_ml`, and `dag_ml_data`. Runtime loaders/proxies are only
executable where a real upstream package exists; otherwise the domain remains a
metadata-only row with an explicit unavailable-capability error.

:::{important}
**It only re-exports.** `nirs4all-core` must **never** add a parser, estimator,
numerical kernel, dataset catalog, or DAG compiler of its own. The upstream
projects remain the single source of truth; this repository provides only a
canonical package surface, native bindings, release glue, and parity checks.
:::

## Package names

The Python distribution is named `nirs4all-core` and imports as
`nirs4all_core` so it does not collide with the full Python `nirs4all` library.
**Every other binding uses `nirs4all`.** This shared name is a packaging
convention, not a promise that each non-Python host has runtime bindings for
all six upstream domains.

| Target | External name | Import / module name |
| --- | --- | --- |
| Python | `nirs4all-core` | `nirs4all_core` |
| Rust | `nirs4all` | `nirs4all` |
| JavaScript/WASM | `nirs4all` | `nirs4all` |
| R | `nirs4all` | `library(nirs4all)` |
| MATLAB/Octave | `nirs4all` | `+nirs4all` namespace |

In Python the aggregate additionally exposes the **additive, non-shadowing**
brand facade `n4a` (`import n4a`; see [Naming](NAMING.md)). It re-exports
`nirs4all_core` without adding behavior.

:::{note}
This is the portable aggregate distribution. It is **not** `nirs4all-web` (the
standalone browser/WASM client) and **not** `nirs4all-studio` (the desktop/web
app). Those are separate projects that consume parts of this stack.
:::

## How the pieces fit

`nirs4all-core` is the seam where the low-level ecosystem becomes one portable
surface. The aggregate composes upstream domains — it does not reimplement them:

```text
nirs4all-formats ─┐
nirs4all-io ──────┤
nirs4all-datasets ┤──►  nirs4all-core  ──►  Python / Rust / R / MATLAB-Octave / JS-WASM
nirs4all-methods ─┤      (metadata/re-export surface,
dag-ml ───────────┤       parity gates, release glue,
dag-ml-data ──────┘       gated runtime delegates)
```

The portable pipeline subset (Kennard-Stone, SNV, Savitzky-Golay, and a PLS
component sweep) is parsed from the same JSON/YAML definition envelope used by
the full Python `nirs4all`, then executed through `nirs4all-methods` and compared
against the full Python `nirs4all` oracle in every binding. See
[PARITY.md](PARITY.md) for the parity strategy and gates.

```{toctree}
:maxdepth: 2
:caption: Getting started

installation
getting_started
```

```{toctree}
:maxdepth: 2
:caption: Architecture

ARCHITECTURE
BINDINGS
NAMING
OPERATORS
COMPATIBILITY
```

```{toctree}
:maxdepth: 2
:caption: Parity & releases

PARITY
PUBLISHING
RELEASE
```

## The nirs4all ecosystem

<!-- nirs4all-core re-exports the libraries below. RTD slugs are assumed equal to the repo name; edit a :link: URL if a slug differs at import. -->

::::{grid} 1 2 2 2
:gutter: 2

:::{grid-item-card} nirs4all
:link: https://nirs4all.readthedocs.io/en/latest/
Main Python modelling library — pipelines, SpectroDataset, predictions.
:::
:::{grid-item-card} nirs4all-formats
:link: https://nirs4all-formats.readthedocs.io/en/latest/
Rust readers for ~58 NIRS/spectroscopy file formats (re-exported).
:::
:::{grid-item-card} nirs4all-io
:link: https://nirs4all-io.readthedocs.io/en/latest/
Dataset-assembly bridge → SpectroDataset (re-exported).
:::
:::{grid-item-card} nirs4all-datasets
:link: https://nirs4all-datasets.readthedocs.io/en/latest/
Curated DOI-pinned NIRS dataset catalog (re-exported).
:::
:::{grid-item-card} nirs4all-methods
:link: https://nirs4all-methods.readthedocs.io/en/latest/
Portable C-ABI PLS/NIRS engine, libn4m (re-exported).
:::
:::{grid-item-card} dag-ml
:link: https://dag-ml.readthedocs.io/en/latest/
Reproducible, OOF/leakage-safe ML coordinator (re-exported).
:::
:::{grid-item-card} dag-ml-data
:link: https://dag-ml-data.readthedocs.io/en/latest/
Typed sample-aligned multi-source data contracts (re-exported).
:::
::::
