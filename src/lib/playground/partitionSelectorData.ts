import type { FoldsInfo } from '@/types/playground';

import {
  calculatePartitionCounts,
  getPartitionLabel,
  type PartitionCounts,
  type PartitionFilter,
} from './partitionFilters';

export interface BasicPartitionOption {
  value: Extract<PartitionFilter, 'all' | 'train' | 'test'>;
  label: string;
  count: number;
}

export interface OofPartitionOption {
  value: Extract<PartitionFilter, 'oof'>;
  label: string;
  count: number;
}

export interface FoldPartitionOption {
  value: `fold-${number}`;
  label: string;
  foldIndex: number;
  trainCount: number;
  testCount: number;
}

export interface PartitionSelectorData {
  counts: PartitionCounts;
  hasFolds: boolean;
  isKFold: boolean;
  emptyLabel: string;
  triggerLabel: string;
  currentCount: number;
  showCurrentCount: boolean;
  basicOptions: BasicPartitionOption[];
  oofOption: OofPartitionOption | null;
  foldOptions: FoldPartitionOption[];
}

export function getPartitionCurrentCount(
  value: PartitionFilter,
  counts: PartitionCounts,
): number {
  switch (value) {
    case 'all':
      return counts.all;
    case 'train':
      return counts.train;
    case 'test':
      return counts.test;
    case 'train-test':
      return counts.train;
    case 'oof':
      return counts.oof;
    default: {
      const match = value.match(/^fold-(\d+)$/);
      if (match) {
        const foldIndex = parseInt(match[1], 10);
        return counts.folds[foldIndex]?.total ?? 0;
      }
      return counts.all;
    }
  }
}

export function buildPartitionSelectorData({
  value,
  folds,
  totalSamples,
  compact,
}: {
  value: PartitionFilter;
  folds: FoldsInfo | null;
  totalSamples: number;
  compact: boolean;
}): PartitionSelectorData {
  const counts = calculatePartitionCounts(folds, totalSamples);
  const hasFolds = Boolean(folds && folds.n_folds > 0);
  const isKFold = Boolean(hasFolds && folds && folds.n_folds > 1);

  return {
    counts,
    hasFolds,
    isKFold,
    emptyLabel: compact ? 'All' : 'All Samples',
    triggerLabel: getPartitionLabel(value),
    currentCount: getPartitionCurrentCount(value, counts),
    showCurrentCount: !compact && value !== 'all',
    basicOptions: [
      { value: 'all', label: 'All Samples', count: counts.all },
      { value: 'train', label: 'Train', count: counts.train },
      { value: 'test', label: 'Test', count: counts.test },
    ],
    oofOption: isKFold
      ? { value: 'oof', label: 'OOF (All Test)', count: counts.oof }
      : null,
    foldOptions: folds?.folds?.map((fold) => ({
      value: `fold-${fold.fold_index}` as const,
      label: `Fold ${fold.fold_index + 1}`,
      foldIndex: fold.fold_index,
      trainCount: fold.train_count,
      testCount: fold.test_count,
    })) ?? [],
  };
}
