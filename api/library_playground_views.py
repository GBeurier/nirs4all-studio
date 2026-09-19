"""Pure Playground catalogues and spectra presentation; numerical work stays in nirs4all."""
from __future__ import annotations

from typing import Any

from .shared.filter_catalogue import get_filter_methods
from .shared.operator_catalogue import get_augmentation_methods, get_preprocessing_methods, get_splitter_methods

NIRS4ALL_AVAILABLE = True

def list_operators():
    """List all available operators for the playground.

    Returns preprocessing, augmentation, splitting, and filter operators with their
    metadata, parameters, and categories.
    """
    if not NIRS4ALL_AVAILABLE:
        return {
            "preprocessing": [],
            "augmentation": [],
            "splitting": [],
            "filter": [],
            "total": 0
        }

    preprocessing = get_preprocessing_methods()
    augmentation = get_augmentation_methods()
    splitting = get_splitter_methods()
    filters = get_filter_methods()

    # Group by category
    preprocessing_by_category = {}
    for method in preprocessing:
        cat = method.get("category", "other")
        if cat not in preprocessing_by_category:
            preprocessing_by_category[cat] = []
        preprocessing_by_category[cat].append(method)

    augmentation_by_category = {}
    for method in augmentation:
        cat = method.get("category", "other")
        if cat not in augmentation_by_category:
            augmentation_by_category[cat] = []
        augmentation_by_category[cat].append(method)

    splitting_by_category = {}
    for method in splitting:
        cat = method.get("category", "other")
        if cat not in splitting_by_category:
            splitting_by_category[cat] = []
        splitting_by_category[cat].append(method)

    filter_by_category = {}
    for method in filters:
        cat = method.get("category", "other")
        if cat not in filter_by_category:
            filter_by_category[cat] = []
        filter_by_category[cat].append(method)

    return {
        "preprocessing": preprocessing,
        "preprocessing_by_category": preprocessing_by_category,
        "augmentation": augmentation,
        "augmentation_by_category": augmentation_by_category,
        "splitting": splitting,
        "splitting_by_category": splitting_by_category,
        "filter": filters,
        "filter_by_category": filter_by_category,
        "total": len(preprocessing) + len(augmentation) + len(splitting) + len(filters)
    }


def get_presets():
    """Get common preprocessing and splitting presets.

    Returns predefined pipeline configurations for common use cases.
    """
    presets = [
        {
            "id": "snv_basic",
            "name": "SNV Basic",
            "description": "Standard Normal Variate for scatter correction",
            "category": "preprocessing",
            "steps": [
                {"type": "preprocessing", "name": "StandardNormalVariate", "params": {}}
            ]
        },
        {
            "id": "snv_savgol",
            "name": "SNV + Savitzky-Golay",
            "description": "Scatter correction with smoothing",
            "category": "preprocessing",
            "steps": [
                {"type": "preprocessing", "name": "StandardNormalVariate", "params": {}},
                {"type": "preprocessing", "name": "SavitzkyGolay", "params": {"window_length": 11, "polyorder": 2}}
            ]
        },
        {
            "id": "derivative_first",
            "name": "First Derivative",
            "description": "First derivative using Savitzky-Golay",
            "category": "preprocessing",
            "steps": [
                {"type": "preprocessing", "name": "SavitzkyGolay", "params": {"window_length": 11, "polyorder": 2, "deriv": 1}}
            ]
        },
        {
            "id": "kfold_5",
            "name": "5-Fold CV",
            "description": "Standard 5-fold cross-validation",
            "category": "splitting",
            "steps": [
                {"type": "splitting", "name": "KFold", "params": {"n_splits": 5, "shuffle": True, "random_state": 42}}
            ]
        },
        {
            "id": "stratified_kfold_5",
            "name": "Stratified 5-Fold CV",
            "description": "5-fold CV with stratification by target",
            "category": "splitting",
            "steps": [
                {"type": "splitting", "name": "StratifiedKFold", "params": {"n_splits": 5, "shuffle": True, "random_state": 42}}
            ]
        },
        {
            "id": "train_test_80_20",
            "name": "80/20 Train-Test Split",
            "description": "Simple train-test split",
            "category": "splitting",
            "steps": [
                {"type": "splitting", "name": "ShuffleSplit", "params": {"n_splits": 1, "test_size": 0.2, "random_state": 42}}
            ]
        },
        {
            "id": "full_pipeline",
            "name": "Full NIRS Pipeline",
            "description": "Complete preprocessing with MSC, derivative, scaling, and 5-fold CV",
            "category": "combined",
            "steps": [
                {"type": "preprocessing", "name": "MultiplicativeScatterCorrection", "params": {}},
                {"type": "preprocessing", "name": "SavitzkyGolay", "params": {"window_length": 11, "polyorder": 2, "deriv": 1}},
                {"type": "preprocessing", "name": "StandardScaler", "params": {}},
                {"type": "splitting", "name": "KFold", "params": {"n_splits": 5, "shuffle": True, "random_state": 42}}
            ]
        },
    ]

    return {"presets": presets, "total": len(presets)}



def read_spectra(operation: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Project authorized dataset arrays using owner extraction and statistics."""
    from nirs4all.analysis.playground_dataset import extract_playground_dataset
    from nirs4all.analysis.playground_statistics import spectral_statistics
    from nirs4all.analysis.playground_types import PreviewLimits
    from nirs4all.api.dataset_inspection import load_dataset_for_analysis

    from .shared.json_safe import sanitize_dict

    allowed = {"config", "dataset_id", "partition", "source", "target_index", "start", "end", "include_y", "include_metadata", "max_wavelengths_returned"}
    if set(payload) - allowed or not isinstance(payload.get("config"), dict):
        raise ValueError("Spectra require an authorized dataset config and bounded query fields")
    dataset, reader = load_dataset_for_analysis(payload["config"])
    partition, source = payload.get("partition", "train"), payload.get("source", 0)
    selection = extract_playground_dataset(dataset, partition=partition, source_index=source,
                                           target_index=payload.get("target_index", 0),
                                           limits=PreviewLimits(max_samples=1_000_000, max_features=100_000, max_cells=64_000_000))
    batch = selection.batch
    headers = selection.evidence.get("original_headers") or batch.wavelengths.tolist()
    result: dict[str, Any] = {"dataset_id": payload["dataset_id"], "partition": partition, "source": source,
                              "wavelengths": headers, "dataset_reader": reader, "diagnostics": list(selection.diagnostics)}
    if operation == "spectra.stats":
        stats = spectral_statistics(batch.x)
        result["statistics"] = {key: stats[field] for key, field in {
            "mean": "mean", "std": "std", "min": "min", "max": "max", "median": "p50", "q1": "p25", "q3": "p75"}.items()}
        result["global"] = {key: stats["global"][field] for key, field in {
            "global_mean": "mean", "global_std": "std", "global_min": "min", "global_max": "max",
            "num_samples": "n_samples", "num_features": "n_features"}.items()}
        result["statistics_diagnostics"] = stats["diagnostics"]
        return sanitize_dict(result)
    if operation != "spectra.data":
        raise ValueError("Unsupported spectra operation")
    total = len(batch.x)
    start, end = min(payload.get("start", 0), total), min(payload.get("end", total), total)
    if end < start:
        raise ValueError("Spectra end must be greater than or equal to start")
    matrix = batch.x[start:end]
    maximum = payload.get("max_wavelengths_returned")
    if maximum and len(headers) > maximum and len(matrix):
        from .shared.decimation import decimate_wavelengths
        indices = decimate_wavelengths(batch.wavelengths, matrix, maximum)
        matrix = matrix[:, indices]
        result["wavelengths"] = [headers[index] for index in indices]
    result.update(start=start, end=end, total_samples=total, num_features=batch.x.shape[1], spectra=matrix.tolist(),
                  wavelength_unit=batch.header_unit, repetition_column=selection.evidence["repetition_column"])
    if payload.get("include_y"):
        result["y"] = batch.y[start:end].tolist() if batch.y is not None else None
    if payload.get("include_metadata"):
        result["metadata"] = {name: values[start:end].tolist() for name, values in batch.metadata.items()} or None
        result["metadata_columns"] = list(batch.metadata)
    return sanitize_dict(result)


def playground_view(operation: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Dispatch presentation-only operations without importing the HTTP app."""
    if operation.startswith("spectra."):
        return read_spectra(operation, payload)
    if payload:
        raise ValueError("Playground catalogue takes no payload")
    if operation == "playground.operators":
        return list_operators()
    if operation == "playground.presets":
        return get_presets()
    raise ValueError("Unsupported Playground view")
