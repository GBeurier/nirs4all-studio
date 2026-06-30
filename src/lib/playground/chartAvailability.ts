import type { MetricsResult, PlaygroundResult } from '@/types/playground';
import type { SpectralData } from '@/types/spectral';
import type { PipelineExecutionMetricObservation } from '@/lib/pipelineExecutionContract';
import {
  isPlaygroundSpectralProjection,
  type PlaygroundDataViewProjection,
} from '@/lib/playground/dataViewProjection';
import {
  hasPlaygroundFolds,
  hasPlaygroundPartition,
} from '@/lib/playground/canvasData';
import { buildMetricsFilterPanelReadModel } from '@/lib/playground/metricFilterReadModel';
import { projectPlaygroundMetricObservations } from '@/lib/playground/metricObservations';
import type { PlaygroundChartId } from '@/lib/playground/chartIds';
export { PLAYGROUND_CHART_IDS, isPlaygroundChartId, type PlaygroundChartId } from '@/lib/playground/chartIds';

export interface PlaygroundChartAvailabilityContext {
  result: PlaygroundResult | null;
  rawData: SpectralData | null;
  dataView?: PlaygroundDataViewProjection | null;
  metrics?: MetricsResult | null;
  metricObservations?: readonly PipelineExecutionMetricObservation[] | null;
  availability?: PlaygroundChartAvailabilityReadModel | null;
}

export interface PlaygroundChartAvailabilityReadModel {
  hasSpectralMatrix: boolean;
  hasTargetValues: boolean;
  hasDimensionReduction: boolean;
  hasFoldDistribution: boolean;
  hasRepetitionResult: boolean;
  hasFilterableMetrics: boolean;
  hasMetricObservations: boolean;
  metricKeys: string[];
}

function hasSpectralMatrix(context: PlaygroundChartAvailabilityContext): boolean {
  if (!isPlaygroundSpectralProjection(context.dataView)) {
    return false;
  }
  return (context.result?.processed?.spectra?.length ?? 0) > 0
    || (context.rawData?.spectra?.length ?? 0) > 0;
}

function hasTargetValues(context: PlaygroundChartAvailabilityContext): boolean {
  return (context.result?.processed?.y?.length ?? 0) > 0
    || (context.rawData?.y?.length ?? 0) > 0;
}

function hasDimensionReduction(context: PlaygroundChartAvailabilityContext): boolean {
  return (context.result?.pca?.coordinates?.length ?? 0) > 0;
}

function hasFoldDistribution(context: PlaygroundChartAvailabilityContext): boolean {
  return hasPlaygroundFolds(context.result) || hasPlaygroundPartition(context.result);
}

function hasRepetitionResult(context: PlaygroundChartAvailabilityContext): boolean {
  return Boolean(context.result?.repetitions);
}

function getMetrics(context: PlaygroundChartAvailabilityContext): MetricsResult | undefined {
  return context.metrics ?? context.result?.metrics;
}

function getMetricObservations(context: PlaygroundChartAvailabilityContext): PipelineExecutionMetricObservation[] {
  return projectPlaygroundMetricObservations(
    getMetrics(context),
    context.metricObservations ?? context.result?.metricObservations,
  );
}

export function buildPlaygroundChartAvailabilityReadModel(
  context: PlaygroundChartAvailabilityContext,
): PlaygroundChartAvailabilityReadModel {
  if (context.availability) {
    return context.availability;
  }

  const metrics = getMetrics(context);
  const metricObservations = getMetricObservations(context);
  const metricsReadModel = buildMetricsFilterPanelReadModel(metrics, metricObservations);

  return {
    hasSpectralMatrix: hasSpectralMatrix(context),
    hasTargetValues: hasTargetValues(context),
    hasDimensionReduction: hasDimensionReduction(context),
    hasFoldDistribution: hasFoldDistribution(context),
    hasRepetitionResult: hasRepetitionResult(context),
    hasFilterableMetrics: metricsReadModel.hasAvailableMetrics,
    hasMetricObservations: metricsReadModel.metricObservationAvailability.hasObservations,
    metricKeys: metricsReadModel.metricObservationAvailability.metricKeys,
  };
}

export function isPlaygroundChartAvailable(
  chartId: PlaygroundChartId,
  context: PlaygroundChartAvailabilityContext,
): boolean {
  const availability = buildPlaygroundChartAvailabilityReadModel(context);

  switch (chartId) {
    case 'spectra':
      return availability.hasSpectralMatrix;
    case 'histogram':
      return availability.hasTargetValues;
    case 'pca':
      return availability.hasDimensionReduction;
    case 'folds':
      return availability.hasFoldDistribution;
    case 'repetitions':
      return availability.hasRepetitionResult;
  }
}

export function isPlaygroundChartDisabled(
  chartId: PlaygroundChartId,
  context: PlaygroundChartAvailabilityContext,
): boolean {
  const availability = buildPlaygroundChartAvailabilityReadModel(context);

  switch (chartId) {
    case 'histogram':
      return !availability.hasTargetValues;
    case 'folds':
      return !availability.hasFoldDistribution;
    case 'repetitions':
      return !context.result?.repetitions?.has_repetitions;
    case 'spectra':
    case 'pca':
      return false;
  }
}

export function getPlaygroundChartDisabledReason(
  chartId: PlaygroundChartId,
  context: PlaygroundChartAvailabilityContext,
): string | null {
  const availability = buildPlaygroundChartAvailabilityReadModel(context);

  switch (chartId) {
    case 'histogram':
      return availability.hasTargetValues ? null : 'No Y values in dataset';
    case 'folds':
      return availability.hasFoldDistribution ? null : 'Add a splitter to see folds';
    case 'repetitions':
      if (!context.result?.repetitions) return 'Repetition analysis not computed';
      if (!context.result.repetitions.has_repetitions) {
        return context.result.repetitions.message || 'No repetitions detected in dataset';
      }
      return null;
    case 'spectra':
    case 'pca':
      return null;
  }
}

export function shouldRecommendPlaygroundChart(
  chartId: PlaygroundChartId,
  context: PlaygroundChartAvailabilityContext,
): boolean {
  const availability = buildPlaygroundChartAvailabilityReadModel(context);

  switch (chartId) {
    case 'folds':
      return availability.hasFoldDistribution;
    case 'repetitions':
      return Boolean(context.result?.repetitions?.has_repetitions);
    case 'spectra':
    case 'histogram':
    case 'pca':
      return false;
  }
}
