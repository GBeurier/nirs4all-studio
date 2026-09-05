# Architecture Decision Records (ADRs) — dag-ml-data

`dag-ml-data` carries copies of the five Phase-0 ADRs where the **data layer is the primary enforcement site**. The full set of 18 decisions lives in the sibling `dag-ml` repo (`dag-ml/docs/adr/`); only the data-relevant ones are mirrored here.

| # | Title | Status | Why it lives here |
|---|---|---|---|
| 01 | [Compatibility ledger semantics](ADR-01-compatibility-ledger.md) | accepted | Tolerance ledger drives schema/representation parity |
| 02 | [Schema evolution SLA](ADR-02-schema-evolution-sla.md) | accepted | The coordinator envelope is this repo's wire shape |
| 05 | [Repetition-aware CV invariant](ADR-05-repetition-cv-invariant.md) | accepted | **This repo enforces it** — `RepetitionLeakageValidator` in `relation.rs` |
| 06 | [Signal-type ownership](ADR-06-signal-type-ownership.md) | accepted | `RepresentationSpec.signal_type` + materialize/predict validation live here |
| 07 | [Aggregation reducers in contract](ADR-07-aggregation-reducers.md) | accepted | Canonical reducers are defined in `aggregation.rs` + conformance pack |

## Byte-identical contract

These five files **must stay byte-identical** to their copies in `dag-ml/docs/adr/`. They are cross-repo contracts: a decision that binds both layers must read the same in both places. `scripts/validate_contracts.py` (run with `DAG_ML_REPO=../dag-ml`) validates this drift in CI — editing one copy without the other fails the build.

To change a shared ADR: edit it in `dag-ml`, copy verbatim here, run the contract check in both repos, and land the paired PR. Decisions are amended by a superseding ADR, never by silent edit.

## ADRs not mirrored here

ADRs 03, 04, 08–18 govern the execution coordinator, bridge, packaging, CI, and governance — they live only in `dag-ml/docs/adr/`. Read them there when a `dag-ml-data` change touches the runtime, the C ABI lifecycle, or the release train (ADR-10).

```{toctree}
:maxdepth: 1
:hidden:

ADR-01-compatibility-ledger
ADR-02-schema-evolution-sla
ADR-05-repetition-cv-invariant
ADR-06-signal-type-ownership
ADR-07-aggregation-reducers
```
