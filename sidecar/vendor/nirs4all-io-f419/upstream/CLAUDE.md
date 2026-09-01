# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`nirs4all-io` is the **dataset-assembly bridge** of the nirs4all ecosystem. It turns *any*
user input — a directory, a file list, a glob, a config dict/JSON/YAML, in-memory arrays, or a
folder of vendor spectra + a reference table — into a pipeline-ready `SpectroDataset`. It owns the
dataset-level concepts that the low-level reader library (`nirs4all-formats`) deliberately does not:
X/Y/metadata **roles**, train/test/folds **partitions**, **multi-source**, relational **joins**,
signal/task-type **inference**, and a declarative **convention** system.

```
any input ──► RESOLVE ──► INFER ──► CONFIGURE ──► MATERIALIZE ──► SpectroDataset
              (InputSet)  (DatasetPlan, scored)   (DatasetSpec)    (or target-agnostic AssembledDataset)
```

**Both phases are complete.** Phase 1 is the Python MVP (`src/nirs4all_io/`); Phase 2 is a full Rust
port (`crates/`) with a C ABI, a CLI, four language bindings (`bindings/`), and the `dag-ml-data`
emit. The Rust core reproduces the Python pipeline **byte-for-byte** (canonical-JSON goldens), and
the Python MVP is **kept as the dev/parity oracle** the Rust goldens are checked against — do not
delete it. Dual-licensed `CeCILL-2.1 OR AGPL-3.0-or-later`; Python ≥3.11, Rust 2021.

There are now **two parallel implementations of the same architecture** — the Python MVP and the Rust
workspace mirror each other module-for-module. A change to load-bearing logic (spec, normalize,
conventions, infer, assemble) must usually be made in **both**, or the byte-parity goldens fail.

## Commands

### Rust workspace (the production implementation) — green gate

Run all four before reporting Rust work complete (mirrors `.github/workflows/ci.yml`):

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo build --workspace --no-default-features

# Targeted
cargo test -p nirs4all-io-core            # pure-logic crate
cargo test -p nirs4all-io contract_goldens   # one integration test target in the facade crate
cargo run -p nirs4all-io-cli -- to-spec <dir>   # exercise the CLI binary
```

The workspace has **5 members** (`crates/nirs4all-io-core`, `-io`, `-io-capi`, `-io-cli`,
`-io-dagml`). The language bindings build with their own toolchains and are deliberately
workspace-excluded — `cargo test --workspace` will NOT touch them:
- `bindings/python` (maturin/pyo3) and `bindings/wasm` (wasm-pack) — see below.

`crates/nirs4all-io-dagml` is now a workspace member. Its default Cargo dependency resolves
`dag-ml-data` from crates.io for standalone builds, while the cross-CLI conformance harness patches
Cargo to the sibling checkout when one is present.

### Python MVP / oracle — green gate

The package is installed editable. Use the ecosystem venv if one exists, else install into the active
interpreter:

```bash
pip install -e ".[dev]"      # ruff, mypy, pytest + pyarrow/openpyxl/scipy + nirs4all & nirs4all-formats (dev oracles)

ruff check .                 # lint: E,F,I,W,UP,B; line-length 220; E501 ignored
mypy .                       # type check (py311, ignore_missing_imports); excludes ^bindings/
pytest                       # all tests; parity tests auto-skip if nirs4all is absent

# Targeted
pytest tests/test_spec.py
pytest tests/test_cookbook.py::test_coverage_matrix_complete
pytest -m parity             # ONLY the parity-oracle tests (needs nirs4all installed)
pytest -m "not parity"       # everything except the parity oracle
```

Two registered pytest markers (see `pyproject.toml`): **`parity`** (imports `nirs4all` read-only as
an oracle) and **`formats`** (needs the `nirs4all-formats` reader library).

### Bindings

```bash
cd bindings/python && maturin develop && pytest tests   # pyo3; the ONLY surface that builds a real SpectroDataset
cd bindings/wasm   && wasm-pack build --target nodejs    # fs-free core only (to_spec/validate/version/assembleDataset)
cd bindings/r      && ./build_and_test.sh                # .Call over the C ABI
# MATLAB/Octave (bindings/matlab) is CI-gated; needs octave/MEX locally.
```

## Architecture: the four stages

The same four-stage pipeline exists twice, module-for-module — once in Python (`src/nirs4all_io/`,
the table below) and once in Rust (`crates/`, mapped at the end of this section). Read the Python
description first; the Rust crates own the same concepts.

Each `src/nirs4all_io/` subpackage owns one stage of the pipeline. `api.py` is the public glue.

| Stage | Module | Input → Output | Notes |
|---|---|---|---|
| **RESOLVE** | `resolve/resolver.py` | any input → ordered `InputSet` | stamps a **stable identity** (abspath / `array:<n>` / `object:<id>`), content hash, extension hint, and **sidecar grouping** (ENVI `.hdr` etc.) on every item. Deterministic ordering. Retrofitting identity later would break fingerprints, so it's foundational. |
| **CONFIGURE** | `conventions/` + `spec/normalize.py` | filenames / legacy-dict → `DatasetSpec` dict | `conventions/` matches filenames against declarative TOML **profiles**; `normalize.py` maps legacy `nirs4all` config keys + synonyms onto the canonical spec. |
| **(the IR)** | `spec/` | — | the canonical, validated, serializable `DatasetSpec`. The single source of truth. |
| **INFER** | `infer/` | `InputSet` → scored `DatasetPlan` | composes convention match + per-file `describe` + value detectors (signal/task) + **column-role inference** (the genuinely new bit) into a `DatasetPlan` whose `.resolved_spec` `load` can execute. Scores are **uncalibrated** (ranking/triage only). |
| **MATERIALIZE** | `materialize/` | `DatasetSpec` → `AssembledDataset` → `SpectroDataset` | load → merge multi-file → relational join → role-split columns → partition. |

### The `DatasetSpec` IR (`spec/dataset_spec.py`)
Everything funnels into a `DatasetSpec`; the materializers consume **only** it. It round-trips through
dict/YAML/JSON, is structurally checked by `spec/validate.py`, and has a **versioned JSON Schema**
(`spec/json_schema.py` + `dataset_spec.schema.json`, `SCHEMA_VERSION = 1`) that is the wire contract.
Closed vocabularies live in `spec/enums.py` (all `str` enums, case-insensitive `.coerce()` with a few
aliases). Column selection is a small DSL in `spec/selectors.py` (positional / slice / names /
`name_range` / `regex` / `dtype` / `rest` / `auto`).

### `AssembledDataset` is the target-agnostic seam (`materialize/assemble.py`)
`assemble(spec)` produces an `AssembledDataset` (per-partition `PartitionBlock`s: multi-source `X`,
`y`, `metadata`, headers, units, weights, named processings). `to_spectrodataset(assembled)`
(`materialize/spectrodataset.py`) adapts it to nirs4all; `DatasetPackage` wraps the same IR for
target-agnostic payload manifests; the Rust bridge crate adapts it to `dag-ml-data` via
`to_dag_ml_data(&AssembledDataset)`. Keep assembly logic target-agnostic so it stays testable
without nirs4all — `target="assembled"` is the test seam.

### The Rust workspace mirrors the Python stages, split core ↔ facade

The Rust port deliberately splits along a **pure-logic / file-IO** seam (rule below):

| Crate | Role |
|---|---|
| `nirs4all-io-core` | **Pure logic, no file IO.** Owns the `DatasetSpec` IR (`spec/`), selectors, conventions, normalize, inference over a *neutral* `FileDescription`/`TableProfile` it does **not** populate, validation, `canonical_json`, `pyfmt` (Python-`repr`-faithful float formatting), and the fs-free `materialize` (`assemble`). |
| `nirs4all-io` (the **facade**) | **All file IO.** Resolution, tabular loaders, the join engine, the `nirs4all-formats` vendor reads, and producing the neutral descriptions fed to `-core`. Wires `resolve → infer → configure → materialize`. Re-exports `-core` as `core`. |
| `nirs4all-io-capi` | C ABI (`n4io_to_spec` / `infer` / `validate`, JSON in/out; opaque context + per-context error buffer; ABI versioning). Symbol surface is drift-guarded (`abi/version_script.map`, `expected_symbols_*.txt`, `tests/abi_surface.rs`). |
| `nirs4all-io-cli` | The `nirs4all-io` binary (`infer` / `to-spec` / `validate` / `load` / `emit-dag-ml-data`). |
| `nirs4all-io-dagml` | `to_dag_ml_data(&AssembledDataset)` → `CoordinatorDataPlanEnvelope`. Uses crates.io by default; the ecosystem conformance harness patches `dag-ml-data` to the sibling checkout. |

**Canonical JSON is the cross-language contract** (`canonical_json.rs` ≡ `canonical_json.py`,
byte-identical). The frozen goldens in `tests/goldens/contract/` are shared: the Python tests, the
Rust `contract_goldens.rs`/`assembled_goldens.rs`, and the binding parity tests all assert against
them. `serde_json` runs with `preserve_order` (input map order mirrors Python dict order) **and**
`float_roundtrip` (correctly-rounded float parse matching CPython); canonical JSON sorts keys
explicitly rather than relying on the map type.

The convention TOMLs are **copied** into `-core` and kept in sync by `tests/test_convention_toml_sync.py`.

## Load-bearing rules (do not break these)

These are the architectural invariants. PRs that violate them are rejected.

1. **No runtime dependency on `nirs4all`.** `import nirs4all_io` must never import `nirs4all`; only
   `to_spectrodataset` (i.e. `load(..., target="spectrodataset")`) may lazily import it, at call
   time. Enforced by `tests/test_import_boundary.py` (runs in a subprocess and asserts no
   `nirs4all*` modules leaked). `nirs4all` is a **dev/test-only parity oracle**, never a runtime dep.

2. **Never re-parse vendor files.** Vendor byte-decoding (OPUS/JCAMP/SPC/ASD/…) is delegated to
   `nirs4all-formats`, imported lazily. Tabular loading + NA policy in `materialize/loaders.py` is
   **copied** from `nirs4all` (not re-derived) — see `COPY_PROVENANCE.md`, which maps every copied
   block source→destination. Update that manifest when you copy more logic.

3. **It's a loader, not a splitter.** All partition modes are **deterministic by construction**:
   `partitions.by` ∈ `column` / `index` / `index_file`. Percentage / stratified / shuffled splits are
   *intentionally rejected* — they belong in the pipeline's CV layer. Do not add a "random split."

4. **io owns the dataset layer; don't reimplement it up- or downstream.** roles, multi-source, joins,
   merges, partitions, folds, signal/task inference, conventions, the `DatasetSpec` IR, and
   `SpectroDataset` materialization are this repo's responsibility. The host (`nirs4all` /
   `nirs4all-studio`) keeps everything downstream of a built `SpectroDataset` (pipeline, UI, storage).

5. **Parity is the correctness bar.** For supported topologies, `load(...) → SpectroDataset` must
   equal `nirs4all.DatasetConfigs(...)` (`tests/test_parity.py`). The build flow in
   `spectrodataset.py` deliberately mirrors `DatasetConfigs._load_dataset`.

6. **`nirs4all-io-core` is pure logic — no file IO.** It performs inference over *neutral*
   `FileDescription`/`TableProfile` structs it does not populate; the **facade** (`nirs4all-io`) owns
   all filesystem access, vendor reads, and producing those descriptions. Don't pull `std::fs` or
   `nirs4all-formats` into `-core`.

7. **Byte-parity is the cross-language bar.** The Rust core must reproduce the Python MVP's
   canonical-JSON output exactly (shared goldens in `tests/goldens/contract/`). Several Python-faithful
   behaviours are reproduced **on purpose** and must not be "fixed": duplicate-basename file lists,
   non-recursive profile resolution, Python-`repr` float formatting (`pyfmt`). Touching load-bearing
   logic means updating Python + Rust together and re-freezing goldens only when the change is intended.

8. **The `dag-ml-data` emit lives in the `nirs4all-io-dagml` bridge crate.** It is a workspace
   member, but default dependency resolution stays ecosystem-free via crates.io. The cross-CLI
   conformance harness patches Cargo to the sibling `dag-ml-data` checkout when present, and CI now
   requires that sibling path. The Phase-2 gate is GREEN (`docs/PHASE2_GATE.md`), so this is
   implemented — don't reintroduce a `NotImplementedError` stub.

## Public API (`api.py`, re-exported from `__init__.py`)

```python
import nirs4all_io as nio
plan = nio.infer(<input>, conventions=[...])     # -> scored DatasetPlan (plan.resolved_spec, .recommendations, .warnings)
ds   = nio.load(<input | spec | plan>, target="spectrodataset" | "assembled", base_dir=, name=)
spec, base = nio.to_spec(<input>)                # resolve only, no materialization
desc = nio.describe(<file>)                      # neutral per-file descriptor (delimiter, header unit, axis)
# IR types: nio.DatasetSpec (.from_dict/.from_yaml/.to_dict/.validate), nio.DatasetPlan, nio.AssembledDataset
```

`load(target="spectrodataset")` accepts `spectro_dataset_cls=` to inject a recording double, so the
adapter is testable with no nirs4all installed (see `test_load_e2e.py`).

## Testing specifics

- **Cookbook coverage gate** — `tests/test_cookbook.py::test_coverage_matrix_complete` introspects
  which vocabulary each fixture spec exercises and **fails if any load-supported element**
  (selector / merge / cardinality / coverage / partition / fold / `lookup` / `variations` /
  `role:weights` / `auto`) **has zero fixtures**. Treat "added load-supported vocabulary" as
  unshipped until it has a cookbook fixture in the `CATALOGUE`.
- **Inference corpus** — `tests/test_inference_corpus.py` is a labelled-corpus per-decision precision
  check for `infer()`.
- Tests cover each stage in isolation: `test_resolve`, `test_normalize`, `test_conventions`,
  `test_spec` / `test_json_schema`, `test_infer`, `test_loaders` / `test_join`, plus `test_load_e2e`
  and `test_hardening` (adversarial inputs → clear `SpecError`s).

## Gotchas

- **The Python package has no CLI; the CLI is the Rust binary.** `crates/nirs4all-io-cli` ships the
  `nirs4all-io` binary (`infer` / `to-spec` / `validate` / `load` / `emit-dag-ml-data`); the dead
  `nirs4all_io.cli:main` console-script entry was removed from `pyproject.toml`. The Python MVP surface
  is library-only (`nio.infer` / `nio.load` / `nio.to_spec`).
- **Two `nirs4all_io` Python packages exist.** The MVP (`src/nirs4all_io/`) and the pyo3 binding's
  mixed-maturin package (`bindings/python/python/nirs4all_io`, wrapping the native `_native` module).
  The root `mypy` run excludes `^bindings/` so they don't collide; don't remove that exclude.
- **`cargo test --workspace` covers the Rust crates, including `nirs4all-io-dagml`, but not the
  bindings** — run their own toolchains (maturin / wasm-pack / R script) to test them.
- **`rtk` can mask a command's exit code.** When verifying a green gate, capture the status explicitly
  (`cmd > log 2>&1; echo $?`) rather than relying on `&&` chains.
- **YAML round-trips lists, not tuples** — specs are dict/JSON/YAML-authorable and stay `str`-enum
  clean precisely so they survive serialization; don't put tuples in a spec.
- The repo is a clean tree: **no dead/deprecated code, no backward-compat shims.** Remove rather than
  deprecate.

## Where to look it up

- `docs/DATASET_CONFIGURATIONS.md` — the **complete reference**: every input form, `DatasetSpec`
  field, selector, merge mode, join, partition, fold, loading param, supported/out-of-scope layout,
  and a use-case cookbook with honest ✅/🟡/📋 status per option. Read this before adding spec vocab.
- `docs/API.md` — the stable integration seam and how a host adopts it.
- `docs/STATUS.md` / `docs/ROADMAP.md` — per-epic state (incl. the Phase-2 EPIC 7–12 table) and the
  intentionally-deferred list.
- `docs/RUST_REWRITE_ROADMAP.md` — the Phase-2 plan: crate split rationale, EPIC breakdown, the
  canonical-JSON parity strategy. `docs/PHASE2_GATE.md` — why the `dag-ml-data` target is now GREEN.
- `docs/REPLUG.md` — host-adoption sequence and the io-vs-host ownership split.
- `docs/VERSIONING.md` — the three versioned contracts (schema / convention-profile / canonical-JSON).
- `COMPAT.md` — the per-binding operation matrix (which of infer/to-spec/validate/load each supports).
- `bindings/SPEC.md` + each `bindings/*/README.md` — the binding contract and per-language build/test.
- `COPY_PROVENANCE.md` — what was copied from `nirs4all` and how (license-compatibility record).
- `../nirs4all/CLAUDE.md` — ecosystem map and the cross-repo boundary rules.
