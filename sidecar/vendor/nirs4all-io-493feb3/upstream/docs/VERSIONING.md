<!-- SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later -->
# Versioning policy (story 7.5)

`nirs4all-io` carries several independently-versioned contracts. This file is the
single source of truth for the rules; the constants are asserted in CI on both
sides (`crates/nirs4all-io-core/tests/versions.rs`, `tests/test_versions.py`) so
the docs and the code cannot drift.

| Contract | Constant | Current | Bump rule |
|---|---|---|---|
| `DatasetSpec` schema | `DATASET_SPEC_SCHEMA_VERSION` (core) / `SCHEMA_VERSION` (py) | `1` | Bump (integer) on any **incompatible** change to the `DatasetSpec` wire shape (renamed/removed field, changed semantics). Additive optional fields do **not** bump it. The `schema_version` field is written into every emitted spec. |
| `DatasetPlan` shape | tracked with the spec schema | `1` | The plan is a recommendation, not a stored contract; its shape is versioned together with the spec schema (a plan always carries a `resolved_spec` whose `schema_version` is authoritative). |
| Convention profile | `CONVENTION_PROFILE_VERSION` (core) / per-profile `version` key | `1` | Bump a profile's `version` when its patterns change in a way that alters matches. The builtin floor is `CONVENTION_PROFILE_VERSION`. |
| Canonical JSON | `CANONICAL_JSON_VERSION` (core) | `1` | Bump only if the canonical-form rules in §2 of `bindings/SPEC.md` change (key order, indentation, float policy). A bump invalidates all goldens. |
| `AssembledDataset` summary/full wire | `ASSEMBLED_DATASET_VERSION` (core) / `assembled_schema_version` | `2` | Bump when the JSON-compatible assembly artifact changes. v1 was unversioned and did not retain source ids, scientific identity, or stable fold provenance; v2 readers require a value whose exact Python type is `int` and whose value is `2` (rejecting `true`, `2.0`, and strings). Re-bless all `*.assembled.canonical` readers in the same change. |
| `DatasetPackage` summary wire | `DATASET_PACKAGE_VERSION` (core/py) / `schema_version` | `3` | v3 has one `identity` object, per-partition `source_ids`, and fold provenance. It is an explicit new wire, not a claim of backwards compatibility with package v2. |
| C ABI | `n4io_abi_version()` / `N4IO_ABI_VERSION` (capi) | `0.2.0` | Independent of crate semver (D-R6). MAJOR bumps on any breaking ABI change; MINOR on additive symbols; PATCH on fixes. Pre-1.0 every breaking change bumps MAJOR. Checked by `n4io_check_abi_compatibility`. |
| Targeted `dag-ml-data` schema | (EPIC 10) | tracked | io targets the `coordinator_data_plan_envelope.schema.json` shared by `dag-ml-data`/`dag-ml`. The exact targeted version is pinned in EPIC 10 and asserted against the live schema in the cross-CLI conformance gate (story 10.4). |

## Rules

1. **One bump, one reason.** Each contract bumps for its own reason; do not bump
   the spec schema because the ABI changed, or vice-versa.
2. **Goldens are append-only.** A canonical-JSON or schema bump re-blesses the
   golden corpus in the same PR that bumps the constant.
3. **Crate semver != ABI version.** The cargo workspace version
   (`0.1.14`) tracks the Rust crates; the C ABI tracks
   `N4IO_ABI_VERSION`. They move independently.
