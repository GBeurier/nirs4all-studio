# Developer documentation

Start with [Architecture](ARCHITECTURE.md), [Rationale](RATIONALE.md),
[C ABI and ownership](ABI.md), [Supported surface](SUPPORTED.md), and the
[shared contract inventory](contracts/README.md). The Rust source, published
JSON schemas and C header define the implemented contracts. Public decisions
remain in [Architecture decisions](adr/README.md).

## Validation

Run from the repository root:

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo run -p dag-ml-data-cli -- fingerprint-schema examples/minimal_schema.json
DAG_ML_REPO=../dag-ml python3 scripts/validate_contracts.py --require-sibling
```

Use a sibling `dag-ml` checkout from the same release train for the shared
contract check. Additional binding, packaging and documentation gates are in
[CONTRIBUTING.md](https://github.com/GBeurier/dag-ml-data/blob/main/CONTRIBUTING.md)
and `.github/workflows/ci.yml`.

Fingerprint compatibility must also pass with an additive consumer feature:

```bash
cargo test -p dag-ml-data-core --features serde_json/preserve_order
```

## Local development records

Private specifications, implementation plans, historical acceptance records,
reviews and audits belong under the ignored `docs/_private/` directory:

- `README.md`: local inventory and provenance.
- `current/`: active work and implementation status snapshots.
- `design/`: original design sources.
- `archive/`: completed or superseded delivery records.
- `audits/YYYY-MM-DD/`: dated findings with the reviewed commit and evidence.

Private records are optional in a fresh clone and are excluded from the public
site. They must not be force-added or required by build/release checks. Publish
durable interface decisions, release support statements and contributor
instructions in the public documentation after review. Moving previously
tracked records to private storage does not remove their historical Git copies.
