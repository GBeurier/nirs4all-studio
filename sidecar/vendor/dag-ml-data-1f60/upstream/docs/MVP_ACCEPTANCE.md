# MVP Acceptance

This document locks the first implementation target for `dag-ml-data`. It
supports the UC6/UC11 target in `dag-ml` without taking ownership of ML phases or
OOF decisions.

## Boundary Confirmation

| Owned by `dag-ml-data` | Owned by `dag-ml` |
|---|---|
| `DatasetSchema`, source descriptors and semantic axes | `GraphSpec`, nodes, ports and edge contracts |
| `RepresentationSpec`, `ModelInputSpec` and `AuxInputSpec` | phase flow and executor scheduling |
| `DataView`, `PresenceMask` and `SampleRelation` | fold construction and fold membership decisions |
| `DataTypeRegistry`, `AdapterRegistry` and path solving | OOF prediction joins and leakage refusal |
| `DataPlan` construction and validation | model selection, refit and replay orchestration |
| alignment, feature fusion and late collation contracts | prediction stores and lineage graph |
| schema fingerprints and plugin version requirements | bundle-level acceptance/refusal decisions |

`dag-ml-data` may declare fit scopes and sample relations. It must not decide
that train predictions are safe for downstream training.

## First Acceptance Target

The data-side MVP is the minimum needed for `dag-ml` UC6 and UC11 fixtures:

| Capability | Expected result | What it proves |
|---|---|---|
| canonical schema parsing | multi-source schema validates and fingerprints deterministically | replay can compare schemas across runs/languages |
| `ModelInputSpec` contract | a model can declare accepted representations and fusion defaults | planning is model-driven, not hardcoded to NIRS |
| `AdapterRegistry` path solver | source representation resolves to `tabular_numeric` through declared adapters | custom data types can be added without changing `dag-ml` |
| `DataPlan` validation | plan contains `materialize -> adapt* -> align -> join -> collate` steps as needed | execution can be audited before runtime |
| `SampleRelation` exposure | group/origin/sample mappings are available to `dag-ml` | group splits and augmentation checks can be enforced outside the data layer |

## Required `dag-ml-data` Work Before Full Executor

| Item | Acceptance check |
|---|---|
| `ModelInputSpec` and input ports | specs serialize to stable JSON and reject invalid ports |
| `AdapterSpec` and registry | duplicate adapters are refused and candidates are deterministic |
| path solver | returns the cheapest non-lossy path unless policy allows lossy adapters |
| `DataPlan` shape | output representation and every step input/output is explicit |
| schema fingerprint | source and sample ordering do not change fingerprints |
| C ABI helper | schema fingerprint plus coordinator identity/target/feature Arrow exports are callable from C ABI |

## Non-Target For MVP

- actual file readers;
- GPU tensor collation;
- full production provider-backed Arrow buffer/view implementation;
- nirs4all `SpectroDataset` connector;
- domain-specific adapter defaults.

## Green Gate

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo run -p dag-ml-data-cli -- fingerprint-schema examples/minimal_schema.json
cargo run -p dag-ml-data-cli -- plan-model-input --schema examples/fixtures/oof_campaign/schema_nir_6_samples.json --model-input examples/fixtures/oof_campaign/model_input_tabular_numeric.json --adapters examples/fixtures/oof_campaign/adapter_registry_signal_to_tabular.json --id nir-to-tabular --source nir
cargo run -p dag-ml-data-cli -- fingerprint-plan examples/fixtures/oof_campaign/expected_data_plan_nir_to_tabular.json
```
