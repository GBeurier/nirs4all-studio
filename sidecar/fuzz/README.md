# WorkspaceStore v5 fuzz target

`workspace_store_v5_bytes` places at most 2 MiB of hostile input at the
canonical `store.sqlite` location, then calls the sidecar's existing immutable,
read-only Store v5 preflight. It does not invoke Python or duplicate SQLite,
schema, contract, or column validation.

With `cargo-fuzz` already installed, check or run it from `sidecar/`:

```console
cargo fuzz check workspace_store_v5_bytes
cargo fuzz run workspace_store_v5_bytes -- -max_len=2097152
```

Generated corpora and crash artifacts are intentionally untracked. Qualifying
SEC-001 still requires a separately recorded fuzz campaign and corpus review.
