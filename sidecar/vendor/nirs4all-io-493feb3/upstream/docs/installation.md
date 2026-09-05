# Installation

`nirs4all-io` requires **Python 3.11+**.

## From PyPI

```bash
pip install nirs4all-io
```

The PyPI package is a self-contained wheel built from the Rust core (pyo3
binding). It ships `numpy` and `pandas` as runtime dependencies, so it can
resolve, infer, configure, assemble datasets, build `DatasetPackage` payload
summaries, and materialize `SpectroDataset` objects when `nirs4all` is installed.

```{note}
By design `nirs4all-io` **never decodes vendor bytes itself**: reading **vendor
spectroscopy files** (OPUS, JCAMP, ASD, …) is delegated to the
[`nirs4all-formats`](https://nirs4all-formats.readthedocs.io/en/latest/) reader
library. That vendor-read path is available through the optional `formats` extra
or an explicit `nirs4all-formats` install. Without it, the wheel still covers
the native tabular/spec assembly path.
```

## Materializing a `SpectroDataset`

`nirs4all-io` has **no runtime dependency on `nirs4all`**. The only touch-point
is a lazy import of the `SpectroDataset` class when you call `load(...)` with
`target="spectrodataset"`. To get a real `SpectroDataset`, install
[`nirs4all`](https://nirs4all.readthedocs.io/en/latest/) alongside:

```bash
pip install nirs4all
```

The default `load(..., target="assembled")` returns the assembled structural
summary and needs no `nirs4all` install at all; `target="spectrodataset"` is the
only path that imports `nirs4all`.

## Development install

The repository also carries a pure-Python Phase-1 implementation under
`src/nirs4all_io/` that is kept as the dev / parity oracle (it is not the
published wheel). To work on the library and run its test suite — which uses
`nirs4all` and `nirs4all-formats` as read-only oracles — install it editable
with its dev extras:

```bash
git clone https://github.com/GBeurier/nirs4all-io
cd nirs4all-io
pip install -e ".[dev]"
```

The published Python wheel is built from `bindings/python` with
[maturin](https://www.maturin.rs/):

```bash
pip install maturin
maturin develop -m bindings/python/Cargo.toml
```
