import sys
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from api.system import system_keyword_registry


def _keyword_registry_payload() -> dict:
    return {
        "entries": [
            {
                "aliases": [],
                "canonical_term": "native_tuning",
                "changes": ["tuning_result"],
                "docs_anchor": "native-tuning",
                "engine_support": {"dag-ml": "partial", "legacy": "unsupported"},
                "id": "run.tuning",
                "invalidates_calibration": "if_predictor_changes",
                "lifecycle_stage": "tuning",
                "path": "run.tuning",
                "reads": ["pipeline", "score_data"],
                "scope": "pipeline_execution",
                "status": "partial",
                "summary": "Runs native optimizer selection before final calibration.",
                "surface": "run_argument",
                "token": "tuning",
                "ui": {"control": "object", "group": "tuning", "label": "Native tuning", "order": 100},
                "value_schema": {"type": "object"},
            }
        ],
        "registry_version": "1.0.0",
        "schema_id": "https://nirs4all.org/schemas/keyword-effects/v1",
        "schema_version": 1,
        "scope": "lifecycle-v1",
    }


@pytest.mark.asyncio
async def test_system_keyword_registry_delegates_to_public_nirs4all_api(monkeypatch):
    payload = _keyword_registry_payload()
    monkeypatch.setitem(
        sys.modules,
        "nirs4all",
        SimpleNamespace(get_keyword_registry=lambda: payload),
    )

    assert await system_keyword_registry() == payload


@pytest.mark.asyncio
async def test_system_keyword_registry_fails_closed_when_api_is_missing(monkeypatch):
    monkeypatch.setitem(sys.modules, "nirs4all", SimpleNamespace())

    with pytest.raises(HTTPException) as exc_info:
        await system_keyword_registry()

    assert exc_info.value.status_code == 503
    assert "get_keyword_registry" in exc_info.value.detail
