# Studio contributor instructions

## Scope and navigation

- Read this file, `CLAUDE.md` and applicable deeper instructions before changes. Preserve dirty/concurrent work and exact preimages before replacing instructions; never reset, overwrite or stage another author's work.
- Standing maintainer scope permits autonomous backend/owner integration: Rust/Python services, jobs, SDK/Core/IO/DAG adapters and necessary non-visual contract/transport types. GUI migration/refactoring (screens, layout, presentation and interactions) remains the final joint batch with the maintainer. Current task restrictions take precedence. No release or deployment is authorized.
- Use CodeGraph FIRST for indexed implementation navigation only when this checkout's own root has `.codegraph/`. Pass the exact checkout root as `projectPath` (`/home/delete/nirs4all/nirs4all-studio` here), or run its CLI from that root. Never auto-index or substitute an ancestor/workspace index. Unindexed code, docs and configs use ordinary source navigation; source and actual tool results remain authoritative.
- These instructions are self-contained. Sibling owner links are optional navigation to independent repositories, not required workspace-policy imports. Read the affected owner's current instructions/contracts before integration; submodule copies may differ from sibling checkouts.
- [Local operations](docs/AGENT_OPERATIONS.md) retains detailed commands and navigation. `package.json`, local configs and owner contracts determine current commands/support; historical prose is not a capability certificate.

## Ownership

Composition direction: bytes -> Formats -> IO -> DMD data contracts -> DAG execution with Methods -> Core -> SDK/other hosts -> Studio. This describes responsibilities, not universal implemented support.

| Owner | Responsibility |
| --- | --- |
| [Formats](../nirs4all-formats/AGENTS.md) | Rust vendor decoding/sniffing, records, per-signal axes and provenance; not `.n4a` or dataset assembly. |
| [IO](../nirs4all-io/AGENTS.md) | Inspect/infer/configure/materialize datasets: roles, joins, axes, masks, identities, targets and declared deterministic partitions; no random CV splitting. |
| [DMD](../dag-ml-data/AGENTS.md) | Generic data/identity/relations, alignment/collation, fingerprints and provider contracts; declares fit scope, not ML scheduling/leakage policy. |
| [Methods](../nirs4all-methods/AGENTS.md) | Numerics, preprocessing, filters/augmentation, splitter algorithms, models, metric primitives and fitted state; generic native fit/transform/predict/export roles. |
| [DAG-ML](../dag-ml/AGENTS.md) | Compile/execution, variants/FoldSet scheduling, OOF/leakage, search/selection, aggregation, metric definitions/scoring context and persistence/lineage/replay. Retain its accepted generic identity-aligned conformal score/quantile/application exception. |
| [Datasets](../nirs4all-datasets/AGENTS.md) | Catalog/descriptors, acquisition/cache, provenance and content services; delegates parsing, assembly and science. |
| [Core](../nirs4all-core/AGENTS.md) | Aggregates Methods, DAG-ML, DMD, Formats, IO and Datasets; owns the directed `.n4a` byte-container/storage/inventory contract. |
| [Python SDK](../nirs4all/AGENTS.md) | Public APIs/controllers and Python ML/DL, explain/SHAP, synthesis, workspace/host integrations and named references over Core. |
| [UI](../nirs4all-ui/AGENTS.md) | Reusable presentation/interactions/view models; hosts keep routing, fetching, storage and execution. |
| Studio | Rust product routes/validation, jobs, WebSockets, scheduler/control, workspace/UI state, desktop shell and adapters; orchestrates owners, never duplicates their science. |

## Product and scientific boundaries

- Rust is the product HTTP/WS backend. CPython is a bounded library/plugin host invoked by Rust over stdio; it owns no product listener/port. No whole-session or per-route Python HTTP fallback, including the removed `--enable-python-http-diagnostic` switch. Unsupported routes return typed refusals; a missing/invalid host leaves Rust active and dependent scientific capabilities unavailable. Retained FastAPI is explicit browser-development/diagnostic tooling only.
- Fix demonstrated defects in their owner and propagate affected contracts/bindings/authorized consumers. Do not duplicate parsers, dataset loaders, numerics, fold loops, selection or scoring policy in Studio, bindings or UI; do not hide missing support with a local fallback.
- Scientific validity of completed runs is non-negotiable: preserve axes/units/masks/precision and sample/group/repetition/target/origin alignment. Join by stable identities, not row position; fit only in training scope, select on designated validation/OOF, never retained test. Preserve distinct algorithms, named tolerances and provenance. Report failed/incomplete results honestly.
- Core owns `.n4a` inventory/container, DAG recipe/run/result/score/replay semantics, IO dataset payloads, DMD identity and Methods fitted state; hosts retain serializers. Route by declared owner/schema/profile/operation, never suffix. Readability is not executability or universal portability. Keep version/refusal contracts independent; no intrinsic content-size/entry-count ceilings beyond host-authorized RAM, while preserving integrity checks.
- Preserve frozen contracts, licensed fixtures, owner ABI/allocator/stride boundaries and supported API/artifact semantics. Remove obsolete alternatives only after active callers migrate and parity is established within authorization; preserve identified scientific oracles and provenance. Do not hand-edit vendored snapshots or tarballs; use the declared owner/update path and drift checks. Never revive retired Lite as an aggregate/alias.

## Engineering and verification

- Make only requested/necessary changes. Avoid speculative edge-case hunts, one-use abstractions, duplicate validation and proof infrastructure. Validate at API/trust boundaries and reuse validated state; preserve scientific safeguards and performance.
- Freeze a coherent package batch, pool compilation artifacts and run affected owner/binding/consumer checks once per required profile. Repeat only for relevant changes, failures or a concrete uncovered requirement. Add focused behavioral coverage for changed product behavior; contract changes retain required drift/parity checks. Commands in documentation grant no execution authority.
- Stop/resume, reproducibility and diagnostics matter, but residual recovery defects do not block unrelated work or valid fresh runs. Source-only authors/read-only reviewers use their actual resource limits; unrelated compiled-cache quotas or obsolete reservations must not gate them. Record exact commands/exits/skips and limits; do not claim unexecuted gates passed.
- Use Node 24 (`.nvmrc`; package engines Node >=20/npm >=10), the declared Python environment (3.11+) and existing patterns. TypeScript is strict, two spaces, functional React, PascalCase components, `use*` hooks and `@/` imports. Prefer existing shadcn/ui, Radix and TanStack helpers. Python uses Google docstrings and configured Ruff (220 columns); Rust follows local rustfmt/clippy rules.
- Project map: `src/` renderer; `sidecar/` Rust backend; `electron/` shell; `api/`, `websocket/`, `main.py` transitional Python tooling; `public/` static/registry data; `scripts/` helpers. Vitest covers `src/**/*.test.{ts,tsx}` and `electron/**/*.test.ts`; pytest uses `tests/test_*.py` and existing markers; Playwright uses `e2e/tests/` and runs serially for shared backend state.
- Use scoped imperative Conventional Commits for authorized commits. PRs describe problem/behavior, changes, linked context, exact validation/limits and relevant fixture/license/ABI/schema effects; include screenshots for visible UI changes.

## Credentials, private work and language

- Author/commit as `GBeurier <95907737+GBeurier@users.noreply.github.com>`. Before authorized GitHub writes, verify authenticated GBeurier identity and repository permission. Use `/home/delete/nirs4all/github_token` or an authenticated GBeurier CLI; never the other account's Windows `D:\workspace\dunk_token` / `/mnt/d/workspace/dunk_token`. A credential location grants no unrelated secret read.
- Pass secrets only through a process-local credential/environment mechanism. Never print/log/commit tokens, put them in remote URLs or request pasted credentials. Keep private data, workspace payloads, caches and generated outputs (`dist/`, `dist-electron/`, `backend-dist/`, `release/`, `workspace/`, `storybook-static/`, `test-results/`, `playwright-report/`) out of Git; respect owner licenses/fixture restrictions.
- All application/project content is English: UI text, subtitles/tooltips/errors, docs/comments/docstrings, test/fixture prose, reports, issues/PRs, commits and generated material. Conversation with the maintainer may be in French. Preserve proper names, identifiers, filenames, quotations and historical/provenance meaning.
- Use RTK prefixes per command, with raw output/real exit evidence and secrecy taking precedence; `rtk proxy <command>` preserves unfiltered output. Do not initialize/reinject RTK blocks or expose secrets through environment/log/history tools. Claude MCP calls always need scoped `allowedTools`; its permission gate is separate, and asynchronous sessions/cursors must be followed through actual completion. These tool conventions grant no additional action or delegation authority.
