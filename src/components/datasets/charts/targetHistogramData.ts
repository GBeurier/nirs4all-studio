import type { TargetDistribution } from "@/types/datasets";

export interface HistogramData {
  /** Bin value or class name */
  bin: number | string;
  /** Count of samples in this bin */
  count: number;
}

export function buildTargetHistogramData(
  distribution:
    | Pick<TargetDistribution, "type" | "histogram" | "class_counts" | "classes">
    | null
    | undefined,
): HistogramData[] {
  if (!distribution) {
    return [];
  }

  if (distribution.histogram?.length) {
    return distribution.histogram.map(({ bin, count }) => ({ bin, count }));
  }

  if (distribution.type !== "classification" || !distribution.class_counts) {
    return [];
  }

  const orderedLabels = distribution.classes?.length
    ? Array.from(new Set([...distribution.classes, ...Object.keys(distribution.class_counts)]))
    : Object.keys(distribution.class_counts);

  return orderedLabels.map((label) => ({
    bin: label,
    count: distribution.class_counts?.[label] ?? 0,
  }));
}
