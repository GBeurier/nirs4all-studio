import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  return (
    <div className="rounded-2xl border border-border/70 bg-card/60 p-4 shadow-sm">
      <div className="text-sm font-semibold tracking-tight">{t("predictions.detail.breakdown.title")}</div>
      <div className="mt-1 text-[11px] leading-5 text-muted-foreground">
        {selectedFoldLabel
          ? t("predictions.detail.breakdown.partitionMetrics", { fold: selectedFoldLabel })
          : t("predictions.detail.breakdown.choosePrediction")}
      </div>
      {selectedFoldPartitions.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">
          {t("predictions.detail.breakdown.noPartitionMetrics")}
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
                  {row.n_samples != null ? t("predictions.detail.samples", { count: row.n_samples }) : t("predictions.detail.samplesUnknown")}
                </span>
                {row.n_features != null && (
                  <span className="text-[11px] text-muted-foreground">
                    · {t("predictions.detail.features", { count: row.n_features })}
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
                    {t("predictions.detail.breakdown.noMetricMap")}
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
