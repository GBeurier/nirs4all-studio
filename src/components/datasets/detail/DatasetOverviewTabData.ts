import type {
  Dataset,
  PartitionKey,
  PartitionedTargetDistribution,
  PreviewDataResponse,
  TargetDistribution,
} from "@/types/datasets";
import {
  getEffectivePreviewPartition,
  getPreviewPartitionSampleCount,
  getPreviewSampleMetadata,
  hasTargetDistributionTestPartition,
  selectDatasetTargetDistribution,
} from "../DatasetPreviewData";

const DAY_MS = 1000 * 60 * 60 * 24;

export interface DatasetOverviewSampleCounts {
  trainCount: number | undefined;
  testCount: number | undefined;
}

export function getRelativeTime(dateString: string, now = new Date()): string {
  const date = new Date(dateString);
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / DAY_MS);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

export function formatCount(value: number | null | undefined): string {
  if (value == null) return "--";
  return value.toLocaleString();
}

export function getDatasetOverviewSampleCounts(
  dataset: Pick<Dataset, "train_samples" | "test_samples">,
  preview: Pick<PreviewDataResponse, "summary"> | null,
): DatasetOverviewSampleCounts {
  const metadata = getPreviewSampleMetadata({ dataset, preview });

  return {
    trainCount: metadata.trainCount,
    testCount: metadata.testCount,
  };
}

export function hasTestPartition(
  partitionDistribution: PartitionedTargetDistribution | undefined,
  testCount: number | null | undefined,
): boolean {
  return hasTargetDistributionTestPartition(partitionDistribution, testCount);
}

export function getEffectivePartition(partition: PartitionKey, hasTest: boolean): PartitionKey {
  return getEffectivePreviewPartition(partition, hasTest);
}

export function getEffectiveTargetDistribution(
  preview: Pick<PreviewDataResponse, "target_distribution" | "target_distribution_by_partition"> | null,
  effectivePartition: PartitionKey,
): TargetDistribution | undefined {
  return selectDatasetTargetDistribution(preview, effectivePartition);
}

export function getPartitionSampleCount({
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
  return getPreviewPartitionSampleCount({
    distribution,
    effectivePartition,
    trainCount,
    testCount,
    totalCount,
  });
}
