# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""The DatasetSpec JSON Schema (portable wire contract) accepts valid specs,
rejects malformed ones, and stays in sync with the committed schema.json."""

from __future__ import annotations

import json
from pathlib import Path

import jsonschema
import pytest
from test_cookbook import _cases  # reuse the cookbook spec corpus

from nirs4all_io.spec import DatasetSpec, json_schema, validate_against_schema

_SCHEMA_FILE = Path(__file__).resolve().parent.parent / "src" / "nirs4all_io" / "spec" / "dataset_spec.schema.json"


@pytest.mark.parametrize("case", _cases(), ids=lambda c: c[0])
def test_cookbook_specs_pass_json_schema(case):
    _id, _files, spec_dict = case
    # add the schema_version a serialized spec would carry
    validate_against_schema(DatasetSpec.from_dict(spec_dict).to_dict())


def test_schema_rejects_bad_enum():
    with pytest.raises(jsonschema.ValidationError):
        validate_against_schema({"sources": [{"id": "x", "role": "NONSENSE", "input": "x.csv"}]})


def test_schema_rejects_bad_cardinality():
    with pytest.raises(jsonschema.ValidationError):
        validate_against_schema({"sources": [{"id": "x", "role": "features", "input": "x.csv", "join": {"to": "y", "how": "many-to-one"}}]})


def test_schema_requires_sources():
    with pytest.raises(jsonschema.ValidationError):
        validate_against_schema({"name": "x"})


def test_committed_schema_matches_code():
    assert json.loads(_SCHEMA_FILE.read_text(encoding="utf-8")) == json_schema(), "regenerate with spec.json_schema.write_schema()"
