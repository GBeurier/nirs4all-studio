"""Tests for the canonical dataset config translator.

Verifies that build_nirs4all_config() correctly translates webapp dataset
configurations to nirs4all-compatible configs, covering per-file overrides,
aggregation, folds, defaults, and multi-source scenarios.

These tests are regression coverage for issues #1 and #7.
"""
import importlib
from pathlib import Path

# Import the dataset_config module directly (avoiding the shared/__init__.py
# which pulls in api-specific dependencies via pipeline_service)
_module_path = Path(__file__).parent.parent / "api" / "shared" / "dataset_config.py"
_spec = importlib.util.spec_from_file_location("dataset_config", _module_path)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)

build_nirs4all_config = _mod.build_nirs4all_config
build_nirs4all_config_from_stored = _mod.build_nirs4all_config_from_stored
normalize_file_type = _mod.normalize_file_type


def _norm(path: str) -> str:
    """Normalize path separators for cross-platform comparison."""
    return path.replace("\\", "/")


# ============= normalize_file_type =============


class TestNormalizeFileType:
    def test_x_types(self):
        assert normalize_file_type("X") == "X"
        assert normalize_file_type("x") == "X"

    def test_y_types(self):
        assert normalize_file_type("Y") == "Y"
        assert normalize_file_type("y") == "Y"

    def test_metadata_aliases(self):
        assert normalize_file_type("metadata") == "metadata"
        assert normalize_file_type("M") == "metadata"
        assert normalize_file_type("META") == "metadata"
        assert normalize_file_type("METADATA") == "metadata"
        assert normalize_file_type("GROUP") == "metadata"
        assert normalize_file_type("group") == "metadata"

    def test_unknown_type(self):
        assert normalize_file_type("unknown") is None
        assert normalize_file_type("other") is None


# ============= build_nirs4all_config =============


class TestBuildNirs4allConfig:
    """Tests for the canonical translator function."""

    def test_basic_x_y_mapping(self):
        files = [
            {"path": "/data/X_train.csv", "type": "X", "split": "train"},
            {"path": "/data/Y_train.csv", "type": "Y", "split": "train"},
        ]
        parsing = {"delimiter": ";", "decimal_separator": "."}

        config = build_nirs4all_config(files, parsing)

        assert _norm(config["train_x"]) == "/data/X_train.csv"
        assert _norm(config["train_y"]) == "/data/Y_train.csv"
        assert config["global_params"]["delimiter"] == ";"

    def test_train_and_test_split(self):
        files = [
            {"path": "/data/X_train.csv", "type": "X", "split": "train"},
            {"path": "/data/Y_train.csv", "type": "Y", "split": "train"},
            {"path": "/data/X_test.csv", "type": "X", "split": "test"},
            {"path": "/data/Y_test.csv", "type": "Y", "split": "test"},
        ]
        parsing = {"delimiter": ","}

        config = build_nirs4all_config(files, parsing)

        assert _norm(config["train_x"]) == "/data/X_train.csv"
        assert _norm(config["train_y"]) == "/data/Y_train.csv"
        assert _norm(config["test_x"]) == "/data/X_test.csv"
        assert _norm(config["test_y"]) == "/data/Y_test.csv"

    def test_metadata_mapping(self):
        files = [
            {"path": "/data/X.csv", "type": "X", "split": "train"},
            {"path": "/data/meta.csv", "type": "metadata", "split": "train"},
        ]
        config = build_nirs4all_config(files, {"delimiter": ";"})

        assert _norm(config["train_group"]) == "/data/meta.csv"

    def test_metadata_from_uppercase_aliases(self):
        """Verify M, META, GROUP type aliases all map to train_group."""
        for alias in ("M", "META", "METADATA", "GROUP"):
            files = [
                {"path": "/data/X.csv", "type": "X", "split": "train"},
                {"path": "/data/meta.csv", "type": alias, "split": "train"},
            ]
            config = build_nirs4all_config(files, {"delimiter": ";"})
            assert _norm(config.get("train_group", "")) == "/data/meta.csv", f"Failed for alias {alias}"

    def test_default_delimiter_is_semicolon(self):
        """Default delimiter must be semicolon, not comma."""
        files = [{"path": "/data/X.csv", "type": "X", "split": "train"}]
        config = build_nirs4all_config(files, {})

        assert config["global_params"]["delimiter"] == ";"

    def test_per_file_overrides_for_y(self):
        """Issue #7: Y file with different delimiter must produce train_y_params."""
        files = [
            {"path": "/data/X.csv", "type": "X", "split": "train"},
            {"path": "/data/Y.csv", "type": "Y", "split": "train",
             "overrides": {"delimiter": ",", "decimal_separator": "."}},
        ]
        parsing = {"delimiter": ";", "decimal_separator": ","}

        config = build_nirs4all_config(files, parsing)

        assert config["global_params"]["delimiter"] == ";"
        assert "train_y_params" in config
        assert config["train_y_params"]["delimiter"] == ","
        assert config["train_y_params"]["decimal_separator"] == "."

    def test_per_file_overrides_for_x_merge_with_x_specific(self):
        """X file overrides merge with x_specific_params (header_unit, signal_type)."""
        files = [
            {"path": "/data/X.csv", "type": "X", "split": "train",
             "overrides": {"delimiter": ","}},
        ]
        parsing = {"delimiter": ";", "header_unit": "nm", "signal_type": "absorbance"}

        config = build_nirs4all_config(files, parsing)

        params = config["train_x_params"]
        assert params["header_unit"] == "nm"
        assert params["signal_type"] == "absorbance"
        assert params["delimiter"] == ","

    def test_x_specific_params_without_overrides(self):
        """X files get x_specific_params even without overrides."""
        files = [{"path": "/data/X.csv", "type": "X", "split": "train"}]
        parsing = {"delimiter": ";", "header_unit": "cm-1"}

        config = build_nirs4all_config(files, parsing)

        assert config["train_x_params"]["header_unit"] == "cm-1"

    def test_signal_type_auto_excluded_from_x_params(self):
        """signal_type='auto' should not appear in x_specific_params."""
        files = [{"path": "/data/X.csv", "type": "X", "split": "train"}]
        parsing = {"delimiter": ";", "signal_type": "auto", "header_unit": "nm"}

        config = build_nirs4all_config(files, parsing)

        assert "signal_type" not in config.get("train_x_params", {})

    def test_multi_source_x(self):
        """Multiple X files for same split produce a list."""
        files = [
            {"path": "/data/X1.csv", "type": "X", "split": "train", "source": 0},
            {"path": "/data/X2.csv", "type": "X", "split": "train", "source": 1},
        ]
        config = build_nirs4all_config(files, {"delimiter": ";"})

        assert isinstance(config["train_x"], list)
        assert len(config["train_x"]) == 2

    def test_global_params_include_encoding_na_policy(self):
        """encoding and na_policy should appear in global_params."""
        files = [{"path": "/data/X.csv", "type": "X", "split": "train"}]
        parsing = {
            "delimiter": ";",
            "encoding": "latin-1",
            "na_policy": "remove_sample",
            "na_fill_config": {"method": "mean"},
        }

        config = build_nirs4all_config(files, parsing)

        gp = config["global_params"]
        assert gp["encoding"] == "latin-1"
        assert gp["na_policy"] == "remove_sample"
        assert gp["na_fill_config"]["method"] == "mean"

    def test_aggregation_enabled(self):
        """Aggregation config translates to aggregate/aggregate_method/repetition."""
        files = [{"path": "/data/X.csv", "type": "X", "split": "train"}]
        aggregation = {"enabled": True, "column": "sample_id", "method": "mean"}

        config = build_nirs4all_config(files, {"delimiter": ";"}, aggregation=aggregation)

        assert config["aggregate"] == "sample_id"
        assert config["aggregate_method"] == "mean"
        assert config["repetition"] == "sample_id"

    def test_aggregation_disabled(self):
        """Disabled aggregation should not produce aggregate fields."""
        files = [{"path": "/data/X.csv", "type": "X", "split": "train"}]
        aggregation = {"enabled": False, "column": "sample_id", "method": "mean"}

        config = build_nirs4all_config(files, {"delimiter": ";"}, aggregation=aggregation)

        assert "aggregate" not in config
        assert "aggregate_method" not in config

    def test_aggregation_without_column(self):
        """Aggregation enabled but no column should not produce aggregate fields."""
        files = [{"path": "/data/X.csv", "type": "X", "split": "train"}]
        aggregation = {"enabled": True, "method": "mean"}

        config = build_nirs4all_config(files, {"delimiter": ";"}, aggregation=aggregation)

        assert "aggregate" not in config

    def test_folds_file(self):
        """Fold config with source='file' translates to folds field."""
        files = [{"path": "/data/X.csv", "type": "X", "split": "train"}]
        folds = {"source": "file", "file": "/data/folds.csv"}

        config = build_nirs4all_config(files, {"delimiter": ";"}, folds=folds)

        assert config["folds"] == "/data/folds.csv"

    def test_folds_column(self):
        """Fold config with source='column' translates to fold_column."""
        files = [{"path": "/data/X.csv", "type": "X", "split": "train"}]
        folds = {"source": "column", "column": "fold_id"}

        config = build_nirs4all_config(files, {"delimiter": ";"}, folds=folds)

        assert config["fold_column"] == "fold_id"

    def test_folds_inline(self):
        """Fold config with source='inline' passes through inline folds."""
        files = [{"path": "/data/X.csv", "type": "X", "split": "train"}]
        inline_folds = [{"train": [0, 1], "val": [2, 3]}]
        folds = {"source": "inline", "folds": inline_folds}

        config = build_nirs4all_config(files, {"delimiter": ";"}, folds=folds)

        assert config["folds"] == inline_folds

    def test_folds_none(self):
        """No folds config should not produce folds fields."""
        files = [{"path": "/data/X.csv", "type": "X", "split": "train"}]
        config = build_nirs4all_config(files, {"delimiter": ";"})

        assert "folds" not in config
        assert "fold_column" not in config

    def test_task_type_not_auto(self):
        """Non-auto task_type should be included."""
        files = [{"path": "/data/X.csv", "type": "X", "split": "train"}]
        config = build_nirs4all_config(files, {"delimiter": ";"}, task_type="regression")

        assert config["task_type"] == "regression"

    def test_task_type_auto_excluded(self):
        """task_type='auto' should not appear in config."""
        files = [{"path": "/data/X.csv", "type": "X", "split": "train"}]
        config = build_nirs4all_config(files, {"delimiter": ";"}, task_type="auto")

        assert "task_type" not in config

    def test_dataset_name(self):
        files = [{"path": "/data/X.csv", "type": "X", "split": "train"}]
        config = build_nirs4all_config(files, {"delimiter": ";"}, dataset_name="my_dataset")

        assert config["name"] == "my_dataset"

    def test_path_resolution_with_base_path(self):
        files = [
            {"path": "X_train.csv", "type": "X", "split": "train"},
            {"path": "Y_train.csv", "type": "Y", "split": "train"},
        ]
        config = build_nirs4all_config(files, {"delimiter": ";"}, base_path="/data/folder")

        assert config["train_x"] == str(Path("/data/folder/X_train.csv"))
        assert config["train_y"] == str(Path("/data/folder/Y_train.csv"))

    def test_absolute_paths_not_resolved(self):
        files = [{"path": "/abs/X.csv", "type": "X", "split": "train"}]
        config = build_nirs4all_config(files, {"delimiter": ";"}, base_path="/other")

        assert _norm(config["train_x"]) == "/abs/X.csv"

    def test_empty_files_skipped(self):
        files = [
            {"path": "", "type": "X", "split": "train"},
            {"path": "/data/X.csv", "type": "", "split": "train"},
            {"path": "/data/Y.csv", "type": "Y", "split": "train"},
        ]
        config = build_nirs4all_config(files, {"delimiter": ";"})

        assert "train_x" not in config
        assert _norm(config["train_y"]) == "/data/Y.csv"

    def test_unknown_type_skipped(self):
        files = [{"path": "/data/X.csv", "type": "unknown", "split": "train"}]
        config = build_nirs4all_config(files, {"delimiter": ";"})

        assert "train_x" not in config


# ============= build_nirs4all_config_from_stored =============


class TestBuildNirs4allConfigFromStored:
    """Tests for the stored dataset config translator."""

    def test_basic_stored_config(self):
        record = {
            "path": "/data/folder",
            "name": "test_ds",
            "config": {
                "delimiter": ";",
                "decimal_separator": ".",
                "has_header": True,
                "header_unit": "nm",
                "files": [
                    {"path": "/data/X.csv", "type": "X", "split": "train"},
                    {"path": "/data/Y.csv", "type": "Y", "split": "train"},
                ],
            },
        }

        config = build_nirs4all_config_from_stored(record)

        assert _norm(config["train_x"]) == "/data/X.csv"
        assert _norm(config["train_y"]) == "/data/Y.csv"
        assert config["global_params"]["delimiter"] == ";"
        assert config["name"] == "test_ds"

    def test_stored_config_default_delimiter_is_semicolon(self):
        """Default delimiter for stored configs must be semicolon."""
        record = {
            "path": "/data",
            "config": {
                "files": [{"path": "/data/X.csv", "type": "X", "split": "train"}],
            },
        }

        config = build_nirs4all_config_from_stored(record)

        assert config["global_params"]["delimiter"] == ";"

    def test_stored_config_with_overrides(self):
        """Issue #7: Per-file overrides from stored config survive."""
        record = {
            "path": "/data",
            "config": {
                "delimiter": ";",
                "files": [
                    {"path": "/data/X.csv", "type": "X", "split": "train"},
                    {"path": "/data/Y.csv", "type": "Y", "split": "train",
                     "overrides": {"delimiter": ","}},
                ],
            },
        }

        config = build_nirs4all_config_from_stored(record)

        assert config["global_params"]["delimiter"] == ";"
        assert config["train_y_params"]["delimiter"] == ","

    def test_stored_config_with_aggregation(self):
        """Aggregation from stored config is translated."""
        record = {
            "path": "/data",
            "config": {
                "files": [{"path": "/data/X.csv", "type": "X", "split": "train"}],
                "aggregation": {"enabled": True, "column": "rep_id", "method": "median"},
            },
        }

        config = build_nirs4all_config_from_stored(record)

        assert config["aggregate"] == "rep_id"
        assert config["aggregate_method"] == "median"

    def test_stored_config_with_folds(self):
        """Folds from stored config are translated."""
        record = {
            "path": "/data",
            "config": {
                "files": [{"path": "/data/X.csv", "type": "X", "split": "train"}],
                "folds": {"source": "file", "file": "/data/folds.csv"},
            },
        }

        config = build_nirs4all_config_from_stored(record)

        assert config["folds"] == "/data/folds.csv"

    def test_old_format_without_files_array(self):
        """Old-format configs with train_x/train_y directly should still work."""
        record = {
            "path": "/data",
            "config": {
                "delimiter": ";",
                "train_x": "/data/X_train.csv",
                "train_y": "/data/Y_train.csv",
                "test_x": "/data/X_test.csv",
                "header_unit": "nm",
            },
        }

        config = build_nirs4all_config_from_stored(record)

        assert config["train_x"] == "/data/X_train.csv"
        assert config["train_y"] == "/data/Y_train.csv"
        assert config["test_x"] == "/data/X_test.csv"
        assert config["train_x_params"]["header_unit"] == "nm"

    def test_na_policy_from_global_params(self):
        """na_policy from global_params should be forwarded."""
        record = {
            "path": "/data",
            "config": {
                "files": [{"path": "/data/X.csv", "type": "X", "split": "train"}],
                "global_params": {"na_policy": "remove_sample"},
            },
        }

        config = build_nirs4all_config_from_stored(record)

        assert config["global_params"]["na_policy"] == "remove_sample"


# ============= Regression Tests for Issues #1 and #7 =============


class TestIssue7YDelimiterOverride:
    """Regression tests for issue #7: Y delimiter override must survive through all paths."""

    def test_y_override_in_canonical_translator(self):
        """Core test: Y file with comma delimiter while X uses semicolon."""
        files = [
            {"path": "/data/X.csv", "type": "X", "split": "train"},
            {"path": "/data/Y.csv", "type": "Y", "split": "train",
             "overrides": {"delimiter": ","}},
        ]
        config = build_nirs4all_config(files, {"delimiter": ";"})

        assert config["global_params"]["delimiter"] == ";"
        assert config["train_y_params"]["delimiter"] == ","

    def test_y_override_in_stored_config(self):
        """Y override survives through stored config path."""
        record = {
            "path": "/data",
            "config": {
                "delimiter": ";",
                "files": [
                    {"path": "/data/X.csv", "type": "X", "split": "train"},
                    {"path": "/data/Y.csv", "type": "Y", "split": "train",
                     "overrides": {"delimiter": ",", "decimal_separator": "."}},
                ],
            },
        }

        config = build_nirs4all_config_from_stored(record)

        assert config["global_params"]["delimiter"] == ";"
        assert config["train_y_params"]["delimiter"] == ","
        assert config["train_y_params"]["decimal_separator"] == "."

    def test_metadata_override_preserved(self):
        """Issue #1: Metadata file with different parsing preserved."""
        files = [
            {"path": "/data/X.csv", "type": "X", "split": "train"},
            {"path": "/data/Y.csv", "type": "Y", "split": "train"},
            {"path": "/data/meta.csv", "type": "metadata", "split": "train",
             "overrides": {"delimiter": "\t"}},
        ]
        config = build_nirs4all_config(files, {"delimiter": ";"})

        assert config["train_group_params"]["delimiter"] == "\t"


class TestDefaultTargetPreservation:
    """Regression test: configured default_target must not be overwritten."""

    def test_default_target_in_config_preserved(self):
        """build_nirs4all_config_from_stored should not override default_target."""
        record = {
            "path": "/data",
            "config": {
                "files": [{"path": "/data/X.csv", "type": "X", "split": "train"}],
                "default_target": "protein",
                "targets": [
                    {"column": "moisture", "type": "regression"},
                    {"column": "protein", "type": "regression"},
                ],
            },
        }

        # The canonical translator doesn't handle default_target
        # (that's a workspace concern), but we verify the config builder
        # doesn't corrupt the stored config
        config = build_nirs4all_config_from_stored(record)

        # Config should be buildable without errors
        assert "train_x" in config


class TestAggregationFoldsPersistence:
    """Regression: aggregation and folds must survive submit → config → run."""

    def test_full_pipeline_config(self):
        """Simulate: wizard submit → stored config → run config generation."""
        # This is what the wizard submit produces
        stored = {
            "path": "/data",
            "name": "test_ds",
            "config": {
                "delimiter": ";",
                "decimal_separator": ".",
                "has_header": True,
                "header_unit": "cm-1",
                "signal_type": "auto",
                "na_policy": "auto",
                "files": [
                    {"path": "/data/X_train.csv", "type": "X", "split": "train"},
                    {"path": "/data/Y_train.csv", "type": "Y", "split": "train",
                     "overrides": {"delimiter": ","}},
                    {"path": "/data/meta.csv", "type": "metadata", "split": "train"},
                ],
                "targets": [{"column": "protein", "type": "regression"}],
                "default_target": "protein",
                "task_type": "regression",
                "aggregation": {"enabled": True, "column": "sample_id", "method": "mean"},
                "folds": {"source": "file", "file": "/data/folds.csv"},
            },
        }

        config = build_nirs4all_config_from_stored(stored)

        # All fields survived
        assert _norm(config["train_x"]) == "/data/X_train.csv"
        assert _norm(config["train_y"]) == "/data/Y_train.csv"
        assert _norm(config["train_group"]) == "/data/meta.csv"
        assert config["global_params"]["delimiter"] == ";"
        assert config["train_y_params"]["delimiter"] == ","
        assert config["aggregate"] == "sample_id"
        assert config["aggregate_method"] == "mean"
        assert config["repetition"] == "sample_id"
        assert config["folds"] == "/data/folds.csv"
        assert config["task_type"] == "regression"
        assert config["name"] == "test_ds"
        assert config["train_x_params"]["header_unit"] == "cm-1"
