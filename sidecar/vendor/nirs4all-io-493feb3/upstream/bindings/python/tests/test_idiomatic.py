# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""The idiomatic Python surface: native inputs (str / Path / list / dict) in,
typed DatasetPlan / DatasetSpec mappings out."""

import base64
import json
from pathlib import Path

import pytest

import nirs4all_io as nio
from nirs4all_io.materialize import DatasetPackage, PayloadStorageKind, repr_ids

CORPUS = Path(__file__).resolve().parents[3] / "tests/goldens/contract/corpus"


def _write_b64(path: Path, payload: str) -> None:
    path.write_bytes(base64.b64decode(payload))


def test_to_spec_accepts_pathlib_and_returns_typed_spec():
    spec = nio.to_spec(CORPUS / "train_test")  # a pathlib.Path, not a str
    assert isinstance(spec, nio.DatasetSpec)
    assert isinstance(spec, dict)  # still a dict: subscriptable, serializable
    assert spec.schema_version == 1 == spec["schema_version"]
    assert spec.name == "train_test"
    assert len(spec.sources) >= 1
    json.dumps(spec)  # JSON-serializable
    nio.validate(spec)  # the typed spec round-trips through validate
    assert "DatasetSpec" in repr(spec) and "train_test" in repr(spec)


def test_infer_accepts_pathlib_list_and_returns_typed_plan():
    plan = nio.infer([CORPUS / "x_y_separate" / "X.csv", CORPUS / "x_y_separate" / "Y.csv"])
    assert isinstance(plan, nio.DatasetPlan)
    assert "resolved_spec" in plan


def test_plan_exposes_decisions_and_resolved_spec():
    plan = nio.infer(CORPUS / "single_combined")
    decisions = plan.decisions()
    assert {"structure", "task_type", "signal_type"} <= decisions.keys()
    for d in decisions.values():
        assert {"value", "score", "ambiguous"} <= d.keys()
    assert isinstance(plan.overall_score, float)
    rs = plan.resolved_spec
    assert isinstance(rs, nio.DatasetSpec)
    nio.validate(rs)
    assert "DatasetPlan" in repr(plan)


def test_load_accepts_pathlib():
    assembled = nio.load(CORPUS / "x_y_separate", target="assembled")
    assert "blocks" in assembled


def test_load_accepts_reference_object_with_to_io_spec():
    class ReferenceDatasetDouble:
        def to_io_spec(self):
            return (
                {
                    "sources": [
                        {"id": "x", "role": "features", "input": "X.csv"},
                        {"id": "y", "role": "targets", "input": "Y.csv", "join": {"to": "x", "how": "1:1"}},
                    ]
                },
                CORPUS / "x_y_separate",
            )

    spec = nio.to_spec(ReferenceDatasetDouble(), name="reference")
    assert isinstance(spec, nio.DatasetSpec)
    assert spec.name == "reference"
    assert all(Path(source["input"]).is_absolute() for source in spec.sources)
    nio.validate(spec)

    assembled = nio.load(ReferenceDatasetDouble(), target="assembled", name="reference")
    assert assembled["name"] == "reference"
    assert "train" in assembled["blocks"]


def test_dataset_package_target_exposes_manifest_summary_and_assembled_view():
    package = nio.to_dataset_package(CORPUS / "x_y_separate", name="pkg")

    assert isinstance(package, DatasetPackage)
    assert package.name == "pkg"
    assert nio.load(package, target="dataset_package") is package

    manifest = package.manifest()
    assert len(manifest.root) == 64
    by_id = {entry.id: entry for entry in manifest.entries}
    assert "train/x0" in by_id
    assert by_id["train/x0"].representation_id == repr_ids.SIGNAL_1D
    assert by_id["train/x0"].storage is PayloadStorageKind.INLINE
    assert len(by_id["train/x0"].content_hash) == 64

    summary = nio.describe_dataset_package(package)
    assert summary["schema_version"] == 3
    assert summary["name"] == "pkg"
    assert summary["manifest"]["root"] == manifest.root
    canonical = nio.describe_dataset_package(package, canonical=True)
    assert isinstance(canonical, str)
    assert canonical.endswith("\n")
    assert '"schema_version": 3' in canonical

    assembled = package.to_assembled()
    block = assembled.blocks["train"]
    assert block.X[0].shape[0] == block.n_samples
    assert block.feature_headers
    assert package.row_position_fallback.fingerprint


def test_dataset_package_target_accepts_base_dir_for_relative_specs(tmp_path):
    (tmp_path / "X.csv").write_text("1000;1002\n0.1;0.2\n0.3;0.4\n", encoding="utf-8")

    package = nio.load(
        {"sources": [{"id": "x", "role": "features", "input": "X.csv"}]},
        target="package",
        base_dir=tmp_path,
        name="relative",
    )

    assert isinstance(package, DatasetPackage)
    assert package.name == "relative"
    assert package.to_assembled().blocks["train"].X[0].shape == (2, 2)


def test_dataset_package_load_targets_are_coherent():
    package = nio.to_dataset_package(CORPUS / "x_y_separate", name="pkg")

    assert nio.load(package, target="package") is package
    assembled = nio.load(package, target="assembled")
    assert assembled.name == "pkg"
    assert assembled.blocks["train"].X[0].shape[0] == assembled.blocks["train"].n_samples


def test_dataset_package_v3_cross_language_wire_golden():
    """The binding wrapper stays byte-identical to the Rust/Python v3 wire."""
    matrix = {"data": [0.0, 1.0, 2.0, 3.0, 4.0, 5.0], "n_rows": 2, "n_cols": 3}
    full = {
        "assembled_schema_version": 2,
        "name": "demo",
        "task_type": "regression",
        "signal_type": "absorbance",
        "n_sources": 1,
        "folds": [[[0], [1]]],
        "fold_provenance": [
            {"train_observation_ids": ["O1"], "validation_observation_ids": ["O2"]}
        ],
        "identity": {
            "provenance": {
                "source_ids": ["spectra"],
                "sample_id": "sample_id",
                "observation_id": "observation_id",
                "repetition_id": "rep",
                "group_id": "batch",
            }
        },
        "repetition": None,
        "aggregate": None,
        "blocks": {
            "train": {
                "n_samples": 2,
                "source_ids": ["spectra"],
                "x": [matrix],
                "feature_headers": [["1000", "1010", "1020"]],
                "header_units": ["nm"],
                "signal_types": ["absorbance"],
                "y": {"data": [0.0, 1.0], "n_rows": 2, "n_cols": 1},
                "y_headers": ["protein"],
                "y_categorical": {},
                "metadata": {
                    "n_rows": 2,
                    "columns": [
                        {"name": "batch", "values": ["a", "b"]},
                        {"name": "rep", "values": ["r1", "r2"]},
                        {"name": "sample_id", "values": ["S1", "S2"]},
                        {"name": "observation_id", "values": ["O1", "O2"]},
                    ],
                },
                "weights": [1.0, 2.0],
                "weights_header": "w",
                "processings": [[]],
            }
        },
    }
    expected = (
        Path(__file__).resolve().parents[3]
        / "tests/goldens/dataset_package_v3.cross_language.canonical"
    ).read_text(encoding="utf-8")
    assert DatasetPackage(full).to_canonical_summary() == expected


def test_dataset_package_rejects_retired_unversioned_assembled_wire():
    with pytest.raises(ValueError, match="assembled_schema_version=2"):
        DatasetPackage({"name": "legacy"})


def test_public_repr_ids_match_package_contract():
    for name in (
        "SIGNAL_1D",
        "SIGNAL_WITH_PROCESSINGS",
        "FEATURE_BLOCK_SET",
        "TARGET_NUMERIC",
        "TARGET_CATEGORICAL",
        "TARGET_NUMERIC_MATRIX",
        "TARGET_CATEGORICAL_MATRIX",
        "SAMPLE_METADATA",
        "GRAY_IMAGE",
        "RGB_IMAGE",
        "MC_IMAGE",
        "MULTISPECTRAL_IMAGE",
    ):
        assert isinstance(getattr(repr_ids, name), str)


def test_python_dag_ml_data_target_points_to_rust_bridge():
    with pytest.raises(NotImplementedError, match="nirs4all-io-dagml"):
        nio.load(CORPUS / "x_only_single_csv", target="dag-ml-data")


def test_to_io_spec_base_dir_applies_to_secondary_file_refs(tmp_path):
    (tmp_path / "X.csv").write_text("1000;1002\n0.1;0.2\n0.3;0.4\n0.5;0.6\n0.7;0.8\n", encoding="utf-8")
    (tmp_path / "X_snv.csv").write_text("1000;1002\n-1.0;1.0\n-1.0;1.0\n-1.0;1.0\n-1.0;1.0\n", encoding="utf-8")
    (tmp_path / "Y.csv").write_text("y\n1.0\n2.0\n3.0\n4.0\n", encoding="utf-8")
    (tmp_path / "train_idx.txt").write_text("0\n1\n", encoding="utf-8")
    (tmp_path / "test_idx.txt").write_text("2\n3\n", encoding="utf-8")
    (tmp_path / "folds.csv").write_text("fold_0\n0\n1\n", encoding="utf-8")

    class ReferenceDatasetDouble:
        def to_io_spec(self):
            return (
                {
                    "sources": [
                        {
                            "id": "x",
                            "role": "features",
                            "input": "X.csv",
                            "variations": [{"name": "snv", "input": "X_snv.csv"}],
                        },
                        {"id": "y", "role": "targets", "input": "Y.csv", "join": {"to": "x", "how": "1:1"}},
                    ],
                    "partitions": {"by": "index_file", "train_file": "train_idx.txt", "test_file": "test_idx.txt"},
                    "folds": {"file": "folds.csv", "format": "csv"},
                },
                tmp_path,
            )

    spec = nio.to_spec(ReferenceDatasetDouble(), name="reference")

    assert Path(spec.sources[0]["input"]).is_absolute()
    assert Path(spec.sources[0]["variations"][0]["input"]).is_absolute()
    assert Path(spec["partitions"]["train_file"]).is_absolute()
    assert Path(spec["partitions"]["test_file"]).is_absolute()
    assert Path(spec["folds"]["file"]).is_absolute()

    assembled = nio.load(ReferenceDatasetDouble(), target="assembled", name="reference")
    assert set(assembled["blocks"]) == {"train", "test"}


def test_load_parquet_reference_object_succeeds_with_native_loader(tmp_path):
    parquet_path = tmp_path / "X.parquet"
    # Generated with pyarrow from columns 400/410/y/sample/flag. Keeping bytes
    # inline makes the binding gate independent of local Parquet writer extras.
    parquet_b64 = (
        "UEFSMRUEFTAVMEwVBhUAEgAAmpmZmZmZuT+amZmZmZnJPzMzMzMzM9M/FQAVCBUILBUGFRAVBhUGHBgIMzMzMzMz0z8YCJqZmZmZ"
        "mbk/FgAoCDMzMzMzM9M/GAiamZmZmZm5PwAAAAIDJAAVBBUwFTBMFQYVABIAAClcj8L1KLw/4XoUrkfhyj/Xo3A9CtfTPxUAFQgV"
        "CCwVBhUQFQYVBhwYCNejcD0K19M/GAgpXI/C9Si8PxYAKAjXo3A9CtfTPxgIKVyPwvUovD8AAAACAyQAFQQVMBUwTBUGFQASAAAA"
        "AAAAAADwPwAAAAAAAABAAAAAAAAACEAVABUIFQgsFQYVEBUGFQYcGAgAAAAAAAAIQBgIAAAAAAAA8D8WACgIAAAAAAAACEAYCAAA"
        "AAAAAPA/AAAAAgMkABUEFSQVJEwVBhUAEgAAAgAAAHMxAgAAAHMyAgAAAHMzFQAVCBUILBUGFRAVBhUGHDYAKAJzMxgCczEAAAAC"
        "AyQAFQAVAhUCLBUGFQAVBhUGHBgBARgBABYAKAEBGAEAAAAABRUEGWw1ABgGc2NoZW1hFQoAFQolABgDNDAwABUKJQAYAzQxMAAV"
        "CiUAGAF5ABUMJQAYBnNhbXBsZSUATBwAAAAVACUAGARmbGFnABYGGRwZXCYAHBUKGTUABhAZGAM0MDAVABYGFs4BFs4BJlQmCBwY"
        "CDMzMzMzM9M/GAiamZmZmZm5PxYAKAgzMzMzMzPTPxgImpmZmZmZuT8AGSwVBBUAFQIAFQAVEBUCAAAAJgAcFQoZNQAGEBkYAzQx"
        "MBUAFgYWzgEWzgEmogIm1gEcGAjXo3A9CtfTPxgIKVyPwvUovD8WACgI16NwPQrX0z8YCClcj8L1KLw/ABksFQQVABUCABUAFRAV"
        "AgAAACYAHBUKGTUABhAZGAF5FQAWBhbOARbOASbwAyakAxwYCAAAAAAAAAhAGAgAAAAAAADwPxYAKAgAAAAAAAAIQBgIAAAAAAAA"
        "8D8AGSwVBBUAFQIAFQAVEBUCAAAAJgAcFQwZNQAGEBkYBnNhbXBsZRUAFgYWggEWggEmsgUm8gQcNgAoAnMzGAJzMQAZLBUEFQAV"
        "AgAVABUQFQIAPBYMGQYZBgAAACYAHBUAGSUGABkYBGZsYWcVABYGFkQWRCb0BTwYAQEYAQAWACgBARgBAAAZHBUAFQAVAgAAABaw"
        "BhYGJggWsAYAGRwYDEFSUk9XOnNjaGVtYRiYAy8vLy8veWdCQUFBUUFBQUFBQUFLQUF3QUJnQUZBQWdBQ2dBQUFBQUJCQUFNQUFB"
        "QUNBQUlBQUFBQkFBSUFBQUFCQUFBQUFVQUFBRElBQUFBakFBQUFHQUFBQUF3QUFBQUJBQUFBRnovLy84QUFBQUdFQUFBQUJnQUFB"
        "QUVBQUFBQUFBQUFBUUFBQUJtYkdGbkFBQUFBTmovLy8rRS8vLy9BQUFBQlJBQUFBQWNBQUFBQkFBQUFBQUFBQUFHQUFBQWMyRnRj"
        "R3hsQUFBRUFBUUFCQUFBQUxELy8vOEFBQUFERUFBQUFCUUFBQUFFQUFBQUFBQUFBQUVBQUFCNUFBQUFudi8vL3dBQUFnRFkvLy8v"
        "QUFBQUF4QUFBQUFVQUFBQUJBQUFBQUFBQUFBREFBQUFOREV3QU1iLy8vOEFBQUlBRUFBVUFBZ0FBQUFIQUF3QUFBQVFBQkFBQUFB"
        "QUFBQURFQUFBQUJ3QUFBQUVBQUFBQUFBQUFBTUFBQUEwTURBQUFBQUdBQWdBQmdBR0FBQUFBQUFDQUE9PQAYIHBhcnF1ZXQtY3Bw"
        "LWFycm93IHZlcnNpb24gMjEuMC4wGVwcAAAcAAAcAAAcAAAcAAAA0QMAAFBBUjE="
    )
    parquet_path.write_bytes(base64.b64decode(parquet_b64))

    class ReferenceDatasetDouble:
        def to_io_spec(self):
            return (
                {
                    "sources": [
                        {
                            "id": "x",
                            "role": "mixed",
                            "input": "X.parquet",
                            "columns": [
                                {"role": "features", "select": ["400", "410"]},
                                {"role": "targets", "select": ["y"]},
                                {"role": "metadata", "select": ["sample", "flag"]},
                            ],
                        }
                    ]
                },
                tmp_path,
            )

    assembled = nio.load(ReferenceDatasetDouble(), target="assembled")
    block = assembled["blocks"]["train"]
    assert block["x_shapes"] == [[3, 2]]
    assert block["y_shape"] == [3, 1]
    assert block["metadata_columns"] == ["sample", "flag"]

    single_file = nio.load(tmp_path / "X.parquet", target="assembled")
    assert single_file["blocks"]["train"]["x_shapes"] == [[3, 5]]


def test_load_applies_native_na_policy_from_public_binding(tmp_path):
    csv_path = tmp_path / "X.csv"
    csv_path.write_text("1000;1005\n1;\n2;3\n", encoding="utf-8")

    assembled = nio.load(
        {
            "sources": [
                {
                    "id": "x",
                    "role": "features",
                    "input": str(csv_path),
                    "params": {"na": {"policy": "replace", "fill": {"method": "value", "fill_value": 7.0}}},
                }
            ]
        },
        target="assembled",
        name="native-na",
    )
    block = assembled["blocks"]["train"]

    assert block["feature_headers"] == [["1000", "1005"]]
    assert block["x_shapes"] == [[2, 2]]
    assert block["x"] == [[[1.0, 7.0], [2.0, 3.0]]]


def test_load_parquet_applies_native_na_policy_from_public_binding(tmp_path):
    parquet_path = tmp_path / "X.parquet"
    parquet_b64 = (
        "UEFSMRUEFSAVJEwVBBUAEgAAEDwAAAAAAADwPwAAAAAAAABAFQAVEhUWLBUEFRAVBhUGHBgIAAAAAAAAAEAYCAAAAAAAAPA/FgAoCAAAAAAAAABAGAgAAAAAAADwPxERAAAACSACAAAABAEBAwIVBBUQ"
        "FRRMFQIVABIAAAgcAAAAAAAACEAVABUSFRYsFQQVEBUGFQYcGAgAAAAAAAAIQBgIAAAAAAAACEAWAigIAAAAAAAACEAYCAAAAAAAAAhAEREAAAAJIAIAAAADAgECABUEGTw1ABgGc2NoZW1hFQQAFQol"
        "AhgEMTAwMAAVCiUCGAQxMDA1ABYEGRwZLCYAHBUKGTUABhAZGAQxMDAwFQIWBBbMARbUASZIJggcGAgAAAAAAAAAQBgIAAAAAAAA8D8WACgIAAAAAAAAAEAYCAAAAAAAAPA/EREAGSwVBBUAFQIAFQAV"
        "EBUCADwpBhkmAAQAAAAmABwVChk1AAYQGRgEMTAwNRUCFgQWvAEWxAEmjAIm3AEcGAgAAAAAAAAIQBgIAAAAAAAACEAWAigIAAAAAAAACEAYCAAAAAAAAAhAEREAGSwVBBUAFQIAFQAVEBUCADwpBhkm"
        "AgIAAAAWiAMWBCYIFpgDABkcGAxBUlJPVzpzY2hlbWEY7AEvLy8vLzZnQUFBQVFBQUFBQUFBS0FBd0FCZ0FGQUFnQUNnQUFBQUFCQkFBTUFBQUFDQUFJQUFBQUJBQUlBQUFBQkFBQUFBSUFBQUJFQUFB"
        "QUJBQUFBTlQvLy84QUFBRURFQUFBQUJnQUFBQUVBQUFBQUFBQUFBUUFBQUF4TURBMUFBQUFBTWIvLy84QUFBSUFFQUFVQUFnQUJnQUhBQXdBQUFBUUFCQUFBQUFBQUFFREVBQUFBQndBQUFBRUFBQUFBQUFB"
        "QUFRQUFBQXhNREF3QUFBR0FBZ0FCZ0FHQUFBQUFBQUNBQUFBQUFBPQAYIHBhcnF1ZXQtY3BwLWFycm93IHZlcnNpb24gMjQuMC4wGSwcAAAcAAAAMwIAAFBBUjE="
    )
    _write_b64(parquet_path, parquet_b64)

    assembled = nio.load(
        {
            "sources": [
                {
                    "id": "x",
                    "role": "features",
                    "input": str(parquet_path),
                    "params": {"na": {"policy": "replace", "fill": {"method": "value", "fill_value": 7.0}}},
                }
            ]
        },
        target="assembled",
    )
    block = assembled["blocks"]["train"]

    assert block["feature_headers"] == [["1000", "1005"]]
    assert block["x"] == [[[1.0, 7.0], [2.0, 3.0]]]


def test_load_parquet_projection_skips_unsupported_unselected_column(tmp_path):
    parquet_path = tmp_path / "X.parquet"
    parquet_b64 = (
        "UEFSMRUEFSAVJEwVBBUAEgAAEDwAAAAAAADwPwAAAAAAAABAFQAVEhUWLBUEFRAVBhUGHBgIAAAAAAAAAEAYCAAAAAAAAPA/FgAoCAAAAAAAAABAGAgAAAAAAADwPxERAAAACSACAAAABAEBAwIVBBUQ"
        "FRRMFQQVABIAAAgcAQAAAAIAAAAVABUSFRYsFQQVEBUGFQYcGAQCAAAAGAQBAAAAFgAoBAIAAAAYBAEAAAAREQAAAAkgAgAAAAQBAQMCFQQZPDUAGAZzY2hlbWEVBAAVCiUCGAQxMDAwABUCJQIYEHVu"
        "c3VwcG9ydGVkX2RhdGUlDExsAAAAFgQZHBksJgAcFQoZNQAGEBkYBDEwMDAVAhYEFswBFtQBJkgmCBwYCAAAAAAAAABAGAgAAAAAAADwPxYAKAgAAAAAAAAAQBgIAAAAAAAA8D8REQAZLBUEFQAVAgAV"
        "ABUQFQIAPCkGGSYABAAAACYAHBUCGTUABhAZGBB1bnN1cHBvcnRlZF9kYXRlFQIWBBacARakASaMAibcARwYBAIAAAAYBAEAAAAWACgEAgAAABgEAQAAABERABksFQQVABUCABUAFRAVAgA8KQYZJgAE"
        "AAAAFugCFgQmCBb4AgAZHBgMQVJST1c6c2NoZW1hGPgBLy8vLy83QUFBQUFRQUFBQUFBQUtBQXdBQmdBRkFBZ0FDZ0FBQUFBQkJBQU1BQUFBQ0FBSUFBQUFCQUFJQUFBQUJBQUFBQUlBQUFCUUFBQUFC"
        "QUFBQU1qLy8vOEFBQUVJRUFBQUFDUUFBQUFFQUFBQUFBQUFBQkFBQUFCMWJuTjFjSEJ2Y25SbFpGOWtZWFJsQUFBQUFNYi8vLzhBQUFBQUVBQVVBQWdBQmdBSEFBd0FBQUFRQUJBQUFBQUFBQUVERUFB"
        "QUFCd0FBQUFFQUFBQUFBQUFBQVFBQUFBeE1EQXdBQUFHQUFnQUJnQUdBQUFBQUFBQ0FBPT0AGCBwYXJxdWV0LWNwcC1hcnJvdyB2ZXJzaW9uIDI0LjAuMBksHAAAHAAAAE0CAABQQVIx"
    )
    _write_b64(parquet_path, parquet_b64)

    assembled = nio.load(
        {
            "sources": [
                {
                    "id": "x",
                    "role": "features",
                    "input": str(parquet_path),
                    "params": {"format": {"columns": ["1000"]}},
                }
            ]
        },
        target="assembled",
    )
    block = assembled["blocks"]["train"]

    assert block["feature_headers"] == [["1000"]]
    assert block["x"] == [[[1.0], [2.0]]]


def test_validate_rejects_invalid_typed_path():
    with pytest.raises(ValueError):
        nio.validate({"partitions": {"by": "random"}})


def test_public_surface_unchanged():
    # The historical names plus the new typed classes are all exported.
    for name in (
        "infer",
        "to_spec",
        "validate",
        "load",
        "to_dataset_package",
        "describe_dataset_package",
        "to_spectrodataset",
        "__version__",
    ):
        assert name in nio.__all__
    assert "DatasetPlan" in nio.__all__ and "DatasetSpec" in nio.__all__
    assert "DatasetPackage" in nio.__all__
