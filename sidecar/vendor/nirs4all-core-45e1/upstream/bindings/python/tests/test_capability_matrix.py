"""Honesty gate for the per-language capability ledger.

``compat/capabilities.toml`` declares, per language binding, the capability level
of the portable operator subset using the vocabulary defined in
``docs/OPERATORS.md``. This test makes those claims non-fictional:

* the capability vocabulary is sourced from ``docs/OPERATORS.md`` (no parallel
  taxonomy is invented here);
* the declared portable operator subset equals ``PORTABLE_OPERATOR_CLASSES``;
* every binding that claims ``execute-local`` or better exposes a real run
  symbol in its source, and every binding that claims ``parity-validated`` has a
  real parity gate on disk;
* the aggregate only claims ``metadata`` over the lazily re-exported upstream
  domains, matching the actual (delegating) implementation.

Because it reads binding sources directly, the gate runs in the required Python
suite without R, Node, Octave, or a Rust toolchain.
"""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

import nirs4all_core as n4core

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover - local Python < 3.11 fallback
    import tomli as tomllib


ROOT = Path(__file__).resolve().parents[3]
CAPABILITIES = ROOT / "compat/capabilities.toml"
OPERATORS_DOC = ROOT / "docs/OPERATORS.md"
WASM_INDEX = ROOT / "bindings/wasm/src/index.js"
R_CAPABILITIES = ROOT / "bindings/r/R/capabilities.R"
RUST_LIB = ROOT / "bindings/rust/nirs4all/src/lib.rs"
MATLAB_CAPABILITY_MANIFEST = ROOT / "bindings/matlab/+nirs4all/capabilityManifest.m"
MATLAB_CONTROLLER_CAPABILITIES = ROOT / "bindings/matlab/+nirs4all/controllerCapabilities.m"
MATLAB_RUNTIME_SURFACES = ROOT / "bindings/matlab/+nirs4all/runtimeSurfaces.m"

EXPECTED_LANGUAGES = {"python", "rust", "wasm", "r", "matlab"}
EXPECTED_RUNTIME_SURFACES = {
    "python",
    "r",
    "javascript_wasm",
    "rust",
    "matlab_octave",
}
EXPECTED_RUNTIME_CONTRACT_SURFACES = (
    "python",
    "r",
    "javascript_wasm",
    "rust",
    "matlab_octave",
)
RUNTIME_ENTRYPOINT_SOURCES = {
    "python": ROOT / "bindings/python/src/nirs4all_core/_execution.py",
    "r": ROOT / "bindings/r/R/execution.R",
    "javascript_wasm": ROOT / "bindings/wasm/src/index.js",
    "rust": ROOT / "bindings/rust/nirs4all/src/lib.rs",
    "matlab_octave": ROOT / "bindings/matlab/+nirs4all/runPortablePipeline.m",
}
EXPECTED_CONTROLLER_IDS = (
    "split.kennard_stone",
    "preprocess.snv",
    "preprocess.savgol",
    "model.pls_regression",
    "pipeline.portable_methods",
)
EXPECTED_ARTIFACT_CONTRACT_IDS = (
    "conformal.calibrated_result",
    "robustness.summary",
    "tuning.summary",
    "tuning.ordered_search_space",
    "keyword.registry",
)
EXPECTED_REQUIRED_KEYWORD_REGISTRY_ENTRIES = (
    "run.tuning",
    "run.tuning.engine",
    "run.tuning.space",
    "run.tuning.force_params",
    "run.tuning.score_data",
    "run.tuning.score_data.conformal_calibration",
    "predict.coverage",
    "predict.all_predictions",
    "robustness.scenarios.kind",
    "robustness.scenarios.severity",
    "robustness.scenarios.distribution",
    "robustness.X",
    "robustness.predictor",
    "robustness.predictor_bundle",
)
# Levels from docs/OPERATORS.md that require a real, callable run symbol.
EXECUTABLE_LEVELS = {"execute-local", "execute-remote", "parity-validated"}


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _ladder_from_operators_doc() -> set[str]:
    """The capability vocabulary, parsed from the OPERATORS.md ladder list."""

    section = re.search(
        r"## Capability Levels\n(.*?)\n## ", _read(OPERATORS_DOC), re.DOTALL
    )
    if section is None:
        raise AssertionError("could not locate the Capability Levels section")
    return set(re.findall(r"(?m)^-\s+`([a-z-]+)`:", section.group(1)))


def _load_capabilities() -> dict:
    return tomllib.loads(_read(CAPABILITIES))


class CapabilityVocabularyTests(unittest.TestCase):
    def test_ladder_matches_operators_doc(self) -> None:
        ladder = _ladder_from_operators_doc()
        self.assertEqual(
            ladder,
            {"metadata", "plan", "execute-local", "execute-remote", "parity-validated"},
        )
        self.assertTrue(EXECUTABLE_LEVELS <= ladder)

    def test_every_declared_level_is_in_the_ladder(self) -> None:
        ladder = _ladder_from_operators_doc()
        caps = _load_capabilities()

        self.assertIn(caps["portable_pipeline"]["level"], ladder)
        self.assertIn(caps["upstream_domains"]["level"], ladder)
        for binding in caps["binding"]:
            with self.subTest(language=binding["language"]):
                self.assertIn(binding["level"], ladder)
        for contract in caps["runtime_contract"]:
            with self.subTest(surface=contract["surface"]):
                self.assertIn(contract["pipeline_execution"], ladder)


class PortableSubsetLedgerTests(unittest.TestCase):
    def test_declared_subset_equals_python_portable_operator_classes(self) -> None:
        caps = _load_capabilities()
        self.assertEqual(
            sorted(caps["portable_operator_subset"]),
            sorted(n4core.PORTABLE_OPERATOR_CLASSES),
        )

    def test_portable_pipeline_delegates_to_a_registered_upstream(self) -> None:
        caps = _load_capabilities()
        pipeline = caps["portable_pipeline"]

        self.assertEqual(pipeline["upstream"], "methods")
        self.assertIn(pipeline["upstream"], n4core.upstreams)
        self.assertTrue((ROOT / pipeline["oracle"]).exists())


class BindingCapabilityHonestyTests(unittest.TestCase):
    def test_all_five_languages_are_declared_once(self) -> None:
        caps = _load_capabilities()
        languages = [binding["language"] for binding in caps["binding"]]

        self.assertEqual(len(languages), len(set(languages)), "duplicate language row")
        self.assertEqual(set(languages), EXPECTED_LANGUAGES)

    def test_run_symbol_exists_in_source_for_executable_claims(self) -> None:
        caps = _load_capabilities()
        for binding in caps["binding"]:
            with self.subTest(language=binding["language"]):
                self.assertIn(binding["level"], EXECUTABLE_LEVELS)
                source = ROOT / binding["run_source"]
                self.assertTrue(source.exists(), source)
                self.assertIn(binding["run_symbol"], _read(source))

    def test_parity_validated_claims_have_a_real_parity_gate(self) -> None:
        caps = _load_capabilities()
        for binding in caps["binding"]:
            if binding["level"] != "parity-validated":
                continue
            with self.subTest(language=binding["language"]):
                gate = ROOT / binding["parity_gate"]
                self.assertTrue(gate.exists(), gate)
                parity_symbol = binding.get("parity_symbol")
                if parity_symbol is not None:
                    self.assertIn(parity_symbol, _read(gate))


class UpstreamDomainHonestyTests(unittest.TestCase):
    def test_upstream_domains_only_claim_metadata(self) -> None:
        caps = _load_capabilities()
        domains = caps["upstream_domains"]

        # The aggregate re-exports these lazily and does not execute them itself.
        self.assertEqual(domains["level"], "metadata")

    def test_upstream_domain_keys_are_registered_and_exclude_methods(self) -> None:
        caps = _load_capabilities()
        keys = set(caps["upstream_domains"]["keys"])

        self.assertTrue(keys <= set(n4core.upstreams))
        # `methods` is the executed upstream, not a metadata-only domain.
        self.assertNotIn("methods", keys)
        self.assertEqual(keys | {"methods"}, set(n4core.upstreams))


class ArtifactContractHonestyTests(unittest.TestCase):
    def test_native_conformal_and_robustness_contracts_do_not_overclaim_execution(self) -> None:
        caps = _load_capabilities()
        ladder = _ladder_from_operators_doc()
        rows = {item["id"]: item for item in caps["artifact_contract"]}

        self.assertEqual(tuple(rows), EXPECTED_ARTIFACT_CONTRACT_IDS)
        for contract_id, row in rows.items():
            with self.subTest(contract=contract_id):
                self.assertEqual(row["producer"], "full-python-nirs4all")
                self.assertIn("required_registry_entries", row)
                self.assertIn(
                    row["portable_claim"],
                    {
                        "not-exposed-in-nirs4all-core",
                        "summary-json-contract-only",
                        "search-space-json-contract-only",
                        "registry-json-contract-only",
                    },
                )
                levels = row["consumer_level"]
                self.assertEqual(set(levels), EXPECTED_RUNTIME_SURFACES)
                self.assertTrue(set(levels.values()) <= ladder)
                self.assertEqual(set(levels.values()), {"metadata"})
                self.assertNotIn(row["portable_claim"], {"execute-local", "execute-remote", "parity-validated"})

    def test_robustness_summary_contract_points_to_the_public_schema(self) -> None:
        rows = {item["id"]: item for item in _load_capabilities()["artifact_contract"]}

        self.assertEqual(
            rows["conformal.calibrated_result"]["optional_payload_fields"],
            [
                "conformal_guarantee_status",
                "calibration_replay_source",
                "tuning_calibration_source",
            ],
        )
        self.assertEqual(
            rows["robustness.summary"]["schema"],
            "https://nirs4all.org/schemas/robustness-summary/v1",
        )
        self.assertIn("summary_artifact", rows["robustness.summary"]["python_surface"])
        self.assertEqual(
            rows["robustness.summary"]["optional_payload_fields"],
            ["conformal_guarantee_status", "spectral_replay"],
        )

    def test_tuning_summary_contract_points_to_the_public_schema(self) -> None:
        rows = {item["id"]: item for item in _load_capabilities()["artifact_contract"]}

        self.assertEqual(
            rows["tuning.summary"]["schema"],
            "https://nirs4all.org/schemas/tuning-summary/v1",
        )
        self.assertIn("TuningResult.summary_artifact", rows["tuning.summary"]["python_surface"])
        self.assertIn("tuning_summary_schema_json", rows["tuning.summary"]["python_surface"])
        self.assertEqual(
            rows["tuning.summary"]["optional_payload_fields"],
            ["sampler", "pruner", "seed", "persistence", "trials[*].diagnostics"],
        )

    def test_ordered_tuning_search_space_contract_points_to_the_public_schema(self) -> None:
        rows = {item["id"]: item for item in _load_capabilities()["artifact_contract"]}

        self.assertEqual(
            rows["tuning.ordered_search_space"]["schema"],
            "https://nirs4all.org/schemas/tuning-ordered-search-space/v1",
        )
        self.assertIn("inspect_tuning_space", rows["tuning.ordered_search_space"]["python_surface"])
        self.assertIn("tuning_space_schema_json", rows["tuning.ordered_search_space"]["python_surface"])
        self.assertEqual(
            rows["tuning.ordered_search_space"]["portable_claim"],
            "search-space-json-contract-only",
        )
        self.assertEqual(rows["tuning.ordered_search_space"]["optional_payload_fields"], [])
        self.assertEqual(
            rows["tuning.ordered_search_space"]["required_registry_entries"],
            ["run.tuning.space", "run.tuning.force_params"],
        )

    def test_keyword_registry_contract_points_to_the_public_registry_surface(self) -> None:
        rows = {item["id"]: item for item in _load_capabilities()["artifact_contract"]}

        self.assertEqual(rows["keyword.registry"]["schema"], "nirs4all.keyword_registry.v1")
        self.assertIn("get_keyword_registry", rows["keyword.registry"]["python_surface"])
        self.assertIn("keyword_registry_schema_json", rows["keyword.registry"]["python_surface"])
        self.assertIn("TUNING_OPTIMIZER_PERSISTENCE_KEYS", rows["keyword.registry"]["python_surface"])
        self.assertIn("ROBUSTNESS_SCENARIO_KINDS", rows["keyword.registry"]["python_surface"])
        self.assertIn("ROBUSTNESS_SCENARIO_DISTRIBUTIONS", rows["keyword.registry"]["python_surface"])
        self.assertIn("ROBUSTNESS_MODES", rows["keyword.registry"]["python_surface"])
        self.assertIn("ROBUSTNESS_EXECUTABLE_MODES", rows["keyword.registry"]["python_surface"])
        self.assertEqual(
            rows["keyword.registry"]["published_constants"],
            {"ROBUSTNESS_SCENARIO_DISTRIBUTIONS": ["normal", "uniform"]},
        )
        self.assertEqual(
            tuple(rows["keyword.registry"]["required_registry_entries"]),
            EXPECTED_REQUIRED_KEYWORD_REGISTRY_ENTRIES,
        )
        self.assertEqual(
            tuple(n4core.required_keyword_registry_entries()),
            EXPECTED_REQUIRED_KEYWORD_REGISTRY_ENTRIES,
        )


class CustomHostCapabilityManifestTests(unittest.TestCase):
    def test_manifest_is_serializable_and_deep_copied(self) -> None:
        manifest = n4core.capability_manifest()
        json.dumps(manifest)

        self.assertEqual(manifest["schema"], "nirs4all-core.capabilities.v1")
        self.assertEqual(manifest["aggregate"], "nirs4all-core")

        manifest["controllers"][0]["id"] = "mutated"
        self.assertEqual(
            n4core.capability_manifest()["controllers"][0]["id"],
            EXPECTED_CONTROLLER_IDS[0],
        )
        manifest["artifact_contracts"][0]["id"] = "mutated"
        self.assertEqual(
            n4core.capability_manifest()["artifact_contracts"][0]["id"],
            EXPECTED_ARTIFACT_CONTRACT_IDS[0],
        )

    def test_artifact_contract_rows_match_toml_and_python_manifest(self) -> None:
        caps = _load_capabilities()
        toml_rows = {item["id"]: item for item in caps["artifact_contract"]}
        api_rows = {item["id"]: item for item in n4core.artifact_contracts()}
        manifest_rows = {item["id"]: item for item in n4core.capability_manifest()["artifact_contracts"]}

        self.assertEqual(tuple(toml_rows), EXPECTED_ARTIFACT_CONTRACT_IDS)
        self.assertEqual(set(api_rows), set(toml_rows))
        self.assertEqual(manifest_rows, api_rows)
        for contract_id, api_row in api_rows.items():
            with self.subTest(contract=contract_id):
                toml_row = toml_rows[contract_id]
                self.assertEqual(api_row["schema"], toml_row["schema"])
                self.assertEqual(api_row["producer"], toml_row["producer"])
                self.assertEqual(api_row["portable_claim"], toml_row["portable_claim"])
                self.assertEqual(api_row["python_surface"], toml_row["python_surface"])
                self.assertEqual(list(api_row["optional_payload_fields"]), toml_row["optional_payload_fields"])
                self.assertEqual(list(api_row["required_registry_entries"]), toml_row["required_registry_entries"])
                self.assertEqual(api_row.get("published_constants"), toml_row.get("published_constants"))
                self.assertEqual(set(api_row["consumer_level"]), EXPECTED_RUNTIME_SURFACES)
                self.assertEqual(set(api_row["consumer_level"].values()), {"metadata"})

    def test_runtime_surfaces_are_declared_once_in_toml_and_python(self) -> None:
        caps = _load_capabilities()
        manifest = n4core.capability_manifest()

        self.assertEqual(set(caps["runtime_surfaces"]), EXPECTED_RUNTIME_SURFACES)
        self.assertEqual(set(n4core.runtime_surfaces()), EXPECTED_RUNTIME_SURFACES)
        self.assertEqual(set(manifest["runtime_surfaces"]), EXPECTED_RUNTIME_SURFACES)
        self.assertEqual(
            tuple(item["surface"] for item in n4core.runtime_contracts()),
            EXPECTED_RUNTIME_CONTRACT_SURFACES,
        )
        self.assertEqual(
            tuple(item["surface"] for item in manifest["runtime_contracts"]),
            EXPECTED_RUNTIME_CONTRACT_SURFACES,
        )

    def test_runtime_contract_rows_match_toml_and_do_not_overclaim_predict(self) -> None:
        caps = _load_capabilities()
        ladder = _ladder_from_operators_doc()
        toml_rows = {item["surface"]: item for item in caps["runtime_contract"]}
        manifest_rows = {item["surface"]: item for item in n4core.runtime_contracts()}

        self.assertEqual(tuple(toml_rows), EXPECTED_RUNTIME_CONTRACT_SURFACES)
        self.assertEqual(set(manifest_rows), set(toml_rows))

        for surface, manifest_row in manifest_rows.items():
            with self.subTest(surface=surface):
                toml_row = toml_rows[surface]
                self.assertIn(manifest_row["pipeline_execution"], ladder)
                self.assertEqual(
                    manifest_row["pipeline_execution"],
                    toml_row["pipeline_execution"],
                )
                self.assertEqual(
                    manifest_row["pipeline_entrypoint"],
                    toml_row["pipeline_entrypoint"],
                )
                self.assertEqual(
                    manifest_row["serialized_model_predict"],
                    toml_row["serialized_model_predict"],
                )
                self.assertEqual(
                    manifest_row.get("predict_entrypoint"),
                    toml_row.get("predict_entrypoint"),
                )

                source = RUNTIME_ENTRYPOINT_SOURCES[surface]
                self.assertIn(manifest_row["pipeline_entrypoint"], _read(source))

        predict_rows = [
            item for item in manifest_rows.values() if item["serialized_model_predict"]
        ]
        self.assertEqual(
            [item["surface"] for item in predict_rows],
            ["javascript_wasm"],
        )
        wasm_row = toml_rows["javascript_wasm"]
        self.assertEqual(wasm_row["predict_entrypoint"], "predictPortablePipeline")
        self.assertIn(wasm_row["predict_entrypoint"], _read(WASM_INDEX))
        gate = ROOT / wasm_row["predict_parity_gate"]
        self.assertTrue(gate.exists(), gate)
        self.assertIn(wasm_row["predict_entrypoint"], _read(gate))

    def test_controller_ids_and_composition_are_stable(self) -> None:
        controllers = n4core.controller_capabilities()
        by_id = {item["id"]: item for item in controllers}

        self.assertEqual(tuple(by_id), EXPECTED_CONTROLLER_IDS)
        self.assertEqual(
            tuple(by_id["pipeline.portable_methods"]["composes"]),
            EXPECTED_CONTROLLER_IDS[:-1],
        )

    def test_controller_manifest_covers_the_portable_operator_subset(self) -> None:
        controllers = n4core.controller_capabilities()
        covered_classes = {
            class_name
            for controller in controllers
            for class_name in controller["operator_classes"]
        }

        self.assertEqual(covered_classes, set(n4core.PORTABLE_OPERATOR_CLASSES))
        for controller in controllers:
            with self.subTest(controller=controller["id"]):
                self.assertEqual(controller["domain"], "methods")
                self.assertTrue(controller["ports"]["inputs"])
                self.assertTrue(controller["ports"]["outputs"])

    def test_toml_controller_rows_match_the_python_manifest(self) -> None:
        caps = _load_capabilities()
        toml_rows = {item["id"]: item for item in caps["controller"]}
        manifest_rows = {item["id"]: item for item in n4core.controller_capabilities()}

        self.assertEqual(tuple(toml_rows), EXPECTED_CONTROLLER_IDS)
        self.assertEqual(set(manifest_rows), set(toml_rows))

        for controller_id, manifest_row in manifest_rows.items():
            with self.subTest(controller=controller_id):
                toml_row = toml_rows[controller_id]
                self.assertEqual(toml_row["kind"], manifest_row["kind"])
                self.assertEqual(toml_row["domain"], manifest_row["domain"])
                self.assertEqual(toml_row["label"], manifest_row["label"])
                self.assertEqual(
                    set(toml_row["operator_classes"]),
                    set(manifest_row["operator_classes"]),
                )
                self.assertEqual(
                    tuple(toml_row["inputs"]),
                    tuple(manifest_row["ports"]["inputs"]),
                )
                self.assertEqual(
                    tuple(toml_row["outputs"]),
                    tuple(manifest_row["ports"]["outputs"]),
                )
                self.assertEqual(
                    tuple(toml_row["parameters"]),
                    tuple(manifest_row["parameters"]),
                )
                self.assertEqual(
                    toml_row["execution_path"],
                    manifest_row["execution_path"],
                )

    def test_controller_runtime_levels_are_explicit_and_valid(self) -> None:
        ladder = _ladder_from_operators_doc()
        for controller in n4core.controller_capabilities():
            with self.subTest(controller=controller["id"]):
                runtime = controller["runtime"]
                self.assertEqual(set(runtime), EXPECTED_RUNTIME_SURFACES)
                self.assertTrue(set(runtime.values()) <= ladder)
                self.assertEqual(set(runtime.values()), {"parity-validated"})

    def test_all_bindings_expose_the_custom_host_manifest_surface(self) -> None:
        sources = {
            "wasm": (
                WASM_INDEX,
                (
                    "artifactContracts",
                    "capabilityManifest",
                    "controllerCapabilities",
                    "runtimeSurfaces",
                    "runtimeContracts",
                ),
            ),
            "r": (
                R_CAPABILITIES,
                (
                    "nirs4all_artifact_contracts",
                    "nirs4all_capability_manifest",
                    "nirs4all_controller_capabilities",
                    "nirs4all_runtime_surfaces",
                    "nirs4all_runtime_contracts",
                ),
            ),
            "rust": (
                RUST_LIB,
                (
                    "artifact_contracts",
                    "ARTIFACT_CONTRACTS",
                    "capability_manifest",
                    "CONTROLLER_CAPABILITIES",
                    "RUNTIME_SURFACES",
                    "RUNTIME_CONTRACTS",
                ),
            ),
            "matlab": (
                MATLAB_CAPABILITY_MANIFEST,
                (
                    "artifactContracts",
                    "capabilityManifest",
                    "controllerCapabilities",
                    "runtimeSurfaces",
                    "runtimeContracts",
                ),
            ),
        }

        for binding, (path, symbols) in sources.items():
            with self.subTest(binding=binding):
                text = _read(path)
                for symbol in symbols:
                    self.assertIn(symbol, text)

    def test_non_python_bindings_spell_the_same_controller_ids(self) -> None:
        sources = {
            "wasm": WASM_INDEX,
            "r": R_CAPABILITIES,
            "rust": RUST_LIB,
            "matlab": MATLAB_CONTROLLER_CAPABILITIES,
        }

        for binding, path in sources.items():
            text = _read(path)
            with self.subTest(binding=binding):
                for controller_id in EXPECTED_CONTROLLER_IDS:
                    self.assertIn(controller_id, text)

    def test_matlab_manifest_helpers_are_split_into_expected_files(self) -> None:
        self.assertTrue(MATLAB_CAPABILITY_MANIFEST.exists())
        self.assertTrue(MATLAB_CONTROLLER_CAPABILITIES.exists())
        self.assertTrue(MATLAB_RUNTIME_SURFACES.exists())


if __name__ == "__main__":
    unittest.main()
