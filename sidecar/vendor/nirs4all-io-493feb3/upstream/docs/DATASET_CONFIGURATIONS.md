# Dataset configurations — the complete reference

```{note}
This reference is written against the Phase-1 Python MVP (the parity oracle), so
a few Python snippets use MVP-only spellings. The `DatasetSpec` vocabulary it
documents is the canonical, byte-identical contract shared with the published
wheel; for the published wheel's `infer` / `to_spec` / `validate` / `load` API,
see [Getting started](getting_started.md).
```

> **What can `nirs4all-io` load, and how do you declare it?** This document
> enumerates **every** way to describe a dataset for loading: every input form,
> every `DatasetSpec` field, every column selector, merge mode, join, partition,
> fold and loading parameter — plus a use-case cookbook mapping *what you have on
> disk* to *the exact declaration*.
>
> It is grounded in what is **actually implemented** (Phase-1 MVP). Each option
> carries a status:
>
> | | meaning |
> |---|---|
> | ✅ | implemented + tested |
> | 🟡 | implemented with a documented limitation |
> | 📋 | accepted by the schema, **not yet materialized** (planned) |
>
> The canonical machine contract is [`../src/nirs4all_io/spec/dataset_spec.schema.json`](../src/nirs4all_io/spec/dataset_spec.schema.json)
> (JSON Schema). The public API is in [`API.md`](API.md).

---

## 0. How a dataset is loaded

```python
import nirs4all_io as nio

ds  = nio.load(<input>, target="spectrodataset")   # -> nirs4all SpectroDataset (default)
asm = nio.load(<input>, target="assembled")         # -> target-agnostic AssembledDataset
plan = nio.infer(<input>)                            # -> scored DatasetPlan (+ resolved_spec)
ds  = nio.load(plan.accept(overrides))               # accept/edit a plan, then load
```

Pipeline: **Resolve** (normalize input) → **Infer** (optional, scored) →
**Configure** (`DatasetSpec`) → **Materialize** (load + merge + join → target).

---

## 1. Input forms — what you can pass to `load` / `infer`

| Input | Status | Example | Notes |
|---|---|---|---|
| Directory path | ✅ | `nio.load("data/mango/")` | scanned with conventions (default `nirs4all-classic`) |
| Single file | ✅ | `nio.load("data.csv")` | one `features`/`mixed` source; `infer` adds column roles |
| List of files | ✅ | `nio.load(["Xcal.csv", "Ycal.csv"])` | resolved to **absolute** paths, matched to conventions |
| Glob | ✅ | `nio.load("batches/*.csv")` | expanded deterministically |
| Config **dict** | ✅ | `nio.load({"sources": [...]})` | a `DatasetSpec` dict (alias-normalized) |
| Legacy dict | ✅ | `nio.load({"train_x": "X.csv", "train_y": "Y.csv"})` | legacy keys → spec (see §12) |
| JSON / YAML file | ✅ | `nio.load("dataset.yaml")` | parsed + alias-normalized |
| `DatasetSpec` object | ✅ | `nio.load(spec)` | `spec.validate()` first |
| `DatasetPlan` object | ✅ | `nio.load(plan)` | uses `plan.resolved_spec` (absolute paths) |
| In-memory `(X, y)` | ✅ | `nio.load((X, y))` | → one `train` partition |
| In-memory `X` only | ✅ | `nio.load(X)` | → one `predict` partition |
| In-memory `(X, y, split)` | ✅ | `nio.load((X, y, split))` | `split` = per-row `"train"/"test"/"predict"` |
| Dict-of-arrays | ✅ | `nio.load({"X": X, "y": y, "metadata": M})` | |
| `nirs4all-formats` RecordSet | 🟡 | `nio.load(record_set)` | resolver accepts it; full materialization needs `nirs4all-formats` |
| Prebuilt `SpectroDataset` | 🟡 | passthrough | resolver wraps it |

---

## 2. `DatasetSpec` — top-level fields

```yaml
schema_version: 1                 # required (migration-gated)
name: mango                       # dataset name
description: "..."
task_type: auto                   # auto | regression | binary | multiclass
sample_index: { ... }             # identity (§3)
signal_type: auto                 # global default (§9)
conventions: [nirs4all-classic]   # profiles applied during inference (§10)
sources: [ ... ]                  # >=1 source (§4) — the core
partitions: { ... }               # split a combined input (§7)
folds: { ... }                    # cross-validation folds (§8)
aggregate: { ... }                # sample-level aggregation (§11)
repetition: Sample_ID             # repetition grouping (§11)
params: { ... }                   # GLOBAL loading params, lowest precedence (§6)
validation: { check_file_existence: true, allow_train_only: true, allow_test_only: true }
```

| Field | Status | Values |
|---|---|---|
| `schema_version` | ✅ | `1` |
| `task_type` | ✅ | `auto` (default, detected at build), `regression`, `binary`, `multiclass` |
| `signal_type` | ✅ | see §9 |
| `conventions` | ✅ | list of profile names / paths / inline dicts |
| `sources` | ✅ | ordered list, ≥1 must yield features |
| `partitions` / `folds` / `aggregate` / `repetition` | ✅/🟡 | see §7/§8/§11 |

---

## 3. Sample identity — `sample_index`

Identity is kept **distinct** from per-source alignment keys and join keys.

`to_dag_ml_data()` is stricter than `load(target="assembled")`: it emits only
when `sample_index.by: id` has a scalar, sample-aligned `key`. It carries that
key plus the optional observation/repetition/group columns into the relation
table verbatim; it never creates row-number IDs. Repeated sample IDs additionally
require `observation_id`. Source ids, sample metadata, target labels, weights,
and partition/fold provenance are retained in the envelope. The full schema is
stored under `metadata.io.dataset_schema` because the coordinator envelope's
native schema field is fingerprint-only; augmentation `origin_id` remains `None`
because v1 assembly has no origin relation. Fold assignments are provenance
metadata, not a `dag-ml-data` provider/FoldSet.
`DatasetPackage` wire summaries use version 3 for this contract: their single
`identity` object contains both `provenance` and `row_position_fallback`.
`AssembledDataset` JSON summaries/full exports use explicit
`assembled_schema_version: 2`; this replaces the former unversioned v1 artifact
because identity, source ids, and stable fold provenance are now required.
Consumers must reject the old artifact instead of assuming v3/package semantics
are backwards compatible.

```yaml
sample_index:
  by: row            # row (default) | id
  key: Sample_ID     # column (or [composite]) when by=id
  observation_id: scan_id    # 🟡 parsed for the dag-ml `SampleRelationTable`; not used at SpectroDataset materialization (see below)
  repetition_id: scan_id     # ✅ feeds set_repetition
  group_id: site             # 🟡 parsed for dag-ml leakage groups; not used at SpectroDataset materialization
```

| `by` | Status | Meaning |
|---|---|---|
| `row` | ✅ | sample identity = row position (default) |
| `id` | ✅ | sample identity = a key column; requires `key` |

> **Why `observation_id` / `group_id` are 🟡** — These two fields are accepted
> in the IR (and round-trip through JSON/YAML, schema-validated, surfaced by
> `infer()`) because they are first-class concepts in the `dag-ml-data`
> bridge (`origin_id` ↔ `origin_sample_id` resolution and leakage groups). The
> current `to_spectrodataset` materializer does **not** consume them: nirs4all's
> `SpectroDataset` exposes `add_samples` / `add_targets` / `add_metadata` /
> `set_repetition` / `set_folds` / `set_aggregate` -- but no first-class slot
> for "observation" or "leakage group". Extending `SpectroDataset` to carry
> them would be a host-side change; it is **out of scope for `nirs4all-io`**
> (see [`ROADMAP.md`](ROADMAP.md)). In the meantime, store either field as a
> regular metadata column (`role: metadata` on the source) and read it back
> via `dataset.metadata({...})[<col>]`.

**`infer()` detects the sample-id automatically** ✅: it scores each column by id-like
name (`sample_id`/`id`/`name`/`code`/`*_id`/…) + uniqueness + dtype, sets
`sample_index: {by: id, key: <col>}`, keys the cross-file joins by it, and runs a
**coverage audit** — reporting which samples have **no target** or **no metadata**,
duplicate ids, and whether a metadata source is **per-sample (1:1)** or a **shared
dimension table (m:1)**. See `plan.identity` and `plan.alignment`.

**Repeated measurements** ✅: a *systematically* non-unique sample id (avg ≥ 1.5
rows/sample) is inferred as repetitions → `repetition: <id>` + `aggregate`
(`median`, or `vote` for classification). For **vendor corpora** (one file per
spectrum, no id column), the identity falls back to `filename_stem`; and replicate
files of the same sample (`mango_001_a/_b/_c → mango_001`) are detected and grouped
via a **derive** rule:

```yaml
sample_index:
  by: id
  key: sample_id                 # the grouped sample id (materialized at load)
  repetition_id: filename_stem   # the per-file replicate
  derive: { from: filename_stem, strip_suffix: '[_\-. ][a-z]$' }   # mango_001_a -> mango_001
repetition: sample_id
aggregate: { by: sample_id, method: median }
```

The loader **materializes** `key` by stripping `strip_suffix` from `from`
(recognized replicate suffixes: `_a/_b`, `_rep\d+`, `_r\d+`, `_scan\d+`, `_dup`,
`(\d)`; a bare trailing number is treated as a sample number, not a replicate).

---

## 4. Sources — `sources[]`

A source declares one input and how its columns map to roles.

```yaml
sources:
  - id: measurements          # required, unique
    role: mixed               # features | targets | metadata | weights | ignore | mixed
    kind: table               # table (default) | lookup
    modality: spectroscopy    # spectroscopy | markers | metadata | image  (optional)
    input: [a.csv, b.csv]     # path | glob | [paths] | {array} | {record_set} | {spectrodataset}
    merge: concat_samples     # how a multi-file input is combined (§5)
    partition: train          # train | test | val | predict | auto  (optional)
    key: Sample_ID            # alignment key(s): str | [composite] | "filename_stem"
    columns: [ ... ]          # per-column role selectors (§5.1) — for role: mixed
    strict_columns: true      # true (disjoint required) | false (first-match-wins)
    join: { ... }             # relational join onto another source (§5.2)
    params: { ... }           # per-source loading params, override global (§6)
    variations: [ ... ]       # pre-computed preprocessing variants (§4.1)
```

### Source `role`

| `role` | Status | Meaning |
|---|---|---|
| `features` | ✅ | the whole source is X (one source = one feature block) |
| `targets` | ✅ | the whole source is Y |
| `metadata` | ✅ | the whole source is metadata |
| `weights` | ✅ | per-sample training weights (sklearn-style `sample_weight`); surfaced on the SpectroDataset as a `__sample_weight__` metadata column |
| `ignore` | ✅ | dropped |
| `mixed` | ✅ | per-column roles come from `columns` (default when `columns` given, no `role`) |

### Source `kind`

| `kind` | Status | Meaning |
|---|---|---|
| `table` | ✅ | a normal sample source |
| `lookup` | ✅ | a dimension table joined `m:1`; not itself a sample source; its columns keep their declared roles when broadcast |

### 4.1 Variations — pre-computed preprocessing variants

A **variation** is a pre-computed transformation of a feature source's spectra
(e.g. an SNV-applied or MSC-applied copy produced by a vendor tool), supplied as
an additional file. Variations are **not** new samples (use `merge: concat_samples`),
**not** repetitions (use `sample_index.repetition_id`), and **not** augmentations
(those are pipeline-side). They populate the *processings* dimension of the
parent feature source on the SpectroDataset:

```yaml
sources:
  - id: spectra
    role: features
    input: raw_spectra.csv
    variations:
      - { name: snv, input: snv_spectra.csv }
      - { name: msc, input: [msc_lot1.csv, msc_lot2.csv] }   # concat_samples-style
```

Materialization rule: one `ds.add_features(<array>, ["<name>"], source=<idx>)`
per variation on the parent source. The variation file must row-align with the
parent (post-merge) and provide the same number of feature columns; column
headers are matched by name when possible, else positionally. Joins or
partitions that reorder the parent's rows propagate automatically to its
variations (each source carries a hidden `__src_row_idx__` index column).

`status: ✅` implemented end-to-end in `to_spectrodataset`.

---

## 5. Column selectors — `columns` (E.1)

For a `mixed` source, `columns` assigns each column a role. X/Y/metadata may be
**mixed and interleaved** in one file. Two forms:

```yaml
# ordered list (canonical) — evaluated top-to-bottom
columns:
  - { role: features, select: { regex: '^\d+(\.\d+)?$' } }
  - { role: targets,  select: [protein, moisture] }
  - { role: metadata, select: rest }

# map shorthand — accepted only when selectors are disjoint
columns: { features: '0:-1', targets: -1 }
```

| `select` form | Status | Meaning | Example |
|---|---|---|---|
| integer / `[ints]` | ✅ | column(s) by position (negatives ok) | `-1`, `[0, 1]` |
| `"a:b"` / `"a:b:c"` | ✅ | positional slice (Python semantics) | `"2:-1"`, `":5"`, `"1:10:2"` |
| `["name", ...]` | ✅ | by header name | `["protein"]` |
| `{name_range: [a, b]}` | ✅ | contiguous header range by name | `{name_range: ["400", "2500"]}` |
| `{regex: "..."}` | ✅ | header regex (`re.search`) | `{regex: '^\d+$'}` |
| `{dtype: "..."}` | ✅ | by inferred dtype: `numeric`/`string`/`datetime`/`bool` | `{dtype: string}` |
| `"rest"` | ✅ | every column not yet assigned (**≤1 per source**) | `rest` |
| `"auto"` / `{auto: {candidates: [...]}}` | ✅ | role-aware deterministic heuristic at load time (`candidates` if any present; else by role: features→all unassigned numerics, targets→last unassigned numeric, metadata→all unassigned non-numerics, ignore→all unassigned). For nuanced choices run `infer()` and freeze the accepted plan. | |

Rules: selectors must be **disjoint** (overlap → error) unless `strict_columns: false`
(first-match-wins); **≤1 `rest`**; columns left unmatched with no `rest` → error
(no silent default). The join/identity key is **never** a column role — it is
`key:`/`sample_index`, and is exempt from the unassigned-column check.

### 5.1 Roles are honored on broadcast

A `lookup` source's contributed columns keep the role assigned in its own
`columns` — a lookup can broadcast `metadata` **or** `targets` (`m:1`).

---

## 5.2 Multi-file merge + relational joins (E.2)

### Merge a multi-file `input` (`merge:`)

| `merge` | Status | Meaning |
|---|---|---|
| `concat_samples` | ✅ | vertically stack rows (schema-union; per-row origin tracked; materializes `filename_stem`) |
| `concat_features` | ✅ | horizontally stack column-blocks for the same samples (aligned by `key`, else row order; clashing names namespaced) |
| `by_key` | ✅ | relational 1:1 join of the listed files on `key` |
| `none` | ✅ | single file (default) |

### Cross-source join (`join:`)

```yaml
join: { left: measurements, right: sites,
        left_on: site_code, right_on: site_code,   # or composite: [a, b]
        cardinality: m:1, coverage: complete }
# shorthand: { to: sites, on: site_code, how: m:1 }   # how == cardinality alias
```

`nirs4all-io` performs every join itself (dag-ml-data does not join).

| `cardinality` (`how`) | Status | Meaning | Duplicate-key rule |
|---|---|---|---|
| `1:1` | ✅ | aligned by key or row | duplicate on **either** side → error |
| `m:1` | ✅ | lookup/dimension: many left → one right, right broadcast | duplicate **right** key → error |
| `1:m` | ✅ | one left → many right (sample axis grows) | duplicate **left** key → error |

| `coverage` (unmatched left keys) | Status | Behavior |
|---|---|---|
| `complete` | ✅ | assert every left key matches; else error with the full missing set |
| `warn` | ✅ | keep all, warn, null-fill right columns |
| `drop` | ✅ | drop unmatched left rows (recorded in a dropped-row audit) |
| `error` | ✅ | hard error on the first miss |

> Cardinality/duplicate violations are **always** errors, independent of `coverage`.
> `m:1`/`1:m` require explicit `left_on`/`right_on` (the shorthand `on` sets both);
> a per-source `key` is *alignment*, never a relational join key.

### Keys

| key form | Status | Example |
|---|---|---|
| single column | ✅ | `key: Sample_ID` |
| composite | ✅ | `key: [plot, date]` |
| virtual `filename_stem` | ✅ | for vendor corpora: the per-file stem, materialized from `concat_samples` |

---

## 6. Loading parameters — `params` (precedence: source > global)

```yaml
params:
  delimiter: ";"
  decimal_separator: "."
  has_header: true
  header_unit: cm-1            # nm | cm-1 | none | text | index
  signal_type: auto
  encoding: utf-8
  na:
    policy: auto               # auto(=abort) | abort | remove_sample | remove_feature | replace | ignore
    fill: { method: value, fill_value: 0, per_column: true }   # method: value|mean|median|forward_fill|backward_fill
  categorical: auto            # auto | preserve | none
  format:                      # format-specific
    sheet_name: 0              # Excel
    usecols: null              # CSV/Excel
    columns: null              # Parquet
    variable: null             # MATLAB/.npz
    key: null                  # .npz
    member: null               # archive member
```

Root-level shorthand (A.12/75): `delimiter`/`has_header`/… may be placed at the
top level of a **legacy** dict and are folded into `params`. ✅

| NA `policy` | Status | Behavior |
|---|---|---|
| `auto` | ✅ | resolves to `abort` |
| `abort` | ✅ | raise on any NA (reports first NA cell) |
| `remove_sample` | ✅ | drop rows with any NA |
| `remove_feature` | ✅ | drop columns with any NA (warns if >10%) |
| `replace` | ✅ | fill via `fill.method` (value/mean/median per-column; ffill/bfill row-wise) |
| `ignore` | ✅ | keep NA |

| `categorical` | Status | Behavior |
|---|---|---|
| `auto` | ✅ | factorize non-numeric target columns (codes + category map) |
| `preserve` / `none` | ✅ | numeric coercion only |

---

## 7. Partitions — `partitions` (split a combined input)

`nirs4all-io` is a **loader, not a splitter**. Only modes that are deterministic
by construction are supported -- the partition is fully determined by the spec
itself (a column or an index list), never by a shuffle+cut. If you want a
70/30 split, pre-compute the indices once and pass them as `by: index`, or do
the split inside your pipeline's CV layer.

```yaml
partitions:
  by: column                 # column | index | index_file | files
  column: set
  train_values: [cal]
  test_values: [val]
  predict_values: []
  unknown_policy: train      # train | test | drop | error
  train: [0, 1, 5, 7]        # index form: explicit row-index lists
  test:  [2, 3, 4, 6]
  predict: [8, 9]
  train_file: train_idx.txt  # index_file form: each file holds one index per
  test_file:  test_idx.txt   # line (or a JSON array, or comma-separated)
  predict_file: predict.txt
```

| `by` | Status | Meaning |
|---|---|---|
| `column` | ✅ | split on a column's values (`train_values`/`test_values`/`predict_values` + `unknown_policy`) |
| `index` | ✅ | explicit row-index lists per partition (must be disjoint, in-range, no duplicates) |
| `index_file` | ✅ | row-index lists read from `train_file` / `test_file` / `predict_file` (JSON array, one-per-line text, or comma-separated) |
| `files` | ✅ (implicit) | use per-source `partition:` instead of a single combined source |

> Train/test/val/predict as **separate files** is expressed by putting `partition:`
> on each source (or by folder conventions), not by `partitions.by`.

---

## 8. Folds — `folds`

```yaml
folds:
  inline: [ { train: [0,1,2], val: [3,4] } ]   # ✅ explicit
  file: folds.csv                               # ✅ external file
  format: auto                                  # auto | csv | json | yaml | txt
  column: cv_fold                               # ✅ each distinct value -> one fold (val = its rows, train = rest)
```

Exactly one of `inline` / `file` / `column`. Fold-file formats (`format:`):

| format | Status | Structure |
|---|---|---|
| `csv` (nirs4all) | ✅ | one column per fold = that fold's **train** ids; val = complement |
| `csv` (assignment) | ✅ | a `fold` column = each row's **val** fold; train = complement |
| `json` / `yaml` | ✅ | `[{train: [...], val|test: [...]}, ...]` |
| `txt` | ✅ | even lines, alternating train/val (comma-separated ints) |

---

## 9. Signal type — `signal_type`

Global default or per-source (`params.signal_type`). Values: `auto` (detected
from values, abstains when ambiguous), `absorbance`, `reflectance`,
`reflectance%`, `transmittance`, `transmittance%`, `log(1/R)`, `kubelka-munk`. ✅

---

## 10. Conventions (folder/file-name profiles)

`conventions: [name | path | inline-dict]`. Built-ins (✅):

| Profile | Recognizes |
|---|---|
| `nirs4all-classic` | `Xcal/Xval/Ycal/Yval`, `Xtrain/Xtest/...`, `M/Meta/metadata*`, bare `X/Y/M`, fold files (verbatim `FolderParser` patterns) |
| `train-test` | sklearn-ish `X_train/X_test/y_train/y_test` |
| `bare` | single-partition `X/Y/M` |
| `vendor-corpus` | a folder of vendor spectra (sniffed via `nirs4all-formats`) + a reference table joined by `filename_stem` 🟡 (needs `nirs4all-formats`) |

Matching: case-insensitive, word-boundary for short patterns (≤2 chars),
multi-match → multi-source, bare-stem second pass, extension set from the formats
registry (CSV family by default).

---

## 11. Aggregation & repetition

```yaml
repetition: Sample_ID                         # ✅ group repeated measurements
aggregate: { by: Sample_ID, method: median,   # ✅ mean | median | vote | robust_mean
             exclude_outliers: true, outlier_threshold: 0.95 }
```

These map to `SpectroDataset.set_repetition` / `set_aggregate*` at materialization.

---

## 12. Legacy / alias keys

A legacy dict (or aliased keys) is normalized into `sources` + `partitions`:

```yaml
{ train_x: Xcal.csv, train_y: Ycal.csv, test_x: Xval.csv, test_y: Yval.csv, folds: folds.csv }
```

Accepted alias families (verbatim from nirs4all's normalizer) — partition × role:

- **train** ← `train`, `trn`, `cal`, `calibration`, `fit`
- **test** ← `test`, `tst`, `val`, `validation`, `eval`, `holdout`, `predict`, `inference`
- **features** ← `x`, `feature(s)`, `spectrum`, `spectra`, `signal(s)`
- **targets** ← `y`, `target(s)`, `label(s)`, `response(s)`
- **metadata** ← `group(s)`, `meta`, `metadata`, `m`, `samplemeta(data)`

…combined every way (`xtrain`, `X_cal`, `calibration_features`, …) plus
`*_filter` (column selection) and `*_params` variants, and `folds`/`cv`,
`folder`/`dir`/`path`, `task_type`/`problem_type`, `aggregate*`, `repetition`.
`*_x_filter`/`*_y_filter`/`*_group_filter` ✅; `Y`-from-`X`-columns via
`train_y_filter` without `train_y` ✅.

---

## 13. Supported file formats

| Format | Extensions | Status | Via |
|---|---|---|---|
| CSV / TSV / text | `.csv .tsv .txt` (+ `.csv.gz` `.csv.zip`) | ✅ | copied loader |
| NumPy | `.npy .npz` (+ key) | ✅ | copied loader |
| Parquet | `.parquet .pq` (+ columns) | ✅ | copied loader |
| Excel | `.xlsx .xls .xlsm` (+ sheet/usecols/skiprows) | ✅ | copied loader |
| MATLAB | `.mat` (v5 + v7.3, + variable) | 🟡 | needs `scipy`/`h5py` |
| Vendor spectra | OPUS/JCAMP/SPC/ASD/SED/SIG/… | 🟡 | `nirs4all-formats` (lazy; never reparsed here) |

---

## 14. Supported vs out-of-scope on-disk layouts

**Supported** ✅: mixed X/Y/metadata columns; positional or keyed 1:1; `concat_samples` /
`concat_features`; `m:1` lookups (roles honored); composite + virtual (`filename_stem`)
keys; schema-union concat; recursive globs; train/test/val/predict; external folds;
multi-source X; in-memory arrays.

**Out of scope** (the plan must detect + refuse, not mis-load): long/tidy → wide
**pivot**; **ragged** per-row wavelength grids; arbitrary nested **JSON/NDJSON**;
database/SQL sources.

---

## 15. Use-case cookbook (what you have → what you write)

Each case is verified by `tests/test_cookbook.py` (the coverage matrix fails if any
selector/merge/join/coverage/partition/fold element loses its fixture).

```yaml
# L.1 — one CSV, all spectra, predict-only
sources: [{ id: x, role: features, input: spectra.csv, partition: predict,
            params: { header_unit: nm } }]
```
```yaml
# L.2 — one CSV, spectra + last column target
sources: [{ id: d, role: mixed, input: data.csv,
            columns: { features: '0:-1', targets: -1 } }]
```
```yaml
# L.3 — X/Y/metadata mixed in one file (regex + names + dtype + rest)
sources: [{ id: d, role: mixed, input: data.csv, key: id,
            columns: [ { role: features, select: { regex: '^\d' } },
                       { role: targets,  select: [protein] },
                       { role: metadata, select: { dtype: string } } ] }]
```
```yaml
# L.4 — three files X / Y / metadata, row-aligned (1:1)
sources:
  - { id: x, role: features, input: X.csv }
  - { id: y, role: targets,  input: Y.csv, join: { to: x, how: '1:1' } }
  - { id: m, role: metadata, input: M.csv, join: { to: x, how: '1:1' } }
```
```yaml
# L.5 — X.csv + Y.csv aligned by an id column (not row order)
sample_index: { by: id, key: Sample_ID }
sources:
  - { id: x, role: features, input: X.csv, key: Sample_ID }
  - { id: y, role: targets,  input: Y.csv, key: Sample_ID,
      join: { to: x, on: Sample_ID, how: '1:1', coverage: complete } }
```
```yaml
# L.6 — many batch CSVs stacked (same schema)
sources: [{ id: d, role: mixed, input: 'batches/*.csv', merge: concat_samples,
            columns: { features: { regex: '^\d' }, targets: [y] } }]
```
```yaml
# L.7 — two instrument blocks for the same samples, hstacked by key
sources: [{ id: x, role: features, input: [nir.csv, mir.csv],
            merge: concat_features, key: id }]
```
```yaml
# L.8 (flagship) — 3 CSVs concat_samples, X&Y mixed, m:1 complete metadata lookup
name: mango
sample_index: { by: row }
sources:
  - id: measurements
    role: mixed
    input: [batch_a.csv, batch_b.csv, batch_c.csv]
    merge: concat_samples
    columns:
      - { role: features, select: { regex: '^\d+(\.\d+)?$' } }
      - { role: targets,  select: [protein, moisture] }
      - { role: metadata, select: [site_code, date] }
  - id: sites
    kind: lookup
    input: sites.csv
    columns: [ { role: metadata, select: rest } ]   # roles honored on broadcast
    join: { left: measurements, right: sites,
            left_on: site_code, right_on: site_code, cardinality: m:1, coverage: complete }
```
```yaml
# L.9 — train/test as separate files (or just a folder + convention)
sources:
  - { id: xtr, role: features, input: Xcal.csv, partition: train }
  - { id: ytr, role: targets,  input: Ycal.csv, partition: train, join: { to: xtr, how: '1:1' } }
  - { id: xte, role: features, input: Xval.csv, partition: test }
  - { id: yte, role: targets,  input: Yval.csv, partition: test, join: { to: xte, how: '1:1' } }
# equivalently:  nio.infer("folder/", conventions=["nirs4all-classic"])
```
```yaml
# L.10 — one combined file split by a column
sources: [{ id: d, role: mixed, input: all.csv,
            columns: { features: { regex: '^\d' }, targets: [y], metadata: [set] } }]
partitions: { by: column, column: set, train_values: [cal], test_values: [val], unknown_policy: train }
```
```yaml
# L.11 — explicit row-index split (pre-computed; deterministic by construction)
sources: [{ id: d, role: mixed, input: all.csv, columns: { features: '0:-1', targets: -1 } }]
partitions: { by: index, train: [0, 1, 2, 3, 4, 5, 6], test: [7, 8, 9] }
```
```yaml
# L.12 — predefined CV folds from a file
sources: [{ id: x, role: features, input: X.csv }, { id: y, role: targets, input: Y.csv, join: { to: x, how: '1:1' } }]
folds: { file: folds.csv, format: auto }
```
```yaml
# L.13 — multi-source (NIR + markers), shared targets, joined by id
sample_index: { by: id, key: id }
sources:
  - { id: nir,     role: features, modality: spectroscopy, input: nir.csv,     key: id }
  - { id: markers, role: features, modality: markers,      input: markers.csv, key: id, join: { to: nir, on: id, how: '1:1' } }
  - { id: y,       role: targets,  input: targets.csv, key: id, join: { to: nir, on: id, how: '1:1', coverage: complete } }
```
```yaml
# L.14 — folder of vendor spectra (OPUS) + a reference table (vendor-corpus) 🟡 needs nirs4all-formats
conventions: [vendor-corpus]
sources:
  - { id: spectra, role: features, input: 'spectra/*.0', merge: concat_samples }
  - { id: ref, kind: lookup, input: reference.csv,
      columns: [ { role: targets, select: [protein] }, { role: metadata, select: [variety] } ],
      join: { to: spectra, on: filename_stem, how: m:1, coverage: warn } }
```
```yaml
# L.15 — repeated measurements (reps) + sample-level metadata, then aggregate
sample_index: { by: id, key: sample_id, repetition_id: scan_id }
sources:
  - { id: scans, role: features, input: scans.csv, key: sample_id }
  - { id: meta,  role: metadata, kind: lookup, input: samples.csv,
      join: { to: scans, on: sample_id, how: m:1, coverage: complete } }
repetition: sample_id
aggregate: { by: sample_id, method: median }
```
```yaml
# L.16 — Excel: X on one sheet, Y on another
sources:
  - { id: x, role: features, input: book.xlsx, params: { format: { sheet_name: spectra } } }
  - { id: y, role: targets,  input: book.xlsx, params: { format: { sheet_name: refs } }, join: { to: x, how: '1:1' } }
```
```yaml
# L.17 — NumPy arrays + a metadata CSV
sources:
  - { id: x, role: features, input: X.npy }
  - { id: y, role: targets,  input: y.npy,   join: { to: x, how: '1:1' } }
  - { id: m, role: metadata, input: meta.csv, join: { to: x, how: '1:1' } }
```
```yaml
# L.18 — feature gallery: name_range + rest (strict), by_key merge, coverage drop/error, 1:m
sources: [{ id: a, role: mixed, input: wide.csv, strict_columns: true,
            columns: [ { role: features, select: { name_range: ['400','2500'] } },
                       { role: targets,  select: [protein] },
                       { role: metadata, select: rest } ] }]
# by_key:        input: [a.csv, b.csv, c.csv], key: id, merge: by_key
# coverage drop: join: { ..., cardinality: m:1, coverage: drop }
# coverage error:join: { ..., cardinality: 1:1, coverage: error }
# 1:m:           join: { ..., cardinality: 1:m, coverage: complete }
```

---

## 16. Implementation status summary

| Area | ✅ implemented | 📋 planned / 🟡 limited |
|---|---|---|
| Inputs | dir, file, list, glob, dict, JSON/YAML, spec, plan, in-memory | RecordSet/SpectroDataset passthrough 🟡 |
| Inference | structure, file roles+partitions (scored), column roles, axis, signal, task, params, **sample-id detection + per-sample y/metadata coverage audit + 1:1-vs-m:1 metadata** | scores uncalibrated (C5); abstention only on signal_type |
| Selectors | positional, slice, names, name_range, regex, dtype, rest, **auto** (role-aware heuristic) | — |
| Merge | concat_samples, concat_features, by_key, none | — |
| Joins | 1:1, m:1, 1:m × complete/warn/drop/error; composite + virtual keys | — |
| Partitions | column, **index**, **index_file**, per-source `partition` (deterministic by construction; no shuffle+cut at load time -- see §7) | — |
| Folds | inline, file (csv/json/yaml/txt), column | — |
| Params | delimiter/decimal/header/encoding/header_unit, NA policy (all), categorical, format | — |
| Aggregation | repetition, aggregate (mean/median/vote/robust_mean) | — |
| Formats | CSV/TSV/npy/npz/parquet/excel; MATLAB + vendor (OPUS/JCAMP/SPC/ASD/SED/SIG/…) via `nirs4all-formats` (lazy import, `pip install nirs4all-io[formats]`) | — |
| Weights | ✅ `role: weights` → `__sample_weight__` metadata column on the SpectroDataset | — |
| Variations | ✅ pre-computed preprocessing variants (CSV/Parquet/...) attached to a feature source → named processings via `add_features()` | — |
| Identity extensions for `dag-ml-data` | `sample_index.observation_id` / `group_id` are **parsed and carried in the IR** for the Rust `CoordinatorDataPlanEnvelope` bridge; the current `to_spectrodataset` materializer does **not** consume them (`SpectroDataset` lacks these slots -- extending it is intentionally out of scope, see [`ROADMAP.md`](ROADMAP.md)) | — |

---

## 17. Rust dataset bridge (the NIRS `dag-ml-data` type)

This vocabulary defines exactly what the NIRS-specific `dag-ml-data` bridge
must be able to represent: multi-source feature
blocks (with per-source axis unit + signal type), targets (possibly multi-Y +
categorical), metadata (incl. m:1-broadcast dimension columns), an explicit
sample identity (row or id), repetitions/groups, and externally-supplied
train/test/val/predict + folds. The `AssembledDataset` IR (per-partition
`PartitionBlock`) is the target-agnostic hand-off point: a `to_dag_ml_data`
adapter consumes the same structure that `to_spectrodataset` does today. The
Rust bridge is implemented in `crates/nirs4all-io-dagml`; `dag-ml-data` supports
`AxisKind::Wavenumber` for cm⁻¹. See [API](API.md) and the
[cross-binding qualification](IO_XLG_QUALIFICATION.md) for the supported surface.
