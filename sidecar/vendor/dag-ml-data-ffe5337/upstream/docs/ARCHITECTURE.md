# Architecture

`dag-ml-data` is the data contract and planning layer. It describes what data is
available and how it can be converted, but it does not decide ML phases or
enforce OOF invariants.

## Layers

| Layer | Owned here | Not owned here |
|---|---|---|
| Schema | dataset id, sample ids, sources, targets, metadata | graph nodes and scheduler |
| Representation | axes, units, containers, dtype, ragged/sparse flags | model execution |
| Views | immutable selectors over samples/sources/columns | fold construction |
| Planning | materialize/adapt/align/join/collate data plans | selecting variants or models |
| Fingerprints | deterministic schema hashes for replay | artifact lineage graph |
| ABI | host data-provider vtable and schema helpers | controller/model ABI |

## Crates

| Crate | Responsibility |
|---|---|
| `dag-ml-data-core` | Pure Rust serializable contracts and validation. |
| `dag-ml-data` | Stable Rust facade for downstream crates and bindings. |
| `dag-ml-data-capi` | C ABI helper functions and data provider vtable contracts. |
| `dag-ml-data-cli` | Local schema validation and fingerprint utility. |
| `dag-ml-data-arrow` | Arrow IPC serialization of validated data contracts. |
| `dag-ml-data-provider` | Safe provider facade over shared buffer/handle arenas. |
| `dag-ml-data-wasm` | Browser/Node contract and provider bindings. |
| `dag-ml-data-py` | Standalone PyO3 JSON-contract wheel. |
| `dag-ml-data-r` | Standalone R provider binding. |

## Data Planning Flow

```text
DatasetSchema + ModelInputSpec + policy
  -> resolve representation path
  -> DataPlan(materialize -> adapt* -> align -> join -> collate)
  -> execute_fit / execute_transform in a host data provider
  -> host-owned data handle returned to dag-ml
```

The implemented provider supports validated handles/views, source-scoped
materialization relations, a typed numeric feature-buffer arena with manifests,
data-handle-scoped feature-buffer bindings, and Arrow C Data smokes for
identity, sample-level targets and observation-level features. Runtime adapters
remain host responsibilities; the provider owns its copied in-memory buffers.

## View and plan validation

`DataView` is closed: unknown fields are errors; extensions belong in `extra`.
Explicit `sample_ids` are host-resolved membership, while `partition` and
`fold_id` label that selection. Without explicit IDs, those labels select the
matching string-valued relation metadata (`partition` / `fold_id`); unresolved
labels never mean "all rows". `full_train` denotes the complete materialized
handle; `predict` denotes an already PREDICT-bound handle. This does not build
folds or decide which samples belong to training or prediction.

Plans validate explicit named edges against earlier outputs, representations
and the final declared output. Published linear plans without named edges stay
valid. A planner checks known target rank, including rank-changing adapters;
unknown rank and ambiguous adapter paths remain visible unresolved plan issues
and must be resolved before materialization.

Schema, plan and relation hashes retain their published typed field order and
sort nested JSON object keys recursively. Fold hashes retain their historical
fully sorted JSON order. Both are independent of downstream activation of
`serde_json/preserve_order`; semantically meaningful array order is preserved.

## Boundary With `dag-ml`

`dag-ml-data` may expose:

- source descriptors and semantic axes;
- identity, group and origin relations;
- data plans and fitted adapter references;
- schema fingerprints;
- host handles for materialized views.

It must not expose:

- fold sets as a planning primitive;
- OOF prediction blocks;
- graph lineage records;
- model selection decisions.
