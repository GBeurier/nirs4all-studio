"""Result timestamps and nested arrays survive strict stdio JSON encoding."""
import json
from datetime import UTC, datetime, timezone

from api.shared.json_safe import sanitize_dict


def test_result_timestamps_and_nested_non_finite_arrays():
    original = {"created_at": datetime(2026, 9, 19, tzinfo=UTC),
                "spectra": [[1., float("nan")], [float("inf"), 2.]],
                "scores": {"val": {"rmse": float("nan")}}}
    result = sanitize_dict(original)
    assert result["created_at"] == "2026-09-19T00:00:00+00:00"
    assert result["spectra"] == [[1., None], [None, 2.]]
    assert result["scores"] == {"val": {"rmse": None}}
    assert isinstance(original["created_at"], datetime)
    json.dumps(result, allow_nan=False)
