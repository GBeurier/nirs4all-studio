import type { TFunction } from "i18next";
import { runtimeGroupingPresentationCopy } from "@/lib/runtimeGroupingPresentation";
import {
  RUNTIME_GROUPING_COPY,
  getRuntimeGroupingOptionalPropagationWarning,
} from "@/lib/runtimeSplitGrouping";

/**
 * The runtime-grouping copy lives in shared lib modules (also used by the experiment wizard).
 * Map each known source text to its translation key and fall back to the source text.
 */
function getRuntimeGroupingCopyKeys(): Array<[string, string]> {
  return [
    [runtimeGroupingPresentationCopy.title, "title"],
    [runtimeGroupingPresentationCopy.selectPlaceholder, "selectPlaceholder"],
    [runtimeGroupingPresentationCopy.noAdditionalGroupLabel, "noAdditionalGroup"],
    [runtimeGroupingPresentationCopy.datasetRepetitionBadge, "datasetRepetition"],
    [runtimeGroupingPresentationCopy.noMetadataColumns, "noMetadataColumns"],
    [RUNTIME_GROUPING_COPY.additiveDescription, "additiveDescription"],
    [RUNTIME_GROUPING_COPY.conflictTitle, "conflictTitle"],
    [RUNTIME_GROUPING_COPY.conflictDescription, "conflictDescription"],
    [RUNTIME_GROUPING_COPY.conflictToast, "conflictToast"],
    [RUNTIME_GROUPING_COPY.legacyGroupDeprecation, "legacyGroupDeprecation"],
    [RUNTIME_GROUPING_COPY.requiredBlocking, "requiredBlocking"],
    [RUNTIME_GROUPING_COPY.noMetadataBlocking, "noMetadataBlocking"],
    [RUNTIME_GROUPING_COPY.noSplitterPipeline, "noSplitterPipeline"],
    [getRuntimeGroupingOptionalPropagationWarning(), "optionalPropagation"],
    ["Required", "required"],
    ["Using cohort groups", "usingCohortGroups"],
    ["Optional with repetition", "optionalWithRepetition"],
    ["Optional", "optional"],
  ];
}

export function localizeRuntimeGroupingCopy(t: TFunction, text: string): string;
export function localizeRuntimeGroupingCopy(t: TFunction, text: string | null | undefined): string | null | undefined;
export function localizeRuntimeGroupingCopy(t: TFunction, text: string | null | undefined): string | null | undefined {
  if (!text) {
    return text;
  }
  const match = getRuntimeGroupingCopyKeys().find(([source]) => source === text);
  return match ? t(`pipelineEditor.execution.grouping.copy.${match[1]}`) : text;
}
