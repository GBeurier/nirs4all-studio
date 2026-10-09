import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  PredictionScatterChart,
} from "@/components/predictions/viewer/charts/PredictionScatterChart";
import {
  PredictionResidualsChart,
} from "@/components/predictions/viewer/charts/PredictionResidualsChart";
import {
  PredictionConfusionChart,
} from "@/components/predictions/viewer/charts/PredictionConfusionChart";
import {
  PredictionHistogramChart,
} from "@/components/predictions/viewer/charts/PredictionHistogramChart";
import type {
  ChartConfig,
  ChartKind,
  PartitionDataset,
  TaskKind,
} from "@/components/predictions/viewer/types";

interface ChainDetailChartBodyProps {
  kind: ChartKind;
  chartDatasets: PartitionDataset[];
  chartsLoading: boolean;
  chartsError: string | null;
  panelConfig: ChartConfig;
  taskKind: TaskKind;
}

export function ChainDetailChartBody({
  kind,
  chartDatasets,
  chartsLoading,
  chartsError,
  panelConfig,
  taskKind,
}: ChainDetailChartBodyProps) {
  const { t } = useTranslation();
  if (chartsLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        <span className="text-xs">{t("predictions.detail.chart.loading")}</span>
      </div>
    );
  }
  if (chartsError) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        {chartsError}
      </div>
    );
  }
  if (chartDatasets.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        {t("predictions.detail.chart.selectRelated")}
      </div>
    );
  }
  if (kind === "scatter") {
    return (
      <PredictionScatterChart
        className="h-full min-h-[320px] w-full"
        datasets={chartDatasets}
        config={panelConfig}
        variant="panel"
      />
    );
  }
  if (kind === "residuals") {
    return (
      <PredictionResidualsChart
        className="h-full min-h-[320px] w-full"
        datasets={chartDatasets}
        config={panelConfig}
        variant="panel"
      />
    );
  }
  if (kind === "distribution") {
    return (
      <PredictionHistogramChart
        className="h-full min-h-[320px] w-full"
        datasets={chartDatasets}
        config={panelConfig}
        taskKind={taskKind}
        variant="panel"
      />
    );
  }
  return (
    <PredictionConfusionChart
      className="h-full min-h-[320px] w-full"
      datasets={chartDatasets}
      config={panelConfig}
      variant="panel"
    />
  );
}
