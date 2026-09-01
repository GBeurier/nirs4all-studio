# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Versioned, machine-validatable JSON Schema for DatasetSpec (D3, story 5.1).

The dataclass IR + :func:`validate_spec` are the runtime authority; this JSON
Schema is the **portable wire contract** (shared verbatim with the Rust core,
cross-language gate 6.4). It enforces the closed vocabularies and the
source/join structure; it is lenient about extra keys (the IR ignores unknowns).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_ROLE = ["features", "targets", "metadata", "weights", "ignore", "mixed"]
_SELECTOR = {"oneOf": [{"type": "integer"}, {"type": "string"}, {"type": "array"}, {"type": "object"}]}

DATASET_SPEC_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://github.com/GBeurier/nirs4all-io/schema/dataset_spec/v1",
    "title": "DatasetSpec",
    "type": "object",
    "properties": {
        "schema_version": {"const": 1},
        "name": {"type": "string"},
        "description": {"type": "string"},
        "task_type": {"enum": ["auto", "regression", "binary", "multiclass"]},
        "signal_type": {"enum": ["auto", "absorbance", "reflectance", "reflectance%", "transmittance", "transmittance%", "log(1/R)", "kubelka-munk"]},
        "conventions": {"type": "array", "items": {"type": "string"}},
        "sample_index": {
            "type": "object",
            "properties": {
                "by": {"enum": ["row", "id"]},
                "key": {"oneOf": [{"type": "string"}, {"type": "array"}]},
                "observation_id": {"type": "string"},
                "repetition_id": {"type": "string"},
                "group_id": {"type": "string"},
                "derive": {"type": "object", "properties": {"from": {"type": "string"}, "strip_suffix": {"type": "string"}}},
            },
        },
        "sources": {"type": "array", "minItems": 1, "items": {"$ref": "#/$defs/source"}},
        "partitions": {"$ref": "#/$defs/partitions"},
        "folds": {"$ref": "#/$defs/folds"},
        "aggregate": {"type": "object", "properties": {"by": {"type": "string"}, "method": {"enum": ["mean", "median", "vote", "robust_mean"]}, "exclude_outliers": {"type": "boolean"}, "outlier_threshold": {"type": "number"}}},
        "repetition": {"type": "string"},
        "params": {"$ref": "#/$defs/params"},
        "validation": {"type": "object"},
    },
    "required": ["sources"],
    "$defs": {
        "source": {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "role": {"enum": _ROLE},
                "kind": {"enum": ["table", "lookup"]},
                "modality": {"enum": ["spectroscopy", "markers", "metadata", "image"]},
                "input": {},
                "merge": {"enum": ["concat_samples", "concat_features", "by_key", "none"]},
                "partition": {"enum": ["train", "test", "val", "predict", "auto"]},
                "key": {"oneOf": [{"type": "string"}, {"type": "array"}]},
                "strict_columns": {"type": "boolean"},
                "columns": {"oneOf": [{"type": "array", "items": {"type": "object", "properties": {"role": {"enum": _ROLE}, "select": _SELECTOR}, "required": ["role", "select"]}}, {"type": "object"}]},
                "join": {"$ref": "#/$defs/join"},
                "params": {"$ref": "#/$defs/params"},
                "variations": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {"name": {"type": "string"}, "input": {}, "params": {"$ref": "#/$defs/params"}},
                        "required": ["name", "input"],
                    },
                },
            },
            "required": ["id"],
        },
        "join": {
            "type": "object",
            "properties": {
                "to": {"type": "string"}, "left": {"type": "string"}, "right": {"type": "string"},
                "on": {"oneOf": [{"type": "string"}, {"type": "array"}]},
                "left_on": {"oneOf": [{"type": "string"}, {"type": "array"}]},
                "right_on": {"oneOf": [{"type": "string"}, {"type": "array"}]},
                "how": {"enum": ["1:1", "m:1", "1:m"]},
                "cardinality": {"enum": ["1:1", "m:1", "1:m"]},
                "coverage": {"enum": ["complete", "warn", "drop", "error"]},
            },
        },
        "partitions": {
            "type": "object",
            "properties": {
                "by": {"enum": ["files", "column", "index", "index_file"]},
                "column": {"type": "string"},
                "train_values": {"type": "array"}, "test_values": {"type": "array"}, "predict_values": {"type": "array"},
                "unknown_policy": {"enum": ["train", "test", "drop", "error"]},
                "train": {}, "test": {}, "predict": {},
                "train_file": {"type": "string"}, "test_file": {"type": "string"}, "predict_file": {"type": "string"},
            },
        },
        "folds": {"type": "object", "properties": {"inline": {"type": "array"}, "file": {"type": "string"}, "format": {"enum": ["auto", "csv", "json", "yaml", "txt"]}, "column": {"type": "string"}}},
        "params": {
            "type": "object",
            "properties": {
                "delimiter": {"type": "string"}, "decimal_separator": {"type": "string"}, "has_header": {"type": "boolean"},
                "header_unit": {"enum": ["nm", "cm-1", "none", "text", "index"]},
                "signal_type": {"type": "string"}, "encoding": {"type": "string"},
                "categorical": {"enum": ["auto", "preserve", "none"]},
                "na": {"type": "object"}, "format": {"type": "object"},
            },
        },
    },
}


def json_schema() -> dict[str, Any]:
    """Return the versioned DatasetSpec JSON Schema (draft 2020-12)."""
    return DATASET_SPEC_SCHEMA


def validate_against_schema(spec_dict: dict) -> None:
    """Validate a spec dict against the JSON Schema. Raises jsonschema.ValidationError."""
    import jsonschema

    jsonschema.validate(instance=spec_dict, schema=DATASET_SPEC_SCHEMA)


def write_schema(path: str | Path) -> None:
    Path(path).write_text(json.dumps(DATASET_SPEC_SCHEMA, indent=2) + "\n", encoding="utf-8")
