"""Tests for in-place update capability detection and the apply guardrail.

These lock the redirect-to-installer policy. Two things gate an in-place
self-update:
- the install KIND (only ``portable`` and ``bundled`` all-in-one own their
  whole tree; a ``managed`` installer build / AppImage must use the installer
  channel even when its dir is writable), and
- the target dir being actually writable (a portable build on a read-only
  USB/share is not updatable).

Builds that can't be replaced on disk must report ``can_apply_in_place = False``
and the apply endpoint must refuse BEFORE the app is asked to quit.
"""

from pathlib import Path

import pytest
from fastapi import HTTPException

from api.updates import staging
from api.updates.app_updates import ApplyUpdateRequest, apply_webapp_update


def test_capability_portable_writable_is_in_place(monkeypatch):
    monkeypatch.setattr(staging, "_is_portable_runtime", lambda: True)
    monkeypatch.setattr(staging, "_probe_app_dir_writable", lambda: True)
    cap = staging.get_update_capability()
    assert cap["can_apply_in_place"] is True
    assert cap["channel"] == "in_place"
    assert cap["reason"] == "portable"


def test_capability_portable_read_only_is_installer(monkeypatch):
    """A portable build on a read-only USB stick / network share must not be
    treated as updatable in place — the apply step could quit an app it cannot
    replace and relaunch."""
    monkeypatch.setattr(staging, "_is_portable_runtime", lambda: True)
    monkeypatch.setattr(staging, "_probe_app_dir_writable", lambda: False)
    cap = staging.get_update_capability()
    assert cap["can_apply_in_place"] is False
    assert cap["channel"] == "installer"
    assert cap["reason"] == "read_only_location"


def test_capability_appimage_is_installer(monkeypatch):
    monkeypatch.setattr(staging, "_is_portable_runtime", lambda: False)
    monkeypatch.setenv("APPIMAGE", "/tmp/nirs4all.AppImage")
    cap = staging.get_update_capability()
    assert cap["can_apply_in_place"] is False
    assert cap["channel"] == "installer"
    assert cap["reason"] == "appimage"


def test_capability_bundled_writable_is_in_place(monkeypatch):
    """The all-in-one bundle owns its whole tree, so a writable bundled runtime
    updates in place."""
    monkeypatch.setattr(staging, "_is_portable_runtime", lambda: False)
    monkeypatch.delenv("APPIMAGE", raising=False)
    monkeypatch.setenv("NIRS4ALL_RUNTIME_MODE", "bundled")
    monkeypatch.setattr(staging, "_probe_app_dir_writable", lambda: True)
    cap = staging.get_update_capability()
    assert cap["can_apply_in_place"] is True
    assert cap["channel"] == "in_place"
    assert cap["reason"] == "bundled"
    assert cap["install_kind"] == "all-in-one"


def test_capability_bundled_read_only_is_installer(monkeypatch):
    monkeypatch.setattr(staging, "_is_portable_runtime", lambda: False)
    monkeypatch.delenv("APPIMAGE", raising=False)
    monkeypatch.setenv("NIRS4ALL_RUNTIME_MODE", "bundled")
    monkeypatch.setattr(staging, "_probe_app_dir_writable", lambda: False)
    cap = staging.get_update_capability()
    assert cap["can_apply_in_place"] is False
    assert cap["channel"] == "installer"
    assert cap["reason"] == "read_only_location"


def test_capability_managed_installer_is_installer_even_when_writable(monkeypatch):
    """The core of finding #3: a per-user installer build (writable install dir)
    must STILL route to the installer channel — overlaying an all-in-one archive
    on it would desync the installer/uninstaller state, runtime model, and
    shortcuts. Writability alone is not enough."""
    monkeypatch.setattr(staging, "_is_portable_runtime", lambda: False)
    monkeypatch.delenv("APPIMAGE", raising=False)
    monkeypatch.setenv("NIRS4ALL_RUNTIME_MODE", "managed")
    # Even if the app dir were writable, the install kind forbids in-place.
    monkeypatch.setattr(staging, "_path_is_writable", lambda _p: True)
    cap = staging.get_update_capability()
    assert cap["can_apply_in_place"] is False
    assert cap["channel"] == "installer"
    assert cap["reason"] == "managed_install"


def test_capability_unknown_runtime_mode_is_installer(monkeypatch):
    """Anything that isn't portable/appimage/bundled is treated as a managed
    installer build and routed to the installer channel."""
    monkeypatch.setattr(staging, "_is_portable_runtime", lambda: False)
    monkeypatch.delenv("APPIMAGE", raising=False)
    monkeypatch.delenv("NIRS4ALL_RUNTIME_MODE", raising=False)
    monkeypatch.setattr(staging, "_path_is_writable", lambda _p: True)
    cap = staging.get_update_capability()
    assert cap["can_apply_in_place"] is False
    assert cap["channel"] == "installer"
    assert cap["reason"] == "managed_install"


def test_capability_bundled_macos_probes_app_parent(monkeypatch):
    """macOS replaces the whole .app from its parent dir, so the bundled write
    probe must check the PARENT (e.g. /Applications), not the .app's own
    contents."""
    import updater

    monkeypatch.setattr(staging, "_is_portable_runtime", lambda: False)
    monkeypatch.delenv("APPIMAGE", raising=False)
    monkeypatch.setenv("NIRS4ALL_RUNTIME_MODE", "bundled")
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
        lambda: {"can_apply_in_place": False, "channel": "installer", "reason": "managed_install", "install_kind": "windows-installer"},
    )

    with pytest.raises(HTTPException) as exc:
        await apply_webapp_update(ApplyUpdateRequest(confirm=True))

    assert exc.value.status_code == 400
    assert exc.value.detail["update_channel"] == "installer"
