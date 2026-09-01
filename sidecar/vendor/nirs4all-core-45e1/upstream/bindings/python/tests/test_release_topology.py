import json
import unittest
from pathlib import Path

import n4a
import nirs4all_core
import nirs4all_core as n4core
import yaml

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover - local Python < 3.11 fallback
    import tomli as tomllib


ROOT = Path(__file__).resolve().parents[3]


def _load_pyproject() -> dict[str, object]:
    return tomllib.loads((ROOT / "bindings/python/pyproject.toml").read_text())


def _load_r_description() -> dict[str, str]:
    fields: dict[str, str] = {}
    current: str | None = None
    for line in (ROOT / "bindings/r/DESCRIPTION").read_text().splitlines():
        if line.startswith((" ", "\t")) and current is not None:
            fields[current] = f"{fields[current]} {line.strip()}".strip()
            continue
        key, sep, value = line.partition(":")
        if sep:
            current = key
            fields[current] = value.strip()
    return fields


def _load_wasm_package() -> dict[str, object]:
    return json.loads((ROOT / "bindings/wasm/package.json").read_text())


def _load_wasm_package_lock() -> dict[str, object]:
    return json.loads((ROOT / "bindings/wasm/package-lock.json").read_text())


def _load_rust_cargo() -> dict[str, object]:
    return tomllib.loads((ROOT / "bindings/rust/nirs4all/Cargo.toml").read_text())


def _load_workflow(name: str) -> str:
    return (ROOT / ".github" / "workflows" / name).read_text()


def _load_workflow_yaml(name: str) -> dict[str, object]:
    return yaml.safe_load(_load_workflow(name))


def _load_compat_upstreams() -> dict[str, dict[str, object]]:
    upstreams = tomllib.loads((ROOT / "compat/upstreams.toml").read_text())["upstream"]
    return {item["key"]: item for item in upstreams}


def _checkout_step(job: dict[str, object], repository: str) -> dict[str, object]:
    matches = [
        step
        for step in job["steps"]
        if str(step.get("uses", "")).startswith("actions/checkout@")
        and step.get("with", {}).get("repository") == repository
    ]
    if len(matches) != 1:
        raise AssertionError(f"expected one checkout step for {repository}, got {len(matches)}")
    return matches[0]


def _step_by_id(job: dict[str, object], step_id: str) -> dict[str, object]:
    matches = [step for step in job["steps"] if step.get("id") == step_id]
    if len(matches) != 1:
        raise AssertionError(f"expected one step id {step_id}, got {len(matches)}")
    return matches[0]


def _step_by_name(job: dict[str, object], name: str) -> dict[str, object]:
    matches = [step for step in job["steps"] if step.get("name") == name]
    if len(matches) != 1:
        raise AssertionError(f"expected one step named {name}, got {len(matches)}")
    return matches[0]


def _job_run_text(job: dict[str, object]) -> str:
    return "\n".join(str(step.get("run", "")) for step in job["steps"])


def _makefile_target_dependencies(makefile: str, target: str) -> list[str]:
    for line in makefile.splitlines():
        if line.startswith(f"{target}:"):
            return line.partition(":")[2].split()
    raise AssertionError(f"Makefile target not found: {target}")


def _cargo_to_pep440(version: str) -> str:
    base, sep, prerelease = version.partition("-")
    if not sep:
        return base
    kind, _, number = prerelease.partition(".")
    suffix = {"alpha": "a", "beta": "b", "rc": "rc"}[kind]
    return f"{base}{suffix}{number or '0'}"


def _cargo_to_r(version: str) -> str:
    base = version.partition("-")[0]
    return f"{base}.9000" if "-" in version else base


class ReleaseTopologyManifestTests(unittest.TestCase):
    def test_manifest_is_json_serializable_and_names_current_distribution(self) -> None:
        manifest = n4core.release_topology_manifest()

        json.dumps(manifest)
        self.assertEqual(manifest["schema"], "nirs4all-core.release-topology.v2")
        self.assertEqual(manifest["aggregate"]["id"], "nirs4all-core")
        self.assertEqual(manifest["aggregate"]["repo"], "GBeurier/nirs4all-core")
        self.assertEqual(
            manifest["aggregate"]["target_repo"],
            "GBeurier/nirs4all-core",
        )
        self.assertEqual(manifest["aggregate"]["repo_rename_status"], "completed")
        self.assertFalse(manifest["aggregate"]["private"])
        self.assertNotIn("legacy_id", manifest["aggregate"])
        self.assertNotIn("legacy_repo", manifest["aggregate"])
        self.assertEqual(manifest["python"]["distribution"], "nirs4all-core")
        self.assertEqual(manifest["python"]["canonical_import"], "nirs4all_core")
        self.assertEqual(manifest["python"]["additive_imports"], ["n4a"])
        self.assertNotIn("legacy_distribution", manifest["python"])
        self.assertNotIn("legacy_distribution_status", manifest["python"])
        self.assertIn("nirs4all", manifest["python"]["reserved_non_imports"])

    def test_manifest_returns_a_deep_copy_for_consumers(self) -> None:
        manifest = n4core.release_topology_manifest()
        manifest["aggregate"]["id"] = "mutated"
        manifest["install_distributions"].clear()
        manifest["release_pointers"]["license"]["files"].clear()

        fresh = n4core.release_topology_manifest()
        self.assertEqual(fresh["aggregate"]["id"], "nirs4all-core")
        self.assertGreater(len(fresh["install_distributions"]), 0)
        self.assertIn("LICENSE", fresh["release_pointers"]["license"]["files"])

    def test_manifest_exposes_core_as_complete_aggregate(self) -> None:
        manifest = n4core.release_topology_manifest()
        contract = manifest["core_contract"]

        self.assertEqual(contract["import"], "nirs4all_core")
        self.assertEqual(contract["backing_import"], "nirs4all_core")
        self.assertTrue(contract["execution_engine"])
        self.assertEqual(
            contract["allowed_roles"],
            ["inspect", "validate", "capability", "facade", "execute"],
        )
        self.assertEqual(set(contract["public_exports"]), set(n4core.__all__))
        self.assertEqual(contract["core_exports"], list(n4core.core_facade_exports()))
        self.assertEqual(contract["topology_exports"], list(n4core.TOPOLOGY_EXPORTS))
        self.assertEqual(
            contract["execution_exports"],
            list(n4core.execution_engine_exports()),
        )
        self.assertNotIn("compat_passthrough", contract)
        self.assertEqual(
            n4core.validate_core_facade(nirs4all_core),
            {"missing_public_exports": (), "missing_execution_exports": ()},
        )

    def test_pyproject_matches_python_release_topology(self) -> None:
        pyproject = _load_pyproject()
        manifest = n4core.release_topology_manifest()

        self.assertEqual(
            pyproject["project"]["name"],
            manifest["python"]["distribution"],
        )
        self.assertEqual(pyproject["project"]["name"], "nirs4all-core")
        self.assertNotEqual(pyproject["project"]["name"], "nirs4all-lite")
        self.assertNotIn("nirs4all-core", pyproject["project"].get("dependencies", []))
        self.assertNotIn("nirs4all-lite", pyproject["project"].get("dependencies", []))

        self.assertEqual(pyproject["build-system"]["build-backend"], "maturin")
        maturin = pyproject["tool"]["maturin"]
        self.assertEqual(maturin["module-name"], "nirs4all_core._native")
        self.assertEqual(maturin["python-source"], "src")
        self.assertEqual(maturin["manifest-path"], "../python-native/Cargo.toml")

    def test_namespace_facades_are_machine_readable(self) -> None:
        manifest = n4core.release_topology_manifest()
        pyproject = _load_pyproject()
        wheel_packages = {"nirs4all_core", "n4a"}
        facades = {
            item["import"]: item for item in manifest["namespace_facades"]["python"]
        }

        self.assertEqual(
            set(facades),
            {"nirs4all_core", "n4a"},
        )
        self.assertEqual(set(facades), wheel_packages)
        self.assertEqual(facades["nirs4all_core"]["kind"], "canonical")
        self.assertEqual(facades["nirs4all_core"]["exports"], "full_aggregate")
        self.assertTrue(facades["nirs4all_core"]["execution_engine"])
        self.assertEqual(facades["n4a"]["backing_import"], "nirs4all_core")
        self.assertEqual(n4a.__aggregate_import__, "nirs4all_core")
        for facade in facades.values():
            self.assertEqual(facade["distribution"], pyproject["project"]["name"])
        self.assertEqual(nirs4all_core.__aggregate_import__, "nirs4all_core")
        reserved_reason = "owned by the full Python modelling library until cutover"
        self.assertEqual(
            manifest["namespace_facades"]["reserved_python_imports"],
            [{"import": "nirs4all", "reason": reserved_reason}],
        )

        non_python = {
            (
                item["ecosystem"],
                item["distribution"],
                item["namespace"],
            )
            for item in manifest["namespace_facades"]["non_python"]
        }
        self.assertEqual(
            non_python,
            {
                ("rust", "nirs4all", "nirs4all"),
                ("javascript_wasm", "nirs4all", "nirs4all"),
                ("r", "nirs4all", "library(nirs4all)"),
                ("matlab_octave", "nirs4all", "+nirs4all"),
            },
        )

    def test_install_distributions_remain_explicit(self) -> None:
        manifest = n4core.release_topology_manifest()
        index = {
            (item["ecosystem"], item["registry"], item["name"]): item
            for item in manifest["install_distributions"]
        }

        self.assertEqual(len(index), len(manifest["install_distributions"]))
        expected_current_artifacts = {
            ("python", "pypi", "nirs4all-core"): (
                "current",
                "release-python.yml",
                "wheel+sdist",
            ),
            ("rust", "crates.io", "nirs4all"): (
                "current",
                "release-crates.yml",
                "crate",
            ),
            ("javascript_wasm", "npm", "nirs4all"): (
                "current",
                "release-npm.yml",
                "npm package",
            ),
            ("r", "cran/r-universe", "nirs4all"): (
                "current",
                "release-r.yml",
                "source package",
            ),
            ("matlab_octave", "github-release", "nirs4all-matlab-octave"): (
                "current",
                "release-matlab.yml",
                "zip archive",
            ),
            ("source_sbom", "github-release", "nirs4all-core-source-sbom"): (
                "current",
                "release-source.yml",
                "source archive + CycloneDX SBOM + SHA256SUMS",
            ),
        }

        for key, (status, workflow, artifact) in expected_current_artifacts.items():
            with self.subTest(distribution=key):
                self.assertEqual(index[key]["status"], status)
                self.assertEqual(index[key]["workflow"], workflow)
                self.assertEqual(index[key]["artifact"], artifact)

        self.assertNotIn(("python", "pypi", "nirs4all-lite"), index)

        upstream_rows = {
            item["component_key"]: item
            for item in manifest["install_distributions"]
            if item["ecosystem"] == "python" and "component_key" in item
        }
        self.assertEqual(
            set(upstream_rows),
            {"methods", "formats", "io", "datasets", "dag_ml", "dag_ml_data"},
        )
        self.assertEqual(
            upstream_rows["methods"]["status"],
            "upstream-explicit",
        )
        self.assertEqual(upstream_rows["datasets"]["status"], "external-optional")
        self.assertEqual(upstream_rows["datasets"]["default_inclusion"], "external")

    def test_language_bindings_are_explicit_v1_release_surfaces(self) -> None:
        manifest = n4core.release_topology_manifest()
        pyproject = _load_pyproject()
        r_description = _load_r_description()
        wasm_package = _load_wasm_package()
        rust_cargo = _load_rust_cargo()
        makefile = (ROOT / "Makefile").read_text()

        surfaces = {
            item["ecosystem"]: item for item in manifest["v1_release_surfaces"]
        }
        install_distributions = {
            (item["ecosystem"], item["registry"], item["name"]): item
            for item in manifest["install_distributions"]
        }

        self.assertEqual(
            set(surfaces),
            {"python", "javascript_wasm", "rust", "r", "matlab_octave"},
        )
        expected_names = {
            "python": pyproject["project"]["name"],
            "javascript_wasm": wasm_package["name"],
            "rust": rust_cargo["package"]["name"],
            "r": r_description["Package"],
            "matlab_octave": "nirs4all-matlab-octave",
        }
        expected_workflows = {
            "python": "release-python.yml",
            "javascript_wasm": "release-npm.yml",
            "rust": "release-crates.yml",
            "r": "release-r.yml",
            "matlab_octave": "release-matlab.yml",
        }
        expected_release_gates = {
            "python": ("test-python", "required"),
            "javascript_wasm": ("test-wasm", "required"),
            "rust": ("test-rust", "required"),
            "r": ("test-r-if-available", "skip-locally-if-r-missing"),
            "matlab_octave": (
                "test-matlab-parity-if-available",
                "skip-locally-if-octave-missing",
            ),
        }
        expected_surface_gate_targets = {
            "python": "test-python-v1-surfaces",
            "javascript_wasm": "test-wasm-v1-surfaces",
            "rust": "test-rust",
            "r": "test-r-v1-surfaces-if-available",
            "matlab_octave": "test-matlab-parity-if-available",
        }
        expected_version_sources = {
            "python": ("bindings/python/pyproject.toml:project.version", "pep440"),
            "javascript_wasm": ("bindings/wasm/package.json:version", "cargo-semver"),
            "rust": (
                "bindings/rust/nirs4all/Cargo.toml:package.version",
                "cargo-semver",
            ),
            "r": ("bindings/r/DESCRIPTION:Version", "r-description"),
            "matlab_octave": (
                "bindings/rust/nirs4all/Cargo.toml:package.version",
                "derived-cargo-semver",
            ),
        }
        self.assertEqual(
            _makefile_target_dependencies(makefile, "test-v1-surfaces"),
            [
                "test-rust",
                "test-python-v1-surfaces",
                "test-wasm-v1-surfaces",
                "test-r-v1-surfaces-if-available",
                "test-matlab-parity-if-available",
            ],
        )
        self.assertIn("bindings/python/tests/test_release_topology.py", makefile)
        self.assertIn("bindings/python/tests/test_facade.py", makefile)
        self.assertIn("bindings/python/tests/test_pipeline_contract.py", makefile)
        self.assertIn("bindings/python/tests/test_upstreams.py", makefile)
        self.assertIn("test:v1-surface", makefile)
        self.assertIn("bindings/r/tests/surface.R", makefile)
        self.assertIn("command -v R >/dev/null 2>&1", makefile)
        self.assertIn(
            "SKIP/RISK: R V1 public surface not checked: R/Rscript is not installed",
            makefile,
        )
        self.assertIn("command -v octave >/dev/null 2>&1", makefile)
        self.assertIn(
            "SKIP/RISK: MATLAB/Octave execution parity not checked: octave is not installed",
            makefile,
        )
        self.assertIn("set -eu", makefile)

        for ecosystem, package_name in expected_names.items():
            with self.subTest(ecosystem=ecosystem):
                surface = surfaces[ecosystem]
                self.assertEqual(surface["distribution"], package_name)
                self.assertEqual(
                    surface["release_workflow"],
                    expected_workflows[ecosystem],
                )
                self.assertIn(f"{surface['local_gate']}:", makefile)
                self.assertIn(f"{expected_surface_gate_targets[ecosystem]}:", makefile)
                self.assertEqual(
                    (surface["local_gate"], surface["tool_policy"]),
                    expected_release_gates[ecosystem],
                )
                self.assertEqual(
                    (surface["version_source"], surface["version_spelling"]),
                    expected_version_sources[ecosystem],
                )
                if ecosystem == "rust":
                    self.assertTrue(surface["version_source_of_truth"])

                distribution = install_distributions[
                    (ecosystem, surface["registry"], package_name)
                ]
                self.assertEqual(distribution["status"], "current")
                self.assertEqual(distribution["workflow"], surface["release_workflow"])
                self.assertEqual(distribution["default_inclusion"], "base")

        matlab_builder = (ROOT / "scripts/build-matlab-package.sh").read_text()
        self.assertIn("bindings/rust/nirs4all/Cargo.toml", matlab_builder)
        self.assertIn('archive="nirs4all-matlab-octave-${version}.zip"', matlab_builder)

    def test_binding_versions_stay_in_sync_with_rust_source_of_truth(self) -> None:
        rust_version = str(_load_rust_cargo()["package"]["version"])
        expected_python = _cargo_to_pep440(rust_version)
        expected_r = _cargo_to_r(rust_version)

        pyproject = _load_pyproject()
        wasm_package = _load_wasm_package()
        wasm_lock = _load_wasm_package_lock()
        r_description = _load_r_description()

        self.assertEqual(pyproject["project"]["version"], expected_python)
        self.assertEqual(n4core.__version__, expected_python)
        self.assertEqual(n4a.__version__, expected_python)
        self.assertEqual(nirs4all_core.__version__, expected_python)

        self.assertEqual(wasm_package["version"], rust_version)
        self.assertEqual(wasm_lock["version"], rust_version)
        self.assertEqual(wasm_lock["packages"][""]["version"], rust_version)
        self.assertEqual(r_description["Version"], expected_r)

    def test_version_guard_checks_python_surface_and_binding_sync(self) -> None:
        workflow = _load_workflow_yaml("version-guard.yml")
        guard = workflow["jobs"]["guard"]
        guard_runs = _job_run_text(guard)
        syncer = (ROOT / "scripts/bump_version.sh").read_text()

        self.assertIn("scripts/bump_version.sh --check", guard_runs)
        self.assertIn("bindings/python/pyproject.toml", guard_runs)
        self.assertIn("bindings/python/src/nirs4all_core/__init__.py", guard_runs)
        self.assertIn("__version__", guard_runs)
        self.assertIn("bindings/python/src/nirs4all_core/__init__.py", syncer)
        self.assertIn("root_lock_ver", syncer)

    def test_python_release_workflow_uses_current_repo_trusted_publisher_tuple(self) -> None:
        workflow = _load_workflow_yaml("release-python.yml")
        publish = workflow["jobs"]["publish-pypi"]
        workflow_text = _load_workflow("release-python.yml")

        self.assertEqual(publish["environment"]["name"], "pypi")
        self.assertEqual(publish["environment"]["url"], "https://pypi.org/p/nirs4all-core")
        self.assertEqual(publish["permissions"]["id-token"], "write")
        self.assertIn("repo = nirs4all-core", workflow_text)
        self.assertNotIn("repo = nirs4all-lite", workflow_text)

        preflight = _step_by_name(publish, "Validate Trusted Publisher release tuple")
        self.assertIn('expected_repo="GBeurier/nirs4all-core"', preflight["run"])
        self.assertIn("GITHUB_REPOSITORY", preflight["run"])
        self.assertIn("GITHUB_WORKFLOW_REF", preflight["run"])
        self.assertIn("environment=pypi", preflight["run"])

    def test_public_r_wasm_and_matlab_releases_require_strict_parity(self) -> None:
        methods = _load_compat_upstreams()["methods"]
        self.assertEqual(methods["repo"], "GBeurier/nirs4all-methods")
        self.assertRegex(str(methods["ref"]), r"^[0-9a-f]{40}$")

        expected_ref = "${{ steps.methods-pin.outputs.ref }}"
        npm_workflow = _load_workflow_yaml("release-npm.yml")
        npm_jobs = npm_workflow["jobs"]
        npm_job = npm_jobs["strict-wasm-parity"]
        self.assertEqual(npm_jobs["build-and-publish"]["needs"], "strict-wasm-parity")
        npm_pin = _step_by_id(npm_job, "methods-pin")
        self.assertEqual(npm_pin["shell"], "python")
        self.assertIn("compat/upstreams.toml", npm_pin["run"])
        self.assertIn('item.get("key") == "methods"', npm_pin["run"])
        npm_checkout = _checkout_step(npm_job, methods["repo"])
        self.assertEqual(npm_checkout["with"]["path"], "nirs4all-methods")
        self.assertEqual(npm_checkout["with"]["ref"], expected_ref)
        npm_runs = _job_run_text(npm_job)
        self.assertIn("cmake --preset emscripten", npm_runs)
        self.assertIn("NIRS4ALL_METHODS_JS_DIST=", npm_runs)
        self.assertIn("NIRS4ALL_CORE_REQUIRE_METHODS_PARITY=1", npm_runs)
        self.assertIn("npm test --prefix bindings/wasm", npm_runs)
        makefile = (ROOT / "Makefile").read_text()
        self.assertIn("check-wasm-methods-artifact:", makefile)
        self.assertIn("test-wasm-parity-strict: check-wasm-methods-artifact", makefile)
        self.assertIn("index.js n4m.js n4m.wasm", makefile)

        r_workflow = _load_workflow_yaml("release-r.yml")
        r_jobs = r_workflow["jobs"]
        r_job = r_jobs["strict-r-parity"]
        self.assertEqual(set(r_jobs["build-tarball"]["needs"]), {"check", "strict-r-parity"})
        r_pin = _step_by_id(r_job, "methods-pin")
        self.assertEqual(r_pin["shell"], "python")
        self.assertIn("compat/upstreams.toml", r_pin["run"])
        self.assertIn('item.get("key") == "methods"', r_pin["run"])
        r_checkout = _checkout_step(r_job, methods["repo"])
        self.assertEqual(r_checkout["with"]["path"], "nirs4all-methods")
        self.assertEqual(r_checkout["with"]["ref"], expected_ref)
        r_runs = _job_run_text(r_job)
        self.assertIn("cmake --preset dev-release", r_runs)
        self.assertIn("make test-r-parity", r_runs)
        r_parity_step = _step_by_name(r_job, "Run strict R parity against the Python oracle")
        self.assertEqual(
            r_parity_step["env"]["NIRS4ALL_CORE_REQUIRE_METHODS_PARITY"],
            "1",
        )

        matlab_workflow = _load_workflow_yaml("release-matlab.yml")
        matlab_jobs = matlab_workflow["jobs"]
        matlab_job = matlab_jobs["strict-matlab-parity"]
        self.assertEqual(matlab_jobs["matlab-package"]["needs"], "strict-matlab-parity")
        matlab_pin = _step_by_id(matlab_job, "methods-pin")
        self.assertEqual(matlab_pin["shell"], "python")
        self.assertIn("compat/upstreams.toml", matlab_pin["run"])
        self.assertIn('item.get("key") == "methods"', matlab_pin["run"])
        matlab_checkout = _checkout_step(matlab_job, methods["repo"])
        self.assertEqual(matlab_checkout["with"]["path"], "nirs4all-methods")
        self.assertEqual(matlab_checkout["with"]["ref"], expected_ref)
        matlab_runs = _job_run_text(matlab_job)
        self.assertIn("cmake --preset dev-release", matlab_runs)
        self.assertIn("cmake --build --preset dev-release --target n4m_c", matlab_runs)
        self.assertIn('octave --quiet --eval "cd bindings/matlab; build_mex"', matlab_runs)
        self.assertIn("make test-matlab-parity", matlab_runs)
        matlab_parity_step = _step_by_name(
            matlab_job,
            "Run strict MATLAB/Octave parity against the Python oracle",
        )
        self.assertEqual(
            matlab_parity_step["env"]["NIRS4ALL_CORE_REQUIRE_METHODS_PARITY"],
            "1",
        )
        self.assertEqual(
            matlab_parity_step["env"]["NIRS4ALL_METHODS_MATLAB_PATH"],
            "${{ github.workspace }}/nirs4all-methods/bindings/matlab",
        )
        self.assertNotIn("continue-on-error", _load_workflow("release-matlab.yml"))

    def test_wasm_package_locks_typechecked_optional_peers(self) -> None:
        package = _load_wasm_package()
        lock = _load_wasm_package_lock()
        root_lock = lock["packages"][""]
        expected_peers = {
            "@nirs4all/datasets-wasm",
            "@nirs4all/formats-wasm",
            "@nirs4all/io-wasm",
            "@nirs4all/methods",
            "dag-ml-data-wasm",
            "dag-ml-wasm",
        }

        self.assertEqual(lock["lockfileVersion"], 3)
        self.assertEqual(package["types"], "./src/index.d.ts")
        self.assertEqual(package["exports"]["."]["types"], package["types"])
        self.assertEqual(package["scripts"]["test"], "npm run test:js && npm run typecheck")
        self.assertEqual(package["scripts"]["typecheck"], "tsc --project tsconfig.typecheck.json")
        self.assertEqual(package["devDependencies"]["typescript"], "5.9.3")
        self.assertEqual(set(package["peerDependencies"]), expected_peers)
        self.assertEqual(set(package["peerDependenciesMeta"]), expected_peers)
        self.assertEqual(set(root_lock["peerDependencies"]), expected_peers)
        self.assertEqual(set(root_lock["peerDependenciesMeta"]), expected_peers)
        self.assertEqual(root_lock["license"], package["license"])
        for peer in expected_peers:
            self.assertEqual(package["peerDependencies"][peer], "*")
            self.assertTrue(package["peerDependenciesMeta"][peer]["optional"])
            self.assertEqual(root_lock["peerDependencies"][peer], "*")
            self.assertTrue(root_lock["peerDependenciesMeta"][peer]["optional"])

        typescript = lock["packages"]["node_modules/typescript"]
        self.assertEqual(typescript["version"], package["devDependencies"]["typescript"])
        self.assertTrue(typescript["dev"])
        self.assertIn("tsc", typescript["bin"])

        tsconfig = json.loads((ROOT / "bindings/wasm/tsconfig.typecheck.json").read_text())
        self.assertEqual(tsconfig["compilerOptions"]["module"], "NodeNext")
        self.assertTrue(tsconfig["compilerOptions"]["strict"])
        consumer = (ROOT / "bindings/wasm/tests/types/consumer.ts").read_text()
        self.assertIn("from 'nirs4all'", consumer)
        self.assertIn("runPortablePipeline", consumer)
        self.assertIn("predictPortablePipeline", consumer)

    def test_optional_upstreams_are_explicit_and_match_python_extras(self) -> None:
        manifest = n4core.release_topology_manifest()
        pyproject = _load_pyproject()
        extras = pyproject["project"]["optional-dependencies"]
        all_extra = extras["all"]
        components = {
            item["key"]: item for item in manifest["upstream_components"]
        }

        self.assertEqual(set(components), set(n4core.upstreams))
        self.assertFalse(any(component["private"] for component in components.values()))

        for key, upstream in n4core.upstreams.items():
            with self.subTest(upstream=key):
                component = components[key]
                self.assertEqual(component["role"], upstream.role)
                python = component["python"]
                self.assertIn(python["extra"], extras)
                if python["bundled_in_all"]:
                    self.assertTrue(
                        any(
                            dependency.startswith(python["distribution"])
                            for dependency in all_extra
                        )
                    )

        datasets = components["datasets"]
        self.assertTrue(datasets["optional"])
        self.assertEqual(datasets["default_inclusion"], "external")
        self.assertFalse(datasets["python"]["bundled_in_all"])
        self.assertFalse(
            any(dependency.startswith("nirs4all-datasets") for dependency in all_extra)
        )
        self.assertEqual(extras["datasets"], ["nirs4all-datasets>=0.3.5"])
        self.assertIn("nirs4all-methods>=1.0.9", extras["methods"])
        self.assertIn("pls4all>=1.0.9", extras["methods"])
        self.assertIn("scikit-learn>=1.3", extras["methods"])
        self.assertIn("nirs4all-formats>=0.2.7", all_extra)
        self.assertIn("nirs4all-io>=0.1.11", all_extra)
        self.assertIn("nirs4all-methods>=1.0.9", all_extra)
        self.assertIn("pls4all>=1.0.9", all_extra)
        self.assertNotIn("nirs4all-methods>=1.0.5", extras["methods"])

    def test_compat_registry_matches_release_topology_packages(self) -> None:
        manifest = n4core.release_topology_manifest()
        components = {
            item["key"]: item for item in manifest["upstream_components"]
        }
        compat = _load_compat_upstreams()

        self.assertEqual(set(compat), set(components))

        for key, component in components.items():
            with self.subTest(upstream=key):
                compat_item = compat[key]
                packages = component["packages"]
                self.assertEqual(compat_item["repo"], component["repo"])
                self.assertEqual(compat_item["role"], component["role"])
                self.assertEqual(
                    compat_item.get("python_imports", []),
                    component["python"]["imports"],
                )
                self.assertEqual(compat_item.get("r_packages", []), packages["r"])
                self.assertEqual(
                    compat_item.get("matlab_packages", []), packages["matlab"]
                )
                self.assertEqual(compat_item.get("wasm_packages", []), packages["npm"])
                bindings = set(compat_item.get("bindings", []))
                if packages["r"]:
                    self.assertIn("r", bindings)
                if packages["npm"]:
                    self.assertIn("wasm", bindings)

    def test_release_pointers_include_license_provenance_and_methods_abi(self) -> None:
        manifest = n4core.release_topology_manifest()
        pyproject = _load_pyproject()
        pointers = manifest["release_pointers"]

        license_pointer = pointers["license"]
        self.assertEqual(
            license_pointer["expression"],
            pyproject["project"]["license"],
        )
        self.assertEqual(
            license_pointer["source"],
            "bindings/python/pyproject.toml:project.license",
        )
        for relative_path in license_pointer["files"]:
            with self.subTest(license_file=relative_path):
                self.assertTrue((ROOT / relative_path).exists())

        r_description = _load_r_description()
        self.assertEqual(
            r_description["License"],
            "CeCILL-2.1 | AGPL (>= 3)",
        )
        r_license_note = (ROOT / "bindings/r/LICENSE").read_text()
        self.assertIn(license_pointer["expression"], r_license_note)

        abi_pointers = {item["key"]: item for item in pointers["abi"]}
        methods_abi = abi_pointers["methods_c_abi"]
        methods_component = {
            item["key"]: item for item in manifest["upstream_components"]
        }["methods"]
        self.assertEqual(methods_abi["provider"], "nirs4all-methods")
        self.assertEqual(methods_abi["component_key"], "methods")
        self.assertEqual(
            methods_abi["header"],
            methods_component["packages"]["c_abi"][0]["header"],
        )
        self.assertEqual(methods_abi["symbol_prefix"], "n4m_")
        self.assertIn("n4m.abi", methods_abi["conformance_refs"])
        self.assertEqual(pointers["provenance"]["workflow"], "release-source.yml")


if __name__ == "__main__":
    unittest.main()
