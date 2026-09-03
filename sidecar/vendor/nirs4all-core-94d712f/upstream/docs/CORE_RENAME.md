# Core Naming Cutover

This repository is the canonical `nirs4all-core` aggregate.

## Final RC Target

- Repository: `GBeurier/nirs4all-core`
- Python distribution: `nirs4all-core`
- Python import: `nirs4all_core`
- Python additive facade: `n4a`
- Non-Python package names: `nirs4all`
- Full Python modelling package: remains the separate `nirs4all` project until
  its production cutover.

No public legacy alias release is part of the RC target.

## Required Invariants

- The wheel packages only `nirs4all_core` and `n4a`.
- `nirs4all_core.__all__` exposes the complete aggregate contract, including
  execution helpers that delegate to upstream projects.
- `n4a` re-exports `nirs4all_core` without adding behavior.
- No top-level Python `nirs4all` module is shipped by this aggregate.
- Release topology manifests do not include legacy distribution rows.
- Strict parity gates use `NIRS4ALL_CORE_*` environment variables only.

## Validation

Run before publishing a release candidate:

```bash
PYTHONPATH=bindings/python/src python -m unittest discover -s bindings/python/tests
python -m build bindings/python --outdir dist/python-release
python -m twine check dist/python-release/*
```

When methods bindings are available, also run:

```bash
NIRS4ALL_CORE_REQUIRE_METHODS_PARITY=1 make test-python-parity
```
