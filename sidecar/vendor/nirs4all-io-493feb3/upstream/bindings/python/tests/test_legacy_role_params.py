"""Installed wheel regression: no dropped first target/metadata row."""

import numpy as np

import nirs4all_io as nio


def test_headerless_role_params_keep_first_targets_and_metadata(tmp_path):
    config = {"task_type": "regression", "global_params": {"delimiter": ";", "has_header": True}}
    for partition in ("train", "test"):
        for role, content in {"x": "1;2\n3;4\n5;6\n", "y": "101\n102\n103\n", "group": "first\nsecond\nthird\n"}.items():
            path = tmp_path / f"{partition}_{role}.csv"
            path.write_text(content)
            config[f"{partition}_{role}"] = str(path)
            config[f"{partition}_{role}_params"] = {"has_header": False}
    dataset = nio.load(config, target="spectrodataset")
    for partition in ("train", "test"):
        np.testing.assert_array_equal(dataset.x({"partition": partition}), [[1, 2], [3, 4], [5, 6]])
        # This boundary preserves loaded values. Numeric target encoding is a
        # separate library-owned processing, not IO's file-row contract.
        np.testing.assert_array_equal(np.asarray(dataset.y({"partition": partition, "y": "raw"})).reshape(-1), [101, 102, 103])
        # Headerless metadata receives source-qualified column identities.
        assert dataset.metadata_columns == ["train_m__0", "test_m__0"]
        column = dataset.metadata_columns.index(f"{partition}_m__0")
        assert dataset.metadata({"partition": partition})[0, column] == "first"
