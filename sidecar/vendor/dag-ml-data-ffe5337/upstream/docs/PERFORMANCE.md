# Performance Probes

`dag-ml-data` does not treat microbenchmarks as public API. The current
0.2.x RC baseline is a pair of ignored Rust tests that can be run on
demand in release mode to catch large regressions in fingerprinting.

## Current Probes

| Probe | Command | Purpose |
|---|---|---|
| Numeric feature-buffer fingerprint | `cargo test -p dag-ml-data-core fingerprint_large_buffer_under_500ms --release -- --ignored --nocapture` | Checks deterministic hashing over a large numeric feature buffer. |
| N-D tensor fingerprint | `cargo test -p dag-ml-data-core tensor_fingerprint_large_payload_under_500ms --release -- --ignored --nocapture` | Checks deterministic hashing over a large tensor payload. |

## Policy

- Probes are private tests, not exported signatures.
- They should be run before releases and after buffer, tensor,
  content-hash or provider binding rewrites.
- Thresholds are generous sanity gates, not formal service-level objectives.
- If a probe becomes flaky on CI hardware, keep the measurement but move the
  threshold to a manual release checklist rather than weakening correctness
  tests.

## Next Baselines

Post-0.2.x, add probes for:

- provider `materialize` / `make_view` / Arrow export;
- fused feature export over provider-owned buffers;
- `.n4d` file-backed buffer load/store;
- Arrow IPC feature-buffer ingestion.
