# Examples

These fixtures are part of the public integration surface. Keep them small,
deterministic, and runnable from the commands documented in `docs/DEVELOPMENT.md`.

| Audience | Start here | Purpose |
|---|---|---|
| Schema author | `minimal_schema.json` | Validate the minimal dataset schema and fingerprint path. |
| Data-provider author | `python/provider_smoke.py` (over the installable `dag_ml_data_provider` package in `../crates/dag-ml-data-capi/bindings/python`) | Exercise the public C ABI provider lifecycle from stdlib-only Python. |
| Coordinator integrator | `fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json` | Materialize the shared envelope consumed by `dag-ml` integration smokes. |
| Feature-fusion integrator | `fixtures/oof_campaign/feature_fusion_selector_*.json` | Validate multi-source feature selection and fusion semantics. |
| Fitted-adapter integrator | `fixtures/oof_campaign/fitted_adapter_*.json` | Validate portable fitted-adapter references without loading payloads. |

Examples that become compatibility evidence must be added to the conformance
pack or parity oracle before release.
