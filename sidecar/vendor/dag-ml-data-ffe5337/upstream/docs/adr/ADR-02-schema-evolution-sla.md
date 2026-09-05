# ADR-02: Schema evolution SLA

**Status**: accepted (2026-05-28)
**Blocks**: all of workstream B (dag-ml-data schema additions). Land BEFORE B1-B6 wire-shape changes.

## Context

`CoordinatorDataPlanEnvelope` is currently v1 with refusal-on-mismatch (`unsupported_versions_are_refused`). The roadmap adds `MetadataSchema`, `AugmentationMetadata`, `signal_type`, multi-target, `GroupSpec`, `FoldSpec`, per-source shape contracts. Without a migration policy, any of these promotes silently into a v2 that orphans existing bundles.

## Decision

Schema evolution follows a three-phase SLA per wire-shape change:

1. **Land additively first** — every new field is `Option<T>` for one release, populated by writers but not required by readers. Readers in v1 ignore unknown fields per JSON schema `additionalProperties`. CI gate: `scripts/validate_contracts.py` checks that the field is optional, has a documented default, and the C ABI version constant is unchanged.

2. **Promote with a major envelope version** — when the field becomes required, bump `schema_version` and ship a one-cycle dual-read window:
   - Rust reader accepts v1 AND v2 envelopes for one release;
   - bundles produced under v1 stay **prediction-readable** for two releases (long enough for users to either re-train or accept a `--allow-legacy` flag);
   - `validate-bundle` CLI surfaces "deprecated envelope v1" with the target removal version.

3. **Drop the previous version** after the two-release window. The CHANGELOG entry references this ADR + the bug-tracker issue that scheduled the removal.

### Concretely for the B workstream

All of B1–B6 (MetadataSchema, AugmentationMetadata, signal_type, multi-target, shape contracts, GroupSpec / FoldSpec) land **as optional v1 fields**, all in one merged window to minimize migration churn. The promotion to required fields is a separate ADR-superseder authored only after the bridge has consumed them for one release.

## Consequences

- Any ADR-02-touching PR has a checklist that requires updating: (a) the schema JSON, (b) the C ABI version macros (only if breaking), (c) the cross-repo conformance pack, (d) `STATUS.md`, (e) the CHANGELOG, (f) one negative test for the v1 reader receiving a v2-only field.
- `scripts/validate_contracts.py` learns to diff JSON schemas between releases and refuse silent `required` additions without a corresponding ADR-superseder.
- `.n4a` bundles carry the envelope version they were built under; loaders fall back to v1 prediction path when the version is < current.

## Supersedes / superseded by

This ADR governs envelope v1 → v2 (and beyond). Per-version supersession ADRs (e.g. ADR-02b for the actual v2 cutover) reference this one.
