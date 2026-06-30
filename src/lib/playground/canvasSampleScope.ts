import type {
  FilterContextValue,
  FilterDataContext,
} from '@/context/useFilter';
import type { ColorContext } from '@/lib/playground/colorConfig';
import {
  getPartitionIndices,
  type PartitionFilter,
} from '@/lib/playground/partitionFilters';
import type { FoldsInfo } from '@/types/playground';

export function mergeCanvasOutlierIndices(
  detectedOutlierIndices: number[] | null | undefined,
  contextOutliers: Set<number>
): Set<number> | undefined {
  const detected = detectedOutlierIndices ?? [];
  if (detected.length === 0 && contextOutliers.size === 0) {
    return undefined;
  }

  const merged = new Set(detected);
  for (const index of contextOutliers) {
    merged.add(index);
  }
  return merged;
}

export function buildCanvasFilterDataContext({
  totalSamples,
  folds,
  outlierIndices,
  selectedSamples,
  metadata,
}: {
  totalSamples: number;
  folds: FoldsInfo | null;
  outlierIndices?: Set<number>;
  selectedSamples: Set<number>;
  metadata?: Record<string, unknown[]>;
}): FilterDataContext {
  return {
    totalSamples,
    folds,
    outlierIndices: outlierIndices ?? new Set(),
    selectedSamples,
    metadata: metadata ?? null,
  };
}

export function buildCanvasDisplayFilteredIndices(
  filteredIndices: number[],
  hasDisplayFilter: boolean
): Set<number> | undefined {
  return hasDisplayFilter ? new Set(filteredIndices) : undefined;
}

export function resolveCanvasFilteredIndices({
  filterContext,
  filterDataContext,
  partitionFilter,
  folds,
  totalSamples,
}: {
  filterContext: FilterContextValue | null;
  filterDataContext: FilterDataContext;
  partitionFilter: PartitionFilter;
  folds: FoldsInfo | null;
  totalSamples: number;
}): number[] {
  if (filterContext) {
    return filterContext.getFilteredIndices(filterDataContext);
  }
  return getPartitionIndices(partitionFilter, folds, totalSamples);
}

export function buildCanvasColorContext({
  yValues,
  yMin,
  yMax,
  trainIndices,
  testIndices,
  folds,
  metadata,
  outlierIndices,
  totalSamples,
  selectedSamples,
  pinnedSamples,
  displayFilteredIndices,
  targetType,
  classLabels,
  classLabelMap,
}: {
  yValues: number[];
  yMin: number;
  yMax: number;
  trainIndices?: Set<number>;
  testIndices?: Set<number>;
  folds: FoldsInfo | null;
  metadata?: Record<string, unknown[]>;
  outlierIndices?: Set<number>;
  totalSamples: number;
  selectedSamples: Set<number>;
  pinnedSamples: Set<number>;
  displayFilteredIndices?: Set<number>;
  targetType?: ColorContext['targetType'];
  classLabels?: string[];
  classLabelMap?: Map<string, number>;
}): ColorContext {
  return {
    y: yValues,
    yMin,
    yMax,
    trainIndices,
    testIndices,
    foldLabels: folds?.fold_labels,
    foldKind: folds?.kind,
    foldCount: folds?.n_folds,
    metadata,
    outlierIndices,
    totalSamples,
    selectedSamples,
    pinnedSamples,
    displayFilteredIndices,
    targetType,
    classLabels,
    classLabelMap,
  };
}
