# nirs4all-io — Rust rewrite & multi-language binding roadmap (Phase 2)

> **Purpose.** Phase 1 (the Python MVP under `src/nirs4all_io/`) was a *contract-validation* exercise:
> it pinned the `DatasetSpec` IR, the `DatasetPlan`, the convention system, the inference heuristics,
> and a parity bar against `nirs4all.DatasetConfigs`. This roadmap turns that validated contract into
> the **shipping artifact**: a robust **Rust core** doing the same `resolve → infer → configure →
> materialize` work, exposed through a **stable C ABI + idiomatic language bindings**, and wired into
> the ecosystem chain (`nirs4all-formats` upstream; `dag-ml` / `dag-ml-data` downstream; reusing
> `nirs4all-methods`’ binding conventions).

Status: **actionable plan — Codex-reviewed (two passes).** Supersedes the Phase-2 section of
[`ROADMAP.md`](ROADMAP.md); `PHASE2_GATE.md` is now GREEN (story 7.0).

---

## 0. Headline facts that change the plan

1. **Phase 2 is no longer gated.** Both blockers in `docs/PHASE2_GATE.md` are resolved in live
   `dag-ml-data` (verified at HEAD `4db6656`; the change landed in commit `5063fb0`, 2026-05-28):
   - `AxisKind::Wavenumber` is a first-class, `#[non_exhaustive]`, snake-case-serde variant
     (`dag-ml-data-core/src/model.rs`), so cm⁻¹ axes map cleanly (round-trip tested).
   - `docs/ADR-0001-nirs4all-connector-ownership.md` (**Accepted**) ratifies that **`nirs4all-io`
     owns the `SpectroDataset → CoordinatorDataPlanEnvelope` bridge**; `dag-ml-data` ROADMAP Phase 4
     is **descoped** to io. → `docs/PHASE2_GATE.md` should be flipped to **GREEN** (story 7.0).
2. **The contract is already frozen in Python — but only the parts Python emits today.** The Rust core
   must reproduce, byte-for-byte, what the Python MVP produces *now*: `to_spec(...)` and `infer(...)`
   JSON, the convention TOMLs, and the cookbook coverage matrix. **There is no Python dag-ml-data
   emitter** (`to_dag_ml_data` is Phase-2-only, `docs/ROADMAP.md`), so the envelope contract is *not*
   snapshotted from Python — it is authored in Rust (EPIC 10) and validated by the dag-ml CLIs.
3. **The ecosystem has two proven binding blueprints — we mirror per-language, not one-size-fits-all:**
   - **`nirs4all-formats`** → the Rust *workspace shape* (`*-core` / facade / `*-capi` / `*-cli` +
     `bindings/`), serde-as-wire-format, cbindgen header, golden + conformance tests, CLI fallback,
     and a **pyo3/maturin Python binding** that returns pandas/numpy/sklearn/SpectroDataset.
   - **`nirs4all-methods`** → the *C-ABI-first discipline* for the many-language case: `n4m_`-prefixed
     stable ABI, stride-aware `n4m_matrix_view_t`, `n4m_status_t`, opaque handles, never-free-across-
     boundary, committed `expected_symbols_{linux,macos,windows}.txt` + version script + runtime-dep
     audit, the normative `bindings/SPEC.md`, and ctypes/`.Call`/MEX shims. (Its sklearn estimator
     bases — `_HandleEstimator` in the `n4m/sklearn` operator layer, `_Pls4allModelEstimator` in
     `pls4all` — are a *pattern* to borrow if io ever ships an estimator, not a universal base.)

---

## 1. What is done vs. carried forward

**Done (Phase 1, Python, Codex-accepted):** DatasetSpec IR + selectors + validation; versioned JSON
Schema; alias normalizer; 4 convention profiles + cookbook coverage gate; resolver; `infer` + scored
`DatasetPlan` + column-role inference + `describe`; relational join engine; tabular loaders + NA/
categorical; assembler + lazy SpectroDataset adapter; parity oracle; import-boundary test; hardening.

**Carried forward / never built (this roadmap’s scope):**

| Item | Origin | Disposition here |
|---|---|---|
| Rust core (`resolve`/`infer`/`configure`/`materialize`) | Phase 2, D1 “B→C in two phases” | **EPIC 8** |
| C ABI + R/MATLAB/WASM bindings | Appendix I; story 1.3 | **EPIC 9, EPIC 11** |
| Cross-language goldens (the swap gate) | story **6.4** | **EPIC 7 / 12** |
| `to_dag_ml_data` emit → `CoordinatorDataPlanEnvelope` | story **4.4** / P2.1, Appendix H.2 | **EPIC 10** (now unblocked) |
| Inference calibration (Brier/ECE) | story **3.6** | deferred — needs a labelled corpus; tracked, not scheduled |
| First-class `observation_id`/`group_id`/`weights` in SpectroDataset | host-owned | out of scope; the **emit** materializes these into `SampleRelationTable` (EPIC 8/10) |
| Dead `cli.py` console-script in `pyproject.toml` | Phase 1 gap | realized by `nirs4all-io-cli` (EPIC 9); remove the dead entry |

---

## 2. Architecture decisions (ADRs — confirm during review)

- **D-R1 Contract-first, two-phase.** The Python JSON shapes are the frozen contract for what Python
  emits today (`to_spec`, `infer`). The Rust core is “correct” iff it reproduces those **byte-
  identical** goldens (story 6.4); that gate authorizes relegating/removing the Python core. The
  dag-ml-data envelope is a *new* Rust-authored contract (EPIC 10), validated by the dag-ml CLIs, not
  by a Python snapshot.
- **D-R2 Workspace layout** (mirror `nirs4all-formats`):
  ```
  crates/nirs4all-io-core/   # PURE logic, no file IO: DatasetSpec IR, DatasetPlan, conventions,
                             #   inference over a neutral FileDescription/TableProfile, alias
                             #   normalizer, validation, canonical-JSON. NO formats dep, NO fs.
  crates/nirs4all-io/        # facade: resolve + file IO + tabular loaders + join + assemble + targets.
                             #   depends on nirs4all-formats (vendor reads); optional `dag-ml-data` feature.
  crates/nirs4all-io-capi/   # C ABI (cbindgen header, n4io_ prefix). thin extern "C" over the facade.
  crates/nirs4all-io-cli/    # `infer | to-spec | validate | load | emit-dag-ml-data`.
  bindings/{python,r,matlab,wasm}/   # python = pyo3/maturin; r/matlab = C ABI shims; wasm = wasm-bindgen.
  conventions/               # TOML profiles + dataset_spec.schema.json (cross-language contract anchor).
  samples/  tests/  docs/
  ```
- **D-R3 Per-language FFI strategy (NOT one-size-fits-all).** This is the central correction from
  review:
  - **Python = pyo3-native (formats model).** It must return pandas/numpy/sklearn objects and a lazy
    `SpectroDataset`; that requires pulling materialized arrays out of the Rust facade **in-process**,
    which a thin C-ABI/ctypes layer cannot do without an array-export ABI. pyo3 links the facade crate
    directly. (Bundling `nirs4all-formats` into the wheel is a packaging spike — story 11.0.)
  - **R / MATLAB / Octave / C = C-ABI-first (methods model)**, scoped in v0 to the C-ABI **JSON
    surface** (`infer` / `to-spec` / `validate`; R also exposes the bytes-free assembled summary);
    **`emit-dag-ml-data` is reached via the `nirs4all-io-cli` fallback in v0**. **No array `load()`
    in v0** for these hosts (see D-R7). Reuse `bindings/SPEC.md`, the ABI gates, and the parity harness.
  - **WASM/JS = wasm-bindgen-native**, `infer`/`plan` over bytes/JSON, no fs.
- **D-R4 Core/facade boundary (load-bearing).** `io-core` is **pure**: it owns specs, selectors,
  scoring, conventions, and inference **over a neutral `FileDescription`/`TableProfile` interface** it
  does *not* itself populate. The **facade** owns all file IO: tabular reading (port
  `materialize/loaders.py`; do *not* reuse formats’ immature `csv_like.rs`), the relational join/
  assemble, the `nirs4all-formats` calls for vendor reads, and producing the neutral descriptions fed
  to core. Consequences: io **never re-parses vendor bytes**; **no hard dep on `nirs4all`** (the
  SpectroDataset target is Python-binding-only and lazy; import-boundary test ported); **all role/
  dataset inference stays in core**; formats emits only neutral evidence.
- **D-R5 License.** Rust crates are **`CeCILL-2.1 OR AGPL-3.0-or-later`** (not MIT like formats/
  methods/dag-ml) because they port nirs4all-derived logic. Extend `COPY_PROVENANCE.md` per ported
  block; SPDX header on every Rust file.
- **D-R6 ABI conventions.** Symbol prefix **`n4io_`** (free in live code — formats uses `n4fmt_`);
  a structured **`n4io_status_t`** + a per-context error buffer + diagnostic JSON (paths included)
  for `SpecError`; opaque dataset/plan handles; committed cbindgen header; ABI version independent of
  crate semver; `n4io_check_abi_compatibility(header_major, header_minor)` on load; `expected_symbols_*`
  snapshot diff + version script + forbidden-runtime-dep audit in CI; Windows exports handled
  explicitly (`.def`/`dllexport`, UTF-8 path policy, MSVC CI leg).
- **D-R7 What crosses the ABI (v0).** Primary surface is **strings (JSON)**: `infer`, `to_spec`,
  `validate`, plus the bytes-free assembled summary where bindings expose it. (`emit_dag_ml_data`
  stays CLI/facade-only in v0 — see story 9.2.) **No materialized arrays cross the C ABI in v0**
  (YAGNI): Python gets arrays via pyo3 in-process; R/MATLAB/C do not receive array handles. The dag-ml-data
  provider/arena path is a *runtime-provider integration* with production arenas still pending — it is
  **not** a substitute array hand-off for standalone MATLAB/C hosts. A minimal owned array/table
  export ABI (reusing the reserved `n4io_matrix_view_t` design) is **deferred to v0.1**, added only
  when a concrete C/MATLAB host needs `load`.
- **D-R8 dag-ml-data emit shape & wrapper.** io builds `DatasetSchema` + `DataPlan` (+ optional
  `SampleRelationTable`) and calls `dag_ml_data::CoordinatorDataPlanEnvelope::from_parts(&schema,
  plan, relations.as_ref())` (it computes the three fingerprints and self-validates), behind an
  optional `dag-ml-data` cargo feature. **io does NOT build dag-ml campaign artifacts** (`FoldSet`,
  `DataBinding`) — those are dag-ml’s domain. For the acceptance test, `dag-ml validate-data-binding`
  consumes the envelope as an **`ExternalDataPlanEnvelope`** (the lossy fingerprints+relations subset)
  **wrapped by a hand-authored `DataBinding` inside a `CampaignSpec`** — io supplies the envelope; the
  binding/campaign are test fixtures. (Stale io docs that say the adapter emits `FoldSet` must be
  corrected — story 10.0.)
- **D-R9 `nirs4all-methods` is NOT on the data path.** It is a sibling consumer. The only coupling is
  (a) **convention/tooling reuse** (`bindings/SPEC.md`, ABI gates, parity harness) and (b) the
  ecosystem fact that a methods PLS model later consumes an io-built dataset. No io↔methods code dep.

---

## 3. The contract anchor (do this first — it de-risks the rewrite)

Before any Rust logic is ported, **freeze the cross-language goldens (story 6.4)** from the *current
Python* implementation — **`to_spec` and `infer` only** (the surfaces Python emits today):

- For a fixed corpus (cookbook cases + inference corpus + a vendor-corpus case), snapshot
  `to_spec(input).to_dict()` and `infer(input).to_dict()`.
- **Pin a canonical-JSON spec** (UTF-8, key order, fixed float formatting, NaN/Inf policy, `\n`
  endings) shared by Python `json` and Rust `serde_json`, with round-trip tests on both sides. This is
  the **single biggest correctness risk**; resolve it (story 7.3) *before* porting.
- **Envelope goldens are produced differently:** they are authored in Rust by EPIC 10 (or as the old
  4.3 hand-authored spike) and validated by `dag-ml-data validate-envelope` + `dag-ml
  validate-data-binding` — **never** snapshotted from a (non-existent) Python emitter.

Goldens live in `tests/goldens/` (append-only) with a `NIRS4ALL_IO_ACCEPT_GOLDENS=1` re-bless path,
like formats’ `goldens.rs`. The day the Rust facade reproduces all `to_spec`/`infer` goldens, the
Python core can be relegated to a dev-only oracle (removed once bindings ship, per no-dead-code).

---

## 4. Workstreams & dependency DAG (the parallel structure)

Tracks are sized [S]/[M]/[L]/[XL] and own disjoint crates/dirs. “Port” = translate Python→Rust
preserving behaviour & goldens.

| Track | Goal | Owns (no overlap) | Depends on | Gate |
|---|---|---|---|---|
| **T0 Scaffold** [M] | workspace, dual licenses, CI skeleton, green gate, `bindings/SPEC.md` | root `Cargo.toml`, CI, `SPEC.md` | — | fmt+clippy+test green |
| **TG-1 Spec/Plan goldens** [M] | freeze `to_spec`/`infer` goldens + canonical-JSON spec + harness | `tests/goldens/`, harness | — (Python only) | reproducible from Python |
| **T1 spec/IR + neutral desc** [L] | port enums/selectors/normalize/validate/json_schema + define `FileDescription`/`TableProfile` | `io-core/src/spec/`, `io-core/src/desc.rs` | T0, TG-1 | spec goldens byte-identical |
| **T2 conventions** [M] | port profile loader + matcher (4 builtins) | `io-core/src/conventions/`, `conventions/` | T0, TG-1 | convention-match goldens |
| **T3 resolve (+security)** [M] | InputSet, identity, sha256, sidecars, ordering, **path/glob/archive limits** | `io/src/resolve/` | T0 | resolver goldens + abuse tests |
| **T4 loaders+join** [L] | tabular loaders (+NA/categorical) + relational join | `io/src/materialize/{loaders,join}.rs` | **T0, T1** | loader/join + cookbook subset |
| **T5 infer** [XL] | describe-producer + detectors + inference engine → DatasetPlan | `io-core/src/infer/` | T1 (+ neutral desc iface; **not** facade loaders) | DatasetPlan goldens byte-identical |
| **T6 assemble (+identity)** [L] | assembler (partitions/folds/variations/weights) + carry `observation/group/repetition_id` | `io/src/materialize/assemble.rs` | T1, T3, T4 | cookbook coverage matrix (Rust) |
| **T7 facade** [L] | wire resolve→infer→configure→materialize; formats integration; feed neutral desc to core | `io/src/{lib,api}.rs` | T1–T6 | **SYNC #1: all 6.4 goldens green** |
| **T8 C ABI v0** [L] | `n4io_*` JSON surface (`infer/to_spec/validate/load_summary`) + status/error model + handles; cbindgen header; symbol snapshot; version script; **Windows exports** | `io-capi/` | T7 (scaffold early) | **SYNC #2: ABI v0 frozen** |
| **T9 CLI** [M] | `infer/to-spec/validate/load/emit-dag-ml-data`; binding CLI fallback; kill dead `cli.py` | `io-cli/` | T7 | CLI golden runs |
| **T10 dag-ml-data emit** [L] | `to_dag_ml_data` → `CoordinatorDataPlanEnvelope`; AxisKind/relations map | `io/src/materialize/dag_ml_data.rs` (feature) | T1, T6 (+ **T9** for the cross-CLI gate; early prep allowed) | cross-CLI golden (validate-envelope **+** validate-data-binding via wrapper) |
| **T11 Python (pyo3)** [L] | idiomatic `infer/load/to_spec/describe`; pandas/numpy/sklearn; lazy SpectroDataset; import-boundary; wheels | `bindings/python/` | **T7** (facade crate; **not** T8) + 11.0 packaging | parity oracle + import-boundary green |
| **T12 R (C ABI)** [M] | `.Call`/extendr over C ABI; `infer/to_spec/validate/load_summary` JSON; data.frame idioms | `bindings/r/` | T8 | R smoke + plan parity |
| **T13 MATLAB/Octave (MEX)** [M] | MEX over C ABI; `infer/to_spec/validate`; classdef wrappers | `bindings/matlab/` | T8 | Octave smoke + plan parity |
| **T14 WASM/JS** [S] | wasm-bindgen `infer`/`plan` (no fs) | `bindings/wasm/` | T7 (own wasm crate) | node smoke + plan parity |
| **T15 CI/parity/release/fuzz** [L] | parity oracle, cookbook gate, goldens CI, ABI CI, dag-ml conformance CI, fuzz/property + sanitizers, release pipelines, docs | `.github/`, `fuzz/`, `docs/` | continuous | all gates wired |

**Dependency DAG (text):**
```
T0 ┬─► T1 ┬─► T4 ─┐
   │      ├─► T5 ─┤                              ┌─► T11 (py, pyo3)  ← depends T7, not T8
   │      └───────┼─────────────► T7 ──► T8 ──┬──┼─► T12 (R)
   ├─► T2 ────────┘                           │  ├─► T13 (mex)
   └─► T3 ──────────► T6 ──────────┘          │  └─► T14 (wasm, ← T7)
TG-1 ─► validates T1,T5,T7                     └─ ABI v0 has NO emit symbol ⇒ T8 ⊥ T10
                     T6 ─► T10 ─(needs T9 CLI)─► cross-CLI golden
T9 (CLI) after T7.  T15 continuous.
```
**Critical path:** `T0 → T1 → T5 → T7 → { T11 (Python) ‖ T8 → {T12,T13} }`. `T10` (emit) runs off
`T6`+`T9`, parallel to the ABI. ABI v0 deliberately excludes the emit symbol so `T8` does not wait on
`T10`.

---

## 5. How N agents map onto the tracks (waves & conflict-avoidance)

Disjoint crate/dir ownership; shared files (root `Cargo.toml`, CI, `SPEC.md`, `goldens/`) are
**T0/TG-owned**, changed via small additive PRs; `goldens/` is **append-only**.

| Wave | Parallel agents | Tracks | Exit gate |
|---|---|---|---|
| 0 | 2 | T0 scaffold ∥ TG-1 goldens (spec/plan only) | green skeleton + frozen goldens + canonical-JSON spec |
| 1 | 4–5 | T1 ∥ T2 ∥ T3 ∥ (T4 after T1 lands its types) ∥ (T8 ABI scaffold: version/abi-check/string-free/status) | each track’s goldens/units pass |
| 2 | 3 | T5 ∥ T6 ∥ T10-prep (DatasetSchema/relation mapping spike) | DatasetPlan goldens + cookbook matrix green |
| 3 | 1–2 | T7 facade (+ T9 CLI) | **SYNC #1**: Rust reproduces all `to_spec`/`infer` goldens |
| 4 | 3 | T8 finalize ABI v0 ∥ T10 finish emit ∥ T11 Python start (pyo3, off T7) | **SYNC #2** ABI v0 frozen; cross-CLI golden green |
| 5 | 3 | T12 ∥ T13 ∥ T14 | per-binding smoke + cross-binding plan parity |
| — | 1 | T15 continuous | all CI gates + fuzz; release dry-run |

Concurrency peak ≈ **5 agents** (Wave 1). Python (T11) is *not* gated on the C ABI, so it can proceed
as soon as the facade (T7) is green — pull it into Wave 4 alongside the ABI.

---

## 6. Epics & stories (continuing the Phase-1 numbering)

Phase 1 used EPIC 0–6; story IDs `n.m`; tags `[port]`/`[copy-logic]`/`[generalize]`; size `[S/M/L/XL]`;
each story carries an `AC:`. Phase 2 continues at EPIC 7.

**EPIC 7 — Rust workspace, contract anchor & policy**
- 7.0 [S] Flip `PHASE2_GATE.md` to GREEN; cite ADR-0001 + `AxisKind::Wavenumber`. *AC: gate reflects live dag-ml-data.*
- 7.1 [M] Cargo workspace + 4 crates + dual-license SPDX headers + green gate. *AC: empty workspace green.*
- 7.2 [M] `bindings/SPEC.md` (adapt from methods): raw-layer requirements + canonical-JSON contract + per-language FFI policy (D-R3). *AC: SPEC committed.*
- 7.3 [M] [port] `canonical_json()` (Rust + Python) + round-trip parity test (key order, floats, NaN/Inf). *AC: Python≡Rust on the corpus.*
- 7.4 [M] Freeze story-**6.4** goldens for `to_spec`/`infer` (NOT envelope). *AC: reproducible + re-bless path.*
- 7.5 [S] **Versioning policy**: semver rules for `DatasetSpec`/`DatasetPlan` `schema_version`, convention-profile version, canonical-JSON version, C ABI version, and the targeted `dag-ml-data` schema version. *AC: documented + asserted in CI.*

**EPIC 8 — Rust core port**
- 8.1 [L] [port] `spec` (enums, selectors, normalize, validate, json_schema) + the neutral `FileDescription`/`TableProfile` interface. *AC: spec goldens byte-identical; `dataset_spec.schema.json` unchanged.*
- 8.2 [M] [port] conventions (profiles + matcher, 4 builtins). *AC: convention-match goldens.*
- 8.3 [M] [port] resolver (identity/hash/sidecars/order) **+ resource/security limits** (root confinement, symlink policy, glob expansion cap, archive traversal/bomb guards, file-count/size limits). *AC: resolver goldens + adversarial-abuse tests.*
- 8.4 [L] [port] tabular loaders (+NA/categorical) + join engine (facade). *AC: loader/join + cookbook subset.*
- 8.5 [XL] [port] describe-producer + detectors (signal/task/column-role) + inference engine → `DatasetPlan` (operates on the neutral interface). *AC: DatasetPlan goldens byte-identical; abstention preserved.*
- 8.6 [L] [port] assembler (partitions `column`/`index`/`index_file`; folds inline/file/column; variations; weights) **+ propagate `observation_id`/`group_id`/`repetition_id` into `AssembledDataset`** (these already exist in `SampleIndex`/`dataset_spec.schema.json`; the gap is that today’s `AssembledDataset`/`PartitionBlock` does not carry them through to the emit). *AC: cookbook coverage matrix green in Rust; identity fields available to build `SampleRelationTable`.*
- 8.7 [L] facade `nirs4all-io`: resolve→infer→configure→materialize; `nirs4all-formats` vendor reads; feed neutral descriptions to core. *AC: **SYNC #1** — Rust reproduces all `to_spec`/`infer` goldens.*

**EPIC 9 — C ABI & CLI**
- 9.1 [M] ABI scaffold + **error model**: `n4io_abi_version`, `n4io_check_abi_compatibility`, `n4io_string_free`, opaque handle ZST, `n4io_status_t`, per-context error buffer, diagnostic-JSON `SpecError` mapping. *AC: header generates; C example links; error round-trips.*
- 9.2 [L] Wrap the JSON surface: `n4io_infer`, `n4io_to_spec`, `n4io_validate`, `n4io_load_summary` (+ handle lifecycle). **Emit is NOT in ABI v0** (kept in the CLI/facade) so the ABI does not depend on T10. *AC: each maps 1:1 to a facade call; round-trips a golden.*
- 9.3 [M] cbindgen committed header + `expected_symbols_{linux,macos,windows}.txt` + version script + forbidden-runtime-dep audit + **Windows exports** (`.def`/`dllexport`, UTF-8 paths, MSVC CI). *AC: **SYNC #2** ABI v0 frozen; abi-check CI green on 3 OSes.*
- 9.4 [M] `nirs4all-io-cli` (`infer/to-spec/validate/load/emit-dag-ml-data`); binding CLI fallback; remove dead `cli.py` entry. *AC: CLI golden runs; pyproject entry realized.*

**EPIC 10 — dag-ml-data emit (the unblocked Phase-2 integration)**
- 10.0 [S] Correct stale io docs (`ROADMAP.md`, `PHASE2_GATE.md`) that imply io emits `FoldSet`; state the emit boundary (io → `CoordinatorDataPlanEnvelope`; dag-ml owns `FoldSet`/`DataBinding`). *AC: docs consistent with ADR-0001.*
- 10.1 [M] Appendix H.2 mapping: `DatasetSpec`→`DatasetSchema` (+ `SourceDescriptor`/`RepresentationSpec`/`AxisSpec`; signal_type→`tags`); AxisKind map (nm→`Wavelength`, cm⁻¹→`Wavenumber`). *AC: schema fingerprint stable.*
- 10.2 [L] `SampleRelationTable` from `sample_index` (observation/sample/group/origin/repetition ids; `group_id` only when the key is a leakage unit); build `DataPlan` (hand-built or via `plan_model_input`). *AC: relation fingerprint stable.*
- 10.3 [M] `to_dag_ml_data(assembled)` → `CoordinatorDataPlanEnvelope::from_parts`; optional `dag-ml-data` cargo feature. *AC: `dag-ml-data-cli validate-envelope` passes.*
- 10.4 [M] **Cross-CLI conformance golden** (story **4.4**): emitted JSON passes `dag-ml-data-cli validate-envelope`, AND — wrapped as an `ExternalDataPlanEnvelope` referenced by a hand-authored `DataBinding` in a fixture `CampaignSpec` — passes `dag-ml validate-data-binding`. *AC: committed golden; both CLIs green in CI.*

**EPIC 11 — Language bindings**
- 11.0 [M] **Packaging spike**: how the Python wheel obtains `nirs4all-formats` (Cargo path dep linked by pyo3 vs reusing formats’ own wheel; static vs dynamic; avoid two native-reader copies). *AC: decision recorded; one reader copy.*
- 11.1 [L] Python (pyo3/maturin): idiomatic `infer/load/to_spec/describe` → DatasetPlan/pandas/numpy; sklearn-friendly projections (`to_sklearn`/`to_numpy`, mirroring formats); **lazy `SpectroDataset`** (sole nirs4all touch-point). *AC: import-boundary test green; parity oracle green; cibuildwheel wheels.*
- 11.2 [M] R: `.Call`/extendr over C ABI for `infer/to-spec/validate/load_summary` (+ `emit` via the CLI fallback); `data.frame`/`tibble` idioms. *AC: `R CMD INSTALL` + smoke + `to_spec`/`infer` parity.*
- 11.3 [M] MATLAB/Octave: MEX over C ABI for `infer/to-spec/validate` (+ `emit` via the CLI); `+nirs4all_io` classdef wrappers; Octave CI leg. *AC: Octave smoke + `to_spec`/`infer` parity.*
- 11.4 [S] WASM/JS: wasm-bindgen `infer`/`plan` (bytes/JSON, no fs). *AC: node smoke + plan parity.*

**EPIC 12 — Parity, goldens, CI, release, hardening**
- 12.1 [M] Parity oracle in CI (Rust→SpectroDataset via Python binding ≡ `nirs4all.DatasetConfigs`, `pytest -m parity`).
- 12.2 [M] Cookbook coverage gate ported to Rust (undocumented vocab = unshipped).
- 12.3 [M] Cross-language goldens CI (Python ≡ Rust ≡ each binding, byte-identical `to_spec`/`infer`).
- 12.4 [M] Cross-binding behavioral parity harness (methods-style; identical plans across bindings).
- 12.5 [M] **Fuzz/property tests + sanitizers**: spec parse, selectors, joins, canonical JSON, path resolution, loaders; C ABI under ASan/UBSan. *AC: fuzz targets in CI; no UB.*
- 12.6 [L] Release pipelines: cibuildwheel wheels, R source, **C-ABI archive** (lib + header + LICENSE), npm; OIDC publish.
- 12.7 [M] Docs: per-binding READMEs, `COMPAT.md`, Sphinx; update `STATUS.md`/`ROADMAP.md`/`API.md`; relegate or remove the Python MVP once bindings ship (no-dead-code).

---

## 7. Acceptance gates (the green gates)

- **Per-crate:** `cargo fmt --check` + `cargo clippy --workspace --all-targets -D warnings` + `cargo test --workspace` (+ `--no-default-features` build).
- **Contract (6.4):** Python ≡ Rust ≡ each binding, byte-identical `to_spec`/`infer` JSON.
- **ABI:** `expected_symbols_{linux,macos,windows}` diff + version-script + forbidden-runtime-dep audit + `n4io_check_abi_compatibility` on load; MSVC/Windows leg.
- **Parity:** Rust→SpectroDataset (Python binding) ≡ `nirs4all.DatasetConfigs` (`pytest -m parity`).
- **Cookbook coverage:** every load-supported vocabulary element has ≥1 fixture (CI-generated matrix).
- **Import-boundary:** importing the Python binding must not import `nirs4all`.
- **dag-ml conformance (4.4):** envelope passes `dag-ml-data-cli validate-envelope` **and** (wrapped as
  `ExternalDataPlanEnvelope` + `DataBinding`) `dag-ml validate-data-binding`.
- **Cross-binding parity:** `to_spec`/`infer` outputs identical across Python/R/MATLAB/WASM.
- **Robustness:** fuzz targets + ASan/UBSan clean on the C ABI.

---

## 8. Risks & resolved decisions

1. **Canonical-JSON parity** (serde vs Python `json`) — top risk; mitigated by story 7.3 *before* any port.
2. **Python FFI** — *resolved:* pyo3-native (it must hand back pandas/numpy/SpectroDataset). R/MATLAB/C
   stay C-ABI. A later pyo3-vs-ctypes revisit is unnecessary unless io drops Python materialization.
3. **Array hand-off** — *resolved (v0):* Python via pyo3 in-process; R/MATLAB/C do not get array
   handles; R can request a bytes-free assembled summary. Owned array/table export ABI is deferred. The dag-ml-data provider path is *not* the
   standalone-host array channel (arenas pending).
4. **Retire the Python MVP?** Keep as the `pytest -m parity` oracle until 6.4 + bindings are green; then
   remove (no-dead-code). Confirm end-state.
5. **Emit goldens** — *resolved:* authored in Rust (EPIC 10) / validated by the dag-ml CLIs; never
   snapshotted from Python (no Python emitter exists).
6. **`nirs4all-formats` packaging into the Python wheel** — open until story 11.0 (avoid double-bundling
   the readers).
7. **Calibration (3.6)** — stays deferred (no labelled corpus).

---

## 9. Milestones

- **M1** Scaffold green + 6.4 (`to_spec`/`infer`) goldens frozen + canonical-JSON pinned (EPIC 7).
- **M2** Rust core reproduces all Python goldens — *SYNC #1* (EPIC 8).
- **M3** C ABI v0 frozen (3-OS) + CLI — *SYNC #2* (EPIC 9).
- **M4** dag-ml-data emit passes the cross-CLI golden — Phase-2 ecosystem integration proven (EPIC 10).
- **M5** Python (pyo3) + R + MATLAB bindings green and released (EPIC 11, 12.6).
- **M6** WASM + full parity/CI/fuzz hardening; Python facade swapped to Rust; MVP relegated/removed (EPIC 12).
