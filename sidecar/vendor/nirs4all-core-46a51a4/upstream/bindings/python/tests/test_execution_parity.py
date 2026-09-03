import json
import os
import unittest
from pathlib import Path

import nirs4all_core as n4core


ROOT = Path(__file__).resolve().parents[3]
FIXTURE_DIR = ROOT / "tests" / "parity" / "fixtures"
ORACLE_PATH = ROOT / "tests" / "parity" / "expected" / "portable_python_oracle.json"


def _strict_methods_parity() -> bool:
    return (
        os.environ.get("NIRS4ALL_CORE_REQUIRE_METHODS_PARITY") == "1"
        or os.environ.get("NIRS4ALL_CORE_REQUIRE_METHODS_PARITY") == "1"
    )


def _max_abs_diff(actual, expected):
    if len(actual) != len(expected):
        raise AssertionError(f"length mismatch: {len(actual)} != {len(expected)}")
    return max((abs(float(a) - float(e)) for a, e in zip(actual, expected)), default=0.0)


class ExecutionParityTests(unittest.TestCase):
    def setUp(self) -> None:
        try:
            import numpy  # noqa: F401
            import n4m  # noqa: F401
            import pls4all  # noqa: F401
        except ImportError as exc:
            if _strict_methods_parity():
                raise
            raise unittest.SkipTest(
                "nirs4all-methods Python bindings are not available"
            ) from exc

    def test_python_binding_execution_matches_full_nirs4all_oracle(self) -> None:
        oracle = json.loads(ORACLE_PATH.read_text(encoding="utf-8"))
        dataset = {
            "X": oracle["dataset"]["X"],
            "y": oracle["dataset"]["y"],
            "rows": oracle["dataset"]["rows"],
            "cols": oracle["dataset"]["cols"],
        }
        tolerances = oracle["metadata"]["tolerances"]

        self.assertGreaterEqual(len(oracle["cases"]), 4)
        for expected in oracle["cases"]:
            with self.subTest(case=expected["name"]):
                fixture = FIXTURE_DIR / f"{expected['name']}.json"
                actual = n4core.run_portable_pipeline(fixture, dataset)

                self.assertEqual(actual["split"], expected["split"])
                self.assertLessEqual(
                    _max_abs_diff(actual["targets"], expected["targets"]),
                    tolerances["targets_abs"],
                )
                self.assertEqual(len(actual["variants"]), len(expected["variants"]))
                for actual_variant, expected_variant in zip(actual["variants"], expected["variants"]):
                    self.assertEqual(actual_variant["n_components"], expected_variant["n_components"])
                    self.assertLessEqual(
                        abs(actual_variant["rmse"] - expected_variant["rmse"]),
                        tolerances["rmse_abs"],
                        msg=(
                            f"{expected['name']} n_components="
                            f"{expected_variant['n_components']} RMSE diff"
                        ),
                    )
                    self.assertLessEqual(
                        _max_abs_diff(actual_variant["predictions"], expected_variant["predictions"]),
                        tolerances["predictions_abs"],
                        msg=(
                            f"{expected['name']} n_components="
                            f"{expected_variant['n_components']} prediction diff"
                        ),
                    )
                self.assertEqual(
                    actual["selected"]["n_components"],
                    expected["selected"]["n_components"],
                )


if __name__ == "__main__":
    unittest.main()
