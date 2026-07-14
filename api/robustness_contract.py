"""Shared Studio contract for native nirs4all robustness launch options.

This module validates and normalizes the transport payload only. Studio does not
compute robustness reports here; scientific execution remains owned by nirs4all.
"""

from __future__ import annotations

import math
from typing import Any, Literal

from pydantic import BaseModel, Field

ROBUSTNESS_SCENARIO_KINDS = {
    "observed",
    "prediction_bias",
    "prediction_noise",
    "spectral_noise",
    "spectral_offset",
    "spectral_scale",
    "spectral_slope",
    "spectral_shift",
}
ROBUSTNESS_STOCHASTIC_SCENARIO_KINDS = {"prediction_noise", "spectral_noise"}
ROBUSTNESS_SPECTRAL_SCENARIO_KINDS = {
    "spectral_noise",
    "spectral_offset",
    "spectral_scale",
    "spectral_slope",
    "spectral_shift",
}


class RobustnessScenarioPayload(BaseModel):
    """One native robustness scenario requested by Studio."""

    kind: str
    severity: float = 0.0
    distribution: Literal["normal", "uniform"] | None = None


class RobustnessSpectralReplayEvidencePayload(BaseModel):
    """Request publication of replay evidence needed by spectral/OOD reports."""

    X: Literal["dataset_partition"] = "dataset_partition"
    predictor_bundle: Literal["exported_model_bundle"] = "exported_model_bundle"
    destination: Literal["result_metadata.robustness_evidence"] = "result_metadata.robustness_evidence"
    fail_closed: bool = True


class RobustnessEvidencePublicationPayload(BaseModel):
    """Launch-time evidence publication intent.

    This is not a promise that Studio computed robustness locally. It tells the
    execution driver which native evidence to persist when it can do so.
    """

    spectral_replay: RobustnessSpectralReplayEvidencePayload | None = None


class RobustnessLaunchPayload(BaseModel):
    """Passive launch-time robustness plan.

    The current nirs4all public API supports only ``mode='clean_frozen'``.
    ``scenarios`` must be non-empty when a robustness block is supplied.
    """

    mode: Literal["clean_frozen"] = "clean_frozen"
    scenarios: list[RobustnessScenarioPayload] = Field(default_factory=list)
    slice_by: list[str] = Field(default_factory=list)
    publish_evidence: RobustnessEvidencePublicationPayload | None = None


def _model_dump(value: Any) -> dict[str, Any]:
    if hasattr(value, "model_dump"):
        return dict(value.model_dump(exclude_none=True))
    if isinstance(value, dict):
        return dict(value)
    raise TypeError("robustness must be an object")


def normalize_robustness_launch_payload(value: Any | None) -> dict[str, Any] | None:
    """Return a JSON-safe robustness payload or ``None`` when absent.

    Raises ``ValueError``/``TypeError`` for unsupported forms. Route handlers
    convert those into HTTP 400 responses.
    """

    if value is None:
        return None

    payload = RobustnessLaunchPayload(**_model_dump(value))
    if not payload.scenarios:
        raise ValueError("robustness.scenarios must contain at least one scenario")

    normalized_scenarios = [
        normalize_robustness_scenario_payload(scenario)
        for scenario in payload.scenarios
    ]
    slice_by = []
    seen_slice_fields: set[str] = set()
    for field in payload.slice_by:
        normalized_field = str(field).strip()
        if not normalized_field:
            raise ValueError("robustness.slice_by entries must be non-empty strings")
        if normalized_field in seen_slice_fields:
            raise ValueError(f"robustness.slice_by contains duplicate field {normalized_field!r}")
        seen_slice_fields.add(normalized_field)
        slice_by.append(normalized_field)

    normalized: dict[str, Any] = {
        "mode": payload.mode,
        "scenarios": normalized_scenarios,
    }
    if slice_by:
        normalized["slice_by"] = slice_by
    publish_evidence = normalize_robustness_evidence_publication_payload(payload.publish_evidence)
    if publish_evidence is not None:
        normalized["publish_evidence"] = publish_evidence
    return normalized


def normalize_robustness_evidence_publication_payload(value: Any | None) -> dict[str, Any] | None:
    """Normalize optional evidence publication requests."""

    if value is None:
        return None

    publication = RobustnessEvidencePublicationPayload(**_model_dump(value))
    normalized: dict[str, Any] = {}
    if publication.spectral_replay is not None:
        normalized["spectral_replay"] = _model_dump(publication.spectral_replay)

    return normalized or None


def normalize_robustness_scenario_payload(value: Any) -> dict[str, Any]:
    """Normalize one scenario to the mapping accepted by nirs4all.robustness()."""

    scenario = RobustnessScenarioPayload(**_model_dump(value))
    kind = scenario.kind.strip()
    if kind not in ROBUSTNESS_SCENARIO_KINDS:
        raise ValueError(f"robustness.scenarios[].kind is unsupported: {scenario.kind!r}")

    severity = float(scenario.severity)
    if not math.isfinite(severity):
        raise ValueError("robustness.scenarios[].severity must be finite")
    if kind == "observed" and severity != 0.0:
        raise ValueError("observed robustness scenarios require severity=0.0")
    if kind in {"prediction_noise", "spectral_noise"} and severity < 0.0:
        raise ValueError(f"{kind} robustness scenarios require non-negative severity")
    if kind == "spectral_scale" and 1.0 + severity <= 0.0:
        raise ValueError("spectral_scale robustness scenarios require 1.0 + severity to be positive")

    normalized: dict[str, Any] = {
        "kind": kind,
        "severity": severity,
    }
    if scenario.distribution is not None:
        if kind not in ROBUSTNESS_STOCHASTIC_SCENARIO_KINDS:
            raise ValueError(
                "robustness.scenarios[].distribution is supported only for prediction_noise and spectral_noise",
            )
        normalized["distribution"] = scenario.distribution
    return normalized


def build_robustness_execution_diagnostic(
    robustness: dict[str, Any] | None,
    *,
    has_report: bool = False,
) -> dict[str, Any] | None:
    """Describe whether Studio has enough evidence to execute robustness.

    This is intentionally a diagnostic contract. Studio should not synthesize
    prediction truth, sample identities, spectra, or predictors from UI state.
    """

    if not robustness:
        return None

    scenarios = robustness.get("scenarios")
    if not isinstance(scenarios, list):
        scenarios = []

    scenario_kinds = [
        str(scenario.get("kind"))
        for scenario in scenarios
        if isinstance(scenario, dict) and scenario.get("kind") is not None
    ]
    requires_spectral_replay = any(kind in ROBUSTNESS_SPECTRAL_SCENARIO_KINDS for kind in scenario_kinds)
    publish_evidence = robustness.get("publish_evidence")
    spectral_publication_requested = (
        isinstance(publish_evidence, dict)
        and isinstance(publish_evidence.get("spectral_replay"), dict)
    )

    if has_report:
        return {
            "status": "reported",
            "message": "A nirs4all RobustnessReport artifact is attached.",
            "scenario_kinds": scenario_kinds,
            "requires_y_true": True,
            "requires_predictions": True,
            "requires_X": requires_spectral_replay,
            "requires_predictor": requires_spectral_replay,
            "spectral_evidence_publication_requested": spectral_publication_requested,
            "blockers": [],
        }

    blockers = [
        "Studio has not yet materialized a row-aligned PredictResult or CalibratedRunResult plus y_true for this pipeline.",
    ]
    if requires_spectral_replay:
        blockers.append(
            "At least one spectral scenario requires the original X matrix and a frozen predictor replay surface.",
        )

    status = "needs_spectral_replay_evidence" if requires_spectral_replay else "needs_prediction_evidence"
    return {
        "status": status,
        "message": "Robustness plan is transported, but no nirs4all RobustnessReport has been computed yet.",
        "scenario_kinds": scenario_kinds,
        "requires_y_true": True,
        "requires_predictions": True,
        "requires_X": requires_spectral_replay,
        "requires_predictor": requires_spectral_replay,
        "spectral_evidence_publication_requested": spectral_publication_requested,
        "blockers": blockers,
    }


__all__ = [
    "ROBUSTNESS_SCENARIO_KINDS",
    "ROBUSTNESS_SPECTRAL_SCENARIO_KINDS",
    "ROBUSTNESS_STOCHASTIC_SCENARIO_KINDS",
    "RobustnessEvidencePublicationPayload",
    "RobustnessLaunchPayload",
    "RobustnessScenarioPayload",
    "RobustnessSpectralReplayEvidencePayload",
    "build_robustness_execution_diagnostic",
    "normalize_robustness_evidence_publication_payload",
    "normalize_robustness_launch_payload",
    "normalize_robustness_scenario_payload",
]
