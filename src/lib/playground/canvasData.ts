import type { FoldsInfo, PlaygroundResult, SourcePartitions, YStats } from '@/types/playground';
import type { SpectralData, TargetValue } from '@/types/spectral';
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
import { getObservedTargetRange, getObservedTargets } from '@/lib/playground/targetValues';

export interface PlaygroundTargetView {
  yValues: TargetValue[];
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

function summarizeY(values: number[]): YStats | undefined {
  const range = getObservedTargetRange(values);
  if (!range) {
    return undefined;
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return {
    mean,
    std: Math.sqrt(variance),
    min: range.min,
    max: range.max,
  };
}

export function getPlaygroundYValues(rawData: SpectralData | null, result: PlaygroundResult | null): TargetValue[] {
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
  // The colour scale and legend only span observed values; samples without a
  // target value stay in `yValues` (as `null`) so indices keep matching.
  const range = getObservedTargetRange(yValues) ?? { min: 0, max: 1 };
  const targetTypeResult = yValues.length > 0 ? detectTargetType(yValues) : null;
  const classLabels = targetTypeResult?.classLabels;

  return {
    yValues,
    yMin: range.min,
    yMax: range.max,
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
  rawY: TargetValue[] = []
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
    const yTrain = getObservedTargets(trainIndices.map((index) => rawY[index]));
    const yTest = getObservedTargets(testIndices.map((index) => rawY[index]));

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
