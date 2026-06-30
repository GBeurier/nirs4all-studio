import type { GlobalColorConfig } from '@/lib/playground/colorConfig';
import type { FoldsInfo, YStats } from '@/types/playground';

export interface FoldDistributionYBin {
  min: number;
  max: number;
  label?: string;
}

export interface SegmentResult {
  counts: Record<string, number>;
  indices: Record<string, number[]>;
}

export interface PartitionBarData {
  index: number;
  label: string;
  partitionId: string;
  partitionType: 'train' | 'val' | 'test';
  foldIndex: number | null;
  count: number;
  indices: number[];
  yMean?: number;
  yStd?: number;
  segments: Record<string, number>;
  segmentIndices: Record<string, number[]>;
}

export interface FoldDistributionYStatsData {
  fold: string;
  foldIndex: number;
  trainMean: number;
  trainStd: number;
  trainMin: number;
  trainMax: number;
  testMean: number;
  testStd: number;
  testMin: number;
  testMax: number;
  trainLower: number;
  trainUpper: number;
  testLower: number;
  testUpper: number;
}

export interface FoldDistributionTargetRange {
  min: number;
  max: number;
}

export type FoldDistributionExportRow = Record<string, string | number>;

type FoldLabelFormatter = (foldIndex: number) => string;

interface FoldLabelOptions {
  formatFoldLabel?: FoldLabelFormatter;
}

export interface FoldDistributionSegmentOptions {
  colorMode: GlobalColorConfig['mode'];
  y?: number[];
  yBins: FoldDistributionYBin[];
  isClassificationMode: boolean;
  classLabels: string[];
  outlierIndices?: Set<number>;
  selectedSamples: Set<number>;
  metadataKey?: string;
  metadata?: Record<string, unknown[]>;
  metadataCategories: unknown[];
}

export interface BuildFoldDistributionPartitionBarsInput {
  folds: FoldsInfo | null;
  y?: number[];
  displayFilteredIndices?: Set<number>;
  segmentOptions: FoldDistributionSegmentOptions;
}

export function buildFoldDistributionYStatsData(
  folds: FoldsInfo | null | undefined,
  options: FoldLabelOptions = {},
): FoldDistributionYStatsData[] {
  if (!folds?.folds) return [];

  const formatLabel = options.formatFoldLabel ?? formatDefaultFoldDistributionLabel;

  return folds.folds
    .filter((fold): fold is typeof fold & { y_train_stats: YStats; y_test_stats: YStats } => {
      return Boolean(fold.y_train_stats && fold.y_test_stats);
    })
    .map((fold) => {
      const trainStats = fold.y_train_stats;
      const testStats = fold.y_test_stats;

      return {
        fold: formatLabel(fold.fold_index),
        foldIndex: fold.fold_index,
        trainMean: trainStats.mean,
        trainStd: trainStats.std,
        trainMin: trainStats.min,
        trainMax: trainStats.max,
        testMean: testStats.mean,
        testStd: testStats.std,
        testMin: testStats.min,
        testMax: testStats.max,
        trainLower: trainStats.std,
        trainUpper: trainStats.std,
        testLower: testStats.std,
        testUpper: testStats.std,
      };
    });
}

export function getFoldDistributionTargetRange(y: number[] | undefined): FoldDistributionTargetRange {
  if (!y || y.length === 0) return { min: 0, max: 1 };

  return y.reduce<FoldDistributionTargetRange>(
    (range, value) => ({
      min: Math.min(range.min, value),
      max: Math.max(range.max, value),
    }),
    { min: y[0], max: y[0] },
  );
}

export function getFoldDistributionTargetMean(y: number[] | undefined): number | null {
  if (!y || y.length === 0) return null;
  return y.reduce((sum, value) => sum + value, 0) / y.length;
}

export function buildFoldDistributionExportRows(
  folds: FoldsInfo | null | undefined,
  options: FoldLabelOptions = {},
): FoldDistributionExportRow[] {
  if (!folds?.folds) return [];

  const formatLabel = options.formatFoldLabel ?? formatDefaultFoldDistributionLabel;

  return folds.folds.map(fold => {
    const row: FoldDistributionExportRow = {
      fold: formatLabel(fold.fold_index),
      train_count: fold.train_count,
      test_count: fold.test_count,
    };

    if (fold.y_train_stats) {
      row.train_y_mean = fold.y_train_stats.mean;
      row.train_y_std = fold.y_train_stats.std;
    }
    if (fold.y_test_stats) {
      row.test_y_mean = fold.y_test_stats.mean;
      row.test_y_std = fold.y_test_stats.std;
    }

    return row;
  });
}

export function buildFoldDistributionMetadataCategories(
  metadata: Record<string, unknown[]> | undefined,
  metadataKey: string | undefined,
  limit = 10
): unknown[] {
  if (!metadataKey || !metadata) return [];

  const values = metadata[metadataKey];
  if (!values) return [];

  return [...new Set(values.filter(value => value !== null && value !== undefined))].slice(0, limit);
}

export function computeFoldDistributionSegments(
  indices: number[],
  {
    colorMode,
    y,
    yBins,
    isClassificationMode,
    classLabels,
    outlierIndices,
    selectedSamples,
    metadataKey,
    metadata,
    metadataCategories,
  }: FoldDistributionSegmentOptions
): SegmentResult {
  const counts: Record<string, number> = {};
  const segmentIndices: Record<string, number[]> = {};
  const total = indices.length;

  switch (colorMode) {
    case 'partition':
    case 'fold':
      counts.total = total;
      segmentIndices.total = [...indices];
      break;

    case 'target':
      if (isClassificationMode && classLabels.length > 0 && y) {
        classLabels.forEach((label, index) => {
          const key = `class_${index}`;
          const matching = indices.filter(sampleIndex => {
            const yValue = y[sampleIndex];
            return yValue !== undefined && String(yValue) === label;
          });
          counts[key] = matching.length;
          segmentIndices[key] = matching;
        });
      } else if (y && yBins.length > 0) {
        yBins.forEach((_, index) => {
          const key = `bin_${index}`;
          const matching = indices.filter(sampleIndex => {
            const yValue = y[sampleIndex];
            return yValue !== undefined && getFoldDistributionBinIndex(yValue, yBins) === index;
          });
          counts[key] = matching.length;
          segmentIndices[key] = matching;
        });
      } else {
        counts.total = total;
        segmentIndices.total = [...indices];
      }
      break;

    case 'outlier':
      if (outlierIndices) {
        const outliers = indices.filter(sampleIndex => outlierIndices.has(sampleIndex));
        const normals = indices.filter(sampleIndex => !outlierIndices.has(sampleIndex));
        counts.outlier = outliers.length;
        counts.normal = normals.length;
        segmentIndices.outlier = outliers;
        segmentIndices.normal = normals;
      } else {
        counts.normal = total;
        segmentIndices.normal = [...indices];
      }
      break;

    case 'selection': {
      const selected = indices.filter(sampleIndex => selectedSamples.has(sampleIndex));
      const unselected = indices.filter(sampleIndex => !selectedSamples.has(sampleIndex));
      counts.selected = selected.length;
      counts.unselected = unselected.length;
      segmentIndices.selected = selected;
      segmentIndices.unselected = unselected;
      break;
    }

    case 'metadata':
      if (metadataKey && metadata) {
        const values = metadata[metadataKey];
        if (values) {
          const uncategorized: number[] = [];
          metadataCategories.forEach((category, index) => {
            const key = `meta_${index}`;
            const matching = indices.filter(sampleIndex => values[sampleIndex] === category);
            counts[key] = matching.length;
            segmentIndices[key] = matching;
          });

          const categorizedSet = new Set(metadataCategories);
          indices.forEach(sampleIndex => {
            if (!categorizedSet.has(values[sampleIndex])) {
              uncategorized.push(sampleIndex);
            }
          });
          if (uncategorized.length > 0) {
            counts.other = uncategorized.length;
            segmentIndices.other = uncategorized;
          }
        }
      } else {
        counts.total = total;
        segmentIndices.total = [...indices];
      }
      break;

    default:
      counts.total = total;
      segmentIndices.total = [...indices];
  }

  return { counts, indices: segmentIndices };
}

export function buildFoldDistributionPartitionBars({
  folds,
  y,
  displayFilteredIndices,
  segmentOptions,
}: BuildFoldDistributionPartitionBarsInput): PartitionBarData[] {
  if (!folds || !folds.folds || folds.folds.length === 0) return [];

  const bars: Array<Omit<PartitionBarData, 'index'>> = [];
  const filterIndices = (indices: number[]): number[] => {
    if (!displayFilteredIndices) return indices;
    return indices.filter(index => displayFilteredIndices.has(index));
  };
  const heldOutTestIndices = getHeldOutFoldTestIndices(folds, y);

  if (folds.n_folds === 1) {
    const fold = folds.folds[0];
    const filteredTrainIndices = filterIndices(fold.train_indices);
    const filteredTestIndices = filterIndices(fold.test_indices);
    const trainSegments = computeFoldDistributionSegments(filteredTrainIndices, segmentOptions);
    const testSegments = computeFoldDistributionSegments(filteredTestIndices, segmentOptions);

    bars.push({
      label: 'Train',
      partitionId: 'train-0',
      partitionType: 'train',
      foldIndex: 0,
      count: filteredTrainIndices.length,
      indices: filteredTrainIndices,
      yMean: fold.y_train_stats?.mean,
      yStd: fold.y_train_stats?.std,
      segments: trainSegments.counts,
      segmentIndices: trainSegments.indices,
    });
    bars.push({
      label: 'Test',
      partitionId: 'test-0',
      partitionType: 'test',
      foldIndex: 0,
      count: filteredTestIndices.length,
      indices: filteredTestIndices,
      yMean: fold.y_test_stats?.mean,
      yStd: fold.y_test_stats?.std,
      segments: testSegments.counts,
      segmentIndices: testSegments.indices,
    });

    return addPartitionBarIndices(bars);
  }

  folds.folds.forEach((fold, index) => {
    const foldNumber = index + 1;
    const filteredTrainIndices = filterIndices(fold.train_indices);
    const filteredTestIndices = filterIndices(fold.test_indices);
    const trainSegments = computeFoldDistributionSegments(filteredTrainIndices, segmentOptions);
    const valSegments = computeFoldDistributionSegments(filteredTestIndices, segmentOptions);

    bars.push({
      label: `Train ${foldNumber}`,
      partitionId: `train-${index}`,
      partitionType: 'train',
      foldIndex: index,
      count: filteredTrainIndices.length,
      indices: filteredTrainIndices,
      yMean: fold.y_train_stats?.mean,
      yStd: fold.y_train_stats?.std,
      segments: trainSegments.counts,
      segmentIndices: trainSegments.indices,
    });
    bars.push({
      label: `Val ${foldNumber}`,
      partitionId: `val-${index}`,
      partitionType: 'val',
      foldIndex: index,
      count: filteredTestIndices.length,
      indices: filteredTestIndices,
      yMean: fold.y_test_stats?.mean,
      yStd: fold.y_test_stats?.std,
      segments: valSegments.counts,
      segmentIndices: valSegments.indices,
    });
  });

  const filteredHeldOutIndices = filterIndices(heldOutTestIndices);
  if (filteredHeldOutIndices.length > 0) {
    const heldOutStats = computeYStatsForIndices(y, filteredHeldOutIndices);
    const heldOutSegments = computeFoldDistributionSegments(filteredHeldOutIndices, segmentOptions);

    bars.push({
      label: 'Test',
      partitionId: 'test-holdout',
      partitionType: 'test',
      foldIndex: null,
      count: filteredHeldOutIndices.length,
      indices: filteredHeldOutIndices,
      yMean: heldOutStats.mean,
      yStd: heldOutStats.std,
      segments: heldOutSegments.counts,
      segmentIndices: heldOutSegments.indices,
    });
  }

  return addPartitionBarIndices(bars);
}

export function buildFoldDistributionSegmentKeys({
  colorMode,
  yBins,
  isClassificationMode,
  classLabels,
  metadataCategories,
}: Pick<FoldDistributionSegmentOptions, 'colorMode' | 'yBins' | 'isClassificationMode' | 'classLabels' | 'metadataCategories'>): string[] {
  switch (colorMode) {
    case 'partition':
    case 'fold':
      return ['total'];
    case 'target':
      if (isClassificationMode && classLabels.length > 0) {
        return classLabels.map((_, index) => `class_${index}`);
      }
      return yBins.map((_, index) => `bin_${index}`);
    case 'outlier':
      return ['normal', 'outlier'];
    case 'selection':
      return ['unselected', 'selected'];
    case 'metadata':
      return [...metadataCategories.map((_, index) => `meta_${index}`), 'other'];
    default:
      return ['total'];
  }
}

export function getCombinedGroupingNote(
  folds: Pick<FoldsInfo, 'n_folds' | 'repetition_column' | 'group_by' | 'effective_group_mode' | 'effective_group_label'> | null,
  colorMode: GlobalColorConfig['mode'] | undefined,
  metadataKey?: string,
): string | null {
  if (!folds || folds.effective_group_mode !== 'combined') {
    return null;
  }
  if (colorMode !== 'metadata' || !metadataKey || !folds.group_by || metadataKey !== folds.group_by) {
    return null;
  }

  const effectiveLabel = folds.effective_group_label ?? folds.group_by;
  return `Splits enforce combined constraints (${effectiveLabel}). Samples sharing either the dataset repetition or ${folds.group_by} stay in the same fold.`;
}

function getFoldDistributionBinIndex(value: number, bins: FoldDistributionYBin[]): number {
  if (bins.length === 0) return 0;

  const min = bins[0].min;
  const max = bins[bins.length - 1].max;
  const binWidth = (max - min) / bins.length;

  let binIndex = Math.floor((value - min) / binWidth);
  if (binIndex >= bins.length) binIndex = bins.length - 1;
  if (binIndex < 0) binIndex = 0;

  return binIndex;
}

function getHeldOutFoldTestIndices(folds: FoldsInfo, y?: number[]): number[] {
  const heldOutFromLabels: number[] = [];
  if (folds.fold_labels && folds.fold_labels.length > 0) {
    folds.fold_labels.forEach((label, index) => {
      if (label === -1) {
        heldOutFromLabels.push(index);
      }
    });
  }

  const allFoldIndices = new Set<number>();
  folds.folds.forEach(fold => {
    fold.train_indices.forEach(index => allFoldIndices.add(index));
    fold.test_indices.forEach(index => allFoldIndices.add(index));
  });

  const maxFoldIndex = Math.max(...folds.folds.flatMap(fold => [...fold.train_indices, ...fold.test_indices]));
  const totalSamples = folds.fold_labels?.length ?? y?.length ?? maxFoldIndex + 1;
  const heldOutFromIndices: number[] = [];
  for (let index = 0; index < totalSamples; index++) {
    if (!allFoldIndices.has(index)) {
      heldOutFromIndices.push(index);
    }
  }

  return heldOutFromLabels.length > 0 ? heldOutFromLabels : heldOutFromIndices;
}

function computeYStatsForIndices(y: number[] | undefined, indices: number[]): { mean?: number; std?: number } {
  if (!y || y.length === 0) return {};

  const values = indices.map(index => y[index]).filter(value => value !== undefined);
  if (values.length === 0) return {};

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length;

  return { mean, std: Math.sqrt(variance) };
}

function addPartitionBarIndices(bars: Array<Omit<PartitionBarData, 'index'>>): PartitionBarData[] {
  return bars.map((bar, index) => ({ ...bar, index }));
}

function formatDefaultFoldDistributionLabel(foldIndex: number): string {
  return `Fold ${foldIndex + 1}`;
}
