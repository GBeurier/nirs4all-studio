# Re-plug guide (host adoption)

```{note}
The Python snippets below use the Phase-1 MVP spelling (e.g. `plan.accept(...)`).
The published wheel exposes `plan.resolved_spec` and the module-level
`nio.validate(spec)` instead — see [Getting started](getting_started.md). The
adoption sequence and ownership split are unchanged across both.
```

> Story 5.3. `nirs4all-io` is a **standalone externalization** — it does not modify
> `nirs4all` or `nirs4all-studio`. Re-plugging the hosts onto it is a **separate,
> user-owned effort**. This guide documents the seam + a recommended sequence so
> that effort is cheap. **Nothing here changes nirs4all/studio; it is a plan.**

## Why a clean seam exists

- `nirs4all-io` has **no runtime dependency on `nirs4all`** (the future re-plug —
  nirs4all calling io — would otherwise be circular). The only touch-point is a lazy
  import of the `SpectroDataset` class at materialization.
- The contract is the JSON `DatasetSpec`/`DatasetPlan` + `infer`/`load`/`to_spec`
  (see `API.md`), all versioned (`schema_version`).
- A **parity oracle** (`tests/test_parity.py`) proves io's `SpectroDataset` equals
  nirs4all's own loader output, so a swap is behavior-preserving for covered cases.

## Recommended sequence (studio first)

1. **Studio (lowest risk).** Replace the studio backend's dataset detection/loading
   delegation (`api/datasets.py`) with `nio.infer(input).to_dict()` for the wizard's
   recommendation step, and `nio.load(plan.accept(edits))` for the load step. The
   studio already buckets confidence (0.8/0.6) — feed it `plan` scores (labelled as
   *scores*, not probabilities, until the corpus is calibrated; see `inference`).
2. **Run the parity oracle in the host's CI** on the host's own fixtures (it imports
   both nirs4all and nirs4all-io read-only) to catch drift before switching the default.
3. **nirs4all library.** Once studio is stable on io, let `nirs4all.DatasetConfigs`
   accept `dataset=<DatasetSpec | DatasetPlan | nirs4all-io result>` by delegating to
   `nio.load(...)`. Keep the legacy path until parity is green across the host's corpus.
4. **De-duplicate (host-owned, last).** Only after parity holds, the host may remove its
   now-duplicated detection/loader code. That deletion is **out of scope for nirs4all-io**.

## What stays in nirs4all-io vs the host

- **io owns**: resolve, infer, conventions, the `DatasetSpec` IR, join/merge, tabular
  loading, and `SpectroDataset` materialization.
- **host keeps**: the pipeline/runtime, UI, workspace/storage — everything downstream
  of a built `SpectroDataset`.

## Copy provenance & license

io copies CeCILL-2.1 logic from nirs4all and is dual-licensed
`CeCILL-2.1 OR AGPL-3.0-or-later` to stay compatible (see `../COPY_PROVENANCE.md`,
`../LICENSE`). The re-plug introduces no new license obligation on the hosts.
