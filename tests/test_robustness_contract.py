import pytest

from api.robustness_contract import (
    build_robustness_execution_diagnostic,
    normalize_robustness_launch_payload,
)


def test_normalize_robustness_launch_payload_accepts_native_scenarios():
    assert normalize_robustness_launch_payload(
        {
            "mode": "clean_frozen",
            "scenarios": [
                {"kind": "observed"},
                {"kind": "prediction_noise", "severity": 0.25, "distribution": "normal"},
                {"kind": "spectral_noise", "severity": 0.1, "distribution": "uniform"},
            ],
            "slice_by": ["batch"],
            "publish_evidence": {
                "spectral_replay": {
                    "X": "dataset_partition",
                    "predictor_bundle": "exported_model_bundle",
                    "destination": "result_metadata.robustness_evidence",
                    "fail_closed": True,
                },
            },
        }
    ) == {
        "mode": "clean_frozen",
        "scenarios": [
            {"kind": "observed", "severity": 0.0},
            {"kind": "prediction_noise", "severity": 0.25, "distribution": "normal"},
            {"kind": "spectral_noise", "severity": 0.1, "distribution": "uniform"},
        ],
        "slice_by": ["batch"],
        "publish_evidence": {
            "spectral_replay": {
                "X": "dataset_partition",
                "predictor_bundle": "exported_model_bundle",
                "destination": "result_metadata.robustness_evidence",
                "fail_closed": True,
            },
        },
    }


def test_normalize_robustness_launch_payload_rejects_invalid_distribution():
    with pytest.raises(ValueError, match="distribution"):
        normalize_robustness_launch_payload(
            {
                "mode": "clean_frozen",
                "scenarios": [
                    {"kind": "spectral_shift", "severity": 0.1, "distribution": "normal"},
                ],
            }
        )


def test_normalize_robustness_launch_payload_rejects_empty_scenarios():
    with pytest.raises(ValueError, match="must contain at least one"):
        normalize_robustness_launch_payload({"mode": "clean_frozen", "scenarios": []})


def test_build_robustness_execution_diagnostic_requires_prediction_evidence():
    diagnostic = build_robustness_execution_diagnostic({
        "mode": "clean_frozen",
        "scenarios": [
            {"kind": "prediction_noise", "severity": 0.2},
        ],
    })

    assert diagnostic == {
        "status": "needs_prediction_evidence",
        "message": "Robustness plan is transported, but no nirs4all RobustnessReport has been computed yet.",
        "scenario_kinds": ["prediction_noise"],
        "requires_y_true": True,
        "requires_predictions": True,
        "requires_X": False,
        "requires_predictor": False,
        "spectral_evidence_publication_requested": False,
        "blockers": [
            "Studio has not yet materialized a row-aligned PredictResult or CalibratedRunResult plus y_true for this pipeline.",
        ],
    }


def test_build_robustness_execution_diagnostic_requires_spectral_replay_evidence():
    diagnostic = build_robustness_execution_diagnostic({
        "mode": "clean_frozen",
        "scenarios": [
            {"kind": "spectral_shift", "severity": 1.0},
        ],
        "publish_evidence": {
            "spectral_replay": {
                "X": "dataset_partition",
                "predictor_bundle": "exported_model_bundle",
                "destination": "result_metadata.robustness_evidence",
                "fail_closed": True,
            },
        },
    })

    assert diagnostic is not None
    assert diagnostic["status"] == "needs_spectral_replay_evidence"
    assert diagnostic["requires_X"] is True
    assert diagnostic["requires_predictor"] is True
    assert diagnostic["spectral_evidence_publication_requested"] is True
    assert diagnostic["blockers"] == [
        "Studio has not yet materialized a row-aligned PredictResult or CalibratedRunResult plus y_true for this pipeline.",
        "At least one spectral scenario requires the original X matrix and a frozen predictor replay surface.",
    ]


def test_build_robustness_execution_diagnostic_reports_attached_artifact():
    diagnostic = build_robustness_execution_diagnostic({
        "mode": "clean_frozen",
        "scenarios": [
            {"kind": "spectral_noise", "severity": 0.1},
        ],
    }, has_report=True)

    assert diagnostic == {
        "status": "reported",
        "message": "A nirs4all RobustnessReport artifact is attached.",
        "scenario_kinds": ["spectral_noise"],
        "requires_y_true": True,
        "requires_predictions": True,
        "requires_X": True,
        "requires_predictor": True,
        "spectral_evidence_publication_requested": False,
        "blockers": [],
    }


def test_normalize_robustness_launch_payload_rejects_invalid_evidence_publication():
    with pytest.raises(ValueError):
        normalize_robustness_launch_payload(
            {
                "mode": "clean_frozen",
                "scenarios": [{"kind": "spectral_shift", "severity": 0.2}],
                "publish_evidence": {
                    "spectral_replay": {
                        "X": "synthetic_matrix",
                    },
                },
            }
        )
