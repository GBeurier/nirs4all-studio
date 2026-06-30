import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { foldLabel } from "@/lib/fold-utils";
import { partitionBadgeClass } from "@/lib/partitionColors";
import { formatMetricValue } from "@/lib/scores";
import type { PartitionPrediction } from "@/types/aggregated-predictions";
import { scoreForPartition } from "./chainDetailScoreUtils";

interface RelatedPredictionFoldGroup {
  foldId: string;
  isAggregated: boolean;
  kind: "refit" | "cv" | "fold";
  rows: PartitionPrediction[];
}

interface ChainDetailRelatedPredictionsProps {
  loading: boolean;
  foldGroups: RelatedPredictionFoldGroup[];
  selectedFoldId: string;
  onSelectFold: (foldId: string) => void;
}

export function ChainDetailRelatedPredictions({
  loading,
  foldGroups,
  selectedFoldId,
  onSelectFold,
}: ChainDetailRelatedPredictionsProps) {
  return (
    <section className="space-y-3">
      <div>
        <div className="text-sm font-semibold tracking-tight">Related predictions</div>
        <div className="mt-1 text-[11px] leading-5 text-muted-foreground">
          Switch between refit, CV summaries, and numbered folds.
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center rounded-2xl border border-border/70 bg-card/40 py-10 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading related predictions...
        </div>
      ) : foldGroups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/70 bg-card/40 px-4 py-8 text-center text-sm text-muted-foreground">
          No related predictions are available for this chain.
        </div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {foldGroups.map((group) => (
            <button
              key={group.foldId}
              type="button"
              onClick={() => onSelectFold(group.foldId)}
              className={cn(
                "w-full rounded-2xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md",
                group.foldId === selectedFoldId
                  ? "border-primary/30 bg-primary/[0.05] ring-2 ring-primary/25"
                  : group.kind === "refit"
                  ? "border-emerald-500/20 bg-emerald-500/[0.04]"
                  : group.kind === "cv"
                  ? "border-blue-500/20 bg-blue-500/[0.04]"
                  : "border-border/70 bg-card/55",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">{foldLabel(group.foldId)}</span>
                <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                  {group.rows.length} part.
                </Badge>
                {group.isAggregated && (
                  <Badge
                    variant="outline"
                    className="h-5 px-1.5 text-[10px] border-purple-500/30 text-purple-500"
                  >
                    Aggregated
                  </Badge>
                )}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {["val", "test", "train"].map((partition) => {
                  const row = group.rows.find((candidate) => candidate.partition === partition);
                  return (
                    <div
                      key={partition}
                      className="rounded-xl border border-border/60 bg-background/65 px-3 py-2"
                    >
                      <div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                        {partition}
                      </div>
                      <div className="mt-1 font-mono text-sm font-semibold">
                        {row ? formatMetricValue(scoreForPartition(row, partition), row.metric) : "-"}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {group.rows.map((row) => (
                  <span
                    key={row.prediction_id}
                    className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/65 px-2 py-1 text-[10px] text-muted-foreground"
                  >
                    <Badge
                      variant="outline"
                      className={cn("h-4 px-1 text-[9px]", partitionBadgeClass(row.partition))}
                    >
                      {row.partition}
                    </Badge>
                    <span className="font-mono">{row.n_samples ?? "-"}</span>
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
