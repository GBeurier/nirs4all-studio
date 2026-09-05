# OOF Campaign Data Fixtures

This document defines the first reusable data-contract fixtures that support the
`dag-ml` OOF campaign fixtures. They prove schema, model input and data planning
determinism without making OOF or leakage decisions.

## Fixture Set

Directory: `examples/fixtures/oof_campaign/`

| Fixture | Purpose |
|---|---|
| `schema_nir_6_samples.json` | Minimal six-sample dense-signal dataset schema |
| `model_input_tabular_numeric.json` | Model input accepting `tabular_numeric` features |
| `adapter_registry_signal_to_tabular.json` | Deterministic adapter declarations |
| `expected_data_plan_nir_to_tabular.json` | Auditable expected plan shape |
| `sample_relations_grouped_augmented.json` | Group, repetition and augmentation-origin identity table |

## Assertions Owned By `dag-ml-data`

- schema parses and fingerprints deterministically;
- source/sample ordering does not affect the fingerprint;
- `ModelInputSpec` JSON round-trips and rejects invalid ports;
- duplicate adapter ids are refused;
- path solving returns the cheapest non-lossy path by deterministic ordering;
- lossy adapters are refused unless policy allows them;
- equivalent paths produce a `requires_user_choice` or ambiguity result;
- `DataPlan` has explicit step inputs, outputs and adapter ids.
- `SampleRelationTable` rejects duplicate observations and unknown augmentation origins.

## Boundary

These fixtures must not mention folds, partitions, OOF safety, prediction joins
or leakage opt-ins. Those are `dag-ml` responsibilities.
