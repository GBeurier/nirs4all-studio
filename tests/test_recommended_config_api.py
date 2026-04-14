import asyncio


def test_recommended_config_prefers_cached_data_without_remote(monkeypatch):
    from api import recommended_config as rc

    cached = {
        "schema_version": "1.2",
        "app_version": "0.3.0",
        "nirs4all": "0.8.9",
        "profiles": {
            "cpu": {
                "label": "CPU",
                "description": "CPU profile",
                "packages": {"nirs4all": {"min": ">=0.8.9"}},
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
        "nirs4all": "0.8.9",
        "profiles": {
            "cpu": {
                "label": "CPU",
                "description": "CPU profile",
                "packages": {"nirs4all": {"min": ">=0.8.9"}},
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
        "nirs4all": "0.8.9",
        "profiles": {
            "cpu": {
                "label": "CPU",
                "description": "CPU profile",
                "packages": {"nirs4all": {"min": ">=0.8.9"}},
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
    monkeypatch.setattr(rc.venv_manager, "get_nirs4all_version", lambda: "0.8.9")

    installed = rc._get_installed_packages()

    assert installed["nirs4all"] == "0.8.9"
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


def test_setup_status_recovers_cuda_profile_from_installed_torch(monkeypatch):
    from api import recommended_config as rc

    persisted: list[str] = []
    states = [
        {"setup_completed": False, "selected_profile": None, "completed_at": None},
    ]

    def _get_setup_status():
        return states[-1]

    def _set_setup_status(profile: str):
        persisted.append(profile)
        states.append(
            {
                "setup_completed": True,
                "selected_profile": profile,
                "completed_at": "2026-04-14T11:00:00",
            }
        )

    monkeypatch.setattr(rc._config_cache, "get_setup_status", _get_setup_status)
    monkeypatch.setattr(rc._config_cache, "set_setup_status", _set_setup_status)
    monkeypatch.setattr(
        rc,
        "_load_active_raw_config",
        lambda: {
            "profiles": {
                "cpu": {"platforms": ["win32", "linux", "darwin"]},
                "gpu-cuda-torch": {"platforms": ["win32", "linux"]},
            }
        },
    )
    monkeypatch.setattr(rc, "_get_installed_packages", lambda: {"torch": "2.6.0+cu124"})
    monkeypatch.setattr(
        rc,
        "_detect_gpu",
        lambda: rc.GPUDetectionResponse(
            has_cuda=True,
            has_metal=False,
            cuda_version="12.4",
            gpu_name="RTX 4090",
            driver_version="999",
            torch_cuda_available=True,
            torch_version="2.6.0+cu124",
            detection_source="torch",
            recommended_profiles=["gpu-cuda-torch", "cpu"],
        ),
    )
    result = asyncio.run(rc.get_setup_status())

    assert result.setup_completed is True
    assert result.selected_profile == "gpu-cuda-torch"
    assert persisted == ["gpu-cuda-torch"]


def test_setup_status_recovers_mps_profile_from_installed_torch(monkeypatch):
    from api import recommended_config as rc

    persisted: list[str] = []
    states = [
        {"setup_completed": False, "selected_profile": None, "completed_at": None},
    ]

    def _get_setup_status():
        return states[-1]

    def _set_setup_status(profile: str):
        persisted.append(profile)
        states.append(
            {
                "setup_completed": True,
                "selected_profile": profile,
                "completed_at": "2026-04-14T11:00:00",
            }
        )

    monkeypatch.setattr(rc._config_cache, "get_setup_status", _get_setup_status)
    monkeypatch.setattr(rc._config_cache, "set_setup_status", _set_setup_status)
    monkeypatch.setattr(rc.sys, "platform", "darwin")
    monkeypatch.setattr(
        rc,
        "_load_active_raw_config",
        lambda: {
            "profiles": {
                "cpu": {"platforms": ["darwin"]},
                "gpu-mps": {"platforms": ["darwin"]},
            }
        },
    )
    monkeypatch.setattr(rc, "_get_installed_packages", lambda: {"torch": "2.6.0"})
    monkeypatch.setattr(
        rc,
        "_detect_gpu",
        lambda: rc.GPUDetectionResponse(
            has_cuda=False,
            has_metal=True,
            cuda_version=None,
            gpu_name="Apple GPU",
            driver_version=None,
            torch_cuda_available=False,
            torch_version="2.6.0",
            detection_source="torch-mps",
            recommended_profiles=["gpu-mps", "cpu"],
        ),
    )

    result = asyncio.run(rc.get_setup_status())

    assert result.setup_completed is True
    assert result.selected_profile == "gpu-mps"
    assert persisted == ["gpu-mps"]


def test_setup_status_falls_back_to_cpu_when_no_gpu_profile_can_be_established(monkeypatch):
    from api import recommended_config as rc

    persisted: list[str] = []
    states = [
        {"setup_completed": False, "selected_profile": None, "completed_at": None},
    ]

    def _get_setup_status():
        return states[-1]

    def _set_setup_status(profile: str):
        persisted.append(profile)
        states.append(
            {
                "setup_completed": True,
                "selected_profile": profile,
                "completed_at": "2026-04-14T11:00:00",
            }
        )

    monkeypatch.setattr(rc._config_cache, "get_setup_status", _get_setup_status)
    monkeypatch.setattr(rc._config_cache, "set_setup_status", _set_setup_status)
    monkeypatch.setattr(
        rc,
        "_load_active_raw_config",
        lambda: {
            "profiles": {
                "cpu": {"platforms": ["win32", "linux", "darwin"]},
                "gpu-cuda-torch": {"platforms": ["win32", "linux"]},
            }
        },
    )
    monkeypatch.setattr(rc, "_get_installed_packages", lambda: {"nirs4all": "0.8.9"})
    monkeypatch.setattr(
        rc,
        "_detect_gpu",
        lambda: rc.GPUDetectionResponse(
            has_cuda=False,
            has_metal=False,
            cuda_version=None,
            gpu_name=None,
            driver_version=None,
            torch_cuda_available=False,
            torch_version=None,
            detection_source=None,
            recommended_profiles=["cpu"],
        ),
    )

    result = asyncio.run(rc.get_setup_status())

    assert result.setup_completed is True
    assert result.selected_profile == "cpu"
    assert persisted == ["cpu"]


def test_compare_config_uses_recovered_profile_when_status_file_is_missing(monkeypatch):
    from api import recommended_config as rc

    states = [
        {"setup_completed": False, "selected_profile": None, "completed_at": None},
    ]

    def _get_setup_status():
        return states[-1]

    def _set_setup_status(profile: str):
        states.append(
            {
                "setup_completed": True,
                "selected_profile": profile,
                "completed_at": "2026-04-14T11:00:00",
            }
        )

    monkeypatch.setattr(rc._config_cache, "get_setup_status", _get_setup_status)
    monkeypatch.setattr(rc._config_cache, "set_setup_status", _set_setup_status)
    monkeypatch.setattr(
        rc,
        "_load_active_raw_config",
        lambda: {
            "profiles": {
                "cpu": {
                    "label": "CPU",
                    "platforms": ["win32", "linux", "darwin"],
                    "packages": {"nirs4all": {"min": ">=0.8.9", "recommended": "0.8.9"}},
                },
                "gpu-cuda-torch": {
                    "label": "GPU",
                    "platforms": ["win32", "linux"],
                    "packages": {
                        "nirs4all": {"min": ">=0.8.9", "recommended": "0.8.9"},
                        "torch": {"min": ">=2.1.0", "recommended": "2.6.0"},
                    },
                },
            },
            "optional": {},
        },
    )
    monkeypatch.setattr(rc, "_get_installed_packages", lambda: {"nirs4all": "0.8.9", "torch": "2.6.0+cu124"})
    monkeypatch.setattr(
        rc,
        "_detect_gpu",
        lambda: rc.GPUDetectionResponse(
            has_cuda=True,
            has_metal=False,
            cuda_version="12.4",
            gpu_name="RTX 4090",
            driver_version="999",
            torch_cuda_available=True,
            torch_version="2.6.0+cu124",
            detection_source="torch",
            recommended_profiles=["gpu-cuda-torch", "cpu"],
        ),
    )

    result = asyncio.run(rc.compare_config())

    assert result.profile == "gpu-cuda-torch"
    assert result.profile_label == "GPU"


def test_resolve_required_install_spec_uses_cuda_index_and_force_reinstall_for_torch(monkeypatch):
    from api import recommended_config as rc

    gpu_info = rc.GPUDetectionResponse(
        has_cuda=True,
        has_metal=False,
        cuda_version="12.4",
        gpu_name="RTX 4090",
        driver_version="999",
        torch_cuda_available=False,
        torch_version="2.6.0+cpu",
        detection_source="windows-wmi",
        recommended_profiles=["gpu-cuda-torch", "cpu"],
    )

    install_spec = rc._resolve_required_install_spec(
        "gpu-cuda-torch",
        "torch",
        {"min": ">=2.1.0", "recommended": "2.6.0"},
        "2.6.0+cpu",
        gpu_info,
    )

    assert install_spec is not None
    assert install_spec.package == "torch"
    assert install_spec.version == "2.6.0"
    assert install_spec.extra_pip_args == ["--index-url", rc.TORCH_CUDA_INDEX_URL]
    assert install_spec.force_reinstall is True
    assert install_spec.display_spec == "torch==2.6.0 (cu124)"


def test_resolve_required_install_spec_uses_cpu_index_for_torch(monkeypatch):
    from api import recommended_config as rc

    gpu_info = rc.GPUDetectionResponse(
        has_cuda=False,
        has_metal=False,
        cuda_version=None,
        gpu_name=None,
        driver_version=None,
        torch_cuda_available=True,
        torch_version="2.6.0+cu124",
        detection_source="torch",
        recommended_profiles=["cpu"],
    )

    install_spec = rc._resolve_required_install_spec(
        "cpu",
        "torch",
        {"min": ">=2.1.0", "recommended": "2.6.0"},
        "2.6.0+cu124",
        gpu_info,
    )

    assert install_spec is not None
    assert install_spec.extra_pip_args == ["--index-url", rc.TORCH_CPU_INDEX_URL]
    assert install_spec.force_reinstall is True
    assert install_spec.display_spec == "torch==2.6.0 (cpu)"


def test_resolve_required_install_spec_uses_standard_wheel_for_mps_torch(monkeypatch):
    from api import recommended_config as rc

    gpu_info = rc.GPUDetectionResponse(
        has_cuda=False,
        has_metal=True,
        cuda_version=None,
        gpu_name="Apple GPU",
        driver_version=None,
        torch_cuda_available=False,
        torch_version=None,
        detection_source="torch-mps",
        recommended_profiles=["gpu-mps", "cpu"],
    )

    install_spec = rc._resolve_required_install_spec(
        "gpu-mps",
        "torch",
        {"min": ">=2.1.0", "recommended": "2.6.0"},
        None,
        gpu_info,
    )

    assert install_spec is not None
    assert install_spec.extra_pip_args == []
    assert install_spec.force_reinstall is False
    assert install_spec.display_spec == "torch==2.6.0 (mps)"


def test_align_config_ignores_torch_when_passed_as_optional(monkeypatch):
    from api import recommended_config as rc

    install_calls: list[tuple[str, str | None, list[str], bool]] = []
    monkeypatch.setattr(
        rc,
        "_load_active_raw_config",
        lambda: {
            "profiles": {
                "cpu": {
                    "platforms": ["win32", "linux", "darwin"],
                    "packages": {
                        "nirs4all": {"min": ">=0.8.9", "recommended": "0.8.9"},
                        "torch": {"min": ">=2.1.0", "recommended": "2.6.0"},
                    },
                },
                "gpu-cuda-torch": {
                    "platforms": ["win32", "linux"],
                    "packages": {"torch": {"min": ">=2.1.0", "recommended": "2.6.0"}},
                },
            },
            "optional": {
                "torch": {"min": ">=2.1.0", "recommended": "2.6.0"},
                "keras": {"min": ">=3.0.0", "recommended": "3.8.0"},
            },
        },
    )
    monkeypatch.setattr(rc, "_get_installed_packages", lambda: {})
    monkeypatch.setattr(
        rc,
        "_detect_gpu",
        lambda: rc.GPUDetectionResponse(
            has_cuda=False,
            has_metal=False,
            cuda_version=None,
            gpu_name=None,
            driver_version=None,
            torch_cuda_available=False,
            torch_version=None,
            detection_source=None,
            recommended_profiles=["cpu"],
        ),
    )
    monkeypatch.setattr(rc._config_cache, "set_setup_status", lambda profile: None)
    monkeypatch.setattr(
        rc.venv_manager,
        "install_package",
        lambda package, version=None, upgrade=False, extra_pip_args=None, force_reinstall=False, **kwargs: (
            install_calls.append((package, version, extra_pip_args or [], force_reinstall)) or True,
            "ok",
            [],
        ),
    )

    result = asyncio.run(
        rc.align_config(
            rc.AlignConfigRequest(profile="cpu", optional_packages=["torch", "keras"])
        )
    )

    assert result.success is True
    assert [call[0] for call in install_calls].count("torch") == 1
    assert [call[0] for call in install_calls].count("keras") == 1
