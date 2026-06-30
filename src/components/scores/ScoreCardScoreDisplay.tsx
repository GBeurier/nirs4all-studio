import { formatMetricValue } from "@/lib/scores";
import {
  buildCrossvalScorePairs,
  buildRefitScorePairs,
  buildTrainScorePairs,
  type ScorePairData,
} from "@/lib/scoreRowData";
import { safeNumber } from "@/lib/fold-utils";
import { cn } from "@/lib/utils";
import type { ScoreCardRow } from "@/types/score-cards";

export function ScoreCardScoreDisplay({
  row,
  selectedMetrics,
}: {
  row: ScoreCardRow;
  selectedMetrics: string[];
}) {
  if (row.cardType === "refit") {
    return <ScorePairList pairs={buildRefitScorePairs(row, selectedMetrics)} />;
  }
  if (row.cardType === "crossval") {
    return <ScorePairList pairs={buildCrossvalScorePairs(row, selectedMetrics)} />;
  }
  return <ScorePairList pairs={buildTrainScorePairs(row, selectedMetrics)} />;
}

function ScorePairList({ pairs }: { pairs: ScorePairData[] }) {
  return (
    <div className="flex min-w-0 items-center justify-start gap-1.5 flex-wrap lg:justify-end">
      {pairs.map((pair, index) => (
        <ScorePair
          key={`${pair.label}-${pair.metric}-${index}`}
          label={pair.label}
          value={pair.value}
          metric={pair.metric}
          colorClass={pair.colorClass}
        />
      ))}
    </div>
  );
}

function ScorePair({
  label,
  value,
  metric,
  colorClass,
}: {
  label: string;
  value: number | null | undefined;
  metric: string;
  colorClass?: string;
}) {
  const val = safeNumber(value);
  return (
    <div className="flex w-[4.1rem] shrink-0 flex-col items-center text-center">
      <span className="min-h-[0.75rem] text-muted-foreground uppercase text-[7px] font-medium tracking-wide leading-none">{label}</span>
      <span className={cn("font-mono text-[11px] tabular-nums leading-tight", colorClass || "text-foreground/70")}>
        {val != null ? formatMetricValue(val, metric) : "\u2014"}
      </span>
    </div>
  );
}
