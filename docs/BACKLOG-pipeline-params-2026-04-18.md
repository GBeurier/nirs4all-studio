# Pipeline Editor Parameter Remediation Backlog

Date: 2026-04-18

Related:
- `docs/DIAGNOSIS-pipeline-params-2026-04-18.md`

## Status snapshot

Last updated: 2026-04-18

- Phase 0: complete
- `PIPE-PARAM-01`: complete
- `PIPE-PARAM-02`: complete
- `PIPE-PARAM-03`: complete
- Phase 1: complete
- `PIPE-PARAM-04`: complete
- `PIPE-PARAM-05`: complete
- `PIPE-PARAM-06`: complete
- Phase 2: complete
- `PIPE-PARAM-07`: complete
- `PIPE-PARAM-08`: complete
- Phase 3+: pending

## Goal

Correct the verified parameter-handling defects in the Pipeline Editor without introducing a second inconsistent parameter system.

The target end-state is:

1. One authoritative parameter catalog for editor UX: the node registry definitions.
2. One stable search-space grammar across import, edit, export, presets, and runtime.
3. One lossless persistence model for saved pipelines and for run reload.
4. One automated validation loop that catches model-definition drift before release.

## Delivery principles

- Fix read-compatibility before cleanup. Legacy data such as `float_log` must import safely before writers are normalized.
- Prefer registry-backed metadata over `stepOptions` for model names, params, defaults, and finetune hints.
- Do not push frontend-only defaults into canonical backend storage unless they are true semantic defaults.
- Keep saved pipeline round-trips lossless while changing run reload behavior deliberately.
- Add regression tests with each workstream; do not leave validation as a final cleanup step.

## Recommended phases

### Phase 0. Immediate correctness fixes — Complete

- [x] `PIPE-PARAM-01`
- [x] `PIPE-PARAM-02`
- [x] `PIPE-PARAM-03`

### Phase 1. Registry-backed editor behavior — Complete

- [x] `PIPE-PARAM-04`
- [x] `PIPE-PARAM-05`
- [x] `PIPE-PARAM-06`

### Phase 2. Run reload contract and persistence — Complete

- [x] `PIPE-PARAM-07`
- [x] `PIPE-PARAM-08`

### Phase 3. Converter hardening or reduction

- `PIPE-PARAM-09`
- `PIPE-PARAM-10`

### Phase 4. Definition accuracy and anti-drift automation

- `PIPE-PARAM-11`
- `PIPE-PARAM-12`

### Phase 5. Finetune metadata cleanup, regression coverage, and docs

- `PIPE-PARAM-13`
- `PIPE-PARAM-14`
- `PIPE-PARAM-15`

## Backlog items

### PIPE-PARAM-01 — Accept `float_log` as a legacy alias everywhere on read

Priority: `P0`

Status: Complete

Problem:
Current import paths accept `log_float` but not `float_log`, while shipped presets still emit `float_log`.

Scope:
- backend canonical import
- frontend converter import
- any bridge code that reconstructs finetune config from canonical search-space tuples

Likely files:
- `api/pipeline_canonical.py`
- `api/nirs4all_adapter.py`
- `src/utils/pipelineConverter.ts`
- `src/utils/nativePipelineFormat.ts`
- `tests/test_pipeline_canonical.py`
- `src/utils/__tests__/pipelineConverter.test.ts`

Tasks:
- expand token parsing so `float_log` is accepted anywhere `log_float` is accepted on read
- normalize parsed editor state to `log_float` internally
- confirm export still writes the canonical token chosen by product policy
- add regression cases for backend import-preview and client-side converter import

Acceptance criteria:
- importing `["float_log", low, high]` produces a `log_float` editor param, not a categorical param
- importing `["log_float", low, high]` continues to work unchanged
- no existing `log_float` test regresses

Notes:
- This item should land before preset cleanup so current data stops rendering incorrectly immediately.

### PIPE-PARAM-02 — Normalize preset generation and shipped preset files to one token

Priority: `P1`

Status: Complete

Problem:
Even after alias support is added, the repository will still emit mixed vocabulary unless preset sources are cleaned up.

Scope:
- generated preset source code
- committed preset YAMLs
- docs that present search-space syntax

Likely files:
- `scripts/presets_generation/presets.py`
- `api/presets/*.yaml`
- `docs/_internals/canonical_pipeline_round_trip.md`

Tasks:
- change preset generators to emit `log_float`
- regenerate or manually update committed presets so they stop producing legacy tuples
- update internal docs to show `log_float` as the canonical spelling
- add a grep-based or fixture-based test that rejects new `float_log` emissions in generated presets

Acceptance criteria:
- repository presets no longer contain `float_log`
- preset generation scripts emit `log_float`
- the product still reads old external files containing `float_log`

### PIPE-PARAM-03 — Hydrate visible defaults for imported steps outside `handleNameChange`

Priority: `P0`

Status: Complete

Problem:
Imported model steps can arrive with `params: {}` and show no editable defaults until the user manually re-selects the node.

Scope:
- editor hydration after import-preview
- editor hydration after loading saved steps into the React state tree
- display of default params when no explicit value exists

Likely files:
- `src/hooks/usePipelineEditor.ts`
- `src/components/pipeline-editor/StepConfigPanel.tsx`
- `src/components/pipeline-editor/renderableParams.ts`
- `src/components/pipeline-editor/contexts/NodeRegistryContext.v2.tsx`
- `src/components/pipeline-editor/__tests__/renderableParams.test.ts`
- `src/pages/PipelineEditor.test.tsx`

Tasks:
- define a single hydration utility that merges registry defaults into steps that omit a param entirely
- call that utility when steps enter editor state from import, preset load, and saved pipeline load
- keep explicit empty values and explicit user-provided values untouched
- stop relying on `handleNameChange` as the only place that injects defaults

Acceptance criteria:
- an imported `Ridge` step shows `alpha` immediately without requiring node re-selection
- default hydration does not overwrite an explicitly provided param value
- the same imported step looks identical in the palette, config panel, and serialized editor state

Design constraint:
- implement this in frontend hydration, not by hard-coding UI defaults into canonical backend JSON.

### PIPE-PARAM-04 — Introduce one registry-backed parameter metadata API for editor consumers

Priority: `P0`

Status: Complete

Problem:
The editor uses the registry in the palette but still uses `stepOptions` in many config surfaces.

Scope:
- metadata lookup for display name, parameters, default params, categories, and finetune hints
- compatibility layer for legacy flows during migration

Likely files:
- `src/components/pipeline-editor/contexts/NodeRegistryContext.v2.tsx`
- `src/data/nodes/types.ts`
- `src/components/pipeline-editor/types.ts`
- new shared helper under `src/components/pipeline-editor` or `src/data/nodes`

Tasks:
- add a shared helper or hook that resolves step metadata from the active registry first
- define fallback behavior for legacy nodes that do not yet have registry entries
- expose a stable API so UI components no longer need to know whether metadata came from registry or legacy tables
- document which fields remain temporarily sourced from `stepOptions`

Acceptance criteria:
- config consumers can ask for one metadata object without directly reading `stepOptions`
- fallback behavior is explicit and test-covered
- there is a single migration seam for later `stepOptions` removal

### PIPE-PARAM-05 — Move Step Config rendering to the registry-backed metadata path

Priority: `P0`

Status: Complete

Problem:
`StepConfigPanel` and model-specific renderers still depend on `stepOptions`, which makes imported registry-backed models fall back to stale or missing metadata.

Scope:
- main step config panel
- model renderer
- default renderer behavior where parameter definitions are needed

Likely files:
- `src/components/pipeline-editor/StepConfigPanel.tsx`
- `src/components/pipeline-editor/config/step-renderers/ModelRenderer.tsx`
- `src/components/pipeline-editor/config/step-renderers/DefaultRenderer.tsx`
- `src/components/pipeline-editor/config/step-renderers/__tests__/*.test.tsx`

Tasks:
- replace direct `stepOptions[...]` lookups with the registry-backed metadata API from `PIPE-PARAM-04`
- make parameter rendering, default values, and descriptions come from registry definitions
- keep a controlled fallback path only for node types that truly lack registry coverage
- add component tests for a curated registry-only model and for a legacy fallback model

Acceptance criteria:
- a model present in the JSON registry but absent from `stepOptions.model` still renders its parameters correctly
- config descriptions and finetune hints match the registry definition currently loaded by the editor
- `StepConfigPanel` no longer needs to know about `stepOptions.model` for normal model rendering

### PIPE-PARAM-06 — Migrate palette-adjacent generators and menus off `stepOptions.model`

Priority: `P1`

Status: Complete

Problem:
Even if the main config panel is fixed, generators and command surfaces will remain stale if they keep enumerating `stepOptions`.

Scope:
- command palette
- context menu
- OR/cartesian generators
- merge flow menu if it depends on legacy catalogs
- any helper that builds add-node menus

Likely files:
- `src/components/pipeline-editor/CommandPalette.tsx`
- `src/components/pipeline-editor/StepContextMenu.tsx`
- `src/components/pipeline-editor/OrGenerator.tsx`
- `src/components/pipeline-editor/CartesianGenerator.tsx`
- `src/components/pipeline-editor/config/step-renderers/MergeRenderer.tsx`
- `src/components/pipeline-editor/StepPalette.tsx`

Tasks:
- switch model/preprocessing enumeration to the same registry-backed metadata API
- preserve category filtering and quick-pick behavior using registry categories/tags
- identify remaining consumers that still require `stepOptions` for non-model legacy nodes
- remove or quarantine stale legacy entries such as `LSTM`, `MLP`, and `nicon` once registry-backed menus are stable

Acceptance criteria:
- add-node surfaces present the same model inventory as the palette for the active registry tier
- stale exact-name mismatches no longer appear as first-class model choices
- legacy fallback is visibly limited to nodes not yet represented in the registry

### PIPE-PARAM-07 — Decide and document the run reload contract

Priority: `P0`

Problem:
Run reload currently reconstructs the executed expanded variant, not the original editable authoring template, and that distinction is undocumented in the product contract.

Scope:
- backend API semantics
- run detail UI expectations
- prediction detail / chain detail UI expectations
- product documentation

Likely files:
- `api/aggregated_predictions.py`
- `api/pipelines.py`
- `src/components/runs/runDetailUtils.ts`
- `src/components/predictions/detail/ChainDetailPanel.tsx`
- `docs/_internals/canonical_pipeline_round_trip.md`

Tasks:
- choose one of two supported contracts:
  - run reload reopens the original authoring template
  - run reload intentionally shows the expanded executed pipeline and labels it as such
- document the chosen behavior in code comments and internal docs
- update UI copy so the user understands what they are reopening
- add tests that encode the chosen contract explicitly

Acceptance criteria:
- product behavior is deliberate rather than accidental
- API and UI docs agree on whether a run reload is editable template state or executed snapshot state
- there is a failing test if the behavior drifts again

Decision gate:
- This choice should be made before changing run persistence in `PIPE-PARAM-08`.

Resolution:
- New runs reload the original authoring template via a persisted `original_template` field.
- Older runs without that field degrade to a cleaned expanded snapshot and must be labeled as a legacy fallback.

### PIPE-PARAM-08 — Persist enough run data to satisfy the chosen reload contract

Priority: `P0`

Problem:
Current run storage keeps `expanded_config` and `generator_choices`, which is not enough to recover the original finetune/search template.

Scope:
- executor persistence
- run schema
- run-read API
- migration strategy for existing stored runs

Likely files:
- `../nirs4all/nirs4all/pipeline/storage/store_schema.py`
- `../nirs4all/nirs4all/pipeline/execution/executor.py`
- `api/aggregated_predictions.py`
- `src/components/runs/runDetailUtils.ts`
- `src/components/runs/runDetailUtils.test.ts`

Tasks:
- add a persisted field for original editor or canonical template steps if the chosen contract requires authoring-time reload
- if executed-snapshot reload remains the product choice, add explicit metadata identifying the payload as expanded-only and stop implying editability
- decide how older runs without the new field should behave
- add a data migration or read-time fallback for historical rows

Acceptance criteria:
- new runs contain enough information to satisfy the chosen reload contract
- old runs degrade in a documented way
- run detail utilities and tests reflect the new persistence shape

Implemented:
- pipeline rows now persist a nullable `original_template` alongside `expanded_config` and `generator_choices`
- the run reload API returns explicit metadata describing whether the editor received an authoring template or a legacy expanded snapshot fallback
- focused backend, frontend, and storage tests cover both the new contract and backward-compatible fallback behavior

### PIPE-PARAM-09 — Audit every live use of `importFromNirs4all` and replace secondary uses where possible

Priority: `P1`

Problem:
The TypeScript converter remains in live UI paths, so its bugs still matter even if the main backend import-preview path is correct.

Scope:
- preset loading
- run detail utilities
- chain detail views
- any pipeline-editor hook that still calls the converter directly

Likely files:
- `src/components/pipelines/PresetSelector.tsx`
- `src/components/runs/runDetailUtils.ts`
- `src/components/predictions/detail/ChainDetailPanel.tsx`
- `src/hooks/usePipelineEditor.ts`
- `src/utils/pipelineConverter.ts`

Tasks:
- list every current call site and classify it:
  - must stay client-side
  - can move to backend canonical conversion
  - can consume already-normalized editor JSON instead
- reduce the number of converter call sites where practical
- document the remaining supported responsibilities of `pipelineConverter.ts`

Acceptance criteria:
- there is an explicit inventory of live converter consumers
- at least the avoidable call sites are removed or replaced
- the converter is no longer a silent parallel import system for the same data shapes

### PIPE-PARAM-10 — Fix client-side converter lossiness where it must remain

Priority: `P1`

Problem:
The converter still mishandles `_grid_` and `_zip_` scalar values and rewrites `train_params` into a narrow fixed shape.

Scope:
- remaining client-side import path behavior
- canonical-to-editor conversion fidelity
- round-trip tests

Likely files:
- `src/utils/pipelineConverter.ts`
- `src/utils/__tests__/pipelineConverter.test.ts`
- `src/components/runs/runDetailUtils.test.ts`

Tasks:
- stop sending scalar `_grid_` and `_zip_` values through `convertStepToEditor()`
- preserve arbitrary `train_params` keys or store them in a lossless structured field rather than a narrow UI subset
- add fixtures covering scalar sweeps, grouped sweeps, and nonstandard training params
- add a round-trip assertion for the remaining supported converter contract

Acceptance criteria:
- scalar `_grid_` and `_zip_` values survive import without being treated like steps
- nonstandard `train_params` keys are not silently dropped
- converter tests cover the exact bugs named in the diagnosis

### PIPE-PARAM-11 — Correct the objectively wrong model declarations

Priority: `P0`

Problem:
Several curated definitions and extended registry entries do not match real constructor signatures or accepted values.

Scope:
- curated model definitions
- extended registry data
- legacy aliases only where still required during migration

Known first-pass fixes:
- add real parameter lists for `tabpfn` and `tabicl` models
- fix `LWPLS` from `n_neighbors` to `lambda_in_similarity`
- fix `cnn1d` / NICoN parameter names
- align `meta_model` to `model`
- fix `robust_pls.weighting` choices
- fix `mbpls.method` choices
- type `kpls.gamma` as numeric
- correct `random_state` typing in `extended.json`

Likely files:
- `src/data/nodes/definitions/models/*.json`
- `public/node-registry/extended.json`
- `src/data/nodes/generated/*.json`
- any generation script that produces those artifacts

Tasks:
- patch source definitions, not only generated output, wherever generation exists
- regenerate derived registry artifacts if the project has a generation path for them
- add targeted tests for the specific models already known to be wrong
- review whether temporary compatibility shims are needed for old saved editor JSON

Acceptance criteria:
- the named models expose parameter names and allowed values that match the actual constructors in the current environment
- `random_state` is typed consistently as numeric where appropriate
- generated registry artifacts are refreshed and test-covered

### PIPE-PARAM-12 — Add automated definition-vs-constructor validation for high-value models

Priority: `P0`

Problem:
Manual definition fixes will drift again unless the repository can detect signature mismatches automatically.

Scope:
- curated registry validation
- selected third-party packages that are already present in the project environment
- CI-friendly test or script output

Likely files:
- `scripts/test_node_pipeline_compat.py`
- `tests/test_node_registry_loader.py`
- new validation test under `tests/`
- `src/data/nodes/definitions/models/*.json`

Tasks:
- define a validation target set for high-risk models first:
  - deep-learning models
  - meta models
  - PLS variants
  - `tabpfn`
  - `tabicl`
- compare declared parameter names and basic type expectations against actual Python signatures
- fail loudly on unknown parameters, missing high-value parameters, and invalid enum choices where those can be checked
- document the small number of intentional exceptions if wrappers rename parameters

Acceptance criteria:
- CI fails when a curated model definition drifts away from its Python constructor signature
- the current known mismatches would have been caught by the new validation
- validation output is readable enough for maintainers to act on quickly

### PIPE-PARAM-13 — Remove `finetunePresentKeys` and `finetuneSamplerKey` as stale side-channel state

Priority: `P1`

Problem:
Import stamps finetune presence and sampler metadata onto steps, export reads it back, and the UI does not recompute it after edits.

Scope:
- backend canonical import/export
- frontend finetune editing flows
- serialized editor-step shape

Likely files:
- `api/pipeline_canonical.py`
- `src/components/pipeline-editor/finetuning/*`
- `src/components/pipeline-editor/types.ts`
- `tests/test_pipeline_canonical.py`

Tasks:
- derive present finetune sections and sampler selection from current step state at export time
- stop relying on stale imported markers when current editor state is authoritative
- keep temporary backward-compatibility reads only if historical saved editor JSON requires them
- add tests proving that editing finetune sections updates exported presence correctly

Acceptance criteria:
- deleting or adding finetune sections in the UI changes exported canonical JSON without stale carry-over
- sampler export reflects the current edited state, not imported side-channel metadata
- the editor-step type documents any remaining compatibility fields clearly

### PIPE-PARAM-14 — Expand regression coverage around import, hydration, and run reload

Priority: `P0`

Problem:
Most of these failures are cross-layer regressions. They will return unless tests cover the real import and reload paths.

Scope:
- backend canonical tests
- frontend editor hydration tests
- run detail utilities
- registry loading tests

Likely files:
- `tests/test_pipeline_canonical.py`
- `tests/test_pipeline_roundtrip.py`
- `src/components/pipeline-editor/__tests__/renderableParams.test.ts`
- `src/pages/PipelineEditor.test.tsx`
- `src/components/runs/runDetailUtils.test.ts`
- `src/components/pipeline-editor/contexts/NodeRegistryContext.v2.test.tsx`

Minimum scenarios:
- import bare-string `Ridge` and confirm visible defaults hydrate
- import `float_log` and confirm it becomes `log_float`
- render a registry-only model with params in the config panel
- reload a run and assert the chosen contract from `PIPE-PARAM-07`
- edit finetune sections and confirm export derives current presence
- validate corrected model definitions load cleanly

Acceptance criteria:
- each verified defect from the diagnosis has at least one regression test
- tests exercise both backend and frontend boundaries where the bug crossed layers

### PIPE-PARAM-15 — Clean docs and remove stale migration leftovers

Priority: `P2`

Problem:
Once behavior changes, the codebase will still contain stale docs and compatibility scaffolding unless cleanup is tracked explicitly.

Scope:
- diagnosis cross-links
- internal architecture docs
- inline comments around registry migration
- legacy `stepOptions.model` cleanup once safe

Likely files:
- `docs/DIAGNOSIS-pipeline-params-2026-04-18.md`
- `docs/_internals/canonical_pipeline_round_trip.md`
- `src/components/pipeline-editor/contexts/NodeRegistryContext.v2.tsx`
- `src/components/pipeline-editor/types.ts`

Tasks:
- update docs to describe the final parameter authority and run reload contract
- remove comments that still describe temporary migration states after those states are gone
- delete stale legacy model entries and compatibility paths that are no longer used
- leave a short maintenance note describing how new model definitions should be validated going forward

Acceptance criteria:
- docs match shipped behavior
- obsolete legacy model entries and comments are removed rather than left to drift
- maintainers have a clear source-of-truth path for future parameter additions

## Suggested implementation order

1. `PIPE-PARAM-01`
2. `PIPE-PARAM-03`
3. `PIPE-PARAM-04`
4. `PIPE-PARAM-05`
5. `PIPE-PARAM-11`
6. `PIPE-PARAM-12`
7. `PIPE-PARAM-07`
8. `PIPE-PARAM-08`
9. `PIPE-PARAM-09`
10. `PIPE-PARAM-10`
11. `PIPE-PARAM-06`
12. `PIPE-PARAM-13`
13. `PIPE-PARAM-14`
14. `PIPE-PARAM-02`
15. `PIPE-PARAM-15`

## Definition of done

The backlog should be considered complete only when all of the following are true:

- imported models show correct editable params without manual re-selection
- `float_log` no longer mis-renders anywhere, while old files still import safely
- editor config surfaces and add-node surfaces resolve model metadata from the registry path
- run reload behavior is explicit, documented, and backed by the stored data shape
- remaining client-side converter paths are either fixed or removed
- corrected model definitions are validated automatically against real constructors
- finetune export is derived from current state rather than stale side-channel markers
- regression tests cover every defect class listed in the diagnosis
