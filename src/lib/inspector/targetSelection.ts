import {
  getResultAnalysisMetadata,
  getResultAnalysisMetadataDimension,
  normalizedResultAnalysisString,
} from "@/lib/inspector/resultAnalysisDimensions";
import type { InspectorAvailableTarget, InspectorChainSummary } from "@/types/inspector";

export interface InspectorTargetOption {
  value: string;
  index: number;
  label: string;
  count: number;
  targetNames: string[];
}

interface TargetBucket {
  index: number;
  count: number;
  names: Set<string>;
}

function coerceTargetIndex(value: unknown): number | null {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim().length > 0
      ? Number(value)
      : NaN;
  if (!Number.isInteger(numeric) || numeric < 0) return null;
  return numeric;
}

function formatTargetLabel(index: number, targetNames: readonly string[]): string {
  const fallbackLabel = `Target ${index + 1}`;
  if (targetNames.length === 0) return fallbackLabel;
  if (targetNames.length === 1) return `${targetNames[0]} (${fallbackLabel})`;
  return `${fallbackLabel} (${targetNames.length} names)`;
}

function normalizeAvailableTarget(target: InspectorAvailableTarget): InspectorTargetOption | null {
  const index = coerceTargetIndex(target.index);
  if (index == null) return null;
  const targetNames = Array.isArray(target.target_names)
    ? [...new Set(target.target_names.map(name => normalizedResultAnalysisString(name)).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right))
    : [];
  const label = normalizedResultAnalysisString(target.label) || formatTargetLabel(index, targetNames);
  return {
    value: String(index),
    index,
    label,
    count: Math.max(0, Math.floor(Number(target.count) || 0)),
    targetNames,
  };
}

export function buildInspectorTargetOptions(
  chains: readonly InspectorChainSummary[],
  selectedTargetIndex = 0,
  availableTargets: readonly InspectorAvailableTarget[] = [],
): InspectorTargetOption[] {
  if (availableTargets.length > 0) {
    const optionsByIndex = new Map<number, InspectorTargetOption>();
    for (const target of availableTargets) {
      const option = normalizeAvailableTarget(target);
      if (option) {
        optionsByIndex.set(option.index, option);
      }
    }

    const selectedIndex = Math.max(0, Math.floor(selectedTargetIndex));
    if (!optionsByIndex.has(selectedIndex)) {
      optionsByIndex.set(selectedIndex, {
        value: String(selectedIndex),
        index: selectedIndex,
        label: `Target ${selectedIndex + 1}`,
        count: 0,
        targetNames: [],
      });
    }

    return [...optionsByIndex.values()].sort((left, right) => left.index - right.index);
  }

  const buckets = new Map<number, TargetBucket>();

  for (const chain of chains) {
    const metadata = getResultAnalysisMetadata(chain);
    const metadataTargetIndex = (metadata as Record<string, unknown>).target_index;
    const dimensionTargetIndex = getResultAnalysisMetadataDimension(metadata, "target_index");
    const targetName = normalizedResultAnalysisString(metadata.target_name);
    const index = coerceTargetIndex(dimensionTargetIndex)
      ?? coerceTargetIndex(metadataTargetIndex)
      ?? (targetName.length > 0 ? 0 : null);
    if (index == null) continue;

    const bucket = buckets.get(index) ?? {
      index,
      count: 0,
      names: new Set<string>(),
    };
    bucket.count += 1;
    if (targetName.length > 0) {
      bucket.names.add(targetName);
    }
    buckets.set(index, bucket);
  }

  const selectedIndex = Math.max(0, Math.floor(selectedTargetIndex));
  if (!buckets.has(selectedIndex)) {
    buckets.set(selectedIndex, {
      index: selectedIndex,
      count: 0,
      names: new Set<string>(),
    });
  }

  const options = [...buckets.values()]
    .sort((left, right) => left.index - right.index)
    .map((bucket) => {
      const targetNames = [...bucket.names].sort((left, right) => left.localeCompare(right));
      return {
        value: String(bucket.index),
        index: bucket.index,
        label: formatTargetLabel(bucket.index, targetNames),
        count: bucket.count,
        targetNames,
      };
    });

  return options.length > 0
    ? options
    : [{
      value: "0",
      index: 0,
      label: "Target 1",
      count: 0,
      targetNames: [],
    }];
}
