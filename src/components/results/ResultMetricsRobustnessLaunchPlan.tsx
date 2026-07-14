import { Activity } from "lucide-react";

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

function formatSeverity(severity: number | null): string {
  return severity == null ? "default" : String(severity);
}

function formatStatus(status: string): string {
  return status.replace(/_/g, " ");
}

function formatScenarioExecutionScope(scope: string): string {
  return scope.replace(/_/g, " ");
}

function requirementLabels(execution: ResultRobustnessExecutionDiagnosticData): string[] {
  const labels: string[] = [];
  if (execution.requiresTruth) labels.push("y_true");
  if (execution.requiresPredictions) labels.push("PredictResult/CalibratedRunResult");
  if (execution.requiresSpectra) labels.push("X spectra");
  if (execution.requiresPredictor) labels.push("frozen predictor");
  return labels;
}

export function ResultMetricsRobustnessLaunchPlan({ plan }: ResultMetricsRobustnessLaunchPlanProps) {
  if (!plan || plan.scenarioCount === 0) return null;

  const execution = plan.execution;
  const requirements = execution ? requirementLabels(execution) : [];

  return (
    <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h4 className="flex items-center gap-2 text-sm font-medium">
            <Activity className="h-4 w-4 text-sky-500" />
            Robustness launch plan
          </h4>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {formatMode(plan.mode)} · {plan.scenarioCount} scenario{plan.scenarioCount === 1 ? "" : "s"}
            {plan.sliceBy.length > 0 && ` · slices: ${plan.sliceBy.join(", ")}`}
          </p>
        </div>
        <Badge variant="outline" className="shrink-0 text-[10px]">
          {execution ? formatStatus(execution.status) : "metadata only"}
        </Badge>
      </div>

      {execution && (
        <div className="mb-3 rounded border border-sky-500/20 bg-background/60 px-2 py-1.5 text-[11px]">
          <p className="font-medium text-foreground">{execution.message}</p>
          {requirements.length > 0 && (
            <p className="mt-1 text-muted-foreground">
              Required evidence: {requirements.join(", ")}
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
              severity {formatSeverity(scenario.severity)}
              {scenario.distribution && ` · distribution ${scenario.distribution}`}
            </p>
            {scenario.requiresSpectralReplay && (
              <p className="mt-1 text-muted-foreground">
                Requires row-aligned X spectra and frozen predictor replay before nirs4all can compute this scenario.
              </p>
            )}
          </div>
        ))}
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        This is the launch-time robustness plan transported by Studio. It is not a computed robustness report; metrics
        appear separately when nirs4all produces a `RobustnessReport` artifact.
      </p>
    </div>
  );
}
