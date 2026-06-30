import { buildPredictionColoration, type PredictionColoration } from "../coloration";
import type {
  ChartConfig,
  HistogramSeries,
  PartitionDataset,
  TaskKind,
} from "../types";
import {
  buildPredictionHistogramClassLabels,
  buildPredictionHistogramGroups,
  buildPredictionHistogramSeriesByGroup,
  detectPredictionHistogramTaskKind,
  getPredictionHistogramActiveVariants,
  getPredictionHistogramBinDomain,
  getPredictionHistogramPooledValues,
  resolvePredictionHistogramSeries,
  type PredictionHistogramBinDomain,
  type PredictionHistogramGroupDef,
  type PredictionHistogramVariantKey,
  type PredictionHistogramVariantSeries,
} from "./PredictionHistogramSeries";
import {
  buildPredictionHistogramRowsModel,
  clampPredictionHistogramBinCount,
  getPredictionHistogramReferenceLineX,
  getPredictionHistogramXAxisLabel,
  getPredictionHistogramYAxisLabel,
  summarizePredictionHistogramValues,
  type PredictionHistogramRowsModel,
  type PredictionHistogramSummary,
} from "./PredictionHistogramRows";

export {
  buildPredictionHistogramClassLabels,
  buildPredictionHistogramGroups,
  buildPredictionHistogramSeriesByGroup,
  detectPredictionHistogramTaskKind,
  formatPredictionHistogramClassValue,
  getPredictionHistogramActiveVariants,
  getPredictionHistogramBinDomain,
  getPredictionHistogramPooledValues,
  resolvePredictionHistogramSeries,
} from "./PredictionHistogramSeries";
export type {
  PredictionHistogramBinDomain,
  PredictionHistogramGroupDef,
  PredictionHistogramVariantKey,
  PredictionHistogramVariantSeries,
} from "./PredictionHistogramSeries";
export {
  buildPredictionHistogramRowsModel,
  clampPredictionHistogramBinCount,
  formatPredictionHistogramTooltipValue,
  getPredictionHistogramReferenceLineX,
  getPredictionHistogramTooltipTitle,
  getPredictionHistogramXAxisLabel,
  getPredictionHistogramYAxisLabel,
  summarizePredictionHistogramValues,
} from "./PredictionHistogramRows";
export type {
  PredictionHistogramBarEntry,
  PredictionHistogramBinRow,
  PredictionHistogramRowsModel,
  PredictionHistogramSummary,
} from "./PredictionHistogramRows";

export interface PredictionHistogramRenderModel extends PredictionHistogramRowsModel {
  actualsAvailable: boolean;
  taskKind: TaskKind;
  effectiveSeries: HistogramSeries;
  activeVariants: PredictionHistogramVariantKey[];
  groups: PredictionHistogramGroupDef[];
  seriesByGroup: Map<string, PredictionHistogramVariantSeries>;
  pooledValues: number[];
  classLabels: string[];
  binDomain: PredictionHistogramBinDomain | null;
  numBins: number;
  refStats: PredictionHistogramSummary | null;
  refLineX: { mean: string | null; median: string | null };
  xAxisLabel: string;
  yAxisLabel: string;
  emptyMessage: string;
}

export function buildPredictionHistogramRenderModel({
  datasets,
  config,
  taskKind,
  hasActuals,
  coloration = buildPredictionColoration(datasets, config),
}: {
  datasets: PartitionDataset[];
  config: ChartConfig;
  taskKind?: TaskKind;
  hasActuals?: boolean;
  coloration?: PredictionColoration;
}): PredictionHistogramRenderModel {
  const actualsAvailable = hasActuals ?? datasets.some((dataset) => dataset.yTrue.length > 0);
  const resolvedTaskKind = taskKind ?? detectPredictionHistogramTaskKind(datasets, actualsAvailable);
  const effectiveSeries = resolvePredictionHistogramSeries(
    config.histogramSeries,
    actualsAvailable,
  );
  const activeVariants = getPredictionHistogramActiveVariants(effectiveSeries);
  const groups = buildPredictionHistogramGroups({ datasets, config, coloration });
  const seriesByGroup = buildPredictionHistogramSeriesByGroup({
    datasets,
    groups,
    activeVariants,
    config,
    coloration,
  });
  const pooledValues = getPredictionHistogramPooledValues(seriesByGroup, activeVariants);
  const classLabels = buildPredictionHistogramClassLabels(resolvedTaskKind, pooledValues);
  const binDomain = getPredictionHistogramBinDomain(resolvedTaskKind, pooledValues);
  const numBins = clampPredictionHistogramBinCount(config.histogramBinCount);
  const rowsModel = buildPredictionHistogramRowsModel({
    groups,
    activeVariants,
    taskKind: resolvedTaskKind,
    classLabels,
    binDomain,
    numBins,
    seriesByGroup,
    layout: config.histogramLayout,
    showErrorBars: config.histogramShowErrorBars,
    yAxis: config.histogramYAxis,
    effectiveSeries,
  });
  const refStats = summarizePredictionHistogramValues(pooledValues);
  const refLineX = getPredictionHistogramReferenceLineX({
    taskKind: resolvedTaskKind,
    refStats,
    binDomain,
    numBins,
    rows: rowsModel.rows,
  });

  return {
    actualsAvailable,
    taskKind: resolvedTaskKind,
    effectiveSeries,
    activeVariants,
    groups,
    seriesByGroup,
    pooledValues,
    classLabels,
    binDomain,
    numBins,
    refStats,
    refLineX,
    xAxisLabel: getPredictionHistogramXAxisLabel(resolvedTaskKind, effectiveSeries),
    yAxisLabel: getPredictionHistogramYAxisLabel(config.histogramYAxis, resolvedTaskKind),
    emptyMessage: actualsAvailable ? "No values to visualize." : "No predictions to visualize.",
    ...rowsModel,
  };
}
