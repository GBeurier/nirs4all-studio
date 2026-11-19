"""Execute renderer-generated palette requests through the real SDK facade.

Generate requests with probe-playground-palette.ts first. No operators are
mocked; every failure is recorded and makes this qualification command fail.
"""
from __future__ import annotations

import argparse
import contextlib
import io
import json
from pathlib import Path

import numpy as np
from nirs4all.api.library_playground import studio_playground_job_v1


def main() -> int:
    """Check constructors, complete previews, augmentation lineage and scaling."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("requests", type=Path)
    parser.add_argument("report", type=Path)
    args = parser.parse_args()
    cases = json.loads(args.requests.read_text())
    rng = np.random.default_rng(42)
    x = rng.normal(0, 0.03, (40, 128)) + np.sin(np.linspace(0, 4, 128))[None, :] ** 2 + 1
    ids = [f"S{index}" for index in range(len(x))]
    data = {"x": x.tolist(), "y": np.linspace(0, 1, len(x)).tolist(),
            "wavelengths": np.linspace(1100, 2400, 128).tolist(), "sample_ids": ids}
    failed, passed = [], []
    for case in cases:
        try:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                response = studio_playground_job_v1({
                    "schema": "nirs4all.studio-playground-job.v1", "operation": "execute", "request_id": "probe",
                    "payload": {"data": data, "steps": [case["step"]],
                                "options": {"compute_repetitions": False, "compute_statistics": False}},
                })["result"]
            if not response["success"]:
                raise ValueError(response["step_errors"])
            if "error" in response["pca"]:
                raise ValueError(response["pca"])
            assert np.isfinite(response["pca"]["coordinates"]).all(), "Nonfinite PCA scores"
            values = np.asarray(response["processed"]["spectra"])
            if case["step"]["type"] == "augmentation":
                assert values.shape == (2 * len(x), x.shape[1]), "Wrong augmented shape"
                np.testing.assert_array_equal(values[:len(x)], x)
                assert response["processed"]["sample_ids"] == ids * 2, "Lost augmentation identity"
            if case["id"] == "preprocessing.standard_scaler":
                np.testing.assert_allclose(values.mean(axis=0), 0, atol=1e-12)
                np.testing.assert_allclose(values.std(axis=0), 1, atol=1e-12)
            if case["id"] == "preprocessing.minmax_scaler":
                np.testing.assert_allclose(values.min(axis=0), 0, atol=1e-12)
                np.testing.assert_allclose(values.max(axis=0), 1, atol=1e-12)
            if case["id"] == "preprocessing.robust_scaler":
                np.testing.assert_allclose(np.median(values, axis=0), 0, atol=1e-12)
                np.testing.assert_allclose(np.diff(np.percentile(values, [25, 75], axis=0), axis=0), 1, atol=1e-12)
            passed.append(case["id"])
        except Exception as error:
            failed.append({"id": case["id"], "error": str(error)})
            print(f"{case['id']}: {str(error)[:250]}", flush=True)
    args.report.write_text(json.dumps({"passed": passed, "failed": failed}, indent=2) + "\n")
    print(f"{len(passed)} passed, {len(failed)} failed of {len(cases)}", flush=True)
    return int(bool(failed))


if __name__ == "__main__":
    raise SystemExit(main())
