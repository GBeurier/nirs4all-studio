# ADR-06: Signal-type ownership

**Status**: accepted (2026-05-28)
**Blocks**: workstream B (`RepresentationSpec.signal_type`), workstream E (bridge data provider).

## Context

nirs4all detects signal types (absorbance / reflectance / transmittance / log-reflectance / preprocessed) from value ranges on load and supports `convert_to_absorbance`. The bridge needs a clear ownership story so a load-time signal type doesn't get silently re-interpreted during pipeline execution.

Roadmap v1 proposed three options; Codex pushed back with "split it" — detection, validation, and conversion belong in different layers.

## Decision

Three layers, three responsibilities:

1. **`nirs4all-io` detects + stores signal type at load time** — heuristic per source from value ranges, written to the dataset metadata as the canonical answer. The user can override at load time via the constructor kwarg.

2. **`dag-ml-data` validates signal type at materialize and predict time** — `RepresentationSpec` carries `signal_type: Option<SignalKind>`. The materializer asserts the provider-declared signal type matches what the plan expects. On predict, the bridge asserts incoming data's signal type matches what the bundle's lineage records — mismatch raises `SignalTypeMismatch` with the conversion the user must perform first.

3. **Conversion is an explicit transform node** — `convert_to_absorbance` becomes a `dag-ml` operator that:
   - declares input `signal_type = Reflectance | Transmittance | LogReflectance`,
   - declares output `signal_type = Absorbance`,
   - appears as a node in the lineage envelope (never an invisible auto-correction).
   The bridge refuses to do the conversion silently — the user must add the node to the pipeline (or use the `nirs4all.io.normalize_signal_type(...)` helper at load time, which then writes the conversion to the dataset's lineage record).

## Consequences

- The `SignalKind` enum lives in `dag-ml-data-core::model.rs` and is re-exported through the C ABI. Workstream B task 3 lands it.
- `nirs4all`'s `SignalType` enum stays where it is (`nirs4all/data/signal_type.py`) but maps 1:1 to `SignalKind` at the bridge boundary.
- The compatibility ledger (ADR-01) records each pipeline's expected signal type per source as part of the parity manifest.
- Predict-time validation is a hard error — pipelines trained on absorbance applied to raw reflectance produce nonsense; refusing is safer than producing it.

## Open follow-ups

- The `SignalKind::Unknown` state is reserved for fixtures that don't tag signal type. The validator accepts `Unknown` on train but refuses it on predict (a trained pipeline must record its signal type).
