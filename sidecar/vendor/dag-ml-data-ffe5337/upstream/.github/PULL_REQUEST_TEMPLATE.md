## Summary

Describe the behavior or contract change.

## Validation

- [ ] `cargo fmt --all --check`
- [ ] `cargo +1.85.0 check --workspace --all-targets`
- [ ] `cargo clippy --workspace --all-targets -- -D warnings`
- [ ] `cargo test --workspace`
- [ ] `DAG_ML_REPO=../dag-ml python3 scripts/validate_contracts.py`
- [ ] `python3 scripts/check_error_taxonomy.py`
- [ ] `python3 scripts/check_deprecations.py`
- [ ] `python3 scripts/check_public_docs.py`
- [ ] `python3 scripts/release/check_publish_plan.py --dry-run`
- [ ] `python3 scripts/validate_release_metadata.py`
- [ ] `python3 scripts/validate_abi_snapshot.py`

## Contract Review

- [ ] No shared contract changed.
- [ ] Shared contract changed and the paired `dag-ml` PR is linked.
- [ ] `docs/contracts/conformance_pack.v1.json` and validators were updated.

## Release Notes

- [ ] `CHANGELOG.md` updated.
- [ ] Public API docs or ADRs updated when behavior changed.
