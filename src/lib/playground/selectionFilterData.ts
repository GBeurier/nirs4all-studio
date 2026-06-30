import type { FoldData, FoldsInfo } from '@/types/playground';

export interface SelectionMetadataColumn {
  key: string;
  uniqueValues: string[];
  totalValues: number;
}

export interface SelectionFilterData {
  uniqueFolds: number[];
  metadataColumns: SelectionMetadataColumn[];
  currentFoldData: FoldData | null;
  hasFoldSelection: boolean;
  hasSelectionOptions: boolean;
}

export function buildSelectionFilterData({
  folds,
  metadata,
}: {
  folds?: FoldsInfo | null;
  metadata?: Record<string, unknown[]>;
}): SelectionFilterData {
  const uniqueFolds = folds?.fold_labels
    ? [...new Set(folds.fold_labels.filter((fold) => fold >= 0))].sort((a, b) => a - b)
    : [];

  const metadataColumns = metadata
    ? Object.entries(metadata)
        .map(([key, values]) => {
          const uniqueRawValues = [...new Set(values)];
          const uniqueValues = uniqueRawValues.map((value) => String(value)).slice(0, 100);
          return { key, uniqueValues, totalValues: uniqueRawValues.length };
        })
        .filter((column) => column.uniqueValues.length > 1 && column.uniqueValues.length <= 50)
    : [];

  const foldIndex = folds?.split_index ?? 0;
  const currentFoldData = folds?.folds?.[foldIndex] ?? folds?.folds?.[0] ?? null;
  const hasFoldSelection = uniqueFolds.length > 0 || Boolean(currentFoldData);

  return {
    uniqueFolds,
    metadataColumns,
    currentFoldData,
    hasFoldSelection,
    hasSelectionOptions: hasFoldSelection || metadataColumns.length > 0,
  };
}

export function getSamplesByFold(folds: FoldsInfo | null | undefined, foldIndex: number): number[] {
  if (!folds?.fold_labels) return [];
  return folds.fold_labels
    .map((fold, sampleIndex) => fold === foldIndex ? sampleIndex : -1)
    .filter((sampleIndex) => sampleIndex >= 0);
}

export function getSamplesByPartition(
  currentFoldData: FoldData | null,
  partition: 'train' | 'test',
): number[] {
  if (!currentFoldData) return [];
  return partition === 'train'
    ? currentFoldData.train_indices
    : currentFoldData.test_indices;
}

export function getSamplesByMetadata(
  metadata: Record<string, unknown[]> | undefined,
  column: string,
  value: string,
): number[] {
  const values = metadata?.[column];
  if (!values) return [];
  return values
    .map((entry, sampleIndex) => String(entry) === value ? sampleIndex : -1)
    .filter((sampleIndex) => sampleIndex >= 0);
}

export function getSelectionFilterCount({
  type,
  value,
  folds,
  currentFoldData,
  metadata,
}: {
  type: string;
  value: string | number;
  folds?: FoldsInfo | null;
  currentFoldData: FoldData | null;
  metadata?: Record<string, unknown[]>;
}): number {
  if (type === 'fold' && folds?.fold_labels) {
    return folds.fold_labels.filter((fold) => fold === value).length;
  }
  if (type === 'partition' && currentFoldData) {
    return value === 'train'
      ? currentFoldData.train_indices.length
      : currentFoldData.test_indices.length;
  }
  if (metadata?.[type]) {
    return metadata[type].filter((entry) => String(entry) === String(value)).length;
  }
  return 0;
}
