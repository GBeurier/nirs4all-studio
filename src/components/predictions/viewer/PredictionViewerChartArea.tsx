import type { Ref } from "react";
import {
  AlertCircle,
  Loader2,
} from "lucide-react";
import { PredictionConfusionChart } from "./charts/PredictionConfusionChart";
import { PredictionHistogramChart } from "./charts/PredictionHistogramChart";
import { PredictionResidualsChart } from "./charts/PredictionResidualsChart";
import { PredictionScatterChart } from "./charts/PredictionScatterChart";
import type {
  ChartConfig,
  ChartKind,
  PartitionDataset,
  TaskKind,
} from "./types";

interface PredictionViewerChartAreaProps {
  chartRef: Ref<HTMLDivElement>;
  config: ChartConfig;
  datasets: PartitionDataset[];
  error: string | null;
  hasActuals: boolean;
  isLoading: boolean;
  kind: ChartKind;
  taskKind: TaskKind;
}

export function PredictionViewerChartArea({
  chartRef,
  config,
  datasets,
  error,
  hasActuals,
  isLoading,
  kind,
  taskKind,
}: PredictionViewerChartAreaProps) {
  return (
    <div className="min-h-0 flex-1 px-5 py-3">
      {isLoading ? (
        <div className="flex h-full items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          <span className="text-sm">Loading prediction data…</span>
        </div>
      ) : error ? (
        <div className="flex h-full items-center justify-center">
          <div className="max-w-sm rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-center">
            <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-destructive/15">
              <AlertCircle className="h-5 w-5 text-destructive" />
            </div>
            <div className="text-sm font-medium text-destructive">Unable to load predictions</div>
            <div className="mt-1 text-xs leading-5 text-destructive/80">{error}</div>
          </div>
        </div>
      ) : datasets.length === 0 ? (
        <div className="flex h-full items-center justify-center text-muted-foreground">
          <span className="text-sm">Select at least one partition to display.</span>
        </div>
      ) : kind === "scatter" ? (
        <PredictionScatterChart ref={chartRef} datasets={datasets} config={config} variant="full" />
      ) : kind === "residuals" ? (
        <PredictionResidualsChart ref={chartRef} datasets={datasets} config={config} variant="full" />
      ) : kind === "confusion" ? (
        <PredictionConfusionChart ref={chartRef} datasets={datasets} config={config} variant="full" />
      ) : (
        <PredictionHistogramChart
          ref={chartRef}
          datasets={datasets}
          config={config}
          taskKind={taskKind}
          hasActuals={hasActuals}
          variant="full"
        />
      )}
    </div>
  );
}
