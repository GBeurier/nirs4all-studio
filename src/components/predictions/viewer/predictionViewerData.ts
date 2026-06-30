import { isClassificationTask } from "@/components/runs/modelDetailClassification";
import {
  sanitizeFilename,
} from "./export";
import type {
  ChartConfig,
  ChartKind,
  HistogramSeries,
  PartitionDataset,
  TaskKind,
  ViewerColorMode,
  ViewerHeader,
} from "./types";

const CHART_KIND_LABELS: Record<ChartKind, string> = {
  scatter: "scatter",
  residuals: "residuals",
  confusion: "confusion",
  distribution: "distribution",
};

type DistributionSeries = "actual" | "predicted" | "residual";

export interface PredictionViewerCsvExport {
  columns: string[];
  rows: Record<string, unknown>[];
}

export function getPredictionViewerTaskKind(taskType: string | null | undefined): TaskKind {
  return isClassificationTask(taskType) ? "classification" : "regression";
}

export function getPredictionViewerAvailableKinds(taskKind: TaskKind): ChartKind[] {
  return taskKind === "classification"
    ? ["confusion", "distribution"]
    : ["scatter", "residuals", "distribution"];
}

export function shouldShowPredictionColorLegend({
  colorMode,
  datasetCount,
  kind,
  metadataKey,
}: {
  colorMode: ViewerColorMode;
  datasetCount: number;
  kind: ChartKind;
  metadataKey?: string | null;
}): boolean {
  if (kind === "confusion") return false;
  if (datasetCount <= 0) return false;
  return colorMode === "partition" || Boolean(metadataKey);
}

export function resolvePredictionViewerInitialKind(
  initialKind: ChartKind | undefined,
  taskKind: TaskKind,
): ChartKind {
  const available = getPredictionViewerAvailableKinds(taskKind);
  if (initialKind && available.includes(initialKind)) return initialKind;
  return taskKind === "classification" ? "confusion" : "scatter";
}

export function buildPredictionViewerBaseFilename(
  header: Pick<ViewerHeader, "datasetName" | "modelName">,
  kind: ChartKind,
): string {
  return `${sanitizeFilename(header.datasetName)}_${sanitizeFilename(header.modelName)}_${CHART_KIND_LABELS[kind]}`;
}

export function buildPredictionViewerHeaderTitle(header: Pick<ViewerHeader, "datasetName" | "modelName">): string {
  return [header.modelName ?? "Model", header.datasetName].filter(Boolean).join(" · ");
}

export function buildPredictionViewerHeaderDescription(
  header: Pick<ViewerHeader, "datasetName" | "modelName" | "taskType">,
): string {
  const details = [
    header.datasetName ? `dataset ${header.datasetName}` : null,
    header.modelName ? `model ${header.modelName}` : null,
    header.taskType ? `${header.taskType} task` : null,
  ].filter(Boolean);

  if (details.length === 0) {
    return "Inspect prediction charts and export the current view.";
  }

  return `Inspect prediction charts for ${details.join(", ")}.`;
}

export function getPredictionViewerDistributionSeries(histogramSeries: HistogramSeries): DistributionSeries[] {
  if (histogramSeries === "both") return ["actual", "predicted"];
  if (histogramSeries === "actual") return ["actual"];
  if (histogramSeries === "residuals") return ["residual"];
  return ["predicted"];
}

export function buildPredictionViewerCsvExport(
  kind: ChartKind,
  datasets: PartitionDataset[],
  config: Pick<ChartConfig, "histogramSeries">,
): PredictionViewerCsvExport | null {
  if (datasets.length === 0) return null;
  if (kind === "confusion") {
    const rows: Record<string, unknown>[] = [];
    const counts = new Map<string, number>();
    for (const dataset of datasets) {
      const count = Math.min(dataset.yTrue.length, dataset.yPred.length);
      for (let index = 0; index < count; index++) {
        const key = `${dataset.yTrue[index]}|${dataset.yPred[index]}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    for (const [key, count] of counts.entries()) {
      const [trueLabel, predLabel] = key.split("|");
      rows.push({ true_label: trueLabel, pred_label: predLabel, count });
    }
    return {
      columns: ["true_label", "pred_label", "count"],
      rows,
    };
  }

  if (kind === "distribution") {
    const series = getPredictionViewerDistributionSeries(config.histogramSeries);
    const rows: Record<string, unknown>[] = [];
    for (const dataset of datasets) {
      const count = Math.min(dataset.yTrue.length, dataset.yPred.length);
      for (let index = 0; index < count; index++) {
        for (const seriesKind of series) {
          const value = seriesKind === "actual"
            ? dataset.yTrue[index]
            : seriesKind === "predicted"
              ? dataset.yPred[index]
              : dataset.yTrue[index] - dataset.yPred[index];
          if (!Number.isFinite(value)) continue;
          rows.push({
            sample_id: dataset.sampleIds?.[index] ?? index,
            partition: dataset.label,
            series: seriesKind,
            value,
          });
        }
      }
    }
    return {
      columns: ["sample_id", "partition", "series", "value"],
      rows,
    };
  }

  const rows: Record<string, unknown>[] = [];
  for (const dataset of datasets) {
    const count = Math.min(dataset.yTrue.length, dataset.yPred.length);
    for (let index = 0; index < count; index++) {
      rows.push({
        sample_id: dataset.sampleIds?.[index] ?? index,
        partition: dataset.label,
        y_true: dataset.yTrue[index],
        y_pred: dataset.yPred[index],
        residual: dataset.yTrue[index] - dataset.yPred[index],
      });
    }
  }
  return {
    columns: ["sample_id", "partition", "y_true", "y_pred", "residual"],
    rows,
  };
}
