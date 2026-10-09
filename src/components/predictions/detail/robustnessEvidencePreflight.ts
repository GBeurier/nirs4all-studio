import type { TFunction } from "i18next";
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
  statusLabel: string;
}

export interface RobustnessEvidenceReplayStepView {
  badgeVariant: RobustnessEvidenceBadgeVariant;
  detail: string;
  id: "stored_prediction_audit" | "spectral_replay_evidence" | "native_handoff";
  label: string;
  statusLabel: string;
}

export interface RobustnessEvidencePreflightView {
  blockers: string[];
  evidenceCountLabel: string;
  replayPlanSteps: RobustnessEvidenceReplayStepView[];
  requirements: RobustnessEvidenceRequirementView[];
  spectralScenarioLabel: string;
  spectralStatusLabel: string;
  spectralStatusVariant: RobustnessEvidenceBadgeVariant;
  statusLabel: string;
  storedScenarioLabel: string;
  storedStatusLabel: string;
  storedStatusVariant: RobustnessEvidenceBadgeVariant;
  summaryStatusLabel: string;
}

function formatEvidenceStatus(status: string): string {
  return status.replace(/_/g, " ");
}

function buildScenarioLabel(values: readonly string[], emptyLabel: string): string {
  return values.length > 0 ? values.join(", ") : emptyLabel;
}

function buildRequirementView(
  requirement: PredictionRobustnessEvidenceRequirement,
  t: TFunction,
): RobustnessEvidenceRequirementView {
  return {
    badgeVariant: requirement.present ? "default" : "destructive",
    detail: requirement.detail ?? null,
    id: requirement.id,
    label: requirement.label,
    source: requirement.source ?? null,
    statusLabel: t(requirement.present ? "predictions.detail.preflight.status.present" : "predictions.detail.preflight.status.missing"),
  };
}

function buildReplayPlanSteps(
  evidence: PredictionRobustnessEvidenceResponse,
  t: TFunction,
): RobustnessEvidenceReplayStepView[] {
  const alignment = t("predictions.detail.preflight.alignmentProofs");
  return [
    {
      badgeVariant: evidence.can_compute_stored_prediction_report ? "default" : "destructive",
      detail: t(evidence.can_compute_stored_prediction_report
        ? "predictions.detail.preflight.steps.stored.available"
        : "predictions.detail.preflight.steps.stored.blocked"),
      id: "stored_prediction_audit",
      label: t("predictions.detail.preflight.steps.stored.label"),
      statusLabel: t(evidence.can_compute_stored_prediction_report
        ? "predictions.detail.preflight.status.available"
        : "predictions.detail.preflight.status.blocked"),
    },
    {
      badgeVariant: evidence.can_compute_spectral_report ? "default" : "destructive",
      detail: t(evidence.can_compute_spectral_report
        ? "predictions.detail.preflight.steps.spectral.ready"
        : "predictions.detail.preflight.steps.spectral.blocked"),
      id: "spectral_replay_evidence",
      label: t("predictions.detail.preflight.steps.spectral.label"),
      statusLabel: t(evidence.can_compute_spectral_report
        ? "predictions.detail.preflight.status.ready"
        : "predictions.detail.preflight.status.blocked"),
    },
    {
      badgeVariant: evidence.can_compute_spectral_report ? "default" : "outline",
      detail: t(evidence.can_compute_spectral_report
        ? "predictions.detail.preflight.steps.handoff.ready"
        : "predictions.detail.preflight.steps.handoff.disabled", { alignment }),
      id: "native_handoff",
      label: t("predictions.detail.preflight.steps.handoff.label"),
      statusLabel: t(evidence.can_compute_spectral_report
        ? "predictions.detail.preflight.status.ready"
        : "predictions.detail.preflight.status.disabled"),
    },
  ];
}

export function buildRobustnessEvidencePreflightView(
  evidence: PredictionRobustnessEvidenceResponse,
  t: TFunction,
): RobustnessEvidencePreflightView {
  const presentCount = evidence.requirements.filter((requirement) => requirement.present).length;
  const totalCount = evidence.requirements.length;

  return {
    blockers: evidence.blockers,
    evidenceCountLabel: t("predictions.detail.preflight.evidenceCount", { present: presentCount, total: totalCount }),
    replayPlanSteps: buildReplayPlanSteps(evidence, t),
    requirements: evidence.requirements.map((requirement) => buildRequirementView(requirement, t)),
    spectralScenarioLabel: buildScenarioLabel(evidence.spectral_scenarios, t("predictions.detail.preflight.noneAdvertised")),
    spectralStatusLabel: t(evidence.can_compute_spectral_report ? "predictions.detail.preflight.spectralReady" : "predictions.detail.preflight.spectralBlocked"),
    spectralStatusVariant: evidence.can_compute_spectral_report ? "default" : "destructive",
    statusLabel: formatEvidenceStatus(evidence.status),
    storedScenarioLabel: buildScenarioLabel(evidence.stored_prediction_scenarios, t("predictions.detail.preflight.status.blocked")),
    storedStatusLabel: t(evidence.can_compute_stored_prediction_report
      ? "predictions.detail.preflight.storedReady"
      : "predictions.detail.preflight.storedBlocked"),
    storedStatusVariant: evidence.can_compute_stored_prediction_report ? "default" : "destructive",
    summaryStatusLabel: t(evidence.can_compute_spectral_report ? "predictions.detail.preflight.status.ready" : "predictions.detail.preflight.status.blocked"),
  };
}
