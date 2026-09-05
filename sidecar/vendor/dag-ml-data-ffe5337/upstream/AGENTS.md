# Agent Handoff

Start here when implementing `dag-ml-data`.

## Mission

Build the generic data layer consumed by DAG-ML and other ML engines. This crate
owns source descriptors, axes, representations, views, sample relations,
adapter registries, representation path solving, alignment, collation and schema
fingerprints.

## Hard Boundaries

- Do not add ML phases, graph scheduling, OOF logic or model selection.
- Do not add NIRS-specific assumptions to core types.
- Fit scope is declared here, but enforcement belongs to `dag-ml`.
- Data buffers may remain host-owned behind handles; schemas and descriptors
  must stay serializable and deterministic.
- Schema fingerprinting must be stable under source-order changes.

## Working Gate

Run before handing work back:

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo run -p dag-ml-data-cli -- fingerprint-schema examples/minimal_schema.json
```

## First Files To Read

1. `docs/DEVELOPMENT.md`
2. `docs/RATIONALE.md`
3. `docs/ARCHITECTURE.md`
4. `docs/ABI.md`
5. `docs/contracts/README.md`

Private design and delivery records, when present locally, are indexed by
`docs/_private/README.md`. They are historical context, not required build inputs.
