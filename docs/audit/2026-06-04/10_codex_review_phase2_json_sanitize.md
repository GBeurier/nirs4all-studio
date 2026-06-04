Found 2 real issues:

- [api/workspace.py:2095](/home/delete/nirs4all/nirs4all-studio/api/workspace.py:2095): response-shape regression for `np.ndarray(dtype=object)` containing `np.float32/np.float16` NaN/Inf. Old encoder’s `default()` returned `None` for those `np.floating` values after `ndarray.tolist()`. New code returns `float(obj)`, so JSON emits `NaN`/`Infinity`.

- [api/shared/json_sanitize.py:35](/home/delete/nirs4all/nirs4all-studio/api/shared/json_sanitize.py:35): `sanitize_float()` runs `math.isnan/isinf` on all `numbers.Real`, including Python `int`. Very large ints, which JSON can otherwise serialize, now raise `OverflowError` instead of passing through unchanged.

No other broken imports, duplicate sanitizer definitions, or removed referenced symbols found.