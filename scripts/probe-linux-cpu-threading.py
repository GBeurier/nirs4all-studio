"""Scientific CPU probe run by verify-linux-cpu-closure.py in a clean namespace."""

import ctypes
import json
import os
import sys

sys.path.insert(0, sys.argv[1])
import numba
import numpy as np

result = {"numba_version": numba.__version__, "requested_layer": numba.config.THREADING_LAYER, "priority": numba.config.THREADING_LAYER_PRIORITY, "system_libraries": {}}
for name in ["libtbb.so.12", "libgomp.so.1", "libgomp.so.1.0.0"]:
    try:
        ctypes.CDLL(name)
        result["system_libraries"][name] = "loaded"
    except OSError as e:
        result["system_libraries"][name] = str(e)
assert all(v != "loaded" for v in result["system_libraries"].values()), result
if sys.argv[2] == "shap":
    import shap
    from sklearn.ensemble import RandomForestRegressor
    from sklearn.linear_model import LinearRegression

    x = np.random.default_rng(42).normal(size=(24, 4))
    y = x @ np.array([1.0, 2.0, -1.0, 0.5])
    linear = LinearRegression().fit(x, y)
    for name, explainer, predict in [("linear", shap.LinearExplainer(linear, x), linear.predict), ("kernel", shap.KernelExplainer(linear.predict, x[:8]), linear.predict)]:
        values = explainer.shap_values(x[:3])
        error = float(np.max(np.abs(np.sum(values, axis=1) + explainer.expected_value - predict(x[:3]))))
        assert error < 1e-6
        result[name + "_additivity_error"] = error
    forest = RandomForestRegressor(n_estimators=4, random_state=42).fit(x, y)
    ex = shap.TreeExplainer(forest)
    values = ex.shap_values(x[:3])
    error = float(np.max(np.abs(np.sum(values, axis=1) + ex.expected_value - forest.predict(x[:3]))))
    assert error < 1e-6
    result["tree_additivity_error"] = error
    try:
        result["selected_layer"] = numba.threading_layer()
    except ValueError:
        result["selected_layer"] = "not initialized (no parallel execution)"
else:

    @numba.njit(parallel=True)
    def total_squares(x):
        value = 0.0
        for i in numba.prange(x.size):
            value += x[i] * x[i]
        return value

    x = np.arange(10000, dtype=np.float64)
    try:
        result["sum_squares"] = total_squares(x)
        assert result["sum_squares"] == float(x @ x)
        result["selected_layer"] = numba.threading_layer()
        result["success"] = True
    except Exception as e:
        result["success"] = False
        result["error"] = str(e)
print(json.dumps(result, sort_keys=True))
