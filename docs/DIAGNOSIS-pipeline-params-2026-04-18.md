# Pipeline Editor Parameter Diagnosis — Fact-Checked 2026-04-18

**Status:** This is a corrected, repository-backed version of the earlier diagnosis. It keeps claims that are directly verifiable in the current tree and removes or downgrades claims that were stale, speculative, or no longer matched the implementation.

**Related:** `docs/BACKLOG-pipeline-params-2026-04-18.md`

## Scope reviewed

- `api/pipeline_canonical.py`
- `api/aggregated_predictions.py`
- `api/nirs4all_adapter.py`
- `api/pipelines.py`
- `src/pages/PipelineEditor.tsx`
- `src/components/pipeline-editor/StepPalette.tsx`
- `src/components/pipeline-editor/StepConfigPanel.tsx`
- `src/components/pipeline-editor/renderableParams.ts`
- `src/components/pipeline-editor/types.ts`
- `src/components/pipeline-editor/config/step-renderers/ModelRenderer.tsx`
- `src/components/pipeline-editor/contexts/NodeRegistryContext.v2.tsx`
- `src/utils/pipelineConverter.ts`
- curated model definitions in `src/data/nodes/definitions/models/*.json`
- relevant constructors in `../nirs4all/nirs4all/operators/models/**`
- installed `tabpfn` and `tabicl` package signatures in `../.venv/Lib/site-packages`

## Executive summary

- Confirmed: imported bare-string models still arrive with empty `params`, and the UI only applies legacy `defaultParams` when sweeps exist. This is why an imported `Ridge` can show no `alpha`.
- Confirmed: `float_log` is still not recognized by the parser. Presets still emit `float_log`, but the converter only accepts `log_float`, so those search spaces are parsed as categorical in the editor.
- Confirmed: the palette is registry-driven, but much of the configuration UI is still `stepOptions`-driven. The split is broader than the previous note suggested.
- Confirmed: run reload is based on stored `expanded_config` plus `generator_choices`; that storage shape cannot reconstruct the original authoring-time finetune/search-space template.
- Confirmed: several model declarations are objectively wrong today.
- Removed from the old note: stale registry accounting via `extended.json`, the old `concat_transform` lossiness claim, and broad "missing tunable params" wishlists that were not objective defects.

## Verified findings

### 1. Imported non-swept models still miss visible defaults in the config panel

Evidence:

- `canonical_to_editor([{"model": "sklearn.linear_model.Ridge"}])` currently yields a model step with `params: {}` and `modelStyle: "string"` in `api/pipeline_canonical.py`.
- `src/components/pipeline-editor/renderableParams.ts` returns `step.params` unchanged when `paramSweeps` is empty.
- `src/components/pipeline-editor/StepConfigPanel.tsx` only injects `option.defaultParams` inside `handleNameChange`, i.e. after the user manually re-selects the node.

Impact:

- Imported `Ridge` / `Lasso` / similar string-form model steps can display no editable params even though `stepOptions.model` defines defaults.

### 2. `float_log` is still mis-parsed as categorical

Evidence:

- `api/pipeline_canonical.py` and `src/utils/pipelineConverter.ts` only accept `log_float` in `SEARCH_SPACE_TOKENS`.
- Presets still contain `float_log` in 5 preset files and 18 occurrences at the time of review.
- Reproduction:

```python
canonical_to_editor([
  {
    "model": {"class": "sklearn.linear_model.Ridge"},
    "finetune_params": {"model_params": {"alpha": ["float_log", 1e-4, 1e2]}},
  }
])[0]["finetuneConfig"]["model_params"]
# => [{'name': 'alpha', 'type': 'categorical', 'choices': ['float_log', 0.0001, 100.0], ...}]
```

Impact:

- The editor renders log-scale finetune params incorrectly.
- Export/runtime remain mostly intact because `_serialize_finetune_param_config()` preserves `rawValue`, but the UI is misleading and user edits can damage the search-space shape.

### 3. Registry / `stepOptions` split is real, but the old counts were stale

Current state:

- `PipelineEditor.tsx` mounts `NodeRegistryProvider useJsonRegistry`.
- `StepPalette.tsx` uses the registry when available.
- `StepConfigPanel.tsx`, `ModelRenderer.tsx`, `CommandPalette.tsx`, `OrGenerator.tsx`, `CartesianGenerator.tsx`, `MergeRenderer.tsx`, and `StepContextMenu.tsx` still read legacy `stepOptions`.

Current counts:

- Curated JSON definitions currently contain `137` model nodes under `src/data/nodes/definitions/models/*.json`.
- `stepOptions.model` currently contains `31` entries.
- `109` curated model names do not have an exact `stepOptions.model` match.
- `stepOptions.model` contains three exact-name mismatches against the curated registry: `LSTM`, `MLP`, and `nicon`.
- `public/node-registry/extended.json` currently contains `253` extra nodes, but it is only fetched when the editor tier is set to `All` (`extendedMode`).

Impact:

- The palette and the config UI do not share one authoritative model catalog.
- Imported registry-backed models frequently fall through to incomplete or stale legacy metadata.

### 4. Run reload cannot reconstruct authoring-time finetune/search-space templates

Evidence:

- `api/aggregated_predictions.py:get_run_pipeline_steps()` returns `_extract_expanded_pipeline_steps(pipeline)`.
- The run-pipeline store schema keeps `expanded_config` and `generator_choices`, not the original editor JSON.
- `nirs4all.pipeline.execution.executor` persists `expanded_config=steps` and `generator_choices=...`.

Impact:

- Loading a stored run gives you the expanded executed variant, not the original editable template.
- Search-space declarations and authoring-time finetune structure are therefore not recoverable from this endpoint alone.

Notes:

- This is an architectural limitation of the current stored data shape, not just a frontend bug.
- Saved user pipelines are different: `api/pipelines.py` stores normalized editor `steps` verbatim, so normal pipeline save/reload remains lossless.

### 5. The TypeScript converter still has real lossiness in flows that use it

Evidence:

- `src/utils/pipelineConverter.ts` converts `_grid_` and `_zip_` values by mapping them through `convertStepToEditor()`, even when the values are scalars.
- The same file rewrites `train_params` into a fixed `trainingConfig` shape with defaults for only a small set of keys.
- `importFromNirs4all` is still used in shipped frontend code, including `PresetSelector.tsx`, `ChainDetailPanel.tsx`, and `runDetailUtils.ts`.

Impact:

- These bugs do not affect the main backend preview/import path used by `POST /pipelines/import-preview`.
- They do still affect UI flows that rely on the client-side converter.

### 6. Several model declarations are objectively wrong today

Confirmed declaration defects:

- `model.tabpfn`, `model.tabpfn_classifier`, `model.tabicl_regressor`, and `model.tabicl_classifier` all declare `parameters: []`, despite the installed package constructors exposing many kwargs.
- `model.lwpls` declares `n_neighbors`, but the current `LWPLS.__init__()` expects `lambda_in_similarity`.
- `model.cnn1d` declares `n_filters` and `kernel_size`, while the current NICoN factory reads keys such as `filters1`, `kernel_size1`, `strides1`, and `spatial_dropout`.
- `model.meta_model` declares `estimator`, legacy `stepOptions` uses `base_estimator`, and the actual constructor parameter is `model`.
- `model.robust_pls` exposes `weighting = {huber, fair}`, but the current constructor only accepts `huber` or `tukey`.
- `model.mbpls` exposes `method = {barnes_hut, exact}`, but the current constructor says only `NIPALS` is supported.
- `model.kpls` types `gamma` as `string`, but `KernelPLS.__init__()` expects `gamma: float | None`.
- `extended.json` systematically types `random_state` as `string`; current count is `132` such entries.

Secondary legacy issues:

- `stepOptions.model` still contains `LSTM`, which has no exact curated registry counterpart.
- `MLP` in `stepOptions` does not match curated `MLPRegressor`.
- `nicon` in `stepOptions` does not exactly match curated `NICoN`.

### 7. `finetunePresentKeys` / `finetuneSamplerKey` are still side channels

Evidence:

- `api/pipeline_canonical.py` stamps `finetunePresentKeys` and `finetuneSamplerKey` on import.
- The same file uses them again on export.
- There is no matching UI-side recomputation after edits.

Impact:

- This can preserve stale presence information after the user edits the finetune block.

## Claims removed or downgraded from the earlier draft

- The earlier registry accounting around `extended.json` was stale and no longer described how the editor actually loads node data.
- The earlier `concat_transform` flattening claim does not match the current `pipeline_canonical.py`; the exporter now serializes branch groups.
- Broad "missing tunable params" lists were removed unless they mapped to an objective constructor/registry mismatch.
- The old "~24 JSON-only models invisible to the params editor" estimate was materially outdated; the current exact-name gap between curated model definitions and `stepOptions.model` is much larger.

## Recommended fix order

1. Accept `float_log` as an alias everywhere that currently expects `log_float`.
2. Stop using `stepOptions` as the config-panel authority; switch parameter/default lookup to the same registry used by `StepPalette`.
3. Apply defaults during import/hydration, not only during render or after `handleNameChange`.
4. Decide explicitly whether run reload should reopen the original editor template or the expanded executed pipeline, and store the necessary data accordingly.
5. Add regression tests that compare curated node parameter names/types against real constructor signatures for high-value models.
6. Remove or replace stale legacy `stepOptions.model` entries (`LSTM`, `MLP`, `nicon`) once the registry-backed config path is complete.

## What is not broken

- Saved pipeline JSON reload is still lossless: `api/pipelines.py` stores editor `steps` directly.
- `float_log` search spaces are mis-rendered, but `rawValue` preservation means canonical export can still emit the original tuple/list form.
- The main Pipeline Editor import preview path is backend-driven; the TS converter problems are mostly in secondary UI flows, not the primary import endpoint.

This updated note is intentionally narrower than the original. It keeps only the claims that are directly verifiable against the current repository and installed packages.
