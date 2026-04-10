#!/usr/bin/env python3
"""Pipeline round-trip contract tests.

Phase 0 replaces the old simulated "frontend" round-trip checks with tests
that use the real library semantic contract:

    PipelineConfigs(filter_comments(source)).original_template

This preserves generator templates instead of comparing only the first
expanded configuration.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from fastapi.exceptions import HTTPException

from api.pipelines import (
    _filter_comments,
    _get_canonical_pipeline,
    _get_samples_dir,
    _load_sample_file,
    _semantic_pipeline_template,
    get_pipeline_sample,
    list_pipeline_samples,
)

try:
    _SAMPLES_DIR = _get_samples_dir()
    # Verify the semantic contract helper can construct the library config.
    _semantic_pipeline_template(
        ["sklearn.preprocessing._data.StandardScaler"],
        name="probe",
    )
    _SAMPLES_AVAILABLE = True
except (HTTPException, ImportError, ModuleNotFoundError):
    _SAMPLES_AVAILABLE = False
    _SAMPLES_DIR = None

pytestmark = pytest.mark.skipif(
    not _SAMPLES_AVAILABLE,
    reason="Pipeline samples directory or nirs4all library not available",
)

SAMPLE_IDS = [
    "01_basic_regression",
    "02_feature_augmentation",
    "03_sample_augmentation",
    "04_branching_basic",
    "05_stacking_merge",
    "06_generator_syntax",
    "07_concat_transform",
    "08_complex_finetune",
    "09_filters_splits",
    "10_complete_all_features",
]


def _sample_path(sample_id: str) -> Path:
    assert _SAMPLES_DIR is not None
    for ext in (".json", ".yaml", ".yml"):
        candidate = _SAMPLES_DIR / f"{sample_id}{ext}"
        if candidate.exists():
            return candidate
    raise FileNotFoundError(sample_id)


class TestPipelineSamplesAPI:
    def test_list_samples(self):
        result = asyncio.run(list_pipeline_samples())

        assert "samples" in result
        assert "total" in result
        assert result["total"] == 10

        sample_ids = [sample["id"] for sample in result["samples"]]
        assert sorted(sample_ids) == sorted(SAMPLE_IDS)

    @pytest.mark.parametrize("sample_id", SAMPLE_IDS)
    def test_canonical_sample_endpoint_returns_pipeline(self, sample_id: str):
        result = asyncio.run(get_pipeline_sample(sample_id, canonical=True))

        assert "pipeline" in result
        assert "name" in result
        assert isinstance(result["pipeline"], list)
        assert len(result["pipeline"]) > 0


class TestSemanticHelpers:
    def test_filter_comments_is_recursive(self):
        payload = [
            {"_comment": "top-level"},
            {
                "_or_": [
                    {"_comment": "drop-me"},
                    {"class": "sklearn.preprocessing._data.StandardScaler"},
                ],
                "_comment": "generator-note",
            },
            {
                "branch": [
                    [
                        {"_comment": "nested"},
                        {
                            "model": {
                                "class": "sklearn.cross_decomposition._pls.PLSRegression"
                            },
                            "_comment": "metadata",
                        },
                    ]
                ]
            },
        ]

        assert _filter_comments(payload) == [
            {"_or_": [{"class": "sklearn.preprocessing._data.StandardScaler"}]},
            {
                "branch": [
                    [
                        {
                            "model": {
                                "class": "sklearn.cross_decomposition._pls.PLSRegression"
                            }
                        }
                    ]
                ]
            },
        ]

    def test_semantic_template_ignores_comment_metadata(self):
        with_comments = [
            {"_comment": "pipeline note"},
            {
                "model": {
                    "class": "sklearn.cross_decomposition._pls.PLSRegression"
                },
                "_comment": "step note",
            },
        ]
        without_comments = [
            {
                "model": {
                    "class": "sklearn.cross_decomposition._pls.PLSRegression"
                }
            }
        ]

        assert _semantic_pipeline_template(with_comments, name="demo") == _semantic_pipeline_template(
            without_comments,
            name="demo",
        )

    def test_semantic_template_preserves_generator_template(self):
        data = _load_sample_file(_sample_path("06_generator_syntax"))
        template = _semantic_pipeline_template(
            data["pipeline"],
            name=data.get("name", ""),
            description=data.get("description", ""),
        )

        assert any(isinstance(step, dict) and "_or_" in step for step in template)
        assert any(isinstance(step, dict) and "_range_" in step for step in template)
        assert any(isinstance(step, dict) and "_log_range_" in step for step in template)
        assert any(isinstance(step, dict) and "_grid_" in step for step in template)


class TestCanonicalSampleLoading:
    def test_canonical_pipeline_endpoint_uses_original_template(self):
        filepath = _sample_path("06_generator_syntax")
        raw = _load_sample_file(filepath)
        expected = _semantic_pipeline_template(
            raw["pipeline"],
            name=raw.get("name", ""),
            description=raw.get("description", ""),
        )

        result = asyncio.run(get_pipeline_sample("06_generator_syntax", canonical=True))

        assert result["pipeline"] == expected
        assert result["num_configurations"] > 1
        assert result["has_generators"] is True

    def test_internal_canonical_loader_matches_semantic_helper(self):
        filepath = _sample_path("09_filters_splits")
        raw = _load_sample_file(filepath)
        expected = _semantic_pipeline_template(
            raw["pipeline"],
            name=raw.get("name", ""),
            description=raw.get("description", ""),
        )

        result = _get_canonical_pipeline(filepath)

        assert result["pipeline"] == expected
