from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tomllib
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
WHEEL_LOCK_TARGETS = ["linux-x64", "win32-x64", "darwin-arm64"]


def _wheel_lock(target: str) -> dict:
    return json.loads((ROOT / f"build/constraints/python-wheels-{target}.json").read_text(encoding="utf-8"))


def test_sidecar_resolves_selected_native_releases() -> None:
    manifest = tomllib.loads((ROOT / "sidecar" / "Cargo.toml").read_text(encoding="utf-8"))
    dependencies = manifest["dependencies"]
    # Cross-repository owners are minor-level ranges; Cargo.lock holds the cohort.
    assert dependencies["nirs4all"] == "0.5"
    assert dependencies["nirs4all-io"] == "0.3"
    # Core and Studio resolve one public Rust IO cohort without overrides.
    assert "dag-ml-core" not in manifest.get("dev-dependencies", {})


def test_lock_selects_the_public_registry_owner_cohort() -> None:
    locked = tomllib.loads((ROOT / "sidecar" / "Cargo.lock").read_text(encoding="utf-8"))
    cohort = json.loads((ROOT / "sidecar/contracts/studio_native_source_cohort_v2.json").read_text())
    assert cohort["schema_version"] == 2
    assert cohort["publication_status"] == "published-registry"
    assert cohort["public_registry_verified"] is True
    assert cohort["requires_explicit_local_cargo_config"] is False
    selected = cohort["packages"]
    assert {"nirs4all", "nirs4all-io", "nirs4all-formats", "dag-ml", "dag-ml-data", "n4m"} <= set(selected)
    for name, source in selected.items():
        matching = [package for package in locked["package"] if package["name"] == name]
        assert len(matching) == 1, f"one owner runtime is required for {name}"
        assert matching[0]["version"] == source["version"]
        assert source["repository"].startswith("https://github.com/")
        assert matching[0]["source"] == "registry+https://github.com/rust-lang/crates.io-index"
        assert re.fullmatch(r"[0-9a-f]{64}", matching[0]["checksum"])
    # The Rust binding version is independent of the selected libn4m ABI.
    assert selected["n4m"]["version"] == "0.4.2"


def test_historical_published_registry_cohort_is_unchanged() -> None:
    historical = ROOT / "sidecar/contracts/studio_native_source_cohort_v1.json"
    # Exact historical receipt from Main 2c2f380b; the current runtime uses v2.
    assert hashlib.sha256(historical.read_bytes()).hexdigest() == "b6e3b9f01d644c641c5d99155dc94e999ada83c0e56b0e54100367b95c1977f1"
    cohort = json.loads(historical.read_text())
    assert cohort["publication_status"] == "published-registry"
    assert cohort["public_registry_verified"] is True


def test_release_workflow_uses_the_exact_public_sdk_wheel() -> None:
    workflow = (ROOT / ".github/workflows/release-unified.yml").read_text(encoding="utf-8")
    parsed = yaml.safe_load(workflow)
    cohort = json.loads((ROOT / "build/runtime-cohort.json").read_text())
    sdk = cohort["sdk"]
    environment = dict(os.environ) | {key: "" if value is None else str(value) for key, value in parsed["env"].items()}
    assert environment["NIRS4ALL_PUBLICATION_STATUS"] == sdk["publication_status"] == "published-registry"
    assert environment["NIRS4ALL_LIBRARY_REF"] == sdk["source_sha"]
    assert environment["NIRS4ALL_WHEEL_URL"] == sdk["wheel_url"]
    assert environment["NIRS4ALL_WHEEL_SHA256"] == sdk["wheel_sha256"]
    assert environment["NIRS4ALL_SOURCE_URL"] == f"https://github.com/GBeurier/nirs4all/archive/{sdk['source_sha']}.tar.gz"
    validation = next(step["run"] for step in parsed["jobs"]["prepare"]["steps"]
                      if step.get("name") == "Validate pinned runtime dependency refs")
    bash = str(Path(shutil.which("git")).parents[1] / "bin/bash.exe") if sys.platform == "win32" else "bash"
    result = subprocess.run([bash, "-c", validation], env=environment, cwd=ROOT, capture_output=True)
    assert result.returncode == 0, result.stderr.decode()
    for changed in ({"NIRS4ALL_WHEEL_URL": "https://files.pythonhosted.org/old/nirs4all-1.4.15-py3-none-any.whl"},
                    {"NIRS4ALL_WHEEL_SHA256": "0" * 64}, {"NIRS4ALL_PUBLICATION_STATUS": "source-built"},
                    {"NIRS4ALL_SOURCE_URL": "https://github.com/GBeurier/nirs4all/archive/main.tar.gz"},
                    {"DAG_ML_REF": "main"}):
        assert subprocess.run([bash, "-c", validation], env=environment | changed, cwd=ROOT, capture_output=True).returncode != 0
    for key, prefix, repository in [("dag", "DAG_ML", "dag-ml"), ("dag_data", "DAG_ML_DATA", "dag-ml-data")]:
        reference = environment[f"{prefix}_REF"]
        assert re.fullmatch(r"[0-9a-f]{40}", reference)
        assert reference == cohort[key]["source_sha"]
        assert environment[f"{prefix}_SOURCE_URL"] == f"https://github.com/GBeurier/{repository}/archive/{reference}.tar.gz"
    assert "NIRS4ALL_TOOLS" not in workflow


def _required_nirs4all() -> dict[str, str]:
    """The catalogue entry that owns the accepted nirs4all range and the installed version."""
    config = json.loads((ROOT / "recommended-config.json").read_text(encoding="utf-8"))
    return next(package for package in config["required"] if package["name"] == "nirs4all")


def test_nirs4all_range_has_a_single_source() -> None:
    config = json.loads((ROOT / "recommended-config.json").read_text(encoding="utf-8"))
    nirs4all = _required_nirs4all()
    assert nirs4all["range"] and nirs4all["install"]
    # The build scripts carry no package version: every wheel lock records the
    # catalogue's exact requirements and is refused once they differ.
    for script in ["python-runtime-config.cjs", "python-wheel-lock.cjs", "build-wheelhouse.cjs", "provision-environment.cjs"]:
        assert nirs4all["install"] not in (ROOT / "scripts" / script).read_text(encoding="utf-8"), script
    for target in WHEEL_LOCK_TARGETS:
        assert _wheel_lock(target)["requirements"]["required"] == [f"{package['name']}=={package['install']}" for package in config["required"]]
    # The sidecar embeds the same catalogue: no Rust source, embedded host
    # script or Rust test repeats the range or the installed version.
    assert 'include_str!("../../recommended-config.json")' in (ROOT / "sidecar/src/recommended_config.rs").read_text(encoding="utf-8")
    sources = [*(ROOT / "sidecar/src").rglob("*.rs"), *(ROOT / "sidecar/tests").glob("*.rs")]
    assert len(sources) > 40
    for path in sources:
        source = path.read_text(encoding="utf-8")
        assert nirs4all["range"] not in source, path
        assert nirs4all["install"] not in source, path


def test_recommended_profiles_use_single_nirs4all_version() -> None:
    config = json.loads((ROOT / "recommended-config.json").read_text(encoding="utf-8"))
    nirs4all = _required_nirs4all()
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    app_version = json.loads((ROOT / "version.json").read_text(encoding="utf-8"))

    # The remote-config resolver compares app_version with its cached copy.
    assert config["app_version"] == package["version"] == app_version["version"]
    assert config["nirs4all"] == nirs4all["install"]

    for profile in config["profiles"].values():
        package = profile.get("packages", {}).get("nirs4all")
        if package is None:
            continue
        assert package["recommended"] == nirs4all["install"]
        assert package["min"] == nirs4all["range"]


def test_release_installers_stage_the_locked_payload_instead_of_a_python_runtime() -> None:
    workflow = (ROOT / ".github" / "workflows" / "release-unified.yml").read_text(encoding="utf-8")
    parsed = yaml.safe_load(workflow)

    assert "pinned-plugin-wheels" not in parsed["jobs"]
    for forbidden in ["--plugin-wheel", "pip wheel", "pip install", "python-runtime", "bake-python-plugin-runtime"]:
        assert forbidden not in workflow
    staging = [
        "node scripts/fetch-uv.cjs",
        "node scripts/build-wheelhouse.cjs",
        "node scripts/studio-document-adapters.cjs --install backend-dist/adapters",
    ]
    for name in ["installer-linux", "installer-windows"]:
        job = parsed["jobs"][name]
        assert job["needs"] == "prepare"
        assert [leg["variant"] for leg in job["strategy"]["matrix"]["include"]] == ["standard", "offline"]
        staged = next(step["run"] for step in job["steps"] if step.get("name") == "Stage uv, required wheels and document adapters")
        assert staged.splitlines() == staging
        offline = next(step for step in job["steps"] if step.get("name") == "Stage offline payload")
        assert offline["if"] == "matrix.variant == 'offline'"
        assert offline["run"] == "node scripts/build-offline-payload.cjs"
    # The macOS application embeds no wheels and has no offline variant: Studio installs its required packages from the package index.
    macos = parsed["jobs"]["installer-macos-arm64"]
    assert "strategy" not in macos
    assert not any("build-offline-payload" in step.get("run", "") or "build-wheelhouse" in step.get("run", "") for step in macos["steps"])
    staged = next(step["run"] for step in macos["steps"] if step.get("name") == "Stage uv and document adapters")
    assert staged.splitlines() == [staging[0], staging[2], "test ! -e backend-dist/wheels"]
    assert "wheels.tar.gz" not in workflow and "NIRS4ALL_WHEELHOUSE_ARCHIVE" not in workflow


def test_generated_operator_registries_are_from_the_published_runtime() -> None:
    python_versions: set[str] = set()
    for path in [
        ROOT / "src" / "data" / "nodes" / "generated" / "canonical-registry.meta.json",
        ROOT / "public" / "node-registry" / "extended.meta.json",
    ]:
        metadata = json.loads(path.read_text(encoding="utf-8"))
        assert metadata["nirs4allVersion"] == "1.4.15"
        assert metadata["pythonVersion"].startswith("3.11.")
        assert metadata["sklearnVersion"] == "1.9.0"
        python_versions.add(metadata["pythonVersion"])
    assert len(python_versions) == 1


def test_wheel_locks_select_the_public_sdk_and_owner_cohort() -> None:
    config = json.loads((ROOT / "recommended-config.json").read_text(encoding="utf-8"))
    for target in WHEEL_LOCK_TARGETS:
        locked = {package["name"]: package for package in _wheel_lock(target)["packages"]}
        for package in config["required"]:
            assert locked[package["name"]]["version"] == package["install"], (target, package["name"])
        assert all(re.fullmatch(r"[0-9a-f]{64}", package["sha256"]) for package in locked.values())
        assert "nirs4all-tools" not in locked
        assert "duckdb" not in locked
    cohort = json.loads((ROOT / "sidecar/contracts/studio_native_source_cohort_v2.json").read_text())
    assert cohort["sdk_selection"]["requirement"] == _required_nirs4all()["range"]
    assert cohort["sdk_selection"]["publication_status"] == "published-registry"
    assert cohort["packaged_methods_identity"] == {
        "commit": "18dd0b5cece9da5eaac709a0451ce3e884fa1dda",
        "tree": "586b0c555be350a6d5658bbd9c1d843656a2764c",
        "project_version": "1.3.19",
    }


def test_current_public_wheel_identity_is_shared_by_shipping_consumers() -> None:
    sdk = json.loads((ROOT / "build/runtime-cohort.json").read_text())["sdk"]
    assert sdk["source_sha"] == "1a7c2f8ac9c75d4f80e3caeeb89b8cc44d24b0bb"
    assert sdk["wheel_sha256"] == "3bbcb78fc1f6992b4e91378edb36ce6bf9f03356b79321d49950196bd94ddaed"
    assert sdk["version"] == _required_nirs4all()["install"]
    assert sdk["publication_status"] == "published-registry"
    assert sdk["wheel_url"].endswith(f"/nirs4all-{sdk['version']}-py3-none-any.whl")
    # Every installer ships the same public SDK wheel bytes, on every target.
    for target in WHEEL_LOCK_TARGETS:
        locked = next(package for package in _wheel_lock(target)["packages"] if package["name"] == "nirs4all")
        assert (locked["version"], locked["url"], locked["sha256"]) == (sdk["version"], sdk["wheel_url"], sdk["wheel_sha256"])
    # The sidecar admits an environment by Python version, nirs4all range and
    # importability: it embeds no host contract, wheel digest or source commit.
    assert not list((ROOT / "sidecar/contracts").glob("studio_scientific_cpython_host*"))
    for path in (ROOT / "sidecar/src").rglob("*.rs"):
        rust = path.read_text(encoding="utf-8")
        assert "studio_scientific_cpython_host" not in rust, path
        for field in ["source_sha", "wheel_sha256"]:
            assert sdk[field] not in rust, path
    # Publication inputs are not an installed-host, packaged-worker or all-platform qualification claim.


def test_release_dispatch_only_publishes_when_explicitly_requested() -> None:
    workflow = yaml.safe_load((ROOT / ".github" / "workflows" / "release-unified.yml").read_text(encoding="utf-8"))

    for step_name in ["Login to GitHub Container Registry", "Publish the tested Docker image"]:
        step = next(step for step in workflow["jobs"]["release"]["steps"] if step.get("name") == step_name)
        assert step["if"] == "needs.prepare.outputs.is_tag_release == 'true' && needs.prepare.outputs.skip_docker != 'true'"


def test_release_first_launch_smoke_is_blocking_and_checksums_use_basenames() -> None:
    workflow = yaml.safe_load((ROOT / ".github" / "workflows" / "release-unified.yml").read_text(encoding="utf-8"))

    installers = {name: job for name, job in workflow["jobs"].items() if name.startswith("installer-")}
    assert set(installers) == {"installer-linux", "installer-windows", "installer-macos-arm64"}
    release = workflow["jobs"]["release"]
    for name, job in installers.items():
        assert name in release["needs"]
        assert f"needs.{name}.result == 'success'" in release["if"]
        steps = job["steps"]
        qualification = next(i for i, step in enumerate(steps) if "scripts/smoke-archive-standalone.cjs" in step.get("run", ""))
        upload = next(i for i, step in enumerate(steps) if step.get("name") == "Upload artifacts")
        assert qualification < upload
        qualifier = steps[qualification]["run"]
        assert "scripts/smoke-packaged-ui.cjs" in qualifier
        assert "--installer" in qualifier
        assert qualifier.count("--timeout-ms 240000") == 2
        assert "if" not in steps[qualification]
        assert not steps[qualification].get("continue-on-error", False)
        assert "checkout_ref" in steps[qualification]["env"]["RELEASE_SOURCE_SHA"]
        assert steps[upload]["with"]["name"].endswith("-payload")
        checksum = next(step["run"] for step in steps if step.get("name") == "Generate checksums")
        if name == "installer-windows":
            assert "$($_.Name)" in checksum
        else:
            assert checksum.startswith("cd release\n")
    # The existing finalizer verifies producer hashes and rewrites sidecars to
    # the exact public asset basename (GitHub normalizes spaces to dots).
    preparation = next(step for step in release["steps"] if step.get("name") == "Prepare release assets")
    assert "scripts/finalize-release-assets.cjs" in preparation["run"]
