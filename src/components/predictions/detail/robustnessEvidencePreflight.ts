import type {
  PredictionRobustnessEvidenceRequirement,
  PredictionRobustnessEvidenceResponse,
} from "@/types/aggregated-predictions";

export type RobustnessEvidenceBadgeVariant = "default" | "destructive" | "outline";

export interface RobustnessEvidenceRequirementView {
  badgeVariant: RobustnessEvidenceBadgeVariant;
  detail: string | null;
  id: string;
  label: string;
  source: string | null;
  statusLabel: "present" | "missing";
}

export interface RobustnessEvidenceReplayStepView {
  badgeVariant: RobustnessEvidenceBadgeVariant;
  detail: string;
  id: "stored_prediction_audit" | "spectral_replay_evidence" | "native_handoff";
  label: string;
  statusLabel: "available" | "blocked" | "disabled" | "ready";
}

export interface RobustnessEvidencePreflightView {
  blockers: string[];
  evidenceCountLabel: string;
  replayPlanSteps: RobustnessEvidenceReplayStepView[];
  requirements: RobustnessEvidenceRequirementView[];
  spectralScenarioLabel: string;
  spectralStatusLabel: "Spectral/OOD ready" | "Spectral/OOD blocked";
  spectralStatusVariant: RobustnessEvidenceBadgeVariant;
  statusLabel: string;
  storedScenarioLabel: string;
  storedStatusLabel: "Prediction-space ready" | "Prediction-space blocked";
  storedStatusVariant: RobustnessEvidenceBadgeVariant;
  summaryStatusLabel: "ready" | "blocked";
}

function formatEvidenceStatus(status: string): string {
  return status.replace(/_/g, " ");
}

function buildScenarioLabel(values: readonly string[], emptyLabel: string): string {
  return values.length > 0 ? values.join(", ") : emptyLabel;
}

function buildRequirementView(
  requirement: PredictionRobustnessEvidenceRequirement,
): RobustnessEvidenceRequirementView {
  return {
    badgeVariant: requirement.present ? "default" : "destructive",
    detail: requirement.detail ?? null,
    id: requirement.id,
    label: requirement.label,
    source: requirement.source ?? null,
    statusLabel: requirement.present ? "present" : "missing",
  };
}

function buildReplayPlanSteps(
  evidence: PredictionRobustnessEvidenceResponse,
): RobustnessEvidenceReplayStepView[] {
  const alignmentStrategies = "Accepted row-alignment proofs: sample_indices, full-dataset coverage, unique sample metadata identifiers, or explicit relation materialization identifiers.";
  return [
    {
      badgeVariant: evidence.can_compute_stored_prediction_report ? "default" : "destructive",
      detail: evidence.can_compute_stored_prediction_report
        ? "Stored y_true/y_pred evidence can be handed to nirs4all.robustness() for audit-only prediction-space scenarios."
        : "Stored prediction audit remains blocked until y_true/y_pred evidence is attached.",
      id: "stored_prediction_audit",
      label: "Stored prediction audit",
      statusLabel: evidence.can_compute_stored_prediction_report ? "available" : "blocked",
    },
    {
      badgeVariant: evidence.can_compute_spectral_report ? "default" : "destructive",
      detail: evidence.can_compute_spectral_report
        ? "Row-aligned X/spectra and frozen predictor replay evidence are present for spectral/OOD scenarios."
        : "Spectral/OOD replay requires row-aligned X/spectra plus a frozen predictor replay surface.",
      id: "spectral_replay_evidence",
      label: "Spectral/OOD replay evidence",
      statusLabel: evidence.can_compute_spectral_report ? "ready" : "blocked",
    },
    {
      badgeVariant: evidence.can_compute_spectral_report ? "default" : "outline",
      detail: evidence.can_compute_spectral_report
        ? `Studio may hand the verified replay inputs to the backend; it still does not compute robustness metrics in the UI. ${alignmentStrategies}`
        : `Native spectral/OOD execution stays disabled until the selected prediction carries row-aligned X/spectra and saved predictor_bundle/model_path evidence. ${alignmentStrategies}`,
      id: "native_handoff",
      label: "Native robustness handoff",
      statusLabel: evidence.can_compute_spectral_report ? "ready" : "disabled",
    },
  ];
}

export function buildRobustnessEvidencePreflightView(
  evidence: PredictionRobustnessEvidenceResponse,
): RobustnessEvidencePreflightView {
  const presentCount = evidence.requirements.filter((requirement) => requirement.present).length;
  const totalCount = evidence.requirements.length;

  return {
    blockers: evidence.blockers,
    evidenceCountLabel: `Evidence present ${presentCount}/${totalCount}`,
    replayPlanSteps: buildReplayPlanSteps(evidence),
    requirements: evidence.requirements.map(buildRequirementView),
    spectralScenarioLabel: buildScenarioLabel(evidence.spectral_scenarios, "none advertised"),
    spectralStatusLabel: evidence.can_compute_spectral_report ? "Spectral/OOD ready" : "Spectral/OOD blocked",
    spectralStatusVariant: evidence.can_compute_spectral_report ? "default" : "destructive",
    statusLabel: formatEvidenceStatus(evidence.status),
    storedScenarioLabel: buildScenarioLabel(evidence.stored_prediction_scenarios, "blocked"),
    storedStatusLabel: evidence.can_compute_stored_prediction_report
      ? "Prediction-space ready"
      : "Prediction-space blocked",
    storedStatusVariant: evidence.can_compute_stored_prediction_report ? "default" : "destructive",
    summaryStatusLabel: evidence.can_compute_spectral_report ? "ready" : "blocked",
  };
}
