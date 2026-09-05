# Getting started

This walk-through shows the public surface of the `nirs4all-io` Python package
(the pyo3 binding over the Rust core): the entry points `infer`, `to_spec`,
`validate` and `load`, and the `DatasetSpec` / `DatasetPlan` contracts they
exchange. Everything here imports the package under its canonical alias:

```python
import nirs4all_io as nio
```

## The entry points

`nirs4all-io` exposes a small, stable seam:

| Call | Does | Returns |
|---|---|---|
| `nio.infer(input)` | inspect an input, propose a scored recommendation | `DatasetPlan` |
| `nio.to_spec(input)` | resolve / normalize into the canonical IR | `DatasetSpec` |
| `nio.validate(spec)` | structurally validate a spec | `None` (raises on error) |
| `nio.load(input)` | resolve → configure → materialize | the assembled summary (default) |

`DatasetPlan` and `DatasetSpec` are thin `dict` subclasses: they stay
subscriptable and JSON-serializable, accepted anywhere a mapping is, while
adding a readable `repr` and a few convenience accessors.

## Inferring a plan

`infer` looks at the input and proposes a confidence-scored `DatasetPlan`. It
never materializes anything, so it is the cheap, read-only way to find out how
`nirs4all-io` would interpret your data. It accepts a path (`str` or `Path`) or
a list of files:

```python
plan = nio.infer("data/mango/", conventions=["nirs4all-classic"])

print(plan.recommendations)   # human-readable suggestions
print(plan.warnings)          # anything that looked off
print(plan.overall_score)     # ranking/triage score (uncalibrated)
print(plan.decisions())       # scored decisions: structure / signal_type / task_type / ...
```

Its signature is:

```python
nio.infer(input, conventions=None)
```

```{note}
`DatasetPlan` scores are **scores, not calibrated probabilities** — there is no
labelled calibration corpus yet, so use them for ranking and triage, not as
likelihoods. Each scored decision carries an evidence trace, and close calls are
flagged as `ambiguous`.
```

## The canonical spec

`to_spec` normalizes an input into the canonical `DatasetSpec` (the versioned,
machine-validatable contract) without materializing anything. It accepts a path,
a list of files, or a config `dict`:

```python
spec = nio.to_spec("data/mango/", conventions=["nirs4all-classic"])

print(spec.name)
print(spec.schema_version)
print(spec.sources)

# A DatasetSpec is a dict subclass: subscriptable and JSON-serializable
import json
json.dumps(spec)
```

Its signature is:

```python
nio.to_spec(input, conventions=None, name=None)
```

You can validate any spec (a `DatasetSpec`, a mapping, or a JSON string)
structurally; `validate` raises `ValueError` on a malformed spec and returns
`None` otherwise:

```python
nio.validate(spec)
```

The `resolved_spec` produced by inference is itself a `DatasetSpec`, so you can
inspect or validate the spec a plan settled on:

```python
plan = nio.infer("data/mango/")
nio.validate(plan.resolved_spec)
```

## Loading into a dataset

`load` runs the full pipeline end-to-end. It accepts a path, a list of files, or
a config `dict`:

```python
# default target: the assembled structural summary (no nirs4all needed)
summary = nio.load("data/mango/", target="assembled", conventions=["nirs4all-classic"])

# build a real nirs4all SpectroDataset (lazy nirs4all import)
ds = nio.load("data/mango/", target="spectrodataset", conventions=["nirs4all-classic"])

# an explicit DatasetSpec / config dict also works
summary = nio.load({"sources": [{"id": "x", "role": "features", "input": "X.csv"}]})
```

The full signature is:

```python
nio.load(
    input,
    *,
    target="assembled",       # or "spectrodataset"
    conventions=None,
    name=None,
    spectro_dataset_cls=None,
)
```

- `target="assembled"` (default) returns the structural summary — no `nirs4all`
  install required.
- `target="spectrodataset"` builds a real `nirs4all` `SpectroDataset` through
  the lazy adapter (the only `nirs4all` touch-point). Pass
  `spectro_dataset_cls=` to inject a recording double and exercise the adapter
  without `nirs4all` installed (used in tests).
- The Python `load` binding exposes only `"assembled"` and `"spectrodataset"`;
  the `dag-ml-data` emit lives in the Rust toolchain, not in this `load` call.

## A typical host flow

Infer, show the recommendation, then materialize the spec the plan settled on:

```python
plan = nio.infer(user_input)        # show plan.recommendations in the UI
spec = plan.resolved_spec           # the editable, validatable DatasetSpec
nio.validate(spec)
ds = nio.load(spec, target="spectrodataset")
```

## Where to go next

- [Public API & integration seam](API.md) — the stable contract for hosts.
- [Dataset configurations](DATASET_CONFIGURATIONS.md) — the complete reference
  of every input form, `DatasetSpec` field, selector, merge mode, join,
  partition and fold, with an honest implementation-status legend.
- [Versioning policy](VERSIONING.md) — how the `DatasetSpec` schema and other
  contracts are versioned.

```{important}
This page documents the **published PyPI wheel** (the pyo3 binding) and is the
authoritative reference for that surface. The reference pages
[API](API.md), [Dataset configurations](DATASET_CONFIGURATIONS.md) and
[Re-plug guide](REPLUG.md) were written against the Phase-1 Python MVP
(`src/nirs4all_io/`), which is kept only as the byte-for-byte **parity oracle**.
Their `DatasetSpec` / `DatasetPlan` JSON shapes are identical to the binding's,
but their Python snippets use MVP-only spellings and behaviours that the
published binding does **not** share, including:

- `to_spec(...)` returning `(spec, base_dir)` (binding: `-> DatasetSpec`);
- `spec.validate()` as a method and `plan.accept(...)` (binding: module-level
  `nio.validate(spec)` and `plan.resolved_spec`);
- the MVP's default `target="spectrodataset"` (binding default: `"assembled"`);
- MVP-only inputs (YAML config files, in-memory arrays, `DatasetPlan` passed to
  `load`) and the MVP's optional pip extras.

For the published wheel, trust the surface documented on this page.
```
