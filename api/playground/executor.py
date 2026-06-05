"""Playground pipeline executor.

:class:`PlaygroundExecutor` orchestrates a real-time pipeline preview: it
samples the working set, runs each step through the per-step executors in
:mod:`api.playground.steps`, caches intermediate prefixes, and assembles the
chart payloads from :mod:`api.playground.charts` into an
:class:`~api.playground.models.ExecuteResponse`.

The numerical work lives in ``steps`` (per-step transforms) and ``charts``
(stats / PCA / UMAP / repetitions / metrics); this module owns only the
array bookkeeping and response shaping.
"""

from __future__ import annotations

import importlib.util
import time
from typing import Any

from ..shared.decimation import decimate_wavelengths
from . import charts as _charts
from . import steps as _steps
from .cache import (
    _step_cache,
    compute_data_fingerprint,
    compute_prefix_key,
)
from .models import (
    ExecuteResponse,
    PlaygroundData,
    PlaygroundStep,
    SamplingOptions,
    StepTrace,
)

UMAP_AVAILABLE = importlib.util.find_spec("umap") is not None


class PlaygroundExecutor:
    """Lightweight executor for playground pipeline preview.

    Uses nirs4all operators directly (fit_transform) without full StepRunner
    infrastructure to minimize overhead for real-time preview.

    Features:
    - Transforms spectral data using nirs4all preprocessing operators
    - Applies splitters to generate fold assignments
    - Computes statistics and PCA for visualization
    - Tracks execution time per step

    Important Notes:
    - Splitters are executed on the SAMPLED data subset, not the full dataset.
      This means fold indices in the response refer to positions within the
      sampled subset. The `sample_indices` field in the response can be used
      to map back to original data positions if needed.
    - For accurate fold visualization on full datasets, consider using
      sampling.method='all' or increasing n_samples to cover the full dataset.
    """

    def __init__(self, verbose: int = 0):
        self.verbose = verbose

    def execute(
        self,
        data: PlaygroundData,
        steps: list[PlaygroundStep] | None = None,
        sampling: SamplingOptions | None = None,
        options: dict[str, Any] | None = None,
        *,
        X_np=None,
        y_np=None,
        wavelengths_np: list[float] | None = None,
        metadata_np: dict[str, Any] | None = None,
        header_unit: str | None = None,
    ) -> ExecuteResponse:
        """Execute pipeline on data.

        Args:
            data: Input spectral data (used when X_np is not provided)
            steps: Pipeline steps to execute
            sampling: Sampling options for large datasets
            options: Additional execution options
            X_np: Pre-converted numpy X array (avoids list→numpy conversion)
            y_np: Pre-converted numpy y array (avoids list→numpy conversion)
            wavelengths_np: Pre-extracted wavelength list (avoids re-extraction)
            metadata_np: Pre-converted metadata dict of numpy arrays

        Returns:
            ExecuteResponse with results and traces
        """
        import numpy as np

        if steps is None:
            steps = []

        start_time = time.perf_counter()
        options = options or {}

        # Use pre-converted numpy arrays if provided (fast path from execute-dataset)
        if X_np is not None:
            X_original = X_np if X_np.dtype == np.float64 else X_np.astype(np.float64)
            y = y_np.astype(np.float64) if y_np is not None else None
            wavelengths = wavelengths_np or list(range(X_original.shape[1]))
        else:
            # Convert input from Python lists to numpy arrays (slow path)
            X_original = np.array(data.x, dtype=np.float64)
            y = np.array(data.y, dtype=np.float64) if data.y else None
            wavelengths = data.wavelengths or list(range(X_original.shape[1]))

        # Resolve the wavelength axis unit ("nm", "cm-1", ...) so the response
        # can label charts correctly. Prefer an explicit kwarg from the caller
        # (set by /execute-dataset from the loaded SpectroDataset), then fall
        # back to the unit attached to the request payload (set by clients
        # uploading data through /execute).
        resolved_header_unit = header_unit if header_unit is not None else getattr(data, "header_unit", None)

        # Convert metadata to numpy arrays if provided
        metadata = None
        if metadata_np is not None:
            metadata = metadata_np
        elif data.metadata:
            metadata = {k: np.array(v) for k, v in data.metadata.items()}

        # Raw playground payloads do not carry a SpectroDataset instance, so the
        # repetition column must be inferred from the same bio-sample metadata
        # used by the repetitions chart. This keeps split preview aligned with
        # dataset-backed execution, where repetition already comes from the dataset.
        if not options.get("dataset_repetition"):
            bio_sample_column = options.get("bio_sample_column")
            if (
                isinstance(bio_sample_column, str)
                and bio_sample_column
                and metadata
                and bio_sample_column in metadata
            ):
                options = dict(options)
                options["dataset_repetition"] = bio_sample_column

        # Subset mode: when 'visible', select a representative subset BEFORE processing
        subset_mode = options.get("subset_mode", "all")
        subset_info = None
        total_samples = X_original.shape[0]

        if subset_mode == "visible":
            from nirs4all.data.selection.sampling import random_sample, stratified_sample

            max_displayed = options.get("max_samples_displayed", 200)
            n_select = min(max_displayed, total_samples)

            if n_select < total_samples:
                # Use stratified sampling if Y is available for representative subset
                if y is not None:
                    try:
                        subset_indices = stratified_sample(X_original, y, n_select, seed=42)
                    except Exception:
                        subset_indices = random_sample(total_samples, n_select, seed=42)
                else:
                    subset_indices = random_sample(total_samples, n_select, seed=42)

                # If the caller provided source_partitions, reorder the subset to
                # keep train rows before test rows so indices [0, n_train) stay
                # train and [n_train, n_train + n_test) stay test. Update the
                # partition counts for the subset.
                pre_subset_source_partitions = (options or {}).get("source_partitions")
                if pre_subset_source_partitions and pre_subset_source_partitions.get("has_test"):
                    orig_n_train = int(pre_subset_source_partitions.get("n_train", 0) or 0)
                    if 0 < orig_n_train < total_samples:
                        in_train = subset_indices < orig_n_train
                        n_train_subset = int(in_train.sum())
                        n_test_subset = int((~in_train).sum())
                        if n_train_subset > 0 and n_test_subset > 0:
                            subset_indices = np.concatenate([
                                subset_indices[in_train],
                                subset_indices[~in_train],
                            ])
                            options = dict(options)
                            options["source_partitions"] = {
                                "has_test": True,
                                "n_train": n_train_subset,
                                "n_test": n_test_subset,
                            }
                        else:
                            options = dict(options)
                            options["source_partitions"] = {
                                "has_test": False,
                                "n_train": n_train_subset,
                                "n_test": 0,
                            }

                # Apply subset to the original data before any processing
                X_original = X_original[subset_indices]
                if y is not None:
                    y = y[subset_indices]
                if metadata:
                    metadata = {k: v[subset_indices] for k, v in metadata.items()}
                if data.sample_ids:
                    data = PlaygroundData(
                        x=[data.x[i] for i in subset_indices],
                        y=[data.y[i] for i in subset_indices] if data.y else None,
                        wavelengths=data.wavelengths,
                        sample_ids=[data.sample_ids[i] for i in subset_indices],
                        metadata={k: [v[i] for i in subset_indices] for k, v in data.metadata.items()} if data.metadata else None,
                    )

                subset_info = {
                    "subset_mode": "visible",
                    "total_samples": total_samples,
                    "displayed_samples": n_select,
                }
            else:
                subset_info = {
                    "subset_mode": "visible",
                    "total_samples": total_samples,
                    "displayed_samples": total_samples,
                }

        # Apply sampling if needed (post-subset sampling, usually 'all' when subset_mode is active)
        sample_indices = self._apply_sampling(X_original, y, sampling)

        # Source partitions are authoritative and must come from the caller.
        # /execute-dataset derives them from the loaded SpectroDataset; uploaded
        # data (e.g. demo) sets them explicitly via options. There is no
        # metadata-based fallback: partitions belong to the dataset, not to an
        # ad-hoc metadata column.
        source_partitions = options.get("source_partitions") if options else None

        # Sampling may shuffle sample_indices away from the train-first / test-last
        # order required by `source_partitions`. Re-sort the sampled indices so
        # train rows come before test rows, then recompute n_train / n_test on
        # the sampled subset.
        if source_partitions and source_partitions.get("has_test"):
            total_rows = X_original.shape[0]
            orig_n_train = int(source_partitions.get("n_train", 0) or 0)
            orig_n_test = int(source_partitions.get("n_test", 0) or 0)
            if orig_n_train > 0 and orig_n_train + orig_n_test == total_rows:
                in_train = sample_indices < orig_n_train
                in_test = (sample_indices >= orig_n_train) & (sample_indices < total_rows)
                n_train_sampled = int(in_train.sum())
                n_test_sampled = int(in_test.sum())
                if n_train_sampled > 0 and n_test_sampled > 0:
                    sample_indices = np.concatenate([
                        sample_indices[in_train],
                        sample_indices[in_test],
                    ])
                    source_partitions = {
                        "has_test": True,
                        "n_train": n_train_sampled,
                        "n_test": n_test_sampled,
                    }
                    # Keep options in sync for the splitter step.
                    options = dict(options)
                    options["source_partitions"] = source_partitions
                else:
                    # Sampling dropped one side entirely: the partition structure
                    # no longer exists on the sampled subset.
                    source_partitions = {"has_test": False, "n_train": n_train_sampled, "n_test": 0}
                    options = dict(options)
                    options["source_partitions"] = source_partitions

        X_sampled = X_original[sample_indices]
        y_sampled = y[sample_indices] if y is not None else None
        original_y_sampled = y_sampled.copy() if y_sampled is not None else None

        sample_ids_sampled = None
        if data.sample_ids:
            sample_ids_sampled = [data.sample_ids[i] for i in sample_indices]
        original_sample_ids = list(sample_ids_sampled) if sample_ids_sampled is not None else None

        metadata_sampled = None
        if metadata:
            metadata_sampled = {k: v[sample_indices] for k, v in metadata.items()}
        original_metadata_sampled = (
            {k: v.copy() for k, v in metadata_sampled.items()}
            if metadata_sampled is not None
            else None
        )

        # Check if we have any enabled operators (raw data mode check)
        enabled_steps = [s for s in steps if s.enabled]
        is_raw_data = len(enabled_steps) == 0

        # Execute pipeline steps with step-level prefix caching
        X_processed = X_sampled.copy()
        execution_trace: list[StepTrace] = []
        step_errors: list[dict[str, Any]] = []
        execution_warnings: list[str] = []
        fold_info = None
        filter_info = None
        pre_has_test = bool(source_partitions and source_partitions.get("has_test"))
        splitter_count = 0
        augmentation_info = None
        splitter_applied = False
        total_filtered = 0
        filter_mask = np.ones(X_sampled.shape[0], dtype=bool)
        kept_indices = np.arange(X_sampled.shape[0])

        # Step-level prefix cache: find longest cached prefix to skip steps
        data_fp = compute_data_fingerprint(X_sampled)
        skip_count = 0
        if enabled_steps:
            for i in range(len(enabled_steps), 0, -1):
                prefix_key = compute_prefix_key(data_fp, enabled_steps[:i])
                cached_state = _step_cache.get(prefix_key)
                if cached_state is not None:
                    X_processed = cached_state["X"].copy()
                    cached_y = cached_state.get("y")
                    if cached_y is not None:
                        y_sampled = cached_y.copy()
                    fold_info = cached_state.get("fold_info")
                    filter_info = cached_state.get("filter_info")
                    augmentation_info = cached_state.get("augmentation_info")
                    filter_mask = cached_state.get("filter_mask", np.ones(X_sampled.shape[0], dtype=bool)).copy()
                    kept_indices = cached_state.get("kept_indices", np.arange(X_sampled.shape[0])).copy()
                    cached_meta = cached_state.get("metadata")
                    if cached_meta is not None:
                        metadata_sampled = {k: v.copy() for k, v in cached_meta.items()}
                    cached_sample_ids = cached_state.get("sample_ids")
                    if cached_sample_ids is not None:
                        sample_ids_sampled = list(cached_sample_ids)
                    execution_trace = list(cached_state.get("trace", []))
                    step_errors = list(cached_state.get("errors", []))
                    execution_warnings = list(cached_state.get("warnings", []))
                    splitter_applied = cached_state.get("splitter_applied", False)
                    splitter_count = cached_state.get("splitter_count", 0)
                    pre_has_test = cached_state.get("pre_has_test", pre_has_test)
                    total_filtered = cached_state.get("total_filtered", 0)
                    skip_count = i
                    break

        executed_step_idx = 0
        for step in steps:
            if not step.enabled:
                continue

            executed_step_idx += 1
            # Skip steps already restored from cache
            if executed_step_idx <= skip_count:
                continue

            step_start = time.perf_counter()
            try:
                if step.type == "splitting":
                    # Handle splitter — first splitter on a dataset without an
                    # existing test partition creates that partition; subsequent
                    # splits (or any split when test already exists) produce CV folds.
                    splitter_count += 1
                    splitter_kind = "cv_folds" if (pre_has_test or splitter_count > 1) else "test_split"
                    fold_info, splitter_warnings = self._execute_splitter(
                        step, X_processed, y_sampled, options, metadata_sampled,
                        kind=splitter_kind,
                    )
                    execution_warnings.extend(splitter_warnings)
                    if splitter_kind == "test_split":
                        # Once the first split has run, the dataset effectively has
                        # a test partition for any subsequent splitter steps.
                        pre_has_test = True
                    splitter_applied = True
                    trace = StepTrace(
                        step_id=step.id,
                        name=step.name,
                        duration_ms=(time.perf_counter() - step_start) * 1000,
                        success=True,
                        output_shape=None  # Splitters don't change data shape
                    )
                elif step.type == "filter":
                    # Handle filter operators
                    step_mask, filter_result = self._execute_filter(
                        step, X_processed, y_sampled, metadata_sampled
                    )
                    removed_count = int(np.sum(~step_mask))
                    filter_mode = filter_result.get("filter_mode", "remove")

                    # Initialize filter_info if needed
                    if filter_info is None:
                        filter_info = {
                            "filters_applied": [],
                            "total_removed": 0,
                            "final_mask": filter_mask.tolist(),
                            "tagged_samples": {},
                            "tag_mask": [False] * len(filter_mask),
                        }
                    if "tagged_samples" not in filter_info:
                        filter_info["tagged_samples"] = {}
                        filter_info["tag_mask"] = [False] * len(filter_mask)

                    if filter_mode == "tag":
                        # Non-destructive: record tagged indices but keep all samples
                        original_tagged = kept_indices[~step_mask].tolist()
                        filter_info["tagged_samples"][step.name] = original_tagged
                        # Update tag_mask (union of all tagged)
                        tag_mask = filter_info["tag_mask"]
                        for idx in original_tagged:
                            tag_mask[idx] = True
                        filter_info["tag_mask"] = tag_mask
                    else:
                        # Destructive: remove samples from arrays
                        total_filtered += removed_count
                        filter_mask[kept_indices[~step_mask]] = False
                        kept_indices = kept_indices[step_mask]
                        X_processed = X_processed[step_mask]
                        if y_sampled is not None:
                            y_sampled = y_sampled[step_mask]
                        if sample_ids_sampled is not None:
                            sample_ids_sampled = [
                                sample_id
                                for sample_id, keep in zip(sample_ids_sampled, step_mask, strict=False)
                                if keep
                            ]
                        if metadata_sampled is not None:
                            metadata_sampled = {k: v[step_mask] for k, v in metadata_sampled.items()}

                    trace = StepTrace(
                        step_id=step.id,
                        name=step.name,
                        duration_ms=(time.perf_counter() - step_start) * 1000,
                        success=True,
                        output_shape=list(X_processed.shape)
                    )

                    filter_info["filters_applied"].append({
                        "name": step.name,
                        "removed_count": removed_count,
                        "reason": filter_result.get("reason", "Filtered"),
                        "mode": filter_mode,
                    })
                    filter_info["total_removed"] = total_filtered
                    filter_info["final_mask"] = filter_mask.tolist()
                elif step.type == "augmentation":
                    # Handle augmentation operators — generate new samples
                    n_copies = step.params.get("n_augmented_copies", 1)
                    X_processed, y_sampled, aug_meta = self._execute_augmentation(
                        step, X_processed, y_sampled, wavelengths, n_augmented_copies=n_copies
                    )
                    copies_added = (
                        aug_meta["augmented_count"] // aug_meta["original_count"]
                        if aug_meta["original_count"] > 0
                        else 0
                    )
                    if sample_ids_sampled is not None and copies_added > 0:
                        current_sample_ids = list(sample_ids_sampled)
                        sample_ids_sampled = current_sample_ids + [
                            sample_id
                            for _ in range(copies_added)
                            for sample_id in current_sample_ids
                        ]
                    # Extend metadata to match augmented sample count by copying
                    # the source rows so augmented samples keep the same metadata.
                    if metadata_sampled is not None:
                        current_metadata = {k: v.copy() for k, v in metadata_sampled.items()}
                        if copies_added > 0:
                            metadata_sampled = {
                                k: np.concatenate([values] + [values.copy() for _ in range(copies_added)])
                                for k, values in current_metadata.items()
                            }
                    # Extend filter_mask and kept_indices for augmented samples
                    old_len = filter_mask.shape[0]
                    new_len = X_processed.shape[0]
                    if new_len > old_len:
                        filter_mask = np.concatenate([filter_mask, np.ones(new_len - old_len, dtype=bool)])
                        kept_indices = np.arange(new_len)
                    if augmentation_info is None:
                        augmentation_info = {
                            "steps": [],
                            "original_count": aug_meta["original_count"],
                        }
                    augmentation_info["steps"].append({
                        "name": step.name,
                        "copies": n_copies,
                        "samples_added": aug_meta["augmented_count"],
                    })
                    augmentation_info["total_count"] = aug_meta["total_count"]
                    trace = StepTrace(
                        step_id=step.id,
                        name=step.name,
                        duration_ms=(time.perf_counter() - step_start) * 1000,
                        success=True,
                        output_shape=list(X_processed.shape)
                    )
                else:
                    # Handle preprocessing
                    X_processed = self._execute_preprocessing(step, X_processed, wavelengths, y_sampled)
                    trace = StepTrace(
                        step_id=step.id,
                        name=step.name,
                        duration_ms=(time.perf_counter() - step_start) * 1000,
                        success=True,
                        output_shape=list(X_processed.shape)
                    )

                execution_trace.append(trace)

                # Cache the intermediate state after each step
                prefix_key = compute_prefix_key(data_fp, enabled_steps[:executed_step_idx])
                _step_cache.set(prefix_key, {
                    "X": X_processed.copy(),
                    "y": y_sampled.copy() if y_sampled is not None else None,
                    "metadata": {k: v.copy() for k, v in metadata_sampled.items()} if metadata_sampled else None,
                    "sample_ids": list(sample_ids_sampled) if sample_ids_sampled is not None else None,
                    "fold_info": fold_info,
                    "filter_info": filter_info,
                    "augmentation_info": augmentation_info,
                    "filter_mask": filter_mask.copy(),
                    "kept_indices": kept_indices.copy(),
                    "trace": list(execution_trace),
                    "errors": list(step_errors),
                    "warnings": list(execution_warnings),
                    "splitter_applied": splitter_applied,
                    "splitter_count": splitter_count,
                    "pre_has_test": pre_has_test,
                    "total_filtered": total_filtered,
                })

            except Exception as e:
                trace = StepTrace(
                    step_id=step.id,
                    name=step.name,
                    duration_ms=(time.perf_counter() - step_start) * 1000,
                    success=False,
                    error=str(e)
                )
                execution_trace.append(trace)
                step_errors.append({
                    "step": step.id,
                    "name": step.name,
                    "error": str(e)
                })
                # Continue with next step (don't break pipeline)

        # Compute statistics
        compute_stats = options.get("compute_statistics", True)
        original_stats = None
        processed_stats = None
        if compute_stats:
            try:
                original_stats = _charts.compute_statistics(X_sampled)
                processed_stats = _charts.compute_statistics(X_processed)
            except Exception as e:
                original_stats = {"error": str(e)}
                processed_stats = {"error": str(e)}

        # Compute PCA
        compute_pca = options.get("compute_pca", True)
        pca_result = None
        if compute_pca:
            try:
                pca_result = self._compute_pca(X_processed, y_sampled, fold_info)
            except Exception as e:
                pca_result = {"error": str(e)}

        # Compute UMAP (optional, can be expensive)
        compute_umap = options.get("compute_umap", False)
        umap_result = None
        if compute_umap:
            try:
                umap_params = options.get("umap_params", {})
                umap_result = _charts.compute_umap(
                    X_processed,
                    y_sampled,
                    fold_info,
                    umap_available=UMAP_AVAILABLE,
                    n_neighbors=umap_params.get("n_neighbors", 15),
                    min_dist=umap_params.get("min_dist", 0.1),
                    n_components=umap_params.get("n_components", 2),
                )
            except Exception as e:
                umap_result = {"error": str(e), "available": UMAP_AVAILABLE}

        # Compute repetition analysis (Phase 4)
        compute_repetitions = options.get("compute_repetitions", True)
        repetition_result = None
        if compute_repetitions:
            try:
                repetition_result = self._compute_repetition_analysis(
                    X=X_processed,
                    sample_ids=sample_ids_sampled,
                    metadata=metadata_sampled,
                    pca_result=pca_result,
                    umap_result=umap_result,
                    y=y_sampled,
                    options=options
                )
            except Exception as e:
                repetition_result = {"error": str(e), "has_repetitions": False}

        # Compute spectral metrics (Phase 5) - disabled by default for performance
        compute_metrics = options.get("compute_metrics", False)
        metrics_result = None
        if compute_metrics:
            try:
                metrics_result = _charts.compute_metrics(
                    X=X_processed,
                    pca_result=pca_result,
                    wavelengths=np.array(wavelengths),
                    requested_metrics=options.get("metrics"),  # None = fast metrics
                )
            except Exception as e:
                metrics_result = {"error": str(e)}

        # Downsample wavelengths for visualization using LTTB.
        # Only decimate when explicitly requested via max_wavelengths_returned > 0.
        max_wavelengths = options.get("max_wavelengths_returned")
        wavelengths_out = wavelengths
        X_sampled_out = X_sampled
        X_processed_out = X_processed

        if max_wavelengths and max_wavelengths > 0 and len(wavelengths) > max_wavelengths:
            # Use LTTB on the processed mean spectrum for feature-preserving decimation
            wl_array = np.asarray(wavelengths, dtype=np.float64)
            indices = decimate_wavelengths(wl_array, X_processed, max_wavelengths)
            wavelengths_out = [wavelengths[i] for i in indices]
            X_sampled_out = X_sampled[:, indices]
            X_processed_out = X_processed[:, indices]

        # Build response
        total_time = (time.perf_counter() - start_time) * 1000

        response = ExecuteResponse(
            success=len(step_errors) == 0,
            execution_time_ms=total_time,
            original={
                "spectra": X_sampled_out.tolist(),
                "wavelengths": wavelengths_out,
                "sample_indices": sample_indices.tolist(),
                "shape": list(X_sampled.shape),
                "statistics": original_stats,
                "header_unit": resolved_header_unit,
                "sample_ids": original_sample_ids,
                "metadata": {
                    k: v.tolist() if hasattr(v, "tolist") else list(v)
                    for k, v in original_metadata_sampled.items()
                } if original_metadata_sampled is not None else None,
                "y": original_y_sampled.tolist() if original_y_sampled is not None else None,
            },
            processed={
                "spectra": X_processed_out.tolist(),
                "wavelengths": wavelengths_out,
                "shape": list(X_processed.shape),
                "statistics": processed_stats,
                "header_unit": resolved_header_unit,
                "sample_ids": sample_ids_sampled,
                "metadata": {
                    k: v.tolist() if hasattr(v, "tolist") else list(v)
                    for k, v in metadata_sampled.items()
                } if metadata_sampled is not None else None,
                "y": y_sampled.tolist() if y_sampled is not None else None,
            },
            pca=pca_result,
            umap=umap_result,
            folds=fold_info,
            filter_info=filter_info,
            augmentation_info=augmentation_info,
            repetitions=repetition_result,
            metrics=metrics_result,
            subset_info=subset_info,
            execution_trace=execution_trace,
            step_errors=step_errors,
            warnings=execution_warnings,
            is_raw_data=is_raw_data,
            source_partitions=source_partitions,
        )

        return response

    # --- Thin delegators preserving the historical public/used surface ---

    def _apply_sampling(self, X, y, sampling: SamplingOptions | None):
        """Select a subset of sample indices (delegates to steps.apply_sampling)."""
        return _steps.apply_sampling(X, y, sampling)

    def _execute_preprocessing(self, step: PlaygroundStep, X, wavelengths=None, y=None):
        return _steps.execute_preprocessing(step, X, wavelengths, y)

    def _execute_augmentation(self, step: PlaygroundStep, X, y, wavelengths=None, n_augmented_copies: int = 1):
        return _steps.execute_augmentation(step, X, y, wavelengths, n_augmented_copies)

    def _execute_filter(self, step: PlaygroundStep, X, y, metadata) -> tuple:
        return _steps.execute_filter(step, X, y, metadata)

    def _execute_splitter(self, step, X, y, options, metadata=None, *, kind: str = "cv_folds"):
        return _steps.execute_splitter(step, X, y, options, metadata, kind=kind)

    def _compute_statistics(self, X) -> dict[str, Any]:
        return _charts.compute_statistics(X)

    def _compute_pca(self, X, y, fold_info: dict[str, Any] | None) -> dict[str, Any]:
        return _charts.compute_pca(X, y, fold_info)

    def _compute_umap(self, X, y, fold_info, n_neighbors: int = 15, min_dist: float = 0.1, n_components: int = 2):
        return _charts.compute_umap(
            X, y, fold_info,
            umap_available=UMAP_AVAILABLE,
            n_neighbors=n_neighbors, min_dist=min_dist, n_components=n_components,
        )

    def _compute_repetition_analysis(self, X, sample_ids, metadata, pca_result, umap_result, y, options):
        return _charts.compute_repetition_analysis(X, sample_ids, metadata, pca_result, umap_result, y, options)

    def _compute_metrics(self, X, pca_result=None, wavelengths=None, requested_metrics=None):
        return _charts.compute_metrics(X, pca_result, wavelengths, requested_metrics)
