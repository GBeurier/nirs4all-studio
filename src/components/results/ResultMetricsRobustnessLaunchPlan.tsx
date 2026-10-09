import { Activity } from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import type {
  ResultRobustnessExecutionDiagnosticData,
  ResultRobustnessLaunchPlanData,
} from "./resultDetailData";

interface ResultMetricsRobustnessLaunchPlanProps {
  plan: ResultRobustnessLaunchPlanData | null;
}

function formatMode(mode: string): string {
  return mode.replace(/_/g, " ");
}

function formatSeverity(severity: number | null, t: TFunction): string {
  return severity == null ? t("results.robustness.launch.defaultSeverity") : String(severity);
}

function formatStatus(status: string): string {
  return status.replace(/_/g, " ");
}

function formatScenarioExecutionScope(scope: string): string {
  return scope.replace(/_/g, " ");
}

function requirementLabels(execution: ResultRobustnessExecutionDiagnosticData, t: TFunction): string[] {
  const labels: string[] = [];
  if (execution.requiresTruth) labels.push("y_true");
  if (execution.requiresPredictions) labels.push("PredictResult/CalibratedRunResult");
  if (execution.requiresSpectra) labels.push(t("results.robustness.launch.requirement.spectra"));
  if (execution.requiresPredictor) labels.push(t("results.robustness.launch.requirement.predictor"));
  return labels;
}

export function ResultMetricsRobustnessLaunchPlan({ plan }: ResultMetricsRobustnessLaunchPlanProps) {
  const { t } = useTranslation();
  if (!plan || plan.scenarioCount === 0) return null;

  const execution = plan.execution;
  const requirements = execution ? requirementLabels(execution, t) : [];

  return (
    <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h4 className="flex items-center gap-2 text-sm font-medium">
            <Activity className="h-4 w-4 text-sky-500" />
            {t("results.robustness.launch.title")}
          </h4>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {formatMode(plan.mode)} · {t("results.robustness.scenarioCount", { count: plan.scenarioCount })}
            {plan.sliceBy.length > 0 && ` · ${t("results.robustness.sliceBy", { slices: plan.sliceBy.join(", ") })}`}
          </p>
        </div>
        <Badge variant="outline" className="shrink-0 text-[10px]">
          {execution ? formatStatus(execution.status) : t("results.robustness.launch.metadataOnly")}
        </Badge>
      </div>

      {execution && (
        <div className="mb-3 rounded border border-sky-500/20 bg-background/60 px-2 py-1.5 text-[11px]">
          <p className="font-medium text-foreground">{execution.message}</p>
          {requirements.length > 0 && (
            <p className="mt-1 text-muted-foreground">
              {t("results.robustness.launch.requiredEvidence", { evidence: requirements.join(", ") })}
            </p>
          )}
          {execution.blockers.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
              {execution.blockers.map((blocker, index) => (
                <li key={`${index}-${blocker}`}>{blocker}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="grid gap-2 md:grid-cols-2">
        {plan.scenarios.map((scenario, index) => (
          <div
            className="rounded border border-border/50 bg-background/60 px-2 py-1.5 text-[11px]"
            key={`${scenario.kind}-${index}`}
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium text-foreground">{scenario.label}</span>
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
                {scenario.kind}
              </code>
              <Badge
                variant={scenario.requiresSpectralReplay ? "secondary" : "outline"}
                className="text-[10px]"
              >
                {formatScenarioExecutionScope(scenario.executionScope)}
              </Badge>
            </div>
            <p className="mt-1 text-muted-foreground">
              {t("results.robustness.card.severity", { value: formatSeverity(scenario.severity, t) })}
              {scenario.distribution && ` · ${t("results.robustness.card.distribution", { value: scenario.distribution })}`}
            </p>
            {scenario.requiresSpectralReplay && (
              <p className="mt-1 text-muted-foreground">
                {t("results.robustness.launch.requiresReplay")}
              </p>
            )}
          </div>
        ))}
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        {t("results.robustness.launch.disclaimer")}
      </p>
    </div>
  );
}
