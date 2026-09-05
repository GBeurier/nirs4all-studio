# Capability Matrix

`dag-ml-data` supports the replacement of the current `nirs4all` data pipeline
surface by making data shape, identity and conversion explicit. It does not own
OOF or leakage decisions, but it exposes enough information for `dag-ml` to
enforce them and can validate externally supplied fold assignments against the
data identities it owns.

## Data Surface

| Capability | Data contract support | Enforcement owner |
|---|---|---|
| Multisource | `DatasetSchema`, `SourceDescriptor`, alignment policy, presence masks, planner-visible `Align` steps | `dag-ml` decides phase and accepted fusion policy |
| Repetitions | `SampleRelation` with observation/sample/target/group/origin ids plus optional `GroupSpec`/`FoldSpec` declarations and `FoldSet` validation helpers | `dag-ml` chooses split unit and aggregation; `dag-ml-data` rejects malformed/leaking fold contracts |
| Grouped samples | group ids exposed through sample relations and schema-level `GroupSpec` | `dag-ml` builds group-aware folds; `dag-ml-data` validates supplied fold boundaries |
| Augmentation | augmentation adapters declare output origin ids and optional `AugmentationMetadata` | `dag-ml` decides train-only use; `dag-ml-data` validates origin boundaries for supplied folds |
| Signal type | `RepresentationSpec.signal_type` records absorbance/reflectance/transmittance/log-reflectance/preprocessed/unknown | host loaders detect, `dag-ml-data` validates materialize/predict contracts |
| Shape contracts | `SourceDescriptor.shape_contract` pins rank and named axis sizes | providers must refuse materialization when source payload shape violates the contract |
| Metadata | `MetadataSchema` declares typed metadata fields and categorical vocabularies | bridge maps nirs4all metadata columns and refuses missing/invalid required fields |
| Multi-targets | `CoordinatorMultiTargetBlock` aligns multiple target tables on one sample axis and the C ABI exports nullable per-target Arrow columns | `dag-ml` decides target use per phase; providers preserve missing-target validity masks |
| Processings | representation adapters, fit scope, fitted adapter refs | `dag-ml` chooses fold/full-train scope |
| Splits | identity/group/origin inputs, JSON `FoldSet` validators and canonical fold fingerprints in Rust/Python/WASM/C ABI for exhaustive partition-style folds | `dag-ml` builds folds; `dag-ml-data` validates and fingerprints supplied folds |
| Models | `ModelInputSpec`, accepted representations/types, aux inputs | controller and `dag-ml` execute model phases |
| Refit | serialized `DataPlan`, schema fingerprints, fitted refs | `dag-ml` controls replay/refit phase |
| Branching | immutable views plus native `by_source`/`by_metadata`/`by_tag` and the closed `by_filter` predicate (`metadata_equals`, `tags_all`) over supplied relation metadata/tags | `dag-ml` owns branch graph semantics; provider refuses unknown or empty predicates before selecting rows |
| Merging | alignment, feature join, source join, repetition-preserving broadcast, null-filled missing sources, executable numeric collation contracts | `dag-ml` validates prediction joins and downstream use |
| Concatenation | namespace columns by default, duplicate-column refusal when unnamespaced, presence indicators, output representation | `dag-ml` decides whether the merge is legal in phase |
| Finetuning | stateful/supervised adapter declarations | `dag-ml` enforces fold-train fit boundaries |
| Generation | serializable adapter params and plugin versions | `dag-ml` owns variant enumeration |
| Tuning | dry-run shapes and deterministic data plans | `dag-ml` owns tuner phase and nested CV |

## Contract Requirements

1. Every source has stable sample identity.
2. Every representation carries semantic axes.
3. Every conversion path is explicit, costed, versioned and deterministic.
4. Lossy/stateful/supervised adapters are opt-in at planning time.
5. Presence masks and alignment choices are serializable and planned before
   multi-source joins.
6. Schema fingerprints are stable under irrelevant ordering changes.
7. No fold, OOF or prediction partition decision is made in this repo; supplied
   partition-style fold sets can be validated against relation group/origin
   boundaries.
8. A native `by_filter` view only exposes supplied partition/fold provenance as
   relation metadata. It neither converts provenance into an effective fold nor
   synthesizes a missing assignment; consumers requiring a concrete fold must
   preflight and validate their supplied `FoldSet` separately.
