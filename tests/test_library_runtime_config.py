"""Configuration inspection must not mutate or inspect another interpreter."""

import sys
from types import SimpleNamespace

import pytest

from api.library_runtime_config import compare_configuration


def test_pep440_minimums_renames_and_optional_visibility(monkeypatch):
    monkeypatch.setattr("importlib.metadata.distributions", lambda: [
        SimpleNamespace(metadata={"Name": name}, version=version)
        for name, version in [("nirs4all", "1.0.1"), ("xgboost-cpu", "3.0.0"), ("shap", "0.40")]
    ])
    config = {"profiles": {"cpu-lite": {"label": "Lite", "platforms": [sys.platform],
              "packages": {"nirs4all": {"min": ">=1.0.0", "recommended": "1.0.0"}, "xgboost": ">=3", "missing": ">=2"},
              "package_renames": {"xgboost": "xgboost-cpu"}}},
              "optional": {"shap": {"min": ">=0.44"}, "absent": {"min": ">=1"}}}
    result = compare_configuration({"config": config, "profile": "cpu-lite", "include_optional": True, "include_latest": True})
    assert (result["aligned_count"], result["misaligned_count"], result["missing_count"]) == (2, 1, 1)
    assert not result["is_aligned"]
    assert not result["latest_lookup_performed"]
    assert [row["name"] for row in result["packages"]] == ["nirs4all", "xgboost", "missing", "shap"]


def test_unknown_and_incompatible_profiles_are_not_silently_selected():
    config = {"profiles": {"other-os": {"platforms": ["not-this-platform"]}}}
    for profile in ["missing", "other-os"]:
        with pytest.raises(ValueError, match="profile"):
            compare_configuration({"config": config, "profile": profile})
