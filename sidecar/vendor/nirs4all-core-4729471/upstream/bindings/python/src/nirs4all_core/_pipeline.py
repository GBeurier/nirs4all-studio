"""Pipeline definition loading and validation for nirs4all-compatible syntax."""

from __future__ import annotations

import json
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

PORTABLE_OPERATOR_CLASSES: frozenset[str] = frozenset(
    {
        "nirs4all.operators.splitters.KennardStoneSplitter",
        "nirs4all.operators.splitters.splitters.KennardStoneSplitter",
        "nirs4all.operators.transforms.SNV",
        "nirs4all.operators.transforms.StandardNormalVariate",
        "nirs4all.operators.transforms.scalers.StandardNormalVariate",
        "nirs4all.operators.transforms.SavitzkyGolay",
        "nirs4all.operators.transforms.nirs.SavitzkyGolay",
        "sklearn.cross_decomposition.PLSRegression",
        "sklearn.cross_decomposition._pls.PLSRegression",
    }
)


@dataclass(frozen=True)
class PipelineDefinition:
    """A nirs4all-style pipeline definition restricted to portable operators."""

    name: str
    description: str
    random_state: int | None
    pipeline: list[Any]

    def as_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "name": self.name,
            "description": self.description,
            "pipeline": deepcopy(self.pipeline),
        }
        if self.random_state is not None:
            result["random_state"] = self.random_state
        return result


def load_pipeline_definition(source: str | Path | dict[str, Any] | list[Any]) -> PipelineDefinition:
    """Load a nirs4all JSON/YAML pipeline definition and validate portable classes."""

    if isinstance(source, (dict, list)):
        data = deepcopy(source)
    elif isinstance(source, Path):
        data = _parse_file(source)
    else:
        path = _path_like_source(source)
        if path is not None:
            data = _parse_file(path)
        else:
            data = _parse_text(source, suffix="")

    data = _normalize_pipeline_root(data)

    pipeline = data["pipeline"]
    if not isinstance(pipeline, list):
        raise ValueError("Pipeline definition key 'pipeline' or 'steps' must contain a list of steps.")

    cleaned_pipeline = _strip_comments(pipeline)
    _validate_portable_classes(cleaned_pipeline)

    random_state = data.get("random_state")
    if isinstance(random_state, bool):
        random_state = None
    if random_state is not None and not isinstance(random_state, int):
        raise TypeError("'random_state' must be an integer when provided.")

    return PipelineDefinition(
        name=str(data.get("name") or "pipeline"),
        description=str(data.get("description") or ""),
        random_state=random_state,
        pipeline=cleaned_pipeline,
    )


def portable_class_names(definition: PipelineDefinition | dict[str, Any] | list[Any]) -> list[str]:
    """Return class names used by a portable pipeline definition, preserving order."""

    if isinstance(definition, PipelineDefinition):
        root: Any = definition.pipeline
    elif isinstance(definition, dict) and "pipeline" in definition:
        root = definition["pipeline"]
    else:
        root = definition

    classes: list[str] = []
    _collect_classes(root, classes)
    return classes


def _parse_text(text: str, *, suffix: str) -> Any:
    if suffix == ".json":
        return json.loads(text)
    if suffix in {".yaml", ".yml"}:
        return yaml.safe_load(text)

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return yaml.safe_load(text)


def _parse_file(path: Path) -> Any:
    if not path.is_file():
        raise FileNotFoundError(f"Configuration file does not exist: {path}")
    return _parse_text(path.read_text(encoding="utf-8"), suffix=path.suffix.lower())


def _path_like_source(source: str) -> Path | None:
    if "\n" in source or "\r" in source:
        return None

    path = Path(source)
    if path.suffix.lower() in {".json", ".yaml", ".yml"}:
        return path
    if path.exists():
        return path
    return None


def _normalize_pipeline_root(data: Any) -> dict[str, Any]:
    if isinstance(data, list):
        return {"pipeline": data}

    if not isinstance(data, dict):
        raise TypeError("Pipeline definition must be a list or mapping with a 'pipeline'/'steps' key.")

    normalized = deepcopy(data)
    if "pipeline" not in normalized:
        if "steps" not in normalized:
            raise ValueError(
                "Invalid pipeline definition format. Expected a list or a mapping "
                "with a 'pipeline' or 'steps' key."
            )
        normalized["pipeline"] = normalized["steps"]
    return normalized


def _strip_comments(value: Any) -> Any:
    if isinstance(value, list):
        return [_strip_comments(item) for item in value if not _is_comment_step(item)]
    if isinstance(value, dict):
        return {
            key: _strip_comments(item)
            for key, item in value.items()
            if key != "_comment"
        }
    return value


def _is_comment_step(value: Any) -> bool:
    return isinstance(value, dict) and set(value) == {"_comment"}


def _validate_portable_classes(value: Any) -> None:
    classes = portable_class_names(value)
    unsupported = [name for name in classes if name not in PORTABLE_OPERATOR_CLASSES]
    if unsupported:
        raise ValueError(
            "Pipeline uses operators outside the current nirs4all-core portable subset: "
            + ", ".join(dict.fromkeys(unsupported))
        )


def _collect_classes(value: Any, output: list[str]) -> None:
    if isinstance(value, list):
        for item in value:
            _collect_classes(item, output)
        return

    if isinstance(value, dict):
        class_name = value.get("class")
        if isinstance(class_name, str):
            output.append(class_name)
        for item in value.values():
            _collect_classes(item, output)
