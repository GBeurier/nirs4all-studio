"""Normalize ``na_policy`` values to nirs4all's vocabulary at the webapp boundary.

nirs4all accepts ``na_policy`` in {auto, abort, remove_sample, remove_feature,
replace, ignore} (case-sensitive). Older webapp builds stored ``"drop"``/``"keep"``
(sometimes capitalized), which nirs4all rejects with "Invalid na_policy". These
helpers translate legacy/cased values to the library vocabulary so already-saved
workspaces and datasets keep working.
"""

from __future__ import annotations

from typing import Any

_LEGACY_NA_POLICY_ALIASES = {
    "drop": "remove_sample",  # legacy "drop rows with NaN"
    "keep": "ignore",         # legacy "leave NaN as-is"
}


def normalize_na_policy(na_policy: Any) -> Any:
    """Translate a single legacy/cased na_policy value to nirs4all's vocabulary."""
    if not isinstance(na_policy, str):
        return na_policy
    normalized = na_policy.strip().lower()
    return _LEGACY_NA_POLICY_ALIASES.get(normalized, normalized)


def normalize_na_policy_in_config(config: dict) -> None:
    """Normalize any na_policy in a nirs4all dataset-config dict, in place.

    Covers every shape nirs4all treats as loader params: a root-level
    ``na_policy``, ``global_params``, and each per-file ``*_params`` block —
    where a block may be a single dict or a list of dicts (multi-source). So a
    legacy na_policy from any source (global default, per-file or per-source
    override) is translated before the dict is handed to ``DatasetConfigs``.
    """
    if not isinstance(config, dict):
        return
    # Root-level na_policy (some merged dataset_config.json shapes).
    if "na_policy" in config:
        config["na_policy"] = normalize_na_policy(config["na_policy"])
    for key, value in config.items():
        if key != "global_params" and not key.endswith("_params"):
            continue
        # A params block can be a single dict or a list of dicts (multi-source).
        blocks = value if isinstance(value, list) else [value]
        for block in blocks:
            if isinstance(block, dict) and "na_policy" in block:
                block["na_policy"] = normalize_na_policy(block["na_policy"])
