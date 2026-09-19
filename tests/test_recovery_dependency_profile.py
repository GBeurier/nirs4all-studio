"""The Python recovery runtime must not consume Rust release configuration."""

import asyncio
import json
from pathlib import Path


def test_recovery_uses_its_bundled_profile_even_with_a_newer_cached_manifest():
    from api import recommended_config as config

    bundled = json.loads((Path(__file__).parents[1] / "recommended-config.json").read_text())
    newer = {"app_version": "99.0.0", "nirs4all": "99.0.0"}
    selected, source = config._select_preferred_config(newer, bundled)
    assert source == "bundled"
    assert selected["nirs4all"] == "1.0.3"
    assert all(profile["packages"]["nirs4all"]["min"] == "==1.0.3" for profile in selected["profiles"].values())


def test_recovery_does_not_fetch_the_development_dependency_manifest(monkeypatch):
    from api import network_state, recommended_config

    async def unexpected_network_probe():
        raise AssertionError("Recovery package configuration must work offline")

    monkeypatch.setattr(network_state, "is_online", unexpected_network_probe)
    assert asyncio.run(recommended_config._fetch_remote_config()) is None


def test_recovery_starts_with_core_only_and_optional_frameworks_are_opt_in():
    bundled = json.loads((Path(__file__).parents[1] / "recommended-config.json").read_text())
    assert set(bundled["profiles"]["cpu-lite"]["packages"]) == {"nirs4all"}
    assert all(not spec.get("default_install", False) for spec in bundled["optional"].values())


def test_library_update_check_stays_on_qualified_recovery_version(monkeypatch):
    from api.updates import UpdateManager

    manager = UpdateManager()
    monkeypatch.setattr(manager, "get_nirs4all_version", lambda force=False: "1.0.3")

    async def unexpected_fetch(*args, **kwargs):
        raise AssertionError("Recovery must not offer a newer library independently of Studio")

    monkeypatch.setattr(manager, "_fetch_url", unexpected_fetch)
    result = asyncio.run(manager.check_pypi_release(force=True))
    assert result.latest_version == "1.0.3"
    assert result.update_available is False


def test_library_repair_installs_exact_recovery_version(monkeypatch):
    from api import updates
    from api.updates.app_updates import install_nirs4all
    from api.updates.manager import InstallRequest

    monkeypatch.setattr(updates, "_ensure_runtime_mutable", lambda: None)
    monkeypatch.setattr(updates, "_ensure_runtime_is_valid", lambda: None)
    calls = []

    def install(package, **kwargs):
        calls.append((package, kwargs))
        return True, "installed", []

    monkeypatch.setattr(updates.venv_manager, "install_package", install)
    asyncio.run(install_nirs4all(InstallRequest()))
    assert calls[0][1]["version"] == "1.0.3"


def test_installer_only_release_remains_discoverable_after_recovery(monkeypatch):
    import platform

    from api.updates import UpdateManager
    from api.updates.staging import get_update_capability

    monkeypatch.setattr(platform, "system", lambda: "Windows")
    monkeypatch.setattr(platform, "machine", lambda: "AMD64")
    for name in ("NIRS4ALL_PORTABLE_EXE", "NIRS4ALL_PORTABLE_ROOT", "APPIMAGE", "NIRS4ALL_BUNDLED"):
        monkeypatch.delenv(name, raising=False)
    manager = UpdateManager()
    monkeypatch.setattr(manager, "get_webapp_version", lambda: "0.11.8")
    monkeypatch.setattr(manager, "_ensure_cache_loaded", lambda: {})
    monkeypatch.setattr(manager, "_save_cache", lambda: None)
    url = "https://github.com/GBeurier/nirs4all-studio/releases/download/0.11.9/nirs4all-Studio-0.11.9-win-x64.exe"

    async def release(*args, **kwargs):
        return 200, json.dumps({
            "tag_name": "0.11.9",
            "assets": [{"name": "nirs4all-Studio-0.11.9-win-x64.exe", "browser_download_url": url}],
        })

    monkeypatch.setattr(manager, "_fetch_url", release)
    result = asyncio.run(manager.check_github_release(force=True))
    assert result.update_available
    assert result.installer_download_url == url
    assert result.download_url is None
    assert get_update_capability()["channel"] == "installer"


def test_version_probe_does_not_import_the_ml_stack(monkeypatch):
    import importlib.metadata
    import subprocess
    import sys

    from api.venv_manager import VenvManager

    manager = VenvManager()
    monkeypatch.setattr(manager, "_is_valid_venv", lambda: True)

    def run(script):
        script += "\nassert 'nirs4all' not in sys.modules\nassert 'sklearn' not in sys.modules\n"
        result = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, check=True)
        return result.returncode, result.stdout, result.stderr

    monkeypatch.setattr(manager, "run_in_venv", run)
    assert manager.get_nirs4all_version() == importlib.metadata.version("nirs4all")


def test_recovery_selects_legacy_even_with_dag_environment(monkeypatch):
    import pytest

    from api.runtime_engine import engine_run_kwargs, resolve_engine, runtime_engine_capabilities
    from api.runtime_errors import RtUnsupportedError

    monkeypatch.setenv("N4A_ENGINE", "dag-ml")
    assert resolve_engine(None) == "legacy"
    assert engine_run_kwargs(None) == {"engine": "legacy"}
    assert runtime_engine_capabilities()["supported_engines"] == ["legacy"]
    with pytest.raises(RtUnsupportedError):
        engine_run_kwargs("dag-ml")


def test_library_install_uses_the_embedded_wheel_including_explicit_extras(monkeypatch, tmp_path):
    import io
    from types import SimpleNamespace

    from api.venv_manager import VenvManager

    wheel = tmp_path / "dossier avec espaces" / "nirs4all-1.0.3-py3-none-any.whl"
    wheel.parent.mkdir()
    wheel.write_bytes(b"fixture")
    monkeypatch.setenv("NIRS4ALL_RECOVERY_WHEEL", str(wheel))
    manager = VenvManager()
    monkeypatch.setattr(manager, "_is_valid_venv", lambda: True)
    monkeypatch.setattr(manager, "_load_metadata", lambda: {})
    monkeypatch.setattr(manager, "_save_metadata", lambda data: None)
    commands = []

    def popen(command, **kwargs):
        commands.append(command)
        return SimpleNamespace(stdout=io.BytesIO(b"Successfully installed\n"), wait=lambda **kw: None, returncode=0)

    monkeypatch.setattr("api.venv_manager.subprocess.Popen", popen)
    success, _, _ = manager.install_package("nirs4all", version="1.0.3", extras=["torch"],
                                           extra_pip_args=["--extra-index-url", "https://example.invalid/framework-wheels"])
    assert success
    assert commands[0][-1] == f"nirs4all[torch] @ {wheel.as_uri()}"
    assert "nirs4all==1.0.3" not in commands[0]
    assert "--only-binary=nirs4all-io,nirs4all-core" in commands[0]
    assert commands[0][commands[0].index("--find-links") + 1] == str(wheel.parent)
    assert commands[0][commands[0].index("--extra-index-url") + 1] == "https://example.invalid/framework-wheels"


def test_missing_embedded_library_never_falls_back_to_pypi(monkeypatch, tmp_path):
    from api.venv_manager import VenvManager

    monkeypatch.setenv("NIRS4ALL_RECOVERY_WHEEL", str(tmp_path / "nirs4all-1.0.3-py3-none-any.whl"))
    manager = VenvManager()
    monkeypatch.setattr(manager, "_is_valid_venv", lambda: True)

    def unexpected_pip(*args, **kwargs):
        raise AssertionError("Missing qualified wheel must not fall back to an index")

    monkeypatch.setattr("api.venv_manager.subprocess.Popen", unexpected_pip)
    success, message, _ = manager.install_package("nirs4all", version="1.0.3")
    assert not success
    assert "qualified nirs4all wheel is missing" in message
