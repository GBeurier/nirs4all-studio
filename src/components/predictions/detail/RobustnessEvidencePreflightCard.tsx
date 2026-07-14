import { Badge } from "@/components/ui/badge";
import type { PredictionRobustnessEvidenceResponse } from "@/types/aggregated-predictions";
import { buildRobustnessEvidencePreflightView } from "./robustnessEvidencePreflight";

interface RobustnessEvidencePreflightCardProps {
  evidence: PredictionRobustnessEvidenceResponse | null;
  loading: boolean;
}

export function RobustnessEvidencePreflightCard({
  evidence,
  loading,
}: RobustnessEvidencePreflightCardProps) {
  if (loading) {
    return (
      <div className="mt-2 rounded-md border border-border/70 bg-muted/20 px-2 py-1.5 text-[11px] text-muted-foreground">
        Checking spectral/OOD replay evidence...
      </div>
    );
  }

  if (!evidence) return null;

  const view = buildRobustnessEvidencePreflightView(evidence);

  return (
    <details className="mt-2 rounded-md border border-dashed border-border/70 bg-muted/20 px-2 py-1.5 text-[11px] text-muted-foreground">
      <summary className="cursor-pointer text-foreground">
        Spectral/OOD replay preflight: {view.summaryStatusLabel}
      </summary>
      <div className="mt-2 space-y-2">
        <div className="flex flex-wrap gap-1.5">
          <Badge variant={view.storedStatusVariant} className="text-[10px]">
            {view.storedStatusLabel}
          </Badge>
          <Badge variant={view.spectralStatusVariant} className="text-[10px]">
            {view.spectralStatusLabel}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {view.evidenceCountLabel}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {view.statusLabel}
          </Badge>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded border border-border/50 bg-background/60 px-2 py-1.5">
            <p className="font-medium text-foreground">Stored-prediction scenarios</p>
            <p className="mt-1 break-words">
              {view.storedScenarioLabel}
            </p>
          </div>
          <div className="rounded border border-border/50 bg-background/60 px-2 py-1.5">
            <p className="font-medium text-foreground">Spectral/OOD scenarios</p>
            <p className="mt-1 break-words">
              {view.spectralScenarioLabel}
            </p>
          </div>
        </div>

        <div className="rounded border border-border/50 bg-background/60 px-2 py-1.5">
          <p className="font-medium text-foreground">Native replay handoff plan</p>
          <div className="mt-1.5 grid gap-1.5">
            {view.replayPlanSteps.map((step) => (
              <div
                key={step.id}
                className="rounded border border-border/40 bg-muted/20 px-2 py-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground">{step.label}</span>
                  <Badge variant={step.badgeVariant} className="text-[10px]">
                    {step.statusLabel}
                  </Badge>
                </div>
                <p className="mt-1 break-words">{step.detail}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-1.5 sm:grid-cols-2">
          {view.requirements.map((requirement) => (
            <div
              key={requirement.id}
              className="rounded border border-border/50 bg-background/60 px-2 py-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground">{requirement.label}</span>
                <Badge variant={requirement.badgeVariant} className="text-[10px]">
                  {requirement.statusLabel}
                </Badge>
              </div>
              {requirement.source && (
                <p className="mt-1 break-words text-foreground">{requirement.source}</p>
              )}
              {requirement.detail && (
                <p className="mt-1 break-words">{requirement.detail}</p>
              )}
            </div>
          ))}
        </div>

        {view.blockers.length > 0 && (
          <ul className="list-disc space-y-1 rounded border border-destructive/30 bg-destructive/5 px-3 py-2 pl-5 text-destructive">
            {view.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
