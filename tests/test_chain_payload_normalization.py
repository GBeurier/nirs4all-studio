"""
Regression tests for AGG-02: _normalize_chain_payload operator precedence.

The guard `key in {"class","function"} or key in {"model","y_processing"} and
isinstance(value, str)` parsed as `class/function` OR `(model/y_processing AND str)`,
so a 'class'/'function' key holding a *nested* config dict skipped recursion and
left inner legacy references un-normalized. The fix parenthesizes the membership
test before the isinstance check.

Run with: pytest tests/test_chain_payload_normalization.py -v
"""

from __future__ import annotations

import sys
from pathlib import Path

# Ensure webapp root is importable
sys.path.insert(0, str(Path(__file__).parent.parent))

# `api.aggregated_predictions` has a module-load-order dependency (lazy_imports <->
# shared); importing `main` first fully initializes that chain so this file is safe
# to run in isolation (e.g. on a single pytest-xdist worker). Import order is load-
# bearing here, so isort must not reorder this block.
import main  # noqa: F401, E402, I001
from api.aggregated_predictions import _normalize_chain_payload  # noqa: E402, I001


def test_normalizes_string_class_reference() -> None:
    payload = {"class": "xgboost.sklearn.XGBRegressor"}
    assert _normalize_chain_payload(payload) == {"class": "xgboost.XGBRegressor"}


def test_normalizes_legacy_reference_nested_under_class_dict() -> None:
    # The regression: a 'class' key holding a nested config dict must still have
    # its inner legacy reference normalized.
    payload = {
        "class": {
            "class": "lightgbm.sklearn.LGBMRegressor",
            "params": {"n_estimators": 100},
        }
    }
    result = _normalize_chain_payload(payload)
    assert result["class"]["class"] == "lightgbm.LGBMRegressor"
    assert result["class"]["params"] == {"n_estimators": 100}


def test_normalizes_model_string_reference() -> None:
    payload = {"model": "xgboost.sklearn.XGBClassifier"}
    assert _normalize_chain_payload(payload) == {"model": "xgboost.XGBClassifier"}


def test_recurses_into_lists_and_nested_payloads() -> None:
    payload = {
        "pipeline": [
            {"class": "lightgbm.sklearn.LGBMClassifier"},
            {"model": "xgboost.sklearn.XGBRegressor"},
        ]
    }
    result = _normalize_chain_payload(payload)
    assert result["pipeline"][0]["class"] == "lightgbm.LGBMClassifier"
    assert result["pipeline"][1]["model"] == "xgboost.XGBRegressor"
