# nirs4all Public API Signatures and Webapp Mapping

Source of truth: `/home/delete/nirs4all/nirs4all/__init__.py` and `/home/delete/nirs4all/nirs4all/api/*` (version 0.6.2).
This document lists public signatures and highlights gaps vs `nirs4all_webapp` services.

## 1) Primary public API (module-level)

- `nirs4all.run(pipeline, dataset, *, name="", session=None, verbose=1, save_artifacts=True, save_charts=True, plots_visible=False, random_state=None, **runner_kwargs) -> RunResult`
  - PipelineSpec: list of steps, dict config, path to YAML/JSON, `PipelineConfigs`, or list of pipelines.
  - DatasetSpec: path, arrays/tuple, dict, `SpectroDataset`, `DatasetConfigs`, or list of datasets.
  - Webapp mapping: should back `runs` and `training` services.
  - Status in webapp: missing; current training uses custom sklearn loops and runs are placeholders.

- `nirs4all.predict(model, data, *, name="prediction_dataset", all_predictions=False, session=None, verbose=0, **runner_kwargs) -> PredictResult`
  - ModelSpec: prediction dict (from RunResult), `.n4a` bundle path, or config path.
  - Webapp mapping: predictions service.
  - Status in webapp: missing; current predictions use joblib and local preprocessing.

- `nirs4all.explain(model, data, *, name="explain_dataset", session=None, verbose=1, plots_visible=True, n_samples=None, explainer_type="auto", **shap_params) -> ExplainResult`
  - SHAP-based explanations with plots.
  - Webapp mapping: analysis bench / explain endpoints.
  - Status in webapp: missing; current explain uses permutation-based importance only.

- `nirs4all.retrain(source, data, *, mode="full", name="retrain_dataset", new_model=None, epochs=None, session=None, verbose=1, save_artifacts=True, **kwargs) -> RunResult`
  - Webapp mapping: retraining workflows.
  - Status in webapp: missing.

- `nirs4all.session(pipeline=None, name="", **runner_kwargs) -> context manager (Session)`
  - Provides a reusable runner across multiple run/predict/explain calls.
  - Status in webapp: missing.

- `nirs4all.load_session(path) -> Session`
  - Loads a `.n4a` bundle and returns a session.
  - Status in webapp: missing.

## 2) Result classes (public)

- `RunResult(predictions, per_dataset, _runner=None)`
  - Properties: `best`, `best_score`, `best_rmse`, `best_r2`, `best_accuracy`, `artifacts_path`, `num_predictions`.
  - Methods: `top(n=5, **kwargs)`, `export(path)`, `filter(**kwargs)`, `get_datasets()`, `get_models()`.

- `PredictResult(y_pred, metadata={}, sample_indices=None, model_name="", preprocessing_steps=[])`
  - Methods: `to_numpy()`, `to_list()`, `to_dataframe(include_indices=True)`, `flatten()`.

- `ExplainResult(shap_values, feature_names=None, base_value=None, visualizations={}, explainer_type="auto", model_name="", n_samples=0)`
  - Properties: `values`, `shape`, `mean_abs_shap`, `top_features`.
  - Methods: `get_feature_importance(top_n=None, normalize=False)`, `get_sample_explanation(idx)`, `to_dataframe(include_feature_names=True)`.

## 3) Synthetic data generation namespace (public)

- `nirs4all.generate(n_samples=1000, *, random_state=None, complexity="simple", wavelength_range=None, components=None, target_range=None, train_ratio=0.8, as_dataset=True, name="synthetic_nirs", **kwargs) -> SpectroDataset | (X, y)`
- `nirs4all.generate.regression(n_samples=1000, *, random_state=None, complexity="simple", target_range=None, target_component=None, distribution="dirichlet", train_ratio=0.8, as_dataset=True, name="synthetic_regression")`
- `nirs4all.generate.classification(n_samples=1000, *, n_classes=2, random_state=None, complexity="simple", class_separation=1.0, class_weights=None, train_ratio=0.8, as_dataset=True, name="synthetic_classification")`
- `nirs4all.generate.builder(n_samples=1000, random_state=None, name="synthetic_nirs")`
- `nirs4all.generate.multi_source(n_samples=1000, sources=None, *, random_state=None, target_range=None, train_ratio=0.8, as_dataset=True, name="multi_source_synthetic")`
- `nirs4all.generate.to_folder(path, n_samples=1000, *, random_state=None, complexity="simple", train_ratio=0.8, format="standard", wavelength_range=None, components=None, target_range=None)`
- `nirs4all.generate.to_csv(path, n_samples=1000, *, random_state=None, complexity="simple", wavelength_range=None, target_range=None)`
- `nirs4all.generate.from_template(template, n_samples=1000, *, random_state=None, wavelengths=None, as_dataset=True)`

Webapp mapping: playground demo data, dataset generation, quick-start samples. Status in webapp: missing; playground uses ad-hoc random data instead of `generate`.

## 4) Advanced public exports

- `nirs4all.PipelineRunner(**runner_kwargs)`
- `nirs4all.PipelineConfigs(definition, name="", description="No description provided", max_generation_count=10000)`
- `nirs4all.register_controller(controller)` / `nirs4all.CONTROLLER_REGISTRY`
- `nirs4all.is_tensorflow_available()` / `nirs4all.is_gpu_available()` / `nirs4all.framework()`

## 5) Webapp references to moved or non-public APIs (needs updates)

These imports are used in `nirs4all_webapp` but are no longer valid after the refactor:

- `nirs4all.data.dataset_config.DatasetConfigs` -> moved to `nirs4all.data.DatasetConfigs` (source: `nirs4all/data/config.py`).
- `nirs4all.data.dataset_config_parser.parse_config` -> moved to `nirs4all.data.config_parser.parse_config`.
- `nirs4all.data.loader.handle_data` -> moved to `nirs4all.data.loaders.loader.handle_data`.

Other imports still valid but are internal (not part of the recommended public API):
- `nirs4all.data.dataset.SpectroDataset`
- `nirs4all.operators.transforms`, `nirs4all.operators.splitters`, `nirs4all.operators.models`
- `nirs4all.controllers.CONTROLLER_REGISTRY`

## 6) Missing API usage in webapp services

- `run`, `predict`, `explain`, `retrain`, `session`, `load_session`, and `generate` are not used anywhere in the backend or frontend.
- Webapp training/prediction flows rely on joblib + custom sklearn loops, which bypass the new `.n4a` bundle and `RunResult`/`PredictResult` objects.
- No service consumes `RunResult.export()` or `load_session()` for model persistence.
- Playground and analysis views do not use `generate` or `explain`.

