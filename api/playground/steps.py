"""Per-step pipeline executors for the playground.

Each function applies a single playground step (sampling, preprocessing,
augmentation, filter, splitter) using nirs4all operators directly via
``fit_transform`` / ``fit_predict`` / ``split`` — without the full StepRunner
infrastructure — to minimize overhead for real-time preview.

These are pure step transforms: they take arrays in and return arrays/fold
info out. The orchestration (caching, array bookkeeping, response shaping)
lives in :mod:`api.playground.executor`.
"""

from __future__ import annotations

import warnings
from typing import Any

from ..shared.filter_operators import instantiate_filter
from ..shared.pipeline_service import instantiate_operator
from ..shared.preprocessing_runtime import apply_preprocessing_chain
from .models import PlaygroundStep, SamplingOptions


def apply_sampling(X, y, sampling: SamplingOptions | None):
    """Select a subset of sample indices.

    Delegates to nirs4all.data.selection.sampling for the actual sampling
    strategies (random, stratified, kmeans).

    Args:
        X: Full data array
        y: Target values (for stratified sampling)
        sampling: Sampling configuration

    Returns:
        Array of selected sample indices
    """
    import numpy as np
    n_samples = X.shape[0]

    if sampling is None or sampling.method == "all":
        return np.arange(n_samples)

    from nirs4all.data.selection.sampling import kmeans_sample, random_sample, stratified_sample

    n_select = min(sampling.n_samples, n_samples)

    if sampling.method == "random":
        return random_sample(n_samples, n_select, seed=sampling.seed)

    elif sampling.method == "stratified" and y is not None:
        return stratified_sample(X, y, n_select, seed=sampling.seed)

    elif sampling.method == "kmeans":
        return kmeans_sample(X, n_select, seed=sampling.seed)

    else:
        return random_sample(n_samples, n_select, seed=sampling.seed)


def execute_preprocessing(step: PlaygroundStep, X, wavelengths=None, y=None):
    """Execute a preprocessing step.

    Args:
        step: Step configuration
        X: Input data
        wavelengths: Wavelength array (passed to operators that need it)
        y: Target values (forwarded to operators whose fit_transform accepts `y`,
           e.g. CARS, MCUVE, OSC, TargetEncoder)

    Returns:
        Transformed data
    """
    transformed, _applied_steps = apply_preprocessing_chain(
        X,
        [step],
        wavelengths=wavelengths,
        y=y,
        strict=True,
    )
    return transformed


def execute_augmentation(step: PlaygroundStep, X, y, wavelengths=None, n_augmented_copies: int = 1):
    """Execute an augmentation step, generating new augmented samples.

    Resolves augmentation operators from nirs4all.operators.augmentation,
    then generates N augmented copies of the input data by applying the
    operator repeatedly. Original samples are preserved and augmented
    copies are concatenated.

    Args:
        step: Step configuration
        X: Input data (n_samples, n_features)
        y: Target values (n_samples,) or None
        wavelengths: Wavelength array (passed to wavelength-aware operators)
        n_augmented_copies: Number of augmented copies per original sample

    Returns:
        Tuple of (X_augmented, y_augmented, augmentation_meta)
    """
    import numpy as np

    # Filter out augmentation-specific params before instantiating
    operator_params = {k: v for k, v in step.params.items() if k != "n_augmented_copies"}
    operator = instantiate_operator(step.name, operator_params, "augmentation")
    if operator is None:
        # Fall back to preprocessing resolution (some operators work in both)
        operator = instantiate_operator(step.name, operator_params, "preprocessing")
    if operator is None:
        raise ValueError(f"Unknown augmentation operator: {step.name}")

    original_count = X.shape[0]

    # Wavelength-aware operators (SpectraTransformerMixin subclasses) need
    # wavelengths forwarded as a kwarg, otherwise they raise ValueError.
    needs_wl = bool(getattr(operator, "_requires_wavelengths", False))
    fit_kwargs: dict[str, Any] = {}
    if needs_wl and wavelengths is not None:
        fit_kwargs["wavelengths"] = np.asarray(wavelengths, dtype=float)

    # Generate augmented copies
    augmented_copies = []
    for _ in range(n_augmented_copies):
        X_aug = operator.fit_transform(X, **fit_kwargs)
        augmented_copies.append(X_aug)

    # Concatenate original + augmented
    X_out = np.concatenate([X] + augmented_copies, axis=0)
    y_out = np.tile(y, n_augmented_copies + 1) if y is not None else None

    aug_meta = {
        "original_count": original_count,
        "augmented_count": original_count * n_augmented_copies,
        "total_count": X_out.shape[0],
    }

    return X_out, y_out, aug_meta


def execute_filter(step: PlaygroundStep, X, y, metadata) -> tuple:
    """Execute a filter step.

    Args:
        step: Step configuration
        X: Input data
        y: Target values
        metadata: Sample metadata

    Returns:
        Tuple of (boolean mask, filter result info)
    """
    import numpy as np
    # Strip filter_mode from params before passing to nirs4all filter
    params = dict(step.params)
    filter_mode = params.pop("filter_mode", "remove")

    filter_op = instantiate_filter(step.name, params)
    if filter_op is None:
        raise ValueError(f"Unknown filter operator: {step.name}")

    mask = filter_op.fit_predict(X, y, metadata)
    reason = filter_op.get_removal_reason()

    return mask, {"reason": reason, "kept": int(np.sum(mask)), "removed": int(np.sum(~mask)), "filter_mode": filter_mode}


def execute_splitter(
    step: PlaygroundStep,
    X,
    y,
    options: dict[str, Any],
    metadata: dict[str, Any] | None = None,
    *,
    kind: str = "cv_folds",
) -> tuple[dict[str, Any], list[str]]:
    """Execute a splitter step.

    Args:
        step: Step configuration
        X: Input data
        y: Target values (may be required by some splitters)
        options: Execution options (split_index for ShuffleSplit-like)
        metadata: Optional metadata columns aligned with X rows.

    Returns:
        Tuple of (fold information dict, non-blocking warnings)
    """
    import inspect

    import numpy as np
    import pandas as pd
    from nirs4all.controllers.splitters.split import resolve_split_groups
    from nirs4all.data.dataset import SpectroDataset
    from nirs4all.operators.splitters import GroupedSplitterWrapper

    operator = instantiate_operator(step.name, step.params, "splitting")
    if operator is None:
        raise ValueError(f"Unknown splitter: {step.name}")
    base_splitter_name = operator.__class__.__name__

    # When the playground is previewing a dataset that already has a held-out
    # test partition, CV splitters must only operate on the train subset.
    # Keep global sample indices so the frontend can still render the full
    # dataset and keep held-out test samples visible.
    split_indices = np.arange(X.shape[0], dtype=int)
    X_for_split = X
    y_for_split = y
    metadata_for_split = metadata

    source_partitions = options.get("source_partitions") if options else None
    if kind == "cv_folds" and source_partitions and source_partitions.get("has_test"):
        n_train = int(source_partitions.get("n_train", 0) or 0)
        n_test = int(source_partitions.get("n_test", 0) or 0)
        total_expected = n_train + n_test

        if 0 < n_train < X.shape[0] and total_expected == X.shape[0]:
            split_indices = np.arange(n_train, dtype=int)
            X_for_split = X[:n_train]
            y_for_split = y[:n_train] if y is not None else None
            metadata_for_split = (
                {
                    key: value[:n_train]
                    if value is not None and len(value) == X.shape[0]
                    else value
                    for key, value in metadata.items()
                }
                if metadata
                else None
            )

    # Mirror the library contract: resolve effective groups from dataset
    # repetition + explicit group_by, then decide native groups vs wrapper.
    temp_dataset = SpectroDataset(name=f"playground_{step.name}")
    temp_dataset.add_samples(X_for_split, {"partition": "train"})
    if y_for_split is not None:
        temp_dataset.add_targets(y_for_split)

    if metadata_for_split:
        aligned_metadata: dict[str, list[Any]] = {}
        for key, value in metadata_for_split.items():
            if value is None:
                continue
            values = np.asarray(value)
            if values.shape[0] != X_for_split.shape[0]:
                continue
            aligned_metadata[key] = values.tolist()
        if aligned_metadata:
            temp_dataset.add_metadata(pd.DataFrame(aligned_metadata))

    dataset_repetition = options.get("dataset_repetition")
    if dataset_repetition:
        temp_dataset.set_repetition(dataset_repetition)

    with warnings.catch_warnings(record=True) as caught_warnings:
        warnings.simplefilter("always")
        resolved_groups = resolve_split_groups(
            dataset=temp_dataset,
            splitter=operator,
            group_by=step.params.get("group_by"),
            legacy_group=step.params.get("group"),
            ignore_repetition=bool(step.params.get("ignore_repetition", False)),
            context={"partition": "train"},
            include_augmented=False,
        )

    split_warnings: list[str] = []
    for caught in caught_warnings:
        message = str(caught.message)
        if message not in split_warnings:
            split_warnings.append(message)

    groups = resolved_groups.effective_groups
    if groups is not None and len(groups) != X_for_split.shape[0]:
        raise ValueError(
            f"Effective groups array length ({len(groups)}) doesn't match X rows ({X_for_split.shape[0]})"
        )

    if resolved_groups.uses_repetition and resolved_groups.uses_group_by:
        effective_group_mode = "combined"
    elif resolved_groups.uses_repetition:
        effective_group_mode = "repetition_only"
    elif resolved_groups.uses_group_by:
        effective_group_mode = "group_by_only"
    else:
        effective_group_mode = "none"

    resolved_group_by = resolved_groups.group_by
    if isinstance(resolved_group_by, str):
        response_group_by: str | None = resolved_group_by
        group_parts = [resolved_group_by]
    elif resolved_group_by:
        response_group_by = " + ".join(resolved_group_by)
        group_parts = list(resolved_group_by)
    else:
        response_group_by = None
        group_parts = []

    repetition_column = dataset_repetition or None
    effective_group_label: str | None = None
    if effective_group_mode == "combined" and repetition_column:
        effective_group_label = " + ".join([repetition_column, *group_parts])
    elif effective_group_mode == "repetition_only":
        effective_group_label = repetition_column
    elif effective_group_mode == "group_by_only":
        effective_group_label = response_group_by

    split_y = y_for_split
    if split_y is not None and "Stratified" in base_splitter_name:
        finite_mask = np.isfinite(split_y) if np.issubdtype(np.asarray(split_y).dtype, np.number) else None
        if finite_mask is None or bool(np.all(finite_mask)):
            unique_y = np.unique(split_y)
            n_bins = min(5, len(unique_y))
            if n_bins > 1:
                # Quantile binning is library-owned (PG-08); 5 bins stays a
                # preview-stratification choice of the playground.
                from nirs4all.data.binning import BinningCalculator

                split_y, _edges = BinningCalculator.bin_continuous_targets(
                    np.asarray(split_y, dtype=float), bins=n_bins, strategy="quantile"
                )

    requires_wrapper = resolved_groups.requires_wrapper
    if requires_wrapper:
        operator = GroupedSplitterWrapper(
            splitter=operator,
            aggregation=step.params.get("aggregation", "mean"),
            y_aggregation=step.params.get("y_aggregation"),
        )

    kwargs: dict[str, Any] = {}
    sig = inspect.signature(operator.split)
    if split_y is not None and "y" in sig.parameters or groups is not None and split_y is not None:
        kwargs["y"] = split_y
    if groups is not None:
        kwargs["groups"] = groups

    # Generate folds
    folds_list = list(operator.split(X_for_split, **kwargs))

    # Handle split_index for ShuffleSplit-like splitters
    split_index = options.get("split_index")

    # Build fold info
    folds_data = []
    fold_labels = np.full(X.shape[0], -1, dtype=int)  # -1 = not assigned

    for fold_idx, (train_indices_local, test_indices_local) in enumerate(folds_list):
        train_indices_local = np.asarray(train_indices_local, dtype=int)
        test_indices_local = np.asarray(test_indices_local, dtype=int)
        train_indices = split_indices[train_indices_local]
        test_indices = split_indices[test_indices_local]

        fold_data = {
            "fold_index": fold_idx,
            "train_count": len(train_indices),
            "test_count": len(test_indices),
            "train_indices": train_indices.tolist(),
            "test_indices": test_indices.tolist(),
        }

        # Compute per-fold Y statistics
        if y is not None:
            y_train = y[train_indices]
            y_test = y[test_indices] if len(test_indices) > 0 else np.array([])

            fold_data["y_train_stats"] = {
                "mean": float(np.mean(y_train)),
                "std": float(np.std(y_train)),
                "min": float(np.min(y_train)),
                "max": float(np.max(y_train)),
            }

            if len(y_test) > 0:
                fold_data["y_test_stats"] = {
                    "mean": float(np.mean(y_test)),
                    "std": float(np.std(y_test)),
                    "min": float(np.min(y_test)),
                    "max": float(np.max(y_test)),
                }

        folds_data.append(fold_data)

        # For fold labels, use split_index if specified (for ShuffleSplit-like)
        # Otherwise, use the last fold (for K-Fold, this gives test fold assignment)
        if split_index is not None:
            if fold_idx == split_index:
                fold_labels[test_indices] = fold_idx
        else:
            fold_labels[test_indices] = fold_idx

    return {
        "splitter_name": step.name,
        "n_folds": len(folds_list),
        "folds": folds_data,
        "fold_labels": fold_labels.tolist(),
        "split_index": split_index,
        "kind": kind,
        "repetition_column": repetition_column,
        "group_by": response_group_by,
        "effective_group_mode": effective_group_mode,
        "effective_group_label": effective_group_label,
    }, split_warnings
