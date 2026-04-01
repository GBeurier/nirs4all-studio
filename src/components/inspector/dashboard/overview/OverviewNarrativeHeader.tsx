import type { ReactNode } from "react";
import { ArrowUpRight, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface OverviewNarrativeHeaderProps {
  metricLabel: string;
  scopeLabel: string;
  bestChainLabel?: string;
  bestChainScore?: ReactNode;
  bestChainDetail?: ReactNode;
  direction?: "higher" | "lower" | "neutral";
  narrative?: string;
  callouts?: string[];
  actions?: ReactNode;
  className?: string;
}

const directionCopy: Record<NonNullable<OverviewNarrativeHeaderProps["direction"]>, string> = {
  higher: "Higher is better",
  lower: "Lower is better",
  neutral: "Directional guidance not set",
};

const directionTone: Record<NonNullable<OverviewNarrativeHeaderProps["direction"]>, string> = {
  higher: "border-emerald-500/20 text-emerald-700 dark:text-emerald-300",
  lower: "border-amber-500/20 text-amber-700 dark:text-amber-300",
  neutral: "border-border/60 text-muted-foreground",
};

export function OverviewNarrativeHeader({
  metricLabel,
  scopeLabel,
  bestChainLabel,
  bestChainScore,
  bestChainDetail,
  direction = "neutral",
  narrative,
  callouts = [],
  actions,
  className,
}: OverviewNarrativeHeaderProps) {
  return (
    <Card className={cn(
      "overflow-hidden border-border/60 shadow-sm",
      "bg-[linear-gradient(135deg,rgba(2,132,199,0.12),rgba(15,23,42,0.02)_40%,rgba(22,163,74,0.08))]",
      className,
    )}>
      <CardContent className="space-y-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-4xl space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="gap-1.5 border-border/60 bg-background/70 text-[10px] uppercase tracking-[0.18em]">
                <Sparkles className="h-3 w-3" />
                Guided overview
              </Badge>
              <Badge variant="outline" className={cn("text-[10px] uppercase tracking-[0.16em]", directionTone[direction])}>
                {directionCopy[direction]}
              </Badge>
            </div>

            <div className="space-y-1">
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Metric focus
              </div>
              <div className="text-2xl font-semibold tracking-tight text-foreground">
                {metricLabel}
              </div>
              <div className="text-sm leading-6 text-muted-foreground">
                {narrative ?? `This view is scoped to ${scopeLabel}. Compare the filtered prediction space before diving into individual charts.`}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Current scope
                </div>
                <div className="mt-1 text-sm font-medium text-foreground">
                  {scopeLabel}
                </div>
              </div>
              <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Best chain
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                  <span>{bestChainLabel ?? "No ranked chain"}</span>
                  {bestChainScore != null ? (
                    <Badge variant="outline" className="border-border/60 text-[10px] uppercase tracking-wide">
                      {bestChainScore}
                    </Badge>
                  ) : null}
                </div>
                {bestChainDetail ? (
                  <div className="mt-1 text-xs leading-5 text-muted-foreground">
                    {bestChainDetail}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>

        {callouts.length > 0 ? (
          <div className="grid gap-2 lg:grid-cols-3">
            {callouts.slice(0, 3).map((callout) => (
              <div key={callout} className="rounded-xl border border-border/60 bg-background/70 p-3 text-xs leading-5 text-muted-foreground">
                <ArrowUpRight className="mb-2 h-3.5 w-3.5 text-primary/70" />
                {callout}
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
