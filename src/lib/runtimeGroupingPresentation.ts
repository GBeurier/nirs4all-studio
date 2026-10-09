import i18n from "i18next";

import type { DatasetRuntimeGroupingState } from "./runtimeSplitGrouping";

export type RuntimeGroupingRequirementBadgeVariant = "destructive" | "outline";

export interface RuntimeGroupingRequirementBadge {
  label: string;
  variant: RuntimeGroupingRequirementBadgeVariant;
}

/** User-visible runtime-grouping labels; getters resolve the active language at read time. */
export const runtimeGroupingPresentationCopy = {
  get title() { return i18n.t("newExperiment.steps.sampleGrouping"); },
  get selectPlaceholder() { return i18n.t("newExperiment.runtimeGrouping.selectPlaceholder"); },
  get noAdditionalGroupLabel() { return i18n.t("newExperiment.runtimeGrouping.summary.none"); },
  get datasetRepetitionBadge() { return i18n.t("newExperiment.runtimeGrouping.datasetRepetitionBadge"); },
  get noMetadataColumns() { return i18n.t("newExperiment.runtimeGrouping.noMetadataColumns"); },
};

export function formatRuntimeGroupingSelectedDatasetCount(count: number): string {
  return i18n.t("newExperiment.counts.dataset", { count });
}

export function formatRuntimeGroupingMetadataColumnCount(count: number): string {
  return i18n.t("newExperiment.counts.metadataColumn", { count });
}

export function getRuntimeGroupingRequirementBadge(
  groupingState: DatasetRuntimeGroupingState,
  hasRequiredSplitters: boolean,
): RuntimeGroupingRequirementBadge {
  if (groupingState.requiresExplicitGroup) {
    return { label: i18n.t("common.required"), variant: "destructive" };
  }

  if (hasRequiredSplitters) {
    if (groupingState.embeddedGroups) {
      return { label: i18n.t("newExperiment.runtimeGrouping.badges.usingCohortGroups"), variant: "outline" };
    }
    return { label: i18n.t("newExperiment.runtimeGrouping.badges.optionalWithRepetition"), variant: "outline" };
  }

  return { label: i18n.t("common.optional"), variant: "outline" };
}
