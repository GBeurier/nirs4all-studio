# Studio pristine handoff

Date: 2026-06-30

Scope: handoff for `PRE-2 Studio pristine` before the multimodal refactoring
program described in `/home/delete/nirs4all/SYNTHESE_MULTIMODALE_NIRS4ALL.md`
and `nirs4all-ecosystem/docs/PARALLEL_REFACTORING_ROADMAP.md`.

Status: closure document for the current Studio cleanup branch. This document
supersedes the idea of continuing the old Studio-only roadmap as the main
objective. The remaining large items should now be treated as inputs to the
ecosystem locks and lanes, not as opportunistic Studio patches.

## Decision

The current Studio work did pre-chew a meaningful part of the next refactor.
It is relevant to finish this branch as a clean baseline, but it is not
relevant to keep expanding the old roadmap before the new ecosystem locks are
decided.

Practical decision:

- freeze this branch as the `PRE-2` baseline once validation is green;
- do not add new product concepts before `LOCK-CAP`, `LOCK-IO`, `LOCK-RT`,
  and `LOCK-UI`;
- keep cluster/WASM/native multimodal work behind explicit capability and
  unavailable-driver contracts until real runtimes exist;
- use this branch as the Studio evidence package for lanes `L2`, `L10`, `L11`,
  `L12`, `L15`, and `L17`.

## What is now pre-chewed

### Maintainability baseline

- `npm run doctor` gives a local environment gate for Node/npm/Python drift.
- Route ownership is documented in `docs/ARCHITECTURE_BOUNDARIES.md`.
- `npm run test:routes` guards duplicate public FastAPI `method + path`
  registrations.
- `src/lib/clientStorage` centralizes browser storage keys, guarded access, and
  versioned migration helpers.
- Large UI areas now have explicit data/read-model helper modules instead of
  keeping all behavior inside JSX containers.

Impact for the roadmap:

- supports `PRE-2`;
- reduces risk for `L11 nirs4all-ui` extraction because pure/presentation
  splits are documented;
- gives `L12 Studio reassembly` a concrete boundary map.

### Dataset and schema-facing seams

- Dataset catalog, drop handling, query normalization, quick-view projections,
  detail-tab projections, wizard parsing/file-mapping/target rules, and
  synthetic-data rules have dedicated helpers or focused components.
- The campaign preview path can already carry dataset schema/data-view summary
  references when available, with legacy fallback kept explicit.
- Playground raw spectra preview can now react to source and target selection.
- `/api/spectra/{dataset_id}` accepts target selection without changing the
  legacy default behavior.

Impact for the roadmap:

- helps `LOCK-IO` discussion by showing where Studio expects dataset previews,
  source summaries, target summaries, and data-view labels;
- does not replace `DatasetSpec v2` or `DatasetPackage`;
- future multimodal work should add schemas behind these seams, not widen page
  components directly.

### Pipeline and campaign seams

- `PipelineGraphSpec` exists as a frontend graph-facing contract over legacy
  editor steps.
- Pipeline import/export conversion has been split across focused modules for
  finetune params, branch/merge, generators, containers, leaf import, and leaf
  export.
- New Experiment planning is decomposed into dedicated helpers for dataset
  options, pipeline options, campaign spec construction, preview summaries,
  capability checks, compatibility checks, schema constraints, notices, and
  launch-state presentation.
- Campaigns now have explicit run matrices for both legacy cartesian mode and
  paired-by-index mode.
- Strict one-pair split previews can materialize candidate run-group specs.
- `POST /api/runs/run-groups` accepts a native launch payload directly and
  builds an execution plan from explicit split specs instead of rebuilding a
  hidden `datasets x pipelines` product.

Impact for the roadmap:

- pre-chews `L10 Runtime API` and `L12 Studio reassembly`;
- provides a migration path from cartesian experiments to campaign-like plans;
- does not yet create a durable campaign domain or replace the current Run
  model.

### Execution backend capability seam

- `api/execution_driver.py` defines canonical backend ids and driver
  capabilities for `local-python`, `cluster`, and `wasm-local`.
- Cluster and WASM are visible as future typed backends but unavailable by
  default.
- `create_run`, `create_run_group`, `retry_run`, and job start guard against
  unavailable backends with HTTP `501` before mutating run state.
- `GET /api/runs/execution-backends` exposes backend capability metadata.
- New Experiment consumes backend capabilities and blocks non-local campaign
  launch when no executable adapter is available.

Impact for the roadmap:

- directly supports `LOCK-CAP` and `LOCK-RT`;
- gives `L15 nirs4all-cluster` a safe UI/backend placeholder;
- prevents accidental local-python execution from masquerading as cluster or
  WASM support.

### Native results and Inspector seams

- Native chain summaries preserve additive `score_maps`, result metadata,
  branch identity, source identity, and native prediction context where the
  native reader/manifest provides them.
- Aggregated-prediction endpoints preserve native `scores`, `best_params`,
  result metadata, branch/source/target fields, and scalar or multitarget
  prediction arrays.
- Inspector normalization exposes `available_targets`.
- Frontend Inspector target selection prefers backend-provided target catalogs
  and falls back to chain metadata for older payloads.
- Target/source-dimensioned score refs are preserved as unmapped refs rather
  than being coerced into legacy flat score columns.

Impact for the roadmap:

- pre-chews `L2 Capabilities/conformance`, `L12 Studio reassembly`, and `L17
  Python oracle` by making score/result identity less lossy;
- does not yet replace Inspector ranking/meta-analysis with a full benchmark
  analysis store;
- keeps flat legacy score columns stable while richer native score maps remain
  transport-only.

### Run lifecycle hardening

- Failed run jobs mirror failure into `RunStoreRepository.fail_run()` instead of
  completing store runs by accident.
- `store_run_id` is assigned only after shared store precreation and project
  assignment succeed.
- Store open/pre-create/project failures degrade to local execution with
  warnings rather than corrupting run lifecycle state.

Impact for the roadmap:

- gives remote/cluster lifecycle work a safer local baseline;
- does not yet implement cluster-native cancel/retry/fail semantics.

### Product polish closure

- `public/nirs4all_logo.png` has been restored to the full logo asset used by
  splash and main/sidebar screens.
- The icon asset is no longer the visible replacement for those logo slots.

## What remains deliberately out of baseline

These are not closure blockers for `PRE-2`; they belong to the new refactoring
program.

- Real `dag-ml` runtime backend as the production `nirs4all` backend
  (`PRE-1`).
- Python parity oracle/conformance pack (`PRE-3`, `LOCK-PYREF`, `L17`).
- `DatasetSpec v2`, `DatasetPackage`, payload manifest, and production
  multimodal providers (`LOCK-IO`).
- Common runtime request/response schema for Studio/Web/CLI (`LOCK-RT`).
- Real `nirs4all-cluster` submit/progress/cancel/retry driver.
- Real WASM local runtime driver.
- Durable Campaign/RunGroup persistence tables and cross-run query surfaces.
- First-class target-aware score ranking and UI over `score_maps`.
- Full Inspector rewrite around benchmark/repository/content-addressed results.
- `nirs4all-ui` package extraction (`LOCK-UI`), beyond the current component
  boundary preparation.
- Resolved public naming contract: `nirs4all-core` is the canonical aggregate,
  `nirs4all-lite` is retired, and no public legacy alias is maintained
  (`LOCK-GOV`).

## Merge and tag gate

A merge/tag from this branch is acceptable only from a curated commit set with
no local-only artifacts. Do not merge a raw dirty worktree.

Minimum gates for a confident Studio baseline:

- `npm run doctor`
- `npm run test:routes`
- `npm run lint:parallel`
- `npm run test:parallel`
- `npm run build`
- `git diff --check`

Release-grade optional gates:

- `npm run test:e2e`
- `npm run build:electron`
- manual Electron smoke on the packaged app if the tag is meant for desktop
  distribution.

Current local caution:

- this branch contained a very large dirty worktree during closure
  triage: hundreds of modified tracked files and more than one thousand
  untracked files;
- the final merge must be based on explicit staged content and validation
  output, not on assumption that all local files are intentional.

## Handoff to ecosystem lanes

| Roadmap item | Studio evidence from this branch | Next action |
|---|---|---|
| `PRE-2` Studio pristine | Boundaries, storage facade, route gate, campaign/run-group seams, execution backend capabilities, Inspector/native result widening. | Mark ready only after final gates and curated merge. |
| `LOCK-CAP` / `L2` | Operator/campaign/backend capability language exists locally; unavailable backends are explicit. | Generalize vocabulary in ecosystem spec before adding runtime-specific UI claims. |
| `LOCK-IO` / `L7` | Dataset/source/target/schema-preview UI seams exist with legacy fallback. | Define `DatasetSpec v2` and `DatasetPackage`; then adapt Studio helpers to consume them. |
| `LOCK-RT` / `L10` | `/api/runs/execution-backends` and run-group payload route prove the need for a runtime capability contract. | Write common runtime API before wiring cluster/WASM implementations. |
| `LOCK-UI` / `L11` | Many visual components now have pure data/read-model helpers and bounded presentation modules. | Audit extractable components and fixtures; do not extract a design system before taxonomy is accepted. |
| `L12` Studio reassembly | New Experiment and campaign planning can move from cartesian assumptions toward explicit campaign plans. | Reassemble around runtime Python after `PRE-1` and `LOCK-RT`. |
| `L15` cluster | Cluster is typed but unavailable, with early-fail guards. | Implement real driver only after runtime schema and cluster roles/capabilities are accepted. |
| `L17` Python oracle | Native result transport is less lossy, and execution/run lifecycle is safer. | Build dual-run corpus and compare splits, predictions, metrics, artifacts, and expected failures. |

## Recommended next sequence

1. Close this branch: curate files, run gates, commit, merge, tag.
2. Update `PARALLEL_REFACTORING_SYNC.md`: set `PRE-2` evidence to this merged
   Studio tag/commit.
3. Do not start Studio feature work until `LOCK-CAP`, `LOCK-IO`, `LOCK-RT`, and
   `LOCK-UI` have accepted decisions.
4. Use Studio mainly as a consumer during early ecosystem work: validate that
   contracts are inspectable and that unsupported features render explicitly.

## Validation log

Earlier focused validation from the cleanup waves is recorded in
`docs/STUDIO_PRISTINE_PROGRESS.md`, including targeted backend pytest, Ruff,
Vitest, TypeScript, route, doctor, and diff-check runs.

Final closure commands run on 2026-06-30:

- passed: `npm run doctor`
- passed: `npm run test:routes` (`2 passed`)
- passed: `npm run lint:parallel`
- passed: `npm run test:parallel` (frontend Vitest passed; backend pytest
  `2160 passed, 59 skipped, 10 warnings`)
- passed: `npm run build`
- passed: `git diff --check`

Known non-blocking warnings:

- Vite reported existing chunk-size/code-splitting warnings.
- Pytest reported existing sklearn/pywt/pybaselines warnings plus async warning
  noise in refit notification tests.
