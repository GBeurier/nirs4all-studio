# nirs4all-io

**The dataset-assembly bridge of the nirs4all ecosystem.** `nirs4all-io` turns a
user input — a directory, a list of files, or a config `dict` — into a
pipeline-ready dataset. It owns the dataset-level concepts (X / Y / metadata
roles, train / test / folds, multi-source, relational joins, signal / task-type
inference, and a declarative convention system) and produces the
`SpectroDataset` shape that the main [`nirs4all`](https://nirs4all.readthedocs.io/en/latest/)
library models.

By architectural design it **never decodes vendor file bytes itself**: vendor
spectroscopy reads are delegated to
[`nirs4all-formats`](https://nirs4all-formats.readthedocs.io/en/latest/). It also
has **no runtime dependency on `nirs4all`** — the only touch-point is a lazy
import of the `SpectroDataset` class at materialization time.

```{note}
The current published wheel reads the **CSV family** of tabular inputs; the
vendor-format reader path (delegated to `nirs4all-formats`, never re-parsed
here) and additional tabular backends (numpy / Parquet / Excel) land with the
broader load path.
```

## The pipeline

Every input flows through the same four stages:

```
any input ──► RESOLVE ──► INFER ──► CONFIGURE ──► MATERIALIZE ──► SpectroDataset
              (InputSet)  (DatasetPlan, scored)   (DatasetSpec)
```

- **RESOLVE** — normalize whatever you passed (path, glob, list, dict, arrays)
  into a concrete `InputSet`.
- **INFER** — inspect the inputs and propose a confidence-scored `DatasetPlan`
  (roles, columns, structure, signal/task type), with an evidence trace per
  decision. Scores are for ranking/triage, not calibrated probabilities.
- **CONFIGURE** — settle on a versioned, machine-validatable `DatasetSpec`, the
  canonical contract.
- **MATERIALIZE** — build the target: the assembled structural summary
  (default), or a `nirs4all` `SpectroDataset`.

## Quickstart

```python
import nirs4all_io as nio

# Inspect a directory and get a scored recommendation (DatasetPlan)
plan = nio.infer("data/mango/", conventions=["nirs4all-classic"])
print(plan.recommendations)
print(plan.overall_score)

# Materialize the assembled structural summary (no nirs4all needed)
summary = nio.load("data/mango/", conventions=["nirs4all-classic"])

# Or build a real nirs4all SpectroDataset
ds = nio.load("data/mango/", target="spectrodataset", conventions=["nirs4all-classic"])

# An explicit DatasetSpec / config dict also works
summary = nio.load({"sources": [{"id": "x", "role": "features", "input": "X.csv"}]})
```

See [Getting started](getting_started.md) for a fuller walk-through and
[Installation](installation.md) to install the package.

```{toctree}
:hidden:
:caption: Guide

installation
getting_started
```

```{toctree}
:hidden:
:caption: Reference

API
DATASET_CONFIGURATIONS
VERSIONING
```

```{toctree}
:hidden:
:caption: Project

ROADMAP
REPLUG
```

## The nirs4all ecosystem

<!-- RTD slugs are assumed equal to the repo name; edit a :link: URL below if a slug differs at import. -->

::::{grid} 1 2 2 2
:gutter: 2

:::{grid-item-card} nirs4all
:link: https://nirs4all.readthedocs.io/en/latest/
Main Python modelling library — pipelines, SpectroDataset, predictions.
:::
:::{grid-item-card} nirs4all-formats
:link: https://nirs4all-formats.readthedocs.io/en/latest/
Rust readers for ~58 NIRS/spectroscopy file formats (nirs4all-io reads vendor files through this).
:::
:::{grid-item-card} nirs4all-methods
:link: https://nirs4all-methods.readthedocs.io/en/latest/
Portable C-ABI PLS/NIRS engine (libn4m) + bindings.
:::
:::{grid-item-card} nirs4all-datasets
:link: https://nirs4all-datasets.readthedocs.io/en/latest/
Curated DOI-pinned NIRS dataset catalog (n4a-datasets).
:::
:::{grid-item-card} nirs4all-lite
:link: https://nirs4all-lite.readthedocs.io/en/latest/
Portable aggregate distribution (Rust + bindings).
:::
:::{grid-item-card} dag-ml
:link: https://dag-ml.readthedocs.io/en/latest/
Reproducible, OOF/leakage-safe ML coordinator.
:::
:::{grid-item-card} dag-ml-data
:link: https://dag-ml-data.readthedocs.io/en/latest/
Typed sample-aligned multi-source data contracts.
:::
::::
