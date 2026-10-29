"""Normalize target-processing editor values without computing target transforms."""

from __future__ import annotations

import json
import math
import re
from typing import Any


def normalize_y_processing_params(name: str, values: dict[str, Any]) -> dict[str, Any]:
    """Return parameters accepted by the scientific library, rejecting bad edges."""
    params = dict(values)
    if name == "MinMaxScaler" and ("feature_range_min" in params or "feature_range_max" in params):
        params["feature_range"] = [params.pop("feature_range_min", 0), params.pop("feature_range_max", 1)]
    if name == "RangeDiscretizer" and ("bins" in params or "ranges" in params):
        bins = params.get("bins", params.get("ranges"))
        params.pop("ranges", None)
        if isinstance(bins, str):
            value = bins.strip()
            try:
                if re.fullmatch(r"[1-9][0-9]*", value):
                    bins = int(value)
                elif value.startswith("["):
                    bins = json.loads(value)
                else:
                    bins = [float(part.strip()) for part in value.split(",")]
            except (ValueError, TypeError) as error:
                raise ValueError("Custom bin boundaries must be an increasing list of finite numbers.") from error
        if isinstance(bins, (int, float)) and not isinstance(bins, bool):
            if not math.isfinite(bins) or int(bins) != bins or not 1 <= bins <= 2**53 - 1:
                raise ValueError("The number of bins must be a positive integer.")
            bins = int(bins)
        elif not isinstance(bins, (list, tuple)) or not bins or any(
            isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
            or (index > 0 and value <= bins[index - 1])
            for index, value in enumerate(bins)
        ):
            raise ValueError("Custom bin boundaries must be an increasing list of finite numbers.")
        params["bins"] = bins
    return params
