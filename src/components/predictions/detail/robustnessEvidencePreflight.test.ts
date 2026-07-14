import { describe, expect, it } from "vitest";
import type { PredictionRobustnessEvidenceResponse } from "@/types/aggregated-predictions";
import { buildRobustnessEvidencePreflightView } from "./robustnessEvidencePreflight";

function evidence(overrides: Partial<PredictionRobustnessEvidenceResponse> = {}): PredictionRobustnessEvidenceResponse {
  return {
    prediction_id: "pred-1",
    run_id: "run",
    pipeline_id: "pipe",
    chain_id: "chain",
    stored_prediction_scenarios: ["observed", "prediction_noise"],
    spectral_scenarios: ["spectral_shift"],
    can_compute_stored_prediction_report: true,
    can_compute_spectral_report: false,
    status: "ready_for_prediction_space_only",
    requirements: [
      {
        id: "y_true",
        label: "Stored truth labels",
        present: true,
        source: "prediction_arrays.y_true",
        detail: "Required for observed robustness metrics.",
      },
      {
        id: "spectra",
        label: "Row-aligned spectra / X matrix",
        present: false,
        source: null,
        detail: "Required before Studio can replay spectral/OOD perturbations.",
      },
    ],
    blockers: ["Spectral/OOD scenarios require a row-aligned X/spectra matrix."],
    ...overrides,
  };
}

describe("buildRobustnessEvidencePreflightView", () => {
  it("projects fail-closed spectral/OOD evidence into a render-ready model", () => {
    expect(buildRobustnessEvidencePreflightView(evidence())).toEqual({
      blockers: ["Spectral/OOD scenarios require a row-aligned X/spectra matrix."],
      evidenceCountLabel: "Evidence present 1/2",
      replayPlanSteps: [
        {
          badgeVariant: "default",
          detail: "Stored y_true/y_pred evidence can be handed to nirs4all.robustness() for audit-only prediction-space scenarios.",
          id: "stored_prediction_audit",
          label: "Stored prediction audit",
          statusLabel: "available",
        },
        {
          badgeVariant: "destructive",
          detail: "Spectral/OOD replay requires row-aligned X/spectra plus a frozen predictor replay surface.",
          id: "spectral_replay_evidence",
          label: "Spectral/OOD replay evidence",
          statusLabel: "blocked",
        },
        {
          badgeVariant: "outline",
          detail: "Native spectral/OOD execution stays disabled until the selected prediction carries row-aligned X/spectra and saved predictor_bundle/model_path evidence. Accepted row-alignment proofs: sample_indices, full-dataset coverage, unique sample metadata identifiers, or explicit relation materialization identifiers.",
          id: "native_handoff",
          label: "Native robustness handoff",
          statusLabel: "disabled",
        },
      ],
      requirements: [
        {
          badgeVariant: "default",
          detail: "Required for observed robustness metrics.",
          id: "y_true",
          label: "Stored truth labels",
          source: "prediction_arrays.y_true",
          statusLabel: "present",
        },
        {
          badgeVariant: "destructive",
          detail: "Required before Studio can replay spectral/OOD perturbations.",
          id: "spectra",
          label: "Row-aligned spectra / X matrix",
          source: null,
          statusLabel: "missing",
        },
      ],
      spectralScenarioLabel: "spectral_shift",
      spectralStatusLabel: "Spectral/OOD blocked",
      spectralStatusVariant: "destructive",
      statusLabel: "ready for prediction space only",
      storedScenarioLabel: "observed, prediction_noise",
      storedStatusLabel: "Prediction-space ready",
      storedStatusVariant: "default",
      summaryStatusLabel: "blocked",
    });
  });

  it("projects ready spectral evidence and empty scenario lists explicitly", () => {
    expect(buildRobustnessEvidencePreflightView(evidence({
      blockers: [],
      can_compute_spectral_report: true,
      can_compute_stored_prediction_report: false,
      requirements: [],
      spectral_scenarios: [],
      status: "ready_for_spectral_replay",
      stored_prediction_scenarios: [],
    }))).toMatchObject({
      blockers: [],
      evidenceCountLabel: "Evidence present 0/0",
      replayPlanSteps: [
        {
          badgeVariant: "destructive",
          detail: "Stored prediction audit remains blocked until y_true/y_pred evidence is attached.",
          id: "stored_prediction_audit",
          label: "Stored prediction audit",
          statusLabel: "blocked",
        },
        {
          badgeVariant: "default",
          detail: "Row-aligned X/spectra and frozen predictor replay evidence are present for spectral/OOD scenarios.",
          id: "spectral_replay_evidence",
          label: "Spectral/OOD replay evidence",
          statusLabel: "ready",
        },
        {
          badgeVariant: "default",
          detail: "Studio may hand the verified replay inputs to the backend; it still does not compute robustness metrics in the UI. Accepted row-alignment proofs: sample_indices, full-dataset coverage, unique sample metadata identifiers, or explicit relation materialization identifiers.",
          id: "native_handoff",
          label: "Native robustness handoff",
          statusLabel: "ready",
        },
      ],
      spectralScenarioLabel: "none advertised",
      spectralStatusLabel: "Spectral/OOD ready",
      spectralStatusVariant: "default",
      statusLabel: "ready for spectral replay",
      storedScenarioLabel: "blocked",
      storedStatusLabel: "Prediction-space blocked",
      storedStatusVariant: "destructive",
      summaryStatusLabel: "ready",
    });
  });
});
