# Development documentation

This index separates current product contracts, topic references, and historical
implementation evidence. Indexed tracked files are already part of the repository;
this directory does not make private working notes public.

## Current product and release contracts

- [Contributor and ownership rules](../../AGENTS.md), [agent guide](../../CLAUDE.md).
- [Rust product backend](../../sidecar/README.md) and [runtime release train](../RELEASE_TRAIN.md).
- [Studio V1 HTTP/WebSocket contracts](../contracts/studio-v1/README.md).
- [Native Archive V2 prediction adapter](../RT-PRED-002.md).
- [Packaging](../PACKAGING.md), [release checklist](../RELEASE_CHECKLIST.md),
  [publishing](../PUBLISHING_GUIDE.md), [signing](../SIGNING.md).
- [Architecture boundaries](../ARCHITECTURE_BOUNDARIES.md): frontend ownership
  and transitional Python web/diagnostic ownership, not the packaged Rust router.

## Topic references

The existing `_internals` paths are retained for stable links. Their dated design
decisions are context, not evidence that a current product capability is shipped.

| Topic | Reference | Scope |
| --- | --- | --- |
| Pipeline editing | [Canonical round trip](../_internals/canonical_pipeline_round_trip.md), [preset authoring](../_internals/pipeline_preset_authoring.md) | Editor interchange and authoring |
| Results | [Core concepts](../_internals/CONCEPTS_RUN_RESULTS_PRED.md), [Inspector design](../_internals/inspector-design.md) | Product concepts and original UI design |
| Playground | [Specification](../_internals/PLAYGROUND_SPECIFICATION.md), [selection model](../_internals/PLAYGROUND_SELECTION_MODEL.md) | January 2026 design baseline |
| Python environment | [Architecture](../_internals/environment-architecture.md), [support runbook](../_internals/support-runbook-env-mismatch.md) | Historical runtime management; use current packaging contracts for R3 |
| Python backend | [Development rules](../_internals/BACKEND_RULES.md) | Scientific ownership principle; Python HTTP is now diagnostic/web-only |

## Historical implementation evidence

[June 2026 pristine cleanup](history/2026-06-pristine/README.md) preserves the
original audit, handoff, and implementation journal together. Do not append new
release work to that closed journal. New completed records should have a dated
directory, an explicit baseline commit, validation evidence, and a status.

## Private local notes

`docs/audit/` and the paths explicitly ignored in `.gitignore` stay local. Keep
private reviews, working prompts, and unpublished audit findings there, with a
dated index. Never force-add an ignored document to publish an index or cleanup.
Public user documentation remains under `docs/user-guide/`.
