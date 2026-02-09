My question:

The nirs4all library has radically changed (no more legacy, caching, refit, etc. etc.)
I want to make a review of disrepancies that has appear between webapp pages - api and library.

I want you to write in /docs a document oragnized like that:
- First a tab for all the pages of the webapp with the following columns:
Page | Main role | routes called | moduleS/files/classes managed
- Then a section about the changes in nirs4all that necessit route or page updates
- Then lastly, a bigger section, with the enumeration of what nirs4all can do that is not included currently in the webapp

Basically, I want to see the work I need to do to be consistent with the library in the current setup/list of features of the webapp. And what needs to be implemented to allow a complete control over the lib features.


The Answser:

# Webapp/API/Library Discrepancy Review

Date: 2026-02-08
Scope: `nirs4all_webapp` pages + FastAPI routes + current `nirs4all` capability surface.
Assumption for this review: target `nirs4all` direction is **no legacy format**, **no cache controls**, **no refit phase**.

## 1) Webapp Pages Map

| Page | Main role | Routes called | Modules/files/classes managed |
|---|---|---|---|
| Dashboard (`/`) | Landing overview, recent activity, quick actions, dev synthetic generation | `GET /dashboard`<br>`GET /dashboard/stats`<br>`GET /dashboard/recent-runs`<br>`GET /datasets/synthetic-presets`<br>`POST /datasets/generate-synthetic` | `src/pages/Dashboard.tsx`<br>`src/hooks/useDashboard.ts`<br>`src/components/dashboard/DeveloperQuickStart.tsx` |
| Datasets (`/datasets`) | Dataset inventory, linking, editing, grouping, wizard onboarding | `POST /workspace/reload`<br>`GET /workspaces`<br>`GET /datasets`<br>`POST /datasets/link`<br>`DELETE /datasets/{id}`<br>`POST /datasets/{id}/refresh`<br>`GET/POST/PUT/DELETE /workspace/groups*`<br>`POST /workspace/groups/{group_id}/datasets`<br>`DELETE /workspace/groups/{group_id}/datasets/{dataset_id}`<br>`POST /datasets/detect-unified`<br>`POST /datasets/validate-files`<br>`POST /datasets/preview`<br>`POST /datasets/preview-upload` (frontend expects this)<br>`POST /datasets/detect-format`<br>`POST /datasets/auto-detect`<br>`GET /workspace/data-defaults`<br>`GET /datasets/{id}/preview`<br>`GET /datasets/{id}/targets`<br>`GET /datasets/synthetic-presets`<br>`POST /datasets/generate-synthetic` | `src/pages/Datasets.tsx`<br>`src/components/datasets/DatasetWizard/*`<br>`src/components/datasets/DatasetQuickView.tsx`<br>`src/components/datasets/EditDatasetPanel.tsx`<br>`src/components/datasets/SyntheticDataDialog.tsx`<br>`src/components/datasets/TargetSelector.tsx` |
| Dataset Detail (`/datasets/:id`) | Per-dataset deep view (tabs + preview) | `GET /datasets/{id}`<br>`GET /datasets/{id}/preview` | `src/pages/DatasetDetail.tsx` |
| Playground (`/playground`) | Interactive preprocessing/splitting experimentation on spectra | `GET /playground/operators`<br>`POST /playground/execute`<br>`GET /spectra/{dataset_id}` (`include_y=true` path used)<br>`POST /playground/diff/repetition-variance`<br>`GET /workspace` | `src/pages/Playground.tsx`<br>`src/hooks/useSpectralData.ts`<br>`src/hooks/usePlaygroundPipeline.ts`<br>`src/hooks/usePlaygroundQuery.ts`<br>`src/components/playground/*` |
| Pipelines (`/pipelines`) | Pipeline library CRUD, cloning, presets, favorites | `GET /pipelines`<br>`GET /pipelines/presets`<br>`GET /pipelines/operators`<br>`POST /pipelines`<br>`PUT /pipelines/{id}`<br>`DELETE /pipelines/{id}`<br>`POST /pipelines/from-preset/{id}`<br>`POST /pipelines/{id}/clone` | `src/pages/Pipelines.tsx`<br>`src/hooks/usePipelines.ts` |
| Pipeline Editor (`/pipelines/new`, `/pipelines/:id`) | Build/edit pipeline graph + variant estimation + sample templates | `POST /pipelines` or `PUT /pipelines/{id}`<br>`GET /pipelines/samples`<br>`GET /pipelines/samples/{sample_id}`<br>`GET /datasets` (binding)<br>`POST /pipelines/count-variants` | `src/pages/PipelineEditor.tsx`<br>`src/hooks/usePipelineEditor.ts`<br>`src/hooks/useDatasetBinding.ts`<br>`src/hooks/useVariantCount.ts`<br>`src/components/pipeline-editor/*` |
| Runs (`/runs`) | Unified view of active runs + discovered workspace runs | `GET /runs`<br>`GET /runs/stats`<br>`GET /workspaces`<br>`GET /workspaces/{workspace_id}/runs` | `src/pages/Runs.tsx`<br>`src/components/runs/RunDetailSheet.tsx` |
| New Experiment (`/runs/new`) | Run creation wizard (dataset + pipeline + config) | `GET /datasets`<br>`GET /pipelines`<br>`POST /runs` | `src/pages/NewExperiment.tsx` |
| Run Progress (`/runs/:id`) | Live status/log tracking for a run | `GET /runs/{id}`<br>`POST /runs/{id}/stop`<br>`GET /runs/{id}/logs/{pipeline_id}`<br>WebSocket `/ws` (includes `refit_*` message handling) | `src/pages/RunProgress.tsx` |
| Results (`/results`) | Workspace result list grouped by dataset/pipeline | `GET /workspaces`<br>`GET /workspaces/{workspace_id}/results` | `src/pages/Results.tsx`<br>`src/components/results/ResultDetailSheet.tsx` |
| Aggregated Results (`/results/aggregated`) | Chain-level aggregated metrics and fold/partition drilldown | `GET /aggregated-predictions`<br>`GET /aggregated-predictions/chain/{chain_id}`<br>`GET /aggregated-predictions/chain/{chain_id}/detail`<br>`GET /aggregated-predictions/{prediction_id}/arrays` | `src/pages/AggregatedResults.tsx`<br>`src/components/predictions/ChainDetailSheet.tsx` |
| Predictions (`/predictions`) | Prediction records browsing + fast summary + scatter quick view | `GET /workspaces`<br>`GET /workspaces/{workspace_id}/predictions/summary`<br>`GET /workspaces/{workspace_id}/predictions/data`<br>`GET /workspaces/{workspace_id}/predictions/{prediction_id}/scatter` | `src/pages/Predictions.tsx`<br>`src/components/predictions/PredictionQuickView.tsx` |
| Analysis Hub (`/analysis`) | Navigation hub for analysis tools | No API calls; UI links to `/analysis/transfer`, `/analysis/importance`, `/analysis/pca`, `/analysis/comparison`, `/analysis/residuals`, `/results` | `src/pages/Analysis.tsx` |
| Transfer Analysis (`/analysis/transfer`) | Cross-dataset transfer/preprocessing comparison | `POST /analysis/transfer`<br>`GET /datasets`<br>`GET /analysis/transfer/presets`<br>`GET /analysis/transfer/preprocessing-options` | `src/pages/TransferAnalysis.tsx`<br>`src/components/transfer-analysis/TransferAnalysisForm.tsx`<br>`src/components/transfer-analysis/ResultsPanel.tsx` |
| Variable Importance (`/analysis/importance`) | SHAP compute + visual interpretation | `POST /analysis/shap/compute`<br>`GET /analysis/shap/results/{job_id}`<br>`GET /analysis/shap/models`<br>`GET /datasets`<br>`GET /analysis/shap/results/{job_id}/beeswarm`<br>`GET /analysis/shap/results/{job_id}/sample/{sample_idx}` | `src/pages/VariableImportance.tsx`<br>`src/components/variable-importance/*` |
| Spectra Synthesis (`/synthesis`) | Synthetic spectra builder and export | `POST /api/synthesis/preview`<br>`POST /api/synthesis/generate`<br>`GET /api/workspace` | `src/pages/SpectraSynthesis.tsx`<br>`src/components/spectra-synthesis/contexts/SynthesisBuilderContext.tsx`<br>`src/components/spectra-synthesis/contexts/SynthesisPreviewContext.tsx`<br>`src/components/spectra-synthesis/ExportDialog.tsx` |
| Settings (`/settings`) | App/system/workspace configuration center | `GET /workspace`<br>`GET/PUT /workspace/settings`<br>`GET /workspace/stats`<br>`POST /workspace/clean-cache`<br>`GET/PUT /workspace/data-defaults`<br>`POST /workspace/create`<br>`POST /workspace/select`<br>`GET /workspace/list`<br>`GET /workspace/recent`<br>`DELETE /workspace/remove`<br>`POST /workspace/export`<br>`POST /workspace/import`<br>`GET/POST/DELETE /app/config-path`<br>`GET /system/info`<br>`GET /system/capabilities`<br>`GET /health`<br>`GET/DELETE /system/errors`<br>`GET/POST/PUT /updates/*`<br>`GET/POST/DELETE /workspaces*`<br>`POST /workspaces/{id}/activate`<br>`POST /workspaces/{id}/scan`<br>`GET /workspaces/{id}/runs|exports|predictions|templates` | `src/pages/Settings.tsx`<br>`src/context/DeveloperModeContext.tsx`<br>`src/context/UISettingsContext.tsx`<br>`src/components/settings/*` |
| Not Found (`*`) | Fallback route page | None | `src/pages/NotFound.tsx` |

## 2) nirs4all Changes That Require Route/Page Updates

| Library change (target) | Current discrepancy in webapp/api | Required updates |
|---|---|---|
| Legacy format removed | Frontend and backend still model `v1`/`v2`/`parquet_derived`, legacy discovery/migration, and compatibility mapping (`Runs`, `workspace_manager`, converter logic) | Remove v1/parquet branches from `Runs`/`Results` pipeline grouping, simplify run schema to one canonical format, delete legacy migration codepaths, reduce converter fallback mappings to canonical-only |
| Refit phase removed | UI still exposes refit concepts (`RunProgress` websocket `refit_*`, `Results`/types `has_refit`, editor refit config tabs, analysis copy uses refit scoring) | Remove refit request fields, websocket events, and UI state; replace with final-model semantics directly from normal training completion |
| Cache controls removed | UI still toggles/cleans cache (`use_cache` in playground execution, settings cache cleanup actions, cache-related workspace stats wording) | Remove cache flags from request models and forms, remove cache management UI/routes from Settings, and strip cache-specific labels from docs/locales |
| Canonical config only (no backward-compat class/path assumptions) | `pipelineConverter` and node registry keep large legacy class-path compatibility maps and old field structures | Shrink converter to canonical schema only, remove old field fallbacks, regenerate node/operator mapping directly from current library API surface |
| API surface cleaned after refactor | Frontend still carries stale route wrappers not present in backend (`/datasets/detect-files`, `/datasets/{id}/version-status`, `/datasets/{id}/relink`, `/datasets/{id}/export`, `/datasets/{id}/targets`, etc.) | Remove or replace dead wrappers, align Dataset Wizard and Target selection with currently available backend routes, add contract tests for wrapper-to-route parity |
| Analysis navigation should reflect real page coverage | Analysis hub links to routes not registered in router (`/analysis/pca`, `/analysis/comparison`, `/analysis/residuals`) | Either implement these pages + wrappers or remove links and route cards until implemented |

## 3) nirs4all Capabilities Not Yet Exposed in Webapp (Complete-Control Backlog)

### 3.1 Backend/API capabilities with no page-level coverage

| Capability area | nirs4all / backend supports | Current webapp coverage | What to implement |
|---|---|---|---|
| Full multivariate analysis suite | `/analysis/pca`, `/analysis/pca/loadings`, `/analysis/pca/scree`, `/analysis/tsne`, `/analysis/umap`, `/analysis/correlation`, `/analysis/select`, `/analysis/wavelengths`, `/analysis/methods` | Only Transfer + SHAP have pages | Add dedicated analysis pages/wrappers and wire them into `App.tsx` + `Analysis.tsx` |
| Evaluation toolkit | `/evaluation/run`, `/evaluation/confusion`, `/evaluation/residuals`, `/evaluation/crossval`, `/evaluation/report`, metrics/scoring catalogs | No evaluation page/API wrapper | Add `src/api/evaluation.ts`, evaluation UI pages, and model-vs-dataset report workflows |
| AutoML orchestration | `/automl/start`, `/automl/{job}`, `/automl/{job}/results`, `/automl/{job}/trials`, `/automl/jobs`, `/automl/models` | No page/API wrapper | Add AutoML wizard, job tracking screen, trial comparison, and best-model promotion flow |
| Model catalog and lifecycle | `/models`, `/models/{model}/params`, `/models/{model}/instantiate`, `/models/compare`, `/models/trained*` | No dedicated models page | Add model registry page, hyperparameter schema rendering, instantiate/test sandbox, trained-model management |
| Advanced preprocessing service | `/preprocessing/*` (discover, presets, schema, apply, preview, chain optimize) | Not surfaced as first-class UI | Add preprocessing studio page and reuse in Dataset Wizard/Playground |
| Online prediction endpoints | `/predictions/single`, `/predictions/batch`, `/predictions/confidence`, `/predictions/explain`, `/predictions/dataset` | Predictions page is historical workspace browsing only | Add inference page for ad-hoc/sample/batch prediction and confidence/explain requests |
| Synthesis introspection routes | `/synthesis/components`, `/synthesis/validate`, `/synthesis/status` | Synthesis page uses only preview/generate | Add component catalog, config validator, job/status panel |
| Playground analytics extras | `/playground/metrics`, `/playground/metrics/compute`, `/playground/metrics/outliers`, `/playground/metrics/similar` | Current playground uses execute + repetition variance | Add advanced metrics panel and outlier/similarity tooling in playground UI |
| Pipeline lifecycle operations | `/pipelines/import`, `/pipelines/operators/discover`, `/pipelines/operators/{name}`, `/pipelines/{id}/prepare`, `/pipelines/{id}/export` | Only CRUD/presets/clone/samples/count are used | Add import/export and operator introspection workflows in Pipelines/PipelineEditor |
| Run control breadth | `/runs/{id}/pause`, `/runs/{id}/resume`, `/runs/{id}/retry`, `/runs/{id}` delete | UI mostly exposes stop and passive monitoring | Add action controls in Runs and RunProgress with explicit state transitions |

### 3.2 Library-level capabilities not represented in webapp UX

| Library capability | Current coverage | Gap to close for complete control |
|---|---|---|
| Functional API: `run`, `predict`, `explain`, `retrain` | `run` and SHAP-like explain paths partially represented | Add UI/backend workflows for `retrain` and direct `predict` using trained bundles/models |
| Session API: `session()`, `load_session()` | Not represented | Add long-lived session management (reuse loaded models/artifacts across actions) |
| Advanced generator language | Library supports `_log_range_`, `_grid_`, `_zip_`, `_chain_`, `_sample_`, `_cartesian_`, `_mutex_`, `_requires_`, `_depends_on_`, `_exclude_`, presets | Editor currently covers only a subset (mainly OR/range/grid/cartesian + finetune UX) | Extend pipeline editor schema + validation + visual controls for all generator/constraint operators |
| Storage API (`WorkspaceStore`) depth | Webapp consumes high-level run/result/prediction views | Add chain replay/export/query tooling, artifact lifecycle controls, and store maintenance operations |
| CLI workspace capabilities (`init`, `list-runs`, `query-best`, `filter`, `stats`, `list-library`) | Partially mirrored in Settings and Results | Add explicit UI equivalents for query-best/filter/statistics and library listing actions |
| Full operator catalog breadth | Library catalog includes broad sklearn + NIRS + deep models/transforms | UI node definitions remain curated/partially mapped | Add automated sync from library operator metadata and expose category-complete operator palette |

### 3.3 High-impact contract mismatches to resolve first

1. Remove dead frontend routes and wrappers that have no backend implementation (`/datasets/detect-files`, `/datasets/{id}/version-status`, `/datasets/{id}/relink`, etc.).
2. Resolve missing dataset target-management contract (frontend expects `/datasets/{id}/targets*` but backend does not expose it).
3. Align analysis navigation with actual registered routes.
4. Decide and enforce one canonical post-refactor run/result schema (drop legacy/refit/cache fields everywhere).

### 3.4 Suggested implementation order

1. **Contract cleanup pass**: remove dead routes/wrappers and fix target-management contract.
2. **Refactor alignment pass**: remove legacy/refit/cache concepts from types, pages, websocket protocol, and backend request models.
3. **Coverage expansion pass**: add pages/wrappers for Analysis (PCA/etc.), Evaluation, Models, AutoML.
4. **Complete-control pass**: extend Pipeline Editor for full generator constraints + session/retrain workflows + storage/CLI parity features.

