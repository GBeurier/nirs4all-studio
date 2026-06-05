"""Regression tests for na_policy handling.

Bug: webapp settings/datasets created by older builds stored ``na_policy`` values
like ``"drop"`` / ``"Drop"`` that nirs4all rejects with
``ValueError: Invalid na_policy: 'Drop'`` (its vocabulary is
{auto, abort, remove_sample, remove_feature, replace, ignore}). The webapp now
normalizes legacy/cased values to nirs4all's vocabulary at every
``DatasetConfigs`` boundary, and the default workspace settings use a valid value.
"""

from api.shared.na_policy import normalize_na_policy, normalize_na_policy_in_config
from api.workspace_manager import workspace_manager

# nirs4all's accepted na_policy vocabulary (nirs4all/data/loaders/base.py).
VALID_NA_POLICIES = {"auto", "abort", "remove_sample", "remove_feature", "replace", "ignore"}


class TestNormalizeNaPolicy:
    def test_legacy_drop_maps_to_remove_sample(self):
        assert normalize_na_policy("drop") == "remove_sample"

    def test_legacy_drop_is_case_insensitive(self):
        # The reported bug used the capitalized "Drop".
        assert normalize_na_policy("Drop") == "remove_sample"
        assert normalize_na_policy("  DROP ") == "remove_sample"

    def test_legacy_keep_maps_to_ignore(self):
        assert normalize_na_policy("keep") == "ignore"
        assert normalize_na_policy("Keep") == "ignore"

    def test_valid_values_pass_through_lowercased(self):
        for policy in VALID_NA_POLICIES:
            assert normalize_na_policy(policy) == policy
            assert normalize_na_policy(policy.upper()) == policy

    def test_none_and_non_string_pass_through(self):
        assert normalize_na_policy(None) is None
        assert normalize_na_policy(123) == 123

    def test_every_normalized_legacy_value_is_valid_for_nirs4all(self):
        for legacy in ("drop", "Drop", "keep", "Keep"):
            assert normalize_na_policy(legacy) in VALID_NA_POLICIES


class TestNormalizeNaPolicyInConfig:
    def test_normalizes_global_params_and_every_file_params(self):
        config = {
            "global_params": {"delimiter": ";", "na_policy": "Drop"},
            "train_x": "a.csv",
            "train_x_params": {"header_unit": "nm", "na_policy": "keep"},
            "test_y_params": {"na_policy": "REMOVE_SAMPLE"},
        }
        normalize_na_policy_in_config(config)
        assert config["global_params"]["na_policy"] == "remove_sample"
        assert config["train_x_params"]["na_policy"] == "ignore"
        assert config["test_y_params"]["na_policy"] == "remove_sample"
        # Non-na_policy keys untouched.
        assert config["global_params"]["delimiter"] == ";"
        assert config["train_x_params"]["header_unit"] == "nm"

    def test_normalizes_root_level_and_list_valued_params(self):
        config = {
            "na_policy": "Drop",  # root-level (merged dataset_config.json shape)
            "train_x_params": [  # multi-source: list of per-source param dicts
                {"na_policy": "keep"},
                {"header_unit": "nm"},
            ],
        }
        normalize_na_policy_in_config(config)
        assert config["na_policy"] == "remove_sample"
        assert config["train_x_params"][0]["na_policy"] == "ignore"
        assert config["train_x_params"][1] == {"header_unit": "nm"}

    def test_no_na_policy_keys_is_a_noop(self):
        config = {"global_params": {"delimiter": ","}, "train_x": "a.csv"}
        normalize_na_policy_in_config(config)
        assert config == {"global_params": {"delimiter": ","}, "train_x": "a.csv"}

    def test_non_dict_is_ignored(self):
        normalize_na_policy_in_config(None)  # must not raise


class TestDefaultWorkspaceSettings:
    def test_default_na_policy_is_valid(self):
        defaults = workspace_manager._default_workspace_settings()
        na_policy = defaults["data_loading_defaults"]["na_policy"]
        assert na_policy in VALID_NA_POLICIES, f"default na_policy {na_policy!r} is not a valid nirs4all policy"
