import asyncio


def test_recommended_config_prefers_cached_data_without_remote(monkeypatch):
    from api import recommended_config as rc

    cached = {
        "schema_version": "1.2",
        "app_version": "0.3.0",
        "nirs4all": "0.8.6",
        "profiles": {
            "cpu": {
                "label": "CPU",
                "description": "CPU profile",
                "packages": {"nirs4all": {"min": ">=0.8.6"}},
            }
        },
        "optional": {},
    }

    monkeypatch.setattr(rc._config_cache, "get_cached_config", lambda: cached)

    async def _unexpected_remote():
        raise AssertionError("Remote fetch should not run when cache is available")

    monkeypatch.setattr(rc, "_fetch_remote_config", _unexpected_remote)

    result = asyncio.run(rc.get_recommended_config())

    assert result.fetched_from == "remote"
    assert result.app_version == "0.3.0"
    assert result.profiles[0].id == "cpu"


def test_recommended_config_uses_bundled_fallback_without_remote_on_startup(monkeypatch):
    from api import recommended_config as rc

    bundled = {
        "schema_version": "1.2",
        "app_version": "0.3.0",
        "nirs4all": "0.8.6",
        "profiles": {
            "cpu": {
                "label": "CPU",
                "description": "CPU profile",
                "packages": {"nirs4all": {"min": ">=0.8.6"}},
            }
        },
        "optional": {},
    }

    monkeypatch.setattr(rc._config_cache, "get_cached_config", lambda: None)
    monkeypatch.setattr(rc, "_load_bundled_config", lambda: bundled)

    async def _unexpected_remote():
        raise AssertionError("Remote fetch should not run during normal startup")

    monkeypatch.setattr(rc, "_fetch_remote_config", _unexpected_remote)

    result = asyncio.run(rc.get_recommended_config())

    assert result.fetched_from == "bundled"
    assert result.app_version == "0.3.0"
    assert result.profiles[0].id == "cpu"


def test_recommended_config_force_refresh_uses_remote_then_falls_back(monkeypatch):
    from api import recommended_config as rc

    bundled = {
        "schema_version": "1.2",
        "app_version": "0.3.0",
        "nirs4all": "0.8.6",
        "profiles": {
            "cpu": {
                "label": "CPU",
                "description": "CPU profile",
                "packages": {"nirs4all": {"min": ">=0.8.6"}},
            }
        },
        "optional": {},
    }
    remote = {
        **bundled,
        "app_version": "0.3.1",
    }

    cached_values = {"value": None}

    def _get_cached():
        return cached_values["value"]

    def _set_cached(data):
        cached_values["value"] = data

    monkeypatch.setattr(rc._config_cache, "get_cached_config", _get_cached)
    monkeypatch.setattr(rc._config_cache, "set_cached_config", _set_cached)
    monkeypatch.setattr(rc, "_load_bundled_config", lambda: bundled)

    async def _remote_ok():
        return remote

    monkeypatch.setattr(rc, "_fetch_remote_config", _remote_ok)
    refreshed = asyncio.run(rc.get_recommended_config(force_refresh=True))

    assert refreshed.fetched_from == "remote"
    assert refreshed.app_version == "0.3.1"
    assert cached_values["value"] == remote

    async def _remote_fail():
        return None

    monkeypatch.setattr(rc, "_fetch_remote_config", _remote_fail)
    fallback = asyncio.run(rc.get_recommended_config(force_refresh=True))

    assert fallback.fetched_from == "remote"
    assert fallback.app_version == "0.3.1"


def test_get_installed_packages_prefers_runtime_nirs4all_version(monkeypatch):
    from api import recommended_config as rc

    class _Pkg:
        def __init__(self, name: str, version: str):
            self.name = name
            self.version = version

    monkeypatch.setattr(
        rc.venv_manager,
        "get_installed_packages",
        lambda: [_Pkg("nirs4all", "0.8.2"), _Pkg("torch", "2.10.0+cpu")],
    )
    monkeypatch.setattr(rc.venv_manager, "get_nirs4all_version", lambda: "0.8.6")

    installed = rc._get_installed_packages()

    assert installed["nirs4all"] == "0.8.6"
    assert installed["torch"] == "2.10.0+cpu"


def test_detect_gpu_recommends_cuda_profile_from_hardware(monkeypatch):
    from api import recommended_config as rc
    from api.shared.gpu_detection import GPUHardwareInfo

    monkeypatch.setattr(
        rc,
        "detect_gpu_hardware",
        lambda: GPUHardwareInfo(
            has_cuda=True,
            gpu_name="NVIDIA GeForce RTX 4090",
            driver_version="32.0.15.9159",
            torch_cuda_available=False,
            torch_version="2.10.0+cpu",
            detection_source="windows-wmi",
        ),
    )
    monkeypatch.setattr(
        rc,
        "_load_bundled_config",
        lambda: {
            "profiles": {
                "cpu": {"platforms": ["win32", "linux", "darwin"]},
                "gpu-cuda-torch": {"platforms": ["win32", "linux"]},
            }
        },
    )

    result = rc._detect_gpu()

    assert result.has_cuda is True
    assert result.gpu_name == "NVIDIA GeForce RTX 4090"
    assert result.torch_cuda_available is False
    assert result.recommended_profiles == ["gpu-cuda-torch", "cpu"]
