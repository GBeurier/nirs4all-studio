# Roadmap: Integrate new nirs4all API and update webapp services

Goal: replace legacy/manual training/prediction flows with the new nirs4all public API (`run`, `predict`, `explain`, `retrain`, `session`, `generate`) and wire the frontend to real services.

## Phase 0: Contract alignment and decisions

- Confirm target nirs4all version and entrypoints (assumed 0.6.2).
- Define data contracts:
  - Pipeline JSON (webapp) -> nirs4all PipelineSpec (list of steps or `PipelineConfigs`).
  - Dataset references (workspace IDs) -> DatasetSpec (`DatasetConfigs` or path).
  - Run results -> `RunResult` and persisted artifacts.
- Decide on model artifact format (`.n4a` bundles vs joblib).
- Replace broken imports in backend (`DatasetConfigs`, `parse_config`, `handle_data`).

Deliverable: signed-off contracts and adapter plan.

## Phase 1: Core adapters and dataset loading

- Build adapters:
  - Convert pipeline steps (`{type, name, params}`) into nirs4all pipeline step objects.
  - Convert dataset IDs into `DatasetConfigs` using workspace paths.
- Update dataset-related services to use `nirs4all.data.DatasetConfigs` and new loader paths.
  - `api/workspace_manager.py`
  - `api/datasets.py`
  - `api/spectra.py`
- Establish unified cache lifecycle for loaded datasets.

Deliverable: dataset services run against refactored nirs4all without import errors.

## Phase 2: Runs and training orchestration

- Replace `api/training.py` internal loops with `nirs4all.run` (single pipeline + dataset).
- Replace `api/runs.py` placeholder with real orchestration:
  - Cartesian product of pipelines x datasets using `nirs4all.run`.
  - Persist run metadata and metrics to workspace.
  - Link run outputs to predictions and artifacts.
- Introduce `nirs4all.session` for shared runner reuse per job.
- Emit WebSocket updates for run progress (job manager already exists).

Deliverable: runs created from UI execute real pipelines and persist results.

## Phase 3: Predictions, explain, and retrain

- Update `api/predictions.py` to use `nirs4all.predict` with `.n4a` bundles or RunResult prediction dicts.
- Add support for `nirs4all.explain` in prediction explanations (SHAP-based).
- Add `retrain` endpoint powered by `nirs4all.retrain`.
- Store prediction records and artifacts in workspace paths.

Deliverable: prediction workflows use the public API and support explainability.

## Phase 4: Pipeline editor integration

- Wire Pipeline Editor to:
  - Operator discovery (`/pipelines/operators`)
  - Validation (`/pipelines/validate`)
  - Save/update (`/pipelines` CRUD)
- Ensure operator schemas are surfaced in UI to edit parameters reliably.
- Normalize pipeline JSON to a canonical format aligned with the adapter.

Deliverable: editor saves real pipelines that can be executed by `run`.

## Phase 5: Playground and synthetic data

- Add endpoints to generate demo datasets via `nirs4all.generate` (regression/classification/multi-source).
- Optionally add server-side preprocessing preview using `preprocessing` services.
- Allow saving playground pipelines into the pipeline library.

Deliverable: playground uses nirs4all-native data and operators.

## Phase 6: Analysis bench wiring

- Wire UI to analysis endpoints and link to run outputs.
- Add SHAP visualization entry points using `nirs4all.explain` results.
- Persist analysis artifacts (plots/exports) under workspace.

Deliverable: analysis bench uses real run/prediction data.

## Phase 7: QA, migration, and docs

- Add unit tests for pipeline adapter and dataset loader integration.
- Add integration tests for run/predict/explain flows.
- Provide a migration script for existing pipelines/predictions if needed.
- Update developer docs and user guides.

Deliverable: stable API integration with documented workflows.

## Decision proposals (pick one)

1) Full migration to public API only
   - Replace joblib and custom loops with `run/predict/explain/retrain` exclusively.
   - Rationale: lowest long-term maintenance, aligns with refactored library, consistent artifacts (`.n4a`).

2) Hybrid compatibility layer
   - Keep legacy joblib flows while adding new API paths; support both `.joblib` and `.n4a`.
   - Rationale: minimizes disruption for existing workspaces, but increases complexity and testing surface.

3) Versioned API rollout
   - Introduce `/api/v2` endpoints backed by new API; migrate UI page-by-page.
   - Rationale: safest for incremental rollout, but requires duplicate endpoints and dual contracts.

