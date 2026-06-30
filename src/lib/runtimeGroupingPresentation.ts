import type { DatasetRuntimeGroupingState } from "./runtimeSplitGrouping";

export type RuntimeGroupingRequirementBadgeVariant = "destructive" | "outline";

export interface RuntimeGroupingRequirementBadge {
  label: string;
  variant: RuntimeGroupingRequirementBadgeVariant;
}

export const runtimeGroupingPresentationCopy = {
  title: "Runtime Grouping",
  selectPlaceholder: "Select metadata column...",
  noAdditionalGroupLabel: "No additional group",
  datasetRepetitionBadge: "Dataset repetition",
  noMetadataColumns: "No metadata columns are available on this dataset.",
} as const;

export function formatRuntimeGroupingSelectedDatasetCount(count: number): string {
  return `${count} dataset${count === 1 ? "" : "s"}`;
}

export function formatRuntimeGroupingMetadataColumnCount(count: number): string {
  return `${count} metadata column${count === 1 ? "" : "s"}`;
}

export function getRuntimeGroupingRequirementBadge(
  groupingState: DatasetRuntimeGroupingState,
  hasRequiredSplitters: boolean,
): RuntimeGroupingRequirementBadge {
  if (groupingState.requiresExplicitGroup) {
    return { label: "Required", variant: "destructive" };
  }

  if (hasRequiredSplitters) {
    return { label: "Optional with repetition", variant: "outline" };
  }

  return { label: "Optional", variant: "outline" };
}
