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

### Legacy file loading options

For each train/test X, Y and metadata (`*_group`) source, effective options use
the same precedence: root shorthand < `global_params` < `train_params` or
`test_params` < the role-specific `train_y_params`, `test_group_params`, etc.
The last explicitly supplied value wins; `has_header: false` is not a missing
value. For example, separate headerless target files require their own
`*_y_params: {has_header: false}` when the feature/global setting has headers.
These role settings are retained by both native and oracle normalization,
including when column filters are present. Existing canonical `sources`
documents retain their explicit source/global parameter contract.

### Native resource budgets (published wheel and Rust facade)

The native materialization path accepts a **host-owned** `LoadLimits` policy,
separate from `DatasetSpec`. It never reads a policy from dataset contents and
does not change the spec, canonical JSON or package fingerprint. Existing calls
use finite defaults; the Python parity oracle described below does **not** expose
this option and is not covered by this resource policy.

```python
# Published native wheel, not the src/ Python parity oracle:
import nirs4all_io as nio

summary = nio.load("X.csv", limits={"max_rows": 200_000, "max_cells": 10_000_000})
package = nio.to_dataset_package("X.csv", limits={"max_file_bytes": 64 * 1024**2})
# Explicit trusted-host choice; never infer this from the input:
summary = nio.load("X.csv", limits="unlimited")
```

All fields are positive integers; omitted fields keep their defaults. Unknown
fields and zero values fail before reading data. `None` selects defaults.

| Field | Default |
| --- | ---: |
| `max_file_bytes` | 2 GiB |
| `max_total_bytes` | 8 GiB |
| `max_decoded_file_bytes` | 4 GiB |
| `max_decoded_total_bytes` | 16 GiB |
| `max_files` | 100,000 reads |
| `max_record_bytes` | 64 MiB (CSV record) |
| `max_field_bytes` | 16 MiB (CSV field) |
| `max_rows` | 10,000,000 |
| `max_columns` | 1,000,000 |
| `max_cells` | 1,073,741,824 |

These are compatibility ceilings, **not guarantees of adequate RAM**: a billion
cells can consume many GiB plus assembly overhead. Application hosts should
tighten them; Studio's separate role-tagged policy remains stricter. Legitimate
larger workloads may raise individual fields or explicitly choose `"unlimited"`;
integer-overflow checks still apply.

One load accounts for config, sources/variations, index files and fold files,
including repeated reads. Regular-file size and actual bounded reads are checked;
gzip/ZIP decompression stops at the decoded allowance. CSV decoding enforces
record/field and table shape limits. Parquet checks declared rows, projected
columns and uncompressed column sizes before decoding, then checks actual Arrow
batch size and rows before copying into owned cells. Concatenation and joins
check their resulting shapes before output allocation, including one-to-many
join expansion. Shape ceilings apply to each intermediate/result table, not the
sum of all retained tables. Decoded bytes are not a process RSS bound: third-party
decoder internals, cell objects, cloning and host-owned inputs add overhead.

Rust exposes `api::load_assembled_with_limits`,
`materialize::assemble_with_limits` and `materialize::loaders::read_table_with_limits`.
CLI: `nirs4all-io load X.csv --limits '{"max_rows":200000}'` (trusted opt-out:
`--limits '"unlimited"'`). C ABI 0.3 adds
`n4io_load_summary_with_limits(ctx, input, conventions, limits_json, out)`;
the old `n4io_load_summary` remains ABI-compatible and uses defaults. R accepts
`nio_load(input, limits=list(max_rows=200000))`; MATLAB/Octave accepts
`nirs4all_io.load_summary(input, [], struct('max_rows', 200000))`.

Scope: native file-backed CSV, gzip/ZIP CSV, Parquet and assembly. The Python
oracle's NumPy/Excel/vendor readers and the filesystem-free WASM API are not
protected by this native read policy. Already-materialized `DatasetPackage`
objects are returned/adapted without reading or revalidating their memory use.
`infer`, `validate` and `to_spec` are not configurable materialization entry
points. Hosts remain responsible for their own input buffers, directory
enumeration, decoder isolation and stricter process-level resource limits.

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

### Rust `DatasetPackage` provider (DATA-002)

`crates/nirs4all-io-dagml` exposes a production-shaped, Rust-only bridge from
the canonical package into `dag-ml-data`:

```rust
let provider = PackageProvider::from_package(&package)?;
// For a package with several feature sources, select one; this is not fusion.
let provider = PackageProvider::from_package_source(&package, "nir")?;

let names = provider.target_names();
let features = provider.feature_block_f64(view_handle)?;
```

The provider retains the package manifest root as the exact data-content
fingerprint (and target-content fingerprint when targets exist), preserves
stable target-column order, and exposes a typed row-major f64 feature block.
DATA-002 accepts one selected dense numeric matrix; it refuses N-D, sequence,
record, mask, URI and processing-stack payloads rather than flattening them.
Multi-source fusion remains an explicit `dag-ml-data` provider concern. This
does not add a Python `load(..., target="dag-ml-data")` mode.

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
# Native Python input adapters

The production Python binding accepts NumPy `X`, `(X, y)`, `(X, y, split)` and
`{"X": X, "y": y, "metadata": frame}`. Arrays are transported as typed frames to
the existing Rust in-memory assembler; the binding does not implement a second
join or partition engine. Split labels are explicitly `train`, `test` or
`predict`, exactly one per row; no random split is inferred. X-only input retains
the historical `predict` partition. Missing array values remain missing without
dropping observations or features. Shape and byte limits are admitted before
array-to-list conversion and checked again at the native transport entry.
Infinite values fail explicitly because the JSON dataset wire cannot represent
them; they are never silently replaced by missing values.
Both SpectroDataset adapters decode the assembled target codebooks before
delegating numeric label conversion to the modelling library. Raw text labels
and their meaning therefore survive partition-local category ordering; invalid
codes are rejected, not silently reinterpreted as numeric regression targets.

YAML configuration files in the Python binding use PyYAML's safe YAML 1.1
loader, then the same native normalizer, validator and assembler as JSON. Paths
are relative to the config file unless `base_dir` overrides it. Config reads
count toward the host's aggregate input budget. Default YAML config admission
is 2 MiB, depth 64 and 100,000 expanded nodes; explicit host `max_file_bytes` can
raise the byte cap. Cyclic aliases, excessive alias expansion, unsafe tags and
non-JSON values are rejected before native conversion. This Python-owned YAML
shim does **not** imply YAML-file support in the Rust CLI or C ABI.

`DatasetPlan` retains its JSON mapping surface and exposes historical decision
attributes (`plan.structure.value`, `plan.task_type.score`), `calibration`,
`to_dict()` and `accept(**overrides)`. `load(plan)` materializes only the resolved
specification, not the plan's scored decision dictionaries. `infer(hints=None)`
and empty mappings work consistently. Non-empty `hints` were dormant in the
oracle and are now explicitly rejected before input reads in both Python
surfaces; edit/review the resolved spec instead of assuming hints were applied.
