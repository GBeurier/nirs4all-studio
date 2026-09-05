# Aggregation Interop

`dag-ml-data` owns data-side reducer vocabulary. `dag-ml` owns coordinator
aggregation policy, ML-phase legality, OOF/refit safety and host-controller
routing. This page records the 0.2.x RC mapping from the data side; it
does not change any public schema or ABI signature.

## Mapping

| dag-ml-data reducer | dag-ml coordinator policy | Release behavior |
|---|---|---|
| `mean` | `mean` | Directly compatible. |
| `weighted_mean` | `weighted_mean` | Compatible when a weight column or fit-influence contract is present. |
| `median` | `median` | Directly compatible. |
| `vote` | `vote` | Classification-only; both layers reject regression vote tasks. |
| none | `none` | Coordinator-only mode; no data-side reducer is expected. |
| `custom` | `custom_controller` | Coordinator routes an aggregation task to a controller and validates result-vs-task identity. |
| `robust_mean` | not exposed | Data-side only for this release; use `custom_controller` in `dag-ml` until a shared reducer schema is added. |
| `exclude_outliers` | not exposed | Data-side only for this release; use `custom_controller` in `dag-ml` until a shared reducer schema is added. |

## Release Rule

No implicit mapping may be added during the 0.2.x RC release window. If `robust_mean` or
`exclude_outliers` becomes a first-class `dag-ml` coordinator method, the
change must include:

1. a shared schema or explicit migration note;
2. JSON Schema fixture updates in both repositories;
3. C ABI/Python/WASM contract manifest updates if any public symbol or exported
   helper changes;
4. downstream rebuild of chains consuming public signatures.

## Signal-Type Replay

`dag-ml-data` exposes signal-type validation helpers. `dag-ml` does not yet
carry an expected signal type through bundle replay. Until that paired contract
exists, 0.2.x documents signal-type replay enforcement as a
provider/backlog item rather than a coordinator-enforced invariant.
