import asyncio

import pytest
from fastapi import HTTPException


def test_get_dependencies_filters_profile_managed_torch_from_cached_payload(monkeypatch):
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

    assert [pkg.name for cat in result.categories for pkg in cat.packages] == ["keras"]
    assert result.total_installed == 1
    assert result.total_packages == 1


@pytest.mark.parametrize(
    "endpoint_fn, request_obj",
    [
        ("install_dependency", {"package": "torch"}),
        ("update_dependency", {"package": "torch"}),
        ("revert_dependency", {"package": "torch"}),
    ],
)
def test_profile_managed_torch_is_rejected_by_generic_dependency_endpoints(endpoint_fn, request_obj):
    from api import updates

    fn = getattr(updates, endpoint_fn)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(fn(updates.PackageInstallRequest(**request_obj) if endpoint_fn != "revert_dependency" else updates.PackageUninstallRequest(**request_obj)))

    assert exc_info.value.status_code == 400
    assert "managed by the active compute profile" in exc_info.value.detail
