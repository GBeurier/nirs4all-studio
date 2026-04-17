/**
 * Inline prediction preview for right-side panels.
 *
 * Renders stacked mini charts (scatter + residuals for regression, or a
 * single confusion thumbnail for classification). Clicking a thumbnail
 * opens the full PredictionViewer on the matching kind.
 */

import { useMemo } from "react";
import { Eye, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isClassificationTask } from "@/components/runs/modelDetailClassification";
import { PredictionColorLegend } from "./PredictionColorLegend";
import {
  type ChartConfig,
  type ChartKind,
  type PredictionPreviewProps,
} from "./types";
import { usePartitionsData } from "./fetchPartitionData";
import { usePredictionChartConfig } from "./usePredictionChartConfig";
import { PredictionScatterChart } from "./charts/PredictionScatterChart";
import { PredictionResidualsChart } from "./charts/PredictionResidualsChart";
import { PredictionConfusionChart } from "./charts/PredictionConfusionChart";

export function PredictionPreview({
  header,
  partitions,
  workspaceId,
  onOpenViewer,
}: PredictionPreviewProps) {
  const configDatasetKey = useMemo(
    () => `${workspaceId ?? "__current__"}::${header.datasetName}`,
    [workspaceId, header.datasetName],
  );
  const [sharedConfig] = usePredictionChartConfig({ datasetKey: configDatasetKey });
  const { data: datasets, isLoading, error } = usePartitionsData({
    partitions,
    workspaceId,
    enabled: partitions.length > 0,
  });

  const previewConfig = useMemo<ChartConfig>(() => ({
    ...sharedConfig,
    regressionLine: false,
    sigmaBand: false,
    confusionShowTotals: false,
  }), [sharedConfig]);

  const taskKind = useMemo<"regression" | "classification">(() => {
    return isClassificationTask(header.taskType) ? "classification" : "regression";
  }, [header.taskType]);

  const headerLabel = useMemo(() => {
    const parts = [header.modelName ?? "Model", header.datasetName].filter(Boolean);
    return parts.join(" · ");
  }, [header.modelName, header.datasetName]);

  const defaultKind: ChartKind = taskKind === "classification" ? "confusion" : "scatter";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 truncate text-xs font-medium text-foreground" title={headerLabel}>
          {headerLabel}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={() => onOpenViewer(defaultKind)}
        >
          <Eye className="h-3.5 w-3.5" />
          Open viewer
        </Button>
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          <span className="text-xs">Loading…</span>
        </div>
      ) : error ? (
        <div className="flex h-40 items-center justify-center rounded-md border border-destructive/40 bg-destructive/10 px-3 text-xs text-destructive">
          {error}
        </div>
      ) : taskKind === "classification" ? (
        <button
          type="button"
          role="button"
          className="group flex flex-col items-center rounded-md border border-border/60 bg-card p-2 transition hover:border-border hover:shadow-sm"
          onClick={() => onOpenViewer("confusion")}
          style={{ height: 240 }}
        >
          <div className="flex h-[220px] w-full items-center justify-center">
            <div style={{ width: "min(100%, 220px)", height: "100%" }}>
              <PredictionConfusionChart datasets={datasets} config={previewConfig} variant="thumbnail" />
            </div>
          </div>
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            role="button"
            className="group flex flex-col rounded-md border border-border/60 bg-card p-2 transition hover:border-border hover:shadow-sm"
            onClick={() => onOpenViewer("scatter")}
          >
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Pred vs Actual
            </div>
            <div style={{ height: 140 }} className="w-full">
              <PredictionScatterChart datasets={datasets} config={previewConfig} variant="thumbnail" />
            </div>
            <PredictionColorLegend datasets={datasets} config={previewConfig} className="pt-1" />
          </button>
          <button
            type="button"
            role="button"
            className="group flex flex-col rounded-md border border-border/60 bg-card p-2 transition hover:border-border hover:shadow-sm"
            onClick={() => onOpenViewer("residuals")}
          >
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Residuals
            </div>
            <div style={{ height: 140 }} className="w-full">
              <PredictionResidualsChart datasets={datasets} config={previewConfig} variant="thumbnail" />
            </div>
            <PredictionColorLegend datasets={datasets} config={previewConfig} className="pt-1" />
          </button>
        </div>
      )}
    </div>
  );
}
