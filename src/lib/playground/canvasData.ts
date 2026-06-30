import type { FoldsInfo, PlaygroundResult, SourcePartitions, YStats } from '@/types/playground';
import type { SpectralData } from '@/types/spectral';
import {
  getPlaygroundProjectionMetadataColumns,
  getPlaygroundProjectionTargetColumn,
  type PlaygroundDataViewProjection,
} from './dataViewProjection';
import {
  createClassLabelMap,
  detectTargetType,
  type TargetType,
} from '@/lib/playground/targetTypeDetection';
import { getColumnarMetadata } from '@/lib/playground/repetition';

export interface PlaygroundTargetView {
  yValues: number[];
  yMin: number;
  yMax: number;
  targetType?: TargetType;
  classLabels?: string[];
  classLabelMap?: Map<string, number>;
  targetColumn?: string | null;
}

export interface PartitionIndexSets {
  trainIndices?: Set<number>;
  testIndices?: Set<number>;
}

function getNumericRange(values: number[]): { yMin: number; yMax: number } {
  if (values.length === 0) {
    return { yMin: 0, yMax: 1 };
  }

  let yMin = values[0];
  let yMax = values[0];
  for (let i = 1; i < values.length; i++) {
    const value = values[i];
    if (value < yMin) yMin = value;
    if (value > yMax) yMax = value;
  }
  return { yMin, yMax };
}

function summarizeY(values: number[]): YStats | undefined {
  if (values.length === 0) {
    return undefined;
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const { yMin, yMax } = getNumericRange(values);
  return {
    mean,
    std: Math.sqrt(variance),
    min: yMin,
    max: yMax,
  };
}

export function getPlaygroundYValues(rawData: SpectralData | null, result: PlaygroundResult | null): number[] {
  if (result?.processed?.y && result.processed.y.length > 0) {
    return result.processed.y;
  }
  return rawData?.y ?? [];
}

export function buildPlaygroundTargetView(
  rawData: SpectralData | null,
  result: PlaygroundResult | null,
  dataView?: PlaygroundDataViewProjection | null,
): PlaygroundTargetView {
  const yValues = getPlaygroundYValues(rawData, result);
  const { yMin, yMax } = getNumericRange(yValues);
  const targetTypeResult = yValues.length > 0 ? detectTargetType(yValues) : null;
  const classLabels = targetTypeResult?.classLabels;

  return {
    yValues,
    yMin,
    yMax,
    targetType: targetTypeResult?.type,
    classLabels,
    classLabelMap: classLabels ? createClassLabelMap(classLabels) : undefined,
    targetColumn: getPlaygroundProjectionTargetColumn(dataView),
  };
}

export function getColumnarPlaygroundMetadata(
  rawData: SpectralData | null,
  result: PlaygroundResult | null
): Record<string, unknown[]> | undefined {
  if (result?.processed?.metadata && Object.keys(result.processed.metadata).length > 0) {
    return result.processed.metadata;
  }
  return getColumnarMetadata(rawData?.metadata);
}

export function getMetadataColumnNames(
  columnMetadata?: Record<string, unknown[]>,
  dataView?: PlaygroundDataViewProjection | null,
): string[] | undefined {
  if (columnMetadata) return Object.keys(columnMetadata);
  return getPlaygroundProjectionMetadataColumns(dataView);
}

export function hasPlaygroundPartition(result: PlaygroundResult | null): boolean {
  if (result?.source_partitions?.has_test) return true;
  if (result?.folds?.kind === 'test_split') return true;
  return false;
}

export function hasPlaygroundFolds(result: PlaygroundResult | null): boolean {
  const folds = result?.folds;
  if (!folds) return false;
  const distinctFoldLabels = new Set((folds.fold_labels ?? []).filter((label) => label >= 0));
  if (distinctFoldLabels.size > 1) return true;
  return folds.n_folds > 1;
}

export function buildEffectivePlaygroundFolds(
  result: PlaygroundResult | null,
  rawSampleCount: number,
  rawY: number[] = []
): FoldsInfo | null {
  if (result?.folds && result.folds.n_folds > 0) {
    const distinctFoldLabels = new Set((result.folds.fold_labels ?? []).filter((label) => label >= 0));

    if (result.folds.n_folds <= 1 || (result.folds.fold_labels && distinctFoldLabels.size > 1)) {
      return result.folds;
    }

    if (result.folds.n_folds > 1 && rawSampleCount > 0) {
      const synthesizedFoldLabels = Array.from({ length: rawSampleCount }, () => -1);
      result.folds.folds.forEach((fold) => {
        fold.test_indices.forEach((sampleIdx) => {
          if (sampleIdx >= 0 && sampleIdx < synthesizedFoldLabels.length) {
            synthesizedFoldLabels[sampleIdx] = fold.fold_index;
          }
        });
      });

      return {
        ...result.folds,
        fold_labels: synthesizedFoldLabels,
      };
    }

    return result.folds;
  }

  const sourcePartitions = result?.source_partitions;
  if (sourcePartitions?.has_test && sourcePartitions.n_train + sourcePartitions.n_test > 0) {
    const trainIndices = Array.from({ length: sourcePartitions.n_train }, (_, i) => i);
    const testIndices = Array.from(
      { length: sourcePartitions.n_test },
      (_, i) => sourcePartitions.n_train + i
    );
    const yTrain = trainIndices.map((index) => rawY[index]).filter((value) => value !== undefined);
    const yTest = testIndices.map((index) => rawY[index]).filter((value) => value !== undefined);

    return {
      splitter_name: 'Source Partition',
      n_folds: 1,
      folds: [{
        fold_index: 0,
        train_count: sourcePartitions.n_train,
        test_count: sourcePartitions.n_test,
        train_indices: trainIndices,
        test_indices: testIndices,
        y_train_stats: summarizeY(yTrain),
        y_test_stats: summarizeY(yTest),
      }],
      fold_labels: undefined,
    };
  }

  return null;
}

export function buildPartitionIndexSets(
  sourcePartitions: SourcePartitions | undefined,
  effectiveFolds: FoldsInfo | null
): PartitionIndexSets {
  if (sourcePartitions?.has_test && sourcePartitions.n_train + sourcePartitions.n_test > 0) {
    const trainIndices = new Set<number>();
    const testIndices = new Set<number>();
    for (let i = 0; i < sourcePartitions.n_train; i++) trainIndices.add(i);
    for (let i = 0; i < sourcePartitions.n_test; i++) testIndices.add(sourcePartitions.n_train + i);
    return { trainIndices, testIndices };
  }

  if (effectiveFolds?.folds && effectiveFolds.folds.length === 1) {
    const firstFold = effectiveFolds.folds[0];
    return {
      trainIndices: new Set(firstFold.train_indices ?? []),
      testIndices: new Set(firstFold.test_indices ?? []),
    };
  }

  const labels = effectiveFolds?.fold_labels;
  if (labels && labels.length > 0 && labels.some((label) => label === -1)) {
    const trainIndices = new Set<number>();
    const testIndices = new Set<number>();
    labels.forEach((label, idx) => {
      if (label === -1) testIndices.add(idx);
      else trainIndices.add(idx);
    });
    if (testIndices.size > 0) {
      return { trainIndices, testIndices };
    }
  }

  return { trainIndices: undefined, testIndices: undefined };
}
