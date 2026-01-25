# API Cleaning: Comprehensive Redundancy Analysis

This document enumerates all webapp API functions that reimplement nirs4all library functionality and should be refactored or removed.

**Priority Legend**:
- **REMOVE** - Delete entirely, use nirs4all directly
- **REFACTOR** - Modify to delegate to nirs4all
- **KEEP** - Webapp-specific, no redundancy

---

## Summary Statistics

| Category | Files | Redundant Functions | Estimated Lines |
|----------|-------|---------------------|-----------------|
| Core Training/Prediction | 4 | 18 | ~800 |
| Metrics/Evaluation | 2 | 10 | ~400 |
| Shared Utilities | 3 | 15 | ~600 |
| Dataset/Spectra | 2 | 8 | ~350 |
| Models/SHAP | 2 | 10 | ~400 |
| Other (dashboard, system) | 2 | 5 | ~150 |
| **Total** | **15** | **~66** | **~2700** |

---

## 1. datasets.py

| Function | Action | nirs4all Counterpart |
|----------|--------|---------------------|
| `_basic_file_detection()` | REMOVE | `FolderParser._pattern_matches()` |
| `/detect-files` route | REMOVE | Use only `/detect-unified` with `FolderParser` |
| CSV delimiter detection | REFACTOR | `AutoDetector._detect_delimiter()` |
| `compute_dataset_hash()` | REFACTOR | `nirs4all.pipeline.storage.artifacts.compute_content_hash()` |
| Signal type detection fallbacks | REFACTOR | `detect_signal_type()` - remove fallbacks |
| Split methods | KEEP | Uses nirs4all splitters correctly |
| `/generate-synthetic` | KEEP | Uses `SyntheticDatasetBuilder` correctly |

---

## 2. pipelines.py

| Function | Action | nirs4all Counterpart |
|----------|--------|---------------------|
| `_convert_frontend_steps_to_nirs4all()` | REFACTOR | `PipelineConfigs(steps)` constructor |
| `_validate_pipeline_impl()` | REMOVE | `nirs4all.pipeline.config.generator.validate_spec()` |
| `_list_operators_impl()` hardcoded lists | REMOVE | Use `CONTROLLER_REGISTRY` or discover endpoint |
| `_count_variants_impl()` | REFACTOR | `count_combinations()` - simplify wrapper |
| `get_pipeline_presets()` | REFACTOR | Import from `nirs4all.pipeline.config.generator.presets` |
| `_discover_*_operators()` | KEEP | UI-specific introspection |
| `_run_pipeline_task()` | KEEP | Uses `nirs4all.run()` correctly |

---

## 3. predictions.py

| Function | Action | nirs4all Counterpart |
|----------|--------|---------------------|
| `_load_model()` | REMOVE | `BundleLoader`, `NIRSPipeline.from_bundle()` |
| `predict_single()` | REMOVE | `nirs4all.predict(model, data)` |
| `predict_batch()` | REMOVE | `nirs4all.predict(model, data)` handles batches |
| `predict_dataset()` | REMOVE | `nirs4all.predict(model, dataset_path)` |
| `explain_prediction()` | REMOVE | `nirs4all.explain(model, data)` |
| `_permutation_importance_single()` | REMOVE | `ShapAnalyzer.get_feature_importance()` |
| `_gradient_importance()` | REMOVE | `ShapAnalyzer` |
| `predict_with_confidence()` | KEEP | Unique feature (bootstrap/jackknife) |
| CRUD routes | KEEP | Webapp-specific persistence |

---

## 4. runs.py

| Function | Action | nirs4all Counterpart |
|----------|--------|---------------------|
| `_execute_sklearn_training()` | REMOVE | `nirs4all.run()` handles sklearn |
| Model export via joblib | REMOVE | `RunResult.export(path)` |
| `_build_simple_pipeline()` | REFACTOR | `build_full_pipeline()` from adapter |
| `_estimate_pipeline_variants()` | REFACTOR | Use `build_full_pipeline().estimated_variants` |
| Metrics extraction | REFACTOR | Use `result.best`, `.best_rmse`, `.best_r2` |
| `_sanitize_float/_metrics()` | KEEP | JSON serialization |

---

## 5. training.py

| Function | Action | nirs4all Counterpart |
|----------|--------|---------------------|
| `_compute_metrics()` | REMOVE | `nirs4all.core.metrics.eval_multi()` |
| `_run_training_task()` (~100 lines) | REMOVE | Replace with `nirs4all.run()` |
| `/training/resume` | REMOVE | `nirs4all.retrain()` |
| Train/val split logic | REMOVE | Let `nirs4all.run()` handle CV |
| `_save_trained_model()` | REFACTOR | `result.export("path.n4a")` |
| Preprocessing application | REMOVE | Automatic in `nirs4all.run()` |
| `_get_model_instance()` | REFACTOR | Use `nirs4all_adapter._resolve_operator_class()` |

---

## 6. evaluation.py

| Function | Action | nirs4all Counterpart |
|----------|--------|---------------------|
| `_detect_task_type()` | REMOVE | `nirs4all.core.task_detection.detect_task_type()` |
| `_compute_regression_metrics()` | REMOVE | `nirs4all.core.metrics.eval_multi(y, y_pred, 'regression')` |
| `_compute_classification_metrics()` | REMOVE | `nirs4all.core.metrics.eval_multi(y, y_pred, 'classification')` |
| `POST /evaluation/run` | REFACTOR | Use `nirs4all.predict()` + `eval_multi()` |
| `POST /evaluation/metrics` | REMOVE | `nirs4all.core.metrics.eval_multi()` |
| `POST /evaluation/crossval` | REFACTOR | Use `nirs4all.run()` for CV |
| `POST /evaluation/report` | REFACTOR | `TabReportManager` |
| `GET /metrics/available` | REMOVE | `nirs4all.core.metrics.get_available_metrics()` |
| `POST /evaluation/confusion` | KEEP | Thin sklearn wrapper |
| `POST /evaluation/residuals` | KEEP | Webapp-specific analysis |

---

## 7. synthesis.py

| Function | Action | nirs4all Counterpart |
|----------|--------|---------------------|
| `/components` (hardcoded 14 items) | REMOVE | `available_components()` returns 126+ components |
| `build_from_config()` | KEEP | Legitimate adapter |
| `/validate` | KEEP | Webapp pre-validation |
| `/preview` statistics | KEEP | Simple numpy, different purpose |

---

## 8. preprocessing.py

| Function | Action | nirs4all Counterpart |
|----------|--------|---------------------|
| `PREPROCESSING_METHODS` static registry | REMOVE | Use dynamic introspection only |
| `/preprocessing/presets` | REFACTOR | Import from `nirs4all.operators.transforms.presets` |
| `_get_transformer_class()` | KEEP | Valid adapter |
| `_categorize_method()` | KEEP | UI presentation |
| `/chain/optimize` | KEEP | Webapp-specific analysis |

---

## 9. shap.py

| Function | Action | nirs4all Counterpart |
|----------|--------|---------------------|
| `compute_shap_explanation()` | REMOVE | `nirs4all.explain(model, data)` |
| `_process_shap_results()` | REMOVE | `ExplainResult.mean_abs_shap`, `get_feature_importance()` |
| Binned aggregation | REFACTOR | `ShapAnalyzer._aggregate_shap_bins()` |
| `_load_model()` | REMOVE | `NIRSPipeline.from_bundle()` |
| `get_shap_config()` | KEEP | Webapp-specific |

---

## 10. spectra.py

| Function | Action | nirs4all Counterpart |
|----------|--------|---------------------|
| Folder scanning in `_build_nirs4all_config_from_stored()` | REFACTOR | `FolderParser.scan_folder()` |
| Delimiter detection | REFACTOR | `AutoDetector._detect_delimiter()` |
| `POST /outliers` (outlier detection) | REMOVE | `XOutlierFilter` supports all methods (isolation_forest, lof, mahalanobis, pca_leverage, pca_residual) |
| `_apply_preprocessing_chain()` transformer map | REFACTOR | Use nirs4all controller registry |
| `_load_dataset()` | KEEP | Proper orchestration |
| `GET /stats` | KEEP | Simple numpy stats |

---

## 11. analysis.py

| Function | Action | nirs4all Counterpart |
|----------|--------|---------------------|
| `feature_importance()` | REFACTOR | `nirs4all.explain()` / `ShapAnalyzer.get_feature_importance()` |
| `select_features()` | REFACTOR | Consider `CARS` / `MCUVE` operators |
| `compute_pca()` | KEEP | Direct sklearn, different purpose |
| `compute_tsne()`, `compute_umap()` | KEEP | Not in nirs4all |
| `correlation_matrix()` | KEEP | Not in nirs4all |

---

## 12. models.py

| Function | Action | nirs4all Counterpart |
|----------|--------|---------------------|
| `list_trained_models()` | REFACTOR | List `.n4a` bundles from workspace exports, not `.joblib` |
| `get_trained_model()` | REMOVE | `BundleLoader` |
| `get_model_summary()` | REMOVE | `BundleLoader.metadata`, `get_step_info()` |
| `load_model()` | REMOVE | `nirs4all.predict()` handles loading |
| `compare_models()` | REFACTOR | Use `nirs4all.predict()` with `.n4a` bundles |
| `get_loaded_model()` | REMOVE | `BundleLoader` caches internally |
| `_get_model_summary()` | REMOVE | `BundleLoader.metadata` |
| `SKLEARN_MODELS` dict | KEEP | UI metadata |
| `_extract_params_from_class()` | KEEP | UI introspection |

**Note**: Root issue is webapp uses raw `.joblib` files instead of `.n4a` bundles.

---

## 13. automl.py

| Function | Action | nirs4all Counterpart |
|----------|--------|---------------------|
| `_sample_params()` | REMOVE | Use `_range_` and `_or_` pipeline generators |
| `_get_sklearn_scorer()` | REMOVE | Library handles scorer conversion |
| `_run_automl_task()` | REFACTOR | Construct generator pipelines for `nirs4all.run()` |
| `_save_automl_model()` | REFACTOR | `RunResult.export("path.n4a")` |
| `_get_model_instance()` | REFACTOR | `nirs4all.operators.models.*` |
| Search space defaults | KEEP | Webapp defaults |
| Job management | KEEP | Webapp infrastructure |

---

## 14. transfer.py

| Function | Action | nirs4all Counterpart |
|----------|--------|---------------------|
| `compute_transfer_analysis()` | KEEP | Properly uses `PreprocPCAEvaluator` |
| `GET /presets` | KEEP | Properly uses `nirs4all.analysis.presets` |
| `GET /preprocessing-options` (hardcoded) | REFACTOR | Could introspect nirs4all operators |
| `_build_preprocessing_function()` fallbacks | REMOVE | Remove fallback implementations |
| `_load_dataset_data()` | KEEP | Proper delegation |

---

## 15. playground.py

| Function | Action | nirs4all Counterpart |
|----------|--------|---------------------|
| `_execute_filter()` | REFACTOR | Use `nirs4all.operators.filters.*` |
| `_compute_metrics()` | REFACTOR | Use filter stats from `XOutlierFilter.get_filter_stats()` |
| `POST /metrics/outliers` | REMOVE | `XOutlierFilter(method=...)` |
| `POST /metrics/compute` | REFACTOR | Delegate to nirs4all filters |
| `GET /metrics` | REFACTOR | Expose metrics from nirs4all filters |
| `_execute_preprocessing()` | KEEP | Uses `shared.pipeline_service` correctly |
| `_execute_splitter()` | KEEP | Uses library splitters |
| `_compute_pca()`, `_compute_umap()` | KEEP | Webapp visualization |
| `POST /diff/compute` | KEEP | Webapp-specific |
| `POST /metrics/similar` | KEEP | Webapp-specific |

---

## 16. dashboard.py

| Function | Action | nirs4all Counterpart |
|----------|--------|---------------------|
| `_count_runs()` | REFACTOR | `ManifestManager.list_runs()` |
| `_get_avg_metric()` | REFACTOR | `ManifestManager.load_manifest()` for metrics |
| `_get_recent_runs()` | REFACTOR | `ManifestManager.list_runs()` + `list_all_pipelines()` |
| `_count_pipelines()` | KEEP | Webapp-specific path handling |
| `_calculate_trends()` | KEEP | UI feature (stub) |

---

## 17. shared/filter_operators.py (CRITICAL)

**This file almost entirely reimplements `nirs4all.operators.filters.*`**

| Class | Action | nirs4all Counterpart |
|-------|--------|---------------------|
| `BaseFilter` | REMOVE | `SampleFilter` base class |
| `OutlierFilter` | REMOVE | `XOutlierFilter` (mahalanobis, pca_residual, pca_leverage, isolation_forest, lof) |
| `RangeFilter` | REMOVE | `YOutlierFilter(method="percentile")` |
| `MetadataFilter` | REMOVE | `MetadataFilter` |
| `QCFilter` | REMOVE | `SpectralQualityFilter` |
| `DistanceFilter` | REMOVE | `XOutlierFilter(method="mahalanobis")` / `HighLeverageFilter` |
| `get_filter_methods()` | REFACTOR | Introspect nirs4all filters dynamically |
| `instantiate_filter()` | REMOVE | Use nirs4all filters directly |
| `SampleIndexFilter` | KEEP | UI-specific for "Filter to Selection" |

---

## 18. shared/metrics_computer.py (CRITICAL)

| Method | Action | nirs4all Counterpart |
|--------|--------|---------------------|
| Hotelling T2 computation | REMOVE | `XOutlierFilter(method="pca_leverage")` |
| Q-residual computation | REMOVE | `XOutlierFilter(method="pca_residual")` |
| Leverage computation | REMOVE | `HighLeverageFilter` |
| Distance to centroid | REMOVE | `XOutlierFilter(method="mahalanobis")` |
| LOF score | REMOVE | `XOutlierFilter(method="lof")` |
| NaN/Inf/saturation counts | REMOVE | `SpectralQualityFilter` |
| `get_outlier_mask()` | REMOVE | Use filter's `get_mask()` |
| `compute_repetition_variance()` | REFACTOR | `nirs4all.operators.data.repetition` |
| `get_similar_samples()` | KEEP | UI-specific similarity search |
| `get_available_metrics()` | KEEP | UI metadata |

**Note**: `MetricsComputer` computes per-sample values for UI visualization. Core computation should move to nirs4all as a general spectral metrics module.

---

## 19. shared/pipeline_service.py

| Function | Action | nirs4all Counterpart |
|----------|--------|---------------------|
| `PREPROCESSING_CLASS_MAP` (hardcoded) | REFACTOR | Use nirs4all introspection |
| `SPLITTER_CLASS_MAP` (hardcoded) | REFACTOR | Use nirs4all introspection |
| `resolve_operator()` | REFACTOR | Use nirs4all controller registry |
| `validate_step_params()` | REFACTOR | Use `nirs4all.config.validator` |
| `convert_frontend_step()` | KEEP | Webapp format translation |
| `get_preprocessing_methods()` | KEEP | UI metadata (but reduce hardcoding) |
| `get_splitter_methods()` | KEEP | UI metadata (but reduce hardcoding) |
| `_extract_method_info()` | KEEP | UI introspection |

---

## 20. nirs4all_adapter.py

| Function | Action | nirs4all Counterpart |
|----------|--------|---------------------|
| `_normalize_params()` | REFACTOR | Delegate to `ConfigNormalizer` |
| `_resolve_operator_class()` | REFACTOR | Use nirs4all operator registry |
| `extract_metrics_from_prediction()` | REFACTOR | Use `RunResult`/`PredictResult` properties |
| `extract_fold_count()` | REMOVE | Use nirs4all pipeline introspection |
| `extract_branch_count()` | REMOVE | Use `count_combinations()` |
| `export_pipeline_to_python()` | REFACTOR | Move code generation to nirs4all |
| `_build_simple_fallback()` | REMOVE | Don't guess defaults |
| `build_pipeline_steps()` | KEEP | Format conversion |
| `expand_pipeline_variants()` | KEEP | Uses `expand_spec_with_choices` correctly |
| `_build_*_generator()` functions | KEEP | Format conversion |

---

## 21. workspace.py / workspace_manager.py

| Function | Action | nirs4all Counterpart |
|----------|--------|---------------------|
| `DatasetRegistry` class | REFACTOR | Use nirs4all data infrastructure |
| `RunManager` class | REFACTOR | Should be in nirs4all |
| `activate_workspace()` | REFACTOR | Call `nirs4all.workspace.set_active_workspace()` |
| Dataset introspection in `/datasets/link` | REFACTOR | Use `DatasetConfigs` |
| `/workspace/create` directory creation | REFACTOR | Use nirs4all workspace API |
| `WorkspaceScanner` | KEEP | UI discovery |
| `SchemaMigrator` | KEEP | Legacy format handling |
| Custom nodes management | KEEP | Webapp UI feature |
| `/workspace/export` | KEEP | Webapp portability |
| `/workspace/stats` | KEEP | UI statistics |

---

## 22. system.py

| Function | Action | nirs4all Counterpart |
|----------|--------|---------------------|
| `_get_gpu_info()` | REFACTOR | `nirs4all.utils.backend.get_gpu_info()` |
| `/system/capabilities` | REFACTOR | `nirs4all.utils.backend.is_available()`, `is_gpu_available()` |
| Error log functions | KEEP | Webapp debugging |
| `/health`, `/system/info` | KEEP | Webapp endpoints |
| `/system/paths` | KEEP | Webapp path management |

---

## Files with NO redundancy (KEEP all)

| File | Reason |
|------|--------|
| `jobs/__init__.py`, `jobs/manager.py` | Webapp job queue infrastructure |
| `app_config.py` | Webapp UI state and preferences |
| `updates.py` | Webapp self-update mechanism |
| `update_downloader.py` | Webapp download utilities |
| `venv_manager.py` | Webapp venv isolation |

---

## Priority Implementation Order

### Phase 1: Critical Removals (~1200 lines)

1. **shared/filter_operators.py** - Delete 6 filter classes, use `nirs4all.operators.filters.*`
2. **training.py** - Replace `_run_training_task()` with `nirs4all.run()`
3. **predictions.py** - Replace `predict_*()` with `nirs4all.predict()`
4. **evaluation.py** - Replace metrics functions with `nirs4all.core.metrics.*`

### Phase 2: Major Refactors (~800 lines)

1. **shared/metrics_computer.py** - Delegate to nirs4all filters for metric computation
2. **models.py** - Switch from `.joblib` to `.n4a` bundles with `BundleLoader`
3. **shap.py** - Replace with `nirs4all.explain()`
4. **automl.py** - Use pipeline generators instead of random search

### Phase 3: Minor Cleanups (~700 lines)

1. **datasets.py** - Remove file detection duplicates
2. **spectra.py** - Remove outlier detection duplicate
3. **pipelines.py** - Remove hardcoded operator lists
4. **synthesis.py** - Use `available_components()`
5. **preprocessing.py** - Remove static registry
6. **dashboard.py** - Use `ManifestManager`
7. **nirs4all_adapter.py** - Simplify parameter handling
8. **system.py** - Use nirs4all backend utilities

---

## Key Architectural Changes

1. **Model format**: Migrate from raw `.joblib` to `.n4a` bundles throughout
2. **Filtering**: Delete `shared/filter_operators.py`, use `nirs4all.operators.filters.*`
3. **Metrics**: Delete custom metric computation, use `nirs4all.core.metrics.eval_multi()`
4. **Training**: Delete manual training loops, use `nirs4all.run()`
5. **Prediction**: Delete manual prediction, use `nirs4all.predict()`
6. **SHAP**: Delete custom SHAP, use `nirs4all.explain()`
