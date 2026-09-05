# Developer documentation

Start with the repository's `CLAUDE.md` for architectural boundaries and local
commands. Production execution lives in Rust; `src/nirs4all_io/` is the Python
parity oracle. Language bindings adapt those contracts.

## Current references

| Subject | Reference |
| --- | --- |
| Integration seam and ownership | [API](API.md), [host adoption](REPLUG.md) |
| Dataset vocabulary and cookbook | [Dataset configurations](DATASET_CONFIGURATIONS.md) |
| Versioned wire contracts | [Versioning](VERSIONING.md) |
| Cross-language qualification | [Binding qualification](IO_XLG_QUALIFICATION.md) |
| Deferred work | [Roadmap](ROADMAP.md) |

Maintainers can find binding publication procedures in the repository at
`docs/dev/release_process.md`, and the binding capability matrix at `COMPAT.md`.
The current CI workflows and tests are the executable checks; historical green
gate notes do not certify a later release.

## Private development records

Local plans, AI specifications, reviews and audits belong in `docs/_private/`,
which is ignored by Git and excluded from Sphinx. Its local `README.md` indexes
records by subject and lifecycle. Use `current/` for active work,
`archive/<topic>/` for completed efforts and `audits/<date>/` for dated reviews.
Do not force-add that directory or mix it with the public API reference.

The completed Python/Rust port records (formerly `docs/STATUS.md`,
`docs/PHASE2_GATE.md`, `docs/RUST_REWRITE_ROADMAP.md` and
`docs/dev/PORT_BLUEPRINT.md`) are retained locally under
`docs/_private/archive/phase2/`. Prior Git history still contains previously
tracked versions; this organization does not rewrite that history.

## Verification

Rust: `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D
warnings`, `cargo test --workspace`, and `cargo build --workspace
--no-default-features`. Bindings have separate checks described in their READMEs.
Run the Python oracle with the project virtual environment; its tests must be
distinguished from tests of the published native Python binding.
