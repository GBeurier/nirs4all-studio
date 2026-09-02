# Installation

`nirs4all-core` ships one aggregate surface across five host languages. Each
binding installs through that language's native registry and delegates work to
upstream packages only where matching runtime bindings exist. Install only the
upstream extras you need - the aggregate itself adds no engines.

The canonical source repository is `GBeurier/nirs4all-core`. Registry names are
ecosystem-specific: Python installs as `nirs4all-core`, while Rust, npm, R, and
the MATLAB/Octave namespace use `nirs4all`.

:::{note}
`nirs4all-datasets` is **external and optional everywhere**. It is never bundled
into the default aggregate; opt in explicitly per binding (see each section
below).
:::

## Python

Distribution name `nirs4all-core`, imported as `nirs4all_core`.

```bash
pip install nirs4all-core
```

The base install pulls in only `PyYAML`. The upstream engines are optional
extras, so you choose what to bring in:

```bash
# Individual upstreams
pip install "nirs4all-core[methods]"   # nirs4all-methods + pls4all + scikit-learn
pip install "nirs4all-core[formats]"   # nirs4all-formats
pip install "nirs4all-core[io]"        # nirs4all-io
pip install "nirs4all-core[dag-ml]"    # dag-ml
pip install "nirs4all-core[dag-ml-data]"

# Bundled aggregate = methods + formats + io + dag-ml + dag-ml-data
pip install "nirs4all-core[all]"

# Datasets is excluded from [all]; opt in explicitly
pip install "nirs4all-core[datasets]"

# Everything, including the optional datasets catalog
pip install "nirs4all-core[everything]"
```

Requires Python 3.11 or newer.

## Rust

Crate name `nirs4all` (published from `bindings/rust/nirs4all`).

```bash
cargo add nirs4all
```

The crate records the aggregate domain registry and delegates execution only
where the relevant Rust crate or dynamic runtime is present. `methods`
execution loads `libn4m` at runtime; `formats`, `io`, and `datasets` are not
vendored parsers/loaders in this aggregate crate. The `nirs4all-datasets`
surface is gated behind an off-by-default Cargo feature that only un-gates the
datasets API (it pulls in no extra compiled dependency):

```toml
[dependencies]
nirs4all = { version = "0.1", features = ["datasets"] }
```

## JavaScript / WASM

npm package name `nirs4all` (published from `bindings/wasm`).

```bash
npm install nirs4all
```

It exposes typed ESM APIs and browser-safe WASM loaders, and delegates execution
to the `nirs4all-methods` WASM artifact. `nirs4all-web` consumes this package; UI
code does not live here.

## R

Package name `nirs4all` (built from `bindings/r`). The upstream ecosystem
bindings are not on mainstream CRAN yet, so the natural channel today is
**R-universe**:

```r
install.packages(
  "nirs4all",
  repos = c(
    "https://gbeurier.r-universe.dev",
    "https://cloud.r-project.org"
  )
)
```

It is a pure-R package (no compilation) that `Imports` only `jsonlite` and
`yaml`. The upstream bindings (`nirs4allformats`, `nirs4allio`,
`nirs4alldatasets`, `n4m`, `dagml`, `dagmldata`) are `Suggests`, resolved from
R-universe via `Additional_repositories`. The `dagml` package owns local R loss
and metric registration.

## MATLAB / Octave

The MATLAB/Octave binding ships the `+nirs4all` namespace as a zip attached to
the GitHub Release (`nirs4all-matlab-octave-<version>.zip`). Unzip it and add the
directory to your path:

```matlab
addpath('/path/to/nirs4all-matlab-octave')
```

The public subset is Octave-safe. Strict-parity execution additionally requires
the `nirs4all-methods` `+n4m` MEX shims on the MATLAB/Octave path.
Local custom losses and metrics require the DAG-ML `+dagml` package on that
path. Other upstream domains are listed as aggregate metadata only; the MATLAB/Octave
package does not advertise npm/WASM package names as runtime candidates.
