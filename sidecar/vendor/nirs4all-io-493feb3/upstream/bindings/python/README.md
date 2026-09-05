<!-- SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later -->
# Python binding (pyo3 / maturin)

A thin pyo3 wrapper over the single `nirs4all-io` Rust core (the facade crate) —
all RESOLVE → INFER → CONFIGURE → MATERIALIZE logic lives in Rust; Python only
adapts the results.

## Layout (mixed maturin)

- Native extension `nirs4all_io._native` (the pyo3 module, built from `src/lib.rs`).
- Python package `nirs4all_io` (under `python/`) that wraps `_native` and adds the
  lazy `SpectroDataset` adapter (`_adapter.py`).

`numpy` and `pandas` are wheel runtime dependencies — they back the full-array
`SpectroDataset` reconstruction and are **not** `nirs4all`.

## Build & install

```bash
maturin develop          # build + install into the active venv (dev)
maturin build            # build an abi3 wheel (abi3-py311)
pip install <wheel>      # install the built wheel
```

Requires Python ≥ 3.11. See `PACKAGING.md` for the abi3 wheel / `nirs4all-formats`
reuse details.

## API

All functions are re-exported from `nirs4all_io`.

| Function | Signature | Returns |
|---|---|---|
| `infer` | `infer(input, conventions=None)` | a `DatasetPlan` (data input only) |
| `to_spec` | `to_spec(input, conventions=None, name=None)` | a `DatasetSpec` |
| `validate` | `validate(spec)` | `None`; raises `ValueError` if invalid |
| `load` | `load(input, *, target="assembled", conventions=None, name=None, base_dir=None, spectro_dataset_cls=None)` | summary dict, `DatasetPackage`, or a `SpectroDataset` |
| `to_dataset_package` | `to_dataset_package(input, *, conventions=None, base_dir=None, name=None)` | a target-agnostic `DatasetPackage` |
| `describe_dataset_package` | `describe_dataset_package(input, *, conventions=None, base_dir=None, name=None, canonical=False)` | package summary dict or canonical JSON |
| `to_spectrodataset` | `to_spectrodataset(full, *, spectro_dataset_cls=None)` | a `SpectroDataset` |

**Inputs** (`input`) accept a `str` path, a `pathlib.Path`, a sequence of either
(file list), or a `dict` (a spec). `validate` additionally accepts a JSON string.

**Typed results.** `infer` returns a `DatasetPlan` and `to_spec` a `DatasetSpec`.
Both subclass `dict` — they stay subscriptable, JSON-serializable, and valid
inputs to `validate` / `load` — and add a readable `repr` plus convenience
accessors:

- `DatasetSpec`: `.name`, `.schema_version`, `.sources`.
- `DatasetPlan`: `.overall_score`, `.resolved_spec` (a `DatasetSpec`),
  `.recommendations`, `.warnings`, and `.decisions()` (the scored
  structure/signal_type/task_type decisions, keyed by kind).

```python
>>> plan = nio.infer("/data/run")
>>> plan
DatasetPlan(overall_score=0.883, structure='x_y_separate'(0.85), ...)
>>> plan.decisions().keys()
dict_keys(['structure', 'signal_type', 'task_type'])
>>> plan.resolved_spec
DatasetSpec(name='data', schema_version=1, sources=[data:mixed])
```

**`load` targets:**
- `target="assembled"` → the rounded structural summary dict (no `nirs4all`).
- `target="dataset_package"` / `target="package"` → a target-agnostic
  `DatasetPackage` with payload manifest hashes and an assembled view.
- `target="spectrodataset"` → a real nirs4all `SpectroDataset`, built via a **lazy**
  `nirs4all` import inside the adapter. This is the **only** `nirs4all` touch-point;
  `import nirs4all_io` never imports `nirs4all` (enforced by
  `tests/test_import_boundary.py`). Inject `spectro_dataset_cls=` to drive the
  builder with a double (testing without nirs4all).

## Usage

```python
from pathlib import Path
import nirs4all_io as nio

plan = nio.infer(Path("/data/run"))            # DatasetPlan (typed dict)
spec = nio.to_spec("/data/run")                # DatasetSpec (typed dict)
nio.validate(spec)                             # raises ValueError if invalid

print(spec.schema_version, len(spec.sources))  # convenience accessors
print(plan.decisions())                        # scored inference decisions

summary = nio.load("/data/run")                # target="assembled" (default)
package = nio.to_dataset_package("/data/run")  # target-agnostic package
ds = nio.load("/data/run", target="spectrodataset")   # nirs4all SpectroDataset
```

## Test

```bash
pytest bindings/python/tests
```
