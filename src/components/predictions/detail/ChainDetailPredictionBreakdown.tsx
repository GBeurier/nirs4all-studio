import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { partitionBadgeClass } from "@/lib/partitionColors";
import {
  formatMetricValue,
  getMetricAbbreviation,
} from "@/lib/scores";
import type { PartitionPrediction } from "@/types/aggregated-predictions";
import { metricMap } from "./chainDetailScoreUtils";

interface ChainDetailPredictionBreakdownProps {
  selectedFoldLabel: string | null;
  selectedFoldPartitions: PartitionPrediction[];
}

export function ChainDetailPredictionBreakdown({
  selectedFoldLabel,
  selectedFoldPartitions,
}: ChainDetailPredictionBreakdownProps) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card/60 p-4 shadow-sm">
      <div className="text-sm font-semibold tracking-tight">Selected prediction breakdown</div>
      <div className="mt-1 text-[11px] leading-5 text-muted-foreground">
        {selectedFoldLabel
          ? `Partition metrics for ${selectedFoldLabel}.`
          : "Choose a related prediction to inspect its metric map."}
      </div>
      {selectedFoldPartitions.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">
          No partition-level metrics are available for this selection.
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {selectedFoldPartitions.map((row) => (
            <div
              key={row.prediction_id}
              className="rounded-xl border border-border/60 bg-background/65 p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className={cn("h-5 px-1.5 text-[10px]", partitionBadgeClass(row.partition))}
                >
                  {row.partition}
                </Badge>
                <span className="text-[11px] text-muted-foreground">
                  {row.n_samples ?? "-"} samples
                </span>
                {row.n_features != null && (
                  <span className="text-[11px] text-muted-foreground">
                    · {row.n_features} features
                  </span>
                )}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {metricMap(row).length > 0 ? (
                  metricMap(row).map(([key, value]) => (
                    <div
                      key={key}
                      className="rounded-lg border border-border/50 bg-card/70 px-3 py-2"
                    >
                      <div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                        {getMetricAbbreviation(key)}
                      </div>
                      <div className="mt-1 font-mono text-sm font-semibold">
                        {formatMetricValue(value, key)}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-lg border border-dashed border-border/60 px-3 py-5 text-sm text-muted-foreground">
                    No detailed metric map stored.
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
