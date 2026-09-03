"""Portable pipeline execution backed by the nirs4all-methods bindings."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ._pipeline import PipelineDefinition, load_pipeline_definition

KENNARD_STONE_CLASSES: frozenset[str] = frozenset(
    {
        "nirs4all.operators.splitters.KennardStoneSplitter",
        "nirs4all.operators.splitters.splitters.KennardStoneSplitter",
    }
)
SNV_CLASSES: frozenset[str] = frozenset(
    {
        "nirs4all.operators.transforms.SNV",
        "nirs4all.operators.transforms.StandardNormalVariate",
        "nirs4all.operators.transforms.scalers.StandardNormalVariate",
    }
)
SAVGOL_CLASSES: frozenset[str] = frozenset(
    {
        "nirs4all.operators.transforms.SavitzkyGolay",
        "nirs4all.operators.transforms.nirs.SavitzkyGolay",
    }
)
PLS_CLASSES: frozenset[str] = frozenset(
    {
        "sklearn.cross_decomposition.PLSRegression",
        "sklearn.cross_decomposition._pls.PLSRegression",
    }
)
SAVGOL_MODES: dict[str, int] = {
    "mirror": 0,
    "constant": 1,
    "nearest": 2,
    "wrap": 3,
    "interp": 4,
}
SAVGOL_MODE_NAMES: tuple[str, ...] = ("mirror", "constant", "nearest", "wrap", "interp")


@dataclass(frozen=True)
class PortableDataset:
    """Dense matrix dataset accepted by the portable runner."""

    X: Any
    y: Any
    rows: int | None = None
    cols: int | None = None


def run_portable_pipeline(
    source: str | dict[str, Any] | list[Any] | PipelineDefinition,
    dataset: PortableDataset | dict[str, Any],
) -> dict[str, Any]:
    """Execute a portable nirs4all pipeline through `nirs4all-methods`.

    The aggregate does not implement numerical kernels itself. This function
    translates the shared nirs4all JSON/YAML syntax to the idiomatic Python
    wrappers exposed by `nirs4all-methods` (`n4m.transform`,
    `n4m.model_selection` and `pls4all.sklearn`) and returns the same result
    contract as the npm/WASM binding.
    """

    np, KennardStoneSplitter, SNV, SavitzkyGolay, PLSRegression = _load_methods_surface()
    definition = source if isinstance(source, PipelineDefinition) else load_pipeline_definition(source)
    input_data = _coerce_dataset(dataset, np)
    plan = parse_execution_plan(definition)

    split = _compute_split(plan["splitter"], input_data, KennardStoneSplitter, np)
    train_indices = np.asarray(split["trainIndices"], dtype=np.int64)
    test_indices = np.asarray(split["testIndices"], dtype=np.int64)
    x_train = input_data["X"][train_indices].copy()
    x_test = input_data["X"][test_indices].copy()
    y_train = input_data["y"][train_indices].copy()
    y_test = input_data["y"][test_indices].copy()

    preprocessing: list[dict[str, Any]] = []
    for step in plan["preprocessing"]:
        transformer = _make_transformer(step, SNV, SavitzkyGolay)
        transformer.fit(x_train, y_train)
        x_train = transformer.transform(x_train)
        x_test = transformer.transform(x_test)
        preprocessing.append({"type": step["type"], "params": step["params"]})

    variants = []
    for n_components in plan["nComponents"]:
        model = PLSRegression(
            n_components=int(n_components),
            solver="simpls",
            center_x=True,
            scale_x=True,
            center_y=True,
            scale_y=True,
        )
        model.fit(x_train, y_train)
        predictions = np.asarray(model.predict(x_test), dtype=np.float64).reshape(-1)
        diff = predictions - y_test.reshape(-1)
        variants.append(
            {
                "n_components": int(n_components),
                "rmse": float(np.sqrt(np.mean(diff * diff))),
                "predictions": predictions.tolist(),
            }
        )

    selected = min(variants, key=lambda item: item["rmse"])
    return {
        "name": definition.name,
        "rows": int(input_data["rows"]),
        "cols": int(input_data["cols"]),
        "split": split,
        "preprocessing": preprocessing,
        "variants": variants,
        "selected": selected,
        "targets": y_test.reshape(-1).tolist(),
    }


def parse_execution_plan(
    source: str | dict[str, Any] | list[Any] | PipelineDefinition,
) -> dict[str, Any]:
    """Parse the executable subset of the portable pipeline contract."""

    definition = source if isinstance(source, PipelineDefinition) else load_pipeline_definition(source)
    splitter: dict[str, Any] | None = None
    preprocessing: list[dict[str, Any]] = []
    model_step: dict[str, Any] | None = None

    for step in definition.pipeline:
        if not isinstance(step, dict):
            raise TypeError("Portable pipeline steps must be mapping objects.")

        class_name = step.get("class")
        if isinstance(class_name, str):
            if class_name in KENNARD_STONE_CLASSES:
                splitter = {"type": "KennardStone", "params": dict(step.get("params") or {})}
            elif class_name in SNV_CLASSES:
                preprocessing.append({"type": "StandardNormalVariate", "params": []})
            elif class_name in SAVGOL_CLASSES:
                preprocessing.append({"type": "SavitzkyGolay", "params": _savgol_params(step.get("params") or {})})
            else:
                raise ValueError(f"Portable execution does not support step class '{class_name}'.")
            continue

        model = step.get("model")
        if isinstance(model, dict):
            if model_step is not None:
                raise ValueError("Portable execution supports exactly one model step.")
            model_step = step
            continue

        raise ValueError(f"Portable execution does not support pipeline step: {step!r}")

    if model_step is None:
        raise ValueError("Portable execution requires a PLSRegression model step.")
    model = model_step.get("model")
    model_class = model.get("class") if isinstance(model, dict) else None
    if model_class not in PLS_CLASSES:
        raise ValueError(f"Portable execution does not support model class '{model_class}'.")

    return {
        "splitter": splitter,
        "preprocessing": preprocessing,
        "nComponents": _component_values(model_step),
    }


def _load_methods_surface():
    try:
        import numpy as np
        from n4m.model_selection.splitters import KennardStoneSplitter
        from n4m.transform.scatter import SNV
        from n4m.transform.smoothing import SavitzkyGolay
        from pls4all.sklearn import PLSRegression
    except ImportError as exc:  # pragma: no cover - exercised by optional installs
        raise ImportError(
            "Portable execution requires the nirs4all-methods Python bindings. "
            "Install `nirs4all-core[methods]` or make `n4m`/`pls4all` available."
        ) from exc
    return np, KennardStoneSplitter, SNV, SavitzkyGolay, PLSRegression


def _coerce_dataset(dataset: PortableDataset | dict[str, Any], np):
    if isinstance(dataset, PortableDataset):
        raw = {"X": dataset.X, "y": dataset.y, "rows": dataset.rows, "cols": dataset.cols}
    elif isinstance(dataset, dict):
        raw = dataset
    else:
        raise TypeError("Portable execution requires a PortableDataset or mapping.")

    rows = raw.get("rows", raw.get("n_samples"))
    cols = raw.get("cols", raw.get("n_features"))
    x = np.asarray(raw["X"], dtype=np.float64)
    if x.ndim == 1:
        if rows is None or cols is None:
            raise TypeError("Flat X requires rows/cols or n_samples/n_features.")
        x = x.reshape((int(rows), int(cols)))
    elif x.ndim == 2:
        rows, cols = x.shape
    else:
        raise TypeError("Dataset X must be a flat or 2-D numeric matrix.")

    y = np.asarray(raw["y"], dtype=np.float64)
    if y.ndim == 2 and y.shape[1] == 1:
        y = y.reshape(-1)
    elif y.ndim != 1:
        raise TypeError("Portable execution currently supports a single numeric target.")

    if x.shape[0] != y.shape[0]:
        raise ValueError(f"X rows ({x.shape[0]}) must match y rows ({y.shape[0]}).")
    return {
        "X": np.ascontiguousarray(x, dtype=np.float64),
        "y": np.ascontiguousarray(y, dtype=np.float64),
        "rows": int(x.shape[0]),
        "cols": int(x.shape[1]),
    }


def _compute_split(splitter: dict[str, Any] | None, data: dict[str, Any], splitter_cls, np) -> dict[str, Any]:
    if splitter is None:
        indices = list(range(data["rows"]))
        return {"kind": "all", "trainIndices": indices, "testIndices": indices}

    split = splitter_cls(test_size=float(splitter["params"].get("test_size", 0.25)))
    train, test = split.split(data["X"])
    return {
        "kind": "KennardStone",
        "trainIndices": np.asarray(train, dtype=np.int64).astype(int).tolist(),
        "testIndices": np.asarray(test, dtype=np.int64).astype(int).tolist(),
    }


def _make_transformer(step: dict[str, Any], snv_cls, savgol_cls):
    if step["type"] == "StandardNormalVariate":
        return snv_cls()
    if step["type"] == "SavitzkyGolay":
        window_length, polyorder, deriv, mode, cval = step["params"]
        return savgol_cls(
            window_length=int(window_length),
            polyorder=int(polyorder),
            deriv=int(deriv),
            delta=1.0,
            mode=_savgol_mode_name(mode),
            cval=float(cval),
        )
    raise ValueError(f"Unsupported portable preprocessing step: {step['type']}")


def _savgol_params(params: dict[str, Any]) -> list[float | int]:
    delta = float(params.get("delta", 1.0))
    if delta != 1.0:
        raise ValueError("Portable Savitzky-Golay execution currently supports delta=1 only.")
    return [
        int(params.get("window_length", params.get("window", 11))),
        int(params.get("polyorder", 3)),
        int(params.get("deriv", 0)),
        _savgol_mode(params.get("mode", "interp")),
        float(params.get("cval", 0.0)),
    ]


def _savgol_mode(value: Any) -> int:
    if isinstance(value, str):
        key = value.lower()
        if key in SAVGOL_MODES:
            return SAVGOL_MODES[key]
        raise ValueError(f"Unsupported Savitzky-Golay mode: {value!r}")
    mode = int(value)
    if 0 <= mode < len(SAVGOL_MODE_NAMES):
        return mode
    raise ValueError(f"Unsupported Savitzky-Golay mode: {value!r}")


def _savgol_mode_name(value: Any) -> str:
    mode = _savgol_mode(value)
    return SAVGOL_MODE_NAMES[mode]


def _component_values(step: dict[str, Any]) -> list[int]:
    if "_range_" in step:
        if step.get("param") != "n_components":
            raise ValueError("Portable execution only supports _range_ sweeps over 'n_components'.")
        start, stop, stride = [int(value) for value in step["_range_"]]
        if stride <= 0:
            raise ValueError("Invalid n_components _range_; expected [start, stop, positive_step].")
        return list(range(start, stop + 1, stride))
    params = step.get("model", {}).get("params", {})
    return [max(1, int(params.get("n_components", 2)))]
