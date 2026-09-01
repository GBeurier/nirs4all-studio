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
