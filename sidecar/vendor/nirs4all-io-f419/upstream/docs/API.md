# Public API & integration seam

```{note}
This page describes the Phase-1 Python MVP surface (the parity oracle). For the
**published PyPI wheel** (the pyo3 binding) — including its actual `load`
default, `to_spec` return type and `nio.validate` — see
[Getting started](getting_started.md). The `DatasetSpec` / `DatasetPlan` JSON
shapes below are identical across both; some Python accessor spellings differ.
```

> Story 5.1. This is the **stable seam** `nirs4all` / `nirs4all-studio` (or any
> host) can adopt later without depending on internals. The contract is the
> `DatasetSpec` / `DatasetPlan` JSON shape, the core entry points below, and the
> public `DatasetPackage` helper.

## Entry points

```python
import nirs4all_io as nio

# 1. infer(input) -> DatasetPlan : inspect anything, get a scored recommendation
plan = nio.infer("data/mango/", conventions=["nirs4all-classic"])
print(plan.recommendations, plan.warnings)
plan.to_dict()                       # JSON-serializable (scores are uncalibrated; see C5)

# 2. load(input | spec | plan) -> target : materialize
ds  = nio.load(plan.accept())                          # DatasetPlan -> SpectroDataset
ds  = nio.load("data/mango/")                          # directory + conventions
ds  = nio.load({"sources": [...]})                     # explicit DatasetSpec (dict)
ds  = nio.load("dataset.yaml")                          # JSON/YAML config (alias-normalized)
ds  = nio.load((X, y))                                  # in-memory arrays
ds  = nio.load(reference_dataset)                       # any object with to_io_spec(), e.g. NirsDataset
asm = nio.load(spec, target="assembled")               # target-agnostic AssembledDataset
pkg = nio.load(spec, target="dataset_package")         # target-agnostic DatasetPackage
pkg = nio.to_dataset_package(spec)                     # equivalent helper

# 3. to_spec(input) -> (DatasetSpec, base_dir) : just resolve, no materialization
spec, base = nio.to_spec("data/mango/")

# 4. DatasetSpec : the canonical IR
spec = nio.DatasetSpec.from_yaml("dataset.yaml"); spec.validate()
spec.to_dict(); spec.to_yaml(); spec.to_json()
```

### `load` signature

```python
nio.load(inp, *, target="spectrodataset" | "assembled" | "dataset_package" | "package" | "dag-ml-data",
         conventions=None, base_dir=None, name=None, spectro_dataset_cls=None)
```

- `target="spectrodataset"` (default) lazily imports `nirs4all.data.SpectroDataset`.
  Pass `spectro_dataset_cls=` to inject a double (used in tests; no nirs4all needed).
- `target="assembled"` returns the **target-agnostic** `AssembledDataset` (per-partition
  `PartitionBlock`: multi-source `X`, `y`, `metadata`, headers, units) — testable, and the
  shared hand-off point for `DatasetPackage` and the Rust `to_dag_ml_data` bridge.
- `target="dataset_package"` returns the public target-agnostic `DatasetPackage`
  summary/manifest wrapper; `target="package"` is an alias.
- `target="dag-ml-data"` is intentionally **not** a Python MVP target. The implemented
  emit is Rust-only in `crates/nirs4all-io-dagml` (`to_dag_ml_data(&AssembledDataset)`
  and the `emit-dagml` binary), validated by the Phase-2 conformance gate. The Python
  call raises `NotImplementedError` with that bridge pointer instead of claiming a stub
  target.

### Reference Dataset Adapter

Catalog/reference dataset objects can be handed to IO without creating a package
dependency cycle by exposing:

```python
def to_io_spec(self) -> dict | tuple[dict, pathlib.Path]: ...
```

`nirs4all-datasets.NirsDataset` uses this seam: it publishes a normal
`DatasetSpec` over its verified local canonical files, then IO owns the usual
load/join/package materialization. Parsing still belongs to `nirs4all-formats`
through IO's vendor loader; datasets only supplies catalog paths and roles.

## Invariants the seam guarantees

- **No runtime `nirs4all` dependency.** `import nirs4all_io` never imports `nirs4all`
  (enforced by `tests/test_import_boundary.py`); only `target="spectrodataset"` lazily does.
- **`DatasetSpec` round-trips** through dict/YAML/JSON and is structurally validated.
- **Parity**: for the supported topologies, `load(...) → SpectroDataset` equals
  `nirs4all.DatasetConfigs(...)` (`tests/test_parity.py`, run with `pytest -m parity`).

### Rust host adapter for role-tagged Studio configs

The Rust facade exposes `to_spec_role_tagged(config, name)`,
`load_role_tagged_assembled(config, dataset_root, name)`, and
`load_role_tagged_assembled_with_limits(config, dataset_root, name, limits)`.
The latter accepts a validated `RoleTaggedReadLimits`; Studio uses 1 MiB per
file, 2 MiB in aggregate, 128 KiB per decoded CSV record, 64 KiB per decoded
field, 128 data rows, 256 columns, and 16,384 cells. The compatibility entry
point explicitly keeps the 256 MiB / 512 MiB file defaults and imposes no new
record, field, or shape restriction (`u64::MAX` compatibility sentinels are
used after Latin-1-to-UTF-8 normalization). Custom file/aggregate byte limits
may only tighten their compatibility ceilings. These
functions consume the existing Studio `config.files` input shape and
immediately emit the official `DatasetSpec`; this adapter is not a persistent
or wire schema.

The accepted slice is deliberately closed: explicit train X/Y are required;
test X/Y and metadata, homogeneous multi-target selection, aggregation, and
file/inline folds are optional. `files` array order is authoritative, exactly
as in Studio's selected Python oracle. The numeric `source` member is validated
as a non-negative UI annotation but does not reorder or group files; `null`,
legacy `0`, positive 1-based labels, gaps, and duplicate labels are accepted.
Non-null `multi_source`, heterogeneous target tasks, ambiguous
`classification`, and column-sourced folds still fail closed.

Known descriptive target members (`unit`, `classes`, `label`, `description`)
are bounded and validated, then omitted from DatasetSpec because they do not
alter loading. `default_target` is likewise checked against the selected set
but not encoded: DatasetSpec v1 has no default-target field and the selected
Studio loading oracle ignores it. Target selection filters Y columns; the
assembled target order remains the Y file's column order.

Materialization opens every relative path through a capability-rooted directory
handle, rejects absolute paths outside the canonical root, deduplicates opened
file identities, checks regular-file metadata before allocation, and reads at
most the smaller remaining per-file/aggregate budget plus one byte from those
already-open handles. The existing CSV decoder then checks record, field, row,
column, and cell limits before copying an accepted record into owned cell
strings. Record/field byte counts exclude delimiters and CSV quoting; rows
exclude the header, and cells cover both decoded fields and the rectangular
frame allocation. The
scientific parser and assembly remain the existing fs-free IO core; no checked
path is reopened. The boundary caps the serialized config at 1 MiB, files at
64, targets at 64, each file at 256 MiB, and aggregate input bytes at 512 MiB.
Compressed `.gz` and `.zip` inputs are temporarily rejected rather than using
the general loader's unbounded decompression path.

## How a host would adopt it (illustrative — not wired here)

```python
# in a host (nirs4all / studio), later, with no change to nirs4all-io:
import nirs4all_io as nio
def load_dataset(user_input):
    plan = nio.infer(user_input)          # show plan.recommendations in the UI
    return nio.load(plan.accept(overrides))  # user-edited spec -> SpectroDataset
```

See `REPLUG.md` for the recommended adoption sequence.
