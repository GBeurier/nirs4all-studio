"""Characterization tests for the datasets detection endpoints.

These pin the JSON contract of the three folder/file detection endpoints
(``detect-unified``, ``detect-files-list``, ``scan-folder``) so the
boundary/dedup refactor in T2.3 stays behavior-preserving.

The detection endpoints require nirs4all's ML dependencies to be loaded.
The tests warm the lazy-import cache once, build a small standard NIRS
dataset fixture (Xcal/Ycal/Xval/Yval/Mcal) and assert on the responses.
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))


def _ml_ready() -> bool:
    try:
        import api.datasets  # noqa: F401  (break circular import before warming)
        from api.lazy_imports import _do_load_ml_deps, is_ml_ready

        if not is_ml_ready():
            _do_load_ml_deps()
        return is_ml_ready()
    except Exception:
        return False


pytestmark = pytest.mark.skipif(
    not _ml_ready(), reason="nirs4all ML dependencies not available"
)


@pytest.fixture()
def standard_dataset(tmp_path: Path) -> Path:
    """Standard NIRS dataset folder: train/test X + Y plus train metadata."""
    folder = tmp_path / "mydataset"
    folder.mkdir()
    (folder / "Xcal.csv").write_text("1000;2000;3000\n0.1;0.2;0.3\n0.4;0.5;0.6\n0.7;0.8;0.9\n")
    (folder / "Ycal.csv").write_text("target\n1.0\n2.0\n3.0\n")
    (folder / "Xval.csv").write_text("1000;2000;3000\n0.15;0.25;0.35\n0.45;0.55;0.65\n")
    (folder / "Yval.csv").write_text("target\n1.5\n2.5\n")
    (folder / "Mcal.csv").write_text("group;site\nA;1\nB;2\nA;3\n")
    return folder


def _file_roles(files: list[dict]) -> dict[str, tuple[str, str]]:
    """Map filename -> (type, split) ignoring order."""
    return {f["filename"]: (f["type"], f["split"]) for f in files}


def test_detect_unified_standard(standard_dataset: Path):
    from api.datasets import DetectFilesRequest, detect_unified

    resp = asyncio.run(detect_unified(DetectFilesRequest(path=str(standard_dataset))))
    data = resp.model_dump()

    assert data["folder_name"] == "mydataset"
    assert data["has_standard_structure"] is True
    assert data["has_fold_file"] is False
    assert data["fold_file_path"] is None
    assert data["warnings"] == []

    roles = _file_roles(data["files"])
    assert roles == {
        "Xcal.csv": ("X", "train"),
        "Xval.csv": ("X", "test"),
        "Ycal.csv": ("Y", "train"),
        "Yval.csv": ("Y", "test"),
        "Mcal.csv": ("metadata", "train"),
    }
    # Unified assigns 0.95 confidence and no source for single-file roles.
    for f in data["files"]:
        assert f["confidence"] == 0.95
        assert f["source"] is None
        assert f["num_rows"] is not None
        assert f["num_columns"] is not None

    assert data["parsing_options"]["delimiter"] == ";"
    assert data["parsing_options"]["decimal_separator"] == "."
    assert set(data["confidence"].keys()) >= {"delimiter", "decimal_separator"}
    assert data["parsing_options"]["has_header"] is False
    assert data["metadata_columns"] == ["group", "site"]
    by_name = {f["filename"]: f for f in data["files"]}
    assert by_name["Ycal.csv"]["overrides"]["has_header"] is True
    assert by_name["Mcal.csv"]["overrides"]["has_header"] is True


def test_detect_files_list_standard(standard_dataset: Path):
    from api.datasets import DetectFilesListRequest, detect_files_list

    paths = [
        str(standard_dataset / "Xcal.csv"),
        str(standard_dataset / "Ycal.csv"),
        str(standard_dataset / "Xval.csv"),
        str(standard_dataset / "Yval.csv"),
        str(standard_dataset / "Mcal.csv"),
    ]
    resp = asyncio.run(detect_files_list(DetectFilesListRequest(paths=paths)))
    data = resp.model_dump()

    assert data["has_standard_structure"] is True
    assert data["has_fold_file"] is False
    assert data["warnings"] == []

    # detect-files-list preserves INPUT order.
    assert [f["filename"] for f in data["files"]] == [
        "Xcal.csv", "Ycal.csv", "Xval.csv", "Yval.csv", "Mcal.csv",
    ]
    roles = _file_roles(data["files"])
    assert roles == {
        "Xcal.csv": ("X", "train"),
        "Ycal.csv": ("Y", "train"),
        "Xval.csv": ("X", "test"),
        "Yval.csv": ("Y", "test"),
        "Mcal.csv": ("metadata", "train"),
    }
    # X files carry source=1 and matched files carry 0.9 confidence.
    by_name = {f["filename"]: f for f in data["files"]}
    assert by_name["Xcal.csv"]["source"] == 1
    assert by_name["Xval.csv"]["source"] == 1
    assert by_name["Ycal.csv"]["source"] is None
    for f in data["files"]:
        assert f["confidence"] == 0.9
        assert f["num_rows"] is not None
        assert f["num_columns"] is not None

    assert data["parsing_options"]["delimiter"] == ";"
    assert data["metadata_columns"] == ["group", "site"]
    by_name = {f["filename"]: f for f in data["files"]}
    assert by_name["Ycal.csv"]["overrides"]["has_header"] is True
    assert by_name["Mcal.csv"]["overrides"]["has_header"] is True


def test_detect_files_list_unknown_file(standard_dataset: Path):
    """Unknown (non-pattern) files surface as type=unknown with 0.3 confidence."""
    from api.datasets import DetectFilesListRequest, detect_files_list

    other = standard_dataset / "notes.csv"
    other.write_text("a;b\n1;2\n")
    paths = [str(standard_dataset / "Xcal.csv"), str(other)]
    resp = asyncio.run(detect_files_list(DetectFilesListRequest(paths=paths)))
    by_name = {f["filename"]: f for f in resp.model_dump()["files"]}
    assert by_name["Xcal.csv"]["type"] == "X"
    assert by_name["notes.csv"]["type"] == "unknown"
    assert by_name["notes.csv"]["confidence"] == 0.3
    assert by_name["notes.csv"]["split"] == "train"


def test_detect_files_list_missing_file(standard_dataset: Path):
    from api.datasets import DetectFilesListRequest, detect_files_list

    paths = [str(standard_dataset / "nope.csv"), str(standard_dataset / "Xcal.csv")]
    resp = asyncio.run(detect_files_list(DetectFilesListRequest(paths=paths)))
    data = resp.model_dump()
    assert [f["filename"] for f in data["files"]] == ["Xcal.csv"]
    assert any("not found" in w.lower() for w in data["warnings"])


def test_detect_files_list_folds_excluded(tmp_path: Path):
    """A folds file is recorded but excluded from the files list."""
    from api.datasets import DetectFilesListRequest, detect_files_list

    folder = tmp_path / "ds"
    folder.mkdir()
    (folder / "Xcal.csv").write_text("1;2\n0.1;0.2\n0.3;0.4\n")
    (folder / "Ycal.csv").write_text("t\n1\n2\n")
    (folder / "folds.csv").write_text("fold\n0\n1\n")
    paths = [str(folder / "Xcal.csv"), str(folder / "Ycal.csv"), str(folder / "folds.csv")]
    resp = asyncio.run(detect_files_list(DetectFilesListRequest(paths=paths)))
    data = resp.model_dump()
    assert "folds.csv" not in [f["filename"] for f in data["files"]]
    assert data["has_fold_file"] is True
    assert data["fold_file_path"] == str(folder / "folds.csv")


def test_scan_folder_standard(standard_dataset: Path):
    from api.datasets import ScanFolderRequest, scan_folder

    root = standard_dataset.parent  # contains the single dataset folder
    resp = asyncio.run(scan_folder(ScanFolderRequest(path=str(root))))
    data = resp.model_dump()

    assert data["success"] is True
    assert data["total_scanned_folders"] >= 1
    assert len(data["datasets"]) == 1

    ds = data["datasets"][0]
    assert ds["folder_name"] == "mydataset"
    roles = _file_roles(ds["files"])
    assert roles == {
        "Xcal.csv": ("X", "train"),
        "Xval.csv": ("X", "test"),
        "Ycal.csv": ("Y", "train"),
        "Yval.csv": ("Y", "test"),
        "Mcal.csv": ("metadata", "train"),
    }
    by_name = {f["filename"]: f for f in ds["files"]}
    assert by_name["Xcal.csv"]["source"] == 1
    assert by_name["Ycal.csv"]["source"] is None
    for f in ds["files"]:
        assert f["confidence"] == 0.9
    assert ds["parsing_options"]["delimiter"] == ";"
    assert ds["metadata_columns"] == ["group", "site"]
    by_name = {f["filename"]: f for f in ds["files"]}
    assert by_name["Ycal.csv"]["overrides"]["has_header"] is True
    assert by_name["Mcal.csv"]["overrides"]["has_header"] is True


def test_no_private_attribute_access_in_module():
    """Guard: api/datasets.py must not poke nirs4all private parser internals."""
    src = (Path(__file__).parent.parent / "api" / "datasets.py").read_text()
    # Underscore-prefixed nirs4all parser methods used via `parser.<name>`.
    assert "parser._" not in src
    assert "._pattern_matches" not in src
    assert "._get_stem" not in src
    assert "._has_supported_extension" not in src
    # The role-detection table is nirs4all's internal surface; the webapp must
    # route through the public FolderParser instead of importing/re-running it.
    assert "FILE_PATTERNS" not in src


@pytest.mark.parametrize("policy", ["auto", "ignore", "abort"])
def test_validate_metadata_missing_values_and_repetition_columns(tmp_path: Path, policy: str):
    from api.datasets import ValidateFilesRequest, validate_files

    (tmp_path / "Mcal.csv").write_text("sample_id;batch\n101;A\n102;\n103;B\n")
    response = asyncio.run(validate_files(ValidateFilesRequest(
        path=str(tmp_path),
        files=[{"path": "Mcal.csv", "filename": "Mcal.csv", "type": "metadata", "split": "train"}],
        parsing={"has_header": True, "na_policy": "auto"},
        per_file_overrides={"Mcal.csv": {"na_policy": policy}},
    )))
    shape = response.shapes["Mcal.csv"]
    if policy == "abort":
        assert shape.error
    else:
        assert shape.error is None
        assert shape.num_rows == 3
        assert shape.column_names == ["sample_id", "batch"]


def test_validate_disabled_detected_override_uses_global_parsing(tmp_path: Path):
    from api.datasets import ValidateFilesRequest, validate_files

    (tmp_path / "Ycal.csv").write_text("target\n1\n2\n")
    response = asyncio.run(validate_files(ValidateFilesRequest(
        path=str(tmp_path),
        files=[{"path": "Ycal.csv", "filename": "Ycal.csv", "type": "Y", "split": "train", "overrides": {"has_header": False}}],
        parsing={"has_header": True},
        per_file_overrides={"Ycal.csv": {}},
    )))
    shape = response.shapes["Ycal.csv"]
    assert shape.error is None
    assert shape.num_rows == 2
    assert shape.column_names == ["target"]


@pytest.mark.parametrize("metadata_policy", ["auto", "ignore"])
def test_saved_dataset_reloads_missing_metadata_and_repetition_configuration(tmp_path: Path, metadata_policy: str):
    """Exercise the actual native loader used after link and stored preview."""
    from nirs4all.api.dataset_inspection import load_dataset_for_analysis

    from api.library_dataset_inspection import inspect_dataset_document
    from api.library_documents import configure_dataset

    for name, content in {
        "Xtrain.csv": "1000;1100\n1;2\n3;4\n",
        "Ytrain.csv": "target\n1\n2\n",
        "Mtrain.csv": "sample_id;nirs_Remarque\nsample-a;\nsample-a;ok\n",
    }.items():
        (tmp_path / name).write_text(content)
    record = {
        "path": str(tmp_path), "name": "Repeated metadata",
        "config": {
            "files": [
                {"path": "Xtrain.csv", "type": "X", "split": "train"},
                {"path": "Ytrain.csv", "type": "Y", "split": "train"},
                {"path": "Mtrain.csv", "type": "metadata", "split": "train", "overrides": {"na_policy": metadata_policy}},
            ],
            "delimiter": ";", "has_header": True, "na_policy": "auto",
            "aggregation": {"enabled": True, "column": "sample_id", "method": "mean"},
        },
    }
    persisted = tmp_path / "dataset.json"
    persisted.write_text(json.dumps(record))
    config = configure_dataset({"record": json.loads(persisted.read_text())})
    assert config["aggregate"] == config["repetition"] == "sample_id"
    assert config["aggregate_method"] == "mean"
    assert config["train_group_params"]["na_policy"] == "ignore"
    assert config["train_group_params"]["na"] == {"policy": "ignore"}
    # Native HTTP preview normalizes the wizard request, then the inspection
    # service normalizes that library config a second time as a stored record.
    configured_again = configure_dataset({"record": {"path": str(tmp_path), "config": config}})
    assert configured_again == config
    config = configured_again
    dataset, _reader = load_dataset_for_analysis(config)
    assert dataset.repetition == dataset.aggregate == "sample_id"
    preview = inspect_dataset_document("dataset.preview", {"config": config, "max_samples": 2})
    assert preview["success"] is True
    assert not preview.get("error")
    assert preview["summary"]["num_samples"] == 2
    assert preview["summary"]["metadata_columns"] == ["sample_id", "nirs_Remarque"]


def test_configured_library_record_keeps_source_params_and_fold_settings(tmp_path: Path):
    from api.library_documents import configure_dataset

    config = {
        "name": "Configured", "train_x": str(tmp_path / "Xtrain.csv"),
        "train_group": str(tmp_path / "Mtrain.csv"),
        "global_params": {"delimiter": ",", "has_header": False, "na": {"policy": "abort"}},
        "train_x_params": {"delimiter": ";", "header_unit": "nm", "signal_type": "reflectance"},
        "train_group_params": {"has_header": True, "na_policy": "ignore", "na": {"policy": "ignore"}},
        "train_x_filter": [0, 1], "repetition": "sample_id", "aggregate": "sample_id",
        "aggregate_method": "median", "folds": [{"train": [0], "test": [1]}],
    }
    assert configure_dataset({"record": {"path": str(tmp_path), "config": config}}) == config


def test_legacy_flat_dataset_record_still_translates_root_parsing(tmp_path: Path):
    from api.library_documents import configure_dataset

    config = configure_dataset({"record": {"path": str(tmp_path), "config": {
        "train_x": str(tmp_path / "Xtrain.csv"), "delimiter": ",", "has_header": False,
    }}})
    assert config["global_params"]["delimiter"] == ","
    assert config["global_params"]["has_header"] is False


@pytest.mark.parametrize("with_globals", [False, True])
def test_existing_library_configs_preserve_na_and_repetitions_on_reload(tmp_path: Path, with_globals: bool):
    from api.library_dataset_inspection import inspect_dataset_document
    from api.library_documents import configure_dataset

    (tmp_path / "X.csv").write_text("1000;1100\n1;2\n3;4\n")
    (tmp_path / "M.csv").write_text("sample_id;note\na;\na;ok\n")
    stored = {
        "train_x": str(tmp_path / "X.csv"), "train_group": str(tmp_path / "M.csv"),
        "train_x_params": {"header_unit": "nm", "has_header": True},
        "train_group_params": {"has_header": True, "na_policy": "ignore"},
        "repetition": "sample_id", "aggregate": "sample_id", "aggregate_method": "median",
        "folds": [{"train": [0], "test": [1]}],
    }
    if with_globals:
        stored["global_params"] = {"delimiter": ";", "has_header": True, "na_policy": "ignore"}
    config = configure_dataset({"record": {"path": str(tmp_path), "config": stored}})
    assert config["repetition"] == config["aggregate"] == "sample_id"
    assert config["aggregate_method"] == "median"
    assert config["folds"] == stored["folds"]
    assert config["train_x_params"]["header_unit"] == "nm"
    assert config["train_group_params"]["na"] == {"policy": "ignore"}
    assert configure_dataset({"record": {"path": str(tmp_path), "config": config}}) == config
    preview = inspect_dataset_document("dataset.preview", {"config": config, "max_samples": 2})
    assert preview["success"] is True
    assert preview["summary"]["num_samples"] == 2
    assert preview["summary"]["metadata_columns"] == ["sample_id", "note"]


@pytest.mark.parametrize("top_level", [False, True])
def test_stored_role_files_honor_shared_parsing_and_explicit_root_precedence(tmp_path: Path, top_level: bool):
    from api.library_dataset_inspection import inspect_dataset_document
    from api.library_documents import configure_dataset

    (tmp_path / "X.csv").write_text("1,2\n3,4\n")
    stored = {
        "files": [{"path": "X.csv", "type": "X", "split": "train"}],
        "global_params": {"delimiter": ",", "has_header": False},
    }
    if top_level:
        stored["global_params"] = {"delimiter": ";", "has_header": True}
        stored.update({"delimiter": ",", "has_header": False})
    config = configure_dataset({"record": {"path": str(tmp_path), "config": stored}})
    assert config["global_params"]["delimiter"] == ","
    assert config["global_params"]["has_header"] is False
    preview = inspect_dataset_document("dataset.preview", {"config": config, "max_samples": 2})
    assert preview["summary"]["num_samples"] == preview["summary"]["num_features"] == 2
