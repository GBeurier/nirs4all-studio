import type { RepetitionResult } from '@/types/playground';
import type {
  ComputedRepetitionDistances,
  RepetitionsPlotStatistics,
} from '@/lib/playground/repetitionsChartDistances';
import {
  buildRepetitionsDataBounds,
  buildRepetitionsXAxisViewport,
  buildRepetitionsZoomInfo,
  panRepetitionsXDomain,
  zoomRepetitionsXDomain,
} from '@/lib/playground/repetitionsChartViewport';
import {
  buildRepetitionExportRows,
} from '@/lib/playground/repetitionsChartExport';

export {
  buildRepetitionQuantileValues,
  normalizeComputedRepetitionDistances,
} from '@/lib/playground/repetitionsChartDistances';
export {
  buildRepetitionExportRows,
} from '@/lib/playground/repetitionsChartExport';
export {
  buildRepetitionsDataBounds,
  buildRepetitionsXAxisViewport,
  buildRepetitionsZoomInfo,
  panRepetitionsXDomain,
  zoomRepetitionsXDomain,
} from '@/lib/playground/repetitionsChartViewport';
export type {
  ComputedRepetitionDistances,
  RepetitionQuantileValue,
  RepetitionsPlotStatistics,
} from '@/lib/playground/repetitionsChartDistances';
export type {
  RepetitionsDataBounds,
  RepetitionsXAxisViewport,
  RepetitionsZoomInfo,
} from '@/lib/playground/repetitionsChartViewport';
export type {
  RepetitionExportRow,
} from '@/lib/playground/repetitionsChartExport';

export type RepetitionsSortOption =
  | 'index'
  | 'distance'
  | 'distance_desc'
  | 'variance'
  | 'variance_desc'
  | 'color'
  | 'name'
  | 'metadata_column';

export interface RepetitionsPlotDataPoint {
  /** X position (bio sample index) */
  x: number;
  /** Integer index of the bio sample group */
  groupIndex: number;
  /** Number of repetitions in this bio sample group */
  groupSize: number;
  /** Y position (distance) */
  y: number;
  /** Bio sample ID */
  bioSample: string;
  /** Rep index within bio sample */
  repIndex: number;
  /** Global sample index */
  sampleIndex: number;
  /** Sample ID string */
  sampleId: string;
  /** Target value for coloring */
  targetY?: number;
  /** Mean Y for the bio sample */
  yMean?: number;
  /** Is this an outlier? */
  isOutlier: boolean;
  /** Is this point selected? */
  isSelected: boolean;
}

export interface RepetitionsPlotModel {
  plotData: RepetitionsPlotDataPoint[];
  bioSampleOrder: string[];
  yRange: { min: number; max: number };
  statistics: RepetitionsPlotStatistics | null;
  shouldWarnCollapsedBioSamples: boolean;
}

export interface RepetitionsWebglData {
  points: [number, number][];
  indices: number[];
  colors: string[];
  values: number[];
}

export interface BuildRepetitionsPlotModelInput {
  repetitionData: RepetitionResult | null | undefined;
  spectraData?: number[][];
  y?: number[];
  computedDistances?: ComputedRepetitionDistances | null;
  scaleType: 'linear' | 'log';
  displayFilteredIndices?: Set<number>;
  sortBy: RepetitionsSortOption;
  metadataSortColumn?: string | null;
  metadata?: Record<string, unknown[]>;
  sampleIds?: string[];
  selectedSamples?: Set<number>;
}

const EMPTY_REPETITIONS_PLOT_MODEL: RepetitionsPlotModel = {
  plotData: [],
  bioSampleOrder: [],
  yRange: { min: 0, max: 1 },
  statistics: null,
  shouldWarnCollapsedBioSamples: false,
};

export function getRepetitionMetadataValue(
  metadata: Record<string, unknown[]> | undefined,
  sampleIndex: number,
  column: string | null | undefined
): string | null {
  if (!column || !metadata || !metadata[column]) return null;
  const raw = metadata[column][sampleIndex];
  if (raw === null || raw === undefined || raw === '') return null;
  return String(raw);
}

export function buildRepetitionsYDomain(
  plotData: RepetitionsPlotDataPoint[],
  padding = 0.15
): [number, number] {
  if (plotData.length === 0) return [0, 1];

  const yValues = plotData.map(point => point.y);
  const minY = Math.min(0, Math.min(...yValues));
  const maxY = Math.max(...yValues);
  const range = maxY - minY || 1;
  return [minY, maxY + range * padding];
}

export function getFiniteValueRange(values: readonly (number | null | undefined)[] | undefined): { min: number; max: number } {
  const finiteValues = (values ?? []).filter((value): value is number => Number.isFinite(value));
  if (finiteValues.length === 0) {
    return { min: 0, max: 1 };
  }

  let min = finiteValues[0];
  let max = finiteValues[0];
  for (let index = 1; index < finiteValues.length; index++) {
    const value = finiteValues[index];
    if (value < min) min = value;
    if (value > max) max = value;
  }

  return { min, max };
}

export function buildRepetitionsWebglData(
  plotData: RepetitionsPlotDataPoint[],
  getPointColor: (point: RepetitionsPlotDataPoint) => string
): RepetitionsWebglData {
  const points: [number, number][] = new Array(plotData.length);
  const indices: number[] = new Array(plotData.length);
  const colors: string[] = new Array(plotData.length);
  const values: number[] = new Array(plotData.length);

  for (let index = 0; index < plotData.length; index++) {
    const point = plotData[index];
    points[index] = [point.x, point.y];
    indices[index] = point.sampleIndex;
    colors[index] = getPointColor(point);
    values[index] = point.targetY ?? point.y;
  }

  return { points, indices, colors, values };
}

export function buildRepetitionsPlotModel({
  repetitionData,
  spectraData,
  y,
  computedDistances,
  scaleType,
  displayFilteredIndices,
  sortBy,
  metadataSortColumn,
  metadata,
  sampleIds,
  selectedSamples = new Set<number>(),
}: BuildRepetitionsPlotModelInput): RepetitionsPlotModel {
  const hasRepetitions = Boolean(repetitionData?.has_repetitions && repetitionData?.data);
  const effectiveSortColumn =
    sortBy === 'metadata_column' && metadataSortColumn && metadata && metadata[metadataSortColumn]
      ? metadataSortColumn
      : null;

  const distanceMap = new Map<number, number>();
  if (hasRepetitions && repetitionData?.data && computedDistances?.distances) {
    repetitionData.data.forEach((point, index) => {
      distanceMap.set(point.sample_index, computedDistances.distances[index] ?? point.distance);
    });
  }

  if (hasRepetitions && repetitionData?.data && repetitionData.data.length > 0) {
    return buildConfiguredRepetitionsPlotModel({
      repetitionData,
      computedDistances,
      scaleType,
      displayFilteredIndices,
      sortBy,
      effectiveSortColumn,
      metadata,
      selectedSamples,
      distanceMap,
    });
  }

  return buildSyntheticRepetitionsPlotModel({
    spectraData,
    y,
    displayFilteredIndices,
    sortBy,
    effectiveSortColumn,
    metadata,
    sampleIds,
    selectedSamples,
  });
}

function buildConfiguredRepetitionsPlotModel({
  repetitionData,
  computedDistances,
  scaleType,
  displayFilteredIndices,
  sortBy,
  effectiveSortColumn,
  metadata,
  selectedSamples,
  distanceMap,
}: {
  repetitionData: RepetitionResult;
  computedDistances?: ComputedRepetitionDistances | null;
  scaleType: 'linear' | 'log';
  displayFilteredIndices?: Set<number>;
  sortBy: RepetitionsSortOption;
  effectiveSortColumn: string | null;
  metadata?: Record<string, unknown[]>;
  selectedSamples: Set<number>;
  distanceMap: Map<number, number>;
}): RepetitionsPlotModel {
  let data = repetitionData.data ?? [];

  if (displayFilteredIndices && displayFilteredIndices.size > 0) {
    data = data.filter(point => displayFilteredIndices.has(point.sample_index));
  }

  if (data.length === 0) {
    return EMPTY_REPETITIONS_PLOT_MODEL;
  }

  const bioSamplesSet = new Set(data.map(point => point.bio_sample));
  const bioSampleStats = new Map<
    string,
    { meanDist: number; variance: number; meanY: number; firstIndex: number; groupSize: number; firstMeta: string | null }
  >();

  for (const bioSample of bioSamplesSet) {
    const groupData = data.filter(point => point.bio_sample === bioSample);
    const distances = groupData.map(point => distanceMap.get(point.sample_index) ?? point.distance);
    const meanDist = distances.reduce((sum, distance) => sum + distance, 0) / distances.length;
    const variance = distances.length > 1
      ? distances.reduce((sum, distance) => sum + Math.pow(distance - meanDist, 2), 0) / (distances.length - 1)
      : 0;
    const yValues = groupData.filter(point => point.y !== undefined).map(point => point.y!);
    const meanY = yValues.length > 0 ? yValues.reduce((sum, value) => sum + value, 0) / yValues.length : 0;
    const firstIndex = groupData[0]?.sample_index ?? 0;
    const firstMeta = effectiveSortColumn ? getRepetitionMetadataValue(metadata, firstIndex, effectiveSortColumn) : null;
    bioSampleStats.set(bioSample, { meanDist, variance, meanY, firstIndex, groupSize: groupData.length, firstMeta });
  }

  const bioSampleList = Array.from(bioSamplesSet);
  sortBioSampleList(bioSampleList, bioSampleStats, sortBy);

  const bioSampleIndex = new Map<string, number>();
  bioSampleList.forEach((bioSample, index) => bioSampleIndex.set(bioSample, index));

  const allY = data.filter(point => point.y !== undefined).map(point => point.y!);
  const yMin = allY.length > 0 ? Math.min(...allY) : 0;
  const yMax = allY.length > 0 ? Math.max(...allY) : 1;
  const maxDistance = computedDistances?.max ?? repetitionData.statistics?.max_distance ?? 1;
  const p95 = computedDistances?.quantiles?.[95] ?? repetitionData.statistics?.p95_distance ?? maxDistance;

  const plotData: RepetitionsPlotDataPoint[] = data.map(point => {
    const distance = distanceMap.get(point.sample_index) ?? point.distance;
    const groupIndex = bioSampleIndex.get(point.bio_sample) ?? 0;
    const groupSize = bioSampleStats.get(point.bio_sample)?.groupSize ?? 1;
    const displayDistance = scaleType === 'log' ? Math.log1p(distance) : distance;

    return {
      x: groupIndex,
      groupIndex,
      groupSize,
      y: displayDistance,
      bioSample: point.bio_sample,
      repIndex: point.rep_index,
      sampleIndex: point.sample_index,
      sampleId: point.sample_id,
      targetY: point.y,
      yMean: point.y_mean,
      isOutlier: distance > p95,
      isSelected: selectedSamples.has(point.sample_index),
    };
  });

  return {
    plotData,
    bioSampleOrder: bioSampleList,
    yRange: { min: yMin, max: yMax },
    statistics: computedDistances
      ? {
          mean_distance: computedDistances.mean,
          max_distance: computedDistances.max,
          p95_distance: computedDistances.quantiles[95] ?? computedDistances.max,
        }
      : repetitionData.statistics ?? null,
    shouldWarnCollapsedBioSamples: bioSamplesSet.size >= data.length * 0.95 && data.length > 4,
  };
}

function buildSyntheticRepetitionsPlotModel({
  spectraData,
  y,
  displayFilteredIndices,
  sortBy,
  effectiveSortColumn,
  metadata,
  sampleIds,
  selectedSamples,
}: {
  spectraData?: number[][];
  y?: number[];
  displayFilteredIndices?: Set<number>;
  sortBy: RepetitionsSortOption;
  effectiveSortColumn: string | null;
  metadata?: Record<string, unknown[]>;
  sampleIds?: string[];
  selectedSamples: Set<number>;
}): RepetitionsPlotModel {
  const totalSamples = spectraData?.length ?? y?.length ?? 0;
  if (totalSamples === 0) {
    return EMPTY_REPETITIONS_PLOT_MODEL;
  }

  const allIndices: number[] = [];
  for (let index = 0; index < totalSamples; index++) {
    if (displayFilteredIndices && displayFilteredIndices.size > 0 && !displayFilteredIndices.has(index)) continue;
    allIndices.push(index);
  }

  const groupKeyFor = (sampleIndex: number): string => {
    if (effectiveSortColumn) {
      return getRepetitionMetadataValue(metadata, sampleIndex, effectiveSortColumn) ?? 'unknown';
    }
    if (sampleIds && sampleIds[sampleIndex] !== undefined) return String(sampleIds[sampleIndex]);
    return `Sample_${sampleIndex}`;
  };

  const groupMembers = new Map<string, number[]>();
  for (const index of allIndices) {
    const key = groupKeyFor(index);
    const members = groupMembers.get(key);
    if (members) {
      members.push(index);
    } else {
      groupMembers.set(key, [index]);
    }
  }

  const groupList = Array.from(groupMembers.keys());
  const statsForGroup = (key: string) => {
    const members = groupMembers.get(key) ?? [];
    const yValues = y ? members.map(index => y[index]).filter((value): value is number => value !== undefined && Number.isFinite(value)) : [];
    const meanY = yValues.length > 0 ? yValues.reduce((sum, value) => sum + value, 0) / yValues.length : 0;
    const firstIndex = members[0] ?? 0;
    return { meanY, firstIndex, groupSize: members.length };
  };

  switch (sortBy) {
    case 'name':
    case 'metadata_column':
      groupList.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
      break;
    case 'color':
      groupList.sort((left, right) => statsForGroup(left).meanY - statsForGroup(right).meanY);
      break;
    case 'index':
    default:
      groupList.sort((left, right) => statsForGroup(left).firstIndex - statsForGroup(right).firstIndex);
      break;
  }

  const groupIndex = new Map<string, number>();
  groupList.forEach((key, index) => groupIndex.set(key, index));

  const yValues = y ? allIndices.map(index => y[index]).filter((value): value is number => value !== undefined && Number.isFinite(value)) : [];
  const yMin = yValues.length > 0 ? Math.min(...yValues) : 0;
  const yMax = yValues.length > 0 ? Math.max(...yValues) : 1;

  const plotData: RepetitionsPlotDataPoint[] = allIndices.map(index => {
    const key = groupKeyFor(index);
    const resolvedGroupIndex = groupIndex.get(key) ?? 0;
    const groupSize = groupMembers.get(key)?.length ?? 1;

    return {
      x: resolvedGroupIndex,
      groupIndex: resolvedGroupIndex,
      groupSize,
      y: 0,
      bioSample: key,
      repIndex: 0,
      sampleIndex: index,
      sampleId: sampleIds?.[index] ?? `Sample_${index}`,
      targetY: y?.[index],
      yMean: y?.[index],
      isOutlier: false,
      isSelected: selectedSamples.has(index),
    };
  });

  return {
    plotData,
    bioSampleOrder: groupList,
    yRange: { min: yMin, max: yMax },
    statistics: null,
    shouldWarnCollapsedBioSamples: false,
  };
}

function sortBioSampleList(
  bioSampleList: string[],
  bioSampleStats: Map<
    string,
    { meanDist: number; variance: number; meanY: number; firstIndex: number; firstMeta: string | null }
  >,
  sortBy: RepetitionsSortOption
): void {
  switch (sortBy) {
    case 'name':
      bioSampleList.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
      break;
    case 'distance':
      bioSampleList.sort((left, right) => (bioSampleStats.get(left)?.meanDist ?? 0) - (bioSampleStats.get(right)?.meanDist ?? 0));
      break;
    case 'distance_desc':
      bioSampleList.sort((left, right) => (bioSampleStats.get(right)?.meanDist ?? 0) - (bioSampleStats.get(left)?.meanDist ?? 0));
      break;
    case 'variance':
      bioSampleList.sort((left, right) => (bioSampleStats.get(left)?.variance ?? 0) - (bioSampleStats.get(right)?.variance ?? 0));
      break;
    case 'variance_desc':
      bioSampleList.sort((left, right) => (bioSampleStats.get(right)?.variance ?? 0) - (bioSampleStats.get(left)?.variance ?? 0));
      break;
    case 'color':
      bioSampleList.sort((left, right) => (bioSampleStats.get(left)?.meanY ?? 0) - (bioSampleStats.get(right)?.meanY ?? 0));
      break;
    case 'metadata_column':
      bioSampleList.sort((left, right) => {
        const leftValue = bioSampleStats.get(left)?.firstMeta ?? '';
        const rightValue = bioSampleStats.get(right)?.firstMeta ?? '';
        return leftValue.localeCompare(rightValue, undefined, { numeric: true });
      });
      break;
    case 'index':
    default:
      bioSampleList.sort((left, right) => (bioSampleStats.get(left)?.firstIndex ?? 0) - (bioSampleStats.get(right)?.firstIndex ?? 0));
      break;
  }
}
