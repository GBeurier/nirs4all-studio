# Webapp Services Inventory and Gaps

Scope: service coverage for workspace, datasets, playground, pipeline editor, predictions, runs, and analysis bench. Sources are `/home/delete/nirs_ui_workspace/nirs4all_webapp/api/*` and `src/pages/*`.

## Workspace

Existing backend services
- `/home/delete/nirs_ui_workspace/nirs4all_webapp/api/workspace.py`
  - `GET /api/workspace` current workspace + linked datasets
  - `POST /api/workspace/select` select workspace
  - `POST /api/workspace/create` create workspace
  - `GET /api/workspace/list`, `GET /api/workspace/recent`
  - `GET /api/workspace/paths`, `GET /api/workspace/{workspace_id}`, `PUT /api/workspace/{workspace_id}`
  - `POST /api/workspace/export`, `DELETE /api/workspace/remove`
  - Groups management (`/workspace/groups`, `/workspace/groups/{id}` and dataset assignment)
  - Dataset linking via `/datasets/link`, unlink via `/datasets/{dataset_id}`, refresh via `/datasets/{dataset_id}/refresh`
- `/home/delete/nirs_ui_workspace/nirs4all_webapp/api/workspace_manager.py` handles persistence and metadata

Frontend integration
- `/home/delete/nirs_ui_workspace/nirs4all_webapp/src/api/client.ts` uses workspace endpoints
- `/home/delete/nirs_ui_workspace/nirs4all_webapp/src/pages/Datasets.tsx` wires workspace selection + groups

Missing or gaps
- No workspace-level indexing of runs, predictions, or `.n4a` artifacts; results are not linked back to workspace metadata.
- Dataset link/refresh flows still depend on legacy nirs4all loader imports (see public API doc).

## Datasets

Existing backend services
- `/home/delete/nirs_ui_workspace/nirs4all_webapp/api/datasets.py`
  - `GET /api/datasets`, `GET /api/datasets/{dataset_id}`
  - `POST /api/datasets/{dataset_id}/load`
  - `GET /api/datasets/{dataset_id}/stats`
  - `POST /api/datasets/{dataset_id}/split`
  - `POST /api/datasets/{dataset_id}/filter`
  - `POST /api/datasets/merge`
  - `POST /api/datasets/{dataset_id}/export`
  - `DELETE /api/datasets/{dataset_id}`
- `/home/delete/nirs_ui_workspace/nirs4all_webapp/api/spectra.py`
  - `GET /api/spectra/{dataset_id}` raw spectra
  - `GET /api/spectra/{dataset_id}/{sample_index}`
  - `POST /api/spectra/{dataset_id}/processed` preprocessing preview
  - `GET /api/spectra/{dataset_id}/stats`
  - `POST /api/spectra/{dataset_id}/outliers`
- `/home/delete/nirs_ui_workspace/nirs4all_webapp/api/preprocessing.py`
  - method discovery, apply/preview/validate, presets, chain optimization

Frontend integration
- `/home/delete/nirs_ui_workspace/nirs4all_webapp/src/pages/Datasets.tsx` uses dataset list/link/update/refresh
- No UI integration for spectra preview, preprocessing preview, split/filter/merge, or export endpoints

Missing or gaps
- No dataset upload API (UI uses file dialog to select local path, but not upload).
- No dataset preview/visualization flow in UI using `/spectra/*` endpoints.
- Dataset split/filter/merge are backend-only with no UI wiring.

## Playground

Existing
- Frontend-only processing: `/home/delete/nirs_ui_workspace/nirs4all_webapp/src/hooks/useSpectralData.ts` and `/home/delete/nirs_ui_workspace/nirs4all_webapp/src/hooks/usePipeline.ts` (local CSV parsing + in-browser transforms).
- Backend has preprocessing and spectra endpoints that could support server-side processing, but they are not used by Playground.

Missing or gaps
- No backend services for playground data sources (nirs4all `generate`, dataset selection, or workspace data).
- No persistence of playground pipelines or results.
- No server-side execution for large datasets or consistent operator parity with nirs4all.

## Pipeline Editor

Existing backend services
- `/home/delete/nirs_ui_workspace/nirs4all_webapp/api/pipelines.py`
  - CRUD (`GET/POST/PUT/DELETE /api/pipelines`, clone)
  - Operator discovery (`/api/pipelines/operators`, `/api/pipelines/operators/discover`, `/api/pipelines/operators/{name}`)
  - Validation (`POST /api/pipelines/validate`)
  - Execution preparation (`POST /api/pipelines/{pipeline_id}/prepare`)
  - Presets (`GET /api/pipelines/presets`, `POST /api/pipelines/from-preset/{preset_id}`)

Frontend integration
- `/home/delete/nirs_ui_workspace/nirs4all_webapp/src/pages/Pipelines.tsx` uses list/CRUD via hooks
- `/home/delete/nirs_ui_workspace/nirs4all_webapp/src/pages/PipelineEditor.tsx` uses local demo data only (no API)

Missing or gaps
- Pipeline editor does not load/save pipeline definitions to the backend.
- Operator discovery metadata is not surfaced in editor (schemas, param defaults, validation).
- No actual execution integration with `nirs4all.run`; `/prepare` is informational only.

## Predictions

Existing backend services
- `/home/delete/nirs_ui_workspace/nirs4all_webapp/api/predictions.py`
  - CRUD (`GET/POST/DELETE /api/predictions`, stats, export)
  - Execution (`/api/predictions/single`, `/batch`, `/dataset`, `/confidence`, `/explain`)
  - Uses joblib models and local preprocessing chains

Frontend integration
- `/home/delete/nirs_ui_workspace/nirs4all_webapp/src/pages/Predictions.tsx` is static placeholder (no API)

Missing or gaps
- No integration with `nirs4all.predict` / `.n4a` bundles.
- Explanation endpoint is permutation-based, not SHAP (`nirs4all.explain`).
- No UI for prediction browsing, filtering, or export.

## Runs

Existing backend services
- `/home/delete/nirs_ui_workspace/nirs4all_webapp/api/runs.py` (in-memory placeholder; no real execution)
- `/home/delete/nirs_ui_workspace/nirs4all_webapp/api/training.py` (background training loop, sklearn-like)
- `/home/delete/nirs_ui_workspace/nirs4all_webapp/api/automl.py` (job-based search, sklearn-like)

Frontend integration
- `/home/delete/nirs_ui_workspace/nirs4all_webapp/src/pages/Runs.tsx` uses mock data
- `/home/delete/nirs_ui_workspace/nirs4all_webapp/src/pages/NewExperiment.tsx` uses mock datasets/pipelines

Missing or gaps
- No run orchestration using `nirs4all.run` across pipeline x dataset cartesian product.
- No persistence of run history or linkage to workspace results.
- No progress updates wired to WebSocket channels for runs.

## Analysis Bench

Existing backend services
- `/home/delete/nirs_ui_workspace/nirs4all_webapp/api/analysis.py`
  - PCA, t-SNE, UMAP, importance, correlation, feature selection, wavelengths
- `/home/delete/nirs_ui_workspace/nirs4all_webapp/api/evaluation.py`
  - metrics, confusion matrix, residuals, cross-validation, reports

Frontend integration
- `/home/delete/nirs_ui_workspace/nirs4all_webapp/src/pages/Analysis.tsx` is static UI (no API)

Missing or gaps
- No UI wiring to analysis/evaluation endpoints.
- No integration with `nirs4all.explain` (SHAP) or run artifacts.
- Analysis outputs are not stored or linked to runs/predictions.

