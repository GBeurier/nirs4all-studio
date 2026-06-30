import type {
  Dataset,
  PartitionKey,
  PartitionedTargetDistribution,
  PreviewDataResponse,
  TargetDistribution,
} from "@/types/datasets";
import {
  getEffectivePreviewPartition,
  getPreviewSampleMetadata,
  hasTargetDistributionTestPartition,
  selectDatasetTargetDistribution,
} from "../DatasetPreviewData";

export interface DatasetTargetSampleCounts {
  trainCount: number | undefined;
  testCount: number | undefined;
}

export interface RegressionRangeSummary {
  isVisible: boolean;
  label: string;
}

export function hasDatasetTargets(dataset: Pick<Dataset, "targets">): boolean {
  return Boolean(dataset.targets?.length);
}

export function getDatasetTargetSampleCounts(
  preview: Pick<PreviewDataResponse, "summary"> | null,
): DatasetTargetSampleCounts {
  const metadata = getPreviewSampleMetadata({ preview });

  return {
    trainCount: metadata.trainCount,
    testCount: metadata.testCount,
  };
}

export function hasTargetTestPartition(
  partitionDistribution: PartitionedTargetDistribution | undefined,
  testCount: number | null | undefined,
): boolean {
  return hasTargetDistributionTestPartition(partitionDistribution, testCount);
}

export function getEffectiveTargetPartition(partition: PartitionKey, hasTest: boolean): PartitionKey {
  return getEffectivePreviewPartition(partition, hasTest);
}

export function getEffectiveTargetDistribution(
  preview: Pick<PreviewDataResponse, "target_distribution" | "target_distribution_by_partition"> | null,
  effectivePartition: PartitionKey,
): TargetDistribution | undefined {
  return selectDatasetTargetDistribution(preview, effectivePartition);
}

export function formatTargetStatistic(value: number | null | undefined, digits = 3): string {
  return value == null || !Number.isFinite(value) ? "--" : value.toFixed(digits);
}

export function getClassCountTotal(classCounts: Record<string, number> | null | undefined): number {
  if (!classCounts) return 0;
  return Object.values(classCounts).reduce((total, count) => total + count, 0);
}

export function formatClassPercentage(
  count: number,
  classCounts: Record<string, number> | null | undefined,
): string {
  const total = getClassCountTotal(classCounts);
  if (total <= 0) return "0.0";
  return ((count / total) * 100).toFixed(1);
}

export function getRegressionThreeSigmaRange(
  distribution: Pick<TargetDistribution, "mean" | "std"> | null | undefined,
): RegressionRangeSummary {
  const mean = distribution?.mean;
  const std = distribution?.std;

  if (mean == null || std == null || !Number.isFinite(mean) || !Number.isFinite(std)) {
    return { isVisible: false, label: "" };
  }

  return {
    isVisible: true,
    label: `${(mean - 3 * std).toFixed(2)} to ${(mean + 3 * std).toFixed(2)}`,
  };
}
