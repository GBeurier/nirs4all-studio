# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Public DatasetPackage API tests."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

import nirs4all_io as nio
from nirs4all_io.materialize import DatasetPackage, PayloadStorageKind, repr_ids


def _csv(path, df):
    df.to_csv(path, sep=";", index=False)


def test_to_dataset_package_exposes_manifest_and_summary(tmp_path):
    _csv(
        tmp_path / "data.csv",
        pd.DataFrame(
            {
                "sample_id": ["s1", "s2", "s3"],
                "rep": ["a", "b", "c"],
                "400": [0.1, 0.2, 0.3],
                "401": [0.4, 0.5, 0.6],
                "y": [1.0, 2.0, 3.0],
                "weight": [1.0, 0.5, 2.0],
                "site": ["north", "south", "north"],
            }
        ),
    )
    spec = {
        "sample_index": {"by": "id", "key": "sample_id"},
        "repetition": "rep",
        "sources": [
            {
                "id": "data",
                "role": "mixed",
                "input": "data.csv",
                "key": "sample_id",
                "columns": [
                    {"role": "features", "select": ["400", "401"]},
                    {"role": "targets", "select": ["y"]},
                    {"role": "weights", "select": ["weight"]},
                    {"role": "metadata", "select": ["rep", "site"]},
                ],
            }
        ],
    }

    package = nio.to_dataset_package(spec, base_dir=tmp_path, name="pkg")

    assert isinstance(package, DatasetPackage)
    assert package.name == "pkg"
    manifest = package.manifest()
    by_id = {entry.id: entry for entry in manifest.entries}
    assert set(by_id) == {"train/x0", "train/y", "train/metadata", "train/weights"}
    assert by_id["train/x0"].representation_id == repr_ids.SIGNAL_1D
    assert by_id["train/x0"].axes == ["sample", "feature"]
    assert by_id["train/y"].representation_id == repr_ids.TARGET_NUMERIC
    assert by_id["train/metadata"].representation_id == repr_ids.SAMPLE_METADATA
    assert by_id["train/weights"].role == "weights"
    assert all(entry.storage is PayloadStorageKind.INLINE for entry in manifest.entries)
    assert all(len(entry.content_hash) == 64 for entry in manifest.entries)
    assert len(manifest.root) == 64

    fallback = package.row_position_fallback
    assert fallback.used is False
    assert "repetition key 'rep'" in fallback.reason
    assert len(fallback.fingerprint) == 64

    summary = package.to_summary_dict()
    assert summary["schema_version"] == 2
    assert summary["partitions"] == {"train": {"n_samples": 3}}
    assert summary["manifest"]["root"] == manifest.root

    canonical = package.to_canonical_summary()
    assert canonical.endswith("\n")
    assert '"schema_version": 2' in canonical
    assert '"data"' not in canonical


def test_load_dataset_package_target_and_describe_accept_in_memory_input():
    X = np.arange(12, dtype=np.float32).reshape(4, 3)
    y = np.arange(4, dtype=np.float32)

    package = nio.load((X, y), target="dataset_package", name="arrays")
    assert isinstance(package, DatasetPackage)
    assert package.name == "arrays"

    described = nio.describe_dataset_package(package)
    assert isinstance(described, dict)
    assert described["name"] == "arrays"
    assert described["partitions"]["train"]["n_samples"] == 4


def test_dataset_package_helper_and_load_targets_stay_coherent():
    X = np.arange(12, dtype=np.float32).reshape(4, 3)
    y = np.arange(4, dtype=np.float32)

    by_helper = nio.to_dataset_package((X, y), name="arrays")
    by_target = nio.load((X, y), target="dataset_package", name="arrays")
    by_alias = nio.load((X, y), target="package", name="arrays")

    assert isinstance(by_helper, DatasetPackage)
    assert isinstance(by_target, DatasetPackage)
    assert isinstance(by_alias, DatasetPackage)
    assert by_target.to_summary_dict() == by_helper.to_summary_dict()
    assert by_alias.to_summary_dict() == by_helper.to_summary_dict()
    assert nio.to_dataset_package(by_helper) is by_helper
    assert nio.load(by_helper, target="dataset_package") is by_helper
    assert nio.load(by_helper, target="package") is by_helper


def test_python_dag_ml_data_target_points_to_rust_bridge():
    X = np.arange(6, dtype=np.float32).reshape(3, 2)

    with pytest.raises(NotImplementedError, match="nirs4all-io-dagml"):
        nio.load(X, target="dag-ml-data")


def test_dataset_package_round_trips_v1_assembled_payloads():
    X = np.arange(12, dtype=np.float32).reshape(4, 3)
    y = np.arange(4, dtype=np.float32)
    assembled = nio.load((X, y), target="assembled", name="roundtrip")
    package = nio.to_dataset_package(assembled)

    restored = package.to_assembled()

    assert restored.name == assembled.name
    assert restored.task_type == assembled.task_type
    assert restored.signal_type == assembled.signal_type
    assert restored.n_sources == assembled.n_sources
    np.testing.assert_allclose(restored.blocks["train"].X[0], assembled.blocks["train"].X[0])
    np.testing.assert_allclose(restored.blocks["train"].y, assembled.blocks["train"].y)


def test_reference_dataset_adapter_uses_to_io_spec(tmp_path):
    _csv(tmp_path / "X.csv", pd.DataFrame({"observation_id": ["o1", "o2"], "sample_id": ["s1", "s2"], "1100": [0.1, 0.2], "1102": [0.3, 0.4]}))
    _csv(tmp_path / "variables.csv", pd.DataFrame({"sample_id": ["s1", "s2"], "protein": [5.0, 6.0], "site": ["north", "south"]}))

    # The adapter contract is independent of nirs4all-datasets: any object that
    # can publish an IO spec can be materialized through the normal IO pipeline.
    class ReferenceDatasetDouble:
        def to_io_spec(self):
            return (
                {
                    "name": "reference",
                    "sample_index": {"by": "id", "key": "sample_id", "observation_id": "observation_id"},
                    "sources": [
                        {
                            "id": "X",
                            "role": "mixed",
                            "input": "X.csv",
                            "key": "sample_id",
                            "columns": [
                                {"role": "ignore", "select": ["observation_id"]},
                                {"role": "features", "select": ["1100", "1102"]},
                            ],
                            "params": {"delimiter": ";", "header_unit": "nm"},
                        },
                        {
                            "id": "variables",
                            "role": "mixed",
                            "input": "variables.csv",
                            "key": "sample_id",
                            "columns": [
                                {"role": "targets", "select": ["protein"]},
                                {"role": "metadata", "select": ["site"]},
                            ],
                            "join": {"to": "X", "on": "sample_id", "how": "m:1", "coverage": "complete"},
                            "params": {"delimiter": ";"},
                        },
                    ],
                },
                tmp_path,
            )

    package = nio.load(ReferenceDatasetDouble(), target="dataset_package")

    assert isinstance(package, DatasetPackage)
    block = package.to_assembled().blocks["train"]
    np.testing.assert_allclose(block.X[0], [[0.1, 0.3], [0.2, 0.4]], rtol=1e-6)
    np.testing.assert_allclose(block.y, [[5.0], [6.0]], rtol=1e-6)
    assert block.metadata["site"].tolist() == ["north", "south"]


def test_reference_dataset_adapter_preserves_row_aligned_multisource_headers(tmp_path):
    _csv(tmp_path / "X1.csv", pd.DataFrame({"sample_id": ["s1", "s2"], "1100": [0.1, 0.2], "1102": [0.3, 0.4]}))
    _csv(tmp_path / "X2.csv", pd.DataFrame({"sample_id": ["s1", "s2"], "1100": [1.1, 1.2], "1102": [1.3, 1.4]}))

    class ReferenceDatasetDouble:
        def to_io_spec(self):
            return (
                {
                    "name": "multi-reference",
                    "sample_index": {"by": "id", "key": "sample_id"},
                    "sources": [
                        {
                            "id": "X1",
                            "role": "mixed",
                            "input": "X1.csv",
                            "key": "sample_id",
                            "columns": [{"role": "features", "select": ["1100", "1102"]}],
                        },
                        {
                            "id": "X2",
                            "role": "mixed",
                            "input": "X2.csv",
                            "key": "sample_id",
                            "columns": [{"role": "features", "select": ["1100", "1102"]}],
                            "join": {"to": "X1", "how": "1:1"},
                        },
                    ],
                },
                tmp_path,
            )

    package = nio.to_dataset_package(ReferenceDatasetDouble())

    block = package.to_assembled().blocks["train"]
    assert len(block.X) == 2
    assert block.feature_headers == [["1100", "1102"], ["1100", "1102"]]
    np.testing.assert_allclose(block.X[0], [[0.1, 0.3], [0.2, 0.4]], rtol=1e-6)
    np.testing.assert_allclose(block.X[1], [[1.1, 1.3], [1.2, 1.4]], rtol=1e-6)


def test_reference_dataset_adapter_accepts_bare_spec_with_absolute_paths(tmp_path):
    x_path = tmp_path / "X.parquet"
    variables_path = tmp_path / "variables.parquet"
    pd.DataFrame({"observation_id": ["o1", "o2"], "sample_id": ["s1", "s2"], "1100": [0.1, 0.2], "1102": [0.3, 0.4]}).to_parquet(x_path)
    pd.DataFrame({"sample_id": ["s1", "s2"], "protein": [5.0, 6.0], "site": ["north", "south"]}).to_parquet(variables_path)

    # Matches nirs4all-datasets.NirsDataset.to_io_spec(): it returns a bare
    # JSON-ready spec dict whose source inputs are already canonical file paths.
    class ReferenceDatasetDouble:
        def to_io_spec(self):
            return {
                "name": "reference_abs",
                "sample_index": {"by": "id", "key": "sample_id", "observation_id": "observation_id"},
                "sources": [
                    {
                        "id": "X",
                        "role": "mixed",
                        "input": str(x_path),
                        "key": "sample_id",
                        "columns": [
                            {"role": "ignore", "select": ["observation_id", "sample_id"]},
                            {"role": "features", "select": ["1100", "1102"]},
                        ],
                    },
                    {
                        "id": "variables",
                        "role": "mixed",
                        "input": str(variables_path),
                        "key": "sample_id",
                        "columns": [
                            {"role": "targets", "select": ["protein"]},
                            {"role": "metadata", "select": ["site"]},
                        ],
                        "join": {"to": "X", "on": "sample_id", "how": "m:1", "coverage": "warn"},
                    },
                ],
            }

    package = nio.load(ReferenceDatasetDouble(), target="dataset_package")

    assert package.name == "reference_abs"
    block = package.to_assembled().blocks["train"]
    np.testing.assert_allclose(block.X[0], [[0.1, 0.3], [0.2, 0.4]], rtol=1e-6)
    np.testing.assert_allclose(block.y, [[5.0], [6.0]], rtol=1e-6)
    assert block.metadata["site"].tolist() == ["north", "south"]
