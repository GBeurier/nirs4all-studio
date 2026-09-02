# Getting started

This page walks through the Python binding, which exposes the verified public
surface of `nirs4all-core`. The aggregate delegates all real work to the upstream
engines, so its API is mostly about **reaching the upstream domains** and
**parsing/running the portable pipeline subset**.

## Import

The Python distribution is `nirs4all-core` but the import package is
`nirs4all_core`:

```python
import nirs4all_core as n4core
```

## Inspect which upstreams are available

`nirs4all-core` does not vendor the engines — it imports them lazily when an
upstream is installed. Check what is reachable in your environment:

```python
import nirs4all_core as n4core

# {'dag_ml': False, 'dag_ml_data': False, 'formats': False,
#  'io': False, 'datasets': False, 'methods': False}
print(n4core.available_upstreams())

# A serializable status table with the resolved candidate and role per upstream
for entry in n4core.upstream_status():
    print(entry["key"], entry["available"], entry["role"])
```

The six registered upstreams are `dag_ml`, `dag_ml_data`, `formats`, `io`,
`datasets`, and `methods`.

## Reach an upstream domain

The top-level lazy proxies resolve the underlying upstream module on first
attribute access. Install the matching extra (for example
`pip install "nirs4all-core[methods]"`) before using one:

```python
import nirs4all_core as n4core

# Lazily resolves nirs4all-methods (or its known candidates) on first use.
methods = n4core.methods.module()

# Or raise a clear error if an upstream is missing:
formats = n4core.require_upstream("formats")
```

If an upstream is not installed, `require_upstream` raises an `ImportError` that
lists the import candidates it tried — `nirs4all-core` never falls back to a fake
local implementation.

## Parse a portable pipeline definition

`nirs4all-core` accepts the same JSON/YAML pipeline-definition envelope as the
full Python `nirs4all`, restricted to the portable operator subset
(Kennard-Stone, SNV, Savitzky-Golay, and a PLS component sweep):

```python
import nirs4all_core as n4core

definition = n4core.load_pipeline_definition(
    {
        "name": "snv-pls",
        "pipeline": [
            {"class": "nirs4all.operators.transforms.StandardNormalVariate"},
            {
                "model": {
                    "class": "sklearn.cross_decomposition.PLSRegression",
                    "params": {"n_components": 4},
                },
                "name": "PLS-4",
            },
        ],
    }
)

print(definition.name)        # "snv-pls"
print(definition.as_dict())   # canonical descriptor
```

The loader also accepts a direct list of steps, a mapping with `pipeline` or
`steps`, a JSON/YAML file path, or JSON/YAML text.

## Run the portable subset

Executing the portable pipeline runs it through `nirs4all-methods` and is parity
gated against the full Python `nirs4all` oracle. With the `methods` extra and a
local `libn4m` available, pass a dense `PortableDataset` (its `X` / `y`
matrices):

```python
import numpy as np
import nirs4all_core as n4core

dataset = n4core.PortableDataset(
    X=np.asarray(X),  # shape (n_samples, n_wavelengths)
    y=np.asarray(y),  # shape (n_samples,)
)

result = n4core.run_portable_pipeline(definition, dataset)
```

See [PARITY.md](PARITY.md) for the exact fixtures and the strict
execution-parity gates, and [BINDINGS.md](BINDINGS.md) for the equivalent entry
points in Rust, R, MATLAB/Octave, and JavaScript/WASM.
