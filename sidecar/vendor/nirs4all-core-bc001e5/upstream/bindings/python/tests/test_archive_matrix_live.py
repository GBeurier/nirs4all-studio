"""Opt-in closed Archive V2 matrix prediction witness.

This witness deliberately does not import or require the Python ``dag_ml``
package. The native aggregate owns contract composition, library attestation,
and replay for this X-only surface.
"""

from __future__ import annotations

import hashlib
import os
import sys
import unittest
from pathlib import Path

from nirs4all_core import predict_methods_archive_v2_matrix

_ARCHIVE_ENV = "NIRS4ALL_CORE_LIVE_ARCHIVE_V2"
_LIBRARY_ENV = "NIRS4ALL_CORE_LIVE_METHODS_LIBRARY"


@unittest.skipUnless(
    os.environ.get(_ARCHIVE_ENV) and os.environ.get(_LIBRARY_ENV),
    f"set {_ARCHIVE_ENV} and {_LIBRARY_ENV} to run the closed matrix witness",
)
class LiveArchiveV2MatrixPredictionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.archive = Path(os.environ[_ARCHIVE_ENV])
        self.library = Path(os.environ[_LIBRARY_ENV])
        self.library_sha256 = hashlib.sha256(self.library.read_bytes()).hexdigest()
        self.assertNotIn("dag_ml", sys.modules)

    def test_attested_libn4m_replays_exact_multi_target_values(self) -> None:
        outcome = predict_methods_archive_v2_matrix(
            self.archive,
            ["predict.0", "predict.1"],
            [[1.5, 0.5], [3.5, 1.5]],
            ["protein", "moisture"],
            methods_library_path=self.library,
            methods_library_sha256=self.library_sha256,
            request_id="request:core.matrix.live_witness",
            outcome_id="outcome:core.matrix.live_witness",
            run_id="run:core.matrix.live_witness",
            diagnostics={"proof": "closed-matrix-real-wheel-libn4m"},
        )

        self.assertNotIn("dag_ml", sys.modules)
        self.assertEqual(outcome["outcome_id"], "outcome:core.matrix.live_witness")
        self.assertEqual(outcome["run_id"], "run:core.matrix.live_witness")
        self.assertEqual(outcome["phase"], "PREDICT")
        self.assertEqual(outcome["controller_count"], 1)
        self.assertEqual(outcome["prediction_block_count"], 1)
        block = outcome["outputs"][0]["predictions"][0]
        self.assertEqual(block["sample_ids"], ["predict.0", "predict.1"])
        self.assertEqual(block["target_names"], ["protein", "moisture"])
        self.assertEqual(
            block["values"],
            [[1.6363636363636365, 13.272727272727273], [2.4999999999999996, 15.0]],
        )

    def test_wrong_methods_sha256_is_refused(self) -> None:
        with self.assertRaisesRegex(
            ValueError, "libn4m SHA-256 identity mismatch"
        ):
            predict_methods_archive_v2_matrix(
                self.archive,
                ["predict.0", "predict.1"],
                [[1.5, 0.5], [3.5, 1.5]],
                ["protein", "moisture"],
                methods_library_path=self.library,
                methods_library_sha256="0" * 64,
                request_id="request:core.matrix.bad-sha",
                outcome_id="outcome:core.matrix.bad-sha",
                run_id="run:core.matrix.bad-sha",
            )


if __name__ == "__main__":
    unittest.main()
