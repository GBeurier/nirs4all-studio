"""Version bounds are shared by both explicit install paths; checks never install."""
import asyncio
import importlib.metadata
from pathlib import Path

import pytest

from api.package_compatibility import compatibility_issues, installation_requirements


@pytest.mark.parametrize("version, constrained", [
    ("1.9.9", False), ("2.0.0", True), ("2.0.3", True), ("2.0.99", True),
    ("2.1.0", False), ("9.0.0", False), (None, False),
])
def test_constraints_apply_only_to_selected_tabpfn_20(version, constrained):
    assert installation_requirements("TabPFN", version) == (["scikit-learn>=1.5,<1.7"] if constrained else [])
    assert installation_requirements("other", version) == []


@pytest.mark.parametrize("sklearn, compatible", [
    ("1.4.2", False), ("1.5.0", True), ("1.6.1", True), ("1.7.0", False), ("1.9.0", False),
])
def test_compatibility_boundaries(sklearn, compatible):
    assert bool(compatibility_issues("tabpfn", {"tabpfn": "2.0.3", "scikit-learn": sklearn})) is not compatible


@pytest.fixture
def pip_commands(monkeypatch, tmp_path):
    from api import venv_manager as vm
    commands = []
    monkeypatch.setattr(vm.VenvManager, "_is_valid_venv", lambda self: True)
    monkeypatch.setattr(vm.VenvManager, "python_executable", property(lambda self: tmp_path / "python"))
    monkeypatch.setattr(vm.VenvManager, "_load_metadata", lambda self: {})
    monkeypatch.setattr(vm.VenvManager, "_save_metadata", lambda self, metadata: None)
    monkeypatch.setattr(vm, "_recovery_wheel_install_options", lambda: [])
    monkeypatch.setattr(vm, "stream_install_process", lambda cmd, callback, **kwargs: commands.append(cmd) or 0)
    return commands


def test_dependencies_manager_installs_compatible_requirements_together(monkeypatch, pip_commands):
    from api import updates
    from api.updates.dependencies import PackageInstallRequest, install_dependency
    monkeypatch.setattr(updates, "_ensure_runtime_mutable", lambda: None)
    monkeypatch.setattr(updates, "_ensure_runtime_is_valid", lambda: None)
    monkeypatch.setattr(updates.venv_manager, "get_package_version", lambda package: "2.0.3")
    result = asyncio.run(install_dependency(PackageInstallRequest(package="tabpfn", target="recommended")))
    assert result["success"] and result["requires_restart"]
    assert len(pip_commands) == 1
    assert "tabpfn==2.0.3" in pip_commands[0]
    assert "scikit-learn>=1.5,<1.7" in pip_commands[0]
    assert "--no-deps" not in pip_commands[0]
    assert "uninstall" not in pip_commands[0]


def test_config_align_only_repairs_explicitly_selected_tabpfn(monkeypatch, pip_commands):
    from api import recommended_config as rc
    raw = {"profiles": {"cpu": {"packages": {}}}, "optional": {
        "tabpfn": {"min": ">=2.0", "recommended": "2.0.3"},
    }}
    monkeypatch.setattr(rc, "_load_active_raw_config", lambda: raw)
    monkeypatch.setattr(rc, "_get_installed_packages", lambda: {"tabpfn": "2.0.3", "scikit-learn": "1.9.0"})
    monkeypatch.setattr(rc, "_detect_gpu", lambda: None)
    monkeypatch.setattr(rc._config_cache, "set_setup_status", lambda profile: None)
    result = asyncio.run(rc.align_config(rc.AlignConfigRequest(profile="cpu")))
    assert result.success and pip_commands == []
    preview = asyncio.run(rc.align_config(rc.AlignConfigRequest(profile="cpu", optional_packages=["tabpfn"], dry_run=True)))
    assert "scikit-learn>=1.5,<1.7" in preview.installed[0]
    assert pip_commands == []
    result = asyncio.run(rc.align_config(rc.AlignConfigRequest(profile="cpu", optional_packages=["tabpfn"])))
    assert result.success and result.requires_restart
    assert len(pip_commands) == 1
    assert "tabpfn==2.0.3" in pip_commands[0]
    assert "scikit-learn>=1.5,<1.7" in pip_commands[0]


def test_import_check_rejects_installed_but_incompatible_versions_without_mutation(monkeypatch, pip_commands):
    from api.pipeline_canonical import OperatorResolutionError, import_operator_class
    original = importlib.metadata.version
    versions = {"tabpfn": "2.0.3", "scikit-learn": "1.9.0"}
    monkeypatch.setattr(importlib.metadata, "version", lambda name: versions.get(name) or original(name))
    with pytest.raises(OperatorResolutionError, match="requires scikit-learn>=1.5,<1.7; installed scikit-learn is 1.9.0"):
        import_operator_class("tabpfn.TabPFNRegressor")
    assert pip_commands == []
