import { AlertTriangle, Blocks, Filter, Focus, Trophy, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatMetricValue } from "@/lib/scores";
import type { InspectorOverviewStats } from "@/lib/inspector/analytics";
import type { ScoreColumn } from "@/types/inspector";

interface InspectorOverviewCardsProps {
  stats: InspectorOverviewStats;
  scoreColumn: ScoreColumn;
  activeFilterCount: number;
  focusedCount: number;
  focusMode: "selection" | "top";
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <Card className="border-border/60 bg-card/70 shadow-sm">
      <CardContent className="flex items-start gap-3 p-4">
        <div className="rounded-lg bg-muted p-2.5">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {label}
          </div>
          <div className="mt-1 text-xl font-semibold">{value}</div>
          {detail ? (
            <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function InspectorOverviewCards({
  stats,
  scoreColumn,
  activeFilterCount,
  focusedCount,
  focusMode,
}: InspectorOverviewCardsProps) {
  const bestChainLabel = stats.bestChain?.model_name ?? stats.bestChain?.model_class ?? "No scored chains";
  const warnings: string[] = [];

  if (stats.mixedMetrics) warnings.push("Multiple metrics are mixed together. Compare scores only after narrowing the metric.");
  if (stats.mixedTaskTypes) warnings.push("Regression and classification chains are mixed together. Some diagnostics will be hidden.");

  const insights = [
    stats.topModelLeader
      ? `Best model family by median ${scoreColumn}: ${stats.topModelLeader.label} (${formatMetricValue(stats.topModelLeader.score)}) across ${stats.topModelLeader.count} chains.`
      : null,
    stats.topPreprocessingLeader
      ? `Best preprocessing stack by median ${scoreColumn}: ${stats.topPreprocessingLeader.label} (${formatMetricValue(stats.topPreprocessingLeader.score)}) across ${stats.topPreprocessingLeader.count} chains.`
      : null,
    stats.iqr != null
      ? `Middle 50% spread is ${formatMetricValue(stats.iqr)} on ${scoreColumn}, which is a fast proxy for stability.`
      : null,
  ].filter((insight): insight is string => Boolean(insight));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          icon={Workflow}
          label="Visible Chains"
          value={String(stats.totalChains)}
          detail={`${stats.modelCount} model families, ${stats.datasetCount} datasets, ${stats.runCount} runs`}
        />
        <SummaryCard
          icon={Trophy}
          label="Current Leader"
          value={stats.bestScore != null ? formatMetricValue(stats.bestScore, stats.bestChain?.metric ?? undefined) : "—"}
          detail={bestChainLabel}
        />
        <SummaryCard
          icon={Blocks}
          label="Score Shape"
          value={stats.medianScore != null ? formatMetricValue(stats.medianScore, stats.bestChain?.metric ?? undefined) : "—"}
          detail={stats.iqr != null ? `Median ${scoreColumn}, IQR ${formatMetricValue(stats.iqr)}` : `No scored chains for ${scoreColumn}`}
        />
        <SummaryCard
          icon={Focus}
          label="Diagnostics Focus"
          value={String(focusedCount)}
          detail={focusMode === "selection" ? "Using your current chain selection" : `Using top chains by ${scoreColumn}`}
        />
      </div>

      <Card className="border-border/60 bg-card/70 shadow-sm">
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Reading Guide
              </div>
              <div className="mt-1 text-sm text-foreground">
                The page is organized from global patterns to chain-level diagnostics. All comparison charts below use the same filtered chain set.
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-[11px]">
                {stats.scoredChains} scored chains
              </Badge>
              <Badge variant="outline" className="text-[11px]">
                {activeFilterCount} sidebar filters
              </Badge>
              <Badge
                variant="secondary"
                className={cn(
                  "text-[11px]",
                  focusMode === "selection" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                )}
              >
                {focusMode === "selection" ? "Selection-driven diagnostics" : "Top-chain diagnostics"}
              </Badge>
            </div>
          </div>

          {warnings.length > 0 ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-3">
              <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4" />
                Compare with caution
              </div>
              <div className="mt-2 space-y-1 text-xs leading-5 text-amber-800/90 dark:text-amber-200/90">
                {warnings.map(warning => (
                  <div key={warning}>{warning}</div>
                ))}
              </div>
            </div>
          ) : null}

          {insights.length > 0 ? (
            <div className="grid gap-2 lg:grid-cols-3">
              {insights.map(insight => (
                <div key={insight} className="rounded-xl border border-border/60 bg-muted/40 px-3 py-3 text-xs leading-5 text-muted-foreground">
                  {insight}
                </div>
              ))}
            </div>
          ) : null}

          {activeFilterCount === 0 ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Filter className="h-3.5 w-3.5" />
              Add run, dataset, or model filters to isolate stronger patterns before interpreting the diagnostics.
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
