import i18n from "i18next";

import type { CampaignPlanSummary } from "./campaignSpecTypes";
import {
  getRuntimeGroupingSummary,
  RUNTIME_GROUPING_COPY,
  type DatasetRuntimeGroupingState,
  type SelectedPipelinesRuntimeGrouping,
} from "./runtimeSplitGrouping";

/** User-visible copy of the review step; getters resolve the active language at read time. */
export const experimentReviewCopy = {
  get title() { return i18n.t("newExperiment.review.title"); },
  get nameLabel() { return i18n.t("newExperiment.review.nameLabel"); },
  get descriptionLabel() { return i18n.t("newExperiment.review.descriptionLabel"); },
  get descriptionPlaceholder() { return i18n.t("newExperiment.review.descriptionPlaceholder"); },
  get groupingTitle() { return i18n.t("newExperiment.review.groupingTitle"); },
  get noSplittersBadge() { return i18n.t("newExperiment.review.noSplittersBadge"); },
};

export interface ExperimentReviewSummaryField {
  id: string;
  label: string;
  value: number;
}

export interface ExperimentReviewDatasetLabelSource {
  name: string;
}

export interface ExperimentReviewGroupingRow {
  id: string;
  datasetName: string;
  summary: string;
}

export function buildExperimentReviewSummaryFields(
  campaignSummary: CampaignPlanSummary,
): ExperimentReviewSummaryField[] {
  return [
    { id: "datasets", label: i18n.t("newExperiment.review.summary.datasets"), value: campaignSummary.datasetCount },
    { id: "pipelines", label: i18n.t("newExperiment.review.summary.pipelines"), value: campaignSummary.pipelineCount },
    { id: "runs", label: i18n.t("newExperiment.review.summary.runs"), value: campaignSummary.runCount },
  ];
}

export function getExperimentReviewGroupingBadgeLabel(
  groupingSelection: SelectedPipelinesRuntimeGrouping,
): string | null {
  return groupingSelection.hasSplitters ? null : experimentReviewCopy.noSplittersBadge;
}

export function getExperimentReviewNoSplitterMessage(): string {
  return RUNTIME_GROUPING_COPY.noSplitterInjection;
}

export function buildExperimentReviewGroupingRows({
  datasetById,
  datasetGroupingStates,
  selectedDatasetIds,
}: {
  datasetById: ReadonlyMap<string, ExperimentReviewDatasetLabelSource>;
  datasetGroupingStates: Record<string, DatasetRuntimeGroupingState>;
  selectedDatasetIds: string[];
}): ExperimentReviewGroupingRow[] {
  return selectedDatasetIds.flatMap((datasetId) => {
    const dataset = datasetById.get(datasetId);
    const groupingState = datasetGroupingStates[datasetId];
    if (!dataset || !groupingState) return [];

    return [{
      id: datasetId,
      datasetName: dataset.name,
      summary: getRuntimeGroupingSummary(
        groupingState.repetitionColumn,
        groupingState.selectedGroupBy,
      ),
    }];
  });
}
