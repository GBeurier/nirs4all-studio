<!-- SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later -->
# dag-ml-data emit — cross-CLI conformance (EPIC 10)

io owns the `AssembledDataset → CoordinatorDataPlanEnvelope` bridge (ADR-0001).
The emit lives in the `crates/nirs4all-io-dagml` bridge crate
(`to_dag_ml_data` + the `emit-dagml` binary). It is a workspace member, but its
default dependency resolution uses the published `dag-ml-data` crate so
standalone IO builds remain ecosystem-free. This conformance harness patches
Cargo to the sibling `dag-ml-data` checkout when it is present. The main
`nirs4all-io` CLI keeps an `emit-dag-ml-data` subcommand for discoverability that
points at this crate. io builds a `DatasetSchema` + `DataPlan` +
`SampleRelationTable` and calls `CoordinatorDataPlanEnvelope::from_parts` (which
fingerprints and self-validates). io does **not** emit dag-ml
`FoldSet`/`DataBinding` — those are dag-ml's domain.

## Two layers of verification

1. **In-process** (`crates/nirs4all-io-dagml/tests/emit.rs`,
   `cargo test --manifest-path crates/nirs4all-io-dagml/Cargo.toml`): builds the
   envelope for each contract-corpus case, then JSON-round-trips and
   re-`validate()`s it — exactly the checks `dag-ml-data-cli validate-envelope`
   runs, with no external binary. Use the Cargo patch form below when checking
   against the sibling `dag-ml-data` checkout.

2. **Cross-CLI** (`verify_cross_cli.sh`): the full ecosystem acceptance (story
   10.4). The io-emitted envelope must pass **both**:
   - `dag-ml-data-cli validate-envelope <envelope.json>` — full envelope.
   - `dag-ml-cli validate-data-binding` — the lossy `ExternalDataPlanEnvelope`
     (schema/plan/relation fingerprints + coordinator relations) wrapped by a
     hand-authored `DataBinding` inside a minimal `CampaignSpec` (no folds, so the
     fold-safety check is a no-op; `require_relations=true` exercises the relation
     contract).

   Fingerprints are content-derived, so nothing brittle is pinned — the "golden"
   is the round trip *emit → both CLIs accept*. The script needs the sibling
   `dag-ml-data` and `dag-ml` repos (override locations with `NIRS4ALL_DAG_ML_DATA`
   / `NIRS4ALL_DAG_ML`); it SKIPs (exit 0) if either is absent unless
   `NIRS4ALL_REQUIRE_DAGML_SIBLINGS=1` is set. In CI the repos are cloned and
   required.

```bash
cargo test --manifest-path crates/nirs4all-io-dagml/Cargo.toml \
  --config "patch.crates-io.dag-ml-data.path='../dag-ml-data/crates/dag-ml-data'"
scripts/dag_ml_data_conformance.sh                         # strict proof command
bash tests/dag_ml_data/verify_cross_cli.sh                 # developer smoke; skips if siblings are absent
bash tests/dag_ml_data/verify_cross_cli.sh train_test      # a specific case
```

`scripts/dag_ml_data_conformance.sh` is the release-proof entrypoint. It sets
`NIRS4ALL_REQUIRE_DAGML_SIBLINGS=1`, auto-detects the integration worktrees
`../INT-dmd` and `../INT-dagml` when present, falls back to `../dag-ml-data` and
`../dag-ml` for CI clones, and fails with the exact missing-CLI blocker instead
of reporting a green skip. Override paths with `NIRS4ALL_DAG_ML_DATA` and
`NIRS4ALL_DAG_ML`.

`single_combined` is inference-only (no convention match), so the CLI emit path
(which loads via conventions) does not cover it; the in-process test exercises it
via `infer`.
