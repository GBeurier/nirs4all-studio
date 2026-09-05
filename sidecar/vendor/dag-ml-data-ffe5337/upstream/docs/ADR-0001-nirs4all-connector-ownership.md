# ADR-0001 — nirs4all connector ownership

- Status: **Accepted**
- Date: 2026-05-28
- Tags: `connectors`, `nirs4all`, `nirs4all-io`, `scope`, `phase-2-gate`

## Context

Three documents currently claim ownership of the bridge between
`nirs4all`'s `SpectroDataset` and `dag-ml-data`'s
`CoordinatorDataPlanEnvelope`:

1. **`dag-ml-data/docs/ROADMAP.md` Phase 4 "nirs4all Connector"** — declares
   a `SpectroDataset` connector, dense signal representations and
   compatibility tests as part of `dag-ml-data`.
2. **`nirs4all-io/docs/REDESIGN_FORMATS_AND_IO.md` Appendix I** — describes
   `nirs4all-io` as the dataset-assembly bridge that materializes
   `SpectroDataset` from heterogeneous inputs and ultimately produces a
   `CoordinatorDataPlanEnvelope`.
3. **`dag-ml/docs/design/source/dag_ml_synthese.md`** — refers to
   `dag-ml-data` envelopes as the host-emitted contract that `dag-ml`
   consumes.

`nirs4all-io/docs/PHASE2_GATE.md` item 7 records the resulting blocker:
nobody knows who owns the conversion, so the connector is not buildable.

`dag-ml-data`'s `AGENTS.md` is unambiguous on what `dag-ml-data` does NOT
do: "Do not add NIRS-specific assumptions to core types." A
`SpectroDataset` connector that inspects NIRS-specific axes, source
descriptors or signal types would be exactly that violation.

## Decision

**`nirs4all-io` owns the bridge.**

- `nirs4all-io` is the only crate allowed to consume `SpectroDataset` and
  emit a `CoordinatorDataPlanEnvelope`. It depends on `dag-ml-data` for
  the envelope shape; it does not modify `dag-ml-data`'s core types.
- `dag-ml-data` accepts io-emitted envelopes through the existing C ABI
  and JSON surfaces. It treats them as opaque, schema-validated contract
  artifacts — no NIRS-specific code paths, no `SpectroDataset` awareness.
- `dag-ml-data` ROADMAP Phase 4 is **descoped**. The "nirs4all connector"
  bullet is reclassified as out-of-scope for `dag-ml-data` and moved into
  `nirs4all-io`'s Phase 2 deliverables.
- `dag-ml` continues to consume envelopes through its `dag-ml-data`
  C ABI binding without knowing about `nirs4all`.

## Consequences

### Positive

- `dag-ml-data` retains its NIRS-agnostic invariant. Every other ML
  domain (omics, audio, time series, finance) can target the same
  envelope contract without seeing spectroscopy-shaped APIs.
- `nirs4all-io` becomes the natural home for `SpectroDataset`-aware
  knowledge: signal types, repetition handling, augmentation origin,
  fold layout. That knowledge already exists there.
- The PHASE2_GATE blocker is removed: `nirs4all-io` can implement
  the bridge against the (now public) `dag-ml-data` contract surface
  without coordination on `dag-ml-data` core changes.

### Negative / mitigations

- `nirs4all-io` carries the maintenance burden of cross-crate version
  alignment with `dag-ml-data`. Mitigation: the existing
  `scripts/validate_contracts.py` runs against the published envelope
  schema digest in both repos, catching wire-shape drift before it
  reaches `nirs4all-io`.
- A NIRS-specific axis kind that has no parallel in other domains would
  still need a `dag-ml-data` core change to be representable. This ADR
  does not block such changes — it forbids `nirs4all-io`-specific
  business logic from leaking into `dag-ml-data`. The
  `AxisKind::Wavenumber` addition shipped alongside this ADR is the
  canonical example: it's a generic spectroscopy axis (used in IR
  spectroscopy, Raman, etc.), not a `SpectroDataset` representation
  detail, so it belongs in core.

## Implementation notes

This ADR is paired with:

- `AxisKind::Wavenumber` added to `crates/dag-ml-data-core/src/model.rs`
  — closes the structural blocker on `PHASE2_GATE` item 2 (`cm⁻¹` axis
  missing for IR/Raman spectroscopy).
- `docs/ROADMAP.md` Phase 4 status updated to "descoped, owned by
  `nirs4all-io`".

No `dag-ml-data` API change beyond `AxisKind::Wavenumber`. No
`dag-ml` change required. `nirs4all-io` should reference this ADR in
its own Phase 2 design when picking up the bridge.

## References

- `dag-ml-data/AGENTS.md` — `dag-ml-data` boundary (do not add
  NIRS-specific assumptions).
- `nirs4all-io/docs/REDESIGN_FORMATS_AND_IO.md` Appendix I — bridge
  scope.
- `nirs4all-io/docs/PHASE2_GATE.md` item 7 — blocker this ADR resolves.
- `dag-ml-data/docs/contracts/coordinator_data_plan_envelope.schema.json`
  — the v1 envelope contract `nirs4all-io` targets.
