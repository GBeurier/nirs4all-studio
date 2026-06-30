import type { MetricsResult, OutlierResult, SimilarityResult } from '@/types/playground';

export type DistanceMetric = 'euclidean' | 'cosine' | 'correlation';

export type OutlierMethod = 'hotelling_t2' | 'q_residual' | 'lof' | 'distance';

export interface SelectedReferenceInput {
  selectedSample?: number | null;
  selectedSamples?: Iterable<number>;
  selectedCount?: number;
}

export function getSelectedReferenceIndex({
  selectedSample,
  selectedSamples,
  selectedCount = 0,
}: SelectedReferenceInput): number | null {
  if (selectedSample !== null && selectedSample !== undefined) {
    return selectedSample;
  }

  if (selectedCount === 1 && selectedSamples) {
    const [sampleIndex] = Array.from(selectedSamples);
    return sampleIndex ?? null;
  }

  return null;
}

export function canUseSelectedReference(input: SelectedReferenceInput): boolean {
  return getSelectedReferenceIndex(input) !== null;
}

export function parseReferenceIndexInput(value: string, totalSamples: number): number | null {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) return null;

  const maxIndex = Math.max(0, totalSamples - 1);
  return Math.max(0, Math.min(parsed, maxIndex));
}

export function getReferenceSampleLabel(
  referenceIdx: number | null,
  sampleIds?: string[],
): string {
  if (referenceIdx === null) return 'Not selected';
  return sampleIds?.[referenceIdx] ?? `Sample ${referenceIdx}`;
}

export function getSimilaritySearchArgs({
  useTopK,
  threshold,
  topK,
}: {
  useTopK: boolean;
  threshold?: number;
  topK: number;
}): { threshold?: number; topK?: number } {
  return useTopK
    ? { topK }
    : { threshold };
}

export function getSimilaritySelectionIndices({
  result,
  referenceIdx,
  selectDifferent,
  totalSamples,
}: {
  result: SimilarityResult;
  referenceIdx: number;
  selectDifferent: boolean;
  totalSamples: number;
}): number[] {
  if (!result.success) return [];
  if (!selectDifferent) return result.similar_indices;

  const excludedIndices = new Set(result.similar_indices);
  excludedIndices.add(referenceIdx);

  return Array.from({ length: Math.max(0, totalSamples) }, (_, sampleIndex) => sampleIndex)
    .filter((sampleIndex) => !excludedIndices.has(sampleIndex));
}

const OUTLIER_METHOD_VALUE_KEYS: Record<OutlierMethod, string> = {
  hotelling_t2: 'hotelling_t2',
  q_residual: 'q_residual',
  lof: 'lof_score',
  distance: 'distance_to_centroid',
};

export function getOutlierPreviewValues(
  metrics: MetricsResult | null | undefined,
  method: OutlierMethod,
): number[] | undefined {
  return metrics?.values?.[OUTLIER_METHOD_VALUE_KEYS[method]];
}

export function getOutlierSelectionIndices({
  result,
  topKMode,
  topK,
  selectInliers,
}: {
  result: OutlierResult;
  topKMode: boolean;
  topK: number;
  selectInliers: boolean;
}): number[] {
  if (!result.success) return [];

  if (topKMode) {
    if (result.values) {
      return result.outlier_indices
        .map((index) => ({
          index,
          value: result.values?.[index] ?? Number.NEGATIVE_INFINITY,
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, topK)
        .map(({ index }) => index);
    }

    return result.outlier_indices.slice(0, topK);
  }

  if (selectInliers) {
    return result.inlier_mask
      .map((isInlier, sampleIndex) => isInlier ? sampleIndex : -1)
      .filter((sampleIndex) => sampleIndex >= 0);
  }

  return result.outlier_indices;
}
