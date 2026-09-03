# Package-local test fixtures

These small fixtures exercise `dag-ml-core` behavior after `cargo package`
without relying on sibling workspace files.  They are deliberately separate
from the repository-wide contract corpus.  Tests that assert the published
schemas or generated workspace examples are gated behind
`dag_ml_workspace_contract_fixtures`; run them in the workspace with:

```bash
RUSTFLAGS='--check-cfg=cfg(dag_ml_workspace_contract_fixtures) --cfg dag_ml_workspace_contract_fixtures' \
  cargo test -p dag-ml-core
```

The package-portability script validates the cfg name but leaves it disabled,
which confirms that an extracted crate needs no repository documents or
generated examples.

`archive/training_outcome_port_explicit.json` is the package-local copy used
by Archive V2 tests that must also compile in an extracted crate.  It is kept
outside the repository-wide W1 corpus and deliberately has no versioned
filename, so the package gate can continue to reject unapproved protocol
fixtures.
