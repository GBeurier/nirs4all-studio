"""Configuration inspection must not mutate or inspect another interpreter."""

import sys
from types import SimpleNamespace

import pytest

from api.library_runtime_config import compare_configuration, dependency_inventory


def test_inventory_enables_only_explicitly_writable_external_hosts(monkeypatch):
    monkeypatch.setattr("api.library_runtime_config.package_management_available", lambda: True)
    config = {"categories": {}, "optional": {}}
    assert dependency_inventory({"config": config})["read_only"] is True
    assert dependency_inventory({"config": config, "read_only": True})["read_only"] is True
    assert dependency_inventory({"config": config, "read_only": False})["read_only"] is False
    monkeypatch.setattr("api.library_runtime_config.package_management_available", lambda: False)
    assert dependency_inventory({"config": config, "read_only": False})["read_only"] is True


@pytest.mark.parametrize("action_request", [{"package": "--help"}, {"package": "https://example.org/a.whl"},
                                     {"package": "shap", "version": "1.0 --user"},
                                     {"package": "shap", "target": "other"}, {"package": "shap", "extra_args": ["--user"]}])
def test_invalid_package_actions_never_invoke_pip(monkeypatch, action_request):
    from api.library_runtime_config import package_action

    monkeypatch.setattr("runpy.run_module", lambda *args, **kwargs: pytest.fail("Invalid action invoked pip"))
    config = {"profiles": {"cpu": {}}, "optional": {"shap": {"recommended": "0.47.1"}}}
    result = package_action({"config": config, "read_only": False, "request": action_request, "action": "install"})
    assert result["status"] == 400


def test_bundled_package_actions_never_invoke_pip(monkeypatch):
    from api.library_runtime_config import package_action

    monkeypatch.setattr("runpy.run_module", lambda *args, **kwargs: pytest.fail("Bundled action invoked pip"))
    assert package_action({"read_only": True})["status"] == 409
    assert package_action({})["status"] == 409


def test_profile_variants_and_renames_are_retained():
    from api.library_runtime_config import _package_action_arguments

    config = {"profiles": {"gpu-cuda-torch": {"packages": {"torch": {"recommended": "2.6.0"}}},
                           "cpu-lite": {"package_renames": {"xgboost": "xgboost-cpu"}}},
              "optional": {"torch": {"recommended": "2.6.0"}, "xgboost": {"recommended": "3.0.0"}}}
    document = {"config": config, "profile": "gpu-cuda-torch", "request": {"package": "torch"}, "action": "revert"}
    assert _package_action_arguments(document)[2][-3:] == ["--index-url", "https://download.pytorch.org/whl/cu124", "torch==2.6.0"]
    document["action"] = "update"
    with pytest.raises(ValueError, match="active compute profile"):
        _package_action_arguments(document)
    document.update(profile="cpu-lite", request={"package": "xgboost"}, action="revert")
    expected = "xgboost" if sys.platform == "darwin" else "xgboost-cpu"
    assert _package_action_arguments(document)[2][-1] == f"{expected}==3.0.0"


def test_inventory_tracks_the_profile_distribution_after_package_actions(monkeypatch):
    monkeypatch.setattr("importlib.metadata.distributions", lambda: [
        SimpleNamespace(metadata={"Name": "xgboost-cpu"}, version="3.0.0"),
    ])
    monkeypatch.setattr(sys, "platform", "linux")
    config = {"profiles": {"cpu-lite": {"package_renames": {"xgboost": "xgboost-cpu"}}},
              "categories": {"boosting": {"name": "Boosting"}},
              "optional": {"xgboost": {"category": "boosting", "min": ">=2", "recommended": "3.0.0"}}}
    result = dependency_inventory({"config": config, "profile": "cpu-lite"})
    assert result["categories"][0]["packages"][0]["installed_version"] == "3.0.0"


def test_recommended_update_runs_offline_in_an_isolated_external_environment(tmp_path, monkeypatch):
    """Exercise real pip without changing the developer or bundled runtime."""
    import json
    import subprocess
    import venv
    import zipfile
    from pathlib import Path

    from api import library_runtime_config

    wheels = tmp_path / "wheels"
    wheels.mkdir()
    for version in ["1.0", "1.1"]:
        info = f"studio_update_fixture-{version}.dist-info"
        with zipfile.ZipFile(wheels / f"studio_update_fixture-{version}-py3-none-any.whl", "w") as wheel:
            wheel.writestr(f"{info}/METADATA", f"Metadata-Version: 2.1\nName: studio-update-fixture\nVersion: {version}\n")
            wheel.writestr(f"{info}/WHEEL", "Wheel-Version: 1.0\nGenerator: studio-test\nRoot-Is-Purelib: true\nTag: py3-none-any\n")
            wheel.writestr(f"{info}/RECORD", "".join(f"{info}/{name},,\n" for name in ["METADATA", "WHEEL", "RECORD"]))
    venv.EnvBuilder(with_pip=True).create(tmp_path / "env")
    python = tmp_path / "env" / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
    monkeypatch.setenv("PIP_NO_INDEX", "1")
    monkeypatch.setenv("PIP_FIND_LINKS", str(wheels))
    subprocess.run([str(python), "-I", "-m", "pip", "install", "studio-update-fixture==1.0"], check=True, capture_output=True, timeout=60)
    config = {"profiles": {"cpu": {}}, "categories": {"test": {"name": "Test"}},
              "optional": {"studio-update-fixture": {"category": "test", "min": ">=1.0", "recommended": "1.1"}}}
    document = {"config": config, "read_only": False, "request": {"package": "studio-update-fixture"}, "action": "revert"}
    source = Path(library_runtime_config.__file__).read_text()

    def invoke(expression):
        script = source + f"\nimport json\nprint(json.dumps({expression}))"
        result = subprocess.run([str(python), "-I", "-B", "-c", script], check=True, capture_output=True, text=True, timeout=60)
        return json.loads(result.stdout)

    # packaging is an existing host prerequisite; use pip's vendored copy in
    # this otherwise empty test environment, without downloading anything.
    source = source.replace("from packaging.", "from pip._vendor.packaging.")
    inventory = {"config": config, "read_only": False}
    before = invoke(f"dependency_inventory({inventory!r})")
    assert before["read_only"] is False
    assert before["categories"][0]["packages"][0]["is_below_recommended"] is True
    result = invoke(f"package_action({document!r})")
    assert result["success"] is True, result
    assert result["version"] == "1.1"
    assert result["requires_restart"] is True
    after = invoke(f"dependency_inventory({inventory!r})")
    assert after["categories"][0]["packages"][0]["installed_version"] == "1.1"
    assert after["categories"][0]["packages"][0]["is_below_recommended"] is False
    document["action"] = "uninstall"
    assert invoke(f"package_action({document!r})")["success"] is True
    assert invoke(f"dependency_inventory({inventory!r})")["categories"][0]["packages"][0]["is_installed"] is False


def test_pep440_minimums_renames_and_optional_visibility(monkeypatch):
    monkeypatch.setattr("importlib.metadata.distributions", lambda: [
        SimpleNamespace(metadata={"Name": name}, version=version)
        for name, version in [("nirs4all", "1.0.1"), ("xgboost-cpu", "3.0.0"), ("shap", "0.40")]
    ])
    monkeypatch.setattr("importlib.metadata.version", {"nirs4all": "1.0.1", "xgboost-cpu": "3.0.0", "shap": "0.40"}.__getitem__)
    config = {"profiles": {"cpu-lite": {"label": "Lite", "platforms": [sys.platform],
              "packages": {"nirs4all": {"min": ">=1.0.0", "recommended": "1.0.0"}, "xgboost": ">=3", "missing": ">=2"},
              "package_renames": {"xgboost": "xgboost-cpu"}}},
              "optional": {"shap": {"min": ">=0.44"}, "absent": {"min": ">=1"}}}
    result = compare_configuration({"config": config, "profile": "cpu-lite", "include_optional": True, "include_latest": True})
    assert (result["aligned_count"], result["misaligned_count"], result["missing_count"]) == (2, 1, 1)
    assert not result["is_aligned"]
    assert not result["latest_lookup_performed"]
    assert [row["name"] for row in result["packages"]] == ["nirs4all", "xgboost", "missing", "shap"]


def test_unknown_and_incompatible_profiles_are_not_silently_selected():
    config = {"profiles": {"other-os": {"platforms": ["not-this-platform"]}}}
    for profile in ["missing", "other-os"]:
        with pytest.raises(ValueError, match="profile"):
            compare_configuration({"config": config, "profile": profile})


def test_inventory_keeps_the_selected_distribution_when_old_paths_are_inherited(monkeypatch):
    monkeypatch.setattr("importlib.metadata.distributions", lambda: [
        SimpleNamespace(metadata={"Name": "nirs4all"}, version="1.4.13"),
        SimpleNamespace(metadata={"Name": "nirs4all"}, version="1.4.2"),
        SimpleNamespace(metadata={"Name": "shap"}, version="0.51.0"),
    ])
    monkeypatch.setattr("importlib.metadata.version", {"nirs4all": "1.4.13", "shap": "0.51.0"}.__getitem__)
    result = dependency_inventory({"config": {"nirs4all": "1.4.13", "categories": {}, "optional": {}}})
    assert result["nirs4all_version"] == "1.4.13"
    assert result["runtime_valid"] is True
