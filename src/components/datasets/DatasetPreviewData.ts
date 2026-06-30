import type {
  Dataset,
  PartitionKey,
  PartitionedSpectraPreview,
  PartitionedTargetDistribution,
  PreviewDataResponse,
  SpectraPreview,
  TargetDistribution,
} from "@/types/datasets";

export interface DatasetPreviewSampleMetadata {
  totalCount: number | undefined;
  trainCount: number | undefined;
  testCount: number | undefined;
  sourceCount: number;
}

export function getPreviewSampleMetadata({
  dataset,
  preview,
  defaultSourceCount = 1,
}: {
  dataset?: Partial<Pick<Dataset, "num_samples" | "n_sources" | "train_samples" | "test_samples">> | null;
  preview?: Pick<PreviewDataResponse, "summary"> | null;
  defaultSourceCount?: number;
}): DatasetPreviewSampleMetadata {
  return {
    totalCount: dataset?.num_samples ?? preview?.summary?.num_samples,
    trainCount: preview?.summary?.train_samples ?? dataset?.train_samples,
    testCount: preview?.summary?.test_samples ?? dataset?.test_samples,
    sourceCount: dataset?.n_sources ?? preview?.summary?.n_sources ?? defaultSourceCount,
  };
}

export function hasPartitionTestData<T>(
  partitionMap: Partial<Record<PartitionKey, T>> | undefined,
  testCount: number | null | undefined,
): boolean {
  return Boolean(partitionMap?.test) || (testCount != null && testCount > 0);
}

export function hasSpectraTestPartition(
  preview:
    | Pick<PreviewDataResponse, "spectra_preview_by_partition" | "spectra_per_source_by_partition">
    | null
    | undefined,
  testCount: number | null | undefined,
): boolean {
  return (
    hasPartitionTestData(preview?.spectra_preview_by_partition, testCount) ||
    Object.values(preview?.spectra_per_source_by_partition ?? {}).some((sourceMap) =>
      Boolean(sourceMap.test),
    )
  );
}

export function hasTargetDistributionTestPartition(
  partitionDistribution: PartitionedTargetDistribution | undefined,
  testCount: number | null | undefined,
): boolean {
  return hasPartitionTestData(partitionDistribution, testCount);
}

export function hasDatasetPreviewTestPartition(
  preview:
    | Pick<
        PreviewDataResponse,
        "spectra_preview_by_partition" | "spectra_per_source_by_partition" | "target_distribution_by_partition"
      >
    | null
    | undefined,
  testCount: number | null | undefined,
): boolean {
  return (
    hasSpectraTestPartition(preview, testCount) ||
    hasTargetDistributionTestPartition(preview?.target_distribution_by_partition, testCount)
  );
}

export function getEffectivePreviewPartition(
  partition: PartitionKey,
  hasTest: boolean,
): PartitionKey {
  return !hasTest && partition !== "train" ? "train" : partition;
}

export function selectPartitionPreview<T>(
  partitionMap: Partial<Record<PartitionKey, T>> | undefined,
  effectivePartition: PartitionKey,
  fallback: T | undefined,
): T | undefined {
  return partitionMap?.[effectivePartition] ?? partitionMap?.train ?? fallback;
}

export function hasPerSourceSpectraPreview(
  preview:
    | Pick<PreviewDataResponse, "summary" | "spectra_per_source" | "spectra_per_source_by_partition">
    | null
    | undefined,
): boolean {
  return (
    (preview?.summary?.n_sources ?? 0) > 1 &&
    (Boolean(preview?.spectra_per_source) || Boolean(preview?.spectra_per_source_by_partition))
  );
}

export function selectDatasetSpectraPreview(
  preview: PreviewDataResponse | null | undefined,
  selectedSource: number,
  effectivePartition: PartitionKey,
): SpectraPreview | undefined {
  if (!preview) return undefined;

  const globalSpectra = selectPartitionPreview(
    preview.spectra_preview_by_partition,
    effectivePartition,
    preview.spectra_preview,
  );

  if (!hasPerSourceSpectraPreview(preview)) return globalSpectra;

  const sourceMap: PartitionedSpectraPreview | undefined =
    preview.spectra_per_source_by_partition?.[selectedSource];
  const sourceFallback = preview.spectra_per_source?.[selectedSource];

  if (!sourceMap && !sourceFallback) return globalSpectra;
  return selectPartitionPreview(sourceMap, effectivePartition, sourceFallback ?? globalSpectra);
}

export function selectDatasetTargetDistribution(
  preview:
    | Pick<PreviewDataResponse, "target_distribution" | "target_distribution_by_partition">
    | null
    | undefined,
  effectivePartition: PartitionKey,
): TargetDistribution | undefined {
  return selectPartitionPreview(
    preview?.target_distribution_by_partition,
    effectivePartition,
    preview?.target_distribution,
  );
}

export function getPreviewPartitionSampleCount({
  distribution,
  effectivePartition,
  trainCount,
  testCount,
  totalCount,
}: {
  distribution: TargetDistribution | undefined;
  effectivePartition: PartitionKey;
  trainCount: number | null | undefined;
  testCount: number | null | undefined;
  totalCount: number | null | undefined;
}): number | null | undefined {
  if (distribution?.n_samples != null) return distribution.n_samples;
  if (effectivePartition === "test") return testCount;
  if (effectivePartition === "train") return trainCount;

  const combinedPartitionCount = (trainCount ?? 0) + (testCount ?? 0);
  return combinedPartitionCount || totalCount;
}

export interface DatasetSpectraPreviewReadModel {
  trainCount: number | undefined;
  testCount: number | undefined;
  sourceCount: number;
  hasTest: boolean;
  hasPerSource: boolean;
  effectivePartition: PartitionKey;
  spectra: SpectraPreview | undefined;
  spectraSampleCount: number;
}

export function getDatasetSpectraPreviewReadModel(
  preview: PreviewDataResponse | null | undefined,
  selectedPartition: PartitionKey,
  selectedSource: number,
): DatasetSpectraPreviewReadModel {
  const { trainCount, testCount, totalCount, sourceCount } = getPreviewSampleMetadata({
    preview,
  });
  const hasTest = hasSpectraTestPartition(preview, testCount);
  const effectivePartition = getEffectivePreviewPartition(selectedPartition, hasTest);
  const spectra = selectDatasetSpectraPreview(preview, selectedSource, effectivePartition);

  return {
    trainCount,
    testCount,
    sourceCount,
    hasTest,
    hasPerSource: hasPerSourceSpectraPreview(preview),
    effectivePartition,
    spectra,
    spectraSampleCount: spectra?.n_samples ?? totalCount ?? 0,
  };
}
