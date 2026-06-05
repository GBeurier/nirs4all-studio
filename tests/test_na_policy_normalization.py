"""Regression tests for na_policy handling.

Bug: webapp settings/datasets created by older builds stored ``na_policy`` values
like ``"drop"`` / ``"Drop"`` that nirs4all rejects with
``ValueError: Invalid na_policy: 'Drop'`` (its vocabulary is
{auto, abort, remove_sample, remove_feature, replace, ignore}). The adapter now
normalizes legacy/cased values at the boundary, and the default workspace
settings use a valid value.
"""

from api.nirs4all_adapter import _normalize_na_policy
from api.workspace_manager import workspace_manager

# nirs4all's accepted na_policy vocabulary (nirs4all/data/loaders/base.py).
VALID_NA_POLICIES = {"auto", "abort", "remove_sample", "remove_feature", "replace", "ignore"}


class TestNaPolicyNormalization:
    def test_legacy_drop_maps_to_remove_sample(self):
        assert _normalize_na_policy("drop") == "remove_sample"

    def test_legacy_drop_is_case_insensitive(self):
        # The reported bug used the capitalized "Drop".
        assert _normalize_na_policy("Drop") == "remove_sample"
        assert _normalize_na_policy("  DROP ") == "remove_sample"

    def test_legacy_keep_maps_to_ignore(self):
        assert _normalize_na_policy("keep") == "ignore"
        assert _normalize_na_policy("Keep") == "ignore"

    def test_valid_values_pass_through_lowercased(self):
        for policy in VALID_NA_POLICIES:
            assert _normalize_na_policy(policy) == policy
            assert _normalize_na_policy(policy.upper()) == policy

    def test_none_and_non_string_pass_through(self):
        assert _normalize_na_policy(None) is None
        assert _normalize_na_policy(123) == 123

    def test_every_normalized_legacy_value_is_valid_for_nirs4all(self):
        for legacy in ("drop", "Drop", "keep", "Keep"):
            assert _normalize_na_policy(legacy) in VALID_NA_POLICIES


class TestDefaultWorkspaceSettings:
    def test_default_na_policy_is_valid(self):
        defaults = workspace_manager._default_workspace_settings()
        na_policy = defaults["data_loading_defaults"]["na_policy"]
        assert na_policy in VALID_NA_POLICIES, f"default na_policy {na_policy!r} is not a valid nirs4all policy"
