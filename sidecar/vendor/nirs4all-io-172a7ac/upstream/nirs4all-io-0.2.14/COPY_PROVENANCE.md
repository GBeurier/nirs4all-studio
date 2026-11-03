# Copy provenance manifest

> Story 5.4 / Critique C12. `nirs4all-io` is built by **copying and
> re-orchestrating** business logic from `nirs4all` (and, by design reference,
> `nirs4all-studio`). `nirs4all`'s default OSS license is **AGPL-3.0-or-later**
> with **CeCILL-2.1** as a variant; `nirs4all-io` is licensed
> **`CeCILL-2.1 OR AGPL-3.0-or-later`** so the copied logic stays
> license-compatible. Both projects are owned by **G. Beurier (GBeurier)**, who
> authorizes this reuse.

This file records every block of logic copied or adapted from `nirs4all` into
`nirs4all-io`, mapping the **source** (path in the `nirs4all` repo) to its
**destination** (module in this repo) and the **action** taken:

- **COPY-LOGIC** — the algorithm/data was reproduced (possibly re-architected).
- **GENERALIZE** — COPY-LOGIC + made declarative / format-agnostic / multi-target.
- **PORT** — translated across languages.
- **REFERENCE** — used only as a design reference (not copied).

| # | Source (`nirs4all/nirs4all/...`) | Destination (`src/nirs4all_io/...`) | Action | Notes |
|---|---|---|---|---|
| 2 | `data/parsers/normalizer.py` (alias map) | `spec/normalize.py` | COPY-LOGIC | partition×role synonym map reproduced verbatim |
| 4 | `data/parsers/folder_parser.py` (`FILE_PATTERNS`, word-boundary match) | `conventions/builtin/*.toml` + `conventions/engine.py` | GENERALIZE | patterns → declarative profiles; extension set widened beyond CSV |

_(rows are appended as each piece is copied)_
| 7,9,10 | `data/detection/detector.py`, `data/signal_type.py`, `core/task_detection.py` | `infer/` (pending) | COPY-LOGIC | detection heuristics distilled (HEADER_PATTERNS, signal scorers, water bands, task thresholds) — used by the inference engine |
| 11,12,13 | `data/selection/{role_assigner,column_selector,row_selector,sample_linker}.py`, `data/partition/partition_assigner.py` | `spec/selectors.py`, `materialize/assemble.py`, `materialize/join.py` | COPY-LOGIC/GENERALIZE | column selectors E.1; per-source alignment; partition (column/percentage) split |
| 14 | `controllers/splitters/fold_file_loader.py` | `materialize/folds.py` | COPY-LOGIC | fold-file parsing (csv-nirs4all/csv-assignment/json/yaml/txt) |
| 5,6 | `data/loaders/*` (`base.py::apply_na_policy`, csv/numpy/parquet/excel) | `materialize/loaders.py` | COPY-LOGIC | tabular reading + NA policy + param precedence + dtype/categorical |
| 15 | `data/config.py::_load_dataset`, `data/dataset.py` add_*/set_* | `materialize/spectrodataset.py` (build flow), `materialize/assemble.py` | COPY-LOGIC + EMIT(lazy) | build orchestration; SpectroDataset class imported lazily only |
| Studio role adapter | `nirs4all-studio/api/shared/dataset_config.py::build_nirs4all_config` at `cdb9f46de1643ab170934481cd9471e54ed3701c` | `crates/nirs4all-io-core/src/spec/role_tagged.rs::studio_legacy_config` | PORT + STRICT | permissive last-write behavior is retained only in a frozen oracle intermediate; the public adapter closes unknown/conflicting input first. Oracle source SHA-256 and generated corpus live in `tests/fixtures/role_tagged/studio_oracle_corpus.json`. |
