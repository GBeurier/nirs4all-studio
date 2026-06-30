import type { FoldsInfo, PCAResult, UMAPResult } from '@/types/playground';

export type DimensionReductionMethod = 'pca' | 'umap';

export interface DimensionReductionDataPoint {
  x: number;
  y: number;
  z?: number;
  index: number;
  name: string;
  yValue?: number;
  foldLabel?: number;
  metadata?: Record<string, unknown>;
}

export interface DimensionReductionAxes {
  xAxis: string;
  yAxis: string;
  zAxis: string;
}

export interface DimensionOption {
  value: string;
  label: string;
  index: number;
}

export interface DimensionReductionYRange {
  min: number;
  max: number;
}

export interface DimensionReductionViewBounds {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

export interface DimensionReductionWebgl2DProps {
  points: [number, number][];
  indices: number[];
  colors: string[];
  values: number[];
}

export interface DimensionReductionWebgl3DProps {
  points: [number, number, number][];
  indices: number[];
  colors: string[];
  values: number[];
}

export interface BuildDimensionReductionPointsInput {
  result: Pick<PCAResult | UMAPResult, 'coordinates' | 'y' | 'fold_labels'> | null | undefined;
  axes: DimensionReductionAxes;
  sampleIds?: string[];
  y?: number[];
  fallbackY?: number[];
  folds?: FoldsInfo | null;
  fallbackFoldLabels?: number[];
  metadata?: Record<string, unknown[]>;
  nameForIndex?: (index: number) => string;
}

export function safeDimensionReductionCoord(value: number | undefined): number {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return 0;
  }
  return value;
}

export function getDimensionReductionComponentsForVariance(
  pca: Pick<PCAResult, 'explained_variance_ratio' | 'n_components'> | null | undefined,
  threshold = 0.999,
): number {
  if (!pca?.explained_variance_ratio) {
    return pca?.n_components ?? 0;
  }

  let cumulative = 0;
  for (let index = 0; index < pca.explained_variance_ratio.length; index++) {
    cumulative += pca.explained_variance_ratio[index] ?? 0;
    if (cumulative >= threshold) {
      return Math.min(index + 1, pca.explained_variance_ratio.length);
    }
  }

  return pca.explained_variance_ratio.length;
}

export function buildDimensionReductionOptions(
  method: DimensionReductionMethod,
  nComponents: number,
): DimensionOption[] {
  const prefix = method === 'pca' ? 'PC' : 'UMAP';
  return Array.from({ length: nComponents }, (_, index) => ({
    value: `dim${index + 1}`,
    label: `${prefix}${index + 1}`,
    index,
  }));
}

export function buildDimensionReductionVarianceExplained(
  method: DimensionReductionMethod,
  explainedVarianceRatio: number[] | undefined,
): Record<string, number> {
  if (method !== 'pca' || !explainedVarianceRatio) {
    return {};
  }

  const result: Record<string, number> = {};
  explainedVarianceRatio.forEach((value, index) => {
    result[`dim${index + 1}`] = (value ?? 0) * 100;
  });
  return result;
}

export function buildDimensionReductionPoints({
  result,
  axes,
  sampleIds,
  y,
  fallbackY,
  folds,
  fallbackFoldLabels,
  metadata,
  nameForIndex,
}: BuildDimensionReductionPointsInput): DimensionReductionDataPoint[] {
  if (!result?.coordinates || result.coordinates.length === 0) {
    return [];
  }

  const xIndex = getAxisIndex(axes.xAxis);
  const yIndex = getAxisIndex(axes.yAxis);
  const zIndex = getAxisIndex(axes.zAxis);
  const points: DimensionReductionDataPoint[] = [];

  result.coordinates.forEach((coords, sampleIndex) => {
    const rawX = coords[xIndex];
    const rawY = coords[yIndex];

    if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) {
      return;
    }

    const point: DimensionReductionDataPoint = {
      x: rawX,
      y: rawY,
      z: safeDimensionReductionCoord(coords[zIndex]),
      index: sampleIndex,
      name: nameForIndex?.(sampleIndex) ?? sampleIds?.[sampleIndex] ?? `Sample ${sampleIndex + 1}`,
      yValue: y?.[sampleIndex] ?? fallbackY?.[sampleIndex] ?? result.y?.[sampleIndex],
      foldLabel: folds?.fold_labels?.[sampleIndex] ?? fallbackFoldLabels?.[sampleIndex] ?? result.fold_labels?.[sampleIndex],
    };

    const pointMetadata = buildPointMetadata(metadata, sampleIndex);
    if (pointMetadata) {
      point.metadata = pointMetadata;
    }

    points.push(point);
  });

  return points;
}

export function filterDimensionReductionPoints(
  points: DimensionReductionDataPoint[],
  displayFilteredIndices: Set<number> | undefined,
): DimensionReductionDataPoint[] {
  if (!displayFilteredIndices) return points;
  return points.filter(point => displayFilteredIndices.has(point.index));
}

export function getDimensionReductionUniqueFolds(folds: Pick<FoldsInfo, 'fold_labels'> | null | undefined): number[] {
  if (!folds?.fold_labels) return [];
  return [...new Set(folds.fold_labels.filter(fold => fold >= 0))].sort((a, b) => a - b);
}

export function computeDimensionReductionYRange(points: DimensionReductionDataPoint[]): DimensionReductionYRange {
  if (points.length === 0) return { min: 0, max: 1 };

  const yValues = points
    .map(point => point.yValue ?? 0)
    .filter(Number.isFinite);

  if (yValues.length === 0) return { min: 0, max: 1 };

  return {
    min: Math.min(...yValues),
    max: Math.max(...yValues),
  };
}

export function buildDimensionReductionWebgl2DProps(
  points: DimensionReductionDataPoint[],
  getPointColor: (point: DimensionReductionDataPoint) => string,
): DimensionReductionWebgl2DProps {
  return {
    points: points.map((point): [number, number] => [point.x, point.y]),
    indices: points.map(point => point.index),
    colors: points.map(getPointColor),
    values: points.map(point => point.yValue ?? 0),
  };
}

export function buildDimensionReductionWebgl3DProps(
  points: DimensionReductionDataPoint[],
  getPointColor: (point: DimensionReductionDataPoint) => string,
): DimensionReductionWebgl3DProps {
  return {
    points: points.map((point): [number, number, number] => [point.x, point.y, point.z ?? 0]),
    indices: points.map(point => point.index),
    colors: points.map(getPointColor),
    values: points.map(point => point.yValue ?? 0),
  };
}

export function calculateDimensionReductionViewBounds(
  points: Pick<DimensionReductionDataPoint, 'x' | 'y'>[],
  containerWidth: number,
  containerHeight: number,
  preserveAspectRatio: boolean,
): DimensionReductionViewBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const point of points) {
    if (Number.isFinite(point.x) && Number.isFinite(point.y)) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    minX = -0.1;
    maxX = 0.1;
    minY = -0.1;
    maxY = 0.1;
  }

  const padX = (maxX - minX) * 0.05 || 0.1;
  const padY = (maxY - minY) * 0.05 || 0.1;
  minX -= padX;
  maxX += padX;
  minY -= padY;
  maxY += padY;

  let left = minX;
  let right = maxX;
  let bottom = minY;
  let top = maxY;

  if (preserveAspectRatio) {
    const aspect = containerWidth / containerHeight;
    const dataW = maxX - minX;
    const dataH = maxY - minY;
    const dataAspect = dataW / dataH;

    if (dataAspect > aspect) {
      const newH = dataW / aspect;
      const pad = (newH - dataH) / 2;
      bottom -= pad;
      top += pad;
    } else {
      const newW = dataH * aspect;
      const pad = (newW - dataW) / 2;
      left -= pad;
      right += pad;
    }
  }

  return { left, right, bottom, top };
}

export function screenToDimensionReductionData(
  screenX: number,
  screenY: number,
  containerWidth: number,
  containerHeight: number,
  bounds: DimensionReductionViewBounds,
): { x: number; y: number } {
  const dataX = bounds.left + (screenX / containerWidth) * (bounds.right - bounds.left);
  const dataY = bounds.top - (screenY / containerHeight) * (bounds.top - bounds.bottom);
  return { x: dataX, y: dataY };
}

export function formatDimensionReductionAxisLabel(
  axis: string,
  method: DimensionReductionMethod,
  varianceExplained: Record<string, number>,
  formatPercentage: (value: number) => string,
): string {
  const prefix = method === 'pca' ? 'PC' : 'UMAP';
  const axisNumber = axis.replace('dim', '');
  const variance = varianceExplained[axis];

  if (variance !== undefined) {
    return `${prefix}${axisNumber} (${formatPercentage(variance)})`;
  }

  return `${prefix}${axisNumber}`;
}

function getAxisIndex(axis: string): number {
  return parseInt(axis.replace('dim', ''), 10) - 1;
}

function buildPointMetadata(
  metadata: Record<string, unknown[]> | undefined,
  sampleIndex: number,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;

  const pointMetadata: Record<string, unknown> = {};
  for (const [key, values] of Object.entries(metadata)) {
    if (values && values[sampleIndex] !== undefined) {
      pointMetadata[key] = values[sampleIndex];
    }
  }

  return Object.keys(pointMetadata).length > 0 ? pointMetadata : undefined;
}
