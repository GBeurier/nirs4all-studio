import asyncio

import pytest
from fastapi import HTTPException


def test_get_dependencies_keeps_visible_profile_managed_torch_in_cached_payload(monkeypatch):
    from api import updates

    monkeypatch.setattr(
        updates.venv_manager,
        "get_venv_info",
        lambda: updates.VenvInfo(path="C:/env", exists=True, is_valid=True),
    )
    monkeypatch.setattr(updates.venv_manager, "get_nirs4all_version", lambda: "0.9.0")
    monkeypatch.setattr(
        updates._dependencies_cache,
        "get",
        lambda _venv_path: {
            "categories": [
                {
                    "id": "deep_learning",
                    "name": "Deep Learning",
                    "description": "DL",
                    "packages": [
                        {
                            "name": "torch",
                            "category": "deep_learning",
                            "category_name": "Deep Learning",
                            "description": "PyTorch",
                            "min_version": "2.1.0",
                            "recommended_version": "2.6.0",
                            "installed_version": "2.6.0+cu124",
                            "latest_version": None,
                            "is_installed": True,
                            "is_outdated": False,
                            "is_below_recommended": False,
                            "is_above_recommended": False,
                            "can_update": False,
                        },
                        {
                            "name": "keras",
                            "category": "deep_learning",
                            "category_name": "Deep Learning",
                            "description": "Keras",
                            "min_version": "3.0.0",
                            "recommended_version": "3.8.0",
                            "installed_version": "3.8.0",
                            "latest_version": None,
                            "is_installed": True,
                            "is_outdated": False,
                            "is_below_recommended": False,
                            "is_above_recommended": False,
                            "can_update": False,
                        },
                    ],
                    "installed_count": 2,
                    "total_count": 2,
                }
            ],
            "nirs4all_version": "0.9.0",
            "cached_at": "2026-04-14T11:00:00",
        },
    )

    result = asyncio.run(updates.get_dependencies())

    assert [pkg.name for cat in result.categories for pkg in cat.packages] == ["torch", "keras"]
    assert result.total_installed == 2
    assert result.total_packages == 2


def test_profile_managed_torch_install_uses_config_alignment(monkeypatch):
    from api import recommended_config as rc
    from api import updates

    async def _align_config(request):
        assert request.profile == "cpu"
        assert request.optional_packages == ["torch"]
        return rc.AlignConfigResponse(
            success=True,
            message="Installed 1 packages",
            installed=["torch==2.6.0 (cpu)"],
            upgraded=[],
            failed=[],
            dry_run=False,
        )

    monkeypatch.setattr(rc, "_load_active_raw_config", lambda: {"optional": {"torch": {}}})
    monkeypatch.setattr(rc, "_resolve_effective_profile", lambda raw: "cpu")
    monkeypatch.setattr(rc, "align_config", _align_config)
    monkeypatch.setattr(updates.venv_manager, "get_venv_info", lambda: updates.VenvInfo(path="C:/env", exists=True, is_valid=True))
    monkeypatch.setattr(updates.venv_manager, "get_package_version", lambda package: "2.6.0+cpu")
    monkeypatch.setattr(updates._dependencies_cache, "invalidate", lambda: None)

    result = asyncio.run(updates.install_dependency(updates.PackageInstallRequest(package="torch")))

    assert result["success"] is True
    assert result["version"] == "2.6.0+cpu"
    assert result["message"] == "Installed 1 packages"


def test_profile_managed_torch_revert_uses_config_alignment(monkeypatch):
    from api import recommended_config as rc
    from api import updates

    async def _align_config(request):
        assert request.profile == "cpu"
        assert request.optional_packages == ["torch"]
        return rc.AlignConfigResponse(
            success=True,
            message="Upgraded 1 packages",
            installed=[],
            upgraded=["torch==2.6.0 (cpu)"],
            failed=[],
            dry_run=False,
        )

    monkeypatch.setattr(rc, "_load_active_raw_config", lambda: {"optional": {"torch": {}}})
    monkeypatch.setattr(rc, "_resolve_effective_profile", lambda raw: "cpu")
    monkeypatch.setattr(rc, "align_config", _align_config)
    monkeypatch.setattr(updates.venv_manager, "get_venv_info", lambda: updates.VenvInfo(path="C:/env", exists=True, is_valid=True))
    monkeypatch.setattr(updates.venv_manager, "get_package_version", lambda package: "2.6.0+cpu")
    monkeypatch.setattr(updates._dependencies_cache, "invalidate", lambda: None)

    result = asyncio.run(updates.revert_dependency(updates.PackageUninstallRequest(package="torch")))

    assert result["success"] is True
    assert result["version"] == "2.6.0+cpu"
    assert result["message"] == "Upgraded 1 packages"


def test_profile_managed_torch_update_to_latest_is_rejected():
    from api import updates

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(updates.update_dependency(updates.PackageInstallRequest(package="torch")))

    assert exc_info.value.status_code == 400
    assert "managed by the active compute profile" in exc_info.value.detail
