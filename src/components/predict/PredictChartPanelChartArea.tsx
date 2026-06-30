import type { Ref } from "react";
import { PredictionConfusionChart } from "@/components/predictions/viewer/charts/PredictionConfusionChart";
import { PredictionHistogramChart } from "@/components/predictions/viewer/charts/PredictionHistogramChart";
import { PredictionResidualsChart } from "@/components/predictions/viewer/charts/PredictionResidualsChart";
import { PredictionScatterChart } from "@/components/predictions/viewer/charts/PredictionScatterChart";
import type {
  ChartConfig,
  ChartKind,
  PartitionDataset,
  TaskKind,
} from "@/components/predictions/viewer/types";
import { cn } from "@/lib/utils";

interface PredictChartPanelChartAreaProps {
  chartClassName?: string;
  chartRef: Ref<HTMLDivElement>;
  config: ChartConfig;
  datasets: PartitionDataset[];
  hasActuals: boolean;
  isFullscreen?: boolean;
  kind: ChartKind;
  taskKind: TaskKind;
}

export function PredictChartPanelChartArea({
  chartClassName,
  chartRef,
  config,
  datasets,
  hasActuals,
  isFullscreen,
  kind,
  taskKind,
}: PredictChartPanelChartAreaProps) {
  const chartAreaClass = chartClassName
    ? cn("px-3 py-3", chartClassName)
    : isFullscreen
    ? "flex min-h-0 flex-1 flex-col px-3 py-3"
    : "h-[420px] shrink-0 px-3 py-3";

  return (
    <div className={chartAreaClass}>
      {kind === "scatter" && hasActuals && datasets.length > 0 ? (
        <PredictionScatterChart
          ref={chartRef}
          datasets={datasets}
          config={config}
          variant="full"
        />
      ) : kind === "residuals" && hasActuals && datasets.length > 0 ? (
        <PredictionResidualsChart
          ref={chartRef}
          datasets={datasets}
          config={config}
          variant="full"
        />
      ) : kind === "confusion" && hasActuals && datasets.length > 0 ? (
        <PredictionConfusionChart
          ref={chartRef}
          datasets={datasets}
          config={config}
          variant="full"
        />
      ) : kind === "distribution" && datasets.length > 0 ? (
        <PredictionHistogramChart
          ref={chartRef}
          datasets={datasets}
          config={config}
          taskKind={taskKind}
          hasActuals={hasActuals}
          variant="full"
        />
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          {hasActuals
            ? "No data to display for this view."
            : "Reference values are required for this chart. Switch to Distribution or predict on a dataset partition with targets."}
        </div>
      )}
    </div>
  );
}
