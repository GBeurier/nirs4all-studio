"""Tests for the Phase 0 filesystem path-containment helpers.

Covers ``api.shared.paths``:
- ``is_within_directory`` true/false cases (including ``..`` escapes).
- ``reject_absolute_or_traversal`` rejecting absolute paths and ``..``.
- ``resolve_within`` joining safely and refusing escapes.
- A Zip-Slip member being rejected by the same containment check the
  workspace import endpoint uses.
"""

import os
import zipfile
from pathlib import Path

import pytest

from api.shared.paths import (
    is_within_directory,
    reject_absolute_or_traversal,
    resolve_within,
)


# --------------------------------------------------------------------------- #
# is_within_directory
# --------------------------------------------------------------------------- #


def test_is_within_directory_nested(tmp_path: Path) -> None:
    base = tmp_path / "workspace"
    base.mkdir()
    target = base / "models" / "model.joblib"
    assert is_within_directory(base, target) is True


def test_is_within_directory_equal(tmp_path: Path) -> None:
    base = tmp_path / "workspace"
    base.mkdir()
    assert is_within_directory(base, base) is True


def test_is_within_directory_sibling_is_rejected(tmp_path: Path) -> None:
    base = tmp_path / "workspace"
    sibling = tmp_path / "workspace_evil"
    base.mkdir()
    sibling.mkdir()
    # A prefix-string sibling must not be treated as contained.
    assert is_within_directory(base, sibling) is False


def test_is_within_directory_traversal_escape_is_rejected(tmp_path: Path) -> None:
    base = tmp_path / "workspace"
    base.mkdir()
    escaping = base / ".." / ".." / "etc" / "passwd"
    assert is_within_directory(base, escaping) is False


def test_is_within_directory_absolute_outside_is_rejected(tmp_path: Path) -> None:
    base = tmp_path / "workspace"
    base.mkdir()
    assert is_within_directory(base, "/etc/passwd") is False


# --------------------------------------------------------------------------- #
# reject_absolute_or_traversal
# --------------------------------------------------------------------------- #


def test_reject_absolute_or_traversal_passes_plain_name() -> None:
    assert reject_absolute_or_traversal("model_123") == "model_123"
    assert reject_absolute_or_traversal("sub/dir/model.joblib") == "sub/dir/model.joblib"


def test_reject_absolute_or_traversal_rejects_absolute() -> None:
    with pytest.raises(ValueError):
        reject_absolute_or_traversal("/etc/passwd")


def test_reject_absolute_or_traversal_rejects_traversal() -> None:
    with pytest.raises(ValueError):
        reject_absolute_or_traversal("../../x")


def test_reject_absolute_or_traversal_rejects_windows_drive() -> None:
    with pytest.raises(ValueError):
        reject_absolute_or_traversal("C:\\Windows\\System32")


def test_reject_absolute_or_traversal_rejects_backslash_traversal() -> None:
    with pytest.raises(ValueError):
        reject_absolute_or_traversal("..\\..\\x")


def test_reject_absolute_or_traversal_rejects_empty() -> None:
    with pytest.raises(ValueError):
        reject_absolute_or_traversal("")


# --------------------------------------------------------------------------- #
# resolve_within
# --------------------------------------------------------------------------- #


def test_resolve_within_joins_safely(tmp_path: Path) -> None:
    base = tmp_path / "models"
    base.mkdir()
    resolved = resolve_within(base, "model_42.joblib")
    assert resolved == base / "model_42.joblib"
    assert is_within_directory(base, resolved)


def test_resolve_within_rejects_traversal(tmp_path: Path) -> None:
    base = tmp_path / "models"
    base.mkdir()
    with pytest.raises(ValueError):
        resolve_within(base, "../../etc/passwd")


def test_resolve_within_rejects_absolute(tmp_path: Path) -> None:
    base = tmp_path / "models"
    base.mkdir()
    with pytest.raises(ValueError):
        resolve_within(base, "/etc/passwd")


# --------------------------------------------------------------------------- #
# Zip-Slip
# --------------------------------------------------------------------------- #


def test_zip_slip_member_is_rejected(tmp_path: Path) -> None:
    """A malicious archive member that escapes the destination is detected."""
    archive_path = tmp_path / "evil.zip"
    with zipfile.ZipFile(archive_path, "w") as zf:
        zf.writestr("good/file.txt", "ok")
        zf.writestr("../../../etc/evil.txt", "pwned")

    destination = tmp_path / "dest"
    destination.mkdir()

    safe_members = []
    rejected_members = []
    with zipfile.ZipFile(archive_path, "r") as zf:
        for item in zf.namelist():
            target = destination / item
            if is_within_directory(destination, target):
                safe_members.append(item)
            else:
                rejected_members.append(item)

    assert "good/file.txt" in safe_members
    assert any("evil.txt" in member for member in rejected_members)
    assert not (tmp_path / "etc" / "evil.txt").exists()


def test_zip_slip_absolute_member_is_rejected(tmp_path: Path) -> None:
    destination = tmp_path / "dest"
    destination.mkdir()
    # An absolute-style member name joined onto the destination escapes it.
    target = destination / os.path.join("nested", "..", "..", "outside.txt")
    assert is_within_directory(destination, target) is False


def test_resolve_bundle_path_confined_to_workspace_exports(tmp_path: Path, monkeypatch) -> None:
    """_resolve_bundle_path must not resolve/delete bundles outside the workspace.

    Regression guard for the Codex Phase 0 review finding: an absolute path that
    exists outside <workspace>/workspace/exports was previously accepted, letting
    DELETE /models/trained/{id:path} unlink arbitrary files.
    """
    from fastapi import HTTPException

    import api.models as models

    exports = tmp_path / "workspace" / "exports"
    exports.mkdir(parents=True)
    inside = exports / "good.n4a"
    inside.write_bytes(b"bundle")
    outside = tmp_path / "evil.n4a"
    outside.write_bytes(b"bundle")

    class _WS:
        path = str(tmp_path)

    monkeypatch.setattr(models.workspace_manager, "get_current_workspace", lambda: _WS())

    # Absolute path inside exports resolves; bare filename resolves via search.
    assert models._resolve_bundle_path(str(inside)) == inside
    assert models._resolve_bundle_path("good") == inside
    # Absolute path outside exports is refused (404) even though it exists.
    with pytest.raises(HTTPException) as exc_abs:
        models._resolve_bundle_path(str(outside))
    assert exc_abs.value.status_code == 404
    # Relative traversal is refused (400).
    with pytest.raises(HTTPException) as exc_trav:
        models._resolve_bundle_path("../../etc/passwd")
    assert exc_trav.value.status_code == 400
