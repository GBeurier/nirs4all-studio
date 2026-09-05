# Security Policy

## Reporting a vulnerability

Please report security issues **privately** via GitHub's "Report a vulnerability"
(Security → Advisories) on the `dag-ml-data` repository, or by emailing the
maintainer listed in `Cargo.toml`. Do not open a public issue for a vulnerability.

We aim to acknowledge within 5 business days and to agree on a disclosure
timeline before public discussion.

## Supported versions

`dag-ml-data` is pre-1.0 (`0.2.x`). Security fixes target the latest
published version only.

| Version | Supported |
| ------- | --------- |
| 0.2.x | ✅ latest only |

## Trust model

`dag-ml-data` is a data-contract layer with one privileged surface:

- **The host data-provider vtable runs host code.** A `DagMlDataVTable`
  implementation materializes data and produces views on behalf of the
  coordinator. Memory-safety depends on hosts honoring the ownership and
  lifetime rules in [`docs/ABI.md`](docs/ABI.md): host owns materialized data /
  view / fitted-adapter handles (released through `DagMlDataVTable.release`);
  Rust owns the strings/tensors/Arrow arrays it returns (released through the
  `dagmldata_*_free` helpers). Use-after-free of a released handle, or freeing
  a Rust-owned buffer from the host, is undefined behavior.

When triaging, please indicate whether the report concerns the vtable lifecycle,
fingerprint/contract validation, or the CLI.

## Hardening guidance

- Treat coordinator envelopes from untrusted sources as untrusted input; the
  validator checks schema/plan/relation fingerprints and refuses unsupported
  versions, but a malformed envelope should still be sandboxed.
- Build the C ABI against the matching `dag_ml.h` ABI version macros; mismatched
  vtable ABI versions are a memory-safety hazard.
