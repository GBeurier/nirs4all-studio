"""Tests for the shared JSON NaN/Inf sanitization helpers.

These cover the single consolidated implementation in
``api.shared.json_sanitize`` that replaced the per-router copies.
"""

import math

import numpy as np

from api.shared.json_sanitize import sanitize_float, sanitize_json


class TestSanitizeFloat:
    def test_nan_becomes_none(self):
        assert sanitize_float(float("nan")) is None

    def test_inf_becomes_none(self):
        assert sanitize_float(float("inf")) is None
        assert sanitize_float(float("-inf")) is None

    def test_finite_float_unchanged(self):
        assert sanitize_float(3.14) == 3.14

    def test_int_preserved_not_coerced_to_float(self):
        result = sanitize_float(5)
        assert result == 5
        assert isinstance(result, int)
        assert not isinstance(result, float)

    def test_numpy_nan_becomes_none(self):
        assert sanitize_float(np.nan) is None
        assert sanitize_float(np.float64("nan")) is None

    def test_numpy_inf_becomes_none(self):
        assert sanitize_float(np.float64("inf")) is None
        assert sanitize_float(np.float64("-inf")) is None

    def test_finite_numpy_float_unchanged(self):
        assert sanitize_float(np.float64(2.5)) == 2.5

    def test_none_passthrough(self):
        assert sanitize_float(None) is None

    def test_string_passthrough(self):
        assert sanitize_float("hello") == "hello"

    def test_bool_passthrough(self):
        # bools are not floats and must never be coerced to None.
        assert sanitize_float(True) is True
        assert sanitize_float(False) is False


class TestSanitizeJson:
    def test_nested_dict_and_list_structure_preserved(self):
        data = {
            "score": float("nan"),
            "nested": {"val": float("inf"), "ok": 1.0, "name": "model"},
            "list_field": [1.0, float("nan"), 3.0],
            "count": 7,
        }
        result = sanitize_json(data)
        assert result == {
            "score": None,
            "nested": {"val": None, "ok": 1.0, "name": "model"},
            "list_field": [1.0, None, 3.0],
            "count": 7,
        }
        # int stays int (response shape: numbers stay numbers).
        assert isinstance(result["count"], int)

    def test_list_of_lists_recursion(self):
        result = sanitize_json([[1.0, float("nan")], [float("-inf"), 2.0]])
        assert result == [[1.0, None], [None, 2.0]]

    def test_tuple_becomes_list(self):
        result = sanitize_json((1.0, float("nan"), 3))
        assert result == [1.0, None, 3]
        assert isinstance(result, list)

    def test_numpy_floats_in_structure(self):
        data = {"a": np.float64("nan"), "b": np.float64(1.5)}
        assert sanitize_json(data) == {"a": None, "b": 1.5}

    def test_non_float_values_passthrough(self):
        data = {"name": "pls", "ok": True, "n": 3, "tags": ["a", "b"]}
        assert sanitize_json(data) == data

    def test_scalar_passthrough(self):
        assert sanitize_json(42) == 42
        assert sanitize_json("x") == "x"
        assert sanitize_json(math.nan) is None


class TestRegressionGuards:
    def test_huge_int_does_not_overflow(self):
        # math.isnan/isinf raise OverflowError on very large Python ints; ints
        # must be excluded from the float check and pass through unchanged.
        big = 10 ** 400
        assert sanitize_float(big) == big
        assert sanitize_json({"n": big}) == {"n": big}

    def test_numpy_float_nan_inf_become_none(self):
        assert sanitize_float(np.float32("nan")) is None
        assert sanitize_float(np.float64("inf")) is None
        assert sanitize_float(np.float32(1.5)) == np.float32(1.5)
