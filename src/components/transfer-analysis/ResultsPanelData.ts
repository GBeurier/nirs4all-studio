import type {
  DatasetInfo,
  DatasetPairDistance,
  MetricConvergenceItem,
  PCACoordinate,
  PreprocessingRankingItem,
  TransferAnalysisResponse,
  TransferMetricType,
} from '@/types/transfer';

export interface ResultsPanelOption<T extends string = string> {
  value: T;
  label: string;
}

export interface ResultsPanelDatasetBadge {
  id: string;
  label: string;
}

export interface ResultsPanelReduction {
  label: string;
  tone: 'positive' | 'negative';
  className: string;
}

export interface ResultsPanelSummaryModel {
  description: string;
  executionTimeLabel: string;
  bestPreprocessing: string;
  reduction: ResultsPanelReduction;
  datasetBadges: ResultsPanelDatasetBadge[];
  datasetOverflowLabel: string | null;
  preprocessingsTestedLabel: string;
}

export interface ResultsPanelControlsModel {
  preprocessingOptions: ResultsPanelOption[];
  metricOptions: ResultsPanelOption<TransferMetricType>[];
  activePreprocessingSelectValue: string;
}

export interface ResultsPanelChartModel {
  ranking: PreprocessingRankingItem[];
  distanceRows: DatasetPairDistance[];
  datasetNames: string[];
  pcaCoordinates: PCACoordinate[];
  convergenceData: MetricConvergenceItem[];
}

export const RESULTS_PANEL_METRIC_OPTIONS: ResultsPanelOption<TransferMetricType>[] = [
  { value: 'centroid', label: 'Centroid' },
  { value: 'spread', label: 'Spread' },
];

const DATASET_BADGE_LIMIT = 3;

export function formatTransferExecutionTime(ms: number): string {
  return `${ms.toFixed(0)}ms`;
}

export function formatTransferReduction(reductionPct: number): ResultsPanelReduction {
  const isPositive = reductionPct > 0;

  return {
    label: `${isPositive ? '+' : ''}${reductionPct.toFixed(1)}%`,
    tone: isPositive ? 'positive' : 'negative',
    className: isPositive ? 'text-green-600' : 'text-red-600',
  };
}

export function getResultsPanelDatasetBadges(
  datasets: DatasetInfo[],
  limit = DATASET_BADGE_LIMIT,
): Pick<ResultsPanelSummaryModel, 'datasetBadges' | 'datasetOverflowLabel'> {
  const datasetBadges = datasets.slice(0, limit).map((dataset) => ({
    id: dataset.id,
    label: dataset.name,
  }));
  const overflowCount = datasets.length - limit;

  return {
    datasetBadges,
    datasetOverflowLabel: overflowCount > 0 ? `+${overflowCount}` : null,
  };
}

export function getResultsPanelSummaryModel(results: TransferAnalysisResponse): ResultsPanelSummaryModel {
  const { datasetBadges, datasetOverflowLabel } = getResultsPanelDatasetBadges(results.datasets);

  return {
    description: `${results.summary.n_datasets} datasets, ${results.summary.n_preprocessings} preprocessings, ${results.summary.n_pairs} pairwise comparisons`,
    executionTimeLabel: formatTransferExecutionTime(results.execution_time_ms),
    bestPreprocessing: results.summary.best_preprocessing,
    reduction: formatTransferReduction(results.summary.best_reduction_pct),
    datasetBadges,
    datasetOverflowLabel,
    preprocessingsTestedLabel: `${results.preprocessings.length} tested`,
  };
}

export function getPreprocessingOptions(preprocessings: string[]): ResultsPanelOption[] {
  return preprocessings.map((preprocessing) => ({
    value: preprocessing,
    label: preprocessing,
  }));
}

export function getMetricOptions(): ResultsPanelOption<TransferMetricType>[] {
  return RESULTS_PANEL_METRIC_OPTIONS;
}

export function getActivePreprocessingSelectValue(activePreprocessing: string | null): string {
  return activePreprocessing || '';
}

export function getResultsPanelControlsModel(
  results: TransferAnalysisResponse,
  activePreprocessing: string | null,
): ResultsPanelControlsModel {
  return {
    preprocessingOptions: getPreprocessingOptions(results.preprocessings),
    metricOptions: getMetricOptions(),
    activePreprocessingSelectValue: getActivePreprocessingSelectValue(activePreprocessing),
  };
}

export function getActivePreprocessingKey(activePreprocessing: string | null): string {
  return activePreprocessing || 'raw';
}

export function getHeatmapPreprocessingKey(activePreprocessing: string | null): string {
  return activePreprocessing || '';
}

export function getRankingData(
  results: TransferAnalysisResponse,
  selectedMetric: TransferMetricType,
): PreprocessingRankingItem[] {
  return results.preprocessing_ranking[selectedMetric] || [];
}

export function getDistanceRows(
  results: TransferAnalysisResponse,
  activePreprocessing: string | null,
): DatasetPairDistance[] {
  return results.distance_matrices[getHeatmapPreprocessingKey(activePreprocessing)] || [];
}

export function getDatasetNames(results: TransferAnalysisResponse): string[] {
  return results.datasets.map((dataset) => dataset.name);
}

export function getPcaCoordinates(
  results: TransferAnalysisResponse,
  activePreprocessing: string | null,
): PCACoordinate[] {
  return results.pca_coordinates[getActivePreprocessingKey(activePreprocessing)] || [];
}

export function getConvergenceData(results: TransferAnalysisResponse): MetricConvergenceItem[] {
  return results.metric_convergence;
}

export function getResultsPanelChartModel(
  results: TransferAnalysisResponse,
  selectedMetric: TransferMetricType,
  activePreprocessing: string | null,
): ResultsPanelChartModel {
  return {
    ranking: getRankingData(results, selectedMetric),
    distanceRows: getDistanceRows(results, activePreprocessing),
    datasetNames: getDatasetNames(results),
    pcaCoordinates: getPcaCoordinates(results, activePreprocessing),
    convergenceData: getConvergenceData(results),
  };
}
