import type { FoldsInfo } from '@/types/playground';
import {
  type ColorContext,
  type GlobalColorConfig,
  getCategoricalColor,
  getContinuousColor,
  getUnifiedSampleColor,
  getWebGLSampleColor,
} from '@/lib/playground/colorConfig';
import type {
  DimensionReductionAxes,
  DimensionReductionDataPoint,
  DimensionReductionMethod,
  DimensionReductionYRange,
} from '@/lib/playground/dimensionReductionData';

export type DimensionReductionColorMode = 'target' | 'fold' | 'metadata';

export interface BuildDimensionReductionColorContextInput {
  externalColorContext?: ColorContext;
  y?: number[];
  yRange: DimensionReductionYRange;
  folds?: Pick<FoldsInfo, 'folds' | 'fold_labels' | 'kind' | 'n_folds'> | null;
  fallbackFoldLabels?: number[];
  metadata?: Record<string, unknown[]>;
  selectedSamples: Set<number>;
  pinnedSamples: Set<number>;
}

export interface GetDimensionReductionPointColorInput {
  point: DimensionReductionDataPoint;
  globalColorConfig?: GlobalColorConfig;
  colorContext: ColorContext;
  colorMode: DimensionReductionColorMode;
  metadataKey?: string;
  yRange: DimensionReductionYRange;
}

export interface GetDimensionReductionRechartsCellStyleInput extends GetDimensionReductionPointColorInput {
  selectedSamples: Set<number>;
  pinnedSamples: Set<number>;
  hoveredSample: number | null;
}

export interface DimensionReductionCellStyle {
  fill: string;
  fillOpacity?: number;
  stroke?: string;
  strokeWidth?: number;
}

export type DimensionReductionExportRow = Record<string, string | number>;

export function buildDimensionReductionColorContext({
  externalColorContext,
  y,
  yRange,
  folds,
  fallbackFoldLabels,
  metadata,
  selectedSamples,
  pinnedSamples,
}: BuildDimensionReductionColorContextInput): ColorContext {
  if (externalColorContext) return externalColorContext;

  let trainIndices: Set<number> | undefined;
  let testIndices: Set<number> | undefined;
  if (folds?.folds && folds.folds.length === 1) {
    const firstFold = folds.folds[0];
    trainIndices = new Set<number>(firstFold.train_indices ?? []);
    testIndices = new Set<number>(firstFold.test_indices ?? []);
  }

  return {
    y,
    yMin: yRange.min,
    yMax: yRange.max,
    trainIndices,
    testIndices,
    foldLabels: folds?.fold_labels ?? fallbackFoldLabels,
    foldKind: folds?.kind,
    foldCount: folds?.n_folds,
    metadata,
    selectedSamples,
    pinnedSamples,
  };
}

export function getDimensionReductionPointColor({
  point,
  globalColorConfig,
  colorContext,
  colorMode,
  metadataKey,
  yRange,
}: GetDimensionReductionPointColorInput): string {
  if (globalColorConfig) {
    return getWebGLSampleColor(point.index, globalColorConfig, colorContext);
  }

  switch (colorMode) {
    case 'fold':
      if (point.foldLabel !== undefined && point.foldLabel >= 0) {
        return getCategoricalColor(point.foldLabel, 'default');
      }
      return 'hsl(220, 10%, 50%)';

    case 'metadata':
      if (metadataKey && point.metadata?.[metadataKey] !== undefined) {
        return getCategoricalColor(hashDimensionReductionMetadataValue(point.metadata[metadataKey]), 'default');
      }
      return 'hsl(239, 84%, 67%)';

    case 'target':
    default:
      if (point.yValue !== undefined && Number.isFinite(point.yValue)) {
        const normalized = (point.yValue - yRange.min) / (yRange.max - yRange.min + 0.001);
        return getContinuousColor(normalized, 'blue_red');
      }
      return 'hsl(239, 84%, 67%)';
  }
}

export function getDimensionReductionRechartsCellStyle({
  point,
  globalColorConfig,
  colorContext,
  colorMode,
  metadataKey,
  yRange,
  selectedSamples,
  pinnedSamples,
  hoveredSample,
}: GetDimensionReductionRechartsCellStyleInput): DimensionReductionCellStyle {
  if (globalColorConfig) {
    const colorResult = getUnifiedSampleColor(point.index, globalColorConfig, {
      ...colorContext,
      hoveredSample,
    });
    if (colorResult.hidden) {
      return { fill: 'transparent', fillOpacity: 0 };
    }
    return {
      fill: colorResult.color,
      fillOpacity: colorResult.opacity,
      stroke: colorResult.stroke,
      strokeWidth: colorResult.strokeWidth ?? 0,
    };
  }

  const isSelected = selectedSamples.has(point.index);
  const isHovered = hoveredSample === point.index;
  const isPinned = pinnedSamples.has(point.index);
  const highlighted = isSelected || isHovered || isPinned;
  const hasSelection = selectedSamples.size > 0;

  return {
    fill: getDimensionReductionPointColor({
      point,
      colorContext,
      colorMode,
      metadataKey,
      yRange,
    }),
    fillOpacity: hasSelection && !highlighted ? 0.3 : 1,
    stroke: highlighted ? 'hsl(var(--foreground))' : undefined,
    strokeWidth: highlighted ? 2 : 0,
  };
}

export function buildDimensionReductionExportRows(
  points: DimensionReductionDataPoint[],
  axes: DimensionReductionAxes,
): DimensionReductionExportRow[] {
  return points.map(point => {
    const row: DimensionReductionExportRow = {
      sample: point.name,
      [axes.xAxis]: point.x,
      [axes.yAxis]: point.y,
    };

    if (point.z !== undefined) row[axes.zAxis] = point.z;
    if (point.yValue !== undefined) row.y_value = point.yValue;
    if (point.foldLabel !== undefined && point.foldLabel >= 0) {
      row.fold = formatDimensionReductionFoldLabel(point.foldLabel);
    }

    return row;
  });
}

export function getDimensionReductionExportName(method: DimensionReductionMethod): string {
  return method === 'pca' ? 'pca_scores' : 'umap_embedding';
}

export function formatDimensionReductionFoldLabel(foldIndex: number): string {
  return `Fold ${foldIndex + 1}`;
}

export function hashDimensionReductionMetadataValue(value: unknown): number {
  const hash = String(value).split('').reduce((current, character) => {
    current = ((current << 5) - current) + character.charCodeAt(0);
    return current & current;
  }, 0);
  return Math.abs(hash);
}
