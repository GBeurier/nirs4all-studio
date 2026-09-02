import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts.e2e import consume_repository_descriptor as consumer


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "parity" / "fixtures" / "portable_methods_pipeline.json"


def _resolution() -> dict[str, object]:
    dataset = {
        "kind": "provider_materialized_csv_nirs_matrix",
        "X": [[1.0, 2.0], [3.0, 4.0]],
        "y": [1.0, 2.0],
        "rows": 2,
        "cols": 2,
    }
    return {
        "repository": {"pipeline_id": "portable-methods", "catalog_count": 1},
        "dataset": {
            "execution_dataset": dataset,
            "execution_dataset_sha256": consumer._stable_hash(dataset),
            "execution_dataset_csv_sha256": "a" * 64,
            "io_package_summary_sha256": "b" * 64,
        },
    }


def _runtime(surface: str, predictions: list[float]) -> dict[str, object]:
    return {
        "surface": surface,
        "status": "passed",
        "name": "portable_methods_pipeline",
        "rows": 2,
        "cols": 2,
        "split": {
            "kind": "all",
            "train_count": 2,
            "test_count": 2,
            "trainIndices": [0, 1],
            "testIndices": [0, 1],
        },
        "preprocessing": [],
        "variants": [
            {
                "n_components": 1,
                "rmse": 0.25,
                "prediction_count": len(predictions),
                "predictions": predictions,
            }
        ],
        "selected": {
            "n_components": 1,
            "rmse": 0.25,
            "prediction_count": len(predictions),
            "predictions": predictions,
        },
        "target_count": len(predictions),
        "targets": [1.0, 2.0],
    }


class RepositoryDescriptorConsumerTests(unittest.TestCase):
    def test_consume_records_passed_runtime_execution_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            artifacts_dir = Path(tmp)
            shutil.copyfile(FIXTURE, artifacts_dir / consumer.PIPELINE_ARTIFACT)
            (artifacts_dir / consumer.RESOLUTION_ARTIFACT).write_text(
                json.dumps(_resolution()),
                encoding="utf-8",
            )

            with (
                mock.patch.object(
                    consumer,
                    "_load_javascript_wasm",
                    return_value={
                        "surface": "bindings/wasm",
                        "status": "passed",
                        "name": "portable_methods_pipeline",
                        "random_state": 42,
                        "classes": [
                            "nirs4all.operators.splitters.KennardStoneSplitter",
                            "nirs4all.operators.transforms.StandardNormalVariate",
                            "nirs4all.operators.transforms.SavitzkyGolay",
                            "sklearn.cross_decomposition.PLSRegression",
                        ],
                        "pipeline": json.loads(FIXTURE.read_text(encoding="utf-8")),
                    },
                ),
                mock.patch.object(
                    consumer,
                    "_run_python_execution",
                    return_value=_runtime("bindings/python", [1.25, 2.25]),
                ),
                mock.patch.object(
                    consumer,
                    "_run_r_execution",
                    return_value=_runtime("bindings/r", [1.25, 2.25]),
                ),
                mock.patch.object(
                    consumer,
                    "_run_javascript_wasm_execution",
                    return_value=_runtime("bindings/wasm", [1.25, 2.25]),
                ),
            ):
                result = consumer.consume(artifacts_dir)

        self.assertEqual(result["status"], "passed")
        self.assertEqual(result["execution"]["status"], "passed")
        self.assertEqual(result["execution"]["dataset"]["kind"], "provider_materialized_csv_nirs_matrix")
        self.assertEqual(result["execution"]["dataset"]["source_csv_sha256"], "a" * 64)
        self.assertEqual(result["execution"]["comparison"]["status"], "passed")
        self.assertEqual(
            sorted(result["execution"]["comparisons"]),
            ["python_vs_r", "python_vs_wasm", "r_vs_wasm"],
        )
        self.assertEqual(
            [item["status"] for item in result["execution"]["runtime_results"]],
            ["passed", "passed", "passed"],
        )
        self.assertEqual(
            [item["surface"] for item in result["execution"]["runtime_results"]],
            ["bindings/python", "bindings/r", "bindings/wasm"],
        )
        self.assertNotIn("known_followups", result)

    def test_strict_prediction_comparison_fails_on_prediction_drift(self) -> None:
        comparison = consumer._strict_prediction_comparison(
            _runtime("bindings/python", [1.0, 2.0]),
            _runtime("bindings/wasm", [1.0, 2.0 + consumer.EXECUTION_TOLERANCE * 20]),
        )

        self.assertEqual(comparison["status"], "failed")
        self.assertGreater(comparison["prediction_abs_max"], consumer.EXECUTION_TOLERANCE)

    def test_runtime_execution_requires_python_r_and_wasm_evidence(self) -> None:
        with (
            mock.patch.object(
                consumer,
                "_run_python_execution",
                return_value=_runtime("bindings/python", [1.25, 2.25]),
            ),
            mock.patch.object(
                consumer,
                "_run_r_execution",
                return_value=_runtime("bindings/r", [1.25, 2.25]),
            ),
            mock.patch.object(
                consumer,
                "_run_javascript_wasm_execution",
                side_effect=RuntimeError("missing methods wasm build"),
            ),
        ):
            with self.assertRaisesRegex(AssertionError, "required runtime surface"):
                consumer._runtime_execution(FIXTURE, _resolution())

    def test_runtime_execution_requires_provider_execution_dataset(self) -> None:
        with self.assertRaisesRegex(AssertionError, "provider execution dataset"):
            consumer._runtime_execution(FIXTURE, {"repository": {"pipeline_id": "portable-methods"}})

    def test_prepare_r_execution_library_installs_methods_and_core_with_preserved_libs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            artifacts_dir = root / "artifacts"
            r_bin = root / "r" / "bin"
            methods_root = root / "nirs4all-methods"
            methods_r = methods_root / "bindings" / "r" / "n4m"
            generated = methods_root / "build" / "dev-release" / "generated"
            methods_lib_dir = methods_root / "build" / "dev-release" / "cpp" / "src"
            include_dir = methods_root / "cpp" / "include"
            for path in (artifacts_dir, r_bin, methods_r, generated, methods_lib_dir, include_dir):
                path.mkdir(parents=True)
            rscript = r_bin / "Rscript"
            r_cmd = r_bin / "R"
            rscript.write_text("#!/bin/sh\n", encoding="utf-8")
            r_cmd.write_text("#!/bin/sh\n", encoding="utf-8")
            methods_lib = methods_lib_dir / "libn4m.so"
            methods_lib.write_text("", encoding="utf-8")

            commands: list[list[str]] = []

            def fake_run(*args, **kwargs):
                command = args[0]
                env = kwargs["env"]
                commands.append(command)
                self.assertEqual(command[0], str(r_cmd))
                self.assertEqual(env["N4M_R_LINK_PREBUILT"], "1")
                self.assertEqual(env["N4M_LIB_DIR"], str(methods_lib_dir))
                self.assertEqual(env["N4M_GENERATED_DIR"], str(generated))
                self.assertEqual(env["N4M_INCLUDE_DIR"], str(include_dir))
                self.assertEqual(env["R_MAKEVARS_USER"], str(artifacts_dir / "r-Makevars"))
                self.assertEqual(env["NIRS4ALL_CORE_R_PARITY_LIB"], str(artifacts_dir / "_r-lib"))
                self.assertEqual(env["R_LIBS"].split(os.pathsep)[:2], [str(artifacts_dir / "_r-lib"), "/opt/site-r-lib"])
                self.assertEqual(
                    env["R_LIBS_USER"].split(os.pathsep)[:2],
                    [str(artifacts_dir / "_r-lib"), "/home/runner/R/library"],
                )
                self.assertEqual(env["LD_LIBRARY_PATH"].split(os.pathsep)[0], str(methods_lib_dir))
                return subprocess.CompletedProcess(command, 0, "", "")

            with (
                mock.patch.object(consumer.subprocess, "run", side_effect=fake_run),
                mock.patch.dict(
                    os.environ,
                    {
                        "NIRS4ALL_METHODS_ROOT": str(methods_root),
                        "R_LIBS": "/opt/site-r-lib",
                        "R_LIBS_USER": "/home/runner/R/library",
                        "LD_LIBRARY_PATH": "/usr/lib",
                    },
                    clear=False,
                ),
            ):
                r_lib, error = consumer._prepare_r_execution_library(artifacts_dir, rscript)

        self.assertIsNone(error)
        self.assertEqual(r_lib, artifacts_dir / "_r-lib")
        self.assertEqual(len(commands), 2)
        self.assertIn(str(methods_r), commands[0])
        self.assertIn(str(ROOT / "bindings" / "r"), commands[1])


if __name__ == "__main__":
    unittest.main()
