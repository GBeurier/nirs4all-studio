import { GitBranch } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import {
  formatMetricName,
  formatMetricValue,
} from "@/lib/scores";
import { cn } from "@/lib/utils";
import {
  CV_PARTITIONS,
  type CvMetricRow,
} from "./ChainDetailPipelineIdentityTypes";

interface ChainDetailAdditionalCvMetricsProps {
  rows: CvMetricRow[];
  cvFoldCount: number;
}

export function ChainDetailAdditionalCvMetrics({
  rows,
  cvFoldCount,
}: ChainDetailAdditionalCvMetricsProps) {
  const { t } = useTranslation();
  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <GitBranch className="h-3.5 w-3.5" />
        {t("predictions.detail.identity.cvMetricsTitle")}
        <Badge variant="outline" className="ml-auto h-5 px-1.5 text-[10px]">
          {t("predictions.detail.identity.foldsAveraged", { count: cvFoldCount || 0 })}
        </Badge>
      </div>
      <div className="mt-2 overflow-x-auto">
        <div className="min-w-[420px] overflow-hidden rounded-xl border border-border/60 bg-card/70">
          <div className="grid grid-cols-[minmax(120px,1.35fr)_repeat(3,minmax(72px,1fr))] border-b border-border/60 bg-muted/40 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            <div>{t("predictions.detail.identity.metric")}</div>
            {CV_PARTITIONS.map((partition) => (
              <div key={partition} className="text-right">{t(`predictions.partitionsShort.${partition}`)}</div>
            ))}
          </div>
          {rows.map((row, index) => (
            <div
              key={row.metric}
              className={cn(
                "grid grid-cols-[minmax(120px,1.35fr)_repeat(3,minmax(72px,1fr))] items-center gap-3 px-3 py-2 text-sm",
                index > 0 && "border-t border-border/50",
              )}
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{formatMetricName(row.metric)}</div>
              </div>
              {CV_PARTITIONS.map((partition) => (
                <div key={partition} className="text-right font-mono text-sm font-semibold tabular-nums">
                  {formatMetricValue(row.values[partition], row.metric)}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
