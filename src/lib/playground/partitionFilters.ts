import type { FoldsInfo } from '@/types/playground';

export type PartitionFilter =
  | 'all'
  | 'train'
  | 'test'
  | 'train-test'
  | 'oof'
  | `fold-${number}`;

export interface PartitionCounts {
  all: number;
  train: number;
  test: number;
  oof: number;
  folds: Record<number, { train: number; test: number; total: number }>;
}

function getFoldMembership(
  folds: FoldsInfo | null,
  totalSamples: number,
): {
  allTrainIndices: Set<number>;
  allTestIndices: Set<number>;
  allFoldIndices: Set<number>;
  heldOutTestIndices: number[];
} {
  const allTrainIndices = new Set<number>();
  const allTestIndices = new Set<number>();
  const allFoldIndices = new Set<number>();

  if (!folds || !folds.folds || folds.folds.length === 0) {
    return {
      allTrainIndices,
      allTestIndices,
      allFoldIndices,
      heldOutTestIndices: [],
    };
  }

  folds.folds.forEach((fold) => {
    fold.train_indices.forEach((sampleIndex) => {
      allTrainIndices.add(sampleIndex);
      allFoldIndices.add(sampleIndex);
    });
    fold.test_indices.forEach((sampleIndex) => {
      allTestIndices.add(sampleIndex);
      allFoldIndices.add(sampleIndex);
    });
  });

  const heldOutTestIndices: number[] = [];
  for (let sampleIndex = 0; sampleIndex < totalSamples; sampleIndex++) {
    if (!allFoldIndices.has(sampleIndex)) {
      heldOutTestIndices.push(sampleIndex);
    }
  }

  return {
    allTrainIndices,
    allTestIndices,
    allFoldIndices,
    heldOutTestIndices,
  };
}

export function calculatePartitionCounts(
  folds: FoldsInfo | null,
  totalSamples: number,
): PartitionCounts {
  const counts: PartitionCounts = {
    all: totalSamples,
    train: 0,
    test: 0,
    oof: 0,
    folds: {},
  };

  if (!folds || !folds.folds || folds.folds.length === 0) {
    return counts;
  }

  const {
    allTrainIndices,
    allTestIndices,
    allFoldIndices,
    heldOutTestIndices,
  } = getFoldMembership(folds, totalSamples);

  folds.folds.forEach((fold) => {
    counts.folds[fold.fold_index] = {
      train: fold.train_count,
      test: fold.test_count,
      total: fold.train_count + fold.test_count,
    };
  });

  if (folds.n_folds === 1) {
    counts.train = folds.folds[0].train_count;
    counts.test = folds.folds[0].test_count;
  } else {
    if (heldOutTestIndices.length > 0) {
      counts.train = allFoldIndices.size;
      counts.test = heldOutTestIndices.length;
    } else {
      counts.train = allTrainIndices.size;
      counts.test = allTestIndices.size;
    }
    counts.oof = allTestIndices.size;
  }

  return counts;
}

export function getPartitionIndices(
  partition: PartitionFilter,
  folds: FoldsInfo | null,
  totalSamples: number,
): number[] {
  if (!folds || !folds.folds || folds.folds.length === 0) {
    return Array.from({ length: totalSamples }, (_, sampleIndex) => sampleIndex);
  }

  const {
    allTrainIndices,
    allTestIndices,
    allFoldIndices,
    heldOutTestIndices,
  } = getFoldMembership(folds, totalSamples);

  switch (partition) {
    case 'all':
      return Array.from({ length: totalSamples }, (_, sampleIndex) => sampleIndex);

    case 'train': {
      if (folds.n_folds > 1 && heldOutTestIndices.length > 0) {
        return Array.from(allFoldIndices).sort((a, b) => a - b);
      }
      return Array.from(allTrainIndices).sort((a, b) => a - b);
    }

    case 'test': {
      if (folds.n_folds > 1 && heldOutTestIndices.length > 0) {
        return heldOutTestIndices;
      }
      return Array.from(allTestIndices).sort((a, b) => a - b);
    }

    case 'train-test': {
      const indices = new Set<number>(allFoldIndices);
      heldOutTestIndices.forEach((sampleIndex) => indices.add(sampleIndex));
      return Array.from(indices).sort((a, b) => a - b);
    }

    case 'oof':
      return Array.from(allTestIndices).sort((a, b) => a - b);

    default: {
      const match = partition.match(/^fold-(\d+)$/);
      if (match) {
        const foldIndex = parseInt(match[1], 10);
        const fold = folds.folds.find((candidate) => candidate.fold_index === foldIndex);
        if (fold) {
          const indices = new Set<number>([...fold.train_indices, ...fold.test_indices]);
          return Array.from(indices).sort((a, b) => a - b);
        }
      }
      return Array.from({ length: totalSamples }, (_, sampleIndex) => sampleIndex);
    }
  }
}

export function getPartitionLabel(partition: PartitionFilter): string {
  switch (partition) {
    case 'all':
      return 'All';
    case 'train':
      return 'Train';
    case 'test':
      return 'Test';
    case 'train-test':
      return 'Train/Test';
    case 'oof':
      return 'OOF';
    default: {
      const match = partition.match(/^fold-(\d+)$/);
      if (match) {
        return `Fold ${parseInt(match[1], 10) + 1}`;
      }
      return 'All';
    }
  }
}
