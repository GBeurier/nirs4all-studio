"""Opt-in Dag-ML 0.3.18 multi-target Archive V2 replay witness.

Set ``NIRS4ALL_CORE_LIVE_ARCHIVE_V2`` to a valid two-feature, multi-target
Methods Archive V2 produced by Dag-ML 0.3.18 and
``NIRS4ALL_CORE_LIVE_METHODS_LIBRARY`` to a compatible ``libn4m``. The test is
intentionally fixture-free: archives and native binaries remain release
artifacts rather than committed test data.
"""

from __future__ import annotations

import hashlib
import importlib
import json
import math
import os
import struct
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from typing import Any

from nirs4all_core import (
    read_portable_predictor_package_v2,
    replay_methods_archive_v2,
    replay_methods_archive_v2_conformal_presentation_v1,
)

_ARCHIVE_ENV = "NIRS4ALL_CORE_LIVE_ARCHIVE_V2"
_CONFORMAL_ARCHIVE_ENV = "NIRS4ALL_CORE_LIVE_CONFORMAL_ARCHIVE_V2"
_LIBRARY_ENV = "NIRS4ALL_CORE_LIVE_METHODS_LIBRARY"
_TMPDIR_ENV = "NIRS4ALL_CORE_LIVE_TMPDIR"
_FINGERPRINT_PREFIX = b"n4a-matrix-f64-le.v1\0"


def _canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _feature_fingerprint(matrix: list[list[float]]) -> str:
    rows = len(matrix)
    columns = len(matrix[0])
    values = [value for row in matrix for value in row]
    hasher = hashlib.sha256()
    hasher.update(_FINGERPRINT_PREFIX)
    hasher.update(struct.pack("<QQ", rows, columns))
    hasher.update(struct.pack(f"<{len(values)}d", *values))
    return hasher.hexdigest()


def _contracts(package: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    dag_ml: Any = importlib.import_module("dag_ml")

    matrix = [[1.5, 0.5], [3.5, 1.5]]
    sample_ids = ["predict.0", "predict.1"]
    records: list[dict[str, Any]] = [
        {
            "observation_id": sample_id,
            "sample_id": sample_id,
            "target_id": None,
            "group_id": None,
            "origin_sample_id": None,
            "source_id": None,
            "is_augmented": False,
            "metadata": {},
        }
        for sample_id in sample_ids
    ]
    relations = {"records": records}
    relation_fingerprint = dag_ml.sample_relation_set_fingerprint_json(
        _canonical_json(relations)
    )
    requirements = package["execution_bundle"]["data_requirements"]
    envelopes: dict[str, Any] = {}
    inputs: dict[str, Any] = {}
    for requirement in requirements:
        key = f"{requirement['node_id']}.{requirement['input_name']}"
        envelopes[key] = {
            "schema_version": 1,
            "schema_fingerprint": requirement["schema_fingerprint"],
            "plan_fingerprint": requirement["plan_fingerprint"],
            "relation_fingerprint": relation_fingerprint,
            "data_content_fingerprint": _feature_fingerprint(matrix),
            "target_content_fingerprint": None,
            "coordinator_relations": relations,
        }
        inputs[key] = {
            "sample_ids": sample_ids,
            "x": matrix,
            "target_names": package["output_bindings"][0]["target_names"],
        }
    request = dag_ml.sign_training_replay_request(
        {
            "schema_version": 1,
            "request_id": "replay:nirs4all.core_live_witness",
            "source_outcome_fingerprint": package["training_outcome"]["outcome_fingerprint"],
            "phase": "PREDICT",
            "data_envelope_keys": sorted(envelopes),
            "output_binding_ids": [package["output_bindings"][0]["binding_id"]],
            "request_fingerprint": "0" * 64,
        }
    )
    if hasattr(request, "to_dict"):
        request = request.to_dict()
    return request, envelopes, inputs


def _tamper_n4mm(source: Path, destination: Path) -> None:
    with zipfile.ZipFile(source) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        member_path = manifest["payloads"]["methods"]["n4mm"][0]["member_path"]
        with zipfile.ZipFile(destination, "x") as altered:
            for info in archive.infolist():
                payload = archive.read(info.filename)
                if info.filename == member_path:
                    payload = payload[:-1] + bytes([payload[-1] ^ 1])
                altered.writestr(info, payload)


@unittest.skipUnless(
    os.environ.get(_ARCHIVE_ENV) and os.environ.get(_LIBRARY_ENV),
    f"set {_ARCHIVE_ENV} and {_LIBRARY_ENV} to run the native witness",
)
class LiveArchiveV2ReplayTests(unittest.TestCase):
    def setUp(self) -> None:
        self.archive = Path(os.environ[_ARCHIVE_ENV])
        self.library = Path(os.environ[_LIBRARY_ENV])
        package = json.loads(read_portable_predictor_package_v2(self.archive))
        dag_ml: Any = importlib.import_module("dag_ml")
        self.assertEqual(dag_ml.__version__, "0.3.18")
        self.target_names = package["output_bindings"][0]["target_names"]
        self.assertGreaterEqual(len(self.target_names), 2)
        self.request, self.envelopes, self.inputs = _contracts(package)

    def test_real_wheel_replays_multi_target_n4mm_with_valid_cross_link(self) -> None:
        outcome = replay_methods_archive_v2(
            self.archive,
            self.request,
            self.envelopes,
            self.inputs,
            methods_library_path=self.library,
            outcome_id="outcome:core.live_witness",
            run_id="run:core.live_witness",
            diagnostics={"proof": "real-wheel-libn4m"},
        )

        self.assertEqual(outcome["outcome_id"], "outcome:core.live_witness")
        self.assertEqual(outcome["run_id"], "run:core.live_witness")
        self.assertEqual(outcome["phase"], "PREDICT")
        self.assertEqual(outcome["controller_count"], 1)
        self.assertEqual(outcome["prediction_block_count"], 1)
        block = outcome["outputs"][0]["predictions"][0]
        self.assertEqual(block["sample_ids"], ["predict.0", "predict.1"])
        self.assertEqual(len(block["values"]), 2)
        self.assertTrue(all(len(row) == len(self.target_names) for row in block["values"]))
        self.assertTrue(all(math.isfinite(value) for row in block["values"] for value in row))

    def test_tampered_n4mm_is_refused_before_replay(self) -> None:
        temporary_root = os.environ.get(_TMPDIR_ENV, "/dev/shm")
        with tempfile.TemporaryDirectory(dir=temporary_root) as directory:
            altered = Path(directory) / "tampered.n4a"
            _tamper_n4mm(self.archive, altered)
            with self.assertRaisesRegex(ValueError, "refused|mismatch|integrity"):
                replay_methods_archive_v2(
                    altered,
                    self.request,
                    self.envelopes,
                    self.inputs,
                    methods_library_path=self.library,
                    outcome_id="outcome:core.live_witness.tampered",
                    run_id="run:core.live_witness.tampered",
                )


@unittest.skipUnless(
    os.environ.get(_CONFORMAL_ARCHIVE_ENV) and os.environ.get(_LIBRARY_ENV),
    f"set {_CONFORMAL_ARCHIVE_ENV} and {_LIBRARY_ENV} to run the conformal child witness",
)
class LiveArchiveV2ConformalReplayTests(unittest.TestCase):
    def setUp(self) -> None:
        self.archive = Path(os.environ[_CONFORMAL_ARCHIVE_ENV])
        self.library = Path(os.environ[_LIBRARY_ENV])
        self.package = json.loads(read_portable_predictor_package_v2(self.archive))
        self.assertIsNotNone(self.package.get("conformal_calibration"))
        self.assertEqual(len(self.package["output_bindings"][0]["target_names"]), 1)
        self.request, self.envelopes, self.inputs = _contracts(self.package)

    def test_archive_replays_in_isolated_child_to_closed_presentation(self) -> None:
        """The producer is gone; a wheel-only child reopens and presents it."""

        temporary_root = os.environ.get(_TMPDIR_ENV, "/dev/shm")
        with tempfile.TemporaryDirectory(dir=temporary_root) as directory:
            contract_path = Path(directory) / "contracts.json"
            contract_path.write_text(
                _canonical_json(
                    {
                        "request": self.request,
                        "envelopes": self.envelopes,
                        "inputs": self.inputs,
                    }
                ),
                encoding="utf-8",
            )
            child = subprocess.run(
                [
                    sys.executable,
                    "-I",
                    "-c",
                    (
                        "import json,sys; "
                        "from nirs4all_core import replay_methods_archive_v2_conformal_presentation_v1 as replay; "
                        "c=json.load(open(sys.argv[3], encoding='utf-8')); "
                        "p=replay(sys.argv[1],c['request'],c['envelopes'],c['inputs'],"
                        "methods_library_path=sys.argv[2],outcome_id='outcome:core.conformal.child',"
                        "run_id='run:core.conformal.child',diagnostics={'proof':'isolated-wheel-child'}); "
                        "print(json.dumps(p,sort_keys=True,separators=(',',':'),allow_nan=False))"
                    ),
                    str(self.archive),
                    str(self.library),
                    str(contract_path),
                ],
                check=False,
                cwd=directory,
                env={"PATH": os.environ.get("PATH", ""), "PYTHONNOUSERSITE": "1"},
                capture_output=True,
                text=True,
            )

        self.assertEqual(child.returncode, 0, child.stderr)
        presentation = json.loads(child.stdout)
        calibration = self.package["conformal_calibration"]
        self.assertEqual(presentation["schema_version"], 1)
        self.assertEqual(
            presentation["package_fingerprint"], self.package["package_fingerprint"]
        )
        self.assertEqual(
            presentation["calibration_fingerprint"],
            calibration["calibration_fingerprint"],
        )
        self.assertEqual(presentation["sample_ids"], ["predict.0", "predict.1"])
        self.assertEqual(len(presentation["point_predictions"]), 2)
        self.assertEqual(
            [interval["coverage"] for interval in presentation["intervals"]],
            sorted(calibration["coverages"]),
        )
        self.assertRegex(presentation["presentation_fingerprint"], r"^[0-9a-f]{64}$")
        for interval in presentation["intervals"]:
            self.assertEqual(len(interval["lower"]), 2)
            self.assertEqual(len(interval["upper"]), 2)
            for point, lower, upper in zip(
                presentation["point_predictions"],
                interval["lower"],
                interval["upper"],
                strict=True,
            ):
                if lower is not None:
                    self.assertLessEqual(lower, point)
                    self.assertLessEqual(point, upper)

    def test_archive_tamper_precedes_library_configuration(self) -> None:
        temporary_root = os.environ.get(_TMPDIR_ENV, "/dev/shm")
        with tempfile.TemporaryDirectory(dir=temporary_root) as directory:
            altered = Path(directory) / "tampered-conformal.n4a"
            _tamper_n4mm(self.archive, altered)
            with self.assertRaises(ValueError) as captured:
                replay_methods_archive_v2_conformal_presentation_v1(
                    altered,
                    self.request,
                    self.envelopes,
                    self.inputs,
                    methods_library_path="/must-not-open-libn4m",
                    outcome_id="outcome:core.conformal.tampered",
                    run_id="run:core.conformal.tampered",
                )
        message = str(captured.exception)
        self.assertRegex(message, "refused|mismatch|integrity")
        self.assertNotIn("cannot configure the Methods runtime", message)


if __name__ == "__main__":
    unittest.main()
