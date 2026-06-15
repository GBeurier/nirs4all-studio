"""Tests for in-place update capability detection and the apply guardrail.

These lock the redirect-to-installer policy: builds that can't be replaced on
disk (per-machine Windows, .deb, AppImage, DMG) must report ``can_apply_in_place
= False`` and the apply endpoint must refuse BEFORE the app is asked to quit.
"""

from pathlib import Path

import pytest
from fastapi import HTTPException

from api.updates import staging
from api.updates.app_updates import ApplyUpdateRequest, apply_webapp_update


def test_capability_portable_is_in_place(monkeypatch):
    monkeypatch.setattr(staging, "_is_portable_runtime", lambda: True)
    cap = staging.get_update_capability()
    assert cap["can_apply_in_place"] is True
    assert cap["channel"] == "in_place"
    assert cap["reason"] == "portable"


def test_capability_appimage_is_installer(monkeypatch):
    monkeypatch.setattr(staging, "_is_portable_runtime", lambda: False)
    monkeypatch.setenv("APPIMAGE", "/tmp/nirs4all.AppImage")
    cap = staging.get_update_capability()
    assert cap["can_apply_in_place"] is False
    assert cap["channel"] == "installer"
    assert cap["reason"] == "appimage"


def test_capability_writable_location_is_in_place(monkeypatch):
    monkeypatch.setattr(staging, "_is_portable_runtime", lambda: False)
    monkeypatch.delenv("APPIMAGE", raising=False)
    monkeypatch.setattr(staging, "_path_is_writable", lambda _p: True)
    cap = staging.get_update_capability()
    assert cap["can_apply_in_place"] is True
    assert cap["reason"] == "writable"


def test_capability_read_only_location_is_installer(monkeypatch):
    monkeypatch.setattr(staging, "_is_portable_runtime", lambda: False)
    monkeypatch.delenv("APPIMAGE", raising=False)
    monkeypatch.setattr(staging, "_path_is_writable", lambda _p: False)
    cap = staging.get_update_capability()
    assert cap["can_apply_in_place"] is False
    assert cap["channel"] == "installer"
    assert cap["reason"] == "read_only_location"


def test_capability_macos_probes_app_parent(monkeypatch):
    """macOS replaces the whole .app from its parent dir, so capability must
    probe the PARENT (e.g. /Applications), not the .app's own contents."""
    import updater

    monkeypatch.setattr(staging, "_is_portable_runtime", lambda: False)
    monkeypatch.delenv("APPIMAGE", raising=False)
    monkeypatch.setattr(staging.platform, "system", lambda: "Darwin")

    app = Path("/Applications/nirs4all Studio.app")
    monkeypatch.setattr(updater, "get_app_directory", lambda: app)

    probed: dict[str, Path] = {}

    def fake_writable(path: Path) -> bool:
        probed["dir"] = path
        return False

    monkeypatch.setattr(staging, "_path_is_writable", fake_writable)

    cap = staging.get_update_capability()

    assert probed["dir"] == app.parent  # /Applications, not the .app bundle
    assert cap["can_apply_in_place"] is False
    assert cap["channel"] == "installer"


async def test_apply_refuses_before_quit_when_not_in_place(monkeypatch):
    """The apply endpoint must 400 (without launching the updater / quitting)
    for installer-only builds."""
    import api.updates.app_updates as app_updates

    monkeypatch.setattr(
        app_updates,
        "get_update_capability",
        lambda: {"can_apply_in_place": False, "channel": "installer", "reason": "read_only_location", "install_kind": "windows-installer"},
    )

    with pytest.raises(HTTPException) as exc:
        await apply_webapp_update(ApplyUpdateRequest(confirm=True))

    assert exc.value.status_code == 400
    assert exc.value.detail["update_channel"] == "installer"
